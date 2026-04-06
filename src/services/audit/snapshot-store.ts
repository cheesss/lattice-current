/**
 * Snapshot Store — Phase 7
 *
 * In-memory storage and querying for DecisionSnapshots.
 * Supports time-range queries, theme filtering, and retention policies.
 * Production implementations can extend to PostgreSQL or file-based storage.
 */

import type { DecisionSnapshot } from './decision-snapshot';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SnapshotQuery {
  ideaId?: string;
  themeId?: string;
  startTime?: string;
  endTime?: string;
  autonomyAction?: string;
  limit?: number;
}

export interface RetentionPolicy {
  /** Keep full snapshots for this many days. */
  fullRetentionDays: number;
  /** After full retention, keep daily samples for this many days. */
  sampledRetentionDays: number;
  /** Maximum total snapshots to store. */
  maxSnapshots: number;
}

export interface AuditReport {
  period: { start: string; end: string };
  totalDecisions: number;
  decisionsByAction: Record<string, number>;
  convictionDistribution: {
    mean: number;
    p25: number;
    p50: number;
    p75: number;
    min: number;
    max: number;
  };
  vetoAnalysis: Array<{ reason: string; count: number; avgConviction: number }>;
  modelWeightDrift: Array<{ feature: string; startWeight: number; endWeight: number; drift: number }>;
  topThemes: Array<{ themeId: string; count: number }>;
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

export const DEFAULT_RETENTION: RetentionPolicy = {
  fullRetentionDays: 90,
  sampledRetentionDays: 365,
  maxSnapshots: 50_000,
};

// ---------------------------------------------------------------------------
// SnapshotStore
// ---------------------------------------------------------------------------

export class SnapshotStore {
  private snapshots: DecisionSnapshot[] = [];
  private indexByIdea = new Map<string, number[]>();
  private indexByTheme = new Map<string, number[]>();
  private retention: RetentionPolicy;

  constructor(retention: RetentionPolicy = DEFAULT_RETENTION) {
    this.retention = retention;
  }

  /** Store a new snapshot. */
  save(snapshot: DecisionSnapshot): void {
    const idx = this.snapshots.length;
    this.snapshots.push(snapshot);

    // Update indexes
    const ideaIndexes = this.indexByIdea.get(snapshot.ideaId) ?? [];
    ideaIndexes.push(idx);
    this.indexByIdea.set(snapshot.ideaId, ideaIndexes);

    const themeIndexes = this.indexByTheme.get(snapshot.themeId) ?? [];
    themeIndexes.push(idx);
    this.indexByTheme.set(snapshot.themeId, themeIndexes);

    // Apply retention if over limit
    if (this.snapshots.length > this.retention.maxSnapshots) {
      this.applyRetention();
    }
  }

  /** Query snapshots by idea ID. */
  getByIdeaId(ideaId: string): DecisionSnapshot[] {
    const indexes = this.indexByIdea.get(ideaId) ?? [];
    return indexes.map((i: number) => this.snapshots[i]!).filter(Boolean);
  }

  /** Query snapshots by theme. */
  getByTheme(themeId: string, limit: number = 100): DecisionSnapshot[] {
    const indexes = this.indexByTheme.get(themeId) ?? [];
    return indexes.slice(-limit).map((i: number) => this.snapshots[i]!).filter(Boolean);
  }

  /** Query snapshots by time range. */
  getByTimeRange(start: string, end: string): DecisionSnapshot[] {
    const startMs = new Date(start).getTime();
    const endMs = new Date(end).getTime();
    return this.snapshots.filter((s: DecisionSnapshot) => {
      const ts = new Date(s.timestamp).getTime();
      return ts >= startMs && ts <= endMs;
    });
  }

  /** General-purpose query. */
  query(q: SnapshotQuery): DecisionSnapshot[] {
    let results = this.snapshots as DecisionSnapshot[];

    if (q.ideaId) {
      results = this.getByIdeaId(q.ideaId);
    }
    if (q.themeId) {
      results = results.filter((s: DecisionSnapshot) => s.themeId === q.themeId);
    }
    if (q.startTime) {
      const startMs = new Date(q.startTime).getTime();
      results = results.filter((s: DecisionSnapshot) => new Date(s.timestamp).getTime() >= startMs);
    }
    if (q.endTime) {
      const endMs = new Date(q.endTime).getTime();
      results = results.filter((s: DecisionSnapshot) => new Date(s.timestamp).getTime() <= endMs);
    }
    if (q.autonomyAction) {
      results = results.filter((s: DecisionSnapshot) => s.decisions.autonomyAction === q.autonomyAction);
    }
    if (q.limit) {
      results = results.slice(-q.limit);
    }

    return results;
  }

  /** Get total snapshot count. */
  get count(): number {
    return this.snapshots.length;
  }

  /** Build an audit report for a time range. */
  buildAuditReport(start: string, end: string): AuditReport {
    const snapshots = this.getByTimeRange(start, end);

    // Decision action distribution
    const decisionsByAction: Record<string, number> = {};
    for (const s of snapshots) {
      const action = s.decisions.autonomyAction;
      decisionsByAction[action] = (decisionsByAction[action] ?? 0) + 1;
    }

    // Conviction distribution
    const convictions = snapshots.map((s: DecisionSnapshot) => s.decisions.blendedConviction).sort((a: number, b: number) => a - b);
    const convictionDist = convictions.length > 0
      ? {
        mean: r2(convictions.reduce((a: number, b: number) => a + b, 0) / convictions.length),
        p25: convictions[Math.floor(convictions.length * 0.25)] ?? 0,
        p50: convictions[Math.floor(convictions.length * 0.5)] ?? 0,
        p75: convictions[Math.floor(convictions.length * 0.75)] ?? 0,
        min: convictions[0] ?? 0,
        max: convictions[snapshots.length - 1] ?? 0,
      }
      : { mean: 0, p25: 0, p50: 0, p75: 0, min: 0, max: 0 };

    // Veto analysis
    const vetoMap = new Map<string, { count: number; totalConviction: number }>();
    for (const s of snapshots) {
      for (const reason of s.decisions.vetoReasons) {
        const entry = vetoMap.get(reason) ?? { count: 0, totalConviction: 0 };
        entry.count += 1;
        entry.totalConviction += s.decisions.blendedConviction;
        vetoMap.set(reason, entry);
      }
    }
    const vetoAnalysis = Array.from(vetoMap.entries()).map(([reason, data]) => ({
      reason,
      count: data.count,
      avgConviction: r2(data.totalConviction / data.count),
    })).sort((a, b) => b.count - a.count);

    // Model weight drift
    const modelWeightDrift: AuditReport['modelWeightDrift'] = [];
    if (snapshots.length >= 2) {
      const first = snapshots[0]!;
      const last = snapshots[snapshots.length - 1]!;
      for (const [feature, startWeight] of Object.entries(first.context.convictionWeights)) {
        const endWeight = last.context.convictionWeights[feature] ?? startWeight;
        modelWeightDrift.push({
          feature,
          startWeight: r2(startWeight),
          endWeight: r2(endWeight),
          drift: r2(endWeight - startWeight),
        });
      }
    }

    // Top themes
    const themeCounts = new Map<string, number>();
    for (const s of snapshots) {
      themeCounts.set(s.themeId, (themeCounts.get(s.themeId) ?? 0) + 1);
    }
    const topThemes = Array.from(themeCounts.entries())
      .map(([themeId, count]) => ({ themeId, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    return {
      period: { start, end },
      totalDecisions: snapshots.length,
      decisionsByAction,
      convictionDistribution: convictionDist,
      vetoAnalysis,
      modelWeightDrift,
      topThemes,
    };
  }

  /** Apply retention policy by removing old snapshots. */
  private applyRetention(): void {
    const cutoff = this.retention.maxSnapshots * 0.8; // keep 80%
    if (this.snapshots.length <= cutoff) return;
    const toRemove = this.snapshots.length - Math.floor(cutoff);
    this.snapshots.splice(0, toRemove);
    this.rebuildIndexes();
  }

  /** Rebuild indexes after retention cleanup. */
  private rebuildIndexes(): void {
    this.indexByIdea.clear();
    this.indexByTheme.clear();
    for (let i = 0; i < this.snapshots.length; i++) {
      const s = this.snapshots[i]!;

      const ideaIndexes = this.indexByIdea.get(s.ideaId) ?? [];
      ideaIndexes.push(i);
      this.indexByIdea.set(s.ideaId, ideaIndexes);

      const themeIndexes = this.indexByTheme.get(s.themeId) ?? [];
      themeIndexes.push(i);
      this.indexByTheme.set(s.themeId, themeIndexes);
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function r2(n: number): number {
  return Math.round(n * 100) / 100;
}
