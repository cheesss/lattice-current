/**
 * Vitest global setup.
 *
 * Provides minimal browser-API stubs so unit tests that import
 * DOM-dependent modules don't crash in JSDOM.
 */

// Stub localStorage (JSDOM has it, but ensure it's clean)
beforeEach(() => {
  localStorage.clear();
});

// Stub performance.now() if missing
if (typeof globalThis.performance === 'undefined') {
  (globalThis as Record<string, unknown>).performance = {
    now: () => Date.now(),
  };
}

// Stub matchMedia
if (typeof window !== 'undefined' && !window.matchMedia) {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }),
  });
}

// Stub ResizeObserver
if (typeof window !== 'undefined' && !window.ResizeObserver) {
  (window as Record<string, unknown>).ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}
