#!/usr/bin/env node

import path from 'node:path';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import {
  loadFinalInvestmentDryRun,
  writeValidatedCrossThemeFinalReport,
  writePolishedFinalInvestmentReport,
} from './_shared/final-investment-report-polished-exporter.mjs';

function parseArgs(argv = process.argv.slice(2)) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith('--')) continue;
    const key = arg.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith('--')) args[key] = true;
    else {
      args[key] = next;
      index += 1;
    }
  }
  return args;
}

async function main() {
  const args = parseArgs();
  const input = args.input || args['dry-run'] || path.join('data', 'runtime', 'final-investment-report-dry-run.latest.json');
  const marketRegimePath = args.marketRegimeSupport || args['market-regime-support'] || path.join('data', 'runtime', 'market-validation-regime-support.latest.json');
  const repairLoopPath = args.repairLoop || args['repair-loop'] || path.join('data', 'runtime', 'autonomous-research-repair-loop.latest.json');
  const reportRoot = args.reportRoot || args['report-root'] || path.join('data', 'reports');
  const outDir = args.outDir || args['out-dir'] || null;
  const report = await loadFinalInvestmentDryRun(input);
  if (marketRegimePath && existsSync(marketRegimePath)) {
    report.marketRegimeSupport = JSON.parse(await readFile(marketRegimePath, 'utf8'));
  }
  if (repairLoopPath && existsSync(repairLoopPath)) {
    report.repairLoop = JSON.parse(await readFile(repairLoopPath, 'utf8'));
  }
  const writeReport = args.crossTheme || args['cross-theme'] || args.reportStyle === 'cross-theme' || args['report-style'] === 'cross-theme'
    ? writeValidatedCrossThemeFinalReport
    : writePolishedFinalInvestmentReport;
  const result = await writeReport({
    report,
    reportRoot,
    outDir,
  });
  process.stdout.write(`${JSON.stringify({
    ok: true,
    input: path.resolve(input),
    reportRoot: path.resolve(reportRoot),
    ...result,
  }, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exit(1);
});
