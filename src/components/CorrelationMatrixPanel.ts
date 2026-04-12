/**
 * CorrelationMatrixPanel.ts — 시그널 간 상관행렬 시각화
 *
 * VIX, 금리차, 유가, 달러, 크레딧 스프레드 등 시그널 간
 * 90일 롤링 상관계수를 색상 매트릭스로 표시.
 */

import { Panel } from './Panel';
import { renderHeatmap } from '@/utils/d3-heatmap';
import type { HeatmapDatum } from '@/utils/d3-heatmap';

export class CorrelationMatrixPanel extends Panel {
  private containerId: string;

  constructor() {
    super({ id: 'correlation-matrix', title: 'Signal Correlation Matrix' });
    this.containerId = `corr-matrix-chart-${Date.now()}`;
    this.content.innerHTML = `<div id="${this.containerId}" style="width:100%;height:100%;min-height:280px"></div>`;
  }

  public setData(matrix: Array<{ signal_a: string; signal_b: string; correlation: number }>): void {
    const data: HeatmapDatum[] = matrix.map(r => ({
      row: r.signal_a,
      col: r.signal_b,
      value: r.correlation,
    }));

    const container = document.getElementById(this.containerId);
    if (!container) return;
    const rect = container.getBoundingClientRect();

    renderHeatmap({
      containerId: this.containerId,
      data,
      colorScale: 'diverging',
      width: Math.max(rect.width, 350),
      height: Math.max(rect.height, 280),
      onHover: (d) => `${d.row} x ${d.col}: ${d.value.toFixed(3)}`,
    });

    this.setCount(data.length);
  }
}
