/**
 * Lightweight Observable Store
 *
 * A type-safe, framework-agnostic reactive state container that replaces
 * scattered CustomEvent/dispatchEvent patterns with a single, predictable
 * state graph.  Supports:
 *
 *  - Fine-grained subscriptions via selector functions
 *  - Batched updates (multiple `set()` calls coalesced into one notification cycle)
 *  - Immutable snapshots (`get()` returns a frozen copy)
 *  - Optional middleware (logging, persistence, devtools)
 *
 * Usage:
 *   const store = createStore({ count: 0, label: '' });
 *   const unsub = store.subscribe(s => s.count, (count) => console.log(count));
 *   store.set({ count: 1 });            // logs 1
 *   store.set(prev => ({ count: prev.count + 1 }));  // logs 2
 *   unsub();
 */

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

/** Listener receives the selected slice and full state. */
export type Listener<S, R> = (selected: R, state: Readonly<S>) => void;

/** Selector extracts a slice from state. */
export type Selector<S, R> = (state: Readonly<S>) => R;

/** Updater — either a partial state object or a function returning one. */
export type Updater<S> = Partial<S> | ((prev: Readonly<S>) => Partial<S>);

/** Middleware runs before state is committed; can transform the patch. */
export type Middleware<S> = (
  prev: Readonly<S>,
  patch: Partial<S>,
  next: Readonly<S>,
) => void;

/** A subscription handle returned by subscribe(). */
export interface Unsubscribe {
  (): void;
}

/* ------------------------------------------------------------------ */
/*  Store interface                                                     */
/* ------------------------------------------------------------------ */

export interface ObservableStore<S extends Record<string, unknown>> {
  /** Return a frozen snapshot of current state. */
  get(): Readonly<S>;

  /** Return a selected slice of state. */
  get<R>(selector: Selector<S, R>): R;

  /** Merge a partial update into state and notify affected subscribers. */
  set(updater: Updater<S>): void;

  /**
   * Subscribe to state changes.  The listener is only called when the
   * selected value actually changes (shallow equality by default).
   */
  subscribe<R>(
    selector: Selector<S, R>,
    listener: Listener<S, R>,
    options?: { equalityFn?: (a: R, b: R) => boolean },
  ): Unsubscribe;

  /** Subscribe to every state change (no selector). */
  subscribe(listener: Listener<S, S>): Unsubscribe;

  /** Batch multiple set() calls — listeners fire once at the end. */
  batch(fn: () => void): void;

  /** Register middleware. Returns a removal function. */
  use(mw: Middleware<S>): () => void;

  /** Remove all listeners and middleware. */
  destroy(): void;
}

/* ------------------------------------------------------------------ */
/*  Internal subscription record                                       */
/* ------------------------------------------------------------------ */

interface Sub<S, R> {
  selector: Selector<S, R>;
  listener: Listener<S, R>;
  equalityFn: (a: R, b: R) => boolean;
  prev: R;
}

/* ------------------------------------------------------------------ */
/*  Default equality — shallow ===, plus shallow object/array compare   */
/* ------------------------------------------------------------------ */

function shallowEqual<T>(a: T, b: T): boolean {
  if (Object.is(a, b)) return true;
  if (
    typeof a !== 'object' || a === null ||
    typeof b !== 'object' || b === null
  ) return false;

  const ka = Object.keys(a as Record<string, unknown>);
  const kb = Object.keys(b as Record<string, unknown>);
  if (ka.length !== kb.length) return false;

  const objA = a as Record<string, unknown>;
  const objB = b as Record<string, unknown>;
  for (const key of ka) {
    if (!Object.is(objA[key], objB[key])) return false;
  }
  return true;
}

/* ------------------------------------------------------------------ */
/*  Factory                                                            */
/* ------------------------------------------------------------------ */

export function createStore<S extends Record<string, unknown>>(
  initial: S,
): ObservableStore<S> {
  let state: S = { ...initial };
  let subs: Sub<S, unknown>[] = [];
  let middlewares: Middleware<S>[] = [];
  let batchDepth = 0;
  let pendingPatch: Partial<S> | null = null;

  /* ---- helpers ---- */

  function freeze(s: S): Readonly<S> {
    return Object.freeze({ ...s });
  }

  function notify(): void {
    const frozenState = freeze(state);
    for (const sub of subs) {
      const next = sub.selector(frozenState);
      if (!sub.equalityFn(sub.prev, next)) {
        sub.prev = next;
        sub.listener(next, frozenState);
      }
    }
  }

  function applyPatch(patch: Partial<S>): void {
    const prev = state;
    const next = { ...state, ...patch };
    for (const mw of middlewares) {
      mw(freeze(prev), patch, freeze(next));
    }
    state = next;
  }

  /* ---- public API ---- */

  function get(): Readonly<S>;
  function get<R>(selector: Selector<S, R>): R;
  function get<R>(selector?: Selector<S, R>): Readonly<S> | R {
    const frozen = freeze(state);
    return selector ? selector(frozen) : frozen;
  }

  function set(updater: Updater<S>): void {
    const patch =
      typeof updater === 'function'
        ? (updater as (prev: Readonly<S>) => Partial<S>)(freeze(state))
        : updater;

    if (batchDepth > 0) {
      pendingPatch = pendingPatch ? { ...pendingPatch, ...patch } : { ...patch };
      return;
    }

    applyPatch(patch);
    notify();
  }

  function subscribe<R>(
    selectorOrListener: Selector<S, R> | Listener<S, S>,
    listener?: Listener<S, R>,
    options?: { equalityFn?: (a: R, b: R) => boolean },
  ): Unsubscribe {
    if (typeof listener === 'function') {
      // subscribe(selector, listener, options?)
      const selector = selectorOrListener as Selector<S, R>;
      const eq = options?.equalityFn ?? shallowEqual;
      const sub: Sub<S, R> = {
        selector,
        listener,
        equalityFn: eq,
        prev: selector(freeze(state)),
      };
      subs.push(sub as Sub<S, unknown>);
      return () => {
        subs = subs.filter((s) => s !== (sub as Sub<S, unknown>));
      };
    }

    // subscribe(listener)  — full-state subscription
    const fullListener = selectorOrListener as Listener<S, S>;
    const identity: Selector<S, S> = (s) => s;
    const sub: Sub<S, S> = {
      selector: identity,
      listener: fullListener,
      equalityFn: shallowEqual,
      prev: freeze(state),
    };
    subs.push(sub as Sub<S, unknown>);
    return () => {
      subs = subs.filter((s) => s !== (sub as Sub<S, unknown>));
    };
  }

  function batch(fn: () => void): void {
    batchDepth++;
    try {
      fn();
    } finally {
      batchDepth--;
      if (batchDepth === 0 && pendingPatch) {
        applyPatch(pendingPatch);
        pendingPatch = null;
        notify();
      }
    }
  }

  function use(mw: Middleware<S>): () => void {
    middlewares.push(mw);
    return () => {
      middlewares = middlewares.filter((m) => m !== mw);
    };
  }

  function destroy(): void {
    subs = [];
    middlewares = [];
    pendingPatch = null;
  }

  return { get, set, subscribe, batch, use, destroy } as ObservableStore<S>;
}

/* ------------------------------------------------------------------ */
/*  Built-in middleware helpers                                         */
/* ------------------------------------------------------------------ */

/** Logs every state change to console. */
export function loggerMiddleware<S extends Record<string, unknown>>(
  label = 'store',
): Middleware<S> {
  return (prev, patch, next) => {
    console.groupCollapsed(`[${label}] state updated`);
    console.log('prev ', prev);
    console.log('patch', patch);
    console.log('next ', next);
    console.groupEnd();
  };
}

/** Persists specified keys to localStorage. */
export function persistMiddleware<S extends Record<string, unknown>>(
  storageKey: string,
  keys?: (keyof S)[],
): Middleware<S> {
  return (_prev, _patch, next) => {
    try {
      const toSave = keys
        ? Object.fromEntries(keys.map((k) => [k, next[k]]))
        : next;
      localStorage.setItem(storageKey, JSON.stringify(toSave));
    } catch {
      // quota exceeded or security restriction — silently ignore
    }
  };
}

/** Hydrate initial state from localStorage. */
export function hydrateFromStorage<S extends Record<string, unknown>>(
  storageKey: string,
  defaults: S,
): S {
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return defaults;
    return { ...defaults, ...JSON.parse(raw) };
  } catch {
    return defaults;
  }
}
