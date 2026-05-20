#!/usr/bin/env node

import path from 'node:path';
import {
  exportReportArtifacts,
  loadReportArtifacts,
} from './_shared/report-exporter.mjs';

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

async function main() {
  const args = parseArgs();
  const reportDir = args.reportDir || args['report-dir'];
  if (!reportDir) {
    throw new Error('Usage: node scripts/export-intelligence-report.mjs --report-dir <data/reports/<reportId>> [--pdf]');
  }
  const resolvedReportDir = path.resolve(reportDir);
  const { bundle, analysis, validation } = await loadReportArtifacts(resolvedReportDir);
  const exports = await exportReportArtifacts({
    bundle,
    analysis,
    validation,
    reportDir: resolvedReportDir,
    pdf: Boolean(args.pdf),
  });
  console.log(JSON.stringify({
    ok: !exports.pdfError,
    reportId: bundle.reportId,
    reportDir: resolvedReportDir,
    printHtml: path.resolve(exports.printHtmlPath),
    pptx: path.resolve(exports.pptxPath),
    deckManifest: path.resolve(exports.deckManifestPath),
    pdf: exports.pdfPath ? path.resolve(exports.pdfPath) : null,
    pdfError: exports.pdfError,
  }, null, 2));
  if (exports.pdfError && args.failOnPdfError) process.exitCode = 2;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
