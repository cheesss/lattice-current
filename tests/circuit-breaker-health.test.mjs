import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  createCircuitBreaker,
  getCircuitBreakerHealthReport,
  clearAllCircuitBreakers,
  onHealthChange,
  checkHealthTransition,
} from '../src/utils/circuit-breaker.ts';

beforeEach(() => {
  clearAllCircuitBreakers();
});

describe('CircuitBreaker Health Report', () => {
  it('reports healthy when no breakers exist', () => {
    const report = getCircuitBreakerHealthReport();
    assert.equal(report.level, 'healthy');
    assert.equal(report.total, 0);
    assert.equal(report.cascadeDetected, false);
  });

  it('reports healthy when all breakers are ok', () => {
    const b1 = createCircuitBreaker({ name: 'test-a' });
    const b2 = createCircuitBreaker({ name: 'test-b' });
    b1.recordSuccess('data-a');
    b2.recordSuccess('data-b');

    const report = getCircuitBreakerHealthReport();
    assert.equal(report.level, 'healthy');
    assert.equal(report.healthy, 2);
    assert.equal(report.onCooldown, 0);
  });

  it('reports degraded when 1 breaker is on cooldown', () => {
    const b1 = createCircuitBreaker({ name: 'test-a', maxFailures: 1, cooldownMs: 60000 });
    const b2 = createCircuitBreaker({ name: 'test-b' });
    b1.recordFailure('error');
    b2.recordSuccess('data-b');

    const report = getCircuitBreakerHealthReport();
    assert.equal(report.level, 'degraded');
    assert.equal(report.onCooldown, 1);
    assert.deepEqual(report.cooldownBreakers, ['test-a']);
  });

  it('reports critical (cascade) when 3+ breakers are on cooldown', () => {
    for (const name of ['api-a', 'api-b', 'api-c']) {
      const b = createCircuitBreaker({ name, maxFailures: 1, cooldownMs: 60000 });
      b.recordFailure('timeout');
    }

    const report = getCircuitBreakerHealthReport();
    assert.equal(report.level, 'critical');
    assert.equal(report.cascadeDetected, true);
    assert.equal(report.onCooldown, 3);
  });

  it('recovers from critical to healthy', () => {
    const breakers = [];
    for (const name of ['api-a', 'api-b', 'api-c']) {
      const b = createCircuitBreaker({ name, maxFailures: 1, cooldownMs: 100 });
      b.recordFailure('error');
      breakers.push(b);
    }

    let report = getCircuitBreakerHealthReport();
    assert.equal(report.level, 'critical');

    // Recover all
    for (const b of breakers) b.recordSuccess('recovered');
    report = getCircuitBreakerHealthReport();
    assert.equal(report.level, 'healthy');
    assert.equal(report.cascadeDetected, false);
  });
});

describe('Health Change Listeners', () => {
  it('fires when level transitions', () => {
    const transitions = [];
    const unsubscribe = onHealthChange((report) => {
      transitions.push(report.level);
    });

    // Create a breaker and push it into cooldown → should trigger degraded
    const b = createCircuitBreaker({ name: 'listener-test', maxFailures: 1, cooldownMs: 60000 });

    // Initial state is healthy, recordFailure triggers cooldown + checkHealthTransition
    b.recordFailure('error');

    assert.ok(transitions.length >= 1, 'Should have at least one transition');
    assert.equal(transitions[transitions.length - 1], 'degraded');

    // Recover → should trigger healthy
    b.recordSuccess('data');
    assert.equal(transitions[transitions.length - 1], 'healthy');

    unsubscribe();
  });

  it('does not fire when level stays the same', () => {
    const transitions = [];
    const unsubscribe = onHealthChange((report) => {
      transitions.push(report.level);
    });

    // Two successes in a row — level stays healthy
    const b1 = createCircuitBreaker({ name: 'same-a' });
    const b2 = createCircuitBreaker({ name: 'same-b' });
    b1.recordSuccess('a');
    b2.recordSuccess('b');
    checkHealthTransition();
    checkHealthTransition();

    // No transitions expected (was already healthy)
    assert.equal(transitions.length, 0, 'No transitions expected when level stays the same');

    unsubscribe();
  });

  it('unsubscribe removes listener', () => {
    let callCount = 0;
    const unsubscribe = onHealthChange(() => { callCount++; });
    unsubscribe();

    const b = createCircuitBreaker({ name: 'unsub-test', maxFailures: 1, cooldownMs: 60000 });
    b.recordFailure('error');

    assert.equal(callCount, 0, 'Listener should not fire after unsubscribe');
  });
});
