import type { AutonomyThresholds } from './types';
import { DEFAULT_AUTONOMY } from './types';

function clamp(v: number, min: number, max: number): number { return Math.max(min, Math.min(max, v)); }

function percentile(sorted: number[], p: number): number {
  const idx = Math.max(0, Math.ceil(sorted.length * p) - 1);
  return sorted[idx] ?? 0;
}

export function computeAutonomyThresholds(
  ideaRuns: Array<{ conviction?: number }>,
  minSampleSize = 10,
): AutonomyThresholds {
  const convictions = ideaRuns
    .map(r => r.conviction)
    .filter((c): c is number => typeof c === 'number' && Number.isFinite(c))
    .sort((a, b) => a - b);

  if (convictions.length < minSampleSize) return { ...DEFAULT_AUTONOMY };

  return {
    abstainFloor: clamp(Math.round(percentile(convictions, 0.15)), 12, 44),
    shadowFloor: clamp(Math.round(percentile(convictions, 0.40)), 24, 64),
    watchFloor: clamp(Math.round(percentile(convictions, 0.65)), 34, 78),
  };
}
