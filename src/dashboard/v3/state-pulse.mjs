/**
 * V3 Phase 1 — Value pulse.
 *
 * When a numeric cell updates, briefly glow the element so the eye catches
 * the change. ~400ms total: ring + opacity fade out, --v3-ease-out.
 *
 * Direction encoding: opts.direction = 'up' | 'down' | undefined.
 *   - 'up'   → blue   (--v3-dir-up)   — Bloomberg-semantic
 *   - 'down' → red    (--v3-dir-down)
 *   - none   → accent (--accent)      — neutral default
 *
 * Implementation strategy: stack a temporary `data-v3-pulse` attribute on
 * the element and let CSS handle the actual animation. Cleanup is via a
 * single setTimeout — animation events would be more accurate but require
 * extra listener bookkeeping for very little gain at 400ms.
 */

const DURATION_MS = 400;

/**
 * @param {Element | null | undefined} target
 * @param {{ direction?: 'up' | 'down' }} [opts]
 */
export function pulseValue(target, opts = {}) {
  if (!target || !(target instanceof Element)) return;
  const dir = opts.direction === 'up' || opts.direction === 'down'
    ? opts.direction
    : 'neutral';
  // Setting the attribute restarts the CSS animation: if a prior pulse is
  // still in flight, clear it first so the new one starts fresh.
  target.removeAttribute('data-v3-pulse');
  // Force reflow so removing+re-adding the attribute restarts animation.
  void /** @type {HTMLElement} */ (target).offsetWidth;
  target.setAttribute('data-v3-pulse', dir);
  setTimeout(() => {
    if (target.getAttribute('data-v3-pulse') === dir) {
      target.removeAttribute('data-v3-pulse');
    }
  }, DURATION_MS);
}
