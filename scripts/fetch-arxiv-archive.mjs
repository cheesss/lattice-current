#!/usr/bin/env node

import pg from 'pg';
import path from 'node:path';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { XMLParser } from 'fast-xml-parser';
import { loadOptionalEnvFile, resolveNasPgConfig } from './_shared/nas-runtime.mjs';
import { ensureEmergingTechSchema } from './_shared/schema-emerging-tech.mjs';

loadOptionalEnvFile();

const { Client } = pg;
const ARXIV_API_BASE = 'https://export.arxiv.org/api/query';
const DEFAULT_SINCE = '2021-01-01';
const DEFAULT_BATCH_SIZE = 100;
const DEFAULT_STATE_PATH = 'data/arxiv-backfill-state.json';
const ARXIV_STATE_VERSION = 2;
const DEFAULT_CATEGORIES = [
  'cs.AI',
  'cs.LG',
  'cs.CV',
  'cs.RO',
  'cs.NE',
  'quant-ph',
  'q-bio.QM',
  'cond-mat.mtrl-sci',
];

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '',
  trimValues: true,
  parseTagValue: false,
});

export function parseArgs(argv = process.argv.slice(2)) {
  const parsed = {
    since: DEFAULT_SINCE,
    batchSize: DEFAULT_BATCH_SIZE,
    maxBatches: 0,
    statePath: DEFAULT_STATE_PATH,
    categories: [...DEFAULT_CATEGORIES],
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--since' && argv[index + 1]) {
      parsed.since = argv[++index];
    } else if (arg === '--batch-size' && argv[index + 1]) {
      const value = Number(argv[++index]);
      if (Number.isFinite(value) && value > 0) parsed.batchSize = Math.min(200, Math.floor(value));
    } else if (arg === '--max-batches' && argv[index + 1]) {
      const value = Number(argv[++index]);
      if (Number.isFinite(value) && value >= 0) parsed.maxBatches = Math.floor(value);
    } else if (arg === '--state-path' && argv[index + 1]) {
      parsed.statePath = argv[++index];
    } else if (arg === '--categories' && argv[index + 1]) {
      const categories = argv[++index]
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean);
      if (categories.length > 0) parsed.categories = categories;
    }
  }
  return parsed;
}

function normalizeWhitespace(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

export function normalizeCategories(categories = DEFAULT_CATEGORIES) {
  return Array.from(new Set(
    (Array.isArray(categories) ? categories : [categories])
      .map((value) => String(value || '').trim())
      .filter(Boolean),
  )).sort();
}

export function buildArxivQuery(categories = DEFAULT_CATEGORIES) {
  return normalizeCategories(categories).map((category) => `cat:${category}`).join(' OR ');
}

function toArray(value) {
  if (Array.isArray(value)) return value;
  if (value == null) return [];
  return [value];
}

export function extractArxivEntries(xml) {
  const parsed = xmlParser.parse(String(xml || ''));
  const feed = parsed?.feed || {};
  return toArray(feed.entry).map((entry) => {
    const links = toArray(entry.link);
    const htmlLink = links.find((link) => link.rel === 'alternate') || links[0] || {};
    const categories = toArray(entry.category)
      .map((category) => String(category.term || '').trim())
      .filter(Boolean);
    const authors = toArray(entry.author)
      .map((author) => normalizeWhitespace(author?.name))
      .filter(Boolean);
    return {
      id: normalizeWhitespace(entry.id),
      title: normalizeWhitespace(entry.title),
      summary: normalizeWhitespace(entry.summary),
      publishedAt: entry.published || entry.updated || null,
      updatedAt: entry.updated || entry.published || null,
      url: normalizeWhitespace(htmlLink.href || entry.id),
      authors,
      categories,
    };
  }).filter((entry) => entry.id && entry.title && entry.publishedAt);
}

export function buildArticleRecord(entry) {
  const authorSummary = entry.authors?.length > 0
    ? `authors ${entry.authors.slice(0, 4).join(', ')}`
    : '';
  const categorySummary = entry.categories?.length > 0
    ? `categories ${entry.categories.slice(0, 5).join(', ')}`
    : '';
  return {
    source: 'arxiv',
    theme: 'emerging-tech',
    publishedAt: new Date(entry.publishedAt).toISOString(),
    title: normalizeWhitespace(entry.title),
    summary: [
      normalizeWhitespace(entry.summary),
      authorSummary,
      categorySummary,
    ].filter(Boolean).join(' | '),
    url: normalizeWhitespace(entry.url || entry.id),
  };
}

export function shouldResetArxivResume(config, previousState) {
  if (!previousState) return false;
  const previousVersion = Number(previousState.stateVersion || previousState.metadata?.stateVersion || 0);
  if (previousVersion < ARXIV_STATE_VERSION) return true;
  if (String(previousState.since || previousState.metadata?.since || '') !== String(config.since || '')) {
    return true;
  }
  const previousCategories = normalizeCategories(previousState.categories || previousState.metadata?.categories || []);
  const nextCategories = normalizeCategories(config.categories || []);
  if (previousCategories.length !== nextCategories.length) return true;
  return previousCategories.some((value, index) => value !== nextCategories[index]);
}

export function initializeArxivState(config, previousState) {
  const resetResume = shouldResetArxivResume(config, previousState);
  const resumeFromOffset = resetResume ? 0 : Math.max(0, Number(previousState?.lastProcessedOffset || 0));
  return {
    source: 'arxiv',
    stateVersion: ARXIV_STATE_VERSION,
    since: config.since,
    categories: normalizeCategories(config.categories),
    batchSize: config.batchSize,
    startedAt: new Date().toISOString(),
    completedAt: null,
    errorMessage: '',
    totalFetched: 0,
    totalInserted: 0,
    lastProcessedOffset: resumeFromOffset,
    resumeFromOffset,
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
    'arxiv',
    state.lastProcessedOffset != null ? String(state.lastProcessedOffset) : null,
    Number(state.totalFetched || 0),
    Number(state.totalInserted || 0),
    state.startedAt || null,
    state.completedAt || null,
    state.errorMessage || null,
    JSON.stringify({
      stateVersion: state.stateVersion,
      since: state.since,
      batchSize: state.batchSize,
      categories: state.categories,
      resumeFromOffset: state.resumeFromOffset,
      resumeReset: Boolean(state.resumeReset),
      resumeReason: state.resumeReason || 'continue',
    }),
  ]);
}

async function fetchArxivBatch(start, maxResults, categories) {
  const url = new URL(ARXIV_API_BASE);
  url.searchParams.set('search_query', buildArxivQuery(categories));
  url.searchParams.set('start', String(start));
  url.searchParams.set('max_results', String(maxResults));
  url.searchParams.set('sortBy', 'submittedDate');
  url.searchParams.set('sortOrder', 'descending');
  const response = await fetch(url, { signal: AbortSignal.timeout(20_000) });
  if (!response.ok) {
    throw new Error(`arXiv ${response.status} for ${url.pathname}`);
  }
  return extractArxivEntries(await response.text());
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

export async function runArxivArchiveBackfill(options = {}) {
  const config = { ...parseArgs([]), ...options };
  const sinceTime = new Date(config.since).getTime();
  if (!Number.isFinite(sinceTime)) {
    throw new Error(`Invalid --since value: ${config.since}`);
  }

  const previousState = await readState(config.statePath);
  const state = initializeArxivState(config, previousState);

  const client = new Client(resolveNasPgConfig());
  await client.connect();
  await ensureEmergingTechSchema(client);

  try {
    let batchCount = 0;
    let start = Math.max(0, state.lastProcessedOffset);
    let shouldStop = false;

    while (!shouldStop) {
      if (config.maxBatches > 0 && batchCount >= config.maxBatches) break;
      const entries = await fetchArxivBatch(start, config.batchSize, config.categories);
      if (entries.length === 0) break;
      batchCount += 1;

      for (const entry of entries) {
        state.totalFetched += 1;
        const publishedTime = new Date(entry.publishedAt).getTime();
        if (!Number.isFinite(publishedTime) || publishedTime < sinceTime) {
          shouldStop = true;
          continue;
        }
        state.totalInserted += await insertArticle(client, buildArticleRecord(entry));
      }

      state.lastProcessedOffset = start + entries.length;
      await writeState(config.statePath, state);
      await upsertBackfillState(client, state);
      start += entries.length;
      const oldestEntry = entries[entries.length - 1];
      if (new Date(oldestEntry.publishedAt).getTime() < sinceTime) {
        shouldStop = true;
      }
    }

    state.completedAt = new Date().toISOString();
    await writeState(config.statePath, state);
    await upsertBackfillState(client, state);
    return state;
  } catch (error) {
    state.errorMessage = String(error?.message || error || 'arxiv backfill failed');
    await writeState(config.statePath, state);
    await upsertBackfillState(client, state);
    throw error;
  } finally {
    await client.end();
  }
}

async function main() {
  const summary = await runArxivArchiveBackfill(parseArgs());
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
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
