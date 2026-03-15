# Repository Agent Rules

## Documentation Sync Rule

When you change any user-visible behavior, feature scope, architecture, algorithm, API, storage model, replay or backtest flow, UI surface, navigation, or public policy, you must update the public docs site in the same turn.

This rule applies to changes under:
- `src/`
- `src-tauri/`
- `server/`
- `scripts/`
- `docs/`
- `site/`

Required actions:
1. Identify the affected public-facing pages under `site/` and reference docs under `docs/`.
2. Update at least one of the following when applicable:
   - feature page
   - architecture page
   - algorithms page
   - API page
   - update post under `site/updates/`
   - legal or policy page
3. If navigation or information architecture changes, update `site/.vitepress/config.mts`.
4. If screenshots, diagrams, or interactive docs components are affected, update those assets or components too.
5. Run `npm run docs:build` before finishing.
6. If the change is intended for the public site, run `npm run public:sync`.
7. In the final response, list the docs files that were updated.

Do not ship code-only changes that alter public behavior without corresponding docs updates.

If a change truly has no public documentation impact, state that explicitly in the final response and explain why.

