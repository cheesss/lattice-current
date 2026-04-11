#!/usr/bin/env node

import pg from 'pg';
import path from 'node:path';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { loadOptionalEnvFile, resolveNasPgConfig } from './_shared/nas-runtime.mjs';
import { ensureEmergingTechSchema } from './_shared/schema-emerging-tech.mjs';

loadOptionalEnvFile();

const { Client } = pg;
const HN_API_BASE = 'https://hacker-news.firebaseio.com/v0';
const HN_ALGOLIA_API_BASE = 'https://hn.algolia.com/api/v1/search_by_date';
const DEFAULT_SINCE = '2021-01-01';
const DEFAULT_SCORE_MIN = 50;
const DEFAULT_THROTTLE_MS = 100;
const DEFAULT_CHECKPOINT_INTERVAL = 500;
const DEFAULT_STATE_PATH = 'data/hn-backfill-state.json';
const DEFAULT_HITS_PER_PAGE = 100;
const HN_STATE_VERSION = 2;

export function parseArgs(argv = process.argv.slice(2)) {
  const parsed = {
    since: DEFAULT_SINCE,
    scoreMin: DEFAULT_SCORE_MIN,
    throttleMs: DEFAULT_THROTTLE_MS,
    checkpointInterval: DEFAULT_CHECKPOINT_INTERVAL,
    hitsPerPage: DEFAULT_HITS_PER_PAGE,
    maxPages: 0,
    limit: 0,
    statePath: DEFAULT_STATE_PATH,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--since' && argv[index + 1]) {
      parsed.since = argv[++index];
    } else if (arg === '--score-min' && argv[index + 1]) {
      const value = Number(argv[++index]);
      if (Number.isFinite(value) && value >= 0) parsed.scoreMin = value;
    } else if (arg === '--throttle-ms' && argv[index + 1]) {
      const value = Number(argv[++index]);
      if (Number.isFinite(value) && value >= 0) parsed.throttleMs = value;
    } else if (arg === '--checkpoint-interval' && argv[index + 1]) {
      const value = Number(argv[++index]);
      if (Number.isFinite(value) && value > 0) parsed.checkpointInterval = Math.floor(value);
    } else if (arg === '--hits-per-page' && argv[index + 1]) {
      const value = Number(argv[++index]);
      if (Number.isFinite(value) && value > 0) parsed.hitsPerPage = Math.max(1, Math.min(1000, Math.floor(value)));
    } else if (arg === '--max-pages' && argv[index + 1]) {
      const value = Number(argv[++index]);
      if (Number.isFinite(value) && value >= 0) parsed.maxPages = Math.floor(value);
    } else if (arg === '--limit' && argv[index + 1]) {
      const value = Number(argv[++index]);
      if (Number.isFinite(value) && value >= 0) parsed.limit = Math.floor(value);
    } else if (arg === '--state-path' && argv[index + 1]) {
      parsed.statePath = argv[++index];
    }
  }
  return parsed;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function shouldStoreStory(item, options) {
  if (!item || item.type !== 'story') return false;
  if (!item.url || !item.title) return false;
  if (Number(item.score || 0) < Number(options.scoreMin || 0)) return false;
  if (Number(item.time || 0) < Number(options.sinceUnix || 0)) return false;
  return true;
}

export function buildArticleRecord(item) {
  return {
    source: 'hackernews',
    theme: 'emerging-tech',
    publishedAt: new Date(Number(item.time || 0) * 1000).toISOString(),
    title: String(item.title || '').trim(),
    summary: [
      `Hacker News score ${Number(item.score || 0)}`,
      `comments ${Number(item.descendants || 0)}`,
      item.by ? `author ${String(item.by).trim()}` : '',
      item.id ? `hn_id ${Number(item.id)}` : '',
    ].filter(Boolean).join(' | '),
    url: String(item.url || '').trim(),
  };
}

export function normalizeAlgoliaStory(hit) {
  return {
    type: 'story',
    id: Number(hit?.objectID || 0),
    score: Number(hit?.points || 0),
    descendants: Number(hit?.num_comments || 0),
    by: String(hit?.author || '').trim(),
    time: Number(hit?.created_at_i || 0),
    title: String(hit?.title || hit?.story_title || '').trim(),
    url: String(hit?.url || hit?.story_url || '').trim(),
  };
}

export function shouldResetHackerNewsResume(config, previousState) {
  if (!previousState) return false;
  const previousVersion = Number(previousState.stateVersion || previousState.metadata?.stateVersion || 0);
  if (previousVersion < HN_STATE_VERSION) return true;
  if (String(previousState.queryMode || previousState.metadata?.queryMode || '') !== 'algolia') return true;
  if (String(previousState.since || previousState.metadata?.since || '') !== String(config.since || '')) return true;
  if (Number(previousState.scoreMin || previousState.metadata?.scoreMin || 0) !== Number(config.scoreMin || 0)) return true;
  if (Number(previousState.hitsPerPage || previousState.metadata?.hitsPerPage || 0) !== Number(config.hitsPerPage || 0)) return true;
  return false;
}

export function initializeHackerNewsState(config, previousState) {
  const resetResume = shouldResetHackerNewsResume(config, previousState);
  const resumeFromPage = resetResume ? 0 : Math.max(0, Number(previousState?.lastProcessedPage || 0));
  return {
    source: 'hackernews',
    stateVersion: HN_STATE_VERSION,
    queryMode: 'algolia',
    since: config.since,
    scoreMin: config.scoreMin,
    hitsPerPage: config.hitsPerPage,
    startedAt: new Date().toISOString(),
    completedAt: null,
    errorMessage: '',
    totalFetched: 0,
    totalInserted: 0,
    lastProcessedId: 0,
    lastProcessedPage: resumeFromPage,
    resumeFromPage,
    resumeReset: resetResume,
    resumeReason: resetResume ? 'query-config-changed' : 'continue',
  };
}

async function readState(filePath) {
  if (!existsSync(filePath)) return null;
  try {
    return JSON.parse(await readFile(filePath, 'utf8'));
  } catch {
    return null;
  }
}

async function writeState(filePath, state) {
  await mkdir(path.dirname(path.resolve(filePath)), { recursive: true });
  await writeFile(filePath, JSON.stringify(state, null, 2));
}

async function upsertBackfillState(client, state) {
  await client.query(`
    INSERT INTO backfill_state (
      source, last_processed_id, total_fetched, total_inserted, started_at, completed_at, error_message, metadata, updated_at
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, NOW())
    ON CONFLICT (source) DO UPDATE SET
      last_processed_id = EXCLUDED.last_processed_id,
      total_fetched = EXCLUDED.total_fetched,
      total_inserted = EXCLUDED.total_inserted,
      started_at = EXCLUDED.started_at,
      completed_at = EXCLUDED.completed_at,
      error_message = EXCLUDED.error_message,
      metadata = EXCLUDED.metadata,
      updated_at = NOW()
  `, [
    'hackernews',
    state.lastProcessedId != null ? String(state.lastProcessedId) : null,
    Number(state.totalFetched || 0),
    Number(state.totalInserted || 0),
    state.startedAt || null,
    state.completedAt || null,
    state.errorMessage || null,
    JSON.stringify({
      stateVersion: state.stateVersion,
      queryMode: state.queryMode || 'algolia',
      since: state.since,
      scoreMin: state.scoreMin,
      hitsPerPage: state.hitsPerPage,
      lastProcessedPage: state.lastProcessedPage,
      resumeFromPage: state.resumeFromPage,
      resumeReset: Boolean(state.resumeReset),
      resumeReason: state.resumeReason || 'continue',
    }),
  ]);
}

async function fetchJson(pathname) {
  const response = await fetch(`${HN_API_BASE}${pathname}`, { signal: AbortSignal.timeout(15_000) });
  if (!response.ok) {
    throw new Error(`Hacker News ${response.status} for ${pathname}`);
  }
  return response.json();
}

async function fetchItem(id) {
  return fetchJson(`/item/${id}.json`);
}

async function fetchAlgoliaStories(page, options) {
  const url = new URL(HN_ALGOLIA_API_BASE);
  url.searchParams.set('tags', 'story');
  url.searchParams.set('hitsPerPage', String(options.hitsPerPage || DEFAULT_HITS_PER_PAGE));
  url.searchParams.set('page', String(page));
  url.searchParams.set('numericFilters', `created_at_i>=${options.sinceUnix},points>=${options.scoreMin}`);
  const response = await fetch(url, { signal: AbortSignal.timeout(20_000) });
  if (!response.ok) {
    throw new Error(`Algolia HN ${response.status} for page ${page}`);
  }
  return response.json();
}

async function findStartingId(maxItemId, sinceUnix) {
  let low = 1;
  let high = maxItemId;
  let best = maxItemId;
  for (let iteration = 0; iteration < 24 && low <= high; iteration += 1) {
    const mid = Math.floor((low + high) / 2);
    const item = await fetchItem(mid).catch(() => null);
    const timestamp = Number(item?.time || 0);
    if (timestamp <= 0) {
      low = mid + 1;
      continue;
    }
    if (timestamp >= sinceUnix) {
      best = mid;
      high = mid - 1;
    } else {
      low = mid + 1;
    }
    await sleep(60);
  }
  return best;
}

async function insertArticle(client, record) {
  const result = await client.query(`
    INSERT INTO articles (source, theme, published_at, title, summary, url)
    VALUES ($1, $2, $3, $4, $5, $6)
    ON CONFLICT DO NOTHING
  `, [
    record.source,
    record.theme,
    record.publishedAt,
    record.title,
    record.summary,
    record.url,
  ]);
  return Number(result.rowCount || 0);
}

export async function runHackerNewsArchiveBackfill(options = {}) {
  const config = { ...parseArgs([]), ...options };
  const sinceUnix = Math.floor(new Date(config.since).getTime() / 1000);
  if (!Number.isFinite(sinceUnix) || sinceUnix <= 0) {
    throw new Error(`Invalid --since value: ${config.since}`);
  }

  const client = new Client(resolveNasPgConfig());
  await client.connect();
  await ensureEmergingTechSchema(client);

  const previousState = await readState(config.statePath);
  const state = initializeHackerNewsState(config, previousState);

  try {
    let processedThisRun = 0;
    let page = Math.max(0, state.resumeFromPage);
    let seenPages = 0;
    while (true) {
      if (config.maxPages > 0 && seenPages >= config.maxPages) break;
      if (config.limit > 0 && processedThisRun >= config.limit) break;

      const payload = await fetchAlgoliaStories(page, {
        hitsPerPage: config.hitsPerPage,
        scoreMin: config.scoreMin,
        sinceUnix,
      });
      const hits = Array.isArray(payload?.hits) ? payload.hits : [];
      if (hits.length === 0) break;

      for (const hit of hits) {
        if (config.limit > 0 && processedThisRun >= config.limit) break;
        const item = normalizeAlgoliaStory(hit);
        state.totalFetched += 1;
        state.lastProcessedId = item.id || state.lastProcessedId;
        processedThisRun += 1;
        if (shouldStoreStory(item, { scoreMin: config.scoreMin, sinceUnix })) {
          state.totalInserted += await insertArticle(client, buildArticleRecord(item));
        }
      }

      seenPages += 1;
      state.lastProcessedPage = page + 1;
      if (processedThisRun % config.checkpointInterval === 0 || seenPages % 5 === 0) {
        await writeState(config.statePath, state);
        await upsertBackfillState(client, state);
      }
      if (config.throttleMs > 0) {
        await sleep(config.throttleMs);
      }
      if (payload.page + 1 >= Number(payload.nbPages || 0)) break;
      page += 1;
    }
    state.completedAt = new Date().toISOString();
    await writeState(config.statePath, state);
    await upsertBackfillState(client, state);
    return state;
  } catch (error) {
    state.errorMessage = String(error?.message || error || 'hackernews backfill failed');
    await writeState(config.statePath, state);
    await upsertBackfillState(client, state);
    throw error;
  } finally {
    await client.end();
  }
}

async function main() {
  const result = await runHackerNewsArchiveBackfill(parseArgs());
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

const isDirectRun = (() => {
  const entryArg = process.argv[1];
  if (!entryArg) return false;
  try {
    return import.meta.url === pathToFileURL(entryArg).href;
  } catch {
    return false;
  }
})();

if (isDirectRun) {
  main().catch((error) => {
    process.stderr.write(`${String(error?.stack || error?.message || error)}\n`);
    process.exit(1);
  });
}
