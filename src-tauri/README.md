# `src-tauri` Guide

이 디렉터리는 데스크톱 패키징과 로컬 실행 shell이다.

## 역할

- Tauri 윈도우와 메뉴 관리
- OS keyring 연동
- 로컬 sidecar child process 구동/종료
- 브라우저가 못 하는 로컬 기능 bridge

## 핵심 파일

- [src/main.rs](C:\Users\chohj\Documents\Playground\lattice-current-fix\src-tauri\src\main.rs)
  - desktop bootstrap
- [sidecar/local-api-server.mjs](C:\Users\chohj\Documents\Playground\lattice-current-fix\src-tauri\sidecar\local-api-server.md)
  - local control plane

## 설계 포인트

- 브라우저 모드와 데스크톱 모드는 같은 UI를 공유하지만 secret source가 다를 수 있다.
- `main.rs`는 지원 secret key allowlist를 알고 있어야 settings 저장이 된다.
- 따라서 새 runtime secret를 추가할 때
  - `runtime-config.ts`
  - `settings-*`
  - `main.rs`
  - sidecar allowlist
를 같이 수정해야 한다.

