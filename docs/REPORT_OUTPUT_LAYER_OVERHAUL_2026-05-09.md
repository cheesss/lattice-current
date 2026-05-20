# Report Output Layer Overhaul - 2026-05-09

## Purpose

The report system must not render raw pipeline logs as the user-facing memo.
The client-facing report is now a thesis-driven memo. Provenance, metric
ledgers, figure IDs, evidence IDs, validation logs, and query manifests belong
in the audit appendix.

## Current Status - 2026-05-13

The output layer now produces a long-form research-prioritization memo with an
adaptive narrative structure rather than fixed section headings or short cards.
The latest report path tested before this update was:

```text
data/reports/RPT-theme-report-ai-ml-bd29314e5d/report.html
```

Browser QA on that artifact confirmed:

- 9 major `h2` headings.
- 42 rendered paragraphs.
- 6 exhibit cards.
- 0 forbidden client-memo terms from the report gate sample.
- 0 console errors.

The current report can reach S-grade artifact and triage usefulness while still
remaining C-grade investment readiness. That split is intentional. It means the
memo is useful for research prioritization, but the evidence bundle still lacks
the direct operating evidence required for investment-memo use.

## Output Contract

Each report directory contains:

- `report.html`: client memo only.
- `report.md`: client memo only.
- `audit_appendix.html`: raw provenance and validation surface.
- `audit_appendix.json`: machine-readable audit payload.
- `evidence_table.csv`: portable evidence ledger.
- `bundle.json`, `llm-analysis.json`, `validation.json`, `manifest.json`.
- `source-query-drafts.json`: executable evidence collection tasks.

The API serves the same split:

- `/api/reports/:id/html`
- `/api/reports/:id/audit`
- `/api/reports/:id/audit_appendix.html`
- `/api/reports/:id/evidence-csv`

## Analysis Pipeline

The deterministic analyst draft now inserts an output layer between raw
bundle data and final prose:

1. Evidence strength classes: A/B/C/D/E.
2. Metric calibration: raw value -> baseline status -> interpretation -> decision use.
3. Signal cards: attention, fundamental, market, constraint, causal, research/policy.
4. Analyst synthesis: thesis, strongest evidence, weakest evidence, mechanism,
   market implication, counter-thesis, invalidators, and research actions.
5. Semantic narrative blueprint.
6. Long-form client memo rendering with section-specific paragraph contracts.
7. Structural editor pass and mention-budget gates.
8. Audit appendix rendering.

The report body is no longer required to use one fixed table of contents. It
keeps a small verification contract but lets the narrative structure adapt to
the report type and subject:

- Cross-theme bottleneck reports can use headings such as `Why This Connector
  Matters`, `Shared Constraint Map`, `Evidence Ladder`, `Negative Controls`,
  and `What Would Promote / Reject This Candidate`.
- Theme reports can use headings such as `What the Market Is Trying to Decide`,
  `Attention vs Operating Evidence`, `Mechanism Test`, and `What Would Change
  the View`.
- Defense-industrial theme reports can shift toward `Backlog Conversion
  Question`, `Defense KPI Evidence Test`, and `Procurement-to-Production
  Mechanism`.
- Event, symbol, regime, and system-quality reports receive their own
  deterministic fallback archetypes.

This replaces the earlier card-like structure where `Core View`, `Context`,
`What Changed`, `Risks`, `Caveats`, `Watch Next`, and `Research Agenda` could
repeat similar short statements.

The public rendering contract remains `analysis.longFormSections[]`; HTML and
Markdown still render section titles from that array. The new internal contract
is `analysis.narrativeStructure`, which records:

- `provider`: `llm` or `deterministic_fallback`.
- `archetype`: the selected narrative archetype.
- `sections[]`: section key, title, role, required moves, anchors, risk level,
  and target words.
- `requiredRoleCoverage`: coverage of the fixed analytical roles.

The manifest mirrors this with:

- `narrative_structure_provider`
- `narrative_archetype`
- `section_role_coverage`
- `adaptive_structure_fallback_reason`

## Guardrails

Client memo output is blocked if it leaks:

- `refs N`
- `Metric Ledger`
- `Query Manifest`
- `claim:*`, `metric:*`, `evidence:*`, `figure:*`, `caveat:*`

Thin samples and sparse baselines are downgraded before memo synthesis. They can
drive research queue tasks, but they cannot support broad lifecycle conclusions.

Additional output-layer gates now enforced:

- Adaptive headings are allowed, but required analytical roles must still be
  covered: current judgment, evidence hierarchy, mechanism, counter-thesis,
  caveats, what changes the view, and research/action agenda.
- LLM-proposed outlines are rejected if they omit required roles, duplicate
  titles, expose raw system terms, or introduce unsupported entities, tickers,
  dates, or numbers in headings.
- If LLM outline validation fails, the report falls back to the deterministic
  archetype and records the fallback reason in the manifest.
- Event anchors are scored for thesis fit before being promoted into the memo.
- Low-fit anchors can support fragmentation or monitoring, but cannot validate
  the economic mechanism.
- Core thesis language is conditional when the evidence supports possible
  narrative rotation but does not prove thesis failure or success.
- Market anchors must include calibrated strength when available, such as
  relative return, t-stat, sample size, and decision-grade status.
- Exhibits must carry one-line takeaways, not only analytic questions.
- Research agenda tasks must include success criteria when they are expected to
  clear an investment-readiness blocker.

## Quality Model

`validation.quality` now separates:

- `artifactQuality`: schema/render/citation/export correctness.
- `triageUsefulness`: research-prioritization value.
- `analystMemoQuality`: long-form memo structure, editorial polish, and evidence
  caveat handling.
- `investmentReadinessQuality`: data-pack scope and hard blockers from the deep
  research layer.

Top-level grade remains for compatibility, but consumers should read `productTier`
and `investmentReadiness` before treating any report as an investment memo.

Known hard investment-readiness blockers:

- direct transcript coverage below threshold for the monitored symbol universe
- market reaction that has not cleared benchmark, sector, factor, and regime controls
- graph-derived causal edges without independent mechanism evidence
- missing or weak primary operating evidence for the report thesis

## Verification

Regression tests:

- `tests/report-content-quality.test.mjs`
- `tests/report-synthesis-layer.test.mjs`
- `tests/report-compiler.test.mjs`
- `tests/report-api-contract.test.mjs`
- `tests/report-cli.test.mjs`
- `tests/report-local-store.test.mjs`
- `tests/report-exporter.test.mjs`
- `tests/report-quality-gates.test.mjs`
- `tests/external-provider-backfill-targets.test.mjs`
- `tests/universal-research-orchestrator.test.mjs`

Manual QA target used for this change:

- `RPT-theme-report-ai-ml-bd29314e5d`
- `file:///C:/Users/chohj/Documents/Playground/lattice-current-fix/data/reports/RPT-theme-report-ai-ml-bd29314e5d/report.html`

Latest focused verification command:

```powershell
node --import tsx --test .\tests\report-*.test.mjs .\tests\universal-research-orchestrator.test.mjs .\tests\external-provider-backfill-targets.test.mjs
npx tsc --noEmit
```
