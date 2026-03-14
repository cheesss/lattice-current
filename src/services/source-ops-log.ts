import { getPersistentCache, setPersistentCache } from './persistent-cache';

export type SourceOpsEventKind =
  | 'source'
  | 'keyword'
  | 'api'
  | 'report'
  | 'system'
  | 'transmission'
  | 'ontology'
  | 'credibility'
  | 'healing';

export interface SourceOpsEvent {
  id: string;
  kind: SourceOpsEventKind;
  action: string;
  actor: string;
  title: string;
  detail?: string;
  status?: string;
  category?: string;
  url?: string;
  tags?: string[];
  createdAt: number;
}

interface PersistedSourceOpsLog {
  events: SourceOpsEvent[];
}

const SOURCE_OPS_LOG_KEY = 'source-ops-log:v1';
const MAX_EVENTS = 1200;

let loaded = false;
const eventLog: SourceOpsEvent[] = [];

function nowMs(): number {
  return Date.now();
}

function makeId(kind: SourceOpsEventKind, action: string, title: string): string {
  const seed = `${kind}:${action}:${title}:${nowMs()}`;
  return seed.slice(0, 220);
}

async function ensureLoaded(): Promise<void> {
  if (loaded) return;
  loaded = true;
  try {
    const cached = await getPersistentCache<PersistedSourceOpsLog>(SOURCE_OPS_LOG_KEY);
    for (const event of cached?.data?.events ?? []) {
      eventLog.push(event);
    }
  } catch (error) {
    console.warn('[source-ops-log] load failed', error);
  }
}

async function persist(): Promise<void> {
  const trimmed = eventLog
    .slice()
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, MAX_EVENTS);
  eventLog.length = 0;
  eventLog.push(...trimmed);
  await setPersistentCache(SOURCE_OPS_LOG_KEY, { events: trimmed });
}

export async function logSourceOpsEvent(input: Omit<SourceOpsEvent, 'id' | 'createdAt'> & { createdAt?: number }): Promise<SourceOpsEvent> {
  await ensureLoaded();
  const createdAt = Number.isFinite(input.createdAt) ? Number(input.createdAt) : nowMs();
  const event: SourceOpsEvent = {
    id: makeId(input.kind, input.action, input.title),
    kind: input.kind,
    action: input.action,
    actor: input.actor,
    title: input.title,
    detail: input.detail,
    status: input.status,
    category: input.category,
    url: input.url,
    tags: (input.tags || []).filter(Boolean).slice(0, 10),
    createdAt,
  };
  eventLog.unshift(event);
  if (eventLog.length > MAX_EVENTS) {
    eventLog.length = MAX_EVENTS;
  }
  await persist();
  return event;
}

export async function listSourceOpsEvents(limit = 60): Promise<SourceOpsEvent[]> {
  await ensureLoaded();
  return eventLog
    .slice()
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, Math.max(1, limit));
}
