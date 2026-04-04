// ---------------------------------------------------------------------------
// Bayesian Online Logistic Regression — Laplace Approximation
// Pure TypeScript -- no external ML libraries
//
// Uses informative priors (e.g. from hardcoded weights) to solve the
// cold-start problem.  Diagonal precision only — efficient for ≤23 features.
// ---------------------------------------------------------------------------

/* ---- public types ---- */

export interface BayesianLogisticModel {
  /** Posterior mean of weights (length = featureDim + 1, last element is bias). */
  mean: number[];
  /** Diagonal of precision matrix (inverse variance per weight). */
  precision: number[];
  observationCount: number;
  featureDim: number;
}

export interface InitializeOptions {
  featureDim: number;
  /** Prior mean — typically from existing hardcoded weights. Defaults to zeros. */
  priorMean?: number[];
  /** Scalar prior precision applied to every weight. Defaults to 2.0. */
  priorPrecision?: number;
}

export interface PredictionResult {
  /** Point-estimate probability via sigmoid(mean^T x). */
  probability: number;
  /** Predictive standard deviation: sqrt(sum(x_j^2 / precision_j)). */
  uncertainty: number;
}

interface TrainingExample {
  features: number[];
  label: number;
}

/* ---- helpers ---- */

/** Safe array read – returns 0 for out-of-bounds. */
function at(arr: number[], i: number): number { return arr[i] ?? 0; }

/** Numerically stable sigmoid with input clamping to avoid overflow. */
function sigmoid(x: number): number {
  const clamped = Math.max(-500, Math.min(500, x));
  return 1 / (1 + Math.exp(-clamped));
}

/**
 * Compute dot product of weight vector `w` with augmented feature vector
 * `[features, 1]` (bias term appended).
 */
function linearCombination(w: number[], features: number[]): number {
  let sum = 0;
  for (let j = 0; j < features.length; j++) {
    sum += at(w, j) * at(features, j);
  }
  sum += at(w, features.length);
  return sum;
}

/* ---- public API ---- */

/**
 * Create a fresh Bayesian logistic model with the given prior.
 *
 * If `priorMean` is supplied (e.g. from existing hardcoded weights) it is
 * used as the initial posterior mean, giving the model a warm start.
 */
export function initializeBayesianModel(options: InitializeOptions): BayesianLogisticModel {
  const { featureDim, priorPrecision = 2.0 } = options;
  const dim = featureDim + 1; // +1 for bias

  const mean: number[] = new Array<number>(dim).fill(0);
  if (options.priorMean !== undefined) {
    for (let j = 0; j < dim; j++) {
      mean[j] = j < options.priorMean.length ? at(options.priorMean, j) : 0;
    }
  }

  const precision: number[] = new Array(dim);
  precision.fill(priorPrecision);

  return { mean, precision, observationCount: 0, featureDim };
}

/**
 * Perform a batch Bayesian update using Laplace approximation.
 *
 * Finds the MAP estimate via diagonal Newton-Raphson, then sets the new
 * posterior precision to the Hessian diagonal evaluated at the MAP.
 *
 * Returns a **new** model — the original is not mutated.
 */
export function updateBayesianModel(
  model: BayesianLogisticModel,
  examples: TrainingExample[],
): BayesianLogisticModel {
  if (examples.length === 0) return model;

  const dim = model.featureDim + 1;
  const n = examples.length;

  // Current prior mean and precision (from the incoming model)
  const priorMean = model.mean;
  const priorPrec = model.precision;

  // Working copy of weights — start from current posterior mean
  const w: number[] = priorMean.slice();

  // Pre-build augmented feature rows: [features, 1] for bias
  const X: number[][] = new Array<number[]>(n);
  const y: number[] = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    const ex = examples[i]!;
    const row = new Array<number>(dim).fill(0);
    for (let j = 0; j < ex.features.length; j++) {
      row[j] = at(ex.features, j);
    }
    row[dim - 1] = 1;
    X[i] = row;
    y[i] = ex.label;
  }

  const MAX_ITER = 10;
  const TOL = 1e-6;

  // Scratch buffers
  const gradient = new Array<number>(dim);
  const hessianDiag = new Array<number>(dim);

  for (let iter = 0; iter < MAX_ITER; iter++) {
    // ----- Compute predictions -----
    const p: number[] = new Array<number>(n);
    for (let i = 0; i < n; i++) {
      let dot = 0;
      const xi = X[i]!;
      for (let j = 0; j < dim; j++) dot += at(w, j) * at(xi, j);
      p[i] = sigmoid(dot);
    }

    gradient.fill(0);
    hessianDiag.fill(0);

    for (let j = 0; j < dim; j++) {
      let gj = 0;
      let hj = 0;
      for (let i = 0; i < n; i++) {
        const xij = at(X[i]!, j);
        const pi = at(p, i);
        gj += xij * (at(y, i) - pi);
        hj += xij * xij * pi * (1 - pi);
      }
      gj -= at(priorPrec, j) * (at(w, j) - at(priorMean, j));
      hj += at(priorPrec, j);

      gradient[j] = gj;
      hessianDiag[j] = hj;
    }

    let maxStep = 0;
    for (let j = 0; j < dim; j++) {
      const step = at(gradient, j) / at(hessianDiag, j);
      w[j] = at(w, j) + step;
      const absStep = Math.abs(step);
      if (absStep > maxStep) maxStep = absStep;
    }

    if (maxStep < TOL) break;
  }

  // ----- Final Hessian diagonal at MAP → new precision -----
  const newPrecision: number[] = new Array(dim);
  {
    const pFinal: number[] = new Array<number>(n);
    for (let i = 0; i < n; i++) {
      let dot = 0;
      const xi = X[i]!;
      for (let j = 0; j < dim; j++) dot += at(w, j) * at(xi, j);
      pFinal[i] = sigmoid(dot);
    }
    for (let j = 0; j < dim; j++) {
      let hj = 0;
      for (let i = 0; i < n; i++) {
        const xij = at(X[i]!, j);
        const pfi = at(pFinal, i);
        hj += xij * xij * pfi * (1 - pfi);
      }
      hj += at(priorPrec, j);
      newPrecision[j] = hj;
    }
  }

  return {
    mean: w,
    precision: newPrecision,
    observationCount: model.observationCount + n,
    featureDim: model.featureDim,
  };
}

/**
 * Predict probability and uncertainty for a single feature vector.
 *
 * - `probability`: sigmoid(mean^T [features, 1])
 * - `uncertainty`: predictive std-dev = sqrt( sum( x_j^2 / precision_j ) )
 *
 * For a better-calibrated probability you can apply the probit approximation:
 *   calibrated = sigmoid( logit / sqrt(1 + pi * variance / 8) )
 */
export function predictBayesian(
  model: BayesianLogisticModel,
  features: number[],
): PredictionResult {
  const logit = linearCombination(model.mean, features);
  const probability = sigmoid(logit);

  // Predictive variance from the diagonal posterior
  let variance = 0;
  for (let j = 0; j < features.length; j++) {
    const fj = at(features, j);
    variance += (fj * fj) / at(model.precision, j);
  }
  variance += 1 / at(model.precision, features.length);

  const uncertainty = Math.sqrt(variance);

  return { probability, uncertainty };
}

/* ---- serialization ---- */

export function exportModelState(model: BayesianLogisticModel): string {
  return JSON.stringify({
    mean: model.mean,
    precision: model.precision,
    observationCount: model.observationCount,
    featureDim: model.featureDim,
  });
}

export function importModelState(json: string): BayesianLogisticModel {
  const raw = JSON.parse(json) as {
    mean: number[];
    precision: number[];
    observationCount: number;
    featureDim: number;
  };
  return {
    mean: raw.mean,
    precision: raw.precision,
    observationCount: raw.observationCount,
    featureDim: raw.featureDim,
  };
}
