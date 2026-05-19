#!/usr/bin/env node

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { validateReportBundle } from './_shared/report-validator.mjs';

function parseArgs(argv = process.argv.slice(2)) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) continue;
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) args[key] = true;
    else {
      args[key] = next;
      i += 1;
    }
  }
  return args;
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, 'utf8'));
}

async function main() {
  const args = parseArgs();
  if (!args.bundle) throw new Error('Usage: node scripts/validate-intelligence-report.mjs --bundle <bundle.json> [--analysis analysis.json] [--output validation.json]');
  const bundle = await readJson(args.bundle);
  const analysis = args.analysis ? await readJson(args.analysis) : null;
  const validation = validateReportBundle(bundle, { analysis, requireRenderedFigures: Boolean(args.requireRenderedFigures || args['require-rendered-figures']) });
  const json = JSON.stringify(validation, null, 2);
  if (args.output) {
    await mkdir(path.dirname(args.output), { recursive: true });
    await writeFile(args.output, `${json}\n`, 'utf8');
  } else {
    console.log(json);
  }
  if (validation.status === 'blocked' && args.failOnBlocked) {
    process.exitCode = 2;
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
