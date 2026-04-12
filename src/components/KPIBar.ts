/**
 * KPIBar.ts — 상단 KPI 요약 바
 *
 * 표시 항목:
 *   VIX (값 + 스파크라인) | 리스크 게이지 | 레짐 배지 |
 *   금리차 | 유가 | 달러 | E2 시그널 수
 */

import { miniSparkline } from '@/utils/sparkline';

export interface KPIData {
  vix: number | null;
  vixHistory: number[];
  vixChange: number | null;
  riskGauge: number | null;
  riskState: string | null;
  yieldSpread: number | null;
  oilPrice: number | null;
  dollarIndex: number | null;
  e2Count: number | null;
  totalSignals: number | null;
}

function gaugeColor(value: number): string {
  if (value >= 82) return '#ff6b6b';
  if (value >= 66) return '#ffb347';
  if (value >= 28) return '#7cb8ff';
  return '#7cc87c';
}

function regimeClass(state: string | null): string {
  if (!state) return 'balanced';
  return state.replace(/[^a-z-]/g, '');
}

export class KPIBar {
  private el: HTMLElement;
  private data: KPIData = {
    vix: null, vixHistory: [], vixChange: null,
    riskGauge: null, riskState: null,
    yieldSpread: null, oilPrice: null, dollarIndex: null,
    e2Count: null, totalSignals: null,
  };

  constructor() {
    this.el = document.createElement('div');
    this.el.className = 'kpi-bar';
    this.el.setAttribute('role', 'banner');
    this.el.setAttribute('aria-label', 'Market KPI Summary');
  }

  getElement(): HTMLElement {
    return this.el;
  }

  update(data: Partial<KPIData>): void {
    Object.assign(this.data, data);
    this.render();
  }

  private render(): void {
    const d = this.data;
    const vixClass = (d.vixChange ?? 0) >= 0 ? 'negative' : 'positive'; // VIX up = bad
    const spark = miniSparkline(d.vixHistory, d.vixChange, 60, 18);
    const gaugeWidth = Math.min(100, Math.max(0, d.riskGauge ?? 50));
    const gColor = gaugeColor(d.riskGauge ?? 50);
    const regime = d.riskState || 'balanced';

    this.el.innerHTML = `
      <div class="kpi-item">
        <span class="kpi-label">VIX</span>
        <span class="kpi-value ${vixClass}">${d.vix?.toFixed(1) ?? '--'}</span>
        ${spark}
      </div>
      <div class="kpi-divider"></div>
      <div class="kpi-item">
        <span class="kpi-label">Risk</span>
        <span class="kpi-value">${d.riskGauge?.toFixed(0) ?? '--'}</span>
        <div class="kpi-gauge"><div class="kpi-gauge-fill" style="width:${gaugeWidth}%;background:${gColor}"></div></div>
      </div>
      <div class="kpi-divider"></div>
      <div class="kpi-item">
        <span class="kpi-label">Regime</span>
        <span class="kpi-badge ${regimeClass(regime)}">${regime.toUpperCase()}</span>
      </div>
      <div class="kpi-divider"></div>
      <div class="kpi-item">
        <span class="kpi-label">Spread</span>
        <span class="kpi-value">${d.yieldSpread?.toFixed(2) ?? '--'}</span>
      </div>
      <div class="kpi-divider"></div>
      <div class="kpi-item">
        <span class="kpi-label">Oil</span>
        <span class="kpi-value">${d.oilPrice?.toFixed(1) ?? '--'}</span>
      </div>
      <div class="kpi-divider"></div>
      <div class="kpi-item">
        <span class="kpi-label">Dollar</span>
        <span class="kpi-value">${d.dollarIndex?.toFixed(1) ?? '--'}</span>
      </div>
      <div class="kpi-divider"></div>
      <div class="kpi-item">
        <span class="kpi-label">Signals</span>
        <span class="kpi-value positive">${d.e2Count ?? 0} <small style="font-size:10px;color:var(--text-dim)">E2</small></span>
      </div>
    `;
  }

  destroy(): void {
    this.el.remove();
  }
}
