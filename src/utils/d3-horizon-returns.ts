import * as d3 from 'd3';

export interface HorizonRow {
  period: string; // e.g. '4h','12h','24h','48h','72h','1w','2w','1m'
  avgReturn: number;
  best: number;
  worst: number;
  maxDrawdown: number;
  winRate: number; // 0-1
  sampleCount: number;
  isOptimal?: boolean;
}

export interface HorizonReturnsConfig {
  containerId: string;
  data: HorizonRow[];
  width: number;
  height: number;
  margin?: { top: number; right: number; bottom: number; left: number };
  onHover?: (row: HorizonRow, metric: string) => string;
}

const COLUMNS = [
  { key: 'avgReturn', label: 'Avg Return', fmt: (v: number) => `${v >= 0 ? '+' : ''}${v.toFixed(2)}%` },
  { key: 'best', label: 'Best', fmt: (v: number) => `${v >= 0 ? '+' : ''}${v.toFixed(2)}%` },
  { key: 'worst', label: 'Worst', fmt: (v: number) => `${v.toFixed(2)}%` },
  { key: 'maxDrawdown', label: 'Max DD', fmt: (v: number) => `${v.toFixed(2)}%` },
  { key: 'winRate', label: 'Win Rate', fmt: (v: number) => `${(v * 100).toFixed(0)}%` },
  { key: 'sampleCount', label: 'Samples', fmt: (v: number) => `${v}` },
] as const;

type ColKey = (typeof COLUMNS)[number]['key'];

export function renderHorizonReturns(config: HorizonReturnsConfig): void {
  const container = document.getElementById(config.containerId);
  if (!container) return;
  if (!config.data.length) {
    container.innerHTML = '<p class="intel-horizon-empty">No data</p>';
    return;
  }

  const margin = config.margin ?? { top: 20, right: 20, bottom: 30, left: 60 };
  const w = config.width - margin.left - margin.right;
  const h = config.height - margin.top - margin.bottom;
  const rowCount = config.data.length;
  const colCount = COLUMNS.length;
  const cellW = w / colCount;
  const headerH = 28;
  const cellH = Math.min((h - headerH) / rowCount, 36);

  d3.select(container).selectAll('*').remove();

  // Build value ranges per column for coloring
  const ranges: Record<string, [number, number]> = {};
  for (const col of COLUMNS) {
    const vals = config.data.map((r) => r[col.key] as number);
    ranges[col.key] = [d3.min(vals) ?? 0, d3.max(vals) ?? 1];
  }

  function cellColor(key: ColKey, val: number): string {
    const range = ranges[key] ?? [0, 1];
    const [lo, hi] = range;
    if (lo === hi) return '#333';
    const t = (val - lo) / (hi - lo);
    if (key === 'worst' || key === 'maxDrawdown') {
      return d3.interpolateRdYlGn(1 - t); // lower is worse
    }
    return d3.interpolateRdYlGn(t);
  }

  const svg = d3
    .select(container)
    .append('svg')
    .attr('width', config.width)
    .attr('height', config.height)
    .attr('class', 'intel-horizon-returns');

  const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);

  // Tooltip
  const tooltip = d3
    .select(container)
    .append('div')
    .attr('class', 'intel-horizon-tooltip')
    .style('position', 'absolute')
    .style('visibility', 'hidden')
    .style('background', '#1a1a2e')
    .style('color', '#eee')
    .style('padding', '6px 10px')
    .style('border-radius', '4px')
    .style('font-size', '12px')
    .style('pointer-events', 'none');

  // Column headers
  COLUMNS.forEach((col, ci) => {
    g.append('text')
      .attr('x', ci * cellW + cellW / 2)
      .attr('y', headerH / 2)
      .attr('text-anchor', 'middle')
      .attr('dominant-baseline', 'middle')
      .attr('fill', '#aaa')
      .attr('font-size', '11px')
      .attr('font-weight', '600')
      .text(col.label);
  });

  // Row labels
  config.data.forEach((row, ri) => {
    const yPos = headerH + ri * cellH;
    svg
      .append('text')
      .attr('x', margin.left - 6)
      .attr('y', margin.top + yPos + cellH / 2)
      .attr('text-anchor', 'end')
      .attr('dominant-baseline', 'middle')
      .attr('fill', row.isOptimal ? '#ffd54f' : '#ccc')
      .attr('font-size', '11px')
      .attr('font-weight', row.isOptimal ? '700' : '400')
      .text(row.period);
  });

  // Cells
  config.data.forEach((row, ri) => {
    const yPos = headerH + ri * cellH;

    COLUMNS.forEach((col, ci) => {
      const val = row[col.key] as number;
      const cellG = g.append('g').attr('class', 'intel-horizon-cell');

      const rect = cellG
        .append('rect')
        .attr('x', ci * cellW + 1)
        .attr('y', yPos + 1)
        .attr('width', cellW - 2)
        .attr('height', cellH - 2)
        .attr('rx', 3)
        .attr('fill', cellColor(col.key, val));

      // Optimal row highlight
      if (row.isOptimal) {
        rect.attr('stroke', '#ffd54f').attr('stroke-width', 2);
      }

      cellG
        .append('text')
        .attr('x', ci * cellW + cellW / 2)
        .attr('y', yPos + cellH / 2)
        .attr('text-anchor', 'middle')
        .attr('dominant-baseline', 'middle')
        .attr('fill', '#fff')
        .attr('font-size', '11px')
        .text(col.fmt(val));

      cellG
        .on('mouseover', (_event: MouseEvent) => {
          const text = config.onHover
            ? config.onHover(row, col.key)
            : `${row.period} ${col.label}: ${col.fmt(val)}`;
          tooltip.style('visibility', 'visible').text(text);
        })
        .on('mousemove', (event: MouseEvent) => {
          tooltip
            .style('top', `${event.offsetY - 30}px`)
            .style('left', `${event.offsetX + 10}px`);
        })
        .on('mouseout', () => tooltip.style('visibility', 'hidden'));
    });
  });
}
