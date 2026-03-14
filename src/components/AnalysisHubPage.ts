import type { ClusteredEvent } from '@/types';
import type { CountryScore } from '@/services/country-instability';
import type { StrategicRiskOverview, UnifiedAlert } from '@/services/cross-module-integration';
import type { TheaterPostureSummary } from '@/services/military-surge';
import type { RegionalConvergence } from '@/services/signal-aggregator';
import type { ScheduledReport } from '@/services/scheduled-reports';
import type { EventMarketTransmissionSnapshot } from '@/services/event-market-transmission';
import type { SourceCredibilityProfile } from '@/services/source-credibility';
import type { MultiHopInferenceAlert } from '@/services/multi-hop-inference';
import type { InvestmentIntelligenceSnapshot } from '@/services/investment-intelligence';
import { escapeHtml, sanitizeUrl } from '@/utils/sanitize';

export interface AnalysisHubSnapshot {
  generatedAt: Date;
  riskOverview: StrategicRiskOverview | null;
  alerts: UnifiedAlert[];
  ciiTop: CountryScore[];
  topClusters: ClusteredEvent[];
  topPostures: TheaterPostureSummary[];
  convergence: RegionalConvergence[];
  reports: ScheduledReport[];
  transmission: EventMarketTransmissionSnapshot | null;
  sourceCredibility: SourceCredibilityProfile[];
  multiHopInferences: MultiHopInferenceAlert[];
  investmentIntelligence: InvestmentIntelligenceSnapshot | null;
}

interface AnalysisHubOptions {
  getSnapshot: () => AnalysisHubSnapshot;
  onFocusMap?: (lat: number, lon: number, zoom?: number) => void;
}

function formatRelativeTime(value: Date): string {
  const now = Date.now();
  const diff = Math.max(0, now - value.getTime());
  const min = Math.floor(diff / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  const hour = Math.floor(min / 60);
  if (hour < 24) return `${hour}h ago`;
  return `${Math.floor(hour / 24)}d ago`;
}

function formatTrendLabel(trend?: StrategicRiskOverview['trend']): string {
  if (trend === 'escalating') return 'Escalating';
  if (trend === 'de-escalating') return 'De-escalating';
  return 'Stable';
}

function formatPct(value: number | null | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 'n/a';
  return `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`;
}

function alertPriorityClass(priority: UnifiedAlert['priority']): string {
  return `analysis-priority-${priority}`;
}

export class AnalysisHubPage {
  private readonly getSnapshot: AnalysisHubOptions['getSnapshot'];
  private readonly onFocusMap?: AnalysisHubOptions['onFocusMap'];
  private readonly overlay: HTMLElement;
  private readonly content: HTMLElement;
  private readonly closeBtn: HTMLButtonElement;
  private readonly refreshBtn: HTMLButtonElement;
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private readonly keyHandler: (event: KeyboardEvent) => void;
  private readonly clickHandler: (event: MouseEvent) => void;

  constructor(options: AnalysisHubOptions) {
    this.getSnapshot = options.getSnapshot;
    this.onFocusMap = options.onFocusMap;

    this.overlay = document.createElement('div');
    this.overlay.className = 'analysis-hub-overlay';
    this.overlay.innerHTML = `
      <section class="analysis-hub-page" role="dialog" aria-modal="true" aria-label="Analysis Hub">
        <header class="analysis-hub-header">
          <div>
            <h2 class="analysis-hub-title">Analysis Hub</h2>
            <p class="analysis-hub-subtitle">Risk scores and analytical outputs in one view</p>
          </div>
          <div class="analysis-hub-actions">
            <button type="button" class="analysis-hub-action-btn" data-role="refresh">Refresh</button>
            <button type="button" class="analysis-hub-close" data-role="close" aria-label="Close">&times;</button>
          </div>
        </header>
        <div class="analysis-hub-content"></div>
      </section>
    `.trim();

    this.content = this.overlay.querySelector('.analysis-hub-content') as HTMLElement;
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
      if (target === this.overlay) {
        this.hide();
        return;
      }
      const focusBtn = target.closest('[data-focus-lat][data-focus-lon]') as HTMLElement | null;
      if (focusBtn && this.onFocusMap) {
        const lat = Number(focusBtn.dataset.focusLat);
        const lon = Number(focusBtn.dataset.focusLon);
        if (Number.isFinite(lat) && Number.isFinite(lon)) {
          this.onFocusMap(lat, lon, 4);
          this.hide();
        }
      }
    };

    this.closeBtn.addEventListener('click', () => this.hide());
    this.refreshBtn.addEventListener('click', () => this.render());
    this.overlay.addEventListener('click', this.clickHandler);
    document.addEventListener('keydown', this.keyHandler);
    document.body.appendChild(this.overlay);
  }

  public show(): void {
    this.overlay.classList.add('active');
    this.render();
    if (!this.refreshTimer) {
      this.refreshTimer = setInterval(() => {
        if (this.isVisible()) this.render();
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
    if (this.isVisible()) this.render();
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

  private render(): void {
    const snapshot = this.getSnapshot();
    const risk = snapshot.riskOverview;
    const topRisks = risk?.topRisks ?? [];
    const alertItems = snapshot.alerts.slice(0, 10);
    const ciiItems = snapshot.ciiTop.slice(0, 12);
    const clusters = snapshot.topClusters.slice(0, 10);
    const postures = snapshot.topPostures.slice(0, 8);
    const convergence = snapshot.convergence.slice(0, 8);
    const reports = snapshot.reports.slice(0, 4);
    const transmission = snapshot.transmission?.edges.slice(0, 6) ?? [];
    const sourceCredibility = snapshot.sourceCredibility.slice(0, 6);
    const multiHop = snapshot.multiHopInferences.slice(0, 6);
    const investment = snapshot.investmentIntelligence;
    const investmentWorkflow = investment?.workflow.slice(0, 6) ?? [];
    const investmentIdeas = investment?.ideaCards.slice(0, 4) ?? [];

    this.content.innerHTML = `
      <div class="analysis-hub-updated">Updated ${escapeHtml(snapshot.generatedAt.toLocaleString())}</div>
      <div class="analysis-hub-grid">
        <article class="analysis-card">
          <h3>Strategic Risk</h3>
          ${risk ? `
            <div class="analysis-kpi-row">
              <div class="analysis-kpi">
                <span class="analysis-kpi-label">Composite</span>
                <span class="analysis-kpi-value">${risk.compositeScore}</span>
              </div>
              <div class="analysis-kpi">
                <span class="analysis-kpi-label">Trend</span>
                <span class="analysis-kpi-value">${formatTrendLabel(risk.trend)}</span>
              </div>
              <div class="analysis-kpi">
                <span class="analysis-kpi-label">Convergence</span>
                <span class="analysis-kpi-value">${risk.convergenceAlerts}</span>
              </div>
            </div>
            <ul class="analysis-list">
              ${topRisks.length > 0 ? topRisks.slice(0, 5).map((item) => `<li>${escapeHtml(item)}</li>`).join('') : '<li>No significant risk text yet.</li>'}
            </ul>
          ` : '<div class="analysis-empty">Strategic risk panel data not ready.</div>'}
        </article>

        <article class="analysis-card">
          <h3>Top Alerts</h3>
          ${alertItems.length > 0 ? `
            <div class="analysis-alert-list">
              ${alertItems.map((alert) => `
                <div class="analysis-alert ${alertPriorityClass(alert.priority)}">
                  <div class="analysis-alert-top">
                    <span class="analysis-alert-title">${escapeHtml(alert.title)}</span>
                    <span class="analysis-alert-priority">${escapeHtml(alert.priority.toUpperCase())}</span>
                  </div>
                  <div class="analysis-alert-summary">${escapeHtml(alert.summary)}</div>
                  <div class="analysis-alert-meta">
                    <span>${formatRelativeTime(alert.timestamp)}</span>
                    ${alert.location
                      ? `<button type="button" class="analysis-focus-btn" data-focus-lat="${alert.location.lat}" data-focus-lon="${alert.location.lon}">Map</button>`
                      : ''}
                  </div>
                </div>
              `).join('')}
            </div>
          ` : '<div class="analysis-empty">No active alerts.</div>'}
        </article>

        <article class="analysis-card">
          <h3>CII Top Countries</h3>
          ${ciiItems.length > 0 ? `
            <table class="analysis-table">
              <thead><tr><th>Country</th><th>Score</th><th>Level</th><th>24h</th></tr></thead>
              <tbody>
                ${ciiItems.map((country) => `
                  <tr>
                    <td>${escapeHtml(country.name)}</td>
                    <td>${country.score}</td>
                    <td>${escapeHtml(country.level)}</td>
                    <td>${country.change24h >= 0 ? '+' : ''}${country.change24h}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          ` : '<div class="analysis-empty">CII data not ready.</div>'}
        </article>

        <article class="analysis-card">
          <h3>Analytical Clusters</h3>
          ${clusters.length > 0 ? `
            <div class="analysis-cluster-list">
              ${clusters.map((cluster) => {
                const link = sanitizeUrl(cluster.primaryLink);
                return `
                  <div class="analysis-cluster-item">
                    <div class="analysis-cluster-title">${escapeHtml(cluster.primaryTitle)}</div>
                    <div class="analysis-cluster-meta">
                      <span>${escapeHtml(cluster.primarySource)} | ${cluster.sourceCount} sources</span>
                      <span>${formatRelativeTime(cluster.firstSeen)}</span>
                    </div>
                    ${link ? `<a class="analysis-cluster-link" href="${link}" target="_blank" rel="noopener">Open source</a>` : ''}
                  </div>
                `;
              }).join('')}
            </div>
          ` : '<div class="analysis-empty">No clustered analysis yet.</div>'}
        </article>

        <article class="analysis-card">
          <h3>Military Posture</h3>
          ${postures.length > 0 ? `
            <ul class="analysis-list">
              ${postures.map((p) => `<li>${escapeHtml(p.theaterName)} | ${escapeHtml(p.postureLevel.toUpperCase())} | ${p.totalAircraft} aircraft</li>`).join('')}
            </ul>
          ` : '<div class="analysis-empty">No posture summary yet.</div>'}
        </article>

        <article class="analysis-card">
          <h3>Regional Convergence</h3>
          ${convergence.length > 0 ? `
            <ul class="analysis-list">
              ${convergence.map((item) => `<li>${escapeHtml(item.region)} | ${item.totalSignals} signals | ${escapeHtml(item.signalTypes.join(', '))}</li>`).join('')}
            </ul>
          ` : '<div class="analysis-empty">No convergence zone yet.</div>'}
        </article>

        <article class="analysis-card">
          <h3>Scheduled Reports</h3>
          ${reports.length > 0 ? `
            <div class="analysis-cluster-list">
              ${reports.map((report) => `
                <div class="analysis-cluster-item">
                  <div class="analysis-cluster-title">${escapeHtml(report.title)}</div>
                  <div class="analysis-cluster-meta">
                    <span>${escapeHtml(report.variant.toUpperCase())} | ${escapeHtml(report.trigger)} | ${escapeHtml(report.consensusMode || 'single')}</span>
                    <span>${formatRelativeTime(new Date(report.generatedAt))}</span>
                  </div>
                  <div class="analysis-alert-summary">${escapeHtml(report.summary)}</div>
                  ${report.rebuttalSummary ? `<div class="analysis-card-subtext">${escapeHtml(report.rebuttalSummary)}</div>` : ''}
                </div>
              `).join('')}
            </div>
          ` : '<div class="analysis-empty">No scheduled reports yet.</div>'}
        </article>

        <article class="analysis-card">
          <h3>Event → Market Transmission</h3>
          ${transmission.length > 0 ? `
            <ul class="analysis-list">
              ${transmission.map((edge) => `<li>${escapeHtml(edge.eventTitle)} -> ${escapeHtml(edge.marketSymbol)} | ${escapeHtml(edge.relationType)} | ${edge.strength}</li>`).join('')}
            </ul>
          ` : '<div class="analysis-empty">No transmission chains yet.</div>'}
        </article>

        <article class="analysis-card">
          <h3>Macro Investment Workflow</h3>
          ${investmentWorkflow.length > 0 ? `
            <div class="analysis-alert-list">
              ${investmentWorkflow.map((step) => `
                <div class="analysis-alert ${alertPriorityClass(step.status === 'ready' ? 'high' : step.status === 'watch' ? 'medium' : 'low')}">
                  <div class="analysis-alert-top">
                    <span class="analysis-alert-title">${escapeHtml(step.label)}</span>
                    <span class="analysis-alert-priority">${step.metric}</span>
                  </div>
                  <div class="analysis-alert-summary">${escapeHtml(step.summary)}</div>
                </div>
              `).join('')}
            </div>
          ` : '<div class="analysis-empty">Investment workflow not ready.</div>'}
        </article>

        <article class="analysis-card">
          <h3>Auto Investment Ideas</h3>
          ${investmentIdeas.length > 0 ? `
            <div class="analysis-cluster-list">
              ${investmentIdeas.map((idea) => `
                <div class="analysis-cluster-item">
                  <div class="analysis-cluster-title">${escapeHtml(idea.title)}</div>
                  <div class="analysis-cluster-meta">
                    <span>${escapeHtml(idea.direction.toUpperCase())} | conviction ${idea.conviction} | size ${idea.sizePct.toFixed(2)}%</span>
                    <span>FP ${idea.falsePositiveRisk} | ${escapeHtml((idea.trackingStatus || 'new').toUpperCase())}</span>
                  </div>
                  <div class="analysis-alert-summary">${escapeHtml(idea.thesis)}</div>
                  <div class="analysis-card-subtext">
                    ${escapeHtml(idea.symbols.map((symbol) => symbol.symbol).join(', '))}
                    | live ${formatPct(idea.liveReturnPct)}
                    | realized ${formatPct(idea.realizedReturnPct)}
                    | backtest ${idea.backtestHitRate ?? 'n/a'}% / ${formatPct(idea.backtestAvgReturnPct)}
                  </div>
                </div>
              `).join('')}
            </div>
          ` : '<div class="analysis-empty">No investment ideas yet.</div>'}
        </article>

        <article class="analysis-card">
          <h3>Source Credibility</h3>
          ${sourceCredibility.length > 0 ? `
            <table class="analysis-table">
              <thead><tr><th>Source</th><th>Cred</th><th>Corro</th><th>Prop</th></tr></thead>
              <tbody>
                ${sourceCredibility.map((item) => `
                  <tr>
                    <td>${escapeHtml(item.source)}</td>
                    <td>${item.credibilityScore}</td>
                    <td>${item.corroborationScore}</td>
                    <td>${item.propagandaRiskScore}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          ` : '<div class="analysis-empty">No source credibility data.</div>'}
        </article>

        <article class="analysis-card">
          <h3>Multi-hop Inference</h3>
          ${multiHop.length > 0 ? `
            <div class="analysis-cluster-list">
              ${multiHop.map((item) => `
                <div class="analysis-cluster-item">
                  <div class="analysis-cluster-title">${escapeHtml(item.title)}</div>
                  <div class="analysis-cluster-meta">
                    <span>${escapeHtml(item.category)} | ${escapeHtml(item.severity.toUpperCase())} | conf ${item.confidence}</span>
                  </div>
                  <div class="analysis-alert-summary">${escapeHtml(item.summary)}</div>
                  <div class="analysis-card-subtext">${escapeHtml(item.chain.join(' -> '))}</div>
                </div>
              `).join('')}
            </div>
          ` : '<div class="analysis-empty">No multi-hop inferences yet.</div>'}
        </article>
      </div>
    `.trim();
  }
}
