/**
 * ensemble-predictor.ts — Stacking ensemble combining 4 base models.
 *
 * Layer 1: ElasticNet, EmbeddingKNN, GradientBoosting, BayesianLogistic
 * Layer 2: Weighted combination with isotonic calibration
 * Uncertainty: inter-model disagreement → conviction penalty
 */

import type { ElasticNetModel } from './elastic-net';
import type { GBMModel } from './gradient-boosting';
import type { BayesianLogisticModel } from './bayesian-logistic';
import type { IsotonicCalibrator } from './isotonic-calibrator';
import type { KNNPrediction } from './embedding-knn';
import { predictElasticNet } from './elastic-net';
import { predictGBM } from './gradient-boosting';
import { predictBayesian } from './bayesian-logistic';
import { calibrate } from './isotonic-calibrator';

export interface EnsembleModels {
  elasticNet: ElasticNetModel | null;
  gbm: GBMModel | null;
  bayesian: BayesianLogisticModel | null;
  calibrators: {
    elasticNet: IsotonicCalibrator | null;
    gbm: IsotonicCalibrator | null;
    bayesian: IsotonicCalibrator | null;
    knn: IsotonicCalibrator | null;
  };
  ensembleWeights: number[];  // [w_elastic, w_knn, w_gbm, w_bayesian]
}

export interface EnsemblePrediction {
  hitProbability: number;
  uncertainty: number;
  continuousConviction: number;
  modelPredictions: {
    elasticNet: number | null;
    knn: number | null;
    gbm: number | null;
    bayesian: number | null;
  };
}

/**
 * Create an ensemble with equal initial weights.
 */
export function createEmptyEnsemble(): EnsembleModels {
  return {
    elasticNet: null,
    gbm: null,
    bayesian: null,
    calibrators: { elasticNet: null, gbm: null, bayesian: null, knn: null },
    ensembleWeights: [0.25, 0.25, 0.25, 0.25],
  };
}

/**
 * Predict using the stacking ensemble.
 *
 * @param models Trained ensemble models.
 * @param features ML feature vector (number array).
 * @param knnPrediction Pre-computed KNN prediction (from pgvector query).
 */
export function ensemblePredict(
  models: EnsembleModels,
  features: number[],
  knnPrediction: KNNPrediction | null,
): EnsemblePrediction {
  const w = models.ensembleWeights;
  const preds: (number | null)[] = [null, null, null, null];
  let activeWeightSum = 0;
  let weightedProbSum = 0;

  // Model A: Elastic Net
  if (models.elasticNet) {
    let p = predictElasticNet(models.elasticNet, features);
    if (models.calibrators.elasticNet) p = calibrate(models.calibrators.elasticNet, p);
    preds[0] = p;
    activeWeightSum += (w[0] ?? 0);
    weightedProbSum += (w[0] ?? 0) * p;
  }

  // Model B: Embedding KNN
  if (knnPrediction && knnPrediction.confidence > 0.1) {
    let p = knnPrediction.hitProbability;
    if (models.calibrators.knn) p = calibrate(models.calibrators.knn, p);
    preds[1] = p;
    activeWeightSum += (w[1] ?? 0);
    weightedProbSum += (w[1] ?? 0) * p;
  }

  // Model C: Gradient Boosting
  if (models.gbm) {
    let p = predictGBM(models.gbm, features);
    if (models.calibrators.gbm) p = calibrate(models.calibrators.gbm, p);
    preds[2] = p;
    activeWeightSum += (w[2] ?? 0);
    weightedProbSum += (w[2] ?? 0) * p;
  }

  // Model D: Bayesian Logistic
  if (models.bayesian) {
    const result = predictBayesian(models.bayesian, features);
    let p = result.probability;
    if (models.calibrators.bayesian) p = calibrate(models.calibrators.bayesian, p);
    preds[3] = p;
    activeWeightSum += (w[3] ?? 0);
    weightedProbSum += (w[3] ?? 0) * p;
  }

  // Fallback: if no model active, return neutral prediction
  if (activeWeightSum < 1e-10) {
    return {
      hitProbability: 0.5,
      uncertainty: 1,
      continuousConviction: 50,
      modelPredictions: { elasticNet: null, knn: null, gbm: null, bayesian: null },
    };
  }

  const ensembleMean = weightedProbSum / activeWeightSum;

  // Uncertainty: standard deviation of active predictions
  const activePreds = preds.filter((p): p is number => p !== null);
  const uncertainty = activePreds.length >= 2
    ? Math.sqrt(activePreds.reduce((s, p) => s + (p - ensembleMean) ** 2, 0) / activePreds.length)
    : 0.2; // high uncertainty with single model

  // Penalize high-disagreement predictions
  const uncertaintyPenalty = clamp(uncertainty * 1.5, 0, 0.15);
  const finalProb = clamp(ensembleMean - uncertaintyPenalty, 0.03, 0.97);

  // Map to 0-100 conviction: probability-based with uncertainty discount
  const continuousConviction = clamp(
    finalProb * 45
    + (1 - uncertainty) * 35
    + (activePreds.length / 4) * 20,
    0,
    100,
  );

  return {
    hitProbability: finalProb,
    uncertainty,
    continuousConviction,
    modelPredictions: {
      elasticNet: preds[0] ?? null,
      knn: preds[1] ?? null,
      gbm: preds[2] ?? null,
      bayesian: preds[3] ?? null,
    },
  };
}

/**
 * Compute Sharpe-like fitness for CMA-ES ensemble weight optimization.
 * Takes model predictions and actual returns, simulates weighted allocation.
 */
export function computeEnsembleFitness(
  modelPredictions: number[][],  // [n_samples][4_models] — raw probabilities
  actualReturns: number[],
  weights: number[],
): number {
  const n = modelPredictions.length;
  if (n === 0) return 0;

  const simulatedReturns: number[] = [];
  for (let i = 0; i < n; i++) {
    const preds = modelPredictions[i]!;
    let weightedProb = 0;
    let wSum = 0;
    for (let m = 0; m < preds.length; m++) {
      const pm = preds[m] ?? 0;
      const wm = weights[m] ?? 0;
      if (Number.isFinite(pm)) {
        weightedProb += wm * pm;
        wSum += wm;
      }
    }
    if (wSum < 1e-10) continue;
    const prob = weightedProb / wSum;
    const allocation = clamp((prob - 0.5) * 2, -1, 1);
    simulatedReturns.push(allocation * (actualReturns[i] ?? 0));
  }

  if (simulatedReturns.length < 5) return 0;

  // Sharpe ratio
  const mean = simulatedReturns.reduce((a, b) => a + b, 0) / simulatedReturns.length;
  const variance = simulatedReturns.reduce((s, r) => s + (r - mean) ** 2, 0) / simulatedReturns.length;
  const stdDev = Math.sqrt(variance);
  return stdDev > 1e-8 ? mean / stdDev : 0;
}

/**
 * Serialize ensemble state.
 */
export function exportEnsemble(models: EnsembleModels): string {
  return JSON.stringify({
    ensembleWeights: models.ensembleWeights,
    // Individual models are exported separately
  });
}

function clamp(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x));
}
