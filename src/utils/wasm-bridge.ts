/**
 * WASM Bridge — Infrastructure for loading and calling WebAssembly numeric modules.
 *
 * Provides a typed, lazy-loading bridge between TypeScript and compiled WASM
 * modules (Rust/C → .wasm). Designed for hot-path math:
 *  - Matrix operations for RMT correlation cleaning
 *  - HMM forward-backward algorithm
 *  - Kalman filter state estimation
 *  - Transfer entropy computation
 *
 * Usage:
 *   const mod = await loadWasmModule<MatrixOps>('matrix-ops');
 *   const result = mod.eigenvalues(flatData, rows, cols);
 *
 * Falls back to JS implementations when WASM is unavailable.
 */

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface WasmModuleConfig {
  /** Module identifier (used for caching). */
  id: string;
  /** URL or path to the .wasm file. */
  wasmUrl: string;
  /** Optional JS glue script URL. */
  jsGlueUrl?: string;
  /** Expected memory pages (64 KB each). */
  memoryPages?: number;
}

export interface WasmModuleHandle<T> {
  /** The exported WASM functions. */
  exports: T;
  /** Allocated memory (for manual buffer management). */
  memory: WebAssembly.Memory;
  /** Free the module. */
  dispose(): void;
}

type WasmExports = Record<string, (...args: number[]) => number>;

/* ------------------------------------------------------------------ */
/*  Module cache                                                       */
/* ------------------------------------------------------------------ */

const _cache = new Map<string, Promise<WasmModuleHandle<WasmExports>>>();

/* ------------------------------------------------------------------ */
/*  Public API                                                         */
/* ------------------------------------------------------------------ */

/**
 * Load a WASM module by config. Returns cached instance on subsequent calls.
 */
export async function loadWasmModule<T extends WasmExports = WasmExports>(
  config: WasmModuleConfig,
): Promise<WasmModuleHandle<T>> {
  const cached = _cache.get(config.id);
  if (cached) return cached as Promise<WasmModuleHandle<T>>;

  const promise = instantiateModule<T>(config);
  _cache.set(config.id, promise as Promise<WasmModuleHandle<WasmExports>>);

  // Remove from cache on error so caller can retry
  promise.catch(() => _cache.delete(config.id));

  return promise;
}

/**
 * Check if WASM is supported in the current environment.
 */
export function isWasmSupported(): boolean {
  try {
    if (typeof WebAssembly !== 'object') return false;
    // Test instantiation with a minimal module (magic + version bytes)
    const mod = new WebAssembly.Module(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]));
    return mod instanceof WebAssembly.Module;
  } catch {
    return false;
  }
}

/**
 * Unload a specific module from cache.
 */
export function unloadWasmModule(id: string): void {
  const cached = _cache.get(id);
  if (cached) {
    cached.then((h) => h.dispose()).catch(() => {});
    _cache.delete(id);
  }
}

/**
 * Unload all cached modules.
 */
export function unloadAllWasmModules(): void {
  for (const [id] of _cache) {
    unloadWasmModule(id);
  }
}

/* ------------------------------------------------------------------ */
/*  Memory helpers                                                     */
/* ------------------------------------------------------------------ */

/**
 * Copy a Float64Array into WASM linear memory and return the byte offset.
 * Caller is responsible for freeing (or using a bump allocator).
 */
export function copyToWasmMemory(
  memory: WebAssembly.Memory,
  data: Float64Array,
  offset: number,
): void {
  const view = new Float64Array(memory.buffer, offset, data.length);
  view.set(data);
}

/**
 * Read a Float64Array from WASM linear memory.
 */
export function readFromWasmMemory(
  memory: WebAssembly.Memory,
  offset: number,
  length: number,
): Float64Array {
  return new Float64Array(memory.buffer, offset, length).slice();
}

/* ------------------------------------------------------------------ */
/*  Internal                                                           */
/* ------------------------------------------------------------------ */

async function instantiateModule<T extends WasmExports>(
  config: WasmModuleConfig,
): Promise<WasmModuleHandle<T>> {
  if (!isWasmSupported()) {
    throw new Error(`[wasm-bridge] WebAssembly not supported in this environment`);
  }

  const memory = new WebAssembly.Memory({
    initial: config.memoryPages ?? 256,
    maximum: 1024,
  });

  const importObject: WebAssembly.Imports = {
    env: {
      memory,
      abort: () => { throw new Error('WASM abort'); },
      log_f64: (v: number) => console.log(`[wasm:${config.id}]`, v),
    },
  };

  let instance: WebAssembly.Instance;

  if (typeof WebAssembly.instantiateStreaming === 'function') {
    const result = await WebAssembly.instantiateStreaming(
      fetch(config.wasmUrl),
      importObject,
    );
    instance = result.instance;
  } else {
    const response = await fetch(config.wasmUrl);
    const bytes = await response.arrayBuffer();
    const result = await WebAssembly.instantiate(bytes, importObject);
    instance = result.instance;
  }

  const exports = instance.exports as unknown as T;
  let disposed = false;

  return {
    exports,
    memory,
    dispose() {
      if (disposed) return;
      disposed = true;
      _cache.delete(config.id);
    },
  };
}
