// ── Re-exports from sub-modules (canonical extraction targets) ──
// Consumers can now import from:
//   ./stream-parser — JSON stream handling, provider-specific record builders
//   ./frame-builder — HistoricalReplayFrame assembly logic
//   ./coverage-ledger — temporal validation, market record logic, frame filtering

import { createReadStream } from 'node:fs';
import { mkdir, open, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import readline from 'node:readline';
import streamJsonPackage from 'stream-json';
import pickPackage from 'stream-json/filters/Pick';
import streamArrayPackage from 'stream-json/streamers/StreamArray';
import type { ClusteredEvent, MarketData, NewsItem } from '@/types';
import type { HistoricalReplayFrame } from '../historical-intelligence';
import { inferCoverageFamilies } from '../coverage-ledger';
import { buildCanonicalEventClusters } from './event-resolver';

const { parser: createJsonParser } = streamJsonPackage as { parser: () => NodeJS.ReadWriteStream };
const { pick } = pickPackage as { pick: (options: { filter: string }) => NodeJS.ReadWriteStream };
const { streamArray } = streamArrayPackage as { streamArray: () => NodeJS.ReadWriteStream };
const DUCKDB_LOCK_TTL_MINUTES = 45;
const IMPORT_FUTURE_TOLERANCE_MS = 5 * 60 * 1000;

type DuckDbConnection = {
  run: (sql: string, params?: Record<string, unknown>) => Promise<unknown>;
  runAndReadAll: (
    sql: string,
    params?: Record<string, unknown>,
  ) => Promise<{ getRowObjectsJS: () => Record<string, unknown>[] }>;
};

type HistoricalRawKind = 'news' | 'market';
type HistoricalTransactionTimeMode = 'provider' | 'valid-time' | 'fetched-at';
type HistoricalBucketTimeMode = 'transaction-time' | 'knowledge-boundary' | 'valid-time';

export interface HistoricalRawReplayRecord {
  id: string;
  datasetId: string;
  provider: string;
  sourceKind: 'rss' | 'api' | 'playwright' | 'manual';
  sourceId: string;
  itemKind: HistoricalRawKind;
  validTimeStart: string;
  validTimeEnd: string | null;
  transactionTime: string;
  knowledgeBoundary: string;
  headline: string | null;
  link: string | null;
  symbol: string | null;
  region: string | null;
  price: number | null;
  payload: Record<string, unknown>;
  metadata: Record<string, unknown>;
}

export interface HistoricalBackfillOptions {
  datasetId?: string;
  provider?: string;
  dbPath?: string;
  chunkSize?: number;
  bucketHours?: number;
  newsLookbackHours?: number;
  warmupFrameCount?: number;
  warmupUntil?: string;
  sourceVersion?: string | null;
  transactionTimeMode?: HistoricalTransactionTimeMode;
  bucketTimeMode?: HistoricalBucketTimeMode;
  sourceArtifactPaths?: string[];
}

export interface HistoricalBackfillResult {
  datasetId: string;
  provider: string;
  dbPath: string;
  rawRecordCount: number;
  currentImportRawRecordCount?: number;
  frameCount: number;
  warmupFrameCount: number;
  bucketHours: number;
  firstValidTime: string | null;
  lastValidTime: string | null;
  firstTransactionTime: string | null;
  lastTransactionTime: string | null;
}

export interface HistoricalDatasetSummary {
  datasetId: string;
  provider: string;
  sourceVersion: string | null;
  importedAt: string;
  rawRecordCount: number;
  frameCount: number;
  warmupFrameCount: number;
  bucketHours: number;
  firstValidTime: string | null;
  lastValidTime: string | null;
  firstTransactionTime: string | null;
  lastTransactionTime: string | null;
  metadata: Record<string, unknown>;
}

export interface HistoricalFrameLoadOptions {
  dbPath?: string;
  datasetId?: string;
  includeWarmup?: boolean;
  maxFrames?: number;
  latestFirst?: boolean;
  startTransactionTime?: string;
  endTransactionTime?: string;
  knowledgeBoundaryCeiling?: string;
}

interface HistoricalPostgresFrameLoadOptions extends HistoricalFrameLoadOptions {
  pgConfig?: {
    host: string;
    port: number;
    database: string;
    user: string;
    password: string;
  };
}

interface MaterializedFrameRow {
  id: string;
  datasetId: string;
  bucketHours: number;
  bucketStart: string;
  bucketEnd: string;
  validTimeStart: string;
  validTimeEnd: string | null;
  transactionTime: string;
  knowledgeBoundary: string;
  warmup: boolean;
  payloadJson: string;
  newsCount: number;
  clusterCount: number;
  marketCount: number;
}

interface HistoricalImportCheckpoint {
  filePath: string;
  fileSize: number;
  fileMtimeMs: number;
  datasetId: string;
  provider: string;
  phase: 'raw-complete';
  rawRecordCount: number;
  updatedAt: string;
}

class DuckDbPathLockError extends Error {
  code = 'DUCKDB_LOCKED';

  constructor(message: string) {
    super(message);
    this.name = 'DuckDbPathLockError';
  }
}

function normalizeDuckDbPath(dbPath: string): string {
  return path.resolve(dbPath || DEFAULT_DB_PATH);
}

function getDuckDbLockPath(dbPath: string): string {
  const normalized = normalizeDuckDbPath(dbPath);
  const digest = createHash('sha1').update(normalized).digest('hex').slice(0, 16);
  const fileName = `${path.basename(normalized)}.${digest}.lock.json`;
  return path.join(path.dirname(normalized), fileName);
}

function getImportCheckpointPath(dbPath: string, filePath: string): string {
  const digest = createHash('sha1')
    .update(`${normalizeDuckDbPath(dbPath)}::${path.resolve(filePath)}`)
    .digest('hex')
    .slice(0, 16);
  return path.join(path.dirname(normalizeDuckDbPath(dbPath)), `${path.basename(filePath)}.${digest}.checkpoint.json`);
}

async function acquireDuckDbPathLock(
  dbPath: string,
  ttlMinutes = DUCKDB_LOCK_TTL_MINUTES,
): Promise<(() => Promise<void>) | null> {
  const lockPath = getDuckDbLockPath(dbPath);
  await mkdir(path.dirname(lockPath), { recursive: true });
  const normalized = normalizeDuckDbPath(dbPath);
  const expiresAt = new Date(Date.now() + ttlMinutes * 60_000).toISOString();
  const payload = JSON.stringify({
    path: normalized,
    pid: process.pid,
    acquiredAt: nowIso(),
    expiresAt,
  }, null, 2);

  const tryCreate = async (): Promise<boolean> => {
    try {
      const handle = await open(lockPath, 'wx');
      await handle.writeFile(payload, 'utf8');
      await handle.close();
      return true;
    } catch {
      return false;
    }
  };

  if (!(await tryCreate())) {
    let existing: { expiresAt?: string; pid?: number } | null = null;
    try {
      existing = JSON.parse(await readFile(lockPath, 'utf8')) as { expiresAt?: string; pid?: number };
    } catch {
      existing = null;
    }

    const pidLooksDead = (() => {
      if (!existing?.pid || existing.pid === process.pid) return false;
      try {
        process.kill(existing.pid, 0);
        return false;
      } catch {
        return true;
      }
    })();

    if ((existing?.expiresAt && asTs(existing.expiresAt) < Date.now()) || pidLooksDead) {
      await rm(lockPath, { force: true });
      if (!(await tryCreate())) return null;
    } else {
      return null;
    }
  }

  return async () => {
    await rm(lockPath, { force: true });
  };
}

export interface HistoricalReplayFrameArchiveRow extends MaterializedFrameRow {
  payload: HistoricalReplayFrame;
}

export interface HistoricalRawRecordLoadOptions {
  dbPath?: string;
  datasetId?: string;
  limit?: number;
  offset?: number;
  startTransactionTime?: string;
  endTransactionTime?: string;
  knowledgeBoundaryCeiling?: string;
}

export interface HistoricalReplayFrameRowLoadOptions {
  dbPath?: string;
  datasetId?: string;
  includeWarmup?: boolean;
  limit?: number;
  offset?: number;
  startTransactionTime?: string;
  endTransactionTime?: string;
  knowledgeBoundaryCeiling?: string;
}

const DEFAULT_DB_PATH = path.resolve('data', 'historical', 'intelligence-history.duckdb');
const DEFAULT_BUCKET_HOURS = 6;
const DEFAULT_NEWS_LOOKBACK_HOURS = 24;
const DEFAULT_CHUNK_SIZE = 500;
const DEFAULT_POSTGRES_FRAME_BUCKET_HOURS = 12;
const POSTGRES_NEWS_PROVIDERS = ['guardian', 'nyt', 'gdelt-doc', 'gdelt-agg', 'rss-feed', 'acled'] as const;
const POSTGRES_MARKET_PROVIDERS = ['yahoo-chart', 'coingecko'] as const;
const POSTGRES_MACRO_PROVIDERS = ['fred'] as const;

let duckDbModulePromise: Promise<typeof import('@duckdb/node-api')> | null = null;
const connectionCache = new Map<string, Promise<DuckDbConnection>>();

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function nowIso(): string {
  return new Date().toISOString();
}

function slugify(value: string): string {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'dataset';
}

function stableId(parts: Array<string | number | null | undefined>): string {
  return parts
    .map((part) => String(part ?? '').trim())
    .filter(Boolean)
    .join('::')
    .slice(0, 240);
}

function minIso(current: string | null, candidate: string | null): string | null {
  if (!candidate) return current;
  if (!current) return candidate;
  return asTs(candidate) < asTs(current) ? candidate : current;
}

function maxIso(current: string | null, candidate: string | null): string | null {
  if (!candidate) return current;
  if (!current) return candidate;
  return asTs(candidate) > asTs(current) ? candidate : current;
}

function toIso(value: unknown, fallback?: string): string {
  if (typeof value === 'string' && value.trim()) {
    const trimmed = value.trim();
    const gdeltCompact = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/i.exec(trimmed);
    if (gdeltCompact) {
      const [, year, month, day, hour, minute, second] = gdeltCompact;
      return new Date(`${year}-${month}-${day}T${hour}:${minute}:${second}Z`).toISOString();
    }
    const asNumber = /^\d{10,13}$/.test(trimmed) ? Number(trimmed) : null;
    if (asNumber && Number.isFinite(asNumber)) {
      const scaled = trimmed.length === 13 ? asNumber : asNumber * 1000;
      return new Date(scaled).toISOString();
    }
    const parsed = new Date(trimmed);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    const scaled = value > 1e12 ? value : value * 1000;
    return new Date(scaled).toISOString();
  }
  if (fallback) return fallback;
  return '';
}

function asTs(value: string | null | undefined): number {
  if (!value) return 0;
  const ts = Date.parse(value);
  return Number.isFinite(ts) ? ts : 0;
}

function validateTemporalRecord(record: HistoricalRawReplayRecord): { ok: boolean; reason?: string } {
  const now = Date.now();
  const validTs = asTs(record.validTimeStart);
  const transactionTs = asTs(record.transactionTime);
  const knowledgeTs = asTs(record.knowledgeBoundary);

  if (!validTs || !transactionTs || !knowledgeTs) {
    return { ok: false, reason: 'invalid-timestamp' };
  }
  if (validTs > now + IMPORT_FUTURE_TOLERANCE_MS) {
    return { ok: false, reason: 'future-valid-time' };
  }
  if (validTs > transactionTs) {
    return { ok: false, reason: 'valid-after-transaction' };
  }
  if (knowledgeTs < transactionTs) {
    return { ok: false, reason: 'knowledge-before-transaction' };
  }
  return { ok: true };
}

function shouldReplaceMarketRecord(
  candidate: HistoricalRawReplayRecord,
  current: HistoricalRawReplayRecord,
): boolean {
  const candidateKnowledge = asTs(candidate.knowledgeBoundary);
  const currentKnowledge = asTs(current.knowledgeBoundary);
  if (candidateKnowledge !== currentKnowledge) return candidateKnowledge > currentKnowledge;
  const candidateTransaction = asTs(candidate.transactionTime);
  const currentTransaction = asTs(current.transactionTime);
  if (candidateTransaction !== currentTransaction) return candidateTransaction > currentTransaction;
  return asTs(candidate.validTimeStart) >= asTs(current.validTimeStart);
}

function toNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value.replace(/,/g, ''));
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function normalizeTitle(value: unknown, fallback: string): string {
  const text = String(value || '').trim();
  return text || fallback;
}

function defaultDatasetId(provider: string): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  return `${slugify(provider)}-${stamp}`;
}

function defaultTransactionTimeMode(provider: string): HistoricalTransactionTimeMode {
  switch (String(provider || '').trim().toLowerCase()) {
    case 'alfred':
    case 'gdelt-doc':
      return 'provider';
    default:
      return 'valid-time';
  }
}

function defaultBucketTimeMode(provider: string): HistoricalBucketTimeMode {
  switch (String(provider || '').trim().toLowerCase()) {
    case 'alfred':
      return 'transaction-time';
    default:
      return 'valid-time';
  }
}

function resolveTransactionTime(
  providerValue: unknown,
  validTimeStart: string,
  fetchedAt: string,
  mode: HistoricalTransactionTimeMode,
): string {
  switch (mode) {
    case 'valid-time':
      return validTimeStart;
    case 'fetched-at':
      return fetchedAt;
    case 'provider':
    default:
      return toIso(providerValue, validTimeStart || fetchedAt);
  }
}

function resolveBucketTimestamp(
  record: HistoricalRawReplayRecord,
  mode: HistoricalBucketTimeMode,
): number {
  switch (mode) {
    case 'valid-time':
      return asTs(record.validTimeStart);
    case 'knowledge-boundary':
      return asTs(record.knowledgeBoundary || record.transactionTime);
    case 'transaction-time':
    default:
      return asTs(record.transactionTime);
  }
}

function newsSourceName(record: HistoricalRawReplayRecord): string {
  const source = String(record.metadata.sourceName || record.sourceId || record.provider).trim();
  return source || record.provider;
}

async function loadDuckDbModule(): Promise<typeof import('@duckdb/node-api')> {
  if (!duckDbModulePromise) {
    duckDbModulePromise = import('@duckdb/node-api');
  }
  return duckDbModulePromise;
}

async function ensureHistoricalReplayArchive(dbPath: string): Promise<DuckDbConnection> {
  const normalized = path.resolve(dbPath || DEFAULT_DB_PATH);
  const cached = connectionCache.get(normalized);
  if (cached) return cached;

  const promise = (async () => {
    await mkdir(path.dirname(normalized), { recursive: true });
    const duckdb = await loadDuckDbModule();
    const instance = await duckdb.DuckDBInstance.fromCache(normalized);
    const connection = await instance.connect();
    await connection.run(`
      CREATE TABLE IF NOT EXISTS historical_raw_items (
        id VARCHAR PRIMARY KEY,
        dataset_id VARCHAR,
        provider VARCHAR,
        source_kind VARCHAR,
        source_id VARCHAR,
        item_kind VARCHAR,
        valid_time_start VARCHAR,
        valid_time_end VARCHAR,
        transaction_time VARCHAR,
        knowledge_boundary VARCHAR,
        headline VARCHAR,
        link VARCHAR,
        symbol VARCHAR,
        region VARCHAR,
        price DOUBLE,
        payload_json VARCHAR,
        metadata_json VARCHAR
      )
    `);
    await connection.run(`
      CREATE TABLE IF NOT EXISTS historical_replay_frames (
        id VARCHAR PRIMARY KEY,
        dataset_id VARCHAR,
        bucket_hours INTEGER,
        bucket_start VARCHAR,
        bucket_end VARCHAR,
        valid_time_start VARCHAR,
        valid_time_end VARCHAR,
        transaction_time VARCHAR,
        knowledge_boundary VARCHAR,
        warmup BOOLEAN,
        news_count INTEGER,
        cluster_count INTEGER,
        market_count INTEGER,
        payload_json VARCHAR
      )
    `);
    await connection.run(`
      CREATE TABLE IF NOT EXISTS historical_datasets (
        dataset_id VARCHAR PRIMARY KEY,
        provider VARCHAR,
        source_version VARCHAR,
        imported_at VARCHAR,
        raw_record_count INTEGER,
        frame_count INTEGER,
        warmup_frame_count INTEGER,
        bucket_hours INTEGER,
        first_valid_time VARCHAR,
        last_valid_time VARCHAR,
        first_transaction_time VARCHAR,
        last_transaction_time VARCHAR,
        metadata_json VARCHAR
      )
    `);
    return connection as DuckDbConnection;
  })().catch((error) => {
    connectionCache.delete(normalized);
    throw error;
  });

  connectionCache.set(normalized, promise);
  return promise;
}

function parseRawRow(row: Record<string, unknown>): HistoricalRawReplayRecord {
  return {
    id: String(row.id || ''),
    datasetId: String(row.dataset_id || ''),
    provider: String(row.provider || ''),
    sourceKind: String(row.source_kind || 'api') as HistoricalRawReplayRecord['sourceKind'],
    sourceId: String(row.source_id || ''),
    itemKind: String(row.item_kind || 'news') as HistoricalRawKind,
    validTimeStart: String(row.valid_time_start || new Date(0).toISOString()),
    validTimeEnd: row.valid_time_end ? String(row.valid_time_end) : null,
    transactionTime: String(row.transaction_time || new Date(0).toISOString()),
    knowledgeBoundary: String(row.knowledge_boundary || row.transaction_time || new Date(0).toISOString()),
    headline: row.headline ? String(row.headline) : null,
    link: row.link ? String(row.link) : null,
    symbol: row.symbol ? String(row.symbol) : null,
    region: row.region ? String(row.region) : null,
    price: typeof row.price === 'number' ? row.price : toNumber(row.price),
    payload:
      typeof row.payload_json === 'string' && row.payload_json
        ? (JSON.parse(row.payload_json) as Record<string, unknown>)
        : {},
    metadata:
      typeof row.metadata_json === 'string' && row.metadata_json
        ? (JSON.parse(row.metadata_json) as Record<string, unknown>)
        : {},
  };
}

function parseFrameRow(row: Record<string, unknown>): HistoricalReplayFrameArchiveRow {
  const payload = reviveFrame(String(row.payload_json || '{}'));
  return {
    id: String(row.id || ''),
    datasetId: String(row.dataset_id || ''),
    bucketHours: Number(row.bucket_hours || DEFAULT_BUCKET_HOURS),
    bucketStart: String(row.bucket_start || payload.timestamp || new Date(0).toISOString()),
    bucketEnd: String(row.bucket_end || payload.timestamp || new Date(0).toISOString()),
    validTimeStart: String(row.valid_time_start || payload.validTimeStart || payload.timestamp || new Date(0).toISOString()),
    validTimeEnd: row.valid_time_end ? String(row.valid_time_end) : payload.validTimeEnd ?? null,
    transactionTime: String(row.transaction_time || payload.transactionTime || payload.timestamp || new Date(0).toISOString()),
    knowledgeBoundary: String(row.knowledge_boundary || payload.knowledgeBoundary || payload.timestamp || new Date(0).toISOString()),
    warmup: Boolean(row.warmup),
    payloadJson: String(row.payload_json || '{}'),
    newsCount: Number(row.news_count || 0),
    clusterCount: Number(row.cluster_count || 0),
    marketCount: Number(row.market_count || 0),
    payload,
  };
}

async function readJsonPreamble(filePath: string, maxBytes = 131_072): Promise<string> {
  const handle = await open(filePath, 'r');
  try {
    const buffer = Buffer.allocUnsafe(maxBytes);
    const { bytesRead } = await handle.read(buffer, 0, maxBytes, 0);
    return buffer.subarray(0, bytesRead).toString('utf8');
  } finally {
    await handle.close();
  }
}

function extractJsonString(preamble: string, keys: string[]): string | null {
  for (const key of keys) {
    const match = preamble.match(new RegExp(`"${key}"\\s*:\\s*"([^"]+)"`, 'i'));
    if (match?.[1]) return match[1];
  }
  return null;
}

interface StreamTransformContext {
  datasetId: string;
  provider: string;
  sourceVersion: string | null;
  fetchedAt: string;
  requestId: string | null;
  seriesId: string | null;
  transactionTimeMode: HistoricalTransactionTimeMode;
}

type StreamJsonToken = {
  name?: string;
  value?: unknown;
};

function buildCoingeckoRecord(
  point: unknown,
  _index: number,
  context: StreamTransformContext,
): HistoricalRawReplayRecord | null {
  if (!Array.isArray(point)) return null;
  const validTimeStart = toIso(point[0], context.fetchedAt);
  const assetId = String(context.requestId || context.datasetId || 'coingecko').trim();
  const transactionTime = resolveTransactionTime(
    null,
    validTimeStart,
    context.fetchedAt,
    context.transactionTimeMode,
  );
  return {
    id: stableId([context.datasetId, context.provider, assetId, 'price', validTimeStart]),
    datasetId: context.datasetId,
    provider: context.provider,
    sourceKind: 'api',
    sourceId: `coingecko:${assetId}`,
    itemKind: 'market',
    validTimeStart,
    validTimeEnd: null,
    transactionTime,
    knowledgeBoundary: transactionTime,
    headline: `${assetId.toUpperCase()} price`,
    link: null,
    symbol: assetId.toUpperCase(),
    region: null,
    price: toNumber(point[1]),
    payload: {
      price: point[1],
      provider: context.provider,
    },
    metadata: {
      provider: context.provider,
      requestId: assetId,
      sourceVersion: context.sourceVersion,
    },
  };
}

function buildFredObservationRecord(
  row: Record<string, unknown>,
  _index: number,
  context: StreamTransformContext,
): HistoricalRawReplayRecord {
  const seriesId = String(context.seriesId || context.requestId || context.datasetId || 'FRED').trim();
  const validTimeStart = toIso(row.date || row.observation_date || context.fetchedAt, context.fetchedAt);
  const transactionTime = resolveTransactionTime(
    row.realtime_start || row.realtimeStart || row.fetchedAt,
    validTimeStart,
    context.fetchedAt,
    context.transactionTimeMode,
  );
  return {
    id: stableId([context.datasetId, context.provider, seriesId, validTimeStart]),
    datasetId: context.datasetId,
    provider: context.provider,
    sourceKind: 'api',
    sourceId: `${context.provider}:${seriesId}`,
    itemKind: 'market',
    validTimeStart,
    validTimeEnd: null,
    transactionTime,
    knowledgeBoundary: transactionTime,
    headline: `${seriesId} observation`,
    link: null,
    symbol: seriesId.toUpperCase(),
    region: null,
    price: toNumber(row.value || row.observed_value),
    payload: {
      ...row,
      provider: context.provider,
    },
    metadata: {
      provider: context.provider,
      seriesId,
      sourceVersion: context.sourceVersion,
    },
  };
}

function buildGdeltArticleRecord(
  article: Record<string, unknown>,
  _index: number,
  context: StreamTransformContext,
): HistoricalRawReplayRecord {
  const validTimeStart = toIso(
    article.seendate || article.date || article.published || context.fetchedAt,
    context.fetchedAt,
  );
  const transactionTime = resolveTransactionTime(
    article.seendate || article.date || article.published,
    validTimeStart,
    context.fetchedAt,
    context.transactionTimeMode,
  );
  const title = normalizeTitle(article.title || article.title_translated, 'GDELT article');
  const link =
    typeof article.url === 'string'
      ? article.url
      : typeof article.link === 'string'
        ? article.link
        : null;
  return {
    id: stableId([context.datasetId, context.provider, link || title, validTimeStart]),
    datasetId: context.datasetId,
    provider: context.provider,
    sourceKind: 'api',
    sourceId: 'gdelt-doc',
    itemKind: 'news',
    validTimeStart,
    validTimeEnd: null,
    transactionTime,
    knowledgeBoundary: transactionTime,
    headline: title,
    link,
    symbol: null,
    region: typeof article.sourcecountry === 'string' ? article.sourcecountry : null,
    price: null,
    payload: article,
    metadata: {
      sourceName: article.domain || 'GDELT',
      sourceTier: 3,
      language: article.language || null,
      sourceVersion: context.sourceVersion,
    },
  };
}

function buildAcledRecord(
  row: Record<string, unknown>,
  _index: number,
  context: StreamTransformContext,
): HistoricalRawReplayRecord {
  const validTimeStart = toIso(row.event_date || row.timestamp || context.fetchedAt, context.fetchedAt);
  const transactionTime = resolveTransactionTime(
    row.timestamp || row.event_date,
    validTimeStart,
    context.fetchedAt,
    context.transactionTimeMode,
  );
  const headline = normalizeTitle(
    row.notes || row.sub_event_type || row.event_type,
    'ACLED event',
  );
  return {
    id: stableId([
      context.datasetId,
      context.provider,
      typeof row.event_id_cnty === 'string' || typeof row.event_id_cnty === 'number'
        ? row.event_id_cnty
        : headline,
      validTimeStart,
    ]),
    datasetId: context.datasetId,
    provider: context.provider,
    sourceKind: 'api',
    sourceId: 'acled',
    itemKind: 'news',
    validTimeStart,
    validTimeEnd: null,
    transactionTime,
    knowledgeBoundary: transactionTime,
    headline,
    link: null,
    symbol: null,
    region:
      typeof row.country === 'string'
        ? row.country
        : typeof row.region === 'string'
          ? row.region
          : null,
    price: null,
    payload: row,
    metadata: {
      sourceName: 'ACLED',
      sourceTier: 2,
      sourceVersion: context.sourceVersion,
    },
  };
}

function buildGenericRowRecord(
  row: Record<string, unknown>,
  index: number,
  context: StreamTransformContext,
): HistoricalRawReplayRecord {
  const validTimeStart = toIso(
    row.validTimeStart || row.publishedAt || row.timestamp || context.fetchedAt,
    context.fetchedAt,
  );
  const transactionTime = resolveTransactionTime(
    row.transactionTime || row.discoveredAt || row.crawledAt,
    validTimeStart,
    context.fetchedAt,
    context.transactionTimeMode,
  );
  const headline = normalizeTitle(row.headline || row.title, `${context.provider} item`);
  return {
    id: stableId([
      context.datasetId,
      context.provider,
      typeof row.id === 'string' || typeof row.id === 'number' ? row.id : headline,
      validTimeStart,
      index,
    ]),
    datasetId: context.datasetId,
    provider: context.provider,
    sourceKind: 'api',
    sourceId: String(row.sourceId || context.provider),
    itemKind: toNumber(row.price) !== null ? 'market' : 'news',
    validTimeStart,
    validTimeEnd: null,
    transactionTime,
    knowledgeBoundary: transactionTime,
    headline,
    link: typeof row.link === 'string' ? row.link : null,
    symbol: typeof row.symbol === 'string' ? row.symbol : null,
    region: typeof row.region === 'string' ? row.region : null,
    price: toNumber(row.price),
    payload: row,
    metadata: {
      sourceName: row.sourceName || context.provider,
      sourceFamily: row.sourceFamily || null,
      featureFamily: row.featureFamily || null,
      sourceVersion: context.sourceVersion,
    },
  };
}

function buildGenericTupleRecord(
  row: unknown[],
  index: number,
  context: StreamTransformContext,
): HistoricalRawReplayRecord | null {
  if (row.length < 2) return null;
  const validTimeStart = toIso(row[0], context.fetchedAt);
  const numericValue = toNumber(row[1]);
  if (numericValue === null) return null;
  const symbol = String(context.requestId || context.seriesId || context.datasetId || context.provider)
    .trim()
    .toUpperCase();
  return {
    id: stableId([context.datasetId, context.provider, symbol, validTimeStart, index]),
    datasetId: context.datasetId,
    provider: context.provider,
    sourceKind: 'api',
    sourceId: `${context.provider}:${symbol}`,
    itemKind: 'market',
    validTimeStart,
    validTimeEnd: null,
    transactionTime: resolveTransactionTime(null, validTimeStart, context.fetchedAt, context.transactionTimeMode),
    knowledgeBoundary: resolveTransactionTime(null, validTimeStart, context.fetchedAt, context.transactionTimeMode),
    headline: `${symbol} point`,
    link: null,
    symbol,
    region: null,
    price: numericValue,
    payload: {
      point: row,
      provider: context.provider,
    },
    metadata: {
      sourceName: context.provider,
      sourceVersion: context.sourceVersion,
    },
  };
}

function looksLikeGenericRecordObject(value: Record<string, unknown>): boolean {
  const keys = Object.keys(value);
  if (keys.length === 0) return false;
  return keys.some((key) =>
    [
      'title',
      'headline',
      'publishedAt',
      'timestamp',
      'date',
      'event_date',
      'price',
      'value',
      'symbol',
      'link',
      'url',
      'notes',
      'id',
    ].includes(key),
  );
}

function looksLikeGenericTupleRecord(value: unknown[]): boolean {
  return value.length >= 2 && (typeof value[0] === 'string' || toNumber(value[0]) !== null) && toNumber(value[1]) !== null;
}

function buildStreamedRecordsForProvider(
  provider: string,
  item: unknown,
  index: number,
  context: StreamTransformContext,
): HistoricalRawReplayRecord[] {
  if (provider === 'coingecko') {
    const record = buildCoingeckoRecord(item, index, context);
    return record ? [record] : [];
  }
  if (provider === 'fred' || provider === 'alfred') {
    if (!item || typeof item !== 'object') return [];
    return [buildFredObservationRecord(item as Record<string, unknown>, index, context)];
  }
  if (provider === 'gdelt-doc') {
    if (!item || typeof item !== 'object') return [];
    return [buildGdeltArticleRecord(item as Record<string, unknown>, index, context)];
  }
  if (provider === 'acled') {
    if (!item || typeof item !== 'object') return [];
    return [buildAcledRecord(item as Record<string, unknown>, index, context)];
  }
  if (Array.isArray(item)) {
    const record = buildGenericTupleRecord(item, index, context);
    return record ? [record] : [];
  }
  if (!item || typeof item !== 'object') return [];
  return [buildGenericRowRecord(item as Record<string, unknown>, index, context)];
}

function candidateJsonPaths(provider: string): string[][] {
  switch (provider) {
    case 'coingecko':
      return [['envelope', 'data', 'prices'], ['data', 'prices'], ['prices']];
    case 'fred':
    case 'alfred':
      return [
        ['envelope', 'data', 'observations', 'observations'],
        ['envelope', 'data', 'observations'],
        ['data', 'observations', 'observations'],
        ['observations', 'observations'],
        ['data', 'observations'],
        ['observations'],
      ];
    case 'gdelt-doc':
      return [['envelope', 'data', 'articles'], ['data', 'articles'], ['articles']];
    case 'acled':
      return [['envelope', 'data', 'data'], ['envelope', 'data'], ['data', 'data'], ['data']];
    default:
      return [['envelope', 'data', 'items'], ['data', 'items'], ['items'], ['envelope', 'data'], ['data'], []];
  }
}

async function streamJsonArrayItems(
  filePath: string,
  pathCandidates: string[][],
  onItem: (value: unknown, index: number) => Promise<void> | void,
): Promise<{ path: string[]; itemCount: number } | null> {
  for (const candidate of pathCandidates) {
    try {
      const base = createReadStream(filePath).pipe(createJsonParser());
      const stream =
        candidate.length > 0
          ? base.pipe(pick({ filter: candidate.join('.') })).pipe(streamArray())
          : base.pipe(streamArray());
      let itemCount = 0;
      for await (const chunk of stream as AsyncIterable<{ key: number; value: unknown }>) {
        await onItem(chunk.value, itemCount);
        itemCount += 1;
      }
      if (itemCount > 0) {
        return { path: candidate, itemCount };
      }
    } catch {
      // Try the next candidate path.
    }
  }
  return null;
}

async function streamGenericJsonRecords(
  filePath: string,
  onItem: (value: unknown, index: number) => Promise<void> | void,
): Promise<{ itemCount: number } | null> {
  type Container = {
    kind: 'object' | 'array';
    key: string | null;
    collect: boolean;
    isRoot: boolean;
    value: Record<string, unknown> | unknown[];
    currentKey: string | null;
  };

  const stream = createReadStream(filePath).pipe(createJsonParser());
  const stack: Container[] = [];
  let itemCount = 0;

  const current = (): Container | null => stack[stack.length - 1] || null;

  const attachScalar = (scalar: unknown) => {
    const container = current();
    if (!container) return;
    if (container.kind === 'object') {
      if (!container.collect || !container.currentKey) return;
      (container.value as Record<string, unknown>)[container.currentKey] = scalar as never;
      container.currentKey = null;
      return;
    }
    if (container.collect) {
      (container.value as unknown[]).push(scalar);
    }
  };

  const maybeEmit = async (value: unknown, parent: Container | null) => {
    if (parent?.kind === 'array' && !parent.collect) {
      await onItem(value, itemCount);
      itemCount += 1;
      return;
    }
    if (!parent && value && typeof value === 'object' && !Array.isArray(value)) {
      await onItem(value, itemCount);
      itemCount += 1;
    }
  };

  for await (const token of stream as AsyncIterable<StreamJsonToken>) {
    switch (token.name) {
      case 'startObject': {
        const parent = current();
        const key = parent?.kind === 'object' ? parent.currentKey : null;
        const collect =
          !parent
            ? true
            : parent.kind === 'array'
              ? true
              : parent.collect && !parent.isRoot;
        stack.push({
          kind: 'object',
          key,
          collect,
          isRoot: !parent,
          value: {},
          currentKey: null,
        });
        break;
      }
      case 'startArray': {
        const parent = current();
        const key = parent?.kind === 'object' ? parent.currentKey : null;
        const collect =
          !parent
            ? false
            : parent.kind === 'array'
              ? true
              : parent.collect && !parent.isRoot;
        stack.push({
          kind: 'array',
          key,
          collect,
          isRoot: !parent,
          value: [],
          currentKey: null,
        });
        break;
      }
      case 'keyValue': {
        const container = current();
        if (container?.kind === 'object') {
          container.currentKey = String(token.value || '');
        }
        break;
      }
      case 'stringValue':
      case 'numberValue':
      case 'nullValue':
      case 'trueValue':
      case 'falseValue': {
        attachScalar(token.value ?? null);
        break;
      }
      case 'endObject':
      case 'endArray': {
        const finished = stack.pop();
        if (!finished) break;
        const parent = current();
        const produced = finished.value;
        if (parent?.kind === 'object' && finished.key && parent.collect) {
          (parent.value as Record<string, unknown>)[finished.key] = produced as never;
          parent.currentKey = null;
        } else if (parent?.kind === 'array' && parent.collect) {
          (parent.value as unknown[]).push(produced);
        }

        if (
          (finished.kind === 'object' && looksLikeGenericRecordObject(produced as Record<string, unknown>))
          || (finished.kind === 'array' && looksLikeGenericTupleRecord(produced as unknown[]))
        ) {
          await maybeEmit(produced, parent);
        }
        break;
      }
      default:
        break;
    }
  }

  return itemCount > 0 ? { itemCount } : null;
}

function extractObservations(payload: Record<string, unknown>): Record<string, unknown>[] {
  if (Array.isArray(payload.observations)) {
    return payload.observations as Record<string, unknown>[];
  }
  const nested = payload.observations as Record<string, unknown> | undefined;
  if (nested && Array.isArray(nested.observations)) {
    return nested.observations as Record<string, unknown>[];
  }
  return [];
}

function transformEnvelopeToRecords(
  input: Record<string, unknown>,
  fallbackProvider?: string,
  datasetIdArg?: string,
  sourceVersionArg?: string | null,
  transactionTimeModeArg?: HistoricalTransactionTimeMode,
): {
  datasetId: string;
  provider: string;
  sourceVersion: string | null;
  records: HistoricalRawReplayRecord[];
} {
  const provider = String(
    input.provider ||
      fallbackProvider ||
      (input.envelope as Record<string, unknown> | undefined)?.provider ||
      'historical',
  ).trim();
  const datasetId = String(input.datasetId || datasetIdArg || defaultDatasetId(provider));
  const sourceVersion =
    (typeof input.sourceVersion === 'string' && input.sourceVersion.trim()) ||
    sourceVersionArg ||
    null;
  const fetchedAt = toIso(input.fetchedAt || input.importedAt || input.timestamp || nowIso());
  const envelope = ((input.envelope as Record<string, unknown> | undefined) || input) as Record<
    string,
    unknown
  >;
  const payload = ((envelope.data as Record<string, unknown> | undefined) ||
    (envelope.payload as Record<string, unknown> | undefined) ||
    (input.payload as Record<string, unknown> | undefined) ||
    envelope) as Record<string, unknown>;
  const records: HistoricalRawReplayRecord[] = [];
  const transactionTimeMode = transactionTimeModeArg || defaultTransactionTimeMode(provider);

  const pushRecord = (record: HistoricalRawReplayRecord) => {
    records.push({
      ...record,
      datasetId,
      provider,
      knowledgeBoundary: record.knowledgeBoundary || record.transactionTime,
      metadata: {
        ...record.metadata,
        sourceVersion,
      },
    });
  };

  if (provider === 'coingecko') {
    const request = ((envelope.request as Record<string, unknown> | undefined) ||
      (input.request as Record<string, unknown> | undefined) ||
      {}) as Record<string, unknown>;
    const id = String(request.id || payload.id || 'coingecko').trim();
    const prices = Array.isArray(payload.prices)
      ? (payload.prices as Array<[number, number]>)
      : [];
    prices.forEach((point) => {
      const validTimeStart = toIso(point?.[0], fetchedAt);
      pushRecord({
        id: stableId([datasetId, provider, id, 'price', validTimeStart]),
        datasetId,
        provider,
        sourceKind: 'api',
        sourceId: `coingecko:${id}`,
        itemKind: 'market',
        validTimeStart,
        validTimeEnd: null,
        transactionTime: resolveTransactionTime(null, validTimeStart, fetchedAt, transactionTimeMode),
        knowledgeBoundary: resolveTransactionTime(null, validTimeStart, fetchedAt, transactionTimeMode),
        headline: `${id.toUpperCase()} price`,
        link: typeof payload.link === 'string' ? payload.link : null,
        symbol: id.toUpperCase(),
        region: null,
        price: toNumber(point?.[1]),
        payload: {
          price: point?.[1],
          provider,
        },
        metadata: {
          provider,
          requestId: id,
        },
      });
    });
  } else if (provider === 'fred' || provider === 'alfred') {
    const request = ((envelope.request as Record<string, unknown> | undefined) ||
      (input.request as Record<string, unknown> | undefined) ||
      {}) as Record<string, unknown>;
    const seriesId = String(request.seriesId || payload.seriesId || payload.id || 'FRED').trim();
    const observations = extractObservations(payload);
    observations.forEach((row) => {
      const validTimeStart = toIso(row.date || row.observation_date || fetchedAt, fetchedAt);
      const transactionTime = resolveTransactionTime(
        row.realtime_start || row.realtimeStart || row.fetchedAt,
        validTimeStart,
        fetchedAt,
        transactionTimeMode,
      );
      const numericValue = toNumber(row.value || row.observed_value);
      pushRecord({
        id: stableId([datasetId, provider, seriesId, validTimeStart]),
        datasetId,
        provider,
        sourceKind: 'api',
        sourceId: `${provider}:${seriesId}`,
        itemKind: 'market',
        validTimeStart,
        validTimeEnd: null,
        transactionTime,
        knowledgeBoundary: transactionTime,
        headline: `${seriesId} observation`,
        link: null,
        symbol: seriesId.toUpperCase(),
        region: null,
        price: numericValue,
        payload: {
          ...row,
          provider,
        },
        metadata: {
          provider,
          seriesId,
        },
      });
    });
  } else if (provider === 'gdelt-doc') {
    const articles = Array.isArray(payload.articles)
      ? (payload.articles as Record<string, unknown>[])
      : [];
    articles.forEach((article) => {
      const validTimeStart = toIso(
        article.seendate || article.date || article.published || fetchedAt,
        fetchedAt,
      );
      const transactionTime = resolveTransactionTime(
        article.seendate || article.date || article.published,
        validTimeStart,
        fetchedAt,
        transactionTimeMode,
      );
      const title = normalizeTitle(article.title || article.title_translated, 'GDELT article');
      const link =
        typeof article.url === 'string'
          ? article.url
          : typeof article.link === 'string'
            ? article.link
            : null;
      pushRecord({
        id: stableId([datasetId, provider, link || title, validTimeStart]),
        datasetId,
        provider,
        sourceKind: 'api',
        sourceId: 'gdelt-doc',
        itemKind: 'news',
        validTimeStart,
        validTimeEnd: null,
        transactionTime,
        knowledgeBoundary: transactionTime,
        headline: title,
        link,
        symbol: null,
        region: typeof article.sourcecountry === 'string' ? article.sourcecountry : null,
        price: null,
        payload: article,
        metadata: {
          sourceName: article.domain || 'GDELT',
          sourceTier: 3,
          language: article.language || null,
        },
      });
    });
  } else if (provider === 'acled') {
    const rows = Array.isArray(payload.data) ? (payload.data as Record<string, unknown>[]) : [];
    rows.forEach((row) => {
      const validTimeStart = toIso(row.event_date || row.timestamp || fetchedAt, fetchedAt);
      const transactionTime = resolveTransactionTime(
        row.timestamp || row.event_date,
        validTimeStart,
        fetchedAt,
        transactionTimeMode,
      );
      const headline = normalizeTitle(
        row.notes || row.sub_event_type || row.event_type,
        'ACLED event',
      );
      pushRecord({
        id: stableId([
          datasetId,
          provider,
          typeof row.event_id_cnty === 'string' || typeof row.event_id_cnty === 'number'
            ? row.event_id_cnty
            : headline,
          validTimeStart,
        ]),
        datasetId,
        provider,
        sourceKind: 'api',
        sourceId: 'acled',
        itemKind: 'news',
        validTimeStart,
        validTimeEnd: null,
        transactionTime,
        knowledgeBoundary: transactionTime,
        headline,
        link: null,
        symbol: null,
        region:
          typeof row.country === 'string'
            ? row.country
            : typeof row.region === 'string'
              ? row.region
              : null,
        price: null,
        payload: row,
        metadata: {
          sourceName: 'ACLED',
          sourceTier: 2,
        },
      });
    });
  } else {
    const rows = Array.isArray(payload.items)
      ? (payload.items as Record<string, unknown>[])
      : Array.isArray(payload.data)
        ? (payload.data as Record<string, unknown>[])
        : Array.isArray(input.data)
          ? (input.data as Record<string, unknown>[])
          : [];
    rows.forEach((row, index) => {
      const validTimeStart = toIso(
        row.validTimeStart || row.publishedAt || row.timestamp || fetchedAt,
        fetchedAt,
      );
      const transactionTime = resolveTransactionTime(
        row.transactionTime || row.discoveredAt || row.crawledAt,
        validTimeStart,
        fetchedAt,
        transactionTimeMode,
      );
      const headline = normalizeTitle(row.headline || row.title, `${provider} item`);
      pushRecord({
        id: stableId([
          datasetId,
          provider,
          typeof row.id === 'string' || typeof row.id === 'number' ? row.id : headline,
          validTimeStart,
          index,
        ]),
        datasetId,
        provider,
        sourceKind: 'api',
        sourceId: String(row.sourceId || provider),
        itemKind: toNumber(row.price) !== null ? 'market' : 'news',
        validTimeStart,
        validTimeEnd: null,
        transactionTime,
        knowledgeBoundary: transactionTime,
        headline,
        link: typeof row.link === 'string' ? row.link : null,
        symbol: typeof row.symbol === 'string' ? row.symbol : null,
        region: typeof row.region === 'string' ? row.region : null,
        price: toNumber(row.price),
        payload: row,
        metadata: {
          sourceName: row.sourceName || provider,
        },
      });
    });
  }

  return {
    datasetId,
    provider,
    sourceVersion,
    records,
  };
}

async function appendRawRecordsToDuckDb(
  records: HistoricalRawReplayRecord[],
  dbPath: string,
): Promise<void> {
  if (records.length === 0) return;
  const connection = await ensureHistoricalReplayArchive(dbPath);
  await connection.run('BEGIN TRANSACTION');
  try {
    for (const record of records) {
      await connection.run(
        `
        INSERT OR REPLACE INTO historical_raw_items (
          id, dataset_id, provider, source_kind, source_id, item_kind,
          valid_time_start, valid_time_end, transaction_time, knowledge_boundary,
          headline, link, symbol, region, price, payload_json, metadata_json
        ) VALUES (
          $id, $datasetId, $provider, $sourceKind, $sourceId, $itemKind,
          $validTimeStart, $validTimeEnd, $transactionTime, $knowledgeBoundary,
          $headline, $link, $symbol, $region, $price, $payloadJson, $metadataJson
        )
      `,
        {
          id: record.id,
          datasetId: record.datasetId,
          provider: record.provider,
          sourceKind: record.sourceKind,
          sourceId: record.sourceId,
          itemKind: record.itemKind,
          validTimeStart: record.validTimeStart,
          validTimeEnd: record.validTimeEnd,
          transactionTime: record.transactionTime,
          knowledgeBoundary: record.knowledgeBoundary,
          headline: record.headline,
          link: record.link,
          symbol: record.symbol,
          region: record.region,
          price: record.price,
          payloadJson: JSON.stringify(record.payload || {}),
          metadataJson: JSON.stringify(record.metadata || {}),
        },
      );
    }
    await connection.run('COMMIT');
  } catch (error) {
    await connection.run('ROLLBACK');
    throw error;
  }
}

function shouldReplaceDatasetRawItemsOnImport(provider: string): boolean {
  return ['coingecko', 'fred', 'alfred', 'yahoo-chart'].includes(String(provider || '').trim().toLowerCase());
}

async function deleteDatasetRawItems(
  connection: DuckDbConnection,
  datasetId: string,
): Promise<void> {
  await connection.run(
    `
      DELETE FROM historical_raw_items
      WHERE dataset_id = $datasetId
    `,
    { datasetId },
  );
}

async function replaceDatasetFrames(
  frames: MaterializedFrameRow[],
  datasetId: string,
  dbPath: string,
): Promise<void> {
  const connection = await ensureHistoricalReplayArchive(dbPath);
  await connection.run('BEGIN TRANSACTION');
  try {
    await connection.run(
      `DELETE FROM historical_replay_frames WHERE dataset_id = $datasetId`,
      { datasetId },
    );
    for (const frame of frames) {
      await connection.run(
        `
        INSERT OR REPLACE INTO historical_replay_frames (
          id, dataset_id, bucket_hours, bucket_start, bucket_end,
          valid_time_start, valid_time_end, transaction_time, knowledge_boundary,
          warmup, news_count, cluster_count, market_count, payload_json
        ) VALUES (
          $id, $datasetId, $bucketHours, $bucketStart, $bucketEnd,
          $validTimeStart, $validTimeEnd, $transactionTime, $knowledgeBoundary,
          $warmup, $newsCount, $clusterCount, $marketCount, $payloadJson
        )
      `,
        {
          ...frame,
        },
      );
    }
    await connection.run('COMMIT');
  } catch (error) {
    await connection.run('ROLLBACK');
    throw error;
  }
}

async function readHistoricalRawCorpusStatsForDataset(
  connection: DuckDbConnection,
  datasetId: string,
): Promise<{
  rawRecordCount: number;
  firstValidTime: string | null;
  lastValidTime: string | null;
  firstTransactionTime: string | null;
  lastTransactionTime: string | null;
}> {
  const result = await connection.runAndReadAll(
    `
      SELECT
        COUNT(*) AS total,
        MIN(valid_time_start) AS first_valid_time,
        MAX(valid_time_start) AS last_valid_time,
        MIN(transaction_time) AS first_transaction_time,
        MAX(transaction_time) AS last_transaction_time
      FROM historical_raw_items
      WHERE dataset_id = $datasetId
    `,
    { datasetId },
  );
  const row = result.getRowObjectsJS()[0];
  return {
    rawRecordCount: Math.max(0, Number(row?.total || 0)),
    firstValidTime: row?.first_valid_time ? String(row.first_valid_time) : null,
    lastValidTime: row?.last_valid_time ? String(row.last_valid_time) : null,
    firstTransactionTime: row?.first_transaction_time ? String(row.first_transaction_time) : null,
    lastTransactionTime: row?.last_transaction_time ? String(row.last_transaction_time) : null,
  };
}

async function upsertDatasetSummary(
  summary: HistoricalDatasetSummary,
  dbPath: string,
): Promise<void> {
  const connection = await ensureHistoricalReplayArchive(dbPath);
  await connection.run(
    `
    INSERT OR REPLACE INTO historical_datasets (
      dataset_id, provider, source_version, imported_at, raw_record_count,
      frame_count, warmup_frame_count, bucket_hours, first_valid_time,
      last_valid_time, first_transaction_time, last_transaction_time, metadata_json
    ) VALUES (
      $datasetId, $provider, $sourceVersion, $importedAt, $rawRecordCount,
      $frameCount, $warmupFrameCount, $bucketHours, $firstValidTime,
      $lastValidTime, $firstTransactionTime, $lastTransactionTime, $metadataJson
    )
  `,
    {
      datasetId: summary.datasetId,
      provider: summary.provider,
      sourceVersion: summary.sourceVersion,
      importedAt: summary.importedAt,
      rawRecordCount: summary.rawRecordCount,
      frameCount: summary.frameCount,
      warmupFrameCount: summary.warmupFrameCount,
      bucketHours: summary.bucketHours,
      firstValidTime: summary.firstValidTime,
      lastValidTime: summary.lastValidTime,
      firstTransactionTime: summary.firstTransactionTime,
      lastTransactionTime: summary.lastTransactionTime,
      metadataJson: JSON.stringify(summary.metadata || {}),
    },
  );
}

async function readHistoricalRawRecordsFromConnection(
  connection: DuckDbConnection,
  options: HistoricalRawRecordLoadOptions = {},
): Promise<HistoricalRawReplayRecord[]> {
  const clauses: string[] = [];
  const params: Record<string, unknown> = {};

  if (options.datasetId) {
    clauses.push('dataset_id = $datasetId');
    params.datasetId = options.datasetId;
  }
  if (options.startTransactionTime) {
    clauses.push('transaction_time >= $startTransactionTime');
    params.startTransactionTime = toIso(options.startTransactionTime);
  }
  if (options.endTransactionTime) {
    clauses.push('transaction_time <= $endTransactionTime');
    params.endTransactionTime = toIso(options.endTransactionTime);
  }
  if (options.knowledgeBoundaryCeiling) {
    clauses.push('knowledge_boundary <= $knowledgeBoundaryCeiling');
    params.knowledgeBoundaryCeiling = toIso(options.knowledgeBoundaryCeiling);
  }

  const whereClause = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
  const limit =
    typeof options.limit === 'number' && options.limit > 0 ? Math.floor(options.limit) : 1000;
  const offset =
    typeof options.offset === 'number' && options.offset > 0 ? Math.floor(options.offset) : 0;

  const result = await connection.runAndReadAll(
    `
    SELECT *
    FROM historical_raw_items
    ${whereClause}
    ORDER BY transaction_time ASC, valid_time_start ASC, id ASC
    LIMIT ${limit}
    OFFSET ${offset}
  `,
    params,
  );

  return result.getRowObjectsJS().map(parseRawRow);
}

function buildNewsItem(record: HistoricalRawReplayRecord): NewsItem {
  const payload = record.payload || {};
  const metadata = record.metadata || {};
  const lat = toNumber(payload.lat || payload.latitude || payload.event_latitude);
  const lon = toNumber(payload.lon || payload.longitude || payload.event_longitude);
  return {
    source: newsSourceName(record),
    title: record.headline || 'Historical item',
    link: record.link || '',
    pubDate: new Date(record.validTimeStart),
    isAlert: false,
    tier: typeof metadata.sourceTier === 'number' ? metadata.sourceTier : 4,
    lat: lat ?? undefined,
    lon: lon ?? undefined,
    locationName: record.region || undefined,
    lang: typeof metadata.language === 'string' ? metadata.language : undefined,
  };
}

function buildSimpleClusters(newsItems: NewsItem[], _newsRecords?: HistoricalRawReplayRecord[]): ClusteredEvent[] {
  const groups = new Map<string, NewsItem[]>();
  for (const item of newsItems) {
    const key = normalizeTitle(item.title, 'untitled').toLowerCase();
    const bucket = groups.get(key) || [];
    bucket.push(item);
    groups.set(key, bucket);
  }

  return Array.from(groups.entries()).flatMap(([key, items], index) => {
    const anchor = items[0];
    if (!anchor) return [];
    const firstSeen = items.reduce(
      (earliest, item) => (item.pubDate < earliest ? item.pubDate : earliest),
      anchor.pubDate,
    );
    const lastUpdated = items.reduce(
      (latest, item) => (item.pubDate > latest ? item.pubDate : latest),
      anchor.pubDate,
    );
    return [{
      id: stableId(['cluster', key, index]),
      primaryTitle: anchor.title,
      primarySource: anchor.source || 'Unknown',
      primaryLink: anchor.link,
      sourceCount: items.length,
      topSources: Array.from(new Set(items.map((item) => item.source || 'Unknown')))
        .slice(0, 6)
        .map((name) => ({ name, tier: anchor.tier || 4, url: anchor.link })),
      allItems: items,
      firstSeen,
      lastUpdated,
      isAlert: items.some((item) => item.isAlert),
      threat: undefined,
      lat: anchor.lat,
      lon: anchor.lon,
      lang: anchor.lang,
    }];
  });
}

function countTimeSkewWarnings(newsItems: NewsItem[], skewMs = 30 * 60 * 1000): number {
  const buckets = new Map<string, number[]>();
  for (const item of newsItems) {
    const key = normalizeTitle(item.title, 'untitled').toLowerCase();
    const ts = item.pubDate?.getTime?.() ?? NaN;
    if (!Number.isFinite(ts)) continue;
    const bucket = buckets.get(key) || [];
    bucket.push(ts);
    buckets.set(key, bucket);
  }
  let warnings = 0;
  for (const values of buckets.values()) {
    if (values.length < 2) continue;
    const minTs = Math.min(...values);
    const maxTs = Math.max(...values);
    if ((maxTs - minTs) > skewMs) warnings += 1;
  }
  return warnings;
}

function serializeFrame(frame: HistoricalReplayFrame): string {
  return JSON.stringify(frame);
}

function reviveFrame(payloadJson: string): HistoricalReplayFrame {
  return JSON.parse(payloadJson) as HistoricalReplayFrame;
}

type PgRowShape = {
  id?: unknown;
  dataset_id?: unknown;
  provider?: unknown;
  source_kind?: unknown;
  source_id?: unknown;
  item_kind?: unknown;
  valid_time_start?: unknown;
  valid_time_end?: unknown;
  transaction_time?: unknown;
  knowledge_boundary?: unknown;
  headline?: unknown;
  link?: unknown;
  symbol?: unknown;
  region?: unknown;
  price?: unknown;
  payload_json?: unknown;
  metadata_json?: unknown;
};

function parsePostgresJsonObject(value: unknown): Record<string, unknown> {
  if (!value) return {};
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value) as unknown;
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? parsed as Record<string, unknown>
        : {};
    } catch {
      return {};
    }
  }
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function parsePostgresRawRow(row: PgRowShape): HistoricalRawReplayRecord {
  return {
    id: String(row.id || ''),
    datasetId: String(row.dataset_id || ''),
    provider: String(row.provider || 'historical'),
    sourceKind: String(row.source_kind || 'api') as HistoricalRawReplayRecord['sourceKind'],
    sourceId: String(row.source_id || row.provider || ''),
    itemKind: String(row.item_kind || 'news') as HistoricalRawKind,
    validTimeStart: toIso(row.valid_time_start || nowIso(), nowIso()),
    validTimeEnd: row.valid_time_end ? toIso(row.valid_time_end) : null,
    transactionTime: toIso(row.transaction_time || row.valid_time_start || nowIso(), nowIso()),
    knowledgeBoundary: toIso(
      row.knowledge_boundary || row.transaction_time || row.valid_time_start || nowIso(),
      nowIso(),
    ),
    headline: row.headline ? String(row.headline) : null,
    link: row.link ? String(row.link) : null,
    symbol: row.symbol ? String(row.symbol) : null,
    region: row.region ? String(row.region) : null,
    price: toNumber(row.price),
    payload: parsePostgresJsonObject(row.payload_json),
    metadata: parsePostgresJsonObject(row.metadata_json),
  };
}

function buildPostgresSourceClusters(
  newsItems: NewsItem[],
  newsRecords: HistoricalRawReplayRecord[],
): ClusteredEvent[] {
  return buildCanonicalEventClusters(newsItems, newsRecords);
}

function filterLoadedFrames(
  frames: HistoricalReplayFrame[],
  options: HistoricalFrameLoadOptions,
): HistoricalReplayFrame[] {
  let filtered = options.includeWarmup ? frames.slice() : frames.filter((frame) => !frame.warmup);
  if (options.startTransactionTime) {
    const startTs = asTs(toIso(options.startTransactionTime));
    filtered = filtered.filter((frame) => asTs(frame.transactionTime || frame.timestamp) >= startTs);
  }
  if (options.endTransactionTime) {
    const endTs = asTs(toIso(options.endTransactionTime));
    filtered = filtered.filter((frame) => asTs(frame.transactionTime || frame.timestamp) <= endTs);
  }
  if (options.knowledgeBoundaryCeiling) {
    const ceilingTs = asTs(toIso(options.knowledgeBoundaryCeiling));
    filtered = filtered.filter((frame) => asTs(frame.knowledgeBoundary || frame.timestamp) <= ceilingTs);
  }
  if (options.latestFirst) filtered = filtered.slice().reverse();
  if (typeof options.maxFrames === 'number' && options.maxFrames > 0) {
    filtered = filtered.slice(0, Math.floor(options.maxFrames));
  }
  return options.latestFirst ? filtered.slice().reverse() : filtered;
}

function materializeReplayFramesFromRawRecords(args: {
  records: HistoricalRawReplayRecord[];
  bucketHours: number;
  datasetId?: string;
  sourceVersion?: string | null;
  clusterBuilder?: (newsItems: NewsItem[], newsRecords: HistoricalRawReplayRecord[]) => ClusteredEvent[];
}): HistoricalReplayFrame[] {
  const bucketHours = Math.max(1, Math.floor(args.bucketHours) || DEFAULT_POSTGRES_FRAME_BUCKET_HOURS);
  const bucketMs = bucketHours * 60 * 60 * 1000;
  const sortedRecords = args.records
    .slice()
    .sort((left, right) =>
      asTs(left.validTimeStart) - asTs(right.validTimeStart)
      || asTs(left.transactionTime) - asTs(right.transactionTime)
      || left.id.localeCompare(right.id));
  if (sortedRecords.length === 0) return [];

  const buckets = new Map<number, HistoricalRawReplayRecord[]>();
  for (const record of sortedRecords) {
    const bucketKey = Math.floor(asTs(record.validTimeStart) / bucketMs) * bucketMs;
    const bucket = buckets.get(bucketKey) || [];
    bucket.push(record);
    buckets.set(bucketKey, bucket);
  }

  const bucketKeys = Array.from(buckets.keys()).sort((left, right) => left - right);
  const latestMarketBySymbol = new Map<string, HistoricalRawReplayRecord>();
  const warmupFrameCount = Math.ceil(bucketKeys.length * 0.1);
  const clusterBuilder = args.clusterBuilder || buildSimpleClusters;

  return bucketKeys.map((bucketKey, index) => {
    const bucketRecords = buckets.get(bucketKey) || [];
    const newsRecords = bucketRecords.filter((record) => record.itemKind === 'news');
    const marketRecords = bucketRecords.filter((record) => record.itemKind === 'market');
    for (const record of marketRecords) {
      const symbol = record.symbol || record.headline || record.id;
      const current = latestMarketBySymbol.get(symbol);
      if (!current || shouldReplaceMarketRecord(record, current)) {
        latestMarketBySymbol.set(symbol, record);
      }
    }
    const news = newsRecords.map(buildNewsItem);
    const clusters = clusterBuilder(news, newsRecords);
    const markets = Array.from(latestMarketBySymbol.entries()).map(([symbol, record]) => ({
      symbol,
      name: record.headline || record.symbol || record.id,
      display: record.symbol || record.headline || record.id,
      price: record.price ?? null,
      change: 0,
    })) as MarketData[];
    const bucketStart = new Date(bucketKey).toISOString();
    const bucketEnd = new Date(bucketKey + bucketMs).toISOString();
    const transactionTime = bucketRecords.reduce((latest, record) =>
      asTs(record.transactionTime) > asTs(latest) ? record.transactionTime : latest, bucketEnd);
    const knowledgeBoundary = bucketRecords.reduce((latest, record) =>
      asTs(record.knowledgeBoundary) > asTs(latest) ? record.knowledgeBoundary : latest, transactionTime);
    const datasetId = args.datasetId || bucketRecords.find((record) => record.datasetId)?.datasetId || 'postgres-raw-items';
    const providerCounts = Object.fromEntries(
      bucketRecords.reduce((counts, record) => {
        const key = String(record.provider || 'unknown').trim().toLowerCase();
        counts.set(key, (counts.get(key) || 0) + 1);
        return counts;
      }, new Map<string, number>()),
    );

    return {
      id: stableId([datasetId, bucketStart, bucketHours]),
      timestamp: bucketStart,
      validTimeStart: bucketStart,
      validTimeEnd: bucketEnd,
      transactionTime,
      knowledgeBoundary,
      datasetId,
      sourceVersion: args.sourceVersion || null,
      warmup: index < warmupFrameCount,
      news,
      clusters,
      markets,
      metadata: {
        provider: 'postgres-raw-items',
        bucketHours,
        frameNewsCount: news.length,
        frameMarketCount: markets.length,
        providerCountsJson: JSON.stringify(providerCounts),
      },
    } satisfies HistoricalReplayFrame;
  });
}

export async function loadHistoricalReplayFramesFromPostgres(
  options: HistoricalPostgresFrameLoadOptions = {},
): Promise<HistoricalReplayFrame[]> {
  const { Client } = await import('pg');
  const password = String(
    options.pgConfig?.password
    || process.env.INTEL_PG_PASSWORD
    || process.env.NAS_PG_PASSWORD
    || process.env.PG_PASSWORD
    || process.env.PGPASSWORD
    || '',
  ).trim();
  if (!password) {
    throw new Error(
      '[historical-stream-worker] Missing PostgreSQL password for NAS frame load. Set pgConfig.password or INTEL_PG_PASSWORD / NAS_PG_PASSWORD / PG_PASSWORD.',
    );
  }

  const client = new Client({
    host: options.pgConfig?.host || process.env.PG_HOST || process.env.INTEL_PG_HOST || '192.168.0.76',
    port: Number(options.pgConfig?.port || process.env.PG_PORT || 5433),
    database: options.pgConfig?.database || process.env.PG_DATABASE || process.env.PGDATABASE || 'lattice',
    user: options.pgConfig?.user || process.env.PG_USER || process.env.PGUSER || 'postgres',
    password,
  });

  const buildQuery = (providers: readonly string[]) => {
    const params: unknown[] = [providers];
    const clauses = ['provider = ANY($1::text[])'];
    const effectiveTransactionExpr = 'COALESCE(transaction_time, valid_time_start)';
    const effectiveKnowledgeExpr = 'COALESCE(knowledge_boundary, transaction_time, valid_time_start)';
    if (options.datasetId) {
      params.push(options.datasetId);
      clauses.push(`dataset_id = $${params.length}`);
    }
    if (options.startTransactionTime) {
      params.push(toIso(options.startTransactionTime));
      clauses.push(`${effectiveTransactionExpr} >= $${params.length}`);
    }
    if (options.endTransactionTime) {
      params.push(toIso(options.endTransactionTime));
      clauses.push(`${effectiveTransactionExpr} <= $${params.length}`);
    }
    if (options.knowledgeBoundaryCeiling) {
      params.push(toIso(options.knowledgeBoundaryCeiling));
      clauses.push(`${effectiveKnowledgeExpr} <= $${params.length}`);
    }
    return {
      text: `
        SELECT
          id, dataset_id, provider, source_kind, source_id, item_kind,
          valid_time_start, valid_time_end, transaction_time, knowledge_boundary,
          headline, link, symbol, region, price, payload_json, metadata_json
        FROM raw_items
        WHERE ${clauses.join(' AND ')}
        ORDER BY valid_time_start ASC, ${effectiveTransactionExpr} ASC, id ASC
      `,
      values: params,
    };
  };

  try {
    await client.connect();
    const newsQuery = buildQuery(POSTGRES_NEWS_PROVIDERS);
    const marketQuery = buildQuery(POSTGRES_MARKET_PROVIDERS);
    const macroQuery = buildQuery(POSTGRES_MACRO_PROVIDERS);
    const newsResult = await client.query(newsQuery.text, newsQuery.values);
    const marketResult = await client.query(marketQuery.text, marketQuery.values);
    const macroResult = await client.query(macroQuery.text, macroQuery.values);
    const records = [
      ...newsResult.rows,
      ...marketResult.rows,
      ...macroResult.rows,
    ].map(parsePostgresRawRow);
    const frames = materializeReplayFramesFromRawRecords({
      records,
      bucketHours: DEFAULT_POSTGRES_FRAME_BUCKET_HOURS,
      datasetId: options.datasetId,
      sourceVersion: 'postgres-raw-items',
      clusterBuilder: buildPostgresSourceClusters,
    });
    return filterLoadedFrames(frames, options);
  } finally {
    await client.end().catch(() => {});
  }
}

export async function processHistoricalDump(
  filePath: string,
  options: HistoricalBackfillOptions = {},
): Promise<HistoricalBackfillResult> {
  const chunkSize = clamp(options.chunkSize || DEFAULT_CHUNK_SIZE, 50, 5000);
  const bucketHours = clamp(options.bucketHours || DEFAULT_BUCKET_HOURS, 1, 168);
  const newsLookbackHours = clamp(
    options.newsLookbackHours || DEFAULT_NEWS_LOOKBACK_HOURS,
    bucketHours,
    24 * 30,
  );
  const dbPath = options.dbPath || DEFAULT_DB_PATH;
  const providerHint = options.provider;
  const datasetIdHint = options.datasetId;
  const fileStats = await stat(filePath);
  const checkpointPath = getImportCheckpointPath(dbPath, filePath);
  const releaseDbLock = await acquireDuckDbPathLock(dbPath);
  if (!releaseDbLock) {
    throw new DuckDbPathLockError(
      `DuckDB path is locked for import-historical: ${normalizeDuckDbPath(dbPath)}`,
    );
  }

  try {
    const connection = await ensureHistoricalReplayArchive(dbPath);

    const ext = path.extname(filePath).toLowerCase();
    let datasetId = datasetIdHint || '';
    let provider = providerHint || 'historical';
    let sourceVersion = options.sourceVersion || null;
    let rawRecordCount = 0;
    let firstValidTime: string | null = null;
    let lastValidTime: string | null = null;
    let firstTransactionTime: string | null = null;
    let lastTransactionTime: string | null = null;
    let datasetRawReset = false;
    let invalidRecordCount = 0;
    let invalidTemporalCount = 0;
    let checkpoint: HistoricalImportCheckpoint | null = null;
    try {
      checkpoint = JSON.parse(await readFile(checkpointPath, 'utf8')) as HistoricalImportCheckpoint;
    } catch {
      checkpoint = null;
    }

    const maybeResetDatasetRaw = async () => {
      if (datasetRawReset || !datasetId) return;
      if (!shouldReplaceDatasetRawItemsOnImport(provider)) return;
      await deleteDatasetRawItems(connection, datasetId);
      datasetRawReset = true;
    };

  const flushChunk = async (records: HistoricalRawReplayRecord[]) => {
    if (records.length === 0) return;
    const validRecords: HistoricalRawReplayRecord[] = [];
    for (const record of records) {
      const validation = validateTemporalRecord(record);
      if (!validation.ok) {
        invalidRecordCount += 1;
        invalidTemporalCount += 1;
        continue;
      }
      validRecords.push(record);
    }
    if (validRecords.length === 0) return;
    await appendRawRecordsToDuckDb(validRecords, dbPath);
    rawRecordCount += validRecords.length;
    for (const record of validRecords) {
      firstValidTime = minIso(firstValidTime, record.validTimeStart);
      lastValidTime = maxIso(lastValidTime, record.validTimeStart);
      firstTransactionTime = minIso(firstTransactionTime, record.transactionTime);
      lastTransactionTime = maxIso(lastTransactionTime, record.transactionTime);
    }
  };

  const canReuseRawStage = Boolean(
    checkpoint
    && checkpoint.phase === 'raw-complete'
    && checkpoint.filePath === path.resolve(filePath)
    && checkpoint.fileSize === fileStats.size
    && checkpoint.fileMtimeMs === fileStats.mtimeMs,
  );

  if (canReuseRawStage) {
    datasetId = checkpoint?.datasetId || datasetId;
    provider = checkpoint?.provider || provider;
    const corpusStats = await readHistoricalRawCorpusStatsForDataset(connection, datasetId);
    rawRecordCount = corpusStats.rawRecordCount;
    firstValidTime = corpusStats.firstValidTime;
    lastValidTime = corpusStats.lastValidTime;
    firstTransactionTime = corpusStats.firstTransactionTime;
    lastTransactionTime = corpusStats.lastTransactionTime;
  } else if (ext === '.jsonl' || ext === '.ndjson') {
    const fileStream = createReadStream(filePath);
    const rl = readline.createInterface({
      input: fileStream,
      crlfDelay: Infinity,
    });
    let chunk: HistoricalRawReplayRecord[] = [];
    for await (const line of rl) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const parsed = JSON.parse(trimmed) as Record<string, unknown>;
      const transformed = transformEnvelopeToRecords(
        parsed,
        providerHint,
        datasetIdHint,
        options.sourceVersion,
        options.transactionTimeMode,
      );
      datasetId = datasetId || transformed.datasetId;
      provider = transformed.provider;
      sourceVersion = transformed.sourceVersion;
      await maybeResetDatasetRaw();
      chunk.push(...transformed.records);
      if (chunk.length >= chunkSize) {
        await flushChunk(chunk);
        chunk = [];
      }
    }
    await flushChunk(chunk);
  } else {
    let chunk: HistoricalRawReplayRecord[] = [];
    const preamble = await readJsonPreamble(filePath);
    provider =
      providerHint ||
      extractJsonString(preamble, ['provider']) ||
      extractJsonString(preamble, ['envelope.provider']) ||
      'historical';
    datasetId =
      datasetIdHint ||
      extractJsonString(preamble, ['datasetId']) ||
      defaultDatasetId(provider);
    sourceVersion =
      options.sourceVersion ||
      extractJsonString(preamble, ['sourceVersion']) ||
      null;
    await maybeResetDatasetRaw();
    const context: StreamTransformContext = {
      datasetId,
      provider,
      sourceVersion,
      fetchedAt: toIso(
        extractJsonString(preamble, ['fetchedAt', 'importedAt', 'timestamp']) || nowIso(),
      ),
      requestId: extractJsonString(preamble, ['id', 'request.id']),
      seriesId: extractJsonString(preamble, ['seriesId', 'request.seriesId']),
      transactionTimeMode: options.transactionTimeMode || defaultTransactionTimeMode(provider),
    };
    const streamed = await streamJsonArrayItems(
      filePath,
      candidateJsonPaths(provider),
      async (item, index) => {
        chunk.push(...buildStreamedRecordsForProvider(provider, item, index, context));
        if (chunk.length >= chunkSize) {
          await flushChunk(chunk);
          chunk = [];
        }
      },
    );
    if (streamed) {
      await flushChunk(chunk);
    } else {
      const genericStreamed = await streamGenericJsonRecords(filePath, async (item, index) => {
        chunk.push(...buildStreamedRecordsForProvider(provider, item, index, context));
        if (chunk.length >= chunkSize) {
          await flushChunk(chunk);
          chunk = [];
        }
      });
      if (genericStreamed) {
        await flushChunk(chunk);
      } else {
        const raw = await readFile(filePath, 'utf8');
        const parsed = JSON.parse(raw) as Record<string, unknown>;
        const transformed = transformEnvelopeToRecords(
          parsed,
          providerHint,
          datasetIdHint,
          options.sourceVersion,
          options.transactionTimeMode,
        );
        datasetId = transformed.datasetId;
        provider = transformed.provider;
        sourceVersion = transformed.sourceVersion;
        await maybeResetDatasetRaw();
        for (let index = 0; index < transformed.records.length; index += chunkSize) {
          const page = transformed.records.slice(index, index + chunkSize);
          await flushChunk(page);
        }
      }
    }
  }

    if (!canReuseRawStage) {
      await writeFile(checkpointPath, JSON.stringify({
        filePath: path.resolve(filePath),
        fileSize: fileStats.size,
        fileMtimeMs: fileStats.mtimeMs,
        datasetId,
        provider,
        phase: 'raw-complete',
        rawRecordCount,
        updatedAt: nowIso(),
      } satisfies HistoricalImportCheckpoint, null, 2));
    }

    const frameRows: MaterializedFrameRow[] = [];
    const newsLookbackMs = newsLookbackHours * 60 * 60 * 1000;
    const bucketMs = bucketHours * 60 * 60 * 1000;
    const bucketTimeMode = options.bucketTimeMode || defaultBucketTimeMode(provider);
    let maxMarketKnowledgeBoundary = 0;
    let bucketIndex = 0;
    let activeBucketKey: number | null = null;
    let activeBucketRecords: HistoricalRawReplayRecord[] = [];
    const newsWindow: HistoricalRawReplayRecord[] = [];
    const latestMarketBySymbol = new Map<string, HistoricalRawReplayRecord>();
    let mergeConflictCount = 0;

  const finalizeActiveBucket = () => {
    if (activeBucketKey === null || activeBucketRecords.length === 0) return;
    const bucketStartTs = activeBucketKey;
    const bucketEndTs = bucketStartTs + bucketMs;
    const bucketEndIso = new Date(bucketEndTs).toISOString();
    while (
      newsWindow.length > 0 &&
      asTs(newsWindow[0]?.validTimeStart) < bucketEndTs - newsLookbackMs
    ) {
      newsWindow.shift();
    }
    const visibleNews = newsWindow
      .filter((record) => asTs(record.transactionTime) <= bucketEndTs)
      .filter((record) => {
        const validTs = asTs(record.validTimeStart);
        return validTs <= bucketEndTs && validTs >= bucketEndTs - newsLookbackMs;
      })
      .map(buildNewsItem);
    const timeSkewWarningCount = countTimeSkewWarnings(visibleNews);
    const clusters = buildSimpleClusters(visibleNews);
    const latestMarketEntries = Array.from(latestMarketBySymbol.entries());
    const marketTimestampBySymbol = Object.fromEntries(
      latestMarketEntries.map(([symbol, record]) => [symbol, record.validTimeStart]),
    );
    const marketKnowledgeBoundaryBySymbol = Object.fromEntries(
      latestMarketEntries.map(([symbol, record]) => [symbol, record.knowledgeBoundary]),
    );
    const mergedSources = Array.from(new Set(activeBucketRecords.map((record) => record.sourceId || record.provider))).slice(0, 24);
    const markets = latestMarketEntries.map(([symbol, record]) => ({
      symbol,
      name: record.headline || record.symbol || record.id,
      display: record.symbol || record.headline || record.id,
      price: record.price ?? 0,
      change: 0,
    })) as MarketData[];
    const transactionTime = activeBucketRecords.reduce((latest, record) => {
      const candidate = record.transactionTime;
      return asTs(candidate) > asTs(latest) ? candidate : latest;
    }, bucketEndIso);
    const knowledgeBoundary = activeBucketRecords.reduce((latest, record) => {
      const candidate = record.knowledgeBoundary;
      return asTs(candidate) > asTs(latest) ? candidate : latest;
    }, transactionTime);
    const frameValidTimeStart = visibleNews.reduce((earliest, item) => {
      const itemIso = item.pubDate.toISOString();
      if (!earliest) return itemIso;
      return asTs(itemIso) < asTs(earliest) ? itemIso : earliest;
    }, activeBucketRecords.reduce((earliest, record) => {
      if (!earliest) return record.validTimeStart;
      return asTs(record.validTimeStart) < asTs(earliest) ? record.validTimeStart : earliest;
    }, visibleNews.length > 0 ? '' : transactionTime));
    const warmup =
      activeBucketRecords.some((record) => record.metadata.warmup === true) ||
      (typeof options.warmupFrameCount === 'number' && bucketIndex < options.warmupFrameCount) ||
      (typeof options.warmupUntil === 'string' &&
        asTs(bucketEndIso) <= asTs(toIso(options.warmupUntil)));

    const replayFrame: HistoricalReplayFrame = {
      id: stableId([datasetId, bucketStartTs, bucketHours]),
      timestamp: bucketEndIso,
      validTimeStart: frameValidTimeStart,
      validTimeEnd: bucketEndIso,
      transactionTime,
      knowledgeBoundary,
      datasetId,
      sourceVersion,
      warmup,
      news: visibleNews,
      clusters,
      markets,
      metadata: {
        provider,
        sourceFamily: inferCoverageFamilies({ provider, datasetId }).sourceFamily,
        featureFamily: inferCoverageFamilies({ provider, datasetId }).featureFamily,
        bucketHours,
        bucketTimeMode,
        frameNewsCount: visibleNews.length,
        frameMarketCount: markets.length,
        mergeConflictCount,
        mergedSourcesJson: JSON.stringify(mergedSources),
        timeSkewWarningCount,
        maxMarketKnowledgeBoundary,
        marketTimestampJson: JSON.stringify(marketTimestampBySymbol),
        marketKnowledgeBoundaryJson: JSON.stringify(marketKnowledgeBoundaryBySymbol),
      },
    };

    frameRows.push({
      id: replayFrame.id || stableId([datasetId, bucketStartTs]),
      datasetId,
      bucketHours,
      bucketStart: new Date(bucketStartTs).toISOString(),
      bucketEnd: bucketEndIso,
      validTimeStart: replayFrame.validTimeStart || bucketEndIso,
      validTimeEnd: replayFrame.validTimeEnd || null,
      transactionTime,
      knowledgeBoundary,
      warmup,
      payloadJson: serializeFrame(replayFrame),
      newsCount: visibleNews.length,
      clusterCount: clusters.length,
      marketCount: markets.length,
    });

    activeBucketRecords = [];
    mergeConflictCount = 0;
    bucketIndex += 1;
  };

    let offset = 0;
    const loadPageSize = Math.max(chunkSize * 4, 1000);
    while (true) {
      const page = await readHistoricalRawRecordsFromConnection(connection, {
        dbPath,
        datasetId,
        limit: loadPageSize,
        offset,
      });
      if (page.length === 0) break;
      for (const record of page) {
        const bucketTs = resolveBucketTimestamp(record, bucketTimeMode);
        const bucketKey = Math.floor(bucketTs / bucketMs) * bucketMs;
        if (activeBucketKey === null) {
          activeBucketKey = bucketKey;
        } else if (bucketKey !== activeBucketKey) {
          finalizeActiveBucket();
          activeBucketKey = bucketKey;
        }
        activeBucketRecords.push(record);
        if (record.itemKind === 'news') {
          newsWindow.push(record);
        } else if (record.itemKind === 'market') {
          const symbol = record.symbol || record.headline || record.id;
          const current = latestMarketBySymbol.get(symbol);
          if (current && (
            current.price !== record.price
            || current.sourceId !== record.sourceId
            || current.validTimeStart !== record.validTimeStart
          )) {
            mergeConflictCount += 1;
          }
          if (!current || shouldReplaceMarketRecord(record, current)) {
            latestMarketBySymbol.set(symbol, record);
          }
          maxMarketKnowledgeBoundary = Math.max(
            maxMarketKnowledgeBoundary,
            asTs(record.knowledgeBoundary),
          );
        }
      }
      offset += page.length;
    }
    finalizeActiveBucket();

    await replaceDatasetFrames(frameRows, datasetId, dbPath);
    const currentImportRawRecordCount = rawRecordCount;
    const corpusStats = await readHistoricalRawCorpusStatsForDataset(connection, datasetId);
    const corpusRawRecordCount = corpusStats.rawRecordCount;

    const summary: HistoricalDatasetSummary = {
      datasetId,
      provider,
      sourceVersion,
      importedAt: nowIso(),
      rawRecordCount: corpusRawRecordCount,
      frameCount: frameRows.length,
      warmupFrameCount: frameRows.filter((frame) => frame.warmup).length,
      bucketHours,
      firstValidTime: corpusStats.firstValidTime,
      lastValidTime: corpusStats.lastValidTime,
      firstTransactionTime: corpusStats.firstTransactionTime,
      lastTransactionTime: corpusStats.lastTransactionTime,
      metadata: {
        filePath,
        newsLookbackHours,
        transactionTimeMode: options.transactionTimeMode || defaultTransactionTimeMode(provider),
        bucketTimeMode,
        maxMarketKnowledgeBoundary,
        currentImportRawRecordCount,
        corpusRawRecordCount,
        currentImportFirstValidTime: firstValidTime,
        currentImportLastValidTime: lastValidTime,
        currentImportFirstTransactionTime: firstTransactionTime,
        currentImportLastTransactionTime: lastTransactionTime,
        invalidRecordCount,
        invalidTemporalCount,
        sourceArtifactCount: Array.isArray(options.sourceArtifactPaths)
          ? options.sourceArtifactPaths.length
          : 1,
        sourceArtifactPathsJson: JSON.stringify(
          Array.isArray(options.sourceArtifactPaths)
            ? options.sourceArtifactPaths.slice()
            : [filePath],
        ),
      },
    };
    await upsertDatasetSummary(summary, dbPath);

    return {
      datasetId,
      provider,
      dbPath: path.resolve(dbPath),
      rawRecordCount: corpusRawRecordCount,
      currentImportRawRecordCount,
      frameCount: frameRows.length,
      warmupFrameCount: summary.warmupFrameCount,
      bucketHours,
      firstValidTime: corpusStats.firstValidTime,
      lastValidTime: corpusStats.lastValidTime,
      firstTransactionTime: corpusStats.firstTransactionTime,
      lastTransactionTime: corpusStats.lastTransactionTime,
    };
    await rm(checkpointPath, { force: true });
  } finally {
    await releaseDbLock();
  }
}

export async function listHistoricalDatasets(
  dbPath: string = DEFAULT_DB_PATH,
): Promise<HistoricalDatasetSummary[]> {
  const releaseDbLock = await acquireDuckDbPathLock(dbPath);
  if (!releaseDbLock) {
    throw new DuckDbPathLockError(
      `DuckDB path is locked for list-datasets: ${normalizeDuckDbPath(dbPath)}`,
    );
  }

  try {
    const connection = await ensureHistoricalReplayArchive(dbPath);
    const result = await connection.runAndReadAll(`
      SELECT *
      FROM historical_datasets
      ORDER BY last_transaction_time DESC NULLS LAST, imported_at DESC
    `);
    return result.getRowObjectsJS().map((row) => ({
      datasetId: String(row.dataset_id || ''),
      provider: String(row.provider || ''),
      sourceVersion:
        typeof row.source_version === 'string' && row.source_version.trim()
          ? String(row.source_version)
          : null,
      importedAt: String(row.imported_at || nowIso()),
      rawRecordCount: Number(row.raw_record_count || 0),
      frameCount: Number(row.frame_count || 0),
      warmupFrameCount: Number(row.warmup_frame_count || 0),
      bucketHours: Number(row.bucket_hours || DEFAULT_BUCKET_HOURS),
      firstValidTime: row.first_valid_time ? String(row.first_valid_time) : null,
      lastValidTime: row.last_valid_time ? String(row.last_valid_time) : null,
      firstTransactionTime: row.first_transaction_time
        ? String(row.first_transaction_time)
        : null,
      lastTransactionTime: row.last_transaction_time ? String(row.last_transaction_time) : null,
      metadata:
        typeof row.metadata_json === 'string' && row.metadata_json
          ? (JSON.parse(row.metadata_json) as Record<string, unknown>)
          : {},
    }));
  } finally {
    await releaseDbLock();
  }
}

export async function loadHistoricalReplayFramesFromDuckDb(
  options: HistoricalFrameLoadOptions = {},
): Promise<HistoricalReplayFrame[]> {
  const dbPath = options.dbPath || DEFAULT_DB_PATH;
  const releaseDbLock = await acquireDuckDbPathLock(dbPath);
  if (!releaseDbLock) {
    throw new DuckDbPathLockError(
      `DuckDB path is locked for load-frames: ${normalizeDuckDbPath(dbPath)}`,
    );
  }

  try {
    const connection = await ensureHistoricalReplayArchive(dbPath);
    const clauses: string[] = [];
    const params: Record<string, unknown> = {};

    if (options.datasetId) {
      clauses.push('dataset_id = $datasetId');
      params.datasetId = options.datasetId;
    }
    if (!options.includeWarmup) {
      clauses.push('warmup = FALSE');
    }
    if (options.startTransactionTime) {
      clauses.push('transaction_time >= $startTransactionTime');
      params.startTransactionTime = toIso(options.startTransactionTime);
    }
    if (options.endTransactionTime) {
      clauses.push('transaction_time <= $endTransactionTime');
      params.endTransactionTime = toIso(options.endTransactionTime);
    }
    if (options.knowledgeBoundaryCeiling) {
      clauses.push('knowledge_boundary <= $knowledgeBoundaryCeiling');
      params.knowledgeBoundaryCeiling = toIso(options.knowledgeBoundaryCeiling);
    }

    const whereClause = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
    const limitClause =
      typeof options.maxFrames === 'number' && options.maxFrames > 0
        ? `LIMIT ${Math.floor(options.maxFrames)}`
        : '';
    const orderDirection = options.latestFirst ? 'DESC' : 'ASC';
    const result = await connection.runAndReadAll(
      `
      SELECT *
      FROM historical_replay_frames
      ${whereClause}
      ORDER BY transaction_time ${orderDirection}, bucket_start ${orderDirection}
      ${limitClause}
    `,
      params,
    );
    const frames = result.getRowObjectsJS().map((row) => reviveFrame(String(row.payload_json || '{}')));
    return options.latestFirst ? frames.reverse() : frames;
  } finally {
    await releaseDbLock();
  }
}

export async function listHistoricalRawRecordsFromDuckDb(
  options: HistoricalRawRecordLoadOptions = {},
): Promise<HistoricalRawReplayRecord[]> {
  const dbPath = options.dbPath || DEFAULT_DB_PATH;
  const releaseDbLock = await acquireDuckDbPathLock(dbPath);
  if (!releaseDbLock) {
    throw new DuckDbPathLockError(
      `DuckDB path is locked for list-raw-records: ${normalizeDuckDbPath(dbPath)}`,
    );
  }

  try {
    const connection = await ensureHistoricalReplayArchive(dbPath);
    return await readHistoricalRawRecordsFromConnection(connection, options);
  } finally {
    await releaseDbLock();
  }
}

export async function listHistoricalReplayFrameRowsFromDuckDb(
  options: HistoricalReplayFrameRowLoadOptions = {},
): Promise<HistoricalReplayFrameArchiveRow[]> {
  const dbPath = options.dbPath || DEFAULT_DB_PATH;
  const releaseDbLock = await acquireDuckDbPathLock(dbPath);
  if (!releaseDbLock) {
    throw new DuckDbPathLockError(
      `DuckDB path is locked for list-frame-rows: ${normalizeDuckDbPath(dbPath)}`,
    );
  }

  try {
    const connection = await ensureHistoricalReplayArchive(dbPath);
    const clauses: string[] = [];
    const params: Record<string, unknown> = {};

    if (options.datasetId) {
      clauses.push('dataset_id = $datasetId');
      params.datasetId = options.datasetId;
    }
    if (!options.includeWarmup) {
      clauses.push('warmup = FALSE');
    }
    if (options.startTransactionTime) {
      clauses.push('transaction_time >= $startTransactionTime');
      params.startTransactionTime = toIso(options.startTransactionTime);
    }
    if (options.endTransactionTime) {
      clauses.push('transaction_time <= $endTransactionTime');
      params.endTransactionTime = toIso(options.endTransactionTime);
    }
    if (options.knowledgeBoundaryCeiling) {
      clauses.push('knowledge_boundary <= $knowledgeBoundaryCeiling');
      params.knowledgeBoundaryCeiling = toIso(options.knowledgeBoundaryCeiling);
    }

    const whereClause = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
    const limit =
      typeof options.limit === 'number' && options.limit > 0 ? Math.floor(options.limit) : 1000;
    const offset =
      typeof options.offset === 'number' && options.offset > 0 ? Math.floor(options.offset) : 0;

    const result = await connection.runAndReadAll(
      `
      SELECT *
      FROM historical_replay_frames
      ${whereClause}
      ORDER BY transaction_time ASC, bucket_start ASC, id ASC
      LIMIT ${limit}
      OFFSET ${offset}
    `,
      params,
    );

    return result.getRowObjectsJS().map(parseFrameRow);
  } finally {
    await releaseDbLock();
  }
}
