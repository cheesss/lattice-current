import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildReportBackfillClosureLedger,
} from '../scripts/_shared/report-backfill-closure.mjs';

test('decision-grade market validation does not override open issuer exposure', () => {
  const ledger = buildReportBackfillClosureLedger({
    artifact: {
      reportId: 'RPT-contradiction-market',
      validation: {
        quality: {
          decisionDiagnostic: { status: 'under_researched' },
        },
      },
      bundle: {
        reportType: 'cross_theme_bottleneck_report',
        subject: { display: 'generated bottleneck' },
        evidenceContractMatrix: [
          { evidenceClass: 'issuer_exposure', status: 'missing' },
          { evidenceClass: 'market_validation', status: 'missing' },
        ],
      },
    },
    marketValidation: {
      tier: 'decision_grade',
      evidenceUse: 'promotion_candidate',
      regimeConsistency: 0.7,
    },
  });

  assert.equal(ledger.marketTier, 'decision_grade');
  assert.equal(ledger.openClasses.includes('issuer_exposure'), true);
  assert.equal(ledger.visualStatus, 'blocked');
  assert.notEqual(ledger.visualStatus, 'review-ready');
  assert.equal(ledger.evidenceState, 'targeted_backfill_required');
});

test('blocked closure keeps evidence product tier secondary to operating status', () => {
  const ledger = buildReportBackfillClosureLedger({
    artifact: {
      reportId: 'RPT-blocked-evidence-tier',
      validation: {
        quality: {
          productTier: 'evidence_backed_bottleneck_candidate',
          crossThemeDiscoveryQuality: {
            tier: 'evidence_backed_bottleneck_candidate',
            label: 'Evidence-supported bottleneck candidate',
          },
          decisionDiagnostic: {
            status: 'under_researched',
            missingEvidenceClasses: ['issuer_exposure'],
          },
        },
      },
      bundle: {
        reportType: 'cross_theme_bottleneck_report',
        subject: { display: 'generated bottleneck' },
        evidenceContractMatrix: [
          { evidenceClass: 'issuer_exposure', status: 'missing' },
        ],
      },
    },
  });

  assert.equal(ledger.visualStatus, 'blocked');
  assert.equal(ledger.productTier, 'evidence_backed_bottleneck_candidate');
  assert.equal(ledger.productTierRole, 'evidence_tier');
  assert.equal(ledger.productTierLabel, 'Evidence-supported research candidate');
  assert.equal(ledger.productTierPrimary, false);
});

test('review-ready artifact with critical missing evidence records contradiction and is not visually ready', () => {
  const ledger = buildReportBackfillClosureLedger({
    artifact: {
      reportId: 'RPT-review-ready-conflict',
      validation: {
        quality: {
          decisionDiagnostic: { status: 'decision_ready_review' },
        },
      },
      bundle: {
        reportType: 'cross_theme_bottleneck_report',
        subject: { display: 'generated bottleneck' },
        evidenceContractMatrix: [
          { evidenceClass: 'issuer_exposure', status: 'missing' },
          { evidenceClass: 'market_validation', status: 'promotion_collected' },
        ],
      },
    },
  });

  assert.notEqual(ledger.visualStatus, 'review-ready');
  assert.equal(ledger.contradictions.some((item) => item.code === 'REVIEW_READY_WITH_CRITICAL_EVIDENCE_MISSING'), true);
});

test('closure summary surfaces decision-grade market zero-regime warning', () => {
  const ledger = buildReportBackfillClosureLedger({
    artifact: {
      reportId: 'RPT-zero-regime',
      bundle: {
        reportType: 'cross_theme_bottleneck_report',
        subject: { display: 'market validated bottleneck' },
        evidenceContractMatrix: [],
      },
    },
    marketValidation: {
      tier: 'decision_grade',
      evidenceUse: 'promotion_candidate',
      regimeConsistency: 0,
    },
  });

  assert.equal(ledger.contradictions.some((item) => item.code === 'DECISION_GRADE_MARKET_WITH_ZERO_REGIME_SUPPORT'), true);
});

test('raw discovery coverage is not treated as accepted coverage when matrix keeps class missing', () => {
  const ledger = buildReportBackfillClosureLedger({
    artifact: {
      reportId: 'RPT-reconciled-coverage',
      validation: {
        quality: {
          productTier: 'evidence_backed_bottleneck_candidate',
          crossThemeDiscoveryQuality: {
            metrics: { evidenceClassesCovered: ['issuer_exposure'] },
          },
          decisionDiagnostic: {
            status: 'under_researched',
            missingEvidenceClasses: ['issuer_exposure'],
            coveredEvidenceClasses: [],
            coverageReconciliation: {
              rawCoveredEvidenceClasses: ['issuer_exposure'],
              acceptedCoveredEvidenceClasses: [],
              demotedCoveredEvidenceClasses: ['issuer_exposure'],
            },
          },
        },
      },
      bundle: {
        reportType: 'cross_theme_bottleneck_report',
        subject: { display: 'grid-like bottleneck' },
        evidenceContractMatrix: [
          { evidenceClass: 'issuer_exposure', status: 'missing' },
        ],
      },
    },
  });

  assert.equal(ledger.openClasses.includes('issuer_exposure'), true);
  assert.equal(
    ledger.contradictions.some((item) => item.code === 'EVIDENCE_CLASS_COVERED_BUT_MATRIX_MISSING'),
    false,
  );
  assert.match(ledger.primaryBlocker, /market_validation missing|open evidence class: issuer_exposure/);
});

test('pre-reconciliation artifacts are marked stale and cannot remain visually review-ready', () => {
  const ledger = buildReportBackfillClosureLedger({
    artifact: {
      reportId: 'RPT-pre-reconciliation',
      validation: {
        quality: {
          productTier: 'evidence_backed_bottleneck_candidate',
          crossThemeDiscoveryQuality: {
            tier: 'evidence_backed_bottleneck_candidate',
            metrics: { evidenceClassesCovered: ['issuer_exposure', 'market_validation'] },
          },
          decisionDiagnostic: {
            status: 'decision_ready_review',
            coveredEvidenceClasses: ['issuer_exposure', 'market_validation'],
          },
        },
      },
      bundle: {
        reportType: 'cross_theme_bottleneck_report',
        subject: { display: 'legacy bottleneck' },
        evidenceContractMatrix: [],
      },
    },
    marketValidation: {
      tier: 'decision_grade',
      evidenceUse: 'promotion_candidate',
      regimeConsistency: 0.8,
    },
  });

  assert.equal(ledger.artifactSchemaStatus, 'pre_reconciliation');
  assert.equal(ledger.artifactSchemaWarning?.code, 'PRE_RECONCILIATION_ARTIFACT');
  assert.equal(ledger.visualStatus, 'blocked');
  assert.equal(ledger.productTierPrimary, false);
  assert.equal(ledger.primaryBlocker, 'pre_reconciliation_schema');
});
