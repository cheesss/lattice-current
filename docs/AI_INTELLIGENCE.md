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
