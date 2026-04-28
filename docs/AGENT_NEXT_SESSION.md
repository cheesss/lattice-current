# Agent Next-Session Reading Guide

> **Purpose**: minimum reading list to pick up this codebase in a new chat session and be productive within ~10 minutes.

If you only have 5 minutes, read just **§1**. If you're working on a specific area, jump to **§3**.

---

## 1. Required reading (do this first, in order)

| File | Why | Time |
|------|-----|------|
| `docs/PROJECT_HANDOFF_2026-04-28.md` | **Current dashboard/UI state.** Signal-first dashboard direction, Theme Brief metric caveats, Korean support, operator tooltips, file-mode map fallback, verification notes. | 5 min |
| `docs/PROJECT_HANDOFF_2026-04-27.md` | Prior system baseline. Daemons, ports, recent fixes, ML pipeline background, deferred items, quick-start commands. | 5 min |
| `CLAUDE.md` | Project conventions, scripts table, NAS tables, code modification rules. | 3 min |
| `docs/DOCUMENTATION.md` | Index of canonical docs vs archived. Use this to navigate when you hit unfamiliar terms. | 1 min |

After these you should know: the signal-first dashboard direction, 5 dashboard surfaces, Theme Brief caveat rules, Evolution lens behavior, Korean UI support, 3 standalone daemons that must be running, ML pipeline background, and where to find any other doc.

---

## 2. Verify the system is alive (do this before any code change)

```bash
# Daemons (each must respond)
curl -s http://localhost:3000/event-dashboard.html -o /dev/null -w "vite %{http_code}\n"
curl -s http://127.0.0.1:46200/api/health | jq .status     # → "healthy"
curl -s http://127.0.0.1:8100/health | jq .temperature     # → 4.31 (calibration loaded)
curl -s http://127.0.0.1:18789/ -o /dev/null -w "openclaw %{http_code}\n"

# Master-daemon and data-accumulator are processes, not ports — check by RSS
tasklist | grep node     # look for node.exe with ~700MB RSS (master-daemon) and a similar one (accumulator)
```

If any of those are missing, follow §6 below before touching code.

```bash
# Regression tests (run before + after every code change in dashboard/AI-Lab area)
node scripts/_shared/verify-ai-interactive.mjs    # 15 checks
node scripts/_shared/dashboard-click-verify.mjs   # 25 checks
```

---

## 3. Topic-specific reading (jump to what you need)

### Dashboard UI / 5 surfaces
- `event-dashboard.html` — single 5,800-line file. Search by surface comment block (`// SURFACE 1: HOME`, etc).
- `src-tauri/sidecar/local-api-server.mjs` — desktop sidecar (port 46123).
- Regression test: `scripts/_shared/dashboard-click-verify.mjs`.

### AI Analysis Lab (Investigate surface)
- `scripts/_shared/ai-analysis-builder.mjs` — 7 backend builders (timeline, narrative, similar events, regime scenario, asset dossier, weekly digest, correlation breaks).
- `scripts/event-dashboard-api.mjs` — routes are at lines 2261+, search `/api/event-timeline`, `/api/event-narrative/:id` etc.
- Frontend `event-dashboard.html` lines ~3528-4100 (search `refreshAiTimeline`, `refreshScenarioLab`).
- Regression test: `scripts/_shared/verify-ai-interactive.mjs`.

### Meta-model (ML inference)
- `docs/SESSION_HANDOFF_2026-04-12.md` — original architecture rationale (read §architecture only).
- `scripts/train-meta-model.py` — 17 features → 4-task multi-output (alpha_prob, expected_alpha, downside, time_to_peak).
- `scripts/calibrate-meta-model.py` — temperature scaling (Guo 2017), saves sidecar JSON.
- `scripts/meta-model-server.py` — FastAPI :8100, loads .pt + .calibration.json on startup.
- `scripts/meta-model-infer.mjs` — cron that fans out (event × symbol × horizon) and writes model_predictions.

### Data pipeline (4-table staleness, cascade catchup)
- `docs/CONNECTED_SYSTEM_WORKFLOW_DETAILED_EXPLAINED_2026-04-18.md` — narrative end-to-end.
- `docs/CONNECTED_SYSTEM_WORKFLOW_VISUAL_2026-04-18.md` (and `.svg` / `.png`) — diagram.
- `scripts/master-daemon.mjs` TASKS dict — 40+ scheduled tasks, look for the one you care about.
- `scripts/data-accumulator.mjs` — separate daemon for warm yahoo / GDELT / FRED.
- `scripts/build-market-returns.py` — daily aggregate from labeled_outcomes.

### OpenClaw integration
- `docs/PROJECT_HANDOFF_2026-04-23.md` (§OpenClaw section) — control plane.
- `docs/OPENCLAW_INTEGRATION_ARCHITECTURE_2026-04-16.md` — channels, TaskFlow, source repair.
- `plugins/openclaw-lattice-control-plane/index.ts` — plugin tools registration.
- `scripts/_shared/openclaw-webhook-emitter.mjs` — emitter + `verifyLatticeWebhookSignature()` helper.

### Source acquisition + repair loop
- `docs/SESSION_IMPROVEMENTS_2026-04-23.md` — recent source repair work.
- `docs/WORKFLOW_SOURCE_ADD_PATH_2026-04-18.md` — code-level deep dive.
- `scripts/run-source-repair-closed-loop.mjs` — main orchestrator.

### Theme / discovery
- `docs/WORKFLOW_KEYWORD_THEME_ADD_PATH_2026-04-18.md` — code path.
- `scripts/discover-emerging-tech.mjs`, `scripts/refresh-discovery-from-recent-themes.mjs`.

### Nowcasts (rates / commodity / FX)
- `docs/NOWCAST_HANDOFF_2026-04-18.md` — Phase 0–5 status, gates, fuse filter.
- `docs/NOWCAST_RATES_REDESIGN_TRACK_2026-04-18.md` — open ML track.

---

## 4. Recent commit history (last 14 commits, this sprint)

```
31ff095f perf+docs: bulk INSERTs, bounded codex buffer, tab-pause, agent handoff doc
391b85bf fix(all): close 5 remaining root-cause issues from end-to-end audit
7cb3a8f5 fix(ml+api): expand theme→symbol coverage 6→41, fix asArray ReferenceError
7dde259e feat(meta-model): activate dormant ML inference pipeline + close 4 operational gaps
13ab6fc4 fix(dashboard+pipeline): filter singleton/dynamic-theme events + bump embedding throughput
3e38380a fix(pipeline): close 4-table staleness gap blocking E2 grade generation
d46b59b4 fix(ui): widgets stuck in skeleton state after data renders
d87afa6c chore(daemon): register data-accumulator npm scripts
4f1a9d93 fix(ui+reliability): 7 improvements from end-to-end audit
4130dc7f chore(reliability): follow-ups — daemon npm scripts, idempotent migration, HMAC verify helper
f59d063a fix(reliability): worker loop crash, atomic state writes, pool sizing, webhook signing
a6fc5faf feat(dashboard): AI Analysis Lab + interactive visualizations
347dd3c5 docs: add 3 workflow deep-dive docs + normalize status markers
```

`git log --oneline -20` shows older context. The 4-12 → 4-23 → 4-27 trio of `*HANDOFF*.md` files is the chronological narrative.

---

## 5. Common environment + gotchas

| Var / setting | Why it matters |
|---------------|----------------|
| `PYTHON_BIN=C:/Users/chohj/miniconda3/python.exe` (in `.env.local`) | Microsoft Store `python` is a stub; master-daemon needs miniconda for torch + psycopg2. |
| `CODEX_MODEL=gpt-5.4` (env when starting API) | `~/.codex/config.toml` defaults to `gpt-5.5` which user account can't access. Without override, `/api/event-narrative` and `/api/weekly-digest` 500. |
| `YAHOO_BATCH_SIZE=30` (data-accumulator env) | Original 5/2h was too slow; warm yahoo fell 24+ days behind. |
| `EVENT_DASHBOARD_PG_POOL_MAX=20` | API server default raised from 6 because AI Lab added 7 endpoints. |
| `CODEX_MAX_OUTPUT_BYTES=20MB` | Bounds Codex spawn buffer. |
| Vite serves `:3000` (NOT `:8088`) | Earlier sessions used `python -m http.server` style on `:8088`; that's dead. Geo Lens iframe needs `.ts` MIME, only Vite serves it correctly. |

### The "everything looks healthy but data is stale" symptom

Means master-daemon is alive but data-accumulator died (warm yahoo cascade halts, then labeled_outcomes, then market_returns, then E2 grades stop firing). Check process list, restart `npm run daemon:accumulator` if missing. ETA to recovery: ~4-12 hours of cascade catchup.

---

## 6. Bringup sequence (after a clean restart)

```bash
# 1. Frontend stack (vite + API + meta-model-server)
npm run dev

# 2. In a separate terminal — master-daemon (40 scheduled tasks)
npm run daemon

# 3. In another terminal — data-accumulator (warm yahoo/GDELT/FRED)
npm run daemon:accumulator

# 4. (Optional) intelligence-scheduler (theme automation)
npm run intelligence:scheduler

# 5. Verify
curl -s http://127.0.0.1:46200/api/health | jq
curl -s http://127.0.0.1:8100/health | jq
node scripts/_shared/dashboard-click-verify.mjs
```

---

## 7. Where to look when you find something broken

| Symptom | First file to check |
|---------|---------------------|
| Dashboard surface stuck "Loading..." | `event-dashboard.html` `.loading` CSS rule + the corresponding `refresh*` function |
| API endpoint 500 with stack trace | `scripts/event-dashboard-api.mjs` (search the path) + builder in `scripts/_shared/` |
| Stale signal warning | `scripts/_shared/dashboard-signal-quality.mjs` `SIGNAL_STALE_THRESHOLD_HOURS` |
| Hot Events full of noise | `scripts/_shared/event-intelligence-builder.mjs` `buildHotEventsPayload` filter |
| Meta-model `/health` returns no `temperature` | `data/meta-v1-*.calibration.json` missing — run `npm run meta-model:calibrate` |
| `/api/meta-model-health` returns `recentCount: 0` | meta-model-infer cron isn't running OR `auto_theme_symbols` empty for active themes |
| New theme in dashboard but no inference | `auto_theme_symbols` doesn't have ticker mappings — see `scripts/migrations/seed-theme-symbols-curation.mjs` for the pattern |
| Daemon logs going silent for hours | Worker loop crash. `intelligence-automation.ts:3262` has try/catch + exponential backoff (added 2026-04-27). If still missing, this is a regression. |
| State file corruption | `intelligence-automation.ts:863` `writeJsonFile` is now atomic (write-tmp + rename). If corruption persists, check disk full / antivirus. |

---

## 8. Open work (next sprint candidates)

From `docs/PROJECT_HANDOFF_2026-04-27.md` §6 + §8:

1. **auto-pipeline.mjs step3 N+1 → CTE** (10x labeling speed, medium effort).
2. **generate-embeddings → Python asyncio** (10-15x via concurrent Ollama calls, small effort).
3. **data-accumulator → Python aiohttp** (4-6x cycle time, medium).
4. **Calibration drift redesign** — handoff doc warned simple retrain regresses; regime-conditional architecture is the proper next ML PR.
5. **Silent catches review** — ~30+ `catch {}` blocks across codebase, most annotated `non-fatal`, but case-by-case audit needed per CLAUDE.md rule #7.
6. **HMAC verification on receiver side** — `verifyLatticeWebhookSignature()` helper exists; in-repo plugin webhook handlers should adopt it.
