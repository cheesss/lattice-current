# Lattice Agent Rules

## Response Rules

- If the user prompt is Korean, answer in Korean only.
- Do not mix Hindi, Hinglish, or casual English into Korean replies.
- For OpenClaw and Lattice operations, use concise operator Korean: status, evidence, next action.
- If a tool result is in English, translate the conclusion to Korean and keep source names, identifiers, paths, and URLs unchanged.

## Repository Rules

- Preserve existing user edits. Do not revert unrelated files.
- Prefer `rg` for search and focused tests for validation.
- Use the NAS PostgreSQL runtime helpers instead of hard-coded database credentials.
- Treat source ingestion and approval as an operator workflow: probe, repair, dry-run, approve, register, seed, then verify active registry state.
- Do not mark skipped or low-quality source execution as `executed`; keep it `needs-fix` or `rejected`.
- Keep recurring or remote agent prompts compact. Do not inject raw logs, full snapshots, or large assistant transcripts into OpenClaw context.
- Before and after starting or stopping Lattice/OpenClaw services, inspect Node, npm, Vite, sidecar, scheduler, and OpenClaw processes. Stop stale duplicate agent/job processes, but keep the active service set required for the current task.

## Project Context

`lattice-current-fix`는 지정학적 뉴스와 이벤트 신호를 분석해 테마, 소스, 시장 신호, 투자 아이디어를 운영 대시보드로 연결하는 플랫폼이다.

핵심 파이프라인:

```text
GDELT/RSS/소스 수집 -> 클러스터링 -> 소스 신뢰도 평가 -> 이벤트-시장 전파 모델링
-> 투자 아이디어 생성 -> 게이트 판단 -> 포트폴리오/브리프/Decision Inbox
```

중요 파일:

- 투자 아이디어 생성/판단: `src/services/investment/idea-generator.ts`
- 소스 신뢰도 계산: `src/services/source-credibility.ts`
- 포지션 규칙: `src/services/investment/constants.ts`
- Adaptive 파라미터: `src/services/investment/adaptive-params/`
- 백테스트 오케스트레이터: `src/services/historical-intelligence.ts`
- 포트폴리오 회계: `src/services/portfolio-accounting.ts`
- 포지션 사이저: `src/services/investment/position-sizer.ts`
- 이벤트-시장 전파: `src/services/event-market-transmission.ts`
- OpenClaw Lattice 플러그인: `plugins/openclaw-lattice-control-plane/`
- 소스 수리/검증 루프: `scripts/_shared/source-repair.mjs`, `scripts/run-source-repair-closed-loop.mjs`

## Coding Rules

- TypeScript 변경은 가능한 한 `npx tsc --noEmit` 또는 해당 패키지 `tsconfig`로 확인한다.
- 한 파일에서 발견한 패턴이 다른 실행 경로에도 있으면 관련 경로를 같이 점검한다.
- 매직넘버는 named constant 또는 데이터 기반 설정으로 옮긴다.
- 자명한 주석은 추가하지 않는다. 복잡한 분기나 운영 안전장치만 짧게 설명한다.
- 요청 범위 밖 리팩터링은 피한다. 단, 안전성/데이터 정합성 회귀를 막는 최소 변경은 같이 처리한다.
- FRED_API_KEY, NAS DB credential, gateway token 같은 비밀값은 코드나 문서에 하드코딩하지 않는다.

## Useful Commands

```powershell
npx tsc --noEmit
node --import tsx --test tests/openclaw-plugin-control-plane.test.mjs
node --import tsx --test tests/source-repair.test.mjs tests/source-repair-closed-loop.test.mjs
node scripts/run-source-repair-closed-loop.mjs --limit 10
openclaw health --json
openclaw sessions --agent lattice-ops --json
```

운영 프로세스 점검:

```powershell
Get-CimInstance Win32_Process -Filter "name = 'node.exe' or name = 'cmd.exe'" |
  Select-Object ProcessId,Name,CommandLine |
  Sort-Object ProcessId |
  Format-Table -Wrap -AutoSize
```

## Documentation Sync Rule

When changing user-visible behavior, feature scope, architecture, API, storage, replay/backtest flow, UI navigation, or public policy, update the relevant docs in the same turn.

This rule applies to changes under:

- `src/`
- `src-tauri/`
- `server/`
- `scripts/`
- `plugins/`
- `docs/`
- `site/`

Required actions:

1. Identify affected public-facing pages under `site/` and reference docs under `docs/`.
2. Update at least one applicable feature, architecture, algorithm, API, update, legal, or policy page.
3. If navigation or information architecture changes, update `site/.vitepress/config.mts`.
4. If screenshots, diagrams, or interactive docs components are affected, update those assets or components.
5. Run `npm run docs:build` before finishing when docs changed.
6. If the change is intended for the public site, run `npm run public:sync`.
7. In the final response, list the docs files that were updated.

If a change has no public documentation impact, state why in the final response.
