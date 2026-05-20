# Dashboard Split Design — `event-dashboard.html`

Date: 2026-04-30
Status: Design spike (Phase 5 §G2 of S-Level Maturity Upgrade Plan)
Author: Lattice Current S-Level execution

## 1. Why this exists

`event-dashboard.html` is a **7,919-line, 471 KB single-file** dashboard. Observed symptom on 2026-04-28: Chrome renderer freezes for ≥45 s on cold load (chrome-MCP CDP `Runtime.evaluate` timed out at 45 s on `document.readyState`). This blocks every UX improvement in §Phase 5 of the S-Level Plan: "30 s next-action recognition" is unattainable when first paint is 45 s+.

Existing structure (measured, not estimated):

| Region | Lines | % of file | Notes |
|---|---|---|---|
| `<head>` (meta, fonts, preconnect) | 1–9 | 0.1% | Negligible |
| Inline `<style>` block | 10–1418 | **17.8%** | Single 1,409-line CSS block |
| `<body>` + 5 surface panels | 1420–2061 | 8.1% | Static markup |
| Inline `<script>` block | 2062–7917 | **74.0%** | **292 function definitions** |

Surfaces (already cleanly separated by `data-surface=` attribute):

| Surface | Body lines | Stable name |
|---|---|---|
| Home | 1605–1742 | `surfaces/home/` |
| Decision Inbox | 1743–1782 | `surfaces/inbox/` |
| Investigate | 1783–2002 | `surfaces/investigate/` |
| Geo Lens | 2003–2018 | `surfaces/geo/` |
| Ops | 2019–~2061 | `surfaces/ops/` |

i18n status: 12 `data-i18n` attributes in markup, **0 `i18n.t(...)` calls in script**. The `<button class="lang-toggle">` toggles between EN/KO but the JS loader was never wired (§G3 of the master plan). Half the labels stay English regardless of toggle state.

## 2. Target structure

The split must satisfy three goals, in priority order:

1. **First paint ≤ 3 s** on a 4× CPU throttle (Lighthouse mobile).
2. **No regression** in the 5 surfaces' current behaviour. Existing E2E (`scripts/_shared/dashboard-click-verify.mjs`, `verify-ai-interactive.mjs`) must stay green.
3. **Per-surface ownership** so future Phase 5 UX work touches one folder, not seven thousand lines.

Proposed layout:

```
src/
  dashboard/
    index.ts                       ← thin entry; routes to surface modules
    bootstrap/
      i18n-loader.ts               ← G3: scans `[data-i18n]`, fetches /locales/${lang}.json
      command-palette.ts           ← Cmd+K (research recommendation, future UX work)
      surface-router.ts            ← switchSurface(name) implementation
      session-state.ts             ← URL ↔ filter ↔ localStorage
    surfaces/
      home/
        home.html                  ← markup fragment (lines 1605-1742)
        home.ts                    ← Hero, Trust Strip, Decision Cockpit hooks
        home.css                   ← scoped styles
      inbox/
        inbox.html
        inbox.ts                   ← optimistic update + audit log integration (Day 4)
        inbox.css
      investigate/
        investigate.html
        investigate.ts             ← theme brief, evidence chain
        investigate.css
      geo/
        geo.html
        geo.ts                     ← lazy-loaded; deck.gl entrypoint
        geo.css
      ops/
        ops.html
        ops.ts                     ← consumes /api/ops/status (Day 2)
        ops.css
    shared/
      tokens.css                   ← :root variables (extracted from the existing :root block)
      type.css                     ← Geist + JetBrains Mono
      components/                  ← .card, .badge, .tag, .btn, .section-block reused across surfaces
      api-client.ts                ← typed fetch wrappers around /api/*
  locales/
    en.json
    ko.json
event-dashboard.html               ← shrunk to <80 lines: meta + module entry
```

Bundle target: vite manualChunks already splits maplibre/deck/etc. Add chunks:

- `dashboard-shell` (router + bootstrap + Home, eagerly loaded, ~25 KB gzip)
- `dashboard-inbox` (lazy)
- `dashboard-investigate` (lazy)
- `dashboard-geo` (lazy, includes deck.gl pull)
- `dashboard-ops` (lazy)

Eager budget: shell + Home only. Other surfaces load on first surface switch. Chrome's preload-on-hover hint can warm them.

## 3. Migration strategy — 4 PRs, no big-bang

**PR 1: extract CSS** (low risk, immediate first-paint win)

- Move lines 10–1418 of `<style>` to:
  - `src/dashboard/shared/tokens.css` (the `:root` and base resets)
  - `src/dashboard/shared/type.css` (font + Geist setup)
  - `src/dashboard/shared/components/*.css` (`.card`, `.badge`, `.btn`, etc.)
  - Per-surface scoped: `surfaces/{home,inbox,investigate,geo,ops}/{name}.css`
- `event-dashboard.html` keeps `<link rel="stylesheet">` at the same load order. CSP unchanged.
- Each surface CSS gets a `[data-surface="<name>"]` selector wrap so leakage is impossible.
- DoD: chrome-MCP cold load to interactive ≤ 8 s (intermediate target, full 3 s target after PR 4).

**PR 2: extract i18n loader (G3)**

- New `src/dashboard/bootstrap/i18n-loader.ts`:
  ```ts
  type LangCode = 'en' | 'ko';
  const cache = new Map<LangCode, Record<string, string>>();
  export async function applyLanguage(lang: LangCode): Promise<void> {
    if (!cache.has(lang)) cache.set(lang, await fetchLocale(lang));
    const dict = cache.get(lang)!;
    document.querySelectorAll<HTMLElement>('[data-i18n]').forEach((el) => {
      const key = el.dataset.i18n;
      if (key && key in dict) el.textContent = dict[key];
    });
  }
  ```
- `src/locales/{en,ko}.json` populated from existing literal text. ~250 strings expected.
- The existing `lang-toggle` button calls `applyLanguage(lang)` instead of doing nothing.
- DoD: clicking 한 → 영 toggle changes ≥ 95 % of visible labels (12 → ~250 keyed strings).

**PR 3: extract JS surfaces** (highest risk, gated by E2E)

- Pre-step: ensure `scripts/_shared/dashboard-click-verify.mjs` covers all 5 surfaces' primary clickable elements. Snapshot DOM IDs and event firings before refactor.
- For each surface, in order Home → Inbox → Investigate → Geo → Ops:
  1. Identify functions that touch only that surface's DOM (use `grep` against surface DOM IDs).
  2. Move them to `surfaces/<name>/<name>.ts`. Wire via dynamic import in `surface-router.ts`.
  3. Re-run the E2E spec — must stay green.
  4. Commit as a separate sub-PR.
- Cross-surface utilities (`ageLabel`, `cacheToken`, `decodeHtmlEntities`, `parseUrl`, etc.) move to `shared/utils.ts`.
- The 292-function inline block shrinks to **~30 functions** in shell + utils, surface modules carry the rest.
- DoD: typecheck clean, E2E green, no JS load on initial cold paint beyond shell + Home.

**PR 4: tighten initial bundle + lazy load**

- `vite.config.ts` `manualChunks` adds `dashboard-shell`, `dashboard-inbox`, etc.
- `event-dashboard.html` final state:
  ```html
  <!doctype html>
  <html lang="en">
  <head>…meta…<link rel="stylesheet" href="/src/dashboard/shared/tokens.css"></head>
  <body data-surface="home">
    <div id="app-shell"></div>
    <script type="module" src="/src/dashboard/index.ts"></script>
  </body>
  </html>
  ```
  ~80 lines.
- Verify with Lighthouse: TTI ≤ 3 s (4× throttle, mobile profile).
- DoD: All 5 release-readiness gates pass; Lighthouse perf ≥ 80.

## 4. Risks and how to manage them

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Inline `onclick="switchSurface('home')"` references break when switchSurface moves into a module | High | Surface nav unusable | Phase 1 of PR 3 keeps `window.switchSurface` as a wrapper for backward compat; remove only after E2E adapted |
| `data-i18n` keys collide between surfaces | Low | Wrong text on one surface | Namespace keys per surface (`home.hero.title` not `hero.title`) |
| CSS scoping leaks during PR 1 | Medium | Visual regression | Wrap surface CSS in `[data-surface="<name>"]` and run visual E2E (`test:e2e:visual:full`) before merging |
| Lazy chunks fail on slow networks | Low | Surface "blank" briefly | Add `<link rel="modulepreload">` for all surface chunks in shell HTML; show transition spinner during dynamic import |
| Lighthouse throttling reveals issues invisible on dev machine | Medium | Goal not met | Run Lighthouse CI in PR 4; lock in TTI budget before merge |
| 292 functions resist clean grouping | Medium | PR 3 fragments | Allow `shared/legacy.ts` for genuinely cross-cutting functions; refactor incrementally |
| Existing tests reference inline DOM/script structure | Medium | Tests break unrelated to refactor | `dashboard-click-verify.mjs` already runs against rendered DOM, not source; should be neutral. Audit before PR 3 |

## 5. Verification ladder

Each PR has a single hard gate before merge:

1. PR 1: `npm run check:release` clean + chrome-MCP cold load < 8 s.
2. PR 2: Manual KO/EN toggle pass on Home + Inbox ≥ 95 % labels translated.
3. PR 3: `npm run test:e2e:full` + `node scripts/_shared/dashboard-click-verify.mjs` + visual snapshot match.
4. PR 4: Lighthouse perf ≥ 80, TTI ≤ 3 s, FCP ≤ 1.5 s.

## 6. Out of scope (deferred)

- Adding new surfaces beyond the existing 5 (any new surface waits until PR 4 lands).
- React/Svelte migration. The split keeps vanilla DOM + TS — no framework. Adding a framework is a separate decision, separate plan.
- Theme system overhaul (`tokens.css` is extracted as-is; visual redesign is Phase 5 work after the split).
- Command palette implementation (`bootstrap/command-palette.ts` is a placeholder for the UI/UX research recommendation; ship after PR 4).

## 7. Estimated effort

- PR 1 (CSS extract): 1–2 days. Mostly mechanical; risk is selector specificity.
- PR 2 (i18n loader): 0.5 day code + 1 day translation labour.
- PR 3 (JS extract per surface): 2–3 days, dominated by E2E re-running between sub-PRs.
- PR 4 (bundle tightening): 0.5 day.

Total: **5–7 working days** for a solo dev, before any new UX feature lands.

## 8. Trigger to start

Do not start until:

- Phase 2 (Decision Inbox state consistency) is committed. Otherwise, the inbox surface module would be moved twice.
- Phase 3 (data pipeline integrity) repair task is running. Without it, the `featureStaleEventCount` UI surface will produce flapping signals that confuse refactor verification.
- A test branch with `dashboard-click-verify` snapshot recorded against the **current** monolith exists, so post-split DOM diffs are diff-able.

## 9. Decision points needing operator input

- **Locale file format**: flat key/value JSON (recommended) vs. nested namespacing (more readable but heavier loader).
- **CSS scoping mechanism**: simple `[data-surface="..."]` prefix (recommended) vs. CSS Modules vs. Shadow DOM (overkill for this scope).
- **Eager-load policy for Home**: include in shell chunk (current design) vs. always lazy (simpler bundling, slightly slower first paint). Default: include.
- **Whether to keep `event-dashboard.html` URL or move to `/`**: out of scope; current URL keeps existing share links intact.
