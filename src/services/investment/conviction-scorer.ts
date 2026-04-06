import type { ConvictionFeatureSnapshot } from './types';
import { clamp, logistic } from './utils';
import { convictionModelState } from './module-state';
import { computeRegimeAwareLearningRate } from './feedback-delay-compensator';

export function normalizeConvictionFeatures(features: ConvictionFeatureSnapshot): ConvictionFeatureSnapshot {
  return {
    corroborationQuality: clamp((Number(features.corroborationQuality) || 0) / 100, 0, 1),
    recentEvidenceScore: clamp((Number(features.recentEvidenceScore) || 0) / 100, 0, 1),
    realityScore: clamp((Number(features.realityScore) || 0) / 100, 0, 1),
    graphSignalScore: clamp((Number(features.graphSignalScore) || 0) / 100, 0, 1),
    transferEntropy: clamp(Number(features.transferEntropy) || 0, 0, 1),
    banditScore: clamp((Number(features.banditScore) || 0) / 100, 0, 1),
    regimeMultiplier: clamp((Number(features.regimeMultiplier) || 1) - 1, -0.4, 0.8),
    coveragePenalty: clamp((Number(features.coveragePenalty) || 0) / 100, 0, 1),
    falsePositiveRisk: clamp((Number(features.falsePositiveRisk) || 0) / 100, 0, 1),
  };
}

export function convictionFeatureEntries(features: ConvictionFeatureSnapshot): Array<[keyof ConvictionFeatureSnapshot, number]> {
  return Object.entries(normalizeConvictionFeatures(features)) as Array<[keyof ConvictionFeatureSnapshot, number]>;
}

export function scoreConvictionModel(features: ConvictionFeatureSnapshot): number {
  const linear = convictionFeatureEntries(features).reduce(
    (sum, [key, value]) => sum + (convictionModelState.weights[key] ?? 0) * value,
    convictionModelState.bias,
  );
  return logistic(linear);
}

/**
 * Update the conviction model with realized outcome.
 * @param features Feature snapshot at idea generation time.
 * @param realizedReturnPct Realized return.
 * @param regimeContext Optional regime context for adaptive learning rate.
 */
export function updateConvictionModel(
  features: ConvictionFeatureSnapshot | null | undefined,
  realizedReturnPct: number,
  regimeContext?: { currentRegime?: string; generationRegime?: string; sourceQualityWeight?: number },
): void {
  if (!features || !Number.isFinite(realizedReturnPct)) return;
  const label = realizedReturnPct > 0 ? 1 : 0;
  const normalized = normalizeConvictionFeatures(features);
  const prediction = scoreConvictionModel(normalized);
  const error = label - prediction;

  // IS-3: Regime-aware learning rate replaces hardcoded discount = 0.995
  const regimeAwareRate = computeRegimeAwareLearningRate({
    baseLearningRate: convictionModelState.learningRate,
    currentRegime: regimeContext?.currentRegime ?? 'normal',
    regimeAtGeneration: regimeContext?.generationRegime ?? 'normal',
    holdingDurationHours: 48, // default assumption
  });
  const discount = 1 - regimeAwareRate;

  // IS-3: Source quality weighting — scale the error by source quality
  const sourceWeight = clamp(regimeContext?.sourceQualityWeight ?? 1.0, 0.3, 1.5);
  const weightedError = error * sourceWeight;

  convictionModelState.bias = convictionModelState.bias * discount + regimeAwareRate * weightedError;
  for (const [key, value] of convictionFeatureEntries(normalized)) {
    convictionModelState.weights[key] = Number((
      convictionModelState.weights[key] * discount
      + regimeAwareRate * weightedError * value
    ).toFixed(6));
  }
  convictionModelState.observations += 1;
  convictionModelState.updatedAt = new Date().toISOString();
}

export function blendLearnedConviction(baseConviction: number, features: ConvictionFeatureSnapshot): number {
  const learnedScore = scoreConvictionModel(features) * 100;
  const confidence = clamp(convictionModelState.observations / 24, 0, 0.45);
  return clamp(
    Math.round(baseConviction * (1 - confidence) + learnedScore * confidence),
    10,
    99,
  );
}
