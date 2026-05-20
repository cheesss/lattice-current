/*
 * Polygon.io adapter.
 *
 * Adds marketPack evidence:
 *   - latest adjusted OHLCV bar for a ticker
 *   - ticker reference metadata
 *
 * This is intentionally narrow. Event-window and peer-basket history should be
 * collected through a dedicated backfill job so reports can cite immutable
 * market observations instead of making live calls during rendering.
 */

import { safeFetchJson, resolveEnvKey, SUBJECT_KINDS } from './adapter-base.mjs';

export const provider = {
  name: 'polygon',
  displayName: 'Polygon.io',
  keyEnvVar: 'POLYGON_API_KEY',
  signupUrl: 'https://polygon.io/docs',
  subjectKinds: [SUBJECT_KINDS.SYMBOL],
  pricing: 'paid',
  monthlyCost: 29,
  dataKinds: ['market_prices', 'ohlcv', 'ticker_reference'],
};

export function isAvailable() {
  return resolveEnvKey('POLYGON_API_KEY') !== null;
}

export async function loadFor(subject, opts = {}) {
  const apiKey = resolveEnvKey('POLYGON_API_KEY');
  if (!apiKey) return { ok: false, errors: [{ kind: 'no_key', message: 'POLYGON_API_KEY not set.' }] };
  const symbol = subject?.kind === SUBJECT_KINDS.SYMBOL ? subject.key : (opts.symbol || subject?.symbol);
  if (!symbol) return { ok: false, errors: [{ kind: 'no_symbol' }] };
  const ticker = String(symbol).toUpperCase();
  const encoded = encodeURIComponent(ticker);
  const key = encodeURIComponent(apiKey);

  const previousBar = await safeFetchJson(`https://api.polygon.io/v2/aggs/ticker/${encoded}/prev?adjusted=true&apiKey=${key}`);
  const reference = await safeFetchJson(`https://api.polygon.io/v3/reference/tickers/${encoded}?apiKey=${key}`);

  const errors = [];
  if (!previousBar.ok) errors.push({ kind: 'previous_bar_failed', error: previousBar.error, status: previousBar.status });
  if (!reference.ok) errors.push({ kind: 'reference_failed', error: reference.error, status: reference.status });

  const bar = Array.isArray(previousBar.json?.results) ? previousBar.json.results[0] : null;
  const ref = reference.json?.results || null;
  return {
    ok: true,
    pack: {
      available: Boolean(bar || ref),
      symbol: ticker,
      previousBar: bar ? {
        timestamp: bar.t ? new Date(bar.t).toISOString() : null,
        open: bar.o,
        high: bar.h,
        low: bar.l,
        close: bar.c,
        volume: bar.v,
        vwap: bar.vw,
        adjusted: previousBar.json?.adjusted === true,
      } : null,
      reference: ref ? {
        name: ref.name,
        market: ref.market,
        locale: ref.locale,
        primaryExchange: ref.primary_exchange,
        type: ref.type,
        active: ref.active,
        currencyName: ref.currency_name,
        marketCap: ref.market_cap,
        sicDescription: ref.sic_description,
      } : null,
    },
    errors,
  };
}
