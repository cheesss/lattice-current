function clamp(v: number, min: number, max: number): number { return Math.max(min, Math.min(max, v)); }

export function computeKellySizing(
  mappingStats: Map<string, { posteriorWinRate: number; emaReturnPct: number; emaWorstReturnPct?: number; observations: number }>,
  minObservations = 5,
): Map<string, number> {
  const result = new Map<string, number>();
  for (const [key, stats] of mappingStats) {
    if (stats.observations < minObservations) continue;
    const p = stats.posteriorWinRate / 100;
    const avgWin = Math.max(0.1, stats.emaReturnPct);
    const avgLoss = Math.max(0.1, Math.abs(stats.emaWorstReturnPct ?? stats.emaReturnPct * -0.8));
    const kelly = p - (1 - p) / (avgWin / avgLoss);
    // Half-Kelly for conservatism
    const positionPct = clamp(kelly * 50, 2, 30);
    if (positionPct > 0) result.set(key, positionPct);
  }
  return result;
}
