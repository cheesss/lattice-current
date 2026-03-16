---
title: "2026-03: Dataset autonomy, self-tuning, graph propagation, and macro kill-switch"
summary: The research loop can now widen historical coverage, tune guarded weight profiles, surface hidden graph candidates, and apply a top-down macro kill-switch with explainable attribution.
status: stable
updated: 2026-03-16
owner: core
---

# 2026-03: Dataset autonomy, self-tuning, graph propagation, and macro kill-switch

The investment stack now does more than replay a fixed dataset universe with static heuristics.

It can start widening and correcting its own research surface while staying policy-gated.

## What changed

- repeated uncovered theme pressure can now produce guarded historical dataset proposals
- replay-safe dataset proposals can be auto-registered into the scheduler registry
- the engine now keeps an experiment registry for guarded self-tuning and rollback of weight profiles
- graph propagation can surface hidden candidates that do not depend only on direct trigger keywords
- the live decision path now computes a macro overlay with hedge bias, exposure caps, and a kill-switch state
- idea cards and direct mappings now carry explainable attribution across corroboration, graph support, beta, macro pressure, and execution-reality penalties

## Where it shows up

- `Investment Workflow`
- `Backtest Lab`
- `docs/automation-runbook.md`
- `docs/investment-usage-playbook.md`

## Why this matters

This still is not an unconstrained execution bot.

It is closer to a constrained autonomous research loop:

- it can discover missing research inputs
- it can adjust itself instead of leaving every coefficient frozen
- it can reason beyond direct keyword matches
- it can stand down when top-down market stress overwhelms attractive micro themes
- it can explain why a recommendation survived or failed
