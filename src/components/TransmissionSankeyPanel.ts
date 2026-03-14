import { Panel } from './Panel';
import type { EventMarketTransmissionEdge, EventMarketTransmissionSnapshot } from '@/services/event-market-transmission';
import type { SourceCredibilityProfile } from '@/services/source-credibility';
import { escapeHtml } from '@/utils/sanitize';

interface SankeyNode {
  id: string;
  shortLabel: string;
  column: 0 | 1 | 2;
  value: number;
  x: number;
  y: number;
  height: number;
  color: string;
}

interface SankeyLink {
  id: string;
  sourceId: string;
  targetId: string;
  value: number;
  color: string;
  title: string;
}

const RELATION_LABELS: Record<EventMarketTransmissionEdge['relationType'], string> = {
  commodity: 'Commodity',
  equity: 'Equity',
  currency: 'FX',
  rates: 'Rates',
  country: 'Country',
  'supply-chain': 'Supply',
};

const RELATION_COLORS: Record<EventMarketTransmissionEdge['relationType'], string> = {
  commodity: '#f59e0b',
  equity: '#38bdf8',
  currency: '#34d399',
  rates: '#a78bfa',
  country: '#f97316',
  'supply-chain': '#5eead4',
};

function truncate(value: string, max = 28): string {
  const clean = String(value || '').trim();
  if (clean.length <= max) return clean;
  return `${clean.slice(0, Math.max(0, max - 3))}...`;
}

function buildPath(source: SankeyNode, target: SankeyNode): string {
  const startX = source.x + 18;
  const startY = source.y + (source.height / 2);
  const endX = target.x;
  const endY = target.y + (target.height / 2);
  const controlA = startX + (endX - startX) * 0.36;
  const controlB = startX + (endX - startX) * 0.68;
  return `M ${startX.toFixed(1)} ${startY.toFixed(1)} C ${controlA.toFixed(1)} ${startY.toFixed(1)}, ${controlB.toFixed(1)} ${endY.toFixed(1)}, ${endX.toFixed(1)} ${endY.toFixed(1)}`;
}

function layoutColumn(nodes: SankeyNode[], x: number, top: number, height: number): SankeyNode[] {
  if (nodes.length === 0) return [];
  const gap = 12;
  const total = nodes.reduce((sum, node) => sum + node.value, 0);
  const usable = Math.max(120, height - gap * (nodes.length - 1));
  const pxPerUnit = usable / Math.max(1, total);
  let cursor = top;
  return nodes.map((node) => {
    const nextHeight = Math.max(22, node.value * pxPerUnit);
    const laidOut: SankeyNode = { ...node, x, y: cursor, height: nextHeight };
    cursor += nextHeight + gap;
    return laidOut;
  });
}

function averageCredibility(
  edges: EventMarketTransmissionEdge[],
  credibility: SourceCredibilityProfile[],
): number {
  if (!edges.length || !credibility.length) return 0;
  const scoreBySource = new Map(
    credibility.map((item) => [String(item.source || '').toLowerCase(), item.credibilityScore]),
  );
  const scores = edges
    .map((edge) => scoreBySource.get(String(edge.eventSource || '').toLowerCase()))
    .filter((score): score is number => Number.isFinite(score));
  if (!scores.length) return 0;
  return Math.round(scores.reduce((sum, score) => sum + score, 0) / scores.length);
}

function aggregateLinks(links: SankeyLink[], maxCount: number): SankeyLink[] {
  return Array.from(
    links.reduce((map, link) => {
      const previous = map.get(link.id);
      if (previous) {
        previous.value += link.value;
        return map;
      }
      map.set(link.id, { ...link });
      return map;
    }, new Map<string, SankeyLink>()).values(),
  )
    .sort((a, b) => b.value - a.value)
    .slice(0, maxCount);
}

function renderNetworkView(
  leftNodes: SankeyNode[],
  midNodes: SankeyNode[],
  rightNodes: SankeyNode[],
  links: SankeyLink[],
): string {
  const width = 920;
  const height = 280;
  const left = leftNodes.map((node, index) => ({
    ...node,
    x: 120,
    y: 48 + index * 34 + (index % 2) * 8,
  }));
  const mid = midNodes.map((node, index) => ({
    ...node,
    x: 460,
    y: 44 + index * 38,
  }));
  const right = rightNodes.map((node, index) => ({
    ...node,
    x: 790,
    y: 48 + index * 34 + ((index + 1) % 2) * 8,
  }));
  const nodeMap = new Map<string, SankeyNode>([
    ...left.map((node) => [node.id, node] as const),
    ...mid.map((node) => [node.id, node] as const),
    ...right.map((node) => [node.id, node] as const),
  ]);

  const edges = links.map((link) => {
    const source = nodeMap.get(link.sourceId);
    const target = nodeMap.get(link.targetId);
    if (!source || !target) return '';
    return `
      <line
        x1="${source.x.toFixed(1)}"
        y1="${source.y.toFixed(1)}"
        x2="${target.x.toFixed(1)}"
        y2="${target.y.toFixed(1)}"
        class="transmission-force-link"
        stroke="${link.color}"
        stroke-width="${Math.max(1.5, Math.min(8, link.value / 12)).toFixed(1)}"
        stroke-opacity="0.4"
      />
    `;
  }).join('');

  const nodes = [...left, ...mid, ...right].map((node) => `
    <g class="transmission-force-node">
      <circle cx="${node.x.toFixed(1)}" cy="${node.y.toFixed(1)}" r="${Math.max(8, Math.min(16, node.value / 10)).toFixed(1)}" fill="${node.color}" fill-opacity="0.92" />
      <text x="${node.x.toFixed(1)}" y="${(node.y + 24).toFixed(1)}" text-anchor="middle" class="transmission-force-label">${escapeHtml(truncate(node.shortLabel, 18))}</text>
    </g>
  `).join('');

  return `
    <div class="intel-viz-card">
      <div class="intel-viz-card-head">
        <div class="investment-mini-label">Transmission Network</div>
        <div class="backtest-lab-note">Event -> channel -> market map sized by transfer force</div>
      </div>
      <svg viewBox="0 0 ${width} ${height}" class="intel-viz-svg transmission-force-svg" aria-label="Transmission force graph">
        ${edges}
        ${nodes}
      </svg>
    </div>
  `;
}

export class TransmissionSankeyPanel extends Panel {
  private snapshot: EventMarketTransmissionSnapshot | null = null;
  private credibility: SourceCredibilityProfile[] = [];

  constructor() {
    super({ id: 'transmission-sankey', title: 'Flow Sankey', showCount: true });
  }

  public setData(
    snapshot: EventMarketTransmissionSnapshot | null,
    credibility: SourceCredibilityProfile[] = [],
  ): void {
    this.snapshot = snapshot;
    this.credibility = credibility;
    this.renderPanel();
  }

  private renderPanel(): void {
    const edges = (this.snapshot?.edges || []).slice(0, 18);
    if (edges.length === 0) {
      this.showError('No event-to-market transmission flows');
      return;
    }

    const eventTotals = new Map<string, number>();
    const relationTotals = new Map<string, number>();
    const marketTotals = new Map<string, number>();
    const eventToRelationLinks: SankeyLink[] = [];
    const relationToMarketLinks: SankeyLink[] = [];

    for (const edge of edges) {
      const eventId = `event:${edge.eventTitle}`;
      const relationId = `relation:${edge.relationType}`;
      const marketId = `market:${edge.marketSymbol}`;
      const relationLabel = RELATION_LABELS[edge.relationType] || edge.relationType;
      const color = RELATION_COLORS[edge.relationType] || '#7dd3fc';
      eventTotals.set(eventId, (eventTotals.get(eventId) || 0) + edge.strength);
      relationTotals.set(relationId, (relationTotals.get(relationId) || 0) + edge.strength);
      marketTotals.set(marketId, (marketTotals.get(marketId) || 0) + edge.strength);

      eventToRelationLinks.push({
        id: `${eventId}->${relationId}`,
        sourceId: eventId,
        targetId: relationId,
        value: edge.strength,
        color,
        title: `${edge.eventTitle} -> ${relationLabel}`,
      });
      relationToMarketLinks.push({
        id: `${relationId}->${marketId}`,
        sourceId: relationId,
        targetId: marketId,
        value: edge.strength,
        color,
        title: `${relationLabel} -> ${edge.marketSymbol}`,
      });
    }

    const leftNodes = Array.from(eventTotals.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([id, value]) => ({
        id,
        shortLabel: truncate(id.replace(/^event:/, ''), 30),
        column: 0 as const,
        value,
        x: 0,
        y: 0,
        height: 0,
        color: '#93c5fd',
      }));
    const midNodes = Array.from(relationTotals.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([id, value]) => {
        const relationType = id.replace(/^relation:/, '') as EventMarketTransmissionEdge['relationType'];
        return {
          id,
          shortLabel: RELATION_LABELS[relationType] || relationType,
          column: 1 as const,
          value,
          x: 0,
          y: 0,
          height: 0,
          color: RELATION_COLORS[relationType] || '#7dd3fc',
        };
      });
    const rightNodes = Array.from(marketTotals.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([id, value]) => ({
        id,
        shortLabel: truncate(id.replace(/^market:/, ''), 18),
        column: 2 as const,
        value,
        x: 0,
        y: 0,
        height: 0,
        color: '#34d399',
      }));

    const leftIds = new Set(leftNodes.map((node) => node.id));
    const midIds = new Set(midNodes.map((node) => node.id));
    const rightIds = new Set(rightNodes.map((node) => node.id));
    const linkA = aggregateLinks(eventToRelationLinks, 18)
      .filter((link) => leftIds.has(link.sourceId) && midIds.has(link.targetId));
    const linkB = aggregateLinks(relationToMarketLinks, 18)
      .filter((link) => midIds.has(link.sourceId) && rightIds.has(link.targetId));

    const leftLayout = layoutColumn(leftNodes, 70, 44, 300);
    const midLayout = layoutColumn(midNodes, 454, 44, 300);
    const rightLayout = layoutColumn(rightNodes, 826, 44, 300);
    const nodeMap = new Map<string, SankeyNode>([
      ...leftLayout.map((node) => [node.id, node] as const),
      ...midLayout.map((node) => [node.id, node] as const),
      ...rightLayout.map((node) => [node.id, node] as const),
    ]);

    const svgLinks = [...linkA, ...linkB]
      .map((link) => {
        const source = nodeMap.get(link.sourceId);
        const target = nodeMap.get(link.targetId);
        if (!source || !target) return '';
        return `
          <path
            d="${buildPath(source, target)}"
            fill="none"
            stroke="${link.color}"
            stroke-opacity="0.42"
            stroke-width="${Math.max(2, Math.min(18, link.value / 8)).toFixed(1)}"
            stroke-linecap="round"
          >
            <title>${escapeHtml(link.title)} | ${link.value.toFixed(0)}</title>
          </path>
        `;
      })
      .join('');

    const svgNodes = [...leftLayout, ...midLayout, ...rightLayout]
      .map((node) => {
        const labelX = node.column === 2 ? node.x - 10 : node.x + 26;
        const anchor = node.column === 2 ? 'end' : 'start';
        return `
          <g class="sankey-node-group">
            <rect
              x="${node.x.toFixed(1)}"
              y="${node.y.toFixed(1)}"
              width="18"
              height="${node.height.toFixed(1)}"
              rx="5"
              fill="${node.color}"
              fill-opacity="0.86"
            />
            <text x="${labelX.toFixed(1)}" y="${(node.y + node.height / 2 + 4).toFixed(1)}" text-anchor="${anchor}" class="sankey-node-label">${escapeHtml(node.shortLabel)}</text>
          </g>
        `;
      })
      .join('');

    const topCorridors = edges
      .slice()
      .sort((a, b) => b.strength - a.strength)
      .slice(0, 4);
    const avgCred = averageCredibility(edges, this.credibility);
    const networkView = renderNetworkView(leftLayout, midLayout, rightLayout, [...linkA, ...linkB]);

    this.setCount(edges.length);
    this.setContent(`
      <div class="intel-viz-panel intel-viz-panel-sankey">
        <div class="intel-viz-stats">
          <span class="intel-viz-stat">Flows <b>${edges.length}</b></span>
          <span class="intel-viz-stat">Sources <b>${new Set(edges.map((edge) => edge.eventSource)).size}</b></span>
          <span class="intel-viz-stat">Avg credibility <b>${avgCred || 'n/a'}</b></span>
          <span class="intel-viz-stat">Updated <b>${escapeHtml(new Date(this.snapshot?.generatedAt || Date.now()).toLocaleTimeString())}</b></span>
        </div>
        <div class="intel-viz-card">
          <svg viewBox="0 0 920 390" class="intel-viz-svg sankey-svg" aria-label="Event to market sankey">
            <text x="70" y="24" class="intel-viz-axis-label">EVENTS</text>
            <text x="454" y="24" class="intel-viz-axis-label">TRANSMISSION</text>
            <text x="826" y="24" text-anchor="end" class="intel-viz-axis-label">MARKETS</text>
            ${svgLinks}
            ${svgNodes}
          </svg>
        </div>
        ${networkView}
        <div class="intel-viz-list">
          ${topCorridors.map((edge) => `
            <div class="intel-viz-list-item">
              <strong>${escapeHtml(truncate(edge.eventTitle, 52))}</strong>
              <span>${escapeHtml(edge.marketSymbol)} | ${escapeHtml(RELATION_LABELS[edge.relationType] || edge.relationType)} | ${edge.strength}</span>
            </div>
          `).join('')}
        </div>
      </div>
    `);
  }
}
