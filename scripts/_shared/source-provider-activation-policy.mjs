export const SOURCE_PROVIDER_ACTIVATION_VERSION = 'source-provider-activation-policy-v1';

export const SOURCE_PROVIDER_STATUSES = Object.freeze([
  'discovered_untrusted',
  'probe_running',
  'probe_failed',
  'staged',
  'active_limited',
  'active',
  'quarantined',
  'needs_credentials',
  'needs_fixture',
  'provider_gap_proposal_required',
]);

const CREDENTIAL_PROVIDER_RE = /\b(fmp|polygon|openbb|paid|api[_-]?key|credential|secret|required[_-]?secret)\b/i;
const PROVIDER_GAP_RE = /\b(provider[_-]?gap|adapter[_-]?proposal|missing[_-]?provider)\b/i;
const FIXTURE_RE = /\b(adapter|parser|pdf|filing|official[_-]?provider|direct[_-]?pdf|fixture)\b/i;
const SAFE_CONNECTOR_RE = /^(rss|atom|html-alternate-feed|wordpress-rss|sitemap-news|json-ld|open-graph|html-list)$/i;

function compact(value = '') {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (value === null || value === undefined || value === '') return [];
  return [value];
}

function urlDomain(rawUrl = '') {
  try {
    return new URL(String(rawUrl || '').trim()).hostname.toLowerCase();
  } catch {
    return '';
  }
}

function hasCredentialSignal(candidate = {}) {
  const haystack = compact([
    candidate.providerName,
    candidate.provider,
    candidate.providerRoute,
    candidate.sourceType,
    candidate.authRequired ? 'authRequired' : '',
    candidate.apiKeyRequired ? 'apiKeyRequired' : '',
    asArray(candidate.requiredSecrets).join(' '),
    asArray(candidate.failureModes).join(' '),
  ].join(' '));
  return candidate.authRequired === true
    || candidate.apiKeyRequired === true
    || asArray(candidate.requiredSecrets).length > 0
    || CREDENTIAL_PROVIDER_RE.test(haystack);
}

function hasProviderGapSignal(candidate = {}) {
  const haystack = compact([
    candidate.status,
    candidate.providerName,
    candidate.provider,
    candidate.providerRoute,
    candidate.evidenceClass,
    candidate.reason,
    asArray(candidate.providerGaps).join(' '),
  ].join(' '));
  return candidate.status === 'provider_gap_proposal_required'
    || candidate.providerRoute === 'adapter_proposal_only'
    || PROVIDER_GAP_RE.test(haystack);
}

function hasFixtureSignal(candidate = {}) {
  const haystack = compact([
    candidate.providerName,
    candidate.provider,
    candidate.providerRoute,
    candidate.sourceType,
    candidate.fixtureRequirement,
    candidate.fixtureRequired ? 'fixtureRequired' : '',
    asArray(candidate.requiredDocumentTypes).join(' '),
  ].join(' '));
  return candidate.fixtureRequired === true || FIXTURE_RE.test(haystack);
}

function probeQuality(probe = {}) {
  return Math.max(0, Math.min(1, Number(probe.qualityScore ?? probe.quality?.score ?? 0)));
}

function probeRecentCount(probe = {}) {
  return Number(probe.qualityBreakdown?.recentItemCount ?? probe.quality?.recentItemCount ?? probe.recentItemCount ?? 0);
}

function probeItemCount(probe = {}) {
  return Number(probe.qualityBreakdown?.itemCount ?? probe.quality?.articleCount ?? probe.itemCount ?? 0);
}

function probeConnector(probe = {}, candidate = {}) {
  return compact(probe.connectorKind || candidate.connectorKind || candidate.sourceType || 'manual');
}

function parserRequiredFields(candidate = {}) {
  return asArray(candidate.parserOutputSchema?.requiredFields);
}

export function providerFixtureReadiness(candidateInput = {}, status = '') {
  const candidate = normalizeSourceProviderCandidate(candidateInput);
  const fixtureDeclared = Boolean(candidate.fixtureRequired || candidate.fixtureRequirement || asArray(candidate.allowlist).length);
  const fixtureVerified = candidate.probe?.fixtureVerified === true
    || candidate.probe?.fixtureStatus === 'verified'
    || candidate.probe?.fixtureStatus === 'pass';
  const parserStatus = parserRequiredFields(candidate).length > 0 ? 'schema_declared' : 'schema_missing';
  const healthcheckStatus = candidate.healthCheckCommand ? 'declared' : 'missing';
  let activationBlocker = null;

  if (status === 'needs_credentials') {
    activationBlocker = 'credentials_or_api_key_required';
  } else if (status === 'provider_gap_proposal_required') {
    activationBlocker = 'provider_gap_requires_adapter_proposal';
  } else if (status === 'needs_fixture') {
    activationBlocker = 'fixture_required_before_activation';
  } else if (status === 'quarantined') {
    activationBlocker = 'probe_failed_or_quality_below_threshold';
  } else if (parserStatus === 'schema_missing') {
    activationBlocker = 'parser_schema_missing';
  } else if (healthcheckStatus === 'missing') {
    activationBlocker = 'healthcheck_missing';
  }

  return {
    fixtureStatus: fixtureVerified ? 'fixture_verified' : (fixtureDeclared ? 'fixture_declared' : 'fixture_missing'),
    parserStatus,
    healthcheckStatus,
    activationBlocker,
  };
}

export function normalizeSourceProviderCandidate(input = {}) {
  const sourceUrl = compact(input.sourceUrl || input.url || input.resolvedUrl || input.feedUrl || '');
  const providerName = compact(input.providerName || input.provider || input.sourceProvider || input.domain || urlDomain(sourceUrl) || 'unknown-provider');
  const evidenceClass = compact(input.evidenceClass || input.fillsEvidenceClass || input.desiredEvidenceClass || 'provider_data_gap');
  return {
    candidateId: compact(input.candidateId || input.id || `${providerName}:${sourceUrl || evidenceClass}`).toLowerCase(),
    providerName,
    evidenceClass,
    sourceUrl,
    sourceType: compact(input.sourceType || input.connectorKind || input.kind || 'unknown'),
    providerRoute: compact(input.providerRoute || input.route || ''),
    discoveredBy: compact(input.discoveredBy || input.source || 'automation'),
    status: SOURCE_PROVIDER_STATUSES.includes(input.status) ? input.status : 'discovered_untrusted',
    authRequired: input.authRequired === true,
    apiKeyRequired: input.apiKeyRequired === true,
    requiredSecrets: asArray(input.requiredSecrets),
    fixtureRequired: input.fixtureRequired === true,
    fixtureRequirement: input.fixtureRequirement || null,
    allowlist: asArray(input.allowlist),
    parserOutputSchema: input.parserOutputSchema || null,
    healthCheckCommand: input.healthCheckCommand || null,
    testCommand: input.testCommand || null,
    failureModes: asArray(input.failureModes),
    probe: input.probe || null,
    metadata: input.metadata || {},
    createdAt: input.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

export function evaluateSourceProviderActivation(candidateInput = {}, options = {}) {
  const candidate = normalizeSourceProviderCandidate(candidateInput);
  const probe = candidate.probe || {};
  const minStageScore = Number(options.minStageScore ?? 0.55);
  const minActiveScore = Number(options.minActiveScore ?? 0.72);
  const minRecentItems = Number(options.minRecentItems ?? 2);
  const minActiveRecentItems = Number(options.minActiveRecentItems ?? 3);
  const reasons = [];
  const warnings = [];
  let status = 'discovered_untrusted';
  let activationTier = 'none';

  if (hasProviderGapSignal(candidate)) {
    status = 'provider_gap_proposal_required';
    reasons.push('provider_gap_requires_adapter_proposal');
  } else if (hasCredentialSignal(candidate)) {
    status = 'needs_credentials';
    reasons.push('credentials_or_api_key_required');
  } else if (hasFixtureSignal(candidate) && !providerFixtureReadiness(candidate).fixtureStatus.includes('verified')) {
    status = 'needs_fixture';
    reasons.push('fixture_required_before_activation');
  } else if (!candidate.sourceUrl && !candidate.probe) {
    status = 'needs_fixture';
    reasons.push('missing_probeable_source_url');
  } else if (candidate.probe) {
    const quality = probeQuality(probe);
    const recent = probeRecentCount(probe);
    const count = probeItemCount(probe);
    const nextAction = compact(probe.nextAction || '');
    const connector = probeConnector(probe, candidate);
    if (probe.status === 'failed' || nextAction === 'reject') {
      status = 'quarantined';
      reasons.push('probe_failed_or_rejected');
    } else if (quality < minStageScore) {
      status = 'quarantined';
      reasons.push('probe_quality_below_staging_threshold');
    } else if (recent < minRecentItems && count < minRecentItems) {
      status = 'quarantined';
      reasons.push('insufficient_recent_or_parseable_items');
    } else if (quality >= minActiveScore && recent >= minActiveRecentItems && SAFE_CONNECTOR_RE.test(connector)) {
      status = 'active_limited';
      activationTier = 'limited_readonly';
      reasons.push('probe_passed_active_limited_policy');
    } else {
      status = 'staged';
      activationTier = 'staged_readonly';
      reasons.push('probe_passed_staging_policy');
    }
    if (!SAFE_CONNECTOR_RE.test(connector)) warnings.push('connector_not_safe_for_active_limited');
  } else {
    status = 'discovered_untrusted';
    reasons.push('candidate_discovered_without_probe');
  }

  const readiness = providerFixtureReadiness(candidate, status);
  return {
    ok: true,
    version: SOURCE_PROVIDER_ACTIVATION_VERSION,
    candidate,
    status,
    activationTier,
    activationAllowed: status === 'staged' || status === 'active_limited',
    registryWriteKind: status === 'active_limited' ? 'active_limited' : (status === 'staged' ? 'staged' : 'none'),
    fixtureStatus: readiness.fixtureStatus,
    parserStatus: readiness.parserStatus,
    healthcheckStatus: readiness.healthcheckStatus,
    activationBlocker: readiness.activationBlocker,
    lifecycleReadiness: readiness,
    reasons,
    warnings,
    boundaries: {
      providerActivationWrites: status === 'active_limited' ? 1 : 0,
      sourceRegistryWrites: status === 'staged' || status === 'active_limited' ? 1 : 0,
      canonicalWrites: 0,
      readinessPromotionWrites: 0,
      reportCandidateWrites: 0,
      portfolioActionWrites: 0,
    },
  };
}

export function summarizeActivationEvaluations(evaluations = []) {
  const byStatus = {};
  const byTier = {};
  const byFixtureStatus = {};
  const byParserStatus = {};
  const byHealthcheckStatus = {};
  for (const evaluation of asArray(evaluations)) {
    byStatus[evaluation.status] = (byStatus[evaluation.status] || 0) + 1;
    byTier[evaluation.activationTier] = (byTier[evaluation.activationTier] || 0) + 1;
    if (evaluation.fixtureStatus) byFixtureStatus[evaluation.fixtureStatus] = (byFixtureStatus[evaluation.fixtureStatus] || 0) + 1;
    if (evaluation.parserStatus) byParserStatus[evaluation.parserStatus] = (byParserStatus[evaluation.parserStatus] || 0) + 1;
    if (evaluation.healthcheckStatus) byHealthcheckStatus[evaluation.healthcheckStatus] = (byHealthcheckStatus[evaluation.healthcheckStatus] || 0) + 1;
  }
  return {
    count: evaluations.length,
    byStatus,
    byTier,
    byFixtureStatus,
    byParserStatus,
    byHealthcheckStatus,
    stagedCount: byStatus.staged || 0,
    activeLimitedCount: byStatus.active_limited || 0,
    quarantinedCount: byStatus.quarantined || 0,
    needsCredentialsCount: byStatus.needs_credentials || 0,
    needsFixtureCount: byStatus.needs_fixture || 0,
    providerGapProposalRequiredCount: byStatus.provider_gap_proposal_required || 0,
  };
}
