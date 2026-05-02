/**
 * V3 Phase 2 — Ticker bar.
 *
 * Top-of-page horizontal status strip with 6 mono-numbered cells:
 *   active model · articles/24h · validated · gate state · ECE · last sync.
 *
 * Mounts only when <body data-v3-ticker> is present (so existing pages that
 * don't opt-in stay untouched). Refreshes every 60 s. Fetches degrade
 * silently — fetchJson returns null on any failure.
 *
 * Per MDN: aria-live="off" on a marquee strip. Frequent updates would spam
 * screen readers; we expose role="marquee" + aria-label for landmark nav.
 */

import { el, fetchJson } from '../shared/dom-utils.mjs';

const REFRESH_MS = 60_000;
const TICKER_ID = 'v3-ticker-root';

/** @typedef {{label:string, value:string, tone?:'ok'|'warn'|'crit'|'info'}} Cell */

function fmtRel(ts) {
  if (!ts) return '—';
  const d = typeof ts === 'string' ? new Date(ts) : ts;
  const t = d.getTime();
  if (!Number.isFinite(t)) return '—';
  const diff = Date.now() - t;
  if (diff < 0) return 'now';
  if (diff < 60_000) return `${Math.floor(diff / 1000)}s ago`;
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

function fmtNumber(n) {
  if (n == null || !Number.isFinite(Number(n))) return '—';
  const v = Number(n);
  if (Math.abs(v) >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (Math.abs(v) >= 1_000) return `${(v / 1_000).toFixed(1)}k`;
  return String(Math.round(v));
}

function fmtEce(v) {
  if (v == null || !Number.isFinite(Number(v))) return '—';
  return Number(v).toFixed(3);
}

function levelTone(level) {
  if (level === 'critical') return 'crit';
  if (level === 'warning') return 'warn';
  if (level === 'ok') return 'ok';
  return 'info';
}

/**
 * Build six cells from health-summary + ops-status payloads. All formatting
 * is defensive — any missing field falls back to '—'.
 */
function buildCells(health, ops) {
  /** @type {Cell[]} */
  const cells = [];
  const model = health?.pillars?.model || {};
  const data = health?.pillars?.data || {};
  const laneCounts = health?.laneCounts || {};
  const overall = health?.overall || ops?.summary?.level || 'unknown';

  cells.push({
    label: 'model',
    value: model.activeModel ? String(model.activeModel).slice(0, 18) : '—',
    tone: levelTone(model.level),
  });
  cells.push({
    label: 'articles/24h',
    value: fmtNumber(data.articles24h),
    tone: levelTone(data.level),
  });
  cells.push({
    label: 'validated',
    value: fmtNumber(laneCounts.validated ?? 0),
    tone: 'ok',
  });
  cells.push({
    label: 'gate',
    value: String(model.modelTrust || 'unknown').slice(0, 12),
    tone: model.modelTrust === 'disabled' ? 'crit'
        : model.modelTrust === 'stale' ? 'warn'
        : 'ok',
  });
  cells.push({
    label: 'ECE',
    value: fmtEce(model.worstSplitECE),
    tone: model.calibration === 'calibration-warning' ? 'warn' : 'info',
  });
  cells.push({
    label: 'sync',
    value: fmtRel(health?.generatedAt || ops?.generatedAt),
    tone: levelTone(overall),
  });
  return cells;
}

function renderCells(root, cells) {
  root.innerHTML = '';
  for (let i = 0; i < cells.length; i += 1) {
    const c = cells[i];
    if (!c) continue;
    const cell = el('div', { class: `v3-ticker-cell tone-${c.tone || 'info'}` }, [
      el('span', { class: 'v3-ticker-label' }, [c.label]),
      el('span', { class: 'v3-ticker-val v3-num' }, [c.value]),
    ]);
    root.appendChild(cell);
    if (i < cells.length - 1) {
      root.appendChild(el('span', { class: 'v3-ticker-divider', 'aria-hidden': 'true' }));
    }
  }
}

function ensureTickerRoot() {
  let root = document.getElementById(TICKER_ID);
  if (root) return root;
  root = el('div', {
    id: TICKER_ID,
    class: 'v3-ticker',
    role: 'marquee',
    'aria-live': 'off',
    'aria-label': 'Lattice system status ticker',
  });
  // Insert at the very top of <body> so it's the first paintable strip.
  if (document.body.firstChild) document.body.insertBefore(root, document.body.firstChild);
  else document.body.appendChild(root);
  return root;
}

async function refreshTicker() {
  const root = ensureTickerRoot();
  const [health, ops] = await Promise.all([
    fetchJson('/api/dashboard/health-summary'),
    fetchJson('/api/ops/status'),
  ]);
  // fetchJson returns null on failure — we degrade to all-em-dash cells.
  const cells = buildCells(health || {}, ops || {});
  renderCells(root, cells);
}

let tickerInterval = 0;

export function mountTickerBar() {
  if (typeof document === 'undefined') return;
  ensureTickerRoot();
  refreshTicker().catch((err) => {
    // Silent degrade — log a warn so we don't lose the failure entirely.
    console.warn('v3-ticker refresh failed', err);
  });
  if (tickerInterval) return;
  tickerInterval = window.setInterval(() => {
    refreshTicker().catch((err) => {
      console.warn('v3-ticker refresh failed', err);
    });
  }, REFRESH_MS);
}
