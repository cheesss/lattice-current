# Automation / LLM / RAG Refactor Plan

작성일: 2026-04-01

## 목적

이 문서는 `lattice-current-fix`의 현재 자동화 수준, 매직넘버 관리 수준, Codex/LLM 기반 테마 및 데이터셋 추천 자동화 수준, RAG 구현 수준을 진단하고, 이를 바탕으로 한 수정 우선순위와 실행 계획을 정리한다.

핵심 결론은 다음과 같다.

- 운영 자동화는 이미 높은 편이다.
- 백테스트와 자동화의 핵심 품질은 여전히 heuristic 숫자에 크게 의존한다.
- Codex/LLM은 이미 추천 파이프라인에 연결되어 있으나, 검증과 승격 기준의 구조화가 더 필요하다.
- RAG는 부분적으로 구현되어 있으나, 핵심 백테스트 엔진과는 약하게 연결되어 있다.
- 가장 큰 개선 여지는 `매직넘버 외부화`, `semantic retrieval 기반 theme discovery`, `point-in-time safe historical RAG`에 있다.

## 현재 상태 요약

### 1. 운영 자동화 수준

중심 모듈은 [intelligence-automation.ts](C:\Users\chohj\Documents\Playground\lattice-current-fix\src\services\server\intelligence-automation.ts)다.

현재 자동 수행되는 범위:

- dataset fetch / import
- scheduled replay
- scheduled walk-forward
- theme discovery queue 생성
- candidate expansion
- dataset discovery
- source automation
- self-tuning cycle
- registry/state persistence

평가:

- 운영 자동화 성숙도: 높음
- 전략 품질 자동 개선 성숙도: 중간
- 완전 무인화 수준: 중간

정리하면 이 시스템은 이미 "수동 실험용 스크립트 모음" 단계를 벗어났고, "자동 운영되는 리서치 파이프라인" 단계에 들어와 있다.

### 2. 매직넘버 관리 수준

설정 외부화가 일부 진행되어 있다.

대표 예시:

- [portfolio-optimizer.ts](C:\Users\chohj\Documents\Playground\lattice-current-fix\src\services\investment\portfolio-optimizer.ts)
  - regime, thresholds, weights, penalties가 `_cfg`에 모여 있음
- [theme-registry.ts](C:\Users\chohj\Documents\Playground\lattice-current-fix\src\services\investment\theme-registry.ts)
  - theme policy normalization 및 admission 관련 기본값 존재
- [intelligence-automation.ts](C:\Users\chohj\Documents\Playground\lattice-current-fix\src\services\server\intelligence-automation.ts)
  - automation defaults 및 policy 구조 존재

하지만 여전히 핵심 로직 곳곳에 inline heuristic 숫자가 남아 있다.

대표 예시:

- [theme-discovery.ts](C:\Users\chohj\Documents\Playground\lattice-current-fix\src\services\theme-discovery.ts)
  - `overlap >= 0.72`
  - `signalScore >= 48`
  - `minSamples`, `minSources`, `maxQueueItems`
- [historical-intelligence.ts](C:\Users\chohj\Documents\Playground\lattice-current-fix\src\services\historical-intelligence.ts)
  - trailing stop 관련 수치
  - target return / max hold 관련 수치
  - entry / exit lookahead
  - dedupe cooldown
- [idea-generator.ts](C:\Users\chohj\Documents\Playground\lattice-current-fix\src\services\investment\idea-generator.ts)
  - meta gate 가중치
  - reject/watch floor
- [intelligence-automation.ts](C:\Users\chohj\Documents\Playground\lattice-current-fix\src\services\server\intelligence-automation.ts)
  - queue priority
  - promotion score
  - dataset proposal score
  - coverage priority score

평가:

- 매직넘버 문제는 "심각하게 방치된 상태"는 아니지만, "해결되었다"고 볼 수 없다.
- 현재는 정책화된 숫자와 로직 내부 heuristic 숫자가 혼재된 상태다.

### 3. Codex / LLM 기반 추천 자동화 수준

이미 관련 구현이 명확하게 존재한다.

핵심 파일:

- [codex-theme-proposer.ts](C:\Users\chohj\Documents\Playground\lattice-current-fix\src\services\server\codex-theme-proposer.ts)
- [codex-candidate-proposer.ts](C:\Users\chohj\Documents\Playground\lattice-current-fix\src\services\server\codex-candidate-proposer.ts)
- [codex-dataset-proposer.ts](C:\Users\chohj\Documents\Playground\lattice-current-fix\src\services\server\codex-dataset-proposer.ts)
- [theme-discovery.ts](C:\Users\chohj\Documents\Playground\lattice-current-fix\src\services\theme-discovery.ts)

현재 자동화 흐름:

1. frame의 뉴스/클러스터에서 motif 추출
2. known theme와 overlap이 낮은 항목을 queue에 적재
3. queue item을 Codex에 전달해 theme proposal 생성
4. scoring 후 promoted theme 후보로 관리
5. 해당 theme를 기반으로 dataset proposal 생성
6. 일부 dataset proposal은 validation replay까지 수행
7. 조건 충족 시 auto-register 가능

장점:

- LLM이 단순 보조가 아니라 automation cycle 안에 연결되어 있다.
- theme 추천, candidate expansion, dataset proposal이 분리되어 있다.
- dataset proposal은 mini replay validation까지 들어가 있어 상대적으로 보수적이다.

한계:

- Codex availability와 login 상태에 의존한다.
- LLM 제안 결과를 평가하는 score 체계 역시 heuristic 비중이 높다.
- promotion 기준의 provenance와 audit trail이 아직 충분히 구조화되어 있지 않다.

평가:

- 추천 자동화 수준: 중상
- 완전 무인 승격 수준: 중

### 4. RAG 구현 수준

RAG 관련 primitive는 이미 있다.

핵심 파일:

- [ml-worker.ts](C:\Users\chohj\Documents\Playground\lattice-current-fix\src\services\ml-worker.ts)
- [ml.worker.ts](C:\Users\chohj\Documents\Playground\lattice-current-fix\src\workers\ml.worker.ts)
- [vector-db.ts](C:\Users\chohj\Documents\Playground\lattice-current-fix\src\workers\vector-db.ts)
- [graph-rag.ts](C:\Users\chohj\Documents\Playground\lattice-current-fix\src\services\graph-rag.ts)
- [country-intel.ts](C:\Users\chohj\Documents\Playground\lattice-current-fix\src\app\country-intel.ts)

현재 가능한 기능:

- local embeddings
- local vector store ingest / search
- graph-based keyword community summary
- 브리핑 시 historical snippet retrieval

현재 부족한 점:

- theme discovery에 semantic retrieval이 핵심 ranking 입력으로 들어가 있지 않음
- candidate expansion prompt에 retrieval evidence를 주입하지 않음
- dataset discovery에서 historical analog retrieval이 거의 없음
- backtest 엔진의 signal generation / admission / calibration에 retrieval evidence가 직접 결합되지 않음
- point-in-time safe retrieval layer가 명시적으로 구조화되어 있지 않음

평가:

- RAG primitive 구현: 중
- 핵심 엔진 통합도: 낮음

## 기대효과 평가

### RAG 도입으로 즉시 크게 좋아질 영역

- theme discovery precision 향상
- novelty 판별 정확도 향상
- Codex proposal prompt 품질 향상
- 브리핑 및 설명 가능성 향상
- 과거 유사사례 검색을 통한 false positive 감소

### RAG 도입으로 당장 큰 개선이 어려운 영역

- raw backtest return 자체
- execution realism
- sizing logic
- horizon selection의 근본 성능

즉, 현재 코드베이스에서 RAG의 1차 효과는 "수익률 급상승"이 아니라 "더 좋은 후보를 찾고, 더 나쁜 후보를 덜 통과시키는 것"에 가깝다.

## 핵심 문제 정의

현재 수정이 필요한 문제는 크게 다섯 가지다.

### 문제 1. 정책 수치와 로직 수치가 분리되지 않음

여러 score 계산식이 코드 안에 박혀 있다. 이 상태에서는:

- 실험 반복이 어렵고
- 변경 이유 추적이 어렵고
- A/B 테스트가 어렵고
- 회귀 원인 분석이 어렵다

### 문제 2. LLM 추천이 들어오지만 evidence-grounded 구조가 약함

Codex가 theme / candidate / dataset을 제안하지만, retrieval evidence와 과거 성과 evidence가 prompt에 충분히 결합되어 있지 않다.

### 문제 3. Theme discovery가 lexical bias에 치우쳐 있음

[theme-discovery.ts](C:\Users\chohj\Documents\Playground\lattice-current-fix\src\services\theme-discovery.ts)는 phrase/token 기반 탐색이 중심이다. 표현이 다르지만 구조적으로 같은 motif를 잘 못 묶을 가능성이 높다.

### 문제 4. RAG가 브리핑 위주로만 사용됨

현재 retrieval은 [country-intel.ts](C:\Users\chohj\Documents\Playground\lattice-current-fix\src\app\country-intel.ts) 같은 소비자-facing 브리핑에 더 강하게 붙어 있고, 자동화된 discovery/backtest loop에는 약하게 붙어 있다.

### 문제 5. Point-in-time safety가 retrieval 계층에는 충분히 구조화되지 않음

백테스트 엔진은 `knowledgeBoundary` 개념이 강하지만, retrieval 계층은 아직 그 수준으로 강한 PIT 제약을 가진 구조로 보이지 않는다.

## 수정 계획

아래 계획은 우선순위 순서다.

## Phase 1. 매직넘버 정리 및 정책 외부화

목표:

- 점수식과 threshold를 레지스트리/설정/정책 계층으로 빼낸다.

대상:

- [theme-discovery.ts](C:\Users\chohj\Documents\Playground\lattice-current-fix\src\services\theme-discovery.ts)
- [historical-intelligence.ts](C:\Users\chohj\Documents\Playground\lattice-current-fix\src\services\historical-intelligence.ts)
- [idea-generator.ts](C:\Users\chohj\Documents\Playground\lattice-current-fix\src\services\investment\idea-generator.ts)
- [intelligence-automation.ts](C:\Users\chohj\Documents\Playground\lattice-current-fix\src\services\server\intelligence-automation.ts)

실행 항목:

1. `config/automation-thresholds`와 유사한 구조로 `theme-discovery-thresholds`, `proposal-scoring-thresholds`, `backtest-exit-thresholds`, `meta-gate-thresholds`를 분리
2. 모든 heuristic 숫자에 이름 부여
3. 점수식 변경 시 changelog / provenance 문자열 기록
4. score breakdown을 로그와 결과 구조에 포함

산출물:

- threshold config 파일
- score breakdown type
- 실험 단위 override 지원

예상 효과:

- tuning 속도 향상
- regression 분석 용이
- 실험 자동화 용이

## Phase 2. Theme discovery semanticization

목표:

- lexical phrase queue를 semantic discovery queue로 업그레이드한다.

대상:

- [theme-discovery.ts](C:\Users\chohj\Documents\Playground\lattice-current-fix\src\services\theme-discovery.ts)
- [ml-worker.ts](C:\Users\chohj\Documents\Playground\lattice-current-fix\src\services\ml-worker.ts)
- [ml.worker.ts](C:\Users\chohj\Documents\Playground\lattice-current-fix\src\workers\ml.worker.ts)
- [vector-db.ts](C:\Users\chohj\Documents\Playground\lattice-current-fix\src\workers\vector-db.ts)

실행 항목:

1. theme discovery 후보 headline/cluster title를 embedding으로 벡터화
2. lexical phrase aggregate 외에 semantic cluster aggregate 생성
3. known theme phrase overlap 외에 embedding similarity overlap 추가
4. queue item score에 아래 항목 추가
   - semantic novelty
   - semantic recurrence
   - retrieval-backed analog count
   - historical motif stability

추천 구현:

- `discoverThemeQueue()`를 `discoverThemeQueueLexical()` + `discoverThemeQueueSemantic()` + `mergeThemeDiscoverySignals()`로 분리
- semantic cluster는 worker의 existing clustering 기능을 재사용

예상 효과:

- 표현이 달라도 같은 구조의 theme motif 탐지 가능
- 중복 queue 감소
- novelty 판단 개선

## Phase 3. Retrieval-grounded Codex proposals

목표:

- Codex가 "지금 보이는 신호"만 보고 제안하지 않고, "과거 유사사례 + 현재 coverage gap + replay weakness"까지 함께 본 뒤 제안하도록 개선한다.

대상:

- [codex-theme-proposer.ts](C:\Users\chohj\Documents\Playground\lattice-current-fix\src\services\server\codex-theme-proposer.ts)
- [codex-candidate-proposer.ts](C:\Users\chohj\Documents\Playground\lattice-current-fix\src\services\server\codex-candidate-proposer.ts)
- [codex-dataset-proposer.ts](C:\Users\chohj\Documents\Playground\lattice-current-fix\src\services\server\codex-dataset-proposer.ts)
- [intelligence-automation.ts](C:\Users\chohj\Documents\Playground\lattice-current-fix\src\services\server\intelligence-automation.ts)

실행 항목:

1. prompt 입력에 retrieval evidence 블록 추가
   - similar historical headlines
   - prior successful theme assets
   - failed candidate examples
   - coverage gaps
   - replay weakness summary
2. Codex 출력에 evidence linkage 필드 추가
   - `evidenceRefs`
   - `historicalAnalogs`
   - `confidenceDrivers`
3. proposal scoring에 evidence consistency 점수 추가
4. accepted proposal 저장 시 "왜 채택했는지" audit trail 저장

예상 효과:

- 제안 품질 향상
- 설명 가능성 향상
- hallucinated asset/theme 감소

## Phase 4. Point-in-time safe Historical RAG

목표:

- 백테스트 시점 기준으로 미래 데이터를 retrieval하지 않는 PIT-safe RAG 계층을 도입한다.

대상:

- 신규 서비스 `historical-rag.ts`
- [historical-intelligence.ts](C:\Users\chohj\Documents\Playground\lattice-current-fix\src\services\historical-intelligence.ts)
- [vector-db.ts](C:\Users\chohj\Documents\Playground\lattice-current-fix\src\workers\vector-db.ts)
- importer/storage 계층

실행 항목:

1. vector store metadata 확장
   - `knowledgeBoundary`
   - `datasetId`
   - `region`
   - `themeTags`
2. retrieval API에 ceiling 추가
   - `searchBefore(knowledgeBoundary)`
3. replay 시 frame 단위 historical analog lookup 지원
4. idea card 생성 전에 analog summary 생성 가능하도록 hook 추가

주의:

- 이 단계는 반드시 PIT safety를 강제해야 한다.
- 그렇지 않으면 retrieval 자체가 look-ahead bias를 만들어낸다.

예상 효과:

- theme proposal groundedness 증가
- backtest 설명력 증가
- false positive 억제 가능성 증가

## Phase 5. Candidate / Dataset discovery 재설계

목표:

- theme -> candidate -> dataset 확장을 단순 heuristic score에서 retrieval + replay weakness 기반으로 바꾼다.

대상:

- [intelligence-automation.ts](C:\Users\chohj\Documents\Playground\lattice-current-fix\src\services\server\intelligence-automation.ts)
- [dataset-discovery.ts](C:\Users\chohj\Documents\Playground\lattice-current-fix\src\services\dataset-discovery.ts)

실행 항목:

1. coverage gap scoring에 semantic evidence 추가
2. dataset proposal scoring에 아래 항목 추가
   - analog coverage gain
   - theme regime blind-spot reduction
   - source family diversification score
3. candidate expansion scoring에 아래 항목 추가
   - replay correlation benefit
   - historical analog support
   - symbol liquidity confidence
4. validation replay 결과를 proposal ranking에 더 강하게 반영

예상 효과:

- 등록되는 dataset의 relevance 증가
- 덜 중요한 dataset 제안 감소
- candidate expansion의 품질 개선

## Phase 6. Backtest engine integration

목표:

- retrieval 결과를 브리핑이 아니라 실제 replay 진단과 calibration에 연결한다.

대상:

- [historical-intelligence.ts](C:\Users\chohj\Documents\Playground\lattice-current-fix\src\services\historical-intelligence.ts)
- [idea-generator.ts](C:\Users\chohj\Documents\Playground\lattice-current-fix\src\services\investment\idea-generator.ts)
- [replay-adaptation.ts](C:\Users\chohj\Documents\Playground\lattice-current-fix\src\services\replay-adaptation.ts)

실행 항목:

1. idea card에 retrieval confidence / analog density 추가
2. admission gate에 retrieval consistency penalty 또는 bonus 추가
3. replay summary에 analog-backed vs non-analog-backed 성과 비교 추가
4. adaptation snapshot에 retrieval utility tracking 추가

주의:

- retrieval score는 직접적인 allocation 입력보다는 penalty/bonus 수준으로 시작해야 한다.
- 초기에는 설명 변수로 넣고, 이후 성능이 검증되면 의사결정 변수로 승격하는 것이 안전하다.

## 우선순위

실행 우선순위는 아래와 같다.

1. Phase 1: 매직넘버 외부화
2. Phase 2: semantic theme discovery
3. Phase 3: retrieval-grounded Codex prompts
4. Phase 4: PIT-safe historical RAG
5. Phase 5: candidate/dataset scoring 재설계
6. Phase 6: backtest admission integration

이 순서를 추천하는 이유:

- 현재 가장 큰 리스크는 "튜닝 불가능한 heuristic 혼재"다.
- 그 다음 병목은 "semantic novelty 판단 부재"다.
- RAG는 primitive가 이미 있으므로, discovery와 prompt grounding부터 붙이는 편이 ROI가 높다.
- backtest core admission에 retrieval을 바로 넣는 것은 가장 나중이 안전하다.

## 예상 효과

정량 예측은 보수적으로 봐야 한다. 현재 구조에서 기대할 수 있는 효과는 다음과 같다.

### 높은 확률로 개선될 영역

- theme discovery precision
- proposal relevance
- analyst trust / explainability
- false positive filtering
- automation auditability

### 중간 수준 개선이 기대되는 영역

- candidate expansion 품질
- dataset auto-registration 품질
- replay summary의 해석 가능성

### 과대기대하면 안 되는 영역

- raw return 급상승
- execution realism의 자동 해결
- portfolio accounting quality의 직접 개선

즉, 이 계획은 "RAG를 붙여서 수익률을 바로 폭증시키는 프로젝트"가 아니라, "자동화된 탐색과 선별 과정의 품질을 높여 시스템 전체의 신뢰도를 올리는 프로젝트"로 보는 것이 맞다.

## 구현 원칙

수정 시 아래 원칙을 유지해야 한다.

1. PIT safety 우선
2. heuristic는 모두 이름 붙은 설정으로 이동
3. retrieval는 먼저 설명 변수로 도입
4. Codex 산출물은 항상 audit trail과 함께 저장
5. 신규 점수식은 breakdown 구조를 반드시 남김
6. 자동 승격은 guarded mode를 기본으로 유지

## 제안 산출물 목록

실제 작업 산출물은 아래를 기준으로 잡는 것이 적절하다.

- 신규 config 파일
  - theme discovery thresholds
  - proposal scoring thresholds
  - historical rag settings
  - retrieval ranking weights
- 신규 서비스
  - `historical-rag.ts`
  - `theme-discovery-semantic.ts`
  - `proposal-evidence-builder.ts`
- 기존 서비스 수정
  - Codex proposer 3종
  - intelligence automation
  - historical intelligence
  - replay adaptation
- 문서
  - scoring provenance
  - retrieval safety rules
  - automation audit guide

## 최종 권고

현재 저장소는 이미 자동화와 LLM 연동이 상당히 진척된 상태다. 따라서 다음 단계는 "더 많은 자동화 추가"보다 "현재 자동화의 품질을 통제 가능하게 만드는 것"이어야 한다.

가장 먼저 해야 할 일은:

- 매직넘버 외부화
- semantic theme discovery 도입
- Codex prompt grounding 강화

그 다음으로:

- PIT-safe historical RAG
- candidate / dataset proposal score 재설계

마지막으로:

- retrieval를 backtest admission과 adaptation에 점진적으로 연결

이 순서가 가장 현실적이고, 리스크 대비 효과가 가장 높다.

## 진행 현황

### 2026-04-01 1차 구현 완료

이번 사이클에서 아래 항목을 실제 코드에 반영했다.

- 설정 외부화 1차 적용
  - 신규 설정 파일 [intelligence-tuning.ts](C:\Users\chohj\Documents\Playground\lattice-current-fix\src\config\intelligence-tuning.ts) 추가
  - theme discovery 관련 threshold/weight 외부화
  - backtest replay 관련 dedupe / lookahead / exit / max hold 수치 외부화
  - Codex proposer evidence 관련 limit 외부화
- theme discovery 설정화
  - [theme-discovery.ts](C:\Users\chohj\Documents\Playground\lattice-current-fix\src\services\theme-discovery.ts)에서 overlap cutoff, signal floor, sample/source threshold, score weight를 신규 설정 사용으로 전환
- replay/backtest 핵심 heuristic 설정화
  - [historical-intelligence.ts](C:\Users\chohj\Documents\Playground\lattice-current-fix\src\services\historical-intelligence.ts)에서 dedupe cooldown, horizon candidate cap, entry/exit lookahead, trailing stop, target return, max hold, risk-adjusted denominator를 신규 설정 사용으로 전환
- Codex prompt grounding 1차 적용
  - 신규 evidence builder [proposal-evidence-builder.ts](C:\Users\chohj\Documents\Playground\lattice-current-fix\src\services\server\proposal-evidence-builder.ts) 추가
  - [codex-theme-proposer.ts](C:\Users\chohj\Documents\Playground\lattice-current-fix\src\services\server\codex-theme-proposer.ts) evidence 입력 지원
  - [codex-candidate-proposer.ts](C:\Users\chohj\Documents\Playground\lattice-current-fix\src\services\server\codex-candidate-proposer.ts) evidence 입력 지원
  - [codex-dataset-proposer.ts](C:\Users\chohj\Documents\Playground\lattice-current-fix\src\services\server\codex-dataset-proposer.ts) evidence 입력 지원
  - [intelligence-automation.ts](C:\Users\chohj\Documents\Playground\lattice-current-fix\src\services\server\intelligence-automation.ts)에서 theme / candidate / dataset proposal 호출 시 evidence 연결

검증 결과:

- `npx tsc --noEmit --pretty false` 통과

### 아직 남은 항목

아래 항목은 아직 구현하지 않았다.

- semantic discovery queue
- PIT-safe historical RAG 계층
- retrieval를 backtest admission과 adaptation에 직접 반영하는 단계
- proposal score breakdown persistence
- heuristic 숫자 전체 전수조사 및 2차 외부화
---

## Addendum ??2026-04-01 Backtest Reliability / Production Readiness

This addendum captures additional work that should be folded into the refactor plan based on the current replay-engine review and recent guardrail changes.

### What already changed

Recent hardening landed in:

- [historical-intelligence.ts](C:\Users\chohj\Documents\Playground\lattice-current-fix\src\services\historical-intelligence.ts)
- [historical-intelligence-guardrails.test.mjs](C:\Users\chohj\Documents\Playground\lattice-current-fix\tests\historical-intelligence-guardrails.test.mjs)

Implemented guardrails:

1. strict temporal validation for replay frames
   - reject `validTimeStart > transactionTime`
   - reject `transactionTime > knowledgeBoundary`
2. stronger frame merge keys
   - same `timestamp` but different `transactionTime` / `knowledgeBoundary` no longer collapse silently
3. merge conflict metadata
   - merged frame conflict count and reasons are now surfaced
4. replay statistical summary
   - 95% CI for cost-adjusted average return
   - 95% CI for cost-adjusted hit-rate
   - 95% CI for raw average return
   - 95% CI for Sharpe-like summary
5. strict causal replay mode is now the default
   - replay/walk-forward use causal prefixes instead of the old batched fast path unless explicitly overridden

### Additional problem statement

The original plan focuses heavily on automation, LLM proposals, and RAG grounding. That is still correct, but it is not sufficient for production deployment.

There is a separate class of problems that directly determines whether the system is safe to trust:

- causal integrity of replay
- statistical validity of claims
- execution realism
- live vs replay drift monitoring
- hard portfolio risk controls

These need to be added explicitly to the plan, not treated as side effects of the RAG refactor.

## New Phase 0. Backtest Trustworthiness Baseline

Goal:

- make replay outputs defensible before adding more proposal sophistication

Scope:

- [historical-intelligence.ts](C:\Users\chohj\Documents\Playground\lattice-current-fix\src\services\historical-intelligence.ts)
- [event-market-transmission.ts](C:\Users\chohj\Documents\Playground\lattice-current-fix\src\services\event-market-transmission.ts)
- [source-credibility.ts](C:\Users\chohj\Documents\Playground\lattice-current-fix\src\services\source-credibility.ts)
- [portfolio-accounting.ts](C:\Users\chohj\Documents\Playground\lattice-current-fix\src\services\portfolio-accounting.ts)

Work items:

1. keep `causalIntegrityMode='strict'` as the default in replay and walk-forward
2. add explicit regression tests that compare `strict` vs `batched`
   - `batched` must be treated as a speed/debug path only
3. surface merge conflict rate in run summaries and ops UI
4. add dataset-quality warnings when replay uses too many merged/conflicted frames
5. add minimum sample-size warnings to every confidence interval summary

## New Phase 0.5. Statistical Defensibility

Goal:

- stop relying on point estimates alone

Scope:

- [historical-intelligence.ts](C:\Users\chohj\Documents\Playground\lattice-current-fix\src\services\historical-intelligence.ts)
- [replay-adaptation.ts](C:\Users\chohj\Documents\Playground\lattice-current-fix\src\services\replay-adaptation.ts)
- [evaluation-pipeline.ts](C:\Users\chohj\Documents\Playground\lattice-current-fix\src\services\evaluation\evaluation-pipeline.ts)

Work items:

1. add bootstrap CI to all key replay summaries exposed in UI/API
2. add deflated Sharpe / multiple-testing-aware reporting for experiment selection
3. add baseline comparison table for:
   - buy-and-hold benchmark
   - simple momentum baseline
   - random signal baseline with matched turnover
   - system without adaptation
4. add ablation outputs that isolate:
   - admission gate uplift
   - horizon selection uplift
   - execution penalty drag
   - sizing drag / uplift
5. add run-level warning when CI overlaps zero for core edge metrics

## New Phase 6.5. Execution Realism Hardening

Goal:

- close the gap between replay fill assumptions and actual tradeability

Scope:

- [historical-intelligence.ts](C:\Users\chohj\Documents\Playground\lattice-current-fix\src\services\historical-intelligence.ts)
- [portfolio-accounting.ts](C:\Users\chohj\Documents\Playground\lattice-current-fix\src\services\portfolio-accounting.ts)
- [portfolio-optimizer.ts](C:\Users\chohj\Documents\Playground\lattice-current-fix\src\services\investment\portfolio-optimizer.ts)

Work items:

1. add stricter entry/exit fill constraints
   - max allowable entry lag by asset class
   - max allowable exit lag by asset class
2. model event gap risk explicitly for news-driven entries
3. add shortability / borrow-availability filter before allowing short positions
4. add non-tradable bucket reporting by asset class and session state
5. promote `tradableNow=false` events into explicit production warnings rather than only penalties
6. add same-day order contention logic in portfolio accounting
   - not just gross-cap clipping
   - competing high-priority entries should displace lower-priority ones deterministically

## New Phase 6.6. Production Risk Controls

Goal:

- prevent a good research engine from becoming a dangerous live allocator

Scope:

- [portfolio-optimizer.ts](C:\Users\chohj\Documents\Playground\lattice-current-fix\src\services\investment\portfolio-optimizer.ts)
- [intelligence-automation.ts](C:\Users\chohj\Documents\Playground\lattice-current-fix\src\services\server\intelligence-automation.ts)

Work items:

1. add hard daily loss limit / weekly drawdown stop
2. add cluster-level concentration caps
3. add symbol liquidity floors for automatic deployment eligibility
4. add regime-based kill switch
5. add replay/live drift kill switch
6. add explicit guarded mode for any future production automation path

## New Phase 6.7. Live Shadow Validation

Goal:

- verify that replay assumptions survive contact with live data

Scope:

- [intelligence-automation.ts](C:\Users\chohj\Documents\Playground\lattice-current-fix\src\services\server\intelligence-automation.ts)
- replay/archive/reporting surfaces

Work items:

1. add shadow-run mode that emits paper trades without allocation
2. compare replay-estimated fill quality vs observed live market path
3. track live vs replay drift for:
   - signal count
   - admission rate
   - cost-adjusted return estimate
   - tradable rate
4. require sustained shadow-run stability before enabling any real deployment path

## Priority update

Recommended sequence now:

1. Phase 0: Backtest Trustworthiness Baseline
2. Phase 0.5: Statistical Defensibility
3. Phase 1: heuristic extraction / threshold normalization
4. Phase 2: semantic theme discovery
5. Phase 3: retrieval-grounded Codex prompts
6. Phase 4: PIT-safe historical RAG
7. Phase 5: candidate / dataset scoring redesign
8. Phase 6: backtest engine retrieval integration
9. Phase 6.5: execution realism hardening
10. Phase 6.6: production risk controls
11. Phase 6.7: live shadow validation

Reason:

- production trust must be established before more proposal sophistication is layered on top
- RAG quality improvements are valuable, but they do not replace causal replay integrity or risk controls
- if the system is ever intended for live capital, execution realism and shadow validation are first-class roadmap items

## Success criteria addendum

The plan should not be considered complete unless the following become true:

1. strict causal replay is the default and covered by regression tests
2. all major replay claims expose confidence intervals and sample-size caveats
3. merged-frame conflicts are visible in dashboards and archives
4. live shadow drift is measurable
5. production automation cannot allocate capital without hard risk controls and kill switches
