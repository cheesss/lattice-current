import { auditOperatorSeedPhaseCRow } from './operator-seed-phase-c-audit.mjs';
import { summarizeOperatorSeedClosure } from './operator-seed-closure.mjs';
import { buildProviderGapReviewItem } from './provider-gap-proposals.mjs';
import {
  evaluateAutonomousSeedReportCandidateGate,
} from './seed-bias-diagnostics.mjs';

export const OPERATOR_SEED_REVIEW_SURFACE_VERSION = 'operator-seed-review-surface-v1';

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (value === null || value === undefined || value === '') return [];
  return [value];
}

function compact(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function uniqueStrings(values = [], limit = 100) {
  const seen = new Set();
  const out = [];
  for (const value of values.flatMap(asArray)) {
    const text = compact(value);
    if (!text) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(text);
    if (out.length >= limit) break;
  }
  return out;
}

function seedFromRow(row = {}) {
  return row.seed_json || row.seedJson || row;
}

function seedIdForRow(row = {}) {
  return compact(row.seed_id || row.seedId || row.seed_json?.seedId || row.seedJson?.seedId);
}

function evidencePlanFromRow(row = {}) {
  return row.evidence_plan || row.evidencePlan || {};
}

function numberScore(value) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n * 1000) / 1000 : null;
}

function statusVisual(status = '', audit = {}, closure = {}) {
  const normalized = compact(status);
  if (normalized === 'rejected') return 'rejected';
  if (normalized === 'report_candidate' || normalized === 'promoted' || normalized === 'report_generated') return 'review-ready';
  if (audit.phaseCStatus === 'incomplete') return 'blocked';
  if (closure.providerBackfillPlan?.status === 'provider_backfill_exhausted') return 'exhausted';
  if (normalized === 'evidence_running') return 'running';
  if (normalized === 'review_ready') return 'review-ready';
  if (normalized === 'needs_evidence') return 'pending';
  return normalized || 'pending';
}

function primaryBlockerFor(row = {}, audit = {}, closure = {}, providerGapReview = {}) {
  if (audit.missing?.length) return audit.missing[0];
  const negative = closure.negativeControl?.closure || closure.negativeControl?.status || '';
  if (negative === 'invalidator') return 'negative_control_invalidator';
  if (closure.providerBackfillPlan?.status === 'provider_backfill_exhausted') return 'direct_provider_exhausted';
  if (providerGapReview.reviewState === 'adapter_or_source_coverage_review') return 'source_coverage_review';
  const blocked = asArray(evidencePlanFromRow(row).blockedRoutes)[0];
  if (blocked?.blockedReason) return blocked.blockedReason;
  return '';
}

function classRowsForPlan(plan = {}) {
  const outcomeCounts = plan.outcomeCounts || {};
  return asArray(plan.providerRoutePlans).slice(0, 40).map((route) => {
    const evidenceClass = route.evidenceClass || 'unknown';
    const blocked = Boolean(route.blocked);
    return {
      evidenceClass,
      state: blocked ? route.blockedReason || 'blocked' : 'planned',
      provider: uniqueStrings([route.providerRoute, route.sourceProviders], 8),
      tier: evidenceClass === 'negative_control'
        ? 'negative_control_candidate'
        : evidenceClass === 'market_validation'
          ? 'supporting_context'
          : (route.promotionEligible ? 'promotion_candidate' : 'supporting_context'),
      latestRun: outcomeCounts[evidenceClass] ? `${outcomeCounts[evidenceClass]} outcome(s)` : '',
      closureReason: blocked ? route.blockedReason || '' : '',
      nextAction: route.nextAction || '',
    };
  });
}

function biasSummary(row = {}, seed = {}) {
  const audit = row.bias_audit || row.biasAudit || seed.biasAudit || {};
  return {
    sourceRegionDiversity: audit.source_region_diversity ?? null,
    sourceTypeDiversity: audit.source_type_diversity ?? null,
    officialSourceCount: Number(audit.official_source_count || 0),
    tradeSourceCount: Number(audit.trade_source_count || 0),
    researchSourceCount: Number(audit.research_source_count || 0),
    companySourceCount: Number(audit.company_source_count || 0),
    governmentSourceCount: Number(audit.government_source_count || 0),
    missingSources: uniqueStrings(audit.missing_sources || [], 20),
    flags: uniqueStrings(audit.bias_flags || [], 20),
    providerGaps: uniqueStrings(row.provider_gaps || row.providerGaps || seed.providerGaps || audit.provider_gap_labels || [], 40),
  };
}

function shouldEnforceAutonomousGate(row = {}, seed = {}, options = {}) {
  if (options.enforceAutonomousGate === true) return true;
  if (options.enforceAutonomousGate === false) return false;
  const source = compact(seed.lineage?.source || row.lineage?.source || row.source || '');
  if (!source) return false;
  return !/manual|user|prompt|direct/i.test(source);
}

function bypassedAutonomousGate() {
  return {
    ok: true,
    gate: 'manual_or_reviewed_seed_boundary',
    blockers: [],
    warnings: [],
    visualStatus: 'review-ready',
    reason: 'autonomous-only report-candidate gate not applied to direct/manual reviewed seed',
  };
}

export function buildOperatorSeedReviewItem(row = {}, options = {}) {
  const seed = seedFromRow(row);
  const plan = evidencePlanFromRow(row);
  const closure = summarizeOperatorSeedClosure(row, options);
  const phaseCAudit = auditOperatorSeedPhaseCRow(row, options);
  const providerGapReview = buildProviderGapReviewItem(row, options);
  const reportCandidateGate = shouldEnforceAutonomousGate(row, seed, options)
    ? evaluateAutonomousSeedReportCandidateGate(row, {
      evidencePlan: plan,
      closure,
      biasDiagnosis: options.biasDiagnosis,
      targetedBackfillRan: options.targetedBackfillRan,
      rawEvidence: options.rawEvidence || plan.rawEvidence || row.raw_evidence || row.rawEvidence || [],
      acceptedEvidence: options.acceptedEvidence || plan.acceptedEvidence || row.accepted_evidence || row.acceptedEvidence || [],
      holdoutValidation: options.holdoutValidation || plan.holdoutValidation || row.holdout_validation || row.holdoutValidation || {},
      negativeControlSurvival: options.negativeControlSurvival || plan.negativeControlSurvival || row.negative_control_survival || row.negativeControlSurvival || {},
      issuerBridge: options.issuerBridge || plan.issuerBridge || row.issuer_bridge || row.issuerBridge || {},
      marketValidation: options.marketValidation || plan.marketValidation || row.market_validation || row.marketValidation || {},
    })
    : bypassedAutonomousGate();
  const status = row.status || seed.status || 'draft';
  const score = numberScore(row.scores?.composite_seed_score ?? row.scores?.operator_preference_score ?? seed.scores?.composite_seed_score);
  const visualStatus = statusVisual(status, phaseCAudit, closure);
  const primaryBlocker = primaryBlockerFor(row, phaseCAudit, closure, providerGapReview);
  const nextAction = phaseCAudit.nextAction || closure.nextAction || providerGapReview.nextAction || plan.nextAction || 'Review seed';

  return {
    seedId: seedIdForRow(row),
    title: row.seed_title || seed.seedTitle || seed.bottleneck?.label || seedIdForRow(row),
    status,
    visualStatus,
    primaryBlocker,
    nextAction,
    theme: {
      key: row.theme_key || seed.theme?.key || '',
      label: row.theme_label || seed.theme?.label || '',
    },
    score,
    mechanism: {
      growthDriver: seed.growthDriver || '',
      realActivity: seed.realActivity || '',
      physicalProcess: seed.physicalProcess || '',
      requiredInputs: uniqueStrings(seed.requiredInputs || [], 16),
      bottleneck: {
        label: seed.bottleneck?.label || '',
        class: seed.bottleneck?.class || '',
        mechanism: seed.bottleneck?.mechanism || '',
      },
      supplierCategory: {
        label: seed.supplierCategory?.label || '',
        publicIssuerCandidates: uniqueStrings(seed.supplierCategory?.publicIssuerCandidates || [], 16),
        privateOnly: Boolean(seed.supplierCategory?.privateOnly),
      },
    },
    evidence: {
      phaseCStatus: phaseCAudit.phaseCStatus,
      evidenceState: closure.evidenceState,
      providerBackfillStatus: closure.providerBackfillPlan?.status || 'unknown',
      negativeControlStatus: closure.negativeControl?.closure || closure.negativeControl?.status || 'unchecked',
      marketValidationStatus: plan.marketValidationPlan?.status || 'unknown',
      evidenceClassCount: asArray(plan.evidenceClasses).length,
      sourceQueryDraftCount: asArray(plan.sourceQueryDrafts).length,
      negativeControlDraftCount: asArray(plan.negativeControlDrafts).length,
      blockedRouteCount: asArray(plan.blockedRoutes).length,
      outcomeCounts: plan.outcomeCounts || {},
      classRows: classRowsForPlan(plan),
    },
    bias: biasSummary(row, seed),
    providerGapReview: {
      reviewState: providerGapReview.reviewState,
      proposalCount: providerGapReview.proposalCount,
      readyDraftCount: providerGapReview.readyDraftCount,
      nextAction: providerGapReview.nextAction,
    },
    review: {
      latest: row.review_state?.latest || row.reviewState?.latest || null,
      latestEvidenceOutcome: row.review_state?.latestEvidenceOutcome || row.reviewState?.latestEvidenceOutcome || null,
      reportCandidateGate,
    },
    updatedAt: row.updated_at || row.updatedAt || null,
    actionAvailability: {
      canReview: !['promoted', 'report_generated'].includes(status),
      canRequestEvidence: !['rejected', 'promoted', 'report_candidate', 'report_generated', 'exhausted'].includes(status),
      canMarkReportCandidate: status === 'review_ready' && phaseCAudit.complete && reportCandidateGate.ok,
      canReject: !['rejected', 'promoted', 'report_generated'].includes(status),
    },
    mutationPolicy: {
      listWrites: 0,
      canonicalWrites: 0,
      sourceRegistryWrites: 0,
      providerActivationWrites: 0,
    },
  };
}

export function buildOperatorSeedReviewDetail(row = {}, options = {}) {
  const item = buildOperatorSeedReviewItem(row, options);
  const seed = seedFromRow(row);
  const plan = evidencePlanFromRow(row);
  const phaseCAudit = auditOperatorSeedPhaseCRow(row, options);
  const providerGapReview = buildProviderGapReviewItem(row, options);
  return {
    ...item,
    detail: {
      evidenceQueries: uniqueStrings(seed.evidenceQueries || [], 20),
      counterEvidenceQueries: uniqueStrings(seed.counterEvidenceQueries || [], 20),
      expectedEvidenceClasses: uniqueStrings(seed.expectedEvidenceClasses || plan.evidenceClasses || [], 40),
      lineage: row.lineage || seed.lineage || {},
      phaseCAudit,
      providerGapReview,
      auditPayload: {
        seed,
        evidencePlan: plan,
        scores: row.scores || seed.scores || {},
        biasAudit: row.bias_audit || seed.biasAudit || {},
        reviewState: row.review_state || {},
      },
    },
  };
}

export function buildOperatorSeedReviewPayload(rows = [], options = {}) {
  const generatedAt = options.generatedAt || new Date().toISOString();
  const items = asArray(rows).map((row) => buildOperatorSeedReviewItem(row, options));
  const statusCounts = {};
  const visualStatusCounts = {};
  const themeCounts = {};
  const phaseCStatusCounts = {};
  const providerBackfillStatusCounts = {};
  const negativeControlStatusCounts = {};
  for (const item of items) {
    statusCounts[item.status || 'unknown'] = (statusCounts[item.status || 'unknown'] || 0) + 1;
    visualStatusCounts[item.visualStatus || 'unknown'] = (visualStatusCounts[item.visualStatus || 'unknown'] || 0) + 1;
    if (item.theme.key) themeCounts[item.theme.key] = (themeCounts[item.theme.key] || 0) + 1;
    phaseCStatusCounts[item.evidence.phaseCStatus] = (phaseCStatusCounts[item.evidence.phaseCStatus] || 0) + 1;
    providerBackfillStatusCounts[item.evidence.providerBackfillStatus] = (providerBackfillStatusCounts[item.evidence.providerBackfillStatus] || 0) + 1;
    negativeControlStatusCounts[item.evidence.negativeControlStatus] = (negativeControlStatusCounts[item.evidence.negativeControlStatus] || 0) + 1;
  }
  return {
    ok: true,
    source: 'operator-seed-review-surface',
    version: OPERATOR_SEED_REVIEW_SURFACE_VERSION,
    generatedAt,
    total: items.length,
    statusCounts,
    visualStatusCounts,
    themeCounts,
    phaseCStatusCounts,
    providerBackfillStatusCounts,
    negativeControlStatusCounts,
    items,
    boundaries: {
      listWrites: 0,
      approvalQueueWrites: 0,
      reportBackfillWrites: 0,
      researchEvidenceBundleWrites: 0,
      canonicalWrites: 0,
      sourceRegistryWrites: 0,
      providerActivationWrites: 0,
    },
  };
}

export function buildSeedEvidenceActionPayload(row = {}, options = {}) {
  const detail = buildOperatorSeedReviewDetail(row, options);
  return {
    ok: true,
    mode: 'evidence-plan-review',
    seedId: detail.seedId,
    title: detail.title,
    evidence: detail.evidence,
    sourceQueryDraftCount: detail.evidence.sourceQueryDraftCount,
    negativeControlDraftCount: detail.evidence.negativeControlDraftCount,
    marketValidationStatus: detail.evidence.marketValidationStatus,
    nextAction: detail.nextAction,
    enqueueDefault: false,
    enqueueAllowed: Boolean(detail.actionAvailability.canRequestEvidence),
    mutationPolicy: {
      approvalQueueWrites: 0,
      reportBackfillWrites: 0,
      researchEvidenceBundleWrites: 0,
      canonicalWrites: 0,
      sourceRegistryWrites: 0,
      providerActivationWrites: 0,
    },
  };
}

export const __test = {
  classRowsForPlan,
  primaryBlockerFor,
  statusVisual,
};
