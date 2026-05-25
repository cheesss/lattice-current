import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

export const PROVIDER_QUALITY_FEEDBACK_VERSION = 'provider-quality-feedback-v1';
export const DEFAULT_PROVIDER_QUALITY_FEEDBACK_PATH = path.join(process.cwd(), 'data', 'runtime', 'provider-quality-feedback.latest.json');

const FAILURE_ORDER = [
  'WEAK_EVIDENCE',
  'NO_RESULT',
  'SOURCE_UNAVAILABLE',
  'TIMEOUT',
  'FIXTURE_REQUIRED',
  'PROVIDER_GAP',
  'OPERATOR_REVIEW_REQUIRED',
  'TICKER_ONLY',
  'CONTRADICTORY',
  'OFFICIAL_BUT_GENERIC',
  'NO_OPERATING_BRIDGE',
  'NO_ISSUER_SEGMENT_LINK',
  'NO_BOTTLENECK_DIRECTNESS',
  'EXTRACTION_WEAK',
  'TABLE_ONLY_UNPARSED',
  'LANGUAGE_UNSUPPORTED',
  'SOURCE_SEED_ROUTE_MISMATCH',
  'STALE_ONLY',
  'DUPLICATE_ONLY',
  'VALUATION_BRIDGE_MISSING',
  'EXPECTATION_CONTEXT_MISSING',
];

const COLLECTOR_PRIORITY_BY_CLASS = {
  issuer_exposure: 1,
  holdout_validation: 2,
  technical_qualification: 3,
  material_input: 4,
  permitting_regulatory: 5,
  test_facility_capacity: 6,
  engineering_process: 7,
};

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (value === null || value === undefined || value === '') return [];
  return [value];
}

function compact(value = '') {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function compactKey(value = '') {
  return compact(value).toLowerCase().replace(/\s+/g, '_') || 'unknown';
}

function countBy(rows = [], mapper = (row) => row) {
  const out = {};
  for (const row of asArray(rows)) {
    const key = compact(mapper(row));
    if (!key) continue;
    out[key] = (out[key] || 0) + 1;
  }
  return out;
}

function mergeCounts(left = {}, right = {}) {
  const out = { ...(left || {}) };
  for (const [key, value] of Object.entries(right || {})) {
    out[key] = Number(out[key] || 0) + Number(value || 0);
  }
  return out;
}

function addDays(iso, days) {
  const date = new Date(iso || Date.now());
  date.setUTCDate(date.getUTCDate() + Number(days || 0));
  return date.toISOString();
}

function evidenceProvider(row = {}) {
  return compact(row.providerName || row.provider || row.sourceProvider || row.source || row.sourceType || row.providerRoute || 'unknown_provider');
}

function evidenceClass(row = {}) {
  return compact(row.evidenceClass || row.desiredEvidenceClass || row.fillsEvidenceClass || 'unknown_class');
}

function recordKey(providerName, klass) {
  return `${compactKey(providerName)}::${compactKey(klass)}`;
}

function ensureRecord(map, providerName, klass, generatedAt) {
  const key = recordKey(providerName, klass);
  if (!map.has(key)) {
    map.set(key, {
      key,
      providerName: compact(providerName) || 'unknown_provider',
      evidenceClass: compact(klass) || 'unknown_class',
      rawCount: 0,
      acceptedCount: 0,
      promotionCount: 0,
      acceptedRate: 0,
      promotionRate: 0,
      failureClassificationCounts: {},
      lastSuccessAt: null,
      lastFailureAt: null,
      cooldownUntil: null,
      recommendedRemediation: 'collect_more_bounded_evidence',
      remediationReason: 'no execution quality signal yet',
      terminalStatus: 'observed',
      updatedAt: generatedAt,
    });
  }
  return map.get(key);
}

function currentRunRecords({
  stagedProviderLiveExecution = {},
  backfillQueue = {},
  sourceQualityScore = {},
  generatedAt,
}) {
  const map = new Map();
  const rawRows = [
    ...asArray(stagedProviderLiveExecution.rawEvidence),
    ...asArray(backfillQueue.rawEvidence),
  ];
  const acceptedRows = [
    ...asArray(stagedProviderLiveExecution.acceptedEvidence),
    ...asArray(backfillQueue.acceptedEvidence),
  ];
  const promotionRows = [
    ...asArray(stagedProviderLiveExecution.acceptedPromotionEvidence),
    ...asArray(backfillQueue.acceptedPromotionEvidence),
  ];

  for (const row of rawRows) {
    const provider = evidenceProvider(row);
    const klass = evidenceClass(row);
    const record = ensureRecord(map, provider, klass, generatedAt);
    record.rawCount += 1;
    const failure = compact(row.failureClassification || row.terminalFailureClassification || row.acceptanceFailureClassification || 'WEAK_EVIDENCE');
    record.failureClassificationCounts[failure] = (record.failureClassificationCounts[failure] || 0) + 1;
    if (failure && failure !== 'ACCEPTED') record.lastFailureAt = row.observedAt || row.publishedAt || generatedAt;
  }
  for (const row of acceptedRows) {
    const record = ensureRecord(map, evidenceProvider(row), evidenceClass(row), generatedAt);
    record.acceptedCount += 1;
    record.lastSuccessAt = row.observedAt || row.publishedAt || generatedAt;
  }
  for (const row of promotionRows) {
    const record = ensureRecord(map, evidenceProvider(row), evidenceClass(row), generatedAt);
    record.promotionCount += 1;
    record.lastSuccessAt = row.observedAt || row.publishedAt || generatedAt;
  }

  for (const run of asArray(stagedProviderLiveExecution.providerRuns)) {
    for (const klass of asArray(run.evidenceClasses)) {
      const record = ensureRecord(map, run.providerName || 'unknown_provider', klass, generatedAt);
      record.rawCount += Number(run.rawEvidenceCount || 0);
      for (const failure of asArray(run.failureClassifications)) {
        const key = compact(failure || 'WEAK_EVIDENCE');
        if (!key) continue;
        record.failureClassificationCounts[key] = (record.failureClassificationCounts[key] || 0) + 1;
        if (key !== 'ACCEPTED') record.lastFailureAt = generatedAt;
      }
    }
  }

  for (const task of asArray(backfillQueue.taskResults)) {
    const provider = task.providerName || task.providerRoute || task.executedRoute || 'backfill_queue_executor';
    const record = ensureRecord(map, provider, task.evidenceClass || 'unknown_class', generatedAt);
    const failure = compact(task.terminalFailureClassification || 'WEAK_EVIDENCE');
    record.failureClassificationCounts[failure] = (record.failureClassificationCounts[failure] || 0) + 1;
    if (failure !== 'ACCEPTED') record.lastFailureAt = generatedAt;
  }

  for (const quality of asArray(sourceQualityScore.records)) {
    const record = ensureRecord(map, quality.providerName || 'unknown_provider', quality.evidenceClass || 'unknown_class', generatedAt);
    record.rawCount += 1;
    for (const failure of asArray(quality.failureReasons)) {
      const key = compact(failure || 'WEAK_EVIDENCE');
      if (!key) continue;
      record.failureClassificationCounts[key] = (record.failureClassificationCounts[key] || 0) + 1;
      if (key !== 'ACCEPTED') record.lastFailureAt = generatedAt;
    }
    if (quality.acceptedEligible === true) record.sourceQualityAcceptedEligibleCount = Number(record.sourceQualityAcceptedEligibleCount || 0) + 1;
    if (quality.promotionEligible === true) record.sourceQualityPromotionEligibleCount = Number(record.sourceQualityPromotionEligibleCount || 0) + 1;
  }

  return map;
}

function mergeWithExisting(currentMap, existing = {}, generatedAt) {
  for (const previous of asArray(existing.records)) {
    const record = ensureRecord(currentMap, previous.providerName, previous.evidenceClass, generatedAt);
    record.rawCount += Number(previous.rawCount || 0);
    record.acceptedCount += Number(previous.acceptedCount || 0);
    record.promotionCount += Number(previous.promotionCount || 0);
    record.failureClassificationCounts = mergeCounts(previous.failureClassificationCounts, record.failureClassificationCounts);
    record.lastSuccessAt = record.lastSuccessAt || previous.lastSuccessAt || null;
    record.lastFailureAt = record.lastFailureAt || previous.lastFailureAt || null;
  }
  return currentMap;
}

function remediationFor(record = {}, generatedAt) {
  const failures = record.failureClassificationCounts || {};
  const acceptedRate = record.rawCount > 0 ? record.acceptedCount / record.rawCount : 0;
  const repeated = Math.max(...Object.values(failures).map(Number), 0) >= 2;
  if (record.promotionCount > 0) {
    return {
      recommendedRemediation: 're_evaluate_negative_holdout_issuer_market_gates',
      remediationReason: 'promotion evidence exists; downstream evidence gates should be re-evaluated',
      terminalStatus: 'productive',
      cooldownUntil: null,
    };
  }
  if (record.acceptedCount > 0) {
    return {
      recommendedRemediation: 'run_independent_source_breadth_or_promotion_bridge',
      remediationReason: 'accepted evidence exists but no promotion evidence was produced',
      terminalStatus: 'partially_productive',
      cooldownUntil: null,
    };
  }
  if (Number(failures.FIXTURE_REQUIRED || 0) > 0 || Number(failures.PROVIDER_GAP || 0) > 0) {
    return {
      recommendedRemediation: 'create_provider_gap_proposal',
      remediationReason: 'provider execution requires fixture or adapter proposal before retry',
      terminalStatus: 'needs_fixture_or_provider_gap',
      cooldownUntil: null,
    };
  }
  if (Number(failures.VALUATION_BRIDGE_MISSING || 0) > 0 || Number(failures.EXPECTATION_CONTEXT_MISSING || 0) > 0) {
    return {
      recommendedRemediation: 'create_valuation_bridge_requirement',
      remediationReason: 'accepted issuer evidence needs local valuation or expectation context before decision use',
      terminalStatus: 'valuation_or_expectation_context_missing',
      cooldownUntil: null,
    };
  }
  if (Number(failures.SOURCE_SEED_ROUTE_MISMATCH || 0) > 0) {
    return {
      recommendedRemediation: 'split_route_or_decompose_seed',
      remediationReason: 'source route is not semantically aligned with the bottleneck seed',
      terminalStatus: 'source_seed_route_mismatch',
      cooldownUntil: null,
    };
  }
  if (Number(failures.NO_BOTTLENECK_DIRECTNESS || 0) > 0) {
    return {
      recommendedRemediation: 'refine_child_seed_or_query',
      remediationReason: 'source lacks direct bottleneck evidence; narrow the child seed or query before retry',
      terminalStatus: 'bottleneck_directness_missing',
      cooldownUntil: null,
    };
  }
  if (Number(failures.NO_ISSUER_SEGMENT_LINK || 0) > 0) {
    return {
      recommendedRemediation: 'repair_issuer_role_universe',
      remediationReason: 'issuer evidence lacks a segment, backlog, capacity, guidance, or customer exposure bridge',
      terminalStatus: 'issuer_bridge_incomplete',
      cooldownUntil: null,
    };
  }
  if (Number(failures.NO_OPERATING_BRIDGE || 0) > 0 || Number(failures.OFFICIAL_BUT_GENERIC || 0) > 0) {
    return {
      recommendedRemediation: 'create_operating_bridge_fixture_requirement',
      remediationReason: 'official source is too generic or lacks operating bridge evidence',
      terminalStatus: 'needs_operating_bridge_fixture',
      cooldownUntil: null,
    };
  }
  if (Number(failures.EXTRACTION_WEAK || 0) > 0 || Number(failures.TABLE_ONLY_UNPARSED || 0) > 0 || Number(failures.LANGUAGE_UNSUPPORTED || 0) > 0) {
    return {
      recommendedRemediation: 'improve_document_extraction',
      remediationReason: 'document body, table, or language extraction is too weak for acceptance',
      terminalStatus: 'parser_extraction_improvement_required',
      cooldownUntil: null,
    };
  }
  if (Number(failures.STALE_ONLY || 0) > 0 || Number(failures.DUPLICATE_ONLY || 0) > 0) {
    return {
      recommendedRemediation: 'select_alternative_source_bucket_or_decompose_seed',
      remediationReason: 'source set is stale or duplicate-only; broad retry should move to another source bucket',
      terminalStatus: 'stale_or_duplicate_source_universe',
      cooldownUntil: addDays(generatedAt, 3),
    };
  }
  if (Number(failures.SOURCE_UNAVAILABLE || 0) > 0 || Number(failures.TIMEOUT || 0) > 0) {
    return {
      recommendedRemediation: repeated ? 'quarantine_source_or_provider' : 'retry_after_cooldown',
      remediationReason: repeated ? 'source is repeatedly unavailable' : 'source was unavailable in this bounded run',
      terminalStatus: repeated ? 'quarantined_recommended' : 'cooldown_recommended',
      cooldownUntil: addDays(generatedAt, repeated ? 7 : 1),
    };
  }
  if (Number(failures.NO_RESULT || 0) > 0) {
    return {
      recommendedRemediation: repeated ? 'select_alternative_source_bucket_or_decompose_seed' : 'rewrite_query_or_narrow_seed',
      remediationReason: 'bounded source returned no result; broad retry is not useful',
      terminalStatus: repeated ? 'route_unproductive' : 'needs_query_rewrite',
      cooldownUntil: repeated ? addDays(generatedAt, 3) : null,
    };
  }
  if (Number(failures.WEAK_EVIDENCE || 0) > 0 || acceptedRate === 0) {
    return {
      recommendedRemediation: 'create_fixture_requirement',
      remediationReason: 'raw evidence is weak or lacks accepted operating bridge',
      terminalStatus: 'needs_parser_or_acceptance_fixture',
      cooldownUntil: null,
    };
  }
  return {
    recommendedRemediation: 'collect_more_bounded_evidence',
    remediationReason: 'insufficient quality signal',
    terminalStatus: 'observed',
    cooldownUntil: null,
  };
}

function decorateRecord(record, generatedAt) {
  const remediation = remediationFor(record, generatedAt);
  return {
    ...record,
    rawCount: Number(record.rawCount || 0),
    acceptedCount: Number(record.acceptedCount || 0),
    promotionCount: Number(record.promotionCount || 0),
    acceptedRate: record.rawCount > 0 ? Number((record.acceptedCount / record.rawCount).toFixed(4)) : 0,
    promotionRate: record.rawCount > 0 ? Number((record.promotionCount / record.rawCount).toFixed(4)) : 0,
    ...remediation,
    updatedAt: generatedAt,
  };
}

function collectorRequirementRows({ sourceProviderActivation = {}, providerCollectorRegistry = {} }) {
  const providersWithCollectors = new Set(asArray(providerCollectorRegistry.providersWithCollectors).map(compactKey));
  const records = asArray(sourceProviderActivation.records);
  const seen = new Set();
  return records
    .filter((record) => ['staged', 'active_limited'].includes(record.status))
    .filter((record) => record.fixtureStatus === 'fixture_verified')
    .filter((record) => !providersWithCollectors.has(compactKey(record.providerName)))
    .filter((record) => {
      const key = recordKey(record.providerName, record.evidenceClass);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map((record) => ({
      providerName: record.providerName,
      evidenceClass: record.evidenceClass,
      status: 'collector_requirement',
      priority: COLLECTOR_PRIORITY_BY_CLASS[record.evidenceClass] || 99,
      reason: 'provider is staged but has no bounded collector implementation',
      recommendedRemediation: 'create_fixture_requirement',
    }))
    .sort((left, right) => left.priority - right.priority || String(left.providerName).localeCompare(String(right.providerName)));
}

export function buildProviderQualityFeedback({
  stagedProviderLiveExecution = {},
  backfillQueue = {},
  sourceProviderActivation = {},
  providerCollectorRegistry = {},
  sourceQualityScore = {},
  existing = null,
  generatedAt = new Date().toISOString(),
} = {}) {
  const current = currentRunRecords({
    stagedProviderLiveExecution,
    backfillQueue,
    sourceQualityScore,
    generatedAt,
  });
  const merged = mergeWithExisting(current, existing || {}, generatedAt);
  const records = [...merged.values()]
    .map((record) => decorateRecord(record, generatedAt))
    .sort((left, right) => {
      const remediationRank = String(left.recommendedRemediation).localeCompare(String(right.recommendedRemediation));
      if (remediationRank) return remediationRank;
      return String(left.key).localeCompare(String(right.key));
    });
  const repeatedFailureProviders = records
    .filter((record) => record.rawCount > 0 && record.acceptedCount === 0)
    .filter((record) => Object.values(record.failureClassificationCounts || {}).some((count) => Number(count) >= 2))
    .map((record) => ({
      providerName: record.providerName,
      evidenceClass: record.evidenceClass,
      failureClassificationCounts: record.failureClassificationCounts,
      recommendedRemediation: record.recommendedRemediation,
      terminalStatus: record.terminalStatus,
      dominantFailureClass: Object.entries(record.failureClassificationCounts || {})
        .sort((left, right) => Number(right[1] || 0) - Number(left[1] || 0))[0]?.[0] || null,
      sourceQualityBlocker: record.remediationReason,
    }));
  const collectorRequirements = collectorRequirementRows({ sourceProviderActivation, providerCollectorRegistry });
  const failureClassificationCounts = records.reduce((acc, record) => mergeCounts(acc, record.failureClassificationCounts), {});
  const remediationCounts = countBy(records, (record) => record.recommendedRemediation);
  const quarantinedOrCooldownProviders = records
    .filter((record) => /quarantine|cooldown/i.test(`${record.recommendedRemediation} ${record.terminalStatus}`))
    .map((record) => ({
      providerName: record.providerName,
      evidenceClass: record.evidenceClass,
      cooldownUntil: record.cooldownUntil,
      recommendedRemediation: record.recommendedRemediation,
    }));
  const topRecommendedAction = collectorRequirements.length
    ? 'create_fixture_requirement'
    : repeatedFailureProviders[0]?.recommendedRemediation
      || (records.some((record) => record.promotionCount > 0) ? 're_evaluate_negative_holdout_issuer_market_gates' : 'continue_bounded_provider_collection');

  return {
    ok: true,
    version: PROVIDER_QUALITY_FEEDBACK_VERSION,
    generatedAt,
    recordCount: records.length,
    records,
    summary: {
      rawCount: records.reduce((sum, record) => sum + record.rawCount, 0),
      acceptedCount: records.reduce((sum, record) => sum + record.acceptedCount, 0),
      promotionCount: records.reduce((sum, record) => sum + record.promotionCount, 0),
      acceptedRate: records.reduce((sum, record) => sum + record.rawCount, 0) > 0
        ? Number((records.reduce((sum, record) => sum + record.acceptedCount, 0) / records.reduce((sum, record) => sum + record.rawCount, 0)).toFixed(4))
        : 0,
      failureClassificationCounts,
      remediationCounts,
      repeatedFailureProviderCount: repeatedFailureProviders.length,
      collectorRequirementCount: collectorRequirements.length,
      cooldownOrQuarantineCount: quarantinedOrCooldownProviders.length,
      sourceQualityRecordCount: sourceQualityScore?.recordCount || 0,
      sourceQualityTerminalBlockerCount: sourceQualityScore?.summary?.terminalBlockerCount || 0,
    },
    sourceQualitySummary: sourceQualityScore?.summary || null,
    sourceQualityTerminalBlockers: sourceQualityScore?.terminalBlockers || [],
    repeatedFailureProviders,
    collectorRequirements,
    quarantinedOrCooldownProviders,
    recommendedRemediationAction: topRecommendedAction,
    mutationBoundary: {
      providerActivationWrites: 0,
      sourceRegistryWrites: 0,
      canonicalWrites: 0,
      readinessPromotionWrites: 0,
      reportCandidateWrites: 0,
      portfolioActionWrites: 0,
    },
  };
}

export async function writeProviderQualityFeedbackArtifact(payload, filePath = DEFAULT_PROVIDER_QUALITY_FEEDBACK_PATH) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  return path.resolve(filePath);
}

export async function loadProviderQualityFeedback(filePath = DEFAULT_PROVIDER_QUALITY_FEEDBACK_PATH) {
  if (!existsSync(filePath)) return null;
  try {
    return JSON.parse(await readFile(filePath, 'utf8'));
  } catch {
    return null;
  }
}
