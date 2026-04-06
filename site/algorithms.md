---
title: Algorithms
summary: Public-facing map of the major scoring, learning, and replay algorithms.
status: stable
variants:
  - full
  - tech
  - finance
updated: 2026-04-02
owner: core
---

# Algorithms

Lattice Current blends deterministic scoring, online priors, graph logic, and replay-based evaluation.

## Major groups

- source credibility and truth scoring
- country instability and convergence scoring
- event-to-market transmission
- regime-aware weighting
- ontology constraints and graph inference
- replay and walk-forward backtesting
- investment idea meta-gating with narrative-shadow penalties

## Primary references

- [Algorithms reference](https://github.com/cheesss/lattice-current/blob/main/docs/ALGORITHMS.md)
- [AI intelligence reference](https://github.com/cheesss/lattice-current/blob/main/docs/AI_INTELLIGENCE.md)
- [AI & Backtesting](/ai-backtesting/)

## Public note

The docs site intentionally explains logic at the capability and methodology level. It does not publish every sensitive operational threshold or connector detail.

## Investment idea meta gate

The investment idea gate blends replay quality, current performance, execution reality, and macro stability into three review metrics: hit probability, expected return, and a final decision score.

When a learned meta-weight profile is available, the hit-probability term can switch from the static blend to trained logistic weights over the same core features. If no learned profile is present, the engine keeps the original deterministic fallback. In batched backtests, the gate can also apply a small frame-level RAG adjustment from historical analog retrieval, and walk-forward validation can tune the admission thresholds before the next fold. Strict replay and live scoring continue to fall back cleanly when that adaptive infrastructure is unavailable.

Replay jobs can also source frames directly from NAS PostgreSQL raw history instead of the local DuckDB archive. When `USE_NAS_FRAMES=1` or a replay payload selects `source=postgres`, the loader rebuilds bucketed news, simple source-grouped clusters, and carry-forward market state from NAS `raw_items` before execution. DuckDB remains available as the backward-compatible fallback.

When NAS-sourced replay frames do not carry event-to-market transmission snapshots, the candidate builder falls back to cluster relation confidence and multi-source breadth as a proxy stress signal. That keeps conviction and admission from collapsing simply because the backfill path lacks precomputed transmission state.

Narrative-shadow disagreement remains a negative control in that gate, but direct positive boosts from `shadowSupport` were removed from the public scoring summary. This keeps shadow alignment as supporting context while letting replay, execution, and risk terms dominate final admission.

## Source credibility

Source credibility blends corroboration, historical accuracy, posterior truth agreement, EM reliability, feed health, and propaganda-risk controls. Corroboration is now discounted when copy-amplification risk is elevated, so a tightly synchronized source cluster contributes less than genuinely independent agreement.
