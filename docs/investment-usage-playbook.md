# Decision Support Playbook

This system is not an auto-trader. Use it as a structured signal and decision-support terminal.

## What it is good at

- Detecting geopolitical, sanctions, supply-chain, cyber, and macro shocks early.
- Translating those shocks into candidate countries, sectors, commodities, ETFs, and symbols.
- Showing why a candidate exists through evidence, transmission, ontology, and market context.
- Using replay and historical validation to test whether the signal path is coherent.

## What it is not good enough for

- blind automated execution
- portfolio-level optimization across a full live book
- institutional-grade strategy research on the main branch
- treating replay output as a direct execution mandate

## Operating workflow

1. Detect
   - identify the theme or disruption that is accelerating
2. Validate
   - review source quality, corroboration, and contamination risk
3. Map
   - check transmission path, linked symbols, and second-order effects
4. Decide
   - read conviction, false-positive risk, and suggested size as first-pass guidance
5. Monitor
   - track invalidation, evidence decay, and transmission weakening
6. Postmortem
   - use replay and validation to improve evidence quality, not to blindly optimize for backtest cosmetics

## Practical rules

- Good use: narrowing from many stories to a small number of reviewable candidates
- Bad use: direct execution without human review
- Good use: replay as a calibration layer
- Bad use: treating replay as the product identity of the branch

## Current limits

- mapping quality still depends on source quality and event resolution
- source posterior still uses proxy truth, not perfect ground truth
- historical validation is useful, but it is still a secondary layer behind live signal interpretation
