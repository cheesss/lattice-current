#!/usr/bin/env node

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { REPORT_TYPES, buildSampleReportBundle } from './_shared/report-evidence-bundle.mjs';
import { planReportFigures } from './_shared/report-chart-planner.mjs';
import { attachDeepResearchPack } from './_shared/report-deep-research-pack.mjs';
import { generateReportAnalystDraft } from './_shared/report-llm-analyst.mjs';
import {
  writeReportArtifactsToStore,
  writeReportIndex,
} from './_shared/report-local-store.mjs';
import { runDrainReportBackfillTasks } from './drain-report-backfill-tasks.mjs';

function parseArgs(argv = process.argv.slice(2)) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) continue;
    const eqIdx = arg.indexOf('=');
    if (eqIdx !== -1) {
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

async function main() {
  const args = parseArgs();
  const outDir = args.outDir || args['out-dir'] || path.join('data', 'reports', '_scheduled');
  const reportRoot = args.reportRoot || args['report-root'] || path.join('data', 'reports');
  await mkdir(outDir, { recursive: true });
  const schedule = {
    generatedAt: new Date().toISOString(),
    status: 'draft_schedule_only',
    publishPolicy: 'never_auto_publish',
    jobs: [
      { reportType: 'theme_report', cadence: 'weekly', subjectSource: 'followed_themes', status: 'draft_only' },
      { reportType: 'cross_theme_bottleneck_report', cadence: 'weekly', subjectSource: 'cross_theme_candidates', status: 'draft_only' },
      { reportType: 'system_quality_report', cadence: 'daily', subjectSource: 'ops_status', status: 'draft_only' },
      { reportType: 'event_signal_report', cadence: 'daily', subjectSource: 'validated_event_signals', status: 'draft_only' },
      { reportType: 'regime_transmission_report', cadence: 'daily', subjectSource: 'regime_snapshot', status: 'draft_only' },
      { reportType: 'symbol_signal_report', cadence: 'daily', subjectSource: 'tracked_symbols', status: 'draft_only' },
    ],
    guardrails: [
      'scheduled reports are drafts until validation passes',
      'stale dependencies create degraded or blocked reports',
      'canonical promotion remains review-gated',
      'LLM providers remain disabled unless policy and budget are configured',
      'report deep-research gaps are queued to review-gated source-query approvals before any execution',
    ],
    automation: {
      reportBackfillDrain: {
        task: 'report-backfill-drain',
        script: 'scripts/drain-report-backfill-tasks.mjs --apply',
        cadence: '2h daemon / on-demand scheduler',
        boundary: 'queues approval_queue/source-query only; canonical mutation remains review-gated',
      },
    },
  };
  const filePath = path.join(outDir, 'schedule-manifest.json');
  await writeFile(filePath, `${JSON.stringify(schedule, null, 2)}\n`, 'utf8');
  const generatedReports = [];
  if (args.generateSamples || args['generate-samples']) {
    for (const reportType of Object.values(REPORT_TYPES)) {
      const bundle = planReportFigures(await attachDeepResearchPack(
        buildSampleReportBundle(reportType, { subject: `Scheduled sample ${reportType}` }),
      ));
      const analysis = await generateReportAnalystDraft(bundle, { provider: 'deterministic' });
      const result = await writeReportArtifactsToStore({ bundle, analysis, reportRoot });
      generatedReports.push({
        reportId: result.bundle.reportId,
        reportType,
        validationStatus: result.validation.status,
        quality: result.validation.quality,
        reportDir: path.resolve(result.reportDir),
      });
    }
    await writeReportIndex(reportRoot);
  }
  let backfillDrain = null;
  if (args.drainBackfill || args['drain-backfill']) {
    backfillDrain = await runDrainReportBackfillTasks({
      dryRun: !args.apply && !args['apply-backfill'],
      limit: args.backfillLimit || args['backfill-limit'],
      maxAttempts: args.backfillMaxAttempts || args['backfill-max-attempts'],
      staleHours: args.backfillStaleHours || args['backfill-stale-hours'],
    }).catch((error) => ({
      ok: false,
      error: String(error?.message || error),
      dryRun: !args.apply && !args['apply-backfill'],
    }));
  }
  console.log(JSON.stringify({
    ok: true,
    schedule: path.resolve(filePath),
    dryRun: !args.apply,
    generatedReports,
    backfillDrain,
    reportIndex: path.resolve(reportRoot, 'index.html'),
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
