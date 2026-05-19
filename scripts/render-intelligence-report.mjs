#!/usr/bin/env node

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { renderReportHtml, renderReportMarkdown } from './_shared/report-compiler.mjs';
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
  if (!args.bundle) throw new Error('Usage: node scripts/render-intelligence-report.mjs --bundle <bundle.json> [--analysis analysis.json] [--html report.html] [--md report.md]');
  const bundle = await readJson(args.bundle);
  const analysis = args.analysis ? await readJson(args.analysis) : null;
  const validation = args.validation ? await readJson(args.validation) : validateReportBundle(bundle, { analysis });
  const html = renderReportHtml(bundle, { analysis, validation });
  const md = renderReportMarkdown(bundle, { analysis, validation });
  if (args.html) {
    await mkdir(path.dirname(args.html), { recursive: true });
    await writeFile(args.html, html, 'utf8');
  }
  if (args.md) {
    await mkdir(path.dirname(args.md), { recursive: true });
    await writeFile(args.md, md, 'utf8');
  }
  if (!args.html && !args.md) {
    console.log(html);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
