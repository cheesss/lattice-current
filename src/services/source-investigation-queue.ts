import { getPersistentCache, setPersistentCache } from './persistent-cache';

export type InvestigationStatus = 'pending' | 'running' | 'done' | 'failed';

export interface SourceInvestigationTask {
  id: string;
  feedName: string;
  lang: string;
  failedUrl: string;
  reason: string;
  topicHints?: string[];
  attempts: number;
  status: InvestigationStatus;
  createdAt: number;
  updatedAt: number;
  lastError: string | null;
  resolvedUrl: string | null;
}

interface QueuePayload {
  tasks: SourceInvestigationTask[];
}

const QUEUE_KEY = 'source-investigation-queue:v1';
const MAX_TASKS = 300;

let loaded = false;
const tasks = new Map<string, SourceInvestigationTask>();

function nowMs(): number {
  return Date.now();
}

function createTaskId(feedName: string, lang: string): string {
  return `${feedName}::${lang || 'en'}`;
}

async function ensureLoaded(): Promise<void> {
  if (loaded) return;
  loaded = true;
  try {
    const cached = await getPersistentCache<QueuePayload>(QUEUE_KEY);
    for (const task of cached?.data?.tasks ?? []) {
      tasks.set(task.id, task);
    }
  } catch (error) {
    console.warn('[source-investigation-queue] Failed to load queue', error);
  }
}

async function persist(): Promise<void> {
  const all = Array.from(tasks.values())
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, MAX_TASKS);

  const next = new Map<string, SourceInvestigationTask>();
  for (const task of all) next.set(task.id, task);
  tasks.clear();
  for (const [id, task] of next) tasks.set(id, task);

  await setPersistentCache(QUEUE_KEY, { tasks: Array.from(tasks.values()) });
}

export async function enqueueSourceInvestigation(input: {
  feedName: string;
  lang: string;
  failedUrl: string;
  reason: string;
  topicHints?: string[];
}): Promise<SourceInvestigationTask> {
  await ensureLoaded();
  const id = createTaskId(input.feedName, input.lang);
  const existing = tasks.get(id);
  const ts = nowMs();

  if (existing && (existing.status === 'pending' || existing.status === 'running')) {
    return existing;
  }

  const task: SourceInvestigationTask = existing
    ? {
      ...existing,
      failedUrl: input.failedUrl,
      reason: input.reason.slice(0, 240),
      topicHints: (input.topicHints || []).filter(Boolean).slice(0, 12),
      status: 'pending',
      updatedAt: ts,
      lastError: null,
      resolvedUrl: null,
    }
    : {
      id,
      feedName: input.feedName,
      lang: input.lang || 'en',
      failedUrl: input.failedUrl,
      reason: input.reason.slice(0, 240),
      topicHints: (input.topicHints || []).filter(Boolean).slice(0, 12),
      attempts: 0,
      status: 'pending',
      createdAt: ts,
      updatedAt: ts,
      lastError: null,
      resolvedUrl: null,
    };

  tasks.set(id, task);
  await persist();
  return task;
}

export async function claimNextInvestigationTask(): Promise<SourceInvestigationTask | null> {
  await ensureLoaded();
  const pending = Array.from(tasks.values())
    .filter(task => task.status === 'pending')
    .sort((a, b) => a.updatedAt - b.updatedAt)[0];

  if (!pending) return null;

  const claimed: SourceInvestigationTask = {
    ...pending,
    attempts: pending.attempts + 1,
    status: 'running',
    updatedAt: nowMs(),
    lastError: null,
  };
  tasks.set(claimed.id, claimed);
  await persist();
  return claimed;
}

export async function completeInvestigationTask(
  id: string,
  outcome: { ok: true; resolvedUrl: string; note?: string } | { ok: false; error: string; retry: boolean },
): Promise<void> {
  await ensureLoaded();
  const current = tasks.get(id);
  if (!current) return;

  const ts = nowMs();
  if (outcome.ok) {
    tasks.set(id, {
      ...current,
      status: 'done',
      updatedAt: ts,
      lastError: outcome.note ? outcome.note.slice(0, 240) : null,
      resolvedUrl: outcome.resolvedUrl,
    });
  } else {
    tasks.set(id, {
      ...current,
      status: outcome.retry ? 'pending' : 'failed',
      updatedAt: ts,
      lastError: outcome.error.slice(0, 240),
    });
  }
  await persist();
}

export async function listInvestigationTasks(): Promise<SourceInvestigationTask[]> {
  await ensureLoaded();
  return Array.from(tasks.values()).sort((a, b) => b.updatedAt - a.updatedAt);
}

