/**
 * SourceCredibilityPanel.ts — 소스 신뢰도 추이
 *
 * 뉴스 소스별 신뢰도 점수를 시간 흐름에 따라 라인 차트로 표시.
 */

import { Panel } from './Panel';
import { miniSparkline } from '@/utils/sparkline';

interface SourceScore {
  source: string;
  credibility: number;
  articleCount: number;
  recentTrend: number[]; // last 12 data points
}

export class SourceCredibilityPanel extends Panel {
  constructor() {
    super({ id: 'source-credibility', title: 'Source Credibility' });
  }

  public setData(sources: SourceScore[]): void {
    const sorted = sources.sort((a, b) => b.credibility - a.credibility);
    const rows = sorted.slice(0, 15).map(s => {
      const change = s.recentTrend.length >= 2
        ? s.recentTrend[s.recentTrend.length - 1]! - s.recentTrend[0]!
        : 0;
      const spark = miniSparkline(s.recentTrend, change, 80, 16);
      const barWidth = Math.min(100, s.credibility);
      const barColor = s.credibility >= 70 ? 'var(--green)' : s.credibility >= 50 ? '#ffb347' : 'var(--red)';

      return `
        <div style="display:flex;align-items:center;gap:6px;margin-bottom:4px;font-size:11px">
          <span style="width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--text)">${s.source}</span>
          <div style="width:60px;height:4px;background:var(--border);border-radius:2px;overflow:hidden">
            <div style="width:${barWidth}%;height:100%;background:${barColor};border-radius:2px"></div>
          </div>
          <span style="width:30px;text-align:right;font-family:var(--font-mono);color:${barColor}">${s.credibility.toFixed(0)}</span>
          ${spark}
          <span style="width:40px;text-align:right;font-family:var(--font-mono);font-size:10px;color:var(--text-dim)">${s.articleCount}</span>
        </div>
      `;
    }).join('');

    this.setContent(`
      <div style="padding:6px">
        <div style="display:flex;gap:6px;margin-bottom:6px;font-size:9px;color:var(--text-dim);text-transform:uppercase;letter-spacing:0.08em">
          <span style="width:120px">Source</span>
          <span style="width:60px">Score</span>
          <span style="width:30px"></span>
          <span style="width:80px;text-align:center">Trend</span>
          <span style="width:40px;text-align:right">Articles</span>
        </div>
        ${rows}
      </div>
    `);
    this.setCount(sorted.length);
  }
}
