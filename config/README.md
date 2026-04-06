# Root Config Data

This folder stores operational JSON config used by scripts and runtime services.

## Current files

- `intelligence-datasets.json`
  - dataset registry for replay/automation
- `gdelt-topics.json`
  - topic definitions for GDELT-driven collection
- `model-params.json`
  - model parameter overrides/defaults

## Why this folder exists

These files are not frontend-only and not user docs. They are operational configuration shared by scripts, services, or automation.

## Editing advice

- Treat these as data contracts.
- If you rename ids here, search both `scripts/` and `src/services/`.
- For dataset changes, also inspect replay and automation tests.
