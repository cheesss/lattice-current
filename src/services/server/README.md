# `src/services/server` Guide

이 디렉터리는 historical automation 엔진이다.

## 주요 파일

- `intelligence-automation.ts`
  - 전체 scheduler cycle
- `source-automation.ts`
  - source discovery / approval / activation
- `codex-theme-proposer.ts`
  - Codex 기반 theme proposal
- `codex-dataset-proposer.ts`
  - dataset proposal
- `intelligence-postgres.ts`
  - optional Postgres sync

## automation cycle

기본 흐름:

1. fetch
2. import
3. replay
4. walk-forward
5. theme-discovery
6. source-automation
7. keyword-lifecycle
8. candidate-expansion
9. dataset-discovery
10. self-tuning
11. retention

## 정책 레이어

- guarded-auto / full-auto
- max overlap
- proposal score floors
- max promotions per cycle
- provider allowlist

## 에이전트가 수정할 때

- 실제 provider fetch 스크립트와 automation orchestration을 혼동하지 말아야 한다.
- rate limit 대응은 이 디렉터리와 개별 fetch 스크립트 양쪽에서 같이 걸린다.

