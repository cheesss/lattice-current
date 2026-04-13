---
title: 시작하기
summary: shell을 로컬에서 실행하고, Python compute 설정과 현재 실행 경계를 이해합니다.
status: stable
variants:
  - full
  - tech
  - finance
updated: 2026-04-12
owner: core
---

# 시작하기

## 요구 사항

- Node.js 20+
- npm
- batch compute 스크립트를 돌릴 경우 Python 3.11+
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

## 선택적 Python compute 설정

이 저장소는 CPU-bound 스크립트를 Python으로 옮기는 compute lane을 포함합니다.

```bash
python -m pip install -r scripts/requirements-compute.txt
```

유용한 dry-run 명령:

```bash
npm run canonical:build -- --dry-run
npm run returns:abnormal -- --dry-run
```

이 스크립트들은 계산 결과를 PostgreSQL에 기록하고, TypeScript UI와 API는 그 결과를 읽는 구조입니다.

## 저장소 표면

- `src/`: 프론트엔드와 분석 서비스
- `server/`: 서비스 핸들러와 API
- `src-tauri/`: 데스크톱 런타임과 로컬 sidecar
- `scripts/`: 수집, 오케스트레이션, Python-first batch compute 엔트리포인트
- `docs/`: 상세 기술 문서와 레퍼런스
- `site/`: GitHub Pages 문서 사이트

## 현재 실행 분리

- **TypeScript**: UI, API, scheduler, ingestion, desktop orchestration
- **Python**: canonical-event clustering, abnormal return, 모델 학습
- **Rust**: Tauri 런타임

## 브랜딩 참고

이 공개 포크의 브랜드는 `Lattice Current`입니다.

다만 코드 경로, 패키지 이름, localStorage 키 등에는 legacy `worldmonitor` 식별자가 일부 남아 있습니다. 이는 구현 세부와 계승된 구조를 설명하는 이름일 뿐, 공개 브랜드는 아닙니다.

## 다음 읽을 문서

- [변형](/ko/variants)
- [기능](/ko/features/)
- [아키텍처](/ko/architecture)
- [API](/ko/api)
