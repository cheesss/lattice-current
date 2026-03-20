import { runGraphBeliefPropagation, type GraphInferenceEdge, type GraphInferenceNode, type GraphInferenceResult } from './math-models/graph-inference';

export type KnowledgeGraphNodeKind =
  | 'theme'
  | 'asset'
  | 'source'
  | 'dataset'
  | 'sector'
  | 'country'
  | 'commodity'
  | 'policy'
  | 'event'
  | 'macro'
  | 'relation';

export interface KnowledgeGraphNode extends GraphInferenceNode {
  kind?: KnowledgeGraphNodeKind;
  label?: string;
  metadata?: Record<string, unknown>;
}

export interface KnowledgeGraphRelationEvidence {
  from: string;
  to: string;
  relationType: string;
  sourceId?: string;
  sourceFamily?: string;
  strength?: number;
  confidence?: number;
  corroboration?: number;
  leadLagScore?: number;
  recencyDays?: number;
  coverageScore?: number;
  truthAgreement?: number;
  contradictionPenalty?: number;
  supportCount?: number;
  notes?: string[];
}

export interface KnowledgeGraphRelationScore {
  from: string;
  to: string;
  relationType: string;
  evidenceScore: number;
  confidenceScore: number;
  supportScore: number;
  coverageScore: number;
  leadLagScore: number;
  contradictionPenalty: number;
  evidenceCount: number;
  notes: string[];
}

export interface KnowledgeGraphSummary {
  dominantRelationType: string;
  pairKey: string;
  supportScore: number;
  confidenceScore: number;
  evidenceCount: number;
  evidence: KnowledgeGraphRelationScore[];
  notes: string[];
}

export interface KnowledgeGraphInferenceResult extends GraphInferenceResult {
  relationSummaries: KnowledgeGraphSummary[];
}

export interface KnowledgeGraphInferenceOptions {
  iterations?: number;
  damping?: number;
  priorFloor?: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function normalize(value: string): string {
  return String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function average(values: number[]): number {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function relationAffinity(relationType: string): number {
  const normalized = normalize(relationType);
  if (!normalized) return 0.62;
  if (/(sanction|supply|supply-chain|trade|ownership|exposure|policy|conflict|risk|pipeline|shipping|logistics|dependency|dependence)/.test(normalized)) {
    return 0.9;
  }
  if (/(correlat|cooccurrence|related|linked|signal|propagation|transmission|lead|lag|spillover)/.test(normalized)) {
    return 0.76;
  }
  if (/(commodity|energy|rates|currency|macro|sector|country|asset|theme)/.test(normalized)) {
    return 0.68;
  }
  return 0.62;
}

function recencyWeight(recencyDays?: number): number {
  if (!Number.isFinite(recencyDays ?? NaN)) return 0.66;
  const days = Math.max(0, Number(recencyDays) || 0);
  return clamp(Number(Math.exp(-days / 120).toFixed(4)), 0.12, 1);
}

function scoreFromEvidence(evidence: KnowledgeGraphRelationEvidence): KnowledgeGraphRelationScore {
  const strength = clamp(Number(evidence.strength) || 0, 0, 100);
  const confidence = clamp(Number(evidence.confidence) || 0, 0, 100);
  const corroboration = clamp(Number(evidence.corroboration) || 0, 0, 100);
  const leadLag = clamp(Number(evidence.leadLagScore) || 0, -100, 100);
  const coverage = clamp(Number(evidence.coverageScore) || 0, 0, 100);
  const truthAgreement = clamp(Number(evidence.truthAgreement) || 0, 0, 100);
  const contradictionPenalty = clamp(Number(evidence.contradictionPenalty) || 0, 0, 100);
  const supportCount = Math.max(1, Math.round(Number(evidence.supportCount) || 1));
  const recency = recencyWeight(evidence.recencyDays);
  const affinity = relationAffinity(evidence.relationType);
  const directionalBonus = leadLag >= 0 ? clamp(leadLag / 100, 0, 1) : clamp(1 + leadLag / 160, 0.18, 1);

  const baseScore = clamp(
    Math.round(
      strength * 0.24
      + confidence * 0.22
      + corroboration * 0.18
      + truthAgreement * 0.12
      + coverage * 0.08
      + recency * 100 * 0.1
      + directionalBonus * 100 * 0.06
      - contradictionPenalty * 0.22,
    ),
    0,
    100,
  );
  const supportScore = clamp(Math.round(baseScore * affinity), 0, 100);

  const notes = Array.from(new Set([
    ...(evidence.notes || []),
    supportScore >= 70 ? 'Relation evidence is strong enough for propagation.' : 'Relation evidence is still tentative.',
    contradictionPenalty > 0 ? 'Contradiction penalty is present.' : '',
    leadLag > 0 ? 'Positive lead-lag support was detected.' : leadLag < 0 ? 'Negative lead-lag signal weakens support.' : '',
  ].filter(Boolean)));

  return {
    from: evidence.from,
    to: evidence.to,
    relationType: evidence.relationType,
    evidenceScore: baseScore,
    confidenceScore: Math.round(confidence * 100),
    supportScore,
    coverageScore: coverage,
    leadLagScore: leadLag,
    contradictionPenalty,
    evidenceCount: supportCount,
    notes,
  };
}

export function scoreKnowledgeRelationEvidence(evidence: KnowledgeGraphRelationEvidence): KnowledgeGraphRelationScore {
  return scoreFromEvidence(evidence);
}

export function summarizeKnowledgeRelations(evidenceList: KnowledgeGraphRelationEvidence[]): KnowledgeGraphSummary[] {
  const grouped = new Map<string, KnowledgeGraphRelationScore[]>();

  for (const evidence of evidenceList || []) {
    if (!evidence?.from || !evidence?.to || !evidence?.relationType) continue;
    const scored = scoreFromEvidence(evidence);
    const key = `${normalize(scored.from)}::${normalize(scored.to)}`;
    const bucket = grouped.get(key) || [];
    bucket.push(scored);
    grouped.set(key, bucket);
  }

  const summaries: KnowledgeGraphSummary[] = [];
  for (const [pairKey, scoredRelations] of grouped.entries()) {
    const byRelationType = new Map<string, KnowledgeGraphRelationScore[]>();
    for (const scored of scoredRelations) {
      const bucket = byRelationType.get(normalize(scored.relationType)) || [];
      bucket.push(scored);
      byRelationType.set(normalize(scored.relationType), bucket);
    }

    let dominantRelationType = scoredRelations[0]?.relationType || 'related';
    let bestSupport = -1;
    let bestConfidence = 0;
    const notes = new Set<string>();

    for (const [relationType, bucket] of byRelationType.entries()) {
      const support = average(bucket.map((entry) => entry.supportScore));
      const confidence = average(bucket.map((entry) => entry.confidenceScore));
      for (const entry of bucket) {
        for (const note of entry.notes) {
          notes.add(note);
        }
      }
      if (support > bestSupport || (support === bestSupport && confidence > bestConfidence)) {
        bestSupport = support;
        bestConfidence = confidence;
        dominantRelationType = relationType;
      }
    }

    summaries.push({
      dominantRelationType,
      pairKey,
      supportScore: Math.round(bestSupport),
      confidenceScore: Math.round(bestConfidence),
      evidenceCount: scoredRelations.reduce((sum, entry) => sum + entry.evidenceCount, 0),
      evidence: scoredRelations,
      notes: Array.from(notes).slice(0, 8),
    });
  }

  return summaries.sort((a, b) => b.supportScore - a.supportScore || b.confidenceScore - a.confidenceScore);
}

export function buildKnowledgeGraphNodes(
  items: Array<Pick<KnowledgeGraphNode, 'id' | 'prior' | 'kind' | 'label' | 'metadata'>>,
  evidenceList: KnowledgeGraphRelationEvidence[] = [],
  options: KnowledgeGraphInferenceOptions = {},
): KnowledgeGraphNode[] {
  const priorFloor = clamp(options.priorFloor ?? 0.18, 0.05, 0.45);
  const nodeMap = new Map<string, KnowledgeGraphNode>();

  for (const item of items || []) {
    if (!item?.id) continue;
    nodeMap.set(item.id, {
      id: item.id,
      prior: clamp(Number(item.prior) || 0.5, priorFloor, 0.99),
      kind: item.kind,
      label: item.label,
      metadata: item.metadata,
    });
  }

  for (const evidence of evidenceList || []) {
    if (!evidence?.from || !evidence?.to) continue;
    const scored = scoreFromEvidence(evidence);
    const prior = clamp(0.34 + scored.supportScore / 180, priorFloor, 0.88);
    if (!nodeMap.has(evidence.from)) {
      nodeMap.set(evidence.from, { id: evidence.from, prior, kind: 'relation' });
    }
    if (!nodeMap.has(evidence.to)) {
      nodeMap.set(evidence.to, { id: evidence.to, prior, kind: 'relation' });
    }
  }

  return Array.from(nodeMap.values());
}

export function buildKnowledgeGraphEdges(evidenceList: KnowledgeGraphRelationEvidence[]): GraphInferenceEdge[] {
  return (evidenceList || [])
    .filter((evidence) => Boolean(evidence?.from && evidence?.to && evidence?.relationType))
    .map((evidence) => {
      const scored = scoreFromEvidence(evidence);
      return {
        source: scored.from,
        target: scored.to,
        relationType: scored.relationType,
        weight: scored.supportScore,
      };
    });
}

export function inferKnowledgeGraphSupport(
  nodes: Array<Pick<KnowledgeGraphNode, 'id' | 'prior' | 'kind' | 'label' | 'metadata'>>,
  evidenceList: KnowledgeGraphRelationEvidence[],
  options: KnowledgeGraphInferenceOptions = {},
): KnowledgeGraphInferenceResult {
  const builtNodes = buildKnowledgeGraphNodes(nodes, evidenceList, options);
  const edges = buildKnowledgeGraphEdges(evidenceList);
  const inference = runGraphBeliefPropagation(
    builtNodes.map((node) => ({ id: node.id, prior: node.prior })),
    edges,
    { iterations: options.iterations, damping: options.damping },
  );

  const summaries = summarizeKnowledgeRelations(evidenceList);
  return {
    ...inference,
    relationSummaries: summaries,
  };
}
