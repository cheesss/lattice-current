import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readDaemonStateSnapshot, summarizeRuntimeObservability } from '../scripts/_shared/runtime-observability.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

test('summarizeRuntimeObservability marks healthy daemon state as ready', () => {
  const nowTs = Date.parse('2026-04-06T10:00:00.000Z');
  const state = {
    lastRun: {
      'signal-refresh': nowTs - 5 * 60_000,
      'dashboard-health': nowTs - 4 * 60_000,
    },
    taskResults: {
      'signal-refresh': { ok: true, at: new Date(nowTs - 5 * 60_000).toISOString(), error: '', consecutiveFailures: 0 },
      'dashboard-health': { ok: true, at: new Date(nowTs - 4 * 60_000).toISOString(), error: '', consecutiveFailures: 0 },
    },
    failures: {
      'signal-refresh': { consecutive: 0, disabledUntil: 0, lastError: '' },
      'dashboard-health': { consecutive: 0, disabledUntil: 0, lastError: '' },
    },
    health: {
      dashboard: { ok: true, checkedAt: new Date(nowTs - 4 * 60_000).toISOString(), payload: { status: 'ok' } },
    },
  };

  const summary = summarizeRuntimeObservability({
    daemonState: state,
    statePath: 'data/daemon-state.json',
    nowTs,
  });

  assert.equal(summary.status, 'watch');
  assert.equal(summary.summary.failingTaskCount, 0);
  assert.equal(summary.dashboard.ok, true);
  assert.ok(summary.tasks.some((task) => task.name === 'signal-refresh' && task.status === 'ready'));
  assert.ok(summary.tasks.some((task) => task.name === 'article-check' && task.status === 'watch'));
});

test('summarizeRuntimeObservability surfaces degraded and stale daemon tasks', () => {
  const nowTs = Date.parse('2026-04-06T10:00:00.000Z');
  const state = {
    lastRun: {
      'signal-refresh': nowTs - 60 * 60_000,
      'dashboard-health': nowTs - 20 * 60_000,
    },
    taskResults: {
      'signal-refresh': { ok: true, at: new Date(nowTs - 60 * 60_000).toISOString(), error: '', consecutiveFailures: 0 },
      'dashboard-health': { ok: false, at: new Date(nowTs - 20 * 60_000).toISOString(), error: 'fetch failed', consecutiveFailures: 2 },
    },
    failures: {
      'dashboard-health': { consecutive: 2, disabledUntil: nowTs + 30 * 60_000, lastError: 'fetch failed' },
    },
    health: {
      dashboard: { ok: false, checkedAt: new Date(nowTs - 20 * 60_000).toISOString(), error: 'fetch failed' },
    },
  };

  const summary = summarizeRuntimeObservability({
    daemonState: state,
    statePath: 'data/daemon-state.json',
    nowTs,
  });

  assert.equal(summary.status, 'blocked');
  assert.equal(summary.summary.failingTaskCount >= 1, true);
  assert.equal(summary.summary.staleTaskCount >= 1, true);
  assert.ok(summary.tasks.some((task) => task.name === 'signal-refresh' && task.stale));
  assert.ok(summary.tasks.some((task) => task.name === 'dashboard-health' && task.status === 'blocked'));
});

test('readDaemonStateSnapshot returns parseable real workspace state', () => {
  const realPath = path.join(__dirname, '..', 'data', 'daemon-state.json');
  const snapshot = readDaemonStateSnapshot(realPath);
  assert.equal(snapshot.error, '');
  assert.equal(typeof snapshot.state, 'object');
  assert.ok(snapshot.statePath.endsWith(path.join('data', 'daemon-state.json')));
});

test('readDaemonStateSnapshot reports missing file explicitly', () => {
  const sandboxDir = path.join(tmpdir(), `lattice-observability-${Date.now()}`);
  mkdirSync(sandboxDir, { recursive: true });
  const missing = path.join(sandboxDir, 'missing-daemon-state.json');
  const snapshot = readDaemonStateSnapshot(missing);
  assert.equal(snapshot.state, null);
  assert.match(snapshot.error, /not found/i);
  rmSync(sandboxDir, { recursive: true, force: true });
});
