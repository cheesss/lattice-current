export type SymmetricMatrix = number[][];

export interface EigenDecompositionResult {
  eigenvalues: number[];
  eigenvectors: SymmetricMatrix;
  iterations: number;
  converged: boolean;
}

export interface MarcenkoPasturEstimate {
  sampleSize: number;
  dimension: number;
  aspectRatio: number;
  sigma2: number;
  lambdaMin: number;
  lambdaMax: number;
  signalEigenCount: number;
  noiseEigenCount: number;
}

export interface RmtConcentrationMetrics {
  totalEigenMass: number;
  dominantEigenShare: number;
  secondEigenShare: number;
  spectralGap: number;
  eigenHerfindahl: number;
  effectiveRank: number;
  participationRatio: number;
  averageAbsOffDiagonal: number;
  maxAbsOffDiagonal: number;
  rowCrowdingMean: number;
  rowCrowdingMax: number;
  crowdingPenalty: number;
}

export interface RmtDenoiseOptions {
  sampleSize: number;
  preserveDiagonal?: boolean;
  minEigenvalue?: number;
  noiseReplacement?: 'mean' | 'median' | 'threshold';
  maxIterations?: number;
  tolerance?: number;
}

export interface RmtDenoiseResult {
  originalMatrix: SymmetricMatrix;
  denoisedMatrix: SymmetricMatrix;
  eigenvalues: {
    original: number[];
    adjusted: number[];
    signal: number[];
    noise: number[];
    noiseReplacement: number;
  };
  mp: MarcenkoPasturEstimate;
  concentration: RmtConcentrationMetrics;
  summary: string[];
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function average(values: number[]): number {
  const finite = values.filter((value) => Number.isFinite(value));
  if (!finite.length) return 0;
  return finite.reduce((sum, value) => sum + value, 0) / finite.length;
}

function median(values: number[]): number {
  const finite = values.filter((value) => Number.isFinite(value)).slice().sort((a, b) => a - b);
  if (!finite.length) return 0;
  const middle = Math.floor(finite.length / 2);
  return finite.length % 2
    ? finite[middle]!
    : (finite[middle - 1]! + finite[middle]!) / 2;
}

function sum(values: number[]): number {
  return values.reduce((acc, value) => acc + value, 0);
}

function identityMatrix(size: number): SymmetricMatrix {
  return Array.from({ length: size }, (_, row) =>
    Array.from({ length: size }, (_, col) => (row === col ? 1 : 0)),
  );
}

function zeroMatrix(size: number): SymmetricMatrix {
  return Array.from({ length: size }, () => Array.from({ length: size }, () => 0));
}

function cloneMatrix(matrix: SymmetricMatrix): SymmetricMatrix {
  return matrix.map((row) => row.slice());
}

function isSquareMatrix(matrix: SymmetricMatrix): boolean {
  return matrix.length > 0 && matrix.every((row) => row.length === matrix.length);
}

function symmetrize(matrix: SymmetricMatrix): SymmetricMatrix {
  const size = matrix.length;
  const output = cloneMatrix(matrix);
  for (let row = 0; row < size; row += 1) {
    for (let col = row + 1; col < size; col += 1) {
      const value = ((output[row]?.[col] ?? 0) + (output[col]?.[row] ?? 0)) / 2;
      output[row]![col] = value;
      output[col]![row] = value;
    }
  }
  return output;
}

function matrixTrace(matrix: SymmetricMatrix): number {
  return matrix.reduce((acc, row, index) => acc + (row[index] ?? 0), 0);
}

function offDiagonalAbsoluteStats(matrix: SymmetricMatrix): {
  average: number;
  maximum: number;
  rowMeans: number[];
} {
  const size = matrix.length;
  const rowMeans: number[] = [];
  let total = 0;
  let count = 0;
  let maximum = 0;
  for (let row = 0; row < size; row += 1) {
    let rowTotal = 0;
    let rowCount = 0;
    for (let col = 0; col < size; col += 1) {
      if (row === col) continue;
      const value = Math.abs(matrix[row]?.[col] ?? 0);
      total += value;
      count += 1;
      rowTotal += value;
      rowCount += 1;
      if (value > maximum) maximum = value;
    }
    rowMeans.push(rowCount ? rowTotal / rowCount : 0);
  }
  return {
    average: count ? total / count : 0,
    maximum,
    rowMeans,
  };
}

function normalizeVector(vector: number[]): number[] {
  const norm = Math.sqrt(vector.reduce((acc, value) => acc + value * value, 0));
  if (!norm || !Number.isFinite(norm)) return vector.map(() => 0);
  return vector.map((value) => value / norm);
}

function getEigenvectorColumn(eigenvectors: SymmetricMatrix, index: number): number[] {
  return eigenvectors.map((row) => row[index] ?? 0);
}

function setEigenvectorColumn(eigenvectors: SymmetricMatrix, index: number, vector: number[]): void {
  for (let row = 0; row < eigenvectors.length; row += 1) {
    eigenvectors[row]![index] = vector[row] ?? 0;
  }
}

function sortEigenPairs(eigenvalues: number[], eigenvectors: SymmetricMatrix): void {
  const pairs = eigenvalues.map((value, index) => ({
    value,
    vector: getEigenvectorColumn(eigenvectors, index),
  })).sort((left, right) => right.value - left.value);

  for (let index = 0; index < pairs.length; index += 1) {
    eigenvalues[index] = pairs[index]!.value;
    setEigenvectorColumn(eigenvectors, index, pairs[index]!.vector);
  }
}

export function decomposeSymmetricMatrix(
  matrix: SymmetricMatrix,
  options: { tolerance?: number; maxIterations?: number } = {},
): EigenDecompositionResult {
  const size = matrix.length;
  if (!size) {
    return { eigenvalues: [], eigenvectors: [], iterations: 0, converged: true };
  }
  if (!isSquareMatrix(matrix)) {
    throw new Error('RMT decomposition requires a square matrix.');
  }

  const tolerance = clamp(options.tolerance ?? 1e-10, 1e-14, 1e-6);
  const maxIterations = Math.max(size * size * 12, options.maxIterations ?? size * size * 12);
  const a = symmetrize(matrix);
  const eigenvectors = identityMatrix(size);
  let converged = false;
  let iterations = 0;

  for (; iterations < maxIterations; iterations += 1) {
    let p = 0;
    let q = 1;
    let maxOffDiagonal = 0;
    for (let row = 0; row < size; row += 1) {
      for (let col = row + 1; col < size; col += 1) {
        const value = Math.abs(a[row]?.[col] ?? 0);
        if (value > maxOffDiagonal) {
          maxOffDiagonal = value;
          p = row;
          q = col;
        }
      }
    }
    if (maxOffDiagonal <= tolerance) {
      converged = true;
      break;
    }

    const app = a[p]![p] ?? 0;
    const aqq = a[q]![q] ?? 0;
    const apq = a[p]![q] ?? 0;
    if (Math.abs(apq) <= tolerance) {
      a[p]![q] = 0;
      a[q]![p] = 0;
      continue;
    }

    const tau = (aqq - app) / (2 * apq);
    const t = Math.sign(tau) / (Math.abs(tau) + Math.sqrt(1 + tau * tau));
    const c = 1 / Math.sqrt(1 + t * t);
    const s = t * c;

    for (let row = 0; row < size; row += 1) {
      if (row === p || row === q) continue;
      const arp = a[row]![p] ?? 0;
      const arq = a[row]![q] ?? 0;
      a[row]![p] = c * arp - s * arq;
      a[p]![row] = a[row]![p]!;
      a[row]![q] = c * arq + s * arp;
      a[q]![row] = a[row]![q]!;
    }

    const appNew = c * c * app - 2 * s * c * apq + s * s * aqq;
    const aqqNew = s * s * app + 2 * s * c * apq + c * c * aqq;
    a[p]![p] = appNew;
    a[q]![q] = aqqNew;
    a[p]![q] = 0;
    a[q]![p] = 0;

    for (let row = 0; row < size; row += 1) {
      const vrp = eigenvectors[row]![p] ?? 0;
      const vrq = eigenvectors[row]![q] ?? 0;
      eigenvectors[row]![p] = c * vrp - s * vrq;
      eigenvectors[row]![q] = s * vrp + c * vrq;
    }
  }

  const eigenvalues = Array.from({ length: size }, (_, index) => a[index]![index] ?? 0);
  sortEigenPairs(eigenvalues, eigenvectors);

  for (let index = 0; index < eigenvalues.length; index += 1) {
    if (!Number.isFinite(eigenvalues[index] ?? 0)) eigenvalues[index] = 0;
    const normalized = normalizeVector(getEigenvectorColumn(eigenvectors, index));
    setEigenvectorColumn(eigenvectors, index, normalized);
  }

  return {
    eigenvalues,
    eigenvectors,
    iterations,
    converged,
  };
}

export function estimateMarcenkoPasturCutoff(
  matrix: SymmetricMatrix,
  sampleSize: number,
  eigenvalues?: number[],
): MarcenkoPasturEstimate {
  const size = matrix.length;
  const spectrum = (eigenvalues && eigenvalues.length ? eigenvalues : decomposeSymmetricMatrix(matrix).eigenvalues)
    .filter((value) => Number.isFinite(value));
  const dimension = Math.max(1, size);
  const safeSampleSize = Math.max(1, Math.round(sampleSize));
  const aspectRatio = safeSampleSize / dimension;
  const sigma2 = Math.max(1e-8, average(spectrum.length ? spectrum : [matrixTrace(matrix) / dimension]));
  const invSqrt = Math.sqrt(1 / Math.max(aspectRatio, 1e-8));
  const lambdaMin = Math.max(0, sigma2 * Math.pow(1 - invSqrt, 2));
  const lambdaMax = sigma2 * Math.pow(1 + invSqrt, 2);
  const signalEigenCount = spectrum.filter((value) => value > lambdaMax).length;
  const noiseEigenCount = spectrum.length - signalEigenCount;

  return {
    sampleSize: safeSampleSize,
    dimension,
    aspectRatio: Number(aspectRatio.toFixed(6)),
    sigma2: Number(sigma2.toFixed(6)),
    lambdaMin: Number(lambdaMin.toFixed(6)),
    lambdaMax: Number(lambdaMax.toFixed(6)),
    signalEigenCount,
    noiseEigenCount,
  };
}

export function summarizeRmtMatrix(
  matrix: SymmetricMatrix,
  sampleSize: number,
): {
  eigenvalues: number[];
  mp: MarcenkoPasturEstimate;
  concentration: RmtConcentrationMetrics;
} {
  const decomposition = decomposeSymmetricMatrix(matrix);
  const mp = estimateMarcenkoPasturCutoff(matrix, sampleSize, decomposition.eigenvalues);
  const concentration = buildConcentrationMetrics(matrix, decomposition.eigenvalues);
  return {
    eigenvalues: decomposition.eigenvalues,
    mp,
    concentration,
  };
}

export function denoiseSymmetricMatrix(
  matrix: SymmetricMatrix,
  options: RmtDenoiseOptions,
): RmtDenoiseResult {
  if (!isSquareMatrix(matrix)) {
    throw new Error('RMT denoising requires a square matrix.');
  }

  const decomposition = decomposeSymmetricMatrix(matrix, {
    tolerance: options.tolerance,
    maxIterations: options.maxIterations,
  });
  const mp = estimateMarcenkoPasturCutoff(matrix, options.sampleSize, decomposition.eigenvalues);
  const signalThreshold = mp.lambdaMax;
  const minEigenvalue = Math.max(0, options.minEigenvalue ?? 1e-8);
  const signal: number[] = [];
  const noise: number[] = [];
  for (const eigenvalue of decomposition.eigenvalues) {
    if (eigenvalue > signalThreshold) signal.push(eigenvalue);
    else noise.push(eigenvalue);
  }

  const noiseReplacement = (() => {
    const strategy = options.noiseReplacement ?? 'mean';
    if (!noise.length) return signal.length ? average(signal) : signalThreshold;
    if (strategy === 'median') return median(noise);
    if (strategy === 'threshold') return signalThreshold;
    return average(noise);
  })();

  const adjustedEigenvalues = decomposition.eigenvalues.map((value) => {
    if (value > signalThreshold) return Math.max(value, minEigenvalue);
    return Math.max(noiseReplacement, minEigenvalue);
  });

  const reconstructed = zeroMatrix(matrix.length);
  for (let eigenIndex = 0; eigenIndex < adjustedEigenvalues.length; eigenIndex += 1) {
    const eigenvalue = adjustedEigenvalues[eigenIndex] ?? 0;
    const vector = getEigenvectorColumn(decomposition.eigenvectors, eigenIndex);
    for (let row = 0; row < reconstructed.length; row += 1) {
      const rowVector = reconstructed[row];
      if (!rowVector) continue;
      for (let col = 0; col < reconstructed.length; col += 1) {
        rowVector[col] = (rowVector[col] ?? 0) + eigenvalue * (vector[row] ?? 0) * (vector[col] ?? 0);
      }
    }
  }

  let denoisedMatrix = symmetrize(reconstructed);
  if (options.preserveDiagonal) {
    for (let index = 0; index < denoisedMatrix.length; index += 1) {
      const row = denoisedMatrix[index];
      if (!row) continue;
      row[index] = matrix[index]?.[index] ?? row[index] ?? 0;
    }
  }

  const concentration = buildConcentrationMetrics(denoisedMatrix, adjustedEigenvalues);
  const summary = [
    `dimension=${matrix.length}`,
    `sampleSize=${mp.sampleSize}`,
    `lambdaMax=${mp.lambdaMax}`,
    `signalEigenCount=${mp.signalEigenCount}`,
    `noiseEigenCount=${mp.noiseEigenCount}`,
    `dominantEigenShare=${concentration.dominantEigenShare}`,
    `crowdingPenalty=${concentration.crowdingPenalty}`,
  ];

  return {
    originalMatrix: cloneMatrix(matrix),
    denoisedMatrix,
    eigenvalues: {
      original: decomposition.eigenvalues.slice(),
      adjusted: adjustedEigenvalues.slice(),
      signal,
      noise,
      noiseReplacement: Number(noiseReplacement.toFixed(6)),
    },
    mp,
    concentration,
    summary,
  };
}

export function denoiseCorrelationMatrix(
  matrix: SymmetricMatrix,
  options: Partial<Omit<RmtDenoiseOptions, 'preserveDiagonal'>> & { preserveDiagonal?: boolean } = {},
): RmtDenoiseResult {
  const sampleSize = Math.max(1, Math.round(options.sampleSize ?? matrix.length));
  const result = denoiseSymmetricMatrix(matrix, {
    ...options,
    sampleSize,
    preserveDiagonal: options.preserveDiagonal ?? true,
  });
  const normalizedMatrix = normalizeToCorrelation(result.denoisedMatrix);
  const normalizedSpectrum = decomposeSymmetricMatrix(normalizedMatrix).eigenvalues;
  const normalizedMp = estimateMarcenkoPasturCutoff(normalizedMatrix, sampleSize, normalizedSpectrum);
  const normalizedConcentration = buildConcentrationMetrics(normalizedMatrix, normalizedSpectrum);
  return {
    ...result,
    denoisedMatrix: normalizedMatrix,
    mp: normalizedMp,
    concentration: normalizedConcentration,
    eigenvalues: {
      ...result.eigenvalues,
      adjusted: normalizedSpectrum,
    },
    summary: [
      `dimension=${normalizedMatrix.length}`,
      `sampleSize=${normalizedMp.sampleSize}`,
      `lambdaMax=${normalizedMp.lambdaMax}`,
      `signalEigenCount=${normalizedMp.signalEigenCount}`,
      `noiseEigenCount=${normalizedMp.noiseEigenCount}`,
      `dominantEigenShare=${normalizedConcentration.dominantEigenShare}`,
      `crowdingPenalty=${normalizedConcentration.crowdingPenalty}`,
    ],
  };
}

export function denoiseCovarianceMatrix(
  matrix: SymmetricMatrix,
  options: Partial<Omit<RmtDenoiseOptions, 'preserveDiagonal'>> & { preserveDiagonal?: boolean } = {},
): RmtDenoiseResult {
  const sampleSize = Math.max(1, Math.round(options.sampleSize ?? matrix.length));
  return denoiseSymmetricMatrix(matrix, {
    ...options,
    sampleSize,
    preserveDiagonal: options.preserveDiagonal ?? false,
  });
}

export function normalizeToCorrelation(matrix: SymmetricMatrix): SymmetricMatrix {
  if (!isSquareMatrix(matrix)) {
    throw new Error('Correlation normalization requires a square matrix.');
  }
  const size = matrix.length;
  const output = zeroMatrix(size);
  const stdDev = Array.from({ length: size }, (_, index) => {
    const variance = Math.max(0, matrix[index]?.[index] ?? 0);
    return Math.sqrt(Math.max(variance, 1e-12));
  });

  for (let row = 0; row < size; row += 1) {
    for (let col = 0; col < size; col += 1) {
      if (row === col) {
        output[row]![col] = 1;
        continue;
      }
      const denom = stdDev[row]! * stdDev[col]!;
      output[row]![col] = denom > 0 ? (matrix[row]?.[col] ?? 0) / denom : 0;
    }
  }

  return symmetrize(output);
}

function buildConcentrationMetrics(
  matrix: SymmetricMatrix,
  eigenvalues: number[],
): RmtConcentrationMetrics {
  const spectrum = eigenvalues.filter((value) => Number.isFinite(value));
  const positiveSpectrum = spectrum.map((value) => Math.max(0, value));
  const totalEigenMass = Math.max(1e-12, sum(positiveSpectrum));
  const normalized = positiveSpectrum.map((value) => value / totalEigenMass);
  const dominantEigenShare = normalized[0] ?? 0;
  const secondEigenShare = normalized[1] ?? 0;
  const spectralGap = Math.max(0, (positiveSpectrum[0] ?? 0) - (positiveSpectrum[1] ?? 0));
  const eigenHerfindahl = normalized.reduce((acc, value) => acc + value * value, 0);
  const entropy = normalized.reduce((acc, value) => (value > 0 ? acc - value * Math.log(value) : acc), 0);
  const effectiveRank = Math.exp(entropy);
  const participationRatio = eigenHerfindahl > 0 ? 1 / eigenHerfindahl : 0;
  const { average: offDiagonalMean, maximum, rowMeans } = offDiagonalAbsoluteStats(matrix);
  const rowCrowdingMean = average(rowMeans);
  const rowCrowdingMax = rowMeans.length ? Math.max(...rowMeans) : 0;
  const crowdingPenalty = clamp(
    0.25 * dominantEigenShare
      + 0.25 * eigenHerfindahl
      + 0.25 * clamp(offDiagonalMean, 0, 1)
      + 0.25 * clamp(rowCrowdingMean, 0, 1),
    0,
    1,
  );

  return {
    totalEigenMass: Number(totalEigenMass.toFixed(6)),
    dominantEigenShare: Number(dominantEigenShare.toFixed(6)),
    secondEigenShare: Number(secondEigenShare.toFixed(6)),
    spectralGap: Number(spectralGap.toFixed(6)),
    eigenHerfindahl: Number(eigenHerfindahl.toFixed(6)),
    effectiveRank: Number(effectiveRank.toFixed(6)),
    participationRatio: Number(participationRatio.toFixed(6)),
    averageAbsOffDiagonal: Number(offDiagonalMean.toFixed(6)),
    maxAbsOffDiagonal: Number(maximum.toFixed(6)),
    rowCrowdingMean: Number(rowCrowdingMean.toFixed(6)),
    rowCrowdingMax: Number(rowCrowdingMax.toFixed(6)),
    crowdingPenalty: Number(crowdingPenalty.toFixed(6)),
  };
}

export function summarizeCorrelationMatrix(
  matrix: SymmetricMatrix,
  sampleSize: number,
): RmtDenoiseResult {
  return denoiseCorrelationMatrix(matrix, { sampleSize });
}
