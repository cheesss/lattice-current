import * as d3 from 'd3';

export interface CorrelationEntry {
  symbolA: string;
  symbolB: string;
  value: number; // -1 to 1
}

export interface CorrelationMatrixConfig {
  containerId: string;
  symbols: string[];
  correlations: CorrelationEntry[];
  width: number;
  height: number;
  margin?: { top: number; right: number; bottom: number; left: number };
  insightThreshold?: number; // e.g. 0.8 to flag high correlations
}

function interpret(v: number): string {
  const abs = Math.abs(v);
  if (abs >= 0.9) return 'very strong';
  if (abs >= 0.7) return 'strong';
  if (abs >= 0.5) return 'moderate';
  if (abs >= 0.3) return 'weak';
  return 'negligible';
}

export function renderCorrelationMatrix(config: CorrelationMatrixConfig): void {
  const container = document.getElementById(config.containerId);
  if (!container) return;
  if (!config.symbols.length) {
    container.innerHTML = '<p class="intel-corr-empty">No data</p>';
    return;
  }

  const margin = config.margin ?? { top: 20, right: 20, bottom: 30, left: 60 };
  const n = config.symbols.length;
  const innerW = config.width - margin.left - margin.right;
  const innerH = config.height - margin.top - margin.bottom;
  const cellSize = Math.min(innerW / n, innerH / n);
  const threshold = config.insightThreshold ?? 0.8;

  d3.select(container).selectAll('*').remove();

  // Build lookup
  const lookup = new Map<string, number>();
  for (const c of config.correlations) {
    lookup.set(`${c.symbolA}|${c.symbolB}`, c.value);
    lookup.set(`${c.symbolB}|${c.symbolA}`, c.value);
  }

  const color = d3.scaleSequential(d3.interpolateRdBu).domain([-1, 1]);

  const svg = d3
    .select(container)
    .append('svg')
    .attr('width', config.width)
    .attr('height', margin.top + n * cellSize + margin.bottom)
    .attr('class', 'intel-correlation-matrix');

  const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);

  // Tooltip
  const tooltip = d3
    .select(container)
    .append('div')
    .attr('class', 'intel-corr-tooltip')
    .style('position', 'absolute')
    .style('visibility', 'hidden')
    .style('background', '#1a1a2e')
    .style('color', '#eee')
    .style('padding', '6px 10px')
    .style('border-radius', '4px')
    .style('font-size', '12px')
    .style('pointer-events', 'none');

  // Draw upper triangle cells
  for (let i = 0; i < n; i++) {
    for (let j = i; j < n; j++) {
      const val = i === j ? 1 : (lookup.get(`${config.symbols[i]}|${config.symbols[j]}`) ?? 0);

      g.append('rect')
        .attr('class', 'intel-corr-cell')
        .attr('x', j * cellSize)
        .attr('y', i * cellSize)
        .attr('width', cellSize - 1)
        .attr('height', cellSize - 1)
        .attr('rx', 2)
        .attr('fill', color(val))
        .on('mouseover', (_event: MouseEvent) => {
          const label = `${config.symbols[i]}-${config.symbols[j]}: ${val.toFixed(2)} (${interpret(val)})`;
          tooltip.style('visibility', 'visible').text(label);
        })
        .on('mousemove', (event: MouseEvent) => {
          tooltip
            .style('top', `${event.offsetY - 30}px`)
            .style('left', `${event.offsetX + 10}px`);
        })
        .on('mouseout', () => tooltip.style('visibility', 'hidden'));

      // Value text in cell
      if (cellSize > 28) {
        g.append('text')
          .attr('x', j * cellSize + cellSize / 2)
          .attr('y', i * cellSize + cellSize / 2)
          .attr('text-anchor', 'middle')
          .attr('dominant-baseline', 'middle')
          .attr('fill', Math.abs(val) > 0.5 ? '#fff' : '#333')
          .attr('font-size', '10px')
          .text(i === j ? '' : val.toFixed(2));
      }
    }
  }

  // Axis labels - bottom
  config.symbols.forEach((sym, i) => {
    g.append('text')
      .attr('x', i * cellSize + cellSize / 2)
      .attr('y', n * cellSize + 14)
      .attr('text-anchor', 'middle')
      .attr('fill', '#aaa')
      .attr('font-size', '10px')
      .text(sym);
  });

  // Axis labels - left
  config.symbols.forEach((sym, i) => {
    g.append('text')
      .attr('x', -6)
      .attr('y', i * cellSize + cellSize / 2)
      .attr('text-anchor', 'end')
      .attr('dominant-baseline', 'middle')
      .attr('fill', '#aaa')
      .attr('font-size', '10px')
      .text(sym);
  });

  // Insights
  const insights: string[] = [];
  for (const c of config.correlations) {
    if (Math.abs(c.value) >= threshold && c.symbolA !== c.symbolB) {
      const dir = c.value > 0 ? 'positive' : 'negative';
      const note =
        Math.abs(c.value) >= 0.9
          ? 'low diversification'
          : `${interpret(c.value)} ${dir} correlation`;
      insights.push(`${c.symbolA}-${c.symbolB} correlation ${c.value.toFixed(2)} → ${note}`);
    }
  }

  if (insights.length) {
    const insightsDiv = d3
      .select(container)
      .append('div')
      .attr('class', 'intel-corr-insights')
      .style('margin-top', '8px')
      .style('font-size', '11px')
      .style('color', '#aaa');

    insights.forEach((text) => {
      insightsDiv.append('p').style('margin', '2px 0').text(text);
    });
  }
}
