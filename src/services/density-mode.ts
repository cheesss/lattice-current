/**
 * Progressive Disclosure — Density Mode Service
 *
 * Manages 3-tier information density: Compact / Standard / Full.
 * Controls which panels are visible at each density level and
 * dispatches events so other modules (refresh-scheduler, panel-layout)
 * can react to density changes.
 *
 * Phase 3.1 — UI/UX fatigue reduction.
 */

import { SITE_VARIANT } from '@/config/variant';

// ── Types ────────────────────────────────────────────────────────────────────

export type DensityMode = 'compact' | 'standard' | 'full';

export interface DensityConfig {
  /** Panel keys that should be visible in this mode */
  panels: Set<string>;
  /** Human-readable label */
  label: string;
  /** Number of max visible panels (informational) */
  maxPanels: number;
}

// ── Storage ──────────────────────────────────────────────────────────────────

const STORAGE_KEY = 'wm-density-mode';
const EVENT_NAME = 'wm:density-changed';

// ── Panel sets per variant ───────────────────────────────────────────────────
// Compact: top 5 critical panels for situational awareness
// Standard: ~15 core panels for daily monitoring
// Full: all panels (current default)

const FULL_COMPACT_PANELS = new Set([
  'map', 'strategic-risk', 'live-news', 'markets', 'cii',
]);

const FULL_STANDARD_PANELS = new Set([
  'map', 'strategic-risk', 'live-news', 'markets', 'cii',
  'strategic-posture', 'insights', 'politics', 'commodities',
  'intel', 'energy', 'crypto', 'economic', 'cascade', 'middleeast',
]);

const TECH_COMPACT_PANELS = new Set([
  'map', 'live-news', 'markets', 'ai', 'tech',
]);

const TECH_STANDARD_PANELS = new Set([
  'map', 'live-news', 'markets', 'ai', 'tech',
  'insights', 'crypto', 'heatmap', 'layoffs', 'finance',
  'commodities', 'economic', 'strategic-risk', 'politics', 'monitors',
]);

const FINANCE_COMPACT_PANELS = new Set([
  'map', 'markets', 'live-news', 'commodities', 'heatmap',
]);

const FINANCE_STANDARD_PANELS = new Set([
  'map', 'markets', 'live-news', 'commodities', 'heatmap',
  'crypto', 'economic', 'finance', 'cross-asset-tape', 'etf-flows',
  'macro-signals', 'event-impact-screener', 'investment-workflow',
  'insights', 'strategic-risk',
]);

const HAPPY_COMPACT_PANELS = new Set([
  'map', 'live-news', 'counters', 'progress', 'breakthroughs',
]);

const HAPPY_STANDARD_PANELS = new Set([
  'map', 'live-news', 'counters', 'progress', 'breakthroughs',
  'hero', 'digest', 'species', 'renewable', 'giving',
]);

// ── Panel set resolution ─────────────────────────────────────────────────────

function getCompactPanels(): Set<string> {
  switch (SITE_VARIANT) {
    case 'tech': return TECH_COMPACT_PANELS;
    case 'finance': return FINANCE_COMPACT_PANELS;
    case 'happy': return HAPPY_COMPACT_PANELS;
    default: return FULL_COMPACT_PANELS;
  }
}

function getStandardPanels(): Set<string> {
  switch (SITE_VARIANT) {
    case 'tech': return TECH_STANDARD_PANELS;
    case 'finance': return FINANCE_STANDARD_PANELS;
    case 'happy': return HAPPY_STANDARD_PANELS;
    default: return FULL_STANDARD_PANELS;
  }
}

// ── Public API ───────────────────────────────────────────────────────────────

let currentMode: DensityMode | null = null;

export function getDensityMode(): DensityMode {
  if (currentMode) return currentMode;
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'compact' || stored === 'standard' || stored === 'full') {
      currentMode = stored;
      return stored;
    }
  } catch { /* noop */ }
  currentMode = 'full';
  return 'full';
}

export function setDensityMode(mode: DensityMode): void {
  const prev = getDensityMode();
  if (prev === mode) return;
  currentMode = mode;
  try {
    localStorage.setItem(STORAGE_KEY, mode);
  } catch { /* noop */ }
  document.dispatchEvent(new CustomEvent(EVENT_NAME, {
    detail: { mode, previous: prev },
  }));
}

/**
 * Returns the DensityConfig for the given mode.
 * In 'full' mode, the panel set is empty — meaning "show everything".
 */
export function getDensityConfig(mode?: DensityMode): DensityConfig {
  const m = mode ?? getDensityMode();
  switch (m) {
    case 'compact':
      return {
        panels: getCompactPanels(),
        label: 'Compact',
        maxPanels: 5,
      };
    case 'standard':
      return {
        panels: getStandardPanels(),
        label: 'Standard',
        maxPanels: 15,
      };
    case 'full':
    default:
      return {
        panels: new Set<string>(), // empty = show all
        label: 'Full',
        maxPanels: Infinity,
      };
  }
}

/**
 * Check if a panel should be visible in the current density mode.
 * In 'full' mode, all panels are visible.
 */
export function isPanelVisibleInDensity(panelKey: string, mode?: DensityMode): boolean {
  const m = mode ?? getDensityMode();
  if (m === 'full') return true;
  const config = getDensityConfig(m);
  return config.panels.has(panelKey);
}

/**
 * Cycle through density modes: compact → standard → full → compact
 */
export function cycleDensityMode(): DensityMode {
  const current = getDensityMode();
  const next: DensityMode = current === 'compact' ? 'standard'
    : current === 'standard' ? 'full'
    : 'compact';
  setDensityMode(next);
  return next;
}

/**
 * Subscribe to density mode changes.
 * Returns an unsubscribe function.
 */
export function onDensityChange(
  listener: (detail: { mode: DensityMode; previous: DensityMode }) => void,
): () => void {
  const handler = (e: Event) => {
    listener((e as CustomEvent).detail);
  };
  document.addEventListener(EVENT_NAME, handler);
  return () => document.removeEventListener(EVENT_NAME, handler);
}

// ── Density mode labels (for UI) ────────────────────────────────────────────

export const DENSITY_MODES: readonly { id: DensityMode; label: string; icon: string; description: string }[] = [
  { id: 'compact', label: 'Compact', icon: '◻', description: '5 key panels — minimal cognitive load' },
  { id: 'standard', label: 'Standard', icon: '◫', description: '15 core panels — daily monitoring' },
  { id: 'full', label: 'Full', icon: '▣', description: 'All panels — maximum information' },
] as const;
