import { describe, it, expect, vi } from 'vitest';
import { createStore, loggerMiddleware } from './observable-store';

describe('ObservableStore', () => {
  it('returns initial state via get()', () => {
    const store = createStore({ count: 0, label: 'hi' });
    expect(store.get()).toEqual({ count: 0, label: 'hi' });
  });

  it('merges partial updates', () => {
    const store = createStore({ a: 1, b: 2 });
    store.set({ a: 10 });
    expect(store.get().a).toBe(10);
    expect(store.get().b).toBe(2);
  });

  it('accepts updater function', () => {
    const store = createStore({ count: 5 });
    store.set((prev) => ({ count: prev.count + 1 }));
    expect(store.get().count).toBe(6);
  });

  it('notifies subscribers on change', () => {
    const store = createStore({ x: 0 });
    const spy = vi.fn();
    store.subscribe((s) => s.x, spy);
    store.set({ x: 42 });
    expect(spy).toHaveBeenCalledWith(42, expect.objectContaining({ x: 42 }));
  });

  it('does not notify when selected value is unchanged', () => {
    const store = createStore({ x: 1, y: 2 });
    const spy = vi.fn();
    store.subscribe((s) => s.x, spy);
    store.set({ y: 99 }); // x didn't change
    expect(spy).not.toHaveBeenCalled();
  });

  it('unsubscribes correctly', () => {
    const store = createStore({ v: 0 });
    const spy = vi.fn();
    const unsub = store.subscribe((s) => s.v, spy);
    unsub();
    store.set({ v: 100 });
    expect(spy).not.toHaveBeenCalled();
  });

  it('batches multiple set calls into one notification', () => {
    const store = createStore({ a: 0, b: 0 });
    const spy = vi.fn();
    store.subscribe((s) => s, spy);

    store.batch(() => {
      store.set({ a: 1 });
      store.set({ b: 2 });
    });

    // Only called once (after batch)
    expect(spy).toHaveBeenCalledTimes(1);
    expect(store.get()).toEqual({ a: 1, b: 2 });
  });

  it('middleware is invoked on set', () => {
    const store = createStore({ n: 0 });
    const mwSpy = vi.fn();
    store.use(mwSpy);
    store.set({ n: 5 });
    expect(mwSpy).toHaveBeenCalledTimes(1);
    expect(mwSpy).toHaveBeenCalledWith(
      expect.objectContaining({ n: 0 }),
      { n: 5 },
      expect.objectContaining({ n: 5 }),
    );
  });

  it('middleware can be removed', () => {
    const store = createStore({ n: 0 });
    const mwSpy = vi.fn();
    const remove = store.use(mwSpy);
    remove();
    store.set({ n: 1 });
    expect(mwSpy).not.toHaveBeenCalled();
  });

  it('destroy clears all subscriptions', () => {
    const store = createStore({ v: 0 });
    const spy = vi.fn();
    store.subscribe((s) => s.v, spy);
    store.destroy();
    store.set({ v: 999 });
    expect(spy).not.toHaveBeenCalled();
  });

  it('get(selector) returns selected slice', () => {
    const store = createStore({ a: 10, b: 20 });
    expect(store.get((s) => s.b)).toBe(20);
  });

  it('loggerMiddleware does not throw', () => {
    const store = createStore({ x: 0 });
    store.use(loggerMiddleware('test'));
    expect(() => store.set({ x: 1 })).not.toThrow();
  });
});
