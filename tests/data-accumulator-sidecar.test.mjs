import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  classifySidecarFailure,
  cleanupImportedRawFile,
  cleanupSuccessfulImportFiles,
  drainPendingImports,
  importToSidecar,
  recordPendingImport,
  sidecarGet,
  sidecarPost,
  triggerReplay,
} from '../scripts/data-accumulator.mjs';
import { checkSidecar } from '../scripts/repair-accumulator-import-replay.mjs';

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

test('postgres config failures are not misclassified as busy locks', () => {
  const result = classifySidecarFailure({
    statusCode: 502,
    error: 'Error: postgres config required',
    bodyPreview: 'at withDbJobLock (scripts/intelligence-job.mjs:52:18)',
  });
  assert.equal(result.code, 'postgres_config_missing');
  assert.equal(result.retryable, false);
});

test('sidecar GET health can probe local intelligence import endpoint', async () => {
  await withServer((req, res) => {
    assert.equal(req.method, 'GET');
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ ok: true, datasets: [{ datasetId: 'demo' }] }));
  }, async (port) => {
    const response = await sidecarGet('/api/local-intelligence-import', { port, timeoutMs: 500 });
    assert.equal(response.ok, true);
    assert.equal(response.parsed.datasets.length, 1);
  });
});

test('repair preflight treats GET dataset listing as reachable', async () => {
  await withServer((req, res) => {
    assert.equal(req.method, 'GET');
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ ok: true, datasets: [{ datasetId: 'demo' }] }));
  }, async (port) => {
    const result = await checkSidecar({ port, timeoutMs: 500 });
    assert.equal(result.ok, true);
    assert.equal(result.status, 'reachable');
    assert.equal(result.datasetCount, 1);
  });
});

test('repair apply forwards postgres sync into pending import drain', async () => {
  const source = await readFile(new URL('../scripts/repair-accumulator-import-replay.mjs', import.meta.url), 'utf8');
  assert.match(source, /drainPendingImports\(state, \{ limit, postgresSync, cleanupImportedRaw, cleanupRootDir: rootDir \}\)/);
  assert.match(source, /summary\.imported \+= Number\(pendingDrain\.imported \|\| 0\)/);
});

test('import can explicitly request NAS postgres sync without auto-accepting evidence', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'lattice-acc-sidecar-'));
  try {
    const filePath = path.join(dir, 'raw.json');
    await writeFile(filePath, '{"ok":true}\n', 'utf8');
    let requestPayload = null;
    const state = {};
    await withServer((req, res) => {
      let body = '';
      req.on('data', (chunk) => { body += chunk; });
      req.on('end', () => {
        requestPayload = JSON.parse(body);
        res.statusCode = 200;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({
          ok: true,
          result: { datasetId: 'test-dataset', rawRecordCount: 1, frameCount: 1 },
          postgresSyncResult: { ok: true, upserted: 1 },
        }));
      });
    }, async (port) => {
      const response = await importToSidecar(filePath, 'test-dataset', 'test-provider', state, {
        port,
        timeoutMs: 500,
        postgresSync: true,
        pgConfig: { host: 'nas.local', port: 5433, database: 'lattice', user: 'u', password: 'p' },
      });
      assert.equal(response.ok, true);
      assert.equal(requestPayload.postgresSync, true);
      assert.equal(requestPayload.pgConfig.host, 'nas.local');
      assert.equal(state.lastSuccessfulImports[0].postgresSyncRequested, true);
      assert.deepEqual(state.lastSuccessfulImports[0].postgresSyncResult, { ok: true, upserted: 1 });
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
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
      assert.deepEqual(summary.importedDatasetIds, ['test-dataset']);
      assert.equal(state.pendingImports.length, 0);
      assert.equal(state.lastSuccessfulImports.length, 1);
      assert.equal(state.lastSuccessfulImports[0].datasetId, 'test-dataset');
      assert.equal(state.lastSuccessfulImports[0].frameCount, 1);
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('NAS-synced import cleanup deletes only files inside cleanup root', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'lattice-acc-cleanup-'));
  try {
    const filePath = path.join(dir, 'raw.json');
    await writeFile(filePath, '{"ok":true}\n', 'utf8');
    const state = {};

    const cleanup = cleanupImportedRawFile({
      filePath,
      datasetId: 'test-dataset',
      provider: 'test-provider',
      result: {
        result: { rawRecordCount: 1, frameCount: 1 },
        postgresSyncResult: { ok: true, result: { rowCount: 1 } },
      },
      postgresSync: true,
      state,
      options: {
        cleanupImportedRaw: true,
        cleanupRootDir: dir,
        cleanupLedgerPath: path.join(dir, 'cleanup-ledger.jsonl'),
      },
    });

    assert.equal(cleanup.ok, true);
    assert.equal(cleanup.deleted, true);
    await assert.rejects(() => readFile(filePath, 'utf8'));
    assert.equal(state.rawFileCleanupCount, 1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('raw file cleanup refuses non-NAS-synced imports', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'lattice-acc-cleanup-'));
  try {
    const filePath = path.join(dir, 'raw.json');
    await writeFile(filePath, '{"ok":true}\n', 'utf8');
    const cleanup = cleanupImportedRawFile({
      filePath,
      datasetId: 'test-dataset',
      provider: 'test-provider',
      result: { result: { rawRecordCount: 1, frameCount: 1 }, postgresSyncResult: null },
      postgresSync: false,
      options: { cleanupImportedRaw: true, cleanupRootDir: dir },
    });

    assert.equal(cleanup.skipped, true);
    assert.equal(cleanup.reason, 'postgres_sync_not_requested');
    assert.equal(await readFile(filePath, 'utf8'), '{"ok":true}\n');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('successful import ledger cleanup skips pending import paths', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'lattice-acc-cleanup-'));
  try {
    const keepPath = path.join(dir, 'pending.json');
    const deletePath = path.join(dir, 'synced.json');
    await writeFile(keepPath, '{"pending":true}\n', 'utf8');
    await writeFile(deletePath, '{"synced":true}\n', 'utf8');
    const state = {
      pendingImports: [{ filePath: keepPath }],
      lastSuccessfulImports: [
        {
          datasetId: 'delete-me',
          provider: 'test-provider',
          filePath: deletePath,
          rawRecordCount: 1,
          frameCount: 1,
          postgresSyncRequested: true,
          postgresSyncResult: { ok: true, result: { rowCount: 1 } },
        },
        {
          datasetId: 'keep-me',
          provider: 'test-provider',
          filePath: keepPath,
          rawRecordCount: 1,
          frameCount: 1,
          postgresSyncRequested: true,
          postgresSyncResult: { ok: true, result: { rowCount: 1 } },
        },
      ],
    };

    const summary = cleanupSuccessfulImportFiles(state, {
      limit: 10,
      cleanupImportedRaw: true,
      cleanupRootDir: dir,
      cleanupLedgerPath: path.join(dir, 'cleanup-ledger.jsonl'),
    });

    assert.equal(summary.deleted, 1);
    await assert.rejects(() => readFile(deletePath, 'utf8'));
    assert.equal(await readFile(keepPath, 'utf8'), '{"pending":true}\n');
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

test('trigger replay sends bounded latest-first frame load options by default', async () => {
  let requestPayload = null;
  await withServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      requestPayload = JSON.parse(body);
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ ok: true, run: { ideaRuns: [], forwardReturns: [] } }));
    });
  }, async (port) => {
    const state = {};
    const result = await triggerReplay(state, {
      port,
      timeoutMs: 500,
      maxFrames: 32,
      datasetIds: ['yahoo-XRT'],
      postgresSync: true,
      pgConfig: { host: 'nas.local', port: 5433, database: 'lattice', user: 'u', password: 'p' },
    });
    assert.equal(result.ok, true);
    assert.equal(requestPayload.frameLoadOptions.latestFirst, true);
    assert.equal(requestPayload.frameLoadOptions.maxFrames, 32);
    assert.deepEqual(requestPayload.frameLoadOptions.datasetIds, ['yahoo-XRT']);
    assert.equal(requestPayload.postgresSync, true);
    assert.equal(requestPayload.pgConfig.host, 'nas.local');
    assert.equal(state.lastReplay.frameLoadOptions.maxFrames, 32);
  });
});
