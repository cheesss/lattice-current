# Styling Layer

This folder contains global CSS entry points and surface-specific style bundles.

## Main files

- `main.css`
  - global shell, map, panels, and major UI primitives
- `panels.css`
  - panel-heavy styling and layout refinements
- `hubs.css`
  - overlay and hub-specific visual language
- `settings-window.css`
  - settings surface
- `base-layer.css`
  - low-level layout/foundation rules
- `rtl-overrides.css`
  - right-to-left fixes

## Design philosophy

- Prefer a small number of high-scope files over dozens of micro-CSS fragments.
- Keep surface ownership clear. If a rule is only for a hub, it belongs in `hubs.css`, not `main.css`.
- Use CSS variables and state classes where possible. Avoid selector sprawl tied to DOM accidents.

## Editing advice

- Before moving a rule, search the whole styles folder. Large files here often share state classes.
- If a bug appears only in one workspace or hub, check `hubs.css` before touching global styles.
