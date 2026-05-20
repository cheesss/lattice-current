#!/usr/bin/env node

import pg from 'pg';
import { pathToFileURL } from 'node:url';
import { drainReportBackfillTasks } from './_shared/report-deep-research-pack.mjs';
import { loadOptionalEnvFile, resolveNasPgConfig } from './_shared/nas-runtime.mjs';

const { Client } = pg;

function readArg(argv, name) {
  const prefix = `--${name}=`;
  const eqValue = argv.find((arg) => arg.startsWith(prefix));
  if (eqValue) return eqValue.slice(prefix.length);
  const idx = argv.indexOf(`--${name}`);
  if (idx === -1) return undefined;
  const next = argv[idx + 1];
  return next && !next.startsWith('--') ? next : true;
}

export function parseDrainReportBackfillArgs(argv = process.argv.slice(2)) {
  const dryRun = argv.includes('--dry-run') || !argv.includes('--apply');
  return {
    dryRun,
    ensureSchema: !argv.includes('--no-ensure-schema'),
    reconcileStale: !argv.includes('--no-reconcile-stale'),
    limit: readArg(argv, 'limit'),
    maxAttempts: readArg(argv, 'max-attempts'),
    retryBaseDelayMs: readArg(argv, 'retry-base-delay-ms'),
    retryMaxDelayMs: readArg(argv, 'retry-max-delay-ms'),
    staleHours: readArg(argv, 'stale-hours'),
    reportId: readArg(argv, 'report-id') || readArg(argv, 'reportId'),
  };
}

export async function runDrainReportBackfillTasks(options = {}) {
  loadOptionalEnvFile();
  const client = options.client || new Client(options.pgConfig || resolveNasPgConfig());
  const ownClient = !options.client;
  if (ownClient) await client.connect();
  try {
    return await drainReportBackfillTasks(client, options);
  } finally {
    if (ownClient) await client.end().catch(() => {});
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
  runDrainReportBackfillTasks(parseDrainReportBackfillArgs())
    .then((result) => {
      console.log(JSON.stringify(result, null, 2));
      if (!result.ok) process.exitCode = 1;
    })
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
}
