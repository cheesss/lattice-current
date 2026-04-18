# Nowcast Plan — 발견된 문제 정리

> **Status**: superseded by [NOWCAST_HANDOFF_2026-04-18.md](./NOWCAST_HANDOFF_2026-04-18.md). All P1 issues listed below are resolved in the handoff's §3 commit map and §6 gap table. Kept for historical context.

Date: 2026-04-17 KST
Scope: 원 문서 검토 + repo 실상 조사 + gap-fill 설계 + 뉴스 소스 다양성 검토에서 드러난 모든 문제

## 1. Executive Summary

원 Nowcast 문서는 "observed vs estimated 경계"에 대한 semantic contract을 잘 설계했지만, 실행 관점에서 다음 4개 영역이 부족함:

1. 원안의 Phase별 작업 범위·마이그레이션 비용이 추상적
2. repo 실상: signal_history가 이미 observed/derived 혼합 상태 (문서가 전제 못 함)
3. 진짜 가치인 Tier 2 cross-source gap-fill의 구체 설계 없음
4. 뉴스 소스 구성이 "이벤트-종목 반응 분석" 플랫폼 목적에 비해 크게 왜곡됨

이 문서는 그 문제들을 한 곳에 정리한다. 해결 계획은 후속 문서로 분리한다.

## 2. 원 문서의 미해결 영역

### 2.1 Phase 0 범위 과소 산정

원안: `valueOrigin`, `estimateConfidence`, `validAsOf`, `derivedFromSources` 4필드를 "모델 만들기 전에" 추가.

미해결:
- event-dashboard-api.mjs의 어느 엔드포인트까지 덮을지 미명시
- 실제로는 `withMeta()` 호출이 13곳에 집중되어 단일 패치점으로 해결 가능한데 문서는 엔드포인트 50+ 전수 작업처럼 읽힘

### 2.2 signal_history 마이그레이션 전략 불명

원안 §7.3은 "transitional"로 넘어감. 구체적으론 다음 둘 중 결정 필요한데 문서가 결정 미룸:
- 옵션 A: 새 테이블 `observed_signal_history` 생성
- 옵션 B: `signal_history`에 `value_origin` 컬럼만 추가

실제 영향 범위 (조사 결과):
- signal_history WRITE: 10개 INSERT site, 7개 파일
- signal_history READ: 31개 SELECT site, 12개 파일

### 2.3 Source gate 구현 비용 미산정

원안 §9.1의 per-target 정책은 사실상 메타 테이블 1개가 더 필요한데 원안 로드맵에 해당 테이블/API가 없음.

### 2.4 Reconciliation trigger 불명

원안 §11.4는 "observed value가 도착하면 reconcile"만 명시. 실행 주체 (cron / DB trigger / API-pull) 결정 미룸.

### 2.5 OpenClaw 문서와 교차 참조 없음

OpenClaw 통합 문서도 "Lattice가 source of truth" 주장. 원 nowcast §5.4도 같은 주장. 두 문서가 서로 참조 안 함.

## 3. repo 실상 조사로 드러난 구조적 문제

### 3.1 signal_history 스키마가 3컬럼뿐

`(signal_name, ts, value)`, PK=(signal_name, ts). `value_mode`, `is_mirrored`, `value_origin` 컬럼 **없음**. 원 문서 §7.2의 `observed_signal_history` 컬럼 셋은 사실상 "신설 전제"였음.

### 3.2 marketStress 3 writer 경쟁 상태

| Writer | 경로 | 공식 |
|---|---|---|
| `master-pipeline.mjs` L85 | GDELT goldstein → `(-goldstein+5)/10` | GDELT proxy |
| `refresh-fred-signals-to-nas.mjs` L188 | VIX+HY+yieldSpread 합성 | FRED composite |

셋 다 `ON CONFLICT (signal_name, ts) DO UPDATE SET value=EXCLUDED.value`. 마지막 실행자가 이김. 결과값 비결정적, 어느 것도 observed 아님.

### 3.3 transmissionStrength 2 writer

- master-pipeline STEP 0 (GDELT tone 절댓값 proxy)
- `refresh-event-market-transmission.mjs` (news-market transmission 계산)

### 3.4 eventIntensity, gpr도 GDELT proxy로 signal_history 직접 쓰기

master-pipeline STEP 0이 `eventIntensity` (GDELT 이벤트 수), `gpr` (기사 키워드 카운트) 둘 다 signal_history에 derived로 INSERT.

결과: signal_history에 **최소 4개 derived signal이 observed 옆에 섞여 있음** (marketStress, transmissionStrength, eventIntensity, gpr). 원 문서 §7.1 "observed 행에 estimate 섞지 말라" 원칙 이미 위배.

### 3.5 inferResponseMode enum이 좁음

런타임 실제 enum: `live | delayed | cache | fallback` 4종만.
원 문서의 `nowcast | imputed | composite | mirrored | replay | backfill` 6종 추가분이 코드에 없음.

### 3.6 기존 classifySignalQuality는 observed/mirrored/stale만

derived signal(composite, proxy)을 별도 상태로 구분 안 함. 4개 derived가 모두 `observed`로 오분류되는 상태.

## 4. Gap-fill 설계에서 누락된 것

### 4.1 Tier 2 cross-source가 원안에 구체 타겟 없음

원 §8.1은 "direct target observations 부족 시 다른 소스 사용" 수준의 원칙만 명시. 구체적으로 어느 signal이 어느 proxy로 nowcast되는지 없음.

### 4.2 실제 갭이 있는 신호들 (repo 기준)

| Signal | 현재 cadence | 실제 지연 | Live proxy 후보 |
|---|---|---|---|
| hy_credit_spread | FRED T+1 | 1 영업일 | HYG ETF, VIX |
| treasury10y (DGS10) | FRED T+1 | 1 영업일 | ^TNX |
| yieldSpread (T10Y2Y) | FRED T+1 | 1 영업일 | ^TNX + 단기금리, TLT |
| ig_credit_spread | FRED T+1 | 1 영업일 | LQD, 국채금리 |
| oilPrice (CL=F) | Yahoo daily | 1-5일 + 주말 | XLE, USO, XOM/CVX |
| dollarIndex | Yahoo | 주말 공백 | ICE DXY + FX cross |

`SIGNAL_STALE_THRESHOLD_HOURS.oilPrice = 120` (5일)이 현재 운영 현실이 "Oil 5일 지연을 당연시한다"는 증거.

### 4.3 marketStress를 먼저 nowcast하면 안 되는 이유

marketStress = f(VIX, HY, yieldSpread). 입력 (HY, yieldSpread)이 T+1 지연이면 marketStress도 T+1 지연. **입력 signal을 먼저 nowcast해야 composite도 live가 됨.**

원안이 Tier 3 composite을 먼저 보여준 예시 탓에 순서가 꼬임.

### 4.4 Vintage-aware training 데이터 이미 존재하는데 활용 안 함

- `fred_observations.fetched_at` 컬럼 존재 → FRED 값이 실제 언제 배포됐는지 알 수 있음
- 이 컬럼을 쓰면 true vintage-aware training 가능
- 원 문서는 "vintage-aware 해야 한다"만 명시, 구체 구현 없음

### 4.5 revision risk 과대평가 우려

원 §10.2 "forbidden training shortcuts"는 일반론. repo가 쓰는 FRED 시리즈 (T10Y2Y, DGS10, BAMLH0A0HYM2, BAMLC0A0CM)는 **revision이 거의 없는 시리즈들** (국채 거래값 / Merrill OAS 계산값). 이 케이스엔 leak 우려 낮은데 문서는 이걸 구분하지 않음.

### 4.6 장중/장마감/주말 3단계 신뢰도 언급 없음

같은 nowcast도 시각에 따라 정보량 다름:
- 장중 (09:30–16:00 ET): ETF live + 선물 live → confidence ≥ 0.8
- 장마감 후 ~다음날 오전: pre-market + 야간 선물 → confidence 0.6–0.7
- 주말/휴일: 일요일 저녁 선물만 → confidence 0.4–0.5 또는 abstain

이걸 interval width에 반영 안 하면 UX가 부정확.

## 5. 뉴스 소스 구성 문제

### 5.1 카테고리 극단적 왜곡

RSS 421 feeds 중:

| 카테고리 | feeds | 비고 |
|---|---:|---|
| europe | 49 | 최다 |
| regionalStartups | 35 | |
| inspiring | 34 | 금융 무관 |
| thinktanks | 27 | |
| asia | 22 | |
| latam | 19 | |
| podcasts | 14 | |
| ai | 12 | |
| africa | 13 | |
| finance | 9 | 금융 직결 소수 |
| tech | 9 | |
| markets | 4 | |
| commodities | 4 | |
| bonds | 3 | |
| fintech | 3 | |
| centralbanks | 5 | |

금융 직결(finance+bonds+commodities+markets+centralbanks+energy+forex+derivatives+ipo+regulation+economic+institutional) = **~52 feeds (12%)**. 나머지 88%가 general/regional/tech/inspiring/startup.

"이벤트-종목 반응 분석" 플랫폼 목적에 비해 심각한 왜곡.

### 5.2 다국어 중복 inflation

같은 publisher가 여러 feed로 카운트:
- EuroNews: en/fr/de/it/es/pt/ru = 7 feeds
- France24: en/fr/es/ar = 4 feeds
- DW: en/de/(es empty) = 2–3 feeds
- Le Monde: en/fr = 2 feeds

유럽 49개 중 ~20개가 이런 중복. **고유 publisher 기준 30~35% 축소 필요.**

### 5.3 Wire 신디케이션 증폭

- AP News / Reuters / Bloomberg 원본 하나가 BBC, Guardian, CNBC, MarketWatch에 재게재
- 같은 사건이 기사 5-10개로 inflation
- 현재 wire 원본 식별 필드 없음 (`articles.wire_source` 컬럼 없음)

### 5.4 죽은 feed 누적, 자동 제거 안 됨

- CNN World: 2023-09-18 마지막 = **2년 이상 stale**, 아직 allowed 목록에 있음
- DEAD 16, EMPTY 22 → 9%가 사실상 무효
- self-heal-sources가 probe만 하고 카테고리 재분배/제거는 안 함

### 5.5 집중도 지표 없음

```
grep "source_concentration|dominant_source|HHI" → 0 files
```

현재 `canonical_events.source_diversity = unique_sources / articles`만 있음.

문제:
- 5개 소스가 95% 차지해도 source_count=5면 diversity 높다고 판정
- Reuters 기사 1개가 BBC/Guardian/CNBC에 재게재된 canonical_event → articles 4, sources 4 → diversity=1.0 (만점)
- **실제론 wire 1 source인데 diversity 만점으로 오판**

### 5.6 시간대 coverage gap

- Asian 22 feeds 중 한/일/중 native 거의 없음 (주로 영문 Asian 뉴스)
- Asian trading session (NY 저녁) 기사 자연 감소
- "저녁 조용함" vs "feed coverage gap" 구분 불가
- 일본 3am ET 금융위기 → US/EU 기사 아직 반응 없음 → eventIntensity "낮음" → 대시보드 "조용" → **실제로 시장 움직였는데 platform 미반응**

### 5.7 Paywall/소셜 미디어 공백

- WSJ, Bloomberg Terminal 등 paywall source 추적 불가
- Twitter/X API 유료화 후 제외 → 실시간 market sentiment 공백
- 이 공백이 eventIntensity의 지연 원인 중 하나

### 5.8 labeled_outcomes의 survivorship bias

- 619k rows 중 abnormal_return 28% 커버
- 기사→종목 매핑 존재할 때만 레이블링
- **조용한 기사 (시장 영향 작음)가 레이블 못 받을 수 있음** → 모델이 "이벤트=무조건 움직임"으로 과잉확신 학습 가능

## 6. Cross-cutting: Nowcast plan에 주는 영향

### 6.1 Phase 2e (eventIntensity nowcast) 원래대로 불가

eventIntensity = 최근 24h 기사 수 기반인데 기사 수가 soft news (inspiring/regional/startup) 잡음에 지배됨.

### 6.2 Phase 4 regime detector 오작동 위험

"VIX 급등 + news volume spike → shock regime" 로직에서 news volume = 모든 feed 합계 → EuroNews 7언어 동시 spike = 실제 1 기사를 7배로 카운트. 실제 shock 감지 실패 또는 오판.

### 6.3 Phase 0.5의 value_origin이 articles에도 필요

signal_history만 다루면 부족. articles 테이블에도:
- `wire_source`
- `publisher_group`
- `market_relevance`

이 없으면 eventIntensity/regime이 soft news에 오염 지속.

## 7. 영향도 매트릭스

| # | 문제 | 심각도 | Nowcast 실행에 대한 영향 |
|---|---|---|---|
| 3.2 | marketStress 3 writer 경쟁 | HIGH | 이미 발생. Phase 1 전 필수 정리 |
| 3.3 | transmissionStrength 2 writer | MEDIUM | 정본 선정 필요 |
| 3.4 | 4개 derived가 signal_history 오염 | HIGH | Phase 0.5 (writer_id tagging) 선행 필요 |
| 4.3 | marketStress 먼저 nowcast 시 효과 없음 | MEDIUM | Phase 2 순서 재편 필요 (HY/Treasury 먼저) |
| 4.4 | vintage-aware training 구현 없음 | HIGH | 학습 기반 전체 오류 위험 |
| 5.1 | 소스 카테고리 왜곡 | HIGH | Phase 2e, Phase 4가 의미 없어짐 |
| 5.3 | wire 신디케이션 증폭 | HIGH | eventIntensity/HHI 신뢰도 붕괴 |
| 5.5 | HHI/집중도 지표 없음 | MEDIUM | canonical_events의 diversity 잘못 계산 |
| 5.6 | Asian timezone coverage | MEDIUM | regime 탐지 false-negative |
| 5.8 | labeled_outcomes survivorship bias | MEDIUM | 모델 과잉확신 학습 |
| 2.1 | Phase 0 범위 불명 | LOW | 조사 결과 단일 패치점 (withMeta) |
| 2.2 | signal_history 마이그 전략 | LOW | 옵션 B + writer_id 태깅으로 결정 가능 |
| 2.3 | source gate 비용 | LOW | Phase 4 스키마 확장으로 해결 가능 |
| 2.4 | reconcile trigger | LOW | master-daemon cron으로 해결 가능 |
| 2.5 | OpenClaw 교차 참조 | LOW | 문서 수정만 |

## 8. 해결 우선순위 (심각도 기준)

### Phase 0: Semantic contract (기존 원안)

### Phase 0.5: signal_history writer_id 태깅 + 정본 선정
- 3.2, 3.3, 3.4 해결
- marketStress/transmissionStrength/eventIntensity/gpr의 value_origin 명시
- 삭제 없이 writer_id로 격하

### Phase 0.6 (신규): Source Hygiene
- 5.1, 5.2, 5.3, 5.4, 5.5 해결
- articles에 wire_source/publisher_group/market_relevance 추가
- 죽은 feed 자동 제거
- canonical_events.source_diversity publisher_group 기준 재계산
- HHI 지표 도입

### Phase 1: Storage split + vintage snapshot
- 2.2, 4.4 해결
- fred_observations.fetched_at 활용한 vintage-safe training 기반

### Phase 2a-d: Tier 2 gap-fill (HY → Treasury → yieldSpread → IG → Oil → Dollar → marketStress 재계산)
- 4.1, 4.2, 4.3, 4.6 해결
- 입력부터 nowcast, composite은 자동 파생

### Phase 2e: Clean eventIntensity
- 5.6, 6.1, 6.2 완화
- high/medium market_relevance만 사용, wire 중복 제거, 시간대 normalize

### Phase 3-5: UI + source gate + registry (원안)
- 2.3, 2.4 해결

### 해결 지연 항목
- 5.7 Paywall/Twitter: 사업적 결정 (유료 API 도입)
- 5.8 Survivorship bias: 별도 모델 평가 트랙

## 9. 외부 참조

- [NOWCAST_ESTIMATION_ARCHITECTURE_PLAN_2026-04-17.md](./NOWCAST_ESTIMATION_ARCHITECTURE_PLAN_2026-04-17.md) — 원 설계안
- [LIVE_BACKFILL_DATA_BOUNDARY_PLAN_2026-04-16.md](./LIVE_BACKFILL_DATA_BOUNDARY_PLAN_2026-04-16.md) — mode/staleness contract 기반
- [OPENCLAW_INTEGRATION_ARCHITECTURE_2026-04-16.md](./OPENCLAW_INTEGRATION_ARCHITECTURE_2026-04-16.md) — "Lattice as source of truth" 원칙 공유
- 관련 repo 파일:
  - `scripts/event-dashboard-api.mjs` — withMeta, deriveResponseMeta, classifySignalQuality, buildSignalSummary
  - `scripts/refresh-fred-signals-to-nas.mjs` — marketStress/FRED writer
  - `scripts/refresh-event-market-transmission.mjs` — transmissionStrength writer
  - `scripts/master-pipeline.mjs` — STEP 0 GDELT derived writers
  - `scripts/master-daemon.mjs` — TASKS 레지스트리
  - `shared/rss-allowed-domains.json` — 293개 도메인
  - `scripts/rss-feeds-report.csv` — 421 feeds 상태

## 10. 다음 문서

이 문서는 문제 정리만 담는다. 실행 계획은 별도로:
- `NOWCAST_IMPLEMENTATION_PLAN_2026-04-17.md` (예정) — Phase별 구체 작업 목록, 테스트 매트릭스, 타임라인
