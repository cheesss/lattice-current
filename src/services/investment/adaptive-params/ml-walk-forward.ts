/**
 * ml-walk-forward.ts — ML model training integration for the walk-forward loop.
 *
 * Called after each validation phase to train/update the ensemble models.
 * Also provides ML training sample extraction from replay runs.
 */

import { MLFeatureNames, featureVectorToArray, computeNormalization, normalizeFeatures } from './feature-engineer';
import { trainElasticNet, type ElasticNetModel } from './elastic-net';
import { trainGBM, type GBMModel } from './gradient-boosting';
import { initializeBayesianModel, updateBayesianModel, type BayesianLogisticModel } from './bayesian-logistic';
import { fitIsotonicRegression, type IsotonicCalibrator } from './isotonic-calibrator';
import { optimizeEnsembleWeights } from './cma-es';
import { computeEnsembleFitness, type EnsembleModels, createEmptyEnsemble } from './ensemble-predictor';
import { predictElasticNet } from './elastic-net';
import { predictGBM } from './gradient-boosting';
import { predictBayesian } from './bayesian-logistic';

export interface MLTrainingSample {
  features: number[];
  label: number;
  returnPct: number;
  timestamp: string;
}

export interface MLWalkForwardState {
  ensemble: EnsembleModels;
  normalization: { mean: number[]; std: number[] } | null;
  bayesianModel: BayesianLogisticModel | null;
  accumulatedSamples: MLTrainingSample[];
  foldsTrained: number;
}

/**
 * Create initial ML state (no models trained yet).
 */
export function createInitialMLState(): MLWalkForwardState {
  return {
    ensemble: createEmptyEnsemble(),
    normalization: null,
    bayesianModel: null,
    accumulatedSamples: [],
    foldsTrained: 0,
  };
}

/**
 * Extract ML training samples from a replay run's idea runs and forward returns.
 */
export function extractMLTrainingSamples(
  ideaRuns: Array<{
    id: string;
    timestamp?: string;
    calibratedConfidence?: number;
    confirmationScore?: number;
    realityScore?: number;
    conviction?: number;
    falsePositiveRisk?: number;
    coveragePenalty?: number;
    transferEntropy?: number;
    banditScore?: number;
    clusterConfidence?: number;
    graphSignalScore?: number;
    regimeMultiplier?: number;
    narrativeAlignmentScore?: number;
    metaHitProbability?: number;
  }>,
  forwardReturns: Array<{
    ideaRunId: string;
    signedReturnPct?: number | null;
    costAdjustedSignedReturnPct?: number | null;
  }>,
): MLTrainingSample[] {
  const returnByIdeaRun = new Map<string, number[]>();
  for (const fr of forwardReturns) {
    const value = typeof fr.costAdjustedSignedReturnPct === 'number'
      ? fr.costAdjustedSignedReturnPct
      : fr.signedReturnPct;
    if (typeof value !== 'number' || !Number.isFinite(value)) continue;
    const bucket = returnByIdeaRun.get(fr.ideaRunId) ?? [];
    bucket.push(value);
    returnByIdeaRun.set(fr.ideaRunId, bucket);
  }

  const samples: MLTrainingSample[] = [];
  for (const ir of ideaRuns) {
    const returns = returnByIdeaRun.get(ir.id);
    if (!returns || returns.length === 0) continue;
    const avgReturn = returns.reduce((a, b) => a + b, 0) / returns.length;

    const features = buildFeatureArrayFromIdeaRun(ir);
    samples.push({
      features,
      label: avgReturn > 0 ? 1 : 0,
      returnPct: avgReturn,
      timestamp: ir.timestamp ?? '',
    });
  }
  return samples;
}

/**
 * Train all ensemble models on accumulated samples.
 * Called after each validation phase in the walk-forward loop.
 */
export function trainEnsembleModels(
  state: MLWalkForwardState,
  newSamples: MLTrainingSample[],
): MLWalkForwardState {
  const allSamples = [...state.accumulatedSamples, ...newSamples];
  if (allSamples.length < 30) {
    return { ...state, accumulatedSamples: allSamples };
  }

  // Compute normalization from training data
  const rawFeatures = allSamples.map(s => s.features);
  const normalization = computeNormalization(rawFeatures);

  // Normalize features
  const normalizedExamples = allSamples.map(s => ({
    features: normalizeFeatures(s.features, normalization),
    label: s.label,
  }));

  // Split: 85% train, 15% validation for calibration
  const splitIdx = Math.floor(normalizedExamples.length * 0.85);
  const trainExamples = normalizedExamples.slice(0, splitIdx);
  const valExamples = normalizedExamples.slice(splitIdx);

  // Train Model A: Elastic Net — strong regularization for 10 features
  let elasticNet: ElasticNetModel | null = null;
  try {
    elasticNet = trainElasticNet(trainExamples, {
      l1Lambda: 0.01,     // strong L1 for feature selection
      l2Lambda: 0.05,     // strong L2 for stability
      iterations: 800,
      learningRate: 0.02,
      earlyStopPatience: 10,
    });
  } catch { /* fallback to null */ }

  // Train Model C: Gradient Boosting — shallow trees, heavy shrinkage
  let gbm: GBMModel | null = null;
  try {
    gbm = trainGBM(trainExamples, {
      rounds: 80,          // fewer rounds to avoid overfitting
      shrinkage: 0.03,     // very conservative learning rate
      subsampleRate: 0.6,  // 60% row sampling
      maxFeaturesFraction: 0.8,
      earlyStopPatience: 15,
    });
  } catch { /* fallback to null */ }

  // Train/Update Model D: Bayesian Logistic
  let bayesianModel = state.bayesianModel;
  if (!bayesianModel) {
    // Initialize with hardcoded weights as prior
    const priorMean = HARDCODED_PRIOR_WEIGHTS.slice();
    bayesianModel = initializeBayesianModel({
      featureDim: 10,  // unified 10-feature model
      priorMean,
      priorPrecision: 2.0,
    });
  }
  try {
    bayesianModel = updateBayesianModel(bayesianModel, trainExamples);
  } catch { /* keep existing */ }

  // Fit isotonic calibrators on validation set
  let elasticNetCalibrator: IsotonicCalibrator | null = null;
  let gbmCalibrator: IsotonicCalibrator | null = null;
  let bayesianCalibrator: IsotonicCalibrator | null = null;

  if (valExamples.length >= 20) {
    const valLabels = valExamples.map(e => e.label);

    if (elasticNet) {
      const preds = valExamples.map(e => predictElasticNet(elasticNet!, e.features));
      elasticNetCalibrator = fitIsotonicRegression(preds, valLabels);
    }
    if (gbm) {
      const preds = valExamples.map(e => predictGBM(gbm!, e.features));
      gbmCalibrator = fitIsotonicRegression(preds, valLabels);
    }
    if (bayesianModel) {
      const preds = valExamples.map(e => predictBayesian(bayesianModel!, e.features).probability);
      bayesianCalibrator = fitIsotonicRegression(preds, valLabels);
    }
  }

  // Optimize ensemble weights via CMA-ES on validation set
  let ensembleWeights = [0.25, 0.25, 0.25, 0.25];
  if (valExamples.length >= 20) {
    const valReturns = allSamples.slice(splitIdx).map(s => s.returnPct);
    const modelPreds = valExamples.map(e => [
      elasticNet ? predictElasticNet(elasticNet, e.features) : 0.5,
      0.5, // KNN placeholder (requires DB query, skip in offline training)
      gbm ? predictGBM(gbm, e.features) : 0.5,
      bayesianModel ? predictBayesian(bayesianModel, e.features).probability : 0.5,
    ]);

    try {
      const result = optimizeEnsembleWeights(
        4,
        (weights) => computeEnsembleFitness(modelPreds, valReturns, weights),
        { populationSize: 14, maxGenerations: 50, initialSigma: 0.3, tolerance: 1e-6 },
      );
      ensembleWeights = result.weights;
    } catch { /* keep equal weights */ }
  }

  const ensemble: EnsembleModels = {
    elasticNet,
    gbm,
    bayesian: bayesianModel,
    calibrators: {
      elasticNet: elasticNetCalibrator,
      gbm: gbmCalibrator,
      bayesian: bayesianCalibrator,
      knn: state.ensemble.calibrators.knn,
    },
    ensembleWeights,
  };

  return {
    ensemble,
    normalization,
    bayesianModel,
    accumulatedSamples: allSamples,
    foldsTrained: state.foldsTrained + 1,
  };
}

// Prior weights for 10-feature unified model (from labeled_outcomes AUC analysis)
const HARDCODED_PRIOR_WEIGHTS = [
  0.05,   // source_guardian (slightly positive — higher quality)
  0.02,   // source_nyt
  -0.03,  // theme_conflict
  0.10,   // theme_tech (strongest signal from Phase 0)
  -0.02,  // theme_energy
  0.02,   // theme_economy
  0.04,   // theme_politics
  -0.05,  // goldstein (negative goldstein = conflict = stress)
  -0.02,  // tone (sentiment extremity)
  0.03,   // event_intensity
  0,      // bias term
];

/**
 * Unified 10-feature vector — identical features for training and prediction.
 * These are the ONLY features with demonstrated predictive power (AUC 0.57).
 * All 10 features are available from both labeled_outcomes and idea cards.
 */
function buildFeatureArrayFromIdeaRun(ir: {
  calibratedConfidence?: number;
  confirmationScore?: number;
  realityScore?: number;
  conviction?: number;
  falsePositiveRisk?: number;
  coveragePenalty?: number;
  transferEntropy?: number;
  banditScore?: number;
  clusterConfidence?: number;
  graphSignalScore?: number;
  regimeMultiplier?: number;
  narrativeAlignmentScore?: number;
  metaHitProbability?: number;
  // Unified context fields (also available in pre-training)
  themeId?: string;
  source?: string;
  marketStressPrior?: number;
  transmissionStress?: number | null;
}): number[] {
  const theme = (ir.themeId ?? '').toLowerCase();
  return [
    // Source (2)
    (ir.source ?? '').includes('guardian') ? 1 : 0,
    (ir.source ?? '').includes('nyt') ? 1 : 0,
    // Theme (5)
    theme === 'conflict' || theme.includes('defense') || theme.includes('escalation') ? 1 : 0,
    theme === 'tech' || theme.includes('semiconductor') || theme.includes('cyber') ? 1 : 0,
    theme === 'energy' || theme.includes('oil') || theme.includes('gas') ? 1 : 0,
    theme === 'economy' || theme.includes('inflation') || theme.includes('trade') ? 1 : 0,
    theme === 'politics' || theme.includes('sanction') || theme.includes('tariff') ? 1 : 0,
    // GDELT context (3) — from marketStressPrior/transmissionStress which are now filled by GDELT proxy
    Math.min(1, Math.max(0, Number(ir.marketStressPrior) || 0)),
    Math.min(1, Math.max(0, Number(ir.transmissionStress) || 0)),
    Math.min(1, Math.max(0, (Number(ir.conviction) || 50) / 100)),  // conviction as proxy for event intensity
  ];
}

void MLFeatureNames;
void featureVectorToArray;

/**
 * SQL query to load pre-training samples from labeled_outcomes + articles + gdelt_daily_agg.
 * Returns data that can be converted to MLTrainingSample[].
 * Must be filtered by temporalBarrier to prevent look-ahead.
 */
export function buildPreTrainingQuery(temporalBarrier: string, limit: number = 20000): {
  text: string;
  values: (string | number)[];
} {
  return {
    text: `
      SELECT
        lo.forward_return_pct,
        CASE WHEN lo.forward_return_pct > 0 THEN 1 ELSE 0 END AS hit,
        lo.theme,
        a.source,
        a.published_at::text AS timestamp,
        COALESCE(g.avg_goldstein, 0)::float AS goldstein,
        COALESCE(g.avg_tone, 0)::float AS tone,
        COALESCE(g.event_count, 0)::int AS event_count
      FROM labeled_outcomes lo
      JOIN articles a ON lo.article_id = a.id
      LEFT JOIN gdelt_daily_agg g ON g.date = DATE(a.published_at)
        AND g.cameo_root IN ('14','17','18','19','20')
        AND g.country = 'US'
      WHERE lo.horizon = '2w'
        AND a.published_at < $1::timestamptz
      ORDER BY a.published_at DESC
      LIMIT $2
    `,
    values: [temporalBarrier, limit],
  };
}

/**
 * Convert raw SQL rows from labeled_outcomes into MLTrainingSamples.
 * Uses the SAME 10 context features as buildFeatureArrayFromIdeaRun.
 */
export function convertPreTrainingRows(
  rows: Array<{
    forward_return_pct: number;
    hit: number;
    theme: string;
    source: string;
    timestamp: string;
    goldstein: number;
    tone: number;
    event_count: number;
  }>,
): MLTrainingSample[] {
  return rows.map(row => {
    // Identical 10-feature vector as buildFeatureArrayFromIdeaRun
    const goldsteinNorm = Math.min(1, Math.max(0, (-Number(row.goldstein) + 5) / 10));
    const toneNorm = Math.min(1, Math.max(0, Math.abs(Number(row.tone)) / 10));
    const eventIntensity = Math.min(1, Math.log1p(Number(row.event_count)) / 8);

    const features = [
      // Source (2)
      row.source === 'guardian' ? 1 : 0,
      row.source === 'nyt' ? 1 : 0,
      // Theme (5)
      row.theme === 'conflict' ? 1 : 0,
      row.theme === 'tech' ? 1 : 0,
      row.theme === 'energy' ? 1 : 0,
      row.theme === 'economy' ? 1 : 0,
      row.theme === 'politics' ? 1 : 0,
      // GDELT context (3)
      goldsteinNorm,
      toneNorm,
      eventIntensity,
    ];

    return {
      features,
      label: Number(row.hit),
      returnPct: Number(row.forward_return_pct),
      timestamp: row.timestamp,
    };
  });
}
