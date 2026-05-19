import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

export const DEFAULT_RESEARCH_OS_POLICY_PATH = path.join(process.cwd(), 'config', 'research-os.defaults.json');
export const LOCAL_RESEARCH_OS_POLICY_PATH = path.join(process.cwd(), 'config', 'research-os.local.json');

export const REQUIRED_RESEARCH_OS_POLICY_KEYS = Object.freeze([
  'seedSimilarityWeightMax',
  'explorationQuotaMin',
  'autonomousQuestionRateTarget',
  'seedDependenceRatioMax',
  'incoming.lookbackDays',
  'incoming.maxSignalsPerRun',
  'incoming.minObservationCount',
  'incoming.minSourceCount',
  'incoming.minNoveltyScore',
  'incoming.minPriorityScore',
  'incoming.seedSimilarityStrongThreshold',
  'incoming.questionQuotaMin',
  'incoming.repeatedConnectorActiveLimit',
  'incoming.singleSourcePriorityCap',
  'incoming.crossSourcePriorityBoost',
  'incoming.sourceBridgePriorityBoost',
  'incoming.sourceTypeWeights.article',
  'incoming.sourceTypeWeights.discoveryTopic',
  'incoming.sourceTypeWeights.openalex',
  'incoming.sourceTypeWeights.github',
  'incoming.sourceTypeWeights.sec',
  'incoming.sourceTypeWeights.externalRss',
  'trustedPromotion.minSourceDiversity',
  'trustedPromotion.minDirectEvidence',
  'generation.maxQuestionsPerRun',
  'generation.maxThemePairsPerRun',
  'generation.cooldownHours',
  'generation.minHotThemeHeat',
  'generation.minThemeMomentum',
  'generation.maxSupplierDiversityForGap',
  'generation.minNovelPhraseCount',
  'generation.maxGraphHops',
  'generation.questionScoring.hotThemeNovelty',
  'generation.questionScoring.themePairNovelty',
  'generation.questionScoring.themePairGap',
  'generation.questionScoring.explanationGapNovelty',
  'generation.questionScoring.novelPhraseNovelty',
  'generation.questionScoring.novelPhraseGap',
  'generation.questionScoring.sourceDivergenceNovelty',
  'generation.questionScoring.sourceDivergenceGap',
  'generation.questionScoring.sourceDivergenceFallbackHeat',
  'generation.questionScoring.incomingEntityNovelty',
  'generation.questionScoring.incomingEntityGap',
  'generation.questionScoring.sourceBridgeNovelty',
  'generation.questionScoring.sourceBridgeGap',
  'generation.questionScoring.crossSourceConvergenceNovelty',
  'generation.questionScoring.crossSourceConvergenceGap',
  'generation.questionScoring.userInterestHeat',
  'generation.questionScoring.userInterestNovelty',
  'generation.questionScoring.userInterestGap',
  'generation.questionScoring.supplierGapPriorityWeight',
  'scoring.weights.evidenceQuality',
  'scoring.weights.sourceDiversity',
  'scoring.weights.crossThemeOverlap',
  'scoring.weights.recencyMomentum',
  'scoring.weights.novelty',
  'scoring.weights.supplierCentrality',
  'scoring.weights.userInterestBoost',
  'scoring.weights.seedSimilarity',
  'scoring.lanes.watchScoreMin',
  'scoring.lanes.weirdNoveltyMin',
  'scoring.lanes.weakEvidenceMin',
  'scoring.penalties.weakRelation',
  'scoring.penalties.genericNoise',
  'scoring.penalties.reviewedReject',
  'scoring.genericNoise.evidenceFloor',
  'automation.maxCandidatesPerRun',
  'automation.maxNewGraphNodesPerDay',
  'automation.llmTokenBudgetDaily',
  'automation.sourceExpansionBudgetDaily',
  'automation.candidateRefresh.hotThemeLimitDefault',
  'automation.candidateRefresh.questionThemeLimitMin',
  'automation.candidateRefresh.questionThemeLimitMultiplier',
  'automation.candidateRefresh.researchQuestionThemeFallbackHeat',
  'automation.candidateRefresh.researchQuestionThemeFallbackMomentum',
  'automation.candidateRefresh.frontierThemeLimit',
  'automation.candidateRefresh.frontierThemeFallbackHeat',
  'automation.candidateRefresh.frontierThemeFallbackMomentum',
  'automation.candidateRefresh.graphThemeFallbackHeat',
  'automation.candidateRefresh.graphThemeFallbackMomentum',
  'sourceExpansion.minEvidenceQuality',
  'sourceExpansion.maxQueriesPerCandidate',
  'sourceExpansion.candidateLimitDefault',
  'sourceExpansion.perQueryEvidenceLimit',
  'sourceExpansion.minBundleRelevance',
  'sourceExpansion.directBundleRelevance',
  'sourceExpansion.evidenceEdgeConfidence',
  'sourceExpansion.externalRssMaxItems',
  'sourceExpansion.externalRssTimeoutMs',
  'sourceExpansion.externalRssTriggerBelowAccepted',
  'sourceExpansion.retry.maxAttempts',
  'sourceExpansion.retry.maxRewriteTerms',
  'sourceExpansion.retry.queryVariantsPerFailure',
  'sourceExpansion.queryScoring.primaryHit',
  'sourceExpansion.queryScoring.themeHit',
  'sourceExpansion.queryScoring.queryOverlap',
  'relationExtraction.quoteLessConfidenceMax',
  'relationExtraction.maxLlmBundlesPerRun',
  'relationExtraction.maxOutputTokens',
  'relationExtraction.temperature',
  'relationExtraction.estimatedPromptTokenDivisor',
  'feedback.rejectPenaltyDecayDays',
]);

function readJsonFile(filePath) {
  return JSON.parse(readFileSync(filePath, 'utf8'));
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function deepMergePolicy(base, override) {
  const out = { ...(base || {}) };
  for (const [key, value] of Object.entries(override || {})) {
    if (isPlainObject(value) && isPlainObject(out[key])) {
      out[key] = deepMergePolicy(out[key], value);
    } else {
      out[key] = value;
    }
  }
  return out;
}

export function getPolicyValue(policy, dottedPath) {
  return String(dottedPath || '')
    .split('.')
    .filter(Boolean)
    .reduce((cursor, key) => (cursor && Object.prototype.hasOwnProperty.call(cursor, key) ? cursor[key] : undefined), policy);
}

export function requirePolicyNumber(policy, dottedPath) {
  const value = Number(getPolicyValue(policy, dottedPath));
  if (!Number.isFinite(value)) {
    throw new Error(`[research-os-policy] missing numeric policy value: ${dottedPath}`);
  }
  return value;
}

export function validateResearchOsPolicy(policy) {
  const missing = REQUIRED_RESEARCH_OS_POLICY_KEYS.filter((key) => getPolicyValue(policy, key) === undefined);
  const nonNumeric = REQUIRED_RESEARCH_OS_POLICY_KEYS.filter((key) => {
    const value = getPolicyValue(policy, key);
    return value !== undefined && !Number.isFinite(Number(value));
  });
  if (missing.length || nonNumeric.length) {
    throw new Error(`[research-os-policy] invalid policy: missing=${missing.join(',')} nonNumeric=${nonNumeric.join(',')}`);
  }
  const weights = getPolicyValue(policy, 'scoring.weights') || {};
  const weightSum = Object.values(weights).reduce((sum, value) => sum + Number(value || 0), 0);
  if (weightSum <= 0 || weightSum > 1.25) {
    throw new Error(`[research-os-policy] scoring weights must be positive and bounded, got ${weightSum}`);
  }
  if (requirePolicyNumber(policy, 'seedSimilarityWeightMax') > 0.2) {
    throw new Error('[research-os-policy] seed similarity cap is too high for autonomy guardrails');
  }
  if (requirePolicyNumber(policy, 'explorationQuotaMin') < 0.1) {
    throw new Error('[research-os-policy] exploration quota is too low for autonomy guardrails');
  }
  return { ok: true, weightSum };
}

export function loadResearchOsPolicy(options = {}) {
  const defaultsPath = options.defaultsPath || DEFAULT_RESEARCH_OS_POLICY_PATH;
  const localPath = options.localPath || LOCAL_RESEARCH_OS_POLICY_PATH;
  const defaults = readJsonFile(defaultsPath);
  const local = existsSync(localPath) ? readJsonFile(localPath) : {};
  const policy = deepMergePolicy(deepMergePolicy(defaults, local), options.overrides || {});
  validateResearchOsPolicy(policy);
  return policy;
}

export function buildPolicyDiagnostics(policy = loadResearchOsPolicy()) {
  const seedCap = requirePolicyNumber(policy, 'seedSimilarityWeightMax');
  const explorationMin = requirePolicyNumber(policy, 'explorationQuotaMin');
  return {
    ok: true,
    version: policy.version || 'unknown',
    guardrails: {
      seedSimilarityWeightMax: seedCap,
      explorationQuotaMin: explorationMin,
      autonomousQuestionRateTarget: requirePolicyNumber(policy, 'autonomousQuestionRateTarget'),
      seedDependenceRatioMax: requirePolicyNumber(policy, 'seedDependenceRatioMax'),
      seedSimilarityStrongThreshold: requirePolicyNumber(policy, 'incoming.seedSimilarityStrongThreshold'),
      incomingQuestionQuotaMin: requirePolicyNumber(policy, 'incoming.questionQuotaMin'),
    },
    noMagicNumbers: true,
    note: 'Research OS thresholds must be loaded from policy config or research_os_policy, not hard-coded in scorers.',
  };
}
