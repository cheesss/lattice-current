import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';

import {
  loadLocalValuationFundamentalsCache,
  normalizeLocalValuationFundamentalRow,
} from '../scripts/_shared/external-data/local-valuation-fundamentals-cache.mjs';

const fixtureRoot = path.resolve('tests/fixtures');

test('local valuation cache loads only trusted fixture rows with provenance and as-of dates', () => {
  const cache = loadLocalValuationFundamentalsCache({
    fixturePath: path.join(fixtureRoot, 'local-valuation-fundamentals-cache.caveated.json'),
    issuerUniverse: ['PWR', 'ACM', 'J'],
  });
  assert.equal(cache.rowCount, 2);
  assert.deepEqual(cache.missingIssuers, ['J']);
  assert.equal(cache.externalProviderCalls, 0);
  assert.equal(cache.providerActivationWrites, 0);
  assert.equal(cache.rows.every((row) => row.sourceProvenance && row.asOfDate), true);
});

test('local valuation cache rejects RSS and web-snippet provenance', () => {
  const row = normalizeLocalValuationFundamentalRow({
    issuer: 'PWR',
    ticker: 'PWR',
    sourceProvenance: 'web_snippet',
    asOfDate: '2026-05-15',
    forwardPE: 20,
  });
  assert.equal(row.sourceAllowed, false);
  assert.equal(row.validationErrors.includes('untrusted_source_provenance'), true);
});

test('local valuation cache preserves price expectation context for accepted issuer bridge rows', () => {
  const cache = loadLocalValuationFundamentalsCache({
    rows: [
      {
        issuer: 'NOC',
        sourceProvenance: 'trusted_local_market_cache',
        asOfDate: '2026-05-24',
        acceptedIssuerBridgeEvidenceIds: ['accepted:noc:bridge'],
        localPriceWindow: {
          return90d: 0.04,
          excessVsBenchmark90d: 0.01,
          excessVsPeerBasket90d: 0.02,
          realizedVol60d: 0.18,
        },
        peerContext: {
          peerGroup: ['LHX', 'LMT'],
          peerMedianForwardPE: 19,
          peerRelativeMove: 0.01,
        },
        fundamentalsContext: {
          backlog: 84000000000,
          guidanceRevenue: 43500000000,
          consensusRevisionDirection: 'stable',
        },
      },
    ],
    issuerUniverse: ['NOC'],
  });

  assert.equal(cache.rowCount, 1);
  assert.deepEqual(cache.rows[0].acceptedIssuerBridgeEvidenceIds, ['accepted:noc:bridge']);
  assert.equal(cache.rows[0].localPriceWindow.excessVsPeerBasket90d, 0.02);
  assert.equal(cache.rows[0].peerContext.peerRelativeMove, 0.01);
  assert.equal(cache.rows[0].fundamentalsContext.consensusRevisionDirection, 'stable');
});

test('local valuation missing fixture records all issuers as missing without estimating values', () => {
  const cache = loadLocalValuationFundamentalsCache({
    fixturePath: path.join(fixtureRoot, 'local-valuation-fundamentals-cache.missing.json'),
    issuerUniverse: ['PWR', 'ACM', 'J'],
  });
  assert.equal(cache.rowCount, 0);
  assert.deepEqual(cache.missingIssuers, ['PWR', 'ACM', 'J']);
});
