import { Panel } from './Panel';
import { VirtualList } from './VirtualList';
import type { CrossAssetTapeRow, OpenbbCoverageSummary } from '@/services/openbb-intel';
import { escapeHtml } from '@/utils/sanitize';

function fmtPrice(value: number): string {
  if (!Number.isFinite(value)) return '-';
  if (Math.abs(value) >= 1000) return value.toLocaleString(undefined, { maximumFractionDigits: 2 });
  if (Math.abs(value) >= 10) return value.toFixed(2);
  return value.toFixed(4);
}

function fmtChange(value: number): string {
  if (!Number.isFinite(value)) return '-';
  const sign = value > 0 ? '+' : '';
  return `${sign}${value.toFixed(2)}%`;
}

function classBadge(assetClass: CrossAssetTapeRow['assetClass']): string {
  switch (assetClass) {
    case 'index':
      return 'IDX';
    case 'equity':
      return 'EQ';
    case 'commodity':
      return 'CMD';
    case 'crypto':
      return 'CRY';
    case 'fx':
      return 'FX';
    case 'rate':
      return 'RTE';
    default:
      return 'OTH';
  }
}

type TapeColumnKey = 'sym' | 'name' | 'px' | 'chg' | 'vol' | 'volat' | 'liq';

const TAPE_COLUMN_LABELS: Record<TapeColumnKey, string> = {
  sym: 'SYM',
  name: 'NAME',
  px: 'PX',
  chg: 'CHG',
  vol: 'VOL',
  volat: 'VOLAT',
  liq: 'LIQ',
};

const TAPE_COLUMN_TEMPLATE: Record<TapeColumnKey, string> = {
  sym: 'minmax(86px, 1.1fr)',
  name: 'minmax(120px, 1.75fr)',
  px: 'minmax(66px, 0.85fr)',
  chg: 'minmax(62px, 0.8fr)',
  vol: 'minmax(76px, 0.95fr)',
  volat: 'minmax(54px, 0.65fr)',
  liq: 'minmax(50px, 0.6fr)',
};

export class CrossAssetTapePanel extends Panel {
  private rows: CrossAssetTapeRow[] = [];
  private list: VirtualList | null = null;
  private bodyHost: HTMLElement | null = null;
  private stampEl: HTMLElement | null = null;
  private sourceEl: HTMLElement | null = null;
  private coverageEl: HTMLElement | null = null;
  private headEl: HTMLElement | null = null;
  private columns: TapeColumnKey[] = ['sym', 'name', 'px', 'chg', 'vol', 'volat', 'liq'];

  constructor() {
    super({ id: 'cross-asset-tape', title: 'Cross-Asset Tape', showCount: true });
  }

  public setData(
    rows: CrossAssetTapeRow[],
    generatedAt: Date,
    source: 'openbb' | 'fallback',
    coverage: OpenbbCoverageSummary | null = null,
  ): void {
    this.rows = rows;
    if (this.rows.length === 0) {
      this.showError('No cross-asset data');
      return;
    }

    this.ensureLayout();
    this.columns = this.resolveColumns(source, coverage, this.rows);
    this.renderHead();
    this.setCount(this.rows.length);
    if (this.stampEl) this.stampEl.textContent = generatedAt.toLocaleTimeString();
    if (this.sourceEl) this.sourceEl.textContent = source === 'openbb' ? 'OPENBB' : 'FALLBACK';
    if (this.coverageEl) {
      this.coverageEl.textContent = coverage
        ? `${coverage.commandCount} CMD`
        : source === 'openbb'
          ? 'COVERAGE N/A'
          : 'FALLBACK';
    }
    this.list?.setItemCount(this.rows.length);
    this.list?.refresh();
  }

  public destroy(): void {
    this.list?.destroy();
    this.list = null;
    this.bodyHost = null;
    this.stampEl = null;
    this.sourceEl = null;
    this.coverageEl = null;
    this.headEl = null;
    super.destroy();
  }

  private ensureLayout(): void {
    if (this.list && this.bodyHost) return;

    this.content.innerHTML = `
      <div class="openbb-panel-shell">
        <div class="openbb-panel-meta">
          <span class="openbb-meta-label">UPDATED <b id="crossAssetTapeStamp">--:--:--</b></span>
          <span class="openbb-meta-label">SOURCE <b id="crossAssetTapeSource">-</b></span>
          <span class="openbb-meta-label">COVERAGE <b id="crossAssetTapeCoverage">-</b></span>
        </div>
        <div class="openbb-tape-head" id="crossAssetTapeHead"></div>
        <div class="openbb-tape-body" id="crossAssetTapeBody"></div>
      </div>
    `;

    this.bodyHost = this.content.querySelector('#crossAssetTapeBody');
    this.stampEl = this.content.querySelector('#crossAssetTapeStamp');
    this.sourceEl = this.content.querySelector('#crossAssetTapeSource');
    this.coverageEl = this.content.querySelector('#crossAssetTapeCoverage');
    this.headEl = this.content.querySelector('#crossAssetTapeHead');
    if (!this.bodyHost) return;

    this.list = new VirtualList({
      container: this.bodyHost,
      itemHeight: 30,
      overscan: 8,
      renderItem: (index, element) => {
        const row = this.rows[index];
        if (!row) {
          element.innerHTML = '';
          return;
        }
        const changeClass = row.changePct > 0 ? 'up' : row.changePct < 0 ? 'down' : 'flat';
        const volText = row.volume && row.volume > 0 ? Math.round(row.volume).toLocaleString() : '-';
        element.className = `openbb-tape-row ${changeClass}`;
        element.style.gridTemplateColumns = this.getTemplate();
        element.innerHTML = this.columns
          .map((column) => {
            if (column === 'sym') {
              return `<span class="tape-sym"><span class="asset-badge">${classBadge(row.assetClass)}</span>${escapeHtml(row.symbol)}</span>`;
            }
            if (column === 'name') {
              return `<span class="tape-name">${escapeHtml(row.name)}</span>`;
            }
            if (column === 'px') {
              return `<span class="tape-price">${fmtPrice(row.price)}</span>`;
            }
            if (column === 'chg') {
              return `<span class="tape-change">${fmtChange(row.changePct)}</span>`;
            }
            if (column === 'vol') {
              return `<span class="tape-volume">${volText}</span>`;
            }
            if (column === 'volat') {
              return `<span class="tape-volatility">${row.volatilityScore}</span>`;
            }
            return `<span class="tape-liquidity">${row.liquidityScore}</span>`;
          })
          .join('');
      },
    });

    this.renderHead();
  }

  private resolveColumns(
    source: 'openbb' | 'fallback',
    coverage: OpenbbCoverageSummary | null,
    rows: CrossAssetTapeRow[],
  ): TapeColumnKey[] {
    const hasVolumeValues = rows.some((row) => typeof row.volume === 'number' && row.volume > 0);
    const hasVolumeCoverage = coverage
      ? (coverage.hasEquityPriceHistorical || coverage.hasEquityPriceQuote || coverage.hasCryptoPriceHistorical)
      : source !== 'openbb';
    const showVolume = hasVolumeValues && hasVolumeCoverage;

    const columns: TapeColumnKey[] = ['sym', 'name', 'px', 'chg'];
    if (showVolume) columns.push('vol');
    columns.push('volat', 'liq');
    return columns;
  }

  private getTemplate(): string {
    return this.columns.map((column) => TAPE_COLUMN_TEMPLATE[column]).join(' ');
  }

  private renderHead(): void {
    if (!this.headEl) return;
    this.headEl.style.gridTemplateColumns = this.getTemplate();
    this.headEl.innerHTML = this.columns.map((column) => `<span>${TAPE_COLUMN_LABELS[column]}</span>`).join('');
  }
}
