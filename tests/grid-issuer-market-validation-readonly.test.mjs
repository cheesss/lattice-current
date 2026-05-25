import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildDefaultGridIssuerMarketQuotes,
  buildGridIssuerMarketEventAnchors,
  collectGridIssuerMarketValidationReadonly,
  defaultGridIssuerMarketAcceptedEvidence,
} from '../scripts/_shared/external-data/grid-issuer-market-validation-readonly.mjs';
import { buildMarketValidationRegimeSupport } from '../scripts/_shared/valuation-expectation-bridge-dry-run.mjs';

test('accepted evidence anchors drive controlled market window calculation', () => {
  const acceptedEvidence = defaultGridIssuerMarketAcceptedEvidence({ seedId: 'market-seed' });
  const anchors = buildGridIssuerMarketEventAnchors(acceptedEvidence);
  assert.equal(anchors.some((anchor) => anchor.eventAnchorType === 'issuer_bridge_event'), true);
  assert.equal(anchors.some((anchor) => anchor.eventAnchorType === 'holdout_utility_capex_event'), true);

  const result = collectGridIssuerMarketValidationReadonly({
    seedId: 'market-seed',
    acceptedEvidence,
  });
  assert.equal(result.marketValidationStatus, 'controlled_ready');
  assert.equal(result.windowResults.length > 0, true);
  assert.equal(result.acceptedEvidence.length, 1);
  assert.equal(result.benchmarkUsed, 'SPY');
  assert.equal(result.controlUsed, true);
  assert.equal(result.sampleSize >= 30, true);
});

test('default local market quotes produce classified regime support without external provider fixture', () => {
  const result = collectGridIssuerMarketValidationReadonly({
    seedId: 'market-regime-seed',
    acceptedEvidence: defaultGridIssuerMarketAcceptedEvidence({ seedId: 'market-regime-seed' }),
  });
  assert.equal(result.marketValidationStatus, 'controlled_ready');
  assert.equal(result.warnings.includes('sanity_check_extreme_tstat'), false);
  assert.equal(result.windowResults.every((row) => row.marketRegime && row.marketRegime !== 'unknown'), true);
  assert.equal(result.windowResults.every((row) => row.volatilityRegime && row.volatilityRegime !== 'unknown'), true);
  assert.equal(result.windowResults.every((row) => row.rateRegime && row.rateRegime !== 'unknown'), true);
  assert.equal(result.windowResults.every((row) => row.sectorRegime && row.sectorRegime !== 'unknown'), true);
  assert.equal(result.windowResults.every((row) => row.localRegimeSource === 'local_market_quotes_derived_with_rate_proxy'), true);

  const regimeSupport = buildMarketValidationRegimeSupport({
    marketValidationStatus: result.marketValidationStatus,
    marketValidationSampleSize: result.sampleSize,
    marketValidationBenchmarkUsed: result.benchmarkUsed,
    marketValidationControlUsed: result.controlUsed,
    marketValidationEventAnchorCount: result.eventAnchors.length,
    marketValidationWindowResults: result.windowResults,
    marketValidationWarnings: result.warnings,
    marketValidationCaveats: result.caveats,
  });
  assert.equal(regimeSupport.marketValidationRegimeStatus, 'regime_supported');
  assert.equal(regimeSupport.marketValidationInvestmentUseAllowed, true);
  assert.equal(regimeSupport.marketValidationDecisionUseAllowed, false);
});

test('local market rows without rate proxy remain regime caveated', () => {
  const quotesWithoutRateProxy = buildDefaultGridIssuerMarketQuotes({
    symbols: ['PWR', 'ACM', 'J', 'SPY', 'XLI', 'GRID'],
  });
  const result = collectGridIssuerMarketValidationReadonly({
    seedId: 'market-regime-missing-rate',
    acceptedEvidence: defaultGridIssuerMarketAcceptedEvidence({ seedId: 'market-regime-missing-rate' }),
    marketQuotes: quotesWithoutRateProxy,
  });
  assert.equal(result.marketValidationStatus, 'controlled_ready');
  assert.equal(result.windowResults.every((row) => row.rateRegime === 'unknown'), true);

  const regimeSupport = buildMarketValidationRegimeSupport({
    marketValidationStatus: result.marketValidationStatus,
    marketValidationSampleSize: result.sampleSize,
    marketValidationBenchmarkUsed: result.benchmarkUsed,
    marketValidationControlUsed: result.controlUsed,
    marketValidationEventAnchorCount: result.eventAnchors.length,
    marketValidationWindowResults: result.windowResults,
    marketValidationWarnings: result.warnings,
    marketValidationCaveats: result.caveats,
  });
  assert.notEqual(regimeSupport.marketValidationRegimeStatus, 'regime_supported');
  assert.equal(regimeSupport.missingRegimeInputs.includes('rateRegime'), true);
});

test('raw or rejected source-query anchors are not used', () => {
  const anchors = buildGridIssuerMarketEventAnchors([{
    evidenceId: 'raw-source-query-market',
    evidenceClass: 'issuer_exposure',
    evidenceUse: 'weak_noise',
    sourceGroup: 'source_query',
    acceptanceVerdict: 'not_evaluated_raw',
    documentDate: '2025-02-20',
    issuer: 'PWR',
  }]);
  assert.equal(anchors.length, 0);
  const result = collectGridIssuerMarketValidationReadonly({
    acceptedEvidence: [{
      evidenceId: 'rejected-source-query-market',
      evidenceClass: 'issuer_exposure',
      evidenceUse: 'weak_noise',
      sourceGroup: 'source_query',
      acceptanceVerdict: 'rejected',
      documentDate: '2025-02-20',
      issuer: 'PWR',
    }],
    useDefaultAcceptedEvidence: false,
  });
  assert.equal(result.marketValidationStatus, 'insufficient_market_data');
  assert.equal(result.acceptedEvidence.length, 0);
});

test('missing local market data remains insufficient', () => {
  const result = collectGridIssuerMarketValidationReadonly({
    acceptedEvidence: defaultGridIssuerMarketAcceptedEvidence({ seedId: 'missing-market-data' }),
    marketQuotes: [],
  });
  assert.equal(result.marketValidationStatus, 'insufficient_market_data');
  assert.equal(result.acceptedEvidence.length, 0);
});

test('raw issuer return without benchmark or controls cannot become controlled_ready', () => {
  const quotes = buildDefaultGridIssuerMarketQuotes({ symbols: ['PWR'] });
  const result = collectGridIssuerMarketValidationReadonly({
    acceptedEvidence: defaultGridIssuerMarketAcceptedEvidence({ seedId: 'pwr-only' }).filter((row) => row.issuer === 'PWR'),
    issuerUniverse: ['PWR'],
    marketQuotes: quotes,
  });
  assert.notEqual(result.marketValidationStatus, 'controlled_ready');
  assert.equal(result.acceptedEvidence.length, 0);
});

test('directionally unsupported local data creates non-promotion risk status', () => {
  const quotes = buildDefaultGridIssuerMarketQuotes().map((row) => {
    if (row.symbol !== 'PWR') return row;
    if (row.date >= '2025-02-20' && row.date <= '2025-02-25') {
      return { ...row, close: row.close * 0.92 };
    }
    return row;
  });
  const result = collectGridIssuerMarketValidationReadonly({
    acceptedEvidence: defaultGridIssuerMarketAcceptedEvidence({ seedId: 'negative-market' }).filter((row) => row.issuer === 'PWR'),
    issuerUniverse: ['PWR', 'ACM', 'J'],
    marketQuotes: quotes,
  });
  assert.equal(['not_directionally_supported', 'market_validation_caveated', 'inconclusive'].includes(result.marketValidationStatus), true);
  if (result.marketValidationStatus === 'not_directionally_supported') {
    assert.equal(result.acceptedEvidence.length, 0);
  }
});
