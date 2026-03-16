---
title: "2026-03: App-grade globe showcase added"
summary: "A new read-only globe page now uses textured earth, animated arcs, trade lanes, and a richer side panel closer to the live application."
status: stable
variants:
  - full
  - tech
  - finance
updated: 2026-03-16
owner: core
---

# 2026-03: App-grade globe showcase added

## What changed

- added a dedicated `showcase/globe` page
- switched from lightweight home-demo visuals to a heavier read-only globe page
- added textured earth, night-sky background, relation arcs, trade lanes, cable paths, and theater-side detail panels

## Why it matters

The docs site now has a route that looks much closer to the real map product without exposing live feeds or private runtime dependencies.

## User impact

- visitors can inspect a richer globe surface before opening the real app
- product visuals now communicate depth better than the previous simplified home demo alone
