import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { computePortfolioAccountingSnapshot } from '../src/services/portfolio-accounting.ts';

function makeFrame(timestamp, prices) {
  return {
    timestamp,
    validTimeStart: timestamp,
    transactionTime: timestamp,
    knowledgeBoundary: timestamp,
    metadata: {},
    markets: Object.entries(prices).map(([symbol, price]) => ({ symbol, price })),
  };
}

function makeIdeaRun(id, themeId, symbol, sizePct) {
  return {
    id,
    themeId,
    generatedAt: '2025-01-01T00:00:00.000Z',
    sizePct,
    symbols: [
      {
        symbol,
        role: 'primary',
        direction: 'long',
      },
    ],
  };
}

function makeForwardReturn(ideaRunId, symbol) {
  return {
    ideaRunId,
    symbol,
    horizonHours: 24,
    entryTimestamp: '2025-01-01T00:00:00.000Z',
    exitTimestamp: '2025-01-02T00:00:00.000Z',
    entryPrice: 100,
    exitPrice: 101,
    signedReturnPct: 1,
    costAdjustedSignedReturnPct: 0.8,
    direction: 'long',
    tradableNow: true,
  };
}

describe('portfolio accounting risk guards', () => {
  it('enforces theme, symbol, gross, and cash guardrails on executed trades', () => {
    const snapshot = computePortfolioAccountingSnapshot({
      frames: [
        makeFrame('2025-01-01T00:00:00.000Z', { AAA: 100, BBB: 100, CCC: 100, DDD: 100 }),
        makeFrame('2025-01-02T00:00:00.000Z', { AAA: 101, BBB: 101, CCC: 101, DDD: 101 }),
      ],
      ideaRuns: [
        makeIdeaRun('idea-a', 'theme-1', 'AAA', 12),
        makeIdeaRun('idea-b', 'theme-1', 'BBB', 12),
        makeIdeaRun('idea-c', 'theme-2', 'AAA', 12),
        makeIdeaRun('idea-d', 'theme-3', 'CCC', 12),
        makeIdeaRun('idea-e', 'theme-4', 'DDD', 12),
      ],
      forwardReturns: [
        makeForwardReturn('idea-a', 'AAA'),
        makeForwardReturn('idea-b', 'BBB'),
        makeForwardReturn('idea-c', 'AAA'),
        makeForwardReturn('idea-d', 'CCC'),
        makeForwardReturn('idea-e', 'DDD'),
      ],
      initialCapital: 100,
      riskControls: {
        grossExposureCapPct: 30,
        minCashReservePct: 50,
        maxSymbolExposurePct: 15,
        maxThemeExposurePct: 20,
      },
    });

    assert.equal(snapshot.summary.tradeCount, 4);
    assert.equal(snapshot.summary.plannedTradeCount, 5);
    assert.equal(snapshot.summary.selectedTradeCount, 5);
    assert.equal(snapshot.summary.riskGuardTriggerCount, 4);
    assert.deepEqual(
      snapshot.trades.map((trade) => [trade.symbol, trade.weightPct]),
      [
        ['AAA', 12],
        ['BBB', 8],
        ['AAA', 3],
        ['CCC', 7],
      ],
    );
    assert.equal(snapshot.trades.some((trade) => trade.symbol === 'DDD'), false);
    assert.equal(snapshot.summary.maxGrossExposurePct <= 30, true);
  });

  it('triggers drawdown governor and records tail-risk metrics', () => {
    const snapshot = computePortfolioAccountingSnapshot({
      frames: [
        makeFrame('2025-01-01T00:00:00.000Z', { AAA: 100 }),
        makeFrame('2025-01-02T00:00:00.000Z', { AAA: 85 }),
        makeFrame('2025-01-03T00:00:00.000Z', { AAA: 84 }),
      ],
      ideaRuns: [
        makeIdeaRun('idea-a', 'theme-1', 'AAA', 30),
      ],
      forwardReturns: [
        {
          ...makeForwardReturn('idea-a', 'AAA'),
          exitTimestamp: '2025-01-03T00:00:00.000Z',
          exitPrice: 84,
          signedReturnPct: -16,
          costAdjustedSignedReturnPct: -16.2,
        },
      ],
      initialCapital: 100,
      riskControls: {
        grossExposureCapPct: 100,
        minCashReservePct: 0,
        maxSymbolExposurePct: 100,
        maxThemeExposurePct: 100,
        maxDailyVar95Pct: 100,
        maxDailyCvar95Pct: 100,
        drawdownGovernorPct: 4,
        drawdownCooldownDays: 2,
        targetPositionVolatilityPct: 2,
      },
    });

    assert.equal(snapshot.summary.drawdownGovernorTriggerCount, 1);
    assert.equal(snapshot.summary.forcedExitCount, 1);
    assert.equal(snapshot.summary.dailyVar95Pct > 0, true);
    assert.equal(snapshot.summary.dailyCvar95Pct >= snapshot.summary.dailyVar95Pct, true);
    assert.equal(snapshot.summary.worstPeriodReturnPct < 0, true);
  });
});
