import { Panel } from './Panel';
import {
  getDataFlowOpsSnapshot,
  peekCachedDataFlowOpsSnapshot,
  refreshDataFlowOpsSnapshot,
  subscribeDataFlowOpsSnapshot,
  type DataFlowOpsCheck,
  type DataFlowOpsDatasetRow,
  type DataFlowOpsIssue,
  type DataFlowOpsSnapshot,
  type DataFlowOpsStatusTone,
} from '@/services/data-flow-ops';
import { escapeHtml } from '@/utils/sanitize';

function asTs(value?: string | null): number {
  const parsed = Date.parse(String(value || ''));
  return Number.isFinite(parsed) ? parsed : 0;
}

function fmtDateTime(value?: string | null): string {
  const ts = asTs(value);
  if (!ts) return '-';
  return new Date(ts).toLocaleString();
}

function fmtAgo(value?: string | null): string {
  const ts = asTs(value);
  if (!ts) return '-';
  const deltaMinutes = Math.max(0, Math.round((Date.now() - ts) / 60_000));
  if (deltaMinutes < 1) return 'just now';
  if (deltaMinutes < 60) return `${deltaMinutes}m ago`;
  const hours = Math.floor(deltaMinutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function fmtMinutes(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return '-';
  if (value < 60) return `${value}m`;
  const hours = Math.floor(value / 60);
  const mins = value % 60;
  if (hours < 24) return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
  const days = Math.floor(hours / 24);
  const remHours = hours % 24;
  return remHours > 0 ? `${days}d ${remHours}h` : `${days}d`;
}

function fmtPct(value: number | null | undefined, digits = 0): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '-';
  return `${value.toFixed(digits)}%`;
}

function statusChip(status: DataFlowOpsStatusTone): string {
  return `<span class="investment-action-chip ${status}">${escapeHtml(status.toUpperCase())}</span>`;
}

function renderCheckRow(check: DataFlowOpsCheck): string {
  return `
    <div class="dataflow-ops-check ${check.status}">
      <div class="dataflow-ops-check-top">
        <span class="investment-mini-label">${escapeHtml(check.label)}</span>
        ${statusChip(check.status)}
      </div>
      <div class="investment-coverage-note">${escapeHtml(check.detail)}</div>
    </div>
  `;
}

function renderIssueRow(issue: DataFlowOpsIssue): string {
  return `
    <li class="dataflow-ops-issue ${issue.status}">
      <div class="dataflow-ops-issue-top">
        <span>${escapeHtml(issue.title)}</span>
        ${statusChip(issue.status)}
      </div>
      <div class="investment-coverage-note">${escapeHtml(issue.detail)}</div>
      ${issue.suggestion ? `<div class="dataflow-ops-fix">Fix: ${escapeHtml(issue.suggestion)}</div>` : ''}
    </li>
  `;
}

function renderProgressBar(dataset: DataFlowOpsDatasetRow): string {
  return `
    <div class="dataflow-ops-progress">
      <div class="dataflow-ops-progress-fill" style="width:${Math.max(0, Math.min(100, dataset.progressPct))}%"></div>
    </div>
    <div class="source-ops-subtext">${escapeHtml(dataset.stageLabel)} · ${dataset.progressPct}%</div>
  `;
}

function renderDatasetRow(dataset: DataFlowOpsDatasetRow): string {
  const blockerText = dataset.blockers[0] || dataset.suggestedFix;
  return `
    <tr>
      <td>
        <div><strong>${escapeHtml(dataset.label)}</strong></div>
        <div class="source-ops-subtext">${escapeHtml(dataset.datasetId)} · ${escapeHtml(dataset.provider)}</div>
      </td>
      <td>
        ${statusChip(dataset.status)}
        <div class="source-ops-subtext">${dataset.enabled ? 'enabled' : 'manual / archived'}</div>
      </td>
      <td>
        ${renderProgressBar(dataset)}
      </td>
      <td>
        <div><strong>${escapeHtml(fmtMinutes(dataset.pipelineLagMinutes))}</strong></div>
        <div class="source-ops-subtext">fetch ${escapeHtml(fmtMinutes(dataset.fetchLagMinutes))} · replay ${escapeHtml(fmtMinutes(dataset.replayLagMinutes))}</div>
        <div class="source-ops-subtext">next ${escapeHtml(fmtAgo(dataset.nextEligibleAt))}</div>
      </td>
      <td>
        <div><strong>${dataset.rawRecordCount}</strong> raw · <strong>${dataset.frameCount}</strong> frames</div>
        <div class="source-ops-subtext">imported ${escapeHtml(fmtAgo(dataset.importedAt))}</div>
        <div class="source-ops-subtext">warmup ${dataset.warmupFrameCount}</div>
      </td>
      <td>
        <div><strong>${fmtPct(dataset.completenessScore)}</strong> complete · <strong>${fmtPct(dataset.coverageDensity)}</strong> dense</div>
        <div class="source-ops-subtext">gap ${fmtPct(dataset.gapRatio * 100)} · lag ${dataset.knowledgeLagHours.toFixed(1)}h</div>
      </td>
      <td>
        <div><strong>${dataset.artifactCount}</strong> / ${dataset.artifactRetentionCount}</div>
        <div class="source-ops-subtext">${dataset.retentionDays}d policy · ${fmtPct(dataset.retentionPressurePct)}</div>
      </td>
      <td>
        <div>${escapeHtml(blockerText)}</div>
        ${dataset.lastError ? `<div class="dataflow-ops-fix">Last error: ${escapeHtml(dataset.lastError)}</div>` : ''}
      </td>
    </tr>
  `;
}

export class DataFlowOpsPanel extends Panel {
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private unsubscribeSnapshot: (() => void) | null = null;
  private readonly onClickBound: (event: MouseEvent) => void;
  private inFlight = false;
  private problemsOnly = false;
  private lastSnapshot: DataFlowOpsSnapshot | null = null;

  constructor() {
    super({
      id: 'dataflow-ops',
      title: 'Data Flow Status',
      showCount: true,
      trackActivity: false,
    });
    this.onClickBound = (event: MouseEvent) => this.handleClick(event);
    this.content.addEventListener('click', this.onClickBound);
    this.lastSnapshot = peekCachedDataFlowOpsSnapshot();
    if (this.lastSnapshot) {
      this.renderSnapshot(this.lastSnapshot);
    } else {
      void this.refresh();
    }
    this.unsubscribeSnapshot = subscribeDataFlowOpsSnapshot((snapshot) => {
      this.lastSnapshot = snapshot;
      this.renderSnapshot(snapshot);
    });
    this.refreshTimer = setInterval(() => {
      void this.refresh();
    }, 20_000);
  }

  public destroy(): void {
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
    this.unsubscribeSnapshot?.();
    this.unsubscribeSnapshot = null;
    this.content.removeEventListener('click', this.onClickBound);
    super.destroy();
  }

  public async refresh(forceRefresh = false): Promise<void> {
    if (this.inFlight) return;
    this.inFlight = true;
    try {
      const snapshot = forceRefresh
        ? await refreshDataFlowOpsSnapshot()
        : await getDataFlowOpsSnapshot();
      this.lastSnapshot = snapshot;
      this.renderSnapshot(snapshot);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Data flow ops refresh failed';
      this.showError(message);
    } finally {
      this.inFlight = false;
    }
  }

  private handleClick(event: MouseEvent): void {
    const target = event.target instanceof HTMLElement ? event.target.closest<HTMLElement>('[data-action]') : null;
    if (!target) return;
    const action = target.dataset.action;
    if (action === 'refresh') {
      void this.refresh(true);
      return;
    }
    if (action === 'toggle-problems') {
      this.problemsOnly = !this.problemsOnly;
      if (this.lastSnapshot) {
        this.renderSnapshot(this.lastSnapshot);
      } else {
        void this.refresh();
      }
    }
  }

  private renderSnapshot(snapshot: DataFlowOpsSnapshot): void {
    const visibleDatasets = this.problemsOnly
      ? snapshot.datasets.filter((dataset) => dataset.status !== 'ready')
      : snapshot.datasets;
    this.setCount(snapshot.overview.issuesCount);

    const checksHtml = snapshot.checks.map((check) => renderCheckRow(check)).join('');
    const issuesHtml = snapshot.issues.length > 0
      ? snapshot.issues.map((issue) => renderIssueRow(issue)).join('')
      : '<li class="source-ops-empty">No active blockers detected.</li>';
    const datasetRows = visibleDatasets.length > 0
      ? visibleDatasets.map((dataset) => renderDatasetRow(dataset)).join('')
      : '<tr><td colspan="7">No datasets match the current filter.</td></tr>';
    const recentRunRows = snapshot.recentRuns.length > 0
      ? snapshot.recentRuns.map((run) => `
          <tr>
            <td>${escapeHtml(run.kind)}</td>
            <td>${statusChip(run.status === 'error' ? 'blocked' : run.status === 'skipped' ? 'watch' : 'ready')}</td>
            <td>${escapeHtml(run.datasetId || 'global')}</td>
            <td>${escapeHtml(fmtAgo(run.completedAt))}</td>
            <td>${escapeHtml(run.detail)}</td>
          </tr>
        `).join('')
      : '<tr><td colspan="5">No recent automation runs recorded.</td></tr>';
    const serviceRows = snapshot.localOps?.serviceStatus?.services?.length
      ? snapshot.localOps.serviceStatus.services.map((service) => `
          <tr>
            <td>${escapeHtml(service.name || service.id || 'service')}</td>
            <td>${statusChip(
              service.status === 'operational'
                ? 'ready'
                : service.status === 'degraded'
                  ? 'watch'
                  : service.status === 'outage'
                    ? 'blocked'
                    : 'watch',
            )}</td>
            <td>${escapeHtml(service.category || '-')}</td>
            <td>${escapeHtml(service.description || '-')}</td>
          </tr>
        `).join('')
      : '<tr><td colspan="4">Local service status unavailable.</td></tr>';

    this.content.innerHTML = `
      <div class="source-ops-root dataflow-ops-shell">
        <div class="investment-panel-meta">
          <span>SNAPSHOT ${escapeHtml(fmtAgo(snapshot.currentSnapshot.generatedAt))}</span>
          <span>LAST CYCLE ${escapeHtml(fmtAgo(snapshot.overview.latestCycleAt))}</span>
          <span>QUEUE ${snapshot.overview.queueDepth}</span>
          <span>OPS ${escapeHtml(fmtAgo(snapshot.pipeline.sampledAt))} via ${escapeHtml(snapshot.pipeline.source)}</span>
          <span>ACTIVE ${escapeHtml(snapshot.pipeline.activeCycleStatus.toUpperCase())}${snapshot.pipeline.activeStage ? ` · ${escapeHtml(snapshot.pipeline.activeStage)}` : ''}</span>
          <span>RETENTION ${snapshot.retention.retentionDays}d / ${snapshot.retention.artifactRetentionCount} artifacts</span>
          <span>UPDATED ${escapeHtml(fmtDateTime(snapshot.generatedAt))}</span>
        </div>

        <div class="source-ops-section">
          <div class="source-ops-section-title source-ops-section-title-with-actions">
            <span>Data Flow Status</span>
            <div class="source-ops-actions">
              <button class="source-ops-action ${this.problemsOnly ? 'primary' : ''}" data-action="toggle-problems">${this.problemsOnly ? 'Show All Datasets' : 'Problems Only'}</button>
              <button class="source-ops-action primary" data-action="refresh">Refresh</button>
            </div>
          </div>
          <div class="source-ops-summary-grid">
            <div class="source-ops-summary-card">
              <div class="source-ops-summary-title">Current Snapshot</div>
              <div class="source-ops-summary-row"><span>Status</span><strong>${escapeHtml(snapshot.currentSnapshot.status.toUpperCase())}</strong></div>
              <div class="source-ops-summary-row"><span>Lag</span><strong>${escapeHtml(fmtMinutes(snapshot.currentSnapshot.lagMinutes))}</strong></div>
              <div class="source-ops-summary-row"><span>Ideas</span><strong>${snapshot.currentSnapshot.ideaCards}</strong></div>
            </div>
            <div class="source-ops-summary-card">
              <div class="source-ops-summary-title">Historical Pipeline</div>
              <div class="source-ops-summary-row"><span>Ready</span><strong>${snapshot.overview.readyDatasets}</strong></div>
              <div class="source-ops-summary-row"><span>Watch / degraded</span><strong>${snapshot.overview.watchDatasets + snapshot.overview.degradedDatasets}</strong></div>
              <div class="source-ops-summary-row"><span>Blocked</span><strong>${snapshot.overview.blockedDatasets}</strong></div>
            </div>
            <div class="source-ops-summary-card">
              <div class="source-ops-summary-title">Coverage & Retention</div>
              <div class="source-ops-summary-row"><span>Datasets</span><strong>${snapshot.coverage.datasetCount}</strong></div>
              <div class="source-ops-summary-row"><span>Artifacts</span><strong>${snapshot.retention.totalArtifacts}</strong></div>
              <div class="source-ops-summary-row"><span>Pressure</span><strong>${fmtPct(snapshot.overview.retentionPressurePct)}</strong></div>
            </div>
            <div class="source-ops-summary-card">
              <div class="source-ops-summary-title">Processing Pressure</div>
              <div class="source-ops-summary-row"><span>Open queue</span><strong>${snapshot.pipeline.openThemeQueueDepth}</strong></div>
              <div class="source-ops-summary-row"><span>Dataset proposals</span><strong>${snapshot.pipeline.datasetProposalDepth}</strong></div>
              <div class="source-ops-summary-row"><span>Max failures</span><strong>${snapshot.pipeline.maxConsecutiveFailures}</strong></div>
            </div>
            <div class="source-ops-summary-card">
              <div class="source-ops-summary-title">Active Cycle</div>
              <div class="source-ops-summary-row"><span>Status</span><strong>${escapeHtml(snapshot.pipeline.activeCycleStatus.toUpperCase())}</strong></div>
              <div class="source-ops-summary-row"><span>Source</span><strong>${escapeHtml(snapshot.pipeline.source)}</strong></div>
              <div class="source-ops-summary-row"><span>Progress</span><strong>${snapshot.pipeline.activeProgressPct == null ? 'n/a' : `${snapshot.pipeline.activeProgressPct}%`}</strong></div>
              <div class="source-ops-summary-row"><span>Heartbeat</span><strong>${escapeHtml(fmtMinutes(snapshot.pipeline.heartbeatLagMinutes))}</strong></div>
            </div>
            <div class="source-ops-summary-card">
              <div class="source-ops-summary-title">Backtest Readiness</div>
              <div class="source-ops-summary-row"><span>Coverage</span><strong>${fmtPct(snapshot.coverage.coverage.globalCompletenessScore)}</strong></div>
              <div class="source-ops-summary-row"><span>Replay quality</span><strong>${fmtPct(snapshot.backtestOps?.derived.qualityScore ?? null)}</strong></div>
              <div class="source-ops-summary-row"><span>Execution</span><strong>${fmtPct(snapshot.backtestOps?.derived.executionScore ?? null)}</strong></div>
            </div>
            <div class="source-ops-summary-card">
              <div class="source-ops-summary-title">What This Means Now</div>
              <div class="investment-coverage-note">${escapeHtml(snapshot.currentSnapshot.summary)}</div>
              <div class="source-ops-summary-row"><span>Problems</span><strong>${snapshot.overview.issuesCount}</strong></div>
            </div>
          </div>
        </div>

        <div class="investment-grid-two">
          <section class="investment-subcard">
            <div class="investment-subcard-head">
              <h4>Checks</h4>
              ${statusChip(snapshot.overview.status)}
            </div>
            <div class="dataflow-ops-check-grid">
              ${checksHtml}
            </div>
          </section>
          <section class="investment-subcard">
            <div class="investment-subcard-head">
              <h4>Blockers & Fixes</h4>
              <span class="investment-mini-label">${snapshot.issues.length} items</span>
            </div>
            <ul class="dataflow-ops-issue-list">${issuesHtml}</ul>
          </section>
        </div>

        <section class="source-ops-section">
          <div class="source-ops-section-title source-ops-section-title-with-actions">
            <span>Per-Dataset Pipeline Status</span>
            <span class="investment-mini-label">${visibleDatasets.length}/${snapshot.datasets.length} shown</span>
          </div>
          <div class="source-ops-table-wrap dataflow-ops-table-wrap">
            <table class="source-ops-table dataflow-ops-table">
              <thead>
                <tr>
                  <th>Dataset</th>
                  <th>Health</th>
                  <th>Progress</th>
                  <th>Lag</th>
                  <th>Storage</th>
                  <th>Coverage</th>
                  <th>Retention / Fix</th>
                </tr>
              </thead>
              <tbody>${datasetRows}</tbody>
            </table>
          </div>
        </section>

        <div class="investment-grid-two">
          <section class="source-ops-section">
            <div class="source-ops-section-title">Recent Pipeline Events</div>
            <div class="source-ops-table-wrap">
              <table class="source-ops-table">
                <thead>
                  <tr>
                    <th>Kind</th>
                    <th>Status</th>
                    <th>Dataset</th>
                    <th>When</th>
                    <th>Detail</th>
                  </tr>
                </thead>
                <tbody>${recentRunRows}</tbody>
              </table>
            </div>
          </section>

          <section class="source-ops-section">
            <div class="source-ops-section-title">Local Services & Access</div>
            <div class="source-ops-table-wrap">
              <table class="source-ops-table">
                <thead>
                  <tr>
                    <th>Service</th>
                    <th>Status</th>
                    <th>Class</th>
                    <th>Detail</th>
                  </tr>
                </thead>
                <tbody>${serviceRows}</tbody>
              </table>
            </div>
            <div class="source-ops-meta dataflow-ops-meta">
              <span>Required keys missing: ${(snapshot.localOps?.credentials?.missingRequiredKeys || []).length}</span>
              <span>Latest pipeline error: ${escapeHtml(snapshot.pipeline.lastError || 'none')}</span>
            </div>
          </section>
        </div>
      </div>
    `;
  }
}
