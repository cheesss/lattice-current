/**
 * cpcv.ts — Combinatorial Purged Cross-Validation & PBO.
 *
 * Implements Marcos López de Prado's CPCV framework for detecting
 * backtest overfitting. Also includes a permutation test.
 */

export interface CPCVResult {
  pbo: number;              // Probability of Backtest Overfitting [0,1]
  oosRankMedian: number;    // Median OOS rank across path combinations
  logitPBO: number;         // logit(PBO) for significance assessment
  pathCount: number;
  isReturnPaths: number[];  // IS returns for each path
  oosReturnPaths: number[]; // OOS returns for each path
}

export interface PermutationTestResult {
  observedSharpe: number;
  permutedSharpesMean: number;
  permutedSharpesStd: number;
  pValue: number;
  nPermutations: number;
}

/**
 * Compute CPCV (Combinatorial Purged Cross-Validation) metrics.
 *
 * @param foldReturns Array of daily return arrays, one per fold.
 * @param purgeGapDays Number of days to purge between IS and OOS (embargo).
 */
export function computeCPCV(
  foldReturns: number[][],
  purgeGapDays: number = 5,
): CPCVResult {
  const nFolds = foldReturns.length;
  if (nFolds < 3) {
    return { pbo: 0.5, oosRankMedian: 0.5, logitPBO: 0, pathCount: 0, isReturnPaths: [], oosReturnPaths: [] };
  }

  // Generate all C(N, N/2) combinations for IS/OOS split
  const half = Math.floor(nFolds / 2);
  const combinations = generateCombinations(nFolds, half);

  const isReturnPaths: number[] = [];
  const oosReturnPaths: number[] = [];
  const oosRanks: number[] = [];

  for (const isFolds of combinations) {
    const oosSet = new Set<number>();
    for (let i = 0; i < nFolds; i++) {
      if (!isFolds.includes(i)) oosSet.add(i);
    }
    const oosFolds = Array.from(oosSet);

    // Compute IS return (concatenate IS fold returns, skip purge gap)
    const isReturns = computePathReturn(foldReturns, isFolds, purgeGapDays);
    const oosReturns = computePathReturn(foldReturns, oosFolds, purgeGapDays);

    isReturnPaths.push(isReturns);
    oosReturnPaths.push(oosReturns);

    // Rank: what fraction of OOS paths have lower return than this one
    // Will compute after all paths
  }

  // Compute OOS ranks: for each combination, rank its OOS return among all OOS returns
  const sortedOOS = [...oosReturnPaths].sort((a, b) => a - b);
  for (const oosRet of oosReturnPaths) {
    const rank = binarySearchRank(sortedOOS, oosRet) / sortedOOS.length;
    oosRanks.push(rank);
  }

  // PBO = fraction of paths where IS-optimal selection yields below-median OOS
  // For each combination, check: if IS selects this path (IS is above median),
  // does OOS also perform well?
  const isMedian = median(isReturnPaths);
  const oosMedian = median(oosReturnPaths);
  let overfitCount = 0;
  let isAboveMedianCount = 0;

  for (let i = 0; i < isReturnPaths.length; i++) {
    if ((isReturnPaths[i] ?? 0) >= isMedian) {
      isAboveMedianCount++;
      if ((oosReturnPaths[i] ?? 0) < oosMedian) {
        overfitCount++;
      }
    }
  }

  const pbo = isAboveMedianCount > 0 ? overfitCount / isAboveMedianCount : 0.5;
  const oosRankMedian = median(oosRanks);
  const logitPBO = pbo > 0.001 && pbo < 0.999
    ? Math.log(pbo / (1 - pbo))
    : pbo <= 0.001 ? -7 : 7;

  return {
    pbo,
    oosRankMedian,
    logitPBO,
    pathCount: combinations.length,
    isReturnPaths,
    oosReturnPaths,
  };
}

/**
 * Run a permutation test to assess if the observed Sharpe is due to skill or luck.
 *
 * @param returns Daily returns from the strategy.
 * @param nPermutations Number of permutations to run.
 */
export function permutationTest(
  returns: number[],
  nPermutations: number = 500,
): PermutationTestResult {
  const observedSharpe = computeSharpe(returns);
  const permutedSharpes: number[] = [];

  for (let p = 0; p < nPermutations; p++) {
    // Shuffle returns (break temporal structure)
    const shuffled = [...returns];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const tmp = shuffled[i]!;
      shuffled[i] = shuffled[j]!;
      shuffled[j] = tmp;
    }
    permutedSharpes.push(computeSharpe(shuffled));
  }

  const permMean = mean(permutedSharpes);
  const permStd = std(permutedSharpes);
  const pValue = permutedSharpes.filter(s => s >= observedSharpe).length / nPermutations;

  return {
    observedSharpe,
    permutedSharpesMean: permMean,
    permutedSharpesStd: permStd,
    pValue,
    nPermutations,
  };
}

// ── Helpers ────────────────────────────────────────────────

function generateCombinations(n: number, k: number): number[][] {
  const result: number[][] = [];
  const maxCombinations = 100; // cap for performance

  function backtrack(start: number, current: number[]) {
    if (result.length >= maxCombinations) return;
    if (current.length === k) {
      result.push([...current]);
      return;
    }
    for (let i = start; i < n; i++) {
      current.push(i);
      backtrack(i + 1, current);
      current.pop();
    }
  }
  backtrack(0, []);
  return result;
}

function computePathReturn(
  foldReturns: number[][],
  foldIndices: number[],
  purgeGap: number,
): number {
  const allReturns: number[] = [];
  for (const idx of foldIndices) {
    const returns = foldReturns[idx];
    if (!returns) continue;
    // Skip first purgeGap returns as embargo
    const start = Math.min(purgeGap, returns.length);
    for (let i = start; i < returns.length; i++) {
      allReturns.push(returns[i] ?? 0);
    }
  }
  if (allReturns.length === 0) return 0;
  // Cumulative return
  let cumReturn = 1;
  for (const r of allReturns) {
    cumReturn *= (1 + r / 100);
  }
  return (cumReturn - 1) * 100;
}

function computeSharpe(returns: number[]): number {
  if (returns.length < 2) return 0;
  const m = mean(returns);
  const s = std(returns);
  return s > 1e-10 ? (m / s) * Math.sqrt(252) : 0;
}

function mean(arr: number[]): number {
  if (arr.length === 0) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function std(arr: number[]): number {
  const m = mean(arr);
  return Math.sqrt(arr.reduce((s, x) => s + (x - m) ** 2, 0) / Math.max(1, arr.length - 1));
}

function median(arr: number[]): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2
    : sorted[mid] ?? 0;
}

function binarySearchRank(sorted: number[], value: number): number {
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if ((sorted[mid] ?? 0) < value) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}
