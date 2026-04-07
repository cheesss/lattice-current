import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../scripts/proposal-executor.mjs', import.meta.url), 'utf8');

test('proposal executor includes retry and dead-letter queues', () => {
  assert.match(source, /failed-proposals\.json/);
  assert.match(source, /dead-proposals\.json/);
  assert.match(source, /MAX_RETRIES/);
  assert.match(source, /movedToDeadQueue/);
  assert.match(source, /pathToFileURL/);
  assert.match(source, /handleBackfillSource/);
  assert.match(source, /ensureAutomationSchema/);
  assert.match(source, /queueForApproval/);
  assert.match(source, /backfill-source/);
  assert.match(source, /isTrustedFeedUrl/);
  assert.match(source, /evaluateAndRegisterFeed/);
});
