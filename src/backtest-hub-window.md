# `backtest-hub-window.ts`

This file renders the standalone replay and validation workspace used by the
`Validate` flow.

## Purpose

The hub is not the primary product shell. It is an advanced review surface for:

- replay run history
- current decision-support snapshots
- dataset and pipeline health
- follow-up actions when signal quality degrades

## Main inputs

- `DataFlowOpsSnapshot`
  - pipeline posture, dataset health, blockers, and freshness
- `HistoricalReplayRun`
  - archived replay runs and per-run diagnostics
- `investment-intelligence.ts`
  - current decision buckets such as `Act Now`, `Defensive`, `Avoid`, and `Watch`

## Views

- `mission`
- `decision`
- `data`
- `history`
- `intel`

These are driven through delegated click handling on `data-action="set-view"`.

## Key responsibilities

- summarize the latest replay and pipeline state
- let the operator select a replay run and inspect the outcome
- show corpus health and source-family coverage
- guide the next action when replay output is thin or stale

## Important caveats

- `current-like` is not the same thing as the latest replay result
- decision buckets are driven by the live snapshot and should not be treated as a full replay substitute
- `no idea` usually means a thin corpus or blocked inputs, not a broken page
