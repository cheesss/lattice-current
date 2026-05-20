#!/usr/bin/env node
/**
 * Migration: create model_registry table for tracking nowcast model versions
 * and promotion state (candidate → shadow → active → deprecated).
 *
 * Run: node scripts/migrations/create-model-registry.mjs [--dry-run]
 */

import pg from 'pg';
import { loadOptionalEnvFile, resolveNasPgConfig } from '../_shared/nas-runtime.mjs';

const { Client } = pg;

loadOptionalEnvFile();

const DRY_RUN = process.argv.includes('--dry-run');

const STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS model_registry (
     model_key          text NOT NULL,
     model_version      text NOT NULL,
     target_signal      text NOT NULL,
     feature_set_hash   text NOT NULL,
     train_window_start date NOT NULL,
     train_window_end   date NOT NULL,
     promotion_state    text NOT NULL DEFAULT 'candidate'
       CHECK (promotion_state IN ('candidate','shadow','active','deprecated')),
     eval_summary       jsonb NOT NULL,
     baseline_uplift    double precision,
     created_at         timestamptz NOT NULL DEFAULT now(),
     promoted_at        timestamptz,
     deprecated_at      timestamptz,
     PRIMARY KEY (model_key, model_version)
   )`,
  `CREATE INDEX IF NOT EXISTS idx_model_registry_active
     ON model_registry (target_signal, promotion_state)
     WHERE promotion_state IN ('active','shadow')`,
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
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(String(err?.stack || err?.message || err));
  process.exit(1);
});
