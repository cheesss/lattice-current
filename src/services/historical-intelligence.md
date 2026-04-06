# `historical-intelligence.ts`

## 역할

이 파일은 historical frame corpus를 replay / walk-forward run으로 바꾸는 백테스트 엔진이다.

## 입력

- `HistoricalReplayFrame[]`
  - timestamp
  - news
  - clusters
  - markets
  - optional reports/transmission

## 출력

- `HistoricalReplayRun`
  - checkpoints
  - idea runs
  - forward returns
  - source profiles
  - mapping stats
  - workflow
  - coverage ledger
  - portfolio accounting

## 핵심 알고리즘

1. 프레임을 시간순으로 정렬한다.
2. warmup 구간과 evaluation 구간을 나눈다.
3. 각 프레임마다 아래를 재계산한다.
  - source credibility
  - event-market transmission
  - investment intelligence
4. evaluation 가능한 프레임에서 `ideaRuns`를 만든다.
5. 각 idea의 심볼에 대해 horizon별 forward return을 계산한다.
6. cost, slippage, tradability, session state를 반영한 reality-aware summary를 만든다.
7. replay 결과를 archive와 replay adaptation memory로 보낸다.

## walk-forward 방식

- rolling retrain이 아니라, train/validate/test window를 나눈 뒤 seed state를 이어받는 구조다.
- 완전한 online learning simulator가 아니라 "한 번 replay로 학습 상태를 만든 뒤 다음 구간에 적용"에 가깝다.

## 자주 발생하는 문제

- frame은 많지만 idea가 0개
  - mapping/intelligence 층이 아이디어를 못 만드는 상태
- run은 끝나지만 NAV가 평평함
  - size multiplier / execution gate / tradability가 지나치게 보수적일 수 있다
- provider가 달라 frame density가 크게 달라질 수 있음

