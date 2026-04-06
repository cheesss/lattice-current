---
title: "2026-03: 리플레이 강화, 저장 라이프사이클, 공개 mock 워크벤치"
summary: 콜드 스타트 대응, 저장 보존 전략, 리플레이 평가 강화, 공개 mock 워크벤치를 문서 사이트에 반영했습니다.
status: stable
variants:
  - full
  - tech
  - finance
updated: 2026-03-29
owner: core
---

# 2026-03: 리플레이 강화, 저장 라이프사이클, 공개 mock 워크벤치

## 변경 사항

- 다음을 포함하는 hot / warm / cold 저장 전략을 문서화했습니다.
  - Redis hot cache
  - PostgreSQL warm retention
  - Parquet / S3 호환 cold archive scaffold
- storage envelope와 schema-version-aware persistence 계약을 추가했습니다.
- 첫 배포 시 너무 비어 보이지 않도록 bootstrap cold-start fallback 데이터와 seed bootstrap 스크립트를 추가했습니다.
- 리플레이 평가를 다음과 같이 강화했습니다.
  - max-hold fallback exit
  - gap marker
  - non-tradable row를 hit-rate 계산에서 제외
- replay frame 병합에서 merge conflict 가시성을 추가해 조용한 데이터 손실을 줄였습니다.
- 로컬 리플레이 persistence를 위해 stale DuckDB lock 자동 정리를 추가했습니다.
- private feed 없이도 과거 데이터 스타일의 UI/UX를 체험할 수 있도록 공개 문서 사이트에 mock replay workbench를 추가했습니다.

## 왜 중요한가

최근 작업으로 플랫폼은 덜 일회용이 되었습니다. bootstrap, replay, review를 위해 모은 데이터가 단순 패널 임시 상태가 아니라 명확한 lifecycle을 갖도록 정리되었습니다.

동시에 replay 지표도 더 정직해졌습니다. 깔끔한 exit가 없으면 그 이유를 남기고, 실행 불가능한 row는 hit-rate 계산에서 제외해 점수를 덜 왜곡합니다.

공개 문서도 더 좋아졌습니다. 이제는 텍스트 설명만 있는 것이 아니라, 실제 제품 표면과 비슷한 mock 시나리오 워크벤치로 흐름을 직접 체험할 수 있습니다.

## 사용자 영향

- 저장, 리플레이, 아카이브 계층의 관계를 더 쉽게 이해할 수 있습니다.
- 첫 배포 직후 완전히 빈 화면만 보는 상황이 줄었습니다.
- 리플레이 지표가 더 현실적인 방향으로 바뀌었습니다.
- private runtime 없이도 공개 사이트에서 시나리오와 replay UX를 확인할 수 있습니다.

## 경계

- 공개 워크벤치는 mock 데이터만 사용합니다.
- cold archive 코드는 scaffold와 테스트까지는 반영됐지만 실제 object store 연결은 배포 환경 의존입니다.
- 온라인 모델 재학습과 중앙 quota 관리까지는 아직 후속 작업입니다.
