# Frontend Configuration Layer

This folder centralizes mostly-static configuration used across the client.

## What belongs here

- product branding and variants
- panel registry and workspace definitions
- map layer definitions
- cache policy constants
- security header config used for deploy sync
- ML or automation thresholds that are treated as config, not learned state

## Why this folder matters

Config drift is a common source of regressions in this project.

Examples:

- a panel exists in `panels.ts` but not in command/search wiring
- a route cache tier changes but the client still assumes old freshness
- a map layer gets added in one place but not the visibility registry

## High-value files

- `panels.ts`
  - canonical panel definitions
- `workspaces.ts`
  - workspace grouping and default focus surfaces
- `commands.ts`
  - command/search palette actions
- `cache-tiers.ts`
  - TTL policy and cache semantics
- `security-headers.ts`
  - deploy-time header source of truth
- `variant.ts` / `variant-meta.ts`
  - product skin / release flavor behavior

## Rule of thumb

If a value should be reviewed by humans and stay stable across sessions, it probably belongs in `config/`.
