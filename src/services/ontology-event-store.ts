import { getPersistentCache, setPersistentCache } from './persistent-cache';
import type { OntologyGraphSnapshot } from './ontology-graph';

export type OntologyLedgerEventType =
  | 'snapshot-built'
  | 'alias-approved'
  | 'alias-split'
  | 'entity-merged';

export interface OntologyLedgerEvent {
  id: string;
  timestamp: string;
  type: OntologyLedgerEventType;
  summary: string;
  payload: Record<string, unknown>;
}

export interface OntologyReplayState {
  asOf: string;
  snapshotEventId: string | null;
  entityNodeCount: number;
  edgeCount: number;
  eventNodeCount: number;
  inferredEdgeCount: number;
  violationCount: number;
  topEntityLabels: string[];
  topEventLabels: string[];
}

interface PersistedOntologyLedger {
  events: OntologyLedgerEvent[];
}

const CACHE_KEY = 'ontology-event-ledger:v1';
const MAX_LEDGER_EVENTS = 1200;
const MAX_SNAPSHOT_EVENTS = 96;

function nowIso(): string {
  return new Date().toISOString();
}

function makeEventId(type: OntologyLedgerEventType, timestamp: string, summary: string): string {
  return `${type}:${timestamp}:${String(summary || '').slice(0, 80)}`;
}

async function loadLedger(): Promise<OntologyLedgerEvent[]> {
  const cached = await getPersistentCache<PersistedOntologyLedger>(CACHE_KEY).catch(() => null);
  return Array.isArray(cached?.data?.events) ? cached!.data!.events : [];
}

async function persistLedger(events: OntologyLedgerEvent[]): Promise<void> {
  const sorted = events
    .slice()
    .sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp));

  const trimmed: OntologyLedgerEvent[] = [];
  let snapshotCount = 0;
  for (const event of sorted) {
    if (event.type === 'snapshot-built') {
      if (snapshotCount >= MAX_SNAPSHOT_EVENTS) continue;
      snapshotCount += 1;
    }
    trimmed.push(event);
    if (trimmed.length >= MAX_LEDGER_EVENTS) break;
  }
  await setPersistentCache(CACHE_KEY, { events: trimmed });
}

export async function appendOntologyLedgerEvent(input: {
  type: OntologyLedgerEventType;
  summary: string;
  payload?: Record<string, unknown>;
  timestamp?: string;
}): Promise<OntologyLedgerEvent> {
  const timestamp = input.timestamp || nowIso();
  const event: OntologyLedgerEvent = {
    id: makeEventId(input.type, timestamp, input.summary),
    timestamp,
    type: input.type,
    summary: input.summary,
    payload: input.payload || {},
  };

  const current = await loadLedger();
  if (!current.some((item) => item.id === event.id)) {
    current.unshift(event);
    await persistLedger(current);
  }
  return event;
}

export async function recordOntologySnapshotEvent(snapshot: OntologyGraphSnapshot): Promise<OntologyLedgerEvent> {
  const entityNodes = snapshot.nodes.filter((node) => node.category === 'entity');
  const payload = {
    generatedAt: snapshot.generatedAt,
    snapshot,
    entityNodeIds: entityNodes.map((node) => node.id),
    edgeIds: snapshot.edges.map((edge) => edge.id),
    eventNodeIds: snapshot.eventNodes.map((node) => node.id),
    inferredEdgeIds: snapshot.inferredEdges.map((edge) => edge.id),
    violationIds: snapshot.violations.map((item) => item.id),
    topEntityLabels: entityNodes
      .slice()
      .sort((a, b) => Number(b.score || 0) - Number(a.score || 0))
      .slice(0, 8)
      .map((node) => node.label),
    topEventLabels: snapshot.eventNodes
      .slice()
      .sort((a, b) => Number(b.score || 0) - Number(a.score || 0))
      .slice(0, 6)
      .map((node) => node.label),
  };

  return appendOntologyLedgerEvent({
    type: 'snapshot-built',
    summary: `Snapshot ${entityNodes.length} entities / ${snapshot.edges.length} edges / ${snapshot.eventNodes.length} events`,
    payload,
    timestamp: snapshot.generatedAt,
  });
}

export async function listOntologyLedgerEvents(limit = 120): Promise<OntologyLedgerEvent[]> {
  const current = await loadLedger();
  return current
    .slice()
    .sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp))
    .slice(0, Math.max(1, limit));
}

function resolveReplayTimestamp(timestamp: string | number | Date): number {
  const ts = timestamp instanceof Date ? timestamp.getTime() : typeof timestamp === 'string' ? Date.parse(timestamp) : Number(timestamp);
  return Number.isFinite(ts) ? ts : NaN;
}

function extractReplaySnapshot(payload: Record<string, unknown> | null | undefined): OntologyGraphSnapshot | null {
  const candidate = payload?.snapshot;
  if (!candidate || typeof candidate !== 'object') return null;
  const snapshot = candidate as OntologyGraphSnapshot;
  if (!Array.isArray(snapshot.nodes) || !Array.isArray(snapshot.edges)) return null;
  return snapshot;
}

export async function replayOntologySnapshotAt(timestamp: string | number | Date): Promise<OntologyGraphSnapshot | null> {
  const ts = resolveReplayTimestamp(timestamp);
  if (!Number.isFinite(ts)) return null;

  const current = await loadLedger();
  const snapshotEvent = current
    .filter((event) => event.type === 'snapshot-built')
    .filter((event) => Date.parse(event.timestamp) <= ts)
    .sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp))[0];

  if (!snapshotEvent) return null;
  return extractReplaySnapshot(snapshotEvent.payload || {});
}

export async function replayOntologyStateAt(timestamp: string | number | Date): Promise<OntologyReplayState | null> {
  const ts = resolveReplayTimestamp(timestamp);
  if (!Number.isFinite(ts)) return null;

  const current = await loadLedger();
  const snapshotEvent = current
    .filter((event) => event.type === 'snapshot-built')
    .filter((event) => Date.parse(event.timestamp) <= ts)
    .sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp))[0];

  if (!snapshotEvent) return null;
  const replaySnapshot = extractReplaySnapshot(snapshotEvent.payload || {});
  if (replaySnapshot) {
    const entityNodes = replaySnapshot.nodes.filter((node) => node.category === 'entity');
    return {
      asOf: snapshotEvent.timestamp,
      snapshotEventId: snapshotEvent.id,
      entityNodeCount: entityNodes.length,
      edgeCount: replaySnapshot.edges.length,
      eventNodeCount: replaySnapshot.eventNodes.length,
      inferredEdgeCount: replaySnapshot.inferredEdges.length,
      violationCount: replaySnapshot.violations.length,
      topEntityLabels: entityNodes
        .slice()
        .sort((a, b) => Number(b.score || 0) - Number(a.score || 0))
        .slice(0, 6)
        .map((node) => node.label),
      topEventLabels: replaySnapshot.eventNodes
        .slice()
        .sort((a, b) => Number(b.score || 0) - Number(a.score || 0))
        .slice(0, 4)
        .map((node) => node.label),
    };
  }

  const payload = snapshotEvent.payload || {};
  const entityNodeIds = Array.isArray(payload.entityNodeIds) ? payload.entityNodeIds : [];
  const edgeIds = Array.isArray(payload.edgeIds) ? payload.edgeIds : [];
  const eventNodeIds = Array.isArray(payload.eventNodeIds) ? payload.eventNodeIds : [];
  const inferredEdgeIds = Array.isArray(payload.inferredEdgeIds) ? payload.inferredEdgeIds : [];
  const violationIds = Array.isArray(payload.violationIds) ? payload.violationIds : [];
  const topEntityLabels = Array.isArray(payload.topEntityLabels) ? payload.topEntityLabels.map(String) : [];
  const topEventLabels = Array.isArray(payload.topEventLabels) ? payload.topEventLabels.map(String) : [];

  return {
    asOf: snapshotEvent.timestamp,
    snapshotEventId: snapshotEvent.id,
    entityNodeCount: entityNodeIds.length,
    edgeCount: edgeIds.length,
    eventNodeCount: eventNodeIds.length,
    inferredEdgeCount: inferredEdgeIds.length,
    violationCount: violationIds.length,
    topEntityLabels: topEntityLabels.slice(0, 6),
    topEventLabels: topEventLabels.slice(0, 4),
  };
}
