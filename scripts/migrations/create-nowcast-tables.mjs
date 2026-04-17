#!/usr/bin/env node
/**
 * Migration: create the nowcast storage triad.
 *
 * Phase 1 of Nowcast plan.
 *
 * - estimated_signal_nowcasts   — current/near-current estimated values,
 *                                 one row per (signal, target_ts, model_version).
 * - nowcast_reconciliation       — pair predictions with later-arriving
 *                                 observations for calibration tracking.
 * - nowcast_training_snapshots   — record feature_vintage_cutoff per training
 *                                 run so the same model can be reproduced.
 *
 * Run: node scripts/migrations/create-nowcast-tables.mjs [--dry-run]
 */

import pg from 'pg';
import { loadOptionalEnvFile, resolveNasPgConfig } from '../_shared/nas-runtime.mjs';

const { Client } = pg;

loadOptionalEnvFile();

const DRY_RUN = process.argv.includes('--dry-run');

const STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS estimated_signal_nowcasts (
     signal_name            text NOT NULL,
     target_ts              timestamptz NOT NULL,
     model_version          text NOT NULL,
     estimated_value        double precision NOT NULL,
     estimate_method        text NOT NULL,
     estimate_confidence    double precision,
     interval_low           double precision,
     interval_high          double precision,
     feature_vintage_at     timestamptz NOT NULL,
     regime                 text,
     derived_from_sources   jsonb NOT NULL,
     input_sources_snapshot jsonb,
     last_observed_at       timestamptz,
     created_at             timestamptz NOT NULL DEFAULT now(),
     PRIMARY KEY (signal_name, target_ts, model_version)
   )`,

  `CREATE INDEX IF NOT EXISTS idx_nowcasts_signal_created
     ON estimated_signal_nowcasts (signal_name, created_at DESC)`,

  `CREATE INDEX IF NOT EXISTS idx_nowcasts_unreconciled
     ON estimated_signal_nowcasts (signal_name, target_ts)
     WHERE last_observed_at IS NULL`,

  `CREATE TABLE IF NOT EXISTS nowcast_reconciliation (
     signal_name      text NOT NULL,
     target_ts        timestamptz NOT NULL,
     model_version    text NOT NULL,
     predicted_value  double precision NOT NULL,
     predicted_at     timestamptz NOT NULL,
     observed_value   double precision NOT NULL,
     observed_at      timestamptz NOT NULL,
     abs_error        double precision NOT NULL,
     pct_error        double precision,
     within_interval  boolean,
     calibration_bucket text,
     reconciled_at    timestamptz NOT NULL DEFAULT now(),
     PRIMARY KEY (signal_name, target_ts, model_version)
   )`,

  `CREATE INDEX IF NOT EXISTS idx_reconciliation_signal_time
     ON nowcast_reconciliation (signal_name, reconciled_at DESC)`,

  `CREATE TABLE IF NOT EXISTS nowcast_training_snapshots (
     snapshot_id            bigserial PRIMARY KEY,
     target_signal          text NOT NULL,
     training_date          timestamptz NOT NULL,
     feature_vintage_cutoff timestamptz NOT NULL,
     feature_set_hash       text NOT NULL,
     row_count              int NOT NULL,
     feature_columns        jsonb NOT NULL,
     eval_summary           jsonb,
     created_at             timestamptz NOT NULL DEFAULT now()
   )`,

  `CREATE INDEX IF NOT EXISTS idx_training_snapshots_signal
     ON nowcast_training_snapshots (target_signal, training_date DESC)`,
];

async function main() {
  const client = new Client(resolveNasPgConfig());
  await client.connect();
  try {
    for (const stmt of STATEMENTS) {
      if (DRY_RUN) {
        console.log('[dry-run]', stmt.split('\n')[0]);
        continue;
      }
      console.log('→', stmt.split('\n')[0]);
      await client.query(stmt);
    }
    if (!DRY_RUN) {
      const { rows } = await client.query(`
        SELECT
          (SELECT COUNT(*) FROM estimated_signal_nowcasts)::int    AS nowcasts,
          (SELECT COUNT(*) FROM nowcast_reconciliation)::int       AS reconciled,
          (SELECT COUNT(*) FROM nowcast_training_snapshots)::int   AS snapshots
      `);
      const r = rows[0];
      console.log(`\nNowcast tables ready: nowcasts=${r.nowcasts}, reconciled=${r.reconciled}, snapshots=${r.snapshots}`);
    }
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(String(err?.stack || err?.message || err));
  process.exit(1);
});
