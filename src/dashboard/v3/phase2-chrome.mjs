/**
 * V3 Phase 2 — Global chrome entry.
 *
 * Three pieces, each in its own file for ownership isolation:
 *   - mountTickerBar       (chrome-ticker.mjs)
 *   - mountCheatsheet      (chrome-cheatsheet.mjs)
 *   - mountHistoryStack    (chrome-history.mjs)
 *
 * Self-mounts on idle. Ticker is opt-in via <body data-v3-ticker>; the
 * cheatsheet and history stack are always-on but inert until their key
 * combo fires.
 */

import { deferUntilIdle } from '../shared/dom-utils.mjs';
import { mountTickerBar } from './chrome-ticker.mjs';
import { mountCheatsheet } from './chrome-cheatsheet.mjs';
import { mountHistoryStack } from './chrome-history.mjs';

function ensureStylesheet() {
  if (typeof document === 'undefined') return;
  if (document.getElementById('v3-phase2-css')) return;
  const link = document.createElement('link');
  link.id = 'v3-phase2-css';
  link.rel = 'stylesheet';
  link.href = new URL('./phase2-chrome.css', import.meta.url).href;
  document.head.appendChild(link);
}

export { mountTickerBar, mountCheatsheet, mountHistoryStack };

deferUntilIdle(() => {
  ensureStylesheet();
  if (document.body.hasAttribute('data-v3-ticker')) mountTickerBar();
  mountCheatsheet();      // always-on, opens on `?`
  mountHistoryStack();    // always-on, listens for Cmd+[ / Cmd+]
});
