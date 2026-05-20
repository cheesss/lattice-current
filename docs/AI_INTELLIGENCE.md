# AI Intelligence

This document describes the AI and reasoning layers that remain active on the main branch.

## Current role of AI

AI in this repository supports:

- summarization and briefing
- retrieval and evidence lookup
- narrative interpretation
- operator research workflows
- structured event reasoning assistance

AI is not the main branch's autonomous trading engine.

## Active AI surfaces

## 2026-04-22 Quality Gates

The dashboard and OpenClaw briefing surfaces now apply explicit evidence gates before showing AI-assisted suggestions as operator-facing information:

- Live status excludes opaque discovery IDs such as `dt-*` and uses canonical theme labels.
- Daily digest falls back to current article evidence without marking fresh selected-date data as stale.
- Discovery triage suppresses stale, broad, and low-information topic rows by default, and strips generic keywords such as wire names, years, and filler terms.
- Structural alerts hide low-confidence breakout, lifecycle, share-shift, and cooling alerts unless they meet minimum article-count and source-diversity requirements.
- Source approvals no longer keep stale `needs-fix` RSS proposals visible indefinitely. Repeated failed source probes are rejected by cleanup after the repair window.
- `add-rss` simulate and accept paths avoid synchronous long-running LLM repair by default. Fast probe and heuristic repair run inline; Codex source-code repair is queued asynchronously for repairable reject/manual-adapter failures.
- RSS source names are sanitized before seeding so proposal/test labels such as `Codex E2E ... source 20260422` never become operator-facing publisher names.
- Newly seeded RSS articles are classified by article title first. Broad feeds are not allowed to stamp every item with the source proposal theme; weak matches fall back to the canonical parent theme instead.
- Daily FRED spread signals use a 72-hour live freshness window to avoid false stale warnings around normal daily release cadence.

The goal is that AI surfaces provide concise evidence-backed operating context. They should not recycle stale cache data, opaque IDs, low-sample percent changes, or homepage URLs that have not passed source probing.

### Summarization and briefing

LLM-backed summarization still supports live and historical interpretation surfaces.

Its purpose is to condense evidence and provide readable operator context, not to create final truth labels on its own.

### RAG and retrieval

RAG remains useful as a retrieval and comparison layer over stored article and evidence archives.

The current branch uses retrieval for:

- analog lookup
- context assembly
- operator review assistance

It should be treated as a support layer, not as a hidden mandatory scoring dependency.

### Narrative and theme interpretation

Narrative analysis remains useful as a disagreement-aware layer:

- it can help identify thematic alignment
- it can penalize strong mismatch
- it should not be used as an unconditional positive override

### Agent and automation support

The repository still contains agent-facing and automation-facing tooling for:

- research expansion
- proposal generation
- evidence review
- dataset and source operations

These are part of the broader signal workspace, not a standalone model-training stack.

## What changed

The main branch no longer centers its identity on supervised backtest ML modules.

Archived to `legacy/backtest`:

- elastic-net
- gradient-boosting
- bayesian-logistic
- ensemble-predictor
- cma-es
- isotonic-calibrator
- ml-walk-forward
- cpcv

Retained on the main branch:

- temporal feature infrastructure
- event-resolution support
- retrieval and narrative support
- transmission and evidence modeling
- operator-facing decision support

## Practical rule

When AI and evidence disagree, prefer evidence quality and event validation.

The branch is designed so that AI enriches operator judgment. It is not supposed to bypass source quality, event clustering, or transmission logic.
