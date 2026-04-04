function clamp(v: number, min: number, max: number): number { return Math.max(min, Math.min(max, v)); }

export function computeThemeSensitivities(
  forwardReturns: Array<{ ideaRunId?: string; costAdjustedSignedReturnPct?: number | null }>,
  ideaRuns: Array<{ id?: string; themeId?: string }>,
  currentSensitivities: Map<string, number>,
): Map<string, number> {
  // Group returns by theme
  const runToTheme = new Map<string, string>();
  for (const run of ideaRuns) {
    if (run.id && run.themeId) runToTheme.set(run.id, run.themeId);
  }
  const themeReturns = new Map<string, number[]>();
  for (const r of forwardReturns) {
    const theme = r.ideaRunId ? runToTheme.get(r.ideaRunId) : undefined;
    if (!theme || typeof r.costAdjustedSignedReturnPct !== 'number') continue;
    const arr = themeReturns.get(theme) || [];
    arr.push(r.costAdjustedSignedReturnPct);
    themeReturns.set(theme, arr);
  }

  const result = new Map<string, number>();
  for (const [theme, returns] of themeReturns) {
    const positives = returns.filter(r => r > 0);
    if (positives.length < 3) continue;
    const avgPositive = positives.reduce((s, v) => s + v, 0) / positives.length;
    const computed = clamp(60 + avgPositive * 3, 55, 95);
    const current = currentSensitivities.get(theme) ?? 70;
    // Blend 50/50
    result.set(theme, Math.round(current * 0.5 + computed * 0.5));
  }
  return result;
}
