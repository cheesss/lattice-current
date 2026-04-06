import * as d3 from 'd3';
import { sankey, sankeyLinkHorizontal, SankeyNode, SankeyLink } from 'd3-sankey';

export interface SankeyFlowNode {
  id: string;
  label: string;
  column: 'event' | 'theme' | 'asset';
}

export interface SankeyFlowLink {
  source: string;
  target: string;
  value: number;
  direction: 'positive' | 'negative';
}

export interface SankeyFlowConfig {
  containerId: string;
  nodes: SankeyFlowNode[];
  links: SankeyFlowLink[];
  width: number;
  height: number;
  margin?: { top: number; right: number; bottom: number; left: number };
  onNodeClick?: (node: SankeyFlowNode) => void;
}

interface SNode {
  id: string;
  nodeIndex: number;
  label: string;
  column: string;
}

interface SLink {
  source: number;
  target: number;
  value: number;
  direction: string;
}

export function renderSankeyFlow(config: SankeyFlowConfig): void {
  const container = document.getElementById(config.containerId);
  if (!container) return;
  if (!config.nodes.length || !config.links.length) {
    container.innerHTML = '<p class="intel-sankey-empty">No data</p>';
    return;
  }

  const margin = config.margin ?? { top: 20, right: 20, bottom: 30, left: 60 };
  const w = config.width - margin.left - margin.right;
  const h = config.height - margin.top - margin.bottom;

  d3.select(container).selectAll('*').remove();

  // Map ids to indices
  const idToIdx = new Map(config.nodes.map((n, i) => [n.id, i]));
  const sNodes: SNode[] = config.nodes.map((n, i) => ({ ...n, nodeIndex: i }));
  const sLinks: SLink[] = config.links
    .filter((l) => idToIdx.has(l.source) && idToIdx.has(l.target))
    .map((l) => ({
      source: idToIdx.get(l.source)!,
      target: idToIdx.get(l.target)!,
      value: Math.max(l.value, 1),
      direction: l.direction,
    }));

  const sankeyGen = sankey<SNode, SLink>()
    .nodeId((d: SNode) => d.nodeIndex)
    .nodeWidth(18)
    .nodePadding(14)
    .nodeAlign((_node: SankeyNode<SNode, SLink>) => {
      const col = ((_node as unknown) as SNode).column;
      if (col === 'event') return 0;
      if (col === 'theme') return 1;
      return 2;
    })
    .extent([
      [0, 0],
      [w, h],
    ]);

  const { nodes, links } = sankeyGen({
    nodes: sNodes.map((d) => ({ ...d })),
    links: sLinks.map((d) => ({ ...d })),
  });

  const svg = d3
    .select(container)
    .append('svg')
    .attr('width', config.width)
    .attr('height', config.height)
    .attr('class', 'intel-sankey-flow');

  const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);

  // Links
  g.selectAll('.intel-sankey-link')
    .data(links)
    .join('path')
    .attr('class', 'intel-sankey-link')
    .attr('d', sankeyLinkHorizontal())
    .attr('fill', 'none')
    .attr('stroke', (d) =>
      ((d as unknown) as SLink).direction === 'positive'
        ? 'rgba(76,175,80,0.45)'
        : 'rgba(244,67,54,0.45)'
    )
    .attr('stroke-width', (d: SankeyLink<SNode, SLink>) => Math.max(1, d.width ?? 1))
    .attr('opacity', 0.7);

  // Nodes
  g.selectAll('.intel-sankey-node')
    .data(nodes)
    .join('rect')
    .attr('class', 'intel-sankey-node')
    .attr('x', (d: SankeyNode<SNode, SLink>) => d.x0 ?? 0)
    .attr('y', (d: SankeyNode<SNode, SLink>) => d.y0 ?? 0)
    .attr('width', (d: SankeyNode<SNode, SLink>) => (d.x1 ?? 0) - (d.x0 ?? 0))
    .attr('height', (d: SankeyNode<SNode, SLink>) => Math.max(1, (d.y1 ?? 0) - (d.y0 ?? 0)))
    .attr('fill', '#4fc3f7')
    .attr('rx', 3)
    .style('cursor', 'pointer')
    .on('click', (_event: MouseEvent, d: SankeyNode<SNode, SLink>) => {
      const orig = config.nodes.find((n) => n.id === (d as unknown as SNode).id);
      if (orig) config.onNodeClick?.(orig);
    });

  // Labels
  g.selectAll('.intel-sankey-label')
    .data(nodes)
    .join('text')
    .attr('class', 'intel-sankey-label')
    .attr('x', (d: SankeyNode<SNode, SLink>) => {
      const mid = ((d.x0 ?? 0) + (d.x1 ?? 0)) / 2;
      return mid < w / 2 ? (d.x1 ?? 0) + 6 : (d.x0 ?? 0) - 6;
    })
    .attr('y', (d: SankeyNode<SNode, SLink>) => ((d.y0 ?? 0) + (d.y1 ?? 0)) / 2)
    .attr('text-anchor', (d: SankeyNode<SNode, SLink>) => {
      const mid = ((d.x0 ?? 0) + (d.x1 ?? 0)) / 2;
      return mid < w / 2 ? 'start' : 'end';
    })
    .attr('dominant-baseline', 'middle')
    .attr('fill', '#ccc')
    .attr('font-size', '11px')
    .text((d: SankeyNode<SNode, SLink>) => {
      const sn = d as unknown as SNode;
      return `${sn.label} (${d.value ?? 0})`;
    });

  // Column headers
  const colLabels = [
    { text: 'Events', x: 0 },
    { text: 'Themes', x: w / 2 },
    { text: 'Assets', x: w },
  ];
  colLabels.forEach((cl) => {
    g.append('text')
      .attr('x', cl.x)
      .attr('y', -6)
      .attr('text-anchor', 'middle')
      .attr('fill', '#888')
      .attr('font-size', '11px')
      .attr('font-weight', '600')
      .text(cl.text);
  });
}
