/**
 * AlphaDecayPanel.ts — Alpha 감쇠 곡선
 *
 * horizon별 평균 abnormal return을 곡선으로 표시.
 * 1w → 2w → 1m 으로 alpha가 어떻게 감쇠하는지 보여줌.
 */

import { Panel } from './Panel';
import { renderDecayCurve } from '@/utils/d3-decay-curve';
import type { DecayCurveConfig } from '@/utils/d3-decay-curve';

export class AlphaDecayPanel extends Panel {
  private containerId: string;

  constructor() {
    super({ id: 'alpha-decay', title: 'Alpha Decay Curve' });
    this.containerId = `alpha-decay-chart-${Date.now()}`;
    this.content.innerHTML = `<div id="${this.containerId}" style="width:100%;height:100%;min-height:200px"></div>`;
  }

  public setData(curves: Array<{ theme: string; points: Array<{ horizon: string; alpha: number }> }>): void {
    const HORIZON_DAYS: Record<string, number> = { '1d': 1, '3d': 3, '1w': 7, '2w': 14, '1m': 30 };
    const series = curves.map(c => ({
      label: c.theme,
      points: c.points.map(p => ({
        x: HORIZON_DAYS[p.horizon] ?? 14,
        y: p.alpha,
      })),
    }));

    const container = document.getElementById(this.containerId);
    if (!container) return;
    const rect = container.getBoundingClientRect();

    renderDecayCurve({
      containerId: this.containerId,
      series,
      width: Math.max(rect.width, 400),
      height: Math.max(rect.height, 200),
      xLabel: 'Days',
      yLabel: 'Alpha %',
    } as unknown as DecayCurveConfig);

    this.setCount(curves.length);
  }
}
