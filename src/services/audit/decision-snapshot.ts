/**
 * Decision Snapshot — Phase 7
 *
 * Captures the complete decision context for each investment idea,
 * enabling post-hoc analysis, audit, and decision replay.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Complete snapshot of all inputs to a single idea decision. */
export interface DecisionSnapshot {
  /** Unique snapshot identifier. */
  snapshotId: string;
  /** When this decision was made. */
  timestamp: string;
  /** The idea this decision relates to. */
  ideaId: string;
  /** Theme that generated this idea. */
  themeId: string;

  /** Full input context at decision time. */
  context: DecisionContext;

  /** The decision path and outputs. */
  decisions: DecisionOutcome;

  /** Reproducibility metadata. */
  reproducibility: ReproducibilityInfo;
}

/** All inputs that influenced the decision. */
export interface DecisionContext {
  /** Market regime at decision time. */
  regime: { id: string; label: string; confidence: number } | null;
  /** Conviction feature scores. */
  convictionFeatures: Record<string, number>;
  /** Model weights at decision time. */
  convictionWeights: Record<string, number>;
  /** Model bias at decision time. */
  convictionBias: number;
  /** Model observation count. */
  modelObservations: number;
  /** Bandit arm score (if applicable). */
  banditScore: number | null;
  /** Macro risk overlay state. */
  macroOverlayState: string | null;
  /** Source profiles that contributed to this idea. */
  sourceProfileIds: string[];
  /** Risk assessment from Phase 4 (if available). */
  riskAssessment: {
    approved: boolean;
    vetoReasons: string[];
    adjustedSizePct: number;
  } | null;
}

/** The decision outputs. */
export interface DecisionOutcome {
  /** Raw conviction before blending. */
  rawConviction: number;
  /** Blended conviction after model adjustment. */
  blendedConviction: number;
  /** Autonomy action taken. */
  autonomyAction: string;
  /** Final position size percentage. */
  finalSizePct: number;
  /** Veto reasons (empty if approved). */
  vetoReasons: string[];
  /** Attribution breakdown. */
  attribution: AttributionEntry[];
}

/** Single attribution component. */
export interface AttributionEntry {
  key: string;
  label: string;
  contribution: number;
  explanation: string;
}

/** Metadata for decision replay. */
export interface ReproducibilityInfo {
  /** State store version at decision time. */
  stateStoreVersion: number;
  /** Hash of the configuration. */
  configHash: string;
  /** Execution context mode. */
  executionMode: string;
}

// ---------------------------------------------------------------------------
// Snapshot Builder
// ---------------------------------------------------------------------------

let snapshotCounter = 0;

/** Generate a unique snapshot ID. */
export function generateSnapshotId(): string {
  snapshotCounter += 1;
  const ts = Date.now().toString(36);
  const counter = snapshotCounter.toString(36).padStart(4, '0');
  const rand = Math.random().toString(36).substring(2, 6);
  return `snap-${ts}-${counter}-${rand}`;
}

/** Build a DecisionSnapshot from provided components. */
export function buildDecisionSnapshot(args: {
  ideaId: string;
  themeId: string;
  context: DecisionContext;
  decisions: DecisionOutcome;
  reproducibility: ReproducibilityInfo;
  timestamp?: string;
}): DecisionSnapshot {
  return {
    snapshotId: generateSnapshotId(),
    timestamp: args.timestamp ?? new Date().toISOString(),
    ideaId: args.ideaId,
    themeId: args.themeId,
    context: deepCopy(args.context),
    decisions: deepCopy(args.decisions),
    reproducibility: { ...args.reproducibility },
  };
}

/** Validate a snapshot for completeness. */
export function validateSnapshot(snapshot: DecisionSnapshot): string[] {
  const errors: string[] = [];
  if (!snapshot.snapshotId) errors.push('Missing snapshotId');
  if (!snapshot.timestamp) errors.push('Missing timestamp');
  if (!snapshot.ideaId) errors.push('Missing ideaId');
  if (!snapshot.themeId) errors.push('Missing themeId');
  if (!snapshot.context) errors.push('Missing context');
  if (!snapshot.decisions) errors.push('Missing decisions');
  if (snapshot.decisions && typeof snapshot.decisions.rawConviction !== 'number') {
    errors.push('Missing rawConviction in decisions');
  }
  if (snapshot.decisions && typeof snapshot.decisions.blendedConviction !== 'number') {
    errors.push('Missing blendedConviction in decisions');
  }
  return errors;
}

/** Extract a compact summary from a snapshot (for logging). */
export function summarizeSnapshot(snapshot: DecisionSnapshot): string {
  const d = snapshot.decisions;
  return [
    `[${snapshot.snapshotId}]`,
    `idea=${snapshot.ideaId}`,
    `theme=${snapshot.themeId}`,
    `conviction=${d.rawConviction}→${d.blendedConviction}`,
    `action=${d.autonomyAction}`,
    `size=${d.finalSizePct}%`,
    d.vetoReasons.length > 0 ? `vetoed(${d.vetoReasons.length})` : 'approved',
  ].join(' ');
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function deepCopy<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj)) as T;
}
