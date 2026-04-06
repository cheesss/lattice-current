import type { MarketRegimeId } from './regime-model';

export type RegimePosteriorMap = Record<MarketRegimeId, number>;

// FIX-5: External HMM configuration interface
export interface HmmExternalConfig {
  transitionPriorStrength: number;
  onlineDiscount: number;
  stabilityBias?: { base: number; scale: number; floor: number; cap: number };
  switchBias?: { base: number; scale: number; floor: number; cap: number };
  blendWeights?: { stability: number; switch: number };
  confidence?: { w1: number; w2: number; w3: number; w4: number; w5: number; floor: number; cap: number };
  onlineWeightScale?: number;
  onlineWeightExponent?: number;
}

export interface HMMEmissionStats {
  mean: number;
  variance: number;
  count: number;
}

export interface HMMOnlineState {
  transitionCounts: Record<MarketRegimeId, RegimePosteriorMap>;
  emissionStats: Record<MarketRegimeId, HMMEmissionStats>;
  updates: number;
}

export interface HMMRegimeInput {
  scores: RegimePosteriorMap;
  previous?: {
    id: MarketRegimeId;
    confidence?: number | null;
    regimeAgeHours?: number | null;
    posterior?: Partial<RegimePosteriorMap> | null;
    onlineState?: HMMOnlineState | null;
  } | null;
}

export interface HMMRegimeResult {
  posterior: RegimePosteriorMap;
  predictedPrior: RegimePosteriorMap;
  transitionMatrix: Record<MarketRegimeId, RegimePosteriorMap>;
  emissions: RegimePosteriorMap;
  selected: MarketRegimeId;
  confidence: number;
  persistence: number;
  transitionConfidence: number;
  switchPenalty: number;
  entropy: number;
  regimeDecay: number;
  posteriorGap: number;
  onlineState: HMMOnlineState;
}

const REGIME_IDS: MarketRegimeId[] = ['risk-on', 'risk-off', 'inflation-shock', 'deflation-bust'];

const BASE_TRANSITIONS: Record<MarketRegimeId, RegimePosteriorMap> = {
  'risk-on': {
    'risk-on': 0.74,
    'risk-off': 0.11,
    'inflation-shock': 0.09,
    'deflation-bust': 0.06,
  },
  'risk-off': {
    'risk-on': 0.12,
    'risk-off': 0.66,
    'inflation-shock': 0.1,
    'deflation-bust': 0.12,
  },
  'inflation-shock': {
    'risk-on': 0.08,
    'risk-off': 0.15,
    'inflation-shock': 0.67,
    'deflation-bust': 0.1,
  },
  'deflation-bust': {
    'risk-on': 0.09,
    'risk-off': 0.17,
    'inflation-shock': 0.1,
    'deflation-bust': 0.64,
  },
};

// FIX-5: These defaults can be overridden via ConfigManager at runtime.
// The getConfiguredHmmParams() helper provides the current effective values.
let _configuredTransitionPriorStrength = 12;
let _configuredOnlineDiscount = 0.992;
let _stabilityBias = { base: 0.55, scale: 260, floor: 0.55, cap: 0.86 };
let _switchBias = { base: 0.22, scale: 320, floor: 0.18, cap: 0.48 };
let _blendWeights = { stability: 0.58, switch: 0.42 };
let _confidence = { w1: 34, w2: 52, w3: 28, w4: 9, w5: 10, floor: 28, cap: 96 };
let _onlineWeightScale = 24;
let _onlineWeightExponent = 0.6;

const TRANSITION_PRIOR_STRENGTH = _configuredTransitionPriorStrength;
const ONLINE_DISCOUNT = _configuredOnlineDiscount;

/**
 * FIX-5: Update HMM parameters from full config object.
 * Called by orchestrator after ConfigManager loads.
 */
export function setHmmConfig(config: HmmExternalConfig): void {
  _configuredTransitionPriorStrength = config.transitionPriorStrength;
  _configuredOnlineDiscount = config.onlineDiscount;

  if (config.stabilityBias) {
    _stabilityBias = { ...config.stabilityBias };
  }
  if (config.switchBias) {
    _switchBias = { ...config.switchBias };
  }
  if (config.blendWeights) {
    _blendWeights = { ...config.blendWeights };
  }
  if (config.confidence) {
    _confidence = { ...config.confidence };
  }
  if (config.onlineWeightScale !== undefined) {
    _onlineWeightScale = config.onlineWeightScale;
  }
  if (config.onlineWeightExponent !== undefined) {
    _onlineWeightExponent = config.onlineWeightExponent;
  }
}

/**
 * FIX-5: Backward-compatible wrapper for old setHmmParams(a, b) signature.
 * Kept for compatibility with existing code.
 */
export function setHmmParams(transitionPriorStrength: number, onlineDiscount: number): void {
  setHmmConfig({ transitionPriorStrength, onlineDiscount });
}

/** IS-5: Get current HMM parameters. */
export function getHmmParams(): { transitionPriorStrength: number; onlineDiscount: number } {
  return { transitionPriorStrength: _configuredTransitionPriorStrength, onlineDiscount: _configuredOnlineDiscount };
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function entropyOf(distribution: number[]): number {
  if (!distribution.length) return 0;
  const safe = distribution.filter((value) => Number.isFinite(value) && value > 0);
  if (!safe.length) return 0;
  const raw = -safe.reduce((sum, value) => sum + value * Math.log2(value), 0);
  const maxEntropy = Math.log2(distribution.length);
  return maxEntropy > 0 ? clamp(raw / maxEntropy, 0, 1) : 0;
}

function normalizeRow(row: RegimePosteriorMap): RegimePosteriorMap {
  const values = REGIME_IDS.map((id) => Math.max(0, row[id] ?? 0));
  const total = values.reduce((sum, item) => sum + item, 0);
  const normalized = total > 0 ? values.map((item) => item / total) : values.map(() => 1 / REGIME_IDS.length);
  return Object.fromEntries(REGIME_IDS.map((id, index) => [id, Number(normalized[index]!.toFixed(6))])) as RegimePosteriorMap;
}

function createDefaultOnlineState(): HMMOnlineState {
  return {
    transitionCounts: Object.fromEntries(
      REGIME_IDS.map((from) => [from, normalizeRow(
        Object.fromEntries(
          REGIME_IDS.map((to) => [to, BASE_TRANSITIONS[from][to]! * TRANSITION_PRIOR_STRENGTH]),
        ) as RegimePosteriorMap,
      )]),
    ) as Record<MarketRegimeId, RegimePosteriorMap>,
    emissionStats: Object.fromEntries(
      REGIME_IDS.map((id) => [id, {
        mean: 0.5,
        variance: 0.08,
        count: 0,
      }]),
    ) as Record<MarketRegimeId, HMMEmissionStats>,
    updates: 0,
  };
}

function normalizeTransitionCounts(
  counts: Record<MarketRegimeId, RegimePosteriorMap> | null | undefined,
): Record<MarketRegimeId, RegimePosteriorMap> {
  if (!counts) return createDefaultOnlineState().transitionCounts;
  return Object.fromEntries(
    REGIME_IDS.map((from) => {
      const row = counts[from];
      if (!row) return [from, createDefaultOnlineState().transitionCounts[from]];
      return [from, normalizeRow(row)];
    }),
  ) as Record<MarketRegimeId, RegimePosteriorMap>;
}

function gaussianScore(value: number, mean: number, variance: number): number {
  const safeVariance = Math.max(1e-4, variance);
  const diff = value - mean;
  return Math.exp(-(diff * diff) / (2 * safeVariance)) / Math.sqrt(2 * Math.PI * safeVariance);
}

function buildTransitionMatrix(
  previousConfidence: number,
  onlineState: HMMOnlineState,
): Record<MarketRegimeId, RegimePosteriorMap> {
  // FIX-5: Use configured stability and switch bias parameters
  const stabilityBias = clamp(
    _stabilityBias.base + previousConfidence / _stabilityBias.scale,
    _stabilityBias.floor,
    _stabilityBias.cap,
  );
  const switchBias = clamp(
    _switchBias.base + (100 - previousConfidence) / _switchBias.scale,
    _switchBias.floor,
    _switchBias.cap,
  );
  const matrix = {} as Record<MarketRegimeId, RegimePosteriorMap>;

  for (const from of REGIME_IDS) {
    const baseRow = BASE_TRANSITIONS[from]!;
    const learnedRow = onlineState.transitionCounts[from]!;
    const row = {} as RegimePosteriorMap;
    for (const to of REGIME_IDS) {
      const base = baseRow[to]!;
      const learned = learnedRow[to]!;
      const adjusted = from === to
        ? base * stabilityBias
        : base * (1 - switchBias);
      // FIX-5: Use configured blend weights
      row[to] = adjusted * _blendWeights.stability + learned * _blendWeights.switch;
    }
    matrix[from] = normalizeRow(row);
  }

  return matrix;
}

function buildPosteriorFromPriorAndEmission(
  prior: RegimePosteriorMap,
  emissions: RegimePosteriorMap,
): RegimePosteriorMap {
  const posterior = {} as RegimePosteriorMap;
  for (const id of REGIME_IDS) {
    posterior[id] = Math.max(1e-12, prior[id] * emissions[id]);
  }
  const total = REGIME_IDS.reduce((sum, id) => sum + posterior[id], 0);
  return Object.fromEntries(
    REGIME_IDS.map((id) => [id, Number((posterior[id]! / total).toFixed(6))]),
  ) as RegimePosteriorMap;
}

function buildEmissions(
  scores: RegimePosteriorMap,
  onlineState: HMMOnlineState,
): RegimePosteriorMap {
  const manual = normalizeRow(Object.fromEntries(
    REGIME_IDS.map((id) => [id, Math.max(1e-6, scores[id] ?? 0)]),
  ) as RegimePosteriorMap);

  const learnedRaw = {} as RegimePosteriorMap;
  for (const id of REGIME_IDS) {
    const stats = onlineState.emissionStats[id];
    const normalizedScore = clamp((scores[id] ?? 0) / 100, 0, 1);
    learnedRaw[id] = gaussianScore(normalizedScore, stats.mean, stats.variance);
  }
  const learned = normalizeRow(learnedRaw);

  return normalizeRow(Object.fromEntries(
    REGIME_IDS.map((id) => {
      const stats = onlineState.emissionStats[id];
      // FIX-5: Use configured online weight scale and exponent
      const onlineWeight = clamp(stats.count / _onlineWeightScale, 0, _onlineWeightExponent);
      return [id, manual[id] * (1 - onlineWeight) + learned[id] * onlineWeight];
    }),
  ) as RegimePosteriorMap);
}

function updateOnlineState(
  previous: HMMOnlineState,
  previousId: MarketRegimeId | null | undefined,
  selected: MarketRegimeId,
  scores: RegimePosteriorMap,
): HMMOnlineState {
  const transitionCounts = Object.fromEntries(
    REGIME_IDS.map((from) => {
      const row = previous.transitionCounts[from]!;
      const nextRow = {} as RegimePosteriorMap;
      for (const to of REGIME_IDS) {
        nextRow[to] = Math.max(1e-6, row[to]! * ONLINE_DISCOUNT);
      }
      return [from, nextRow];
    }),
  ) as Record<MarketRegimeId, RegimePosteriorMap>;

  if (previousId) {
    transitionCounts[previousId][selected] = Math.max(
      1e-6,
      transitionCounts[previousId][selected] + 1,
    );
  }

  const emissionStats = Object.fromEntries(
    REGIME_IDS.map((id) => {
      const previousStats = previous.emissionStats[id];
      const nextStats: HMMEmissionStats = { ...previousStats };
      if (id === selected) {
        const value = clamp((scores[id] ?? 0) / 100, 0, 1);
        const nextCount = previousStats.count + 1;
        const delta = value - previousStats.mean;
        const mean = previousStats.mean + delta / nextCount;
        const variance = previousStats.count > 0
          ? ((previousStats.variance * previousStats.count) + delta * (value - mean)) / nextCount
          : previousStats.variance;
        nextStats.mean = Number(clamp(mean, 0.01, 0.99).toFixed(6));
        nextStats.variance = Number(clamp(variance, 1e-3, 0.25).toFixed(6));
        nextStats.count = nextCount;
      }
      return [id, nextStats];
    }),
  ) as Record<MarketRegimeId, HMMEmissionStats>;

  return {
    transitionCounts: normalizeTransitionCounts(transitionCounts),
    emissionStats,
    updates: previous.updates + 1,
  };
}

function previousPosterior(previous?: HMMRegimeInput['previous'] | null): RegimePosteriorMap {
  if (!previous) {
    return Object.fromEntries(REGIME_IDS.map((id) => [id, 1 / REGIME_IDS.length])) as RegimePosteriorMap;
  }

  const posterior = previous.posterior;
  if (posterior) {
    const values = REGIME_IDS.map((id) => Math.max(0, posterior[id] ?? 0));
    const total = values.reduce((sum, item) => sum + item, 0);
    if (total > 0) {
      return Object.fromEntries(
        REGIME_IDS.map((id, index) => [id, Number((values[index]! / total).toFixed(6))]),
      ) as RegimePosteriorMap;
    }
  }

  const confidence = clamp(previous.confidence ?? 52, 0, 100);
  const spill = (1 - (0.58 + confidence / 240)) / (REGIME_IDS.length - 1);
  const base = {} as RegimePosteriorMap;
  for (const id of REGIME_IDS) {
    base[id] = id === previous.id ? clamp(0.58 + confidence / 240, 0.58, 0.88) : Math.max(spill, 0.01);
  }
  return normalizeRow(base);
}

export function inferHMMRegimePosterior(input: HMMRegimeInput): HMMRegimeResult {
  const onlineState = input.previous?.onlineState
    ? {
      transitionCounts: normalizeTransitionCounts(input.previous.onlineState.transitionCounts),
      emissionStats: input.previous.onlineState.emissionStats,
      updates: input.previous.onlineState.updates ?? 0,
    }
    : createDefaultOnlineState();
  const emissions = buildEmissions(input.scores, onlineState);
  const previousConfidence = clamp(input.previous?.confidence ?? _confidence.w2, 0, 100);
  const transitionMatrix = buildTransitionMatrix(previousConfidence, onlineState);
  const priorSource = previousPosterior(input.previous);
  const predictedPrior = {} as RegimePosteriorMap;

  for (const to of REGIME_IDS) {
    let mass = 0;
    for (const from of REGIME_IDS) {
      mass += priorSource[from] * transitionMatrix[from][to];
    }
    predictedPrior[to] = Math.max(1e-6, mass);
  }

  const posterior = buildPosteriorFromPriorAndEmission(predictedPrior, emissions);
  const posteriorEntries = Object.entries(posterior).sort((a, b) => b[1] - a[1]);
  const selected = (posteriorEntries[0]?.[0] as MarketRegimeId) || 'risk-off';
  const top = posteriorEntries[0]?.[1] ?? 0;
  const second = posteriorEntries[1]?.[1] ?? 0;
  const posteriorGap = clamp(top - second, 0, 1);
  const entropy = entropyOf(REGIME_IDS.map((id) => posterior[id]));
  const persistenceKey = input.previous?.id ?? selected;
  const persistence = clamp(predictedPrior[persistenceKey] ?? top, 0, 1);
  const transitionConfidence = clamp(input.previous ? persistence : top, 0, 1);
  const regimeAgeHours = Math.max(0, Number(input.previous?.regimeAgeHours ?? 0) || 0);
  const regimeDecay = clamp(Math.pow(0.5, regimeAgeHours / 168), 0, 1);
  const switchPenalty = clamp(1 - persistence, 0, 1);
  // FIX-5: Use configured confidence formula parameters
  const confidence = clamp(
    _confidence.w1 + top * _confidence.w2 + posteriorGap * _confidence.w3 + persistence * _confidence.w4 - entropy * _confidence.w5,
    _confidence.floor,
    _confidence.cap,
  );
  const nextOnlineState = updateOnlineState(onlineState, input.previous?.id ?? null, selected, input.scores);

  return {
    posterior,
    predictedPrior,
    transitionMatrix,
    emissions,
    selected,
    confidence: Number(confidence.toFixed(2)),
    persistence: Number(persistence.toFixed(4)),
    transitionConfidence: Number(transitionConfidence.toFixed(4)),
    switchPenalty: Number(switchPenalty.toFixed(4)),
    entropy: Number(entropy.toFixed(4)),
    regimeDecay: Number(regimeDecay.toFixed(4)),
    posteriorGap: Number(posteriorGap.toFixed(4)),
    onlineState: nextOnlineState,
  };
}
