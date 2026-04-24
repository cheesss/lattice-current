import path from 'node:path';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { checkBudget, consumeBudget } from './automation-budget.mjs';

const SOURCE_REGISTRY_CACHE_KEY = 'source-registry:v1';
const SOURCE_OPS_LOG_CACHE_KEY = 'source-ops-log:v1';
const MAX_SOURCE_OPS_EVENTS = 1200;

function clampConfidence(value) {
  return Math.max(0, Math.min(100, Math.round(Number(value) || 0)));
}

function normalizeDomain(rawUrl) {
  try {
    return new URL(String(rawUrl || '').trim()).hostname.toLowerCase();
  } catch {
    return '';
  }
}

function discoveredId(category, url) {
  return `${String(category || 'politics').trim().toLowerCase()}::${normalizeDomain(url)}::${String(url || '').trim().toLowerCase()}`;
}

function cacheFilePath(cacheKey) {
  return path.resolve('data', 'persistent-cache', `${encodeURIComponent(cacheKey)}.json`);
}

async function ensureCacheDir() {
  await mkdir(path.resolve('data', 'persistent-cache'), { recursive: true });
}

async function readPersistentCacheData(cacheKey, fallback) {
  const filePath = cacheFilePath(cacheKey);
  if (!existsSync(filePath)) return structuredClone(fallback);
  try {
    const parsed = JSON.parse(await readFile(filePath, 'utf8'));
    const data = parsed?.data && typeof parsed.data === 'object' ? parsed.data : parsed;
    return data && typeof data === 'object' ? data : structuredClone(fallback);
  } catch {
    return structuredClone(fallback);
  }
}

async function writePersistentCacheData(cacheKey, data) {
  await ensureCacheDir();
  const serializedData = JSON.stringify(data);
  const payload = {
    key: cacheKey,
    data,
    updatedAt: Date.now(),
    ttlMs: 0,
    expiresAt: 0,
    sizeBytes: Buffer.byteLength(serializedData, 'utf8'),
  };
  await writeFile(cacheFilePath(cacheKey), JSON.stringify(payload, null, 2));
}

async function appendSourceOpsEvent(input) {
  const payload = await readPersistentCacheData(SOURCE_OPS_LOG_CACHE_KEY, { events: [] });
  const events = Array.isArray(payload.events) ? payload.events.slice() : [];
  const createdAt = Number.isFinite(input.createdAt) ? Number(input.createdAt) : Date.now();
  events.unshift({
    id: `${input.kind}:${input.action}:${input.title}:${createdAt}`.slice(0, 220),
    kind: input.kind,
    action: input.action,
    actor: input.actor,
    title: input.title,
    detail: input.detail,
    status: input.status,
    category: input.category,
    url: input.url,
    tags: (input.tags || []).filter(Boolean).slice(0, 10),
    createdAt,
  });
  await writePersistentCacheData(SOURCE_OPS_LOG_CACHE_KEY, {
    events: events
      .sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0))
      .slice(0, MAX_SOURCE_OPS_EVENTS),
  });
}

async function upsertDiscoveredSource(input) {
  const cleanUrl = String(input.url || '').trim();
  if (!cleanUrl || !/^https?:\/\//i.test(cleanUrl)) return null;

  const payload = await readPersistentCacheData(SOURCE_REGISTRY_CACHE_KEY, {
    records: [],
    overrides: [],
    discoveredSources: [],
  });
  const discoveredSources = Array.isArray(payload.discoveredSources) ? payload.discoveredSources.slice() : [];
  const category = String(input.category || 'politics').trim().toLowerCase() || 'politics';
  const id = discoveredId(category, cleanUrl);
  const ts = Date.now();
  const domain = normalizeDomain(cleanUrl);
  const confidence = clampConfidence(input.confidence ?? 55);
  const derivedStatus = confidence >= 85 ? 'approved' : 'draft';
  const previous = discoveredSources.find((source) => source.id === id) || null;
  const next = previous
    ? {
      ...previous,
      feedName: input.feedName || previous.feedName,
      confidence: Math.max(Number(previous.confidence || 0), confidence),
      reason: String(input.reason || previous.reason || 'discovered source').slice(0, 300),
      topics: Array.from(new Set([
        ...(Array.isArray(previous.topics) ? previous.topics : []),
        ...((input.topics || []).map((topic) => String(topic || '').trim()).filter(Boolean).slice(0, 8)),
      ])).slice(0, 12),
      updatedAt: ts,
      status: previous.status === 'active' || previous.status === 'approved' ? previous.status : derivedStatus,
    }
    : {
      id,
      category,
      feedName: String(input.feedName || domain || 'Discovered Feed').slice(0, 120),
      url: cleanUrl,
      lang: String(input.lang || 'en').slice(0, 8),
      domain,
      status: derivedStatus,
      discoveredBy: input.discoveredBy || 'heuristic',
      confidence,
      reason: String(input.reason || 'discovered source').slice(0, 300),
      topics: (input.topics || []).map((topic) => String(topic || '').trim()).filter(Boolean).slice(0, 12),
      createdAt: ts,
      updatedAt: ts,
    };

  const nextSources = discoveredSources.filter((source) => source.id !== id);
  nextSources.push(next);
  payload.discoveredSources = nextSources.sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0));
  await writePersistentCacheData(SOURCE_REGISTRY_CACHE_KEY, payload);
  await appendSourceOpsEvent({
    kind: 'source',
    action: previous ? 'updated' : 'discovered',
    actor: next.discoveredBy,
    title: next.feedName,
    detail: next.reason,
    status: next.status,
    category: next.category,
    url: next.url,
    tags: next.topics?.slice(0, 6) || [],
    createdAt: ts,
  });
  return next;
}

async function updateDiscoveredSourceStatus(id, status, note, actor = 'system') {
  const payload = await readPersistentCacheData(SOURCE_REGISTRY_CACHE_KEY, {
    records: [],
    overrides: [],
    discoveredSources: [],
  });
  const discoveredSources = Array.isArray(payload.discoveredSources) ? payload.discoveredSources.slice() : [];
  const index = discoveredSources.findIndex((source) => source.id === id);
  if (index < 0) return null;
  const ts = Date.now();
  const next = {
    ...discoveredSources[index],
    status,
    updatedAt: ts,
  };
  discoveredSources[index] = next;
  payload.discoveredSources = discoveredSources.sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0));
  await writePersistentCacheData(SOURCE_REGISTRY_CACHE_KEY, payload);
  await appendSourceOpsEvent({
    kind: 'source',
    action: 'status-change',
    actor,
    title: next.feedName,
    detail: String(note || `Discovered source -> ${status}`).slice(0, 220),
    status,
    category: next.category,
    url: next.url,
    tags: next.topics?.slice(0, 6) || [],
    createdAt: ts,
  });
  return next;
}

function normalize(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseFeedTitles(xml) {
  const titles = Array.from(String(xml || '').matchAll(/<title[^>]*>([\s\S]*?)<\/title>/gi))
    .map((match) => String(match[1] || '').replace(/<!\[CDATA\[|\]\]>/g, '').trim());
  const dates = Array.from(String(xml || '').matchAll(/<(?:pubDate|published|updated)>([\s\S]*?)<\/(?:pubDate|published|updated)>/gi))
    .map((match) => String(match[1] || '').trim());
  return titles
    .filter((title) => title.length >= 8)
    .slice(0, 50)
    .map((title, index) => ({
      title,
      publishedAt: dates[index] || null,
    }));
}

function detectLanguageHeuristic(text) {
  const value = String(text || '');
  if (/[가-힣]/.test(value)) return 'ko';
  if (/[ぁ-ゖァ-ヺ一-龯]/.test(value)) return 'ja';
  return 'en';
}

export async function evaluateFeedQuality(feedUrl) {
  let response;
  try {
    response = await fetch(feedUrl, { signal: AbortSignal.timeout(15_000) });
  } catch {
    return {
      score: 0,
      articleCount: 0,
      avgTitleLength: 0,
      languageDiversity: 0,
      topicDiversity: 0,
      spamRate: 1,
      freshness: 0,
    };
  }
  if (!response.ok) {
    return {
      score: 0,
      articleCount: 0,
      avgTitleLength: 0,
      languageDiversity: 0,
      topicDiversity: 0,
      spamRate: 1,
      freshness: 0,
    };
  }

  const xml = await response.text();
  const articles = parseFeedTitles(xml);
  if (articles.length < 5) {
    return {
      score: 0,
      articleCount: articles.length,
      avgTitleLength: articles.reduce((sum, article) => sum + article.title.length, 0) / Math.max(1, articles.length),
      languageDiversity: 1,
      topicDiversity: 0,
      spamRate: 0,
      freshness: 0,
    };
  }

  const avgTitleLength = articles.reduce((sum, article) => sum + article.title.length, 0) / articles.length;
  const languages = new Set(articles.map((article) => detectLanguageHeuristic(article.title)));
  const titleHashes = new Set(articles.map((article) => normalize(article.title).slice(0, 60)));
  const uniqueRate = titleHashes.size / articles.length;
  const spamPatterns = [/click here/i, /buy now/i, /limited offer/i, /\$\d+/];
  const spamCount = articles.filter((article) => spamPatterns.some((pattern) => pattern.test(article.title))).length;
  const spamRate = spamCount / articles.length;
  const recentCount = articles.filter((article) => {
    if (!article.publishedAt) return false;
    const timestamp = new Date(article.publishedAt).getTime();
    return Number.isFinite(timestamp) && (Date.now() - timestamp) < (7 * 86400000);
  }).length;
  const freshness = recentCount / articles.length;
  const score = Math.min(articles.length / 30, 1) * 0.2
    + Math.min(avgTitleLength / 80, 1) * 0.1
    + uniqueRate * 0.25
    + (1 - spamRate) * 0.25
    + freshness * 0.2;

  return {
    score: Math.max(0, Math.min(1, Number(score.toFixed(4)))),
    articleCount: articles.length,
    avgTitleLength: Number(avgTitleLength.toFixed(2)),
    languageDiversity: languages.size,
    topicDiversity: Number(uniqueRate.toFixed(4)),
    spamRate: Number(spamRate.toFixed(4)),
    freshness: Number(freshness.toFixed(4)),
  };
}

export async function evaluateAndRegisterFeed(client, feedUrl, source, options = {}) {
  const minScore = options.minScore ?? 0.65;
  const quality = await evaluateFeedQuality(feedUrl);
  if (quality.score < minScore) {
    return {
      registered: false,
      quality,
      reason: `quality ${quality.score.toFixed(2)} below threshold ${minScore}`,
    };
  }

  const budgetExempt = options.budgetExempt === true || options.humanApproved === true;
  if (!budgetExempt) {
    const budgetCheck = await checkBudget(client, 'rssRegistrations', 1);
    if (!budgetCheck.allowed) {
      return { registered: false, quality, reason: budgetCheck.reason };
    }
  }

  const record = await upsertDiscoveredSource({
    category: source,
    feedName: options.feedName || `${source} auto feed`,
    url: feedUrl,
    lang: options.lang || 'en',
    discoveredBy: 'heuristic',
    confidence: Math.round(quality.score * 100),
    reason: `quality=${quality.score.toFixed(2)} auto-registered`,
    topics: options.topics || [],
  });
  if (!record) {
    return { registered: false, quality, reason: 'source registry rejected feed' };
  }

  if (options.autoRegister !== false) {
    await updateDiscoveredSourceStatus(
      record.id,
      'active',
      `auto-registered after quality screen ${quality.score.toFixed(2)}`,
      'system',
    );
  }

  if (!budgetExempt) {
    await consumeBudget(client, 'rssRegistrations', 1, { feedUrl, score: quality.score, source });
  }
  return { registered: true, quality };
}

function qualityFromProbe(probe = {}) {
  const breakdown = probe.qualityBreakdown || {};
  const score = Math.max(0, Math.min(1, Number(probe.qualityScore) || 0));
  return {
    score,
    articleCount: Number(breakdown.itemCount || 0),
    recentItemCount: Number(breakdown.recentItemCount || 0),
    titleDiversity: Number(breakdown.titleDiversity || 0),
    duplicateRate: Number(breakdown.duplicateRate || 0),
    spamRate: Number(breakdown.spamRate || 0),
    freshness: Number(breakdown.sourceFreshness || 0),
    language: breakdown.language || null,
    connectorKind: probe.connectorKind || 'manual',
  };
}

export async function registerProbedSource(client, probe, source, options = {}) {
  const feedUrl = String(probe?.resolvedUrl || probe?.inputUrl || options.url || '').trim();
  const minScore = options.minScore ?? 0.65;
  const quality = qualityFromProbe(probe);
  const recentItemCount = Number(quality.recentItemCount || 0);
  const nextAction = String(probe?.nextAction || 'reject');

  if (!feedUrl || !/^https?:\/\//i.test(feedUrl)) {
    return { registered: false, quality, reason: 'source probe did not resolve a valid URL' };
  }

  if (!(nextAction === 'register' || nextAction === 'review') || quality.score < minScore || recentItemCount < 3) {
    return {
      registered: false,
      quality,
      reason: `probe ${nextAction}: quality ${quality.score.toFixed(2)}, recent ${recentItemCount}`,
    };
  }

  const budgetExempt = options.budgetExempt === true || options.humanApproved === true;
  if (!budgetExempt) {
    const budgetCheck = await checkBudget(client, 'rssRegistrations', 1);
    if (!budgetCheck.allowed) {
      return { registered: false, quality, reason: budgetCheck.reason };
    }
  }

  const record = await upsertDiscoveredSource({
    category: source,
    feedName: options.feedName || `${source} probe feed`,
    url: feedUrl,
    lang: options.lang || quality.language || 'en',
    discoveredBy: options.discoveredBy || 'heuristic',
    confidence: Math.round(quality.score * 100),
    reason: `probe=${probe.connectorKind || 'unknown'} quality=${quality.score.toFixed(2)} recent=${recentItemCount}`,
    topics: options.topics || [],
  });

  if (!record) {
    return { registered: false, quality, reason: 'source registry rejected probe result' };
  }

  if (options.autoRegister !== false) {
    await updateDiscoveredSourceStatus(
      record.id,
      'active',
      `auto-registered after source probe ${quality.score.toFixed(2)}`,
      options.actor || 'system',
    );
  }

  if (!budgetExempt) {
    await consumeBudget(client, 'rssRegistrations', 1, {
      feedUrl,
      score: quality.score,
      source,
      connectorKind: probe.connectorKind || null,
      traceId: probe.traceId || null,
    });
  }

  return { registered: true, quality, record, feedUrl };
}
