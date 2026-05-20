/**
 * V3 Phase 3 — Tabulator dense table wrapper (additive)
 *
 *   mountDenseTable(host, { columns, rows })
 *
 * Lazy-loads tabulator-tables (~200KB but only when called) and applies
 * Lattice tokens via the CSS overrides in phase3-additive.css.
 *
 * Provides ready-to-use formatter helpers:
 *   - formatLaneChip(cell)  — renders a colored lane pill
 *   - formatSparkCell(cell) — renders an inline sparkline (uses
 *     mountSparkline for the actual SVG)
 *
 * Column shape (forwarded to Tabulator):
 *   { title: string, field: string, formatter?: 'lane' | 'spark' | fn,
 *     hozAlign?, width?, ... }
 *
 * The 'lane' / 'spark' string formatters are mapped to the helpers above.
 */

import { mountSparkline } from './additive-sparkline.mjs';

function formatLaneChip(cell) {
  const value = cell.getValue();
  const lane = String(value ?? 'noise');
  const span = document.createElement('span');
  span.className = `v3-chip v3-chip-lane v3-chip-lane-${lane}`;
  span.textContent = lane;
  return span;
}

function formatSparkCell(cell) {
  const value = cell.getValue();
  const data = Array.isArray(value) ? value : [];
  const wrapper = document.createElement('span');
  wrapper.className = 'v3-spark-cell';
  // Defer mount to next tick so Tabulator has actually inserted the cell.
  queueMicrotask(() => {
    if (wrapper.isConnected) {
      mountSparkline(wrapper, data, { width: 90, height: 16, lastDot: true });
    }
  });
  return wrapper;
}

function resolveFormatter(formatter) {
  if (formatter === 'lane') return formatLaneChip;
  if (formatter === 'spark') return formatSparkCell;
  return formatter;
}

/**
 * @param {Element} host
 * @param {{ columns: any[], rows: any[], height?: string }} payload
 * @returns {() => void} cleanup
 */
export function mountDenseTable(host, payload) {
  if (!host) return () => {};
  host.classList.add('v3-dense-table');
  host.textContent = '';

  let cancelled = false;
  let table = null;

  const skeleton = document.createElement('div');
  skeleton.className = 'v3-dense-table-skeleton';
  skeleton.textContent = '';
  host.appendChild(skeleton);

  const columns = Array.isArray(payload && payload.columns)
    ? payload.columns.map((col) => ({ ...col, formatter: resolveFormatter(col.formatter) }))
    : [];
  const rows = Array.isArray(payload && payload.rows) ? payload.rows : [];

  (async () => {
    let lib;
    try {
      lib = await import('tabulator-tables');
    } catch (err) {
      console.warn('mountDenseTable: failed to load tabulator-tables', err);
      return;
    }
    if (cancelled) return;
    if (skeleton.parentNode === host) host.removeChild(skeleton);

    const Tabulator = lib.TabulatorFull || lib.Tabulator || lib.default;
    if (!Tabulator) {
      console.warn('mountDenseTable: tabulator-tables export not found', Object.keys(lib));
      return;
    }

    table = new Tabulator(host, {
      data: rows,
      columns,
      layout: 'fitDataStretch',
      height: payload.height || '100%',
      reactiveData: false,
      virtualDom: true,
      placeholder: 'No rows',
      headerSortClickElement: 'icon',
      movableColumns: false,
    });
  })().catch((err) => {
    console.warn('mountDenseTable: render failed', err);
  });

  return () => {
    cancelled = true;
    if (skeleton.parentNode === host) host.removeChild(skeleton);
    if (table && typeof table.destroy === 'function') {
      try {
        table.destroy();
      } catch {
        // ignore — already destroyed
      }
    }
    host.textContent = '';
  };
}

export const denseTableFormatters = { formatLaneChip, formatSparkCell };

/* Smoke harness (manual, browser only):
 *   mountDenseTable(host, {
 *     columns: [
 *       { title: 'Lane', field: 'lane', formatter: 'lane', width: 100 },
 *       { title: 'Theme', field: 'label' },
 *       { title: 'Trend', field: 'trend', formatter: 'spark', width: 110 },
 *       { title: 'Size', field: 'size', hozAlign: 'right' },
 *     ],
 *     rows: [
 *       { lane: 'validated', label: 'AI infra', size: 120, trend: [1, 3, 2, 5, 4] },
 *       { lane: 'pending',   label: 'Energy',   size:  80, trend: [4, 4, 3, 2, 3] },
 *     ],
 *   });
 */
