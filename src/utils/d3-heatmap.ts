import * as d3 from 'd3';

export interface HeatmapDatum {
  row: string;
  col: string;
  value: number;
}

export interface HeatmapConfig {
  containerId: string;
  data: HeatmapDatum[];
  colorScale: 'diverging' | 'sequential';
  width: number;
  height: number;
  cellPadding?: number;
  margin?: { top: number; right: number; bottom: number; left: number };
  onHover?: (datum: HeatmapDatum) => string;
  onClick?: (datum: HeatmapDatum) => void;
}

export function renderHeatmap(config: HeatmapConfig): void {
  const container = document.getElementById(config.containerId);
  if (!container) return;
  if (!config.data.length) {
    container.innerHTML = '<p class="intel-heatmap-empty">No data available</p>';
    return;
  }

  const margin = config.margin ?? { top: 20, right: 20, bottom: 30, left: 60 };
  const padding = config.cellPadding ?? 2;
  const innerW = config.width - margin.left - margin.right;
  const innerH = config.height - margin.top - margin.bottom;

  d3.select(container).selectAll('*').remove();

  const rows = Array.from(new Set(config.data.map((d) => d.row)));
  const cols = Array.from(new Set(config.data.map((d) => d.col)));

  const xScale = d3.scaleBand().domain(cols).range([0, innerW]).padding(padding / 100);
  const yScale = d3.scaleBand().domain(rows).range([0, innerH]).padding(padding / 100);

  const extent = d3.extent(config.data, (d) => d.value) as [number, number];
  const colorFn =
    config.colorScale === 'diverging'
      ? d3.scaleSequential(d3.interpolateRdYlGn).domain([extent[0], extent[1]])
      : d3.scaleSequential(d3.interpolateYlOrRd).domain([extent[0], extent[1]]);

  const svg = d3
    .select(container)
    .append('svg')
    .attr('width', config.width)
    .attr('height', config.height)
    .attr('class', 'intel-heatmap');

  const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);

  // Axes
  g.append('g')
    .attr('class', 'intel-heatmap-x-axis')
    .attr('transform', `translate(0,${innerH})`)
    .call(d3.axisBottom(xScale).tickSize(0))
    .select('.domain')
    .remove();

  g.append('g')
    .attr('class', 'intel-heatmap-y-axis')
    .call(d3.axisLeft(yScale).tickSize(0))
    .select('.domain')
    .remove();

  // Tooltip
  const tooltip = d3
    .select(container)
    .append('div')
    .attr('class', 'intel-heatmap-tooltip')
    .style('position', 'absolute')
    .style('visibility', 'hidden')
    .style('background', '#1a1a2e')
    .style('color', '#eee')
    .style('padding', '6px 10px')
    .style('border-radius', '4px')
    .style('font-size', '12px')
    .style('pointer-events', 'none');

  // Cells
  g.selectAll('.intel-heatmap-cell')
    .data(config.data)
    .join('rect')
    .attr('class', 'intel-heatmap-cell')
    .attr('x', (d) => xScale(d.col) ?? 0)
    .attr('y', (d) => yScale(d.row) ?? 0)
    .attr('width', xScale.bandwidth())
    .attr('height', yScale.bandwidth())
    .attr('rx', 2)
    .style('fill', 'transparent')
    .on('mouseover', function (_event: MouseEvent, d: HeatmapDatum) {
      d3.select(this).style('stroke', '#fff').style('stroke-width', '2px');
      const text = config.onHover ? config.onHover(d) : `${d.row} / ${d.col}: ${d.value}`;
      tooltip.style('visibility', 'visible').text(text);
    })
    .on('mousemove', function (event: MouseEvent) {
      tooltip
        .style('top', `${event.offsetY - 30}px`)
        .style('left', `${event.offsetX + 10}px`);
    })
    .on('mouseout', function () {
      d3.select(this).style('stroke', 'none');
      tooltip.style('visibility', 'hidden');
    })
    .on('click', function (_event: MouseEvent, d: HeatmapDatum) {
      config.onClick?.(d);
    })
    .transition()
    .duration(400)
    .style('fill', (d) => colorFn(d.value));
}
