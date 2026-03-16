---
title: 자동화 · 테마 발견
summary: dataset registry, scheduler worker, replay cadence, theme discovery queue, Codex theme proposal.
status: beta
variants:
  - full
  - finance
updated: 2026-03-16
owner: core
---

# 자동화 · 테마 발견

이 페이지는 백테스트 운영 자동화를 설명합니다.

## 포함된 것

- `config/intelligence-datasets.json` 기반 dataset registry
- scheduler worker
- `fetch -> import -> replay`
- nightly walk-forward
- lock / retry / retention
- theme discovery queue
- guarded Codex theme proposer

## 핵심 원칙

- Codex가 바로 실거래 결정을 내리는 구조는 아닙니다.
- Codex는 반복 신호에서 새 백테스트 테마를 제안합니다.
- scheduler policy가 임계치를 통과한 경우에만 승격합니다.
- 승격된 테마는 다음 replay cycle부터 반영됩니다.

## 주요 명령

```bash
npm run intelligence:scheduler:once
npm run intelligence:scheduler
node --import tsx scripts/intelligence-scheduler.mjs status
```

## 제약된 자율성

이 자동화 루프는 테마와 후보를 더 많이 찾는 데서 끝나지 않습니다.

이제 투자 스냅샷은 아래 제약도 같이 적용합니다.

- 소스 간 모순 패널티
- 루머 / hedge 표현 패널티
- 오래된 prior 감쇠
- recent-evidence floor
- spread / slippage / liquidity / session-state 패널티
- calibrated confidence
- `deploy`, `shadow`, `watch`, `abstain` action gate
- 최근 shadow 성과가 나빠질 때 rollback

즉 지금 구조는 무제한 auto-trader보다 제약된 자율 연구 스택에 더 가깝습니다.
