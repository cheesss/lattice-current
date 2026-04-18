# Analyst Workstation Reframe

> **Status**: proposed (surface design captured; Decision Inbox + 5-surface split shipped in commit `53a40998`, trust/freshness layer landing incrementally)

Date: 2026-04-15  
Scope: `event-dashboard.html` 중심 surface, theme shell, review queues, geo lens, analytics, trust/freshness layer

## 1. 핵심 판단

현재 제품의 본질은 `예쁜 대시보드`가 아니라 `모니터링, 조사, 승인, 탐색이 동시에 일어나는 analyst workstation`이다.

문제는 기능 부족이 아니다. 이미 시스템은 아래를 갖고 있다.

- 50개 이상 API
- E2 Signal Queue
- Theme Brief
- Proposal Inbox / Approval Queue / Discovery Triage
- 2D Geo Lens
- Snapshot cards
- Analytics charts
- Automation / Ops drawer

하지만 이 강한 기능이 현재 한 surface에 같은 위계로 공존하면서, 제품의 실제 해자인 `counterfactual uplift`, `evidence ladder`, `validation-aware proof`가 headline feed처럼 소비되고 있다.

따라서 이번 개편의 목표는 시각적 리스킨이 아니라 다음 세 가지다.

1. 정보구조 재설계
2. trust layer 전면화
3. decision flow 우선화

한 줄 정의:

> 이 제품은 “정보가 많은 대시보드”가 아니라 “검증된 신호를 빠르게 승인하고 조사하는 리뷰 시스템”으로 재정의되어야 한다.

## 2. 현재 구조의 핵심 문제

현재 첫 surface에는 네 가지 작업 문법이 동시에 충돌한다.

- Monitor: KPI, 상태, freshness, 요약 snapshot
- Decide: E2, proposals, approvals, triage
- Investigate: Theme Brief, evidence, related entities, reports
- Explore: map, analytics, correlation, heatmap, transmission

이 구조의 결과는 다음과 같다.

- 정보 밀도는 높지만 결정 밀도는 낮다
- 강한 모델이 약한 레이아웃에 희석된다
- stale / fallback / empty shell / source mismatch가 보조 정보처럼 묻힌다
- 사용자는 “지금 뭘 해야 하는가”보다 “뭘 읽어야 하는가”에 더 많은 시간을 쓴다

즉 현재 UI의 문제는 미관보다 `작업 단위가 섞여 있는 것`이다.

## 3. 제품 중심 문법

제품의 중심 문법은 아래처럼 고정하는 것이 맞다.

`Alert -> Proof -> Action`

이 문법에서 각 단계는 다음 의미를 가진다.

- Alert: 무슨 일이 생겼는가
- Proof: 왜 이게 유의미하고 검증된 신호인가
- Action: 내가 무엇을 승인, 보류, 추적, 재검증해야 하는가

중요한 점은 `탐지`가 아니라 `검증`이 제품 해자라는 것이다.

Dataminr는 경보를 잘 다룬다.  
AlphaSense는 리서치 워크플로를 잘 다룬다.  
Recorded Future는 관계 기반 intelligence graph를 잘 다룬다.  
Perplexity는 출처 투명성을 잘 드러낸다.  

이 제품은 그 사이에서 `통계적으로 검증된 proof`를 중심 object로 삼을 수 있다.  
따라서 first screen은 `무슨 일이 났다`보다 `무슨 일이 검증됐고, 무엇을 처리해야 한다`를 답해야 한다.

## 4. 새 정보구조

단일 mega-dashboard 대신 아래 5개 surface로 분리하는 것이 맞다.

### 4.1 Home / Monitor

목적: 상황 인지

포함:

- current posture
- freshness strip
- top signal summary
- major changes 3개
- selected watchlist overview

제외:

- 긴 analytics
- deep map investigation
- dense review queues

### 4.2 Decision Inbox

목적: 처리와 승인

통합 대상:

- E2 Signal Queue
- Proposal Inbox
- Approval Queue
- Discovery Triage

이 4개는 기능적으로 모두 `review before commit`이다.  
카드 묶음이 아니라 하나의 inbox 안에서 type, urgency, freshness, assignee, theme로 필터링되어야 한다.

### 4.3 Investigate / Research Brief

목적: 한 신호나 테마를 깊게 조사

중심 object:

- Theme Brief
- event proof
- evidence list
- related entities
- timeline
- watch next
- notebook hooks

### 4.4 Geo Lens

목적: 공간 기반 가설 검증

중심 object:

- theme-aware map preset
- hotspot
- transmission path
- country/corridor pressure
- time playback

### 4.5 Ops

목적: 데이터 품질과 자동화 신뢰 관리

포함:

- stale/fallback state
- data quality
- automation audit
- source ops
- runtime health
- scheduler/worker status

## 5. First Viewport 원칙

스크롤 없이 보여야 할 것은 네 개뿐이다.

- 새 E2 signals
- pending decisions
- selected proof card
- freshness / regime strip

즉 현재처럼 상단에 참조 KPI, snapshot, 큐, brief, map 문법이 동시에 올라오면 안 된다.

권장 배치:

- 좌측: filter / watch rail
- 중앙: proof-first canvas
- 우측: decision rail

중요한 기준:

- 많이 보이는 것보다 바로 결정 가능한 것이 먼저
- 상단은 읽기보다 처리와 신뢰 판단을 우선

## 6. Trust Layer

이 개편의 1순위는 시각 디자인이 아니라 trust layer다.

모든 핵심 카드와 row에는 아래 정보가 같은 문법으로 붙어야 한다.

- freshness
- fallback 여부
- provenance / source count
- evidence count
- contradiction count
- why this item is shown
- proof level

이 trust layer가 없으면 Decision Inbox나 Theme Brief를 키워도 오히려 혼란만 커진다.

### 6.1 필수 trust 표시

- `Fresh`
- `Stale`
- `Fallback`
- `Not hydrated`
- `Evidence-only degraded mode`

### 6.2 신호 카드의 최소 proof schema

각 signal card는 최소 아래 필드를 공통으로 가져야 한다.

- direction
- abnormal return
- uplift
- t-stat
- matched controls count
- freshness
- source-quality
- proof level
- why this is E2/E3/E4

## 7. Decision Inbox 설계

Decision Inbox는 Linear의 triage inbox와 GitHub notifications inbox 패턴을 적극 참고하는 것이 맞다.

필수 기능:

- bulk accept / reject / suppress / snooze
- single-key triage
- side preview
- saved filters
- grouping
- freshness badge
- reason log
- assignee / reviewer
- multi-select

### 7.1 공통 review object schema

UI를 합치기 전에 아래 필드가 먼저 표준화되어야 한다.

- `id`
- `type`
- `theme`
- `urgency`
- `freshness`
- `proofLevel`
- `evidenceCount`
- `decisionState`
- `sourceTrust`
- `whyVisible`
- `createdAt`
- `updatedAt`
- `owner`

이 schema 없이 Proposal/Approval/Triage/E2를 한 inbox에 얹으면, 화면만 합쳐지고 제품은 합쳐지지 않는다.

## 8. Theme Brief 재정의

Theme Brief는 단순 요약 카드가 아니라 `intelligence dossier`가 되어야 한다.

권장 구조:

- What changed
- Why it matters
- Evidence
- Timeline
- Related entities
- Watch next
- Notebook

여기에 Perplexity식 numbered citation과 Recorded Future식 intelligence card 문법을 결합하는 것이 맞다.

### 8.1 dossier 원칙

- claim 옆에 citation 번호 표시
- 각 claim에 freshness 시각 표시
- fallback 이유 명시
- contradiction 존재 시 바로 노출
- drill-through 시 context 유지

즉 `요약`보다 `검증 가능한 조사 object`로 바꾸는 것이 핵심이다.

## 9. 차트와 시계열

차트는 화면 하단 장식이 아니라 decision surface의 일부여야 한다.

권장 방향:

- 하나의 강한 차트 + event mark + synced cursor + regime band
- signal -> validation -> position review 흐름을 끊지 않는 구조

TradingView 패턴은 특히 아래에 적합하다.

- signal timeline
- alpha decay
- regime timeline
- event impact
- watchlist-linked detail

하지 말아야 할 것:

- analytics panel을 단순 카드 그리드로 계속 확장
- 이벤트와 검증 차트를 서로 분리해 탐색 컨텍스트를 잃는 것

## 10. Geo Lens와 Network

지도는 `많은 레이어`가 아니라 `빠른 hypothesis test`를 지원해야 한다.

원칙:

- 기본 상태는 3~5개 핵심 레이어만 ON
- 나머지는 preset / command palette로 호출
- always-on 레이어를 줄이고 theme preset으로 분기
- map은 investigation page로 승격

역할 분리:

- 지도: deck.gl 기반 geo lens
- 분석용 네트워크: Cytoscape.js
- 편집형 workflow canvas: React Flow

즉 지도, 분석 그래프, 워크플로 노드 UI를 같은 컴포넌트 문법으로 처리하면 안 된다.

## 11. Dense Queue와 테이블

Approval Queue, Proposal Inbox, Discovery Triage처럼 항목 수가 커지는 surface는 카드 DOM 누적 방식에서 벗어나야 한다.

권장 방향:

- AG Grid Server-Side Row Model
- 또는 TanStack Table + TanStack Virtual

선택 기준:

- 매우 큰 데이터셋과 enterprise grid 기능이 필요하면 AG Grid
- headless, 커스터마이즈, 디자인 일체감이 중요하면 TanStack 조합

지금 구조에서는 후자가 더 자연스럽지만, 데이터량이 커지면 전환 가능성을 열어두는 것이 맞다.

## 12. 상호작용 계층

이 제품은 power-user 도구다.  
상단 드롭다운보다 `command palette`, `keyboard shortcut`, `consistent sheet/drawer`가 더 중요하다.

권장 조합:

- shadcn/ui
- Radix Primitives
- cmdk
- dnd-kit

이 조합은 다음을 해결한다.

- command palette
- keyboard-first triage
- 접근 가능한 primitive
- drag/reorder
- 디자인 시스템 일관성

## 13. 북극성 참고군

가장 직접적인 북극성 조합은 아래다.

- Recorded Future: single-view intelligence card, investigation pivot
- Linear: triage inbox, keyboard-first review
- OpenBB: widget/app/workspace analyst surface
- TradingView: event-aware time-series interaction
- Grafana / Metabase / Kibana / Superset: context bar, drilldown, cross-filter
- Perplexity: numbered citations, research hub

이 조합을 그대로 복제하는 것이 목적이 아니다.  
목적은 현재 제품의 강점인 `proof-first analyst workflow`에 맞는 패턴만 흡수하는 것이다.

## 14. 구현 우선순위

### P0

- evidence-first first screen
- stale / fallback / proof badge 통일
- Decision Inbox schema 정의
- first viewport를 `E2 + pending decisions + selected proof + freshness strip`으로 축소

### P1

- Decision Inbox 통합
- keyboard triage
- side preview
- bulk review actions

### P2

- Theme Brief dossier화
- numbered citations
- context-preserving drilldown
- timeline + related entities + notebook 통합

### P3

- Geo Lens 독립 investigation page
- network / graph surface 분리
- modular widget registry
- saved workspaces

## 15. 구현 순서에 대한 추가 판단

실행 순서는 단순히 `예쁜 화면 만들기`가 아니라 아래 순서가 맞다.

`trust-first -> inbox-first -> dossier-first -> explore/ops split`

즉:

1. Trust contract 통일
2. Decision Inbox 통합
3. Theme Brief dossier화
4. Explore / Geo / Ops 분리

이 순서를 어기고 먼저 큰 리디자인부터 하면, 데이터 정합성과 stale/fallback 문제가 더 깊숙이 숨는다.

## 16. 측정 기준

평가는 aesthetic이 아니라 작업시간과 신뢰도 기준으로 해야 한다.

최소 KPI:

- time to first actionable signal
- first-screen decision rate
- proposal review median interactions
- stale badge coverage
- contradictory-data incidents
- initial API p95
- map FPS
- scroll depth to first decision

### 계측 후보

- PostHog: heatmap, clickmap, scrollmap, rage click, dead click
- Lighthouse: performance / accessibility audit

## 17. 결론

이 제품의 UI/UX 개편은 색상, 카드 재배치, 시각적 polish가 핵심이 아니다.

핵심은 아래 다섯 가지다.

1. 데이터 신뢰 복구
2. Decision Inbox 통합
3. Theme Brief의 intelligence dossier화
4. global context bar와 drilldown 정립
5. 성능과 가상화 정리

최종 제품 정의:

> 이 시스템은 정보가 많은 dashboard가 아니라, 검증된 신호를 빠르게 승인하고 조사하는 analyst workstation이어야 한다.

