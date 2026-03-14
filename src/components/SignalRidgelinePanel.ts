import { Panel } from './Panel';
import type { GraphTimeslice } from '@/services/graph-timeslice';
import type { KeywordGraphSnapshot } from '@/services/keyword-registry';
import type { ScheduledReport } from '@/services/scheduled-reports';
import { escapeHtml } from '@/utils/sanitize';

interface RidgelineSeries {
  label: string;
  color: string;
  values: number[];
}

const RIDGE_COLORS = ['#38bdf8', '#60a5fa', '#f59e0b', '#f97316', '#34d399', '#a78bfa', '#f43f5e'];

function truncate(value: string, max = 20): string {
  const clean = String(value || '').trim();
  if (clean.length <= max) return clean;
  return `${clean.slice(0, Math.max(0, max - 3))}...`;
}

function buildSeries(
  timeslices: GraphTimeslice[],
  graph: KeywordGraphSnapshot | null,
): RidgelineSeries[] {
  const ordered = timeslices.slice(0, 16).slice().reverse();
  if (ordered.length === 0) return [];

  const candidateCounts = new Map<string, number>();
  for (const slice of ordered) {
    for (const term of [...slice.topThemes, ...slice.topTerms.slice(0, 6)]) {
      const key = String(term || '').trim();
      if (!key) continue;
      candidateCounts.set(key, (candidateCounts.get(key) || 0) + 1);
    }
  }
  for (const node of graph?.nodes.slice(0, 10) || []) {
    const key = String(node.term || '').trim();
    if (!key) continue;
    candidateCounts.set(key, (candidateCounts.get(key) || 0) + 2);
  }

  return Array.from(candidateCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([label], idx) => {
      const values = ordered.map((slice) => {
        const lower = label.toLowerCase();
        let score = 0;
        if (slice.topThemes.some((theme) => theme.toLowerCase() === lower)) score += 3;
        if (slice.topTerms.some((term) => term.toLowerCase() === lower)) score += 2;
        const nodeHit = slice.nodes.find((node) => node.term.toLowerCase() === lower);
        if (nodeHit) score += Math.max(1, Math.round(nodeHit.score / 20));
        return score;
      });
      return {
        label,
        color: RIDGE_COLORS[idx % RIDGE_COLORS.length] || '#38bdf8',
        values,
      };
    });
}

function buildAreaPath(
  values: number[],
  baseline: number,
  offsetX: number,
  width: number,
  maxValue: number,
): string {
  if (values.length === 0) return '';
  const stepX = values.length > 1 ? width / (values.length - 1) : width;
  const topPoints = values.map((value, idx) => {
    const x = offsetX + idx * stepX;
    const y = baseline - ((value / Math.max(1, maxValue)) * 42);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const bottomPoints = values.map((_, idx) => {
    const x = offsetX + idx * stepX;
    return `${x.toFixed(1)},${baseline.toFixed(1)}`;
  }).reverse();
  return `M ${topPoints.join(' L ')} L ${bottomPoints.join(' L ')} Z`;
}

export class SignalRidgelinePanel extends Panel {
  private timeslices: GraphTimeslice[] = [];
  private graph: KeywordGraphSnapshot | null = null;
  private reports: ScheduledReport[] = [];

  constructor() {
    super({ id: 'signal-ridgeline', title: 'Signal Ridge', showCount: true });
  }

  public setData(
    timeslices: GraphTimeslice[],
    graph: KeywordGraphSnapshot | null,
    reports: ScheduledReport[] = [],
  ): void {
    this.timeslices = timeslices.slice(0, 16);
    this.graph = graph;
    this.reports = reports.slice(0, 4);
    this.renderPanel();
  }

  private renderPanel(): void {
    const ordered = this.timeslices.slice().reverse();
    const series = buildSeries(this.timeslices, this.graph);
    if (ordered.length === 0 || series.length === 0) {
      this.showError('No graph timeslices for ridgeline view');
      return;
    }

    const maxValue = Math.max(1, ...series.flatMap((item) => item.values));
    const width = 700;
    const stepY = 58;
    const baseTop = 70;
    const svgHeight = baseTop + stepY * series.length + 18;
    const labels = ordered.map((slice) => {
      const date = new Date(slice.capturedAt);
      return `${String(date.getMonth() + 1).padStart(2, '0')}/${String(date.getDate()).padStart(2, '0')} ${String(date.getHours()).padStart(2, '0')}:00`;
    });
    const labelStep = labels.length > 1 ? width / (labels.length - 1) : width;

    const ridges = series.map((item, idx) => {
      const baseline = baseTop + idx * stepY;
      const path = buildAreaPath(item.values, baseline, 140, width, maxValue);
      const peak = Math.max(...item.values);
      return `
        <g class="ridgeline-row">
          <text x="8" y="${(baseline - 8).toFixed(1)}" class="ridgeline-label">${escapeHtml(truncate(item.label, 18))}</text>
          <line x1="140" y1="${baseline.toFixed(1)}" x2="${(140 + width).toFixed(1)}" y2="${baseline.toFixed(1)}" class="ridgeline-baseline" />
          <path d="${path}" fill="${item.color}" fill-opacity="0.22" stroke="${item.color}" stroke-width="2" />
          <text x="856" y="${(baseline - 8).toFixed(1)}" text-anchor="end" class="ridgeline-peak">peak ${peak}</text>
        </g>
      `;
    }).join('');

    const xAxis = labels.map((label, idx) => `
      <g>
        <line x1="${(140 + idx * labelStep).toFixed(1)}" y1="${(svgHeight - 26).toFixed(1)}" x2="${(140 + idx * labelStep).toFixed(1)}" y2="${(svgHeight - 18).toFixed(1)}" class="ridgeline-tick" />
        <text x="${(140 + idx * labelStep).toFixed(1)}" y="${(svgHeight - 4).toFixed(1)}" text-anchor="middle" class="ridgeline-tick-label">${escapeHtml(truncate(label, 11))}</text>
      </g>
    `).join('');

    const reportThemes = Array.from(new Set(this.reports.flatMap((report) => report.themes || []))).slice(0, 6);

    this.setCount(series.length);
    this.setContent(`
      <div class="intel-viz-panel intel-viz-panel-ridgeline">
        <div class="intel-viz-stats">
          <span class="intel-viz-stat">Slices <b>${ordered.length}</b></span>
          <span class="intel-viz-stat">Series <b>${series.length}</b></span>
          <span class="intel-viz-stat">Nodes <b>${this.graph?.nodes.length || 0}</b></span>
          <span class="intel-viz-stat">Edges <b>${this.graph?.edges.length || 0}</b></span>
        </div>
        <div class="intel-viz-card">
          <svg viewBox="0 0 920 ${svgHeight}" class="intel-viz-svg ridgeline-svg" aria-label="Signal ridgeline">
            <text x="140" y="24" class="intel-viz-axis-label">RIDGELINE SIGNAL PRESSURE OVER TIME</text>
            ${ridges}
            ${xAxis}
          </svg>
        </div>
        <div class="intel-viz-chip-row">
          ${reportThemes.length > 0
            ? reportThemes.map((theme) => `<span class="intel-viz-chip">${escapeHtml(theme)}</span>`).join('')
            : '<span class="intel-viz-chip">No report themes yet</span>'}
        </div>
      </div>
    `);
  }
}
