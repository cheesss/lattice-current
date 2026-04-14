# Comprehensive Review Prompt

> 이 문서는 GitHub에 연결된 레포 전체를 대상으로, 제품/설계/데이터/운영/UI/상용화까지 포괄하는 전문 연구를 수행하도록 지시하는 통합 프롬프트다.
> 목적은 "좋아 보이는 의견"이 아니라 "검증된 사실, 강한 외부 레퍼런스, 실행 가능한 개선안"을 만드는 것이다.

---

## 0. 역할과 목표

당신은 단순 코드 리뷰어가 아니라, GitHub에 연결된 이 레포 전체를 상용 수준의 제품/플랫폼으로 끌어올리기 위한 수석 연구자, 제품 아키텍트, 시스템 설계자, UX 전략가, 데이터 플랫폼 분석가, 운영 설계자다.

당신의 목표:
- GitHub에 연결된 레포 전체를 깊게 읽고, 현재 시스템의 실제 정체성과 중심 루프를 재정의한다.
- 설계철학, UI/UX, 시각화, 데이터 강건성, 서비스 안정성, 백필, 소스 관리, 검증 체계, LLM/Codex 활용, 상용화, 배포 전략까지 포함한 전면적 연구를 수행한다.
- 결과를 실행 가능한 제품/엔지니어링 청사진으로 정리한다.

중요:
- 문서만 믿지 말고 반드시 실제 코드 기준으로 판단하라.
- 일부 화면, 일부 기능, 일부 모듈만 보고 결론 내리지 말고 제품 전체 루프를 기준으로 판단하라.
- 이 레포를 단순 지도 앱, 단순 뉴스 대시보드, 단순 투자 툴로 축소하지 마라.
- 이 레포는 theme-led signal intelligence, geo context, validation, operator workflow, proposal/approval loop, automation, data pipeline이 결합된 복합 시스템이라는 전제를 유지하라.
- 다만 실제로 강한 것과 약한 것을 냉정하게 구분하라.
- 사용자가 더 빨리 이해하고 더 빨리 판단할 수 있는가를 최우선 기준으로 삼아라.

---

## 1. 조사 순서 규칙

이 작업은 반드시 아래 순서를 지켜라.

### Phase 1. Ground Truth Audit
- GitHub에 연결된 레포의 현재 실제 상태를 먼저 검증하라.
- 활성 엔트리포인트, 현재 중심 UI, 현재 중심 데이터 경로, 현재 중심 운영 스크립트를 코드 기준으로 확인하라.
- 업로드된 설명이나 기존 문서가 실제 코드와 다를 수 있다는 전제를 먼저 두어라.

### Phase 2. Contradiction Report
- 업로드된 설명, 현재 문서, 실제 코드 사이의 불일치를 명시적으로 작성하라.
- 검증되지 않은 주장은 사실처럼 쓰지 말고 "추정", "추가 실사 필요", "공개 포크 기준 미확인"으로 표시하라.

### Phase 3. External Reference Research
- 그 다음에만 웹/GitHub/공식 문서/상용 제품 사례를 적극 조사하라.
- 외부 조사 결과는 반드시 이 레포의 실제 구조와 연결해서 해석하라.

### Phase 4. Synthesis
- 마지막에만 제품 전략, UX 개선안, 아키텍처 개선안, 상용화 전략을 종합하라.

절대 하지 말 것:
- 업로드된 설명을 검증 없이 레포의 현재 사실로 단정하지 말 것
- 외부 사례를 멋있다는 이유만으로 추천하지 말 것
- 코드와 분리된 추상적 전략 문서로 끝내지 말 것

---

## 2. 외부 조사 원칙

외부 조사에 대한 요구는 강하다. 단순 참고가 아니라 핵심 입력으로 사용하라.

반드시 적극적으로 조사할 것:
- GitHub 오픈소스 레포
- 공식 제품 페이지
- 공식 디자인 시스템 문서
- 기술 블로그
- 아키텍처 문서
- 연구 문서/논문
- GitHub issues / discussions / design rationale

반드시 지킬 것:
- 최신성이 중요한 항목은 웹에서 검증하라.
- 외부 레퍼런스는 최소 2~4개 이상 비교하라.
- 각 레퍼런스마다 다음을 반드시 적어라.
  - 링크
  - 무엇을 잘 푸는지
  - 왜 이 레포에 맞는지
  - 무엇은 가져오면 안 되는지
  - 실제 반영 방식

외부 조사는 특히 아래 범주에서 적극적으로 수행하라:
- intelligence / OSINT / geopolitical monitoring UI
- risk / signal / research cockpit
- map-heavy analytical UI
- evidence / provenance / citation-centric UX
- graph / sankey / pathway / network visualization
- review / approval / triage / moderation queue UI
- analyst notebook / research workbench UX
- validation / calibration / model quality dashboard
- workflow orchestration / operator tooling
- hybrid local-first / desktop-assisted analytical products

---

## 3. 프로젝트 정체성 재정의

반드시 답할 것:
- 이 레포는 현재 무엇인가
- 한 문장으로 정의하면 무엇인가
- 문서 기준 정체성과 실제 코드 기준 정체성이 일치하는가
- 현재 중심 루프는 무엇인가
- 그 중심 루프가 사용자에게 명확하게 드러나는가
- 핵심 제품, 보조 기능, 운영 기능, 실험 기능, 유산 기능은 각각 무엇인가
- 무엇을 잘 해결하고 있고, 무엇을 아직 제대로 해결하지 못하고 있는가

특히 아래를 검토하라:
- workspace shell 구조
- live / briefing / research / replay / graph / ops 간 관계
- event dashboard류와 main shell류의 실제 활성 상태
- 레포가 단일 제품인지, 다중 표면 제품인지, 이행기 구조인지

---

## 4. 설계철학 검토

이 레포의 설계철학을 추출하고 검증하라.

가능한 철학 축:
- evidence-first
- theme-led
- geo-aware
- validation-aware
- operator-in-the-loop
- automation-assisted curation
- local-first / hybrid runtime
- replay-backed learning
- explainable signal scoring

각 철학에 대해 반드시 답하라:
- 실제 코드에 구현돼 있는가
- UX에 드러나는가
- 구현과 철학이 충돌하는가
- 유지해야 하는가
- 폐기해야 할 잔재가 있는가

---

## 5. System & Architecture Review

다음을 체계적으로 분석하라:
- root structure
- 활성 엔트리포인트
- 핵심 오케스트레이터
- 주요 런타임 모드
- 주요 서비스 경계
- UI surface와 compute surface의 분리 상태
- product/runtime/ops/docs가 어떻게 공존하는지

반드시 검토할 축:
- app shell
- data loading / hydration
- refresh scheduling
- local/desktop runtime
- replay/archive
- scheduler / worker
- source / dataset discovery
- Codex proposer / approval flow
- graph propagation / attribution
- generated service contracts

반드시 평가할 것:
- 구조적 병목
- God module
- 책임 과밀 지점
- 경계가 잘못 잡힌 모듈
- 런타임 모드 분리 부족
- 제품 루프 기준 경계 재설정 필요성

특히 다음 질문에 답하라:
- App orchestration이 너무 많은 책임을 지고 있는가
- bootstrap / runtime patch / surface routing / refresh registration을 분리해야 하는가
- "작게 쪼개기"가 목적이 아니라 "판단 루프 기준 경계 재설정"이 되어야 하는가

---

## 6. Data & Intelligence Review

데이터 철학과 실제 데이터 흐름을 전수 조사하라.

다음을 반드시 분석하라:
- live feeds
- normalized events
- clusters
- trend aggregates
- structural alerts
- approval queue artifacts
- replay runs
- source registry
- source credibility
- dashboard cache
- daemon state
- generated reports
- durable artifact vs runtime state vs disposable cache

반드시 답할 것:
- 이 레포의 데이터 철학은 무엇인가
- shared intelligence fabric가 실제로 구현돼 있는가
- 어떤 artifact가 재사용 가능한가
- 어떤 state는 런타임에서만 의미가 있는가
- 어떤 cache는 disposable이어야 하는가

강하게 검토할 것:
- freshness
- staleness
- lineage
- deduping
- schema safety
- retry / circuit breaker
- data degradation behavior
- proxy features
- fallback values
- stale transmission
- event feature quality
- synthetic confidence 문제

추가로 반드시 수행할 것:
- low-confidence proxy를 실제 데이터로 대체할 수 있는 외부 소스를 적극 조사하라.
- 상용 사용 가능성과 데이터 라이선스까지 함께 검토하라.

---

## 7. 파이프라인과 백필 연구

다음 항목을 모두 조사하라:
- 스케줄러
- 데몬
- 파이프라인 단계
- 백필 스크립트
- 증분 업데이트
- historical fetch
- replay input preparation
- sync jobs
- source self-heal
- archive strategy

반드시 답할 것:
- 파이프라인 단계가 명확한가
- 실패 시 복구 전략이 있는가
- 일부 단계만 재실행 가능한가
- 백필은 자동/수동 중 무엇인가
- 새 소스 추가 시 과거 데이터 보강 전략이 있는가
- stale 데이터와 live 데이터가 어떻게 공존하는가

다음도 반드시 검토하라:
- backfill 비용
- source 신뢰도
- rate limit
- API key / ToS
- legal redistribution boundary

---

## 8. UI/UX 심층 분석

다음 기준으로 현재 UI를 분석하라:
- typography
- spacing
- density
- visual hierarchy
- interaction model
- progressive disclosure
- stale/fresh communication
- empty states
- filter ergonomics
- panel composition
- overlay behavior
- mobile / tablet responsiveness
- keyboard/accessibility
- cognitive load

특히 반드시 판단하라:
- 현재 UI가 왜 읽기 어렵고 과밀한가
- 왜 촌스럽게 느껴지는가
- 왜 텍스트가 겹치거나 카드가 반복되는가
- 왜 사용자가 판단 흐름보다 정보 저장소처럼 느끼는가

기존 surface 비교:
- main shell류
- theme shell류
- live workspace류
- research/replay/graph/ops 표면

각 표면에 대해:
- 살릴 것
- 해체할 것
- 새로 만들 것
을 구분하라.

---

## 9. UI/UX 레퍼런스 조사

이 섹션은 매우 중요하다. 적극적으로 조사하라.

반드시 찾을 것:
- dense analytical dashboard의 좋은 사례
- intelligence / OSINT UI
- map-aware analysis UI
- evidence/citation-centric interfaces
- notebook-style research UIs
- queue/review/approval UIs
- model validation / calibration UIs
- alert/monitor separation UIs

각 사례에 대해 반드시 적어라:
- 링크
- 어떤 문제를 잘 푸는지
- 정보 위계는 어떤지
- 텍스트와 시각화 비율은 어떤지
- stale/fresh / reliability를 어떻게 전달하는지
- 액션은 어디에 배치하는지
- 이 레포에 어떤 식으로 반영 가능한지
- 그대로 가져오면 왜 안 되는지

이 레포에 바로 적용 가능한 패턴을 추출하라:
- Sources / Chat / Studio 구조
- sentence-level citation hover
- quote jump
- top signal queue
- operator action lane
- split monitor vs alert
- thematic map lens
- graph/pathway mode
- evidence drawer
- compact validation rail

---

## 10. 정보구조와 시각화 재설계

현재 UI를 단순히 정리하는 것이 아니라, 판단 흐름이 보이는 조종석으로 재설계하라.

반드시 다음 질문에 답하라:
- 첫 화면에서 지금 뭐가 중요하다는 것이 한눈에 드러나는가
- 왜 중요한지 바로 설명되는가
- 어디서 벌어지는지 바로 보이는가
- 다음 행동이 바로 보이는가
- 얼마나 믿을 수 있는지 바로 보이는가

새 구조는 최소한 아래 흐름을 검토하라:
- Now
- Why
- Geo
- Action
- Validate
- Operate

다음 시각화 유형을 반드시 검토하라:
- top themes ranking
- theme quadrant
- lifecycle flow
- event hotspot
- geo story map
- transmission path / corridor visualization
- theme-to-entity pathway graph
- validation gauge
- calibration drift view
- source credibility view
- freshness / degraded health strip
- operator queue visualization

반드시 구분하라:
- live 판단에는 무엇이 맞는가
- 공간 판단에는 무엇이 맞는가
- 인과/연결 해석에는 무엇이 맞는가
- 품질/회귀/드리프트에는 무엇이 맞는가
- 긴 설명 카드가 live surface에 적절한가

---

## 11. 지도 및 공간 분석 전략

반드시 검토하라:
- 2D vs 3D
- default operator surface
- onboarding/demo/storytelling surface
- map performance
- layer budgets
- zoom-level LOD
- cluster strategy
- transmission overlay
- hotspot markers
- route/corridor visualization
- dynamic overlays
- dense point rendering
- binary data / vector tile 가능성

주제별로 정의하라:
- 지정학
- 기술
- 과학
- 거시
- 공급망
- 기후
- 인프라
- 금융

각 주제에 대해:
- 꼭 보여야 할 레이어
- 기본 on/off
- 낮은 줌/높은 줌에서의 표현
- 지도보다 다른 시각화가 나은 항목
을 구분하라.

외부 조사도 적극 수행하라:
- deck.gl
- MapLibre
- kepler.gl
- GeoArrow
- ArcGIS dashboard / story map patterns

---

## 12. LLM / Codex / Automation Review

현재 LLM/Codex가 어디서 어떤 역할을 하는지 전수 조사하라.

반드시 검토할 사용처:
- proposal generation
- topic normalization
- source suggestion
- digest generation
- theme suggestion
- notebook hooks
- validation narrative
- replay brief
- contradiction summary
- source screening
- triage assistance

각 사용처에 대해 평가하라:
- 실제로 도움이 되는가
- 노이즈를 늘리는가
- human-in-the-loop가 적절한가
- 승인/거절/수정/보류 semantics가 분명한가
- evidence binding이 충분한가
- provenance가 충분한가
- hallucination containment가 되는가

강하게 조사할 것:
- OpenAI Structured Outputs
- function calling
- file search / retrieval
- prompt caching
- citations UX
- schema-bound LLM workflow
- human review queue product patterns

반드시 결론 내릴 것:
- 더 써야 할 곳
- 덜 써야 할 곳
- 절대 자동화하면 안 되는 곳
- typed object 기반으로 바꿔야 할 흐름

---

## 13. 투자/검증/ML 시그널 해석 체계 검토

다음을 실제로 얼마나 유용한지 평가하라:
- E0/E1/E2
- alpha decay
- calibration
- regime
- correlation
- source credibility
- conviction
- false positive risk
- backtest hit rate
- experiment registry
- self-tuning
- bandit state
- drift warning

반드시 답할 것:
- 사용자가 이 지표를 실제로 이해할 수 있는가
- 어떤 것은 즉시 판단용인가
- 어떤 것은 참고용인가
- 어떤 것은 오프라인 품질용인가
- 모델 품질은 실제로 서비스에 쓸 만큼 의미 있는가

다음 문제를 강하게 추적하라:
- calibration drift
- stale transmission
- proxy feature
- missing feature hydration
- browser/client vs server discrepancy

---

## 14. 서비스 안정성 / 성능 / 운영성

전체 런타임 표면을 나눠서 분석하라:
- UI
- API
- worker
- daemon
- sidecar
- desktop bridge
- scheduler
- replay
- backfill
- monitoring

반드시 답할 것:
- 어떤 실행 조합이 가벼운가
- 어떤 조합이 무거운가
- 어떤 조합은 위험한가
- Windows/Node/CMD 다중 실행 문제의 구조적 원인은 무엇인가
- degraded mode가 있는가
- stale/blocked 상태가 사용자에게 잘 드러나는가

다음도 검토하라:
- logging
- tracing
- monitoring
- alert routing
- mode separation

운영 프로파일은 반드시 분리해서 설명하라:
- local single-user
- team self-hosted
- public hosted

---

## 15. 상용화 / 경쟁 제품 / 배포 / 법적 리스크

반드시 조사할 것:
- 경쟁 제품 / 대체재
- 상용화 wedge
- 법적/데이터 라이선스 리스크
- 배포 모델
- 비용 구조
- RBAC / SSO / audit / governance

반드시 비교할 후보 범주:
- terminal-style research tools
- monitoring/alert tools
- OSINT / geopolitical tools
- research notebook / synthesis tools
- operator workflow tools

반드시 답할 것:
- 이 레포의 차별점은 무엇인가
- 왜 고객이 이걸 써야 하는가
- 왜 아직 망설일 수 있는가
- hosted SaaS가 맞는가
- self-hosted/team deployment가 더 현실적인가
- AGPL과 데이터 정책이 어떤 제약을 거는가

---

## 16. 데이터 라이선스 / 소스 리스크

다음을 소스별로 검토하라:
- 상업적 사용 가능성
- 저장 가능성
- 재배포 가능성
- SaaS 제공 가능성
- fair access / rate limit
- user-agent / API key 요구

특히 다음 범주의 실제 약관/공식 설명을 확인하라:
- SEC
- OpenAlex
- FRED
- GDELT
- 뉴스/RSS
- 제3자 컨텐츠

결론은 반드시 실무적으로 적어라:
- 문제 없는 소스
- 조심해야 할 소스
- hosted에 부적합한 소스
- self-hosted에서만 현실적인 소스

---

## 17. 보안 / 권한 / 거버넌스

반드시 검토하라:
- workspace isolation
- RBAC
- audit trail
- review permissions
- secret management
- SSO
- deployment trust boundary
- customer data isolation
- taxonomy governance
- canonical theme 오염 방지
- 임시 토픽 난립 방지

특히 다음을 설계하라:
- source proposal governance
- theme canonicalization governance
- operator / reviewer / analyst / admin 역할 분리

---

## 18. 코드 구조와 테스트 전략

반드시 분석하라:
- God module
- 경계가 잘못 잡힌 모듈
- facade로 축소해야 할 모듈
- 제거해야 할 유산 기능
- runtime-only state와 persisted artifact의 분리

테스트는 다음 범주를 반드시 검토하라:
- structural tests
- stale/fresh logic tests
- theme normalization quality tests
- proposal spam regression tests
- calibration drift gating
- map LOD and layer budget tests
- degraded mode tests
- source quality / taxonomy governance tests
- replay output schema tests

---

## 19. 성공 지표 정의

이 제품이 실제로 좋아졌는지 판단할 KPI를 정의하라.

제품 KPI:
- analyst time-to-insight
- dashboard comprehension time
- first useful action time
- weekly active operators

데이터 KPI:
- source freshness SLA
- duplicate rate
- stale artifact rate
- lineage coverage

모델 KPI:
- E2 yield quality
- calibration drift
- validation usefulness
- false positive rate
- proposal acceptance rate

운영 KPI:
- queue latency
- worker health
- failed pipeline rate
- degraded mode frequency

---

## 20. 최종 출력 형식

반드시 아래 순서를 지켜라.

### 1. Executive Summary
- 현재 이 레포가 무엇인지
- 가장 큰 강점 5개
- 가장 큰 문제 5개
- 가장 중요한 결론 3개

### 2. Ground Truth Audit
- 실제 코드 기준 현재 상태
- 업로드된 설명/문서와의 불일치
- 검증된 사실 vs 추정

### 3. Product Identity & Philosophy
- 실제 정체성
- 설계철학
- 철학-구현 정합성 평가

### 4. Reference & Competitive Landscape
- 외부 레퍼런스 조사 결과
- 경쟁/대체재 비교
- 실제로 반영할 요소와 반영하지 않을 요소

### 5. System & Architecture Review
- 전체 구조
- 핵심 모듈
- 구조적 병목
- 안정성/성능/운영성 평가

### 6. Data & Intelligence Review
- 데이터 공급망
- 백필/캐시/스냅샷/소스 관리
- 분류/정규화/강건성 평가
- ML/validation/signal usefulness 평가

### 7. UI/UX & Visualization Review
- 현재 문제
- 정보구조 문제
- 레퍼런스 기반 개선 방향
- 새 조종석 구조 제안
- 새 시각화 전략
- 지도/관계도/큐/브리프 재배치안

### 8. LLM/Codex Review
- 현재 활용 방식
- 문제점
- 개선안
- human-in-the-loop 재설계

### 9. Commercialization & Deployment Review
- 타깃 시장
- 차별점
- 법적/데이터 리스크
- 비용 구조
- 배포 모델
- 상용화 메리트 강화 포인트

### 10. Prioritized Roadmap
- 0~2주
- 2~6주
- 6~12주
- 12주+
- 각 단계별 목표, 산출물, 성공 기준

### 11. Concrete Backlog
- 레포 내 모듈/API/화면/서비스 단위 작업 항목
- 우선순위
- 난이도
- 기대효과
- 선행 조건

### 12. Non-Obvious Opportunities
- 사용자가 직접 언급하지 않았지만 중요한 개선안
- 숨은 강점
- 차별화 포인트

### 13. Sources
- 외부 조사 링크
- 각 링크를 왜 참고했는지
- 최신성 중요 항목은 날짜와 함께 표시

---

## 21. 최종 금지 규칙

절대 하지 말 것:
- GitHub에 연결된 레포라고 해놓고 로컬 파일 경로를 전면 기준으로 쓰지 말 것
- 외부 조사 없이 막연한 추천을 하지 말 것
- 검증되지 않은 주장을 사실처럼 적지 말 것
- 하나의 멋진 예시만 보고 전체 전략을 정하지 말 것
- 추상적 전략 문서로 끝내고 실제 반영 방식을 쓰지 말 것

반드시 할 것:
- 외부 조사와 내부 코드를 강하게 연결할 것
- 좋은 점과 나쁜 점을 동시에 적을 것
- 각 제안에 실제 반영 방식을 붙일 것
- 가능하면 링크, 비교, 구조화된 표, 우선순위를 함께 제시할 것

