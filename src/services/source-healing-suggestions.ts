import { getPersistentCache, setPersistentCache } from './persistent-cache';
import { logSourceOpsEvent } from './source-ops-log';

export type SourceHealingSuggestionType =
  | 'rss-replacement'
  | 'dom-fallback'
  | 'source-candidate';

export type SourceHealingSuggestionStatus =
  | 'draft'
  | 'applied'
  | 'rejected'
  | 'resolved';

export interface SourceHealingSuggestion {
  id: string;
  feedName: string;
  lang: string;
  type: SourceHealingSuggestionType;
  status: SourceHealingSuggestionStatus;
  failedUrl: string;
  suggestedUrl?: string;
  selectorHint?: string;
  confidence: number;
  reason: string;
  discoveredBy: 'playwright' | 'codex-playwright' | 'heuristic' | 'system';
  topics: string[];
  createdAt: number;
  updatedAt: number;
}

interface PersistedHealingSuggestions {
  suggestions: SourceHealingSuggestion[];
}

const HEALING_SUGGESTIONS_KEY = 'source-healing-suggestions:v1';
const MAX_SUGGESTIONS = 240;

let loaded = false;
const suggestions = new Map<string, SourceHealingSuggestion>();

function nowMs(): number {
  return Date.now();
}

function normalizeUrl(value: string | undefined): string {
  return String(value || '').trim().toLowerCase();
}

function normalizeTopic(value: string): string {
  return String(value || '').trim().toLowerCase().replace(/\s+/g, ' ').slice(0, 120);
}

function makeId(feedName: string, type: SourceHealingSuggestionType, failedUrl: string, suggestedUrl?: string): string {
  return [
    String(feedName || '').trim().toLowerCase(),
    type,
    normalizeUrl(failedUrl),
    normalizeUrl(suggestedUrl),
  ].join('::');
}

async function ensureLoaded(): Promise<void> {
  if (loaded) return;
  loaded = true;
  try {
    const cached = await getPersistentCache<PersistedHealingSuggestions>(HEALING_SUGGESTIONS_KEY);
    for (const item of cached?.data?.suggestions ?? []) {
      suggestions.set(item.id, item);
    }
  } catch (error) {
    console.warn('[source-healing-suggestions] load failed', error);
  }
}

async function persist(): Promise<void> {
  const payload: PersistedHealingSuggestions = {
    suggestions: Array.from(suggestions.values())
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, MAX_SUGGESTIONS),
  };
  await setPersistentCache(HEALING_SUGGESTIONS_KEY, payload);
}

export async function upsertSourceHealingSuggestion(input: {
  feedName: string;
  lang?: string;
  type: SourceHealingSuggestionType;
  status?: SourceHealingSuggestionStatus;
  failedUrl: string;
  suggestedUrl?: string;
  selectorHint?: string;
  confidence?: number;
  reason: string;
  discoveredBy?: SourceHealingSuggestion['discoveredBy'];
  topics?: string[];
}): Promise<SourceHealingSuggestion | null> {
  await ensureLoaded();
  const feedName = String(input.feedName || '').trim();
  const failedUrl = String(input.failedUrl || '').trim();
  if (!feedName || !failedUrl) return null;

  const id = makeId(feedName, input.type, failedUrl, input.suggestedUrl);
  const ts = nowMs();
  const previous = suggestions.get(id);
  const next: SourceHealingSuggestion = previous
    ? {
      ...previous,
      status: input.status || previous.status,
      suggestedUrl: input.suggestedUrl || previous.suggestedUrl,
      selectorHint: input.selectorHint || previous.selectorHint,
      confidence: Math.max(previous.confidence, Math.round(input.confidence ?? previous.confidence)),
      reason: String(input.reason || previous.reason).slice(0, 320),
      discoveredBy: input.discoveredBy || previous.discoveredBy,
      topics: Array.from(new Set([
        ...(previous.topics || []),
        ...((input.topics || []).map(normalizeTopic).filter(Boolean)),
      ])).slice(0, 12),
      updatedAt: ts,
    }
    : {
      id,
      feedName,
      lang: String(input.lang || 'en').slice(0, 8),
      type: input.type,
      status: input.status || 'draft',
      failedUrl,
      suggestedUrl: input.suggestedUrl?.trim(),
      selectorHint: input.selectorHint?.trim(),
      confidence: Math.max(0, Math.min(100, Math.round(input.confidence ?? 55))),
      reason: String(input.reason || 'healing suggestion').slice(0, 320),
      discoveredBy: input.discoveredBy || 'system',
      topics: (input.topics || []).map(normalizeTopic).filter(Boolean).slice(0, 12),
      createdAt: ts,
      updatedAt: ts,
    };

  suggestions.set(id, next);
  await persist();
  await logSourceOpsEvent({
    kind: 'healing',
    action: previous ? 'updated' : 'suggested',
    actor: next.discoveredBy,
    title: `${next.feedName} ${next.type}`,
    detail: next.reason,
    status: next.status,
    category: next.lang,
    url: next.suggestedUrl || next.failedUrl,
    tags: next.topics.slice(0, 6),
  });
  return next;
}

export async function listSourceHealingSuggestions(limit = 40): Promise<SourceHealingSuggestion[]> {
  await ensureLoaded();
  return Array.from(suggestions.values())
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, Math.max(1, limit));
}

export async function setSourceHealingSuggestionStatus(
  id: string,
  status: SourceHealingSuggestionStatus,
): Promise<SourceHealingSuggestion | null> {
  await ensureLoaded();
  const existing = suggestions.get(id);
  if (!existing) return null;
  const next: SourceHealingSuggestion = {
    ...existing,
    status,
    updatedAt: nowMs(),
  };
  suggestions.set(id, next);
  await persist();
  await logSourceOpsEvent({
    kind: 'healing',
    action: 'status',
    actor: 'system',
    title: `${next.feedName} ${next.type}`,
    detail: next.reason,
    status,
    category: next.lang,
    url: next.suggestedUrl || next.failedUrl,
    tags: next.topics.slice(0, 6),
  });
  return next;
}
