/**
 * S-Tier C1 — Dashboard user-preferences modal.
 *
 * Loaded from event-dashboard.html via:
 *   <script type="module" src="/src/dashboard/sl-prefs.mjs"></script>
 *
 * Adds a small gear button (bottom-left, fixed) that opens a modal with:
 *   - Display: language (EN/KO), default lane filter
 *   - Alerts: validated signal threshold, ops-critical toggle, stale notify minutes
 *   - Refresh: dashboard polling interval (10–600 sec)
 *   - "Re-show onboarding tour" button (clears localStorage flag)
 *
 * Persists via /api/user-prefs. Falls back to localStorage when API is
 * unreachable so prefs still feel responsive offline.
 *
 * Distinct from settings.html — that's desktop runtime config (Tauri/Ollama
 * secrets/feature flags). This is in-app UX preferences.
 */

const API_BASE = (() => {
  if (typeof window !== 'undefined' && window.LATTICE_API_BASE) {
    return String(window.LATTICE_API_BASE).replace(/\/$/, '');
  }
  return '';
})();

const LOCAL_STORAGE_KEY = 'lattice-prefs-fallback';

function $(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') node.className = v;
    else if (k === 'style') node.setAttribute('style', v);
    else if (k.startsWith('data-')) node.setAttribute(k, v);
    else node[k] = v;
  }
  for (const c of children) {
    if (c == null) continue;
    if (typeof c === 'string') node.appendChild(document.createTextNode(c));
    else node.appendChild(c);
  }
  return node;
}

function ensureStyles() {
  if (document.getElementById('sl-prefs-styles')) return;
  const style = $('style', { id: 'sl-prefs-styles' });
  style.textContent = `
    #sl-prefs-toggle{position:fixed;bottom:14px;left:14px;z-index:8500;width:36px;height:36px;border-radius:999px;background:var(--bg-overlay,rgba(13,15,19,.94));border:1px solid var(--border-base,rgba(255,255,255,.08));color:var(--text-soft,rgba(255,255,255,.6));cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:16px;transition:color .15s ease,border-color .15s ease}
    #sl-prefs-toggle:hover{color:var(--accent,#d8f99d);border-color:var(--accent,#d8f99d)}
    .sl-prefs-backdrop{position:fixed;inset:0;background:rgba(7,8,10,.78);backdrop-filter:blur(6px);z-index:9500;display:flex;align-items:center;justify-content:center;animation:sl-prefs-fade .2s ease-out}
    .sl-prefs-modal{width:min(560px,calc(100vw - 32px));max-height:calc(100vh - 64px);overflow-y:auto;background:var(--bg-surface,#13161d);border:1px solid var(--border-base,rgba(255,255,255,.1));border-radius:18px;padding:24px 28px;color:var(--text-loud,rgba(255,255,255,.95));font-family:var(--font-sans,'Geist',Inter,system-ui,sans-serif);box-shadow:0 32px 80px rgba(0,0,0,.5)}
    .sl-prefs-title{font-size:18px;font-weight:600;margin-bottom:16px;display:flex;justify-content:space-between;align-items:center}
    .sl-prefs-section{margin-bottom:20px;padding-bottom:16px;border-bottom:1px solid var(--border-dim,rgba(255,255,255,.04))}
    .sl-prefs-section:last-child{border-bottom:none}
    .sl-prefs-section-title{font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:var(--accent,#d8f99d);margin-bottom:10px}
    .sl-prefs-row{display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:8px;font-size:13px}
    .sl-prefs-row label{color:var(--text-base,rgba(255,255,255,.85));flex:1}
    .sl-prefs-row input[type="number"],.sl-prefs-row select{appearance:none;background:var(--bg-elevated,#1c2028);border:1px solid var(--border-base,rgba(255,255,255,.1));color:inherit;padding:5px 10px;border-radius:8px;font-family:inherit;font-size:12px;min-width:96px}
    .sl-prefs-row input[type="checkbox"]{width:16px;height:16px;accent-color:var(--accent,#d8f99d)}
    .sl-prefs-foot{display:flex;justify-content:space-between;gap:12px;margin-top:16px}
    .sl-prefs-btn{appearance:none;border:1px solid var(--border-base,rgba(255,255,255,.12));background:transparent;color:inherit;font-family:inherit;font-size:13px;padding:8px 16px;border-radius:999px;cursor:pointer;font-weight:500}
    .sl-prefs-btn:hover{background:rgba(255,255,255,.06)}
    .sl-prefs-btn.primary{background:var(--accent,#d8f99d);color:var(--bg-void,#07080a);border-color:var(--accent,#d8f99d)}
    .sl-prefs-btn.danger{color:var(--red-critical,#ef4444);border-color:rgba(239,68,68,.3)}
    .sl-prefs-status{margin-top:8px;font-size:11px;color:var(--text-soft,rgba(255,255,255,.55))}
    @keyframes sl-prefs-fade{from{opacity:0;transform:scale(.97)}to{opacity:1;transform:scale(1)}}
  `;
  document.head.appendChild(style);
}

async function apiGet() {
  try {
    const res = await fetch(`${API_BASE}/api/user-prefs`, { cache: 'no-store' });
    if (!res.ok) return null;
    const json = await res.json();
    return json.prefs || null;
  } catch {
    return null;
  }
}

async function apiPost(partial) {
  try {
    const res = await fetch(`${API_BASE}/api/user-prefs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(partial),
    });
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
    return await res.json();
  } catch (err) {
    return { ok: false, error: String(err?.message || err) };
  }
}

function loadFallback() {
  try {
    const raw = localStorage.getItem(LOCAL_STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function saveFallback(prefs) {
  try {
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    /* ignore */
  }
}

function makeRow(labelText, control) {
  return $('div', { class: 'sl-prefs-row' }, [$('label', {}, [labelText]), control]);
}

function buildModal(prefs) {
  const inputs = {};

  inputs.language = $('select', {}, [
    $('option', { value: 'en' }, ['English']),
    $('option', { value: 'ko' }, ['한국어']),
  ]);
  inputs.language.value = prefs.language || 'en';

  inputs.defaultLane = $('select', {}, [
    $('option', { value: 'all' }, ['All lanes']),
    $('option', { value: 'validated' }, ['Validated only']),
    $('option', { value: 'pending' }, ['Pending validation']),
    $('option', { value: 'watch' }, ['Watch']),
    $('option', { value: 'noise' }, ['Noise (diagnostic)']),
  ]);
  inputs.defaultLane.value = prefs.defaultLane || 'all';

  inputs.refreshIntervalMs = $('input', {
    type: 'number',
    min: '10',
    max: '600',
    step: '5',
    value: String(Math.round((prefs.refreshIntervalMs || 60_000) / 1000)),
  });

  inputs.validatedSignalThreshold = $('input', {
    type: 'number',
    min: '0',
    max: '100',
    step: '1',
    value: String(prefs.alerts?.validatedSignalThreshold ?? 1),
  });
  inputs.opsCriticalEnabled = $('input', { type: 'checkbox' });
  inputs.opsCriticalEnabled.checked = prefs.alerts?.opsCriticalEnabled !== false;
  inputs.staleNotifyMinutes = $('input', {
    type: 'number',
    min: '5',
    max: '1440',
    step: '5',
    value: String(prefs.alerts?.staleNotifyMinutes ?? 30),
  });

  const onboardingBtn = $('button', { class: 'sl-prefs-btn', type: 'button' }, ['Re-show onboarding tour']);
  onboardingBtn.addEventListener('click', () => {
    try { localStorage.removeItem('lattice-onboarded'); } catch { /* ignore */ }
    statusLine.textContent = 'Onboarding will reappear on next page load.';
  });

  const status = $('div', { class: 'sl-prefs-status' }, ['']);
  const statusLine = status;

  const close = $('button', { class: 'sl-prefs-btn', type: 'button' }, ['Close']);
  const reset = $('button', { class: 'sl-prefs-btn danger', type: 'button' }, ['Reset to defaults']);
  const save = $('button', { class: 'sl-prefs-btn primary', type: 'button' }, ['Save']);

  const modal = $('div', { class: 'sl-prefs-modal', role: 'dialog', 'aria-modal': 'true' }, [
    $('div', { class: 'sl-prefs-title' }, [
      $('span', {}, ['Dashboard preferences']),
      $('span', { style: 'font-size:11px;color:var(--text-soft,rgba(255,255,255,.55));font-weight:400' }, ['v1']),
    ]),
    $('div', { class: 'sl-prefs-section' }, [
      $('div', { class: 'sl-prefs-section-title' }, ['Display']),
      makeRow('Language', inputs.language),
      makeRow('Default lane filter', inputs.defaultLane),
    ]),
    $('div', { class: 'sl-prefs-section' }, [
      $('div', { class: 'sl-prefs-section-title' }, ['Alerts']),
      makeRow('Validated signal threshold', inputs.validatedSignalThreshold),
      makeRow('Ops-critical alert', inputs.opsCriticalEnabled),
      makeRow('Stale data alert (minutes)', inputs.staleNotifyMinutes),
    ]),
    $('div', { class: 'sl-prefs-section' }, [
      $('div', { class: 'sl-prefs-section-title' }, ['Refresh']),
      makeRow('Polling interval (seconds)', inputs.refreshIntervalMs),
    ]),
    $('div', { class: 'sl-prefs-section' }, [
      $('div', { class: 'sl-prefs-section-title' }, ['Onboarding']),
      makeRow('Tour walkthrough', onboardingBtn),
    ]),
    status,
    $('div', { class: 'sl-prefs-foot' }, [reset, $('div', { style: 'display:flex;gap:8px' }, [close, save])]),
  ]);

  return { modal, inputs, status, save, close, reset };
}

async function openModal() {
  ensureStyles();
  let prefs = await apiGet();
  if (!prefs) prefs = loadFallback() || {};
  const backdrop = $('div', { class: 'sl-prefs-backdrop' });
  const { modal, inputs, status, save, close, reset } = buildModal(prefs);
  backdrop.appendChild(modal);
  const dismiss = () => backdrop.remove();
  backdrop.addEventListener('click', (e) => { if (e.target === backdrop) dismiss(); });
  close.addEventListener('click', dismiss);

  save.addEventListener('click', async () => {
    save.disabled = true;
    save.textContent = 'Saving…';
    const partial = {
      language: inputs.language.value,
      defaultLane: inputs.defaultLane.value,
      refreshIntervalMs: Math.max(10_000, Math.min(600_000, Number(inputs.refreshIntervalMs.value) * 1000)),
      alerts: {
        validatedSignalThreshold: Number(inputs.validatedSignalThreshold.value),
        opsCriticalEnabled: Boolean(inputs.opsCriticalEnabled.checked),
        staleNotifyMinutes: Number(inputs.staleNotifyMinutes.value),
      },
    };
    saveFallback(partial);
    const result = await apiPost(partial);
    save.disabled = false;
    save.textContent = 'Save';
    if (result?.ok) {
      status.textContent = 'Saved.';
      // Apply language toggle if the existing dashboard exposes it.
      try {
        if (typeof window.applyLanguage === 'function') window.applyLanguage(partial.language);
      } catch { /* noop */ }
    } else {
      status.textContent = `Saved locally (API unreachable: ${result?.error || 'unknown'}).`;
    }
  });

  reset.addEventListener('click', async () => {
    if (!confirm('Reset all preferences to defaults? Your watchlist follows are unaffected.')) return;
    reset.disabled = true;
    try {
      await fetch(`${API_BASE}/api/user-prefs`, { method: 'DELETE' });
      try { localStorage.removeItem(LOCAL_STORAGE_KEY); } catch { /* ignore */ }
      status.textContent = 'Reset complete. Reload the page for changes to take effect.';
    } catch (err) {
      status.textContent = `Reset failed: ${err?.message || err}`;
    }
    reset.disabled = false;
  });

  document.body.appendChild(backdrop);
}

function ensureToggle() {
  if (document.getElementById('sl-prefs-toggle')) return;
  const btn = $('button', {
    id: 'sl-prefs-toggle',
    type: 'button',
    title: 'Dashboard preferences',
    'aria-label': 'Open dashboard preferences',
  }, ['⚙']);
  btn.addEventListener('click', () => openModal().catch(() => {}));
  document.body.appendChild(btn);
}

if (typeof window !== 'undefined') {
  if (document.readyState === 'loading') {
    window.addEventListener('DOMContentLoaded', () => setTimeout(ensureToggle, 1500), { once: true });
  } else {
    setTimeout(ensureToggle, 1500);
  }
}

export { openModal as openPrefsModal };
