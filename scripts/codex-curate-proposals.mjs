#!/usr/bin/env node

import pg from 'pg';
import { pathToFileURL } from 'node:url';
import { loadOptionalEnvFile, resolveNasPgConfig } from './_shared/nas-runtime.mjs';
import { ensureAutomationSchema } from './_shared/schema-automation.mjs';
import { ensureEmergingTechSchema } from './_shared/schema-emerging-tech.mjs';
import { collectAutoCurateContext } from './_shared/auto-curate-support.mjs';
import { proposeBackfillActions } from '../src/services/server/codex-dataset-proposer.ts';

loadOptionalEnvFile();

const { Client } = pg;

export async function runCodexCurateProposals() {
  const client = new Client(resolveNasPgConfig());
  await client.connect();
  try {
    await ensureAutomationSchema(client);
    await ensureEmergingTechSchema(client);
    const context = await collectAutoCurateContext(client);
    const proposals = await proposeBackfillActions(context);
    return {
      ...proposals,
      context,
    };
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
  runCodexCurateProposals()
    .then((payload) => {
      process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
    })
    .catch((error) => {
      process.stderr.write(`${String(error?.stack || error?.message || error)}\n`);
      process.exit(1);
    });
}
