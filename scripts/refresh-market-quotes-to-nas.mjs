#!/usr/bin/env node
import process from 'node:process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { CHROME_UA, sleep } from './_seed-utils.mjs';
import { loadOptionalEnvFile, resolveNasPgConfig } from './_shared/nas-runtime.mjs';
import { writeSignalHistoryRow, SIGNAL_ORIGIN } from './_shared/signal-history-writer.mjs';

const { Pool } = pg;

export const DEFAULT_MARKET_QUOTE_SYMBOLS = [
  '^VIX',
  '^GSPC',
  '^IXIC',
  '^DJI',
  'CL=F',
  'GC=F',
  'DX-Y.NYB',
  '^TNX',
];

const SIGNAL_MAPPINGS = new Map([
  ['^VIX', 'vix'],
  ['CL=F', 'oilPrice'],
  ['DX-Y.NYB', 'dollarIndex'],
  ['^TNX', 'treasury10y'],
]);

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) continue;
    const [rawKey, inlineValue] = token.slice(2).split('=');
    if (inlineValue != null) {
      args[rawKey] = inlineValue;
      continue;
    }
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) args[rawKey] = true;
    else {
      args[rawKey] = next;
      i += 1;
    }
  }
  return args;
}

function toIsoFromEpochSeconds(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  const date = new Date(n * 1000);
  return Number.isFinite(date.valueOf()) ? date.toISOString() : null;
}

function asFiniteNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function parseYahooQuotePayload(payload, symbol) {
  const result = payload?.chart?.result?.[0];
  const meta = result?.meta || {};
  const timestamps = Array.isArray(result?.timestamp) ? result.timestamp : [];
  const quote = result?.indicators?.quote?.[0] || {};
  const closes = Array.isArray(quote.close) ? quote.close : [];

  let observedAt = toIsoFromEpochSeconds(meta.regularMarketTime);
  let price = asFiniteNumber(meta.regularMarketPrice);
  for (let i = Math.min(timestamps.length, closes.length) - 1; i >= 0; i -= 1) {
    const close = asFiniteNumber(closes[i]);
    if (close == null) continue;
    if (price == null) price = close;
    if (!observedAt) observedAt = toIsoFromEpochSeconds(timestamps[i]);
    break;
  }
  if (price == null || !observedAt) return null;

  const previousClose = asFiniteNumber(meta.chartPreviousClose ?? meta.previousClose);
  const changePct = previousClose && previousClose !== 0
    ? ((price - previousClose) / previousClose) * 100
    : null;

  return {
    symbol,
    provider: 'yahoo-chart',
    observedAt,
    lastPrice: price,
    changePct: changePct == null ? null : Number(changePct.toFixed(4)),
    currency: meta.currency || null,
    exchange: meta.exchangeName || meta.fullExchangeName || null,
    raw: {
      regularMarketTime: meta.regularMarketTime || null,
      chartPreviousClose: meta.chartPreviousClose ?? null,
      previousClose: meta.previousClose ?? null,
      timezone: meta.timezone || null,
      instrumentType: meta.instrumentType || null,
    },
  };
}

async function fetchYahooQuote(symbol, { range = '5d', interval = '1h' } = {}) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=${encodeURIComponent(range)}&interval=${encodeURIComponent(interval)}`;
  const response = await fetch(url, {
    headers: { 'User-Agent': CHROME_UA },
    signal: AbortSignal.timeout(12_000),
  });
  if (!response.ok) {
    throw new Error(`Yahoo ${symbol} HTTP ${response.status}`);
  }
  return parseYahooQuotePayload(await response.json(), symbol);
}

export async function fetchMarketQuotes(symbols = DEFAULT_MARKET_QUOTE_SYMBOLS, options = {}) {
  const delayMs = Number(options.delayMs ?? 800);
  const quotes = [];
  const errors = [];
  for (let index = 0; index < symbols.length; index += 1) {
    const symbol = String(symbols[index] || '').trim();
    if (!symbol) continue;
    if (index > 0 && delayMs > 0) await sleep(delayMs);
    try {
      const quote = await fetchYahooQuote(symbol, options);
      if (quote) quotes.push(quote);
      else errors.push({ symbol, error: 'empty Yahoo quote payload' });
    } catch (error) {
      errors.push({ symbol, error: String(error?.message || error) });
    }
  }
  return { quotes, errors };
}

async function ensureMarketQuotesSchema(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS market_quotes (
      symbol text NOT NULL,
      provider text NOT NULL DEFAULT 'unknown',
      observed_at timestamptz,
      fetched_at timestamptz NOT NULL DEFAULT NOW(),
      last_price double precision NOT NULL,
      change_pct double precision,
      currency text,
      exchange text,
      raw jsonb,
      PRIMARY KEY (symbol, fetched_at)
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_market_quotes_symbol_fetched_at
      ON market_quotes (symbol, fetched_at DESC)
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_market_quotes_symbol_observed_at
      ON market_quotes (symbol, observed_at DESC)
  `);
}

export async function writeMarketQuotes(pool, quotes, { updateSignalHistory = true } = {}) {
  await ensureMarketQuotesSchema(pool);
  const written = [];
  for (const quote of quotes) {
    const result = await pool.query(`
      INSERT INTO market_quotes (
        symbol,
        provider,
        observed_at,
        fetched_at,
        last_price,
        change_pct,
        currency,
        exchange,
        raw
      )
      VALUES ($1, $2, $3, NOW(), $4, $5, $6, $7, $8::jsonb)
      ON CONFLICT (symbol, fetched_at) DO UPDATE
        SET provider = EXCLUDED.provider,
            observed_at = EXCLUDED.observed_at,
            last_price = EXCLUDED.last_price,
            change_pct = EXCLUDED.change_pct,
            currency = EXCLUDED.currency,
            exchange = EXCLUDED.exchange,
            raw = EXCLUDED.raw
      RETURNING symbol, provider, observed_at, fetched_at, last_price, change_pct
    `, [
      quote.symbol,
      quote.provider,
      quote.observedAt,
      quote.lastPrice,
      quote.changePct,
      quote.currency,
      quote.exchange,
      JSON.stringify(quote.raw || {}),
    ]);
    written.push(result.rows[0]);

    const signalName = SIGNAL_MAPPINGS.get(quote.symbol);
    if (updateSignalHistory && signalName && quote.observedAt) {
      try {
        await writeSignalHistoryRow(pool, {
          signalName,
          ts: quote.observedAt,
          value: quote.lastPrice,
          valueOrigin: SIGNAL_ORIGIN.OBSERVED,
          writerId: 'refresh-market-quotes',
        });
      } catch (err) {
        console.warn(`signal_history write failed for ${signalName}: ${err.message}`);
      }
    }
  }
  return written;
}

export async function refreshMarketQuotesToNas(options = {}) {
  loadOptionalEnvFile(options.envFile || '.env.local');
  const symbols = Array.isArray(options.symbols) && options.symbols.length
    ? options.symbols
    : DEFAULT_MARKET_QUOTE_SYMBOLS;
  const fetched = await fetchMarketQuotes(symbols, options);
  if (!fetched.quotes.length) {
    return {
      ok: false,
      written: [],
      errors: fetched.errors,
      error: 'no market quotes fetched',
    };
  }
  if (options.dryRun) {
    return {
      ok: true,
      dryRun: true,
      written: [],
      quotes: fetched.quotes,
      errors: fetched.errors,
    };
  }
  const pool = new Pool({ ...resolveNasPgConfig(), max: 2 });
  try {
    const written = await writeMarketQuotes(pool, fetched.quotes, {
      updateSignalHistory: options.updateSignalHistory !== false,
    });
    return {
      ok: true,
      written,
      errors: fetched.errors,
    };
  } finally {
    await pool.end().catch(() => {});
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const symbols = args.symbols
    ? String(args.symbols).split(',').map((symbol) => symbol.trim()).filter(Boolean)
    : DEFAULT_MARKET_QUOTE_SYMBOLS;
  const result = await refreshMarketQuotesToNas({
    symbols,
    dryRun: Boolean(args['dry-run']),
    updateSignalHistory: args['skip-signal-history'] ? false : true,
    delayMs: args['delay-ms'] ? Number(args['delay-ms']) : undefined,
  });
  process.stdout.write(`${JSON.stringify({
    ok: result.ok,
    dryRun: Boolean(result.dryRun),
    written: result.written?.length || 0,
    quotes: result.quotes?.length || undefined,
    errors: result.errors || [],
  }, null, 2)}\n`);
  if (!result.ok) process.exitCode = 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((error) => {
    process.stderr.write(`${String(error?.stack || error?.message || error)}\n`);
    process.exitCode = 1;
  });
}
