/**
 * S-Tier user-value banner renderer (G2 dashboard split — first slice).
 *
 * Loaded from event-dashboard.html as a <script type="module"> tag.
 * Renders NEW DOM additions in a contained #sl-banner-stack overlay so
 * the inline 7,000-line dashboard keeps working unchanged. Future dashboard
 * split (G2 PR 3) will fold this into per-surface modules.
 *
 * APIs consumed (all via shared fetchJson):
 *   /api/hot-events       → themeFraming, modelTrust, eventsByLane, emptyState
 *   /api/ops/status       → actionableInstructions
 *   /api/dashboard/now-do → top-priority recommendation
 *   /api/dashboard/health-summary → 4-pillar overall health
 *   /api/themes/trending  → window-over-window article volume rank
 *   /api/theme-brief/<t>  → 6-section briefStructure (when a theme opens)
 *   /api/explain-event/<id> → matched_controls + uplift + citations
 *   /api/demo/snapshot    → demo-mode banner gating
 */

import { el, fetchJson, ensureOverlayStylesheet, deferUntilIdle } from './shared/dom-utils.mjs';

const REFRESH_MS = 60_000;

// Keep the legacy exported name so the rest of this file is unchanged.
function ensureStyleSheet() {
  ensureOverlayStylesheet();
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

/**
 * S-Tier A3 — single prescriptive recommendation at the top of the stack.
 * Reads /api/dashboard/now-do which already aggregates ops + hot-events +
 * trending into one priority queue.
 */
function buildNowDoBanner(payload) {
  if (!payload?.recommendation) return null;
  const r = payload.recommendation;
  const tone = r.priority === 'critical' ? 'crit'
    : r.priority === 'primary' ? 'ok'
    : r.priority === 'secondary' ? 'warn'
    : 'ok';
  return el('div', { class: `sl-banner ${tone}`, 'data-source': 'now-do', 'data-persist': '0' }, [
    el('div', { class: 'sl-banner-head' }, [
      el('span', {}, ['Now do']),
      el('span', {}, [r.priority || 'idle']),
    ]),
    el('div', { class: 'sl-banner-body', style: 'font-size:13px;font-weight:500' }, [
      `${r.icon || '·'} ${r.label || ''}`,
    ]),
    r.action ? el('div', { class: 'sl-banner-action' }, [`▸ ${r.action}`]) : null,
  ]);
}

/**
 * S-Tier A1 — Today's top validated signal as a hero card. When validated
 * is empty, shows the top trending theme as fallback so the dashboard
 * always opens with something concrete.
 */
function buildTopDecisionBanner(hotPayload, trendingPayload) {
  const topValidated = hotPayload?.eventsByLane?.validated?.[0] || null;
  const topPending = hotPayload?.eventsByLane?.pending?.[0] || null;
  const topTrending = trendingPayload?.themes?.[0] || null;

  // Prefer validated > pending > trending for the hero spot.
  const ev = topValidated || topPending;
  if (ev) {
    const title = ev.title || ev.representative_title || `event ${ev.id}`;
    const lane = ev.lane || (topValidated ? 'validated' : 'pending');
    const grade = ev.bestEvidenceGrade || ev.rawEvidenceGrade || '';
    const score = Number(ev.productScore ?? 0);
    return el('div', { class: 'sl-banner ok', 'data-source': 'top-decision' }, [
      el('div', { class: 'sl-banner-head' }, [
        el('span', {}, ['Today\'s top decision']),
        el('span', { class: `sl-lane-pill ${lane}` }, [lane]),
      ]),
      el('div', { class: 'sl-banner-body', style: 'font-size:13px;font-weight:500;line-height:1.4' }, [
        title.length > 110 ? title.slice(0, 107) + '…' : title,
      ]),
      el('div', { class: 'sl-banner-meta' }, [
        `${ev.theme || 'unknown theme'}`,
        grade ? ` · ${grade}` : '',
        ` · score ${score.toFixed(2)}`,
        ` · click expand for evidence`,
      ]),
      // S-Tier A2: data attribute so the click handler can fetch evidence.
      el('button', {
        class: 'sl-evidence-toggle',
        style: 'margin-top:8px;background:transparent;border:1px solid var(--border-base,rgba(255,255,255,.08));border-radius:8px;padding:4px 10px;color:var(--accent,#d8f99d);cursor:pointer;font-family:inherit;font-size:11px',
        'data-event-id': String(ev.id),
        type: 'button',
      }, ['Show evidence ▾']),
    ]);
  }
  if (topTrending) {
    const pct = topTrending.articlesChangePct == null
      ? 'new'
      : `${topTrending.articlesChangePct >= 0 ? '+' : ''}${topTrending.articlesChangePct}%`;
    return el('div', { class: 'sl-banner warn', 'data-source': 'top-decision' }, [
      el('div', { class: 'sl-banner-head' }, [
        el('span', {}, ['Today\'s top — trending fallback']),
        el('span', {}, ['no validated yet']),
      ]),
      el('div', { class: 'sl-banner-body', style: 'font-size:13px;font-weight:500' }, [
        `${topTrending.theme} surging — ${topTrending.articlesNow} articles this week (${pct})`,
      ]),
      el('div', { class: 'sl-banner-meta' }, [
        'Validation pipeline catching up. Volume signal worth tracking.',
      ]),
    ]);
  }
  return null;
}

/**
 * S-Tier A2 — fetch evidence for one event and inject as a sibling row.
 * Toggles on a button placed by buildTopDecisionBanner.
 */
async function attachEvidenceToggleHandlers(stack) {
  for (const btn of stack.querySelectorAll('.sl-evidence-toggle')) {
    if (btn.dataset.bound === '1') continue;
    btn.dataset.bound = '1';
    btn.addEventListener('click', async () => {
      const eventId = btn.dataset.eventId;
      if (!eventId) return;
      const banner = btn.closest('.sl-banner');
      const existing = banner?.querySelector('.sl-evidence-detail');
      if (existing) {
        existing.remove();
        btn.textContent = 'Show evidence ▾';
        return;
      }
      btn.textContent = 'Loading…';
      btn.disabled = true;
      const data = await fetchJson(`/api/explain-event/${encodeURIComponent(eventId)}`);
      btn.disabled = false;
      btn.textContent = 'Hide evidence ▴';
      if (!data || data.ok === false) {
        const err = el('div', { class: 'sl-evidence-detail sl-banner-meta', style: 'margin-top:8px' }, [
          'Could not load evidence — check API logs.',
        ]);
        banner?.appendChild(err);
        return;
      }
      const articles = Array.isArray(data.articles) ? data.articles.slice(0, 3) : [];
      const uplift = Array.isArray(data.uplift) ? data.uplift.slice(0, 3) : [];
      const controls = Array.isArray(data.controls) ? data.controls : [];
      const detail = el('div', { class: 'sl-evidence-detail', style: 'margin-top:10px;padding-top:10px;border-top:1px solid var(--border-dim,rgba(255,255,255,.08))' }, []);
      detail.appendChild(el('div', { class: 'sl-banner-head', style: 'margin-bottom:4px' }, [
        el('span', {}, ['Evidence']),
        el('span', {}, [`${controls.length} controls · ${articles.length} articles · ${uplift.length} uplift rows`]),
      ]));
      // Uplift rows — concrete statistical evidence.
      for (const u of uplift) {
        const t = u.t_stat == null ? '?' : Number(u.t_stat).toFixed(2);
        const upliftPct = u.uplift == null ? '?' : (Number(u.uplift) * 100).toFixed(2);
        const grade = u.promoted_grade || u.raw_evidence_grade || '?';
        const n = u.n_controls ?? '?';
        detail.appendChild(el('div', { class: 'sl-banner-body', style: 'margin-top:3px;font-size:11px' }, [
          `▸ ${u.symbol || '?'} ${u.horizon || ''} — grade ${grade}, |t|=${t}, uplift ${upliftPct}%, n_controls=${n}`,
        ]));
      }
      // Article citations — concrete sources.
      for (const a of articles) {
        const title = a.title || '(no title)';
        detail.appendChild(el('div', { class: 'sl-banner-meta', style: 'margin-top:4px' }, [
          `▸ ${a.source || 'unknown'}: ${title.length > 95 ? title.slice(0, 92) + '…' : title}`,
        ]));
      }
      // Controls summary if present.
      if (controls.length > 0) {
        const regimes = [...new Set(controls.map((c) => c.regime_event).filter(Boolean))];
        if (regimes.length) {
          detail.appendChild(el('div', { class: 'sl-banner-meta', style: 'margin-top:6px' }, [
            `Matched controls cover regimes: ${regimes.slice(0, 3).join(', ')}`,
          ]));
        }
      }
      banner?.appendChild(detail);
    });
  }
}

/**
 * S-Tier A4 — system health pillars (data / pipeline / model / product).
 * 4 dots + overall level, expandable to show pillar-level details.
 */
function buildHealthPillarsBanner(payload) {
  if (!payload?.pillars) return null;
  const overall = payload.overall || 'unknown';
  const tone = overall === 'critical' ? 'crit' : overall === 'warning' ? 'warn' : 'ok';
  const dot = (level) => {
    const color = level === 'critical' ? 'var(--red-critical,#ef4444)'
      : level === 'warning' ? 'var(--amber-risk,#f59e0b)'
      : level === 'ok' ? 'var(--signal-green,#16c784)'
      : 'rgba(255,255,255,.3)';
    return el('span', {
      style: `display:inline-block;width:10px;height:10px;border-radius:999px;background:${color};margin-right:4px;vertical-align:middle`,
    });
  };
  const pillarsRow = el('div', {
    class: 'sl-banner-body',
    style: 'font-size:11.5px;display:flex;justify-content:space-between;gap:6px;flex-wrap:wrap',
  }, [
    el('span', {}, [dot(payload.pillars.data?.level), 'data']),
    el('span', {}, [dot(payload.pillars.pipeline?.level), 'pipeline']),
    el('span', {}, [dot(payload.pillars.model?.level), 'model']),
    el('span', {}, [dot(payload.pillars.product?.level), 'product']),
  ]);
  const detailLines = [];
  const data = payload.pillars.data;
  if (data) {
    const lag = data.featureLagDays != null ? ` · lag ${data.featureLagDays}d` : '';
    detailLines.push(`data: latest=${data.latestArticleDateKey || '?'} · 24h=${data.articles24h}${lag} · stale=${data.featureStaleEventCount}`);
  }
  const pipe = payload.pillars.pipeline;
  if (pipe) {
    detailLines.push(`pipeline: daemon=${pipe.masterDaemon} · accumulator=${pipe.dataAccumulator} · meta=${pipe.metaModel}`);
  }
  const model = payload.pillars.model;
  if (model) {
    detailLines.push(`model: ${model.activeModel || '?'} · trust=${model.modelTrust} · stale=${model.stalePredictionCount ?? '?'} · ECE=${model.worstSplitECE != null ? Number(model.worstSplitECE).toFixed(3) : '?'}`);
  }
  const prod = payload.pillars.product;
  if (prod) {
    detailLines.push(`product: rel=${(prod.themeRelevancePrecision ?? 0).toFixed(2)} · brief=${(prod.briefCompleteness ?? 0).toFixed(2)} · evid=${(prod.evidenceCoverage ?? 0).toFixed(2)} · act=${(prod.actionabilityScore ?? 0).toFixed(2)}`);
  }
  return el('div', { class: `sl-banner ${tone}`, 'data-source': 'health-pillars' }, [
    el('div', { class: 'sl-banner-head' }, [
      el('span', {}, ['System health']),
      el('span', {}, [`overall: ${overall}`]),
    ]),
    pillarsRow,
    ...detailLines.map((line) => el('div', { class: 'sl-banner-meta', style: 'margin-top:4px;font-size:10.5px' }, [line])),
  ]);
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
    // Pending validation gets the 'ok' tone because it is actionable signal.
    // noise_only / no_data warrant the warn tone.
    const lvl = framing.bucket === 'no_data' || framing.bucket === 'noise_only'
      ? 'warn'
      : framing.bucket === 'validated_signals' || framing.bucket === 'pending_validation'
        ? 'ok'
        : 'ok';
    const counts = framing.counts || {};
    const pendingPill = counts.pending > 0 ? ` · ${counts.pending}P` : '';
    banners.push(el('div', { class: `sl-banner ${lvl}`, 'data-source': 'theme-framing' }, [
      el('div', { class: 'sl-banner-head' }, [
        el('span', {}, [`Hot Events · ${framing.bucket || 'view'}`]),
        el('span', {}, [`${counts.validated || 0}V${pendingPill} · ${counts.watch || 0}W · ${counts.noise || 0}N`]),
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
  // S-Tier B2 + N3 — top events grouped by lane, with recommendedAction.
  // Pending lane is rendered between validated and watch since it sits
  // semantically between them: real signal, blocked on a fixable gate.
  const eventsByLane = payload?.eventsByLane || {};
  const totalShown =
    (eventsByLane.validated?.length || 0)
    + (eventsByLane.pending?.length || 0)
    + (eventsByLane.watch?.length || 0);
  if (totalShown > 0) {
    const laneRows = [];
    for (const lane of ['validated', 'pending', 'watch', 'noise']) {
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
        // Pending events: show the concrete blocker codes so the operator
        // knows whether to wait or override.
        if (lane === 'pending' && Array.isArray(ev.validationBlockers) && ev.validationBlockers.length > 0) {
          const codes = ev.validationBlockers.map((b) => b.code).join(', ');
          laneRows.push(el('div', {
            class: 'sl-banner-meta',
            style: 'margin-top:2px;font-size:10.5px',
          }, [`⛔ ${codes}`]));
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

function buildTrendingBanner(payload) {
  if (!payload || !Array.isArray(payload.themes) || payload.themes.length === 0) return null;
  const top = payload.themes.slice(0, 5);
  const rows = [];
  for (const t of top) {
    const pct = t.articlesChangePct == null
      ? `new`
      : `${t.articlesChangePct >= 0 ? '+' : ''}${t.articlesChangePct}%`;
    const trendIcon = t.trendStatus === 'surge' ? '↑↑'
      : t.trendStatus === 'rising' ? '↑'
      : t.trendStatus === 'cooling' ? '↓'
      : t.trendStatus === 'newly-active' ? '✦'
      : '·';
    rows.push(el('div', { class: 'sl-banner-body', style: 'margin-top:3px;font-size:11.5px' }, [
      `${trendIcon} ${t.theme} `,
      el('span', { style: 'color:rgba(255,255,255,.55)' }, [`(${t.articlesNow}a · ${pct})`]),
    ]));
  }
  return el('div', { class: 'sl-banner ok', 'data-source': 'trending' }, [
    el('div', { class: 'sl-banner-head' }, [
      el('span', {}, ['Trending themes']),
      el('span', {}, [`${payload.windowDays}d`]),
    ]),
    el('div', { class: 'sl-banner-meta' }, ['Article volume vs prior period']),
    ...rows,
  ]);
}

async function refreshBanners() {
  ensureStyleSheet();
  const stack = ensureContainer();
  const [ops, hot, trending, nowDo, health, demoSnap] = await Promise.all([
    fetchJson('/api/ops/status'),
    fetchJson('/api/hot-events?limit=5'),
    fetchJson('/api/themes/trending?window=7&limit=5'),
    fetchJson('/api/dashboard/now-do'),
    fetchJson('/api/dashboard/health-summary'),
    fetchJson('/api/demo/snapshot'),
  ]);
  clearTransient();
  // S-Tier C3: demo-mode badge — when the API is running with
  // LATTICE_DEMO_MODE=1, surface a clear "demo data, read-only" banner
  // at the top of the stack so users know what they're looking at.
  if (demoSnap?.ok && demoSnap.demoMode) {
    stack.appendChild(el('div', { class: 'sl-banner warn', 'data-source': 'demo-mode' }, [
      el('div', { class: 'sl-banner-head' }, [
        el('span', {}, ['Demo data · read-only']),
        el('span', {}, [demoSnap.windowMonths ? `${demoSnap.windowMonths}-month slice` : 'sandbox']),
      ]),
      el('div', { class: 'sl-banner-body' }, [
        `Sanitized snapshot from ${demoSnap.generatedAt ? new Date(demoSnap.generatedAt).toLocaleDateString() : 'unknown'}. ${demoSnap.counts?.canonicalEvents || 0} events · ${demoSnap.counts?.articles || 0} articles · ${demoSnap.counts?.eventUplift || 0} uplift rows.`,
      ]),
      el('div', { class: 'sl-banner-meta' }, ['Writes (review / mutate / preferences) return 403 in demo mode.']),
    ]));
  }
  // Stack order (top to bottom = priority):
  //   1. Now-do (single prescriptive action)         — A3
  //   2. Today's top decision (hero card)            — A1, A2
  //   3. System health pillars                       — A4
  //   4. Ops actionable instructions                 — existing
  //   5. Hot Events theme framing + lane breakdown   — existing
  //   6. Trending themes fallback                    — N7
  const nowDoBanner = buildNowDoBanner(nowDo || {});
  if (nowDoBanner) stack.appendChild(nowDoBanner);
  const topDecisionBanner = buildTopDecisionBanner(hot || {}, trending || {});
  if (topDecisionBanner) stack.appendChild(topDecisionBanner);
  const healthBanner = buildHealthPillarsBanner(health || {});
  if (healthBanner) stack.appendChild(healthBanner);
  for (const b of buildOpsBanners(ops || {})) stack.appendChild(b);
  for (const b of buildHotEventsBanner(hot || {})) stack.appendChild(b);
  const trendingBanner = buildTrendingBanner(trending);
  if (trendingBanner) stack.appendChild(trendingBanner);

  // S-Tier A2: bind expand/collapse evidence toggle to the hero card.
  attachEvidenceToggleHandlers(stack);
}

deferUntilIdle(() => {
  refreshBanners();
  observeThemeChanges();
  setInterval(refreshBanners, REFRESH_MS);
});

export { refreshBanners, refreshBriefStructure };
