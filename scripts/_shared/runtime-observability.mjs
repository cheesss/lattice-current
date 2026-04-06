import path from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import { DAEMON_TASK_INTERVALS_MS, getDaemonTaskIntervalMs } from './daemon-contract.mjs';

export const DEFAULT_DAEMON_STATE_PATH = path.join('data', 'daemon-state.json');

function asTs(value) {
  const parsed = Date.parse(String(value || ''));
  return Number.isFinite(parsed) ? parsed : 0;
}

function minutesSince(value, nowTs) {
  const ts = asTs(value);
  if (!ts) return null;
  return Math.max(0, Math.round((nowTs - ts) / 60_000));
}

function pickWorseStatus(left, right) {
  const rank = { ready: 0, watch: 1, degraded: 2, blocked: 3 };
  return (rank[right] || 0) > (rank[left] || 0) ? right : left;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export function readDaemonStateSnapshot(statePath = DEFAULT_DAEMON_STATE_PATH) {
  const resolvedPath = path.resolve(statePath);
  if (!existsSync(resolvedPath)) {
    return {
      statePath: resolvedPath,
      state: null,
      error: `Daemon state file not found: ${resolvedPath}`,
    };
  }

  try {
    const state = JSON.parse(readFileSync(resolvedPath, 'utf8'));
    return { statePath: resolvedPath, state, error: '' };
  } catch (error) {
    return {
      statePath: resolvedPath,
      state: null,
      error: String(error?.message || error || 'Failed to parse daemon state'),
    };
  }
}

export function summarizeRuntimeObservability(input = {}) {
  const nowTs = Number.isFinite(input.nowTs) ? Number(input.nowTs) : Date.now();
  const daemon = input.daemonState || {};
  const statePath = String(input.statePath || DEFAULT_DAEMON_STATE_PATH);
  const lastRun = daemon?.lastRun || {};
  const taskResults = daemon?.taskResults || {};
  const failures = daemon?.failures || {};
  const taskNames = Array.from(new Set([
    ...Object.keys(DAEMON_TASK_INTERVALS_MS),
    ...Object.keys(lastRun),
    ...Object.keys(taskResults),
    ...Object.keys(failures),
  ])).sort();

  const tasks = taskNames.map((taskName) => {
    const intervalMs = getDaemonTaskIntervalMs(taskName);
    const result = taskResults?.[taskName] || {};
    const failure = failures?.[taskName] || {};
    const lastRunAt = result?.at || (lastRun?.[taskName] ? new Date(Number(lastRun[taskName])).toISOString() : null);
    const lagMinutes = minutesSince(lastRunAt, nowTs);
    const staleThresholdMs = Math.max(intervalMs * 2, 30 * 60 * 1000);
    const isNeverRun = !lastRunAt;
    const isStale = Boolean(intervalMs && lagMinutes != null && lagMinutes * 60_000 > staleThresholdMs);
    const consecutiveFailures = Number(result?.consecutiveFailures ?? failure?.consecutive ?? 0);
    const explicitFailure = result?.ok === false || consecutiveFailures > 0;
    const status = isNeverRun
      ? 'watch'
      : explicitFailure
        ? consecutiveFailures >= 2 ? 'blocked' : 'degraded'
        : isStale
          ? 'watch'
          : 'ready';

    return {
      name: taskName,
      intervalMinutes: intervalMs ? Math.round(intervalMs / 60_000) : null,
      lastRunAt,
      lagMinutes,
      stale: isStale,
      status,
      consecutiveFailures,
      disabledUntil: failure?.disabledUntil ? new Date(Number(failure.disabledUntil)).toISOString() : null,
      error: String(result?.error || failure?.lastError || '').trim() || null,
    };
  });

  const dashboard = daemon?.health?.dashboard || null;
  const dashboardStatus = dashboard == null
    ? 'watch'
    : dashboard.ok === true
      ? 'ready'
      : 'degraded';
  const failingTaskCount = tasks.filter((task) => task.status === 'blocked' || task.status === 'degraded').length;
  const staleTaskCount = tasks.filter((task) => task.stale).length;
  const healthyTaskCount = tasks.filter((task) => task.status === 'ready').length;
  const waitingTaskCount = tasks.filter((task) => task.status === 'watch').length;
  const latestTaskAt = tasks
    .map((task) => task.lastRunAt)
    .filter(Boolean)
    .sort((left, right) => asTs(right) - asTs(left))[0] || null;

  let status = dashboardStatus;
  for (const task of tasks) {
    status = pickWorseStatus(status, task.status);
  }

  const observabilityScore = clamp(
    100
      - failingTaskCount * 14
      - staleTaskCount * 8
      - (dashboard?.ok === false ? 10 : 0)
      - tasks.filter((task) => task.status === 'watch').length * 3,
    0,
    100,
  );

  return {
    statePath: path.resolve(statePath),
    sampledAt: new Date(nowTs).toISOString(),
    status,
    summary: {
      observabilityScore,
      healthyTaskCount,
      waitingTaskCount,
      failingTaskCount,
      staleTaskCount,
      taskCount: tasks.length,
      dashboardHealthy: dashboard?.ok === true,
      latestTaskAt,
    },
    dashboard: {
      ok: dashboard?.ok === true,
      checkedAt: dashboard?.checkedAt || null,
      error: dashboard?.ok === false ? String(dashboard?.error || 'dashboard health failed') : null,
      payload: dashboard?.payload || null,
    },
    tasks,
  };
}
