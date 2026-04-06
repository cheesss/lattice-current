# Lattice Current Maturity Upgrade Plan

Date: 2026-04-06  
Product identity: signal-first decision-support workspace  
Legacy grade at kickoff: B-  
Target grade: A

## Current grading frame

Main-branch maturity is now judged as a signal-first decision-support system.

- signal chain transparency matters more than legacy ML sophistication
- replay and walk-forward remain validation layers, not the product identity
- the two primary remaining gaps are:
  - CI breadth across signal-first contracts
  - runtime observability across daemon, local services, and route coverage

## Scope

This document tracks the maturity upgrade for the current main branch.

It is not a backtest-first plan. Replay, walk-forward evaluation, NAS-backed historical data, and portfolio validation remain in scope only when they prove that signal intake, event resolution, operator support, and automation are reliable.

## Completion rules

Do not mark an item complete because code exists or because a script printed a row count.

An item is complete only when all of the following are true:

1. The code path is wired into the active runtime.
2. The path is exercised end to end at least once.
3. The result is captured in data, logs, or a durable table.
4. A regression command exists and is documented.
5. The outcome is reflected in the canonical docs and runbooks.

## Status summary

| Stage | Goal | Status | Notes |
| --- | --- | --- | --- |
| Stage 1 | prove signal UI and end-to-end flow actually run | Completed | `npm run dev`, `verify-e2e`, and runtime bridge work landed earlier in this thread |
| Stage 2 | upgrade data, article analysis, theme classification, and signal support quality | Mostly completed | fast keyword extraction, article analysis persistence, full theme classification, and generic theme-symbol scoring are live |
| Stage 3 | make automation and daemon paths operable | Partially completed | daemon state, circuit breaker, pending-outcome execution, and PM2 config exist; long-run validation still pending |
| Stage 4 | close the gap with tests, CI, observability, UI fallback behavior, and operator docs | In progress | CI breadth and runtime observability are now the main blockers to an A grade |

## Resilience and quality overlay

After the original maturity pass, the branch also received a resilience-focused
upgrade. That work closed several operational gaps that were previously keeping
Stage 3 and Stage 4 partial even when the feature logic itself existed.

Implemented in that overlay:

- daemon tasks for:
  - `db-health`
  - `daily-backup`
  - `duckdb-sync`
  - `data-quality`
- shared resilience helpers:
  - `pg-backup.mjs`
  - `schema-constraints.mjs`
  - `data-quality-check.mjs`
  - `alert-notifier.mjs`
- durable retry and dead-letter handling in `proposal-executor.mjs`
- new observability routes:
  - `/api/data-quality`
  - `/api/codex-quality`
- Codex call budgeting and Codex quality metrics persistence

This means the branch is no longer only "feature-capable but weakly inspectable".
It now has a stronger operational contract around failure durability and quality
visibility. The remaining maturity gap is burn-in and broader coverage, not the
absence of resilience primitives.

## Executed work

### Stage 1: foundation proof

Completed earlier in this thread:

- signal-first panel surface was re-ordered and replay moved behind validation-oriented labels
- Windows background spawns were hardened to stop transient `cmd.exe` / PowerShell windows
- NAS-backed replay loading and event resolution paths were validated end to end
- completion criteria were added to:
  - [C:\Users\chohj\Documents\Playground\lattice-current-fix\docs\TEST_OPERATIONS_RUNBOOK.md](/C:/Users/chohj/Documents/Playground/lattice-current-fix/docs/TEST_OPERATIONS_RUNBOOK.md)
  - [C:\Users\chohj\Documents\Playground\lattice-current-fix\scripts\README.md](/C:/Users/chohj/Documents/Playground/lattice-current-fix/scripts/README.md)

### Stage 2: data + AI quality

Completed:

- shared runtime/schema helpers were created under [C:\Users\chohj\Documents\Playground\lattice-current-fix\scripts\_shared](/C:/Users/chohj/Documents/Playground/lattice-current-fix/scripts/_shared)
- [C:\Users\chohj\Documents\Playground\lattice-current-fix\scripts\fast-keyword-extractor.mjs](/C:/Users/chohj/Documents/Playground/lattice-current-fix/scripts/fast-keyword-extractor.mjs) now backfills durable `article_analysis` rows and aggregates `auto_trend_keywords`
- [C:\Users\chohj\Documents\Playground\lattice-current-fix\scripts\ollama-article-analyzer.mjs](/C:/Users/chohj/Documents/Playground/lattice-current-fix/scripts/ollama-article-analyzer.mjs) was rewritten to use canonical env config and ambiguity-driven selection
- `ollama-article-analyzer` output is headline-grounded to avoid prompt contamination keywords
- [C:\Users\chohj\Documents\Playground\lattice-current-fix\scripts\auto-pipeline.mjs](/C:/Users/chohj/Documents/Playground/lattice-current-fix/scripts/auto-pipeline.mjs) now supports multiple `--step` flags correctly
- auto theme-symbol mapping now writes:
  - `auto_theme_symbol_candidates`
  - `auto_theme_symbols`
- generic volatility/noise filtering was replaced with outcome-aware scoring via [C:\Users\chohj\Documents\Playground\lattice-current-fix\scripts\_shared\theme-symbol-quality.mjs](/C:/Users/chohj/Documents/Playground/lattice-current-fix/scripts/_shared/theme-symbol-quality.mjs)

Validated results:

- `article_analysis`
  - `fast-keyword-extractor`: `60,648`
  - `ollama-article-analyzer`: `70`
- `auto_trend_keywords`
  - `fast-keyword-extractor`: `424`
  - `ollama-article-analyzer`: `178`
- full theme classification reached only `41` unknown rows in the executed run
- accepted theme-symbol mappings increased from `0` to `19`

Important interpretation:

- Step 4 reporting `explanationsGenerated = 0` is not currently a bug.
- Verification against NAS PostgreSQL showed:
  - `event_impact_profiles` exists
  - `event_impact_profiles` row count: `618,402`
  - rows missing `causal_explanation`: `0`
- Current behavior is therefore "no missing explanations to generate", not "generator failed silently".

### Stage 3: automation and daemon hardening

Completed:

- [C:\Users\chohj\Documents\Playground\lattice-current-fix\scripts\master-daemon.mjs](/C:/Users/chohj/Documents/Playground/lattice-current-fix/scripts/master-daemon.mjs) was rewritten with:
  - durable daemon state
  - circuit breaker behavior
  - `pending-check` that actually executes `checkPendingOutcomes()`
  - `dashboard-health` task
  - unhandled rejection / exception logging
- [C:\Users\chohj\Documents\Playground\lattice-current-fix\ecosystem.config.cjs](/C:/Users/chohj/Documents/Playground/lattice-current-fix/ecosystem.config.cjs) was added for PM2

Validated:

- `pending-check` ran successfully and wrote state
- `dashboard-health` writes state as expected
- current recorded state after re-check:
  - `health.dashboard.ok = true`
  - payload includes `status = ok`
- daemon schedule is now defined once in:
  - [C:\Users\chohj\Documents\Playground\lattice-current-fix\scripts\_shared\daemon-contract.mjs](/C:/Users/chohj/Documents/Playground/lattice-current-fix/scripts/_shared/daemon-contract.mjs)
- daemon state is now summarized through:
  - [C:\Users\chohj\Documents\Playground\lattice-current-fix\scripts\_shared\runtime-observability.mjs](/C:/Users/chohj/Documents/Playground/lattice-current-fix/scripts/_shared/runtime-observability.mjs)
- the local sidecar exposes a canonical runtime health surface:
  - `/api/local-runtime-observability`

Interpretation:

- the daemon path works
- dashboard health is now durable and visible through the runtime observability contract
- Stage 3 is structurally implemented and operationally inspectable
- remaining work is burn-in and alerting, not basic visibility

### Stage 4: tests and operator-facing docs

Completed:

- new tests landed for:
  - [C:\Users\chohj\Documents\Playground\lattice-current-fix\tests\fast-keyword-extractor.test.mjs](/C:/Users/chohj/Documents/Playground/lattice-current-fix/tests/fast-keyword-extractor.test.mjs)
  - [C:\Users\chohj\Documents\Playground\lattice-current-fix\tests\auto-pipeline.test.mjs](/C:/Users/chohj/Documents/Playground/lattice-current-fix/tests/auto-pipeline.test.mjs)
  - [C:\Users\chohj\Documents\Playground\lattice-current-fix\tests\master-daemon-guardrails.test.mjs](/C:/Users/chohj/Documents/Playground/lattice-current-fix/tests/master-daemon-guardrails.test.mjs)
  - [C:\Users\chohj\Documents\Playground\lattice-current-fix\tests\runtime-observability.test.mjs](/C:/Users/chohj/Documents/Playground/lattice-current-fix/tests/runtime-observability.test.mjs)
  - [C:\Users\chohj\Documents\Playground\lattice-current-fix\tests\idea-runtime-context.test.mjs](/C:/Users/chohj/Documents/Playground/lattice-current-fix/tests/idea-runtime-context.test.mjs)
  - [C:\Users\chohj\Documents\Playground\lattice-current-fix\tests\is1-orchestrator-wiring.test.mjs](/C:/Users/chohj/Documents/Playground/lattice-current-fix/tests/is1-orchestrator-wiring.test.mjs)
- this document and the new user guide now record the executed state
- CI now enforces signal-first contract groups instead of a single small ad-hoc test command:
  - `typecheck-build`
  - `core-contracts`
  - `data-integrity-contracts`
  - `coverage-report`
- calibration and dashboard health now have explicit runtime contracts:
  - `GET /api/calibration`
  - `GET /api/health` with `compositeScore`, `status`, and component scores
- script contract tests now cover:
  - import-safe `auto-pipeline` dry-run parsing and threshold behavior
  - import-safe `event-engine` schema and helper math

Validated:

- `npm run test:ci:core`
- `npm run test:ci:data-integrity`
- `npm run test:ci:coverage`
- `npm run typecheck`
- `npm run build`

Operational guardrails added:

- importable scripts must not require secrets or open DB connections at module load time
- CLI scripts must not execute `main()` when imported under `node --test`
- new signal/runtime observability work must land in the canonical CI subsets, not only `test:data`

Still pending:

- longer-run daemon burn-in
- UI fallback verification under empty-data and stale-data conditions
- alerting beyond local inspection

## Remaining gaps before A grade

### Stage 3 remaining

The following are still required before Stage 3 can be considered complete:

1. run the daemon under PM2 for an extended window
2. confirm memory and failure behavior under normal load
3. prove dashboard health recovery or restart behavior
4. prove that real-time article flow updates `pending_outcomes`, `signal_history`, and downstream operator surfaces without manual intervention

### Stage 4 remaining

The following are still open:

1. verify UI fallback behavior when APIs are empty or stale
2. execute longer real-time flow validation
3. add durable alert hooks on top of runtime observability
4. document exact operator workflows now that the branch is signal-first

## Recommended command set

These are the commands that currently define the upgrade status:

```bash
npm run typecheck
npm run build
npm run test:ci:signal-runtime
npm run test:ci:ops-observability
node --import tsx scripts/fast-keyword-extractor.mjs --limit 60000
node --import tsx scripts/auto-pipeline.mjs --step 2 --limit 60000
node --import tsx scripts/ollama-article-analyzer.mjs --mode ambiguous --confidence-threshold 0.45 --limit 20
node --import tsx scripts/master-daemon.mjs --once --task pending-check
node --import tsx scripts/master-daemon.mjs --once --task dashboard-health
```

PowerShell runtime observability smoke:

```powershell
Invoke-WebRequest -UseBasicParsing http://127.0.0.1:46123/api/local-runtime-observability | Select-Object -Expand Content
```

## Guardrails added by this upgrade

- do not treat "row count exists" as feature completion
- do not ship source-specific theme-symbol patches where generic quality scoring is required
- do not hide operational failure behind successful script exits
- do not call a daemon ready until task state, failures, and health are durable and inspectable
- do not create a second health view with a different severity model; reuse the canonical runtime observability contract
- do not call AI analysis complete unless outputs are grounded and stored in canonical tables

## Canonical follow-up docs

- [C:\Users\chohj\Documents\Playground\lattice-current-fix\docs\USER_GUIDE.md](/C:/Users/chohj/Documents/Playground/lattice-current-fix/docs/USER_GUIDE.md)
- [C:\Users\chohj\Documents\Playground\lattice-current-fix\docs\ARCHITECTURE.md](/C:/Users/chohj/Documents/Playground/lattice-current-fix/docs/ARCHITECTURE.md)
- [C:\Users\chohj\Documents\Playground\lattice-current-fix\docs\TEST_OPERATIONS_RUNBOOK.md](/C:/Users/chohj/Documents/Playground/lattice-current-fix/docs/TEST_OPERATIONS_RUNBOOK.md)
- [C:\Users\chohj\Documents\Playground\lattice-current-fix\scripts\README.md](/C:/Users/chohj/Documents/Playground/lattice-current-fix/scripts/README.md)
