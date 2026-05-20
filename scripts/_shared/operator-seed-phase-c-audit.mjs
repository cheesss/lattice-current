import {
  buildRouteAwareSeedEvidencePlan,
} from './seed-evidence-plan.mjs';
import {
  summarizeOperatorSeedClosure,
} from './operator-seed-closure.mjs';
import {
  buildProviderGapReviewItem,
} from './provider-gap-proposals.mjs';

export const OPERATOR_SEED_PHASE_C_AUDIT_VERSION = 'operator-seed-phase-c-audit-v1';

const REQUIRED_PLAN_FIELDS = Object.freeze([
  'providerRoutePlans',
  'sourceQueryDrafts',
  'negativeControlDrafts',
  'marketValidationPlan',
  'blockedRoutes',
  'providerGapLabels',
]);

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

function planForRow(row = {}, options = {}) {
  const existing = row.evidence_plan || row.evidencePlan || null;
  if (existing && typeof existing === 'object' && Object.keys(existing).length) return existing;
  return buildRouteAwareSeedEvidencePlan(seedFromRow(row), options);
}

function hasArrayField(value = {}, key = '') {
  return Array.isArray(value[key]);
}

function classSet(routes = []) {
  return new Set(asArray(routes).map((route) => compact(route.evidenceClass)).filter(Boolean));
}

function routeByClass(routes = [], evidenceClass = '') {
  return asArray(routes).find((route) => compact(route.evidenceClass) === evidenceClass) || null;
}

function sourceQueryDraftClasses(plan = {}) {
  return new Set(asArray(plan.sourceQueryDrafts).map((draft) => compact(draft.desiredEvidenceClass)).filter(Boolean));
}

function nonPromotionDraftViolations(plan = {}) {
  return asArray(plan.sourceQueryDrafts)
    .filter((draft) => {
      const evidenceClass = compact(draft.desiredEvidenceClass);
      return ['negative_control', 'market_validation'].includes(evidenceClass)
        && (draft.promotionEligible || draft.evidenceUse === 'promotion_candidate');
    })
    .map((draft) => ({
      draftId: draft.draftId || null,
      evidenceClass: draft.desiredEvidenceClass || null,
      evidenceUse: draft.evidenceUse || null,
      promotionEligible: Boolean(draft.promotionEligible),
    }));
}

function issuerSpecificBlockedOrCollectable(plan = {}, evidenceClass = '') {
  const route = routeByClass(plan.providerRoutePlans, evidenceClass);
  if (!route) return { ok: true, reason: 'not_required' };
  const issuerCount = asArray(route.issuerUniverse).length + asArray(route.candidateIssuerUniverse).length + asArray(route.collectionUniverse).length;
  if (issuerCount > 0) return { ok: true, reason: 'issuer_or_candidate_universe_available' };
  if (route.blocked && route.blockedReason === 'blocked_missing_issuer_universe') return { ok: true, reason: 'blocked_missing_issuer_universe' };
  return { ok: false, reason: 'issuer_specific_route_not_blocked_without_issuer_universe' };
}

function phaseCChecks(row = {}, plan = {}, closure = {}, providerGapReview = {}) {
  const routes = asArray(plan.providerRoutePlans);
  const classes = classSet(routes);
  const draftClasses = sourceQueryDraftClasses(plan);
  const missingPlanFields = REQUIRED_PLAN_FIELDS.filter((field) => !Object.hasOwn(plan, field));
  const missingRequiredClasses = [
    'mechanism_validation',
    'issuer_exposure',
    'market_validation',
    'negative_control',
  ].filter((evidenceClass) => !classes.has(evidenceClass));
  const nonPromotionViolations = nonPromotionDraftViolations(plan);
  const issuerChecks = ['issuer_exposure', 'issuer_commentary', 'primary_filing', 'market_validation']
    .map((evidenceClass) => ({ evidenceClass, ...issuerSpecificBlockedOrCollectable(plan, evidenceClass) }))
    .filter((check) => !check.ok);
  const negativeRoute = routeByClass(routes, 'negative_control');
  const marketRoute = routeByClass(routes, 'market_validation');
  const providerStatus = closure.providerBackfillPlan?.status || 'unknown';
  const providerGapReviewNeeded = providerStatus === 'provider_backfill_exhausted';
  const providerGapReviewReady = !providerGapReviewNeeded
    || providerGapReview.reviewState === 'adapter_or_source_coverage_review'
    || providerGapReview.reviewState === 'blocked_missing_provider_gap_labels';

  return {
    hasRouteAwarePlan: Boolean(plan.routeAware),
    missingPlanFields,
    missingRequiredClasses,
    hasSourceQueryDrafts: asArray(plan.sourceQueryDrafts).length > 0,
    hasNegativeControlRoute: Boolean(negativeRoute),
    hasNegativeControlDrafts: asArray(plan.negativeControlDrafts).length > 0 || draftClasses.has('negative_control'),
    negativeControlNonPromotion: !nonPromotionViolations.some((item) => item.evidenceClass === 'negative_control'),
    hasMarketValidationPlan: Boolean(plan.marketValidationPlan),
    marketValidationPromotionBlocked: Boolean(plan.marketValidationPlan?.promotionFromSourceQueryAllowed === false)
      && !nonPromotionViolations.some((item) => item.evidenceClass === 'market_validation'),
    marketValidationRoutePresent: Boolean(marketRoute),
    issuerSpecificRoutesSafe: issuerChecks.length === 0,
    issuerCheckFailures: issuerChecks,
    providerGapReviewNeeded,
    providerGapReviewReady,
    hasProviderGapLabels: asArray(plan.providerGapLabels || row.provider_gaps || row.providerGaps).length > 0,
    enqueueDefaultOff: plan.enqueueDefault === false,
    enqueueAllowed: plan.enqueueAllowed !== false,
    nonPromotionViolations,
  };
}

function missingPhaseCItems(checks = {}) {
  const missing = [];
  if (!checks.hasRouteAwarePlan) missing.push('route_aware_evidence_plan');
  for (const field of checks.missingPlanFields || []) missing.push(`plan_field:${field}`);
  for (const evidenceClass of checks.missingRequiredClasses || []) missing.push(`required_class:${evidenceClass}`);
  if (!checks.hasSourceQueryDrafts) missing.push('source_query_drafts');
  if (!checks.hasNegativeControlRoute) missing.push('negative_control_route');
  if (!checks.hasNegativeControlDrafts) missing.push('negative_control_drafts');
  if (!checks.negativeControlNonPromotion) missing.push('negative_control_non_promotion_boundary');
  if (!checks.hasMarketValidationPlan) missing.push('market_validation_plan');
  if (!checks.marketValidationRoutePresent) missing.push('market_validation_route');
  if (!checks.marketValidationPromotionBlocked) missing.push('market_validation_source_query_boundary');
  if (!checks.issuerSpecificRoutesSafe) missing.push('issuer_specific_route_blocking');
  if (checks.providerGapReviewNeeded && !checks.providerGapReviewReady) missing.push('provider_gap_review_item');
  if (!checks.enqueueDefaultOff) missing.push('enqueue_default_off');
  if (!checks.enqueueAllowed) missing.push('enqueue_allowed_contract');
  return missing;
}

function nextActionForAudit(missing = [], closure = {}, providerGapReview = {}) {
  if (!missing.length) {
    if (closure.providerBackfillPlan?.status === 'provider_backfill_exhausted') {
      return providerGapReview.nextAction || 'review provider gap item before adapter proposal or source-query enqueue';
    }
    return closure.nextAction || 'Phase C contract complete; ready for Phase D review surface';
  }
  if (missing.some((item) => item.startsWith('required_class:') || item.startsWith('plan_field:'))) {
    return 'repair seed evidence plan generation before dashboard lifecycle work';
  }
  if (missing.includes('negative_control_drafts') || missing.includes('negative_control_non_promotion_boundary')) {
    return 'repair negative-control draft separation before Phase D';
  }
  if (missing.includes('market_validation_plan') || missing.includes('market_validation_source_query_boundary')) {
    return 'repair market validation plan boundary before Phase D';
  }
  if (missing.includes('provider_gap_review_item')) {
    return 'build provider gap review item for exhausted direct-provider routes';
  }
  return 'repair Phase C seed evidence contract';
}

export function auditOperatorSeedPhaseCRow(row = {}, options = {}) {
  const seed = seedFromRow(row);
  const plan = planForRow(row, options);
  const closure = summarizeOperatorSeedClosure(row, options);
  const providerGapReview = buildProviderGapReviewItem(row, options);
  const checks = phaseCChecks(row, plan, closure, providerGapReview);
  const missing = missingPhaseCItems(checks);
  const complete = missing.length === 0;
  return {
    seedId: seedIdForRow(row),
    title: row.seed_title || seed.seedTitle || seed.bottleneck?.label || seedIdForRow(row),
    status: row.status || seed.status || '',
    theme: {
      key: row.theme_key || seed.theme?.key || '',
      label: row.theme_label || seed.theme?.label || '',
    },
    phaseCStatus: complete ? 'complete' : 'incomplete',
    complete,
    missing,
    checks,
    closure: {
      evidenceState: closure.evidenceState,
      nextAction: closure.nextAction,
      providerBackfillStatus: closure.providerBackfillPlan?.status || 'unknown',
      negativeControlStatus: closure.negativeControl?.closure || closure.negativeControl?.status || 'unchecked',
    },
    counts: {
      evidenceClassCount: asArray(plan.evidenceClasses).length,
      providerRouteCount: asArray(plan.providerRoutePlans).length,
      sourceQueryDraftCount: asArray(plan.sourceQueryDrafts).length,
      negativeControlDraftCount: asArray(plan.negativeControlDrafts).length,
      blockedRouteCount: asArray(plan.blockedRoutes).length,
      providerGapLabelCount: asArray(plan.providerGapLabels || row.provider_gaps || row.providerGaps).length,
    },
    providerGapReview: {
      reviewState: providerGapReview.reviewState,
      proposalCount: providerGapReview.proposalCount,
      readyDraftCount: providerGapReview.readyDraftCount,
      nextAction: providerGapReview.nextAction,
    },
    nextAction: nextActionForAudit(missing, closure, providerGapReview),
    mutationPolicy: {
      dbWrites: 0,
      approvalQueueWrites: 0,
      sourceQueryApprovalWrites: 0,
      reportBackfillWrites: 0,
      researchEvidenceBundleWrites: 0,
      canonicalWrites: 0,
      sourceRegistryWrites: 0,
      providerActivationWrites: 0,
    },
  };
}

export function summarizeOperatorSeedPhaseCAudit(rows = [], options = {}) {
  const generatedAt = options.generatedAt || new Date().toISOString();
  const items = asArray(rows).map((row) => auditOperatorSeedPhaseCRow(row, options));
  const statusCounts = {};
  const seedStatusCounts = {};
  const providerBackfillStatusCounts = {};
  const missingCounts = {};
  const themeCounts = {};
  for (const item of items) {
    statusCounts[item.phaseCStatus] = (statusCounts[item.phaseCStatus] || 0) + 1;
    seedStatusCounts[item.status || 'unknown'] = (seedStatusCounts[item.status || 'unknown'] || 0) + 1;
    providerBackfillStatusCounts[item.closure.providerBackfillStatus] = (providerBackfillStatusCounts[item.closure.providerBackfillStatus] || 0) + 1;
    if (item.theme.key) themeCounts[item.theme.key] = (themeCounts[item.theme.key] || 0) + 1;
    for (const missing of item.missing || []) missingCounts[missing] = (missingCounts[missing] || 0) + 1;
  }
  const incomplete = items.filter((item) => !item.complete);
  return {
    ok: incomplete.length === 0,
    source: 'operator-seed-phase-c-audit',
    version: OPERATOR_SEED_PHASE_C_AUDIT_VERSION,
    generatedAt,
    total: items.length,
    completeCount: items.length - incomplete.length,
    incompleteCount: incomplete.length,
    statusCounts,
    seedStatusCounts,
    providerBackfillStatusCounts,
    missingCounts,
    themeCounts,
    items,
    boundaries: {
      dbWrites: 0,
      approvalQueueWrites: 0,
      sourceQueryApprovalWrites: 0,
      reportBackfillWrites: 0,
      researchEvidenceBundleWrites: 0,
      canonicalWrites: 0,
      sourceRegistryWrites: 0,
      providerActivationWrites: 0,
    },
    nextAction: incomplete.length
      ? 'repair incomplete Phase C seed evidence contracts before Phase D'
      : 'Phase C contract complete for loaded seeds; Phase D can consume this audit surface',
  };
}

export const __test = {
  missingPhaseCItems,
  phaseCChecks,
  issuerSpecificBlockedOrCollectable,
};
