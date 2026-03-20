import path from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { mkdir, open, readFile, readdir, rm, stat, unlink, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import type { HistoricalBackfillOptions, HistoricalFrameLoadOptions } from '../importer/historical-stream-worker';
import { listHistoricalDatasets, loadHistoricalReplayFramesFromDuckDb, processHistoricalDump } from '../importer/historical-stream-worker';
import type { HistoricalReplayFrame, HistoricalReplayOptions, HistoricalReplayRun, WalkForwardBacktestOptions } from '../historical-intelligence';
import { listHistoricalReplayRuns, runHistoricalReplay, runWalkForwardBacktest } from '../historical-intelligence';
import {
  listBaseInvestmentThemes,
  getInvestmentIntelligenceSnapshot,
  getInvestmentThemeDefinition,
  ingestCodexCandidateExpansionProposals,
  setAutomatedThemeCatalog,
  type InvestmentThemeDefinition,
} from '../investment-intelligence';
import {
  discoverThemeQueue,
  type CodexThemeProposal,
  type ThemeDiscoveryQueueItem,
} from '../theme-discovery';
import {
  type DatasetProposal,
  type DatasetDiscoveryPolicy,
  type DatasetDiscoveryThemeInput,
  autoRegisterDatasetProposals,
  normalizeDatasetDiscoveryPolicy,
  proposeDatasetsForThemes,
} from '../dataset-discovery';
import {
  type ExperimentRegistrySnapshot,
  getExperimentRegistrySnapshot,
  hydrateExperimentRegistry,
  runSelfTuningCycle,
} from '../experiment-registry';
import {
  getCurrentThemePerformanceFromSnapshot,
  getReplayAdaptationSnapshot,
  getReplayThemeProfileFromSnapshot,
} from '../replay-adaptation';
import {
  extractKeywordCandidatesFromText,
  isLowSignalKeywordTerm,
  observeTemporalKeywordRelations,
  refreshKeywordCanonicalMappings,
  reviewKeywordRegistryLifecycle,
  upsertKeywordCandidates,
} from '../keyword-registry';
import { proposeCandidatesWithCodex } from './codex-candidate-proposer';
import { proposeDatasetsWithCodex } from './codex-dataset-proposer';
import { proposeThemeWithCodex } from './codex-theme-proposer';
import {
  normalizeSourceAutomationPolicy,
  runSourceAutomationSweep,
  type SourceAutomationPolicy,
} from './source-automation';
import {
  getCoveragePenaltyForTheme,
  inferCoverageFamilies,
  scoreCoverageGain,
} from '../coverage-ledger';

type HistoricalProvider = 'fred' | 'alfred' | 'gdelt-doc' | 'coingecko' | 'acled' | 'yahoo-chart' | 'rss-feed';
type AutomationJobKind = 'fetch' | 'import' | 'replay' | 'walk-forward' | 'theme-discovery' | 'theme-proposer' | 'candidate-expansion' | 'source-automation' | 'keyword-lifecycle' | 'dataset-discovery' | 'self-tuning' | 'retention';
type ThemeAutomationMode = 'manual' | 'guarded-auto' | 'full-auto';
type GapSeverity = 'watch' | 'elevated' | 'critical';

const ROLLING_ARTIFACT_IMPORT_WINDOW: Partial<Record<HistoricalProvider, number>> = {
  'gdelt-doc': 12,
  acled: 12,
  'rss-feed': 10,
};

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
  };
  themeAutomation: ThemeAutomationPolicy;
  sourceAutomation: SourceAutomationPolicy;
  candidateAutomation: CandidateAutomationPolicy;
  datasetAutomation: DatasetAutomationPolicy;
  experimentAutomation: ExperimentAutomationPolicy;
  datasets: IntelligenceDatasetRegistryEntry[];
}

export interface AutomationRunRecord {
  id: string;
  datasetId: string | null;
  kind: AutomationJobKind;
  status: 'ok' | 'error' | 'skipped';
  startedAt: string;
  completedAt: string;
  attempts: number;
  detail: string;
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

interface PromotedThemeState {
  id: string;
  sourceTopicKey: string;
  promotedAt: string;
  confidence: number;
  autoPromoted: boolean;
  theme: InvestmentThemeDefinition;
}

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

export interface IntelligenceAutomationCycleResult {
  startedAt: string;
  completedAt: string;
  datasetCount: number;
  touchedDatasets: string[];
  replayRuns: Array<{ datasetId: string; runId: string; mode: 'replay' | 'walk-forward'; ideaCount: number }>;
  replayRunDetails?: HistoricalReplayRun[];
  promotedThemes: string[];
  candidateThemes: string[];
  registeredDatasets: string[];
  tuningAction: 'idle' | 'observe' | 'promote' | 'rollback';
  sourceAutomation: Awaited<ReturnType<typeof runSourceAutomationSweep>>;
  queueOpenCount: number;
}

const DEFAULT_REGISTRY_PATH = path.resolve('config', 'intelligence-datasets.json');
const DEFAULT_STATE_PATH = path.resolve('data', 'automation', 'intelligence-scheduler-state.json');
const DEFAULT_LOCK_DIR = path.resolve('data', 'automation', 'locks');
const MAX_RUN_RECORDS = 480;

function nowIso(): string {
  return new Date().toISOString();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function average(values: number[]): number {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function median(values: number[]): number {
  if (!values.length) return 0;
  const ranked = values
    .filter((value) => Number.isFinite(value))
    .slice()
    .sort((left, right) => left - right);
  if (!ranked.length) return 0;
  const middle = Math.floor(ranked.length / 2);
  return ranked.length % 2 === 0
    ? (ranked[middle - 1]! + ranked[middle]!) / 2
    : ranked[middle]!;
}

function slugify(value: string): string {
  return String(value || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 100) || 'automation';
}

function asTs(value?: string | null): number {
  if (!value) return 0;
  const ts = Date.parse(value);
  return Number.isFinite(ts) ? ts : 0;
}

function incrementBucket(map: Map<string, number>, key: string): void {
  const normalized = String(key || '').trim();
  if (!normalized) return;
  map.set(normalized, (map.get(normalized) || 0) + 1);
}

function buildQueueDatasetPressure(queue: ThemeDiscoveryQueueItem[]): Map<string, number> {
  const pressure = new Map<string, number>();
  for (const item of queue) {
    for (const datasetId of item.datasetIds || []) incrementBucket(pressure, datasetId);
  }
  return pressure;
}

function buildPromotedThemeDatasetPressure(state: IntelligenceAutomationState): Map<string, number> {
  const queueByTopicKey = new Map(state.themeQueue.map((item) => [item.topicKey, item] as const));
  const pressure = new Map<string, number>();
  for (const promoted of state.promotedThemes) {
    for (const datasetId of queueByTopicKey.get(promoted.sourceTopicKey)?.datasetIds || []) {
      incrementBucket(pressure, datasetId);
    }
  }
  return pressure;
}

function computeDatasetConcentrationPenalty(datasetIds: string[], pressure: Map<string, number>, unitPenalty: number, maxPenalty: number): number {
  const unique = Array.from(new Set((datasetIds || []).map((value) => String(value || '').trim()).filter(Boolean)));
  if (!unique.length) return 0;
  const avgPressure = average(unique.map((datasetId) => pressure.get(datasetId) || 0));
  return clamp(Math.round(Math.max(0, avgPressure - 1) * unitPenalty), 0, maxPenalty);
}

function computeDatasetDiversityBonus(datasetIds: string[], supportingSources: string[], maxBonus: number): number {
  const datasetSpread = Array.from(new Set((datasetIds || []).map((value) => String(value || '').trim()).filter(Boolean))).length;
  const sourceSpread = Array.from(new Set((supportingSources || []).map((value) => String(value || '').trim()).filter(Boolean))).length;
  return clamp(Math.round(datasetSpread * 4 + Math.min(3, sourceSpread) * 2), 0, maxBonus);
}

function buildProviderPressure(datasets: IntelligenceDatasetRegistryEntry[]): Map<string, number> {
  const pressure = new Map<string, number>();
  for (const dataset of datasets) {
    if (!dataset.enabled) continue;
    incrementBucket(pressure, dataset.provider);
  }
  return pressure;
}

function providerConcentrationAdjustment(provider: string, registry: IntelligenceAutomationRegistry): { bonus: number; penalty: number } {
  const pressure = buildProviderPressure(registry.datasets);
  const current = pressure.get(String(provider || '').trim()) || 0;
  return {
    bonus: current === 0 ? 8 : current === 1 ? 4 : 0,
    penalty: clamp(Math.max(0, current - 1) * 6, 0, 18),
  };
}

function sameLocalDay(a?: string | null, b?: string | null): boolean {
  if (!a || !b) return false;
  const one = new Date(a);
  const two = new Date(b);
  return one.getFullYear() === two.getFullYear()
    && one.getMonth() === two.getMonth()
    && one.getDate() === two.getDate();
}

function pushKeywordRelationObservations(
  observations: Parameters<typeof observeTemporalKeywordRelations>[0],
  seen: Set<string>,
  terms: string[],
  evidence: string,
  observedAt: number,
  weight: number,
): void {
  const uniqueTerms = Array.from(new Set(
    terms
      .map((term) => String(term || '').trim().toLowerCase())
      .filter((term) => term.length >= 3),
  )).slice(0, 7);
  if (uniqueTerms.length < 2) return;
  for (let index = 0; index < uniqueTerms.length; index += 1) {
    for (let inner = index + 1; inner < uniqueTerms.length; inner += 1) {
      const left = uniqueTerms[index]!;
      const right = uniqueTerms[inner]!;
      const key = left < right ? `${left}::${right}` : `${right}::${left}`;
      if (seen.has(key)) continue;
      seen.add(key);
      observations.push({
        sourceTerm: left,
        targetTerm: right,
        relationType: 'cooccurrence',
        weight,
        evidence: evidence.slice(0, 320),
        observedAt,
      });
      if (observations.length >= 260) return;
    }
  }
}

async function seedKeywordRegistryFromFrames(frames: HistoricalReplayFrame[]): Promise<{
  candidateCount: number;
  relationCount: number;
}> {
  const candidates: Parameters<typeof upsertKeywordCandidates>[0] = [];
  const observations: Parameters<typeof observeTemporalKeywordRelations>[0] = [];
  const relationSeen = new Set<string>();
  const sampledFrames = buildRollingFrameSample(frames, {
    maxWindows: 3,
    windowSize: 36,
    minWindowSize: 18,
  });

  for (const frame of sampledFrames) {
    for (const news of frame.news.slice(0, 18)) {
      const text = `${news.title || ''} ${news.locationName || ''}`.trim();
      if (!text) continue;
      const extracted = extractKeywordCandidatesFromText(text, { lang: 'en', ingress: 'llm' }).slice(0, 6);
      for (const candidate of extracted) {
        candidates.push({
          ...candidate,
          aliases: [news.source, ...(candidate.aliases || [])].filter(Boolean),
          relatedTerms: [news.locationName || '', ...(candidate.relatedTerms || [])].filter(Boolean),
          sourceTier: 2,
          marketRelevance: news.isAlert ? 70 : 48,
          confidence: news.isAlert ? 72 : 58,
        });
      }
      pushKeywordRelationObservations(
        observations,
        relationSeen,
        [...extracted.map((candidate) => candidate.term), news.locationName || ''],
        `${news.source || 'news'}: ${news.title || text}`,
        asTs(news.pubDate instanceof Date ? news.pubDate.toISOString() : String(news.pubDate || frame.timestamp || '')) || Date.now(),
        news.isAlert ? 2 : 1,
      );
      if (candidates.length >= 420 || observations.length >= 260) break;
    }
    if (candidates.length >= 420 || observations.length >= 260) break;

    for (const cluster of frame.clusters.slice(0, 12)) {
      const evidence = `${cluster.primaryTitle || ''} ${(cluster.relations?.evidence || []).join(' ')}`.trim();
      if (!evidence) continue;
      const extracted = extractKeywordCandidatesFromText(evidence, { lang: 'en', ingress: 'llm' }).slice(0, 6);
      for (const candidate of extracted) {
        candidates.push({
          ...candidate,
          sourceTier: 2,
          marketRelevance: cluster.isAlert ? 78 : 55,
          confidence: cluster.isAlert ? 75 : 60,
          relatedTerms: [...(cluster.relations?.evidence || []).slice(0, 4), ...(candidate.relatedTerms || [])].filter(Boolean),
        });
      }
      pushKeywordRelationObservations(
        observations,
        relationSeen,
        extracted.map((candidate) => candidate.term),
        cluster.primaryTitle || evidence,
        asTs(cluster.firstSeen instanceof Date ? cluster.firstSeen.toISOString() : String(cluster.firstSeen || frame.timestamp || '')) || Date.now(),
        cluster.isAlert ? 2.2 : 1.1,
      );
      if (candidates.length >= 420 || observations.length >= 260) break;
    }
    if (candidates.length >= 420 || observations.length >= 260) break;

    for (const market of frame.markets.slice(0, 10)) {
      const symbol = String(market.symbol || '').trim().toUpperCase();
      if (!symbol) continue;
      candidates.push({
        term: `${symbol} volatility`,
        aliases: [symbol, market.name, market.display].filter(Boolean),
        ingress: 'market',
        domain: 'macro',
        sourceTier: 1,
        marketRelevance: 60,
        confidence: 62,
        weight: 1.1,
        relatedTerms: [`${symbol} price`, `${market.name || symbol} market`],
        lang: 'en',
      });
      if (candidates.length >= 420) break;
    }
    if (candidates.length >= 420) break;
  }

  if (candidates.length > 0) {
    await upsertKeywordCandidates(candidates.slice(0, 420));
  }
  if (observations.length > 0) {
    await observeTemporalKeywordRelations(observations.slice(0, 260));
  }
  return {
    candidateCount: Math.min(candidates.length, 420),
    relationCount: Math.min(observations.length, 260),
  };
}

function createDefaultRegistry(): IntelligenceAutomationRegistry {
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
      minDiscoveryScore: 58,
      minSampleCount: 4,
      minSourceCount: 2,
      minCodexConfidence: 78,
      minAssetCount: 2,
      minPromotionScore: 72,
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
      codexTopThemesPerCycle: 2,
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

function defaultState(): IntelligenceAutomationState {
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

function sortArtifactPathsChronologically(artifactPaths: string[]): string[] {
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

function buildHistoricalArtifactPayload(provider: string, envelope: unknown): { provider: string; envelope: unknown } {
  return {
    provider: String(provider || '').trim().toLowerCase(),
    envelope,
  };
}

function computeHistoricalArtifactDigest(provider: string, envelope: unknown): string {
  return createHash('sha256')
    .update(JSON.stringify(buildHistoricalArtifactPayload(provider, envelope)))
    .digest('hex');
}

async function readHistoricalArtifactDigest(artifactPath: string): Promise<string | null> {
  try {
    const raw = await readFile(artifactPath, 'utf8');
    const parsed = JSON.parse(raw);
    return computeHistoricalArtifactDigest(String(parsed?.provider || ''), parsed?.envelope ?? null);
  } catch {
    return null;
  }
}

function normalizeActiveCycle(raw?: Partial<AutomationCycleMonitor> | null): AutomationCycleMonitor {
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

function updateActiveCycle(
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

async function markActiveCycleFailed(args: {
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
    // Best effort only. The original failure should remain the primary signal.
  }
}

function normalizeRegistry(raw?: Partial<IntelligenceAutomationRegistry> | null): IntelligenceAutomationRegistry {
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
      codexTopThemesPerCycle: Math.max(0, Math.min(4, Number(raw?.datasetAutomation?.codexTopThemesPerCycle) || fallback.datasetAutomation.codexTopThemesPerCycle)),
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

function normalizeState(raw?: Partial<IntelligenceAutomationState> | null): IntelligenceAutomationState {
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

async function readJsonFile<T>(filePath: string): Promise<T | null> {
  try {
    const raw = await readFile(filePath, 'utf8');
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

async function writeJsonFile(filePath: string, payload: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(payload, null, 2), 'utf8');
}

export async function loadAutomationRegistry(registryPath = DEFAULT_REGISTRY_PATH): Promise<IntelligenceAutomationRegistry> {
  const existing = await readJsonFile<IntelligenceAutomationRegistry>(registryPath);
  if (!existing) {
    const created = createDefaultRegistry();
    await writeJsonFile(registryPath, created);
    return created;
  }
  return normalizeRegistry(existing);
}

async function saveAutomationRegistry(registry: IntelligenceAutomationRegistry, registryPath = DEFAULT_REGISTRY_PATH): Promise<void> {
  await writeJsonFile(registryPath, registry);
}

export async function loadAutomationState(statePath = DEFAULT_STATE_PATH): Promise<IntelligenceAutomationState> {
  const existing = await readJsonFile<IntelligenceAutomationState>(statePath);
  return normalizeState(existing);
}

async function saveAutomationState(state: IntelligenceAutomationState, statePath = DEFAULT_STATE_PATH): Promise<void> {
  state.updatedAt = nowIso();
  await writeJsonFile(statePath, state);
}

function trimAutomationStateForRetention(state: IntelligenceAutomationState, retentionDays: number): void {
  const cutoff = Date.now() - retentionDays * 86_400_000;
  state.runs = state.runs.filter((run) => asTs(run.completedAt) >= cutoff);
  state.themeQueue = state.themeQueue.filter((item) => item.status === 'open' || asTs(item.updatedAt) >= cutoff);
}

async function flushAutomationState(
  state: IntelligenceAutomationState,
  statePath: string,
  retentionDays: number,
): Promise<void> {
  trimAutomationStateForRetention(state, retentionDays);
  await saveAutomationState(state, statePath);
}

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

async function acquireLock(key: string, ttlMinutes: number): Promise<(() => Promise<void>) | null> {
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

function getDatasetState(state: IntelligenceAutomationState, datasetId: string): DatasetAutomationState {
  state.datasets[datasetId] = state.datasets[datasetId] || {
    consecutiveFailures: 0,
    artifacts: [],
  };
  return state.datasets[datasetId]!;
}

function shouldRunEvery(lastAt: string | null | undefined, everyMinutes: number, now = Date.now()): boolean {
  if (!lastAt) return true;
  return now - asTs(lastAt) >= everyMinutes * 60_000;
}

function shouldRunNightly(lastAt: string | null | undefined, localHour: number, now = new Date()): boolean {
  if (now.getHours() < localHour) return false;
  return !sameLocalDay(lastAt, now.toISOString());
}

function backoffMs(consecutiveFailures: number): number {
  const bounded = Math.max(1, Math.min(6, consecutiveFailures));
  return Math.min(6 * 60 * 60 * 1000, 5 * 60 * 1000 * (2 ** (bounded - 1)));
}

function backoffMsForDataset(
  registry: IntelligenceAutomationRegistry,
  dataset: IntelligenceDatasetRegistryEntry,
  consecutiveFailures: number,
  errorMessage: string,
): number {
  const defaultBackoff = backoffMs(consecutiveFailures);
  const provider = String(dataset.provider || '').toLowerCase();
  if (provider === 'gdelt-doc' && /429|too many requests/i.test(errorMessage)) {
    const fetchEveryMinutes = Number(dataset.schedule?.fetchEveryMinutes) || registry.defaults.fetchEveryMinutes;
    const gentleRetryMs = Math.max(5 * 60 * 1000, Math.min(30 * 60 * 1000, Math.round(fetchEveryMinutes * 60_000 * 0.5)));
    return Math.min(defaultBackoff, gentleRetryMs);
  }
  return defaultBackoff;
}

function appendRun(state: IntelligenceAutomationState, run: AutomationRunRecord): void {
  state.runs = [...state.runs, run].slice(-MAX_RUN_RECORDS);
}

function applyPromotedThemes(state: IntelligenceAutomationState): void {
  setAutomatedThemeCatalog(state.promotedThemes.map((entry) => entry.theme));
}

async function fetchHistoricalDatasetArtifact(
  registry: IntelligenceAutomationRegistry,
  dataset: IntelligenceDatasetRegistryEntry,
  recentArtifactPaths: string[] = [],
): Promise<{ artifactPath: string; reusedExisting: boolean; digest: string }> {
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-expect-error Node runtime import of a local scheduler helper script.
  const module = await import('../../../scripts/fetch-historical-data.mjs');
  const envelope = await module.fetchHistoricalEnvelope(dataset.provider, dataset.fetchArgs || {});
  const digest = computeHistoricalArtifactDigest(dataset.provider, envelope);
  const recentCandidates = sortArtifactPathsChronologically(recentArtifactPaths).slice(-6).reverse();
  for (const candidate of recentCandidates) {
    const candidateDigest = await readHistoricalArtifactDigest(candidate);
    if (candidateDigest === digest) {
      return {
        artifactPath: candidate,
        reusedExisting: true,
        digest,
      };
    }
  }
  const artifactDir = path.resolve(registry.defaults.artifactDir, dataset.id);
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const outputPath = path.join(artifactDir, `${timestamp}.json`);
  const artifactPath = await module.writeHistoricalEnvelope(outputPath, dataset.provider, envelope);
  return {
    artifactPath,
    reusedExisting: false,
    digest,
  };
}

async function fetchHistoricalProposalArtifact(
  registry: IntelligenceAutomationRegistry,
  proposal: DatasetProposal,
): Promise<string> {
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-expect-error Node runtime import of a local scheduler helper script.
  const module = await import('../../../scripts/fetch-historical-data.mjs');
  const envelope = await module.fetchHistoricalEnvelope(proposal.provider, proposal.fetchArgs || {});
  const artifactDir = path.resolve(registry.defaults.artifactDir, '_proposal-validation', slugify(proposal.id));
  const entries = existsSync(artifactDir)
    ? await readdir(artifactDir, { withFileTypes: true }).catch(() => [])
    : [];
  const recentArtifacts = sortArtifactPathsChronologically(entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
    .map((entry) => path.join(artifactDir, entry.name)));
  const digest = computeHistoricalArtifactDigest(proposal.provider, envelope);
  for (const candidate of recentArtifacts.slice(-6).reverse()) {
    if ((await readHistoricalArtifactDigest(candidate)) === digest) {
      return candidate;
    }
  }
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const outputPath = path.join(artifactDir, `${timestamp}.json`);
  return module.writeHistoricalEnvelope(outputPath, proposal.provider, envelope);
}

function estimateHistoricalArtifactRowCount(payload: any): number {
  const data = payload?.envelope?.data;
  if (!data) return 0;
  if (typeof data?.count === 'number' && Number.isFinite(data.count)) return data.count;
  if (typeof data?.total_count === 'number' && Number.isFinite(data.total_count) && data.total_count > 0) return data.total_count;
  const candidates = [
    data?.data,
    data?.items,
    data?.observations,
    data?.prices,
    data?.market_caps,
    data?.total_volumes,
    data?.timeline,
  ];
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) return candidate.length;
  }
  if (Array.isArray(data)) return data.length;
  if (data?.data && typeof data.data === 'object') {
    return estimateHistoricalArtifactRowCount({ envelope: { data: data.data } });
  }
  return 0;
}

async function artifactLooksEmpty(artifactPath: string | null | undefined): Promise<boolean> {
  if (!artifactPath) return true;
  try {
    const raw = await readFile(String(artifactPath), 'utf8');
    const parsed = JSON.parse(raw);
    return estimateHistoricalArtifactRowCount(parsed) <= 0;
  } catch {
    return false;
  }
}

async function findMostRecentUsableArtifact(artifactPaths: string[]): Promise<string | null> {
  for (let index = artifactPaths.length - 1; index >= 0; index -= 1) {
    const candidate = artifactPaths[index];
    if (candidate && !(await artifactLooksEmpty(candidate))) {
      return candidate;
    }
  }
  return null;
}

async function listRecentUsableArtifacts(
  artifactPaths: string[],
  maxCount: number,
): Promise<string[]> {
  const retained: string[] = [];
  for (let index = artifactPaths.length - 1; index >= 0; index -= 1) {
    const candidate = artifactPaths[index];
    if (!candidate) continue;
    if (await artifactLooksEmpty(candidate)) continue;
    retained.unshift(candidate);
    if (retained.length >= maxCount) break;
  }
  return retained;
}

interface ArtifactImportPlan {
  importPath: string | null;
  sourceArtifactPaths: string[];
  cleanup: (() => Promise<void>) | null;
  strategy: 'latest' | 'rolling' | 'skip-existing-corpus';
}

async function buildArtifactImportPlan(args: {
  dataset: IntelligenceDatasetRegistryEntry;
  latestArtifactPath: string | null;
  artifactPaths: string[];
  existingRawRecordCount: number;
}): Promise<ArtifactImportPlan> {
  const rollingWindow = ROLLING_ARTIFACT_IMPORT_WINDOW[args.dataset.provider] || 0;
  const latestArtifactEmpty = await artifactLooksEmpty(args.latestArtifactPath);

    if (rollingWindow > 1) {
      const sourceArtifactPaths = await listRecentUsableArtifacts(args.artifactPaths, rollingWindow);
      if (sourceArtifactPaths.length > 1) {
        const bundlePath = path.join(
          tmpdir(),
          `wm-historical-bundle-${slugify(args.dataset.id)}-${Date.now()}.jsonl`,
        );
        const lines = await Promise.all(sourceArtifactPaths.map(async (candidate) => {
          const raw = await readFile(candidate, 'utf8');
          return JSON.stringify(JSON.parse(raw));
        }));
        await writeFile(bundlePath, `${lines.join('\n')}\n`, 'utf8');
        return {
          importPath: bundlePath,
          sourceArtifactPaths,
        cleanup: async () => {
          await unlink(bundlePath).catch(() => {});
        },
        strategy: 'rolling',
      };
    }
  }

  if (latestArtifactEmpty && args.existingRawRecordCount > 0) {
    return {
      importPath: null,
      sourceArtifactPaths: [],
      cleanup: null,
      strategy: 'skip-existing-corpus',
    };
  }

  return {
    importPath: args.latestArtifactPath,
    sourceArtifactPaths: args.latestArtifactPath ? [args.latestArtifactPath] : [],
    cleanup: null,
    strategy: 'latest',
  };
}

function sortFramesForReplay(frames: HistoricalReplayFrame[]): HistoricalReplayFrame[] {
  return frames
    .slice()
    .sort((left, right) => {
      const leftTs = asTs(left.transactionTime || left.knowledgeBoundary || left.timestamp);
      const rightTs = asTs(right.transactionTime || right.knowledgeBoundary || right.timestamp);
      return leftTs - rightTs || asTs(left.timestamp) - asTs(right.timestamp);
    });
}

function readFrameOrderTs(frame: HistoricalReplayFrame): number {
  return asTs(frame.transactionTime || frame.knowledgeBoundary || frame.timestamp);
}

function buildRollingFrameWindows(
  frames: HistoricalReplayFrame[],
  options: {
    maxWindows?: number;
    windowSize?: number;
    minWindowSize?: number;
  } = {},
): Array<{
  id: string;
  label: string;
  frames: HistoricalReplayFrame[];
}> {
  const sorted = sortFramesForReplay(frames);
  if (sorted.length === 0) return [];
  const maxWindows = clamp(Math.round(Number(options.maxWindows) || 3), 1, 5);
  const minWindowSize = clamp(Math.round(Number(options.minWindowSize) || 24), 12, 240);
  const requestedWindowSize = Math.round(Number(options.windowSize) || 0);
  const effectiveWindowSize = clamp(
    requestedWindowSize > 0 ? requestedWindowSize : Math.min(120, Math.max(minWindowSize, Math.round(sorted.length / Math.max(1, maxWindows)))),
    minWindowSize,
    Math.max(minWindowSize, sorted.length),
  );
  if (sorted.length <= effectiveWindowSize || maxWindows === 1) {
    return [{ id: 'window:full', label: 'full', frames: sorted }];
  }

  const lastStart = Math.max(0, sorted.length - effectiveWindowSize);
  const starts = new Set<number>();
  for (let index = 0; index < maxWindows; index += 1) {
    const ratio = maxWindows === 1 ? 1 : index / (maxWindows - 1);
    starts.add(Math.round(lastStart * ratio));
  }

  const orderedStarts = Array.from(starts).sort((left, right) => left - right);
  return orderedStarts.map((start, index) => {
    const label = orderedStarts.length === 1
      ? 'full'
      : index === 0
        ? 'older'
        : index === orderedStarts.length - 1
          ? 'recent'
          : `mid-${index}`;
    return {
      id: `window:${label}:${start}`,
      label,
      frames: sorted.slice(start, start + effectiveWindowSize),
    };
  }).filter((window) => window.frames.length >= minWindowSize);
}

function buildRollingFrameSample(
  frames: HistoricalReplayFrame[],
  options: {
    maxWindows?: number;
    windowSize?: number;
    minWindowSize?: number;
  } = {},
): HistoricalReplayFrame[] {
  const windows = buildRollingFrameWindows(frames, options);
  const merged = new Map<string, HistoricalReplayFrame>();
  for (const window of windows) {
    for (const frame of window.frames) {
      const key = frame.id || `${frame.timestamp}:${frame.datasetId || ''}:${frame.transactionTime || frame.knowledgeBoundary || ''}`;
      if (!merged.has(key)) merged.set(key, frame);
    }
  }
  return sortFramesForReplay(Array.from(merged.values()));
}

function readPortfolioValidationReturn(run: HistoricalReplayRun | null | undefined): number {
  if (!run) return 0;
  const summary = run.portfolioAccounting?.summary;
  if (summary && Number.isFinite(Number(summary.weightedCostAdjustedReturnPct))) {
    return Number(summary.weightedCostAdjustedReturnPct);
  }
  if (summary && Number.isFinite(Number(summary.weightedReturnPct))) {
    return Number(summary.weightedReturnPct);
  }
  return Number(run.realitySummary?.costAdjustedAvgReturnPct) || 0;
}

function readPortfolioValidationDrawdown(run: HistoricalReplayRun | null | undefined): number {
  const value = Number(run?.portfolioAccounting?.summary?.maxDrawdownPct);
  return Number.isFinite(value) ? Math.abs(value) : 0;
}

function readPortfolioValidationSharpe(run: HistoricalReplayRun | null | undefined): number {
  const value = Number(run?.portfolioAccounting?.summary?.sharpeRatio);
  return Number.isFinite(value) ? value : 0;
}

function buildValidationWindows(
  frames: HistoricalReplayFrame[],
  maxWindowFrames: number,
  maxWindowCount = 3,
): Array<{ label: string; frames: HistoricalReplayFrame[] }> {
  const normalized = sortFramesForReplay(frames);
  if (normalized.length <= maxWindowFrames || maxWindowCount <= 1) {
    return normalized.length > 0 ? [{ label: 'full', frames: normalized }] : [];
  }

  const lastStart = Math.max(0, normalized.length - maxWindowFrames);
  const middleStart = Math.max(0, Math.floor((normalized.length - maxWindowFrames) / 2));
  const candidates = [
    { label: 'early', start: 0 },
    { label: 'middle', start: middleStart },
    { label: 'recent', start: lastStart },
  ];
  const seen = new Set<string>();
  const windows: Array<{ label: string; frames: HistoricalReplayFrame[] }> = [];
  for (const candidate of candidates) {
    const key = String(candidate.start);
    if (seen.has(key)) continue;
    seen.add(key);
    windows.push({
      label: candidate.label,
      frames: normalized.slice(candidate.start, candidate.start + maxWindowFrames),
    });
    if (windows.length >= maxWindowCount) break;
  }
  return windows.filter((window) => window.frames.length > 0);
}

function buildValidationReplayScore(args: {
  proposal: DatasetProposal;
  baseline: HistoricalReplayRun | null;
  augmented: HistoricalReplayRun;
}): {
  score: number;
  passed: boolean;
  summary: string;
} {
  const baselineCoverage = args.baseline?.coverageLedger?.globalCompletenessScore || 0;
  const augmentedCoverage = args.augmented.coverageLedger?.globalCompletenessScore || 0;
  const coverageLift = augmentedCoverage - baselineCoverage;
  const baselineReturn = readPortfolioValidationReturn(args.baseline);
  const augmentedReturn = readPortfolioValidationReturn(args.augmented);
  const utilityLift = Number((augmentedReturn - baselineReturn).toFixed(2));
  const baselineDrawdown = readPortfolioValidationDrawdown(args.baseline);
  const augmentedDrawdown = readPortfolioValidationDrawdown(args.augmented);
  const drawdownDelta = Number((baselineDrawdown - augmentedDrawdown).toFixed(2));
  const augmentedSharpe = readPortfolioValidationSharpe(args.augmented);
  const baselineIdeas = args.baseline?.ideaRuns.length || 0;
  const ideaLift = args.augmented.ideaRuns.length - baselineIdeas;
  const baselineWorkflowQuality = args.baseline && args.baseline.workflow.length > 0
    ? args.baseline.workflow.reduce((sum, step) => sum + (step.metric || 0), 0) / args.baseline.workflow.length
    : 0;
  const augmentedWorkflowQuality = args.augmented.workflow.reduce((sum, step) => sum + (step.metric || 0), 0) / Math.max(1, args.augmented.workflow.length);
  const utilityScore = clamp(Math.round(50 + utilityLift * 28), 0, 100);
  const ideaScore = clamp(Math.round(50 + ideaLift * 5), 0, 100);
  const score = clamp(
    Math.round(
      (args.proposal.valueScore ?? args.proposal.proposalScore) * 0.24
      + Math.max(0, coverageLift) * 0.2
      + utilityScore * 0.2
      + ideaScore * 0.12
      + augmentedWorkflowQuality * 0.14
      + Math.max(-10, Math.min(10, drawdownDelta)) * 0.7
      + Math.max(-2, Math.min(3, augmentedSharpe)) * 3.5
      + Math.max(0, 100 - args.augmented.realitySummary.nonTradableRate * 4) * 0.1,
    ),
    0,
  100,
  );
  const dynamicFloor = clamp(
    Math.round(
      Math.max(
        46,
        (args.proposal.valueScore ?? args.proposal.proposalScore) * 0.72,
        baselineWorkflowQuality * 0.78,
      ),
    ),
    46,
    92,
  );
  const returnFloor = Math.max(-0.2, baselineReturn - 0.12);
  const passed = (args.proposal.coverageGain ?? 0) > 0
    && coverageLift >= 0
    && augmentedReturn >= returnFloor
    && augmentedDrawdown <= Math.max(18, baselineDrawdown + 6)
    && args.augmented.realitySummary.nonTradableRate <= 10
    && score >= dynamicFloor;
  return {
    score,
    passed,
    summary: `score=${score} coverageLift=${coverageLift.toFixed(2)} utilityLift=${utilityLift.toFixed(2)} ideaLift=${ideaLift} baselineReturn=${baselineReturn.toFixed(2)} augmentedReturn=${augmentedReturn.toFixed(2)} drawdownDelta=${drawdownDelta.toFixed(2)} sharpe=${augmentedSharpe.toFixed(2)}`,
  };
}

interface ProposalValidationWindow {
  id: string;
  label: string;
  anchorFrames: HistoricalReplayFrame[];
  baselineRun: HistoricalReplayRun | null;
}

async function runMiniReplayValidation(args: {
  proposal: DatasetProposal;
  registry: IntelligenceAutomationRegistry;
  validationWindows: ProposalValidationWindow[];
}): Promise<DatasetProposal> {
  const validationRoot = path.resolve(args.registry.defaults.artifactDir, '_proposal-validation');
  await mkdir(validationRoot, { recursive: true });
  const tempDbPath = path.join(validationRoot, `${slugify(args.proposal.id)}.duckdb`);
  await rm(tempDbPath, { force: true }).catch(() => {});

  try {
    const artifactPath = await fetchHistoricalProposalArtifact(args.registry, args.proposal);
    const importResult = await processHistoricalDump(String(artifactPath), {
      datasetId: args.proposal.id,
      provider: args.proposal.provider,
      dbPath: tempDbPath,
      bucketHours: Number(args.proposal.importOptions?.bucketHours) || args.registry.defaults.bucketHours,
      warmupFrameCount: Number(args.proposal.importOptions?.warmupFrameCount) || Math.min(24, args.registry.defaults.warmupFrameCount),
      ...args.proposal.importOptions,
    });
    const proposalFrames = await loadHistoricalReplayFramesFromDuckDb({
      dbPath: tempDbPath,
      datasetId: args.proposal.id,
      includeWarmup: true,
      maxFrames: Math.max(180, Number(args.proposal.frameLoadOptions?.maxFrames) || 0),
      latestFirst: false,
      ...args.proposal.frameLoadOptions,
    });
    if (proposalFrames.length < 2) {
      return {
        ...args.proposal,
        autoEnable: false,
        validationStatus: 'failed',
        validationSummary: `insufficient proposal frames (${proposalFrames.length})`,
        miniReplayFrameCount: proposalFrames.length,
        miniReplayIdeaRunCount: 0,
        miniReplayCostAdjustedAvgReturnPct: 0,
      };
    }

    const sortedProposalFrames = sortFramesForReplay(proposalFrames);
    const validationWindows = args.validationWindows.length > 0
      ? args.validationWindows
      : [{
        id: 'window:fallback',
        label: 'fallback',
        anchorFrames: [],
        baselineRun: null,
      }];
    const windowResults: Array<{
      window: ProposalValidationWindow;
      validation: ReturnType<typeof buildValidationReplayScore>;
      augmentedRun: HistoricalReplayRun;
    }> = [];

    for (const window of validationWindows) {
      const anchorFrames = sortFramesForReplay(window.anchorFrames);
      const startTs = anchorFrames.length > 0 ? readFrameOrderTs(anchorFrames[0]!) : Number.NEGATIVE_INFINITY;
      const endTs = anchorFrames.length > 0 ? readFrameOrderTs(anchorFrames[anchorFrames.length - 1]!) : Number.POSITIVE_INFINITY;
      const proposalWindowFrames = sortedProposalFrames
        .filter((frame) => {
          const ts = readFrameOrderTs(frame);
          return ts >= startTs && ts <= endTs;
        })
        .map((frame) => ({
          ...frame,
          id: `proposal:${args.proposal.id}:${window.id}:${frame.id || frame.timestamp}`,
        }));
      if (anchorFrames.length > 0 && proposalWindowFrames.length < 2) {
        continue;
      }

      const mergedFrames = sortFramesForReplay([
        ...anchorFrames,
        ...proposalWindowFrames,
      ]);
      if (mergedFrames.length < 2) continue;

      const augmentedRun = await runHistoricalReplay(mergedFrames, {
        label: `${args.proposal.label} / mini validation / ${window.label}`,
        retainLearningState: false,
        recordAdaptation: false,
        warmupFrameCount: Math.min(
          Number(args.proposal.replayOptions?.warmupFrameCount) || 24,
          Math.max(0, mergedFrames.length - 1),
        ),
        horizonsHours: args.registry.defaults.horizonsHours.slice(),
        ...args.proposal.replayOptions,
      });
      const validation = buildValidationReplayScore({
        proposal: {
          ...args.proposal,
          coverageGain: Number(args.proposal.coverageGain) || 0,
        },
        baseline: window.baselineRun,
        augmented: augmentedRun,
      });
      windowResults.push({ window, validation, augmentedRun });
    }

    if (windowResults.length === 0) {
      return {
        ...args.proposal,
        autoEnable: false,
        validationStatus: 'failed',
        validationSummary: `no overlapping validation windows; importFrames=${importResult.frameCount}`,
        miniReplayFrameCount: 0,
        miniReplayIdeaRunCount: 0,
        miniReplayCostAdjustedAvgReturnPct: 0,
      };
    }

    const aggregatedScore = Math.round(median(windowResults.map((result) => result.validation.score)));
    const passCount = windowResults.filter((result) => result.validation.passed).length;
    const medianReturn = median(windowResults.map((result) => readPortfolioValidationReturn(result.augmentedRun)));
    const passed = passCount >= Math.ceil(windowResults.length / 2)
      && aggregatedScore >= Math.max(48, (args.proposal.valueScore ?? args.proposal.proposalScore) * 0.62)
      && medianReturn >= -0.15;
    const avgReturn = average(windowResults.map((result) => readPortfolioValidationReturn(result.augmentedRun)));
    const totalFrameCount = windowResults.reduce((sum, result) => sum + result.augmentedRun.frameCount, 0);
    const totalIdeaRuns = windowResults.reduce((sum, result) => sum + result.augmentedRun.ideaRuns.length, 0);
    const windowSummary = windowResults
      .map((result) => `${result.window.label}:${result.validation.passed ? 'pass' : 'fail'}#${result.validation.score}`)
      .join(' | ');
    return {
      ...args.proposal,
      autoEnable: args.proposal.autoEnable && passed,
      validationStatus: passed ? 'passed' : 'failed',
      validationSummary: `${windowSummary}; medianScore=${aggregatedScore}; medianReturn=${medianReturn.toFixed(2)}; importFrames=${importResult.frameCount}`,
      miniReplayScore: aggregatedScore,
      miniReplayFrameCount: totalFrameCount,
      miniReplayIdeaRunCount: totalIdeaRuns,
      miniReplayCostAdjustedAvgReturnPct: Number(avgReturn.toFixed(2)),
    };
  } catch (error) {
    return {
      ...args.proposal,
      autoEnable: false,
      validationStatus: 'failed',
      validationSummary: error instanceof Error ? error.message : String(error),
      miniReplayFrameCount: 0,
      miniReplayIdeaRunCount: 0,
      miniReplayCostAdjustedAvgReturnPct: 0,
    };
  }
}

function toReplaySummary(datasetId: string, run: HistoricalReplayRun): { datasetId: string; runId: string; mode: 'replay' | 'walk-forward'; ideaCount: number } {
  return {
    datasetId,
    runId: run.id,
    mode: run.mode,
    ideaCount: run.ideaRuns.length,
  };
}

function buildThemeDefinitionFromProposal(proposal: CodexThemeProposal): InvestmentThemeDefinition {
  return {
    id: proposal.id,
    label: proposal.label,
    triggers: proposal.triggers.slice(),
    sectors: proposal.sectors.slice(),
    commodities: proposal.commodities.slice(),
    timeframe: proposal.timeframe,
    thesis: proposal.thesis,
    invalidation: proposal.invalidation.slice(),
    baseSensitivity: proposal.confidence,
    assets: proposal.assets.map((asset) => ({
      symbol: asset.symbol,
      name: asset.name,
      assetKind: asset.assetKind,
      sector: asset.sector,
      commodity: asset.commodity || undefined,
      direction: asset.direction,
      role: asset.role,
    })),
  };
}

function autoPromoteTheme(
  proposal: CodexThemeProposal,
  queueItem: ThemeDiscoveryQueueItem,
  registry: IntelligenceAutomationRegistry,
  state: IntelligenceAutomationState,
  existingThemes: InvestmentThemeDefinition[],
  promotionsToday: number,
): boolean {
  if (registry.themeAutomation.mode === 'manual') return false;
  if (promotionsToday >= registry.themeAutomation.maxPromotionsPerDay) return false;
  if (queueItem.signalScore < registry.themeAutomation.minDiscoveryScore) return false;
  if (queueItem.sampleCount < registry.themeAutomation.minSampleCount) return false;
  if (queueItem.sourceCount < registry.themeAutomation.minSourceCount) return false;
  if ((proposal.assets || []).length < registry.themeAutomation.minAssetCount) return false;
  if (existingThemes.some((theme) => theme.id === proposal.id)) return false;
  if (queueItem.overlapWithKnownThemes > registry.themeAutomation.maxOverlapWithKnownThemes) return false;
  const promotion = computeThemePromotionScore(proposal, queueItem, existingThemes, state);
  if (promotion.score < registry.themeAutomation.minPromotionScore) return false;
  if (registry.themeAutomation.mode === 'guarded-auto' && proposal.confidence < registry.themeAutomation.minCodexConfidence) return false;
  return proposal.confidence >= Math.max(52, registry.themeAutomation.minCodexConfidence - 16);
}

async function runWithRetry<T>(
  datasetId: string,
  kind: AutomationJobKind,
  maxRetries: number,
  runner: (attempt: number) => Promise<T>,
  state: IntelligenceAutomationState,
): Promise<T> {
  let attempt = 0;
  let lastError: Error | null = null;
  while (attempt < maxRetries) {
    attempt += 1;
    const startedAt = nowIso();
    try {
      const result = await runner(attempt);
      appendRun(state, {
        id: `${datasetId}:${kind}:${startedAt}`,
        datasetId,
        kind,
        status: 'ok',
        startedAt,
        completedAt: nowIso(),
        attempts: attempt,
        detail: `${kind} succeeded`,
      });
      return result;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      appendRun(state, {
        id: `${datasetId}:${kind}:${startedAt}`,
        datasetId,
        kind,
        status: 'error',
        startedAt,
        completedAt: nowIso(),
        attempts: attempt,
        detail: lastError.message,
      });
      if (attempt >= maxRetries) break;
      await sleep(1_500 * attempt);
    }
  }
  throw lastError || new Error(`${kind} failed`);
}

async function pruneArtifacts(artifactDir: string, keepCount: number, retentionDays: number): Promise<string[]> {
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

function mergeThemeQueue(state: IntelligenceAutomationState, queue: ThemeDiscoveryQueueItem[]): void {
  const existing = new Map(state.themeQueue.map((item) => [item.id, item] as const));
  for (const item of queue) {
    const previous = existing.get(item.id);
    existing.set(item.id, previous ? {
      ...previous,
      ...item,
      createdAt: previous.createdAt,
      status: previous.status === 'promoted' || previous.status === 'rejected' ? previous.status : item.status,
      proposedThemeId: previous.proposedThemeId || item.proposedThemeId || null,
      promotedThemeId: previous.promotedThemeId || item.promotedThemeId || null,
      rejectedReason: previous.rejectedReason || item.rejectedReason || null,
    } : item);
  }
  state.themeQueue = Array.from(existing.values()).slice(-120);
}

function reviewThemeQueueState(state: IntelligenceAutomationState, registry: IntelligenceAutomationRegistry): void {
  const reviewedAt = nowIso();
  state.themeQueue = state.themeQueue.map((item) => {
    if (item.status !== 'open') return item;
    const ageHours = Math.max(0, (Date.now() - asTs(item.createdAt || item.updatedAt)) / 3_600_000);
    const normalizedTopic = String(item.topicKey || item.label || '').replace(/-/g, ' ');
    if (isLowSignalKeywordTerm(item.label) || isLowSignalKeywordTerm(normalizedTopic)) {
      return {
        ...item,
        status: 'rejected',
        rejectedReason: 'Auto-rejected as low-signal keyword motif.',
        updatedAt: reviewedAt,
      };
    }
    if (item.overlapWithKnownThemes > registry.themeAutomation.maxOverlapWithKnownThemes + 0.08) {
      return {
        ...item,
        status: 'rejected',
        rejectedReason: 'Auto-rejected because novelty overlap with existing themes is too high.',
        updatedAt: reviewedAt,
      };
    }
    if (ageHours >= 24 && item.signalScore < Math.max(42, registry.themeAutomation.minDiscoveryScore - 10)) {
      return {
        ...item,
        status: 'rejected',
        rejectedReason: 'Auto-rejected after aging below the discovery quality floor.',
        updatedAt: reviewedAt,
      };
    }
    return item;
  });
}

function gapSeverityRank(value: GapSeverity): number {
  if (value === 'critical') return 3;
  if (value === 'elevated') return 2;
  return 1;
}

function themeRecentlyAttempted(state: IntelligenceAutomationState, themeId: string, cooldownHours: number): boolean {
  const attemptedAt = state.candidateThemeHistory?.[themeId];
  if (!attemptedAt) return false;
  return Date.now() - asTs(attemptedAt) < cooldownHours * 60 * 60 * 1000;
}

function computeCoveragePriorityScore(args: {
  themeId: string;
  snapshot: Awaited<ReturnType<typeof getInvestmentIntelligenceSnapshot>>;
  state: IntelligenceAutomationState;
  registry: IntelligenceAutomationRegistry;
  replayAdaptation: Awaited<ReturnType<typeof getReplayAdaptationSnapshot>>;
}): { score: number; region: string; reason: string } {
  const gaps = (args.snapshot?.coverageGaps || []).filter((gap) => gap.themeId === args.themeId);
  const directMappings = (args.snapshot?.directMappings || []).filter((mapping) => mapping.themeId === args.themeId);
  const openReviews = (args.snapshot?.candidateReviews || []).filter((review) => review.themeId === args.themeId && review.status === 'open');
  if (!gaps.length) return { score: 0, region: 'Global', reason: 'no-gaps' };

  const highestSeverity = Math.max(...gaps.map((gap) => gapSeverityRank(gap.severity)));
  const missingKinds = gaps.reduce((sum, gap) => sum + gap.missingAssetKinds.length, 0);
  const missingSectors = gaps.reduce((sum, gap) => sum + gap.missingSectors.length, 0);
  const distinctRegions = Array.from(new Set(gaps.map((gap) => gap.region).filter(Boolean)));
  const region = distinctRegions[0] || 'Global';
  const replayProfile = getReplayThemeProfileFromSnapshot(args.replayAdaptation, args.themeId);
  const currentTheme = getCurrentThemePerformanceFromSnapshot(args.replayAdaptation, args.themeId);
  const coverage = getCoveragePenaltyForTheme(args.snapshot?.coverageLedger || args.replayAdaptation?.coverageLedger || null, args.themeId);
  let score = highestSeverity * 18
    + Math.min(18, missingKinds * 6)
    + Math.min(16, missingSectors * 3)
    + Math.min(12, openReviews.length * 3)
    + (directMappings.length === 0 ? 10 : Math.max(0, 8 - (directMappings.length * 2)))
    + Math.round(coverage.coveragePenalty * 0.45)
    + Math.max(0, 16 - Math.round((replayProfile?.confirmationReliability ?? 42) * 0.18))
    + Math.max(0, 10 - ((replayProfile?.regimeMetrics.length || 0) * 3))
    + Math.round(Math.max(0, -(currentTheme?.avgReturnPct ?? 0)) * 5);

  if (themeRecentlyAttempted(args.state, args.themeId, args.registry.candidateAutomation.themeCooldownHours)) {
    score -= 18;
  }
  return {
    score: clamp(Math.round(score), 0, 100),
    region,
    reason: `severity=${highestSeverity} missingKinds=${missingKinds} missingSectors=${missingSectors} coveragePenalty=${coverage.coveragePenalty} confirmation=${replayProfile?.confirmationReliability ?? 0} directMappings=${directMappings.length}`,
  };
}

function computeThemePromotionScore(
  proposal: CodexThemeProposal,
  queueItem: ThemeDiscoveryQueueItem,
  existingThemes: InvestmentThemeDefinition[],
  state: IntelligenceAutomationState,
): { score: number; reason: string } {
  const uniqueKinds = new Set(proposal.assets.map((asset) => asset.assetKind)).size;
  const uniqueSectors = new Set(proposal.assets.map((asset) => asset.sector)).size;
  const hasHedge = proposal.assets.some((asset) => asset.role === 'hedge');
  const overlapPenalty = Math.round(queueItem.overlapWithKnownThemes * 24);
  const duplicateIdPenalty = existingThemes.some((theme) => theme.id === proposal.id) ? 100 : 0;
  const promotedDatasetPressure = buildPromotedThemeDatasetPressure(state);
  const datasetConcentrationPenalty = computeDatasetConcentrationPenalty(queueItem.datasetIds || [], promotedDatasetPressure, 7, 18);
  const datasetDiversityBonus = computeDatasetDiversityBonus(queueItem.datasetIds || [], queueItem.supportingSources || [], 12);
  let score = Math.round(
    (queueItem.signalScore * 0.45)
    + (proposal.confidence * 0.25)
    + Math.min(12, queueItem.sampleCount * 2)
    + Math.min(10, queueItem.sourceCount * 3)
    + Math.min(8, queueItem.regionCount * 2)
    + Math.min(12, uniqueKinds * 4 + uniqueSectors * 2 + (hasHedge ? 2 : 0))
    + datasetDiversityBonus
    - overlapPenalty
    - duplicateIdPenalty
    - datasetConcentrationPenalty,
  );
  score = clamp(score, 0, 100);
  return {
    score,
    reason: `score=${score} overlap=${queueItem.overlapWithKnownThemes.toFixed(2)} assetKinds=${uniqueKinds} sectors=${uniqueSectors} datasetBonus=${datasetDiversityBonus} datasetPenalty=${datasetConcentrationPenalty}`,
  };
}

function themeQueuePriorityScore(queueItem: ThemeDiscoveryQueueItem, queue: ThemeDiscoveryQueueItem[]): number {
  const datasetPressure = buildQueueDatasetPressure(queue);
  const datasetConcentrationPenalty = computeDatasetConcentrationPenalty(queueItem.datasetIds || [], datasetPressure, 6, 16);
  const datasetDiversityBonus = computeDatasetDiversityBonus(queueItem.datasetIds || [], queueItem.supportingSources || [], 10);
  return clamp(Math.round(
    (queueItem.signalScore * 0.62)
    + Math.min(12, queueItem.sampleCount * 2)
    + Math.min(10, queueItem.sourceCount * 3)
    + Math.min(8, queueItem.regionCount * 2)
    + datasetDiversityBonus
    - (queueItem.overlapWithKnownThemes * 18)
    - datasetConcentrationPenalty,
  ), 0, 100);
}

function buildDatasetThemeInput(snapshot: NonNullable<Awaited<ReturnType<typeof getInvestmentIntelligenceSnapshot>>>, themeId: string): DatasetDiscoveryThemeInput | null {
  const theme = getInvestmentThemeDefinition(themeId);
  const mappedRows = snapshot.directMappings.filter((row) => row.themeId === themeId);
  const gaps = snapshot.coverageGaps.filter((gap) => gap.themeId === themeId);
  const label = theme?.label || mappedRows[0]?.themeLabel || themeId;
  if (!label) return null;
  return {
    themeId,
    label,
    triggers: theme?.triggers.slice(0, 8) || [],
    sectors: Array.from(new Set([
      ...(theme?.sectors || []),
      ...mappedRows.map((row) => row.sector),
      ...gaps.flatMap((gap) => gap.missingSectors),
    ])).filter(Boolean).slice(0, 8),
    commodities: Array.from(new Set([
      ...(theme?.commodities || []),
      ...mappedRows.map((row) => row.commodity || '').filter(Boolean),
    ])).slice(0, 6),
    supportingHeadlines: Array.from(new Set(mappedRows.map((row) => row.eventTitle))).slice(0, 4),
    suggestedSymbols: Array.from(new Set([
      ...mappedRows.map((row) => row.symbol),
      ...gaps.flatMap((gap) => gap.suggestedSymbols),
    ])).slice(0, 8),
    priority: Math.round(
      Math.min(
        95,
        Math.max(
          35,
          average(mappedRows.map((row) => row.calibratedConfidence || row.conviction || 0))
          + gaps.length * 4
          + Math.min(10, snapshot.hiddenCandidates.filter((item) => item.themeId === themeId).length * 2),
        ),
      ),
    ),
  };
}

function rankDatasetDiscoveryThemeIds(args: {
  snapshot: NonNullable<Awaited<ReturnType<typeof getInvestmentIntelligenceSnapshot>>>;
  replayAdaptation: Awaited<ReturnType<typeof getReplayAdaptationSnapshot>>;
  limit: number;
}): string[] {
  const replayProfiles = Array.isArray(args.replayAdaptation?.themeProfiles)
    ? args.replayAdaptation.themeProfiles.slice()
    : [];
  const currentPerformance = new Map(
    (args.replayAdaptation?.currentThemePerformance || []).map((metric) => [metric.themeId, metric] as const),
  );
  const coverageLedger = args.snapshot.coverageLedger || args.replayAdaptation?.coverageLedger || null;
  const scoreByTheme = new Map<string, number>();
  const bump = (themeId: string, value: number): void => {
    if (!themeId || !Number.isFinite(value)) return;
    scoreByTheme.set(themeId, (scoreByTheme.get(themeId) || 0) + value);
  };

  for (const card of args.snapshot.ideaCards) bump(card.themeId, 12);
  for (const gap of args.snapshot.coverageGaps) {
    const severity = gap.severity === 'critical' ? 16 : gap.severity === 'elevated' ? 11 : 6;
    bump(gap.themeId, severity);
  }
  for (const mapping of args.snapshot.directMappings) bump(mapping.themeId, 4);
  for (const candidate of args.snapshot.hiddenCandidates) bump(candidate.themeId, 3);

  for (const profile of replayProfiles) {
    const coverage = getCoveragePenaltyForTheme(coverageLedger, profile.themeId);
    const current = currentPerformance.get(profile.themeId);
    bump(
      profile.themeId,
      Math.min(24, profile.weightedSampleSize * 0.35)
      + Math.max(0, 58 - profile.confirmationReliability) * 0.24
      + Math.max(0, coverage.coveragePenalty) * 0.22
      + Math.max(0, -(current?.avgReturnPct ?? 0)) * 3.5,
    );
  }

  return Array.from(scoreByTheme.entries())
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, Math.max(4, args.limit))
    .map(([themeId]) => themeId);
}

function scoreDatasetProposalValue(args: {
  proposal: DatasetProposal;
  snapshot: NonNullable<Awaited<ReturnType<typeof getInvestmentIntelligenceSnapshot>>>;
  replayAdaptation: Awaited<ReturnType<typeof getReplayAdaptationSnapshot>>;
  registry: IntelligenceAutomationRegistry;
}): DatasetProposal {
  const inferred = inferCoverageFamilies({
    provider: args.proposal.provider,
    datasetId: args.proposal.id,
    sourceName: args.proposal.label,
    title: args.proposal.querySummary,
  });
  const coverage = scoreCoverageGain({
    snapshot: args.snapshot.coverageLedger || args.replayAdaptation?.coverageLedger || null,
    sourceFamily: inferred.sourceFamily,
    featureFamily: inferred.featureFamily,
    themeId: args.proposal.sourceThemeId,
  });
  const replayProfile = getReplayThemeProfileFromSnapshot(args.replayAdaptation, args.proposal.sourceThemeId);
  const currentTheme = getCurrentThemePerformanceFromSnapshot(args.replayAdaptation, args.proposal.sourceThemeId);
  const utilityGain = clamp(
    Math.round(
      Math.max(0, 68 - (replayProfile?.confirmationReliability ?? 42)) * 0.6
      + Math.max(0, 14 - Math.min(14, (replayProfile?.weightedSampleSize ?? 0) * 0.35))
      + Math.max(0, -(currentTheme?.avgReturnPct ?? 0)) * 8,
    ),
    0,
    48,
  );
  const regimeDiversificationGain = clamp(
    Math.round(
      Math.max(0, 3 - (replayProfile?.regimeMetrics.length || 0)) * 6
      + (args.proposal.provider === 'alfred' ? 4 : 0),
    ),
    0,
    24,
  );
  const providerAdjustment = providerConcentrationAdjustment(args.proposal.provider, args.registry);
  const valueScore = clamp(
    Math.round(
      args.proposal.proposalScore * 0.34
      + coverage.coverageGain * 0.34
      + utilityGain * 0.22
      + regimeDiversificationGain * 0.1
      + providerAdjustment.bonus
      - coverage.duplicationPenalty * 0.12
      - providerAdjustment.penalty,
    ),
    0,
    100,
  );
  const proposalScore = clamp(Math.round(args.proposal.proposalScore * 0.45 + valueScore * 0.55), 0, 100);
  return {
    ...args.proposal,
    proposalScore,
    valueScore,
    coverageGain: coverage.coverageGain,
    utilityGain,
    regimeDiversificationGain,
    rationale: `${args.proposal.rationale} ValueScore=${valueScore} CoverageGain=${coverage.coverageGain} UtilityGain=${utilityGain} RegimeGain=${regimeDiversificationGain} ProviderBonus=${providerAdjustment.bonus} ProviderPenalty=${providerAdjustment.penalty}.`,
  };
}

async function runDatasetDiscoverySweep(args: {
  registry: IntelligenceAutomationRegistry;
  state: IntelligenceAutomationState;
  registryPath?: string;
}): Promise<{ proposals: DatasetProposal[]; registered: DatasetProposal[] }> {
  if (!args.registry.datasetAutomation.enabled) {
    return { proposals: [], registered: [] };
  }
  if (!shouldRunEvery(args.state.lastDatasetDiscoveryAt, args.registry.datasetAutomation.everyMinutes)) {
    return { proposals: args.state.datasetProposals.slice(0, 24), registered: [] };
  }
  const snapshot = await getInvestmentIntelligenceSnapshot();
  if (!snapshot) {
    args.state.lastDatasetDiscoveryAt = nowIso();
    return { proposals: [], registered: [] };
  }
  const replayAdaptation = await getReplayAdaptationSnapshot();

  const rankedThemeIds = rankDatasetDiscoveryThemeIds({
    snapshot,
    replayAdaptation,
    limit: 10,
  });
  const themeInputs = rankedThemeIds
    .map((themeId) => buildDatasetThemeInput(snapshot, themeId))
    .filter((value): value is DatasetDiscoveryThemeInput => Boolean(value));

  const heuristicProposals = proposeDatasetsForThemes({
    themes: themeInputs,
    existingDatasets: args.registry.datasets,
    policy: args.registry.datasetAutomation,
  });

  const merged = new Map<string, DatasetProposal>();
  for (const proposal of [...(snapshot.datasetAutonomy?.proposals || []), ...heuristicProposals]) {
    const existing = merged.get(proposal.id);
    if (!existing || existing.proposalScore < proposal.proposalScore) merged.set(proposal.id, proposal);
  }

  for (const themeInput of themeInputs.slice(0, args.registry.datasetAutomation.codexTopThemesPerCycle)) {
    const codexProposals = await proposeDatasetsWithCodex(themeInput).catch(() => null);
    for (const proposal of codexProposals || []) {
      const existing = merged.get(proposal.id);
      if (!existing || existing.proposalScore < proposal.proposalScore) {
        merged.set(proposal.id, {
          ...proposal,
          autoRegister: false,
          autoEnable: false,
        });
      }
    }
  }

  const scoredProposals = Array.from(merged.values())
    .map((proposal) => scoreDatasetProposalValue({
      proposal,
      snapshot,
      replayAdaptation,
      registry: args.registry,
    }))
    .sort((a, b) => b.proposalScore - a.proposalScore || b.confidence - a.confidence || a.label.localeCompare(b.label))
    .slice(0, 24);
  const validationAnchorFrames = await loadHistoricalReplayFramesFromDuckDb({
    dbPath: args.registry.defaults.dbPath,
    includeWarmup: true,
    maxFrames: 360,
    latestFirst: false,
  }).catch(() => [] as HistoricalReplayFrame[]);
  const validationWindows: ProposalValidationWindow[] = await Promise.all(
    buildValidationWindows(validationAnchorFrames, 120, 3).map(async (window, index) => ({
      id: `window:${index}:${window.label}`,
      label: window.label,
      anchorFrames: window.frames,
      baselineRun: window.frames.length >= 2
        ? await runHistoricalReplay(sortFramesForReplay(window.frames), {
          label: `dataset-discovery / baseline / ${window.label}`,
          retainLearningState: false,
          recordAdaptation: false,
          warmupFrameCount: Math.min(24, Math.max(0, window.frames.length - 1)),
          horizonsHours: args.registry.defaults.horizonsHours.slice(),
        }).catch(() => null)
        : null,
    })),
  );
  const proposals: DatasetProposal[] = [];
  for (let index = 0; index < scoredProposals.length; index += 1) {
    const proposal = scoredProposals[index]!;
    const shouldValidate = index < Math.max(4, args.registry.datasetAutomation.maxRegistrationsPerCycle * 3);
    if (!shouldValidate) {
      proposals.push({
        ...proposal,
        autoEnable: false,
        validationStatus: 'skipped',
        validationSummary: 'validation deferred',
      });
      continue;
    }
    proposals.push(await runMiniReplayValidation({
      proposal,
      registry: args.registry,
      validationWindows,
    }));
  }
  const autoRegistration = autoRegisterDatasetProposals({
    registryDatasets: args.registry.datasets,
    proposals,
    policy: args.registry.datasetAutomation,
  });
  args.registry.datasets = autoRegistration.datasets.map((dataset) => ({ ...dataset }));
  args.state.datasetProposals = proposals;
  args.state.lastDatasetDiscoveryAt = nowIso();
  if (autoRegistration.registered.length > 0) {
    await saveAutomationRegistry(args.registry, args.registryPath || DEFAULT_REGISTRY_PATH);
  }
  appendRun(args.state, {
    id: `global:dataset-discovery:${args.state.lastDatasetDiscoveryAt}`,
    datasetId: null,
    kind: 'dataset-discovery',
    status: 'ok',
    startedAt: args.state.lastDatasetDiscoveryAt,
    completedAt: nowIso(),
    attempts: 1,
    detail: `dataset proposals=${proposals.length} registered=${autoRegistration.registered.length}`,
  });
  return {
    proposals,
    registered: autoRegistration.registered,
  };
}

async function runCandidateExpansionSweep(args: {
  registry: IntelligenceAutomationRegistry;
  state: IntelligenceAutomationState;
}): Promise<{ themeIds: string[]; acceptedAny: boolean }> {
  if (!args.registry.candidateAutomation.enabled) {
    return { themeIds: [], acceptedAny: false };
  }
  if (!shouldRunEvery(args.state.lastCandidateExpansionAt, args.registry.candidateAutomation.everyMinutes)) {
    return { themeIds: [], acceptedAny: false };
  }

  const snapshot = await getInvestmentIntelligenceSnapshot();
  if (!snapshot || snapshot.universePolicy.mode === 'manual') {
    args.state.lastCandidateExpansionAt = nowIso();
    return { themeIds: [], acceptedAny: false };
  }
  const replayAdaptation = await getReplayAdaptationSnapshot();

  const minSeverity = gapSeverityRank(args.registry.candidateAutomation.minGapSeverity);
  const rankedThemes = Array.from(new Set(
    snapshot.coverageGaps
      .filter((gap) => gapSeverityRank(gap.severity) >= minSeverity)
      .map((gap) => gap.themeId),
  ))
    .map((themeId) => ({
      themeId,
      ...computeCoveragePriorityScore({
        themeId,
        snapshot,
        state: args.state,
        registry: args.registry,
        replayAdaptation,
      }),
    }))
    .filter((entry) => entry.score >= args.registry.candidateAutomation.minCoverageScore)
    .sort((a, b) => b.score - a.score || a.themeId.localeCompare(b.themeId));

  const regionCounts = new Map<string, number>();
  const candidateThemes: string[] = [];
  for (const entry of rankedThemes) {
    if (candidateThemes.length >= args.registry.candidateAutomation.maxThemesPerCycle) break;
    if ((regionCounts.get(entry.region) || 0) >= args.registry.candidateAutomation.maxThemesPerRegionPerCycle) continue;
    candidateThemes.push(entry.themeId);
    regionCounts.set(entry.region, (regionCounts.get(entry.region) || 0) + 1);
  }

  const themeIds: string[] = [];
  let acceptedAny = false;

  for (const themeId of candidateThemes) {
    const theme = getInvestmentThemeDefinition(themeId);
    if (!theme) continue;
    const proposals = await runWithRetry(themeId, 'candidate-expansion', Math.max(1, args.registry.defaults.maxRetries - 1), async () => (
      proposeCandidatesWithCodex({
        theme,
        gaps: snapshot.coverageGaps.filter((gap) => gap.themeId === themeId),
        topMappings: snapshot.directMappings.filter((mapping) => mapping.themeId === themeId),
      })
    ), args.state);
    args.state.candidateThemeHistory = {
      ...(args.state.candidateThemeHistory || {}),
      [themeId]: nowIso(),
    };
    if (!proposals || proposals.length === 0) continue;
    const inserted = await ingestCodexCandidateExpansionProposals(themeId, proposals);
    if (!inserted.length) continue;
    themeIds.push(themeId);
    if (inserted.some((review) => review.status === 'accepted')) {
      acceptedAny = true;
    }
  }

  args.state.lastCandidateExpansionAt = nowIso();
  return { themeIds, acceptedAny };
}

export async function runIntelligenceAutomationCycle(args: {
  registryPath?: string;
  statePath?: string;
  manualTrigger?: boolean;
  forceFetch?: boolean;
  returnRunDetails?: boolean;
} = {}): Promise<IntelligenceAutomationCycleResult> {
  const startedAt = nowIso();
  const cycleId = `cycle:${startedAt}`;
  const statePath = args.statePath || DEFAULT_STATE_PATH;
  const registry = await loadAutomationRegistry(args.registryPath);
  const state = await loadAutomationState(statePath);
  const manualTrigger = args.manualTrigger === true;
  const forceFetch = args.forceFetch === true;
  applyPromotedThemes(state);
  if (state.experimentRegistry) hydrateExperimentRegistry(state.experimentRegistry);

  const touchedDatasets = new Set<string>();
  const replayRuns: IntelligenceAutomationCycleResult['replayRuns'] = [];
  const replayRunDetails: HistoricalReplayRun[] = [];
  const promotedThemes: string[] = [];
  const candidateThemes: string[] = [];
  const registeredDatasets: string[] = [];
  const enabledDatasets = registry.datasets.filter((dataset) => dataset.enabled);
  const datasetSummaryMap = new Map(
    (await listHistoricalDatasets(registry.defaults.dbPath).catch(() => []))
      .map((summary) => [summary.datasetId, summary] as const),
  );
  const nowMs = Date.now();
  let completedDatasets = 0;

  updateActiveCycle(state, {
    id: cycleId,
    status: 'running',
    startedAt,
    completedAt: null,
    stage: 'boot',
    datasetId: null,
    totalDatasets: enabledDatasets.length,
    completedDatasets: 0,
    touchedDatasets: [],
    lastError: null,
    progressPct: enabledDatasets.length > 0 ? 0 : 100,
  });
  await flushAutomationState(state, statePath, registry.defaults.retentionDays);

  try {
    for (const dataset of enabledDatasets) {
    const datasetState = getDatasetState(state, dataset.id);
    updateActiveCycle(state, {
      stage: 'dataset:ready',
      datasetId: dataset.id,
      completedDatasets,
      touchedDatasets: Array.from(touchedDatasets),
    });
    if (!manualTrigger && datasetState.nextEligibleAt && asTs(datasetState.nextEligibleAt) > nowMs) {
      completedDatasets += 1;
      updateActiveCycle(state, {
        stage: 'dataset:scheduled',
        datasetId: dataset.id,
        completedDatasets,
        touchedDatasets: Array.from(touchedDatasets),
      });
      await flushAutomationState(state, statePath, registry.defaults.retentionDays);
      continue;
    }
    const schedule = {
      fetchEveryMinutes: Number(dataset.schedule?.fetchEveryMinutes) || registry.defaults.fetchEveryMinutes,
      replayEveryMinutes: Number(dataset.schedule?.replayEveryMinutes) || registry.defaults.replayEveryMinutes,
      walkForwardLocalHour: Number(dataset.schedule?.walkForwardLocalHour) || registry.defaults.walkForwardLocalHour,
      themeDiscoveryEveryMinutes: Number(dataset.schedule?.themeDiscoveryEveryMinutes) || registry.defaults.themeDiscoveryEveryMinutes,
    };

    const releaseDatasetLock = await acquireLock(`dataset:${dataset.id}`, registry.defaults.lockTtlMinutes);
    if (!releaseDatasetLock) {
      appendRun(state, {
        id: `${dataset.id}:dataset-lock:${startedAt}`,
        datasetId: dataset.id,
        kind: 'fetch',
        status: 'skipped',
        startedAt,
        completedAt: nowIso(),
        attempts: 0,
        detail: 'Dataset cycle skipped because another worker holds the lock.',
      });
      completedDatasets += 1;
      updateActiveCycle(state, {
        stage: 'dataset:locked',
        datasetId: dataset.id,
        completedDatasets,
        touchedDatasets: Array.from(touchedDatasets),
      });
      await flushAutomationState(state, statePath, registry.defaults.retentionDays);
      continue;
    }

    try {
      touchedDatasets.add(dataset.id);
      let datasetSummary = datasetSummaryMap.get(dataset.id) || null;
      updateActiveCycle(state, {
        stage: 'dataset:running',
        datasetId: dataset.id,
        completedDatasets,
        touchedDatasets: Array.from(touchedDatasets),
      });
      datasetState.nextEligibleAt = null;
      let latestArtifactPath = datasetState.artifacts[datasetState.artifacts.length - 1] || null;
      const latestArtifactEmpty = await artifactLooksEmpty(latestArtifactPath);
      const fetchDue = !latestArtifactPath
        || latestArtifactEmpty
        || forceFetch
        || shouldRunEvery(datasetState.lastFetchAt, schedule.fetchEveryMinutes, nowMs);
      if (fetchDue) {
        updateActiveCycle(state, {
          stage: 'dataset:fetch',
          datasetId: dataset.id,
          completedDatasets,
          touchedDatasets: Array.from(touchedDatasets),
        });
        const previousUsableArtifact = await findMostRecentUsableArtifact(datasetState.artifacts);
        latestArtifactPath = await runWithRetry(dataset.id, 'fetch', registry.defaults.maxRetries, async () => {
          const fetchResult = await fetchHistoricalDatasetArtifact(registry, dataset, datasetState.artifacts);
          const artifactPath = fetchResult.artifactPath;
          const artifactEmpty = await artifactLooksEmpty(artifactPath);
          datasetState.lastFetchAt = nowIso();
          if (!datasetState.artifacts.includes(artifactPath)) {
            datasetState.artifacts = [...datasetState.artifacts, artifactPath].slice(-(registry.defaults.artifactRetentionCount * 2));
          }
          if (fetchResult.reusedExisting) {
            appendRun(state, {
              id: `${dataset.id}:fetch-reused:${nowIso()}`,
              datasetId: dataset.id,
              kind: 'fetch',
              status: 'ok',
              startedAt: datasetState.lastFetchAt,
              completedAt: nowIso(),
              attempts: 1,
              detail: `fetch matched retained artifact; reused existing payload ${path.basename(artifactPath)}`,
            });
          }
          if (artifactEmpty && previousUsableArtifact) {
            appendRun(state, {
              id: `${dataset.id}:fetch-retained:${nowIso()}`,
              datasetId: dataset.id,
              kind: 'fetch',
              status: 'skipped',
              startedAt: datasetState.lastFetchAt,
              completedAt: nowIso(),
              attempts: 1,
              detail: 'fetch returned 0 rows; retained the most recent non-empty artifact for downstream import/replay',
            });
            return previousUsableArtifact;
          }
          return artifactPath;
        }, state);
      }

      let importedFreshCorpus = false;
      if (latestArtifactPath && (manualTrigger
        || shouldRunEvery(datasetState.lastImportAt, schedule.fetchEveryMinutes, nowMs)
        || (datasetState.lastFetchAt && asTs(datasetState.lastImportAt) < asTs(datasetState.lastFetchAt)))) {
        updateActiveCycle(state, {
          stage: 'dataset:import',
          datasetId: dataset.id,
          completedDatasets,
          touchedDatasets: Array.from(touchedDatasets),
        });
        const importPlan = await buildArtifactImportPlan({
          dataset,
          latestArtifactPath,
          artifactPaths: datasetState.artifacts,
          existingRawRecordCount: Number(datasetSummary?.rawRecordCount) || 0,
        });
        if (importPlan.importPath) {
          try {
            const result = await runWithRetry(dataset.id, 'import', registry.defaults.maxRetries, async () => {
              const importResult = await processHistoricalDump(String(importPlan.importPath), {
                datasetId: dataset.id,
                provider: dataset.provider,
                dbPath: registry.defaults.dbPath,
                bucketHours: Number(dataset.importOptions?.bucketHours) || registry.defaults.bucketHours,
                warmupFrameCount: Number(dataset.importOptions?.warmupFrameCount) || registry.defaults.warmupFrameCount,
                sourceArtifactPaths: importPlan.sourceArtifactPaths,
                ...dataset.importOptions,
              });
              datasetState.lastImportAt = nowIso();
              datasetState.lastError = null;
              datasetState.consecutiveFailures = 0;
              return importResult;
            }, state);
            importedFreshCorpus = true;
            datasetSummary = {
              ...(datasetSummary || {
                datasetId: dataset.id,
                provider: dataset.provider,
                sourceVersion: null,
                importedAt: nowIso(),
                rawRecordCount: 0,
                frameCount: 0,
                warmupFrameCount: 0,
                bucketHours: Number(dataset.importOptions?.bucketHours) || registry.defaults.bucketHours,
                firstValidTime: null,
                lastValidTime: null,
                firstTransactionTime: null,
                lastTransactionTime: null,
                metadata: {},
              }),
              importedAt: nowIso(),
              rawRecordCount: result.rawRecordCount,
              frameCount: result.frameCount,
              warmupFrameCount: result.warmupFrameCount,
              firstValidTime: result.firstValidTime,
              lastValidTime: result.lastValidTime,
              firstTransactionTime: result.firstTransactionTime,
              lastTransactionTime: result.lastTransactionTime,
              metadata: {
                ...(datasetSummary?.metadata || {}),
                currentImportRawRecordCount: result.currentImportRawRecordCount ?? result.rawRecordCount,
                sourceArtifactCount: importPlan.sourceArtifactPaths.length,
                sourceArtifactPaths: importPlan.sourceArtifactPaths.slice(),
                importStrategy: importPlan.strategy,
              },
            };
            datasetSummaryMap.set(dataset.id, datasetSummary);
          } finally {
            await importPlan.cleanup?.();
          }
        } else {
          appendRun(state, {
            id: `${dataset.id}:import-retained:${nowIso()}`,
            datasetId: dataset.id,
            kind: 'import',
            status: 'skipped',
            startedAt: nowIso(),
            completedAt: nowIso(),
            attempts: 1,
            detail: 'import reused the existing historical corpus because the newest artifact was empty and no richer retained artifact bundle was available',
          });
          datasetState.lastError = null;
          datasetState.consecutiveFailures = 0;
        }
        await flushAutomationState(state, statePath, registry.defaults.retentionDays);
      }

      const replayDue = manualTrigger
        || shouldRunEvery(datasetState.lastReplayAt, schedule.replayEveryMinutes, nowMs)
        || (importedFreshCorpus && datasetState.lastImportAt && asTs(datasetState.lastReplayAt) < asTs(datasetState.lastImportAt));
      if (replayDue) {
        updateActiveCycle(state, {
          stage: 'dataset:replay',
          datasetId: dataset.id,
          completedDatasets,
          touchedDatasets: Array.from(touchedDatasets),
        });
        const frames = await loadHistoricalReplayFramesFromDuckDb({
          dbPath: registry.defaults.dbPath,
          datasetId: dataset.id,
          includeWarmup: true,
          maxFrames: Math.max(24, Math.round((Number(dataset.replayOptions?.dedupeWindowHours) || 0) || ((registry.defaults.replayWindowDays * 24) / registry.defaults.bucketHours))),
          latestFirst: true,
          ...dataset.frameLoadOptions,
        });
        const run = await runWithRetry(dataset.id, 'replay', registry.defaults.maxRetries, async () => {
          const replayRun = await runHistoricalReplay(frames, {
            label: `${dataset.label} / scheduled replay`,
            retainLearningState: false,
            warmupFrameCount: Number(dataset.replayOptions?.warmupFrameCount) || registry.defaults.warmupFrameCount,
            horizonsHours: registry.defaults.horizonsHours.slice(),
            ...dataset.replayOptions,
          });
          datasetState.lastReplayAt = nowIso();
          return replayRun;
        }, state);
        replayRuns.push(toReplaySummary(dataset.id, run));
        replayRunDetails.push(run);
        await flushAutomationState(state, statePath, registry.defaults.retentionDays);

        if (manualTrigger || shouldRunEvery(datasetState.lastThemeDiscoveryAt, schedule.themeDiscoveryEveryMinutes, nowMs)) {
          updateActiveCycle(state, {
            stage: 'dataset:theme-discovery',
            datasetId: dataset.id,
            completedDatasets,
            touchedDatasets: Array.from(touchedDatasets),
          });
          const knownThemes = [...listBaseInvestmentThemes(), ...state.promotedThemes.map((entry) => entry.theme)];
          const queue = discoverThemeQueue(frames, knownThemes, state.themeQueue);
          mergeThemeQueue(state, queue.filter((item) => item.datasetIds.includes(dataset.id)));
          datasetState.lastThemeDiscoveryAt = nowIso();
          appendRun(state, {
            id: `${dataset.id}:theme-discovery:${datasetState.lastThemeDiscoveryAt}`,
            datasetId: dataset.id,
            kind: 'theme-discovery',
            status: 'ok',
            startedAt: datasetState.lastThemeDiscoveryAt,
            completedAt: nowIso(),
            attempts: 1,
            detail: `theme discovery queue size=${state.themeQueue.filter((item) => item.status === 'open').length}`,
          });
          await flushAutomationState(state, statePath, registry.defaults.retentionDays);
        }
      }

      if (manualTrigger || shouldRunNightly(datasetState.lastWalkForwardAt, schedule.walkForwardLocalHour)) {
        updateActiveCycle(state, {
          stage: 'dataset:walk-forward',
          datasetId: dataset.id,
          completedDatasets,
          touchedDatasets: Array.from(touchedDatasets),
        });
        const frames = await loadHistoricalReplayFramesFromDuckDb({
          dbPath: registry.defaults.dbPath,
          datasetId: dataset.id,
          includeWarmup: true,
          ...dataset.frameLoadOptions,
        });
        const run = await runWithRetry(dataset.id, 'walk-forward', registry.defaults.maxRetries, async () => {
          const walkForwardRun = await runWalkForwardBacktest(frames, {
            label: `${dataset.label} / scheduled walk-forward`,
            retainLearningState: false,
            warmupFrameCount: Number(dataset.walkForwardOptions?.warmupFrameCount) || registry.defaults.warmupFrameCount,
            horizonsHours: registry.defaults.horizonsHours.slice(),
            ...dataset.walkForwardOptions,
          });
          datasetState.lastWalkForwardAt = nowIso();
          return walkForwardRun;
        }, state);
        replayRuns.push(toReplaySummary(dataset.id, run));
        replayRunDetails.push(run);
        await flushAutomationState(state, statePath, registry.defaults.retentionDays);
      }
      datasetState.consecutiveFailures = 0;
      datasetState.lastError = null;
    } catch (error) {
      datasetState.consecutiveFailures += 1;
      datasetState.lastError = error instanceof Error ? error.message : String(error);
      datasetState.nextEligibleAt = new Date(Date.now() + backoffMsForDataset(
        registry,
        dataset,
        datasetState.consecutiveFailures,
        datasetState.lastError,
      )).toISOString();
      updateActiveCycle(state, {
        stage: 'dataset:error',
        datasetId: dataset.id,
        completedDatasets,
        touchedDatasets: Array.from(touchedDatasets),
        lastError: datasetState.lastError,
      });
    } finally {
      completedDatasets += 1;
      updateActiveCycle(state, {
        stage: 'dataset:done',
        datasetId: dataset.id,
        completedDatasets,
        touchedDatasets: Array.from(touchedDatasets),
        lastError: datasetState.lastError || null,
      });
      try {
        await flushAutomationState(state, statePath, registry.defaults.retentionDays);
      } finally {
        await releaseDatasetLock();
      }
    }
  }

  updateActiveCycle(state, {
    stage: 'global:source-automation',
    datasetId: null,
    completedDatasets,
    touchedDatasets: Array.from(touchedDatasets),
  });
  const sourceAutomation = await runWithRetry('global', 'source-automation', Math.max(1, registry.defaults.maxRetries - 1), async () => (
    runSourceAutomationSweep(registry.sourceAutomation)
  ), state);
  await flushAutomationState(state, statePath, registry.defaults.retentionDays);

  if (manualTrigger || shouldRunEvery(state.lastKeywordLifecycleAt, registry.defaults.keywordLifecycleEveryMinutes, nowMs)) {
    updateActiveCycle(state, {
      stage: 'global:keyword-lifecycle',
      datasetId: null,
      completedDatasets,
      touchedDatasets: Array.from(touchedDatasets),
    });
    const keywordFrames = existsSync(registry.defaults.dbPath)
      ? await loadHistoricalReplayFramesFromDuckDb({
        dbPath: registry.defaults.dbPath,
        includeWarmup: true,
        maxFrames: 180,
        latestFirst: true,
      }).catch(() => [])
      : [];
    const keywordSeed = await runWithRetry('global', 'keyword-lifecycle', Math.max(1, registry.defaults.maxRetries - 1), async () => {
      const seeded = keywordFrames.length > 0
        ? await seedKeywordRegistryFromFrames(keywordFrames)
        : { candidateCount: 0, relationCount: 0 };
      await reviewKeywordRegistryLifecycle();
      await refreshKeywordCanonicalMappings(90);
      state.lastKeywordLifecycleAt = nowIso();
      return seeded;
    }, state);
    appendRun(state, {
      id: `global:keyword-seed:${state.lastKeywordLifecycleAt}`,
      datasetId: 'global',
      kind: 'keyword-lifecycle',
      status: 'ok',
      startedAt: state.lastKeywordLifecycleAt || nowIso(),
      completedAt: nowIso(),
      attempts: 1,
      detail: `seeded ${keywordSeed.candidateCount} candidates and ${keywordSeed.relationCount} relations from historical frames`,
    });
    await flushAutomationState(state, statePath, registry.defaults.retentionDays);
  }

  reviewThemeQueueState(state, registry);

  const knownThemes = [...listBaseInvestmentThemes(), ...state.promotedThemes.map((entry) => entry.theme)];
  let promotionsToday = state.promotedThemes.filter((entry) => sameLocalDay(entry.promotedAt, nowIso())).length;
  updateActiveCycle(state, {
    stage: 'global:theme-promotion',
    datasetId: null,
    completedDatasets,
    touchedDatasets: Array.from(touchedDatasets),
  });
  for (const queueItem of state.themeQueue
    .filter((item) => item.status === 'open' && item.signalScore >= registry.themeAutomation.minDiscoveryScore)
    .sort((a, b) => themeQueuePriorityScore(b, state.themeQueue) - themeQueuePriorityScore(a, state.themeQueue) || b.signalScore - a.signalScore)
    .slice(0, 3)) {
    if (registry.themeAutomation.mode === 'manual') break;
    const releaseThemeLock = await acquireLock(`theme:${queueItem.topicKey}`, registry.defaults.lockTtlMinutes);
    if (!releaseThemeLock) continue;
    try {
      const proposal = await runWithRetry(queueItem.topicKey, 'theme-proposer', Math.max(1, registry.defaults.maxRetries - 1), async () => (
        proposeThemeWithCodex(queueItem, knownThemes)
      ), state);
      if (!proposal) continue;
      queueItem.status = 'proposed';
      queueItem.proposedThemeId = proposal.id;
      queueItem.updatedAt = nowIso();

      if (autoPromoteTheme(proposal, queueItem, registry, state, knownThemes, promotionsToday)) {
        const promoted = {
          id: proposal.id,
          sourceTopicKey: queueItem.topicKey,
          promotedAt: nowIso(),
          confidence: proposal.confidence,
          autoPromoted: true,
          theme: buildThemeDefinitionFromProposal(proposal),
        } satisfies PromotedThemeState;
        state.promotedThemes = [
          ...state.promotedThemes.filter((entry) => entry.id !== promoted.id),
          promoted,
        ];
        queueItem.status = 'promoted';
        queueItem.promotedThemeId = proposal.id;
        queueItem.updatedAt = nowIso();
        knownThemes.push(promoted.theme);
        promotedThemes.push(promoted.id);
        promotionsToday += 1;
      }
      await flushAutomationState(state, statePath, registry.defaults.retentionDays);
    } finally {
      await releaseThemeLock();
    }
  }

  applyPromotedThemes(state);

  const replayTriggeredByTheme = new Set<string>();
  updateActiveCycle(state, {
    stage: 'global:theme-refresh',
    datasetId: null,
    completedDatasets,
    touchedDatasets: Array.from(touchedDatasets),
  });
  for (const promotedThemeId of promotedThemes) {
    const relatedQueueItem = state.themeQueue.find((item) => item.promotedThemeId === promotedThemeId);
    for (const datasetId of relatedQueueItem?.datasetIds || []) {
      if (replayTriggeredByTheme.has(datasetId)) continue;
      const dataset = enabledDatasets.find((entry) => entry.id === datasetId);
      if (!dataset) continue;
      const frames = await loadHistoricalReplayFramesFromDuckDb({
        dbPath: registry.defaults.dbPath,
        datasetId,
        includeWarmup: true,
        ...dataset.frameLoadOptions,
      });
      const rerun = await runWithRetry(datasetId, 'replay', registry.defaults.maxRetries, async () => {
        const replayRun = await runHistoricalReplay(frames, {
          label: `${dataset.label} / theme-refresh replay`,
          retainLearningState: false,
          warmupFrameCount: Number(dataset.replayOptions?.warmupFrameCount) || registry.defaults.warmupFrameCount,
          horizonsHours: registry.defaults.horizonsHours.slice(),
          ...dataset.replayOptions,
        });
        const datasetState = getDatasetState(state, datasetId);
        datasetState.lastReplayAt = nowIso();
        return replayRun;
      }, state);
      replayRuns.push(toReplaySummary(datasetId, rerun));
      replayRunDetails.push(rerun);
      replayTriggeredByTheme.add(datasetId);
      await flushAutomationState(state, statePath, registry.defaults.retentionDays);
    }
  }

  updateActiveCycle(state, {
    stage: 'global:candidate-expansion',
    datasetId: null,
    completedDatasets,
    touchedDatasets: Array.from(touchedDatasets),
  });
  const candidateExpansion = await runCandidateExpansionSweep({ registry, state });
  candidateThemes.push(...candidateExpansion.themeIds);
  await flushAutomationState(state, statePath, registry.defaults.retentionDays);

  if (candidateExpansion.acceptedAny) {
    updateActiveCycle(state, {
      stage: 'global:candidate-refresh',
      datasetId: null,
      completedDatasets,
      touchedDatasets: Array.from(touchedDatasets),
    });
    for (const dataset of enabledDatasets) {
      if (replayTriggeredByTheme.has(dataset.id)) continue;
      const frames = await loadHistoricalReplayFramesFromDuckDb({
        dbPath: registry.defaults.dbPath,
        datasetId: dataset.id,
        includeWarmup: true,
        ...dataset.frameLoadOptions,
      });
      const rerun = await runWithRetry(dataset.id, 'replay', registry.defaults.maxRetries, async () => {
        const replayRun = await runHistoricalReplay(frames, {
          label: `${dataset.label} / candidate-refresh replay`,
          retainLearningState: false,
          warmupFrameCount: Number(dataset.replayOptions?.warmupFrameCount) || registry.defaults.warmupFrameCount,
          horizonsHours: registry.defaults.horizonsHours.slice(),
          ...dataset.replayOptions,
        });
        const datasetState = getDatasetState(state, dataset.id);
        datasetState.lastReplayAt = nowIso();
        return replayRun;
      }, state);
      replayRuns.push(toReplaySummary(dataset.id, rerun));
      replayRunDetails.push(rerun);
      await flushAutomationState(state, statePath, registry.defaults.retentionDays);
    }
  }

  updateActiveCycle(state, {
    stage: 'global:dataset-discovery',
    datasetId: null,
    completedDatasets,
    touchedDatasets: Array.from(touchedDatasets),
  });
  const datasetDiscovery = await runDatasetDiscoverySweep({
    registry,
    state,
    registryPath: args.registryPath,
  });
  registeredDatasets.push(...datasetDiscovery.registered.map((item) => item.id));
  await flushAutomationState(state, statePath, registry.defaults.retentionDays);

  let tuningAction: IntelligenceAutomationCycleResult['tuningAction'] = 'idle';
  if (registry.experimentAutomation.enabled && (manualTrigger || shouldRunEvery(state.lastSelfTuningAt, registry.experimentAutomation.everyMinutes))) {
    updateActiveCycle(state, {
      stage: 'global:self-tuning',
      datasetId: null,
      completedDatasets,
      touchedDatasets: Array.from(touchedDatasets),
    });
    const latestSnapshot = await getInvestmentIntelligenceSnapshot();
    const fallbackRuns = replayRunDetails.length > 0 ? replayRunDetails : await listHistoricalReplayRuns(6);
    const tuned = runSelfTuningCycle({
      snapshot: latestSnapshot,
      replayRuns: fallbackRuns,
    });
    state.experimentRegistry = tuned;
    state.lastSelfTuningAt = nowIso();
    tuningAction = tuned.history[tuned.history.length - 1]?.action || 'observe';
    appendRun(state, {
      id: `global:self-tuning:${state.lastSelfTuningAt}`,
      datasetId: null,
      kind: 'self-tuning',
      status: 'ok',
      startedAt: state.lastSelfTuningAt,
      completedAt: nowIso(),
      attempts: 1,
      detail: `score=${tuned.lastScore.toFixed(1)} action=${tuningAction}`,
    });
    await flushAutomationState(state, statePath, registry.defaults.retentionDays);
  }

  updateActiveCycle(state, {
    stage: 'global:retention',
    datasetId: null,
    completedDatasets,
    touchedDatasets: Array.from(touchedDatasets),
  });
  for (const dataset of enabledDatasets) {
    const retainedArtifacts = await pruneArtifacts(
      path.resolve(registry.defaults.artifactDir, dataset.id),
      registry.defaults.artifactRetentionCount,
      registry.defaults.retentionDays,
    );
    getDatasetState(state, dataset.id).artifacts = retainedArtifacts;
  }
  updateActiveCycle(state, {
    status: 'idle',
    completedAt: nowIso(),
    stage: 'completed',
    datasetId: null,
    completedDatasets: enabledDatasets.length,
    touchedDatasets: Array.from(touchedDatasets),
    progressPct: 100,
    lastError: null,
  });
  await flushAutomationState(state, statePath, registry.defaults.retentionDays);

  return {
    startedAt,
    completedAt: nowIso(),
    datasetCount: enabledDatasets.length,
    touchedDatasets: Array.from(touchedDatasets),
    replayRuns,
    ...(args.returnRunDetails ? { replayRunDetails } : {}),
    promotedThemes,
    candidateThemes,
    registeredDatasets,
    tuningAction,
    sourceAutomation,
    queueOpenCount: state.themeQueue.filter((item) => item.status === 'open').length,
  };
  } catch (error) {
    await markActiveCycleFailed({
      state,
      statePath,
      retentionDays: registry.defaults.retentionDays,
      error,
      completedDatasets,
      touchedDatasets: Array.from(touchedDatasets),
    });
    throw error;
  }
}

export async function getIntelligenceAutomationStatus(args: {
  registryPath?: string;
  statePath?: string;
} = {}): Promise<{ registry: IntelligenceAutomationRegistry; state: IntelligenceAutomationState }> {
  const [registry, state] = await Promise.all([
    loadAutomationRegistry(args.registryPath),
    loadAutomationState(args.statePath),
  ]);
  return { registry, state };
}

export async function runIntelligenceAutomationWorker(args: {
  registryPath?: string;
  statePath?: string;
  pollIntervalMinutes?: number;
  once?: boolean;
} = {}): Promise<void> {
  const intervalMs = Math.max(1, Math.round(args.pollIntervalMinutes || 5)) * 60_000;
  do {
    await runIntelligenceAutomationCycle({
      registryPath: args.registryPath,
      statePath: args.statePath,
    });
    if (args.once) return;
    await sleep(intervalMs);
  } while (true);
}
