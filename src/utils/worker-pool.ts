/**
 * Generic Worker Pool
 *
 * Manages a pool of Web Workers for parallel computation offloading.
 * Supports:
 *  - Configurable pool size (defaults to navigator.hardwareConcurrency - 1)
 *  - Task queuing with backpressure
 *  - Automatic worker recycling after N tasks
 *  - Typed request/response messages
 *
 * Usage:
 *   const pool = new WorkerPool(() => new Worker(url), { size: 4 });
 *   const result = await pool.exec({ type: 'compute', data: [...] });
 *   pool.terminate();
 */

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface WorkerPoolOptions {
  /** Number of workers. Defaults to hardwareConcurrency - 1, minimum 1. */
  size?: number;
  /** Recycle a worker after this many tasks. 0 = never recycle. */
  recycleAfter?: number;
  /** Name for logging purposes. */
  name?: string;
}

interface QueuedTask<Req, Res> {
  payload: Req;
  resolve: (value: Res) => void;
  reject: (reason: unknown) => void;
  timeoutId?: ReturnType<typeof setTimeout>;
}

interface PoolWorker {
  worker: Worker;
  busy: boolean;
  taskCount: number;
}

/* ------------------------------------------------------------------ */
/*  Pool implementation                                                */
/* ------------------------------------------------------------------ */

export class WorkerPool<Req = unknown, Res = unknown> {
  private readonly factory: () => Worker;
  private readonly poolSize: number;
  private readonly recycleAfter: number;
  private readonly name: string;

  private workers: PoolWorker[] = [];
  private queue: QueuedTask<Req, Res>[] = [];
  private terminated = false;

  constructor(factory: () => Worker, options: WorkerPoolOptions = {}) {
    this.factory = factory;
    this.poolSize = Math.max(1, options.size ?? (navigator?.hardwareConcurrency ?? 4) - 1);
    this.recycleAfter = options.recycleAfter ?? 0;
    this.name = options.name ?? 'WorkerPool';

    // Pre-create workers
    for (let i = 0; i < this.poolSize; i++) {
      this.workers.push(this.createWorker());
    }
  }

  /**
   * Submit a task and wait for its result.
   * If all workers are busy, the task is queued.
   */
  exec(payload: Req, timeoutMs = 30_000): Promise<Res> {
    if (this.terminated) return Promise.reject(new Error(`[${this.name}] Pool is terminated`));

    return new Promise<Res>((resolve, reject) => {
      const task: QueuedTask<Req, Res> = { payload, resolve, reject };

      if (timeoutMs > 0) {
        task.timeoutId = setTimeout(() => {
          // Remove from queue if still queued
          const idx = this.queue.indexOf(task);
          if (idx >= 0) this.queue.splice(idx, 1);
          reject(new Error(`[${this.name}] Task timed out after ${timeoutMs}ms`));
        }, timeoutMs);
      }

      this.queue.push(task);
      this.dispatch();
    });
  }

  /** Number of pending (queued + in-flight) tasks. */
  get pending(): number {
    return this.queue.length + this.workers.filter((w) => w.busy).length;
  }

  /** Number of idle workers. */
  get idle(): number {
    return this.workers.filter((w) => !w.busy).length;
  }

  /** Terminate all workers and reject pending tasks. */
  terminate(): void {
    this.terminated = true;
    for (const pw of this.workers) {
      pw.worker.terminate();
    }
    this.workers = [];
    for (const task of this.queue) {
      if (task.timeoutId) clearTimeout(task.timeoutId);
      task.reject(new Error(`[${this.name}] Pool terminated`));
    }
    this.queue = [];
  }

  /* ---- internals ---- */

  private createWorker(): PoolWorker {
    const worker = this.factory();
    return { worker, busy: false, taskCount: 0 };
  }

  private dispatch(): void {
    if (this.queue.length === 0) return;

    const available = this.workers.find((w) => !w.busy);
    if (!available) return;

    const task = this.queue.shift()!;
    if (task.timeoutId) clearTimeout(task.timeoutId);

    available.busy = true;
    available.taskCount++;

    const onMessage = (e: MessageEvent) => {
      cleanup();
      available.busy = false;
      this.maybeRecycle(available);
      task.resolve(e.data as Res);
      this.dispatch();
    };

    const onError = (e: ErrorEvent) => {
      cleanup();
      available.busy = false;
      this.maybeRecycle(available);
      task.reject(e.error ?? new Error(e.message));
      this.dispatch();
    };

    const cleanup = () => {
      available.worker.removeEventListener('message', onMessage);
      available.worker.removeEventListener('error', onError as EventListener);
    };

    available.worker.addEventListener('message', onMessage);
    available.worker.addEventListener('error', onError as EventListener);
    available.worker.postMessage(task.payload);
  }

  private maybeRecycle(pw: PoolWorker): void {
    if (this.recycleAfter > 0 && pw.taskCount >= this.recycleAfter) {
      pw.worker.terminate();
      const idx = this.workers.indexOf(pw);
      if (idx >= 0) {
        this.workers[idx] = this.createWorker();
      }
    }
  }
}
