import assert from 'node:assert/strict';
import test from 'node:test';

import {
  runValuationContextRequirementExecutor,
} from '../scripts/_shared/valuation-context-requirement-executor.mjs';

function rotationRequirement(issuer = 'ABC', overrides = {}) {
  return {
    valuationContextRequirements: [
      {
        requirementId: `valuation-context-${issuer.toLowerCase()}`,
        requirementType: 'local_valuation_expectation_context',
        seedId: 'seed-generic-valuation',
        trackId: 'issuer_bridge_track',
        issuer,
        acceptedIssuerBridgeEvidenceIds: [`accepted:${issuer.toLowerCase()}:bridge`],
        status: 'local_market_or_valuation_fixture_required',
        ...overrides,
      },
    ],
    activeCandidateSeed: {
      seedId: 'seed-generic-valuation',
      trackId: 'issuer_bridge_track',
    },
  };
}

function linkerContext(issuer = 'ABC', overrides = {}) {
  return {
    seedContexts: [
      {
        seedId: 'seed-generic-valuation',
        trackId: 'issuer_bridge_track',
        subjectLabel: 'generic bottleneck',
        bottleneckNode: 'generic bottleneck',
        gateEligible: true,
        issuerUniverse: [issuer],
        contextRows: [],
        missingIssuerFundamentals: [issuer],
        fixtureRequirements: rotationRequirement(issuer).valuationContextRequirements,
        ...overrides,
      },
    ],
  };
}

test('valuation requirement executor creates caveated trusted cache rows for generic accepted issuers', async () => {
  const result = await runValuationContextRequirementExecutor({
    valuationContextRotation: rotationRequirement('ABC'),
    valuationContextAutoLinker: linkerContext('ABC'),
    historicalAnalogueBridge: {
      usableAnalogueCount: 2,
      bestAnalogueIds: ['analogue-a', 'analogue-b'],
      topScores: [
        { analogueId: 'analogue-a', peerBasket: ['XYZ', 'DEF'] },
        { analogueId: 'analogue-b', peerBasket: ['GHI'] },
      ],
    },
    localPriceContextRows: [
      {
        issuer: 'ABC',
        sourceProvenance: 'trusted_local_market_cache',
        asOfDate: '2026-05-24',
        localPriceWindow: {
          return90d: 0.04,
          excessVsBenchmark90d: 0.01,
          excessVsPeerBasket90d: 0.02,
        },
      },
    ],
    generatedAt: '2026-05-25T00:00:00.000Z',
  });

  assert.equal(result.taskCount, 1);
  assert.equal(result.valuationContextRowsCreated, 1);
  assert.equal(result.rows[0].issuer, 'ABC');
  assert.deepEqual(result.rows[0].acceptedIssuerBridgeEvidenceIds, ['accepted:abc:bridge']);
  assert.equal(result.rows[0].localPriceWindow.excessVsBenchmark90d, 0.01);
  assert.equal(result.rows[0].peerContext.peerGroup.includes('XYZ'), true);
  assert.equal(result.rows[0].expectationContextCaveat.includes('fundamentals_or_consensus_context_missing'), true);
  assert.equal(result.valuationContextSourceStatus, 'context_created');
  assert.equal(result.mutationBoundary.readinessPromotionWrites, 0);
});

test('valuation requirement executor derives partial price context from local market quotes table', async () => {
  const dbClient = {
    async query(sql) {
      if (/FROM market_quotes/i.test(sql)) {
        return {
          rows: [
            { symbol: 'ABC', observed_at: '2026-02-25T00:00:00.000Z', last_price: 100, provider: 'local' },
            { symbol: 'ABC', observed_at: '2026-04-25T00:00:00.000Z', last_price: 105, provider: 'local' },
            { symbol: 'ABC', observed_at: '2026-05-25T00:00:00.000Z', last_price: 110, provider: 'local' },
            { symbol: 'SPY', observed_at: '2026-02-25T00:00:00.000Z', last_price: 500, provider: 'local' },
            { symbol: 'SPY', observed_at: '2026-05-25T00:00:00.000Z', last_price: 520, provider: 'local' },
            { symbol: 'XYZ', observed_at: '2026-02-25T00:00:00.000Z', last_price: 40, provider: 'local' },
            { symbol: 'XYZ', observed_at: '2026-05-25T00:00:00.000Z', last_price: 42, provider: 'local' },
          ],
        };
      }
      if (/FROM company_fundamentals/i.test(sql)) return { rows: [] };
      return { rows: [] };
    },
  };
  const result = await runValuationContextRequirementExecutor({
    valuationContextRotation: rotationRequirement('ABC'),
    valuationContextAutoLinker: linkerContext('ABC'),
    historicalAnalogueBridge: {
      topScores: [{ analogueId: 'analogue-a', peerBasket: ['XYZ'] }],
    },
    dbClient,
    localPriceContextRows: [],
    generatedAt: '2026-05-25T00:00:00.000Z',
  });

  assert.equal(result.valuationContextRowsCreated, 1);
  assert.equal(result.rows[0].sourceProvenance, 'trusted_local_market_quotes_cache');
  assert.equal(result.rows[0].localPriceWindow.return90d, 0.1);
  assert.equal(result.rows[0].localPriceWindow.excessVsBenchmark90d, 0.06);
  assert.equal(result.rows[0].peerContext.peerGroup.includes('XYZ'), true);
  assert.equal(result.rows[0].valuationContextSourceStatus, 'valuation_context_partial');
  assert.equal(result.dbContextRead.status, 'context_rows_loaded');
  assert.equal(result.dbContextRead.marketQuoteRowCount, 7);
});

test('valuation requirement executor derives partial fundamentals context from company fundamentals table', async () => {
  const dbClient = {
    async query(sql) {
      if (/FROM market_quotes/i.test(sql)) return { rows: [] };
      if (/FROM company_fundamentals/i.test(sql)) {
        return {
          rows: [
            {
              symbol: 'ABC',
              period_end: '2026-03-31',
              metric_name: 'revenue growth',
              value_num: 0.08,
              source_type: 'trusted_local_fundamentals_cache',
              metadata: {},
              created_at: '2026-05-01T00:00:00.000Z',
            },
            {
              symbol: 'ABC',
              period_end: '2026-03-31',
              metric_name: 'backlog',
              value_num: 1200,
              source_type: 'trusted_local_fundamentals_cache',
              metadata: {},
              created_at: '2026-05-01T00:00:00.000Z',
            },
            {
              symbol: 'ABC',
              period_end: '2026-03-31',
              metric_name: 'forward PE',
              value_num: 18,
              source_type: 'trusted_local_fundamentals_cache',
              metadata: {},
              created_at: '2026-05-01T00:00:00.000Z',
            },
          ],
        };
      }
      return { rows: [] };
    },
  };
  const result = await runValuationContextRequirementExecutor({
    valuationContextRotation: rotationRequirement('ABC'),
    valuationContextAutoLinker: linkerContext('ABC'),
    dbClient,
    localPriceContextRows: [],
    generatedAt: '2026-05-25T00:00:00.000Z',
  });

  assert.equal(result.valuationContextRowsCreated, 1);
  assert.equal(result.rows[0].sourceProvenance, 'trusted_local_fundamentals_cache');
  assert.equal(result.rows[0].revenueGrowth, 0.08);
  assert.equal(result.rows[0].backlog, 1200);
  assert.equal(result.rows[0].forwardPE, 18);
  assert.equal(result.rows[0].localPriceWindow.excessVsBenchmark90d, null);
  assert.equal(result.rows[0].valuationContextSourceStatus, 'valuation_context_partial');
  assert.equal(result.dbContextRead.companyFundamentalRowCount, 3);
});

test('valuation requirement executor rejects untrusted source-query valuation context', async () => {
  const result = await runValuationContextRequirementExecutor({
    valuationContextRotation: rotationRequirement('ABC'),
    valuationContextAutoLinker: linkerContext('ABC'),
    localPriceContextRows: [
      {
        issuer: 'ABC',
        sourceProvenance: 'source_query_market_snippet',
        asOfDate: '2026-05-24',
        localPriceWindow: { excessVsBenchmark90d: 0.01 },
      },
    ],
  });

  assert.equal(result.valuationContextRowsCreated, 0);
  assert.deepEqual(result.missingIssuerFundamentalsAfterExecution, ['ABC']);
  assert.equal(result.valuationRequirementTasks[0].status, 'valuation_context_source_unavailable');
  assert.equal(result.valuationRequirementTasks[0].failureReason, 'untrusted_price_context_source');
});

test('valuation requirement executor excludes seed tracks without accepted issuer bridge closure', async () => {
  const result = await runValuationContextRequirementExecutor({
    valuationContextRotation: rotationRequirement('ABC'),
    valuationContextAutoLinker: linkerContext('ABC', { gateEligible: false }),
    localPriceContextRows: [
      {
        issuer: 'ABC',
        sourceProvenance: 'trusted_local_market_cache',
        asOfDate: '2026-05-24',
        localPriceWindow: { excessVsBenchmark90d: 0.01 },
      },
    ],
  });

  assert.equal(result.taskCount, 0);
  assert.equal(result.valuationContextRowsCreated, 0);
  assert.equal(result.valuationContextSourceStatus, 'no_valuation_context_requirements');
});
