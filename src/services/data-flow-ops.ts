import {
  buildCoverageOpsSnapshot,
  mergeCoverageLedgerSnapshots,
  type CoverageOpsDatasetStatus,
  type CoverageOpsSnapshot,
} from './coverage-ledger';
import { listHistoricalDatasetsRemote } from './historical-control';
import { getBacktestOpsSnapshot, type BacktestOpsSnapshot } from './historical-intelligence';
import {
  getIntelligenceAutomationStatusRemote,
  getLocalAutomationOpsSnapshotRemote,
  getLocalRuntimeObservabilityRemote,
  type LocalAutomationOpsSnapshotPayload,
  type LocalRuntimeObservabilityPayload,
  type RemoteAutomationDatasetRegistryEntry,
  type RemoteAutomationDatasetState,
  type RemoteAutomationDefaults,
  type RemoteAutomationStatusPayload,
} from './intelligence-automation-remote';
import { getInvestmentIntelligenceSnapshot, type InvestmentIntelligenceSnapshot } from './investment-intelligence';
import type { HistoricalDatasetSummary } from './importer/historical-stream-worker';
import { getReplayAdaptationSnapshot, type ReplayAdaptationSnapshot } from './replay-adaptation';

export type DataFlowOpsStatusTone = 'ready' | 'watch' | 'degraded' | 'blocked';

export interface DataFlowOpsCheck {
  id: string;
  label: string;
  status: DataFlowOpsStatusTone;
  detail: string;
}

export interface DataFlowOpsIssue {
  id: string;
  status: DataFlowOpsStatusTone;
  title: string;
  detail: string;
  datasetId?: string | null;
  suggestion?: string;
}

export interface DataFlowOpsDatasetRow {
  datasetId: string;
  label: string;
  provider: string;
  enabled: boolean;
  status: DataFlowOpsStatusTone;
  stageLabel: string;
  progressPct: number;
  pipelineLagMinutes: number | null;
  fetchLagMinutes: number | null;
  replayLagMinutes: number | null;
  themeLagMinutes: number | null;
  rawRecordCount: number;
  frameCount: number;
  warmupFrameCount: number;
  importedAt: string | null;
  lastFetchAt: string | null;
  lastImportAt: string | null;
  lastReplayAt: string | null;
  lastWalkForwardAt: string | null;
  lastThemeDiscoveryAt: string | null;
  nextEligibleAt: string | null;
  consecutiveFailures: number;
  lastError: string | null;
  artifactCount: number;
  artifactRetentionCount: number;
  retentionDays: number;
  retentionPressurePct: number;
  coverageDensity: number;
  completenessScore: number;
  knowledgeLagHours: number;
  gapRatio: number;
  rateLimitLossEstimate: number;
  firstValidTime: string | null;
  lastValidTime: string | null;
  firstTransactionTime: string | null;
  lastTransactionTime: string | null;
  blockers: string[];
  suggestedFix: string;
}

export interface DataFlowOpsOverview {
  status: DataFlowOpsStatusTone;
  snapshotLagMinutes: number | null;
  readyDatasets: number;
  watchDatasets: number;
  degradedDatasets: number;
  blockedDatasets: number;
  staleDatasets: number;
  totalArtifacts: number;
  retentionPressurePct: number;
  latestCycleAt: string | null;
  queueDepth: number;
  issuesCount: number;
}

export interface DataFlowOpsCurrentSnapshot {
  generatedAt: string | null;
  status: DataFlowOpsStatusTone;
  lagMinutes: number | null;
  directMappings: number;
  ideaCards: number;
  trackedIdeas: number;
  coverageDensity: number;
  completenessScore: number;
  summary: string;
}

export interface DataFlowOpsRetention {
  retentionDays: number;
  artifactRetentionCount: number;
  totalArtifacts: number;
  datasetsWithArtifacts: number;
  pressuredDatasets: number;
}

export interface DataFlowOpsPipeline {
  source: 'local-ops' | 'automation-status' | 'derived';
  sampledAt: string | null;
  latestCycleAt: string | null;
  runsCount: number;
  openThemeQueueDepth: number;
  datasetProposalDepth: number;
  nextEligibleAt: string | null;
  maxConsecutiveFailures: number;
  lastError: string | null;
  activeCycleStatus: 'idle' | 'running' | 'error';
  activeStage: string | null;
  activeDatasetId: string | null;
  activeProgressPct: number | null;
  heartbeatLagMinutes: number | null;
}

export interface DataFlowOpsSnapshot {
  generatedAt: string;
  overview: DataFlowOpsOverview;
  currentSnapshot: DataFlowOpsCurrentSnapshot;
  retention: DataFlowOpsRetention;
  pipeline: DataFlowOpsPipeline;
  checks: DataFlowOpsCheck[];
  issues: DataFlowOpsIssue[];
  datasets: DataFlowOpsDatasetRow[];
  recentRuns: Array<{
    kind: string;
    status: 'ok' | 'error' | 'skipped';
    datasetId: string | null;
    completedAt: string;
    detail: string;
  }>;
  coverage: CoverageOpsSnapshot;
  backtestOps: BacktestOpsSnapshot | null;
  automation: RemoteAutomationStatusPayload | null;
  localOps: LocalAutomationOpsSnapshotPayload | null;
  observability: LocalRuntimeObservabilityPayload | null;
  intelligence: InvestmentIntelligenceSnapshot | null;
  replayAdaptation: ReplayAdaptationSnapshot | null;
  historicalDatasets: HistoricalDatasetSummary[];
}

export interface DataFlowOpsSnapshotOptions {
  forceRefresh?: boolean;
  maxAgeMs?: number;
}

export type DataFlowOpsSnapshotListener = (snapshot: DataFlowOpsSnapshot) => void;

const DATA_FLOW_OPS_CACHE_MAX_AGE_MS = 12_000;
let cachedSnapshot: DataFlowOpsSnapshot | null = null;
let cachedSnapshotAt = 0;
let inFlightSnapshot: Promise<DataFlowOpsSnapshot> | null = null;
const snapshotListeners = new Set<DataFlowOpsSnapshotListener>();

function nowIso(): string {
  return new Date().toISOString();
}

function asTs(value?: string | null): number {
  if (!value) return 0;
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? parsed : 0;
}

function minutesSince(value?: string | null): number | null {
  const ts = asTs(value);
  if (!ts) return null;
  return Math.max(0, Math.round((Date.now() - ts) / 60_000));
}

function average(values: number[]): number {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function latestTimestamp(...values: Array<string | null | undefined>): string | null {
  const ranked = values.filter(Boolean).sort((left, right) => asTs(right) - asTs(left));
  return ranked[0] || null;
}

function finiteNumberOrNull(value: unknown): number | null {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function statusRank(status: DataFlowOpsStatusTone): number {
  return status === 'blocked' ? 3 : status === 'degraded' ? 2 : status === 'watch' ? 1 : 0;
}

function pickWorseStatus(left: DataFlowOpsStatusTone, right: DataFlowOpsStatusTone): DataFlowOpsStatusTone {
  return statusRank(right) > statusRank(left) ? right : left;
}

function nonEmpty(value: unknown): string | null {
  const text = String(value || '').trim();
  return text || null;
}

function inferDatasetLabel(
  datasetId: string,
  registryRecord?: RemoteAutomationDatasetRegistryEntry | null,
  summary?: HistoricalDatasetSummary | null,
): string {
  const metadataLabel = nonEmpty(summary?.metadata?.label);
  return registryRecord?.label || metadataLabel || datasetId;
}

function inferProvider(
  registryRecord?: RemoteAutomationDatasetRegistryEntry | null,
  summary?: HistoricalDatasetSummary | null,
  coverage?: CoverageOpsDatasetStatus | null,
): string {
  return registryRecord?.provider || summary?.provider || coverage?.provider || 'unknown';
}

function classifySnapshotStatus(lagMinutes: number | null): DataFlowOpsStatusTone {
  if (lagMinutes == null) return 'blocked';
  if (lagMinutes <= 20) return 'ready';
  if (lagMinutes <= 90) return 'watch';
  return 'degraded';
}

function deriveDatasetStageLabel(args: {
  enabled: boolean;
  state?: RemoteAutomationDatasetState | null;
  summary?: HistoricalDatasetSummary | null;
  hasError: boolean;
}): string {
  if (args.hasError) return 'blocked';
  if (args.enabled && !args.state?.lastFetchAt) return 'awaiting fetch';
  if ((args.summary?.rawRecordCount || 0) > 0 && !args.state?.lastImportAt) return 'awaiting import';
  if ((args.summary?.frameCount || 0) > 0 && !args.state?.lastReplayAt) return 'awaiting replay';
  if (args.enabled && !args.state?.lastWalkForwardAt) return 'awaiting walk-forward';
  if (args.enabled && !args.state?.lastThemeDiscoveryAt) return 'awaiting discovery';
  if (args.state?.nextEligibleAt && asTs(args.state.nextEligibleAt) > Date.now()) return 'scheduled';
  if (args.summary || args.state) return 'monitoring';
  return 'untracked';
}

function deriveDatasetProgressPct(state?: RemoteAutomationDatasetState | null): number {
  const steps = [
    Boolean(state?.lastFetchAt),
    Boolean(state?.lastImportAt),
    Boolean(state?.lastReplayAt),
    Boolean(state?.lastWalkForwardAt),
    Boolean(state?.lastThemeDiscoveryAt),
  ];
  return Math.round((steps.filter(Boolean).length / steps.length) * 100);
}

function deriveDatasetBlockers(args: {
  provider: string;
  state?: RemoteAutomationDatasetState | null;
  enabled: boolean;
  fetchLagMinutes: number | null;
  replayLagMinutes: number | null;
  themeLagMinutes: number | null;
  defaults: RemoteAutomationDefaults;
  summary?: HistoricalDatasetSummary | null;
  coverage?: CoverageOpsDatasetStatus | null;
  artifactCount: number;
}): string[] {
  const blockers: string[] = [];
  const error = nonEmpty(args.state?.lastError);
  if (error) blockers.push(error);
  if (args.enabled && !args.state?.lastFetchAt) blockers.push('No successful fetch recorded yet.');
  if ((args.summary?.rawRecordCount || 0) > 0 && !args.state?.lastImportAt) blockers.push('Raw records exist but import stage has not completed.');
  if ((args.summary?.frameCount || 0) > 0 && !args.state?.lastReplayAt) blockers.push('Replay frames exist but replay has not completed.');
  if (args.fetchLagMinutes != null && args.fetchLagMinutes > Math.max(60, args.defaults.fetchEveryMinutes * 3)) {
    blockers.push(`Fetch stage is late by ${args.fetchLagMinutes}m.`);
  }
  if (args.replayLagMinutes != null && args.replayLagMinutes > Math.max(180, args.defaults.replayEveryMinutes * 3)) {
    blockers.push(`Replay stage is late by ${args.replayLagMinutes}m.`);
  }
  if (args.themeLagMinutes != null && args.themeLagMinutes > Math.max(240, args.defaults.themeDiscoveryEveryMinutes * 3)) {
    blockers.push(`Theme discovery is stale by ${args.themeLagMinutes}m.`);
  }
  if ((args.coverage?.completenessScore || 0) < 35) blockers.push('Coverage completeness is low.');
  if ((args.coverage?.gapRatio || 0) >= 0.65) blockers.push('Coverage gap ratio is elevated.');
  if (args.artifactCount > args.defaults.artifactRetentionCount) blockers.push('Retention pressure exceeds target artifact count.');
  return blockers;
}

function suggestDatasetFix(args: {
  provider: string;
  state?: RemoteAutomationDatasetState | null;
  blockers: string[];
  fetchLagMinutes: number | null;
  replayLagMinutes: number | null;
  summary?: HistoricalDatasetSummary | null;
  coverage?: CoverageOpsDatasetStatus | null;
  artifactCount: number;
  defaults: RemoteAutomationDefaults;
}): string {
  const error = String(args.state?.lastError || '').toLowerCase();
  if (/credential|token|oauth|auth|password|forbidden|unauthorized/.test(error)) {
    return `Re-check ${args.provider.toUpperCase()} credentials in Access Center or Codex Ops, then rerun the dataset cycle.`;
  }
  if (/timeout|timed out|rate limit|429|temporar/.test(error)) {
    return 'Provider looks rate-limited or slow; wait for next eligible window, or reduce fetch scope and retry.';
  }
  if ((args.summary?.rawRecordCount || 0) > 0 && !args.state?.lastImportAt) {
    return 'Raw history is present but not imported; inspect import settings and rerun normalization/import.';
  }
  if ((args.summary?.frameCount || 0) > 0 && !args.state?.lastReplayAt) {
    return 'Frames are materialized but replay is missing; rerun replay/walk-forward for this dataset.';
  }
  if (args.fetchLagMinutes != null && args.fetchLagMinutes > Math.max(60, args.defaults.fetchEveryMinutes * 3)) {
    return 'Scheduler looks late on fetch; verify sidecar health, automation last cycle, and provider reachability.';
  }
  if (args.replayLagMinutes != null && args.replayLagMinutes > Math.max(180, args.defaults.replayEveryMinutes * 3)) {
    return 'Replay cadence is behind; re-run the historical job and inspect recent automation errors.';
  }
  if ((args.coverage?.completenessScore || 0) < 35 || (args.coverage?.gapRatio || 0) >= 0.65) {
    if (String(args.provider || '').toLowerCase().includes('acled')) {
      return 'Coverage is thin; this is a corpus-depth issue rather than an ACLED login failure. Expand the date window, add supporting sources, or wait for more events to accumulate.';
    }
    return 'Coverage is thin; expand source family coverage or review transaction-time/bucket settings for this dataset.';
  }
  if (args.artifactCount > args.defaults.artifactRetentionCount) {
    return 'Retention exceeds target; prune stale artifacts or lower retention settings if disk pressure matters.';
  }
  if (args.blockers.length > 0) {
    return 'Inspect the latest blocker details and rerun the next missing stage only after the upstream error is cleared.';
  }
  return 'No immediate fix required; continue monitoring freshness and coverage drift.';
}

function deriveDatasetStatus(args: {
  enabled: boolean;
  state?: RemoteAutomationDatasetState | null;
  defaults: RemoteAutomationDefaults;
  coverage?: CoverageOpsDatasetStatus | null;
  blockers: string[];
  fetchLagMinutes: number | null;
  replayLagMinutes: number | null;
  themeLagMinutes: number | null;
}): DataFlowOpsStatusTone {
  if (args.blockers.some((blocker) => /credential|oauth|password|auth|No successful fetch|blocked/i.test(blocker))) {
    return 'blocked';
  }
  if ((args.state?.consecutiveFailures || 0) >= Math.max(2, args.defaults.maxRetries)) {
    return 'blocked';
  }
  if (
    (args.fetchLagMinutes != null && args.fetchLagMinutes > Math.max(180, args.defaults.fetchEveryMinutes * 6))
    || (args.replayLagMinutes != null && args.replayLagMinutes > Math.max(360, args.defaults.replayEveryMinutes * 6))
    || (args.themeLagMinutes != null && args.themeLagMinutes > Math.max(480, args.defaults.themeDiscoveryEveryMinutes * 6))
    || (args.coverage?.completenessScore || 0) < 25
  ) {
    return 'degraded';
  }
  if (
    args.blockers.length > 0
    || (args.fetchLagMinutes != null && args.fetchLagMinutes > Math.max(60, args.defaults.fetchEveryMinutes * 3))
    || (args.replayLagMinutes != null && args.replayLagMinutes > Math.max(180, args.defaults.replayEveryMinutes * 3))
    || (args.themeLagMinutes != null && args.themeLagMinutes > Math.max(240, args.defaults.themeDiscoveryEveryMinutes * 3))
    || (args.coverage?.completenessScore || 0) < 60
    || (args.coverage?.gapRatio || 0) > 0.35
  ) {
    return 'watch';
  }
  return args.enabled ? 'ready' : 'watch';
}

function issueFromDataset(row: DataFlowOpsDatasetRow): DataFlowOpsIssue | null {
  if (row.status === 'ready') return null;
  return {
    id: `dataset:${row.datasetId}`,
    status: row.status,
    title: `${row.label} is ${row.status}`,
    detail: row.blockers[0] || `${row.stageLabel} with ${row.progressPct}% pipeline completion.`,
    datasetId: row.datasetId,
    suggestion: row.suggestedFix,
  };
}

function buildChecks(args: {
  intelligence: InvestmentIntelligenceSnapshot | null;
  automation: RemoteAutomationStatusPayload | null;
  localOps: LocalAutomationOpsSnapshotPayload | null;
  observability: LocalRuntimeObservabilityPayload | null;
  overview: DataFlowOpsOverview;
  retention: DataFlowOpsRetention;
  pipeline: DataFlowOpsPipeline;
}): DataFlowOpsCheck[] {
  const snapshotLag = args.overview.snapshotLagMinutes;
  const snapshotStatus = classifySnapshotStatus(snapshotLag);
  const serviceSummary = args.localOps?.serviceStatus?.summary;
  const degradedServices = Number(serviceSummary?.degraded || 0) + Number(serviceSummary?.outage || 0);
  const missingRequiredKeys = args.localOps?.credentials?.missingRequiredKeys || [];
  const cycleHeartbeatStatus: DataFlowOpsStatusTone =
    args.pipeline.activeCycleStatus === 'error'
      ? 'blocked'
      : args.pipeline.activeCycleStatus === 'running'
        ? (args.pipeline.heartbeatLagMinutes != null && args.pipeline.heartbeatLagMinutes > 15 ? 'degraded' : 'ready')
        : 'watch';
  return [
    {
      id: 'snapshot',
      label: 'Current snapshot freshness',
      status: snapshotStatus,
      detail: snapshotLag == null
        ? 'No current investment snapshot is available.'
        : `Latest snapshot is ${snapshotLag}m old and contains ${args.intelligence?.ideaCards.length || 0} active idea cards.`,
    },
    {
      id: 'automation',
      label: 'Historical automation cycle',
      status: args.overview.blockedDatasets > 0 ? 'blocked' : args.overview.degradedDatasets > 0 ? 'degraded' : 'ready',
      detail: args.automation
        ? `${args.overview.queueDepth} queued items, ${args.overview.blockedDatasets} blocked datasets, latest cycle ${args.overview.latestCycleAt ? 'seen' : 'missing'}.`
        : 'Automation status endpoint is unavailable.',
    },
    {
      id: 'cycle-heartbeat',
      label: 'Automation heartbeat',
      status: cycleHeartbeatStatus,
      detail: args.pipeline.activeCycleStatus === 'running'
        ? `Cycle is running at ${args.pipeline.activeStage || 'unknown stage'} (${args.pipeline.activeProgressPct ?? 0}%); heartbeat ${args.pipeline.heartbeatLagMinutes == null ? 'unknown' : `${args.pipeline.heartbeatLagMinutes}m`} ago.`
        : args.pipeline.activeCycleStatus === 'error'
          ? `Latest cycle failed at ${args.pipeline.activeStage || 'unknown stage'}: ${args.pipeline.lastError || 'unknown error'}.`
          : `No active cycle; latest completed cycle ${args.overview.latestCycleAt ? 'is recorded' : 'is missing'}.`,
    },
    {
      id: 'services',
      label: 'Local services',
      status: degradedServices > 0 ? 'watch' : args.localOps ? 'ready' : 'blocked',
      detail: args.localOps
        ? `${Number(serviceSummary?.operational || 0)} operational, ${degradedServices} degraded or outage services reported.`
        : 'Local automation ops snapshot is not reachable.',
    },
    {
      id: 'observability',
      label: 'Runtime observability',
      status: args.observability?.summary?.status || 'blocked',
      detail: args.observability
        ? `Score ${Math.round(Number(args.observability.summary?.observabilityScore || 0))}, ${Number(args.observability.summary?.failingTaskCount || 0)} failing tasks, ${Number(args.observability.summary?.staleTaskCount || 0)} stale tasks, ${Number(args.observability.summary?.unhealthyServices || 0)} unhealthy services.`
        : 'Runtime observability endpoint is not reachable.',
    },
    {
      id: 'retention',
      label: 'Retention pressure',
      status: args.retention.pressuredDatasets > 0 ? 'watch' : 'ready',
      detail: `${args.retention.totalArtifacts} retained artifacts across ${args.retention.datasetsWithArtifacts} datasets; policy keeps ${args.retention.artifactRetentionCount} per dataset for ${args.retention.retentionDays}d.`,
    },
    {
      id: 'credentials',
      label: 'Protected credentials',
      status: missingRequiredKeys.length > 0 ? 'blocked' : 'ready',
      detail: missingRequiredKeys.length > 0
        ? `Missing required keys: ${missingRequiredKeys.join(', ')}.`
        : 'Required provider credentials are present or not needed for currently enabled datasets.',
    },
  ];
}

export function peekCachedDataFlowOpsSnapshot(): DataFlowOpsSnapshot | null {
  return cachedSnapshot;
}

export function invalidateDataFlowOpsSnapshot(): void {
  cachedSnapshot = null;
  cachedSnapshotAt = 0;
}

export function subscribeDataFlowOpsSnapshot(listener: DataFlowOpsSnapshotListener): () => void {
  snapshotListeners.add(listener);
  return () => {
    snapshotListeners.delete(listener);
  };
}

export async function refreshDataFlowOpsSnapshot(
  options: DataFlowOpsSnapshotOptions = {},
): Promise<DataFlowOpsSnapshot> {
  return getDataFlowOpsSnapshot({ ...options, forceRefresh: true });
}

export async function getDataFlowOpsSnapshot(
  options: number | DataFlowOpsSnapshotOptions = {},
): Promise<DataFlowOpsSnapshot> {
  const normalized = typeof options === 'number' ? {} : options;
  const maxAgeMs = Number.isFinite(normalized.maxAgeMs)
    ? Math.max(0, Number(normalized.maxAgeMs))
    : DATA_FLOW_OPS_CACHE_MAX_AGE_MS;
  if (!normalized.forceRefresh && cachedSnapshot && Date.now() - cachedSnapshotAt <= maxAgeMs) {
    return cachedSnapshot;
  }
  if (inFlightSnapshot) return inFlightSnapshot;
  inFlightSnapshot = buildDataFlowOpsSnapshot()
    .then((snapshot) => {
      cachedSnapshot = snapshot;
      cachedSnapshotAt = Date.now();
      for (const listener of snapshotListeners) {
        try {
          listener(snapshot);
        } catch {
          // Keep the shared ops hub resilient even if a panel listener throws.
        }
      }
      return snapshot;
    })
    .finally(() => {
      inFlightSnapshot = null;
    });
  return inFlightSnapshot;
}

async function buildDataFlowOpsSnapshot(): Promise<DataFlowOpsSnapshot> {
  const [automation, localOps, observability, backtestOps, intelligence, replayAdaptation, datasetSummaries] = await Promise.all([
    getIntelligenceAutomationStatusRemote(),
    getLocalAutomationOpsSnapshotRemote(),
    getLocalRuntimeObservabilityRemote(),
    getBacktestOpsSnapshot(8).catch(() => null),
    getInvestmentIntelligenceSnapshot().catch(() => null),
    getReplayAdaptationSnapshot().catch(() => null),
    listHistoricalDatasetsRemote().catch(() => [] as HistoricalDatasetSummary[]),
  ]);

  const defaults: RemoteAutomationDefaults = automation?.registry.defaults || {
    dbPath: '',
    artifactDir: '',
    bucketHours: 6,
    warmupFrameCount: 0,
    replayWindowDays: 30,
    walkForwardWindowDays: 30,
    horizonsHours: [],
    fetchEveryMinutes: 60,
    replayEveryMinutes: 240,
    walkForwardLocalHour: 6,
    themeDiscoveryEveryMinutes: 240,
    keywordLifecycleEveryMinutes: 240,
    maxRetries: 3,
    retentionDays: 30,
    artifactRetentionCount: 24,
    lockTtlMinutes: 20,
  };

  const mergedLedger = mergeCoverageLedgerSnapshots([
    backtestOps?.coverageLedger || null,
    intelligence?.coverageLedger || null,
  ]);
  const coverage = buildCoverageOpsSnapshot({
    ledger: mergedLedger,
    registryDatasets: automation?.registry.datasets || [],
    datasetSummaries,
  });

  const registryById = new Map((automation?.registry.datasets || []).map((dataset) => [dataset.id, dataset]));
  const summaryById = new Map(datasetSummaries.map((summary) => [summary.datasetId, summary]));
  const coverageById = new Map(coverage.datasets.map((dataset) => [dataset.datasetId, dataset]));
  const automationState = automation?.state.datasets || {};
  const datasetIds = Array.from(new Set([
    ...Array.from(registryById.keys()),
    ...Array.from(summaryById.keys()),
    ...Array.from(coverageById.keys()),
    ...Object.keys(automationState),
  ])).sort();

  const datasets = datasetIds.map((datasetId) => {
    const registryRecord = registryById.get(datasetId) || null;
    const summary = summaryById.get(datasetId) || null;
    const coverageDataset = coverageById.get(datasetId) || null;
    const state = automationState[datasetId] || null;
    const label = inferDatasetLabel(datasetId, registryRecord, summary);
    const provider = inferProvider(registryRecord, summary, coverageDataset);
    const artifactCount = Array.isArray(state?.artifacts) ? state.artifacts.length : 0;
    const fetchLagMinutes = minutesSince(state?.lastFetchAt || summary?.importedAt || null);
    const replayLagMinutes = minutesSince(state?.lastReplayAt || null);
    const themeLagMinutes = minutesSince(state?.lastThemeDiscoveryAt || null);
    const pipelineLagMinutes = minutesSince(latestTimestamp(
      state?.lastThemeDiscoveryAt,
      state?.lastWalkForwardAt,
      state?.lastReplayAt,
      state?.lastImportAt,
      state?.lastFetchAt,
      summary?.importedAt || null,
    ));
    const blockers = deriveDatasetBlockers({
      provider,
      state,
      enabled: registryRecord?.enabled === true,
      fetchLagMinutes,
      replayLagMinutes,
      themeLagMinutes,
      defaults,
      summary,
      coverage: coverageDataset,
      artifactCount,
    });
    const status = deriveDatasetStatus({
      enabled: registryRecord?.enabled === true,
      state,
      defaults,
      coverage: coverageDataset,
      blockers,
      fetchLagMinutes,
      replayLagMinutes,
      themeLagMinutes,
    });
    return {
      datasetId,
      label,
      provider,
      enabled: registryRecord?.enabled === true,
      status,
      stageLabel: deriveDatasetStageLabel({
        enabled: registryRecord?.enabled === true,
        state,
        summary,
        hasError: blockers.length > 0 && status === 'blocked',
      }),
      progressPct: deriveDatasetProgressPct(state),
      pipelineLagMinutes,
      fetchLagMinutes,
      replayLagMinutes,
      themeLagMinutes,
      rawRecordCount: summary?.rawRecordCount || coverageDataset?.rawRecordCount || 0,
      frameCount: summary?.frameCount || coverageDataset?.frameCount || 0,
      warmupFrameCount: summary?.warmupFrameCount || coverageDataset?.warmupFrameCount || 0,
      importedAt: summary?.importedAt || null,
      lastFetchAt: state?.lastFetchAt || null,
      lastImportAt: state?.lastImportAt || null,
      lastReplayAt: state?.lastReplayAt || null,
      lastWalkForwardAt: state?.lastWalkForwardAt || null,
      lastThemeDiscoveryAt: state?.lastThemeDiscoveryAt || null,
      nextEligibleAt: state?.nextEligibleAt || null,
      consecutiveFailures: Number(state?.consecutiveFailures || 0),
      lastError: nonEmpty(state?.lastError),
      artifactCount,
      artifactRetentionCount: defaults.artifactRetentionCount,
      retentionDays: defaults.retentionDays,
      retentionPressurePct: defaults.artifactRetentionCount > 0
        ? Math.round((artifactCount / defaults.artifactRetentionCount) * 100)
        : 0,
      coverageDensity: coverageDataset?.coverageDensity || 0,
      completenessScore: coverageDataset?.completenessScore || 0,
      knowledgeLagHours: coverageDataset?.knowledgeLagHours || 0,
      gapRatio: coverageDataset?.gapRatio || 0,
      rateLimitLossEstimate: coverageDataset?.rateLimitLossEstimate || 0,
      firstValidTime: summary?.firstValidTime || coverageDataset?.firstValidTime || null,
      lastValidTime: summary?.lastValidTime || coverageDataset?.lastValidTime || null,
      firstTransactionTime: summary?.firstTransactionTime || coverageDataset?.firstTransactionTime || null,
      lastTransactionTime: summary?.lastTransactionTime || coverageDataset?.lastTransactionTime || null,
      blockers,
      suggestedFix: suggestDatasetFix({
        provider,
        state,
        blockers,
        fetchLagMinutes,
        replayLagMinutes,
        summary,
        coverage: coverageDataset,
        artifactCount,
        defaults,
      }),
    } satisfies DataFlowOpsDatasetRow;
  }).sort((left, right) =>
    statusRank(right.status) - statusRank(left.status)
    || (right.pipelineLagMinutes || 0) - (left.pipelineLagMinutes || 0)
    || right.consecutiveFailures - left.consecutiveFailures
    || left.label.localeCompare(right.label)
  );

  const retention = {
    retentionDays: defaults.retentionDays,
    artifactRetentionCount: defaults.artifactRetentionCount,
    totalArtifacts: datasets.reduce((sum, dataset) => sum + dataset.artifactCount, 0),
    datasetsWithArtifacts: datasets.filter((dataset) => dataset.artifactCount > 0).length,
    pressuredDatasets: datasets.filter((dataset) => dataset.artifactCount > defaults.artifactRetentionCount).length,
  } satisfies DataFlowOpsRetention;

  const currentSnapshotLagMinutes = minutesSince(intelligence?.generatedAt || null);
  const currentSnapshot = {
    generatedAt: intelligence?.generatedAt || null,
    status: classifySnapshotStatus(currentSnapshotLagMinutes),
    lagMinutes: currentSnapshotLagMinutes,
    directMappings: intelligence?.directMappings.length || 0,
    ideaCards: intelligence?.ideaCards.length || 0,
    trackedIdeas: intelligence?.trackedIdeas.length || 0,
    coverageDensity: intelligence?.coverageLedger?.globalCoverageDensity || 0,
    completenessScore: intelligence?.coverageLedger?.globalCompletenessScore || 0,
    summary: intelligence
      ? `${intelligence.ideaCards.length} ideas, ${intelligence.directMappings.length} direct mappings, ${intelligence.trackedIdeas.length} tracked ideas.`
      : 'No current investment snapshot is available.',
  } satisfies DataFlowOpsCurrentSnapshot;

  const localPipelineState = localOps?.automation?.state || null;
  const remotePipelineState = automation?.state || null;
  const useLocalPipeline = Boolean(localPipelineState || localOps?.automation?.lastCycle);
  const selectedPipelineSource = useLocalPipeline ? 'local-ops' : remotePipelineState ? 'automation-status' : 'derived';
  const selectedActiveCycle = useLocalPipeline
    ? localPipelineState?.activeCycle || null
    : remotePipelineState?.activeCycle || null;
  const selectedThemeQueueDepth = useLocalPipeline
    ? Number(localPipelineState?.queue?.openThemeQueueDepth || localPipelineState?.queue?.themeQueueDepth || 0)
    : Number(remotePipelineState?.themeQueue.filter((item) => item.status === 'open').length || 0);
  const selectedDatasetProposalDepth = useLocalPipeline
    ? Number(localPipelineState?.queue?.datasetProposalDepth || 0)
    : Number(remotePipelineState?.datasetProposals.length || 0);
  const selectedLatestCycleAt = useLocalPipeline
    ? localOps?.automation?.lastCycle?.completedAt || localPipelineState?.activeCycle?.completedAt || null
    : latestTimestamp(...(remotePipelineState?.runs || []).slice(-1).map((run) => run.completedAt)) || null;
  const selectedRunsCount = useLocalPipeline
    ? Number(localOps?.automation?.runsCount || 0)
    : Number(remotePipelineState?.runs.length || 0);
  const selectedLastError = useLocalPipeline
    ? nonEmpty(localPipelineState?.lastError)
      || nonEmpty(localOps?.automation?.lastCycle?.status === 'error' ? localOps?.automation?.lastCycle?.detail : null)
    : nonEmpty((remotePipelineState?.runs || []).slice().reverse().find((run) => run.status === 'error')?.detail);
  const selectedSampledAt = useLocalPipeline
    ? latestTimestamp(
      localOps?.timestamp,
      localOps?.serviceStatus?.timestamp,
      localPipelineState?.activeCycle?.heartbeatAt,
      localPipelineState?.activeCycle?.startedAt,
      localOps?.automation?.lastCycle?.completedAt,
    )
    : latestTimestamp(
      remotePipelineState?.updatedAt,
      remotePipelineState?.activeCycle?.heartbeatAt,
      remotePipelineState?.activeCycle?.startedAt,
      selectedLatestCycleAt,
    );

  const pipeline = {
    source: selectedPipelineSource,
    sampledAt: selectedSampledAt,
    latestCycleAt: selectedLatestCycleAt || latestTimestamp(
      ...datasets.flatMap((dataset) => [
        dataset.lastThemeDiscoveryAt,
        dataset.lastWalkForwardAt,
        dataset.lastReplayAt,
        dataset.lastImportAt,
        dataset.lastFetchAt,
      ]),
    ) || null,
    runsCount: selectedRunsCount,
    openThemeQueueDepth: selectedThemeQueueDepth,
    datasetProposalDepth: selectedDatasetProposalDepth,
    nextEligibleAt: useLocalPipeline
      ? localPipelineState?.queue?.nextEligibleAt || latestTimestamp(...datasets.map((dataset) => dataset.nextEligibleAt)) || null
      : latestTimestamp(...datasets.map((dataset) => dataset.nextEligibleAt)) || null,
    maxConsecutiveFailures: Math.max(
      useLocalPipeline ? Number(localPipelineState?.consecutiveFailures || 0) : 0,
      ...datasets.map((dataset) => dataset.consecutiveFailures),
      0,
    ),
    lastError: selectedLastError,
    activeCycleStatus: selectedActiveCycle?.status || 'idle',
    activeStage: nonEmpty(selectedActiveCycle?.stage),
    activeDatasetId: nonEmpty(selectedActiveCycle?.datasetId),
    activeProgressPct: finiteNumberOrNull(selectedActiveCycle?.progressPct),
    heartbeatLagMinutes: minutesSince(selectedActiveCycle?.heartbeatAt || null),
  } satisfies DataFlowOpsPipeline;

  const issues: DataFlowOpsIssue[] = [];
  if (observability?.summary?.status === 'blocked' || observability?.summary?.status === 'degraded') {
    issues.push({
      id: 'observability:runtime',
      status: observability.summary.status,
      title: 'Runtime observability is degraded',
      detail: observability.daemon?.readError
        || `Observability score is ${Math.round(Number(observability.summary.observabilityScore || 0))}; failing tasks ${Number(observability.summary.failingTaskCount || 0)}, stale tasks ${Number(observability.summary.staleTaskCount || 0)}.`,
      suggestion: 'Inspect daemon-state, dashboard health, and local service status before trusting the live signal surface.',
    });
  }
  for (const task of observability?.daemon?.tasks || []) {
    if (task.status === 'ready') continue;
    issues.push({
      id: `observability:task:${task.name}`,
      status: task.status,
      title: `${task.name} is ${task.status}`,
      detail: task.error
        || (task.stale
          ? `Last run was ${task.lagMinutes ?? 'unknown'}m ago.`
          : task.lastRunAt
            ? `Last run recorded at ${task.lastRunAt}.`
            : 'Task has not recorded a successful run yet.'),
      suggestion: task.disabledUntil
        ? `Circuit breaker is open until ${task.disabledUntil}; clear the root cause before rerunning the task.`
        : 'Review the daemon task output and rerun the task after clearing the upstream blocker.',
    });
  }
  if (pipeline.activeCycleStatus === 'error') {
    issues.push({
      id: 'automation:cycle-error',
      status: 'blocked',
      title: 'Automation cycle failed',
      detail: pipeline.lastError || `Latest cycle failed during ${pipeline.activeStage || 'an unknown stage'}.`,
      suggestion: 'Open Data Flow Ops and Codex Ops, inspect the latest pipeline event, and rerun the failed stage after clearing the blocker.',
    });
  } else if (pipeline.activeCycleStatus === 'running' && (pipeline.heartbeatLagMinutes || 0) > 15) {
    issues.push({
      id: 'automation:stalled-heartbeat',
      status: 'degraded',
      title: 'Automation heartbeat looks stale',
      detail: `The active cycle is still marked running at ${pipeline.activeStage || 'unknown stage'}, but the last heartbeat was ${(pipeline.heartbeatLagMinutes || 0)}m ago.`,
      suggestion: 'Check whether the worker is hung or waiting on a slow provider, then refresh the ops snapshot or restart the worker if the stage remains frozen.',
    });
  }
  if (currentSnapshot.status !== 'ready') {
    issues.push({
      id: 'snapshot:freshness',
      status: currentSnapshot.status,
      title: 'Current snapshot is stale',
      detail: currentSnapshot.lagMinutes == null
        ? 'No current snapshot is being produced.'
        : `Current snapshot is ${currentSnapshot.lagMinutes}m old.`,
      suggestion: 'Refresh the live snapshot feed and check whether the automation cycle has stalled or the source pipeline is degraded.',
    });
  }
  for (const blocker of localOps?.blockerReasons || []) {
    issues.push({
      id: `blocker:${blocker}`,
      status: /missing|required|credential|unavailable|blocked/i.test(blocker) ? 'blocked' : 'watch',
      title: 'Local blocker reported',
      detail: blocker,
      suggestion: 'Review Codex Ops / Access Center and clear the blocker before rerunning the affected pipeline stage.',
    });
  }
  datasets
    .map((dataset) => issueFromDataset(dataset))
    .filter((issue): issue is DataFlowOpsIssue => Boolean(issue))
    .forEach((issue) => issues.push(issue));

  const dedupedIssues = issues
    .reduce((buffer, issue) => {
      if (buffer.some((existing) => existing.id === issue.id)) return buffer;
      buffer.push(issue);
      return buffer;
    }, [] as DataFlowOpsIssue[])
    .sort((left, right) =>
      statusRank(right.status) - statusRank(left.status)
      || ((right.datasetId ? 1 : 0) - (left.datasetId ? 1 : 0))
      || left.title.localeCompare(right.title)
    )
    .slice(0, 16);

  const overviewStatus = datasets.reduce<DataFlowOpsStatusTone>((status, dataset) => pickWorseStatus(status, dataset.status), currentSnapshot.status);
  const overview = {
    status: dedupedIssues.some((issue) => issue.status === 'blocked')
      ? 'blocked'
      : dedupedIssues.some((issue) => issue.status === 'degraded')
        ? 'degraded'
        : pickWorseStatus(overviewStatus, (observability?.summary?.status as DataFlowOpsStatusTone) || 'ready'),
    snapshotLagMinutes: currentSnapshotLagMinutes,
    readyDatasets: datasets.filter((dataset) => dataset.status === 'ready').length,
    watchDatasets: datasets.filter((dataset) => dataset.status === 'watch').length,
    degradedDatasets: datasets.filter((dataset) => dataset.status === 'degraded').length,
    blockedDatasets: datasets.filter((dataset) => dataset.status === 'blocked').length,
    staleDatasets: datasets.filter((dataset) => (dataset.pipelineLagMinutes || 0) > Math.max(240, defaults.fetchEveryMinutes * 3)).length,
    totalArtifacts: retention.totalArtifacts,
    retentionPressurePct: datasets.length > 0
      ? Math.round(average(datasets.map((dataset) => dataset.retentionPressurePct)))
      : 0,
    latestCycleAt: pipeline.latestCycleAt,
    queueDepth: pipeline.openThemeQueueDepth + pipeline.datasetProposalDepth,
    issuesCount: dedupedIssues.length,
  } satisfies DataFlowOpsOverview;

  const checks = buildChecks({
    intelligence,
    automation,
    localOps,
    observability,
    overview,
    retention,
    pipeline,
  });

  const recentRuns = (automation?.state.runs || [])
    .slice()
    .sort((left, right) => asTs(right.completedAt) - asTs(left.completedAt))
    .slice(0, 12)
    .map((run) => ({
      kind: run.kind,
      status: run.status,
      datasetId: run.datasetId,
      completedAt: run.completedAt,
      detail: run.detail,
    }));

  return {
    generatedAt: nowIso(),
    overview,
    currentSnapshot,
    retention,
    pipeline,
    checks,
    issues: dedupedIssues,
    datasets,
    recentRuns,
    coverage,
    backtestOps,
    automation,
    localOps,
    observability,
    intelligence,
    replayAdaptation,
    historicalDatasets: datasetSummaries,
  };
}
