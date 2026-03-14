import { Panel } from './Panel';
import { VirtualList } from './VirtualList';
import type { CountryExposureRow, OpenbbCoverageSummary } from '@/services/openbb-intel';
import { escapeHtml } from '@/utils/sanitize';

function scoreClass(score: number): string {
  if (score >= 75) return 'critical';
  if (score >= 55) return 'elevated';
  if (score >= 35) return 'watch';
  return 'normal';
}

export class CountryExposureMatrixPanel extends Panel {
  private rows: CountryExposureRow[] = [];
  private list: VirtualList | null = null;
  private bodyHost: HTMLElement | null = null;
  private stampEl: HTMLElement | null = null;
  private coverageEl: HTMLElement | null = null;
  private headEl: HTMLElement | null = null;
  private showMomentum = true;

  constructor() {
    super({ id: 'country-exposure-matrix', title: 'Country Exposure Matrix', showCount: true });
  }

  public setData(rows: CountryExposureRow[], generatedAt: Date, coverage: OpenbbCoverageSummary | null = null): void {
    this.rows = rows;
    if (this.rows.length === 0) {
      this.showError('No exposure matrix data');
      return;
    }

    this.ensureLayout();
    const hasMarketCoverage = coverage
      ? (coverage.hasEquityPriceHistorical || coverage.hasEquityPriceQuote || coverage.hasCryptoPriceHistorical || coverage.hasCommodityPriceSpot)
      : true;
    this.showMomentum = hasMarketCoverage || this.rows.some((row) => row.momentum > 0);
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
          <span class="openbb-meta-label">UPDATED <b id="countryExposureStamp">--:--:--</b></span>
          <span class="openbb-meta-label">COVERAGE <b id="countryExposureCoverage">-</b></span>
        </div>
        <div class="openbb-exposure-head" id="countryExposureHead"></div>
        <div class="openbb-exposure-body" id="countryExposureBody"></div>
      </div>
    `;

    this.bodyHost = this.content.querySelector('#countryExposureBody');
    this.stampEl = this.content.querySelector('#countryExposureStamp');
    this.coverageEl = this.content.querySelector('#countryExposureCoverage');
    this.headEl = this.content.querySelector('#countryExposureHead');
    if (!this.bodyHost) return;

    this.list = new VirtualList({
      container: this.bodyHost,
      itemHeight: 34,
      overscan: 10,
      renderItem: (index, element) => {
        const row = this.rows[index];
        if (!row) {
          element.innerHTML = '';
          return;
        }
        const tone = scoreClass(row.score);
        element.className = `openbb-exposure-row ${tone}`;
        element.style.gridTemplateColumns = this.getTemplate();
        const baseCells = `
          <span class="exp-pair">${escapeHtml(row.pair)}</span>
          <span class="exp-score">${row.score}</span>
        `;
        const tailCells = `
          <span class="exp-channels">${escapeHtml(row.channels.join(', '))}</span>
          <span class="exp-evidence">${escapeHtml(row.evidence)}</span>
        `;
        if (this.showMomentum) {
          element.innerHTML = `${baseCells}<span class="exp-momentum">${row.momentum}</span>${tailCells}`;
        } else {
          element.innerHTML = `${baseCells}${tailCells}`;
        }
      },
    });

    this.renderHead();
  }

  private getTemplate(): string {
    return this.showMomentum
      ? 'minmax(72px, 0.95fr) minmax(46px, 0.55fr) minmax(46px, 0.55fr) minmax(0, 1.1fr) minmax(0, 1.35fr)'
      : 'minmax(72px, 1fr) minmax(46px, 0.6fr) minmax(0, 1.2fr) minmax(0, 1.5fr)';
  }

  private renderHead(): void {
    if (!this.headEl) return;
    this.headEl.style.gridTemplateColumns = this.getTemplate();
    this.headEl.innerHTML = this.showMomentum
      ? '<span>PAIR</span><span>SCORE</span><span>MOM</span><span>CHANNELS</span><span>EVIDENCE</span>'
      : '<span>PAIR</span><span>SCORE</span><span>CHANNELS</span><span>EVIDENCE</span>';
  }
}
