---
title: "2026-03: 제약된 자율성, 현실 반영 리플레이, shadow rollback"
summary: 투자 아이디어가 이제 calibrated confidence, abstain/shadow 상태, 현실 비용 패널티, rollback-aware shadow control을 함께 가집니다.
status: stable
updated: 2026-03-16
owner: core
---

# 2026-03: 제약된 자율성, 현실 반영 리플레이, shadow rollback

이제 투자 스택은 테마와 후보를 늘리는 것만 하지 않습니다.

스스로 제약도 겁니다.

## 바뀐 점

- 소스 간 모순과 루머성 표현이 confidence를 깎습니다
- 오래된 mapping prior는 감쇠되고 현재 아이디어를 지배하지 못합니다
- recent-evidence floor가 약하면 live deployment를 막습니다
- spread, slippage, liquidity, session-state 패널티가 replay 요약에 반영됩니다
- idea card가 `deploy`, `shadow`, `watch`, `abstain` 중 하나로 정리됩니다
- 최근 tracked 성과가 약하면 shadow rollback이 자동으로 걸립니다

## 어디서 보이나

- `Investment Workflow`
- `Backtest Lab`
- `docs/investment-usage-playbook.md`
- `docs/automation-runbook.md`

## 의미

이 시스템은 여전히 무제한 auto-trader는 아닙니다.

대신 이전보다 더 제약된 자율 연구/의사결정 스택에 가까워졌습니다.
