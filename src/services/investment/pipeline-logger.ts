/**
 * Structured logging for the investment pipeline.
 * Captures stage-level timing, warnings, and errors
 * for observability without external dependencies.
 */

export interface PipelineLogEntry {
  timestamp: string;
  stage: string;
  level: 'info' | 'warn' | 'error';
  message: string;
  durationMs?: number;
  context?: Record<string, unknown>;
}

export interface PipelineStageMetric {
  stage: string;
  entryCount: number;
  avgDurationMs: number;
  errorCount: number;
  warningCount: number;
  lastTimestamp: string;
}

export interface PipelineMetrics {
  generatedAt: string;
  totalEntries: number;
  acceptedRate: number | null;
  avgProcessingMs: number;
  errorCount: number;
  warningCount: number;
  stageMetrics: PipelineStageMetric[];
}

export interface CalibrationDiagnosticBucket {
  range: string;
  predicted: number;
  actual: number;
  count: number;
}

export interface CalibrationDiagnostic {
  ece: number;
  brierScore: number;
  buckets: CalibrationDiagnosticBucket[];
  sampleSize: number;
  warning: string | null;
}

const MAX_LOG_ENTRIES = 200;
let _log: PipelineLogEntry[] = [];
const runtimeLogger = createLogger('pipeline');

export function logPipelineEvent(
  stage: string,
  level: PipelineLogEntry['level'],
  message: string,
  meta?: { durationMs?: number; context?: Record<string, unknown> },
): void {
  const entry: PipelineLogEntry = {
    timestamp: new Date().toISOString(),
    stage,
    level,
    message,
    ...meta,
  };
  _log.push(entry);
  if (_log.length > MAX_LOG_ENTRIES) _log = _log.slice(-MAX_LOG_ENTRIES);

  // Also emit to console for dev/debug
  if (level === 'error') {
    runtimeLogger.error(`${stage}: ${message}`, meta?.context);
  } else if (level === 'warn') {
    runtimeLogger.warn(`${stage}: ${message}`, meta?.context);
  }
}

export function getPipelineLog(): readonly PipelineLogEntry[] {
  return _log;
}

export function clearPipelineLog(): void {
  _log = [];
}

export function getPipelineMetrics(): PipelineMetrics {
  const durations = _log
    .map((entry) => entry.durationMs)
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0);
  const errorCount = _log.filter((entry) => entry.level === 'error').length;
  const warningCount = _log.filter((entry) => entry.level === 'warn').length;
  const metaAdmission = [..._log]
    .reverse()
    .find((entry) => entry.stage === 'metaAdmission' && entry.context);
  const accepted = Number(metaAdmission?.context?.acceptedCount);
  const watch = Number(metaAdmission?.context?.watchCount);
  const rejected = Number(metaAdmission?.context?.rejectedCount);
  const acceptedRate = Number.isFinite(accepted) && Number.isFinite(watch) && Number.isFinite(rejected) && accepted + watch + rejected > 0
    ? Number(((accepted / (accepted + watch + rejected)) * 100).toFixed(2))
    : null;

  const grouped = new Map<string, PipelineLogEntry[]>();
  for (const entry of _log) {
    const bucket = grouped.get(entry.stage) || [];
    bucket.push(entry);
    grouped.set(entry.stage, bucket);
  }

  const stageMetrics = Array.from(grouped.entries()).map(([stage, entries]) => {
    const stageDurations = entries
      .map((entry) => entry.durationMs)
      .filter((value): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0);
    const avgDurationMs = stageDurations.length > 0
      ? Number((stageDurations.reduce((sum, value) => sum + value, 0) / stageDurations.length).toFixed(2))
      : 0;
    return {
      stage,
      entryCount: entries.length,
      avgDurationMs,
      errorCount: entries.filter((entry) => entry.level === 'error').length,
      warningCount: entries.filter((entry) => entry.level === 'warn').length,
      lastTimestamp: entries[entries.length - 1]?.timestamp || new Date(0).toISOString(),
    };
  }).sort((left, right) => left.stage.localeCompare(right.stage));

  return {
    generatedAt: new Date().toISOString(),
    totalEntries: _log.length,
    acceptedRate,
    avgProcessingMs: durations.length > 0
      ? Number((durations.reduce((sum, value) => sum + value, 0) / durations.length).toFixed(2))
      : 0,
    errorCount,
    warningCount,
    stageMetrics,
  };
}
import { createLogger } from '@/utils/logger';
