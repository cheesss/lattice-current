export const MIN_15_MS = 15 * 60 * 1000;
export const MIN_30_MS = 30 * 60 * 1000;
export const HOUR_1_MS = 60 * 60 * 1000;
export const HOUR_2_MS = 2 * 60 * 60 * 1000;
export const HOUR_6_MS = 6 * 60 * 60 * 1000;
export const DAY_1_MS = 24 * 60 * 60 * 1000;
export const WEEK_1_MS = 7 * DAY_1_MS;

export const DAEMON_TASK_INTERVALS_MS = Object.freeze({
  'signal-refresh': MIN_15_MS,
  'article-check': MIN_30_MS,
  'dashboard-health': MIN_30_MS,
  'auto-pipeline-labels': HOUR_2_MS,
  'auto-pipeline-sensitivity': HOUR_1_MS,
  'sensitivity-refresh': HOUR_1_MS,
  'master-pipeline': HOUR_6_MS,
  'executor': HOUR_6_MS,
  'discover-emerging-tech': HOUR_6_MS,
  'arxiv-backfill': HOUR_6_MS,
  'label-discovery-topics': HOUR_6_MS,
  'generate-tech-report': HOUR_6_MS,
  'pending-check': DAY_1_MS,
  'full-rebuild': DAY_1_MS,
  'daily-report': DAY_1_MS,
  'generate-weekly-digest': DAY_1_MS,
  'auto-curate': WEEK_1_MS,
  'coverage-gap-analysis': DAY_1_MS,
});

export function getDaemonTaskIntervalMs(taskName) {
  return Number(DAEMON_TASK_INTERVALS_MS?.[taskName] || 0);
}
