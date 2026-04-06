# Static Data Bundles

This folder holds small bundled datasets that ship with the frontend.

## Current role

- provide lightweight reference datasets
- support visualizations that do not need live fetch at startup
- serve as safe defaults or examples where full live data is not required

## What should not go here

- large operational datasets
- frequently changing live intelligence feeds
- anything that should be seeded into Redis instead

## Current files

- `world-happiness.json`
- `renewable-installations.json`
- `conservation-wins.json`

## Design note

Bundled data improves startup reliability but increases build size. Treat this folder as curated static reference material, not a dumping ground for live snapshots.
