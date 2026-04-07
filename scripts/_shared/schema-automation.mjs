#!/usr/bin/env node

import pg from 'pg';
import { pathToFileURL } from 'node:url';
import { loadOptionalEnvFile, resolveNasPgConfig } from './nas-runtime.mjs';

loadOptionalEnvFile();

const { Client } = pg;

export const AUTOMATION_SCHEMA_STATEMENTS = [
  `
    CREATE TABLE IF NOT EXISTS automation_budget_log (
      id SERIAL PRIMARY KEY,
      action TEXT NOT NULL,
      amount INTEGER NOT NULL DEFAULT 1 CHECK (amount >= 0),
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      consumed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `,
  `
    CREATE INDEX IF NOT EXISTS idx_automation_budget_log_action_time
      ON automation_budget_log(action, consumed_at DESC);
  `,
  `
    CREATE TABLE IF NOT EXISTS automation_actions (
      id SERIAL PRIMARY KEY,
      action_type TEXT NOT NULL,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      executed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      result TEXT NOT NULL DEFAULT 'success'
        CHECK (result IN ('success', 'failed', 'skipped', 'queued', 'dry-run')),
      reason TEXT
    );
  `,
  `
    CREATE INDEX IF NOT EXISTS idx_automation_actions_type_time
      ON automation_actions(action_type, executed_at DESC);
  `,
  `
    CREATE TABLE IF NOT EXISTS approval_queue (
      id SERIAL PRIMARY KEY,
      action_type TEXT NOT NULL,
      payload JSONB NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'approved', 'rejected', 'executed')),
      reasoning TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      reviewed_at TIMESTAMPTZ,
      reviewer TEXT
    );
  `,
  `
    CREATE INDEX IF NOT EXISTS idx_approval_queue_status_time
      ON approval_queue(status, created_at DESC);
  `,
];

export async function ensureAutomationSchema(queryable) {
  for (const statement of AUTOMATION_SCHEMA_STATEMENTS) {
    await queryable.query(statement);
  }
}

export async function runAutomationSchema(config = resolveNasPgConfig()) {
  const client = new Client(config);
  await client.connect();
  try {
    await ensureAutomationSchema(client);
    return { ok: true, statementCount: AUTOMATION_SCHEMA_STATEMENTS.length };
  } finally {
    await client.end();
  }
}

const isDirectRun = (() => {
  const entryArg = process.argv[1];
  if (!entryArg) return false;
  try {
    return import.meta.url === pathToFileURL(entryArg).href;
  } catch {
    return false;
  }
})();

if (isDirectRun) {
  runAutomationSchema()
    .then((summary) => {
      process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
    })
    .catch((error) => {
      process.stderr.write(`${String(error?.stack || error?.message || error)}\n`);
      process.exit(1);
    });
}
