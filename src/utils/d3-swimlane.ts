import * as d3 from 'd3';

export interface SwimlaneSegment {
  start: number; // epoch ms
  end: number;
  intensity: number; // 0-100
}

export interface SwimlaneEvent {
  time: number; // epoch ms
  label: string;
  lane: string;
}

export interface SwimlaneConfig {
  containerId: string;
  lanes: { id: string; label: string; segments: SwimlaneSegment[] }[];
  events?: SwimlaneEvent[];
  nowTime: number; // epoch ms
  width: number;
  height: number;
  margin?: { top: number; right: number; bottom: number; left: number };
  onEventClick?: (event: SwimlaneEvent) => void;
  onScrub?: (time: number) => void;
  accentColor?: string;
}

export function renderSwimlane(config: SwimlaneConfig): void {
  const container = document.getElementById(config.containerId);
  if (!container) return;
  if (!config.lanes.length) {
    container.innerHTML = '<p class="intel-swimlane-empty">No data</p>';
    return;
  }

  const margin = config.margin ?? { top: 20, right: 20, bottom: 30, left: 60 };
  const w = config.width - margin.left - margin.right;
  const h = config.height - margin.top - margin.bottom;
  const laneH = h / config.lanes.length;
  const accent = config.accentColor ?? '#4fc3f7';

  d3.select(container).selectAll('*').remove();

  const allTimes = config.lanes.flatMap((l) => l.segments.flatMap((s) => [s.start, s.end]));
  const tMin = d3.min(allTimes) ?? 0;
  const tMax = d3.max(allTimes) ?? 1;
  const x = d3.scaleLinear().domain([tMin, tMax]).range([0, w]);

  const svg = d3
    .select(container)
    .append('svg')
    .attr('width', config.width)
    .attr('height', config.height)
    .attr('class', 'intel-swimlane');

  const defs = svg.append('defs');
  defs
    .append('clipPath')
    .attr('id', 'intel-swim-clip')
    .append('rect')
    .attr('width', w)
    .attr('height', h);

  const g = svg
    .append('g')
    .attr('transform', `translate(${margin.left},${margin.top})`)
    .attr('clip-path', 'url(#intel-swim-clip)');

  const content = g.append('g').attr('class', 'intel-swimlane-content');

  function intensityColor(val: number): string {
    const t = val / 100;
    if (val > 70) return d3.interpolate('#1565c0', accent)(t);
    if (val > 40) return d3.interpolate('#1565c0', accent)(t * 0.6);
    return d3.interpolate('#1565c0', accent)(t * 0.3);
  }

  // Lanes
  config.lanes.forEach((lane, i) => {
    const yOff = i * laneH;

    // Lane background
    content
      .append('rect')
      .attr('x', 0)
      .attr('y', yOff)
      .attr('width', w)
      .attr('height', laneH)
      .attr('fill', i % 2 === 0 ? 'rgba(255,255,255,0.02)' : 'transparent');

    // Segments
    content
      .selectAll(`.intel-swim-seg-${i}`)
      .data(lane.segments)
      .join('rect')
      .attr('class', `intel-swim-seg-${i}`)
      .attr('x', (d) => x(d.start))
      .attr('y', yOff + 4)
      .attr('width', (d) => Math.max(1, x(d.end) - x(d.start)))
      .attr('height', laneH - 8)
      .attr('rx', 3)
      .attr('fill', (d) => intensityColor(d.intensity));

    // Label
    svg
      .append('text')
      .attr('x', margin.left - 6)
      .attr('y', margin.top + yOff + laneH / 2)
      .attr('text-anchor', 'end')
      .attr('dominant-baseline', 'middle')
      .attr('fill', '#ccc')
      .attr('font-size', '11px')
      .text(lane.label);
  });

  // Prediction zone
  if (config.nowTime > tMin && config.nowTime < tMax) {
    content
      .append('rect')
      .attr('class', 'intel-swimlane-prediction')
      .attr('x', x(config.nowTime))
      .attr('y', 0)
      .attr('width', w - x(config.nowTime))
      .attr('height', h)
      .attr('fill', 'none')
      .attr('stroke', '#888')
      .attr('stroke-dasharray', '4 4')
      .attr('opacity', 0.5);
  }

  // Events
  if (config.events?.length) {
    content
      .selectAll('.intel-swimlane-event')
      .data(config.events)
      .join('circle')
      .attr('class', 'intel-swimlane-event')
      .attr('cx', (d) => x(d.time))
      .attr('cy', (d) => {
        const idx = config.lanes.findIndex((l) => l.id === d.lane);
        return idx >= 0 ? idx * laneH + laneH / 2 : 0;
      })
      .attr('r', 5)
      .attr('fill', accent)
      .attr('stroke', '#fff')
      .attr('stroke-width', 1.5)
      .style('cursor', 'pointer')
      .on('click', (_event: MouseEvent, d: SwimlaneEvent) => config.onEventClick?.(d));
  }

  // Time scrubber
  const scrubber = content
    .append('line')
    .attr('class', 'intel-swimlane-scrubber')
    .attr('x1', x(config.nowTime))
    .attr('x2', x(config.nowTime))
    .attr('y1', 0)
    .attr('y2', h)
    .attr('stroke', '#fff')
    .attr('stroke-width', 1.5)
    .style('cursor', 'ew-resize');

  const drag = d3.drag<SVGLineElement, unknown>().on('drag', function (event) {
    const nx = Math.max(0, Math.min(w, event.x));
    d3.select(this).attr('x1', nx).attr('x2', nx);
    config.onScrub?.(x.invert(nx));
  });
  scrubber.call(drag);

  // X axis
  svg
    .append('g')
    .attr('class', 'intel-swimlane-x-axis')
    .attr('transform', `translate(${margin.left},${margin.top + h})`)
    .call(
      d3
        .axisBottom(x)
        .ticks(6)
        .tickFormat((d) => {
          const date = new Date(d as number);
          return `${date.getMonth() + 1}/${date.getDate()} ${date.getHours()}:00`;
        })
    );

  // Zoom
  const zoom = d3
    .zoom<SVGSVGElement, unknown>()
    .scaleExtent([1, 20])
    .translateExtent([
      [0, 0],
      [w, h],
    ])
    .on('zoom', (event) => {
      const newX = event.transform.rescaleX(x);
      content.attr('transform', `translate(${event.transform.x},0) scale(${event.transform.k},1)`);
      svg
        .select<SVGGElement>('.intel-swimlane-x-axis')
        .call(
          d3
            .axisBottom(newX)
            .ticks(6)
            .tickFormat((d) => {
              const date = new Date(d as number);
              return `${date.getMonth() + 1}/${date.getDate()} ${date.getHours()}:00`;
            })
        );
    });

  svg.call(zoom);
}
