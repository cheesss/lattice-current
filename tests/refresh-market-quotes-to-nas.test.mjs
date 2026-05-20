import test from 'node:test';
import assert from 'node:assert/strict';
import { parseYahooQuotePayload } from '../scripts/refresh-market-quotes-to-nas.mjs';

test('parseYahooQuotePayload extracts price, observed time, and change pct', () => {
  const payload = {
    chart: {
      result: [{
        meta: {
          regularMarketPrice: 18.14,
          chartPreviousClose: 19.23,
          regularMarketTime: 1776258000,
          currency: 'USD',
          exchangeName: 'CBOE',
        },
        timestamp: [1776254400, 1776258000],
        indicators: {
          quote: [{ close: [18.2, 18.14] }],
        },
      }],
    },
  };

  const quote = parseYahooQuotePayload(payload, '^VIX');

  assert.equal(quote.symbol, '^VIX');
  assert.equal(quote.provider, 'yahoo-chart');
  assert.equal(quote.lastPrice, 18.14);
  assert.equal(quote.observedAt, '2026-04-15T13:00:00.000Z');
  assert.equal(quote.changePct, -5.6682);
});

test('parseYahooQuotePayload falls back to latest close and timestamp', () => {
  const payload = {
    chart: {
      result: [{
        meta: {
          previousClose: 100,
        },
        timestamp: [1776254400, 1776258000],
        indicators: {
          quote: [{ close: [101, 102] }],
        },
      }],
    },
  };

  const quote = parseYahooQuotePayload(payload, 'TEST');

  assert.equal(quote.lastPrice, 102);
  assert.equal(quote.observedAt, '2026-04-15T13:00:00.000Z');
  assert.equal(quote.changePct, 2);
});

test('parseYahooQuotePayload rejects unusable payloads', () => {
  assert.equal(parseYahooQuotePayload({ chart: { result: [] } }, '^VIX'), null);
  assert.equal(parseYahooQuotePayload({ chart: { result: [{ meta: {}, indicators: {} }] } }, '^VIX'), null);
});
