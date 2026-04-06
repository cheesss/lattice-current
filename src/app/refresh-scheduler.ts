import type { AppContext, AppModule } from '@/app/app-context';
import { startSmartPollLoop, type SmartPollLoopHandle } from '@/services/runtime';
import { isPanelVisibleInDensity, onDensityChange, type DensityMode } from '@/services/density-mode';

export interface RefreshRegistration {
  name: string;
  fn: () => Promise<boolean | void>;
  intervalMs: number;
  condition?: () => boolean;
  /** Panel key for density-aware suspension. If set, poll pauses when panel is hidden. */
  panelKey?: string;
}

export class RefreshScheduler implements AppModule {
  private ctx: AppContext;
  private refreshRunners = new Map<string, { loop: SmartPollLoopHandle; intervalMs: number; panelKey?: string }>();
  private flushTimeoutIds = new Set<ReturnType<typeof setTimeout>>();
  private hiddenSince = 0;
  /** Suspended runners due to density mode hiding their panel (Phase 4.2) */
  private suspendedRunners = new Set<string>();
  private densityUnsub: (() => void) | null = null;

  constructor(ctx: AppContext) {
    this.ctx = ctx;
  }

  init(): void {
    // Phase 4.2: Listen for density mode changes to suspend/resume panel polls
    this.densityUnsub = onDensityChange(({ mode }) => {
      this.onDensityModeChanged(mode);
    });
  }

  destroy(): void {
    this.densityUnsub?.();
    this.densityUnsub = null;
    for (const timeoutId of this.flushTimeoutIds) {
      clearTimeout(timeoutId);
    }
    this.flushTimeoutIds.clear();
    for (const { loop } of this.refreshRunners.values()) {
      loop.stop();
    }
    this.refreshRunners.clear();
    this.suspendedRunners.clear();
  }

  setHiddenSince(ts: number): void {
    this.hiddenSince = ts;
  }

  getHiddenSince(): number {
    return this.hiddenSince;
  }

  scheduleRefresh(
    name: string,
    fn: () => Promise<boolean | void>,
    intervalMs: number,
    condition?: () => boolean,
    panelKey?: string,
  ): void {
    this.refreshRunners.get(name)?.loop.stop();
    this.suspendedRunners.delete(name);

    const loop = startSmartPollLoop(async () => {
      if (this.ctx.isDestroyed) return;
      if (condition && !condition()) return;
      if (this.ctx.inFlight.has(name)) return;

      this.ctx.inFlight.add(name);
      try {
        return await fn();
      } finally {
        this.ctx.inFlight.delete(name);
      }
    }, {
      intervalMs,
      pauseWhenHidden: true,
      refreshOnVisible: false,
      runImmediately: false,
      maxBackoffMultiplier: 4,
      memoryPressureAware: true,
      onError: (e) => {
        console.error(`[App] Refresh ${name} failed:`, e);
      },
    });

    this.refreshRunners.set(name, { loop, intervalMs, panelKey });
  }

  // ── Phase 4.2: Density-aware poll suspension ─────────────────────────────

  /**
   * Called when density mode changes. Suspends polls for panels that are
   * no longer visible, and resumes polls for panels that become visible.
   */
  private onDensityModeChanged(mode: DensityMode): void {
    for (const [name, runner] of this.refreshRunners) {
      if (!runner.panelKey) continue;

      const visible = isPanelVisibleInDensity(runner.panelKey, mode);

      if (!visible && !this.suspendedRunners.has(name)) {
        // Suspend: stop the poll loop
        runner.loop.stop();
        this.suspendedRunners.add(name);
      } else if (visible && this.suspendedRunners.has(name)) {
        // Resume: restart the loop (trigger an immediate refresh)
        this.suspendedRunners.delete(name);
        runner.loop.trigger();
      }
    }
  }

  /**
   * Get the set of currently suspended refresh names (for debugging).
   */
  getSuspendedRefreshes(): ReadonlySet<string> {
    return this.suspendedRunners;
  }

  flushStaleRefreshes(): void {
    if (!this.hiddenSince) return;
    const hiddenMs = Date.now() - this.hiddenSince;
    this.hiddenSince = 0;

    for (const timeoutId of this.flushTimeoutIds) {
      clearTimeout(timeoutId);
    }
    this.flushTimeoutIds.clear();

    let stagger = 0;
    for (const [name, { loop, intervalMs }] of this.refreshRunners) {
      // Phase 4.2: Don't flush suspended runners
      if (this.suspendedRunners.has(name)) continue;
      if (hiddenMs < intervalMs) continue;
      const delay = stagger;
      // Phase 4.2: Increase stagger gap to reduce burst load on resume
      stagger += 250;
      const timeoutId = setTimeout(() => {
        this.flushTimeoutIds.delete(timeoutId);
        loop.trigger();
      }, delay);
      this.flushTimeoutIds.add(timeoutId);
    }
  }

  registerAll(registrations: RefreshRegistration[]): void {
    for (const reg of registrations) {
      this.scheduleRefresh(reg.name, reg.fn, reg.intervalMs, reg.condition, reg.panelKey);
    }
  }
}
