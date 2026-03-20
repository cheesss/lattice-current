function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function finiteValues(series: number[]): number[] {
  return series.filter((value) => typeof value === 'number' && Number.isFinite(value));
}

function quantile(sorted: number[], fraction: number): number {
  if (!sorted.length) return 0;
  if (sorted.length === 1) return sorted[0] ?? 0;
  const position = clamp(fraction, 0, 1) * (sorted.length - 1);
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower] ?? 0;
  const weight = position - lower;
  const lowerValue = sorted[lower] ?? 0;
  const upperValue = sorted[upper] ?? lowerValue;
  return lowerValue * (1 - weight) + upperValue * weight;
}

export function discretizeNumericSeries(series: number[], bucketCount = 7): number[] {
  if (!series.length) return [];
  const values = finiteValues(series);
  if (!values.length) return series.map(() => 0);

  const uniqueCount = new Set(values.map((value) => Number(value.toFixed(6)))).size;
  if (uniqueCount <= Math.min(bucketCount, 4)) {
    return series.map((value) => {
      if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
      return Math.round(value * 100);
    });
  }

  const sorted = values.slice().sort((a, b) => a - b);
  const thresholds: number[] = [];
  for (let index = 1; index < bucketCount; index += 1) {
    thresholds.push(quantile(sorted, index / bucketCount));
  }
  const midpoint = Math.floor(thresholds.length / 2);

  return series.map((value) => {
    if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
    let bucket = 0;
    while (bucket < thresholds.length && value > thresholds[bucket]!) bucket += 1;
    return bucket - midpoint;
  });
}

function countsFromSeries(series: number[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const value of series) {
    const key = String(value);
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return counts;
}

export function entropyFromCounts(counts: Map<string, number>): number {
  const total = Array.from(counts.values()).reduce((sum, value) => sum + value, 0);
  if (total <= 0) return 0;
  let entropy = 0;
  for (const count of counts.values()) {
    if (count <= 0) continue;
    const probability = count / total;
    entropy -= probability * Math.log2(probability);
  }
  return entropy;
}

export interface MutualInformationSummary {
  mutualInformation: number;
  normalized: number;
  sampleSize: number;
  leftEntropy: number;
  rightEntropy: number;
  jointEntropy: number;
}

export function estimateNormalizedMutualInformation(
  leftSeries: number[],
  rightSeries: number[],
): MutualInformationSummary {
  const samples = Math.min(leftSeries.length, rightSeries.length);
  if (samples < 2) {
    return {
      mutualInformation: 0,
      normalized: 0,
      sampleSize: samples,
      leftEntropy: 0,
      rightEntropy: 0,
      jointEntropy: 0,
    };
  }

  const left = discretizeNumericSeries(leftSeries.slice(0, samples));
  const right = discretizeNumericSeries(rightSeries.slice(0, samples));
  const leftCounts = countsFromSeries(left);
  const rightCounts = countsFromSeries(right);
  const jointCounts = new Map<string, number>();

  for (let index = 0; index < samples; index += 1) {
    const leftValue = left[index] ?? 0;
    const rightValue = right[index] ?? 0;
    const key = `${leftValue}|${rightValue}`;
    jointCounts.set(key, (jointCounts.get(key) || 0) + 1);
  }

  const leftEntropy = entropyFromCounts(leftCounts);
  const rightEntropy = entropyFromCounts(rightCounts);
  const jointEntropy = entropyFromCounts(jointCounts);
  const mutualInformation = Math.max(0, leftEntropy + rightEntropy - jointEntropy);
  const denominator = leftEntropy + rightEntropy;
  const normalized = denominator > 0 ? clamp((2 * mutualInformation) / denominator, 0, 1) : 0;

  return {
    mutualInformation: Number(mutualInformation.toFixed(6)),
    normalized: Number(normalized.toFixed(4)),
    sampleSize: samples,
    leftEntropy: Number(leftEntropy.toFixed(4)),
    rightEntropy: Number(rightEntropy.toFixed(4)),
    jointEntropy: Number(jointEntropy.toFixed(4)),
  };
}

export interface LaggedMutualInformationSummary extends MutualInformationSummary {
  lag: number;
  supportScore: number;
}

function sliceByLag(leftSeries: number[], rightSeries: number[], lag: number): { left: number[]; right: number[] } {
  const samples = Math.min(leftSeries.length, rightSeries.length);
  if (samples < 2) {
    return { left: [], right: [] };
  }

  if (lag === 0) {
    return {
      left: leftSeries.slice(0, samples),
      right: rightSeries.slice(0, samples),
    };
  }

  if (lag > 0) {
    return {
      left: leftSeries.slice(0, Math.max(0, samples - lag)),
      right: rightSeries.slice(lag, samples),
    };
  }

  const offset = Math.abs(lag);
  return {
    left: leftSeries.slice(offset, samples),
    right: rightSeries.slice(0, Math.max(0, samples - offset)),
  };
}

export function estimateLaggedNormalizedMutualInformation(
  leftSeries: number[],
  rightSeries: number[],
  options: { maxLag?: number } = {},
): LaggedMutualInformationSummary {
  const maxLag = Math.max(0, Math.min(8, Math.round(options.maxLag ?? 4)));
  let best: LaggedMutualInformationSummary = {
    lag: 0,
    mutualInformation: 0,
    normalized: 0,
    sampleSize: 0,
    leftEntropy: 0,
    rightEntropy: 0,
    jointEntropy: 0,
    supportScore: 0,
  };

  for (let lag = -maxLag; lag <= maxLag; lag += 1) {
    const aligned = sliceByLag(leftSeries, rightSeries, lag);
    const summary = estimateNormalizedMutualInformation(aligned.left, aligned.right);
    if (summary.sampleSize < 2) continue;
    const supportWeight = clamp(1 - Math.abs(lag) / (maxLag + 1), 0.2, 1);
    const supportScore = Number((summary.normalized * supportWeight).toFixed(4));
    const candidate: LaggedMutualInformationSummary = {
      ...summary,
      lag,
      supportScore,
    };
    const candidateScore = candidate.supportScore * 100 + candidate.normalized * 12 + candidate.sampleSize * 0.01;
    const bestScore = best.supportScore * 100 + best.normalized * 12 + best.sampleSize * 0.01;
    if (candidateScore > bestScore) {
      best = candidate;
    }
  }

  return best;
}
