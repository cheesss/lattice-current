# Lattice Current — 2026-04-27 Project Handoff

> **Status**: active. Supersedes `PROJECT_HANDOFF_2026-04-23.md` for current operating state. The 4-23 doc is still the architectural reference for OpenClaw + decision-engine internals.

This handoff covers the 14-commit sprint between 2026-04-26 ~ 2026-04-27 KST that fixed cascading data-pipeline staleness, activated the dormant ML inference layer, and closed 5 follow-on root-cause defects discovered through end-to-end audit.

---

## 1. TL;DR for the next agent

### What's running now (and must keep running)

| Daemon / server | Where | npm script |
|-----------------|-------|------------|
| `vite` (dashboard frontend) | `:3000` | `npm run dev` (now also spawns meta-model-server) |
| `event-dashboard-api.mjs` | `:46200` | bundled in `npm run dev` |
| `master-daemon.mjs` (39+ scheduled tasks) | foreground | `npm run daemon` |
| `data-accumulator.mjs` (warm yahoo/GDELT/FRED) | foreground | `npm run daemon:accumulator` |
| `meta-model-server.py` (FastAPI inference) | `:8100` | `npm run daemon:meta-model` (or auto-spawn via `npm run dev`) |
| `intelligence-scheduler.mjs` (theme automation) | foreground | `npm run intelligence:scheduler` |
| `openclaw gateway` | `:18789` | `openclaw gateway run` (external CLI) |
| `local-api-server.mjs` (sidecar) | `:46123` | `npm run sidecar:dev` |

If anything in column 2 stops, the dashboard either stops getting fresh data or stops scoring events.

### Root cause patterns we hit + permanent fixes

1. **Multi-daemon system, but no master launcher.** Operator restarts vite without restarting master-daemon → data goes stale silently. Fix: every daemon has an `npm run daemon:*` script + `dev-theme-shell.mjs` auto-spawns meta-model-server.
2. **Three parallel price stores** (`market_quotes` live / `worldmonitor_intel.historical_raw_items` warm / `market_returns` aggregate). Each fed by a different feeder. Stale on warm + aggregate broke labeling + uplift scoring even though dashboard display was fresh. Fix: `build-market-returns.py` registered in master-daemon (HOUR_6_MS), data-accumulator throughput bumped batch=30.
3. **Display filter > data cleanup.** Dashboard had 14k arXiv-style singleton events overwhelming Hot Events. Filtering at query time (`article_count >= 2 AND theme NOT LIKE 'dt-%'`) is faster and reversible than DELETE. Followed by selective dt-* DELETE for unambiguously-invalid auto-generated theme codes.

---

## 2. New scripts in this sprint

| Script | Purpose | Cadence |
|--------|---------|---------|
| `scripts/meta-model-server.py` (existing, now wired) | FastAPI GPU inference, port 8100 | continuous via `npm run dev` or `npm run daemon:meta-model` |
| `scripts/meta-model-infer.mjs` (new) | Pulls event_features rows w/o predictions → /predict/batch → model_predictions | master-daemon `meta-model-infer` task (HOUR_2_MS) |
| `scripts/calibrate-meta-model.py` (new) | Temperature scaling on validation NLL → sidecar JSON | manual (`npm run meta-model:calibrate`) or weekly post-train |
| `scripts/migrations/seed-theme-symbols-curation.mjs` (new) | Curates 41 themes × 5 symbols for auto_theme_symbols | one-shot, idempotent |
| `scripts/migrations/cleanup-dt-canonical-events.mjs` (new) | DELETE dt-[hex]+ themed canonical_events + child rows | one-shot, idempotent + dry-run |
| `scripts/migrations/add-articles-embedding-index.mjs` (new) | IVFFlat index on articles.embedding (idempotent) | one-shot |
| `scripts/_shared/dashboard-click-verify.mjs` (new) | Playwright 5-surface click regression (25 checks) | manual / pre-commit |
| `scripts/_shared/verify-ai-interactive.mjs` (new) | Playwright AI Lab interactivity (15 checks) | manual / pre-commit |

---

## 3. Master-daemon TASKS new entries

| Task | Interval | Notes |
|------|----------|-------|
| `build-market-returns` | HOUR_6_MS | Python `build-market-returns.py`. Bug fixed: PostgreSQL UPDATE FROM JOIN alias (mr.horizon = lo.horizon) had to move from JOIN-ON to WHERE. |
| `train-meta-model` | WEEK_1_MS | Python `train-meta-model.py`. Removed `--skip-if-fresh` flag (didn't exist in script). |
| `meta-model-infer` | HOUR_2_MS | New `scripts/meta-model-infer.mjs`. Reads model_registry for active model, fans out across (event × symbol × horizon), batched INSERT. |

`data-accumulator` is intentionally NOT a master-daemon task (each cycle is 5-10min, would block the whole daemon). Runs as its own continuous process.

---

## 4. ML pipeline (newly active)

```
┌────────────────────────────────────────────────────────────────────┐
│ TRAINING (weekly via master-daemon train-meta-model task)         │
│   train-meta-model.py → data/meta-vN-YYYYMMDD-HHMM.pt + model_eval│
└────────────────────────────────────────────────────────────────────┘
                              ↓
┌────────────────────────────────────────────────────────────────────┐
│ CALIBRATION (post-hoc, manual or post-train)                      │
│   calibrate-meta-model.py → data/<model>.calibration.json         │
│   (temperature scaling, ECE 0.10 → 0.06 on current model)         │
└────────────────────────────────────────────────────────────────────┘
                              ↓
┌────────────────────────────────────────────────────────────────────┐
│ REGISTRY (manual SQL insert per promoted model)                   │
│   model_registry: promotion_state IN ('candidate','shadow','active')│
└────────────────────────────────────────────────────────────────────┘
                              ↓
┌────────────────────────────────────────────────────────────────────┐
│ SERVING (continuous, port 8100)                                   │
│   meta-model-server.py loads .pt + .calibration.json on startup   │
│   /health returns {temperature, pre_ece, post_ece}                │
│   /predict + /predict/batch apply temperature post-sigmoid        │
└────────────────────────────────────────────────────────────────────┘
                              ↓
┌────────────────────────────────────────────────────────────────────┐
│ INFERENCE CRON (HOUR_2_MS)                                        │
│   meta-model-infer.mjs → batched POST + multi-row INSERT          │
│   model_predictions populates                                      │
└────────────────────────────────────────────────────────────────────┘
                              ↓
┌────────────────────────────────────────────────────────────────────┐
│ DASHBOARD                                                         │
│   /api/meta-model-health → Investigate surface calibration plot   │
└────────────────────────────────────────────────────────────────────┘
```

### Why model_registry was empty for 16 days
4-11 training session produced 5 v1 .pt files + 1 v2 .pt. v2 was deferred (overfit). v1 was good (Brier 0.18) but **promotion to model_registry was never automated** and the operator had paused the loop after seeing retrain regress calibration. Subsequent restarts skipped meta-model-server entirely (used `npm run dev` instead of `dev:full`). 4-22 environment restart bypassed both master-daemon and meta-model-server.

This sprint registered v1 manually + wired all 4 stages above.

---

## 5. Reliability fixes worth knowing

| Fix | Where | Why it matters |
|-----|-------|----------------|
| Worker loop crash on cycle error | `intelligence-automation.ts:3262` | Previous code exited do-while on any throw → process stayed alive but stopped scheduling. Matched the Apr 22 4-day silent zombie incident. Now wrapped in try/catch with exponential backoff. |
| Atomic JSON state writes | `intelligence-automation.ts:863` | `writeFile` → `writeFile(.tmp) + rename`. Prevents partial-write corruption when API server reads while scheduler writes the 263KB state. |
| pg Pool sizing | `event-dashboard-api.mjs:165` | max 6 → 20 (env-overridable), idle/connect timeouts. AI Lab added 7 endpoints; default was saturating. |
| Webhook HMAC | `openclaw-webhook-emitter.mjs:357` | Bearer token + new `x-lattice-signature: t=<ts>,v1=<hex>`. `verifyLatticeWebhookSignature()` helper exported with timing-safe compare + 300s replay window. |
| approval_queue constraint race | `_shared/schema-automation.mjs:55` | DROP+ADD was non-transactional, two parallel workers raced. Replaced with idempotent DO block. |
| Skeleton CSS bug | `event-dashboard.html` `.loading` rule | Selector was `.loading {...}` always. Now `.loading:not(:has(*))` so skeleton only shows for empty placeholders, not over rendered content. |
| Codex output bounded buffer | `_shared/codex-json.mjs:188` | New `CODEX_MAX_OUTPUT_BYTES=20MB` cap prevents OOM on runaway responses. SIGTERM child on overflow. |
| Hot Events filter | `_shared/event-intelligence-builder.mjs:62` | `article_count >= 2 AND theme NOT LIKE 'dt-%'` — kills singleton + dynamic-theme noise from display. 11 emerging-tech singletons → 2 multi-article events. |

---

## 6. Performance audit recommendations

These are documented but not all implemented. ROI ranking:

| # | Opportunity | Where | Effort | Speedup |
|---|-------------|-------|--------|---------|
| 1 | Multi-row INSERT in meta-model-infer | done in this sprint | — | 5-8x cycle time |
| 2 | Bounded buffer for codex spawn | done in this sprint | — | OOM prevention |
| 3 | Tab-hidden refresh pause | done in this sprint | — | reduces idle bandwidth + DB load |
| 4 | auto-pipeline step3 N+1 → CTE | `auto-pipeline.mjs:710-757` | medium | 10x labeling throughput |
| 5 | generate-embeddings parallelize via Python asyncio | `generate-embeddings.mjs` | small (2-3h) | 10-15x via concurrent Ollama calls |
| 6 | data-accumulator → Python aiohttp | `data-accumulator.mjs:165-204` | medium | 4-6x cycle time |
| 7 | trend-dashboard JS aggregation → SQL CTE | `_shared/trend-dashboard-queries.mjs:113-135` | small | 4x dashboard latency |

`incremental-event-engine.mjs` legacy version exists alongside `incremental_event_engine.py`. **Production already calls Python** (see `master-pipeline.mjs:295` and `proposal-executor.mjs:316`). The .mjs file is dev/legacy — do not run in production.

---

## 7. Known stale areas (cascading catchup, not bugs)

| Table | Latest | Cause | Recovery |
|-------|--------|-------|----------|
| `worldmonitor_intel.historical_raw_items` (yahoo-chart) | ~2026-04-02 | data-accumulator was off, now running batch=30 | Auto, ~4-6h |
| `market_returns` | ~2026-03-30 | warm yahoo dependency | Auto after warm yahoo |
| `labeled_outcomes` | ~2026-03-30 | warm yahoo dependency | Auto via auto-pipeline-labels (limit 1500/2h) |
| `event_uplift` recent 60d | ~99 rows | matched_controls dependency | Auto via incremental_event_engine.py |
| Latest E2 grade | 2026-03-17 (~41d) | All of above must catchup | Auto when chain unblocks |

**Trigger on demand**:
```bash
npm run daemon:accumulator:once       # one-shot warm yahoo refresh
npm run migrate:articles-embedding-index   # confirms IVFFlat index
npm run meta-model:infer              # writes model_predictions
npm run meta-model:calibrate          # re-tunes temperature
```

---

## 8. Open / deferred items

- **`auto_theme_symbols` long-tail** — 41/N themes mapped via curation. Auto-pipeline step 2 will gradually extend coverage as labeled_outcomes catches up. dt-* themes deliberately excluded.
- **silent catches across codebase (~30+)** — most annotated `non-fatal`, case-by-case review needed.
- **OpenClaw gateway upstream auth flow** — npm package, can't modify here. Workaround: `openclaw dashboard` to grab token, paste once.
- **Calibration drift retraining strategy** — current temperature scaling is post-hoc on the existing v1 model. The 4-12 handoff doc warns simple retrain regresses; regime-conditional architecture is the proper next ML PR.
- **emerging-tech 18,293 singletons** in canonical_events — display filter handles user impact, real arXiv data preserved.
- **HMAC verification on receiver side** — `verifyLatticeWebhookSignature()` helper exists; OpenClaw gateway as receiver doesn't call it (upstream code). In-repo plugin webhook handlers should adopt it.

---

## 9. Quick start for next agent

```bash
# 1. Bring up everything
npm run dev                    # vite + event-dashboard-api + meta-model-server
npm run daemon                 # master-daemon (40 scheduled tasks)
npm run daemon:accumulator     # warm yahoo/GDELT/FRED catchup loop
npm run intelligence:scheduler # theme automation (separate concern)

# 2. Health check
curl -s http://127.0.0.1:46200/api/health | jq
curl -s http://127.0.0.1:8100/health | jq    # meta-model temperature + ECE
curl -s http://127.0.0.1:46200/api/meta-model-health | jq

# 3. Run regressions
node scripts/_shared/verify-ai-interactive.mjs
node scripts/_shared/dashboard-click-verify.mjs

# 4. Read in this order if unfamiliar
docs/CLAUDE.md                        # rules + scripts table
docs/PROJECT_HANDOFF_2026-04-27.md    # this doc
docs/PROJECT_HANDOFF_2026-04-23.md    # OpenClaw + architectural
docs/SESSION_HANDOFF_2026-04-12.md    # meta-model design rationale
docs/CONNECTED_SYSTEM_WORKFLOW_DETAILED_EXPLAINED_2026-04-18.md  # data flow
```

If something is broken, **do not** start a fresh restart in dev mode without:

1. Checking master-daemon is alive: `tasklist | grep node` (look for ~700MB process)
2. Checking data-accumulator is alive (separate process)
3. Checking meta-model-server `/health` returns 200 with `temperature` field

If any of those are missing, the data pipeline silently degrades over hours. `npm run dev` only spawns vite + API + meta-model-server. Master-daemon and data-accumulator must be started separately.
