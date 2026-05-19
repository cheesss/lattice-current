#!/usr/bin/env node

import path from 'node:path';
import {
  listReportRegistry,
  listSourceQueryQueue,
  writeReportIndex,
} from './_shared/report-local-store.mjs';

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
  const reportRoot = args.reportRoot || args['report-root'] || path.join('data', 'reports');
  const reports = await listReportRegistry(reportRoot, { limit: args.limit || 50 });
  const sourceQueue = await listSourceQueryQueue(reportRoot, { limit: args.queueLimit || args['queue-limit'] || 100 });
  const index = await writeReportIndex(reportRoot);
  console.log(JSON.stringify({
    ok: true,
    reportRoot: path.resolve(reportRoot),
    index: path.resolve(index.indexPath),
    reportCount: reports.length,
    sourceQueueCount: sourceQueue.length,
    reports,
    sourceQueue,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
