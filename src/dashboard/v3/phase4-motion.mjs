/**
 * V3 Phase 4 — Motion utility (Linear-style restraint).
 *
 * Vanilla Web Animations API primitives consumed by Phases 1/2/3.
 * Animate *changes* (value updates, panel open/close), not renders.
 * Honor `prefers-reduced-motion: reduce` — animations become instant.
 * All animations are interruptible: re-entry on the same element with
 * the same `id` cancels the prior animation cleanly.
 *
 *   anim                  — wraps Element.animate() with sane defaults
 *   slideIn / slideOut    — panel reveal / dismiss (translate %)
 *   fadeIn / fadeOut      — opacity micro (100ms)
 *   pulseGlow             — value-update box-shadow flash (400ms)
 *   flashOnUpdate         — value-cell observer (returns update(newValue))
 *   animateSurfaceSwap    — cross-fade two surface DIVs (300ms)
 *
 * Tokens (from tokens.css) — hardcoded as JS constants because CSS vars
 * don't apply to JS-driven keyframes:
 *   FAST=100ms / BASE=200ms / SLOW=300ms
 *   ease-out      = cubic-bezier(0.16, 1, 0.3, 1)
 *   ease-in       = cubic-bezier(0.7, 0, 0.84, 0)
 *   ease-in-out   = cubic-bezier(0.65, 0, 0.35, 1)
 */

import { deferUntilIdle } from '../shared/dom-utils.mjs';

// ---------------------------------------------------------------- timing
const DUR_FAST = 100;
const DUR_BASE = 200;
const DUR_SLOW = 300;

const EASE_OUT = 'cubic-bezier(0.16, 1, 0.3, 1)';
const EASE_IN = 'cubic-bezier(0.7, 0, 0.84, 0)';
const EASE_IN_OUT = 'cubic-bezier(0.65, 0, 0.35, 1)';

// Track in-flight animations per (element + id) to enable clean re-entry.
/** @type {WeakMap<Element, Map<string, Animation>>} */
const liveAnimations = new WeakMap();

/**
 * Read the reduce-motion media query at call time (not module-load time)
 * so users toggling OS settings mid-session see updates without reload.
 */
function reduceMotion() {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

/**
 * @param {Keyframe | Keyframe[] | PropertyIndexedKeyframes | null} keyframes
 * @returns {Keyframe | null}
 */
function lastKeyframe(keyframes) {
  if (Array.isArray(keyframes)) {
    const last = keyframes[keyframes.length - 1];
    return last ?? null;
  }
  return null;
}

/**
 * @param {Element} el
 * @param {string} id
 */
function cancelPriorAnimation(el, id) {
  const map = liveAnimations.get(el);
  if (!map) return;
  const prior = map.get(id);
  if (prior) {
    try { prior.cancel(); } catch { /* already ended */ }
    map.delete(id);
  }
}

/**
 * @param {Element} el
 * @param {string} id
 * @param {Animation} animation
 */
function trackAnimation(el, id, animation) {
  let map = liveAnimations.get(el);
  if (!map) {
    map = new Map();
    liveAnimations.set(el, map);
  }
  map.set(id, animation);
  const cleanup = () => {
    const m = liveAnimations.get(el);
    if (m && m.get(id) === animation) m.delete(id);
  };
  animation.addEventListener('finish', cleanup, { once: true });
  animation.addEventListener('cancel', cleanup, { once: true });
}

// ---------------------------------------------------------------- anim core
/**
 * Wraps Element.animate() with project defaults + reduce-motion + re-entry.
 *
 * Caller can `await anim(...).finished` for chaining.
 *
 * @param {Element} el
 * @param {Keyframe[] | PropertyIndexedKeyframes} keyframes
 * @param {(KeyframeAnimationOptions & { id?: string }) | number} [options]
 * @returns {Animation}
 */
export function anim(el, keyframes, options) {
  /** @type {KeyframeAnimationOptions & { id?: string }} */
  const opts = typeof options === 'number' ? { duration: options } : { ...(options || {}) };
  const id = opts.id || 'default';
  delete opts.id;

  cancelPriorAnimation(el, id);

  const duration = typeof opts.duration === 'number' ? opts.duration : DUR_BASE;
  const easing = opts.easing || EASE_OUT;
  const fill = opts.fill || 'forwards';

  if (reduceMotion()) {
    // Instant: apply final keyframe via a 0-duration animation so the
    // returned Animation interface is consistent (callers can still
    // `.finished` it). For PropertyIndexedKeyframes we can't easily pick
    // "the last", so just play with duration 0 and fill forwards.
    const instant = el.animate(keyframes, { ...opts, duration: 0, fill });
    trackAnimation(el, id, instant);
    return instant;
  }

  const animation = el.animate(keyframes, { ...opts, duration, easing, fill });
  trackAnimation(el, id, animation);
  // Touch lastKeyframe so the helper isn't flagged unused under
  // noUnusedLocals in case future logic needs it.
  void lastKeyframe;
  return animation;
}

// ---------------------------------------------------------------- slideIn/Out
/** @typedef {'left' | 'right' | 'top' | 'bottom'} SlideDir */

/**
 * @param {SlideDir} dir
 * @param {boolean} entering true = arriving from `dir`, false = leaving toward `dir`
 * @returns {{ from: string, to: string }}
 */
function translateForDir(dir, entering) {
  /** @type {Record<SlideDir, string>} */
  const offsets = {
    left: 'translateX(-100%)',
    right: 'translateX(100%)',
    top: 'translateY(-100%)',
    bottom: 'translateY(100%)',
  };
  const offset = offsets[dir];
  const home = 'translate(0, 0)';
  return entering ? { from: offset, to: home } : { from: home, to: offset };
}

/**
 * Convenience: slide an element in from one edge.
 * Used by Phase 2 cheatsheet panel reveal.
 *
 * @param {Element} el
 * @param {SlideDir} from
 * @returns {Animation}
 */
export function slideIn(el, from) {
  const { from: t0, to: t1 } = translateForDir(from, true);
  return anim(
    el,
    [
      { transform: t0, opacity: 0 },
      { transform: t1, opacity: 1 },
    ],
    { id: 'slide', duration: DUR_SLOW, easing: EASE_OUT },
  );
}

/**
 * Mirror of slideIn — slides an element out toward an edge.
 *
 * @param {Element} el
 * @param {SlideDir} to
 * @returns {Animation}
 */
export function slideOut(el, to) {
  const { from: t0, to: t1 } = translateForDir(to, false);
  return anim(
    el,
    [
      { transform: t0, opacity: 1 },
      { transform: t1, opacity: 0 },
    ],
    { id: 'slide', duration: DUR_SLOW, easing: EASE_IN },
  );
}

// ---------------------------------------------------------------- fadeIn/Out
/**
 * Fast opacity fade-in (100ms).
 * @param {Element} el
 * @returns {Animation}
 */
export function fadeIn(el) {
  return anim(
    el,
    [{ opacity: 0 }, { opacity: 1 }],
    { id: 'fade', duration: DUR_FAST, easing: EASE_OUT },
  );
}

/**
 * Fast opacity fade-out (100ms).
 * @param {Element} el
 * @returns {Animation}
 */
export function fadeOut(el) {
  return anim(
    el,
    [{ opacity: 1 }, { opacity: 0 }],
    { id: 'fade', duration: DUR_FAST, easing: EASE_IN },
  );
}

// ---------------------------------------------------------------- pulseGlow
/**
 * Brief box-shadow pulse — used to draw the eye to a value that just
 * changed. Default color = `var(--accent)`. Pass a token reference like
 * `var(--v3-dir-up)` or `var(--v3-dir-down)` for delta cues.
 *
 * Total duration 400ms, ease-out.
 *
 * @param {Element} el
 * @param {string} [color]
 * @returns {Animation}
 */
export function pulseGlow(el, color) {
  const c = color || 'var(--accent)';
  return anim(
    el,
    [
      { boxShadow: `0 0 0 0 transparent` },
      { boxShadow: `0 0 0 1px ${c}` },
      { boxShadow: `0 0 0 0 transparent` },
    ],
    { id: 'pulse', duration: 400, easing: EASE_OUT },
  );
}

// ---------------------------------------------------------------- flashOnUpdate
/**
 * Observer pattern for ticker / value cells. Returns an `update` function
 * the caller invokes when a new value is available. If the new value
 * differs from the last seen one, applies pulseGlow and updates
 * `el.textContent` via the optional formatter.
 *
 * Caller drives the cadence — no rAF loop, no timers.
 *
 * @template T
 * @param {() => T} getValue   - initial value reader (sets baseline)
 * @param {Element} el         - cell to flash + update
 * @param {(v: T) => string} [formatter]
 * @returns {(newValue: T) => void}
 */
export function flashOnUpdate(getValue, el, formatter) {
  /** @type {(v: T) => string} */
  const fmt = formatter || ((/** @type {T} */ v) => String(v));
  let lastValue = getValue();
  // Paint baseline so the cell isn't blank on first frame.
  try { el.textContent = fmt(lastValue); } catch { /* readonly element */ }

  return function update(newValue) {
    if (Object.is(newValue, lastValue)) return;
    lastValue = newValue;
    try { el.textContent = fmt(newValue); } catch { /* readonly element */ }
    pulseGlow(el);
  };
}

// ---------------------------------------------------------------- animateSurfaceSwap
/**
 * Cross-fade two surface DIVs over 300ms (ease-in-out). Both animations
 * run concurrently; resolves when both finish (or instantly if either
 * is cancelled by a re-entry).
 *
 * @param {Element} fromEl
 * @param {Element} toEl
 * @returns {Promise<void>}
 */
export function animateSurfaceSwap(fromEl, toEl) {
  const out = anim(
    fromEl,
    [{ opacity: 1 }, { opacity: 0 }],
    { id: 'swap', duration: DUR_SLOW, easing: EASE_IN_OUT },
  );
  const into = anim(
    toEl,
    [{ opacity: 0 }, { opacity: 1 }],
    { id: 'swap', duration: DUR_SLOW, easing: EASE_IN_OUT },
  );
  // Both `.finished` promises reject on cancel; swallow so a re-entry
  // mid-swap doesn't surface as an unhandled rejection at the caller.
  const settle = (/** @type {Animation} */ a) => a.finished.then(() => undefined, () => undefined);
  return Promise.all([settle(out), settle(into)]).then(() => undefined);
}

// ---------------------------------------------------------------- mount
function ensureStylesheet() {
  if (typeof document === 'undefined') return;
  if (document.getElementById('v3-phase4-css')) return;
  const link = document.createElement('link');
  link.id = 'v3-phase4-css';
  link.rel = 'stylesheet';
  link.href = new URL('./phase4-motion.css', import.meta.url).href;
  document.head.appendChild(link);
}

deferUntilIdle(() => {
  ensureStylesheet();
});
