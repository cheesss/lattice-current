import crypto from 'node:crypto';

import {
  buildRouteAwareSeedEvidencePlan,
} from './seed-evidence-plan.mjs';
import {
  routeEvidenceProvider,
} from './evidence-provider-router.mjs';
import {
  buildProviderAdapterProposalsFromReviewItems,
} from './provider-adapter-factory.mjs';
import {
  summarizeOperatorSeedClosure,
} from './operator-seed-closure.mjs';
import {
  acceptSeedEvidenceRows,
  coveredEvidenceClassesFromAccepted,
} from './seed-evidence-acceptance.mjs';

export const SEED_BIAS_DIAGNOSTICS_VERSION = 'seed-bias-diagnostics-v1';

export const BIAS_VERDICTS = Object.freeze({
  DATA_LIMITED_BIAS: 'DATA_LIMITED_BIAS',
  LIKELY_REAL_BOTTLENECK: 'LIKELY_REAL_BOTTLENECK',
  INCONCLUSIVE_NEEDS_BACKFILL: 'INCONCLUSIVE_NEEDS_BACKFILL',
  KNOWN_NARRATIVE_OVERFIT: 'KNOWN_NARRATIVE_OVERFIT',
});

export const DIVERSITY_TARGETS = Object.freeze({
  supplier_capacity: { maxShare: 0.35 },
  power_constraint: { maxShare: 0.25 },
  technical_qualification: { minShare: 0.10 },
  permitting_regulatory: { minShare: 0.10 },
  material_input: { minShare: 0.10 },
  engineering_process: { minShare: 0.10 },
  test_facility_capacity: { minShare: 0.05 },
  provider_data_gap: { minShare: 0.05 },
});

export const BIAS_BACKFILL_CLASSES = Object.freeze([
  'technical_qualification',
  'permitting_regulatory',
  'material_input',
  'engineering_process',
  'test_facility_capacity',
  'provider_data_gap',
  'negative_control',
  'issuer_exposure',
  'market_validation',
]);

export const NEGATIVE_CONTROL_SURVIVAL_STATUSES = Object.freeze({
  SURVIVED: 'SURVIVED',
  CHECKED_NO_DIRECT: 'CHECKED_NO_DIRECT',
  WEAKENED: 'WEAKENED',
  REJECTED: 'REJECTED',
  INCONCLUSIVE: 'INCONCLUSIVE',
});

const REPRESENTATIVE_TICKERS = new Set([
  'NVDA',
  'MSFT',
  'GOOGL',
  'GOOG',
  'META',
  'AMZN',
  'VRT',
  'ETN',
  'PWR',
  'LMT',
  'RTX',
  'NOC',
  'LHX',
  'TSM',
  'ASML',
]);

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (value === null || value === undefined || value === '') return [];
  return [value];
}

function compact(value = '') {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function clamp(value, min = 0, max = 1) {
  const n = Number(value);
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, n));
}

function uniqueStrings(values = [], limit = 120) {
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

function stableId(parts = []) {
  return crypto.createHash('sha1').update(parts.map((part) => compact(part)).join('|')).digest('hex').slice(0, 16);
}

function seedFromRow(row = {}) {
  return row.seed_json || row.seedJson || row.seed || row;
}

function seedId(seed = {}) {
  return compact(seed.seedId || seed.seed_id || seed.id);
}

function seedClass(seed = {}) {
  return compact(seed.bottleneck?.class || seed.bottleneckClass || 'unknown');
}

function seedTitle(seed = {}) {
  return compact(seed.seedTitle || seed.seed_title || seed.bottleneck?.label || seed.theme?.label || seedId(seed));
}

function seedText(seed = {}) {
  return [
    seed.theme?.key,
    seed.theme?.label,
    seed.seedTitle,
    seed.growthDriver,
    seed.realActivity,
    seed.physicalProcess,
    seed.requiredInputs,
    seed.bottleneck?.label,
    seed.bottleneck?.class,
    seed.bottleneck?.mechanism,
    seed.supplierCategory?.label,
    seed.supplierCategory?.publicIssuerCandidates,
    seed.evidenceQueries,
    seed.counterEvidenceQueries,
    seed.lineage?.source,
    seed.lineage?.sourceIds,
  ].flatMap(asArray).join(' ');
}

function planForSeed(seed = {}, evidencePlans = []) {
  const id = seedId(seed);
  const plan = asArray(evidencePlans).find((item) => item.seedId === id || item.operatorSeedId === id);
  if (plan) return plan;
  return buildRouteAwareSeedEvidencePlan(seed);
}

export function classDistribution(seeds = []) {
  const counts = {};
  for (const item of asArray(seeds)) {
    const seed = seedFromRow(item);
    const cls = seedClass(seed);
    counts[cls] = (counts[cls] || 0) + 1;
  }
  const total = Object.values(counts).reduce((sum, value) => sum + Number(value || 0), 0);
  const shares = {};
  for (const [key, value] of Object.entries(counts)) {
    shares[key] = total ? Number((value / total).toFixed(6)) : 0;
  }
  return { total, counts, shares };
}

export function diversityEntropy(distribution = {}) {
  const shares = Object.values(distribution.shares || {}).filter((share) => share > 0);
  if (shares.length <= 1) return 0;
  const entropy = shares.reduce((sum, share) => sum - share * Math.log(share), 0);
  return Number((entropy / Math.log(Math.max(2, Object.keys(DIVERSITY_TARGETS).length))).toFixed(6));
}

function sourceDistribution(seeds = []) {
  const counts = {};
  for (const item of asArray(seeds)) {
    const seed = seedFromRow(item);
    const source = compact(seed.lineage?.source || item.lineage?.source || 'unknown');
    counts[source] = (counts[source] || 0) + 1;
  }
  const total = Object.values(counts).reduce((sum, count) => sum + count, 0);
  const maxShare = total ? Math.max(...Object.values(counts).map((count) => count / total)) : 0;
  return { counts, total, maxShare };
}

function sourceCoverageSkewFor(seeds = [], sourceCoverage = {}) {
  if (Number.isFinite(Number(sourceCoverage.skew))) return clamp(sourceCoverage.skew);
  const distribution = sourceDistribution(seeds);
  const averageTypeDiversity = asArray(seeds).reduce((sum, row) => {
    const seed = seedFromRow(row);
    return sum + Number(seed.biasAudit?.source_type_diversity || row.bias_audit?.source_type_diversity || 0);
  }, 0) / Math.max(1, asArray(seeds).length);
  const monoculturePenalty = averageTypeDiversity <= 1 ? 0.25 : 0;
  return clamp(distribution.maxShare + monoculturePenalty);
}

function providerGapDensity(seeds = [], providerGaps = []) {
  const explicit = asArray(providerGaps).length;
  const fromSeeds = asArray(seeds).reduce((sum, row) => {
    const seed = seedFromRow(row);
    return sum + asArray(seed.providerGaps || row.provider_gaps || seed.biasAudit?.provider_gap_labels).length;
  }, 0);
  const denom = Math.max(1, asArray(seeds).length * 6);
  return clamp((explicit + fromSeeds) / denom);
}

function knownNarrativeOverlapFor(seeds = []) {
  if (!asArray(seeds).length) return 0;
  const sum = asArray(seeds).reduce((acc, row) => {
    const seed = seedFromRow(row);
    return acc + Number(seed.scores?.knownNarrativeScore ?? seed.scores?.known_narrative_score ?? 0);
  }, 0);
  return clamp(sum / asArray(seeds).length);
}

function issuerBridgeClosureRateFor(seeds = [], plans = []) {
  if (!asArray(seeds).length) return 0;
  let closed = 0;
  for (const row of asArray(seeds)) {
    const seed = seedFromRow(row);
    const plan = planForSeed(seed, plans);
    const issuerRoutes = asArray(plan.providerRoutePlans).filter((route) => ['issuer_exposure', 'issuer_commentary', 'primary_filing', 'market_validation'].includes(route.evidenceClass));
    if (issuerRoutes.some((route) => asArray(route.issuerUniverse).length || asArray(route.collectionUniverse).length || asArray(route.candidateIssuerUniverse).length)) closed += 1;
  }
  return Number((closed / Math.max(1, asArray(seeds).length)).toFixed(6));
}

function holdoutRate(holdoutValidation = {}) {
  if (Number.isFinite(Number(holdoutValidation.holdoutConfirmationRate))) return clamp(holdoutValidation.holdoutConfirmationRate);
  const rows = asArray(holdoutValidation.items || holdoutValidation);
  if (!rows.length) return 0;
  const confirmed = rows.filter((row) => Number(row.confirmationCount || 0) > Number(row.contradictionCount || 0)).length;
  return Number((confirmed / rows.length).toFixed(6));
}

function negativeSurvivalRate(negativeControls = {}) {
  if (Number.isFinite(Number(negativeControls.negativeControlSurvivalRate))) return clamp(negativeControls.negativeControlSurvivalRate);
  const rows = asArray(negativeControls.items || negativeControls);
  if (!rows.length) return 0;
  const survived = rows.filter((row) => ['SURVIVED', 'CHECKED_NO_DIRECT'].includes(row.survivalStatus)).length;
  return Number((survived / rows.length).toFixed(6));
}

function backfillElasticityFor(backfillLedger = {}) {
  if (Number.isFinite(Number(backfillLedger.backfillElasticity))) return clamp(backfillLedger.backfillElasticity);
  const before = backfillLedger.beforeDistribution;
  const after = backfillLedger.afterDistribution;
  if (!before?.shares || !after?.shares) return 0;
  const classes = new Set([...Object.keys(before.shares), ...Object.keys(after.shares)]);
  let delta = 0;
  for (const cls of classes) delta += Math.abs(Number(after.shares[cls] || 0) - Number(before.shares[cls] || 0));
  return clamp(delta / 2);
}

function underrepresentedFrom(distribution = {}) {
  const out = [];
  for (const [cls, target] of Object.entries(DIVERSITY_TARGETS)) {
    const share = Number(distribution.shares?.[cls] || 0);
    if (Number.isFinite(target.minShare) && share < target.minShare) {
      out.push({ evidenceClass: cls, share, targetShare: target.minShare, deficit: Number((target.minShare - share).toFixed(6)) });
    }
  }
  return out.sort((left, right) => right.deficit - left.deficit);
}

function overrepresentedFrom(distribution = {}) {
  const out = [];
  for (const [cls, target] of Object.entries(DIVERSITY_TARGETS)) {
    const share = Number(distribution.shares?.[cls] || 0);
    if (Number.isFinite(target.maxShare) && share > target.maxShare) {
      out.push({ evidenceClass: cls, share, targetShare: target.maxShare, excess: Number((share - target.maxShare).toFixed(6)) });
    }
  }
  return out.sort((left, right) => right.excess - left.excess);
}

function recommendedClasses(underrepresented = []) {
  return uniqueStrings([
    underrepresented.map((item) => item.evidenceClass),
    BIAS_BACKFILL_CLASSES,
  ], 12);
}

function verdictFor(metrics = {}) {
  if (metrics.knownNarrativeOverlap >= 0.70 && metrics.providerSensitivityScore >= 0.40) {
    return BIAS_VERDICTS.KNOWN_NARRATIVE_OVERFIT;
  }
  if (metrics.sourceCoverageSkew >= 0.65
    && metrics.classDiversityEntropy < 0.45
    && metrics.holdoutConfirmationRate < 0.35) {
    return BIAS_VERDICTS.DATA_LIMITED_BIAS;
  }
  if (metrics.providerSensitivityScore <= 0.20
    && metrics.holdoutConfirmationRate >= 0.50
    && metrics.negativeControlSurvivalRate >= 0.50
    && metrics.issuerBridgeClosureRate >= 0.50) {
    return BIAS_VERDICTS.LIKELY_REAL_BOTTLENECK;
  }
  return BIAS_VERDICTS.INCONCLUSIVE_NEEDS_BACKFILL;
}

function warningList({ distribution, underrepresented, overrepresented, verdict, sourceCoverageSkew }) {
  const warnings = [];
  for (const row of overrepresented) {
    if (row.share >= 0.50) warnings.push({ code: 'seed_diversity_collapse', severity: 'high', message: `${row.evidenceClass} exceeds 50% of the autonomous batch`, evidenceClass: row.evidenceClass });
    else warnings.push({ code: 'class_overrepresented', severity: 'medium', message: `${row.evidenceClass} exceeds diversity target`, evidenceClass: row.evidenceClass });
  }
  if (underrepresented.length) warnings.push({ code: 'underrepresented_bottleneck_classes', severity: 'medium', message: `${underrepresented.length} bottleneck classes below diversity target` });
  if (sourceCoverageSkew >= 0.65) warnings.push({ code: 'source_coverage_skew', severity: 'high', message: 'Seed distribution is sensitive to a narrow source/origin mix' });
  if (verdict === BIAS_VERDICTS.KNOWN_NARRATIVE_OVERFIT) warnings.push({ code: 'known_narrative_overfit', severity: 'high', message: 'Known narrative overlap is too high for report-candidate promotion' });
  if (!distribution.total) warnings.push({ code: 'empty_seed_batch', severity: 'high', message: 'No seeds available for bias diagnosis' });
  return warnings;
}

export function diagnoseSeedBias({
  seeds = [],
  evidencePlans = [],
  sourceCoverage = {},
  providerGaps = [],
  priorReports = [],
  backfillLedger = {},
  marketValidation = {},
  negativeControls = {},
  providerAblations = [],
} = {}) {
  const seedList = asArray(seeds).map(seedFromRow);
  const distribution = classDistribution(seedList);
  const entropy = diversityEntropy(distribution);
  const sourceSkew = sourceCoverageSkewFor(seedList, sourceCoverage);
  const providerSensitivityScore = clamp(
    Number(sourceCoverage.providerSensitivityScore ?? 0)
    || averageProviderSensitivity(providerAblations)
    || providerGapDensity(seedList, providerGaps) * 0.5,
  );
  const backfillElasticity = backfillElasticityFor(backfillLedger);
  const holdoutConfirmationRate = holdoutRate(marketValidation.holdoutValidation || marketValidation);
  const negativeControlSurvivalRate = negativeSurvivalRate(negativeControls);
  const issuerBridgeClosureRate = issuerBridgeClosureRateFor(seedList, evidencePlans);
  const knownNarrativeOverlap = knownNarrativeOverlapFor(seedList);
  const evidenceScarcityIndex = clamp(
    (sourceSkew * 0.35)
    + ((1 - entropy) * 0.25)
    + (providerGapDensity(seedList, providerGaps) * 0.25)
    + ((1 - issuerBridgeClosureRate) * 0.15),
  );
  const underrepresentedClasses = underrepresentedFrom(distribution);
  const overrepresentedClasses = overrepresentedFrom(distribution);
  const recommendedBackfillClasses = recommendedClasses(underrepresentedClasses);
  const recommendedProviderRoutes = recommendedBackfillClasses.map((evidenceClass) => ({
    evidenceClass,
    route: routeEvidenceProvider({
      evidenceClass,
      subject: evidenceClass.replace(/_/g, ' '),
      themes: [],
      queryVariantLimit: 6,
    }),
  }));
  const verdict = verdictFor({
    sourceCoverageSkew: sourceSkew,
    classDiversityEntropy: entropy,
    holdoutConfirmationRate,
    providerSensitivityScore,
    negativeControlSurvivalRate,
    issuerBridgeClosureRate,
    knownNarrativeOverlap,
  });
  return {
    ok: true,
    version: SEED_BIAS_DIAGNOSTICS_VERSION,
    verdict,
    classDistribution: distribution,
    sourceCoverageSkew: sourceSkew,
    providerSensitivityScore,
    backfillElasticity,
    holdoutConfirmationRate,
    negativeControlSurvivalRate,
    issuerBridgeClosureRate,
    classDiversityEntropy: entropy,
    knownNarrativeOverlap,
    evidenceScarcityIndex,
    underrepresentedClasses,
    overrepresentedClasses,
    recommendedBackfillClasses,
    recommendedProviderRoutes,
    priorReportCount: asArray(priorReports).length,
    warnings: warningList({ distribution, underrepresented: underrepresentedClasses, overrepresented: overrepresentedClasses, verdict, sourceCoverageSkew: sourceSkew }),
  };
}

function rankingMap(seeds = []) {
  const out = new Map();
  asArray(seeds).forEach((seed, index) => out.set(seedId(seedFromRow(seed)), index + 1));
  return out;
}

function rankingDelta(base = [], variant = []) {
  const baseRanks = rankingMap(base);
  const variantRanks = rankingMap(variant);
  if (!baseRanks.size) return 0;
  let total = 0;
  for (const [id, rank] of baseRanks.entries()) {
    const variantRank = variantRanks.get(id) || (baseRanks.size + 1);
    total += Math.abs(rank - variantRank) / Math.max(1, baseRanks.size);
  }
  return Number((total / baseRanks.size).toFixed(6));
}

function seedsForCondition(seeds = [], condition = '') {
  const rows = asArray(seeds).map(seedFromRow);
  switch (condition) {
    case 'ontology_removed':
      return rows.filter((seed) => seed.lineage?.source !== 'ontology');
    case 'adjacent_lane_removed':
      return rows.filter((seed) => seed.lineage?.source !== 'adjacent_lane');
    case 'prior_report_artifact_removed':
      return rows.filter((seed) => seed.lineage?.source !== 'report_artifact');
    case 'provider_gap_derived_only':
      return rows.filter((seed) => asArray(seed.providerGaps || seed.biasAudit?.provider_gap_labels).length > 0);
    case 'evidence_gap_ledger_derived_only':
      return rows.filter((seed) => asArray(seed.expectedEvidenceClasses).length > 0 && asArray(seed.lineage?.sourceIds).some((id) => /gap|closure|report/i.test(id)));
    case 'official_government_only':
      return rows.filter((seed) => {
        const text = seedText(seed);
        return /\b(government|official|policy|budget|regulatory|utility|eia|dod|usaspending|sec|filing)\b/i.test(text);
      });
    case 'filing_management_commentary_only':
      return rows.filter((seed) => {
        const text = seedText(seed);
        return /\b(sec|filing|transcript|management|commentary|issuer|earnings)\b/i.test(text);
      });
    case 'trade_media_only':
      return rows.filter((seed) => asArray(seed.biasAudit?.missing_sources).includes('missing_trade_press_source') === false);
    case 'all_sources':
    default:
      return rows;
  }
}

export function runSeedProviderAblation(seeds = [], options = {}) {
  const base = asArray(seeds).map(seedFromRow);
  const conditions = asArray(options.conditions).length ? asArray(options.conditions) : [
    'all_sources',
    'ontology_removed',
    'adjacent_lane_removed',
    'prior_report_artifact_removed',
    'official_government_only',
    'filing_management_commentary_only',
    'trade_media_only',
    'provider_gap_derived_only',
    'evidence_gap_ledger_derived_only',
  ];
  return conditions.map((condition) => {
    const selected = seedsForCondition(base, condition);
    const delta = rankingDelta(base, selected);
    return {
      ablationRunId: `ablate-${stableId([condition, selected.map(seedId).join(',')])}`,
      condition,
      seedCount: selected.length,
      classDistribution: classDistribution(selected),
      topSeeds: selected.slice(0, Number(options.topSeedLimit || 5)).map((seed) => ({
        seedId: seedId(seed),
        title: seedTitle(seed),
        bottleneckClass: seedClass(seed),
        score: seed.scores?.composite_seed_score ?? null,
      })),
      rankingDelta: delta,
      providerSensitivityScore: delta,
    };
  });
}

function averageProviderSensitivity(ablations = []) {
  const rows = asArray(ablations).filter((row) => row.condition !== 'all_sources');
  if (!rows.length) return 0;
  const average = rows.reduce((sum, row) => sum + Number(row.providerSensitivityScore || row.rankingDelta || 0), 0) / rows.length;
  return clamp(average);
}

function seedForBackfillClass(seeds = [], evidenceClass = '') {
  const rows = asArray(seeds).map(seedFromRow);
  return rows.find((seed) => asArray(seed.expectedEvidenceClasses).includes(evidenceClass))
    || rows.find((seed) => seedClass(seed) === evidenceClass)
    || rows[0]
    || {};
}

function backfillQueryFor(seed = {}, evidenceClass = '', route = {}) {
  const subject = compact(seed.bottleneck?.label || seedTitle(seed) || evidenceClass.replace(/_/g, ' '));
  const theme = compact(seed.theme?.label || seed.theme?.key);
  const variants = uniqueStrings([
    route.queryVariants,
    `${subject} ${theme} ${evidenceClass.replace(/_/g, ' ')} official evidence`,
    `${subject} ${theme} ${evidenceClass.replace(/_/g, ' ')} bottleneck validation counter evidence`,
  ], 6);
  return variants;
}

function acceptanceCriteriaFor(evidenceClass = '', seed = {}) {
  const subject = compact(seed.bottleneck?.label || seedTitle(seed) || evidenceClass.replace(/_/g, ' '));
  return {
    evidenceClass,
    requiredTerms: uniqueStrings([
      subject,
      evidenceClass.replace(/_/g, ' '),
      seed.requiredInputs,
      seed.physicalProcess,
    ], 12),
    sourceIndependenceRequired: true,
    duplicateSourceRejected: true,
    staleEvidenceRejected: true,
    targetThemeOntologyCompatibleRequired: true,
    negativeControlPromotionForbidden: evidenceClass === 'negative_control',
    localControlledMarketDataOnly: evidenceClass === 'market_validation',
  };
}

function taskStatusFor({ evidenceClass = '', providerBackfillTask = null, sourceQueryDrafts = [], needsAdapter = false } = {}) {
  if (evidenceClass === 'market_validation') return 'queued_local_market_validation';
  if (needsAdapter) return 'provider_gap_proposal_required';
  if (providerBackfillTask) return 'queued';
  if (asArray(sourceQueryDrafts).length) return 'needs_operator_review';
  return 'provider_gap_proposal_required';
}

function reviewRequiredFor(evidenceClass = '', status = '') {
  if (evidenceClass === 'market_validation') return false;
  return status !== 'queued' || evidenceClass === 'provider_data_gap';
}

export function buildBiasBackfillPlan({
  seeds = [],
  diagnosis = null,
  evidencePlans = [],
  maxQueriesPerClass = 3,
  generatedAt = new Date().toISOString(),
} = {}) {
  const seedList = asArray(seeds).map(seedFromRow);
  const diag = diagnosis || diagnoseSeedBias({ seeds: seedList, evidencePlans });
  const classes = uniqueStrings(diag.recommendedBackfillClasses || BIAS_BACKFILL_CLASSES, 12);
  const tasks = [];
  const reviewItems = [];
  for (const evidenceClass of classes) {
    const seed = seedForBackfillClass(seedList, evidenceClass);
    const subject = compact(seed.bottleneck?.label || evidenceClass.replace(/_/g, ' '));
    const route = routeEvidenceProvider({
      evidenceClass,
      subject,
      target: subject,
      themes: uniqueStrings([seed.theme?.key, seed.theme?.label], 4),
      ontologyKey: seed.theme?.key || '',
      issuerUniverse: seed.issuerUniverse || [],
      candidateIssuerUniverse: seed.supplierCategory?.publicIssuerCandidates || [],
      queryVariantLimit: 8,
    });
    const sourceQueryDrafts = evidenceClass === 'market_validation'
      ? []
      : backfillQueryFor(seed, evidenceClass, route).slice(0, maxQueriesPerClass).map((query, index) => ({
        draftId: `bias-backfill:${seedId(seed) || 'batch'}:${evidenceClass}:${index}`,
        query,
        source: 'seed-bias-backfill',
        createdBy: 'seed-bias-backfill-orchestrator',
        operatorSeedId: seedId(seed) || null,
        desiredEvidenceClass: evidenceClass,
        evidenceClass,
        evidenceUse: evidenceClass === 'negative_control' ? 'negative_control_candidate' : (evidenceClass === 'market_validation' ? 'supporting_context' : 'promotion_candidate'),
        promotionEligible: !['negative_control', 'market_validation', 'provider_data_gap'].includes(evidenceClass),
        providerRoutePlan: route,
      }));
    const providerBackfillTask = evidenceClass === 'market_validation'
      ? {
        taskId: `bias-provider:${seedId(seed) || 'batch'}:${evidenceClass}`,
        operatorSeedId: seedId(seed) || null,
        evidenceClass,
        providers: ['local-market-validation'],
        providerRoutePlan: route,
        status: 'queued_local_market_validation',
        localControlledMarketDataOnly: true,
        sourceQueryPromotionAllowed: false,
      }
      : asArray(route.executableCollectors).some((provider) => provider !== 'source-query')
      ? {
        taskId: `bias-provider:${seedId(seed) || 'batch'}:${evidenceClass}`,
        operatorSeedId: seedId(seed) || null,
        evidenceClass,
        providers: asArray(route.executableCollectors).filter((provider) => provider !== 'source-query'),
        providerRoutePlan: route,
        status: 'queued',
      }
      : null;
    const needsAdapter = evidenceClass === 'provider_data_gap' || (!providerBackfillTask && !sourceQueryDrafts.length);
    if (needsAdapter) {
      reviewItems.push({
        seedId: seedId(seed) || `batch-${evidenceClass}`,
        seedIds: uniqueStrings([seedId(seed)], 5),
        providers: uniqueStrings([evidenceClass === 'provider_data_gap' ? 'trade_media' : route.sourceProviders], 8),
        evidenceClassesBlocked: [evidenceClass],
        sampleQueries: backfillQueryFor(seed, evidenceClass, route),
        theme: seed.theme || {},
      });
    }
    const status = taskStatusFor({ evidenceClass, providerBackfillTask, sourceQueryDrafts, needsAdapter });
    const acceptanceCriteria = acceptanceCriteriaFor(evidenceClass, seed);
    tasks.push({
      taskId: `bias-task-${stableId([evidenceClass, seedId(seed), subject])}`,
      evidenceClass,
      seedId: seedId(seed) || null,
      subject,
      providerRoute: route.providerRoute,
      providers: uniqueStrings(route.executableCollectors, 8),
      sourceProviders: uniqueStrings(route.sourceProviders, 12),
      providerBackfillTask,
      sourceQueryDrafts,
      sourceQuery: sourceQueryDrafts[0]?.query || '',
      acceptanceCriteria,
      adapterProposalRequired: needsAdapter,
      status,
      createdAt: generatedAt,
      mutationBoundary: {
        seedBiasLedgerWrites: true,
        canonicalWrites: false,
        sourceRegistryWrites: false,
        providerActivationWrites: false,
        investmentReportPromotionWrites: false,
      },
      reviewRequired: reviewRequiredFor(evidenceClass, status),
      promotionEligible: !['negative_control', 'market_validation', 'provider_data_gap'].includes(evidenceClass),
      contaminationWarnings: asArray(evidencePlans)
        .flatMap((plan) => asArray(plan.contaminationWarnings || plan.contaminationGuard?.warnings))
        .filter((warning) => !warning?.seedId || warning.seedId === seedId(seed)),
    });
  }
  if (seedList.length) {
    const seed = seedList[0];
    tasks.push({
      taskId: `bias-task-${stableId(['holdout_validation', seedId(seed), diag.verdict])}`,
      evidenceClass: 'holdout_validation',
      seedId: seedId(seed) || null,
      subject: compact(seed.bottleneck?.label || seedTitle(seed) || 'holdout validation'),
      providerRoute: 'holdout-validation',
      providers: ['official-holdout', 'filing-management-commentary', 'government-official', 'trade-media'],
      sourceProviders: ['sec-ir-transcript', 'official-government', 'trade-media', 'provider-feed'],
      providerBackfillTask: {
        taskId: `bias-provider:${seedId(seed) || 'batch'}:holdout_validation`,
        operatorSeedId: seedId(seed) || null,
        evidenceClass: 'holdout_validation',
        providers: ['official-holdout', 'filing-management-commentary', 'government-official', 'trade-media'],
        status: 'queued',
      },
      sourceQueryDrafts: [],
      sourceQuery: '',
      acceptanceCriteria: {
        evidenceClass: 'holdout_validation',
        sourceGroupMustDifferFromGeneration: true,
        contradictionCountTracked: true,
      },
      adapterProposalRequired: false,
      status: 'queued',
      createdAt: generatedAt,
      mutationBoundary: {
        seedBiasLedgerWrites: true,
        canonicalWrites: false,
        sourceRegistryWrites: false,
        providerActivationWrites: false,
        investmentReportPromotionWrites: false,
      },
      reviewRequired: false,
      promotionEligible: false,
    });
  }
  const adapterProposals = buildProviderAdapterProposalsFromReviewItems(reviewItems, { minSeedCount: 1 });
  return {
    ok: true,
    version: SEED_BIAS_DIAGNOSTICS_VERSION,
    verdict: diag.verdict,
    recommendedBackfillClasses: classes,
    taskCount: tasks.length,
    tasks,
    adapterProposals,
    mutationPolicy: {
      dryRunDefault: true,
      approvalQueueWrites: 0,
      reportBackfillWrites: 0,
      researchEvidenceBundleWrites: 0,
      canonicalWrites: 0,
      sourceRegistryWrites: 0,
      providerActivationWrites: 0,
    },
  };
}

export function evaluateHoldoutValidation(seeds = [], holdoutEvidence = [], options = {}) {
  const rows = asArray(seeds).map(seedFromRow).slice(0, Number(options.limit || 25));
  const evidenceRows = asArray(holdoutEvidence);
  const items = rows.map((seed) => {
    const text = seedText(seed).toLowerCase();
    const matched = evidenceRows.filter((evidence) => {
      const evidenceText = compact([evidence.title, evidence.summary, evidence.text, evidence.evidenceClass, evidence.desiredEvidenceClass].join(' ')).toLowerCase();
      return asArray(seed.requiredInputs).some((input) => evidenceText.includes(compact(input).toLowerCase()))
        || evidenceText.includes(compact(seed.bottleneck?.label).toLowerCase())
        || (evidence.evidenceClass && asArray(seed.expectedEvidenceClasses).includes(evidence.evidenceClass))
        || (text && evidenceText && text.includes(evidenceText.slice(0, 32)));
    });
    const contradictionCount = matched.filter((evidence) => /contradict|invalid|no shortage|oversupply|no exposure/i.test(compact([evidence.summary, evidence.text, evidence.title].join(' ')))).length;
    const confirmationCount = Math.max(0, matched.length - contradictionCount);
    return {
      seedId: seedId(seed),
      holdoutSourceGroup: options.holdoutSourceGroup || 'official_holdout',
      matchedEvidenceClasses: uniqueStrings(matched.map((item) => item.evidenceClass || item.desiredEvidenceClass), 20),
      confirmationCount,
      contradictionCount,
      confirmed: confirmationCount > contradictionCount,
      holdoutConfirmed: confirmationCount > contradictionCount,
      holdoutConfirmationRate: matched.length ? Number((confirmationCount / matched.length).toFixed(6)) : 0,
      sourceGroupsUsed: uniqueStrings(matched.map((item) => item.sourceGroup || item.provider || item.sourceType || item.source), 20),
    };
  });
  const holdoutConfirmationRate = holdoutRate(items);
  return {
    ok: true,
    items,
    holdoutConfirmed: items.some((item) => item.holdoutConfirmed),
    holdoutConfirmationRate,
    matchedEvidenceClasses: uniqueStrings(items.flatMap((item) => item.matchedEvidenceClasses), 80),
    contradictionCount: items.reduce((sum, item) => sum + Number(item.contradictionCount || 0), 0),
    sourceGroupsUsed: uniqueStrings(items.flatMap((item) => item.sourceGroupsUsed), 80),
  };
}

function negativeQueries(seed = {}) {
  const subject = compact(seed.bottleneck?.label || seedTitle(seed));
  return uniqueStrings([
    seed.counterEvidenceQueries,
    `${subject} easy substitute`,
    `${subject} supplier redundancy`,
    `${subject} no timing pressure`,
    `${subject} no capacity constraint`,
    `${subject} oversupply`,
    `${subject} no issuer exposure`,
    `${subject} margin not affected`,
    `${subject} backlog not affected`,
    `${subject} management denies constraint`,
  ], 12);
}

export function evaluateNegativeControlSurvival(seeds = [], evidence = [], options = {}) {
  const rows = asArray(seeds).map(seedFromRow).slice(0, Number(options.limit || 25));
  const evidenceRows = asArray(evidence);
  const items = rows.map((seed) => {
    const queries = negativeQueries(seed);
    const matched = evidenceRows.filter((item) => item.operatorSeedId === seedId(seed) || item.seedId === seedId(seed) || item.evidenceClass === 'negative_control');
    const checkedNoDirect = matched.filter((item) => /checked_no_direct|no direct invalidator|no direct contradiction/i.test(compact([item.finding, item.summary, item.text, item.title].join(' '))));
    const supporters = matched.filter((item) => /supported_constraint|constraint supported|shortage confirmed|constraint remains/i.test(compact([item.finding, item.summary, item.text, item.title].join(' '))));
    const invalidators = matched.filter((item) => {
      const text = compact([item.finding, item.summary, item.text, item.title].join(' '));
      return !/supported_constraint|checked_no_direct|no direct invalidator|no direct contradiction|constraint supported|shortage confirmed/i.test(text)
        && /invalidator|easy substitute|redundancy|no capacity|oversupply|denies constraint|no exposure/i.test(text);
    });
    let survivalStatus = NEGATIVE_CONTROL_SURVIVAL_STATUSES.INCONCLUSIVE;
    let survivalReason = 'negative control has not produced accepted evidence';
    if (invalidators.length) {
      survivalStatus = NEGATIVE_CONTROL_SURVIVAL_STATUSES.REJECTED;
      survivalReason = 'negative-control invalidator matched';
    } else if (supporters.length) {
      survivalStatus = NEGATIVE_CONTROL_SURVIVAL_STATUSES.SURVIVED;
      survivalReason = 'negative-control search supports constraint';
    } else if (checkedNoDirect.length) {
      survivalStatus = NEGATIVE_CONTROL_SURVIVAL_STATUSES.CHECKED_NO_DIRECT;
      survivalReason = 'negative-control search found no direct invalidator';
    } else if (matched.length) {
      survivalStatus = NEGATIVE_CONTROL_SURVIVAL_STATUSES.WEAKENED;
      survivalReason = 'negative-control evidence is weak or incomplete';
    }
    return {
      seedId: seedId(seed),
      negativeControlQueries: queries,
      negativeControlEvidence: matched,
      survivalStatus,
      survivalReason,
    };
  });
  return {
    ok: true,
    items,
    negativeControlSurvivalRate: negativeSurvivalRate(items),
  };
}

function routeCount(plan = {}) {
  return asArray(plan.providerRoutePlans).filter((route) => !route.blocked).length;
}

function criticalDraftClasses(plan = {}) {
  return new Set(asArray(plan.sourceQueryDrafts).map((draft) => draft.desiredEvidenceClass || draft.evidenceClass).filter(Boolean));
}

function evidenceForSeed(rows = [], seed = {}) {
  const id = seedId(seed);
  return asArray(rows).filter((item) => !item.seedId || !id || item.seedId === id || item.operatorSeedId === id);
}

function holdoutForSeed(holdout = {}, seed = {}) {
  const id = seedId(seed);
  const item = asArray(holdout.items).find((row) => row.seedId === id);
  if (item) return item;
  return holdout;
}

function negativeForSeed(negative = {}, seed = {}) {
  const id = seedId(seed);
  const item = asArray(negative.items).find((row) => row.seedId === id);
  if (item) return item;
  return negative;
}

function hasIssuerBridge(seed = {}, plan = {}, context = {}) {
  if (context.issuerBridgeClosed === true) return true;
  if (context.issuerBridge?.closed === true || context.issuerBridge?.status === 'closed') return true;
  if (asArray(context.issuerUniverse).length) return true;
  if (asArray(seed.supplierCategory?.publicIssuerCandidates).length) return true;
  return asArray(plan.providerRoutePlans).some((route) => (
    asArray(route.candidateIssuerUniverse).length
    || asArray(route.collectionUniverse).length
    || asArray(route.issuerUniverse).length
  ));
}

function hasMarketValidation(context = {}) {
  const market = context.marketValidation || {};
  return Boolean(
    market.localControlledMarketData === true
    || market.status === 'closed'
    || ['decision_grade', 'screening_grade', 'weak_screen'].includes(market.tier || market.marketTier)
    || Number(market.acceptedEvidenceCount || 0) > 0,
  );
}

function acceptedSourceKey(row = {}) {
  return compact(row.source || row.provider || row.sourceProvider || row.sourceUrl || row.url || row.evidenceId || row.id).toLowerCase();
}

function independentAcceptedSourceCount(rows = []) {
  return uniqueStrings(asArray(rows).map(acceptedSourceKey), 20).length;
}

export function evaluateAutonomousSeedReportCandidateGate(rowOrSeed = {}, context = {}) {
  const seed = seedFromRow(rowOrSeed);
  const plan = context.evidencePlan || rowOrSeed.evidence_plan || rowOrSeed.evidencePlan || buildRouteAwareSeedEvidencePlan(seed);
  const closure = context.closure || summarizeOperatorSeedClosure({ ...rowOrSeed, seed_json: seed, evidence_plan: plan });
  const diagnosis = context.biasDiagnosis || {};
  const negative = negativeForSeed(context.negativeControlSurvival || {}, seed);
  const holdout = holdoutForSeed(context.holdoutValidation || {}, seed);
  const acceptedEvidence = evidenceForSeed(context.acceptedEvidence || context.accepted_evidence || rowOrSeed.acceptedEvidence || [], seed);
  const rawEvidence = evidenceForSeed(context.rawEvidence || context.raw_evidence || rowOrSeed.rawEvidence || [], seed);
  const blockers = [];
  const warnings = [];
  const source = compact(seed.lineage?.source || rowOrSeed.lineage?.source || '');
  const knownNarrativeScore = Number(seed.scores?.knownNarrativeScore ?? 0);
  const seedSimilarityScore = Number(seed.scores?.seedSimilarityScore ?? seed.biasAudit?.seed_dependence_score ?? 0);
  const routeTotal = routeCount(plan);
  const drafts = criticalDraftClasses(plan);
  const requiredDrafts = ['mechanism_validation', 'negative_control'];

  if (!seed.theme?.label && !seed.theme?.key) blockers.push('missing_theme');
  if (!seed.growthDriver || !seed.realActivity || !seed.physicalProcess || !asArray(seed.requiredInputs).length) blockers.push('mechanism_chain_incomplete');
  if (!seed.bottleneck?.label) blockers.push('missing_bottleneck_node');
  if (!plan.routeAware) blockers.push('missing_route_aware_evidence_plan');
  if (!asArray(seed.counterEvidenceQueries).length && !asArray(plan.negativeControlDrafts).length) blockers.push('missing_negative_control_query');
  if (routeTotal < 2) blockers.push('insufficient_evidence_routes');
  for (const evidenceClass of requiredDrafts) {
    if (!drafts.has(evidenceClass)) blockers.push(`missing_source_query_draft:${evidenceClass}`);
  }
  if (context.requireAutonomous === true && /manual|user|prompt|direct/i.test(source)) blockers.push('manual_or_prompt_origin_not_autonomous');
  if (knownNarrativeScore >= Number(context.knownNarrativeThreshold ?? 0.65)) blockers.push('known_narrative_overfit');
  if (seedSimilarityScore >= Number(context.seedSimilarityThreshold ?? 0.75)) blockers.push('seed_similarity_too_high');
  if (diagnosis.verdict === BIAS_VERDICTS.KNOWN_NARRATIVE_OVERFIT) blockers.push('bias_diagnosis_known_narrative_overfit');
  if (diagnosis.verdict === BIAS_VERDICTS.DATA_LIMITED_BIAS && !context.targetedBackfillRan) blockers.push('data_limited_bias_requires_targeted_backfill');
  const holdoutConfirmed = Boolean(holdout.holdoutConfirmed || holdout.confirmed)
    || Number(holdout.confirmationCount || 0) > Number(holdout.contradictionCount || 0);
  const negativeClosed = ['SURVIVED', 'CHECKED_NO_DIRECT'].includes(negative.survivalStatus);
  if (diagnosis.verdict === BIAS_VERDICTS.LIKELY_REAL_BOTTLENECK && (!holdoutConfirmed || !negativeClosed)) blockers.push('likely_real_bottleneck_requires_holdout_and_negative_survival');
  const negativeClosure = closure.negativeControl?.closure || closure.negativeControl?.status || 'unchecked';
  if (negativeClosure === 'invalidator' || negative.survivalStatus === 'REJECTED') blockers.push('negative_control_rejected');
  if (!negativeClosed) blockers.push('negative_control_not_closed');
  if (!holdoutConfirmed) blockers.push('holdout_confirmation_missing');
  if (!acceptedEvidence.length) blockers.push('accepted_evidence_missing');
  if (acceptedEvidence.length && independentAcceptedSourceCount(acceptedEvidence) < Number(context.minAcceptedSourceCount || 2)) blockers.push('independent_source_breadth_missing');
  if (rawEvidence.length && !acceptedEvidence.length) blockers.push('raw_only_evidence_not_promotable');
  if (!hasIssuerBridge(seed, plan, context)) blockers.push('issuer_bridge_missing');
  if (!hasMarketValidation(context)) blockers.push('market_validation_missing');
  if (!asArray(seed.supplierCategory?.publicIssuerCandidates).length && !asArray(plan.providerRoutePlans).some((route) => asArray(route.candidateIssuerUniverse).length || asArray(route.collectionUniverse).length)) {
    warnings.push('no_issuer_universe_monitor_only');
  }
  return {
    ok: blockers.length === 0,
    gate: blockers.length ? 'blocked' : 'report_candidate_allowed',
    blockers: uniqueStrings(blockers, 40),
    warnings: uniqueStrings(warnings, 40),
    visualStatus: blockers.length ? 'pending' : 'review-ready',
    reason: blockers.length ? `blocked: ${uniqueStrings(blockers, 6).join(', ')}` : 'autonomous seed passed report-candidate gate',
  };
}

export function buildBiasBackfillResults(plan = {}, options = {}) {
  const plannedRawEvidence = asArray(plan.tasks).map((task) => ({
    evidenceId: `raw-${task.taskId}`,
    evidenceClass: task.evidenceClass,
    seedId: task.seedId,
    taskId: task.taskId,
    source: 'seed-bias-backfill-dry-run',
    providerRoute: task.providerRoute,
    queryCount: asArray(task.sourceQueryDrafts).length,
    providerCount: asArray(task.providers).length,
    rawStored: true,
    accepted: false,
    acceptanceVerdict: 'not_evaluated_dry_run',
  }));
  const rawInput = [
    plannedRawEvidence,
    options.rawEvidence,
    asArray(options.acceptedEvidence).map((item) => ({
      ...item,
      accepted: item.accepted === true,
    })),
  ].flatMap(asArray);
  const accepted = acceptSeedEvidenceRows(rawInput, {
    tasks: asArray(plan.tasks),
    now: options.now ? new Date(options.now) : new Date(),
    maxAgeDays: options.maxAgeDays,
  });
  const coveredEvidenceClasses = coveredEvidenceClassesFromAccepted(accepted.acceptedEvidence);
  return {
    ok: true,
    rawEvidence: accepted.rawEvidence,
    acceptedEvidence: accepted.acceptedEvidence,
    rawEvidenceStoredCount: accepted.rawEvidenceStoredCount,
    acceptedEvidenceStoredCount: accepted.acceptedEvidenceStoredCount,
    coveredEvidenceClasses,
    readinessChanged: accepted.acceptedEvidenceStoredCount > 0,
    acceptanceBoundary: 'raw evidence is never promoted until evidence-class acceptance rules pass',
  };
}

export function buildBiasSelfImprovement({
  diagnosis = {},
  backfillPlan = {},
  ablations = [],
  gateResults = [],
} = {}) {
  const items = [];
  for (const warning of asArray(diagnosis.warnings)) {
    items.push({
      kind: warning.code,
      severity: warning.severity,
      message: warning.message,
      nextAction: warning.code === 'seed_diversity_collapse'
        ? 'increase generation and backfill priority for underrepresented bottleneck classes; do not promote synthetic diversity'
        : 'run targeted backfill and re-run bias diagnosis',
    });
  }
  if (diagnosis.verdict === BIAS_VERDICTS.DATA_LIMITED_BIAS || diagnosis.verdict === BIAS_VERDICTS.INCONCLUSIVE_NEEDS_BACKFILL) {
    items.push({
      kind: 'targeted_backfill_required',
      severity: 'high',
      message: `Bias verdict ${diagnosis.verdict} requires targeted backfill before ranking/readiness upgrades`,
      nextAction: 'review seed-bias-backfill-plan tasks and run provider/source-query lanes without promotion',
    });
  }
  for (const result of asArray(gateResults).filter((item) => item.gate === 'blocked')) {
    items.push({
      kind: 'report_candidate_gate_blocked',
      severity: 'medium',
      seedId: result.seedId,
      message: result.reason,
      nextAction: 'resolve blockers before report_candidate transition',
    });
  }
  return {
    ok: true,
    version: SEED_BIAS_DIAGNOSTICS_VERSION,
    itemCount: items.length,
    items,
    ablationCount: asArray(ablations).length,
    backfillTaskCount: asArray(backfillPlan.tasks).length,
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
