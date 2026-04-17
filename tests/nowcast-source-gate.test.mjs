import test from 'node:test';
import assert from 'node:assert/strict';

import {
  evaluateGate,
  checkEligibleSources,
  detectRegime,
  DEFAULT_MIN_ELIGIBLE_SOURCES,
} from '../scripts/_shared/nowcast-source-gate.mjs';

// ──────────────────────────────────────────────────────────────────────
// evaluateGate() — pure function coverage
// ──────────────────────────────────────────────────────────────────────

test('evaluateGate abstains when no rules provided', () => {
  const result = evaluateGate({
    rules: [],
    regime: 'normal',
    availableSources: [{ name: 'HYG' }, { name: 'vix' }],
  });
  assert.equal(result.abstain, true);
  assert.match(result.reason, /no eligibility rules/);
});

test('evaluateGate accepts eligible sources when >= minEligible', () => {
  const rules = [
    { source_signal: 'HYG', max_lag_hours: 1, holdout_mae_max: 0.2, drift_threshold: 0.25 },
    { source_signal: 'vix', max_lag_hours: 2, holdout_mae_max: 0.2, drift_threshold: 0.25 },
  ];
  const result = evaluateGate({
    rules,
    regime: 'normal',
    availableSources: [
      { name: 'HYG', lagHours: 0.5 },
      { name: 'vix', lagHours: 0.1 },
    ],
  });
  assert.equal(result.abstain, false);
  assert.deepEqual(result.eligible, ['HYG', 'vix']);
  assert.equal(result.rejected.length, 0);
});

test('evaluateGate rejects stale source by max_lag_hours', () => {
  const rules = [
    { source_signal: 'HYG', max_lag_hours: 1, holdout_mae_max: 0.2 },
    { source_signal: 'vix', max_lag_hours: 2, holdout_mae_max: 0.2 },
  ];
  const result = evaluateGate({
    rules,
    regime: 'normal',
    availableSources: [
      { name: 'HYG', lagHours: 5 }, // exceeds 1h cap
      { name: 'vix', lagHours: 0.5 },
    ],
  });
  assert.equal(result.eligible.length, 1);
  assert.equal(result.abstain, true); // < DEFAULT_MIN_ELIGIBLE_SOURCES
  assert.match(result.reason, /eligible sources=1/);
  assert.equal(result.rejected[0].source, 'HYG');
  assert.match(result.rejected[0].reason, /lag 5h > 1h/);
});

test('evaluateGate respects regime mask in shock', () => {
  const rules = [
    { source_signal: 'HYG', max_lag_hours: 1, holdout_mae_max: 0.2, regime_mask: { normal: true, shock: false } },
    { source_signal: 'vix', max_lag_hours: 1, holdout_mae_max: 0.2, regime_mask: { normal: true, shock: true } },
  ];
  const shock = evaluateGate({
    rules,
    regime: 'shock',
    availableSources: [{ name: 'HYG', lagHours: 0 }, { name: 'vix', lagHours: 0 }],
  });
  assert.equal(shock.eligible.length, 1);
  assert.equal(shock.abstain, true);
  assert.match(shock.rejected[0].reason, /regime=shock disabled/);

  const normal = evaluateGate({
    rules,
    regime: 'normal',
    availableSources: [{ name: 'HYG', lagHours: 0 }, { name: 'vix', lagHours: 0 }],
  });
  assert.equal(normal.abstain, false);
  assert.equal(normal.eligible.length, 2);
});

test('evaluateGate abstains when drift exceeds threshold', () => {
  const rules = [
    { source_signal: 'HYG', max_lag_hours: 1, holdout_mae_max: 0.2, drift_threshold: 0.25 },
    { source_signal: 'vix', max_lag_hours: 2, holdout_mae_max: 0.2, drift_threshold: 0.25 },
  ];
  const result = evaluateGate({
    rules,
    regime: 'normal',
    availableSources: [{ name: 'HYG', lagHours: 0 }, { name: 'vix', lagHours: 0 }],
    recentMae: 0.40, // > 0.2 * 1.25 = 0.25
  });
  assert.equal(result.abstain, true);
  assert.match(result.reason, /drift threshold/);
});

test('evaluateGate does not abstain when drift is within tolerance', () => {
  const rules = [
    { source_signal: 'HYG', max_lag_hours: 1, holdout_mae_max: 0.2, drift_threshold: 0.25 },
    { source_signal: 'vix', max_lag_hours: 2, holdout_mae_max: 0.2, drift_threshold: 0.25 },
  ];
  const result = evaluateGate({
    rules,
    regime: 'normal',
    availableSources: [{ name: 'HYG', lagHours: 0 }, { name: 'vix', lagHours: 0 }],
    recentMae: 0.15,
  });
  assert.equal(result.abstain, false);
});

test('evaluateGate ignores unmapped sources', () => {
  const rules = [
    { source_signal: 'HYG', max_lag_hours: 1, holdout_mae_max: 0.2 },
    { source_signal: 'vix', max_lag_hours: 2, holdout_mae_max: 0.2 },
  ];
  const result = evaluateGate({
    rules,
    regime: 'normal',
    availableSources: [
      { name: 'HYG', lagHours: 0 },
      { name: 'vix', lagHours: 0 },
      { name: 'random-unknown', lagHours: 0 },
    ],
  });
  assert.equal(result.abstain, false);
  assert.equal(result.eligible.length, 2);
  const unknown = result.rejected.find((r) => r.source === 'random-unknown');
  assert.equal(unknown.reason, 'no rule');
});

// ──────────────────────────────────────────────────────────────────────
// checkEligibleSources() — DB wrapper with fake client
// ──────────────────────────────────────────────────────────────────────

function fakeClient({ gateTableExists = true, rules = [], vixValue = 18, recentMae = null } = {}) {
  return {
    async query(sql, params) {
      const s = String(sql);
      if (s.includes("to_regclass('nowcast_source_eligibility')")) {
        return { rows: [{ t: gateTableExists ? 'nowcast_source_eligibility' : null }] };
      }
      if (s.includes('FROM nowcast_source_eligibility')) {
        return { rows: rules };
      }
      if (s.includes("signal_name = 'vix'") && s.includes('signal_history')) {
        return { rows: [{ value: vixValue }] };
      }
      if (s.includes('FROM nowcast_reconciliation')) {
        return { rows: [{ mae: recentMae }] };
      }
      return { rows: [] };
    },
  };
}

test('checkEligibleSources returns open-mode when gate table missing', async () => {
  const client = fakeClient({ gateTableExists: false });
  const result = await checkEligibleSources(client, {
    targetSignal: 'hy_credit_spread',
    availableSources: [{ name: 'HYG' }, { name: 'vix' }],
  });
  assert.equal(result.abstain, false);
  assert.equal(result.regime, 'unknown');
  assert.deepEqual(result.eligible, ['HYG', 'vix']);
});

test('checkEligibleSources detects shock regime when VIX > 30', async () => {
  const client = fakeClient({
    rules: [
      { source_signal: 'HYG', max_lag_hours: 1, holdout_mae_max: 0.2, regime_mask: { normal: true, shock: false }, enabled: true },
      { source_signal: 'vix', max_lag_hours: 1, holdout_mae_max: 0.2, regime_mask: { normal: true, shock: false }, enabled: true },
    ],
    vixValue: 34,
  });
  const result = await checkEligibleSources(client, {
    targetSignal: 'hy_credit_spread',
    availableSources: [{ name: 'HYG', lagHours: 0 }, { name: 'vix', lagHours: 0 }],
  });
  assert.equal(result.regime, 'shock');
  assert.equal(result.abstain, true);
});

test('detectRegime returns normal when no VIX row present', async () => {
  const client = { async query() { return { rows: [] }; } };
  const regime = await detectRegime(client);
  assert.equal(regime, 'normal');
});

test('DEFAULT_MIN_ELIGIBLE_SOURCES exported', () => {
  assert.equal(typeof DEFAULT_MIN_ELIGIBLE_SOURCES, 'number');
  assert.ok(DEFAULT_MIN_ELIGIBLE_SOURCES >= 1);
});
