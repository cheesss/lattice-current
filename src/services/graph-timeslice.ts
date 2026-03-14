import type { GraphRagSummary } from './graph-rag';
import type { KeywordGraphSnapshot } from './keyword-registry';
import { getPersistentCache, setPersistentCache } from './persistent-cache';
import { logSourceOpsEvent } from './source-ops-log';

export interface GraphTimeslice {
  id: string;
  capturedAt: string;
  nodeCount: number;
  edgeCount: number;
  topTerms: string[];
  topThemes: string[];
  nodes: Array<{
    term: string;
    domain: string;
    score: number;
  }>;
  edges: Array<{
    source: string;
    target: string;
    weight: number;
    relationType?: string;
    active?: boolean;
    validFrom?: string;
    validUntil?: string | null;
  }>;
}

interface PersistedGraphTimesliceStore {
  slices: GraphTimeslice[];
  lastDigest: string | null;
}

const GRAPH_TIMESLICE_KEY = 'graph-timeslice:v1';
const MAX_SLICES = 48;
const MIN_TIMESLICE_INTERVAL_MS = 90 * 60 * 1000;

let loaded = false;
let slices: GraphTimeslice[] = [];
let lastDigest: string | null = null;

function nowMs(): number {
  return Date.now();
}

function digestGraph(snapshot: KeywordGraphSnapshot): string {
  return JSON.stringify({
    nodes: snapshot.nodes.slice(0, 16).map((node) => [node.term, Math.round(node.score), node.domain]),
    edges: snapshot.edges.slice(0, 24).map((edge) => [edge.source, edge.target, Math.round(edge.weight)]),
  });
}

async function ensureLoaded(): Promise<void> {
  if (loaded) return;
  loaded = true;
  try {
    const cached = await getPersistentCache<PersistedGraphTimesliceStore>(GRAPH_TIMESLICE_KEY);
    slices = cached?.data?.slices ?? [];
    lastDigest = cached?.data?.lastDigest ?? null;
  } catch (error) {
    console.warn('[graph-timeslice] load failed', error);
  }
}

async function persist(): Promise<void> {
  await setPersistentCache(GRAPH_TIMESLICE_KEY, { slices, lastDigest });
}

export async function recordGraphTimeslice(
  snapshot: KeywordGraphSnapshot,
  graphRagSummary?: GraphRagSummary | null,
): Promise<GraphTimeslice | null> {
  await ensureLoaded();
  const digest = digestGraph(snapshot);
  const last = slices[0];
  const lastCaptured = last ? new Date(last.capturedAt).getTime() : 0;
  const dueByChange = digest !== lastDigest;
  const dueByTime = nowMs() - lastCaptured >= MIN_TIMESLICE_INTERVAL_MS;
  if (!dueByChange && !dueByTime) {
    return null;
  }

  const next: GraphTimeslice = {
    id: `graph-slice:${nowMs()}`,
    capturedAt: new Date().toISOString(),
    nodeCount: snapshot.nodes.length,
    edgeCount: snapshot.edges.length,
    topTerms: snapshot.nodes.slice(0, 12).map((node) => node.term),
    topThemes: (graphRagSummary?.globalThemes || []).slice(0, 8),
    nodes: snapshot.nodes.slice(0, 24).map((node) => ({
      term: node.term,
      domain: node.domain,
      score: Number(node.score) || 0,
    })),
    edges: snapshot.edges.slice(0, 40).map((edge) => ({
      source: edge.source,
      target: edge.target,
      weight: Number(edge.weight) || 0,
      relationType: edge.relationType,
      active: edge.active,
      validFrom: edge.validFrom,
      validUntil: edge.validUntil,
    })),
  };

  slices = [next, ...slices].slice(0, MAX_SLICES);
  lastDigest = digest;
  await persist();
  await logSourceOpsEvent({
    kind: 'ontology',
    action: 'timeslice',
    actor: 'system',
    title: 'Graph timeslice recorded',
    detail: `nodes=${next.nodeCount}, edges=${next.edgeCount}`,
    status: 'ok',
    category: 'ontology',
  });
  return next;
}

export async function listGraphTimeslices(limit = 16): Promise<GraphTimeslice[]> {
  await ensureLoaded();
  return slices.slice(0, Math.max(1, limit));
}

export function summarizeGraphTimeline(input: GraphTimeslice[]): string[] {
  const recent = input.slice(0, 6);
  const lines: string[] = [];
  for (let i = 0; i < recent.length - 1; i += 1) {
    const current = recent[i]!;
    const previous = recent[i + 1]!;
    const currentEdges = new Set(current.edges.map((edge) => `${edge.source}->${edge.target}`));
    const previousEdges = new Set(previous.edges.map((edge) => `${edge.source}->${edge.target}`));
    const added = [...currentEdges].filter((edge) => !previousEdges.has(edge)).slice(0, 3);
    const removed = [...previousEdges].filter((edge) => !currentEdges.has(edge)).slice(0, 3);
    if (added.length > 0) {
      lines.push(`${current.capturedAt}: new links ${added.join(', ')}`);
    }
    if (removed.length > 0) {
      lines.push(`${current.capturedAt}: dropped links ${removed.join(', ')}`);
    }
    if (lines.length >= 8) break;
  }
  return lines.slice(0, 8);
}
