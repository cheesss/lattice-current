import type { MarketRegimeId } from './regime-model';

export type RegimePosteriorMap = Record<MarketRegimeId, number>;

export interface HMMRegimeInput {
  scores: RegimePosteriorMap;
  previous?: {
    id: MarketRegimeId;
    confidence?: number | null;
    posterior?: Partial<RegimePosteriorMap> | null;
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
  switchPenalty: number;
  entropy: number;
  posteriorGap: number;
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

function buildTransitionMatrix(previousConfidence: number): Record<MarketRegimeId, RegimePosteriorMap> {
  const stabilityBias = clamp(0.55 + previousConfidence / 260, 0.55, 0.86);
  const switchBias = clamp(0.22 + (100 - previousConfidence) / 320, 0.18, 0.48);
  const matrix = {} as Record<MarketRegimeId, RegimePosteriorMap>;

  for (const from of REGIME_IDS) {
    const baseRow = BASE_TRANSITIONS[from]!;
    const row = {} as RegimePosteriorMap;
    for (const to of REGIME_IDS) {
      const base = baseRow[to]!;
      const adjusted = from === to
        ? base * stabilityBias
        : base * (1 - switchBias);
      row[to] = adjusted;
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
  const emissions = normalizeRow(Object.fromEntries(
    REGIME_IDS.map((id) => [id, Math.max(1e-6, input.scores[id] ?? 0)]),
  ) as RegimePosteriorMap);

  const previousConfidence = clamp(input.previous?.confidence ?? 52, 0, 100);
  const transitionMatrix = buildTransitionMatrix(previousConfidence);
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
  const switchPenalty = clamp(1 - persistence, 0, 1);
  const confidence = clamp(
    34 + top * 52 + posteriorGap * 28 + persistence * 9 - entropy * 10,
    28,
    96,
  );

  return {
    posterior,
    predictedPrior,
    transitionMatrix,
    emissions,
    selected,
    confidence: Number(confidence.toFixed(2)),
    persistence: Number(persistence.toFixed(4)),
    switchPenalty: Number(switchPenalty.toFixed(4)),
    entropy: Number(entropy.toFixed(4)),
    posteriorGap: Number(posteriorGap.toFixed(4)),
  };
}
