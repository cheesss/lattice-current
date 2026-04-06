# Localization Bundles

This folder contains translation dictionaries for the client UI.

## Layout

- `en.json`, `ko.json`, `ja.json`, etc.
- `.d.ts` helper files for typed import surfaces in some locales

## Design intent

- Keep translation payloads flat and predictable.
- UI labels and short copy belong here.
- Long operational docs should stay in `docs/` or `site/`, not in locale JSON.

## Common failure modes

- a key exists in English but not in another locale
- a panel title changes in code but translation keys are not updated
- product renaming leaves stale text in rarely used locales

## If you touch locales

- search for the same key across `src/components`, `src/services`, and `src/config`
- verify the fallback path in English still reads cleanly
