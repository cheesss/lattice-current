#!/usr/bin/env node

const action = String(process.argv[2] || '').trim().toLowerCase();

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

  throw new Error(`unsupported intelligence job action: ${action || '(empty)'}`);
}

main().catch((error) => {
  process.stderr.write(String(error?.stack || error?.message || error));
  process.exitCode = 1;
});
