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
let lastBiasDiagnostics = null;
let lastRepairLoop = null;
let lastAutomationConsole = null;

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

function ensureSeedBiasRoot() {
  return ensureSectionRoot('operator-seed-bias-diagnostics', 'modern-seed-bias-diagnostics', 'modern-seed-provider-gap-review-section');
}

function ensureRepairLoopRoot() {
  return ensureSectionRoot('operator-seed-repair-loop', 'modern-seed-repair-loop', 'modern-seed-bias-diagnostics-section');
}

function ensureAutomationConsoleRoot() {
  return ensureSectionRoot('operator-seed-automation-console', 'modern-seed-automation-console', 'modern-seed-repair-loop-section');
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

async function fetchSeedBiasDiagnostics() {
  const response = await fetch('/api/research-seeds/bias-diagnostics?limit=25', { cache: 'no-store' });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

async function fetchRepairLoopStatus() {
  const response = await fetch('/api/research-seeds/repair-loop', { cache: 'no-store' });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

async function fetchAutomationConsole() {
  const response = await fetch('/api/research-seeds/automation-console', { cache: 'no-store' });
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

function renderClassDistribution(distribution = {}) {
  const entries = Object.entries(distribution.counts || {}).sort((left, right) => Number(right[1]) - Number(left[1]));
  if (!entries.length) return '<div class="modern-empty">No seed class distribution available.</div>';
  return `
    <div class="modern-table-wrap">
      <table class="modern-closure-table">
        <thead><tr><th>Class</th><th>Count</th><th>Share</th></tr></thead>
        <tbody>
          ${entries.map(([klass, count]) => `
            <tr>
              <td>${escapeHtml(klass)}</td>
              <td><span class="modern-mono">${escapeHtml(count)}</span></td>
              <td><span class="modern-mono">${escapeHtml(Math.round(Number(distribution.shares?.[klass] || 0) * 1000) / 10)}%</span></td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;
}

function renderRecommendedBackfillTasks(tasks = []) {
  const rows = Array.isArray(tasks) ? tasks.slice(0, 10) : [];
  if (!rows.length) return '<div class="modern-empty">No recommended backfill tasks.</div>';
  return renderClosureMatrix(rows.map((task) => ({
    evidenceClass: task.evidenceClass,
    state: task.status || (task.adapterProposalRequired ? 'adapter proposal' : 'planned'),
    provider: task.providers || task.providerRoute || [],
    tier: task.evidenceClass === 'negative_control' ? 'negative_control_candidate' : 'supporting_context',
    latestRun: task.providerBackfillTaskCreated ? 'provider task queued' : `${task.sourceQueryDraftCount || 0} source-query draft(s)`,
    closureReason: task.adapterProposalRequired ? 'missing provider route' : '',
    nextAction: task.adapterProposalRequired ? 'review adapter proposal' : 'run targeted backfill; acceptance gate still applies',
  })));
}

function renderSeedBiasDiagnostics(data = {}) {
  lastBiasDiagnostics = data;
  const actions = `
    <button type="button" class="modern-btn" data-seed-bias-refresh>Refresh</button>
    <button type="button" class="modern-btn" data-seed-bias-audit>Audit</button>
  `;
  const metrics = data.metrics || {};
  const under = (data.underrepresentedClasses || []).map((item) => item.evidenceClass).slice(0, 6).join(', ') || 'none';
  const over = (data.overrepresentedClasses || []).map((item) => item.evidenceClass).slice(0, 6).join(', ') || 'none';
  const queue = data.backfillQueueStatus || {};
  const gate = data.reportCandidateGateResult || {};
  const selectedChild = data.selectedChildSeed || {};
  const issuerRoles = (data.issuerRoleClasses || []).slice(0, 6).join(', ') || 'none';
  const providerGapLinks = data.providerGapProposalLinks || [];
  const companyIrStatus = data.companyIrCollectorStatus || {};
  return `
    ${renderSurfaceHeader({
      eyebrow: 'Research Seeds',
      title: 'Seed bias diagnostics',
      summary: 'Bias diagnosis is an audit signal only. visualStatus and accepted evidence matrix remain the readiness source of truth.',
      meta: data.source || 'seed-bias-diagnostics-surface',
      actions,
    })}
    <div class="modern-metric-grid">
      ${renderMetricCell('Bias verdict', data.verdict || 'unknown', data.verdict === 'DATA_LIMITED_BIAS' ? 'blocked' : data.verdict === 'LIKELY_REAL_BOTTLENECK' ? 'complete' : 'pending')}
      ${renderMetricCell('Entropy', String(metrics.classDiversityEntropy ?? '--'), 'info')}
      ${renderMetricCell('Provider sensitivity', String(metrics.providerSensitivityScore ?? '--'), 'pending')}
      ${renderMetricCell('Evidence scarcity', String(metrics.evidenceScarcityIndex ?? '--'), 'blocked')}
    </div>
    <div class="modern-metric-grid">
      ${renderMetricCell('Backfill queue', `${queue.queued || 0} queued`, 'pending')}
      ${renderMetricCell('Raw evidence', String(data.rawEvidenceCount ?? 0), 'info')}
      ${renderMetricCell('Accepted evidence', String(data.acceptedEvidenceCount ?? 0), (data.acceptedEvidenceCount || 0) > 0 ? 'complete' : 'blocked')}
      ${renderMetricCell('Promotion evidence', String(data.acceptedPromotionEvidenceCount ?? 0), (data.acceptedPromotionEvidenceCount || 0) > 0 ? 'complete' : 'blocked')}
      ${renderMetricCell('Gate blocked', String(gate.blockedCount ?? 0), (gate.blockedCount || 0) > 0 ? 'blocked' : 'complete')}
    </div>
    <div class="modern-detail-grid two">
      <section class="modern-detail-section">
        <div class="modern-surface-eyebrow">Class Distribution</div>
        ${renderClassDistribution(data.classDistribution || {})}
      </section>
      <section class="modern-detail-section">
        <div class="modern-surface-eyebrow">Coverage Gaps</div>
        ${renderKeyValue('Underrepresented', under)}
        ${renderKeyValue('Overrepresented', over)}
        ${renderKeyValue('Adapter proposals', String(data.adapterProposalCount || 0))}
        ${renderKeyValue('Negative control', data.negativeControlSurvivalStatus || 'unknown')}
        ${renderKeyValue('Negative scope', data.negativeControlScope || 'unknown')}
        ${renderKeyValue('Holdout', data.holdoutConfirmationStatus || 'unknown')}
        ${renderKeyValue('Selected child', selectedChild.bottleneckNode || 'none')}
        ${renderKeyValue('Block type', data.blockType || 'none')}
        ${renderKeyValue('Route mismatch', data.routeMismatchDetected ? 'yes' : 'no')}
        ${renderKeyValue('Track A', data.trackStatus?.mechanismValidationTrack || 'none')}
        ${renderKeyValue('Track B', data.trackStatus?.issuerBridgeTrack || 'none')}
        ${renderKeyValue('Track A accepted', String(data.acceptedEvidenceCountByTrack?.mechanismValidationTrack ?? 0))}
        ${renderKeyValue('Track B accepted', String(data.acceptedEvidenceCountByTrack?.issuerBridgeTrack ?? 0))}
        ${renderKeyValue('Provider gaps', (data.providerGapRequired || []).join(', ') || 'none')}
        ${renderKeyValue('Affected issuers', (data.affectedIssuers || []).slice(0, 6).join(', ') || 'none')}
        ${renderKeyValue('Company IR', companyIrStatus.inspectedDocumentCount === undefined ? 'not run' : `${companyIrStatus.inspectedDocumentCount} docs / ${companyIrStatus.acceptedCandidateCount || 0} candidates`)}
        ${renderKeyValue('Issuer coverage skew', data.issuerCoverageSkew ? 'yes' : 'no')}
        ${renderKeyValue('Missing issuer docs', (data.missingIssuerDocuments || []).slice(0, 5).join(', ') || 'none')}
        ${renderKeyValue('Proximity matches', String(data.proximityMatchCount || 0))}
        ${renderKeyValue('Positive candidate', data.positivePathCandidateSeed?.bottleneckNode || 'none')}
        ${renderKeyValue('Issuer roles', issuerRoles)}
        ${renderKeyValue('Provider gap links', String(providerGapLinks.length))}
        ${renderKeyValue('Report blocker', data.finalInvestmentReportReadinessBlocker || 'none')}
      </section>
    </div>
    <section class="modern-detail-section">
      <div class="modern-surface-eyebrow">Recommended Backfill Tasks</div>
      ${renderRecommendedBackfillTasks(data.recommendedBackfillTasks || [])}
    </section>
    ${(data.warnings || []).length ? `
      <section class="modern-detail-section">
        <div class="modern-surface-eyebrow">Bias Warnings</div>
        ${listItems((data.warnings || []).map((item) => `${item.code}: ${item.message}`), 'No warnings')}
      </section>
    ` : ''}
  `;
}

function renderRepairLoopStatus(data = {}) {
  lastRepairLoop = data;
  const actions = `
    <button type="button" class="modern-btn" data-seed-repair-refresh>Refresh</button>
    <button type="button" class="modern-btn" data-seed-repair-audit>Audit</button>
  `;
  if (!data.available) {
    return `
      ${renderSurfaceHeader({
        eyebrow: 'Research Seeds',
        title: 'Autonomous repair loop',
        summary: 'No repair-loop artifact has been created yet. Daemon mode should run plan-only and surface the next operator action here.',
        meta: data.source || 'autonomous-research-repair-loop-surface',
        actions,
      })}
      <div class="modern-empty">No autonomous repair-loop artifact available.</div>
    `;
  }
  return `
    ${renderSurfaceHeader({
      eyebrow: 'Research Seeds',
      title: 'Autonomous repair loop',
      summary: 'Plan-mode automation selects the next safe action. Raw evidence and provider payloads remain in the audit drawer only.',
      meta: data.mode || 'plan',
      actions,
    })}
    <div class="modern-metric-grid">
      ${renderMetricCell('Current blocker', data.currentBlocker || 'unknown', data.currentBlocker === 'provider_blocked' ? 'blocked' : 'pending')}
      ${renderMetricCell('Selected action', data.selectedAction || 'operator_review_required', data.selectedAction === 'operator_review_required' ? 'blocked' : 'info')}
      ${renderMetricCell('visualStatus', data.visualStatus || 'pending', data.reportCandidateAllowed ? 'complete' : 'pending')}
      ${renderMetricCell('Stop reason', data.stopReason || 'unknown', /required|blocked|failed/i.test(data.stopReason || '') ? 'blocked' : 'info')}
    </div>
    <div class="modern-metric-grid">
      ${renderMetricCell('Raw evidence', String(data.rawEvidenceCount || 0), 'info')}
      ${renderMetricCell('Accepted evidence', String(data.acceptedEvidenceCount || 0), (data.acceptedEvidenceCount || 0) > 0 ? 'complete' : 'blocked')}
      ${renderMetricCell('Promotion evidence', String(data.acceptedPromotionEvidenceCount || 0), (data.acceptedPromotionEvidenceCount || 0) > 0 ? 'complete' : 'blocked')}
      ${renderMetricCell('Report gate', data.reportCandidateAllowed ? 'allowed' : 'blocked', data.reportCandidateAllowed ? 'complete' : 'blocked')}
    </div>
    <div class="modern-detail-grid two">
      <section class="modern-detail-section">
        <div class="modern-surface-eyebrow">Track State</div>
        ${renderKeyValue('Track A', data.trackAStatus || 'none')}
        ${renderKeyValue('Track A mechanism', data.trackAMechanismValidationStatus || 'unknown')}
        ${renderKeyValue('Track A accepted classes', (data.trackAAcceptedEvidenceClasses || []).join(', ') || 'none')}
        ${renderKeyValue('Track A source groups', (data.trackASourceGroupsUsed || []).join(', ') || 'none')}
        ${renderKeyValue('Track A source families', (data.trackASourceFamiliesUsed || []).join(', ') || 'none')}
        ${renderKeyValue('Track A bottleneck terms', (data.trackAMatchedBottleneckTerms || []).slice(0, 5).join(', ') || 'none')}
        ${renderKeyValue('Track A operating terms', (data.trackAMatchedOperatingTerms || []).slice(0, 5).join(', ') || 'none')}
        ${renderKeyValue('Track B', data.trackBStatus || 'none')}
        ${renderKeyValue('Track B issuer bridge', data.trackBIssuerBridgeStatus || 'unknown')}
        ${renderKeyValue('Track B accepted issuer', String(data.trackBAcceptedIssuerEvidenceCount || 0))}
        ${renderKeyValue('Track B promotion evidence', String(data.trackBAcceptedPromotionEvidenceCount || 0))}
        ${renderKeyValue('Track B issuers', (data.trackBIssuerCandidates || []).slice(0, 5).join(', ') || 'none')}
        ${renderKeyValue('Track B roles', (data.trackBIssuerRoleClasses || []).slice(0, 5).join(', ') || 'none')}
        ${renderKeyValue('Track B exposure terms', (data.trackBMatchedExposureTerms || []).slice(0, 5).join(', ') || 'none')}
        ${renderKeyValue('Track B operating terms', (data.trackBMatchedOperatingTerms || []).slice(0, 5).join(', ') || 'none')}
        ${renderKeyValue('Track B negative', data.trackBNegativeControlStatus || data.negativeControlStatus || 'unknown')}
        ${renderKeyValue('Track B negative scope', data.trackBNegativeControlScope || 'unknown')}
        ${renderKeyValue('Checked issuers', String(data.trackBCheckedIssuerCount || 0))}
        ${renderKeyValue('Checked source groups', String(data.trackBCheckedSourceGroupCount || 0))}
        ${renderKeyValue('Checked query families', String(data.trackBCheckedQueryFamilyCount || 0))}
        ${renderKeyValue('Direct invalidator', data.trackBDirectInvalidatorFound ? 'yes' : 'no')}
        ${renderKeyValue('Track B holdout', data.trackBHoldoutStatus || data.holdoutStatus || 'unknown')}
        ${renderKeyValue('Holdout confirmed', data.trackBHoldoutConfirmed ? 'yes' : 'no')}
        ${renderKeyValue('Holdout evidence', String(data.trackBAcceptedHoldoutEvidenceCount || 0))}
        ${renderKeyValue('Holdout source groups', (data.trackBHoldoutSourceGroups || []).slice(0, 5).join(', ') || 'none')}
        ${renderKeyValue('Holdout exposure terms', (data.trackBHoldoutMatchedExposureTerms || []).slice(0, 5).join(', ') || 'none')}
        ${renderKeyValue('Holdout demand terms', (data.trackBHoldoutMatchedDemandTerms || []).slice(0, 5).join(', ') || 'none')}
        ${renderKeyValue('Holdout contradiction', data.trackBHoldoutContradictionFound ? 'yes' : 'no')}
        ${renderKeyValue('Negative control', data.negativeControlStatus || 'unknown')}
        ${renderKeyValue('Holdout', data.holdoutStatus || 'unknown')}
        ${renderKeyValue('Issuer bridge', data.issuerBridgeStatus || 'unknown')}
        ${renderKeyValue('Market validation', data.marketValidationStatus || 'unknown')}
        ${renderKeyValue('Market benchmark', data.marketValidationBenchmarkUsed || 'none')}
        ${renderKeyValue('Market control', data.marketValidationControlUsed ? 'yes' : 'no')}
        ${renderKeyValue('Market sample', String(data.marketValidationSampleSize || 0))}
        ${renderKeyValue('Market direction', data.marketValidationDirection || 'unknown')}
        ${renderKeyValue('Market caveats', (data.marketValidationCaveats || []).slice(0, 4).join(', ') || 'none')}
        ${renderKeyValue('Market warnings', (data.marketValidationWarnings || []).slice(0, 4).join(', ') || 'none')}
        ${renderKeyValue('Report candidate diagnostic', data.reportCandidateAllowedDiagnostic ? 'true' : 'false')}
        ${renderKeyValue('Contract closure', data.evidenceContractClosureStatus || 'not run')}
        ${renderKeyValue('Closure caveats', (data.closureCaveats || []).slice(0, 4).join(', ') || 'none')}
        ${renderKeyValue('Contradiction warnings', String((data.contradictionWarnings || []).length || 0))}
        ${renderKeyValue('Report subject dry-run', data.reportSubjectDryRun?.subjectLabel || 'none')}
        ${renderKeyValue('Thesis memo dry-run', data.thesisValidationMemoDryRunStatus || 'not run')}
        ${renderKeyValue('Memo type', data.memoType || 'none')}
        ${renderKeyValue('Memo decision use', data.memoDecisionUse || 'none')}
        ${renderKeyValue('Not decision-ready', data.notDecisionReady === true ? 'yes' : 'no')}
        ${renderKeyValue('Investment memo ready', data.investmentMemoReady === true ? 'yes' : 'no')}
        ${renderKeyValue('Decision ready', data.decisionReady === true ? 'yes' : 'no')}
        ${renderKeyValue('Portfolio action', data.portfolioActionAllowed === true ? 'allowed' : 'not allowed')}
        ${renderKeyValue('Memo path', data.clientMemoPath || 'none')}
        ${renderKeyValue('Audit appendix', data.auditAppendixPath || 'none')}
        ${renderKeyValue('Memo caveats', (data.thesisValidationMemoCaveats || []).slice(0, 4).join(', ') || 'none')}
        ${renderKeyValue('Memo blockers', (data.thesisValidationMemoRemainingBlockers || []).slice(0, 4).join(', ') || 'none')}
        ${renderKeyValue('Valuation bridge dry-run', data.valuationExpectationBridgeDryRunStatus || 'not run')}
        ${renderKeyValue('Valuation bridge', data.valuationBridgeStatus || 'unknown')}
        ${renderKeyValue('Expectation bridge', data.expectationBridgeStatus || 'unknown')}
        ${renderKeyValue('Issuer valuation rows', String((data.issuerValuationBridgeTable || []).length || 0))}
        ${renderKeyValue('Valuation cache rows', String(data.localValuationCacheRowCount || 0))}
        ${renderKeyValue('Missing cache issuers', (data.localValuationCacheMissingIssuers || []).slice(0, 5).join(', ') || 'none')}
        ${renderKeyValue('Valuation coverage', (data.valuationMetricCoverage || []).map((row) => `${row.issuer}:${row.coverage}`).slice(0, 5).join(', ') || 'none')}
        ${renderKeyValue('Consensus coverage', (data.consensusMetricCoverage || []).map((row) => `${row.issuer}:${row.coverage}`).slice(0, 5).join(', ') || 'none')}
        ${renderKeyValue('Peer coverage', (data.peerMetricCoverage || []).map((row) => `${row.issuer}:${row.coverage}`).slice(0, 5).join(', ') || 'none')}
        ${renderKeyValue('Priced-in risk', data.pricedInRisk ? 'yes' : 'no')}
        ${renderKeyValue('Missing valuation fields', (data.missingValuationFields || []).slice(0, 6).join(', ') || 'none')}
        ${renderKeyValue('Market regime', data.marketValidationRegimeStatus || 'unknown')}
        ${renderKeyValue('Regime consistency', data.regimeConsistencyScore == null ? 'unknown' : String(data.regimeConsistencyScore))}
        ${renderKeyValue('Regime coverage', data.regimeCoverageScore == null ? 'unknown' : String(data.regimeCoverageScore))}
        ${renderKeyValue('Event count by regime', data.eventCountByRegime ? JSON.stringify(data.eventCountByRegime) : 'none')}
        ${renderKeyValue('Direction support', data.directionSupportByRegime ? JSON.stringify(data.directionSupportByRegime) : 'none')}
        ${renderKeyValue('Unknown regime share', data.unknownRegimeShare == null ? 'unknown' : String(data.unknownRegimeShare))}
        ${renderKeyValue('Extreme t-stat warning', data.extremeTstatWarning ? 'yes' : 'no')}
        ${renderKeyValue('T-stat sanity', data.tstatSanityStatus || 'unknown')}
        ${renderKeyValue('Market research use', data.marketValidationResearchUseAllowed ? 'allowed' : 'not allowed')}
        ${renderKeyValue('Market investment use', data.marketValidationInvestmentUseAllowed ? 'diagnostic allowed' : 'not allowed')}
        ${renderKeyValue('Market decision use', data.marketValidationDecisionUseAllowed ? 'allowed' : 'not allowed')}
        ${renderKeyValue('Investment memo diagnostic', data.investmentMemoReadinessDiagnostic?.status || 'not run')}
        ${renderKeyValue('Hardcoding audit', data.hardcodingAuditStatus || 'not run')}
        ${renderKeyValue('Final report dry-run', data.finalInvestmentReportDryRunStatus || 'not run')}
        ${renderKeyValue('Final memo type', data.memoType || 'none')}
        ${renderKeyValue('Final decision use', data.decisionUse || data.memoDecisionUse || 'none')}
        ${renderKeyValue('Validator', data.validatorStatus || 'not run')}
        ${renderKeyValue('Final stop', data.finalStopReason || 'none')}
        ${renderKeyValue('Final report path', data.finalInvestmentReportDryRunPath || data.clientMemoPath || 'none')}
        ${renderKeyValue('Final audit appendix', data.finalInvestmentReportAuditAppendixPath || data.auditAppendixPath || 'none')}
        ${renderKeyValue('Remaining caveats', (data.remainingCaveats || []).slice(0, 5).join(', ') || 'none')}
        ${renderKeyValue('Human memo review', data.readyForHumanInvestmentMemoReview ? 'diagnostic only' : 'not ready')}
        ${renderKeyValue('Valuation path', data.valuationBridgePath || 'none')}
        ${renderKeyValue('Regime support path', data.marketRegimeSupportPath || 'none')}
      </section>
      <section class="modern-detail-section">
        <div class="modern-surface-eyebrow">Next Action</div>
        ${renderKeyValue('Reason', data.actionReason || 'none')}
        ${renderKeyValue('Next', typeof data.nextRecommendedAction === 'string' ? data.nextRecommendedAction : JSON.stringify(data.nextRecommendedAction || {}))}
        ${renderKeyValue('Track A next', data.trackANextRecommendedAction || 'none')}
        ${renderKeyValue('Track B next', data.trackBNextRecommendedAction || 'none')}
        ${renderKeyValue('Provider blocked', data.providerBlockedStatus ? 'yes' : 'no')}
        ${renderKeyValue('Provider gaps', (data.providerGapRequired || []).slice(0, 6).join(', ') || 'none')}
        ${renderKeyValue('Operator review', data.operatorReviewRequired ? 'required' : 'not required')}
      </section>
    </div>
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

function bindSeedBiasDiagnostics(root) {
  root.querySelector('[data-seed-bias-refresh]')?.addEventListener('click', () => renderSeedBiasDiagnosticsSurface());
  root.querySelector('[data-seed-bias-audit]')?.addEventListener('click', () => {
    openAuditDrawer('Seed bias diagnostics audit', lastBiasDiagnostics?.audit || lastBiasDiagnostics || {});
  });
}

function bindRepairLoopStatus(root) {
  root.querySelector('[data-seed-repair-refresh]')?.addEventListener('click', () => renderRepairLoopStatusSurface());
  root.querySelector('[data-seed-repair-audit]')?.addEventListener('click', () => {
    openAuditDrawer('Autonomous repair loop audit', lastRepairLoop?.auditDrawer || lastRepairLoop || {});
  });
}

function renderAutomationConsole(data = {}) {
  lastAutomationConsole = data;
  const activation = data.sourceProviderActivation || {};
  const activationCounts = activation.counts || {};
  const fixtureProbes = data.providerFixtureProbes || {};
  const collectorRegistry = data.providerCollectorRegistry || {};
  const stagedLive = data.stagedProviderLiveExecution || {};
  const providerQuality = data.providerQualityFeedback || {};
  const sourceQuality = data.sourceQualityScore || {};
  const sourceDiversity = data.sourceDiversityFeedback || {};
  const remediation = data.automationFeedbackRemediation || {};
  const codeRepair = data.automationFeedbackCodeRepair || {};
  const codeRepairDelta = codeRepair.evidenceDeltaAfterMerge || {};
  const codeRepairDeltaCounts = codeRepairDelta.delta || {};
  const reportCandidateStaging = data.reportCandidateStaging || {};
  const queue = data.backfillQueue || {};
  const repair = data.repairLoop || {};
  const readiness = data.readiness || {};
  const runtime = data.runtimeStatus || {};
  const boundaries = data.mutationBoundary || {};
  const approval = data.approvalWorkflow || {};
  const actions = `
    <button type="button" class="modern-btn" data-seed-automation-refresh>Refresh</button>
    <button type="button" class="modern-btn" data-seed-automation-audit>Audit</button>
  `;
  return `
    ${renderSurfaceHeader({
      eyebrow: 'Research OS',
      title: 'Automation console',
      summary: 'Shows daemon/runtime, source-provider lifecycle, backfill queue, evidence gate, and operator-required actions. Raw payloads stay in audit.',
      meta: data.source || 'automation-console-surface',
      actions,
    })}
    <div class="modern-metric-grid">
      ${renderMetricCell('Runtime', runtime.staleDaemon ? 'stale' : 'observed', runtime.staleDaemon ? 'blocked' : 'complete')}
      ${renderMetricCell('Provider lifecycle', `${activationCounts.total || 0} candidates`, 'info')}
      ${renderMetricCell('Backfill queue', `${queue.taskCount || 0} tasks`, 'pending')}
      ${renderMetricCell('visualStatus', readiness.visualStatus || repair.visualStatus || 'pending', readiness.investmentMemoReady ? 'complete' : 'pending')}
    </div>
    <div class="modern-metric-grid">
      ${renderMetricCell('Raw evidence', String(data.evidenceState?.rawEvidenceCount || 0), 'info')}
      ${renderMetricCell('Accepted evidence', String(data.evidenceState?.acceptedEvidenceCount || 0), (data.evidenceState?.acceptedEvidenceCount || 0) > 0 ? 'complete' : 'blocked')}
      ${renderMetricCell('Promotion evidence', String(data.evidenceState?.acceptedPromotionEvidenceCount || 0), (data.evidenceState?.acceptedPromotionEvidenceCount || 0) > 0 ? 'complete' : 'blocked')}
      ${renderMetricCell('Report candidate staging', reportCandidateStaging.stageCount ? 'staged review' : reportCandidateStaging.stagingStatus || 'none', reportCandidateStaging.stageCount ? 'pending' : 'blocked')}
    </div>
    <div class="modern-metric-grid">
      ${renderMetricCell('Provider accepted rate', `${Math.round(Number(providerQuality.acceptedRate || 0) * 1000) / 10}%`, Number(providerQuality.acceptedRate || 0) > 0 ? 'complete' : 'blocked')}
      ${renderMetricCell('Repeated failures', String(providerQuality.repeatedFailureProviderCount || 0), (providerQuality.repeatedFailureProviderCount || 0) > 0 ? 'blocked' : 'complete')}
      ${renderMetricCell('Collector requirements', String(providerQuality.collectorRequirementCount || 0), (providerQuality.collectorRequirementCount || 0) > 0 ? 'pending' : 'complete')}
      ${renderMetricCell('Source entropy', String(sourceDiversity.sourceBucketDistribution?.entropy ?? '--'), 'info')}
    </div>
    <div class="modern-metric-grid">
      ${renderMetricCell('Source quality', `${Math.round(Number(sourceQuality.averageOverallEvidenceQualityScore || 0) * 100)}%`, Number(sourceQuality.averageOverallEvidenceQualityScore || 0) >= 0.5 ? 'complete' : 'pending')}
      ${renderMetricCell('Extraction quality', `${Math.round(Number(sourceQuality.averageExtractionQualityScore || 0) * 100)}%`, Number(sourceQuality.averageExtractionQualityScore || 0) >= 0.5 ? 'complete' : 'pending')}
      ${renderMetricCell('Route mismatch', String(sourceQuality.routeMismatchCount || 0), (sourceQuality.routeMismatchCount || 0) ? 'blocked' : 'complete')}
      ${renderMetricCell('Terminal source blockers', String(sourceQuality.terminalBlockerCount || 0), (sourceQuality.terminalBlockerCount || 0) ? 'blocked' : 'complete')}
    </div>
    <div class="modern-metric-grid">
      ${renderMetricCell('Next remediation', remediation.nextSafeAction || 'none', remediation.nextSafeAction ? 'pending' : 'complete')}
      ${renderMetricCell('Fixture tasks', String(remediation.fixtureRequirementCount || 0), (remediation.fixtureRequirementCount || 0) > 0 ? 'pending' : 'complete')}
      ${renderMetricCell('Targeted backfills', String(remediation.targetedBackfillTaskCount || 0), (remediation.targetedBackfillTaskCount || 0) > 0 ? 'pending' : 'complete')}
      ${renderMetricCell('Quota actions', String(remediation.sourceBucketActionCount || 0), (remediation.sourceBucketActionCount || 0) > 0 ? 'pending' : 'complete')}
    </div>
    <div class="modern-metric-grid">
      ${renderMetricCell('Codex code repair', codeRepair.mode || 'not planned', codeRepair.executedCount ? 'pending' : 'info')}
      ${renderMetricCell('Repair requests', String(codeRepair.requestCount || 0), (codeRepair.requestCount || 0) > 0 ? 'pending' : 'complete')}
      ${renderMetricCell('Repair executed', String(codeRepair.executedCount || 0), (codeRepair.executedCount || 0) > 0 ? 'pending' : 'info')}
      ${renderMetricCell('Repair skipped', String(codeRepair.skippedRequestCount || 0), (codeRepair.skippedRequestCount || 0) > 0 ? 'pending' : 'complete')}
      ${renderMetricCell('Parallel workers', codeRepair.parallel ? String(codeRepair.parallelWorkers || 0) : 'off', codeRepair.parallel ? 'pending' : 'info')}
      ${renderMetricCell('Patches applied', String((codeRepair.patchesApplied || []).length || 0), (codeRepair.patchesApplied || []).length ? 'pending' : 'info')}
      ${renderMetricCell('Patches rolled back', String((codeRepair.patchesRolledBack || []).length || 0), (codeRepair.patchesRolledBack || []).length ? 'blocked' : 'complete')}
      ${renderMetricCell('Repair effect', codeRepairDelta.effectStatus || 'not checked', codeRepairDelta.effectStatus === 'effective' ? 'complete' : (codeRepairDelta.effectStatus ? 'pending' : 'info'))}
      ${renderMetricCell('Repair status', codeRepair.ok ? 'ok' : (codeRepair.available ? 'needs review' : 'none'), codeRepair.ok ? 'complete' : 'pending')}
    </div>
    <div class="modern-detail-grid two">
      <section class="modern-detail-section">
        <div class="modern-surface-eyebrow">Source / Provider Activation</div>
        ${renderKeyValue('Discovered / total', String(activationCounts.total || 0))}
        ${renderKeyValue('Staged', String(activationCounts.staged || 0))}
        ${renderKeyValue('Active limited', String(activationCounts.activeLimited || 0))}
        ${renderKeyValue('Quarantined', String(activationCounts.quarantined || 0))}
        ${renderKeyValue('Needs credentials', String(activationCounts.needsCredentials || 0))}
        ${renderKeyValue('Needs fixture', String(activationCounts.needsFixture || 0))}
        ${renderKeyValue('Provider gap proposals', String(activationCounts.providerGapProposalRequired || 0))}
        ${renderKeyValue('Fixture probes verified', String(fixtureProbes.verifiedCount || 0))}
        ${renderKeyValue('Fixture probes missing', String(fixtureProbes.missingCount || 0))}
        ${renderKeyValue('Bounded collectors', `${collectorRegistry.collectorCount || 0} collectors / ${collectorRegistry.providerCount || 0} providers`)}
        ${renderKeyValue('Collector registry', collectorRegistry.ok ? 'ok' : 'needs attention')}
        ${renderKeyValue('Fixture declared', String(activationCounts.byFixtureStatus?.fixture_declared || 0))}
        ${renderKeyValue('Parser schemas', String(activationCounts.byParserStatus?.schema_declared || 0))}
        ${renderKeyValue('Healthchecks', String(activationCounts.byHealthcheckStatus?.declared || 0))}
        ${renderKeyValue('Live provider targets', String(stagedLive.targetCount || 0))}
        ${renderKeyValue('Live accepted', `${stagedLive.acceptedEvidenceCount || 0} / ${stagedLive.rawEvidenceCount || 0}`)}
        ${renderKeyValue('Provider accepted rate', `${Math.round(Number(providerQuality.acceptedRate || 0) * 1000) / 10}%`)}
        ${renderKeyValue('Repeated failure providers', String(providerQuality.repeatedFailureProviderCount || 0))}
        ${renderKeyValue('Cooldown / quarantine', String(providerQuality.cooldownOrQuarantineCount || 0))}
        ${renderKeyValue('Quality next action', providerQuality.recommendedRemediationAction || 'none')}
        ${renderKeyValue('Source quality records', String(sourceQuality.recordCount || 0))}
        ${renderKeyValue('Source quality score', `${Math.round(Number(sourceQuality.averageOverallEvidenceQualityScore || 0) * 100)}%`)}
        ${renderKeyValue('Extraction weak', String(sourceQuality.extractionWeakCount || 0))}
        ${renderKeyValue('Official generic', String(sourceQuality.officialButGenericCount || 0))}
        ${renderKeyValue('Route mismatch', String(sourceQuality.routeMismatchCount || 0))}
        ${renderKeyValue('Materialized next action', remediation.nextSafeAction || 'none')}
        ${renderKeyValue('Provider fixture tasks', String(remediation.fixtureRequirementCount || 0))}
        ${renderKeyValue('Provider gap proposals', String(remediation.providerGapProposalCount || 0))}
        ${renderKeyValue('Quarantine recommendations', String(remediation.quarantineRecommendationCount || 0))}
        ${renderKeyValue('Codex repair mode', codeRepair.mode || 'none')}
        ${renderKeyValue('Codex repair requests', String(codeRepair.requestCount || 0))}
        ${renderKeyValue('Codex repair executed', String(codeRepair.executedCount || 0))}
        ${renderKeyValue('Codex repair skipped', String(codeRepair.skippedRequestCount || 0))}
        ${renderKeyValue('Codex repair parallel workers', codeRepair.parallel ? String(codeRepair.parallelWorkers || 0) : 'off')}
        ${renderKeyValue('Codex repair isolation', codeRepair.isolation || 'none')}
        ${renderKeyValue('Codex repair merge conflicts', String((codeRepair.mergeConflicts || []).length || 0))}
        ${renderKeyValue('Codex repair patches applied', String((codeRepair.patchesApplied || []).length || 0))}
        ${renderKeyValue('Codex repair patches rejected', String((codeRepair.patchesRejected || []).length || 0))}
        ${renderKeyValue('Codex repair patches rolled back', String((codeRepair.patchesRolledBack || []).length || 0))}
        ${renderKeyValue('Codex repair effect', codeRepairDelta.effectStatus || 'not checked')}
        ${renderKeyValue('Codex accepted delta', String(codeRepairDeltaCounts.acceptedEvidenceDelta || 0))}
        ${renderKeyValue('Codex promotion delta', String(codeRepairDeltaCounts.acceptedPromotionEvidenceDelta || 0))}
      </section>
      <section class="modern-detail-section">
        <div class="modern-surface-eyebrow">Backfill / Gate</div>
        ${renderKeyValue('Queued', String(queue.queued || 0))}
        ${renderKeyValue('Needs review', String(queue.needsOperatorReview || 0))}
        ${renderKeyValue('Provider gap required', String(queue.providerGapProposalRequired || 0))}
        ${renderKeyValue('Local market validation', String(queue.queuedLocalMarketValidation || 0))}
        ${renderKeyValue('Repair action', repair.selectedAction || 'none')}
        ${renderKeyValue('Repair blocker', repair.currentBlocker || 'none')}
        ${renderKeyValue('Negative control', repair.negativeControlStatus || 'unknown')}
        ${renderKeyValue('Holdout', repair.holdoutStatus || 'unknown')}
        ${renderKeyValue('Issuer bridge', repair.issuerBridgeStatus || 'unknown')}
        ${renderKeyValue('Market validation', repair.marketValidationStatus || 'unknown')}
        ${renderKeyValue('Valuation bridge', readiness.valuationBridgeStatus || 'unknown')}
        ${renderKeyValue('Expectation bridge', readiness.expectationBridgeStatus || 'unknown')}
        ${renderKeyValue('Missing fundamentals', String((readiness.missingIssuerFundamentals || []).length))}
        ${renderKeyValue('Final blocker', readiness.finalBlocker || 'none')}
        ${renderKeyValue('Live provider next', stagedLive.nextActionHint || 'none')}
        ${renderKeyValue('Diversity next', sourceDiversity.recommendedNextAction || 'none')}
        ${renderKeyValue('Targeted backfill tasks', String(remediation.targetedBackfillTaskCount || 0))}
        ${renderKeyValue('Source bucket actions', String(remediation.sourceBucketActionCount || 0))}
        ${renderKeyValue('Report candidate stage', reportCandidateStaging.stagingStatus || 'not_evaluated')}
        ${renderKeyValue('Staged candidates', String(reportCandidateStaging.stageCount || 0))}
        ${renderKeyValue('Candidate write allowed', reportCandidateStaging.reportCandidateWriteAllowed ? 'true' : 'false')}
        ${renderKeyValue('Auto promotion allowed', reportCandidateStaging.automaticPromotionAllowed ? 'true' : 'false')}
        ${renderKeyValue('Portfolio action', readiness.portfolioActionAllowed ? 'allowed' : 'blocked')}
      </section>
    </div>
    <section class="modern-detail-section">
      <div class="modern-surface-eyebrow">Quality Feedback</div>
      ${renderKeyValue('Failure mix', JSON.stringify(providerQuality.failureClassificationCounts || {}))}
      ${renderKeyValue('Source quality failure mix', JSON.stringify(sourceQuality.failureReasonCounts || {}))}
      ${renderKeyValue('Remediation mix', JSON.stringify(providerQuality.remediationCounts || {}))}
      ${renderKeyValue('Underrepresented classes', (sourceDiversity.underrepresentedEvidenceClasses || []).map((item) => item.evidenceClass || item).slice(0, 8).join(', ') || 'none')}
      ${renderKeyValue('Source quota warnings', String((sourceDiversity.sourceBucketQuotaWarnings || []).length))}
      ${renderKeyValue('Report cooldowns', String((sourceDiversity.reportCooldowns || []).length))}
      ${renderKeyValue('Next safe actions', (remediation.nextSafeActions || []).map((item) => `${item.action}:${item.count}`).slice(0, 6).join(', ') || 'none')}
    </section>
    <section class="modern-detail-section">
      <div class="modern-surface-eyebrow">Operator Required Actions</div>
      ${renderKeyValue('Review actions', String(approval.actionCount || 0))}
      ${listItems(data.operatorRequiredActions || [], 'No operator action required')}
    </section>
    <section class="modern-detail-section">
      <div class="modern-surface-eyebrow">Mutation Boundary</div>
      ${renderClosureMatrix(Object.entries(boundaries).map(([key, value]) => ({
        evidenceClass: key,
        state: String(value || 0),
        tier: value ? 'blocked' : 'complete',
        closureReason: value ? 'write occurred under bounded policy' : 'no write',
        nextAction: value ? 'audit mutation boundary' : 'none',
      })))}
    </section>
  `;
}

function bindAutomationConsole(root) {
  root.querySelector('[data-seed-automation-refresh]')?.addEventListener('click', () => renderAutomationConsoleSurface());
  root.querySelector('[data-seed-automation-audit]')?.addEventListener('click', () => {
    openAuditDrawer('Automation console audit', lastAutomationConsole?.audit || lastAutomationConsole || {});
  });
}

export async function renderSeedBiasDiagnosticsSurface() {
  ensureModernSurfaceStylesheet();
  const root = ensureSeedBiasRoot();
  if (!root) return;
  root.innerHTML = `
    ${renderSurfaceHeader({
      eyebrow: 'Research Seeds',
      title: 'Seed bias diagnostics',
      summary: 'Loading bias-aware seed diagnostics...',
    })}
    <div class="modern-empty">Loading seed bias diagnostics...</div>
  `;
  try {
    const data = await fetchSeedBiasDiagnostics();
    root.innerHTML = renderSeedBiasDiagnostics(data);
    bindSeedBiasDiagnostics(root);
  } catch (error) {
    root.innerHTML = `
      ${renderSurfaceHeader({
        eyebrow: 'Research Seeds',
        title: 'Seed bias diagnostics',
        summary: 'The seed bias endpoint did not return usable data.',
      })}
      <div class="modern-error" role="alert">Failed to load seed bias diagnostics: ${escapeHtml(error?.message || error)}</div>
    `;
  }
}

export async function renderRepairLoopStatusSurface() {
  ensureModernSurfaceStylesheet();
  const root = ensureRepairLoopRoot();
  if (!root) return;
  root.innerHTML = `
    ${renderSurfaceHeader({
      eyebrow: 'Research Seeds',
      title: 'Autonomous repair loop',
      summary: 'Loading latest repair-loop artifact...',
    })}
    <div class="modern-empty">Loading autonomous repair loop...</div>
  `;
  try {
    const data = await fetchRepairLoopStatus();
    root.innerHTML = renderRepairLoopStatus(data);
    bindRepairLoopStatus(root);
  } catch (error) {
    root.innerHTML = `
      ${renderSurfaceHeader({
        eyebrow: 'Research Seeds',
        title: 'Autonomous repair loop',
        summary: 'The repair-loop endpoint did not return usable data.',
      })}
      <div class="modern-error" role="alert">Failed to load autonomous repair loop: ${escapeHtml(error?.message || error)}</div>
    `;
  }
}

export async function renderAutomationConsoleSurface() {
  ensureModernSurfaceStylesheet();
  const root = ensureAutomationConsoleRoot();
  if (!root) return;
  root.innerHTML = `
    ${renderSurfaceHeader({
      eyebrow: 'Research OS',
      title: 'Automation console',
      summary: 'Loading automation runtime state...',
    })}
    <div class="modern-empty">Loading automation console...</div>
  `;
  try {
    const data = await fetchAutomationConsole();
    root.innerHTML = renderAutomationConsole(data);
    bindAutomationConsole(root);
  } catch (error) {
    root.innerHTML = `
      ${renderSurfaceHeader({
        eyebrow: 'Research OS',
        title: 'Automation console',
        summary: 'The automation console endpoint did not return usable data.',
      })}
      <div class="modern-error" role="alert">Failed to load automation console: ${escapeHtml(error?.message || error)}</div>
    `;
  }
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
  window.loadSeedBiasDiagnostics = renderSeedBiasDiagnosticsSurface;
  window.loadAutonomousRepairLoopStatus = renderRepairLoopStatusSurface;
  window.loadResearchAutomationConsole = renderAutomationConsoleSurface;
  renderSeedReviewSurface();
  renderSeedProviderGapReview();
  renderSeedBiasDiagnosticsSurface();
  renderRepairLoopStatusSurface();
  renderAutomationConsoleSurface();
}
