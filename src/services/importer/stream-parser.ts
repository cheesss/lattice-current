/**
 * JSON stream handling and parsing logic extracted from historical-stream-worker.ts.
 * Contains streaming JSON parsers and provider-specific record builders.
 */

import { createReadStream } from 'node:fs';
import streamJsonPackage from 'stream-json';
import pickPackage from 'stream-json/filters/Pick';
import streamArrayPackage from 'stream-json/streamers/StreamArray';
import type { HistoricalRawReplayRecord } from './historical-stream-worker';

const { parser: createJsonParser } = streamJsonPackage as { parser: () => NodeJS.ReadWriteStream };
const { pick } = pickPackage as { pick: (options: { filter: string }) => NodeJS.ReadWriteStream };
const { streamArray } = streamArrayPackage as { streamArray: () => NodeJS.ReadWriteStream };

type HistoricalTransactionTimeMode = 'provider' | 'valid-time' | 'fetched-at';

export interface StreamTransformContext {
  datasetId: string;
  provider: string;
  sourceVersion: string | null;
  fetchedAt: string;
  requestId: string | null;
  seriesId: string | null;
  transactionTimeMode: HistoricalTransactionTimeMode;
}

export type { HistoricalTransactionTimeMode };

type StreamJsonToken = {
  name?: string;
  value?: unknown;
};

// ── Utility helpers (duplicated from main module for self-containment) ──

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

function stableId(parts: Array<string | number | null | undefined>): string {
  return parts
    .map((part) => String(part ?? '').trim())
    .filter(Boolean)
    .join('::')
    .slice(0, 240);
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

// ── Provider-specific record builders ──

export function buildCoingeckoRecord(
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

export function buildFredObservationRecord(
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

export function buildGdeltArticleRecord(
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

export function buildAcledRecord(
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

export function buildGenericRowRecord(
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

export function buildGenericTupleRecord(
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

// ── Dispatcher ──

export function buildStreamedRecordsForProvider(
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

// ── JSON path candidates ──

export function candidateJsonPaths(provider: string): string[][] {
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

// ── Streaming parsers ──

export async function streamJsonArrayItems(
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

type Container = {
  kind: 'object' | 'array';
  key: string | null;
  collect: boolean;
  isRoot: boolean;
  value: Record<string, unknown> | unknown[];
  currentKey: string | null;
};

export async function streamGenericJsonRecords(
  filePath: string,
  onItem: (value: unknown, index: number) => Promise<void> | void,
): Promise<{ itemCount: number } | null> {
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
