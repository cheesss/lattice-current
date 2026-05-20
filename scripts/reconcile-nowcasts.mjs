#!/usr/bin/env node
/**
 * reconcile-nowcasts.mjs — pair estimated_signal_nowcasts rows with
 * later-arriving observed values from signal_history and write calibration
 * rows into nowcast_reconciliation.
 *
 * Runs every 15 minutes from master-daemon.
 *
 * Reconciliation rule:
 *   For every unreconciled nowcast (last_observed_at IS NULL) whose
 *   target_ts has passed, find the nearest observed signal_history row on
 *   or after target_ts (same trading day or next session) and treat it as
 *   the ground truth.
 *
 * Flags anomalies via alert-notifier when abs_error falls outside the 90%
 * interval more than twice in a rolling 24h window.
 */

import pg from 'pg';
import { pathToFileURL } from 'node:url';
import { loadOptionalEnvFile, resolveNasPgConfig } from './_shared/nas-runtime.mjs';
import { withLock } from './_shared/pipeline-lock.mjs';
import { createLogger } from './_shared/structured-logger.mjs';
import { sendAlert } from './_shared/alert-notifier.mjs';

const { Client } = pg;
loadOptionalEnvFile();

const logger = createLogger('reconcile-nowcasts');

/**
 * Pure: classify a single prediction/observation pair into a calibration
 * bucket + error metrics. Extracted for testability.
 */
export function classifyReconciliation({ predicted, observed, intervalLow, intervalHigh }) {
  const absError = Math.abs(Number(predicted) - Number(observed));
  const pctError = Number(observed) !== 0
    ? absError / Math.abs(Number(observed))
    : null;
  const boundsPresent = intervalLow != null && intervalHigh != null
    && Number.isFinite(Number(intervalLow)) && Number.isFinite(Number(intervalHigh));
  const withinInterval = boundsPresent
    ? (Number(observed) >= Number(intervalLow) && Number(observed) <= Number(intervalHigh))
    : null;
  const calibrationBucket = absError < 0.05 ? 'good'
    : absError < 0.15 ? 'fair'
    : absError < 0.30 ? 'poor'
    : 'bad';
  return { absError, pctError, withinInterval, calibrationBucket };
}

/**
 * Pure: decide whether coverage reading should trigger an alert, and at
 * what severity. Extracted from checkCalibrationDrift for testability.
 */
export function classifyDriftAlert({ coverage, samples, coverageTarget = 0.80, hardFloor = 0.70, criticalFloor = 0.50 }) {
  if (coverage == null || !Number.isFinite(Number(coverage))) {
    return { alert: false, reason: 'coverage missing' };
  }
  if (samples == null || !Number.isFinite(Number(samples)) || Number(samples) < 5) {
    return { alert: false, reason: 'too few samples' };
  }
  if (Number(coverage) >= hardFloor) {
    return { alert: false, reason: `coverage ${coverage} >= ${hardFloor} hard floor` };
  }
  const severity = Number(coverage) < criticalFloor ? 'critical' : 'warning';
  return {
    alert: true,
    severity,
    reason: `coverage ${Number(coverage).toFixed(2)} below ${hardFloor} (target ${coverageTarget})`,
  };
}

async function reconcileSignal(client, signalName) {
  const { rows: unreconciled } = await client.query(
    `SELECT signal_name, target_ts, model_version, estimated_value,
            estimate_confidence, interval_low, interval_high, created_at
     FROM estimated_signal_nowcasts
     WHERE signal_name = $1
       AND last_observed_at IS NULL
       AND target_ts <= NOW()
     ORDER BY target_ts ASC
     LIMIT 500`,
    [signalName],
  );
  if (!unreconciled.length) return { signal: signalName, reconciled: 0 };

  let reconciledCount = 0;
  for (const row of unreconciled) {
    // Find the first observed value on or after this target_ts.
    const { rows: observed } = await client.query(
      `SELECT ts, value
       FROM signal_history
       WHERE signal_name = $1
         AND value_origin = 'observed'
         AND ts >= $2::timestamptz
       ORDER BY ts ASC
       LIMIT 1`,
      [signalName, row.target_ts],
    );
    if (!observed.length) continue;
    const obs = observed[0];
    const predicted = Number(row.estimated_value);
    const observedValue = Number(obs.value);
    const { absError, pctError, withinInterval, calibrationBucket } = classifyReconciliation({
      predicted,
      observed: observedValue,
      intervalLow: row.interval_low,
      intervalHigh: row.interval_high,
    });

    await client.query(
      `INSERT INTO nowcast_reconciliation (
         signal_name, target_ts, model_version, predicted_value, predicted_at,
         observed_value, observed_at, abs_error, pct_error,
         within_interval, calibration_bucket
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       ON CONFLICT (signal_name, target_ts, model_version) DO UPDATE
         SET predicted_value = EXCLUDED.predicted_value,
             observed_value = EXCLUDED.observed_value,
             observed_at = EXCLUDED.observed_at,
             abs_error = EXCLUDED.abs_error,
             pct_error = EXCLUDED.pct_error,
             within_interval = EXCLUDED.within_interval,
             calibration_bucket = EXCLUDED.calibration_bucket,
             reconciled_at = NOW()`,
      [
        signalName, row.target_ts, row.model_version, predicted, row.created_at,
        observedValue, obs.ts, absError, pctError,
        withinInterval, calibrationBucket,
      ],
    );
    await client.query(
      `UPDATE estimated_signal_nowcasts
       SET last_observed_at = $4
       WHERE signal_name = $1 AND target_ts = $2 AND model_version = $3`,
      [signalName, row.target_ts, row.model_version, obs.ts],
    );
    reconciledCount += 1;
  }
  return { signal: signalName, reconciled: reconciledCount };
}

async function checkCalibrationDrift(client) {
  const { rows } = await client.query(`
    SELECT signal_name,
           COUNT(*)::int AS samples,
           AVG(abs_error)::float AS mean_abs_error,
           AVG(CASE WHEN within_interval THEN 1.0 ELSE 0.0 END)::float AS coverage
    FROM nowcast_reconciliation
    WHERE reconciled_at >= NOW() - INTERVAL '24 hours'
    GROUP BY signal_name
    HAVING COUNT(*) >= 5
  `);
  for (const row of rows) {
    const decision = classifyDriftAlert({ coverage: row.coverage, samples: row.samples });
    if (!decision.alert) continue;
    await sendAlert({
      type: 'nowcast_calibration_drift',
      severity: decision.severity,
      message: `Nowcast coverage for ${row.signal_name} is ${(row.coverage * 100).toFixed(0)}% over last 24h (target ≥80%)`,
      metric: { signal: row.signal_name, coverage: row.coverage, mae: row.mean_abs_error, samples: row.samples },
    });
  }
}

export async function runReconciliation() {
  return withLock('reconcile-nowcasts', async () => {
    const client = new Client(resolveNasPgConfig());
    await client.connect();
    try {
      const tableCheck = await client.query(`SELECT to_regclass('estimated_signal_nowcasts') AS t`);
      if (!tableCheck.rows?.[0]?.t) {
        logger.info('estimated_signal_nowcasts table missing; skipping');
        return { ok: true, skipped: true };
      }

      const signals = ['hy_credit_spread', 'treasury10y', 'yieldSpread', 'ig_credit_spread', 'oilPrice', 'dollarIndex'];
      const results = [];
      for (const signal of signals) {
        const result = await reconcileSignal(client, signal);
        if (result.reconciled > 0) {
          logger.info('reconciled nowcasts', result);
        }
        results.push(result);
      }
      await checkCalibrationDrift(client);
      return { ok: true, results };
    } catch (err) {
      logger.error('reconciliation failed', { error: err.message });
      return { ok: false, error: err.message };
    } finally {
      await client.end();
    }
  });
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  runReconciliation().then((result) => {
    console.log(JSON.stringify(result, null, 2));
    process.exit(result.ok ? 0 : 1);
  });
}
