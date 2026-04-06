import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  createCircuitBreaker,
  clearAllCircuitBreakers,
  getCircuitBreakerHealthReport,
  isDegradedMode,
} from '../src/utils/circuit-breaker.ts';

beforeEach(() => {
  clearAllCircuitBreakers();
});

describe('CircuitBreaker — Cache TTL Extension (Phase 4.3)', () => {

  it('extends cache TTL during cooldown', async () => {
    const breaker = createCircuitBreaker({
      name: 'ttl-test',
      maxFailures: 1,
      cooldownMs: 60_000,
      cacheTtlMs: 10_000,
    });

    // Record some data then trigger cooldown
    await breaker.execute(async () => 'initial-data', 'default');
    breaker.recordFailure('test error');

    // After cooldown entry, the cache should still be accessible
    // even though originalTTL (10s) would normally expire
    assert.ok(breaker.isOnCooldown());

    // The getCached should still return data during extended TTL
    const cached = breaker.getCachedOrDefault('fallback');
    assert.equal(cached, 'initial-data');
  });

  it('restores original cache TTL after recovery', async () => {
    const breaker = createCircuitBreaker({
      name: 'ttl-restore-test',
      maxFailures: 1,
      cooldownMs: 1, // 1ms cooldown for testing
      cacheTtlMs: 10_000,
    });

    breaker.recordFailure('error');
    assert.ok(breaker.isOnCooldown());

    // Wait for cooldown to expire
    await new Promise(r => setTimeout(r, 25));

    // Recovery: record success
    breaker.recordSuccess('fresh-data');
    assert.ok(!breaker.isOnCooldown());
  });

  it('fires recovery callbacks when breaker recovers from cooldown', () => {
    const breaker = createCircuitBreaker({
      name: 'recovery-callback-test',
      maxFailures: 1,
      cooldownMs: 60_000, // long cooldown so it's still active
    });

    let recoveryFired = false;
    breaker.onRecovery(() => {
      recoveryFired = true;
    });

    breaker.recordFailure('error');
    assert.ok(breaker.isOnCooldown());
    assert.equal(recoveryFired, false);

    // Recovery while still on cooldown
    breaker.recordSuccess('recovered');
    assert.equal(recoveryFired, true);
  });

  it('unsubscribe removes recovery callback', () => {
    const breaker = createCircuitBreaker({
      name: 'unsub-test',
      maxFailures: 1,
      cooldownMs: 1,
    });

    let called = false;
    const unsub = breaker.onRecovery(() => { called = true; });
    unsub();

    breaker.recordFailure('error');
    breaker.recordSuccess('recovered');
    assert.equal(called, false);
  });
});

describe('CircuitBreaker — Degraded Mode (Phase 4.3)', () => {

  it('activates degraded mode when 3+ breakers enter cooldown', () => {
    const b1 = createCircuitBreaker({ name: 'deg-a', maxFailures: 1, cooldownMs: 60_000 });
    const b2 = createCircuitBreaker({ name: 'deg-b', maxFailures: 1, cooldownMs: 60_000 });
    const b3 = createCircuitBreaker({ name: 'deg-c', maxFailures: 1, cooldownMs: 60_000 });

    assert.equal(isDegradedMode(), false);

    b1.recordFailure('err');
    b2.recordFailure('err');
    assert.equal(isDegradedMode(), false);

    b3.recordFailure('err');
    assert.equal(isDegradedMode(), true);

    const report = getCircuitBreakerHealthReport();
    assert.equal(report.level, 'critical');
    assert.equal(report.cascadeDetected, true);
  });

  it('deactivates degraded mode when breakers recover', () => {
    const b1 = createCircuitBreaker({ name: 'rec-a', maxFailures: 1, cooldownMs: 60_000 });
    const b2 = createCircuitBreaker({ name: 'rec-b', maxFailures: 1, cooldownMs: 60_000 });
    const b3 = createCircuitBreaker({ name: 'rec-c', maxFailures: 1, cooldownMs: 60_000 });

    b1.recordFailure('err');
    b2.recordFailure('err');
    b3.recordFailure('err');
    assert.equal(isDegradedMode(), true);

    // Recover one breaker — should drop below cascade threshold
    b1.recordSuccess('data');
    assert.equal(isDegradedMode(), false);
  });
});
