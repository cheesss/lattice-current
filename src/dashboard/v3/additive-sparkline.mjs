/**
 * V3 Phase 3 — Sparkline cell (additive)
 *
 * Inline SVG sparkline. No dependencies. Suitable for table cells and
 * tight inline contexts (default 100x20 viewport, scales by host width).
 *
 *   mountSparkline(host, [1, 4, 2, 6, 3, 8])
 *
 * Returns a cleanup function that detaches the rendered SVG.
 */

const SVG_NS = 'http://www.w3.org/2000/svg';

const DEFAULTS = {
  width: 100,
  height: 20,
  stroke: 'var(--v3-text-base)',
  fill: 'none',
  lastDot: true,
  strokeWidth: 1.25,
};

/**
 * Render a sparkline into `host`. Replaces any prior content.
 *
 * @param {Element} host
 * @param {number[]} data
 * @param {Partial<typeof DEFAULTS>} [opts]
 * @returns {() => void} cleanup
 */
export function mountSparkline(host, data, opts = {}) {
  if (!host) return () => {};
  const cfg = { ...DEFAULTS, ...opts };
  const series = Array.isArray(data) ? data.filter((v) => Number.isFinite(v)) : [];

  // Always clear first so re-mounts swap cleanly.
  host.textContent = '';

  if (series.length < 2) {
    // Degrade to an em-dash placeholder so the cell stays well-spaced.
    const span = document.createElement('span');
    span.className = 'v3-spark v3-spark-empty';
    span.textContent = '—';
    host.appendChild(span);
    return () => {
      if (span.parentNode === host) host.removeChild(span);
    };
  }

  const w = Math.max(1, Number(cfg.width) || 100);
  const h = Math.max(1, Number(cfg.height) || 20);
  const pad = 1.5; // keep stroke inside viewBox

  let min = Infinity;
  let max = -Infinity;
  for (const v of series) {
    if (v < min) min = v;
    if (v > max) max = v;
  }
  // Avoid div-by-zero when all values equal — render flat line in middle.
  const range = max - min || 1;
  const stepX = (w - pad * 2) / (series.length - 1);

  const points = series
    .map((v, i) => {
      const x = pad + stepX * i;
      const y = pad + (h - pad * 2) * (1 - (v - min) / range);
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(' ');

  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', 'v3-spark');
  svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
  svg.setAttribute('width', String(w));
  svg.setAttribute('height', String(h));
  svg.setAttribute('preserveAspectRatio', 'none');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', `sparkline ${series.length} points`);

  const poly = document.createElementNS(SVG_NS, 'polyline');
  poly.setAttribute('points', points);
  poly.setAttribute('fill', cfg.fill);
  poly.setAttribute('stroke', cfg.stroke);
  poly.setAttribute('stroke-width', String(cfg.strokeWidth));
  poly.setAttribute('stroke-linejoin', 'round');
  poly.setAttribute('stroke-linecap', 'round');
  poly.setAttribute('vector-effect', 'non-scaling-stroke');
  svg.appendChild(poly);

  if (cfg.lastDot) {
    const last = series[series.length - 1];
    if (Number.isFinite(last)) {
      const x = pad + stepX * (series.length - 1);
      const y = pad + (h - pad * 2) * (1 - (last - min) / range);
      const dot = document.createElementNS(SVG_NS, 'circle');
      dot.setAttribute('cx', x.toFixed(2));
      dot.setAttribute('cy', y.toFixed(2));
      dot.setAttribute('r', '1.6');
      dot.setAttribute('fill', cfg.stroke);
      svg.appendChild(dot);
    }
  }

  host.appendChild(svg);
  return () => {
    if (svg.parentNode === host) host.removeChild(svg);
  };
}

/* Smoke harness (manual):
 *   const host = document.createElement('div');
 *   document.body.appendChild(host);
 *   mountSparkline(host, [1, 4, 2, 6, 3, 8, 5]);
 */
