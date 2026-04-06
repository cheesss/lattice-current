/**
 * Phase 3: Backtest/Live Isolation Tests
 * Validates ExecutionContext, TemporalBarrier, and Walk-Forward modules.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { repoPath } from './_workspace-paths.mjs';

// ---------------------------------------------------------------------------
// Test 1: ExecutionContext
// ---------------------------------------------------------------------------
describe('ExecutionContext', () => {
  it('createLiveContext creates a live context with correct mode', async () => {
    const mod = await import('../src/services/execution-context.ts');
    const { InMemoryStateStore } = await import('../src/services/state/in-memory-state-store.ts');

    const store = new InMemoryStateStore('live');
    const ctx = mod.createLiveContext(store);
    assert.equal(ctx.mode, 'live');
    assert.equal(ctx.isLive, true);
    assert.equal(ctx.isIsolated, false);
  });

  it('createReplayContext creates isolated context', async () => {
    const mod = await import('../src/services/execution-context.ts');
    const ctx = mod.createReplayContext({
      startDate: new Date('2025-01-01'),
      endDate: new Date('2025-06-01'),
    });
    assert.equal(ctx.mode, 'replay');
    assert.equal(ctx.isLive, false);
    assert.equal(ctx.isIsolated, true);
  });

  it('createBacktestContext creates isolated context with seed', async () => {
    const mod = await import('../src/services/execution-context.ts');
    const ctx = mod.createBacktestContext({
      startDate: new Date('2025-01-01'),
      endDate: new Date('2025-12-31'),
      randomSeed: 42,
    });
    assert.equal(ctx.mode, 'backtest');
    assert.equal(ctx.isIsolated, true);
    assert.equal(ctx.randomSeed, 42);
  });

  it('knowledgeBoundary only advances forward', async () => {
    const mod = await import('../src/services/execution-context.ts');
    const ctx = mod.createBacktestContext({
      startDate: new Date('2025-01-01'),
      endDate: new Date('2025-12-31'),
    });

    ctx.advanceKnowledgeBoundary(new Date('2025-03-01'));
    assert.equal(ctx.knowledgeBoundary.toISOString(), new Date('2025-03-01').toISOString());

    // Moving forward is OK
    ctx.advanceKnowledgeBoundary(new Date('2025-06-01'));
    assert.equal(ctx.knowledgeBoundary.toISOString(), new Date('2025-06-01').toISOString());

    // Moving backward throws
    assert.throws(() => {
      ctx.advanceKnowledgeBoundary(new Date('2025-02-01'));
    }, /Cannot move knowledge boundary backward/);
  });

  it('isAccessible checks data timestamps', async () => {
    const mod = await import('../src/services/execution-context.ts');
    const ctx = mod.createBacktestContext({
      startDate: new Date('2025-06-15'),
      endDate: new Date('2025-12-31'),
    });

    assert.equal(ctx.isAccessible(new Date('2025-06-14')), true);   // before boundary
    assert.equal(ctx.isAccessible(new Date('2025-06-15')), true);   // at boundary
    assert.equal(ctx.isAccessible(new Date('2025-06-16')), false);  // after boundary
  });

  it('freeze prevents further state changes in evaluation mode', async () => {
    const mod = await import('../src/services/execution-context.ts');
    const ctx = mod.createEvaluationContext({
      startDate: new Date('2025-01-01'),
      endDate: new Date('2025-12-31'),
    });
    assert.equal(ctx.isFrozen, false);
    ctx.freeze();
    assert.equal(ctx.isFrozen, true);
  });

  it('seededRandom produces deterministic sequence', async () => {
    const mod = await import('../src/services/execution-context.ts');
    const ctx1 = mod.createBacktestContext({
      startDate: new Date('2025-01-01'),
      endDate: new Date('2025-12-31'),
      randomSeed: 12345,
    });
    const ctx2 = mod.createBacktestContext({
      startDate: new Date('2025-01-01'),
      endDate: new Date('2025-12-31'),
      randomSeed: 12345,
    });

    const seq1 = [ctx1.seededRandom(), ctx1.seededRandom(), ctx1.seededRandom()];
    const seq2 = [ctx2.seededRandom(), ctx2.seededRandom(), ctx2.seededRandom()];
    assert.deepEqual(seq1, seq2);
  });

  it('allowedDataSources filters correctly', async () => {
    const mod = await import('../src/services/execution-context.ts');
    const ctx = mod.createBacktestContext({
      startDate: new Date('2025-01-01'),
      endDate: new Date('2025-12-31'),
      allowedDataSources: ['markets', 'news'],
    });
    assert.equal(ctx.isDataSourceAllowed('markets'), true);
    assert.equal(ctx.isDataSourceAllowed('news'), true);
    assert.equal(ctx.isDataSourceAllowed('keywordGraph'), false);
  });
});

// ---------------------------------------------------------------------------
// Test 2: TemporalBarrier
// ---------------------------------------------------------------------------
describe('TemporalBarrier', () => {
  it('allows access at or before boundary', async () => {
    const { TemporalBarrier } = await import('../src/services/temporal-barrier.ts');
    const barrier = new TemporalBarrier(new Date('2025-06-15T12:00:00Z'));

    assert.equal(barrier.validateAccess(new Date('2025-06-15T11:00:00Z'), 'test'), true);
    assert.equal(barrier.validateAccess(new Date('2025-06-15T12:00:00Z'), 'test'), true);
    assert.equal(barrier.stats.violations, 0);
  });

  it('blocks access after boundary (non-strict)', async () => {
    const { TemporalBarrier } = await import('../src/services/temporal-barrier.ts');
    const barrier = new TemporalBarrier(new Date('2025-06-15T12:00:00Z'));

    const result = barrier.validateAccess(new Date('2025-06-15T13:00:00Z'), 'future-data');
    assert.equal(result, false);
    assert.equal(barrier.stats.violations, 1);
    assert.equal(barrier.stats.lastViolation?.source, 'future-data');
  });

  it('throws on violation in strict mode', async () => {
    const { TemporalBarrier, TemporalViolationError } = await import('../src/services/temporal-barrier.ts');
    const barrier = new TemporalBarrier(new Date('2025-06-15'), { strict: true });

    assert.throws(
      () => barrier.validateAccess(new Date('2025-06-16'), 'future-data'),
      (err) => err instanceof TemporalViolationError
    );
  });

  it('advanceTo moves boundary forward', async () => {
    const { TemporalBarrier } = await import('../src/services/temporal-barrier.ts');
    const barrier = new TemporalBarrier(new Date('2025-01-01'));

    barrier.advanceTo(new Date('2025-06-01'));
    assert.equal(barrier.boundary.toISOString(), new Date('2025-06-01').toISOString());

    // Forward is OK
    barrier.advanceTo(new Date('2025-12-01'));
    assert.equal(barrier.boundary.toISOString(), new Date('2025-12-01').toISOString());
  });

  it('advanceTo rejects backward movement', async () => {
    const { TemporalBarrier } = await import('../src/services/temporal-barrier.ts');
    const barrier = new TemporalBarrier(new Date('2025-06-01'));

    assert.throws(
      () => barrier.advanceTo(new Date('2025-01-01')),
      /Cannot move boundary backward/
    );
  });

  it('accepts string timestamps', async () => {
    const { TemporalBarrier } = await import('../src/services/temporal-barrier.ts');
    const barrier = new TemporalBarrier(new Date('2025-06-15'));

    assert.equal(barrier.validateAccess('2025-06-14T00:00:00Z', 'test'), true);
    assert.equal(barrier.validateAccess('2025-06-16T00:00:00Z', 'test'), false);

    barrier.advanceTo('2025-06-20');
    assert.equal(barrier.validateAccess('2025-06-18T00:00:00Z', 'test'), true);
  });

  it('onViolation handler is called', async () => {
    const { TemporalBarrier } = await import('../src/services/temporal-barrier.ts');
    const barrier = new TemporalBarrier(new Date('2025-06-15'));

    const violations = [];
    barrier.onViolation((v) => violations.push(v));

    barrier.validateAccess(new Date('2025-06-16'), 'test1');
    barrier.validateAccess(new Date('2025-06-17'), 'test2');

    assert.equal(violations.length, 2);
    assert.equal(violations[0].source, 'test1');
    assert.equal(violations[1].source, 'test2');
  });

  it('reset clears violations and stats', async () => {
    const { TemporalBarrier } = await import('../src/services/temporal-barrier.ts');
    const barrier = new TemporalBarrier(new Date('2025-01-01'));

    barrier.validateAccess(new Date('2025-06-01'), 'test');
    assert.equal(barrier.stats.violations, 1);

    barrier.reset(new Date('2025-06-01'));
    assert.equal(barrier.stats.violations, 0);
    assert.equal(barrier.stats.totalChecks, 0);
    assert.equal(barrier.boundary.toISOString(), new Date('2025-06-01').toISOString());
  });

  it('filterByBarrier filters timestamped items', async () => {
    const { TemporalBarrier, filterByBarrier } = await import('../src/services/temporal-barrier.ts');
    const barrier = new TemporalBarrier(new Date('2025-06-15'));

    const items = [
      { timestamp: '2025-06-14T00:00:00Z', value: 'past' },
      { timestamp: '2025-06-15T00:00:00Z', value: 'at' },
      { timestamp: '2025-06-16T00:00:00Z', value: 'future' },
    ];

    const filtered = filterByBarrier(items, barrier, 'test');
    assert.equal(filtered.length, 2);
    assert.equal(filtered[0].value, 'past');
    assert.equal(filtered[1].value, 'at');
  });

  it('createPassthroughBarrier allows everything', async () => {
    const { createPassthroughBarrier } = await import('../src/services/temporal-barrier.ts');
    const barrier = createPassthroughBarrier();
    assert.equal(barrier.validateAccess(new Date('9999-12-30'), 'test'), true);
  });
});

// ---------------------------------------------------------------------------
// Test 3: Walk-Forward Validation
// ---------------------------------------------------------------------------
describe('walk-forward', () => {
  it('generateWindows creates correct windows', async () => {
    const { generateWindows } = await import('../src/services/evaluation/walk-forward.ts');

    const windows = generateWindows({
      totalPeriod: { start: new Date('2025-01-01'), end: new Date('2025-12-31') },
      trainingWindowDays: 90,
      testWindowDays: 30,
      stepDays: 30,
    });

    assert.ok(windows.length > 0, 'Should produce at least one window');

    // First window
    assert.equal(windows[0].trainingStart.toISOString(), new Date('2025-01-01').toISOString());

    // Each window's test starts where training ends
    for (const w of windows) {
      assert.equal(w.testStart.toISOString(), w.trainingEnd.toISOString());
    }

    // Step size is 30 days
    if (windows.length >= 2) {
      const diff = windows[1].trainingStart.getTime() - windows[0].trainingStart.getTime();
      assert.equal(diff, 30 * 86400000);
    }
  });

  it('generateWindows returns empty for impossible config', async () => {
    const { generateWindows } = await import('../src/services/evaluation/walk-forward.ts');

    const windows = generateWindows({
      totalPeriod: { start: new Date('2025-01-01'), end: new Date('2025-02-01') },
      trainingWindowDays: 90,
      testWindowDays: 30,
      stepDays: 30,
    });

    assert.equal(windows.length, 0);
  });

  it('validateConfig catches invalid configs', async () => {
    const { validateConfig } = await import('../src/services/evaluation/walk-forward.ts');

    const errors = validateConfig({
      totalPeriod: { start: new Date('2025-12-31'), end: new Date('2025-01-01') },
      trainingWindowDays: -1,
      testWindowDays: 0,
      stepDays: 30,
    });

    assert.ok(errors.length >= 3, `Expected at least 3 errors, got ${errors.length}`);
  });

  it('validateConfig passes for valid config', async () => {
    const { validateConfig } = await import('../src/services/evaluation/walk-forward.ts');

    const errors = validateConfig({
      totalPeriod: { start: new Date('2025-01-01'), end: new Date('2025-12-31') },
      trainingWindowDays: 90,
      testWindowDays: 30,
      stepDays: 30,
    });

    assert.equal(errors.length, 0);
  });

  it('createTrainingContext creates proper context/barrier pair', async () => {
    const { createTrainingContext, generateWindows } = await import('../src/services/evaluation/walk-forward.ts');

    const windows = generateWindows({
      totalPeriod: { start: new Date('2025-01-01'), end: new Date('2025-12-31') },
      trainingWindowDays: 90,
      testWindowDays: 30,
      stepDays: 30,
    });

    const { context, barrier } = createTrainingContext(windows[0], 42);
    assert.equal(context.mode, 'backtest');
    assert.equal(context.isIsolated, true);
    assert.ok(barrier);
    // Barrier should start at training start
    assert.equal(barrier.boundary.toISOString(), new Date('2025-01-01').toISOString());
  });

  it('createTestContext creates frozen context', async () => {
    const { createTestContext, generateWindows } = await import('../src/services/evaluation/walk-forward.ts');

    const windows = generateWindows({
      totalPeriod: { start: new Date('2025-01-01'), end: new Date('2025-12-31') },
      trainingWindowDays: 90,
      testWindowDays: 30,
      stepDays: 30,
    });

    const { context, barrier } = createTestContext(windows[0]);
    assert.equal(context.mode, 'evaluation');
    assert.equal(context.isFrozen, true);
    assert.ok(barrier);
  });

  it('emptyMetrics returns zeroed metrics', async () => {
    const { emptyMetrics } = await import('../src/services/evaluation/walk-forward.ts');
    const m = emptyMetrics();
    assert.equal(m.avgConviction, 0);
    assert.equal(m.totalIdeas, 0);
    assert.equal(m.hitRate, 0);
  });

  it('averageMetrics computes correct averages', async () => {
    const { averageMetrics } = await import('../src/services/evaluation/walk-forward.ts');
    const avg = averageMetrics([
      { avgConviction: 60, totalIdeas: 10, takeProfitCount: 3, stopLossCount: 2, avgReturnPct: 5, hitRate: 0.6, temporalViolations: 0 },
      { avgConviction: 80, totalIdeas: 20, takeProfitCount: 7, stopLossCount: 4, avgReturnPct: 10, hitRate: 0.7, temporalViolations: 0 },
    ]);
    assert.equal(avg.avgConviction, 70);
    assert.equal(avg.totalIdeas, 15);
    assert.equal(avg.avgReturnPct, 7.5);
  });

  it('buildWalkForwardResult computes overfitRatio', async () => {
    const { buildWalkForwardResult } = await import('../src/services/evaluation/walk-forward.ts');
    const config = {
      totalPeriod: { start: new Date('2025-01-01'), end: new Date('2025-12-31') },
      trainingWindowDays: 90,
      testWindowDays: 30,
      stepDays: 30,
    };
    const windowResults = [
      {
        window: { index: 0, trainingStart: new Date('2025-01-01'), trainingEnd: new Date('2025-04-01'), testStart: new Date('2025-04-01'), testEnd: new Date('2025-05-01') },
        trainingMetrics: { avgConviction: 70, totalIdeas: 15, takeProfitCount: 5, stopLossCount: 3, avgReturnPct: 8, hitRate: 0.63, temporalViolations: 0 },
        testMetrics: { avgConviction: 65, totalIdeas: 12, takeProfitCount: 4, stopLossCount: 3, avgReturnPct: 4, hitRate: 0.57, temporalViolations: 0 },
        trainingFrameCount: 90,
        testFrameCount: 30,
      },
    ];

    const result = buildWalkForwardResult(config, windowResults, 5000);
    assert.equal(result.overfitRatio, 2); // 8/4 = 2
    assert.equal(result.durationMs, 5000);
    assert.equal(result.aggregateTestMetrics.avgReturnPct, 4);
    assert.equal(result.aggregateTrainingMetrics.avgReturnPct, 8);
  });
});

// ---------------------------------------------------------------------------
// Test 4: Integration — State isolation end-to-end
// ---------------------------------------------------------------------------
describe('state isolation integration', () => {
  it('backtest context has independent state from live', async () => {
    const { InMemoryStateStore } = await import('../src/services/state/in-memory-state-store.ts');
    const { createLiveContext, createBacktestContext } = await import('../src/services/execution-context.ts');

    const liveStore = new InMemoryStateStore('live');
    await liveStore.set('testKey', 'liveValue');

    const liveCtx = createLiveContext(liveStore);
    const backtestCtx = createBacktestContext({
      startDate: new Date('2025-01-01'),
      endDate: new Date('2025-12-31'),
    });

    // Backtest state should be empty (no bleed from live)
    const backtestVal = await backtestCtx.stateStore.get('testKey');
    assert.equal(backtestVal, null);

    // Setting in backtest doesn't affect live
    await backtestCtx.stateStore.set('testKey', 'backtestValue');
    const liveVal = await liveCtx.stateStore.get('testKey');
    assert.equal(liveVal, 'liveValue');
  });

  it('snapshot/restore preserves live state across backtest', async () => {
    const { InMemoryStateStore } = await import('../src/services/state/in-memory-state-store.ts');

    const liveStore = new InMemoryStateStore('live');
    await liveStore.set('weights', { alpha: 0.5, beta: 0.3 });
    await liveStore.set('observations', 100);

    // Snapshot live state
    const snapshot = await liveStore.snapshot();

    // Simulate backtest: mutate state
    await liveStore.set('weights', { alpha: 0.9, beta: 0.1 });
    await liveStore.set('observations', 200);
    const mutated = await liveStore.get('observations');
    assert.equal(mutated, 200);

    // Restore live state
    await liveStore.restore(snapshot);
    const restored = await liveStore.get('observations');
    assert.equal(restored, 100);
    const restoredWeights = await liveStore.get('weights');
    assert.deepEqual(restoredWeights, { alpha: 0.5, beta: 0.3 });
  });

  it('temporal barrier prevents look-ahead in simulated backtest flow', async () => {
    const { TemporalBarrier } = await import('../src/services/temporal-barrier.ts');
    const barrier = new TemporalBarrier(new Date('2025-03-01'), { strict: true });

    // Simulate advancing through frames
    const frames = [
      { timestamp: '2025-01-15', data: 'jan' },
      { timestamp: '2025-02-15', data: 'feb' },
      { timestamp: '2025-03-15', data: 'mar' },
      { timestamp: '2025-04-15', data: 'apr' },
    ];

    // Frame 1 & 2 are accessible
    assert.equal(barrier.validateAccess(frames[0].timestamp, 'frame'), true);
    assert.equal(barrier.validateAccess(frames[1].timestamp, 'frame'), true);

    // Frame 3 is past boundary — should throw in strict mode
    assert.throws(
      () => barrier.validateAccess(frames[2].timestamp, 'frame'),
      /TemporalBarrier violation/
    );

    // Advance boundary to include March
    barrier.advanceTo(new Date('2025-04-01'));
    assert.equal(barrier.validateAccess(frames[2].timestamp, 'frame'), true);

    // Frame 4 is still past boundary
    assert.throws(
      () => barrier.validateAccess(frames[3].timestamp, 'frame'),
      /TemporalBarrier violation/
    );

    // Total: 4 checks, 2 violations
    assert.equal(barrier.stats.totalChecks, 5);
    assert.equal(barrier.stats.violations, 2);
  });
});

// ---------------------------------------------------------------------------
// Test 5: Structure verification
// ---------------------------------------------------------------------------
describe('phase 3 structure', () => {
  it('execution-context.ts exists and is reasonable size', async () => {
    const fs = await import('node:fs');
    const content = fs.readFileSync(repoPath('src', 'services', 'execution-context.ts'), 'utf-8');
    const lines = content.split('\n').length;
    assert.ok(lines >= 50, `execution-context.ts should be >= 50 lines, got ${lines}`);
    assert.ok(lines <= 300, `execution-context.ts should be <= 300 lines, got ${lines}`);
  });

  it('temporal-barrier.ts exists and is reasonable size', async () => {
    const fs = await import('node:fs');
    const content = fs.readFileSync(repoPath('src', 'services', 'temporal-barrier.ts'), 'utf-8');
    const lines = content.split('\n').length;
    assert.ok(lines >= 50, `temporal-barrier.ts should be >= 50 lines, got ${lines}`);
    assert.ok(lines <= 300, `temporal-barrier.ts should be <= 300 lines, got ${lines}`);
  });

  it('walk-forward.ts exists and is reasonable size', async () => {
    const fs = await import('node:fs');
    const content = fs.readFileSync(repoPath('src', 'services', 'evaluation', 'walk-forward.ts'), 'utf-8');
    const lines = content.split('\n').length;
    assert.ok(lines >= 100, `walk-forward.ts should be >= 100 lines, got ${lines}`);
    assert.ok(lines <= 400, `walk-forward.ts should be <= 400 lines, got ${lines}`);
  });
});
