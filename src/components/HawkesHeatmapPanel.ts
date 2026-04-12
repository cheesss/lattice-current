/**
 * HawkesHeatmapPanel.ts — Hawkes 이슈 온도 히트맵
 *
 * 테마(행) x 날짜(열) 히트맵으로 이벤트 연쇄 강도를 시각화.
 * 색상: 파란(저) → 빨간(고)
 */

import { Panel } from './Panel';
import { renderHeatmap } from '@/utils/d3-heatmap';
import type { HeatmapDatum } from '@/utils/d3-heatmap';

export class HawkesHeatmapPanel extends Panel {
  private containerId: string;

  constructor() {
    super({ id: 'hawkes-heatmap', title: 'Event Intensity Heatmap' });
    this.containerId = `hawkes-heatmap-chart-${Date.now()}`;
    this.content.innerHTML = `<div id="${this.containerId}" style="width:100%;height:100%;min-height:250px"></div>`;
  }

  public setData(rows: Array<{ theme: string; event_date: string; hawkes_intensity: number }>): void {
    const data: HeatmapDatum[] = rows.map(r => ({
      row: r.theme,
      col: r.event_date.slice(0, 7), // monthly buckets
      value: r.hawkes_intensity,
    }));

    // Aggregate by month
    const aggregated = new Map<string, { sum: number; count: number }>();
    for (const d of data) {
      const key = `${d.row}::${d.col}`;
      const existing = aggregated.get(key);
      if (existing) { existing.sum += d.value; existing.count++; }
      else aggregated.set(key, { sum: d.value, count: 1 });
    }

    const chartData: HeatmapDatum[] = Array.from(aggregated.entries()).map(([key, val]) => {
      const [row, col] = key.split('::');
      return { row: row ?? '', col: col ?? '', value: val.sum / val.count };
    });

    const container = document.getElementById(this.containerId);
    if (!container) return;
    const rect = container.getBoundingClientRect();

    renderHeatmap({
      containerId: this.containerId,
      data: chartData,
      colorScale: 'sequential',
      width: Math.max(rect.width, 400),
      height: Math.max(rect.height, 250),
      onHover: (d) => `${d.row} (${d.col}): ${d.value.toFixed(2)}`,
    });

    this.setCount(chartData.length);
  }
}
