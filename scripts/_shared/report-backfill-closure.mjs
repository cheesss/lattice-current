import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

function asArray(value) {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function safeJson(value, fallback = {}) {
  if (!value) return fallback;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

async function readJson(file, fallback = null) {
  try {
    const raw = await fs.readFile(file, 'utf8');
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function metadataOf(row) {
  return safeJson(row?.metadata || row?.payload || {}, {});
}

function findFirstKey(value, key, depth = 0) {
  if (!value || depth > 8 || typeof value !== 'object') return null;
  if (Object.prototype.hasOwnProperty.call(value, key)) return value[key];
  for (const child of Object.values(value)) {
    const found = findFirstKey(child, key, depth + 1);
    if (found) return found;
  }
  return null;
}

function normalizeStatusToken(value) {
  return String(value || '').toLowerCase().replace(/-/g, '_');
}

function normalizeEvidenceClass(value) {
  return normalizeStatusToken(value || 'unknown');
}

function rawRowEvidenceClass(row = {}) {
  const metadata = metadataOf(row);
  return (
    row.evidence_class ||
    row.evidenceClass ||
    row.desired_evidence_class ||
    row.desiredEvidenceClass ||
    metadata.desiredEvidenceClass ||
    metadata.evidenceClass ||
    metadata.providerRoutePlan?.evidenceClass ||
    metadata.evidence_contract?.class ||
    'unknown'
  );
}

function rowEvidenceClass(row = {}) {
  return normalizeEvidenceClass(rawRowEvidenceClass(row));
}

const DETAILED_TERMINAL_STATES = new Set([
  'collector_not_available',
  'provider_no_hit',
  'acceptance_failed',
  'issuer_bridge_missing',
  'search_exhausted_not_validated',
  'provider_rate_limited',
  'deferred_provider',
  'direct_provider_required',
  'broad_search_exhausted_direct_provider_required',
  'weak_noise_only',
  'source_query_market_validation_context_only',
  'no_event_candidates',
  'no_event_uplift_rows',
]);

export function normalizeClosureStatus(row = {}, source = 'unknown') {
  const metadata = metadataOf(row);
  const status = normalizeStatusToken(row.status || metadata.status);
  const evidenceUse = normalizeStatusToken(row.evidence_use || row.evidenceUse || metadata.evidenceUse);
  const tier = normalizeStatusToken(metadata.evidenceTier || metadata.tier || metadata.marketValidation?.tier);
  const closureState = normalizeStatusToken(metadata.closureState || metadata.terminalState || metadata.closureReason || metadata.providerRoutePlan?.blockedReason);
  const sourceQueryFailure = normalizeStatusToken(metadata.sourceQueryFailure?.category);
  if (closureState === 'blocked_missing_issuer_universe' || status === 'blocked_missing_issuer_universe') return 'blocked_missing_issuer_universe';
  if (status === 'deferred_provider' || closureState === 'provider_rate_limited' || closureState === 'deferred_provider') return 'provider_rate_limited';
  if (sourceQueryFailure === 'weak_noise_only' && closureState === 'direct_provider_required') return 'direct_provider_required';
  if (source === 'evidence' || row.source_type || row.sourceType) {
    if (evidenceUse === 'promotion_candidate') return 'promotion_collected';
    if (evidenceUse === 'supporting_context') return 'context_collected';
    if (evidenceUse === 'negative_control_candidate') return 'negative_collected';
    if (evidenceUse === 'weak_noise' || tier === 'weak_noise' || tier === 'weak_screen') return 'weak_noise';
  }
  if (DETAILED_TERMINAL_STATES.has(closureState)) return closureState;
  if (DETAILED_TERMINAL_STATES.has(status)) return status;
  if (closureState === 'exhausted' || closureState === 'search_exhausted') return 'search_exhausted_not_validated';
  if (status.includes('negative_control')) return 'negative_collected';
  if (status.includes('context')) return 'context_collected';
  if (status.includes('weak_noise') || status.includes('noise')) return 'weak_noise';
  if (status.includes('needs_fix') || status === 'failed' || status === 'error') return 'needs_fix';
  if (status.includes('exhaust')) return 'exhausted';
  if (status === 'running' || status === 'in_progress' || status === 'executing') return 'running';
  if (status === 'approved' || status === 'ready') return 'approved';
  if (status === 'pending' || status === 'queued' || status === 'queued_review' || status === 'retry_wait') return 'pending';
  if (status === 'executed' || status === 'completed' || status === 'complete') {
    return source === 'evidence' ? 'promotion_collected' : 'context_collected';
  }
  if (metadata.repair?.exhausted || metadata.terminalState === 'exhausted') return 'exhausted';
  if (evidenceUse === 'promotion_candidate') return 'promotion_collected';
  if (evidenceUse === 'supporting_context') return 'context_collected';
  if (evidenceUse === 'negative_control_candidate') return 'negative_collected';
  if (evidenceUse === 'weak_noise') return 'weak_noise';
  return 'pending';
}

function statusRank(status) {
  return {
    complete: 9,
    promotion_collected: 8,
    negative_collected: 8,
    context_collected: 7,
    weak_noise: 5,
    running: 4,
    approved: 3,
    pending: 2,
    needs_fix: 1,
    exhausted: 1,
    blocked_missing_issuer_universe: 1,
    issuer_bridge_missing: 1,
    search_exhausted_not_validated: 1,
    collector_not_available: 1,
    provider_no_hit: 1,
    acceptance_failed: 1,
    provider_rate_limited: 4,
    deferred_provider: 4,
    direct_provider_required: 3,
    broad_search_exhausted_direct_provider_required: 3,
    weak_noise_only: 1,
    source_query_market_validation_context_only: 1,
    no_event_candidates: 1,
    no_event_uplift_rows: 1,
  }[status] || 0;
}

function mergeClassStatus(existing, next) {
  if (!existing) return next;
  return statusRank(next.state) >= statusRank(existing.state) ? next : existing;
}

function reportIdFromArtifact(artifact = {}) {
  return (
    artifact.reportId ||
    artifact.manifest?.reportId ||
    artifact.validation?.report?.id ||
    artifact.bundle?.reportId ||
    artifact.bundle?.subject?.reportId ||
    artifact.bundle?.subject?.key ||
    null
  );
}

function uniqueStrings(values = []) {
  return [...new Set(asArray(values).map((value) => String(value || '').trim()).filter(Boolean))];
}

function normalizeSymbol(value = '') {
  const symbol = String(value || '').trim().toUpperCase();
  return /^[A-Z][A-Z0-9.-]{0,9}$/.test(symbol) ? symbol : '';
}

function symbolsFromValue(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.flatMap(symbolsFromValue);
  if (typeof value === 'object') {
    return symbolsFromValue(value.symbol || value.ticker || value.issuerSymbol || value.issuer_symbol || '');
  }
  return String(value)
    .split(/[,\s|;/]+/)
    .map(normalizeSymbol)
    .filter(Boolean);
}

function providerRunTargetSymbols(row = {}) {
  const targetKey = String(row.target_key || row.targetKey || '');
  const suffix = targetKey.includes('::') ? targetKey.split('::').slice(1).join('::') : '';
  const summary = safeJson(row.summary || {}, {});
  const target = summary.target || summary.result?.target || {};
  return uniqueStrings([
    ...symbolsFromValue(suffix),
    ...symbolsFromValue(target.symbols),
    ...symbolsFromValue(target.issuerUniverse),
    ...symbolsFromValue(target.collectionUniverse),
    ...symbolsFromValue(target.targetSymbols),
  ]).map(normalizeSymbol).filter(Boolean);
}

function artifactProviderUniverse(artifact = {}) {
  const bundle = artifact.bundle || artifact.manifest?.bundle || {};
  const metadata = bundle.metadata || artifact.metadata || {};
  return new Set(uniqueStrings([
    ...symbolsFromValue(bundle.issuerUniverse),
    ...symbolsFromValue(metadata.issuerUniverse),
    ...symbolsFromValue(metadata.candidateIssuerUniverse),
    ...symbolsFromValue(metadata.issuerBridgeSummary?.symbols),
    ...symbolsFromValue(metadata.issuerDiscoveryMap),
    ...symbolsFromValue(bundle.subject?.metadata?.issuerUniverseSymbols),
  ]).map(normalizeSymbol).filter(Boolean));
}

function providerRunMatchesArtifactUniverse(row = {}, allowedSymbols = new Set()) {
  if (!allowedSymbols?.size) return true;
  const runSymbols = providerRunTargetSymbols(row);
  if (!runSymbols.length) return true;
  return runSymbols.every((symbol) => allowedSymbols.has(symbol));
}

function relatedReportIdsFromArtifact(artifact = {}) {
  const current = reportIdFromArtifact(artifact);
  const ledger = artifact.bundle?.metadata?.deepResearch?.reportClosureLedger
    || artifact.bundle?.metadata?.deepResearch?.completionLedger
    || artifact.bundle?.metadata?.reportClosureLedger
    || {};
  const rows = [
    ...asArray(ledger.items),
    ...asArray(ledger.classLedger),
    ...asArray(ledger.classRows),
  ];
  return uniqueStrings([
    current,
    artifact.bundle?.metadata?.sourceReportId,
    artifact.bundle?.metadata?.previousReportId,
    artifact.bundle?.metadata?.latestReportId,
    ...rows.flatMap((row) => [
      row?.reportId,
      row?.latestReportId,
      row?.metadata?.reportId,
      row?.metadata?.latestReportId,
      row?.metadata?.providerRunSummary?.target?.reportId,
      row?.metadata?.providerRunSummary?.target?.latestReportId,
      ...asArray(row?.metadata?.providerRunSummary?.target?.reportIds),
    ]),
  ]);
}

function reportSubjectFromArtifact(artifact = {}) {
  const value = (
    artifact.bundle?.subject?.display ||
    artifact.bundle?.subject?.displayName ||
    artifact.bundle?.subject?.title ||
    artifact.bundle?.subject?.key ||
    artifact.manifest?.subject ||
    artifact.validation?.report?.subject ||
    artifact.reportId ||
    'report'
  );
  if (value && typeof value === 'object') {
    return value.displayName || value.display || value.title || value.key || value.subjectId || artifact.reportId || 'report';
  }
  return value;
}

function reportTypeFromArtifact(artifact = {}) {
  return (
    artifact.bundle?.subject?.type ||
    artifact.manifest?.reportType ||
    artifact.validation?.report?.type ||
    artifact.type ||
    'report'
  );
}

function diagnosticFromArtifact(artifact = {}) {
  return (
    artifact.validation?.quality?.decisionDiagnostic ||
    artifact.validation?.decisionDiagnostic ||
    artifact.bundle?.decisionDiagnostic ||
    artifact.bundle?.quality?.decisionDiagnostic ||
    {}
  );
}

function researchUtilityFromArtifact(artifact = {}) {
  return (
    artifact.validation?.quality?.researchUtility ||
    artifact.bundle?.quality?.researchUtility ||
    artifact.bundle?.metadata?.quality?.researchUtility ||
    {}
  );
}

function investmentMarketTier(artifact = {}) {
  return (
    artifact.validation?.quality?.investmentReadiness?.marketValidation?.tier ||
    artifact.bundle?.investmentReadiness?.marketValidation?.tier ||
    artifact.bundle?.marketValidation?.tier ||
    artifact.validation?.marketValidation?.tier ||
    'missing'
  );
}

function negativeControlStatus(artifact = {}, classMap = new Map()) {
  const diagnostic = diagnosticFromArtifact(artifact);
  if (diagnostic.negativeControlStatus) return diagnostic.negativeControlStatus;
  if (diagnostic.invalidationStatus === 'hard_reject') return 'invalidator';
  const negative = classMap.get('negative_control');
  if (!negative) return 'unchecked';
  const finding = negative.metadata?.negativeControlFinding || negative.metadata?.negativeControl?.finding;
  if (finding) return finding;
  if (negative.state === 'negative_collected') return 'checked';
  if (negative.state === 'context_collected') return 'supported_constraint';
  if (negative.state === 'weak_noise' || negative.state === 'exhausted') return 'checked_no_direct';
  return negative.state;
}

function openClassesFromArtifact(artifact = {}) {
  const diagnostic = diagnosticFromArtifact(artifact);
  const contract = artifact.validation?.quality?.evidenceContract || artifact.validation?.evidenceContract || {};
  const matrixRows = asArray(
    contract.matrix ||
    contract.rows ||
    artifact.bundle?.evidenceContractMatrix ||
    findFirstKey(artifact.bundle, 'evidenceClassMatrix') ||
    findFirstKey(artifact.bundle, 'crossThemeEvidenceMatrix'),
  );
  const matrixOpen = matrixRows
    .filter((row) => ['missing', 'context', 'weak_noise'].includes(normalizeStatusToken(row.status || row.coverage || row.evidenceTier)))
    .map((row) => normalizeEvidenceClass(row.evidenceClass || row.className || row.class || row.desiredEvidenceClass));
  return [
    ...asArray(diagnostic.missingEvidenceClasses),
    ...asArray(diagnostic.openEvidenceClasses),
    ...matrixOpen,
  ].map(normalizeEvidenceClass).filter(Boolean);
}

function labelForEvidenceState(state) {
  return {
    under_researched: 'More evidence needed',
    collecting_low_signal: 'Collecting low-signal evidence',
    collecting_context_evidence: 'Collecting context evidence',
    probable_bridge_found: 'Probable bridge found',
    direct_bridge_pending: 'Direct bridge pending',
    provider_deferred: 'Provider cooldown pending',
    targeted_backfill_required: 'Targeted backfill needed',
    market_validation_pending: 'Market validation pending',
    evidence_exhausted_no_support: 'Search exhausted, not validated',
    evidence_backed_reject: 'Negative-control reject',
    decision_ready_review: 'Decision review ready',
  }[state] || state || 'More evidence needed';
}

function visualStatusForLedger({ evidenceState, visibleStatus, counts = {}, marketTier = 'missing', negativeStatus = 'unchecked' } = {}) {
  if (negativeStatus === 'invalidator' || evidenceState === 'evidence_backed_reject') return 'rejected';
  if (evidenceState === 'decision_ready_review' || marketTier === 'decision_grade') return 'review-ready';
  if (['collecting_low_signal', 'collecting_context_evidence', 'probable_bridge_found', 'direct_bridge_pending', 'provider_deferred'].includes(evidenceState)) return 'running';
  if (counts.running || counts.approved || visibleStatus === 'running') return 'running';
  if (counts.pending || visibleStatus === 'pending') return 'pending';
  if (counts.needs_fix || counts.blocked_missing_issuer_universe) return 'needs-fix';
  if (counts.issuer_bridge_missing) return 'needs-fix';
  if (counts.provider_rate_limited || counts.deferred_provider) return 'running';
  if (counts.direct_provider_required || counts.broad_search_exhausted_direct_provider_required || counts.source_query_market_validation_context_only || counts.no_event_candidates || counts.no_event_uplift_rows) return 'needs-fix';
  if (counts.exhausted || counts.search_exhausted_not_validated || counts.collector_not_available || counts.provider_no_hit || counts.acceptance_failed) return 'exhausted';
  return visibleStatus || 'blocked';
}

function severityForVisualStatus(status) {
  return {
    rejected: 'critical',
    'needs-fix': 'warning',
    exhausted: 'warning',
    blocked: 'warning',
    pending: 'info',
    running: 'info',
    'review-ready': 'positive',
    complete: 'positive',
  }[status] || 'neutral';
}

function primaryBlockerForLedger({ evidenceState, openClasses = [], marketTier, negativeStatus, counts = {} } = {}) {
  if (negativeStatus === 'invalidator') return 'negative-control invalidator';
  if (evidenceState === 'evidence_backed_reject') return 'negative-control reject';
  if (evidenceState === 'direct_bridge_pending' || evidenceState === 'probable_bridge_found') return 'direct issuer bridge pending';
  if (evidenceState === 'collecting_context_evidence') return 'context evidence collecting';
  if (evidenceState === 'collecting_low_signal') return 'low-signal collection';
  if (counts.blocked_missing_issuer_universe) return 'blocked_missing_issuer_universe';
  if (counts.issuer_bridge_missing) return 'issuer_bridge_missing';
  if (counts.needs_fix) return 'provider/query needs fix';
  if (counts.provider_rate_limited || counts.deferred_provider) return 'provider_rate_limited';
  if (counts.direct_provider_required || counts.broad_search_exhausted_direct_provider_required) return 'direct_provider_required';
  if (counts.source_query_market_validation_context_only) return 'source_query_market_validation_context_only';
  if (counts.no_event_candidates) return 'no_event_candidates';
  if (counts.no_event_uplift_rows) return 'no_event_uplift_rows';
  if (marketTier === 'missing') return 'market_validation missing';
  if (counts.collector_not_available) return 'collector_not_available';
  if (counts.provider_no_hit) return 'provider_no_hit';
  if (counts.acceptance_failed) return 'acceptance_failed';
  if (counts.search_exhausted_not_validated || counts.exhausted) return 'search exhausted';
  if (openClasses.length) return `open evidence class: ${openClasses[0]}`;
  if (marketTier && marketTier !== 'decision_grade') return `market_validation ${marketTier}`;
  return 'none';
}

function nextActionForLedger({ primaryBlocker, openClasses = [], marketTier, negativeStatus, counts = {} } = {}) {
  if (negativeStatus === 'invalidator') return 'review reject rationale';
  if (primaryBlocker === 'direct issuer bridge pending') return 'run direct SEC/IR/transcript/contract issuer bridge collectors';
  if (primaryBlocker === 'context evidence collecting') return 'continue targeted class-specific provider collection and attach direct evidence where possible';
  if (primaryBlocker === 'low-signal collection') return 'stop repeating broad weak queries and switch to direct-provider routes';
  if (primaryBlocker === 'blocked_missing_issuer_universe') return 'resolve issuer universe';
  if (primaryBlocker === 'issuer_bridge_missing') return 'resolve issuer bridge and run issuer-specific collectors';
  if (primaryBlocker === 'provider_rate_limited') return 'wait for provider cooldown, then resume deferred symbol/endpoint queue';
  if (primaryBlocker === 'direct_provider_required') return 'run direct SEC/IR/transcript/contract issuer bridge collectors';
  if (primaryBlocker === 'source_query_market_validation_context_only') return 'run local controlled market validation; do not promote source-query market context';
  if (primaryBlocker === 'no_event_candidates') return 'create or link report-scoped canonical event candidates';
  if (primaryBlocker === 'no_event_uplift_rows') return 'run report-specific event-control build or repair-recent-event-uplift';
  if (primaryBlocker === 'market_validation missing' || marketTier === 'missing') return 'run controlled market validation';
  if (counts.needs_fix) return 'repair provider/query and retry';
  if (counts.collector_not_available) return 'enable specialist collector or manual lane for the evidence class';
  if (counts.provider_no_hit) return 'switch to the next provider route for the evidence class';
  if (counts.acceptance_failed) return 'rerun class-specific collector with stricter acceptance facts';
  if (counts.search_exhausted_not_validated || counts.exhausted) return 'review exhausted search path';
  if (openClasses.includes('negative_control')) return 'run separate negative-control lane';
  if (openClasses.length) return `route targeted backfill for ${openClasses[0]}`;
  return 'decision review';
}

function lastUpdatedAtFromLedger(artifact = {}, items = []) {
  const candidates = [
    artifact.manifest?.generatedAt,
    artifact.manifest?.createdAt,
    artifact.validation?.generatedAt,
    artifact.bundle?.generatedAt,
    artifact.bundle?.asOf,
    ...items.flatMap((item) => {
      const metadata = item.metadata || {};
      return [
        item.updated_at,
        item.created_at,
        item.updatedAt,
        item.createdAt,
        metadata.updatedAt,
        metadata.createdAt,
        metadata.lastRunAt,
        metadata.lastAttemptAt,
      ];
    }),
  ].filter(Boolean);
  const dates = candidates
    .map((value) => {
      const ms = Date.parse(value);
      return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
    })
    .filter(Boolean)
    .sort()
    .reverse();
  return dates[0] || null;
}

function providerRouteLabel(item = {}) {
  const metadata = item.metadata || {};
  const route = item.providerRoute || metadata.providerRoutePlan?.providerRoute || metadata.providerRoute;
  if (Array.isArray(route)) return route.join(', ');
  if (route) return String(route);
  const collectors = metadata.providerRoutePlan?.executableCollectors;
  if (Array.isArray(collectors) && collectors.length) return collectors.join(', ');
  const providers = metadata.providerRoutePlan?.sourceProviders;
  if (Array.isArray(providers) && providers.length) return providers.join(', ');
  return '--';
}

function collectorLabel(item = {}) {
  const metadata = item.metadata || {};
  const capability = metadata.collectorCapability || {};
  if (capability.collector) return capability.collector;
  const collectors = metadata.providerRoutePlan?.executableCollectors;
  if (Array.isArray(collectors) && collectors.length) return collectors.join(', ');
  return metadata.provider || metadata.sourceProvider || item.source || item.sourceType || '--';
}

function factsFoundLabel(item = {}) {
  const metadata = item.metadata || {};
  const facts = asArray(metadata.factsExtracted)
    .map((fact) => fact?.label || fact?.key || fact)
    .filter(Boolean);
  if (facts.length) return facts.slice(0, 4).join(', ');
  const factKeys = asArray(metadata.factKeys).filter(Boolean);
  if (factKeys.length) return factKeys.slice(0, 4).join(', ');
  return '--';
}

function closureReasonForClassRow(item = {}, openSet = new Set(), primaryBlocker = 'none') {
  const metadata = item.metadata || {};
  const explicit = item.terminalReason
    || metadata.marketValidation?.missingReason
    || metadata.closureReason
    || metadata.acceptanceVerdict;
  if (explicit) return explicit;
  if (openSet.has(item.evidenceClass)) return `open evidence class: ${item.evidenceClass}`;
  if (item.state === 'promotion_collected') return 'promotion_collected';
  if (item.state === 'context_collected') return 'context_collected';
  if (item.state === 'negative_collected') return 'negative_collected';
  if (item.state === 'weak_noise') return 'acceptance_failed';
  return primaryBlocker && primaryBlocker !== 'none' ? primaryBlocker : '';
}

function tierForClassItem(item = {}, marketTier = null) {
  if (item.evidenceClass === 'market_validation' && marketTier) return marketTier;
  const metadata = item.metadata || {};
  return (
    metadata.marketValidation?.tier ||
    metadata.evidenceTier ||
    metadata.tier ||
    item.evidenceUse ||
    (item.state === 'promotion_collected' ? 'promotion_candidate' : null) ||
    (item.state === 'context_collected' ? 'supporting_context' : null) ||
    (item.state === 'negative_collected' ? 'negative_control_candidate' : null) ||
    (item.state === 'weak_noise' ? 'weak_noise' : null) ||
    'missing'
  );
}

function classRowsForLedger({ classLedger = [], openClasses = [], marketTier = 'missing', primaryBlocker = 'none' } = {}) {
  const seen = new Set();
  const rows = [];
  const openSet = new Set(openClasses);
  for (const item of classLedger) {
    seen.add(item.evidenceClass);
    rows.push({
      evidenceClass: item.evidenceClass,
      visualStatus: item.state,
      state: item.state,
      providerRoute: providerRouteLabel(item),
      tier: tierForClassItem(item, marketTier),
      latestRun: item.latestRunResult || item.metadata?.lastResult || item.metadata?.status || '--',
      closureReason: closureReasonForClassRow(item, openSet, primaryBlocker),
      nextAction: item.nextAction || item.metadata?.nextAction || null,
      evidenceUse: item.evidenceUse || item.metadata?.evidenceUse || null,
      collector: collectorLabel(item),
      factsFound: factsFoundLabel(item),
      missingFacts: asArray(item.metadata?.missingFacts).slice(0, 4).join(', '),
      acceptanceVerdict: item.metadata?.acceptanceVerdict || null,
    });
  }
  for (const evidenceClass of openClasses) {
    if (seen.has(evidenceClass)) continue;
    rows.push({
      evidenceClass,
      visualStatus: primaryBlocker === 'blocked_missing_issuer_universe' ? 'blocked_missing_issuer_universe' : 'pending',
      state: primaryBlocker === 'blocked_missing_issuer_universe' ? 'blocked_missing_issuer_universe' : 'pending',
      providerRoute: '--',
      tier: 'missing',
      latestRun: '--',
      closureReason: `open evidence class: ${evidenceClass}`,
      nextAction: evidenceClass === 'market_validation'
        ? 'run controlled market validation'
        : evidenceClass === 'negative_control'
          ? 'run separate negative-control lane'
          : `route targeted backfill for ${evidenceClass}`,
      evidenceUse: 'missing',
      collector: '--',
      factsFound: '--',
      missingFacts: '',
      acceptanceVerdict: null,
    });
  }
  return rows.sort((a, b) => String(a.evidenceClass).localeCompare(String(b.evidenceClass)));
}

export function buildReportBackfillClosureLedger({
  artifact = {},
  taskRows = [],
  approvalRows = [],
  evidenceRows = [],
  providerRunRows = [],
  marketValidation = null,
} = {}) {
  const classMap = new Map();
  const items = [];
  const providerUniverse = artifactProviderUniverse(artifact);
  const addItem = (row, source) => {
    const evidenceClass = rowEvidenceClass(row);
    const state = normalizeClosureStatus(row, source);
    const metadata = metadataOf(row);
    const item = {
      source,
      id: row.id || row.task_id || row.source_id || row.sourceId || null,
      evidenceClass,
      state,
      providerRoute:
        metadata.providerRoutePlan?.providerRoute ||
        metadata.providerRoute ||
        metadata.route?.providerRoute ||
        row.provider_route ||
        null,
      latestRunResult: row.status || metadata.status || metadata.lastResult || null,
      evidenceUse: row.evidenceUse || row.evidence_use || metadata.evidenceUse || null,
      nextAction: metadata.nextAction || metadata.repair?.nextAction || metadata.providerRoutePlan?.nextAction || null,
      terminalReason: metadata.closureState || metadata.terminalState || metadata.providerRoutePlan?.blockedReason || null,
      metadata,
    };
    items.push(item);
    classMap.set(evidenceClass, mergeClassStatus(classMap.get(evidenceClass), item));
  };
  for (const row of asArray(taskRows)) addItem(row, 'task');
  for (const row of asArray(approvalRows)) addItem(row, 'approval');
  for (const row of asArray(evidenceRows)) addItem(row, 'evidence');
  for (const row of asArray(providerRunRows)) {
    if (!providerRunMatchesArtifactUniverse(row, providerUniverse)) continue;
    const summary = safeJson(row.summary || {}, {});
    const target = summary.target || summary.result?.target || {};
    const classes = asArray(target.desiredEvidenceClasses).length
      ? asArray(target.desiredEvidenceClasses).map(normalizeEvidenceClass)
      : asArray(target.providerRoutePlans).map((plan) => normalizeEvidenceClass(plan?.evidenceClass)).filter(Boolean);
    if (!classes.length) continue;
    const state = normalizeClosureStatus({
      status: row.status,
      metadata: {
        status: row.status,
        closureReason: row.status === 'deferred_provider' ? 'provider_rate_limited' : null,
        providerRoutePlan: asArray(target.providerRoutePlans)[0] || null,
      },
    }, 'provider-run');
    for (const evidenceClass of classes.length ? classes : ['unknown']) {
      const providerRoutePlan = asArray(target.providerRoutePlans).find((plan) => normalizeEvidenceClass(plan?.evidenceClass) === evidenceClass) || null;
      const item = {
        source: 'provider-run',
        id: row.id || null,
        evidenceClass,
        state,
        providerRoute: providerRoutePlan?.providerRoute || null,
        latestRunResult: row.status || null,
        evidenceUse: null,
        nextAction: state === 'provider_rate_limited'
          ? 'wait for provider cooldown, then resume deferred symbol/endpoint queue'
          : null,
        terminalReason: state === 'provider_rate_limited' ? 'provider_rate_limited' : null,
        metadata: {
          status: row.status,
          providerRunSummary: summary,
          providerRoutePlan,
        },
      };
      items.push(item);
      classMap.set(evidenceClass, mergeClassStatus(classMap.get(evidenceClass), item));
    }
  }

  if (marketValidation?.tier) {
    const state = marketValidation.tier === 'decision_grade'
      ? 'promotion_collected'
      : marketValidation.tier === 'screening_grade'
        ? 'context_collected'
        : marketValidation.tier === 'weak_screen'
          ? 'weak_noise'
          : marketValidation.missingReason === 'no_issuer_universe'
            ? 'blocked_missing_issuer_universe'
            : ['no_event_candidates', 'no_event_uplift_rows'].includes(marketValidation.missingReason)
              ? marketValidation.missingReason
              : 'pending';
    const item = {
      source: 'market-validation',
      id: 'market_validation',
      evidenceClass: 'market_validation',
      state,
      providerRoute: 'market_validation',
      latestRunResult: marketValidation.missingReason || marketValidation.tier,
      evidenceUse: marketValidation.evidenceUse,
      nextAction: marketValidation.tier === 'decision_grade' ? 'review' : (marketValidation.nextAction || 'collect more local market rows'),
      terminalReason: marketValidation.missingReason || null,
      metadata: { marketValidation },
    };
    items.push(item);
    classMap.set('market_validation', mergeClassStatus(classMap.get('market_validation'), item));
  }

  const counts = {
    pending: 0,
    approved: 0,
    running: 0,
    promotion_collected: 0,
    context_collected: 0,
    negative_collected: 0,
    weak_noise: 0,
    needs_fix: 0,
    exhausted: 0,
    blocked_missing_issuer_universe: 0,
    issuer_bridge_missing: 0,
    collector_not_available: 0,
    provider_no_hit: 0,
    acceptance_failed: 0,
    provider_rate_limited: 0,
    deferred_provider: 0,
    direct_provider_required: 0,
    broad_search_exhausted_direct_provider_required: 0,
    weak_noise_only: 0,
    source_query_market_validation_context_only: 0,
    no_event_candidates: 0,
    no_event_uplift_rows: 0,
    search_exhausted_not_validated: 0,
    complete: 0,
  };
  for (const item of classMap.values()) {
    counts[item.state] = (counts[item.state] || 0) + 1;
  }
  const providerRateLimitedClasses = new Set(items
    .filter((item) => item.source === 'provider-run' && item.state === 'provider_rate_limited')
    .map((item) => item.evidenceClass));
  if (providerRateLimitedClasses.size) {
    counts.provider_rate_limited = Math.max(counts.provider_rate_limited || 0, providerRateLimitedClasses.size);
  }

  const artifactOpen = openClassesFromArtifact(artifact);
  const openClasses = [...new Set(artifactOpen.filter((evidenceClass) => {
    const status = classMap.get(evidenceClass)?.state;
    return !['promotion_collected', 'negative_collected', 'complete'].includes(status);
  }))];
  const diagnostic = diagnosticFromArtifact(artifact);
  const researchUtility = researchUtilityFromArtifact(artifact);
  const marketTier = marketValidation?.tier || investmentMarketTier(artifact);
  const negativeStatus = negativeControlStatus(artifact, classMap);
  let evidenceState = diagnostic.status || diagnostic.evidenceState || 'under_researched';
  if (negativeStatus === 'invalidator' || evidenceState === 'evidence_backed_reject') evidenceState = 'evidence_backed_reject';
  else if (counts.provider_rate_limited || counts.deferred_provider) evidenceState = 'provider_deferred';
  else if (marketTier === 'missing' && !openClasses.length && evidenceState !== 'decision_ready_review') evidenceState = 'market_validation_pending';
  else if ((counts.exhausted || counts.search_exhausted_not_validated || counts.collector_not_available || counts.provider_no_hit || counts.acceptance_failed || counts.needs_fix) && !counts.pending && !counts.running && !counts.approved && openClasses.length) evidenceState = 'evidence_exhausted_no_support';
  else if (openClasses.length) evidenceState = 'targeted_backfill_required';
  else if (marketTier === 'decision_grade') evidenceState = 'decision_ready_review';
  if (['targeted_backfill_required', 'under_researched'].includes(evidenceState)
    && ['collecting_low_signal', 'collecting_context_evidence', 'probable_bridge_found', 'direct_bridge_pending'].includes(researchUtility.closureState)) {
    evidenceState = researchUtility.closureState;
  }

  const visibleStatus =
    evidenceState === 'evidence_backed_reject'
      ? 'rejected'
      : evidenceState === 'decision_ready_review'
        ? 'review-ready'
        : counts.running || counts.approved
          ? 'running'
          : counts.pending
          ? 'pending'
            : 'blocked';
  const visualStatus = visualStatusForLedger({ evidenceState, visibleStatus, counts, marketTier, negativeStatus });
  const primaryBlocker = primaryBlockerForLedger({ evidenceState, openClasses, marketTier, negativeStatus, counts });
  const nextAction = nextActionForLedger({ primaryBlocker, openClasses, marketTier, negativeStatus, counts });
  const classLedger = [...classMap.values()].sort((a, b) => a.evidenceClass.localeCompare(b.evidenceClass));
  const classRows = classRowsForLedger({ classLedger, openClasses, marketTier, primaryBlocker });

  return {
    reportId: reportIdFromArtifact(artifact),
    subject: reportSubjectFromArtifact(artifact),
    reportType: reportTypeFromArtifact(artifact),
    reportPath: artifact.reportPath || artifact.htmlPath || artifact.manifest?.htmlPath || null,
    evidenceState,
    evidenceStateLabel: labelForEvidenceState(evidenceState),
    visibleStatus,
    openClasses,
    marketTier,
    negativeControlStatus: negativeStatus,
    counts,
    classLedger,
    classRows,
    visualStatus,
    primaryBlocker,
    nextAction,
    severity: severityForVisualStatus(visualStatus),
    lastUpdatedAt: lastUpdatedAtFromLedger(artifact, items),
    items,
  };
}

async function loadArtifactFromDir(reportDir) {
  const bundle = await readJson(path.join(reportDir, 'bundle.json'), {});
  const validation = await readJson(path.join(reportDir, 'validation.json'), {});
  const manifest = await readJson(path.join(reportDir, 'manifest.json'), {});
  const htmlPath = existsSync(path.join(reportDir, 'report.html')) ? path.join(reportDir, 'report.html') : null;
  return {
    reportId: manifest?.reportId || validation?.report?.id || bundle?.reportId || path.basename(reportDir),
    reportDir,
    reportPath: htmlPath,
    bundle,
    validation,
    manifest,
  };
}

export async function findLatestReportArtifactDirs(reportRoot, limit = 10) {
  let entries = [];
  try {
    entries = await fs.readdir(reportRoot, { withFileTypes: true });
  } catch {
    return [];
  }
  const dirs = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const dir = path.join(reportRoot, entry.name);
    if (!existsSync(path.join(dir, 'bundle.json'))) continue;
    const stat = await fs.stat(dir).catch(() => null);
    dirs.push({ dir, mtimeMs: stat?.mtimeMs || 0 });
  }
  dirs.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return dirs.slice(0, Number(limit || 10)).map((entry) => entry.dir);
}

async function loadDbRowsForReports(client, reportIds = []) {
  if (!client?.query || !reportIds.length) {
    return { taskRows: [], approvalRows: [], evidenceRows: [], providerRunRows: [] };
  }
  const taskSql = `
    SELECT *
    FROM report_backfill_tasks
    WHERE report_id = ANY($1::text[])
       OR metadata->>'reportId' = ANY($1::text[])
       OR metadata->>'latestReportId' = ANY($1::text[])
  `;
  const approvalSql = `
    SELECT *
    FROM approval_queue
    WHERE type = 'source-query'
      AND (
        payload->>'reportId' = ANY($1::text[])
        OR payload->>'latestReportId' = ANY($1::text[])
        OR payload->>'reportBackfillTaskId' IN (
          SELECT id::text FROM report_backfill_tasks
          WHERE report_id = ANY($1::text[])
             OR metadata->>'reportId' = ANY($1::text[])
             OR metadata->>'latestReportId' = ANY($1::text[])
        )
      )
  `;
  const evidenceSql = `
    SELECT *
    FROM research_evidence_bundles
    WHERE metadata->>'reportId' = ANY($1::text[])
       OR metadata->>'latestReportId' = ANY($1::text[])
  `;
  const providerRunSql = `
    SELECT *
    FROM external_provider_backfill_runs
    WHERE summary->'target'->>'reportId' = ANY($1::text[])
       OR summary->'target'->>'latestReportId' = ANY($1::text[])
       OR summary->'target'->>'report_id' = ANY($1::text[])
       OR summary::text LIKE ANY($2::text[])
    ORDER BY created_at DESC
    LIMIT 200
  `;
  const tasks = await client.query(taskSql, [reportIds]).catch(() => ({ rows: [] }));
  const approvals = await client.query(approvalSql, [reportIds]).catch(() => ({ rows: [] }));
  const evidence = await client.query(evidenceSql, [reportIds]).catch(() => ({ rows: [] }));
  const providerRuns = await client.query(providerRunSql, [reportIds, reportIds.map((id) => `%${id}%`)]).catch(() => ({ rows: [] }));
  return {
    taskRows: tasks.rows || [],
    approvalRows: approvals.rows || [],
    evidenceRows: evidence.rows || [],
    providerRunRows: providerRuns.rows || [],
  };
}

function rowsForReport(rows, reportId, relatedReportIds = []) {
  const reportIdSet = new Set(uniqueStrings([reportId, ...asArray(relatedReportIds)]));
  return asArray(rows).filter((row) => {
    const metadata = metadataOf(row);
    const payload = safeJson(row.payload || {}, {});
    const summary = safeJson(row.summary || {}, {});
    const target = summary.target || summary.result?.target || {};
    const candidates = uniqueStrings([
      row.report_id,
      row.reportId,
      metadata.reportId,
      metadata.latestReportId,
      payload.reportId,
      payload.latestReportId,
      target.reportId,
      target.latestReportId,
      ...asArray(target.reportIds),
    ]);
    return candidates.some((id) => reportIdSet.has(id))
      || [...reportIdSet].some((id) => id && JSON.stringify(summary).includes(id));
  });
}

export async function loadReportBackfillClosureSummaries({
  client = null,
  reportRoot = path.resolve('data/reports'),
  limit = 10,
  reportDirs = null,
} = {}) {
  const dirs = reportDirs || (await findLatestReportArtifactDirs(reportRoot, limit));
  const artifacts = [];
  for (const dir of dirs) {
    const artifact = await loadArtifactFromDir(dir);
    artifacts.push(artifact);
  }
  const relatedByReport = new Map(artifacts.map((artifact) => {
    const reportId = reportIdFromArtifact(artifact);
    return [reportId, relatedReportIdsFromArtifact(artifact)];
  }));
  const reportIds = uniqueStrings(artifacts.flatMap(relatedReportIdsFromArtifact));
  const rows = await loadDbRowsForReports(client, reportIds);
  return artifacts.map((artifact) => {
    const reportId = reportIdFromArtifact(artifact);
    const relatedReportIds = relatedByReport.get(reportId) || [reportId];
    return buildReportBackfillClosureLedger({
      artifact,
      taskRows: rowsForReport(rows.taskRows, reportId, relatedReportIds),
      approvalRows: rowsForReport(rows.approvalRows, reportId, relatedReportIds),
      evidenceRows: rowsForReport(rows.evidenceRows, reportId, relatedReportIds),
      providerRunRows: rowsForReport(rows.providerRunRows, reportId, relatedReportIds),
    });
  });
}
