import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildSyntheticMarkets,
  computeTransmissionStrength,
  mapArticleRowsToNews,
  parseArgs,
} from '../scripts/refresh-event-market-transmission.mjs';

test('refresh-event-market-transmission parses CLI args', () => {
  const parsed = parseArgs(['--days', '21', '--limit', '240', '--dry-run']);
  assert.equal(parsed.days, 21);
  assert.equal(parsed.limit, 240);
  assert.equal(parsed.dryRun, true);
});

test('refresh-event-market-transmission maps article rows into news items', () => {
  const news = mapArticleRowsToNews([{
    title: 'Ukraine drone attack',
    source: 'guardian',
    published_at: '2026-04-14T00:00:00Z',
    url: 'https://example.com/story',
    location_name: 'Kyiv',
  }]);
  assert.equal(news.length, 1);
  assert.equal(news[0].title, 'Ukraine drone attack');
  assert.equal(news[0].source, 'guardian');
  assert.equal(news[0].link, 'https://example.com/story');
  assert.equal(news[0].locationName, 'Kyiv');
});

test('refresh-event-market-transmission builds synthetic market moves from signal history', () => {
  const markets = buildSyntheticMarkets([
    { signal_name: 'vix', value: 18, ts: '2026-04-13T00:00:00Z' },
    { signal_name: 'vix', value: 22, ts: '2026-04-14T00:00:00Z' },
    { signal_name: 'oilPrice', value: 70, ts: '2026-04-13T00:00:00Z' },
    { signal_name: 'oilPrice', value: 74, ts: '2026-04-14T00:00:00Z' },
    { signal_name: 'yieldSpread', value: -0.2, ts: '2026-04-13T00:00:00Z' },
    { signal_name: 'yieldSpread', value: -0.35, ts: '2026-04-14T00:00:00Z' },
  ], [
    { symbol: '^VIX', name: 'VIX', display: 'VIX' },
    { symbol: 'CL=F', name: 'Crude Oil', display: 'OIL' },
    { symbol: 'TLT', name: 'Long Treasury ETF', display: 'TLT' },
    { symbol: 'DBC', name: 'Commodity Basket', display: 'DBC' },
  ]);

  const bySymbol = new Map(markets.map((market) => [market.symbol, market]));
  assert.equal(bySymbol.get('^VIX')?.change, 4);
  assert.equal(bySymbol.get('CL=F')?.change, 4);
  assert.equal(bySymbol.get('TLT')?.change, -0.15);
  assert.deepEqual(bySymbol.get('DBC')?.sparkline, [70, 74]);
});

test('refresh-event-market-transmission computes bounded transmission strength', () => {
  const strength = computeTransmissionStrength({
    edges: [
      { strength: 90 },
      { strength: 70 },
      { strength: 50 },
    ],
  });

  assert.equal(strength, 0.5767);
  assert.equal(computeTransmissionStrength({ edges: [] }), null);
});
