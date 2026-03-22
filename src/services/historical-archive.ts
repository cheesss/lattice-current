
import type { HistoricalReplayRun } from './historical-intelligence';
import { getPersistentCache, setPersistentCache } from './persistent-cache';

const ARCHIVE_KEY = 'historical-archive:v1';
const MAX_ARCHIVE_SIZE = 50;

interface PersistedArchive {
  runs: HistoricalReplayRun[];
}

/**
 * Archives a historical replay run for later retrieval.
 */
export async function archiveHistoricalReplayRun(run: HistoricalReplayRun): Promise<void> {
  const cached = await getPersistentCache<PersistedArchive>(ARCHIVE_KEY);
  const runs = cached?.data?.runs || [];
  
  // Dedup and add
  const filtered = runs.filter(r => r.id !== run.id);
  filtered.unshift(run);
  
  await setPersistentCache(ARCHIVE_KEY, { runs: filtered.slice(0, MAX_ARCHIVE_SIZE) });
}

/**
 * Lists archived historical replay runs.
 */
export async function listArchivedReplayRuns(limit = 20): Promise<HistoricalReplayRun[]> {
  const cached = await getPersistentCache<PersistedArchive>(ARCHIVE_KEY);
  return (cached?.data?.runs || []).slice(0, limit);
}
