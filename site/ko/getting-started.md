---
title: 시작하기
summary: 앱을 로컬에서 실행하고, 저장소의 공개 표면과 문서 범위를 이해합니다.
status: stable
variants:
  - full
  - tech
  - finance
updated: 2026-03-15
owner: core
---

# 시작하기

## 요구 사항

- Node.js 20+
- npm
- Tauri 아티팩트를 빌드할 경우 선택적 데스크톱 전제 조건

## 로컬 개발

```bash
npm install
npm run dev
```

자주 쓰는 명령:

```bash
npm run dev:tech
npm run dev:finance
npm run typecheck
npm run build
npm run docs:dev
npm run docs:build
```

## 저장소 표면

- `src/`: 프론트엔드와 분석 서비스
- `server/`: 서비스 핸들러와 API
- `src-tauri/`: 데스크톱 런타임과 로컬 sidecar
- `docs/`: 상세 기술 문서와 레퍼런스
- `site/`: GitHub Pages 문서 사이트

## 브랜딩 참고

이 공개 포크의 브랜드는 `Lattice Current`입니다.

다만 코드 경로, 패키지 이름, localStorage 키, proto 패키지 등에는 legacy `worldmonitor` 식별자가 남아 있습니다. 이는 구현 세부와 계승된 구조를 설명하는 이름일 뿐, 이 저장소의 공개 브랜드는 아닙니다.

## 다음 읽을 문서

- [변형](/ko/variants)
- [기능](/ko/features/)
- [아키텍처](/ko/architecture)
- [API](/ko/api)