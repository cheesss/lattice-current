import type { CanonicalEntity, CanonicalEntityType } from './entity-ontology';
import type {
  KeywordGraphNode,
  KeywordGraphSnapshot,
  OntologyConstraintViolation,
  TemporalRelationType,
} from './keyword-registry';
import { isLowSignalKeywordTerm, listOntologyConstraintViolations } from './keyword-registry';

export type OntologyGraphNodeKind = CanonicalEntityType | 'event';
export type OntologyGraphRelationType = TemporalRelationType | 'event_subject' | 'event_target' | 'event_location';
export type OntologyPropertyValue =
  | string
  | number
  | boolean
  | null
  | OntologyPropertyValue[]
  | { [key: string]: OntologyPropertyValue };
export type OntologyPropertyBag = Record<string, OntologyPropertyValue>;

export interface OntologyGraphNodeRecord {
  id: string;
  label: string;
  nodeType: OntologyGraphNodeKind;
  category: 'entity' | 'event';
  canonicalId?: string;
  domain?: string;
  score?: number;
  meta?: Record<string, string | number | boolean | null>;
  properties?: OntologyPropertyBag;
}

export interface OntologyGraphEdgeRecord {
  id: string;
  source: string;
  target: string;
  relationType: OntologyGraphRelationType;
  weight: number;
  inferred?: boolean;
  eventId?: string | null;
  validFrom?: string | null;
  validUntil?: string | null;
  active?: boolean;
  evidence?: string[];
  properties?: OntologyPropertyBag;
}

export interface OntologyGraphSnapshot {
  generatedAt: string;
  nodes: OntologyGraphNodeRecord[];
  edges: OntologyGraphEdgeRecord[];
  eventNodes: OntologyGraphNodeRecord[];
  inferredEdges: OntologyGraphEdgeRecord[];
  violations: OntologyConstraintViolation[];
}

interface BuildOntologyGraphInput {
  keywordGraph: KeywordGraphSnapshot | null;
  entities: CanonicalEntity[];
}

interface EntityLookupRecord {
  id: string;
  label: string;
  nodeType: CanonicalEntityType;
  aliases: string[];
  confidence: number;
  source: CanonicalEntity['source'];
}

const ONTOLOGY_TYPED_NODE_TYPES = new Set<CanonicalEntityType>([
  'country',
  'company',
  'technology',
  'commodity',
  'waterway',
  'organization',
  'person',
  'location',
  'asset',
]);

const REIFIABLE_RELATIONS = new Set<TemporalRelationType>([
  'sanction',
  'inferred_sanction',
  'conflict',
  'cooperation',
  'capital_flow',
  'tech_transfer',
  'supply_chain',
  'owned_by',
  'signal',
]);

function normalizeText(value: string): string {
  return String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function slugify(value: string): string {
  return normalizeText(value)
    .replace(/[^\p{L}\p{N}\s\-_/+.]/gu, '')
    .replace(/\s+/g, '-')
    .slice(0, 72);
}

function prettifyRelation(relationType: OntologyGraphRelationType): string {
  return String(relationType || '')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function truncate(value: string, max = 96): string {
  const clean = String(value || '').trim();
  if (clean.length <= max) return clean;
  return `${clean.slice(0, Math.max(0, max - 3))}...`;
}

function sanitizeEvidenceLine(value: string): string {
  let clean = String(value || '').replace(/\s+/g, ' ').trim();
  if (!clean) return '';
  clean = clean.replace(/^[\-:|•\s]+/, '');
  clean = clean.replace(/\s+[|]\s+[^|]+$/, '');
  clean = clean.replace(/\s+-\s+(reuters|ap news|bbc|cnn|guardian|france 24|dw news|euronews|al jazeera|haaretz)$/i, '');
  return truncate(clean, 110);
}

function isWeakEventHeadline(value: string): boolean {
  const clean = sanitizeEvidenceLine(value);
  if (!clean || clean.length < 12) return true;
  if (/\b(live updates?|what we know|analysis demand|editorial agenda)\b/i.test(clean)) return true;
  return false;
}

function buildEntityLookup(entities: CanonicalEntity[]): { byId: Map<string, EntityLookupRecord>; all: EntityLookupRecord[] } {
  const byId = new Map<string, EntityLookupRecord>();
  const all: EntityLookupRecord[] = [];
  for (const entity of entities) {
    const record: EntityLookupRecord = {
      id: entity.id,
      label: entity.canonicalName,
      nodeType: entity.entityType,
      aliases: [entity.canonicalName, ...(entity.aliases || [])].map((alias) => normalizeText(alias)).filter(Boolean),
      confidence: Math.max(0, Math.min(100, Math.round(entity.confidence || 0))),
      source: entity.source,
    };
    byId.set(record.id, record);
    all.push(record);
  }
  return { byId, all };
}

function getNodeId(node: KeywordGraphNode): string {
  return node.canonicalId || `term:${node.term}`;
}

function findLocationMatches(evidence: string[] | undefined, entityLookup: EntityLookupRecord[]): EntityLookupRecord[] {
  const text = normalizeText((evidence || []).join(' '));
  if (!text) return [];
  return entityLookup
    .filter((entity) => ['waterway', 'location', 'country'].includes(entity.nodeType))
    .filter((entity) => entity.aliases.some((alias) => alias && text.includes(alias)))
    .slice(0, 3);
}

function dedupeEdges(edges: OntologyGraphEdgeRecord[]): OntologyGraphEdgeRecord[] {
  const map = new Map<string, OntologyGraphEdgeRecord>();
  for (const edge of edges) {
    if (!map.has(edge.id)) map.set(edge.id, edge);
  }
  return Array.from(map.values());
}

function isPromotableOntologyNode(node: KeywordGraphNode, entity: EntityLookupRecord | null): boolean {
  const nodeType = entity?.nodeType || node.entityType || 'unknown';
  const nodeScore = Number(node.score || 0);
  const entityConfidence = Math.max(0, Math.min(100, Math.round(entity?.confidence ?? node.entityConfidence ?? 0)));
  const labels = [node.term, node.canonicalName || '', entity?.label || ''].map((value) => normalizeText(value)).filter(Boolean);

  if (!ONTOLOGY_TYPED_NODE_TYPES.has(nodeType)) return false;
  if (labels.some((value) => isLowSignalKeywordTerm(value))) return false;
  if (entityConfidence < 58) return false;
  if (nodeScore < 34) return false;
  if (node.status === 'retired') return false;
  return true;
}

function isPromotableOntologyEdge(edge: OntologyGraphEdgeRecord): boolean {
  if (!edge.active) return false;
  if (edge.source === edge.target) return false;
  if (edge.relationType === 'cooccurrence') return edge.weight >= 8;
  if (edge.relationType === 'signal') return edge.weight >= 4;
  return edge.weight >= 1;
}

function buildBaseOntologyGraph(
  input: BuildOntologyGraphInput,
): { nodes: OntologyGraphNodeRecord[]; edges: OntologyGraphEdgeRecord[]; entityLookup: Map<string, EntityLookupRecord> } {
  const lookup = buildEntityLookup(input.entities);
  const graph = input.keywordGraph;
  if (!graph) {
    return { nodes: [], edges: [], entityLookup: lookup.byId };
  }

  const nodeMap = new Map<string, OntologyGraphNodeRecord>();
  const sortedNodes = graph.nodes
    .slice()
    .sort((a, b) => Number(b.score || 0) - Number(a.score || 0));

  for (const node of sortedNodes) {
    const canonicalId = getNodeId(node);
    const entity = node.canonicalId ? lookup.byId.get(node.canonicalId) || null : null;
    if (!isPromotableOntologyNode(node, entity)) continue;
    const existing = nodeMap.get(canonicalId);
    const nextScore = Math.max(Number(existing?.score || 0), Number(node.score || 0), Number(entity?.confidence || 0));
    nodeMap.set(canonicalId, {
      id: canonicalId,
      label: entity?.label || node.canonicalName || node.term,
      nodeType: entity?.nodeType || node.entityType || 'unknown',
      category: 'entity',
      canonicalId: node.canonicalId,
      domain: node.domain,
      score: nextScore,
      meta: {
        sourceTerm: node.term,
        status: node.status,
        entityConfidence: entity?.confidence ?? node.entityConfidence ?? null,
        entitySource: entity?.source || node.entitySource || null,
      },
      properties: {
        sourceTerm: node.term,
        canonicalName: entity?.label || node.canonicalName || node.term,
        canonicalId: node.canonicalId || null,
        domain: node.domain,
        status: node.status,
        score: Number(node.score || 0),
        weight: Number(node.weight || 0),
        entityType: entity?.nodeType || node.entityType || 'unknown',
        entityConfidence: entity?.confidence ?? node.entityConfidence ?? null,
        entitySource: entity?.source || node.entitySource || null,
      },
    });
  }

  const edges = graph.edges
    .map<OntologyGraphEdgeRecord>((edge) => ({
      id: `edge:${edge.relationType || 'cooccurrence'}:${edge.sourceCanonicalId || edge.source}:${edge.targetCanonicalId || edge.target}:${edge.validFrom || 'na'}`,
      source: edge.sourceCanonicalId || `term:${edge.source}`,
      target: edge.targetCanonicalId || `term:${edge.target}`,
      relationType: edge.relationType || 'cooccurrence',
      weight: edge.weight,
      validFrom: edge.validFrom || null,
      validUntil: edge.validUntil || null,
      active: edge.active ?? true,
      evidence: edge.evidence || [],
      properties: {
        relationType: edge.relationType || 'cooccurrence',
        weight: Number(edge.weight || 0),
        validFrom: edge.validFrom || null,
        validUntil: edge.validUntil || null,
        active: edge.active ?? true,
        evidence: (edge.evidence || []).slice(0, 4),
      },
    }))
    .filter((edge) => nodeMap.has(edge.source) && nodeMap.has(edge.target))
    .filter(isPromotableOntologyEdge);

  return {
    nodes: Array.from(nodeMap.values()),
    edges,
    entityLookup: lookup.byId,
  };
}

function inferSanctionEdges(baseEdges: OntologyGraphEdgeRecord[]): OntologyGraphEdgeRecord[] {
  const sanctions = baseEdges.filter((edge) => edge.relationType === 'sanction');
  const ownerships = baseEdges.filter((edge) => edge.relationType === 'owned_by');
  const inferred: OntologyGraphEdgeRecord[] = [];

  for (const sanction of sanctions) {
    for (const ownership of ownerships) {
      if (ownership.target !== sanction.target) continue;
      inferred.push({
        id: `edge:inferred_sanction:${sanction.source}:${ownership.source}:${sanction.validFrom || 'na'}`,
        source: sanction.source,
        target: ownership.source,
        relationType: 'inferred_sanction',
        weight: Math.max(1, Math.round((sanction.weight + ownership.weight) / 2)),
        inferred: true,
        validFrom: sanction.validFrom || ownership.validFrom || null,
        validUntil: sanction.validUntil || null,
        active: sanction.active && ownership.active,
        evidence: [
          ...(sanction.evidence || []).slice(0, 2),
          ...(ownership.evidence || []).slice(0, 2),
        ],
      });
    }
  }

  return dedupeEdges(inferred);
}

function deriveEventHeadline(edge: OntologyGraphEdgeRecord, sourceLabel: string, targetLabel: string): string {
  const evidenceLines = (edge.evidence || [])
    .map((value) => sanitizeEvidenceLine(value))
    .filter((value) => value && !isWeakEventHeadline(value));
  if (evidenceLines.length > 0) return evidenceLines[0]!;
  return truncate(`${sourceLabel} ${prettifyRelation(edge.relationType)} ${targetLabel}`, 96);
}

function reifyEvents(
  baseEdges: OntologyGraphEdgeRecord[],
  nodes: OntologyGraphNodeRecord[],
  entityLookup: Map<string, EntityLookupRecord>,
): { eventNodes: OntologyGraphNodeRecord[]; eventEdges: OntologyGraphEdgeRecord[] } {
  const nodeLabelById = new Map(nodes.map((node) => [node.id, node.label] as const));
  const eventNodeMap = new Map<string, OntologyGraphNodeRecord>();
  const eventEdges: OntologyGraphEdgeRecord[] = [];
  const allEntities = Array.from(entityLookup.values());

  for (const edge of baseEdges) {
    if (!REIFIABLE_RELATIONS.has(edge.relationType as TemporalRelationType)) continue;
    const sourceLabel = nodeLabelById.get(edge.source) || edge.source.replace(/^term:/, '');
    const targetLabel = nodeLabelById.get(edge.target) || edge.target.replace(/^term:/, '');
    const headline = deriveEventHeadline(edge, sourceLabel, targetLabel);
    const dayKey = String(edge.validFrom || 'na').slice(0, 10) || 'na';
    const eventKey = `event:${edge.relationType}:${slugify(headline)}:${dayKey}`;
    const existing = eventNodeMap.get(eventKey);

    if (existing) {
      existing.score = Math.max(Number(existing.score || 0), edge.weight);
      if (typeof existing.meta?.observationCount === 'number') {
        existing.meta.observationCount += 1;
      }
      if (existing.properties) {
        existing.properties.observationCount = Number(existing.properties.observationCount || 1) + 1;
      }
    } else {
      eventNodeMap.set(eventKey, {
        id: eventKey,
        label: `${prettifyRelation(edge.relationType)}: ${headline}`,
        nodeType: 'event',
        category: 'event',
        score: edge.weight,
        meta: {
          relationType: edge.relationType,
          active: edge.active ?? true,
          validFrom: edge.validFrom || null,
          validUntil: edge.validUntil || null,
          observationCount: 1,
          primarySource: sourceLabel,
          primaryTarget: targetLabel,
        },
        properties: {
          relationType: edge.relationType,
          headline,
          primarySource: sourceLabel,
          primaryTarget: targetLabel,
          observationCount: 1,
          active: edge.active ?? true,
          validFrom: edge.validFrom || null,
          validUntil: edge.validUntil || null,
          evidence: (edge.evidence || []).map((value) => sanitizeEvidenceLine(value)).filter(Boolean).slice(0, 4),
        },
      });
    }

    eventEdges.push({
      id: `${eventKey}:source:${edge.source}`,
      source: eventKey,
      target: edge.source,
      relationType: 'event_subject',
      weight: edge.weight,
      eventId: eventKey,
      validFrom: edge.validFrom || null,
      validUntil: edge.validUntil || null,
      active: edge.active,
      properties: {
        role: 'source',
        weight: edge.weight,
        parentEvent: eventKey,
      },
    });
    eventEdges.push({
      id: `${eventKey}:target:${edge.target}`,
      source: eventKey,
      target: edge.target,
      relationType: 'event_target',
      weight: edge.weight,
      eventId: eventKey,
      validFrom: edge.validFrom || null,
      validUntil: edge.validUntil || null,
      active: edge.active,
      properties: {
        role: 'target',
        weight: edge.weight,
        parentEvent: eventKey,
      },
    });

    for (const location of findLocationMatches(edge.evidence, allEntities)) {
      eventEdges.push({
        id: `${eventKey}:location:${location.id}`,
        source: eventKey,
        target: location.id,
        relationType: 'event_location',
        weight: Math.max(1, Math.round(edge.weight / 2)),
        eventId: eventKey,
        validFrom: edge.validFrom || null,
        validUntil: edge.validUntil || null,
        active: edge.active,
        evidence: edge.evidence,
        properties: {
          role: 'location',
          matchedLocation: location.label,
          parentEvent: eventKey,
        },
      });
    }
  }

  return {
    eventNodes: Array.from(eventNodeMap.values()),
    eventEdges: dedupeEdges(eventEdges),
  };
}

export async function buildOntologyGraphSnapshot(input: BuildOntologyGraphInput): Promise<OntologyGraphSnapshot | null> {
  const graph = buildBaseOntologyGraph(input);
  if (graph.nodes.length === 0) return null;

  const inferredEdges = inferSanctionEdges(graph.edges);
  const graphEdges = dedupeEdges([...graph.edges, ...inferredEdges]);
  const { eventNodes, eventEdges } = reifyEvents(graphEdges, graph.nodes, graph.entityLookup);
  const violations = await listOntologyConstraintViolations(120).catch(() => []);

  return {
    generatedAt: new Date().toISOString(),
    nodes: [...graph.nodes, ...eventNodes],
    edges: dedupeEdges([...graphEdges, ...eventEdges]),
    eventNodes,
    inferredEdges,
    violations,
  };
}
