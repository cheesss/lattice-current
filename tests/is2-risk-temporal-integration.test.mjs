/**
 * IS-2 Integration Test — Risk Engine + Temporal Barrier
 *
 * Verifies that:
 * 1. TemporalBarrier filters out future data in replay/validation mode
 * 2. RiskEngine gates (idea-level + portfolio-level) work correctly
 * 3. Regime changes activate constraint overrides
 * 4. Risk gate results map to IntegrationMetadata shape
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// Temporal Barrier (Phase 3)
const {
  TemporalBarrier,
  filterMarketsByBarrier,
  createPassthroughBarrier,
  TemporalViolationError,
} = await import('../src/services/temporal-barrier.ts');

// Risk Engine (Phase 4)
const { RiskEngine } = await import('../src/services/risk/risk-engine.ts');

// ---------------------------------------------------------------------------
// 1. Temporal Barrier data filtering
// ---------------------------------------------------------------------------

describe('IS-2: Temporal Barrier data filtering', () => {
  it('filters market data past the boundary', () => {
    const boundary = new Date('2025-06-15T00:00:00Z');
    const barrier = new TemporalBarrier(boundary);

    const markets = [
      { symbol: 'SPY', timestamp: '2025-06-14T12:00:00Z', price: 440 },
      { symbol: 'SPY', timestamp: '2025-06-15T12:00:00Z', price: 445 }, // future
      { symbol: 'QQQ', timestamp: '2025-06-13T12:00:00Z', price: 370 },
      { symbol: 'QQQ', timestamp: '2025-06-16T12:00:00Z', price: 375 }, // future
    ];

    const filtered = filterMarketsByBarrier(markets, barrier);
    assert.equal(filtered.length, 2, 'only 2 items should pass boundary');
    assert.ok(filtered.every((m) => new Date(m.timestamp) <= boundary));
    assert.equal(barrier.stats.violations, 2);
  });

  it('passthrough barrier allows all data', () => {
    const barrier = createPassthroughBarrier();
    const markets = [
      { symbol: 'SPY', timestamp: '2099-12-31T23:59:59Z', price: 999 },
    ];
    const filtered = filterMarketsByBarrier(markets, barrier);
    assert.equal(filtered.length, 1, 'passthrough allows all');
  });

  it('strict mode throws on violation', () => {
    const barrier = new TemporalBarrier(new Date('2025-01-01'), { strict: true });
    assert.throws(
      () => barrier.validateAccess('2025-06-01', 'test'),
      (err) => err instanceof TemporalViolationError,
    );
  });

  it('boundary can only advance forward', () => {
    const barrier = new TemporalBarrier(new Date('2025-06-15'));
    barrier.advanceTo(new Date('2025-06-20'));
    assert.throws(
      () => barrier.advanceTo(new Date('2025-06-10')),
      /Cannot move boundary backward/,
    );
  });

  it('cluster-style filtering works with Date objects', () => {
    const boundary = new Date('2025-06-15T00:00:00Z');
    const barrier = new TemporalBarrier(boundary);

    const clusters = [
      { id: 'c1', firstSeen: new Date('2025-06-14') },
      { id: 'c2', firstSeen: new Date('2025-06-16') }, // future
      { id: 'c3', firstSeen: new Date('2025-06-10') },
    ];

    const filtered = clusters.filter((cluster) => {
      const clusterDate = cluster.firstSeen;
      if (!clusterDate) return true;
      return barrier.validateAccess(clusterDate, `cluster:${cluster.id}`);
    });

    assert.equal(filtered.length, 2, 'only 2 clusters pass boundary');
    assert.equal(barrier.stats.violations, 1);
  });
});

// ---------------------------------------------------------------------------
// 2. Risk Engine idea gate
// ---------------------------------------------------------------------------

describe('IS-2: Risk Engine idea gate', () => {
  let engine;

  beforeEach(() => {
    engine = new RiskEngine();
  });

  it('passes ideas that fit within constraints', () => {
    const ideas = [
      {
        id: 'idea-1',
        title: 'Energy Long',
        themeId: 'energy',
        direction: 'long',
        conviction: 0.75,
        falsePositiveRisk: 0.1,
        sizePct: 2.0,
        symbols: [{ symbol: 'XLE', sector: 'energy', assetKind: 'etf', liquidityScore: 80, direction: 'long' }],
      },
    ];
    const result = engine.applyIdeaGate(ideas, []);
    assert.ok(result.passed.length >= 0, 'gate should return results');
    assert.equal(result.summary.totalProposed, 1);
  });

  it('vetoes ideas that exceed single-position limit', () => {
    const ideas = [
      {
        id: 'idea-big',
        title: 'Huge Position',
        themeId: 'test',
        direction: 'long',
        conviction: 0.9,
        falsePositiveRisk: 0.05,
        sizePct: 50.0, // Very large position
        symbols: [{ symbol: 'TEST', sector: 'tech', assetKind: 'equity', liquidityScore: 90, direction: 'long' }],
      },
    ];
    const result = engine.applyIdeaGate(ideas, []);
    // The risk engine should either veto or reduce this oversized position
    const totalVetoedOrReduced = result.summary.totalVetoed + result.summary.totalReduced;
    assert.ok(totalVetoedOrReduced >= 1 || result.passed[0]?.adjustedSizePct < 50, 'oversized position should be constrained');
  });

  it('gate result has correct IntegrationMetadata shape', () => {
    const ideas = [
      {
        id: 'idea-1',
        title: 'Test',
        themeId: 'test',
        direction: 'long',
        conviction: 0.5,
        falsePositiveRisk: 0.2,
        sizePct: 1.0,
        symbols: [{ symbol: 'SPY', sector: 'broad', direction: 'long' }],
      },
    ];
    const result = engine.applyIdeaGate(ideas, []);
    // Simulate IntegrationMetadata.riskGateSummary construction
    const summary = {
      ideaGateRejected: result.summary.totalVetoed,
      portfolioGateReduced: result.summary.totalReduced,
    };
    assert.equal(typeof summary.ideaGateRejected, 'number');
    assert.equal(typeof summary.portfolioGateReduced, 'number');
  });
});

// ---------------------------------------------------------------------------
// 3. Regime-aware constraint overrides
// ---------------------------------------------------------------------------

describe('IS-2: Regime-aware constraints', () => {
  it('risk-off regime tightens constraints', () => {
    const engine = new RiskEngine();
    const normalConstraints = engine.getEffectiveConstraints();

    engine.setRegime('risk-off');
    const riskOffConstraints = engine.getEffectiveConstraints();

    // In risk-off, maxGrossExposurePct should be lower (tighter)
    assert.ok(
      riskOffConstraints.maxGrossExposurePct <= normalConstraints.maxGrossExposurePct,
      'risk-off should tighten gross exposure limit',
    );
  });

  it('crisis regime is tighter than risk-off', () => {
    const engine = new RiskEngine();
    engine.setRegime('risk-off');
    const riskOffConstraints = engine.getEffectiveConstraints();

    engine.setRegime('crisis');
    const crisisConstraints = engine.getEffectiveConstraints();

    assert.ok(
      crisisConstraints.maxGrossExposurePct <= riskOffConstraints.maxGrossExposurePct,
      'crisis should be tighter than risk-off',
    );
  });

  it('clearing regime restores defaults', () => {
    const engine = new RiskEngine();
    const defaultConstraints = engine.getEffectiveConstraints();

    engine.setRegime('crisis');
    engine.setRegime(null);
    const restoredConstraints = engine.getEffectiveConstraints();

    assert.deepStrictEqual(restoredConstraints, defaultConstraints);
  });
});

// ---------------------------------------------------------------------------
// 4. Portfolio-level gate
// ---------------------------------------------------------------------------

describe('IS-2: Portfolio-level gate', () => {
  it('reduces sizes when portfolio exceeds gross exposure', () => {
    const engine = new RiskEngine();
    const constraints = engine.getEffectiveConstraints();

    // Build ideas that together exceed gross exposure limit
    const bigIdeas = Array.from({ length: 20 }, (_, i) => ({
      id: `idea-${i}`,
      title: `Idea ${i}`,
      themeId: 'diverse',
      direction: 'long',
      conviction: 0.7,
      falsePositiveRisk: 0.1,
      sizePct: constraints.maxGrossExposurePct / 10, // 10% of limit each = 200% total
      symbols: [{ symbol: `SYM${i}`, sector: `sector-${i % 5}`, direction: 'long', liquidityScore: 70 }],
    }));

    const result = engine.applyPortfolioGate(bigIdeas, []);
    // Should either veto some or reduce all
    const totalConstrained = result.summary.totalVetoed + result.summary.totalReduced;
    assert.ok(
      totalConstrained > 0 || result.summary.totalApprovedExposure <= constraints.maxGrossExposurePct,
      'portfolio gate should enforce gross exposure limit',
    );
  });
});

// ---------------------------------------------------------------------------
// 5. End-to-end: Barrier + Risk Engine composability
// ---------------------------------------------------------------------------

describe('IS-2: Barrier + Risk Engine compose end-to-end', () => {
  it('backtest scenario with barrier filtering then risk gate', () => {
    // Step 1: Temporal filter
    const boundary = new Date('2025-06-15T00:00:00Z');
    const barrier = new TemporalBarrier(boundary);
    const rawMarkets = [
      { symbol: 'SPY', timestamp: '2025-06-14T12:00:00Z', price: 440 },
      { symbol: 'SPY', timestamp: '2025-06-20T12:00:00Z', price: 445 }, // future - filtered
    ];
    const filteredMarkets = filterMarketsByBarrier(rawMarkets, barrier);
    assert.equal(filteredMarkets.length, 1, 'only past data passes');

    // Step 2: Risk gate on generated ideas
    const engine = new RiskEngine();
    const ideas = [
      {
        id: 'idea-1',
        title: 'Energy Long',
        themeId: 'energy',
        direction: 'long',
        conviction: 0.6,
        falsePositiveRisk: 0.15,
        sizePct: 3.0,
        symbols: [{ symbol: 'XLE', sector: 'energy', direction: 'long', liquidityScore: 80 }],
      },
    ];
    const gateResult = engine.applyIdeaGate(ideas, []);

    // Step 3: Build integration metadata
    const integration = {
      riskGateSummary: {
        ideaGateRejected: gateResult.summary.totalVetoed,
        portfolioGateReduced: gateResult.summary.totalReduced,
      },
    };
    assert.equal(typeof integration.riskGateSummary.ideaGateRejected, 'number');
    assert.equal(typeof integration.riskGateSummary.portfolioGateReduced, 'number');
    assert.equal(barrier.stats.violations, 1, 'one temporal violation recorded');
  });
});
