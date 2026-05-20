/**
 * V3 Phase 3 — Theme treemap (additive)
 *
 * Squarified treemap of items keyed by lane. Uses d3-hierarchy when
 * available; falls back to a stacked-bar listing if the import fails.
 *
 *   mountTreemap(host, [{ label, size, lane, meta? }], { onClick })
 */

const LANE_VAR = {
  validated: 'var(--v3-lane-validated)',
  pending: 'var(--v3-lane-pending)',
  watch: 'var(--v3-lane-watch)',
  noise: 'var(--v3-lane-noise)',
};

function laneColor(lane) {
  if (lane && Object.prototype.hasOwnProperty.call(LANE_VAR, lane)) {
    return LANE_VAR[lane];
  }
  return 'var(--v3-text-muted)';
}

function ensureSize(host) {
  // Prefer the host's measured rect; fall back to sane defaults.
  const rect = host.getBoundingClientRect();
  const w = Math.max(120, Math.floor(rect.width || host.clientWidth || 480));
  const h = Math.max(80, Math.floor(rect.height || host.clientHeight || 240));
  return { w, h };
}

function renderFallback(host, items, onClick) {
  // Sorted bar list — total size used for proportional widths.
  const total = items.reduce((acc, it) => acc + Math.max(0, Number(it.size) || 0), 0) || 1;
  const list = document.createElement('ul');
  list.className = 'v3-treemap v3-treemap-fallback';
  for (const item of items) {
    const li = document.createElement('li');
    li.className = 'v3-treemap-tile v3-treemap-tile-fallback';
    const pct = ((Math.max(0, Number(item.size) || 0) / total) * 100).toFixed(1);
    li.setAttribute('style', `--v3-tile-color:${laneColor(item.lane)}; --v3-tile-pct:${pct}%`);
    li.dataset.lane = item.lane || '';
    li.innerHTML = `
      <span class="v3-treemap-bar"></span>
      <span class="v3-treemap-label">${escapeHtml(String(item.label ?? ''))}</span>
      <span class="v3-treemap-size v3-num">${formatSize(item.size)}</span>
    `;
    if (typeof onClick === 'function') {
      li.style.cursor = 'pointer';
      li.addEventListener('click', () => onClick(item));
    }
    list.appendChild(li);
  }
  host.appendChild(list);
  return () => {
    if (list.parentNode === host) host.removeChild(list);
  };
}

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) =>
    c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '"' ? '&quot;' : '&#39;',
  );
}

function formatSize(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return '—';
  if (Math.abs(n) >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n.toFixed(0));
}

/**
 * @param {Element} host
 * @param {Array<{ label: string, size: number, lane?: string, meta?: any }>} items
 * @param {{ onClick?: (item: any) => void }} [opts]
 * @returns {() => void} cleanup
 */
export function mountTreemap(host, items, opts = {}) {
  if (!host) return () => {};
  host.textContent = '';
  const data = Array.isArray(items) ? items.filter((it) => it && Number(it.size) > 0) : [];
  if (data.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'v3-treemap v3-treemap-empty';
    empty.textContent = 'No tiles to render.';
    host.appendChild(empty);
    return () => {
      if (empty.parentNode === host) host.removeChild(empty);
    };
  }

  let cleanup = () => {};
  let cancelled = false;

  // Render a fallback synchronously so the host is never blank during the
  // dynamic import, then swap in the d3 treemap if it loads.
  cleanup = renderFallback(host, data, opts.onClick);

  import('d3-hierarchy')
    .then((d3h) => {
      if (cancelled) return;
      const { w, h } = ensureSize(host);
      const root = d3h
        .hierarchy({ children: data })
        .sum((d) => Math.max(0, Number(d.size) || 0))
        .sort((a, b) => (b.value || 0) - (a.value || 0));

      const layout = d3h.treemap().size([w, h]).paddingInner(2).round(true);
      layout(root);

      const SVG_NS = 'http://www.w3.org/2000/svg';
      const svg = document.createElementNS(SVG_NS, 'svg');
      svg.setAttribute('class', 'v3-treemap');
      svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
      svg.setAttribute('width', '100%');
      svg.setAttribute('height', '100%');
      svg.setAttribute('preserveAspectRatio', 'none');

      const leaves = root.leaves ? root.leaves() : [];
      for (const leaf of leaves) {
        const item = leaf.data;
        const x0 = leaf.x0 ?? 0;
        const y0 = leaf.y0 ?? 0;
        const x1 = leaf.x1 ?? 0;
        const y1 = leaf.y1 ?? 0;
        const width = Math.max(0, x1 - x0);
        const height = Math.max(0, y1 - y0);

        const g = document.createElementNS(SVG_NS, 'g');
        g.setAttribute('class', 'v3-treemap-tile');
        g.setAttribute('transform', `translate(${x0},${y0})`);
        if (item.lane) g.setAttribute('data-lane', item.lane);

        const rect = document.createElementNS(SVG_NS, 'rect');
        rect.setAttribute('width', String(width));
        rect.setAttribute('height', String(height));
        rect.setAttribute('fill', laneColor(item.lane));
        rect.setAttribute('fill-opacity', '0.78');
        rect.setAttribute('stroke', 'var(--v3-bg-950)');
        rect.setAttribute('stroke-width', '1');
        g.appendChild(rect);

        // Only show label when tile is large enough to fit it.
        if (width > 56 && height > 22) {
          const label = document.createElementNS(SVG_NS, 'text');
          label.setAttribute('x', '6');
          label.setAttribute('y', '14');
          label.setAttribute('fill', 'var(--v3-text-loud)');
          label.setAttribute('font-size', '11');
          label.textContent = String(item.label ?? '');
          g.appendChild(label);

          if (height > 38) {
            const sub = document.createElementNS(SVG_NS, 'text');
            sub.setAttribute('x', '6');
            sub.setAttribute('y', '28');
            sub.setAttribute('fill', 'var(--v3-text-base)');
            sub.setAttribute('font-size', '10');
            sub.setAttribute('class', 'v3-num');
            sub.textContent = formatSize(item.size);
            g.appendChild(sub);
          }
        }

        if (typeof opts.onClick === 'function') {
          g.style.cursor = 'pointer';
          g.addEventListener('click', () => opts.onClick(item));
        }

        svg.appendChild(g);
      }

      // Swap fallback for SVG.
      cleanup();
      host.appendChild(svg);
      cleanup = () => {
        if (svg.parentNode === host) host.removeChild(svg);
      };
    })
    .catch(() => {
      // Silent degrade — fallback already rendered.
    });

  return () => {
    cancelled = true;
    cleanup();
  };
}

/* Smoke harness (manual):
 *   mountTreemap(host, [
 *     { label: 'AI', size: 120, lane: 'validated' },
 *     { label: 'Energy', size: 80, lane: 'pending' },
 *     { label: 'Defense', size: 40, lane: 'watch' },
 *   ]);
 */
