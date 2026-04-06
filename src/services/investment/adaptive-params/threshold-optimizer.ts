import { clamp } from './math-utils';

export interface AdmissionThresholds {
  rejectHitProbability: number;
  watchHitProbability: number;
  rejectExpectedReturnPct: number;
  watchExpectedReturnPct: number;
  rejectScore: number;
  watchScore: number;
}

const DEFAULT_THRESHOLDS: AdmissionThresholds = {
  rejectHitProbability: 0.44,
  watchHitProbability: 0.52,
  rejectExpectedReturnPct: -0.2,
  watchExpectedReturnPct: 0.08,
  rejectScore: 38,
  watchScore: 52,
};

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function sampleStd(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = average(values);
  const variance = values.reduce((sum, value) => sum + ((value - mean) ** 2), 0) / (values.length - 1);
  return Math.sqrt(Math.max(variance, 0));
}

function scaleScoreFloor(rejectHitProbability: number): { rejectScore: number; watchScore: number } {
  const delta = rejectHitProbability - DEFAULT_THRESHOLDS.rejectHitProbability;
  const rejectScore = Math.round(clamp(DEFAULT_THRESHOLDS.rejectScore + (delta * 175), 24, 70));
  const watchScore = Math.round(clamp(rejectScore + 14, rejectScore + 6, 84));
  return { rejectScore, watchScore };
}

export function optimizeAdmissionThresholds(
  ideaRuns: Array<{
    metaHitProbability: number;
    metaExpectedReturnPct: number;
    metaDecisionScore: number;
    forwardReturnPct: number | null;
  }>,
  options?: {
    targetAcceptRate?: number;
    minSampleSize?: number;
  },
): AdmissionThresholds {
  const targetAcceptRate = clamp(options?.targetAcceptRate ?? 0.6, 0.05, 0.95);
  const minSampleSize = Math.max(1, Math.floor(options?.minSampleSize ?? 5));
  const samples = ideaRuns.filter((row) =>
    Number.isFinite(row.metaHitProbability)
    && Number.isFinite(row.metaExpectedReturnPct)
    && Number.isFinite(row.metaDecisionScore)
    && row.forwardReturnPct != null
    && Number.isFinite(row.forwardReturnPct));
  if (samples.length < minSampleSize) return { ...DEFAULT_THRESHOLDS };

  const sorted = samples
    .slice()
    .sort((left, right) => right.metaHitProbability - left.metaHitProbability || right.metaDecisionScore - left.metaDecisionScore);

  let bestThresholds = { ...DEFAULT_THRESHOLDS };
  let bestObjective = Number.NEGATIVE_INFINITY;

  for (let rejectHitProbability = 0.3; rejectHitProbability <= 0.6001; rejectHitProbability += 0.02) {
    const roundedReject = Number(rejectHitProbability.toFixed(2));
    const watchHitProbability = Number(clamp(roundedReject + 0.06, roundedReject + 0.02, 0.97).toFixed(2));
    const { rejectScore, watchScore } = scaleScoreFloor(roundedReject);
    const accepted = sorted.filter((row) =>
      row.metaHitProbability >= watchHitProbability
      && row.metaExpectedReturnPct >= DEFAULT_THRESHOLDS.watchExpectedReturnPct
      && row.metaDecisionScore >= watchScore);
    if (accepted.length < minSampleSize) continue;
    const returns = accepted.map((row) => row.forwardReturnPct as number);
    const meanReturn = average(returns);
    const utility = meanReturn * Math.sqrt(accepted.length) - (0.5 * sampleStd(returns));
    const acceptRate = accepted.length / sorted.length;
    const acceptRatePenalty = Math.abs(acceptRate - targetAcceptRate) * 3;
    const tooFewPenalty = acceptRate < 0.15 ? (0.15 - acceptRate) * 20 : 0;
    const objective = utility - acceptRatePenalty - tooFewPenalty;
    if (objective > bestObjective) {
      bestObjective = objective;
      bestThresholds = {
        rejectHitProbability: roundedReject,
        watchHitProbability,
        rejectExpectedReturnPct: DEFAULT_THRESHOLDS.rejectExpectedReturnPct,
        watchExpectedReturnPct: DEFAULT_THRESHOLDS.watchExpectedReturnPct,
        rejectScore,
        watchScore,
      };
    }
  }

  return bestThresholds;
}
