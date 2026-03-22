import { Panel } from './Panel';
import type {
  BacktestIdeaRun,
  ForwardReturnRecord,
  HistoricalReplayRun,
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

function runHitRate(run: HistoricalReplayRun, horizon: number): number | null {
  const rows = run.forwardReturns.filter(
    (row) => row.horizonHours === horizon && typeof row.signedReturnPct === 'number',
  );
  if (rows.length === 0) return null;
  const hits = rows.filter((row) => (row.signedReturnPct || 0) > 0).length;
  return Math.round((hits / rows.length) * 100);
}


function runCostAdjustedAvgReturn(run: HistoricalReplayRun, horizon: number): number | null {
  const rows = run.forwardReturns.filter(
    (row) => row.horizonHours === horizon && typeof row.costAdjustedSignedReturnPct === 'number',
  );
  if (rows.length === 0) return null;
  return Number(average(rows.map((row) => row.costAdjustedSignedReturnPct || 0)).toFixed(2));
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
    const horizon = primaryHorizon(selectedRun);
    
    // Aggregated Metrics
    const runHit = runHitRate(selectedRun, horizon);
    const runCostAvg = runCostAdjustedAvgReturn(selectedRun, horizon);
    const sourcePosterior = selectedRun.sourceProfiles.length > 0
      ? Math.round(average(selectedRun.sourceProfiles.map((p) => p.posteriorAccuracyScore)))
      : 0;

    // Build the Hub Content
    this.setContent(`
      <div class="backtest-lab-container">
        <!-- Main Content Area -->
        <main class="backtest-lab-main">
          <header class="backtest-lab-header">
            <div>
              <h1 class="backtest-lab-title">Backtest Lab</h1>
              <div class="backtest-lab-subtitle" style="color: var(--text-dim); font-size: 14px; margin-top: 4px;">
                ${escapeHtml(selectedRun.label)} • ${selectedRun.frameCount} frames • ${escapeHtml(selectedRun.mode.toUpperCase())}
              </div>
            </div>
            <div class="backtest-lab-actions" style="display: flex; gap: 12px;">
              <button class="backtest-lab-btn" data-action="refresh" style="padding: 8px 16px; font-size: 13px;">REFRESH DATA</button>
              <div class="status-badge live" style="padding: 6px 12px; border-radius: 20px; font-size: 11px; display: flex; align-items: center; gap: 6px;">
                 <span style="width: 8px; height: 8px; border-radius: 50%; background: var(--status-live); box-shadow: 0 0 10px var(--status-live);"></span>
                 SYNCHRONIZED
              </div>
            </div>
          </header>

          <!-- KPI Metrics Cards -->
          <div class="backtest-metrics-grid">
            <div class="backtest-metric-card">
              <span class="backtest-metric-label">Hit Rate</span>
              <span class="backtest-metric-value" style="color: ${runHit && runHit >= 50 ? 'var(--status-live)' : 'var(--status-issue)'}">
                ${runHit ?? 'n/a'}%
              </span>
            </div>
            <div class="backtest-metric-card">
              <span class="backtest-metric-label">Adj. Return</span>
              <span class="backtest-metric-value" style="color: ${runCostAvg && runCostAvg > 0 ? 'var(--status-live)' : 'var(--status-issue)'}">
                ${formatPct(runCostAvg)}
              </span>
            </div>
            <div class="backtest-metric-card">
              <span class="backtest-metric-label">Reality score</span>
              <span class="backtest-metric-value">${selectedRun.realitySummary.avgRealityScore}</span>
            </div>
            <div class="backtest-metric-card">
              <span class="backtest-metric-label">Src Posterior</span>
              <span class="backtest-metric-value">${sourcePosterior}%</span>
            </div>
          </div>

          <!-- Charts Section -->
          <div class="backtest-chart-section" style="margin-top: 24px;">
             ${this.renderEnhancedEquityCurve(decisions)}
          </div>

          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 24px; margin-top: 24px;">
            <div class="backtest-chart-section">
              <h3 style="margin-bottom: 16px; font-size: 14px; text-transform: uppercase; color: var(--text-dim);">Hit-rate Heatmap</h3>
              ${this.renderEnhancedHeatmap(decisions)}
            </div>
            <div class="backtest-chart-section">
              <h3 style="margin-bottom: 16px; font-size: 14px; text-transform: uppercase; color: var(--text-dim);">Run Distribution</h3>
              <div style="height: 120px; display: flex; align-items: flex-end; gap: 4px;">
                 ${selectedRun.ideaRuns.slice(0, 20).map(ir => `
                   <div style="flex: 1; height: ${Math.min(100, ir.conviction * 10)}%; background: var(--accent); opacity: 0.6; border-radius: 2px 2px 0 0;" title="${escapeHtml(ir.title)}"></div>
                 `).join('')}
              </div>
            </div>
          </div>

          <!-- Decision Table Section -->
          <section class="backtest-chart-section" style="margin-top: 24px;">
            <h3 style="margin-bottom: 20px; font-size: 14px; text-transform: uppercase; color: var(--text-dim);">Top Event Decisions</h3>
            <table class="investment-table">
               <thead>
                 <tr>
                    <th>EVENT TITLE</th>
                    <th>REGION</th>
                    <th>ASSET</th>
                    <th>DIR</th>
                    <th>HORIZON</th>
                    <th>ADJ RETURN</th>
                    <th>CONV</th>
                 </tr>
               </thead>
               <tbody>
                  ${decisions.slice(0, 10).map(d => `
                    <tr class="${d.ideaRunId === selectedIdea?.id ? 'active' : ''}" style="cursor: pointer" data-action="select-idea" data-idea-run-id="${d.ideaRunId}">
                       <td style="font-weight: 600;">${escapeHtml(d.title)}</td>
                       <td>${escapeHtml(d.region)}</td>
                       <td>${escapeHtml(d.symbol || '-')}</td>
                       <td><span class="pill ${d.direction === 'long' ? 'positive' : 'negative'}">${d.direction.toUpperCase()}</span></td>
                       <td>${d.horizonHours}h</td>
                       <td style="font-weight: 700; color: ${d.costAdjustedSignedReturnPct && d.costAdjustedSignedReturnPct > 0 ? 'var(--status-live)' : 'var(--status-issue)'}">
                         ${formatPct(d.costAdjustedSignedReturnPct)}
                       </td>
                       <td>${d.conviction}</td>
                    </tr>
                  `).join('')}
               </tbody>
            </table>
          </section>
        </main>

        <!-- Sidebar Section -->
        <aside class="backtest-lab-sidebar">
           <h3 style="font-size: 13px; text-transform: uppercase; color: var(--text-dim); margin-bottom: 16px;">Run Selection</h3>
           <div class="backtest-run-selector" style="display: flex; flex-direction: column; gap: 8px;">
              ${this.runs.map(run => `
                <button class="backtest-sidebar-btn ${run.id === selectedRun.id ? 'active' : ''}" 
                        data-action="select-run" data-run-id="${run.id}"
                        style="text-align: left; padding: 12px; border-radius: 8px; border: 1px solid var(--border); background: rgba(255,255,255,0.02); cursor: pointer; color: var(--text);">
                  <div style="font-weight: 600; font-size: 13px;">${escapeHtml(run.label)}</div>
                  <div style="font-size: 11px; color: var(--text-dim); margin-top: 2px;">${run.frameCount} frames • ${formatRelativeTime(run.completedAt)}</div>
                </button>
              `).join('')}
           </div>

           <div style="margin-top: 32px;">
             <h3 style="font-size: 13px; text-transform: uppercase; color: var(--text-dim); margin-bottom: 16px;">Importer Config</h3>
             <div class="backtest-control-group">
                <span class="backtest-control-label">File Path</span>
                <input type="text" data-field="filePath" class="backtest-input" value="${escapeHtml(this.controlState.filePath)}" placeholder="data/historical/..." />
             </div>
             <div class="backtest-control-group">
                <span class="backtest-control-label">Bucket Hours</span>
                <input type="number" data-field="bucketHours" class="backtest-input" value="${this.controlState.bucketHours}" />
             </div>
             <div class="backtest-control-group" style="display: flex; align-items: center; gap: 8px;">
                <input type="checkbox" data-field="postgresSync" ${this.controlState.postgresSync ? 'checked' : ''} />
                <span class="backtest-control-label" style="margin-bottom: 0;">Postgres Sync</span>
             </div>
             <button class="backtest-action-btn" data-action="import-dataset" style="margin-top: 12px;">IMPORT DATASET</button>
             <button class="backtest-action-btn" data-action="run-replay" style="margin-top: 8px; background: var(--surface-active); color: var(--text);">RUN REPLAY</button>
           </div>

           <div style="margin-top: 32px; padding: 16px; background: rgba(255,255,255,0.02); border-radius: 12px; border: 1px solid var(--border);">
              <h4 style="font-size: 12px; font-weight: 700; margin-bottom: 8px;">Action Log</h4>
              <div style="font-size: 11px; line-height: 1.5; color: var(--text-secondary);">
                ${escapeHtml(this.actionMessage || 'Awaiting command...')}
              </div>
           </div>
        </aside>
      </div>
    `);
  }

  private renderEnhancedEquityCurve(decisions: EventDecisionSummary[]): string {
    const rows = decisions.filter((d) => typeof (d.costAdjustedSignedReturnPct ?? d.signedReturnPct) === 'number');
    if (!rows.length) return '<div class="backtest-lab-note">No equity data for current focus.</div>';
    
    const width = 1000;
    const height = 240;
    let equity = 0;
    const points = rows
      .slice()
      .sort((a, b) => asTs(a.generatedAt) - asTs(b.generatedAt))
      .map((row, index, arr) => {
        equity += row.costAdjustedSignedReturnPct ?? row.signedReturnPct ?? 0;
        return { x: 40 + (index / Math.max(1, arr.length - 1)) * (width - 80), equity };
      });

    const minEquity = Math.min(0, ...points.map(p => p.equity));
    const maxEquity = Math.max(0, ...points.map(p => p.equity));
    const span = Math.max(0.1, maxEquity - minEquity);
    const yFor = (v: number) => height - 30 - ((v - minEquity) / span) * (height - 60);
    
    const linePath = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${yFor(p.equity).toFixed(1)}`).join(' ');
    const lastPoint = points[points.length - 1];
    const firstPoint = points[0];
    const areaPath = lastPoint && firstPoint ? `${linePath} L ${lastPoint.x.toFixed(1)} ${yFor(0).toFixed(1)} L ${firstPoint.x.toFixed(1)} ${yFor(0).toFixed(1)} Z` : '';
    
    return `
      <div style="position: relative;">
        <div style="position: absolute; top: 0; left: 0;">
           <div class="backtest-metric-label">Cumulative Return</div>
           <div style="font-size: 24px; font-weight: 800; color: ${equity >= 0 ? 'var(--status-live)' : 'var(--status-issue)'}">
             ${formatPct(equity)}
           </div>
        </div>
        <svg viewBox="0 0 ${width} ${height}" class="backtest-equity-svg">
          <defs>
            <linearGradient id="equity-gradient" x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stop-color="var(--accent)" stop-opacity="0.3" />
              <stop offset="100%" stop-color="var(--accent)" stop-opacity="0" />
            </linearGradient>
          </defs>
          <line x1="40" y1="${yFor(0)}" x2="${width - 40}" y2="${yFor(0)}" stroke="rgba(255,255,255,0.1)" stroke-dasharray="4 4" />
          <path d="${areaPath}" class="backtest-equity-area" />
          <path d="${linePath}" class="backtest-equity-line" />
          ${points.filter((_, i) => i % Math.max(1, Math.floor(points.length / 10)) === 0).map(p => `
            <circle cx="${p.x}" cy="${yFor(p.equity)}" r="4" fill="var(--accent)" />
          `).join('')}
        </svg>
      </div>
    `;
  }

  private renderEnhancedHeatmap(decisions: EventDecisionSummary[]): string {
    const rows = decisions.filter((d) => typeof (d.costAdjustedSignedReturnPct ?? d.signedReturnPct) === 'number');
    if (!rows.length) return '<div class="backtest-lab-note">No heatmap data.</div>';
    
    const byDay = new Map<string, { total: number; count: number }>();
    for (const d of rows) {
      const day = d.generatedAt.slice(0, 10);
      const b = byDay.get(day) || { total: 0, count: 0 };
      b.total += d.costAdjustedSignedReturnPct ?? d.signedReturnPct ?? 0;
      b.count++;
      byDay.set(day, b);
    }
    
    const cells = Array.from(byDay.entries()).slice(-28).map(([day, b]) => {
      const avg = b.total / b.count;
      let tone = '';
      if (avg >= 2) tone = 'strong-pos';
      else if (avg > 0) tone = 'positive';
      else if (avg < -2) tone = 'strong-neg';
      else if (avg < 0) tone = 'negative';
      
      return `<div class="backtest-heat-cell ${tone}" title="${day}: ${formatPct(avg)}">${day.slice(8)}</div>`;
    }).join('');
    
    return `<div class="backtest-heatmap-grid">${cells}</div>`;
  }
}
