# Show HN package

This file holds the Show HN submission for Lattice Current: title, post body, and a pre-written FAQ. Tone is developer-honest. Every mechanism claim traces to a file in the repo.

- Repo: https://github.com/cheesss/lattice-current
- Pages: https://cheesss.github.io/lattice-current/

---

## Title

```
Show HN: Lattice - a local-first evidence-gated research OS
```

Alternate (if the first reads too abstract):

```
Show HN: Lattice - a research tool that blocks its own reports until the evidence exists
```

---

## Post body

Lattice is a local-first, evidence-gated research OS. It blocks confident-looking reports until the evidence is actually there.

**Why I built it.** Most AI research tools optimize for output that looks finished. You ask about a theme, you get a clean memo with a thesis, a target, and a tidy "buy/avoid" lean. The report looks the same whether the underlying evidence is solid or nearly absent. The confidence is in the formatting, not in the data.

I wanted the opposite failure mode: "not ready" as the default, loud, and specific, so the tool is most useful exactly when the evidence is thin.

**What it does.** Lattice makes "not ready" a first-class output. A report does not get promoted to review-ready until eight evidence gates close. Until they do, it sits in BLOCKED / needs-fix with an explicit blocker and a concrete next action. The eight-gate roll-up and missing-gate detection live in `scripts/_shared/evidence-gate-consolidator.mjs`; the per-class `primaryBlocker` / `visualStatus` / `nextAction` ledger is in `scripts/_shared/report-backfill-closure.mjs`. The gates cover issuer exposure, a negative control, controlled market validation, accepted promotion evidence, and an issuer bridge, among others.

Two design choices do most of the work:

1. **Raw evidence cannot silently become promotion evidence.** Every collected row has to clear an acceptance lane first: staleness, duplicate, generic-financial-boilerplate, fixture-only, and an issuer-bridge check. Some classes are hard-coded as non-promotion or local-controlled-only. `negative_control` and `provider_data_gap` sit in a promotion-blocked set (`scripts/_shared/seed-evidence-acceptance.mjs`, lines 8-13), so they can inform a report but can never be the row that promotes it. The boilerplate filter is literal regex pattern-matching against the usual 10-K filler ("goodwill is recognized", "revenue from contracts with customers", "estimated useful lives") so a filing paragraph that says nothing specific does not count as evidence.

2. **Every report carries a Universal Evidence Contract.** It enumerates which evidence classes are required and which are promotion-eligible, so "what is still missing" is a concrete per-class list instead of a vibe (`scripts/_shared/universal-evidence-contract.mjs`). The classes are `operating_kpi`, `issuer_commentary`, `primary_filing`, `mechanism_validation`, `issuer_exposure`, `negative_control`, `holdout_validation`, `market_validation`, `historical_analog`.

The loop, end to end: a hot theme or signal or report artifact becomes a mechanism seed, the seed gets a universal evidence contract, missing evidence classes are detected, provider and source-query backfill is drafted, the report is closed with contradiction detection, and it ends in either BLOCKED or a human-reviewed promotion. The promotion step is always a human action.

**The hero artifact is a blocked report, not a buy signal.** A real BLOCKED report is already committed at `data/reports/RPT-validated-cross-theme-bottleneck-report-blocked-*/report.html`. Its banner reads "Research Priority D; not an investment memo" with "collect required evidence classes before treating the report as decision-ready", and its "Why Not Review-Ready Yet" section names the exact failing gates (`issuer_bridge`, `negative_control`, `controlled_market_validation`, `accepted_promotion_evidence`, `valuation_bridge`, and more). Dozens of sibling `RPT-...-blocked-*` folders are committed alongside it, so blocking is the normal state, not a one-off demo.

**What it deliberately refuses to do.**

- It is not an investment adviser, a stock picker, or an alpha guarantee. It prioritizes research; it does not tell you what to buy.
- No autonomous trading and no auto-promotion. The autonomous loops keep readiness, candidate, and portfolio writes at 0 (`readinessPromotionWrites: 0`, `reportCandidateWrites: 0`, `portfolioActionWrites: 0` in `scripts/_shared/evidence-gate-consolidator.mjs`). A human promote is always required to cross the mutation boundary.
- No live backtesting. The heavy backtest/ML modules were moved to a `legacy/backtest` branch and are not part of this product. This is not a replay engine, and it does not produce a Sharpe number.
- Market validation is not durable alpha. It only reaches decision-grade from local controlled event data, and it is caveated as diagnostic support rather than a trading signal. The blocked report says so directly: "The market lane is diagnostic support, not a trading signal."
- Source breadth is intentionally modest. The gate threshold is at least 2 independent sources. This is not a 50-source firehose.

**Run a small local demo.**

The fastest honest path needs no database and no API keys:

```bash
npm run report:deep -- --type theme_report --subject "AI / Machine Learning"
```

That generates a real evidence-first report (`report.html`, an audit appendix, and `evidence_table.csv`) with no database and no API keys. This path is verified working, and example output is already committed under `data/reports/`.

The fuller local-DB path:

```bash
docker compose up -d   # local Postgres + pgvector
npm run demo:seed      # schema + demo data + a DB-backed report, zero keys
npm run dev            # open the dashboard
```

Honesty note on the DB path: it is layer-verified (12/12 unit tests pass, the NAS-safety guard is tested) but the full Docker end-to-end run has one pending verification as of this writing. The commands are real; I have not yet captured a clean end-to-end Docker round-trip, so I am not claiming polished output there. The no-DB report path above is the one I would judge it on.

What runs locally with zero keys: report generation and the dashboard panels. The only thing that additionally needs keys is **live external news ingestion**, which uses free Guardian/NYT keys plus a local Ollama embedding model. Treat that as an optional "go further" step, not part of the default demo.

**What feedback I want.**

- Is the eight-gate model too strict, too loose, or wrong in its decomposition? Which gate would you drop or add?
- Where does the acceptance-lane logic let bad evidence through, or wrongly reject good evidence? The boilerplate patterns in `seed-evidence-acceptance.mjs` are a blunt instrument and I expect false positives.
- Is "BLOCKED as the default output" useful to you, or just friction? I think the conservative gates are the differentiator, but I want to hear the case that they are a usability tax.
- Anything in the local demo that does not run on your machine, especially the Docker path, since that is the one I have not fully end-to-end verified.

Repo and Pages links are at the top. I am the sole author and I will be in the thread.

---

## FAQ: likely HN comments, with honest answers

**1. "Is this financial advice / a stock picker?"**
No. It is not an investment adviser, not a stock picker, and not an alpha guarantee. It produces research-prioritization artifacts and frequently refuses to promote them. The flagship artifact in the repo is a report that blocks itself and says "not an investment memo." If you want something that tells you what to buy, this is the wrong tool by design.

**2. "Does it actually run, or is this vaporware?"**
The no-DB report path runs and is verified: `npm run report:deep -- --type theme_report --subject "AI / Machine Learning"` produces `report.html`, an audit appendix, and `evidence_table.csv` with no database and no keys. Those artifacts are already committed in `data/reports/`, so you can read a real blocked report before running anything. The local-DB Docker path is layer-verified (12/12 unit tests, NAS-safety guard tested) but has one pending end-to-end verification, and I am saying so up front rather than claiming a screenshot I have not taken.

**3. "Isn't this just RAG with extra steps?"**
The retrieval part is the least interesting part. The point is what happens to retrieved text after it is collected. In a typical RAG report, any retrieved chunk can end up justifying the conclusion. Here, a collected row has to clear an acceptance lane (staleness, duplicate, generic-boilerplate, fixture-only, issuer bridge) before it can count, and classes like `negative_control` and `provider_data_gap` are hard-coded as non-promotion (`scripts/_shared/seed-evidence-acceptance.mjs`). On top of that, each report carries an explicit evidence contract listing what is required and what is promotion-eligible (`scripts/_shared/universal-evidence-contract.mjs`), and eight gates have to close before promotion (`scripts/_shared/evidence-gate-consolidator.mjs`). RAG fills the bucket; the gating decides whether the bucket is allowed to mean anything.

**4. "What about backtesting / where are the returns?"**
There is no backtesting in this product, on purpose. The heavy backtest and ML modules were moved to a `legacy/backtest` branch. Lattice is about whether a thesis has earned the right to be reviewed, not about replaying it against price history. If you came for a Sharpe number, this tool does not produce one.

**5. "How is market validation computed, and why should I trust it?"**
Market validation is treated as diagnostic support, not a trading signal. It only reaches decision-grade from local controlled event data, and it is caveated wherever it appears. In the committed blocked report, the market-lane status is "missing" and the text reads "The market lane is diagnostic support, not a trading signal." The honest answer: do not trust it as alpha. It is one caveated input that can act as a gate, and it is local-controlled-only before it counts for anything.

**6. "What needs API keys?"**
The default demo needs none. Report generation and the dashboard panels run locally with zero keys. The only thing that additionally needs keys is live external news ingestion, which uses free Guardian/NYT keys plus a local Ollama embedding model. That is an optional step, not part of the default path.

**7. "Eight gates sounds like it never ships anything. Is everything just permanently BLOCKED?"**
For thin evidence, yes, and that is the intended behavior. Blocking is the norm in the repo: there are dozens of `RPT-...-blocked-*` folders. A report leaves BLOCKED when the missing evidence classes are actually collected and the gates close, and even then the final promotion is a human action, not an automatic one. If you find the threshold annoying, that is exactly the feedback I want, but the goal is for "ready" to mean something.

**8. "Does it trade or promote anything automatically?"**
No. There is a hard mutation boundary. The autonomous loops keep readiness, candidate, and portfolio writes at 0 (`readinessPromotionWrites: 0`, `reportCandidateWrites: 0`, `portfolioActionWrites: 0` in `scripts/_shared/evidence-gate-consolidator.mjs`). Promotion to a human-review candidate requires explicit human approval. Nothing here places orders or auto-promotes.

**9. "Who wrote this? Is it a fork of someone else's work?"**
Single author, me (cheesss). It is not a fork and there is no hidden upstream. Solo project, and I will own the answers in the thread.

**10. "Why local-first instead of a hosted service?"**
Because the work is reproducible on your machine: the report artifacts, the gates, and the acceptance lanes all run locally with zero keys, and the blocked reports are committed so you can audit the logic without trusting my server. Local-first also keeps the "go further" external ingestion (your own Guardian/NYT keys, your own local Ollama) under your control rather than mine.

---

## Korean note (optional, for cross-posting to GeekNews / Disquiet later)

This Show HN doc is English-first by spec. A full Korean translation lives with the social-copy doc, not here. One-line KO positioning for reuse:

> Lattice는 근거가 실제로 갖춰지기 전까지 그럴듯해 보이는 리포트를 차단하는, 로컬 우선(local-first) 근거-게이트 기반 리서치 OS입니다.