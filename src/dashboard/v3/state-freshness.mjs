/**
 * V3 Phase 1 — Freshness pill.
 *
 * 3-state pill (live / stale / paused) with inline last-updated timestamp
 * and a manual refresh button. Self-recomputes its state every 5s based
 * on the most recent setLastUpdated() call.
 *
 * Thresholds (per spec):
 *   - live:   < 30s old
 *   - stale:  30s .. 5min old
 *   - paused: > 5min old, OR markPaused() was called explicitly
 */

import { el } from '../shared/dom-utils.mjs';

const LIVE_MAX_MS = 30 * 1000;
const STALE_MAX_MS = 5 * 60 * 1000;
const TICK_MS = 5_000;

function formatRelative(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '--:--:--';
  const now = Date.now();
  const ageMs = now - date.getTime();
  const absSec = Math.max(0, Math.round(ageMs / 1000));
  if (absSec < 60) return `${absSec}s ago`;
  if (absSec < 3600) return `${Math.floor(absSec / 60)}m ago`;
  return date.toLocaleTimeString([], { hour12: false });
}

/**
 * Mount a freshness pill into `host` and return a small programmatic API.
 *
 * @param {Element} host - host element to append into
 * @param {{ initial?: Date | null, label?: string }} [opts]
 * @returns {{
 *   setLastUpdated: (d: Date) => void,
 *   markPaused: () => void,
 *   onRefresh: (fn: () => void) => void,
 *   destroy: () => void,
 *   element: HTMLElement,
 * }}
 */
export function mountFreshnessPill(host, opts = {}) {
  let lastUpdated = opts.initial instanceof Date ? opts.initial : null;
  let paused = false;
  /** @type {Array<() => void>} */
  const refreshHandlers = [];

  const dot = el('span', { class: 'v3-fresh-dot' });
  const tsEl = el('span', { class: 'v3-fresh-ts v3-num' }, ['--:--:--']);
  const labelEl = el('span', { class: 'v3-fresh-label' }, [opts.label || 'data']);
  const btn = el('button', {
    type: 'button',
    class: 'v3-fresh-btn',
    'aria-label': 'Refresh',
    title: 'Refresh now',
  }, []);
  // Refresh icon — inline SVG (rotational arrow).
  btn.innerHTML
    = '<svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">'
    + '<path fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"'
    + ' d="M2.5 8a5.5 5.5 0 0 1 9.4-3.9M13.5 8a5.5 5.5 0 0 1-9.4 3.9M11.5 2.5v3h-3M4.5 13.5v-3h3"/>'
    + '</svg>';
  btn.addEventListener('click', () => {
    for (const fn of refreshHandlers) {
      try { fn(); } catch (err) { console.warn('[v3-fresh] refresh handler threw', err); }
    }
  });

  const root = el('span', { class: 'v3-fresh', 'data-state': 'paused' }, [
    dot, labelEl, tsEl, btn,
  ]);

  host.appendChild(root);

  function applyState() {
    let state;
    if (paused) state = 'paused';
    else if (!lastUpdated) state = 'paused';
    else {
      const age = Date.now() - lastUpdated.getTime();
      if (age < LIVE_MAX_MS) state = 'live';
      else if (age < STALE_MAX_MS) state = 'stale';
      else state = 'paused';
    }
    root.setAttribute('data-state', state);
    // Class is also set so CSS can use either selector form.
    root.classList.remove('v3-fresh-state-live', 'v3-fresh-state-stale', 'v3-fresh-state-paused');
    root.classList.add(`v3-fresh-state-${state}`);
    tsEl.textContent = lastUpdated ? formatRelative(lastUpdated) : '--:--:--';
  }

  applyState();
  const tick = setInterval(applyState, TICK_MS);

  return {
    element: root,
    setLastUpdated(d) {
      lastUpdated = d instanceof Date ? d : new Date(d);
      paused = false;
      applyState();
    },
    markPaused() {
      paused = true;
      applyState();
    },
    onRefresh(fn) {
      if (typeof fn === 'function') refreshHandlers.push(fn);
    },
    destroy() {
      clearInterval(tick);
      root.remove();
    },
  };
}
