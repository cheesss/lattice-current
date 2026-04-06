# `data-flow-ops.ts`

## 역할

운영자용 health synthesizer다. 여러 서비스와 snapshot을 모아 "지금 파이프라인이 왜 막히는지"를 한 장의 ops snapshot으로 만든다.

## 입력

- automation status
- local ops snapshot
- historical dataset summaries
- investment intelligence snapshot
- replay adaptation snapshot
- coverage ledger

## 출력

- overview
- pipeline
- current snapshot freshness
- dataset rows
- issues
- checks
- recent runs

## 내부 알고리즘

### dataset blocker derivation
- fetch/import/replay/theme-discovery 시각
- consecutive failures
- provider error string
- completeness / gap / retention pressure
를 보고 blocker 배열을 만든다.

### status classification
- `ready / watch / degraded / blocked`
- auth/credential blocker는 `blocked`
- 늦은 cadence, low completeness는 `watch` 또는 `degraded`

### suggestion synthesis
- provider error가 auth/rate-limit/timeout인지에 따라 fix 문구를 다르게 만든다.
- 최근 수정으로 ACLED는 coverage 부족일 때 auth 실패처럼 보이지 않게 별도 문구를 쓴다.

## 왜 중요한가

- Backtest Hub, Data Flow Ops, Codex Ops가 같은 상태 해석을 쓰기 위해 필요하다.
- 이 파일이 약하면 같은 장애를 패널마다 다르게 설명하게 된다.

