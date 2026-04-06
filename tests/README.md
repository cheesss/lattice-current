# Test Suite Layout

This folder is organized by behavior, not by source tree.

## Main test groups

- bootstrap and hydration
- cache / Redis / TTL behavior
- smart polling and runtime scheduling
- math models
- service logic
- edge/server handler parity
- replay/backtest pipeline behavior
- deployment/security guardrails

## How to use the suite

- If you change caching, start with:
  - `bootstrap.test.mjs`
  - `route-cache-tier.test.mjs`
  - `redis-caching.test.mjs`
- If you change polling/runtime behavior:
  - `smart-poll-loop.test.mjs`
  - `flush-stale-refreshes.test.mjs`
  - `windows-spawn-guardrails.test.mjs`
- If you change daemon cadence, runtime health, or observability:
  - `master-daemon-guardrails.test.mjs`
  - `runtime-observability.test.mjs`
- If you change panel defaults, workspace emphasis, or product-surface wording:
  - `signal-product-surface.test.mjs`
- If you change live idea/admission wiring:
  - `idea-runtime-context.test.mjs`
  - `is1-orchestrator-wiring.test.mjs`
- If you change analytics:
  - `math-models.test.mjs`
  - `phase5-service-logic.test.mjs`
- If you change replay/backtest:
  - `evaluation-pipeline.test.mjs`
  - `storage-envelope.test.mjs`
  - `hot-warm-migrator.test.mjs`

## Design philosophy

- Tests encode architectural contracts, not only happy paths.
- Many tests protect parity between bootstrap, route handlers, cache keys, and UI consumers.
- When a test looks overly specific, it is often guarding a regression that already happened.

## Path policy

- Tests must resolve modules and source files from the current workspace root.
- Do not hardcode `/tmp/eval-build`, `/sessions/...`, or machine-specific absolute paths.
- Use [tests/_workspace-paths.mjs](/C:/Users/chohj/Documents/Playground/lattice-current-fix/tests/_workspace-paths.mjs) for workspace-relative module URLs and file paths.
- Browser-facing modules must not statically import Node-only dependencies such as `pg`, DuckDB bindings, or NAS ingestion modules. Put those behind a runtime bridge or sidecar endpoint and add a guardrail test for that boundary.
- Windows runtime launchers and sidecar job runners must avoid visible console windows for background work. Prefer direct executable invocation over `shell: true`, and add `windowsHide: true` where background jobs are expected.
- Sidecar route tests must not start long-lived scheduler/accumulator children. Use `backgroundAutomationEnabled: false` for isolated route tests.

## Completion policy

- Do not treat a collector, cache writer, or storage migration as complete in isolation.
- Verification should cover `collect -> store -> load -> frame -> signal/output` whenever a pipeline path changes.
- When a test depends on rule thresholds or sizing ladders, derive expectations from the current exported constants instead of freezing old numeric cutoffs in the test body.
- CI on this branch is organized by signal-first contracts. Keep new tests aligned with those groups instead of adding one more ad-hoc CI command.

## Before deleting a test

Find the original regression or contract first. Removing parity tests in this codebase usually reintroduces drift between layers.
