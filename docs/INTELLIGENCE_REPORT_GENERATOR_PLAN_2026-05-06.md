# Intelligence Report Generator Plan

Date: 2026-05-06

Status: implementation plan

Scope: turn Lattice Signal Intelligence into an evidence-first intelligence report generator where quantitative signals select what matters, LLM/Codex adds constrained analytical interpretation, validators block unsupported output, and the dashboard exposes useful reports without polluting canonical data.

## Implementation Checkpoint - 2026-05-06

Implemented durable MVP slices:

- Artifact-first report generation under `data/reports/<report_id>/`.
- `report-evidence-bundle.mjs` for evidence-bound bundle construction.
- `report-chart-planner.mjs` for claim-linked deterministic figure specs.
- `report-chart-renderer.mjs` for static SVG figure assets.
- `report-validator.mjs` for unsupported claim, stale disclosure, low source diversity, numeric hallucination, chart, and forbidden investment-language gates.
- `report-quality.mjs` for S/A/B/C/D quality scoring.
- `report-llm-analyst.mjs` deterministic evidence-bound analyst layer with future provider gate.
- `report-compiler.mjs` for HTML and Markdown report output.
- `report-feedback.mjs` for append-only feedback and source-query need tracking.
- CLI scripts:
  - `scripts/build-report-bundle.mjs`
  - `scripts/generate-intelligence-report.mjs`
  - `scripts/validate-intelligence-report.mjs`
  - `scripts/render-intelligence-report.mjs`
  - `scripts/schedule-intelligence-reports.mjs`
- npm entrypoints:
  - `npm run report:generate`
  - `npm run report:bundle`
  - `npm run report:validate`
  - `npm run report:render`
  - `npm run report:schedule`
- API entrypoints:
  - `POST /api/reports/build-bundle`
  - `POST /api/reports/generate`
  - `GET /api/reports/:reportId`
  - `GET /api/reports/:reportId/html`
  - `GET /api/reports/:reportId/markdown`
  - `POST /api/reports/:reportId/validate`
  - `GET/POST /api/reports/:reportId/feedback`
- Regression tests:
  - `tests/report-evidence-bundle.test.mjs`
  - `tests/report-validator.test.mjs`
  - `tests/report-compiler.test.mjs`
  - `tests/report-chart-renderer.test.mjs`
  - `tests/report-cli.test.mjs`
  - `tests/report-api-contract.test.mjs`
  - `tests/report-feedback.test.mjs`

Verified:

```text
node --import tsx --test tests/report-*.test.mjs
npx tsc --noEmit
npm run report:generate -- --sample --type theme_report --subject "Cloud Infrastructure" --out-dir data/reports/npm-theme-sample
npm run report:generate -- --sample --type cross_theme_bottleneck_report --subject "Linde cryogenic cooling" --out-dir data/reports/npm-cross-theme-sample
```

Current artifact examples:

```text
data/reports/npm-theme-sample/report.html
data/reports/npm-cross-theme-sample/report.html
```

Remaining after the initial checkpoint:

- Dashboard buttons/drawer integration.
- External LLM provider execution. The analyst layer remains deterministic and provider-gated by default.
- Immutable DB tables for long-lived report registry and claim history.
- Full live source-query queue writes remain review-gated; artifact/source-query drafts are available.
- Scheduled daemon generation still needs production cadence and retention hardening.
- Investment-memo readiness still depends on direct transcript coverage, controlled market validation, and supported causal mechanisms.

Next implementation target:

```text
report drawer and dashboard buttons
-> live source-query review bridge
-> scheduled daemon hardening
-> direct transcript provider coverage
-> controlled event-study validation
```

## Implementation Checkpoint - 2026-05-10

The report generator has moved past the MVP artifact layer and now has a
long-form research memo layer. The current system is designed to produce
research-prioritization memos first and to block investment-memo readiness when
primary evidence is missing.

Implemented since the original checkpoint:

- DB-backed deep report generation for live theme subjects.
- Deep research pack coverage for market, fundamental, filing, transcript,
  industry, research, policy, causal, historical analog, and feedback lanes.
- Signal-card synthesis separating attention, fundamental, market, constraint,
  causal, and research/policy evidence.
- Semantic narrative blueprint before prose rendering.
- Long-form section renderer with paragraph-level flow:
  Executive Judgment -> Context and What Changed -> Evidence Assessment ->
  Economic Mechanism -> Market Implication and Scenarios -> Risks -> Research Agenda.
- Structural memo cleanup that removes raw system terms from the client body.
- Event anchor thesis-fit scoring.
- Market anchor calibration with relative-return magnitude, t-stat, sample
  size, and decision-grade status.
- Exhibit takeaways attached to figure metadata.
- Investment-readiness split from artifact quality and triage usefulness.
- Direct transcript coverage gate using `directTranscriptSymbolCount` and
  `requiredTranscriptSymbolCount`.
- FMP external adapter path for fundamentals, valuations, peers, estimates, and
  earnings call transcripts.
- `transcript_evidence` persistence for direct call-level excerpts.
- Report-generated source-query/backfill tasks for missing transcript coverage,
  KPI observations, and investment-depth gaps.

Current important distinction:

```text
artifactQuality can be S
triageUsefulness can be S
analystMemoQuality can still be capped
investmentReadinessQuality remains C until direct transcripts and controlled market validation are present
```

The current AI/ML report still shows `direct transcript coverage 0/3`. This is
not a prose problem. It is a real evidence gap. The correct fix is to collect
direct call transcript evidence for the monitored symbol universe and persist it
into `transcript_evidence`.

Latest tested artifact:

```text
data/reports/RPT-theme-report-ai-ml-bd29314e5d/report.html
```

Latest tested commands:

```powershell
node .\scripts\generate-intelligence-report.mjs --db --depth deep --type theme_report --subject "AI / Machine Learning"
node .\scripts\collect-free-external-data.mjs --theme ai-ml --label "AI / Machine Learning" --providers fmp --symbols MSFT,AMD,NVDA,META,GOOGL --force --throttle-hours 0
node --import tsx --test .\tests\report-*.test.mjs .\tests\universal-research-orchestrator.test.mjs .\tests\external-provider-backfill-targets.test.mjs
npx tsc --noEmit
```

Provider note:

The FMP path is wired, but the latest execution returned provider `HTTP 429`
for the tested symbols. That should stay visible as a provider quota/rate-limit
state rather than being hidden by the report writer.

## 0. Executive Direction

The report product should not be an AI summary feature. It should be a report operating layer over the existing Lattice signal system.

Target architecture:

```text
Signal scoring and pipelines
-> evidence bundle
-> claim candidates
-> chart specs
-> LLM/Codex analytical layer
-> factual validator
-> report compiler
-> UI report drawer/page/export
-> feedback and source-query loop
```

The central rule:

```text
The quantitative system selects and bounds the facts.
LLM/Codex writes constrained analysis, alternatives, caveats, and next questions.
Validators decide whether output is safe to show.
Human actions decide whether candidates become watch/private/canonical workflow items.
```

This plan directly extends the current project direction:

- The product is signal-based decision support, not backtesting.
- The dashboard already has Theme Brief, Actionable Signals, Evidence Rows, Cross-Theme Research, Decision Inbox, Ops, model trust, and source queue surfaces.
- Cross-Theme Research OS already separates candidate, private, and canonical writes.
- S-tier user value work already added brief structure, evidence coverage, model trust, theme framing, recommended action, and product quality metrics.
- The missing layer is a reproducible report artifact that binds claim, evidence, metric, figure, caveat, and query manifest.

## 1. Non-Negotiable Product Principles

### 1.1 Evidence-First

LLM/Codex must never be the source of record. The source of record is the evidence bundle produced from DB/API/cache data.

Every report claim must point to at least one of:

- evidence item
- metric fact
- market reaction
- figure object
- caveat or information gap
- validated analyst note

### 1.2 Claim-Led, Not Paragraph-Led

Reports are not free-form essays. They are compiled from claim objects.

Each claim has:

- `claim_id`
- `claim_type`
- `canonical_text`
- `generated_text`
- `confidence_level`
- `supporting_evidence_ids`
- `supporting_metric_ids`
- `supporting_figure_ids`
- `contrary_evidence_ids`
- `caveat_ids`
- `scope`
- `validation_status`

### 1.3 LLM/Codex as Analyst, Not Authority

LLM/Codex can:

- rewrite claim candidates into readable key judgments
- explain why a signal may matter
- propose alternative explanations
- identify information gaps
- propose watch indicators
- propose source queries
- draft caveats
- generate analyst notes
- organize evidence into report sections

LLM/Codex cannot:

- invent companies, tickers, events, dates, or numbers
- upgrade evidence grade
- mark a pending signal as validated
- promote candidates into canonical taxonomy
- hide stale data
- convert market reaction into investment advice
- override scoring gates without a separate hypothesis label

### 1.4 Root-Cause Fix Before Narrative Workaround

If a report detects stale data, missing uplift, broken source hydration, empty theme-symbol mapping, or failed evidence collection, the system should not simply explain the defect. It must create a remediation task or source/query/repair action.

Allowed:

- show caveat
- block publish
- queue repair/source-query task
- mark report as draft or degraded

Not allowed:

- use a banner as a permanent fix
- use LLM wording to make weak data sound strong
- report old validated cards as current actionable signals

### 1.5 Candidate/Private/Canonical Boundary

Report generation can write:

- report artifacts
- report feedback
- analyst notes
- source-query proposals
- private tracking targets
- candidate decisions

Report generation cannot directly write:

- canonical theme promotion
- canonical source activation
- canonical symbol mapping
- market validation tables

Those writes remain review-gated through existing queues.

## 2. Current Lattice Assets to Reuse

The report product should reuse current assets instead of creating a parallel data stack.

### 2.1 Existing API/Data Surfaces

Relevant current components:

- `scripts/event-dashboard-api.mjs`
- `scripts/_shared/event-intelligence-builder.mjs`
- `scripts/_shared/event-product-score.mjs`
- `scripts/_shared/product-quality-metrics.mjs`
- `scripts/_shared/trend-workbench.mjs`
- `scripts/_shared/cross-theme-api.mjs`
- `scripts/_shared/evidence-collector.mjs`
- `scripts/_shared/tracking-targets.mjs`
- `scripts/_shared/source-query-executor.mjs`
- `scripts/_shared/research-question-generator.mjs`
- `scripts/_shared/adjacency-graph.mjs`
- `scripts/_shared/research-os-policy.mjs`

### 2.2 Existing UI Surfaces

Current dashboard surfaces already correspond to report sections:

- Actionable Signals -> event signal report
- Theme Brief -> theme change report
- Cross-Theme Research -> bottleneck report
- Regime Strip and Scenario Lab -> regime/transmission report
- Evidence Rows and Evidence Drawer -> evidence appendix
- Ops -> system quality report
- Decision Inbox and Approval Queue -> report feedback and source-query review

### 2.3 Existing Metrics and Signals

Report bundles should consume:

- `evidence_grade`
- `uplift`
- `t_stat`
- `alpha`
- `controls`
- `hawkes_temperature`
- `event_intensity`
- `theme lifecycle`
- `YoY`
- `acceleration`
- `source diversity`
- `modelTrust`
- `Brier`
- `ECE`
- `freshness`
- `source status`
- `cross_theme score`
- `novelty`
- `seed similarity`
- `source-query status`
- `candidate lane`

## 3. Report Types

### 3.1 Event Signal Report

Purpose: explain a specific event cluster, why it matters, whether it has validated market reaction, and what to watch next.

Primary inputs:

- event cluster
- article/evidence chain
- event uplift rows
- evidence grade
- related symbols/themes
- price reaction window
- controls and validation status
- freshness and caveats

Sections:

1. Header
2. Key Judgments
3. What Happened
4. Event Timeline
5. Evidence Chain
6. Market Transmission
7. Related Themes and Symbols
8. Alternative Explanations
9. Caveats
10. Watch Next
11. Evidence Appendix

LLM/Codex contribution:

- explain causal pathways as hypotheses
- describe alternative explanations
- summarize why the event may or may not be actionable
- propose next source queries

Hard blocks:

- no report can call an event "validated" without validation status or E2+ evidence.
- no stale actionable signal can be presented as current without explicit stale caveat.
- no durable alpha claim from short-window event uplift.

### 3.2 Theme Change Report

Purpose: explain structural movement in a theme across lifecycle, acceleration, article breadth, subtopic movement, and source quality.

Primary inputs:

- theme trend aggregate
- lifecycle transition
- source diversity
- article volume time series
- subtopic movement
- related events
- related symbols
- followed/suggested state

Sections:

1. Header
2. Key Judgments
3. Lifecycle Change
4. Trend Metrics
5. Subtopic Movement
6. Source Diversity and Freshness
7. Related Events
8. Related Companies/Sectors
9. Alternative Explanations
10. Caveats
11. Watch Next

LLM/Codex contribution:

- turn raw lifecycle movement into readable structural interpretation
- distinguish real trend from small-baseline distortion
- propose missing evidence classes
- suggest adjacent pathways or related source queries

Hard blocks:

- volume-only trend cannot be called structural.
- near-zero baseline distortion must be stated.
- low source diversity lowers confidence.

### 3.3 Regime and Transmission Report

Purpose: explain macro/geopolitical regime state and how events transmit into commodities, sectors, countries, and symbols.

Primary inputs:

- regime label and confidence
- VIX, oil, dollar, yield spread, HY credit
- country/corridor pressure
- event-market transmission edges
- related commodities/sectors/rates
- scenario lab output

Sections:

1. Header
2. Current Regime
3. Trigger Events
4. Macro Context
5. Country/Corridor Pressure
6. Transmission Pathways
7. Sector and Asset Impact
8. Scenario Table
9. Risks and Invalidating Signals
10. Watch Next

LLM/Codex contribution:

- explain transmission mechanisms as typed hypotheses
- propose scenario narratives
- identify invalidating indicators
- separate correlation from causation

Hard blocks:

- every transmission edge must disclose `edge_type`.
- correlation cannot be worded as causation.
- scenario probabilities require explicit model or analyst basis.

### 3.4 Cross-Theme Bottleneck Report

Purpose: explain hidden cross-theme connectors such as materials, infrastructure, suppliers, components, and companies.

Primary inputs:

- cross-theme candidates
- theme pairs
- candidate score
- evidence score
- source score
- novelty
- seed similarity
- graph path
- source query status
- review state
- private/canonical boundary

Sections:

1. Header
2. Key Judgment
3. Theme Intersection
4. Component/Material/Supplier Pathway
5. Evidence Timeline
6. Supplier/Peer Map
7. Related Companies
8. Information Gaps
9. Source Queries Needed
10. Decision: Accept/Watch/Reject/Track Privately/Add Source Query

LLM/Codex contribution:

- explain why a connector may matter
- propose missing source classes
- generate source-query candidates
- generate alternative connector hypotheses
- explain seed-lock-in risk

Hard blocks:

- candidate remains candidate unless review-gated.
- high seed similarity must cap confidence.
- source-query exhausted state must trigger alternative source strategy, not repeated same query.

### 3.5 Symbol and Sector Signal Report

Purpose: explain how a ticker, ETF, or sector is exposed to themes, events, and regime changes.

Primary inputs:

- symbol price series
- theme-symbol mapping
- sensitivity matrix
- what-if output
- related events
- related theme movements
- validation snapshot
- sector/peer movement

Sections:

1. Header
2. Signal Summary
3. Exposure Map
4. Catalysts
5. Relative Performance
6. Sensitivity and What-if
7. Validation Snapshot
8. Risks
9. Watch Next

LLM/Codex contribution:

- convert exposure relationships into readable thesis-like framing
- identify contrary exposure
- propose peer comparison set
- propose data gaps

Hard blocks:

- no investment recommendation by default.
- no "buy/sell" language without separate compliance-gated module.
- weak mapping or stale prices must downgrade confidence.

### 3.6 System Quality Report

Purpose: tell the operator what is safe to trust and what is currently degraded.

Primary inputs:

- model trust
- Brier/ECE
- stale predictions
- DB health
- data freshness
- pending validation
- source registry
- source query queue
- daemon task status
- repair tasks

Sections:

1. Header
2. System State
3. Data Freshness
4. Model Trust
5. Validation Backlog
6. Source Health
7. Safe To Trust
8. Not Trusted Yet
9. Remediation Actions

LLM/Codex contribution:

- summarize operational impact
- convert issues into remediation plan
- identify root-cause repair path

Hard blocks:

- do not hide operational degradation.
- do not call API output live when dependencies are stale or unreachable.

## 4. Evidence Bundle v0 Contract

### 4.1 Bundle Shape

```json
{
  "bundleId": "EB-2026-05-06-000001",
  "reportType": "theme_report",
  "subject": {
    "subjectType": "theme",
    "subjectId": "cloud-infrastructure",
    "displayName": "Cloud Infrastructure"
  },
  "coverageWindow": {
    "start": "2026-04-01T00:00:00.000Z",
    "end": "2026-05-06T00:00:00.000Z"
  },
  "asOf": "2026-05-06T00:00:00.000Z",
  "dataFreshness": [],
  "sourceSummary": {},
  "claims": [],
  "evidence": [],
  "metrics": [],
  "marketReactions": [],
  "figures": [],
  "caveats": [],
  "watchIndicators": [],
  "queryManifest": {}
}
```

### 4.2 Claim Object

```json
{
  "claimId": "CLM-001",
  "claimType": "analytic_judgment",
  "canonicalText": "Cloud Infrastructure shows positive year-over-year movement but weakening near-term acceleration.",
  "generatedText": null,
  "confidenceLevel": "medium",
  "supportingEvidenceIds": [],
  "supportingMetricIds": ["MET-001", "MET-002"],
  "supportingFigureIds": ["FIG-001"],
  "contraryEvidenceIds": [],
  "caveatIds": ["CAV-001"],
  "scope": "weekly lens",
  "validationStatus": "candidate"
}
```

### 4.3 Evidence Object

```json
{
  "evidenceId": "EVID-001",
  "kind": "news_article",
  "sourceId": "SRC-001",
  "publisher": "Utility Dive",
  "title": "Southern Co. electricity sales soar on data center growth",
  "publishedAt": "2026-05-01T00:00:00.000Z",
  "ingestedAt": "2026-05-01T00:15:00.000Z",
  "url": "internal-or-original-url",
  "sourceQualityScore": 0.82,
  "sourceDiversityGroup": "trade_publication",
  "evidenceGrade": "E1",
  "freshnessStatus": "fresh",
  "atomicFacts": [],
  "limitations": []
}
```

### 4.4 Metric Object

```json
{
  "metricId": "MET-001",
  "kind": "theme_trend",
  "name": "acceleration",
  "value": -843.68,
  "unit": "percent_change",
  "window": "week",
  "asOf": "2026-05-06T00:00:00.000Z",
  "calculationVersion": "theme-trend-v1",
  "inputHash": "sha256:...",
  "limitations": ["near_zero_baseline"]
}
```

### 4.5 Caveat Object

```json
{
  "caveatId": "CAV-001",
  "severity": "medium",
  "type": "baseline_distortion",
  "text": "Acceleration is unstable because the prior comparison base is small.",
  "appliesToClaimIds": ["CLM-001"],
  "blocker": false
}
```

### 4.6 Figure Object

```json
{
  "figureId": "FIG-001",
  "title": "Weekly article volume and acceleration",
  "chartType": "line_column",
  "visualVocabularyCategory": "change_over_time",
  "analyticQuestion": "Did theme coverage rise while acceleration weakened?",
  "dataRefIds": ["MET-001", "TS-001"],
  "supportedClaimIds": ["CLM-001"],
  "caveatIds": ["CAV-001"],
  "dataAsOf": "2026-05-06T00:00:00.000Z",
  "renderAssetId": null
}
```

## 5. LLM/Codex Analytical Layer

### 5.1 Input

LLM/Codex receives only:

- report intent
- section plan
- evidence bundle
- claim candidates
- citation rules
- allowed vocabulary
- forbidden actions

### 5.2 Output

LLM/Codex must output structured JSON:

```json
{
  "keyJudgments": [
    {
      "text": "The signal supports watch-level attention, not canonical promotion, because evidence remains thin despite a strong connector score.",
      "claimIds": ["CLM-001"],
      "evidenceIds": ["EVID-001"],
      "metricIds": ["MET-001"],
      "figureIds": ["FIG-001"],
      "caveatIds": ["CAV-001"],
      "confidence": "medium"
    }
  ],
  "alternativeExplanations": [
    {
      "text": "The connector may reflect seed overlap rather than independent industrial dependence.",
      "claimIds": ["CLM-002"],
      "caveatIds": ["CAV-002"]
    }
  ],
  "informationGaps": [],
  "watchNext": [],
  "sourceQueries": [],
  "analystNotes": []
}
```

### 5.3 Prompt Policy

The model prompt must include:

```text
You are an evidence-bound analyst.
Use only facts, metrics, entities, tickers, dates, figures, and caveats in the bundle.
Do not add external facts.
Do not upgrade validation status.
Do not turn a candidate into a canonical conclusion.
Do not hide stale data.
Do not produce investment advice.
Every factual sentence must reference claimIds, evidenceIds, metricIds, figureIds, or caveatIds.
If evidence is weak, explicitly say it is weak.
If data is stale, explicitly say it is stale.
Prefer "supports", "suggests", "is consistent with", "candidate", "watch-level" unless validationStatus is validated.
```

### 5.4 LLM Contribution Score

LLM output should be measured by:

- alternative explanation count
- caveat completeness
- watch indicator usefulness
- source query usefulness
- unsupported claim count
- stale disclosure correctness
- human feedback rating

LLM verbosity is not a quality metric.

## 6. Report Validator

### 6.1 Validator Modules

Implement:

- citation validator
- numeric validator
- entity whitelist validator
- stale disclosure validator
- confidence validator
- figure validator
- caveat validator
- unsupported claim validator
- forbidden language validator

### 6.2 Publish Blockers

Block report if:

- key judgment has no claim id
- claim has no evidence, metric, figure, or caveat link
- generated number does not exactly match bundle metric
- generated entity/ticker is not in bundle whitelist
- stale data is used without caveat
- source diversity is low and undisclosed
- pending validation is described as validated
- chart has no supported claim
- chart has no data hash or `dataAsOf`
- LLM creates unsupported causal claim
- report uses investment recommendation language

### 6.3 Validation Output

```json
{
  "status": "blocked",
  "qualityScore": 0.72,
  "blockers": [
    {
      "type": "unsupported_entity",
      "message": "Generated ticker AIR.PA is not in bundle entity whitelist.",
      "sectionId": "related_companies"
    }
  ],
  "warnings": []
}
```

## 7. Chart Planner and Renderer

### 7.1 MVP Chart Types

Start with five chart families:

- `line_column`: article volume plus intensity/acceleration
- `indexed_return`: related symbols/ETF normalized to 100
- `timeline`: event/evidence timeline
- `lollipop`: ranked metric comparison
- `network`: cross-theme component/supplier graph

### 7.2 Chart Selection Policy

The chart planner should be deterministic:

- event report -> timeline, indexed return, uplift lollipop
- theme report -> volume/acceleration line, subtopic lollipop, source diversity lollipop
- regime report -> macro small multiples, country pressure lollipop, transmission network
- cross-theme report -> theme-component-supplier network, evidence timeline, peer indexed return
- system quality report -> freshness heatmap, backlog aging bar, model trust chart

### 7.3 Chart Guardrails

Every chart must have:

- analytic question
- supported claim ids
- data refs
- data as-of
- caveat ids when needed
- chart type whitelist
- render hash after rendering

No wallpaper charts. If the chart does not support a report claim, move it to appendix or omit it.

## 8. Report Compiler

### 8.1 HTML as Source of Truth

MVP should produce:

- JSON manifest
- HTML report
- Markdown report

Do not start with PDF/PPTX. They come after stable report manifest and chart assets.

### 8.2 Report Layout

Recommended layout:

```text
Header
Quality ribbon
Executive brief
Key judgments
What changed
Evidence base
Timeline
Analysis
Alternative explanations
Caveats
Watch next
Appendix
```

### 8.3 Quality Ribbon

Each report must show:

- evidence coverage
- citation integrity
- freshness status
- source diversity
- validation status
- model/data caveats
- report quality score

This is important for trust. The user should know whether the report is strong, weak, stale, or blocked.

## 9. UI Integration Plan

### 9.1 Entry Points

Add report actions to existing surfaces:

- Theme Brief: `Generate Theme Report`
- Cross-Theme Research candidate: `Generate Bottleneck Report`
- Actionable Signal card: `Generate Event Report`
- Regime Strip / Scenario Lab: `Generate Regime Report`
- Symbol exposure cards: `Generate Symbol Report`
- Ops: `Generate System Quality Report`

### 9.2 UI Surfaces

Implement in this order:

1. report preview drawer
2. full report route or panel
3. evidence drawer integration
4. chart gallery
5. analyst notes
6. export dialog

### 9.3 Avoid Dashboard Bloat

Do not add full reports directly into the home dashboard. Reports should open in a drawer or dedicated report view.

Home should show:

- report card title
- status
- quality score
- top judgment
- top caveat
- open report button

## 10. API Plan

### 10.1 MVP Endpoints

Add routes to `scripts/event-dashboard-api.mjs` or a separate report API module:

```text
POST /api/reports/build-bundle
POST /api/reports/generate
GET  /api/reports/:reportId
GET  /api/reports/:reportId/manifest
GET  /api/reports/:reportId/evidence
POST /api/reports/:reportId/validate
POST /api/reports/:reportId/feedback
```

### 10.2 Later Endpoints

```text
POST /api/reports/:reportId/export
POST /api/reports/:reportId/analyst-notes
POST /api/reports/:reportId/source-query
POST /api/reports/schedule
GET  /api/reports/scheduled
GET  /api/reports/quality-summary
```

### 10.3 Artifact Storage Before DB Tables

MVP should store immutable artifacts under:

```text
data/reports/
  <report_id>/
    bundle.json
    llm-analysis.json
    validation.json
    manifest.json
    report.html
    report.md
    figures/
```

After the artifact contract is stable, migrate to DB tables.

## 11. Proposed Files

### 11.1 New Shared Modules

```text
scripts/_shared/report-evidence-bundle.mjs
scripts/_shared/report-claim-builder.mjs
scripts/_shared/report-llm-analyst.mjs
scripts/_shared/report-validator.mjs
scripts/_shared/report-chart-planner.mjs
scripts/_shared/report-compiler.mjs
scripts/_shared/report-quality.mjs
```

### 11.2 New Scripts

```text
scripts/build-report-bundle.mjs
scripts/generate-intelligence-report.mjs
scripts/validate-intelligence-report.mjs
scripts/render-intelligence-report.mjs
scripts/schedule-intelligence-reports.mjs
```

### 11.3 New Tests

```text
tests/report-evidence-bundle.test.mjs
tests/report-validator.test.mjs
tests/report-compiler.test.mjs
tests/report-llm-analyst-contract.test.mjs
tests/report-chart-planner.test.mjs
tests/report-api-contract.test.mjs
```

### 11.4 Optional Later DB Migration

```text
scripts/migrations/schema-intelligence-reports.mjs
```

## 12. Implementation Roadmap

### Phase 0: Document and Guardrails

Deliverables:

- this plan
- update agent docs with evidence-bound LLM reporting rules
- add report artifact directory to `.gitignore` if needed

Exit criteria:

- report generation rules are documented
- LLM boundaries are explicit
- no code path can claim LLM is authoritative

### Phase 1: Deterministic Bundle MVP

Deliverables:

- `report-evidence-bundle.mjs`
- `build-report-bundle.mjs`
- theme report bundle support
- cross-theme bottleneck bundle support
- deterministic claims, metrics, caveats

Exit criteria:

- bundle validates without LLM
- bundle includes source freshness
- bundle includes caveats for weak/stale data
- tests cover empty data, stale data, and missing evidence

### Phase 2: Validator MVP

Deliverables:

- `report-validator.mjs`
- validation CLI
- blocker/warning model
- report quality score v0

Exit criteria:

- unsupported claim fails
- unknown ticker fails
- numeric mismatch fails
- stale-without-caveat fails
- low-source-diversity warning/block works

### Phase 3: Deterministic Report Compiler

Deliverables:

- `report-compiler.mjs`
- HTML report output
- Markdown report output
- evidence appendix
- caveat section

Exit criteria:

- one theme report can be generated without LLM
- one cross-theme report can be generated without LLM
- report is useful even when LLM is disabled

### Phase 4: LLM/Codex Analyst Layer

Deliverables:

- `report-llm-analyst.mjs`
- structured JSON output
- budget gate
- provider disabled by default unless env/policy set
- prompt with evidence-bound rules

Exit criteria:

- LLM adds key judgments, alternatives, information gaps, watch next
- validator can block bad LLM output
- deterministic report still works if LLM unavailable

### Phase 5: Chart Planner

Deliverables:

- `report-chart-planner.mjs`
- chart spec JSON
- static SVG/HTML rendering placeholder or simple inline chart
- figure ledger

Exit criteria:

- chart has claim link
- chart has data-as-of
- unsupported chart is omitted

### Phase 6: API Integration

Deliverables:

- report generation endpoint
- report fetch endpoint
- validation endpoint
- artifact storage

Exit criteria:

- dashboard can request report generation
- report artifact can be reloaded
- failed validation returns actionable errors

### Phase 7: Dashboard Integration

Deliverables:

- report preview drawer
- report buttons on Theme Brief and Cross-Theme cards
- evidence drawer linkage
- report quality ribbon

Exit criteria:

- user can generate and view report from existing dashboard
- UI does not add noisy duplicate panels
- report clearly states stale/weak data

### Phase 8: Feedback Loop

Deliverables:

- report feedback endpoint
- claim feedback endpoint
- source-query proposal from report gaps
- analyst note capture

Exit criteria:

- user feedback writes audit trail
- `Need source query` creates review-gated source query
- `Too speculative` lowers prompt/rubric confidence for similar future reports

### Phase 9: Scheduled Briefings

Deliverables:

- scheduled report script
- followed theme weekly report
- system quality daily report
- cross-theme candidate weekly report

Exit criteria:

- scheduled reports are draft by default
- no automatic publish without validation
- stale dependencies block or degrade reports

### Phase 10: Export and S-Tier Hardening

Deliverables:

- PDF export
- PPTX export
- immutable DB storage
- claim version history
- audit trail
- report quality dashboard
- permission/compliance layer

Exit criteria:

- report is reproducible from manifest
- claim/evidence/figure chain is auditable
- exports match HTML source of truth
- no hallucinated claims pass validation

## 13. Quality Gates

### 13.1 Report Quality Score

```text
Report Quality Score =
  0.25 Evidence Coverage
+ 0.15 Citation Integrity
+ 0.15 Freshness Disclosure
+ 0.10 Chart Relevance
+ 0.10 Caveat Completeness
+ 0.10 Analytical Rigor
+ 0.10 Actionability
+ 0.05 Export Integrity
```

### 13.2 S-Tier Targets

S-tier report generator requires:

- evidence coverage >= 0.98
- citation integrity = 1.00
- numeric exactness = 1.00
- stale disclosure = 1.00
- unsupported claim count = 0
- chart relevance >= 0.90
- caveat completeness >= 0.95
- watch indicator actionability >= 0.85
- export consistency = 1.00

### 13.3 Continuous Improvement Loop

This project must not stop after one passing MVP. Each cycle must:

```text
generate reports
-> validate reports
-> inspect failures
-> fix root data/pipeline/validator issue
-> regenerate
-> compare quality metrics
-> update next target
-> repeat
```

The next target is not fixed forever. It is selected from the largest quality deficit:

- evidence coverage deficit
- freshness deficit
- caveat deficit
- source diversity deficit
- chart relevance deficit
- actionability deficit
- unsupported claim risk
- user feedback signal

## 14. Risks and Mitigations

### 14.1 LLM Hallucination

Risk: LLM invents entities, numbers, dates, or causal paths.

Mitigation:

- evidence bundle whitelist
- structured JSON output
- entity validator
- numeric exact validator
- unsupported claim blocker

### 14.2 Stale Data Presented as Current

Risk: report sounds fresh while NAS/API/model data is stale.

Mitigation:

- data freshness per dataset
- stale caveat required
- report status `degraded` or `blocked`
- root repair task generated

### 14.3 Chart Wallpaper

Risk: many charts, low decision value.

Mitigation:

- analytic question required
- supported claim ids required
- quick report max 3 charts
- full report body max 8 charts
- appendix for secondary charts

### 14.4 Seed Lock-In

Risk: reports keep repeating user-provided seeds such as Linde/cryogenics and miss new fields.

Mitigation:

- include graph-frontier candidates
- compare seed similarity and novelty
- cap seed-dependent ranking
- require source expansion outside seed cluster
- scheduled incoming-connection mining

### 14.5 Canonical Pollution

Risk: report generation promotes bad candidates.

Mitigation:

- report writes artifacts only
- canonical promotion remains review-gated
- source activation remains approval-gated
- private tracking remains isolated

### 14.6 Over-Explaining Broken Pipelines

Risk: reports explain why something is stale instead of fixing stale pipeline.

Mitigation:

- stale caveat plus remediation task
- validation blocker for critical stale data
- no permanent fallback as product feature

## 15. First Implementation Slice

The first implementation slice should be small and durable:

```text
1. report-evidence-bundle.mjs
2. report-validator.mjs
3. report-compiler.mjs
4. build-report-bundle.mjs
5. generate-intelligence-report.mjs
6. theme_report support
7. cross_theme_bottleneck_report support
8. HTML/Markdown artifact output
9. tests for stale/unsupported/numeric/caveat cases
10. no LLM required for pass
```

Then add LLM/Codex:

```text
1. report-llm-analyst.mjs
2. structured JSON prompt
3. validator against LLM output
4. source-query suggestions
5. alternative explanations
6. watch indicators
```

This order matters. If LLM is added first, the system will produce plausible prose before it produces trustworthy intelligence.

## 15.1 Artifact-First Implementation Status

Implemented on 2026-05-06 with live integrations intentionally deferred:

- 6 report bundle builders now exist: `theme_report`, `event_signal_report`, `regime_transmission_report`, `cross_theme_bottleneck_report`, `symbol_signal_report`, and `system_quality_report`.
- Every sample report type produces a claim-bound evidence bundle, deterministic evidence-bound analyst draft, planned figures, watch indicators, caveats, and source-query drafts.
- The chart planner links figures back into claim ledgers so key judgments can trace through `claim_id -> evidence/metric/figure/caveat`.
- The generator writes reproducible artifacts: `bundle.json`, `llm-analysis.json`, `validation.json`, `source-query-drafts.json`, `manifest.json`, `report.html`, `report.md`, and SVG figure assets.
- `manifest.json` now records figure metadata, source-query draft counts, artifact hashes, validation status, and quality grade.
- Validation now blocks unsupported claims, stale data without caveats, low source diversity without caveats, hallucinated numbers, forbidden investment recommendation language, overconfident validated/confirmed language on candidate claims, missing remediation paths, and missing rendered figure assets at publish time.
- `/api/reports/*` remains artifact-only and does not mutate canonical taxonomy, source registry, source queue, or model state.
- A DB-free local report store now records `_registry.jsonl`, `_source-query-queue.jsonl`, per-report artifacts, and `index.html`.
- `npm run report:index` lists local reports and rewrites the local HTML report registry.
- `npm run report:schedule -- --generate-samples` can generate all six offline sample report types into the local registry without DB access.
- `npm run report:export -- --report-dir <reportDir>` writes print HTML and a real `.pptx` deck artifact; `--pdf` additionally renders a PDF through Playwright when browser runtime is available.
- `/api/reports/latest`, `/api/reports/source-queue`, `/api/reports/index`, and `/api/reports/:reportId/export` expose the artifact registry, source-query draft queue, local HTML index, and DB-free export action.

## 15.2 DB-Backed Implementation Status

Implemented after PostgreSQL was made available:

- `scripts/_shared/report-db-adapter.mjs` maps PostgreSQL rows into the same evidence-first bundle contract.
- `npm run report:bundle -- --db --type <report_type>` builds DB-backed bundles.
- `npm run report:generate -- --db --type <report_type> --report-root data/reports/db-live-registry` generates DB-backed report artifacts.
- `POST /api/reports/generate` and `POST /api/reports/build-bundle` accept `{"db": true}` or `{"source": "db"}` to use live PostgreSQL data.
- DB-backed report generation still writes through the artifact store first. Canonical promotion and source activation remain review-gated.

Current DB-backed data mapping:

- `theme_report`: `theme_trend_aggregates` + recent `articles`
- `event_signal_report`: `canonical_events`, `article_event_map`, `articles`, `event_hawkes_intensity`, `event_uplift`
- `cross_theme_bottleneck_report`: `cross_theme_candidates`, `knowledge_nodes`, `knowledge_edges`, `knowledge_edge_evidence`
- `regime_transmission_report`: `market_quotes`, `regime_conditional_impact`
- `symbol_signal_report`: `stock_sensitivity_matrix`, `market_quotes`
- `system_quality_report`: table counts/freshness, `model_eval`, `approval_queue`

Verification snapshot:

```text
node --import tsx --test tests/report-*.test.mjs
22/22 pass

npx tsc --noEmit
pass

sample generation for all 6 report types
theme_report passed S 1
event_signal_report passed S 1
regime_transmission_report passed S 1
cross_theme_bottleneck_report passed S 1
symbol_signal_report passed S 1
system_quality_report passed S 1

npm run report:schedule -- --generate-samples --report-root data/reports/offline-s-tier-registry --out-dir data/reports/offline-s-tier-schedule
6 generated reports, all passed S 1

npm run report:export -- --report-dir data/reports/offline-s-tier-registry/<reportId> --pdf
print HTML, PPTX, and PDF generated

npm run report:generate -- --db --type <each report type> --report-root data/reports/db-live-registry
6 DB-backed reports generated, all passed S, actionability 1.00

npm run report:export -- --report-dir data/reports/db-live-registry/<reportId> --pdf
DB-backed report PDF/PPTX generated
```

Deferred live integration, by design:

- external LLM provider calls
- immutable DB-backed report registry
- live source-query queue writes
- scheduled daemon generation

Offline pre-DB replacements now available:

- dashboard/API listing replacement: `/api/reports/latest` and `/api/reports/index`
- local report registry replacement: `_registry.jsonl`
- local source-query queue replacement: `_source-query-queue.jsonl`
- offline scheduled generation replacement: `report:schedule -- --generate-samples`
- offline export replacement: `report:export` for print HTML, PPTX, and optional PDF

## 16. Definition of Done

The report product is not done when it can generate a nice HTML page. It is done when:

- every key judgment is traceable
- every number is reproducible
- every chart supports a claim
- every weak data condition is disclosed
- every stale condition has a repair path
- every LLM sentence is validated or blocked
- every export matches the manifest
- every user action creates feedback or an auditable decision
- canonical data is never mutated by report generation directly

S-tier final state:

```text
Lattice becomes an evidence operating system that produces intelligence reports.
The user trusts the claim/evidence/metric/figure/query chain, not the LLM prose.
```
