# Lattice 시스템 성숙도 A등급 달성 계획

Date: 2026-04-06
Current Grade: B-
Target Grade: A

---

## 설계 철학

### 1. "돌려봐야 존재하는 것"

코드가 있다 ≠ 기능이 있다. TypeScript 컴파일 통과는 "문법이 맞다"일 뿐, "작동한다"가 아니다.
모든 기능은 **실제 실행 → 결과 확인 → 결과 저장** 사이클을 거쳐야 "구현 완료"로 인정한다.

**규칙:**
- 새 모듈 작성 후 반드시 1회 이상 실행하고, 결과를 data/ 또는 NAS에 저장
- "미확인" 상태를 허용하지 않음. 확인 못 하면 문서에 "미검증"으로 표기
- end-to-end 흐름이 깨지면 개별 모듈 성능은 무의미

### 2. "노이즈는 시그널보다 해롭다"

auto_theme_symbols에서 BDRY(해운 ETF)가 모든 테마에서 1위인 것은 "발견"이 아니라 "변동성이 원래 높은 종목"이다.
분석 결과가 직관적이지 않으면 사용자에게 해를 끼친다.

**규칙:**
- 자동 매핑 결과에서 "원래 변동성이 높은 종목"을 필터링
- 반응 ratio뿐 아니라 **반응 방향의 일관성**(hit rate)도 함께 평가
- 설명할 수 없는 패턴은 "발견"이 아니라 "노이즈 후보"로 분류

### 3. "자동화는 신뢰 위에 성립"

master-daemon을 24시간 돌리기 전에, 각 단계가 10회 연속 성공해야 한다.
한 단계의 실패가 전체 파이프라인을 중단시키지 않아야 한다.

**규칙:**
- 모든 자동화 단계는 독립적 실패 가능 (circuit breaker 패턴)
- 실패 시 마지막 성공 상태를 유지 (stale data > no data)
- 로그에 실패 원인이 명확히 기록

### 4. "UI는 데이터가 있을 때만 보여준다"

빈 패널, "Loading...", "No data"는 사용자 경험을 해친다.
데이터가 없으면 해당 섹션을 숨기고, 있는 데이터만 보여준다.

**규칙:**
- API 응답이 빈 배열이면 해당 UI 섹션 hide
- "데이터 없음" 대신 "데이터 수집 중 (다음 갱신: 15분 후)" 같은 상태 표시
- 마지막 성공 데이터를 캐시하여 API 다운 시에도 stale 표시

---

## Stage 1: 기반 검증

**목적:** 시스템이 실제로 돌아가는지 확인. 이후 모든 Stage의 전제조건.

### 1-1. 앱 빌드 + Event Intelligence 패널 표시 확인

**현재 문제:**
- `npm run dev`로 앱을 띄워본 적 없음 (이 브랜치에서)
- EventIntelligencePanel이 실제로 렌더링되는지 미확인
- dashboard API가 앱과 별도 프로세스 → 자동 기동 안 됨

**수정 방향:**

1. `npm run dev` 실행 → 브라우저에서 확인
2. EventIntelligencePanel이 보이지 않으면:
   - `src/app/panel-layout.ts`의 createPanels()에서 variant 분기 확인
   - panel이 생성되는 variant('full', 'tech', 'finance')에 포함되는지 확인
   - API 호출 실패 시 showError가 정상 동작하는지 확인
3. dashboard API 자동 기동:
   - **방법 A (권장):** Vite dev server의 configureServer hook에서 child_process로 API 서버 자동 시작
   - **방법 B:** npm scripts에 `"dev": "concurrently 'vite' 'node --import tsx scripts/event-dashboard-api.mjs'"` 추가
   - **방법 C:** local-api-server.mjs에 이미 프록시 추가됨 → API 서버를 local-api-server 안에 통합

**수정 파일:**
- `package.json` — dev 스크립트 수정
- `vite.config.ts` — configureServer에서 API 서버 자동 시작 (방법 A일 경우)
- `src/components/EventIntelligencePanel.ts` — 런타임 에러 수정 (있다면)

**검증:**
```bash
npm run dev
# 브라우저에서 Event Intelligence 패널이 보이고
# 히트맵, 온도, 이벤트, 전략 섹션에 데이터가 표시
```

### 1-2. end-to-end 흐름 1회 검증

**현재 문제:**
- data-loader hook이 실제로 article-ingestor와 signal-history-updater를 호출하는지 미확인
- ingest → classify → pending → signal_history 전 구간이 연결되는지 미확인

**수정 방향:**

수동 검증 스크립트 작성: `scripts/verify-e2e.mjs`

```
1. 기사 1건 수동 투입 (ingestArticle 직접 호출)
2. auto_article_themes에 분류 결과 확인
3. pending_outcomes에 entry_price 기록 확인
4. signal_history에 최근 값 확인
5. stock_sensitivity_matrix에 반영 확인
6. 각 단계의 결과를 JSON으로 저장
```

**수정 파일:**
- `scripts/verify-e2e.mjs` — **신규**

**검증:**
```bash
node --import tsx scripts/verify-e2e.mjs
# 모든 단계 PASS 출력
```

### 1-3. pending_outcomes 처리 확인

**현재 문제:**
- 1,020건의 pending이 있지만, checkPendingOutcomes()가 실행되어 실제로 labeled_outcomes로 이동한 적 있는지 불명

**수정 방향:**

1. `checkPendingOutcomes()` 수동 1회 실행
2. target_date <= 오늘인 pending 건수 확인
3. 처리 후 labeled_outcomes 증가 확인
4. pending → completed 상태 변경 확인

**수정 파일:**
- `scripts/verify-e2e.mjs`에 포함

**검증:**
```sql
SELECT status, COUNT(*) FROM pending_outcomes GROUP BY status;
-- waiting: N건, completed: M건
```

---

## Stage 2: 데이터 품질 + AI 활성화

**목적:** 데이터를 풍부하게 하고, AI 분석을 실제로 실행.

### 2-1. Ollama 60k 기사 분석

**현재 문제:**
- `article_analysis` 테이블이 존재하지 않음 → ollama-article-analyzer.mjs가 한 번도 실행 안 됨
- 60k 기사 × 2초/건 = 33시간 → 전략 필요

**수정 방향:**

1. 정규식 1차 필터링 (1분) → 키워드/엔티티 후보 추출
2. Ollama는 "모호한 기사" 또는 "상위 5k건"만 정밀 분석 (3시간)
3. 결과를 article_analysis 테이블에 저장
4. auto_trend_keywords에 새 키워드 등록

**실행 계획:**
```bash
# 1차: 전체 기사 제목에서 정규식으로 빠른 추출 (신규 스크립트)
node --import tsx scripts/fast-keyword-extractor.mjs --limit 60000

# 2차: 상위 5000건만 Ollama 정밀 분석
node --import tsx scripts/ollama-article-analyzer.mjs --limit 5000
```

**수정 파일:**
- `scripts/fast-keyword-extractor.mjs` — **신규** (정규식 기반 빠른 추출)
- `scripts/ollama-article-analyzer.mjs` — 기존 (실행만 하면 됨)

**A 기준:** article_analysis에 5,000건 이상, auto_trend_keywords에 200개 이상

### 2-2. auto_article_themes 60k 전체 분류

**현재 문제:**
- 8,110 / 60,485 = 13%만 분류됨

**수정 방향:**

auto-pipeline Step 1을 전체 실행. 배치 SQL 방식(현재 구현)이므로 수 분 내 완료.

```bash
node --import tsx scripts/auto-pipeline.mjs --step 1 --limit 60000
```

**A 기준:** 60k건 전체 분류 완료 (unknown 10% 미만)

### 2-3. 테마-종목 매핑 노이즈 제거

**현재 문제:**
- BDRY(Baltic Dry Index ETF)가 모든 테마에서 상위 → 이건 "모든 것에 반응하는 고변동 종목"이지 의미 있는 매핑이 아님
- ^VIX도 마찬가지 — 변동성 지표라 모든 이벤트에 반응

**수정 방향:**

auto-pipeline Step 2에 **필터 추가:**

```typescript
// 제외 조건:
// 1. 모든 테마에서 상위 3에 들어가는 종목 (범용 변동성 종목)
// 2. reaction ratio < 1.10 (5% 이상 차이만 유의)
// 3. hit rate < 0.48 또는 > 0.52에서 벗어나지 않는 종목 (방향성 없음)

// 추가 조건:
// 4. 해당 테마에서만 특이하게 높은 반응 (다른 테마 대비 ratio 1.3x 이상)
```

**수정 파일:**
- `scripts/auto-pipeline.mjs` — Step 2 필터 강화

**A 기준:** 매핑이 직관적 (conflict→GLD/ITA/USO, tech→NVDA/SMH/AMD 수준)

### 2-4. Codex/Executor 반복 검증

**현재 문제:**
- 1회만 실행. 반복 시 일관성 미확인
- Codex가 같은 데이터를 보고 매번 다른 제안을 하는지, 수렴하는지 모름

**수정 방향:**

3회 순환 실행 + 결과 비교:

```bash
# 순환 1
node --import tsx scripts/codex-from-analysis.mjs
node --import tsx scripts/proposal-executor.mjs
# 순환 2 (갱신된 데이터 반영)
node --import tsx scripts/master-pipeline.mjs --step 5
node --import tsx scripts/codex-from-analysis.mjs
node --import tsx scripts/proposal-executor.mjs
# 순환 3
...
```

결과 비교: 3회차에서 새 제안이 줄어들면 "수렴", 계속 나오면 "발산"

**A 기준:** 3회 순환 후 제안 수렴 (새 제안 < 2건), 검증 통과율 50% 이상

### 2-5. 실시간 흐름 1시간 연속 검증

**현재 문제:**
- data-loader hook이 실제로 작동하는지 장시간 검증 안 함

**수정 방향:**

앱을 1시간 띄워놓고:
1. articles 테이블 row count 변화 모니터링
2. signal_history 최신 ts 확인
3. pending_outcomes 증가 확인
4. 에러 로그 확인

**검증 스크립트:** `scripts/verify-realtime-1h.mjs` — 5분마다 체크, 1시간 후 리포트

**A 기준:** 1시간 동안 articles +10건 이상, signal_history 갱신 3회 이상, 에러 0

---

## Stage 3: 자동화 + 안정성

**목적:** 무인 24시간 운영 가능.

### 3-1. master-daemon 24시간 가동

**현재 문제:**
- master-daemon.mjs를 한 번도 실행 안 함
- 메모리 누수, DB 연결 풀 고갈, unhandled rejection 등 장시간 문제 미확인

**수정 방향:**

1. pm2로 등록:
```bash
pm2 start scripts/master-daemon.mjs --name lattice-daemon --interpreter node --node-args="--import tsx"
pm2 save
```

2. 24시간 모니터링:
   - pm2 monit으로 메모리 확인 (500MB 이상이면 문제)
   - 로그에 에러 패턴 확인
   - 각 scheduled task가 예정대로 실행되었는지 daemon-state.json 확인

3. 문제 발견 시 수정:
   - DB pool exhaustion → pool.max 조정 + idle timeout 설정
   - Memory leak → 대형 배열 참조 해제 확인
   - Unhandled rejection → process.on('unhandledRejection') 핸들러

**수정 파일:**
- `scripts/master-daemon.mjs` — 안정성 개선 (pool 관리, 메모리 감시)
- `ecosystem.config.cjs` — **신규** (pm2 설정)

**A 기준:** 24시간 무중단, 메모리 < 500MB, 에러 < 5건/일

### 3-2. dashboard API 자동 복구

**현재 문제:**
- API 서버가 죽으면 수동으로 재시작해야 함

**수정 방향:**

master-daemon의 15분 태스크에 health check 추가:

```typescript
async function healthCheckDashboardApi() {
  try {
    const resp = await fetch('http://localhost:46200/api/sensitivity', { signal: AbortSignal.timeout(5000) });
    if (!resp.ok) throw new Error('unhealthy');
  } catch {
    // 재시작
    execSync('node --import tsx scripts/event-dashboard-api.mjs &', { stdio: 'ignore' });
    log('Dashboard API restarted');
  }
}
```

**수정 파일:**
- `scripts/master-daemon.mjs` — health check 태스크 추가

**A 기준:** API 다운 후 15분 이내 자동 복구

### 3-3. 에러 복구 검증

**현재 문제:**
- DB 연결 끊김, Ollama 다운, Yahoo 타임아웃 시 동작 미확인

**수정 방향:**

각 실패 시나리오를 수동으로 유발하고 복구 확인:

1. NAS PostgreSQL 연결 끊기 → 파이프라인이 크래시 없이 에러 로그만 남기는지
2. Ollama 중지 → article-ingestor가 임베딩 스킵하고 계속 진행하는지
3. Yahoo API 타임아웃 → proposal-executor가 해당 종목만 스킵하는지

**수정 파일:**
- 필요시 각 모듈의 catch 블록 강화

**A 기준:** 3가지 실패 시나리오에서 전체 파이프라인 중단 없음

---

## Stage 4: 품질 보증 + UI 완성

**목적:** 프로덕션 수준 품질.

### 4-1. 테스트

**현재 문제:**
- 다른 에이전트가 14개 테스트를 추가했지만, 우리가 만든 핵심 모듈은 테스트 0개

**수정 방향:**

4개 핵심 모듈에 각 5개 이상 테스트:

```
tests/article-ingestor.test.mjs
  - 정상 기사 인제스트
  - 중복 기사 스킵
  - Ollama 다운 시 임베딩 스킵
  - pending_outcomes 생성 확인
  - checkPendingOutcomes 처리

tests/signal-history-updater.test.mjs
  - VIX 값 push
  - GDELT stress 계산 + push
  - 중복 ON CONFLICT 처리
  - 알 수 없는 symbol 무시
  - getLatestSignals 반환

tests/proposal-executor.test.mjs
  - add-symbol 정상 처리
  - hit rate 미달 시 자동 제거
  - add-rss RSS 파싱
  - add-theme 키워드 매칭
  - DB 없을 때 graceful 실패

tests/auto-pipeline.test.mjs
  - Step 1 기사 분류
  - Step 2 종목 매핑
  - Step 3 outcome 생성
  - Step 5 sensitivity 갱신
  - 빈 데이터 시 크래시 없음
```

**A 기준:** 20개 테스트, 전부 통과, CI에서 자동 실행

### 4-2. CI 강화

**현재 문제:**
- 다른 에이전트가 2개 workflow 추가했지만, typecheck + 우리 테스트는 미포함

**수정 방향:**

`.github/workflows/test.yml`:
```yaml
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
      - run: npm ci
      - run: npx tsc --noEmit
      - run: npm test
```

**A 기준:** PR 시 typecheck + 테스트 자동 실행, 실패 시 merge 차단

### 4-3. UI 완성

**현재 문제:**
- Event Intelligence 패널이 실제로 보이는지 미확인
- 빈 칸이 많을 수 있음

**수정 방향:**

1. 모든 API 엔드포인트에 **fallback 데이터** 추가:
   - /api/today → 최근 7일 기사로 fallback (24시간 내 없으면)
   - /api/live-status → signal_history 최신값이 없으면 "수집 대기" 표시
   - /api/heatmap → 빈 셀은 회색으로 표시 (숨기지 않음)

2. 패널 레이아웃 개선:
   - 섹션별 로딩 상태 표시 (스켈레톤)
   - 에러 시 "API 연결 대기" + 마지막 성공 데이터 캐시 표시
   - 자동 갱신 카운트다운 표시

**수정 파일:**
- `scripts/event-dashboard-api.mjs` — fallback 로직
- `src/components/EventIntelligencePanel.ts` — 로딩/에러 UX
- `event-dashboard.html` — 독립 대시보드도 동일 처리

**A 기준:** 앱에서 패널이 항상 무언가를 보여줌. "빈 화면" 없음.

### 4-4. 분석 결과 재검증

**현재 문제:**
- 8.1k 분류 기반 집계 → 60k 전체 분류 후 수치가 변할 수 있음
- 노이즈 매핑 제거 후 민감도 매트릭스가 달라짐

**수정 방향:**

Stage 2 완료 후:
1. `scripts/event-engine-full-build.mjs` 재실행
2. `scripts/event-analysis-ml-upgrade.mjs build` 재실행
3. 이전 결과와 비교 (sensitivity, regime, whatif)
4. 변화가 크면 data/에 변경 리포트 저장

**A 기준:** 60k 기반 집계, 노이즈 제거 완료, 결과가 설명 가능

### 4-5. 문서화

**현재 문제:**
- CLAUDE.md (프로젝트 개요) 있지만, 사용자 가이드 없음
- "이 시스템을 어떻게 쓰는가"가 불명확

**수정 방향:**

`docs/USER_GUIDE.md`:
```markdown
# 사용 가이드

## 앱 시작
npm run dev

## 분석 패널
Event Intelligence 패널에서 한눈에:
- 오늘의 주요 이벤트 + 과거 반응
- 종목별 민감도 히트맵
- 테마 온도 (HOT/WARM/COOL)
- Best 전략 (Sharpe 순)

## CLI 조회
node --import tsx scripts/query-event-impact.mjs stock NVDA
node --import tsx scripts/query-event-impact.mjs event "semiconductor"

## 자동화
node --import tsx scripts/master-daemon.mjs --auto
```

`docs/ARCHITECTURE.md` 업데이트:
```markdown
# 아키텍처

기존 앱 (40개 소스) → data-loader hook → 분석 엔진
  ├─ signal-history-updater → signal_history
  ├─ article-ingestor → articles + pending_outcomes
  └─ EventIntelligencePanel → /api/event-intel → dashboard API

자동화:
  master-daemon → 15분/1시간/6시간/매일
  Codex/Ollama → 패턴 발견 → Executor → 검증
```

**A 기준:** 새 개발자가 README만 읽고 10분 안에 앱 띄우고 패널 확인 가능

---

## 수정 대상 파일 종합

| Stage | 파일 | 작업 |
|-------|------|------|
| 1 | `package.json` | dev 스크립트에 API 서버 동시 실행 |
| 1 | `scripts/verify-e2e.mjs` | **신규** — end-to-end 검증 |
| 2 | `scripts/fast-keyword-extractor.mjs` | **신규** — 정규식 키워드 추출 |
| 2 | `scripts/auto-pipeline.mjs` | Step 2 노이즈 필터 강화 |
| 3 | `scripts/master-daemon.mjs` | 안정성 + health check + 에러 복구 |
| 3 | `ecosystem.config.cjs` | **신규** — pm2 설정 |
| 4 | `tests/article-ingestor.test.mjs` | **신규** — 5개 테스트 |
| 4 | `tests/signal-history-updater.test.mjs` | **신규** — 5개 테스트 |
| 4 | `tests/proposal-executor.test.mjs` | **신규** — 5개 테스트 |
| 4 | `tests/auto-pipeline.test.mjs` | **신규** — 5개 테스트 |
| 4 | `.github/workflows/test.yml` | **신규** 또는 기존 수정 |
| 4 | `scripts/event-dashboard-api.mjs` | fallback 로직 |
| 4 | `src/components/EventIntelligencePanel.ts` | 로딩/에러 UX |
| 4 | `docs/USER_GUIDE.md` | **신규** |
| 4 | `docs/ARCHITECTURE.md` | 업데이트 |

**신규 8개 + 수정 7개 = 15개 파일**

---

## 검증 체크리스트

### Stage 1 완료 조건
- [ ] `npm run dev` → Event Intelligence 패널 표시
- [ ] 패널에 히트맵/온도/이벤트/전략 데이터 있음
- [ ] `verify-e2e.mjs` 전 단계 PASS
- [ ] pending_outcomes에서 completed로 이동 확인

### Stage 2 완료 조건
- [ ] article_analysis 5,000건 이상
- [ ] auto_article_themes 55,000건 이상 (90%+)
- [ ] auto_theme_symbols에서 BDRY/^VIX 제외, 직관적 매핑
- [ ] Codex 3회 순환, 제안 수렴
- [ ] 1시간 연속 실행 에러 0

### Stage 3 완료 조건
- [ ] master-daemon 24시간 무중단
- [ ] master-pipeline 10회 연속 성공
- [ ] API 다운 → 15분 내 자동 복구
- [ ] DB 끊김/Ollama 다운 시 크래시 없음

### Stage 4 완료 조건
- [ ] 20개 테스트 전부 통과
- [ ] CI에서 typecheck + test 자동 실행
- [ ] 패널에 빈 칸 없음
- [ ] 60k 기반 분석 결과 재검증 완료
- [ ] USER_GUIDE.md로 10분 내 온보딩 가능
