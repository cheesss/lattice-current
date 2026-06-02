# Lattice Current — Positioning

> Canonical positioning doc. English-first, with a short Korean blurb at the end. Source of truth for how Lattice is described across the README, GitHub Pages, Show HN, and downstream channels.

Repo: https://github.com/cheesss/lattice-current
Pages: https://cheesss.github.io/lattice-current/

---

## The wedge (the one thing)

Most AI research tools produce confident-looking reports. Lattice makes **"not ready" a first-class output**.

A thesis cannot be promoted until the evidence to support it actually exists. Lattice blocks promotion until issuer exposure, market validation, negative controls, source breadth, and accepted evidence are present — and it says so in plain language, per report, with the exact missing pieces named.

That is the entire point. The conservative evidence gates are the product, not a limitation to apologize for.

---

## One-liner

**Lattice is a local-first, evidence-gated research OS that blocks confident-looking reports until the evidence is actually there.**

---

## Who it is for

- **Analysts** who need to know *what is still missing* before they trust a thesis, not just read a finished-looking narrative.
- **OSINT builders** who care about source provenance, acceptance rules, and negative controls.
- **Data-pipeline engineers** who want a structured evidence contract and an inspectable gate state, not a black-box generator.
- **Developers** tired of tools that always return a confident answer.

If you want a tool that always says "buy," this is the wrong tool. If you want a tool that tells you it is not ready and why, keep reading.

---

## Three message pillars

### 1. "Not ready" is a named output, not a missing one

Reports sit in **BLOCKED / needs-fix** with an explicit `primaryBlocker` and `nextAction` until eight evidence gates close. The gate state is computed and consolidated in `scripts/_shared/evidence-gate-consolidator.mjs` — machine state, not a disclaimer paragraph. The eight gates are `accepted_promotion_evidence`, `accepted_evidence`, `independent_source_breadth`, `issuer_bridge`, `negative_control`, `holdout`, `market_validation`, and `valuation_bridge`. A report stays blocked until the relevant gates flip to closed (for example, `independent_source_breadth` only closes when `independentSourceBreadth >= 2`).

### 2. Raw evidence cannot quietly become promotion evidence

Every collected row has to clear an acceptance lane before it can support a thesis: staleness (`stale_evidence`, default max age 730 days), duplicate (`duplicate_source`), generic-financial-boilerplate, fixture-only (`fixture_backed_not_production_evidence`), and issuer-bridge checks. Some classes are *structurally* barred from promotion: `negative_control` and `provider_data_gap` are in `PROMOTION_BLOCKED_CLASSES`, and `market_validation` only counts as a promotion candidate when the row is local controlled market data (`local_controlled_market_data`). These rules live in `scripts/_shared/seed-evidence-acceptance.mjs`, so "this row counts / this row does not" is enforced in code, not left to the writer's judgment.

### 3. Every report ships its own evidence contract

Each report carries a **Universal Evidence Contract** that enumerates which evidence classes are required and which are promotion-eligible, defined in `scripts/_shared/universal-evidence-contract.mjs`. So "what is still missing" is a concrete per-class checklist — `negative_control`, `controlled_market_validation`, `issuer_bridge`, `holdout_validation`, and so on — not a vibe.

---

## What it is

- A **local-first research OS**: report generation and the dashboard panels run on your machine with **zero API keys**.
- An **evidence-gated pipeline**: hot theme / signal / report artifact → mechanism seed → universal evidence contract → missing-evidence-class detection → provider/source-query backfill → report closure and contradiction detection → **BLOCKED** or human-reviewed promotion.
- **Honest by construction**: a blocked report names its `primaryBlocker`, its `nextAction`, and the exact evidence classes it is still waiting on.
- **Inspectable**: the client memo stays readable, while raw provenance lives in the audit appendix and `evidence_table.csv`.

## What it is NOT

- **Not an investment adviser, stock picker, or alpha guarantee.** It prioritizes research; it does not tell you what to buy.
- **Not an autonomous trading or auto-promotion system.** Autonomous loops keep readiness / candidate / portfolio writes at **0**. A **human promote is always required**.
- **Not a live backtesting product.** The heavy backtest/ML modules were moved to a legacy branch. Do not read backtesting into this.
- **Not a durable-alpha engine.** Market validation only reaches decision-grade from local controlled event data, and it is explicitly caveated as such — it is not a claim about live, forward returns.
- **Not a "broad sources" flex.** The source-breadth gate threshold is modest and explicit: `>= 2` independent sources.

---

## Honest competitive contrast

| | Generic AI report generators | LangGraph-style agent frameworks | BI / signal dashboards | **Lattice** |
|---|---|---|---|---|
| Default output when evidence is thin | A confident report anyway | Whatever the agent loop converges on | A chart with no readiness opinion | **BLOCKED, with the missing evidence classes named** |
| "Not ready" state | Usually none | You build it yourself | None | **First-class:** `primaryBlocker` + `nextAction` |
| Evidence acceptance | Implicit / prompt-level | Up to you | N/A | **Coded acceptance lanes**; some classes barred from promotion |
| Per-report contract | No | No | No | **Universal Evidence Contract** per report |
| Promotion | Implicit in the prose | Wherever the agent decides | N/A | **Human-only**; autonomous writes stay at 0 |

To be fair about the boundaries:

- This is **not** an attack on agent frameworks. You could build something gate-like on top of LangGraph. Lattice is the already-wired version where the gates are the default and "not ready" is the norm.
- Lattice is **narrower** than a general BI dashboard. It is about evidence-gated *research readiness*, not arbitrary analytics.
- Generic report generators are often faster to a finished-looking page. That speed is exactly the failure mode Lattice is built to refuse.

---

## The viral object (hero screenshot)

There are real **BLOCKED** reports sitting in the repo:

```
data/reports/RPT-validated-cross-theme-bottleneck-report-blocked-*/report.html
```

Each one's banner reads:

> **Research Priority D; not an investment memo.** Collect required evidence classes before treating the report as decision-ready.

Its **"Why Not Review-Ready Yet"** section names the exact missing gates — `negative_control`, `controlled_market_validation`, `issuer_bridge`, `holdout_validation`. And it is not a staged one-off: there are dozens of sibling `RPT-...-blocked-*` folders (50+ in the repo today), so blocking is the **normal** outcome, not a demo trick.

This is the hero image because it inverts the usual confident-AI-buy-signal demo. The interesting screenshot is the tool refusing to commit.

---

## Try it (honest demo)

Default path, **zero keys**, **no database** — generates a complete, real evidence-first report:

```bash
npm run report:deep -- --type theme_report --subject "AI / Machine Learning"
# -> report.html + audit appendix + evidence_table.csv
```

This no-DB report path is verified working.

Local-DB path (Postgres + pgvector via Docker, still zero keys):

```bash
docker compose up -d        # local Postgres + pgvector
npm run demo:seed           # schema + demo data + a DB-backed report
npm run dev                 # open the dashboard
```

> Status note: the local-DB demo path is built and layer-verified (12/12 unit tests pass, NAS-safety guard tested), but the full Docker end-to-end run has one verification still pending. The commands are real; do not treat screenshots or outputs from the DB path as confirmed yet.

**Boundary:** report generation and the dashboard panels run locally with zero keys. Only *live external news ingestion* additionally needs free Guardian/NYT keys plus a local Ollama embedding model — that is strictly an optional "go further" step, never part of the default demo.

---

## 한 줄 포지셔닝 (Korean blurb)

**Lattice Current**는 로컬에서 도는, 근거 게이트(evidence gate) 기반의 리서치 OS입니다.
대부분의 AI 리서치 도구는 그럴듯해 보이는 리포트를 항상 만들어 냅니다.
Lattice는 반대로 **"아직 준비 안 됨(BLOCKED)"을 정식 결과물**로 다룹니다.
발행사 노출, 시장 검증, 네거티브 컨트롤, 소스 폭, 채택된 근거가 실제로 갖춰지기 전까지는
어떤 논지도 승격(promote)되지 않으며, **무엇이 빠졌는지를 리포트마다 명시**합니다.
투자 자문도, 자동 매매도 아니며, 백테스트 제품도 아닙니다 — 승격은 언제나 사람이 직접 합니다.