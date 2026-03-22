
import type { KeywordGraphSnapshot } from './keyword-registry';

export interface GraphRagSummary {
  generatedAt: string;
  summary: string;
  globalThemes: string[];
  keyRisks: string[];
  structuralGaps: string[];
  hierarchyLines: string[];
}

/**
 * Generates a summary of the keyword graph using RAG-inspired techniques (simulated).
 */
export function summarizeGraphRag(snapshot: KeywordGraphSnapshot | null): GraphRagSummary {
  if (!snapshot || snapshot.nodes.length === 0) {
    return {
      generatedAt: new Date().toISOString(),
      summary: 'No graph data available for analysis.',
      globalThemes: [],
      keyRisks: [],
      structuralGaps: [],
      hierarchyLines: [],
    };
  }

  const topNodes = snapshot.nodes.slice(0, 10).map(n => n.term);
  
  return {
    generatedAt: new Date().toISOString(),
    summary: `The graph is currently dominated by ${topNodes.slice(0, 3).join(', ')}. Relationship density is nominal.`,
    globalThemes: topNodes.slice(0, 5),
    keyRisks: ['Supply chain convergence', 'Geopolitical escalation'],
    structuralGaps: ['Missing maritime correlation', 'Aviation data latency'],
    hierarchyLines: topNodes.map(t => `Entity: ${t}`),
  };
}
