# `investment-intelligence.ts`

## 역할

현재 시스템에서 가장 중요한 의사결정 엔진이다. 이벤트, 뉴스, 시장, ontology, replay memory를 결합해 `direct mappings`, `idea cards`, `workflow`, `decision buckets`를 만든다.

## 입력 데이터

- clustered events
- market prices and market tape
- source credibility
- transmission graph
- keyword/ontology support
- replay adaptation snapshot
- math-model outputs

## 핵심 알고리즘 구성

### 1. theme / mapping scoring
- 이벤트를 theme에 매핑한다.
- 심볼별 sensitivity, corroboration, contradiction penalty, recency, coverage penalty를 합쳐 점수를 만든다.

### 2. event intensity / dependency estimation
- `hawkes-process.ts`
  - 사건 intensity와 aftershock 성격 추정
- `transfer-entropy.ts`
  - 이벤트-시장 간 방향성 정보 흐름 추정
- `normalized-mutual-information.ts`
  - 시장/신호 관계의 지연 상관 보조 지표
- `rmt-correlation.ts`
  - noisy correlation matrix 정제

### 3. adaptive ranking
- contextual bandit 상태를 이용해 심볼/테마 팔의 prior를 업데이트한다.
- replay에서 잘 먹힌 테마는 horizon/timeframe 쪽 prior가 올라간다.

### 4. regime-aware adjustment
- `regime-model.ts`의 결과로 theme multiplier를 조정한다.
- macro overlay와 current snapshot posture를 반영한다.

### 5. execution / autonomy constraints
- `autonomy-constraints.ts`
  - confirmed / tentative / fading / contradicted
  - shadow / deploy / abstain
- `execution-mpc.ts`
  - target weights를 현실 제약 아래로 눌러 sizing한다.

## 최종 결과물

- `DirectAssetMapping[]`
- `InvestmentIdeaCard[]`
- `InvestmentWorkflowStep[]`
- current decision brief

## 수정 시 주의

- 이 파일은 가중치, 벌점, 밴딧, regime, execution gate가 모두 겹친다.
- 단일 점수 하나만 바꾸면 나머지 층에서 상쇄될 수 있다.
- replay 성과가 좋아졌다고 live bucket이 좋아지는 것은 아니다. 두 층은 일부 공유하고 일부 독립이다.

