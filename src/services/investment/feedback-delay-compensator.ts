/**
 * Feedback Delay Compensator — Phase 5
 *
 * Addresses the time-scale mismatch between fast event detection (minutes)
 * and slow forward-return confirmation (days). Provides regime-aware learning
 * decay, model staleness estimation, and confidence adjustment.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Market regime identifier. */
export type MarketRegimeId = string;

/** Metadata recorded for each conviction model update event. */
export interface ConvictionUpdateEvent {
  timestamp: string;
  ideaRunId: string;
  realizedReturnPct: number;
  regimeAtGeneration: MarketRegimeId;
  regimeAtClose: MarketRegimeId;
  regimeAtUpdate: MarketRegimeId;
  convictionAtGeneration: number;
  holdingDurationHours: number;
  featureSnapshot: Record<string, number>;
  weightsBefore: Record<string, number>;
  weightsAfter: Record<string, number>;
}

/** Info about a pending (not yet closed) idea for staleness tracking. */
export interface PendingIdeaInfo {
  ideaId: string;
  generatedAt: string;
  regimeAtGeneration: MarketRegimeId;
  convictionAtGeneration: number;
}

/** Report on how stale the current model weights are. */
export interface ModelStalenessReport {
  /** Staleness score 0-1 (0 = fresh, 1 = very stale). */
  stalenessScore: number;
  /** Hours since last model update. */
  hoursSinceLastUpdate: number;
  /** Number of regime changes since last update. */
  regimeChangesSinceUpdate: number;
  /** Number of pending ideas awaiting close. */
  pendingIdeaCount: number;
  /** Suggested confidence multiplier (1.0 = full, 0.0 = no confidence). */
  confidenceMultiplier: number;
  /** Human-readable explanation. */
  explanation: string;
}

/** Parameters for regime-aware learning rate computation. */
export interface RegimeAwareLearningParams {
  /** Base learning rate. */
  baseLearningRate: number;
  /** Current market regime. */
  currentRegime: MarketRegimeId;
  /** Regime at the time the idea was generated. */
  regimeAtGeneration: MarketRegimeId;
  /** Hours the idea was held before close. */
  holdingDurationHours: number;
}

/** Regime-partitioned bandit state key. */
export interface RegimeBanditKey {
  armId: string;
  regime: MarketRegimeId;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Decay rate for holding duration penalty. */
const HOLDING_DECAY_RATE = 0.02;

/** Regime mismatch discount factor. */
const REGIME_MISMATCH_DISCOUNT = 0.5;

/** Maximum hours before model is considered very stale. */
const MAX_STALENESS_HOURS = 168; // 7 days

/** Regime changes that make model very stale. */
const MAX_REGIME_CHANGES_FOR_STALE = 4;

// ---------------------------------------------------------------------------
// Regime-Aware Learning Rate
// ---------------------------------------------------------------------------

/**
 * Compute an effective learning rate that accounts for:
 * 1. Regime mismatch between generation and current state
 * 2. Recency of the closed idea (older ideas contribute less)
 */
export function computeRegimeAwareLearningRate(params: RegimeAwareLearningParams): number {
  const regimeMatch = params.regimeAtGeneration === params.currentRegime
    ? 1.0
    : REGIME_MISMATCH_DISCOUNT;
  const recencyWeight = Math.exp(-HOLDING_DECAY_RATE * params.holdingDurationHours);
  return params.baseLearningRate * regimeMatch * recencyWeight;
}

/**
 * Build a ConvictionUpdateEvent capturing all metadata for an update.
 */
export function buildConvictionUpdateEvent(args: {
  ideaRunId: string;
  realizedReturnPct: number;
  regimeAtGeneration: MarketRegimeId;
  regimeAtClose: MarketRegimeId;
  currentRegime: MarketRegimeId;
  convictionAtGeneration: number;
  holdingDurationHours: number;
  featureSnapshot: Record<string, number>;
  weightsBefore: Record<string, number>;
  weightsAfter: Record<string, number>;
}): ConvictionUpdateEvent {
  return {
    timestamp: new Date().toISOString(),
    ideaRunId: args.ideaRunId,
    realizedReturnPct: args.realizedReturnPct,
    regimeAtGeneration: args.regimeAtGeneration,
    regimeAtClose: args.regimeAtClose,
    regimeAtUpdate: args.currentRegime,
    convictionAtGeneration: args.convictionAtGeneration,
    holdingDurationHours: args.holdingDurationHours,
    featureSnapshot: { ...args.featureSnapshot },
    weightsBefore: { ...args.weightsBefore },
    weightsAfter: { ...args.weightsAfter },
  };
}

// ---------------------------------------------------------------------------
// Feedback Delay Compensator
// ---------------------------------------------------------------------------

export class FeedbackDelayCompensator {
  private pendingIdeas = new Map<string, PendingIdeaInfo>();
  private updateHistory: ConvictionUpdateEvent[] = [];
  private regimeHistory: Array<{ regime: MarketRegimeId; timestamp: string }> = [];
  private lastUpdateTimestamp: string | null = null;
  private maxHistorySize: number;

  constructor(options: { maxHistorySize?: number } = {}) {
    this.maxHistorySize = options.maxHistorySize ?? 500;
  }

  // -----------------------------------------------------------------------
  // Pending Ideas Tracking
  // -----------------------------------------------------------------------

  /** Register a newly generated idea as pending. */
  registerPendingIdea(info: PendingIdeaInfo): void {
    this.pendingIdeas.set(info.ideaId, info);
  }

  /** Remove a closed idea from pending. */
  closePendingIdea(ideaId: string): PendingIdeaInfo | null {
    const info = this.pendingIdeas.get(ideaId) ?? null;
    this.pendingIdeas.delete(ideaId);
    return info;
  }

  /** Get current pending idea count. */
  get pendingCount(): number {
    return this.pendingIdeas.size;
  }

  // -----------------------------------------------------------------------
  // Regime History
  // -----------------------------------------------------------------------

  /** Record a regime change. */
  recordRegimeChange(regime: MarketRegimeId): void {
    const last = this.regimeHistory[this.regimeHistory.length - 1];
    if (last && last.regime === regime) return; // no actual change
    this.regimeHistory.push({ regime, timestamp: new Date().toISOString() });
    if (this.regimeHistory.length > this.maxHistorySize) {
      this.regimeHistory.splice(0, this.regimeHistory.length - this.maxHistorySize);
    }
  }

  /** Get regime changes since a timestamp. */
  regimeChangesSince(since: string): number {
    const sinceMs = new Date(since).getTime();
    return this.regimeHistory.filter(
      (entry) => new Date(entry.timestamp).getTime() > sinceMs,
    ).length;
  }

  // -----------------------------------------------------------------------
  // Update Tracking
  // -----------------------------------------------------------------------

  /** Record a completed conviction model update. */
  recordUpdate(event: ConvictionUpdateEvent): void {
    this.updateHistory.push(event);
    this.lastUpdateTimestamp = event.timestamp;
    if (this.updateHistory.length > this.maxHistorySize) {
      this.updateHistory.splice(0, this.updateHistory.length - this.maxHistorySize);
    }
  }

  /** Get recent update history. */
  getRecentUpdates(limit: number = 20): readonly ConvictionUpdateEvent[] {
    return this.updateHistory.slice(-limit);
  }

  // -----------------------------------------------------------------------
  // Staleness Estimation
  // -----------------------------------------------------------------------

  /** Estimate how stale the current model weights are. */
  estimateModelStaleness(): ModelStalenessReport {
    const now = Date.now();
    const lastUpdate = this.lastUpdateTimestamp
      ? new Date(this.lastUpdateTimestamp).getTime()
      : now - MAX_STALENESS_HOURS * 3600_000; // assume very stale if never updated

    const hoursSinceLastUpdate = (now - lastUpdate) / 3600_000;
    const regimeChanges = this.lastUpdateTimestamp
      ? this.regimeChangesSince(this.lastUpdateTimestamp)
      : 0;

    // Time-based staleness (0-1)
    const timeStaleness = Math.min(1, hoursSinceLastUpdate / MAX_STALENESS_HOURS);

    // Regime-based staleness (0-1)
    const regimeStaleness = Math.min(1, regimeChanges / MAX_REGIME_CHANGES_FOR_STALE);

    // Combined staleness (weighted)
    const stalenessScore = Math.min(1, timeStaleness * 0.6 + regimeStaleness * 0.4);

    // Confidence multiplier (inverse of staleness, with floor)
    const confidenceMultiplier = Math.max(0.2, 1 - stalenessScore * 0.8);

    let explanation: string;
    if (stalenessScore < 0.2) {
      explanation = 'Model weights are fresh and recently updated.';
    } else if (stalenessScore < 0.5) {
      explanation = `Model weights are moderately stale (${Math.round(hoursSinceLastUpdate)}h since update, ${regimeChanges} regime changes).`;
    } else if (stalenessScore < 0.8) {
      explanation = `Model weights are significantly stale. ${regimeChanges} regime changes since last update.`;
    } else {
      explanation = `Model weights are very stale (${Math.round(hoursSinceLastUpdate)}h). Consider reducing position sizes.`;
    }

    return {
      stalenessScore: r2(stalenessScore),
      hoursSinceLastUpdate: Math.round(hoursSinceLastUpdate * 100) / 100,
      regimeChangesSinceUpdate: regimeChanges,
      pendingIdeaCount: this.pendingIdeas.size,
      confidenceMultiplier: r2(confidenceMultiplier),
      explanation,
    };
  }

  /**
   * Adjust a base confidence score based on model staleness.
   * When weights are stale, confidence should be reduced.
   */
  adjustConfidenceForStaleness(baseConfidence: number): number {
    const report = this.estimateModelStaleness();
    return Math.round(baseConfidence * report.confidenceMultiplier);
  }

  // -----------------------------------------------------------------------
  // Regime-Partitioned Bandit Keys
  // -----------------------------------------------------------------------

  /**
   * Build a regime-partitioned key for bandit state lookup.
   * When data is insufficient for regime-specific state, falls back to global.
   */
  static buildBanditKey(armId: string, regime: MarketRegimeId | null): string {
    return regime ? `${armId}::${regime}` : armId;
  }

  /**
   * Parse a regime-partitioned bandit key.
   */
  static parseBanditKey(key: string): RegimeBanditKey {
    const parts = key.split('::');
    return {
      armId: parts[0] ?? key,
      regime: parts[1] ?? 'global',
    };
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function r2(n: number): number {
  return Math.round(n * 100) / 100;
}
