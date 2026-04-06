/**
 * IntelligenceDatasetRegistryEntry management extracted from intelligence-automation.ts.
 * Handles registry / state loading, saving, normalization, and related helpers.
 */

import path from 'node:path';
import { createHash } from 'node:crypto';
import { mkdir, open, readFile, readdir, rm, stat, unlink, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import type { HistoricalBackfillOptions, HistoricalFrameLoadOptions } from '../importer/historical-stream-worker';
import type { HistoricalReplayOptions, WalkForwardBacktestOptions } from '../historical-intelligence';
import type { ThemeDiscoveryQueueItem } from '../theme-discovery';
import type { DatasetProposal, DatasetDiscoveryPolicy } from '../dataset-discovery';
import { normalizeDatasetDiscoveryPolicy } from '../dataset-discovery';
import type { ExperimentRegistrySnapshot } from '../experiment-registry';
import { getExperimentRegistrySnapshot, hydrateExperimentRegistry } from '../experiment-registry';
import { normalizeSourceAutomationPolicy, type SourceAutomationPolicy } from './source-automation';
import { nowIso, asTs, clampUtil as clamp, slugify } from './retry-utilities';
import type { AutomationRunRecord } from './retry-utilities';

// ── Types ──

type HistoricalProvider = 'fred' | 'alfred' | 'gdelt-doc' | 'coingecko' | 'acled' | 'yahoo-chart' | 'rss-feed';
type ThemeAutomationMode = 'manual' | 'guarded-auto' | 'full-auto';
type GapSeverity = 'watch' | 'elevated' | 'critical';

export type { HistoricalProvider, ThemeAutomationMode, GapSeverity };

export interface IntelligenceDatasetRegistryEntry {
  id: string;
  label: string;
  enabled: boolean;
  provider: HistoricalProvider;
  fetchArgs: Record<string, string | number | boolean>;
  importOptions?: Partial<HistoricalBackfillOptions>;
  replayOptions?: Partial<HistoricalReplayOptions>;
  walkForwardOptions?: Partial<WalkForwardBacktestOptions>;
  frameLoadOptions?: Partial<HistoricalFrameLoadOptions>;
  schedule?: {
    fetchEveryMinutes?: number;
    replayEveryMinutes?: number;
    walkForwardLocalHour?: number;
    themeDiscoveryEveryMinutes?: number;
  };
}

export interface ThemeAutomationPolicy {
  mode: ThemeAutomationMode;
  minDiscoveryScore: number;
  minSampleCount: number;
  minSourceCount: number;
  minCodexConfidence: number;
  minAssetCount: number;
  minPromotionScore: number;
  maxOverlapWithKnownThemes: number;
  maxPromotionsPerDay: number;
}

export interface CandidateAutomationPolicy {
  enabled: boolean;
  everyMinutes: number;
  maxThemesPerCycle: number;
  minGapSeverity: GapSeverity;
  minCoverageScore: number;
  themeCooldownHours: number;
  maxThemesPerRegionPerCycle: number;
}

export interface DatasetAutomationPolicy extends DatasetDiscoveryPolicy {
  enabled: boolean;
  everyMinutes: number;
  codexTopThemesPerCycle: number;
}

export interface ExperimentAutomationPolicy {
  enabled: boolean;
  everyMinutes: number;
}

export interface IntelligenceAutomationRegistry {
  version: number;
  defaults: {
    dbPath: string;
    artifactDir: string;
    bucketHours: number;
    warmupFrameCount: number;
    replayWindowDays: number;
    walkForwardWindowDays: number;
    horizonsHours: number[];
    fetchEveryMinutes: number;
    replayEveryMinutes: number;
    walkForwardLocalHour: number;
    themeDiscoveryEveryMinutes: number;
    keywordLifecycleEveryMinutes: number;
    maxRetries: number;
    retentionDays: number;
    artifactRetentionCount: number;
    lockTtlMinutes: number;
    rollingImportWindowHours?: Record<string, number>;
  };
  themeAutomation: ThemeAutomationPolicy;
  sourceAutomation: SourceAutomationPolicy;
  candidateAutomation: CandidateAutomationPolicy;
  datasetAutomation: DatasetAutomationPolicy;
  experimentAutomation: ExperimentAutomationPolicy;
  datasets: IntelligenceDatasetRegistryEntry[];
}

interface DatasetAutomationState {
  lastFetchAt?: string | null;
  lastImportAt?: string | null;
  lastReplayAt?: string | null;
  lastWalkForwardAt?: string | null;
  lastThemeDiscoveryAt?: string | null;
  nextEligibleAt?: string | null;
  consecutiveFailures: number;
  lastError?: string | null;
  artifacts: string[];
}

export type { DatasetAutomationState };

interface PromotedThemeState {
  id: string;
  sourceTopicKey: string;
  promotedAt: string;
  confidence: number;
  autoPromoted: boolean;
  theme: import('../investment-intelligence').InvestmentThemeDefinition;
}

export type { PromotedThemeState };

interface AutomationCycleMonitor {
  id: string | null;
  status: 'idle' | 'running' | 'error';
  startedAt: string | null;
  heartbeatAt: string | null;
  completedAt: string | null;
  stage: string | null;
  datasetId: string | null;
  totalDatasets: number;
  completedDatasets: number;
  touchedDatasets: string[];
  lastError: string | null;
  progressPct: number;
}

export type { AutomationCycleMonitor };

export interface IntelligenceAutomationState {
  version: number;
  updatedAt: string;
  lastCandidateExpansionAt?: string | null;
  lastKeywordLifecycleAt?: string | null;
  lastDatasetDiscoveryAt?: string | null;
  lastSelfTuningAt?: string | null;
  candidateThemeHistory?: Record<string, string>;
  datasets: Record<string, DatasetAutomationState>;
  runs: AutomationRunRecord[];
  themeQueue: ThemeDiscoveryQueueItem[];
  promotedThemes: PromotedThemeState[];
  datasetProposals: DatasetProposal[];
  experimentRegistry: ExperimentRegistrySnapshot | null;
  activeCycle: AutomationCycleMonitor | null;
}

// ── Constants ──

export const DEFAULT_REGISTRY_PATH = path.resolve('config', 'intelligence-datasets.json');
export const DEFAULT_STATE_PATH = path.resolve('data', 'automation', 'intelligence-scheduler-state.json');
export const DEFAULT_LOCK_DIR = path.resolve('data', 'automation', 'locks');
const MAX_RUN_RECORDS = 480;

// ── Utility helpers ──

export function incrementBucket(map: Map<string, number>, key: string): void {
  const normalized = String(key || '').trim();
  if (!normalized) return;
  map.set(normalized, (map.get(normalized) || 0) + 1);
}

export function getRollingImportWindow(provider: string, registry?: any): number {
  const registryValue = registry?.defaults?.rollingImportWindowHours?.[provider];
  if (typeof registryValue === 'number' && registryValue > 0) return registryValue;
  const defaults: Record<string, number> = { 'gdelt-doc': 12, acled: 12, 'rss-feed': 10 };
  return defaults[provider] ?? 12;
}

export function sortArtifactPathsChronologically(artifactPaths: string[]): string[] {
  return artifactPaths
    .map((artifactPath, index) => ({
      artifactPath,
      index,
      stamp: path.basename(String(artifactPath || '')),
    }))
    .sort((left, right) => {
      if (left.stamp === right.stamp) return left.index - right.index;
      return left.stamp.localeCompare(right.stamp);
    })
    .map((entry) => entry.artifactPath);
}

export function buildHistoricalArtifactPayload(provider: string, envelope: unknown): { provider: string; envelope: unknown } {
  return {
    provider: String(provider || '').trim().toLowerCase(),
    envelope,
  };
}

export function computeHistoricalArtifactDigest(provider: string, envelope: unknown): string {
  return createHash('sha256')
    .update(JSON.stringify(buildHistoricalArtifactPayload(provider, envelope)))
    .digest('hex');
}

export async function readHistoricalArtifactDigest(artifactPath: string): Promise<string | null> {
  try {
    const raw = await readFile(artifactPath, 'utf8');
    const parsed = JSON.parse(raw);
    return computeHistoricalArtifactDigest(String(parsed?.provider || ''), parsed?.envelope ?? null);
  } catch {
    return null;
  }
}

// ── Active cycle monitor ──

export function normalizeActiveCycle(raw?: Partial<AutomationCycleMonitor> | null): AutomationCycleMonitor {
  return {
    id: raw?.id ? String(raw.id) : null,
    status: raw?.status === 'running' || raw?.status === 'error' ? raw.status : 'idle',
    startedAt: raw?.startedAt ? String(raw.startedAt) : null,
    heartbeatAt: raw?.heartbeatAt ? String(raw.heartbeatAt) : null,
    completedAt: raw?.completedAt ? String(raw.completedAt) : null,
    stage: raw?.stage ? String(raw.stage) : null,
    datasetId: raw?.datasetId ? String(raw.datasetId) : null,
    totalDatasets: Math.max(0, Number(raw?.totalDatasets) || 0),
    completedDatasets: Math.max(0, Number(raw?.completedDatasets) || 0),
    touchedDatasets: Array.isArray(raw?.touchedDatasets) ? raw!.touchedDatasets!.map((value) => String(value)) : [],
    lastError: raw?.lastError ? String(raw.lastError) : null,
    progressPct: clamp(Number(raw?.progressPct) || 0, 0, 100),
  };
}

export function updateActiveCycle(
  state: IntelligenceAutomationState,
  patch: Partial<AutomationCycleMonitor>,
): AutomationCycleMonitor {
  const base = normalizeActiveCycle(state.activeCycle);
  const next = normalizeActiveCycle({
    ...base,
    ...patch,
    heartbeatAt: nowIso(),
  });
  const totalDatasets = Math.max(0, next.totalDatasets);
  const completedDatasets = clamp(next.completedDatasets, 0, totalDatasets || Math.max(1, next.completedDatasets));
  next.totalDatasets = totalDatasets;
  next.completedDatasets = completedDatasets;
  if (!('progressPct' in patch)) {
    next.progressPct = totalDatasets > 0
      ? clamp(Math.round((completedDatasets / totalDatasets) * 100), 0, 100)
      : next.status === 'running' ? 0 : 100;
  }
  state.activeCycle = next;
  return next;
}

// ── JSON file I/O ──

export async function readJsonFile<T>(filePath: string): Promise<T | null> {
  try {
    const raw = await readFile(filePath, 'utf8');
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export async function writeJsonFile(filePath: string, payload: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(payload, null, 2), 'utf8');
}

// ── Registry / state defaults ──

export function createDefaultRegistry(): IntelligenceAutomationRegistry {
  return {
    version: 1,
    defaults: {
      dbPath: path.resolve('data', 'historical', 'intelligence-history.duckdb'),
      artifactDir: path.resolve('data', 'historical', 'automation'),
      bucketHours: 6,
      warmupFrameCount: 60,
      replayWindowDays: 60,
      walkForwardWindowDays: 180,
      horizonsHours: [1, 4, 24, 72, 168],
      fetchEveryMinutes: 60,
      replayEveryMinutes: 60,
      walkForwardLocalHour: 2,
      themeDiscoveryEveryMinutes: 180,
      keywordLifecycleEveryMinutes: 360,
      maxRetries: 3,
      retentionDays: 30,
      artifactRetentionCount: 24,
      lockTtlMinutes: 180,
    },
    themeAutomation: {
      mode: 'guarded-auto',
      minDiscoveryScore: 40,
      minSampleCount: 4,
      minSourceCount: 2,
      minCodexConfidence: 58,
      minAssetCount: 2,
      minPromotionScore: 55,
      maxOverlapWithKnownThemes: 0.62,
      maxPromotionsPerDay: 1,
    },
    sourceAutomation: normalizeSourceAutomationPolicy(),
    candidateAutomation: {
      enabled: true,
      everyMinutes: 180,
      maxThemesPerCycle: 2,
      minGapSeverity: 'elevated',
      minCoverageScore: 60,
      themeCooldownHours: 12,
      maxThemesPerRegionPerCycle: 1,
    },
    datasetAutomation: {
      enabled: true,
      everyMinutes: 360,
      codexTopThemesPerCycle: 5,
      ...normalizeDatasetDiscoveryPolicy({
        mode: 'guarded-auto',
        minProposalScore: 60,
        autoRegisterScore: 74,
        autoEnableScore: 88,
        maxRegistrationsPerCycle: 2,
        maxEnabledDatasets: 12,
      }),
    },
    experimentAutomation: {
      enabled: true,
      everyMinutes: 180,
    },
    datasets: [],
  };
}

export function defaultState(): IntelligenceAutomationState {
  return {
    version: 1,
    updatedAt: nowIso(),
    lastCandidateExpansionAt: null,
    lastKeywordLifecycleAt: null,
    lastDatasetDiscoveryAt: null,
    lastSelfTuningAt: null,
    candidateThemeHistory: {},
    datasets: {},
    runs: [],
    themeQueue: [],
    promotedThemes: [],
    datasetProposals: [],
    experimentRegistry: getExperimentRegistrySnapshot(),
    activeCycle: {
      id: null,
      status: 'idle',
      startedAt: null,
      heartbeatAt: null,
      completedAt: null,
      stage: null,
      datasetId: null,
      totalDatasets: 0,
      completedDatasets: 0,
      touchedDatasets: [],
      lastError: null,
      progressPct: 0,
    },
  };
}

// ── Normalization ──

export function normalizeRegistry(raw?: Partial<IntelligenceAutomationRegistry> | null): IntelligenceAutomationRegistry {
  const fallback = createDefaultRegistry();
  return {
    version: 1,
    defaults: {
      ...fallback.defaults,
      ...(raw?.defaults || {}),
      horizonsHours: Array.isArray(raw?.defaults?.horizonsHours)
        ? raw!.defaults!.horizonsHours!.map((value) => Number(value)).filter((value) => Number.isFinite(value) && value > 0)
        : fallback.defaults.horizonsHours,
      keywordLifecycleEveryMinutes: Math.max(30, Number(raw?.defaults?.keywordLifecycleEveryMinutes) || fallback.defaults.keywordLifecycleEveryMinutes),
    },
    themeAutomation: {
      ...fallback.themeAutomation,
      ...(raw?.themeAutomation || {}),
      mode: raw?.themeAutomation?.mode === 'manual' || raw?.themeAutomation?.mode === 'guarded-auto' || raw?.themeAutomation?.mode === 'full-auto'
        ? raw.themeAutomation.mode
        : fallback.themeAutomation.mode,
      minPromotionScore: Math.max(40, Math.min(98, Number(raw?.themeAutomation?.minPromotionScore) || fallback.themeAutomation.minPromotionScore)),
      maxOverlapWithKnownThemes: Math.max(0.2, Math.min(0.95, Number(raw?.themeAutomation?.maxOverlapWithKnownThemes) || fallback.themeAutomation.maxOverlapWithKnownThemes)),
    },
    sourceAutomation: normalizeSourceAutomationPolicy(raw?.sourceAutomation),
    candidateAutomation: {
      enabled: typeof raw?.candidateAutomation?.enabled === 'boolean' ? raw.candidateAutomation.enabled : fallback.candidateAutomation.enabled,
      everyMinutes: Math.max(15, Number(raw?.candidateAutomation?.everyMinutes) || fallback.candidateAutomation.everyMinutes),
      maxThemesPerCycle: Math.max(1, Math.min(8, Number(raw?.candidateAutomation?.maxThemesPerCycle) || fallback.candidateAutomation.maxThemesPerCycle)),
      minGapSeverity: raw?.candidateAutomation?.minGapSeverity === 'watch' || raw?.candidateAutomation?.minGapSeverity === 'critical'
        ? raw.candidateAutomation.minGapSeverity
        : fallback.candidateAutomation.minGapSeverity,
      minCoverageScore: Math.max(20, Math.min(98, Number(raw?.candidateAutomation?.minCoverageScore) || fallback.candidateAutomation.minCoverageScore)),
      themeCooldownHours: Math.max(1, Math.min(168, Number(raw?.candidateAutomation?.themeCooldownHours) || fallback.candidateAutomation.themeCooldownHours)),
      maxThemesPerRegionPerCycle: Math.max(1, Math.min(4, Number(raw?.candidateAutomation?.maxThemesPerRegionPerCycle) || fallback.candidateAutomation.maxThemesPerRegionPerCycle)),
    },
    datasetAutomation: {
      enabled: typeof raw?.datasetAutomation?.enabled === 'boolean' ? raw.datasetAutomation.enabled : fallback.datasetAutomation.enabled,
      everyMinutes: Math.max(30, Number(raw?.datasetAutomation?.everyMinutes) || fallback.datasetAutomation.everyMinutes),
      codexTopThemesPerCycle: Math.max(0, Math.min(8, Number(raw?.datasetAutomation?.codexTopThemesPerCycle) || fallback.datasetAutomation.codexTopThemesPerCycle)),
      ...normalizeDatasetDiscoveryPolicy(raw?.datasetAutomation),
    },
    experimentAutomation: {
      enabled: typeof raw?.experimentAutomation?.enabled === 'boolean' ? raw.experimentAutomation.enabled : fallback.experimentAutomation.enabled,
      everyMinutes: Math.max(15, Number(raw?.experimentAutomation?.everyMinutes) || fallback.experimentAutomation.everyMinutes),
    },
    datasets: Array.isArray(raw?.datasets)
      ? raw!.datasets!.map((dataset) => ({
        id: String(dataset.id || '').trim(),
        label: String(dataset.label || dataset.id || '').trim() || String(dataset.id || '').trim(),
        enabled: Boolean(dataset.enabled),
        provider: String(dataset.provider || '').trim().toLowerCase() as HistoricalProvider,
        fetchArgs: dataset.fetchArgs || {},
        importOptions: dataset.importOptions || {},
        replayOptions: dataset.replayOptions || {},
        walkForwardOptions: dataset.walkForwardOptions || {},
        frameLoadOptions: dataset.frameLoadOptions || {},
        schedule: dataset.schedule || {},
      })).filter((dataset) => dataset.id && dataset.provider)
      : [],
  };
}

export function normalizeState(raw?: Partial<IntelligenceAutomationState> | null): IntelligenceAutomationState {
  const fallback = defaultState();
  return {
    version: 1,
    updatedAt: String(raw?.updatedAt || fallback.updatedAt),
    lastCandidateExpansionAt: raw?.lastCandidateExpansionAt || null,
    lastKeywordLifecycleAt: raw?.lastKeywordLifecycleAt || null,
    lastDatasetDiscoveryAt: raw?.lastDatasetDiscoveryAt || null,
    lastSelfTuningAt: raw?.lastSelfTuningAt || null,
    candidateThemeHistory: raw?.candidateThemeHistory && typeof raw.candidateThemeHistory === 'object'
      ? Object.fromEntries(Object.entries(raw.candidateThemeHistory).map(([key, value]) => [key, String(value || '')]))
      : {},
    datasets: Object.fromEntries(
      Object.entries(raw?.datasets || {}).map(([datasetId, state]) => [
        datasetId,
        {
          lastFetchAt: state?.lastFetchAt || null,
          lastImportAt: state?.lastImportAt || null,
          lastReplayAt: state?.lastReplayAt || null,
          lastWalkForwardAt: state?.lastWalkForwardAt || null,
          lastThemeDiscoveryAt: state?.lastThemeDiscoveryAt || null,
          nextEligibleAt: state?.nextEligibleAt || null,
          consecutiveFailures: Number(state?.consecutiveFailures) || 0,
          lastError: state?.lastError || null,
          artifacts: Array.isArray(state?.artifacts)
            ? sortArtifactPathsChronologically(state!.artifacts!.map((item) => String(item)))
            : [],
        } satisfies DatasetAutomationState,
      ]),
    ),
    runs: Array.isArray(raw?.runs) ? raw!.runs!.slice(-MAX_RUN_RECORDS) : [],
    themeQueue: Array.isArray(raw?.themeQueue) ? raw!.themeQueue! : [],
    promotedThemes: Array.isArray(raw?.promotedThemes) ? raw!.promotedThemes! : [],
    datasetProposals: Array.isArray(raw?.datasetProposals) ? raw!.datasetProposals! : [],
    experimentRegistry: raw?.experimentRegistry ? hydrateExperimentRegistry(raw.experimentRegistry) : getExperimentRegistrySnapshot(),
    activeCycle: normalizeActiveCycle(raw?.activeCycle || fallback.activeCycle),
  };
}

// ── Load / save ──

export async function loadAutomationRegistry(registryPath = DEFAULT_REGISTRY_PATH): Promise<IntelligenceAutomationRegistry> {
  const existing = await readJsonFile<IntelligenceAutomationRegistry>(registryPath);
  if (!existing) {
    const created = createDefaultRegistry();
    await writeJsonFile(registryPath, created);
    return created;
  }
  return normalizeRegistry(existing);
}

export async function saveAutomationRegistry(registry: IntelligenceAutomationRegistry, registryPath = DEFAULT_REGISTRY_PATH): Promise<void> {
  await writeJsonFile(registryPath, registry);
}

export async function loadAutomationState(statePath = DEFAULT_STATE_PATH): Promise<IntelligenceAutomationState> {
  const existing = await readJsonFile<IntelligenceAutomationState>(statePath);
  return normalizeState(existing);
}

export async function saveAutomationState(state: IntelligenceAutomationState, statePath = DEFAULT_STATE_PATH): Promise<void> {
  state.updatedAt = nowIso();
  await writeJsonFile(statePath, state);
}

export function trimAutomationStateForRetention(state: IntelligenceAutomationState, retentionDays: number): void {
  const cutoff = Date.now() - retentionDays * 86_400_000;
  state.runs = state.runs.filter((run) => asTs(run.completedAt) >= cutoff);
  state.themeQueue = state.themeQueue.filter((item) => item.status === 'open' || asTs(item.updatedAt) >= cutoff);
}

export async function flushAutomationState(
  state: IntelligenceAutomationState,
  statePath: string,
  retentionDays: number,
): Promise<void> {
  trimAutomationStateForRetention(state, retentionDays);
  await saveAutomationState(state, statePath);
}

// ── Lock management ──

function isPidLikelyAlive(pid: unknown): boolean | null {
  const numericPid = Number(pid);
  if (!Number.isInteger(numericPid) || numericPid <= 0) return null;
  try {
    process.kill(numericPid, 0);
    return true;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException | undefined)?.code;
    if (code === 'EPERM') return true;
    if (code === 'ESRCH') return false;
    return null;
  }
}

export async function acquireLock(key: string, ttlMinutes: number): Promise<(() => Promise<void>) | null> {
  await mkdir(DEFAULT_LOCK_DIR, { recursive: true });
  const filePath = path.join(DEFAULT_LOCK_DIR, `${slugify(key)}.lock.json`);
  const expiresAt = new Date(Date.now() + ttlMinutes * 60_000).toISOString();
  const payload = JSON.stringify({ key, pid: process.pid, acquiredAt: nowIso(), expiresAt }, null, 2);

  const tryCreate = async (): Promise<boolean> => {
    try {
      const handle = await open(filePath, 'wx');
      await handle.writeFile(payload, 'utf8');
      await handle.close();
      return true;
    } catch {
      return false;
    }
  };

  if (!(await tryCreate())) {
    const existing = await readJsonFile<{ expiresAt?: string; pid?: number }>(filePath);
    const expired = existing?.expiresAt && asTs(existing.expiresAt) < Date.now();
    const ownerAlive = isPidLikelyAlive(existing?.pid);
    if (expired || ownerAlive === false) {
      await rm(filePath, { force: true });
      if (!(await tryCreate())) return null;
    } else {
      return null;
    }
  }

  return async () => {
    await rm(filePath, { force: true });
  };
}

// ── Dataset state helpers ──

export function getDatasetState(state: IntelligenceAutomationState, datasetId: string): DatasetAutomationState {
  state.datasets[datasetId] = state.datasets[datasetId] || {
    consecutiveFailures: 0,
    artifacts: [],
  };
  return state.datasets[datasetId]!;
}

export function backoffMsForDataset(
  registry: IntelligenceAutomationRegistry,
  dataset: IntelligenceDatasetRegistryEntry,
  consecutiveFailures: number,
  errorMessage: string,
): number {
  const { backoffMs } = require('./retry-utilities') as typeof import('./retry-utilities');
  const defaultBackoff = backoffMs(consecutiveFailures);
  const provider = String(dataset.provider || '').toLowerCase();
  if (provider === 'gdelt-doc' && /429|too many requests/i.test(errorMessage)) {
    const fetchEveryMinutes = Number(dataset.schedule?.fetchEveryMinutes) || registry.defaults.fetchEveryMinutes;
    const gentleRetryMs = Math.max(15 * 60 * 1000, Math.min(90 * 60 * 1000, Math.round(fetchEveryMinutes * 60_000 * 0.5)));
    return Math.max(defaultBackoff, gentleRetryMs);
  }
  return defaultBackoff;
}

// ── Artifact helpers ──

export async function pruneArtifacts(artifactDir: string, keepCount: number, retentionDays: number): Promise<string[]> {
  if (!existsSync(artifactDir)) return [];
  const entries = await readdir(artifactDir, { withFileTypes: true });
  const files = await Promise.all(entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
    .map(async (entry) => {
      const filePath = path.join(artifactDir, entry.name);
      const stats = await stat(filePath);
      return { filePath, mtimeMs: stats.mtimeMs, digest: await readHistoricalArtifactDigest(filePath) };
    }));
  files.sort((a, b) => b.mtimeMs - a.mtimeMs);
  const expiryMs = Date.now() - retentionDays * 86_400_000;
  const seenDigests = new Set<string>();
  const deduped = files.filter((file) => {
    if (!file.digest) return true;
    if (seenDigests.has(file.digest)) return false;
    seenDigests.add(file.digest);
    return true;
  });
  const retainedAfterPolicy = deduped.filter((file, index) => index < keepCount && file.mtimeMs >= expiryMs);
  const retainedPaths = new Set(retainedAfterPolicy.map((file) => file.filePath));
  const doomed = files.filter((file) => !retainedPaths.has(file.filePath));
  for (const file of doomed) {
    await unlink(file.filePath).catch(() => {});
  }
  return retainedAfterPolicy
    .sort((left, right) => left.mtimeMs - right.mtimeMs)
    .map((file) => file.filePath);
}

export async function markActiveCycleFailed(args: {
  state: IntelligenceAutomationState;
  statePath: string;
  retentionDays: number;
  error: unknown;
  completedDatasets?: number;
  touchedDatasets?: string[];
}): Promise<void> {
  const current = normalizeActiveCycle(args.state.activeCycle);
  const message = args.error instanceof Error ? args.error.message : String(args.error || 'automation cycle failed');
  const failedStage = current.stage
    ? (String(current.stage).startsWith('failed:') ? current.stage : `failed:${current.stage}`)
    : 'failed';
  updateActiveCycle(args.state, {
    status: 'error',
    completedAt: nowIso(),
    stage: failedStage,
    datasetId: current.datasetId,
    completedDatasets: typeof args.completedDatasets === 'number' ? args.completedDatasets : current.completedDatasets,
    touchedDatasets: Array.isArray(args.touchedDatasets) ? args.touchedDatasets : current.touchedDatasets,
    lastError: message,
  });
  try {
    await flushAutomationState(args.state, args.statePath, args.retentionDays);
  } catch {
    // Best effort only.
  }
}
