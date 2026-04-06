/**
 * Coverage ledger inference and data validation extracted from historical-stream-worker.ts.
 * Contains temporal record validation, market record replacement logic,
 * and frame filtering utilities.
 */

import type { HistoricalReplayFrame } from '../historical-intelligence';
import type { HistoricalRawReplayRecord, HistoricalFrameLoadOptions } from './historical-stream-worker';

// ── Utility helpers ──

function asTs(value: string | null | undefined): number {
  if (!value) return 0;
  const ts = Date.parse(value);
  return Number.isFinite(ts) ? ts : 0;
}

function toIso(value: unknown, fallback?: string): string {
  if (typeof value === 'string' && value.trim()) {
    const trimmed = value.trim();
    const gdeltCompact = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/i.exec(trimmed);
    if (gdeltCompact) {
      const [, year, month, day, hour, minute, second] = gdeltCompact;
      return new Date(`${year}-${month}-${day}T${hour}:${minute}:${second}Z`).toISOString();
    }
    const asNumber = /^\d{10,13}$/.test(trimmed) ? Number(trimmed) : null;
    if (asNumber && Number.isFinite(asNumber)) {
      const scaled = trimmed.length === 13 ? asNumber : asNumber * 1000;
      return new Date(scaled).toISOString();
    }
    const parsed = new Date(trimmed);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    const scaled = value > 1e12 ? value : value * 1000;
    return new Date(scaled).toISOString();
  }
  if (fallback) return fallback;
  return '';
}

const IMPORT_FUTURE_TOLERANCE_MS = 5 * 60 * 1000;

// ── Temporal validation ──

export function validateTemporalRecord(record: HistoricalRawReplayRecord): { ok: boolean; reason?: string } {
  const now = Date.now();
  const validTs = asTs(record.validTimeStart);
  const transactionTs = asTs(record.transactionTime);
  const knowledgeTs = asTs(record.knowledgeBoundary);

  if (!validTs || !transactionTs || !knowledgeTs) {
    return { ok: false, reason: 'invalid-timestamp' };
  }
  if (validTs > now + IMPORT_FUTURE_TOLERANCE_MS) {
    return { ok: false, reason: 'future-valid-time' };
  }
  if (validTs > transactionTs) {
    return { ok: false, reason: 'valid-after-transaction' };
  }
  if (knowledgeTs < transactionTs) {
    return { ok: false, reason: 'knowledge-before-transaction' };
  }
  return { ok: true };
}

// ── Market record replacement ──

export function shouldReplaceMarketRecord(
  candidate: HistoricalRawReplayRecord,
  current: HistoricalRawReplayRecord,
): boolean {
  const candidateKnowledge = asTs(candidate.knowledgeBoundary);
  const currentKnowledge = asTs(current.knowledgeBoundary);
  if (candidateKnowledge !== currentKnowledge) return candidateKnowledge > currentKnowledge;
  const candidateTransaction = asTs(candidate.transactionTime);
  const currentTransaction = asTs(current.transactionTime);
  if (candidateTransaction !== currentTransaction) return candidateTransaction > currentTransaction;
  return asTs(candidate.validTimeStart) >= asTs(current.validTimeStart);
}

// ── Frame filtering ──

export function filterLoadedFrames(
  frames: HistoricalReplayFrame[],
  options: HistoricalFrameLoadOptions,
): HistoricalReplayFrame[] {
  let filtered = options.includeWarmup ? frames.slice() : frames.filter((frame) => !frame.warmup);
  if (options.startTransactionTime) {
    const startTs = asTs(toIso(options.startTransactionTime));
    filtered = filtered.filter((frame) => asTs(frame.transactionTime || frame.timestamp) >= startTs);
  }
  if (options.endTransactionTime) {
    const endTs = asTs(toIso(options.endTransactionTime));
    filtered = filtered.filter((frame) => asTs(frame.transactionTime || frame.timestamp) <= endTs);
  }
  if (options.knowledgeBoundaryCeiling) {
    const ceilingTs = asTs(toIso(options.knowledgeBoundaryCeiling));
    filtered = filtered.filter((frame) => asTs(frame.knowledgeBoundary || frame.timestamp) <= ceilingTs);
  }
  if (options.latestFirst) filtered = filtered.slice().reverse();
  if (typeof options.maxFrames === 'number' && options.maxFrames > 0) {
    filtered = filtered.slice(0, Math.floor(options.maxFrames));
  }
  return options.latestFirst ? filtered.slice().reverse() : filtered;
}

// ── Dataset provider detection ──

export function shouldReplaceDatasetRawItemsOnImport(provider: string): boolean {
  return ['coingecko', 'fred', 'alfred', 'yahoo-chart'].includes(String(provider || '').trim().toLowerCase());
}
