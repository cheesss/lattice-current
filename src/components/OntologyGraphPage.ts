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
import { APP_BRAND } from '@/config/brand';
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
      <section class="ontology-graph-page" role="dialog" aria-modal="true" aria-label="${APP_BRAND.hubs.ontology}">
        <header class="ontology-graph-header">
          <div>
            <h2 class="ontology-graph-title">${APP_BRAND.hubs.ontology}</h2>
            <p class="ontology-graph-subtitle">Entities, relations, replayable graph state, and ontology health in one graph workspace</p>
            <div class="hub-desk-switcher" aria-label="Switch desk">
              <button type="button" class="hub-desk-btn" data-open-hub-target="analysis">${APP_BRAND.hubs.analysis}</button>
              <button type="button" class="hub-desk-btn" data-open-hub-target="codex">${APP_BRAND.hubs.codex}</button>
              <button type="button" class="hub-desk-btn" data-open-hub-target="backtest">${APP_BRAND.hubs.backtest}</button>
              <button type="button" class="hub-desk-btn active" data-open-hub-target="ontology">${APP_BRAND.hubs.ontology}</button>
            </div>
          </div>
          <div class="ontology-graph-actions">
            <button type="button" class="ontology-graph-action-btn" data-role="refresh">Refresh</button>
            <button type="button" class="ontology-graph-close" data-role="close" aria-label="Close">&times;</button>
          </div>
        </header>
        <div class="ontology-graph-content"></div>
      </section>
    `.trim();

    this.content = this.overlay.querySelector('.ontology-graph-content') as HTMLElement;
    this.closeBtn = this.overlay.querySelector('[data-role="close"]') as HTMLButtonElement;
    this.refreshBtn = this.overlay.querySelector('[data-role="refresh"]') as HTMLButtonElement;
    this.closeBtn.addEventListener('click', () => this.hide());
    this.refreshBtn.addEventListener('click', () => void this.render());
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
    const hubSwitchBtn = target?.closest<HTMLElement>('[data-open-hub-target]');
    if (hubSwitchBtn) {
      const hub = hubSwitchBtn.dataset.openHubTarget;
      if (hub) {
        window.dispatchEvent(new CustomEvent('wm:open-hub', { detail: { hub } }));
      }
      return;
    }
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
    const rag = snapshot.graphRagSummary;
    const reports = snapshot.reports.slice(0, 6);
    const timeslices = snapshot.timeslices.slice(0, 8);
    const ledger = snapshot.ledger.slice(0, 10);
    const stixSummary = summarizeStixBundle(snapshot.stixBundle).slice(0, 8);
    const liveEntities = await listCanonicalEntities(36).catch(() => snapshot.entities.slice(0, 36));
    const baseOntologyGraph = snapshot.ontologyGraph || await buildOntologyGraphSnapshot({
      keywordGraph: graph,
      entities: snapshot.entities,
    }).catch(() => null);
    const replayedOntologyGraph = this.replayAsOf
      ? await replayOntologySnapshotAt(this.replayAsOf).catch(() => null)
      : null;
    if (this.replayAsOf && !replayedOntologyGraph) {
      this.replayAsOf = null;
    }
    const ontologyGraph = replayedOntologyGraph || baseOntologyGraph;
    const replayState = replayedOntologyGraph
      ? {
          asOf: replayedOntologyGraph.generatedAt,
          snapshotEventId: null,
          entityNodeCount: replayedOntologyGraph.nodes.filter((node) => node.category === 'entity').length,
          edgeCount: replayedOntologyGraph.edges.length,
          eventNodeCount: replayedOntologyGraph.eventNodes.length,
          inferredEdgeCount: replayedOntologyGraph.inferredEdges.length,
          violationCount: replayedOntologyGraph.violations.length,
          topEntityLabels: replayedOntologyGraph.nodes
            .filter((node) => node.category === 'entity')
            .slice()
            .sort((a, b) => Number(b.score || 0) - Number(a.score || 0))
            .slice(0, 6)
            .map((node) => node.label),
          topEventLabels: replayedOntologyGraph.eventNodes
            .slice()
            .sort((a, b) => Number(b.score || 0) - Number(a.score || 0))
            .slice(0, 4)
            .map((node) => node.label),
        } satisfies OntologyReplayState
      : snapshot.replayState;
    const snapshotCheckpoints = snapshot.ledger
      .filter((event) => event.type === 'snapshot-built')
      .slice(0, 8);

    if ((!graph || graph.nodes.length === 0) && (!ontologyGraph || ontologyGraph.nodes.length === 0)) {
      this.content.innerHTML = `
        <div class="ontology-graph-empty">
          <strong>Graph Studio is waiting for the first relationship build.</strong>
          <div class="backtest-lab-note">Run the scheduler or let keyword discovery finish, then come back here to inspect the entity graph and replay ledger.</div>
        </div>
      `;
      return;
    }

    const effectiveGraph = graph || {
      generatedAt: ontologyGraph?.generatedAt || new Date().toISOString(),
      nodes: [],
      edges: [],
    };
    const ontologyEntityNodes = ontologyGraph?.nodes.filter((node) => node.category === 'entity') || [];
    const displayNodes = ontologyEntityNodes.length > 0
      ? ontologyEntityNodes.map(asDisplayNode)
      : effectiveGraph.nodes;
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
          relationType: edge.relationType as KeywordGraphEdge['relationType'],
          validFrom: edge.validFrom || undefined,
          validUntil: edge.validUntil || undefined,
          active: edge.active,
          evidence: edge.evidence,
          sourceCanonicalId: edge.source,
          targetCanonicalId: edge.target,
        }))
      : effectiveGraph.edges;
    const domainSummary = summarizeDomains(displayNodes);
    const layout = buildGraphLayout(
      displayNodes.slice().sort((a, b) => b.score - a.score),
      displayEdges.slice().sort((a, b) => b.weight - a.weight),
    );
    const bundledLayout = buildBundledLayout(
      displayNodes.slice().sort((a, b) => b.score - a.score),
      displayEdges.slice().sort((a, b) => b.weight - a.weight),
    );
    const topNodes = displayNodes.slice().sort((a, b) => b.score - a.score).slice(0, 12);
    const timelineLines = summarizeGraphTimeline(timeslices);
    const eventNodes = ontologyGraph?.eventNodes.slice(0, 10) || [];
    const inferredEdges = ontologyGraph?.inferredEdges.slice(0, 10) || [];
    const violations = ontologyGraph?.violations.slice(0, 10) || [];
    const propertyNodes = ontologyGraph?.nodes.filter((node) => node.category === 'entity').slice(0, 6) || [];
    const propertyEdges = ontologyGraph?.edges.filter((edge) => !String(edge.relationType).startsWith('event_')).slice(0, 6) || [];

    const svg = `
      <svg viewBox="0 0 920 440" class="ontology-graph-svg" aria-label="Ontology graph network">
        ${layout.edges.map((edge) => `
          <line
            x1="${edge.sourceX.toFixed(1)}"
            y1="${edge.sourceY.toFixed(1)}"
            x2="${edge.targetX.toFixed(1)}"
            y2="${edge.targetY.toFixed(1)}"
            stroke="rgba(114, 137, 218, ${Math.max(0.18, Math.min(0.75, edge.weight / 28)).toFixed(2)})"
            stroke-width="${Math.max(1, Math.min(5, edge.weight / 4)).toFixed(1)}"
          />
        `).join('')}
        ${layout.nodes.map((node) => `
          <circle cx="${node.x.toFixed(1)}" cy="${node.y.toFixed(1)}" r="${node.r.toFixed(1)}" fill="${node.color}" fill-opacity="0.86" stroke="rgba(255,255,255,0.16)" stroke-width="1.5" />
          <text x="${node.x.toFixed(1)}" y="${(node.y + node.r + 13).toFixed(1)}" text-anchor="middle" class="ontology-graph-label">${escapeHtml(node.term)}</text>
        `).join('')}
      </svg>
    `;
    const bundledSvg = `
      <svg viewBox="0 0 920 460" class="ontology-bundle-svg" aria-label="Hierarchical edge bundling">
        <circle cx="460" cy="230" r="170" fill="none" stroke="rgba(148, 163, 184, 0.14)" stroke-width="1" />
        <circle cx="460" cy="230" r="96" fill="none" stroke="rgba(148, 163, 184, 0.08)" stroke-width="1" />
        ${bundledLayout.paths.map((path) => `
          <path
            d="${path.d}"
            fill="none"
            stroke="${path.color}"
            stroke-opacity="${Math.max(0.12, Math.min(0.38, path.weight / 40)).toFixed(2)}"
            stroke-width="${Math.max(1, Math.min(4.4, path.weight / 8)).toFixed(1)}"
            stroke-linecap="round"
          />
        `).join('')}
        ${bundledLayout.nodes.map((node) => `
          <g>
            <circle cx="${node.x.toFixed(1)}" cy="${node.y.toFixed(1)}" r="5.2" fill="${node.color}" fill-opacity="0.92" />
            <text x="${node.x.toFixed(1)}" y="${node.y.toFixed(1)}" dx="${node.x >= 460 ? 10 : -10}" dy="4" text-anchor="${node.x >= 460 ? 'start' : 'end'}" class="ontology-bundle-label">${escapeHtml(truncateTerm(node.term, 18))}</text>
          </g>
        `).join('')}
      </svg>
    `;

    this.content.innerHTML = `
      <div class="ontology-graph-updated">Updated ${escapeHtml(snapshot.generatedAt.toLocaleString())}</div>
      <div class="ontology-kpi-row">
        <div class="ontology-kpi-card"><span>ENTITY NODES</span><strong>${ontologyGraph?.nodes.filter((node) => node.category === 'entity').length ?? effectiveGraph.nodes.length}</strong></div>
        <div class="ontology-kpi-card"><span>EVENT NODES</span><strong>${eventNodes.length}</strong></div>
        <div class="ontology-kpi-card"><span>INFERRED EDGES</span><strong>${inferredEdges.length}</strong></div>
        <div class="ontology-kpi-card"><span>RULE VIOLATIONS</span><strong>${violations.length}</strong></div>
      </div>
      <div class="ontology-graph-grid">
        <article class="ontology-card ontology-card-graph">
          <h3>Entity / Relation Topology</h3>
          <div class="ontology-card-subtitle">Top ${layout.nodes.length} nodes, ${layout.edges.length} strongest temporal relations</div>
          ${svg}
        </article>

        <article class="ontology-card ontology-card-bundle">
          <h3>Hierarchical Edge Bundling</h3>
          <div class="ontology-card-subtitle">Relation paths bundled through domain hubs to suppress hairball clutter and expose real hubs.</div>
          ${bundledSvg}
        </article>

        <article class="ontology-card">
          <h3>Domain Composition</h3>
          <div class="ontology-domain-list">
            ${domainSummary.map((item) => `
              <div class="ontology-domain-row">
                <span class="ontology-domain-pill" style="background:${DOMAIN_COLORS[item.domain] ?? '#9aa6b2'}"></span>
                <span>${escapeHtml(item.domain)}</span>
                <strong>${item.count}</strong>
              </div>
            `).join('')}
          </div>
        </article>

        <article class="ontology-card">
          <h3>GraphRAG Themes</h3>
          ${rag
            ? `
              <div class="ontology-theme-list">
                ${rag.globalThemes.slice(0, 10).map((theme) => `<span class="ontology-theme-chip">${escapeHtml(theme)}</span>`).join('')}
              </div>
              <ul class="ontology-community-list">
                ${rag.communities.slice(0, 5).map((community) => `
                  <li>
                    <strong>${escapeHtml(community.id)}</strong>
                    <span>${community.avgScore.toFixed(1)} avg | ${community.edgeCount} edges</span>
                    <div>${escapeHtml(community.nodeTerms.slice(0, 6).join(', '))}</div>
                  </li>
                `).join('')}
              </ul>
            `
            : '<div class="ontology-graph-empty">GraphRAG summary unavailable.</div>'}
        </article>

        <article class="ontology-card">
          <h3>Top Canonical Entities</h3>
          <table class="ontology-entity-table">
            <thead><tr><th>Term</th><th>Canonical</th><th>Type</th><th>Score</th></tr></thead>
            <tbody>
              ${topNodes.map((node) => `
                <tr>
                  <td>${escapeHtml(node.term)}</td>
                  <td>${escapeHtml(node.canonicalName || node.term)}</td>
                  <td>${escapeHtml(node.entityType || 'unknown')}</td>
                  <td>${Math.round(node.score)}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </article>

        <article class="ontology-card">
          <h3>Labeled Property Graph</h3>
          <div class="ontology-card-subtitle">Flexible node and edge property bags carried without schema rewrites.</div>
          ${propertyNodes.length > 0 ? `
            <div class="ontology-cluster-list">
              ${propertyNodes.map((node) => `
                <div class="analysis-cluster-item">
                  <div class="analysis-cluster-title">${escapeHtml(node.label)}</div>
                  <div class="analysis-cluster-meta">
                    <span>${escapeHtml(String(node.nodeType))}</span>
                    <span>score ${Math.round(Number(node.score || 0))}</span>
                  </div>
                  <pre class="ontology-props-block">${renderPropertyBag(node.properties || {})}</pre>
                </div>
              `).join('')}
              ${propertyEdges.map((edge) => `
                <div class="analysis-cluster-item">
                  <div class="analysis-cluster-title">${escapeHtml(String(edge.relationType))} :: ${escapeHtml(edge.source.replace(/^term:/, ''))} -> ${escapeHtml(edge.target.replace(/^term:/, ''))}</div>
                  <pre class="ontology-props-block">${renderPropertyBag(edge.properties || {})}</pre>
                </div>
              `).join('')}
            </div>
          ` : '<div class="ontology-graph-empty">No property bags available yet.</div>'}
        </article>

        <article class="ontology-card">
          <h3>Alias / Entity Operations</h3>
          ${liveEntities.length > 0 ? `
            <table class="ontology-entity-table ontology-entity-table-actions">
              <thead><tr><th>Canonical</th><th>Type</th><th>Source</th><th>Refs</th><th>Actions</th></tr></thead>
              <tbody>
                ${liveEntities.map((entity) => `
                  <tr>
                    <td>${escapeHtml(entity.canonicalName)}</td>
                    <td>${escapeHtml(entity.entityType)}</td>
                    <td>${escapeHtml(entity.source)}</td>
                    <td>${escapeHtml((entity.externalRefs || []).slice(0, 2).map((ref) => `${ref.system}:${ref.id}`).join(' | ') || '-')}</td>
                    <td>
                      <div class="ontology-action-group">
                        <button type="button" class="ontology-inline-btn" data-action="approve-alias" data-entity-id="${escapeHtml(entity.id)}">Approve Alias</button>
                        <button type="button" class="ontology-inline-btn" data-action="split-alias" data-entity-id="${escapeHtml(entity.id)}">Split Alias</button>
                        <button type="button" class="ontology-inline-btn" data-action="merge-into" data-entity-id="${escapeHtml(entity.id)}">Merge</button>
                      </div>
                    </td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          ` : '<div class="ontology-graph-empty">No entity mapping rows yet.</div>'}
        </article>

        <article class="ontology-card">
          <h3>STIX 2.1 Bundle</h3>
          <div class="ontology-card-subtitle">Cyber IOC, geopolitical incidents, infrastructure, locations, and transmission paths projected into STIX objects.</div>
          ${stixSummary.length > 0 ? `
            <table class="ontology-entity-table">
              <thead><tr><th>Object Type</th><th>Count</th></tr></thead>
              <tbody>
                ${stixSummary.map((row) => `
                  <tr>
                    <td>${escapeHtml(row.type)}</td>
                    <td>${row.count}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
            <div class="ontology-card-subtitle">Bundle objects: ${snapshot.stixBundle?.objects?.length || 0}</div>
          ` : '<div class="ontology-graph-empty">No STIX bundle generated yet. Cyber IOC feeds may be empty or disabled.</div>'}
        </article>

        <article class="ontology-card">
          <h3>Reified Event Nodes</h3>
          ${eventNodes.length > 0 ? `
            <table class="ontology-entity-table">
              <thead><tr><th>Event</th><th>Relation</th><th>Weight</th><th>Time</th></tr></thead>
              <tbody>
                ${eventNodes.map((node) => `
                  <tr>
                    <td>${escapeHtml(node.label)}</td>
                    <td>${escapeHtml(String(node.meta?.relationType || '-'))}</td>
                    <td>${escapeHtml(String(node.score || 0))}</td>
                    <td>${escapeHtml(String(node.meta?.validFrom || '-'))}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          ` : '<div class="ontology-graph-empty">No event nodes reified yet.</div>'}
        </article>

        <article class="ontology-card">
          <h3>Hierarchical Inference</h3>
          ${inferredEdges.length > 0 ? `
            <table class="ontology-entity-table">
              <thead><tr><th>Source</th><th>Target</th><th>Relation</th><th>Weight</th></tr></thead>
              <tbody>
                ${inferredEdges.map((edge) => `
                  <tr>
                    <td>${escapeHtml(edge.source.replace(/^term:/, ''))}</td>
                    <td>${escapeHtml(edge.target.replace(/^term:/, ''))}</td>
                    <td>${escapeHtml(edge.relationType)}</td>
                    <td>${edge.weight}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          ` : '<div class="ontology-graph-empty">No inferred sanctions or inherited relations yet.</div>'}
        </article>

        <article class="ontology-card">
          <h3>Constraint Violations</h3>
          ${violations.length > 0 ? `
            <table class="ontology-entity-table">
              <thead><tr><th>Relation</th><th>Source</th><th>Target</th><th>Reason</th></tr></thead>
              <tbody>
                ${violations.map((violation) => `
                  <tr>
                    <td>${escapeHtml(violation.relationType)}</td>
                    <td>${escapeHtml(`${violation.sourceTerm} (${violation.sourceEntityType})`)}</td>
                    <td>${escapeHtml(`${violation.targetTerm} (${violation.targetEntityType})`)}</td>
                    <td>${escapeHtml(violation.reason)}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          ` : '<div class="ontology-graph-empty">No ontology rule violations recorded.</div>'}
        </article>

        <article class="ontology-card">
          <h3>Time-slice Graph History</h3>
          ${timeslices.length > 0 ? `
            <table class="ontology-entity-table">
              <thead><tr><th>Captured</th><th>Nodes</th><th>Edges</th><th>Top Terms</th></tr></thead>
              <tbody>
                ${timeslices.map((slice) => `
                  <tr>
                    <td>${escapeHtml(relativeTime(slice.capturedAt))}</td>
                    <td>${slice.nodeCount}</td>
                    <td>${slice.edgeCount}</td>
                    <td>${escapeHtml(slice.topTerms.slice(0, 4).join(', '))}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          ` : '<div class="ontology-graph-empty">No graph timeslices yet.</div>'}
          <div class="ontology-card-subtitle">Relation timeline</div>
          <ul class="analysis-list">
            ${timelineLines.length > 0 ? timelineLines.map((line) => `<li>${escapeHtml(line)}</li>`).join('') : '<li>No relation drift detected yet.</li>'}
          </ul>
        </article>

        <article class="ontology-card">
          <h3>Ontology Event Ledger</h3>
          <div class="ontology-card-subtitle">${this.replayAsOf ? `Replay mode active @ ${escapeHtml(new Date(this.replayAsOf).toLocaleString())}` : 'Live ontology graph state'}</div>
          ${ledger.length > 0 ? `
            <table class="ontology-entity-table">
              <thead><tr><th>Time</th><th>Type</th><th>Summary</th></tr></thead>
              <tbody>
                ${ledger.map((event) => `
                  <tr>
                    <td>${escapeHtml(relativeTime(event.timestamp))}</td>
                    <td>${escapeHtml(event.type)}</td>
                    <td>${escapeHtml(event.summary)}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          ` : '<div class="ontology-graph-empty">No append-only ontology ledger entries yet.</div>'}
          <div class="ontology-card-subtitle">Replay Checkpoints</div>
          ${snapshotCheckpoints.length > 0 ? `
            <div class="ontology-action-group">
              ${this.replayAsOf ? '<button type="button" class="ontology-inline-btn" data-action="clear-replay">Return Live</button>' : ''}
              ${snapshotCheckpoints.map((event) => `
                <button
                  type="button"
                  class="ontology-inline-btn${this.replayAsOf === event.timestamp ? ' active' : ''}"
                  data-action="select-replay"
                  data-timestamp="${escapeHtml(event.timestamp)}"
                >
                  ${escapeHtml(relativeTime(event.timestamp))}
                </button>
              `).join('')}
            </div>
          ` : '<div class="ontology-graph-empty">No replay checkpoints yet.</div>'}
          ${replayState ? `
            <div class="ontology-card-subtitle">Replay Preview</div>
            <ul class="analysis-list">
              <li>As of ${escapeHtml(new Date(replayState.asOf).toLocaleString())}</li>
              <li>${replayState.entityNodeCount} entity nodes | ${replayState.edgeCount} edges | ${replayState.eventNodeCount} event nodes</li>
              <li>${replayState.inferredEdgeCount} inferred edges | ${replayState.violationCount} violations</li>
              <li>Top entities: ${escapeHtml(replayState.topEntityLabels.join(', ') || '-')}</li>
            </ul>
          ` : '<div class="ontology-graph-empty">Replay state unavailable yet.</div>'}
        </article>

        <article class="ontology-card ontology-card-reports">
          <h3>Scheduled Situation Reports</h3>
          ${reports.length > 0
            ? reports.map((report) => `
              <div class="ontology-report-item">
                <div class="ontology-report-top">
                  <strong>${escapeHtml(report.title)}</strong>
                  <span>${escapeHtml(relativeTime(report.generatedAt))}</span>
                </div>
                <div class="ontology-report-meta">${escapeHtml(report.variant.toUpperCase())} | ${escapeHtml(report.trigger)} | ${escapeHtml(report.consensusMode || 'single')}</div>
                <div class="ontology-report-body">${escapeHtml(report.summary)}</div>
              </div>
            `).join('')
            : '<div class="ontology-graph-empty">No scheduled reports generated yet.</div>'}
        </article>
      </div>
    `.trim();
  }
}

function truncateTerm(value: string, max = 18): string {
  const clean = String(value || '').trim();
  if (clean.length <= max) return clean;
  return `${clean.slice(0, Math.max(0, max - 3))}...`;
}
