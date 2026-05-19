# Intelligence Report Generator Handoff

Date: 2026-05-07

## 1. What We Were Trying To Build

The feature is an evidence-first intelligence report generator for Lattice Signal Intelligence.

The intended product is not a generic AI summary tool. The goal is to generate analyst-style reports from Lattice data while keeping every important sentence tied to a claim, evidence item, metric, figure, caveat, and query manifest.

The original target was:

- Build HTML/Markdown/PPTX report artifacts from DB-backed Lattice signals.
- Support report types for theme, event signal, regime transmission, cross-theme bottleneck, symbol signal, and system quality.
- Keep LLM/Codex analysis constrained to the evidence bundle.
- Prevent unsupported claims, stale-data overstatement, ungrounded numbers, and investment recommendation language.
- Eventually produce reports that are closer to professional analyst reports: thesis, catalyst, evidence, market linkage, risk, scenario, watch triggers, and conclusion.

## 2. Why This Feature Exists

The dashboard surfaces many signals, but the user still needs a readable analytical product.

This feature is meant to answer:

- What changed?
- Why does it matter?
- What is the evidence?
- What is uncertain or stale?
- Which companies, symbols, themes, or regimes are connected?
- What should be watched next?
- What would make the conclusion stronger or weaker?

The product purpose is to turn raw Lattice state into a reviewable intelligence brief.

It should not hide uncertainty. If the data is weak, stale, mismatched, or only partially connected, the report must say so directly.

## 3. Current Implementation State

The report pipeline currently exists and can generate local artifacts.

Current path:

```text
POST/CLI request
  -> DB adapter or sample bundle builder
  -> evidence bundle
  -> figure planner and renderer
  -> deterministic evidence-bound analyst draft
  -> validator
  -> HTML/Markdown/PPTX artifacts
  -> local report registry
```

Latest local registry:

```text
C:\Users\chohj\Documents\Playground\lattice-current-fix\data\reports\db-live-registry\index.html
```

Main entry scripts:

- `scripts/generate-intelligence-report.mjs`
- `scripts/build-report-bundle.mjs`
- `scripts/list-intelligence-reports.mjs`
- `scripts/export-intelligence-report.mjs`
- `scripts/schedule-intelligence-reports.mjs`

Main API wiring:

- `scripts/event-dashboard-api.mjs`

### 2026-05-10 state update

The earlier artifact generator has been upgraded into a long-form research memo
pipeline:

```text
DB adapter
  -> evidence bundle
  -> deep research pack
  -> signal cards
  -> analyst synthesis
  -> semantic narrative blueprint
  -> long-form client memo
  -> validator and quality gates
  -> HTML/Markdown/audit/source-query artifacts
```

The client-facing report is no longer expected to expose raw metric ledgers,
query manifests, claim IDs, or pack names. The audit appendix retains those
details.

The latest generated AI/ML artifact used for QA:

```text
C:\Users\chohj\Documents\Playground\lattice-current-fix\data\reports\RPT-theme-report-ai-ml-bd29314e5d\report.html
```

Current quality interpretation:

- artifact quality: can reach `S`
- triage usefulness: can reach `S`
- analyst memo quality: capped when historical analogues, transcript evidence,
  or unresolved gaps remain weak
- investment readiness: currently capped at `C` when direct transcript coverage
  is below threshold

## 4. Main Problem Found

The implementation started to produce valid artifacts, but the reports were not deep enough.

The first issue was that the quality score said `S` when the report was only structurally valid. That was misleading.

The second issue is that report packs are not yet subject-faithful. For example, generating with `cloud-infrastructure` can produce a pack containing:

- `theme_report`: Cloud Infrastructure
- `event_signal_report`: unrelated top event fallback
- `symbol_signal_report`: TLT conflict exposure
- `cross_theme_bottleneck_report`: Vertiv
- `regime_transmission_report`: balanced regime transmission
- `system_quality_report`: system quality

That means the user can think they are looking at one Cloud Infrastructure report pack, but the report types may be pulled from unrelated top-ranked DB fallback rows.

This is currently the most important product problem.

Status update:

Subject fidelity is no longer the only product problem. The current main
investment-readiness blocker is direct primary evidence. For AI/ML, the system
correctly reports `direct transcript coverage 0/3`; proxy evidence from filings
or earnings releases is not enough to upgrade the report into an investment
memo.

## 5. Current Quality Fix Already Applied

The quality system was changed so reports can no longer get final `S` just because the artifact is well-formed.

Quality is now split into:

- `artifactGrade`: whether the report artifact is structurally valid.
- `analysisGrade`: whether the report has enough analysis depth.
- final `grade`: capped by the weaker side and by data-quality caps.

Examples of final grade caps:

- Stale or degraded data can cap the report at `A`.
- Low source diversity can cap the report at `B`.
- Aggregate/evidence mismatch can cap the report at `B`.
- Missing market context can cap some report types at `B`.
- Missing direct transcript coverage can cap investment readiness at `C`.
- Candidate-only causal edges can prevent the report from using causal language
  as validated mechanism language.

This was intentional. A report that is safe but shallow should no longer be labeled as a professional-grade `S`.

Additional fix now applied:

- Report quality is split into artifact, triage, analyst memo, and investment
  readiness categories.
- Event anchors are thesis-fit scored before being used as concrete memo anchors.
- Market anchors include calibrated strength when available.
- Exhibits include takeaways instead of only analytic questions.
- Research agenda tasks include success criteria when they are tied to a hard
  blocker.

## 6. Specific Problems Still Remaining

### 6.1 Subject Fidelity

Problem:

When a subject is requested, all report types should stay bound to that subject. If no related event/symbol/cross-theme candidate exists, the system should say there is no subject-bound candidate instead of silently selecting an unrelated top fallback.

Example bad behavior:

```text
Requested subject: cloud-infrastructure
Generated symbol report: TLT conflict exposure
Generated event report: unrelated Medicare AI experiment
```

Expected behavior:

```text
Requested subject: cloud-infrastructure
Theme report: Cloud Infrastructure
Event report: only cloud-infrastructure events, or "no validated subject-bound event"
Symbol report: only cloud-infrastructure linked symbols, or "no validated subject-bound symbol"
Cross-theme report: only cloud-infrastructure adjacent candidates, or "no subject-bound candidate"
```

Files to fix:

- `scripts/_shared/report-db-adapter.mjs`
- `scripts/generate-intelligence-report.mjs`
- `scripts/schedule-intelligence-reports.mjs`
- `tests/report-db-adapter.test.mjs`
- Add a new subject-fidelity test, likely `tests/report-subject-fidelity.test.mjs`

### 6.2 Report Registry UI

Problem:

The registry only shows:

```text
Report | Type | Status | Quality | Generated
```

This is not enough. The user cannot see why a report is B or A, whether the artifact itself is S, or what cap blocked the grade.

Expected registry fields:

- Subject pack id
- Requested subject
- Actual subject
- Subject match status
- Final grade
- Artifact grade
- Analysis grade
- Grade caps
- Main blockers or caveats
- Whether this row is a fallback

Files to fix:

- `scripts/_shared/report-local-store.mjs`
- `scripts/_shared/report-artifacts.mjs`
- `scripts/_shared/report-quality.mjs`
- `tests/report-local-store.test.mjs`

### 6.3 Report Pack Concept

Problem:

Reports are currently listed individually. There is no first-class concept of a report pack.

Expected behavior:

One request should create:

```text
ReportPack {
  requestedSubject,
  generatedAt,
  reports[],
  subjectCoverage,
  missingReportTypes[],
  packQuality,
  packCaveats
}
```

This allows the UI to show whether the overall report pack is coherent.

Files to add or modify:

- Add `scripts/_shared/report-pack.mjs`
- Modify `scripts/schedule-intelligence-reports.mjs`
- Modify `scripts/generate-intelligence-report.mjs`
- Modify `scripts/_shared/report-local-store.mjs`
- Add `tests/report-pack.test.mjs`

### 6.4 Analyst Depth

Problem:

The report now has thesis, catalysts, scenarios, risks, market linkage, and conclusion, but much of the language is still templated.

Expected behavior:

The report should use DB evidence and metrics to form subject-specific statements.

For a theme report, it should explain:

- Theme movement.
- Subtopic movement.
- Evidence source mix.
- Market or proxy exposure.
- Related companies.
- What would make the theme structural instead of just noisy.

For an event report, it should explain:

- Event sequence.
- Actors/entities.
- Evidence chain.
- Market reaction.
- Alternative interpretations.
- What would confirm or invalidate the signal.

For a cross-theme bottleneck report, it should explain:

- Theme intersection.
- Component/material/supplier pathway.
- Evidence source quality.
- Seed-lock risk.
- Whether it is a true bottleneck or just adjacency.

Files to fix:

- `scripts/_shared/report-llm-analyst.mjs`
- `scripts/_shared/report-evidence-bundle.mjs`
- `scripts/_shared/report-db-adapter.mjs`
- `tests/report-content-quality.test.mjs`

Status:

Partially addressed. The current depth path is implemented through:

- `scripts/_shared/report-deep-research-pack.mjs`
- `scripts/_shared/report-signal-cards.mjs`
- `scripts/_shared/report-analyst-synthesis.mjs`
- `scripts/_shared/report-narrative-plan.mjs`
- `scripts/_shared/report-chart-planner.mjs`
- `scripts/_shared/report-quality.mjs`

Remaining depth blockers are mostly data-backed:

- direct call transcript evidence for monitored symbols
- controlled event studies across benchmark, sector, factor, and regime controls
- independent mechanism evidence for causal edges
- named historical analogues with outcome and invalidator context

### 6.5 Data Bundle Richness

Problem:

Professional reports need more than article titles and a few metrics.

Missing or underused data:

- Theme subtopic movement.
- Theme evolution rows.
- Stock sensitivity rows.
- Regime conditional impact.
- Source diversity by publisher group.
- Event timeline.
- Market reaction windows.
- Cross-theme graph paths.
- Related company or supplier exposure.

Files to fix:

- `scripts/_shared/report-db-adapter.mjs`
- `scripts/_shared/report-evidence-bundle.mjs`
- `scripts/_shared/report-chart-planner.mjs`

Status:

Partially addressed through the deep research pack. The report now carries
separate lanes for market, fundamental, filing, transcript, industry, research,
policy, causal, historical, and feedback context. External provider backfill can
write fundamentals, valuations, and direct transcript excerpts through
`collect-free-external-data.mjs`.

The biggest remaining gap is not article count. It is primary evidence fit:
direct transcript excerpts, controlled market validation, and independently
validated causal mechanisms must be present before the report should claim
investment-memo readiness.

Relevant DB tables to use more deeply:

- `theme_trend_aggregates`
- `theme_evolution`
- `articles`
- `canonical_events`
- `article_event_map`
- `event_hawkes_intensity`
- `event_uplift`
- `regime_conditional_impact`
- `stock_sensitivity_matrix`
- `cross_theme_candidates`
- `knowledge_nodes`
- `knowledge_edges`
- `knowledge_edge_evidence`

### 6.6 Chart Quality

Problem:

Figures are currently valid report objects, but not yet strong analyst charts.

Needed charts:

- Theme movement over time.
- Source burst timeline.
- Event timeline.
- Event-window market reaction.
- Peer/related-symbol return comparison.
- Cross-theme graph.
- Scenario sensitivity.
- Freshness and trust heatmap.

Files to fix:

- `scripts/_shared/report-chart-planner.mjs`
- `scripts/_shared/report-chart-renderer.mjs`
- `scripts/_shared/report-compiler.mjs`
- `tests/report-chart-renderer.test.mjs`

Status:

Partially addressed. Figures now have one-line takeaways in the client memo, and
raw figure metadata remains in the audit appendix. The next quality step is to
increase real chart density, not to add more placeholder figure cards.

### 6.7 Data Mismatch Root Cause

Problem:

Some reports show mismatches such as:

```text
article_count = 0 in the aggregate window
recent_evidence_items = 6
```

The report now exposes this mismatch, but the system should also diagnose why it happened.

Possible causes:

- `theme_trend_aggregates` refresh lag.
- Period window mismatch.
- Article theme mapping changed after aggregate computation.
- Recent evidence comes from a different window than the selected aggregate.

Files to fix:

- `scripts/_shared/report-db-adapter.mjs`
- `scripts/_shared/report-quality.mjs`
- Add diagnostic helper, likely `scripts/_shared/report-data-diagnostics.mjs`
- Add `tests/report-data-diagnostics.test.mjs`

## 7. File Map

### Bundle construction

```text
scripts/_shared/report-evidence-bundle.mjs
```

Purpose:

- Defines report types.
- Normalizes evidence, metrics, claims, caveats, market reactions, figures, watch indicators.
- Builds sample and typed bundles.

Current issue:

- Bundle shape is good, but typed bundles need richer domain-specific fields.

### DB adapter

```text
scripts/_shared/report-db-adapter.mjs
```

Purpose:

- Pulls DB rows and converts them into report bundles.

Current issue:

- Subject binding is not strict enough.
- Some report types fallback to unrelated top candidates.
- Theme reports need more contextual DB data.

### Analyst draft

```text
scripts/_shared/report-llm-analyst.mjs
```

Purpose:

- Produces evidence-bound analyst sections.

Current issue:

- Better than before, but still too templated.
- Needs more subject-specific synthesis.
- Eventually should support a real external LLM provider behind strict validation.

### Compiler

```text
scripts/_shared/report-compiler.mjs
```

Purpose:

- Renders HTML and Markdown.

Current issue:

- Layout is functional but not yet premium report UX.
- Needs executive summary cards, grade/cap ribbon, evidence drawer links, chart gallery, and concise decision-first layout.

### Quality

```text
scripts/_shared/report-quality.mjs
```

Purpose:

- Scores report quality.

Current issue:

- Now separates artifact and analysis grades.
- Needs subject-fidelity scoring and pack-level scoring.

### Validator

```text
scripts/_shared/report-validator.mjs
```

Purpose:

- Blocks unsupported analysis, unknown numbers, stale omission, invalid refs, and forbidden recommendation language.

Current issue:

- Needs subject-fidelity validation.
- Needs report-pack validation.

### Local store and registry

```text
scripts/_shared/report-local-store.mjs
```

Purpose:

- Writes artifacts and registry.

Current issue:

- Registry UI is too thin.
- Needs pack grouping and grade-cap explanations.

### Artifacts and export

```text
scripts/_shared/report-artifacts.mjs
scripts/_shared/report-exporter.mjs
```

Purpose:

- Manifest, source query drafts, HTML/PPTX/PDF export support.

Current issue:

- Export exists, but PDF may be null depending on runtime availability.
- PPTX is generated but not yet a premium deck.

## 8. Immediate Next Implementation Plan

### Step 1: Subject-bound DB fetch

Implement strict subject matching.

Rules:

- If `requestedSubject` is `cloud-infrastructure`, event reports must use `canonical_events.theme = cloud-infrastructure`.
- Symbol reports must use `stock_sensitivity_matrix.theme = cloud-infrastructure`.
- Cross-theme reports must include the subject in candidate themes or node relations.
- If no match exists, emit a no-data subject-bound report, not unrelated fallback.

Acceptance test:

```text
tests/report-subject-fidelity.test.mjs
```

Must assert:

- Every generated report carries `metadata.requestedSubject`.
- Every generated report carries `metadata.subjectMatchStatus`.
- Unrelated fallback is not allowed unless explicitly requested with `allowFallback=true`.

### Step 2: Report pack manifest

Add a pack-level manifest.

Expected file:

```text
data/reports/<root>/PACK-<subject>-<timestamp>/pack.json
```

Fields:

- `packId`
- `requestedSubject`
- `reports`
- `missingReportTypes`
- `fallbackReports`
- `packGrade`
- `packCaveats`

### Step 3: Registry UI upgrade

Show useful columns:

- Pack
- Requested subject
- Report subject
- Subject match
- Final grade
- Artifact grade
- Analysis grade
- Grade caps
- Main caveats
- Generated

### Step 4: Analyst depth upgrade

Make `report-llm-analyst.mjs` type-specific.

Instead of generic phrasing, generate sections from typed bundle context:

- Theme: trend, source mix, subtopic, market proxy.
- Event: event sequence, evidence grade, market reaction.
- Regime: macro inputs, transmission links, causal limits.
- Cross-theme: pathway, supplier, evidence, seed lock-in.
- Symbol: exposure proxy, market reaction, validation quality.
- System: safe/unsafe outputs and remediation.

### Step 5: Chart upgrade

Use real chart data where available.

Do not call a report visually S-tier unless it has charts that answer analytical questions.

## 9. Current Honest Evaluation

Current state:

- Artifact pipeline: S-grade structure.
- Evidence/citation safety: strong.
- DB integration: working but subject fidelity needs strict enforcement.
- Registry UX: too thin.
- Report prose: better than before, but still template-heavy.
- Professional analyst-report depth: not there yet.

Current realistic grade:

```text
Infrastructure: A
Safety/validation: A
Subject fidelity: C
Registry UI: C
Analyst depth: B-
Commercial report product: B-
```

## 10. Definition Of Done For This Feature

The feature should not be considered complete until:

- A subject-bound report pack can be generated.
- No unrelated fallback report appears without explicit opt-in.
- The registry explains why a report is S/A/B/C.
- The report body includes subject-specific thesis, catalyst, market linkage, risks, scenarios, watch triggers, and conclusion.
- Charts are real analytical figures, not just placeholder figure objects.
- The quality score punishes shallow prose, missing market context, missing source diversity, stale data, and subject mismatch.
- A generated report can be read without code context and still answer: what changed, why it matters, what evidence supports it, what is uncertain, what to watch next.

## 11. Most Important Next Fix

The next code task should be:

```text
Subject-bound report pack generation.
```

Do not continue polishing prose until subject fidelity is fixed. A polished report about the wrong event, wrong symbol, or wrong cross-theme candidate is worse than a plain report that honestly says there is no subject-bound data.
