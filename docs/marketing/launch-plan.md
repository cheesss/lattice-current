# Lattice Current — Launch Plan

This is the sequenced plan for putting Lattice Current in front of the right people. Execute it top-to-bottom. Nothing ships until the **pre-launch checklist** is green, and the hard gate is one line: **the repo must be verified-runnable before Show HN.**

Lattice is a local-first, evidence-gated research OS that blocks confident-looking reports until the evidence is actually there. The launch sells that one idea — *"not ready" is a first-class output* — and nothing more. No alpha promises, no "automated decisions," no live backtesting product.

---

## 0. The one thing the launch is about

The wedge is the message. Most AI research tools emit a confident-looking report and call it done. Lattice makes **"not ready"** a named, first-class output: a report sits in `BLOCKED` / needs-fix with an explicit `primaryBlocker` + `nextAction` until eight evidence gates close (`scripts/_shared/evidence-gate-consolidator.mjs`). Raw collected evidence is structurally prevented from becoming promotion evidence — every row must clear an acceptance lane, and the negative-control / market-validation classes are hard-coded as non-promotion or local-controlled-only (`scripts/_shared/seed-evidence-acceptance.mjs` emits `negative_control_not_promotion_evidence` and requires `local_controlled_market_data`). Every report ships a Universal Evidence Contract that enumerates which classes are required and which are promotion-eligible (`promotionEligible: true/false` per class), so "what is still missing" is a concrete per-class list (`scripts/_shared/universal-evidence-contract.mjs`).

Everything below exists to put that mechanism, and the real `BLOCKED` report artifact, in front of people who read "it blocks its own reports" as a feature.

**Short Korean positioning blurb (for KO channels later):**

> Lattice Current는 로컬 우선(local-first) 증거 게이트형 리서치 OS입니다. AI 리서치 도구 대부분이 "그럴듯해 보이는" 보고서를 내놓는 반면, Lattice는 **"아직 준비 안 됨(not ready)"을 1급 결과로** 취급합니다. 발행사 노출, 시장 검증, 음성 대조군(negative control), 출처 다양성, 채택된 증거가 실제로 존재하기 전까지 보고서는 `BLOCKED` 상태에 머무르며 무엇이 빠졌는지를 클래스 단위로 명시합니다. 투자 자문이나 종목 추천 도구가 아닙니다.

---

## 1. Channel order (and why each)

The order is deliberate: build the artifact first, then move from the most honesty-tolerant audience outward. Do not skip ahead.

1. **README / GitHub Pages** — *the canonical artifact.* Every other channel links here. If the README hook and the runnable demo aren't right, nothing downstream works. This is home base, not a promo.
2. **Show HN** (`Show HN: Lattice - a local-first evidence-gated research OS`) — *HN rewards technical honesty over polish.* The conservative evidence gates are the differentiator, and HN is the audience most likely to read "it blocks its own reports" as the point. Highest-leverage post, which is exactly why it goes only after the repo is verified-runnable.
3. **X demo thread** — *visual proof.* The hero screenshot (real `BLOCKED` report) and a short GIF carry it. X is where the inverted "confident-AI-buy-signal" demo spreads.
4. **LinkedIn credibility post** — *slower, professional audience.* Frames the same artifact as a methodology stance (evidence gating, negative controls) rather than a hot take.
5. **Reddit** — *only after reading each subreddit's rules and recent top posts.* Candidates, each needing a tailored angle: r/opensource, r/selfhosted, r/OSINT, r/algotrading, r/dataengineering, r/MachineLearning. Treat each as a separate launch; do not cross-post the same text.
6. **Product Hunt / Korean communities (Disquiet, GeekNews, Velog)** — *later.* These expect a finished feel and benefit from the feedback gathered in steps 1–5. Korean channels get the full KO copy.

One line: **earn credibility with the honest crowd first, then let it propagate.**

---

## 2. Pre-launch checklist (gate for Show HN)

Show HN does not go out until **every** box here is checked. The first item is the hard gate.

- [ ] **Repo is verified-runnable.** The no-DB report path is the proof: `npm run report:deep -- --type theme_report --subject "AI / Machine Learning"` generates a complete, real evidence-first report (`report.html` + audit appendix + `evidence_table.csv`) with **no database and no API keys**. This path is verified working and must re-run clean on a fresh checkout before launch.
  - The local-DB demo path (`docker compose up -d` → `npm run demo:seed` → `npm run dev`) is layer-verified (12/12 unit tests, NAS-safety guard tested), but the **full Docker end-to-end run is pending one verification.** Do **not** publish Docker screenshots or claim captured outputs until that single run is done. Document the commands as real; do not imply more polish than exists.
- [ ] **README hook is the wedge.** First screen states the one-liner and shows that "not ready" is a first-class output. It links directly to the real `BLOCKED` report artifact and to GitHub Pages. No alpha language.
- [ ] **Social-preview image generated.** Use the existing generator: `npm run branding:social` (`scripts/generate-social-preview.mjs`). This produces the og:image for HN link unfurls, X, and LinkedIn.
- [ ] **GIF of the blocked report.** A short screen capture walking the real artifact at `data/reports/RPT-validated-cross-theme-bottleneck-report-blocked-*/report.html`: the banner ("Research Priority D; not an investment memo — collect required evidence classes before treating the report as decision-ready") and the "Why Not Review-Ready Yet" section naming the exact missing gates (`negative_control`, `controlled_market_validation`, `issuer_bridge`, `holdout_validation`). This is the hero asset.
- [ ] **Hero screenshot picked.** Static frame of the same `BLOCKED` report for channels where a GIF won't embed (LinkedIn, some Reddit).
- [ ] **Repo topics + description cleaned of "backtesting."** The heavy backtest/replay-ML modules live on the `legacy/backtest` branch and are **not** a live product feature. GitHub topics, repo description, README, and Pages must not imply a live backtesting product. Search the public-facing text and remove stray "backtest" framing.
- [ ] **Honesty boundary stated once, clearly.** Report generation + dashboard panels run locally with zero keys. LIVE external news ingestion additionally needs free Guardian/NYT keys + a local Ollama embedding model — present this strictly as an optional "go further" step, never as part of the default demo.
- [ ] **Overclaim sweep.** Confirm no copy implies: investment adviser, stock picker, alpha guarantee, fully-automated decisions, autonomous trading, or auto-promotion. All autonomous loops keep readiness/candidate/portfolio writes at 0 — a human promote is always required. The source-breadth gate is `>= 2` independent sources (`independent_source_breadth` in `evidence-gate-consolidator.mjs`); do not inflate it.

---

## 3. Definition of done, per channel

A channel is "done" when its checklist below is satisfied — not when the post is merely published.

**README / Pages**
- One-liner above the fold; wedge visible without scrolling.
- Both demo paths documented as real commands: the verified no-DB path first, the local-DB path second with its pending-verification caveat stated.
- Direct link to the real `BLOCKED` report artifact and to the live Pages site.
- og:image present (from `branding:social`); link unfurls correctly when pasted into HN/X/LinkedIn.
- No "backtesting" in description, topics, or body.

**Show HN**
- Title exactly: `Show HN: Lattice - a local-first evidence-gated research OS`.
- First comment from the author: what it is, the wedge, the honest boundary (zero-keys local vs. optional live ingestion), and the one-line "what this is NOT" (not an adviser / stock-picker / auto-trader).
- Repo verified-runnable on a fresh checkout (the no-DB path) — confirmed the morning of posting.
- Author present to answer for the first several hours.
- *Done =* posted, top comment live, author responsive, no unaddressed factual correction left in thread.

**X demo thread**
- Thread leads with the GIF of the `BLOCKED` report.
- Each following post shows one mechanism: the evidence contract, the acceptance lanes, the per-class "what's missing" list — each traceable to its `_shared/*.mjs` file.
- Closes with repo + Pages link.
- *Done =* thread published, hero GIF renders inline, links resolve.

**LinkedIn credibility post**
- Framed as methodology: why "not ready" is a first-class output and why negative controls / market-validation caveats matter.
- Static hero screenshot attached.
- Explicit non-claims line (no alpha, no auto-decisions).
- *Done =* posted with correct image unfurl and working repo link.

**Reddit (per subreddit)**
- Read the subreddit's rules and recent top posts **before** writing; tailor the angle (e.g., r/selfhosted → local-first + Docker; r/OSINT → source breadth & acceptance lanes; r/dataengineering → the evidence pipeline; r/algotrading → the explicit "not alpha, human promote required" honesty).
- Disclose authorship per each sub's self-promotion rules.
- *Done =* posted in compliance with that sub's norms, author monitoring comments.

**Product Hunt / Korean communities (later)**
- Full Korean copy ready (Disquiet, GeekNews, Velog); short KO positioning blurb (Section 0) as the spine.
- Gallery uses the hero GIF + social-preview image.
- Launched only after the Docker end-to-end run is verified, so the "finished" framing these channels expect is honest.
- *Done =* listing live, KO copy reviewed, assets attached.

---

## 4. Two-to-three week follow-up cadence

After the initial spike, the goal is to show that **blocking is the norm, not a staged one-off** — the repo already holds dozens of sibling `RPT-...-blocked-*` folders. Each follow-up reinforces one real mechanism with one concrete artifact.

**Week 1 — launch spike**
- Day 1: README/Pages final, then Show HN (morning, author free for the day).
- Day 1–2: X demo thread once HN has traction.
- Day 3–4: LinkedIn credibility post.
- Day 5–7: Reddit, one subreddit at a time, spaced out and rule-checked individually.

**Week 2 — mechanism deep-dives** (short posts/threads, one per mechanism, each linking back to the repo)
- The eight evidence gates and the `primaryBlocker` / `nextAction` contract (`scripts/_shared/evidence-gate-consolidator.mjs`).
- Acceptance lanes: why raw evidence can't become promotion evidence; negative-control / market-validation as non-promotion or local-controlled-only (`scripts/_shared/seed-evidence-acceptance.mjs`).
- The Universal Evidence Contract: per-report, per-class "required vs. promotion-eligible" listing (`scripts/_shared/universal-evidence-contract.mjs`).
- A walkthrough of the research loop: hot theme / signal / report artifact → mechanism seed → universal evidence contract → missing-class detection → provider/source-query backfill → report closure & contradiction detection → `BLOCKED` or human-reviewed promotion.

**Week 3 — durability + reach**
- "Blocking is the norm" post: point at the dozens of `RPT-...-blocked-*` folders as proof this isn't a single demo.
- Respond to and incorporate launch feedback (issues, README fixes).
- If the Docker end-to-end run is verified by now, publish the local-DB walkthrough with real screenshots.
- Korean channels (Disquiet, GeekNews, Velog) and Product Hunt with the full KO copy and finished assets.

Throughout: keep the honest boundary intact in every restatement — zero-keys local report + dashboard is the default; live news ingestion (Guardian/NYT keys + local Ollama) is the optional "go further." Never imply autonomous trading, durable alpha, or a live backtesting product.

---

## 5. Standing guardrails (apply to every post)

- **Mechanisms, not adjectives.** Cite the `_shared/*.mjs` file when stating a capability.
- **"Not ready" is the feature.** The conservative gates are the differentiator; never apologize for them.
- **No marketing slop.** No "unleash / seamless / revolutionary / supercharge / game-changing / effortless / cutting-edge," no filler "powerful / robust."
- **Single author.** Credit only the repo owner. No "independent research fork," no invented upstream.
- **Caveat the limits up front.** Market validation is not durable alpha; it reaches decision-grade only from local controlled event data and is explicitly caveated (`seed-evidence-acceptance.mjs` requires `local_controlled_market_data`). Source-breadth gate is `>= 2` independent sources.

---

### Asset reference
- Social preview / og:image: `npm run branding:social` → `scripts/generate-social-preview.mjs`
- No-DB report (verified): `npm run report:deep -- --type theme_report --subject "AI / Machine Learning"` → `scripts/generate-intelligence-report.mjs --depth deep`
- Local-DB demo (pending one end-to-end verification): `docker compose up -d` → `npm run demo:seed` (`scripts/seed-local-demo-db.mjs`) → `npm run dev`
- Hero artifact: `data/reports/RPT-validated-cross-theme-bottleneck-report-blocked-*/report.html`