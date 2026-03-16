import { Panel } from './Panel';
import type {
  BacktestIdeaRun,
  ForwardReturnRecord,
  HistoricalReplayRun,
  WalkForwardWindow,
} from '@/services/historical-intelligence';
import { listHistoricalReplayRuns } from '@/services/historical-intelligence';
import type { HistoricalDatasetSummary } from '@/services/importer/historical-stream-worker';
import type { IntelligencePostgresConfig } from '@/services/server/intelligence-postgres';
import {
  clearInvestmentFocusContext,
  getInvestmentFocusContext,
  setInvestmentFocusContext,
  subscribeInvestmentFocusContext,
} from '@/services/investment-focus-context';
import {
  importHistoricalDatasetRemote,
  listHistoricalDatasetsRemote,
  runHistoricalReplayRemote,
  testHistoricalPostgresRemote,
  runWalkForwardRemote,
} from '@/services/historical-control';
import { escapeHtml } from '@/utils/sanitize';

interface EventDecisionSummary {
  ideaRunId: string;
  title: string;
  generatedAt: string;
  region: string;
  themeId: string;
  conviction: number;
  falsePositiveRisk: number;
  sizePct: number;
  symbol: string | null;
  direction: string;
  horizonHours: number | null;
  signedReturnPct: number | null;
  costAdjustedSignedReturnPct: number | null;
  hit: boolean | null;
}

function asTs(value: string): number {
  const ts = Date.parse(value);
  return Number.isFinite(ts) ? ts : 0;
}

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function formatPct(value: number | null | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 'n/a';
  return `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`;
}

function formatMaybeNumber(value: number | null | undefined, digits = 2): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 'n/a';
  return value.toFixed(digits);
}

function formatDateTime(value: string): string {
  const ts = asTs(value);
  if (!ts) return value;
  return new Date(ts).toLocaleString();
}

function formatRelativeTime(value: string): string {
  const diff = Math.max(0, Date.now() - asTs(value));
  const min = Math.floor(diff / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  const hour = Math.floor(min / 60);
  if (hour < 24) return `${hour}h ago`;
  return `${Math.floor(hour / 24)}d ago`;
}

function primaryHorizon(run: HistoricalReplayRun): number {
  if (run.horizonsHours.includes(24)) return 24;
  return run.horizonsHours[0] ?? 24;
}

function runPeriodLabel(run: HistoricalReplayRun): string {
  const from = run.checkpoints[0]?.timestamp || run.startedAt;
  const to = run.checkpoints[run.checkpoints.length - 1]?.timestamp || run.completedAt;
  return `${formatDateTime(from)} -> ${formatDateTime(to)}`;
}

function runHitRate(run: HistoricalReplayRun, horizon: number): number | null {
  const rows = run.forwardReturns.filter(
    (row) => row.horizonHours === horizon && typeof row.signedReturnPct === 'number',
  );
  if (rows.length === 0) return null;
  const hits = rows.filter((row) => (row.signedReturnPct || 0) > 0).length;
  return Math.round((hits / rows.length) * 100);
}

function runAvgReturn(run: HistoricalReplayRun, horizon: number): number | null {
  const rows = run.forwardReturns.filter(
    (row) => row.horizonHours === horizon && typeof row.signedReturnPct === 'number',
  );
  if (rows.length === 0) return null;
  return Number(average(rows.map((row) => row.signedReturnPct || 0)).toFixed(2));
}

function runCostAdjustedAvgReturn(run: HistoricalReplayRun, horizon: number): number | null {
  const rows = run.forwardReturns.filter(
    (row) => row.horizonHours === horizon && typeof row.costAdjustedSignedReturnPct === 'number',
  );
  if (rows.length === 0) return null;
  return Number(average(rows.map((row) => row.costAdjustedSignedReturnPct || 0)).toFixed(2));
}

function renderWindowSummary(windows: WalkForwardWindow[] | undefined): string {
  if (!windows || windows.length === 0) return 'single replay window';
  return windows.map((window) => `${window.phase}:${window.frameCount}`).join(' | ');
}

function getIdeaRecords(run: HistoricalReplayRun, ideaRunId: string): ForwardReturnRecord[] {
  return run.forwardReturns
    .filter((row) => row.ideaRunId === ideaRunId)
    .sort((a, b) => {
      if (a.symbol !== b.symbol) return a.symbol.localeCompare(b.symbol);
      return a.horizonHours - b.horizonHours;
    });
}

function chooseBestRecord(records: ForwardReturnRecord[], preferredHorizon: number): ForwardReturnRecord | null {
  const preferred = records.filter(
    (row) => row.horizonHours === preferredHorizon && typeof row.signedReturnPct === 'number',
  );
  const target = preferred.length > 0
    ? preferred
    : records.filter((row) => typeof row.signedReturnPct === 'number');
  if (target.length === 0) return null;
  return target.slice().sort((a, b) =>
    (b.costAdjustedSignedReturnPct ?? b.signedReturnPct ?? 0) - (a.costAdjustedSignedReturnPct ?? a.signedReturnPct ?? 0),
  )[0] || null;
}

function buildDecisionSummaries(run: HistoricalReplayRun): EventDecisionSummary[] {
  const horizon = primaryHorizon(run);
  return run.ideaRuns
    .map((ideaRun) => {
      const best = chooseBestRecord(getIdeaRecords(run, ideaRun.id), horizon);
      return {
        ideaRunId: ideaRun.id,
        title: ideaRun.title,
        generatedAt: ideaRun.generatedAt,
        region: ideaRun.region,
        themeId: ideaRun.themeId,
        conviction: ideaRun.conviction,
        falsePositiveRisk: ideaRun.falsePositiveRisk,
        sizePct: ideaRun.sizePct,
        symbol: best?.symbol ?? null,
        direction: best?.direction || ideaRun.direction,
        horizonHours: best?.horizonHours ?? null,
        signedReturnPct: best?.signedReturnPct ?? null,
        costAdjustedSignedReturnPct: best?.costAdjustedSignedReturnPct ?? null,
        hit: best && typeof (best.costAdjustedSignedReturnPct ?? best.signedReturnPct) === 'number'
          ? (best.costAdjustedSignedReturnPct ?? best.signedReturnPct ?? 0) > 0
          : null,
      };
    })
    .sort((a, b) => {
      const scoreA = typeof (a.costAdjustedSignedReturnPct ?? a.signedReturnPct) === 'number' ? (a.costAdjustedSignedReturnPct ?? a.signedReturnPct ?? -999) : -999;
      const scoreB = typeof (b.costAdjustedSignedReturnPct ?? b.signedReturnPct) === 'number' ? (b.costAdjustedSignedReturnPct ?? b.signedReturnPct ?? -999) : -999;
      return scoreB - scoreA;
    });
}

function buildRunThemeOptions(runs: HistoricalReplayRun[]): Array<{ id: string; label: string }> {
  const seen = new Map<string, string>();
  for (const run of runs) {
    for (const ideaRun of run.ideaRuns) {
      if (!seen.has(ideaRun.themeId)) {
        seen.set(ideaRun.themeId, ideaRun.title.split('|')[0]?.trim() || ideaRun.themeId);
      }
    }
  }
  return Array.from(seen.entries())
    .map(([id, label]) => ({ id, label }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

function buildRunRegionOptions(runs: HistoricalReplayRun[]): string[] {
  return Array.from(new Set(runs.flatMap((run) => run.ideaRuns.map((ideaRun) => ideaRun.region).filter(Boolean)))).sort();
}

function buildEquityCurve(decisions: EventDecisionSummary[]): string {
  const rows = decisions.filter((decision) => typeof (decision.costAdjustedSignedReturnPct ?? decision.signedReturnPct) === 'number');
  if (!rows.length) {
    return '<div class="backtest-lab-chart-card"><div class="backtest-lab-note">Equity curve unavailable for current focus.</div></div>';
  }
  const width = 620;
  const height = 190;
  let equity = 0;
  const points = rows
    .slice()
    .sort((a, b) => asTs(a.generatedAt) - asTs(b.generatedAt))
    .map((row, index, arr) => {
      equity += row.costAdjustedSignedReturnPct ?? row.signedReturnPct ?? 0;
      return { x: 30 + (index / Math.max(1, arr.length - 1)) * (width - 60), equity };
    });
  const minEquity = Math.min(0, ...points.map((point) => point.equity));
  const maxEquity = Math.max(0, ...points.map((point) => point.equity));
  const span = Math.max(1, maxEquity - minEquity);
  const yFor = (value: number): number => height - 26 - ((value - minEquity) / span) * (height - 52);
  const path = points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x.toFixed(1)} ${yFor(point.equity).toFixed(1)}`).join(' ');
  const finalEquity = points[points.length - 1]?.equity || 0;
  return `
    <div class="backtest-lab-chart-card">
      <div class="backtest-lab-chart-head">
        <div>
          <div class="investment-mini-label">Equity Curve</div>
          <div class="backtest-lab-chart-title">Cumulative signed return across best decisions</div>
        </div>
        <div class="backtest-lab-chart-value ${finalEquity >= 0 ? 'positive' : 'negative'}">${formatPct(finalEquity)}</div>
      </div>
      <svg viewBox="0 0 ${width} ${height}" class="backtest-lab-chart-svg" aria-label="Backtest equity curve">
        <line x1="30" y1="${yFor(0).toFixed(1)}" x2="${(width - 30).toFixed(1)}" y2="${yFor(0).toFixed(1)}" class="backtest-lab-zero-line" />
        <path d="${path}" class="backtest-lab-equity-path ${finalEquity >= 0 ? 'positive' : 'negative'}" />
      </svg>
    </div>
  `;
}

function buildHeatmap(decisions: EventDecisionSummary[]): string {
  const rows = decisions.filter((decision) => typeof (decision.costAdjustedSignedReturnPct ?? decision.signedReturnPct) === 'number');
  if (!rows.length) {
    return '<div class="backtest-lab-chart-card"><div class="backtest-lab-note">Decision heatmap unavailable for current focus.</div></div>';
  }
  const byDay = new Map<string, { count: number; hits: number; total: number }>();
  for (const row of rows) {
    const day = row.generatedAt.slice(0, 10);
    const bucket = byDay.get(day) || { count: 0, hits: 0, total: 0 };
    const value = row.costAdjustedSignedReturnPct ?? row.signedReturnPct ?? 0;
    bucket.count += 1;
    if (value > 0) bucket.hits += 1;
    bucket.total += value;
    byDay.set(day, bucket);
  }
  const cells = Array.from(byDay.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .slice(-28)
    .map(([day, bucket]) => {
      const avg = bucket.total / Math.max(1, bucket.count);
      const hitRate = bucket.hits / Math.max(1, bucket.count);
      let tone = 'flat';
      if (avg >= 1.5 || hitRate >= 0.75) tone = 'strong';
      else if (avg > 0 || hitRate >= 0.5) tone = 'positive';
      else if (avg <= -1.5 || hitRate <= 0.2) tone = 'negative';
      return `
        <div class="backtest-lab-heat-cell ${tone}" title="${escapeHtml(day)} | avg ${formatPct(avg)} | hit ${(hitRate * 100).toFixed(0)}%">
          <span>${escapeHtml(day.slice(5))}</span>
        </div>
      `;
    }).join('');

  return `
    <div class="backtest-lab-chart-card">
      <div class="backtest-lab-chart-head">
        <div>
          <div class="investment-mini-label">Decision Heatmap</div>
          <div class="backtest-lab-chart-title">Daily hit-rate and signed-return calendar</div>
        </div>
      </div>
      <div class="backtest-lab-heatmap">${cells}</div>
    </div>
  `;
}

function buildSymbolReturnTable(run: HistoricalReplayRun, ideaRun: BacktestIdeaRun): string {
  const bySymbol = new Map<string, ForwardReturnRecord[]>();
  for (const row of getIdeaRecords(run, ideaRun.id)) {
    const bucket = bySymbol.get(row.symbol) || [];
    bucket.push(row);
    bySymbol.set(row.symbol, bucket);
  }
  const horizonColumns = run.horizonsHours.slice();
  const rows = ideaRun.symbols.map((symbolState) => {
    const symbolRows = bySymbol.get(symbolState.symbol) || [];
    const byHorizon = new Map(symbolRows.map((row) => [row.horizonHours, row] as const));
    return `
      <tr>
        <td>${escapeHtml(symbolState.symbol)}</td>
        <td>${escapeHtml(symbolState.role)}</td>
        <td>${escapeHtml(symbolState.direction.toUpperCase())}</td>
        <td>${formatMaybeNumber(symbolState.entryPrice)}</td>
        ${horizonColumns.map((horizon) => {
          const record = byHorizon.get(horizon);
          const display = record?.costAdjustedSignedReturnPct ?? record?.signedReturnPct ?? null;
          const tooltip = record && typeof record.executionPenaltyPct === 'number'
            ? ` title="raw ${formatPct(record.signedReturnPct)} | penalty ${record.executionPenaltyPct.toFixed(2)}% | session ${record.sessionState}"`
            : '';
          return `<td${tooltip}>${formatPct(display)}</td>`;
        }).join('')}
      </tr>
    `;
  }).join('');

  return `
    <table class="investment-table backtest-lab-table">
      <thead>
        <tr>
          <th>Symbol</th>
          <th>Role</th>
          <th>Dir</th>
          <th>Entry</th>
          ${horizonColumns.map((horizon) => `<th>${horizon}h</th>`).join('')}
        </tr>
      </thead>
      <tbody>${rows || '<tr><td colspan="99">No forward returns yet</td></tr>'}</tbody>
    </table>
  `;
}

export class BacktestLabPanel extends Panel {
  private runs: HistoricalReplayRun[] = [];
  private datasets: HistoricalDatasetSummary[] = [];
  private selectedRunId: string | null = null;
  private selectedIdeaRunId: string | null = null;
  private controlState = {
    filePath: '',
    datasetId: '',
    provider: '',
    bucketHours: '6',
    warmupFrameCount: '0',
    replayLabel: '',
    walkForwardLabel: '',
    postgresSync: false,
    pgConnectionString: '',
    pgSchema: 'worldmonitor_intel',
    pgPageSize: '1000',
    pgSsl: false,
  };
  private actionMessage = '';
  private actionBusy = false;
  private focus = getInvestmentFocusContext();
  private unsubscribeFocus: (() => void) | null = null;
  private postgresStatus: {
    state: 'idle' | 'testing' | 'connected' | 'error';
    message: string;
    detail: string;
  } = {
    state: 'idle',
    message: 'Postgres sync disabled',
    detail: '',
  };

  constructor() {
    super({
      id: 'backtest-lab',
      title: 'Backtest Lab',
      showCount: true,
      className: 'panel-wide span-2',
    });

    this.content.addEventListener('click', (event) => {
      const target = event.target as HTMLElement | null;
      const button = target?.closest<HTMLButtonElement>('[data-action]');
      if (!button) return;
      const action = button.dataset.action || '';
      if (action === 'refresh') {
        void this.refreshData();
        return;
      }
      if (action === 'import-dataset') {
        void this.handleImport();
        return;
      }
      if (action === 'run-replay') {
        void this.handleReplay();
        return;
      }
      if (action === 'run-walk-forward') {
        void this.handleWalkForward();
        return;
      }
      if (action === 'test-postgres') {
        void this.handlePostgresTest();
        return;
      }
      if (action === 'select-run') {
        this.selectedRunId = button.dataset.runId || null;
        this.selectedIdeaRunId = null;
        this.render();
        return;
      }
      if (action === 'select-idea') {
        this.selectedIdeaRunId = button.dataset.ideaRunId || null;
        this.render();
        return;
      }
      if (action === 'clear-focus') {
        clearInvestmentFocusContext();
      }
    });
    this.unsubscribeFocus = subscribeInvestmentFocusContext((context) => {
      this.focus = context;
      this.render();
    });
    this.content.addEventListener('input', (event) => {
      const target = event.target as HTMLInputElement | HTMLSelectElement | null;
      const field = target?.dataset.field;
      if (!field || !(field in this.controlState)) return;
      const isCheckbox = target instanceof HTMLInputElement && target.type === 'checkbox';
      (this.controlState as Record<string, unknown>)[field] = isCheckbox ? target.checked : target.value;
    });
    this.content.addEventListener('change', (event) => {
      const target = event.target as HTMLInputElement | HTMLSelectElement | null;
      const field = target?.dataset.field;
      if (!target) return;
      if (field === 'focus-theme') {
        setInvestmentFocusContext({ themeId: target.value || null });
        return;
      }
      if (field === 'focus-region') {
        setInvestmentFocusContext({ region: target.value || null });
        return;
      }
      if (!field || !(field in this.controlState)) return;
      const isCheckbox = target instanceof HTMLInputElement && target.type === 'checkbox';
      (this.controlState as Record<string, unknown>)[field] = isCheckbox ? target.checked : target.value;
      this.render();
    });

    void this.refreshData();
  }

  public destroy(): void {
    this.unsubscribeFocus?.();
    this.unsubscribeFocus = null;
    super.destroy();
  }

  public async refreshData(): Promise<void> {
    try {
      this.setFetching(true);
      this.showLoading('Loading backtest runs...');
      this.runs = await listHistoricalReplayRuns(12);
      this.datasets = await listHistoricalDatasetsRemote();
      this.setCount(this.runs.length);
      if (!this.controlState.datasetId || !this.datasets.some((dataset) => dataset.datasetId === this.controlState.datasetId)) {
        this.controlState.datasetId = this.datasets[0]?.datasetId || '';
      }
      if (!this.controlState.provider) {
        this.controlState.provider = this.datasets.find((dataset) => dataset.datasetId === this.controlState.datasetId)?.provider || '';
      }
      if (!this.selectedRunId || !this.runs.some((run) => run.id === this.selectedRunId)) {
        this.selectedRunId = this.runs[0]?.id ?? null;
        this.selectedIdeaRunId = null;
      }
      this.setDataBadge(this.runs.length > 0 ? 'live' : 'unavailable', this.runs.length > 0 ? 'RUNS' : 'NO RUNS');
      this.render();
    } catch (error) {
      console.warn('[backtest-lab] load failed', error);
      this.setCount(0);
      this.setDataBadge('unavailable', 'ERROR');
      this.showError('Failed to load replay runs', () => void this.refreshData());
    } finally {
      this.setFetching(false);
    }
  }

  private postgresConfig(): IntelligencePostgresConfig | null {
    const connectionString = this.controlState.pgConnectionString.trim();
    const schema = this.controlState.pgSchema.trim();
    if (!connectionString && !schema && !this.controlState.pgSsl) {
      return null;
    }
    return {
      connectionString: connectionString || undefined,
      schema: schema || undefined,
      ssl: this.controlState.pgSsl || undefined,
    };
  }

  private summarizePostgresResult(result: unknown): string {
    if (!result || typeof result !== 'object') return '';
    const shaped = result as { result?: { rawRecordCount?: number; frameCount?: number; runId?: string } };
    if (shaped.result?.runId) {
      return `postgres synced run ${shaped.result.runId}`;
    }
    if (typeof shaped.result?.rawRecordCount === 'number' || typeof shaped.result?.frameCount === 'number') {
      return `postgres synced ${shaped.result?.rawRecordCount ?? 0} raw / ${shaped.result?.frameCount ?? 0} frames`;
    }
    return 'postgres sync completed';
  }

  private async handleImport(): Promise<void> {
    const filePath = this.controlState.filePath.trim();
    if (!filePath) {
      this.actionMessage = 'file path required';
      this.render();
      return;
    }
    this.actionBusy = true;
    this.actionMessage = 'importing historical dataset...';
    this.render();
    try {
      const importResult = await importHistoricalDatasetRemote(filePath, {
        datasetId: this.controlState.datasetId.trim() || undefined,
        provider: this.controlState.provider.trim() || undefined,
        bucketHours: Math.max(1, Number(this.controlState.bucketHours || 6)),
        warmupFrameCount: Math.max(0, Number(this.controlState.warmupFrameCount || 0)),
      }, {
        postgresSync: this.controlState.postgresSync,
        pgConfig: this.postgresConfig(),
        postgresPageSize: Math.max(100, Number(this.controlState.pgPageSize || 1000)),
      });
      const result = importResult.result;
      const pgNote = this.summarizePostgresResult(importResult.postgresSyncResult);
      this.actionMessage = result
        ? `imported ${result.datasetId} (${result.rawRecordCount} raw / ${result.frameCount} frames)${pgNote ? ` · ${pgNote}` : ''}`
        : 'import failed';
      if (result?.datasetId) {
        this.controlState.datasetId = result.datasetId;
      }
      await this.refreshData();
    } finally {
      this.actionBusy = false;
      this.render();
    }
  }

  private async handleReplay(): Promise<void> {
    const datasetId = this.controlState.datasetId.trim();
    if (!datasetId) {
      this.actionMessage = 'dataset required';
      this.render();
      return;
    }
    this.actionBusy = true;
    this.actionMessage = 'running replay...';
    this.render();
    try {
      const replayResult = await runHistoricalReplayRemote(datasetId, {
        label: this.controlState.replayLabel.trim() || `${datasetId} replay`,
      }, {}, {
        postgresSync: this.controlState.postgresSync,
        pgConfig: this.postgresConfig(),
      });
      const run = replayResult.run;
      const pgNote = this.summarizePostgresResult(replayResult.postgresSyncResult);
      this.actionMessage = run ? `replay completed: ${run.label}${pgNote ? ` · ${pgNote}` : ''}` : 'replay failed';
      await this.refreshData();
    } finally {
      this.actionBusy = false;
      this.render();
    }
  }

  private async handleWalkForward(): Promise<void> {
    const datasetId = this.controlState.datasetId.trim();
    if (!datasetId) {
      this.actionMessage = 'dataset required';
      this.render();
      return;
    }
    this.actionBusy = true;
    this.actionMessage = 'running walk-forward...';
    this.render();
    try {
      const replayResult = await runWalkForwardRemote(datasetId, {
        label: this.controlState.walkForwardLabel.trim() || `${datasetId} walk-forward`,
      }, {}, {
        postgresSync: this.controlState.postgresSync,
        pgConfig: this.postgresConfig(),
      });
      const run = replayResult.run;
      const pgNote = this.summarizePostgresResult(replayResult.postgresSyncResult);
      this.actionMessage = run ? `walk-forward completed: ${run.label}${pgNote ? ` · ${pgNote}` : ''}` : 'walk-forward failed';
      await this.refreshData();
    } finally {
      this.actionBusy = false;
      this.render();
    }
  }

  private async handlePostgresTest(): Promise<void> {
    this.postgresStatus = {
      state: 'testing',
      message: 'testing postgres connection...',
      detail: '',
    };
    this.render();
    try {
      const result = await testHistoricalPostgresRemote(this.postgresConfig() || {});
      if (result) {
        this.postgresStatus = {
          state: 'connected',
          message: `connected: ${result.database}`,
          detail: `${result.schema} · ${result.serverTime}`,
        };
      } else {
        this.postgresStatus = {
          state: 'error',
          message: 'postgres connection failed',
          detail: 'Check connection string / schema / ssl settings.',
        };
      }
    } catch (error) {
      this.postgresStatus = {
        state: 'error',
        message: 'postgres connection failed',
        detail: String((error as Error)?.message || error || ''),
      };
    }
    this.render();
  }

  private render(): void {
    const themeOptions = buildRunThemeOptions(this.runs);
    const regionOptions = buildRunRegionOptions(this.runs);
    const datasetOptions = this.datasets.map((dataset) => `
      <option value="${escapeHtml(dataset.datasetId)}"${dataset.datasetId === this.controlState.datasetId ? ' selected' : ''}>
        ${escapeHtml(dataset.datasetId)} (${escapeHtml(dataset.provider)})
      </option>
    `).join('');
    const controlBlock = `
      <section class="investment-subcard">
        <h4>Importer / Replay Control</h4>
        <div class="backtest-lab-controls">
          <label class="backtest-lab-control">
            <span>File</span>
            <input type="text" data-field="filePath" value="${escapeHtml(this.controlState.filePath)}" placeholder="data/historical/...json" />
          </label>
          <label class="backtest-lab-control">
            <span>Dataset</span>
            <input type="text" data-field="datasetId" value="${escapeHtml(this.controlState.datasetId)}" placeholder="dataset id" />
          </label>
          <label class="backtest-lab-control">
            <span>Provider</span>
            <input type="text" data-field="provider" value="${escapeHtml(this.controlState.provider)}" placeholder="gdelt-doc / fred / coingecko" />
          </label>
          <label class="backtest-lab-control">
            <span>Bucket Hours</span>
            <input type="number" min="1" step="1" data-field="bucketHours" value="${escapeHtml(this.controlState.bucketHours)}" />
          </label>
          <label class="backtest-lab-control">
            <span>Warm-up Frames</span>
            <input type="number" min="0" step="1" data-field="warmupFrameCount" value="${escapeHtml(this.controlState.warmupFrameCount)}" />
          </label>
          <label class="backtest-lab-control">
            <span>Loaded Datasets</span>
            <select data-field="datasetId">
              <option value="">Select dataset</option>
              ${datasetOptions}
            </select>
          </label>
          <label class="backtest-lab-control">
            <span>Replay Label</span>
            <input type="text" data-field="replayLabel" value="${escapeHtml(this.controlState.replayLabel)}" placeholder="optional replay label" />
          </label>
          <label class="backtest-lab-control">
            <span>Walk-forward Label</span>
            <input type="text" data-field="walkForwardLabel" value="${escapeHtml(this.controlState.walkForwardLabel)}" placeholder="optional walk-forward label" />
          </label>
          <label class="backtest-lab-control backtest-lab-control-checkbox">
            <span>Postgres Sync</span>
            <input type="checkbox" data-field="postgresSync"${this.controlState.postgresSync ? ' checked' : ''} />
          </label>
          <label class="backtest-lab-control backtest-lab-control-wide">
            <span>Postgres URL</span>
            <input type="password" data-field="pgConnectionString" value="${escapeHtml(this.controlState.pgConnectionString)}" placeholder="postgres://user:pass@host:5432/db" />
          </label>
          <label class="backtest-lab-control">
            <span>PG Schema</span>
            <input type="text" data-field="pgSchema" value="${escapeHtml(this.controlState.pgSchema)}" placeholder="worldmonitor_intel" />
          </label>
          <label class="backtest-lab-control">
            <span>PG Page Size</span>
            <input type="number" min="100" step="100" data-field="pgPageSize" value="${escapeHtml(this.controlState.pgPageSize)}" />
          </label>
          <label class="backtest-lab-control backtest-lab-control-checkbox">
            <span>PG SSL</span>
            <input type="checkbox" data-field="pgSsl"${this.controlState.pgSsl ? ' checked' : ''} />
          </label>
        </div>
        <div class="backtest-lab-toolbar">
          <button type="button" class="backtest-lab-btn" data-action="refresh"${this.actionBusy ? ' disabled' : ''}>Refresh</button>
          <button type="button" class="backtest-lab-btn" data-action="import-dataset"${this.actionBusy ? ' disabled' : ''}>Import</button>
          <button type="button" class="backtest-lab-btn" data-action="run-replay"${this.actionBusy ? ' disabled' : ''}>Replay</button>
          <button type="button" class="backtest-lab-btn" data-action="run-walk-forward"${this.actionBusy ? ' disabled' : ''}>Walk-forward</button>
          <button type="button" class="backtest-lab-btn" data-action="test-postgres"${this.actionBusy ? ' disabled' : ''}>Test PG</button>
        </div>
        <div class="backtest-lab-note">${escapeHtml(this.actionBusy ? `${this.actionMessage} (working)` : this.actionMessage || 'Use a historical dataset, then launch replay or walk-forward directly from this panel.')}</div>
        <div class="backtest-lab-postgres ${escapeHtml(this.postgresStatus.state)}">
          <strong>Postgres</strong>
          <span>${escapeHtml(this.postgresStatus.message)}</span>
          ${this.postgresStatus.detail ? `<span>${escapeHtml(this.postgresStatus.detail)}</span>` : ''}
        </div>
      </section>
    `;
    const focusToolbar = `
      <div class="investment-focus-toolbar">
        <div class="investment-focus-badge">Focus: ${escapeHtml(this.focus.themeId || 'all themes')} ${this.focus.region ? `| ${escapeHtml(this.focus.region)}` : ''}</div>
        <label>
          <span class="investment-mini-label">Theme</span>
          <select data-field="focus-theme">
            <option value="">All themes</option>
            ${themeOptions.map((option) => `<option value="${escapeHtml(option.id)}"${option.id === this.focus.themeId ? ' selected' : ''}>${escapeHtml(option.label)}</option>`).join('')}
          </select>
        </label>
        <label>
          <span class="investment-mini-label">Region</span>
          <select data-field="focus-region">
            <option value="">All regions</option>
            ${regionOptions.map((region) => `<option value="${escapeHtml(region)}"${region === this.focus.region ? ' selected' : ''}>${escapeHtml(region)}</option>`).join('')}
          </select>
        </label>
        <button type="button" class="backtest-lab-btn" data-action="clear-focus">Clear focus</button>
      </div>
    `;

    if (this.runs.length === 0) {
      this.setContent(`
        <div class="backtest-lab-shell">
          ${controlBlock}
          ${focusToolbar}
          <div class="panel-empty">No historical replay runs yet.</div>
          <div class="backtest-lab-note">
            Run the replay engine first, then this panel will show period, walk-forward split, best event decisions, and event-level forward returns.
          </div>
          <div class="backtest-lab-toolbar">
            <button type="button" class="backtest-lab-btn" data-action="refresh">Refresh</button>
          </div>
        </div>
      `);
      return;
    }

    const selectedRun = this.runs.find((run) => run.id === this.selectedRunId) || this.runs[0]!;
    const decisions = buildDecisionSummaries(selectedRun).filter((decision) =>
      (!this.focus.themeId || decision.themeId === this.focus.themeId)
      && (!this.focus.region || decision.region === this.focus.region),
    );
    const filteredIdeaRuns = selectedRun.ideaRuns.filter((ideaRun) =>
      (!this.focus.themeId || ideaRun.themeId === this.focus.themeId)
      && (!this.focus.region || ideaRun.region === this.focus.region),
    );
    if (!this.selectedIdeaRunId || !filteredIdeaRuns.some((ideaRun) => ideaRun.id === this.selectedIdeaRunId)) {
      this.selectedIdeaRunId = decisions[0]?.ideaRunId ?? filteredIdeaRuns[0]?.id ?? null;
    }
    const selectedIdea = filteredIdeaRuns.find((ideaRun) => ideaRun.id === this.selectedIdeaRunId) || filteredIdeaRuns[0] || null;
    const selectedDecision = decisions.find((decision) => decision.ideaRunId === selectedIdea?.id) || decisions[0] || null;
    const horizon = primaryHorizon(selectedRun);
    const runHit = runHitRate(selectedRun, horizon);
    const runAvg = runAvgReturn(selectedRun, horizon);
    const runCostAvg = runCostAdjustedAvgReturn(selectedRun, horizon);
    const sourcePosterior = selectedRun.sourceProfiles.length > 0
      ? Math.round(average(selectedRun.sourceProfiles.map((profile) => profile.posteriorAccuracyScore)))
      : 0;
    const mappingPosterior = selectedRun.mappingStats.length > 0
      ? Math.round(average(selectedRun.mappingStats.map((row) => row.posteriorWinRate)))
      : 0;

    const runButtons = this.runs.map((run) => {
      const selected = run.id === selectedRun.id ? ' selected' : '';
      return `
        <button type="button" class="backtest-lab-run-btn${selected}" data-action="select-run" data-run-id="${escapeHtml(run.id)}">
          <span class="backtest-lab-run-label">${escapeHtml(run.label)}</span>
          <span class="backtest-lab-run-meta">${escapeHtml(run.mode.toUpperCase())} · ${run.frameCount} frames · ${formatRelativeTime(run.completedAt)}</span>
        </button>
      `;
    }).join('');

    const decisionRows = decisions.slice(0, 12).map((decision) => {
      const selected = decision.ideaRunId === selectedIdea?.id ? ' selected' : '';
      return `
        <tr class="backtest-lab-row${selected}">
          <td>
            <button type="button" class="backtest-lab-link" data-action="select-idea" data-idea-run-id="${escapeHtml(decision.ideaRunId)}">
              ${escapeHtml(decision.title)}
            </button>
          </td>
          <td>${escapeHtml(decision.region)}</td>
          <td>${escapeHtml(decision.symbol || '-')}</td>
          <td>${escapeHtml(decision.direction.toUpperCase())}</td>
          <td>${decision.horizonHours ?? 'n/a'}${decision.horizonHours ? 'h' : ''}</td>
          <td>${formatPct(decision.costAdjustedSignedReturnPct ?? decision.signedReturnPct)}</td>
          <td>${decision.conviction}</td>
          <td>${decision.falsePositiveRisk}</td>
        </tr>
      `;
    }).join('');

    const checkpointRows = selectedRun.checkpoints.slice(-8).reverse().map((checkpoint) => `
      <tr>
        <td>${escapeHtml(formatDateTime(checkpoint.timestamp))}</td>
        <td>${checkpoint.newsCount}</td>
        <td>${checkpoint.clusterCount}</td>
        <td>${checkpoint.marketCount}</td>
        <td>${checkpoint.ideaCount}</td>
        <td>${checkpoint.mappingStatCount}</td>
      </tr>
    `).join('');

    const windowRows = (selectedRun.windows || []).map((window) => `
      <tr>
        <td>${escapeHtml(window.phase.toUpperCase())}</td>
        <td>${escapeHtml(formatDateTime(window.from))}</td>
        <td>${escapeHtml(formatDateTime(window.to))}</td>
        <td>${window.frameCount}</td>
      </tr>
    `).join('');

    const summaryLines = selectedRun.summaryLines.map((line) => `<li>${escapeHtml(line)}</li>`).join('');
    const evidenceLines = selectedIdea?.evidence.slice(0, 8).map((line) => `<li>${escapeHtml(line)}</li>`).join('') || '<li>No evidence lines.</li>';
    const triggerLines = selectedIdea?.triggers.map((line) => `<li>${escapeHtml(line)}</li>`).join('') || '<li>No trigger notes.</li>';
    const invalidationLines = selectedIdea?.invalidation.map((line) => `<li>${escapeHtml(line)}</li>`).join('') || '<li>No invalidation rules.</li>';
    const equityCurve = buildEquityCurve(decisions);
    const decisionHeatmap = buildHeatmap(decisions);

    this.setContent(`
      <div class="backtest-lab-shell">
        ${controlBlock}
        ${focusToolbar}
        <div class="backtest-lab-toolbar">
          <div class="backtest-lab-run-list">${runButtons}</div>
          <button type="button" class="backtest-lab-btn" data-action="refresh">Refresh</button>
        </div>

        <div class="investment-grid-two">
          ${equityCurve}
          ${decisionHeatmap}
        </div>

        <div class="backtest-lab-kpis">
          <div class="backtest-lab-kpi">
            <span class="backtest-lab-kpi-label">Mode</span>
            <span class="backtest-lab-kpi-value">${escapeHtml(selectedRun.mode.toUpperCase())}</span>
          </div>
          <div class="backtest-lab-kpi">
            <span class="backtest-lab-kpi-label">Period</span>
            <span class="backtest-lab-kpi-value">${escapeHtml(runPeriodLabel(selectedRun))}</span>
          </div>
          <div class="backtest-lab-kpi">
            <span class="backtest-lab-kpi-label">Primary Horizon</span>
            <span class="backtest-lab-kpi-value">${horizon}h</span>
          </div>
          <div class="backtest-lab-kpi">
            <span class="backtest-lab-kpi-label">Hit Rate</span>
            <span class="backtest-lab-kpi-value">${runHit ?? 'n/a'}%</span>
          </div>
          <div class="backtest-lab-kpi">
            <span class="backtest-lab-kpi-label">Raw Avg</span>
            <span class="backtest-lab-kpi-value">${formatPct(runAvg)}</span>
          </div>
          <div class="backtest-lab-kpi">
            <span class="backtest-lab-kpi-label">Cost Adj Avg</span>
            <span class="backtest-lab-kpi-value">${formatPct(runCostAvg)}</span>
          </div>
          <div class="backtest-lab-kpi">
            <span class="backtest-lab-kpi-label">Reality Gate</span>
            <span class="backtest-lab-kpi-value">hit ${selectedRun.realitySummary.costAdjustedHitRate}% / score ${selectedRun.realitySummary.avgRealityScore}</span>
          </div>
          <div class="backtest-lab-kpi">
            <span class="backtest-lab-kpi-label">Learned Priors</span>
            <span class="backtest-lab-kpi-value">src ${sourcePosterior} / map ${mappingPosterior}</span>
          </div>
        </div>

        <div class="investment-grid-two">
          <section class="investment-subcard">
            <h4>Run Summary</h4>
            <div class="backtest-lab-note">Windows: ${escapeHtml(renderWindowSummary(selectedRun.windows))}</div>
            <ul>${summaryLines || '<li>No run summary.</li>'}</ul>
          </section>
          <section class="investment-subcard">
            <h4>Replay Checkpoints</h4>
            <table class="investment-table backtest-lab-table">
              <thead><tr><th>Time</th><th>News</th><th>Clusters</th><th>Mkt</th><th>Ideas</th><th>MapStats</th></tr></thead>
              <tbody>${checkpointRows || '<tr><td colspan="6">No checkpoints</td></tr>'}</tbody>
            </table>
          </section>
        </div>

        <div class="investment-grid-two">
          <section class="investment-subcard">
            <h4>Walk-forward Windows</h4>
            <table class="investment-table backtest-lab-table">
              <thead><tr><th>Phase</th><th>From</th><th>To</th><th>Frames</th></tr></thead>
              <tbody>${windowRows || '<tr><td colspan="4">Single replay run</td></tr>'}</tbody>
            </table>
          </section>
          <section class="investment-subcard">
            <h4>Best Historical Decisions</h4>
            <table class="investment-table backtest-lab-table">
              <thead><tr><th>Event</th><th>Region</th><th>Asset</th><th>Dir</th><th>H</th><th>Adj Return</th><th>Conv</th><th>FP</th></tr></thead>
              <tbody>${decisionRows || '<tr><td colspan="8">No event decisions yet</td></tr>'}</tbody>
            </table>
          </section>
        </div>

        <section class="investment-subcard">
          <h4>Event Replay Detail</h4>
          ${selectedIdea ? `
            <div class="backtest-lab-detail-meta">
              <span>${escapeHtml(formatDateTime(selectedIdea.generatedAt))}</span>
              <span>${escapeHtml(selectedIdea.region)}</span>
              <span>${escapeHtml(selectedIdea.themeId)}</span>
              <span>${escapeHtml(selectedIdea.direction.toUpperCase())}</span>
              <span>Conv ${selectedIdea.conviction}</span>
              <span>FP ${selectedIdea.falsePositiveRisk}</span>
              <span>Size ${selectedIdea.sizePct}%</span>
              <span>Best ${selectedDecision?.symbol ? `${escapeHtml(selectedDecision.symbol)} ${escapeHtml(selectedDecision.direction.toUpperCase())}` : 'n/a'} ${selectedDecision?.horizonHours ? `@ ${selectedDecision.horizonHours}h` : ''}</span>
              <span>Adj ${formatPct(selectedDecision?.costAdjustedSignedReturnPct ?? selectedDecision?.signedReturnPct)}</span>
            </div>
            <div class="investment-idea-thesis">${escapeHtml(selectedIdea.thesis)}</div>
            <div class="investment-grid-two">
              <div>
                <h5>Evidence</h5>
                <ul>${evidenceLines}</ul>
              </div>
              <div>
                <h5>Triggers</h5>
                <ul>${triggerLines}</ul>
                <h5>Invalidation</h5>
                <ul>${invalidationLines}</ul>
              </div>
            </div>
            ${buildSymbolReturnTable(selectedRun, selectedIdea)}
          ` : '<div class="panel-empty">No event selected.</div>'}
        </section>
      </div>
    `);
  }
}
