import type { PricePoint, KalmanNoiseResult } from './types';
import { clamp } from './math-utils';

export function computeKalmanNoise(
  priceSeries: Map<string, PricePoint[]>,
): Map<string, KalmanNoiseResult> {
  const result = new Map<string, KalmanNoiseResult>();
  for (const [symbol, prices] of priceSeries) {
    if (prices.length < 5) continue;
    const sorted = prices.slice().sort((a, b) => a.ts - b.ts);
    // Compute log-return volatility
    const logReturns: number[] = [];
    for (let i = 1; i < sorted.length; i++) {
      const prev = sorted[i - 1]!.price;
      const curr = sorted[i]!.price;
      if (prev > 0 && curr > 0) logReturns.push(Math.log(curr / prev));
    }
    if (logReturns.length < 3) continue;
    const mean = logReturns.reduce((s, v) => s + v, 0) / logReturns.length;
    const variance = logReturns.reduce((s, v) => s + (v - mean) ** 2, 0) / logReturns.length;
    const vol = Math.sqrt(variance);
    result.set(symbol, {
      processNoise: clamp(vol * 8, 0.5, 5),
      measurementNoise: clamp(vol * 20, 2, 15),
    });
  }
  return result;
}
