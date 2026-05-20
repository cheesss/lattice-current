import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

import { REPORT_TYPES, buildSampleReportBundle } from '../scripts/_shared/report-evidence-bundle.mjs';
import { planReportFigures } from '../scripts/_shared/report-chart-planner.mjs';
import { generateDeterministicAnalystDraft } from '../scripts/_shared/report-llm-analyst.mjs';
import { validateReportBundle } from '../scripts/_shared/report-validator.mjs';

test('all report types produce S-grade artifacts, while final grade is capped by analysis/data depth', () => {
  for (const type of Object.values(REPORT_TYPES)) {
    const bundle = planReportFigures(buildSampleReportBundle(type, { subject: `Sample ${type}` }));
    const analysis = generateDeterministicAnalystDraft(bundle);
    const validation = validateReportBundle(bundle, { analysis });
    assert.equal(validation.ok, true, `${type}: ${JSON.stringify(validation.blockers)}`);
    assert.equal(validation.quality.artifactGrade, 'S', `${type} should meet S artifact quality`);
    assert.equal(['S', 'A', 'B', 'C'].includes(validation.quality.grade), true, `${type} should receive a truthful final quality grade`);
    assert.ok(validation.quality.triageUsefulness?.grade, `${type} should expose triage usefulness separately`);
    assert.ok(validation.quality.analystMemoQuality?.grade, `${type} should expose analyst memo quality separately`);
    assert.ok(validation.quality.investmentReadinessQuality?.grade, `${type} should expose investment readiness separately`);
    assert.equal(validation.quality.metrics.analysis_sectionCompleteness, 1, `${type} should include all analyst sections`);
    assert.equal(bundle.claims.every((claim) => claim.supportingFigureIds.length > 0), true, `${type} claims should be linked to figures`);
  }
});

test('validator blocks overconfident validated language for candidate-only claims', () => {
  const bundle = planReportFigures(buildSampleReportBundle(REPORT_TYPES.CROSS_THEME));
  const validation = validateReportBundle(bundle, {
    analysis: {
      keyJudgments: [{
        text: 'This connector is validated signal for canonical promotion.',
        claimIds: ['CLM-001'],
        metricIds: ['MET-XTC-SCORE'],
      }],
    },
  });
  assert.equal(validation.ok, false);
  assert.equal(validation.blockers.some((blocker) => blocker.type === 'overstated_validation_status'), true);
});

test('validator requires rendered figure assets when publish validation asks for them', () => {
  const bundle = planReportFigures(buildSampleReportBundle(REPORT_TYPES.THEME));
  const analysis = generateDeterministicAnalystDraft(bundle);
  const validation = validateReportBundle(bundle, { analysis, requireRenderedFigures: true });
  assert.equal(validation.ok, false);
  assert.equal(validation.blockers.some((blocker) => blocker.type === 'figure_without_render_asset'), true);
});

test('CLI manifest includes hashes, figures, and artifact-only source query drafts', async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'lattice-report-s-tier-'));
  try {
    const result = spawnSync(process.execPath, [
      'scripts/generate-intelligence-report.mjs',
      '--sample',
      '--type',
      'cross_theme_bottleneck_report',
      '--subject',
      'Linde cryogenic cooling',
      '--out-dir',
      tmp,
    ], {
      cwd: path.resolve('.'),
      encoding: 'utf8',
    });
    assert.equal(result.status, 0, result.stderr);
    const manifest = JSON.parse(await readFile(path.join(tmp, 'manifest.json'), 'utf8'));
    const sourceQueries = JSON.parse(await readFile(path.join(tmp, 'source-query-drafts.json'), 'utf8'));
    assert.equal(manifest.quality.artifactGrade, 'S');
    assert.equal(manifest.quality.grade !== 'S', true, 'Weak cross-theme sample should not be mislabeled final S quality');
    assert.equal(manifest.figures.length > 0, true);
    assert.equal(Object.keys(manifest.artifactHashes).includes('html'), true);
    assert.equal(manifest.narrative_structure_provider, 'deterministic_fallback');
    assert.equal(manifest.narrative_archetype, 'cross_theme_bottleneck');
    assert.equal(manifest.section_role_coverage, 1);
    assert.equal(manifest.sourceQueries.count, sourceQueries.length);
    assert.equal(sourceQueries.every((query) => query.boundary.includes('artifact-only')), true);
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});
