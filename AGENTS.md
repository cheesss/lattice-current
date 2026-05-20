# Lattice Agent Rules

## Response Rules

- If the user prompt is Korean, answer in Korean only.
- Do not mix Hindi, Hinglish, or casual English into Korean replies.
- For Lattice operations, use concise operator Korean: status, evidence, next action.
- If a tool result is in English, translate the conclusion to Korean and keep source names, identifiers, paths, and URLs unchanged.

## Repository Rules

- Preserve existing user edits. Do not revert unrelated files.
- Prefer `rg` for search when available; if it is blocked on Windows, use PowerShell-native search.
- Use NAS PostgreSQL runtime helpers instead of hard-coded database credentials.
- Treat source ingestion and approval as an operator workflow: probe, repair, dry-run, approve, register, seed, then verify active registry state.
- Do not mark skipped or low-quality source execution as `executed`; keep it `needs-fix`, `exhausted`, or `rejected`.
- Keep recurring or remote agent prompts compact. Do not inject raw logs, full snapshots, API keys, or large assistant transcripts into agent context.
- Before and after starting or stopping Lattice services, inspect Node, npm, Vite, sidecar, scheduler, and long-running job processes. Stop stale duplicates, but keep the active service set required for the current task.

## Root-Cause Fix Rule

- Do not stop at naming the cause. Diagnosis is only sufficient when it leads directly to a durable fix, regression guard, and verification.
- Prefer fixing the upstream mechanism that creates the symptom over adding labels, warnings, banners, one-off scripts, or manual backfills.
- Temporary explanations, stale-data banners, fallback UI, and repair scripts are allowed only as guardrails while the root pipeline fix is implemented.
- For dataflow issues, trace the full chain: source -> classification/mapping -> labels/outcomes -> derived tables -> API -> UI. Fix the earliest broken stage that can be safely corrected.
- After the fix, run a representative catch-up or repair, add or update a regression test, and verify that the user-facing API, report, or UI changed as intended.
- Default posture: repair first, explain second. If only a warning is added, explicitly state why the upstream fix is unsafe or out of scope.

## Evidence-Bound Report Rule

- LLM/Codex report output is an analyst layer, not the source of truth. The source of truth is the evidence bundle built from DB/API/cache data.
- Do not let LLM/Codex introduce companies, tickers, dates, numbers, causal claims, validation status, or investment conclusions that are absent from the bundle.
- Every generated report claim must be linked to `claim_id`, `evidence_id`, `metric_id`, `figure_id`, or `caveat_id`.
- Client memo output must not expose raw pipeline mechanics such as `refs`, claim IDs, metric ledgers, query manifests, pack names, status warnings, or source queue internals. Those belong in the audit appendix.
- The long-form memo should be generated from semantic blueprint -> section-specific paragraphs -> structural editor -> validator, not from repeated prose templates.
- Use anchor-fit before promoting an event anchor into the memo. Low-fit anchors can support fragmentation or monitoring, but cannot validate the economic mechanism.
- Sparse baselines and thin source samples must be downgraded before memo synthesis. They can create watch tasks, not lifecycle conclusions.
- Direct transcript coverage is an investment-readiness gate. Proxy filing or earnings-release evidence can support triage, but investment memo readiness requires direct management-commentary coverage for the required monitored symbols.
- If a report reveals stale data, missing uplift, broken source hydration, empty theme-symbol mapping, or missing transcript coverage, create a repair/source-query/backfill path instead of only writing a nicer explanation.

## Project Context

`lattice-current-fix` is an evidence-first theme intelligence workspace. It connects live articles, events, themes, market reactions, cross-theme candidates, source governance, and analyst reports into one operator loop.

Core product path:

```text
sources/articles/market data
-> canonical event and theme resolution
-> evidence, metric, causal, and market reaction bundles
-> signal cards and analyst synthesis
-> long-form client memo + audit appendix
-> source-query/backfill tasks and review-gated operator actions
```

Important surfaces:

- Main shell: `event-dashboard.html`
- Dashboard API: `scripts/event-dashboard-api.mjs`
- Report generator: `scripts/generate-intelligence-report.mjs`
- Evidence bundle: `scripts/_shared/report-evidence-bundle.mjs`
- Deep research pack: `scripts/_shared/report-deep-research-pack.mjs`
- Signal cards and synthesis: `scripts/_shared/report-signal-cards.mjs`, `scripts/_shared/report-analyst-synthesis.mjs`
- Long-form memo planner: `scripts/_shared/report-narrative-plan.mjs`
- Report compiler and validator: `scripts/_shared/report-compiler.mjs`, `scripts/_shared/report-validator.mjs`
- Quality gates: `scripts/_shared/report-quality.mjs`
- External provider adapters: `scripts/_shared/external-data/`
- Free external data collector: `scripts/collect-free-external-data.mjs`
- Report backfill drain: `scripts/drain-report-backfill-tasks.mjs`
- Universal research orchestrator: `scripts/run-universal-research-orchestrator.mjs`

Key DB/data concepts:

- `articles`, `canonical_events`, `article_event_map`
- `event_features`, `event_uplift`, `matched_controls`
- `market_quotes`, `market_returns`, `model_predictions`, `model_eval`
- `external_fundamentals`, `external_valuations`, `transcript_evidence`
- `report_backfill_tasks`, local report registry, source-query queue artifacts

## Coding Rules

- Run `npx tsc --noEmit` after TypeScript-significant changes.
- Run focused `node --import tsx --test ...` tests for changed report, data, dashboard, or daemon paths.
- Prefer named constants or data-driven settings over magic numbers.
- Add comments only for non-obvious branching, scoring, safety, or data boundary logic.
- Never hardcode secrets such as API keys, NAS DB credentials, GitHub tokens, or provider tokens in code or docs.
- Do not delete existing user data. Backfills must be incremental, deduplicated, and review-gated where canonical state can change.
- Avoid silent catches. Include context in warnings and durable task/error state.
- Long-running scripts and daemon jobs should use lock helpers where concurrent execution can corrupt state.
- A data-ingest change is not complete when rows are inserted. It is complete when downstream bundle/report/UI consumers can use the rows.

## Useful Commands

```powershell
npx tsc --noEmit
node --import tsx --test .\tests\report-*.test.mjs .\tests\universal-research-orchestrator.test.mjs .\tests\external-provider-backfill-targets.test.mjs
node .\scripts\generate-intelligence-report.mjs --db --depth deep --type theme_report --subject "AI / Machine Learning"
node .\scripts\collect-free-external-data.mjs --theme ai-ml --label "AI / Machine Learning" --providers fmp --symbols MSFT,AMD,NVDA,META,GOOGL --force --throttle-hours 0
node .\scripts\drain-report-backfill-tasks.mjs --limit 10
node .\scripts\run-universal-research-orchestrator.mjs --once
```

Process inspection on Windows:

```powershell
Get-CimInstance Win32_Process -Filter "name = 'node.exe' or name = 'cmd.exe'" |
  Select-Object ProcessId,Name,CommandLine |
  Sort-Object ProcessId |
  Format-Table -Wrap -AutoSize
```

## Documentation Sync Rule

When changing user-visible behavior, feature scope, architecture, API, storage, replay/backtest flow, UI navigation, report output, provider adapters, or public policy, update the relevant docs in the same turn.

Required actions:

1. Identify affected reference docs under `docs/` and public pages under `site/`.
2. Update at least one applicable feature, architecture, algorithm, API, update, legal, or policy page.
3. If navigation or information architecture changes, update `site/.vitepress/config.mts`.
4. If screenshots, diagrams, or interactive docs components are affected, update those assets or components.
5. Run `npm run docs:build` before finishing when public docs changed.
6. In the final response, list the docs files that were updated.

If a change has no public documentation impact, state why in the final response.
