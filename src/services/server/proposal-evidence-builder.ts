import { CODEX_PROPOSAL_TUNING } from '@/config/intelligence-tuning';
import type { DatasetDiscoveryThemeInput, DatasetProposal } from '../dataset-discovery';
import type { InvestmentThemeDefinition, UniverseCoverageGap } from '../investment-intelligence';
import type { DirectAssetMapping } from '../investment-intelligence';
import type { ThemeDiscoveryQueueItem } from '../theme-discovery';
import type { ReplayAdaptationSnapshot } from '../replay-adaptation';

export interface ProposalEvidenceBundle {
  summary: string;
  historicalAnalogs: string[];
  weaknessSignals: string[];
  coverageSignals: string[];
  /** Event impact analysis: real historical stock reactions to similar events */
  eventImpact?: string[];
  /** Tech trend signals: surging/declining technology trends */
  techTrends?: string[];
}

function clampList(values: string[], limit: number): string[] {
  return Array.from(new Set(values.map((value) => String(value || '').trim()).filter(Boolean))).slice(0, limit);
}

/**
 * Query event impact data from NAS for evidence enrichment.
 * Returns formatted strings for Codex consumption.
 */
export async function queryEventImpactEvidence(
  pool: { query: (text: string, values?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }> } | null,
  theme: string,
  symbols: string[],
): Promise<{ eventImpact: string[]; techTrends: string[] }> {
  if (!pool) return { eventImpact: [], techTrends: [] };
  const eventImpact: string[] = [];
  const techTrends: string[] = [];

  try {
    // 1. Stock sensitivity for this theme
    const sens = await pool.query(
      `SELECT symbol, horizon, avg_return, hit_rate, sensitivity_zscore, sample_size
       FROM stock_sensitivity_matrix WHERE theme = $1 AND horizon = '2w' ORDER BY ABS(sensitivity_zscore) DESC LIMIT 5`,
      [theme],
    );
    for (const r of sens.rows) {
      const ret = Number(r.avg_return);
      eventImpact.push(`${theme}→${r.symbol}: avg ${ret >= 0 ? '+' : ''}${ret.toFixed(2)}% at 2w, hit ${(Number(r.hit_rate) * 100).toFixed(0)}%, n=${r.sample_size}`);
    }

    // 2. Conditional sensitivity (GDELT intensity)
    const cond = await pool.query(
      `SELECT symbol, condition_type, condition_value, avg_return, hit_rate, sample_size
       FROM conditional_sensitivity WHERE theme = $1 AND horizon = '2w' AND sample_size >= 100
       ORDER BY ABS(avg_return) DESC LIMIT 3`,
      [theme],
    );
    for (const r of cond.rows) {
      const ret = Number(r.avg_return);
      eventImpact.push(`[${r.condition_type}=${r.condition_value}] ${r.symbol}: ${ret >= 0 ? '+' : ''}${ret.toFixed(2)}% hit=${(Number(r.hit_rate) * 100).toFixed(0)}%`);
    }

    // 3. Volatility profile for proposed symbols
    if (symbols.length > 0) {
      const vol = await pool.query(
        `SELECT symbol, avg_abs_return, high_vol_rate FROM event_volatility_profiles
         WHERE theme = $1 AND horizon = '2w' AND symbol = ANY($2) ORDER BY avg_abs_return DESC`,
        [theme, symbols],
      );
      for (const r of vol.rows) {
        eventImpact.push(`${r.symbol} volatility: avg|move|=${Number(r.avg_abs_return).toFixed(2)}%, high_vol=${(Number(r.high_vol_rate) * 100).toFixed(0)}%`);
      }
    }

    // 4. Tech trend signals
    const trendKeywords: Record<string, string[]> = {
      'AI': ['AI', 'artificial intelligence', 'GPT', 'LLM'],
      'semiconductor': ['semiconductor', 'chip', 'TSMC'],
      'cyber': ['cyber', 'ransomware', 'hack'],
      'drone': ['drone', 'robot', 'autonomous'],
      'EV': ['EV', 'battery', 'electric vehicle'],
      'nuclear': ['nuclear', 'fusion', 'SMR'],
      'biotech': ['biotech', 'CRISPR', 'mRNA'],
      'renewable': ['solar', 'renewable', 'hydrogen'],
    };
    for (const [topic, kws] of Object.entries(trendKeywords)) {
      if (!kws.some(kw => theme.toLowerCase().includes(kw.toLowerCase()))) continue;
      const kwCondition = kws.map((_, i) => `title ILIKE $${i + 1}`).join(' OR ');
      const trend = await pool.query(
        `SELECT DATE_TRUNC('month', published_at)::date AS month, COUNT(*) AS n
         FROM articles WHERE ${kwCondition}
         GROUP BY month ORDER BY month DESC LIMIT 12`,
        kws.map(kw => `%${kw}%`),
      );
      if (trend.rows.length >= 6) {
        const recent3 = trend.rows.slice(0, 3).reduce((s: number, r: Record<string, unknown>) => s + Number(r.n), 0) / 3;
        const prev3 = trend.rows.slice(3, 6).reduce((s: number, r: Record<string, unknown>) => s + Number(r.n), 0) / 3;
        const momentum = prev3 > 0 ? ((recent3 - prev3) / prev3 * 100) : 0;
        const status = momentum > 30 ? 'SURGING' : momentum > 10 ? 'GROWING' : momentum > -10 ? 'STABLE' : 'DECLINING';
        techTrends.push(`${topic}: ${status} (momentum ${momentum > 0 ? '+' : ''}${momentum.toFixed(0)}%, recent avg ${recent3.toFixed(0)} articles/mo)`);
      }
    }
  } catch {
    // Non-fatal: evidence enrichment is optional
  }

  return { eventImpact, techTrends };
}

export function buildThemeProposalEvidence(args: {
  queueItem: ThemeDiscoveryQueueItem;
  knownThemes: InvestmentThemeDefinition[];
  eventImpact?: string[];
  techTrends?: string[];
}): ProposalEvidenceBundle {
  const relatedThemes = args.knownThemes
    .filter((theme) =>
      theme.triggers.some((trigger) => args.queueItem.hints.some((hint) => trigger.includes(hint) || hint.includes(trigger))))
    .slice(0, CODEX_PROPOSAL_TUNING.maxEvidenceBullets)
    .map((theme) => `${theme.id}: ${theme.label}`);

  const historicalAnalogs = clampList([
    ...args.queueItem.supportingHeadlines.map((headline) => `headline:${headline}`),
    ...args.queueItem.suggestedSymbols.map((symbol) => `symbol:${symbol}`),
  ], CODEX_PROPOSAL_TUNING.maxHistoricalAnalogs);

  const weaknessSignals = clampList([
    `overlap=${args.queueItem.overlapWithKnownThemes.toFixed(2)}`,
    `signalScore=${args.queueItem.signalScore}`,
    `sources=${args.queueItem.sourceCount}`,
    `regions=${args.queueItem.regionCount}`,
  ], CODEX_PROPOSAL_TUNING.maxWeaknessBullets);

  const coverageSignals = clampList([
    `datasetIds=${args.queueItem.datasetIds.join(', ') || 'none'}`,
    `supportingSources=${args.queueItem.supportingSources.join(', ') || 'none'}`,
    ...relatedThemes.map((row) => `relatedTheme=${row}`),
  ], CODEX_PROPOSAL_TUNING.maxEvidenceBullets);

  return {
    summary: `queue=${args.queueItem.topicKey} signal=${args.queueItem.signalScore} samples=${args.queueItem.sampleCount} overlap=${args.queueItem.overlapWithKnownThemes.toFixed(2)}`,
    historicalAnalogs,
    weaknessSignals,
    coverageSignals,
    eventImpact: args.eventImpact ?? [],
    techTrends: args.techTrends ?? [],
  };
}

export function buildCandidateProposalEvidence(args: {
  theme: InvestmentThemeDefinition;
  gaps: UniverseCoverageGap[];
  topMappings: DirectAssetMapping[];
  replayAdaptation: ReplayAdaptationSnapshot | null;
  eventImpact?: string[];
}): ProposalEvidenceBundle {
  const themeProfile = args.replayAdaptation?.themeProfiles.find((profile) => profile.themeId === args.theme.id) || null;
  const currentTheme = args.replayAdaptation?.currentThemePerformance.find((metric) => metric.themeId === args.theme.id) || null;
  const historicalAnalogs = clampList([
    ...args.topMappings.map((mapping) => `${mapping.symbol}:${mapping.direction}:${mapping.conviction}`),
    ...(themeProfile?.horizonMetrics || []).map((metric) => `h=${metric.horizonHours} hit=${metric.hitRate}% avg=${metric.costAdjustedAvgReturnPct}%`),
  ], CODEX_PROPOSAL_TUNING.maxHistoricalAnalogs);
  const weaknessSignals = clampList([
    ...args.gaps.map((gap) => `${gap.severity} missingKinds=${gap.missingAssetKinds.join('/') || 'none'} missingSectors=${gap.missingSectors.join('/') || 'none'}`),
    themeProfile ? `confirmationReliability=${themeProfile.confirmationReliability}` : 'noReplayProfile',
    currentTheme ? `currentAvgReturn=${currentTheme.avgReturnPct.toFixed(2)}` : 'noCurrentPerformance',
  ], CODEX_PROPOSAL_TUNING.maxWeaknessBullets);
  const coverageSignals = clampList([
    ...args.gaps.flatMap((gap) => gap.suggestedSymbols.map((symbol) => `gapSymbol=${symbol}`)),
    ...args.topMappings.slice(0, CODEX_PROPOSAL_TUNING.maxEvidenceBullets).map((mapping) => `mapping=${mapping.eventTitle} -> ${mapping.symbol}`),
  ], CODEX_PROPOSAL_TUNING.maxEvidenceBullets);
  return {
    summary: `theme=${args.theme.id} gaps=${args.gaps.length} mappings=${args.topMappings.length} replaySample=${themeProfile?.weightedSampleSize ?? 0}`,
    historicalAnalogs,
    weaknessSignals,
    coverageSignals,
    eventImpact: args.eventImpact ?? [],
  };
}

export function buildDatasetProposalEvidence(args: {
  themeInput: DatasetDiscoveryThemeInput;
  proposal?: DatasetProposal | null;
  replayAdaptation: ReplayAdaptationSnapshot | null;
}): ProposalEvidenceBundle {
  const themeProfile = args.replayAdaptation?.themeProfiles.find((profile) => profile.themeId === args.themeInput.themeId) || null;
  const currentTheme = args.replayAdaptation?.currentThemePerformance.find((metric) => metric.themeId === args.themeInput.themeId) || null;
  return {
    summary: `theme=${args.themeInput.themeId} priority=${args.themeInput.priority} proposal=${args.proposal?.id || 'n/a'}`,
    historicalAnalogs: clampList([
      ...(args.themeInput.supportingHeadlines || []).map((headline) => `headline:${headline}`),
      ...(themeProfile?.regimeMetrics || []).map((metric) => `regime=${metric.regimeId} hit=${metric.hitRate}% avg=${metric.costAdjustedAvgReturnPct}%`),
    ], CODEX_PROPOSAL_TUNING.maxHistoricalAnalogs),
    weaknessSignals: clampList([
      themeProfile ? `confirmationReliability=${themeProfile.confirmationReliability}` : 'noReplayProfile',
      themeProfile ? `weightedSampleSize=${themeProfile.weightedSampleSize}` : 'noReplaySample',
      currentTheme ? `currentAvgReturn=${currentTheme.avgReturnPct.toFixed(2)}` : 'noCurrentPerformance',
    ], CODEX_PROPOSAL_TUNING.maxWeaknessBullets),
    coverageSignals: clampList([
      ...(args.themeInput.suggestedSymbols || []).map((symbol) => `symbol=${symbol}`),
      ...args.themeInput.triggers.map((trigger) => `trigger=${trigger}`),
      args.proposal?.querySummary ? `query=${args.proposal.querySummary}` : '',
    ], CODEX_PROPOSAL_TUNING.maxEvidenceBullets),
  };
}
