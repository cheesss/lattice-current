# Repository Agent Rules

## Documentation Sync Rule

When you change any user-visible behavior, feature scope, architecture, algorithm, API, storage model, replay or backtest flow, UI surface, navigation, or public policy, you must update the public docs site in the same turn.

---

## Sub-Agent Instructions (Codex / Claude Code)

이 섹션은 Codex CLI 또는 Claude Code가 서브에이전트로 작동할 때의 지침입니다.

### 프로젝트 개요

`lattice-current-fix`는 지정학적 뉴스/이벤트 신호를 분석해서 투자 아이디어를 생성하고 백테스팅하는 플랫폼.

핵심 파이프라인:
```
GDELT 뉴스 → 클러스터링 → 소스 신뢰도 평가 → 이벤트-시장 전파 모델링
→ 투자 아이디어 생성 (idea-generator.ts) → meta gate 판단 → 포트폴리오 회계
```

### 중요 파일 위치

| 역할 | 파일 |
|------|------|
| 투자 아이디어 생성/판단 | `src/services/investment/idea-generator.ts` |
| 소스 신뢰도 계산 | `src/services/source-credibility.ts` |
| 포지션 규칙 | `src/services/investment/constants.ts` |
| Adaptive 파라미터 모듈 | `src/services/investment/adaptive-params/` |
| 백테스트 오케스트레이터 | `src/services/historical-intelligence.ts` |
| 포트폴리오 회계 | `src/services/portfolio-accounting.ts` |
| 포지션 사이저 | `src/services/investment/position-sizer.ts` |
| 이벤트-시장 전파 | `src/services/event-market-transmission.ts` |

### 코드 수정 원칙

1. TypeScript 에러 없이 수정 완료 (`npx tsc --noEmit` 확인)
2. 전역 적용: 한 파일 패턴은 관련 모든 파일에 동일 적용
3. 매직넘버 최소화: 하드코딩 상수는 named constant 또는 데이터 기반으로 교체
4. 주석 추가 금지: 자명하지 않은 로직에만 최소한으로
5. 요청된 변경사항만 수정 — 불필요한 리팩토링 금지

### 완료된 작업

- [x] narrative shadow positive boost 제거 + shadowPenalty cap 0.28→0.45 (idea-generator.ts)
- [x] dependenceTrustScore 직접 보상 제거 → false corroboration discount (source-credibility.ts)
- [x] adaptive modules 활성화: atrStops, kalmanAutoTune, executionCosts, themeSensitivity (types.ts)

### 다음 작업 목록

#### 1. Walk-forward 롤링 창 구현 (historical-intelligence.ts)
`splitWalkForwardWindows()` → 확장창(Expanding Window) 방식으로 교체
- 입력: frames 배열 + foldCount(기본 4)
- 각 fold: 학습창 점점 늘어남, 검증 6개월, 테스트 6개월
- fold 간 mappingStats, sourceProfiles, banditStates 이월 지원

#### 2. ML 가중치 학습 모듈 생성
파일: `src/services/investment/adaptive-params/weight-learner.ts`
- `trainMetaWeights(ideaRuns, forwardReturns)`: 로지스틱 회귀 → metaHitProbability 가중치
- `trainCredibilityWeights(sourceProfiles, ideaRuns)`: 릿지 회귀 → baseCredibility 가중치
- 외부 ML 라이브러리 없이 순수 TypeScript (경사하강법)
- 가중치 JSON으로 저장/로드

#### 3. metaHitProbability 수식 교체 (idea-generator.ts)
12개 하드코딩 가중치 → weight-learner.ts 학습 결과로 교체
- store.ready && store.metaWeights 있으면 학습 가중치 사용
- 없으면 기존 하드코딩 fallback

#### 4. baseCredibility 수식 교체 (source-credibility.ts)
8개 하드코딩 가중치 → weight-learner.ts 학습 결과로 교체

#### 5. propagandaRisk 이분법 제거 (source-credibility.ts)
현재: 키워드 있으면 82점/없으면 18점 (64점 절벽)
목표: 소스별 실제 오보율 기반 확률 점수

#### 6. fpScale 동적 보정 (idea-generator.ts)
현재: `1 - falsePositiveRisk / 300` (사실상 무력화)
목표: 실제 FP율 데이터로 계수 동적 조정

### 유용한 명령어

```bash
# TypeScript 타입 체크
npx tsc --noEmit

# 백테스트 실행
node --max-old-space-size=8192 --import tsx scripts/intelligence-job.mjs run-replay \
  --payload-file .tmp-v16-payload.json --out .tmp-result.json

# 결과 확인
node -e "const fs=require('fs');const r=JSON.parse(fs.readFileSync('.tmp-result.json')).run;const s=r.portfolioAccounting.summary;console.log('CAGR:',s.cagrPct,'%','Cash:',s.avgCashPct,'%','Sharpe:',s.sharpeRatio,'Trades:',s.tradeCount);r.summaryLines.slice(-3).forEach(l=>console.log(l));"

# DuckDB 잠금 해제
powershell -Command "Stop-Process -Name node -Force -ErrorAction SilentlyContinue"
```

### 주의사항

- DuckDB 잠금 시 위 명령으로 node 프로세스 종료 후 재시도
- OOM 시 `--max-old-space-size=8192` 추가
- `trades=[]`는 직렬화 최적화 — 버그 아님
- adaptive modules는 store.ready=false면 자동 하드코딩 fallback
- FRED_API_KEY는 .env.local에서 환경변수로 전달 (키를 코드에 하드코딩하지 말 것)

This rule applies to changes under:
- `src/`
- `src-tauri/`
- `server/`
- `scripts/`
- `docs/`
- `site/`

Required actions:
1. Identify the affected public-facing pages under `site/` and reference docs under `docs/`.
2. Update at least one of the following when applicable:
   - feature page
   - architecture page
   - algorithms page
   - API page
   - update post under `site/updates/`
   - legal or policy page
3. If navigation or information architecture changes, update `site/.vitepress/config.mts`.
4. If screenshots, diagrams, or interactive docs components are affected, update those assets or components too.
5. Run `npm run docs:build` before finishing.
6. If the change is intended for the public site, run `npm run public:sync`.
7. In the final response, list the docs files that were updated.

Do not ship code-only changes that alter public behavior without corresponding docs updates.

If a change truly has no public documentation impact, state that explicitly in the final response and explain why.

