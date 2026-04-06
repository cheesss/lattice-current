# `event-handlers.ts`

## 역할

앱에서 클릭, 키보드, 허브 열기/닫기, 링크 복사, theme 전환, TV 모드, 지도 관련 사용자 조작을 실제 동작으로 연결한다.

## 왜 중요한가

- UI는 `panel-layout.ts`가 그리지만, 실제로 움직이게 하는 건 이 파일이다.
- 허브 버튼이 눌리지 않거나, active 상태가 안 맞거나, workspace가 바뀌어도 화면이 안 바뀌는 문제는 대부분 여기서 난다.

## 주요 흐름

- 헤더 버튼 -> 허브 오픈/클로즈
- `wm:open-hub`, `wm:hub-visibility` 같은 window 이벤트 -> 허브 동기화
- `Ctrl+K`, fullscreen, idle pause, TV mode 단축키
- storage event -> 다른 창에서 바뀐 runtime state 반영

## 알고리즘적 포인트

- 이벤트 위임과 전역 custom event를 같이 쓴다.
- 허브 활성 상태는 단일 boolean이 아니라,
  - 실제 overlay visibility
  - header quicknav active state
  - body class(`hub-active`)
  세 가지를 동기화하는 형태다.

## 수정 시 주의

- 허브 버튼 ID를 바꾸면 여기 binding도 같이 바꿔야 한다.
- 전역 이벤트 추가 시 `destroy()`에서 listener 해제를 꼭 넣어야 한다.

