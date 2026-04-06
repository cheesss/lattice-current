# Generated Artifacts

This folder is reserved for generated frontend code or data modules.

## Current state

It is intentionally sparse. That is acceptable.

## Intended use

- codegen output from proto/OpenAPI pipelines
- generated lookup tables
- generated bindings that should not be hand-edited

## Rule

If a file here can be regenerated, document the source generator next to the pipeline that owns it. Do not hand-edit generated outputs unless the generation pipeline is broken and the change is explicitly temporary.
