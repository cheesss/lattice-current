import type { InvestmentIdeaCard } from '../types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function clamp(x: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, x));
}

function safe(v: unknown, fallback = 0): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

// ---------------------------------------------------------------------------
// ML Feature Vector
// ---------------------------------------------------------------------------

export interface MLFeatureVector {
  // Signal features (13)
  confidence: number;
  confirmation: number;
  reality: number;
  replayHitRate: number;
  currentHitRate: number;
  coverage: number;
  banditScore: number;
  transferEntropy: number;
  stabilityExposure: number;
  falsePositiveRisk: number;
  driftPenalty: number;
  clusterConfidence: number;
  evidenceSupport: number;

  // Context features (6)
  marketStress: number;
  regimeState: number; // 0 = risk-off, 0.5 = balanced, 1 = risk-on
  shadowPenalty: number;
  narrativeAlignment: number;
  transmissionStress: number;
  volatilityRegime: number;

  // Interaction features (4)
  confidenceXreality: number;
  transferXcluster: number;
  coverageXfp: number;
  stressXevidence: number;
}

// ---------------------------------------------------------------------------
// Feature names (canonical order)
// ---------------------------------------------------------------------------

export const MLFeatureNames: string[] = [
  // Signal
  'confidence',
  'confirmation',
  'reality',
  'replayHitRate',
  'currentHitRate',
  'coverage',
  'banditScore',
  'transferEntropy',
  'stabilityExposure',
  'falsePositiveRisk',
  'driftPenalty',
  'clusterConfidence',
  'evidenceSupport',
  // Context
  'marketStress',
  'regimeState',
  'shadowPenalty',
  'narrativeAlignment',
  'transmissionStress',
  'volatilityRegime',
  // Interaction
  'confidenceXreality',
  'transferXcluster',
  'coverageXfp',
  'stressXevidence',
];

// ---------------------------------------------------------------------------
// Feature extraction
// ---------------------------------------------------------------------------

interface ExtractMLFeaturesParams {
  card: InvestmentIdeaCard;
  macroOverlay: { state: string; killSwitch: boolean };
  transmissionStress: number;
  replayProfile: {
    hitRate?: number;
    costAdjustedAvgReturnPct?: number;
    currentVsReplayDrift?: number;
  } | null;
  /** Optional FRED/macro indicators for enhanced features */
  macroIndicators?: {
    vix?: number;           // VIX level (typically 10-80)
    yieldSpread?: number;   // 10Y-2Y spread (typically -1 to +3)
    dollarIndex?: number;   // trade-weighted dollar (typically 90-120)
    oilPrice?: number;      // WTI crude (typically 20-120)
  } | null;
}

function regimeStateValue(state: string): number {
  switch (state) {
    case 'risk-off':
      return 0;
    case 'balanced':
    case 'neutral':
      return 0.5;
    case 'risk-on':
      return 1;
    default:
      return 0.5;
  }
}

export function extractMLFeatures(params: ExtractMLFeaturesParams): MLFeatureVector {
  const { card, macroOverlay, transmissionStress: txStress, replayProfile } = params;

  // ---- Signal features (all clamped to [0, 1]) ----

  const confidence = clamp(safe(card.calibratedConfidence) / 100, 0, 1);
  const confirmation = clamp(safe(card.confirmationScore) / 100, 0, 1);
  const reality = clamp(safe(card.realityScore) / 100, 0, 1);

  const replayHitRate = clamp(
    safe(replayProfile?.hitRate) / 100,
    0,
    1,
  );
  const currentHitRate = clamp(
    safe(card.backtestHitRate) / 100,
    0,
    1,
  );
  const coverage = clamp(1 - safe(card.coveragePenalty) / 100, 0, 1);
  const banditScore = clamp(safe(card.banditScore) / 100, 0, 1);
  const transferEntropy = clamp(safe(card.transferEntropy), 0, 1);

  // stabilityExposure: derived from regime multiplier — higher multiplier = more
  // exposure to regime instability.  regimeMultiplier ~1 means stable.
  const stabilityExposure = clamp(
    Math.abs(safe(card.regimeMultiplier, 1) - 1),
    0,
    1,
  );

  const falsePositiveRisk = clamp(safe(card.falsePositiveRisk) / 100, 0, 1);
  const driftPenalty = clamp(
    safe(replayProfile?.currentVsReplayDrift),
    0,
    1,
  );
  const clusterConfidence = clamp(safe(card.clusterConfidence) / 100, 0, 1);
  const evidenceSupport = clamp(safe(card.recentEvidenceScore) / 100, 0, 1);

  // ---- Context features (all clamped to [0, 1]) ----

  const marketStress = clamp(safe(card.marketStressPrior) / 100, 0, 1);
  const regimeState = clamp(regimeStateValue(macroOverlay.state), 0, 1);

  // shadowPenalty: narrative shadow disagreement — higher = more penalty
  const shadowPenalty = clamp(
    safe(card.narrativeShadowDisagreement),
    0,
    1,
  );

  const narrativeAlignment = clamp(
    safe(card.narrativeAlignmentScore) / 100,
    0,
    1,
  );

  const transmissionStress = clamp(safe(txStress), 0, 1);

  // volatilityRegime: prefer FRED VIX when available, otherwise fall back to timeDecayWeight
  const macro = params.macroIndicators;
  const volatilityRegime = macro?.vix != null
    ? clamp((macro.vix - 12) / 50, 0, 1)   // VIX 12→0, 62→1
    : clamp(1 - safe(card.timeDecayWeight, 1), 0, 1);

  // ---- Interaction features (products of [0,1] values) ----

  const confidenceXreality = confidence * reality;
  const transferXcluster = transferEntropy * clusterConfidence;
  const coverageXfp = coverage * falsePositiveRisk;
  const stressXevidence = marketStress * evidenceSupport;

  return {
    confidence,
    confirmation,
    reality,
    replayHitRate,
    currentHitRate,
    coverage,
    banditScore,
    transferEntropy,
    stabilityExposure,
    falsePositiveRisk,
    driftPenalty,
    clusterConfidence,
    evidenceSupport,
    marketStress,
    regimeState,
    shadowPenalty,
    narrativeAlignment,
    transmissionStress,
    volatilityRegime,
    confidenceXreality,
    transferXcluster,
    coverageXfp,
    stressXevidence,
  };
}

// ---------------------------------------------------------------------------
// Conversion
// ---------------------------------------------------------------------------

export function featureVectorToArray(v: MLFeatureVector): number[] {
  return [
    v.confidence,
    v.confirmation,
    v.reality,
    v.replayHitRate,
    v.currentHitRate,
    v.coverage,
    v.banditScore,
    v.transferEntropy,
    v.stabilityExposure,
    v.falsePositiveRisk,
    v.driftPenalty,
    v.clusterConfidence,
    v.evidenceSupport,
    v.marketStress,
    v.regimeState,
    v.shadowPenalty,
    v.narrativeAlignment,
    v.transmissionStress,
    v.volatilityRegime,
    v.confidenceXreality,
    v.transferXcluster,
    v.coverageXfp,
    v.stressXevidence,
  ];
}

// ---------------------------------------------------------------------------
// Normalization
// ---------------------------------------------------------------------------

export interface NormalizationParams {
  mean: number[];
  std: number[];
}

export function computeNormalization(vectors: number[][]): NormalizationParams {
  const n = vectors.length;
  const first = vectors[0];
  if (n === 0 || !first) {
    return { mean: [], std: [] };
  }

  const dim = first.length;
  const mean: number[] = new Array<number>(dim).fill(0);
  const std: number[] = new Array<number>(dim).fill(0);

  for (let j = 0; j < dim; j++) {
    let sum = 0;
    for (let i = 0; i < n; i++) {
      sum += vectors[i]![j]!;
    }
    mean[j] = sum / n;
  }

  for (let j = 0; j < dim; j++) {
    let sumSq = 0;
    for (let i = 0; i < n; i++) {
      const diff = vectors[i]![j]! - mean[j]!;
      sumSq += diff * diff;
    }
    // Population std; avoid division by zero with a small epsilon floor.
    std[j] = Math.sqrt(sumSq / n) || 1e-8;
  }

  return { mean, std };
}

export function normalizeFeatures(
  features: number[],
  params: NormalizationParams,
): number[] {
  const { mean, std } = params;
  const result = new Array<number>(features.length);
  for (let i = 0; i < features.length; i++) {
    result[i] = ((features[i] ?? 0) - (mean[i] ?? 0)) / (std[i] || 1e-8);
  }
  return result;
}
