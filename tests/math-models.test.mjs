import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// ── Kalman Filter (scalar) ──────────────────────────────────────────

import {
  createKalmanState,
  updateKalmanState,
} from '../src/services/math-models/kalman-filter.ts';

describe('Scalar Kalman Filter', () => {
  it('initializes with first measurement', () => {
    const state = updateKalmanState(null, 42);
    assert.equal(state.x, 42);
    assert.equal(state.initialized, true);
    assert.equal(state.updates, 1);
  });

  it('tracks noiseless constant input', () => {
    let state = null;
    for (let i = 0; i < 20; i++) {
      state = updateKalmanState(state, 100);
    }
    assert.ok(Math.abs(state.x - 100) < 0.01, `Expected ~100, got ${state.x}`);
  });

  it('tracks a step change', () => {
    let state = null;
    for (let i = 0; i < 10; i++) state = updateKalmanState(state, 50);
    for (let i = 0; i < 20; i++) state = updateKalmanState(state, 80);
    assert.ok(Math.abs(state.x - 80) < 2, `Expected ~80, got ${state.x}`);
  });

  it('handles NaN/Infinity gracefully', () => {
    let state = updateKalmanState(null, 10);
    state = updateKalmanState(state, NaN);
    assert.ok(Number.isFinite(state.x), 'State x should remain finite');
    state = updateKalmanState(state, Infinity);
    assert.ok(Number.isFinite(state.x), 'State x should remain finite after Infinity');
  });

  it('output is always finite', () => {
    let state = null;
    for (let i = 0; i < 50; i++) {
      state = updateKalmanState(state, Math.random() * 100);
      assert.ok(Number.isFinite(state.x), `x not finite at step ${i}`);
      assert.ok(Number.isFinite(state.p), `p not finite at step ${i}`);
      assert.ok(Number.isFinite(state.k), `k not finite at step ${i}`);
    }
  });
});

// ── HMM Regime Model ────────────────────────────────────────────────

import { inferHMMRegimePosterior } from '../src/services/math-models/hmm-regime.ts';

describe('HMM Regime Model', () => {
  it('posterior probabilities sum to 1', () => {
    const result = inferHMMRegimePosterior({
      scores: { 'risk-on': 10, 'risk-off': 5, 'inflation-shock': 2, 'deflation-bust': 1 },
    });
    const sum = Object.values(result.posterior).reduce((a, b) => a + b, 0);
    assert.ok(Math.abs(sum - 1) < 0.001, `Posterior sum should be ~1, got ${sum}`);
  });

  it('selects highest-scoring regime', () => {
    const result = inferHMMRegimePosterior({
      scores: { 'risk-on': 0, 'risk-off': 100, 'inflation-shock': 0, 'deflation-bust': 0 },
    });
    assert.equal(result.selected, 'risk-off');
  });

  it('entropy is in [0, 1]', () => {
    const result = inferHMMRegimePosterior({
      scores: { 'risk-on': 5, 'risk-off': 5, 'inflation-shock': 5, 'deflation-bust': 5 },
    });
    assert.ok(result.entropy >= 0 && result.entropy <= 1, `Entropy ${result.entropy} out of range`);
  });

  it('confidence is in [28, 96]', () => {
    for (let trial = 0; trial < 20; trial++) {
      const scores = {
        'risk-on': Math.random() * 50,
        'risk-off': Math.random() * 50,
        'inflation-shock': Math.random() * 50,
        'deflation-bust': Math.random() * 50,
      };
      const result = inferHMMRegimePosterior({ scores });
      assert.ok(result.confidence >= 28 && result.confidence <= 96,
        `Confidence ${result.confidence} out of [28,96]`);
    }
  });

  it('transitionConfidence is in [0, 1]', () => {
    const result = inferHMMRegimePosterior({
      scores: { 'risk-on': 10, 'risk-off': 5, 'inflation-shock': 2, 'deflation-bust': 1 },
    });
    assert.ok(result.transitionConfidence >= 0 && result.transitionConfidence <= 1,
      `transitionConfidence ${result.transitionConfidence} out of [0,1]`);
  });

  it('regimeDecay decays with age', () => {
    const fresh = inferHMMRegimePosterior({
      scores: { 'risk-on': 10, 'risk-off': 5, 'inflation-shock': 2, 'deflation-bust': 1 },
      previous: { id: 'risk-on', confidence: 70, regimeAgeHours: 0 },
    });
    const aged = inferHMMRegimePosterior({
      scores: { 'risk-on': 10, 'risk-off': 5, 'inflation-shock': 2, 'deflation-bust': 1 },
      previous: { id: 'risk-on', confidence: 70, regimeAgeHours: 168 },
    });
    assert.ok(fresh.regimeDecay > aged.regimeDecay,
      `Decay should decrease with age: fresh=${fresh.regimeDecay}, aged=${aged.regimeDecay}`);
    assert.ok(Math.abs(aged.regimeDecay - 0.5) < 0.01,
      `At 168h (half-life), decay should be ~0.5, got ${aged.regimeDecay}`);
  });

  it('transition matrix rows sum to 1', () => {
    const result = inferHMMRegimePosterior({
      scores: { 'risk-on': 10, 'risk-off': 5, 'inflation-shock': 2, 'deflation-bust': 1 },
    });
    for (const [from, row] of Object.entries(result.transitionMatrix)) {
      const rowSum = Object.values(row).reduce((a, b) => a + b, 0);
      assert.ok(Math.abs(rowSum - 1) < 0.001,
        `Transition row ${from} sums to ${rowSum}, expected ~1`);
    }
  });

  it('persistence with previous regime is stable', () => {
    const result = inferHMMRegimePosterior({
      scores: { 'risk-on': 20, 'risk-off': 2, 'inflation-shock': 1, 'deflation-bust': 1 },
      previous: { id: 'risk-on', confidence: 85 },
    });
    assert.equal(result.selected, 'risk-on', 'Should persist in risk-on regime');
    assert.ok(result.persistence > 0.5, `Persistence should be high, got ${result.persistence}`);
  });
});

// ── Hawkes Process ──────────────────────────────────────────────────

import {
  computeHawkesIntensity,
  getHawkesDomainPreset,
} from '../src/services/math-models/hawkes-process.ts';

describe('Hawkes Process', () => {
  const NOW = Date.now();
  const eventsRecent = [
    { timestamp: NOW - 3_600_000 * 1 },   // 1h ago
    { timestamp: NOW - 3_600_000 * 2 },   // 2h ago
    { timestamp: NOW - 3_600_000 * 3 },   // 3h ago
  ];

  it('intensity increases with more events', () => {
    const one = computeHawkesIntensity([eventsRecent[0]], { now: NOW });
    const three = computeHawkesIntensity(eventsRecent, { now: NOW });
    assert.ok(three.lambda > one.lambda,
      `3 events (${three.lambda}) should exceed 1 event (${one.lambda})`);
  });

  it('normalized output is in [0, 1]', () => {
    const result = computeHawkesIntensity(eventsRecent, { now: NOW });
    assert.ok(result.normalized >= 0 && result.normalized <= 1,
      `Normalized ${result.normalized} out of [0,1]`);
  });

  it('empty events return baseline only', () => {
    const result = computeHawkesIntensity([], { now: NOW });
    assert.ok(result.lambda > 0, 'Lambda should be at least baseline');
    assert.equal(result.eventCount, 0);
  });

  it('domain presets have distinct parameters', () => {
    const military = getHawkesDomainPreset('military');
    const cyber = getHawkesDomainPreset('cyber');
    assert.ok(military.alpha > cyber.alpha,
      'Military should have higher self-excitation than cyber');
    assert.ok(military.betaHours > cyber.betaHours,
      'Military should have slower decay than cyber');
  });

  it('family parameter changes intensity profile', () => {
    const military = computeHawkesIntensity(eventsRecent, { now: NOW, family: 'military' });
    const cyber = computeHawkesIntensity(eventsRecent, { now: NOW, family: 'cyber' });
    // Military has higher alpha and slower decay → higher intensity for same events
    assert.ok(military.lambda !== cyber.lambda,
      'Different families should produce different intensities');
  });

  it('future events are ignored', () => {
    const events = [
      { timestamp: NOW - 3_600_000 },   // 1h ago (valid)
      { timestamp: NOW + 3_600_000 },   // 1h future (should be ignored)
    ];
    const result = computeHawkesIntensity(events, { now: NOW });
    assert.equal(result.eventCount, 1, 'Future events should not be counted');
  });
});

// ── RMT Correlation Denoising ───────────────────────────────────────

import {
  decomposeSymmetricMatrix,
  estimateMarcenkoPasturCutoff,
  denoiseCorrelationMatrix,
  normalizeToCorrelation,
} from '../src/services/math-models/rmt-correlation.ts';

describe('RMT Correlation Denoising', () => {
  it('identity matrix eigenvalues are all 1', () => {
    const I3 = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
    const result = decomposeSymmetricMatrix(I3);
    assert.ok(result.converged, 'Should converge for identity');
    for (const ev of result.eigenvalues) {
      assert.ok(Math.abs(ev - 1) < 0.001, `Eigenvalue ${ev} should be ~1`);
    }
  });

  it('preserves eigenvalue ordering (descending)', () => {
    const M = [[3, 1, 0], [1, 2, 0.5], [0, 0.5, 1]];
    const result = decomposeSymmetricMatrix(M);
    for (let i = 1; i < result.eigenvalues.length; i++) {
      assert.ok(result.eigenvalues[i - 1] >= result.eigenvalues[i] - 0.001,
        `Eigenvalues not descending at index ${i}`);
    }
  });

  it('eigenvalue sum equals trace', () => {
    const M = [[4, 1, 0], [1, 3, 0.5], [0, 0.5, 2]];
    const trace = M.reduce((s, row, i) => s + row[i], 0);
    const result = decomposeSymmetricMatrix(M);
    const eigenSum = result.eigenvalues.reduce((s, v) => s + v, 0);
    assert.ok(Math.abs(eigenSum - trace) < 0.01,
      `Eigenvalue sum ${eigenSum} ≠ trace ${trace}`);
  });

  it('Marcenko-Pastur identifies signal vs noise', () => {
    // 3×3 matrix with one dominant eigenvalue
    const M = [[5, 2, 1], [2, 1, 0], [1, 0, 1]];
    const mp = estimateMarcenkoPasturCutoff(M, 100);
    assert.ok(mp.signalEigenCount >= 1, 'Should detect at least 1 signal eigenvalue');
    assert.ok(mp.lambdaMax > mp.lambdaMin, 'lambdaMax should exceed lambdaMin');
  });

  it('denoised correlation has 1s on diagonal', () => {
    const corr = [[1, 0.5, 0.2], [0.5, 1, 0.3], [0.2, 0.3, 1]];
    const result = denoiseCorrelationMatrix(corr, { sampleSize: 50 });
    for (let i = 0; i < 3; i++) {
      assert.ok(Math.abs(result.denoisedMatrix[i][i] - 1) < 0.001,
        `Diagonal [${i}][${i}] should be 1, got ${result.denoisedMatrix[i][i]}`);
    }
  });

  it('denoised matrix is symmetric', () => {
    const corr = [[1, 0.8, 0.1], [0.8, 1, 0.4], [0.1, 0.4, 1]];
    const result = denoiseCorrelationMatrix(corr, { sampleSize: 100 });
    const D = result.denoisedMatrix;
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 3; j++) {
        assert.ok(Math.abs(D[i][j] - D[j][i]) < 0.001,
          `Matrix not symmetric at [${i}][${j}]`);
      }
    }
  });
});

// ── Multivariate Kalman Filter ──────────────────────────────────────

import {
  createMultivariateKalmanState,
  updateMultivariateKalman,
  computeInnovationStats,
  buildRegimeAdaptiveQ,
  buildCoupledTransitionMatrix,
} from '../src/services/math-models/multivariate-kalman.ts';
import { runTruthDiscovery } from '../src/services/math-models/truth-discovery.ts';
import {
  createBanditArmState,
  scoreBanditArm,
  updateBanditArm,
} from '../src/services/math-models/contextual-bandit.ts';

describe('Multivariate Kalman Filter', () => {
  it('initializes with first measurement', () => {
    const state = updateMultivariateKalman(null, [1, 2, 3]);
    assert.deepEqual(state.x, [1, 2, 3]);
    assert.equal(state.initialized, true);
    assert.equal(state.updates, 1);
  });

  it('tracks constant 2D input', () => {
    let state = null;
    for (let i = 0; i < 30; i++) {
      state = updateMultivariateKalman(state, [10, 20]);
    }
    assert.ok(Math.abs(state.x[0] - 10) < 0.5, `x[0]=${state.x[0]}, expected ~10`);
    assert.ok(Math.abs(state.x[1] - 20) < 0.5, `x[1]=${state.x[1]}, expected ~20`);
  });

  it('tracks a step change in 2D', () => {
    let state = null;
    for (let i = 0; i < 15; i++) state = updateMultivariateKalman(state, [10, 20]);
    for (let i = 0; i < 30; i++) state = updateMultivariateKalman(state, [50, 80]);
    assert.ok(Math.abs(state.x[0] - 50) < 3, `x[0]=${state.x[0]}, expected ~50`);
    assert.ok(Math.abs(state.x[1] - 80) < 3, `x[1]=${state.x[1]}, expected ~80`);
  });

  it('P remains symmetric after updates', () => {
    let state = null;
    for (let i = 0; i < 10; i++) {
      state = updateMultivariateKalman(state, [Math.random() * 10, Math.random() * 20, Math.random() * 5]);
    }
    const n = state.stateDim;
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        assert.ok(Math.abs(state.P[i][j] - state.P[j][i]) < 1e-6,
          `P not symmetric at [${i}][${j}]: ${state.P[i][j]} vs ${state.P[j][i]}`);
      }
    }
  });

  it('regime-adaptive Q scales with regime', () => {
    const base = [1.0, 1.0, 1.0];
    const Qnormal = buildRegimeAdaptiveQ(base, 'normal');
    const Qcrisis = buildRegimeAdaptiveQ(base, 'crisis');
    assert.ok(Qcrisis[0][0] > Qnormal[0][0],
      `Crisis Q (${Qcrisis[0][0]}) should exceed normal Q (${Qnormal[0][0]})`);
    assert.equal(Qcrisis[0][0], 4.0, 'Crisis multiplier should be 4×');
  });

  it('coupled transition matrix has off-diagonal terms', () => {
    const F = buildCoupledTransitionMatrix(3, [
      { from: 0, to: 1, weight: 0.1 },
    ]);
    assert.equal(F[0][0], 1, 'Diagonal should be 1');
    assert.equal(F[1][0], 0.1, 'Off-diagonal coupling should be 0.1');
    assert.equal(F[2][0], 0, 'Uncoupled should be 0');
  });

  it('coupling weights are clamped to [-0.3, 0.3]', () => {
    const F = buildCoupledTransitionMatrix(2, [
      { from: 0, to: 1, weight: 0.9 },
    ]);
    assert.equal(F[1][0], 0.3, 'Should clamp to 0.3');
  });

  it('innovation stats produce finite values', () => {
    let state = createMultivariateKalmanState(2);
    state = updateMultivariateKalman(state, [10, 20]);
    state = updateMultivariateKalman(state, [11, 21]);

    const stats = computeInnovationStats(state, [12, 22]);
    assert.ok(Number.isFinite(stats.mahalanobis), `Mahalanobis not finite: ${stats.mahalanobis}`);
    assert.ok(Number.isFinite(stats.logLikelihood), `LogLik not finite: ${stats.logLikelihood}`);
    assert.equal(stats.innovation.length, 2);
  });
});

describe('Scalar Kalman Filter - Phase 5 expansions', () => {
  it('matches a noiseless constant stream with near-zero error', () => {
    let state = null;
    for (let i = 0; i < 12; i++) {
      state = updateKalmanState(state, 25, {
        processNoise: 0,
        measurementNoise: 1e-9,
        initialVariance: 1,
      });
    }
    assert.ok(Math.abs(state.x - 25) < 1e-6, `Expected exact tracking near 25, got ${state.x}`);
  });

  it('closes most of the gap within a few updates after a step change', () => {
    let state = null;
    for (let i = 0; i < 8; i++) state = updateKalmanState(state, 10);
    const preStepError = Math.abs(50 - state.x);
    for (let i = 0; i < 5; i++) state = updateKalmanState(state, 50);
    const postStepError = Math.abs(50 - state.x);
    assert.ok(postStepError < preStepError * 0.5,
      `Expected post-step error ${postStepError} to be less than half of ${preStepError}`);
  });
});

describe('RMT Correlation Denoising - Phase 5 expansions', () => {
  function makeNoiseMatrix(samples, dimensions, seed = 12345) {
    let state = seed >>> 0;
    const nextUniform = () => {
      state = (1664525 * state + 1013904223) >>> 0;
      return state / 0x100000000;
    };
    const nextGaussian = () => {
      const u1 = Math.max(nextUniform(), 1e-12);
      const u2 = nextUniform();
      return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    };

    return Array.from({ length: samples }, () =>
      Array.from({ length: dimensions }, () => nextGaussian())
    );
  }

  function sampleCorrelation(samples) {
    const rows = samples.length;
    const cols = samples[0].length;
    const means = Array.from({ length: cols }, (_, col) =>
      samples.reduce((sum, row) => sum + row[col], 0) / rows
    );
    const centered = samples.map((row) => row.map((value, col) => value - means[col]));
    const covariance = Array.from({ length: cols }, (_, row) =>
      Array.from({ length: cols }, (_, col) => {
        const sum = centered.reduce((acc, values) => acc + values[row] * values[col], 0);
        return sum / Math.max(rows - 1, 1);
      })
    );
    return normalizeToCorrelation(covariance);
  }

  it('keeps random-noise spectra near the Marcenko-Pastur noise band', () => {
    const samples = makeNoiseMatrix(120, 12);
    const corr = sampleCorrelation(samples);
    const decomposition = decomposeSymmetricMatrix(corr);
    const mp = estimateMarcenkoPasturCutoff(corr, samples.length, decomposition.eigenvalues);
    const maxEigenvalue = decomposition.eigenvalues[0];
    assert.ok(maxEigenvalue <= mp.lambdaMax * 1.15,
      `Largest random eigenvalue ${maxEigenvalue} should remain close to MP upper band ${mp.lambdaMax}`);
    assert.ok(mp.signalEigenCount <= 1,
      `Pure noise should not create many signal eigenvalues, got ${mp.signalEigenCount}`);
  });

  it('normalizes a diagonal covariance matrix back to identity', () => {
    const diagonal = [
      [9, 0, 0],
      [0, 4, 0],
      [0, 0, 1],
    ];
    const corr = normalizeToCorrelation(diagonal);
    assert.deepEqual(corr, [
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
    ]);
  });
});

describe('Truth Discovery - Phase 5 expansions', () => {
  it('caps iterative refinement within 10 rounds', () => {
    const result = runTruthDiscovery([
      {
        id: 'claim-a',
        observations: [
          { sourceId: 'wire-a', value: 1 },
          { sourceId: 'wire-b', value: 1 },
          { sourceId: 'wire-c', value: 0 },
        ],
      },
      {
        id: 'claim-b',
        observations: [
          { sourceId: 'wire-a', value: 0 },
          { sourceId: 'wire-b', value: 0 },
          { sourceId: 'wire-c', value: 1 },
        ],
      },
    ], { iterations: 25 });

    assert.ok(result.iterations <= 10, `Iterations should cap at 10, got ${result.iterations}`);
    Object.values(result.claimTruth).forEach((truth) => {
      assert.ok(Number.isFinite(truth) && truth >= 0 && truth <= 100,
        `Claim truth should remain in [0, 100], got ${truth}`);
    });
  });

  it('treats unanimous supporting evidence as near-certain truth', () => {
    const result = runTruthDiscovery([
      {
        id: 'claim-consensus',
        observations: [
          { sourceId: 'src-1', value: 1 },
          { sourceId: 'src-2', value: 1 },
          { sourceId: 'src-3', value: 1 },
        ],
      },
    ]);

    assert.ok(result.claimTruth['claim-consensus'] > 95,
      `Expected unanimous claim to approach certainty, got ${result.claimTruth['claim-consensus']}`);
    Object.values(result.sourceStats).forEach((stats) => {
      assert.ok(stats.truthAgreement > 95, `Unanimous sources should align strongly with truth, got ${stats.truthAgreement}`);
      assert.ok(stats.sensitivity > 90, `Unanimous positive sources should learn high sensitivity, got ${stats.sensitivity}`);
    });
  });
});

describe('Contextual Bandit - Phase 5 expansions', () => {
  function withMockedRandom(seed, callback) {
    const original = Math.random;
    let state = seed >>> 0;
    Math.random = () => {
      state = (1664525 * state + 1013904223) >>> 0;
      return state / 0x100000000;
    };
    try {
      return callback();
    } finally {
      Math.random = original;
    }
  }

  it('increases exploration spread when alpha is higher', () => {
    let arm = createBanditArmState('asset-a', 2);
    for (let i = 0; i < 24; i++) {
      arm = updateBanditArm(arm, [1, 0], 1);
    }

    const lowAlphaDeviation = withMockedRandom(7, () => {
      const scores = Array.from({ length: 48 }, () => scoreBanditArm(arm, [1, 0], 0.1));
      return scores.reduce((sum, score) => sum + Math.abs(score.sample - score.mean), 0) / scores.length;
    });

    const highAlphaDeviation = withMockedRandom(7, () => {
      const scores = Array.from({ length: 48 }, () => scoreBanditArm(arm, [1, 0], 1.6));
      return scores.reduce((sum, score) => sum + Math.abs(score.sample - score.mean), 0) / scores.length;
    });

    assert.ok(highAlphaDeviation > lowAlphaDeviation * 1.5,
      `Higher alpha should explore more: low=${lowAlphaDeviation}, high=${highAlphaDeviation}`);
  });

  it('clips oversized rewards before updating bandit state', () => {
    let arm = createBanditArmState('asset-b', 2);
    arm = updateBanditArm(arm, [1, 0], 5);
    assert.equal(arm.totalReward, 1, 'Positive reward should clip to +1');
    assert.equal(arm.vectorB[0], 1, 'vectorB should use the clipped reward');

    arm = updateBanditArm(arm, [1, 0], -5);
    assert.equal(arm.totalReward, 0, 'Negative reward should clip to -1');
    assert.equal(arm.vectorB[0], 0, 'Second update should bring clipped vectorB back to 0');
  });
});
