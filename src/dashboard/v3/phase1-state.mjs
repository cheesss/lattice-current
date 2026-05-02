/**
 * V3 dashboard upgrade — Phase 1 entry.
 *
 * Self-mounting module that contributes four pieces:
 *   1. Freshness pill   (mountFreshnessPill)
 *   2. Skeleton loader  (mountSkeleton)
 *   3. Optimistic wrap  (runOptimistic)
 *   4. Value pulse      (pulseValue)
 *
 * Auto-attach behavior: any element carrying `[data-v3-freshness]` gets a
 * freshness pill mounted in its corner once the dashboard has settled
 * (via deferUntilIdle). All other components are caller-driven — surfaces
 * import the named exports below and mount them as needed.
 *
 * CSS is loaded via dynamic <link> injection (same pattern as sl-banners),
 * so this module is fully self-contained: importing it from
 * `src/dashboard/v3/index.mjs` is enough for the surface to appear.
 */

import { deferUntilIdle } from '../shared/dom-utils.mjs';
import { mountFreshnessPill } from './state-freshness.mjs';
import { mountSkeleton } from './state-skeleton.mjs';
import { runOptimistic } from './state-optimistic.mjs';
import { pulseValue } from './state-pulse.mjs';

const STYLESHEET_ID = 'v3-phase1-css';

function ensureStylesheet() {
  if (typeof document === 'undefined') return;
  if (document.getElementById(STYLESHEET_ID)) return;
  const link = document.createElement('link');
  link.id = STYLESHEET_ID;
  link.rel = 'stylesheet';
  link.href = new URL('./phase1-state.css', import.meta.url).href;
  document.head.appendChild(link);
}

export { mountFreshnessPill, mountSkeleton, runOptimistic, pulseValue };

// Auto-attach: every existing data tile that opts in via [data-v3-freshness]
// gets a freshness pill in the corner. Opt-in only — does not affect any
// surface that hasn't added the attribute. Safe on pages with zero matches.
deferUntilIdle(() => {
  ensureStylesheet();
  if (typeof document === 'undefined') return;
  const targets = document.querySelectorAll('[data-v3-freshness]');
  targets.forEach((el) => {
    // Avoid double-mounting if a surface re-renders the host element.
    if (el.querySelector(':scope > .v3-fresh')) return;
    mountFreshnessPill(el, {});
  });
});
