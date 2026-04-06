## Quick Start For Agents

This section is the stable entrypoint. Read this first if the rest of the file
looks stale or has encoding issues.

### What this repo is

`lattice-current-fix` is a live intelligence workspace with four major runtime
surfaces:

1. Main app shell
2. Replay / backtest workspace
3. Local sidecar API
4. Server and edge handlers

### Fast read order

1. [src/App.ts](C:\Users\chohj\Documents\Playground\lattice-current-fix\src\App.ts)
2. [src/app/README.md](C:\Users\chohj\Documents\Playground\lattice-current-fix\src\app\README.md)
3. [src/services/README.md](C:\Users\chohj\Documents\Playground\lattice-current-fix\src\services\README.md)
4. [src/services/historical-intelligence.md](C:\Users\chohj\Documents\Playground\lattice-current-fix\src\services\historical-intelligence.md)
5. [src/services/investment-intelligence.md](C:\Users\chohj\Documents\Playground\lattice-current-fix\src\services\investment-intelligence.md)
6. [src-tauri/sidecar/local-api-server.md](C:\Users\chohj\Documents\Playground\lattice-current-fix\src-tauri\sidecar\local-api-server.md)
7. [docs/AGENT_QUICKSTART.md](C:\Users\chohj\Documents\Playground\lattice-current-fix\docs\AGENT_QUICKSTART.md)
8. Directory guides for local ownership boundaries:
   - [server/README.md](C:\Users\chohj\Documents\Playground\lattice-current-fix\server\README.md)
   - [server/_shared/README.md](C:\Users\chohj\Documents\Playground\lattice-current-fix\server\_shared\README.md)
   - [server/worldmonitor/README.md](C:\Users\chohj\Documents\Playground\lattice-current-fix\server\worldmonitor\README.md)
   - [scripts/README.md](C:\Users\chohj\Documents\Playground\lattice-current-fix\scripts\README.md)
   - [tests/README.md](C:\Users\chohj\Documents\Playground\lattice-current-fix\tests\README.md)
   - [src/config/README.md](C:\Users\chohj\Documents\Playground\lattice-current-fix\src\config\README.md)
   - [src/utils/README.md](C:\Users\chohj\Documents\Playground\lattice-current-fix\src\utils\README.md)

### Main ownership map

- `src/app/*`
  - app orchestration, panel wiring, refresh scheduling, UI event routing
- `src/components/*`
  - visible panels, hubs, map surfaces, replay studio
- `src/services/*`
  - domain logic, caching, replay, investment intelligence, automation logic
- `src-tauri/sidecar/*`
  - local control plane used by browser mode and desktop mode
- `server/worldmonitor/*`
  - generated-service-backed RPC handlers and cache-aware server logic
- `api/*`
  - Vercel/edge compatible entrypoints and small standalone handlers

### If you need to fix X, start here

- Backtest or replay issue
  - [src/components/BacktestLabPanel.ts](C:\Users\chohj\Documents\Playground\lattice-current-fix\src\components\BacktestLabPanel.ts)
  - [src/backtest-hub-window.ts](C:\Users\chohj\Documents\Playground\lattice-current-fix\src\backtest-hub-window.ts)
  - [src/services/historical-intelligence.ts](C:\Users\chohj\Documents\Playground\lattice-current-fix\src\services\historical-intelligence.ts)
  - [src-tauri/sidecar/local-api-server.mjs](C:\Users\chohj\Documents\Playground\lattice-current-fix\src-tauri\sidecar\local-api-server.mjs)
- Live data loading issue
  - [src/app/data-loader.ts](C:\Users\chohj\Documents\Playground\lattice-current-fix\src\app\data-loader.ts)
  - [src/services/runtime.ts](C:\Users\chohj\Documents\Playground\lattice-current-fix\src\services\runtime.ts)
  - [src/services/runtime-config.ts](C:\Users\chohj\Documents\Playground\lattice-current-fix\src\services\runtime-config.ts)
- Cache / stale data issue
  - [src/services/persistent-cache.ts](C:\Users\chohj\Documents\Playground\lattice-current-fix\src\services\persistent-cache.ts)
  - [server/_shared/redis.ts](C:\Users\chohj\Documents\Playground\lattice-current-fix\server\_shared\redis.ts)
  - [src/config/cache-tiers.ts](C:\Users\chohj\Documents\Playground\lattice-current-fix\src\config\cache-tiers.ts)
- Map / layer issue
  - [src/components/DeckGLMap.ts](C:\Users\chohj\Documents\Playground\lattice-current-fix\src\components\DeckGLMap.ts)
  - [src/components/GlobeMap.ts](C:\Users\chohj\Documents\Playground\lattice-current-fix\src\components\GlobeMap.ts)
  - [src/components/MapContainer.ts](C:\Users\chohj\Documents\Playground\lattice-current-fix\src\components\MapContainer.ts)
- Server or edge handler issue
  - [server/gateway.ts](C:\Users\chohj\Documents\Playground\lattice-current-fix\server\gateway.ts)
  - [server/worldmonitor](C:\Users\chohj\Documents\Playground\lattice-current-fix\server\worldmonitor)
  - [api](C:\Users\chohj\Documents\Playground\lattice-current-fix\api)

### Validation commands

- Typecheck: `npm run typecheck`
- Full data tests: `npm run test:data`
- Build: `npm run build`
- Security header check: `npm run security:headers:check`
- CSP hash check: `npm run security:csp:check`
- Version sync check: `npm run version:check:all`
- CORS lint: `npm run lint:cors`

# Agent Architecture Map

이 저장소는 크게 5개 스트림으로 읽으면 된다.

1. `src/App.ts`
- 브라우저 런타임의 부트스트랩 진입점이다.
- 저장된 레이아웃, variant, map state, panel enable 상태를 읽고 `AppContext`를 만든다.
- 이후 `PanelLayoutManager`, `DataLoaderManager`, `EventHandlerManager`, `RefreshScheduler`를 조립한다.

2. `src/app/*`
- 화면 셸과 사용자 상호작용을 담당한다.
- `panel-layout.ts`: 패널 생성, 허브/워크스페이스 셸 렌더링, 메인 화면 배치.
- `data-loader.ts`: 실제 데이터 수집, 정규화, 상태 반영, intelligence fabric 갱신.
- `event-handlers.ts`: 버튼, 탭, 지도, 허브, 단축키, settings, replay trigger 같은 UI 행동 연결.
- `refresh-scheduler.ts`: 프런트 주기의 반복 refresh orchestration.

3. `src/components/*`
- 화면 구성 요소다.
- 패널형 컴포넌트와 허브형 페이지가 섞여 있다.
- `BacktestLabPanel.ts`, `backtest-hub-window.ts`, `AnalysisHubPage.ts`, `CodexHubPage.ts`, `OntologyGraphPage.ts`, `DeckGLMap.ts`가 핵심 표면이다.

4. `src/services/*`
- 실질적인 도메인 로직이다.
- 이벤트/시장 데이터 수집, 인텔리전스 계산, 백테스트, 자동화, 상태 진단, 수학 모델이 모두 여기에 있다.
- 가장 중요한 파일은 아래다.
  - `investment-intelligence.ts`
  - `historical-intelligence.ts`
  - `replay-adaptation.ts`
  - `data-flow-ops.ts`
  - `runtime-config.ts`
  - `rss.ts`, `gdelt-intel.ts`, `military-flights.ts`
  - `server/intelligence-automation.ts`

5. `src-tauri/*` + `src-tauri/sidecar/*`
- 데스크톱 런타임과 로컬 API 서버다.
- `src-tauri/src/main.rs`: Tauri shell, keyring, local API child process, window lifecycle.
- `src-tauri/sidecar/local-api-server.mjs`: 브라우저/데스크톱 공용 local control plane. 수동 replay, scheduler, secret sync, validation, archive 접근이 여기에 있다.

## 추천 읽기 순서

1. [src/README.md](C:\Users\chohj\Documents\Playground\lattice-current-fix\src\README.md)
2. [src/app/README.md](C:\Users\chohj\Documents\Playground\lattice-current-fix\src\app\README.md)
3. [src/services/README.md](C:\Users\chohj\Documents\Playground\lattice-current-fix\src\services\README.md)
4. [src/services/historical-intelligence.md](C:\Users\chohj\Documents\Playground\lattice-current-fix\src\services\historical-intelligence.md)
5. [src/services/investment-intelligence.md](C:\Users\chohj\Documents\Playground\lattice-current-fix\src\services\investment-intelligence.md)
6. [src-tauri/sidecar/local-api-server.md](C:\Users\chohj\Documents\Playground\lattice-current-fix\src-tauri\sidecar\local-api-server.md)

## 현재 시스템을 이해할 때 주의할 점

- 이 저장소는 "뉴스 뷰어"가 아니라 "수집 + 정규화 + 의사결정 + replay" 제품이다.
- 허브 UI와 패널 UI가 모두 존재한다.
- 같은 데이터라도
  - live snapshot
  - historical replay corpus
  - replay adaptation memory
  - local ops snapshot
  로 층이 다르다.
- 외부 공급자 실패는 자주 발생하므로, 많은 서비스 파일이 fallback, cache, cooldown, stale reuse를 포함한다.
