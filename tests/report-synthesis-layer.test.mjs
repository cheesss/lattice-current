import assert from 'node:assert/strict';
import test from 'node:test';

import { planReportFigures } from '../scripts/_shared/report-chart-planner.mjs';
import { renderAuditAppendixHtml, renderReportHtml, renderReportMarkdown } from '../scripts/_shared/report-compiler.mjs';
import { buildSampleReportBundle, REPORT_TYPES } from '../scripts/_shared/report-evidence-bundle.mjs';
import { buildEvidenceStrengthSummary } from '../scripts/_shared/report-evidence-strength.mjs';
import { generateDeterministicAnalystDraft } from '../scripts/_shared/report-llm-analyst.mjs';
import { buildMetricCalibrationSummary } from '../scripts/_shared/report-metric-calibration.mjs';
import { buildSignalCards } from '../scripts/_shared/report-signal-cards.mjs';
import { validateReportBundle } from '../scripts/_shared/report-validator.mjs';

test('signal-card synthesis separates client memo from audit appendix', () => {
  const bundle = planReportFigures(buildSampleReportBundle(REPORT_TYPES.CROSS_THEME, {
    subject: 'Linde cryogenic cooling',
  }));
  const analysis = generateDeterministicAnalystDraft(bundle);
  const validation = validateReportBundle(bundle, { analysis });
  const html = renderReportHtml(bundle, { analysis, validation });
  const markdown = renderReportMarkdown(bundle, { analysis, validation });
  const audit = renderAuditAppendixHtml(bundle, { analysis, validation });

  assert.doesNotMatch(html, /<h2>Signal Triage<\/h2>/);
  assert.match(html, /Why This Connector Matters/);
  assert.match(html, /Shared Constraint Map/);
  assert.equal(analysis.narrativeStructure.requiredRoleCoverage, 1);
  assert.doesNotMatch(`${html}\n${markdown}`, /\bevidence-backed\b|\brefs\s+\d+\b|Metric Ledger|Query Manifest|claim:|metric:|evidence:/i);
  assert.match(audit, /Metric Ledger/);
  assert.match(audit, /Signal Cards/);
  assert.match(audit, /Evidence Strength/);
  assert.match(audit, /Metric Calibration/);
  assert.equal(validation.quality.triageUsefulness.grade.length > 0, true);
  assert.equal(validation.quality.analystMemoQuality.grade.length > 0, true);
  assert.equal(validation.quality.investmentReadinessQuality.grade.length > 0, true);
});

test('evidence strength and calibration downgrade weak samples before memo synthesis', () => {
  const bundle = planReportFigures(buildSampleReportBundle(REPORT_TYPES.CROSS_THEME, {
    subject: 'Linde cryogenic cooling',
  }));
  const strength = buildEvidenceStrengthSummary(bundle);
  const calibration = buildMetricCalibrationSummary(bundle);
  const signalCards = buildSignalCards(bundle);

  assert.equal(strength.claims[0].evidenceClass, 'D');
  assert.equal(calibration.metrics.some((metric) => metric.baseline === 'thin_sample'), true);
  assert.equal(signalCards.cards.some((card) => card.domain === 'attention' && card.strength === 'weak'), true);
  assert.equal(signalCards.cards.some((card) => /fundamental/i.test(card.title)), true);
});

test('theme client memo compresses event logs into coverage-pattern language', () => {
  const bundle = planReportFigures(buildSampleReportBundle(REPORT_TYPES.THEME, {
    subject: 'AI / Machine Learning',
  }));
  const analysis = generateDeterministicAnalystDraft(bundle);
  const validation = validateReportBundle(bundle, { analysis });
  const html = renderReportHtml(bundle, { analysis, validation });
  const whatChangedText = (analysis.whatChanged || []).map((item) => item.text).join(' ');

  assert.doesNotMatch(whatChangedText, /\bOn \d{4}-\d{2}-\d{2},\s+"/);
  assert.doesNotMatch(whatChangedText, /\bevent intensity was\s+0\b/i);
  assert.doesNotMatch(html, /\bevidence-backed\b|\bmarket reaction row\(s\) are attached\b|Hawkes-profile analogue\s+\d+/i);
  assert.match(whatChangedText, /coverage|canonical event|subtopic|event sequence/i);
});
