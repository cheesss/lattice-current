import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  __test,
  runMechanismSeedDaemonCycle,
} from '../scripts/run-mechanism-seed-daemon-cycle.mjs';

test('mechanism seed daemon cycle builds bounded no-enqueue steps', () => {
  const steps = __test.buildSteps({
    limit: 25,
    source: 'all',
    statuses: ['review_ready', 'needs_evidence'],
    auditStatuses: ['review_ready', 'needs_evidence', 'evidence_running'],
    applyGeneration: true,
    artifactRoot: 'data/runtime',
    timeoutMs: 900_000,
  });
  const names = steps.map((step) => step.name);
  const allArgs = steps.flatMap((step) => step.args).join(' ');

  assert.deepEqual(names, [
    'seed-generation',
    'phase-c-audit',
    'provider-gap-review',
    'provider-adapter-proposals',
    'self-improvement',
  ]);
  assert.match(steps[0].script, /run-mechanism-seed-generation\.mjs/);
  assert.equal(allArgs.includes('--enqueue-evidence'), false);
  assert.equal(allArgs.includes('canonical'), false);
  assert.equal(allArgs.includes('provider-adapter-proposals.latest.json'), true);
});

test('mechanism seed daemon cycle writes state and steps with lock discipline', async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'lattice-seed-daemon-'));
  const stateFile = path.join(tmp, 'state.json');
  const stepsFile = path.join(tmp, 'steps.jsonl');
  const lockFile = path.join(tmp, 'cycle.lock');
  const calls = [];
  try {
    const result = await runMechanismSeedDaemonCycle({
      limit: 3,
      source: 'ontology',
      statuses: ['review_ready'],
      auditStatuses: ['review_ready'],
      applyGeneration: false,
      artifactRoot: tmp,
      stateFile,
      stepsFile,
      lockFile,
      lockStaleMinutes: 5,
      timeoutMs: 60_000,
      runStep: async (step) => {
        calls.push(step);
        return {
          ok: true,
          mode: step.name,
          dryRun: step.name === 'seed-generation',
          artifactPath: path.join(tmp, `${step.name}.json`),
          proposalCount: step.name.includes('proposal') ? 1 : 0,
          seedCount: 3,
        };
      },
    });
    const state = JSON.parse(await readFile(stateFile, 'utf8'));
    const stepLines = (await readFile(stepsFile, 'utf8')).trim().split(/\r?\n/);

    assert.equal(result.ok, true);
    assert.equal(result.stepCount, 5);
    assert.equal(calls.length, 5);
    assert.equal(Object.keys(state.steps).length, 5);
    assert.equal(stepLines.length, 5);
    assert.equal(result.boundaries.approvalQueueWrites, 0);
    assert.equal(result.boundaries.providerActivationWrites, 0);
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});

test('mechanism seed daemon cycle terminal state skips exhausted steps unless forced', async () => {
  const state = {
    steps: {
      'provider-adapter-proposals': {
        exhausted: true,
        consecutiveFailures: 3,
      },
    },
  };

  assert.equal(__test.stepExhausted(state, 'provider-adapter-proposals', {}), true);
  assert.equal(__test.stepExhausted(state, 'provider-adapter-proposals', { force: true }), false);
});
