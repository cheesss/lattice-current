#!/usr/bin/env node

import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { mkdir, open, stat, unlink } from 'node:fs/promises';

const action = String(process.argv[2] || '').trim().toLowerCase();

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function resolveDbPath(actionName, payload) {
  if (actionName === 'import-historical') return String(payload?.options?.dbPath || '').trim() || null;
  if (actionName === 'list-datasets') return String(payload?.dbPath || '').trim() || null;
  if (actionName === 'load-frames') return String(payload?.options?.dbPath || '').trim() || null;
  if (actionName === 'run-replay' || actionName === 'run-walk-forward') {
    return String(payload?.frameLoadOptions?.dbPath || payload?.options?.dbPath || '').trim() || null;
  }
  if (actionName === 'postgres-sync-dataset-bulk') return String(payload?.dbPath || '').trim() || null;
  return null;
}

function intelligenceLockDir() {
  const base = String(process.env.LOCAL_API_DATA_DIR || '').trim() || os.tmpdir();
  return path.join(base, 'intelligence-job-locks');
}

async function withDbJobLock(actionName, payload, runner) {
  const dbPath = resolveDbPath(actionName, payload);
  if (!dbPath) {
    return await runner();
  }

  const resolvedDbPath = path.resolve(dbPath);
  const lockDir = intelligenceLockDir();
  await mkdir(lockDir, { recursive: true });
  const lockId = createHash('sha1').update(resolvedDbPath).digest('hex');
  const lockPath = path.join(lockDir, `${lockId}.lock`);
  const timeoutMs = Math.max(10_000, Math.min(5 * 60_000, Number(payload?.lockTimeoutMs) || 90_000));
  const staleMs = Math.max(timeoutMs * 2, 20 * 60_000);
  const startedAt = Date.now();

  while (true) {
    try {
      const handle = await open(lockPath, 'wx');
      try {
        await handle.writeFile(JSON.stringify({
          pid: process.pid,
          action: actionName,
          dbPath: resolvedDbPath,
          startedAt: new Date().toISOString(),
        }));
        return await runner();
      } finally {
        await handle.close().catch(() => {});
        await unlink(lockPath).catch(() => {});
      }
    } catch (error) {
      if (error?.code !== 'EEXIST') {
        throw error;
      }
      try {
        const lockStat = await stat(lockPath);
        if ((Date.now() - lockStat.mtimeMs) > staleMs) {
          await unlink(lockPath).catch(() => {});
          continue;
        }
      } catch {
        // The lock likely disappeared between attempts.
      }
      if ((Date.now() - startedAt) > timeoutMs) {
        throw new Error(`database job lock timeout for ${resolvedDbPath}`);
      }
      await sleep(400);
    }
  }
}

async function readPayload() {
  const chunks = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }
  if (chunks.length === 0) return {};
  const text = Buffer.concat(chunks).toString('utf8').trim();
  if (!text) return {};
  return JSON.parse(text);
}

async function main() {
  const payload = await readPayload();

  const importer = await import('../src/services/importer/historical-stream-worker.ts');
  const replay = await import('../src/services/historical-intelligence.ts');
  const postgres = await import('../src/services/server/intelligence-postgres.ts');
  const automation = await import('../src/services/server/intelligence-automation.ts');

  await withDbJobLock(action, payload, async () => {
    if (action === 'import-historical') {
      const result = await importer.processHistoricalDump(String(payload.filePath || ''), payload.options || {});
      process.stdout.write(JSON.stringify({ ok: true, result }));
      return;
    }

    if (action === 'list-datasets') {
      const datasets = await importer.listHistoricalDatasets(payload.dbPath);
      process.stdout.write(JSON.stringify({ ok: true, datasets }));
      return;
    }

    if (action === 'load-frames') {
      const frames = await importer.loadHistoricalReplayFramesFromDuckDb(payload.options || {});
      process.stdout.write(JSON.stringify({ ok: true, frames }));
      return;
    }

    if (action === 'run-replay') {
      const frames = Array.isArray(payload.frames)
        ? payload.frames
        : await importer.loadHistoricalReplayFramesFromDuckDb(payload.frameLoadOptions || {});
      const run = await replay.runHistoricalReplay(frames, payload.options || {});
      process.stdout.write(JSON.stringify({ ok: true, run }));
      return;
    }

    if (action === 'run-walk-forward') {
      const frames = Array.isArray(payload.frames)
        ? payload.frames
        : await importer.loadHistoricalReplayFramesFromDuckDb(payload.frameLoadOptions || {});
      const run = await replay.runWalkForwardBacktest(frames, payload.options || {});
      process.stdout.write(JSON.stringify({ ok: true, run }));
      return;
    }

    if (action === 'postgres-init') {
      const config = payload.config || postgres.getIntelligencePostgresConfigFromEnv();
      if (!config) throw new Error('postgres config required');
      const result = await postgres.initIntelligencePostgresSchema(config);
      process.stdout.write(JSON.stringify({ ok: true, result }));
      return;
    }

    if (action === 'postgres-status') {
      const config = payload.config || postgres.getIntelligencePostgresConfigFromEnv();
      if (!config) throw new Error('postgres config required');
      const result = await postgres.checkIntelligencePostgresConnection(config);
      process.stdout.write(JSON.stringify({ ok: true, result }));
      return;
    }

    if (action === 'postgres-upsert-dataset') {
      const config = payload.config || postgres.getIntelligencePostgresConfigFromEnv();
      if (!config) throw new Error('postgres config required');
      const result = await postgres.upsertHistoricalDatasetToPostgres(config, payload.dataset);
      process.stdout.write(JSON.stringify({ ok: true, result }));
      return;
    }

    if (action === 'postgres-sync-dataset-bulk') {
      const config = payload.config || postgres.getIntelligencePostgresConfigFromEnv();
      if (!config) throw new Error('postgres config required');
      const datasetId = String(payload.datasetId || '');
      if (!datasetId) throw new Error('datasetId required');
      const dbPath = payload.dbPath;
      const pageSize = Math.max(100, Math.min(5000, Number(payload.pageSize || 1000)));
      const datasets = await importer.listHistoricalDatasets(dbPath);
      const dataset = datasets.find((item) => item.datasetId === datasetId);
      if (!dataset) {
        throw new Error(`dataset not found: ${datasetId}`);
      }

      await postgres.upsertHistoricalDatasetToPostgres(config, dataset);

      let rawRecordCount = 0;
      for (let offset = 0; ; offset += pageSize) {
        const records = await importer.listHistoricalRawRecordsFromDuckDb({
          dbPath,
          datasetId,
          limit: pageSize,
          offset,
        });
        if (records.length === 0) break;
        await postgres.bulkSyncHistoricalRawItemsToPostgres(config, records);
        rawRecordCount += records.length;
        if (records.length < pageSize) break;
      }

      let frameCount = 0;
      for (let offset = 0; ; offset += pageSize) {
        const frames = await importer.listHistoricalReplayFrameRowsFromDuckDb({
          dbPath,
          datasetId,
          includeWarmup: true,
          limit: pageSize,
          offset,
        });
        if (frames.length === 0) break;
        await postgres.bulkSyncHistoricalReplayFramesToPostgres(config, frames);
        frameCount += frames.length;
        if (frames.length < pageSize) break;
      }

      process.stdout.write(
        JSON.stringify({
          ok: true,
          result: {
            datasetId,
            rawRecordCount,
            frameCount,
          },
        }),
      );
      return;
    }

    if (action === 'postgres-upsert-run') {
      const config = payload.config || postgres.getIntelligencePostgresConfigFromEnv();
      if (!config) throw new Error('postgres config required');
      const result = await postgres.upsertHistoricalReplayRunToPostgres(config, payload.run);
      process.stdout.write(JSON.stringify({ ok: true, result }));
      return;
    }

    if (action === 'postgres-list-runs') {
      const config = payload.config || postgres.getIntelligencePostgresConfigFromEnv();
      if (!config) throw new Error('postgres config required');
      const runs = await postgres.listHistoricalReplayRunsFromPostgres(config, payload.limit || 20);
      process.stdout.write(JSON.stringify({ ok: true, runs }));
      return;
    }

    if (action === 'postgres-get-run') {
      const config = payload.config || postgres.getIntelligencePostgresConfigFromEnv();
      if (!config) throw new Error('postgres config required');
      const run = await postgres.getHistoricalReplayRunFromPostgres(config, String(payload.runId || ''));
      process.stdout.write(JSON.stringify({ ok: true, run, found: Boolean(run) }));
      return;
    }

    if (action === 'automation-status') {
      const result = await automation.getIntelligenceAutomationStatus({
        registryPath: payload.registryPath,
        statePath: payload.statePath,
      });
      process.stdout.write(JSON.stringify({ ok: true, result }));
      return;
    }

    if (action === 'automation-run-cycle') {
      const result = await automation.runIntelligenceAutomationCycle({
        registryPath: payload.registryPath,
        statePath: payload.statePath,
        manualTrigger: payload.manualTrigger === true,
        forceFetch: payload.forceFetch === true,
        returnRunDetails: payload.returnRunDetails === true,
      });
      process.stdout.write(JSON.stringify({ ok: true, result }));
      return;
    }

    throw new Error(`unsupported intelligence job action: ${action || '(empty)'}`);
  });
}

main().catch((error) => {
  process.stderr.write(String(error?.stack || error?.message || error));
  process.exitCode = 1;
});
