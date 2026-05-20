import {
  ensureModernSurfaceStylesheet,
  escapeHtml,
  openAuditDrawer,
  renderClosureMatrix,
  renderMetricCell,
  renderSurfaceHeader,
  statusChip,
} from './surface-primitives.mjs';

const FILTERS = [
  ['', 'All'],
  ['pending', 'Pending'],
  ['running', 'Running'],
  ['blocked', 'Blocked'],
  ['review-ready', 'Review ready'],
  ['rejected', 'Rejected'],
];

let selectedStatus = '';
let lastReports = [];

function promoteBackfillRoot(root) {
  if (!root || root.closest('.modern-report-backfill-section')) return root;
  const investigateSurface = document.querySelector('.surface[data-surface="investigate"]');
  if (!investigateSurface) return root;

  const previousSubcard = root.closest('.subcard');
  const section = document.createElement('section');
  section.className = 'section-block modern-report-backfill-section';
  section.id = 'modern-report-backfill-section';

  const drawerTabs = document.querySelector('.investigate-drawers-tab-row');
  const firstDrawer = document.getElementById('investigate-trend-drawer');
  const anchor = drawerTabs || firstDrawer;
  section.appendChild(root);
  if (anchor && anchor.parentElement === investigateSurface) {
    investigateSurface.insertBefore(section, anchor);
  } else {
    investigateSurface.appendChild(section);
  }

  if (previousSubcard && previousSubcard.parentElement && previousSubcard.children.length <= 1) {
    previousSubcard.remove();
  }
  return root;
}

async function fetchClosureReports() {
  const statusQuery = selectedStatus ? `&status=${encodeURIComponent(selectedStatus)}` : '';
  const response = await fetch(`/api/reports/backfill-closure?limit=8${statusQuery}`, { cache: 'no-store' });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

function countByStatus(reports) {
  const counts = { total: reports.length, pending: 0, running: 0, blocked: 0, ready: 0 };
  for (const report of reports) {
    const status = String(report.visualStatus || report.status || '');
    if (status === 'review-ready') counts.ready += 1;
    else if (status === 'running') counts.running += 1;
    else if (status === 'pending') counts.pending += 1;
    else if (status === 'blocked' || status === 'rejected') counts.blocked += 1;
  }
  return counts;
}

function renderFilters() {
  return `
    <div class="modern-filter-row" role="tablist" aria-label="Report backfill status filter">
      ${FILTERS.map(([value, label]) => `
        <button
          type="button"
          class="chip ${selectedStatus === value ? 'active' : ''}"
          data-report-backfill-filter="${escapeHtml(value)}"
          role="tab"
          aria-selected="${selectedStatus === value ? 'true' : 'false'}"
        >${escapeHtml(label)}</button>
      `).join('')}
    </div>
  `;
}

function renderReportCard(report, index) {
  const rows = Array.isArray(report.classRows) && report.classRows.length
    ? report.classRows
    : (Array.isArray(report.openClasses) ? report.openClasses : []).map((evidenceClass) => ({
      evidenceClass,
      state: 'pending',
      providerRoute: '--',
      tier: 'missing',
      latestRun: '--',
      closureReason: report.primaryBlocker || 'missing evidence class',
      nextAction: report.nextAction || 'route targeted backfill',
    }));
  const status = report.visualStatus || report.status || 'blocked';
  const title = report.subject || report.reportId || 'report';
  const meta = [
    report.reportType || 'report',
    report.evidenceStateLabel || report.evidenceState || 'More evidence needed',
    report.lastUpdatedAt ? `updated ${report.lastUpdatedAt}` : '',
  ].filter(Boolean).join(' | ');
  const productTierLine = report.productTierLabel ? `
    <div class="modern-meta-line">
      Evidence tier ${escapeHtml(report.productTierLabel)}
      ${report.productTierRole === 'evidence_tier' ? ' | separate from investment readiness' : ''}
      ${report.productTierPrimary === false ? ' | closure status is authoritative' : ''}
    </div>
  ` : '';
  const artifactSchemaLine = report.artifactSchemaStatus && report.artifactSchemaStatus !== 'current' ? `
    <div class="modern-meta-line">
      Artifact schema ${escapeHtml(report.artifactSchemaStatus)}
      ${report.artifactSchemaWarning?.message ? ` | ${escapeHtml(report.artifactSchemaWarning.message)}` : ''}
    </div>
  ` : '';
  const reportAction = report.reportId
    ? `<button type="button" class="modern-btn" data-modern-open-report="${escapeHtml(report.reportId)}">Open report</button>`
    : '';
  const contradictions = Array.isArray(report.contradictions) ? report.contradictions : [];
  const contradictionLane = contradictions.length ? `
    <div class="modern-warning-lane" role="status" aria-label="Contradiction Warning">
      <div class="modern-meta-line"><strong>Contradiction Warning</strong></div>
      ${contradictions.slice(0, 3).map((item) => `
        <div class="modern-meta-line">
          ${statusChip(item.severity || 'warning', { title: item.code || '' })}
          <span class="modern-clamp">${escapeHtml(item.code || 'CONTRADICTION')}: ${escapeHtml(item.message || 'Readiness contradiction detected.')}</span>
        </div>
      `).join('')}
    </div>
  ` : '';
  return `
    <article class="modern-report-card" data-report-index="${index}">
      <div class="modern-report-head">
        <div>
          <div class="modern-report-title">
            <strong>${escapeHtml(title)}</strong>
            ${statusChip(status, { title: report.primaryBlocker || report.nextAction || '' })}
          </div>
          <div class="modern-meta-line">${escapeHtml(meta)}</div>
          ${productTierLine}
          ${artifactSchemaLine}
          <div class="modern-meta-line">
            Market ${escapeHtml(report.marketTier || 'missing')} | negative ${escapeHtml(report.negativeControlStatus || 'unchecked')} | blocker ${escapeHtml(report.primaryBlocker || 'not classified')}
          </div>
        </div>
        <div class="modern-report-actions">
          ${reportAction}
          <button type="button" class="modern-btn" data-modern-audit-index="${index}">Audit details</button>
        </div>
      </div>
      ${contradictionLane}
      ${renderClosureMatrix(rows)}
    </article>
  `;
}

function renderReports(data) {
  const reports = Array.isArray(data?.reports) ? data.reports : [];
  lastReports = reports;
  const counts = countByStatus(reports);
  if (!reports.length) {
    return `
      ${renderSurfaceHeader({
        eyebrow: 'Report Backfill',
        title: 'Evidence closure matrix',
        summary: 'No report closure rows match this filter.',
      })}
      ${renderFilters()}
      <div class="modern-empty">No report closure rows for this filter.</div>
    `;
  }
  return `
    ${renderSurfaceHeader({
      eyebrow: 'Report Backfill',
      title: 'Evidence closure matrix',
      summary: 'Class-level provider route, evidence tier, closure reason, and next action for each report.',
      meta: data?.source || 'report-backfill-closure',
    })}
    <div class="modern-metric-grid">
      ${renderMetricCell('Reports', String(counts.total), 'neutral')}
      ${renderMetricCell('Running', String(counts.running), 'info')}
      ${renderMetricCell('Pending', String(counts.pending), 'pending')}
      ${renderMetricCell('Blocked', String(counts.blocked), 'blocked')}
    </div>
    ${renderFilters()}
    ${reports.map(renderReportCard).join('')}
  `;
}

function bindReportBackfillEvents(root) {
  root.querySelectorAll('[data-report-backfill-filter]').forEach((button) => {
    button.addEventListener('click', () => {
      selectedStatus = button.getAttribute('data-report-backfill-filter') || '';
      renderReportBackfillClosure();
    });
  });
  root.querySelectorAll('[data-modern-audit-index]').forEach((button) => {
    button.addEventListener('click', () => {
      const index = Number(button.getAttribute('data-modern-audit-index'));
      const report = lastReports[index] || {};
      openAuditDrawer(report.subject || report.reportId || 'Report audit', {
        reportId: report.reportId,
        reportType: report.reportType,
        latestReportPath: report.latestReportPath,
        evidenceState: report.evidenceState,
        marketTier: report.marketTier,
        negativeControlStatus: report.negativeControlStatus,
        primaryBlocker: report.primaryBlocker,
        nextAction: report.nextAction,
        productTier: report.productTier,
        productTierLabel: report.productTierLabel,
        productTierRole: report.productTierRole,
        productTierPrimary: report.productTierPrimary,
        artifactSchemaStatus: report.artifactSchemaStatus,
        artifactSchemaWarning: report.artifactSchemaWarning,
        contradictions: report.contradictions || [],
        classRows: report.classRows || [],
      });
    });
  });
  root.querySelectorAll('[data-modern-open-report]').forEach((button) => {
    button.addEventListener('click', () => {
      const reportId = button.getAttribute('data-modern-open-report');
      if (reportId && typeof window.openReportDetail === 'function') {
        window.openReportDetail(reportId);
      }
    });
  });
}

export async function renderReportBackfillClosure() {
  ensureModernSurfaceStylesheet();
  const root = promoteBackfillRoot(document.getElementById('report-backfill-closure'));
  if (!root) return;
  root.classList.add('modern-report-backfill');
  root.innerHTML = `
    ${renderSurfaceHeader({
      eyebrow: 'Report Backfill',
      title: 'Evidence closure matrix',
      summary: 'Loading class-level closure state...',
    })}
    <div class="modern-empty">Loading report backfill closure...</div>
  `;
  try {
    const data = await fetchClosureReports();
    root.innerHTML = renderReports(data);
    bindReportBackfillEvents(root);
  } catch (error) {
    root.innerHTML = `
      ${renderSurfaceHeader({
        eyebrow: 'Report Backfill',
        title: 'Evidence closure matrix',
        summary: 'The closure endpoint did not return usable data.',
      })}
      <div class="modern-error" role="alert">Failed to load report closure: ${escapeHtml(error?.message || error)}</div>
    `;
  }
}

export function setReportBackfillFilter(status) {
  selectedStatus = String(status || '');
  return renderReportBackfillClosure();
}

export function installReportBackfillSurface() {
  ensureModernSurfaceStylesheet();
  window.loadReportBackfillClosure = renderReportBackfillClosure;
  window.setReportBackfillFilter = setReportBackfillFilter;
  renderReportBackfillClosure();
}
