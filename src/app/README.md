# App Layer Quick Guide

Use this section when you need to know where user actions become state
changes.

## File roles

- [panel-layout.ts](C:\Users\chohj\Documents\Playground\lattice-current-fix\src\app\panel-layout.ts)
  - creates panel instances and shell layout
- [data-loader.ts](C:\Users\chohj\Documents\Playground\lattice-current-fix\src\app\data-loader.ts)
  - populates app context from services and pushes results into panels/maps
- [event-handlers.ts](C:\Users\chohj\Documents\Playground\lattice-current-fix\src\app\event-handlers.ts)
  - binds user actions to commands and state mutations
- [refresh-scheduler.ts](C:\Users\chohj\Documents\Playground\lattice-current-fix\src\app\refresh-scheduler.ts)
  - recurring refresh logic and polling orchestration
- [search-manager.ts](C:\Users\chohj\Documents\Playground\lattice-current-fix\src\app\search-manager.ts)
  - command palette and index search

## Editing rules that avoid regressions

- If you add a new panel:
  - wire it in `panel-layout.ts`
  - if it needs data, connect it in `data-loader.ts`
  - if it needs a button or command, connect it in `event-handlers.ts` or `search-manager.ts`
- If you change refresh behavior:
  - check `refresh-scheduler.ts`
  - check tests for `flush-stale-refreshes` and `smart-poll-loop`
- If you change bootstrap hydration:
  - check `src/services/bootstrap.ts`
  - ensure a `getHydratedData('<key>')` consumer exists

# `src/app` Guide

이 디렉터리는 "무엇을 보여주고 언제 갱신할지"를 정한다.

## 파일별 역할

- [panel-layout.ts](C:\Users\chohj\Documents\Playground\lattice-current-fix\src\app\panel-layout.ts)
  - 메인 레이아웃, 허브 버튼, workspace strip, 패널 인스턴스 생성.
- [data-loader.ts](C:\Users\chohj\Documents\Playground\lattice-current-fix\src\app\data-loader.ts)
  - 뉴스/시장/지정학/운영 데이터의 실제 수집기.
- [event-handlers.ts](C:\Users\chohj\Documents\Playground\lattice-current-fix\src\app\event-handlers.ts)
  - 사용자 이벤트와 런타임 액션을 연결.
- [refresh-scheduler.ts](C:\Users\chohj\Documents\Playground\lattice-current-fix\src\app\refresh-scheduler.ts)
  - 주기 refresh.
- [search-manager.ts](C:\Users\chohj\Documents\Playground\lattice-current-fix\src\app\search-manager.ts)
  - `Ctrl+K` 명령 검색/열기.
- [country-intel.ts](C:\Users\chohj\Documents\Playground\lattice-current-fix\src\app\country-intel.ts)
  - 국가 단위 intel surface orchestration.

## 주된 실행 스트림

1. `panel-layout.ts`가 DOM skeleton과 panel objects를 만든다.
2. `data-loader.ts`가 context를 채운다.
3. `event-handlers.ts`가 사용자 조작을 받아 state를 바꾼다.
4. `refresh-scheduler.ts`가 2와 3 사이를 주기적으로 돌린다.

## 수정 원칙

- 새 데이터는 `data-loader.ts`에서 로드하고, `panel-layout.ts`에서는 panel wiring만 한다.
- 허브 열기/닫기, 탭 클릭, 설정 버튼 같은 UI 동작은 `event-handlers.ts`에 둔다.
- panel wiring과 data fetching을 한 파일에 섞지 않는 것이 중요하다.
