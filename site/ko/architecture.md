---
title: 아키텍처
summary: operator shell, canonical event 계층, TypeScript/Python 실행 경계, 저장 흐름.
status: stable
variants:
  - full
  - tech
  - finance
updated: 2026-04-12
owner: core
---

# 아키텍처

<p class="lc-section-caption">
현재 메인 브랜치는 하나의 operator shell을 중심으로 재정리되어 있습니다. 아래 컴포넌트는 시각적 토폴로지를 보여주고, 본문은 실제 코드 경계와 실행 책임을 정리합니다.
</p>

<ScrollSignalStory locale="ko" />

<SystemTopology locale="ko" />

## 주요 서브시스템

- `event-dashboard.html` 중심의 operator shell과 패널 시스템
- feed, macro, market, structured event source를 수집하는 ingestion / normalization 계층
- raw article row를 reusable signal object로 승격하는 canonical event 계층
- brief, proposal, approval, diagnostics를 만드는 interpretation / decision-support 계층
- clustering, abnormal return, 모델 학습을 맡는 Python batch compute 계층
- replay와 historical calibration을 맡는 validation 계층
- desktop sidecar와 local API
- NAS PostgreSQL, snapshot, DuckDB, local cache로 이루어진 저장 계층

## 현재 실행 경계

### TypeScript가 맡는 영역

- 브라우저 UI와 workspace shell
- API handler와 server surface
- feed orchestration, scheduler, ingestion
- desktop orchestration과 local sidecar wiring

### Python이 맡는 영역

- canonical-event clustering
- abnormal-return analytics
- model training과 comparison
- 앞으로 옮길 CPU-bound finance / clustering / simulation 작업

### Rust가 맡는 영역

- Tauri 런타임과 네이티브 데스크톱 생명주기

핵심은 제품 표면은 TypeScript에 두고, 무거운 배치 계산은 Python으로 이동시키는 것입니다.

## 현재 데이터-의사결정 흐름

1. raw feed와 structured source를 수집하고 정규화합니다
2. canonical event 계층에서 관련 evidence를 하나의 event 단위로 묶습니다
3. interpretation 서비스가 theme brief, proposal, operator context를 만듭니다
4. Python batch compute가 reusable 결과를 PostgreSQL에 기록합니다
5. replay와 historical validation이 live logic의 calibration을 점검합니다

중요한 설계 변화는 두 가지입니다.

- raw row를 더 이상 최종 signal object로 취급하지 않습니다
- heavy compute를 더 이상 handwritten Node loop에 묶어두지 않습니다

## 참고 문서

- [아키텍처 심화](https://github.com/cheesss/lattice-current/blob/main/docs/ARCHITECTURE.md)
- [계산 언어 마이그레이션 계획](https://github.com/cheesss/lattice-current/blob/main/docs/COMPUTE_LANGUAGE_MIGRATION_PLAN_2026-04-11.md)
- [데스크톱 런타임](https://github.com/cheesss/lattice-current/blob/main/docs/DESKTOP_APP.md)
- [과거 데이터 소스](https://github.com/cheesss/lattice-current/blob/main/docs/historical-data-sources.md)

## 공개 경계

이 사이트는 아키텍처 결정과 주요 흐름을 설명하지만 비공개 운영 절차, 시크릿, 민감한 배포 세부는 제외합니다.
