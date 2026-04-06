# Automation / RAG Implementation Log

작성일: 2026-04-01

## 목적

이 문서는 `AUTOMATION_RAG_REFACTOR_PLAN_2026-04-01.md`의 실행 결과를 기록하는 구현 로그다.

이번 로그는 1차 구현 범위를 다룬다.

- 매직넘버 일부 외부화
- replay/backtest 핵심 heuristic 설정화
- Codex proposer prompt grounding 도입

## 이번 변경 요약

이번 사이클의 목표는 "계획 전체를 한 번에 끝내는 것"이 아니라, 다음 단계 구현의 기반을 먼저 안정적으로 만드는 것이었다.

핵심 결과:

1. 신규 설정 파일 추가
2. theme discovery의 핵심 threshold를 설정화
3. replay/backtest의 핵심 heuristic 일부를 설정화
4. Codex theme / candidate / dataset proposer에 evidence 주입 경로 추가
5. automation orchestrator에서 evidence builder를 실제로 연결

## 신규 파일

### [intelligence-tuning.ts](C:\Users\chohj\Documents\Playground\lattice-current-fix\src\config\intelligence-tuning.ts)

추가된 설정 묶음:

- `THEME_DISCOVERY_TUNING`
- `BACKTEST_REPLAY_TUNING`
- `CODEX_PROPOSAL_TUNING`

목적:

- 로직 내부 inline 수치를 1차적으로 설정 파일로 이동
- 이후 env override 또는 실험용 config override가 가능하도록 기반 마련

### [proposal-evidence-builder.ts](C:\Users\chohj\Documents\Playground\lattice-current-fix\src\services\server\proposal-evidence-builder.ts)

추가된 builder:

- `buildThemeProposalEvidence()`
- `buildCandidateProposalEvidence()`
- `buildDatasetProposalEvidence()`

목적:

- Codex proposer가 현재 queue item 또는 gap만 보지 않고
  - historical analog
  - weakness signal
  - coverage signal
를 함께 prompt context로 받도록 구조화

## 수정 파일

### [theme-discovery.ts](C:\Users\chohj\Documents\Playground\lattice-current-fix\src\services\theme-discovery.ts)

변경 내용:

- token 최소 길이 설정화
- 긴 token 최소 길이 설정화
- known-theme overlap reject 기준 설정화
- queue signal floor 설정화
- sample/source/region/overlap weight 설정화
- 기본 minSamples / minSources / maxQueueItems 설정화

영향:

- discovery tuning을 코드 수정 없이 조절할 수 있는 기반이 생김
- semantic discovery를 추가할 때 lexical layer와 병렬 유지가 쉬워짐

### [historical-intelligence.ts](C:\Users\chohj\Documents\Playground\lattice-current-fix\src\services\historical-intelligence.ts)

변경 내용:

- `MAX_HORIZON_CANDIDATES` 설정화
- dedupe cooldown 범위 설정화
- conviction dedupe tolerance 설정화
- entry lookahead 최소치 설정화
- exit lookahead 최소치 설정화
- series lookahead 범위 설정화
- target return 계산 파라미터 설정화
- trailing stop 계산 파라미터 설정화
- max hold 시간 설정화
- risk-adjusted denominator floor 설정화

영향:

- backtest 결과를 크게 좌우하는 핵심 숫자들이 한 군데로 모이기 시작함
- 이후 실험 자동화와 score provenance 도입이 쉬워짐

### [codex-theme-proposer.ts](C:\Users\chohj\Documents\Playground\lattice-current-fix\src\services\server\codex-theme-proposer.ts)

변경 내용:

- `ProposalEvidenceBundle` 입력 지원
- prompt에 evidence summary / historical analogs / weakness signals / coverage signals 포함

영향:

- theme proposer가 queue item만 보는 구조에서 evidence-grounded prompt 구조로 이동

### [codex-candidate-proposer.ts](C:\Users\chohj\Documents\Playground\lattice-current-fix\src\services\server\codex-candidate-proposer.ts)

변경 내용:

- `ProposalEvidenceBundle` 입력 지원
- coverage gap / top mappings 외에 추가 evidence를 prompt에 포함

영향:

- candidate expansion이 replay weakness와 analog evidence를 반영할 기반 확보

### [codex-dataset-proposer.ts](C:\Users\chohj\Documents\Playground\lattice-current-fix\src\services\server\codex-dataset-proposer.ts)

변경 내용:

- `ProposalEvidenceBundle` 입력 지원
- dataset proposer prompt에 evidence summary / weakness / coverage / analog 정보 포함

영향:

- dataset proposal relevance를 더 높일 수 있는 기반 확보

### [intelligence-automation.ts](C:\Users\chohj\Documents\Playground\lattice-current-fix\src\services\server\intelligence-automation.ts)

변경 내용:

- theme promotion 호출 시 theme evidence builder 연결
- candidate expansion 호출 시 candidate evidence builder 연결
- dataset discovery Codex proposal 호출 시 dataset evidence builder 연결

영향:

- evidence builder가 dead code가 아니라 실제 automation cycle에 들어감

## 검증

실행한 검증:

```powershell
npx tsc --noEmit --pretty false
```

결과:

- 통과

추가로 대상 모듈 import smoke test도 수행했다.

## 이번 단계에서 하지 않은 것

이번 사이클에서는 아래 항목은 의도적으로 보류했다.

- semantic retrieval 기반 theme discovery 구현
- vector search를 automation discovery loop에 직접 연결
- point-in-time safe historical retrieval service 구현
- admission gate에 retrieval score 직접 반영
- score breakdown persistence 추가

이유:

- 먼저 설정 외부화와 proposer grounding 기반을 만드는 것이 리스크가 낮고 후속 작업의 결합 비용을 줄이기 때문이다.

## 다음 구현 우선순위

다음 단계는 아래 순서를 권장한다.

1. semantic theme discovery layer 추가
2. PIT-safe historical retrieval 계층 추가
3. Codex proposer에 실제 retrieval evidence 주입
4. proposal score breakdown persistence
5. admission / replay adaptation에 retrieval telemetry 추가

## 리스크 메모

이번 변경은 구조적 리스크가 낮은 편이지만, 다음 점은 유의해야 한다.

- 설정 파일이 늘어나면서 threshold provenance 문서화가 필요해짐
- evidence builder가 아직 retrieval engine과 직접 연결된 것은 아님
- heuristic 외부화는 1차만 끝났고, score 함수 내부 숫자는 여전히 다수 남아 있음

## 결론

이번 구현은 "자동화/RAG 리팩터 계획의 기반 공사"에 해당한다.

실질적으로 달라진 점은:

- tuning 대상 숫자의 일부가 코드 밖으로 이동했고
- Codex proposer가 evidence를 받을 수 있는 구조가 생겼으며
- automation orchestrator가 이 구조를 실제로 사용하기 시작했다는 점이다.

다음 단계부터는 semantic retrieval과 PIT-safe historical RAG를 실제 discovery/backtest loop에 붙이는 작업으로 넘어갈 수 있다.
