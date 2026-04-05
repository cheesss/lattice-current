# CLAUDE.md

## 프로젝트 개요

Lattice는 뉴스 이벤트-종목 반응 분석 플랫폼. 40개 실시간 소스에서 뉴스/시장 데이터를 수집하고, 이벤트별 종목 반응을 분석하여 사용자에게 보여줌.

## 핵심 구성

- NAS PostgreSQL: 192.168.0.76:5433, DB: lattice
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
| `scripts/codex-from-analysis.mjs` | 분석→Codex 제안 (Anthropic API로 전환 예정) |

## NAS 테이블 구조

| 테이블 | 용도 |
|--------|------|
| `articles` | 60k 기사 (Guardian/NYT, 임베딩 포함) |
| `labeled_outcomes` | 619k 기사→종목 수익률 레이블 |
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

## 코드 수정 원칙

1. TypeScript 에러 없이 수정 완료 (`npx tsc --noEmit`)
2. `noUncheckedIndexedAccess: true` — 배열 접근 시 `?? 0` 또는 `!` 사용
3. 요청된 변경사항만 수정 — 불필요한 리팩토링 금지
4. 환경변수 하드코딩 금지 — .env.local에서 로드

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
