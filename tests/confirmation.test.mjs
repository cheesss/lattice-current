import test from 'node:test';
import assert from 'node:assert/strict';

import {
  marketConfirmationScore,
  confirmationStateFromScore,
  scoreCurrentPerformanceInfluence,
  estimateRegimeConditionalHalfLife,
  buildSensitivityRows,
} from '../src/services/investment/idea-generation/confirmation.ts';

test('marketConfirmationScore respects directionality and falls back to neutral', () => {
  assert.equal(marketConfirmationScore('long', null), 50);
  assert.ok(marketConfirmationScore('long', 2.5) > 50);
  assert.ok(marketConfirmationScore('short', 2.5) < 50);
  assert.ok(marketConfirmationScore('hedge', -4) > 50);
});

test('confirmationStateFromScore uses the expected buckets', () => {
  assert.equal(confirmationStateFromScore(75), 'confirmed');
  assert.equal(confirmationStateFromScore(60), 'tentative');
  assert.equal(confirmationStateFromScore(40), 'fading');
  assert.equal(confirmationStateFromScore(20), 'contradicted');
});

test('scoreCurrentPerformanceInfluence returns zeros when current performance is absent', () => {
  const result = scoreCurrentPerformanceInfluence({
    context: 'live',
    referenceTimestamp: '2026-04-06T00:00:00.000Z',
    replayProfile: null,
    currentPerformance: null,
    coverage: { coveragePenalty: 0, completenessScore: 50, densityScore: 50 },
  });
  assert.deepEqual(result, {
    weight: 0,
    freshness: 0,
    sampleConfidence: 0,
    driftPenalty: 0,
    currentReturn: 0,
    currentHitRate: 50,
    currentConfirmationScore: 0,
  });
});

test('scoreCurrentPerformanceInfluence returns bounded finite values for active data', () => {
  const result = scoreCurrentPerformanceInfluence({
    context: 'validation',
    referenceTimestamp: '2026-04-06T00:00:00.000Z',
    replayProfile: {
      confirmationReliability: 74,
      currentVsReplayDrift: -0.4,
    },
    currentPerformance: {
      updatedAt: '2026-04-05T12:00:00.000Z',
      activeCount: 5,
      closedCount: 9,
      avgReturnPct: 1.2,
      hitRate: 63,
      confirmationScore: 68,
    },
    coverage: { coveragePenalty: 8, completenessScore: 82, densityScore: 76 },
  });
  assert.ok(result.weight > 0 && result.weight <= 1);
  assert.ok(result.freshness > 0 && result.freshness <= 1);
  assert.ok(result.sampleConfidence > 0 && result.sampleConfidence <= 1);
  assert.ok(result.driftPenalty >= 0);
});

test('estimateRegimeConditionalHalfLife returns a usable half-life estimate', () => {
  const result = estimateRegimeConditionalHalfLife({
    replayProfile: {
      preferredHorizonHours: 72,
      confirmationReliability: 70,
      currentVsReplayDrift: 0.1,
    },
    currentInfluence: {
      weight: 0.5,
      freshness: 0.9,
      sampleConfidence: 0.8,
      driftPenalty: 0.2,
      currentReturn: 1.4,
      currentHitRate: 61,
      currentConfirmationScore: 67,
    },
    coverage: { coveragePenalty: 10, completenessScore: 88, densityScore: 80 },
    marketConfirmation: 71,
  });
  assert.ok(result.persistenceRho >= 0.2 && result.persistenceRho <= 0.94);
  assert.ok(result.multiplier >= 0.24 && result.multiplier <= 1.12);
  assert.ok(result.estimatedHalfLifeHours >= 12);
});

test('buildSensitivityRows aggregates sector rows from mappings, tracked ideas, and backtests', () => {
  const rows = buildSensitivityRows(
    [
      {
        sector: 'energy',
        commodity: 'oil',
        direction: 'long',
        sensitivityScore: 78,
        conviction: 70,
        symbol: 'XLE',
        themeId: 'middle-east-energy-shock',
        eventTitle: 'oil disruption',
      },
      {
        sector: 'energy',
        commodity: 'oil',
        direction: 'short',
        sensitivityScore: 52,
        conviction: 48,
        symbol: 'CVX',
        themeId: 'middle-east-energy-shock',
        eventTitle: 'oil disruption',
      },
    ],
    [
      {
        id: 'bt1',
        themeId: 'middle-east-energy-shock',
        symbol: 'XLE',
        direction: 'long',
        sampleSize: 12,
        hitRate: 66,
        avgReturnPct: 1.5,
        avgBestReturnPct: 2.1,
        avgWorstReturnPct: -0.7,
        avgHoldingDays: 3,
        activeCount: 1,
        confidence: 70,
        notes: [],
      },
    ],
    [
      {
        trackingId: 'trk1',
        ideaKey: 'idea-1',
        title: 'energy setup',
        themeId: 'middle-east-energy-shock',
        direction: 'long',
        status: 'open',
        openedAt: '2026-04-01T00:00:00.000Z',
        lastMarkedAt: '2026-04-05T00:00:00.000Z',
        sizePct: 4,
        conviction: 70,
        falsePositiveRisk: 25,
        stopLossPct: 2,
        takeProfitPct: 4,
        maxHoldingDays: 7,
        daysHeld: 3,
        currentReturnPct: 1.8,
        realizedReturnPct: null,
        bestReturnPct: 2.2,
        worstReturnPct: -0.4,
        symbols: [{ symbol: 'XLE', direction: 'long', role: 'primary', name: 'Energy ETF' }],
        autonomyAction: 'watch',
        autonomyReasons: [],
      },
    ],
  );

  assert.equal(rows.length, 1);
  assert.equal(rows[0].sector, 'energy');
  assert.equal(rows[0].commodity, 'oil');
  assert.equal(rows[0].backtestWinRate, 66);
  assert.deepEqual(rows[0].symbols, ['XLE', 'CVX']);
});
