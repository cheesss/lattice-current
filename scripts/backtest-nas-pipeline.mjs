#!/usr/bin/env node
import fs from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { loadEnvFile } from './_seed-utils.mjs';
import { THEME_RULES } from '../src/services/investment/constants.ts';
import {
  getIntelligencePostgresConfigFromEnv,
  initIntelligencePostgresSchema,
} from '../src/services/server/intelligence-postgres.ts';
import { listHistoricalDatasets } from '../src/services/importer/historical-stream-worker.ts';

loadEnvFile(import.meta.url);

const scriptDir = path.dirname(new URL(import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, '$1');
const projectRoot = path.resolve(scriptDir, '..');
const defaultDbPath = path.join(projectRoot, 'data', 'historical', 'intelligence-history.duckdb');
const statePath = path.join(projectRoot, 'data', 'automation', 'backtest-nas-pipeline-state.json');
const persistentRunsPath = path.join(projectRoot, 'data', 'persistent-cache', 'historical-intelligence-runs%3Av1.json');
const defaultFredSeries = [
  'CPIAUCSL',
  'CPILFESL',
  'FEDFUNDS',
  'UNRATE',
  'DGS10',
  'T10Y2Y',
  'DTWEXBGS',
  'DCOILWTICO',
  'BAMLH0A0HYM2',
  'VIXCLS',
];
const defaultGlobalGdeltQueries = [
  { name: 'global-conflict', query: '(war OR conflict OR military OR ceasefire)' },
  { name: 'global-economy', query: '(inflation OR recession OR GDP OR trade)' },
  { name: 'global-energy', query: '(oil OR gas OR energy OR OPEC)' },
  { name: 'global-tech', query: '(AI OR semiconductor OR regulation OR cyber)' },
  { name: 'global-politics', query: '(election OR sanctions OR diplomacy OR summit)' },
];

function nowIso() {
  return new Date().toISOString();
}

function parseArgs(argv) {
  const positional = [];
  const flags = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = String(argv[i] || '');
    if (!token.startsWith('--')) {
      positional.push(token);
      continue;
    }
    const body = token.slice(2);
    if (!body) continue;
    if (body.includes('=')) {
      const [key, ...rest] = body.split('=');
      flags[key] = rest.join('=');
      continue;
    }
    const next = argv[i + 1];
    if (next && !String(next).startsWith('--')) {
      flags[body] = String(next);
      i += 1;
    } else {
      flags[body] = true;
    }
  }
  return { positional, flags };
}

function boolFlag(value, fallback = false) {
  if (value == null) return fallback;
  if (typeof value === 'boolean') return value;
  return /^(1|true|yes|on)$/i.test(String(value));
}

function intFlag(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function shiftYears(date, years) {
  const copy = new Date(date.getTime());
  copy.setUTCFullYear(copy.getUTCFullYear() + years);
  return copy;
}

function formatMonth(date) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

function formatDate(date) {
  return date.toISOString().slice(0, 10);
}

function safeName(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'dataset';
}

function gdeltDateTime(date, endOfDay = false) {
  const copy = new Date(date.getTime());
  if (endOfDay) {
    copy.setUTCHours(23, 59, 59, 0);
  } else {
    copy.setUTCHours(0, 0, 0, 0);
  }
  return copy.toISOString().replace(/[-:]/g, '').replace('.000Z', 'Z');
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function readJsonFile(filePath, fallback) {
  try {
    const raw = await readFile(filePath, 'utf8');
    return JSON.parse(raw.replace(/^\uFEFF/, ''));
  } catch {
    return fallback;
  }
}

async function loadState() {
  return readJsonFile(statePath, {
    version: 1,
    updatedAt: null,
    yahoo: {},
    fred: {},
    gdelt: {
      taskIndex: 0,
    },
    runs: {},
  });
}

async function saveState(state) {
  state.updatedAt = nowIso();
  await mkdir(path.dirname(statePath), { recursive: true });
  await writeFile(statePath, JSON.stringify(state, null, 2), 'utf8');
}

function resolvePostgresConfig(flags = {}, env = process.env) {
  const hasExplicitHostConfig = Boolean(
    flags['pg-host'] || flags['pg-port'] || flags['pg-user'] || flags['pg-password'] || flags['pg-database'],
  );
  const mappedEnv = {
    ...env,
    INTEL_PG_URL: hasExplicitHostConfig
      ? (flags['pg-url'] || '')
      : (flags['pg-url'] || env.INTEL_PG_URL || env.NAS_PG_URL || env.DATABASE_URL),
    INTEL_PG_HOST: flags['pg-host'] || env.INTEL_PG_HOST || env.NAS_PG_HOST || env.PG_HOST,
    INTEL_PG_PORT: flags['pg-port'] || env.INTEL_PG_PORT || env.NAS_PG_PORT || env.PG_PORT,
    INTEL_PG_USER: flags['pg-user'] || env.INTEL_PG_USER || env.NAS_PG_USER || env.PG_USER || 'postgres',
    INTEL_PG_PASSWORD: flags['pg-password'] || env.INTEL_PG_PASSWORD || env.NAS_PG_PASSWORD || env.PG_PASSWORD,
    INTEL_PG_DATABASE: flags['pg-database'] || env.INTEL_PG_DATABASE || env.NAS_PG_DATABASE || env.PG_DATABASE || 'lattice',
    INTEL_PG_SCHEMA: flags['pg-schema'] || env.INTEL_PG_SCHEMA || env.NAS_PG_SCHEMA || 'worldmonitor_intel',
    INTEL_PG_SSL: flags['pg-ssl'] || env.INTEL_PG_SSL || env.NAS_PG_SSL || 'false',
  };
  const config = getIntelligencePostgresConfigFromEnv(mappedEnv);
  if (!config) {
    throw new Error('NAS PostgreSQL config is missing. Set INTEL_PG_* or PG_* env vars.');
  }
  config.schema = config.schema || 'worldmonitor_intel';
  return config;
}

function childResultFromStdout(stdout) {
  const trimmed = String(stdout || '').trim();
  if (!trimmed) return { ok: true };
  const parsed = JSON.parse(trimmed);
  if (parsed && typeof parsed === 'object' && parsed._resultFile) {
    const full = JSON.parse(fs.readFileSync(parsed._resultFile, 'utf8').replace(/^\uFEFF/, ''));
    try {
      fs.unlinkSync(parsed._resultFile);
    } catch {
      // ignore cleanup failures
    }
    return full;
  }
  return parsed;
}

async function runNode(args, { timeoutMs = 10 * 60_000, extraEnv = {} } = {}) {
  return await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, {
      cwd: projectRoot,
      env: {
        ...process.env,
        ...extraEnv,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const stdout = [];
    const stderr = [];
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
    }, timeoutMs);
    child.stdout.on('data', (chunk) => stdout.push(chunk));
    child.stderr.on('data', (chunk) => stderr.push(chunk));
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      const out = Buffer.concat(stdout).toString('utf8');
      const err = Buffer.concat(stderr).toString('utf8');
      if (code !== 0) {
        reject(new Error(err.trim() || out.trim() || `child failed: ${args.join(' ')}`));
        return;
      }
      resolve({ stdout: out, stderr: err });
    });
  });
}

async function runIntelligenceJob(action, payload, timeoutMs = 10 * 60_000) {
  const tempFile = path.join(os.tmpdir(), `wm-intel-${Date.now()}-${Math.random().toString(16).slice(2)}.json`);
  await writeFile(tempFile, JSON.stringify(payload ?? {}), 'utf8');
  try {
    const { stdout } = await runNode(
      ['--import', 'tsx', path.join('scripts', 'intelligence-job.mjs'), action, '--payload-file', tempFile],
      { timeoutMs },
    );
    return childResultFromStdout(stdout);
  } finally {
    await rm(tempFile, { force: true });
  }
}

async function runFetchScript(provider, options, timeoutMs = 10 * 60_000) {
  const args = [path.join('scripts', 'fetch-historical-data.mjs'), provider];
  for (const [key, value] of Object.entries(options || {})) {
    if (value == null || value === false || value === '') continue;
    args.push(`--${key}=${value}`);
  }
  const { stdout } = await runNode(args, { timeoutMs });
  return childResultFromStdout(stdout);
}

async function runNewsArchiveScript(options, timeoutMs = 60 * 60_000) {
  const args = [path.join('scripts', 'fetch-news-archive.mjs')];
  for (const [key, value] of Object.entries(options || {})) {
    if (value == null || value === false || value === '') continue;
    args.push(`--${key}=${value}`);
  }
  const { stdout } = await runNode(args, { timeoutMs });
  return { stdout };
}

function buildYahooSymbols() {
  const symbols = new Set();
  for (const theme of THEME_RULES) {
    for (const asset of theme.assets || []) {
      if (asset?.symbol) symbols.add(String(asset.symbol));
    }
  }
  return [...symbols].sort();
}

function buildGdeltSpecs(mode = 'all') {
  const themeSpecs = THEME_RULES.map((theme) => {
    const triggerTerms = [...new Set((theme.triggers || []).slice(0, 8))];
    const quoted = triggerTerms.map((term) => (String(term).includes(' ') ? `"${term}"` : term));
    return {
      name: theme.id,
      datasetId: `gdelt-backfill-${safeName(theme.id)}`,
      query: `(${quoted.join(' OR ')})`,
    };
  });
  const globalSpecs = defaultGlobalGdeltQueries.map((item) => ({
    name: item.name,
    datasetId: `gdelt-backfill-${safeName(item.name)}`,
    query: item.query,
  }));
  if (String(mode).toLowerCase() === 'global') return globalSpecs;
  if (String(mode).toLowerCase() === 'theme') return themeSpecs;
  return [...themeSpecs, ...globalSpecs];
}

function buildDateWindows(fromDate, toDate, windowDays) {
  const windows = [];
  const cursor = new Date(fromDate.getTime());
  cursor.setUTCHours(0, 0, 0, 0);
  const end = new Date(toDate.getTime());
  end.setUTCHours(0, 0, 0, 0);
  while (cursor <= end) {
    const start = new Date(cursor.getTime());
    const finish = new Date(Math.min(end.getTime(), start.getTime() + (windowDays - 1) * 24 * 60 * 60 * 1000));
    windows.push({
      startDate: start,
      endDate: finish,
      start: gdeltDateTime(start, false),
      end: gdeltDateTime(finish, true),
    });
    cursor.setUTCDate(cursor.getUTCDate() + windowDays);
  }
  return windows;
}

async function initNasSchema(pgConfig) {
  const result = await initIntelligencePostgresSchema(pgConfig);
  return result;
}

async function importHistoricalArtifact(filePath, importOptions, pgConfig) {
  const importResult = await runIntelligenceJob('import-historical', {
    filePath,
    options: importOptions,
  }, 15 * 60_000);
  if (!importResult?.result?.datasetId) {
    throw new Error(`historical import did not return datasetId for ${filePath}`);
  }
  const datasetId = importResult.result.datasetId;
  const syncResult = await runIntelligenceJob('postgres-sync-dataset-bulk', {
    config: pgConfig,
    dbPath: importOptions?.dbPath,
    datasetId,
    pageSize: 1000,
  }, 15 * 60_000);
  return { importResult, syncResult, datasetId };
}

async function ingestYahooFiveYear(state, pgConfig, {
  dbPath = defaultDbPath,
  fromDate,
  force = false,
  limit,
} = {}) {
  const symbols = buildYahooSymbols();
  const effectiveSymbols = typeof limit === 'number' && limit > 0 ? symbols.slice(0, limit) : symbols;
  const outDir = path.join(projectRoot, 'data', 'historical', 'nas-pipeline', 'yahoo-5y');
  await mkdir(outDir, { recursive: true });
  const results = [];
  for (const symbol of effectiveSymbols) {
    const datasetId = `yahoo-${symbol}-5y`;
    const stateKey = `${datasetId}:${formatDate(fromDate)}`;
    if (!force && state.yahoo[stateKey]) {
      results.push({ symbol, datasetId, skipped: true, reason: 'state' });
      continue;
    }
    const outFile = path.join(outDir, `${safeName(symbol)}-5y.json`);
    await runFetchScript('yahoo-chart', {
      symbol,
      range: '5y',
      interval: '1d',
      out: outFile,
    }, 60_000);
    const sync = await importHistoricalArtifact(outFile, {
      datasetId,
      provider: 'yahoo-chart',
      dbPath,
      bucketHours: 6,
      warmupFrameCount: 10,
    }, pgConfig);
    state.yahoo[stateKey] = {
      datasetId,
      symbol,
      outFile,
      syncedAt: nowIso(),
    };
    results.push({ symbol, datasetId, skipped: false, sync });
  }
  return results;
}

async function ingestFredFiveYear(state, pgConfig, {
  dbPath = defaultDbPath,
  fromDate,
  toDate = new Date(),
  force = false,
} = {}) {
  const outDir = path.join(projectRoot, 'data', 'historical', 'nas-pipeline', 'fred-5y');
  await mkdir(outDir, { recursive: true });
  const results = [];
  for (const series of defaultFredSeries) {
    const datasetId = `fred-${series}-5y`;
    const stateKey = `${datasetId}:${formatDate(fromDate)}`;
    if (!force && state.fred[stateKey]) {
      results.push({ series, datasetId, skipped: true, reason: 'state' });
      continue;
    }
    const outFile = path.join(outDir, `${safeName(series)}-5y.json`);
    await runFetchScript('fred', {
      series,
      observation_start: formatDate(fromDate),
      observation_end: formatDate(toDate),
      limit: '5000',
      out: outFile,
    }, 60_000);
    const sync = await importHistoricalArtifact(outFile, {
      datasetId,
      provider: 'fred',
      dbPath,
      bucketHours: 6,
      warmupFrameCount: 10,
    }, pgConfig);
    state.fred[stateKey] = {
      datasetId,
      series,
      outFile,
      syncedAt: nowIso(),
    };
    results.push({ series, datasetId, skipped: false, sync });
  }
  return results;
}

async function ingestGdeltBackfill(state, pgConfig, {
  dbPath = defaultDbPath,
  fromDate,
  toDate,
  mode = 'all',
  force = false,
  maxWindowsPerRun = 8,
  windowDays = 10,
  maxRecords = 250,
} = {}) {
  const specs = buildGdeltSpecs(mode);
  const windows = buildDateWindows(fromDate, toDate, windowDays);
  const tasks = [];
  for (const spec of specs) {
    for (const window of windows) {
      tasks.push({
        ...spec,
        start: window.start,
        end: window.end,
        taskId: `${spec.datasetId}:${window.start}:${window.end}`,
      });
    }
  }
  const outRoot = path.join(projectRoot, 'data', 'historical', 'nas-pipeline', 'gdelt-backfill');
  await mkdir(outRoot, { recursive: true });
  const touchedDatasets = new Set();
  const processed = [];
  let cursor = force ? 0 : intFlag(state.gdelt?.taskIndex, 0);
  for (let count = 0; count < maxWindowsPerRun && cursor < tasks.length; cursor += 1) {
    const task = tasks[cursor];
    const datasetDir = path.join(outRoot, safeName(task.datasetId));
    await mkdir(datasetDir, { recursive: true });
    const outFile = path.join(datasetDir, `${task.start}-${task.end}.json`);
    try {
      if (!fs.existsSync(outFile) || force) {
        await runFetchScript('gdelt-doc', {
          query: task.query,
          start: task.start,
          end: task.end,
          max: String(maxRecords),
          out: outFile,
        }, 60_000);
        await sleep(5_600);
      }
      await importHistoricalArtifact(outFile, {
        datasetId: task.datasetId,
        provider: 'gdelt-doc',
        dbPath,
        bucketHours: 6,
        warmupFrameCount: 10,
      }, pgConfig);
      touchedDatasets.add(task.datasetId);
      processed.push({ taskId: task.taskId, datasetId: task.datasetId, start: task.start, end: task.end, ok: true });
      count += 1;
    } catch (error) {
      processed.push({
        taskId: task.taskId,
        datasetId: task.datasetId,
        start: task.start,
        end: task.end,
        ok: false,
        error: String(error?.message || error),
      });
      break;
    }
  }
  state.gdelt = {
    ...(state.gdelt || {}),
    taskIndex: cursor,
    totalTasks: tasks.length,
    lastProcessedAt: nowIso(),
    lastProcessedTasks: processed.slice(-maxWindowsPerRun),
  };
  return {
    processed,
    touchedDatasets: [...touchedDatasets],
    cursor,
    totalTasks: tasks.length,
  };
}

async function syncAllExistingDatasets(pgConfig, {
  dbPath = defaultDbPath,
  datasetId = null,
  prefix = null,
  provider = null,
  requireCoverage = false,
  coverageFrom = null,
  coverageTo = null,
  toleranceDays = 45,
  limit = null,
} = {}) {
  const datasets = await listHistoricalDatasets(dbPath);
  const filtered = datasets
    .filter((item) => !datasetId || item.datasetId === datasetId)
    .filter((item) => datasetMatchesPrefix(item, prefix))
    .filter((item) => datasetMatchesProvider(item, provider))
    .filter((item) => !requireCoverage || datasetHasCoverage(item, coverageFrom, coverageTo, toleranceDays))
    .slice(0, limit && limit > 0 ? limit : undefined);
  const results = [];
  for (const dataset of filtered) {
    const syncResult = await runIntelligenceJob('postgres-sync-dataset-bulk', {
      config: pgConfig,
      dbPath,
      datasetId: dataset.datasetId,
      pageSize: 1000,
    }, 15 * 60_000);
    results.push({
      datasetId: dataset.datasetId,
      rawRecordCount: dataset.rawRecordCount,
      frameCount: dataset.frameCount,
      syncResult,
    });
  }
  return results;
}

async function syncReplayRunsFromCache(state, pgConfig, { limit = null, force = false } = {}) {
  const payload = await readJsonFile(persistentRunsPath, { data: { runs: [] } });
  const runs = Array.isArray(payload?.data?.runs) ? payload.data.runs : [];
  const selected = typeof limit === 'number' && limit > 0 ? runs.slice(0, limit) : runs;
  const results = [];
  for (const run of selected) {
    const runId = String(run?.id || '');
    const completedAt = String(run?.completedAt || '');
    if (!runId) continue;
    if (!force && state.runs?.[runId] === completedAt) {
      results.push({ runId, skipped: true, reason: 'state' });
      continue;
    }
    const syncResult = await runIntelligenceJob('postgres-upsert-run', {
      config: pgConfig,
      run,
    }, 60_000);
    state.runs[runId] = completedAt;
    results.push({ runId, skipped: false, syncResult });
  }
  return results;
}

function getDatasetCoverageWindow(dataset) {
  const from = dataset?.firstValidTime || dataset?.firstTransactionTime || null;
  const to = dataset?.lastValidTime || dataset?.lastTransactionTime || null;
  const fromTs = from ? Date.parse(String(from)) : Number.NaN;
  const toTs = to ? Date.parse(String(to)) : Number.NaN;
  return { from, to, fromTs, toTs };
}

function datasetMatchesPrefix(dataset, prefix) {
  if (!prefix) return true;
  return String(dataset?.datasetId || '').toLowerCase().startsWith(String(prefix).toLowerCase());
}

function datasetMatchesProvider(dataset, provider) {
  if (!provider) return true;
  return String(dataset?.provider || '').toLowerCase() === String(provider).toLowerCase();
}

function datasetHasCoverage(dataset, fromDate, toDate, toleranceDays = 45) {
  const { fromTs, toTs } = getDatasetCoverageWindow(dataset);
  if (!Number.isFinite(fromTs) || !Number.isFinite(toTs)) return false;
  const minFrom = fromDate.getTime();
  const minTo = toDate.getTime() - (toleranceDays * 24 * 60 * 60 * 1000);
  return fromTs <= minFrom && toTs >= minTo;
}

async function pushSnapshotsOnceIfConfigured(flags) {
  const root = String(flags['snapshot-root'] || process.env.WM_NAS_SNAPSHOT_ROOT || process.env.NAS_SNAPSHOT_ROOT || '').trim();
  if (!root) return { skipped: true, reason: 'snapshot root not configured' };
  const args = [path.join('scripts', 'push-backtest-snapshots-to-nas.mjs'), 'sync', `--root=${root}`];
  if (flags.force) args.push('--force=true');
  const { stdout } = await runNode(args, { timeoutMs: 15 * 60_000 });
  return childResultFromStdout(stdout);
}

async function runNewsArchiveIngest({ fromDate, toDate, source = 'all' }) {
  return await runNewsArchiveScript({
    source,
    from: formatMonth(fromDate),
    to: formatMonth(toDate),
  });
}

function buildStatusObject(state, pgConfig, dbPath) {
  return {
    now: nowIso(),
    dbPath,
    schema: pgConfig.schema,
    host: pgConfig.host || '(connectionString)',
    database: pgConfig.database || '(connectionString)',
    yahooCompleted: Object.keys(state.yahoo || {}).length,
    fredCompleted: Object.keys(state.fred || {}).length,
    gdeltTaskIndex: intFlag(state.gdelt?.taskIndex, 0),
    syncedRuns: Object.keys(state.runs || {}).length,
  };
}

async function main() {
  const { positional, flags } = parseArgs(process.argv.slice(2));
  const action = String(positional[0] || flags.action || 'full-cycle').trim().toLowerCase();
  const pgConfig = resolvePostgresConfig(flags);
  const state = await loadState();
  const dbPath = path.resolve(String(flags.dbPath || defaultDbPath));
  const toDate = flags.to ? new Date(String(flags.to)) : new Date();
  const fromDate = flags.from ? new Date(String(flags.from)) : shiftYears(toDate, -5);

  if (action === 'help') {
    console.log([
      'Usage:',
      '  node --import tsx scripts/backtest-nas-pipeline.mjs <action> [options]',
      '',
      'Actions:',
      '  status',
      '  init',
      '  news',
      '  markets',
      '  gdelt',
      '  sync-datasets',
      '  sync-runs',
      '  full-cycle',
      '',
      'Options:',
      '  --from 2021-04-01',
      '  --to 2026-04-01',
      '  --dbPath data/historical/intelligence-history.duckdb',
      '  --limit 10',
      '  --datasetId fred-CPIAUCSL-5y',
      '  --prefix yahoo- --provider yahoo-chart --require-coverage true',
      '  --coverage-from 2021-04-01 --coverage-to 2026-04-01 --tolerance-days 45',
      '  --gdelt-windows 8',
      '  --gdelt-mode global',
      '  --pg-host 192.168.0.76 --pg-port 5433 --pg-user postgres --pg-password <set-env-or-flag> --pg-database lattice',
      '  --snapshot-root \\\\NAS\\lattice-current\\backtest-snapshots',
      '  --force true',
    ].join('\n'));
    return;
  }

  if (action === 'status') {
    console.log(JSON.stringify(buildStatusObject(state, pgConfig, dbPath), null, 2));
    return;
  }

  if (action === 'init') {
    const result = await initNasSchema(pgConfig);
    console.log(JSON.stringify({ ok: true, result, status: buildStatusObject(state, pgConfig, dbPath) }, null, 2));
    return;
  }

  await initNasSchema(pgConfig);

  if (action === 'news') {
    const result = await runNewsArchiveIngest({ fromDate, toDate, source: String(flags.source || 'all') });
    console.log(JSON.stringify({ ok: true, action, from: formatMonth(fromDate), to: formatMonth(toDate), result }, null, 2));
    return;
  }

  if (action === 'markets') {
    const yahoo = await ingestYahooFiveYear(state, pgConfig, {
      dbPath,
      fromDate,
      force: boolFlag(flags.force, false),
      limit: flags.limit ? intFlag(flags.limit, null) : null,
    });
    const fred = await ingestFredFiveYear(state, pgConfig, {
      dbPath,
      fromDate,
      toDate,
      force: boolFlag(flags.force, false),
    });
    await saveState(state);
    console.log(JSON.stringify({ ok: true, action, yahoo, fred }, null, 2));
    return;
  }

  if (action === 'gdelt') {
    const result = await ingestGdeltBackfill(state, pgConfig, {
      dbPath,
      fromDate,
      toDate,
      force: boolFlag(flags.force, false),
      maxWindowsPerRun: intFlag(flags['gdelt-windows'], 8),
      windowDays: intFlag(flags['window-days'], 10),
      maxRecords: intFlag(flags.max, 250),
      mode: String(flags['gdelt-mode'] || 'all'),
    });
    await saveState(state);
    console.log(JSON.stringify({ ok: true, action, result }, null, 2));
    return;
  }

  if (action === 'sync-datasets') {
    const result = await syncAllExistingDatasets(pgConfig, {
      dbPath,
      datasetId: flags.datasetId ? String(flags.datasetId) : null,
      prefix: flags.prefix ? String(flags.prefix) : null,
      provider: flags.provider ? String(flags.provider) : null,
      requireCoverage: boolFlag(flags['require-coverage'], false),
      coverageFrom: flags['coverage-from'] ? new Date(String(flags['coverage-from'])) : fromDate,
      coverageTo: flags['coverage-to'] ? new Date(String(flags['coverage-to'])) : toDate,
      toleranceDays: intFlag(flags['tolerance-days'], 45),
      limit: flags.limit ? intFlag(flags.limit, null) : null,
    });
    console.log(JSON.stringify({ ok: true, action, synced: result.length, result }, null, 2));
    return;
  }

  if (action === 'sync-runs') {
    const result = await syncReplayRunsFromCache(state, pgConfig, {
      limit: flags.limit ? intFlag(flags.limit, null) : null,
      force: boolFlag(flags.force, false),
    });
    await saveState(state);
    console.log(JSON.stringify({ ok: true, action, synced: result.length, result }, null, 2));
    return;
  }

  if (action === 'full-cycle') {
    const includeNews = !flags['skip-news'];
    const yahoo = await ingestYahooFiveYear(state, pgConfig, {
      dbPath,
      fromDate,
      force: boolFlag(flags.force, false),
      limit: flags.limit ? intFlag(flags.limit, null) : null,
    });
    const fred = await ingestFredFiveYear(state, pgConfig, {
      dbPath,
      fromDate,
      force: boolFlag(flags.force, false),
    });
    const gdelt = await ingestGdeltBackfill(state, pgConfig, {
      dbPath,
      fromDate,
      toDate,
      force: boolFlag(flags.force, false),
      maxWindowsPerRun: intFlag(flags['gdelt-windows'], 8),
      windowDays: intFlag(flags['window-days'], 10),
      maxRecords: intFlag(flags.max, 250),
    });
    const runs = await syncReplayRunsFromCache(state, pgConfig, {
      force: boolFlag(flags.force, false),
    });
    let news = null;
    if (includeNews) {
      news = await runNewsArchiveIngest({ fromDate, toDate, source: String(flags.source || 'all') });
    }
    await saveState(state);
    const snapshot = await pushSnapshotsOnceIfConfigured(flags);
    console.log(JSON.stringify({
      ok: true,
      action,
      status: buildStatusObject(state, pgConfig, dbPath),
      news,
      yahoo: { total: yahoo.length, skipped: yahoo.filter((item) => item.skipped).length },
      fred: { total: fred.length, skipped: fred.filter((item) => item.skipped).length },
      gdelt,
      runs: { total: runs.length, skipped: runs.filter((item) => item.skipped).length },
      snapshot,
    }, null, 2));
    return;
  }

  throw new Error(`Unsupported action: ${action}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
