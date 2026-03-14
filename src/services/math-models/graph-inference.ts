export interface GraphInferenceNode {
  id: string;
  prior: number;
}

export interface GraphInferenceEdge {
  source: string;
  target: string;
  weight: number;
  relationType?: string;
}

export interface GraphInferenceResult {
  posteriorByNode: Record<string, number>;
  iterations: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function logit(value: number): number {
  const safe = clamp(value, 1e-5, 1 - 1e-5);
  return Math.log(safe / (1 - safe));
}

function sigmoid(value: number): number {
  if (value >= 0) {
    const z = Math.exp(-value);
    return 1 / (1 + z);
  }
  const z = Math.exp(value);
  return z / (1 + z);
}

function compatibilityWeight(relationType?: string): number {
  const normalized = String(relationType || '').toLowerCase();
  if (!normalized) return 0.55;
  if (/(sanction|signal|conflict|threat|attack|supply|market)/.test(normalized)) return 0.88;
  if (/(owned_by|capital|trade|energy|technology)/.test(normalized)) return 0.74;
  if (/(cooccurrence|related)/.test(normalized)) return 0.46;
  return 0.6;
}

export function runGraphBeliefPropagation(
  nodes: GraphInferenceNode[],
  edges: GraphInferenceEdge[],
  options: { iterations?: number; damping?: number } = {},
): GraphInferenceResult {
  const nodeMap = new Map(nodes.map((node) => [node.id, clamp(node.prior, 0.01, 0.99)]));
  const nextMap = new Map(nodeMap);
  const adjacency = new Map<string, GraphInferenceEdge[]>();

  for (const edge of edges) {
    const forward = adjacency.get(edge.source) || [];
    forward.push(edge);
    adjacency.set(edge.source, forward);
    const reverse = adjacency.get(edge.target) || [];
    reverse.push({ ...edge, source: edge.target, target: edge.source });
    adjacency.set(edge.target, reverse);
  }

  const iterations = Math.max(2, Math.min(8, Math.round(options.iterations ?? 4)));
  const damping = clamp(options.damping ?? 0.4, 0.05, 0.8);

  for (let iteration = 0; iteration < iterations; iteration += 1) {
    for (const node of nodes) {
      const prior = nodeMap.get(node.id) ?? 0.5;
      const neighbors = adjacency.get(node.id) || [];
      const energy = neighbors.reduce((sum, edge) => {
        const neighborPosterior = nodeMap.get(edge.target) ?? 0.5;
        const centered = (neighborPosterior - 0.5) * 2;
        return sum + centered * (edge.weight / 100) * compatibilityWeight(edge.relationType);
      }, 0);
      const posterior = sigmoid(logit(prior) + energy);
      const blended = prior * damping + posterior * (1 - damping);
      nextMap.set(node.id, clamp(blended, 0.01, 0.99));
    }
    for (const [nodeId, posterior] of nextMap.entries()) {
      nodeMap.set(nodeId, posterior);
    }
  }

  return {
    posteriorByNode: Object.fromEntries(
      Array.from(nodeMap.entries()).map(([nodeId, posterior]) => [nodeId, Number((posterior * 100).toFixed(2))]),
    ),
    iterations,
  };
}
