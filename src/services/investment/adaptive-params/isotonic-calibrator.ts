/**
 * isotonic-calibrator.ts — Isotonic regression for probability calibration.
 *
 * Ensures predicted probabilities match empirical hit frequencies.
 * Uses Pool Adjacent Violators Algorithm (PAVA) to fit a monotone step function.
 */

export interface IsotonicCalibrator {
  breakpoints: number[];   // sorted predicted values at step boundaries
  values: number[];        // calibrated probability at each step
  sampleCount: number;
}

/**
 * Fit isotonic regression using PAVA (Pool Adjacent Violators Algorithm).
 * Input: (predicted, actual) pairs where actual is 0 or 1.
 * Output: monotone non-decreasing step function mapping predicted → calibrated.
 */
export function fitIsotonicRegression(
  predicted: number[],
  actual: number[],
): IsotonicCalibrator {
  const n = predicted.length;
  if (n === 0) {
    return { breakpoints: [0, 1], values: [0.5, 0.5], sampleCount: 0 };
  }

  const indices = Array.from({ length: n }, (_, i) => i);
  indices.sort((a, b) => (predicted[a] ?? 0) - (predicted[b] ?? 0));

  const blocks: Array<{ sum: number; count: number; minPred: number; maxPred: number }> = [];
  for (const idx of indices) {
    const pv = predicted[idx] ?? 0;
    blocks.push({ sum: actual[idx] ?? 0, count: 1, minPred: pv, maxPred: pv });
  }

  // PAVA: merge adjacent violators until monotone
  let changed = true;
  while (changed) {
    changed = false;
    let i = 0;
    while (i < blocks.length - 1) {
      const curr = blocks[i]!;
      const next = blocks[i + 1]!;
      if (curr.sum / curr.count > next.sum / next.count) {
        blocks[i] = {
          sum: curr.sum + next.sum,
          count: curr.count + next.count,
          minPred: curr.minPred,
          maxPred: next.maxPred,
        };
        blocks.splice(i + 1, 1);
        changed = true;
      } else {
        i++;
      }
    }
  }

  const breakpoints: number[] = [];
  const values: number[] = [];
  for (const block of blocks) {
    breakpoints.push((block.minPred + block.maxPred) / 2);
    values.push(block.sum / block.count);
  }

  return { breakpoints, values, sampleCount: n };
}

/**
 * Calibrate a raw prediction using the fitted isotonic model.
 * Uses linear interpolation between breakpoints.
 */
export function calibrate(model: IsotonicCalibrator, rawProbability: number): number {
  const bp = model.breakpoints;
  const vals = model.values;
  if (bp.length === 0) return rawProbability;
  if (bp.length === 1) return vals[0] ?? rawProbability;

  const first = bp[0] ?? 0;
  const last = bp[bp.length - 1] ?? 1;
  if (rawProbability <= first) return vals[0] ?? rawProbability;
  if (rawProbability >= last) return vals[vals.length - 1] ?? rawProbability;

  let lo = 0;
  let hi = bp.length - 1;
  while (lo < hi - 1) {
    const mid = (lo + hi) >>> 1;
    if ((bp[mid] ?? 0) <= rawProbability) lo = mid;
    else hi = mid;
  }

  const x0 = bp[lo] ?? 0;
  const x1 = bp[hi] ?? 1;
  const y0 = vals[lo] ?? 0.5;
  const y1 = vals[hi] ?? 0.5;
  const dx = x1 - x0;
  if (dx < 1e-12) return (y0 + y1) / 2;
  const t = (rawProbability - x0) / dx;
  return y0 + t * (y1 - y0);
}

export function exportCalibrator(model: IsotonicCalibrator): string {
  return JSON.stringify(model);
}

export function importCalibrator(json: string): IsotonicCalibrator {
  return JSON.parse(json) as IsotonicCalibrator;
}
