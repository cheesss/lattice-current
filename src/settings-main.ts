import './styles/main.css';
import './styles/settings-window.css';
import { SettingsManager } from '@/services/settings-manager';
import {
  SETTINGS_CATEGORIES,
  HUMAN_LABELS,
  SIGNUP_URLS,
  PLAINTEXT_KEYS,
  MASKED_SENTINEL,
  type SettingsCategory,
} from '@/services/settings-constants';
import { fetchOllamaModels } from '@/services/ollama-models';
import {
  RUNTIME_FEATURES,
  getEffectiveSecrets,
  getRuntimeConfigSnapshot,
  getSecretState,
  isFeatureAvailable,
  isFeatureEnabled,
  setFeatureToggle,
  setSecretValue,
  validateSecret,
  verifySecretWithApi,
  loadDesktopSecrets,
  type RuntimeFeatureDefinition,
  type RuntimeFeatureId,
  type RuntimeSecretKey,
} from '@/services/runtime-config';
import { getApiBaseUrl, getRemoteApiBaseUrl, isDesktopRuntime, resolveLocalApiPort } from '@/services/runtime';
import { tryInvokeTauri, invokeTauri } from '@/services/tauri-bridge';
import { escapeHtml } from '@/utils/sanitize';
import { getCurrentLanguage, initI18n, t } from '@/services/i18n';
import { applyStoredTheme } from '@/utils/theme-manager';
import { trackFeatureToggle } from '@/services/analytics';
import { getGlintAuthToken, setGlintAuthToken, clearGlintAuthToken } from '@/services/glint';

let activeSection = 'overview';
let settingsManager: SettingsManager;
let _diagCleanup: (() => void) | null = null;
const featureTestMessages = new Map<string, { tone: 'ok' | 'warn' | 'error'; message: string }>();

function getAccessCopy(): {
  accessTitle: string;
  accessDescription: string;
  requestTitle: string;
  requestDescription: string;
  requestSubmit: string;
  divider: string;
} {
  const isKorean = getCurrentLanguage() === 'ko';
  if (isKorean) {
    return {
      accessTitle: 'Lattice Current 접근',
      accessDescription: '플랫폼 키를 연결하면 관리형 데이터 소스와 호스팅 인텔리전스 기능을 바로 사용할 수 있습니다.',
      requestTitle: '접근 요청',
      requestDescription: '아직 플랫폼 키가 없다면 이메일을 등록하세요. 접근, 호스팅 프로바이더, 관리형 런타임 기능이 열리면 먼저 알려드립니다.',
      requestSubmit: '접근 요청',
      divider: '또는',
    };
  }
  return {
    accessTitle: 'Lattice Current Access',
    accessDescription: 'Connect your platform key to unlock managed data sources and hosted intelligence features.',
    requestTitle: 'Request Access',
    requestDescription: 'Do not have a platform key yet? Register an email and we will contact you when access, hosted providers, or managed runtime features open up.',
    requestSubmit: 'Request Access',
    divider: 'OR',
  };
}

function setFeatureTestResult(featureId: string, tone: 'ok' | 'warn' | 'error', message: string): void {
  featureTestMessages.set(featureId, { tone, message });
  const el = document.querySelector<HTMLElement>(`[data-feature-test-result="${featureId}"]`);
  if (!el) return;
  el.textContent = message;
  el.className = `settings-feature-test-result ${tone}`;
}

function setSectionTestResult(message: string, tone: 'ok' | 'warn' | 'error' = 'ok'): void {
  const el = document.getElementById('settingsSectionTestStatus');
  if (!el) return;
  el.textContent = message;
  el.className = `settings-section-test-status ${tone}`;
}

function getSecretCandidateValue(key: RuntimeSecretKey): string {
  const pending = settingsManager.getPending(key);
  if (pending && pending !== MASKED_SENTINEL) return pending.trim();
  return (getRuntimeConfigSnapshot().secrets[key]?.value || '').trim();
}

function getVerificationContext(): Partial<Record<RuntimeSecretKey, string>> {
  const context: Partial<Record<RuntimeSecretKey, string>> = {};
  for (const feature of RUNTIME_FEATURES) {
    for (const key of getEffectiveSecrets(feature)) {
      const value = getSecretCandidateValue(key);
      if (value) {
        context[key] = value;
      }
    }
  }
  return context;
}

async function runFeatureSecretTest(featureId: RuntimeFeatureId): Promise<void> {
  const feature = RUNTIME_FEATURES.find(item => item.id === featureId);
  if (!feature) return;
  const keys = getEffectiveSecrets(feature);
  if (keys.length === 0) {
    setFeatureTestResult(featureId, 'warn', 'No secrets configured for this feature');
    return;
  }

  const context = getVerificationContext();
  const presentKeys = keys.filter((key) => Boolean(getSecretCandidateValue(key)));
  if (presentKeys.length === 0) {
    setFeatureTestResult(featureId, 'warn', 'No configured keys to test');
    return;
  }

  setFeatureTestResult(featureId, 'warn', 'Testing...');
  const results = await Promise.all(presentKeys.map(async (key) => ({
    key,
    result: await verifySecretWithApi(key, getSecretCandidateValue(key), context),
  })));

  const failures = results.filter((entry) => !entry.result.valid);
  if (failures.length > 0) {
    setFeatureTestResult(
      featureId,
      'error',
      failures.map((entry) => `${entry.key}: ${entry.result.message || 'failed'}`).join(' | ').slice(0, 320),
    );
    return;
  }

  setFeatureTestResult(
    featureId,
    'ok',
    results.map((entry) => `${entry.key}: ${entry.result.message || 'ok'}`).join(' | ').slice(0, 320),
  );
}

async function runBulkConfiguredApiTests(features: RuntimeFeatureDefinition[]): Promise<void> {
  const candidates = features.filter((feature) =>
    getEffectiveSecrets(feature).some((key) => Boolean(getSecretCandidateValue(key))),
  );

  if (candidates.length === 0) {
    setSectionTestResult('No configured APIs to test', 'warn');
    return;
  }

  setSectionTestResult(`Testing ${candidates.length} configured features...`, 'warn');
  for (const feature of candidates) {
    await runFeatureSecretTest(feature.id);
  }

  const summary = candidates
    .map((feature) => ({ feature, result: featureTestMessages.get(feature.id) }))
    .filter((entry) => entry.result);
  const failures = summary.filter((entry) => entry.result?.tone === 'error');
  if (failures.length > 0) {
    setSectionTestResult(`${failures.length} feature tests failed`, 'error');
    return;
  }
  setSectionTestResult(`${summary.length} feature tests passed`, 'ok');
}

function setActionStatus(message: string, tone: 'ok' | 'error' = 'ok'): void {
  const statusEl = document.getElementById('settingsActionStatus');
  if (!statusEl) return;
  statusEl.textContent = message;
  statusEl.classList.remove('ok', 'error');
  statusEl.classList.add(tone);
}

async function invokeDesktopAction(command: string, successLabel: string): Promise<void> {
  const result = await tryInvokeTauri<string>(command);
  if (result) {
    setActionStatus(`${successLabel}: ${result}`, 'ok');
    return;
  }
  setActionStatus(t('modals.settingsWindow.invokeFail', { command }), 'error');
}

function closeSettingsWindow(): void {
  void tryInvokeTauri<void>('close_settings_window').then(() => { }, () => window.close());
}

function getSidecarBase(): string {
  return getApiBaseUrl() || '';
}

let _diagToken: string | null = null;

async function diagFetch(path: string, init?: RequestInit): Promise<Response> {
  if (!_diagToken) {
    try {
      _diagToken = await tryInvokeTauri<string>('get_local_api_token');
    } catch { /* token unavailable */ }
  }
  const headers = new Headers(init?.headers);
  if (_diagToken) headers.set('Authorization', `Bearer ${_diagToken}`);
  return fetch(`${getSidecarBase()}${path}`, { ...init, headers });
}

// ── Sidebar icons ──

const SIDEBAR_ICONS: Record<string, string> = {
  overview: '<svg viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zm6.93 6h-2.95a15.65 15.65 0 00-1.38-3.56A8.03 8.03 0 0118.92 8zM12 4.04c.83 1.2 1.48 2.53 1.91 3.96h-3.82c.43-1.43 1.08-2.76 1.91-3.96zM4.26 14C4.1 13.36 4 12.69 4 12s.1-1.36.26-2h3.38c-.08.66-.14 1.32-.14 2 0 .68.06 1.34.14 2H4.26zm.82 2h2.95c.32 1.25.78 2.45 1.38 3.56A7.987 7.987 0 015.08 16zm2.95-8H5.08a7.987 7.987 0 014.33-3.56A15.65 15.65 0 008.03 8zM12 19.96c-.83-1.2-1.48-2.53-1.91-3.96h3.82c-.43 1.43-1.08 2.76-1.91 3.96zM14.34 14H9.66c-.09-.66-.16-1.32-.16-2 0-.68.07-1.35.16-2h4.68c.09.65.16 1.32.16 2 0 .68-.07 1.34-.16 2zm.25 5.56c.6-1.11 1.06-2.31 1.38-3.56h2.95a8.03 8.03 0 01-4.33 3.56zM16.36 14c.08-.66.14-1.32.14-2 0-.68-.06-1.34-.14-2h3.38c.16.64.26 1.31.26 2s-.1 1.36-.26 2h-3.38z"/></svg>',
  ai: '<svg viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M21 10.12h-6.78l2.74-2.82c-2.73-2.7-7.15-2.8-9.88-.1s-2.73 7.08 0 9.79 7.15 2.71 9.88 0C18.32 15.65 19 14.08 19 12.1h2c0 1.98-.88 4.55-2.64 6.29-3.51 3.48-9.21 3.48-12.72 0-3.5-3.47-3.53-9.11-.02-12.58s9.14-3.49 12.65 0L21 3v7.12zM12.5 8v4.25l3.5 2.08-.72 1.21L11 13V8h1.5z"/></svg>',
  economy: '<svg viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M3.5 18.49l6-6.01 4 4L22 6.92l-1.41-1.41-7.09 7.97-4-4L2 16.99z"/></svg>',
  markets: '<svg viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M5 9.2h3V19H5V9.2zM10.6 5h2.8v14h-2.8V5zm5.6 8H19v6h-2.8v-6z"/></svg>',
  security: '<svg viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4zm0 10.99h7c-.53 4.12-3.28 7.79-7 8.94V12H5V6.3l7-3.11v8.8z"/></svg>',
  tracking: '<svg viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/></svg>',
  debug: '<svg viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M20 8h-2.81c-.45-.78-1.07-1.45-1.82-1.96L17 4.41 15.59 3l-2.17 2.17C12.96 5.06 12.49 5 12 5c-.49 0-.96.06-1.41.17L8.41 3 7 4.41l1.62 1.63C7.88 6.55 7.26 7.22 6.81 8H4v2h2.09c-.05.33-.09.66-.09 1v1H4v2h2v1c0 .34.04.67.09 1H4v2h2.81c1.04 1.79 2.97 3 5.19 3s4.15-1.21 5.19-3H20v-2h-2.09c.05-.33.09-.66.09-1v-1h2v-2h-2v-1c0-.34-.04-.67-.09-1H20V8zm-6 8h-4v-2h4v2zm0-4h-4v-2h4v2z"/></svg>',
};

// ── Sidebar ──

function getFeatureStatusCounts(cat: SettingsCategory): { ready: number; total: number } {
  let ready = 0;
  for (const fid of cat.features) {
    if (isFeatureAvailable(fid)) ready++;
  }
  return { ready, total: cat.features.length };
}

function getTotalProgress(): { ready: number; total: number } {
  let ready = 0;
  for (const f of RUNTIME_FEATURES) {
    if (isFeatureAvailable(f.id)) ready++;
  }
  return { ready, total: RUNTIME_FEATURES.length };
}

function renderSidebar(): void {
  const nav = document.getElementById('sidebarNav');
  if (!nav) return;

  const items: string[] = [];

  const progress = getTotalProgress();
  const overviewDotClass = progress.ready === progress.total ? 'dot-ok' : progress.ready > 0 ? 'dot-partial' : 'dot-warn';
  items.push(`
    <button class="settings-nav-item${activeSection === 'overview' ? ' active' : ''}" data-section="overview" role="tab" aria-selected="${activeSection === 'overview'}">
      ${SIDEBAR_ICONS.overview}
      <span class="settings-nav-label">Overview</span>
      <span class="settings-nav-dot ${overviewDotClass}"></span>
    </button>
  `);

  items.push('<div class="settings-nav-sep"></div>');

  for (const cat of SETTINGS_CATEGORIES) {
    const { ready, total } = getFeatureStatusCounts(cat);
    const dotClass = ready === total ? 'dot-ok' : ready > 0 ? 'dot-partial' : 'dot-warn';
    items.push(`
      <button class="settings-nav-item${activeSection === cat.id ? ' active' : ''}" data-section="${cat.id}" role="tab" aria-selected="${activeSection === cat.id}">
        ${SIDEBAR_ICONS[cat.id] || ''}
        <span class="settings-nav-label">${escapeHtml(cat.label)}</span>
        <span class="settings-nav-count">${ready}/${total}</span>
        <span class="settings-nav-dot ${dotClass}"></span>
      </button>
    `);
  }

  items.push('<div class="settings-nav-sep"></div>');

  items.push(`
    <button class="settings-nav-item${activeSection === 'debug' ? ' active' : ''}" data-section="debug" role="tab" aria-selected="${activeSection === 'debug'}">
      ${SIDEBAR_ICONS.debug}
      <span class="settings-nav-label">Debug &amp; Logs</span>
    </button>
  `);

  nav.innerHTML = items.join('');
}

// ── Section rendering ──

function renderSection(sectionId: string): void {
  const area = document.getElementById('contentArea');
  if (!area) return;

  if (_diagCleanup) { _diagCleanup(); _diagCleanup = null; }
  activeSection = sectionId;
  renderSidebar();

  area.classList.add('fade-out');
  area.classList.remove('fade-in');

  requestAnimationFrame(() => {
    if (sectionId === 'overview') {
      renderOverview(area);
    } else if (sectionId === 'debug') {
      renderDebug(area);
    } else {
      const cat = SETTINGS_CATEGORIES.find(c => c.id === sectionId);
      if (cat) renderFeatureSection(area, cat);
    }

    requestAnimationFrame(() => {
      area.classList.remove('fade-out');
      area.classList.add('fade-in');
    });
  });
}

// ── Overview ──

function renderOverview(area: HTMLElement): void {
  const { ready, total } = getTotalProgress();
  const pct = total > 0 ? (ready / total) * 100 : 0;
  const circumference = 2 * Math.PI * 40;
  const dashOffset = circumference - (pct / 100) * circumference;
  const ringColor = ready === total ? 'var(--settings-green)' : ready > 0 ? 'var(--settings-blue)' : 'var(--settings-yellow)';

  const wmState = getSecretState('WORLDMONITOR_API_KEY');
  const wmStatusText = wmState.present ? 'Active' : 'Not set';
  const wmStatusClass = wmState.present ? 'ok' : 'warn';
  const glintToken = getGlintAuthToken();
  const glintStatusText = glintToken ? 'Active' : 'Not set';
  const glintStatusClass = glintToken ? 'ok' : 'warn';
  const alreadyRegistered = localStorage.getItem('wm-waitlist-registered') === '1';
  const accessCopy = getAccessCopy();
  const desktop = isDesktopRuntime();

  const catCards = SETTINGS_CATEGORIES.map(cat => {
    const { ready: catReady, total: catTotal } = getFeatureStatusCounts(cat);
    const cls = catReady === catTotal ? 'ov-cat-ok' : catReady > 0 ? 'ov-cat-partial' : 'ov-cat-warn';
    return `<button class="settings-ov-cat ${cls}" data-section="${cat.id}">
      <span class="settings-ov-cat-label">${escapeHtml(cat.label)}</span>
      <span class="settings-ov-cat-count">${catReady}/${catTotal} ready</span>
    </button>`;
  }).join('');

  area.innerHTML = `
    <div class="settings-overview">
      <div class="settings-ov-progress">
        <svg class="settings-ov-ring" viewBox="0 0 100 100" width="120" height="120">
          <circle cx="50" cy="50" r="40" fill="none" stroke="rgba(255,255,255,0.08)" stroke-width="8"/>
          <circle cx="50" cy="50" r="40" fill="none" stroke="${ringColor}" stroke-width="8"
            stroke-linecap="round" stroke-dasharray="${circumference}" stroke-dashoffset="${dashOffset}"
            transform="rotate(-90 50 50)" style="transition:stroke-dashoffset 0.6s ease"/>
        </svg>
        <div class="settings-ov-ring-text">
          <span class="settings-ov-ring-num">${ready}</span>
          <span class="settings-ov-ring-label">of ${total} ready</span>
        </div>
      </div>
      <div class="settings-ov-cats">${catCards}</div>
    </div>

    <div class="settings-ov-license">
      <section class="wm-section">
        <h2 class="wm-section-title">${accessCopy.accessTitle}</h2>
        <p class="wm-section-desc">${accessCopy.accessDescription}</p>
        <div class="wm-key-row">
          <div class="wm-input-wrap">
            <input type="password" class="wm-input" data-wm-key-input
              placeholder="${t('modals.settingsWindow.worldMonitor.apiKey.placeholder')}"
              autocomplete="off" spellcheck="false"
              ${wmState.present ? `value="${MASKED_SENTINEL}"` : ''} />
            <button type="button" class="wm-toggle-vis" data-wm-toggle title="Show/hide">&#x1f441;</button>
          </div>
          <span class="wm-badge ${wmStatusClass}">${wmStatusText}</span>
        </div>
      </section>

      <section class="wm-section">
        <h2 class="wm-section-title">Glint Feed Token</h2>
        <p class="wm-section-desc">Required to read private Glint feed items and enable realtime feed updates.</p>
        <div class="wm-key-row">
          <div class="wm-input-wrap">
            <input type="password" class="wm-input" data-glint-token-input
              placeholder="Paste Glint auth token"
              autocomplete="off" spellcheck="false"
              ${glintToken ? `value="${MASKED_SENTINEL}"` : ''} />
            <button type="button" class="wm-toggle-vis" data-glint-toggle title="Show/hide">&#x1f441;</button>
          </div>
          <span class="wm-badge ${glintStatusClass}">${glintStatusText}</span>
        </div>
        ${desktop ? `
        <div class="wm-register-row" style="margin-top:10px;">
          <button type="button" class="wm-submit-btn" data-glint-login>Open Glint Login</button>
          <button type="button" class="wm-submit-btn" data-glint-sync>Sync Token from Login Window</button>
        </div>
        ` : `
        <p class="wm-section-desc" style="margin-top:10px;">Browser mode skips the desktop Glint helper. Paste your Glint token directly into the field above.</p>
        `}
        <p class="wm-reg-status" data-glint-login-status></p>
      </section>

      <div class="wm-divider"><span>${accessCopy.divider}</span></div>

      <section class="wm-section">
        <h2 class="wm-section-title">${accessCopy.requestTitle}</h2>
        <p class="wm-section-desc">${accessCopy.requestDescription}</p>
        ${alreadyRegistered ? `
        <p class="wm-reg-status ok">${t('modals.settingsWindow.worldMonitor.register.alreadyRegistered')}</p>
        ` : `
        <div class="wm-register-row">
          <input type="email" class="wm-input wm-email" data-wm-email
            placeholder="${t('modals.settingsWindow.worldMonitor.register.emailPlaceholder')}" />
          <button type="button" class="wm-submit-btn" data-wm-register>
            ${accessCopy.requestSubmit}
          </button>
        </div>
        <p class="wm-reg-status" data-wm-reg-status></p>
        `}
      </section>
    </div>
  `;

  initOverviewListeners(area);
}

function initOverviewListeners(area: HTMLElement): void {
  const accessCopy = getAccessCopy();
  area.querySelector('[data-wm-toggle]')?.addEventListener('click', () => {
    const input = area.querySelector<HTMLInputElement>('[data-wm-key-input]');
    if (input) input.type = input.type === 'password' ? 'text' : 'password';
  });

  area.querySelector('[data-glint-toggle]')?.addEventListener('click', () => {
    const input = area.querySelector<HTMLInputElement>('[data-glint-token-input]');
    if (input) input.type = input.type === 'password' ? 'text' : 'password';
  });

  area.querySelector<HTMLInputElement>('[data-wm-key-input]')?.addEventListener('input', (e) => {
    const input = e.target as HTMLInputElement;
    if (input.value.startsWith(MASKED_SENTINEL)) {
      input.value = input.value.slice(MASKED_SENTINEL.length);
    }
  });

  area.querySelector<HTMLInputElement>('[data-glint-token-input]')?.addEventListener('input', (e) => {
    const input = e.target as HTMLInputElement;
    if (input.value.startsWith(MASKED_SENTINEL)) {
      input.value = input.value.slice(MASKED_SENTINEL.length);
    }
  });

  if (isDesktopRuntime()) {
    area.querySelector('[data-glint-login]')?.addEventListener('click', async () => {
      const statusEl = area.querySelector<HTMLElement>('[data-glint-login-status]');
      try {
        await invokeTauri<void>('open_glint_login');
        if (statusEl) {
          statusEl.textContent = 'Glint login window opened. Sign in there, then wait 10-30s for feed sync.';
          statusEl.className = 'wm-reg-status ok';
        }
      } catch (error) {
        if (statusEl) {
          statusEl.textContent = `Failed to open Glint login window: ${String(error)}`;
          statusEl.className = 'wm-reg-status error';
        }
      }
    });

    area.querySelector('[data-glint-sync]')?.addEventListener('click', async () => {
      const statusEl = area.querySelector<HTMLElement>('[data-glint-login-status]');
      try {
        const token = await invokeTauri<string>('sync_glint_auth_token');
        const clean = token.trim();
        if (!clean) {
          throw new Error('Empty token returned');
        }
        setGlintAuthToken(clean);
        if (statusEl) {
          statusEl.textContent = 'Glint token synced from login window.';
          statusEl.className = 'wm-reg-status ok';
        }
      } catch (error) {
        if (statusEl) {
          statusEl.textContent = `Failed to sync token: ${String(error)}`;
          statusEl.className = 'wm-reg-status error';
        }
      }
    });
  }

  area.querySelector('[data-wm-register]')?.addEventListener('click', async () => {
    const emailInput = area.querySelector<HTMLInputElement>('[data-wm-email]');
    const regStatus = area.querySelector<HTMLElement>('[data-wm-reg-status]');
    const btn = area.querySelector<HTMLButtonElement>('[data-wm-register]');
    if (!emailInput || !regStatus || !btn) return;

    const email = emailInput.value.trim();
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      regStatus.textContent = t('modals.settingsWindow.worldMonitor.register.invalidEmail');
      regStatus.className = 'wm-reg-status error';
      return;
    }

    btn.disabled = true;
    btn.textContent = t('modals.settingsWindow.worldMonitor.register.submitting');

    try {
      const base = isDesktopRuntime() ? getRemoteApiBaseUrl() : '';
      const res = await fetch(`${base}/api/register-interest`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, source: 'desktop-settings' }),
      });
      const data = await res.json() as { status?: string; error?: string };
      if (data.status === 'already_registered' || data.status === 'registered') {
        localStorage.setItem('wm-waitlist-registered', '1');
        regStatus.textContent = data.status === 'already_registered'
          ? t('modals.settingsWindow.worldMonitor.register.alreadyRegistered')
          : t('modals.settingsWindow.worldMonitor.register.success');
        regStatus.className = 'wm-reg-status ok';
      } else {
        regStatus.textContent = data.error || t('modals.settingsWindow.worldMonitor.register.error');
        regStatus.className = 'wm-reg-status error';
      }
    } catch {
      regStatus.textContent = t('modals.settingsWindow.worldMonitor.register.error');
      regStatus.className = 'wm-reg-status error';
    } finally {
      btn.disabled = false;
      btn.textContent = accessCopy.requestSubmit;
    }
  });

  area.querySelectorAll<HTMLButtonElement>('.settings-ov-cat[data-section]').forEach(btn => {
    btn.addEventListener('click', () => {
      const section = btn.dataset.section;
      if (section) renderSection(section);
    });
  });
}

// ── Feature sections ──

function renderFeatureSection(area: HTMLElement, cat: SettingsCategory): void {
  const features = cat.features
    .map(fid => RUNTIME_FEATURES.find(f => f.id === fid))
    .filter(Boolean) as RuntimeFeatureDefinition[];

  const featureCards = features.map(feature => {
    const enabled = isFeatureEnabled(feature.id);
    const available = isFeatureAvailable(feature.id);
    const effectiveSecrets = getEffectiveSecrets(feature);
    const allStaged = !available && effectiveSecrets.every(
      k => getSecretState(k).valid || (settingsManager.hasPending(k) && settingsManager.getValidationState(k).validated !== false)
    );
    const borderClass = available ? 'ready' : allStaged ? 'staged' : 'needs';
    const pillClass = available ? 'ok' : allStaged ? 'staged' : 'warn';
    const pillLabel = available ? 'Ready' : allStaged ? 'Staged' : 'Needs keys';
    const secretRows = effectiveSecrets.map(key => renderSecretInput(key, feature.id)).join('');
    const fallbackHtml = (available || allStaged) ? '' : `<p class="settings-feat-fallback">${escapeHtml(feature.fallback)}</p>`;
    const testMessage = featureTestMessages.get(feature.id);
    const testResultHtml = testMessage
      ? `<div class="settings-feature-test-result ${testMessage.tone}" data-feature-test-result="${feature.id}">${escapeHtml(testMessage.message)}</div>`
      : `<div class="settings-feature-test-result hidden" data-feature-test-result="${feature.id}"></div>`;
    const featureActions = effectiveSecrets.length > 0
      ? `<div class="settings-feat-actions"><button type="button" class="settings-feat-test-btn" data-test-feature="${feature.id}">Test API</button></div>`
      : '';

    return `
      <div class="settings-feat ${borderClass}" data-feature-id="${feature.id}">
        <div class="settings-feat-header" data-feat-toggle-expand="${feature.id}">
          <label class="settings-feat-toggle-label" data-click-stop>
            <div class="settings-feat-switch">
              <input type="checkbox" data-toggle="${feature.id}" ${enabled ? 'checked' : ''} />
              <span class="settings-feat-slider"></span>
            </div>
          </label>
          <div class="settings-feat-info">
            <span class="settings-feat-name">${escapeHtml(feature.name)}</span>
            <span class="settings-feat-desc">${escapeHtml(feature.description)}</span>
          </div>
          <span class="settings-feat-pill ${pillClass}">${pillLabel}</span>
          <span class="settings-feat-chevron">&#x25B8;</span>
        </div>
        <div class="settings-feat-body">
          ${secretRows}
          ${fallbackHtml}
          ${featureActions}
          ${testResultHtml}
        </div>
      </div>
    `;
  }).join('');

  area.innerHTML = `
    <div class="settings-section-header">
      <h2>${escapeHtml(cat.label)}</h2>
      <div class="settings-section-test-controls">
        <button type="button" class="settings-feat-test-btn" data-test-configured="1">Test configured APIs</button>
        <span id="settingsSectionTestStatus" class="settings-section-test-status"></span>
      </div>
    </div>
    <div class="settings-feat-list">${featureCards}</div>
  `;

  initFeatureSectionListeners(area);
}

function renderSecretInput(key: RuntimeSecretKey, _featureId: RuntimeFeatureId): string {
  const state = getSecretState(key);
  const pending = settingsManager.hasPending(key);
  const { validated, message } = settingsManager.getValidationState(key);
  const label = HUMAN_LABELS[key] || key;
  const signupUrl = SIGNUP_URLS[key];
  const isPlaintext = PLAINTEXT_KEYS.has(key);
  const showGetKey = signupUrl && !state.present && !pending;

  const statusText = pending
    ? (validated === false ? 'Invalid' : 'Staged')
    : !state.present ? 'Missing' : state.valid ? 'Valid' : 'Looks invalid';
  const statusClass = pending
    ? (validated === false ? 'warn' : 'staged')
    : state.valid ? 'ok' : 'warn';
  const inputClass = pending ? (validated === false ? 'invalid' : 'valid-staged') : '';
  const hintText = pending && validated === false ? (message || 'Invalid value') : null;

  if (key === 'OLLAMA_MODEL') {
    const storedModel = pending
      ? settingsManager.getPending(key) || ''
      : getRuntimeConfigSnapshot().secrets[key]?.value || '';
    return `
      <div class="settings-secret-row">
        <div class="settings-secret-label">${escapeHtml(label)}</div>
        <span class="settings-secret-status ${statusClass}">${escapeHtml(statusText)}</span>
        <select data-model-select data-feature="${_featureId}" class="${inputClass}">
          ${storedModel ? `<option value="${escapeHtml(storedModel)}" selected>${escapeHtml(storedModel)}</option>` : '<option value="" selected disabled>Loading models...</option>'}
        </select>
        <input type="text" data-model-manual data-feature="${_featureId}" class="${inputClass} hidden-input"
          placeholder="Or type model name" autocomplete="off"
          ${storedModel ? `value="${escapeHtml(storedModel)}"` : ''}>
        ${hintText ? `<span class="settings-secret-hint">${escapeHtml(hintText)}</span>` : ''}
      </div>
    `;
  }

  const getKeyHtml = showGetKey
    ? `<a href="${escapeHtml(signupUrl)}" target="_blank" rel="noreferrer" data-signup-url="${escapeHtml(signupUrl)}" class="settings-secret-link">Get key</a>`
    : '';

  return `
    <div class="settings-secret-row">
      <div class="settings-secret-label">${escapeHtml(label)}</div>
      <span class="settings-secret-status ${statusClass}">${escapeHtml(statusText)}</span>
      <div class="settings-input-wrapper${showGetKey ? ' has-suffix' : ''}">
        <input type="${isPlaintext ? 'text' : 'password'}" data-secret="${key}" data-feature="${_featureId}"
          placeholder="${pending ? 'Staged' : 'Enter value...'}" autocomplete="off" class="${inputClass}"
          ${pending ? `value="${isPlaintext ? escapeHtml(settingsManager.getPending(key) || '') : MASKED_SENTINEL}"` : (isPlaintext && state.present ? `value="${escapeHtml(getRuntimeConfigSnapshot().secrets[key]?.value || '')}"` : '')}>
        ${getKeyHtml}
      </div>
      ${hintText ? `<span class="settings-secret-hint">${escapeHtml(hintText)}</span>` : ''}
    </div>
  `;
}

function initFeatureSectionListeners(area: HTMLElement): void {
  area.querySelectorAll<HTMLElement>('[data-feat-toggle-expand]').forEach(header => {
    header.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).closest('[data-click-stop]')) return;
      const card = header.closest('.settings-feat');
      card?.classList.toggle('expanded');
    });
  });

  area.querySelectorAll<HTMLInputElement>('input[data-toggle]').forEach(input => {
    input.addEventListener('change', () => {
      const featureId = input.dataset.toggle as RuntimeFeatureId;
      if (!featureId) return;
      trackFeatureToggle(featureId, input.checked);
      setFeatureToggle(featureId, input.checked);
      renderSidebar();
    });
  });

  area.querySelectorAll<HTMLInputElement>('input[data-secret]').forEach(input => {
    input.addEventListener('input', () => {
      const key = input.dataset.secret as RuntimeSecretKey;
      if (!key) return;
      if (settingsManager.hasPending(key) && input.value.startsWith(MASKED_SENTINEL)) {
        input.value = input.value.slice(MASKED_SENTINEL.length);
      }
      settingsManager.setValidation(key, true);
      input.classList.remove('valid-staged', 'invalid');
      const hint = input.closest('.settings-secret-row')?.querySelector('.settings-secret-hint');
      if (hint) hint.remove();
    });

    input.addEventListener('blur', () => {
      const key = input.dataset.secret as RuntimeSecretKey;
      if (!key) return;
      const raw = input.value.trim();

      if (!raw) {
        if (settingsManager.hasPending(key)) {
          settingsManager.deletePending(key);
          renderSection(activeSection);
        }
        return;
      }
      if (raw === MASKED_SENTINEL) return;

      settingsManager.setPending(key, raw);
      const result = validateSecret(key, raw);
      if (result.valid) {
        settingsManager.setValidation(key, true);
      } else {
        settingsManager.setValidation(key, false, result.hint || 'Invalid format');
      }

      if (PLAINTEXT_KEYS.has(key)) {
        input.value = raw;
      } else {
        input.type = 'password';
        input.value = MASKED_SENTINEL;
      }

      input.classList.remove('valid-staged', 'invalid');
      input.classList.add(result.valid ? 'valid-staged' : 'invalid');

      const statusEl = input.closest('.settings-secret-row')?.querySelector('.settings-secret-status');
      if (statusEl) {
        statusEl.textContent = result.valid ? 'Staged' : 'Invalid';
        statusEl.className = `settings-secret-status ${result.valid ? 'staged' : 'warn'}`;
      }

      const row = input.closest('.settings-secret-row');
      const existingHint = row?.querySelector('.settings-secret-hint');
      if (existingHint) existingHint.remove();
      if (!result.valid && result.hint) {
        const hint = document.createElement('span');
        hint.className = 'settings-secret-hint';
        hint.textContent = result.hint;
        row?.appendChild(hint);
      }

      updateFeatureCardStatus(input.dataset.feature as RuntimeFeatureId);

      if (key === 'OLLAMA_API_URL' && result.valid) {
        const modelSelect = area.querySelector<HTMLSelectElement>('select[data-model-select]');
        if (modelSelect) void loadOllamaModelsIntoSelect(modelSelect);
      }

      renderSidebar();
    });
  });

  area.querySelectorAll<HTMLButtonElement>('button[data-test-feature]').forEach(button => {
    button.addEventListener('click', async () => {
      const featureId = button.dataset.testFeature as RuntimeFeatureId | undefined;
      if (!featureId) return;
      button.disabled = true;
      try {
        await runFeatureSecretTest(featureId);
      } finally {
        button.disabled = false;
      }
    });
  });

  area.querySelector<HTMLButtonElement>('button[data-test-configured]')?.addEventListener('click', async (event) => {
    const button = event.currentTarget as HTMLButtonElement;
    button.disabled = true;
    try {
      const visibleFeatures = featuresForActiveSection();
      await runBulkConfiguredApiTests(visibleFeatures);
    } finally {
      button.disabled = false;
    }
  });

  area.querySelectorAll<HTMLAnchorElement>('a[data-signup-url]').forEach(link => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      const url = link.dataset.signupUrl;
      if (!url) return;
      if (isDesktopRuntime()) {
        void invokeTauri<void>('open_url', { url }).catch(() => window.open(url, '_blank'));
      } else {
        window.open(url, '_blank');
      }
    });
  });

  const modelSelect = area.querySelector<HTMLSelectElement>('select[data-model-select]');
  if (modelSelect) {
    modelSelect.addEventListener('change', () => {
      const model = modelSelect.value;
      if (model) {
        settingsManager.setPending('OLLAMA_MODEL', model);
        settingsManager.setValidation('OLLAMA_MODEL', true);
        modelSelect.classList.remove('invalid');
        modelSelect.classList.add('valid-staged');
        updateFeatureCardStatus('aiOllama');
        renderSidebar();
      }
    });
    void loadOllamaModelsIntoSelect(modelSelect);
  }
}

function featuresForActiveSection(): RuntimeFeatureDefinition[] {
  const cat = SETTINGS_CATEGORIES.find((item) => item.id === activeSection);
  if (!cat) return [];
  return cat.features
    .map(fid => RUNTIME_FEATURES.find(feature => feature.id === fid))
    .filter(Boolean) as RuntimeFeatureDefinition[];
}

function updateFeatureCardStatus(featureId: RuntimeFeatureId): void {
  const card = document.querySelector<HTMLElement>(`.settings-feat[data-feature-id="${featureId}"]`);
  if (!card) return;
  const feature = RUNTIME_FEATURES.find(f => f.id === featureId);
  if (!feature) return;

  const available = isFeatureAvailable(featureId);
  const effectiveSecrets = getEffectiveSecrets(feature);
  const allStaged = !available && effectiveSecrets.every(
    k => getSecretState(k).valid || (settingsManager.hasPending(k) && settingsManager.getValidationState(k).validated !== false)
  );

  const wasExpanded = card.classList.contains('expanded');
  card.className = `settings-feat ${available ? 'ready' : allStaged ? 'staged' : 'needs'}${wasExpanded ? ' expanded' : ''}`;

  const pill = card.querySelector('.settings-feat-pill');
  if (pill) {
    pill.className = `settings-feat-pill ${available ? 'ok' : allStaged ? 'staged' : 'warn'}`;
    pill.textContent = available ? 'Ready' : allStaged ? 'Staged' : 'Needs keys';
  }
}

async function loadOllamaModelsIntoSelect(select: HTMLSelectElement): Promise<void> {
  const snapshot = getRuntimeConfigSnapshot();
  const ollamaUrl = settingsManager.getPending('OLLAMA_API_URL')
    || snapshot.secrets['OLLAMA_API_URL']?.value
    || '';
  if (!ollamaUrl) {
    select.innerHTML = '<option value="" disabled selected>Set Ollama URL first</option>';
    return;
  }

  const currentModel = settingsManager.getPending('OLLAMA_MODEL')
    || snapshot.secrets['OLLAMA_MODEL']?.value
    || '';

  const models = await fetchOllamaModels(ollamaUrl);

  if (models.length === 0) {
    const manual = select.parentElement?.querySelector<HTMLInputElement>('input[data-model-manual]');
    if (manual) {
      select.style.display = 'none';
      manual.classList.remove('hidden-input');
      if (!manual.dataset.listenerAttached) {
        manual.dataset.listenerAttached = '1';
        manual.addEventListener('blur', () => {
          const model = manual.value.trim();
          if (model) {
            settingsManager.setPending('OLLAMA_MODEL', model);
            settingsManager.setValidation('OLLAMA_MODEL', true);
            manual.classList.remove('invalid');
            manual.classList.add('valid-staged');
            updateFeatureCardStatus('aiOllama');
            renderSidebar();
          }
        });
      }
    }
    return;
  }

  const options = currentModel ? '' : '<option value="" selected disabled>Select a model...</option>';
  select.innerHTML = options + models.map(name =>
    `<option value="${escapeHtml(name)}" ${name === currentModel ? 'selected' : ''}>${escapeHtml(name)}</option>`
  ).join('');
}

// ── Debug section ──

function renderDebug(area: HTMLElement): void {
  const desktop = isDesktopRuntime();
  area.innerHTML = `
    <div class="settings-section-header">
      <h2>Debug &amp; Logs</h2>
    </div>
    <div class="debug-actions">
      ${desktop ? `
      <button id="openLogsBtn" type="button">Open Logs Folder</button>
      <button id="openSidecarLogBtn" type="button">Open API Log</button>
      ` : `
      <button id="openTrafficJsonBtn" type="button">Open API Traffic JSON</button>
      <button id="downloadDiagnosticsBtn" type="button">Download Diagnostics</button>
      `}
    </div>
    <section class="settings-diagnostics" id="diagnosticsSection">
      <header class="diag-header">
        <h2>Diagnostics</h2>
        <div class="diag-toggles">
          <label><input type="checkbox" id="verboseApiLog"> Verbose Sidecar Log</label>
          <label><input type="checkbox" id="fetchDebugLog"> Frontend Fetch Debug</label>
        </div>
      </header>
      <div class="diag-traffic-bar">
        <h3>API Traffic <span id="trafficCount"></span></h3>
        <div class="diag-traffic-controls">
          <label><input type="checkbox" id="autoRefreshLog" checked> Auto</label>
          <button id="refreshLogBtn" type="button">Refresh</button>
          <button id="clearLogBtn" type="button">Clear</button>
        </div>
      </div>
      <div id="trafficLog" class="diag-traffic-log"></div>
    </section>
  `;

  if (desktop) {
    area.querySelector('#openLogsBtn')?.addEventListener('click', () => {
      void invokeDesktopAction('open_logs_folder', t('modals.settingsWindow.openLogs'));
    });

    area.querySelector('#openSidecarLogBtn')?.addEventListener('click', () => {
      void invokeDesktopAction('open_sidecar_log_file', t('modals.settingsWindow.openApiLog'));
    });
  } else {
    area.querySelector('#openTrafficJsonBtn')?.addEventListener('click', () => {
      window.open('/api/local-traffic-log', '_blank', 'noopener');
    });

    area.querySelector('#downloadDiagnosticsBtn')?.addEventListener('click', async () => {
      try {
        const response = await diagFetch('/api/local-traffic-log');
        const payload = await response.text();
        const blob = new Blob([payload], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = `lattice-current-diagnostics-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
        anchor.click();
        URL.revokeObjectURL(url);
        setActionStatus('Diagnostics downloaded', 'ok');
      } catch {
        setActionStatus('Failed to download diagnostics', 'error');
      }
    });
  }

  initDiagnostics();
}

function initDiagnostics(): void {
  const verboseToggle = document.getElementById('verboseApiLog') as HTMLInputElement | null;
  const fetchDebugToggle = document.getElementById('fetchDebugLog') as HTMLInputElement | null;
  const autoRefreshToggle = document.getElementById('autoRefreshLog') as HTMLInputElement | null;
  const refreshBtn = document.getElementById('refreshLogBtn');
  const clearBtn = document.getElementById('clearLogBtn');
  const trafficLogEl = document.getElementById('trafficLog');
  const trafficCount = document.getElementById('trafficCount');

  if (fetchDebugToggle) {
    fetchDebugToggle.checked = localStorage.getItem('wm-debug-log') === '1';
    fetchDebugToggle.addEventListener('change', () => {
      localStorage.setItem('wm-debug-log', fetchDebugToggle.checked ? '1' : '0');
    });
  }

  async function syncVerboseState(): Promise<void> {
    if (!verboseToggle) return;
    try {
      const res = await diagFetch('/api/local-debug-toggle');
      const data = await res.json();
      verboseToggle.checked = data.verboseMode;
    } catch { /* sidecar not running */ }
  }

  verboseToggle?.addEventListener('change', async () => {
    try {
      const res = await diagFetch('/api/local-debug-toggle', { method: 'POST' });
      const data = await res.json();
      if (verboseToggle) verboseToggle.checked = data.verboseMode;
      setActionStatus(data.verboseMode ? t('modals.settingsWindow.verboseOn') : t('modals.settingsWindow.verboseOff'), 'ok');
    } catch {
      setActionStatus(t('modals.settingsWindow.sidecarError'), 'error');
    }
  });

  void syncVerboseState();

  async function refreshTrafficLog(): Promise<void> {
    if (!trafficLogEl) return;
    try {
      const res = await diagFetch('/api/local-traffic-log');
      const data = await res.json();
      const entries: Array<{ timestamp: string; method: string; path: string; status: number; durationMs: number }> = data.entries || [];
      if (trafficCount) trafficCount.textContent = `(${entries.length})`;

      if (entries.length === 0) {
        trafficLogEl.innerHTML = `<p class="diag-empty">${t('modals.settingsWindow.noTraffic')}</p>`;
        return;
      }

      const rows = entries.slice().reverse().map((e) => {
        const ts = e.timestamp.split('T')[1]?.replace('Z', '') || e.timestamp;
        const cls = e.status < 300 ? 'ok' : e.status < 500 ? 'warn' : 'err';
        return `<tr class="diag-${cls}"><td>${escapeHtml(ts)}</td><td>${e.method}</td><td title="${escapeHtml(e.path)}">${escapeHtml(e.path)}</td><td>${e.status}</td><td>${e.durationMs}ms</td></tr>`;
      }).join('');

      trafficLogEl.innerHTML = `<table class="diag-table"><thead><tr><th>${t('modals.settingsWindow.table.time')}</th><th>${t('modals.settingsWindow.table.method')}</th><th>${t('modals.settingsWindow.table.path')}</th><th>${t('modals.settingsWindow.table.status')}</th><th>${t('modals.settingsWindow.table.duration')}</th></tr></thead><tbody>${rows}</tbody></table>`;
    } catch {
      trafficLogEl.innerHTML = `<p class="diag-empty">${t('modals.settingsWindow.sidecarUnreachable')}</p>`;
    }
  }

  refreshBtn?.addEventListener('click', () => void refreshTrafficLog());

  clearBtn?.addEventListener('click', async () => {
    try { await diagFetch('/api/local-traffic-log', { method: 'DELETE' }); } catch { /* ignore */ }
    if (trafficLogEl) trafficLogEl.innerHTML = `<p class="diag-empty">${t('modals.settingsWindow.logCleared')}</p>`;
    if (trafficCount) trafficCount.textContent = '(0)';
  });

  let refreshInterval: ReturnType<typeof setInterval> | null = null;

  function startAutoRefresh(): void {
    stopAutoRefresh();
    refreshInterval = setInterval(() => void refreshTrafficLog(), 3000);
  }

  function stopAutoRefresh(): void {
    if (refreshInterval) { clearInterval(refreshInterval); refreshInterval = null; }
  }

  autoRefreshToggle?.addEventListener('change', () => {
    if (autoRefreshToggle.checked) startAutoRefresh(); else stopAutoRefresh();
  });

  void refreshTrafficLog();
  startAutoRefresh();

  _diagCleanup = stopAutoRefresh;
}

// ── Search ──

function highlightMatch(text: string, query: string): string {
  const escaped = escapeHtml(text);
  const qEscaped = escapeHtml(query);
  if (!qEscaped) return escaped;
  const regex = new RegExp(`(${qEscaped.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
  return escaped.replace(regex, '<mark>$1</mark>');
}

function handleSearch(query: string): void {
  const area = document.getElementById('contentArea');
  if (!area) return;

  if (!query.trim()) {
    renderSection(activeSection);
    return;
  }

  const q = query.toLowerCase();
  const matches: Array<{ feature: RuntimeFeatureDefinition; catLabel: string }> = [];

  for (const cat of SETTINGS_CATEGORIES) {
    for (const fid of cat.features) {
      const feature = RUNTIME_FEATURES.find(f => f.id === fid);
      if (!feature) continue;
      const searchable = [
        feature.name,
        feature.description,
        ...getEffectiveSecrets(feature).map(k => HUMAN_LABELS[k] || k),
      ].join(' ').toLowerCase();
      if (searchable.includes(q)) {
        matches.push({ feature, catLabel: cat.label });
      }
    }
  }

  if (matches.length === 0) {
    area.innerHTML = `<div class="settings-search-empty"><p>No features match "${escapeHtml(query)}"</p></div>`;
    return;
  }

  const cards = matches.map(({ feature, catLabel }) => {
    const enabled = isFeatureEnabled(feature.id);
    const available = isFeatureAvailable(feature.id);
    const effectiveSecrets = getEffectiveSecrets(feature);
    const allStaged = !available && effectiveSecrets.every(
      k => getSecretState(k).valid || (settingsManager.hasPending(k) && settingsManager.getValidationState(k).validated !== false)
    );
    const borderClass = available ? 'ready' : allStaged ? 'staged' : 'needs';
    const pillClass = available ? 'ok' : allStaged ? 'staged' : 'warn';
    const pillLabel = available ? 'Ready' : allStaged ? 'Staged' : 'Needs keys';
    const secretRows = effectiveSecrets.map(key => renderSecretInput(key, feature.id)).join('');

    return `
      <div class="settings-feat ${borderClass} expanded" data-feature-id="${feature.id}">
        <div class="settings-feat-header" data-feat-toggle-expand="${feature.id}">
          <label class="settings-feat-toggle-label" data-click-stop>
            <div class="settings-feat-switch">
              <input type="checkbox" data-toggle="${feature.id}" ${enabled ? 'checked' : ''} />
              <span class="settings-feat-slider"></span>
            </div>
          </label>
          <div class="settings-feat-info">
            <span class="settings-feat-name">${highlightMatch(feature.name, query)}</span>
            <span class="settings-feat-desc">${highlightMatch(feature.description, query)}</span>
          </div>
          <span class="settings-feat-pill ${pillClass}">${pillLabel}</span>
          <span class="settings-feat-chevron">&#x25B8;</span>
        </div>
        <div class="settings-feat-body">
          <div class="settings-feat-cat-tag">${escapeHtml(catLabel)}</div>
          ${secretRows}
        </div>
      </div>
    `;
  }).join('');

  area.innerHTML = `
    <div class="settings-section-header">
      <h2>Search results for "${escapeHtml(query)}"</h2>
    </div>
    <div class="settings-feat-list">${cards}</div>
  `;

  initFeatureSectionListeners(area);
}

// ── Init ──

async function initSettingsWindow(): Promise<void> {
  await initI18n();
  applyStoredTheme();

  try { await resolveLocalApiPort(); } catch { /* use default */ }

  requestAnimationFrame(() => {
    document.documentElement.classList.remove('no-transition');
  });

  await loadDesktopSecrets();
  settingsManager = new SettingsManager();

  renderSection('overview');

  document.getElementById('sidebarNav')?.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-section]');
    if (btn?.dataset.section) {
      renderSection(btn.dataset.section);
    }
  });

  const searchInput = document.getElementById('settingsSearch') as HTMLInputElement | null;
  let searchTimeout: ReturnType<typeof setTimeout>;
  searchInput?.addEventListener('input', () => {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => handleSearch(searchInput.value), 200);
  });

  document.getElementById('okBtn')?.addEventListener('click', () => {
    void (async () => {
      try {
        const wmKeyInput = document.querySelector<HTMLInputElement>('[data-wm-key-input]');
        const wmKeyValue = wmKeyInput?.value.trim();
        const hasWmKeyChange = !!(wmKeyValue && wmKeyValue !== MASKED_SENTINEL && wmKeyValue.length > 0);
        const glintTokenInput = document.querySelector<HTMLInputElement>('[data-glint-token-input]');
        const glintTokenValue = glintTokenInput?.value.trim() ?? '';
        const currentGlintToken = getGlintAuthToken() || '';
        const hasGlintTokenChange = glintTokenInput
          ? glintTokenValue !== MASKED_SENTINEL && glintTokenValue !== currentGlintToken
          : false;

        const contentArea = document.getElementById('contentArea');
        if (contentArea) settingsManager.captureUnsavedInputs(contentArea);

        const hasPending = settingsManager.hasPendingChanges();
        if (!hasPending && !hasWmKeyChange && !hasGlintTokenChange) {
          closeSettingsWindow();
          return;
        }

        if (hasWmKeyChange && wmKeyValue) {
          await setSecretValue('WORLDMONITOR_API_KEY', wmKeyValue);
        }

        if (hasGlintTokenChange) {
          if (glintTokenValue) {
            setGlintAuthToken(glintTokenValue);
          } else {
            clearGlintAuthToken();
          }
        }

        if (hasPending) {
          setActionStatus(t('modals.settingsWindow.validating'), 'ok');
          const missingRequired = settingsManager.getMissingRequiredSecrets();
          if (missingRequired.length > 0) {
            setActionStatus(`Missing required: ${missingRequired.join(', ')}`, 'error');
            return;
          }
          const errors = await settingsManager.verifyPendingSecrets();
          if (errors.length > 0) {
            setActionStatus(t('modals.settingsWindow.verifyFailed', { errors: errors.join(', ') }), 'error');
            return;
          }
          await settingsManager.commitVerifiedSecrets();
        }

        setActionStatus(t('modals.settingsWindow.saved'), 'ok');
        closeSettingsWindow();
      } catch (err) {
        console.error('[settings] save error:', err);
        setActionStatus(t('modals.settingsWindow.failed', { error: String(err) }), 'error');
      }
    })();
  });

  document.getElementById('cancelBtn')?.addEventListener('click', () => {
    closeSettingsWindow();
  });

  window.addEventListener('beforeunload', () => {
    settingsManager.destroy();
  });
}

localStorage.setItem('wm-settings-open', '1');
window.addEventListener('beforeunload', () => localStorage.removeItem('wm-settings-open'));

void initSettingsWindow();
