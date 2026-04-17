#!/usr/bin/env node
/**
 * compute-composite-nowcasts.mjs — Phase 2d.
 *
 * Builds composite nowcasts (marketStress, transmissionStrength) from the
 * most recent nowcasts OR observations for their constituent signals.
 *
 * Rule: a composite is only written when at least N inputs are available
 * and at least one input is an estimated nowcast (otherwise the existing
 * observed pipeline still produces the value).
 */

import pg from 'pg';
import { pathToFileURL } from 'node:url';
import { loadOptionalEnvFile, resolveNasPgConfig } from './_shared/nas-runtime.mjs';
import { withLock } from './_shared/pipeline-lock.mjs';
import { createLogger } from './_shared/structured-logger.mjs';
import { adjustConfidenceForSession } from './_shared/market-calendar.mjs';

const { Client } = pg;
loadOptionalEnvFile();

const logger = createLogger('compute-composite-nowcasts');

async function fetchLatestValue(client, signalName) {
  // Prefer most recent estimated_signal_nowcasts (unreconciled)
  // unless signal_history has a fresher observed row.
  const tableCheck = await client.query(`SELECT to_regclass('estimated_signal_nowcasts') AS t`);
  let nowcast = null;
  if (tableCheck.rows?.[0]?.t) {
    const { rows } = await client.query(
      `SELECT estimated_value, estimate_confidence, interval_low, interval_high,
              target_ts, model_version, created_at
       FROM estimated_signal_nowcasts
       WHERE signal_name = $1
         AND last_observed_at IS NULL
       ORDER BY created_at DESC
       LIMIT 1`,
      [signalName],
    );
    nowcast = rows[0] || null;
  }
  const { rows: obsRows } = await client.query(
    `SELECT value, ts
     FROM signal_history
     WHERE signal_name = $1 AND value_origin = 'observed'
     ORDER BY ts DESC
     LIMIT 1`,
    [signalName],
  );
  const observed = obsRows[0] || null;

  if (nowcast && observed) {
    const obsAge = Date.now() - new Date(observed.ts).getTime();
    const nowAge = Date.now() - new Date(nowcast.created_at).getTime();
    if (obsAge < nowAge && obsAge < 3 * 60 * 60 * 1000) {
      return { source: 'observed', value: Number(observed.value), observedAt: observed.ts };
    }
    return {
      source: 'nowcast',
      value: Number(nowcast.estimated_value),
      confidence: Number(nowcast.estimate_confidence || 0.6),
      intervalLow: Number(nowcast.interval_low),
      intervalHigh: Number(nowcast.interval_high),
      targetTs: nowcast.target_ts,
      modelVersion: nowcast.model_version,
    };
  }
  if (nowcast) {
    return {
      source: 'nowcast',
      value: Number(nowcast.estimated_value),
      confidence: Number(nowcast.estimate_confidence || 0.6),
      intervalLow: Number(nowcast.interval_low),
      intervalHigh: Number(nowcast.interval_high),
      targetTs: nowcast.target_ts,
      modelVersion: nowcast.model_version,
    };
  }
  if (observed) {
    return { source: 'observed', value: Number(observed.value), observedAt: observed.ts };
  }
  return null;
}

function normalize(value, mid, span) {
  if (!Number.isFinite(value)) return null;
  return Math.max(0, Math.min(1, (value - mid + span) / (2 * span)));
}

function combineIntervalRSS(components) {
  // For composites, approximate the 90% interval as sqrt(sum of squared halfwidths).
  let sumSquares = 0;
  for (const c of components) {
    if (c.source !== 'nowcast') continue;
    const half = Math.max(0, (c.intervalHigh - c.intervalLow) / 2);
    sumSquares += half * half;
  }
  return Math.sqrt(sumSquares);
}

async function writeComposite(client, {
  signalName, composite, inputs, targetTs,
}) {
  const anyNowcast = inputs.some((i) => i.source === 'nowcast');
  if (!anyNowcast) {
    logger.info('skipping composite write — all inputs observed, existing pipeline will handle', {
      signalName,
    });
    return { signalName, skipped: true, reason: 'no nowcast inputs' };
  }

  const rawConfidence = Math.min(
    ...inputs.map((i) => (i.source === 'nowcast' ? (i.confidence || 0.6) : 0.95)),
  ) * 0.95;
  const { confidence, session } = adjustConfidenceForSession(rawConfidence);

  const halfwidth = combineIntervalRSS(inputs);
  const intervalLow = composite.value - halfwidth;
  const intervalHigh = composite.value + halfwidth;

  const derivedFromSources = inputs.map((i) => ({
    signal: i.signal,
    source: i.source,
    value: i.value,
    ...(i.modelVersion ? { model_version: i.modelVersion } : {}),
    ...(i.observedAt ? { observed_at: i.observedAt } : {}),
  }));
  const modelVersion = `composite-v1-${session.session}`;

  await client.query(
    `INSERT INTO estimated_signal_nowcasts (
       signal_name, target_ts, model_version,
       estimated_value, estimate_method, estimate_confidence,
       interval_low, interval_high,
       feature_vintage_at, regime, derived_from_sources
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb)
     ON CONFLICT (signal_name, target_ts, model_version) DO UPDATE
       SET estimated_value = EXCLUDED.estimated_value,
           estimate_confidence = EXCLUDED.estimate_confidence,
           interval_low = EXCLUDED.interval_low,
           interval_high = EXCLUDED.interval_high,
           feature_vintage_at = EXCLUDED.feature_vintage_at,
           regime = EXCLUDED.regime,
           derived_from_sources = EXCLUDED.derived_from_sources`,
    [
      signalName, targetTs, modelVersion,
      composite.value, composite.method, confidence,
      intervalLow, intervalHigh,
      new Date(), session.session,
      JSON.stringify(derivedFromSources),
    ],
  );
  return {
    signalName,
    composite: composite.value,
    confidence,
    session: session.session,
    interval: [intervalLow, intervalHigh],
  };
}

async function computeMarketStress(client) {
  const vix = await fetchLatestValue(client, 'vix');
  const hy = await fetchLatestValue(client, 'hy_credit_spread');
  const yld = await fetchLatestValue(client, 'yieldSpread');
  const inputs = [
    vix ? { ...vix, signal: 'vix' } : null,
    hy ? { ...hy, signal: 'hy_credit_spread' } : null,
    yld ? { ...yld, signal: 'yieldSpread' } : null,
  ].filter(Boolean);
  if (inputs.length < 2) {
    logger.info('marketStress: insufficient inputs', { available: inputs.length });
    return { signalName: 'marketStress', skipped: true, reason: 'insufficient inputs' };
  }

  // Composite formula mirrors refresh-fred-signals-to-nas deriveAndWriteMarketStress:
  //   stress = clamp(0.4 * vix_norm + 0.3 * hy_norm + 0.3 * yld_inv_norm, 0, 1)
  const vixNorm = normalize(vix?.value, 20, 15);
  const hyNorm = normalize(hy?.value, 4, 2);
  // Narrower yield spread → higher stress (inverted)
  const yldNorm = yld?.value != null ? 1 - normalize(yld.value, 1, 1) : null;
  const components = [vixNorm, hyNorm, yldNorm].filter((v) => v != null);
  if (!components.length) return { signalName: 'marketStress', skipped: true, reason: 'normalization failed' };
  const composite = (
    (vixNorm != null ? 0.4 * vixNorm : 0) +
    (hyNorm != null ? 0.3 * hyNorm : 0) +
    (yldNorm != null ? 0.3 * yldNorm : 0)
  ) / (
    (vixNorm != null ? 0.4 : 0) +
    (hyNorm != null ? 0.3 : 0) +
    (yldNorm != null ? 0.3 : 0)
  );

  return writeComposite(client, {
    signalName: 'marketStress',
    composite: { value: composite, method: 'composite-vix-hy-yld' },
    inputs,
    targetTs: new Date(),
  });
}

export async function runCompositeNowcasts() {
  return withLock('compute-composite-nowcasts', async () => {
    const client = new Client(resolveNasPgConfig());
    await client.connect();
    try {
      const tableCheck = await client.query(`SELECT to_regclass('estimated_signal_nowcasts') AS t`);
      if (!tableCheck.rows?.[0]?.t) {
        logger.info('estimated_signal_nowcasts missing; skipping');
        return { ok: true, skipped: true };
      }
      const results = [];
      results.push(await computeMarketStress(client));
      return { ok: true, results };
    } catch (err) {
      logger.error('composite nowcast failed', { error: err.message });
      return { ok: false, error: err.message };
    } finally {
      await client.end();
    }
  });
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCompositeNowcasts().then((result) => {
    console.log(JSON.stringify(result, null, 2));
    process.exit(result.ok ? 0 : 1);
  });
}
