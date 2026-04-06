import baseConfig from '../../config/gdelt-topics.json';

import { getPersistentCache, setPersistentCache } from './persistent-cache';
import { listKeywordRegistry, type KeywordRecord } from './keyword-registry';

export interface GdeltTopicStats {
  avgResults: number;
  matchRate: number;
  duplicateRate: number;
  zeroResultStreak: number;
  lastActiveAt: string | null;
}

export interface GdeltTopicRecord {
  id: string;
  name: string;
  query: string;
  icon: string;
  description: string;
  enabled: boolean;
  priority: number;
  lastUpdatedAt: string;
  source: 'manual' | 'auto';
  stats: GdeltTopicStats;
}

interface PersistedGdeltTopicRegistry {
  topics: GdeltTopicRecord[];
}

const GDELT_TOPIC_REGISTRY_KEY = 'gdelt-topic-registry:v1';

const DEFAULT_STATS: GdeltTopicStats = {
  avgResults: 0,
  matchRate: 0,
  duplicateRate: 0,
  zeroResultStreak: 0,
  lastActiveAt: null,
};

function normalizeTopic(input: Partial<GdeltTopicRecord> | Record<string, unknown>): GdeltTopicRecord {
  const record = input as Partial<GdeltTopicRecord> & Record<string, unknown>;
  return {
    id: String(record.id || '').trim(),
    name: String(record.name || record.id || '').trim(),
    query: String(record.query || '').trim(),
    icon: String(record.icon || 'search').trim(),
    description: String(record.description || '').trim(),
    enabled: Boolean(record.enabled ?? true),
    priority: Math.max(0, Math.min(1000, Math.round(Number(record.priority) || 0))),
    lastUpdatedAt: String(record.lastUpdatedAt || new Date().toISOString()),
    source: record.source === 'auto' ? 'auto' : 'manual',
    stats: {
      ...DEFAULT_STATS,
      ...(record.stats as Partial<GdeltTopicStats> | undefined),
    },
  };
}

async function loadRegistry(): Promise<Map<string, GdeltTopicRecord>> {
  const cached = await getPersistentCache<PersistedGdeltTopicRegistry>(GDELT_TOPIC_REGISTRY_KEY);
  const registry = new Map<string, GdeltTopicRecord>();
  for (const topic of (baseConfig.topics || []).map((item) => normalizeTopic(item))) {
    registry.set(topic.id, topic);
  }
  for (const topic of cached?.data?.topics || []) {
    registry.set(topic.id, normalizeTopic(topic));
  }
  return registry;
}

async function persistRegistry(registry: Map<string, GdeltTopicRecord>): Promise<void> {
  await setPersistentCache(GDELT_TOPIC_REGISTRY_KEY, {
    topics: Array.from(registry.values()).sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id)),
  } satisfies PersistedGdeltTopicRegistry);
}

export async function listGdeltTopics(options: { enabledOnly?: boolean } = {}): Promise<GdeltTopicRecord[]> {
  const registry = await loadRegistry();
  const topics = Array.from(registry.values())
    .filter((topic) => !options.enabledOnly || topic.enabled)
    .sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id));
  return topics;
}

function buildAutoTopicQuery(keyword: KeywordRecord): string {
  return `("${keyword.term}" OR "${keyword.canonicalName}") sourcelang:eng`;
}

export async function proposeGdeltTopicsFromKeywords(): Promise<GdeltTopicRecord[]> {
  const registry = await loadRegistry();
  const keywords = await listKeywordRegistry();
  const candidates = keywords
    .filter((keyword) => keyword.confidence >= 80)
    .filter((keyword) => ['defense', 'energy', 'macro'].includes(keyword.domain))
    .sort((a, b) => b.decayScore - a.decayScore || b.confidence - a.confidence)
    .slice(0, 24);

  const created: GdeltTopicRecord[] = [];
  for (const keyword of candidates) {
    const query = buildAutoTopicQuery(keyword);
    const exists = Array.from(registry.values()).some((topic) => topic.query.toLowerCase().includes(keyword.term.toLowerCase()));
    if (exists) continue;
    const id = `auto-${keyword.term.replace(/\s+/g, '-').slice(0, 48)}`;
    const record = normalizeTopic({
      id,
      name: keyword.canonicalName || keyword.term,
      query,
      icon: 'spark',
      description: `Auto-proposed from keyword registry: ${keyword.term}`,
      enabled: keyword.confidence >= 92,
      priority: 40 + keyword.confidence,
      lastUpdatedAt: new Date().toISOString(),
      source: 'auto',
      stats: DEFAULT_STATS,
    });
    registry.set(record.id, record);
    created.push(record);
  }

  if (created.length > 0) {
    await persistRegistry(registry);
  }
  return created;
}

export async function recordGdeltTopicFetchResult(args: {
  topicId: string;
  resultCount: number;
  matchCount: number;
  duplicateCount: number;
}): Promise<GdeltTopicRecord | null> {
  const registry = await loadRegistry();
  const topic = registry.get(args.topicId);
  if (!topic) return null;
  const nextStats: GdeltTopicStats = {
    avgResults: Number(((topic.stats.avgResults * 0.8) + (args.resultCount * 0.2)).toFixed(2)),
    matchRate: Number(((topic.stats.matchRate * 0.8) + ((args.matchCount / Math.max(1, args.resultCount)) * 100 * 0.2)).toFixed(2)),
    duplicateRate: Number(((topic.stats.duplicateRate * 0.8) + ((args.duplicateCount / Math.max(1, args.resultCount)) * 100 * 0.2)).toFixed(2)),
    zeroResultStreak: args.resultCount === 0 ? topic.stats.zeroResultStreak + 1 : 0,
    lastActiveAt: args.resultCount > 0 ? new Date().toISOString() : topic.stats.lastActiveAt,
  };
  const updated: GdeltTopicRecord = {
    ...topic,
    enabled: nextStats.zeroResultStreak >= 3 ? false : topic.enabled,
    stats: nextStats,
    lastUpdatedAt: new Date().toISOString(),
  };
  registry.set(updated.id, updated);
  await persistRegistry(registry);
  return updated;
}
