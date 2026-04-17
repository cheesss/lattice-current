#!/usr/bin/env node
/**
 * promote-nowcast-model.mjs — manual or scripted promotion workflow.
 *
 * Reads the latest training snapshots + last-30-days reconciliation to decide
 * whether to promote a model from candidate → shadow → active. Used ad-hoc
 * after training a new model version.
 *
 * Promotion gates:
 *   candidate → shadow:  holdout MAE < baseline * 0.85 AND coverage_90 ≥ 0.80
 *                        AND training row_count ≥ 120
 *   shadow    → active:  observed last-30d MAE ≤ candidate holdout MAE * 1.2
 *                        AND last-30d coverage ≥ 0.80
 *
 * active → deprecated: triggered when another version reaches active; previous
 * active row is marked deprecated automatically.
 */

import pg from 'pg';
import { pathToFileURL } from 'node:url';
import { loadOptionalEnvFile, resolveNasPgConfig } from './_shared/nas-runtime.mjs';

const { Client } = pg;

loadOptionalEnvFile();

function parseArgs() {
  const args = {};
  for (let i = 2; i < process.argv.length; i += 1) {
    const token = process.argv[i];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const next = process.argv[i + 1];
    if (!next || next.startsWith('--')) { args[key] = true; continue; }
    args[key] = next;
    i += 1;
  }
  return args;
}

async function evaluateCandidate(client, target, version, evalSummary) {
  const holdoutMae = Number(evalSummary.holdout_mae);
  const baselineMae = Number(evalSummary.baseline_mae);
  const coverage = Number(evalSummary.coverage_90);
  const rows = Number(evalSummary.n_train) + Number(evalSummary.n_holdout);

  const improvement = baselineMae > 0 ? (baselineMae - holdoutMae) / baselineMae : 0;
  const passed = holdoutMae < baselineMae * 0.85 && coverage >= 0.80 && rows >= 120;
  return {
    passed,
    reason: passed ? 'candidate gates satisfied'
      : `holdout MAE ${holdoutMae} vs baseline ${baselineMae} (improvement ${(improvement*100).toFixed(1)}%), coverage ${coverage}, rows ${rows}`,
    improvement,
  };
}

async function evaluateShadow(client, target, version, evalSummary) {
  const { rows } = await client.query(`
    SELECT AVG(abs_error)::float AS live_mae,
           AVG(CASE WHEN within_interval THEN 1.0 ELSE 0.0 END)::float AS coverage,
           COUNT(*)::int AS samples
    FROM nowcast_reconciliation
    WHERE signal_name = $1
      AND model_version = $2
      AND reconciled_at > NOW() - INTERVAL '30 days'
  `, [target, version]);
  const live = rows[0];
  if (!live || live.samples < 10) {
    return { passed: false, reason: `insufficient reconciliation samples (${live?.samples || 0})` };
  }
  const holdoutMae = Number(evalSummary.holdout_mae);
  const passed = live.live_mae <= holdoutMae * 1.2 && live.coverage >= 0.80;
  return {
    passed,
    reason: passed ? 'shadow passed live calibration'
      : `live MAE ${live.live_mae.toFixed(4)} vs holdout ${holdoutMae.toFixed(4)}, coverage ${live.coverage.toFixed(2)} (samples ${live.samples})`,
  };
}

async function main() {
  const args = parseArgs();
  const target = args.target;
  if (!target) {
    console.error('usage: --target <signal> [--promote shadow|active] [--version X]');
    process.exit(1);
  }
  const client = new Client(resolveNasPgConfig());
  await client.connect();
  try {
    const tableCheck = await client.query(`SELECT to_regclass('model_registry') AS t`);
    if (!tableCheck.rows?.[0]?.t) {
      console.error('model_registry table missing; run create-model-registry.mjs first');
      process.exit(2);
    }

    const { rows: snapshots } = await client.query(`
      SELECT snapshot_id, feature_set_hash, row_count,
             feature_columns, eval_summary, created_at
      FROM nowcast_training_snapshots
      WHERE target_signal = $1
      ORDER BY created_at DESC
      LIMIT 5
    `, [target]);
    if (!snapshots.length) {
      console.error(`no training snapshots for ${target}`);
      process.exit(2);
    }

    const latest = snapshots[0];
    const version = args.version || (new Date(latest.created_at)).toISOString().slice(0, 10);
    const modelKey = `${target}-nowcast`;
    const evalSummary = typeof latest.eval_summary === 'string' ? JSON.parse(latest.eval_summary) : latest.eval_summary;

    // Upsert as candidate if missing.
    const { rows: existingRows } = await client.query(`
      SELECT promotion_state FROM model_registry
      WHERE model_key = $1 AND model_version = $2
    `, [modelKey, version]);

    if (!existingRows.length) {
      const eligibility = await evaluateCandidate(client, target, version, evalSummary);
      const initialState = eligibility.passed ? 'shadow' : 'candidate';
      await client.query(`
        INSERT INTO model_registry (
          model_key, model_version, target_signal, feature_set_hash,
          train_window_start, train_window_end, promotion_state,
          eval_summary, baseline_uplift, promoted_at
        ) VALUES ($1, $2, $3, $4, CURRENT_DATE - INTERVAL '180 days', CURRENT_DATE, $5, $6::jsonb, $7, $8)
      `, [
        modelKey, version, target, latest.feature_set_hash,
        initialState, JSON.stringify(evalSummary), eligibility.improvement,
        initialState === 'shadow' ? new Date() : null,
      ]);
      console.log(`registered ${modelKey}@${version} as ${initialState}: ${eligibility.reason}`);
    }

    if (args.promote === 'active') {
      const result = await evaluateShadow(client, target, version, evalSummary);
      if (!result.passed) {
        console.error(`cannot promote to active: ${result.reason}`);
        process.exit(3);
      }
      // Demote prior active.
      await client.query(`
        UPDATE model_registry
        SET promotion_state = 'deprecated', deprecated_at = NOW()
        WHERE target_signal = $1 AND promotion_state = 'active' AND model_version <> $2
      `, [target, version]);
      await client.query(`
        UPDATE model_registry
        SET promotion_state = 'active', promoted_at = NOW()
        WHERE model_key = $1 AND model_version = $2
      `, [modelKey, version]);
      console.log(`promoted ${modelKey}@${version} to active: ${result.reason}`);
    }
  } finally {
    await client.end();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(String(err?.stack || err?.message || err));
    process.exit(1);
  });
}
