---
title: 신호 평가
summary: AI, 신호 해석, 판단 보조, 리플레이 검증이 어떻게 결합되는지 설명합니다.
status: beta
variants:
  - full
  - tech
  - finance
updated: 2026-04-05
owner: core
---

# 신호 평가

이 섹션은 현재 브랜치에서 AI, 신호 해석, 판단 보조, 리플레이 검증이 어떻게 연결되는지 설명하는 문서를 묶어 제공합니다.

## 핵심 문서

- [문서 인덱스](https://github.com/cheesss/lattice-current/blob/main/docs/DOCUMENTATION.md)
- [알고리즘](https://github.com/cheesss/lattice-current/blob/main/docs/ALGORITHMS.md)
- [AI 인텔리전스](https://github.com/cheesss/lattice-current/blob/main/docs/AI_INTELLIGENCE.md)
- [판단 보조 플레이북](https://github.com/cheesss/lattice-current/blob/main/docs/investment-usage-playbook.md)
- [시간축 feature 업그레이드 상태](https://github.com/cheesss/lattice-current/blob/main/docs/TEMPORAL_FEATURE_UPGRADE_2026-04-05.md)

## 통합 흐름

1. 라이브 피드와 구조화 서비스가 현재 스냅샷을 만든다
2. AI, 이벤트 리졸버, 그래프 계층이 근거 기반 컨텍스트를 만든다
3. 판단 보조 로직이 신호를 구조화된 후보로 만든다
4. 리플레이와 과거 검증이 그 후보가 타당했는지 확인한다
5. 검증 결과가 다시 증거 품질과 admission 품질을 보정한다

## 공개 mock 워크벤치

공개 문서 사이트에도 클릭 가능한 mock replay 워크벤치가 있습니다. private feed에 연결되지는 않지만, 현재 제품 구조를 보여줍니다.

- point-in-time 데이터셋
- 리플레이와 시나리오 비교
- 운영자 의사결정 자세
- hot / warm / cold 저장 라이프사이클

<ReplayScenarioWorkbench locale="ko" />

## 현재 한계

- 일부 확률 계층은 여전히 실용적 근사치다
- 리플레이 품질은 point-in-time 데이터 완전성에 의존한다
- 현재 main 브랜치는 완전한 자동 매매 스택이 아니다

## 다음 읽을 문서

- [알고리즘](/ko/algorithms)
- [아키텍처](/ko/architecture)
- [기능 / 투자 · 리플레이](/ko/features/investment-replay)
- [오퍼레이션 콘솔](/ko/playground)
