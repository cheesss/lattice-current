function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = values.slice().sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
}

export function computeExecutionCosts(
  forwardReturns: Array<{ spreadBps?: number; slippageBps?: number }>,
): Map<string, { spreadBps: number; slippageBps: number }> {
  // Group by asset kind and compute median
  const byKind = new Map<string, { spreads: number[]; slippages: number[] }>();
  for (const r of forwardReturns) {
    const kind = 'equity'; // simplified — could be looked up per symbol
    const bucket = byKind.get(kind) || { spreads: [], slippages: [] };
    if (typeof r.spreadBps === 'number' && Number.isFinite(r.spreadBps)) bucket.spreads.push(r.spreadBps);
    if (typeof r.slippageBps === 'number' && Number.isFinite(r.slippageBps)) bucket.slippages.push(r.slippageBps);
    byKind.set(kind, bucket);
  }
  const result = new Map<string, { spreadBps: number; slippageBps: number }>();
  for (const [kind, data] of byKind) {
    result.set(kind, {
      spreadBps: data.spreads.length > 0 ? median(data.spreads) : 14,
      slippageBps: data.slippages.length > 0 ? median(data.slippages) : 14,
    });
  }
  return result;
}
