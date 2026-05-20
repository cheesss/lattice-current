import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat, utimes, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  __historicalStreamWorkerTestUtils,
} from '../src/services/importer/historical-stream-worker.ts';

const tempDirs = [];

async function makeTempDir() {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'lattice-duckdb-lock-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('historical stream worker DuckDB lock recovery', () => {
  it('recovers from a stale malformed DuckDB lock file', async () => {
    const dir = await makeTempDir();
    const dbPath = path.join(dir, 'history.duckdb');
    const lockPath = __historicalStreamWorkerTestUtils.getDuckDbLockPath(dbPath);
    await writeFile(lockPath, '', 'utf8');
    const staleTime = new Date(Date.now() - 120_000);
    await utimes(lockPath, staleTime, staleTime);

    const release = await __historicalStreamWorkerTestUtils.acquireDuckDbPathLock(dbPath, 1);
    assert.equal(typeof release, 'function');

    const lockPayload = JSON.parse(await readFile(lockPath, 'utf8'));
    assert.equal(lockPayload.pid, process.pid);

    await release();
    await assert.rejects(() => stat(lockPath), /ENOENT/);
  });

  it('does not steal a freshly-created malformed DuckDB lock file', async () => {
    const dir = await makeTempDir();
    const dbPath = path.join(dir, 'history.duckdb');
    const lockPath = __historicalStreamWorkerTestUtils.getDuckDbLockPath(dbPath);
    await writeFile(lockPath, '', 'utf8');

    const release = await __historicalStreamWorkerTestUtils.acquireDuckDbPathLock(dbPath, 1);
    assert.equal(release, null);
  });
});
