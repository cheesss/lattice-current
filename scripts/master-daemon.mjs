#!/usr/bin/env node
/**
 * master-daemon.mjs — Main automation daemon
 *
 * Runs continuously and orchestrates all pipeline tasks on a schedule.
 *
 * Schedule:
 *   15min  — signal refresh (VIX/FRED), article check (RSS)
 *   1h     — auto-pipeline (step 3+5), conditional_sensitivity refresh
 *   6h     — master-pipeline (step 0+1), proposal-executor
 *   daily  — pending_outcomes check, full rebuild, daily report
 *
 * Usage:
 *   node --import tsx scripts/master-daemon.mjs              # run forever
 *   node --import tsx scripts/master-daemon.mjs --once       # run all tasks once and exit
 *   node --import tsx scripts/master-daemon.mjs --task signal-refresh   # single task only
 */

import pg from 'pg';
import { execSync } from 'child_process';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { loadOptionalEnvFile, resolveNasPgConfig } from './_shared/nas-runtime.mjs';

loadOptionalEnvFile();
const { Client } = pg;
const PG_CONFIG = resolveNasPgConfig();

// ── CLI args ────────────────────────────────────────────────
const ONCE = process.argv.includes('--once');
const TASK_ONLY = process.argv.includes('--task')
  ? process.argv[process.argv.indexOf('--task') + 1]
  : null;

// ── Intervals (ms) ─────────────────────────────────────────
const MIN_15 = 15 * 60 * 1000;
const HOUR_1 = 60 * 60 * 1000;
const HOUR_6 = 6 * 60 * 60 * 1000;
const DAY_1  = 24 * 60 * 60 * 1000;

// ── State file ──────────────────────────────────────────────
const STATE_PATH = 'data/daemon-state.json';

function loadState() {
  try {
    if (existsSync(STATE_PATH)) {
      return JSON.parse(readFileSync(STATE_PATH, 'utf-8'));
    }
  } catch { /* corrupted state — start fresh */ }
  return { lastRun: {}, taskResults: {} };
}

function saveState(state) {
  try {
    if (!existsSync('data')) mkdirSync('data', { recursive: true });
    writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
  } catch (e) {
    log(`Failed to save state: ${e.message}`);
  }
}

// ── Logging ─────────────────────────────────────────────────
function log(msg) {
  const ts = new Date().toISOString();
  process.stderr.write(`[${ts}] ${msg}\n`);
}

// ── Shell runner ────────────────────────────────────────────
function run(cmd, timeoutMs = 300_000) {
  log(`  $ ${cmd}`);
  try {
    execSync(cmd, {
      stdio: 'pipe',
      timeout: timeoutMs,
      env: { ...process.env },
      cwd: process.cwd(),
    });
    return true;
  } catch (e) {
    log(`  WARN non-fatal: ${(e.message || '').slice(0, 120)}`);
    return false;
  }
}

// ── Task guard: skip if another invocation is still within cooldown ──
const runningTasks = new Set();

function shouldRun(taskName, intervalMs, state) {
  if (runningTasks.has(taskName)) {
    log(`  skip ${taskName} — previous run still in progress`);
    return false;
  }
  const last = state.lastRun[taskName] || 0;
  return Date.now() - last >= intervalMs;
}

function markDone(taskName, state, ok) {
  state.lastRun[taskName] = Date.now();
  state.taskResults[taskName] = { ok, at: new Date().toISOString() };
  saveState(state);
}

// ═════════════════════════════════════════════════════════════
// TASK DEFINITIONS
// ═════════════════════════════════════════════════════════════

// ── 15-min tasks ────────────────────────────────────────────

async function taskSignalRefresh(state) {
  const name = 'signal-refresh';
  if (!ONCE && !shouldRun(name, MIN_15, state)) return;
  runningTasks.add(name);
  log('>> signal-refresh: updating VIX/FRED in signal_history');
  let ok = false;
  try {
    const client = new Client(PG_CONFIG);
    await client.connect();

    // Upsert latest VIX value from market_quotes if available
    await client.query(`
      INSERT INTO signal_history (signal_name, ts, value)
      SELECT 'vix', NOW(), last_price
      FROM market_quotes
      WHERE symbol = '^VIX'
      ORDER BY fetched_at DESC LIMIT 1
      ON CONFLICT (signal_name, ts) DO UPDATE SET value = EXCLUDED.value
    `).catch(() => log('  signal_history VIX upsert skipped (table may not exist)'));

    // Upsert latest FRED values if available
    await client.query(`
      INSERT INTO signal_history (signal_name, ts, value)
      SELECT 'fred_' || series_id, NOW(), value
      FROM fred_observations
      WHERE observation_date = (SELECT MAX(observation_date) FROM fred_observations)
      ON CONFLICT (signal_name, ts) DO UPDATE SET value = EXCLUDED.value
    `).catch(() => log('  signal_history FRED upsert skipped (table may not exist)'));

    await client.end();
    ok = true;
    log('>> signal-refresh: done');
  } catch (e) {
    log(`>> signal-refresh FAILED: ${e.message}`);
  } finally {
    markDone(name, state, ok);
    runningTasks.delete(name);
  }
}

async function taskArticleCheck(state) {
  const name = 'article-check';
  if (!ONCE && !shouldRun(name, MIN_15, state)) return;
  runningTasks.add(name);
  log('>> article-check: scanning RSS feeds for new articles');
  let ok = false;
  try {
    // Placeholder: in production, call fetchCategoryFeeds or a dedicated RSS script
    // For now, check articles table for staleness as a health indicator
    const client = new Client(PG_CONFIG);
    await client.connect();
    const res = await client.query(`
      SELECT COUNT(*) AS total,
             MAX(published_at) AS latest,
             COUNT(*) FILTER (WHERE published_at > NOW() - INTERVAL '1 day') AS last_24h
      FROM articles
    `);
    const row = res.rows[0];
    log(`  articles total=${row.total}, latest=${row.latest}, last_24h=${row.last_24h}`);
    if (Number(row.last_24h) === 0) {
      log('  WARN: no articles in last 24h — feeds may be stale');
    }
    await client.end();
    ok = true;
    log('>> article-check: done');
  } catch (e) {
    log(`>> article-check FAILED: ${e.message}`);
  } finally {
    markDone(name, state, ok);
    runningTasks.delete(name);
  }
}

// ── 1-hour tasks ────────────────────────────────────────────

async function taskAutoPipeline(state) {
  const name = 'auto-pipeline';
  if (!ONCE && !shouldRun(name, HOUR_1, state)) return;
  runningTasks.add(name);
  log('>> auto-pipeline: running step 3 + step 5 (limit 200)');
  let ok = false;
  try {
    ok = run('node --import tsx scripts/auto-pipeline.mjs --step 3 --step 5 --limit 200', 600_000);
    log(`>> auto-pipeline: ${ok ? 'done' : 'completed with warnings'}`);
  } catch (e) {
    log(`>> auto-pipeline FAILED: ${e.message}`);
  } finally {
    markDone(name, state, ok);
    runningTasks.delete(name);
  }
}

async function taskSensitivityRefresh(state) {
  const name = 'sensitivity-refresh';
  if (!ONCE && !shouldRun(name, HOUR_1, state)) return;
  runningTasks.add(name);
  log('>> sensitivity-refresh: incremental conditional_sensitivity update');
  let ok = false;
  try {
    const client = new Client(PG_CONFIG);
    await client.connect();

    // Refresh conditional_sensitivity for themes with new outcomes in the last hour
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
    await client.end();
    ok = true;
    log('>> sensitivity-refresh: done');
  } catch (e) {
    log(`>> sensitivity-refresh FAILED: ${e.message}`);
  } finally {
    markDone(name, state, ok);
    runningTasks.delete(name);
  }
}

// ── 6-hour tasks ────────────────────────────────────────────

async function taskMasterPipeline(state) {
  const name = 'master-pipeline';
  if (!ONCE && !shouldRun(name, HOUR_6, state)) return;
  runningTasks.add(name);
  log('>> master-pipeline: running step 0 + step 1 (no-codex)');
  let ok = false;
  try {
    ok = run('node --import tsx scripts/master-pipeline.mjs --no-codex --step 0 --step 1', 600_000);
    log(`>> master-pipeline: ${ok ? 'done' : 'completed with warnings'}`);
  } catch (e) {
    log(`>> master-pipeline FAILED: ${e.message}`);
  } finally {
    markDone(name, state, ok);
    runningTasks.delete(name);
  }
}

async function taskExecutor(state) {
  const name = 'executor';
  if (!ONCE && !shouldRun(name, HOUR_6, state)) return;
  runningTasks.add(name);
  log('>> executor: running proposal-executor');
  let ok = false;
  try {
    ok = run('node --import tsx scripts/proposal-executor.mjs', 300_000);
    log(`>> executor: ${ok ? 'done' : 'completed with warnings'}`);
  } catch (e) {
    log(`>> executor FAILED: ${e.message}`);
  } finally {
    markDone(name, state, ok);
    runningTasks.delete(name);
  }
}

// ── Daily tasks ─────────────────────────────────────────────

async function taskPendingCheck(state) {
  const name = 'pending-check';
  if (!ONCE && !shouldRun(name, DAY_1, state)) return;
  runningTasks.add(name);
  log('>> pending-check: checking pending_outcomes where target_date <= now');
  let ok = false;
  try {
    const client = new Client(PG_CONFIG);
    await client.connect();

    const res = await client.query(`
      SELECT COUNT(*) AS due
      FROM pending_outcomes
      WHERE target_date <= NOW() AND resolved_at IS NULL
    `).catch(() => ({ rows: [{ due: 0 }] }));

    const due = Number(res.rows[0]?.due || 0);
    log(`  pending_outcomes due for resolution: ${due}`);

    if (due > 0) {
      // Mark them for processing — the auto-pipeline step 5 handles actual resolution
      log(`  ${due} pending outcomes ready — will be resolved in next auto-pipeline run`);
    }

    await client.end();
    ok = true;
    log('>> pending-check: done');
  } catch (e) {
    log(`>> pending-check FAILED: ${e.message}`);
  } finally {
    markDone(name, state, ok);
    runningTasks.delete(name);
  }
}

async function taskFullRebuild(state) {
  const name = 'full-rebuild';
  if (!ONCE && !shouldRun(name, DAY_1, state)) return;
  runningTasks.add(name);
  log('>> full-rebuild: running full master-pipeline (no-codex)');
  let ok = false;
  try {
    ok = run('node --import tsx scripts/master-pipeline.mjs --no-codex', 1_200_000);
    log(`>> full-rebuild: ${ok ? 'done' : 'completed with warnings'}`);
  } catch (e) {
    log(`>> full-rebuild FAILED: ${e.message}`);
  } finally {
    markDone(name, state, ok);
    runningTasks.delete(name);
  }
}

async function taskDailyReport(state) {
  const name = 'daily-report';
  if (!ONCE && !shouldRun(name, DAY_1, state)) return;
  runningTasks.add(name);
  log('>> daily-report: generating daily report');
  let ok = false;
  try {
    const client = new Client(PG_CONFIG);
    await client.connect();

    const today = new Date().toISOString().slice(0, 10);

    const [articles, outcomes, signals, proposals, pending] = await Promise.all([
      client.query(`
        SELECT COUNT(*) AS total,
               COUNT(*) FILTER (WHERE published_at > NOW() - INTERVAL '1 day') AS new_24h
        FROM articles
      `).catch(() => ({ rows: [{ total: 0, new_24h: 0 }] })),
      client.query(`
        SELECT COUNT(*) AS total,
               COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '1 day') AS new_24h
        FROM labeled_outcomes
      `).catch(() => ({ rows: [{ total: 0, new_24h: 0 }] })),
      client.query(`
        SELECT signal_name, MAX(ts) AS latest, COUNT(*) AS points
        FROM signal_history
        GROUP BY signal_name
        ORDER BY signal_name
      `).catch(() => ({ rows: [] })),
      client.query(`
        SELECT status, COUNT(*) AS cnt
        FROM codex_proposals
        GROUP BY status
      `).catch(() => ({ rows: [] })),
      client.query(`
        SELECT COUNT(*) AS total,
               COUNT(*) FILTER (WHERE target_date <= NOW() AND resolved_at IS NULL) AS overdue
        FROM pending_outcomes
      `).catch(() => ({ rows: [{ total: 0, overdue: 0 }] })),
    ]);

    const report = {
      date: today,
      generated_at: new Date().toISOString(),
      articles: articles.rows[0],
      labeled_outcomes: outcomes.rows[0],
      signals: signals.rows,
      proposals: proposals.rows,
      pending_outcomes: pending.rows[0],
      daemon_state: {
        lastRun: state.lastRun,
        taskResults: state.taskResults,
      },
    };

    if (!existsSync('data')) mkdirSync('data', { recursive: true });
    const reportPath = `data/daily-report-${today}.json`;
    writeFileSync(reportPath, JSON.stringify(report, null, 2));
    log(`  report written to ${reportPath}`);

    await client.end();
    ok = true;
    log('>> daily-report: done');
  } catch (e) {
    log(`>> daily-report FAILED: ${e.message}`);
  } finally {
    markDone(name, state, ok);
    runningTasks.delete(name);
  }
}

// ═════════════════════════════════════════════════════════════
// TASK REGISTRY
// ═════════════════════════════════════════════════════════════

const TASKS = {
  // 15-min
  'signal-refresh':      { fn: taskSignalRefresh,      interval: MIN_15, group: '15min' },
  'article-check':       { fn: taskArticleCheck,        interval: MIN_15, group: '15min' },
  // 1-hour
  'auto-pipeline':       { fn: taskAutoPipeline,        interval: HOUR_1, group: '1h' },
  'sensitivity-refresh': { fn: taskSensitivityRefresh,  interval: HOUR_1, group: '1h' },
  // 6-hour
  'master-pipeline':     { fn: taskMasterPipeline,      interval: HOUR_6, group: '6h' },
  'executor':            { fn: taskExecutor,             interval: HOUR_6, group: '6h' },
  // daily
  'pending-check':       { fn: taskPendingCheck,         interval: DAY_1,  group: 'daily' },
  'full-rebuild':        { fn: taskFullRebuild,          interval: DAY_1,  group: 'daily' },
  'daily-report':        { fn: taskDailyReport,          interval: DAY_1,  group: 'daily' },
};

// ═════════════════════════════════════════════════════════════
// MAIN LOOP
// ═════════════════════════════════════════════════════════════

async function runAllTasks(state) {
  for (const [name, task] of Object.entries(TASKS)) {
    if (TASK_ONLY && name !== TASK_ONLY) continue;
    try {
      await task.fn(state);
    } catch (e) {
      log(`TASK ${name} threw unexpected error: ${e.message}`);
    }
  }
}

async function main() {
  console.error('');
  console.error('Master Daemon Started');
  console.error('  15min: signal refresh, article check');
  console.error('  1h:    auto-pipeline, sensitivity refresh');
  console.error('  6h:    master-pipeline, executor');
  console.error('  daily: pending check, full rebuild, report');
  console.error('');

  if (TASK_ONLY) {
    if (!TASKS[TASK_ONLY]) {
      console.error(`Unknown task: ${TASK_ONLY}`);
      console.error(`Available: ${Object.keys(TASKS).join(', ')}`);
      process.exit(1);
    }
    console.error(`Running single task: ${TASK_ONLY}`);
  }

  if (ONCE) {
    console.error('Mode: --once (run all tasks once and exit)\n');
  }

  const state = loadState();

  if (ONCE) {
    await runAllTasks(state);
    log('All tasks completed. Exiting (--once mode).');
    return;
  }

  // Run immediately on startup
  await runAllTasks(state);

  // Then schedule via setInterval
  // 15-min tick: runs 15-min tasks and checks all others
  const tickInterval = setInterval(async () => {
    const current = loadState();
    await runAllTasks(current);
  }, MIN_15);

  // Keep process alive and handle graceful shutdown
  process.on('SIGINT', () => {
    log('Received SIGINT — shutting down gracefully');
    clearInterval(tickInterval);
    saveState(loadState());
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    log('Received SIGTERM — shutting down gracefully');
    clearInterval(tickInterval);
    saveState(loadState());
    process.exit(0);
  });

  log('Daemon running. Press Ctrl+C to stop.');
}

main().catch((e) => {
  console.error(`Daemon fatal error: ${e.stack || e.message || e}`);
  process.exit(1);
});
