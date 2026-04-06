import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createLocalApiServer } from '../src-tauri/sidecar/local-api-server.mjs';

async function setupApiDir() {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'wm-secrets-cache-'));
  const apiDir = path.join(tempRoot, 'api');
  await mkdir(apiDir, { recursive: true });
  return {
    apiDir,
    async cleanup() {
      await rm(tempRoot, { recursive: true, force: true });
    },
  };
}

test('runtime secrets mirror sync logs once for repeated requests without mirror changes', async () => {
  const previousMirrorPath = process.env.LOCAL_API_SECRETS_MIRROR_PATH;
  const previousFRED = process.env.FRED_API_KEY;
  const mirrorRoot = await mkdtemp(path.join(os.tmpdir(), 'wm-secrets-mirror-'));
  const mirrorPath = path.join(mirrorRoot, 'runtime-secrets-mirror.json');
  await writeFile(mirrorPath, JSON.stringify({ FRED_API_KEY: 'test-fred-key' }), 'utf8');
  process.env.LOCAL_API_SECRETS_MIRROR_PATH = mirrorPath;
  delete process.env.FRED_API_KEY;

  const localApi = await setupApiDir();
  const messages = [];
  const logger = {
    log: (...args) => messages.push(args.join(' ')),
    warn: (...args) => messages.push(args.join(' ')),
    error: (...args) => messages.push(args.join(' ')),
  };

  const app = await createLocalApiServer({
    port: 0,
    apiDir: localApi.apiDir,
    backgroundAutomationEnabled: false,
    runtimeSecretsMirrorRefreshMs: 60_000,
    logger,
  });
  const { port } = await app.start();

  try {
    const responseA = await fetch(`http://127.0.0.1:${port}/api/local-status`);
    assert.equal(responseA.status, 200);
    const responseB = await fetch(`http://127.0.0.1:${port}/api/local-status`);
    assert.equal(responseB.status, 200);
    const syncLogs = messages.filter((line) => line.includes('runtime secrets mirror synced'));
    assert.equal(syncLogs.length, 1);
    assert.equal(process.env.FRED_API_KEY, 'test-fred-key');
  } finally {
    await app.close();
    await localApi.cleanup();
    await rm(mirrorRoot, { recursive: true, force: true });
    if (previousMirrorPath) {
      process.env.LOCAL_API_SECRETS_MIRROR_PATH = previousMirrorPath;
    } else {
      delete process.env.LOCAL_API_SECRETS_MIRROR_PATH;
    }
    if (previousFRED) {
      process.env.FRED_API_KEY = previousFRED;
    } else {
      delete process.env.FRED_API_KEY;
    }
  }
});
