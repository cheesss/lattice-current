# Worker Entry Points

This folder contains browser worker entry files.

## Current workers

- `analysis.worker.ts`
  - offloads heavier analytical tasks from the main thread
- `ml.worker.ts`
  - ML-related worker path
- `vector-db.ts`
  - worker-side vector/index support

## Design philosophy

- Worker files should be thin entry points.
- Put reusable algorithms in `src/services/` or `src/utils/`, then import them into workers.
- Keep serialization boundaries explicit. Structured clone issues are a common source of worker bugs.

## When to use a worker

Use a worker when the task is CPU-heavy, repeatable, and does not need tight DOM coupling.
