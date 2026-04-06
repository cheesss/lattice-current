import test from 'node:test';
import assert from 'node:assert/strict';

import { applyMetaTradeAdmission, getMetaWeightsLoadState } from '../src/services/investment/idea-generation/meta-admission.ts';
import { buildIdeaGenerationRuntimeContext } from '../src/services/investment/idea-generation/runtime-context.ts';

function baseCard(overrides = {}) {
  return {
    id: 'card-1',
    title: 'Energy disruption',
    themeId: 'middle-east-energy-shock',
    direction: 'long',
    conviction: 74,
    calibratedConfidence: 76,
    confirmationScore: 73,
    realityScore: 71,
    backtestHitRate: 63,
    backtestAvgReturnPct: 1.2,
    falsePositiveRisk: 22,
    coveragePenalty: 4,
    banditScore: 0.6,
    transferEntropy: 0.32,
    clusterConfidence: 82,
    marketStressPrior: 0.44,
    transmissionStress: 0.38,
    narrativeShadowPosterior: 64,
    narrativeShadowDisagreement: 8,
    narrativeAlignmentScore: 66,
    narrativeShadowTopThemeId: 'middle-east-energy-shock',
    narrativeShadowState: 'aligned',
    sizePct: 4,
    autonomyAction: 'deploy',
    autonomyReasons: [],
    symbols: [
      {
        symbol: 'XLE',
        name: 'Energy ETF',
        role: 'primary',
        direction: 'long',
      },
    ],
    ...overrides,
  };
}

function macroOverlay(overrides = {}) {
  return {
    state: 'balanced',
    killSwitch: false,
    riskGauge: 42,
    ...overrides,
  };
}

test('getMetaWeightsLoadState returns a stable status object', () => {
  const state = getMetaWeightsLoadState();
  assert.ok(['ready', 'missing', 'invalid', 'unsupported'].includes(state.status));
  assert.equal(typeof state.error === 'string' || state.error === null, true);
  assert.equal(typeof state.path === 'string' || state.path === null, true);
});

test('applyMetaTradeAdmission accepts high-quality cards', () => {
  const result = applyMetaTradeAdmission(
    baseCard(),
    macroOverlay(),
    null,
    buildIdeaGenerationRuntimeContext(),
  );
  assert.equal(result.admissionState, 'accepted');
  assert.ok(result.metaHitProbability >= 3 && result.metaHitProbability <= 97);
  assert.ok(result.sizePct > 0);
});

test('applyMetaTradeAdmission rejects weak cards and zeros size below the lowest conviction band', () => {
  const result = applyMetaTradeAdmission(
    baseCard({
      conviction: 8,
      calibratedConfidence: 8,
      confirmationScore: 9,
      realityScore: 7,
      falsePositiveRisk: 96,
      coveragePenalty: 60,
      banditScore: 0,
      transferEntropy: 0,
      clusterConfidence: 6,
      marketStressPrior: 0,
      transmissionStress: 0,
      narrativeShadowPosterior: 0,
      narrativeShadowDisagreement: 90,
      narrativeAlignmentScore: 10,
      sizePct: 4,
    }),
    macroOverlay({ state: 'risk-off', killSwitch: true, riskGauge: 100 }),
    null,
    buildIdeaGenerationRuntimeContext(),
  );
  assert.equal(result.admissionState, 'rejected');
  assert.equal(result.autonomyAction, 'abstain');
  assert.equal(result.sizePct, 0);
  assert.ok(result.metaHitProbability >= 3 && result.metaHitProbability <= 97);
});

test('applyMetaTradeAdmission blocks risk-off-only special symbols during risk-on regimes', () => {
  const result = applyMetaTradeAdmission(
    baseCard({
      themeId: 'safe-haven-repricing',
      symbols: [
        {
          symbol: '^VIX',
          name: 'VIX',
          role: 'primary',
          direction: 'long',
        },
      ],
    }),
    macroOverlay({ state: 'risk-on', killSwitch: false, riskGauge: 20 }),
    null,
    buildIdeaGenerationRuntimeContext(),
  );
  assert.equal(result.admissionState, 'rejected');
  assert.equal(result.autonomyAction, 'abstain');
});
