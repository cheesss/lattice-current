export interface BanditArmState {
  id: string;
  dimension: number;
  matrixA: number[][];
  vectorB: number[];
  pulls: number;
  totalReward: number;
  lastUpdatedAt: string;
}

export interface BanditScore {
  score: number;
  mean: number;
  uncertainty: number;
  sample: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function identityMatrix(size: number): number[][] {
  return Array.from({ length: size }, (_, row) =>
    Array.from({ length: size }, (_, col) => (row === col ? 1 : 0)),
  );
}

function multiplyMatrixVector(matrix: number[][], vector: number[]): number[] {
  return matrix.map((row) => row.reduce((sum, value, index) => sum + value * (vector[index] ?? 0), 0));
}

function dot(left: number[], right: number[]): number {
  return left.reduce((sum, value, index) => sum + value * (right[index] ?? 0), 0);
}

function invertMatrix(matrix: number[][]): number[][] {
  const n = matrix.length;
  const augmented = matrix.map((row, index) => [
    ...row.map((value) => Number(value)),
    ...identityMatrix(n)[index]!,
  ]);

  for (let col = 0; col < n; col += 1) {
    let pivot = col;
    for (let row = col + 1; row < n; row += 1) {
      if (Math.abs(augmented[row]![col]!) > Math.abs(augmented[pivot]![col]!)) pivot = row;
    }
    if (Math.abs(augmented[pivot]![col]!) < 1e-10) {
      augmented[pivot]![col] = (augmented[pivot]![col] || 0) + 1e-6;
    }
    if (pivot !== col) {
      const temp = augmented[col]!;
      augmented[col] = augmented[pivot]!;
      augmented[pivot] = temp;
    }

    const divisor = augmented[col]![col] || 1e-6;
    for (let j = 0; j < 2 * n; j += 1) {
      augmented[col]![j] = augmented[col]![j]! / divisor;
    }
    for (let row = 0; row < n; row += 1) {
      if (row === col) continue;
      const factor = augmented[row]![col] || 0;
      for (let j = 0; j < 2 * n; j += 1) {
        augmented[row]![j] = augmented[row]![j]! - factor * augmented[col]![j]!;
      }
    }
  }

  return augmented.map((row) => row.slice(n));
}

export function createBanditArmState(id: string, dimension: number): BanditArmState {
  const safeDimension = Math.max(2, Math.min(16, Math.round(dimension)));
  return {
    id,
    dimension: safeDimension,
    matrixA: identityMatrix(safeDimension),
    vectorB: Array.from({ length: safeDimension }, () => 0),
    pulls: 0,
    totalReward: 0,
    lastUpdatedAt: new Date().toISOString(),
  };
}

export function scoreBanditArm(
  state: BanditArmState | null | undefined,
  context: number[],
  alpha = 0.7,
): BanditScore {
  const fallback = createBanditArmState('adhoc', context.length);
  const arm = state && state.dimension === context.length ? state : fallback;
  const invA = invertMatrix(arm.matrixA);
  const theta = multiplyMatrixVector(invA, arm.vectorB);
  const mean = dot(theta, context);
  const varianceVector = multiplyMatrixVector(invA, context);
  const variance = Math.max(1e-6, dot(context, varianceVector));
  const uncertainty = Math.sqrt(variance);
  const explorationScale = clamp(alpha, 0.05, 3);
  const jitter = Math.sqrt(-2 * Math.log(Math.max(Number.EPSILON, Math.random()))) * Math.cos(2 * Math.PI * Math.random());
  const sample = mean + jitter * uncertainty * explorationScale;
  return {
    mean: Number(mean.toFixed(6)),
    uncertainty: Number(uncertainty.toFixed(6)),
    sample: Number(sample.toFixed(6)),
    score: Number(sample.toFixed(6)),
  };
}

export function updateBanditArm(
  state: BanditArmState | null | undefined,
  context: number[],
  reward: number,
): BanditArmState {
  const arm = state && state.dimension === context.length
    ? {
      ...state,
      matrixA: state.matrixA.map((row) => row.slice()),
      vectorB: state.vectorB.slice(),
    }
    : createBanditArmState((state?.id || 'arm'), context.length);

  for (let row = 0; row < arm.dimension; row += 1) {
    const matrixRow = arm.matrixA[row] ?? (arm.matrixA[row] = Array.from({ length: arm.dimension }, () => 0));
    for (let col = 0; col < arm.dimension; col += 1) {
      matrixRow[col] = (matrixRow[col] ?? 0) + (context[row] ?? 0) * (context[col] ?? 0);
    }
    arm.vectorB[row]! += (context[row] ?? 0) * reward;
  }

  arm.pulls += 1;
  arm.totalReward = Number((arm.totalReward + reward).toFixed(6));
  arm.lastUpdatedAt = new Date().toISOString();
  return arm;
}
