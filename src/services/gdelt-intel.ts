import type { Hotspot } from '@/types';
import { t } from '@/services/i18n';
import {
  IntelligenceServiceClient,
  type GdeltArticle as ProtoGdeltArticle,
  type SearchGdeltDocumentsResponse,
} from '@/generated/client/worldmonitor/intelligence/v1/service_client';
import { createCircuitBreaker } from '@/utils';
import { clearProviderCooldown, getProviderCooldownState, setProviderCooldown } from './provider-guard';
import baseGdeltTopics from '../../config/gdelt-topics.json';
import { listGdeltTopics, recordGdeltTopicFetchResult } from './gdelt-topic-registry';

export interface GdeltArticle {
  title: string;
  url: string;
  source: string;
  date: string;
  image?: string;
  language?: string;
  tone?: number;
}

export interface IntelTopic {
  id: string;
  name: string;
  query: string;
  icon: string;
  description: string;
}

export interface TopicIntelligence {
  topic: IntelTopic;
  articles: GdeltArticle[];
  fetchedAt: Date;
}

export const INTEL_TOPICS: IntelTopic[] = (baseGdeltTopics.topics || []).map((topic) => ({
  id: String(topic.id || '').trim(),
  name: String(topic.name || topic.id || '').trim(),
  query: String(topic.query || '').trim(),
  icon: String(topic.icon || 'search').trim(),
  description: String(topic.description || '').trim(),
}));

export const POSITIVE_GDELT_TOPICS: IntelTopic[] = [
  {
    id: 'science-breakthroughs',
    name: 'Science Breakthroughs',
    query: '(breakthrough OR discovery OR "new treatment" OR "clinical trial success") sourcelang:eng',
    icon: 'flask',
    description: 'Scientific discoveries and medical advances',
  },
  {
    id: 'climate-progress',
    name: 'Climate Progress',
    query: '(renewable energy record OR "solar installation" OR "wind farm" OR "emissions decline" OR "green hydrogen") sourcelang:eng',
    icon: 'leaf',
    description: 'Renewable energy milestones and climate wins',
  },
  {
    id: 'conservation-wins',
    name: 'Conservation Wins',
    query: '(species recovery OR "population rebound" OR "conservation success" OR "habitat restored" OR "marine sanctuary") sourcelang:eng',
    icon: 'tree',
    description: 'Wildlife recovery and habitat restoration',
  },
  {
    id: 'humanitarian-progress',
    name: 'Humanitarian Progress',
    query: '(poverty decline OR "literacy rate" OR "vaccination campaign" OR "peace agreement" OR "humanitarian aid") sourcelang:eng',
    icon: 'heart',
    description: 'Poverty reduction, education, and peace',
  },
  {
    id: 'innovation',
    name: 'Innovation',
    query: '("clean technology" OR "AI healthcare" OR "3D printing" OR "electric vehicle" OR "fusion energy") sourcelang:eng',
    icon: 'sparkles',
    description: 'Technology for good and clean innovation',
  },
];

function translateTopic(topic: IntelTopic): IntelTopic {
  return {
    ...topic,
    name: t(`intel.topics.${topic.id}.name`),
    description: t(`intel.topics.${topic.id}.description`),
  };
}

export function getIntelTopics(): IntelTopic[] {
  return INTEL_TOPICS.map((topic) => translateTopic(topic));
}

export async function listIntelTopics(): Promise<IntelTopic[]> {
  const topics = await listGdeltTopics().catch(() => INTEL_TOPICS);
  return topics.map((topic) => translateTopic(topic));
}

function countQueryMatches(topic: IntelTopic, articles: GdeltArticle[]): { matchCount: number; duplicateCount: number } {
  const normalizedTerms = Array.from(new Set(
    String(topic.query || '')
      .replace(/[()"']/g, ' ')
      .split(/\s+OR\s+|\s+/i)
      .map((token) => token.trim().toLowerCase())
      .filter((token) => token.length >= 4 && token !== 'sourcelang:eng'),
  ));
  const seenTitles = new Set<string>();
  let matchCount = 0;
  let duplicateCount = 0;
  for (const article of articles) {
    const title = String(article.title || '').trim().toLowerCase();
    if (seenTitles.has(title)) duplicateCount += 1;
    seenTitles.add(title);
    if (normalizedTerms.some((term) => title.includes(term))) matchCount += 1;
  }
  return { matchCount, duplicateCount };
}

const client = new IntelligenceServiceClient('', { fetch: (...args) => globalThis.fetch(...args) });
const gdeltBreaker = createCircuitBreaker<SearchGdeltDocumentsResponse>({
  name: 'GDELT Intelligence',
  cacheTtlMs: 10 * 60 * 1000,
  persistCache: true,
});
const positiveGdeltBreaker = createCircuitBreaker<SearchGdeltDocumentsResponse>({
  name: 'GDELT Positive',
  cacheTtlMs: 10 * 60 * 1000,
  persistCache: true,
});

const emptyGdeltFallback: SearchGdeltDocumentsResponse = { articles: [], query: '', error: '' };
const CACHE_TTL = 5 * 60 * 1000;
const GDELT_PROVIDER_KEY = 'gdelt';
const GDELT_RATE_LIMIT_COOLDOWN_MS = 20 * 60 * 1000;

const articleCache = new Map<string, { articles: GdeltArticle[]; timestamp: number }>();

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isGdeltRateLimited(): boolean {
  return Boolean(getProviderCooldownState(GDELT_PROVIDER_KEY));
}

function updateGdeltCooldown(error: string): void {
  if (/429|Too Many Requests/i.test(error)) {
    setProviderCooldown(GDELT_PROVIDER_KEY, GDELT_RATE_LIMIT_COOLDOWN_MS, error);
    return;
  }
  clearProviderCooldown(GDELT_PROVIDER_KEY);
}

function toGdeltArticle(article: ProtoGdeltArticle): GdeltArticle {
  return {
    title: article.title,
    url: article.url,
    source: article.source,
    date: article.date,
    image: article.image || undefined,
    language: article.language || undefined,
    tone: article.tone || undefined,
  };
}

export async function fetchGdeltArticles(
  query: string,
  maxrecords = 10,
  timespan = '24h',
): Promise<GdeltArticle[]> {
  const cacheKey = `${query}:${maxrecords}:${timespan}`;
  const cached = articleCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.articles;
  }
  if (isGdeltRateLimited()) {
    return cached?.articles || [];
  }

  const resp = await gdeltBreaker.execute(async () => client.searchGdeltDocuments({
    query,
    maxRecords: maxrecords,
    timespan,
    toneFilter: '',
    sort: '',
  }), emptyGdeltFallback);

  if (resp.error) {
    updateGdeltCooldown(resp.error);
    console.warn(`[GDELT-Intel] RPC error: ${resp.error}`);
    return cached?.articles || [];
  }

  clearProviderCooldown(GDELT_PROVIDER_KEY);
  const articles = (resp.articles || []).map(toGdeltArticle);
  articleCache.set(cacheKey, { articles, timestamp: Date.now() });
  return articles;
}

export async function fetchHotspotContext(hotspot: Hotspot): Promise<GdeltArticle[]> {
  const query = hotspot.keywords.slice(0, 5).join(' OR ');
  return fetchGdeltArticles(query, 8, '48h');
}

export async function fetchTopicIntelligence(topic: IntelTopic): Promise<TopicIntelligence> {
  const articles = await fetchGdeltArticles(topic.query, 10, '24h');
  const stats = countQueryMatches(topic, articles);
  await recordGdeltTopicFetchResult({
    topicId: topic.id,
    resultCount: articles.length,
    matchCount: stats.matchCount,
    duplicateCount: stats.duplicateCount,
  }).catch(() => null);
  return {
    topic,
    articles,
    fetchedAt: new Date(),
  };
}

export async function fetchAllTopicIntelligence(): Promise<TopicIntelligence[]> {
  const results: TopicIntelligence[] = [];
  const topics = await listGdeltTopics({ enabledOnly: true }).catch(() => INTEL_TOPICS);
  for (const topic of topics) {
    try {
      results.push(await fetchTopicIntelligence(topic));
    } catch {
      // Continue on per-topic failures.
    }
    if (isGdeltRateLimited()) break;
    await sleep(750);
  }
  return results;
}

export function formatArticleDate(dateStr: string): string {
  if (!dateStr) return '';
  try {
    const year = dateStr.slice(0, 4);
    const month = dateStr.slice(4, 6);
    const day = dateStr.slice(6, 8);
    const hour = dateStr.slice(9, 11);
    const min = dateStr.slice(11, 13);
    const sec = dateStr.slice(13, 15);
    const date = new Date(`${year}-${month}-${day}T${hour}:${min}:${sec}Z`);
    if (Number.isNaN(date.getTime())) return '';

    const diff = Date.now() - date.getTime();
    if (diff < 0) return 'just now';
    if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
    if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
    return `${Math.floor(diff / 86_400_000)}d ago`;
  } catch {
    return '';
  }
}

export function extractDomain(url: string): string {
  try {
    return new URL(url).hostname.replace('www.', '');
  } catch {
    return '';
  }
}

export async function fetchPositiveGdeltArticles(
  query: string,
  toneFilter = 'tone>5',
  sort = 'ToneDesc',
  maxrecords = 15,
  timespan = '72h',
): Promise<GdeltArticle[]> {
  const cacheKey = `positive:${query}:${toneFilter}:${sort}:${maxrecords}:${timespan}`;
  const cached = articleCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.articles;
  }
  if (isGdeltRateLimited()) {
    return cached?.articles || [];
  }

  const resp = await positiveGdeltBreaker.execute(async () => client.searchGdeltDocuments({
    query,
    maxRecords: maxrecords,
    timespan,
    toneFilter,
    sort,
  }), emptyGdeltFallback);

  if (resp.error) {
    updateGdeltCooldown(resp.error);
    console.warn(`[GDELT-Intel] Positive RPC error: ${resp.error}`);
    return cached?.articles || [];
  }

  clearProviderCooldown(GDELT_PROVIDER_KEY);
  const articles = (resp.articles || []).map(toGdeltArticle);
  articleCache.set(cacheKey, { articles, timestamp: Date.now() });
  return articles;
}

export async function fetchPositiveTopicIntelligence(topic: IntelTopic): Promise<TopicIntelligence> {
  const articles = await fetchPositiveGdeltArticles(topic.query);
  return { topic, articles, fetchedAt: new Date() };
}

export async function fetchAllPositiveTopicIntelligence(): Promise<TopicIntelligence[]> {
  const results: TopicIntelligence[] = [];
  for (const topic of POSITIVE_GDELT_TOPICS) {
    try {
      results.push(await fetchPositiveTopicIntelligence(topic));
    } catch {
      // Continue on per-topic failures.
    }
    if (isGdeltRateLimited()) break;
    await sleep(750);
  }
  return results;
}
