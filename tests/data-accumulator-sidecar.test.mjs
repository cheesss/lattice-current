import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  drainPendingImports,
  importToSidecar,
  recordPendingImport,
  sidecarPost,
  triggerReplay,
} from '../scripts/data-accumulator.mjs';

async function withServer(handler, fn) {
  const server = createServer(handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  try {
    return await fn(port);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test('sidecar unreachable records pending import with explicit error', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'lattice-acc-sidecar-'));
  try {
    const filePath = path.join(dir, 'raw.json');
    await writeFile(filePath, '{"ok":true}\n', 'utf8');
    const state = {};
    const response = await importToSidecar(filePath, 'test-dataset', 'test-provider', state, { port: 9, timeoutMs: 200 });

    assert.equal(response.ok, false);
    assert.equal(response.error, 'sidecar_unreachable');
    assert.equal(state.pendingImports.length, 1);
    assert.equal(state.pendingImports[0].datasetId, 'test-dataset');
    assert.equal(state.pendingImports[0].lastError, 'sidecar_unreachable');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('HTTP 423 busy lock is a retryable sidecar import failure', async () => {
  await withServer((req, res) => {
    res.statusCode = 423;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ ok: false, error: 'duckdb lock busy' }));
  }, async (port) => {
    const response = await sidecarPost('/api/local-intelligence-import', { filePath: 'x' }, { port, timeoutMs: 500 });
    assert.equal(response.ok, false);
    assert.equal(response.error, 'busy_lock');
    assert.equal(response.retryable, true);
  });
});

test('successful pending import drain removes imported file', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'lattice-acc-sidecar-'));
  try {
    const filePath = path.join(dir, 'raw.json');
    await writeFile(filePath, '{"ok":true}\n', 'utf8');
    const state = { pendingImports: [] };
    recordPendingImport(state, {
      filePath,
      datasetId: 'test-dataset',
      provider: 'test-provider',
      nextAttemptAt: new Date(Date.now() - 1_000).toISOString(),
    });

    await withServer((req, res) => {
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ ok: true, result: { rawRecordCount: 1, frameCount: 1 } }));
    }, async (port) => {
      const summary = await drainPendingImports(state, { port, timeoutMs: 500, limit: 10 });
      assert.equal(summary.ok, true);
      assert.equal(summary.imported, 1);
      assert.equal(state.pendingImports.length, 0);
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('replay skipped reason is explicit when sidecar is busy', async () => {
  const state = {};
  await withServer((req, res) => {
    res.statusCode = 423;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ ok: false, error: 'duckdb lock busy' }));
  }, async (port) => {
    const result = await triggerReplay(state, { port, timeoutMs: 500 });
    assert.equal(result.ok, false);
    assert.equal(result.status, 'replay_skipped_sidecar_busy_lock');
    assert.equal(state.lastReplay.status, 'replay_skipped_sidecar_busy_lock');
  });
});
