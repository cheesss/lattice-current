function asArray(value) {
  if (Array.isArray(value)) return value;
  if (value === null || value === undefined || value === '') return [];
  if (typeof value === 'object') return Object.values(value);
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

function compactText(value, max = 240) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function sourceGroupLooksOfficial(value = '') {
  return /\b(govinfo|ferc|doe|eia|lbl|national[-_\s]?lab|rto|iso|utility|sec|fmp|company[-_\s]?ir|official|usaspending|defense|war\.gov)\b/i
    .test(String(value || ''));
}

function evidenceSummaryFrom(input = {}) {
  return input.evidenceSummary
    || input.evidence_summary
    || input.metadata?.evidenceSummary
    || input.metadata?.evidence_summary
    || {};
}

function metadataFrom(input = {}) {
  return input.metadata || {};
}

function sourceQueryFailureFrom(metadata = {}) {
  return metadata.sourceQueryFailure
    || metadata.source_query_failure
    || metadata.lastSourceQueryFailure
    || {};
}

function lastSourceQueryFrom(metadata = {}) {
  return metadata.lastSourceQueryExecution
    || metadata.last_source_query_execution
    || {};
}

function weakNoiseOnly(metadata = {}) {
  const failure = sourceQueryFailureFrom(metadata);
  const last = lastSourceQueryFrom(metadata);
  if (String(failure.category || failure.reason || '').toLowerCase() === 'weak-noise-only') return true;
  const noise = num(last.noiseCount ?? last.noise_count ?? failure.noise, 0);
  const useful = num(last.promotionBundleCount ?? last.promotion_count, 0)
    + num(last.contextBundleCount ?? last.context_count, 0)
    + num(last.edgeEvidenceCount ?? last.edge_evidence_count, 0)
    + num(last.negativeControlCount ?? last.negative_control_count, 0)
    + num(failure.accepted, 0)
    + num(failure.context, 0)
    + num(failure.negativeControl, 0);
  return noise > 0 && useful <= 0;
}

function explicitTerminal(metadata = {}) {
  const state = compactText(metadata.parentBackfillState || metadata.parent_backfill_state).toLowerCase();
  const reason = compactText(metadata.parentReadinessReason || metadata.parent_readiness_reason).toLowerCase();
  const failure = sourceQueryFailureFrom(metadata);
  return state === 'parent_exhausted_not_validated'
    || reason === 'search_exhausted_not_validated'
    || String(failure.category || '').toLowerCase() === 'search_exhausted_not_validated';
}

function pendingBackfill(metadata = {}) {
  const state = compactText(metadata.parentBackfillState || metadata.parent_backfill_state).toLowerCase();
  const closure = metadata.parentBackfillSummary || metadata.sourceQueryClosure || {};
  return state === 'parent_backfill_collecting'
    || num(closure.pendingCount ?? closure.pending_count, 0) > 0
    || num(closure.approvedCount ?? closure.approved_count, 0) > 0
    || num(closure.runningCount ?? closure.running_count, 0) > 0;
}

export function evaluateParentCandidateReadiness(input = {}) {
  const metadata = metadataFrom(input);
  const evidenceSummary = evidenceSummaryFrom(input);
  const nonObvious = metadata.nonObviousDiscovery || evidenceSummary.nonObviousDiscovery || {};
  const sourceGroups = [
    ...asArray(evidenceSummary.independentSourceGroups),
    ...asArray(metadata.independentSourceGroups),
    ...asArray(metadata.sourceGroups),
  ];
  const officialSourceGroupCount = sourceGroups.filter(sourceGroupLooksOfficial).length;
  const directEvidenceCount = num(
    input.directEvidenceCount
      ?? metadata.parentDirectEvidenceCount
      ?? metadata.parent_direct_evidence_count
      ?? evidenceSummary.directEvidenceCount
      ?? evidenceSummary.direct_evidence_count
      ?? evidenceSummary.directHighFitAnchorCount
      ?? evidenceSummary.direct_high_fit_anchor_count,
    0,
  );
  const sourceDiversityRaw = num(
    input.sourceDiversityRaw
      ?? metadata.parentSourceDiversityRaw
      ?? metadata.parent_source_diversity_raw
      ?? evidenceSummary.sourceDiversityRaw
      ?? evidenceSummary.source_diversity_raw
      ?? evidenceSummary.independentSourceGroupCount
      ?? evidenceSummary.independent_source_group_count,
    num(evidenceSummary.sourceDiversity ?? evidenceSummary.source_diversity, 0),
  );
  const officialProviderEvidenceCount = num(
    input.officialProviderEvidenceCount
      ?? metadata.parentOfficialProviderEvidenceCount
      ?? metadata.parent_official_provider_evidence_count
      ?? evidenceSummary.officialProviderEvidenceCount
      ?? evidenceSummary.official_provider_evidence_count,
    officialSourceGroupCount,
  );
  const providerBackedEvidenceCount = num(
    input.providerBackedEvidenceCount
      ?? metadata.parentProviderBackedEvidenceCount
      ?? metadata.parent_provider_backed_evidence_count
      ?? evidenceSummary.providerBackedEvidenceCount
      ?? evidenceSummary.provider_backed_evidence_count,
    officialProviderEvidenceCount,
  );
  const consensusPenalty = num(nonObvious.consensusPenalty ?? metadata.consensusPenalty, 0);
  const frontierNodeSupported = bool(
    metadata.frontierNodeSupported
      ?? evidenceSummary.frontierNodeSupported
      ?? input.frontierNodeSupported,
  );
  const sourceDerivedNodeCount = num(
    metadata.sourceDerivedNodeCount
      ?? evidenceSummary.sourceDerivedNodeCount
      ?? input.sourceDerivedNodeCount,
    0,
  );
  const weakOnly = weakNoiseOnly(metadata);
  const exhausted = explicitTerminal(metadata);
  const collecting = pendingBackfill(metadata);
  const hasEvidence = directEvidenceCount > 0 || providerBackedEvidenceCount > 0;
  const hasBreadth = sourceDiversityRaw >= 2 || officialProviderEvidenceCount > 0;
  const consensusBlocked = consensusPenalty >= 0.4 && !frontierNodeSupported && sourceDerivedNodeCount < 1;

  let parentReadinessState = 'parent_frontier_ready';
  let parentReadinessReason = 'direct_or_provider_evidence_with_source_breadth';
  let parentReadyForAdjacent = true;

  if (exhausted) {
    parentReadinessState = 'parent_exhausted_not_validated';
    parentReadinessReason = 'search_exhausted_not_validated';
    parentReadyForAdjacent = false;
  } else if (consensusBlocked) {
    parentReadinessState = 'parent_consensus_suppressed';
    parentReadinessReason = 'consensus_parent_requires_narrow_frontier_evidence';
    parentReadyForAdjacent = false;
  } else if (!hasEvidence && sourceDiversityRaw <= 0) {
    parentReadinessState = 'graph_overlap_only';
    parentReadinessReason = 'graph_overlap_without_direct_or_provider_evidence';
    parentReadyForAdjacent = false;
  } else if (collecting) {
    parentReadinessState = 'parent_backfill_collecting';
    parentReadinessReason = 'parent_backfill_or_review_tasks_pending';
    parentReadyForAdjacent = false;
  } else if (weakOnly) {
    parentReadinessState = 'parent_needs_evidence';
    parentReadinessReason = 'weak_noise_only_parent_source_query';
    parentReadyForAdjacent = false;
  } else if (!hasEvidence) {
    parentReadinessState = 'parent_needs_evidence';
    parentReadinessReason = 'missing_direct_or_provider_backed_parent_evidence';
    parentReadyForAdjacent = false;
  } else if (!hasBreadth) {
    parentReadinessState = 'parent_needs_evidence';
    parentReadinessReason = 'insufficient_parent_source_diversity';
    parentReadyForAdjacent = false;
  }

  return {
    parentReadinessState,
    parentReadinessReason,
    parentDirectEvidenceCount: directEvidenceCount,
    parentSourceDiversityRaw: sourceDiversityRaw,
    parentOfficialProviderEvidenceCount: officialProviderEvidenceCount,
    parentProviderBackedEvidenceCount: providerBackedEvidenceCount,
    parentBackfillState: collecting ? 'parent_backfill_collecting' : (exhausted ? 'parent_exhausted_not_validated' : 'none'),
    parentReadyForAdjacent,
    weakNoiseOnly: weakOnly,
    consensusPenalty,
    frontierNodeSupported,
    sourceDerivedNodeCount,
  };
}

export function parentReadinessMetadata(input = {}) {
  const readiness = evaluateParentCandidateReadiness(input);
  return {
    parentReadinessState: readiness.parentReadinessState,
    parentReadinessReason: readiness.parentReadinessReason,
    parentDirectEvidenceCount: readiness.parentDirectEvidenceCount,
    parentSourceDiversityRaw: readiness.parentSourceDiversityRaw,
    parentOfficialProviderEvidenceCount: readiness.parentOfficialProviderEvidenceCount,
    parentProviderBackedEvidenceCount: readiness.parentProviderBackedEvidenceCount,
    parentBackfillState: readiness.parentBackfillState,
    parentReadyForAdjacent: readiness.parentReadyForAdjacent,
  };
}

export function parentEvidenceSummaryFromReportArtifact(artifact = {}) {
  const manifest = artifact.manifest || artifact || {};
  const bundle = artifact.bundle || {};
  const validation = artifact.validation || {};
  const candidate = bundle.metadata?.candidate || bundle.candidate || manifest.metadata?.candidate || {};
  const crossTheme = validation.quality?.crossThemeDiscoveryQuality || bundle.metadata?.crossThemeDiscoveryQuality || {};
  const metrics = crossTheme.metrics || {};
  return {
    ...(candidate.evidence_summary || candidate.evidenceSummary || {}),
    directEvidenceCount: metrics.directHighFitAnchorCount
      ?? metrics.direct_high_fit_anchor_count
      ?? candidate.evidence_summary?.directEvidenceCount
      ?? candidate.evidenceSummary?.directEvidenceCount,
    sourceDiversityRaw: metrics.independentSourceGroupCount
      ?? metrics.independent_source_group_count
      ?? candidate.evidence_summary?.sourceDiversityRaw
      ?? candidate.evidenceSummary?.sourceDiversityRaw,
    independentSourceGroups: metrics.independentSourceGroups || candidate.evidence_summary?.independentSourceGroups || [],
    nonObviousDiscovery: bundle.metadata?.nonObviousDiscovery
      || bundle.subject?.metadata?.discovery?.nonObviousDiscovery
      || candidate.evidence_summary?.nonObviousDiscovery
      || candidate.evidenceSummary?.nonObviousDiscovery
      || {},
  };
}

export function parentBackfillQueriesForReadiness({
  subject = '',
  ontologyKey = '',
  evidenceClasses = [],
} = {}) {
  const label = compactText(subject || 'parent cross-theme candidate', 180);
  const classes = asArray(evidenceClasses).length
    ? asArray(evidenceClasses)
    : ['mechanism_validation', 'supplier_capacity', 'substitution_limit', 'policy_funding', 'technical_qualification', 'negative_control'];
  return classes.slice(0, 8).map((klass) => compactText(`${label} ${String(klass).replace(/_/g, ' ')} direct evidence official provider ${ontologyKey}`));
}
