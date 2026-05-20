# Workflow Deep-Dive: Source-Add Path

> **Status**: reference (code-level expansion of [CONNECTED_SYSTEM_WORKFLOW_DETAILED_EXPLAINED_2026-04-18.md](./CONNECTED_SYSTEM_WORKFLOW_DETAILED_EXPLAINED_2026-04-18.md) §"소스 추가는 어디에 들어가나")

Parent doc covers the high-level path:

`소스 자동화 → 리뷰 저장소 → Decision Inbox → 인간 리뷰 → 실행/수리 → 소스 자동화`

This doc adds the concrete files, tables, and guardrails that wire each step.

## Where candidates come from

Three independent detectors feed the source-add pipeline, all eventually
materialise as rows in the same `codex_proposals` table with `kind='add-rss'`:

| Detector | Script | Trigger |
|---|---|---|
| Coverage gap analysis | `scripts/discover-emerging-tech.mjs` → `scripts/source-adapter-proposal.mjs` | Daily: find under-covered topics, suggest feeds |
| Self-heal of broken feeds | `scripts/self-heal-sources.mjs` | 6-hourly: feeds returning 4xx/5xx or no new rows |
| Backfill discovery | `scripts/backfill-new-sources.mjs` | Manual / on-demand: imports curated candidate lists |

Each detector writes candidates via the same proposal API (see
`scripts/_shared/approval-queue.mjs`), so downstream review logic is single-pathed.

## Quality gate before approval queue

A raw candidate is **not** admitted to the human review queue unmodified.
`scripts/_shared/rss-proposal-quality.mjs` exports `isLowSignalAddRssProposal`,
called from the proposal writer. It rejects candidates where the feed
quality score is below threshold (e.g. `https://site.com/` homepage URL that
isn't actually a feed).

Rejected candidates get stored as `status='rejected'` with a structured
reason. This is the guardrail that prevents the approval queue from filling
up with homepage URLs.

## Review storage

Admitted candidates live in `codex_proposals`:

| Column | Meaning |
|---|---|
| `id` | Proposal identifier |
| `kind` | `'add-rss'` for source-add path |
| `payload` | JSON: `{url, suggestedSource, triggers, qualityScore, ...}` |
| `status` | `proposed / approved / rejected / executed / failed` |
| `reviewed_at`, `reviewed_by` | Human review metadata |
| `executed_at` | When the executor actually ran |

The Decision Inbox surface (`event-dashboard.html` → Decision Inbox tab)
reads from this table and presents each row as a card.

## Human review

The operator-facing surface is the **Decision Inbox** (described in the
parent doc §07 ②). For source-add proposals, the operator typically:

1. Reads the suggested URL + trigger keywords.
2. Optionally clicks "Simulate" to dry-run a probe — probes are
   implemented in `scripts/_shared/source-probe.mjs` and hit the URL
   without making persistent changes.
3. Approves or rejects. Approval sets `status='approved'` and queues for
   the executor.

Related approval-queue helpers live in `scripts/_shared/approval-queue.mjs`
(`getPendingApprovals`, `loadApprovalById`, `markApprovalReviewed`).

## Execution

Approved proposals are picked up by `scripts/proposal-executor.mjs`
`handleAddRss` — the daemon task `executor` (6-hourly interval) runs this.
The executor:

1. Re-probes the URL using `source-probe.mjs`.
2. Validates the feed parses and has recent items.
3. Writes into `discovered_source_registry` (via
   `scripts/_shared/discovered-source-registry.mjs`) — this is the authoritative
   list the feed collector reads from.
4. Sets `codex_proposals.status='executed'` with `executed_at`.

If any step fails, status flips to `'failed'` with the error captured in
`payload.execution_error`, and the Decision Inbox surfaces it on next review.

## Self-heal loop

`scripts/self-heal-sources.mjs` detects feeds in `discovered_source_registry`
that have been silent or failing. It emits either:

- A `source-repair` proposal (`kind='source-repair'`) — operator reviews,
  executor re-subscribes or updates URL.
- A `source-retire` proposal (`kind='source-retire'`) — operator confirms,
  executor marks the source disabled.

Both flow through the same Decision Inbox surface — no separate UI.

## Key tables

| Table | Role |
|---|---|
| `codex_proposals` | Unified proposal + status | 
| `discovered_source_registry` | Live source list feeding the collector |
| `source_scores` (worldmonitor_intel schema) | Per-source historical quality scores |
| `approval_queue` | Additional human-review state for riskier actions |

## Operational gotchas

- The **quality gate** (`isLowSignalAddRssProposal`) is what keeps the
  inbox usable. If the threshold is raised or lowered, inbox noise changes
  sharply — it's the single highest-leverage tuning knob in this path.
- Self-heal can cascade: a legitimate source outage triggers `source-repair`
  proposals that, when ignored, escalate to `source-retire`. Watch the
  Ops surface during provider outages.
- The executor is **idempotent** for `add-rss` — re-running on an already
  executed row is a no-op. Safe to retry on transient failures.

## Related code pointers

- Proposal write path: `scripts/proposal-executor.mjs:handleAddRss`
- Self-heal detector: `scripts/self-heal-sources.mjs`
- Source probe: `scripts/_shared/source-probe.mjs`
- Quality filter: `scripts/_shared/rss-proposal-quality.mjs`
- Approval queue helpers: `scripts/_shared/approval-queue.mjs`
- Discovered-source registry: `scripts/_shared/discovered-source-registry.mjs`
- Redesign context: [SOURCE_PROPOSAL_INGESTION_REDESIGN_2026-04-16.md](./SOURCE_PROPOSAL_INGESTION_REDESIGN_2026-04-16.md) (Phase 0-6 landed in commit `40745017`)
