/**
 * V3 Phase 1 — Carbon-style staged skeleton loader.
 *
 * Replaces a spinner with a structural placeholder that hints at the
 * eventual content shape. Pulse animation is defined in phase1-state.css
 * (1.4s infinite, --v3-bg-850 → --v3-bg-800).
 *
 * Shape variants:
 *   list   — 4 rows, leading dot + 2 text lines
 *   card   — header strip + 3 paragraphs + footer
 *   table  — header row + 6 data rows × 4 columns
 *   tile   — full-bleed block with title + value placeholder
 *
 * The returned object exposes .remove() and .element so the caller can
 * swap in real DOM when data arrives.
 */

import { el } from '../shared/dom-utils.mjs';

/** @typedef {'list' | 'card' | 'table' | 'tile'} SkeletonKind */

/**
 * Build the inner structure for a given skeleton kind. Each "bar" is a
 * <span class="v3-skel-bar"> that the CSS animates.
 * @param {SkeletonKind} kind
 */
function buildShape(kind) {
  switch (kind) {
    case 'list': {
      /** @type {Array<HTMLElement>} */
      const rows = [];
      for (let i = 0; i < 4; i += 1) {
        rows.push(el('div', { class: 'v3-skel-row' }, [
          el('span', { class: 'v3-skel-bar v3-skel-dot' }),
          el('div', { class: 'v3-skel-col' }, [
            el('span', { class: 'v3-skel-bar v3-skel-line v3-skel-w-80' }),
            el('span', { class: 'v3-skel-bar v3-skel-line v3-skel-w-50' }),
          ]),
        ]));
      }
      return rows;
    }
    case 'card': {
      return [
        el('span', { class: 'v3-skel-bar v3-skel-line v3-skel-w-40 v3-skel-head' }),
        el('span', { class: 'v3-skel-bar v3-skel-line v3-skel-w-90' }),
        el('span', { class: 'v3-skel-bar v3-skel-line v3-skel-w-80' }),
        el('span', { class: 'v3-skel-bar v3-skel-line v3-skel-w-60' }),
        el('span', { class: 'v3-skel-bar v3-skel-line v3-skel-w-30 v3-skel-foot' }),
      ];
    }
    case 'table': {
      const cols = 4;
      const headRow = el('div', { class: 'v3-skel-trow v3-skel-thead' },
        Array.from({ length: cols }, () =>
          el('span', { class: 'v3-skel-bar v3-skel-cell' })));
      /** @type {Array<HTMLElement>} */
      const dataRows = [];
      for (let i = 0; i < 6; i += 1) {
        dataRows.push(el('div', { class: 'v3-skel-trow' },
          Array.from({ length: cols }, () =>
            el('span', { class: 'v3-skel-bar v3-skel-cell' }))));
      }
      return [headRow, ...dataRows];
    }
    case 'tile':
    default: {
      return [
        el('span', { class: 'v3-skel-bar v3-skel-line v3-skel-w-40 v3-skel-head' }),
        el('span', { class: 'v3-skel-bar v3-skel-block' }),
      ];
    }
  }
}

/**
 * Mount a skeleton inside `host`. Returns an object with `.remove()` so the
 * caller can replace it with real content once loaded.
 *
 * @param {Element} host
 * @param {SkeletonKind} kind
 * @returns {{ element: HTMLElement, remove: () => void }}
 */
export function mountSkeleton(host, kind) {
  const k = kind || 'tile';
  const root = el('div', {
    class: `v3-skel v3-skel-${k}`,
    'data-kind': k,
    role: 'status',
    'aria-busy': 'true',
    'aria-label': 'Loading',
  }, buildShape(k));
  host.appendChild(root);
  return {
    element: root,
    remove() { root.remove(); },
  };
}
