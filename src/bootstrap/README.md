# Bootstrap Layer

This folder contains startup-critical browser bootstrap helpers.

## Current role

- handle startup resilience concerns that should happen before the main UI becomes fully interactive
- keep boot-time recovery logic out of `App.ts` where possible

## Current contents

- `chunk-reload.ts`
  - reload/recovery path for chunk load failures

## Design note

Bootstrap code should stay minimal. Anything non-essential to first paint or recovery should live elsewhere.
