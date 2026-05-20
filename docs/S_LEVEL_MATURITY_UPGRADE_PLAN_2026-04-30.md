# Lattice Current S-Level Maturity Upgrade Plan

Updated: 2026-04-30 03:13 KST

## Current Assessment

Lattice Current is now best understood as a signal-first decision-support platform, not a backtesting product.

Current maturity:

| Area | Current Grade | Target |
| --- | --- | --- |
| Internal usability | B | S |
| Product completeness | B- | S |
| Operational maturity | B- | S |
| External commercial readiness | C+ | S- |
| Signal decision-support reliability | B- | S |
| Automation stability | B- | S |

Current position:

- Suitable for internal operator use as a live signal intelligence dashboard.
- Not yet suitable as an external commercial SaaS without additional operational, security, UX, and test hardening.
- The main risk is not lack of features. The main risk is state consistency, process supervision, action auditability, calibration visibility, and user trust.

## S-Level Definition

This plan defines S-level as limited-production SaaS quality, not just a working local tool.

S-level requirements:

- Core APIs p95 under 800ms; heavy analytical APIs p95 under 3s.
- Dashboard API, master daemon, data accumulator, and meta-model server auto-recover after restart.
- Duplicate long-running processes are blocked.
- CPU runaway tasks are bounded by timeout, circuit breaker, and child-process cleanup.
- `featureStaleEventCount` converges to 0 automatically.
- `latestFeatureArticleDateKey` and `latestPredictedArticleDateKey` track the latest article date with acceptable lag.
- Decision Inbox actions remain consistent across DB, API, cache, and UI after refresh.
- Every automation action has timeout, circuit breaker, audit log, retry policy, and operator-visible state.
- Write APIs require authentication, authorization, and audit logging.
- Browser E2E tests cover the primary operator flows.
- Model calibration, drift, retraining, and rollback status are visible to operators.
- Code changes are separated from runtime cache/data artifacts in release branches.

## Phase 0. Release Baseline Cleanup

Goal: separate deployable code from runtime artifacts.

Tasks:

- Update `.gitignore` so runtime artifacts do not pollute release diffs:
  - `data/event-dashboard-cache/*`
  - `data/runtime-logs/*`
  - `data/backups/*`
  - `data/backfill-logs/*`
  - `scripts/**/__pycache__/*`
  - `.tmp/*`
  - corrupt DuckDB snapshots
- Keep sample config/state files instead of live runtime state files.
- Add a release readiness script.
- Document the required runtime services in a runbook.
- Create a clean release branch where `git status --short` shows code/config changes only.

Target files:

- `.gitignore`
- `docs/RUNBOOK.md`
- `scripts/check-release-readiness.mjs`

Completion criteria:

- `git status --short` is not dominated by cache/data artifacts.
- One command validates typecheck, unit tests, smoke API, daemon state, and dirty runtime artifacts.
- Release branch can be reviewed without runtime noise.

## Phase 1. Process Operations Hardening

Goal: move from manually started local processes to supervised services.

Required services:

- `event-dashboard-api`
- `master-daemon`
- `data-accumulator`
- `meta-model-server`

Tasks:

- Choose one service manager for Windows operation: PM2 or NSSM.
- Define service specs with:
  - command
  - working directory
  - environment file
  - restart policy
  - max memory
  - log location
  - health check route or probe command
- Disable legacy bridge processes by default, especially old DuckDB sync loops.
- Add task metadata to master daemon:
  - `maxDurationMs`
  - `expectedFrequency`
  - `criticality`
  - `description`
  - `ownerSurface`
- Ensure timeout kills the full child-process tree, not only the shell wrapper.
- Keep duplicate persistent daemon protection.
- Add a `scripts/service-manager.mjs` wrapper for start/stop/status/restart.

Target files:

- `scripts/master-daemon.mjs`
- `scripts/data-accumulator.mjs`
- `scripts/event-dashboard-api.mjs`
- `scripts/service-manager.mjs`
- `docs/RUNBOOK.md`

Completion criteria:

- Machine restart can restore all required services.
- No duplicate `master-daemon`, `data-accumulator`, `event-dashboard-api`, or legacy sync loops.
- CPU runaway count is zero over 24h.
- API and daemon health recover without manual shell intervention.

## Phase 2. Decision Inbox State Consistency

Goal: an operator action must not reappear as actionable after refresh unless it genuinely failed.

Canonical states:

- `pending`
- `simulated`
- `executed`
- `canonical`
- `watch`
- `suppressed`
- `needs-fix`
- `rejected`

Item type semantics:

| Type | Accept Meaning | Final States |
| --- | --- | --- |
| Discovery | promote to canonical | `canonical`, `suppressed` |
| Approval | execute approved action | `executed`, `rejected`, `needs-fix` |
| Proposal | approve/reject proposal | `executed`, `rejected`, `snoozed` |
| E2 Signal | not executable; review/snooze only | `snoozed` local or persisted |

Tasks:

- API should return actionable items by default.
- Final items should require explicit `include_final=1` or a history endpoint.
- Client should also filter final items defensively.
- Optimistic UI updates must be confirmed by server response.
- Failed writes must rollback local state and show a durable error message.
- Every action should write to an audit log with:
  - item type
  - item id
  - previous state
  - next state
  - reviewer
  - timestamp
  - request id
- Button labels should be specific:
  - Discovery: `Promote to Canonical`, `Watch`, `Suppress`
  - Approval: `Simulate`, `Execute`, `Reject`
  - Proposal: `Approve`, `Snooze`, `Reject`

Target files:

- `event-dashboard.html`
- `scripts/event-dashboard-api.mjs`
- `scripts/_shared/trend-workbench.mjs`
- `scripts/_shared/approval-queue.mjs`
- `scripts/proposal-executor.mjs`

Completion criteria:

- Accept/Reject/Snooze/Canonical action survives refresh.
- Final discovery items do not reappear in Decision Inbox.
- Approval execution cannot silently skip without a `needs-fix` state.
- Browser E2E covers Discovery, Approval, Proposal, and E2 signal flows.

## Phase 3. Data Pipeline Integrity

Goal: article to event to feature to prediction to dashboard must remain synchronized.

Pipeline:

```text
articles
  -> article_event_map
  -> canonical_events
  -> event_features
  -> model_predictions
  -> dashboard cards
```

Known failure class:

- New articles can attach to an existing event.
- If feature rows are insert-only, `event_features` becomes stale.
- If predictions are insert-only, `model_predictions` becomes stale.
- UI can show fresh-looking predictions based on old feature values.

Tasks:

- Keep `event_features` upsert-based.
- Keep `model_predictions` upsert-based when feature `computed_at` is newer than prediction `created_at`.
- Forbid JS date key conversion using `toISOString().slice(0, 10)` in ingestion/event code.
- Use SQL date keys consistently.
- Add a pipeline freshness checker:
  - latest article date
  - latest mapped article date
  - latest feature-covered article date
  - latest predicted article date
  - stale feature count
  - stale prediction count
  - unmapped themed article count
- Add automatic repair task for stale feature/prediction rows.
- Add pending outcome backlog breakdown:
  - horizon not due
  - missing market return
  - missing symbol mapping
  - missing article event map
  - failed price lookup

Target files:

- `scripts/incremental-event-engine-fast.mjs`
- `scripts/meta-model-infer.mjs`
- `scripts/backfill-active-rss-sources.mjs`
- `src/services/article-ingestor.ts`
- `scripts/_shared/event-intelligence-builder.mjs`

Completion criteria:

- `featureStaleEventCount = 0` after scheduled repair.
- `latestFeatureArticleDateKey = latestArticleDateKey` or documented lag is under SLA.
- `latestPredictedArticleDateKey = latestArticleDateKey` or documented lag is under SLA.
- Pending backlog is explained by reason, not just counted.

## Phase 4. Model Trust and Calibration

Goal: operators should know when to trust the model, when to discount it, and when to retrain.

Current model state:

- Active model: `meta-v1-20260411-0710`
- Aggregate Brier: about `0.216`
- Aggregate ECE: about `0.099`
- Worst split ECE: about `0.1437`
- Current status: usable but calibration warning remains.

Tasks:

- Display average fold metrics and worst fold metrics separately.
- Add model health status:
  - `ok`
  - `watch`
  - `calibration-warning`
  - `stale`
  - `disabled`
- Add explicit promotion gates:
  - max acceptable Brier
  - max acceptable ECE
  - minimum top20 precision
  - minimum sample count
  - maximum feature lag
- Add model registry states:
  - `active`
  - `shadow`
  - `deprecated`
  - `rollback_candidate`
- Store feature schema/hash in predictions.
- Mark predictions stale when feature schema changes.
- Add recalibration task.
- Add retrain task.
- Add rollback task.
- UI should show:
  - active model
  - last train window
  - last eval date
  - next retrain due
  - warning reason
  - recommended action

Target files:

- `scripts/meta-model-infer.mjs`
- `scripts/meta-model-server.py`
- `scripts/train-meta-model.py`
- `scripts/_shared/event-intelligence-builder.mjs`
- `event-dashboard.html`

Completion criteria:

- Worst split failures are visible and actionable.
- Model recalibration history is stored.
- Shadow model can be compared before promotion.
- Model failure does not break dashboard; deterministic fallback remains available.

## Phase 5. UI/UX Productization

Goal: reduce cognitive load while preserving high information density.

Core problem:

- The dashboard has many useful parts, but the first-time operator still has to infer what matters.
- S-level UX requires action hierarchy, not just more cards.

Information architecture:

- Home:
  - Today's top decisions
  - Risk movement
  - My queues
- Decision Inbox:
  - Actionable
  - Needs Fix
  - History
- Investigate:
  - theme brief
  - event evidence
  - citations
  - comparable events
- Ops:
  - runtime status
  - daemon status
  - data freshness
  - model health

Tasks:

- Replace generic `Accept` label with action-specific verbs.
- Make simulated/dry-run state visually distinct from executed state.
- Display saved/executed/queued/failed result after each action.
- Do not rely on hover for critical information.
- Use hover for explanation only.
- Standardize badge vocabulary:
  - live
  - stale
  - cached
  - needs-fix
  - final
  - warning
- Improve Korean/English action labels.
- Add onboarding hints only where needed.
- Keep keyboard shortcuts but always provide visible button alternatives.

Target files:

- `event-dashboard.html`
- `src/locales/ko.json`
- `src/locales/en.json`

Completion criteria:

- A new user can identify the next action within 30 seconds.
- No action result is ambiguous.
- Keyboard and mouse flows are equivalent.
- Korean labels are not partial or misleading.

## Phase 6. API Security and Permissions

Goal: write APIs should not be usable by an unauthenticated browser or random local client.

Tasks:

- Add API authentication for write routes.
- Separate read-only and write scopes.
- Add reviewer/user identity to each action.
- Add idempotency key support for action endpoints.
- Add CORS policy.
- Add endpoint-level rate limiting.
- Add DB role separation:
  - read-only
  - writer
  - admin/migration
- Remove any remaining password fallback patterns.
- Add request body hashing to audit logs.

Target files:

- `scripts/event-dashboard-api.mjs`
- `scripts/_shared/nas-runtime.mjs`
- `scripts/_shared/automation-audit.mjs`
- `scripts/_shared/rate-limit.mjs`

Completion criteria:

- Unauthenticated write request returns 401.
- Unauthorized write request returns 403.
- Every write action has audit trail.
- DB password fallback does not exist.

## Phase 7. Observability and Alerts

Goal: the operator should be able to answer "is the system healthy?" from one screen.

Tasks:

- Add `/api/ops/status`.
- Include:
  - service process status
  - daemon task status
  - stale feature count
  - stale prediction count
  - pending outcome backlog
  - latest article age
  - latest signal age
  - meta-model health
  - recent runtime issues
- Add structured JSONL logs.
- Add log rotation.
- Add alert thresholds:
  - API p95 too slow
  - feature lag over SLA
  - prediction lag over SLA
  - daemon task failure
  - repeated action API failures
  - source backlog spike
- Add daily health digest.

Target files:

- `scripts/event-dashboard-api.mjs`
- `scripts/_shared/structured-logger.mjs`
- `scripts/_shared/alert-notifier.mjs`
- `event-dashboard.html`

Completion criteria:

- Ops surface shows current health at a glance.
- Last 24h failures are visible.
- Alerts are generated before users notice stale data.

## Phase 8. Test Maturity

Goal: prevent repeat classes of bugs.

Required test layers:

- Unit tests:
  - state transitions
  - date key rules
  - feature freshness
  - prediction freshness
  - model health warnings
- Integration tests:
  - action API write/read roundtrip
  - discovery triage final filtering
  - approval execution
  - proposal review
- Browser E2E:
  - accept discovery and refresh
  - execute approval and refresh
  - reject proposal and refresh
  - simulate approval without state change
  - open evidence drawer
- Daemon tests:
  - timeout
  - circuit breaker
  - duplicate process guard
  - recovery after success
- Performance smoke:
  - dashboard health
  - meta-model health
  - discovery triage
  - hot events

Target files:

- `tests/user-facing-contracts.test.mjs`
- `tests/trend-workbench.test.mjs`
- `tests/meta-model-infer-guardrails.test.mjs`
- `tests/master-daemon-guardrails.test.mjs`
- `tests/e2e-decision-inbox.spec.mjs`
- `scripts/check-release-readiness.mjs`

Completion criteria:

- CI runs typecheck, unit, integration, and browser smoke.
- Decision Inbox refresh regression is permanently covered.
- Date and stale-feature regressions are permanently covered.

## Phase 9. Commercial Readiness

Goal: prepare for limited external beta.

Tasks:

- Add user/workspace model.
- Add read-only external role.
- Add operator/admin role.
- Add source/license disclosure.
- Add "not financial advice" and decision-support disclaimer.
- Add data retention policy.
- Add export/share permissions.
- Add backup/restore runbook.
- Add incident response checklist.
- Add closed beta onboarding checklist.

Completion criteria:

- External read-only beta is possible without exposing write actions.
- Operator actions are auditable.
- Recovery plan exists and has been tested.

## Recommended Execution Order

1. Phase 0: Release baseline cleanup.
2. Phase 1: Process supervision and runaway prevention.
3. Phase 2: Decision Inbox state consistency across all item types.
4. Phase 3: Data pipeline freshness and repair automation.
5. Phase 8 partial: browser E2E and integration tests for Phases 2 and 3.
6. Phase 4: model trust, recalibration, retraining, rollback.
7. Phase 5: UI/UX productization.
8. Phase 6: API security and permissions.
9. Phase 7: observability and alerts.
10. Phase 9: commercial beta readiness.

## Immediate First Sprint

The highest-leverage first sprint is:

1. Clean release branch and ignore runtime artifacts.
2. Add `check-release-readiness.mjs`.
3. Expand Decision Inbox final-state filtering to proposal, approval, discovery, and E2 signal.
4. Add browser E2E for action then refresh.
5. Add `/api/ops/status` minimal version.
6. Add stale feature/prediction repair task to daemon.

Rationale:

- Recent issues were not algorithmic. They were state consistency and operational visibility issues.
- Fixing those first raises trust faster than adding more analytics.
- Once action state and pipeline freshness are reliable, model and UX improvements become easier to validate.

## Non-Negotiable Engineering Rules Going Forward

- Do not treat "stored in DB" as "visible in product" until API and UI paths are verified.
- Do not treat "button clicked" as "action completed" until refresh persistence is verified.
- Do not add new automated tasks without timeout, circuit breaker, and audit log.
- Do not add insert-only pipeline rows when upstream features can change.
- Do not use JS UTC date slicing for business date keys.
- Do not rely on hover text for critical state.
- Do not mix runtime cache/data artifacts with release code changes.
- Do not promote model output without showing calibration and freshness status.
