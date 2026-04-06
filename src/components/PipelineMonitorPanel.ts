/**
 * PipelineMonitorPanel — real-time dashboard for the investment pipeline.
 *
 * Displays:
 *  - Per-stage timing bars (from orchestrator stageTimings)
 *  - Recent log entries (from pipeline-logger)
 *  - Orchestrator health summary
 *  - Error/warning counts with visual indicators
 *
 * Auto-refreshes every 10 s or when the pipeline completes a run.
 */

import { Panel } from './Panel';
import { t } from '@/services/i18n';
import { h, replaceChildren } from '@/utils/dom-utils';
import { getPipelineLog, type PipelineLogEntry } from '@/services/investment/pipeline-logger';
import { getOrchestratorHealth } from '@/services/investment/orchestrator';
import { safeHtml } from '@/utils/dom-utils';

const REFRESH_INTERVAL_MS = 10_000;
const MAX_VISIBLE_LOGS = 30;

export class PipelineMonitorPanel extends Panel {
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private filterLevel: PipelineLogEntry['level'] | 'all' = 'all';

  constructor() {
    super({
      id: 'pipeline-monitor',
      title: t('panels.pipelineMonitor') || 'Pipeline Monitor',
      showCount: true,
      trackActivity: true,
      infoTooltip: 'Real-time investment pipeline observability — stage timings, logs, and health.',
    });

    this.render();
    this.startAutoRefresh();

    // Listen for pipeline completion events
    document.addEventListener('wm:intelligence-updated', () => this.render());
  }

  private startAutoRefresh(): void {
    this.refreshTimer = setInterval(() => this.render(), REFRESH_INTERVAL_MS);
  }

  public destroy(): void {
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
    document.removeEventListener('wm:intelligence-updated', this.render);
  }

  private render = (): void => {
    const health = getOrchestratorHealth();
    const log = getPipelineLog();

    if (!health && log.length === 0) {
      this.showEmpty('No pipeline runs recorded yet.');
      this.setCount(0);
      return;
    }

    const container = h('div', { className: 'pipeline-monitor' });

    // ── Health summary ──
    if (health) {
      const healthEl = this.buildHealthSection(health);
      container.appendChild(healthEl);
    }

    // ── Stage timings ──
    if (health && (health as Record<string, unknown>)['stageTimings']) {
      // stageTimings is stored in _lastRunMeta via orchestrator
    }
    // Build timings from log info entries
    const timingEntries = log.filter(e => e.level === 'info' && e.durationMs !== undefined);
    if (timingEntries.length > 0) {
      container.appendChild(this.buildTimingBars(timingEntries));
    }

    // ── Filter tabs ──
    container.appendChild(this.buildFilterTabs(log));

    // ── Log entries ──
    const filteredLog = this.filterLevel === 'all'
      ? log
      : log.filter(e => e.level === this.filterLevel);
    const recentLog = filteredLog.slice(-MAX_VISIBLE_LOGS).reverse();
    container.appendChild(this.buildLogTable(recentLog));

    // Update count badge
    const errorCount = log.filter(e => e.level === 'error').length;
    const warnCount = log.filter(e => e.level === 'warn').length;
    this.setCount(errorCount + warnCount);

    replaceChildren(this.content, container);
  };

  private buildHealthSection(health: {
    at: string;
    durationMs: number;
    errors: number;
    degraded: string[];
  }): HTMLElement {
    const statusClass = health.errors > 0 ? 'health-error' : health.degraded.length > 0 ? 'health-warn' : 'health-ok';
    const statusLabel = health.errors > 0 ? 'ERROR' : health.degraded.length > 0 ? 'DEGRADED' : 'HEALTHY';

    const el = h('div', { className: `pm-health ${statusClass}` },
      h('div', { className: 'pm-health-status' },
        h('span', { className: 'pm-health-dot' }),
        h('span', { className: 'pm-health-label' }, statusLabel),
      ),
      h('div', { className: 'pm-health-meta' },
        h('span', {}, `Last run: ${this.formatTimestamp(health.at)}`),
        h('span', {}, `Duration: ${health.durationMs}ms`),
        h('span', {}, `Errors: ${health.errors}`),
      ),
    );

    if (health.degraded.length > 0) {
      el.appendChild(
        h('div', { className: 'pm-health-degraded' },
          `Degraded stages: ${health.degraded.join(', ')}`,
        ),
      );
    }

    return el;
  }

  private buildTimingBars(entries: PipelineLogEntry[]): HTMLElement {
    const maxMs = Math.max(...entries.map(e => e.durationMs ?? 0), 1);
    const section = h('div', { className: 'pm-timings' },
      h('div', { className: 'pm-section-title' }, 'Stage Timings'),
    );

    for (const entry of entries.slice(-8)) {
      const pct = Math.round(((entry.durationMs ?? 0) / maxMs) * 100);
      const bar = h('div', { className: 'pm-timing-row' },
        h('span', { className: 'pm-timing-stage' }, entry.stage),
        h('div', { className: 'pm-timing-bar-bg' },
          h('div', {
            className: `pm-timing-bar-fill ${(entry.durationMs ?? 0) > 1000 ? 'slow' : ''}`,
            style: `width: ${pct}%`,
          }),
        ),
        h('span', { className: 'pm-timing-ms' }, `${entry.durationMs}ms`),
      );
      section.appendChild(bar);
    }

    return section;
  }

  private buildFilterTabs(log: readonly PipelineLogEntry[]): HTMLElement {
    const counts = {
      all: log.length,
      error: log.filter(e => e.level === 'error').length,
      warn: log.filter(e => e.level === 'warn').length,
      info: log.filter(e => e.level === 'info').length,
    };

    const tabs = h('div', { className: 'pm-filter-tabs' });
    for (const level of ['all', 'error', 'warn', 'info'] as const) {
      const btn = h('button', {
        className: `pm-filter-tab ${level === this.filterLevel ? 'active' : ''}`,
        onClick: () => { this.filterLevel = level; this.render(); },
      }, `${level} (${counts[level]})`);
      tabs.appendChild(btn);
    }
    return tabs;
  }

  private buildLogTable(entries: PipelineLogEntry[]): HTMLElement {
    if (entries.length === 0) {
      return h('div', { className: 'pm-log-empty' }, 'No log entries match this filter.');
    }

    const table = h('div', { className: 'pm-log-table' });
    for (const entry of entries) {
      const row = h('div', { className: `pm-log-row pm-level-${entry.level}` },
        h('span', { className: 'pm-log-time' }, this.formatTimestamp(entry.timestamp)),
        h('span', { className: `pm-log-level` }, entry.level.toUpperCase()),
        h('span', { className: 'pm-log-stage' }, entry.stage),
        h('span', { className: 'pm-log-msg' }, safeHtml(entry.message)),
      );
      if (entry.durationMs !== undefined) {
        row.appendChild(h('span', { className: 'pm-log-duration' }, `${entry.durationMs}ms`));
      }
      table.appendChild(row);
    }
    return table;
  }

  private formatTimestamp(iso: string): string {
    try {
      const d = new Date(iso);
      return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    } catch {
      return iso;
    }
  }
}
