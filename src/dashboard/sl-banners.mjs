/**
 * S-Tier user-value banner renderer (G2 dashboard split — first slice).
 *
 * This module is loaded from event-dashboard.html via a single <script
 * type="module"> tag and injects an overlay panel that consumes the new
 * API envelopes added by the S-Tier server work:
 *
 *   /api/hot-events       → themeFraming, modelTrust, eventsByLane,
 *                           emptyState, per-event recommendedAction
 *   /api/ops/status       → actionableInstructions
 *   /api/theme-brief/<t>  → briefStructure, briefCompleteness, missingSections
 *
 * Design principle: NEVER replace existing render logic. We render NEW DOM
 * additions in a contained #sl-banner-stack overlay so the inline 7,000-line
 * dashboard keeps working unchanged. PR 3 of the dashboard split design
 * (docs/DASHBOARD_SPLIT_DESIGN_2026-04-30.md) will eventually fold this
 * into per-surface modules.
 *
 * Refresh cadence: 60 s. The dashboard's existing fetch lifecycle is
 * untouched.
 */

const API_BASE = (() => {
  // Allow override via window.LATTICE_API_BASE; fall back to same-origin
  // /api so production and dev work identically.
  if (typeof window !== 'undefined' && window.LATTICE_API_BASE) {
    return String(window.LATTICE_API_BASE).replace(/\/$/, '');
  }
  return '';
})();

const REFRESH_MS = 60_000;

function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') node.className = v;
    else if (k === 'style') node.setAttribute('style', v);
    else if (k.startsWith('data-')) node.setAttribute(k, v);
    else node[k] = v;
  }
  for (const child of children) {
    if (child === null || child === undefined) continue;
    if (typeof child === 'string') node.appendChild(document.createTextNode(child));
    else node.appendChild(child);
  }
  return node;
}

function ensureStyleSheet() {
  if (document.getElementById('sl-banner-styles')) return;
  const css = `
    #sl-banner-stack{position:fixed;bottom:14px;right:14px;z-index:9000;display:flex;flex-direction:column;gap:8px;width:380px;max-width:calc(100vw - 28px);font-family:'Geist',Inter,system-ui,sans-serif;font-size:12px;line-height:1.45;pointer-events:auto}
    .sl-banner{padding:12px 14px;border-radius:12px;background:rgba(13,15,19,.94);border:1px solid rgba(255,255,255,.08);box-shadow:0 8px 24px rgba(0,0,0,.32);color:rgba(255,255,255,.9)}
    .sl-banner.warn{border-color:#f59e0b;background:linear-gradient(180deg,rgba(64,42,12,.94),rgba(13,15,19,.94))}
    .sl-banner.crit{border-color:#ef4444;background:linear-gradient(180deg,rgba(64,12,12,.94),rgba(13,15,19,.94))}
    .sl-banner.ok{border-color:rgba(22,199,132,.6)}
    .sl-banner-head{display:flex;justify-content:space-between;gap:8px;align-items:flex-start;font-weight:600;letter-spacing:.04em;text-transform:uppercase;font-size:10px;color:rgba(255,255,255,.6);margin-bottom:6px}
    .sl-banner-body{color:rgba(255,255,255,.92)}
    .sl-banner-action{margin-top:6px;font-family:'JetBrains Mono',Consolas,monospace;font-size:11px;color:#d8f99d;white-space:pre-wrap;word-break:break-all}
    .sl-banner-meta{margin-top:6px;font-size:10.5px;color:rgba(255,255,255,.55)}
    .sl-banner button.sl-close{background:transparent;border:0;color:rgba(255,255,255,.45);cursor:pointer;font-size:14px;line-height:1;padding:0}
    .sl-banner button.sl-close:hover{color:rgba(255,255,255,.85)}
    .sl-lane-pill{display:inline-block;padding:2px 8px;border-radius:999px;font-size:10px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;margin-right:6px}
    .sl-lane-pill.validated{background:rgba(22,199,132,.18);color:#16c784;border:1px solid rgba(22,199,132,.4)}
    .sl-lane-pill.watch{background:rgba(245,158,11,.16);color:#f59e0b;border:1px solid rgba(245,158,11,.36)}
    .sl-lane-pill.noise{background:rgba(255,255,255,.05);color:rgba(255,255,255,.5);border:1px solid rgba(255,255,255,.1)}
  `;
  const style = el('style', { id: 'sl-banner-styles' });
  style.textContent = css;
  document.head.appendChild(style);
}

function ensureContainer() {
  let stack = document.getElementById('sl-banner-stack');
  if (!stack) {
    stack = el('div', { id: 'sl-banner-stack', role: 'status', 'aria-live': 'polite' });
    document.body.appendChild(stack);
  }
  return stack;
}

function clearTransient() {
  const stack = ensureContainer();
  for (const child of Array.from(stack.children)) {
    if (child.dataset.persist !== '1') child.remove();
  }
}

function buildOpsBanners(opsPayload) {
  const banners = [];
  const summary = opsPayload?.summary;
  if (!summary) return banners;
  const level = summary.level === 'critical' ? 'crit' : summary.level === 'warning' ? 'warn' : 'ok';
  const banner = el('div', { class: `sl-banner ${level}`, 'data-source': 'ops' }, [
    el('div', { class: 'sl-banner-head' }, [
      el('span', {}, [`Ops · ${summary.level || 'unknown'}`]),
      el('span', {}, [opsPayload?.generatedAt ? new Date(opsPayload.generatedAt).toLocaleTimeString() : '']),
    ]),
    el('div', { class: 'sl-banner-body' }, [
      summary.notes && summary.notes.length
        ? summary.notes.join(' · ')
        : 'All systems healthy.',
    ]),
  ]);
  for (const inst of opsPayload?.actionableInstructions || []) {
    banner.appendChild(el('div', { class: 'sl-banner-meta' }, [`▸ ${inst.condition}`]));
    banner.appendChild(el('div', { class: 'sl-banner-action' }, [inst.action]));
  }
  banners.push(banner);
  return banners;
}

function buildHotEventsBanner(payload) {
  const framing = payload?.themeFraming;
  const trust = payload?.modelTrust;
  const empty = payload?.emptyState;
  const banners = [];
  if (framing) {
    const lvl = framing.bucket === 'no_data' || framing.bucket === 'noise_only' ? 'warn' : 'ok';
    const counts = framing.counts || {};
    banners.push(el('div', { class: `sl-banner ${lvl}`, 'data-source': 'theme-framing' }, [
      el('div', { class: 'sl-banner-head' }, [
        el('span', {}, [`Hot Events · ${framing.bucket || 'view'}`]),
        el('span', {}, [`${counts.validated || 0}V · ${counts.watch || 0}W · ${counts.noise || 0}N`]),
      ]),
      el('div', { class: 'sl-banner-body' }, [framing.message || '']),
      framing.modelDisabledNotice
        ? el('div', { class: 'sl-banner-meta' }, [`⚠ ${framing.modelDisabledNotice}`])
        : null,
    ]));
  }
  if (trust && trust.level === 'disabled') {
    banners.push(el('div', { class: 'sl-banner crit', 'data-source': 'model-trust' }, [
      el('div', { class: 'sl-banner-head' }, [el('span', {}, ['Model Trust · disabled'])]),
      el('div', { class: 'sl-banner-body' }, [trust.reason || 'Model output is too stale to drive ranking.']),
    ]));
  }
  if (empty && Array.isArray(empty.reasons) && empty.reasons.length > 0) {
    const reasons = empty.reasons.join(' · ');
    const next = (empty.nextCheckpoint || []).join(' · ');
    banners.push(el('div', { class: 'sl-banner warn', 'data-source': 'hot-empty' }, [
      el('div', { class: 'sl-banner-head' }, [el('span', {}, ['No actionable Hot Events'])]),
      el('div', { class: 'sl-banner-body' }, [reasons]),
      next ? el('div', { class: 'sl-banner-action' }, [next]) : null,
      empty.alternativeObservations && empty.alternativeObservations.length > 0
        ? el('div', { class: 'sl-banner-meta' }, [
          `${empty.alternativeObservations.length} observation(s) worth watching:`,
          ...empty.alternativeObservations.slice(0, 3).flatMap((alt) => [
            el('br'),
            el('span', { class: `sl-lane-pill ${alt.lane}` }, [alt.lane || 'noise']),
            ` ${alt.title || alt.theme || alt.id}`,
          ]),
        ])
        : null,
    ]));
  }
  // S-Tier B2 — top events grouped by lane, with recommendedAction. We
  // only render this when there ARE events; the empty case is covered
  // above. Limit to 3 per lane to keep the overlay compact.
  const eventsByLane = payload?.eventsByLane || {};
  const totalShown = (eventsByLane.validated?.length || 0) + (eventsByLane.watch?.length || 0);
  if (totalShown > 0) {
    const laneRows = [];
    for (const lane of ['validated', 'watch', 'noise']) {
      const list = (eventsByLane[lane] || []).slice(0, 3);
      if (list.length === 0) continue;
      laneRows.push(el('div', { class: 'sl-banner-meta', style: 'margin-top:8px' }, [
        el('span', { class: `sl-lane-pill ${lane}` }, [lane]),
        ` ${list.length} top items`,
      ]));
      for (const ev of list) {
        const title = ev.title || ev.representative_title || `event ${ev.id}`;
        laneRows.push(el('div', { class: 'sl-banner-body', style: 'margin-top:4px;font-size:11.5px' }, [
          `▸ ${title.length > 90 ? title.slice(0, 87) + '…' : title}`,
        ]));
        if (ev.recommendedAction) {
          laneRows.push(el('div', {
            class: 'sl-banner-action',
            style: 'margin-top:2px;font-size:10.5px;color:rgba(255,255,255,.6)',
          }, [
            `${ev.recommendedAction.action}: ${ev.recommendedAction.reason || ''}`,
          ]));
        }
      }
    }
    if (laneRows.length > 0) {
      banners.push(el('div', { class: 'sl-banner ok', 'data-source': 'lane-strip' }, [
        el('div', { class: 'sl-banner-head' }, [el('span', {}, ['Lane breakdown'])]),
        ...laneRows,
      ]));
    }
  }
  return banners;
}

/**
 * S-Tier B3 — Theme Brief 6-section completeness summary. Hooked off the
 * existing `#theme-brief` element by observing its data-theme attribute
 * (set by the inline render code when the user opens a theme). When no
 * theme is selected, shows nothing.
 */
async function refreshBriefStructure(currentTheme) {
  const stack = ensureContainer();
  // Remove any prior brief banner first.
  for (const child of Array.from(stack.children)) {
    if (child.dataset.source === 'brief-structure') child.remove();
  }
  if (!currentTheme) return;
  const period = (() => {
    const sel = document.querySelector('[data-period-active="1"], [data-period].active');
    return sel ? sel.dataset.period : 'quarter';
  })();
  const payload = await fetchJson(`/api/theme-brief/${encodeURIComponent(currentTheme)}?period=${period}`);
  if (!payload?.briefStructure) return;
  const completeness = Number(payload.briefCompleteness ?? 0);
  const missing = Array.isArray(payload.missingSections) ? payload.missingSections : [];
  const lvl = completeness >= 0.95 ? 'ok' : completeness >= 0.5 ? 'warn' : 'crit';
  const sections = payload.briefStructure;
  const sectionLines = [];
  for (const key of ['whatChanged', 'whyMatters', 'evidence', 'caveats', 'monitor', 'related']) {
    const v = sections[key];
    let count = 0;
    if (Array.isArray(v)) count = v.length;
    else if (v && typeof v === 'object') {
      if (Array.isArray(v.items)) count = v.items.length;
      if (Array.isArray(v.classes)) count += v.classes.length;
      if (Array.isArray(v.entities)) count += v.entities.length;
      if (Array.isArray(v.pathways)) count += v.pathways.length;
    }
    const filled = count > 0 ? '●' : '○';
    sectionLines.push(`${filled} ${key} (${count})`);
  }
  stack.appendChild(el('div', { class: `sl-banner ${lvl}`, 'data-source': 'brief-structure' }, [
    el('div', { class: 'sl-banner-head' }, [
      el('span', {}, [`Brief · ${currentTheme}`]),
      el('span', {}, [`${(completeness * 100).toFixed(0)}% complete`]),
    ]),
    el('div', { class: 'sl-banner-body' }, [sectionLines.join('  ·  ')]),
    missing.length > 0
      ? el('div', { class: 'sl-banner-meta' }, [`Missing: ${missing.join(', ')}`])
      : null,
  ]));
}

function observeThemeChanges() {
  // The inline brief renderer sets `data-theme` on #theme-brief when a
  // theme is selected. Watch attribute changes and refresh accordingly.
  const target = document.getElementById('theme-brief');
  if (!target) return;
  let lastTheme = '';
  const tick = () => {
    const t = target.getAttribute('data-theme') || '';
    if (t && t !== lastTheme) {
      lastTheme = t;
      refreshBriefStructure(t).catch(() => {});
    }
  };
  // Polled — MutationObserver would also work but the inline code mutates
  // many attributes on the element, and a single attribute filter keeps
  // this lighter.
  setInterval(tick, 2000);
  tick();
}

async function fetchJson(url) {
  try {
    const res = await fetch(`${API_BASE}${url}`, { cache: 'no-store' });
    if (!res.ok && res.status !== 503) return null;
    return await res.json();
  } catch {
    return null;
  }
}

async function refreshBanners() {
  ensureStyleSheet();
  const stack = ensureContainer();
  const [ops, hot] = await Promise.all([
    fetchJson('/api/ops/status'),
    fetchJson('/api/hot-events?limit=5'),
  ]);
  clearTransient();
  for (const b of buildOpsBanners(ops || {})) stack.appendChild(b);
  for (const b of buildHotEventsBanner(hot || {})) stack.appendChild(b);
}

if (typeof window !== 'undefined') {
  // Idle until the dashboard's heavy boot finishes (existing inline scripts
  // do their thing first), then fire and re-fire on a 60-s cadence.
  if (document.readyState === 'loading') {
    window.addEventListener('DOMContentLoaded', () => {
      setTimeout(() => {
        refreshBanners();
        observeThemeChanges();
      }, 1500);
      setInterval(refreshBanners, REFRESH_MS);
    }, { once: true });
  } else {
    setTimeout(() => {
      refreshBanners();
      observeThemeChanges();
    }, 1500);
    setInterval(refreshBanners, REFRESH_MS);
  }
}

export { refreshBanners, refreshBriefStructure };
