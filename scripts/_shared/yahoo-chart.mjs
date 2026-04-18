/**
 * Unified Yahoo Finance chart API helpers.
 *
 * Before this module, three separate implementations existed across
 * refresh-market-quotes-to-nas.mjs, bootstrap-market-quotes-history.mjs,
 * and parts of _seed-utils.mjs — each with slightly different timeouts,
 * parsers, and error handling. This module is the single source of truth
 * for non-seed nowcast / market-quote code paths.
 *
 * Seed scripts (_seed-utils.mjs, seed-market-quotes.mjs, seed-gulf-quotes.mjs)
 * keep their own legacy helpers intentionally — their output shape is tuned
 * for the seed cache format and is not worth migrating unless those scripts
 * are revisited.
 *
 * Provides:
 *   - fetchYahooChart(symbol, opts) → raw Yahoo JSON
 *   - parseQuoteSnapshot(data, symbol) → latest snapshot {symbol, observedAt, lastPrice, ...}
 *   - parseDailyBars(data, symbol) → array of daily bars [{symbol, observedAt, price, ...}, ...]
 */

import process from 'node:process';

const CHROME_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36';

const DEFAULT_TIMEOUT_MS = 15_000;

/**
 * Direct fetch against query1.finance.yahoo.com. Returns parsed JSON or
 * throws with a symbol-qualified error message.
 *
 * @param {string} symbol
 * @param {{ range?: string, interval?: string, timeoutMs?: number }} opts
 */
export async function fetchYahooChart(symbol, opts = {}) {
  const range = String(opts.range || '5d');
  const interval = String(opts.interval || '1h');
  const timeoutMs = Number(opts.timeoutMs || DEFAULT_TIMEOUT_MS);
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}`
    + `?range=${encodeURIComponent(range)}&interval=${encodeURIComponent(interval)}`;
  const response = await fetch(url, {
    headers: { 'User-Agent': CHROME_UA },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) {
    throw new Error(`Yahoo ${symbol} HTTP ${response.status}`);
  }
  return response.json();
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

/**
 * Parse the latest snapshot from a Yahoo chart payload. Combines
 * `meta.regularMarketTime / regularMarketPrice` with the most recent non-null
 * bar close in the indicators array.
 *
 * Returns null if no usable price / timestamp found (caller decides whether
 * to treat as error or skip).
 *
 * @param {object} payload  raw JSON from fetchYahooChart
 * @param {string} symbol
 * @returns {null | { symbol, provider, observedAt, lastPrice, changePct, currency, exchange, raw }}
 */
export function parseQuoteSnapshot(payload, symbol) {
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

/**
 * Parse every valid daily bar from a Yahoo chart payload. Used by
 * historical-backfill paths that need a full time series, not just the
 * latest snapshot.
 *
 * Bars with non-finite close are dropped. Output is sorted chronologically
 * (same order Yahoo returns them).
 *
 * @param {object} payload  raw JSON from fetchYahooChart (range+interval sized for history)
 * @param {string} symbol
 * @returns {Array<{ symbol, observedAt, price, currency, exchange }>}
 */
export function parseDailyBars(payload, symbol) {
  const result = payload?.chart?.result?.[0];
  const timestamps = Array.isArray(result?.timestamp) ? result.timestamp : [];
  const quote = result?.indicators?.quote?.[0] || {};
  const closes = Array.isArray(quote.close) ? quote.close : [];
  const meta = result?.meta || {};

  const bars = [];
  for (let i = 0; i < timestamps.length; i += 1) {
    const observedAt = toIsoFromEpochSeconds(timestamps[i]);
    const price = asFiniteNumber(closes[i]);
    if (!observedAt || price == null) continue;
    bars.push({
      symbol,
      observedAt,
      price,
      currency: meta.currency || null,
      exchange: meta.exchangeName || meta.fullExchangeName || null,
    });
  }
  return bars;
}

export const YAHOO_USER_AGENT = CHROME_UA;
