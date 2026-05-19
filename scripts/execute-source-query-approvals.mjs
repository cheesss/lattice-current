#!/usr/bin/env node

import pg from 'pg';
import { pathToFileURL } from 'node:url';
import { executeApprovedSourceQueries } from './_shared/source-query-executor.mjs';
import { loadOptionalEnvFile, resolveNasPgConfig } from './_shared/nas-runtime.mjs';
import { loadResearchOsPolicy } from './_shared/research-os-policy.mjs';

const { Client } = pg;

function readNumberArg(argv, name) {
  const eq = argv.find((arg) => arg.startsWith(`--${name}=`));
  if (eq) return Number(eq.split('=').slice(1).join('='));
  const idx = argv.indexOf(`--${name}`);
  const raw = idx === -1 ? undefined : argv[idx + 1];
  return raw === undefined ? undefined : Number(raw);
}

function parseArgs(argv = process.argv.slice(2)) {
  const args = new Set(argv);
  const operatorSeedIds = argv.find((arg) => arg.startsWith('--operator-seed-ids='))?.split('=').slice(1).join('=')?.split(',').map((item) => item.trim()).filter(Boolean)
    || (() => {
      const idx = argv.indexOf('--operator-seed-ids');
      return idx === -1 ? undefined : String(argv[idx + 1] || '').split(',').map((item) => item.trim()).filter(Boolean);
    })();
  return {
    dryRun: args.has('--dry-run'),
    approvePending: args.has('--approve-pending'),
    retryNeedsFix: args.has('--retry-needs-fix'),
    reprocessExecuted: args.has('--reprocess-executed'),
    reopenExhausted: args.has('--reopen-exhausted'),
    reportCreatedOnly: args.has('--report-created-only'),
    operatorSeedCreatedOnly: args.has('--operator-seed-created-only'),
    operatorSeedIds,
    limit: readNumberArg(argv, 'limit'),
    perQueryLimit: readNumberArg(argv, 'per-query-limit'),
    concurrency: readNumberArg(argv, 'concurrency') || Number(process.env.SOURCE_QUERY_EXECUTOR_CONCURRENCY || 1),
    reviewer: argv.find((arg) => arg.startsWith('--reviewer='))?.split('=')[1],
    reportId: argv.find((arg) => arg.startsWith('--report-id='))?.split('=').slice(1).join('='),
    approvalIds: argv.find((arg) => arg.startsWith('--approval-ids='))?.split('=')[1]?.split(',').map((item) => item.trim()).filter(Boolean),
  };
}

export async function runExecuteSourceQueryApprovals(options = {}) {
  loadOptionalEnvFile();
  const policy = options.policy || loadResearchOsPolicy();
  const client = options.client || new Client(options.pgConfig || resolveNasPgConfig());
  const ownClient = !options.client;
  if (ownClient) await client.connect();
  try {
    return await executeApprovedSourceQueries(client, {
      ...options,
      policy,
      approvalReason: 'Explicit operator continuation request for S-tier Research OS convergence.',
      createWorkerClient: async () => {
        const worker = new Client(options.pgConfig || resolveNasPgConfig());
        await worker.connect();
        return worker;
      },
    });
  } finally {
    if (ownClient) await client.end();
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
  runExecuteSourceQueryApprovals(parseArgs())
    .then((result) => console.log(JSON.stringify(result, null, 2)))
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
}
