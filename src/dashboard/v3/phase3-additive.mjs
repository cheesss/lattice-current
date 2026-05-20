/**
 * V3 Phase 3 — Additive surface components (entry).
 *
 * Exposes five opt-in mount functions that surfaces can call later to
 * add Palantir/Bloomberg-grade widgets without disturbing the inline
 * 7,919-line event-dashboard.html monolith.
 *
 *   mountSparkline   — inline SVG sparkline (no deps)
 *   mountTreemap     — squarified tile chart (d3-hierarchy)
 *   mountMatchedDag  — static event/control DAG (no deps)
 *   mountTimeSeries  — time-series chart (lightweight-charts, lazy)
 *   mountDenseTable  — dense data grid (tabulator-tables, lazy)
 *
 * Imported by `src/dashboard/v3/index.mjs`. Beyond ensuring the
 * stylesheet is injected once on idle, this module performs NO
 * auto-mounting — every component must be explicitly called by a
 * surface, which keeps the legacy DOM untouched until callers opt in.
 */

import { deferUntilIdle } from '../shared/dom-utils.mjs';
import { mountSparkline } from './additive-sparkline.mjs';
import { mountTreemap } from './additive-treemap.mjs';
import { mountMatchedDag } from './additive-dag.mjs';
import { mountTimeSeries } from './additive-timeseries.mjs';
import { mountDenseTable } from './additive-dense-table.mjs';

const PHASE3_CSS_LINK_ID = 'v3-phase3-css';

function ensureStylesheet() {
  if (typeof document === 'undefined') return;
  if (document.getElementById(PHASE3_CSS_LINK_ID)) return;
  const link = document.createElement('link');
  link.id = PHASE3_CSS_LINK_ID;
  link.rel = 'stylesheet';
  link.href = new URL('./phase3-additive.css', import.meta.url).href;
  document.head.appendChild(link);
}

export { mountSparkline, mountTreemap, mountMatchedDag, mountTimeSeries, mountDenseTable };

deferUntilIdle(() => {
  ensureStylesheet();
  // No auto-attach — these are opt-in components used by surfaces later.
});
