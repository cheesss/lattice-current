# `replay-adaptation.ts`

## 역할

과거 replay run을 "현재 의사결정에 쓸 수 있는 memory"로 압축한다.

## 무엇을 저장하나

- recent run digests
- theme profiles
- regime profiles
- horizon preferences
- workflow quality/execution/activity scores
- current theme performance

## 핵심 알고리즘

### theme profile aggregation
- run별 forward return record를 theme 기준으로 다시 묶는다.
- horizon별 hit rate, avg return, tradable rate, reality score를 계산한다.

### robust utility
- 단순 평균 수익률보다 보수적인 점수를 쓴다.
- 최근 변경 기준으로 아래 요소가 들어간다.
  - window median utility
  - dispersion penalty
  - flip-rate penalty
  - current-vs-replay drift penalty

### workflow scoring
- run 전체를 quality / execution / activity / coverage로 분해한다.
- UI의 readiness badge와 backtest hub summary는 이 값을 사용한다.

## 왜 필요한가

- raw replay run은 길고 무겁다.
- 현재 의사결정 층은 "테마별로 과거에 어떤 horizon이 먹혔는지"를 빠르게 알아야 한다.
- replay adaptation은 그 중간 메모리 레이어다.

