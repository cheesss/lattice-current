/**
 * V3 Phase 2 — History stack (Cmd+[ / Cmd+] back/forward across surfaces).
 *
 * Linear-style. Tracks `body.dataset.surface` via MutationObserver so any
 * existing G+key handlers, hash-popstate, or programmatic switches all
 * feed the stack without us having to wrap them.
 *
 * The stack is purely in-memory (fresh each session). Capped at 50 entries.
 */

const MAX_STACK = 50;

/** @type {string[]} */
const stack = [];
let cursor = -1;
let restoring = false;
let mounted = false;

function currentSurface() {
  if (typeof document === 'undefined' || !document.body) return null;
  const v = document.body.dataset.surface;
  return v ? String(v) : null;
}

/**
 * Push a new entry. If the user navigated forward in history then made a
 * fresh switch, we truncate the forward stack (browser-history semantics).
 */
function pushEntry(name) {
  if (!name) return;
  if (stack[cursor] === name) return; // no-op duplicate
  // Truncate any forward entries — fresh navigation invalidates them.
  if (cursor < stack.length - 1) {
    stack.length = cursor + 1;
  }
  stack.push(name);
  if (stack.length > MAX_STACK) {
    stack.shift();
  } else {
    cursor += 1;
  }
  // After shift, cursor stays the same index (last entry).
  cursor = stack.length - 1;
}

function applySurface(name) {
  if (!name) return;
  restoring = true;
  try {
    // Prefer the host page's switchSurface() if it exists — it triggers all
    // the surface-active class toggles and lazy-loads. Fall back to a raw
    // dataset write so we still work on simpler pages.
    const w = /** @type {{switchSurface?:(s:string)=>void}} */ (
      /** @type {unknown} */ (window)
    );
    if (typeof w.switchSurface === 'function') {
      w.switchSurface(name);
    } else if (document.body) {
      document.body.dataset.surface = name;
    }
  } finally {
    // Release the flag on next tick so the MutationObserver has fired.
    setTimeout(() => { restoring = false; }, 0);
  }
}

function goBack() {
  if (cursor <= 0) return;
  cursor -= 1;
  const target = stack[cursor];
  if (target) applySurface(target);
}

function goForward() {
  if (cursor >= stack.length - 1) return;
  cursor += 1;
  const target = stack[cursor];
  if (target) applySurface(target);
}

function isEditableTarget(target) {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (target.isContentEditable) return true;
  return false;
}

function onKeydown(ev) {
  const mod = ev.ctrlKey || ev.metaKey;
  if (!mod) return;
  if (ev.altKey) return;
  if (ev.key !== '[' && ev.key !== ']') return;
  if (isEditableTarget(ev.target)) return;
  ev.preventDefault();
  if (ev.key === '[') goBack();
  else goForward();
}

function startObserver() {
  if (typeof MutationObserver === 'undefined' || !document.body) return;
  // Seed with the initial surface so the first Cmd+[ has something to pop.
  const initial = currentSurface();
  if (initial) pushEntry(initial);

  const obs = new MutationObserver((records) => {
    if (restoring) return;
    for (const r of records) {
      if (r.type === 'attributes' && r.attributeName === 'data-surface') {
        const name = currentSurface();
        if (name) pushEntry(name);
      }
    }
  });
  obs.observe(document.body, { attributes: true, attributeFilter: ['data-surface'] });
}

export function mountHistoryStack() {
  if (mounted) return;
  if (typeof document === 'undefined') return;
  mounted = true;
  startObserver();
  document.addEventListener('keydown', onKeydown);
}

/** Test/debug introspection — not part of the public Phase 2 API spec. */
export function _debugHistoryState() {
  return { stack: stack.slice(), cursor };
}
