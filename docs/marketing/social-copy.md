# Lattice Current — Social Copy

Ready-to-post copy for launch. English-first; full Korean versions of the X thread and a build-log post are at the bottom.

Every claim here traces to a real mechanism or file in the repo. Keep it that way when you edit. The honesty boundary holds: report generation and the dashboard panels run locally with zero keys; live external news ingestion is an optional "go further" step that needs free Guardian/NYT keys plus a local Ollama embedding model. The no-DB report path is verified working. The local-DB demo path is layer-verified (12/12 unit tests, NAS-safety guard tested), but the full Docker end-to-end run is still pending one verification — do not claim screenshots or specific captured outputs from the DB path.

No alpha promises. Lattice is not an investment adviser, stock picker, or automated decision system.

---

## Reusable hooks (short)

Drop-in lines for replies, alt text, OG descriptions, or the first sentence of a post.

- Most AI research tools produce confident-looking reports. Lattice makes "not ready" a first-class output.
- A research OS that blocks its own reports until the evidence is actually there.
- Local-first, evidence-gated research OS. Eight gates have to close before a thesis can be promoted. A human still does the promoting.
- The hero screenshot is a report that refuses to be decision-ready and names exactly which evidence classes are missing.
- Raw evidence can't silently become promotion evidence. Every row has to clear an acceptance lane first.
- "What's still missing" is a concrete per-class list, not a vibe.

---

## X / Twitter thread (English)

**1/ (hook)**
Most AI research tools are optimized to produce a confident-looking report.

I built the opposite. Lattice Current is a local-first, evidence-gated research OS that blocks confident-looking reports until the evidence is actually there.

Open source. Runs on your machine.

**2/ (problem)**
The failure mode of "AI research" isn't bad prose. It's a clean report that reads as decision-ready while the evidence underneath is thin, stale, or circular.

The report looks done. Nobody can point to what's missing. That's the gap I wanted to close.

**3/ (design — the loop)**
The pipeline is explicit:

hot theme / signal → mechanism seed → universal evidence contract → missing-evidence-class detection → provider/source backfill → report closure + contradiction detection → BLOCKED or a human-reviewed promotion.

No step is implicit. No step auto-promotes.

**4/ (design — the contract)**
Every report carries a Universal Evidence Contract: it enumerates which evidence classes are *required* and which are *promotion-eligible*.

So "what's still missing" is a concrete per-class list, not a feeling.

(scripts/_shared/universal-evidence-contract.mjs)

**5/ (design — the acceptance lanes)**
Raw evidence can't become promotion evidence by default. Every collected row has to clear an acceptance lane: staleness, duplicate, generic-boilerplate, fixture-only, issuer bridge.

Negative-control and market-validation classes are hard-coded as non-promotion or local-controlled-only.

(scripts/_shared/seed-evidence-acceptance.mjs)

**6/ (design — "not ready" as output)**
"Not ready" is a named, first-class output. A report sits in BLOCKED / needs-fix with an explicit primaryBlocker and nextAction until eight evidence gates close: accepted promotion evidence, accepted evidence, independent source breadth (>= 2), issuer bridge, negative control, holdout, market validation, valuation bridge.

(scripts/_shared/evidence-gate-consolidator.mjs)

**7/ (the screenshot moment)**
Here's the part that inverts the usual confident-AI demo.

This is a real BLOCKED report from the repo. Banner: "Research Priority D; not an investment memo." Its "Why Not Review-Ready Yet" section names the exact missing gates: negative_control, controlled_market_validation, issuer_bridge, holdout_validation.

Dozens of sibling blocked reports are checked in. Blocking is the default, not a staged one-off.

[attach: hero screenshot of the BLOCKED report]

**8/ (repo + ask)**
Try it: a full evidence-first report generates with no database and no API keys —
`npm run report:deep -- --type theme_report --subject "AI / Machine Learning"`

Repo: https://github.com/cheesss/lattice-current
Pages: https://cheesss.github.io/lattice-current/

It is not an adviser, stock picker, or automated trader — a human always promotes. I'd like critique of the gate design. Where would you break it?

---

## LinkedIn (credibility post)

I've been building an open-source tool that takes the opposite stance from most "AI research" products, and it's now public.

The common failure mode in AI-generated research isn't bad writing. It's a clean, confident report that reads as decision-ready while the evidence underneath is thin, stale, or circular. The report looks finished, and nobody can point to what's actually missing.

Lattice Current is a local-first, evidence-gated research OS. Its core design choice: "not ready" is a named, first-class output. A report stays in BLOCKED / needs-fix — with an explicit primary blocker and next action — until eight evidence gates close (scripts/_shared/evidence-gate-consolidator.mjs).

Three mechanisms make that real rather than cosmetic:

- Every report carries a Universal Evidence Contract that enumerates which evidence classes are required and which are promotion-eligible, so "what's still missing" is a concrete per-class list (scripts/_shared/universal-evidence-contract.mjs).
- Raw evidence can't become promotion evidence by default: every collected row must clear an acceptance lane — staleness, duplicate, generic-boilerplate, fixture-only, issuer bridge — and negative-control and market-validation classes are hard-coded as non-promotion or local-controlled-only (scripts/_shared/seed-evidence-acceptance.mjs).
- A real BLOCKED report is checked into the repo, with a "Why Not Review-Ready Yet" section that names the exact missing gates. Dozens of sibling blocked reports sit beside it — blocking is the default, not a demo.

What it is not: not an investment adviser, not a stock picker, not an automated decision system. The autonomous loops keep readiness, candidate, and portfolio writes at zero. A human always performs the promotion. Market validation only reaches decision-grade from local controlled event data — it is not durable alpha, and it's explicitly caveated.

You can generate a complete evidence-first report with no database and no API keys:
`npm run report:deep -- --type theme_report --subject "AI / Machine Learning"`

Repo: https://github.com/cheesss/lattice-current

If you work on research tooling, evaluation, or data quality, I'd value your critique of the gate design.

---

## Reddit drafts

Framed as a technical writeup asking for critique. Read each subreddit's rules first and adjust before posting. Good candidates: r/opensource, r/selfhosted, r/dataengineering. r/algotrading only if you lead hard with the "not an adviser / not a backtester" framing, since that crowd will (correctly) probe for alpha claims you are not making.

### Draft A — r/opensource / r/selfhosted (architecture-first)

**Title:** I built a local-first research tool that blocks its own reports until the evidence is actually there — looking for critique of the gate design

**Body:**

Most AI research tooling emits a confident-looking report by default. I went the other way and made "not ready" a first-class output. Sharing the design because I want it pulled apart, not upvoted.

The pipeline is explicit end to end:

hot theme / signal → mechanism seed → universal evidence contract → missing-evidence-class detection → provider/source backfill → report closure + contradiction detection → BLOCKED or human-reviewed promotion.

Three load-bearing pieces:

1. **Evidence gates.** A report stays in BLOCKED / needs-fix with an explicit `primaryBlocker` and `nextAction` until eight evidence gates close — accepted promotion evidence, accepted evidence, independent source breadth (>= 2), issuer bridge, negative control, holdout, market validation, valuation bridge (`scripts/_shared/evidence-gate-consolidator.mjs`).
2. **Acceptance lanes.** Raw evidence can't become promotion evidence by default. Every collected row has to clear an acceptance lane — staleness, duplicate, generic-boilerplate, fixture-only, issuer bridge. Negative-control and market-validation classes are hard-coded as non-promotion or local-controlled-only (`scripts/_shared/seed-evidence-acceptance.mjs`).
3. **Universal Evidence Contract.** Each report enumerates which evidence classes are required and which are promotion-eligible, so "what's missing" is a per-class list (`scripts/_shared/universal-evidence-contract.mjs`).

There's a real BLOCKED report checked into the repo with a "Why Not Review-Ready Yet" section naming the missing gates (negative_control, controlled_market_validation, issuer_bridge, holdout_validation). Dozens of sibling blocked reports sit next to it, so blocking is the default state, not a staged demo.

**Running it locally.** Report generation and the dashboard panels run with zero keys. The no-DB path is verified:

```
npm run report:deep -- --type theme_report --subject "AI / Machine Learning"
```

That produces a complete report (report.html + audit appendix + evidence_table.csv) with no database and no API keys.

For the local-DB demo:

```
docker compose up -d   # local Postgres + pgvector
npm run demo:seed      # schema + demo data + a DB-backed report, zero keys
npm run dev            # open the dashboard
```

Honest status: the DB demo path is layer-verified (12/12 unit tests, NAS-safety guard tested), but I still have one full Docker end-to-end verification pending — flag anything that breaks. Live external news ingestion is optional and additionally needs free Guardian/NYT keys plus a local Ollama embedding model; it's not part of the default demo.

What it is **not**: not an investment adviser, stock picker, or automated trader. Autonomous loops keep readiness/candidate/portfolio writes at zero; a human always promotes.

Repo: https://github.com/cheesss/lattice-current

The question I actually want answered: where does the gate model leak? What evidence would you expect a row to clear that none of these five acceptance lanes would catch?

### Draft B — r/dataengineering (data-quality angle)

**Title:** Treating "report not ready" as a first-class pipeline state instead of a soft warning — design writeup, want critique

**Body:**

I've been working on a research pipeline where the interesting design problem is data-quality gating, not generation. Posting the architecture for critique.

The core stance: a report is not allowed to present as decision-ready until specific evidence classes exist. "Not ready" is a real terminal state (BLOCKED / needs-fix) carrying an explicit primary blocker and next action, gated on eight evidence gates closing (`scripts/_shared/evidence-gate-consolidator.mjs`).

Two pieces that matter for anyone who's fought provenance/lineage:

- **Acceptance lanes between collection and promotion.** A collected row is not automatically usable. It has to clear staleness, duplicate, generic-boilerplate, fixture-only, and issuer-bridge checks before it can count toward promotion. Negative-control and market-validation classes are hard-coded as non-promotion or local-controlled-only — they can inform but never promote (`scripts/_shared/seed-evidence-acceptance.mjs`).
- **A per-report evidence contract.** Each report enumerates required vs promotion-eligible evidence classes up front, so "what's missing" is computed against a declared contract rather than discovered by reading prose (`scripts/_shared/universal-evidence-contract.mjs`).

Source breadth is one of the gates, with a deliberately modest threshold (>= 2 independent sources) — I'd rather under-claim there than pretend two sources is consensus.

You can run a full report with no DB and no keys:
```
npm run report:deep -- --type theme_report --subject "AI / Machine Learning"
```

Honest caveat: the local-Postgres/pgvector demo is layer-verified (12/12 unit tests, NAS-safety guard tested), but one full Docker end-to-end run is still pending; the no-DB report path is verified.

Not an adviser, not a backtester (the heavy backtest/ML modules live on a separate legacy branch, not in the product), no auto-promotion.

Repo: https://github.com/cheesss/lattice-current

Critique I'm after: is "acceptance lane" the right boundary, or should staleness/duplicate live further upstream at ingestion? How would you model the negative-control class so it can never leak into promotion?

---
---

# 한국어 (Korean)

전체 한국어 버전: X 스레드 + Disquiet/GeekNews 스타일 빌드로그.

## X / 트위터 스레드 (한국어)

**1/ (훅)**
대부분의 AI 리서치 도구는 "그럴듯해 보이는 보고서"를 만들도록 최적화돼 있습니다.

저는 정반대를 만들었습니다. Lattice Current는 로컬 우선(local-first), 증거 게이트(evidence-gated) 리서치 OS입니다. 증거가 실제로 갖춰지기 전까지 그럴듯해 보이는 보고서를 차단합니다.

오픈소스이고, 본인 컴퓨터에서 돌아갑니다.

**2/ (문제)**
"AI 리서치"의 진짜 실패는 글이 나빠서가 아닙니다. 깔끔한 보고서가 의사결정에 바로 쓸 수 있는 것처럼 읽히는데, 정작 근거는 빈약하거나 오래됐거나 순환 논증인 경우입니다.

보고서는 완성된 것처럼 보이고, 뭐가 빠졌는지는 아무도 짚어내지 못합니다. 제가 메우고 싶었던 건 그 틈입니다.

**3/ (설계 — 루프)**
파이프라인은 전부 명시적입니다.

핫 테마/시그널 → 메커니즘 시드 → 범용 증거 계약(universal evidence contract) → 누락 증거 클래스 탐지 → 프로바이더/소스 백필 → 보고서 클로저 + 모순 탐지 → BLOCKED 또는 사람이 검토한 승격(promotion).

암묵적인 단계는 없습니다. 자동으로 승격되는 단계도 없습니다.

**4/ (설계 — 계약)**
모든 보고서는 범용 증거 계약을 들고 다닙니다. 어떤 증거 클래스가 *필수*이고 어떤 클래스가 *승격 가능*인지를 열거합니다.

그래서 "아직 뭐가 빠졌는가"는 느낌이 아니라 클래스별 구체 목록입니다.

(scripts/_shared/universal-evidence-contract.mjs)

**5/ (설계 — 수용 레인)**
원천 증거가 기본값으로 승격 증거가 되는 일을 구조적으로 막습니다. 수집된 모든 행은 수용 레인(acceptance lane)을 통과해야 합니다: 신선도(staleness), 중복, 일반 보일러플레이트, 픽스처 전용, 발행자 브리지(issuer bridge).

네거티브 컨트롤과 시장 검증(market-validation) 클래스는 비승격 또는 로컬-통제 전용으로 하드코딩돼 있습니다.

(scripts/_shared/seed-evidence-acceptance.mjs)

**6/ (설계 — "준비 안 됨"이 출력)**
"준비 안 됨(not ready)"은 이름이 붙은 일급 출력입니다. 보고서는 여덟 개의 증거 게이트가 닫히기 전까지 명시적인 primaryBlocker와 nextAction을 달고 BLOCKED / needs-fix 상태에 머뭅니다. 게이트는 승격 증거 채택, 증거 채택, 독립 소스 폭(2개 이상), 발행자 브리지, 네거티브 컨트롤, 홀드아웃, 시장 검증, 밸류에이션 브리지입니다.

(scripts/_shared/evidence-gate-consolidator.mjs)

**7/ (스크린샷 순간)**
여기가 보통의 "자신만만한 AI 데모"를 뒤집는 지점입니다.

리포지토리에 실제로 들어 있는 BLOCKED 보고서입니다. 배너: "Research Priority D; not an investment memo." "Why Not Review-Ready Yet" 섹션이 빠진 게이트를 정확히 짚습니다: negative_control, controlled_market_validation, issuer_bridge, holdout_validation.

비슷한 BLOCKED 보고서가 수십 개 커밋돼 있습니다. 차단은 연출된 일회성이 아니라 기본값입니다.

[첨부: BLOCKED 보고서 히어로 스크린샷]

**8/ (리포 + 요청)**
직접 해보세요. 데이터베이스도, API 키도 없이 완전한 증거 우선 보고서가 생성됩니다 —
`npm run report:deep -- --type theme_report --subject "AI / Machine Learning"`

리포: https://github.com/cheesss/lattice-current
페이지: https://cheesss.github.io/lattice-current/

이건 자문 도구도, 종목 추천기도, 자동 매매 시스템도 아닙니다. 승격은 언제나 사람이 합니다. 게이트 설계에 대한 비판을 듣고 싶습니다. 어디서 깨뜨리시겠어요?

---

## Disquiet / GeekNews 스타일 빌드로그 (한국어)

**제목:** 자기 보고서를 스스로 차단하는 리서치 도구를 만들었습니다 — "준비 안 됨"을 일급 출력으로

**본문:**

요즘 AI 리서치 도구 대부분은 "그럴듯한 보고서"를 뽑는 데 최적화돼 있습니다. 문제는 보고서가 의사결정에 바로 쓸 수 있는 것처럼 읽히는데, 근거는 빈약하거나 오래됐거나 순환 논증인 경우가 많다는 겁니다. 완성돼 보이지만 뭐가 빠졌는지는 아무도 못 짚죠.

그래서 정반대 입장의 도구를 만들었습니다. Lattice Current는 로컬 우선, 증거 게이트 리서치 OS이고, 핵심 설계 선택은 하나입니다. **"준비 안 됨"을 이름이 붙은 일급 출력으로 다룬다.**

### 왜 이렇게 만들었나

보고서가 그럴듯해 보이는 걸 막는 가장 확실한 방법은, 증거가 실제로 존재하기 전까지 "검토 준비됨" 상태 자체를 허용하지 않는 것이라고 봤습니다. 그래서 보고서는 여덟 개의 증거 게이트가 닫히기 전까지 BLOCKED / needs-fix 상태에 머뭅니다. 각 보고서는 명시적인 primaryBlocker와 nextAction을 달고 있습니다 (scripts/_shared/evidence-gate-consolidator.mjs).

### 이게 겉치레가 아니게 만드는 세 가지

1. **범용 증거 계약.** 보고서마다 어떤 증거 클래스가 필수이고 어떤 게 승격 가능인지 미리 열거합니다. 그래서 "아직 뭐가 빠졌나"는 클래스별 구체 목록으로 계산됩니다 (scripts/_shared/universal-evidence-contract.mjs).
2. **수용 레인.** 수집한 행이 기본값으로 승격 증거가 되지 않습니다. 신선도, 중복, 일반 보일러플레이트, 픽스처 전용, 발행자 브리지를 통과해야 합니다. 네거티브 컨트롤과 시장 검증 클래스는 비승격 또는 로컬-통제 전용으로 하드코딩돼 있어, 참고는 되지만 승격에는 절대 못 쓰입니다 (scripts/_shared/seed-evidence-acceptance.mjs).
3. **실제 BLOCKED 보고서가 리포에 들어 있습니다.** "Why Not Review-Ready Yet" 섹션이 빠진 게이트를 정확히 이름으로 짚습니다(negative_control, controlled_market_validation, issuer_bridge, holdout_validation). 비슷한 BLOCKED 보고서가 수십 개 옆에 있어서, 차단이 데모용 연출이 아니라 기본 상태임을 보여줍니다.

### 돌려보기

보고서 생성과 대시보드 패널은 키 없이 로컬에서 돕니다. DB 없는 경로는 검증돼 있습니다:

```
npm run report:deep -- --type theme_report --subject "AI / Machine Learning"
```

데이터베이스도 API 키도 없이 완전한 보고서(report.html + 감사 부록 + evidence_table.csv)가 나옵니다.

로컬 DB 데모:

```
docker compose up -d   # 로컬 Postgres + pgvector
npm run demo:seed      # 스키마 + 데모 데이터 + DB 기반 보고서, 키 0개
npm run dev            # 대시보드 열기
```

### 솔직한 상태와 경계

- DB 데모 경로는 레이어 검증 완료(유닛 테스트 12/12 통과, NAS 안전 가드 테스트됨)이지만, 전체 Docker 엔드투엔드 실행 검증이 아직 한 번 남아 있습니다. 깨지는 게 보이면 알려주세요. (이 경로의 스크린샷이나 캡처된 출력은 아직 주장하지 않습니다.)
- 라이브 외부 뉴스 인제스션은 선택 사항이고, 무료 Guardian/NYT 키와 로컬 Ollama 임베딩 모델이 추가로 필요합니다. 기본 데모에 포함되지 않습니다.
- 이건 투자 자문 도구도, 종목 추천기도, 자동 매매 시스템도 아닙니다. 자율 루프는 readiness/candidate/portfolio 쓰기를 0으로 유지하고, 승격은 언제나 사람이 합니다. 시장 검증은 로컬 통제 이벤트 데이터에서만 의사결정급에 도달하며, 지속 가능한 알파가 아니라 명시적으로 단서를 답니다. 소스 게이트 임계값은 독립 소스 2개 이상으로, 의도적으로 보수적입니다.

리포: https://github.com/cheesss/lattice-current
페이지: https://cheesss.github.io/lattice-current/

게이트 설계에 대한 비판을 가장 듣고 싶습니다. 다섯 개의 수용 레인 중 어느 것도 못 잡는 증거가 있다면 어떤 걸까요?