import { clamp } from './math-utils';

export interface MetaWeights {
  featureNames: string[];
  weights: number[];
  bias: number;
}

export interface CredibilityWeights {
  featureNames: string[];
  weights: number[];
  bias: number;
}

export interface MetaTrainingExample {
  confidence: number;
  confirmation: number;
  reality: number;
  replayHitRate: number;
  currentHitRate: number;
  coverage: number;
  bandit: number;
  transfer: number;
  stability: number;
  falsePositivePenalty: number;
  driftPenalty: number;
  hit: boolean;
}

export interface CredibilityTrainingExample {
  corroboration: number;
  historicalAccuracy: number;
  posteriorAccuracy: number;
  truthAgreement: number;
  emReliability: number;
  feedHealth: number;
  inversePropaganda: number;
  actualCredibility: number;
}

export type WeightVector = MetaWeights | CredibilityWeights;

const META_FEATURE_NAMES = [
  'confidence',
  'confirmation',
  'reality',
  'replayHitRate',
  'currentHitRate',
  'coverage',
  'bandit',
  'transfer',
  'stability',
  'falsePositivePenalty',
  'driftPenalty',
] as const;

const CREDIBILITY_FEATURE_NAMES = [
  'corroboration',
  'historicalAccuracy',
  'posteriorAccuracy',
  'truthAgreement',
  'emReliability',
  'feedHealth',
  'inversePropaganda',
] as const;

const META_LEARNING_RATE = 0.01;
const META_ITERATIONS = 1000;
const META_L2_LAMBDA = 0.01;
const CREDIBILITY_L2_LAMBDA = 0.1;

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function safeNumber(value: unknown, fallback = 0): number {
  return isFiniteNumber(value) ? value : fallback;
}

function sigmoid(value: number): number {
  const bounded = clamp(value, -30, 30);
  return 1 / (1 + Math.exp(-bounded));
}

function dotProduct(left: number[], right: number[]): number {
  let total = 0;
  for (let index = 0; index < left.length; index += 1) {
    total += safeNumber(left[index]) * safeNumber(right[index]);
  }
  return total;
}

function transpose(matrix: number[][]): number[][] {
  if (matrix.length === 0) return [];
  const columnCount = matrix[0]?.length ?? 0;
  return Array.from({ length: columnCount }, (_, columnIndex) =>
    matrix.map((row) => safeNumber(row[columnIndex])));
}

function multiplyMatrices(left: number[][], right: number[][]): number[][] {
  if (left.length === 0 || right.length === 0) return [];
  const sharedCount = right.length;
  const columnCount = right[0]?.length ?? 0;
  return left.map((row) =>
    Array.from({ length: columnCount }, (_, columnIndex) => {
      let total = 0;
      for (let sharedIndex = 0; sharedIndex < sharedCount; sharedIndex += 1) {
        total += safeNumber(row[sharedIndex]) * safeNumber(right[sharedIndex]?.[columnIndex]);
      }
      return total;
    }));
}

function multiplyMatrixVector(matrix: number[][], vector: number[]): number[] {
  return matrix.map((row) => dotProduct(row, vector));
}

function invertMatrix(matrix: number[][]): number[][] {
  const size = matrix.length;
  const augmented = matrix.map((row, rowIndex) => ([
    ...row,
    ...Array.from({ length: size }, (_, columnIndex) => (rowIndex === columnIndex ? 1 : 0)),
  ]));

  for (let pivotIndex = 0; pivotIndex < size; pivotIndex += 1) {
    let pivotRow = pivotIndex;
    while (pivotRow < size && Math.abs(augmented[pivotRow]?.[pivotIndex] || 0) < 1e-12) {
      pivotRow += 1;
    }
    if (pivotRow === size) {
      throw new Error('[weight-learner] ridge regression matrix is singular');
    }
    if (pivotRow !== pivotIndex) {
      [augmented[pivotIndex], augmented[pivotRow]] = [augmented[pivotRow]!, augmented[pivotIndex]!];
    }

    const pivot = safeNumber(augmented[pivotIndex]![pivotIndex]);
    if (Math.abs(pivot) < 1e-12 || !Number.isFinite(pivot)) {
      throw new Error('[weight-learner] ridge regression matrix pivot is unstable');
    }
    for (let columnIndex = 0; columnIndex < size * 2; columnIndex += 1) {
      augmented[pivotIndex]![columnIndex] = safeNumber(augmented[pivotIndex]![columnIndex]) / pivot;
    }

    for (let rowIndex = 0; rowIndex < size; rowIndex += 1) {
      if (rowIndex === pivotIndex) continue;
      const factor = safeNumber(augmented[rowIndex]![pivotIndex]);
      if (factor === 0) continue;
      for (let columnIndex = 0; columnIndex < size * 2; columnIndex += 1) {
        augmented[rowIndex]![columnIndex] =
          safeNumber(augmented[rowIndex]![columnIndex]) - factor * safeNumber(augmented[pivotIndex]![columnIndex]);
      }
    }
  }

  return augmented.map((row) => row.slice(size));
}

export function assertFiniteWeights(weights: WeightVector, label: string): WeightVector {
  if (weights.featureNames.length !== weights.weights.length) {
    throw new Error(`[weight-learner] ${label} feature/weight length mismatch`);
  }
  if (!isFiniteNumber(weights.bias)) {
    throw new Error(`[weight-learner] ${label} bias is non-finite`);
  }
  if (!weights.weights.every((entry) => isFiniteNumber(entry))) {
    throw new Error(`[weight-learner] ${label} weights contain non-finite values`);
  }
  return weights;
}

function buildMetaFeatureVector(example: Omit<MetaTrainingExample, 'hit'>): number[] {
  return [
    Number(example.confidence) || 0,
    Number(example.confirmation) || 0,
    Number(example.reality) || 0,
    (Number(example.replayHitRate) || 0) / 100,
    (Number(example.currentHitRate) || 0) / 100,
    Number(example.coverage) || 0,
    Number(example.bandit) || 0,
    Number(example.transfer) || 0,
    Number(example.stability) || 0,
    Number(example.falsePositivePenalty) || 0,
    Number(example.driftPenalty) || 0,
  ];
}

function buildCredibilityFeatureVector(example: Omit<CredibilityTrainingExample, 'actualCredibility'>): number[] {
  return [
    Number(example.corroboration) || 0,
    Number(example.historicalAccuracy) || 0,
    Number(example.posteriorAccuracy) || 0,
    Number(example.truthAgreement) || 0,
    Number(example.emReliability) || 0,
    Number(example.feedHealth) || 0,
    Number(example.inversePropaganda) || 0,
  ];
}

function emptyWeights(featureNames: readonly string[]): WeightVector {
  return {
    featureNames: [...featureNames],
    weights: Array.from({ length: featureNames.length }, () => 0),
    bias: 0,
  };
}

export function trainMetaWeights(ideaRuns: MetaTrainingExample[]): MetaWeights {
  if (ideaRuns.length === 0) {
    return emptyWeights(META_FEATURE_NAMES) as MetaWeights;
  }

  const features = ideaRuns.map(({ hit: _hit, ...example }) => buildMetaFeatureVector(example));
  const targets = ideaRuns.map((example) => (example.hit ? 1 : 0));
  const featureCount = META_FEATURE_NAMES.length;
  const sampleCount = ideaRuns.length;
  const weights = Array.from({ length: featureCount }, () => 0);
  let bias = 0;

  for (let iteration = 0; iteration < META_ITERATIONS; iteration += 1) {
    const gradient = Array.from({ length: featureCount }, () => 0);
    let biasGradient = 0;

    for (let sampleIndex = 0; sampleIndex < sampleCount; sampleIndex += 1) {
      const row = features[sampleIndex]!;
      const prediction = sigmoid(dotProduct(weights, row) + bias);
      if (!Number.isFinite(prediction)) {
        throw new Error('[weight-learner] meta training produced a non-finite prediction');
      }
      const error = prediction - targets[sampleIndex]!;
      biasGradient += error;
      for (let featureIndex = 0; featureIndex < featureCount; featureIndex += 1) {
        const gradientValue = gradient[featureIndex] || 0;
        gradient[featureIndex] = gradientValue + (error * (row[featureIndex] || 0));
      }
    }

    for (let featureIndex = 0; featureIndex < featureCount; featureIndex += 1) {
      const gradientValue = gradient[featureIndex] || 0;
      const weightValue = weights[featureIndex] || 0;
      const regularizedGradient = (gradientValue / sampleCount) + (META_L2_LAMBDA * weightValue);
      if (!Number.isFinite(regularizedGradient)) {
        throw new Error('[weight-learner] meta training produced a non-finite gradient');
      }
      weights[featureIndex] = weightValue - (META_LEARNING_RATE * regularizedGradient);
    }
    bias -= META_LEARNING_RATE * (biasGradient / sampleCount);
    if (!Number.isFinite(bias)) {
      throw new Error('[weight-learner] meta training produced a non-finite bias');
    }
  }

  return assertFiniteWeights({
    featureNames: [...META_FEATURE_NAMES],
    weights,
    bias,
  }, 'meta model') as MetaWeights;
}

export function trainCredibilityWeights(sourceProfiles: CredibilityTrainingExample[]): CredibilityWeights {
  if (sourceProfiles.length === 0) {
    return emptyWeights(CREDIBILITY_FEATURE_NAMES) as CredibilityWeights;
  }

  const designMatrix = sourceProfiles.map(({ actualCredibility: _target, ...example }) => [
    1,
    ...buildCredibilityFeatureVector(example),
  ]);
  const targetVector = sourceProfiles.map((example) => Number(example.actualCredibility) || 0);
  const xt = transpose(designMatrix);
  const xtx = multiplyMatrices(xt, designMatrix);
  const regularized = xtx.map((row, rowIndex) =>
    row.map((value, columnIndex) => {
      if (rowIndex === 0 && columnIndex === 0) return value;
      if (rowIndex === columnIndex) return value + CREDIBILITY_L2_LAMBDA;
      return value;
    }));
  const xty = multiplyMatrixVector(xt, targetVector);
  const coefficients = multiplyMatrixVector(invertMatrix(regularized), xty);

  return assertFiniteWeights({
    featureNames: [...CREDIBILITY_FEATURE_NAMES],
    bias: safeNumber(coefficients[0]),
    weights: coefficients.slice(1).map((entry) => safeNumber(entry)),
  }, 'credibility model') as CredibilityWeights;
}

export function predictHitProbability(
  model: MetaWeights,
  features: Omit<MetaTrainingExample, 'hit'>,
): number {
  return sigmoid(dotProduct(model.weights, buildMetaFeatureVector(features)) + model.bias);
}

export function predictCredibility(
  model: CredibilityWeights,
  features: Omit<CredibilityTrainingExample, 'actualCredibility'>,
): number {
  const value = dotProduct(model.weights, buildCredibilityFeatureVector(features)) + model.bias;
  return Number.isFinite(value) ? value : 0;
}

export function isWeightVector(value: unknown): value is WeightVector {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<WeightVector>;
  return Array.isArray(candidate.featureNames)
    && candidate.featureNames.every((entry) => typeof entry === 'string')
    && Array.isArray(candidate.weights)
    && candidate.weights.every((entry) => isFiniteNumber(entry))
    && isFiniteNumber(candidate.bias)
    && candidate.featureNames.length === candidate.weights.length;
}
