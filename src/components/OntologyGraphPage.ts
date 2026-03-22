import type { KeywordGraphSnapshot, KeywordGraphNode, KeywordGraphEdge } from '@/services/keyword-registry';
import type { GraphRagSummary } from '@/services/graph-rag';
import type { ScheduledReport } from '@/services/scheduled-reports';
import type { GraphTimeslice } from '@/services/graph-timeslice';
import type { CanonicalEntity } from '@/services/entity-ontology';
import type { OntologyGraphSnapshot as OntologyGraphSnapshotRecord } from '@/services/ontology-graph';
import type { OntologyLedgerEvent, OntologyReplayState } from '@/services/ontology-event-store';
import type { StixBundle } from '@/services/stix-intel';
import { summarizeGraphTimeline } from '@/services/graph-timeslice';
import {
  approveCanonicalAlias,
  buildOntologyGraphSnapshot,
  listCanonicalEntities,
  mergeCanonicalEntities,
  replayOntologySnapshotAt,
  splitCanonicalAlias,
  summarizeStixBundle,
} from '@/services';
import { escapeHtml } from '@/utils/sanitize';

interface OntologyGraphSnapshot {
  generatedAt: Date;
  keywordGraph: KeywordGraphSnapshot | null;
  ontologyGraph: OntologyGraphSnapshotRecord | null;
  graphRagSummary: GraphRagSummary | null;
  reports: ScheduledReport[];
  timeslices: GraphTimeslice[];
  entities: CanonicalEntity[];
  ledger: OntologyLedgerEvent[];
  replayState: OntologyReplayState | null;
  stixBundle: StixBundle | null;
}

interface OntologyGraphOptions {
  getSnapshot: () => OntologyGraphSnapshot;
}

interface PositionedNode extends KeywordGraphNode {
  x: number;
  y: number;
  r: number;
  color: string;
}

interface BundledNode extends KeywordGraphNode {
  x: number;
  y: number;
  color: string;
  domainHubX: number;
  domainHubY: number;
}

function asDisplayNode(node: OntologyGraphSnapshotRecord['nodes'][number]): KeywordGraphNode {
  return {
    id: node.id,
    term: node.label,
    canonicalId: node.canonicalId,
    canonicalName: node.label,
    entityType: node.nodeType === 'event' ? 'event' : node.nodeType,
    domain: String(node.domain || (node.nodeType === 'event' ? 'mixed' : node.nodeType || 'mixed')) as KeywordGraphNode['domain'],
    status: 'active',
    score: Number(node.score || 0),
    weight: 1,
    lastSeen: null,
  };
}

const DOMAIN_COLORS: Record<string, string> = {
  tech: '#4ea6ff',
  defense: '#ff7b4d',
  energy: '#ffd166',
  bio: '#66d9a3',
  macro: '#b497ff',
  'supply-chain': '#5fd3c7',
  mixed: '#9aa6b2',
};

function relativeTime(value: string): string {
  const ts = new Date(value).getTime();
  if (!Number.isFinite(ts)) return '-';
  const diff = Math.max(0, Date.now() - ts);
  const min = Math.floor(diff / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  const hour = Math.floor(min / 60);
  if (hour < 24) return `${hour}h ago`;
  return `${Math.floor(hour / 24)}d ago`;
}

function renderPropertyBag(value: unknown): string {
  try {
    const text = JSON.stringify(value, null, 2) || '{}';
    return escapeHtml(text.length > 320 ? `${text.slice(0, 317)}...` : text);
  } catch {
    return '{}';
  }
}

function summarizeDomains(nodes: KeywordGraphNode[]): Array<{ domain: string; count: number }> {
  const counts = new Map<string, number>();
  for (const node of nodes) {
    counts.set(node.domain, (counts.get(node.domain) || 0) + 1);
  }
  return Array.from(counts.entries())
    .map(([domain, count]) => ({ domain, count }))
    .sort((a, b) => b.count - a.count);
}

function buildGraphLayout(nodes: KeywordGraphNode[], edges: KeywordGraphEdge[]): {
  nodes: PositionedNode[];
  edges: Array<KeywordGraphEdge & { sourceX: number; sourceY: number; targetX: number; targetY: number }>;
} {
  const limitedNodes = nodes.slice(0, 36);
  const positions = new Map<string, PositionedNode>();
  const centerX = 460;
  const centerY = 220;
  const domainBuckets = new Map<string, KeywordGraphNode[]>();

  for (const node of limitedNodes) {
    const bucket = domainBuckets.get(node.domain) || [];
    bucket.push(node);
    domainBuckets.set(node.domain, bucket);
  }

  const domainList = Array.from(domainBuckets.entries()).sort((a, b) => b[1].length - a[1].length);
  const ringGap = 58;
  domainList.forEach(([, bucket], domainIdx) => {
    const ringRadius = 70 + domainIdx * ringGap;
    bucket.forEach((node, idx) => {
      const angle = (Math.PI * 2 * idx) / Math.max(1, bucket.length) + domainIdx * 0.35;
      const x = centerX + Math.cos(angle) * ringRadius;
      const y = centerY + Math.sin(angle) * ringRadius * 0.82;
      positions.set(node.term, {
        ...node,
        x,
        y,
        r: Math.max(8, Math.min(24, 7 + node.score / 8)),
        color: DOMAIN_COLORS[node.domain] ?? '#9aa6b2',
      });
    });
  });

  const positionedEdges = edges
    .filter((edge) => positions.has(edge.source) && positions.has(edge.target))
    .slice(0, 72)
    .map((edge) => ({
      ...edge,
      sourceX: positions.get(edge.source)!.x,
      sourceY: positions.get(edge.source)!.y,
      targetX: positions.get(edge.target)!.x,
      targetY: positions.get(edge.target)!.y,
    }));

  return {
    nodes: Array.from(positions.values()),
    edges: positionedEdges,
  };
}

function polar(cx: number, cy: number, radius: number, angle: number): { x: number; y: number } {
  return {
    x: cx + Math.cos(angle) * radius,
    y: cy + Math.sin(angle) * radius,
  };
}

function buildBundledLayout(nodes: KeywordGraphNode[], edges: KeywordGraphEdge[]): {
  nodes: BundledNode[];
  paths: Array<{ d: string; color: string; weight: number }>;
} {
  const limitedNodes = nodes.slice(0, 28);
  const grouped = new Map<string, KeywordGraphNode[]>();
  for (const node of limitedNodes) {
    const bucket = grouped.get(node.domain) || [];
    bucket.push(node);
    grouped.set(node.domain, bucket);
  }

  const centerX = 460;
  const centerY = 230;
  const outerRadius = 170;
  const hubRadius = 96;
  const orderedGroups = Array.from(grouped.entries()).sort((a, b) => b[1].length - a[1].length);
  const totalGroups = Math.max(1, orderedGroups.length);
  const nodeMap = new Map<string, BundledNode>();

  orderedGroups.forEach(([, bucket], groupIndex) => {
    const startAngle = (-Math.PI / 2) + (groupIndex / totalGroups) * Math.PI * 2;
    const endAngle = (-Math.PI / 2) + ((groupIndex + 1) / totalGroups) * Math.PI * 2;
    const hubAngle = (startAngle + endAngle) / 2;
    const hub = polar(centerX, centerY, hubRadius, hubAngle);
    bucket.forEach((node, idx) => {
      const angle = startAngle + ((idx + 1) / (bucket.length + 1)) * (endAngle - startAngle);
      const pos = polar(centerX, centerY, outerRadius, angle);
      nodeMap.set(node.term, {
        ...node,
        x: pos.x,
        y: pos.y,
        color: DOMAIN_COLORS[node.domain] ?? '#9aa6b2',
        domainHubX: hub.x,
        domainHubY: hub.y,
      });
    });
  });

  const paths = edges
    .filter((edge) => nodeMap.has(edge.source) && nodeMap.has(edge.target))
    .slice(0, 84)
    .map((edge) => {
      const source = nodeMap.get(edge.source)!;
      const target = nodeMap.get(edge.target)!;
      const d = [
        `M ${source.x.toFixed(1)} ${source.y.toFixed(1)}`,
        `Q ${source.domainHubX.toFixed(1)} ${source.domainHubY.toFixed(1)}, ${centerX.toFixed(1)} ${centerY.toFixed(1)}`,
        `Q ${target.domainHubX.toFixed(1)} ${target.domainHubY.toFixed(1)}, ${target.x.toFixed(1)} ${target.y.toFixed(1)}`,
      ].join(' ');
      return {
        d,
        color: DOMAIN_COLORS[source.domain] ?? '#9aa6b2',
        weight: edge.weight,
      };
    });

  return {
    nodes: Array.from(nodeMap.values()),
    paths,
  };
}

export class OntologyGraphPage {
  private readonly getSnapshot: OntologyGraphOptions['getSnapshot'];
  private readonly overlay: HTMLElement;
  private readonly content: HTMLElement;
  private readonly sideContent: HTMLElement;
  private readonly statsEl: HTMLElement;
  private readonly closeBtn: HTMLButtonElement;
  private readonly refreshBtn: HTMLButtonElement;
  private readonly keyHandler: (event: KeyboardEvent) => void;
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private replayAsOf: string | null = null;

  constructor(options: OntologyGraphOptions) {
    this.getSnapshot = options.getSnapshot;
    this.overlay = document.createElement('div');
    this.overlay.className = 'ontology-graph-overlay';
    this.overlay.innerHTML = `
      <section class="ontology-graph-container" role="dialog" aria-modal="true" aria-label="Ontology Graph">
        <header class="ontology-graph-header">
          <div class="ontology-graph-header-main">
            <h2 class="ontology-graph-title">ONTOLOGY</h2>
            <p class="ontology-graph-subtitle">Entity relation grammar and cross-domain event graph</p>
          </div>
          <div class="ontology-graph-actions">
            <button type="button" class="ontology-graph-action-btn" data-role="refresh">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M23 4v6h-6M1 20v-6h6M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"/></svg>
              Refresh
            </button>
            <button type="button" class="ontology-graph-close" data-role="close" aria-label="Close">×</button>
          </div>
        </header>
        
        <div class="ontology-graph-viewport" id="ontologyViewport">
          <div class="ontology-graph-content"></div>
          
          <aside class="ontology-sidebar">
            <div class="ontology-sidebar-header">
              <h3>Entity Details</h3>
              <p>Select a node to view relations</p>
            </div>
            <div class="ontology-sidebar-scroll" id="ontologySideContent">
               <div class="ontology-placeholder">No entity selected</div>
            </div>
          </aside>
        </div>

        <div class="ontology-bottom-bar">
           <div class="ontology-legend">
              <span class="legend-item"><i style="background:#4ea6ff"></i> Technology</span>
              <span class="legend-item"><i style="background:#ff7b4d"></i> Defense</span>
              <span class="legend-item"><i style="background:#ffd166"></i> Energy</span>
              <span class="legend-item"><i style="background:#66d9a3"></i> Bio</span>
           </div>
           <div class="ontology-stats" id="ontologyStats">
              Nodes: 0 | Edges: 0
           </div>
        </div>
      </section>
    `.trim();

    this.content = this.overlay.querySelector('.ontology-graph-content') as HTMLElement;
    this.sideContent = this.overlay.querySelector('#ontologySideContent') as HTMLElement;
    this.statsEl = this.overlay.querySelector('#ontologyStats') as HTMLElement;
    this.closeBtn = this.overlay.querySelector('[data-role="close"]') as HTMLButtonElement;
    this.refreshBtn = this.overlay.querySelector('[data-role="refresh"]') as HTMLButtonElement;
    
    this.closeBtn.addEventListener('click', () => this.hide());
    this.refreshBtn.addEventListener('click', () => void this.refresh());
    this.content.addEventListener('click', (event) => void this.handleContentClick(event));
    this.overlay.addEventListener('click', (event) => {
      if (event.target === this.overlay) this.hide();
    });
    this.keyHandler = (event: KeyboardEvent) => {
      if (this.isVisible() && event.key === 'Escape') {
        event.preventDefault();
        this.hide();
      }
    };
    document.addEventListener('keydown', this.keyHandler);
    document.body.appendChild(this.overlay);
  }

  public show(): void {
    this.overlay.classList.add('active');
    void this.render();
    if (!this.refreshTimer) {
      this.refreshTimer = setInterval(() => {
        if (this.isVisible()) void this.render();
      }, 15000);
    }
  }

  public hide(): void {
    this.overlay.classList.remove('active');
  }

  public toggle(): void {
    if (this.isVisible()) this.hide();
    else this.show();
  }

  public isVisible(): boolean {
    return this.overlay.classList.contains('active');
  }

  public refresh(): void {
    if (this.isVisible()) void this.render();
  }

  public destroy(): void {
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
    document.removeEventListener('keydown', this.keyHandler);
    this.overlay.remove();
  }

  private async handleContentClick(event: Event): Promise<void> {
    const target = event.target as HTMLElement | null;
    const button = target?.closest<HTMLButtonElement>('[data-action]');
    if (!button) return;
    const action = button.dataset.action || '';
    if (action === 'select-replay') {
      const timestamp = button.dataset.timestamp || '';
      if (!timestamp) return;
      this.replayAsOf = timestamp;
      await this.render();
      return;
    }
    if (action === 'clear-replay') {
      this.replayAsOf = null;
      await this.render();
      return;
    }

    const entityId = button.dataset.entityId || '';
    if (!entityId) return;

    if (action === 'approve-alias') {
      const alias = window.prompt('Approve alias for this entity:', '');
      if (!alias) return;
      await approveCanonicalAlias(entityId, alias);
    } else if (action === 'split-alias') {
      const alias = window.prompt('Alias to split into a new canonical entity:', '');
      if (!alias) return;
      const canonicalName = window.prompt('New canonical name:', alias) || alias;
      await splitCanonicalAlias(entityId, alias, canonicalName);
    } else if (action === 'merge-into') {
      const targetEntity = window.prompt('Merge into target canonical name or id:', '');
      if (!targetEntity) return;
      await mergeCanonicalEntities(entityId, targetEntity);
    }

    await this.render();
  }

  private async render(): Promise<void> {
    const snapshot = this.getSnapshot();
    const graph = snapshot.keywordGraph;
    
    // Resolve ontology graph (base or replayed)
    const baseOntologyGraph = snapshot.ontologyGraph || await buildOntologyGraphSnapshot({
      keywordGraph: graph,
      entities: snapshot.entities,
    }).catch(() => null);
    
    const replayedOntologyGraph = this.replayAsOf
      ? await replayOntologySnapshotAt(this.replayAsOf).catch(() => null)
      : null;
    
    const ontologyGraph = replayedOntologyGraph || baseOntologyGraph;
    
    // Handle empty state
    if ((!graph || graph.nodes.length === 0) && (!ontologyGraph || ontologyGraph.nodes.length === 0)) {
      this.content.innerHTML = `
        <div class="ontology-graph-empty">
          No ontology graph available yet. Wait for keyword discovery and graph refresh cycles to populate it.
        </div>
      `;
      this.sideContent.innerHTML = '<div class="ontology-placeholder">No graph data</div>';
      this.statsEl.textContent = 'Nodes: 0 | Edges: 0';
      return;
    }

    // Process nodes and edges for visualization
    const ontologyEntityNodes = ontologyGraph?.nodes.filter((node) => node.category === 'entity') || [];
    const displayNodes = ontologyEntityNodes.length > 0
      ? ontologyEntityNodes.map(asDisplayNode)
      : graph?.nodes || [];

    const displayNodeIds = new Set(displayNodes.map((node) => node.id || node.term));
    const nodeLabelsById = new Map(displayNodes.map((node) => [node.id || node.term, node.term] as const));
    
    const displayEdges = ontologyGraph
      ? ontologyGraph.edges
        .filter((edge) => !String(edge.relationType).startsWith('event_'))
        .filter((edge) => displayNodeIds.has(edge.source) && displayNodeIds.has(edge.target))
        .map<KeywordGraphEdge>((edge) => ({
          source: nodeLabelsById.get(edge.source) || edge.source,
          target: nodeLabelsById.get(edge.target) || edge.target,
          weight: edge.weight,
        }))
      : graph?.edges || [];

    // Compute layout
    const layout = buildGraphLayout(
      displayNodes.slice().sort((a, b) => b.score - a.score),
      displayEdges.slice().sort((a, b) => b.weight - a.weight),
    );

    const positionedNodes = layout.nodes;
    
    // Render Main SVG Graph
    this.content.innerHTML = `
      <svg width="100%" height="100%" viewBox="0 0 1600 900" preserveAspectRatio="xMidYMid meet">
        <defs>
          <filter id="nodeGlow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur in="SourceAlpha" stdDeviation="4" result="blur" />
            <feFlood flood-color="currentColor" flood-opacity="0.5" result="flood" />
            <feComposite in="flood" in2="blur" operator="in" result="glow" />
            <feMerge>
              <feMergeNode in="glow" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
        <g class="edges" stroke-opacity="0.15" fill="none">
          ${layout.edges
            .map((edge) => {
               const dx = edge.targetX - edge.sourceX;
               const dy = edge.targetY - edge.sourceY;
               const dr = Math.sqrt(dx * dx + dy * dy);
               return `<path d="M${edge.sourceX},${edge.sourceY}A${dr},${dr} 0 0,1 ${edge.targetX},${edge.targetY}" stroke="rgba(114, 137, 218, 0.4)" stroke-width="${Math.max(1, edge.weight * 0.2)}" />`;
            })
            .join('')}
        </g>
        <g class="nodes">
          ${positionedNodes
            .map(
              (n) => `
            <g class="node" transform="translate(${n.x},${n.y})" style="color: ${n.color}; cursor: pointer" data-node-id="${n.id}">
              <circle r="${n.r}" fill="currentColor" fill-opacity="0.25" stroke="currentColor" stroke-width="2" filter="url(#nodeGlow)" />
              <text y="${n.r + 16}" text-anchor="middle" font-size="12" fill="var(--text)" font-weight="600" style="text-shadow: 0 2px 4px rgba(0,0,0,0.5)">${escapeHtml(n.term)}</text>
            </g>
          `
            )
            .join('')}
        </g>
      </svg>
    `;

    // Update Bottom Stats Bar
    this.statsEl.textContent = `Nodes: ${positionedNodes.length} | Edges: ${layout.edges.length} | Generated: ${relativeTime(baseOntologyGraph?.generatedAt || new Date().toISOString())}`;

    // Update Sidebar
    const topNodes = positionedNodes.sort((a, b) => b.score - a.score).slice(0, 10);
    const snapshotCheckpoints = snapshot.ledger
      .filter((event) => event.type === 'snapshot-built')
      .slice(0, 12);

    this.sideContent.innerHTML = `
      <div class="ontology-side-section">
        <h4 class="ontology-side-title">HIERARCHY FOCUS</h4>
        <div class="ontology-side-list">
          ${topNodes.map(n => `
            <div class="ontology-side-item" style="border-left: 3px solid ${n.color}; background: rgba(255,255,255,0.03); padding: 10px; margin-bottom: 8px; border-radius: 4px;">
              <div class="ontology-item-name" style="font-weight: 600; font-size: 13px;">${escapeHtml(n.term)}</div>
              <div class="ontology-item-meta" style="font-size: 11px; color: var(--text-dim);">${n.entityType} ??Score: ${n.score.toFixed(1)}</div>
            </div>
          `).join('')}
        </div>
      </div>
      
      <div class="ontology-side-section" style="margin-top: 24px;">
        <h4 class="ontology-side-title">TEMPORAL REPLAY</h4>
        <div class="ontology-replay-grid" style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-top: 12px;">
           ${snapshotCheckpoints.map(cp => `
             <button class="ontology-replay-btn ${this.replayAsOf === cp.timestamp ? 'active' : ''}" 
                     data-action="select-replay" 
                     data-timestamp="${cp.timestamp}"
                     style="padding: 6px; font-size: 10px; background: var(--surface); border: 1px solid var(--border); border-radius: 4px; cursor: pointer; color: var(--text-secondary);">
               ${new Date(cp.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
             </button>
           `).join('')}
        </div>
        ${this.replayAsOf ? `<button class="ontology-inline-btn" data-action="clear-replay" style="width: 100%; margin-top: 12px; padding: 8px; font-size: 11px; background: var(--surface-active); border: 1px solid var(--status-live); border-radius: 4px; color: var(--status-live); cursor: pointer;">RETURN TO LIVE</button>` : ''}
      </div>
    `;
  }
}

function truncateTerm(value: string, max = 18): string {
  const clean = String(value || '').trim();
  if (clean.length <= max) return clean;
  return `${clean.slice(0, Math.max(0, max - 3))}...`;
}
