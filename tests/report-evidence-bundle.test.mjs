import assert from 'node:assert/strict';
import test from 'node:test';

import {
  REPORT_TYPES,
  buildCrossThemeBottleneckReportBundle,
  buildSampleReportBundle,
  buildThemeReportBundle,
  createEvidenceBundle,
} from '../scripts/_shared/report-evidence-bundle.mjs';
import { planReportFigures } from '../scripts/_shared/report-chart-planner.mjs';

test('theme report bundle adds baseline caveat and deterministic claim links', () => {
  const bundle = buildThemeReportBundle({
    theme: {
      key: 'cloud-infrastructure',
      label: 'Cloud Infrastructure',
      yoy: 100,
      acceleration: -843.68,
      sourceDiversity: 0.61,
    },
    dataFreshness: [{ dataset: 'theme_trend_aggregates', freshnessStatus: 'fresh' }],
  });
  assert.equal(bundle.reportType, REPORT_TYPES.THEME);
  assert.equal(bundle.subject.subjectId, 'cloud-infrastructure');
  assert.equal(bundle.metrics.some((metric) => metric.metricId === 'MET-THEME-ACCELERATION'), true);
  assert.equal(bundle.caveats.some((caveat) => caveat.type === 'baseline_distortion'), true);
  assert.equal(bundle.claims[0].supportingMetricIds.includes('MET-THEME-ACCELERATION'), true);
});

test('cross-theme bottleneck bundle preserves candidate boundary and seed lock-in caveat', () => {
  const bundle = buildCrossThemeBottleneckReportBundle({
    candidate: {
      id: 'linde-space-fusion',
      name: 'Linde',
      themes: ['space', 'fusion-energy'],
      score: 0.88,
      evidenceScore: 0.42,
      seedSimilarity: 0.4,
      lane: 'needs_evidence',
    },
  });
  assert.equal(bundle.reportType, REPORT_TYPES.CROSS_THEME);
  assert.equal(bundle.subject.subjectType, 'cross_theme_candidate');
  assert.equal(bundle.caveats.some((caveat) => caveat.type === 'seed_lock_in'), true);
  assert.equal(bundle.caveats.some((caveat) => caveat.type === 'pending_validation'), true);
  assert.equal(bundle.watchIndicators.some((watch) => watch.source === 'source-query'), true);
});

test('createEvidenceBundle auto-discloses stale and low source diversity', () => {
  const bundle = createEvidenceBundle({
    reportType: REPORT_TYPES.EVENT_SIGNAL,
    subject: { subjectId: 'event-1', displayName: 'Event 1' },
    dataFreshness: [{ dataset: 'event_uplift', freshnessStatus: 'stale' }],
    sourceSummary: { lowDiversityFlag: true },
    metrics: [{ metricId: 'MET-001', name: 'uplift', value: 1.2 }],
    claims: [{ claimId: 'CLM-001', canonicalText: 'Event needs review.', supportingMetricIds: ['MET-001'] }],
  });
  assert.equal(bundle.caveats.some((caveat) => caveat.type === 'stale_data'), true);
  assert.equal(bundle.caveats.some((caveat) => caveat.type === 'source_diversity'), true);
});

test('chart planner attaches claim-bound report figures by type', () => {
  const bundle = planReportFigures(buildSampleReportBundle(REPORT_TYPES.CROSS_THEME));
  assert.equal(bundle.figures.some((figure) => figure.figureId === 'FIG-XTC-GRAPH'), true);
  assert.equal(bundle.figures.every((figure) => figure.supportedClaimIds.length > 0), true);
  assert.equal(bundle.figures.every((figure) => figure.dataAsOf), true);
});
