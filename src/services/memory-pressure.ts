/**
 * Memory Pressure Detection & Response — Phase 4.2
 *
 * Monitors heap usage via Performance.memory API (Chrome) and provides
 * pressure levels that other modules (SmartPollLoop, refresh-scheduler,
 * persistent-cache) can react to.
 *
 * Pressure levels:
 *   normal   — < 60% heap utilisation
 *   warning  — 60-80% heap utilisation
 *   critical — > 80% heap utilisation
 *
 * When pressure increases, the system can:
 * - Extend poll intervals
 * - Pause non-essential refreshes
 * - Trigger cache eviction
 * - Reduce animation budgets
 */

// ── Types ────────────────────────────────────────────────────────────────────

export type MemoryPressureLevel = 'normal' | 'warning' | 'critical';

export interface MemorySnapshot {
  /** Current JS heap size in bytes (0 if API unavailable) */
  usedHeapBytes: number;
  /** Total JS heap size limit in bytes (0 if API unavailable) */
  heapLimitBytes: number;
  /** Heap utilisation ratio 0-1 */
  utilisation: number;
  /** Current pressure level */
  level: MemoryPressureLevel;
  /** Timestamp of this snapshot */
  timestamp: number;
  /** Whether the Performance.memory API is available */
  apiAvailable: boolean;
}

type PressureChangeListener = (snapshot: MemorySnapshot) => void;

// ── Chrome Performance.memory type augmentation ──────────────────────────────

interface PerformanceMemory {
  usedJSHeapSize: number;
  totalJSHeapSize: number;
  jsHeapSizeLimit: number;
}

interface PerformanceWithMemory extends Performance {
  memory?: PerformanceMemory;
}

// ── Constants ────────────────────────────────────────────────────────────────

const WARNING_THRESHOLD = 0.60;
const CRITICAL_THRESHOLD = 0.80;
const CHECK_INTERVAL_MS = 30_000; // check every 30s
const POLL_MULTIPLIER_WARNING = 2;
const POLL_MULTIPLIER_CRITICAL = 4;

// ── State ────────────────────────────────────────────────────────────────────

let currentLevel: MemoryPressureLevel = 'normal';
let lastSnapshot: MemorySnapshot | null = null;
let checkIntervalId: ReturnType<typeof setInterval> | null = null;
const listeners: PressureChangeListener[] = [];

// ── Core ─────────────────────────────────────────────────────────────────────

function isMemoryApiAvailable(): boolean {
  return typeof performance !== 'undefined'
    && typeof (performance as PerformanceWithMemory).memory !== 'undefined';
}

function computeLevel(utilisation: number): MemoryPressureLevel {
  if (utilisation >= CRITICAL_THRESHOLD) return 'critical';
  if (utilisation >= WARNING_THRESHOLD) return 'warning';
  return 'normal';
}

/**
 * Take a snapshot of current memory state.
 */
export function getMemorySnapshot(): MemorySnapshot {
  const now = Date.now();

  if (!isMemoryApiAvailable()) {
    return {
      usedHeapBytes: 0,
      heapLimitBytes: 0,
      utilisation: 0,
      level: 'normal',
      timestamp: now,
      apiAvailable: false,
    };
  }

  const mem = (performance as PerformanceWithMemory).memory!;
  const utilisation = mem.jsHeapSizeLimit > 0
    ? mem.usedJSHeapSize / mem.jsHeapSizeLimit
    : 0;

  const snapshot: MemorySnapshot = {
    usedHeapBytes: mem.usedJSHeapSize,
    heapLimitBytes: mem.jsHeapSizeLimit,
    utilisation,
    level: computeLevel(utilisation),
    timestamp: now,
    apiAvailable: true,
  };

  lastSnapshot = snapshot;
  return snapshot;
}

/**
 * Check memory and fire listeners if pressure level changed.
 */
function checkMemoryPressure(): void {
  const snapshot = getMemorySnapshot();
  if (snapshot.level !== currentLevel) {
    const previousLevel = currentLevel;
    currentLevel = snapshot.level;
    console.warn(
      `[memory-pressure] Level changed: ${previousLevel} → ${snapshot.level} ` +
      `(${(snapshot.utilisation * 100).toFixed(1)}% heap used)`
    );
    for (const listener of listeners) {
      try { listener(snapshot); } catch { /* don't let listener errors propagate */ }
    }
  }
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Get the current memory pressure level.
 */
export function getMemoryPressureLevel(): MemoryPressureLevel {
  return currentLevel;
}

/**
 * Get the most recent memory snapshot (null if never checked).
 */
export function getLastMemorySnapshot(): MemorySnapshot | null {
  return lastSnapshot;
}

/**
 * Get the poll interval multiplier for the current pressure level.
 * SmartPollLoop should multiply its interval by this value.
 */
export function getPollIntervalMultiplier(): number {
  switch (currentLevel) {
    case 'critical': return POLL_MULTIPLIER_CRITICAL;
    case 'warning': return POLL_MULTIPLIER_WARNING;
    default: return 1;
  }
}

/**
 * Whether non-essential operations should be deferred.
 */
export function shouldDeferNonEssential(): boolean {
  return currentLevel === 'critical';
}

/**
 * Subscribe to memory pressure level changes.
 * Returns an unsubscribe function.
 */
export function onMemoryPressureChange(listener: PressureChangeListener): () => void {
  listeners.push(listener);
  return () => {
    const idx = listeners.indexOf(listener);
    if (idx >= 0) listeners.splice(idx, 1);
  };
}

/**
 * Start periodic memory monitoring.
 * Safe to call multiple times — only one interval is created.
 * Also registers the pressure multiplier with SmartPollLoop (Phase 4.2).
 */
export function startMemoryMonitoring(): void {
  if (checkIntervalId !== null) return;

  // Register the multiplier function with runtime.ts (avoids circular import)
  try {
    import('./runtime').then(({ setMemoryPressureMultiplierFn }) => {
      setMemoryPressureMultiplierFn(getPollIntervalMultiplier);
    }).catch(() => { /* runtime not available yet */ });
  } catch { /* noop */ }

  // Immediate first check
  checkMemoryPressure();
  checkIntervalId = setInterval(checkMemoryPressure, CHECK_INTERVAL_MS);
}

/**
 * Stop periodic memory monitoring.
 */
export function stopMemoryMonitoring(): void {
  if (checkIntervalId !== null) {
    clearInterval(checkIntervalId);
    checkIntervalId = null;
  }
}
