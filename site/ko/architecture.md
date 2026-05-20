---
title: 아키텍처
summary: operator shell, canonical event layer, evidence-first report, TypeScript/Python runtime boundary, storage flow.
status: stable
variants:
  - full
  - tech
  - finance
updated: 2026-05-10
owner: core
---

# 아키텍처

<p class="lc-section-caption">
Lattice는 하나의 operator shell 안에서 live signal, theme brief, evidence review, report memo, source-query/backfill task, validation diagnostic을 연결합니다.
</p>

<ScrollSignalStory locale="ko" />

<SystemTopology locale="ko" />

## 주요 서브시스템

- `event-dashboard.html` 중심의 operator shell과 panel system
- feed, macro, market, structured event source를 수집하는 ingestion / normalization 계층
- raw article row를 reusable signal object로 묶는 canonical event layer
- brief, proposal, approval, diagnostics를 만드는 interpretation / decision-support 계층
- client memo, audit appendix, exhibit, validation, source-query/backfill task를 분리하는 evidence-first report pipeline
- clustering, abnormal return, model training을 담당하는 Python batch compute lane
- replay와 historical calibration을 담당하는 validation 계층
- desktop sidecar와 local API
- NAS PostgreSQL, snapshot, DuckDB, local cache 기반 storage envelope

## 런타임 경계

### TypeScript

- browser UI와 workspace shell
- API handler와 server surface
- feed orchestration, scheduler, ingestion
- desktop orchestration과 local sidecar wiring
- report bundle, compiler, validator, quality gate

### Python

- canonical-event clustering
- abnormal-return analytics
- model training과 comparison
- future CPU-bound finance, clustering, simulation 작업

### Rust

- Tauri runtime과 native desktop lifecycle

이 구조는 제품 표면과 orchestration을 TypeScript에 두고, 무거운 batch compute는 Python으로 분리합니다.

## 데이터에서 의사결정까지

1. raw feed와 structured source를 수집하고 정규화합니다.
2. canonical event layer가 관련 evidence를 reusable event 단위로 묶습니다.
3. interpretation service가 theme brief, proposal, operator context를 만듭니다.
4. report service가 evidence bundle, signal card, analyst synthesis, long-form memo, exhibit, audit appendix를 생성합니다.
5. Python batch compute가 reusable 결과를 PostgreSQL에 기록합니다.
6. replay와 historical validation이 live logic의 calibration을 평가합니다.

중요한 설계 원칙은 raw row를 최종 signal로 취급하지 않고, LLM/Codex 문장을 source of truth로 쓰지 않는 것입니다.

## Evidence-first report boundary

리포트는 저장된 evidence, metric, market reaction, caveat, figure spec에서 컴파일됩니다.

```text
DB/API/cache data
-> evidence bundle
-> deep research packs
-> signal cards
-> analyst synthesis
-> semantic narrative blueprint
-> long-form client memo
-> validator and quality gates
-> source-query/backfill tasks
```

Client memo는 사람이 읽는 분석 레이어입니다. provenance, raw ledger, query manifest, claim/evidence/metric/figure ID는 audit appendix에 남깁니다.

품질도 분리합니다. artifact와 triage usefulness는 S가 될 수 있지만, direct transcript coverage, controlled market validation, causal mechanism support가 부족하면 investment readiness는 C로 남아야 합니다.

## 참고 문서

- [Architecture deep dive](https://github.com/cheesss/lattice-current/blob/main/docs/ARCHITECTURE.md)
- [Intelligence report generator](https://github.com/cheesss/lattice-current/blob/main/docs/INTELLIGENCE_REPORT_GENERATOR_PLAN_2026-05-06.md)
- [Report output layer](https://github.com/cheesss/lattice-current/blob/main/docs/REPORT_OUTPUT_LAYER_OVERHAUL_2026-05-09.md)
- [Desktop runtime](https://github.com/cheesss/lattice-current/blob/main/docs/DESKTOP_APP.md)
- [Historical data sources](https://github.com/cheesss/lattice-current/blob/main/docs/historical-data-sources.md)

## 공개 경계

이 사이트는 아키텍처 결정과 주요 흐름을 설명하지만, 비공개 운영 소스, secret, 배포 토큰, 민감한 provider 설정은 포함하지 않습니다.
