---
title: Public Sync Workflow
summary: How to mirror the internal workspace into the public Lattice Current repository without copying sensitive or generated material.
status: stable
variants:
  - full
  - tech
  - finance
updated: 2026-03-15
owner: core
---

# Public Sync Workflow

The internal workspace lives in `worldmonitor`. The public repository lives in the sibling directory `worldmonitor-public`.

Use the sync script from the internal workspace root:

```bash
npm run public:sync
```

Dry run:

```bash
npm run public:sync:dry
```

## What the sync does

- copies the public-safe source tree into `../worldmonitor-public`
- removes files in the public repo that no longer exist in the internal public-safe tree
- preserves the public repo `.git` directory
- excludes internal-only paths, sensitive files, credentials, large local artifacts, and generated historical dumps

## Main exclusions

- `.git/`
- `.env*`
- `node_modules/`
- `dist/`
- `docs/internal/`
- `internal/`
- `certs/`
- `data/historical/`
- `tmp/`, `tmp_*`
- local editor/agent state
- `.docx` files
- `upath-*.tgz`
- explicitly sensitive generated files under `scripts/data/`

## Recommended release flow

1. Update public-facing docs, legal pages, and site assets in the internal repo.
2. Run `npm run public:sync`.
3. Review the public repo diff in `../worldmonitor-public`.
4. Build docs in the public repo:

```bash
cd ../worldmonitor-public
npm run docs:build
```

5. Commit and push from the public repo clone.
