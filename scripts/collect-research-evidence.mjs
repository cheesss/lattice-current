#!/usr/bin/env node

import pg from 'pg';
import { pathToFileURL } from 'node:url';
import { ensureResearchOsSchema } from './_shared/adjacency-graph.mjs';
import { collectResearchEvidence } from './_shared/evidence-collector.mjs';
import { loadOptionalEnvFile, resolveNasPgConfig } from './_shared/nas-runtime.mjs';

const { Client } = pg;

function parseArgs(argv = process.argv.slice(2)) {
  const args = new Set(argv);
  return {
    dryRun: args.has('--dry-run'),
    limit: Number(argv.find((arg) => arg.startsWith('--limit='))?.split('=')[1] || 24),
    perQuestionLimit: Number(argv.find((arg) => arg.startsWith('--per-question-limit='))?.split('=')[1] || 24),
  };
}

export async function runCollectResearchEvidence(options = {}) {
  loadOptionalEnvFile();
  const client = options.client || new Client(options.pgConfig || resolveNasPgConfig());
  const ownClient = !options.client;
  if (ownClient) await client.connect();
  try {
    await ensureResearchOsSchema(client);
    return await collectResearchEvidence(client, {
      dryRun: options.dryRun,
      limit: options.limit,
      perQuestionLimit: options.perQuestionLimit,
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
  runCollectResearchEvidence(parseArgs())
    .then((result) => console.log(JSON.stringify(result, null, 2)))
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
}
