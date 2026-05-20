---
title: 실시간 인텔리전스
summary: 라이브 맵, 경보, 그래프 컨텍스트, 리포트 메모, 변형 간 모니터링 화면.
status: stable
variants:
  - full
  - tech
  - finance
updated: 2026-05-10
owner: core
---

# 실시간 인텔리전스

## 무엇을 하나요

라이브 피드, 맵 레이어, 점수, 증거 번들, 애널리스트형 리포트 메모를 하나의 운영 화면으로 통합합니다.

## 왜 필요한가요

뉴스 피드, 지도, 개별 시장 도구 사이를 계속 오가야 하는 맥락 전환 비용을 줄이기 위해서입니다.

## 입력

- 선별된 피드와 API
- 지도 레이어와 지리 공간 자산
- source credibility와 signal aggregation 출력
- evidence bundle, 시장 반응, source quality, ontology 컨텍스트
- 리포트 backfill 및 source-query 작업

## 출력

- 라이브 패널과 맵 오버레이
- alert 카드와 instability score
- focal point와 transmission lead
- client memo와 audit appendix가 분리된 research-prioritization memo
- watch trigger, caveat, evidence collection task

## 주요 UI 표면

- 맵과 레이어 컨트롤
- 라이브 뉴스 패널
- Analysis Hub와 Ontology 페이지
- 전략 및 국가 단위 요약
- 리포트 artifact와 audit appendix 링크

## 관련 알고리즘

- signal aggregation
- source credibility
- convergence 및 instability scoring
- ontology graph enrichment
- evidence strength classification
- signal-card synthesis와 report quality gate
- transcript, market validation, causal support 기반 investment-readiness cap

## 한계

공개 문서에는 민감한 운영 커넥터나 비공개 소스가 포함되지 않습니다.
리포트 메모는 의사결정 지원 산출물이며 투자 추천이 아닙니다. 데이터 품질이 부족하면 강한 문장으로 포장하지 않고 blocker를 표시하고 collection task를 큐에 넣어야 합니다.

## 변형 적용 범위

`full`, `tech`, `finance` 전반에 적용되며, 도메인별 피드와 패널 구성이 다릅니다.
