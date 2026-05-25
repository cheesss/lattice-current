import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

export const DEFAULT_OPERATOR_CROSS_THEME_PRIOR_PATH = path.join(process.cwd(), 'config', 'operator-cross-theme-prior.json');
export const OPERATOR_CROSS_THEME_PRIOR_VERSION = 'user-cross-theme-prior-v1';

const REPRESENTATIVE_TICKERS = new Set([
  'NVDA',
  'MSFT',
  'GOOGL',
  'GOOG',
  'META',
  'VRT',
  'ETN',
  'PWR',
  'LMT',
  'RTX',
  'TSM',
  'ASML',
  'AMD',
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
  const number = Number(value);
  const finite = Number.isFinite(number) ? number : min;
  return Math.max(min, Math.min(max, finite));
}

function textBlob(...values) {
  return values.flatMap(asArray).map((value) => {
    if (typeof value === 'string' || typeof value === 'number') return String(value);
    if (value && typeof value === 'object') return JSON.stringify(value);
    return '';
  }).join(' ');
}

function normalize(value = '') {
  return compact(value).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function uniqueStrings(values = [], limit = 80) {
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

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, 'utf8'));
}

function seedText(seed = {}) {
  return normalize(textBlob(
    seed.seedTitle,
    seed.theme?.key,
    seed.theme?.label,
    seed.growthDriver,
    seed.realActivity,
    seed.physicalProcess,
    seed.requiredInputs,
    seed.bottleneck,
    seed.supplierCategory,
    seed.evidenceQueries,
    seed.counterEvidenceQueries,
    seed.expectedEvidenceClasses,
    seed.lineage,
  ));
}

function termHit(text = '', term = '') {
  const normalized = normalize(term);
  if (!normalized) return false;
  return text.includes(normalized);
}

function distinctiveTokens(value = '') {
  const stop = new Set([
    'capacity',
    'supply',
    'supplier',
    'qualified',
    'bottleneck',
    'constraint',
    'process',
    'throughput',
    'lead',
    'time',
    'demand',
    'rising',
    'needs',
    'more',
  ]);
  return normalize(value).split(' ')
    .filter((part) => part.length >= 5 && !stop.has(part));
}

function fuzzyPhraseHit(text = '', value = '', minHits = 2) {
  if (termHit(text, value)) return true;
  const tokens = distinctiveTokens(value);
  if (!tokens.length) return false;
  const hits = tokens.filter((part) => text.includes(part)).length;
  return hits >= Math.min(minHits, tokens.length);
}

function seedClass(seed = {}) {
  return compact(seed.bottleneck?.class || seed.bottleneckClass || asArray(seed.expectedEvidenceClasses)[0] || 'mechanism_validation');
}

function representativeTickerPenalty(seed = {}) {
  const tickers = uniqueStrings([
    seed.suppressedRepresentativeTickers,
    seed.supplierCategory?.publicIssuerCandidates,
    seed.issuerCandidates,
    seed.issuerUniverse,
  ], 20).map((item) => item.toUpperCase());
  return clamp(tickers.filter((ticker) => REPRESENTATIVE_TICKERS.has(ticker)).length / 3);
}

function parentSimilarity(left = {}, right = {}) {
  const leftTerms = new Set(seedText(left).split(/\s+/).filter((term) => term.length >= 4));
  const rightTerms = new Set(seedText(right).split(/\s+/).filter((term) => term.length >= 4));
  if (!leftTerms.size || !rightTerms.size) return 0;
  let overlap = 0;
  for (const term of leftTerms) if (rightTerms.has(term)) overlap += 1;
  return clamp(overlap / Math.max(leftTerms.size, rightTerms.size));
}

function classDistribution(seeds = []) {
  const counts = {};
  for (const seed of asArray(seeds)) {
    const klass = seedClass(seed);
    counts[klass] = (counts[klass] || 0) + 1;
  }
  return counts;
}

function underrepresentedClassBonus(seed = {}, allSeeds = []) {
  const counts = classDistribution(allSeeds);
  const total = Math.max(1, asArray(allSeeds).length);
  const share = Number(counts[seedClass(seed)] || 0) / total;
  return clamp(1 - share * 2);
}

function weirdConnectorScore(seed = {}) {
  const text = seedText(seed);
  let score = 0;
  if (/\b(helium|vacuum|warpage|underfill|mold compound|probe card|test socket|binder|permitting|relay|tungsten|tantalum|haleu|rare gas)\b/i.test(text)) score += 0.55;
  if (Number(seed.scores?.non_obviousness || 0) >= 0.55) score += 0.25;
  if (Number(seed.scores?.knownNarrativeScore || 0) <= 0.45) score += 0.2;
  return clamp(score);
}

function providerGapDerivedScore(seed = {}) {
  const gaps = uniqueStrings([seed.providerGaps, seed.biasAudit?.provider_gap_labels], 20);
  const reportOverlap = Number(seed.scores?.priorReportOverlap || 0);
  return clamp((gaps.length ? 0.65 : 0) + reportOverlap * 0.35);
}

export function loadOperatorCrossThemePrior(options = {}) {
  const filePath = options.path || DEFAULT_OPERATOR_CROSS_THEME_PRIOR_PATH;
  if (!existsSync(filePath)) {
    return {
      version: OPERATOR_CROSS_THEME_PRIOR_VERSION,
      role: 'exploration_prior_only',
      promotionPolicy: {
        canRaiseSeedGenerationPriority: true,
        canRaiseReportReadiness: false,
        canRaiseInvestmentReadiness: false,
      },
      themePairPriors: [],
      scoring: {},
      selectionPolicy: {
        disableTopOneParentSelection: true,
        parentPoolSize: 10,
        selectionMethod: 'mmr_stratified',
      },
    };
  }
  const prior = readJson(filePath);
  validateOperatorCrossThemePrior(prior);
  return prior;
}

export function validateOperatorCrossThemePrior(prior = {}) {
  if (prior.version !== OPERATOR_CROSS_THEME_PRIOR_VERSION) {
    throw new Error(`[operator-cross-theme-prior] expected version ${OPERATOR_CROSS_THEME_PRIOR_VERSION}`);
  }
  if (prior.role !== 'exploration_prior_only') {
    throw new Error('[operator-cross-theme-prior] role must be exploration_prior_only');
  }
  if (prior.promotionPolicy?.canRaiseReportReadiness !== false || prior.promotionPolicy?.canRaiseInvestmentReadiness !== false) {
    throw new Error('[operator-cross-theme-prior] prior cannot raise report or investment readiness');
  }
  if (!asArray(prior.themePairPriors).length) {
    throw new Error('[operator-cross-theme-prior] at least one themePairPrior is required');
  }
  return { ok: true };
}

export function scoreUserCrossThemePriorFit(seed = {}, prior = loadOperatorCrossThemePrior()) {
  const text = seedText(seed);
  const seedThemes = uniqueStrings([seed.theme?.key, seed.theme?.label, seed.lineage?.themes], 10).map(normalize);
  const seedKlass = seedClass(seed);
  const matches = [];
  for (const item of asArray(prior.themePairPriors)) {
    const themeHits = asArray(item.themes).filter((theme) => {
      const normalized = normalize(theme);
      return seedThemes.some((seedTheme) => seedTheme.includes(normalized) || normalized.includes(seedTheme))
        || termHit(text, theme);
    });
    const connectorClassFit = asArray(item.connectorClasses).includes(seedKlass) ? 1 : 0;
    const preferredNodeHits = asArray(item.preferredNodes).filter((node) => fuzzyPhraseHit(text, node, 2));
    const avoidNarrativeHits = asArray(item.avoidNarratives).filter((narrative) => fuzzyPhraseHit(text, narrative, 2));
    const evidenceClassFit = asArray(item.evidenceClasses).filter((klass) => asArray(seed.expectedEvidenceClasses).includes(klass)).length;
    const themeScore = clamp(themeHits.length / Math.max(2, asArray(item.themes).length));
    const nodeScore = clamp(preferredNodeHits.length / Math.max(1, asArray(item.preferredNodes).length), 0, 0.45);
    const evidenceScore = clamp(evidenceClassFit / Math.max(1, asArray(item.evidenceClasses).length), 0, 0.2);
    const requiredThemeHits = Math.min(2, Math.max(1, asArray(item.themes).length));
    const hasStrongThemeAnchor = themeHits.length >= requiredThemeHits;
    const hasSemanticAnchor = hasStrongThemeAnchor || preferredNodeHits.length > 0 || avoidNarrativeHits.length > 0;
    const unanchoredUtilityFit = connectorClassFit * 0.22 + evidenceScore;
    const fit = hasSemanticAnchor
      ? clamp(themeScore * 0.38 + connectorClassFit * 0.22 + nodeScore + evidenceScore - (avoidNarrativeHits.length ? 0.35 : 0))
      : 0;
    if (hasSemanticAnchor && (fit > 0 || themeHits.length || preferredNodeHits.length || avoidNarrativeHits.length)) {
      matches.push({
        id: item.id,
        themes: item.themes,
        themeHits,
        connectorClassFit,
        preferredNodeHits,
        avoidNarrativeHits,
        fit,
        unanchoredUtilityFit,
      });
    }
  }
  const best = matches.slice().sort((left, right) => right.fit - left.fit)[0] || null;
  const avoidNarrativeHit = matches.some((item) => item.avoidNarrativeHits.length);
  const knownNarrativeScore = Number(seed.scores?.knownNarrativeScore || 0);
  return {
    userCrossThemePriorFit: clamp(best?.fit || 0),
    matchedUserPriorIds: uniqueStrings(matches.filter((item) => item.fit > 0).map((item) => item.id), 12),
    matchedDistantThemes: uniqueStrings(matches.flatMap((item) => item.themes), 20),
    connectorClassFit: clamp(best?.connectorClassFit || 0),
    preferredNodeMatch: uniqueStrings(matches.flatMap((item) => item.preferredNodeHits), 20),
    avoidNarrativeHit,
    parentOnlyDueToKnownNarrative: avoidNarrativeHit || knownNarrativeScore >= 0.65,
    role: prior.role || 'exploration_prior_only',
    canRaiseReportReadiness: false,
    canRaiseInvestmentReadiness: false,
  };
}

export function scoreParentSeedSelection(seed = {}, allSeeds = [], options = {}) {
  const prior = options.crossThemePrior || loadOperatorCrossThemePrior();
  const priorFit = seed.scores?.userCrossThemePriorFit ?? scoreUserCrossThemePriorFit(seed, prior).userCrossThemePriorFit;
  const evidenceability = Number(seed.scores?.evidenceability || 0);
  const nonObviousness = Number(seed.scores?.non_obviousness || 0);
  const bottleneckSpecificity = Number(seed.scores?.bottleneck_specificity || 0);
  const underrepresented = underrepresentedClassBonus(seed, allSeeds);
  const sourceNovelty = Number(seed.scores?.sourceNoveltyScore || 0);
  const priorReportOverlap = Number(seed.scores?.priorReportOverlap || 0);
  const repTickerPenalty = Number(seed.scores?.tickerObviousnessPenalty || representativeTickerPenalty(seed));
  const knownNarrativePenalty = Number(seed.scores?.knownNarrativePenalty || 0);
  const base = (
    evidenceability * 0.35
    + nonObviousness * 0.25
    + bottleneckSpecificity * 0.20
    + underrepresented * 0.10
    + sourceNovelty * 0.10
    + priorFit * Number(prior.scoring?.userPriorFitWeightMax ?? 0.15)
    - priorReportOverlap * 0.30
    - repTickerPenalty * 0.25
    - knownNarrativePenalty * 0.25
  );
  return {
    parentSelectionScore: clamp(base, -1, 1),
    userCrossThemePriorFit: priorFit,
    underrepresentedClassBonus: underrepresented,
    sourceNoveltyScore: sourceNovelty,
    priorReportOverlap,
    representativeTickerPenalty: repTickerPenalty,
    knownNarrativePenalty,
    weirdConnectorScore: weirdConnectorScore(seed),
    providerGapDerivedScore: providerGapDerivedScore(seed),
  };
}

function annotate(seed = {}, patch = {}) {
  return {
    ...seed,
    scores: {
      ...(seed.scores || {}),
      ...patch.scores,
    },
    parentSelection: {
      ...(seed.parentSelection || {}),
      ...patch.parentSelection,
    },
    metadata: {
      ...(seed.metadata || {}),
      ...patch.metadata,
    },
  };
}

function bucketSpecs(prior = {}) {
  const targets = prior.selectionPolicy?.bucketTargets || {};
  return [
    {
      key: 'high_evidenceability',
      target: Number(targets.high_evidenceability ?? 3),
      score: (seed, all) => scoreParentSeedSelection(seed, all, { crossThemePrior: prior }).parentSelectionScore + Number(seed.scores?.evidenceability || 0),
      reason: 'high evidenceability and executable evidence route potential',
    },
    {
      key: 'high_novelty_low_prior_overlap',
      target: Number(targets.high_novelty_low_prior_overlap ?? 2),
      score: (seed, all) => Number(seed.scores?.sourceNoveltyScore || 0) + Number(seed.scores?.non_obviousness || 0) - Number(seed.scores?.priorReportOverlap || 0),
      reason: 'high novelty with low prior report overlap',
    },
    {
      key: 'underrepresented_bottleneck_class',
      target: Number(targets.underrepresented_bottleneck_class ?? 3),
      score: (seed, all) => underrepresentedClassBonus(seed, all) + Number(seed.scores?.bottleneck_specificity || 0),
      reason: 'adds an underrepresented bottleneck class to the parent pool',
    },
    {
      key: 'weird_low_frequency_connector',
      target: Number(targets.weird_low_frequency_connector ?? 1),
      score: (seed) => weirdConnectorScore(seed),
      reason: 'low-frequency connector with non-obvious physical/process node',
    },
    {
      key: 'failed_report_provider_gap_derived',
      target: Number(targets.failed_report_provider_gap_derived ?? 1),
      score: (seed) => providerGapDerivedScore(seed),
      reason: 'derived from provider gap, failed report, or missing source ledger',
    },
  ];
}

function selectForBucket(candidates = [], selected = [], spec = {}, allSeeds = [], prior = {}, lambda = 0.35) {
  const selectedIds = new Set(selected.map((seed) => seed.seedId));
  return candidates
    .filter((seed) => !selectedIds.has(seed.seedId))
    .map((seed) => {
      const baseScore = spec.score(seed, allSeeds);
      const similarity = selected.length ? Math.max(...selected.map((item) => parentSimilarity(seed, item))) : 0;
      return {
        seed,
        score: baseScore - lambda * similarity,
        similarity,
      };
    })
    .sort((left, right) => right.score - left.score)
    .map((item) => item.seed);
}

export function selectDiversifiedParentSeedPool(seeds = [], options = {}) {
  const prior = options.crossThemePrior || loadOperatorCrossThemePrior(options);
  const policy = prior.selectionPolicy || {};
  const rawPoolSize = Number(options.parentPoolSize || policy.parentPoolSize || 10);
  const parentPoolSize = Math.max(8, Math.min(12, rawPoolSize));
  const lambda = Number(options.mmrLambda ?? policy.mmrLambda ?? 0.35);
  const candidates = asArray(seeds)
    .filter((seed) => seed && seed.status !== 'rejected')
    .map((seed) => {
      const priorFit = scoreUserCrossThemePriorFit(seed, prior);
      const parentScore = scoreParentSeedSelection({
        ...seed,
        scores: { ...(seed.scores || {}), ...priorFit },
      }, seeds, { crossThemePrior: prior });
      const parentOnlyDueToKnownNarrative = priorFit.parentOnlyDueToKnownNarrative
        || Number(seed.scores?.knownNarrativeScore || 0) >= 0.65;
      return annotate(seed, {
        scores: {
          ...priorFit,
          parentSelectionScore: parentScore.parentSelectionScore,
          underrepresentedClassBonus: parentScore.underrepresentedClassBonus,
          representativeTickerPenalty: parentScore.representativeTickerPenalty,
        },
        parentSelection: {
          parentOnlyDueToKnownNarrative,
          directReportCandidateAllowed: !parentOnlyDueToKnownNarrative,
          selectionMethod: policy.selectionMethod || 'mmr_stratified',
        },
        metadata: {
          parentOnlyDueToKnownNarrative,
        },
      });
    });
  const selected = [];
  const buckets = bucketSpecs(prior);
  for (const spec of buckets) {
    const picks = selectForBucket(candidates, selected, spec, candidates, prior, lambda).slice(0, Math.max(0, spec.target));
    for (const pick of picks) {
      if (selected.length >= parentPoolSize) break;
      selected.push(annotate(pick, {
        parentSelection: {
          parentSelectionBucket: spec.key,
          parentSelectionReason: spec.reason,
        },
      }));
    }
  }
  while (selected.length < parentPoolSize) {
    const next = selectForBucket(candidates, selected, {
      score: (seed, all) => scoreParentSeedSelection(seed, all, { crossThemePrior: prior }).parentSelectionScore,
    }, candidates, prior, lambda)[0];
    if (!next) break;
    selected.push(annotate(next, {
      parentSelection: {
        parentSelectionBucket: 'mmr_fill',
        parentSelectionReason: 'MMR fill to maintain diversified parent pool size',
      },
    }));
  }
  const ranked = selected.map((seed, index) => {
    const similarity = index ? Math.max(...selected.slice(0, index).map((item) => parentSimilarity(seed, item))) : 0;
    return annotate(seed, {
      parentSelection: {
        parentPoolRank: index + 1,
        parentPoolDiversityContribution: clamp(1 - similarity),
        selectedParentScore: clamp(Number(seed.scores?.parentSelectionScore || 0) - lambda * similarity, -1, 1),
      },
    });
  });
  const bucketDistribution = ranked.reduce((acc, seed) => {
    const bucket = seed.parentSelection?.parentSelectionBucket || 'unknown';
    acc[bucket] = (acc[bucket] || 0) + 1;
    return acc;
  }, {});
  return {
    ok: true,
    version: OPERATOR_CROSS_THEME_PRIOR_VERSION,
    topOneSelectionDisabled: policy.disableTopOneParentSelection !== false,
    parentPoolSize,
    selected: ranked,
    bucketDistribution,
    selectionMethod: policy.selectionMethod || 'mmr_stratified',
  };
}

function entropyFromCounts(counts = {}) {
  const total = Object.values(counts).reduce((sum, value) => sum + Number(value || 0), 0);
  if (!total) return 0;
  let entropy = 0;
  for (const count of Object.values(counts)) {
    const p = Number(count || 0) / total;
    if (p > 0) entropy -= p * Math.log2(p);
  }
  return Number(entropy.toFixed(6));
}

function metricForRun(seeds = [], label = '') {
  const seedList = asArray(seeds);
  const counts = classDistribution(seedList);
  const knownNarrativeOverlap = seedList.length
    ? seedList.reduce((sum, seed) => sum + Number(seed.scores?.knownNarrativeScore || 0), 0) / seedList.length
    : 0;
  const parentPriorOverlap = seedList.length
    ? seedList.reduce((sum, seed) => sum + Number(seed.scores?.priorReportOverlap || 0), 0) / seedList.length
    : 0;
  const representativeTickerLeakage = seedList.filter((seed) => representativeTickerPenalty(seed) > 0).length;
  return {
    run: label,
    parentCount: seedList.length,
    childSeedCount: seedList.reduce((sum, seed) => sum + Number(seed.childCount || seed.childSeeds?.length || 0), 0),
    classDistribution: counts,
    classDiversityEntropy: entropyFromCounts(counts),
    knownNarrativeOverlap: Number(knownNarrativeOverlap.toFixed(6)),
    parentPriorOverlap: Number(parentPriorOverlap.toFixed(6)),
    representativeTickerLeakage,
    acceptedEvidenceRate: 0,
    negativeControlSurvivalRate: 0,
    holdoutConfirmationRate: 0,
    reportCandidateAllowedRate: 0,
    blockedRate: 1,
  };
}

export function compareParentSelectionRuns(seeds = [], options = {}) {
  const seedList = asArray(seeds).filter((seed) => seed.status !== 'rejected');
  const composite = seedList.slice().sort((left, right) => Number(right.scores?.composite_seed_score || 0) - Number(left.scores?.composite_seed_score || 0));
  const diversified = selectDiversifiedParentSeedPool(seedList, options).selected;
  const underrepresented = seedList.slice().sort((left, right) => (
    underrepresentedClassBonus(right, seedList) - underrepresentedClassBonus(left, seedList)
    || Number(right.scores?.bottleneck_specificity || 0) - Number(left.scores?.bottleneck_specificity || 0)
  )).slice(0, 10);
  return {
    ok: true,
    runs: [
      metricForRun(composite.slice(0, 1), 'A_top1_composite'),
      metricForRun(composite.slice(0, 10), 'B_top10_composite'),
      metricForRun(diversified, 'C_mmr_diversified'),
      metricForRun(underrepresented, 'D_underrepresented_quota'),
    ],
    expectation: {
      topOneParentSelectionDisabled: true,
      diversifiedShouldImproveEntropy: true,
      readinessGateUnchanged: true,
    },
  };
}

function classForPreferredNode(node = '', priorItem = {}) {
  const text = normalize(node);
  if (/\b(permit|permitting|queue|approval)\b/i.test(text)) return 'permitting_regulatory';
  if (/\b(study|engineering|process|bonding|debonding|warpage|automation)\b/i.test(text)) return 'engineering_process';
  if (/\b(material|resin|film|underfill|compound|helium|tungsten|tantalum|uranium|cobalt|gas|binder|perchlorate)\b/i.test(text)) return 'material_input';
  if (/\b(test|qualification|qualified|inspection|metrology|probe|socket|valve|pump)\b/i.test(text)) return 'technical_qualification';
  if (/\b(procurement|award|budget|funding)\b/i.test(text)) return 'procurement_trigger';
  return asArray(priorItem.connectorClasses)[0] || 'supplier_capacity';
}

export function crossThemePriorToSeedInputs(prior = loadOperatorCrossThemePrior(), options = {}) {
  const limitPerPrior = Math.max(1, Number(options.limitPerPrior || 8));
  const inputs = [];
  for (const item of asArray(prior.themePairPriors)) {
    const themes = asArray(item.themes);
    const nodes = asArray(item.preferredNodes).slice(0, limitPerPrior);
    for (const node of nodes) {
      const klass = classForPreferredNode(node, item);
      inputs.push({
        id: `cross-theme-prior:${item.id}:${normalize(node).replace(/\s+/g, '-')}`,
        source: 'operator_cross_theme_prior',
        sourceIds: [item.id],
        themeKey: themes[0] || '',
        themeLabel: themes.join(' + '),
        themes,
        label: node,
        prompt: `${themes.join(' + ')} -> ${node} -> qualified supplier or capacity owner evidence and counter-evidence`,
        seedTerms: [node],
        sourceTerms: [node, themes],
        evidenceClasses: [klass, item.evidenceClasses],
        metadata: {
          userCrossThemePriorId: item.id,
          role: prior.role,
          promotionPolicy: prior.promotionPolicy,
          connectorClasses: item.connectorClasses,
          avoidNarratives: item.avoidNarratives,
        },
        sourceRefs: [{ sourceType: 'operator_cross_theme_prior', sourceId: item.id }],
        sourceTypes: ['operator_cross_theme_prior'],
      });
    }
  }
  return inputs;
}
