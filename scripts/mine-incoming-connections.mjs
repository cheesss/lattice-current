#!/usr/bin/env node

import pg from 'pg';
import { pathToFileURL } from 'node:url';
import { loadOptionalEnvFile, resolveNasPgConfig } from './_shared/nas-runtime.mjs';
import { runIncomingConnectionMiner } from './_shared/incoming-connection-miner.mjs';

const { Client } = pg;

function parseArgs(argv = process.argv.slice(2)) {
  const limitArg = argv.find((arg) => arg.startsWith('--limit='));
  const lookbackArg = argv.find((arg) => arg.startsWith('--lookback-days='));
  return {
    dryRun: argv.includes('--dry-run'),
    limit: limitArg ? Number(limitArg.split('=')[1]) : undefined,
    lookbackDays: lookbackArg ? Number(lookbackArg.split('=')[1]) : undefined,
  };
}

export async function main(options = {}) {
  loadOptionalEnvFile();
  const client = options.client || new Client(options.pgConfig || resolveNasPgConfig());
  const ownClient = !options.client;
  if (ownClient) await client.connect();
  try {
    const result = await runIncomingConnectionMiner(client, options);
    return {
      ok: result.ok,
      dryRun: result.dryRun,
      lookbackDays: result.lookbackDays,
      sourceCounts: result.sourceCounts,
      generated: result.signals.length,
      inserted: result.inserted,
      archived: result.archived || 0,
      topSignals: result.signals.slice(0, 12).map((signal) => ({
        label: signal.label,
        signalType: signal.signalType,
        priorityScore: signal.priorityScore,
        noveltyScore: signal.noveltyScore,
        sourceTypes: signal.sourceTypes,
        linkedThemes: signal.linkedThemes,
        seedSimilarity: signal.seedSimilarity,
      })),
    };
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
  main(parseArgs())
    .then((result) => {
      console.log(JSON.stringify(result, null, 2));
    })
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
}
