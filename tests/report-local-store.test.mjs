import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { REPORT_TYPES, buildSampleReportBundle } from '../scripts/_shared/report-evidence-bundle.mjs';
import { planReportFigures } from '../scripts/_shared/report-chart-planner.mjs';
import { generateDeterministicAnalystDraft } from '../scripts/_shared/report-llm-analyst.mjs';
import {
  listReportRegistry,
  listSourceQueryQueue,
  writeReportArtifactsToStore,
  writeReportIndex,
} from '../scripts/_shared/report-local-store.mjs';

test('local report store writes registry, index, and source-query queue without DB', async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'lattice-report-store-'));
  try {
    const reportRoot = path.join(tmp, 'reports');
    const bundle = planReportFigures(buildSampleReportBundle(REPORT_TYPES.CROSS_THEME, { subject: 'Linde cryogenic cooling' }));
    const analysis = generateDeterministicAnalystDraft(bundle);
    analysis.sourceQueries.unshift({
      text: 'Collect KPI Helium supply proxy: Linde helium supply industry evidence',
      reason: 'No fresh generic KPI observation is available for Helium supply proxy.',
      claimIds: ['CLM-001'],
      evidenceIds: [],
      metricIds: [],
      figureIds: [],
      caveatIds: [],
      approvalRequired: true,
      metadata: {
        gapKind: 'theme_kpi',
        themeId: 'space-economy',
        kpiKey: 'helium_supply_proxy',
        dataPack: 'industryPack',
      },
    });
    const result = await writeReportArtifactsToStore({ bundle, analysis, reportRoot });
    const reports = await listReportRegistry(reportRoot);
    const queue = await listSourceQueryQueue(reportRoot);
    const index = await writeReportIndex(reportRoot);
    const drafts = JSON.parse(await readFile(path.join(result.reportDir, 'source-query-drafts.json'), 'utf8'));

    assert.equal(result.validation.quality.artifactGrade, 'S');
    assert.equal(result.validation.quality.grade !== 'S', true);
    assert.equal(reports.length, 1);
    assert.equal(reports[0].reportId, result.bundle.reportId);
    assert.equal(queue.length > 0, true);
    assert.equal(queue.every((item) => item.queueStatus === 'pending_review'), true);
    assert.equal(drafts[0].metadata.gapKind, 'theme_kpi');
    assert.equal(drafts[0].metadata.kpiKey, 'helium_supply_proxy');
    const indexHtml = await readFile(index.indexPath, 'utf8');
    assert.match(indexHtml, /Lattice Report Registry/);
    assert.match(indexHtml, /Linde cryogenic cooling/);
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});

test('schedule script can generate all offline sample reports into local registry', async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'lattice-report-schedule-'));
  try {
    const result = spawnSync(process.execPath, [
      'scripts/schedule-intelligence-reports.mjs',
      '--generate-samples',
      '--report-root',
      path.join(tmp, 'reports'),
      '--out-dir',
      path.join(tmp, 'schedule'),
    ], {
      cwd: path.resolve('.'),
      encoding: 'utf8',
    });
    assert.equal(result.status, 0, result.stderr);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.generatedReports.length, Object.values(REPORT_TYPES).length);
    assert.equal(payload.generatedReports.every((item) => item.quality.publishable === false), true);
    assert.equal(payload.generatedReports.every((item) => item.quality.publishabilityReasons.length > 0), true);
    assert.equal(payload.generatedReports.some((item) => item.quality.grade !== 'S'), true);
    const reports = await listReportRegistry(path.join(tmp, 'reports'));
    assert.equal(reports.length, Object.values(REPORT_TYPES).length);
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});
