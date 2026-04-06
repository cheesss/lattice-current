import type { ClusteredEvent, NewsItem } from '@/types';

export interface SourceDependenceDiagnostics {
  sourceId: string;
  sourceFamily: string;
  corroboratedClusterCount: number;
  independentCorroborationCount: number;
  dependentCorroborationCount: number;
  independentCorroborationSharePct: number;
  dependentCorroborationSharePct: number;
  copyAmplificationRiskScore: number;
  noveltyScore: number;
  temporalLeadScore: number;
  averageLeadMinutes: number | null;
  topPeerSource: string | null;
  topPeerSharePct: number;
  notes: string[];
}

const QUICK_SYNC_WINDOW_MS = 15 * 60 * 1000;
const MAX_CLUSTER_SAMPLE = 120;
const MAX_TITLE_SAMPLE = 80;
const TOP_TOKEN_LIMIT = 64;
const STOPWORDS = new Set([
  'the', 'and', 'for', 'with', 'from', 'into', 'amid', 'after', 'over', 'near', 'says', 'said',
  'warns', 'warn', 'live', 'update', 'updates', 'latest', 'breaking', 'about', 'against', 'through',
  'will', 'this', 'that', 'have', 'more', 'than', 'their', 'its', 'under', 'while', 'where', 'when',
  'russia', 'ukraine', 'iran', 'israel', 'china', 'taiwan',
]);

function boundedScore(value: number, fallback = 0): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(0, Math.min(100, Math.round(value)));
}

function normalize(value: string): string {
  return String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function toTimestamp(value: string | number | Date | null | undefined): number | null {
  if (value == null) return null;
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.getTime() : null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? parsed : null;
}

function tokenize(value: string): string[] {
  return Array.from(
    new Set(
      normalize(value)
        .split(/[^a-z0-9-]+/g)
        .filter((token) => token.length >= 3 && !STOPWORDS.has(token)),
    ),
  ).slice(0, TOP_TOKEN_LIMIT);
}

function getDomain(link: string): string {
  try {
    return new URL(link).hostname.toLowerCase();
  } catch {
    return '';
  }
}

function getSourceFamily(sourceId: string, items: NewsItem[]): string {
  const domain = items.find((item) => item.link)?.link ? getDomain(items.find((item) => item.link)!.link) : '';
  if (domain) {
    const parts = domain.split('.').filter(Boolean);
    if (parts.length >= 2) return parts[parts.length - 2]!;
    return domain;
  }
  const cleaned = normalize(sourceId).replace(/[^a-z0-9]+/g, ' ').trim();
  return cleaned.split(' ')[0] || sourceId;
}

function buildNoveltyScores(grouped: Map<string, NewsItem[]>): Map<string, number> {
  const sourceTokenSets = new Map<string, Set<string>>();
  const tokenSourceCounts = new Map<string, number>();

  for (const [sourceId, items] of grouped.entries()) {
    const tokens = new Set<string>();
    for (const item of items.slice(0, MAX_TITLE_SAMPLE)) {
      for (const token of tokenize(item.title || '')) tokens.add(token);
    }
    sourceTokenSets.set(sourceId, tokens);
    for (const token of tokens) {
      tokenSourceCounts.set(token, (tokenSourceCounts.get(token) || 0) + 1);
    }
  }

  const sourceCount = Math.max(1, grouped.size);
  const noveltyScores = new Map<string, number>();
  for (const [sourceId, tokens] of sourceTokenSets.entries()) {
    if (!tokens.size) {
      noveltyScores.set(sourceId, 28);
      continue;
    }
    let noveltyAccumulator = 0;
    let uniqueCount = 0;
    for (const token of tokens) {
      const appearances = tokenSourceCounts.get(token) || 1;
      const rarity = 1 - (appearances - 1) / Math.max(1, sourceCount - 1);
      noveltyAccumulator += rarity;
      if (appearances === 1) uniqueCount += 1;
    }
    const avgNovelty = noveltyAccumulator / tokens.size;
    const uniqueRatio = uniqueCount / tokens.size;
    noveltyScores.set(
      sourceId,
      boundedScore(22 + avgNovelty * 48 + uniqueRatio * 22, 28),
    );
  }

  return noveltyScores;
}

export function buildSourceDependenceDiagnostics(
  clusters: ClusteredEvent[],
  grouped: Map<string, NewsItem[]>,
): Map<string, SourceDependenceDiagnostics> {
  const noveltyScores = buildNoveltyScores(grouped);
  const corroboratedCounts = new Map<string, number>();
  const independentCounts = new Map<string, number>();
  const dependentCounts = new Map<string, number>();
  const leadCounts = new Map<string, number>();
  const leadMinutesSum = new Map<string, number>();
  const peerCounts = new Map<string, Map<string, number>>();
  const familyPeerCounts = new Map<string, Map<string, number>>();

  for (const cluster of clusters.slice(0, MAX_CLUSTER_SAMPLE)) {
    const earliestBySource = new Map<string, { ts: number; family: string }>();
    for (const item of cluster.allItems || []) {
      const sourceId = normalize(item.source || '');
      if (!sourceId) continue;
      const ts = toTimestamp(item.pubDate);
      if (ts == null) continue;
      const family = getSourceFamily(sourceId, grouped.get(sourceId) || [item]);
      const previous = earliestBySource.get(sourceId);
      if (!previous || ts < previous.ts) earliestBySource.set(sourceId, { ts, family });
    }

    const entries = Array.from(earliestBySource.entries()).sort((a, b) => a[1].ts - b[1].ts);
    if (entries.length < 2) continue;

    const earliestTs = entries[0]![1].ts;
    const latestTs = entries[entries.length - 1]![1].ts;
    const spreadMs = latestTs - earliestTs;
    const familyCounts = new Map<string, number>();
    for (const [, detail] of entries) {
      familyCounts.set(detail.family, (familyCounts.get(detail.family) || 0) + 1);
    }
    const familyDominance = Math.max(...Array.from(familyCounts.values())) / entries.length;
    const quickSync = spreadMs <= QUICK_SYNC_WINDOW_MS;
    const likelyDependentCluster = quickSync || familyDominance >= 0.67;

    for (let index = 0; index < entries.length; index += 1) {
      const [sourceId, detail] = entries[index]!;
      corroboratedCounts.set(sourceId, (corroboratedCounts.get(sourceId) || 0) + 1);
      if (likelyDependentCluster) dependentCounts.set(sourceId, (dependentCounts.get(sourceId) || 0) + 1);
      else independentCounts.set(sourceId, (independentCounts.get(sourceId) || 0) + 1);

      if (index === 0) {
        leadCounts.set(sourceId, (leadCounts.get(sourceId) || 0) + 1);
        const nextTs = entries[1]?.[1].ts;
        if (nextTs != null) {
          leadMinutesSum.set(sourceId, (leadMinutesSum.get(sourceId) || 0) + Math.max(0, (nextTs - detail.ts) / 60_000));
        }
      }

      const peerBucket = peerCounts.get(sourceId) || new Map<string, number>();
      const familyBucket = familyPeerCounts.get(sourceId) || new Map<string, number>();
      for (let j = 0; j < entries.length; j += 1) {
        if (j === index) continue;
        const [peerId, peerDetail] = entries[j]!;
        if (Math.abs(peerDetail.ts - detail.ts) <= QUICK_SYNC_WINDOW_MS) {
          peerBucket.set(peerId, (peerBucket.get(peerId) || 0) + 1);
          familyBucket.set(peerDetail.family, (familyBucket.get(peerDetail.family) || 0) + 1);
        }
      }
      peerCounts.set(sourceId, peerBucket);
      familyPeerCounts.set(sourceId, familyBucket);
    }
  }

  const diagnostics = new Map<string, SourceDependenceDiagnostics>();
  for (const [sourceId, items] of grouped.entries()) {
    const corroboratedClusterCount = corroboratedCounts.get(sourceId) || 0;
    const independentCorroborationCount = independentCounts.get(sourceId) || 0;
    const dependentCorroborationCount = dependentCounts.get(sourceId) || 0;
    const corroboratedTotal = Math.max(1, corroboratedClusterCount);
    const independentCorroborationSharePct = Number(((independentCorroborationCount / corroboratedTotal) * 100).toFixed(2));
    const dependentCorroborationSharePct = Number(((dependentCorroborationCount / corroboratedTotal) * 100).toFixed(2));
    const peerBucket = peerCounts.get(sourceId) || new Map<string, number>();
    const totalPeerLinks = Array.from(peerBucket.values()).reduce((sum, value) => sum + value, 0);
    const topPeerEntry = Array.from(peerBucket.entries()).sort((a, b) => b[1] - a[1])[0] || null;
    const topPeerSharePct = totalPeerLinks > 0 && topPeerEntry
      ? Number(((topPeerEntry[1] / totalPeerLinks) * 100).toFixed(2))
      : 0;
    const familyBucket = familyPeerCounts.get(sourceId) || new Map<string, number>();
    const topFamilyShare = (() => {
      const total = Array.from(familyBucket.values()).reduce((sum, value) => sum + value, 0);
      const top = Math.max(0, ...Array.from(familyBucket.values()));
      return total > 0 ? top / total : 0;
    })();
    const copyAmplificationRiskScore = boundedScore(
      14
      + dependentCorroborationSharePct * 0.48
      + topPeerSharePct * 0.22
      + topFamilyShare * 18
      + (dependentCorroborationCount >= 4 ? 8 : 0),
      18,
    );
    const leadCount = leadCounts.get(sourceId) || 0;
    const averageLeadMinutes = leadCount > 0
      ? Number(((leadMinutesSum.get(sourceId) || 0) / leadCount).toFixed(2))
      : null;
    const temporalLeadScore = corroboratedClusterCount > 0
      ? boundedScore(
        18
        + (leadCount / corroboratedClusterCount) * 48
        + Math.min(18, (averageLeadMinutes ?? 0) * 0.7),
        24,
      )
      : 24;
    const noveltyScore = noveltyScores.get(sourceId) ?? 28;
    const sourceFamily = getSourceFamily(sourceId, items);
    const notes: string[] = [];
    if (independentCorroborationSharePct >= 55) notes.push('Independent corroboration dominates over copy-style confirmation.');
    if (copyAmplificationRiskScore >= 62) notes.push('Copy amplification risk is elevated across tightly synchronized peers.');
    if (temporalLeadScore >= 62) notes.push('Source often leads peers on corroborated clusters.');
    if (noveltyScore >= 60) notes.push('Source contributes relatively novel title vocabulary versus peers.');

    diagnostics.set(sourceId, {
      sourceId,
      sourceFamily,
      corroboratedClusterCount,
      independentCorroborationCount,
      dependentCorroborationCount,
      independentCorroborationSharePct,
      dependentCorroborationSharePct,
      copyAmplificationRiskScore,
      noveltyScore,
      temporalLeadScore,
      averageLeadMinutes,
      topPeerSource: topPeerEntry?.[0] ?? null,
      topPeerSharePct,
      notes,
    });
  }

  return diagnostics;
}
