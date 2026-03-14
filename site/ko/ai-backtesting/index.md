---
title: AI · 백테스트
summary: AI 계층, 투자 로직, 리플레이 엔진이 어떻게 결합되는지 설명합니다.
status: beta
variants:
  - full
  - tech
  - finance
updated: 2026-03-15
owner: core
---

# AI · 백테스트

이 섹션은 AI, 투자 로직, 리플레이가 어떻게 통합되는지 설명하는 문서를 묶어 제공합니다.

## 핵심 아티팩트

- [AI / 백테스트 통합 분석](https://github.com/cheesss/lattice-current/blob/main/docs/ai_backtest_analysis.md)
- [개선 계획: 60개 구체 항목](https://github.com/cheesss/lattice-current/blob/main/docs/improvement_plan_60_points.md)
- [UX 및 시각화 개선안](https://github.com/cheesss/lattice-current/blob/main/docs/ux_visualization_improvements.md)
- [투자 활용 플레이북](https://github.com/cheesss/lattice-current/blob/main/docs/investment-usage-playbook.md)

## 통합 흐름

1. 라이브 피드와 구조화 서비스가 현재 스냅샷을 만든다
2. AI와 그래프 계층이 근거 기반 컨텍스트를 만든다
3. 투자 로직이 테마를 자산에 매핑하고 아이디어 후보를 만든다
4. 리플레이와 워크포워드 백테스트가 시간이 지나며 이를 평가한다
5. 학습된 prior가 다시 라이브 의사결정 지원으로 돌아간다

## 현재 한계

- 일부 확률 계층은 여전히 실용적 근사치다
- 리플레이 품질은 point-in-time 데이터 완전성에 의존한다
- learned sizing은 adaptive prior와 hard guardrail을 혼합해 사용한다

## 다음 읽을 문서

- [알고리즘](/ko/algorithms)
- [아키텍처](/ko/architecture)
- [기능 / 투자 · 리플레이](/ko/features/investment-replay)