import type { HistoricalReplayRun } from './historical-intelligence';

export interface LocalCodexCliStatus {
  available: boolean;
  loggedIn: boolean;
  message: string;
}

export interface RemoteAutomationDatasetRegistryEntry {
  id: string;
  label: string;
  enabled: boolean;
  provider: string;
}

export interface RemoteThemeAutomationPolicy {
  mode: 'manual' | 'guarded-auto' | 'full-auto';
  minDiscoveryScore: number;
  minSampleCount: number;
  minSourceCount: number;
  minCodexConfidence: number;
  maxOverlapWithKnownThemes: number;
}

export interface RemoteDatasetAutomationPolicy {
  enabled: boolean;
  everyMinutes: number;
  codexTopThemesPerCycle: number;
  minProposalScore: number;
  autoRegisterScore: number;
  autoEnableScore: number;
}

export interface RemoteAutomationDefaults {
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
}

export interface RemoteAutomationRegistry {
  defaults: RemoteAutomationDefaults;
  themeAutomation: RemoteThemeAutomationPolicy;
  datasetAutomation: RemoteDatasetAutomationPolicy;
  datasets: RemoteAutomationDatasetRegistryEntry[];
}

export interface RemoteAutomationDatasetState {
  lastFetchAt?: string | null;
  lastImportAt?: string | null;
  lastReplayAt?: string | null;
  lastWalkForwardAt?: string | null;
  lastThemeDiscoveryAt?: string | null;
  nextEligibleAt?: string | null;
  consecutiveFailures: number;
  lastError?: string | null;
  artifacts?: string[];
}

export interface RemotePromotedThemeState {
  id: string;
  sourceTopicKey: string;
  promotedAt: string;
  confidence: number;
  autoPromoted: boolean;
  theme: {
    id: string;
    label: string;
    triggers: string[];
    sectors: string[];
    commodities: string[];
  };
}

export interface RemoteThemeQueueItem {
  id: string;
  topicKey: string;
  label: string;
  status: 'open' | 'proposed' | 'promoted' | 'rejected';
  signalScore: number;
  overlapWithKnownThemes: number;
  sampleCount: number;
  sourceCount: number;
  regionCount: number;
  datasetIds: string[];
  suggestedSymbols: string[];
  reason: string;
  updatedAt: string;
  proposedThemeId?: string | null;
}

export interface RemoteDatasetProposal {
  id: string;
  label: string;
  provider: string;
  proposedBy: 'heuristic' | 'codex';
  confidence: number;
  proposalScore: number;
  rationale: string;
  querySummary: string;
  sourceThemeId: string;
  pitSafety: 'high' | 'medium' | 'low';
  estimatedCost: 'low' | 'medium' | 'high';
  autoRegister: boolean;
  autoEnable: boolean;
}

export interface RemoteAutomationRunRecord {
  kind: string;
  status: 'ok' | 'error' | 'skipped';
  datasetId: string | null;
  completedAt: string;
  detail: string;
}

export interface RemoteAutomationState {
  updatedAt: string;
  lastCandidateExpansionAt?: string | null;
  lastDatasetDiscoveryAt?: string | null;
  lastKeywordLifecycleAt?: string | null;
  lastSelfTuningAt?: string | null;
  activeCycle?: {
    id?: string | null;
    status?: 'idle' | 'running' | 'error';
    startedAt?: string | null;
    heartbeatAt?: string | null;
    completedAt?: string | null;
    stage?: string | null;
    datasetId?: string | null;
    totalDatasets?: number;
    completedDatasets?: number;
    touchedDatasets?: string[];
    lastError?: string | null;
    progressPct?: number;
  } | null;
  datasets: Record<string, RemoteAutomationDatasetState>;
  runs: RemoteAutomationRunRecord[];
  themeQueue: RemoteThemeQueueItem[];
  promotedThemes: RemotePromotedThemeState[];
  datasetProposals: RemoteDatasetProposal[];
}

export interface RemoteAutomationStatusPayload {
  registry: RemoteAutomationRegistry;
  state: RemoteAutomationState;
}

export interface LocalAutomationOpsSnapshotPayload {
  success?: boolean;
  timestamp?: string;
  runtime?: {
    mode?: string;
    port?: number;
    remoteBase?: string;
    localApiEnabled?: boolean;
  };
  serviceStatus?: {
    timestamp?: string;
    summary?: {
      operational?: number;
      degraded?: number;
      outage?: number;
      unknown?: number;
    };
    services?: Array<{
      id?: string;
      name?: string;
      category?: string;
      status?: string;
      description?: string;
    }>;
  };
  health?: {
    status?: 'healthy' | 'degraded' | 'error';
    degraded?: boolean;
    activeCycleStatus?: 'idle' | 'running' | 'error' | null;
    activeStage?: string | null;
    stalled?: boolean;
    heartbeatAgeMinutes?: number | null;
    stallThresholdMinutes?: number;
    enabledDatasetCount?: number;
    datasetErrorCount?: number;
    consecutiveFailures?: number;
    blockerCount?: number;
    reasons?: string[];
  };
  codex?: {
    available?: boolean;
    loggedIn?: boolean;
    usedCodex?: boolean;
    command?: string | null;
    spawnBlocked?: boolean;
    output?: string;
  };
  credentials?: {
    presentKeys?: string[];
    missingKeys?: string[];
    requiredKeys?: string[];
    missingRequiredKeys?: string[];
  };
  automation?: {
    registry?: RemoteAutomationRegistry | null;
    lastCycle?: {
      id?: string;
      datasetId?: string | null;
      kind?: string;
      status?: 'ok' | 'error' | 'skipped';
      startedAt?: string;
      completedAt?: string;
      attempts?: number;
      detail?: string;
    } | null;
    runsCount?: number;
      state?: {
        lastCandidateExpansionAt?: string | null;
        lastDatasetDiscoveryAt?: string | null;
        lastSelfTuningAt?: string | null;
        activeCycle?: RemoteAutomationState['activeCycle'];
        queue?: {
          themeQueueDepth?: number;
          openThemeQueueDepth?: number;
          datasetProposalDepth?: number;
        runDepth?: number;
        nextEligibleAt?: string | null;
      };
      consecutiveFailures?: number;
      lastError?: string | null;
    };
  };
  blockerReasons?: string[];
}

export interface LocalRuntimeSecretsPayload {
  ok?: boolean;
  mirrorPath?: string;
  secrets?: Record<string, string>;
  sources?: Record<string, 'env' | 'mirror'>;
}

export interface LocalReplayTriggerPayload {
  ok?: boolean;
  error?: string;
  run?: {
    id?: string;
    label?: string;
    completedAt?: string;
  } | null;
  defaultsUsed?: {
    bucketHours?: number;
    replayWindowDays?: number;
    warmupFrameCount?: number;
    maxFrames?: number;
    horizonsHours?: number[];
  };
}

export interface LocalSchedulerTriggerPayload {
  ok?: boolean;
  error?: string;
  result?: {
    completedAt?: string;
    touchedDatasets?: string[];
    summary?: {
      replayRuns?: unknown[];
      walkForwardRuns?: unknown[];
    };
  } | null;
}

export interface LocalBacktestRunListItem {
  id: string;
  label: string;
  mode: 'replay' | 'walk-forward';
  startedAt: string;
  completedAt: string;
  frameCount: number;
  ideaRunCount: number;
  forwardReturnCount: number;
}

export interface CodexChecklistItem {
  label: string;
  ok: boolean;
  detail: string;
}

function localAutomationOpsSnapshotEndpoint(): string {
  return '/api/local-automation-ops-snapshot';
}

function localRuntimeSecretsEndpoint(): string {
  return '/api/local-runtime-secrets';
}

function automationStatusEndpoint(): string {
  return '/api/local-intelligence-automation-status';
}

function replayNowEndpoint(): string {
  return '/api/local-intelligence-run-replay-now';
}

function schedulerNowEndpoint(): string {
  return '/api/local-intelligence-run-scheduler-now';
}

function backtestRunsEndpoint(): string {
  return '/api/local-intelligence-backtest-runs';
}

async function safeJson<T>(response: Response): Promise<T | null> {
  try {
    return (await response.json()) as T;
  } catch {
    return null;
  }
}

export async function getIntelligenceAutomationStatusRemote(): Promise<RemoteAutomationStatusPayload | null> {
  try {
    const response = await fetch(automationStatusEndpoint(), {
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) return null;
    const payload = await safeJson<{ result?: RemoteAutomationStatusPayload }>(response);
    return payload?.result || null;
  } catch {
    return null;
  }
}

export async function getLocalCodexCliStatusRemote(): Promise<LocalCodexCliStatus> {
  try {
    const response = await fetch('/api/local-codex-status', {
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) {
      return {
        available: false,
        loggedIn: false,
        message: `Codex status probe failed (${response.status})`,
      };
    }
    const payload = await safeJson<LocalCodexCliStatus>(response);
    return {
      available: payload?.available === true,
      loggedIn: payload?.loggedIn === true,
      message: payload?.message || 'Codex status unavailable',
    };
  } catch {
    return {
      available: false,
      loggedIn: false,
      message: 'Codex status probe unavailable',
    };
  }
}

export async function getLocalAutomationOpsSnapshotRemote(): Promise<LocalAutomationOpsSnapshotPayload | null> {
  try {
    const response = await fetch(localAutomationOpsSnapshotEndpoint(), {
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) return null;
    return await safeJson<LocalAutomationOpsSnapshotPayload>(response);
  } catch {
    return null;
  }
}

export async function getLocalRuntimeSecretsRemote(): Promise<LocalRuntimeSecretsPayload | null> {
  try {
    const response = await fetch(localRuntimeSecretsEndpoint(), {
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) return null;
    return await safeJson<LocalRuntimeSecretsPayload>(response);
  } catch {
    return null;
  }
}

export async function startLocalReplayNowRemote(): Promise<LocalReplayTriggerPayload> {
  const response = await fetch(replayNowEndpoint(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({}),
  });
  const payload = await safeJson<LocalReplayTriggerPayload>(response);
  if (!response.ok) {
    throw new Error(payload?.error || `Replay trigger failed (${response.status})`);
  }
  return payload || { ok: false, error: 'Replay trigger returned no payload' };
}

export async function startLocalSchedulerNowRemote(): Promise<LocalSchedulerTriggerPayload> {
  const response = await fetch(schedulerNowEndpoint(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({}),
  });
  const payload = await safeJson<LocalSchedulerTriggerPayload>(response);
  if (!response.ok) {
    throw new Error(payload?.error || `Scheduler trigger failed (${response.status})`);
  }
  return payload || { ok: false, error: 'Scheduler trigger returned no payload' };
}

export async function listLocalBacktestRunsRemote(limit = 12): Promise<LocalBacktestRunListItem[]> {
  try {
    const response = await fetch(`${backtestRunsEndpoint()}?limit=${Math.max(1, Math.min(50, Math.round(limit) || 12))}`, {
      headers: { Accept: 'application/json' },
    });
    const payload = await safeJson<{ ok?: boolean; runs?: LocalBacktestRunListItem[] }>(response);
    if (!response.ok) return [];
    return Array.isArray(payload?.runs) ? payload!.runs! : [];
  } catch {
    return [];
  }
}

function isHydratedBacktestRun(value: unknown): value is HistoricalReplayRun {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<HistoricalReplayRun>;
  return typeof candidate.id === 'string'
    && typeof candidate.label === 'string'
    && Array.isArray(candidate.horizonsHours)
    && Array.isArray(candidate.checkpoints)
    && Array.isArray(candidate.ideaRuns)
    && Array.isArray(candidate.forwardReturns);
}

export async function getLocalBacktestRunRemote(runId: string): Promise<HistoricalReplayRun | null> {
  const safeRunId = String(runId || '').trim();
  if (!safeRunId) return null;
  try {
    const response = await fetch(`${backtestRunsEndpoint()}?runId=${encodeURIComponent(safeRunId)}`, {
      headers: { Accept: 'application/json' },
    });
    const payload = await safeJson<{ ok?: boolean; found?: boolean; run?: HistoricalReplayRun | null }>(response);
    if (!response.ok || !payload?.found || !payload?.run) return null;
    return payload.run;
  } catch {
    return null;
  }
}

export async function loadLocalBacktestRunsRemote(limit = 8): Promise<HistoricalReplayRun[]> {
  const safeLimit = Math.max(1, Math.min(50, Math.round(limit) || 8));
  try {
    const response = await fetch(`${backtestRunsEndpoint()}?limit=${safeLimit}&detail=full`, {
      headers: { Accept: 'application/json' },
    });
    const payload = await safeJson<{ ok?: boolean; runs?: unknown[] }>(response);
    if (response.ok && Array.isArray(payload?.runs)) {
      const hydratedRuns = payload.runs.filter(isHydratedBacktestRun);
      if (hydratedRuns.length > 0) {
        return hydratedRuns;
      }
    }
  } catch {
    // Fall back to the legacy list + detail flow below.
  }

  const summaries = await listLocalBacktestRunsRemote(limit);
  if (!summaries.length) return [];
  const settledRuns = await Promise.allSettled(
    summaries.map((summary) => getLocalBacktestRunRemote(summary.id)),
  );
  return settledRuns
    .flatMap((result) => (result.status === 'fulfilled' && result.value ? [result.value] : []))
    .filter((run): run is HistoricalReplayRun => Boolean(run));
}

export function buildCodexAutomationChecklist(
  status: RemoteAutomationStatusPayload | null,
  codex: LocalCodexCliStatus,
): CodexChecklistItem[] {
  const enabledDatasets = status?.registry.datasets.filter((dataset) => dataset.enabled) || [];
  const replayingDatasets = enabledDatasets.filter((dataset) => status?.state.datasets[dataset.id]?.lastReplayAt);
  const protectedDatasets = enabledDatasets.filter((dataset) =>
    ['fred', 'alfred', 'acled'].includes(String(dataset.provider || '').toLowerCase()),
  );
  const protectedHealthy = protectedDatasets.every((dataset) => !(status?.state.datasets[dataset.id]?.lastError || '').trim());
  const openThemeQueue = status?.state.themeQueue.filter((item) => item.status === 'open').length || 0;
  const codexDatasetProposals = status?.state.datasetProposals.filter((proposal) => proposal.proposedBy === 'codex').length || 0;

  return [
    {
      label: 'Codex CLI logged in',
      ok: codex.available && codex.loggedIn,
      detail: codex.message,
    },
    {
      label: 'Enabled datasets present',
      ok: enabledDatasets.length > 0,
      detail: enabledDatasets.length > 0 ? `${enabledDatasets.length} enabled datasets` : 'No enabled datasets in registry',
    },
    {
      label: 'Replay frames are being produced',
      ok: replayingDatasets.length > 0,
      detail: replayingDatasets.length > 0
        ? `${replayingDatasets.length}/${enabledDatasets.length || 1} enabled datasets already replayed`
        : 'No enabled dataset has completed replay yet',
    },
    {
      label: 'Protected providers have credentials',
      ok: protectedHealthy,
      detail: protectedHealthy
        ? 'FRED/ALFRED/ACLED datasets are not blocked by auth errors'
        : 'One or more protected datasets still report auth or provider errors',
    },
    {
      label: 'Theme discovery has something to promote',
      ok: openThemeQueue > 0 || (status?.state.promotedThemes.length || 0) > 0,
      detail: openThemeQueue > 0
        ? `${openThemeQueue} open theme queue items`
        : `${status?.state.promotedThemes.length || 0} promoted themes, ${codexDatasetProposals} Codex dataset proposals`,
    },
  ];
}

export function buildCodexQueueDiagnosis(
  status: RemoteAutomationStatusPayload | null,
  codex: LocalCodexCliStatus,
  codexDiscoveredSources: number,
  codexApiSources: number,
): string[] {
  if (!status) {
    return ['Automation status is not reachable from the local sidecar, so queue diagnosis is incomplete.'];
  }

  const enabledDatasets = status.registry.datasets.filter((dataset) => dataset.enabled);
  const replayingDatasets = enabledDatasets.filter((dataset) => status.state.datasets[dataset.id]?.lastReplayAt);
  const failingDatasets = enabledDatasets.filter((dataset) => status.state.datasets[dataset.id]?.lastError);
  const openThemeQueue = status.state.themeQueue.filter((item) => item.status === 'open');
  const codexDatasetProposals = status.state.datasetProposals.filter((proposal) => proposal.proposedBy === 'codex');
  const reasons: string[] = [];

  if (!codex.available || !codex.loggedIn) {
    reasons.push(`Codex automation is gated because CLI status is ${codex.message}.`);
  }

  if (!enabledDatasets.length) {
    reasons.push('No datasets are enabled, so there is no historical feed for theme or dataset discovery.');
  }

  if (failingDatasets.length) {
    reasons.push(`Protected datasets are blocked: ${failingDatasets.map((dataset) => `${dataset.id} (${status.state.datasets[dataset.id]?.lastError || 'error'})`).join(', ')}.`);
  }

  if (replayingDatasets.length < 2) {
    reasons.push(`Only ${replayingDatasets.length} enabled datasets are currently producing replay frames, so motif variety is narrow.`);
  }

  if (!openThemeQueue.length) {
    reasons.push(
      `Theme queue is empty because recent motifs did not clear guarded-auto gates: score >= ${status.registry.themeAutomation.minDiscoveryScore}, samples >= ${status.registry.themeAutomation.minSampleCount}, sources >= ${status.registry.themeAutomation.minSourceCount}, overlap <= ${status.registry.themeAutomation.maxOverlapWithKnownThemes.toFixed(2)}.`,
    );
  }

  if (!codexDatasetProposals.length) {
    reasons.push(
      `Dataset proposals are empty because no current theme pressure has cleared the dataset proposal floor (${status.registry.datasetAutomation.minProposalScore}) with Codex dataset discovery enabled.`,
    );
  }

  if (codexDiscoveredSources + codexApiSources === 0) {
    reasons.push('No Codex-discovered feed or API source is currently active in the source registries.');
  }

  if (!reasons.length) {
    reasons.push('Codex queues are populated and no obvious blockers are currently detected.');
  }

  return reasons;
}
