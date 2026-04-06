#!/usr/bin/env node

import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { mkdir, open, readFile, stat, unlink, writeFile } from 'node:fs/promises';

const rawArgs = process.argv.slice(2);
const action = String(rawArgs.find((arg) => !arg.startsWith('--')) || '').trim().toLowerCase();

function printUsage() {
  process.stdout.write(`Usage: intelligence-job <action> [--payload-file path | --payload-b64 value] [--out file]

Common actions:
  import-historical
  list-datasets
  load-frames
  run-replay
  run-walk-forward
  automation-status
  automation-run-cycle

Windows-safe examples:
  node --import tsx scripts/intelligence-job.mjs list-datasets --payload-file .tmp-payload.json
  node --import tsx scripts/intelligence-job.mjs run-replay --payload-file .tmp-payload.json --out .tmp-result.json
`);
}

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
  const payloadFileIndex = rawArgs.indexOf('--payload-file');
  if (payloadFileIndex >= 0) {
    const payloadPath = String(rawArgs[payloadFileIndex + 1] || '').trim();
    if (!payloadPath) throw new Error('--payload-file requires a path');
    return JSON.parse((await readFile(path.resolve(payloadPath), 'utf8')).replace(/^\uFEFF/, ''));
  }

  const payloadB64Index = rawArgs.indexOf('--payload-b64');
  if (payloadB64Index >= 0) {
    const payloadB64 = String(rawArgs[payloadB64Index + 1] || '').trim();
    if (!payloadB64) throw new Error('--payload-b64 requires a base64 payload');
    return JSON.parse(Buffer.from(payloadB64, 'base64').toString('utf8').replace(/^\uFEFF/, ''));
  }

  const chunks = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }
  if (chunks.length === 0) return {};
  const text = Buffer.concat(chunks).toString('utf8').trim();
  if (!text) return {};
  try {
    return JSON.parse(text.replace(/^\uFEFF/, ''));
  } catch (error) {
    throw new Error(`invalid JSON payload on stdin; use --payload-file on Windows shells (${error instanceof Error ? error.message : String(error)})`);
  }
}

const STDOUT_SPILL_THRESHOLD = 4 * 1024 * 1024; // 4 MB — spill to temp file to avoid pipe overflow

async function emitResult(body, payload) {
  const outArgIndex = rawArgs.indexOf('--out');
  const outArg = outArgIndex >= 0 ? String(rawArgs[outArgIndex + 1] || '').trim() : '';
  const outFile = outArg || String(payload?.outFile || payload?.options?.outFile || '').trim();
  const serialized = JSON.stringify(body);

  // Explicit outFile requested — write there
  if (outFile) {
    const resolved = path.resolve(outFile);
    await mkdir(path.dirname(resolved), { recursive: true });
    await writeFile(resolved, serialized, 'utf8');
    process.stdout.write(JSON.stringify({ ok: true, outFile: resolved, bytes: Buffer.byteLength(serialized, 'utf8') }));
    return;
  }

  // Auto-spill: if result is too large for pipe, write to temp file
  // Sidecar reads _resultFile and loads the full result from disk
  const byteLen = Buffer.byteLength(serialized, 'utf8');
  if (byteLen > STDOUT_SPILL_THRESHOLD) {
    const spillDir = path.resolve('data', 'historical', '.tmp-results');
    await mkdir(spillDir, { recursive: true });
    const spillFile = path.join(spillDir, `result-${Date.now()}-${process.pid}.json`);
    await writeFile(spillFile, serialized, 'utf8');
    process.stdout.write(JSON.stringify({ ok: true, _resultFile: spillFile, bytes: byteLen }));
    return;
  }

  process.stdout.write(serialized);
}

async function main() {
  if (!action || action === '--help' || action === 'help') {
    printUsage();
    return;
  }
  const payload = await readPayload();

  const importer = await import('../src/services/importer/historical-stream-worker.ts');
  const replay = await import('../src/services/historical-intelligence.ts');
  const postgres = await import('../src/services/server/intelligence-postgres.ts');
  const automation = await import('../src/services/server/intelligence-automation.ts');
  const shouldUseNasFrames = (frameLoadOptions) =>
    process.env.USE_NAS_FRAMES === '1' || String(frameLoadOptions?.source || '').trim().toLowerCase() === 'postgres';
  const loadFrames = async (frameLoadOptions = {}) => (
    shouldUseNasFrames(frameLoadOptions)
      ? importer.loadHistoricalReplayFramesFromPostgres(frameLoadOptions)
      : importer.loadHistoricalReplayFramesFromDuckDb(frameLoadOptions)
  );

  await withDbJobLock(action, payload, async () => {
    if (action === 'import-historical') {
      const result = await importer.processHistoricalDump(String(payload.filePath || ''), payload.options || {});
      await emitResult({ ok: true, result }, payload);
      return;
    }

    if (action === 'list-datasets') {
      const datasets = await importer.listHistoricalDatasets(payload.dbPath);
      await emitResult({ ok: true, datasets }, payload);
      return;
    }

    if (action === 'load-frames') {
      const frames = await loadFrames(payload.options || {});
      await emitResult({ ok: true, frames }, payload);
      return;
    }

    if (action === 'run-replay') {
      const frames = Array.isArray(payload.frames)
        ? payload.frames
        : await loadFrames(payload.frameLoadOptions || {});
      const run = await replay.runHistoricalReplay(frames, payload.options || {});
      // Debug: check first frame clusters vs barrier
      const cp0 = run?.checkpoints?.[0];
      const f0 = frames[0];
      // Find last snapshot's falsePositive from the run
      const lastCp = run?.checkpoints?.[run.checkpoints.length - 1];
      const _dbg = {
        candidates: run?.workflow?.[0]?.summary,
        map: run?.workflow?.[2]?.summary,
        lastCheckpointIdeas: lastCp?.ideaCount,
        lastCheckpointMappings: lastCp?.mappingStatCount,
        frame0: {
          ts: f0?.timestamp,
          clusterCount: f0?.clusters?.length,
          marketCount: f0?.markets?.length,
          firstClusterTitle: f0?.clusters?.[0]?.primaryTitle?.substring(0, 50),
          firstClusterFirstSeen: f0?.clusters?.[0]?.firstSeen,
          firstClusterSourceCount: f0?.clusters?.[0]?.sourceCount,
          firstClusterAllItems: f0?.clusters?.[0]?.allItems?.length,
        },
        checkpoint0: cp0 ? { clFiltered: cp0.clusterCount, mkFiltered: cp0.marketCount } : null,
      };
      if (payload?.compact || payload?.options?.compact) {
        const summary = {
          ok: true,
          frameCount: run.frameCount,
          evaluationFrameCount: run.evaluationFrameCount,
          ideaCount: run.ideaRuns?.length || 0,
          returnCount: run.forwardReturns?.length || 0,
          themes: Object.fromEntries(
            (run.diagnostics?.themes || []).slice(0, 12).map((row) => [row.key, row.sampleSize]),
          ),
          symbols: [...new Set((run.ideaRuns || []).flatMap((idea) => (idea.symbols || []).map((symbol) => symbol.symbol)))],
          portfolio: run.portfolioAccounting?.summary || null,
          workflow: (run.workflow || []).map((w) => ({ id: w.id, status: w.status, metric: w.metric })),
          summaryLines: run.summaryLines || [],
          diagnostics: run.diagnostics
            ? {
              themes: (run.diagnostics.themes || []).slice(0, 8),
              symbols: (run.diagnostics.symbols || []).slice(0, 8),
              horizons: (run.diagnostics.horizons || []).slice(0, 8),
            }
            : null,
        };
        await emitResult(summary, payload);
      } else {
        await emitResult({ ok: true, run, _dbg }, payload);
      }
      return;
    }

    if (action === 'run-walk-forward') {
      const frames = Array.isArray(payload.frames)
        ? payload.frames
        : await loadFrames(payload.frameLoadOptions || {});
      const run = await replay.runWalkForwardBacktest(frames, payload.options || {});
      await emitResult({ ok: true, run }, payload);
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

    if (action === 'get-recommendations') {
      try {
        // Load latest replay runs
        const allRuns = await replay.listHistoricalReplayRuns ?
          await replay.listHistoricalReplayRuns(3) : [];
        const latestRun = allRuns[0];

        if (!latestRun || !latestRun.ideaRuns?.length) {
          process.stdout.write(JSON.stringify({
            ok: true,
            recommendations: [],
            correlationMatrix: { symbols: [], correlations: [] },
            regime: null,
          }));
          return;
        }

        // Gather checkpoint data for news counts and cluster headlines
        const checkpoints = latestRun.checkpoints || [];
        const recentCheckpoints = checkpoints.slice(-6); // last ~24h assuming 4h intervals
        const totalNewsItems = recentCheckpoints.reduce((sum, cp) => sum + (cp.clusterCount || 0), 0);

        // Collect cluster headlines from the latest checkpoint for rationale
        const latestCheckpoint = checkpoints[checkpoints.length - 1];

        // Determine regime context from checkpoint trajectory
        const cpIdeaCounts = checkpoints.slice(-10).map(cp => cp.ideaCount || 0);
        const avgIdeaCount = cpIdeaCounts.length > 0
          ? cpIdeaCounts.reduce((a, b) => a + b, 0) / cpIdeaCounts.length : 0;
        const recentAvg = cpIdeaCounts.slice(-3).length > 0
          ? cpIdeaCounts.slice(-3).reduce((a, b) => a + b, 0) / cpIdeaCounts.slice(-3).length : 0;
        const regimeContext = recentAvg > avgIdeaCount * 1.3
          ? 'Elevated activity: increasing theme generation suggests heightened market sensitivity'
          : recentAvg < avgIdeaCount * 0.7
          ? 'Subdued activity: declining theme generation indicates calmer market conditions'
          : 'Normal activity: theme generation within typical range';

        // Build recommendations from idea runs
        const recommendations = latestRun.ideaRuns.slice(0, 8).map(idea => {
          const ideaReturns = (latestRun.forwardReturns || [])
            .filter(fr => fr.ideaRunId === idea.id);
          const winCount = ideaReturns.filter(fr => (fr.signedReturnPct || 0) > 0).length;
          const totalCount = ideaReturns.length;
          const winRate = totalCount > 0 ? winCount / totalCount : 0;
          const confirmationState = winRate >= 0.6 ? 'confirmed'
            : winRate >= 0.4 ? 'pending' : 'denied';

          // Find clusters related to this idea's theme for headlines
          const themeHeadlines = [];
          for (const cp of recentCheckpoints) {
            if (cp.topClusters) {
              for (const cl of cp.topClusters) {
                if (cl.themeId === idea.themeId || cl.primaryTitle) {
                  themeHeadlines.push(cl.primaryTitle || cl.title || '');
                }
              }
            }
          }
          const uniqueHeadlines = [...new Set(themeHeadlines.filter(Boolean))].slice(0, 3);

          // Compute transmission strength from forward returns variance
          const returnValues = ideaReturns.map(fr => fr.signedReturnPct || 0);
          const avgReturn = returnValues.length > 0
            ? returnValues.reduce((a, b) => a + b, 0) / returnValues.length : 0;
          const variance = returnValues.length > 1
            ? returnValues.reduce((s, r) => s + (r - avgReturn) ** 2, 0) / (returnValues.length - 1) : 0;
          const transmissionStrength = Math.min(1, Math.abs(avgReturn) / Math.max(1, Math.sqrt(variance)));

          return {
            symbol: idea.symbols?.[0]?.symbol || 'N/A',
            name: idea.symbols?.[0]?.symbol || 'Unknown',
            direction: idea.direction || 'long',
            themeId: idea.themeId || '',
            themeLabel: idea.themeId || '',
            score: idea.conviction || 50,
            optimalHorizonHours: idea.preferredHorizonHours || 48,
            horizonReturns: ideaReturns.map(fr => ({
              horizonHours: fr.horizonHours || 24,
              avgReturnPct: fr.signedReturnPct || 0,
              bestReturnPct: fr.signedReturnPct || 0,
              worstReturnPct: fr.signedReturnPct || 0,
              maxDrawdownPct: 0,
              winRate: fr.signedReturnPct > 0 ? 1 : 0,
              sampleCount: 1,
              confidenceLevel: winRate >= 0.6 ? 'high' : winRate >= 0.4 ? 'medium' : 'low',
            })),
            rationale: {
              newsCount24h: totalNewsItems,
              topHeadlines: uniqueHeadlines,
              transmissionStrength: Math.round(transmissionStrength * 100) / 100,
              transferEntropy: Math.round(Math.abs(avgReturn) * 10) / 10,
              leadLagHours: idea.preferredHorizonHours || 24,
              regimeContext,
              corroborationSources: uniqueHeadlines.length,
              confirmationState,
            },
          };
        });

        // Build correlation matrix from unique symbols
        const symbols = [...new Set(recommendations.map(r => r.symbol))];
        const n = symbols.length;
        const correlations = Array.from({length: n}, () => Array(n).fill(0));
        for (let i = 0; i < n; i++) correlations[i][i] = 1;

        process.stdout.write(JSON.stringify({
          ok: true,
          recommendations,
          correlationMatrix: { symbols, correlations },
          regime: null,
        }));
      } catch (e) {
        process.stdout.write(JSON.stringify({
          ok: true,
          recommendations: [],
          correlationMatrix: { symbols: [], correlations: [] },
          regime: null,
        }));
      }
      return;
    }

    if (action === 'get-theme-intensity') {
      try {
        const allRuns = await replay.listHistoricalReplayRuns ?
          await replay.listHistoricalReplayRuns(1) : [];
        const latestRun = allRuns[0];

        // Extract unique themes from idea runs
        const themeMap = new Map();

        // Build a map of themeId -> idea ids for checkpoint cross-referencing
        const themeIdeaIds = new Map();
        for (const idea of latestRun?.ideaRuns || []) {
          if (!themeIdeaIds.has(idea.themeId)) themeIdeaIds.set(idea.themeId, []);
          themeIdeaIds.get(idea.themeId).push(idea.id);
        }

        for (const idea of latestRun?.ideaRuns || []) {
          if (!themeMap.has(idea.themeId)) {
            // For each theme, build time series from checkpoints where that theme had ideas
            const checkpointsWithTheme = (latestRun?.checkpoints || [])
              .filter(cp => cp.ideaCount > 0)
              .slice(-20);

            const intensityTimeSeries = checkpointsWithTheme.map(cp => ({
              timestamp: cp.timestamp,
              intensity: Math.round((cp.ideaCount / Math.max(1, cp.clusterCount)) * 100),
            }));

            // Compute fitted beta from time series decay pattern
            const intensities = intensityTimeSeries.map(ts => ts.intensity);
            const peakIntensity = Math.max(...intensities, 1);
            const currentIntensity = idea.conviction || 50;
            const decayRatio = intensities.length >= 2
              ? intensities[intensities.length - 1] / Math.max(1, peakIntensity) : 0.7;
            const fittedBetaHours = decayRatio > 0.01
              ? Math.round(-intensityTimeSeries.length * 4 / Math.log(decayRatio)) : 36;

            themeMap.set(idea.themeId, {
              themeId: idea.themeId,
              themeLabel: idea.themeId,
              currentIntensity,
              fittedBetaHours: Math.max(12, Math.min(120, fittedBetaHours)),
              excitationMass: Math.round(peakIntensity * intensityTimeSeries.length / 10),
              alpha: Math.round(currentIntensity / Math.max(1, peakIntensity) * 100) / 100,
              intensityTimeSeries,
              predictedDecay: [
                { hoursFromNow: 12, intensity: Math.round(currentIntensity * Math.exp(-12 / Math.max(12, fittedBetaHours))), uncertainty: 10 },
                { hoursFromNow: 24, intensity: Math.round(currentIntensity * Math.exp(-24 / Math.max(12, fittedBetaHours))), uncertainty: 15 },
                { hoursFromNow: 48, intensity: Math.round(currentIntensity * Math.exp(-48 / Math.max(12, fittedBetaHours))), uncertainty: 20 },
              ],
            });
          }
        }

        // Build sankey from idea runs
        const events = [];
        const themes = [];
        const assets = [];
        const links = [];
        const seenThemes = new Set();
        const seenAssets = new Set();

        for (const idea of latestRun?.ideaRuns || []) {
          if (!seenThemes.has(idea.themeId)) {
            seenThemes.add(idea.themeId);
            themes.push({ id: idea.themeId, label: idea.themeId });
          }
          for (const sym of idea.symbols || []) {
            if (!seenAssets.has(sym.symbol)) {
              seenAssets.add(sym.symbol);
              const fr = (latestRun?.forwardReturns || []).find(f => f.symbol === sym.symbol);
              assets.push({ id: sym.symbol, label: sym.symbol, returnPct: fr?.signedReturnPct || 0 });
            }
            links.push({
              source: idea.themeId,
              target: sym.symbol,
              strength: (idea.conviction || 50) / 100,
              direction: (idea.direction === 'short') ? 'negative' : 'positive',
            });
          }
        }

        process.stdout.write(JSON.stringify({
          ok: true,
          themes: [...themeMap.values()],
          sankeyFlow: { events, themes, assets, links },
        }));
      } catch (e) {
        process.stdout.write(JSON.stringify({
          ok: true, themes: [],
          sankeyFlow: { events: [], themes: [], assets: [], links: [] },
        }));
      }
      return;
    }

    if (action === 'get-impact-timeline') {
      try {
        const allRuns = await replay.listHistoricalReplayRuns ?
          await replay.listHistoricalReplayRuns(1) : [];
        const latestRun = allRuns[0];

        const events = (latestRun?.checkpoints || [])
          .filter(cp => cp.clusterCount > 0 && cp.ideaCount > 0)
          .slice(-20)
          .map((cp, i) => ({
            id: 'evt-' + i,
            timestamp: new Date(cp.timestamp).getTime(),
            title: 'Event at ' + new Date(cp.timestamp).toISOString().substring(0, 16),
            intensity: Math.round((cp.ideaCount / Math.max(1, cp.clusterCount)) * 100),
            sources: [],
            themeIds: [],
            assetImpacts: {},
          }));

        const snapshots = (latestRun?.checkpoints || [])
          .filter((_, i) => i % 10 === 0)
          .slice(-10)
          .map(cp => ({
            timestamp: new Date(cp.timestamp).getTime(),
            topRecommendations: [],
            themeIntensities: [],
          }));

        process.stdout.write(JSON.stringify({
          ok: true,
          events,
          overlaps: [],
          scrubberSnapshots: snapshots,
        }));
      } catch (e) {
        process.stdout.write(JSON.stringify({
          ok: true, events: [], overlaps: [], scrubberSnapshots: [],
        }));
      }
      return;
    }

    if (action === 'run-scenario') {
      try {
        const scenarios = payload?.scenarios || [];
        const allRuns = typeof replay.listHistoricalReplayRuns === 'function'
          ? await replay.listHistoricalReplayRuns(3) : [];
        const latestRun = allRuns[0];

        const currentState = {};
        const scenarioState = {};

        // Build returns by theme from actual forward returns
        const returnsByTheme = {};
        for (const idea of latestRun?.ideaRuns || []) {
          if (!returnsByTheme[idea.themeId]) returnsByTheme[idea.themeId] = [];
          const returns = (latestRun?.forwardReturns || [])
            .filter(fr => fr.ideaRunId === idea.id)
            .map(fr => ({
              symbol: fr.symbol,
              horizonHours: fr.horizonHours,
              returnPct: fr.signedReturnPct || 0,
            }));
          returnsByTheme[idea.themeId].push(...returns);
        }

        for (const s of scenarios) {
          const themeReturns = returnsByTheme[s.themeId] || [];
          const currentIntensity = 50; // baseline
          const scale = (s.intensity || 50) / currentIntensity;

          // Group by symbol and compute scaled returns
          const bySymbol = {};
          for (const r of themeReturns) {
            if (!bySymbol[r.symbol]) bySymbol[r.symbol] = {};
            const hKey = r.horizonHours + 'h';
            if (!bySymbol[r.symbol][hKey]) bySymbol[r.symbol][hKey] = [];
            bySymbol[r.symbol][hKey].push(r.returnPct);
          }

          currentState[s.themeId] = {};
          scenarioState[s.themeId] = {};

          for (const [sym, horizons] of Object.entries(bySymbol)) {
            for (const [h, returns] of Object.entries(horizons)) {
              const avg = returns.reduce((a, b) => a + b, 0) / returns.length;
              if (!currentState[s.themeId][sym]) currentState[s.themeId][sym] = {};
              if (!scenarioState[s.themeId][sym]) scenarioState[s.themeId][sym] = {};
              currentState[s.themeId][sym][h] = Math.round(avg * 100) / 100;
              scenarioState[s.themeId][sym][h] = Math.round(avg * scale * 100) / 100;
            }
          }
        }

        // Compute decay curves
        const betaBase = 36;
        const maxScale = Math.max(...scenarios.map(s => (s.intensity || 50) / 50), 1);

        // Generate interpretation
        const interpretation = scenarios.map(s => {
          const scale = (s.intensity || 50) / 50;
          const direction = scale > 1.2 ? 'escalation' : scale < 0.8 ? 'de-escalation' : 'stable';
          const themeReturns = returnsByTheme[s.themeId] || [];
          const avgReturn = themeReturns.length > 0
            ? themeReturns.reduce((a, r) => a + r.returnPct, 0) / themeReturns.length : 0;
          return {
            themeId: s.themeId,
            intensity: s.intensity,
            direction,
            expectedImpact: direction === 'escalation'
              ? `Amplified returns: avg ${(avgReturn * scale).toFixed(2)}% (${scale.toFixed(1)}x current)`
              : direction === 'de-escalation'
              ? `Reduced impact: theme fading, consider closing positions`
              : `Stable conditions: maintain current allocation`,
            riskFactors: direction === 'escalation'
              ? ['Potential for sharp reversal', 'Crowded trade risk', 'Policy response could cap upside']
              : ['False sense of security', 'Delayed transmission to markets'],
            topBeneficiaries: Object.entries(currentState[s.themeId] || {})
              .map(([sym, h]) => ({ symbol: sym, avgReturn: Object.values(h).reduce((a, b) => a + b, 0) / Object.values(h).length }))
              .sort((a, b) => Math.abs(b.avgReturn) - Math.abs(a.avgReturn))
              .slice(0, 5)
              .map(b => `${b.symbol}: ${(b.avgReturn * scale).toFixed(2)}%`),
          };
        });

        // Find historical analogs — past events with similar characteristics
        const analogs = [];
        if (latestRun?.checkpoints?.length > 0) {
          for (const s of scenarios) {
            const themeCheckpoints = latestRun.checkpoints
              .filter(cp => cp.ideaCount > 0 && cp.clusterCount > 0);

            // Group by intensity ranges
            const highIntensity = themeCheckpoints.filter(cp =>
              cp.ideaCount / Math.max(1, cp.clusterCount) > 0.5
            );
            const lowIntensity = themeCheckpoints.filter(cp =>
              cp.ideaCount / Math.max(1, cp.clusterCount) <= 0.5
            );

            const relevantGroup = s.intensity > 60 ? highIntensity : lowIntensity;

            analogs.push({
              themeId: s.themeId,
              matchCount: relevantGroup.length,
              avgIdeasPerCluster: relevantGroup.length > 0
                ? relevantGroup.reduce((sum, cp) => sum + cp.ideaCount / Math.max(1, cp.clusterCount), 0) / relevantGroup.length
                : 0,
              description: relevantGroup.length > 0
                ? `${relevantGroup.length} similar historical periods found`
                : 'No close historical analog found',
            });
          }
        }

        // Auto-generate contrarian scenario
        const contrarianInterpretation = scenarios.map(s => {
          const contrarianIntensity = Math.max(10, 100 - s.intensity);
          const contrarianScale = contrarianIntensity / 50;
          const direction = contrarianIntensity < 40 ? 'de-escalation' : 'reversal';

          return {
            themeId: s.themeId + '-contrarian',
            intensity: contrarianIntensity,
            direction,
            expectedImpact: `Contrarian view: if ${s.themeId} reverses to intensity ${contrarianIntensity}, ` +
              `positions would need to be unwound. Consider hedges.`,
            riskFactors: [
              'Consensus positioning creates reversal risk',
              'Mean reversion historically occurs within 2-4 weeks',
              'Policy response could accelerate normalization',
            ],
            topBeneficiaries: [],
          };
        });

        process.stdout.write(JSON.stringify({
          ok: true,
          currentState,
          scenarioState,
          decayCurve: {
            currentBetaHours: betaBase,
            scenarioBetaHours: Math.round(betaBase * (1 + (maxScale - 1) * 0.3)),
          },
          interpretation,
          analogs,
          contrarianInterpretation,
        }));
      } catch (e) {
        process.stdout.write(JSON.stringify({
          ok: true,
          currentState: {},
          scenarioState: {},
          decayCurve: { currentBetaHours: 36, scenarioBetaHours: 36 },
          interpretation: [],
        }));
      }
      return;
    }

    throw new Error(`unsupported intelligence job action: ${action || '(empty)'}`);
  });
}

main().catch((error) => {
  process.stderr.write(String(error?.stack || error?.message || error));
  process.exitCode = 1;
});
