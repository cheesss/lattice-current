import {
  ensureModernSurfaceStylesheet,
  escapeHtml,
  openAuditDrawer,
  openAuditDrawerHtml,
  renderClosureMatrix,
  renderMetricCell,
  renderSurfaceHeader,
  statusChip,
} from './surface-primitives.mjs';

let lastGapItems = [];
let lastSeedItems = [];

function ensureSectionRoot(id, className, afterId = '') {
  let root = document.getElementById(id);
  if (root) return root;
  const investigateSurface = document.querySelector('.surface[data-surface="investigate"]');
  if (!investigateSurface) return null;

  const section = document.createElement('section');
  section.className = `section-block ${className}-section`;
  section.id = `${className}-section`;
  root = document.createElement('div');
  root.id = id;
  root.className = className;
  section.appendChild(root);

  const after = afterId ? document.getElementById(afterId) : null;
  if (after?.parentElement === investigateSurface) {
    after.insertAdjacentElement('afterend', section);
    return root;
  }
  const reportSection = document.getElementById('modern-report-backfill-section');
  if (reportSection?.parentElement === investigateSurface) {
    reportSection.insertAdjacentElement('afterend', section);
  } else {
    const drawerTabs = document.querySelector('.investigate-drawers-tab-row');
    if (drawerTabs?.parentElement === investigateSurface) {
      investigateSurface.insertBefore(section, drawerTabs);
    } else {
      investigateSurface.appendChild(section);
    }
  }
  return root;
}

function ensureSeedReviewRoot() {
  return ensureSectionRoot('operator-seed-review', 'modern-seed-review');
}

function ensureProviderGapRoot() {
  return ensureSectionRoot('operator-seed-provider-gap-review', 'modern-seed-provider-gap-review', 'modern-seed-review-section');
}

async function fetchSeedReview() {
  const response = await fetch('/api/research-seeds?statuses=review_ready,needs_evidence,evidence_running,report_candidate&limit=12', { cache: 'no-store' });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

async function fetchSeedDetail(seedId) {
  const response = await fetch(`/api/research-seeds/${encodeURIComponent(seedId)}`, { cache: 'no-store' });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

async function postSeedAction(seedId, action, payload = {}) {
  const response = await fetch(`/api/research-seeds/${encodeURIComponent(seedId)}/${action}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
  return data;
}

async function fetchProviderGapReview() {
  const response = await fetch('/api/research-seeds/provider-gaps?statuses=review_ready&limit=8', { cache: 'no-store' });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

function providerList(item = {}) {
  const providers = Array.isArray(item.providers) ? item.providers : [];
  if (!providers.length) return '<span class="modern-meta-line">No provider gap labels</span>';
  return `
    <div class="modern-provider-pill-row" aria-label="Provider gaps">
      ${providers.slice(0, 8).map((provider) => `<span class="modern-provider-pill">${escapeHtml(provider)}</span>`).join('')}
    </div>
  `;
}

function evidenceClassList(item = {}) {
  const classes = Array.isArray(item.evidenceClassesBlocked) ? item.evidenceClassesBlocked : [];
  if (!classes.length) return 'No blocked classes';
  return classes.slice(0, 6).join(', ');
}

function listItems(items = [], empty = 'None') {
  const safe = Array.isArray(items) ? items.filter(Boolean) : [];
  if (!safe.length) return `<span class="modern-meta-line">${escapeHtml(empty)}</span>`;
  return `<ul class="modern-compact-list">${safe.slice(0, 12).map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>`;
}

function providerGapPills(gaps = []) {
  const safe = Array.isArray(gaps) ? gaps.filter(Boolean) : [];
  if (!safe.length) return '<span class="modern-meta-line">No provider gaps</span>';
  return `
    <div class="modern-provider-pill-row">
      ${safe.slice(0, 10).map((gap) => `<span class="modern-provider-pill">${escapeHtml(gap)}</span>`).join('')}
    </div>
  `;
}

function renderKeyValue(label, value) {
  return `
    <div class="modern-kv">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(value || '--')}</strong>
    </div>
  `;
}

function renderSeedDetailHtml(detail = {}) {
  const mechanism = detail.mechanism || {};
  const evidence = detail.evidence || {};
  const bias = detail.bias || {};
  const bottleneck = mechanism.bottleneck || {};
  const supplier = mechanism.supplierCategory || {};
  return `
    <div class="modern-seed-detail">
      <section class="modern-detail-section">
        <div class="modern-surface-eyebrow">Mechanism Chain</div>
        <div class="modern-detail-grid">
          ${renderKeyValue('Growth driver', mechanism.growthDriver)}
          ${renderKeyValue('Real activity', mechanism.realActivity)}
          ${renderKeyValue('Physical process', mechanism.physicalProcess)}
          ${renderKeyValue('Required inputs', Array.isArray(mechanism.requiredInputs) ? mechanism.requiredInputs.join(', ') : '')}
          ${renderKeyValue('Bottleneck', bottleneck.label)}
          ${renderKeyValue('Bottleneck class', bottleneck.class)}
          ${renderKeyValue('Supplier', supplier.label)}
          ${renderKeyValue('Issuer candidates', Array.isArray(supplier.publicIssuerCandidates) ? supplier.publicIssuerCandidates.join(', ') : '')}
        </div>
      </section>
      <section class="modern-detail-section">
        <div class="modern-surface-eyebrow">Evidence State</div>
        <div class="modern-metric-grid">
          ${renderMetricCell('Phase C', evidence.phaseCStatus || 'unknown', evidence.phaseCStatus === 'complete' ? 'complete' : 'blocked')}
          ${renderMetricCell('Provider', evidence.providerBackfillStatus || 'unknown', evidence.providerBackfillStatus === 'provider_backfill_complete' ? 'complete' : 'pending')}
          ${renderMetricCell('Negative', evidence.negativeControlStatus || 'unchecked', evidence.negativeControlStatus === 'invalidator' ? 'blocked' : 'review')}
          ${renderMetricCell('Market', evidence.marketValidationStatus || 'unknown', 'info')}
        </div>
        ${renderClosureMatrix(evidence.classRows || [])}
      </section>
      <section class="modern-detail-section">
        <div class="modern-surface-eyebrow">Queries</div>
        <div class="modern-detail-grid two">
          <div>
            <strong>Evidence queries</strong>
            ${listItems(detail.detail?.evidenceQueries || [], 'No evidence queries')}
          </div>
          <div>
            <strong>Counter-evidence queries</strong>
            ${listItems(detail.detail?.counterEvidenceQueries || [], 'No counter-evidence queries')}
          </div>
        </div>
      </section>
      <section class="modern-detail-section">
        <div class="modern-surface-eyebrow">Bias And Coverage</div>
        <div class="modern-detail-grid two">
          <div>
            <strong>Provider gaps</strong>
            ${providerGapPills(bias.providerGaps || [])}
          </div>
          <div>
            <strong>Missing sources</strong>
            ${listItems(bias.missingSources || [], 'No missing source labels')}
          </div>
        </div>
      </section>
      <details class="modern-audit-details">
        <summary>Audit payload</summary>
        <pre>${escapeHtml(JSON.stringify({
          seedId: detail.seedId,
          phaseCAudit: detail.detail?.phaseCAudit,
          providerGapReview: detail.providerGapReview,
          auditPayload: detail.detail?.auditPayload,
          mutationPolicy: detail.mutationPolicy,
        }, null, 2))}</pre>
      </details>
    </div>
  `;
}

function renderEvidencePlanHtml(data = {}) {
  return `
    <div class="modern-seed-detail">
      <section class="modern-detail-section">
        <div class="modern-surface-eyebrow">Evidence Plan</div>
        <div class="modern-metric-grid">
          ${renderMetricCell('Source drafts', String(data.sourceQueryDraftCount || 0), 'pending')}
          ${renderMetricCell('Negative drafts', String(data.negativeControlDraftCount || 0), 'negative')}
          ${renderMetricCell('Market', data.marketValidationStatus || 'unknown', 'info')}
          ${renderMetricCell('Queue default', data.enqueueDefault ? 'on' : 'off', data.enqueueDefault ? 'blocked' : 'complete')}
        </div>
        ${renderClosureMatrix(data.evidence?.classRows || [])}
      </section>
      <section class="modern-detail-section">
        <div class="modern-surface-eyebrow">Boundary</div>
        <pre>${escapeHtml(JSON.stringify(data.mutationPolicy || {}, null, 2))}</pre>
      </section>
    </div>
  `;
}

function renderSeedLifecycleTable(items = []) {
  if (!items.length) return '<div class="modern-empty">No mechanism seeds match this view.</div>';
  const rows = items.map((item, index) => {
    const inputs = Array.isArray(item.mechanism?.requiredInputs) ? item.mechanism.requiredInputs.join(', ') : '';
    const supplier = item.mechanism?.supplierCategory || {};
    const issuers = Array.isArray(supplier.publicIssuerCandidates) ? supplier.publicIssuerCandidates.join(', ') : '';
    const biasFlags = [
      ...(Array.isArray(item.bias?.flags) ? item.bias.flags : []),
      ...(Array.isArray(item.bias?.missingSources) ? item.bias.missingSources : []),
      ...(Array.isArray(item.bias?.providerGaps) ? item.bias.providerGaps : []),
    ].slice(0, 3).join(', ');
    return `
      <tr class="modern-seed-row" data-seed-index="${index}">
        <td data-label="Seed">
          <button type="button" class="modern-link-btn" data-seed-detail="${index}">
            ${escapeHtml(item.title || item.seedId)}
          </button>
          <div class="modern-meta-line">${escapeHtml(item.theme?.label || item.theme?.key || 'theme')}</div>
        </td>
        <td data-label="Mechanism">
          <span class="modern-clamp">${escapeHtml(item.mechanism?.physicalProcess || item.mechanism?.realActivity || '--')}</span>
          <div class="modern-meta-line">${escapeHtml(inputs || item.mechanism?.bottleneck?.class || '')}</div>
        </td>
        <td data-label="Bottleneck">
          <span class="modern-clamp">${escapeHtml(item.mechanism?.bottleneck?.label || '--')}</span>
          <div class="modern-meta-line">${escapeHtml(item.mechanism?.bottleneck?.class || '')}</div>
        </td>
        <td data-label="Supplier">
          <span class="modern-clamp">${escapeHtml(supplier.label || '--')}</span>
          <div class="modern-meta-line">${escapeHtml(issuers || (supplier.privateOnly ? 'private-only' : ''))}</div>
        </td>
        <td data-label="State">${statusChip(item.visualStatus || item.status, { title: item.primaryBlocker || '' })}</td>
        <td data-label="Score"><span class="modern-mono">${escapeHtml(item.score ?? '--')}</span></td>
        <td data-label="Bias">
          <span class="modern-clamp">${escapeHtml(biasFlags || 'no major flags')}</span>
        </td>
        <td data-label="Evidence">
          <div>${statusChip(item.evidence?.phaseCStatus || 'unknown')}</div>
          <div class="modern-meta-line">${escapeHtml(item.evidence?.providerBackfillStatus || 'unknown')} | neg ${escapeHtml(item.evidence?.negativeControlStatus || 'unchecked')}</div>
        </td>
        <td data-label="Next action"><span class="modern-clamp">${escapeHtml(item.nextAction || 'Review seed')}</span></td>
        <td data-label="Actions">
          <div class="modern-action-stack">
            <button type="button" class="modern-btn" data-seed-detail="${index}">Detail</button>
            <button type="button" class="modern-btn" data-seed-evidence="${index}">Evidence</button>
            <button type="button" class="modern-btn" data-seed-enqueue="${index}" ${item.actionAvailability?.canRequestEvidence ? '' : 'disabled'}>Queue SQ</button>
            <button type="button" class="modern-btn" data-seed-needs-evidence="${index}" ${item.actionAvailability?.canReview ? '' : 'disabled'}>Needs evidence</button>
            <button type="button" class="modern-btn" data-seed-reject="${index}" ${item.actionAvailability?.canReject ? '' : 'disabled'}>Reject</button>
            <button type="button" class="modern-btn" data-seed-report-candidate="${index}" ${item.actionAvailability?.canMarkReportCandidate ? '' : 'disabled'}>Candidate</button>
          </div>
        </td>
      </tr>
    `;
  }).join('');
  return `
    <div class="modern-table-wrap">
      <table class="modern-closure-table modern-seed-table">
        <thead>
          <tr>
            <th>Seed</th>
            <th>Mechanism</th>
            <th>Bottleneck</th>
            <th>Supplier</th>
            <th>State</th>
            <th>Score</th>
            <th>Bias</th>
            <th>Evidence</th>
            <th>Next action</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `;
}

function renderSeedReview(data = {}) {
  const items = Array.isArray(data.items) ? data.items : [];
  lastSeedItems = items;
  const actions = '<button type="button" class="modern-btn" data-seed-refresh>Refresh</button>';
  return `
    ${renderSurfaceHeader({
      eyebrow: 'Research Seeds',
      title: 'Seed candidates',
      summary: 'Mechanism seeds ready for operator review. Review actions only update seed lifecycle state unless evidence enqueue is explicitly confirmed.',
      meta: data.source || 'operator-seed-review-surface',
      actions,
    })}
    <div class="modern-metric-grid">
      ${renderMetricCell('Seeds', String(data.total || items.length), 'review')}
      ${renderMetricCell('Review ready', String(data.statusCounts?.review_ready || 0), 'info')}
      ${renderMetricCell('Need evidence', String(data.statusCounts?.needs_evidence || 0), 'pending')}
      ${renderMetricCell('Phase C complete', String(data.phaseCStatusCounts?.complete || 0), 'complete')}
    </div>
    ${renderSeedLifecycleTable(items)}
  `;
}

function renderSeedCard(item, index) {
  const title = item.title || item.seedId || 'operator seed';
  const theme = item.theme?.label || item.theme?.key || 'theme';
  const score = Number(item.score || 0);
  const negative = item.negativeControl?.closure || item.negativeControl?.status || 'unchecked';
  const providerStatus = item.providerBackfill?.status || 'unknown';
  return `
    <article class="modern-report-card modern-seed-card" data-seed-review-index="${index}">
      <div class="modern-report-head">
        <div>
          <div class="modern-report-title">
            <strong>${escapeHtml(title)}</strong>
            ${statusChip(item.reviewState || providerStatus, { title: item.nextAction || '' })}
          </div>
          <div class="modern-meta-line">
            ${escapeHtml(theme)} | score ${escapeHtml(score.toFixed(3))} | ${escapeHtml(providerStatus)} | negative ${escapeHtml(negative)}
          </div>
          <div class="modern-meta-line">
            Blocked classes: <span class="modern-clamp">${escapeHtml(evidenceClassList(item))}</span>
          </div>
          ${providerList(item)}
        </div>
        <div class="modern-report-actions">
          <button type="button" class="modern-btn" data-seed-review-audit="${index}">Audit details</button>
        </div>
      </div>
      <div class="modern-seed-next-action">${escapeHtml(item.nextAction || 'Review provider gap item')}</div>
    </article>
  `;
}

function renderProviderGapReview(data = {}) {
  const items = Array.isArray(data.items) ? data.items : [];
  lastGapItems = items;
  const actions = '<button type="button" class="modern-btn" data-seed-gap-refresh>Refresh</button>';
  if (!items.length) {
    return `
      ${renderSurfaceHeader({
        eyebrow: 'Research Seeds',
        title: 'Provider gap review',
        summary: 'No exhausted mechanism seed provider gaps match this view.',
        meta: data.source || 'operator-seed-provider-gap-review',
        actions,
      })}
      <div class="modern-empty">No provider gap review items.</div>
    `;
  }
  return `
    ${renderSurfaceHeader({
      eyebrow: 'Research Seeds',
      title: 'Provider gap review',
      summary: 'Exhausted direct-provider seed routes grouped by missing source coverage and adapter scope.',
      meta: data.source || 'operator-seed-provider-gap-review',
      actions,
    })}
    <div class="modern-metric-grid">
      ${renderMetricCell('Review items', String(data.reviewItemCount || items.length), 'review')}
      ${renderMetricCell('Exhausted', String(data.exhaustedSeedCount || 0), 'blocked')}
      ${renderMetricCell('Proposals', String(data.proposalCount || 0), 'info')}
      ${renderMetricCell('Drafts', String(data.readyDraftCount || 0), 'pending')}
    </div>
    <div class="modern-seed-grid">
      ${items.map(renderSeedCard).join('')}
    </div>
  `;
}

function showSeedActionStatus(root, message, tone = 'info') {
  let status = root.querySelector('.modern-seed-action-status');
  if (!status) {
    status = document.createElement('div');
    status.className = 'modern-seed-action-status';
    status.setAttribute('role', 'status');
    root.prepend(status);
  }
  status.className = `modern-seed-action-status tone-${tone}`;
  status.textContent = message;
}

async function openSeedDetail(index) {
  const item = lastSeedItems[index] || {};
  if (!item.seedId) return;
  const data = await fetchSeedDetail(item.seedId);
  const detail = data.item || {};
  openAuditDrawerHtml(detail.title || detail.seedId || 'Seed detail', renderSeedDetailHtml(detail));
}

async function reviewSeedStatus(root, item, status, defaultReason) {
  if (!item.seedId) return;
  const reason = window.prompt('검토 사유를 입력하세요.', defaultReason);
  if (reason === null) return;
  await postSeedAction(item.seedId, 'review', { status, reason, reviewer: 'dashboard' });
  showSeedActionStatus(root, `Seed marked as ${status}.`, status === 'rejected' ? 'blocked' : 'complete');
  await renderSeedReviewSurface();
}

function bindSeedReview(root) {
  root.querySelector('[data-seed-refresh]')?.addEventListener('click', () => renderSeedReviewSurface());
  root.querySelectorAll('[data-seed-detail]').forEach((button) => {
    button.addEventListener('click', () => {
      const index = Number(button.getAttribute('data-seed-detail'));
      openSeedDetail(index).catch((error) => showSeedActionStatus(root, `Detail load failed: ${error.message || error}`, 'blocked'));
    });
  });
  root.querySelectorAll('[data-seed-evidence]').forEach((button) => {
    button.addEventListener('click', async () => {
      const item = lastSeedItems[Number(button.getAttribute('data-seed-evidence'))] || {};
      if (!item.seedId) return;
      button.disabled = true;
      try {
        const data = await postSeedAction(item.seedId, 'evidence', { enqueue: false });
        openAuditDrawerHtml(item.title || item.seedId || 'Evidence plan', renderEvidencePlanHtml(data));
        showSeedActionStatus(root, 'Evidence plan loaded. No queue writes were made.', 'info');
      } catch (error) {
        showSeedActionStatus(root, `Evidence plan failed: ${error.message || error}`, 'blocked');
      } finally {
        button.disabled = false;
      }
    });
  });
  root.querySelectorAll('[data-seed-enqueue]').forEach((button) => {
    button.addEventListener('click', async () => {
      const item = lastSeedItems[Number(button.getAttribute('data-seed-enqueue'))] || {};
      if (!item.seedId) return;
      const ok = window.confirm('이 seed의 source-query draft만 approval_queue에 등록합니다. canonical/source registry/provider activation은 변경하지 않습니다.');
      if (!ok) return;
      button.disabled = true;
      try {
        const data = await postSeedAction(item.seedId, 'evidence', {
          enqueue: true,
          confirm: 'seed-scoped-source-query',
          limit: 50,
        });
        openAuditDrawer(item.title || item.seedId || 'Queued seed evidence', data);
        showSeedActionStatus(root, `Queued ${data.insertedCount || 0} seed-scoped source-query approvals.`, 'complete');
        await renderSeedReviewSurface();
      } catch (error) {
        showSeedActionStatus(root, `Queue failed: ${error.message || error}`, 'blocked');
      } finally {
        button.disabled = false;
      }
    });
  });
  root.querySelectorAll('[data-seed-needs-evidence]').forEach((button) => {
    button.addEventListener('click', async () => {
      const item = lastSeedItems[Number(button.getAttribute('data-seed-needs-evidence'))] || {};
      button.disabled = true;
      try {
        await reviewSeedStatus(root, item, 'needs_evidence', 'needs more direct evidence before review');
      } catch (error) {
        showSeedActionStatus(root, `Review action failed: ${error.message || error}`, 'blocked');
      } finally {
        button.disabled = false;
      }
    });
  });
  root.querySelectorAll('[data-seed-reject]').forEach((button) => {
    button.addEventListener('click', async () => {
      const item = lastSeedItems[Number(button.getAttribute('data-seed-reject'))] || {};
      button.disabled = true;
      try {
        await reviewSeedStatus(root, item, 'rejected', 'duplicate, generic, or invalidated seed');
      } catch (error) {
        showSeedActionStatus(root, `Reject failed: ${error.message || error}`, 'blocked');
      } finally {
        button.disabled = false;
      }
    });
  });
  root.querySelectorAll('[data-seed-report-candidate]').forEach((button) => {
    button.addEventListener('click', async () => {
      const item = lastSeedItems[Number(button.getAttribute('data-seed-report-candidate'))] || {};
      if (!item.seedId) return;
      const reason = window.prompt('보고서 후보로 표시할 이유를 입력하세요.', 'Phase D dashboard review');
      if (reason === null) return;
      button.disabled = true;
      try {
        await postSeedAction(item.seedId, 'report-candidate', { reason, reviewer: 'dashboard' });
        showSeedActionStatus(root, 'Seed marked as report candidate.', 'complete');
        await renderSeedReviewSurface();
      } catch (error) {
        showSeedActionStatus(root, `Report-candidate action failed: ${error.message || error}`, 'blocked');
      } finally {
        button.disabled = false;
      }
    });
  });
}

function bindProviderGapReview(root) {
  root.querySelector('[data-seed-gap-refresh]')?.addEventListener('click', () => renderSeedProviderGapReview());
  root.querySelectorAll('[data-seed-review-audit]').forEach((button) => {
    button.addEventListener('click', () => {
      const index = Number(button.getAttribute('data-seed-review-audit'));
      const item = lastGapItems[index] || {};
      openAuditDrawer(item.title || item.seedId || 'Provider gap review', {
        seedId: item.seedId,
        title: item.title,
        status: item.status,
        reviewState: item.reviewState,
        evidenceState: item.evidenceState,
        primaryBlocker: item.primaryBlocker,
        providerBackfill: item.providerBackfill,
        negativeControl: item.negativeControl,
        providerGaps: item.providerGaps,
        evidenceClassesBlocked: item.evidenceClassesBlocked,
        proposals: item.proposals,
        exhaustedRoutes: item.exhaustedRoutes,
        sampleQueries: item.sampleQueries,
        mutationPolicy: item.mutationPolicy,
        nextAction: item.nextAction,
      });
    });
  });
}

export async function renderSeedReviewSurface() {
  ensureModernSurfaceStylesheet();
  const root = ensureSeedReviewRoot();
  if (!root) return;
  root.innerHTML = `
    ${renderSurfaceHeader({
      eyebrow: 'Research Seeds',
      title: 'Seed candidates',
      summary: 'Loading mechanism seed review surface...',
    })}
    <div class="modern-empty">Loading seed candidates...</div>
  `;
  try {
    const data = await fetchSeedReview();
    root.innerHTML = renderSeedReview(data);
    bindSeedReview(root);
  } catch (error) {
    root.innerHTML = `
      ${renderSurfaceHeader({
        eyebrow: 'Research Seeds',
        title: 'Seed candidates',
        summary: 'The seed review endpoint did not return usable data.',
      })}
      <div class="modern-error" role="alert">Failed to load seed review: ${escapeHtml(error?.message || error)}</div>
    `;
  }
}

export async function renderSeedProviderGapReview() {
  ensureModernSurfaceStylesheet();
  const root = ensureProviderGapRoot();
  if (!root) return;
  root.innerHTML = `
    ${renderSurfaceHeader({
      eyebrow: 'Research Seeds',
      title: 'Provider gap review',
      summary: 'Loading exhausted seed provider gaps...',
    })}
    <div class="modern-empty">Loading provider gap review...</div>
  `;
  try {
    const data = await fetchProviderGapReview();
    root.innerHTML = renderProviderGapReview(data);
    bindProviderGapReview(root);
  } catch (error) {
    root.innerHTML = `
      ${renderSurfaceHeader({
        eyebrow: 'Research Seeds',
        title: 'Provider gap review',
        summary: 'The provider gap endpoint did not return usable data.',
      })}
      <div class="modern-error" role="alert">Failed to load provider gap review: ${escapeHtml(error?.message || error)}</div>
    `;
  }
}

export function installResearchSeedsSurface() {
  ensureModernSurfaceStylesheet();
  window.loadSeedProviderGapReview = renderSeedProviderGapReview;
  window.loadOperatorSeedReview = renderSeedReviewSurface;
  renderSeedReviewSurface();
  renderSeedProviderGapReview();
}
