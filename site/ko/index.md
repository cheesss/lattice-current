---
layout: home
title: Lattice Current
summary: 단일 operator shell, canonical event 계층, Python 배치 계산 경계를 반영한 문서 사이트.
status: stable
variants:
  - full
  - tech
  - finance
updated: 2026-04-12
owner: core
hero:
  name: Lattice Current
  text: operator shell, canonical events, Python compute를 갖춘 시그널 워크스페이스
  tagline: 실시간 모니터링과 운영면은 TypeScript가 맡고, 무거운 배치 계산은 Python으로 분리한 공개 연구 포크입니다.
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
  - title: 단일 operator shell
    details: live signals, theme brief, approval queue, diagnostics가 하나의 진입면으로 정리되었습니다.
  - title: canonical event 계층
    details: raw article row를 바로 signal로 쓰지 않고, 중간에서 evidence를 묶어 reusable event object로 승격합니다.
  - title: Python compute lane
    details: clustering, abnormal return, 모델 학습 같은 CPU-bound 계산을 TypeScript에서 분리해 PostgreSQL 결과물로 연결합니다.
---

## 가장 빠른 시작 경로

문서 홈은 이제 현재 코드 구조를 그대로 반영합니다. 먼저 shell과 operator loop를 이해하고, 그 다음 canonical event 계층과 Python compute 경계를 보는 순서가 가장 빠릅니다.

<div class="lc-home-signalbar">
  <div class="lc-home-signalbar-item">
    <span>운영 모드</span>
    <strong>Full / Tech / Finance</strong>
  </div>
  <div class="lc-home-signalbar-item">
    <span>코어 루프</span>
    <strong>Ingest -> Resolve -> Brief -> Validate</strong>
  </div>
  <div class="lc-home-signalbar-item">
    <span>실행 경계</span>
    <strong>TS orchestration / Python compute</strong>
  </div>
</div>

## 현재 제품 구성

- **Operator Shell**: `event-dashboard.html` 중심의 라이브 시그널, brief, approval, diagnostics 표면
- **Canonical Event Layer**: 기사 단위 입력을 실제 signal object로 승격하는 계층
- **Research And Proposal Flow**: Codex-assisted theme proposal, approval queue, dataset 검토
- **Replay And Validation**: replay, abnormal return, historical calibration 계층
- **Map Context**: 2D Geo Lens와 관련 overlay를 shell 내부에 포함
- **Storage And Runtime**: NAS PostgreSQL, snapshot, DuckDB, sidecar, desktop runtime

## 현재 실행 경계

- **TypeScript**: 브라우저 UI, API, scheduler, ingestion, desktop orchestration
- **Python**: canonical-event clustering, abnormal return, 모델 학습과 비교, 앞으로 옮길 고비용 계산
- **Rust**: Tauri 런타임

## 최근에 바뀐 것

- backtest-first 정체성에서 operator shell 중심 구조로 이동했습니다
- raw article row를 바로 signal로 쓰지 않고 canonical event 계층을 중간에 두기 시작했습니다
- CPU-bound 계산을 TypeScript에서 분리해 Python compute lane으로 옮기기 시작했습니다
- replay와 validation은 live shell을 보조하는 downstream calibration 계층으로 재정리했습니다
- map surface는 여전히 중요하지만, 이제 제품 전체 정체성을 혼자 대표하지 않도록 조정했습니다

## 필요한 경로만 바로 열기

<div class="lc-home-route-grid">
  <div class="lc-home-route-card">
    <span class="lc-route-kicker">시스템 경로</span>
    <h3>아키텍처 -> 실행 경계</h3>
    <p>operator shell, canonical event 계층, Python compute lane이 어디서 만나는지 바로 확인할 수 있습니다.</p>
    <a href="/ko/architecture">아키텍처 문서 열기</a>
  </div>
  <div class="lc-home-route-card">
    <span class="lc-route-kicker">실행 경로</span>
    <h3>시작하기 -> 로컬 실행</h3>
    <p>기본 앱 실행과 Python compute dry-run 명령을 같이 확인할 수 있습니다.</p>
    <a href="/ko/getting-started">시작하기 열기</a>
  </div>
  <div class="lc-home-route-card">
    <span class="lc-route-kicker">기능 경로</span>
    <h3>기능 문서</h3>
    <p>live intelligence, automation, replay surface가 현재 어떤 역할로 남아 있는지 빠르게 볼 수 있습니다.</p>
    <a href="/ko/features/">기능 문서 열기</a>
  </div>
  <div class="lc-home-route-card">
    <span class="lc-route-kicker">체험 경로</span>
    <h3>플레이그라운드</h3>
    <p>문서보다 먼저 제품 표면과 상호작용을 보고 싶다면 playground로 들어가면 됩니다.</p>
    <a href="/ko/playground">플레이그라운드 열기</a>
  </div>
</div>

## 공개 문서 원칙

<div class="policy-callout">
공개 문서는 제품 동작, 아키텍처, 알고리즘, 실행 경계를 설명하지만 민감한 운영 세부, 비공개 피드, 자격 증명, 내부 전용 워크플로우는 제외하거나 정제합니다.
</div>

## 여기서 시작

- [시작하기](/ko/getting-started)
- [기능](/ko/features/)
- [아키텍처](/ko/architecture)
- [알고리즘](/ko/algorithms)
- [법적 고지](/ko/legal/)
