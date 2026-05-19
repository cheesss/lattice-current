import assert from 'node:assert/strict';
import test from 'node:test';

import {
  detectReportReadinessContradictions,
} from '../scripts/_shared/report-contradiction-detector.mjs';

function codes(issues) {
  return issues.map((issue) => issue.code);
}

test('review-ready with critical evidence missing creates contradiction', () => {
  const issues = detectReportReadinessContradictions({
    summary: { visualStatus: 'review-ready', openClasses: ['issuer_exposure'] },
    matrix: [{ evidenceClass: 'issuer_exposure', status: 'missing' }],
  });

  assert.ok(codes(issues).includes('REVIEW_READY_WITH_CRITICAL_EVIDENCE_MISSING'));
  assert.equal(issues.find((issue) => issue.code === 'REVIEW_READY_WITH_CRITICAL_EVIDENCE_MISSING').blocker, true);
});

test('investment memo candidate with non-ready actionability creates contradiction', () => {
  const issues = detectReportReadinessContradictions({
    quality: { productTier: 'investment_memo_candidate' },
    actionability: { tier: 'issuer_follow_up_ready' },
  });

  assert.ok(codes(issues).includes('INVESTMENT_MEMO_WITH_ACTIONABILITY_NOT_READY'));
});

test('decision-grade market validation with zero regime support creates warning', () => {
  const issues = detectReportReadinessContradictions({
    marketValidation: { tier: 'decision_grade', regimeConsistency: 0 },
  });
  const issue = issues.find((item) => item.code === 'DECISION_GRADE_MARKET_WITH_ZERO_REGIME_SUPPORT');

  assert.ok(issue);
  assert.equal(issue.severity, 'warning');
  assert.equal(issue.blocker, false);
});

test('issuer exposure attached while issuer bridge needs follow-up creates contradiction', () => {
  const issues = detectReportReadinessContradictions({
    matrix: [{ evidenceClass: 'issuer_exposure', status: 'promotion_collected' }],
    issuerBridge: { status: 'issuer_exposure_attached', followUpRequired: true },
  });

  assert.ok(codes(issues).includes('ISSUER_EXPOSURE_ATTACHED_BUT_BRIDGE_FOLLOWUP_REQUIRED'));
});

test('covered evidence class that is still missing in matrix creates contradiction', () => {
  const issues = detectReportReadinessContradictions({
    summary: { coveredEvidenceClasses: ['market_validation'] },
    matrix: [{ evidenceClass: 'market_validation', status: 'missing' }],
  });

  assert.ok(codes(issues).includes('EVIDENCE_CLASS_COVERED_BUT_MATRIX_MISSING'));
});

test('raw discovery coverage alone does not create covered-vs-missing contradiction', () => {
  const issues = detectReportReadinessContradictions({
    quality: {
      crossThemeDiscoveryQuality: {
        metrics: { evidenceClassesCovered: ['market_validation'] },
      },
      decisionDiagnostic: {
        missingEvidenceClasses: ['market_validation'],
        coveredEvidenceClasses: [],
      },
    },
    matrix: [{ evidenceClass: 'market_validation', status: 'missing' }],
  });

  assert.equal(codes(issues).includes('EVIDENCE_CLASS_COVERED_BUT_MATRIX_MISSING'), false);
});

test('high conviction with low source breadth creates warning', () => {
  const issues = detectReportReadinessContradictions({
    summary: { conviction: 0.82, sourceBreadth: 0.24 },
  });
  const issue = issues.find((item) => item.code === 'HIGH_CONVICTION_WITH_LOW_SOURCE_BREADTH');

  assert.ok(issue);
  assert.equal(issue.severity, 'warning');
});
