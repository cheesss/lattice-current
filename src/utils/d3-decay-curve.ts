import * as d3 from 'd3';

export interface DecayPoint {
  hour: number;
  intensity: number;
  sigma?: number;
}

export interface DecayCurveConfig {
  containerId: string;
  data: DecayPoint[];
  comparison?: DecayPoint[];
  nowHour: number;
  width: number;
  height: number;
  margin?: { top: number; right: number; bottom: number; left: number };
  showUncertainty?: boolean;
  accentColor?: string;
  comparisonColor?: string;
}

export function renderDecayCurve(config: DecayCurveConfig): void {
  const container = document.getElementById(config.containerId);
  if (!container) return;
  if (!config.data.length) {
    container.innerHTML = '<p class="intel-decay-empty">No data available</p>';
    return;
  }

  const margin = config.margin ?? { top: 20, right: 20, bottom: 30, left: 60 };
  const w = config.width - margin.left - margin.right;
  const h = config.height - margin.top - margin.bottom;
  const accent = config.accentColor ?? '#4fc3f7';
  const compColor = config.comparisonColor ?? '#ff9800';

  d3.select(container).selectAll('*').remove();

  const xExtent = d3.extent(config.data, (d) => d.hour) as [number, number];
  const x = d3.scaleLinear().domain(xExtent).range([0, w]);
  const y = d3.scaleLinear().domain([0, 100]).range([h, 0]);

  const svg = d3
    .select(container)
    .append('svg')
    .attr('width', config.width)
    .attr('height', config.height)
    .attr('class', 'intel-decay-curve');

  const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);

  // Prediction zone
  if (config.nowHour > xExtent[0] && config.nowHour < xExtent[1]) {
    g.append('rect')
      .attr('class', 'intel-decay-prediction-zone')
      .attr('x', x(config.nowHour))
      .attr('y', 0)
      .attr('width', w - x(config.nowHour))
      .attr('height', h)
      .attr('fill', 'rgba(255,255,255,0.03)')
      .attr('stroke', '#888')
      .attr('stroke-dasharray', '4 4')
      .attr('opacity', 0.5);
  }

  // Uncertainty band
  if (config.showUncertainty !== false) {
    const bandData = config.data.filter((d) => d.sigma != null);
    if (bandData.length) {
      const area = d3
        .area<DecayPoint>()
        .x((d) => x(d.hour))
        .y0((d) => y(Math.max(0, d.intensity - (d.sigma ?? 0))))
        .y1((d) => y(Math.min(100, d.intensity + (d.sigma ?? 0))))
        .curve(d3.curveMonotoneX);

      g.append('path')
        .datum(bandData)
        .attr('class', 'intel-decay-band')
        .attr('d', area)
        .attr('fill', accent)
        .attr('opacity', 0.15);
    }
  }

  // Main curve
  const line = d3
    .line<DecayPoint>()
    .x((d) => x(d.hour))
    .y((d) => y(d.intensity))
    .curve(d3.curveMonotoneX);

  g.append('path')
    .datum(config.data)
    .attr('class', 'intel-decay-line')
    .attr('d', line)
    .attr('fill', 'none')
    .attr('stroke', accent)
    .attr('stroke-width', 2);

  // Comparison curve
  if (config.comparison?.length) {
    g.append('path')
      .datum(config.comparison)
      .attr('class', 'intel-decay-comparison')
      .attr('d', line)
      .attr('fill', 'none')
      .attr('stroke', compColor)
      .attr('stroke-width', 2)
      .attr('stroke-dasharray', '6 3');
  }

  // Now marker
  if (config.nowHour >= xExtent[0] && config.nowHour <= xExtent[1]) {
    g.append('line')
      .attr('class', 'intel-decay-now')
      .attr('x1', x(config.nowHour))
      .attr('x2', x(config.nowHour))
      .attr('y1', 0)
      .attr('y2', h)
      .attr('stroke', '#fff')
      .attr('stroke-width', 1)
      .attr('stroke-dasharray', '3 3');
  }

  // Axes
  g.append('g')
    .attr('class', 'intel-decay-x-axis')
    .attr('transform', `translate(0,${h})`)
    .call(d3.axisBottom(x).ticks(8).tickFormat((d) => `${d}h`));

  g.append('g').attr('class', 'intel-decay-y-axis').call(d3.axisLeft(y).ticks(5));

  // Y label
  g.append('text')
    .attr('class', 'intel-decay-label')
    .attr('transform', 'rotate(-90)')
    .attr('y', -45)
    .attr('x', -h / 2)
    .attr('text-anchor', 'middle')
    .attr('fill', '#aaa')
    .attr('font-size', '11px')
    .text('Intensity');
}
