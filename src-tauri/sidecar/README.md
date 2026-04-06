# Sidecar Guide

This directory contains the local control-plane sidecar used by the desktop app.

The sidecar exists because some signal-workspace capabilities cannot run inside the
browser process alone:

- local filesystem access
- DuckDB archive access
- runtime secret validation and mirroring
- scheduler and replay triggers
- provider verification and local service status

## Main entry point

- [local-api-server.mjs](C:\Users\chohj\Documents\Playground\lattice-current-fix\src-tauri\sidecar\local-api-server.md)

## Operational guardrails

- Do not add per-request file reads for runtime secrets, automation state, or route tables.
- Runtime secret mirror state must be cached and refreshed only when the mirror file changes.
- Background automation children must be disable-able for isolated tests.
- Route-level observability tests should use focused endpoint tests, not the full sidecar suite.
