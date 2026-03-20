---
layout: home
title: Lattice Current
summary: 하나의 코드베이스에서 실시간 글로벌 인텔리전스, AI 보조 분석, 온톨로지 그래프, 히스토리컬 리플레이를 제공하는 문서 사이트.
status: stable
variants:
  - full
  - tech
  - finance
updated: 2026-03-20
owner: core
hero:
  name: Lattice Current
  text: 리플레이, 운영, 그래프 인텔리전스를 갖춘 시그널 워크스페이스
  tagline: 실시간 모니터링, 구조화된 추론, 리플레이 기반 검증, 웹 실행 경로까지 포함한 공개 연구 포크입니다.
  image:
    src: /images/hero/lattice-current-hero.jpg
    alt: Lattice Current 공개용 히어로 이미지
  actions:
    - theme: brand
      text: 시작하기
      link: /ko/getting-started
    - theme: alt
      text: 아키텍처
      link: /ko/architecture
    - theme: alt
      text: 플레이그라운드
      link: /ko/playground
    - theme: alt
      text: GitHub Repo
      link: https://github.com/cheesss/lattice-current
features:
  - title: 패널 과부하 대신 워크스페이스 셸
    details: Overview, Intelligence, Investing, Builders, Operations 뷰로 재구성해 목적별로 훨씬 빠르게 진입할 수 있습니다.
  - title: Replay Studio와 웹 실행 운영면
    details: 히스토리컬 리플레이, 워크포워드, 스케줄러 제어, 파이프라인 상태를 전용 허브에서 웹 경로로도 다룰 수 있습니다.
  - title: 공유 인텔리전스 패브릭
    details: 뉴스, 클러스터, 스냅샷, 분석 아티팩트를 저장하고 Briefing Desk, Research Desk, Graph Studio, Replay Studio가 함께 재사용합니다.
---

## 가장 빠른 시작 경로

문서 홈은 이제 실제 제품 구조를 더 가깝게 반영합니다. 지도 중심 진입, 워크스페이스 셸, 리플레이 중심 연구 루프를 먼저 이해한 뒤 필요한 문서만 내려가면 됩니다.

<div class="lc-home-signalbar">
  <div class="lc-home-signalbar-item">
    <span>운영 모드</span>
    <strong>Full / Tech / Finance</strong>
  </div>
  <div class="lc-home-signalbar-item">
    <span>코어 루프</span>
    <strong>Signal -> Score -> Connect -> Replay</strong>
  </div>
  <div class="lc-home-signalbar-item">
    <span>첫 진입</span>
    <strong>지도 -> 허브 -> 리플레이 -> 시나리오</strong>
  </div>
</div>

<ClientOnly>
  <AppGradeGlobeShowcase locale="ko" />
</ClientOnly>

<ClientOnly>
  <AppGradeFlatMapShowcase locale="ko" />
</ClientOnly>

## 포크 위치

이 저장소는 독립 공개 연구 포크입니다. 특정 upstream 프로젝트의 공식 배포판이나 공식 호스팅 서비스를 의미하지 않습니다.

## 현재 제품 구성

- **Live Workspace**: 우선순위 라이브 시그널과 지도 중심 운영 맥락
- **Briefing Desk**: 현재 국면, 리스크 프레이밍, 운영 요약
- **Research Desk**: Codex 보조 탐색, 자동화 거버넌스, 데이터셋 검토
- **Replay Studio**: 리플레이, 워크포워드, 데이터 상태, 스케줄러 액션, 결과 해석
- **Graph Studio**: 온톨로지와 관계 구조를 위한 탐색 표면
- **Data Flow Ops**: 지연, 보존, 저장, heartbeat, coverage 품질 추적

## 변형

- **Full**: 지정학, 분쟁, 인프라, 군사, 매크로 파급
- **Tech**: AI, 스타트업, 클라우드, 사이버, 공급망 및 생태계 모니터링
- **Finance**: 크로스애셋, 매크로, 중앙은행, 전이 분석, 리플레이, 투자 워크플로우

## 필요한 경로만 바로 열기

<div class="lc-home-route-grid">
  <div class="lc-home-route-card">
    <span class="lc-route-kicker">체험 경로</span>
    <h3>메인 지도 표면 -> 기능</h3>
    <p>위의 3D 지구본과 2D 운영 지도를 먼저 체험한 뒤, 필요한 capability 문서만 들어가면 됩니다.</p>
    <a href="/ko/playground">플레이그라운드 열기</a>
  </div>
  <div class="lc-home-route-card">
    <span class="lc-route-kicker">시스템 경로</span>
    <h3>아키텍처 -> 런타임 소유권</h3>
    <p>어떤 계층이 어디서 돌고, 무엇을 저장하며, 리플레이와 스토리지가 어떻게 이어지는지 볼 때만 토폴로지를 열면 됩니다.</p>
    <a href="/ko/architecture">아키텍처 문서 열기</a>
  </div>
  <div class="lc-home-route-card">
    <span class="lc-route-kicker">모델 경로</span>
    <h3>AI · 백테스트</h3>
    <p>점수, prior, 검증 흐름의 근거가 필요할 때만 AI · 백테스트 문서로 내려가면 됩니다.</p>
    <a href="/ko/ai-backtesting/">AI · 백테스트 문서 열기</a>
  </div>
  <div class="lc-home-route-card">
    <span class="lc-route-kicker">시각 경로</span>
    <h3>전용 글로브 경로</h3>
    <p>메인 페이지와 같은 3D 지구본을 다른 요소 없이 단독으로 보고 싶다면 별도 showcase 경로를 열면 됩니다.</p>
    <a href="/ko/showcase/globe">글로브 쇼케이스 열기</a>
  </div>
</div>

## 최근에 바뀐 것

- 모니터형 레이아웃을 줄이고 목적 중심 워크스페이스 셸로 재구성했습니다
- 리플레이, 연구, 그래프, 운영 모니터링을 전용 허브로 분리했습니다
- 로컬 웹 런타임에서 리플레이와 스케줄러를 직접 실행할 수 있게 했습니다
- 수집한 뉴스, 스냅샷, 인텔리전스 아티팩트를 세션 데이터가 아니라 재사용 가능한 저장 자산으로 정리했습니다
- current-vs-replay drift, 포트폴리오 회계, 의사결정 브리프를 통해 리플레이 해석을 강화했습니다
- 자동화 거버넌스와 데이터 플로우 가시성을 추가해 무엇이 돌고 있고 막혔는지 바로 보이게 했습니다

## 공개 문서 원칙

<div class="policy-callout">
공개 문서는 제품 동작, 아키텍처, 알고리즘을 설명하지만 민감한 운영 세부, 비공개 피드, 자격 증명, 내부 전용 워크플로우는 제외하거나 정제합니다.
</div>

## 여기서 시작

- [시작하기](/ko/getting-started)
- [기능](/ko/features/)
- [AI · 백테스트](/ko/ai-backtesting/)
- [알고리즘](/ko/algorithms)
- [법적 고지](/ko/legal/)

## 최신 업데이트

- [2026-03: 제품 표면 재구성, Replay Studio, 공유 인텔리전스 패브릭](/ko/updates/2026-03-surface-refresh)
- [2026-03: 앱 수준 지구본과 2D 지도를 메인 페이지로 이동](/ko/updates/2026-03-home-map-surfaces)
- [2026-03: 문서 홈에 인터랙티브 지구본 추가](/ko/updates/2026-03-interactive-globe-home)
- [2026-03: 문서 사이트 공개와 공개 정책 정리](/ko/updates/2026-03-docs-launch)
