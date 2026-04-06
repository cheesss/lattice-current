#!/usr/bin/env node

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { loadEnvFile, CHROME_UA, getRedisCredentials, runSeed } from './_seed-utils.mjs';
import { clusterItems, selectTopStories } from './_clustering.mjs';

loadEnvFile(import.meta.url);

const CANONICAL_KEY = 'news:insights:v1';
const DIGEST_KEY = 'news:digest:v1:full:en';
const CACHE_TTL = 600;
const MAX_HEADLINES = 10;
const MAX_HEADLINE_LEN = 500;
const GROQ_MODEL = 'llama-3.1-8b-instant';
const LKG_TTL_MS = 24 * 60 * 60 * 1000;
const LLM_BREAKER_THRESHOLD = 3;
const LLM_BREAKER_COOLDOWN_MS = 2 * 60 * 60 * 1000;
const LLM_BREAKER_PATH = path.join(os.tmpdir(), 'lattice-current-insights-llm-breaker.json');

const TASK_NARRATION = /^(we need to|i need to|let me|i'll |i should|i will |the task is|the instructions|according to the rules|so we need to|okay[,.]\s*(i'll|let me|so|we need|the task|i should|i will)|sure[,.]\s*(i'll|let me|so|we need|the task|i should|i will|here)|first[, ]+(i|we|let)|to summarize (the headlines|the task|this)|my task (is|was|:)|step \d)/i;
const PROMPT_ECHO = /^(summarize the top story|summarize the key|rules:|here are the rules|the top story is likely)/i;

function stripReasoningPreamble(text) {
  const trimmed = text.trim();
  if (TASK_NARRATION.test(trimmed) || PROMPT_ECHO.test(trimmed)) {
    const lines = trimmed.split('\n').filter((line) => line.trim());
    const clean = lines.filter((line) => !TASK_NARRATION.test(line.trim()) && !PROMPT_ECHO.test(line.trim()));
    return clean.join('\n').trim() || trimmed;
  }
  return trimmed;
}

function sanitizeTitle(title) {
  if (typeof title !== 'string') return '';
  return title
    .replace(/<[^>]*>/g, '')
    .replace(/[\x00-\x1f\x7f]/g, '')
    .slice(0, MAX_HEADLINE_LEN)
    .trim();
}

async function readJsonKey(key) {
  const { url, token } = getRedisCredentials();
  const resp = await fetch(`${url}/get/${encodeURIComponent(key)}`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(5_000),
  });
  if (!resp.ok) return null;
  const data = await resp.json();
  return data.result ? JSON.parse(data.result) : null;
}

async function readDigestFromRedis() {
  return readJsonKey(DIGEST_KEY);
}

async function readExistingInsights() {
  return readJsonKey(CANONICAL_KEY);
}

async function readLlmBreakerState() {
  try {
    const raw = await readFile(LLM_BREAKER_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object'
      ? parsed
      : { consecutiveFailures: 0, openUntil: 0, lastError: '' };
  } catch {
    return { consecutiveFailures: 0, openUntil: 0, lastError: '' };
  }
}

async function writeLlmBreakerState(state) {
  await mkdir(path.dirname(LLM_BREAKER_PATH), { recursive: true });
  await writeFile(LLM_BREAKER_PATH, JSON.stringify(state, null, 2), 'utf8');
}

async function isLlmBreakerOpen() {
  const state = await readLlmBreakerState();
  return Number(state.openUntil || 0) > Date.now();
}

async function markLlmSuccess() {
  await writeLlmBreakerState({
    consecutiveFailures: 0,
    openUntil: 0,
    lastError: '',
    updatedAt: Date.now(),
  });
}

async function markLlmFailure(message) {
  const state = await readLlmBreakerState();
  const consecutiveFailures = Number(state.consecutiveFailures || 0) + 1;
  await writeLlmBreakerState({
    consecutiveFailures,
    openUntil: consecutiveFailures >= LLM_BREAKER_THRESHOLD ? Date.now() + LLM_BREAKER_COOLDOWN_MS : 0,
    lastError: String(message || '').slice(0, 240),
    updatedAt: Date.now(),
  });
}

function buildKeywordFallbackBrief(headlines) {
  const selected = headlines.slice(0, 3).map((headline) => sanitizeTitle(headline)).filter(Boolean);
  if (selected.length === 0) return '';
  return selected
    .map((headline, index) => `${index === 0 ? 'Lead' : index === 1 ? 'Also' : 'Watch'}: ${headline}.`)
    .join(' ')
    .slice(0, 280);
}

const LLM_PROVIDERS = [
  {
    name: 'groq',
    envKey: 'GROQ_API_KEY',
    apiUrl: 'https://api.groq.com/openai/v1/chat/completions',
    model: GROQ_MODEL,
    headers: (key) => ({ Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', 'User-Agent': CHROME_UA }),
    timeout: 15_000,
  },
  {
    name: 'openrouter',
    envKey: 'OPENROUTER_API_KEY',
    apiUrl: 'https://openrouter.ai/api/v1/chat/completions',
    model: 'google/gemini-2.5-flash',
    headers: (key) => ({ Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', 'HTTP-Referer': 'https://worldmonitor.app', 'X-Title': 'WorldMonitor', 'User-Agent': CHROME_UA }),
    timeout: 20_000,
  },
  {
    name: 'ollama',
    envKey: 'OLLAMA_API_URL',
    apiUrlFn: (baseUrl) => new URL('/v1/chat/completions', baseUrl).toString(),
    model: () => process.env.OLLAMA_MODEL || 'llama3.1:8b',
    headers: () => {
      const headers = { 'Content-Type': 'application/json', 'User-Agent': CHROME_UA };
      const apiKey = process.env.OLLAMA_API_KEY;
      if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
      return headers;
    },
    extraBody: { think: false },
    timeout: 25_000,
  },
];

async function callLLM(headlines) {
  if (await isLlmBreakerOpen()) {
    console.warn('  LLM circuit breaker open — using keyword fallback');
    return null;
  }

  const headlineText = headlines.map((headline, index) => `${index + 1}. ${headline}`).join('\n');
  const dateContext = `Current date: ${new Date().toISOString().split('T')[0]}. Provide geopolitical context appropriate for the current date.`;

  const systemPrompt = `${dateContext}

Summarize the single most important headline in 2 concise sentences MAX (under 60 words total).
Rules:
- Each numbered headline below is a SEPARATE, UNRELATED story
- Pick the ONE most significant headline and summarize ONLY that story
- NEVER combine or merge people, places, or facts from different headlines into one sentence
- Lead with WHAT happened and WHERE - be specific
- NEVER start with "Breaking news", "Good evening", "Tonight", or TV-style openings
- Start directly with the subject of the chosen headline
- No bullet points, no meta-commentary, no elaboration beyond the core facts`;

  const userPrompt = `Each headline below is a separate story. Pick the most important ONE and summarize only that story:\n${headlineText}`;

  for (const provider of LLM_PROVIDERS) {
    const envVal = process.env[provider.envKey];
    if (!envVal) continue;

    const apiUrl = provider.apiUrlFn ? provider.apiUrlFn(envVal) : provider.apiUrl;
    const model = typeof provider.model === 'function' ? provider.model() : provider.model;

    try {
      const resp = await fetch(apiUrl, {
        method: 'POST',
        headers: provider.headers(envVal),
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
          max_tokens: 300,
          temperature: 0.3,
          ...provider.extraBody,
        }),
        signal: AbortSignal.timeout(provider.timeout),
      });

      if (!resp.ok) {
        console.warn(`  ${provider.name} API error: ${resp.status}`);
        continue;
      }

      const json = await resp.json();
      const rawText = json.choices?.[0]?.message?.content?.trim();
      if (!rawText) {
        console.warn(`  ${provider.name}: empty response`);
        continue;
      }

      const text = stripReasoningPreamble(rawText)
        .replace(/<think>[\s\S]*?<\/think>/gi, '')
        .replace(/<\|thinking\|>[\s\S]*?<\|\/thinking\|>/gi, '')
        .replace(/<think>[\s\S]*/gi, '')
        .trim();

      if (text.length < 20) {
        console.warn(`  ${provider.name}: output too short (${text.length} chars)`);
        continue;
      }

      await markLlmSuccess();
      return { text, model: json.model || model, provider: provider.name };
    } catch (err) {
      console.warn(`  ${provider.name} failed: ${err.message}`);
      continue;
    }
  }

  await markLlmFailure('all providers failed');
  return null;
}

function categorizeStory(title) {
  const lower = (title || '').toLowerCase();
  const categories = [
    { keywords: ['war', 'attack', 'missile', 'troops', 'airstrike', 'combat', 'military'], cat: 'conflict', threat: 'critical' },
    { keywords: ['killed', 'dead', 'casualties', 'massacre', 'shooting'], cat: 'violence', threat: 'high' },
    { keywords: ['protest', 'uprising', 'riot', 'unrest', 'coup'], cat: 'unrest', threat: 'high' },
    { keywords: ['sanctions', 'tensions', 'escalation', 'threat'], cat: 'geopolitical', threat: 'elevated' },
    { keywords: ['crisis', 'emergency', 'disaster', 'collapse'], cat: 'crisis', threat: 'high' },
    { keywords: ['earthquake', 'flood', 'hurricane', 'wildfire', 'tsunami'], cat: 'natural_disaster', threat: 'elevated' },
    { keywords: ['election', 'vote', 'parliament', 'legislation'], cat: 'political', threat: 'moderate' },
    { keywords: ['market', 'economy', 'trade', 'tariff', 'inflation'], cat: 'economic', threat: 'moderate' },
  ];

  for (const { keywords, cat, threat } of categories) {
    if (keywords.some((keyword) => lower.includes(keyword))) {
      return { category: cat, threatLevel: threat };
    }
  }
  return { category: 'general', threatLevel: 'moderate' };
}

async function warmDigestCache() {
  const apiBase = process.env.API_BASE_URL || 'https://api.worldmonitor.app';
  try {
    const resp = await fetch(`${apiBase}/api/news/v1/list-feed-digest?variant=full&lang=en`, {
      headers: { 'User-Agent': CHROME_UA },
      signal: AbortSignal.timeout(30_000),
    });
    if (resp.ok) console.log('  Digest cache warmed via RPC');
    else console.warn(`  Digest warm failed: HTTP ${resp.status}`);
  } catch (err) {
    console.warn(`  Digest warm failed: ${err.message}`);
  }
}

function withStaleness(payload) {
  const generatedTs = Date.parse(String(payload?.generatedAt || ''));
  const staleWarning = Number.isFinite(generatedTs) ? (Date.now() - generatedTs > LKG_TTL_MS) : true;
  return {
    ...payload,
    staleWarning,
    lkgExpiresAt: Number.isFinite(generatedTs) ? new Date(generatedTs + LKG_TTL_MS).toISOString() : new Date(Date.now() + LKG_TTL_MS).toISOString(),
  };
}

async function fetchInsights() {
  let digest = await readDigestFromRedis();
  if (!digest) {
    console.log('  Digest not in Redis, warming cache via RPC...');
    await warmDigestCache();
    await new Promise((resolve) => setTimeout(resolve, 3_000));
    digest = await readDigestFromRedis();
  }
  if (!digest) {
    const existing = await readExistingInsights();
    if (existing?.topStories?.length) {
      console.log('  Digest unavailable — reusing existing insights (LKG)');
      return withStaleness(existing);
    }
    throw new Error('No news digest found in Redis');
  }

  let items;
  if (Array.isArray(digest)) {
    items = digest;
  } else if (digest.categories && typeof digest.categories === 'object') {
    items = [];
    for (const bucket of Object.values(digest.categories)) {
      if (Array.isArray(bucket.items)) items.push(...bucket.items);
    }
  } else {
    items = digest.items || digest.articles || digest.headlines || [];
  }

  if (items.length === 0) {
    const keys = typeof digest === 'object' && digest !== null ? Object.keys(digest).join(', ') : typeof digest;
    throw new Error(`Digest has no items (shape: ${keys})`);
  }

  console.log(`  Digest items: ${items.length}`);

  const normalizedItems = items.map((item) => ({
    title: sanitizeTitle(item.title || item.headline || ''),
    source: item.source || item.feed || '',
    link: item.link || item.url || '',
    pubDate: item.pubDate || item.publishedAt || item.date || new Date().toISOString(),
    isAlert: item.isAlert || false,
    tier: item.tier,
  })).filter((item) => item.title.length > 10);

  const clusters = clusterItems(normalizedItems);
  console.log(`  Clusters: ${clusters.length}`);

  const topStories = selectTopStories(clusters, 8);
  console.log(`  Top stories: ${topStories.length}`);
  if (topStories.length === 0) throw new Error('No top stories after scoring');

  const headlines = topStories.slice(0, MAX_HEADLINES).map((story) => sanitizeTitle(story.primaryTitle));

  let worldBrief = '';
  let briefProvider = '';
  let briefModel = '';
  let status = 'ok';

  const llmResult = await callLLM(headlines);
  if (llmResult) {
    worldBrief = llmResult.text;
    briefProvider = llmResult.provider;
    briefModel = llmResult.model;
    console.log(`  Brief generated via ${briefProvider} (${briefModel})`);
  } else {
    status = 'degraded';
    worldBrief = buildKeywordFallbackBrief(headlines);
    briefProvider = 'fallback-keyword';
    briefModel = 'top3-headlines';
    console.warn('  No LLM available — publishing degraded fallback brief');
  }

  const multiSourceCount = clusters.filter((cluster) => cluster.sourceCount >= 2).length;
  const fastMovingCount = 0;

  const enrichedStories = topStories.map((story) => {
    const { category, threatLevel } = categorizeStory(story.primaryTitle);
    return {
      primaryTitle: story.primaryTitle,
      primarySource: story.primarySource,
      primaryLink: story.primaryLink,
      sourceCount: story.sourceCount,
      importanceScore: story.importanceScore,
      velocity: { level: 'normal', sourcesPerHour: 0 },
      isAlert: story.isAlert,
      category,
      threatLevel,
    };
  });

  const payload = withStaleness({
    worldBrief,
    briefProvider,
    briefModel,
    status,
    topStories: enrichedStories,
    generatedAt: new Date().toISOString(),
    clusterCount: clusters.length,
    multiSourceCount,
    fastMovingCount,
  });

  if (status === 'degraded') {
    const existing = await readExistingInsights();
    if (existing?.status === 'ok') {
      console.log('  LKG preservation: existing payload is "ok", skipping degraded overwrite');
      return withStaleness(existing);
    }
  }

  return payload;
}

function validate(data) {
  return Array.isArray(data?.topStories) && data.topStories.length >= 1;
}

runSeed('news', 'insights', CANONICAL_KEY, fetchInsights, {
  validateFn: validate,
  ttlSeconds: CACHE_TTL,
  sourceVersion: 'digest-clustering-v2',
}).catch((err) => {
  console.error('FATAL:', err.message || err);
  process.exit(0);
});
