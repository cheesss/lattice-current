#!/usr/bin/env node
/**
 * Release readiness check (S-Level Phase 0)
 *
 * Aggregates the gates that must pass before a branch is mergeable:
 *   1. typecheck       — `tsc --noEmit`
 *   2. git purity      — no tracked runtime artifacts in working tree
 *   3. duckdb hygiene  — no `*.duckdb.corrupt-*` left tracked
 *   4. api smoke       — /api/health, /api/ops/status reachable (skipped if API down)
 *   5. daemon freshness — data/daemon-state.json mtime within last 30 min (skipped if file missing)
 *
 * Each check prints a single OK / WARN / FAIL line. Exits non-zero only on FAIL
 * (so operators get the full picture even when one gate fails).
 *
 * Usage:
 *   node scripts/check-release-readiness.mjs
 *   npm run check:release
 */
import { execSync } from 'node:child_process';
import { stat, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

const API_BASE = process.env.LATTICE_API_BASE || 'http://127.0.0.1:46200';
const DAEMON_STATE_PATH = path.join(repoRoot, 'data', 'daemon-state.json');
const FRESH_DAEMON_MS = 30 * 60 * 1000; // 30 min

// Patterns that should NEVER appear in a release diff.
// Anything matching these in `git status --porcelain` is a fail.
const RUNTIME_PATTERNS = [
  /^data\/event-dashboard-cache\//,
  /^data\/runtime-logs\//,
  /^data\/runtime-issues\//,
  /^data\/backups\//,
  /^data\/backfill-logs\//,
  /^data\/audits\//,
  /^data\/daemon-state\.json$/,
  /^data\/alerts\.json$/,
  /^data\/pipeline-report\.json$/,
  /^data\/codex-prompt-metrics\.json$/,
  /^data\/executor-results\.json$/,
  /^data\/(arxiv|hn)-backfill-state(\.debug)?\.json$/,
  /^data\/codex-(agent-discover|source-repair-runs)/,
  /^data\/openclaw-(agent-runs|webhook)/,
  /^data\/verification-screenshots\//,
  /^data\/meta-.*\.pt$/,
  /^data\/retrain-state\.json$/,
  /^data\/failed-proposals\.json$/,
  /^data\/verify-e2e-result\.json$/,
  /^\.tmp\//,
  /^\.openclaw\//,
  /^\.coverage\//,
  /\.duckdb\.corrupt-/,
  /\.duckdb\.wal\.corrupt-/,
  /__pycache__/,
];

const results = [];

function log(check, status, message, detail) {
  const symbol = status === 'OK' ? '✓' : status === 'WARN' ? '?' : status === 'SKIP' ? '-' : '✗';
  // eslint-disable-next-line no-console
  console.log(`${symbol} ${check.padEnd(20)} ${status.padEnd(4)}  ${message}`);
  if (detail) {
    for (const line of detail.split('\n')) {
      // eslint-disable-next-line no-console
      console.log(`                              ${line}`);
    }
  }
  results.push({ check, status });
}

// ---- 1. typecheck ----
function checkTypecheck() {
  try {
    execSync('npx tsc --noEmit', { cwd: repoRoot, stdio: 'pipe' });
    log('typecheck', 'OK', 'tsc --noEmit clean');
  } catch (err) {
    const stdout = (err.stdout?.toString() || '').trim();
    const stderr = (err.stderr?.toString() || '').trim();
    const summary = (stdout || stderr).split('\n').slice(-5).join('\n') || 'tsc reported errors';
    log('typecheck', 'FAIL', 'tsc --noEmit reported errors', summary);
  }
}

// ---- 2. git purity ----
function checkGitPurity() {
  let lines = [];
  try {
    const out = execSync('git status --porcelain', { cwd: repoRoot, stdio: 'pipe' }).toString();
    lines = out.split('\n').filter(Boolean);
  } catch (err) {
    log('git-purity', 'WARN', 'not a git checkout or git unavailable', err.message);
    return;
  }
  const offenders = [];
  for (const line of lines) {
    // porcelain format: XY <space> path  (X = staged, Y = unstaged)
    const filePath = line.slice(3).split(' -> ').pop();
    if (RUNTIME_PATTERNS.some((re) => re.test(filePath))) {
      offenders.push(filePath);
    }
  }
  if (offenders.length === 0) {
    log('git-purity', 'OK', `working tree free of runtime artifacts (${lines.length} pending changes total)`);
  } else {
    const sample = offenders.slice(0, 5).join('\n') + (offenders.length > 5 ? `\n... ${offenders.length - 5} more` : '');
    log('git-purity', 'FAIL', `${offenders.length} runtime artifact(s) in working tree`, sample);
  }
}

// ---- 3. duckdb hygiene ----
function checkDuckdbHygiene() {
  let lsFiles = '';
  try {
    lsFiles = execSync('git ls-files', { cwd: repoRoot, stdio: 'pipe' }).toString();
  } catch (err) {
    log('duckdb-hygiene', 'SKIP', 'git ls-files unavailable', err.message);
    return;
  }
  const corrupt = lsFiles.split('\n').filter((f) => /\.duckdb(\.wal)?\.corrupt-/.test(f));
  if (corrupt.length === 0) {
    log('duckdb-hygiene', 'OK', 'no tracked duckdb corrupt snapshots');
  } else {
    log('duckdb-hygiene', 'FAIL', `${corrupt.length} corrupt duckdb snapshot(s) tracked`, corrupt.slice(0, 5).join('\n'));
  }
}

// ---- 4. api smoke ----
async function checkApiSmoke() {
  const endpoints = [
    { path: '/api/health', required: true },
    { path: '/api/ops/status', required: false }, // added in Phase 7 — may not exist on older branches
  ];
  let reachable = false;
  for (const { path: p, required } of endpoints) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 4000);
      const res = await fetch(`${API_BASE}${p}`, { signal: controller.signal });
      clearTimeout(timer);
      if (res.ok) {
        reachable = true;
        log('api-smoke', 'OK', `${p} ${res.status}`);
      } else {
        log('api-smoke', required ? 'FAIL' : 'WARN', `${p} ${res.status}`);
      }
    } catch (err) {
      if (!reachable && p === endpoints[0].path) {
        log('api-smoke', 'SKIP', `${API_BASE} unreachable — start dashboard API to validate`, err.message);
        return;
      }
      log('api-smoke', 'WARN', `${p} ${err.message}`);
    }
  }
}

// ---- 4b. user-value semantic health ----
async function checkSemanticHealth() {
  const endpoints = [
    { path: '/api/ops/status', levelPath: ['summary', 'level'] },
    { path: '/api/product-quality', levelPath: ['summary', 'level'] },
  ];
  for (const endpoint of endpoints) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 30000);
      const res = await fetch(`${API_BASE}${endpoint.path}`, { signal: controller.signal });
      clearTimeout(timer);
      if (!res.ok) {
        log('semantic-health', 'WARN', `${endpoint.path} ${res.status}`);
        continue;
      }
      const payload = await res.json();
      let level = payload;
      for (const key of endpoint.levelPath) level = level?.[key];
      if (level === 'ok') {
        log('semantic-health', 'OK', `${endpoint.path} summary.level=ok`);
      } else {
        log('semantic-health', 'FAIL', `${endpoint.path} summary.level=${level || 'missing'}`);
      }
    } catch (err) {
      log('semantic-health', 'FAIL', `${API_BASE}${endpoint.path} unavailable`, err.message);
    }
  }
}

// ---- 5. daemon freshness ----
async function checkDaemonFreshness() {
  try {
    const s = await stat(DAEMON_STATE_PATH);
    const ageMs = Date.now() - s.mtimeMs;
    if (ageMs <= FRESH_DAEMON_MS) {
      log('daemon-fresh', 'OK', `daemon-state.json ${Math.round(ageMs / 60000)} min old`);
    } else {
      log('daemon-fresh', 'WARN', `daemon-state.json ${Math.round(ageMs / 60000)} min old (>${FRESH_DAEMON_MS / 60000})`);
    }
    // best-effort: read tick count or task count if present
    try {
      const json = JSON.parse(await readFile(DAEMON_STATE_PATH, 'utf8'));
      const tickCount = typeof json.tickCount === 'number' ? json.tickCount : null;
      const taskCount = json.tasks && typeof json.tasks === 'object' ? Object.keys(json.tasks).length : null;
      if (tickCount != null) {
        // eslint-disable-next-line no-console
        console.log(`                              ticks: ${tickCount}`);
      }
      if (taskCount != null) {
        // eslint-disable-next-line no-console
        console.log(`                              tracked tasks: ${taskCount}`);
      }
    } catch {
      /* ignore parse failure */
    }
  } catch {
    log('daemon-fresh', 'SKIP', `${path.relative(repoRoot, DAEMON_STATE_PATH)} missing — start master-daemon`);
  }
}

// ---- main ----
checkTypecheck();
checkGitPurity();
checkDuckdbHygiene();
await checkApiSmoke();
await checkSemanticHealth();
await checkDaemonFreshness();

const failed = results.filter((r) => r.status === 'FAIL');
const warned = results.filter((r) => r.status === 'WARN');
const skipped = results.filter((r) => r.status === 'SKIP');

// eslint-disable-next-line no-console
console.log('');
// eslint-disable-next-line no-console
console.log(`Summary: ${results.length - failed.length - warned.length - skipped.length} OK, ${warned.length} WARN, ${skipped.length} SKIP, ${failed.length} FAIL`);

// process.exitCode is preferred over process.exit() so async handles
// (e.g. fetch's AbortSignal timer) finish unwinding cleanly on Windows.
process.exitCode = failed.length > 0 ? 1 : 0;
