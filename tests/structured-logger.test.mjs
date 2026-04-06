import test from 'node:test';
import assert from 'node:assert/strict';

import { createLogger } from '../scripts/_shared/structured-logger.mjs';

test('structured logger emits JSONL entries and aggregates metrics', () => {
  let output = '';
  const logger = createLogger('test-component', {
    stream: {
      write(chunk) {
        output += String(chunk);
      },
    },
  });

  logger.info('hello', { phase: 2 });
  logger.metric('task.duration_ms', 120, { task: 'alpha' });
  logger.metric('task.duration_ms', 80, { task: 'alpha' });

  const lines = output.trim().split('\n').map((line) => JSON.parse(line));
  assert.equal(lines[0].component, 'test-component');
  assert.equal(lines[0].level, 'info');
  assert.equal(lines[1].level, 'metric');

  const snapshot = logger.getMetrics();
  assert.equal(snapshot.component, 'test-component');
  assert.equal(snapshot.metrics.length, 1);
  assert.equal(snapshot.metrics[0].name, 'task.duration_ms');
  assert.equal(snapshot.metrics[0].count, 2);
  assert.equal(snapshot.metrics[0].sum, 200);
  assert.equal(snapshot.metrics[0].avg, 100);
});
