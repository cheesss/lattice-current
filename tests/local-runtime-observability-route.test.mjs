import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createLocalApiServer } from '../src-tauri/sidecar/local-api-server.mjs';

async function setupApiDir() {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'wm-observability-route-'));
  const apiDir = path.join(tempRoot, 'api');
  await mkdir(apiDir, { recursive: true });
  return {
    apiDir,
    async cleanup() {
      await rm(tempRoot, { recursive: true, force: true });
    },
  };
}

test('local runtime observability endpoint returns daemon task summary', async () => {
  const localApi = await setupApiDir();
  const tempDataDir = await mkdtemp(path.join(os.tmpdir(), 'wm-observability-data-'));
  const daemonStatePath = path.join(tempDataDir, 'daemon-state.json');
  const now = Date.now();
  await writeFile(daemonStatePath, JSON.stringify({
    lastRun: {
      'signal-refresh': now - (5 * 60 * 1000),
      'dashboard-health': now - (4 * 60 * 1000),
    },
    taskResults: {
      'signal-refresh': {
        ok: true,
        at: new Date(now - (5 * 60 * 1000)).toISOString(),
        error: '',
        consecutiveFailures: 0,
      },
      'dashboard-health': {
        ok: true,
        at: new Date(now - (4 * 60 * 1000)).toISOString(),
        error: '',
        consecutiveFailures: 0,
      },
    },
    failures: {},
    health: {
      dashboard: {
        ok: true,
        checkedAt: new Date(now - (4 * 60 * 1000)).toISOString(),
        payload: { status: 'ok' },
      },
    },
  }), 'utf8');

  const app = await createLocalApiServer({
    port: 0,
    apiDir: localApi.apiDir,
    dataDir: tempDataDir,
    backgroundAutomationEnabled: false,
    logger: { log() {}, warn() {}, error() {} },
  });
  const { port } = await app.start();

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/local-runtime-observability`);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.success, true);
    assert.equal(body.daemon.dashboard.ok, true);
    assert.ok(Array.isArray(body.daemon.tasks));
    assert.ok(body.daemon.tasks.some((task) => task.name === 'signal-refresh'));
    assert.equal(typeof body.summary.observabilityScore, 'number');
  } finally {
    await app.close();
    await localApi.cleanup();
    await rm(tempDataDir, { recursive: true, force: true });
  }
});
