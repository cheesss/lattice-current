import { Panel } from './Panel';
import {
  getResourceTelemetrySnapshot,
  refreshResourceEnvironment,
  subscribeResourceTelemetry,
  type ResourceTelemetryAggregate,
  type ResourceTelemetrySample,
  type ResourceTelemetrySnapshot,
} from '@/services/resource-telemetry';
import { escapeHtml } from '@/utils/sanitize';

type ResourceFilter = 'all' | 'collection' | 'analytics' | 'risk' | 'graph' | 'backtest' | 'api' | 'orchestration';

function formatMs(value: number | null | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 'n/a';
  if (value >= 1000) return `${(value / 1000).toFixed(2)}s`;
  return `${value.toFixed(0)}ms`;
}

function formatMb(value: number | null | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 'n/a';
  return `${value.toFixed(1)} MB`;
}

function formatPct(value: number | null | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 'n/a';
  return `${value.toFixed(1)}%`;
}

function formatRelativeTime(value: string): string {
  const ts = Date.parse(value);
  if (!Number.isFinite(ts)) return value;
  const diffMs = Math.max(0, Date.now() - ts);
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function filterAggregate(filter: ResourceFilter, row: ResourceTelemetryAggregate): boolean {
  return filter === 'all' || row.kind === filter;
}

function filterSample(filter: ResourceFilter, row: ResourceTelemetrySample): boolean {
  return filter === 'all' || row.kind === filter;
}

export class ResourceProfilerPanel extends Panel {
  private snapshot: ResourceTelemetrySnapshot = getResourceTelemetrySnapshot();
  private filter: ResourceFilter = 'all';
  private unsubscribe: (() => void) | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    super({ id: 'resource-profiler', title: 'Resource Profiler', showCount: true });
    this.unsubscribe = subscribeResourceTelemetry((snapshot) => {
      this.snapshot = snapshot;
      this.render();
    });
    this.pollTimer = setInterval(() => {
      void refreshResourceEnvironment(false);
    }, 15000);
    void refreshResourceEnvironment(true);
    this.render();
  }

  override destroy(): void {
    if (this.pollTimer) clearInterval(this.pollTimer);
    this.pollTimer = null;
    this.unsubscribe?.();
    this.unsubscribe = null;
    super.destroy();
  }

  protected render(): void {
    const aggregates = this.snapshot.aggregates.filter((row) => filterAggregate(this.filter, row));
    const samples = this.snapshot.samples.filter((row) => filterSample(this.filter, row));
    const hottest = aggregates[0] || null;
    const memoryHot = aggregates
      .slice()
      .sort((a, b) => b.peakHeapDeltaMB - a.peakHeapDeltaMB)[0] || null;

    this.setCount(aggregates.length);
    this.setErrorState(false);

    this.content.innerHTML = `
      <div class="resource-profiler">
        <div class="resource-profiler-toolbar">
          ${this.renderFilterButton('all', 'All')}
          ${this.renderFilterButton('collection', 'Collection')}
          ${this.renderFilterButton('analytics', 'Analytics')}
          ${this.renderFilterButton('risk', 'Risk')}
          ${this.renderFilterButton('graph', 'Graph')}
          ${this.renderFilterButton('backtest', 'Backtest')}
          ${this.renderFilterButton('api', 'API')}
        </div>

        <div class="resource-profiler-summary">
          <div class="resource-profiler-card">
            <span class="resource-profiler-label">Hottest path</span>
            <strong>${escapeHtml(hottest?.label || 'No telemetry yet')}</strong>
            <span>${hottest ? `Intensity ${hottest.intensityScore} | avg ${formatMs(hottest.avgDurationMs)}` : 'Waiting for executed operations.'}</span>
          </div>
          <div class="resource-profiler-card">
            <span class="resource-profiler-label">Peak heap delta</span>
            <strong>${escapeHtml(memoryHot?.label || 'n/a')}</strong>
            <span>${memoryHot ? formatMb(memoryHot.peakHeapDeltaMB) : 'No memory sample yet.'}</span>
          </div>
          <div class="resource-profiler-card">
            <span class="resource-profiler-label">Browser storage</span>
            <strong>${formatPct(this.snapshot.storage?.usagePct)}</strong>
            <span>${formatMb(this.snapshot.storage?.usedMB)} / ${formatMb(this.snapshot.storage?.quotaMB)}</span>
          </div>
          <div class="resource-profiler-card">
            <span class="resource-profiler-label">Desktop sidecar RSS</span>
            <strong>${formatMb(this.snapshot.desktop?.rssMB)}</strong>
            <span>Archive DB ${formatMb(this.snapshot.desktop?.archiveDbMB)}</span>
          </div>
        </div>

        <div class="resource-profiler-section">
          <div class="resource-profiler-section-head">
            <span class="resource-profiler-section-title">Hotspots by operation</span>
            <span class="resource-profiler-section-note">${samples.length} recent samples</span>
          </div>
          ${aggregates.length > 0 ? this.renderHotspots(aggregates.slice(0, 8)) : '<div class="resource-profiler-empty">No resource samples captured yet. Run data collection or backtests to populate this view.</div>'}
        </div>

        <div class="resource-profiler-grid">
          <div class="resource-profiler-section">
            <div class="resource-profiler-section-head">
              <span class="resource-profiler-section-title">Recent timeline</span>
              <span class="resource-profiler-section-note">duration + status</span>
            </div>
            ${this.renderTimeline(samples.slice(0, 18))}
          </div>
          <div class="resource-profiler-section">
            <div class="resource-profiler-section-head">
              <span class="resource-profiler-section-title">Analysis</span>
              <span class="resource-profiler-section-note">${formatRelativeTime(this.snapshot.generatedAt)}</span>
            </div>
            ${this.renderAnalyses()}
          </div>
        </div>

        <div class="resource-profiler-section">
          <div class="resource-profiler-section-head">
            <span class="resource-profiler-section-title">Desktop capacity</span>
            <span class="resource-profiler-section-note">sidecar process snapshot</span>
          </div>
          ${this.renderDesktopStats()}
        </div>
      </div>
    `;

    this.bindToolbar();
  }

  private renderFilterButton(filter: ResourceFilter, label: string): string {
    return `<button class="resource-profiler-filter ${this.filter === filter ? 'active' : ''}" data-filter="${filter}">${escapeHtml(label)}</button>`;
  }

  private renderHotspots(rows: ResourceTelemetryAggregate[]): string {
    return `
      <div class="resource-profiler-hotspots">
        ${rows.map((row) => `
          <div class="resource-profiler-hotspot ${row.errorCount > 0 ? 'has-error' : ''}">
            <div class="resource-profiler-hotspot-head">
              <div>
                <strong>${escapeHtml(row.label)}</strong>
                <span>${escapeHtml(row.operation)}</span>
              </div>
              <div class="resource-profiler-hotspot-metrics">
                <span>${formatMs(row.avgDurationMs)} avg</span>
                <span>${formatMb(row.peakHeapDeltaMB)} peak heap</span>
                <span>${row.sampleCount}x</span>
              </div>
            </div>
            <div class="resource-profiler-bar-track">
              <div class="resource-profiler-bar-fill" style="width:${Math.max(6, row.intensityScore)}%"></div>
            </div>
            <div class="resource-profiler-hotspot-foot">
              <span>${row.kind}</span>
              <span>inputs ${row.totalInputCount} | outputs ${row.totalOutputCount}</span>
              <span>${row.errorCount > 0 ? `${row.errorCount} errors` : `last ${formatRelativeTime(row.lastSeenAt)}`}</span>
            </div>
          </div>
        `).join('')}
      </div>
    `;
  }

  private renderTimeline(rows: ResourceTelemetrySample[]): string {
    if (!rows.length) {
      return '<div class="resource-profiler-empty">No recent executions.</div>';
    }
    const peak = Math.max(...rows.map((row) => row.durationMs), 1);
    return `
      <div class="resource-profiler-timeline">
        ${rows.map((row) => `
          <div class="resource-profiler-timeline-row ${row.status === 'error' ? 'error' : ''}">
            <span class="resource-profiler-timeline-label">${escapeHtml(row.label)}</span>
            <div class="resource-profiler-timeline-track">
              <div class="resource-profiler-timeline-fill ${row.kind}" style="width:${Math.max(4, (row.durationMs / peak) * 100)}%"></div>
            </div>
            <span class="resource-profiler-timeline-value">${formatMs(row.durationMs)}</span>
          </div>
        `).join('')}
      </div>
    `;
  }

  private renderAnalyses(): string {
    if (!this.snapshot.analyses.length) {
      return '<div class="resource-profiler-empty">Analysis will appear after a few collection and compute runs.</div>';
    }
    return `
      <ul class="resource-profiler-analysis">
        ${this.snapshot.analyses.map((line) => `<li>${escapeHtml(line)}</li>`).join('')}
      </ul>
    `;
  }

  private renderDesktopStats(): string {
    const desktop = this.snapshot.desktop;
    return `
      <div class="resource-profiler-desktop">
        <div class="resource-profiler-desktop-card">
          <span class="resource-profiler-label">CPU user/system</span>
          <strong>${desktop ? `${desktop.cpuUserSec?.toFixed(1) || 'n/a'}s / ${desktop.cpuSystemSec?.toFixed(1) || 'n/a'}s` : 'n/a'}</strong>
          <span>uptime ${desktop?.uptimeSec ? `${Math.round(desktop.uptimeSec / 60)}m` : 'n/a'}</span>
        </div>
        <div class="resource-profiler-desktop-card">
          <span class="resource-profiler-label">Heap</span>
          <strong>${formatMb(desktop?.heapUsedMB)}</strong>
          <span>of ${formatMb(desktop?.heapTotalMB)}</span>
        </div>
        <div class="resource-profiler-desktop-card">
          <span class="resource-profiler-label">RSS / external</span>
          <strong>${formatMb(desktop?.rssMB)}</strong>
          <span>external ${formatMb(desktop?.externalMB)}</span>
        </div>
        <div class="resource-profiler-desktop-card">
          <span class="resource-profiler-label">Load average / archive</span>
          <strong>${desktop?.loadAvg1m?.toFixed(2) || 'n/a'}</strong>
          <span>archive ${formatMb(desktop?.archiveDbMB)}</span>
        </div>
      </div>
    `;
  }

  private bindToolbar(): void {
    this.content.querySelectorAll<HTMLButtonElement>('.resource-profiler-filter').forEach((button) => {
      button.onclick = () => {
        const next = button.dataset.filter as ResourceFilter | undefined;
        if (!next || next === this.filter) return;
        this.filter = next;
        this.render();
      };
    });
  }
}
