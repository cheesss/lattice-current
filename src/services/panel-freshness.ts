/**
 * Panel Visual Hierarchy — Data Freshness Styling
 *
 * Dynamically adjusts panel visual prominence based on data freshness:
 * - Stale panels (no updates > 30min): reduced opacity (0.85)
 * - Recently updated panels (< 30min): subtle accent border
 * - Critical event panels: accent glow border
 *
 * Phase 3.3 — UI/UX fatigue reduction via visual hierarchy.
 */

/** Time thresholds for freshness tiers */
const FRESH_THRESHOLD_MS = 30 * 60 * 1000;  // 30 minutes
const STALE_THRESHOLD_MS = 60 * 60 * 1000;  // 1 hour

/** CSS class names for freshness states */
const CLASS_FRESH = 'panel-data-fresh';
const CLASS_STALE = 'panel-data-stale';
const CLASS_CRITICAL = 'panel-data-critical';

export type PanelFreshnessState = 'fresh' | 'normal' | 'stale';

/**
 * Track the last data update timestamp for each panel.
 * Keyed by panel element id (data-panel attribute value).
 */
const panelUpdateTimes = new Map<string, number>();

/** Track which panels have critical events */
const criticalPanels = new Set<string>();

/**
 * Record that a panel's data was updated.
 */
export function markPanelUpdated(panelKey: string): void {
  panelUpdateTimes.set(panelKey, Date.now());
}

/**
 * Mark a panel as having a critical event active.
 */
export function markPanelCritical(panelKey: string, isCritical: boolean): void {
  if (isCritical) {
    criticalPanels.add(panelKey);
  } else {
    criticalPanels.delete(panelKey);
  }
}

/**
 * Get the freshness state for a panel.
 */
export function getPanelFreshnessState(panelKey: string): PanelFreshnessState {
  const lastUpdate = panelUpdateTimes.get(panelKey);
  if (!lastUpdate) return 'normal'; // No data recorded yet, treat as normal
  const age = Date.now() - lastUpdate;
  if (age < FRESH_THRESHOLD_MS) return 'fresh';
  if (age > STALE_THRESHOLD_MS) return 'stale';
  return 'normal';
}

/**
 * Apply freshness-based visual styling to all panels in the grid.
 * Call this periodically (e.g., every 60s) to keep visuals current.
 */
export function applyFreshnessStyles(): void {
  const panels = document.querySelectorAll<HTMLElement>('[data-panel]');
  for (const el of panels) {
    const key = el.getAttribute('data-panel');
    if (!key) continue;

    const state = getPanelFreshnessState(key);
    const isCritical = criticalPanels.has(key);

    el.classList.toggle(CLASS_FRESH, state === 'fresh' && !isCritical);
    el.classList.toggle(CLASS_STALE, state === 'stale');
    el.classList.toggle(CLASS_CRITICAL, isCritical);
  }
}

/**
 * Start a periodic freshness style updater.
 * Returns a cleanup function.
 */
export function startFreshnessStyleLoop(intervalMs = 60_000): () => void {
  applyFreshnessStyles(); // initial
  const id = setInterval(applyFreshnessStyles, intervalMs);
  return () => clearInterval(id);
}

/**
 * Clear all freshness tracking data. Used in tests and cleanup.
 */
export function resetFreshnessTracking(): void {
  panelUpdateTimes.clear();
  criticalPanels.clear();
}
