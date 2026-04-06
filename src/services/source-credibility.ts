import type { ClusteredEvent, NewsItem } from '@/types';
import { estimateDirectionalFlowSummary, type TimedFlowPoint } from './information-flow';
import { getPersistentCache, setPersistentCache } from './persistent-cache';
import { listSourceRegistrySnapshot } from './source-registry';
import { logSourceOpsEvent } from './source-ops-log';
import { runTruthDiscovery, type TruthClaim, type TruthDiscoveryResult } from './math-models/truth-discovery';
import { buildSourceDependenceDiagnostics } from './source-dependence';

// Lazy worker pool for truth discovery offloading
interface TruthWorkerReq { claims: TruthClaim[]; options: Parameters<typeof runTruthDiscovery>[1] }
type NodeWorkerPoolLike<Req, Res> = {
  exec: (payload: Req, timeoutMs?: number) => Promise<Res>;
};

let truthWorkerPool: NodeWorkerPoolLike<TruthWorkerReq, TruthDiscoveryResult> | null = null;

async function getTruthWorkerPool(): Promise<NodeWorkerPoolLike<TruthWorkerReq, TruthDiscoveryResult>> {
  if (!truthWorkerPool) {
    if (typeof window !== 'undefined') {
      throw new Error('node worker pool unavailable in browser runtime');
    }
    const modulePath = '../utils/node-worker-pool';
    const { NodeWorkerPool } = await import(/* @vite-ignore */ modulePath);
    const workerPath = new URL('./math-models/truth-discovery.worker.ts', import.meta.url);
    truthWorkerPool = new NodeWorkerPool(workerPath, { size: 2, name: 'truth-discovery' });
  }
  return truthWorkerPool!;
}

async function runTruthDiscoveryAsync(
  claims: TruthClaim[],
  options: Parameters<typeof runTruthDiscovery>[1],
): Promise<TruthDiscoveryResult> {
  // For small inputs, run synchronously to avoid serialization overhead
  if (claims.length < 10) return runTruthDiscovery(claims, options);
  try {
    const pool = await getTruthWorkerPool();
    return await pool.exec({ claims, options }, 15_000);
  } catch {
    // Fallback to sync on worker failure
    return runTruthDiscovery(claims, options);
  }
}

export interface SourceCredibilityProfile {
  id: string;
  source: string;
  domain: string;
  credibilityScore: number;
  corroborationScore: number;
  historicalAccuracyScore: number;
  posteriorAccuracyScore: number;
  truthAgreementScore: number;
  emReliabilityScore: number;
  posteriorAlpha: number;
  posteriorBeta: number;
  feedHealthScore: number;
  propagandaRiskScore: number;
  linguisticRiskScore: number;
  networkCoordinationRiskScore: number;
  independentCorroborationScore?: number;
  dependentCorroborationScore?: number;
  copyAmplificationRiskScore?: number;
  dependenceTrustScore?: number;
  sourceNoveltyScore?: number;
  temporalLeadScore?: number;
  averageLeadMinutes?: number | null;
  topPeerSource?: string | null;
  sourceFamily?: string;
  articleCount: number;
  corroboratedClusterCount: number;
  highImpactCount: number;
  directionalFlowScore?: number;
  leadLagScore?: number;
  flowDirection?: 'source-leading' | 'target-leading' | 'neutral';
  flowLagHours?: number;
  flowSampleSize?: number;
  lastSeenAt: number | null;
  lastEvaluatedAt: number;
  notes: string[];
}

interface PersistedSourceCredibility {
  profiles: SourceCredibilityProfile[];
}

const SOURCE_CREDIBILITY_KEY = 'source-credibility:v1';
const MAX_PROFILES = 400;
const POSTERIOR_DECAY = 0.985;
const QUICK_SYNC_WINDOW_MS = 15 * 60 * 1000;
const TOPIC_TOKEN_LIMIT = 18;

const HIGH_RISK_SOURCE_HINTS = [
  'tass',
  'xinhua',
  'global times',
  'press tv',
  'rt ',
  'sputnik',
];

let loaded = false;
const profiles = new Map<string, SourceCredibilityProfile>();

function nowMs(): number {
  return Date.now();
}

function normalizeSource(value: string): string {
  return String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function getDomainFromLink(link: string): string {
  try {
    return new URL(link).hostname.toLowerCase();
  } catch {
    return '';
  }
}

async function ensureLoaded(): Promise<void> {
  if (loaded) return;
  loaded = true;
  try {
    const cached = await getPersistentCache<PersistedSourceCredibility>(SOURCE_CREDIBILITY_KEY);
    for (const item of cached?.data?.profiles ?? []) {
      profiles.set(item.id, item);
    }
  } catch (error) {
    console.warn('[source-credibility] load failed', error);
  }
}

async function persist(): Promise<void> {
  await setPersistentCache(SOURCE_CREDIBILITY_KEY, {
    profiles: Array.from(profiles.values())
      .sort((a, b) => b.lastEvaluatedAt - a.lastEvaluatedAt || b.credibilityScore - a.credibilityScore)
      .slice(0, MAX_PROFILES),
  });
}

function threatWeight(level: string | undefined | null): number {
  const normalized = String(level || '').toLowerCase();
  if (normalized === 'critical') return 3.2;
  if (normalized === 'high') return 2.2;
  if (normalized === 'medium') return 1.5;
  return 1;
}

function propagandaRisk(source: string, domain: string): number {
  const text = `${normalizeSource(source)} ${domain}`;
  if (HIGH_RISK_SOURCE_HINTS.some((hint) => text.includes(hint))) return 82;
  return 18;
}

const TOPIC_STOPWORDS = new Set([
  'the', 'and', 'for', 'with', 'from', 'amid', 'into', 'after', 'over', 'near', 'says', 'say',
  'warns', 'warn', 'live', 'update', 'updates', 'latest', 'breaking', 'about', 'against', 'through',
  'will', 'this', 'that', 'have', 'more', 'than', 'their', 'its', 'into', 'under', 'over',
]);

const EXTREME_TITLE_RE = /\b(apocalyptic|catastrophic|obliterated|annihilat(?:ed|ion)|panic|bloodbath|stunning|shocking|chaos|devastating|doomsday|collapse|meltdown)\b/i;

function boundedScore(value: number, fallback = 0): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(0, Math.min(100, Math.round(value)));
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function tokenize(value: string): string[] {
  return Array.from(
    new Set(
      normalizeSource(value)
        .split(' ')
        .filter((token) => token.length >= 3 && !TOPIC_STOPWORDS.has(token)),
    ),
  ).slice(0, 48);
}

function overlapCount(left: string[], right: Iterable<string>): number {
  const rightSet = right instanceof Set ? right : new Set(right);
  let count = 0;
  for (const token of left) {
    if (rightSet.has(token)) count += 1;
  }
  return count;
}

function computeLinguisticRisk(items: NewsItem[]): number {
  if (!items.length) return 18;
  let extremeTitles = 0;
  let punctuationWeight = 0;
  let capsWeight = 0;
  let volatilityAccumulator = 0;
  for (const item of items) {
    const title = String(item.title || '').trim();
    if (!title) continue;
    if (EXTREME_TITLE_RE.test(title)) extremeTitles += 1;
    const exclamations = (title.match(/!+/g) || []).join('').length;
    const questionMarks = (title.match(/\?+/g) || []).join('').length;
    punctuationWeight += Math.min(3, exclamations + questionMarks);
    const letters = title.replace(/[^A-Za-z]/g, '');
    const capsRatio = letters.length > 0 ? letters.replace(/[^A-Z]/g, '').length / letters.length : 0;
    capsWeight += capsRatio;
    const intensity = (EXTREME_TITLE_RE.test(title) ? 1 : 0) + Math.min(1, exclamations * 0.25) + Math.min(1, capsRatio * 2);
    volatilityAccumulator += intensity;
  }

  const total = Math.max(items.length, 1);
  const extremeRatio = extremeTitles / total;
  const punctuationRatio = punctuationWeight / total;
  const capsRatio = capsWeight / total;
  const volatility = volatilityAccumulator / total;
  return boundedScore(
    16
    + extremeRatio * 42
    + punctuationRatio * 11
    + capsRatio * 24
    + volatility * 14,
    18,
  );
}

function toTimestamp(value: Date | string | number | null | undefined): number | null {
  if (value == null) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const ts = value instanceof Date ? value.getTime() : Date.parse(String(value));
  return Number.isFinite(ts) ? ts : null;
}

function threatIntensity(item: NewsItem): number {
  const weight = threatWeight(item.threat?.level);
  return weight + (item.isAlert ? 1.6 : 0.8);
}

function buildSourceFlowPoints(items: NewsItem[]): TimedFlowPoint[] {
  return items
    .map((item) => ({
      at: item.pubDate,
      value: threatIntensity(item),
      weight: 1 + Math.min(2.5, Math.log1p(threatWeight(item.threat?.level)) * 0.35),
    }))
    .filter((point) => toTimestamp(point.at) != null);
}

function buildClusterFlowPoints(sourceId: string, clusters: ClusteredEvent[]): TimedFlowPoint[] {
  const normalizedSource = normalizeSource(sourceId);
  const points: TimedFlowPoint[] = [];
  for (const cluster of clusters.slice(0, 120)) {
    const sourceMatch = normalizeSource(cluster.primarySource || '') === normalizedSource
      || (cluster.allItems || []).some((item) => normalizeSource(item.source || '') === normalizedSource);
    if (!sourceMatch) continue;
    const timestamp = cluster.lastUpdated || cluster.firstSeen;
    const ts = toTimestamp(timestamp);
    if (ts == null) continue;
    points.push({
      at: ts,
      value: 1 + cluster.sourceCount * 0.45 + (cluster.isAlert ? 1.2 : 0) + Math.min(2, (cluster.relations?.confidenceScore || 0) / 60),
      weight: 1 + Math.min(1.8, (cluster.relations?.confidenceScore || 0) / 80),
    });
  }
  return points;
}

function buildSourceTopicProfiles(grouped: Map<string, NewsItem[]>): Map<string, Set<string>> {
  const profiles = new Map<string, Set<string>>();
  for (const [sourceId, items] of grouped.entries()) {
    const counts = new Map<string, number>();
    for (const item of items.slice(0, 40)) {
      for (const token of tokenize(item.title)) {
        counts.set(token, (counts.get(token) || 0) + 1);
      }
    }
    const topTokens = Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, TOPIC_TOKEN_LIMIT)
      .map(([token]) => token);
    profiles.set(sourceId, new Set(topTokens));
  }
  return profiles;
}

function buildCoordinationRiskMap(clusters: ClusteredEvent[]): Map<string, number> {
  const quickSyncCounts = new Map<string, number>();
  const peerCounts = new Map<string, Map<string, number>>();
  const spreadSums = new Map<string, number>();
  const spreadCounts = new Map<string, number>();
  const corroboratedCounts = new Map<string, number>();

  for (const cluster of clusters.slice(0, 90)) {
    const groupedBySource = new Map<string, number>();
    for (const item of cluster.allItems || []) {
      const sourceId = normalizeSource(item.source || '');
      if (!sourceId) continue;
      const ts = item.pubDate instanceof Date ? item.pubDate.getTime() : new Date(item.pubDate).getTime();
      if (!Number.isFinite(ts)) continue;
      const previous = groupedBySource.get(sourceId);
      if (previous == null || ts < previous) groupedBySource.set(sourceId, ts);
    }
    const entries = Array.from(groupedBySource.entries());
    if (entries.length < 2) continue;

    for (const [sourceId] of entries) {
      corroboratedCounts.set(sourceId, (corroboratedCounts.get(sourceId) || 0) + 1);
    }

    const sorted = entries.slice().sort((a, b) => a[1] - b[1]);
    const spreadMs = sorted[sorted.length - 1]![1] - sorted[0]![1];
    const isQuickSync = spreadMs <= QUICK_SYNC_WINDOW_MS;

    for (let index = 0; index < sorted.length; index += 1) {
      const [sourceId, ts] = sorted[index]!;
      spreadSums.set(sourceId, (spreadSums.get(sourceId) || 0) + spreadMs / 60000);
      spreadCounts.set(sourceId, (spreadCounts.get(sourceId) || 0) + 1);
      if (!isQuickSync) continue;
      quickSyncCounts.set(sourceId, (quickSyncCounts.get(sourceId) || 0) + 1);
      const peerBucket = peerCounts.get(sourceId) || new Map<string, number>();
      for (let j = 0; j < sorted.length; j += 1) {
        if (j === index) continue;
        const [peerId, peerTs] = sorted[j]!;
        if (Math.abs(peerTs - ts) > QUICK_SYNC_WINDOW_MS) continue;
        peerBucket.set(peerId, (peerBucket.get(peerId) || 0) + 1);
      }
      peerCounts.set(sourceId, peerBucket);
    }
  }

  const risks = new Map<string, number>();
  for (const [sourceId, corroborated] of corroboratedCounts.entries()) {
    const quickSync = quickSyncCounts.get(sourceId) || 0;
    const peerBucket = peerCounts.get(sourceId) || new Map<string, number>();
    const totalPeerLinks = Array.from(peerBucket.values()).reduce((sum, value) => sum + value, 0);
    const topPeerLinks = Math.max(0, ...Array.from(peerBucket.values()));
    const quickSyncRatio = corroborated > 0 ? quickSync / corroborated : 0;
    const peerConcentration = totalPeerLinks > 0 ? topPeerLinks / totalPeerLinks : 0;
    const avgSpread = (spreadSums.get(sourceId) || 0) / Math.max(spreadCounts.get(sourceId) || 1, 1);
    const spreadPenalty = Math.max(0, (15 - Math.min(15, avgSpread)) / 15);
    risks.set(
      sourceId,
      boundedScore(
        18
        + quickSyncRatio * 46
        + peerConcentration * 28
        + spreadPenalty * 14
        + (quickSync >= 3 ? 8 : 0),
        18,
      ),
    );
  }
  return risks;
}

function buildTruthClaims(
  clusters: ClusteredEvent[],
  grouped: Map<string, NewsItem[]>,
  topicProfiles: Map<string, Set<string>>,
): TruthClaim[] {
  const activeSources = Array.from(grouped.keys());
  const claims: TruthClaim[] = [];
  for (const cluster of clusters.slice(0, 72)) {
    const observedSources = new Set(
      (cluster.allItems || [])
        .map((item) => normalizeSource(item.source || ''))
        .filter(Boolean),
    );
    if (observedSources.size < 2) continue;

    const clusterTokens = tokenize([
      cluster.primaryTitle,
      ...(cluster.relations?.evidence || []),
      cluster.primarySource || '',
    ].join(' '));
    const candidateSources = activeSources.filter((sourceId) => {
      if (observedSources.has(sourceId)) return true;
      const topicProfile = topicProfiles.get(sourceId);
      return topicProfile ? overlapCount(clusterTokens, topicProfile) >= 2 : false;
    });
    if (candidateSources.length < 2) continue;

    claims.push({
      id: cluster.id || normalizeSource(cluster.primaryTitle),
      prior: Math.max(0.14, Math.min(0.94, 0.24 + cluster.sourceCount * 0.12 + (cluster.isAlert ? 0.16 : 0))),
      observations: candidateSources.map((sourceId) => ({
        sourceId,
        value: observedSources.has(sourceId) ? 1 : 0,
        timestamp: cluster.lastUpdated || cluster.firstSeen || null,
        weight: 1 + Math.min(1.5, cluster.sourceCount * 0.08) + (cluster.isAlert ? 0.2 : 0),
      })),
    });
  }
  return claims;
}

export async function recomputeSourceCredibility(
  news: NewsItem[],
  clusters: ClusteredEvent[],
  options?: { skipPersist?: boolean },
): Promise<SourceCredibilityProfile[]> {
  await ensureLoaded();
  const registry = await listSourceRegistrySnapshot().catch(() => null);
  const grouped = new Map<string, NewsItem[]>();

  for (const item of news) {
    const source = String(item.source || '').trim();
    if (!source) continue;
    const key = normalizeSource(source);
    const bucket = grouped.get(key) || [];
    bucket.push(item);
    grouped.set(key, bucket);
  }

  const topicProfiles = buildSourceTopicProfiles(grouped);
  const coordinationRiskMap = buildCoordinationRiskMap(clusters);
  const dependenceDiagnostics = buildSourceDependenceDiagnostics(clusters, grouped);
  const truthClaims = buildTruthClaims(clusters, grouped, topicProfiles);
  const truthDiscovery = await runTruthDiscoveryAsync(
    truthClaims,
    {
      iterations: 12,
      timeDecayLambda: 0.06,
      convergenceEpsilon: 1e-4,
      seedReliability: Object.fromEntries(
        Array.from(profiles.entries()).map(([id, profile]) => [id, Math.max(0.52, (profile.posteriorAccuracyScore || 55) / 100)]),
      ),
    },
  );

  const nextProfiles: SourceCredibilityProfile[] = [];
  for (const [normalizedSource, items] of grouped.entries()) {
    const source = items[0]?.source?.trim() || normalizedSource;
    const domain = items.find((item) => item.link)?.link ? getDomainFromLink(items[0]!.link) : '';
    const articleCount = items.length;
    const highImpactCount = items.filter((item) => threatWeight(item.threat?.level) >= 2.2 || item.isAlert).length;
    const lastSeenAt = items.reduce<number | null>((acc, item) => {
      const ts = item.pubDate instanceof Date ? item.pubDate.getTime() : new Date(item.pubDate).getTime();
      if (!Number.isFinite(ts)) return acc;
      return acc == null ? ts : Math.max(acc, ts);
    }, null);

    const corroboratedClusterCount = clusters.filter((cluster) => {
      const sourceMatch = normalizeSource(cluster.primarySource || '') === normalizedSource;
      if (sourceMatch && cluster.sourceCount > 1) return true;
      return items.some((item) => item.title && cluster.primaryTitle && item.title === cluster.primaryTitle && cluster.sourceCount > 1);
    }).length;

    const flow = estimateDirectionalFlowSummary(
      buildSourceFlowPoints(items),
      buildClusterFlowPoints(normalizedSource, clusters),
      { bucketMs: 12 * 60 * 60 * 1000, maxLag: 4, minBuckets: 8 },
    );
    const flowBonus = clamp(
      Math.round(
        Math.max(0, flow.flowScore - 52) * 0.16
        + Math.max(0, flow.leadLagScore) * 0.03
        + Math.max(0, flow.supportScore - 58) * 0.08,
      ),
      0,
      12,
    );

    const corroborationScore = boundedScore(
      18
      + Math.min(52, corroboratedClusterCount * 12)
      + Math.min(22, Math.log10(articleCount + 1) * 20)
      + Math.min(12, highImpactCount * 2),
      30,
    );

    const previous = profiles.get(normalizedSource);
    const dependence = dependenceDiagnostics.get(normalizedSource);
    const priorCredibility = previous?.credibilityScore ?? 55;
    const priorAccuracy = previous?.historicalAccuracyScore ?? 55;
    const pseudoSuccess = corroboratedClusterCount + Math.min(4, highImpactCount * 0.35) + Math.min(2, articleCount * 0.08);
    const pseudoFailure = Math.max(0, articleCount - corroboratedClusterCount - Math.min(3, highImpactCount * 0.25));
    const posteriorAlpha = (previous?.posteriorAlpha ?? 1) * POSTERIOR_DECAY + pseudoSuccess;
    const posteriorBeta = (previous?.posteriorBeta ?? 1) * POSTERIOR_DECAY + pseudoFailure;
    const posteriorAccuracyScore = boundedScore((posteriorAlpha / Math.max(posteriorAlpha + posteriorBeta, 1e-6)) * 100, 55);
    const emStats = truthDiscovery.sourceStats[normalizedSource];
    const truthAgreementScore = boundedScore(emStats?.truthAgreement ?? previous?.truthAgreementScore ?? 55, 55);
    const emReliabilityScore = boundedScore(emStats?.reliability ?? previous?.emReliabilityScore ?? 55, 55);
    const historicalAccuracyScore = boundedScore(
      priorAccuracy * 0.55
      + corroborationScore * 0.25
      + Math.min(20, articleCount * 0.9)
      + Math.min(12, highImpactCount * 1.5)
      + Math.min(10, (previous?.corroboratedClusterCount ?? 0) * 0.6),
      55,
    );

    const healthMatches = (registry?.records || []).filter((record) => {
      const recordName = normalizeSource(record.feedName);
      return recordName.includes(normalizedSource) || normalizedSource.includes(recordName);
    });
    const discoveredMatches = (registry?.discoveredSources || []).filter((record) => {
      const feedName = normalizeSource(record.feedName);
      return feedName.includes(normalizedSource)
        || normalizedSource.includes(feedName)
        || (domain && record.domain === domain);
    });

    const feedHealthScore = healthMatches.length > 0
      ? boundedScore(
        healthMatches.reduce((sum, record) => {
          if (record.status === 'healthy') return sum + 92;
          if (record.status === 'degraded') return sum + 54;
          return sum + 38;
        }, 0) / healthMatches.length,
        60,
      )
      : discoveredMatches.length > 0
        ? boundedScore(
          discoveredMatches.reduce((sum, record) => {
            if (record.status === 'active') return sum + 88;
            if (record.status === 'approved') return sum + 72;
            if (record.status === 'draft') return sum + 58;
            return sum + 30;
          }, 0) / discoveredMatches.length,
          58,
        )
        : 60;

    const linguisticRiskScore = computeLinguisticRisk(items);
    const networkCoordinationRiskScore = coordinationRiskMap.get(normalizedSource) ?? previous?.networkCoordinationRiskScore ?? 18;
    const basePropagandaRisk = propagandaRisk(source, domain);
    const independentCorroborationScore = boundedScore(
      dependence?.independentCorroborationSharePct ?? previous?.independentCorroborationScore ?? 45,
      45,
    );
    const dependentCorroborationScore = boundedScore(
      dependence?.dependentCorroborationSharePct ?? previous?.dependentCorroborationScore ?? 55,
      55,
    );
    const copyAmplificationRiskScore = boundedScore(
      dependence?.copyAmplificationRiskScore ?? previous?.copyAmplificationRiskScore ?? 32,
      32,
    );
    const sourceNoveltyScore = boundedScore(
      dependence?.noveltyScore ?? previous?.sourceNoveltyScore ?? 36,
      36,
    );
    const temporalLeadScore = boundedScore(
      dependence?.temporalLeadScore ?? previous?.temporalLeadScore ?? 34,
      34,
    );
    const dependenceTrustScore = boundedScore(
      22
      + independentCorroborationScore * 0.30
      + sourceNoveltyScore * 0.16
      + temporalLeadScore * 0.14
      + Math.max(0, 100 - copyAmplificationRiskScore) * 0.24
      + Math.max(0, 100 - dependentCorroborationScore) * 0.08
      + Math.max(0, 100 - networkCoordinationRiskScore) * 0.06,
      48,
    );
    const propagandaRiskScore = boundedScore(
      basePropagandaRisk * 0.34
      + networkCoordinationRiskScore * 0.34
      + linguisticRiskScore * 0.18
      + copyAmplificationRiskScore * 0.10
      + Math.max(0, 60 - dependenceTrustScore) * 0.04
      + Math.max(0, 65 - truthAgreementScore) * 0.14,
      basePropagandaRisk,
    );
    const corrDiscount = copyAmplificationRiskScore > 60
      ? clamp((copyAmplificationRiskScore - 60) / 80, 0, 0.4)
      : 0;
    const adjustedCorrScore = corroborationScore * (1 - corrDiscount);
    const baseCredibility = boundedScore(
      adjustedCorrScore * 0.22
      + historicalAccuracyScore * 0.12
      + posteriorAccuracyScore * 0.10
      + truthAgreementScore * 0.12
      + emReliabilityScore * 0.12
      + feedHealthScore * 0.12
      + (100 - propagandaRiskScore) * 0.10,
      priorCredibility,
    );
    const credibilityScore = boundedScore(
      baseCredibility
      + flowBonus,
      priorCredibility,
    );

    const notes: string[] = [];
    if (corroboratedClusterCount >= 3) notes.push('Multi-source corroboration strong');
    if (feedHealthScore < 60) notes.push('Feed health degraded or under investigation');
    if (highImpactCount >= 4) notes.push('High share of high-impact coverage');
    if (propagandaRiskScore >= 70) notes.push('Propaganda/state-media risk elevated');
    if (networkCoordinationRiskScore >= 60) notes.push('Coordination network risk elevated');
    if (linguisticRiskScore >= 58) notes.push('Title language shows elevated sensationalism');
    if (emReliabilityScore >= 70) notes.push('EM truth discovery rates source as above baseline');
    if (articleCount >= 12) notes.push('High article volume in current snapshot');
    if (flow.direction === 'source-leading' && flow.flowScore >= 60) notes.push('Directional lead-lag support observed');
    if ((dependence?.independentCorroborationSharePct ?? 0) >= 55) {
      notes.push(`Independent corroboration ${Math.round(dependence!.independentCorroborationSharePct)}% of corroborated clusters.`);
    }
    if ((dependence?.copyAmplificationRiskScore ?? 0) >= 62) {
      notes.push(`Copy amplification risk ${dependence!.copyAmplificationRiskScore}; peer sync dominates corroboration.`);
    }
    if (dependenceTrustScore >= 62) {
      notes.push(`Dependence-adjusted trust ${dependenceTrustScore}; corroboration quality remains resilient after copy-risk discounting.`);
    }
    if (dependenceTrustScore <= 42) {
      notes.push(`Dependence-adjusted trust ${dependenceTrustScore}; corroboration is weak after dependence discounting.`);
    }
    if ((dependence?.noveltyScore ?? 0) >= 60) {
      notes.push(`Novelty score ${dependence!.noveltyScore}; source vocabulary is less derivative than peers.`);
    }
    if ((dependence?.temporalLeadScore ?? 0) >= 62 && dependence?.averageLeadMinutes != null) {
      notes.push(`Lead signal score ${dependence.temporalLeadScore}; average lead ${dependence.averageLeadMinutes.toFixed(1)} minutes.`);
    }
    for (const note of dependence?.notes || []) {
      if (!notes.includes(note)) notes.push(note);
    }

    nextProfiles.push({
      id: normalizedSource,
      source,
      domain,
      credibilityScore,
      corroborationScore,
      historicalAccuracyScore,
      posteriorAccuracyScore,
      truthAgreementScore,
      emReliabilityScore,
      posteriorAlpha: Number(posteriorAlpha.toFixed(3)),
      posteriorBeta: Number(posteriorBeta.toFixed(3)),
      feedHealthScore,
      propagandaRiskScore,
      linguisticRiskScore,
      networkCoordinationRiskScore,
      independentCorroborationScore,
      dependentCorroborationScore,
      copyAmplificationRiskScore,
      dependenceTrustScore,
      sourceNoveltyScore,
      temporalLeadScore,
      averageLeadMinutes: dependence?.averageLeadMinutes ?? previous?.averageLeadMinutes ?? null,
      topPeerSource: dependence?.topPeerSource ?? previous?.topPeerSource ?? null,
      sourceFamily: dependence?.sourceFamily ?? previous?.sourceFamily ?? undefined,
      articleCount,
      corroboratedClusterCount,
      highImpactCount,
      directionalFlowScore: Number(flow.flowScore.toFixed(2)),
      leadLagScore: Number(flow.leadLagScore.toFixed(2)),
      flowDirection: flow.direction,
      flowLagHours: Number(flow.bestLagHours.toFixed(2)),
      flowSampleSize: flow.sampleSize,
      lastSeenAt,
      lastEvaluatedAt: nowMs(),
      notes,
    });
  }

  nextProfiles.sort((a, b) => b.credibilityScore - a.credibilityScore || b.articleCount - a.articleCount);
  for (const profile of nextProfiles) {
    profiles.set(profile.id, profile);
  }
  if (!options?.skipPersist) await persist();
  await logSourceOpsEvent({
    kind: 'credibility',
    action: 'recomputed',
    actor: 'system',
    title: 'Source credibility profiles updated',
    detail: `profiles=${nextProfiles.length}`,
    status: 'ok',
    category: 'source-credibility',
  });
  return nextProfiles;
}

/**
 * Batch mode: compute source credibility from ALL news/clusters at once.
 * Single Truth Discovery EM run on full dataset → better convergence than per-frame.
 */
export async function batchComputeSourceCredibility(
  allNews: NewsItem[],
  allClusters: ClusteredEvent[],
): Promise<SourceCredibilityProfile[]> {
  return recomputeSourceCredibility(allNews, allClusters, { skipPersist: true });
}

export async function listSourceCredibilityProfiles(limit = 60): Promise<SourceCredibilityProfile[]> {
  await ensureLoaded();
  return Array.from(profiles.values())
    .sort((a, b) => b.credibilityScore - a.credibilityScore || b.articleCount - a.articleCount)
    .slice(0, Math.max(1, limit));
}

export async function exportSourceCredibilityState(): Promise<SourceCredibilityProfile[]> {
  await ensureLoaded();
  return Array.from(profiles.values())
    .map((profile) => ({ ...profile, notes: profile.notes.slice() }))
    .sort((a, b) => b.lastEvaluatedAt - a.lastEvaluatedAt || b.credibilityScore - a.credibilityScore);
}

export async function resetSourceCredibilityState(seed: SourceCredibilityProfile[] = []): Promise<void> {
  await ensureLoaded();
  profiles.clear();
  for (const profile of seed) {
    if (!profile?.id) continue;
    profiles.set(profile.id, { ...profile, notes: Array.isArray(profile.notes) ? profile.notes.slice() : [] });
  }
  await persist();
}
