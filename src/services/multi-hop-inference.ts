import type { EventMarketTransmissionSnapshot } from './event-market-transmission';
import type { KeywordGraphSnapshot } from './keyword-registry';
import type { CanonicalEntity } from './entity-ontology';
import { runGraphBeliefPropagation } from './math-models/graph-inference';
import { getPersistentCache, setPersistentCache } from './persistent-cache';
import { logSourceOpsEvent } from './source-ops-log';

export interface MultiHopInferenceAlert {
  id: string;
  title: string;
  severity: 'info' | 'medium' | 'high';
  category: 'supply-chain' | 'macro' | 'security' | 'tech' | 'energy' | 'mixed';
  confidence: number;
  summary: string;
  chain: string[];
  evidence: string[];
  generatedAt: string;
}

interface PersistedMultiHopInference {
  alerts: MultiHopInferenceAlert[];
}

const MULTI_HOP_KEY = 'multi-hop-inference:v1';
const MAX_ALERTS = 120;

let loaded = false;
let currentAlerts: MultiHopInferenceAlert[] = [];

function normalize(value: string): string {
  return String(value || '').toLowerCase().replace(/[^\p{L}\p{N}\s\-_.]/gu, ' ').replace(/\s+/g, ' ').trim();
}

function tokenize(value: string): string[] {
  return Array.from(new Set(normalize(value).split(' ').filter((token) => token.length >= 3))).slice(0, 48);
}

function scoreOverlap(left: string[], right: string[]): number {
  if (!left.length || !right.length) return 0;
  const rightSet = new Set(right);
  let score = 0;
  for (const token of left) {
    if (rightSet.has(token)) score += 1;
  }
  return score;
}

function inferCategory(chain: string[]): MultiHopInferenceAlert['category'] {
  const blob = normalize(chain.join(' '));
  if (/(shipping|port|supply|freight|container|vessel|maritime)/.test(blob)) return 'supply-chain';
  if (/(oil|gas|lng|grid|energy|uranium|power)/.test(blob)) return 'energy';
  if (/(sanction|war|missile|military|defense|security|attack)/.test(blob)) return 'security';
  if (/(chip|semiconductor|cloud|compute|ai|model)/.test(blob)) return 'tech';
  if (/(bond|yield|inflation|fx|currency|rates|macro)/.test(blob)) return 'macro';
  return 'mixed';
}

async function ensureLoaded(): Promise<void> {
  if (loaded) return;
  loaded = true;
  try {
    const cached = await getPersistentCache<PersistedMultiHopInference>(MULTI_HOP_KEY);
    currentAlerts = cached?.data?.alerts ?? [];
  } catch (error) {
    console.warn('[multi-hop-inference] load failed', error);
  }
}

async function persist(): Promise<void> {
  await setPersistentCache(MULTI_HOP_KEY, { alerts: currentAlerts.slice(0, MAX_ALERTS) });
}

function buildInferencePosterior(args: {
  eventTitle: string;
  marketSymbol: string;
  eventTokens: string[];
  marketTokens: string[];
  graph: KeywordGraphSnapshot | null | undefined;
  ontologyTerms: Array<{ entity: CanonicalEntity; tokens: string[] }>;
  transmissionStrength: number;
}): Record<string, number> {
  const nodes = [
    { id: `event:${args.eventTitle}`, prior: Math.max(0.18, Math.min(0.99, args.transmissionStrength / 100)) },
    { id: `market:${args.marketSymbol}`, prior: Math.max(0.18, Math.min(0.99, args.transmissionStrength / 100)) },
  ];
  const edges: Array<{ source: string; target: string; weight: number; relationType?: string }> = [
    {
      source: `event:${args.eventTitle}`,
      target: `market:${args.marketSymbol}`,
      weight: args.transmissionStrength,
      relationType: 'market-transmission',
    },
  ];

  for (const node of args.graph?.nodes || []) {
    const nodeTokens = tokenize(node.term);
    const overlap = scoreOverlap(args.eventTokens, nodeTokens) + scoreOverlap(args.marketTokens, nodeTokens);
    if (overlap <= 0) continue;
    const prior = Math.max(0.08, Math.min(0.95, ((node.score || 50) / 100) * 0.8 + overlap * 0.06));
    nodes.push({ id: `graph:${node.term}`, prior });
    edges.push({
      source: `event:${args.eventTitle}`,
      target: `graph:${node.term}`,
      weight: Math.min(100, 26 + overlap * 18 + (node.score || 0) * 0.35),
      relationType: node.domain || 'graph-link',
    });
    edges.push({
      source: `graph:${node.term}`,
      target: `market:${args.marketSymbol}`,
      weight: Math.min(100, 24 + overlap * 16 + (node.score || 0) * 0.28),
      relationType: node.domain || 'graph-link',
    });
  }

  for (const graphEdge of args.graph?.edges || []) {
    if (!nodes.some((node) => node.id === `graph:${graphEdge.source}`) || !nodes.some((node) => node.id === `graph:${graphEdge.target}`)) {
      continue;
    }
    edges.push({
      source: `graph:${graphEdge.source}`,
      target: `graph:${graphEdge.target}`,
      weight: Math.min(100, graphEdge.weight),
      relationType: graphEdge.relationType,
    });
  }

  for (const entry of args.ontologyTerms) {
    const overlap = scoreOverlap(args.eventTokens, entry.tokens) + scoreOverlap(args.marketTokens, entry.tokens);
    if (overlap <= 0) continue;
    const prior = Math.max(0.1, Math.min(0.92, 0.18 + overlap * 0.08));
    nodes.push({ id: `entity:${entry.entity.canonicalName}`, prior });
    edges.push({
      source: `event:${args.eventTitle}`,
      target: `entity:${entry.entity.canonicalName}`,
      weight: Math.min(100, 28 + overlap * 16),
      relationType: entry.entity.entityType || 'entity-link',
    });
    edges.push({
      source: `entity:${entry.entity.canonicalName}`,
      target: `market:${args.marketSymbol}`,
      weight: Math.min(100, 24 + overlap * 14),
      relationType: entry.entity.entityType || 'entity-link',
    });
  }

  return runGraphBeliefPropagation(nodes, edges, { iterations: 5, damping: 0.34 }).posteriorByNode;
}

export async function recomputeMultiHopInferences(args: {
  transmission: EventMarketTransmissionSnapshot | null;
  keywordGraph: KeywordGraphSnapshot | null | undefined;
  ontologyEntities: CanonicalEntity[];
}): Promise<MultiHopInferenceAlert[]> {
  await ensureLoaded();
  const transmissionEdges = args.transmission?.edges ?? [];
  const graphEdges = args.keywordGraph?.edges ?? [];
  const ontology = args.ontologyEntities ?? [];
  const ontologyTerms = ontology.map((entity) => ({
    entity,
    tokens: tokenize([entity.canonicalName, ...(entity.aliases || [])].join(' ')),
  }));

  const nextAlerts: MultiHopInferenceAlert[] = [];

  for (const edge of transmissionEdges.slice(0, 36)) {
    const eventTokens = tokenize([edge.eventTitle, edge.reason, ...(edge.keywords || [])].join(' '));
    const marketTokens = tokenize([edge.marketSymbol, edge.marketName, edge.relationType].join(' '));
    const posteriorByNode = buildInferencePosterior({
      eventTitle: edge.eventTitle,
      marketSymbol: edge.marketSymbol,
      eventTokens,
      marketTokens,
      graph: args.keywordGraph,
      ontologyTerms,
      transmissionStrength: edge.strength,
    });

    const relatedGraphEdges = graphEdges
      .map((graphEdge) => {
        const sourceTokens = tokenize(graphEdge.source);
        const targetTokens = tokenize(graphEdge.target);
        const overlap = scoreOverlap(eventTokens, [...sourceTokens, ...targetTokens]) + scoreOverlap(marketTokens, [...sourceTokens, ...targetTokens]);
        const posteriorScore = Math.max(
          posteriorByNode[`graph:${graphEdge.source}`] ?? 0,
          posteriorByNode[`graph:${graphEdge.target}`] ?? 0,
        );
        return { graphEdge, overlap, posteriorScore };
      })
      .filter((item) => item.overlap > 0 || item.posteriorScore >= 55)
      .sort((a, b) => ((b.posteriorScore * 1.2) + b.overlap * 100 + b.graphEdge.weight) - ((a.posteriorScore * 1.2) + a.overlap * 100 + a.graphEdge.weight))
      .slice(0, 3);

    const relatedOntology = ontologyTerms
      .map((entry) => ({
        entity: entry.entity,
        overlap: scoreOverlap(eventTokens, entry.tokens) + scoreOverlap(marketTokens, entry.tokens),
        posteriorScore: posteriorByNode[`entity:${entry.entity.canonicalName}`] ?? 0,
      }))
      .filter((entry) => entry.overlap > 0 || entry.posteriorScore >= 55)
      .sort((a, b) => (b.posteriorScore * 1.2 + b.overlap * 10) - (a.posteriorScore * 1.2 + a.overlap * 10))
      .slice(0, 2);

    for (const item of relatedGraphEdges) {
      const bridgeTerms = [item.graphEdge.source, item.graphEdge.target].filter(Boolean);
      const ontologyBridge = relatedOntology[0]?.entity?.canonicalName;
      const chain = [
        edge.eventTitle,
        ...(ontologyBridge ? [ontologyBridge] : []),
        ...bridgeTerms,
        edge.marketSymbol,
      ].slice(0, 5);
      const confidence = Math.max(
        30,
        Math.min(
          98,
          Math.round(
            edge.strength * 0.58
            + item.graphEdge.weight * 0.9
            + item.overlap * 6
            + relatedOntology.length * 7
            + item.posteriorScore * 0.18
            + (relatedOntology[0]?.posteriorScore || 0) * 0.12,
          ),
        ),
      );
      const severity: MultiHopInferenceAlert['severity'] = confidence >= 82 ? 'high' : confidence >= 62 ? 'medium' : 'info';
      const category = inferCategory(chain);
      const relationLabel = item.graphEdge.relationType || 'cooccurrence';
      nextAlerts.push({
        id: `${edge.id}::${item.graphEdge.source}::${item.graphEdge.target}`.toLowerCase(),
        title: `${edge.eventTitle} -> ${edge.marketSymbol}`,
        severity,
        category,
        confidence,
        summary: `${edge.eventTitle} is propagating through ${bridgeTerms.join(' / ')} toward ${edge.marketSymbol}. relation=${relationLabel}, transmission=${edge.relationType}, propagated_posterior=${Math.round(item.posteriorScore)}.`,
        chain,
        evidence: [
          edge.reason,
          `${item.graphEdge.source} -> ${item.graphEdge.target} (${relationLabel}, ${item.graphEdge.weight})`,
          `propagated=${Math.round(item.posteriorScore)}`,
          ...(ontologyBridge ? [`ontology=${ontologyBridge}`] : []),
        ].filter(Boolean),
        generatedAt: new Date().toISOString(),
      });
    }
  }

  currentAlerts = Array.from(
    new Map(
      nextAlerts
        .sort((a, b) => b.confidence - a.confidence)
        .map((alert) => [alert.id, alert]),
    ).values(),
  ).slice(0, MAX_ALERTS);

  await persist();
  await logSourceOpsEvent({
    kind: 'transmission',
    action: 'multi-hop-recomputed',
    actor: 'system',
    title: 'Multi-hop inference updated',
    detail: `alerts=${currentAlerts.length}`,
    status: 'ok',
    category: 'multi-hop',
  });
  return currentAlerts;
}

export async function listMultiHopInferences(limit = 40): Promise<MultiHopInferenceAlert[]> {
  await ensureLoaded();
  return currentAlerts.slice(0, Math.max(1, limit));
}
