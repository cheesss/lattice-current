import type { PricePoint, AtrStopResult } from './types';

function clamp(v: number, min: number, max: number): number { return Math.max(min, Math.min(max, v)); }

function computeAtr(prices: PricePoint[], period = 14): number {
  if (prices.length < 2) return 0;
  const sorted = prices.slice().sort((a, b) => a.ts - b.ts);
  const diffs: number[] = [];
  for (let i = 1; i < sorted.length; i++) {
    diffs.push(Math.abs(sorted[i]!.price - sorted[i - 1]!.price));
  }
  const window = diffs.slice(-period);
  return window.length > 0 ? window.reduce((s, v) => s + v, 0) / window.length : 0;
}

export function computeAtrStops(
  priceSeries: Map<string, PricePoint[]>,
): Map<string, AtrStopResult> {
  const result = new Map<string, AtrStopResult>();
  for (const [symbol, prices] of priceSeries) {
    if (prices.length < 3) continue;
    const lastPrice = prices[prices.length - 1]!.price;
    if (!lastPrice || lastPrice <= 0) continue;
    const atr = computeAtr(prices);
    const atrPct = (atr / lastPrice) * 100;
    result.set(symbol, {
      stopLossPct: clamp(atrPct * 2, 1, 15),
      takeProfitPct: clamp(atrPct * 4, 2, 30),
    });
  }
  return result;
}
