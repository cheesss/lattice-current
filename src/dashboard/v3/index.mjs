/**
 * V3 dashboard upgrade entry — Pro-tool aesthetics (Palantir/Bloomberg-grade).
 *
 * Loaded by event-dashboard.html as a single <script type="module">. Each
 * phase contributes a self-mounting module that calls `deferUntilIdle` to
 * inject its surface piece without blocking initial render.
 *
 *   Phase 1 — Freshness pill, skeleton loader, optimistic UI, value pulse
 *   Phase 2 — Ticker bar, sidebar cheatsheet, command palette enhancements
 *   Phase 3 — Additive surface components (charts, DAG, tables, treemap)
 *   Phase 4 — Motion utility (consumed by 1/2/3)
 *
 * Each module is self-mounting; we just import them so deferUntilIdle fires.
 */

import './phase4-motion.mjs';
import './phase1-state.mjs';
import './phase2-chrome.mjs';
import './phase3-additive.mjs';
