# Agent Handoff Briefing

## 이 프로젝트가 뭔가

지정학 뉴스/이벤트 시그널 기반 투자 아이디어 생성 + 백테스팅 플랫폼.
GDELT, Guardian, NYT 등 뉴스를 수집하고, 클러스터링/신뢰도 평가를 거쳐 투자 아이디어를 만들고, 포트폴리오 회계로 성과를 측정한다.

## 반드시 읽어야 하는 파일

| 파일 | 내용 |
|------|------|
| `AGENTS.md` | 코드 수정 원칙, 파이프라인 구조, 주요 파일 위치, 유용한 명령어 |
| `CLAUDE.md` | Codex 에이전트 사용 규칙, 세션 관리 원칙 |
| `docs/NAS_BACKTEST_STORAGE_PLAN_2026-04-01.md` | NAS 데이터 저장 아키텍처, 테이블 스키마 |
| `docs/AGENT_QUICKSTART.md` | 에이전트 온보딩 가이드 |
| `docs/TEST_OPERATIONS_RUNBOOK.md` | 테스트 및 검증 절차 |
| `docs/GDELT_GUARDIAN_INGEST_AND_TRAINING_PLAN_2026-04-01.md` | GDELT vs Guardian 데이터 특성 차이, 설계 철학 |

## 현재 상태 요약

### 완료된 것
- NAS PostgreSQL(192.168.0.76:5433)에 5년치 데이터 통합 완료 (Guardian 57k, NYT 3.3k, GDELT 집계 1.38M, Yahoo 80k, FRED 6.3k)
- 60,353건 기사 임베딩 생성 (Ollama nomic-embed-text)
- 618,402건 아웃컴 레이블링 완료
- weight-learner.ts, rag-retriever.ts, threshold-optimizer.ts 구현
- NAS에서 직접 replay frame을 빌드하는 loadHistoricalReplayFramesFromPostgres 구현
- event-resolver.ts로 Guardian/NYT/GDELT 기사를 이벤트 단위로 묶는 canonical event resolver 구현
- Walk-forward 4-fold + OOS holdout + CPCV/DSR/PBO 거버넌스 작동
- 백테스트 성능 최적화 (batched 모드, 9시간→30분)
- 리스크 엔진 (VaR/CVaR, 드로다운 거버너, 변동성 사이징)
- 코드 강건성 수정 (하드코딩 비밀번호 제거, NaN 방어, 환경변수화)

### 현재 겪고 있는 큰 문제

**아이디어는 수백 개 생성되지만, "accepted" 상태로 승인되는 건이 극소수 (3~8개)다.**

이유: 이 시스템의 투자 게이트(meta admission)가 `metaHitProbability >= 0.52`를 요구하는데, NAS 데이터 기반 아이디어의 metaHitProbability가 구조적으로 0.24~0.50 범위에 머문다. 0.52에 절대 도달하지 않는다.

이것이 발생하는 근본 원인의 체인:

```
Guardian/NYT 기사 → event-resolver로 클러스터링
  → 하지만 multi-source 비율이 4.23%뿐 (같은 사건을 여러 매체가 보도한 경우가 적음)
  → 대부분 클러스터의 sourceCount = 1
  
sourceCount가 낮음
  → eventIntensity 점수가 낮음 (sourceCount * 7이 기여)
  → source credibility에서 corroboration 점수가 낮음
  
NAS 프레임에 event-market transmission 데이터가 없음
  → marketStress = 0 (confidence 기반 proxy로 대체했지만 0~0.5 범위)
  → transmission 기반 conviction 보너스가 비활성화
  → 기존 GDELT DOC 경로는 transmission이 있어서 conviction이 높았음

위 요인들이 합쳐져서:
  → confidence, confirmation, reality 점수 모두 낮음
  → metaHitProbability = 0.24~0.50
  → watchHitProbability(0.52) 미달 → accepted 안 됨
  → watch 상태로 소규모 포지션만 잡음 → 평균 현금 93~97%
```

### 결과적으로

- In-Sample: 5.5% 수익, Sharpe -0.73 (watch 포지션의 소규모 거래)
- 최적 결과 (DuckDB 기반 1.5년): CAGR 12.29%, Sharpe 1.01 (하지만 이건 데이터 1.5년뿐이라 통계적 의미 약함)
- OOS: -0.5% ~ -0.96% (과적합)
- 거버넌스: 모든 실행에서 reject 판정

### 해결해야 할 방향

1. **accepted rate 향상**: cluster confidence → eventIntensity → conviction → metaHitProbability 로 이어지는 점수 체인을 강화하여 0.52 임계값을 넘을 수 있도록. 또는 임계값 자체를 데이터 분포에 맞게 자동 조정 (threshold-optimizer가 있지만 validation 데이터 부족으로 기본값 반환 중)

2. **transmission 데이터 부재 보완**: NAS 프레임에 event-market transmission이 없는 것이 conviction을 구조적으로 낮추는 핵심 원인. GDELT daily_agg의 goldstein/tone을 transmission proxy로 더 강하게 연결하거나, 가격 데이터에서 직접 market reaction을 추정하는 방법 필요

3. **매직넘버 제거**: 현재 시그널 가중치의 ~70%가 하드코딩. walk-forward 내 자동 학습으로 교체하는 작업이 계획됨 (threshold-optimizer는 구현됨, conviction-learner는 미구현)

## 환경

- NAS: 192.168.0.76:5433 (PostgreSQL + pgvector 0.8.2, DB: lattice)
- Ollama: localhost:11434 (nomic-embed-text 모델)
- 환경변수: `.env.local`에 PG_PASSWORD, GUARDIAN_API_KEY, NYT_API_KEY, OLLAMA_URL 등
- 백테스트 실행: `node --max-old-space-size=8192 --import tsx scripts/intelligence-job.mjs run-walk-forward --payload-file .tmp-wf-payload.json --out .tmp-wf-result.json`
- 검증: `npm run typecheck`, `npm run verify:nas:e2e`

## 주의사항

- 모든 백필 데이터는 NAS에 저장. DuckDB는 레거시 (아직 fallback으로 남아있음)
- 환경변수 없이 실행하면 비밀번호 에러 발생 (하드코딩 제거됨)
- `export $(grep -v '^#' .env.local | xargs)` 로 환경변수 로드 후 실행
- Codex CLI 세션 재사용: `codex exec resume --last --full-auto "<지시사항>"`
