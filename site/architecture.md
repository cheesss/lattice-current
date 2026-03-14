---
title: Architecture
summary: Frontend, services, desktop sidecar, data flows, and archive layers.
status: stable
variants:
  - full
  - tech
  - finance
updated: 2026-03-15
owner: core
---

# Architecture

## Main subsystems

- frontend app shell and panel system
- domain services and analysis modules
- desktop sidecar and local APIs
- historical replay and archive services
- generated service contracts and OpenAPI surfaces

## Reference docs

- [Architecture deep dive](https://github.com/cheesss/worldmonitor/blob/main/docs/ARCHITECTURE.md)
- [Desktop runtime](https://github.com/cheesss/worldmonitor/blob/main/docs/DESKTOP_APP.md)
- [Historical data sources](https://github.com/cheesss/worldmonitor/blob/main/docs/historical-data-sources.md)
- [Intelligence server schema](https://github.com/cheesss/worldmonitor/blob/main/docs/intelligence-server-schema.sql)

## Public boundary

This site documents architecture decisions and major flows while omitting private operations, secrets, and sensitive deployment details.
