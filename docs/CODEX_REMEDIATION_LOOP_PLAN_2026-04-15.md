# Codex Remediation Loop — 구현 계획

> **Status**: active (runtime feedback loop implementation in progress; core wiring shipped in commit `19dd486a`)

Date: 2026-04-15  
Prerequisite: Decision Inbox 결과 배너(EXECUTED/SKIPPED/FAILED) 구현 완료

---

## 현재 완료된 것

- Decision Inbox `Accept/Reject/Snooze` 클릭 후 `EXECUTED / SKIPPED / REJECTED / ALREADY FINAL / FAILED` 배너가 preview에 표시됨
- `renderInboxActionResult()` 함수에서 proposal/approval 타입별 분기 처리됨
- 백엔드 `POST /api/approval-queue/{id}/review` 에 `dryRun: true` 파라미터 이미 구현됨 (`event-dashboard-api.mjs` line 1794)
- `scripts/_shared/alert-notifier.mjs` — `data/alerts.json` 구조화 알림 기록 존재

## 미완성인 것 (이 계획의 대상)

1. UI에 Simulate 버튼 없음 (dryRun 백엔드는 있지만 UI 진입점 없음)
2. `inboxBulkAction` catch 블록이 `catch {}` — 실패를 삼킴
3. 런타임 이슈 엔벨로프 캡처 시스템 없음
4. 클라이언트 액션 트레이스 없음
5. Codex 조사 패킷 생성기 없음
6. Route/Surface 맵 없음

---

## Step 1: Simulate 버튼 추가 (dryRun preflight)

**파일**: `event-dashboard.html`  
**대상 함수**: `renderInboxPreview()`, `inboxAction()`

**변경 내용**:
- approval 타입 아이템의 버튼 행에 `Simulate` 버튼 추가
- `inboxAction('simulate', id)` 호출 → `dryRun: true` 포함해서 API 전송
- 결과를 `renderInboxActionResult()` 의 `SIMULATED` 톤으로 표시 (배너 색상: 파란색, 라벨: `DRY RUN`)
- 버튼은 approval 타입에만 표시, proposal/triage/e2-signal에는 표시 안 함

**예상 결과**:
```
[Simulate] → POST /api/approval-queue/{id}/review { dryRun: true }
→ 배너: [DRY RUN] Feed: flightradar24 / Quality: 0.31 / Expected: skipped (quality threshold)
```

**Codex 프롬프트 (Step 1)**:

```
You are modifying event-dashboard.html in the Lattice Current project.

CURRENT STATE:
- File: event-dashboard.html
- The function renderInboxPreview() at approximately line 1740 renders a preview panel for a selected inbox item.
- Approval-type items currently show three buttons: Accept (1), Snooze (2), Reject (3).
- The function inboxAction(decision, id) at line 1871 handles button clicks.
- For approval items, it calls POST /api/approval-queue/{rawId}/review with body { decision, reviewer: 'theme-dashboard' }.
- The backend already supports a dryRun parameter: when dryRun is true, the executor runs all checks but does NOT write to the database or register the source. This is confirmed at event-dashboard-api.mjs line 1794.
- There is NO Simulate button in the UI yet.

WHAT YOU MUST DO:
1. In the renderInboxPreview() function, find the section that renders buttons for approval-type items. Add a "Simulate" button BEFORE the Accept button. The button should have class "inbox-btn inbox-btn-snooze" (reuse the snooze style, color blue if possible) and onclick="inboxAction('simulate', '${escapeHtml(item.id)}')".

2. In the inboxAction(decision, id) function, add a branch: if the resolved decision is 'simulate' (or if the original decision === 'simulate'), call POST /api/approval-queue/{rawId}/review with body { decision: 'accept', reviewer: 'theme-dashboard', dryRun: true }. Do NOT remove the item from inboxItems (since it was not actually executed). Show the result banner with label 'DRY RUN' and tone 'info' (use class "trust-chip-nohydrate" or similar muted class).

3. In renderInboxActionResult(), add a branch for dryRun results: if response?.dryRun === true, set label = 'DRY RUN', tone = 'info', copy = 'Simulation only — no changes were made. ' + (execution?.summary || '').

CONSTRAINTS:
- Do NOT touch any code outside renderInboxPreview(), inboxAction(), and renderInboxActionResult().
- Do NOT remove or reorder the existing Accept/Snooze/Reject buttons.
- The Simulate button must only appear for items where item.type === 'approval'. Do not add it for proposal, triage, or e2-signal types.
- Do not add a Simulate button to the bulk action bar.
- Keep existing escapeHtml() usage consistent.

DELIVERABLE:
Show the exact diff (old → new) for each of the three functions modified. Include the full function if it is under 30 lines, or the surrounding 10 lines if larger.
```

---

## Step 2: inboxBulkAction Silent Catch 제거

**파일**: `event-dashboard.html`  
**위치**: `inboxBulkAction()` line 1941 — `try { await inboxAction(...) } catch {}`

**변경 내용**:
```javascript
// 기존:
try { await inboxAction(decision, id); } catch {}

// 변경:
try { await inboxAction(decision, id); } catch (e) {
  console.warn('[BulkAction] item failed:', id, e?.message || e);
}
```

**Codex 프롬프트 (Step 2)**:

```
You are making a minimal fix to event-dashboard.html in the Lattice Current project.

CURRENT STATE:
- File: event-dashboard.html
- Function: inboxBulkAction(decision) at approximately line 1933.
- Inside the for loop, there is a try/catch block:
    try { await inboxAction(decision, id); } catch {}
- The empty catch block silently swallows all failures. If one item in a bulk action fails (e.g., network error, 500 response), there is no trace of the failure anywhere.

WHAT YOU MUST DO:
Replace the empty catch block with:
    } catch (e) {
      console.warn('[BulkAction] item failed silently:', id, String(e?.message || e));
    }

This is a one-line change. Do not modify any other code in this function or elsewhere.

DELIVERABLE:
Show the exact before/after lines (3 lines of context on each side).
```

---

## Step 3: Runtime Issue Envelope Writer

**파일**: `scripts/_shared/runtime-issue-writer.mjs` (신규)

**역할**: 런타임 이슈 발생 시 구조화된 JSON을 `data/runtime-issues/YYYY-MM-DD/` 에 저장

**인터페이스**:
```javascript
export async function captureRuntimeIssue(envelope) {
  // envelope: { surface, action, itemType, itemSubtype, itemId, theme,
  //             apiRoute, requestBody, responseStatus, responseBody,
  //             errorMessage, classification, severity }
  // → data/runtime-issues/2026-04-15/runtime-issue-{uuid}.json 저장
  // → 파일명에 타임스탬프 포함
  // → returns { path, id }
}

export function classifyIssue(surface, action, responseStatus, errorMessage) {
  // 문서 §5 분류 기준으로 자동 분류
  // returns: 'ui-wiring' | 'api-contract' | 'action-semantics' |
  //          'data-continuity' | 'freshness-trust' | 'external-dependency' | 'performance'
}
```

**Codex 프롬프트 (Step 3)**:

```
You are creating a new file: scripts/_shared/runtime-issue-writer.mjs in the Lattice Current project.

CONTEXT:
The project already has scripts/_shared/alert-notifier.mjs which saves structured JSON to data/alerts.json. The pattern there is: load existing file → push new entry → write back. Use the same file-write pattern (Node.js fs module, synchronous readFileSync/writeFileSync). The project uses ES modules (import/export, not require/module.exports).

PURPOSE:
When a Decision Inbox action fails at runtime (network error, 500, unexpected response shape, etc.), we need to capture a structured issue envelope to a local JSON file so a Codex/Claude agent can later diagnose and propose a fix.

WHAT YOU MUST BUILD:

1. Function: captureRuntimeIssue(envelope)
   - envelope is a plain object with these fields (all optional except surface and action):
     { surface, action, itemType, itemSubtype, itemId, theme, url, apiRoute,
       requestBody, responseStatus, responseBody, errorMessage, consoleErrors,
       classification, severity, safeRemediation }
   - Generate a unique id: 'runtime-issue-' + Date.now() + '-' + Math.random().toString(36).slice(2,8)
   - Add createdAt: new Date().toISOString()
   - Write to: data/runtime-issues/YYYY-MM-DD/{id}.json
     where YYYY-MM-DD is today in local time
   - Create the directory with mkdirSync({ recursive: true }) if it does not exist
   - Return { id, path }
   - If file write fails, log console.warn but do NOT throw (capturing failures must not crash the caller)

2. Function: classifyIssue(surface, action, responseStatus, errorMessage)
   - Returns one of: 'ui-wiring', 'api-contract', 'action-semantics', 'data-continuity', 'freshness-trust', 'external-dependency', 'performance'
   - Classification rules:
     - errorMessage includes 'is not defined' or 'function' → 'ui-wiring'
     - responseStatus 404 or 500 → 'api-contract'
     - errorMessage includes 'RSS' or 'fetch' or '403' or '429' or 'timeout' → 'external-dependency'
     - action includes 'freshness' or 'stale' → 'freshness-trust'
     - action includes 'bulk' → 'action-semantics'
     - Otherwise → 'api-contract'

3. Function: safeToAutoFix(classification)
   - Returns true ONLY for: 'ui-wiring' (trivial badge changes only), 'freshness-trust'
   - Returns false for all others (including external-dependency, api-contract, action-semantics)
   - This implements the Class A / Class B / Class C policy from the project design document

CONSTRAINTS:
- Use only Node.js built-in modules (path, fs, crypto if needed for uuid). Do NOT import any third-party packages.
- The file must be a valid ES module with named exports only (no default export).
- Each issue must be one JSON file per issue (not appended to a single file like alerts.json).
- Do not import from any other project files except you may import { DATA_DIR } from './paths.mjs' if that file exists — if it does not exist, just use path.join('data', 'runtime-issues') directly.
- Maximum file size: ~3KB per issue. Truncate responseBody to 2000 chars if longer.

DELIVERABLE:
The complete file content, ready to copy as-is.
```

---

## Step 4: 클라이언트 액션 트레이스 → Issue Envelope POST

**파일**: `event-dashboard.html`  
**대상**: `inboxAction()` 함수의 catch 블록

**변경 내용**:
현재 catch 블록에서 console.warn만 하는 것을 → API에 POST 해서 서버 측 파일에도 저장하도록 확장

```javascript
// 기존 catch:
} catch (e) {
  console.warn('Inbox action failed:', e);
  const preview = document.getElementById('inbox-preview-content');
  if (preview) preview.innerHTML = renderInboxActionResult(item, resolvedDecision, null, String(e?.message || e));
}

// 변경 catch:
} catch (e) {
  const errorMsg = String(e?.message || e || 'Action failed');
  console.warn('[InboxAction] failed:', { decision, id, error: errorMsg });
  // 비동기 issue envelope 캡처 (실패해도 UI는 영향 없음)
  postJson(`${API}/runtime-issues`, {
    surface: 'decision-inbox',
    action: `approval.${resolvedDecision}`,
    itemType: item?.type,
    itemSubtype: item?.payload?.type || item?.payload?.proposalType,
    itemId: item?.rawId,
    theme: item?.theme,
    apiRoute: item?.type === 'approval'
      ? `/api/approval-queue/${item?.rawId}/review`
      : `/api/codex-proposals/${item?.rawId}/review`,
    requestBody: { decision: resolvedDecision, reviewer: 'theme-dashboard' },
    errorMessage: errorMsg,
    classification: 'api-contract',
    severity: 'review',
  }).catch(() => {}); // 캡처 자체 실패는 무시
  const preview = document.getElementById('inbox-preview-content');
  if (preview) preview.innerHTML = renderInboxActionResult(item, resolvedDecision, null, errorMsg);
}
```

**Codex 프롬프트 (Step 4)**:

```
You are modifying the inboxAction() function in event-dashboard.html (Lattice Current project).

CURRENT STATE:
- File: event-dashboard.html
- Function: inboxAction(decision, id) at approximately line 1871
- The catch block currently does this:
    } catch (e) {
      console.warn('Inbox action failed:', e);
      const preview = document.getElementById('inbox-preview-content');
      if (preview) preview.innerHTML = renderInboxActionResult(item, resolvedDecision, null, String(e?.message || e || 'Action failed'));
    }
- There is a global constant API = 'http://127.0.0.1:46200' (or similar port)
- There is an existing helper function postJson(url, body) that does fetch(url, { method: 'POST', ... })

WHAT IS MISSING:
When an inbox action fails, the error is logged to console but not captured anywhere persistent. A Codex/Claude agent cannot diagnose the issue later because there is no structured record.

WHAT YOU MUST DO:
In the catch block, AFTER the console.warn line and BEFORE the preview innerHTML assignment, add a fire-and-forget call to capture the runtime issue:

    postJson(`${API}/runtime-issues`, {
      surface: 'decision-inbox',
      action: `inbox.${resolvedDecision || decision}`,
      itemType: item?.type || 'unknown',
      itemSubtype: item?.payload?.type || item?.payload?.proposalType || '',
      itemId: String(item?.rawId || id),
      theme: item?.theme || '',
      apiRoute: item?.type === 'approval'
        ? `/api/approval-queue/${item?.rawId || id}/review`
        : item?.type === 'proposal'
          ? `/api/codex-proposals/${item?.rawId || id}/review`
          : `/api/unknown/${item?.rawId || id}`,
      requestBody: { decision: resolvedDecision || decision, reviewer: 'theme-dashboard' },
      errorMessage: String(e?.message || e || 'Action failed'),
      classification: 'api-contract',
      severity: 'review',
    }).catch(() => {});  // capture failure must never crash the UI

The .catch(() => {}) is essential — if the /api/runtime-issues endpoint does not exist yet, this call will fail silently. That is acceptable because the primary concern is the UI user experience, not the capture itself.

CONSTRAINTS:
- Do NOT change the postJson call structure for the actual approval/proposal API calls.
- Do NOT change what gets displayed in the preview panel.
- Do NOT wrap this new postJson call in its own try/catch (the .catch(() => {}) is sufficient).
- The console.warn line must remain exactly as-is.
- This is purely additive — no existing lines should be removed or reordered.

DELIVERABLE:
Show the full catch block before and after the change (all lines, not just the modified lines).
```

---

## Step 5: API Endpoint — POST /api/runtime-issues

**파일**: `scripts/event-dashboard-api.mjs`

**역할**: 클라이언트가 POST로 보낸 이슈 엔벨로프를 받아서 `runtime-issue-writer.mjs`에 위임해 파일 저장

**위치**: 기존 라우트 핸들러 switch 블록 안에 추가

```javascript
// 추가할 라우트:
if (segments[0] === 'api' && segments[1] === 'runtime-issues' && method === 'POST') {
  const { captureRuntimeIssue, classifyIssue } = await import('./_shared/runtime-issue-writer.mjs');
  const classification = body.classification || classifyIssue(
    body.surface, body.action, body.responseStatus, body.errorMessage
  );
  const result = await captureRuntimeIssue({ ...body, classification });
  return { ok: true, id: result.id, path: result.path };
}

// GET 목록:
if (segments[0] === 'api' && segments[1] === 'runtime-issues' && method === 'GET') {
  // data/runtime-issues/ 하위 최근 50개 파일 반환
}
```

**Codex 프롬프트 (Step 5)**:

```
You are adding two API routes to scripts/event-dashboard-api.mjs in the Lattice Current project.

CURRENT STATE:
- File: scripts/event-dashboard-api.mjs
- The file handles HTTP requests by parsing URL segments into an array called `segments` and checking segments[0], segments[1], etc.
- Example existing route pattern (around line 1896):
    if (segments[0] === 'api' && segments[1] === 'codex-proposals' && segments[2] && segments[3] === 'review' && method === 'POST') {
      return await reviewCodexProposal(segments[2], body);
    }
- A new module will exist at scripts/_shared/runtime-issue-writer.mjs with exports: captureRuntimeIssue(envelope), classifyIssue(surface, action, responseStatus, errorMessage)

WHAT YOU MUST ADD:

1. POST /api/runtime-issues route:
   - Condition: segments[0] === 'api' && segments[1] === 'runtime-issues' && !segments[2] && method === 'POST'
   - Import captureRuntimeIssue and classifyIssue from './_shared/runtime-issue-writer.mjs'
   - If body.classification is missing or empty, call classifyIssue(body.surface, body.action, body.responseStatus, body.errorMessage) to auto-classify
   - Call captureRuntimeIssue({ ...body, classification })
   - Return { ok: true, id: result.id, path: result.path }
   - Wrap in try/catch: if it throws, return { ok: false, error: String(err?.message || err) } with HTTP 200 (not 500) — capturing a runtime issue must never itself cause an error response

2. GET /api/runtime-issues route:
   - Condition: segments[0] === 'api' && segments[1] === 'runtime-issues' && !segments[2] && method === 'GET'
   - Read data/runtime-issues/ directory recursively
   - Collect all .json files, sorted by filename descending (newest first)
   - Return the first 50 file contents as an array: { issues: [...], total: N }
   - If the directory does not exist, return { issues: [], total: 0 }
   - Truncate each issue's responseBody field to 500 chars in the response (to keep API response manageable)

CONSTRAINTS:
- Place both new routes BEFORE the final catch-all 404 route.
- Place them AFTER the existing approval-queue routes (to maintain logical grouping).
- Use dynamic import() for the runtime-issue-writer module (not static import at top of file), because this module may not exist yet during development.
- Use Node.js built-in fs/promises for the GET route directory scan.
- Do not modify any existing routes.

DELIVERABLE:
Show the exact code block to insert, with 3 lines of context above showing where to insert it (reference an existing route pattern as anchor).
```

---

## Step 6: Codex 조사 패킷 생성기

**파일**: `scripts/generate-codex-investigation-packet.mjs` (신규)

**역할**: runtime-issue ID를 받아서 → 관련 파일 식별 → 서버 로그 수집 → Codex/Claude에게 보낼 조사 패킷 생성

**호출 방식**:
```bash
node scripts/generate-codex-investigation-packet.mjs --issue-id runtime-issue-1745123456789-abc123
node scripts/generate-codex-investigation-packet.mjs --issue-id runtime-issue-... --send
# --send 없으면 패킷 JSON 출력만, --send 있으면 Claude API 호출
```

**Surface-Route 맵** (`scripts/_shared/surface-route-map.mjs`):
```javascript
export const SURFACE_ROUTE_MAP = {
  'decision-inbox': {
    ui: ['event-dashboard.html'],
    api: ['scripts/event-dashboard-api.mjs'],
    executor: ['scripts/proposal-executor.mjs'],
    state: ['scripts/_shared/approval-queue.mjs'],
  },
  'geo-lens': {
    ui: ['event-dashboard.html', 'event-map-lens.html'],
    map: ['src/theme-map-lens.ts', 'src/components/DeckGLMap.ts'],
    api: ['scripts/event-dashboard-api.mjs'],
  },
  'theme-brief': {
    ui: ['event-dashboard.html'],
    queries: ['scripts/_shared/trend-dashboard-queries.mjs'],
  },
  'ops': {
    ui: ['event-dashboard.html'],
    api: ['scripts/event-dashboard-api.mjs'],
    daemon: ['scripts/master-daemon.mjs'],
  },
};
```

**Codex 프롬프트 (Step 6)**:

```
You are creating two new files in the Lattice Current project:
1. scripts/_shared/surface-route-map.mjs
2. scripts/generate-codex-investigation-packet.mjs

--- FILE 1: surface-route-map.mjs ---

PURPOSE:
A static lookup table that maps each UI surface and API route pattern to the likely source files. This allows the investigation packet generator to automatically identify relevant files without searching the whole codebase.

WHAT YOU MUST BUILD:
Export a constant SURFACE_ROUTE_MAP as a plain object with these keys and their associated file arrays:

'decision-inbox':
  ui: ['event-dashboard.html']
  api: ['scripts/event-dashboard-api.mjs']
  executor: ['scripts/proposal-executor.mjs']
  queue: ['scripts/_shared/approval-queue.mjs']

'geo-lens':
  ui: ['event-dashboard.html', 'event-map-lens.html']
  map: ['src/theme-map-lens.ts', 'src/components/DeckGLMap.ts']
  api: ['scripts/event-dashboard-api.mjs']

'theme-brief':
  ui: ['event-dashboard.html']
  queries: ['scripts/_shared/trend-dashboard-queries.mjs']
  builders: ['scripts/_shared/theme-shell-snapshot-builders.mjs']

'ops':
  ui: ['event-dashboard.html']
  api: ['scripts/event-dashboard-api.mjs']
  daemon: ['scripts/master-daemon.mjs']
  state: ['scripts/_shared/runtime-observability.mjs']

Also export a function getFilesForIssue(issue) that:
- Takes a runtime issue envelope object (with fields: surface, apiRoute, action)
- Returns a deduplicated array of file paths likely relevant to this issue
- Logic: match issue.surface to SURFACE_ROUTE_MAP key → collect all files from all subcategories
- Also: if issue.apiRoute contains 'approval-queue', always include scripts/_shared/approval-queue.mjs
- If issue.apiRoute contains 'codex-proposals', always include scripts/proposal-executor.mjs
- If issue.classification === 'external-dependency', always include scripts/proposal-executor.mjs
- Return at most 8 files (prioritize ui and api first)

--- FILE 2: generate-codex-investigation-packet.mjs ---

PURPOSE:
CLI tool. Reads a runtime issue file, collects context (file excerpts, server log tail, reproduction steps), assembles a compact investigation packet, and optionally sends it to the Claude API for diagnosis.

COMMAND LINE INTERFACE:
  node scripts/generate-codex-investigation-packet.mjs --issue-id <id> [--send] [--dry-run]

Where:
- --issue-id: required. The runtime issue id (e.g. runtime-issue-1745123456789-abc123)
- --send: optional. If present, call Claude API with the packet and print the response
- --dry-run: optional. Print the packet JSON but do not call API

WHAT YOU MUST BUILD:

Step 1: Find the issue file
- Search data/runtime-issues/**/*.json for a file whose JSON has id === the given --issue-id
- If not found, print "Issue not found: {id}" and exit with code 1

Step 2: Build context
- Call getFilesForIssue(issue) from surface-route-map.mjs to get relevant files
- For each file, read the first 100 lines and the last 50 lines (to keep packet small)
  - If file does not exist, note "file not found: {path}"
- Read the last 80 lines of the most recent file in data/backfill-logs/ or data/automation/ (if exists) as server_log
- Format reproduction steps as a numbered list derived from the issue envelope:
  1. Navigate to surface: {issue.surface}
  2. Select item of type: {issue.itemType} / {issue.itemSubtype}
  3. Click action: {issue.action}
  4. API called: {issue.apiRoute} → HTTP {issue.responseStatus}
  5. Error observed: {issue.errorMessage}

Step 3: Assemble packet
Return a JSON object:
{
  "packetVersion": "1",
  "generatedAt": "ISO timestamp",
  "issue": { ...full issue envelope },
  "reproductionSteps": [...],
  "serverLog": "last 80 lines...",
  "sourceFiles": [
    { "path": "event-dashboard.html", "head": "first 100 lines...", "tail": "last 50 lines..." },
    ...
  ],
  "claudePrompt": "..." // see below
}

Step 4: Generate claudePrompt field
The claudePrompt must be a detailed, sentence-form string that a Claude/Codex agent can act on directly. Format:

"You are diagnosing a runtime issue in the Lattice Current project (a news-event-to-asset-reaction analysis platform).

Issue ID: {id}
Surface: {surface}
Action taken by operator: {action}
Item type: {itemType} / {itemSubtype}
API route called: {apiRoute}
HTTP response status: {responseStatus}
Error message observed: {errorMessage}
Classification: {classification}
Automatic fix allowed: {safeRemediation}

Reproduction steps:
{numbered list}

The following source files are likely involved (file heads and tails are included in this packet):
{file list}

Last lines of the server process log:
{serverLog}

Your task:
1. Diagnose the root cause of this failure. Be specific about which file and line is responsible.
2. Propose a concrete fix. Write the exact code change (before → after) with surrounding context.
3. State whether the fix is: (A) safe to apply automatically, (B) requires human review, or (C) must never be auto-applied.
   - Class A (safe): pure UI badge/label changes, adding a null guard, logging improvement.
   - Class B (human review): API response shape change, executor logic change, schema change.
   - Class C (never auto): anything that touches approval execution, source registration, DB destructive writes.
4. If classification is 'external-dependency', do not propose code changes. Instead propose a retry policy or source quality flag.

Do NOT propose changes beyond the minimal fix for this specific issue. Do NOT refactor surrounding code."

Step 5: If --send flag is present
- Import Anthropic SDK: import Anthropic from '@anthropic-ai/sdk'
- Create client: new Anthropic() (uses ANTHROPIC_API_KEY env var)
- Call client.messages.create({ model: 'claude-opus-4-6', max_tokens: 4096, messages: [{ role: 'user', content: packet.claudePrompt }] })
- Print the response text to stdout
- Also save packet + response to data/runtime-issues/{date}/investigation-{issueId}.json

CONSTRAINTS:
- Use only ES modules (import/export).
- Use only Node.js built-ins + @anthropic-ai/sdk (which is already in package.json).
- The packet must never include database passwords, API keys, or .env.local contents.
- Truncate each file head/tail to 5000 chars if longer.
- Handle all file read errors gracefully (note the error in the packet, do not crash).
- When --dry-run is set, print the packet JSON with JSON.stringify(packet, null, 2) and exit before any API call.

DELIVERABLE:
The complete content of both files, ready to copy as-is.
```

---

## Step 7: Playwright 스모크 테스트 (Phase 3 선행 조건)

**파일**: `tests/smoke/inbox-actions.spec.mjs` (신규)

**커버 범위**:
1. surface 전환 (Home → Inbox → Investigate → Geo → Ops)
2. Approval Accept dry-run (Simulate 버튼)
3. Action result 배너 표시 확인
4. 혼합 타입 bulk 선택 시 무효 버튼 비활성화
5. Stale/Fallback 배지 visible 상태

---

## 작업 순서

| 순서 | 작업 | 파일 수 | Codex 사용 여부 |
|------|------|---------|----------------|
| 1 | Simulate 버튼 추가 | 1 (event-dashboard.html) | Codex로 패치 생성 → 사람 리뷰 후 적용 |
| 2 | BulkAction catch 수정 | 1 | 직접 수정 (1줄) |
| 3 | runtime-issue-writer.mjs 생성 | 1 (신규) | Codex로 생성 |
| 4 | inboxAction catch 확장 | 1 (event-dashboard.html) | Codex로 패치 생성 |
| 5 | /api/runtime-issues 엔드포인트 추가 | 1 (event-dashboard-api.mjs) | Codex로 패치 생성 |
| 6 | surface-route-map.mjs + 패킷 생성기 | 2 (신규) | Codex로 생성 |
| 7 | Playwright 스모크 | 1 (신규) | Codex로 생성 |

---

## Class A / B / C 정책 요약

| 자동화 수준 | 대상 |
|------------|------|
| **Class A** (자동 허용) | UI 배지 다운그레이드, null 가드 추가, 로깅 개선, 서버 재시작 |
| **Class B** (Codex 제안 → 사람 승인) | API 응답 구조 변경, executor 로직, snapshot builder |
| **Class C** (절대 자동 불가) | approval 실행, source 등록, DB destructive write, bulk 재분류 |
