import { escapeHtml, statusChip, toEvidenceTierTone, toNextActionCopy } from './status-vocabulary.mjs';

const SURFACES_CSS_ID = 'lattice-modern-surfaces-css';
const SURFACES_CSS_PATH = '/src/dashboard/surfaces/surfaces.css';

export function ensureModernSurfaceStylesheet() {
  if (typeof document === 'undefined') return;
  if (!document.body.classList.contains('modern-cockpit')) {
    document.body.classList.add('modern-cockpit');
  }
  if (document.getElementById(SURFACES_CSS_ID)) return;
  const link = document.createElement('link');
  link.id = SURFACES_CSS_ID;
  link.rel = 'stylesheet';
  link.href = SURFACES_CSS_PATH;
  document.head.appendChild(link);
}

export function renderSurfaceHeader({ eyebrow, title, summary, meta = '', actions = '' }) {
  return `
    <div class="modern-surface-header">
      <div class="modern-surface-copy">
        <div class="modern-surface-eyebrow">${escapeHtml(eyebrow || 'Workspace')}</div>
        <h2>${escapeHtml(title || 'Surface')}</h2>
        ${summary ? `<p>${escapeHtml(summary)}</p>` : ''}
      </div>
      <div class="modern-surface-meta">
        ${meta ? `<div class="modern-meta-line">${escapeHtml(meta)}</div>` : ''}
        ${actions || ''}
      </div>
    </div>
  `;
}

export function renderMetricCell(label, value, tone = 'neutral') {
  return `
    <div class="modern-metric-cell tone-${escapeHtml(tone)}">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(value)}</strong>
    </div>
  `;
}

export function renderClosureMatrix(rows = []) {
  const safeRows = Array.isArray(rows) ? rows : [];
  if (!safeRows.length) {
    return '<div class="modern-empty">No class-level closure rows are available yet.</div>';
  }
  const body = safeRows.map((row) => {
    const tier = row.tier || row.evidenceUse || row.marketTier || 'missing';
    const tierTone = toEvidenceTierTone(tier);
    const state = row.visualStatus || row.state || 'pending';
    const route = Array.isArray(row.providerRoute)
      ? row.providerRoute.join(', ')
      : row.providerRoute || row.provider || '--';
    const latest = row.latestRun || row.latestRunResult || row.lastResult || '--';
    const reason = row.closureReason || row.terminalReason || row.primaryBlocker || '--';
    const action = toNextActionCopy(row);
    return `
      <tr class="modern-closure-row tone-${escapeHtml(tierTone)}" data-evidence-class="${escapeHtml(row.evidenceClass || '')}">
        <td data-label="Class"><strong>${escapeHtml(row.evidenceClass || row.className || 'unknown')}</strong></td>
        <td data-label="State">${statusChip(state, { title: reason })}</td>
        <td data-label="Provider">${escapeHtml(route)}</td>
        <td data-label="Tier"><span class="modern-tier tone-${escapeHtml(tierTone)}">${escapeHtml(tier)}</span></td>
        <td data-label="Latest run">${escapeHtml(latest)}</td>
        <td data-label="Closure reason"><span class="modern-clamp">${escapeHtml(reason)}</span></td>
        <td data-label="Next action"><span class="modern-clamp">${escapeHtml(action)}</span></td>
      </tr>
    `;
  }).join('');
  return `
    <div class="modern-table-wrap">
      <table class="modern-closure-table">
        <thead>
          <tr>
            <th>Class</th>
            <th>State</th>
            <th>Provider</th>
            <th>Tier</th>
            <th>Latest run</th>
            <th>Closure reason</th>
            <th>Next action</th>
          </tr>
        </thead>
        <tbody>${body}</tbody>
      </table>
    </div>
  `;
}

export function ensureAuditDrawer() {
  if (typeof document === 'undefined') return null;
  let drawer = document.getElementById('modern-audit-drawer');
  if (drawer) return drawer;
  const backdrop = document.createElement('div');
  backdrop.id = 'modern-audit-backdrop';
  backdrop.className = 'modern-audit-backdrop';
  backdrop.addEventListener('click', closeAuditDrawer);
  drawer = document.createElement('aside');
  drawer.id = 'modern-audit-drawer';
  drawer.className = 'modern-audit-drawer';
  drawer.setAttribute('role', 'dialog');
  drawer.setAttribute('aria-modal', 'true');
  drawer.setAttribute('aria-label', 'Audit details');
  drawer.innerHTML = `
    <div class="modern-audit-head">
      <div>
        <div class="modern-surface-eyebrow">Audit Appendix</div>
        <strong id="modern-audit-title">Details</strong>
      </div>
      <button type="button" class="modern-btn" data-modern-audit-close>Close</button>
    </div>
    <div id="modern-audit-body" class="modern-audit-body"></div>
  `;
  drawer.querySelector('[data-modern-audit-close]')?.addEventListener('click', closeAuditDrawer);
  document.body.append(backdrop, drawer);
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeAuditDrawer();
  });
  return drawer;
}

export function openAuditDrawer(title, payload) {
  openAuditDrawerHtml(title, `<pre>${escapeHtml(JSON.stringify(payload || {}, null, 2))}</pre>`);
}

export function openAuditDrawerHtml(title, html) {
  const drawer = ensureAuditDrawer();
  const backdrop = document.getElementById('modern-audit-backdrop');
  if (!drawer) return;
  const titleEl = document.getElementById('modern-audit-title');
  const bodyEl = document.getElementById('modern-audit-body');
  if (titleEl) titleEl.textContent = title || 'Audit details';
  if (bodyEl) {
    bodyEl.innerHTML = html || '';
  }
  backdrop?.classList.add('active');
  drawer.classList.add('active');
  drawer.querySelector('button')?.focus();
}

export function closeAuditDrawer() {
  document.getElementById('modern-audit-backdrop')?.classList.remove('active');
  document.getElementById('modern-audit-drawer')?.classList.remove('active');
}

export { escapeHtml, statusChip };
