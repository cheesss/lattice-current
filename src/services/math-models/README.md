# `src/services/math-models` Guide

이 디렉터리는 투자/신호 해석에서 쓰는 수학 모델 모음이다.

## 파일별 의미

- `hawkes-process.ts`
  - 사건 intensity / self-excitation 추정
- `normalized-mutual-information.ts`
  - 지연 관계를 포함한 신호 결합도
- `transfer-entropy.ts`
  - 방향성 정보 흐름
- `rmt-correlation.ts`
  - 랜덤 매트릭스 기반 correlation denoising
- `contextual-bandit.ts`
  - 팔별 온라인 점수/불확실성 추정
- `regime-model.ts`
  - 테마가 어느 macro regime에서 더 잘 먹히는지 multiplier 계산
- `kalman-filter.ts`
  - noisy 시계열 smoothing
- `truth-discovery.ts`
  - 상충 출처 간 합의 추정

## 설계 원칙

- 이 모델들은 독립적 alpha generator가 아니라, `investment-intelligence.ts`의 점수 항으로 들어간다.
- 따라서 단일 모델 성능보다 "다른 penalty와 합쳤을 때의 안정성"이 중요하다.

