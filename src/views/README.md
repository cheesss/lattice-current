# Intelligence Views

This folder contains precomposed analytical views used by the intelligence surfaces.

## Role

These files sit between raw services and visible panels. They usually aggregate multiple service outputs into a view model or registry that a panel can render directly.

## Current examples

- timeline view
- scenario lab
- theme radar
- evidence feed
- asset intelligence view registry

## Design intent

- Keep panel components simpler by moving multi-source view composition here.
- Avoid doing domain fetch logic directly in these files. They should consume service outputs, not replace services.

## If editing a view

Check both:

- the panel component that renders it
- the services that supply the underlying data
