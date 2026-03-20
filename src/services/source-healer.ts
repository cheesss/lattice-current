import { fetchWithProxy } from '@/utils';
import { FEEDS } from '@/config/feeds';
import { canUseLocalAgentEndpoints, hasLocalAgentEndpointSupport } from './runtime';
import { claimNextInvestigationTask, completeInvestigationTask, enqueueSourceInvestigation } from './source-investigation-queue';
import {
  addDiscoveredSource,
  markSourceInvestigating,
  recordFeedHealth,
  resolveFeedUrl,
  setDiscoveredSourceStatus,
  setFeedOverride,
} from './source-registry';
import { getPersistentCache, setPersistentCache } from './persistent-cache';
import { getAutonomousKeywordTopics, isLowSignalKeywordTerm, upsertKeywordCandidates, type KeywordDomain } from './keyword-registry';
import { upsertSourceHealingSuggestion } from './source-healing-suggestions';
import { ingestNetworkDiscoveryCaptures, networkCapturesToApiDiscoveryCandidates } from './network-discovery';
import { registerApiDiscoveryCandidates } from './api-source-registry';

const MAX_HEAL_ATTEMPTS = 4;
const MAX_VALIDATE_CANDIDATES = 5;
const PLAYWRIGHT_DISCOVERY_TIMEOUT_MS = 20_000;
const AUTONOMOUS_DISCOVERY_INTERVAL_MS = 12 * 60 * 1000;
const AUTONOMY_MEMORY_KEY = 'source-healer-autonomy-memory:v1';
const AUTONOMY_TOPIC_STALE_MS = 6 * 60 * 60 * 1000;
const AUTONOMY_DOMAIN_STALE_MS = 24 * 60 * 60 * 1000;
const DOMAIN_FAILURE_COOLDOWN_MS = 6 * 60 * 60 * 1000;
const AUTONOMY_FAILURE_TRIGGER_COOLDOWN_MS = 20 * 60 * 1000;
const AUTO_ACTIVATE_CONFIDENCE = 92;

const DEFAULT_AUTONOMOUS_TOPICS = [
  'middle east escalation shipping chokepoint',
  'critical minerals supply chain disruption',
  'military flight activity anomaly',
  'cyberattack critical infrastructure outage',
  'ai semiconductor export controls',
  'energy market sanctions embargo',
];

let running = false;
let scheduled = false;
let autonomyTimer: ReturnType<typeof setInterval> | null = null;
let autonomyInFlight = false;
let autonomousHints: string[] = [];
let lastFailureTriggeredAutonomyAt = 0;
const failedDomainUntil = new Map<string, number>();

interface AgentDiscoveredSource {
  name?: string;
  url: string;
  confidence?: number;
  reason?: string;
  category?: string;
  topics?: string[];
}

interface AgentDiscoveredTopic {
  topic: string;
  rationale?: string;
  relevanceScore?: number;
}

interface AgentDiscoveryResult {
  success: boolean;
  discoveredFeedUrl?: string;
  discoveredSources?: AgentDiscoveredSource[];
  discoveredTopics?: AgentDiscoveredTopic[];
  networkCaptures?: Array<{
    pageUrl?: string;
    requestUrl: string;
    method?: string;
    status?: number;
    contentType?: string;
    schemaHint?: 'json' | 'xml' | 'unknown';
    sampleKeys?: string[];
    notes?: string[];
    category?: string;
    discoveredAt?: number;
  }>;
  reason?: string;
  usedCodex?: boolean;
}

interface AutonomyMemory {
  topicLastRun: Record<string, number>;
  domainLastSeen: Record<string, number>;
}

let memoryLoaded = false;
let autonomyMemory: AutonomyMemory = {
  topicLastRun: {},
  domainLastSeen: {},
};

function rssProxyUrl(rawUrl: string): string {
  return `/api/rss-proxy?url=${encodeURIComponent(rawUrl)}`;
}

function nowMs(): number {
  return Date.now();
}

function normalizeTopic(raw: string): string {
  return String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .slice(0, 180);
}

function domainOf(rawUrl: string): string {
  try {
    return new URL(rawUrl).hostname.toLowerCase();
  } catch {
    return '';
  }
}

async function ensureMemoryLoaded(): Promise<void> {
  if (memoryLoaded) return;
  memoryLoaded = true;
  try {
    const cached = await getPersistentCache<AutonomyMemory>(AUTONOMY_MEMORY_KEY);
    if (cached?.data) {
      autonomyMemory = {
        topicLastRun: cached.data.topicLastRun || {},
        domainLastSeen: cached.data.domainLastSeen || {},
      };
    }
  } catch {
    // ignore
  }
}

async function persistMemory(): Promise<void> {
  await setPersistentCache(AUTONOMY_MEMORY_KEY, autonomyMemory);
}

function markTopicRun(topic: string): void {
  const normalized = normalizeTopic(topic);
  if (!normalized) return;
  autonomyMemory.topicLastRun[normalized] = nowMs();
}

function wasTopicSeenRecently(topic: string, staleMs = AUTONOMY_TOPIC_STALE_MS): boolean {
  const normalized = normalizeTopic(topic);
  if (!normalized) return false;
  const last = autonomyMemory.topicLastRun[normalized] || 0;
  return last > 0 && nowMs() - last < staleMs;
}

function markDomainSeen(url: string): void {
  const domain = domainOf(url);
  if (!domain) return;
  autonomyMemory.domainLastSeen[domain] = nowMs();
  failedDomainUntil.delete(domain);
}

function wasDomainSeenRecently(url: string, staleMs = AUTONOMY_DOMAIN_STALE_MS): boolean {
  const domain = domainOf(url);
  if (!domain) return false;
  const last = autonomyMemory.domainLastSeen[domain] || 0;
  return last > 0 && nowMs() - last < staleMs;
}

function markDomainFailure(url: string, staleMs = DOMAIN_FAILURE_COOLDOWN_MS): void {
  const domain = domainOf(url);
  if (!domain) return;
  failedDomainUntil.set(domain, nowMs() + Math.max(60_000, staleMs));
}

function wasDomainFailureRecent(url: string): boolean {
  const domain = domainOf(url);
  if (!domain) return false;
  const until = failedDomainUntil.get(domain) || 0;
  if (until <= 0) return false;
  if (until <= nowMs()) {
    failedDomainUntil.delete(domain);
    return false;
  }
  return true;
}

function shouldTriggerAutonomyFromFailure(): boolean {
  const ts = nowMs();
  if (ts - lastFailureTriggeredAutonomyAt < AUTONOMY_FAILURE_TRIGGER_COOLDOWN_MS) {
    return false;
  }
  lastFailureTriggeredAutonomyAt = ts;
  return true;
}

function extractUpstreamUrl(value: string): string | null {
  const trimmed = (value || '').trim();
  if (!trimmed) return null;

  try {
    const parsed = new URL(trimmed, window.location.origin);
    if (parsed.pathname === '/api/rss-proxy') {
      const encoded = parsed.searchParams.get('url');
      if (encoded) return encoded;
    }
  } catch {
    // continue
  }

  if (trimmed.startsWith('/api/rss-proxy?')) {
    try {
      const local = new URL(trimmed, window.location.origin);
      const encoded = local.searchParams.get('url');
      if (encoded) return encoded;
    } catch {
      return null;
    }
  }

  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return null;
}

async function fetchTextViaProxy(rawUrl: string): Promise<{ ok: boolean; status: number; text: string }> {
  try {
    const response = await fetchWithProxy(rssProxyUrl(rawUrl));
    const text = await response.text();
    return {
      ok: response.ok,
      status: response.status,
      text: text || '',
    };
  } catch {
    return { ok: false, status: 0, text: '' };
  }
}

function parseXmlItemsCount(xml: string): number {
  if (!xml) return 0;
  const parser = new DOMParser();
  const doc = parser.parseFromString(xml, 'text/xml');
  if (doc.querySelector('parsererror')) return 0;
  const itemCount = doc.querySelectorAll('item').length;
  if (itemCount > 0) return itemCount;
  return doc.querySelectorAll('entry').length;
}

async function isValidFeedUrl(rawUrl: string): Promise<boolean> {
  const result = await fetchTextViaProxy(rawUrl);
  if (!result.ok || !result.text) return false;
  return parseXmlItemsCount(result.text) > 0;
}

function safeOrigin(rawUrl: string): string | null {
  try {
    return new URL(rawUrl).origin;
  } catch {
    return null;
  }
}

function inferCategoryForFeedName(feedName: string): string {
  const normalized = (feedName || '').trim().toLowerCase();
  if (!normalized) return 'politics';

  for (const [category, feedList] of Object.entries(FEEDS)) {
    if (!Array.isArray(feedList)) continue;
    if (feedList.some(feed => (feed.name || '').trim().toLowerCase() === normalized)) {
      return category;
    }
  }

  return 'politics';
}

function inferCategoryForTopic(topic: string): string {
  const text = normalizeTopic(topic);
  if (!text) return 'politics';
  if (/(crypto|stock|bond|yield|equity|market|commodity|fx|oil|gas)/.test(text)) return 'finance';
  if (/(ai|semiconductor|chip|startup|tech|software|cloud|open source)/.test(text)) return 'tech';
  if (/(shipping|port|ais|maritime|fleet|vessel)/.test(text)) return 'supply-chain';
  if (/(defense|military|war|strike|conflict|sanction|nuclear|missile|coup)/.test(text)) return 'crisis';
  return 'politics';
}

function categoryToKeywordDomain(category: string): KeywordDomain {
  if (category === 'finance') return 'macro';
  if (category === 'tech') return 'tech';
  if (category === 'supply-chain') return 'supply-chain';
  if (category === 'crisis') return 'defense';
  return 'mixed';
}

function collectCandidateUrls(origin: string, failedUrl: string, homepageHtml: string): string[] {
  const set = new Set<string>();

  const add = (candidate: string): void => {
    if (!candidate) return;
    try {
      const absolute = new URL(candidate, origin).toString();
      if (!/^https?:\/\//i.test(absolute)) return;
      set.add(absolute);
    } catch {
      // ignore malformed
    }
  };

  add(failedUrl);
  add(`${origin}/feed`);
  add(`${origin}/feed.xml`);
  add(`${origin}/rss.xml`);

  if (homepageHtml) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(homepageHtml, 'text/html');

    const linkEls = Array.from(doc.querySelectorAll('link[rel]'));
    for (const linkEl of linkEls) {
      const rel = (linkEl.getAttribute('rel') || '').toLowerCase();
      const type = (linkEl.getAttribute('type') || '').toLowerCase();
      const href = linkEl.getAttribute('href') || '';
      if (!href) continue;
      if (rel.includes('alternate') && (type.includes('rss') || type.includes('atom') || type.includes('xml'))) {
        add(href);
      }
    }

    const anchors = Array.from(doc.querySelectorAll('a[href]'));
    for (const anchor of anchors) {
      const href = anchor.getAttribute('href') || '';
      const text = (anchor.textContent || '').toLowerCase();
      const hint = `${href.toLowerCase()} ${text}`;
      if (/(rss|feed|atom|xml)/.test(hint)) {
        add(href);
      }
      if (set.size >= 24) break;
    }
  }

  return Array.from(set);
}

async function findWorkingFeedUrl(failedUrl: string): Promise<string | null> {
  const upstream = extractUpstreamUrl(failedUrl);
  if (!upstream) return null;
  const origin = safeOrigin(upstream);
  if (!origin) return null;
  if (wasDomainFailureRecent(origin)) return null;

  const homepage = await fetchTextViaProxy(origin);
  if (!homepage.ok || !homepage.text) {
    markDomainFailure(origin);
    return null;
  }
  const candidates = collectCandidateUrls(origin, upstream, homepage.text);
  for (const candidate of candidates.slice(0, MAX_VALIDATE_CANDIDATES)) {
    if (wasDomainFailureRecent(candidate)) continue;
    if (await isValidFeedUrl(candidate)) {
      markDomainSeen(candidate);
      return candidate;
    }
    markDomainFailure(candidate);
  }
  markDomainFailure(origin);
  return null;
}

function topicHintsFromReason(reason: string): string[] {
  const base = normalizeTopic(reason);
  if (!base) return [];
  return [
    base,
    `${base} rss`,
    `${base} feed`,
  ];
}

function mergeTopicHints(input: string[]): string[] {
  const merged = new Set<string>();
  for (const item of input) {
    const normalized = normalizeTopic(item);
    if (!normalized) continue;
    merged.add(normalized);
    if (merged.size >= 20) break;
  }
  return Array.from(merged);
}

async function discoverViaPlaywrightAgent(task: {
  feedName: string;
  lang: string;
  failedUrl: string;
  reason: string;
  topicHints?: string[];
}): Promise<AgentDiscoveryResult | null> {
  if (!canUseLocalAgentEndpoints() || !await hasLocalAgentEndpointSupport()) return null;
  try {
    const response = await fetch('/api/local-source-discover', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        feedName: task.feedName,
        lang: task.lang,
        failedUrl: task.failedUrl,
        reason: task.reason,
        topicHints: mergeTopicHints([
          ...(task.topicHints || []),
          ...topicHintsFromReason(task.reason),
          ...autonomousHints,
        ]),
      }),
      signal: AbortSignal.timeout(PLAYWRIGHT_DISCOVERY_TIMEOUT_MS),
    });
    if (!response.ok) return null;
    const payload = await response.json() as AgentDiscoveryResult;
    return payload;
  } catch {
    return null;
  }
}

async function applyDiscoveredSources(params: {
  category: string;
  fallbackFeedName: string;
  lang: string;
  sources: AgentDiscoveredSource[];
  discoveredBy: 'playwright' | 'codex-playwright';
  defaultReason: string;
  topics?: string[];
  autoActivate?: boolean;
}): Promise<number> {
  let added = 0;
  for (const source of params.sources) {
    if (!source?.url || !/^https?:\/\//i.test(source.url)) continue;

    const seenRecently = wasDomainSeenRecently(source.url);
    const confidence = source.confidence ?? 60;
    if (seenRecently && confidence < 95) continue;

    const record = await addDiscoveredSource({
      category: source.category || params.category,
      feedName: source.name || `${params.fallbackFeedName} Candidate`,
      url: source.url,
      lang: params.lang,
      discoveredBy: params.discoveredBy,
      confidence,
      reason: source.reason || params.defaultReason,
      topics: mergeTopicHints([...(source.topics || []), ...(params.topics || [])]),
    });

    if (!record) continue;
    added += 1;
    markDomainSeen(record.url);
    await upsertSourceHealingSuggestion({
      feedName: params.fallbackFeedName,
      lang: params.lang,
      type: 'source-candidate',
      status: params.autoActivate && record.confidence >= AUTO_ACTIVATE_CONFIDENCE ? 'applied' : 'draft',
      failedUrl: source.url,
      suggestedUrl: record.url,
      confidence: record.confidence,
      reason: source.reason || params.defaultReason,
      discoveredBy: params.discoveredBy,
      topics: mergeTopicHints([...(record.topics || []), ...(params.topics || [])]),
    });

    if (
      params.autoActivate
      && record.status !== 'active'
      && record.confidence >= AUTO_ACTIVATE_CONFIDENCE
      && /(rss|feed|atom|xml)/i.test(record.url)
    ) {
      await setDiscoveredSourceStatus(record.id, 'active');
    }
  }
  if (added > 0) await persistMemory();
  return added;
}

function absorbDiscoveredTopics(topics: AgentDiscoveredTopic[] | undefined): void {
  if (!topics || topics.length === 0) return;
  const filtered = topics.filter((topic) => {
    const normalized = normalizeTopic(topic.topic);
    if (!normalized) return false;
    if (isLowSignalKeywordTerm(normalized)) return false;
    if ((topic.relevanceScore ?? 0) < 4.5) return false;
    return true;
  });
  if (filtered.length === 0) return;

  const merged = mergeTopicHints([
    ...autonomousHints,
    ...filtered.map(topic => topic.topic),
  ]);
  autonomousHints = merged.slice(0, 24);
  void upsertKeywordCandidates(
    filtered
      .map((topic) => ({
        term: topic.topic,
        domain: categoryToKeywordDomain(inferCategoryForTopic(topic.topic)),
        confidence: Math.max(40, Math.min(95, Math.round((topic.relevanceScore ?? 6) * 10))),
        ingress: 'playwright' as const,
        aliases: topic.rationale ? [topic.rationale] : [],
      }))
      .filter(item => item.term && item.term.trim().length > 0)
  ).catch(() => {});
}

async function processClaimedTask(task: Awaited<ReturnType<typeof claimNextInvestigationTask>>): Promise<void> {
  if (!task) return;
  await ensureMemoryLoaded();
  await markSourceInvestigating(task.feedName, task.lang);

  try {
    const category = inferCategoryForFeedName(task.feedName);
    const recovered = await findWorkingFeedUrl(task.failedUrl);
    if (recovered) {
      const proxied = rssProxyUrl(recovered);
      await setFeedOverride(task.feedName, task.lang, proxied, 'auto-heal: recovered RSS endpoint');
      await completeInvestigationTask(task.id, { ok: true, resolvedUrl: proxied, note: 'recovered by source-healer' });
      await recordFeedHealth(task.feedName, task.lang, proxied, { ok: true });
      markDomainSeen(recovered);
      await persistMemory();
      return;
    }

    const agentResult = await discoverViaPlaywrightAgent({
      feedName: task.feedName,
      lang: task.lang,
      failedUrl: task.failedUrl,
      reason: task.reason,
      topicHints: autonomousHints,
    });

    if (agentResult) {
      absorbDiscoveredTopics(agentResult.discoveredTopics);
      const networkCaptures = await ingestNetworkDiscoveryCaptures(
        agentResult.networkCaptures ?? [],
        'playwright-discovery',
      );
      if (networkCaptures.length > 0) {
        await registerApiDiscoveryCandidates(
          networkCapturesToApiDiscoveryCandidates(networkCaptures),
        ).catch(() => {});
      }
      const discovered = agentResult.discoveredFeedUrl?.trim();
      if (discovered && /^https?:\/\//i.test(discovered) && await isValidFeedUrl(discovered)) {
        const proxied = rssProxyUrl(discovered);
        await upsertSourceHealingSuggestion({
          feedName: task.feedName,
          lang: task.lang,
          type: 'rss-replacement',
          status: 'resolved',
          failedUrl: task.failedUrl,
          suggestedUrl: discovered,
          confidence: 96,
          reason: 'playwright-agent discovered replacement RSS',
          discoveredBy: agentResult.usedCodex ? 'codex-playwright' : 'playwright',
          topics: mergeTopicHints([task.reason, ...(task.topicHints || []), ...autonomousHints]),
        });
        await setFeedOverride(task.feedName, task.lang, proxied, 'playwright-agent: discovered replacement RSS');
        await completeInvestigationTask(task.id, { ok: true, resolvedUrl: proxied, note: 'recovered by playwright-agent' });
        await recordFeedHealth(task.feedName, task.lang, proxied, { ok: true });
        markDomainSeen(discovered);
        await persistMemory();
        return;
      }

      await applyDiscoveredSources({
        category,
        fallbackFeedName: task.feedName,
        lang: task.lang,
        sources: agentResult.discoveredSources ?? [],
        discoveredBy: agentResult.usedCodex ? 'codex-playwright' : 'playwright',
        defaultReason: agentResult.reason || 'playwright-agent discovered source candidate',
        topics: mergeTopicHints([task.reason, ...autonomousHints]),
        autoActivate: true,
      });
    }

    const shouldRetry = task.attempts < MAX_HEAL_ATTEMPTS;
    await upsertSourceHealingSuggestion({
      feedName: task.feedName,
      lang: task.lang,
      type: 'dom-fallback',
      status: 'draft',
      failedUrl: task.failedUrl,
      suggestedUrl: safeOrigin(task.failedUrl) || undefined,
      selectorHint: 'article a, main a, a[href*="/news"], link[rel="alternate"]',
      confidence: 62,
      reason: 'No working RSS candidate found. Review homepage DOM extraction fallback.',
      discoveredBy: agentResult?.usedCodex ? 'codex-playwright' : 'playwright',
      topics: mergeTopicHints([task.reason, ...(task.topicHints || []), ...autonomousHints]),
    });
    await completeInvestigationTask(task.id, {
      ok: false,
      error: 'No valid RSS candidate discovered',
      retry: shouldRetry,
    });
  } catch (error) {
    const shouldRetry = task.attempts < MAX_HEAL_ATTEMPTS;
    await completeInvestigationTask(task.id, {
      ok: false,
      error: error instanceof Error ? error.message : 'Investigation failed',
      retry: shouldRetry,
    });
  }
}

async function drainQueue(): Promise<void> {
  if (running) return;
  running = true;
  try {
    while (true) {
      const next = await claimNextInvestigationTask();
      if (!next) break;
      await processClaimedTask(next);
    }
  } finally {
    running = false;
    scheduled = false;
  }
}

function scheduleDrain(): void {
  if (scheduled) return;
  scheduled = true;
  setTimeout(() => {
    void drainQueue().catch((error) => {
      console.warn('[source-healer] Queue drain failed', error);
      scheduled = false;
      running = false;
    });
  }, 0);
}

async function buildAutonomousTopicBatch(force: boolean): Promise<string[]> {
  const keywordTopics = await getAutonomousKeywordTopics(24);
  const base = mergeTopicHints([
    ...autonomousHints,
    ...keywordTopics,
    ...DEFAULT_AUTONOMOUS_TOPICS,
  ]);

  const topics: string[] = [];
  for (const topic of base) {
    if (!force && wasTopicSeenRecently(topic)) continue;
    topics.push(topic);
    if (topics.length >= 8) break;
  }

  if (topics.length === 0 && !force) {
    return DEFAULT_AUTONOMOUS_TOPICS.slice(0, 3);
  }

  return topics;
}

async function runAutonomousDiscoveryCycle(force = false): Promise<void> {
  if (autonomyInFlight) return;
  if (!canUseLocalAgentEndpoints() || !await hasLocalAgentEndpointSupport()) return;
  autonomyInFlight = true;

  try {
    await ensureMemoryLoaded();
    const topics = await buildAutonomousTopicBatch(force);
    if (topics.length === 0) return;

    const response = await fetch('/api/local-source-hunt', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        topics,
        timeoutMs: PLAYWRIGHT_DISCOVERY_TIMEOUT_MS,
      }),
      signal: AbortSignal.timeout(PLAYWRIGHT_DISCOVERY_TIMEOUT_MS + 5_000),
    });

    if (!response.ok) return;
    const payload = await response.json() as AgentDiscoveryResult;
    if (!payload?.success) return;

    absorbDiscoveredTopics(payload.discoveredTopics);
    const networkCaptures = await ingestNetworkDiscoveryCaptures(
      payload.networkCaptures ?? [],
      'playwright-discovery',
    );
    if (networkCaptures.length > 0) {
      await registerApiDiscoveryCandidates(
        networkCapturesToApiDiscoveryCandidates(networkCaptures),
      ).catch(() => {});
    }

    const discoveredBy = payload.usedCodex ? 'codex-playwright' : 'playwright';
    const defaultCategory = inferCategoryForTopic(topics[0] || '');
    await applyDiscoveredSources({
      category: defaultCategory,
      fallbackFeedName: 'Autonomous Discovery',
      lang: 'en',
      sources: payload.discoveredSources ?? [],
      discoveredBy,
      defaultReason: payload.reason || 'autonomous codex+playwright discovery',
      topics,
      autoActivate: true,
    });

    for (const topic of topics) {
      markTopicRun(topic);
    }
    await persistMemory();
  } catch (error) {
    console.warn('[source-healer] autonomous discovery cycle failed', error);
  } finally {
    autonomyInFlight = false;
  }
}

export function updateAutonomousDiscoveryHints(hints: string[]): void {
  autonomousHints = mergeTopicHints([...(autonomousHints || []), ...(hints || [])]).slice(0, 24);
}

export function startSourceAutonomyLoop(intervalMs = AUTONOMOUS_DISCOVERY_INTERVAL_MS): void {
  if (autonomyTimer) return;
  void runAutonomousDiscoveryCycle(false);
  autonomyTimer = setInterval(() => {
    void runAutonomousDiscoveryCycle(false);
  }, Math.max(60_000, intervalMs));
}

export function stopSourceAutonomyLoop(): void {
  if (!autonomyTimer) return;
  clearInterval(autonomyTimer);
  autonomyTimer = null;
}

export async function triggerSourceAutonomyOnce(force = false): Promise<void> {
  await runAutonomousDiscoveryCycle(force);
}

export async function resolveFeedUrlForFetch(feedName: string, lang: string, defaultUrl: string): Promise<string> {
  return resolveFeedUrl(feedName, lang, defaultUrl);
}

export async function onFeedFetchSuccess(feedName: string, lang: string, usedUrl: string): Promise<void> {
  await recordFeedHealth(feedName, lang, usedUrl, { ok: true });
}

export async function onFeedFetchFailure(
  feedName: string,
  lang: string,
  usedUrl: string,
  reason: string,
): Promise<void> {
  await recordFeedHealth(feedName, lang, usedUrl, { ok: false, reason });
  if (!canUseLocalAgentEndpoints() || !await hasLocalAgentEndpointSupport()) return;
  await enqueueSourceInvestigation({
    feedName,
    lang,
    failedUrl: usedUrl,
    reason,
  });

  updateAutonomousDiscoveryHints([
    feedName,
    reason,
    `${feedName} ${reason}`,
  ]);

  scheduleDrain();
  if (shouldTriggerAutonomyFromFailure()) {
    void triggerSourceAutonomyOnce(false);
  }
}
