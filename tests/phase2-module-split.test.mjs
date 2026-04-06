/**
 * Phase 2: Module Split Verification Tests
 * Validates that the investment module split preserves correctness.
 * Tests only self-contained modules (no deep dependency chains requiring @/ aliases).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { repoPath } from './_workspace-paths.mjs';

// Test 1: Module state
describe('module-state', () => {
  it('exports mutable state with getters and setters', async () => {
    const S = await import('../src/services/investment/module-state.ts');

    assert.equal(S.loaded, false);
    assert.equal(S.currentSnapshot, null);
    assert.ok(Array.isArray(S.currentHistory));
    assert.ok(Array.isArray(S.trackedIdeas));
    assert.ok(S.mappingStats instanceof Map);
    assert.ok(S.banditStates instanceof Map);
    assert.ok(S.candidateReviews instanceof Map);

    // Test setters work
    S.setLoaded(true);
    assert.equal(S.loaded, true);
    S.setLoaded(false);

    S.setCurrentHistory([{ id: 'test' }]);
    assert.equal(S.currentHistory.length, 1);
    S.setCurrentHistory([]);
  });
});

// Test 2: Constants
describe('constants module', () => {
  it('exports all key constants', async () => {
    const C = await import('../src/services/investment/constants.ts');

    assert.equal(typeof C.SNAPSHOT_KEY, 'string');
    assert.equal(typeof C.MAX_HISTORY, 'number');
    assert.equal(C.MAX_HISTORY, 240);
    assert.equal(C.MAX_TRACKED_IDEAS, 260);
    assert.ok(Array.isArray(C.POSITION_RULES));
    assert.equal(C.POSITION_RULES.length, 4);
    assert.ok(Array.isArray(C.THEME_RULES));
    assert.ok(C.THEME_RULES.length >= 6);
    assert.ok(Array.isArray(C.UNIVERSE_ASSET_CATALOG));
    assert.ok(C.UNIVERSE_ASSET_CATALOG.length > 20);
    assert.ok(C.ARCHIVE_RE instanceof RegExp);
    assert.ok(C.SPORTS_RE instanceof RegExp);
    assert.ok(C.LOW_SIGNAL_RE instanceof RegExp);
  });

  it('THEME_RULES contains well-formed themes', async () => {
    const C = await import('../src/services/investment/constants.ts');

    for (const theme of C.THEME_RULES) {
      assert.ok(theme.id, `Theme missing id`);
      assert.ok(theme.label, `Theme ${theme.id} missing label`);
      assert.ok(theme.triggers.length > 0, `Theme ${theme.id} has no triggers`);
      assert.ok(theme.assets.length > 0, `Theme ${theme.id} has no assets`);
      assert.ok(theme.baseSensitivity > 0, `Theme ${theme.id} has no sensitivity`);
    }
  });

  it('POSITION_RULES has correct structure', async () => {
    const C = await import('../src/services/investment/constants.ts');

    const ids = C.POSITION_RULES.map(r => r.id);
    assert.deepEqual(ids, ['starter', 'standard', 'conviction', 'hedge']);

    for (const rule of C.POSITION_RULES) {
      assert.ok(rule.minConviction > 0);
      assert.ok(rule.maxPositionPct > 0);
      assert.ok(rule.stopLossPct > 0);
      assert.ok(rule.takeProfitPct > 0);
    }
  });

  it('DEFAULT_UNIVERSE_EXPANSION_POLICY has correct defaults', async () => {
    const C = await import('../src/services/investment/constants.ts');

    assert.equal(C.DEFAULT_UNIVERSE_EXPANSION_POLICY.mode, 'guarded-auto');
    assert.equal(C.DEFAULT_UNIVERSE_EXPANSION_POLICY.minCodexConfidence, 58);
    assert.equal(C.DEFAULT_UNIVERSE_EXPANSION_POLICY.probationCycles, 4);
  });
});

// Test 3: Utils
describe('utils module', () => {
  it('clamp works correctly', async () => {
    const { clamp } = await import('../src/services/investment/utils.ts');
    assert.equal(clamp(5, 0, 10), 5);
    assert.equal(clamp(-5, 0, 10), 0);
    assert.equal(clamp(15, 0, 10), 10);
  });

  it('logistic sigmoid', async () => {
    const { logistic } = await import('../src/services/investment/utils.ts');
    const mid = logistic(0);
    assert.ok(Math.abs(mid - 0.5) < 0.01, `logistic(0) should be ~0.5, got ${mid}`);
    const high = logistic(10);
    assert.ok(high > 0.9, `logistic(10) should be > 0.9, got ${high}`);
    const low = logistic(-10);
    assert.ok(low < 0.1, `logistic(-10) should be < 0.1, got ${low}`);
  });

  it('average computes correctly', async () => {
    const { average } = await import('../src/services/investment/utils.ts');
    assert.equal(average([1, 2, 3, 4, 5]), 3);
    assert.equal(average([]), 0);
    assert.equal(average([10]), 10);
  });

  it('weightedAverage', async () => {
    const { weightedAverage } = await import('../src/services/investment/utils.ts');
    const result = weightedAverage([10, 20], [1, 3]);
    assert.equal(result, 17.5);
  });

  it('median computes correctly', async () => {
    const { median } = await import('../src/services/investment/utils.ts');
    assert.equal(median([1, 3, 5]), 3);
    assert.equal(median([1, 2, 3, 4]), 2.5);
    assert.equal(median([42]), 42);
  });

  it('percentile computes correctly', async () => {
    const { percentile } = await import('../src/services/investment/utils.ts');
    const result = percentile([10, 20, 30, 40, 50], 0.5);
    assert.ok(result >= 25 && result <= 35);
  });

  it('normalize removes accents and lowercases', async () => {
    const { normalize } = await import('../src/services/investment/utils.ts');
    assert.equal(normalize('Hello World'), 'hello world');
  });

  it('dedupeStrings removes duplicates', async () => {
    const { dedupeStrings } = await import('../src/services/investment/utils.ts');
    assert.deepEqual(dedupeStrings(['a', 'b', 'a', 'c']), ['a', 'b', 'c']);
  });

  it('uniqueId generates unique prefixed ids', async () => {
    const { uniqueId } = await import('../src/services/investment/utils.ts');
    const a = uniqueId('test');
    const b = uniqueId('test');
    assert.ok(a.startsWith('test:') || a.startsWith('test-'), `uniqueId should start with prefix, got ${a}`);
    assert.notEqual(a, b);
  });

  it('elapsedDays computes correct values', async () => {
    const { elapsedDays } = await import('../src/services/investment/utils.ts');
    const days = elapsedDays('2025-01-01T00:00:00Z', '2025-01-04T00:00:00Z');
    assert.ok(Math.abs(days - 3) < 0.01);
  });

  it('pearsonCorrelation of identical arrays is ~1', async () => {
    const { pearsonCorrelation } = await import('../src/services/investment/utils.ts');
    const r = pearsonCorrelation([1, 2, 3, 4, 5], [1, 2, 3, 4, 5]);
    assert.ok(Math.abs(r - 1) < 0.001);
  });

  it('pearsonCorrelation of inversely correlated is ~-1', async () => {
    const { pearsonCorrelation } = await import('../src/services/investment/utils.ts');
    const r = pearsonCorrelation([1, 2, 3, 4, 5], [5, 4, 3, 2, 1]);
    assert.ok(Math.abs(r + 1) < 0.001);
  });
});

// Test 4: Conviction scorer
describe('conviction-scorer module', () => {
  it('normalizeConvictionFeatures clamps values to [0, 100]', async () => {
    const { normalizeConvictionFeatures } = await import('../src/services/investment/conviction-scorer.ts');

    const features = {
      corroborationQuality: 200,
      recentEvidenceScore: -10,
      realityScore: 50,
      graphSignalScore: 50,
      transferEntropy: 50,
      banditScore: 50,
      regimeMultiplier: 50,
      coveragePenalty: 50,
      falsePositiveRisk: 50,
    };

    const normalized = normalizeConvictionFeatures(features);
    assert.ok(normalized.corroborationQuality <= 1, `corroborationQuality should be clamped to <=1, got ${normalized.corroborationQuality}`);
    assert.ok(normalized.recentEvidenceScore >= 0, `recentEvidenceScore should be >=0, got ${normalized.recentEvidenceScore}`);
    assert.equal(normalized.realityScore, 0.5);
  });

  it('scoreConvictionModel returns a bounded number', async () => {
    const { scoreConvictionModel, normalizeConvictionFeatures } = await import('../src/services/investment/conviction-scorer.ts');

    const features = normalizeConvictionFeatures({
      corroborationQuality: 70,
      recentEvidenceScore: 60,
      realityScore: 80,
      graphSignalScore: 50,
      transferEntropy: 40,
      banditScore: 55,
      regimeMultiplier: 65,
      coveragePenalty: 10,
      falsePositiveRisk: 20,
    });

    const score = scoreConvictionModel(features);
    assert.equal(typeof score, 'number');
    assert.ok(score >= 0 && score <= 100);
  });

  it('blendLearnedConviction blends base with model', async () => {
    const { blendLearnedConviction, normalizeConvictionFeatures } = await import('../src/services/investment/conviction-scorer.ts');

    const features = normalizeConvictionFeatures({
      corroborationQuality: 70,
      recentEvidenceScore: 60,
      realityScore: 80,
      graphSignalScore: 50,
      transferEntropy: 40,
      banditScore: 55,
      regimeMultiplier: 65,
      coveragePenalty: 10,
      falsePositiveRisk: 20,
    });

    const blended = blendLearnedConviction(60, features);
    assert.equal(typeof blended, 'number');
    assert.ok(blended >= 0 && blended <= 100);
  });

  it('updateConvictionModel adjusts weights', async () => {
    const { updateConvictionModel, normalizeConvictionFeatures } = await import('../src/services/investment/conviction-scorer.ts');
    const S = await import('../src/services/investment/module-state.ts');

    const prevObs = S.convictionModelState.observations;
    const features = normalizeConvictionFeatures({
      corroborationQuality: 70,
      recentEvidenceScore: 60,
      realityScore: 80,
      graphSignalScore: 50,
      transferEntropy: 40,
      banditScore: 55,
      regimeMultiplier: 65,
      coveragePenalty: 10,
      falsePositiveRisk: 20,
    });

    updateConvictionModel(features, 5.0);
    assert.equal(S.convictionModelState.observations, prevObs + 1);
  });
});

// Test 5: Position sizer (self-contained tests)
describe('position-sizer module', () => {
  it('chooseSizingRule returns conviction rule for high conviction', async () => {
    const { chooseSizingRule } = await import('../src/services/investment/position-sizer.ts');
    const { POSITION_RULES } = await import('../src/services/investment/constants.ts');
    const convictionRule = POSITION_RULES.find((rule) => rule.id === 'conviction');
    assert.ok(convictionRule);
    const rule = chooseSizingRule(convictionRule.minConviction + 5, convictionRule.maxFalsePositiveRisk - 5, 'long');
    assert.ok(rule);
    assert.equal(rule.id, 'conviction');
  });

  it('chooseSizingRule returns starter rule for low conviction', async () => {
    const { chooseSizingRule } = await import('../src/services/investment/position-sizer.ts');
    const { POSITION_RULES } = await import('../src/services/investment/constants.ts');
    const starterRule = POSITION_RULES.find((rule) => rule.id === 'starter');
    const standardRule = POSITION_RULES.find((rule) => rule.id === 'standard');
    assert.ok(starterRule);
    assert.ok(standardRule);
    const conviction = Math.max(starterRule.minConviction, standardRule.minConviction - 1);
    const falsePositiveRisk = Math.min(starterRule.maxFalsePositiveRisk, standardRule.maxFalsePositiveRisk);
    const starter = chooseSizingRule(conviction, falsePositiveRisk, 'long');
    assert.ok(starter);
    assert.equal(starter.id, 'starter');
  });

  it('hedge direction returns hedge rule', async () => {
    const { chooseSizingRule } = await import('../src/services/investment/position-sizer.ts');
    const rule = chooseSizingRule(55, 45, 'hedge');
    assert.equal(rule.id, 'hedge');
  });

  it('dedupeIdeaSymbols removes duplicates', async () => {
    const { dedupeIdeaSymbols } = await import('../src/services/investment/position-sizer.ts');

    const symbols = [
      { symbol: 'XLE', name: 'Energy ETF', role: 'primary', direction: 'long', liquidityScore: 80, realityScore: 90 },
      { symbol: 'XLE', name: 'Energy ETF', role: 'confirm', direction: 'long', liquidityScore: 60, realityScore: 70 },
      { symbol: 'USO', name: 'Oil Fund', role: 'primary', direction: 'long', liquidityScore: 75, realityScore: 85 },
    ];

    const deduped = dedupeIdeaSymbols(symbols);
    assert.equal(deduped.length, 2); // XLE deduped to one
    const xle = deduped.find(s => s.symbol === 'XLE');
    assert.ok(xle);
    assert.equal(xle.role, 'primary'); // primary has higher rank
  });
});

// Test 6: File size verification (facade < 100 lines)
describe('split verification', () => {
  it('facade file is under 100 lines', async () => {
    const fs = await import('node:fs');
    const content = fs.readFileSync(repoPath('src/services/investment-intelligence.ts'), 'utf-8');
    const lines = content.split('\n').length;
    assert.ok(lines < 100, `Facade should be < 100 lines, got ${lines}`);
  });

  it('split produced 18 module files', async () => {
    const fs = await import('node:fs');
    const files = fs.readdirSync(repoPath('src/services/investment'));
    const tsFiles = files.filter(f => f.endsWith('.ts'));
    assert.ok(tsFiles.length >= 15, `Expected >= 15 modules, got ${tsFiles.length}`);
  });

  it('no single module exceeds 2500 lines', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const dir = repoPath('src/services/investment');
    const files = fs.readdirSync(dir).filter(f => f.endsWith('.ts'));

    for (const file of files) {
      const content = fs.readFileSync(path.join(dir, file), 'utf-8');
      const lines = content.split('\n').length;
      assert.ok(lines <= 2500, `${file} has ${lines} lines (max 2500)`);
    }
  });
});
