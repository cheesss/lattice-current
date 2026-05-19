# Cross-Theme Research OS Data Boundaries

Date: 2026-05-03

This document defines the hard write boundaries for the Cross-Theme Research OS.

## Layers

```text
private_tracking
  User-specific targets and watch preferences.

candidate_graph
  Machine-generated hypotheses from research questions, evidence bundles, relation extraction, and graph scoring.

trusted_graph
  Reviewed and evidence-backed cross-theme candidates. Trusted does not mean canonical.

canonical_taxonomy
  Product-wide official themes and relationships. This layer requires explicit human approval.
```

## Allowed Automatic Writes

Research OS automation may write only to these tables:

```text
research_os_policy
research_os_policy_proposals
research_questions
knowledge_nodes
knowledge_edges
knowledge_edge_evidence
research_evidence_bundles
cross_theme_candidates
adjacency_feedback
tracked_targets
tracked_target_hits
approval_queue
automation_budget_log
```

`approval_queue` writes are proposals, not canonical actions.

## Forbidden Automatic Writes

Research OS automation must not directly write to:

```text
discovery_topics
auto_article_themes
auto_theme_symbols
model_predictions
labeled_outcomes
theme_trend_aggregates
theme_evolution
canonical_events
event_features
```

Any future write path into those tables must go through an explicit reviewed migration or approval workflow.

## Promotion Rules

```text
candidate
-> accepted/watch feedback
-> trusted candidate
-> canonical-cross-theme-proposal in approval_queue
-> human approval
-> canonical mutation by a separate reviewed executor
```

The current implementation stops at trusted candidate plus canonical proposal. It does not mutate canonical taxonomy.

## LLM Boundary

LLM output may create candidate relations only after schema validation.

Hard rules:

- malformed JSON is rejected
- quote-less high-confidence claims are rejected or capped
- unsupported relation and node types are rejected
- single-source claims cannot become trusted by themselves
- LLM calls are budget-checked and logged before production use

## Source Expansion Boundary

Source expansion creates `approval_queue` items only.

It must not:

- auto-register untrusted sources
- bypass human approval
- spend past the configured daily source expansion budget
- write directly into canonical taxonomy

## Policy Boundary

Policy Advisor may create `research_os_policy_proposals`.

It must not directly change production policy without approval or bounded shadow mode.

## Test Expectations

The boundary test must verify:

- forbidden table list includes canonical/model/training tables
- no Research OS table has a hidden trigger into canonical/model tables
- candidate graph foreign keys only point to approved Research OS tables
- review actions persist without reappearing as unreviewed candidates
