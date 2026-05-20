import assert from 'node:assert/strict';
import test from 'node:test';

import { themeContextToBundleAdditions } from '../scripts/_shared/report-theme-context.mjs';

test('theme context market reactions preserve benchmark and regime controls', () => {
  const additions = themeContextToBundleAdditions({
    subtopics: [],
    peerSymbols: {
      all: [{ symbol: 'AMD' }],
      positive: [{
        symbol: 'AMD',
        horizon: '1m',
        avg_return: 42,
        baseline_return: 8,
        sensitivity_zscore: 2.2,
        sample_size: 120,
        hit_rate: 0.62,
        theme: 'ai-ml',
      }],
      negative: [],
      neutral: [],
    },
    regimeImpacts: {
      grouped: [{
        symbol: 'AMD',
        regimeCount: 2,
        regimes: [
          { regime: 'risk_on', horizon: '1m', regime_multiplier: 1.3, sample_size: 60 },
          { regime: 'rate_shock', horizon: '1m', regime_multiplier: 0.8, sample_size: 40 },
        ],
      }],
    },
    knowledge: { connections: [] },
    events: [],
    hawkes: [],
  }, 'ai-ml');

  assert.equal(additions.marketReactions.length, 1);
  const reaction = additions.marketReactions[0];
  assert.equal(reaction.benchmark, 'baseline_return');
  assert.deepEqual(
    reaction.controls,
    ['benchmark=baseline_return', 'sample_size=120', 'hit_rate=0.62', 'regime_count=2', 'regime_labels=risk_on|rate_shock'],
  );
  assert.equal(reaction.metadata.regimeControls.symbol, 'AMD');
});

test('theme context promotes matched-control event uplifts as controlled market reactions', () => {
  const additions = themeContextToBundleAdditions({
    controlledUplifts: [{
      symbol: 'LMT',
      horizon: '1w',
      event_count: 3,
      n_controls: 90,
      avg_uplift: 2.4,
      avg_event_alpha: 3.1,
      representative_t_stat: 2.3,
      top_evidence_grade: 'E3',
      latest_event_date: '2026-05-01',
    }],
    subtopics: [],
    peerSymbols: { all: [], positive: [], negative: [], neutral: [] },
    regimeImpacts: { grouped: [] },
    knowledge: { connections: [] },
    events: [],
    hawkes: [],
  }, 'defense-industrial');

  assert.equal(additions.marketReactions.length, 1);
  assert.equal(additions.marketReactions[0].reactionId, 'MRKT-CONTROLLED-LMT-1w');
  assert.equal(additions.marketReactions[0].benchmark, 'matched_controls');
  assert.equal(additions.marketReactions[0].validationStatus, 'validated');
  assert.deepEqual(additions.marketReactions[0].controls, [
    'benchmark=matched_controls',
    'factor=macro_regime_matched_controls',
    'n_controls=90',
    'event_count=3',
    'evidence_grade=E3',
  ]);
  assert.equal(additions.metrics[0].metricId, 'MET-CONTROLLED-EVENT-UPLIFT-COUNT');
});
