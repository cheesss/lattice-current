#!/usr/bin/env node

import pg from 'pg';
import { pathToFileURL } from 'node:url';
import { ensureResearchOsSchema } from './_shared/adjacency-graph.mjs';
import { runTrustedPromotion } from './_shared/trusted-graph-promotion.mjs';
import { loadOptionalEnvFile, resolveNasPgConfig } from './_shared/nas-runtime.mjs';
import { loadResearchOsPolicy } from './_shared/research-os-policy.mjs';

const { Client } = pg;

function parseArgs(argv = process.argv.slice(2)) {
  const args = new Set(argv);
  const limitArg = argv.find((arg) => arg.startsWith('--limit='))?.split('=')[1];
  return {
    dryRun: args.has('--dry-run'),
    limit: limitArg ? Number(limitArg) : undefined,
  };
}

export async function runPromoteTrustedGraph(options = {}) {
  loadOptionalEnvFile();
  const policy = options.policy || loadResearchOsPolicy();
  const client = options.client || new Client(options.pgConfig || resolveNasPgConfig());
  const ownClient = !options.client;
  if (ownClient) await client.connect();
  try {
    await ensureResearchOsSchema(client);
    return await runTrustedPromotion(client, policy, options);
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
  runPromoteTrustedGraph(parseArgs())
    .then((result) => console.log(JSON.stringify(result, null, 2)))
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
}
