import type { KeywordGraphSnapshot } from './keyword-registry';

export interface GraphRagCommunity {
  id: string;
  nodeTerms: string[];
  edgeCount: number;
  avgScore: number;
  strongestRelations: Array<{
    source: string;
    target: string;
    relationType?: string;
    weight: number;
  }>;
}

export interface GraphRagSummary {
  generatedAt: string;
  communityCount: number;
  globalThemes: string[];
  communities: GraphRagCommunity[];
  hierarchyLines: string[];
}

function buildAdjacency(edges: KeywordGraphSnapshot['edges']): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>();
  for (const edge of edges) {
    if (!map.has(edge.source)) map.set(edge.source, new Set());
    if (!map.has(edge.target)) map.set(edge.target, new Set());
    map.get(edge.source)!.add(edge.target);
    map.get(edge.target)!.add(edge.source);
  }
  return map;
}

function connectedComponents(nodes: string[], adjacency: Map<string, Set<string>>): string[][] {
  const visited = new Set<string>();
  const components: string[][] = [];

  for (const node of nodes) {
    if (visited.has(node)) continue;
    const queue = [node];
    const component: string[] = [];
    visited.add(node);

    while (queue.length > 0) {
      const current = queue.shift()!;
      component.push(current);
      for (const neighbor of adjacency.get(current) || []) {
        if (visited.has(neighbor)) continue;
        visited.add(neighbor);
        queue.push(neighbor);
      }
    }
    components.push(component);
  }
  return components;
}

function scoreThemeFrequency(terms: string[]): string[] {
  const bucket = new Map<string, number>();
  for (const term of terms) {
    const parts = term
      .toLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .filter(token => token.length >= 4);
    for (const part of parts) {
      bucket.set(part, (bucket.get(part) || 0) + 1);
    }
  }
  return Array.from(bucket.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12)
    .map(([term]) => term);
}

export function buildGraphRagSummary(snapshot: KeywordGraphSnapshot): GraphRagSummary {
  const nodeMap = new Map(snapshot.nodes.map(node => [node.term, node]));
  const adjacency = buildAdjacency(snapshot.edges);
  const components = connectedComponents(snapshot.nodes.map(node => node.term), adjacency);

  const communities: GraphRagCommunity[] = components
    .map((terms, idx) => {
      const edgeSubset = snapshot.edges
        .filter(edge => terms.includes(edge.source) && terms.includes(edge.target));
      const avgScore = terms.length > 0
        ? terms.reduce((sum, term) => sum + (nodeMap.get(term)?.score || 0), 0) / terms.length
        : 0;
      const strongestRelations = edgeSubset
        .sort((a, b) => b.weight - a.weight)
        .slice(0, 8)
        .map(edge => ({
          source: edge.source,
          target: edge.target,
          relationType: edge.relationType,
          weight: edge.weight,
        }));
      return {
        id: `community-${idx + 1}`,
        nodeTerms: terms
          .sort((a, b) => (nodeMap.get(b)?.score || 0) - (nodeMap.get(a)?.score || 0))
          .slice(0, 16),
        edgeCount: edgeSubset.length,
        avgScore: Math.round(avgScore * 10) / 10,
        strongestRelations,
      };
    })
    .sort((a, b) => (b.avgScore * (b.edgeCount + 1)) - (a.avgScore * (a.edgeCount + 1)));

  const globalThemes = scoreThemeFrequency(snapshot.nodes.map(node => node.term));

  const hierarchyLines: string[] = [];
  hierarchyLines.push(`GRAPH_RAG_GLOBAL_THEMES: ${globalThemes.slice(0, 8).join(', ') || 'none'}`);
  for (const community of communities.slice(0, 8)) {
    const keyTerms = community.nodeTerms.slice(0, 6).join(', ');
    const relationHints = community.strongestRelations
      .slice(0, 4)
      .map(relation => `${relation.source}-${relation.target}:${relation.relationType || 'cooccurrence'}(${relation.weight})`)
      .join(' | ');
    hierarchyLines.push(
      `GRAPH_RAG_COMMUNITY ${community.id}: avgScore=${community.avgScore}; edges=${community.edgeCount}; keyTerms=${keyTerms}; relations=${relationHints || 'none'}`
    );
  }

  return {
    generatedAt: new Date().toISOString(),
    communityCount: communities.length,
    globalThemes,
    communities,
    hierarchyLines,
  };
}
