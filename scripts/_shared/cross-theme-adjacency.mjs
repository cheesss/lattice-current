import { loadResearchOsPolicy, requirePolicyNumber } from './research-os-policy.mjs';
import { normalizeKnowledgeKey, stableResearchOsId } from './adjacency-graph.mjs';
import { scoreNonObviousBottleneckDiscovery } from './non-obvious-bottleneck-discovery.mjs';
import { evaluateParentCandidateReadiness, parentReadinessMetadata } from './parent-candidate-readiness.mjs';
import { evaluateFrontierParentCandidate, frontierParentMetadata } from './frontier-parent-selection.mjs';

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function toNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function unique(values) {
  return [...new Set(asArray(values).map((value) => String(value || '').trim()).filter(Boolean))];
}

function nodeId(node) {
  return String(node?.id || `${node?.nodeType || node?.node_type}:${node?.normalizedKey || node?.normalized_key || normalizeKnowledgeKey(node?.canonicalName || node?.canonical_name)}`);
}

function mapNode(row) {
  return {
    id: nodeId(row),
    nodeType: row.nodeType || row.node_type,
    canonicalName: row.canonicalName || row.canonical_name,
    normalizedKey: row.normalizedKey || row.normalized_key || normalizeKnowledgeKey(row.canonicalName || row.canonical_name),
    aliases: asArray(row.aliases),
    status: row.status || 'candidate',
    metadata: row.metadata || {},
  };
}

function mapEdge(row) {
  return {
    id: String(row.id || stableResearchOsId([row.sourceId || row.source_node_id, row.relationType || row.relation_type, row.targetId || row.target_node_id])),
    sourceId: String(row.sourceId || row.source_node_id),
    targetId: String(row.targetId || row.target_node_id),
    relationType: row.relationType || row.relation_type,
    confidence: toNumber(row.confidence, 0),
    evidenceCount: toNumber(row.evidenceCount ?? row.evidence_count, 0),
    sourceDiversity: toNumber(row.sourceDiversity ?? row.source_diversity, 0),
    status: row.status || 'candidate',
    createdBy: row.createdBy || row.created_by || 'system',
    metadata: row.metadata || {},
  };
}

export function buildAdjacencyGraphIndex(graph = {}) {
  const nodes = asArray(graph.nodes).map(mapNode);
  const edges = asArray(graph.edges).map(mapEdge);
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const byTheme = new Map();
  for (const node of nodes) {
    if (node.nodeType === 'theme') {
      byTheme.set(normalizeKnowledgeKey(node.normalizedKey || node.canonicalName), node);
    }
  }
  const outgoing = new Map();
  const incoming = new Map();
  for (const edge of edges) {
    if (!outgoing.has(edge.sourceId)) outgoing.set(edge.sourceId, []);
    if (!incoming.has(edge.targetId)) incoming.set(edge.targetId, []);
    outgoing.get(edge.sourceId).push(edge);
    incoming.get(edge.targetId).push(edge);
  }
  return { nodes, edges, byId, byTheme, outgoing, incoming };
}

export function expandThemeNeighborhood(index, themeKey, options = {}) {
  const maxHops = Math.max(1, Number(options.maxHops || 3));
  const theme = index.byTheme.get(normalizeKnowledgeKey(themeKey));
  if (!theme) return new Map();
  const seen = new Map();
  const queue = [{ node: theme, hop: 0, path: [theme.id], confidence: 1, evidenceCount: 0, sourceDiversity: 0 }];
  seen.set(theme.id, queue[0]);
  while (queue.length) {
    const current = queue.shift();
    if (current.hop >= maxHops) continue;
    for (const edge of index.outgoing.get(current.node.id) || []) {
      const target = index.byId.get(edge.targetId);
      if (!target) continue;
      const next = {
        node: target,
        hop: current.hop + 1,
        path: [...current.path, target.id],
        confidence: Math.min(current.confidence, edge.confidence || 0),
        evidenceCount: current.evidenceCount + toNumber(edge.evidenceCount, 0),
        sourceDiversity: Math.max(current.sourceDiversity, toNumber(edge.sourceDiversity, 0)),
        via: edge,
      };
      const previous = seen.get(target.id);
      if (!previous || next.hop < previous.hop || next.confidence > previous.confidence) {
        seen.set(target.id, next);
        queue.push(next);
      }
    }
  }
  seen.delete(theme.id);
  return seen;
}

function nodeRole(node) {
  const type = node?.nodeType || '';
  if (['company', 'supplier'].includes(type)) return 'supplier';
  if (['component', 'material', 'process', 'infrastructure', 'technology'].includes(type)) return 'connector';
  return 'context';
}

function isGenericNoiseNode(node, policy) {
  const terms = new Set(asArray(policy?.scoring?.genericNoise?.terms).map(normalizeKnowledgeKey).filter(Boolean));
  const key = normalizeKnowledgeKey(node?.canonicalName || node?.normalizedKey);
  if (!key) return false;
  if (terms.has(key)) return true;
  return asArray(node?.aliases).map(normalizeKnowledgeKey).some((alias) => terms.has(alias));
}

function nodeDiscoveryProfile(node = {}) {
  const metadata = node.metadata || {};
  const importance = Math.max(0, Math.min(1, toNumber(metadata.discoveryImportance, 0)));
  const constraintScore = Math.max(0, Math.min(1, toNumber(metadata.constraintScore, 0)));
  const geopoliticalRelevance = Math.max(0, Math.min(1, toNumber(metadata.geopoliticalRelevance, 0)));
  const technicalMaturity = Math.max(0, Math.min(1, toNumber(metadata.technicalMaturity, 0)));
  const discoveryFit = Math.max(
    importance,
    constraintScore * 0.95,
    geopoliticalRelevance * 0.7,
    technicalMaturity * 0.5,
  );
  return {
    role: metadata.discoveryRole || null,
    ontologyKey: metadata.ontologyKey || null,
    ontologyLabel: metadata.ontologyLabel || null,
    importance,
    constraintScore,
    geopoliticalRelevance,
    technicalMaturity,
    discoveryFit,
    mechanism: metadata.mechanism || null,
    whyNow: metadata.whyNow || null,
    triggerTerms: unique(metadata.triggerTerms),
    sourceQueries: unique(metadata.sourceQueries),
    symbol: metadata.symbol || null,
  };
}

function similarityToSeeds(node, seedExamples = []) {
  const name = normalizeKnowledgeKey(node?.canonicalName || node?.normalizedKey);
  if (!name) return 0;
  let best = 0;
  for (const seed of seedExamples || []) {
    const terms = [
      ...(seed.expectedConnectors || []),
      ...(seed.expectedSuppliers || []),
      ...(seed.seedTerms || []),
    ].map(normalizeKnowledgeKey).filter(Boolean);
    for (const term of terms) {
      if (!term) continue;
      if (term === name) best = Math.max(best, 1);
      else if (term.includes(name) || name.includes(term)) best = Math.max(best, 0.7);
      else {
        const left = new Set(name.split('-'));
        const right = new Set(term.split('-'));
        const overlap = [...left].filter((part) => right.has(part)).length;
        const denom = Math.max(left.size, right.size, 1);
        best = Math.max(best, overlap / denom);
      }
    }
  }
  return Math.min(1, best);
}

function classifyLane(score, novelty, evidenceQuality, feedbackState, policy) {
  if (feedbackState === 'rejected') return 'rejected';
  if (feedbackState === 'accepted') return 'validated';
  if (evidenceQuality < requirePolicyNumber(policy, 'scoring.lanes.weakEvidenceMin')) return 'needs_evidence';
  if (score >= requirePolicyNumber(policy, 'scoring.lanes.watchScoreMin')) return 'watch';
  if (novelty >= requirePolicyNumber(policy, 'scoring.lanes.weirdNoveltyMin')) return 'weird_but_rising';
  return 'exploration';
}

function enforceSeedDependenceCap(candidates, policy) {
  const maxCandidates = Math.max(1, Number(policy.automation.maxCandidatesPerRun || candidates.length));
  const cap = requirePolicyNumber(policy, 'seedDependenceRatioMax');
  const explorationQuotaMin = requirePolicyNumber(policy, 'explorationQuotaMin');
  const explorationLanes = new Set(['exploration', 'weird_but_rising', 'needs_evidence']);
  const seedSimilar = [];
  const nonSeed = [];
  for (const candidate of candidates) {
    if (candidate.evidenceSummary.seedSimilarity > 0) seedSimilar.push(candidate);
    else nonSeed.push(candidate);
  }
  const selected = [];
  let seedCount = 0;
  const selectedIds = new Set();
  const canAddCandidate = (candidate) => {
    if (!candidate || selectedIds.has(candidate.id) || selected.length >= maxCandidates) return false;
    if (candidate.evidenceSummary.seedSimilarity <= 0) return true;
    return (seedCount + 1) / (selected.length + 1) <= cap;
  };
  const addCandidate = (candidate) => {
    selected.push(candidate);
    selectedIds.add(candidate.id);
    if (candidate.evidenceSummary.seedSimilarity > 0) seedCount += 1;
  };
  for (const candidate of nonSeed) {
    if (selected.length >= maxCandidates) break;
    addCandidate(candidate);
  }
  for (const candidate of seedSimilar) {
    if (!canAddCandidate(candidate)) continue;
    addCandidate(candidate);
  }

  function explorationCountOf(items) {
    return items.filter((candidate) => explorationLanes.has(candidate.lane)).length;
  }

  function meetsExplorationQuota(items) {
    if (!items.length) return true;
    return explorationCountOf(items) / items.length >= explorationQuotaMin;
  }

  if (!meetsExplorationQuota(selected)) {
    const explorationPool = candidates
      .filter((candidate) => explorationLanes.has(candidate.lane) && !selectedIds.has(candidate.id))
      .sort((left, right) => right.score - left.score || right.evidenceSummary.novelty - left.evidenceSummary.novelty);
    for (const candidate of explorationPool) {
      if (meetsExplorationQuota(selected)) break;
      if (canAddCandidate(candidate)) {
        addCandidate(candidate);
        continue;
      }
      if (candidate.evidenceSummary.seedSimilarity > 0) {
        const replaceIndex = selected.findIndex((item) => item.evidenceSummary.seedSimilarity > 0 && !explorationLanes.has(item.lane));
        if (replaceIndex >= 0) {
          selectedIds.delete(selected[replaceIndex].id);
          selected[replaceIndex] = candidate;
          selectedIds.add(candidate.id);
        }
      }
    }
  }
  const backlog = candidates
    .filter((candidate) => !selectedIds.has(candidate.id))
    .map((candidate) => ({
      ...candidate,
      status: 'research_backlog',
      lane: candidate.lane === 'validated' ? candidate.lane : 'needs_evidence',
      metadata: {
        ...(candidate.metadata || {}),
        backlogReason: candidate.evidenceSummary.seedSimilarity > 0 ? 'seed-dependence-cap' : 'candidate-limit',
      },
    }));
  return {
    selected: selected
      .map((candidate) => ({ ...candidate, status: candidate.status || 'new' }))
      .sort((left, right) => right.score - left.score || right.evidenceSummary.novelty - left.evidenceSummary.novelty),
    backlog,
  };
}

export function scoreCrossThemeConnectors(input = {}, policy = loadResearchOsPolicy()) {
  const index = buildAdjacencyGraphIndex(input.graph || input);
  const themes = unique(input.themes || asArray(input.hotThemes).map((theme) => theme.key || theme.theme));
  const themeHeat = new Map(asArray(input.hotThemes).map((theme) => [
    normalizeKnowledgeKey(theme.key || theme.theme || theme.name),
    Math.max(toNumber(theme.heat), toNumber(theme.momentum), toNumber(theme.temperature)),
  ]));
  const feedback = new Map(asArray(input.feedback).map((item) => [String(item.candidateId || item.id || item.connectorNodeId), item.decision]));
  const neighborhoods = new Map();
  for (const theme of themes) {
    neighborhoods.set(normalizeKnowledgeKey(theme), expandThemeNeighborhood(index, theme, {
      maxHops: input.maxHops || requirePolicyNumber(policy, 'generation.maxGraphHops'),
    }));
  }

  const weights = policy.scoring.weights;
  const seedCap = requirePolicyNumber(policy, 'seedSimilarityWeightMax');
  const explorationQuotaMin = requirePolicyNumber(policy, 'explorationQuotaMin');
  const candidates = [];

  for (let i = 0; i < themes.length; i += 1) {
    for (let j = i + 1; j < themes.length; j += 1) {
      const leftKey = normalizeKnowledgeKey(themes[i]);
      const rightKey = normalizeKnowledgeKey(themes[j]);
      const left = neighborhoods.get(leftKey) || new Map();
      const right = neighborhoods.get(rightKey) || new Map();
      const commonIds = [...left.keys()].filter((id) => right.has(id));
      for (const commonId of commonIds) {
        const node = index.byId.get(commonId);
        const role = nodeRole(node);
        if (role === 'context') continue;
        const leftPath = left.get(commonId);
        const rightPath = right.get(commonId);
        const directEvidenceCount = leftPath.evidenceCount + rightPath.evidenceCount;
        const sourceDiversityRaw = Math.max(leftPath.sourceDiversity, rightPath.sourceDiversity);
        const evidenceQuality = Math.min(1, directEvidenceCount / Math.max(1, requirePolicyNumber(policy, 'trustedPromotion.minDirectEvidence') * 2));
        const sourceDiversity = Math.min(1, sourceDiversityRaw / Math.max(1, requirePolicyNumber(policy, 'trustedPromotion.minSourceDiversity')));
        const crossThemeOverlap = 1;
        const recencyMomentum = Math.min(1, Math.min(themeHeat.get(leftKey) || 0.5, themeHeat.get(rightKey) || 0.5));
        const supplierCentrality = Math.min(1, (index.incoming.get(commonId) || []).length / Math.max(1, themes.length));
        const seedSimilarity = Math.min(seedCap, similarityToSeeds(node, input.seedExamples || []));
        const novelty = Math.max(0, 1 - seedSimilarity);
        const discovery = nodeDiscoveryProfile(node);
        const feedbackState = feedback.get(commonId);
        const genericNoise = isGenericNoiseNode(node, policy);
        const genericNoiseFloor = requirePolicyNumber(policy, 'scoring.genericNoise.evidenceFloor');
        if (genericNoise
          && policy?.scoring?.genericNoise?.excludeBelowEvidenceFloor !== false
          && evidenceQuality < genericNoiseFloor) {
          continue;
        }
        const reviewedPenalty = feedbackState === 'rejected' ? toNumber(policy.scoring.penalties.reviewedReject) : 0;
        const weakPenalty = evidenceQuality < requirePolicyNumber(policy, 'scoring.lanes.weakEvidenceMin') ? toNumber(policy.scoring.penalties.weakRelation) : 0;
        const genericPenalty = genericNoise ? toNumber(policy.scoring.penalties.genericNoise) : 0;
        const discoveryFitWeight = toNumber(policy.scoring.weights.discoveryFit, 0.16);
        const constraintWeight = toNumber(policy.scoring.weights.constraintCriticality, 0.12);
        const geopoliticalWeight = toNumber(policy.scoring.weights.geopoliticalRelevance, 0.06);
        const nonObviousDiscovery = scoreNonObviousBottleneckDiscovery({
          phrase: node.canonicalName || node.normalizedKey,
          sentence: [
            discovery.mechanism,
            discovery.whyNow,
            ...discovery.triggerTerms,
            ...discovery.sourceQueries,
          ].join(' '),
          context: {
            themes: [leftKey, rightKey],
            domains: [leftKey, rightKey],
            ontologyKey: discovery.ontologyKey,
            sourceTerms: discovery.triggerTerms,
            consensusTerms: asArray(input.consensusTerms),
          },
          relationSupport: directEvidenceCount,
          sourceDiversity: sourceDiversityRaw,
          evidenceClasses: discovery.role ? [discovery.role] : [],
        });
        const nonObviousBonus = (Number(nonObviousDiscovery.frontierScore || 0) / 100) * toNumber(policy.scoring.weights.nonObviousFrontier, 0.1);
        const consensusPenalty = Number(nonObviousDiscovery.consensusPenalty || 0) * toNumber(policy.scoring.penalties.consensusNarrative, 0.12);
        const score = Math.max(0, Math.min(1,
          evidenceQuality * weights.evidenceQuality
          + sourceDiversity * weights.sourceDiversity
          + crossThemeOverlap * weights.crossThemeOverlap
          + recencyMomentum * weights.recencyMomentum
          + novelty * weights.novelty
          + supplierCentrality * weights.supplierCentrality
          + seedSimilarity * weights.seedSimilarity
          + discovery.discoveryFit * discoveryFitWeight
          + discovery.constraintScore * constraintWeight
          + discovery.geopoliticalRelevance * geopoliticalWeight
          + nonObviousBonus
          - reviewedPenalty
          - weakPenalty
          - genericPenalty
          - consensusPenalty,
        ));
        const whyNow = discovery.whyNow ? ` Why now: ${discovery.whyNow}` : '';
        const mechanism = discovery.mechanism ? ` Mechanism: ${discovery.mechanism}` : '';
        const evidenceSummary = {
          evidenceQuality,
          sourceDiversity,
          sourceDiversityRaw,
          directEvidenceCount,
          crossThemeOverlap,
          recencyMomentum,
          novelty,
          supplierCentrality,
          seedSimilarity,
          leftPath: leftPath.path,
          rightPath: rightPath.path,
          discovery,
          discoveryFit: discovery.discoveryFit,
          constraintCriticality: discovery.constraintScore,
          geopoliticalRelevance: discovery.geopoliticalRelevance,
          nonObviousDiscovery,
        };
        const parentReadiness = evaluateParentCandidateReadiness({
          evidenceSummary,
          metadata: { nonObviousDiscovery },
        });
        const frontierParent = evaluateFrontierParentCandidate({
          label: node.canonicalName || node.normalizedKey,
          nodeType: node.nodeType,
          role,
          evidenceSummary,
          metadata: { nonObviousDiscovery },
          parentReadiness,
        });
        candidates.push({
          id: stableResearchOsId([leftKey, rightKey, commonId]),
          themes: [leftKey, rightKey],
          connectorNodeId: role === 'connector' ? commonId : null,
          supplierNodeId: role === 'supplier' ? commonId : null,
          node,
          score,
          lane: classifyLane(score, novelty, evidenceQuality, feedbackState, policy),
          reason: `${node.canonicalName} is a ${discovery.role || role} candidate connecting ${leftKey} and ${rightKey} through shared dependency graph overlap.${mechanism}${whyNow}`,
          evidenceSummary: {
            ...evidenceSummary,
            ...parentReadinessMetadata({ evidenceSummary, metadata: { nonObviousDiscovery } }),
            ...frontierParentMetadata({
              label: node.canonicalName || node.normalizedKey,
              nodeType: node.nodeType,
              role,
              evidenceSummary,
              metadata: { nonObviousDiscovery },
              parentReadiness,
            }),
          },
          metadata: {
            role,
            genericNoise,
            feedbackState: feedbackState || null,
            discovery,
            nonObviousDiscovery,
            ...parentReadinessMetadata({ evidenceSummary, metadata: { nonObviousDiscovery } }),
            ...frontierParentMetadata({
              label: node.canonicalName || node.normalizedKey,
              nodeType: node.nodeType,
              role,
              evidenceSummary,
              metadata: { nonObviousDiscovery },
              parentReadiness,
            }),
            parentSelection: {
              selectedBecause: frontierParent.frontierParentReportReady
                ? 'frontier_parent_report_ready'
                : parentReadiness.parentReadyForAdjacent
                  ? frontierParent.frontierParentReason
                : parentReadiness.parentReadinessReason,
              parentReadinessState: parentReadiness.parentReadinessState,
              parentReadyForAdjacent: parentReadiness.parentReadyForAdjacent,
              frontierParentState: frontierParent.frontierParentState,
              frontierParentReportReady: frontierParent.frontierParentReportReady,
              frontierParentCollectionEligible: frontierParent.frontierParentCollectionEligible,
            },
          },
        });
      }
    }
  }

  const deduped = [...new Map(candidates
    .sort((left, right) => right.score - left.score || right.evidenceSummary.novelty - left.evidenceSummary.novelty)
    .map((candidate) => [candidate.id, candidate])).values()];
  const capped = enforceSeedDependenceCap(deduped, policy);
  const selected = capped.selected;
  const explorationCount = selected.filter((candidate) => ['exploration', 'weird_but_rising', 'needs_evidence'].includes(candidate.lane)).length;
  const seedSimilarCount = selected.filter((candidate) => candidate.evidenceSummary.seedSimilarity > 0).length;
  return {
    ok: true,
    candidates: selected,
    backlogCandidates: capped.backlog,
    metrics: {
      total: deduped.length,
      selected: selected.length,
      backlog: capped.backlog.length,
      explorationCount,
      explorationRate: selected.length ? explorationCount / selected.length : 0,
      explorationQuotaMin,
      seedSimilarCount,
      seedDependenceRatio: selected.length ? seedSimilarCount / selected.length : 0,
    },
  };
}
