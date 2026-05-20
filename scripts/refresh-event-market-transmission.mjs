#!/usr/bin/env node

import pg from 'pg';
import { pathToFileURL } from 'node:url';
import { loadOptionalEnvFile, resolveNasPgConfig } from './_shared/nas-runtime.mjs';
import { writeSignalHistoryRow, SIGNAL_ORIGIN } from './_shared/signal-history-writer.mjs';

loadOptionalEnvFile();

const { Client } = pg;

const DEFAULT_LOOKBACK_DAYS = 14;
const DEFAULT_ARTICLE_LIMIT = 180;
const SIGNAL_HISTORY_LOOKBACK_DAYS = 30;
const SIGNAL_CHANNELS = ['vix', 'oilPrice', 'yieldSpread', 'hy_credit_spread', 'dollarIndex', 'marketStress'];

const EXTRA_TRANSMISSION_MARKETS = Object.freeze([
  { symbol: 'DBC', name: 'Commodity Basket', display: 'DBC' },
  { symbol: 'BDRY', name: 'Shipping Freight', display: 'BDRY' },
  { symbol: 'UUP', name: 'Dollar Index ETF', display: 'UUP' },
  { symbol: 'USO', name: 'Oil ETF', display: 'USO' },
  { symbol: 'UNG', name: 'Natural Gas ETF', display: 'UNG' },
  { symbol: 'XLK', name: 'Technology Select', display: 'XLK' },
  { symbol: 'XLE', name: 'Energy Select', display: 'XLE' },
]);

const SIGNAL_MARKET_BINDINGS = Object.freeze({
  '^VIX': 'vix',
  'CL=F': 'oilPrice',
  'NG=F': 'oilPrice',
  'GC=F': 'oilPrice',
  HYG: 'hy_credit_spread',
  LQD: 'hy_credit_spread',
  TLT: 'yieldSpread',
  DBC: 'oilPrice',
  USO: 'oilPrice',
  UNG: 'oilPrice',
  XLE: 'oilPrice',
  UUP: 'dollarIndex',
});

function safeTrim(value) {
  return String(value ?? '').trim();
}

function toFiniteNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function clamp(value, min = 0, max = 1) {
  return Math.max(min, Math.min(max, value));
}

function normalizeSparkline(values = []) {
  return values
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value))
    .slice(-16);
}

export function parseArgs(argv = process.argv.slice(2)) {
  const parsed = {
    days: DEFAULT_LOOKBACK_DAYS,
    limit: DEFAULT_ARTICLE_LIMIT,
    dryRun: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--days') {
      parsed.days = Math.max(1, Math.min(90, Number(argv[index + 1]) || parsed.days));
      index += 1;
    } else if (token === '--limit') {
      parsed.limit = Math.max(20, Math.min(400, Number(argv[index + 1]) || parsed.limit));
      index += 1;
    } else if (token === '--dry-run') {
      parsed.dryRun = true;
    }
  }
  return parsed;
}

export function mapArticleRowsToNews(rows = []) {
  return rows
    .map((row) => ({
      source: safeTrim(row.source) || 'unknown',
      title: safeTrim(row.title),
      link: safeTrim(row.url),
      pubDate: row.published_at ? new Date(row.published_at) : new Date(),
      isAlert: false,
      locationName: safeTrim(row.location_name || row.country || ''),
    }))
    .filter((item) => item.title && item.link);
}

function buildSignalSeries(rows = []) {
  const series = new Map();
  for (const row of rows) {
    const channel = safeTrim(row.signal_name);
    if (!channel) continue;
    const bucket = series.get(channel) || [];
    bucket.push(toFiniteNumber(row.value));
    series.set(channel, bucket);
  }
  return series;
}

export function buildSyntheticMarkets(signalRows = [], marketUniverse = []) {
  const seriesByChannel = buildSignalSeries(signalRows);
  const seen = new Set();
  const markets = [];
  for (const market of marketUniverse) {
    const symbol = safeTrim(market.symbol).toUpperCase();
    if (!symbol || seen.has(symbol)) continue;
    seen.add(symbol);
    const channel = SIGNAL_MARKET_BINDINGS[symbol] || null;
    const sparkline = channel ? normalizeSparkline(seriesByChannel.get(channel) || []) : [];
    const first = sparkline.length > 0 ? sparkline[0] : null;
    const last = sparkline.length > 0 ? sparkline[sparkline.length - 1] : null;
    const change = first != null && last != null
      ? (last - first)
      : 0;
    markets.push({
      symbol,
      name: safeTrim(market.name) || symbol,
      display: safeTrim(market.display) || symbol,
      price: last ?? null,
      change: Number(change.toFixed(3)),
      sparkline,
    });
  }
  return markets;
}

export function computeTransmissionStrength(snapshot) {
  const edges = Array.isArray(snapshot?.edges) ? snapshot.edges : [];
  if (!edges.length) return null;
  const topStrengths = edges
    .map((edge) => toFiniteNumber(edge?.strength, NaN))
    .filter((value) => Number.isFinite(value) && value > 0)
    .sort((left, right) => right - left)
    .slice(0, 20);
  if (!topStrengths.length) return null;
  const meanTopStrength = topStrengths.reduce((sum, value) => sum + value, 0) / topStrengths.length / 100;
  const breadth = clamp(Math.log1p(edges.length) / Math.log1p(120));
  return Number(clamp((meanTopStrength * 0.7) + (breadth * 0.3)).toFixed(4));
}

async function loadRecentArticles(client, days, limit) {
  const primary = await client.query(`
    SELECT title, source, published_at, url, NULL::text AS location_name
    FROM articles
    WHERE published_at >= NOW() - ($1::int * INTERVAL '1 day')
      AND url IS NOT NULL
      AND COALESCE(source, '') NOT ILIKE '%arxiv%'
    ORDER BY published_at DESC
    LIMIT $2
  `, [days, limit]);
  if (primary.rows.length > 0) return primary.rows;
  const fallbackDays = Math.max(days, 30);
  const fallback = await client.query(`
    SELECT title, source, published_at, url, NULL::text AS location_name
    FROM articles
    WHERE published_at >= NOW() - ($1::int * INTERVAL '1 day')
      AND url IS NOT NULL
      AND COALESCE(source, '') NOT ILIKE '%arxiv%'
    ORDER BY published_at DESC
    LIMIT $2
  `, [fallbackDays, limit]);
  return fallback.rows;
}

async function loadSignalHistory(client) {
  const result = await client.query(`
    SELECT signal_name, ts, value
    FROM signal_history
    WHERE signal_name = ANY($1::text[])
      AND ts >= NOW() - ($2::int * INTERVAL '1 day')
    ORDER BY signal_name, ts
  `, [SIGNAL_CHANNELS, SIGNAL_HISTORY_LOOKBACK_DAYS]);
  return result.rows;
}

async function writeTransmissionStrength(client, snapshot) {
  const strength = computeTransmissionStrength(snapshot);
  const generatedAt = snapshot?.generatedAt ? new Date(snapshot.generatedAt) : null;
  if (strength == null || !generatedAt || !Number.isFinite(generatedAt.valueOf())) return null;
  await client.query(`
    CREATE TABLE IF NOT EXISTS signal_history (
      signal_name TEXT NOT NULL,
      ts TIMESTAMPTZ NOT NULL,
      value DOUBLE PRECISION NOT NULL,
      PRIMARY KEY (signal_name, ts)
    )
  `);
  await writeSignalHistoryRow(client, {
    signalName: 'transmissionStrength',
    ts: generatedAt.toISOString(),
    value: strength,
    valueOrigin: SIGNAL_ORIGIN.COMPOSITE,
    writerId: 'refresh-event-market-transmission',
  });
  return { signalName: 'transmissionStrength', observedAt: generatedAt.toISOString(), value: strength };
}

export async function runTransmissionRefreshJob(options = {}) {
  const config = { ...parseArgs([]), ...options };
  const client = new Client(resolveNasPgConfig());
  await client.connect();
  try {
    const [{ recomputeEventMarketTransmission }, { COMMODITIES, MARKET_SYMBOLS, SECTORS }] = await Promise.all([
      import('../src/services/event-market-transmission.ts'),
      import('../src/config/markets.ts'),
    ]);

    const [articleRows, signalRows] = await Promise.all([
      loadRecentArticles(client, config.days, config.limit),
      loadSignalHistory(client),
    ]);

    const news = mapArticleRowsToNews(articleRows);
    const marketUniverse = [...COMMODITIES, ...MARKET_SYMBOLS, ...SECTORS, ...EXTRA_TRANSMISSION_MARKETS];
    const markets = buildSyntheticMarkets(signalRows, marketUniverse);

    if (config.dryRun) {
      return {
        ok: true,
        dryRun: true,
        newsCount: news.length,
        marketCount: markets.length,
        newestArticleAt: articleRows[0]?.published_at || null,
      };
    }

    const snapshot = await recomputeEventMarketTransmission({
      news,
      clusters: [],
      markets,
      keywordGraph: null,
      skipPersist: false,
    });
    const transmissionStrength = await writeTransmissionStrength(client, snapshot);

    return {
      ok: true,
      dryRun: false,
      newsCount: news.length,
      marketCount: markets.length,
      edgeCount: Array.isArray(snapshot?.edges) ? snapshot.edges.length : 0,
      generatedAt: snapshot?.generatedAt || null,
      regime: snapshot?.regime?.id || null,
      transmissionStrength,
    };
  } finally {
    await client.end().catch(() => {});
  }
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
  runTransmissionRefreshJob(parseArgs())
    .then((summary) => {
      process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
    })
    .catch((error) => {
      process.stderr.write(`${String(error?.stack || error?.message || error)}\n`);
      process.exit(1);
    });
}
