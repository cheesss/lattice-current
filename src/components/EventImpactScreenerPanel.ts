import { Panel } from './Panel';
import { VirtualList } from './VirtualList';
import type { EventImpactRow, OpenbbCoverageSummary } from '@/services/openbb-intel';
import { escapeHtml } from '@/utils/sanitize';

function scoreClass(score: number): string {
  if (score >= 75) return 'critical';
  if (score >= 55) return 'elevated';
  if (score >= 35) return 'watch';
  return 'normal';
}

export class EventImpactScreenerPanel extends Panel {
  private rows: EventImpactRow[] = [];
  private list: VirtualList | null = null;
  private bodyHost: HTMLElement | null = null;
  private stampEl: HTMLElement | null = null;
  private coverageEl: HTMLElement | null = null;
  private headEl: HTMLElement | null = null;
  private showLinkedColumn = true;

  constructor() {
    super({ id: 'event-impact-screener', title: 'Event Impact Screener', showCount: true });
  }

  public setData(rows: EventImpactRow[], generatedAt: Date, coverage: OpenbbCoverageSummary | null = null): void {
    this.rows = rows;
    if (this.rows.length === 0) {
      this.showError('No impact events');
      return;
    }

    this.ensureLayout();
    const hasMarketCoverage = coverage
      ? (coverage.hasEquityPriceHistorical || coverage.hasEquityPriceQuote || coverage.hasCryptoPriceHistorical)
      : true;
    const containerWidth = this.bodyHost?.clientWidth ?? 0;
    const allowLinkedByWidth = containerWidth === 0 || containerWidth >= 640;
    this.showLinkedColumn = allowLinkedByWidth && hasMarketCoverage && this.rows.some((row) => row.matchedSymbols.length > 0);
    this.renderHead();
    this.setCount(this.rows.length);
    if (this.stampEl) this.stampEl.textContent = generatedAt.toLocaleTimeString();
    if (this.coverageEl) {
      this.coverageEl.textContent = coverage ? `${coverage.commandCount} CMD` : 'N/A';
    }
    this.list?.setItemCount(this.rows.length);
    this.list?.refresh();
  }

  public destroy(): void {
    this.list?.destroy();
    this.list = null;
    this.bodyHost = null;
    this.stampEl = null;
    this.coverageEl = null;
    this.headEl = null;
    super.destroy();
  }

  private ensureLayout(): void {
    if (this.list && this.bodyHost) return;

    this.content.innerHTML = `
      <div class="openbb-panel-shell">
        <div class="openbb-panel-meta">
          <span class="openbb-meta-label">UPDATED <b id="eventImpactStamp">--:--:--</b></span>
          <span class="openbb-meta-label">COVERAGE <b id="eventImpactCoverage">-</b></span>
        </div>
        <div class="openbb-impact-head" id="eventImpactHead"></div>
        <div class="openbb-impact-body" id="eventImpactBody"></div>
      </div>
    `;

    this.bodyHost = this.content.querySelector('#eventImpactBody');
    this.stampEl = this.content.querySelector('#eventImpactStamp');
    this.coverageEl = this.content.querySelector('#eventImpactCoverage');
    this.headEl = this.content.querySelector('#eventImpactHead');
    if (!this.bodyHost) return;

    this.list = new VirtualList({
      container: this.bodyHost,
      itemHeight: 56,
      overscan: 6,
      renderItem: (index, element) => {
        const row = this.rows[index];
        if (!row) {
          element.innerHTML = '';
          return;
        }
        const scoreTone = scoreClass(row.impactScore);
        const linked = row.matchedSymbols.length > 0 ? row.matchedSymbols.join(', ') : '-';
        element.className = `openbb-impact-row ${scoreTone}`;
        element.style.gridTemplateColumns = this.getTemplate();
        const baseCells = `
          <div class="impact-title-wrap">
            <a class="impact-title" href="${escapeHtml(row.link || '#')}" target="_blank" rel="noopener">${escapeHtml(row.title)}</a>
            <div class="impact-subline">${row.sourceCount} sources | stress ${row.marketStress.toFixed(2)}</div>
          </div>
          <span class="impact-region">${escapeHtml(row.region)}</span>
          <span class="impact-score">${row.impactScore}</span>
          <span class="impact-confidence">${row.confidence}</span>
          <span class="impact-market">${row.marketStress.toFixed(2)}</span>
        `;
        if (this.showLinkedColumn) {
          element.innerHTML = `${baseCells}<span class="impact-linked">${escapeHtml(linked)}</span>`;
        } else {
          element.innerHTML = baseCells;
        }
      },
    });

    this.renderHead();
  }

  private getTemplate(): string {
    return this.showLinkedColumn
      ? 'minmax(0, 2.35fr) minmax(52px, 0.75fr) minmax(44px, 0.55fr) minmax(44px, 0.5fr) minmax(52px, 0.6fr) minmax(0, 1.3fr)'
      : 'minmax(0, 2.6fr) minmax(52px, 0.8fr) minmax(44px, 0.55fr) minmax(44px, 0.5fr) minmax(52px, 0.65fr)';
  }

  private renderHead(): void {
    if (!this.headEl) return;
    this.headEl.style.gridTemplateColumns = this.getTemplate();
    this.headEl.innerHTML = this.showLinkedColumn
      ? '<span>EVENT</span><span>REGION</span><span>SCORE</span><span>CONF</span><span>MARKET</span><span>LINKED</span>'
      : '<span>EVENT</span><span>REGION</span><span>SCORE</span><span>CONF</span><span>MARKET</span>';
  }
}
