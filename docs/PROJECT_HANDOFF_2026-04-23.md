# Lattice Current Project Handoff

Date: 2026-04-23 KST

This is the current one-file handoff for understanding and operating Lattice Current. It does not replace detailed design documents; it tells a new session, agent, or operator what matters now, what runs, where data flows, and how to validate changes.

Do not treat `SESSION_IMPROVEMENTS_2026-04-23.md` as an editable target from this handoff. That file is a separate session change log and was intentionally not modified while creating this document.

## 1. One-Sentence System Summary

Lattice Current is a local-first operator cockpit that connects live news ingestion, historical backfill, market and macro signals, source proposal repair, nowcast estimation, Decision Inbox review, and OpenClaw remote briefing/control into one operational intelligence workflow.

## 2. Product Identity

There are two product surfaces:

| Surface | Purpose | Current status |
| --- | --- | --- |
| Operator Cockpit | Real-time judgment, evidence tracking, source repair, decisions, operational health | Active surface: `event-dashboard.html` |
| Product Showcase | First impression, trust-building, demo storytelling | Separate future surface, not the current cockpit |

The operator cockpit should stay predictable and data-dense. Avoid smooth-scroll, always-on 3D effects, heavy magnet hover, and decorative count-up animations in operational views because they reduce scanning reliability.

## 3. First Reading Order

Read these in order when entering the repo:

1. `docs/PROJECT_HANDOFF_2026-04-23.md` - this file, current operational handoff.
2. `docs/SESSION_IMPROVEMENTS_2026-04-23.md` - detailed latest change log, read-only unless explicitly asked.
3. `docs/DOCUMENTATION.md` - full documentation index and superseded-doc notes.
4. `docs/CONNECTED_SYSTEM_WORKFLOW_DETAILED_EXPLAINED_2026-04-18.md` - full connected workflow narrative.
5. `docs/SOURCE_PROPOSAL_INGESTION_REDESIGN_2026-04-16.md` - source proposal, probe, repair, approval, and backfill design.
6. `docs/OPENCLAW_INTEGRATION_ARCHITECTURE_2026-04-16.md` - OpenClaw integration, operator lane, coder lane, reporting design.
7. `docs/NOWCAST_HANDOFF_2026-04-18.md` - nowcast state, gates, storage split, model status.
8. `CLAUDE.md` - repo conventions, scripts, NAS tables, modification rules.

Older dated plans are useful historical context, not the canonical current state unless this handoff or `DOCUMENTATION.md` points you there.

## 4. Runtime Commands

Use separate terminals from the repo root:

```powershell
cd C:\Users\chohj\Documents\Playground\lattice-current-fix
npm run dev
```

```powershell
cd C:\Users\chohj\Documents\Playground\lattice-current-fix
npm run sidecar:dev
```

```powershell
cd C:\Users\chohj\Documents\Playground\lattice-current-fix
npm run intelligence:scheduler
```

```powershell
openclaw gateway run
```

What these start:

| Command | Role | Main endpoints or outputs |
| --- | --- | --- |
| `npm run dev` | Dashboard API, theme shell, Vite dashboard surface | `http://127.0.0.1:4173/event-dashboard.html`, API proxy to `http://127.0.0.1:46200/api/*` |
| `npm run sidecar:dev` | Local sidecar/runtime observability API | `http://127.0.0.1:46123/api/*` |
| `npm run intelligence:scheduler` | Recurring source repair, freshness, discovery, queue automation | `data/automation/intelligence-scheduler-state.json` |
| `openclaw gateway run` | OpenClaw control UI, web chat, MCP bridge | OpenClaw dashboard URL from `openclaw dashboard` |

The dashboard can show useful state only if `npm run dev` is running. OpenClaw read tools work best when `npm run dev` and `npm run sidecar:dev` are both running.

## 5. Normal Node Processes

These Node processes are expected during a full local run:

| Process | Expected reason |
| --- | --- |
| `openclaw gateway run` | OpenClaw websocket/control UI |
| `scripts/dev-theme-shell.mjs` | Local dashboard shell launched by `npm run dev` |
| `scripts/event-dashboard-api.mjs` | Main dashboard API |
| `vite` | Static dashboard frontend server |
| `npm run sidecar:dev` | Sidecar dev command wrapper |
| `src-tauri/sidecar/local-api-server.mjs` | Local runtime sidecar |
| `npm run intelligence:scheduler` | Scheduler command wrapper |
| `scripts/intelligence-scheduler.mjs` | Intelligence automation scheduler |

Common leftovers to remove when CPU is unexpectedly high:

| Leftover | Why remove |
| --- | --- |
| `@playwright/mcp` | Browser automation helper that can survive tests |
| old `openclaw plugins` or `openclaw sessions` commands | Historical debug commands, not runtime services |
| stale `run-source-repair-closed-loop` | Source repair should be launched by scheduler or a deliberate one-shot |
| old browser test workers | Can keep Chromium and Node busy after interrupted tests |

Do not kill a process only because the cumulative CPU column is high. On Windows, inspect recent CPU delta or command line first.

## 6. Current Operational Baseline

Recent verified baseline from the latest repair and freshness work:

| Check | Expected current interpretation |
| --- | --- |
| `/api/health` | Healthy, DB connected |
| `/api/data-freshness-audit` | Findings `0`, cache issues `0`, recent article counts present |
| `/api/source-repair-status` | `targetMet: true` |
| Source repair KPI | `targetSuccesses: 20`, counted successes above target, event-mapped successes present |
| Decision Inbox e2e | `e2e/inbox-actions.spec.ts` passing with current `/api/proposal-inbox` and `/api/discovery-triage` mocks |
| OpenClaw Codex bridge | Codex CLI can call Lattice MCP tools through OpenClaw |

If any of these regress, treat it as an operational issue, not a cosmetic dashboard issue.

## 7. Connected Data Flow

High-level flow:

```text
External sources
  -> RSS / GDELT / FRED / Yahoo / CoinGecko / market quote APIs / source proposals
  -> NAS PostgreSQL and local artifacts
  -> ingestion, import, replay, backfill, repair loops
  -> articles, signal_history, market_quotes, theme tables, event maps, source registry
  -> dashboard APIs
  -> event-dashboard.html
  -> Decision Inbox and operator actions
  -> OpenClaw briefings, remote review, and controlled actions
```

Trust boundary by data type:

| Data type | Meaning | UI/logic handling |
| --- | --- | --- |
| Observed/live | Directly fetched or ingested from current source systems | Can power live status if fresh |
| Backfill/historical | Historical data loaded to create continuity and training context | Useful for trends and training, not proof of live freshness |
| Estimated/nowcast | Model-estimated value when observed data is delayed | Must carry confidence, interval, and origin |
| Proxy/composite/imputed | Derived or substitute value | Must not be displayed as equivalent to observed data |

The system should never silently mix historical backfill with live status without freshness/origin metadata.

## 8. Source Proposal And Repair Flow

Source proposal flow:

```text
AI or automation proposes a source
  -> source-probe runs adapters and quality gates
  -> pass: canonical feed/source is registered
  -> fail: repair loop analyzes failure reason
  -> repair loop tries catalog, heuristic, and Codex code repair paths
  -> successful source is backfilled
  -> articles enter datasets
  -> theme/event maps update
  -> dashboard and OpenClaw can report the new data
```

Important source files:

| File | Role |
| --- | --- |
| `scripts/_shared/source-probe.mjs` | Adapter cascade, feed discovery, quality scoring |
| `scripts/_shared/source-repair.mjs` | Repair planning and candidate generation |
| `scripts/run-source-repair-closed-loop.mjs` | Closed-loop repair execution and KPI counting |
| `scripts/backfill-active-rss-sources.mjs` | Backfill for active RSS/discovered sources |
| `scripts/_shared/discovered-source-registry.mjs` | Registry and feed quality storage |
| `scripts/proposal-executor.mjs` | Proposal simulate/execute path |
| `scripts/self-heal-sources.mjs` | Self-heal proposal generation and source queueing |

Current closed-loop policy:

| Setting | Current intent |
| --- | --- |
| `targetSuccesses` | At least 20 successful source additions for validation |
| `limit` | Broad enough to inspect historical failed candidates |
| `maxCandidates` | Keeps each run bounded |
| `backfillLimit` | Backfill enough records to prove dataset integration |
| `dailyRssBudget` | Avoids runaway feed traffic |
| `catalogBootstrap` | Uses known-good source catalog before expensive repair |
| `fullHeuristic` | Enables broad but bounded heuristic source repair |
| `countHistoricalSuccesses` | Counts previously verified successes during validation |
| `enableCodeRepair` | Allows Codex-assisted repair paths when configured |

The previous boolean flag parsing issue was fixed; explicit `false` flags must stay false.

## 9. Decision Inbox

Decision Inbox combines approval queue items and discovery triage topics.

Important API paths:

| Endpoint | Purpose |
| --- | --- |
| `/api/proposal-inbox` | Current approval/source proposal inbox |
| `/api/discovery-triage` | Topic triage inbox |
| `/api/approval-queue/:id/review` | Accept/reject/simulate approval item |
| `/api/codex-proposals/:id/review` | Review Codex proposal items |
| `/api/discovery-triage/review` | Canonical/watch/suppress discovery topics |

Critical test:

```powershell
npx playwright test e2e/inbox-actions.spec.ts --reporter=line
```

This spec must mock the current inbox routes, not old `/api/approval-inbox-payload` paths.

## 10. OpenClaw Integration

OpenClaw is the remote operator/control surface, not the place where raw SQL or unrestricted shell access should be exposed.

Useful Lattice tools exposed through OpenClaw:

| Tool | Purpose |
| --- | --- |
| `lattice.get_health` | Health, DB, article/signal age, pending count |
| `lattice.get_live_status` | Hot themes and live status |
| `lattice.get_data_freshness_audit` | Freshness findings and cache issue count |
| `lattice.get_source_repair_status` | Source repair KPI status |
| `lattice.get_kpi_summary` | Top-level regime and market KPI summary |
| `lattice.get_nowcast_status` | Model registry state, 24h reconciliation drift per signal, recent training-snapshot gate verdicts |
| `lattice.get_hot_events` | Top recent canonical events ranked by evidence grade, t-stat, Hawkes temperature |
| `lattice.get_meta_model_health` | Latest meta-model calibration metrics (Brier, ECE, log-loss) and 24h prediction counts |
| `lattice.explain_event` | Single event drill-down: articles, Hawkes, per-symbol uplift, matched controls |
| `lattice.get_source_diversity_audit` | Recent-window source distribution with concentration warnings |
| `lattice.get_theme_impact` | Per-symbol sensitivity, regime multipliers, auto-mapping quality for a theme |
| `lattice.bulk_simulate_approvals` | Dry-run multiple approval decisions in one call |
| `lattice.get_theme_brief` | Theme brief with evidence and citations |
| `lattice.get_approval_queue` | Approval queue summary |
| `lattice.get_discovery_triage` | Discovery topic summary |
| `lattice.get_runtime_observability` | Runtime sidecar observability |
| `lattice.get_automation_ops_snapshot` | Scheduler/automation operations snapshot |
| `lattice.simulate_approval` | Safe dry-run of approval action |
| `lattice.review_approval` | Review approval item through controlled API |
| `lattice.review_discovery_topic` | Review discovery triage item through controlled API |

Webhook emissions from the scheduler (via `scripts/_shared/openclaw-webhook-emitter.mjs`): `scheduler-cycle-completed`, `brief-ready`, and **`event-decision-alert`** (new 2026-04-23 — emitted when `event_uplift` rows match E3/E4 + `|t_stat| ≥ 2` within the last 24 h, dedupe key `event-decision:{event}:{symbol}:{horizon}:{grade}`, persistent state at `data/automation/event-decision-alerts-state.json`).

Important current behavior:

| Area | Current expectation |
| --- | --- |
| `sidecarBaseUrl` | Dashboard API proxies and aliases should make sidecar-backed tools work when sidecar is running |
| Language | Operator replies should stay in Korean when requested, without Hinglish/mixed-language drift |
| Context length | Avoid dispatching every routine event into the main agent; only important events should trigger agent work |
| Local OpenClaw patches | Some global npm OpenClaw CLI JSON/listing fixes may be local and can be overwritten by reinstall |

Keep the operator lane and coder lane separate:

| Lane | Role |
| --- | --- |
| Operator lane | Approval, briefing, health, scheduler, source review |
| Coder lane | Isolated worktree, feature branch, patch/test/screenshot/diff, explicit approval before commit or push |

## 11. Nowcast And Market Data

Nowcast exists to separate observed signals from estimated signals.

Current state:

| Area | Status |
| --- | --- |
| `signal_history` origin tagging | Implemented for observed/proxy/composite/imputed style classification |
| Nowcast storage split | `estimated_signal_nowcasts`, reconciliation, training snapshots |
| Rates nowcast | Acceptance gates failed; production use remains off unless explicitly opted in |
| Composite/event-intensity nowcast | Can run without trained rates models |
| Market quotes | Bootstrap/backfill path exists through `bootstrap-market-quotes-history.mjs` and scheduled refresh |

Do not save or promote gate-failing models into production inference.

## 12. Storage And Generated Artifacts

Important stores:

| Path or store | Role |
| --- | --- |
| NAS PostgreSQL | Main durable operational database |
| `data/historical/automation/*` | Historical automation imports |
| `data/audits/*` | Audit outputs |
| `data/event-dashboard-cache/*` | Dashboard response cache |
| `data/automation/intelligence-scheduler-state.json` | Scheduler state |
| `data/codex-source-repair-runs/*` | Source repair run evidence |
| `data/persistent-cache/source-registry%3Av1.json` | Source registry cache |

Generated data changes frequently. Do not commit large generated artifacts unless the task explicitly requires it.

NAS writes should be performed by application scripts and controlled APIs. OpenClaw should call Lattice tools; it should not receive generic SQL or unrestricted shell tools for normal operation.

## 13. Useful Commands

Schema and health:

```powershell
npm run schema:check
Invoke-RestMethod http://127.0.0.1:46200/api/health
Invoke-RestMethod http://127.0.0.1:46200/api/data-freshness-audit
Invoke-RestMethod http://127.0.0.1:46200/api/source-repair-status
```

Backfill and source repair:

```powershell
node scripts/bootstrap-market-quotes-history.mjs
node --import tsx scripts/backfill-new-sources.mjs
node scripts/run-source-repair-closed-loop.mjs --target-successes=20 --limit=300 --max-candidates=48 --backfill-limit=60
```

Focused tests:

```powershell
node --test --test-isolation=none tests/source-probe.test.mjs tests/source-repair.test.mjs tests/source-repair-closed-loop.test.mjs tests/source-adapter-proposal.test.mjs tests/proposal-executor.test.mjs tests/self-heal-sources.test.mjs tests/local-runtime-observability-route.test.mjs tests/openclaw-plugin-control-plane.test.mjs
npm run typecheck
npx playwright test e2e/inbox-actions.spec.ts --reporter=line
```

Process inspection:

```powershell
Get-CimInstance Win32_Process | Where-Object { $_.Name -match 'node|npm|openclaw' } | Select-Object ProcessId,Name,CommandLine
```

Kill only confirmed leftovers:

```powershell
Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match '@playwright/mcp|run-source-repair-closed-loop' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
```

## 14. Validation By Change Type

Use the narrowest validation that proves the changed behavior:

| Change type | Minimum validation |
| --- | --- |
| Source probe or source repair | Source repair unit tests plus one closed-loop dry or bounded run |
| Proposal executor | Proposal executor tests and simulate/accept API check |
| Decision Inbox UI | `e2e/inbox-actions.spec.ts` and browser screenshot if layout changed |
| OpenClaw MCP/plugin | OpenClaw plugin/control-plane tests plus one web chat tool call |
| Sidecar/runtime observability | Sidecar tests plus `/api/runtime-observability` or OpenClaw tool call |
| Dashboard API/server | `npm run typecheck`, route smoke via `Invoke-RestMethod` |
| Freshness/data pipeline | `/api/data-freshness-audit`, article counts, source repair status |

## 15. Operational Risks

Known risks and guardrails:

| Risk | Guardrail |
| --- | --- |
| Remote coding through OpenClaw can become remote code execution | Keep operator lane and coder lane separate |
| Failed source accepted as executed | Server must keep failed execution as needs-fix or rejected, not executed |
| Homepage or sitemap mistaken for real RSS | Source probe must validate resolved feed, recent items, quality score |
| One-off hardcoded source fixes | Prefer generic adapters, catalog rules, and probe improvements |
| Observed and estimated values mixed in UI | Always preserve value origin, valid-as-of, confidence, and stale metadata |
| Generated data polluting commits | Review `git status` and avoid committing runtime artifacts by default |
| High CPU misread from cumulative Windows CPU | Inspect live process command lines and recent deltas |

## 16. Open Issues

Current known work that remains separate from the source-repair and OpenClaw stabilization:

| Issue | Status |
| --- | --- |
| Rates nowcast redesign | Open track; existing ridge/proxy approach failed gates |
| Stale event uplift pipeline | Live audit 2026-04-23: latest `event_uplift` E2 row is dated 2025-12-29. Recent (30d) events only reach E0/E1. `incremental-event-engine` / `build-matched-controls` appears to have stopped producing uplift for newer events — investigate before relying on `event-decision-alert` webhooks or `lattice.get_hot_events` evidence grades for anything under ~4 months old. Note: docs describe E3/E4 grades but current production data contains only E0/E1/E2 — E2 is the effective "statistically significant" grade. |
| ACLED credentials | Disabled unless credentials are present |
| Global OpenClaw local patches | May need upstreaming or reapplying after reinstall |
| Source diversity and topic noise | Improved, but mixed clusters can still require triage |
| Old dated docs | Preserved for history; use this handoff and `DOCUMENTATION.md` for current entry points |

## 17. Quick Operator Checklist

Before declaring the system healthy:

1. `npm run dev` is running and dashboard opens.
2. `npm run sidecar:dev` is running if OpenClaw observability tools are needed.
3. `npm run intelligence:scheduler` is running if automation should continue.
4. OpenClaw gateway is running if remote chat/control is needed.
5. `/api/health` reports healthy and DB connected.
6. `/api/data-freshness-audit` reports no critical findings and recent article counts.
7. `/api/source-repair-status` reports `targetMet: true`.
8. Decision Inbox e2e passes after inbox route changes.
9. No stale Playwright/OpenClaw/debug Node processes remain.
10. OpenClaw can answer `lattice.get_health` and `lattice.get_source_repair_status` without context-length or language drift problems.
11. `lattice.get_nowcast_status` reports expected level (`ok` in normal operation). `critical` level means at least one signal has 24h reconciliation coverage below 50% — investigate before trusting any nowcast on the dashboard.

## 18. Current End State

The intended current state is:

```text
AI proposal
  -> source probe
  -> automatic repair if needed
  -> source registry
  -> active source backfill
  -> article dataset
  -> theme and event mapping
  -> dashboard and OpenClaw reporting
```

The source repair KPI is not "a suggestion was generated"; it is "a source was registered, backfilled, and mapped enough to affect downstream data." If this stops being true, debug the probe/repair/backfill chain first.
