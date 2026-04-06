import type { InvestmentIdeaCard } from '../types';
import type { SignalHistoryReader } from './signal-history-buffer';
import { clamp } from './math-utils';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

  // Temporal features (8) — derived from signal-history-buffer
  vixMomentum: number;            // 1d vs 7d VIX momentum
  vixZScore: number;              // 30d z-score of VIX
  stressMomentum: number;         // 1d vs 7d marketStress momentum
  stressZScore: number;           // 30d z-score of marketStress
  transmissionMomentum: number;   // 1d vs 7d transmissionStrength momentum
  yieldSpreadMomentum: number;    // 7d vs 30d yield spread momentum
  hawkesMomentum: number;         // short/mid Hawkes lambda ratio
  hawkesTrend: number;            // mid/long Hawkes lambda ratio

  // External data features (4) — credit, positioning, supply chain, geopolitical
  creditStress: number;           // credit transmission proxy marketStress [0,1]
  positioningSignal: number;      // positioning proxy transmissionStrength [0,1]
  bdiMomentum: number;            // BDI 7d vs 30d momentum [0,1]
  gprLevel: number;               // GPR proxy or official GPR [0,1]

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
  // Signal (13)
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
  // Context (6)
  'marketStress',
  'regimeState',
  'shadowPenalty',
  'narrativeAlignment',
  'transmissionStress',
  'volatilityRegime',
  // Temporal (8)
  'vixMomentum',
  'vixZScore',
  'stressMomentum',
  'stressZScore',
  'transmissionMomentum',
  'yieldSpreadMomentum',
  'hawkesMomentum',
  'hawkesTrend',
  // External data (4)
  'creditStress',
  'positioningSignal',
  'bdiMomentum',
  'gprLevel',
  // Interaction (4)
  'confidenceXreality',
  'transferXcluster',
  'coverageXfp',
  'stressXevidence',
];

// ---------------------------------------------------------------------------
// Feature extraction
// ---------------------------------------------------------------------------

export interface ExtractMLFeaturesParams {
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
  /** Optional signal history for temporal features (Phase 0) */
  signalHistory?: SignalHistoryReader | null;
  /** Optional multi-window Hawkes result */
  hawkesMultiWindow?: { momentum: number; trend: number } | null;
  /** Optional external data features (Phase 2) */
  creditProxy?: { marketStress: number; transmissionStrength: number } | null;
  positioningProxy?: { marketStress: number; transmissionStrength: number } | null;
  bdiMomentum?: number | null;
  gprLevel?: number | null;
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

  // ---- Temporal features (from signal-history-buffer, fallback to 0.5 neutral) ----

  const sh = params.signalHistory;

  const vixMomentum = sh?.hasData?.('vix', 7)
    ? clamp(sh.getMomentum('vix', 1, 7), -2, 2) / 4 + 0.5   // [-2,2] → [0,1]
    : 0.5;
  const vixZScore = sh?.hasData?.('vix', 30)
    ? clamp(sh.getZScore('vix', 30), -3, 3) / 6 + 0.5        // [-3,3] → [0,1]
    : 0.5;
  const stressMomentum = sh?.hasData?.('marketStress', 7)
    ? clamp(sh.getMomentum('marketStress', 1, 7), -2, 2) / 4 + 0.5
    : 0.5;
  const stressZScore = sh?.hasData?.('marketStress', 30)
    ? clamp(sh.getZScore('marketStress', 30), -3, 3) / 6 + 0.5
    : 0.5;
  const transmissionMomentum = sh?.hasData?.('transmissionStrength', 7)
    ? clamp(sh.getMomentum('transmissionStrength', 1, 7), -2, 2) / 4 + 0.5
    : 0.5;
  const yieldSpreadMomentum = sh?.hasData?.('yieldSpread', 30)
    ? clamp(sh.getMomentum('yieldSpread', 7, 30), -2, 2) / 4 + 0.5
    : 0.5;

  const hw = params.hawkesMultiWindow;
  const hawkesMomentum = hw != null
    ? clamp(hw.momentum, 0, 5) / 5        // [0,5] → [0,1]
    : 0.5;
  const hawkesTrend = hw != null
    ? clamp(hw.trend, 0, 5) / 5
    : 0.5;

  // ---- External data features (Phase 2, fallback to 0.5 neutral) ----

  const creditStress = params.creditProxy != null
    ? clamp(params.creditProxy.marketStress, 0, 1)
    : 0.5;
  const positioningSignal = params.positioningProxy != null
    ? clamp(params.positioningProxy.transmissionStrength, 0, 1)
    : 0.5;
  const bdiMomentum = params.bdiMomentum != null
    ? clamp(params.bdiMomentum, -2, 2) / 4 + 0.5  // [-2,2] → [0,1]
    : 0.5;
  const gprLevel = params.gprLevel != null
    ? clamp(params.gprLevel, 0, 1)
    : 0.5;

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
    vixMomentum,
    vixZScore,
    stressMomentum,
    stressZScore,
    transmissionMomentum,
    yieldSpreadMomentum,
    hawkesMomentum,
    hawkesTrend,
    creditStress,
    positioningSignal,
    bdiMomentum,
    gprLevel,
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
    v.vixMomentum,
    v.vixZScore,
    v.stressMomentum,
    v.stressZScore,
    v.transmissionMomentum,
    v.yieldSpreadMomentum,
    v.hawkesMomentum,
    v.hawkesTrend,
    v.creditStress,
    v.positioningSignal,
    v.bdiMomentum,
    v.gprLevel,
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
