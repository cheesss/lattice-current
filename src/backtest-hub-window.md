# `backtest-hub-window.ts`

## 역할

브라우저 전용 `Replay Studio` 전체 페이지를 렌더링한다. 이 파일은 백테스트 결과 화면이 아니라, 아래 세 층을 합친 operator workspace다.

- backtest run history
- current decision support
- data/pipeline health

## 내부 구조

- `DataFlowOpsSnapshot`를 읽어 파이프라인 상태와 dataset health를 받는다.
- `HistoricalReplayRun` 목록을 읽어 replay/walk-forward/current-like 비교 카드를 만든다.
- `investment-intelligence.ts`에서 현재 decision bucket을 만들어 `Act Now / Defensive / Avoid / Watch`를 보여준다.

## 탭 시스템

- `overview`
- `decision`
- `data`
- `history`

탭은 `data-action="set-view"` 이벤트 위임으로 동작한다.

## 주요 계산

- latest replay/walk-forward/current-like summary 카드
- run selection + selected run interpretation
- dataset health table
- source family coverage
- guided flow / next action recommendation

## 자주 헷갈리는 점

- `Current-like`는 항상 최신 replay와 같은 뜻이 아니다.
- decision bucket은 live snapshot 기반일 수 있고, replay-backed 결과와 완전히 같지 않다.
- `No idea`는 UI 고장이 아니라 thin corpus일 수 있다.

