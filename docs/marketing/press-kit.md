# Lattice Current — Press kit

A fact sheet for write-ups, Show HN comments, and cross-posts. Every claim traces to a file in the repo. Tone: developer-honest, no hype.

- Repo: https://github.com/cheesss/lattice-current
- Docs / Pages: https://cheesss.github.io/lattice-current/
- License: AGPL-3.0-only
- Author: cheesss (sole author; not a fork of another project)

## One-liner

Lattice is a local-first, evidence-gated research OS that blocks confident-looking reports until the evidence is actually there.

## The wedge (the one thing to remember)

Most AI research tools produce a confident-looking memo whether or not the evidence underneath it exists. Lattice makes **"not ready" a first-class output**: a report stays `BLOCKED`, and names the gate that is missing, until issuer exposure, market validation, negative controls, source breadth, and accepted evidence actually exist.

## Two-paragraph description

Lattice turns a hot theme or signal into a structured *mechanism seed*, attaches a *Universal Evidence Contract* (the exact evidence classes that report needs, and which are promotion-eligible), detects which classes are missing, and routes backfill — keeping the report `BLOCKED` until eight evidence gates close. The acceptance lane it runs every collected row through (staleness, duplicate, generic-boilerplate, fixture-only, issuer-bridge) is what stops raw text from quietly becoming the evidence that promotes a thesis.

It runs locally. A bundled Docker Postgres + a one-command seed produce a working dashboard and a real DB-backed report with zero API keys; a no-DB path generates a complete evidence-first report from built-in sample evidence. The conservative gates are the differentiator, not a limitation: the flagship artifact in the repo is a report that blocks *itself* and says "not an investment memo."

## Key facts

- **Eight evidence gates** gate promotion: accepted promotion evidence, accepted evidence, independent source breadth (>= 2), issuer bridge, negative control, holdout, market validation, valuation bridge. (`scripts/_shared/evidence-gate-consolidator.mjs`; per-class ledger in `scripts/_shared/report-backfill-closure.mjs`)
- **Acceptance lane** separates raw evidence from promotion evidence; negative-control and market-validation are non-promotion or local-controlled-only. (`scripts/_shared/seed-evidence-acceptance.mjs`)
- **Universal Evidence Contract** per report enumerates required vs promotion-eligible classes. (`scripts/_shared/universal-evidence-contract.mjs`)
- **Local-first**: report generation + dashboard panels run with zero keys; verified against a real Postgres engine.
- **Stack**: TypeScript (UI, API, schedulers), Python (batch analytics), Postgres (pgvector), optional Tauri desktop runtime.

## What it is NOT (deliberate boundaries)

- Not an investment adviser, stock picker, alpha guarantee, or fully-automated decision system.
- Not a live backtesting product (backtest/ML modules live on the `legacy/backtest` branch).
- Not autonomous trading or auto-promotion — autonomous loops keep readiness/candidate/portfolio writes at 0; a human promote is always required.
- Market validation is diagnostic support, not durable alpha.

## The hero artifact (best screenshot)

A real `BLOCKED` report at `data/reports/RPT-validated-cross-theme-bottleneck-report-blocked-*/report.html`. Banner: "Research Priority D; not an investment memo." Its "Why Not Review-Ready Yet" section names the exact missing gates (`negative_control`, `controlled_market_validation`, `issuer_bridge`, `holdout_validation`). 53 sibling `RPT-...-blocked-*` folders show blocking is the norm.

## Assets

- Social preview (1200x630, OG): `site/public/images/hero/lattice-current-social-preview.png`
- Architecture / research-loop diagram: Mermaid in `README.md`
- Suggested screenshots: the BLOCKED report; the Evidence Contract Matrix; the dashboard research-seeds + report-backfill panels (after `npm run demo:seed`).

## Audience

Analysts, OSINT builders, data-pipeline engineers, and evidence-minded developers who are tired of confident-looking AI output.

## Boilerplate (copy-paste)

> Lattice Current is a local-first, evidence-gated research operating system. It turns messy signals into mechanism-based research candidates and refuses to promote them while critical evidence — issuer exposure, market validation, negative controls, source breadth — is missing. Open source (AGPL-3.0), runnable locally with zero API keys.

## Korean blurb

> Lattice는 근거가 실제로 갖춰지기 전까지 그럴듯해 보이는 리포트를 차단하는 로컬 우선 증거-게이트 리서치 OS입니다. 메커니즘 기반 리서치 후보를 만들고, 발행사 노출·시장 검증·네거티브 컨트롤·출처 다양성 같은 핵심 근거가 빠지면 승격을 거부합니다. 오픈소스(AGPL-3.0), API 키 없이 로컬 실행.
