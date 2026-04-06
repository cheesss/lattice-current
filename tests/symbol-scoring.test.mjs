import test from 'node:test';
import assert from 'node:assert/strict';

import {
  rankIdeaSymbolRole,
  scoreIdeaSymbolChoice,
  dedupeIdeaSymbols,
  liquidityBaseline,
  macroPenaltyForAsset,
  executionReadinessScore,
} from '../src/services/investment/idea-generation/symbol-scoring.ts';

test('rankIdeaSymbolRole orders primary above confirm above hedge', () => {
  assert.equal(rankIdeaSymbolRole('primary'), 3);
  assert.equal(rankIdeaSymbolRole('confirm'), 2);
  assert.equal(rankIdeaSymbolRole('hedge'), 1);
});

test('scoreIdeaSymbolChoice prefers stronger role and scores', () => {
  const primary = scoreIdeaSymbolChoice({
    symbol: 'XOM',
    name: 'Exxon',
    role: 'primary',
    direction: 'long',
    realityScore: 70,
    liquidityScore: 80,
    banditScore: 0.4,
  });
  const hedge = scoreIdeaSymbolChoice({
    symbol: 'XOM',
    name: 'Exxon',
    role: 'hedge',
    direction: 'long',
    realityScore: 90,
    liquidityScore: 90,
    banditScore: 0.9,
  });
  assert.ok(primary > hedge);
});

test('dedupeIdeaSymbols keeps the best symbol-direction candidate and sorts by role', () => {
  const deduped = dedupeIdeaSymbols([
    {
      symbol: 'XOM',
      name: 'Exxon A',
      role: 'confirm',
      direction: 'long',
      realityScore: 40,
      liquidityScore: 30,
      banditScore: 0.2,
    },
    {
      symbol: 'XOM',
      name: 'Exxon B',
      role: 'primary',
      direction: 'long',
      realityScore: 60,
      liquidityScore: 60,
      banditScore: 0.8,
    },
    {
      symbol: 'CVX',
      name: 'Chevron',
      role: 'hedge',
      direction: 'hedge',
      realityScore: 65,
      liquidityScore: 55,
      banditScore: 0.3,
    },
  ]);

  assert.equal(deduped.length, 2);
  assert.equal(deduped[0].symbol, 'XOM');
  assert.equal(deduped[0].role, 'primary');
});

test('liquidityBaseline returns durable per-asset defaults', () => {
  assert.equal(liquidityBaseline('etf'), 72);
  assert.equal(liquidityBaseline('equity'), 64);
  assert.equal(liquidityBaseline('fx'), 74);
  assert.equal(liquidityBaseline('crypto'), 56);
});

test('macroPenaltyForAsset penalizes risk assets and exempts hedges under kill switch', () => {
  const longEquity = {
    assetKind: 'equity',
    direction: 'long',
  };
  const hedgeAsset = {
    assetKind: 'etf',
    direction: 'hedge',
  };
  const overlay = {
    killSwitch: true,
    state: 'risk-off',
  };
  assert.equal(macroPenaltyForAsset(longEquity, overlay), 26);
  assert.equal(macroPenaltyForAsset(hedgeAsset, overlay), 0);
});

test('executionReadinessScore stays bounded and rewards tradable liquid assets', () => {
  const openScore = executionReadinessScore({
    assetKind: 'equity',
    tradableNow: true,
    sessionState: 'open',
    liquidityScore: 85,
    executionPenaltyPct: 0.1,
  });
  const closedScore = executionReadinessScore({
    assetKind: 'equity',
    tradableNow: false,
    sessionState: 'closed',
    liquidityScore: 35,
    executionPenaltyPct: 2.5,
  });

  assert.ok(openScore <= 100 && openScore >= 0);
  assert.ok(closedScore <= 100 && closedScore >= 0);
  assert.ok(openScore > closedScore);
});
