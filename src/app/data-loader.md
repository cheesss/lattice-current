# `data-loader.ts`

## 역할

이 파일은 앱의 실질적인 수집 파이프다. 각 패널이 쓰는 뉴스, 시장, 사건, 경보, 공급망, 투자, 운영 데이터를 fetch하고 공용 `AppContext`에 적재한다.

## 내부 구조

- 외부 소스별 fetch 함수 호출
  - RSS/카테고리 뉴스
  - 시장 가격/지표
  - ACLED/GDELT/UCDP/UNHCR 등 conflict/displacement 계열
  - OpenSky/AIS/military 계열
  - 투자/백테스트 관련 intelligence snapshot
- 결과를 패널 인스턴스에 전달
- intelligence fabric 및 persistent cache 갱신

## 중요한 알고리즘적 특징

- 단순 fetch 모음이 아니다.
- 아래 후처리가 포함된다.
  - 뉴스 분류 및 채널 라우팅
  - `clusterNews()` 기반 event clustering
  - source credibility / transmission / ontology / investment intelligence recompute
  - stale cache hydrate 및 persisted intelligence fabric 복원
  - circuit breaker / cooldown을 고려한 graceful degradation

## 에이전트가 이해해야 할 점

- "패널에 데이터가 비어 있음"의 원인이 UI가 아니라 여기일 가능성이 높다.
- 데이터 소스를 추가할 때는
  1. fetch
  2. normalize
  3. context update
  4. optional persistence
  순으로 생각해야 한다.
- 이 파일은 성능 민감하다. 새 provider를 넣을 때 병렬 fanout을 무작정 늘리면 rate limit 문제를 악화시킨다.

