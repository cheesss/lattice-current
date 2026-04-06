# Shared Type Surfaces

This folder contains cross-cutting TypeScript types and ambient declarations.

## Typical contents

- external module declarations
- intelligence dashboard types
- stream/JSON typing helpers
- index exports for reuse

## Role in the system

This is where runtime-heavy modules agree on shared shapes without pulling in each other’s implementation files.

## Rule

If a type is used by many subsystems and has no runtime behavior, put it here instead of importing a concrete service file just for types.
