/**
 * tech-trend-integration.ts — 신기술 트렌드 추적을 자동화 사이클에 연결
 *
 * SURGING 기술 트렌드를 theme-discovery 큐에 자동 주입하고,
 * Codex evidence에 트렌드 데이터를 포함시킵니다.
 */

import type { ThemeDiscoveryQueueItem } from '../theme-discovery';

const TECH_TOPICS: Record<string, { keywords: string[]; symbols: string[] }> = {
  'ai-llm-trend': { keywords: ['AI', 'artificial intelligence', 'GPT', 'ChatGPT', 'LLM', 'deep learning'], symbols: ['NVDA', 'AMD', 'SMH'] },
  'semiconductor-trend': { keywords: ['semiconductor', 'chip', 'chipmaker', 'TSMC', 'foundry', 'ASML'], symbols: ['SMH', 'SOXX', 'NVDA', 'AMD'] },
  'ev-battery-trend': { keywords: ['electric vehicle', 'EV', 'battery', 'lithium', 'Tesla', 'BYD'], symbols: ['QQQ'] },
  'nuclear-fusion-trend': { keywords: ['nuclear', 'fusion', 'SMR', 'uranium', 'modular reactor'], symbols: ['XLE', 'UNG'] },
  'cyber-security-trend': { keywords: ['cyber', 'ransomware', 'cybersecurity', 'data breach', 'hack'], symbols: ['CIBR', 'CRWD'] },
  'space-satellite-trend': { keywords: ['SpaceX', 'satellite', 'orbit', 'rocket', 'space station'], symbols: ['ITA'] },
  'biotech-gene-trend': { keywords: ['biotech', 'CRISPR', 'gene therapy', 'mRNA', 'clinical trial'], symbols: ['QQQ'] },
  'drone-robotics-trend': { keywords: ['drone', 'robot', 'autonomous', 'UAV', 'self-driving'], symbols: ['ITA', 'QQQ'] },
  'renewable-energy-trend': { keywords: ['solar', 'wind energy', 'renewable', 'hydrogen', 'fuel cell'], symbols: ['XLE'] },
};

export interface TechTrendSignal {
  topicKey: string;
  label: string;
  momentum: number;
  status: 'SURGING' | 'GROWING' | 'STABLE' | 'DECLINING';
  recentMonthlyAvg: number;
  surging: boolean;
  symbols: string[];
  keywords: string[];
}

/**
 * Detect tech trends from article database.
 * Returns SURGING/GROWING trends that should be injected into theme-discovery queue.
 */
export async function detectTechTrends(
  pool: { query: (text: string, values?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }> },
): Promise<TechTrendSignal[]> {
  const signals: TechTrendSignal[] = [];

  for (const [topicKey, config] of Object.entries(TECH_TOPICS)) {
    try {
      const kwCondition = config.keywords.map((_, i) => `title ILIKE $${i + 1}`).join(' OR ');
      const kwParams = config.keywords.map(kw => `%${kw}%`);

      const trend = await pool.query(
        `SELECT DATE_TRUNC('month', published_at)::date AS month, COUNT(*) AS n
         FROM articles WHERE ${kwCondition}
         GROUP BY month ORDER BY month DESC LIMIT 12`,
        kwParams,
      );

      if (trend.rows.length < 6) continue;

      const recent3 = trend.rows.slice(0, 3);
      const prev3 = trend.rows.slice(3, 6);
      const recentAvg = recent3.reduce((s: number, r) => s + Number(r.n), 0) / 3;
      const prevAvg = prev3.reduce((s: number, r) => s + Number(r.n), 0) / 3;
      const momentum = prevAvg > 0 ? ((recentAvg - prevAvg) / prevAvg * 100) : 0;

      const status = momentum > 30 ? 'SURGING' as const
        : momentum > 10 ? 'GROWING' as const
        : momentum > -10 ? 'STABLE' as const
        : 'DECLINING' as const;

      signals.push({
        topicKey,
        label: topicKey.replace(/-trend$/, '').replace(/-/g, ' '),
        momentum,
        status,
        recentMonthlyAvg: recentAvg,
        surging: status === 'SURGING' || status === 'GROWING',
        symbols: config.symbols,
        keywords: config.keywords,
      });
    } catch { /* skip on error */ }
  }

  return signals;
}

/**
 * Convert SURGING tech trends into ThemeDiscoveryQueueItem entries
 * that can be injected into the theme-discovery queue for Codex processing.
 */
export function trendSignalsToQueueItems(
  signals: TechTrendSignal[],
  existingQueue: ThemeDiscoveryQueueItem[],
): ThemeDiscoveryQueueItem[] {
  const existingKeys = new Set(existingQueue.map(q => q.topicKey));
  const items: ThemeDiscoveryQueueItem[] = [];

  for (const signal of signals) {
    if (!signal.surging) continue;
    if (existingKeys.has(signal.topicKey)) continue;

    const now = new Date().toISOString();
    items.push({
      id: `tech-trend:${signal.topicKey}:${now}`,
      topicKey: signal.topicKey,
      label: `Emerging tech: ${signal.label}`,
      status: 'open' as const,
      signalScore: Math.min(95, Math.round(50 + signal.momentum / 5)),
      overlapWithKnownThemes: 0,
      sampleCount: Math.round(signal.recentMonthlyAvg * 3),
      sourceCount: 2,
      regionCount: 1,
      supportingHeadlines: [],
      supportingRegions: ['global'],
      supportingSources: ['guardian', 'nyt'],
      datasetIds: [],
      suggestedSymbols: signal.symbols,
      hints: signal.keywords.slice(0, 6),
      reason: `Tech trend ${signal.status}: momentum ${signal.momentum > 0 ? '+' : ''}${signal.momentum.toFixed(0)}%, avg ${signal.recentMonthlyAvg.toFixed(0)} articles/mo`,
      createdAt: now,
      updatedAt: now,
      proposedThemeId: null,
    });
  }

  return items;
}

/**
 * Format trend signals for Codex evidence consumption.
 */
export function formatTrendEvidence(signals: TechTrendSignal[]): string[] {
  return signals
    .filter(s => s.status === 'SURGING' || s.status === 'GROWING')
    .map(s => `${s.label}: ${s.status} (momentum ${s.momentum > 0 ? '+' : ''}${s.momentum.toFixed(0)}%, avg ${s.recentMonthlyAvg.toFixed(0)} articles/mo, symbols: ${s.symbols.join(',')})`)
    .slice(0, 8);
}
