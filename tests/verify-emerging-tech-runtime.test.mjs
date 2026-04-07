import test from 'node:test';
import assert from 'node:assert/strict';

import {
  evaluateRuntimeSummary,
  parseArgs,
} from '../scripts/verify-emerging-tech-runtime.mjs';

test('verify-emerging-tech-runtime parseArgs reads required flags', () => {
  const defaults = parseArgs([]);
  assert.equal(defaults.requireTopics, false);
  assert.equal(defaults.requireReports, false);

  const parsed = parseArgs(['--require-topics', '--require-reports']);
  assert.equal(parsed.requireTopics, true);
  assert.equal(parsed.requireReports, true);
});

test('verify-emerging-tech-runtime evaluator fails when required payloads are missing', () => {
  const failures = evaluateRuntimeSummary({
    healthOk: true,
    topicsOk: true,
    timelineOk: true,
    reportsOk: true,
    digestOk: true,
    topicCount: 0,
    reportCount: 0,
  }, {
    requireTopics: true,
    requireReports: true,
  });

  assert.deepEqual(failures, [
    'topics required but none returned',
    'reports required but none returned',
  ]);
});
