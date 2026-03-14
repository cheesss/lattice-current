import type { HistoricalReplayRun } from './historical-intelligence';

export interface HistoricalReplayArchiveSummary {
  id: string;
  label: string;
  mode: 'replay' | 'walk-forward';
  startedAt: string;
  completedAt: string;
  frameCount: number;
  ideaRunCount: number;
  forwardReturnCount: number;
}

function archiveEndpoint(): string {
  return '/api/local-intelligence-archive';
}

async function safeJson<T>(response: Response): Promise<T | null> {
  try {
    return await response.json() as T;
  } catch {
    return null;
  }
}

export async function archiveHistoricalReplayRun(run: HistoricalReplayRun): Promise<boolean> {
  try {
    const response = await fetch(archiveEndpoint(), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        action: 'archive-replay-run',
        run,
      }),
    });
    if (!response.ok) return false;
    const payload = await safeJson<{ ok?: boolean }>(response);
    return payload?.ok === true;
  } catch {
    return false;
  }
}

export async function listArchivedHistoricalReplayRuns(limit = 20): Promise<HistoricalReplayArchiveSummary[]> {
  try {
    const response = await fetch(`${archiveEndpoint()}?action=list&limit=${Math.max(1, Math.min(200, Math.round(limit || 20)))}`);
    if (!response.ok) return [];
    const payload = await safeJson<{ runs?: HistoricalReplayArchiveSummary[] }>(response);
    return Array.isArray(payload?.runs) ? payload!.runs! : [];
  } catch {
    return [];
  }
}

export async function getArchivedHistoricalReplayRun(runId: string): Promise<HistoricalReplayRun | null> {
  const safeRunId = String(runId || '').trim();
  if (!safeRunId) return null;
  try {
    const response = await fetch(`${archiveEndpoint()}?action=get&runId=${encodeURIComponent(safeRunId)}`);
    if (!response.ok) return null;
    const payload = await safeJson<{ run?: HistoricalReplayRun | null }>(response);
    return payload?.run || null;
  } catch {
    return null;
  }
}
