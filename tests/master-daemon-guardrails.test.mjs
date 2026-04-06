import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../scripts/master-daemon.mjs', import.meta.url), 'utf-8');

test('master daemon includes circuit breaker and pending outcome resolution', () => {
  assert.match(source, /CIRCUIT_BREAKER_FAILS/);
  assert.match(source, /computeCircuitBackoffMs/);
  assert.match(source, /checkPendingOutcomes/);
  assert.match(source, /dashboard-health/);
  assert.match(source, /db-health/);
  assert.match(source, /daily-backup/);
  assert.match(source, /duckdb-sync/);
  assert.match(source, /data-quality/);
  assert.match(source, /sendAlert/);
  assert.match(source, /unhandledRejection/);
  assert.match(source, /createLogger/);
  assert.match(source, /task\.duration_ms/);
});
