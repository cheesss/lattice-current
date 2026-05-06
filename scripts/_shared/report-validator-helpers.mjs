/*
 * Shared validation helpers — extracted from report-validator.mjs so the
 * Codex narrator can run the same allow-list checks without creating an
 * import cycle (report-llm-analyst → narrator → validator-helpers).
 *
 * The validator imports these functions and uses them for blocker
 * generation. The narrator imports them to drop sentences before the
 * validator sees the full draft.
 */

function asArray(v) { return Array.isArray(v) ? v : []; }

const COMMON_UPPERCASE_WORDS = new Set([
  'LLM', 'API', 'JSON', 'HTML', 'PDF', 'PPTX', 'DB', 'UI', 'NAS', 'VIX',
  'EVID', 'MET', 'FIG', 'CAV', 'CLM', 'WATCH', 'ETF', 'SEC', 'SLA',
  'AI', 'ML',
  'CEO', 'CTO', 'CFO', 'COO', 'PPA', 'IPO', 'GDP', 'CPI', 'GPU', 'CPU',
  'EV', 'EU', 'US', 'UK', 'NA', 'EDP', 'TPU', 'IO', 'OS',
  'AND', 'OR', 'NOT', 'IT', 'IS', 'OK', 'MW', 'GW', 'KWH', 'MWH', 'GWH',
  'YOY', 'QOQ', 'WOW', 'DOD',
]);

export function knownNumericStrings(bundle) {
  const ctx = bundle.metadata?.themeContext || {};
  const sym = bundle.metadata?.sensitivity || {};
  const cand = bundle.metadata?.candidate || {};
  const event = bundle.metadata?.event || {};
  const numbers = [
    ...asArray(bundle.metrics).map((metric) => metric.value),
    ...asArray(bundle.marketReactions).flatMap((reaction) => [
      reaction.relativeReturnPct, reaction.uplift, reaction.tStat, reaction.alpha,
    ]),
    ...asArray(ctx.subtopics).flatMap((s) => [s.momentum_score, s.acceleration, s.rank_in_parent, s.article_count, s.share_pct]),
    ...asArray(ctx.peerSymbols?.positive).flatMap((p) => [p.sensitivity_zscore, p.avg_return, p.baseline_return, p.sample_size, p.hit_rate, p.return_vol]),
    ...asArray(ctx.peerSymbols?.negative).flatMap((p) => [p.sensitivity_zscore, p.avg_return, p.baseline_return, p.sample_size, p.hit_rate, p.return_vol]),
    ...asArray(ctx.regimeBySymbol).flatMap((g) => asArray(g.regimes).flatMap((r) => [r.regime_multiplier, r.avg_return, r.sample_size, r.hit_rate])),
    ...asArray(ctx.knowledgeConnections).flatMap((c) => [c.confidence, c.evidenceCount, c.sourceDiversity]),
    ...asArray(ctx.events).flatMap((e) => [e.articleCount, e.sourceCount, e.sourceDiversity, e.hawkesIntensity, e.normalizedTemperature, e.topSourceShare]),
    ...asArray(ctx.hawkesSeries).flatMap((h) => [h.hawkes_intensity, h.normalized_temperature, h.article_count]),
    sym.sensitivity_zscore, sym.sample_size, sym.avg_return, sym.baseline_return, sym.hit_rate, sym.return_vol,
    cand.score, cand.evidence_summary?.evidenceQuality, cand.evidence_summary?.sourceDiversity, cand.evidence_summary?.seedSimilarity,
    event.article_count, event.source_count, event.source_diversity,
    /* policy thresholds */
    1, 1.5, 2, 3, 4, 5, 7, 10, 14, 21, 30, 0.4, 0.5, 0.55, 0.6, 0.7, 0.8,
    /* subject ids */
    bundle.subject?.subjectId, bundle.metadata?.event?.id, bundle.metadata?.candidate?.id,
    /* aggregate counts */
    asArray(ctx.events).length, asArray(ctx.subtopics).length, asArray(ctx.knowledgeConnections).length,
    ctx.peerSymbols?.counts?.total || 0, ctx.peerSymbols?.counts?.positive || 0, ctx.peerSymbols?.counts?.negative || 0,
    asArray(bundle.evidence).length, asArray(bundle.marketReactions).length, asArray(bundle.caveats).length,
    asArray(ctx.events).filter((e) => e.isSurge).length,
    /* P5: cross-asset path counts + historical analogue similarities */
    ...(asArray(bundle.metadata?.crossAssetPaths?.paths)).flatMap((p) => [p.score, p.hop1?.confidence, p.hop2?.confidence, p.pathLength]),
    ...(asArray(bundle.metadata?.historicalAnalogues?.analogues)).flatMap((a) => [a.similarity, a.profile?.mean, a.profile?.max, a.profile?.surge]),
    bundle.metadata?.crossAssetPaths?.paths?.length || 0,
    bundle.metadata?.historicalAnalogues?.analogues?.length || 0,
  ].filter((value) => Number.isFinite(Number(value)));
  const out = new Set();
  for (const value of numbers) {
    const number = Number(value);
    out.add(String(number));
    out.add(number.toFixed(0));
    out.add(number.toFixed(1));
    out.add(number.toFixed(2));
    out.add(number.toFixed(3));
    out.add(`${number.toFixed(0)}%`);
    out.add(`${number.toFixed(1)}%`);
    out.add(`${number.toFixed(2)}%`);
    if (number > 0) {
      out.add(`+${number.toFixed(0)}%`);
      out.add(`+${number.toFixed(1)}%`);
      out.add(`+${number.toFixed(2)}%`);
      out.add(`+${number.toFixed(0)}`);
      out.add(`+${number.toFixed(1)}`);
      out.add(`+${number.toFixed(2)}`);
    }
    if (number < 0) out.add(String(Math.abs(number)));
  }
  return out;
}

export function allowedTickerStrings(bundle) {
  const tickers = new Set();
  for (const reaction of asArray(bundle.marketReactions)) {
    if (reaction.symbol) tickers.add(String(reaction.symbol).toUpperCase());
    if (reaction.benchmark) tickers.add(String(reaction.benchmark).toUpperCase());
  }
  for (const item of asArray(bundle.metadata?.allowedTickers)) {
    tickers.add(String(item).toUpperCase());
  }
  /* Include peer symbol tickers from themeContext */
  const ctx = bundle.metadata?.themeContext || {};
  for (const p of asArray(ctx.peerSymbols?.positive)) if (p.symbol) tickers.add(String(p.symbol).toUpperCase());
  for (const p of asArray(ctx.peerSymbols?.negative)) if (p.symbol) tickers.add(String(p.symbol).toUpperCase());
  for (const g of asArray(ctx.regimeBySymbol)) if (g.symbol) tickers.add(String(g.symbol).toUpperCase());
  /* Include sensitivity row symbol */
  const sym = bundle.metadata?.sensitivity;
  if (sym?.symbol) tickers.add(String(sym.symbol).toUpperCase());
  /* Pull from text fields */
  const evidenceText = [
    bundle.subject?.displayName,
    ...asArray(bundle.claims).map((claim) => claim.canonicalText),
    ...asArray(bundle.evidence).flatMap((item) => [item.title, item.publisher]),
  ].join(' ');
  for (const token of (evidenceText.match(/\b[A-Z][A-Z0-9.]{1,8}\b/g) || [])) {
    tickers.add(token.toUpperCase());
  }
  return tickers;
}

export { COMMON_UPPERCASE_WORDS };
