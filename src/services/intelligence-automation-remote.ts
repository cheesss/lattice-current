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

export interface RemoteAutomationRegistry {
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

export interface CodexChecklistItem {
  label: string;
  ok: boolean;
  detail: string;
}

function automationStatusEndpoint(): string {
  return '/api/local-intelligence-automation-status';
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
