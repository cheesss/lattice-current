/**
 * V3 Phase 3 — Lightweight Charts wrapper (additive)
 *
 *   mountTimeSeries(host, [{ time, value }], { markers, kind })
 *
 * Lazy-loads the lightweight-charts library (~45KB) only when the
 * function is actually called, so the initial dashboard bundle pays
 * nothing for unused chart surfaces.
 *
 * Returns a cleanup function (also exposes `chart`/`series` on the
 * resolved value if the caller `await`s it via the optional promise
 * stored on the host with key `_v3LwReady`).
 */

// Hex constants matching the v3 token values — CSS vars don't reach the
// canvas, so we hard-code the same color values that tokens.css defines.
const TOKENS = {
  bg950: '#020617',
  bg850: '#1e293b',
  textBase: '#cbd5e1',
  textSoft: '#94a3b8',
  borderHairline: 'rgba(148, 163, 184, 0.08)',
  borderSoft: 'rgba(148, 163, 184, 0.16)',
  up: '#3b82f6',
  down: '#ef4444',
  accent: '#d8f99d',
};

/**
 * @param {Element} host
 * @param {Array<{ time: number | string, value: number }>} series
 * @param {{
 *   markers?: Array<{ time: number | string, label: string, color?: string, position?: 'aboveBar' | 'belowBar' | 'inBar' }>,
 *   kind?: 'line' | 'area',
 *   color?: string,
 * }} [opts]
 * @returns {() => void} cleanup
 */
export function mountTimeSeries(host, series, opts = {}) {
  if (!host) return () => {};
  host.classList.add('v3-chart');
  host.textContent = '';

  let cancelled = false;
  let cleanupInner = () => {};

  // Show a placeholder skeleton until the lib resolves.
  const skeleton = document.createElement('div');
  skeleton.className = 'v3-chart-skeleton';
  skeleton.textContent = '';
  host.appendChild(skeleton);

  const ready = (async () => {
    let lib;
    try {
      lib = await import('lightweight-charts');
    } catch (err) {
      // Library failed to load — log and bail without touching the host.
      console.warn('mountTimeSeries: failed to load lightweight-charts', err);
      return null;
    }
    if (cancelled) return null;
    if (skeleton.parentNode === host) host.removeChild(skeleton);

    const chart = lib.createChart(host, {
      autoSize: true,
      layout: {
        background: { color: TOKENS.bg950 },
        textColor: TOKENS.textBase,
        fontFamily: 'JetBrains Mono, Fira Code, Consolas, monospace',
      },
      grid: {
        vertLines: { color: TOKENS.borderHairline },
        horzLines: { color: TOKENS.borderHairline },
      },
      rightPriceScale: { borderColor: TOKENS.borderSoft },
      timeScale: { borderColor: TOKENS.borderSoft, timeVisible: true, secondsVisible: false },
      crosshair: { mode: 1 },
    });

    const kind = opts.kind === 'area' ? 'area' : 'line';
    const color = opts.color || TOKENS.accent;
    const lineSeries =
      kind === 'area' && typeof chart.addAreaSeries === 'function'
        ? chart.addAreaSeries({
            lineColor: color,
            topColor: 'rgba(216,249,157,0.32)',
            bottomColor: 'rgba(216,249,157,0.02)',
            priceLineVisible: false,
          })
        : chart.addLineSeries({
            color,
            lineWidth: 1.5,
            priceLineVisible: false,
            lastValueVisible: true,
          });

    const cleanedSeries = (Array.isArray(series) ? series : [])
      .filter((p) => p && Number.isFinite(Number(p.value)) && p.time !== undefined && p.time !== null)
      .map((p) => ({ time: p.time, value: Number(p.value) }));
    lineSeries.setData(cleanedSeries);

    if (Array.isArray(opts.markers) && opts.markers.length > 0) {
      const markers = opts.markers.map((m) => ({
        time: m.time,
        position: m.position || 'aboveBar',
        color: m.color || TOKENS.up,
        shape: 'circle',
        text: m.label || '',
      }));
      // Lightweight Charts ≥4.0 splits markers into a separate primitive
      // (`createSeriesMarkers`); older builds keep `series.setMarkers`.
      const seriesMarkersFactory = lib.createSeriesMarkers;
      if (typeof seriesMarkersFactory === 'function') {
        seriesMarkersFactory(lineSeries, markers);
      } else if (typeof lineSeries.setMarkers === 'function') {
        lineSeries.setMarkers(markers);
      }
    }

    // ResizeObserver — auto-fit to host bounds.
    let ro = null;
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(() => {
        const rect = host.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
          chart.applyOptions({ width: rect.width, height: rect.height });
        }
      });
      ro.observe(host);
    }

    cleanupInner = () => {
      if (ro) ro.disconnect();
      try {
        chart.remove();
      } catch {
        // ignore — chart already disposed
      }
    };

    return { chart, series: lineSeries };
  })();

  // Expose the promise so callers can await chart instance if needed.
  Object.defineProperty(host, '_v3LwReady', { value: ready, configurable: true });

  return () => {
    cancelled = true;
    if (skeleton.parentNode === host) host.removeChild(skeleton);
    cleanupInner();
  };
}

/* Smoke harness (manual, browser only):
 *   mountTimeSeries(host, [
 *     { time: '2026-04-01', value: 100 },
 *     { time: '2026-04-02', value: 102 },
 *     { time: '2026-04-03', value: 99 },
 *   ], { markers: [{ time: '2026-04-02', label: 'evt' }] });
 */
