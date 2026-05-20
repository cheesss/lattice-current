# Lattice Current 세션 개선/수정 요약

작성일: 2026-04-23 KST  
범위: 이번 채팅 세션에서 논의, 조사, 코드 수정, 운영 검증까지 진행한 주요 파트

---

## 1. 전체 목표

이번 세션의 실질 목표는 다음 흐름을 운영 가능한 수준으로 만드는 것이었다.

```text
AI/Codex 제안
  -> 소스 후보 검증
  -> 실패 후보 자동 수리
  -> 실제 소스 등록
  -> 백필
  -> article/theme/event/pending outcome 데이터셋 반영
  -> 대시보드와 OpenClaw 브리핑에서 확인
```

초기 문제는 크게 네 가지였다.

1. Codex가 제안한 RSS/source 후보가 홈페이지 URL, sitemap, stale page 같은 낮은 품질 후보로 자주 올라왔다.
2. Simulate/Accept가 실제 feed 검증과 등록 결과를 명확히 반영하지 못했다.
3. 대시보드와 OpenClaw가 stale article 상태, sidecar 미연결, context 초과 문제를 제대로 드러내지 못했다.
4. 백필 데이터와 실시간/nowcast 데이터의 경계가 불명확해 dashboard 숫자의 신뢰성을 확인하기 어려웠다.

---

## 2. Source Proposal / RSS Ingestion 개선

### 2.1 source-probe 강화

주요 파일:

- `scripts/_shared/source-probe.mjs`
- `tests/source-probe.test.mjs`

반영 내용:

- 첫 번째 성공 adapter에서 멈추지 않고, 여러 adapter 결과를 비교해 가장 강한 후보를 선택하도록 개선했다.
- RSS/Atom 직접 feed, HTML alternate feed, WordPress `/feed/`, sitemap, JSON-LD, OpenGraph, HTML list 결과를 점수화해 비교한다.
- sitemap index와 paginated sitemap을 제한된 depth/fetch budget 안에서 확장한다.
- `news:title`, `news:publication_date`, `lastmod`를 이용해 sitemap item의 제목/날짜를 보강한다.
- broad theme token, 예: `technology`, `defense`, `market`, `source` 등은 hard relevance filter로 쓰지 않고 neutral relevance로 처리한다.
- RDF RSS 패턴과 XML entity decode 처리도 보강했다.
- homepage나 sitemap을 article sample로 잘못 세는 회귀를 막는 테스트를 추가했다.

운영 효과:

- `https://example.com/sitemap.xml?page=1` 같은 paginated sitemap이 실제 article URL로 확장된다.
- low-quality homepage 후보가 첫 성공으로 잘못 선택되는 문제를 줄였다.
- feed가 아니거나 stale한 후보는 여전히 reject/needs-fix로 남아 Accept 오분류를 막는다.

### 2.2 source repair closed-loop 기본 정책 변경

주요 파일:

- `scripts/run-source-repair-closed-loop.mjs`
- `tests/source-repair-closed-loop.test.mjs`
- `package.json`
- `src/services/server/intelligence-automation.ts`
- `scripts/master-daemon.mjs`

반영 내용:

- 운영 기본값을 강화했다.
  - target successes: `20`
  - limit: `300`
  - max candidates: `48`
  - backfill limit: `60`
  - daily RSS registration budget: `120`
  - `catalogBootstrap=true`
  - `fullHeuristic=true`
  - `countHistoricalSuccesses=true`
  - `enableCodeRepair=true`
- npm script `source:repair:closed-loop`와 dry-run script를 같은 정책으로 맞췄다.
- scheduler와 daemon이 같은 closed-loop 정책을 사용하도록 통일했다.
- `--no-full-heuristic`, `--no-catalog-bootstrap`, `--no-count-historical-successes` 같은 explicit negative flag도 추가했다.

중요 버그 수정:

- `parseArgs()`가 값 없는 boolean flag 뒤에 다른 flag가 오면 다음 flag 문자열을 값으로 잘못 읽었다.
- 이 때문에 `--full-heuristic --count-historical-successes`가 실제로는 `false`가 될 수 있었다.
- 파서를 고쳐 adjacent bare boolean flag가 정상적으로 `true` 유지되도록 했다.

검증 결과:

- 최신 closed-loop 직접 실행: `ok=true`
- `countedSuccesses=65`
- `targetForThisRun=0`
- `eventMappedSources=65`
- `codexRepairEventMappedSources=37`
- 스케줄러 최신 cycle에서도 `global:source-repair`가 `ok`로 기록됐다.

### 2.3 Codex 자동 코드 수리 경로

주요 파일:

- `scripts/_shared/codex-source-code-repair.mjs`
- `scripts/codex-source-code-repair.mjs`
- `data/codex-source-repair-runs/*`

반영/검증 내용:

- 실패 source 후보가 반복되면 Codex가 source ingestion 관련 허용 파일 범위 안에서 직접 코드를 수정하도록 했다.
- 실제 실행 결과 Codex가 `source-probe.mjs`와 `source-probe.test.mjs`를 수정했다.
- Codex 수리 결과 artifact에는 다음이 기록됐다.
  - status: `patched`
  - changedFiles: `scripts/_shared/source-probe.mjs`, `tests/source-probe.test.mjs`
  - tests: source-probe/source-repair/proposal-executor/self-heal 관련 테스트 통과
- 자동 수리 프로세스가 끝난 후 lock과 실행 프로세스를 확인했다.

운영 효과:

- Codex가 단순 조언만 하는 것이 아니라 source ingestion 코드 자체를 수정하는 경로가 실제로 동작했다.
- 다만 이 경로는 허용 파일과 테스트 명령으로 제한된다. 임의 DB write, secrets 수정, commit/push는 하지 않는다.

---

## 3. Approval / Decision Inbox 개선

### 3.1 실제 fetch 경로 기준 e2e 수정

주요 파일:

- `e2e/inbox-actions.spec.ts`

반영 내용:

- 기존 잘못된 mock 경로 `/api/approval-inbox-payload` 대신 실제 Decision Inbox fetch 경로를 사용한다.
  - `/api/proposal-inbox`
  - `/api/discovery-triage`
- triage review endpoint 실패 케이스도 포함했다.
  - `/api/discovery-triage/review`
- Canonical/Watch/Suppress 같은 triage action이 실제 review endpoint로 가는지 검증한다.

검증 결과:

- `npx playwright test e2e/inbox-actions.spec.ts --reporter=line`
- 14개 Playwright click test 모두 통과.

### 3.2 Simulate / Accept 의미 정리

개선 방향:

- Simulate는 더 이상 generic "would execute"가 아니라 실제 probe/quality/result를 보여줘야 한다.
- Accept는 skipped/failed probe를 executed로 닫으면 안 된다.
- quality threshold 미달, feed not found, stale feed는 needs-fix 또는 pending 유지가 맞다.

운영 효과:

- `IATA`, `ICAO`, `FAA`, `Flightradar24` 같은 homepage/document 후보가 feed가 아니면 그대로 등록되지 않는다.
- 반대로 수리 가능한 후보는 catalog/heuristic/source-probe를 통해 resolved feed로 전환 후 등록/백필된다.

---

## 4. Source 추가, 백필, downstream 연결

주요 파일:

- `scripts/backfill-active-rss-sources.mjs`
- `scripts/refresh-discovery-from-recent-themes.mjs`
- `scripts/run-source-repair-closed-loop.mjs`
- `scripts/_shared/discovered-source-registry.mjs`

반영/검증 내용:

- 등록된 source가 단순 registry entry에 머물지 않고 백필을 거쳐 articles에 들어가도록 확인했다.
- 이후 auto theme, event map, pending outcomes 연결 여부를 historical summary에서 집계했다.
- source repair KPI는 단순 등록 수가 아니라 event-mapped source 수를 중심으로 확인했다.

최신 검증 수치:

```text
activeSources: 66
seededSources: 65
themedSources: 65
eventMappedSources: 65
pendingOutcomeSources: 60
pendingOutcomes: 3382
codexRepairActiveSources: 37
codexRepairSeededSources: 37
codexRepairThemedSources: 37
codexRepairEventMappedSources: 37
codexRepairPendingOutcomeSources: 35
codexRepairPendingOutcomes: 1640
```

운영 효과:

- "제안 수락 -> 실제 소스 등록 -> 백필 -> downstream 반영"의 end-to-end 확인이 가능해졌다.
- 실패 후보는 큐에서 사라지는 것이 아니라 수리/거절/needs-fix 상태로 분류된다.

---

## 5. 데이터 신선도 / Backfill / Nowcast 경계

### 5.1 stale article 문제 조사 및 복구

초기 상태:

- OpenClaw 브리프와 health에서 articles가 약 142시간 stale로 표시됐다.
- 최근 24h/72h article count가 0으로 나왔다.
- signals는 최신인데 articles가 멈춰 있어 dashboard HOT/theme brief 신뢰도가 떨어졌다.

조치:

- NAS article freshness audit 확인.
- backfill/source repair/active RSS ingestion 흐름 확인.
- cache issue와 freshness finding을 대시보드 API에서 확인 가능하게 했다.

최신 상태:

```text
health: healthy
DB: connected
freshness findings: 0
cache issues: 0
24h articles: 2180+
72h articles: 2900+
latest article: 2026-04-22T07:01:50Z
```

### 5.2 live/backfill/nowcast 경계 정리

논의 및 설계 반영:

- 실시간으로 보여줘야 하는 값과 백필/학습/재현용 데이터를 분리해야 한다는 방향을 채택했다.
- `valueOrigin`, `validAsOf`, observed/estimated/proxy/composite/imputed 구분을 강화했다.
- signal history origin tagging, source hygiene, nowcast storage split, reconciliation, source eligibility gate가 주요 구조로 정리됐다.

Nowcast 관련 진행 상태:

- semantic contract, signal_history origin tagging, source hygiene, storage split, tier-2 gap-fill 코드가 준비/검증됐다.
- rates nowcast 모델 6개는 validation gate를 통과하지 못해 production 사용을 막았다.
- composite/event-intensity nowcast는 trained rates model 없이도 동작 가능한 경로로 유지했다.

중요 판단:

- FRED slow-moving rates series는 naive carry-forward baseline이 매우 강해 ridge + ETF proxy 모델이 gate를 이기지 못했다.
- gate-fail 모델을 저장하지 않도록 하고, rates redesign은 별도 트랙으로 분리했다.

---

## 6. OpenClaw 통합 및 운영 브리핑

주요 파일/영역:

- `plugins/openclaw-lattice-control-plane`
- `scripts/_shared/openclaw-webhook-emitter.mjs`
- `scripts/_shared/openclaw-agent-dispatch.mjs`
- `src-tauri/sidecar/local-api-server.mjs`
- global OpenClaw npm package under `%APPDATA%\npm\node_modules\openclaw`

### 6.1 OpenClaw control-plane 기능

반영 내용:

- Lattice MCP/control-plane tools가 다음 정보를 조회하도록 했다.
  - health
  - KPI summary
  - live status
  - data freshness audit
  - approval queue
  - discovery triage
  - source repair status
  - runtime observability
  - automation ops snapshot
- OpenClaw 대화가 한국어 operator context를 유지하도록 prompt/rules를 보강했다.
- Hinglish/언어 혼합 응답을 막는 테스트를 추가했다.
- deep link가 dashboard inbox fragment로 연결되도록 정리했다.

### 6.2 sidecarBaseUrl / observability 문제 해결

초기 문제:

- OpenClaw 브리프에서 `sidecarBaseUrl not configured`가 반복됐다.
- runtime observability, automation ops snapshot이 비어 있었다.

반영 내용:

- dashboard API에서 sidecar proxy endpoint를 추가했다.
  - `/api/runtime-observability`
  - `/api/automation-ops-snapshot`
  - `/api/source-repair-status`
- sidecar 자체에도 dashboard-friendly alias를 추가했다.
  - `/api/runtime-observability`
  - `/api/automation-ops-snapshot`
- missing route로 잡히지 않도록 route coverage skip list도 보강했다.

검증 결과:

- `http://127.0.0.1:46200/api/runtime-observability` 정상
- `http://127.0.0.1:46200/api/automation-ops-snapshot` 정상
- `http://127.0.0.1:46123/api/runtime-observability` 정상
- `http://127.0.0.1:46123/api/automation-ops-snapshot` 정상

### 6.3 OpenClaw CLI hang 수정

문제:

- `openclaw plugins list --json`
- `openclaw sessions --all-agents --json`

위 명령들이 JSON을 출력하거나 파일을 쓴 뒤에도 종료하지 않고 hang되는 문제가 있었다.

조치:

- global OpenClaw 설치본을 로컬 패치했다.
- `plugins list --json`은 manifest/config fast path를 사용하도록 수정했다.
- `sessions --json`은 JSON 출력 후 `runtime.exit(0)` 하도록 수정했다.

검증 결과:

- `plugins list --json`: exit 0
- `sessions --all-agents --json`: exit 0

주의:

- 이 수정은 프로젝트 repo 내부 파일이 아니라 사용자 머신의 global OpenClaw npm package에 적용된 local patch다.
- OpenClaw를 재설치/업데이트하면 다시 적용해야 할 수 있다.

---

## 7. Scheduler / Automation 안정화

주요 파일:

- `src/services/server/intelligence-automation.ts`
- `scripts/intelligence-scheduler.mjs`
- `scripts/master-daemon.mjs`

반영 내용:

- scheduler cycle에 source repair closed-loop 단계를 추가했다.
- cycle 실패 시 OpenClaw webhook event를 보낼 수 있도록 best-effort emit을 추가했다.
- cycle 완료와 brief-ready event도 생성하도록 했다.
- scheduler/daemon/source-repair script의 운영 인자를 통일했다.
- stale legacy daemon state가 현재 scheduler health를 덮어쓰지 않도록 OpenClaw summary 쪽을 보강했다.

최신 상태:

```text
activeCycle.status: idle
activeCycle.stage: completed
touchedDatasets:
  - coingecko-btc-core
  - fred-core-cpi
  - gdelt-middle-east
source-repair latest: ok
```

---

## 8. 실행 프로세스 / CPU / Node 정리

확인한 정상 실행 세트:

```text
npm run dev
  -> scripts/dev-theme-shell.mjs
  -> scripts/event-dashboard-api.mjs
  -> Vite

npm run sidecar:dev
  -> src-tauri/sidecar/local-api-server.mjs

npm run intelligence:scheduler
  -> scripts/intelligence-scheduler.mjs

openclaw gateway run
```

정리한 것:

- 중복/고아 Node 프로세스
- stale `openclaw plugins/sessions` CLI 프로세스
- 불필요하게 남은 `@playwright/mcp` Node 프로세스
- 오래 남은 구 인자 source-repair 하위 프로세스

CPU 조사 결론:

- 최근 5초 샘플 기준 Lattice Node 프로세스들은 거의 idle이었다.
- 실제 CPU를 더 쓰던 것은 VS Code renderer, Chrome, Codex desktop renderer/GPU 쪽이었다.
- Lattice scheduler는 작업 cycle 중에는 import/fetch/theme proposer/source repair로 순간 부하가 생길 수 있지만, 조사 시점에는 completed/idle 상태였다.

---

## 9. UI / Operator Cockpit / Workflow 문서화

진행 내용:

- Product Showcase와 Operator Cockpit을 다른 제품처럼 분리해야 한다는 방향을 정리했다.
- Operator Cockpit에는 smooth scroll, 과한 3D, 마그넷 hover, 모든 숫자 count-up 같은 효과를 넣지 않는 방향으로 정했다.
- workflow를 한 화면에서 볼 수 있도록 연결형 시스템 다이어그램/HTML 문서 방향을 정리했다.
- keyword/theme/source 추가 경로, OpenClaw 연결 경로, click sequence까지 함께 설명하는 구조를 만들었다.

주요 산출 방향:

- 운영 화면은 실시간 판단, 증거 추적, 의사결정에 최적화한다.
- showcase surface는 별도 제품 표면으로 분리한다.
- React 전환 전에는 CSS/token/HTML 기반 개선을 우선한다.

---

## 10. 테스트 및 검증

이번 세션에서 확인한 주요 검증:

```text
node --import tsx --test tests/source-repair-closed-loop.test.mjs
-> pass

node --test --test-isolation=none
  tests/source-probe.test.mjs
  tests/source-repair.test.mjs
  tests/source-repair-closed-loop.test.mjs
  tests/source-adapter-proposal.test.mjs
  tests/proposal-executor.test.mjs
  tests/self-heal-sources.test.mjs
  tests/local-runtime-observability-route.test.mjs
  tests/openclaw-plugin-control-plane.test.mjs
-> 60 pass

npm run typecheck
-> pass

npx playwright test e2e/inbox-actions.spec.ts --reporter=line
-> 14 pass
```

운영 API 확인:

```text
/api/health
-> healthy

/api/source-repair-status
-> countedSuccesses=65, targetSuccesses=20, targetMet=true

/api/data-freshness-audit
-> findings=0, cacheIssues=0, 24h articles=2180+

/api/runtime-observability
-> reachable

/api/automation-ops-snapshot
-> reachable
```

---

## 11. 현재 운영상 의미

현재 상태에서 Codex 제안 source는 예전처럼 무조건 잘못된 homepage URL이 approval queue에 쌓이는 구조가 아니다.

새 흐름:

```text
후보 생성
  -> source-probe 검증
  -> RSS/Atom/sitemap/feed discovery
  -> 품질 score와 recent items 확인
  -> 실패 시 source-repair catalog/heuristic/Codex code repair
  -> 통과 시 registry 등록
  -> active RSS backfill
  -> article theme / event map / pending outcome 연결
  -> source-repair-status와 OpenClaw 브리프에 노출
```

실패 후보 처리:

```text
feed 없음
stale sitemap
homepage only
recent item 부족
quality threshold 미달
```

위 경우는 executed로 닫지 않고 skip/needs-fix/repair 대상으로 유지한다.

---

## 12. 남은 리스크와 주의점

1. OpenClaw global package patch는 repo 내부 변경이 아니므로 재설치 시 사라질 수 있다.
2. ACLED 계열 dataset은 credential 없으면 fetch 실패가 정상이다. 현재 health 계산은 enabled dataset 기준으로 오류를 해석하도록 보강했다.
3. rates nowcast 모델은 production에 쓰지 않는다. gate fail 모델 저장/사용은 막았고, rates redesign은 별도 트랙이다.
4. Google News/iHeart 같은 broad syndicated source는 source diversity와 duplicate noise를 계속 감시해야 한다.
5. `data/` cache/audit/artifact 파일은 운영 중 계속 변한다. git commit 시 코드 변경과 generated data를 분리해서 다뤄야 한다.
6. source repair success count는 historical event-mapped 기준으로 세고 있으므로, 단순 "새로 등록된 수"와 다르다.

---

## 13. 핵심 결론

이번 세션의 가장 큰 변화는 source proposal이 단순 approval queue 항목에서 끝나지 않고, 실제 ingestion pipeline의 검증 가능한 폐루프로 바뀐 것이다.

검증된 상태:

```text
source repair target: 20
counted successes: 65
event-mapped sources: 65
Codex-repair event-mapped sources: 37
Decision Inbox e2e: 14 pass
related node tests: 60 pass
typecheck: pass
dashboard health: healthy
freshness findings: 0
cache issues: 0
```

따라서 현재 기준으로는 Codex가 제안하거나 수리한 source가 등록, 백필, 데이터셋 반영, dashboard/OpenClaw 보고까지 연결되는 운영 경로가 동작한다.
