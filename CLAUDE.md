# CLAUDE.md

## Project Overview

Lattice Current is a theme-led signal intelligence workspace. It collects live articles, structured market data, source metadata, event clusters, and operator feedback, then turns them into evidence-bound theme surfaces and analyst-style report artifacts.

The current product center is not a backtest dashboard. It is an operator shell for:

- live signal triage
- theme and event investigation
- cross-theme research and bottleneck candidates
- source-query and approval workflow
- evidence-first report generation
- data quality, validation, and automation diagnostics

## Runtime Stack

- Frontend/operator shell: `event-dashboard.html`, Vite, TypeScript.
- API and orchestration: Node scripts under `scripts/`.
- Database: NAS PostgreSQL, loaded through runtime helpers rather than hard-coded credentials.
- Batch compute: Python for heavy model/training/return analytics where applicable.
- Report artifacts: local `data/reports/<report_id>/` plus API-served HTML endpoints.

## Report System Contract

The report system is evidence-first:

```text
DB/API/cache data
-> evidence bundle
-> signal cards
-> analyst synthesis
-> semantic narrative blueprint
-> long-form client memo
-> validator
-> report artifacts and source-query/backfill tasks
```

The client memo must read like a research-prioritization memo, not a raw pipeline log.

Do not expose these in the client memo body:

- raw claim IDs, metric IDs, evidence IDs, figure IDs
- query manifests
- metric ledgers
- source queue internals
- pack names such as `fundamentalPack` or `transcriptPack`
- validation logs or raw status strings

Those details belong in `audit_appendix.html`, `audit_appendix.json`, `evidence_table.csv`, and `manifest.json`.

## Investment Readiness Rule

Do not remove investment-readiness caps by wording around them.

Investment memo readiness requires real evidence depth. In particular:

- News, filings, and earnings-release proxies can support research triage.
- Direct call transcript evidence is required before management-commentary claims can support investment-memo readiness.
- `directTranscriptSymbolCount` must meet `requiredTranscriptSymbolCount` for the monitored universe before the transcript blocker clears.
- Controlled market validation is required before event-window sensitivity becomes durable alpha language.
- Graph-derived causal edges remain hypotheses until independent mechanism evidence validates timing and transmission.

If the report says `direct transcript coverage 0/3`, the correct fix is to collect direct transcript evidence into `transcript_evidence`, not to downgrade the warning text.

## Important Scripts

| Script | Purpose |
| --- | --- |
| `scripts/event-dashboard-api.mjs` | Main event dashboard API and report API surface |
| `scripts/generate-intelligence-report.mjs` | Generate DB-backed or sample report artifacts |
| `scripts/build-report-bundle.mjs` | Build evidence bundles directly |
| `scripts/validate-intelligence-report.mjs` | Validate report artifacts and gates |
| `scripts/render-intelligence-report.mjs` | Render report artifacts |
| `scripts/export-intelligence-report.mjs` | Export report artifacts |
| `scripts/schedule-intelligence-reports.mjs` | Scheduled report generation |
| `scripts/collect-free-external-data.mjs` | External provider backfill for fundamentals, valuations, and transcripts |
| `scripts/drain-report-backfill-tasks.mjs` | Drain report-generated backfill tasks |
| `scripts/run-universal-research-orchestrator.mjs` | Generic source/subject data collection orchestration |
| `scripts/master-daemon.mjs` | Background automation loop |
| `scripts/auto-pipeline.mjs` | Article/theme/symbol refresh pipeline |
| `scripts/incremental-event-engine-fast.mjs` | Incremental event engine |
| `scripts/meta-model-infer.mjs` | Meta-model inference writer |

## Report Modules

| Module | Purpose |
| --- | --- |
| `scripts/_shared/report-evidence-bundle.mjs` | Claim/evidence/metric/caveat bundle construction |
| `scripts/_shared/report-db-adapter.mjs` | DB-backed subject data adapter |
| `scripts/_shared/report-deep-research-pack.mjs` | Market/fundamental/filing/transcript/industry/research/policy/causal/historical packs |
| `scripts/_shared/report-signal-cards.mjs` | Attention/fundamental/market/constraint/causal/research signal cards |
| `scripts/_shared/report-analyst-synthesis.mjs` | Evidence-bound thesis/counter-thesis/scenario synthesis |
| `scripts/_shared/report-narrative-plan.mjs` | Semantic blueprint and long-form memo renderer |
| `scripts/_shared/report-chart-planner.mjs` | Claim-bound figures and exhibit takeaways |
| `scripts/_shared/report-compiler.mjs` | HTML/Markdown/audit rendering |
| `scripts/_shared/report-validator.mjs` | Unsupported claim, stale, numeric, duplication, and forbidden-language gates |
| `scripts/_shared/report-quality.mjs` | Artifact, triage, memo, and investment-readiness quality scoring |
| `scripts/_shared/external-data/fmp.mjs` | FMP adapter including transcript endpoints |

## Common Commands

```powershell
npm run dev
npx tsc --noEmit
node --import tsx --test .\tests\report-*.test.mjs .\tests\universal-research-orchestrator.test.mjs .\tests\external-provider-backfill-targets.test.mjs
node .\scripts\generate-intelligence-report.mjs --db --depth deep --type theme_report --subject "AI / Machine Learning"
node .\scripts\collect-free-external-data.mjs --theme ai-ml --label "AI / Machine Learning" --providers fmp --symbols MSFT,AMD,NVDA,META,GOOGL --force --throttle-hours 0
```

## Provider Keys

Keep provider keys in `.env.local` or the appropriate local secret store. Do not write them into code, generated reports, docs, or git history.

Relevant optional providers include:

- FMP for fundamentals, valuations, peers, estimates, and earnings call transcripts.
- Polygon for market data expansion where configured.
- SEC public endpoints for filings, when the adapter path is enabled.
- GitHub token only for GitHub API rate limits and repository workflows.

## Completion Rule

A report/data change is complete only when:

1. The upstream data path is wired or a durable backfill task is created.
2. The client memo remains free of raw pipeline language.
3. The audit appendix keeps provenance available.
4. The quality cap reflects actual data readiness.
5. Focused report tests pass.
6. TypeScript still passes when relevant.
7. A fresh report artifact is generated and inspected.
