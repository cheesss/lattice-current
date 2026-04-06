import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import * as path from 'node:path';
import { mkdtemp, readFile, rm } from 'node:fs/promises';

import {
  resolveWeightsPath,
  loadWeightsSync,
  saveWeights,
} from '../src/services/investment/adaptive-params/weight-learner.node.ts';
import {
  closeRagPool,
  getRagRuntimeStatus,
} from '../src/services/investment/rag-retriever.ts';

const ENV_KEYS = [
  'RAG_PG_URL',
  'INTEL_PG_URL',
  'RAG_PG_HOST',
  'RAG_PG_PORT',
  'RAG_PG_DATABASE',
  'RAG_PG_USER',
  'RAG_PG_PASSWORD',
  'PG_HOST',
  'PG_PORT',
  'PG_DATABASE',
  'PG_USER',
  'PG_PASSWORD',
  'PGDATABASE',
  'PGUSER',
  'PGPASSWORD',
];

const savedEnv = new Map(ENV_KEYS.map((key) => [key, process.env[key]]));

afterEach(async () => {
  for (const [key, value] of savedEnv.entries()) {
    if (typeof value === 'string') process.env[key] = value;
    else delete process.env[key];
  }
  await closeRagPool();
});

describe('phase 1 hardening', () => {
  it('resolves relative weight paths against the project root', () => {
    const resolved = resolveWeightsPath('data/learned_meta_weights.json');
    assert.equal(path.isAbsolute(resolved), true);
    assert.match(resolved, /lattice-current-fix[\\/]data[\\/]learned_meta_weights\.json$/);
  });

  it('rejects non-finite weight vectors during save/load', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'wm-weight-'));
    const file = path.join(dir, 'weights.json');

    await assert.rejects(
      saveWeights(file, {
        featureNames: ['a'],
        weights: [Number.NaN],
        bias: 0,
      }),
      /non-finite/i,
    );

    await rm(dir, { recursive: true, force: true });
  });

  it('round-trips finite weight vectors via absolute paths', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'wm-weight-'));
    const file = path.join(dir, 'weights.json');
    const model = {
      featureNames: ['a', 'b'],
      weights: [0.25, -0.5],
      bias: 0.1,
    };

    await saveWeights(file, model);
    const raw = await readFile(file, 'utf8');
    assert.match(raw, /"bias": 0\.1/);

    const loaded = loadWeightsSync(file);
    assert.deepEqual(loaded, model);

    await rm(dir, { recursive: true, force: true });
  });

  it('reports RAG runtime as disabled when database config is missing', () => {
    for (const key of ENV_KEYS) delete process.env[key];
    const status = getRagRuntimeStatus();
    assert.equal(status.enabled, false);
    assert.equal(status.databaseConfigured, false);
    assert.match(String(status.reason || ''), /database config is missing/i);
  });
});
