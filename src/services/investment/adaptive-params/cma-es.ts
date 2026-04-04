/**
 * cma-es.ts — Covariance Matrix Adaptation Evolution Strategy.
 *
 * Gradient-free optimizer for ensemble weights and sizing parameters.
 * Particularly effective for optimizing Sharpe ratio (non-differentiable objective)
 * with small parameter spaces (4-10 dimensions).
 */

function at(arr: number[], i: number): number { return arr[i] ?? 0; }

export interface CmaEsConfig {
  populationSize: number;
  maxGenerations: number;
  initialSigma: number;
  tolerance: number;
}

export const DEFAULT_CMA_CONFIG: CmaEsConfig = {
  populationSize: 14,
  maxGenerations: 100,
  initialSigma: 0.3,
  tolerance: 1e-8,
};

export interface CmaEsResult {
  bestSolution: number[];
  bestFitness: number;
  generations: number;
  converged: boolean;
}

/**
 * Optimize a function using CMA-ES (simplified diagonal variant for efficiency).
 *
 * @param objectiveFunction Function to MINIMIZE. Takes parameter vector, returns fitness (lower is better).
 * @param initialMean Starting point.
 * @param config CMA-ES hyperparameters.
 * @returns Optimization result.
 */
export function optimizeCmaEs(
  objectiveFunction: (params: number[]) => number,
  initialMean: number[],
  config: CmaEsConfig = DEFAULT_CMA_CONFIG,
): CmaEsResult {
  const dim = initialMean.length;
  const lambda = Math.max(config.populationSize, 4 + Math.floor(3 * Math.log(dim)));
  const mu = Math.floor(lambda / 2);

  // Selection weights (log-linear)
  const rawWeights = Array.from({ length: mu }, (_, i) =>
    Math.log(mu + 0.5) - Math.log(i + 1),
  );
  const wSum = rawWeights.reduce((a, b) => a + b, 0);
  const weights = rawWeights.map(w => w / wSum);
  const muEff = 1 / weights.reduce((s, w) => s + w * w, 0);

  // Step size adaptation parameters
  const cSigma = (muEff + 2) / (dim + muEff + 5);
  const dSigma = 1 + 2 * Math.max(0, Math.sqrt((muEff - 1) / (dim + 1)) - 1) + cSigma;
  const chiN = Math.sqrt(dim) * (1 - 1 / (4 * dim) + 1 / (21 * dim * dim));

  // Covariance adaptation parameters (diagonal)
  const cc = (4 + muEff / dim) / (dim + 4 + 2 * muEff / dim);
  const c1 = 2 / ((dim + 1.3) * (dim + 1.3) + muEff);
  const cmu = Math.min(1 - c1, 2 * (muEff - 2 + 1 / muEff) / ((dim + 2) * (dim + 2) + muEff));

  // State
  const mean = [...initialMean];
  let sigma = config.initialSigma;
  const diagC = new Array(dim).fill(1);  // diagonal covariance
  const pc = new Array(dim).fill(0);     // evolution path for C
  const ps = new Array(dim).fill(0);     // evolution path for sigma

  let bestSolution = [...mean];
  let bestFitness = objectiveFunction(mean);
  let generation = 0;
  let converged = false;

  for (generation = 0; generation < config.maxGenerations; generation++) {
    // Generate candidates
    const candidates: Array<{ solution: number[]; fitness: number }> = [];
    for (let k = 0; k < lambda; k++) {
      const x = new Array<number>(dim);
      for (let j = 0; j < dim; j++) {
        const z = sampleNormal();
        x[j] = at(mean, j) + sigma * Math.sqrt(at(diagC, j)) * z;
      }
      candidates.push({ solution: x, fitness: objectiveFunction(x) });
    }

    candidates.sort((a, b) => a.fitness - b.fitness);

    const best0 = candidates[0]!;
    if (best0.fitness < bestFitness) {
      bestFitness = best0.fitness;
      bestSolution = [...best0.solution];
    }

    const oldMean = [...mean];
    for (let j = 0; j < dim; j++) {
      mean[j] = 0;
      for (let i = 0; i < mu; i++) {
        mean[j] = at(mean, j) + at(weights, i) * at(candidates[i]!.solution, j);
      }
    }

    const meanShift = mean.map((m, j) => (m - at(oldMean, j)) / sigma);
    for (let j = 0; j < dim; j++) {
      const msj = at(meanShift, j);
      const normalizedShift = msj / Math.sqrt(at(diagC, j));
      ps[j] = (1 - cSigma) * at(ps, j) + Math.sqrt(cSigma * (2 - cSigma) * muEff) * normalizedShift;
      pc[j] = (1 - cc) * at(pc, j) + Math.sqrt(cc * (2 - cc) * muEff) * msj;
    }

    for (let j = 0; j < dim; j++) {
      let rankMuUpdate = 0;
      for (let i = 0; i < mu; i++) {
        const diff = (at(candidates[i]!.solution, j) - at(oldMean, j)) / sigma;
        rankMuUpdate += at(weights, i) * diff * diff;
      }
      diagC[j] = (1 - c1 - cmu) * at(diagC, j)
        + c1 * at(pc, j) * at(pc, j)
        + cmu * rankMuUpdate;
      diagC[j] = Math.max(1e-20, at(diagC, j));
    }

    // Update step size
    const psNorm = Math.sqrt(ps.reduce((s, v) => s + v * v, 0));
    sigma *= Math.exp((cSigma / dSigma) * (psNorm / chiN - 1));
    sigma = Math.max(1e-20, Math.min(1e6, sigma));

    // Check convergence
    const maxStd = Math.max(...diagC.map(c => sigma * Math.sqrt(c)));
    if (maxStd < config.tolerance) {
      converged = true;
      break;
    }
  }

  return {
    bestSolution,
    bestFitness,
    generations: generation + 1,
    converged,
  };
}

/**
 * Optimize ensemble weights (softmax-normalized) to maximize a portfolio objective.
 *
 * @param nModels Number of models in ensemble.
 * @param objectiveFunction Takes softmax-normalized weights, returns NEGATIVE fitness (will be negated internally for minimization).
 * @param config CMA-ES config.
 */
export function optimizeEnsembleWeights(
  nModels: number,
  objectiveFunction: (weights: number[]) => number,
  config: CmaEsConfig = DEFAULT_CMA_CONFIG,
): { weights: number[]; fitness: number; generations: number } {
  const initial = new Array(nModels).fill(0); // softmax(0,0,...0) = equal weights

  const wrappedObjective = (rawWeights: number[]) => {
    const softmaxWeights = softmax(rawWeights);
    return -objectiveFunction(softmaxWeights); // negate for maximization
  };

  const result = optimizeCmaEs(wrappedObjective, initial, config);
  return {
    weights: softmax(result.bestSolution),
    fitness: -result.bestFitness,
    generations: result.generations,
  };
}

function softmax(x: number[]): number[] {
  const maxX = Math.max(...x);
  const exps = x.map(v => Math.exp(v - maxX));
  const sum = exps.reduce((a, b) => a + b, 0);
  return exps.map(e => e / sum);
}

// Box-Muller transform for normal sampling
let _spareNormal: number | null = null;
function sampleNormal(): number {
  if (_spareNormal !== null) {
    const val = _spareNormal;
    _spareNormal = null;
    return val;
  }
  let u: number, v: number, s: number;
  do {
    u = Math.random() * 2 - 1;
    v = Math.random() * 2 - 1;
    s = u * u + v * v;
  } while (s >= 1 || s === 0);
  const mul = Math.sqrt(-2 * Math.log(s) / s);
  _spareNormal = v * mul;
  return u * mul;
}
