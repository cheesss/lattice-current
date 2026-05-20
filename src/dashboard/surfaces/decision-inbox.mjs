import { ensureModernSurfaceStylesheet, escapeHtml } from './surface-primitives.mjs';
import { toStatusLabel } from './status-vocabulary.mjs';

const LANE_LABELS = {
  'research-backfill': 'Research Backfill',
  'source-governance': 'Source Governance',
  'canonical-proposal': 'Canonical Proposal',
  'signal-review': 'Signal Review',
  'needs-fix': 'Needs Fix',
};

function textOf(row) {
  return String(row?.textContent || '').toLowerCase();
}

function chipTexts(row) {
  return [...row.querySelectorAll('.trust-chip')]
    .map((chip) => String(chip.textContent || '').trim())
    .filter(Boolean);
}

function classifyLane(row) {
  if (row.classList.contains('needs-fix') || chipTexts(row).includes('FIX')) return 'needs-fix';
  const chips = chipTexts(row);
  const text = textOf(row);
  if (chips.includes('E2')) return 'signal-review';
  if (chips.includes('Disc') || text.includes('discovery')) return 'canonical-proposal';
  if (chips.includes('Prop') || text.includes('proposal')) return 'canonical-proposal';
  if (chips.includes('Appr') && /source-query|backfill|report|evidence|research/.test(text)) return 'research-backfill';
  if (chips.includes('Appr')) return 'source-governance';
  return 'signal-review';
}

function relabelChips(row) {
  const seenLabels = new Set();
  row.querySelectorAll('.trust-chip').forEach((chip) => {
    const raw = String(chip.textContent || '').trim();
    const label = toStatusLabel(raw);
    if (label && label !== raw) {
      chip.textContent = label;
      chip.setAttribute('title', raw);
    }
    const normalized = String(chip.textContent || '').trim().toLowerCase();
    if (normalized && seenLabels.has(normalized)) {
      chip.dataset.modernDuplicateChip = 'true';
      chip.setAttribute('aria-hidden', 'true');
      return;
    }
    chip.dataset.modernDuplicateChip = 'false';
    chip.removeAttribute('aria-hidden');
    seenLabels.add(normalized);
  });
}

function renderLaneStrip(rows) {
  const counts = Object.fromEntries(Object.keys(LANE_LABELS).map((key) => [key, 0]));
  rows.forEach((row) => {
    const lane = row.getAttribute('data-lane') || classifyLane(row);
    counts[lane] = (counts[lane] || 0) + 1;
  });
  return `
    <div class="modern-inbox-lanes modern-lane-strip" aria-label="Decision inbox lanes">
      ${Object.entries(LANE_LABELS).map(([key, label]) => `
        <span class="modern-lane-chip" data-modern-lane="${escapeHtml(key)}">
          ${escapeHtml(label)} <strong>${counts[key] || 0}</strong>
        </span>
      `).join('')}
    </div>
  `;
}

function enhanceRows(listEl) {
  const rows = [...listEl.querySelectorAll('.inbox-item')];
  rows.forEach((row) => {
    const lane = classifyLane(row);
    row.setAttribute('data-lane', lane);
    row.setAttribute('data-lane-label', LANE_LABELS[lane] || 'Review');
    relabelChips(row);
  });
  return rows;
}

export function enhanceDecisionInbox() {
  ensureModernSurfaceStylesheet();
  const listEl = document.getElementById('inbox-list');
  if (!listEl) return;
  const rows = enhanceRows(listEl);
  let laneHost = document.getElementById('modern-inbox-lanes-host');
  if (!laneHost) {
    laneHost = document.createElement('div');
    laneHost.id = 'modern-inbox-lanes-host';
    listEl.parentElement?.insertBefore(laneHost, listEl);
  }
  laneHost.innerHTML = renderLaneStrip(rows);

  const preview = document.getElementById('inbox-preview');
  preview?.classList.add('modern-inbox-preview');
  document.getElementById('inbox-bulk-bar')?.classList.add('modern-action-rail');
}

function installMutationObserver() {
  const listEl = document.getElementById('inbox-list');
  if (!listEl || listEl.dataset.modernObserved === '1') return;
  listEl.dataset.modernObserved = '1';
  const observer = new MutationObserver(() => {
    window.requestAnimationFrame(enhanceDecisionInbox);
  });
  observer.observe(listEl, { childList: true, subtree: true });
}

export function installDecisionInboxSurface() {
  ensureModernSurfaceStylesheet();
  const originalRender = window.renderInboxList;
  if (typeof originalRender === 'function' && !originalRender.__modernWrapped) {
    const wrapped = function renderInboxListModernWrapper(...args) {
      const result = originalRender.apply(this, args);
      window.requestAnimationFrame(enhanceDecisionInbox);
      return result;
    };
    wrapped.__modernWrapped = true;
    window.renderInboxList = wrapped;
  }
  installMutationObserver();
  enhanceDecisionInbox();
}
