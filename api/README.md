# Edge API Entrypoints

This folder contains Vercel/edge-compatible HTTP entrypoints.

## Role

- expose lightweight request handlers without pulling in the full desktop runtime
- provide bootstrap, proxy, download, status, and story endpoints
- act as the serverless-facing surface that the web app can call directly

## Important files

- `bootstrap.js`
  - startup hydration path for many panels
- `rss-proxy.js`
  - RSS fetch normalization and proxying
- `opensky.js`
  - aviation data route
- `story.js` and `og-story.js`
  - article/story surfaces
- `_cors.js`, `_rate-limit.js`, `_api-key.js`
  - low-level edge request policy helpers

## Design intent

- Keep these handlers self-contained and edge-safe.
- Avoid importing Node-only modules unless the route is explicitly non-edge.
- Reuse `server/_shared/` logic where possible, but preserve edge runtime compatibility.

## Common pitfalls

- importing `node:` built-ins into edge handlers
- changing a cache key here without updating bootstrap/server parity tests
- diverging request validation between edge and server handlers
