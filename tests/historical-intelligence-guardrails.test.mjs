import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  __historicalReplayTestUtils,
} from '../src/services/historical-intelligence.ts';

function makeFrame(overrides = {}) {
  const timestamp = overrides.timestamp || '2025-01-01T00:00:00.000Z';
  return {
    id: overrides.id || `frame:${timestamp}`,
    timestamp,
    validTimeStart: overrides.validTimeStart || timestamp,
    validTimeEnd: overrides.validTimeEnd ?? null,
    transactionTime: overrides.transactionTime || timestamp,
    knowledgeBoundary: overrides.knowledgeBoundary || overrides.transactionTime || timestamp,
    news: overrides.news || [],
    clusters: overrides.clusters || [],
    markets: overrides.markets || [],
    metadata: overrides.metadata || {},
    datasetId: overrides.datasetId,
    sourceVersion: overrides.sourceVersion,
  };
}

describe('historical intelligence guardrails', () => {
  it('rejects frames whose transaction time is after knowledge boundary', () => {
    assert.throws(() => {
      __historicalReplayTestUtils.normalizeFrames([
        makeFrame({
          id: 'bad-order',
          timestamp: '2025-01-01T00:00:00.000Z',
          validTimeStart: '2025-01-01T00:00:00.000Z',
          transactionTime: '2025-01-02T00:00:00.000Z',
          knowledgeBoundary: '2025-01-01T12:00:00.000Z',
        }),
      ]);
    }, /transactionTime > knowledgeBoundary/);
  });

  it('does not silently merge frames with same timestamp but different transaction times', () => {
    const normalized = __historicalReplayTestUtils.normalizeFrames([
      makeFrame({
        id: 'frame-a',
        timestamp: '2025-01-01T00:00:00.000Z',
        transactionTime: '2025-01-01T00:00:00.000Z',
        knowledgeBoundary: '2025-01-01T00:00:00.000Z',
        datasetId: 'alpha',
      }),
      makeFrame({
        id: 'frame-b',
        timestamp: '2025-01-01T00:00:00.000Z',
        transactionTime: '2025-01-01T06:00:00.000Z',
        knowledgeBoundary: '2025-01-01T06:00:00.000Z',
        datasetId: 'beta',
      }),
    ]);

    assert.equal(normalized.length, 2);
    assert.deepEqual(
      normalized.map((frame) => frame.datasetId),
      ['alpha', 'beta'],
    );
  });

  it('builds statistical confidence intervals when enough replay samples exist', () => {
    const forwardReturns = Array.from({ length: 20 }, (_, index) => ({
      id: `return-${index}`,
      runId: 'run-1',
      ideaRunId: `idea-${index}`,
      symbol: 'SPY',
      direction: 'long',
      horizonHours: 24,
      entryTimestamp: `2025-01-${String((index % 9) + 1).padStart(2, '0')}T00:00:00.000Z`,
      exitTimestamp: `2025-01-${String((index % 9) + 2).padStart(2, '0')}T00:00:00.000Z`,
      entryPrice: 100,
      exitPrice: 101,
      rawReturnPct: 1,
      signedReturnPct: index % 5 === 0 ? -0.4 : 1.2,
      costAdjustedSignedReturnPct: index % 6 === 0 ? -0.6 : 0.9,
      maxDrawdownPct: -0.8,
      riskAdjustedReturn: 0.8,
      bestReturnPct: 1.5,
      priceGapPct: 0.2,
      maxHoldingHours: 24,
      exitReason: 'target-horizon',
      executionPenaltyPct: 0.1,
      realityScore: 70,
      sessionState: 'open',
      tradableNow: true,
      spreadBps: 2,
      slippageBps: 3,
      liquidityPenaltyPct: 0.05,
      realityNotes: [],
    }));
    const portfolioAccounting = {
      equityCurve: Array.from({ length: 20 }, (_, index) => ({
        timestamp: `2025-01-${String(index + 1).padStart(2, '0')}T23:59:59.999Z`,
        nav: 100 + index,
        cash: 100,
        cashPct: 100,
        grossExposurePct: 0,
        netExposurePct: 0,
        openPositionCount: 0,
        activeIdeaCount: 0,
        realizedReturnPct: index % 3 === 0 ? -0.1 : 0.3,
        unrealizedReturnPct: 0,
      })),
    };

    const summary = __historicalReplayTestUtils.buildReplayStatisticalSummary(
      forwardReturns,
      portfolioAccounting,
    );

    assert.ok(summary.costAdjustedAvgReturnPctCi95);
    assert.ok(summary.costAdjustedHitRateCi95);
    assert.ok(summary.rawAvgReturnPctCi95);
    assert.ok(summary.sharpeRatioCi95);
    assert.ok(summary.costAdjustedAvgReturnPctCi95.upper >= summary.costAdjustedAvgReturnPctCi95.lower);
  });

  it('builds expanding walk-forward fold plans with isolated evaluation slices', () => {
    const frames = Array.from({ length: 60 }, (_, index) => {
      const ts = new Date(Date.UTC(2020, index, 1)).toISOString();
      return makeFrame({
        id: `frame-${index + 1}`,
        timestamp: ts,
        transactionTime: ts,
        knowledgeBoundary: ts,
      });
    });

    const normalized = __historicalReplayTestUtils.normalizeFrames(frames);
    const windows = __historicalReplayTestUtils.splitWalkForwardWindows(normalized, 0.6, 0.2, 3);
    const plans = __historicalReplayTestUtils.buildWalkForwardFoldPlans(normalized, windows);

    assert.equal(plans.length >= 2, true);
    assert.equal(plans[0].fold, 1);
    assert.equal(plans[1].fold, 2);
    assert.equal(plans[1].trainFrames.length > plans[0].trainFrames.length, true);
    assert.equal(plans[0].evaluationWindows.every((window) => window.phase !== 'train'), true);
    assert.equal(plans[0].evaluationFrames.length, plans[0].evaluationWindows.reduce((sum, window) => sum + window.frameCount, 0));
    assert.equal(plans[0].evaluationFrames[0].timestamp, plans[0].evaluationWindows[0].from);
    assert.equal(
      Date.parse(plans[0].evaluationFrames[plans[0].evaluationFrames.length - 1].timestamp)
      < Date.parse(plans[1].evaluationFrames[0].timestamp),
      true,
    );
  });

  it('reserves a locked OOS holdout without leaking it into tuning frames', () => {
    const frames = Array.from({ length: 60 }, (_, index) => {
      const ts = new Date(Date.UTC(2021, index, 1)).toISOString();
      return makeFrame({
        id: `holdout-${index + 1}`,
        timestamp: ts,
        transactionTime: ts,
        knowledgeBoundary: ts,
      });
    });

    const normalized = __historicalReplayTestUtils.normalizeFrames(frames);
    const { tuningFrames, holdoutFrames } = __historicalReplayTestUtils.partitionWalkForwardFramesForHoldout(
      normalized,
      0.2,
      12,
    );

    assert.equal(tuningFrames.length, 48);
    assert.equal(holdoutFrames.length, 12);
    assert.equal(
      Date.parse(tuningFrames[tuningFrames.length - 1].timestamp) < Date.parse(holdoutFrames[0].timestamp),
      true,
    );
    assert.equal(holdoutFrames[0].id, 'holdout-49');
  });

  it('builds governance metrics from fold outcomes and locked OOS summary', () => {
    const governance = __historicalReplayTestUtils.buildReplayGovernanceSummary({
      evaluationRuns: [
        {
          frameCount: 20,
          evaluationFrameCount: 20,
          portfolioAccounting: { summary: { totalReturnPct: 4.2, sharpeRatio: 0.8, maxDrawdownPct: -3.1 }, equityCurve: [] },
        },
        {
          frameCount: 18,
          evaluationFrameCount: 18,
          portfolioAccounting: { summary: { totalReturnPct: 2.1, sharpeRatio: 0.5, maxDrawdownPct: -2.2 }, equityCurve: [] },
        },
        {
          frameCount: 22,
          evaluationFrameCount: 22,
          portfolioAccounting: { summary: { totalReturnPct: 3.4, sharpeRatio: 0.7, maxDrawdownPct: -2.8 }, equityCurve: [] },
        },
      ],
      portfolioAccounting: {
        summary: { sharpeRatio: 0.72 },
        equityCurve: [
          { realizedReturnPct: 0.6, timestamp: '2025-01-01T00:00:00.000Z' },
          { realizedReturnPct: -0.2, timestamp: '2025-01-02T00:00:00.000Z' },
          { realizedReturnPct: 0.5, timestamp: '2025-01-03T00:00:00.000Z' },
          { realizedReturnPct: 0.4, timestamp: '2025-01-04T00:00:00.000Z' },
          { realizedReturnPct: -0.1, timestamp: '2025-01-05T00:00:00.000Z' },
          { realizedReturnPct: 0.3, timestamp: '2025-01-06T00:00:00.000Z' },
          { realizedReturnPct: 0.2, timestamp: '2025-01-07T00:00:00.000Z' },
          { realizedReturnPct: 0.1, timestamp: '2025-01-08T00:00:00.000Z' },
        ],
      },
      lockedOosSummary: {
        frameCount: 12,
        ideaRunCount: 4,
        forwardReturnCount: 16,
        realitySummary: {
          primaryHorizonHours: 24,
          rawHitRate: 55,
          costAdjustedHitRate: 54,
          rawAvgReturnPct: 0.5,
          costAdjustedAvgReturnPct: 0.4,
          avgExecutionPenaltyPct: 0.1,
          avgRealityScore: 73,
          nonTradableRate: 4,
        },
        portfolioAccounting: {
          summary: { totalReturnPct: 2.2, sharpeRatio: 0.6, maxDrawdownPct: -2.5 },
          equityCurve: [],
        },
        summaryLines: [],
      },
    });

    assert.ok(governance.cpcv);
    assert.ok(governance.dsr);
    assert.ok(governance.pbo);
    assert.equal(typeof governance.promotion.state, 'string');
    assert.equal(governance.cpcv.pathCount >= 1, true);
  });
});
