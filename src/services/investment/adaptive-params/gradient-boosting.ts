// ---------------------------------------------------------------------------
// Mini Gradient Boosted Decision Stumps (GBDT) for binary classification.
// Pure TypeScript -- no external ML libraries.
// ---------------------------------------------------------------------------

/* ---- Interfaces -------------------------------------------------------- */

export interface DecisionStump {
  featureIndex: number;
  threshold: number;
  leftValue: number;   // prediction if feature <= threshold
  rightValue: number;  // prediction if feature > threshold
}

export interface GBMModel {
  stumps: DecisionStump[];
  initialLogOdds: number;
  shrinkage: number;
  featureImportance: number[];  // sum of variance reduction per feature
}

/* ---- Options ----------------------------------------------------------- */

interface TrainOptions {
  rounds?: number;               // default 200
  shrinkage?: number;            // default 0.08
  subsampleRate?: number;        // default 0.7
  candidateThresholds?: number;  // default 15
  minLeafSize?: number;          // default 20
  maxFeaturesFraction?: number;  // default 0.7
  earlyStopPatience?: number;    // default 20
  validationSplit?: number;      // default 0.15
}

interface Example {
  features: number[];
  label: number; // 0 or 1
}

/* ---- Helpers ----------------------------------------------------------- */

/** Safe indexed access for number arrays -- returns 0 for out-of-bounds. */
function at(arr: number[] | Float64Array, i: number): number {
  return arr[i] ?? 0;
}

function sigmoid(x: number): number {
  // Clamp to avoid overflow in Math.exp
  const clamped = Math.max(-30, Math.min(30, x));
  return 1 / (1 + Math.exp(-clamped));
}

function logLoss(predictions: number[], labels: number[]): number {
  const eps = 1e-15;
  let sum = 0;
  for (let i = 0; i < labels.length; i++) {
    const p = Math.max(eps, Math.min(1 - eps, sigmoid(at(predictions, i))));
    sum += -(at(labels, i) * Math.log(p) + (1 - at(labels, i)) * Math.log(1 - p));
  }
  return sum / labels.length;
}

/** Fisher-Yates partial shuffle: pick `k` random indices from `0..n-1`. */
function sampleIndices(n: number, k: number): number[] {
  const arr = Array.from({ length: n }, (_, i) => i);
  const count = Math.min(k, n);
  for (let i = 0; i < count; i++) {
    const j = i + Math.floor(Math.random() * (n - i));
    [arr[i], arr[j]] = [arr[j]!, arr[i]!];
  }
  return arr.slice(0, count);
}

/** Return `count` evenly-spaced quantiles of `values`. */
function quantileThresholds(values: number[], count: number): number[] {
  if (values.length === 0) return [];
  const sorted = [...values].sort((a, b) => a - b);
  const thresholds: number[] = [];
  for (let q = 1; q <= count; q++) {
    const idx = Math.floor((q / (count + 1)) * sorted.length);
    const val = sorted[Math.min(idx, sorted.length - 1)]!;
    // Avoid duplicate thresholds
    if (thresholds.length === 0 || val !== at(thresholds, thresholds.length - 1)) {
      thresholds.push(val);
    }
  }
  return thresholds;
}

/* ---- Training ---------------------------------------------------------- */

export function trainGBM(examples: Example[], options: TrainOptions = {}): GBMModel {
  const {
    rounds = 200,
    shrinkage = 0.08,
    subsampleRate = 0.7,
    candidateThresholds = 15,
    minLeafSize = 20,
    maxFeaturesFraction = 0.7,
    earlyStopPatience = 20,
    validationSplit = 0.15,
  } = options;

  if (examples.length === 0) {
    return { stumps: [], initialLogOdds: 0, shrinkage, featureImportance: [] };
  }

  const nFeatures = examples[0]!.features.length;

  // -- Train / validation split (deterministic: last portion is validation) --
  const nVal = Math.max(1, Math.floor(examples.length * validationSplit));
  const nTrain = examples.length - nVal;

  // Shuffle indices for split
  const shuffled = sampleIndices(examples.length, examples.length);
  const trainIdx = shuffled.slice(0, nTrain);
  const valIdx = shuffled.slice(nTrain);

  const trainExamples = trainIdx.map((i) => examples[i]!);
  const valExamples = valIdx.map((i) => examples[i]!);

  const trainLabels = trainExamples.map((e) => e.label);
  const valLabels = valExamples.map((e) => e.label);

  // -- Initial log-odds --
  const posCount = trainLabels.reduce((s, l) => s + l, 0);
  const negCount = trainLabels.length - posCount;
  const initialLogOdds = Math.log((posCount + 1e-8) / (negCount + 1e-8));

  // Raw predictions (in log-odds space)
  const trainPred = new Float64Array(trainExamples.length).fill(initialLogOdds);
  const valPred = new Float64Array(valExamples.length).fill(initialLogOdds);

  const stumps: DecisionStump[] = [];
  const featureImportance = new Float64Array(nFeatures);

  let bestValLoss = Infinity;
  let patienceCounter = 0;

  for (let round = 0; round < rounds; round++) {
    // (a) Residuals: label - sigmoid(prediction) (negative gradient of log-loss)
    const residuals = new Float64Array(trainExamples.length);
    for (let i = 0; i < trainExamples.length; i++) {
      residuals[i] = at(trainLabels, i) - sigmoid(at(trainPred, i));
    }

    // (b) Subsample data
    const subSize = Math.max(1, Math.floor(trainExamples.length * subsampleRate));
    const subIdx = sampleIndices(trainExamples.length, subSize);

    // (c) Randomly select features
    const nSelectedFeatures = Math.max(1, Math.floor(nFeatures * maxFeaturesFraction));
    const selectedFeatures = sampleIndices(nFeatures, nSelectedFeatures);

    // (d) Find the best stump
    let bestVarianceReduction = -Infinity;
    let bestStump: DecisionStump | null = null;

    for (const fIdx of selectedFeatures) {
      // Collect feature values for candidate threshold computation
      const featureVals = subIdx.map((i) => at(trainExamples[i]!.features, fIdx));
      const thresholds = quantileThresholds(featureVals, candidateThresholds);

      for (const threshold of thresholds) {
        let leftSum = 0;
        let leftCount = 0;
        let rightSum = 0;
        let rightCount = 0;

        for (const i of subIdx) {
          if (at(trainExamples[i]!.features, fIdx) <= threshold) {
            leftSum += at(residuals, i);
            leftCount++;
          } else {
            rightSum += at(residuals, i);
            rightCount++;
          }
        }

        // Skip if either leaf has fewer than minLeafSize samples
        if (leftCount < minLeafSize || rightCount < minLeafSize) continue;

        const leftMean = leftSum / leftCount;
        const rightMean = rightSum / rightCount;
        const totalMean = (leftSum + rightSum) / (leftCount + rightCount);

        // Variance reduction
        const varianceReduction =
          leftCount * (leftMean - totalMean) ** 2 +
          rightCount * (rightMean - totalMean) ** 2;

        if (varianceReduction > bestVarianceReduction) {
          bestVarianceReduction = varianceReduction;
          bestStump = {
            featureIndex: fIdx,
            threshold,
            leftValue: leftMean,   // placeholder, will recompute with Newton step
            rightValue: rightMean,  // placeholder
          };
        }
      }
    }

    // If no valid stump found, stop
    if (bestStump === null) break;

    // (f) Recompute leaf values using Newton step on the full subsample
    let leftNumer = 0;
    let leftDenom = 0;
    let rightNumer = 0;
    let rightDenom = 0;

    for (const i of subIdx) {
      const r = at(residuals, i);
      const absR = Math.abs(r);
      const hessian = absR * (1 - absR);  // |r| * (1 - |r|)
      if (at(trainExamples[i]!.features, bestStump.featureIndex) <= bestStump.threshold) {
        leftNumer += r;
        leftDenom += hessian;
      } else {
        rightNumer += r;
        rightDenom += hessian;
      }
    }

    // (g) Multiply leaf values by shrinkage
    bestStump.leftValue = shrinkage * (leftNumer / (leftDenom + 1e-8));
    bestStump.rightValue = shrinkage * (rightNumer / (rightDenom + 1e-8));

    stumps.push(bestStump);

    // (e) Accumulate feature importance
    featureImportance[bestStump.featureIndex] =
      at(featureImportance, bestStump.featureIndex) + bestVarianceReduction;

    // (h) Update training predictions
    for (let i = 0; i < trainExamples.length; i++) {
      if (at(trainExamples[i]!.features, bestStump.featureIndex) <= bestStump.threshold) {
        trainPred[i] = at(trainPred, i) + bestStump.leftValue;
      } else {
        trainPred[i] = at(trainPred, i) + bestStump.rightValue;
      }
    }

    // Update validation predictions
    for (let i = 0; i < valExamples.length; i++) {
      if (at(valExamples[i]!.features, bestStump.featureIndex) <= bestStump.threshold) {
        valPred[i] = at(valPred, i) + bestStump.leftValue;
      } else {
        valPred[i] = at(valPred, i) + bestStump.rightValue;
      }
    }

    // (i) Early stopping on validation loss
    const valLoss = logLoss(Array.from(valPred), valLabels);
    if (valLoss < bestValLoss - 1e-6) {
      bestValLoss = valLoss;
      patienceCounter = 0;
    } else {
      patienceCounter++;
      if (patienceCounter >= earlyStopPatience) break;
    }
  }

  return {
    stumps,
    initialLogOdds,
    shrinkage,
    featureImportance: Array.from(featureImportance),
  };
}

/* ---- Prediction -------------------------------------------------------- */

export function predictGBM(model: GBMModel, features: number[]): number {
  let logOdds = model.initialLogOdds;
  for (const stump of model.stumps) {
    if (at(features, stump.featureIndex) <= stump.threshold) {
      logOdds += stump.leftValue;
    } else {
      logOdds += stump.rightValue;
    }
  }
  return sigmoid(logOdds);
}

/* ---- Feature importance ------------------------------------------------ */

export function getFeatureImportance(
  model: GBMModel,
): Array<{ index: number; importance: number }> {
  return model.featureImportance
    .map((importance, index) => ({ index, importance }))
    .sort((a, b) => b.importance - a.importance);
}
