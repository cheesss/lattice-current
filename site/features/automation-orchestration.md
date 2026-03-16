---
title: Automation & Theme Discovery
summary: Dataset registry, scheduler worker, retry/retention, theme discovery queue, and Codex-backed theme promotion.
status: beta
variants:
  - full
  - finance
updated: 2026-03-16
owner: core
---

# Automation & Theme Discovery

## What it does

Runs the historical intelligence loop without daily operator intervention:

- dataset registry
- scheduler worker
- fetch -> import -> replay
- nightly walk-forward
- lock, retry, and retention handling
- source registry auto-accept and auto-activation sweeps
- keyword lifecycle review for autonomous keywords
- theme discovery queue
- guarded Codex theme proposals
- guarded Codex candidate expansion for coverage gaps
- guarded Codex dataset proposals and auto-registration for missing historical coverage
- self-tuning weight experiments with promotion and rollback tracking
- graph-driven hidden candidate discovery from relationship propagation
- cross-corroboration checks and confidence calibration before ideas reach the operator view
- time-decay and recent-evidence floors before stale priors can shape a live recommendation
- reality-aware replay summaries with spread, slippage, liquidity, and session-state penalties
- macro risk overlay with kill switch, net-exposure caps, and hedge bias
- constrained autonomy outputs: `deploy`, `shadow`, `watch`, `abstain`
- shadow-book rollback that can force the engine back into shadow mode after weak recent samples
- explainable attribution that shows what part of the score came from corroboration, graph propagation, beta, macro pressure, or reality penalties

## Why it exists

Backtests are only useful when they run on a fixed schedule against a known dataset set. Theme discovery is only useful when repeated unmapped motifs are surfaced and promoted in a controlled way.

## Automation loop

1. Read `config/intelligence-datasets.json`
2. Fetch enabled historical sources on schedule
3. Import into bitemporal DuckDB history
4. Run replay on cadence
5. Run nightly walk-forward
6. Sweep source registries through guarded score-based auto-accept / auto-activate policy
7. Review autonomous keyword lifecycle and retire low-signal or stale terms
8. Refresh theme discovery queue from recent frames
9. Auto-reject weak queue items before they become a persistent operator backlog
10. Ask Codex for theme proposals only for high-signal queue items
11. Auto-promote only when guarded thresholds, overlap ceiling, and promotion score pass
12. Ask Codex for candidate expansion only on top scored coverage gaps that clear cooldown and region-balance rules
13. Propose missing historical datasets for repeated uncovered theme pressure
14. Guard-register only replay-safe dataset proposals into the registry
15. Run self-tuning over recent replay and walk-forward outcomes
16. Promote or roll back weight profiles through the experiment registry
17. Re-run replay when accepted candidates or newly imported datasets changed the active universe

## Theme discovery

The queue is built from repeated motifs in replay frames that do not fit the current theme trigger set well enough.

It looks for:

- repeated phrases
- multi-source repetition
- multi-region repetition
- low overlap with the current theme catalog

Codex is not the direct execution engine here. It proposes reusable backtest themes. The scheduler then applies deterministic promotion gates.

Low-signal motifs are also auto-cleaned now. The unattended loop can reject motifs that look like weak keyword noise, overlap too heavily with the current theme catalog, or stay weak for too long.

## Source automation

The worker now sweeps discovered feeds and discovered API sources.

Under `guarded-auto`, it can:

- approve draft feed candidates using a composite source score instead of raw confidence alone
- activate approved feed candidates while enforcing category and domain caps
- refresh API source health in batches
- promote healthy API candidates from `draft` to `approved` or `active` using health/schema/ToS/rate-limit bonuses plus category/base-url caps

Manual override still exists, but routine registry maintenance no longer requires repeated button clicks.

## Candidate expansion

After replay, the worker inspects coverage gaps and can ask Codex for additional liquid symbols.

Those proposals are:

- inserted into the candidate review store
- immediately re-evaluated against the current universe policy using score, sector balance, and asset-kind balance
- replayed again if any candidate is auto-accepted

## Dataset autonomy

The worker can now widen the historical research surface instead of only working inside a static registry.

It does that by:

- reading repeated theme pressure from replay and coverage gaps
- proposing missing historical datasets
- optionally asking Codex for a dataset template
- scoring overlap, cost, and replay safety
- guard-registering only the proposals that clear policy gates

This is still constrained autonomy. The system can widen its historical coverage, but it does not blindly register every interesting idea as a new dataset.

## Self-tuning and experiment registry

The automation loop now also keeps a small experiment registry.

That registry tracks:

- the active weight profile
- candidate profiles
- replay and walk-forward performance snapshots
- promote / observe / rollback decisions

This gives the system a limited self-correction loop instead of leaving every heuristic coefficient frozen forever.

## Graph-driven propagation

The automation stack no longer depends only on direct event keywords.

It can now:

- traverse entity and relation paths
- score second-order or hidden candidates
- surface non-obvious assets for later review or replay inclusion

This is how the system starts moving from simple keyword mapping toward relationship-aware propagation.

## Idea triage

The investment snapshot now auto-suppresses weak idea cards before the operator sees them.

This reduces manual filtering by removing cards that combine weak conviction, weak evidence, weak transmission, and high false-positive risk.

## Constrained autonomy

The automation loop is no longer just "find more themes and assets". It now also self-constrains.

The live investment snapshot applies:

- cross-source contradiction penalties
- rumor and hedge-language penalties
- recency decay on old mapping priors
- recent-evidence floors for live deployment
- execution-reality penalties for closed sessions, weak liquidity, spread, and slippage
- calibrated confidence scoring
- `deploy`, `shadow`, `watch`, `abstain` action gating
- shadow-book rollback if recent tracked ideas deteriorate

It now also applies:

- macro kill-switch and top-down hedge bias
- graph-propagation support before hidden candidates are surfaced
- explainable attribution so the operator can inspect why an idea survived the gates

This keeps the system closer to a constrained autonomous research stack than an unconstrained execution bot.

## Current policy

- default mode: `guarded-auto`
- queue items need repeated samples and source diversity
- Codex confidence must clear the configured threshold
- proposals need multiple liquid candidate assets
- theme promotion also respects novelty overlap and a promotion score floor
- promoted themes are added to the next replay cycle, not hot-patched into the currently running decision
- source candidates and API candidates are auto-activated only when score and diversity controls pass
- candidate expansion proposals are auto-accepted only when the universe policy score clears them without overfilling a sector or asset kind

## Files and commands

- registry: `config/intelligence-datasets.json`
- scheduler script: `scripts/intelligence-scheduler.mjs`
- scheduler service: `src/services/server/intelligence-automation.ts`
- theme discovery: `src/services/theme-discovery.ts`
- Codex theme proposer: `src/services/server/codex-theme-proposer.ts`
- Codex candidate proposer: `src/services/server/codex-candidate-proposer.ts`
- source automation: `src/services/server/source-automation.ts`

Commands:

```bash
npm run intelligence:scheduler:once
npm run intelligence:scheduler
node --import tsx scripts/intelligence-scheduler.mjs status
```

## Limits

- Codex can propose backtest themes, but it does not blindly override the scheduler policy.
- A promoted theme still depends on market data and replay coverage.
- Empty or disabled dataset registries do nothing by design.
- Even with stronger automation, the stack is still policy-gated and cost-aware by design.
