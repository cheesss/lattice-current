// ---------------------------------------------------------------------------
// Elastic Net Logistic Regression
// Pure TypeScript -- no external ML libraries
// ---------------------------------------------------------------------------

/* ---- public types ---- */

export interface ElasticNetModel {
  weights: number[];
  bias: number;
  selectedFeatures: number[]; // indices where |weight| > threshold
  trainLoss: number;
  iterations: number;
}

export interface TrainOptions {
  l1Lambda?: number;
  l2Lambda?: number;
  iterations?: number;
  learningRate?: number;
  batchSize?: number;
  earlyStopPatience?: number;
  validationSplit?: number;
}

interface Example {
  features: number[];
  label: number;
}

/* ---- helpers ---- */

/** Safe indexed access -- returns 0 for out-of-bounds / undefined slots. */
function at(arr: ArrayLike<number>, i: number): number {
  return arr[i] ?? 0;
}

function sigmoid(x: number): number {
  const clamped = Math.max(-500, Math.min(500, x));
  return 1 / (1 + Math.exp(-clamped));
}

function logLoss(predictions: number[], labels: number[]): number {
  const eps = 1e-15;
  let sum = 0;
  for (let i = 0; i < predictions.length; i++) {
    const p = Math.max(eps, Math.min(1 - eps, at(predictions, i)));
    const li = at(labels, i);
    sum += -(li * Math.log(p) + (1 - li) * Math.log(1 - p));
  }
  return sum / predictions.length;
}

/** Fisher-Yates in-place shuffle (index-based swap). */
function shuffleArray<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = arr[i]!;
    arr[i] = arr[j]!;
    arr[j] = tmp;
  }
  return arr;
}

/** Soft-thresholding operator for L1 proximal gradient. */
function softThreshold(value: number, threshold: number): number {
  if (value > threshold) return value - threshold;
  if (value < -threshold) return value + threshold;
  return 0;
}

/* ---- core ---- */

export function trainElasticNet(
  examples: Example[],
  options: TrainOptions = {},
): ElasticNetModel {
  const {
    l1Lambda = 0.005,
    l2Lambda = 0.01,
    iterations = 1500,
    learningRate: lr0 = 0.008,
    batchSize = 256,
    earlyStopPatience = 5,
    validationSplit = 0.15,
  } = options;

  if (examples.length === 0) {
    return {
      weights: [],
      bias: 0,
      selectedFeatures: [],
      trainLoss: NaN,
      iterations: 0,
    };
  }

  const dim = examples[0]!.features.length;

  // --- train / validation split ---
  const shuffled = shuffleArray([...examples]);
  const valSize = Math.max(1, Math.floor(shuffled.length * validationSplit));
  const valSet = shuffled.slice(0, valSize);
  const trainSet = shuffled.slice(valSize);

  // --- initialise weights to zero ---
  const weights = new Float64Array(dim); // all zeros
  let bias = 0;

  // --- early stopping bookkeeping ---
  let bestValLoss = Infinity;
  let patienceCounter = 0;
  let bestWeights = new Float64Array(dim);
  let bestBias = 0;
  let completedEpochs = 0;

  for (let epoch = 0; epoch < iterations; epoch++) {
    // learning-rate decay
    const lr = lr0 / (1 + 0.001 * epoch);

    // shuffle training set each epoch
    shuffleArray(trainSet);

    // --- mini-batch SGD ---
    for (let start = 0; start < trainSet.length; start += batchSize) {
      const end = Math.min(start + batchSize, trainSet.length);
      const mb = end - start;

      // accumulate gradients
      const gradW = new Float64Array(dim);
      let gradB = 0;

      for (let i = start; i < end; i++) {
        const ex = trainSet[i]!;
        let z = bias;
        for (let d = 0; d < dim; d++) {
          z += at(weights, d) * at(ex.features, d);
        }
        const pred = sigmoid(z);
        const err = pred - ex.label; // dL/dz for log-loss + sigmoid

        for (let d = 0; d < dim; d++) {
          gradW[d] = at(gradW, d) + err * at(ex.features, d);
        }
        gradB += err;
      }

      // average gradient
      for (let d = 0; d < dim; d++) {
        gradW[d] = at(gradW, d) / mb;
      }
      gradB /= mb;

      // --- weight update: gradient step + L2 weight decay + L1 proximal ---
      for (let d = 0; d < dim; d++) {
        // gradient descent + L2 penalty (weight decay form)
        weights[d] = at(weights, d) - lr * (at(gradW, d) + l2Lambda * at(weights, d));
        // L1 via proximal / soft-thresholding
        weights[d] = softThreshold(at(weights, d), lr * l1Lambda);
      }
      bias -= lr * gradB; // no regularisation on bias
    }

    completedEpochs = epoch + 1;

    // --- validation loss ---
    const valPreds: number[] = [];
    const valLabels: number[] = [];
    for (const ex of valSet) {
      let z = bias;
      for (let d = 0; d < dim; d++) {
        z += at(weights, d) * at(ex.features, d);
      }
      valPreds.push(sigmoid(z));
      valLabels.push(ex.label);
    }
    const valLoss = logLoss(valPreds, valLabels);

    if (valLoss < bestValLoss - 1e-8) {
      bestValLoss = valLoss;
      patienceCounter = 0;
      bestWeights = Float64Array.from(weights);
      bestBias = bias;
    } else {
      patienceCounter++;
      if (patienceCounter >= earlyStopPatience) {
        break; // early stop
      }
    }
  }

  // restore best weights
  const finalWeights = Array.from(bestWeights);
  const finalBias = bestBias;

  // --- compute training loss with best weights ---
  const trainPreds: number[] = [];
  const trainLabels: number[] = [];
  for (const ex of trainSet) {
    let z = finalBias;
    for (let d = 0; d < dim; d++) {
      z += at(finalWeights, d) * at(ex.features, d);
    }
    trainPreds.push(sigmoid(z));
    trainLabels.push(ex.label);
  }
  const trainLoss = logLoss(trainPreds, trainLabels);

  // --- selected features (|w| > 0.001) ---
  const selectedFeatures: number[] = [];
  for (let d = 0; d < dim; d++) {
    if (Math.abs(at(finalWeights, d)) > 0.001) {
      selectedFeatures.push(d);
    }
  }

  return {
    weights: finalWeights,
    bias: finalBias,
    selectedFeatures,
    trainLoss,
    iterations: completedEpochs,
  };
}

export function predictElasticNet(
  model: ElasticNetModel,
  features: number[],
): number {
  let z = model.bias;
  for (let i = 0; i < model.weights.length; i++) {
    z += at(model.weights, i) * at(features, i);
  }
  return sigmoid(z);
}

export function computeFeatureImportance(
  model: ElasticNetModel,
): Array<{ index: number; weight: number; absWeight: number }> {
  const result = model.weights.map((w, i) => ({
    index: i,
    weight: w,
    absWeight: Math.abs(w),
  }));
  result.sort((a, b) => b.absWeight - a.absWeight);
  return result;
}
