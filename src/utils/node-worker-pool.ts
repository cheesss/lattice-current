/**
 * Node.js Worker Thread Pool
 *
 * Mirrors the API of WorkerPool (Web Workers) but uses Node.js worker_threads.
 * Designed for CPU-bound computation offloading during backtest replay.
 *
 * Usage:
 *   const pool = new NodeWorkerPool<Req, Res>('./path/to/worker.ts', { size: 4 });
 *   const result = await pool.exec({ type: 'compute', data: [...] });
 *   pool.terminate();
 */

import { Worker } from 'node:worker_threads';
import { cpus } from 'node:os';

export interface NodeWorkerPoolOptions {
  /** Number of workers. Defaults to os.cpus().length - 1, minimum 1. */
  size?: number;
  /** Recycle a worker after this many tasks. 0 = never recycle. */
  recycleAfter?: number;
  /** Name for logging purposes. */
  name?: string;
  /** Extra workerData passed to each worker on creation. */
  workerData?: unknown;
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

export class NodeWorkerPool<Req = unknown, Res = unknown> {
  private readonly workerPath: string | URL;
  private readonly poolSize: number;
  private readonly recycleAfter: number;
  private readonly name: string;
  private readonly workerData: unknown;

  private workers: PoolWorker[] = [];
  private queue: QueuedTask<Req, Res>[] = [];
  private terminated = false;

  constructor(workerPath: string | URL, options: NodeWorkerPoolOptions = {}) {
    this.workerPath = workerPath;
    this.poolSize = Math.max(1, options.size ?? cpus().length - 1);
    this.recycleAfter = options.recycleAfter ?? 0;
    this.name = options.name ?? 'NodeWorkerPool';
    this.workerData = options.workerData;

    for (let i = 0; i < this.poolSize; i++) {
      this.workers.push(this.createWorker());
    }
  }

  exec(payload: Req, timeoutMs = 30_000): Promise<Res> {
    if (this.terminated) return Promise.reject(new Error(`[${this.name}] Pool is terminated`));

    return new Promise<Res>((resolve, reject) => {
      const task: QueuedTask<Req, Res> = { payload, resolve, reject };

      if (timeoutMs > 0) {
        task.timeoutId = setTimeout(() => {
          const idx = this.queue.indexOf(task);
          if (idx >= 0) this.queue.splice(idx, 1);
          reject(new Error(`[${this.name}] Task timed out after ${timeoutMs}ms`));
        }, timeoutMs);
      }

      this.queue.push(task);
      this.dispatch();
    });
  }

  /** Submit a batch of tasks and wait for all results. */
  execBatch(payloads: Req[], timeoutMs = 60_000): Promise<Res[]> {
    return Promise.all(payloads.map((p) => this.exec(p, timeoutMs)));
  }

  get pending(): number {
    return this.queue.length + this.workers.filter((w) => w.busy).length;
  }

  get idle(): number {
    return this.workers.filter((w) => !w.busy).length;
  }

  get size(): number {
    return this.poolSize;
  }

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
    const worker = new Worker(this.workerPath, {
      workerData: this.workerData,
      // Use tsx loader for TypeScript workers
      execArgv: ['--import', 'tsx'],
    });
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

    const onMessage = (data: Res) => {
      cleanup();
      available.busy = false;
      this.maybeRecycle(available);
      task.resolve(data);
      this.dispatch();
    };

    const onError = (error: Error) => {
      cleanup();
      available.busy = false;
      this.maybeRecycle(available);
      task.reject(error);
      this.dispatch();
    };

    const cleanup = () => {
      available.worker.removeListener('message', onMessage);
      available.worker.removeListener('error', onError);
    };

    available.worker.on('message', onMessage);
    available.worker.on('error', onError);
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
