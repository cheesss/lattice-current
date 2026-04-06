import test from 'node:test';
import assert from 'node:assert/strict';

import {
  clearPipelineLog,
  getPipelineMetrics,
  logPipelineEvent,
} from '../src/services/investment/pipeline-logger.ts';

test('pipeline logger derives aggregate metrics from staged events', () => {
  clearPipelineLog();
  logPipelineEvent('eventCandidates', 'info', 'built', {
    durationMs: 42,
    context: { candidateCount: 12 },
  });
  logPipelineEvent('metaAdmission', 'info', 'admission', {
    durationMs: 18,
    context: { acceptedCount: 3, watchCount: 2, rejectedCount: 1 },
  });
  logPipelineEvent('riskGate', 'warn', 'reduced', {
    durationMs: 8,
    context: { passedCount: 2 },
  });
  logPipelineEvent('persist', 'error', 'failed', {
    durationMs: 5,
    context: { degraded: true },
  });

  const metrics = getPipelineMetrics();
  assert.equal(metrics.totalEntries, 4);
  assert.equal(metrics.errorCount, 1);
  assert.equal(metrics.warningCount, 1);
  assert.equal(metrics.acceptedRate, 50);
  assert.ok(metrics.avgProcessingMs > 0);
  assert.ok(metrics.stageMetrics.some((entry) => entry.stage === 'metaAdmission'));
});
