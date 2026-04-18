# CLAUDE.md

## 프로젝트 개요

Lattice는 뉴스 이벤트-종목 반응 분석 플랫폼. 40개 실시간 소스에서 뉴스/시장 데이터를 수집하고, 이벤트별 종목 반응을 분석하여 사용자에게 보여줌.

## 핵심 구성

- NAS PostgreSQL: 192.168.0.2:5433, DB: lattice
- Ollama: localhost:11434 (nomic-embed-text, gemma3:4b)
- 환경변수: `.env.local`에 PG_PASSWORD, OLLAMA_API_URL 등
- 환경 로드: `export $(grep -v '^#' .env.local | xargs)`

## 주요 스크립트

| 스크립트 | 용도 |
|---------|------|
| `scripts/master-pipeline.mjs` | 전체 파이프라인 통합 실행 |
| `scripts/auto-pipeline.mjs` | 기사 분류→종목 매핑→outcome→분석 갱신 |
| `scripts/proposal-executor.mjs` | 제안 자동 수집/검증 |
| `scripts/query-event-impact.mjs` | 이벤트-종목 반응 조회 |
| `scripts/event-dashboard-api.mjs` | 대시보드 API 서버 |
| `scripts/event-engine-full-build.mjs` | regime/hawkes/whatif 구축 |
| `scripts/tech-trend-tracker.mjs` | 기술 트렌드 추적 |
| `scripts/codex-from-analysis.mjs` | 분석→Claude API로 테마/종목 제안 생성 |
| `scripts/incremental-event-engine.mjs` | 증분 이벤트 엔진 (클러스터링+alpha+controls 한번에) |
| `scripts/incremental_event_engine.py` | 위의 Python 버전 (Python 우선, JS fallback) |
| `scripts/build-market-returns.py` | 독립 market_returns 테이블 빌드 (SPY+섹터 ETF) |
| `scripts/meta-model-server.py` | FastAPI GPU 추론 서버 (port 8100) |
| `scripts/train-meta-model.py` | Multi-Task 메타모델 학습 (PyTorch) |
| `scripts/compare-models.py` | MLP vs LightGBM vs Logistic 비교 |
| `scripts/_shared/pipeline-lock.mjs` | 파이프라인 동시성 제어 (PID 기반 file lock) |
| `scripts/_shared/calibration-diagnostic.mjs` | 메타모델 calibration + drift 알림 |
| `scripts/_shared/alert-notifier.mjs` | data/alerts.json 구조화된 알림 기록 |
| `scripts/refresh-market-quotes-to-nas.mjs` | Yahoo 스냅샷 → market_quotes (15분 cron, SoT JSON 기반 심볼) |
| `scripts/bootstrap-market-quotes-history.mjs` | market_quotes 180d 히스토리 백필 (warm store + Yahoo) |
| `scripts/train-rates-nowcast.py` / `train-commodity-fx-nowcast.py` | Nowcast 학습 (acceptance gate 강제) |
| `scripts/compute-rates-nowcast.py` (+`.mjs` wrapper) / `compute-composite-nowcasts.mjs` / `compute-event-intensity-nowcast.mjs` | Nowcast 추론 writer (source gate + coverage audit + INSERT) |
| `scripts/reconcile-nowcasts.mjs` | 예측↔실측 페어링 + calibration drift |
| `scripts/promote-nowcast-model.mjs` | candidate → shadow → active 수동 승격 |
| `scripts/_shared/market-quote-symbols.json` (+ `.mjs`) | 심볼 SoT — refresh / bootstrap / trainer 공용 |
| `scripts/_shared/market-quote-coverage.mjs` / `market_quote_coverage.py` | 180d 커버리지 감사 (학습/추론 선-차단) |
| `scripts/_shared/nowcast-source-gate.mjs` / `nowcast_source_gate.py` | source eligibility 게이트 (INSERT 전) |
| `scripts/_shared/nowcast_acceptance_gate.py` | 학습 후 MAE/cov90/N 게이트 (fail 시 .pkl 저장 거부) |

## NAS 테이블 구조

| 테이블 | 용도 |
|--------|------|
| `articles` | 67k+ 기사 (Guardian/NYT/40+ 소스, 임베딩 포함) |
| `labeled_outcomes` | 619k 기사→종목 수익률 레이블 (market_return, abnormal_return 포함) |
| `market_returns` | SPY + 섹터 ETF 일별 수익률 (date-based join용, 신규) |
| `stock_sensitivity_matrix` | 테마×종목 민감도 |
| `auto_theme_symbols` | 자동 감지된 테마-종목 매핑 |
| `auto_article_themes` | 자동 분류된 기사 테마 |
| `regime_conditional_impact` | VIX 기반 시장 상태별 반응 |
| `event_hawkes_intensity` | 테마별 이슈 온도 |
| `whatif_simulations` | What-if 시뮬레이션 결과 |
| `conditional_sensitivity` | 7종류 조건부 민감도 |
| `event_anomalies` | 비정상 반응 |
| `signal_history` | 12채널 시계열 시그널 |
| `codex_proposals` | 제안 + 실행 상태 추적 |
| `pending_outcomes` | 새 기사 → 2주 후 확인 대기 |
| `canonical_events` | 기사→이벤트 클러스터 (53k) |
| `article_event_map` | 기사-이벤트 매핑 |
| `event_features` | 이벤트별 17+ 피처 (meta-model 입력) |
| `event_uplift` | 대조군 대비 uplift + evidence grade (E0~E4) |
| `matched_controls` | 이벤트-비이벤트 날짜 매칭 |
| `model_predictions` | meta-model 예측 결과 |
| `model_eval` | 모델 검증 결과 (Brier, ECE 등) |
| `market_quotes` | Yahoo 스냅샷/히스토리 저장 (`fetched_at` PK, `observed_at` 시계열) |
| `estimated_signal_nowcasts` | Nowcast 예측 결과 (signal_name + target_ts + model_version) |
| `nowcast_reconciliation` | 예측↔FRED 실측 페어링 (calibration drift 측정) |
| `nowcast_training_snapshots` | 학습 스냅샷 (feature_hash + eval_summary 보존) |
| `nowcast_source_eligibility` | target_signal × source_signal 게이트 룰 (max_lag, regime_mask 등) |
| `model_registry` | 모델 프로모션 상태 (candidate/shadow/active/deprecated) |

## 코드 수정 원칙

1. TypeScript 에러 없이 수정 완료 (`npx tsc --noEmit`)
2. `noUncheckedIndexedAccess: true` — 배열 접근 시 `?? 0` 또는 `!` 사용
3. 요청된 변경사항만 수정 — 불필요한 리팩토링 금지
4. 환경변수 하드코딩 금지 — .env.local에서 로드
5. 기존 데이터 삭제 금지 — 증분(incremental) 방식으로 새 데이터만 추가/병합. DELETE 후 재생성하지 않음
6. Python 계산 스크립트는 결과를 NAS에 저장하고, TS는 읽어서 표시하는 구조 유지
7. silent catch 금지 — try/catch에서 에러를 삼키지 말고 최소한 console.warn에 메시지+컨텍스트 포함
8. 동시성 주의 — 파일/DB에 쓰는 스크립트는 `_shared/pipeline-lock.mjs`의 `withLock()`으로 래핑
9. Nowcast acceptance gate는 강제 — trainer가 MAE/cov90/N 기준 실패 시 `.pkl` 저장 거부 (exit 3). `--validate` 플래그로 판정만 확인하고 저장은 건너뜀
10. Shadow/active fuse filter — `event-dashboard-api.mjs`의 `loadLatestNowcastsForSignals`는 `model_registry.promotion_state IN ('shadow','active')`만 대시보드에 노출. candidate/미등록 모델은 reconciliation만 돌고 UI 차단
11. 심볼 SoT — `_shared/market-quote-symbols.json`이 유일한 진실. refresh/bootstrap/trainer가 이 JSON에서 읽어야 함. 하드코드 심볼 리스트 금지
12. 대용량(>5000 rows) migration/backfill은 per-row UPDATE 금지 — `UNNEST($1::bigint[], $2::..., ...)` 기반 벌크 UPDATE로 작성. 참고: `scripts/migrations/backfill-article-source-metadata.mjs` (벌크 패턴 예시)
13. 새 외부 데이터 스토어는 bootstrap-first — 자연 누적에 의존하지 말고 `bootstrap-*-history.mjs` 식 초기 백필 스크립트를 함께 준비 (warm store 재사용 1순위, API fetch 2순위)

## 커밋 규칙

큰 카테고리의 작업을 완료하면 반드시 커밋한다. 커밋 단위 예시:
- 새 파이프라인 단계 추가 완료 시
- 모델 학습/검증 완료 시
- UI 변경 완료 시
- 파이프라인 연결/통합 완료 시
- 버그 수정 완료 시
- Python 전환 완료 시

커밋하지 않고 다음 큰 작업으로 넘어가지 않는다. 커밋 메시지는 변경 내용을 구체적으로 서술한다.

## 병렬 구현 에이전트 규칙

구현 작업을 여러 에이전트가 병렬로 진행할 때:

### 파일 충돌 방지
- 에이전트마다 담당 파일이 다름. 같은 파일을 동시에 수정하지 않음.
- 공유 파일(types.ts, historical-intelligence.ts)은 한 에이전트만 수정.
- 새 파일 생성은 자유. 기존 파일 수정은 담당자만.

### 통신
- 다른 에이전트의 결과가 필요하면 파일이 생성될 때까지 대기하지 말고, 인터페이스(타입/함수 시그니처)만 미리 합의하고 각자 구현.
- typecheck는 전체 합친 후 한 번만.

### 작업 분배 기준
- 서로 import 관계가 없는 파일은 병렬 가능
- import 관계가 있으면 인터페이스 먼저 정의 → 각자 구현
