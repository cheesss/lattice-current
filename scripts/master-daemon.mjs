#!/usr/bin/env node

import pg from 'pg';
import { execFileSync, execSync, spawn } from 'child_process';
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
const TASK_ONLY = process.argv.includes('--task')
  ? process.argv[process.argv.indexOf('--task') + 1]
  : null;
const ONCE = process.argv.includes('--once') || Boolean(TASK_ONLY);

const CIRCUIT_BREAKER_FAILS = Number(process.env.DAEMON_CIRCUIT_BREAKER_FAILS || 3);
const CIRCUIT_BREAKER_COOLDOWN_MS = Number(process.env.DAEMON_CIRCUIT_BREAKER_COOLDOWN_MS || (30 * 60 * 1000));
const DASHBOARD_HEALTH_URL = String(process.env.EVENT_DASHBOARD_API_URL || 'http://127.0.0.1:46200/api/health').trim();
const DASHBOARD_HEALTH_TIMEOUT_MS = Number(process.env.DASHBOARD_HEALTH_TIMEOUT_MS || 60_000);
const DASHBOARD_RESTART_CMD = String(process.env.EVENT_DASHBOARD_RESTART_CMD || '').trim();
const SIDECAR_PORT = Number(process.env.SIDECAR_PORT || 46123);
const SIDECAR_HEALTH_URL = String(process.env.SIDECAR_HEALTH_URL || `http://127.0.0.1:${SIDECAR_PORT}/api/local-runtime-observability`).trim();
const SIDECAR_HEALTH_TIMEOUT_MS = Number(process.env.SIDECAR_HEALTH_TIMEOUT_MS || 10_000);
const DAEMON_START_SIDECAR = process.env.DAEMON_START_SIDECAR === 'true';
const DB_RESTART_CMD = String(process.env.DB_RESTART_CMD || '').trim();
const DUCKDB_SYNC_TIMEOUT_MS = Number(process.env.DUCKDB_SYNC_TIMEOUT_MS || (2 * HOUR_1_MS));
const LEGACY_DUCKDB_SYNC_ENABLED = process.env.ENABLE_LEGACY_DUCKDB_SYNC === 'true';
const RUN_MAX_BUFFER_BYTES = Math.max(1024 * 1024, Number(process.env.DAEMON_RUN_MAX_BUFFER_BYTES || 64 * 1024 * 1024));
const STATE_PATH = 'data/daemon-state.json';
const logger = createLogger('master-daemon');

function optionalTimeoutMs(value, fallback = 0, min = 1, max = Number.MAX_SAFE_INTEGER) {
  if (value === undefined || value === null || value === '') return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (['0', 'off', 'none', 'false', 'disabled', 'no'].includes(normalized)) return 0;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.max(min, Math.min(max, Math.floor(parsed)));
}

function timeoutLabel(timeoutMs) {
  return Number.isFinite(timeoutMs) && timeoutMs > 0 ? Math.floor(timeoutMs) : 'disabled';
}

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
      return normalizeDaemonState(JSON.parse(readFileSync(STATE_PATH, 'utf-8')));
    }
  } catch {
    // corrupted state: start fresh
  }

  return normalizeDaemonState({
    lastRun: {},
    taskResults: {},
    failures: {},
    health: {},
  });
}

function normalizeDaemonState(state) {
  const next = {
    lastRun: {},
    taskResults: {},
    failures: {},
    health: {},
    ...(state || {}),
  };
  const reportClosureFailure = next.failures?.['report-closure'];
  if (
    reportClosureFailure?.disabledUntil
    && /Invalid string length/i.test(String(reportClosureFailure.lastError || ''))
  ) {
    next.failures['report-closure'] = { consecutive: 0, disabledUntil: 0, lastError: '' };
    next.lastRun['report-closure'] = 0;
    next.taskResults['report-closure'] = {
      ok: true,
      at: new Date().toISOString(),
      error: '',
      consecutiveFailures: 0,
      note: 'cleared stale serialization_failed circuit after compact report-closure stdout patch',
    };
  }
  return next;
}

function saveState(state) {
  try {
    ensureDataDir();
    writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
  } catch (error) {
    log(`failed to save daemon state: ${error.message}`);
  }
}

function markHeartbeat(state, phase = 'idle') {
  state.heartbeat = {
    ...(state.heartbeat || {}),
    masterDaemonAt: new Date().toISOString(),
    phase,
    pid: process.pid,
  };
  saveState(state);
}

function runningHeartbeatPhase(fallback = 'idle') {
  if (runningTasks.size === 0) return fallback;
  return `running:${Array.from(runningTasks).join(',').slice(0, 120)}`;
}

function run(command, timeoutMs = 300_000) {
  const normalizedTimeoutMs = optionalTimeoutMs(timeoutMs, timeoutMs, 1_000, 24 * HOUR_1_MS);
  const timeoutDisabled = !(Number.isFinite(normalizedTimeoutMs) && normalizedTimeoutMs > 0);
  const started = Date.now();
  logger.info('running shell command', { command, timeoutMs: timeoutLabel(normalizedTimeoutMs) });
  try {
    const execOptions = {
      stdio: 'pipe',
      env: { ...process.env },
      cwd: process.cwd(),
      windowsHide: true,
      maxBuffer: RUN_MAX_BUFFER_BYTES,
    };
    if (!timeoutDisabled) execOptions.timeout = normalizedTimeoutMs;
    execSync(command, execOptions);
    const durationMs = Date.now() - started;
    logger.info('shell command completed', { command, timeoutMs: timeoutLabel(normalizedTimeoutMs), durationMs });
    logger.metric('shell.success_count', 1);
    return { ok: true, error: '', durationMs };
  } catch (error) {
    const durationMs = Date.now() - started;
    const message = String(error?.message || error).slice(0, 200);
    logger.warn('shell command failed', { command, timeoutMs: timeoutLabel(normalizedTimeoutMs), durationMs, error: message });
    logger.metric('shell.error_count', 1);
    return { ok: false, error: message, durationMs };
  }
}

function runNodeScript(scriptPath, args = [], timeoutMs = 300_000) {
  const argv = [scriptPath, ...args.map((arg) => String(arg))];
  const normalizedTimeoutMs = optionalTimeoutMs(timeoutMs, timeoutMs, 1_000, 24 * HOUR_1_MS);
  const timeoutDisabled = !(Number.isFinite(normalizedTimeoutMs) && normalizedTimeoutMs > 0);
  const started = Date.now();
  logger.info('running node script', {
    scriptPath,
    args: argv.slice(1),
    timeoutMs: timeoutLabel(normalizedTimeoutMs),
  });
  try {
    const execOptions = {
      stdio: 'pipe',
      env: { ...process.env },
      cwd: process.cwd(),
      windowsHide: true,
      maxBuffer: RUN_MAX_BUFFER_BYTES,
    };
    if (!timeoutDisabled) execOptions.timeout = normalizedTimeoutMs;
    execFileSync(process.execPath, argv, execOptions);
    const durationMs = Date.now() - started;
    logger.info('node script completed', {
      scriptPath,
      timeoutMs: timeoutLabel(normalizedTimeoutMs),
      durationMs,
    });
    logger.metric('shell.success_count', 1);
    return { ok: true, error: '', durationMs };
  } catch (error) {
    const durationMs = Date.now() - started;
    const stderr = error?.stderr?.toString?.() || '';
    const stdout = error?.stdout?.toString?.() || '';
    let artifactPath = '';
    let compactChildError = '';
    try {
      const parsed = JSON.parse(String(stdout || stderr || '').trim());
      artifactPath = parsed?.artifactPath || '';
      compactChildError = parsed?.error || parsed?.errorSummary || '';
    } catch {
      // child output was not compact JSON
    }
    const message = String(compactChildError || stderr || stdout || error?.message || error)
      .replace(/\s+/g, ' ')
      .slice(0, 400);
    logger.warn('node script failed', {
      scriptPath,
      timeoutMs: timeoutLabel(normalizedTimeoutMs),
      durationMs,
      error: message,
      artifactPath: artifactPath || undefined,
    });
    logger.metric('shell.error_count', 1);
    return { ok: false, error: artifactPath ? `${message} artifactPath=${artifactPath}` : message, durationMs, artifactPath };
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

function findPersistentMasterDaemonPeers() {
  return listRunningNodeProcesses('master-daemon\\.mjs')
    .filter((row) => !/(^|\s)--task(\s|=|$)/.test(row.commandLine))
    .filter((row) => !/(^|\s)--once(\s|$)/.test(row.commandLine));
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
  markHeartbeat(state, runningHeartbeatPhase());
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
    markHeartbeat(state, runningHeartbeatPhase());
  }
}

async function taskSignalRefresh() {
  log('>> signal-refresh: refreshing FRED macro signals without copy-forward mirroring');
  const result = run('node scripts/refresh-fred-signals-to-nas.mjs', 300_000);
  return { ok: result.ok, error: result.error };
}

async function taskFredBackfill() {
  log('>> fred-backfill: repairing FRED historical gaps before freshness audits');
  const result = run('node --import tsx scripts/backfill-new-sources.mjs --source fred', 1_200_000);
  return { ok: result.ok, error: result.error };
}

async function taskMarketQuoteRefresh() {
  log('>> market-quote-refresh: fetching delayed market quotes into NAS market_quotes');
  const result = run('node scripts/refresh-market-quotes-to-nas.mjs --include-auto-theme-symbols --auto-theme-symbol-limit 160', 300_000);
  return { ok: result.ok, error: result.error };
}

async function taskBootstrapMarketQuoteHistory() {
  log('>> bootstrap-market-quote-history: ensuring 1y daily history for core + auto-theme symbols');
  const result = run('node scripts/bootstrap-market-quotes-history.mjs --include-auto-theme-symbols --range 1y', 3_600_000);
  return { ok: result.ok, error: result.error };
}

async function taskBuildMarketReturns() {
  log('>> build-market-returns: rebuilding date-based market_returns table for event-engine joins');
  const result = run('node --import tsx scripts/build-market-returns.mjs', 1_800_000);
  return { ok: result.ok, error: result.error };
}

async function taskTrainMetaModel() {
  log('>> train-meta-model: weekly retrain pass (full epochs)');
  const py = process.env.PYTHON_BIN || 'python';
  // Train script supports --dry-run, --epochs, --lr, --splits. No skip flag —
  // weekly cadence is the throttle.
  const result = run(`${py} scripts/train-meta-model.py`, 3_600_000);
  return { ok: result.ok, error: result.error };
}

async function taskEventEngineIncremental() {
  log('>> event-engine-incremental: materializing recent articles into canonical_events and event_features');
  const result = run('node scripts/incremental-event-engine-fast.mjs --skip-controls', 300_000);
  return { ok: result.ok, error: result.error };
}

/**
 * S-Tier N6: daily controls + uplift backfill.
 *
 * The hourly taskEventEngineIncremental uses --skip-controls for speed
 * (controls + uplift compute is heavy). Without a counterpart that DOES
 * compute controls + uplift, recent events never get evidence grades —
 * dashboard shows zero validated signals for 5+ weeks.
 *
 * This task runs the full pipeline (no --skip-controls) once a day, with
 * an extended timeout so the controls compute can finish even on a backlog.
 * The pipeline-lock + idempotent upsert pattern means this overlaps safely
 * with the hourly task.
 */
async function taskEventEngineFullControls() {
  const repairDays = Math.max(30, Math.min(365, Number(process.env.EVENT_UPLIFT_REPAIR_DAYS) || 90));
  log(`>> event-engine-full-controls: bounded recent controls + uplift repair (${repairDays}d)`);
  const result = run(`node --import tsx scripts/repair-recent-event-uplift.mjs --days ${repairDays} --limit 5000`, 3_600_000);
  return { ok: result.ok, error: result.error };
}

/**
 * S-Level §Phase 3: stale feature/prediction repair.
 *
 * Hourly task-event-engine-incremental processes new articles. This 4h task is
 * a dedicated detector + repair pass for rows where:
 *   event_features.computed_at < latest article published_at for that event
 *
 * If any are detected, run incremental-event-engine-fast to upsert. The event
 * engine is already idempotent and pipeline-lock-guarded, so collision with
 * the hourly task is safe (one will wait for the other to release the lock).
 *
 * Threshold: trigger repair if stale count > 0 OR features lag latest article
 * date by >= 1 day. Below threshold, log only.
 */
async function taskRepairStaleFeatures() {
  log('>> repair-stale-features: detecting and re-upserting stale event_features rows');
  let staleCount = 0;
  let metricMismatchCount = 0;
  let lagDays = 0;
  try {
    const { Client } = await import('pg');
    const { resolveNasPgConfig } = await import('./_shared/nas-runtime.mjs');
    const client = new Client(resolveNasPgConfig());
    await client.connect();
    try {
      const { rows } = await client.query(`
        WITH event_latest AS (
          SELECT aem.canonical_event_id,
                 MAX(a.published_at) AS latest_article_at
            FROM article_event_map aem
            JOIN articles a ON a.id = aem.article_id
           GROUP BY aem.canonical_event_id
        ),
        feature_status AS (
          SELECT ef.canonical_event_id,
                 ef.computed_at,
                 el.latest_article_at,
                 (el.latest_article_at IS NOT NULL
                   AND ef.computed_at IS NOT NULL
                   AND el.latest_article_at > ef.computed_at) AS is_stale
            FROM event_features ef
            LEFT JOIN event_latest el ON el.canonical_event_id = ef.canonical_event_id
        )
        SELECT
          COUNT(*) FILTER (WHERE is_stale)::int AS stale_count,
          (
            SELECT COUNT(*)::int
              FROM canonical_events ce
              JOIN event_features ef ON ef.canonical_event_id = ce.id
             WHERE ce.event_date >= NOW()::date - INTERVAL '14 days'
               AND (
                 COALESCE(ce.source_count, -1) <> COALESCE(ef.source_count, -1)
                 OR COALESCE(ce.article_count, -1) <> COALESCE(ef.article_count, -1)
                 OR ABS(COALESCE(ce.source_diversity, -1) - COALESCE(ef.source_diversity, -1)) > 0.0001
               )
          ) AS metric_mismatch_count,
          COALESCE(EXTRACT(EPOCH FROM (MAX(latest_article_at) - MIN(computed_at) FILTER (WHERE is_stale))) / 86400, 0) AS lag_days
        FROM feature_status
      `);
      staleCount = Number(rows[0]?.stale_count ?? 0);
      metricMismatchCount = Number(rows[0]?.metric_mismatch_count ?? 0);
      lagDays = Number(rows[0]?.lag_days ?? 0);
    } finally {
      await client.end();
    }
  } catch (err) {
    return { ok: false, error: `stale detector failed: ${String(err?.message || err)}` };
  }

  log(`   stale event_features rows: ${staleCount}, metric mismatches: ${metricMismatchCount}, max lag (days): ${lagDays.toFixed(2)}`);

  if (staleCount === 0 && metricMismatchCount === 0 && lagDays < 1) {
    return { ok: true };
  }

  log(`   triggering incremental-event-engine-fast to repair stale=${staleCount}, metricMismatch=${metricMismatchCount} (lag ${lagDays.toFixed(2)}d)`);
  const result = run('node scripts/incremental-event-engine-fast.mjs --skip-controls', 600_000);
  return { ok: result.ok, error: result.error };
}

async function taskMetaModelInfer() {
  log('>> meta-model-infer: refresh event features, then run missing event/symbol/horizon pairs through meta-model-server :8100');
  // META_INFER_LIMIT, META_MODEL_URL, META_INFER_BATCH inherited from process.env.
  const refresh = run('node scripts/incremental-event-engine-fast.mjs --skip-controls', 300_000);
  if (!refresh.ok) return { ok: false, error: refresh.error };
  const result = run('node --import tsx scripts/meta-model-infer.mjs', 900_000);
  return { ok: result.ok, error: result.error };
}

/**
 * S-Tier N2: adaptive burst cadence for stale predictions.
 *
 * Baseline taskMetaModelInfer runs every 2 h. When stalePredictionCount
 * crosses 1000, /api/hot-events.modelTrust flips to 'disabled' — the user
 * sees a critical banner. Without this burst task they'd wait up to 2 h
 * for the cron. This 30-min check fires meta-model-infer ONLY when stale
 * predictions are above the threshold, so it's idempotent and cheap when
 * the system is healthy.
 *
 * Threshold mirrors STALE_PREDICTION_DISABLE_THRESHOLD on the API side
 * so the burst clears exactly the condition the dashboard flags.
 */
const META_INFER_BURST_THRESHOLD = 1000;

async function taskMetaModelInferBurst() {
  let stale = 0;
  try {
    const { Client } = await import('pg');
    const client = new Client(getPgConfig());
    await client.connect();
    try {
      const { rows } = await client.query(`
        WITH latest_features AS (
          SELECT canonical_event_id, MAX(computed_at) AS latest_computed_at
            FROM event_features
           GROUP BY canonical_event_id
        )
        SELECT COUNT(*)::int AS stale
          FROM model_predictions mp
          JOIN latest_features lf ON lf.canonical_event_id = mp.canonical_event_id
         WHERE lf.latest_computed_at IS NOT NULL
           AND mp.created_at IS NOT NULL
           AND lf.latest_computed_at > mp.created_at
      `);
      stale = Number(rows?.[0]?.stale ?? 0);
    } finally {
      await client.end();
    }
  } catch (err) {
    return { ok: false, error: `burst probe failed: ${String(err?.message || err)}` };
  }

  if (stale < META_INFER_BURST_THRESHOLD) {
    log(`>> meta-model-infer-burst: ${stale} stale predictions (threshold ${META_INFER_BURST_THRESHOLD}) — no action needed`);
    return { ok: true };
  }

  log(`>> meta-model-infer-burst: ${stale} stale predictions ≥ threshold — firing meta-model-infer ahead of the 2-h baseline`);
  const result = run('node --import tsx scripts/meta-model-infer.mjs', 900_000);
  return { ok: result.ok, error: result.error };
}

// taskDataAccumulator removed — see comment in TASKS dict.

async function taskRatesNowcast() {
  log('>> rates-nowcast: computing nowcasts for hy_credit_spread, treasury10y, yieldSpread, ig_credit_spread');
  const result = run('node scripts/compute-rates-nowcast.mjs', 180_000);
  return { ok: result.ok, error: result.error };
}

async function taskCompositeNowcasts() {
  log('>> composite-nowcasts: computing marketStress from nowcasted inputs');
  const result = run('node scripts/compute-composite-nowcasts.mjs', 60_000);
  return { ok: result.ok, error: result.error };
}

async function taskEventIntensityNowcast() {
  log('>> event-intensity-nowcast: clean market-relevant event rate');
  const result = run('node scripts/compute-event-intensity-nowcast.mjs', 60_000);
  return { ok: result.ok, error: result.error };
}

async function taskReconcileNowcasts() {
  log('>> reconcile-nowcasts: pairing estimates with observed FRED values');
  const result = run('node scripts/reconcile-nowcasts.mjs', 180_000);
  return { ok: result.ok, error: result.error };
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

async function taskDynamicRssBackfill() {
  log('>> dynamic-rss-backfill: fetching active approved RSS sources into NAS articles');
  const maxSources = Math.max(1, Math.min(200, Math.floor(Number(process.env.DYNAMIC_RSS_BACKFILL_MAX_SOURCES || 10))));
  const limit = Math.max(1, Math.min(500, Math.floor(Number(process.env.DYNAMIC_RSS_BACKFILL_LIMIT || 25))));
  const concurrency = Math.max(1, Math.min(20, Math.floor(Number(process.env.DYNAMIC_RSS_BACKFILL_CONCURRENCY || 8))));
  const timeoutMs = Math.max(3_000, Math.min(60_000, Math.floor(Number(process.env.DYNAMIC_RSS_BACKFILL_TIMEOUT_MS || 6_000))));
  const taskTimeoutMs = Math.max(
    300_000,
    Math.min(900_000, Number(process.env.DYNAMIC_RSS_BACKFILL_TASK_TIMEOUT_MS || 600_000)),
  );
  const result = runNodeScript('scripts/backfill-active-rss-sources.mjs', [
    '--max-sources', maxSources,
    '--limit', limit,
    '--concurrency', concurrency,
    '--timeout-ms', timeoutMs,
    '--skip-downstream',
  ], taskTimeoutMs);
  return { ok: result.ok, error: result.error };
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

function maybeStartSidecar() {
  if (!DAEMON_START_SIDECAR) {
    return { started: false, reason: 'DAEMON_START_SIDECAR is not true' };
  }
  const existing = listRunningNodeProcesses('src-tauri[\\\\/]sidecar[\\\\/]local-api-server\\.mjs')
    .concat(listRunningNodeProcesses('local-api-server\\.mjs'));
  if (existing.length) {
    return { started: false, reason: 'already_running', pid: existing[0].pid };
  }
  const child = spawn(process.execPath, ['src-tauri/sidecar/local-api-server.mjs'], {
    cwd: process.cwd(),
    env: { ...process.env },
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  });
  child.unref();
  return { started: true, pid: child.pid };
}

async function taskSidecarHealth(state) {
  log(`>> sidecar-health: checking ${SIDECAR_HEALTH_URL}`);
  const checkedAt = new Date().toISOString();
  try {
    const response = await fetch(SIDECAR_HEALTH_URL, { signal: AbortSignal.timeout(SIDECAR_HEALTH_TIMEOUT_MS) });
    const bodyText = await response.text();
    let payload = null;
    try {
      payload = bodyText ? JSON.parse(bodyText) : null;
    } catch {
      payload = null;
    }
    const status = response.status === 423
      ? 'busy_lock'
      : response.ok && payload
        ? 'ok'
        : response.ok
          ? 'bad_response'
          : `http_${response.status}`;
    state.health.sidecar = {
      ok: status === 'ok',
      status,
      checkedAt,
      port: SIDECAR_PORT,
      autoStartEnabled: DAEMON_START_SIDECAR,
      payload: status === 'ok' ? payload : null,
      bodyPreview: status === 'ok' ? undefined : bodyText.slice(0, 300),
    };
    saveState(state);
    logger.metric('sidecar.healthy', status === 'ok' ? 1 : 0);
    return { ok: true, status };
  } catch (error) {
    const startResult = maybeStartSidecar();
    const message = String(error?.message || error || 'sidecar unreachable');
    state.health.sidecar = {
      ok: false,
      status: 'unreachable',
      checkedAt,
      port: SIDECAR_PORT,
      autoStartEnabled: DAEMON_START_SIDECAR,
      error: message,
      startResult,
    };
    saveState(state);
    logger.metric('sidecar.healthy', 0);
    return { ok: true, status: 'unreachable', error: message, startResult };
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
  if (!LEGACY_DUCKDB_SYNC_ENABLED) {
    log('  duckdb-sync: skipped; set ENABLE_LEGACY_DUCKDB_SYNC=true to run legacy DuckDB cache sync');
    return { ok: true, skipped: true };
  }
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

async function taskDataFreshnessAudit() {
  log('>> data-freshness-audit: auditing live/backfill freshness boundaries');
  const result = run('node scripts/audit-data-freshness.mjs', 300_000);
  return { ok: result.ok, error: result.error };
}

async function taskDiscoverEmergingTech() {
  log('>> discover-emerging-tech: clustering potentially emerging topics');
  const result = run('node --import tsx scripts/discover-emerging-tech.mjs --limit 20000', 1_200_000);
  return { ok: result.ok, error: result.error };
}

async function taskRefreshRecentDiscovery() {
  log('>> refresh-recent-discovery: materializing current article themes for discovery triage');
  const result = run('node scripts/refresh-discovery-from-recent-themes.mjs --days 7 --limit 20 --min-count 2', 600_000);
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

async function taskScheduleIntelligenceReports() {
  log('>> schedule-intelligence-reports: refreshing draft report schedule manifest and automation guardrails');
  const result = runNodeScript('scripts/schedule-intelligence-reports.mjs', ['--apply'], 300_000);
  return { ok: result.ok, error: result.error };
}

async function taskReportBackfillDrain() {
  log('>> report-backfill-drain: queueing deep report research gaps into review-gated source-query approvals');
  const limit = Math.max(1, Math.min(100, Math.floor(Number(process.env.REPORT_BACKFILL_DRAIN_LIMIT || 25))));
  const maxAttempts = Math.max(1, Math.min(10, Math.floor(Number(process.env.REPORT_BACKFILL_MAX_ATTEMPTS || 3))));
  const staleHours = Math.max(1, Math.min(24 * 14, Math.floor(Number(process.env.REPORT_BACKFILL_STALE_HOURS || 48))));
  const result = runNodeScript('scripts/drain-report-backfill-tasks.mjs', [
    '--apply',
    '--limit', limit,
    '--max-attempts', maxAttempts,
    '--stale-hours', staleHours,
  ], 300_000);
  return { ok: result.ok, error: result.error };
}

async function taskReportClosure() {
  log('>> report-closure: closing report-scoped evidence contracts with provider routing and market validation');
  const reportLimit = Math.max(1, Math.min(20, Math.floor(Number(process.env.REPORT_CLOSURE_REPORT_LIMIT || 5))));
  const limit = Math.max(1, Math.min(100, Math.floor(Number(process.env.REPORT_CLOSURE_LIMIT || 40))));
  const passes = Math.max(1, Math.min(5, Math.floor(Number(process.env.REPORT_CLOSURE_PASSES || 1))));
  const reportConcurrency = Math.max(1, Math.min(12, Math.floor(Number(process.env.REPORT_CLOSURE_REPORT_CONCURRENCY || 3))));
  const stepConcurrency = Math.max(1, Math.min(6, Math.floor(Number(process.env.REPORT_CLOSURE_STEP_CONCURRENCY || 2))));
  const providerConcurrency = Math.max(1, Math.min(12, Math.floor(Number(process.env.REPORT_CLOSURE_PROVIDER_CONCURRENCY || 4))));
  const sourceQueryConcurrency = Math.max(1, Math.min(12, Math.floor(Number(process.env.REPORT_CLOSURE_SOURCE_QUERY_CONCURRENCY || 4))));
  const throttleHours = Math.max(0, Math.min(24 * 30, Math.floor(Number(process.env.REPORT_CLOSURE_PROVIDER_THROTTLE_HOURS || 6))));
  const providers = String(process.env.REPORT_CLOSURE_PROVIDERS || 'fred,eia,sec,fmp,polygon,dod-contracts,usaspending')
    .split(',')
    .map((provider) => provider.trim())
    .filter(Boolean)
    .join(',');
  const reportRoot = String(process.env.REPORT_CLOSURE_REPORT_ROOT || 'data/reports');
  const timeoutMs = optionalTimeoutMs(process.env.REPORT_CLOSURE_TIMEOUT_MS, 0, 900_000, 24 * HOUR_1_MS);
  const result = runNodeScript('scripts/run-evidence-contract-backfill-cycle.mjs', [
    '--apply',
    '--all-reports',
    '--auto-report-source-query',
    '--market-validation',
    '--dashboard-summary',
    '--regenerate',
    '--report-root', reportRoot,
    '--report-limit', reportLimit,
    '--limit', limit,
    '--passes', passes,
    '--report-concurrency', reportConcurrency,
    '--step-concurrency', stepConcurrency,
    '--provider-concurrency', providerConcurrency,
    '--source-query-concurrency', sourceQueryConcurrency,
    '--providers', providers,
    '--throttle-hours', throttleHours,
  ], timeoutMs);
  return { ok: result.ok, error: result.error };
}

async function taskGenericKpiCollection() {
  log('>> generic-kpi-collection: discovering theme KPI spines, materializing observations, and queueing missing collection jobs');
  const limit = Math.max(1, Math.min(500, Math.floor(Number(process.env.GENERIC_KPI_COLLECTION_LIMIT || 80))));
  const jobLimit = Math.max(1, Math.min(500, Math.floor(Number(process.env.GENERIC_KPI_COLLECTION_JOB_LIMIT || 120))));
  const result = runNodeScript('scripts/run-generic-kpi-collection.mjs', [
    '--limit', limit,
    '--job-limit', jobLimit,
  ], 600_000);
  return { ok: result.ok, error: result.error };
}

async function taskExternalProviderBackfill() {
  log('>> external-provider-backfill: auto-discovering newly added sources, keywords, symbols, and themes for provider/tracking backfill');
  const themes = String(process.env.EXTERNAL_PROVIDER_BACKFILL_THEMES || '')
    .split(',')
    .map((theme) => theme.trim())
    .filter(Boolean)
    .slice(0, 25);
  const providers = String(process.env.EXTERNAL_PROVIDER_BACKFILL_PROVIDERS || 'fred,eia,fmp,polygon')
    .split(',')
    .map((provider) => provider.trim())
    .filter(Boolean)
    .join(',');
  const timeoutMs = optionalTimeoutMs(process.env.EXTERNAL_PROVIDER_BACKFILL_TIMEOUT_MS, 0, 300_000, 24 * HOUR_1_MS);
  const limit = Math.max(1, Math.min(250, Math.floor(Number(process.env.EXTERNAL_PROVIDER_BACKFILL_LIMIT || 50))));
  const sinceHours = Math.max(1, Math.min(24 * 365, Math.floor(Number(process.env.EXTERNAL_PROVIDER_BACKFILL_SINCE_HOURS || 24 * 14))));
  const throttleHours = Math.max(0, Math.min(24 * 30, Math.floor(Number(process.env.EXTERNAL_PROVIDER_BACKFILL_THROTTLE_HOURS || 12))));
  const trackingLookbackDays = Math.max(1, Math.min(1825, Math.floor(Number(process.env.TRACKING_TARGET_BACKFILL_DAYS || 180))));
  const args = [
    '--auto-discover',
    '--providers', providers,
    '--limit', limit,
    '--since-hours', sinceHours,
    '--throttle-hours', throttleHours,
    '--tracking-lookback-days', trackingLookbackDays,
  ];
  if (themes.length) args.push('--themes', themes.join(','));
  const result = runNodeScript('scripts/collect-free-external-data.mjs', args, timeoutMs);
  return { ok: result.ok, error: result.error };
}

async function taskUniversalResearchOrchestrator() {
  log('>> universal-research-orchestrator: subject discovery -> backfill -> KPI/research cycle -> report regeneration');
  const limit = Math.max(1, Math.min(250, Math.floor(Number(process.env.UNIVERSAL_RESEARCH_LIMIT || 40))));
  const sinceHours = Math.max(1, Math.min(24 * 365, Math.floor(Number(process.env.UNIVERSAL_RESEARCH_SINCE_HOURS || 24 * 14))));
  const providerLimit = Math.max(1, Math.min(250, Math.floor(Number(process.env.UNIVERSAL_RESEARCH_PROVIDER_LIMIT || 50))));
  const providerThrottleHours = Math.max(0, Math.min(24 * 30, Math.floor(Number(process.env.UNIVERSAL_RESEARCH_PROVIDER_THROTTLE_HOURS || 6))));
  const coveragePasses = Math.max(1, Math.min(6, Math.floor(Number(process.env.UNIVERSAL_RESEARCH_COVERAGE_PASSES || 2))));
  const closurePasses = Math.max(1, Math.min(5, Math.floor(Number(process.env.UNIVERSAL_RESEARCH_CLOSURE_PASSES || 2))));
  const adjacentLimit = Math.max(1, Math.min(100, Math.floor(Number(process.env.UNIVERSAL_RESEARCH_ADJACENT_LIMIT || 25))));
  const adjacentExpansion = process.env.UNIVERSAL_RESEARCH_ADJACENT_EXPANSION !== '0';
  const autoReportMode = String(process.env.UNIVERSAL_RESEARCH_AUTO_REPORT_MODE || 'wide');
  const providers = String(process.env.UNIVERSAL_RESEARCH_PROVIDERS || 'fred,eia,sec,fmp,polygon,dod-contracts')
    .split(',')
    .map((provider) => provider.trim())
    .filter(Boolean)
    .join(',');
  const reportRoot = String(process.env.UNIVERSAL_RESEARCH_REPORT_ROOT || 'data/reports');
  const timeoutMs = optionalTimeoutMs(process.env.UNIVERSAL_RESEARCH_TIMEOUT_MS, 0, 900_000, 24 * HOUR_1_MS);
  const result = runNodeScript('scripts/run-universal-research-orchestrator.mjs', [
    '--limit', limit,
    '--since-hours', sinceHours,
    '--provider-limit', providerLimit,
    '--provider-throttle-hours', providerThrottleHours,
    '--providers', providers,
    '--coverage-passes', coveragePasses,
    '--closure-passes', closurePasses,
    '--report-root', reportRoot,
    ...(adjacentExpansion ? ['--adjacent-expansion'] : ['--no-adjacent-expansion']),
    '--adjacent-limit', adjacentLimit,
    '--auto-report-mode', autoReportMode,
  ], timeoutMs);
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
    'node --import tsx scripts/fetch-openalex-theme-evidence.mjs --themes ai-ml,quantum-computing,robotics-automation,biotech,materials-science,space --limit 8 --from-date 2021-01-01 --summary-only',
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
  const periods = ['week', 'month', 'quarter', 'year'];
  const failures = [];
  for (const period of periods) {
    const result = run(
      `node --import tsx scripts/generate-structural-alerts.mjs --period ${period} --limit 60`,
      900_000,
    );
    if (!result.ok) {
      failures.push(`${period}: ${result.error || 'unknown error'}`);
    }
  }
  return { ok: failures.length === 0, error: failures.join(' | ') };
}

async function taskRefreshEventMarketTransmission() {
  log('>> refresh-event-market-transmission: rebuilding event-to-market transmission cache from recent articles and signals');
  const result = run(
    'node --import tsx scripts/refresh-event-market-transmission.mjs --days 14 --limit 180',
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

async function taskMineIncomingConnections() {
  log('>> mine-incoming-connections: mining source-first Research OS signals from new topics, articles, research, code, and entity exposures');
  const result = run('node scripts/mine-incoming-connections.mjs', 900_000);
  return { ok: result.ok, error: result.error };
}

async function taskResearchOsCycle(state) {
  log('>> research-os-cycle: running ordered incoming->questions->evidence->relations->candidates cycle');
  const result = run('node scripts/run-research-os-cycle.mjs', 4_800_000);
  if (result.ok && state?.lastRun) {
    const now = Date.now();
    for (const taskName of [
      'mine-incoming-connections',
      'research-os-foundation',
      'collect-research-evidence',
      'extract-research-relations',
      'refresh-cross-theme-candidates',
      'cross-theme-source-expansion',
      'execute-source-query-approvals',
      'promote-trusted-graph',
    ]) {
      state.lastRun[taskName] = now;
    }
  }
  return { ok: result.ok, error: result.error };
}

async function taskResearchOsFoundation() {
  log('>> research-os-foundation: schema, seed graph, and autonomous research questions');
  const result = run('node scripts/research-os-foundation.mjs --all', 900_000);
  return { ok: result.ok, error: result.error };
}

async function taskCollectResearchEvidence() {
  log('>> collect-research-evidence: building question-level evidence bundles');
  const result = run('node scripts/collect-research-evidence.mjs --limit=24 --per-question-limit=16', 1_800_000);
  return { ok: result.ok, error: result.error };
}

async function taskExtractResearchRelations() {
  log('>> extract-research-relations: candidate-only relation extraction from evidence bundles');
  const repair = run('node scripts/repair-research-os-noisy-relations.mjs', 300_000);
  if (!repair.ok) return { ok: false, error: repair.error };
  const result = run('node scripts/extract-research-relations.mjs --limit=240', 1_800_000);
  return { ok: result.ok, error: result.error };
}

async function taskRefreshCrossThemeCandidates() {
  log('>> refresh-cross-theme-candidates: scoring hidden bottleneck candidates');
  const result = run('node scripts/refresh-cross-theme-candidates.mjs --limit=16', 900_000);
  return { ok: result.ok, error: result.error };
}

async function taskCrossThemeSourceExpansion() {
  log('>> cross-theme-source-expansion: queueing approval-gated source queries for weak evidence candidates');
  const result = run('node scripts/plan-cross-theme-source-expansion.mjs --limit=40', 300_000);
  return { ok: result.ok, error: result.error };
}

async function taskExecuteSourceQueryApprovals() {
  log('>> execute-source-query-approvals: executing approved Research OS source-query approvals and bounded needs-fix retries');
  const result = run('node scripts/execute-source-query-approvals.mjs --limit=25 --retry-needs-fix', 900_000);
  return { ok: result.ok, error: result.error };
}

async function taskPromoteTrustedGraph() {
  log('>> promote-trusted-graph: promoting reviewed cross-theme candidates without canonical mutation');
  const result = run('node scripts/promote-trusted-graph.mjs', 300_000);
  return { ok: result.ok, error: result.error };
}

async function taskAdjacencyAutoresearch() {
  log('>> adjacency-autoresearch: isolated eval harness for cross-theme prompts and scoring policy');
  const result = run('node scripts/run-adjacency-autoresearch.mjs --budget-ms=300000', 300_000);
  return { ok: result.ok, error: result.error };
}

async function taskResearchOsPolicyAdvisor() {
  log('>> research-os-policy-advisor: proposing bounded policy changes with rollback rules');
  const result = run('node scripts/propose-research-os-policy-changes.mjs', 300_000);
  return { ok: result.ok, error: result.error };
}

async function taskMechanismSeedGeneration() {
  log('>> mechanism-seed-generation: bounded operator seed generation, audit, adapter proposal, and self-improvement cycle');
  const limit = Math.max(1, Math.min(250, Math.floor(Number(process.env.MECHANISM_SEED_GENERATION_LIMIT || 25))));
  const statuses = String(process.env.MECHANISM_SEED_DAEMON_STATUSES || 'review_ready,needs_evidence,evidence_running,rejected,report_candidate')
    .split(',')
    .map((status) => status.trim())
    .filter(Boolean)
    .join(',');
  const auditStatuses = String(process.env.MECHANISM_SEED_AUDIT_STATUSES || 'review_ready,needs_evidence,evidence_running')
    .split(',')
    .map((status) => status.trim())
    .filter(Boolean)
    .join(',');
  const timeoutMs = optionalTimeoutMs(process.env.MECHANISM_SEED_DAEMON_TIMEOUT_MS, 900_000, 300_000, 24 * HOUR_1_MS);
  const skipStorage = process.env.MECHANISM_SEED_DAEMON_SKIP_STORAGE === 'true';
  const args = [
    '--limit', limit,
    '--statuses', statuses,
    '--audit-statuses', auditStatuses,
  ];
  if (skipStorage) args.push('--skip-storage');
  const result = runNodeScript('scripts/run-mechanism-seed-daemon-cycle.mjs', args, timeoutMs);
  return { ok: result.ok, error: result.error };
}

async function taskSourceSelfHeal() {
  log('>> source-self-heal: validating and activating approved healing candidates');
  const result = run('node --import tsx scripts/self-heal-sources.mjs --limit 1', 300_000);
  return { ok: result.ok, error: result.error };
}

async function taskSourceRepairClosedLoop() {
  log('>> source-repair-closed-loop: repairing failed source proposals, registering repaired feeds, and backfilling them');
  const target = Math.max(1, Math.min(50, Math.floor(Number(process.env.SOURCE_REPAIR_CLOSED_LOOP_TARGET || 20))));
  const limit = Math.max(1, Math.min(500, Math.floor(Number(process.env.SOURCE_REPAIR_CLOSED_LOOP_LIMIT || 300))));
  const maxCandidates = Math.max(1, Math.min(80, Math.floor(Number(process.env.SOURCE_REPAIR_MAX_CANDIDATES || 48))));
  const backfillLimit = Math.max(1, Math.min(300, Math.floor(Number(process.env.SOURCE_REPAIR_BACKFILL_LIMIT || 60))));
  const dailyBudget = Math.max(0, Math.min(500, Math.floor(Number(process.env.SOURCE_REPAIR_DAILY_RSS_BUDGET || 120))));
  const codeRepairFlag = process.env.SOURCE_REPAIR_CODE_REPAIR_ENABLED === 'false' ? ' --disable-code-repair' : '';
  const llmFlag = process.env.SOURCE_REPAIR_LLM_ENABLED === 'true' ? ' --enable-llm' : '';
  const result = run(
    `node --import tsx scripts/run-source-repair-closed-loop.mjs --apply --catalog-bootstrap --full-heuristic --count-historical-successes --target-successes ${target} --limit ${limit} --max-candidates ${maxCandidates} --backfill-limit ${backfillLimit} --daily-rss-budget ${dailyBudget}${codeRepairFlag}${llmFlag}`,
    1_200_000,
  );
  return { ok: result.ok, error: result.error };
}

async function taskAutoPipelineLabels() {
  log('>> auto-pipeline-labels: running step 3 (label assignment)');
  const labelLimit = Math.max(200, Math.min(5000, Math.floor(Number(process.env.AUTO_PIPELINE_LABEL_LIMIT || 5000))));
  const result = run(`node --import tsx scripts/auto-pipeline.mjs --step 3 --limit ${labelLimit}`, 600_000);
  return { ok: result.ok, error: result.error };
}

async function taskGenerateEmbeddings() {
  log('>> embedding-refresh: embedding recent unembedded articles before discovery/event pipelines');
  const limit = Math.max(500, Math.min(5000, Number(process.env.EMBEDDING_REFRESH_LIMIT) || 2000));
  const batch = Math.max(10, Math.min(50, Number(process.env.EMBEDDING_REFRESH_BATCH) || 25));
  const result = run(`node scripts/generate-embeddings.mjs --limit ${limit} --batch ${batch}`, 900_000);
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

// rates-nowcast is opt-in: all 4 targets currently fail the acceptance gate
// (see docs/NOWCAST_HANDOFF_2026-04-18.md §5.2 Phase C outcome). Running the
// cron with no trained .pkl just logs "no trained model" abstain ×4 every
// 30 min — noise, no value. Keep disabled until the rates redesign track
// produces models that clear the gate.
const RATES_NOWCAST_ENABLED = process.env.NOWCAST_RATES_ENABLED === 'true';

const TASKS = {
  'market-quote-refresh': { interval: MIN_15_MS, fn: taskMarketQuoteRefresh },
  'bootstrap-market-quote-history': { interval: DAY_1_MS, fn: taskBootstrapMarketQuoteHistory },
  // NOTE: data-accumulator runs as its own continuous daemon (npm run daemon:accumulator)
  // because each cycle is 5-10 min long and would block downstream master-daemon tasks
  // if inlined here. Keep it OUT of TASKS — verify it's running via process check.
  'build-market-returns': { interval: HOUR_6_MS, fn: taskBuildMarketReturns },
  'train-meta-model': { interval: WEEK_1_MS, fn: taskTrainMetaModel },
  'event-engine-incremental': { interval: HOUR_1_MS, fn: taskEventEngineIncremental },
  // S-Tier N6: daily full-pipeline run (no --skip-controls) so recent
  // events accumulate matched_controls + event_uplift rows. Without this,
  // recent events stay un-graded and the validated lane stays empty.
  'event-engine-full-controls': { interval: DAY_1_MS, fn: taskEventEngineFullControls },
  // S-Level §Phase 3: dedicated 4-hour stale-row repair pass. Detects feature
  // rows whose computed_at predates the event's latest article and upserts via
  // incremental-event-engine-fast (idempotent, pipeline-lock-guarded so it
  // safely overlaps with the hourly task).
  'repair-stale-features': { interval: 4 * HOUR_1_MS, fn: taskRepairStaleFeatures },
  'meta-model-infer': { interval: HOUR_2_MS, fn: taskMetaModelInfer },
  // S-Tier N2: 30-min adaptive burst that only fires when stale predictions
  // exceed STALE_PREDICTION_DISABLE_THRESHOLD (1000). Cheap probe + early
  // catchup so the dashboard's modelTrust banner doesn't sit at 'disabled'
  // for up to 2 h waiting for the baseline cron.
  'meta-model-infer-burst': { interval: MIN_30_MS, fn: taskMetaModelInferBurst },
  ...(RATES_NOWCAST_ENABLED
    ? { 'rates-nowcast': { interval: MIN_30_MS, fn: taskRatesNowcast } }
    : {}),
  'composite-nowcasts': { interval: MIN_30_MS, fn: taskCompositeNowcasts },
  'event-intensity-nowcast': { interval: MIN_30_MS, fn: taskEventIntensityNowcast },
  'reconcile-nowcasts': { interval: MIN_15_MS, fn: taskReconcileNowcasts },
  'signal-refresh': { interval: HOUR_6_MS, fn: taskSignalRefresh },
  'article-check': { interval: MIN_30_MS, fn: taskArticleCheck },
  'dynamic-rss-backfill': { interval: HOUR_1_MS, fn: taskDynamicRssBackfill },
  'dashboard-health': { interval: MIN_30_MS, fn: taskDashboardHealth },
  'sidecar-health': { interval: MIN_30_MS, fn: taskSidecarHealth },
  'db-health': { interval: MIN_15_MS, fn: taskDbHealth },
  'embedding-refresh': { interval: HOUR_1_MS, fn: taskGenerateEmbeddings },
  'auto-pipeline-labels': { interval: HOUR_2_MS, fn: taskAutoPipelineLabels },
  'auto-pipeline-sensitivity': { interval: HOUR_1_MS, fn: taskAutoPipelineSensitivity },
  'sensitivity-refresh': { interval: HOUR_1_MS, fn: taskSensitivityRefresh },
  'master-pipeline': { interval: HOUR_6_MS, fn: taskMasterPipeline },
  'executor': { interval: HOUR_6_MS, fn: taskExecutor },
  'refresh-event-market-transmission': { interval: HOUR_2_MS, fn: taskRefreshEventMarketTransmission },
  ...(LEGACY_DUCKDB_SYNC_ENABLED
    ? { 'duckdb-sync': { interval: HOUR_6_MS, fn: taskDuckdbSync } }
    : {}),
  'data-quality': { interval: HOUR_6_MS, fn: taskDataQuality },
  'data-freshness-audit': { interval: HOUR_6_MS, fn: taskDataFreshnessAudit },
  'arxiv-backfill': { interval: HOUR_6_MS, fn: taskArxivBackfill },
  'hackernews-backfill': { interval: HOUR_6_MS, fn: taskHackerNewsBackfill },
  'discover-emerging-tech': { interval: HOUR_6_MS, fn: taskDiscoverEmergingTech },
  'refresh-recent-discovery': { interval: HOUR_1_MS, fn: taskRefreshRecentDiscovery },
  'label-discovery-topics': { interval: HOUR_6_MS, fn: taskLabelDiscoveryTopics },
  'generate-tech-report': { interval: HOUR_6_MS, fn: taskGenerateTechReport },
  'source-self-heal': { interval: HOUR_6_MS, fn: taskSourceSelfHeal },
  'source-repair-closed-loop': { interval: HOUR_2_MS, fn: taskSourceRepairClosedLoop },
    'fred-backfill': { interval: DAY_1_MS, fn: taskFredBackfill },
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
  'schedule-intelligence-reports': { interval: HOUR_6_MS, fn: taskScheduleIntelligenceReports },
  'report-backfill-drain': { interval: HOUR_2_MS, fn: taskReportBackfillDrain },
  'report-closure': { interval: HOUR_6_MS, fn: taskReportClosure },
  'external-provider-backfill': { interval: HOUR_2_MS, fn: taskExternalProviderBackfill },
  'generic-kpi-collection': { interval: HOUR_6_MS, fn: taskGenericKpiCollection },
  'universal-research-orchestrator': { interval: HOUR_6_MS, fn: taskUniversalResearchOrchestrator },
  'coverage-gap-analysis': { interval: DAY_1_MS, fn: taskCoverageGapAnalysis },
  'research-os-cycle': { interval: 3 * HOUR_1_MS, fn: taskResearchOsCycle },
  'mine-incoming-connections': { interval: 3 * HOUR_1_MS, fn: taskMineIncomingConnections },
  'research-os-foundation': { interval: HOUR_6_MS, fn: taskResearchOsFoundation },
  'collect-research-evidence': { interval: HOUR_6_MS, fn: taskCollectResearchEvidence },
  'extract-research-relations': { interval: 12 * HOUR_1_MS, fn: taskExtractResearchRelations },
  'refresh-cross-theme-candidates': { interval: 3 * HOUR_1_MS, fn: taskRefreshCrossThemeCandidates },
  'cross-theme-source-expansion': { interval: DAY_1_MS, fn: taskCrossThemeSourceExpansion },
  'execute-source-query-approvals': { interval: HOUR_6_MS, fn: taskExecuteSourceQueryApprovals },
  'promote-trusted-graph': { interval: DAY_1_MS, fn: taskPromoteTrustedGraph },
  'adjacency-autoresearch': { interval: DAY_1_MS, fn: taskAdjacencyAutoresearch },
  'research-os-policy-advisor': { interval: DAY_1_MS, fn: taskResearchOsPolicyAdvisor },
  'mechanism-seed-generation': { interval: HOUR_6_MS, fn: taskMechanismSeedGeneration },
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
  if (!RATES_NOWCAST_ENABLED) {
    process.stderr.write('  [disabled] rates-nowcast (NOWCAST_RATES_ENABLED != true) — see NOWCAST_HANDOFF §5.2\n');
  }
  process.stderr.write('  15min: market quote refresh (core + auto-theme symbols), db health\n');
  process.stderr.write('  30min: article check, dashboard health, sidecar import/replay health, meta-model-infer-burst (adaptive — only when stale predictions ≥ 1000)\n');
  process.stderr.write('  1h:    dynamic RSS backfill, embedding refresh, event-engine-incremental, auto-pipeline-sensitivity, sensitivity refresh\n');
  process.stderr.write('  2h:    meta-model-infer, auto-pipeline-labels, refresh-event-market-transmission, report-backfill-drain, external provider/keyword backfill\n');
  process.stderr.write('  4h:    repair-stale-features (dedicated event_features stale detector + repair)\n');
  process.stderr.write('  daily: bootstrap-market-quote-history, event-engine-full-controls (matched_controls + event_uplift grading)\n');
  process.stderr.write('  6h:    signal refresh, master-pipeline, executor, data quality, arxiv, hackernews, discovery, report schedule, report closure, self-heal, generic KPI collection, universal research coverage-closure\n');
    process.stderr.write('  3-12h: Research OS foundation/evidence/relation/candidate refresh with approval-gated source expansion\n');
    process.stderr.write('  6h:    mechanism seed generation/audit/provider adapter proposal/self-improvement cycle (no evidence enqueue)\n');
    process.stderr.write('  opt-in: duckdb-sync only when ENABLE_LEGACY_DUCKDB_SYNC=true\n');
  process.stderr.write('  2h:    source repair closed loop (failed source proposals -> repaired feed -> backfill)\n');
    process.stderr.write('  daily: FRED backfill, pending check, full rebuild, daily backup, daily report, taxonomy migration, trend aggregates,\n');
    process.stderr.write('         curated daily news, sec seed universe, openalex theme evidence, followed-theme briefings, weekly digest, coverage-gap-analysis\n');
  process.stderr.write('  6h+:   data freshness audit, codex theme proposals from discovery topics\n');
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

  if (!ONCE) {
    const peers = findPersistentMasterDaemonPeers();
    if (peers.length > 0) {
      process.stderr.write(`master-daemon already running (pid ${peers[0].pid}); refusing duplicate persistent daemon\n`);
      process.exit(0);
    }
  }

  markHeartbeat(state, 'starting');
  if (!ONCE) {
    const heartbeatTimer = setInterval(() => {
      const currentState = loadState();
      markHeartbeat(currentState, runningHeartbeatPhase());
    }, 60_000);
    heartbeatTimer.unref?.();
  }

  await runAllTasks(state);
  markHeartbeat(state, 'idle');
  if (ONCE) return;

  setInterval(async () => {
    const currentState = loadState();
    markHeartbeat(currentState, 'tick');
    await runAllTasks(currentState);
    markHeartbeat(currentState, 'idle');
  }, MIN_15_MS);

  log('daemon running');
}

main().catch((error) => {
  process.stderr.write(`${String(error?.stack || error?.message || error)}\n`);
  process.exit(1);
});
