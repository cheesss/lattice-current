import test from 'node:test';
import assert from 'node:assert/strict';

import {
  parseReportHistory,
  buildEventCandidates,
  buildBanditContext,
  buildEventIntensitySeries,
  buildMarketSignalSeries,
  buildTimedEventFlowSeries,
  buildTimedMarketFlowSeries,
} from '../src/services/investment/idea-generation/event-candidates.ts';
import * as S from '../src/services/investment/module-state.ts';

test('parseReportHistory extracts themes, symbols, and directional summary', () => {
  const entries = parseReportHistory([
    {
      id: 'r1',
      variant: 'full',
      trigger: 'manual',
      generatedAt: '2026-04-06T00:00:00.000Z',
      title: 'Daily signal brief',
      summary: 'Dominant themes: middle-east-energy-shock, defense-escalation. XLE +2.3% and ITA -1.5%.',
      themes: [],
      sourceCount: 5,
      newsCount: 10,
      clusterCount: 4,
      marketCount: 8,
      consensusMode: 'multi-agent',
      rebuttalSummary: '',
    },
  ]);

  assert.equal(entries.length, 1);
  assert.deepEqual(entries[0].themes, ['middle-east-energy-shock', 'defense-escalation']);
  assert.deepEqual(entries[0].symbols, ['XLE', 'ITA']);
  assert.equal(entries[0].direction, 'long');
});

test('buildBanditContext emits an 8-feature normalized vector', () => {
  const vector = buildBanditContext({
    credibility: 70,
    corroboration: 80,
    marketStress: 0.4,
    aftershockIntensity: 0.2,
    regimeMultiplier: 1.1,
    transferEntropy: 0.3,
    posteriorWinRate: 62,
    emaReturnPct: 1.4,
  });

  assert.equal(vector.length, 8);
  assert.ok(vector.every((value) => Number.isFinite(value)));
});

test('history-derived series builders read module-state buffers without throwing', () => {
  const originalHistory = S.currentHistory;
  const originalMarketHistory = S.marketHistory;
  try {
    S.setCurrentHistory([
      {
        id: 'h1',
        timestamp: '2026-04-05T00:00:00.000Z',
        label: 'energy move',
        themes: ['middle-east-energy-shock'],
        regions: ['Middle East'],
        symbols: ['XLE'],
        avgMovePct: 1.1,
        bestMovePct: 2.4,
        conviction: 74,
        falsePositiveRisk: 18,
        direction: 'long',
        summary: 'oil shock',
      },
    ]);
    S.setMarketHistory([
      {
        symbol: 'XLE',
        timestamp: '2026-04-05T00:00:00.000Z',
        price: 91,
        change: 1.9,
      },
    ]);

    assert.deepEqual(buildEventIntensitySeries('middle-east-energy-shock', 'Middle East').length, 1);
    assert.deepEqual(buildMarketSignalSeries('XLE'), [1.9]);
    assert.equal(buildTimedEventFlowSeries('middle-east-energy-shock', 'Middle East').length, 1);
    assert.equal(buildTimedMarketFlowSeries('XLE').length, 1);
  } finally {
    S.setCurrentHistory(originalHistory);
    S.setMarketHistory(originalMarketHistory);
  }
});

test('buildEventCandidates keeps a corroborated live event and carries transmission fields', () => {
  const result = buildEventCandidates({
    clusters: [
      {
        id: 'cluster-1',
        primaryTitle: 'Missile strike disrupts Gulf shipping lanes',
        primarySource: 'Reuters',
        sourceCount: 3,
        isAlert: true,
        relations: {
          confidenceScore: 82,
          evidence: ['shipping', 'missile', 'gulf'],
        },
        allItems: [
          { title: 'Missile strike disrupts Gulf shipping lanes', source: 'Reuters' },
          { title: 'Attack hits shipping routes', source: 'AP' },
        ],
        topSources: [{ name: 'Reuters' }, { name: 'AP' }],
        lastUpdated: '2026-04-06T00:00:00.000Z',
        threat: { level: 'high' },
      },
    ],
    transmission: {
      edges: [
        {
          eventTitle: 'Missile strike disrupts Gulf shipping lanes',
          marketSymbol: 'XLE',
          reason: 'oil supply shock',
          strength: 71,
          informationFlowScore: 0.66,
          leadLagScore: 0.58,
        },
      ],
      regime: { id: 'risk-off', label: 'risk-off', confidence: 72 },
    },
    sourceCredibility: [
      {
        source: 'Reuters',
        credibilityScore: 76,
        corroborationScore: 74,
        feedHealthScore: 80,
        truthAgreementScore: 78,
      },
    ],
  });

  assert.equal(result.falsePositive.kept, 1);
  assert.equal(result.kept[0].matchedSymbols[0], 'XLE');
  assert.ok(result.kept[0].marketStress > 0);
  assert.ok(result.kept[0].clusterConfidence >= 80);
});
