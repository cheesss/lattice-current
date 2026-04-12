# Lattice Current — 세션 핸드오프 문서

## 1. 프로젝트 정체성

Lattice Current는 **뉴스 이벤트 → 자산 반응 분석 플랫폼**이다. 40개+ 실시간 뉴스 소스에서 기사를 수집하고, 각 이벤트가 어떤 종목에 어떤 영향을 미치는지 데이터로 분석하여 의사결정을 지원한다.

- **이름**: lattice-current (v2.5.25, AGPL-3.0)
- **코드베이스**: TypeScript 699개 + JavaScript 186개 + Python 7개 + 테스트 154개 = 약 1,090개 파일
- **데이터**: NAS PostgreSQL (192.168.0.76:5433, DB: lattice) — 66,802 기사, 619,495 labeled_outcomes
- **AI**: Ollama 로컬 (nomic-embed-text, gemma3:4b), ONNX Runtime, PyTorch
- **데스크톱**: Tauri (Rust), **웹**: Vite + React 18, **PWA**: 오프라인 지원
- **변형 빌드**: full(지정학/분쟁), tech(AI/사이버), finance(마켓/매크로)

---

## 2. 설계 철학

### 핵심 파이프라인

```
데이터 수집 → 이벤트 분류 → 종목 매핑 → 반응 측정 → 패턴 학습 → 의사결정 지원
```

### 3개 층 구조

```
층 1 — 규칙/통계 (기존, 60개 수식)
  Hawkes process, HMM regime, Kalman filter, Transfer entropy,
  Truth discovery, Graph inference, Contextual bandit, RMT,
  Conviction scoring, FPR scoring, Macro risk overlay, Kelly sizing

층 2 — 학습 메타모델 (이번 세션에서 추가)
  기존 수식들의 출력을 피처로 → multi-task 신경망이 최종 판단
  P(alpha>0), E[alpha], downside risk, time-to-peak 동시 예측

층 3 — 반사실 검증 (이번 세션에서 추가)
  abnormal return (시장 수익률 차감), matched controls (대조군 비교),
  evidence ladder (E0~E4), purged walk-forward 검증
```

### 설계 원칙

1. **수식은 판단이 아니라 피처** — 60개 수식이 직접 점수를 내는 대신, 학습된 모델의 입력으로 사용
2. **raw return이 아니라 alpha** — 시장 전체 상승분을 빼고 순수 초과수익만 측정
3. **기사가 아니라 이벤트** — 같은 사건의 중복 보도를 클러스터링해서 샘플 부풀림 방지
4. **상관이 아니라 반사실** — matched control day 대비 uplift로 인과에 근사
5. **과적합 방지** — purged walk-forward, event group split, inverse-frequency weighting

---

## 3. 주요 기능

### 3-1. 데이터 수집 & 자동 확장

```
40개+ 뉴스 소스 (Guardian, NYT, BBC, Reuters, GDELT, HackerNews, arXiv 등)
  ↓
AI(Codex)가 분석 결과를 보고 새 소스/테마/종목 제안
  codex-from-analysis.mjs → codex_proposals → proposal-executor.mjs
  ↓
검증 후 자동 등록 (예산 제한, 품질 게이트, 승인 큐)
```

### 3-2. 이벤트-자산 반응 분석

```
기사 66,802개 → canonical_events 53,734개 (임베딩 유사도 클러스터링)
  ↓
각 이벤트 × 종목 × 기간(1w/2w/1m)별 수익률 계산
  forward_return_pct (raw), abnormal_return (시장 차감), uplift (대조군 대비)
  ↓
stock_sensitivity_matrix: 테마별 종목 민감도
regime_conditional_impact: VIX 레짐별 반응 차이
conditional_sensitivity: 28개 시그널 조건별 반응
whatif_simulations: 가상 매매 시뮬레이션 (Sharpe, VaR)
event_anomalies: 비정상 반응 탐지 (z-score)
```

### 3-3. 투자 아이디어 생성

```
orchestrator.ts (총괄)
  ├→ idea-generator.ts: 확신도 계산 (base + 12개 보너스 - 5개 감점, 20~98점)
  ├→ conviction-scorer.ts: 온라인 로지스틱 회귀 (실제 결과로 가중치 학습)
  ├→ position-sizer.ts: ATR 기반 포지션 크기
  ├→ portfolio-optimizer.ts: Fractional Kelly + RMT 노이즈 제거
  ├→ event-decision-bridge.ts: meta-model 예측 주입 ← 이번 세션에서 추가
  └→ InvestmentIdeasPanel.ts: 시그널 카드 표시
```

### 3-4. 3개 학습 루프

```
루프 1 — Mapping Performance (베이지안 승률 + EMA 수익률)
  아이디어 종료 시 alpha/beta 업데이트, emaReturnPct 갱신
  → posteriorBonus, returnBonus, sampleBonus로 다음 확신도에 반영

루프 2 — Contextual Bandit (LinUCB)
  컨텍스트 벡터 + 실현 수익 → A 행렬/b 벡터 온라인 업데이트
  → banditBonus로 탐색/활용 균형

루프 3 — Self-Tuning Weight Profile (experiment-registry.ts)
  9개 곱셈 계수 (corroboration, contradiction, recency, reality 등)
  성과 나쁘면 → 방어적 조정, 좋으면 → 공격적 조정
  너무 나빠지면 → 과거 최고 프로필로 롤백
```

### 3-5. 수학 모델 (11개 활성)

| 모델 | 파일 | 역할 |
|------|------|------|
| Hawkes process | math-models/hawkes-process.ts | 이벤트 연쇄 강도 |
| HMM regime | math-models/hmm-regime.ts | 시장 상태 분류 |
| Kalman filter | math-models/kalman-filter.ts | 전파 강도 추적 |
| Transfer entropy | math-models/transfer-entropy.ts | 정보 흐름 방향 |
| Truth discovery | math-models/truth-discovery.ts | 소스 신뢰도 |
| Graph inference | math-models/graph-inference.ts | 지식 그래프 추론 |
| Regime model | math-models/regime-model.ts | 다요인 레짐 점수 |
| Contextual bandit | math-models/contextual-bandit.ts | 종목 선택 학습 |
| RMT correlation | math-models/rmt-correlation.ts | 상관행렬 노이즈 제거 |
| NMI | math-models/normalized-mutual-information.ts | 변수 의존성 측정 |
| Conviction model | investment/conviction-scorer.ts | 온라인 로지스틱 회귀 |

### 3-6. 시각화

- 5개 워크스페이스: Signals, Brief, Watch, Validate, Operate
- 지도: DeckGLMap.ts (6,796줄, deck.gl 25개 레이어 + Supercluster 4개)
- 패널: 96개 컴포넌트 (뉴스, 시장, 군사, 시위, 인프라, 투자, 운영)
- 34개 언어 i18n, PWA 오프라인, Tauri 데스크톱

---

## 4. 이번 세션의 해결 시작점

### 진단된 핵심 문제

> "수식이 부족한 게 아니라, 수식을 최종 판단으로 직접 쓰고 있다"

구체적으로:

1. **raw return 사용** — "conflict → NVDA +21%"인데 시장 전체가 +15% 올랐을 수도 있음
2. **기사 단위 샘플** — 같은 사건 10개 매체 보도 = 10배 부풀림
3. **대조군 없음** — "이 뉴스 후 올랐다"만 알고, 뉴스 없는 날과 비교 안 함
4. **하드코딩 가중치** — `24 + sourceCount×7 + ...`가 최종 점수
5. **시간 정렬 없음** — 장후 기사도 당일 종가를 entry로 사용 (라벨 누수)
6. **검증 부족** — raw Sharpe만 보고 과적합 위험 무시

---

## 5. 수정 지점 & 해결 방식

### Phase 1: 데이터 레이어 재설계

**1-1. Canonical Events (기사 → 이벤트 클러스터링)**
```
수정: scripts/build-canonical-events-fast.mjs (신규)
방식: (날짜, 테마) 그룹 내 embedding cosine similarity > 0.7 → union-find 클러스터링
결과: 62,449 기사 → 53,734 이벤트 (1.2x 압축)
NAS: canonical_events, article_event_map 테이블 신규 생성
```

**1-2. Abnormal Returns (초과수익률)**
```
수정: scripts/compute-abnormal-returns.mjs (신규)
방식: 각 labeled_outcome에서 같은 기사/기간의 SPY 수익률 차감
      섹터 ETF 매핑 (NVDA→SMH, COP→XLE 등)
결과: 177,092행에 abnormal_return 계산
NAS: labeled_outcomes에 market_return, sector_return, abnormal_return 컬럼 추가
연결: auto-pipeline.mjs의 sensitivity 계산이 abnormal_return 우선 사용하도록 수정
```

**1-3. Matched Controls (대조군 매칭)**
```
수정: scripts/build-matched-controls.mjs (신규)
방식: 각 이벤트에 대해 같은 요일 + VIX ±3 + yieldSpread ±0.2인 비이벤트 날 5개 매칭
      uplift = event_alpha - mean(control_returns), t-검정
결과: 32,133 이벤트 매칭, 133,793 control pairs, 116,452 uplift
      E0=82,080 (노이즈) / E1=29,408 (alpha+) / E2=4,964 (통계 유의 t>1.96)
NAS: matched_controls, event_uplift 테이블 신규 생성
```

**1-4. 시간 정렬**
```
수정: scripts/fix-time-alignment.mjs (신규)
방식: 발행 시각을 ET 기준 장전/장중/장후/주말로 분류
      장후/주말 기사는 entry_price를 다음 거래일 가격으로 보정
결과: 장전 48.6% / 장중 33.8% / 장후 17.6% / 주말 14,160개
      211,485행 next_trading_day 보정, 403,673행 same_day 유지
NAS: articles.market_session, labeled_outcomes.aligned_entry_price 추가
```

### Phase 2: Feature Store

```
수정: scripts/populate-event-features.mjs (신규)
방식: 각 이벤트 날짜의 시장 상태를 17개 피처로 정리
      VIX, 금리차, 유가, 달러, 크레딧 스프레드, GDELT 스트레스,
      Hawkes 강도/모멘텀, 레짐, 리스크 게이지, 소스 수/다양성
      + proxy로 채운 6개 (graph, nmi, narrative, truth, conviction, fpr)
결과: 53,734 이벤트 × 23 피처, NULL 0개
NAS: event_features 테이블 신규 생성
```

### Phase 3: Multi-Task Meta-Model

```
수정: scripts/train-meta-model.py (신규, Python/PyTorch)
구조: Linear(17→128) → ReLU → BatchNorm → Dropout → Linear(128→64) → 4개 헤드
      + Regime embedding bias (hierarchical partial pooling)
출력: P(alpha>0), E[alpha], downside_risk (q05), time_to_peak (1w/2w/1m)
손실: BCE + 0.5×Huber + 0.3×Huber + 0.2×CE
검증: purged walk-forward (5-split, 14일 purge, event group split)
결과: OOS Brier 0.216 (random 0.25 대비 14% 개선), accuracy 68.2%, ECE 0.099
파일: data/meta-v1-20260411-0710.pt (11,226 파라미터)

v2도 시도함 (three-tower + FiLM): 과적합으로 v1보다 나빠짐
  원인: 유효 독립 이벤트 12,054개 대비 파라미터 137,571개
  결론: 현재 데이터 규모에서는 v1이 적합

LightGBM baseline 비교: Brier 0.219 (MLP와 거의 동등)
  → 17개 tabular feature에서는 트리와 MLP 성능 차이 미미
```

### Phase 4: 추론 서버 & 파이프라인 연결

```
수정: scripts/meta-model-server.py (신규, FastAPI + GPU)
      src/services/meta-model-inference.ts (신규, HTTP 클라이언트)
      src/services/event-decision-bridge.ts (신규, orchestrator 브릿지)
      api/event-uplift-grades.js (신규, evidence grade API)
방식: Python GPU 서버가 추론, TS가 HTTP로 결과 수신
      orchestrator.ts에서 ideaCards 반환 직전에 enrichment 단계 삽입
연결: orchestrator → bridge → Python 서버 → alphaProb/expectedAlpha 채움
      + evidence grade API → InvestmentIdeasPanel 배지 표시
```

### Phase 5: UI 표시

```
수정: src/services/investment/types.ts — 5개 필드 추가
      src/components/InvestmentIdeasPanel.ts — 예측값 + evidence grade 표시
      src/styles/main.css — evidence grade 색상 배지 (E0~E4)
표시: "LONG | conviction 72 | false-positive 28 | E2"
      "P(alpha>0): 72% | E[alpha]: +2.30% | Downside: -1.80%"
```

### Phase 6: Master Pipeline 통합

```
수정: scripts/master-pipeline.mjs — STEP 6 추가
      scripts/auto-pipeline.mjs — sensitivity 계산에 abnormal_return 사용
내용: STEP 6에서 canonical-events → abnormal-returns → time-alignment
      → event-features → matched-controls 순차 실행
```

---

## 6. 현재 NAS 테이블 구조

### 기존 테이블 (수정됨)

```
labeled_outcomes — 619,495행
  + canonical_event_id INT (619,490 연결)
  + market_return DOUBLE PRECISION
  + sector_return DOUBLE PRECISION
  + abnormal_return DOUBLE PRECISION (177,092 계산)
  + market_session TEXT (619,495 태그)
  + aligned_entry_price DOUBLE PRECISION (615,158 보정)

articles — 66,802행
  + market_session TEXT (전부 태그됨)
```

### 신규 테이블

```
canonical_events         53,734행  (이벤트 클러스터)
article_event_map        48,078행  (기사→이벤트 매핑)
matched_controls        133,793행  (대조군 날짜 매칭)
event_uplift            116,452행  (uplift + evidence grade)
event_features           53,734행  (17+ 피처, NULL 0개)
model_predictions        (추론 결과 저장용, Python 서버에서 채움)
model_eval                    8행  (검증 결과)
```

---

## 7. 파일 구조

### 이번 세션에서 신규 생성

```
scripts/
  build-canonical-events-fast.mjs    이벤트 클러스터링
  compute-abnormal-returns.mjs       초과수익률 계산
  build-matched-controls.mjs         대조군 매칭 + uplift
  fix-time-alignment.mjs             시간 정렬 + entry_price 보정
  populate-event-features.mjs        Feature Store 적재
  train-meta-model.py                v1 MLP 학습 (PyTorch)
  train-meta-model-v2.py             v2 Three-Tower 학습 (과적합으로 보류)
  compare-models.py                  MLP vs LightGBM vs Logistic 비교
  compute-validation-metrics.py      검증 지표 계산
  meta-model-server.py               FastAPI GPU 추론 서버

src/services/
  meta-model-inference.ts            Python 서버 HTTP 클라이언트
  event-decision-bridge.ts           orchestrator ↔ meta-model 브릿지

api/
  event-uplift-grades.js             evidence grade API

public/data/
  meta-model-v1.onnx                 ONNX 모델 (브라우저 백업용)
  meta-model-v1-norm.json            피처 정규화 파라미터

data/
  meta-v1-20260411-0710.pt           PyTorch 모델 가중치
  meta-v2-20260411-1506.pt           v2 모델 (보류)
```

### 이번 세션에서 수정

```
src/services/investment/orchestrator.ts  — metaModelEnrichment 단계 삽입
src/services/investment/types.ts         — InvestmentIdeaCard에 5개 필드 추가
src/components/InvestmentIdeasPanel.ts   — alphaProb/evidenceGrade 표시
src/styles/main.css                      — evidence grade CSS
scripts/master-pipeline.mjs              — STEP 6 Event Decision Engine 추가
scripts/auto-pipeline.mjs                — abnormal_return 기반 sensitivity
```

---

## 8. 실행 방법

```bash
# 웹 앱 실행
npm run dev

# GPU 추론 서버 (별도 터미널)
python scripts/meta-model-server.py

# 전체 파이프라인 (수집 + 분석 + 이벤트 엔진)
node --import tsx scripts/master-pipeline.mjs

# 모델 재학습 (새 데이터 축적 후)
python scripts/train-meta-model.py --epochs 50

# 모델 비교
python scripts/compare-models.py
```

---

## 9. 개선 가능성

### 즉시 가능

1. **v1 모델 재학습**: 데이터가 더 쌓이면 성능 향상 기대
2. **calibration 보정**: regime×horizon별 isotonic/temperature scaling으로 ECE 0.099 → 0.05 목표
3. **피처 정리**: LightGBM이 market_stress와 regime_multiplier를 안 쓴다고 보고 → 제거 가능
4. **배치 추론**: meta-model-server.py에 /predict/batch 엔드포인트 이미 있음

### 중기 (데이터 5만+ 독립 이벤트 축적 후)

5. **v2 Three-Tower 재시도**: event embedding + symbol embedding + FiLM conditioning
   - 현재 과적합 원인: 독립 이벤트 12,054개에 파라미터 137,571개
   - 5만+ 이벤트가 쌓이면 재시도 의미 있음
6. **uplift head 추가**: P(uplift>0), E[uplift]을 모델 목적함수에 직접 포함
7. **quantile loss**: downside_risk에 Huber 대신 pinball loss (q05 직접 학습)
8. **ordinal time_to_peak**: 3-class softmax 대신 P(>=2w), P(>=1m) 순서 보존
9. **바스켓 우선 출력**: event → theme → basket alpha → symbol exposure 4단계

### 장기 (아키텍처 변경)

10. **금융 계산 엔진 Python 전환**: event-engine, portfolio-optimizer, math-models → numpy/scipy로 10~100배 빠름
11. **delayed-feedback bandit**: reward = alpha - cost - λ×drawdown - η×uncertainty
12. **evidence ladder E3/E4**: OOS 재현(E3), mechanism graph path(E4) 자동화
13. **proposal pipeline 학습화**: expected information gain × alpha improvement ÷ maintenance cost

---

## 10. 사용자 프로필

- Python, C++ 경험. ML/통계학 배경 있음
- TypeScript는 이번 세션에서 배우기 시작 — TS 코드를 직접 읽거나 수정하기는 아직 어려움
- 코드 작성은 AI에 위임하되, 설계 방향과 검증은 직접 판단
- 한국어 의사소통 선호
- GPU: RTX 2070 SUPER, NAS: Synology (192.168.0.76)

---

## 11. 주의사항

- `.env.local`에 API 키와 DB 비밀번호가 있음 — 절대 git에 올리면 안 됨
- DuckDB (`intelligence-archive.duckdb`)는 4월 5일에 여러 번 손상됨 — corrupt 파일 6개 존재
- `data-loader.ts` (4,039줄)와 `DeckGLMap.ts` (6,796줄)는 god module — 분리 필요하지만 아직 안 함
- v2 모델은 과적합으로 보류 상태 — 데이터 더 쌓이기 전까지 사용하지 말 것
- event_features의 graph/nmi/narrative/truth/conviction/fpr은 proxy 값 — 실제 런타임 계산값이 아님
