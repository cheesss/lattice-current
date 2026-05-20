/**
 * Static map of UI surfaces to likely source files.
 * Used by the Codex investigation packet generator to identify relevant files
 * without searching the whole codebase.
 */
export const SURFACE_ROUTE_MAP = {
  'decision-inbox': {
    ui: ['event-dashboard.html'],
    api: ['scripts/event-dashboard-api.mjs'],
    executor: ['scripts/proposal-executor.mjs'],
    queue: ['scripts/_shared/approval-queue.mjs'],
  },
  'geo-lens': {
    ui: ['event-dashboard.html', 'event-map-lens.html'],
    map: ['src/theme-map-lens.ts', 'src/components/DeckGLMap.ts'],
    api: ['scripts/event-dashboard-api.mjs'],
  },
  'theme-brief': {
    ui: ['event-dashboard.html'],
    queries: ['scripts/_shared/trend-dashboard-queries.mjs'],
    builders: ['scripts/_shared/theme-shell-snapshot-builders.mjs'],
  },
  'ops': {
    ui: ['event-dashboard.html'],
    api: ['scripts/event-dashboard-api.mjs'],
    daemon: ['scripts/master-daemon.mjs'],
    state: ['scripts/_shared/runtime-observability.mjs'],
  },
  'home': {
    ui: ['event-dashboard.html'],
    api: ['scripts/event-dashboard-api.mjs'],
    builders: ['scripts/_shared/theme-shell-snapshot-builders.mjs'],
  },
  'investigate': {
    ui: ['event-dashboard.html'],
    api: ['scripts/event-dashboard-api.mjs'],
    alerts: ['scripts/generate-structural-alerts.mjs'],
  },
};

/**
 * Returns a deduplicated array of file paths likely relevant to a runtime issue.
 * @param {{ surface?: string, apiRoute?: string, classification?: string }} issue
 * @returns {string[]}
 */
export function getFilesForIssue(issue) {
  const collected = [];

  // Match surface
  const surfaceEntry = SURFACE_ROUTE_MAP[String(issue.surface || '').toLowerCase()];
  if (surfaceEntry) {
    // Prioritize ui and api first, then the rest
    for (const key of ['ui', 'api', 'executor', 'queue', 'map', 'queries', 'builders', 'daemon', 'state', 'alerts']) {
      if (surfaceEntry[key]) collected.push(...surfaceEntry[key]);
    }
  }

  // Always include based on apiRoute
  const route = String(issue.apiRoute || '');
  if (route.includes('approval-queue')) {
    collected.push('scripts/_shared/approval-queue.mjs');
  }
  if (route.includes('codex-proposals')) {
    collected.push('scripts/proposal-executor.mjs');
  }
  if (route.includes('discovery-triage')) {
    collected.push('scripts/event-dashboard-api.mjs');
  }

  // Always include based on classification
  if (issue.classification === 'external-dependency') {
    collected.push('scripts/proposal-executor.mjs');
  }

  // Deduplicate, ui and api first, max 8 files
  const seen = new Set();
  const result = [];
  for (const f of collected) {
    if (!seen.has(f)) {
      seen.add(f);
      result.push(f);
    }
  }
  return result.slice(0, 8);
}
