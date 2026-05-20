#!/usr/bin/env node

import { pathToFileURL } from 'node:url';
import { readFile } from 'node:fs/promises';

import {
  releaseCodexSourceCodeRepairLock,
  runCodexSourceCodeRepair,
} from './_shared/codex-source-code-repair.mjs';

function getArg(argv, flag) {
  const index = argv.indexOf(flag);
  return index >= 0 ? argv[index + 1] : '';
}

async function main(argv = process.argv.slice(2)) {
  const requestPath = getArg(argv, '--request');
  const lockPath = getArg(argv, '--lock');
  if (!requestPath) {
    throw new Error('missing --request <path>');
  }

  try {
    const request = JSON.parse(await readFile(requestPath, 'utf8'));
    const result = await runCodexSourceCodeRepair(request);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } finally {
    await releaseCodexSourceCodeRepairLock(lockPath);
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
  main().catch((error) => {
    process.stderr.write(`${String(error?.stack || error?.message || error)}\n`);
    process.exit(1);
  });
}
