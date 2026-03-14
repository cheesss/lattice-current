# WorldMonitor 구조 핸드오프 문서 (LLM 전달용)

## 1) 툴 목적 (What It Is)

- 월드모니터는 **뉴스 + 정량 시세 + 지정학/재난/물류 신호**를 한 화면(패널 + 지도/지구본)으로 통합하는 인텔리전스 대시보드입니다.
- 핵심 파이프라인은 **수집 -> 정규화/분류 -> 클러스터링/스코어링 -> 패널/지도 렌더링 -> 주기 갱신**입니다.
- 엔트리 및 오케스트레이션 파일:
  - `src/main.ts`
  - `src/App.ts`
  - `src/app/data-loader.ts`

## 2) 런타임 구조 (Web + Desktop)

- 프론트엔드 앱이 `/api/*`를 호출하면, 데스크톱(Tauri)에서는 fetch patch가 로컬 사이드카로 라우팅합니다.
- 사이드카는 로컬 토큰 인증, 라우트 디스패치, 선택적 cloud fallback을 처리합니다.
- Desktop 전용 기능:
  - 키체인 시크릿 로드
  - 로컬 API 토큰/포트 동적 획득
  - Glint 로그인 윈도우 연동
- 관련 파일:
  - `src/services/runtime.ts`
  - `src/services/runtime-config.ts`
  - `src-tauri/src/main.rs`
  - `src-tauri/sidecar/local-api-server.mjs`

## 3) 모드/버전(Variant)

- 지원 변형: `full`, `finance`, `tech`, `happy`
- 선택 로직:
  - `VITE_VARIANT` 우선
  - env가 `full`일 때만 localStorage override 허용
- 변형별 기본 패널/레이어 설정 파일:
  - `src/config/variant.ts`
  - `src/config/panels.ts`
  - `src/config/feeds.ts`

## 4) 부팅/실행 순서 (Lifecycle)

1. `main.ts`에서 Sentry 초기화, runtime fetch patch 설치, desktop secrets 로드 후 `App` 시작.
2. `App.init()`에서 UI/맵/패널 생성, 이벤트 바인딩, URL 상태 동기화.
3. `loadAllData()`로 초기 데이터 풀로드.
4. `full + glint enabled` 조합이면 Glint WS 실시간 구독 시작.
5. RefreshScheduler가 데이터별 주기 갱신 시작.

참고 파일:
- `src/main.ts`
- `src/App.ts`
- `src/app/refresh-scheduler.ts`

## 5) 데이터 파이프라인 (Ingestion to Rendering)

### 뉴스 파이프라인

- `FEEDS` manifest 순회 -> RSS/Google News RSS를 `/api/rss-proxy`로 수집
- 키워드 기반 위협 분류 + 선택적 AI 재분류
- 클러스터링 후 패널 렌더 + 지도 좌표 반영
- 파일:
  - `src/services/rss.ts`
  - `src/services/threat-classifier.ts`
  - `src/components/NewsPanel.ts`

### 시장(OpenBB 우선) 파이프라인

- `/api/local-openbb?action=coverage/tape`로 커버리지 확인 후 심볼 배치 호출
- 실패/부족 시 Finnhub/CoinGecko 등 폴백
- 파일:
  - `api/local-openbb.js`
  - `src/services/openbb-intel.ts`
  - `src/app/data-loader.ts`

### Glint 파이프라인

- Public globe + private feed/movers + WS(room 구독) 병합
- 인증 토큰 없으면 private feed 제한, public 위주
- 파일:
  - `src/services/glint.ts`
  - `src/app/data-loader.ts`

## 6) 데이터 출처 방식 (Sources)

- 뉴스 소스는 대부분 하드코딩 manifest(`feeds.ts`) 기반
- 수집 형태 2가지
  - 직접 RSS: BBC, Federal Reserve, CoinDesk 등
  - Google News RSS 검색: `news.google.com/rss/search?q=...`
- 즉, 사이트 내부 비공개 검색 API를 직접 때리는 구조가 아니라 RSS/검색 RSS를 읽어오는 구조가 중심
- 인텔 소스는 `INTEL_SOURCES`로 별도 관리

## 7) 시각화 구조 (Visualization)

### 맵 엔진

- Desktop/WebGL2 가능: deck.gl + maplibre
- 실패/모바일: SVG fallback
- 파일:
  - `src/components/MapContainer.ts`
  - `src/components/DeckGLMap.ts`

### 투영

- Globe / Mercator 토글

### 충돌 폴리곤

- 정적 `CONFLICT_ZONES` + 동적 conflict zone 생성
- 동적 산정 규칙:
  - 최근 48시간
  - 0.5도 버킷
  - alert 수 + 기사 수 + 최근성 기반 intensity(high/medium/low)
- Globe 모드 리프트:
  - high 18000m
  - medium 13000m
  - low 9000m

### 국가 간 연결선(Arc)

- 뉴스에서 국가코드 추출 후 pair(co-mention) 점수 누적
- 반영 요소:
  - 위협 레벨
  - 최근성
  - 전쟁형 키워드
  - 양자 충돌 문맥
  - 우선관심 국가쌍 보정
  - 난민 이동/무역 루트 스트레스 보강

### 뉴스 포인트

- 위협 수준별 색상 + 신규 뉴스 pulse 애니메이션

## 8) 패널 렌더링 방식

### NewsPanel

- flat 리스트를 먼저 빠르게 렌더
- 백그라운드 클러스터링 완료 후 clustered view로 업그레이드
- 데이터가 많으면 virtual/windowed 렌더 적용
- P1~P4 우선순위, 번역 버튼, 요약 버튼 제공
- 파일: `src/components/NewsPanel.ts`

### MonitorPanel (Add monitor)

- 데이터 소스 추가 기능이 아니라 사용자 키워드 모니터 추가 기능
- title + description에서 단어 경계 regex 매칭
- link 기준 dedupe
- 파일: `src/components/MonitorPanel.ts`

### OpenBB 패널

- `cross-asset-tape`
- `event-impact-screener`
- `country-exposure-matrix`
- coverage 기반으로 사용 가능한 지표/컬럼만 동적 표시

## 9) 갱신 주기 (Refresh)

기본 상수 (`src/config/variants/base.ts`):
- feeds: 5분
- markets: 4분
- predictions: 5분
- ais: 10분

스케줄러(`src/app/refresh-scheduler.ts`) 특징:
- hidden 탭에서 4배 느리게
- 10% 지터
- in-flight 중복 실행 방지
- 복귀 시 stale 작업 플러시

full 모드 추가:
- intelligence: 15분
- glint realtime refresh: 45초(옵션 켜진 경우)

## 10) OpenBB / Glint 역할 요약

### OpenBB

- 시장/원자재/암호 테이프의 1순위 소스
- coverage 기반 엔드포인트 사용
- 실패 시 기존 소스 폴백 + fallback 배너

### Glint

- 실시간/반실시간 OSINT형 피드와 geo marker 보강
- private feed는 auth 토큰 필요
- WS room 구독 메시지 수신 시 debounced refresh 트리거
- 로컬 토큰 키: `wm_glint_auth_token`

## 11) 백엔드/API 표면

- 로컬 사이드카가 `api/*.js` 라우트 테이블을 빌드해 디스패치
- generated client 도메인:
  - aviation
  - climate
  - conflict
  - cyber
  - displacement
  - economic
  - giving
  - infrastructure
  - intelligence
  - maritime
  - market
  - military
  - news
  - positive_events
  - prediction
  - research
  - seismology
  - supply_chain
  - trade
  - unrest
  - wildfire
- 폴더: `src/generated/client/worldmonitor`

## 12) LLM 전달용 요약 스펙 (YAML)

```yaml
product:
  name: worldmonitor
  purpose: "multi-source geopolitical+market intelligence dashboard"
  ui: ["panel grid", "deck.gl globe/map", "status/freshness"]

runtime:
  web: "direct /api calls"
  desktop:
    tauri: true
    sidecar: "local node api server"
    fetch_patch: "intercepts /api/*, injects bearer, local-first"
    local_only_prefix: "/api/local-*"

variants:
  - full
  - finance
  - tech
  - happy

ingestion_pipeline:
  - feeds_manifest: "hardcoded in config/feeds.ts"
  - rss_fetch: "/api/rss-proxy"
  - classify: "keyword threat + optional AI override"
  - cluster: "analysis worker clusterNews"
  - map_bind: "news locations + hotspots + conflict zones + country arcs"
  - panel_render: "flat-first then clustered, virtualized for large lists"

primary_data_sources:
  news:
    method: ["direct RSS", "Google News RSS search"]
    config_file: "config/feeds.ts"
  openbb:
    endpoint: "/api/local-openbb?action=coverage|tape"
    role: "primary tape + intel panel base"
    fallback: "finnhub/coingecko/etc"
  glint:
    endpoints:
      - "https://api.glint.trade/api/public/globe"
      - "https://api.glint.trade/api/feed/v2"
      - "https://api.glint.trade/api/movers"
      - "wss://api.glint.trade/ws"
    role: "geo marker + feed + realtime trigger"

visualization:
  map_engine:
    desktop: "deck.gl + maplibre"
    fallback: "svg map"
  projection: ["globe", "mercator"]
  dynamic_conflict_zones:
    window: "48h"
    binning: "0.5-degree grid"
    intensity_logic: "count + alerts + recency"
    globe_lift_m: {high: 18000, medium: 13000, low: 9000}
  country_interaction_arcs:
    inputs: ["country co-mentions", "threat", "recency", "conflict verbs", "displacement flows", "trade route stress"]
  news_markers:
    style: "threat color + pulse animation"

refresh:
  scheduler_features: ["visibility-aware throttling", "jitter", "in-flight guard", "stale flush"]
  base_intervals:
    feeds_min: 5
    markets_min: 4
    predictions_min: 5
    ais_min: 10
  full_extra:
    intelligence_min: 15
    glint_realtime_sec: 45

user_interaction:
  add_monitor:
    meaning: "add keyword monitor (not source)"
    matching: "title+description, word-boundary regex, dedupe by link"
```
