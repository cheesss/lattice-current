# Quick Orientation

Use this section first. It is intentionally short and ASCII-only.

## Runtime layers

- `src/App.ts`
  - top-level composition and startup wiring
- `src/app/*`
  - orchestration layer
- `src/components/*`
  - UI layer
- `src/services/*`
  - domain logic and stateful processing
- `src/styles/*`
  - visual system

## Most important files by task

- Startup and global state
  - [App.ts](C:\Users\chohj\Documents\Playground\lattice-current-fix\src\App.ts)
  - [main.ts](C:\Users\chohj\Documents\Playground\lattice-current-fix\src\main.ts)
- Data loading and refresh
  - [data-loader.ts](C:\Users\chohj\Documents\Playground\lattice-current-fix\src\app\data-loader.ts)
  - [refresh-scheduler.ts](C:\Users\chohj\Documents\Playground\lattice-current-fix\src\app\refresh-scheduler.ts)
- Replay / backtest
  - [BacktestLabPanel.ts](C:\Users\chohj\Documents\Playground\lattice-current-fix\src\components\BacktestLabPanel.ts)
  - [backtest-hub-window.ts](C:\Users\chohj\Documents\Playground\lattice-current-fix\src\backtest-hub-window.ts)
  - [historical-intelligence.ts](C:\Users\chohj\Documents\Playground\lattice-current-fix\src\services\historical-intelligence.ts)
- Live intelligence / decisions
  - [investment-intelligence.ts](C:\Users\chohj\Documents\Playground\lattice-current-fix\src\services\investment-intelligence.ts)
  - [replay-adaptation.ts](C:\Users\chohj\Documents\Playground\lattice-current-fix\src\services\replay-adaptation.ts)
  - [data-flow-ops.ts](C:\Users\chohj\Documents\Playground\lattice-current-fix\src\services\data-flow-ops.ts)

## Common failure patterns

- UI looks empty
  - check whether `data-loader.ts` actually populated context
- Hub shows no runs
  - check `historical-intelligence.ts` and sidecar archive routes
- Data present but stale
  - check `persistent-cache.ts`, `runtime.ts`, and `server/_shared/redis.ts`
- Map layer exists but nothing renders
  - check map layer toggle state plus the relevant `set*` method in `DeckGLMap.ts` or `GlobeMap.ts`

# `src` Overview

이 디렉터리는 브라우저 런타임 전체다.

## 역할

- 앱 부트
- 셸 렌더링
- 패널/허브 UI
- 데이터 수집과 상태 동기화
- 백테스트, replay, 투자 인텔리전스
- 데스크톱 sidecar와의 통신

## 중요한 파일

- [App.ts](C:\Users\chohj\Documents\Playground\lattice-current-fix\src\App.ts)
  - 앱의 최상위 조립기.
- [main.ts](C:\Users\chohj\Documents\Playground\lattice-current-fix\src\main.ts)
  - CSS, analytics, App 진입점.
- [backtest-hub-window.ts](C:\Users\chohj\Documents\Playground\lattice-current-fix\src\backtest-hub-window.ts)
  - 전용 replay/research 허브 렌더러.

## 하위 디렉터리 읽는 법

- `app/`: orchestration
- `components/`: UI surface
- `services/`: domain logic
- `styles/`: visual system
- `config/`: variants, panels, feeds, workspaces
- `types/`: shared runtime types
- `utils/`: helper utilities

## 주된 데이터 흐름

1. `App.ts`가 상태 저장소와 runtime 환경을 읽는다.
2. `DataLoaderManager`가 외부 데이터와 캐시를 수집한다.
3. `services/*`가 클러스터링, 인텔리전스, replay state를 만든다.
4. `PanelLayoutManager`가 화면 뼈대를 만들고 패널을 인스턴스화한다.
5. `EventHandlerManager`가 버튼/탭/허브/설정/지도 동작을 연결한다.
6. `RefreshScheduler`가 주기적 갱신을 건다.
