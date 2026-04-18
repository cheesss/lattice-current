#!/usr/bin/env node
import process from 'node:process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { sleep } from './_seed-utils.mjs';
import { loadOptionalEnvFile, resolveNasPgConfig } from './_shared/nas-runtime.mjs';
import { writeSignalHistoryRow, SIGNAL_ORIGIN } from './_shared/signal-history-writer.mjs';
import {
  getAllRequiredSymbols,
  getSignalMappings,
} from './_shared/market-quote-symbols.mjs';
import { fetchYahooChart, parseQuoteSnapshot } from './_shared/yahoo-chart.mjs';

const { Pool } = pg;

// Core snapshots + every nowcast feature symbol. Kept as a single source of
// truth in scripts/_shared/market-quote-symbols.json so daemon refresh,
// trainers, bootstrap, and coverage audit all agree.
export const DEFAULT_MARKET_QUOTE_SYMBOLS = getAllRequiredSymbols();

const SIGNAL_MAPPINGS = new Map(Object.entries(getSignalMappings()));

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

// Re-export for backward compat with any external consumers importing these
// names. The implementations live in _shared/yahoo-chart.mjs.
export { parseQuoteSnapshot as parseYahooQuotePayload } from './_shared/yahoo-chart.mjs';

async function fetchYahooQuote(symbol, opts = {}) {
  const payload = await fetchYahooChart(symbol, {
    range: opts.range || '5d',
    interval: opts.interval || '1h',
    timeoutMs: 12_000,
  });
  return parseQuoteSnapshot(payload, symbol);
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
