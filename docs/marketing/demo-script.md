# Lattice Current — Demo Script (60–90s) + Walkthrough

> File: `docs/marketing/demo-script.md`
> Audience: Show HN / X demo thread / LinkedIn. English-first; a short Korean caption block is included for the X thread.
> Status note: **Track A (local DB run) is pending one Docker end-to-end verification — see the gate below before you record.** Track B (no-DB report) and the hero BLOCKED report are verified working.

---

## What this demo proves

Most AI research tools end on a confident-looking buy-signal. Lattice does the opposite: it makes **"not ready" a first-class output**. A report sits in `BLOCKED` / needs-fix, with an explicit primary blocker and next action, until eight evidence gates close (`scripts/_shared/evidence-gate-consolidator.mjs` — the eight are accepted-promotion-evidence, accepted-evidence, independent-source-breadth, issuer-bridge, negative-control, holdout, market-validation, valuation-bridge). The demo shows that inversion on screen: a report already committed to the repo that refuses to call itself decision-ready and names exactly what is missing.

There are two recordable tracks:

- **Track A — Local run:** `docker compose up` → `npm run demo:seed` → `npm run dev`, then the dashboard surfaces (Decision Inbox, Report Backfill closure, deep-report panel).
- **Track B — Hero moment:** open the BLOCKED report already committed in the repo, read the "not an investment memo" banner, scroll to **Why Not Review-Ready Yet**, then the audit appendix.

If you only have time to record one thing, **record Track B.** It needs no setup, no database, and no keys.

---

## Pre-record gate (read before Track A)

The local-DB demo path (`demo:seed`) was just built. It is layer-verified — 12/12 unit tests pass and the NAS-safety guard is tested — **but the full `docker compose up` → `demo:seed` → `dev` end-to-end run has not yet been confirmed once on a clean machine.**

**Do not record Track A until you (the human) have run it end-to-end once and confirmed the dashboard actually populates.** The commands below are real and correct; what is pending is the live screen capture. Do not narrate specific seeded numbers, row counts, or panel contents from memory — read them off your own successful run.

Track B has no such caveat. The BLOCKED report is a static artifact already in the repo and renders with zero setup.

---

## Track B — The hero moment (verified, ~35s of the cut)

No database, no keys, no build.

**Artifact:** `data/reports/RPT-validated-cross-theme-bottleneck-report-blocked-*/report.html`
(Dozens of sibling `RPT-…-blocked-*` folders exist in `data/reports/` — blocking is the default state here, not a one-off staged for the demo.)

### Beat-by-beat

1. **Open the BLOCKED report** in a browser (any `report.html` from a `*-blocked-*` folder).
2. **Land on the banner.** It reads:
   > **Research Priority D; not an investment memo.**
   > collect required evidence classes before treating the report as decision-ready

   Hold on this for a beat. This is the anti-hype frame: the tool's own output tells you not to trade on it.
3. **Scroll to "Why Not Review-Ready Yet."** This section names the open gates in plain language — e.g. *no issuer has a live official operating bridge* — and the listed human-review gate failures include `evidence_contract_matrix_closure`, `accepted_promotion_evidence`, `issuer_bridge`, `negative_control`, `valuation_bridge`, `expectation_bridge`, `controlled_market_validation`, and `market_regime_support`. (Read the exact list off the report you open — it varies per report.) The point on screen: "what is still missing" is a **concrete per-class list, not a vibe.**
4. **Scroll to the Negative Controls and issuer-evidence sections.** Note the rule: candidate / probable-exposure rows can raise research priority **but do not raise actionability** until direct issuer exposure evidence attaches. This is the acceptance lane in action.
5. **Open the audit appendix** (`audit_appendix.html`, sibling file in the same folder). This is where the provenance lives — the evidence table, the gate state, the why-blocked detail. The client memo body stays clean; the receipts live in the appendix.

### Why each beat is true (for your own confidence, not narration)

- The banner, the "Why Not Review-Ready Yet" section, and the named gates are present in the committed `report.html`.
- The gate logic is in `scripts/_shared/evidence-gate-consolidator.mjs`: eight gates, `BLOCKED` until they close.
- Acceptance lanes — staleness, duplicate, generic-boilerplate, fixture-only, issuer-bridge — and the rule that negative-control evidence is non-promotion and market-validation evidence is accepted only from local controlled market data live in `scripts/_shared/seed-evidence-acceptance.mjs`.
- The per-class required / promotion-eligible enumeration (each class carries an explicit `promotionEligible` flag) is the Universal Evidence Contract: `scripts/_shared/universal-evidence-contract.mjs`.

---

## Track A — Local run (pending one Docker verification)

Show that the same evidence-gated machinery runs locally with **zero API keys**.

### Commands (real, from `package.json`)

```bash
docker compose up -d        # local Postgres + pgvector  (alias: npm run db:up)
npm run demo:seed           # schema + demo rows + a DB-backed report, zero keys
npm run dev                 # open the dashboard (theme shell)
```

What `demo:seed` does, in order (`scripts/seed-local-demo-db.mjs`):
1. applies `db/schema.sql` (idempotent),
2. applies `db/seed.sql` (a small coherent "AI / Machine Learning" dataset),
3. runs built-in mechanism-seed generation (static profiles, no keys, no Ollama),
4. generates one real DB-backed theme report into `data/reports/<id>/`.

Steps 3–4 are best-effort: if one warns, the core schema + seed still land. Everything targets the **local** database only — there is a guard in `scripts/_shared/local-db.mjs`.

### Beat-by-beat (capture from YOUR verified run, not from memory)

1. **Terminal:** show the three commands running clean. Let `demo:seed` print its `[seed]` step log so viewers see schema → seed → mechanism seeds → DB-backed report.
2. **Dashboard — Decision Inbox.** Open the **Decision Inbox** surface (the review queue: proposals, approvals, discovery triage, E2 signals). This is where work waits for a human.
3. **Dashboard — deep report panel.** Open the generated theme report. Show that it carries the same evidence-ledger + caveats + backfill-task structure as the hero report, including a visible quality label. Weak evidence is not hidden: stale sources, hypothesis-only causal edges, and DB gaps become caveats or backfill tasks.
4. **Dashboard — Report Backfill closure.** Show the **Report Backfill** subcard / closure panel: the missing-evidence classes the report detected become concrete backfill targets (tasks for a human or a keyed collection step to act on, not autonomous fetches).

> Reminder: read row counts and panel contents off your own successful run. Do not invent numbers.

---

## No-DB fallback (verified — use if Docker is unavailable on the recording machine)

If Postgres / Docker is not available, you can still generate a **complete, real, evidence-first report** with no database and no API keys:

```bash
npm run report:deep -- --type theme_report --subject "AI / Machine Learning"
```

This writes a full report folder under `data/reports/<id>/` containing `report.html`, the audit appendix (`audit_appendix.html` / `.json`), and `evidence_table.csv` (plus `report.md`, `manifest.json`). You can then run **all of Track B's beats** against that freshly generated `report.html` instead of a pre-committed one. This path is verified working.

---

## Honest boundary (keep this on the cutting-room floor for the video, but true for any Q&A)

- Report generation and the dashboard panels run **locally with zero keys.**
- The **only** thing that additionally needs setup is **live external news ingestion**, which wants free Guardian / NYT keys plus a local Ollama embedding model. Present that strictly as an optional "go further" step — it is **not** part of the default demo.

### What this is not (do not imply otherwise on screen or in captions)

- Not an investment adviser, stock picker, or alpha guarantee. Not a fully-automated decision system.
- Not a live backtesting product. The heavy backtest / replay-ML modules were moved to a legacy branch; do not imply a live backtest feature.
- No autonomous trading and no auto-promotion. Autonomous loops keep readiness / candidate / portfolio writes at 0 — **a human promote is always required.** The report itself states this: the mutation boundary blocks automated readiness promotion, and decision-ready stays false unless a human review explicitly approves.
- Market validation is **not durable alpha.** It only reaches decision-grade from local controlled event data, and it is explicitly caveated in the report.
- Do not overstate source breadth: the gate threshold is **≥ 2 independent sources** (`independentSourceBreadth >= 2` in the consolidator), not "comprehensive."

---

## The research loop (one-line on-screen caption if you want it)

`hot theme / signal → mechanism seed → universal evidence contract → missing-evidence-class detection → provider/source backfill → report closure & contradiction check → BLOCKED or human-reviewed promotion`

---

## Exact shots to capture for the GIF

Capture these as separate clips/frames so the GIF can be cut tight. Lead with the BLOCKED frame — that inversion is the hook.

**Hero (Track B) — required:**
1. `report.html` banner in full: **"Research Priority D; not an investment memo."** with the "collect required evidence classes…" subline.
2. The **"Why Not Review-Ready Yet"** heading with the named open gates visible (`issuer_bridge`, `negative_control`, `controlled_market_validation`, `accepted_promotion_evidence`, `evidence_contract_matrix_closure`, etc. — whatever the opened report actually lists).
3. The **issuer-evidence / Negative Controls** note: candidate rows raise research priority but **not** actionability until direct issuer evidence attaches.
4. The **audit appendix** (`audit_appendix.html`) showing provenance / evidence table — proof the receipts exist.
5. A file-browser frame of `data/reports/` showing **many** `RPT-…-blocked-*` folders — blocking is the default.

**Local run (Track A) — only after your Docker verification:**
6. Terminal: the three commands, with the `[seed]` step log mid-run.
7. Dashboard **Decision Inbox** surface populated.
8. Dashboard generated **deep report** with its visible quality label / caveats.
9. Dashboard **Report Backfill** closure panel showing missing-evidence classes as backfill targets.

**Suggested GIF order:** 1 → 2 → 5 → 7 → 9 (BLOCKED first, blocking-as-default second, then the local loop). Keep total runtime ≤ 90s.

---

## 60–90s spoken script (for voiceover or X thread captions)

> **[0:00]** "Most AI research tools end on a confident buy-signal. Here's one that refuses to."
> **[0:06]** *(BLOCKED report banner)* "This is a real report in the repo. Its own banner says: Research Priority D — not an investment memo. Collect the required evidence first."
> **[0:18]** *(Why Not Review-Ready Yet)* "It names exactly why: no issuer has a live operating bridge; negative controls, controlled market validation, and issuer evidence aren't there yet. Eight gates have to close before it can be promoted."
> **[0:32]** *(folder of blocked reports)* "And this isn't staged — dozens of reports sit blocked. 'Not ready' is the default state, not the exception."
> **[0:42]** *(local run — only if verified)* "It runs locally with zero API keys: docker compose up, seed, dev."
> **[0:55]** *(dashboard / backfill)* "Every missing evidence class becomes a concrete backfill task — the report records what's missing and queues it for collection."
> **[1:10]** "No autonomous trading, no auto-promotion — a human always promotes. The conservative gates are the point. Local-first, open source. Link below."

---

## 한국어 캡션 (X 스레드용 짧은 버전)

> 대부분의 AI 리서치 도구는 자신감 있는 매수 신호로 끝납니다. Lattice는 반대입니다.
> 리포트 자체 배너가 말합니다: **"Research Priority D — 투자 메모 아님. 결정에 쓰기 전에 필요한 증거부터 수집하라."**
> **"Why Not Review-Ready Yet"** 섹션이 빠진 게이트를 정확히 나열합니다 — 발행기관 연결, 네거티브 컨트롤, 통제된 시장 검증 등. 여덟 개 게이트가 모두 닫혀야 승격됩니다.
> 이건 연출이 아닙니다. 저장소에는 차단(blocked) 상태 리포트가 수십 개 — "아직 준비 안 됨"이 기본값입니다.
> 로컬에서 API 키 없이 실행됩니다: `docker compose up` → `npm run demo:seed` → `npm run dev`.
> 자동 매매 없음, 자동 승격 없음 — 승격은 항상 사람이 합니다. 보수적인 게이트가 핵심입니다. 로컬 우선, 오픈소스.

*(주의: 위 로컬 실행 장면은 Docker 엔드투엔드 검증을 한 번 마친 뒤에만 녹화하세요. BLOCKED 리포트 장면은 그대로 사용 가능합니다.)*