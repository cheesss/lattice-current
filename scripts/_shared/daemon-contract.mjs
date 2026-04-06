export const MIN_15_MS = 15 * 60 * 1000;
export const HOUR_1_MS = 60 * 60 * 1000;
export const HOUR_6_MS = 6 * 60 * 60 * 1000;
export const DAY_1_MS = 24 * 60 * 60 * 1000;

export const DAEMON_TASK_INTERVALS_MS = Object.freeze({
  'signal-refresh': MIN_15_MS,
  'article-check': MIN_15_MS,
  'dashboard-health': MIN_15_MS,
  'auto-pipeline': HOUR_1_MS,
  'sensitivity-refresh': HOUR_1_MS,
  'master-pipeline': HOUR_6_MS,
  'executor': HOUR_6_MS,
  'pending-check': DAY_1_MS,
  'full-rebuild': DAY_1_MS,
  'daily-report': DAY_1_MS,
});

export function getDaemonTaskIntervalMs(taskName) {
  return Number(DAEMON_TASK_INTERVALS_MS?.[taskName] || 0);
}
