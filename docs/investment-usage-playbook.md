# Investment Usage Playbook

This system is not an auto-trader. Use it as a structured decision-support terminal.

## What it is good at

- Detecting geopolitical, sanctions, supply-chain, cyber, and macro shocks early.
- Translating those shocks into candidate countries, sectors, commodities, ETFs, and symbols.
- Tracking whether those mappings have worked historically inside the system.
- Showing why an idea exists via evidence, transmission, ontology, and market context.

## What it is not good enough for yet

- Blind automated execution.
- Portfolio-level risk optimization across all positions.
- Full institutional walk-forward research without historical backfill.
- Perfect false-positive control.

## Daily operating workflow

1. Detect
   - Use `AI 인사이트`, `전략적 리스크 개요`, `Country Exposure Matrix`, `Signal Ridge`.
   - Goal: identify which theme is accelerating.

2. Validate
   - Check `Source credibility`, multi-source confirmation, and whether the story is archive/noise/sports contamination.
   - If evidence is thin, do not escalate to a trade candidate.

3. Map
   - Use `Event Impact Screener`, `Flow Sankey`, and `Auto Investment Ideas`.
   - Goal: convert event -> transmission path -> symbol/ETF/commodity candidate.

4. Size
   - Read conviction, false-positive risk, and suggested size.
   - Treat the system's size as a first-pass recommendation, not a final book allocation.

5. Monitor
   - Watch `Tracked Ideas`, live returns, realized returns, and invalidation conditions.
   - Close or downgrade ideas when the transmission path weakens or the evidence degrades.

6. Postmortem
   - Review which ideas worked, which failed, and which sources were wrong.
   - This is what improves posterior source scores and mapping stats over time.

## How to use specific panels

### Macro Investment Workflow

- Use this first.
- It structures the process as:
  - Detect
  - Validate
  - Map
  - Stress Test
  - Size
  - Monitor
- The workflow now also surfaces:
  - coverage-aware universe status
  - current theme/region coverage gaps
  - candidate expansion review queue
  - Codex-assisted candidate proposals
  - universe policy mode: `manual`, `guarded-auto`, `full-auto`

### Coverage-aware universe and candidate expansion

- The engine now distinguishes between:
  - core universe assets
  - approved dynamic expansions
  - open review candidates
- Approved candidates do not hot-patch the current idea list immediately.
- They become active on the next intelligence refresh, then participate in:
  - direct event-to-asset mappings
  - idea cards
  - tracked ideas
  - replay / walk-forward backtests
- Default recommendation:
  - `guarded-auto`
  - Codex proposals now go through a composite auto-approval score, sector caps, and asset-kind caps
- `full-auto` exists, but it should be treated as an aggressive research mode rather than a default production mode
- Use the queue like this:
  1. Find a coverage gap.
  2. Review proposed candidates.
  3. Approve only liquid, understandable instruments.
  4. Re-run or wait for the next intelligence refresh.
  5. Check whether the new candidate actually improves backtest rows.

### Auto Investment Ideas

- Use this second.
- Read:
  - theme
  - direction
  - candidate symbols
  - conviction
  - false-positive risk
  - size
  - invalidation
- Good use: shortlist creation.
- Bad use: direct execution without review.

### Ontology

- Use this to verify whether the narrative actually hangs together.
- Good questions:
  - Which entities are really connected?
  - Is this an event node or just keyword noise?
  - Are sanctions / ownership / chokepoint relations valid?

### Scheduled Situation Reports

- Use these for top-down review.
- They are good for:
  - briefing
  - state snapshot comparison
  - replay checkpoints
- They are not a substitute for direct evidence review.

## Best practice for actual decisions

- Use the tool to narrow from 100 stories to 3 actionable themes.
- Then validate those 3 themes manually before committing risk.
- Focus on:
  - transmission path clarity
  - source quality
  - cross-asset confirmation
  - point-in-time price response

## Current limits you should respect

- Mapping stats improve only as closed ideas accumulate.
- Source posterior still uses proxy truth, not perfect ground-truth labeling.
- Historical walk-forward is implemented, but historical backfill/import is not complete yet.
- Dynamic universe coverage reduces blind spots, but it still cannot guarantee perfect asset-class coverage.
- Codex-assisted candidate expansion is a review loop, not an auto-execution path.
- Approved expansions only become live on the next refresh, so they should be treated as queued universe changes.
- Auto-approved candidates now run through a probation window and can be auto-demoted if they repeatedly fail to produce useful mappings.
- Source acceptance is now mostly automated under guarded policy, but it uses composite source scoring plus category/domain caps rather than raw confidence alone.
- Weak theme motifs and low-signal autonomous keywords are now auto-retired or auto-rejected by the unattended loop.
- Weak idea cards are now auto-suppressed before the operator view, so the dashboard no longer depends on manual cleanup of every low-quality card.
- The engine now applies cross-corroboration and contradiction penalties, so multi-source disagreement can reduce confidence even when the headline count looks strong.
- The engine now applies recency decay and recent-evidence floors, so old mapping wins cannot dominate current recommendations.
- The engine now applies constrained-autonomy actions:
  - `deploy`
  - `shadow`
  - `watch`
  - `abstain`
- The engine now applies execution-reality penalties:
  - spread
  - slippage
  - liquidity
  - session-state / closed-market risk
- Recent shadow-book weakness can now arm rollback and force the system into shadow mode until performance recovers.

## Unattended automation loop

The backtest stack can now run without daily operator clicks, but only if you wire the scheduler correctly.

### What controls it

- dataset registry: `config/intelligence-datasets.json`
- scheduler script: `scripts/intelligence-scheduler.mjs`
- automation service: `src/services/server/intelligence-automation.ts`
- theme discovery: `src/services/theme-discovery.ts`
- Codex theme proposer: `src/services/server/codex-theme-proposer.ts`

### What the scheduler does

1. Fetch enabled historical datasets
2. Import them into the bitemporal DuckDB archive
3. Run replay on cadence
4. Run nightly walk-forward
5. Refresh the theme discovery queue from replay frames
6. Ask Codex for new theme proposals only on high-signal queue items
7. Auto-promote only when guarded thresholds pass
8. Sweep discovered sources and API sources through source automation policy
9. Ask Codex for candidate expansion on top coverage gaps
10. Auto-accept only when universe thresholds pass, then replay again if the active universe changed
11. Review keyword lifecycle and retire low-signal autonomous keywords
12. Auto-clean weak theme queue items and suppress weak idea cards before the operator view
13. Apply constrained-autonomy gates so weak, stale, contradictory, or low-executability ideas are downgraded to `shadow`, `watch`, or `abstain`
14. Keep shadow-book rollback armed until recent tracked performance recovers

### What Codex does and does not do

- Codex can now propose new backtest themes from repeated unmapped motifs.
- Codex can also propose additional symbols for coverage gaps after replay.
- Codex does not blindly decide trades or override the scheduler policy.
- In `guarded-auto`, deterministic thresholds still gate promotion:
  - promotion score
  - discovery score
  - sample count
  - source diversity
  - Codex confidence
  - minimum liquid candidate assets
  - overlap ceiling against existing themes
- In the same guarded mode, deterministic thresholds also gate:
  - feed candidate approval and activation through composite source scores
  - API source approval and activation with health/schema/ToS/rate-limit bonuses and diversity caps
  - candidate symbol auto-acceptance into the active universe through score, sector balance, and asset-kind balance
- Promoted themes are injected into the next replay cycle. They are not hot-patched into the currently running one.
- Auto-accepted candidate symbols trigger another replay pass so the next investment snapshot already reflects the expanded universe.

### Recommended operating mode

- `manual`: research only
- `guarded-auto`: default
- `full-auto`: only for aggressive experimentation

### Commands

```bash
npm run intelligence:scheduler:once
npm run intelligence:scheduler
node --import tsx scripts/intelligence-scheduler.mjs status
```

## Recommended next operating step

Stand up a server-side pipeline that stores:

- raw_items
- normalized_events
- source_scores
- mapping_stats
- idea_runs
- forward_returns
- backtest_runs

Then run historical replay on past data before trusting the system's posterior scores for capital allocation.
