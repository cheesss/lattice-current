#!/usr/bin/env node
/**
 * Migration: create nowcast_source_eligibility table and seed it with
 * initial hardcoded rules drawn from Phase 2a-d training data.
 *
 * Each row expresses a per-target allow rule for one source/feature. The
 * runtime gate drops sources whose recent holdout MAE drifts beyond the
 * stored threshold, whose freshness exceeds max_lag_hours, or which fall
 * into a disabled regime (regime_mask.shock = false when VIX > 30).
 *
 * Run: node scripts/migrations/create-nowcast-source-gate.mjs [--dry-run]
 */

import pg from 'pg';
import { loadOptionalEnvFile, resolveNasPgConfig } from '../_shared/nas-runtime.mjs';

const { Client } = pg;

loadOptionalEnvFile();

const DRY_RUN = process.argv.includes('--dry-run');

const STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS nowcast_source_eligibility (
     target_signal       text NOT NULL,
     source_signal       text NOT NULL,
     model_version       text NOT NULL,
     min_overlap_days    int NOT NULL DEFAULT 180,
     holdout_mae_max     double precision NOT NULL,
     family_kind         text NOT NULL CHECK (family_kind IN ('same','cross','proxy')),
     max_lag_hours       int NOT NULL,
     drift_threshold     double precision NOT NULL DEFAULT 0.25,
     regime_mask         jsonb NOT NULL DEFAULT '{"normal": true, "shock": true}'::jsonb,
     enabled             boolean NOT NULL DEFAULT true,
     last_evaluated_at   timestamptz,
     PRIMARY KEY (target_signal, source_signal, model_version)
   )`,
];

// Seed rows capture the dependencies encoded in train-rates-nowcast.py and
// train-commodity-fx-nowcast.py. Change here if model feature sets change.
const SEED_RULES = [
  // hy_credit_spread nowcast
  { target: 'hy_credit_spread', source: 'HYG',     family: 'cross', lag: 1, maeMax: 0.2, regimeMask: { normal: true, shock: true } },
  { target: 'hy_credit_spread', source: 'vix',     family: 'cross', lag: 2, maeMax: 0.2, regimeMask: { normal: true, shock: true } },
  { target: 'hy_credit_spread', source: 'hy_credit_spread', family: 'same', lag: 48, maeMax: 0.3 },

  // treasury10y nowcast
  { target: 'treasury10y', source: '^TNX', family: 'cross', lag: 1, maeMax: 0.1 },
  { target: 'treasury10y', source: 'TLT',  family: 'cross', lag: 1, maeMax: 0.1 },
  { target: 'treasury10y', source: 'treasury10y', family: 'same', lag: 48, maeMax: 0.2 },

  // yieldSpread nowcast
  { target: 'yieldSpread', source: '^TNX', family: 'cross', lag: 1, maeMax: 0.1 },
  { target: 'yieldSpread', source: '^IRX', family: 'cross', lag: 1, maeMax: 0.1 },
  { target: 'yieldSpread', source: 'TLT',  family: 'cross', lag: 1, maeMax: 0.1 },

  // ig_credit_spread nowcast — in shock regime the HYG/VIX relationship diverges,
  // so mark as shock=false (opt in to abstain).
  { target: 'ig_credit_spread', source: 'LQD', family: 'cross', lag: 1, maeMax: 0.2, regimeMask: { normal: true, shock: false } },
  { target: 'ig_credit_spread', source: 'vix', family: 'cross', lag: 2, maeMax: 0.2, regimeMask: { normal: true, shock: false } },

  // oilPrice nowcast
  { target: 'oilPrice', source: 'XLE', family: 'proxy', lag: 6, maeMax: 3.0 },
  { target: 'oilPrice', source: 'USO', family: 'proxy', lag: 6, maeMax: 3.0 },
  { target: 'oilPrice', source: 'XOM', family: 'proxy', lag: 6, maeMax: 4.0 },
  { target: 'oilPrice', source: 'CVX', family: 'proxy', lag: 6, maeMax: 4.0 },

  // dollarIndex nowcast
  { target: 'dollarIndex', source: 'UUP', family: 'cross', lag: 6, maeMax: 0.6 },
  { target: 'dollarIndex', source: 'FXE', family: 'cross', lag: 6, maeMax: 0.8 },
];

async function main() {
  const client = new Client(resolveNasPgConfig());
  await client.connect();
  try {
    for (const stmt of STATEMENTS) {
      if (DRY_RUN) { console.log('[dry-run]', stmt.split('\n')[0]); continue; }
      await client.query(stmt);
      console.log('→', stmt.split('\n')[0]);
    }
    if (!DRY_RUN) {
      for (const rule of SEED_RULES) {
        await client.query(
          `INSERT INTO nowcast_source_eligibility (
             target_signal, source_signal, model_version,
             family_kind, max_lag_hours, holdout_mae_max, regime_mask
           ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
           ON CONFLICT (target_signal, source_signal, model_version) DO UPDATE
             SET family_kind = EXCLUDED.family_kind,
                 max_lag_hours = EXCLUDED.max_lag_hours,
                 holdout_mae_max = EXCLUDED.holdout_mae_max,
                 regime_mask = EXCLUDED.regime_mask`,
          [
            rule.target, rule.source, 'v1',
            rule.family, rule.lag, rule.maeMax,
            JSON.stringify(rule.regimeMask || { normal: true, shock: true }),
          ],
        );
      }
      const { rows } = await client.query(`
        SELECT target_signal, COUNT(*)::int AS rules
        FROM nowcast_source_eligibility
        GROUP BY target_signal
        ORDER BY target_signal
      `);
      console.log('\nSeeded eligibility rules:');
      for (const r of rows) console.log(`  ${r.target_signal.padEnd(20)} ${r.rules} rules`);
    }
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(String(err?.stack || err?.message || err));
  process.exit(1);
});
