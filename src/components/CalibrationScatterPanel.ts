/**
 * CalibrationScatterPanel.ts — Conviction vs Realized Alpha 스캐터
 *
 * 모델이 높은 확신도를 줬을 때 실제로 alpha가 높았는지 시각화.
 * 대각선 근처 = 잘 보정된 모델.
 */

import { Panel } from './Panel';

interface CalibrationPoint {
  conviction: number;
  realizedAlpha: number;
  symbol: string;
  theme: string;
}

export class CalibrationScatterPanel extends Panel {
  private containerId: string;

  constructor() {
    super({ id: 'calibration-scatter', title: 'Conviction vs Realized Alpha' });
    this.containerId = `calib-scatter-${Date.now()}`;
    this.content.innerHTML = `<canvas id="${this.containerId}" style="width:100%;height:100%;min-height:250px"></canvas>`;
  }

  public setData(points: CalibrationPoint[]): void {
    const canvas = document.getElementById(this.containerId) as HTMLCanvasElement | null;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * (window.devicePixelRatio || 1);
    canvas.height = rect.height * (window.devicePixelRatio || 1);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    ctx.scale(dpr, dpr);
    const w = rect.width;
    const h = rect.height;
    const margin = { top: 20, right: 20, bottom: 30, left: 40 };
    const plotW = w - margin.left - margin.right;
    const plotH = h - margin.top - margin.bottom;

    // Clear
    ctx.clearRect(0, 0, w, h);

    // Axes
    ctx.strokeStyle = '#22354b';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(margin.left, margin.top);
    ctx.lineTo(margin.left, h - margin.bottom);
    ctx.lineTo(w - margin.right, h - margin.bottom);
    ctx.stroke();

    // Labels
    ctx.fillStyle = '#999';
    ctx.font = '10px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Conviction', w / 2, h - 4);
    ctx.save();
    ctx.translate(10, h / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText('Realized Alpha %', 0, 0);
    ctx.restore();

    if (points.length === 0) return;

    // Scale
    const xMin = 20, xMax = 98;
    const yValues = points.map(p => p.realizedAlpha);
    const yMin = Math.min(...yValues, -5);
    const yMax = Math.max(...yValues, 5);

    const xScale = (v: number) => margin.left + ((v - xMin) / (xMax - xMin)) * plotW;
    const yScale = (v: number) => h - margin.bottom - ((v - yMin) / (yMax - yMin)) * plotH;

    // Zero line
    ctx.strokeStyle = '#333';
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(margin.left, yScale(0));
    ctx.lineTo(w - margin.right, yScale(0));
    ctx.stroke();
    ctx.setLineDash([]);

    // Points
    for (const p of points) {
      const x = xScale(p.conviction);
      const y = yScale(p.realizedAlpha);
      ctx.beginPath();
      ctx.arc(x, y, 3, 0, Math.PI * 2);
      ctx.fillStyle = p.realizedAlpha > 0 ? 'rgba(124,200,124,0.6)' : 'rgba(255,107,107,0.5)';
      ctx.fill();
    }

    // Tick labels
    ctx.fillStyle = '#666';
    ctx.font = '9px monospace';
    ctx.textAlign = 'center';
    for (let v = 20; v <= 98; v += 20) {
      ctx.fillText(String(v), xScale(v), h - margin.bottom + 14);
    }
    ctx.textAlign = 'right';
    const yStep = Math.max(1, Math.round((yMax - yMin) / 5));
    for (let v = Math.ceil(yMin); v <= yMax; v += yStep) {
      ctx.fillText(v.toFixed(0) + '%', margin.left - 4, yScale(v) + 3);
    }

    this.setCount(points.length);
  }
}
