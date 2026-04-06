# Investment Services

This domain contains investment-facing interpretation layers that sit above raw intelligence.

## Responsibilities

- translate geopolitical and market signals into idea cards or deploy/watch/avoid decisions
- support current snapshot brief generation
- feed replay and live decision surfaces
- keep live and replay decision inputs on the same contract

## Common neighbors

- `historical-intelligence.ts`
- `investment-intelligence.ts`
- `replay-adaptation.ts`
- `idea-generation/runtime-context.ts`

## Runtime contract

`buildIdeaCards()` is not allowed to consume ad-hoc option bags anymore.

- Live orchestrator and replay workflow must both construct `IdeaGenerationRuntimeContext`
  through `idea-generation/runtime-context.ts`.
- If a new signal source is added, wire it into the shared runtime-context builder first.
- Do not treat "data exists in NAS" as "decision engine consumes it". Verify the
  value is present in the runtime context and reaches admission scoring.

## Observability contract

Signal-first scoring changes are expected to surface through pipeline metrics.

- `pipeline-logger.ts` is the canonical aggregation point for accepted-rate,
  stage timings, warning counts, and error counts.
- `orchestrator.ts` should emit stage completion events for success paths, not
  only failures.
- If a new scoring stage is added, update both stage logging and
  `getPipelineMetrics()` so operators can see it without source inspection.

## Current focus

This branch is signal-first. Replay remains a validation/calibration layer, not
the primary product surface.
