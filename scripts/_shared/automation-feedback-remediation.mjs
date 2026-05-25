import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

export const AUTOMATION_FEEDBACK_REMEDIATION_VERSION = 'automation-feedback-remediation-v1';
export const DEFAULT_AUTOMATION_FEEDBACK_REMEDIATION_PATH = path.join(
  process.cwd(),
  'data',
  'runtime',
  'automation-feedback-remediation.latest.json',
);

const BACKFILL_ROUTE_BY_CLASS = {
  issuer_exposure: ['official_filing', 'company_ir'],
  holdout_validation: ['official_filing', 'government_official', 'trade_media'],
  technical_qualification: ['technical_standard', 'patent_or_paper', 'company_ir'],
  material_input: ['official_filing', 'company_ir', 'government_official', 'trade_media'],
  permitting_regulatory: ['government_official', 'official_filing'],
  test_facility_capacity: ['company_ir', 'official_filing', 'technical_standard'],
  engineering_process: ['company_ir', 'official_filing', 'government_official'],
  provider_data_gap: ['provider_gap'],
};

const FIXTURE_REQUIREMENTS = [
  'positive_operating_bridge_fixture',
  'no_result_fixture',
  'timeout_or_source_unavailable_fixture',
  'ticker_only_rejection_fixture',
  'raw_metadata_only_rejection_fixture',
  'stale_document_rejection_fixture',
  'duplicate_source_rejection_fixture',
];

const REMEDIATION_ACTION_BY_FAILURE = {
  OFFICIAL_BUT_GENERIC: 'refine_child_seed_or_query',
  NO_OPERATING_BRIDGE: 'create_operating_bridge_fixture_requirement',
  NO_BOTTLENECK_DIRECTNESS: 'refine_child_seed_or_query',
  NO_ISSUER_SEGMENT_LINK: 'repair_issuer_role_universe',
  EXTRACTION_WEAK: 'improve_document_extraction',
  TABLE_ONLY_UNPARSED: 'improve_document_extraction',
  LANGUAGE_UNSUPPORTED: 'improve_multilingual_dictionary',
  SOURCE_SEED_ROUTE_MISMATCH: 'split_mechanism_and_issuer_tracks',
  STALE_ONLY: 'select_alternative_source_bucket',
  DUPLICATE_ONLY: 'select_alternative_source_bucket',
  VALUATION_BRIDGE_MISSING: 'create_valuation_bridge_requirement',
  EXPECTATION_CONTEXT_MISSING: 'create_valuation_bridge_requirement',
};

const REPAIR_KIND_BY_REMEDIATION = {
  create_fixture_requirement: 'parser_fixture',
  create_operating_bridge_fixture_requirement: 'parser_fixture',
  refine_child_seed_or_query: 'route_compatibility',
  split_route_or_decompose_seed: 'route_compatibility',
  split_mechanism_and_issuer_tracks: 'route_compatibility',
  repair_issuer_role_universe: 'route_compatibility',
  improve_document_extraction: 'document_extraction',
  improve_multilingual_dictionary: 'multilingual_terms',
  create_valuation_bridge_requirement: 'valuation_cache_adapter',
  select_alternative_source_bucket_or_decompose_seed: 'route_compatibility',
  select_alternative_source_bucket: 'route_compatibility',
};

const REQUIREMENT_REMEDIATIONS = new Set([
  'create_fixture_requirement',
  'create_operating_bridge_fixture_requirement',
  'refine_child_seed_or_query',
  'split_route_or_decompose_seed',
  'split_mechanism_and_issuer_tracks',
  'repair_issuer_role_universe',
  'improve_document_extraction',
  'improve_multilingual_dictionary',
  'create_valuation_bridge_requirement',
  'select_alternative_source_bucket_or_decompose_seed',
  'select_alternative_source_bucket',
]);

const ACTION_PRIORITY = {
  convert_gate_task_to_bounded_backfill: 0,
  execute_valuation_context_requirement: 1,
  expand_trusted_local_valuation_context_coverage: 2,
  split_mechanism_and_issuer_tracks: 3,
  split_route_or_decompose_seed: 4,
  refine_child_seed_or_query: 5,
  repair_issuer_role_universe: 6,
  create_operating_bridge_fixture_requirement: 7,
  improve_document_extraction: 8,
  improve_multilingual_dictionary: 9,
  create_valuation_bridge_requirement: 10,
  select_alternative_source_bucket_or_decompose_seed: 11,
  select_alternative_source_bucket: 12,
  create_fixture_requirement: 20,
  create_provider_gap_proposal: 30,
  create_targeted_backfill_task: 40,
  quarantine_source_or_provider: 50,
  apply_source_bucket_quota: 60,
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
  return compact(value).toLowerCase().replace(/[^a-z0-9가-힣]+/gi, '_').replace(/^_+|_+$/g, '') || 'unknown';
}

function uniqueBy(rows = [], keyFn = (row) => JSON.stringify(row)) {
  const seen = new Set();
  const out = [];
  for (const row of asArray(rows)) {
    const key = keyFn(row);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(row);
  }
  return out;
}

function zeroBoundary(extra = {}) {
  return {
    providerActivationWrites: 0,
    sourceRegistryWrites: 0,
    canonicalWrites: 0,
    readinessPromotionWrites: 0,
    reportCandidateWrites: 0,
    portfolioActionWrites: 0,
    ...extra,
  };
}

function fixtureRequirementFrom(row = {}, generatedAt) {
  const providerName = compact(row.providerName || 'unknown_provider');
  const evidenceClass = compact(row.evidenceClass || 'unknown_class');
  const failureClass = compact(row.dominantFailureClass || row.failureClass || Object.keys(row.failureClassificationCounts || {})[0] || 'WEAK_EVIDENCE');
  const remediation = REMEDIATION_ACTION_BY_FAILURE[failureClass] || row.recommendedRemediation || 'create_fixture_requirement';
  return {
    requirementId: `fixture-${compactKey(providerName)}-${compactKey(evidenceClass)}`,
    actionType: remediation,
    providerName,
    evidenceClass,
    failureClass,
    sourceQualityBlocker: row.sourceQualityBlocker || row.terminalStatus || null,
    allowedRepairKind: REPAIR_KIND_BY_REMEDIATION[remediation] || 'parser_fixture',
    forbiddenOutcome: [
      'lower_acceptance_gate',
      'promote_raw_evidence',
      'use_fixture_as_production_evidence',
      'raise_readiness_without_evidence_matrix',
      'replace_valuation_with_llm_opinion',
    ],
    priority: Number(row.priority || 50),
    status: 'queued_artifact_only',
    createdAt: generatedAt,
    reason: row.reason || row.remediationReason || 'provider/evidence class needs parser fixture before broad retry',
    recommendedRemediation: row.recommendedRemediation || 'create_fixture_requirement',
    requiredFixtures: FIXTURE_REQUIREMENTS,
    parserOutputSchema: {
      required: [
        'providerName',
        'evidenceClass',
        'sourceUrl',
        'documentTitle',
        'sourceGroup',
        'rawTextSnippet',
        'failureClassification',
      ],
      acceptedEvidenceAdditionalRequired: [
        'matchedSubjectTerms',
        'matchedOperatingTerms',
        'operatingBridgeSnippet',
        'sourceIndependence',
      ],
    },
    acceptanceSafety: {
      rawEvidenceAutoPromotes: false,
      tickerOnlyAccepted: false,
      rawMetadataOnlyAccepted: false,
      weakSourceQueryAccepted: false,
      officialGenericAccepted: false,
      operatingBridgeRequired: true,
    },
    reviewRequired: false,
    mutationBoundary: zeroBoundary(),
  };
}

function providerGapProposalFrom(row = {}, generatedAt) {
  const providerName = compact(row.providerName || 'unknown_provider');
  const evidenceClass = compact(row.evidenceClass || 'unknown_class');
  return {
    proposalId: `provider-gap-${compactKey(providerName)}-${compactKey(evidenceClass)}`,
    actionType: 'create_provider_gap_proposal',
    providerName,
    fillsEvidenceClass: evidenceClass,
    status: 'proposal_artifact_only',
    createdAt: generatedAt,
    activationAllowed: false,
    reviewGatedActivation: true,
    reason: row.remediationReason || row.reason || 'provider gap or fixture is required before safe execution can continue',
    fixtureRequirement: FIXTURE_REQUIREMENTS,
    parserOutputSchema: {
      required: ['sourceUrl', 'sourceGroup', 'documentType', 'rawTextSnippet', 'failureClassification'],
    },
    healthCheckCommand: `node --import tsx --test tests/provider-adapter-factory-schema.test.mjs`,
    failureModes: ['SOURCE_UNAVAILABLE', 'TIMEOUT', 'NO_RESULT', 'WEAK_EVIDENCE', 'TICKER_ONLY'],
    mutationBoundary: zeroBoundary(),
  };
}

function quarantineRecommendationFrom(row = {}, generatedAt) {
  const providerName = compact(row.providerName || 'unknown_provider');
  const evidenceClass = compact(row.evidenceClass || 'unknown_class');
  return {
    quarantineId: `quarantine-${compactKey(providerName)}-${compactKey(evidenceClass)}`,
    actionType: 'quarantine_source_or_provider',
    providerName,
    evidenceClass,
    status: 'recommended_artifact_only',
    createdAt: generatedAt,
    cooldownUntil: row.cooldownUntil || null,
    reason: row.remediationReason || 'provider/source is repeatedly unavailable or timing out',
    activationAllowed: false,
    retryPolicy: {
      retryBeforeCooldown: false,
      requiresNewSourceBucketOrFixture: true,
    },
    mutationBoundary: zeroBoundary(),
  };
}

function targetedBackfillTaskFrom(row = {}, generatedAt) {
  const evidenceClass = compact(row.evidenceClass || row.className || 'provider_data_gap');
  const providerRoute = BACKFILL_ROUTE_BY_CLASS[evidenceClass] || ['official_filing', 'company_ir'];
  return {
    taskId: `feedback-backfill-${compactKey(evidenceClass)}`,
    actionType: 'create_targeted_backfill_task',
    evidenceClass,
    providerRoute,
    sourceBuckets: providerRoute,
    status: evidenceClass === 'provider_data_gap' ? 'provider_gap_proposal_required' : 'queued_artifact_only',
    createdAt: generatedAt,
    reason: row.reason || 'underrepresented evidence class has no accepted promotion evidence',
    observedCount: Number(row.observedCount || 0),
    acceptedPromotionCount: Number(row.acceptedPromotionCount || 0),
    acceptanceCriteria: {
      sourceIndependenceRequired: true,
      operatingBridgeSnippetRequired: evidenceClass !== 'provider_data_gap',
      rawMetadataOnlyAccepted: false,
      tickerOnlyAccepted: false,
      staleEvidenceAccepted: false,
      ontologyCompatibilityRequired: true,
    },
    mutationBoundary: zeroBoundary(),
    reviewRequired: false,
  };
}

function sourceBucketActionFrom(row = {}, generatedAt) {
  const bucket = compact(row.bucket || row.sourceBucket || row.warning || row.evidenceClass || 'source_bucket_quota');
  return {
    actionId: `source-bucket-${compactKey(bucket)}`,
    actionType: row.recommendedAction || 'apply_source_bucket_quota',
    sourceBucket: bucket,
    status: 'recommended_artifact_only',
    createdAt: generatedAt,
    reason: row.warning || row.reason || 'source bucket or subject is overrepresented',
    penalty: row.penalty || null,
    nextPolicy: {
      generatedReportCooldownActive: true,
      topOneParentSelectionAllowed: false,
      acceptedEvidenceRequiredForPromotion: true,
    },
    mutationBoundary: zeroBoundary(),
  };
}

function convertedGateTaskFrom(task = {}, generatedAt) {
  return {
    ...(task || {}),
    actionType: 'convert_gate_task_to_bounded_backfill',
    status: task.status === 'queued_local_market_validation' ? 'queued_local_market_validation' : 'queued_artifact_only',
    createdAt: generatedAt,
    reason: 'seed-centric accepted evidence exists and the next missing gate has a bounded executor route',
    source: 'evidence-gate-consolidator',
    mutationBoundary: zeroBoundary(task.mutationBoundary || {}),
  };
}

function cooldownGateTaskFrom(state = {}, generatedAt) {
  return {
    taskId: `cooldown-gate-${compactKey(state.seedId)}-${compactKey(state.trackId)}-${compactKey(state.nextGateAction)}`,
    seedId: state.seedId,
    trackId: state.trackId,
    actionType: 'cooldown_repeated_gate_task',
    nextGateAction: state.nextGateAction,
    status: 'cooldown_artifact_only',
    createdAt: generatedAt,
    reason: state.gateTaskSuppressionReason || 'same gate action had no strong progress',
    lastGateAttemptFingerprint: state.lastGateAttemptFingerprint || null,
    mutationBoundary: zeroBoundary(),
  };
}

function collectorRequirementTaskFrom(row = {}, generatedAt) {
  return {
    requirementId: `collector-requirement-${compactKey(row.providerName)}-${compactKey(row.evidenceClass)}`,
    actionType: 'create_collector_requirement',
    providerName: row.providerName || 'unknown_provider',
    evidenceClass: row.evidenceClass || 'unknown_class',
    status: 'collector_requirement_artifact_only',
    createdAt: generatedAt,
    reason: row.reason || 'staged provider has no bounded collector route for this evidence class',
    mutationBoundary: zeroBoundary(),
  };
}

function valuationCoverageActionFrom(bias = {}, generatedAt) {
  if (!bias || !asArray(bias.warnings).length) return null;
  return {
    actionId: `valuation-coverage-bias-${compactKey(bias.coverageBiasRisk || 'risk')}`,
    actionType: 'expand_trusted_local_valuation_context_coverage',
    status: 'recommended_artifact_only',
    createdAt: generatedAt,
    coverageBiasRisk: bias.coverageBiasRisk || 'unknown',
    warnings: bias.warnings || [],
    missingIssuers: bias.missingIssuers || [],
    coveredIssuers: bias.coveredIssuers || [],
    reason: 'valuation cache availability can bias seed rotation, so missing issuer context should be filled before treating cache-ready seeds as better ideas',
    mutationBoundary: zeroBoundary(),
  };
}

function missingBucketAction(bucket, generatedAt) {
  return {
    actionId: `source-bucket-fill-${compactKey(bucket)}`,
    actionType: 'select_alternative_source_bucket',
    sourceBucket: bucket,
    status: 'recommended_artifact_only',
    createdAt: generatedAt,
    reason: 'expected source bucket has no current coverage',
    nextPolicy: {
      broadSearchRetryAllowed: false,
      routeMustBeEvidenceClassSpecific: true,
    },
    mutationBoundary: zeroBoundary(),
  };
}

function nextSafeActions({
  fixtureRequirements,
  providerGapProposals,
  targetedBackfillTasks,
  quarantineRecommendations,
  sourceBucketActions,
  convertedGateTasks = [],
  valuationRequirementTasks = [],
  valuationCoverageActions = [],
}) {
  const actions = [];
  if (convertedGateTasks.length) {
    actions.push({
      action: 'convert_gate_task_to_bounded_backfill',
      reason: 'accepted seed evidence has an actionable missing gate that should run before broad provider repair',
      count: convertedGateTasks.length,
    });
  }
  if (valuationRequirementTasks.some((task) => task.status === 'pending')) {
    actions.push({
      action: 'execute_valuation_context_requirement',
      reason: 'accepted issuer bridge is closed but trusted local valuation context must be built before report staging',
      count: valuationRequirementTasks.filter((task) => task.status === 'pending').length,
    });
  }
  if (valuationCoverageActions.length) {
    actions.push({
      action: 'expand_trusted_local_valuation_context_coverage',
      reason: 'valuation cache coverage bias is present and should be remediated before cache availability drives seed selection',
      count: valuationCoverageActions.length,
    });
  }
  const byActionType = fixtureRequirements.reduce((acc, row) => {
    const key = row.actionType || 'create_fixture_requirement';
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
  for (const [action, count] of Object.entries(byActionType)) {
    if (action === 'create_fixture_requirement') continue;
    actions.push({
      action,
      reason: 'source quality failure requires specific repair before broad retry',
      count,
    });
  }
  if (fixtureRequirements.length) {
    actions.push({
      action: 'create_fixture_requirement',
      reason: 'staged or repeated-failure providers need parser/acceptance fixtures before retry',
      count: fixtureRequirements.length,
    });
  }
  if (providerGapProposals.length) {
    actions.push({
      action: 'create_provider_gap_proposal',
      reason: 'provider gap remains explicit and activation is review-gated',
      count: providerGapProposals.length,
    });
  }
  if (targetedBackfillTasks.length) {
    actions.push({
      action: 'create_targeted_backfill_task',
      reason: 'underrepresented evidence classes need targeted backfill before seed/report promotion',
      count: targetedBackfillTasks.length,
    });
  }
  if (quarantineRecommendations.length) {
    actions.push({
      action: 'quarantine_source_or_provider',
      reason: 'repeated unavailable or timed-out providers should not be retried without a new route',
      count: quarantineRecommendations.length,
    });
  }
  if (sourceBucketActions.length) {
    actions.push({
      action: 'apply_source_bucket_quota',
      reason: 'source distribution or repeated subject bias needs quota/cooldown control',
      count: sourceBucketActions.length,
    });
  }
  return actions.sort((left, right) => {
    const priority = (ACTION_PRIORITY[left.action] ?? 99) - (ACTION_PRIORITY[right.action] ?? 99);
    if (priority) return priority;
    return String(left.action).localeCompare(String(right.action));
  });
}

export function buildAutomationFeedbackRemediation({
  providerQualityFeedback = {},
  sourceDiversityFeedback = {},
  evidenceGateConsolidation = {},
  valuationContextRequirementExecutor = {},
  valuationContextAutoLinker = {},
  valuationContextRotation = {},
  generatedAt = new Date().toISOString(),
} = {}) {
  const collectorRequirements = asArray(providerQualityFeedback?.collectorRequirements)
    .map((row) => fixtureRequirementFrom(row, generatedAt));
  const repeatedFixtureRequirements = asArray(providerQualityFeedback?.repeatedFailureProviders)
    .filter((row) => REQUIREMENT_REMEDIATIONS.has(row.recommendedRemediation || 'create_fixture_requirement'))
    .map((row) => fixtureRequirementFrom({ ...row, priority: 40 }, generatedAt));
  const fixtureRequirements = uniqueBy(
    [...collectorRequirements, ...repeatedFixtureRequirements],
    (row) => `${row.providerName}:${row.evidenceClass}`,
  ).sort((left, right) => left.priority - right.priority || left.providerName.localeCompare(right.providerName));

  const providerGapProposals = uniqueBy(
    asArray(providerQualityFeedback?.repeatedFailureProviders)
      .filter((row) => row.recommendedRemediation === 'create_provider_gap_proposal')
      .map((row) => providerGapProposalFrom(row, generatedAt)),
    (row) => `${row.providerName}:${row.fillsEvidenceClass}`,
  );

  const quarantineRecommendations = uniqueBy(
    asArray(providerQualityFeedback?.quarantinedOrCooldownProviders)
      .map((row) => quarantineRecommendationFrom(row, generatedAt)),
    (row) => `${row.providerName}:${row.evidenceClass}`,
  );

  const targetedBackfillTasks = uniqueBy(
    asArray(sourceDiversityFeedback?.underrepresentedEvidenceClasses)
      .map((row) => targetedBackfillTaskFrom(row, generatedAt)),
    (row) => row.evidenceClass,
  );

  const sourceBucketActions = uniqueBy([
    ...asArray(sourceDiversityFeedback?.sourceBucketQuotaWarnings).map((row) => sourceBucketActionFrom(row, generatedAt)),
    ...asArray(sourceDiversityFeedback?.overrepresentedWarnings).map((row) => sourceBucketActionFrom(row, generatedAt)),
    ...asArray(sourceDiversityFeedback?.sourceBucketDistribution?.missingBuckets).map((bucket) => missingBucketAction(bucket, generatedAt)),
  ], (row) => row.actionId);

  const convertedGateTasks = uniqueBy(
    asArray(evidenceGateConsolidation?.suggestedBackfillTasks)
      .map((task) => convertedGateTaskFrom(task, generatedAt)),
    (row) => row.taskId,
  );
  const cooldownGateTasks = uniqueBy(
    asArray(evidenceGateConsolidation?.gateClosureStates)
      .filter((state) => (
        Number(state?.acceptedPromotionEvidenceCount || 0) > 0
        && state?.gateTaskSuppressionReason
        && state.gateTaskSuppressionReason !== 'valuation_blocked_pending_cache'
      ))
      .map((state) => cooldownGateTaskFrom(state, generatedAt)),
    (row) => row.taskId,
  );
  const collectorRequirementTasks = uniqueBy(
    asArray(providerQualityFeedback?.collectorRequirements)
      .map((row) => collectorRequirementTaskFrom(row, generatedAt)),
    (row) => `${row.providerName}:${row.evidenceClass}`,
  );
  const valuationRequirementTasks = uniqueBy(
    asArray(valuationContextRequirementExecutor?.valuationRequirementTasks),
    (row) => `${row.seedId}:${row.trackId}:${row.issuer}:${row.status}`,
  );
  const valuationCoverageAction = valuationCoverageActionFrom(
    valuationContextRotation?.valuationCoverageBias || valuationContextAutoLinker?.valuationCoverageBias,
    generatedAt,
  );
  const valuationCoverageActions = valuationCoverageAction ? [valuationCoverageAction] : [];

  const nextActions = nextSafeActions({
    fixtureRequirements,
    providerGapProposals,
    targetedBackfillTasks,
    quarantineRecommendations,
    sourceBucketActions,
    convertedGateTasks,
    valuationRequirementTasks,
    valuationCoverageActions,
  });

  return {
    ok: true,
    version: AUTOMATION_FEEDBACK_REMEDIATION_VERSION,
    generatedAt,
    summary: {
      fixtureRequirementCount: fixtureRequirements.length,
      providerGapProposalCount: providerGapProposals.length,
      targetedBackfillTaskCount: targetedBackfillTasks.length,
      quarantineRecommendationCount: quarantineRecommendations.length,
      sourceBucketActionCount: sourceBucketActions.length,
      convertedGateTaskCount: convertedGateTasks.length,
      cooldownGateTaskCount: cooldownGateTasks.length,
      collectorRequirementTaskCount: collectorRequirementTasks.length,
      valuationRequirementTaskCount: valuationRequirementTasks.length,
      valuationCoverageActionCount: valuationCoverageActions.length,
      nextSafeAction: nextActions[0]?.action || 'no_safe_remediation_action',
    },
    providerFixtureRequirements: fixtureRequirements,
    providerGapProposals,
    targetedBackfillTasks,
    convertedGateTasks,
    cooldownGateTasks,
    collectorRequirementTasks,
    valuationRequirementTasks,
    valuationCoverageActions,
    quarantineRecommendations,
    sourceBucketActions,
    nextSafeActions: nextActions,
    safetyPolicy: {
      artifactOnly: true,
      providerActivationAllowed: false,
      readinessPromotionAllowed: false,
      reportCandidateWriteAllowed: false,
      rawEvidenceRaisesReadiness: false,
      acceptedEvidenceRequiredForPromotion: true,
    },
    mutationBoundary: zeroBoundary(),
  };
}

export async function writeAutomationFeedbackRemediationArtifact(
  payload,
  filePath = DEFAULT_AUTOMATION_FEEDBACK_REMEDIATION_PATH,
) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  return path.resolve(filePath);
}

export async function loadAutomationFeedbackRemediation(filePath = DEFAULT_AUTOMATION_FEEDBACK_REMEDIATION_PATH) {
  if (!existsSync(filePath)) return null;
  try {
    return JSON.parse(await readFile(filePath, 'utf8'));
  } catch {
    return null;
  }
}
