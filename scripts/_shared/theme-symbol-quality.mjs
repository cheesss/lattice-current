function clamp(value, min = 0, max = 1) {
  return Math.min(max, Math.max(min, value));
}

function toNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

export function scoreThemeSymbolMappings(rows, options = {}) {
  const minReactionCount = options.minReactionCount ?? 20;
  const minReactionRatio = options.minReactionRatio ?? 1.05;
  const minQualityScore = options.minQualityScore ?? 0.45;
  const minSpecificityScore = options.minSpecificityScore ?? 1.08;
  const minDirectionalEdge = options.minDirectionalEdge ?? 0.03;
  const minReturnShift = options.minReturnShift ?? 0.35;

  const themeCount = new Set(rows.map((row) => row.theme)).size || 1;
  const bySymbol = new Map();

  for (const row of rows) {
    const symbol = String(row.symbol || '').trim();
    if (!symbol) continue;
    const reactionRatio = toNumber(row.reaction_ratio, 1);
    const bucket = bySymbol.get(symbol) || [];
    bucket.push(reactionRatio);
    bySymbol.set(symbol, bucket);
  }

  return rows.map((row) => {
    const symbol = String(row.symbol || '').trim();
    const reactionCount = toNumber(row.reaction_count);
    const reactionRatio = toNumber(row.reaction_ratio, 1);
    const eventHitRate = toNumber(row.event_hit_rate, 0.5);
    const baselineHitRate = toNumber(row.baseline_hit_rate, 0.5);
    const eventAvgReturn = toNumber(row.event_avg_return);
    const baselineAvgReturn = toNumber(row.baseline_avg_return);
    const ratios = bySymbol.get(symbol) || [reactionRatio];
    const avgRatio = ratios.reduce((sum, value) => sum + value, 0) / ratios.length;
    const coverageCount = ratios.length;
    const specificityScore = coverageCount <= 1
      ? Math.max(reactionRatio, 1)
      : (avgRatio > 0 ? reactionRatio / avgRatio : 1);
    const absoluteDirectionalEdge = Math.abs(eventHitRate - 0.5);
    const relativeDirectionalEdge = Math.abs(eventHitRate - baselineHitRate);
    const returnShift = Math.abs(eventAvgReturn - baselineAvgReturn);
    const outcomeCount = toNumber(row.outcome_count);
    const outcomeHitRate = toNumber(row.outcome_hit_rate, 0.5);
    const outcomeAvgReturn = toNumber(row.outcome_avg_return);
    const hasStrongOutcomeEvidence = outcomeCount >= 500
      && (
        Math.abs(outcomeHitRate - 0.5) >= 0.08
        || Math.abs(outcomeAvgReturn) >= 0.4
      );
    const coveragePenalty = themeCount > 1
      ? clamp((coverageCount - 1) / Math.max(themeCount - 1, 1))
      : 0;
    const genericPenalty = clamp(
      coveragePenalty
      * (specificityScore <= 1 ? 0.6 : 1 / specificityScore)
      * (hasStrongOutcomeEvidence ? 0.35 : 1),
    );
    const reactionScore = clamp((reactionRatio - 1) / 0.4);
    const specificityComponent = clamp((specificityScore - 1) / 0.35);
    const directionalScore = clamp(Math.max(absoluteDirectionalEdge, relativeDirectionalEdge) / 0.15);
    const returnScore = clamp(returnShift / 2);
    const sampleScore = clamp((reactionCount - minReactionCount) / 80);
    const outcomeSupportScore = clamp((outcomeCount - 25) / 250);
    const outcomeEdge = Math.max(Math.abs(outcomeHitRate - 0.5) / 0.15, Math.abs(outcomeAvgReturn) / 3);
    const outcomeScore = clamp(outcomeSupportScore * outcomeEdge);
    const qualityScore = Number(clamp(
      0.16 * reactionScore
      + 0.12 * specificityComponent
      + 0.12 * directionalScore
      + 0.10 * returnScore
      + 0.05 * sampleScore
      + 0.45 * outcomeScore
      - 0.12 * genericPenalty,
    ).toFixed(4));

    const eligible = (
      (
        (
          reactionCount >= minReactionCount
          && reactionRatio >= minReactionRatio
          && (
            specificityScore >= minSpecificityScore
            || (outcomeCount >= 50 && Math.abs(outcomeHitRate - 0.5) >= 0.05)
          )
          && (
            Math.max(absoluteDirectionalEdge, relativeDirectionalEdge) >= minDirectionalEdge
            || returnShift >= minReturnShift
            || (outcomeCount >= 50 && Math.abs(outcomeAvgReturn) >= 0.25)
          )
          && qualityScore >= minQualityScore
        )
        || (hasStrongOutcomeEvidence && qualityScore >= 0.12)
      )
    );

    return {
      ...row,
      reaction_count: reactionCount,
      reaction_ratio: Number(reactionRatio.toFixed(4)),
      specificity_score: Number(specificityScore.toFixed(4)),
      directional_edge: Number(Math.max(absoluteDirectionalEdge, relativeDirectionalEdge).toFixed(4)),
      return_shift: Number(returnShift.toFixed(4)),
      theme_coverage_count: coverageCount,
      generic_penalty: Number(genericPenalty.toFixed(4)),
      outcome_count: outcomeCount,
      outcome_hit_rate: Number(outcomeHitRate.toFixed(4)),
      outcome_avg_return: Number(outcomeAvgReturn.toFixed(4)),
      quality_score: qualityScore,
      eligible,
    };
  }).sort((a, b) => (
    Number(b.eligible) - Number(a.eligible)
    || b.quality_score - a.quality_score
    || b.specificity_score - a.specificity_score
    || b.reaction_ratio - a.reaction_ratio
  ));
}
