/**
 * RegimeTimelinePanel.ts — 레짐 전환 타임라인 (swimlane)
 *
 * VIX 기반 시장 레짐(crisis/risk-off/balanced/risk-on) 전환을
 * 시간축 위에 색상 바로 표시.
 */

import { Panel } from './Panel';
import { renderSwimlane } from '@/utils/d3-swimlane';
import type { SwimlaneConfig } from '@/utils/d3-swimlane';

export class RegimeTimelinePanel extends Panel {
  private containerId: string;

  constructor() {
    super({ id: 'regime-timeline', title: 'Market Regime Timeline' });
    this.containerId = `regime-timeline-chart-${Date.now()}`;
    this.content.innerHTML = `<div id="${this.containerId}" style="width:100%;height:100%;min-height:180px"></div>`;
  }

  public setData(segments: Array<{ regime: string; start: string; end: string }>): void {
    const REGIME_COLORS: Record<string, string> = {
      'crisis': '#ff6b6b',
      'risk-off': '#ffb347',
      'balanced': '#7cb8ff',
      'risk-on': '#7cc87c',
      'risk-on-strong': '#4ae04a',
    };

    const lanes = ['crisis', 'risk-off', 'balanced', 'risk-on'];
    const items = segments.map((s, i) => ({
      id: String(i),
      lane: s.regime,
      start: new Date(s.start),
      end: new Date(s.end),
      label: '',
      color: REGIME_COLORS[s.regime] || '#7cb8ff',
    }));

    const container = document.getElementById(this.containerId);
    if (!container) return;
    const rect = container.getBoundingClientRect();

    renderSwimlane({
      containerId: this.containerId,
      lanes,
      items,
      width: Math.max(rect.width, 500),
      height: Math.max(rect.height, 180),
    } as unknown as SwimlaneConfig);

    this.setCount(segments.length);
  }
}
