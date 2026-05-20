import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildReportValuationReadiness,
  buildValuationSymbolRow,
  classifyValuationTier,
  computeReturnsProfile,
  summarizeValuation,
} from '../scripts/_shared/report-valuation-readiness.mjs';

function makeQuoteSeries(prices = [], { startDaysAgo = 30, intervalDays = 1, now = new Date('2026-05-19T00:00:00Z') } = {}) {
  return prices.map((price, index) => ({
    observed_at: new Date(now.getTime() - (startDaysAgo - index * intervalDays) * 24 * 60 * 60 * 1000).toISOString(),
    last_price: price,
  }));
}

function fakeClient(seriesBySymbol = {}) {
  return {
    async query(sql, params) {
      const symbol = String(params?.[0] || '').toUpperCase();
      const start = params?.[1];
      const end = params?.[2];
      const rows = (seriesBySymbol[symbol] || []).filter((row) => {
        const at = Date.parse(row.observed_at);
        return at >= Date.parse(start) && at <= Date.parse(end);
      });
      return { rows };
    },
  };
}

test('classifyValuationTier flags overheated when excess return >= 30% and PE >= 1.5x peer median', () => {
  const result = classifyValuationTier({
    excessVsSpy90d: 0.35,
    drawdown90d: -0.02,
    peVsPeerMedian: 1.8,
  });
  assert.equal(result.tier, 'overheated');
  assert.ok(result.reasons.some((reason) => reason.includes('excess_return')));
});

test('classifyValuationTier marks extended when excess return >= 15% with no meaningful drawdown', () => {
  const result = classifyValuationTier({
    excessVsSpy90d: 0.20,
    drawdown90d: -0.02,
    peVsPeerMedian: null,
  });
  assert.equal(result.tier, 'extended');
});

test('classifyValuationTier marks cheap when PE is below 0.8 of peer median', () => {
  const result = classifyValuationTier({
    excessVsSpy90d: -0.05,
    drawdown90d: -0.08,
    peVsPeerMedian: 0.7,
  });
  assert.equal(result.tier, 'cheap');
});

test('classifyValuationTier returns unknown when excessVsSpy90d is not finite', () => {
  const result = classifyValuationTier({
    excessVsSpy90d: null,
    peVsPeerMedian: null,
  });
  assert.equal(result.tier, 'unknown');
});

test('computeReturnsProfile derives 30d/90d/YTD totals and 60d realized vol', () => {
  const series30 = makeQuoteSeries([100, 105, 110, 108, 115]);
  const series90 = makeQuoteSeries([95, 100, 110, 120, 115], { startDaysAgo: 90, intervalDays: 22 });
  const seriesYtd = makeQuoteSeries([90, 95, 100, 110, 120], { startDaysAgo: 150, intervalDays: 30 });
  const profile = computeReturnsProfile(series30, series90, seriesYtd);
  assert.ok(profile.return30d > 0);
  assert.ok(profile.return90d > 0);
  assert.ok(profile.returnYtd > 0);
  assert.ok(profile.realizedVol60d > 0);
});

test('summarizeValuation surfaces overheated tier when any symbol is overheated', () => {
  const rows = [
    { tier: 'fairly_valued', quoteCount90d: 60, valuation: { peTtm: 22 } },
    { tier: 'overheated', quoteCount90d: 60, valuation: { peTtm: 60 } },
  ];
  const summary = summarizeValuation(rows);
  assert.equal(summary.tier, 'overheated');
  assert.equal(summary.overheatedSymbolCount, 1);
});

test('summarizeValuation returns no_market_quotes missing class when no symbol has coverage', () => {
  const rows = [
    { tier: 'unknown', quoteCount90d: 0, valuation: null },
    { tier: 'unknown', quoteCount90d: 0, valuation: null },
  ];
  const summary = summarizeValuation(rows);
  assert.ok(summary.missingClass.includes('no_market_quotes'));
});

test('buildValuationSymbolRow blocks overheated symbols with explicit nextAction', () => {
  const row = buildValuationSymbolRow({
    symbolReturns: {
      symbol: 'PWR',
      excessVsSpy90d: 0.40,
      excessVsSectorEtf90d: 0.50,
      returns: { drawdown90d: -0.01 },
      quoteCount90d: 60,
    },
    valuationSnapshot: { peTtm: 40, peVsPeerMedian: 2.0, forwardEpsGrowth: 0.05 },
  });
  assert.equal(row.tier, 'overheated');
  assert.match(row.nextAction, /flag run-up risk/);
});

test('buildReportValuationReadiness returns idle summary when issuerUniverse is empty', async () => {
  const result = await buildReportValuationReadiness(null, {}, { issuerUniverse: [] });
  assert.equal(result.summary.tier, 'unknown');
  assert.ok(result.summary.missingClass.includes('no_issuer_universe'));
});

test('buildReportValuationReadiness returns no_market_client missing class when client lacks query', async () => {
  const result = await buildReportValuationReadiness({}, {}, { issuerUniverse: ['PWR'] });
  assert.equal(result.summary.tier, 'unknown');
  assert.ok(result.summary.missingClass.includes('no_market_client'));
  assert.equal(result.perSymbol.length, 1);
  assert.equal(result.perSymbol[0].tier, 'unknown');
});

test('buildReportValuationReadiness classifies a clearly overheated symbol from local quotes', async () => {
  const baseDay = 24 * 60 * 60 * 1000;
  const now = new Date('2026-05-19T00:00:00Z');
  const pwr90 = Array.from({ length: 60 }, (_, i) => ({
    observed_at: new Date(now.getTime() - (60 - i) * baseDay).toISOString(),
    last_price: 100 + i * 1.0,
  }));
  const spy90 = Array.from({ length: 60 }, (_, i) => ({
    observed_at: new Date(now.getTime() - (60 - i) * baseDay).toISOString(),
    last_price: 100 + i * 0.05,
  }));
  const xlu90 = Array.from({ length: 60 }, (_, i) => ({
    observed_at: new Date(now.getTime() - (60 - i) * baseDay).toISOString(),
    last_price: 100 + i * 0.05,
  }));
  const client = fakeClient({
    PWR: pwr90,
    SPY: spy90,
    XLU: xlu90,
  });
  const result = await buildReportValuationReadiness(client, {
    bundle: {
      subject: { displayName: 'substation grid power transformer interconnection' },
    },
  }, { issuerUniverse: ['PWR'], now });
  assert.equal(result.perSymbol.length, 1);
  const row = result.perSymbol[0];
  assert.ok(['extended', 'overheated'].includes(row.tier), `expected extended or overheated; got ${row.tier}; excess=${row.excessVsSpy90d}`);
});
