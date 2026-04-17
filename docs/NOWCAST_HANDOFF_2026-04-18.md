# Nowcast Implementation — Handoff

Date: 2026-04-18 KST
Status: **v1 in code, gated and tested — production activation pending**
Predecessor: [NOWCAST_PLAN_ISSUES_2026-04-17.md](./NOWCAST_PLAN_ISSUES_2026-04-17.md)

## 1. One-Line State

Architecture is committed as 3 commits on the current branch. Code paths run end-to-end and the pure logic is covered by 77 unit tests. **No NAS migration has been executed yet, no models have been trained, master-daemon has not been restarted.**

## 2. Commit Map (chronological)

```
8bce577b  nowcast P1 fixes: gate enforcement + end-to-end tests
746a0e58  nowcast phase 1-5: Tier 2 gap-fill + reconciliation + source gate + registry
62825c96  nowcast phase 0-0.6: semantic contract + source hygiene foundation
40745017  feat: source proposal ingestion redesign — Phase 0-6  (pre-existing baseline)
```

## 3. What Landed in Code

### Phase 0 — semantic contract
- `scripts/event-dashboard-api.mjs`
  - `MODE_STALE_THRESHOLD_HOURS` extended with `nowcast:6`, `imputed:12`, `composite:12`, `mirrored:0`, `backfill:null`, `replay:null`
  - `inferResponseMode` whitelists 10 modes, unknown modes fall back to `live`
  - `deriveResponseMeta` derives `valueOrigin` (observed / estimated / research) and `validAsOf`; mirrored mode forces stale

### Phase 0.5 — signal_history origin tagging
- Migrations (not executed): `scripts/migrations/add-signal-history-origin.mjs`, `tag-legacy-derived-signals.mjs`
- Writer helper: `scripts/_shared/signal-history-writer.mjs`
- Writers routed through helper: `refresh-fred-signals-to-nas.mjs`, `refresh-market-quotes-to-nas.mjs`, `refresh-event-market-transmission.mjs`, `master-pipeline.mjs` STEP 0 (GDELT proxies marked `value_origin='proxy'`), `backfill-new-sources.mjs`
- `classifySignalQuality` returns new statuses `proxy` / `composite` / `imputed`
- `loadLatestSignalsWithQuality` is schema-aware: works on pre- and post-migration databases

### Phase 0.6 — source hygiene
- Migrations: `add-articles-source-metadata.mjs`, `add-canonical-events-hhi.mjs`, `backfill-article-source-metadata.mjs`, `recompute-canonical-events-hhi.mjs`
- `shared/publisher-groups.json` — 70+ domains → (publisher_group, market_relevance tier)
- `scripts/_shared/source-classifier.mjs` — classifyPublisher, detectWireSource, classifyArticleSource
- `scripts/_shared/source-concentration.mjs` — HHI, effectiveSourceCount, wireDominated

### Phase 1 — storage split + API fusion
- Migration: `create-nowcast-tables.mjs` (estimated_signal_nowcasts, nowcast_reconciliation, nowcast_training_snapshots)
- `scripts/event-dashboard-api.mjs`: `loadLatestNowcastsForSignals` + `fuseNowcastsIntoLookup` (pure) injected into `buildSignalSummary`; observed values never overridden, proxy/composite get replaced by nowcasts, `meta.mode` flips to `'nowcast'` when any KPI is estimated

### Phase 2a–d — Tier 2 gap-fill
- Trainers: `train-rates-nowcast.py` (HY / treasury10y / yieldSpread / IG), `train-commodity-fx-nowcast.py` (Oil / Dollar)
- Inference: `compute-rates-nowcast.py` + `.mjs` wrapper, `compute-composite-nowcasts.mjs` (marketStress)
- `scripts/_shared/market-calendar.mjs` — NYSE session classifier with confidence floor per session

### Phase 2e — clean eventIntensity
- `compute-event-intensity-nowcast.mjs` — market_relevance filter + wire collapse + hour-of-day normalization

### Phase 3 — UI
- `event-dashboard.html`: `trust-chip-nowcast` CSS + `renderTrustRow` accepts `valueOrigin`, `estimateConfidence`, `intervalLow/High`, `marketSession`; KPI strip wires first nowcast into chip

### Phase 4 — source gate (now enforced)
- Migration: `create-nowcast-source-gate.mjs` with 24 seed rules (rates, oil/dollar, marketStress shock-disabled, eventIntensity proxies)
- `scripts/_shared/nowcast-source-gate.mjs` — pure `evaluateGate()` + DB-wrapper `checkEligibleSources()` + `detectRegime()`
- Python port `scripts/_shared/nowcast_source_gate.py` kept field-by-field in sync
- Gate is now invoked BEFORE INSERT in all three writers (compute-rates / compute-composite / compute-event-intensity)

### Phase 5 — registry + reconciliation
- Migration: `create-model-registry.mjs`
- `reconcile-nowcasts.mjs` — withLock cron, pairs estimates with observed signal_history rows, emits calibration drift alerts
- `promote-nowcast-model.mjs` — candidate → shadow → active gates exposed as pure `evaluateCandidateGate` / `evaluateShadowGate`
- master-daemon TASKS: added `rates-nowcast` (30m), `composite-nowcasts` (30m), `event-intensity-nowcast` (30m), `reconcile-nowcasts` (15m)

## 4. Test Matrix

```
tests/event-dashboard-freshness-contract.test.mjs   16 assertions  PASS
tests/source-classifier.test.mjs                     7              PASS
tests/source-concentration.test.mjs                  6              PASS
tests/market-calendar.test.mjs                       6              PASS
tests/nowcast-source-gate.test.mjs                  12              PASS
tests/reconcile-nowcasts.test.mjs                   10              PASS
tests/promote-nowcast-model.test.mjs                 8              PASS
tests/nowcast-fusion.test.mjs                        6              PASS
tests/compute-composite-nowcasts.test.mjs            3              PASS (source-level wiring)
tests/compute-rates-nowcast-gate-wiring.test.mjs     3              PASS (source-level wiring)
──────────────────────────────────────────────────────────────────
                                                    77 assertions
CI core (npm run test:ci:core)                      96 assertions  PASS
```

No regression. No DB tests — all logic tested via pure-function extracts + fake-client pattern.

## 5. What Is NOT Done — Production Activation Checklist

### 5.0 Market-quote bootstrap (run before training)

Training + inference read 180 days of daily bars for 10+ feature symbols
(HYG, LQD, TLT, ^IRX, ^TNX, XLE, USO, XOM, CVX, UUP, FXE, ^VIX). The daemon
task `market-quote-refresh` accumulates these as snapshots over time, but the
table starts empty — so the `--window 180` training in §5.2 cannot run on
day 0 without pre-filling history.

```bash
node scripts/bootstrap-market-quotes-history.mjs --range 1y
# dry-run first to inspect source mix:
node scripts/bootstrap-market-quotes-history.mjs --dry-run --symbols HYG,LQD
```

The script fuses from `worldmonitor_intel.historical_raw_items` (the
project's pre-existing Yahoo 5y warm store, theme-scoped) first, then
patches the remainder via the Yahoo chart API. Idempotent — safe to re-run;
rows with the same (symbol, observed_at) are skipped.

Symbol list is pulled from `scripts/_shared/market-quote-symbols.json`,
which is now the single source of truth shared by refresh, bootstrap,
coverage audit, and both Python trainers' TargetSpec.

After running, verify with:

```sql
SELECT symbol, COUNT(DISTINCT DATE(observed_at)) AS days
FROM market_quotes
WHERE observed_at >= NOW() - INTERVAL '180 days'
GROUP BY symbol;
-- expect ≥120 trading days per symbol
```

### 5.1 NAS migrations (run in order)

```bash
# Prerequisites: PG_PASSWORD set in .env.local, NAS reachable at 192.168.0.2:5433

node scripts/migrations/add-signal-history-origin.mjs          # ALTER signal_history + value_origin/writer_id
node scripts/migrations/tag-legacy-derived-signals.mjs         # retroactively tag marketStress/etc. as proxy
node scripts/migrations/add-articles-source-metadata.mjs       # articles + wire_source/publisher_group/market_relevance
node scripts/migrations/backfill-article-source-metadata.mjs   # populate new cols on 68k articles (batched 2k)
node scripts/migrations/add-canonical-events-hhi.mjs           # canonical_events + HHI columns
node scripts/migrations/recompute-canonical-events-hhi.mjs     # rebuild source_hhi/wire_dominated from article meta
node scripts/migrations/create-nowcast-tables.mjs              # estimated_signal_nowcasts + reconciliation + training
node scripts/migrations/create-nowcast-source-gate.mjs         # eligibility table + seed rules
node scripts/migrations/create-model-registry.mjs              # model_registry table
```

All migrations support `--dry-run`. Run dry-run first. None are destructive (ADD COLUMN / CREATE TABLE IF NOT EXISTS only).

### 5.2 Model training

```bash
# Rates (Phase 2a, 2b)
python scripts/train-rates-nowcast.py --target hy_credit_spread --window 180
python scripts/train-rates-nowcast.py --target treasury10y
python scripts/train-rates-nowcast.py --target yieldSpread
python scripts/train-rates-nowcast.py --target ig_credit_spread

# Commodity + FX (Phase 2c)
python scripts/train-commodity-fx-nowcast.py --target oilPrice
python scripts/train-commodity-fx-nowcast.py --target dollarIndex
```

Use `--validate` first to see MAE / coverage without writing `.pkl`.
Acceptance gate: holdout MAE < baseline × 0.85 AND coverage90 ≥ 0.80 AND
total rows ≥ 120 — evaluated by `_shared/nowcast_acceptance_gate.py`.
As of 2026-04-18 the trainers **refuse to save `.pkl`** when the gate fails
(exit 3). This is enforced, not advisory.

`data/models/<target>-nowcast-latest.pkl` is the pointer used at inference.
Even with a saved model, `event-dashboard-api.mjs` now only fuses nowcasts
whose `model_registry.promotion_state ∈ ('shadow','active')` — training
alone is not enough to reach the dashboard; you also need to run
`promote-nowcast-model.mjs`.

#### Phase C outcome (2026-04-18 first run)

All 6 targets validated, **0/6 cleared the gate**. Ridge on ETF proxies
cannot beat naive carry-forward on slow-moving FRED rate series (1–3 bp/day
moves; model adds 10×–360× more error). oilPrice had the only positive MAE
improvement (+51%) but its holdout variance exceeds train variance, so no
in-sample residual calibration (Gaussian 1.645σ, empirical p90) meets
cov90 ≥ 0.80; N also fell to 112 at --window 180. yieldSpread fails both
MAE and coverage; dollarIndex and the credit spreads fail on MAE.

Structural rework (feature engineering, non-linear model, or longer history
with regime splits) is required before any of these targets save. The gate
guard keeps the pipeline honest in the meantime — compute-rates will return
`no trained model` abstain for all 4 rates until real models exist.

### 5.3 First-run inference + reconciliation smoke test

```bash
node scripts/compute-rates-nowcast.mjs
node scripts/compute-composite-nowcasts.mjs
node scripts/compute-event-intensity-nowcast.mjs
node scripts/reconcile-nowcasts.mjs
curl http://127.0.0.1:46200/api/kpi-summary | jq .meta.mode .meta.valueOrigin .nowcasts
```

Expected after migrations + ≥1 training run:
- `/api/kpi-summary` response includes `nowcasts: {...}` with method/confidence/interval
- `meta.mode` returns `'nowcast'` when any KPI signal is estimated
- Dashboard (event-dashboard.html) renders the sky-blue `NOWCAST` chip above the freshness chip

### 5.4 Master-daemon restart (partial activation)

```bash
# Stop the running daemon (however the ops pattern is today)
# Then:
node scripts/master-daemon.mjs

# Verify the startup banner prints:
#   [disabled] rates-nowcast (NOWCAST_RATES_ENABLED != true)
# and the following three tasks are scheduled:
#   composite-nowcasts (30m), event-intensity-nowcast (30m),
#   reconcile-nowcasts (15m)
```

As of 2026-04-18, `rates-nowcast` is **opt-in** via the
`NOWCAST_RATES_ENABLED=true` env var. Default off. Rationale: all 4 rates
targets currently fail the acceptance gate (Phase C outcome, §5.2), so
running the cron produces only "no trained model" abstains every 30 min —
noise, no value. Re-enable after the rates redesign track produces models
that clear the gate.

Phase D smoke test (2026-04-18) verified the four writers are
production-safe even without trained rates models:
- compute-rates → clean abstain ×4
- compute-composite → gate abstain on stale inputs (expected; inputs
  freshen once the daemon polls them regularly)
- compute-event-intensity → writes a row (eventIntensity) per run
- reconcile-nowcasts → no-op when estimated_signal_nowcasts is empty

### 5.5 First promotion

```bash
# After ~30 days of reconciliation samples:
node scripts/promote-nowcast-model.mjs --target hy_credit_spread --promote active
node scripts/promote-nowcast-model.mjs --target treasury10y --promote active
# ...
```

Until then, models stay as `shadow` (if they pass the candidate gate) or `candidate` (if not).

## 6. Known Gaps / Open Questions

| # | Gap | Severity | Plan |
|---|---|---|---|
| 1 | ~~`articles.body` column usage not verified~~ | — | RESOLVED 2026-04-18: backfill doesn't read body (SELECT id,url,source,title only); detectWireSource treats body as optional |
| 2 | `compute-event-intensity-nowcast.mjs` references `gdelt_event_count` as source — no such signal in signal_history | LOW | Seed rule passes because lag check is 0. Revise after first 7d of reconciliation data |
| 3 | Asian-native news sources still absent | HIGH | Not a code fix — business decision (paid feeds / partnerships). Tracked in issues doc §5.7 |
| 4 | Oil weekend abstain logic untested | MEDIUM | Requires Sunday manual run + eyeballing `data/alerts.json` |
| 5 | ~~master-daemon `rates-nowcast` --all handling~~ | — | RESOLVED 2026-04-18: wrapper `compute-rates-nowcast.mjs:47` passes `--all` when no target specified; verified by reading code |
| 6 | ~~No active model in registry → shadow models silently run~~ | — | RESOLVED 2026-04-18: `loadLatestNowcastsForSignals` now JOINs `model_registry` and filters `promotion_state IN ('shadow','active')`. Candidate/unregistered models never reach the dashboard |
| 7 | Twitter/X sentiment absent from regime detector | LOW | Can extend `detectRegime()` to check article spike + VIX; tracked in plan doc |
| 8 | ~~market_quotes had no history bootstrap path~~ | — | RESOLVED 2026-04-18: new `scripts/bootstrap-market-quotes-history.mjs` + `_shared/market-quote-symbols.json` SoT + coverage audit in trainers/inference. See §5.0 |
| 9 | `refresh-market-quotes-to-nas.mjs` hardcoded 8 symbols didn't match trainer feature set | — | RESOLVED 2026-04-18: default symbol list now sourced from `_shared/market-quote-symbols.json` (coreSnapshots ∪ nowcastFeatures) |
| 10 | Ridge + ETF proxy features cannot beat naive carry-forward on slow-moving FRED rate targets | HIGH | Phase C validate 2026-04-18: 5/5 rates models MAE failed gate by 2×–360×. Separate redesign track opened — see [NOWCAST_RATES_REDESIGN_TRACK_2026-04-18.md](./NOWCAST_RATES_REDESIGN_TRACK_2026-04-18.md) |
| 11 | oilPrice holdout variance exceeds train variance → interval calibration unsolvable from train alone | MEDIUM | In-sample p90 (0.44 cov) and Gaussian 1.645σ (0.62 cov) both miss the 0.80 target. Options: conformal prediction with separate calibration split, or longer train window once rate models are reworked |

## 7. File Map Quick Reference

```
scripts/
  migrations/
    add-signal-history-origin.mjs           ← Phase 0.5 schema
    tag-legacy-derived-signals.mjs          ← Phase 0.5 data tag
    add-articles-source-metadata.mjs        ← Phase 0.6 schema
    backfill-article-source-metadata.mjs    ← Phase 0.6 data
    add-canonical-events-hhi.mjs            ← Phase 0.6 schema
    recompute-canonical-events-hhi.mjs      ← Phase 0.6 data
    create-nowcast-tables.mjs               ← Phase 1 schema
    create-nowcast-source-gate.mjs          ← Phase 4 schema + seed
    create-model-registry.mjs               ← Phase 5 schema

  _shared/
    signal-history-writer.mjs               ← Phase 0.5 helper
    source-classifier.mjs                   ← Phase 0.6 (publisher_group, wire_source)
    source-concentration.mjs                ← Phase 0.6 (HHI)
    market-calendar.mjs                     ← Phase 2 (session-aware confidence)
    nowcast-source-gate.mjs                 ← Phase 4 gate (JS)
    nowcast_source_gate.py                  ← Phase 4 gate (Python port)

  train-rates-nowcast.py                    ← Phase 2a/2b trainer
  train-commodity-fx-nowcast.py             ← Phase 2c trainer
  compute-rates-nowcast.py                  ← Phase 2a/2b inference (gated)
  compute-rates-nowcast.mjs                 ← Node wrapper for daemon
  compute-composite-nowcasts.mjs            ← Phase 2d marketStress (gated)
  compute-event-intensity-nowcast.mjs       ← Phase 2e (gated)
  reconcile-nowcasts.mjs                    ← Phase 5 pairing cron
  promote-nowcast-model.mjs                 ← Phase 5 manual promotion
  master-daemon.mjs                         ← Phase 5 task registry updated

  event-dashboard-api.mjs                   ← Phase 0 + 0.5 + 1 (withMeta, classifySignalQuality, buildSignalSummary, fuseNowcastsIntoLookup)
  refresh-fred-signals-to-nas.mjs           ← Phase 0.5 writer (observed + composite split)
  refresh-market-quotes-to-nas.mjs          ← Phase 0.5 writer
  refresh-event-market-transmission.mjs     ← Phase 0.5 writer
  master-pipeline.mjs                       ← Phase 0.5 STEP 0 tags
  backfill-new-sources.mjs                  ← Phase 0.5 writer

shared/
  publisher-groups.json                     ← Phase 0.6 domain map

event-dashboard.html                         ← Phase 3 UI (trust-chip-nowcast + renderTrustRow)

docs/
  NOWCAST_ESTIMATION_ARCHITECTURE_PLAN_2026-04-17.md   (original plan)
  NOWCAST_PLAN_ISSUES_2026-04-17.md                    (issues / corrections found during review)
  NOWCAST_HANDOFF_2026-04-18.md                        (this file)

tests/
  event-dashboard-freshness-contract.test.mjs      Phase 0 + 0.5
  source-classifier.test.mjs                       Phase 0.6
  source-concentration.test.mjs                    Phase 0.6
  market-calendar.test.mjs                         Phase 2
  nowcast-source-gate.test.mjs                     Phase 4 (pure + fake client)
  reconcile-nowcasts.test.mjs                      Phase 5 (pure)
  promote-nowcast-model.test.mjs                   Phase 5 (pure)
  nowcast-fusion.test.mjs                          Phase 1 (pure fusion)
  compute-composite-nowcasts.test.mjs              Phase 2d (wiring)
  compute-rates-nowcast-gate-wiring.test.mjs       Phase 2a (wiring)
```

## 8. How to Resume in a Fresh Session

### If you want to activate production

1. Open this file
2. Work through §5.1 → §5.2 → §5.3 → §5.4 in order
3. Spot-check against §6 for known gaps before shipping

### If you want to add a new nowcast target

1. Read existing trainer (`train-rates-nowcast.py` or `train-commodity-fx-nowcast.py`) — copy pattern
2. Add the feature list + target to the trainer
3. Add seed rows to `scripts/migrations/create-nowcast-source-gate.mjs` (migrate again)
4. Add the target to `compute-rates-nowcast.py` TARGETS list if it shares the rates pattern
5. Update `fuseNowcastsIntoLookup` candidate set in `scripts/event-dashboard-api.mjs` if it should show on the KPI strip

### If you want to add a new test

1. Look at the pure-function extracts listed in §3 (evaluateGate / classifyReconciliation / evaluateCandidateGate / fuseNowcastsIntoLookup)
2. Add to the matching `tests/*.test.mjs` file — mocking is unnecessary for pure functions
3. For DB-touching code, use the fake-client pattern in `tests/nowcast-source-gate.test.mjs`

### If the user asks about the project status

Quote this doc's §1 plus the table in §4. Do NOT claim "production ready" — the honest phrase is **"v1 in code, gated and tested, activation steps listed in docs/NOWCAST_HANDOFF_2026-04-18.md §5"**.

## 9. Context for Review Assumptions

The user flagged two review gaps in the predecessor session and the P1 fixes addressed both:
1. Previously: gate existed but was never called by writers. Now: gate is called in all three writers before INSERT; wiring is asserted by source-level tests (`compute-composite-nowcasts.test.mjs`, `compute-rates-nowcast-gate-wiring.test.mjs`) so future edits that move the write above the gate will fail CI.
2. Previously: only the contract + hygiene surfaces had tests. Now: the full write-reconcile-fuse path is covered via pure-function extracts and fake-client tests.

The user prefers terse, honest status reporting (no "완료" when the production activation is still pending). Follow this tone.

## 10. CLAUDE.md Constraints Still Applicable

- No `DELETE` of existing signal_history rows — we tag with `writer_id` instead (rule 5)
- All new scripts use `withLock()` from `_shared/pipeline-lock.mjs` (rule 8)
- No silent catches — all new code uses `createLogger` and emits structured warnings (rule 7)
- Python is source of truth for numeric work (rates / commodity nowcasts), TS/MJS reads + displays (rule 6)
- Commit after major phases — already done for Phase 0-0.6, Phase 1-5, and P1 fixes
