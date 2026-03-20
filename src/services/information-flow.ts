import { estimateTransferEntropy } from './math-models/transfer-entropy';
import {
  estimateLaggedNormalizedMutualInformation,
  estimateNormalizedMutualInformation,
} from './math-models/normalized-mutual-information';

export interface TimedFlowPoint {
  at: number | Date | string;
  value: number;
  weight?: number;
}

export interface TimedSeriesAlignment {
  source: number[];
  target: number[];
  bucketMs: number;
  bucketCount: number;
  sampleSize: number;
  startMs: number;
  endMs: number;
}

export interface DirectionalFlowSummary {
  sourceToTargetNmi: number;
  targetToSourceNmi: number;
  sourceToTargetTe: number;
  targetToSourceTe: number;
  leadLagScore: number;
  flowScore: number;
  bestLagBuckets: number;
  bestLagHours: number;
  direction: 'source-leading' | 'target-leading' | 'neutral';
  supportScore: number;
  sampleSize: number;
  bucketMs: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function toTimestamp(value: number | Date | string): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const ts = value instanceof Date ? value.getTime() : Date.parse(String(value));
  return Number.isFinite(ts) ? ts : null;
}

function normalizeWeight(value: number | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 1;
  return Math.max(0.1, Math.min(6, value));
}

export function alignTimedSeries(
  sourcePoints: TimedFlowPoint[],
  targetPoints: TimedFlowPoint[],
  options: { bucketMs?: number; minBuckets?: number } = {},
): TimedSeriesAlignment {
  const bucketMs = Math.max(60 * 60 * 1000, Math.round(options.bucketMs ?? 24 * 60 * 60 * 1000));
  const minBuckets = Math.max(4, Math.round(options.minBuckets ?? 8));
  const sourceTimes = sourcePoints.map((point) => toTimestamp(point.at)).filter((value): value is number => typeof value === 'number');
  const targetTimes = targetPoints.map((point) => toTimestamp(point.at)).filter((value): value is number => typeof value === 'number');
  const allTimes = [...sourceTimes, ...targetTimes];

  if (!allTimes.length) {
    return {
      source: Array.from({ length: minBuckets }, () => 0),
      target: Array.from({ length: minBuckets }, () => 0),
      bucketMs,
      bucketCount: minBuckets,
      sampleSize: sourcePoints.length + targetPoints.length,
      startMs: 0,
      endMs: 0,
    };
  }

  const startMs = Math.floor(Math.min(...allTimes) / bucketMs) * bucketMs;
  const endMs = Math.ceil(Math.max(...allTimes) / bucketMs) * bucketMs;
  const bucketCount = Math.max(minBuckets, Math.floor((endMs - startMs) / bucketMs) + 1);
  const source = Array.from({ length: bucketCount }, () => 0);
  const target = Array.from({ length: bucketCount }, () => 0);

  for (const point of sourcePoints) {
    const timestamp = toTimestamp(point.at);
    if (timestamp == null) continue;
    const index = clamp(Math.floor((timestamp - startMs) / bucketMs), 0, bucketCount - 1);
    source[index]! = (source[index] ?? 0) + point.value * normalizeWeight(point.weight);
  }

  for (const point of targetPoints) {
    const timestamp = toTimestamp(point.at);
    if (timestamp == null) continue;
    const index = clamp(Math.floor((timestamp - startMs) / bucketMs), 0, bucketCount - 1);
    target[index]! = (target[index] ?? 0) + point.value * normalizeWeight(point.weight);
  }

  return {
    source,
    target,
    bucketMs,
    bucketCount,
    sampleSize: sourcePoints.length + targetPoints.length,
    startMs,
    endMs,
  };
}

function directionFromScore(score: number): 'source-leading' | 'target-leading' | 'neutral' {
  if (score > 10) return 'source-leading';
  if (score < -10) return 'target-leading';
  return 'neutral';
}

export function estimateDirectionalFlowSummary(
  sourcePoints: TimedFlowPoint[],
  targetPoints: TimedFlowPoint[],
  options: { bucketMs?: number; maxLag?: number; minBuckets?: number } = {},
): DirectionalFlowSummary {
  const alignment = alignTimedSeries(sourcePoints, targetPoints, options);
  const sourceSeries = alignment.source;
  const targetSeries = alignment.target;
  const sampleWeight = clamp(1 - Math.exp(-alignment.sampleSize / 8), 0, 1);
  const forwardNmi = estimateNormalizedMutualInformation(sourceSeries, targetSeries);
  const reverseNmi = estimateNormalizedMutualInformation(targetSeries, sourceSeries);
  const forwardLag = estimateLaggedNormalizedMutualInformation(sourceSeries, targetSeries, { maxLag: options.maxLag ?? 4 });
  const reverseLag = estimateLaggedNormalizedMutualInformation(targetSeries, sourceSeries, { maxLag: options.maxLag ?? 4 });
  const forwardTe = estimateTransferEntropy(sourceSeries, targetSeries);
  const reverseTe = estimateTransferEntropy(targetSeries, sourceSeries);

  const forwardScore = forwardNmi.normalized * 0.38 + forwardLag.supportScore * 0.24 + forwardTe.normalized * 0.38;
  const reverseScore = reverseNmi.normalized * 0.38 + reverseLag.supportScore * 0.24 + reverseTe.normalized * 0.38;
  const scoreDelta = (forwardScore - reverseScore) * 100 * sampleWeight;
  const leadLagScore = clamp(Number(scoreDelta.toFixed(2)), -100, 100);
  const flowScore = clamp(Number((Math.max(forwardScore, reverseScore) * 100 * sampleWeight).toFixed(2)), 0, 100);
  const direction = directionFromScore(leadLagScore);
  const bestLagBuckets = direction === 'source-leading'
    ? forwardLag.lag
    : direction === 'target-leading'
      ? -reverseLag.lag
      : 0;
  const bestLagHours = Number(((bestLagBuckets * alignment.bucketMs) / 3_600_000).toFixed(2));
  const supportScore = clamp(
    Number((flowScore * 0.72 + Math.max(0, Math.abs(leadLagScore)) * 0.28).toFixed(2)),
    0,
    100,
  );

  return {
    sourceToTargetNmi: forwardNmi.normalized,
    targetToSourceNmi: reverseNmi.normalized,
    sourceToTargetTe: forwardTe.normalized,
    targetToSourceTe: reverseTe.normalized,
    leadLagScore,
    flowScore,
    bestLagBuckets,
    bestLagHours,
    direction,
    supportScore,
    sampleSize: alignment.sampleSize,
    bucketMs: alignment.bucketMs,
  };
}
