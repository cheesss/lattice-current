/**
 * Meta-Confidence — Phase 11
 *
 * Judgment boundary recognition (abstention). Determines whether
 * the system can reliably make investment judgments given the current
 * state of data, models, regime, and recent performance.
 *
 * When canJudge is false, the system should:
 *   1. Stop generating new ideas
 *   2. Freeze sizing on existing tracked ideas
 *   3. Alert the operator with reasons
 *   4. Continue collecting market data for learning
 *   5. Auto-resume when conditions are met
 */

import { clamp } from './utils';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MetaConfidenceInput {
  /** 0-1: data sufficiency score from Phase 8. */
  dataSufficiency: number;
  /** 0-1: model staleness from Phase 5 (0 = fresh, 1 = very stale). */
  modelStaleness: number;
  /** 0-1: regime uncertainty from HMM posterior entropy. */
  regimeUncertainty: number;
  /** 0-1: edge strength from Phase 10 hypothesis verification. */
  edgeStrength: number;
  /** Recent N-day rolling return percentage (+/-). */
  recentPerformancePct: number;
  /** Sigma of current volatility relative to historical distribution. */
  volatilityRegimeSigma: number;
}

export interface MetaConfidenceAssessment {
  /** Whether the system can make reliable judgments right now. */
  canJudge: boolean;
  /** 0-1: confidence in this assessment itself. */
  confidence: number;
  /** Reasons for abstention (empty if canJudge is true). */
  abstentionReasons: string[];
  /** Factors that are degraded but not blocking. */
  degradedFactors: string[];
  /** Per-factor scores for diagnostics. */
  factorScores: MetaConfidenceFactorScores;
  /** Recommended actions. */
  actions: AbstentionAction[];
}

export interface MetaConfidenceFactorScores {
  dataSufficiency: number;
  modelFreshness: number;
  regimeClarity: number;
  edgeStrength: number;
  recentPerformance: number;
  volatilityNormality: number;
}

export type AbstentionAction =
  | 'halt_new_ideas'
  | 'freeze_sizing'
  | 'alert_operator'
  | 'continue_data_collection'
  | 'auto_resume_when_clear'
  | 'reduce_position_sizes'
  | 'widen_stop_losses';

// ---------------------------------------------------------------------------
// Thresholds (configurable)
// ---------------------------------------------------------------------------

export interface MetaConfidenceThresholds {
  minDataSufficiency: number;
  maxModelStaleness: number;
  maxRegimeUncertainty: number;
  minEdgeStrength: number;
  minRecentPerformancePct: number;
  maxVolatilitySigma: number;
  degradedDataSufficiency: number;
  degradedModelStaleness: number;
  degradedRegimeUncertainty: number;
}

export const DEFAULT_THRESHOLDS: MetaConfidenceThresholds = {
  minDataSufficiency: 0.3,
  maxModelStaleness: 0.7,
  maxRegimeUncertainty: 0.8,
  minEdgeStrength: 0.15,
  minRecentPerformancePct: -20,
  maxVolatilitySigma: 3.0,
  // "Degraded" thresholds (warning, not blocking)
  degradedDataSufficiency: 0.5,
  degradedModelStaleness: 0.5,
  degradedRegimeUncertainty: 0.6,
};

// ---------------------------------------------------------------------------
// Core Assessment
// ---------------------------------------------------------------------------

/**
 * Assess whether the system can make reliable investment judgments.
 */
export function assessMetaConfidence(
  input: MetaConfidenceInput,
  thresholds: MetaConfidenceThresholds = DEFAULT_THRESHOLDS,
): MetaConfidenceAssessment {
  const abstentionReasons: string[] = [];
  const degradedFactors: string[] = [];
  const actions: AbstentionAction[] = [];

  // Factor scores (higher = better)
  const factorScores: MetaConfidenceFactorScores = {
    dataSufficiency: clamp(input.dataSufficiency, 0, 1),
    modelFreshness: clamp(1 - input.modelStaleness, 0, 1),
    regimeClarity: clamp(1 - input.regimeUncertainty, 0, 1),
    edgeStrength: clamp(input.edgeStrength, 0, 1),
    recentPerformance: clamp((input.recentPerformancePct + 30) / 60, 0, 1), // map -30..+30 → 0..1
    volatilityNormality: clamp(1 - (input.volatilityRegimeSigma / 5), 0, 1), // map 0..5σ → 1..0
  };

  // --- Hard blocking checks ---

  if (input.dataSufficiency < thresholds.minDataSufficiency) {
    abstentionReasons.push('Insufficient data coverage');
    actions.push('halt_new_ideas', 'continue_data_collection');
  } else if (input.dataSufficiency < thresholds.degradedDataSufficiency) {
    degradedFactors.push('Data coverage below optimal level');
    actions.push('reduce_position_sizes');
  }

  if (input.modelStaleness > thresholds.maxModelStaleness) {
    abstentionReasons.push('Model is stale relative to current conditions');
    actions.push('halt_new_ideas', 'freeze_sizing');
  } else if (input.modelStaleness > thresholds.degradedModelStaleness) {
    degradedFactors.push('Model freshness degraded');
  }

  if (input.regimeUncertainty > thresholds.maxRegimeUncertainty) {
    abstentionReasons.push('Market regime highly uncertain');
    actions.push('halt_new_ideas', 'freeze_sizing');
  } else if (input.regimeUncertainty > thresholds.degradedRegimeUncertainty) {
    degradedFactors.push('Regime clarity below optimal level');
  }

  if (input.recentPerformancePct < thresholds.minRecentPerformancePct) {
    abstentionReasons.push('Recent performance sharply negative — model review needed');
    actions.push('halt_new_ideas', 'freeze_sizing', 'alert_operator');
  }

  if (input.volatilityRegimeSigma > thresholds.maxVolatilitySigma) {
    abstentionReasons.push('Extreme volatility outside training range');
    actions.push('halt_new_ideas', 'widen_stop_losses');
  }

  // Edge strength is a softer signal — degraded, not blocking
  if (input.edgeStrength < thresholds.minEdgeStrength) {
    degradedFactors.push('No verified competitive edge');
  }

  const canJudge = abstentionReasons.length === 0;

  // Always add operator alert and auto-resume for abstention
  if (!canJudge) {
    if (!actions.includes('alert_operator')) actions.push('alert_operator');
    actions.push('continue_data_collection', 'auto_resume_when_clear');
  }

  // Deduplicate actions
  const uniqueActions = Array.from(new Set(actions));

  // Compute composite confidence
  const weights = { data: 0.25, model: 0.20, regime: 0.20, edge: 0.10, perf: 0.15, vol: 0.10 };
  const weightedScore =
    factorScores.dataSufficiency * weights.data +
    factorScores.modelFreshness * weights.model +
    factorScores.regimeClarity * weights.regime +
    factorScores.edgeStrength * weights.edge +
    factorScores.recentPerformance * weights.perf +
    factorScores.volatilityNormality * weights.vol;

  const confidence = clamp(Math.round(weightedScore * 1000) / 1000, 0, 1);

  return {
    canJudge,
    confidence,
    abstentionReasons,
    degradedFactors,
    factorScores,
    actions: uniqueActions,
  };
}

// ---------------------------------------------------------------------------
// Resume Check
// ---------------------------------------------------------------------------

/**
 * Check whether conditions have improved enough to resume judgment.
 * Requires ALL factors to be above their blocking thresholds.
 */
export function canResumeJudgment(
  input: MetaConfidenceInput,
  thresholds: MetaConfidenceThresholds = DEFAULT_THRESHOLDS,
): { canResume: boolean; remainingBlockers: string[] } {
  const blockers: string[] = [];

  if (input.dataSufficiency < thresholds.minDataSufficiency) {
    blockers.push(`Data sufficiency ${(input.dataSufficiency * 100).toFixed(0)}% < ${(thresholds.minDataSufficiency * 100).toFixed(0)}%`);
  }
  if (input.modelStaleness > thresholds.maxModelStaleness) {
    blockers.push(`Model staleness ${(input.modelStaleness * 100).toFixed(0)}% > ${(thresholds.maxModelStaleness * 100).toFixed(0)}%`);
  }
  if (input.regimeUncertainty > thresholds.maxRegimeUncertainty) {
    blockers.push(`Regime uncertainty ${(input.regimeUncertainty * 100).toFixed(0)}% > ${(thresholds.maxRegimeUncertainty * 100).toFixed(0)}%`);
  }
  if (input.recentPerformancePct < thresholds.minRecentPerformancePct) {
    blockers.push(`Recent performance ${input.recentPerformancePct.toFixed(1)}% < ${thresholds.minRecentPerformancePct}%`);
  }
  if (input.volatilityRegimeSigma > thresholds.maxVolatilitySigma) {
    blockers.push(`Volatility ${input.volatilityRegimeSigma.toFixed(1)}σ > ${thresholds.maxVolatilitySigma}σ`);
  }

  return { canResume: blockers.length === 0, remainingBlockers: blockers };
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

/** Human-readable summary of assessment. */
export function summarizeAssessment(assessment: MetaConfidenceAssessment): string {
  if (assessment.canJudge) {
    const degradedNote = assessment.degradedFactors.length > 0
      ? ` (degraded: ${assessment.degradedFactors.join(', ')})`
      : '';
    return `System CAN judge. Confidence=${(assessment.confidence * 100).toFixed(0)}%${degradedNote}`;
  }
  return `System CANNOT judge. Reasons: ${assessment.abstentionReasons.join('; ')}. Actions: ${assessment.actions.join(', ')}.`;
}
