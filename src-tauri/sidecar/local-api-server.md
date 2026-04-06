# `local-api-server.mjs`

## 역할

브라우저/데스크톱이 공통으로 호출하는 local HTTP API 서버다.

## 주요 책임

- secret allowlist 기반 env sync
- secret live verification
- historical import / replay / walk-forward trigger
- scheduler trigger
- intelligence archive read/write
- local ops snapshot 제공
- local fabric cache 제공

## 중요한 내부 메커니즘

### 1. IPv4 fetch override
- 일부 정부/공공 API가 IPv6에서 timeout이 나므로, global fetch를 IPv4 우선으로 감싼다.

### 2. env allowlist
- 임의 env write를 막고 허용된 secret key만 반영한다.

### 3. DuckDB path lock
- replay/scheduler 동시 실행으로 archive가 깨지는 걸 막기 위해 path-level lock을 둔다.

### 4. balanced replay frame loading
- 수동 replay에서 최근 프레임을 전역 latest N으로만 자르면 이벤트 데이터셋이 가격 데이터셋에 밀릴 수 있다.
- 최근 수정으로 dataset별로 균형 있게 프레임을 모아서 replay한다.

### 5. corrupt archive recovery
- DuckDB WAL이 망가진 경우 corrupt backup을 남기고 새 DB로 복구할 수 있다.

## 에이전트가 수정할 때

- 이 파일은 너무 많은 기능을 갖고 있다.
- route 추가 시
  - auth requirement
  - traffic logging
  - CORS
  - module cache invalidation
를 같이 봐야 한다.

