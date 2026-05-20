/**
 * Shared DOM + fetch utilities for the dashboard overlay modules
 * (sl-banners, sl-onboarding, sl-prefs).
 *
 * Before this module each module duplicated:
 *   - element factory (el / $)
 *   - API_BASE resolver
 *   - JSON fetch with try/catch
 *   - stylesheet injection
 *
 * Centralising removes ~150 lines of duplication and makes design-token
 * changes propagate consistently.
 */

export const API_BASE = (() => {
  if (typeof window !== 'undefined' && window.LATTICE_API_BASE) {
    return String(window.LATTICE_API_BASE).replace(/\/$/, '');
  }
  return '';
})();

/**
 * Compact element factory. Differences from raw createElement:
 *   - `class` maps to className
 *   - `style` accepts a string and uses setAttribute (so subsequent
 *     mutations don't wipe other rules)
 *   - `data-*` keys become attributes
 *   - children can be strings, Nodes, or null/undefined (skipped)
 */
export function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') node.className = v;
    else if (k === 'style') node.setAttribute('style', v);
    else if (k.startsWith('data-')) node.setAttribute(k, v);
    else node[k] = v;
  }
  for (const child of children) {
    if (child === null || child === undefined) continue;
    if (typeof child === 'string') node.appendChild(document.createTextNode(child));
    else node.appendChild(child);
  }
  return node;
}

/**
 * Wrapper around fetch that returns null on any non-OK status (except 503,
 * which is treated as a degraded-but-readable response). Never throws.
 */
export async function fetchJson(pathOrUrl) {
  try {
    const url = pathOrUrl.startsWith('http') ? pathOrUrl : `${API_BASE}${pathOrUrl}`;
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok && res.status !== 503) return null;
    return await res.json();
  } catch {
    return null;
  }
}

/**
 * Inject a <link rel="stylesheet"> once per page for the shared
 * overlay stylesheet. Modules call this from their boot sequence so
 * any of them can render without depending on event-dashboard.html
 * having included the link.
 */
const OVERLAY_CSS_LINK_ID = 'sl-overlay-css';
const OVERLAY_CSS_PATH = '/src/dashboard/shared/sl-overlay.css';
export function ensureOverlayStylesheet() {
  if (typeof document === 'undefined') return;
  if (document.getElementById(OVERLAY_CSS_LINK_ID)) return;
  const link = document.createElement('link');
  link.id = OVERLAY_CSS_LINK_ID;
  link.rel = 'stylesheet';
  link.href = OVERLAY_CSS_PATH;
  document.head.appendChild(link);
}

/**
 * Defer a callback until after the dashboard's heavy boot finishes.
 * If the document is still loading, waits for DOMContentLoaded; otherwise
 * uses a short setTimeout. Used by all overlay modules so the inline
 * 7,971-line dashboard finishes its work before the overlay paints.
 */
export function deferUntilIdle(callback, delayMs = 1500) {
  if (typeof window === 'undefined') return;
  const fire = () => setTimeout(callback, delayMs);
  if (document.readyState === 'loading') {
    window.addEventListener('DOMContentLoaded', fire, { once: true });
  } else {
    fire();
  }
}
