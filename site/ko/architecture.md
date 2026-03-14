---
title: 아키텍처
summary: 프론트엔드, 서비스, 데스크톱 sidecar, 데이터 흐름, 아카이브 계층.
status: stable
variants:
  - full
  - tech
  - finance
updated: 2026-03-15
owner: core
---

# 아키텍처

## 주요 서브시스템

- 프론트엔드 앱 셸과 패널 시스템
- 도메인 서비스와 분석 모듈
- 데스크톱 sidecar와 로컬 API
- 히스토리컬 리플레이와 아카이브 서비스
- 생성된 서비스 계약과 OpenAPI 표면

## 참고 문서

- [아키텍처 심화](https://github.com/cheesss/lattice-current/blob/main/docs/ARCHITECTURE.md)
- [데스크톱 런타임](https://github.com/cheesss/lattice-current/blob/main/docs/DESKTOP_APP.md)
- [과거 데이터 소스](https://github.com/cheesss/lattice-current/blob/main/docs/historical-data-sources.md)
- [인텔리전스 서버 스키마](https://github.com/cheesss/lattice-current/blob/main/docs/intelligence-server-schema.sql)

## 공개 경계

이 사이트는 아키텍처 결정과 주요 흐름을 설명하지만 비공개 운영 절차, 시크릿, 민감한 배포 세부는 제외합니다.