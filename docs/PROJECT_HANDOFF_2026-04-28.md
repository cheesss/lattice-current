# Lattice Current - 2026-04-28 Project Handoff

> Status: active addendum. Read this before `PROJECT_HANDOFF_2026-04-27.md` when working on the signal dashboard UI, Theme Brief metrics, Korean mode, or operator tooltips.

This handoff captures the April 28 dashboard work. The product direction is signal-first decision support. Backtest documents and modules still exist in the repository, but they are not the primary product surface for the current dashboard work.

---

## 1. Current dashboard state

The active operator surface is `event-dashboard.html` with five surfaces:

| Surface | Purpose |
|---------|---------|
| Home | Signal cockpit, trust strip, theme spectrum, dashboard state, horizon focus, Theme Brief card. |
| Decision Inbox | Pending review / proposal triage workflow. |
| Investigate | Curated briefing, Theme Evolution, analytics, AI analysis lab, deeper evidence review. |
| Geo Lens | Spatial / map lens. In `file://` mode this intentionally shows a fallback because the interactive map needs an HTTP/Vite app shell. |
| Ops | Runtime issues, automation/data quality, source and system diagnostics. |

The dashboard can be opened via the current `file://` workflow, but the full interactive map lens should be tested through the dev server because the map module depends on HTTP module loading.

Recommended URLs:

```text
file:///C:/Users/chohj/Documents/Playground/lattice-current-fix/event-dashboard.html?theme=supply-chain-security&period=year#home
http://localhost:3000/event-dashboard.html?theme=supply-chain-security&period=year#home
```

API base used by the HTML:

```text
http://localhost:46200/api
```

---

## 2. Files changed in the April 28 dashboard pass

| File | Change |
|------|--------|
| `event-dashboard.html` | Added global operator hover tooltips, Theme Brief metric caveats, Korean dynamic rerender support, file-mode map fallback, Evolution lens-specific tooltip, and desktop surface context behavior. |
| `scripts/_shared/trend-dashboard-queries.mjs` | Theme Brief summary now includes `diagnostics` fields from aggregate metadata: comparison counts, source diversity raw value, period bounds, base-effect flags, and aggregate source. |

Do not revert unrelated dirty files under `data/` or `.tmp/`. The worktree contains many cache/state changes from long-running daemons.

---

## 3. Theme Brief metric caveats

The numbers shown in Theme Brief summary cards come from API data, mainly `theme_trend_aggregates`. The warning text is deterministic frontend guidance, not a fresh Codex-generated explanation.

Current rules:

| Condition | UI caveat |
|-----------|-----------|
| `abs(vsYearAgoPct) >= 1000` | Base-effect warning. Explains that a tiny year-ago baseline can produce extreme YoY values. |
| `abs(acceleration) >= 150` | Acceleration volatility warning. Explains that near-zero previous windows make acceleration unstable. |
| `sourceDiversity >= 0.75` | Diversity is not quality. Explains that source spread does not prove semantic relevance or article quality. |
| `meta.source` / aggregate source present | Provenance row. Explains that values are aggregate diagnostics, not hand-reviewed claims. |

Important interpretation:

- `+3038%`, `+2978%`, `0.90`, etc. are data values returned by the API.
- The caveat rows are fixed rule-based UI text.
- A high YoY value should be read as "activity increased from a small base", not as a same-multiple improvement in signal quality.
- `sourceDiversity` is a distribution measure, not a quality-weighted relevance score.

Known data-quality context from the Supply Chain Security check:

- The values are real aggregate rows, but the theme can be inflated by weak/dynamic classifiers and shipping-market source noise.
- Before using a theme as a decision input, inspect evidence items and source breakdown, especially if the theme is dominated by `dynamic-rss-title-classifier` or source fallback paths.

---

## 4. Korean support status

Korean mode is not a full translation layer for every static string. It now reliably covers:

- Existing `data-i18n` description blocks through corrected Korean overrides.
- Dynamic Theme Brief metric labels and caveat rows.
- Operator hover tooltip titles, bodies, and meta text for newly covered dashboard controls.
- `document.documentElement.lang` is set to `ko` when KO is selected.
- Dynamic Theme Brief content rerenders after language toggle.

If adding new dashboard UI, use either:

```js
t('English text', 'Korean text')
```

or `data-i18n` plus an entry in `I18N`.

Avoid hardcoded numeric examples inside explanatory copy. The April 28 pass removed a stale `238x` / `238배` phrase because it was wrong for yearly views.

---

## 5. Operator hover tooltip coverage

The tooltip system is global and installed once on DOMContentLoaded. It covers:

- Surface nav buttons
- KPI chips
- Trust strip chunks
- Since-last-look rows
- Theme spectrum segments
- Signal cards
- Inbox items and review buttons
- Interactive rows
- Theme chips
- General buttons
- Dashboard cards
- Section blocks
- Theme Brief metrics and caveat rows
- Brief sections/items
- Stage/category/story cards
- Snapshot diagnostic rows
- Probe sample items
- Runtime issue rows
- Badges, trust chips, selects, select labels, surface drawers
- `digest-generate-btn`

The tooltip contract is:

- Prefer explicit `data-lattice-tip` when available.
- Remove native `title` after first hover and store it as `data-native-title` to prevent duplicate browser tooltips.
- Preserve click behavior; hover does not mutate backend state.

---

## 6. Evolution lens behavior

The top selector with values like `Technology`, `Science`, `Geopolitics`, `Health` is `Evolution lens`.

It changes:

- `state.evolutionParent`
- `Theme Evolution` chart/table API: `/api/theme-evolution/:parent?period=...`
- `theme-evolution-badge`
- `Horizon Focus` card's `Evolution focus`
- map lens context payload

It does not immediately change:

- Current Theme Brief
- Decision Inbox
- KPI strip
- all dashboard surfaces globally

The Theme Brief changes only after the operator clicks a sub-theme / theme chip or opens a full brief.

---

## 7. File-mode map fallback

`file://` previously caused iframe console errors because `event-map-lens.html` tried to load `/src/theme-map-lens.ts` as a module. The dashboard now shows a safe fallback in file mode:

```text
Map lens paused in file mode
The signal dashboard data is loaded, but the embedded map module needs an HTTP app shell.
```

Use Vite / HTTP if you need to test the interactive map itself.

---

## 8. Verification performed

Commands run after changes:

```bash
node -e "const fs=require('fs');const html=fs.readFileSync('event-dashboard.html','utf8');const scripts=[...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/gi)].map(m=>m[1]); for (const [i,s] of scripts.entries()) { new Function(s); console.log('script',i,'ok'); }"
npm run typecheck
npm run build
node --check scripts/_shared/trend-dashboard-queries.mjs
```

Playwright/browser checks performed:

- `Home / Decision Inbox / Investigate / Geo / Ops` surface switching.
- Theme Brief metric count = 4 and caveat count = 4.
- Korean metric labels and caveat rows render.
- Hover tooltips for nav, KPI, trust strip, theme spectrum, cards, section blocks, brief items, stage/category/story cards, badge, button, select, drawer.
- In-app browser reload on `file://...event-dashboard.html?period=quarter&theme=supply-chain-security#home` showed `statCount=4`, `caveatCount=4`, `errorLogs=[]`.

Screenshot:

```text
data/verification-screenshots/dashboard-metric-qa/home-theme-brief-ko-metric-caveats.png
```

---

## 9. Known open items

1. `docs/HANDOFF_BRIEFING.md` is mojibake and stale. Prefer this file plus `PROJECT_HANDOFF_2026-04-27.md` until that older briefing is replaced.
2. Metric caveat panels are currently Theme Brief summary-specific. Other charts/tables have hover explanations but not per-metric statistical caveat panels.
3. Several site/docs pages still describe older backtest-first positioning. Current product direction is signal-first decision support.
4. If `rg` fails with `Access is denied` in PowerShell, use `Get-ChildItem` / `Select-String` fallback.
5. `data/` cache files are dirty from active daemons. Do not clean or revert them unless explicitly asked.

---

## 10. Next-session quick path

Read in this order:

1. `docs/PROJECT_HANDOFF_2026-04-28.md`
2. `docs/PROJECT_HANDOFF_2026-04-27.md`
3. `docs/AGENT_NEXT_SESSION.md`
4. `CLAUDE.md`

For dashboard UI work, start with:

```bash
npm run typecheck
npm run build
```

Then verify with the in-app browser or Playwright against the exact URL the operator is using.
