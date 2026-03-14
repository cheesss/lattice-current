type ResourceOperationKind =
  | 'collection'
  | 'analytics'
  | 'risk'
  | 'graph'
  | 'backtest'
  | 'storage'
  | 'api'
  | 'orchestration';

type ResourcePrimitive = string | number | boolean | null;

export interface ResourceDesktopSnapshot {
  timestamp: string;
  rssMB: number | null;
  heapUsedMB: number | null;
  heapTotalMB: number | null;
  externalMB: number | null;
  arrayBuffersMB: number | null;
  cpuUserSec: number | null;
  cpuSystemSec: number | null;
  uptimeSec: number | null;
  loadAvg1m: number | null;
  archiveDbMB: number | null;
}

export interface ResourceStorageSnapshot {
  timestamp: string;
  usedMB: number | null;
  quotaMB: number | null;
  usagePct: number | null;
}

export interface ResourceTelemetrySample {
  id: string;
  operation: string;
  label: string;
  kind: ResourceOperationKind;
  feature: string | null;
  startedAt: string;
  completedAt: string;
  durationMs: number;
  status: 'ok' | 'error';
  errorMessage: string | null;
  inputCount: number | null;
  outputCount: number | null;
  heapBeforeMB: number | null;
  heapAfterMB: number | null;
  heapDeltaMB: number | null;
  storageUsedMB: number | null;
  storageQuotaMB: number | null;
  meta: Record<string, ResourcePrimitive>;
}

export interface ResourceTelemetryAggregate {
  operation: string;
  label: string;
  kind: ResourceOperationKind;
  feature: string | null;
  sampleCount: number;
  errorCount: number;
  totalDurationMs: number;
  avgDurationMs: number;
  peakDurationMs: number;
  avgHeapDeltaMB: number;
  peakHeapDeltaMB: number;
  totalInputCount: number;
  totalOutputCount: number;
  lastSeenAt: string;
  intensityScore: number;
}

export interface ResourceTelemetrySnapshot {
  generatedAt: string;
  samples: ResourceTelemetrySample[];
  aggregates: ResourceTelemetryAggregate[];
  storage: ResourceStorageSnapshot | null;
  desktop: ResourceDesktopSnapshot | null;
  analyses: string[];
}

export interface ResourceSpanMeta {
  label?: string;
  kind?: ResourceOperationKind;
  feature?: string;
  inputCount?: number | null;
  outputCount?: number | null;
  sampleStorage?: boolean;
  meta?: Record<string, ResourcePrimitive>;
}

export interface ResourceSpanResultMeta extends ResourceSpanMeta {
  status?: 'ok' | 'error';
  errorMessage?: string | null;
}

interface RuntimeMemorySample {
  heapUsedMB: number | null;
  heapTotalMB: number | null;
}

type ResourceTelemetryListener = (snapshot: ResourceTelemetrySnapshot) => void;

const MAX_SAMPLES = 320;
const ENV_REFRESH_MS = 15_000;

let samples: ResourceTelemetrySample[] = [];
let storageSnapshot: ResourceStorageSnapshot | null = null;
let desktopSnapshot: ResourceDesktopSnapshot | null = null;
let lastEnvironmentRefresh = 0;
const listeners = new Set<ResourceTelemetryListener>();

function nowIso(): string {
  return new Date().toISOString();
}

function round(value: number | null | undefined, digits = 2): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function toMB(bytes: number | null | undefined): number | null {
  if (typeof bytes !== 'number' || !Number.isFinite(bytes)) return null;
  return round(bytes / (1024 * 1024));
}

function runtimeMemorySample(): RuntimeMemorySample {
  const perf = globalThis.performance as (Performance & {
    memory?: {
      usedJSHeapSize: number;
      totalJSHeapSize: number;
      jsHeapSizeLimit: number;
    };
  }) | undefined;
  if (perf?.memory) {
    return {
      heapUsedMB: toMB(perf.memory.usedJSHeapSize),
      heapTotalMB: toMB(perf.memory.totalJSHeapSize),
    };
  }

  const runtimeProcess = (globalThis as typeof globalThis & {
    process?: {
      memoryUsage?: () => {
        heapUsed: number;
        heapTotal: number;
      };
    };
  }).process;

  if (runtimeProcess?.memoryUsage) {
    const usage = runtimeProcess.memoryUsage();
    return {
      heapUsedMB: toMB(usage.heapUsed),
      heapTotalMB: toMB(usage.heapTotal),
    };
  }

  return {
    heapUsedMB: null,
    heapTotalMB: null,
  };
}

function inferCounts(value: unknown): { outputCount: number | null } {
  if (Array.isArray(value)) {
    return { outputCount: value.length };
  }
  if (value && typeof value === 'object') {
    const candidate = value as Record<string, unknown>;
    for (const key of ['count', 'itemCount', 'frameCount', 'runCount']) {
      const raw = candidate[key];
      if (typeof raw === 'number' && Number.isFinite(raw)) {
        return { outputCount: raw };
      }
    }
    for (const key of ['items', 'rows', 'records', 'datasets', 'runs', 'ideaRuns', 'forwardReturns']) {
      const raw = candidate[key];
      if (Array.isArray(raw)) {
        return { outputCount: raw.length };
      }
    }
  }
  return { outputCount: null };
}

function intensityScore(sampleCount: number, avgDurationMs: number, peakDurationMs: number, peakHeapDeltaMB: number, errorCount: number): number {
  const durationComponent = Math.min(45, avgDurationMs / 18);
  const peakComponent = Math.min(30, peakDurationMs / 40);
  const heapComponent = Math.min(20, Math.max(0, peakHeapDeltaMB) * 3.5);
  const errorComponent = Math.min(15, errorCount * 4);
  const confidenceBoost = Math.min(8, sampleCount * 0.6);
  return Math.round(Math.max(0, Math.min(100, durationComponent + peakComponent + heapComponent + errorComponent + confidenceBoost)));
}

function buildAggregates(rows: ResourceTelemetrySample[]): ResourceTelemetryAggregate[] {
  const buckets = new Map<string, ResourceTelemetrySample[]>();
  for (const row of rows) {
    const bucket = buckets.get(row.operation) || [];
    bucket.push(row);
    buckets.set(row.operation, bucket);
  }

  return Array.from(buckets.entries()).map(([operation, bucket]) => {
    const first = bucket[0];
    const totalDurationMs = bucket.reduce((sum, row) => sum + row.durationMs, 0);
    const avgDurationMs = totalDurationMs / Math.max(1, bucket.length);
    const peakDurationMs = Math.max(...bucket.map((row) => row.durationMs));
    const heapDeltas = bucket.map((row) => row.heapDeltaMB ?? 0);
    const avgHeapDeltaMB = heapDeltas.reduce((sum, row) => sum + row, 0) / Math.max(1, bucket.length);
    const peakHeapDeltaMB = Math.max(0, ...heapDeltas);
    const errorCount = bucket.filter((row) => row.status === 'error').length;
    const totalInputCount = bucket.reduce((sum, row) => sum + Math.max(0, row.inputCount ?? 0), 0);
    const totalOutputCount = bucket.reduce((sum, row) => sum + Math.max(0, row.outputCount ?? 0), 0);
    const lastSeenAt = bucket.reduce((latest, row) => row.completedAt > latest ? row.completedAt : latest, bucket[0]?.completedAt || nowIso());
    return {
      operation,
      label: first?.label || operation,
      kind: first?.kind || 'analytics',
      feature: first?.feature || null,
      sampleCount: bucket.length,
      errorCount,
      totalDurationMs: round(totalDurationMs, 2) ?? 0,
      avgDurationMs: round(avgDurationMs, 2) ?? 0,
      peakDurationMs: round(peakDurationMs, 2) ?? 0,
      avgHeapDeltaMB: round(avgHeapDeltaMB, 2) ?? 0,
      peakHeapDeltaMB: round(peakHeapDeltaMB, 2) ?? 0,
      totalInputCount,
      totalOutputCount,
      lastSeenAt,
      intensityScore: intensityScore(bucket.length, avgDurationMs, peakDurationMs, peakHeapDeltaMB, errorCount),
    };
  }).sort((a, b) => {
    if (b.intensityScore !== a.intensityScore) return b.intensityScore - a.intensityScore;
    return b.avgDurationMs - a.avgDurationMs;
  });
}

function buildAnalyses(aggregates: ResourceTelemetryAggregate[], storage: ResourceStorageSnapshot | null, desktop: ResourceDesktopSnapshot | null): string[] {
  const lines: string[] = [];
  const hottest = aggregates[0];
  const collector = aggregates.find((row) => row.kind === 'collection');
  const analyzer = aggregates.find((row) => row.kind === 'analytics' || row.kind === 'risk' || row.kind === 'graph');
  const memoryHot = aggregates
    .filter((row) => row.peakHeapDeltaMB > 0.1)
    .sort((a, b) => b.peakHeapDeltaMB - a.peakHeapDeltaMB)[0];

  if (hottest) {
    lines.push(`Highest overall resource load: ${hottest.label} (intensity ${hottest.intensityScore}, avg ${hottest.avgDurationMs.toFixed(0)}ms).`);
  }
  if (collector) {
    lines.push(`Collection hotspot: ${collector.label} with ${collector.totalOutputCount || collector.sampleCount} outputs across ${collector.sampleCount} runs.`);
  }
  if (analyzer) {
    lines.push(`Analysis hotspot: ${analyzer.label} averaging ${analyzer.avgDurationMs.toFixed(0)}ms per execution.`);
  }
  if (memoryHot) {
    lines.push(`Peak memory delta observed in ${memoryHot.label} at ${memoryHot.peakHeapDeltaMB.toFixed(2)} MB.`);
  }
  if (storage?.usagePct !== null && storage?.usagePct !== undefined) {
    lines.push(`Browser storage pressure is ${storage.usagePct.toFixed(1)}% of quota${storage.quotaMB ? ` (${storage.usedMB?.toFixed(1) || '0'} / ${storage.quotaMB.toFixed(1)} MB)` : ''}.`);
  }
  if (desktop?.rssMB) {
    lines.push(`Desktop sidecar RSS is ${desktop.rssMB.toFixed(1)} MB${desktop.archiveDbMB ? ` with archive DB at ${desktop.archiveDbMB.toFixed(1)} MB` : ''}.`);
  }

  return lines.slice(0, 5);
}

function snapshot(): ResourceTelemetrySnapshot {
  const aggregates = buildAggregates(samples);
  return {
    generatedAt: nowIso(),
    samples: samples.slice(),
    aggregates,
    storage: storageSnapshot,
    desktop: desktopSnapshot,
    analyses: buildAnalyses(aggregates, storageSnapshot, desktopSnapshot),
  };
}

function emit(): void {
  const current = snapshot();
  for (const listener of listeners) {
    listener(current);
  }
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('wm:resource-telemetry', { detail: current }));
  }
}

async function fetchStorageSnapshot(): Promise<ResourceStorageSnapshot | null> {
  if (typeof navigator === 'undefined' || !navigator.storage?.estimate) {
    return storageSnapshot;
  }
  try {
    const estimate = await navigator.storage.estimate();
    const usedMB = toMB(estimate.usage ?? 0);
    const quotaMB = toMB(estimate.quota ?? 0);
    const usagePct = usedMB !== null && quotaMB ? round((usedMB / quotaMB) * 100, 1) : null;
    return {
      timestamp: nowIso(),
      usedMB,
      quotaMB,
      usagePct,
    };
  } catch {
    return storageSnapshot;
  }
}

async function fetchDesktopSnapshot(): Promise<ResourceDesktopSnapshot | null> {
  if (typeof window === 'undefined' || typeof fetch !== 'function') {
    return desktopSnapshot;
  }
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timeout = controller ? setTimeout(() => controller.abort(), 2_500) : null;
  try {
    const response = await fetch('/api/local-resource-stats', {
      signal: controller?.signal,
      headers: { accept: 'application/json' },
    });
    if (!response.ok) return desktopSnapshot;
    const payload = await response.json() as {
      success?: boolean;
      stats?: ResourceDesktopSnapshot;
    };
    return payload?.success && payload.stats ? payload.stats : desktopSnapshot;
  } catch {
    return desktopSnapshot;
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

export async function refreshResourceEnvironment(force = false): Promise<ResourceTelemetrySnapshot> {
  const now = Date.now();
  if (!force && now - lastEnvironmentRefresh < ENV_REFRESH_MS) {
    return snapshot();
  }
  lastEnvironmentRefresh = now;
  const [storage, desktop] = await Promise.all([
    fetchStorageSnapshot(),
    fetchDesktopSnapshot(),
  ]);
  storageSnapshot = storage;
  desktopSnapshot = desktop;
  emit();
  return snapshot();
}

export function getResourceTelemetrySnapshot(): ResourceTelemetrySnapshot {
  return snapshot();
}

export function subscribeResourceTelemetry(listener: ResourceTelemetryListener): () => void {
  listeners.add(listener);
  listener(snapshot());
  return () => {
    listeners.delete(listener);
  };
}

export function startResourceSpan(operation: string, meta: ResourceSpanMeta = {}): {
  end: (resultMeta?: ResourceSpanResultMeta) => void;
} {
  const startedAt = nowIso();
  const startedPerf = typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();
  const memoryBefore = runtimeMemorySample();
  let closed = false;

  return {
    end: (resultMeta: ResourceSpanResultMeta = {}) => {
      if (closed) return;
      closed = true;
      const completedPerf = typeof performance !== 'undefined' && typeof performance.now === 'function'
        ? performance.now()
        : Date.now();
      const memoryAfter = runtimeMemorySample();
      const combinedMeta = {
        ...(meta.meta || {}),
        ...(resultMeta.meta || {}),
      };
      const sample: ResourceTelemetrySample = {
        id: globalThis.crypto?.randomUUID?.() || `${operation}:${Date.now()}:${Math.random().toString(16).slice(2)}`,
        operation,
        label: resultMeta.label || meta.label || operation,
        kind: resultMeta.kind || meta.kind || 'analytics',
        feature: resultMeta.feature || meta.feature || null,
        startedAt,
        completedAt: nowIso(),
        durationMs: round(completedPerf - startedPerf, 2) ?? 0,
        status: resultMeta.status || 'ok',
        errorMessage: resultMeta.errorMessage || null,
        inputCount: resultMeta.inputCount ?? meta.inputCount ?? null,
        outputCount: resultMeta.outputCount ?? meta.outputCount ?? null,
        heapBeforeMB: memoryBefore.heapUsedMB,
        heapAfterMB: memoryAfter.heapUsedMB,
        heapDeltaMB: round(
          memoryBefore.heapUsedMB !== null && memoryAfter.heapUsedMB !== null
            ? memoryAfter.heapUsedMB - memoryBefore.heapUsedMB
            : null,
          3,
        ),
        storageUsedMB: storageSnapshot?.usedMB ?? null,
        storageQuotaMB: storageSnapshot?.quotaMB ?? null,
        meta: combinedMeta,
      };

      samples.unshift(sample);
      if (samples.length > MAX_SAMPLES) {
        samples = samples.slice(0, MAX_SAMPLES);
      }
      emit();
      if (meta.sampleStorage || resultMeta.sampleStorage || Date.now() - lastEnvironmentRefresh > ENV_REFRESH_MS) {
        void refreshResourceEnvironment(false);
      }
    },
  };
}

export async function measureResourceOperation<T>(
  operation: string,
  meta: ResourceSpanMeta,
  fn: () => Promise<T>,
  derive?: (value: T) => Partial<ResourceSpanResultMeta>,
): Promise<T> {
  const span = startResourceSpan(operation, meta);
  try {
    const value = await fn();
    const inferred = inferCounts(value);
    span.end({
      ...inferred,
      ...(derive ? derive(value) : {}),
      status: 'ok',
    });
    return value;
  } catch (error) {
    span.end({
      status: 'error',
      errorMessage: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}
