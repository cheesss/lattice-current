/**
 * Statistical Utilities for Evaluation — Phase 0
 *
 * Provides Welch's t-test, Sharpe ratio, Calmar ratio,
 * profit factor, and other metrics used in strategy comparison.
 */

// ---------------------------------------------------------------------------
// Basic Descriptive Stats
// ---------------------------------------------------------------------------

export function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((s, v) => s + v, 0) / values.length;
}

export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = values.slice().sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2
    : (sorted[mid] ?? 0);
}

export function stddev(values: number[]): number {
  if (values.length < 2) return 0;
  const m = mean(values);
  const variance = values.reduce((s, v) => s + (v - m) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

// ---------------------------------------------------------------------------
// Compounded Return
// ---------------------------------------------------------------------------

export function compoundedReturn(returns: number[]): number {
  if (returns.length === 0) return 0;
  let equity = 1;
  for (const r of returns) {
    equity *= 1 + r / 100;
  }
  return (equity - 1) * 100;
}

// ---------------------------------------------------------------------------
// Max Drawdown from a return series
// ---------------------------------------------------------------------------

export function maxDrawdown(returns: number[]): number {
  if (returns.length === 0) return 0;
  let equity = 1;
  let peak = 1;
  let maxDd = 0;
  for (const r of returns) {
    equity *= 1 + r / 100;
    if (equity > peak) peak = equity;
    const dd = (peak - equity) / peak;
    if (dd > maxDd) maxDd = dd;
  }
  return maxDd * 100; // as percent
}

// ---------------------------------------------------------------------------
// Sharpe Ratio (annualised, assuming hourly returns → ~8760 periods/year)
// ---------------------------------------------------------------------------

export function sharpeRatio(
  returns: number[],
  periodsPerYear = 252, // daily frames
  riskFreeRate = 0,
): number {
  if (returns.length < 2) return 0;
  const m = mean(returns) - riskFreeRate;
  const s = stddev(returns);
  if (s === 0) return 0;
  return (m / s) * Math.sqrt(periodsPerYear);
}

// ---------------------------------------------------------------------------
// Calmar Ratio = annualised return / max drawdown
// ---------------------------------------------------------------------------

export function calmarRatio(totalReturn: number, maxDrawdownPct: number): number {
  if (maxDrawdownPct === 0) return totalReturn > 0 ? Infinity : 0;
  return totalReturn / maxDrawdownPct;
}

// ---------------------------------------------------------------------------
// Profit Factor = gross profit / gross loss
// ---------------------------------------------------------------------------

export function profitFactor(returns: number[]): number {
  let grossProfit = 0;
  let grossLoss = 0;
  for (const r of returns) {
    if (r > 0) grossProfit += r;
    else grossLoss += Math.abs(r);
  }
  if (grossLoss === 0) return grossProfit > 0 ? Infinity : 0;
  return grossProfit / grossLoss;
}

// ---------------------------------------------------------------------------
// Welch's t-test (two-sample, unequal variance)
// ---------------------------------------------------------------------------

export interface TTestResult {
  tStatistic: number;
  degreesOfFreedom: number;
  pValue: number;
}

/**
 * Approximation of the Student-t CDF using the regularised incomplete beta function.
 * Accurate to ~4 decimal places for practical df ranges.
 */
function studentTCdf(t: number, df: number): number {
  const x = df / (df + t * t);
  const a = df / 2;
  const b = 0.5;
  // Regularised incomplete beta via continued fraction (Lentz)
  const betaInc = regularisedIncompleteBeta(x, a, b);
  return t >= 0 ? 1 - 0.5 * betaInc : 0.5 * betaInc;
}

function regularisedIncompleteBeta(x: number, a: number, b: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;

  const lnBeta = lnGamma(a) + lnGamma(b) - lnGamma(a + b);
  const front = Math.exp(Math.log(x) * a + Math.log(1 - x) * b - lnBeta) / a;

  // Lentz's continued fraction
  let f = 1;
  let c = 1;
  let d = 1 - ((a + b) * x) / (a + 1);
  if (Math.abs(d) < 1e-30) d = 1e-30;
  d = 1 / d;
  f = d;

  for (let m = 1; m <= 200; m++) {
    // even step
    let numerator = (m * (b - m) * x) / ((a + 2 * m - 1) * (a + 2 * m));
    d = 1 + numerator * d;
    if (Math.abs(d) < 1e-30) d = 1e-30;
    d = 1 / d;
    c = 1 + numerator / c;
    if (Math.abs(c) < 1e-30) c = 1e-30;
    f *= c * d;

    // odd step
    numerator = -((a + m) * (a + b + m) * x) / ((a + 2 * m) * (a + 2 * m + 1));
    d = 1 + numerator * d;
    if (Math.abs(d) < 1e-30) d = 1e-30;
    d = 1 / d;
    c = 1 + numerator / c;
    if (Math.abs(c) < 1e-30) c = 1e-30;
    const delta = c * d;
    f *= delta;

    if (Math.abs(delta - 1) < 1e-10) break;
  }

  return front * f;
}

function lnGamma(z: number): number {
  // Lanczos approximation (g=7, n=9)
  const g = 7;
  const coeff = [
    0.99999999999980993, 676.5203681218851, -1259.1392167224028,
    771.32342877765313, -176.61502916214059, 12.507343278686905,
    -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
  ];
  if (z < 0.5) {
    return Math.log(Math.PI / Math.sin(Math.PI * z)) - lnGamma(1 - z);
  }
  z -= 1;
  let x = coeff[0] ?? 0;
  for (let i = 1; i < g + 2; i++) {
    x += (coeff[i] ?? 0) / (z + i);
  }
  const t = z + g + 0.5;
  return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(x);
}

export function welchTTest(a: number[], b: number[]): TTestResult {
  if (a.length < 2 || b.length < 2) {
    return { tStatistic: 0, degreesOfFreedom: 0, pValue: 1 };
  }

  const meanA = mean(a);
  const meanB = mean(b);
  const varA = a.reduce((s, v) => s + (v - meanA) ** 2, 0) / (a.length - 1);
  const varB = b.reduce((s, v) => s + (v - meanB) ** 2, 0) / (b.length - 1);

  const seA = varA / a.length;
  const seB = varB / b.length;
  const seDiff = Math.sqrt(seA + seB);

  if (seDiff === 0) {
    return { tStatistic: 0, degreesOfFreedom: a.length + b.length - 2, pValue: 1 };
  }

  const t = (meanA - meanB) / seDiff;

  // Welch-Satterthwaite degrees of freedom
  const df = (seA + seB) ** 2 / (seA ** 2 / (a.length - 1) + seB ** 2 / (b.length - 1));

  // Two-tailed p-value
  const cdf = studentTCdf(Math.abs(t), df);
  const pValue = 2 * (1 - cdf);

  return { tStatistic: t, degreesOfFreedom: df, pValue: Math.max(0, Math.min(1, pValue)) };
}
