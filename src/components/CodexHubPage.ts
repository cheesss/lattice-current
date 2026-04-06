import type { DataQAAnalyticsSnapshot, DataQAPanel } from './DataQAPanel';
import type { CodexOpsPanel } from './CodexOpsPanel';
import type { SourceOpsPanel } from './SourceOpsPanel';
import type { ScheduledReport } from '@/services/scheduled-reports';
import type { EventMarketTransmissionSnapshot } from '@/services/event-market-transmission';
import type { SourceCredibilityProfile } from '@/services/source-credibility';
import { APP_BRAND } from '@/config/brand';

interface CodexHubOptions {
  getDataQAPanel: () => DataQAPanel | null | undefined;
  getSourceOpsPanel: () => SourceOpsPanel | null | undefined;
  getCodexOpsPanel: () => CodexOpsPanel | null | undefined;
  getIntelligenceArtifacts?: () => {
    reports: ScheduledReport[];
    transmission: EventMarketTransmissionSnapshot | null;
    sourceCredibility: SourceCredibilityProfile[];
  };
}

function syncCodexHubVisibility(visible: boolean): void {
  const activeSelector = '.analysis-hub-overlay.active, .codex-hub-overlay.active, .ontology-graph-overlay.active';
  window.dispatchEvent(new CustomEvent('wm:hub-visibility', {
    detail: { hub: 'codex', visible },
  }));
  queueMicrotask(() => {
    document.body.classList.toggle('hub-active', Boolean(document.querySelector(activeSelector)));
  });
}

export class CodexHubPage {
  private readonly getDataQAPanel: CodexHubOptions['getDataQAPanel'];
  private readonly getSourceOpsPanel: CodexHubOptions['getSourceOpsPanel'];
  private readonly getCodexOpsPanel: CodexHubOptions['getCodexOpsPanel'];
  private readonly getIntelligenceArtifacts?: CodexHubOptions['getIntelligenceArtifacts'];
  private readonly overlay: HTMLElement;
  private readonly visualsSlot: HTMLElement;
  private readonly dataSlot: HTMLElement;
  private readonly sourceSlot: HTMLElement;
  private readonly codexOpsSlot: HTMLElement;
  private readonly closeBtn: HTMLButtonElement;
  private readonly refreshBtn: HTMLButtonElement;
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private readonly keyHandler: (event: KeyboardEvent) => void;
  private readonly clickHandler: (event: MouseEvent) => void;

  constructor(options: CodexHubOptions) {
    this.getDataQAPanel = options.getDataQAPanel;
    this.getSourceOpsPanel = options.getSourceOpsPanel;
    this.getCodexOpsPanel = options.getCodexOpsPanel;
    this.getIntelligenceArtifacts = options.getIntelligenceArtifacts;

    this.overlay = document.createElement('div');
    this.overlay.className = 'codex-hub-overlay';
    this.overlay.innerHTML = `
      <section class="codex-hub-page" role="dialog" aria-modal="true" aria-label="${APP_BRAND.hubs.codex}">
        <header class="codex-hub-header">
          <div>
            <h2 class="codex-hub-title">${APP_BRAND.hubs.codex}</h2>
            <p class="codex-hub-subtitle">Q&A, provenance, automation, and source health in one research workspace</p>
            <div class="hub-desk-switcher" aria-label="Switch desk">
              <button type="button" class="hub-desk-btn" data-open-hub-target="analysis">${APP_BRAND.hubs.analysis}</button>
              <button type="button" class="hub-desk-btn active" data-open-hub-target="codex">${APP_BRAND.hubs.codex}</button>
              <button type="button" class="hub-desk-btn" data-open-hub-target="backtest">${APP_BRAND.hubs.backtest}</button>
              <button type="button" class="hub-desk-btn" data-open-hub-target="ontology">${APP_BRAND.hubs.ontology}</button>
            </div>
          </div>
          <div class="codex-hub-actions">
            <button type="button" class="codex-hub-action-btn" data-role="refresh">Refresh</button>
            <button type="button" class="codex-hub-close" data-role="close" aria-label="Close">×</button>
          </div>
        </header>
        <div class="codex-hub-content">
          <section class="codex-hub-visuals" data-slot="visuals"></section>
          <div class="codex-hub-grid">
            <section class="codex-hub-slot" data-slot="qa"></section>
            <section class="codex-hub-slot" data-slot="ops"></section>
            <section class="codex-hub-slot codex-hub-slot-wide" data-slot="codex-ops"></section>
          </div>
        </div>
      </section>
    `.trim();

    this.visualsSlot = this.overlay.querySelector('[data-slot="visuals"]') as HTMLElement;
    this.dataSlot = this.overlay.querySelector('[data-slot="qa"]') as HTMLElement;
    this.sourceSlot = this.overlay.querySelector('[data-slot="ops"]') as HTMLElement;
    this.codexOpsSlot = this.overlay.querySelector('[data-slot="codex-ops"]') as HTMLElement;
    this.closeBtn = this.overlay.querySelector('[data-role="close"]') as HTMLButtonElement;
    this.refreshBtn = this.overlay.querySelector('[data-role="refresh"]') as HTMLButtonElement;

    this.keyHandler = (event: KeyboardEvent) => {
      if (!this.isVisible()) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        this.hide();
      }
    };

    this.clickHandler = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      const hubSwitchBtn = target.closest('[data-open-hub-target]') as HTMLElement | null;
      if (hubSwitchBtn) {
        const hub = hubSwitchBtn.dataset.openHubTarget;
        if (hub) {
          window.dispatchEvent(new CustomEvent('wm:open-hub', { detail: { hub } }));
        }
        return;
      }
      if (target === this.overlay) {
        this.hide();
      }
    };

    this.closeBtn.addEventListener('click', () => this.hide());
    this.refreshBtn.addEventListener('click', () => {
      void this.refresh();
    });
    this.overlay.addEventListener('click', this.clickHandler);
    document.addEventListener('keydown', this.keyHandler);

    document.body.appendChild(this.overlay);
  }

  public show(): void {
    if (!this.overlay.classList.contains('active')) {
      this.overlay.classList.add('active');
      syncCodexHubVisibility(true);
    }
    void this.refresh();
    if (!this.refreshTimer) {
      this.refreshTimer = setInterval(() => {
        if (this.isVisible()) {
          void this.refresh();
        }
      }, 15_000);
    }
  }

  public hide(): void {
    this.overlay.classList.remove('active');
    syncCodexHubVisibility(false);
  }

  public toggle(): void {
    if (this.isVisible()) this.hide();
    else this.show();
  }

  public isVisible(): boolean {
    return this.overlay.classList.contains('active');
  }

  public async refresh(): Promise<void> {
    let analytics: DataQAAnalyticsSnapshot | null = null;
    const dataQaPanel = this.getDataQAPanel();
    if (dataQaPanel) {
      const panelEl = dataQaPanel.getElement();
      dataQaPanel.show();
      if (panelEl.parentElement !== this.dataSlot) {
        this.dataSlot.replaceChildren(panelEl);
      }
      dataQaPanel.refreshSnapshot();
      analytics = dataQaPanel.getAnalyticsSnapshot(16);
    } else {
      this.dataSlot.innerHTML = '<div class="codex-hub-empty">Data Q&A panel is unavailable.</div>';
    }
    this.renderVisuals(analytics);

    const sourceOpsPanel = this.getSourceOpsPanel();
    if (sourceOpsPanel) {
      const panelEl = sourceOpsPanel.getElement();
      sourceOpsPanel.show();
      if (panelEl.parentElement !== this.sourceSlot) {
        this.sourceSlot.replaceChildren(panelEl);
      }
      await sourceOpsPanel.refresh();
    } else {
      this.sourceSlot.innerHTML = '<div class="codex-hub-empty">Source Ops panel is unavailable.</div>';
    }

    const codexOpsPanel = this.getCodexOpsPanel();
    if (codexOpsPanel) {
      const panelEl = codexOpsPanel.getElement();
      codexOpsPanel.show();
      if (panelEl.parentElement !== this.codexOpsSlot) {
        this.codexOpsSlot.replaceChildren(panelEl);
      }
      await codexOpsPanel.refresh();
    } else {
      this.codexOpsSlot.innerHTML = '<div class="codex-hub-empty">Codex Ops panel is unavailable.</div>';
    }
  }

  public destroy(): void {
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
    this.overlay.removeEventListener('click', this.clickHandler);
    document.removeEventListener('keydown', this.keyHandler);
    this.overlay.remove();
  }

  private renderVisuals(snapshot: DataQAAnalyticsSnapshot | null): void {
    const intelligence = this.getIntelligenceArtifacts?.();
    const reports = intelligence?.reports?.slice(0, 2) || [];
    const transmissionEdges = intelligence?.transmission?.edges?.slice(0, 6) || [];
    const credibility = intelligence?.sourceCredibility?.slice(0, 5) || [];

    if (!snapshot || snapshot.answerCount === 0) {
      this.visualsSlot.innerHTML = `
        <div class="codex-hub-empty">
          <strong>Research visuals will appear after the first analysis pass.</strong>
          <div class="backtest-lab-note">Ask a question in Data Q&amp;A, run a replay, or wait for the next automation cycle to populate evidence graphs here.</div>
        </div>
      `;
      return;
    }

    const evidenceEntries = Object.entries(snapshot.evidenceTypeCounts)
      .filter(([, count]) => count > 0)
      .sort((a, b) => b[1] - a[1]);
    const qualityEntries = Object.entries(snapshot.qualityCounts).sort((a, b) => b[1] - a[1]);
    const modeEntries = Object.entries(snapshot.modeCounts).sort((a, b) => b[1] - a[1]);
    const providerEntries = Object.entries(snapshot.providerCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);

    const evidenceMax = Math.max(1, ...evidenceEntries.map(([, count]) => count));
    const qualityMax = Math.max(1, ...qualityEntries.map(([, count]) => count));
    const modeMax = Math.max(1, ...modeEntries.map(([, count]) => count));
    const providerMax = Math.max(1, ...providerEntries.map(([, count]) => count));

    const recent = snapshot.recent.slice(-12);
    const contextMax = Math.max(1, ...recent.map(point => point.contextChars));

    const renderRows = (
      entries: Array<[string, number]>,
      maxValue: number,
      fillClass = '',
    ): string => entries.length > 0
      ? entries.map(([label, value]) => {
        const width = Math.max(4, Math.round((value / maxValue) * 100));
        return `
          <div class="codex-chart-row">
            <span class="codex-chart-label">${this.escapeHtml(label)}</span>
            <div class="codex-chart-track">
              <div class="codex-chart-fill ${fillClass}" style="width:${width}%"></div>
            </div>
            <span class="codex-chart-value">${value}</span>
          </div>
        `;
      }).join('')
      : '<div class="codex-chart-empty">No data</div>';

    const trendBars = recent.length > 0
      ? recent.map((point) => {
        const height = Math.max(8, Math.round((point.contextChars / contextMax) * 100));
        const title = [
          new Date(point.timestamp).toLocaleTimeString(),
          `provider=${point.provider}`,
          `mode=${point.mode}`,
          `quality=${point.quality}`,
          `evidence=${point.evidenceCount}`,
          `context=${point.contextChars}`,
        ].join(' | ');
        return `<div class="codex-trend-bar quality-${point.quality}" style="height:${height}%;" title="${this.escapeHtml(title)}"></div>`;
      }).join('')
      : '<div class="codex-chart-empty">No data</div>';

    this.visualsSlot.innerHTML = `
      <div class="codex-kpi-row">
        <div class="codex-kpi-card">
          <span class="codex-kpi-label">Questions</span>
          <strong class="codex-kpi-value">${snapshot.questionCount}</strong>
        </div>
        <div class="codex-kpi-card">
          <span class="codex-kpi-label">Answers</span>
          <strong class="codex-kpi-value">${snapshot.answerCount}</strong>
        </div>
        <div class="codex-kpi-card">
          <span class="codex-kpi-label">Avg Evidence</span>
          <strong class="codex-kpi-value">${snapshot.avgEvidencePerAnswer.toFixed(1)}</strong>
        </div>
        <div class="codex-kpi-card">
          <span class="codex-kpi-label">Avg Context</span>
          <strong class="codex-kpi-value">${Math.round(snapshot.avgContextChars).toLocaleString()}</strong>
        </div>
      </div>

      <div class="codex-chart-grid">
        <article class="codex-chart-card">
          <h4>Evidence Type Distribution</h4>
          ${renderRows(evidenceEntries, evidenceMax, 'evidence')}
        </article>

        <article class="codex-chart-card">
          <h4>Quality / Mode</h4>
          <div class="codex-chart-subtitle">Quality</div>
          ${renderRows(qualityEntries, qualityMax, 'quality')}
          <div class="codex-chart-subtitle">Mode</div>
          ${renderRows(modeEntries, modeMax, 'mode')}
        </article>

        <article class="codex-chart-card">
          <h4>Providers</h4>
          ${renderRows(providerEntries, providerMax, 'provider')}
        </article>

        <article class="codex-chart-card">
          <h4>Recent Context Trend</h4>
          <div class="codex-trend-wrap">${trendBars}</div>
          <div class="codex-chart-footnote">Bar height: context chars, color: quality</div>
        </article>

        <article class="codex-chart-card">
          <h4>Consensus / Rebuttal</h4>
          ${reports.length > 0 ? reports.map((report) => `
            <div class="codex-mini-block">
              <strong>${this.escapeHtml(report.title)}</strong>
              <div class="codex-chart-footnote">${this.escapeHtml(report.consensusMode || 'single')} | ${new Date(report.generatedAt).toLocaleString()}</div>
              <div>${this.escapeHtml((report.rebuttalSummary || report.summary || '').slice(0, 220))}</div>
            </div>
          `).join('') : '<div class="codex-chart-empty">No consensus reports</div>'}
        </article>

        <article class="codex-chart-card">
          <h4>Event → Market Transmission</h4>
          ${transmissionEdges.length > 0 ? transmissionEdges.map((edge) => `
            <div class="codex-mini-block">
              <strong>${this.escapeHtml(edge.eventTitle)}</strong>
              <div class="codex-chart-footnote">${this.escapeHtml(edge.marketSymbol)} | ${this.escapeHtml(edge.relationType)} | ${edge.strength}</div>
              <div>${this.escapeHtml(edge.reason)}</div>
            </div>
          `).join('') : '<div class="codex-chart-empty">No transmission edges</div>'}
        </article>

        <article class="codex-chart-card">
          <h4>Source Credibility</h4>
          ${credibility.length > 0 ? credibility.map((item) => `
            <div class="codex-chart-row">
              <span class="codex-chart-label">${this.escapeHtml(item.source)}</span>
              <div class="codex-chart-track">
                <div class="codex-chart-fill provider" style="width:${Math.max(4, item.credibilityScore)}%"></div>
              </div>
              <span class="codex-chart-value">${item.credibilityScore}</span>
            </div>
          `).join('') : '<div class="codex-chart-empty">No source credibility data</div>'}
        </article>
      </div>
    `;
  }

  private escapeHtml(value: string): string {
    return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }
}
