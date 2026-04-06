import * as d3 from 'd3';

export interface ScenarioAsset {
  symbol: string;
  currentReturn: number;
  scenarioReturn: number;
}

export interface ScenarioChartConfig {
  containerId: string;
  data: ScenarioAsset[];
  width: number;
  height: number;
  margin?: { top: number; right: number; bottom: number; left: number };
  accentColor?: string;
  scenarioColor?: string;
}

export function renderScenarioChart(config: ScenarioChartConfig): void {
  const container = document.getElementById(config.containerId);
  if (!container) return;
  if (!config.data.length) {
    container.innerHTML = '<p class="intel-scenario-empty">No data</p>';
    return;
  }

  const margin = config.margin ?? { top: 20, right: 20, bottom: 30, left: 60 };
  const accent = config.accentColor ?? '#4fc3f7';
  const scenarioFill = config.scenarioColor ?? 'rgba(76,175,80,0.7)';

  // Responsive width
  const containerW = container.clientWidth || config.width;
  const w = containerW - margin.left - margin.right;
  const h = config.height - margin.top - margin.bottom;

  d3.select(container).selectAll('*').remove();

  const symbols = config.data.map((d) => d.symbol);

  const x0 = d3.scaleBand().domain(symbols).range([0, w]).paddingInner(0.3).paddingOuter(0.15);
  const x1 = d3
    .scaleBand()
    .domain(['current', 'scenario'])
    .range([0, x0.bandwidth()])
    .padding(0.08);

  const allVals = config.data.flatMap((d) => [d.currentReturn, d.scenarioReturn]);
  const yMin = Math.min(0, d3.min(allVals) ?? 0);
  const yMax = Math.max(0, d3.max(allVals) ?? 0);
  const yPad = (yMax - yMin) * 0.15 || 1;
  const y = d3
    .scaleLinear()
    .domain([yMin - yPad, yMax + yPad])
    .range([h, 0]);

  const svg = d3
    .select(container)
    .append('svg')
    .attr('width', containerW)
    .attr('height', config.height)
    .attr('class', 'intel-scenario-chart');

  const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);

  // Zero line
  g.append('line')
    .attr('class', 'intel-scenario-zero')
    .attr('x1', 0)
    .attr('x2', w)
    .attr('y1', y(0))
    .attr('y2', y(0))
    .attr('stroke', '#555')
    .attr('stroke-width', 1);

  // Bars
  config.data.forEach((d) => {
    const xPos = x0(d.symbol) ?? 0;

    // Current bar
    const curX = xPos + (x1('current') ?? 0);
    const curH = Math.abs(y(0) - y(d.currentReturn));
    const curY = d.currentReturn >= 0 ? y(d.currentReturn) : y(0);

    g.append('rect')
      .attr('class', 'intel-scenario-bar-current')
      .attr('x', curX)
      .attr('y', curY)
      .attr('width', x1.bandwidth())
      .attr('height', curH)
      .attr('rx', 2)
      .attr('fill', accent);

    // Scenario bar
    const scX = xPos + (x1('scenario') ?? 0);
    const scH = Math.abs(y(0) - y(d.scenarioReturn));
    const scY = d.scenarioReturn >= 0 ? y(d.scenarioReturn) : y(0);

    g.append('rect')
      .attr('class', 'intel-scenario-bar-scenario')
      .attr('x', scX)
      .attr('y', scY)
      .attr('width', x1.bandwidth())
      .attr('height', scH)
      .attr('rx', 2)
      .attr('fill', scenarioFill);

    // Labels
    const fmt = (v: number) => `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`;

    g.append('text')
      .attr('x', curX + x1.bandwidth() / 2)
      .attr('y', curY - 4)
      .attr('text-anchor', 'middle')
      .attr('fill', accent)
      .attr('font-size', '10px')
      .text(fmt(d.currentReturn));

    g.append('text')
      .attr('x', scX + x1.bandwidth() / 2)
      .attr('y', scY - 4)
      .attr('text-anchor', 'middle')
      .attr('fill', '#4caf50')
      .attr('font-size', '10px')
      .text(fmt(d.scenarioReturn));
  });

  // Axes
  g.append('g')
    .attr('class', 'intel-scenario-x-axis')
    .attr('transform', `translate(0,${h})`)
    .call(d3.axisBottom(x0).tickSize(0))
    .select('.domain')
    .remove();

  g.append('g')
    .attr('class', 'intel-scenario-y-axis')
    .call(d3.axisLeft(y).ticks(5).tickFormat((d) => `${d}%`));

  // Legend
  const legend = g.append('g').attr('transform', `translate(${w - 140},-10)`);

  legend.append('rect').attr('width', 10).attr('height', 10).attr('rx', 2).attr('fill', accent);
  legend.append('text').attr('x', 14).attr('y', 9).attr('fill', '#ccc').attr('font-size', '10px').text('Current');

  legend.append('rect').attr('x', 70).attr('width', 10).attr('height', 10).attr('rx', 2).attr('fill', scenarioFill);
  legend.append('text').attr('x', 84).attr('y', 9).attr('fill', '#ccc').attr('font-size', '10px').text('Scenario');
}
