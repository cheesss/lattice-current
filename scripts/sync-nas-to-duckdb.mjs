#!/usr/bin/env node

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import Database from '@duckdb/node-api';
import pg from 'pg';
import { resolveNasPgConfig } from './_shared/nas-runtime.mjs';

const { Client } = pg;

const DEFAULT_DUCKDB_PATH = path.resolve('data', 'historical', 'intelligence-history.duckdb');
const DEFAULT_TMP_DIR = path.resolve('.tmp', 'nas-sync');
const DEFAULT_BUCKET_HOURS = 6;
const DEFAULT_NEWS_LOOKBACK_HOURS = 24;
const DEFAULT_BATCH_SIZE = 1000;
const TARGET_PROVIDERS = ['guardian', 'nyt', 'gdelt-agg'];

const PG_CONFIG = resolveNasPgConfig();

function parseArgs(argv) {
  const parsed = {
    dbPath: DEFAULT_DUCKDB_PATH,
    tmpDir: DEFAULT_TMP_DIR,
    batchSize: DEFAULT_BATCH_SIZE,
    bucketHours: DEFAULT_BUCKET_HOURS,
    newsLookbackHours: DEFAULT_NEWS_LOOKBACK_HOURS,
    providers: TARGET_PROVIDERS.slice(),
    dryRun: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--dry-run') {
      parsed.dryRun = true;
      continue;
    }
    const [key, inlineValue] = token.startsWith('--') ? token.slice(2).split('=') : [null, null];
    if (!key) continue;
    const nextValue = inlineValue ?? argv[index + 1];
    if (inlineValue == null) index += 1;
    if (nextValue == null) continue;
    if (key === 'db-path') parsed.dbPath = path.resolve(String(nextValue));
    if (key === 'tmp-dir') parsed.tmpDir = path.resolve(String(nextValue));
    if (key === 'batch-size') parsed.batchSize = Math.max(100, Number(nextValue) || DEFAULT_BATCH_SIZE);
    if (key === 'bucket-hours') parsed.bucketHours = Math.max(1, Number(nextValue) || DEFAULT_BUCKET_HOURS);
    if (key === 'news-lookback-hours') parsed.newsLookbackHours = Math.max(parsed.bucketHours, Number(nextValue) || DEFAULT_NEWS_LOOKBACK_HOURS);
    if (key === 'providers') {
      parsed.providers = String(nextValue)
        .split(',')
        .map((value) => String(value || '').trim().toLowerCase())
        .filter(Boolean);
    }
  }
  return parsed;
}

function asTs(value) {
  if (!value) return 0;
  const ts = Date.parse(String(value));
  return Number.isFinite(ts) ? ts : 0;
}

function toIso(value, fallback = '') {
  if (!value) return fallback;
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString();
  const parsed = new Date(value);
  if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  return fallback;
}

function stableId(parts) {
  return parts
    .map((part) => String(part ?? '').trim())
    .filter(Boolean)
    .join('::')
    .slice(0, 240);
}

function normalizeTitle(value, fallback) {
  const text = String(value || '').trim();
  return text || fallback;
}

function toNumber(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value.replace(/,/g, ''));
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function shouldReplaceMarketRecord(candidate, current) {
  const candidateKnowledge = asTs(candidate.knowledgeBoundary);
  const currentKnowledge = asTs(current.knowledgeBoundary);
  if (candidateKnowledge !== currentKnowledge) return candidateKnowledge > currentKnowledge;
  const candidateTransaction = asTs(candidate.transactionTime);
  const currentTransaction = asTs(current.transactionTime);
  if (candidateTransaction !== currentTransaction) return candidateTransaction > currentTransaction;
  return asTs(candidate.validTimeStart) >= asTs(current.validTimeStart);
}

function newsSourceName(record) {
  const metadata = record.metadata || {};
  const source = String(metadata.sourceName || record.sourceId || record.provider).trim();
  return source || record.provider;
}

function inferFamilies(provider) {
  const normalized = String(provider || '').trim().toLowerCase();
  if (normalized === 'guardian' || normalized === 'nyt' || normalized === 'gdelt-agg') {
    return { sourceFamily: 'news', featureFamily: 'headline-news' };
  }
  return { sourceFamily: 'other', featureFamily: 'other' };
}

function buildNewsItem(record) {
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

function buildSimpleClusters(newsItems) {
  const groups = new Map();
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

function countTimeSkewWarnings(newsItems, skewMs = 30 * 60 * 1000) {
  const buckets = new Map();
  for (const item of newsItems) {
    const key = normalizeTitle(item.title, 'untitled').toLowerCase();
    const ts = item.pubDate?.getTime?.() ?? Number.NaN;
    if (!Number.isFinite(ts)) continue;
    const bucket = buckets.get(key) || [];
    bucket.push(ts);
    buckets.set(key, bucket);
  }
  let warnings = 0;
  for (const values of buckets.values()) {
    if (values.length < 2) continue;
    if ((Math.max(...values) - Math.min(...values)) > skewMs) warnings += 1;
  }
  return warnings;
}

async function ensureDuckDbSchema(connection) {
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
}

function parseDuckRow(row) {
  return {
    id: String(row.id || ''),
    datasetId: String(row.dataset_id || ''),
    provider: String(row.provider || ''),
    sourceKind: String(row.source_kind || 'api'),
    sourceId: String(row.source_id || ''),
    itemKind: String(row.item_kind || 'news'),
    validTimeStart: String(row.valid_time_start || new Date(0).toISOString()),
    validTimeEnd: row.valid_time_end ? String(row.valid_time_end) : null,
    transactionTime: String(row.transaction_time || new Date(0).toISOString()),
    knowledgeBoundary: String(row.knowledge_boundary || row.transaction_time || new Date(0).toISOString()),
    headline: row.headline ? String(row.headline) : null,
    link: row.link ? String(row.link) : null,
    symbol: row.symbol ? String(row.symbol) : null,
    region: row.region ? String(row.region) : null,
    price: typeof row.price === 'number' ? row.price : toNumber(row.price),
    payload: typeof row.payload_json === 'string' && row.payload_json ? JSON.parse(row.payload_json) : {},
    metadata: typeof row.metadata_json === 'string' && row.metadata_json ? JSON.parse(row.metadata_json) : {},
  };
}

async function queryCountMapPg(client, providers) {
  const result = await client.query(
    `
      SELECT provider, COUNT(*)::bigint AS count
      FROM raw_items
      WHERE provider = ANY($1::text[])
      GROUP BY provider
    `,
    [providers],
  );
  return new Map(result.rows.map((row) => [String(row.provider), Number(row.count || 0)]));
}

async function queryCountMapDuck(connection, providers) {
  if (providers.length === 0) return new Map();
  const quoted = providers.map((provider) => `'${provider.replace(/'/g, "''")}'`).join(', ');
  const result = await connection.runAndReadAll(`
    SELECT provider, COUNT(*) AS count
    FROM historical_raw_items
    WHERE provider IN (${quoted})
    GROUP BY provider
  `);
  return new Map(result.getRowObjectsJS().map((row) => [String(row.provider || ''), Number(row.count || 0)]));
}

async function fetchProviderRows(client, provider, batchSize) {
  const totalResult = await client.query(
    'SELECT COUNT(*)::bigint AS count FROM raw_items WHERE provider = $1',
    [provider],
  );
  const total = Number(totalResult.rows[0]?.count || 0);
  const rows = [];
  for (let offset = 0; offset < total; offset += batchSize) {
    const result = await client.query(
      `
        SELECT
          id,
          dataset_id,
          provider,
          source_kind,
          source_id,
          item_kind,
          valid_time_start,
          valid_time_end,
          transaction_time,
          knowledge_boundary,
          headline,
          link,
          symbol,
          region,
          price,
          payload,
          metadata
        FROM raw_items
        WHERE provider = $1
        ORDER BY dataset_id ASC, transaction_time ASC, valid_time_start ASC, id ASC
        LIMIT $2 OFFSET $3
      `,
      [provider, batchSize, offset],
    );
    rows.push(...result.rows.map((row) => ({
      id: String(row.id),
      datasetId: String(row.dataset_id),
      provider: String(row.provider),
      sourceKind: String(row.source_kind),
      sourceId: String(row.source_id),
      itemKind: String(row.item_kind),
      validTimeStart: toIso(row.valid_time_start),
      validTimeEnd: row.valid_time_end ? toIso(row.valid_time_end) : null,
      transactionTime: toIso(row.transaction_time, toIso(row.valid_time_start)),
      knowledgeBoundary: toIso(row.knowledge_boundary, toIso(row.transaction_time, toIso(row.valid_time_start))),
      headline: row.headline ? String(row.headline) : null,
      link: row.link ? String(row.link) : null,
      symbol: row.symbol ? String(row.symbol) : null,
      region: row.region ? String(row.region) : null,
      price: toNumber(row.price),
      payload: row.payload && typeof row.payload === 'object' ? row.payload : {},
      metadata: row.metadata && typeof row.metadata === 'object' ? row.metadata : {},
    })));
    process.stderr.write(`\r[pg] ${provider}: ${Math.min(offset + batchSize, total)}/${total}`);
  }
  process.stderr.write('\n');
  return rows;
}

function groupByDataset(rows) {
  const grouped = new Map();
  for (const row of rows) {
    const key = row.datasetId || row.provider;
    const bucket = grouped.get(key) || [];
    bucket.push(row);
    grouped.set(key, bucket);
  }
  return grouped;
}

function toEnvelopeItem(row) {
  const metadata = row.metadata || {};
  return {
    id: row.id,
    sourceId: row.sourceId,
    sourceName: metadata.sourceName || row.provider,
    validTimeStart: row.validTimeStart,
    transactionTime: row.transactionTime,
    headline: row.headline,
    link: row.link,
    symbol: row.symbol,
    region: row.region,
    price: row.price,
    payload: row.payload,
    metadata: row.metadata,
  };
}

async function dumpDatasetEnvelope(tmpDir, provider, datasetId, rows) {
  await mkdir(tmpDir, { recursive: true });
  const filePath = path.join(tmpDir, `${datasetId.replace(/[^a-z0-9._-]/gi, '-')}.json`);
  const payload = {
    fetchedAt: new Date().toISOString(),
    provider,
    datasetId,
    envelope: {
      provider,
      data: {
        items: rows.map(toEnvelopeItem),
      },
    },
  };
  await writeFile(filePath, JSON.stringify(payload, null, 2), 'utf8');
  return filePath;
}

async function upsertRawItems(connection, rows) {
  if (rows.length === 0) return;
  await connection.run('BEGIN TRANSACTION');
  try {
    for (const row of rows) {
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
          id: row.id,
          datasetId: row.datasetId,
          provider: row.provider,
          sourceKind: row.sourceKind,
          sourceId: row.sourceId,
          itemKind: row.itemKind,
          validTimeStart: row.validTimeStart,
          validTimeEnd: row.validTimeEnd,
          transactionTime: row.transactionTime,
          knowledgeBoundary: row.knowledgeBoundary,
          headline: row.headline,
          link: row.link,
          symbol: row.symbol,
          region: row.region,
          price: row.price,
          payloadJson: JSON.stringify(row.payload || {}),
          metadataJson: JSON.stringify(row.metadata || {}),
        },
      );
    }
    await connection.run('COMMIT');
  } catch (error) {
    await connection.run('ROLLBACK');
    throw error;
  }
}

async function readDatasetRawRecords(connection, datasetId) {
  const result = await connection.runAndReadAll(
    `
      SELECT *
      FROM historical_raw_items
      WHERE dataset_id = $datasetId
      ORDER BY transaction_time ASC, valid_time_start ASC, id ASC
    `,
    { datasetId },
  );
  return result.getRowObjectsJS().map(parseDuckRow);
}

async function readDatasetCorpusStats(connection, datasetId) {
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
  const row = result.getRowObjectsJS()[0] || {};
  return {
    rawRecordCount: Math.max(0, Number(row.total || 0)),
    firstValidTime: row.first_valid_time ? String(row.first_valid_time) : null,
    lastValidTime: row.last_valid_time ? String(row.last_valid_time) : null,
    firstTransactionTime: row.first_transaction_time ? String(row.first_transaction_time) : null,
    lastTransactionTime: row.last_transaction_time ? String(row.last_transaction_time) : null,
  };
}

async function replaceDatasetFrames(connection, datasetId, frameRows) {
  await connection.run('BEGIN TRANSACTION');
  try {
    await connection.run(
      'DELETE FROM historical_replay_frames WHERE dataset_id = $datasetId',
      { datasetId },
    );
    for (const frame of frameRows) {
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
        frame,
      );
    }
    await connection.run('COMMIT');
  } catch (error) {
    await connection.run('ROLLBACK');
    throw error;
  }
}

async function upsertDatasetSummary(connection, summary) {
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

async function rebuildDatasetFrames(connection, datasetId, provider, options) {
  const records = await readDatasetRawRecords(connection, datasetId);
  const frameRows = [];
  const bucketMs = options.bucketHours * 60 * 60 * 1000;
  const newsLookbackMs = options.newsLookbackHours * 60 * 60 * 1000;
  const families = inferFamilies(provider);
  const latestMarketBySymbol = new Map();
  const newsWindow = [];
  let maxMarketKnowledgeBoundary = 0;
  let bucketIndex = 0;
  let activeBucketKey = null;
  let activeBucketRecords = [];
  let mergeConflictCount = 0;

  const finalizeBucket = () => {
    if (activeBucketKey == null || activeBucketRecords.length === 0) return;
    const bucketStartTs = activeBucketKey;
    const bucketEndTs = bucketStartTs + bucketMs;
    const bucketEndIso = new Date(bucketEndTs).toISOString();

    while (
      newsWindow.length > 0
      && asTs(newsWindow[0]?.validTimeStart) < bucketEndTs - newsLookbackMs
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
    }));
    const transactionTime = activeBucketRecords.reduce((latest, record) => (
      asTs(record.transactionTime) > asTs(latest) ? record.transactionTime : latest
    ), bucketEndIso);
    const knowledgeBoundary = activeBucketRecords.reduce((latest, record) => (
      asTs(record.knowledgeBoundary) > asTs(latest) ? record.knowledgeBoundary : latest
    ), transactionTime);
    const validTimeStart = visibleNews.reduce((earliest, item) => {
      const itemIso = item.pubDate.toISOString();
      if (!earliest) return itemIso;
      return asTs(itemIso) < asTs(earliest) ? itemIso : earliest;
    }, activeBucketRecords.reduce((earliest, record) => {
      if (!earliest) return record.validTimeStart;
      return asTs(record.validTimeStart) < asTs(earliest) ? record.validTimeStart : earliest;
    }, visibleNews.length > 0 ? '' : transactionTime));

    const replayFrame = {
      id: stableId([datasetId, bucketStartTs, options.bucketHours]),
      timestamp: bucketEndIso,
      validTimeStart,
      validTimeEnd: bucketEndIso,
      transactionTime,
      knowledgeBoundary,
      datasetId,
      sourceVersion: null,
      warmup: false,
      news: visibleNews,
      clusters,
      markets,
      metadata: {
        provider,
        sourceFamily: families.sourceFamily,
        featureFamily: families.featureFamily,
        bucketHours: options.bucketHours,
        bucketTimeMode: 'valid-time',
        frameNewsCount: visibleNews.length,
        frameMarketCount: markets.length,
        mergeConflictCount,
        mergedSourcesJson: JSON.stringify(mergedSources),
        timeSkewWarningCount: countTimeSkewWarnings(visibleNews),
        maxMarketKnowledgeBoundary,
        marketTimestampJson: JSON.stringify(marketTimestampBySymbol),
        marketKnowledgeBoundaryJson: JSON.stringify(marketKnowledgeBoundaryBySymbol),
      },
    };

    frameRows.push({
      id: replayFrame.id,
      datasetId,
      bucketHours: options.bucketHours,
      bucketStart: new Date(bucketStartTs).toISOString(),
      bucketEnd: bucketEndIso,
      validTimeStart: replayFrame.validTimeStart || bucketEndIso,
      validTimeEnd: replayFrame.validTimeEnd || null,
      transactionTime,
      knowledgeBoundary,
      warmup: false,
      newsCount: visibleNews.length,
      clusterCount: clusters.length,
      marketCount: markets.length,
      payloadJson: JSON.stringify(replayFrame),
    });

    activeBucketRecords = [];
    mergeConflictCount = 0;
    bucketIndex += 1;
  };

  for (const record of records) {
    const bucketTs = asTs(record.validTimeStart);
    const bucketKey = Math.floor(bucketTs / bucketMs) * bucketMs;
    if (activeBucketKey == null) {
      activeBucketKey = bucketKey;
    } else if (bucketKey !== activeBucketKey) {
      finalizeBucket();
      activeBucketKey = bucketKey;
    }
    activeBucketRecords.push(record);
    if (record.itemKind === 'news' || record.itemKind === 'event-summary') {
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
      maxMarketKnowledgeBoundary = Math.max(maxMarketKnowledgeBoundary, asTs(record.knowledgeBoundary));
    }
  }
  finalizeBucket();

  await replaceDatasetFrames(connection, datasetId, frameRows);
  const corpusStats = await readDatasetCorpusStats(connection, datasetId);
  await upsertDatasetSummary(connection, {
    datasetId,
    provider,
    sourceVersion: null,
    importedAt: new Date().toISOString(),
    rawRecordCount: corpusStats.rawRecordCount,
    frameCount: frameRows.length,
    warmupFrameCount: 0,
    bucketHours: options.bucketHours,
    firstValidTime: corpusStats.firstValidTime,
    lastValidTime: corpusStats.lastValidTime,
    firstTransactionTime: corpusStats.firstTransactionTime,
    lastTransactionTime: corpusStats.lastTransactionTime,
    metadata: {
      newsLookbackHours: options.newsLookbackHours,
      transactionTimeMode: 'valid-time',
      bucketTimeMode: 'valid-time',
      sourceArtifactCount: 1,
      rebuildScript: 'scripts/sync-nas-to-duckdb.mjs',
    },
  });

  return {
    datasetId,
    provider,
    rawRecordCount: corpusStats.rawRecordCount,
    frameCount: frameRows.length,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  await mkdir(args.tmpDir, { recursive: true });

  const duckDb = await Database.DuckDBInstance.create(args.dbPath);
  const duck = await duckDb.connect();
  await ensureDuckDbSchema(duck);

  const pgClient = new Client(PG_CONFIG);
  await pgClient.connect();

  try {
    const nasCounts = await queryCountMapPg(pgClient, args.providers);
    const localCounts = await queryCountMapDuck(duck, args.providers);
    console.log(JSON.stringify({
      ok: true,
      phase: 'counts',
      nas: Object.fromEntries(args.providers.map((provider) => [provider, nasCounts.get(provider) || 0])),
      duckdb: Object.fromEntries(args.providers.map((provider) => [provider, localCounts.get(provider) || 0])),
    }, null, 2));

    if (args.dryRun) return;

    const datasetSummaries = [];
    for (const provider of args.providers) {
      const rows = await fetchProviderRows(pgClient, provider, args.batchSize);
      const grouped = groupByDataset(rows);
      for (const [datasetId, datasetRows] of grouped.entries()) {
        const dumpPath = await dumpDatasetEnvelope(args.tmpDir, provider, datasetId, datasetRows);
        await upsertRawItems(duck, datasetRows);
        const rebuilt = await rebuildDatasetFrames(duck, datasetId, provider, args);
        datasetSummaries.push({
          provider,
          datasetId,
          dumpPath,
          rawRecordCount: rebuilt.rawRecordCount,
          frameCount: rebuilt.frameCount,
        });
      }
    }

    const finalCounts = await queryCountMapDuck(duck, args.providers);
    console.log(JSON.stringify({
      ok: true,
      phase: 'complete',
      datasets: datasetSummaries,
      duckdb: Object.fromEntries(args.providers.map((provider) => [provider, finalCounts.get(provider) || 0])),
      dbPath: args.dbPath,
      tmpDir: args.tmpDir,
    }, null, 2));
  } finally {
    await pgClient.end().catch(() => {});
  }
}

main().catch((error) => {
  console.error(JSON.stringify({
    ok: false,
    error: error instanceof Error ? error.message : String(error),
  }, null, 2));
  process.exit(1);
});
