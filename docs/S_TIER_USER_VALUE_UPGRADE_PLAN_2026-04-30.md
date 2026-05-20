# S-Tier User Value Upgrade Plan

Date: 2026-04-30

Scope: This document evaluates and upgrades Lattice as a signal-first decision-support product. It intentionally focuses on whether real users can obtain useful, trustworthy, actionable information from the platform. It does not cover authentication, authorization, billing, or tenant security.

## Current Diagnosis

The platform has meaningful signal infrastructure, but the user-facing information product is not yet S-tier.

The core issue is not lack of data. The core issue is that the data is not consistently transformed into a compact, relevant, evidence-backed decision brief.

Observed problems:

- Theme pages can surface events from unrelated themes.
- Hot Events can rank high-temperature but unvalidated items above actually relevant signals.
- Evidence grade `none` can appear visually similar to validated signals.
- Theme briefs often expose aggregate metrics without enough narrative, evidence, caveats, or next actions.
- YoY and acceleration values can look extreme because of small baselines.
- Users can see many cards but still not know what to do next.
- Operator/diagnostic information can leak into normal user workflows and increase cognitive load.

The target state is not "more data on screen." The target state is an intelligence product that answers:

1. What changed?
2. Why does it matter?
3. What evidence supports it?
4. What could make it wrong?
5. What should I monitor or do next?

## S-Tier Definition

Lattice reaches S-tier user value when:

- A first-time user can understand one important signal within 30 seconds.
- A theme page's top events are directly relevant to the selected theme.
- Validated signals and watch-only signals are visually and semantically separated.
- Every important number includes baseline, sample size, calculation path, and caveat.
- Every brief gives a next action.
- User actions such as Follow, Mute, Accept, Reject, Snooze, and Dismiss persist after refresh.
- Stale model or data states either self-heal or are clearly blocked from influencing priority.
- Normal users can make decisions without understanding internal Ops panels.

## 1. Information Trust

### Required Improvements

- Add a mandatory `themeRelevanceScore` to all Hot Events, Theme Briefs, Inbox items, and Watchlist summaries.
- Stop ranking by Hawkes temperature alone.
- Rank events by a composite product score:

```text
theme relevance
× evidence grade
× freshness
× source credibility
× market/policy impact
× duplicate penalty
```

- Move `none` evidence-grade items out of the validated signal lane.
- Canonicalize duplicate articles and syndicated content before ranking.
- Treat base-effect growth metrics as unstable unless the baseline count is large enough.
- Show the calculation path for all prominent metrics.

### Acceptance Criteria

- Top 10 events on a theme page must have at least 90% human-judged direct relevance.
- `none` evidence items must never appear in the same visual lane as validated E2+ signals.
- Every YoY or acceleration value above 300% must display baseline and base-effect warning.

## 2. Brief Quality

Every theme brief must follow this fixed structure:

```text
1. What changed?
2. Why it matters
3. Evidence
4. Caveats / noise risk
5. What to monitor next
6. Related assets / sectors / entities
```

### Required Improvements

- Aggregate-only briefs must be labeled as "trend aggregate only" or "market reaction not yet validated."
- Evidence must be split by class:
  - Article evidence
  - Event evidence
  - Market reaction evidence
  - Model evidence
  - Source diversity evidence
- LLM/Codex-generated reports must include cited evidence rows.
- No brief should make a strong claim without at least one evidence item and one caveat.
- Every brief must include a next-monitoring checklist.

### Acceptance Criteria

- `brief_completeness >= 95%`
- `evidence_coverage >= 90%`
- `actionability_score >= 90%`

## 3. Screen Design

### Home

Home should not be a full database dump. It should answer: "What should I look at today?"

Required layout:

- Top 3 to 5 highest-value signals.
- Clear separation between validated signals and watch-only changes.
- One compact watchlist summary.
- One short freshness/trust indicator.
- No full Ops detail for normal users.

### Theme Page

Theme page should behave like a focused intelligence brief.

Required layout:

- Theme summary.
- Validated signals.
- Emerging watch signals.
- Evidence chain.
- Caveats.
- Next monitor checklist.
- Related assets, entities, and sectors.

### Investigate

Investigate should be the evidence workbench.

Required layout:

- Event chain.
- Article cluster.
- Source list.
- Entity map.
- Market reaction.
- Model score decomposition.

### Inbox

Inbox should be a task queue, not a passive list.

Required item types:

- Review
- Monitor
- Investigate
- Dismiss
- Promote

Each item must include:

- Why it appeared.
- What action is recommended.
- What happens if the user accepts or rejects it.
- Whether it is validated, watch-only, or blocked.

### Watchlist

Watchlist should be compact by default.

Required behavior:

- Collapsed list by default.
- Expand-on-demand detail.
- Show only meaningful deltas.
- Hide repeated long summaries unless expanded.

## 4. User Actionability

### Required Improvements

- Every user-facing signal card must include a recommended action.
- Follow/Mute/Accept/Reject/Snooze/Dismiss must persist after refresh.
- User-selected themes must personalize Home, Inbox, and Brief ordering.
- Alerts must only trigger on validated or high-confidence watch signals.
- Action history must be visible in a lightweight audit trail.

### Acceptance Criteria

- `actionability_score >= 90%`
- No accepted/rejected item should reappear in active queues after refresh.
- User can reduce today's visible queue to five or fewer items within five minutes.

## 5. Model And Analysis Layer

### Required Improvements

- Add a dedicated theme relevance model.
- Add an event quality model separate from article count or temperature.
- Split confidence into components:
  - Data freshness
  - Source diversity
  - Evidence grade
  - Model calibration
  - Theme relevance
  - Historical market reaction
- Prevent stale predictions from influencing ranking.
- Clearly label events without market reaction evidence.

### Acceptance Criteria

- Stale prediction rows must self-heal or block model-driven prioritization.
- Confidence must be decomposed; no opaque single score as the only explanation.
- Event ranking must degrade low-relevance high-temperature items.

## 6. Data Quality

### Required Improvements

- Apply source credibility to ranking.
- Penalize broad catch-all themes such as `technology-general` and `emerging-tech` unless no narrower theme exists.
- Detect and suppress spam, duplicate, generic, and low-signal source content.
- Show coverage gaps per theme.
- Separate article count, event count, source count, and market-reaction count.

### Acceptance Criteria

- Theme pages must show coverage warnings when source or market data is thin.
- Duplicate/syndicated article clusters must be counted once for ranking.
- Low-quality source content must not be promoted solely by volume.

## 7. Product Evaluation Metrics

These metrics should be tracked in addition to technical health checks.

```text
theme_relevance_precision
  Share of top theme events that are directly relevant.

brief_completeness
  Share of briefs containing all required sections.

evidence_coverage
  Share of major briefs with at least two evidence items.

noise_suppression_rate
  Share of low-relevance or duplicate events hidden from primary surfaces.

actionability_score
  Share of signal cards with a clear next action.

time_to_first_value
  Seconds until a first-time user can understand one important signal.
```

S-tier targets:

- `theme_relevance_precision >= 90%`
- `brief_completeness >= 95%`
- `evidence_coverage >= 90%`
- `actionability_score >= 90%`
- `time_to_first_value <= 30 seconds`
- `console_errors = 0`
- `empty_primary_cards = 0`

## 8. Operational Quality For User Value

### Required Improvements

- If `/api/ops/status` is warning, user-facing ranking must account for it.
- If predictions are stale, run inference automatically or suppress model-priority usage.
- Daemon failures must surface as product-level freshness warnings.
- Define freshness SLA:
  - News: 15 minutes
  - Event features: 1 hour
  - Model inference: 1 hour
  - Theme briefs: 6 hours
  - Watchlist summaries: 6 hours
- Console errors, API 500s, and empty primary cards must be release blockers.

## 9. Commercial Readiness

This is outside the immediate scope if authentication and permissions are intentionally deferred, but true commercial readiness eventually requires:

- User accounts.
- Team workspaces.
- Role-based permissions.
- Per-user watchlists and dismissed states.
- Audit logs.
- Export and permalink sharing.
- Data licensing review.
- Rate limits.
- Billing.
- Separation of internal Ops endpoints from normal user surfaces.

## Implementation Priority

### Phase 1: Relevance And Ranking

1. Add `themeRelevanceScore`.
2. Re-rank Hot Events using product score.
3. Hide low-relevance items from primary theme surfaces.
4. Add tests for theme relevance precision.

### Phase 2: Signal Lane Separation

1. Split Hot Events into `Validated Signal`, `Emerging Watch`, and `Noise / Hidden`.
2. Prevent `none` grade items from appearing in validated lanes.
3. Add UI labels explaining evidence grade.

### Phase 3: Brief Productization

1. Enforce six-section brief structure.
2. Attach evidence classes.
3. Add caveats and next monitor checklist.
4. Add completeness tests.

### Phase 4: Inbox And Watchlist

1. Convert Inbox into an action queue.
2. Persist all user actions.
3. Compact Watchlist by default.
4. Add refresh persistence tests.

### Phase 5: Product Metrics And Release Gates

1. Add product-quality metrics endpoint.
2. Add release gate for relevance, completeness, actionability, console errors, and empty cards.
3. Add browser smoke tests for the main user path.

## Final Product Standard

The platform should not feel like a database or monitoring console. It should feel like a compact intelligence analyst that continuously answers:

```text
This changed.
It matters because of this.
The evidence is this.
The caveat is this.
Watch this next.
```

Until that is true across Home, Theme Brief, Investigate, Inbox, and Watchlist, the product should not be considered S-tier from a user-value perspective.
