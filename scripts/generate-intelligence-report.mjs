#!/usr/bin/env node

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { buildBundleFromPayload } from './build-report-bundle.mjs';
import { buildDbReportBundle, withReportDbClient } from './_shared/report-db-adapter.mjs';
import { generateReportAnalystDraft } from './_shared/report-llm-analyst.mjs';
import {
  attachDeepResearchPack,
  enqueueReportSourceQueryDrafts,
} from './_shared/report-deep-research-pack.mjs';
import { planReportFigures } from './_shared/report-chart-planner.mjs';
import {
  writeReportArtifactsToStore,
  writeReportIndex,
} from './_shared/report-local-store.mjs';

function parseArgs(argv = process.argv.slice(2)) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) continue;
    const eqIdx = arg.indexOf('=');
    if (eqIdx !== -1) {
      /* --key=value form */
      args[arg.slice(2, eqIdx)] = arg.slice(eqIdx + 1);
      continue;
    }
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

async function loadPayload(filePath) {
  if (!filePath) return {};
  return JSON.parse(await readFile(filePath, 'utf8'));
}

async function main() {
  const args = parseArgs();
  const payload = await loadPayload(args.input);
  const useDb = Boolean(args.db || args.live || payload.db || payload.live || payload.source === 'db');
  /* P1: subject fidelity is strict by default. Pass --allowFallback to opt back
   * into the legacy "pick the top-ranked candidate when no match" behavior.
   * Coerce string values; --allowFallback alone (no value) becomes true. */
  const allowFallback = (args.allowFallback === true || args.allowFallback === 'true' || args['allow-fallback'] === true || args['allow-fallback'] === 'true');
  const adapterInput = { ...payload, ...args, allowFallback };
  const explicitOutDir = args.outDir || args['out-dir'] || null;
  const reportRoot = args.reportRoot || args['report-root'] || (explicitOutDir ? path.dirname(path.resolve(explicitOutDir)) : path.join('data', 'reports'));
  const shouldEnqueueDbBackfill = !(
    args.noEnqueueBackfill === true
    || args.noEnqueueBackfill === 'true'
    || args['no-enqueue-backfill'] === true
    || args['no-enqueue-backfill'] === 'true'
    || args.enqueueBackfill === 'false'
    || args['enqueue-backfill'] === 'false'
  );

  let dbBackfillQueue = null;
  const result = useDb
    ? await withReportDbClient(async (client) => {
      const bundle = await buildDbReportBundle(client, adapterInput);
      const analysis = await generateReportAnalystDraft(bundle, { provider: args.provider || 'deterministic' });
      const written = await writeReportArtifactsToStore({
        bundle,
        analysis,
        reportRoot,
        outDir: explicitOutDir,
      });
      if (shouldEnqueueDbBackfill) {
        dbBackfillQueue = await enqueueReportSourceQueryDrafts(client, written.bundle, written.sourceQueryDrafts, {
          ensureSchema: adapterInput.ensureResearchSchema !== false,
        }).catch((error) => ({
          ok: false,
          reason: String(error?.message || error),
          inspectedCount: written.sourceQueryDrafts?.length || 0,
          insertedCount: 0,
          dedupedCount: 0,
          failedCount: written.sourceQueryDrafts?.length || 0,
        }));
      }
      return written;
    })
    : await (async () => {
      let bundle = buildBundleFromPayload(payload, args);
      if (args.depth === 'deep') {
        bundle = planReportFigures(await attachDeepResearchPack(bundle));
      }
      const analysis = await generateReportAnalystDraft(bundle, { provider: args.provider || 'deterministic' });
      return writeReportArtifactsToStore({
        bundle,
        analysis,
        reportRoot,
        outDir: explicitOutDir,
      });
    })();
  const index = await writeReportIndex(reportRoot);

  console.log(JSON.stringify({
    ok: result.validation.status !== 'blocked',
    reportId: result.bundle.reportId,
    reportDir: path.resolve(result.reportDir),
    validationStatus: result.validation.status,
    quality: result.validation.quality,
    html: path.resolve(result.reportDir, 'report.html'),
    registry: path.resolve(reportRoot, '_registry.jsonl'),
    sourceQueue: path.resolve(reportRoot, '_source-query-queue.jsonl'),
    dbBackfillQueue,
    index: path.resolve(index.indexPath),
  }, null, 2));
  if (result.validation.status === 'blocked' && args.failOnBlocked) {
    process.exitCode = 2;
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
