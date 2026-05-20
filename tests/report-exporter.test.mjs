import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { REPORT_TYPES, buildSampleReportBundle } from '../scripts/_shared/report-evidence-bundle.mjs';
import { planReportFigures } from '../scripts/_shared/report-chart-planner.mjs';
import { generateDeterministicAnalystDraft } from '../scripts/_shared/report-llm-analyst.mjs';
import { writeReportArtifactsToStore } from '../scripts/_shared/report-local-store.mjs';
import { exportReportArtifacts } from '../scripts/_shared/report-exporter.mjs';

test('report exporter writes print HTML and a real pptx artifact without DB', async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'lattice-report-export-'));
  try {
    const bundle = planReportFigures(buildSampleReportBundle(REPORT_TYPES.EVENT_SIGNAL));
    const analysis = generateDeterministicAnalystDraft(bundle);
    const stored = await writeReportArtifactsToStore({ bundle, analysis, reportRoot: tmp });
    const exported = await exportReportArtifacts({
      bundle: stored.bundle,
      analysis,
      validation: stored.validation,
      reportDir: stored.reportDir,
      pdf: false,
    });
    const printHtml = await readFile(exported.printHtmlPath, 'utf8');
    const pptxStat = await stat(exported.pptxPath);
    const deckManifest = JSON.parse(await readFile(exported.deckManifestPath, 'utf8'));
    assert.match(printHtml, /@media print/);
    assert.equal(pptxStat.size > 1000, true);
    assert.equal(deckManifest.slideCount >= 4, true);
    assert.equal(exported.pptxPath.endsWith('.pptx'), true);
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});
