import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  getMemorySnapshot,
  getMemoryPressureLevel,
  getPollIntervalMultiplier,
  shouldDeferNonEssential,
  onMemoryPressureChange,
  startMemoryMonitoring,
  stopMemoryMonitoring,
} from '../src/services/memory-pressure.ts';

afterEach(() => {
  stopMemoryMonitoring();
});

describe('Memory Pressure Detection (Phase 4.2)', () => {

  it('returns a valid snapshot even without Performance.memory API', () => {
    const snapshot = getMemorySnapshot();
    assert.equal(typeof snapshot.usedHeapBytes, 'number');
    assert.equal(typeof snapshot.heapLimitBytes, 'number');
    assert.equal(typeof snapshot.utilisation, 'number');
    assert.ok(snapshot.utilisation >= 0 && snapshot.utilisation <= 1);
    assert.ok(['normal', 'warning', 'critical'].includes(snapshot.level));
    assert.equal(typeof snapshot.timestamp, 'number');
    assert.equal(typeof snapshot.apiAvailable, 'boolean');
  });

  it('defaults to normal pressure level', () => {
    assert.equal(getMemoryPressureLevel(), 'normal');
  });

  it('poll multiplier is 1 at normal level', () => {
    assert.equal(getPollIntervalMultiplier(), 1);
  });

  it('shouldDeferNonEssential is false at normal level', () => {
    assert.equal(shouldDeferNonEssential(), false);
  });

  it('onMemoryPressureChange returns an unsubscribe function', () => {
    let called = false;
    const unsub = onMemoryPressureChange(() => { called = true; });
    assert.equal(typeof unsub, 'function');
    unsub();
    assert.equal(called, false); // shouldn't have been called
  });

  it('startMemoryMonitoring does not throw', () => {
    assert.doesNotThrow(() => startMemoryMonitoring());
  });

  it('stopMemoryMonitoring does not throw after start', () => {
    startMemoryMonitoring();
    assert.doesNotThrow(() => stopMemoryMonitoring());
  });

  it('double startMemoryMonitoring is safe', () => {
    startMemoryMonitoring();
    assert.doesNotThrow(() => startMemoryMonitoring());
    stopMemoryMonitoring();
  });

  it('stopMemoryMonitoring without start is safe', () => {
    assert.doesNotThrow(() => stopMemoryMonitoring());
  });
});
