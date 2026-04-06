# `App.ts`

## 이 파일의 역할

`App.ts`는 프런트엔드의 composition root다. 저장된 사용자 상태와 실행 환경을 읽고, 앱 전체를 구동하는 관리자 객체들을 만든다.

## 주요 책임

- variant 전환 시 레이아웃/설정 reset
- 로컬 저장소에서 panel state, map layers, monitor, disabled sources 로드
- desktop/web runtime 차이 반영
- bootstrap 데이터와 초기 위치 정보 연결
- 아래 매니저 생성
  - `PanelLayoutManager`
  - `DataLoaderManager`
  - `EventHandlerManager`
  - `SearchManager`
  - `RefreshScheduler`
  - `DesktopUpdater`

## 내부 알고리즘 관점

- 알고리즘이라기보다 state bootstrap 로직이다.
- 다만 "variant migration"과 "panel order migration"이 포함되어 있어서, 이전 버전 사용자의 저장 상태를 현재 UI 모델에 맞게 자동 보정한다.
- URL state와 local storage state가 충돌하면 URL이 우선한다.

## 에이전트가 수정할 때 주의할 점

- 이 파일은 개별 기능 추가보다 전역 초기화 순서를 바꾸는 곳이다.
- 여기서 잘못 건드리면 패널은 살아 있는데 데이터 로더가 늦게 붙거나, 반대로 sidecar가 준비되기 전에 fetch가 시작될 수 있다.
- 전역 migration key를 추가할 때는 기존 key를 건드리지 말고 새 key를 써야 한다.

