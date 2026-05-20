import assert from 'node:assert/strict';
import test from 'node:test';

import { createEvidenceBundle, buildSampleReportBundle, REPORT_TYPES } from '../scripts/_shared/report-evidence-bundle.mjs';
import { planReportFigures } from '../scripts/_shared/report-chart-planner.mjs';
import { renderReportHtml, renderReportMarkdown } from '../scripts/_shared/report-compiler.mjs';
import { validateReportBundle } from '../scripts/_shared/report-validator.mjs';
import { generateDeterministicAnalystDraft } from '../scripts/_shared/report-llm-analyst.mjs';

function markdownSection(markdown, heading) {
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = markdown.match(new RegExp(`(?:^|\\n)##\\s+${escaped}\\s*\\n([\\s\\S]*?)(?=\\n##\\s+|$)`, 'i'));
  return match ? match[1].trim() : '';
}

function replaceMarkdownSection(markdown, heading, replacement) {
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return markdown.replace(
    new RegExp(`((?:^|\\n)##\\s+${escaped}\\s*\\n)([\\s\\S]*?)(?=\\n##\\s+|$)`, 'i'),
    `$1${replacement}\n`,
  );
}

test('validator passes a planned sample bundle with deterministic analyst draft', () => {
  const bundle = planReportFigures(buildSampleReportBundle(REPORT_TYPES.THEME));
  const analysis = generateDeterministicAnalystDraft(bundle);
  const validation = validateReportBundle(bundle, { analysis });
  assert.equal(validation.ok, true);
  assert.equal(validation.status === 'passed' || validation.status === 'warning', true);
  assert.equal(validation.quality.metrics.evidenceCoverage, 1);
});

test('validator blocks unsupported claims', () => {
  const bundle = createEvidenceBundle({
    reportType: REPORT_TYPES.THEME,
    subject: { subjectId: 'theme-x', displayName: 'Theme X' },
    claims: [{ claimId: 'CLM-001', canonicalText: 'Unsupported claim.' }],
  });
  const validation = validateReportBundle(bundle);
  assert.equal(validation.ok, false);
  assert.equal(validation.blockers.some((blocker) => blocker.type === 'unsupported_claim'), true);
});

test('validator blocks stale data without explicit caveat', () => {
  const bundle = {
    ...createEvidenceBundle({
      reportType: REPORT_TYPES.SYSTEM_QUALITY,
      subject: { subjectId: 'ops', displayName: 'Ops' },
      dataFreshness: [{ dataset: 'market_quotes', freshnessStatus: 'stale' }],
      metrics: [{ metricId: 'MET-001', name: 'age', value: 48 }],
      claims: [{ claimId: 'CLM-001', canonicalText: 'Market quotes are stale.', supportingMetricIds: ['MET-001'] }],
    }),
    caveats: [],
  };
  const validation = validateReportBundle(bundle);
  assert.equal(validation.ok, false);
  assert.equal(validation.blockers.some((blocker) => blocker.type === 'stale_without_caveat'), true);
});

test('validator blocks generated numeric claims that are not in the bundle', () => {
  const bundle = planReportFigures(buildSampleReportBundle(REPORT_TYPES.THEME));
  const analysis = {
    keyJudgments: [{
      text: 'The theme moved 999% and should be watched.',
      claimIds: ['CLM-001'],
      metricIds: ['MET-THEME-YOY'],
    }],
  };
  const validation = validateReportBundle(bundle, { analysis });
  assert.equal(validation.ok, false);
  assert.equal(validation.blockers.some((blocker) => blocker.type === 'unknown_numeric_claim'), true);
});

test('validator blocks investment recommendation language', () => {
  const bundle = planReportFigures(buildSampleReportBundle(REPORT_TYPES.CROSS_THEME));
  const analysis = {
    keyJudgments: [{
      text: 'This evidence means investors should buy LIN.',
      claimIds: ['CLM-001'],
      metricIds: ['MET-XTC-SCORE'],
    }],
  };
  const validation = validateReportBundle(bundle, { analysis });
  assert.equal(validation.ok, false);
  assert.equal(validation.blockers.some((blocker) => blocker.type === 'forbidden_investment_language'), true);
});

test('validator blocks duplicated client memo sections in rendered artifacts', () => {
  const bundle = planReportFigures(buildSampleReportBundle(REPORT_TYPES.THEME, { subject: 'AI / Machine Learning' }));
  const analysis = generateDeterministicAnalystDraft(bundle);
  const baseValidation = validateReportBundle(bundle, { analysis });
  const html = renderReportHtml(bundle, { analysis, validation: baseValidation });
  const markdown = renderReportMarkdown(bundle, { analysis, validation: baseValidation });
  const duplicate = 'Watch for the same external signal. Watch for the same external signal. Watch for the same external signal.';
  const duplicatedMarkdown = `${markdown}\n\n## Watch Next\n${duplicate}\n\n## Research Agenda\n${duplicate}\n`;
  const validation = validateReportBundle(bundle, {
    analysis,
    renderedArtifacts: { html, markdown: duplicatedMarkdown },
  });
  assert.equal(validation.ok, false);
  assert.equal(validation.blockers.some((blocker) => blocker.type === 'duplicate_memo_sections'), true);
});

test('validator blocks client memo mention-budget violations', () => {
  const bundle = planReportFigures(buildSampleReportBundle(REPORT_TYPES.THEME, { subject: 'AI / Machine Learning' }));
  const analysis = generateDeterministicAnalystDraft(bundle);
  const baseValidation = validateReportBundle(bundle, { analysis });
  const html = renderReportHtml(bundle, { analysis, validation: baseValidation });
  const markdown = `${renderReportMarkdown(bundle, { analysis, validation: baseValidation })}\n\n## Extra\n- narrative rotation, not thesis failure\n- narrative rotation, not thesis failure\n`;
  const validation = validateReportBundle(bundle, {
    analysis,
    renderedArtifacts: { html, markdown },
  });
  assert.equal(validation.ok, false);
  assert.equal(validation.blockers.some((blocker) => blocker.type === 'mention_budget_exceeded'), true);
});
