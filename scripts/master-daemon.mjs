#!/usr/bin/env node

import pg from 'pg';
import { execSync } from 'child_process';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { loadOptionalEnvFile, resolveNasPgConfig } from './_shared/nas-runtime.mjs';
import { createLogger } from './_shared/structured-logger.mjs';
import {
  MIN_15_MS,
  MIN_30_MS,
  HOUR_1_MS,
  HOUR_2_MS,
  HOUR_6_MS,
  DAY_1_MS,
  WEEK_1_MS,
} from './_shared/daemon-contract.mjs';
import { runBackup } from './_shared/pg-backup.mjs';
import { computeDataQualityMetrics } from './_shared/data-quality-check.mjs';
import { sendAlert } from './_shared/alert-notifier.mjs';

loadOptionalEnvFile();

// Process-level safety net: prevent the daemon from crashing on uncaught spawn
// errors (e.g. ENOENT for missing binaries like pg_dump). Individual tasks should
// catch their own errors, but if anything escapes we log and keep the loop alive.
process.on('uncaughtException', (err) => {
  try {
    const message = String(err?.stack || err?.message || err || 'unknown');
    process.stderr.write(`{"ts":"${new Date().toISOString()}","component":"master-daemon","level":"error","msg":"uncaughtException swallowed","ctx":{"error":"${message.replace(/[\r\n]/g, ' ').replace(/"/g, '\\"').slice(0, 800)}"}}\n`);
  } catch {
    // best-effort
  }
});
process.on('unhandledRejection', (reason) => {
  try {
    const message = String(reason?.stack || reason?.message || reason || 'unknown');
    process.stderr.write(`{"ts":"${new Date().toISOString()}","component":"master-daemon","level":"error","msg":"unhandledRejection swallowed","ctx":{"error":"${message.replace(/[\r\n]/g, ' ').replace(/"/g, '\\"').slice(0, 800)}"}}\n`);
  } catch {
    // best-effort
  }
});

const { Client } = pg;
const ONCE = process.argv.includes('--once');
const TASK_ONLY = process.argv.includes('--task')
  ? process.argv[process.argv.indexOf('--task') + 1]
  : null;

const CIRCUIT_BREAKER_FAILS = Number(process.env.DAEMON_CIRCUIT_BREAKER_FAILS || 3);
const CIRCUIT_BREAKER_COOLDOWN_MS = Number(process.env.DAEMON_CIRCUIT_BREAKER_COOLDOWN_MS || (30 * 60 * 1000));
const DASHBOARD_HEALTH_URL = String(process.env.EVENT_DASHBOARD_API_URL || 'http://127.0.0.1:46200/api/health').trim();
const DASHBOARD_HEALTH_TIMEOUT_MS = Number(process.env.DASHBOARD_HEALTH_TIMEOUT_MS || 60_000);
const DASHBOARD_RESTART_CMD = String(process.env.EVENT_DASHBOARD_RESTART_CMD || '').trim();
const DB_RESTART_CMD = String(process.env.DB_RESTART_CMD || '').trim();
const DUCKDB_SYNC_TIMEOUT_MS = Number(process.env.DUCKDB_SYNC_TIMEOUT_MS || (2 * HOUR_1_MS));
const STATE_PATH = 'data/daemon-state.json';
const logger = createLogger('master-daemon');

const runningTasks = new Set();
let pgConfig = null;
let pgConfigError = null;

function getPgConfig() {
  if (!pgConfig && !pgConfigError) {
    try {
      pgConfig = resolveNasPgConfig();
    } catch (error) {
      pgConfigError = error;
    }
  }
  if (!pgConfig) {
    throw pgConfigError;
  }
  return pgConfig;
}

function log(message) {
  logger.info(message);
}

function ensureDataDir() {
  if (!existsSync('data')) mkdirSync('data', { recursive: true });
}

function loadState() {
  try {
    if (existsSync(STATE_PATH)) {
      return JSON.parse(readFileSync(STATE_PATH, 'utf-8'));
    }
  } catch {
    // corrupted state: start fresh
  }

  return {
    lastRun: {},
    taskResults: {},
    failures: {},
    health: {},
  };
}

function saveState(state) {
  try {
    ensureDataDir();
    writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
  } catch (error) {
    log(`failed to save daemon state: ${error.message}`);
  }
}

function run(command, timeoutMs = 300_000) {
  logger.info('running shell command', { command, timeoutMs });
  try {
    execSync(command, {
      stdio: 'pipe',
      timeout: timeoutMs,
      env: { ...process.env },
      cwd: process.cwd(),
      windowsHide: true,
    });
    logger.metric('shell.success_count', 1);
    return { ok: true, error: '' };
  } catch (error) {
    const message = String(error?.message || error).slice(0, 200);
    logger.warn('shell command failed', { command, timeoutMs, error: message });
    logger.metric('shell.error_count', 1);
    return { ok: false, error: message };
  }
}

function listRunningNodeProcesses(scriptFragment) {
  const fragment = String(scriptFragment || '').trim();
  if (!fragment) return [];
  try {
    if (process.platform === 'win32') {
      const escaped = fragment.replace(/'/g, "''");
      const output = execSync(
        `powershell -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'node.exe' -and $_.CommandLine -match '${escaped}' } | Select-Object ProcessId,CommandLine | ConvertTo-Json -Compress"`,
        {
          stdio: 'pipe',
          timeout: 20_000,
          env: { ...process.env },
          cwd: process.cwd(),
          windowsHide: true,
        },
      ).toString('utf-8').trim();
      if (!output) return [];
      const parsed = JSON.parse(output);
      const rows = Array.isArray(parsed) ? parsed : [parsed];
      return rows
        .map((row) => ({
          pid: Number(row?.ProcessId || 0),
          commandLine: String(row?.CommandLine || ''),
        }))
        .filter((row) => row.pid > 0 && row.pid !== process.pid);
    }

    const output = execSync(`pgrep -af "${fragment.replace(/"/g, '\\"')}"`, {
      stdio: 'pipe',
      timeout: 20_000,
      env: { ...process.env },
      cwd: process.cwd(),
      windowsHide: true,
    }).toString('utf-8').trim();
    if (!output) return [];
    return output
      .split(/\r?\n/)
      .map((line) => {
        const match = line.match(/^(\d+)\s+(.+)$/);
        if (!match) return null;
        return { pid: Number(match[1]), commandLine: match[2] };
      })
      .filter((row) => row && row.pid > 0 && row.pid !== process.pid);
  } catch {
    return [];
  }
}

function shouldRun(taskName, intervalMs, state) {
  if (runningTasks.has(taskName)) {
    log(`  skip ${taskName}: previous run still in progress`);
    return false;
  }

  const failure = state.failures?.[taskName];
  if (failure?.disabledUntil && Date.now() < failure.disabledUntil) {
    log(`  skip ${taskName}: circuit open until ${new Date(failure.disabledUntil).toISOString()}`);
    return false;
  }

  const lastRun = state.lastRun?.[taskName] || 0;
  return Date.now() - lastRun >= intervalMs;
}

function computeCircuitBackoffMs(intervalMs, consecutiveFailures) {
  if (consecutiveFailures < CIRCUIT_BREAKER_FAILS) return 0;
  const exponent = Math.max(0, consecutiveFailures - CIRCUIT_BREAKER_FAILS);
  return Math.min(
    Math.max(intervalMs, CIRCUIT_BREAKER_COOLDOWN_MS) * Math.pow(2, exponent),
    6 * HOUR_1_MS,
  );
}

async function markDone(taskName, intervalMs, state, ok, error = '') {
  state.lastRun[taskName] = Date.now();
  const previous = state.failures?.[taskName] || { consecutive: 0, disabledUntil: 0, lastError: '' };
  const nextConsecutive = ok ? 0 : previous.consecutive + 1;
  const backoffMs = ok ? 0 : computeCircuitBackoffMs(intervalMs, nextConsecutive);
  const nextFailure = ok
    ? { consecutive: 0, disabledUntil: 0, lastError: '' }
    : {
      consecutive: nextConsecutive,
      disabledUntil: backoffMs > 0
        ? Date.now() + backoffMs
        : 0,
      lastError: error,
    };

  state.failures[taskName] = nextFailure;
  state.taskResults[taskName] = {
    ok,
    at: new Date().toISOString(),
    error,
    consecutiveFailures: nextFailure.consecutive,
  };
  saveState(state);

  if (!ok && backoffMs > 0 && previous.disabledUntil !== nextFailure.disabledUntil) {
    await sendAlert('warning', 'daemon circuit breaker tripped', {
      task: taskName,
      consecutiveFailures: nextFailure.consecutive,
      backoffMs,
      error,
    }).catch(() => {});
  }
}

async function runTask(state, taskName, intervalMs, handler) {
  if (!ONCE && !shouldRun(taskName, intervalMs, state)) return;

  runningTasks.add(taskName);
  let ok = false;
  let errorMessage = '';
  const startedAt = Date.now();

  try {
    const result = await handler();
    ok = result?.ok !== false;
    errorMessage = result?.error || '';
  } catch (error) {
    ok = false;
    errorMessage = String(error?.message || error);
    log(`>> ${taskName} FAILED: ${errorMessage}`);
  } finally {
    const durationMs = Date.now() - startedAt;
    logger.metric('task.duration_ms', durationMs, { task: taskName });
    logger.metric(ok ? 'task.success_count' : 'task.error_count', 1, { task: taskName });
    logger.info('task completed', {
      task: taskName,
      ok,
      durationMs,
      error: errorMessage || null,
    });
    await markDone(taskName, intervalMs, state, ok, errorMessage);
    runningTasks.delete(taskName);
  }
}

async function taskSignalRefresh() {
  log('>> signal-refresh: updating VIX/FRED in signal_history');
  const client = new Client(getPgConfig());
  await client.connect();
  try {
    const fallbackSignalNames = [
      'vix',
      'treasury10y',
      'yieldSpread',
      'dollarIndex',
      'hy_credit_spread',
      'ig_credit_spread',
      'bdi',
    ];
    const tableInfo = await client.query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name IN ('market_quotes', 'fred_observations')
    `);
    const availableTables = new Set(tableInfo.rows.map((row) => String(row.table_name || '').trim()));

    if (availableTables.has('market_quotes')) {
      await client.query(`
        INSERT INTO signal_history (signal_name, ts, value)
        SELECT 'vix', NOW(), last_price
        FROM market_quotes
        WHERE symbol = '^VIX'
        ORDER BY fetched_at DESC
        LIMIT 1
        ON CONFLICT (signal_name, ts) DO UPDATE SET value = EXCLUDED.value
      `).catch(() => log('  VIX refresh skipped: market_quotes exists but latest quote was unavailable'));
    } else {
      const { rows } = await client.query(`
        SELECT MAX(ts) AS latest_vix_ts
        FROM signal_history
        WHERE signal_name = 'vix'
      `);
      const latestVixTs = rows[0]?.latest_vix_ts ? Date.parse(String(rows[0].latest_vix_ts)) : 0;
      const vixAgeMs = latestVixTs > 0 ? (Date.now() - latestVixTs) : Number.POSITIVE_INFINITY;
      if (!Number.isFinite(vixAgeMs) || vixAgeMs > 18 * HOUR_1_MS) {
        log('  VIX refresh fallback: market_quotes missing, backfilling recent FRED series into signal_history');
        const fromDate = new Date(Date.now() - (45 * 24 * HOUR_1_MS)).toISOString().slice(0, 10);
        const result = run(`node --import tsx scripts/backfill-new-sources.mjs --source fred --from ${fromDate}`, 900_000);
        if (!result.ok) {
          return { ok: false, error: result.error || 'FRED fallback refresh failed' };
        }
      } else {
        log('  VIX refresh fallback skipped: existing signal_history is still fresh enough');
      }
    }

    if (availableTables.has('fred_observations')) {
      await client.query(`
        INSERT INTO signal_history (signal_name, ts, value)
        SELECT 'fred_' || series_id, NOW(), value
        FROM fred_observations
        WHERE observation_date = (SELECT MAX(observation_date) FROM fred_observations)
        ON CONFLICT (signal_name, ts) DO UPDATE SET value = EXCLUDED.value
      `).catch(() => log('  FRED refresh skipped: fred_observations exists but latest observations were unavailable'));
    } else {
      log('  FRED refresh uses signal_history/backfill-new-sources fallback because fred_observations table is absent');
    }

    await client.query(`
      INSERT INTO signal_history (signal_name, ts, value)
      SELECT signal_name, date_trunc('hour', NOW()), value
      FROM (
        SELECT DISTINCT ON (signal_name) signal_name, value
        FROM signal_history
        WHERE signal_name = ANY($1::text[])
        ORDER BY signal_name, ts DESC
      ) latest_signals
      ON CONFLICT (signal_name, ts) DO UPDATE SET value = EXCLUDED.value
    `, [fallbackSignalNames]).catch(() => log('  signal freshness mirror skipped: latest fallback signals unavailable'));

    log('>> signal-refresh: done');
    return { ok: true };
  } finally {
    await client.end();
  }
}

async function taskArticleCheck() {
  log('>> article-check: checking article freshness');
  const client = new Client(getPgConfig());
  await client.connect();
  try {
    const { rows } = await client.query(`
      SELECT
        COUNT(*)::int AS total,
        MAX(published_at) AS latest,
        COUNT(*) FILTER (WHERE published_at > NOW() - INTERVAL '1 day')::int AS last_24h
      FROM articles
    `);
    const summary = rows[0] || { total: 0, latest: null, last_24h: 0 };
    log(`  articles total=${summary.total}, latest=${summary.latest}, last_24h=${summary.last_24h}`);
    logger.metric('articles.last_24h', Number(summary.last_24h || 0));
    logger.metric('articles.total', Number(summary.total || 0));
    return { ok: true, error: Number(summary.last_24h) === 0 ? 'no recent articles in last 24h' : '' };
  } finally {
    await client.end();
  }
}

async function taskDashboardHealth(state) {
  log(`>> dashboard-health: checking ${DASHBOARD_HEALTH_URL}`);
  try {
    const response = await fetch(DASHBOARD_HEALTH_URL, { signal: AbortSignal.timeout(DASHBOARD_HEALTH_TIMEOUT_MS) });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const payload = await response.json();
    state.health.dashboard = {
      ok: true,
      checkedAt: new Date().toISOString(),
      payload,
    };
    logger.metric('dashboard.healthy', 1);
    saveState(state);
    return { ok: true };
  } catch (error) {
    const message = String(error?.message || error);
    state.health.dashboard = {
      ok: false,
      checkedAt: new Date().toISOString(),
      error: message,
    };
    logger.metric('dashboard.healthy', 0);
    saveState(state);

    if (DASHBOARD_RESTART_CMD) {
      log(`  dashboard-health: restart command triggered`);
      const restart = run(DASHBOARD_RESTART_CMD, 120_000);
      return { ok: restart.ok, error: restart.error || message };
    }

    return { ok: false, error: message };
  }
}

async function taskDbHealth(state) {
  log('>> db-health: checking NAS PostgreSQL');
  const config = getPgConfig();
  const client = new Client(config);
  try {
    await client.connect();
    const result = await client.query(`
      SELECT
        current_database() AS database_name,
        now() AS server_time,
        version() AS server_version
    `);
    const row = result.rows[0] || {};
    state.health.database = {
      ok: true,
      connected: true,
      checkedAt: new Date().toISOString(),
      database: String(row.database_name || ''),
      serverTime: new Date(String(row.server_time || new Date().toISOString())).toISOString(),
      version: String(row.server_version || ''),
    };
    saveState(state);
    return { ok: true };
  } catch (error) {
    const message = String(error?.message || error || 'database health failed');
    state.health.database = {
      ok: false,
      connected: false,
      checkedAt: new Date().toISOString(),
      error: message,
    };
    saveState(state);
    await sendAlert('critical', 'NAS database unreachable', {
      host: config.host,
      port: config.port,
      error: message,
    }).catch(() => {});

    if (DB_RESTART_CMD) {
      const restart = run(DB_RESTART_CMD, 120_000);
      return { ok: restart.ok, error: restart.error || message };
    }
    return { ok: false, error: message };
  } finally {
    await client.end().catch(() => {});
  }
}

async function taskDailyBackup(state) {
  log('>> daily-backup: creating PostgreSQL backup');
  let result;
  try {
    result = await runBackup(getPgConfig(), {
      backupDir: 'data/backups',
      retentionDays: 7,
    });
  } catch (err) {
    // Defensive: runBackup should return error objects, never throw,
    // but guard against any uncaught exception escaping the daemon process.
    result = {
      ok: false,
      skipped: true,
      error: String(err?.message || err || 'backup threw unexpectedly'),
    };
  }
  state.health.lastBackup = {
    ...result,
    checkedAt: new Date().toISOString(),
  };
  saveState(state);
  if (!result.ok && !result.skipped) {
    await sendAlert('critical', 'postgres backup failed', {
      error: result.error,
    }).catch(() => {});
  } else if (result.skipped) {
    log(`  daily-backup skipped: ${result.error}`);
    // Treat skipped as success-with-warning so the daemon does not enter circuit breaker.
    return { ok: true, skipped: true, error: result.error };
  }
  return result;
}

async function taskDuckdbSync() {
  const inFlight = listRunningNodeProcesses('sync-nas-to-duckdb\\.mjs');
  if (inFlight.length > 0) {
    log(`  duckdb-sync: skip because another sync process is already running (pid ${inFlight[0].pid})`);
    return { ok: true };
  }
  log('>> duckdb-sync: syncing NAS historical data to DuckDB cache');
  const result = run('node --import tsx scripts/sync-nas-to-duckdb.mjs --batch-size 500', DUCKDB_SYNC_TIMEOUT_MS);
  return { ok: result.ok, error: result.error };
}

async function taskDataQuality(state) {
  log('>> data-quality: computing data freshness and integrity report');
  const client = new Client(getPgConfig());
  await client.connect();
  try {
    const report = await computeDataQualityMetrics(client);
    state.health.dataQuality = {
      ...report,
      checkedAt: new Date().toISOString(),
    };
    saveState(state);
    if (report.overall < 0.6) {
      logger.warn('data quality degraded', report);
      await sendAlert('warning', 'data quality degraded', {
        overall: report.overall,
        articleFreshness: report.articleFreshness,
        signalFreshness: report.signalFreshness,
        outcomeCompleteness: report.outcomeCompleteness,
      }).catch(() => {});
    }
    return { ok: report.overall >= 0.35, error: report.overall >= 0.35 ? '' : 'critical data quality degradation' };
  } finally {
    await client.end().catch(() => {});
  }
}

async function taskDiscoverEmergingTech() {
  log('>> discover-emerging-tech: clustering potentially emerging topics');
  const result = run('node --import tsx scripts/discover-emerging-tech.mjs --limit 20000', 1_200_000);
  return { ok: result.ok, error: result.error };
}

async function taskArxivBackfill() {
  log('>> arxiv-backfill: ingesting broad arXiv archive window');
  const result = run('node --import tsx scripts/fetch-arxiv-archive.mjs --since 2021-01-01 --max-batches 5', 1_200_000);
  return { ok: result.ok, error: result.error };
}

async function taskHackerNewsBackfill() {
  log('>> hackernews-backfill: ingesting Hacker News archive window through Algolia search');
  const result = run(
    'node --import tsx scripts/fetch-hackernews-archive.mjs --since 2021-01-01 --score-min 20 --hits-per-page 100 --max-pages 25 --throttle-ms 100',
    1_200_000,
  );
  return { ok: result.ok, error: result.error };
}

async function taskLabelDiscoveryTopics() {
  log('>> label-discovery-topics: labeling pending emerging-tech topics');
  const result = run('node --import tsx scripts/label-discovery-topics.mjs --limit 5', 600_000);
  return { ok: result.ok, error: result.error };
}

async function taskGenerateTechReport() {
  log('>> generate-tech-report: generating operator tracking notes for labeled topics');
  const result = run('node --import tsx scripts/generate-tech-report.mjs --limit 5', 600_000);
  return { ok: result.ok, error: result.error };
}

async function taskGenerateWeeklyDigest() {
  log('>> generate-weekly-digest: building weekly emerging-tech digest');
  const result = run('node --import tsx scripts/generate-weekly-digest.mjs', 600_000);
  return { ok: result.ok, error: result.error };
}

async function taskGenerateFollowedThemeBriefings() {
  log('>> generate-followed-theme-briefings: persisting weekly structural briefing snapshot');
  const result = run('node --import tsx scripts/generate-followed-theme-briefings.mjs --period week --limit 6', 600_000);
  return { ok: result.ok, error: result.error };
}

async function taskMigrateTaxonomy() {
  log('>> migrate-taxonomy: normalizing legacy themes, discovery topics, and canonical taxonomy mappings');
  const result = run(
    'node --import tsx scripts/migrate-taxonomy.mjs --no-rebuild-aggregates --no-rebuild-curation --no-rebuild-weekly-digest --no-reset-aggregates',
    1_200_000,
  );
  return { ok: result.ok, error: result.error };
}

async function taskComputeTrendAggregates() {
  log('>> compute-trend-aggregates: building long-horizon theme aggregates');
  const result = run('node --import tsx scripts/compute-trend-aggregates.mjs --period week,month,quarter,year', 1_200_000);
  return { ok: result.ok, error: result.error };
}

async function taskCurateDailyNews() {
  log('>> curate-daily-news: ranking and summarizing dashboard curation set');
  const result = run('node --import tsx scripts/curate-daily-news.mjs --limit 5 --refresh-aggregates', 900_000);
  return { ok: result.ok, error: result.error };
}

async function taskSecSeedUniverse() {
  log('>> sec-seed-universe: refreshing SEC-backed seed-company exposure map');
  const result = run(
    'node --import tsx scripts/refresh-sec-theme-exposure.mjs --max-facts 100 --max-filings 25 --delay-ms 400',
    1_200_000,
  );
  return { ok: result.ok, error: result.error };
}

async function taskOpenAlexThemeEvidence() {
  log('>> openalex-theme-evidence: refreshing OpenAlex research evidence for canonical themes');
  const result = run(
    'node --import tsx scripts/fetch-openalex-theme-evidence.mjs --themes ai-ml,quantum-computing,robotics-automation,biotech,materials-science,space --limit 8 --from-date 2021-01-01',
    1_200_000,
  );
  return { ok: result.ok, error: result.error };
}

async function taskGitHubThemeEvidence() {
  log('>> github-theme-evidence: refreshing GitHub code evidence for canonical technology themes');
  const result = run(
    'node --import tsx scripts/fetch-github-theme-evidence.mjs --themes ai-ml,quantum-computing,robotics-automation,developer-platforms,cloud-infrastructure,space --limit 8',
    1_200_000,
  );
  return { ok: result.ok, error: result.error };
}

async function taskGenerateStructuralAlerts() {
  log('>> generate-structural-alerts: materializing low-noise structural alerts from trend and evolution aggregates');
  const result = run(
    'node --import tsx scripts/generate-structural-alerts.mjs --period week --limit 60',
    900_000,
  );
  return { ok: result.ok, error: result.error };
}

async function taskGenerateCodexThemeProposals() {
  log('>> generate-codex-theme-proposals: promoting high-signal discovery topics into pending add-theme proposals');
  const result = run(
    'node --import tsx scripts/generate-codex-theme-proposals.mjs --limit 2',
    900_000,
  );
  return { ok: result.ok, error: result.error };
}

async function taskAutoCurate() {
  log('>> auto-curate: generating Codex curation proposals');
  const result = run('node --import tsx scripts/auto-curate.mjs', 600_000);
  return { ok: result.ok, error: result.error };
}

async function taskCoverageGapAnalysis() {
  log('>> coverage-gap-analysis: proposing conditional sensitivity for unused signals');
  const result = run('node --import tsx scripts/analyze-coverage-gaps.mjs', 600_000);
  return { ok: result.ok, error: result.error };
}

async function taskSourceSelfHeal() {
  log('>> source-self-heal: validating and activating approved healing candidates');
  const result = run('node --import tsx scripts/self-heal-sources.mjs --limit 8', 600_000);
  return { ok: result.ok, error: result.error };
}

async function taskAutoPipelineLabels() {
  log('>> auto-pipeline-labels: running step 3 (label assignment)');
  const result = run('node --import tsx scripts/auto-pipeline.mjs --step 3 --limit 200', 600_000);
  return { ok: result.ok, error: result.error };
}

async function taskAutoPipelineSensitivity() {
  log('>> auto-pipeline-sensitivity: running step 5 (sensitivity refresh)');
  const result = run('node --import tsx scripts/auto-pipeline.mjs --step 5', 600_000);
  return { ok: result.ok, error: result.error };
}

async function taskSensitivityRefresh() {
  log('>> sensitivity-refresh: touching recently updated themes');
  const client = new Client(getPgConfig());
  await client.connect();
  try {
    const updated = await client.query(`
      UPDATE conditional_sensitivity cs
      SET updated_at = NOW()
      FROM (
        SELECT DISTINCT theme
        FROM labeled_outcomes
        WHERE created_at > NOW() - INTERVAL '2 hours'
      ) recent
      WHERE cs.theme = recent.theme
    `).catch(() => ({ rowCount: 0 }));

    log(`  conditional_sensitivity rows touched: ${updated.rowCount || 0}`);
    return { ok: true };
  } finally {
    await client.end();
  }
}

async function taskMasterPipeline() {
  log('>> master-pipeline: running steps 0 + 1 without codex');
  const result = run('node --import tsx scripts/master-pipeline.mjs --no-codex --step 0 --step 1', 600_000);
  return { ok: result.ok, error: result.error };
}

async function taskExecutor() {
  log('>> executor: running proposal-executor');
  const result = run('node --import tsx scripts/proposal-executor.mjs', 300_000);
  return { ok: result.ok, error: result.error };
}

async function taskPendingCheck() {
  log('>> pending-check: resolving due pending_outcomes');
  const { checkPendingOutcomes } = await import('../src/services/article-ingestor.ts');
  const { closeIngestorPool } = await import('../src/services/article-ingestor.ts');
  try {
    const summary = await checkPendingOutcomes();
    log(`  pending-check resolved=${summary.resolvedCount || 0}, scanned=${summary.checkedCount || 0}`);
    return { ok: true };
  } finally {
    await closeIngestorPool().catch(() => {});
  }
}

async function taskFullRebuild() {
  log('>> full-rebuild: running full master-pipeline without codex');
  const result = run('node --import tsx scripts/master-pipeline.mjs --no-codex', 1_200_000);
  return { ok: result.ok, error: result.error };
}

async function taskDailyReport(state) {
  log('>> daily-report: generating report');
  const client = new Client(getPgConfig());
  await client.connect();
  try {
    const today = new Date().toISOString().slice(0, 10);
    const [articles, outcomes, signals, proposals, pending] = await Promise.all([
      client.query(`
        SELECT COUNT(*)::int AS total,
               COUNT(*) FILTER (WHERE published_at > NOW() - INTERVAL '1 day')::int AS new_24h
        FROM articles
      `).catch(() => ({ rows: [{ total: 0, new_24h: 0 }] })),
      client.query(`
        SELECT COUNT(*)::int AS total,
               COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '1 day')::int AS new_24h
        FROM labeled_outcomes
      `).catch(() => ({ rows: [{ total: 0, new_24h: 0 }] })),
      client.query(`
        SELECT signal_name, MAX(ts) AS latest, COUNT(*)::int AS points
        FROM signal_history
        GROUP BY signal_name
        ORDER BY signal_name
      `).catch(() => ({ rows: [] })),
      client.query(`
        SELECT status, COUNT(*)::int AS cnt
        FROM codex_proposals
        GROUP BY status
      `).catch(() => ({ rows: [] })),
      client.query(`
        SELECT COUNT(*)::int AS total,
               COUNT(*) FILTER (WHERE target_date <= NOW() AND resolved_at IS NULL)::int AS overdue
        FROM pending_outcomes
      `).catch(() => ({ rows: [{ total: 0, overdue: 0 }] })),
    ]);

    ensureDataDir();
    const report = {
      date: today,
      generatedAt: new Date().toISOString(),
      articles: articles.rows[0],
      labeledOutcomes: outcomes.rows[0],
      signals: signals.rows,
      proposals: proposals.rows,
      pendingOutcomes: pending.rows[0],
      daemonState: state,
    };

    writeFileSync(`data/daily-report-${today}.json`, JSON.stringify(report, null, 2));
    return { ok: true };
  } finally {
    await client.end();
  }
}

const TASKS = {
  'signal-refresh': { interval: MIN_15_MS, fn: taskSignalRefresh },
  'article-check': { interval: MIN_30_MS, fn: taskArticleCheck },
  'dashboard-health': { interval: MIN_30_MS, fn: taskDashboardHealth },
  'db-health': { interval: MIN_15_MS, fn: taskDbHealth },
  'auto-pipeline-labels': { interval: HOUR_2_MS, fn: taskAutoPipelineLabels },
  'auto-pipeline-sensitivity': { interval: HOUR_1_MS, fn: taskAutoPipelineSensitivity },
  'sensitivity-refresh': { interval: HOUR_1_MS, fn: taskSensitivityRefresh },
  'master-pipeline': { interval: HOUR_6_MS, fn: taskMasterPipeline },
  'executor': { interval: HOUR_6_MS, fn: taskExecutor },
  'duckdb-sync': { interval: HOUR_6_MS, fn: taskDuckdbSync },
  'data-quality': { interval: HOUR_6_MS, fn: taskDataQuality },
  'arxiv-backfill': { interval: HOUR_6_MS, fn: taskArxivBackfill },
  'hackernews-backfill': { interval: HOUR_6_MS, fn: taskHackerNewsBackfill },
  'discover-emerging-tech': { interval: HOUR_6_MS, fn: taskDiscoverEmergingTech },
  'label-discovery-topics': { interval: HOUR_6_MS, fn: taskLabelDiscoveryTopics },
  'generate-tech-report': { interval: HOUR_6_MS, fn: taskGenerateTechReport },
    'source-self-heal': { interval: HOUR_6_MS, fn: taskSourceSelfHeal },
    'pending-check': { interval: DAY_1_MS, fn: taskPendingCheck },
    'full-rebuild': { interval: DAY_1_MS, fn: taskFullRebuild },
    'daily-backup': { interval: DAY_1_MS, fn: taskDailyBackup },
    'daily-report': { interval: DAY_1_MS, fn: taskDailyReport },
    'migrate-taxonomy': { interval: DAY_1_MS, fn: taskMigrateTaxonomy },
    'compute-trend-aggregates': { interval: DAY_1_MS, fn: taskComputeTrendAggregates },
    'curate-daily-news': { interval: DAY_1_MS, fn: taskCurateDailyNews },
    'sec-seed-universe': { interval: DAY_1_MS, fn: taskSecSeedUniverse },
  'openalex-theme-evidence': { interval: DAY_1_MS, fn: taskOpenAlexThemeEvidence },
  'github-theme-evidence': { interval: DAY_1_MS, fn: taskGitHubThemeEvidence },
  'generate-structural-alerts': { interval: DAY_1_MS, fn: taskGenerateStructuralAlerts },
  'generate-codex-theme-proposals': { interval: HOUR_6_MS, fn: taskGenerateCodexThemeProposals },
  'generate-followed-theme-briefings': { interval: DAY_1_MS, fn: taskGenerateFollowedThemeBriefings },
  'generate-weekly-digest': { interval: DAY_1_MS, fn: taskGenerateWeeklyDigest },
  'coverage-gap-analysis': { interval: DAY_1_MS, fn: taskCoverageGapAnalysis },
  'auto-curate': { interval: WEEK_1_MS, fn: taskAutoCurate },
};

async function runAllTasks(state) {
  for (const [taskName, task] of Object.entries(TASKS)) {
    if (TASK_ONLY && TASK_ONLY !== taskName) continue;
    await runTask(state, taskName, task.interval, () => task.fn(state));
  }
}

async function main() {
  process.stderr.write('\nMaster Daemon Started\n');
  process.stderr.write('  15min: signal refresh, db health\n');
  process.stderr.write('  30min: article check, dashboard health\n');
  process.stderr.write('  1h:    auto-pipeline-sensitivity, sensitivity refresh\n');
  process.stderr.write('  2h:    auto-pipeline-labels\n');
    process.stderr.write('  6h:    master-pipeline, executor, duckdb sync, data quality, arxiv, hackernews, discovery, reports, self-heal\n');
    process.stderr.write('  daily: pending check, full rebuild, daily backup, daily report, taxonomy migration, trend aggregates,\n');
    process.stderr.write('         curated daily news, sec seed universe, openalex theme evidence, followed-theme briefings, weekly digest, coverage-gap-analysis\n');
  process.stderr.write('  6h+:   codex theme proposals from discovery topics\n');
  process.stderr.write('  weekly:auto-curate\n\n');

  const state = loadState();

  process.on('unhandledRejection', (error) => {
    log(`unhandledRejection: ${String(error?.stack || error?.message || error)}`);
  });
  process.on('uncaughtExceptionMonitor', (error) => {
    log(`uncaughtExceptionMonitor: ${String(error?.stack || error?.message || error)}`);
  });

  process.on('SIGINT', () => {
    log('received SIGINT, shutting down');
    saveState(loadState());
    process.exit(0);
  });
  process.on('SIGTERM', () => {
    log('received SIGTERM, shutting down');
    saveState(loadState());
    process.exit(0);
  });

  if (TASK_ONLY && !TASKS[TASK_ONLY]) {
    process.stderr.write(`Unknown task: ${TASK_ONLY}\nAvailable: ${Object.keys(TASKS).join(', ')}\n`);
    process.exit(1);
  }

  await runAllTasks(state);
  if (ONCE) return;

  setInterval(async () => {
    const currentState = loadState();
    await runAllTasks(currentState);
  }, MIN_15_MS);

  log('daemon running');
}

main().catch((error) => {
  process.stderr.write(`${String(error?.stack || error?.message || error)}\n`);
  process.exit(1);
});
