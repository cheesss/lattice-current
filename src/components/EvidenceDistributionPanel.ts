/**
 * EvidenceDistributionPanel.ts — Evidence Grade 분포 차트
 *
 * E0(노이즈) / E1(alpha+) / E2(통계 유의) 비율을 바 차트로 표시.
 */

import { Panel } from './Panel';

interface EvidenceData {
  grade: string;
  count: number;
  avgUplift: number;
}

const GRADE_COLORS: Record<string, string> = {
  E0: '#3d3d3d',
  E1: '#2d5a2d',
  E2: '#2d3a5d',
  E3: '#5d5a2d',
  E4: '#5d2d2d',
};

const GRADE_TEXT: Record<string, string> = {
  E0: '#999',
  E1: '#7cc87c',
  E2: '#7cb8ff',
  E3: '#ffd75e',
  E4: '#ff9e7c',
};

export class EvidenceDistributionPanel extends Panel {
  constructor() {
    super({ id: 'evidence-distribution', title: 'Evidence Grade Distribution' });
  }

  public setData(grades: EvidenceData[]): void {
    const total = grades.reduce((sum, g) => sum + g.count, 0) || 1;

    const bars = grades.map(g => {
      const pct = (g.count / total * 100).toFixed(1);
      const barWidth = Math.max(2, g.count / total * 100);
      const bg = GRADE_COLORS[g.grade] || '#333';
      const color = GRADE_TEXT[g.grade] || '#aaa';
      return `
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
          <span style="width:24px;font-weight:700;color:${color};font-size:12px">${g.grade}</span>
          <div style="flex:1;height:20px;background:var(--border);border-radius:3px;overflow:hidden">
            <div style="width:${barWidth}%;height:100%;background:${bg};border-radius:3px;transition:width 0.5s"></div>
          </div>
          <span style="width:70px;text-align:right;font-family:var(--font-mono);font-size:11px;color:${color}">
            ${g.count.toLocaleString()} <small>(${pct}%)</small>
          </span>
          <span style="width:60px;text-align:right;font-family:var(--font-mono);font-size:11px;color:${g.avgUplift >= 0 ? 'var(--green)' : 'var(--red)'}">
            ${g.avgUplift >= 0 ? '+' : ''}${g.avgUplift.toFixed(2)}%
          </span>
        </div>
      `;
    }).join('');

    this.setContent(`
      <div style="padding:8px">
        <div style="display:flex;justify-content:space-between;margin-bottom:8px;font-size:10px;color:var(--text-dim);text-transform:uppercase;letter-spacing:0.08em">
          <span>Grade</span><span>Distribution</span><span>Count</span><span>Avg Uplift</span>
        </div>
        ${bars}
      </div>
    `);
    this.setCount(total);
  }
}
