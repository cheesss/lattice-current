function compactText(value, max = 240) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (value === null || value === undefined || value === '') return [];
  return [value];
}

function num(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function bool(value) {
  if (value === true || value === 'true') return true;
  if (value === false || value === 'false') return false;
  return Boolean(value);
}

function clamp(value, min = 0, max = 1) {
  const parsed = Number(value);
  const finite = Number.isFinite(parsed) ? parsed : min;
  return Math.max(min, Math.min(max, finite));
}

function normalizedNodeType(value = '') {
  return compactText(value, 80).toLowerCase().replace(/[^a-z0-9_ -]+/g, '').replace(/\s+/g, '_');
}

function nonObviousFrom(input = {}) {
  return input.nonObviousDiscovery
    || input.non_obvious_discovery
    || input.evidenceSummary?.nonObviousDiscovery
    || input.evidence_summary?.nonObviousDiscovery
    || input.metadata?.nonObviousDiscovery
    || {};
}

function readinessFrom(input = {}) {
  return input.parentReadiness
    || {
      parentReadyForAdjacent: input.parentReadyForAdjacent
        ?? input.evidenceSummary?.parentReadyForAdjacent
        ?? input.evidence_summary?.parentReadyForAdjacent
        ?? input.metadata?.parentReadyForAdjacent,
      parentReadinessState: input.parentReadinessState
        || input.evidenceSummary?.parentReadinessState
        || input.evidence_summary?.parentReadinessState
        || input.metadata?.parentReadinessState,
      parentReadinessReason: input.parentReadinessReason
        || input.evidenceSummary?.parentReadinessReason
        || input.evidence_summary?.parentReadinessReason
        || input.metadata?.parentReadinessReason,
    };
}

export const FRONTIER_ROOT_NODE_TYPES = new Set([
  'component',
  'material',
  'process',
  'infrastructure',
  'technology',
  'clinical_process',
  'engineering_process',
  'financial_risk_process',
  'input_material',
  'maintenance_process',
  'operations_process',
  'permitting_process',
  'physical_equipment',
  'protection_control_system',
  'regulated_production_process',
  'specialist_labor',
  'specialist_service',
  'supplier_qualification',
  'test_or_certification_process',
  'utility_process',
]);

export const ISSUER_LIKE_NODE_TYPES = new Set([
  'company',
  'supplier',
  'issuer',
  'etf',
  'fund',
]);

const BROAD_PARENT_RE = /\b(ai|ml|cloud|data center|power|grid|energy|climate|clean energy|defense|space|semiconductor|chip|market|demand|growth|infrastructure|platform|technology|queue|capacity|satellite|hydrogen|fuel cell)\b/i;
const NARROW_PARENT_RE = /\b(relay|breaker|switchgear|transformer insulation|electrical steel|dielectric|coolant|fluid|pump|heat exchanger|valve|cable|connector|substation automation|substation equipment|control system|protection|study capacity|permitting capacity|lead time|inspection|maintenance|test facility|test range|qualification|certification|approved supplier|single source|sole source|fuel farm|storage tank|propellant loading|feedstock|substrate|photoresist|wafer|interposer|compressor|turbine|forging|warranty|insurance|risk transfer)\b/i;

function broadParentPenalty(label = '') {
  const text = compactText(label, 240);
  if (!text) return 0;
  let penalty = 0;
  if (BROAD_PARENT_RE.test(text) && !NARROW_PARENT_RE.test(text)) penalty += 0.18;
  const tokens = text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(/\s+/).filter(Boolean);
  if (tokens.length <= 2 && BROAD_PARENT_RE.test(text) && !NARROW_PARENT_RE.test(text)) penalty += 0.12;
  return clamp(penalty, 0, 0.34);
}

export function evaluateFrontierParentCandidate(input = {}) {
  const label = compactText(input.label || input.node?.canonicalName || input.node?.canonical_name || input.node?.normalizedKey || input.node?.normalized_key);
  const nodeType = normalizedNodeType(input.nodeType || input.node?.nodeType || input.node?.node_type || input.metadata?.nodeType || input.metadata?.node_type);
  const role = compactText(input.role || input.metadata?.role || input.evidenceSummary?.discovery?.role || input.evidence_summary?.discovery?.role, 80).toLowerCase();
  const readiness = readinessFrom(input);
  const nonObvious = nonObviousFrom(input);
  const parentReady = bool(readiness.parentReadyForAdjacent);
  const typeEligible = FRONTIER_ROOT_NODE_TYPES.has(nodeType);
  const issuerLike = ISSUER_LIKE_NODE_TYPES.has(nodeType) || role === 'supplier' || role === 'company';
  const frontierScore = clamp(num(nonObvious.frontierScore, 0) / 100);
  const specificity = clamp(num(nonObvious.bottleneckSpecificityScore, 0));
  const scarcity = clamp(num(nonObvious.scarcitySignalScore, 0));
  const themeDistance = clamp(num(nonObvious.themeDistanceScore, 0));
  const surprise = clamp(num(nonObvious.surpriseScore, 0));
  const consensusPenalty = clamp(num(nonObvious.consensusPenalty, 0));
  const broadPenalty = broadParentPenalty(label);
  const hasNarrowCue = NARROW_PARENT_RE.test(label);
  const sourceDerivedNodeCount = num(input.sourceDerivedNodeCount ?? input.evidenceSummary?.sourceDerivedNodeCount ?? input.metadata?.sourceDerivedNodeCount, 0);
  const frontierNodeSupported = bool(input.frontierNodeSupported ?? input.evidenceSummary?.frontierNodeSupported ?? input.metadata?.frontierNodeSupported);
  const evidenceBreadth = clamp(num(input.evidenceSummary?.sourceDiversityRaw ?? input.evidence_summary?.sourceDiversityRaw ?? input.metadata?.parentSourceDiversityRaw, 0) / 3);

  const frontierParentScore = clamp(
    frontierScore * 0.26
    + specificity * 0.2
    + scarcity * 0.18
    + themeDistance * 0.12
    + surprise * 0.1
    + evidenceBreadth * 0.06
    + (parentReady ? 0.08 : 0)
    + (typeEligible ? 0.12 : 0)
    + (hasNarrowCue ? 0.08 : 0)
    + (frontierNodeSupported || sourceDerivedNodeCount > 0 ? 0.08 : 0)
    - (issuerLike ? 0.45 : 0)
    - consensusPenalty * 0.34
    - broadPenalty,
  );

  let frontierParentState = 'frontier_parent_ready';
  let frontierParentReason = 'narrow_bottleneck_parent_has_evidence_and_frontier_score';
  let frontierParentCollectionEligible = typeEligible && !issuerLike;
  let frontierParentReportReady = true;

  if (issuerLike) {
    frontierParentState = 'consensus_issuer_suppressed';
    frontierParentReason = 'issuer_or_supplier_nodes_are_collection_targets_not_frontier_parent_roots';
    frontierParentCollectionEligible = false;
    frontierParentReportReady = false;
  } else if (!typeEligible) {
    frontierParentState = 'unsupported_parent_node_type';
    frontierParentReason = 'frontier_parent_root_must_be_component_material_process_infrastructure_or_technology';
    frontierParentCollectionEligible = false;
    frontierParentReportReady = false;
  } else if (!parentReady) {
    frontierParentState = readiness.parentReadinessState || 'parent_needs_evidence';
    frontierParentReason = readiness.parentReadinessReason || 'parent_evidence_readiness_not_met';
    frontierParentReportReady = false;
  } else if (consensusPenalty >= 0.45 && !hasNarrowCue && !frontierNodeSupported) {
    frontierParentState = 'consensus_parent_suppressed';
    frontierParentReason = 'parent_echoes_high_frequency_narrative_without_narrow_frontier_support';
    frontierParentReportReady = false;
  } else if (specificity < 0.32 && scarcity < 0.16 && !hasNarrowCue) {
    frontierParentState = 'broad_parent_needs_decomposition';
    frontierParentReason = 'parent_is_evidence_backed_but_too_broad_for_frontier_report_root';
    frontierParentReportReady = false;
  } else if (frontierParentScore < 0.5) {
    frontierParentState = 'frontier_parent_needs_scarcity_evidence';
    frontierParentReason = 'parent_needs_more_scarcity_or_direct_node_evidence_before_report_ready';
    frontierParentReportReady = false;
  }

  return {
    frontierParentState,
    frontierParentReason,
    frontierParentScore: Math.round(frontierParentScore * 1000) / 1000,
    frontierParentCollectionEligible,
    frontierParentReportReady,
    parentNodeType: nodeType,
    parentNodeRole: role || null,
    parentIsIssuerLike: issuerLike,
    parentBroadPenalty: Math.round(broadPenalty * 1000) / 1000,
    parentHasNarrowCue: hasNarrowCue,
  };
}

export function frontierParentMetadata(input = {}) {
  const evaluation = evaluateFrontierParentCandidate(input);
  return {
    frontierParentState: evaluation.frontierParentState,
    frontierParentReason: evaluation.frontierParentReason,
    frontierParentScore: evaluation.frontierParentScore,
    frontierParentCollectionEligible: evaluation.frontierParentCollectionEligible,
    frontierParentReportReady: evaluation.frontierParentReportReady,
    parentNodeType: evaluation.parentNodeType,
    parentNodeRole: evaluation.parentNodeRole,
    parentIsIssuerLike: evaluation.parentIsIssuerLike,
    parentBroadPenalty: evaluation.parentBroadPenalty,
    parentHasNarrowCue: evaluation.parentHasNarrowCue,
  };
}

function normalizeDomainKey(value = '') {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

export function buildDomainHistoryCounts(history = []) {
  const counts = new Map();
  const seenAt = new Map();
  for (const entry of asArray(history)) {
    const key = normalizeDomainKey(entry?.domain || entry?.primaryDomain || entry);
    if (!key) continue;
    counts.set(key, (counts.get(key) || 0) + 1);
    if (entry?.at) seenAt.set(key, entry.at);
  }
  return { counts, seenAt, totalRecorded: counts.size ? [...counts.values()].reduce((sum, n) => sum + n, 0) : 0 };
}

export function applyDomainHistoryPenalty(frontierParent = {}, primaryDomain = '', domainHistory = [], options = {}) {
  const key = normalizeDomainKey(primaryDomain);
  if (!key) {
    return { ...frontierParent, parentPrimaryDomain: null, parentDomainConcentration: 0 };
  }
  const { counts, totalRecorded } = buildDomainHistoryCounts(domainHistory);
  const recent = counts.get(key) || 0;
  const total = totalRecorded || 0;
  const concentration = total ? recent / total : 0;
  const quotaCap = Number.isFinite(options.quotaCap) ? options.quotaCap : 3;
  const concentrationFloor = Number.isFinite(options.concentrationFloor) ? options.concentrationFloor : 0.34;
  const penaltyMagnitude = Math.max(0, Math.min(0.6, (concentration - concentrationFloor) * 2.5));
  const adjustedScore = clamp((Number(frontierParent.frontierParentScore) || 0) - penaltyMagnitude * 0.22);
  let next = {
    ...frontierParent,
    frontierParentScore: Math.round(adjustedScore * 1000) / 1000,
    parentPrimaryDomain: key,
    parentDomainConcentration: Math.round(concentration * 1000) / 1000,
    parentDomainRecentCount: recent,
  };
  if (recent >= quotaCap && !frontierParent.parentHasNarrowCue) {
    next = {
      ...next,
      frontierParentState: 'domain_quota_exhausted',
      frontierParentReason: 'domain_recently_overselected_yield_to_other_domain',
      frontierParentReportReady: false,
    };
  }
  return next;
}

export function sortFrontierParentCandidates(candidates = []) {
  return asArray(candidates).slice().sort((left, right) => {
    const leftEval = left.frontierParent || evaluateFrontierParentCandidate(left);
    const rightEval = right.frontierParent || evaluateFrontierParentCandidate(right);
    return Number(rightEval.frontierParentReportReady) - Number(leftEval.frontierParentReportReady)
      || Number(rightEval.frontierParentCollectionEligible) - Number(leftEval.frontierParentCollectionEligible)
      || Number(rightEval.parentHasNarrowCue) - Number(leftEval.parentHasNarrowCue)
      || num(right.concreteBottleneckNode?.score) - num(left.concreteBottleneckNode?.score)
      || num(rightEval.frontierParentScore) - num(leftEval.frontierParentScore)
      || num(right.score) - num(left.score)
      || compactText(left.label || left.node?.canonicalName).localeCompare(compactText(right.label || right.node?.canonicalName));
  });
}
