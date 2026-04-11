import test from 'node:test';
import assert from 'node:assert/strict';

import {
  clearStructuredLogHistory,
  createLogger,
  getStructuredLogHistory,
} from '../src/utils/logger.ts';
import {
  createManagedPgPool,
  resolveNasPgConfig,
} from '../src/utils/pg-pool.ts';
import { createWhereBuilder } from '../scripts/_shared/query-builder.mjs';

test('structured logger stores contextual entries by module', () => {
  clearStructuredLogHistory();
  const logger = createLogger('unit-test');
  logger.info('hello', { phase: 1 });
  logger.warn('warned', { phase: 2 });

  const entries = getStructuredLogHistory('unit-test');
  assert.equal(entries.length, 2);
  assert.equal(entries[0].module, 'unit-test');
  assert.equal(entries[1].level, 'warn');
  assert.deepEqual(entries[0].context, { phase: 1 });
});

test('managed pg pool tracks circuit state without opening a real pool', () => {
  const pool = createManagedPgPool({
    name: 'pg-pool-test',
    maxFailures: 2,
    cooldownMs: 60_000,
  });

  pool.recordFailure(new Error('first failure'));
  let state = pool.getCircuitState();
  assert.equal(state.consecutiveFailures, 1);
  assert.equal(state.disabledUntil, 0);

  pool.recordFailure(new Error('second failure'));
  state = pool.getCircuitState();
  assert.equal(state.consecutiveFailures, 2);
  assert.equal(state.disabledUntil > Date.now(), true);

  pool.recordSuccess();
  state = pool.getCircuitState();
  assert.equal(state.consecutiveFailures, 0);
  assert.equal(state.disabledUntil, 0);
});

test('resolveNasPgConfig respects overrides', () => {
  const config = resolveNasPgConfig({ max: 9, allowExitOnIdle: false });
  assert.equal(config.max, 9);
  assert.equal(config.allowExitOnIdle, false);
  assert.equal(typeof config.host, 'string');
});

test('query builder generates parameterized where clauses with stable ordering', () => {
  const builder = createWhereBuilder(['a.embedding IS NOT NULL']);
  builder.addValue('2026-04-10T00:00:00Z', (placeholder) => `a.published_at >= ${placeholder}::timestamptz`);
  builder.addValue(25, (placeholder) => `a.priority >= ${placeholder}`);
  const built = builder.build();

  assert.equal(
    built.whereClause,
    'WHERE a.embedding IS NOT NULL AND a.published_at >= $1::timestamptz AND a.priority >= $2',
  );
  assert.deepEqual(built.params, ['2026-04-10T00:00:00Z', 25]);
});
