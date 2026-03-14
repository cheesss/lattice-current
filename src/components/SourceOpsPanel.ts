import { Panel } from './Panel';
import {
  listSourceRegistrySnapshot,
  listDiscoveredSources,
  setDiscoveredSourceStatus,
  type DiscoveredSourceRecord,
  type DiscoveredSourceStatus,
  type FeedSourceOverride,
  type FeedSourceRecord,
} from '@/services/source-registry';
import {
  listInvestigationTasks,
  type SourceInvestigationTask,
} from '@/services/source-investigation-queue';
import {
  listKeywordRegistry,
  setKeywordStatus,
  type KeywordRecord,
  type KeywordStatus,
} from '@/services/keyword-registry';
import {
  listApiSourceRegistry,
  refreshApiSourceHealth,
  setApiSourceStatus,
  type ApiSourceRecord,
  type ApiSourceStatus,
} from '@/services/api-source-registry';
import { listSourceOpsEvents, type SourceOpsEvent } from '@/services/source-ops-log';
import {
  listSourceCredibilityProfiles,
  type SourceCredibilityProfile,
} from '@/services/source-credibility';
import {
  listSourceHealingSuggestions,
  setSourceHealingSuggestionStatus,
  type SourceHealingSuggestion,
  type SourceHealingSuggestionStatus,
} from '@/services/source-healing-suggestions';
import {
  listNetworkDiscoveryCaptures,
  type NetworkDiscoveryCapture,
} from '@/services/network-discovery';
import { escapeHtml } from '@/utils/sanitize';

function fmtTs(ts: number | null): string {
  if (!ts) return '-';
  const value = new Date(ts);
  if (Number.isNaN(value.getTime())) return '-';
  return value.toLocaleTimeString();
}

function fmtDateTime(ts: number | null): string {
  if (!ts) return '-';
  const value = new Date(ts);
  if (Number.isNaN(value.getTime())) return '-';
  return value.toLocaleString();
}

function clampText(value: string, max = 120): string {
  if (!value) return '';
  return value.length > max ? `${value.slice(0, max - 1)}?` : value;
}

function summarizeSourceStatus(records: FeedSourceRecord[]): {
  healthy: number;
  degraded: number;
  investigating: number;
} {
  return records.reduce(
    (acc, record) => {
      if (record.status === 'healthy') acc.healthy += 1;
      else if (record.status === 'degraded') acc.degraded += 1;
      else acc.investigating += 1;
      return acc;
    },
    { healthy: 0, degraded: 0, investigating: 0 },
  );
}

function summarizeQueue(tasks: SourceInvestigationTask[]): {
  pending: number;
  running: number;
  failed: number;
  done: number;
} {
  return tasks.reduce(
    (acc, task) => {
      if (task.status === 'pending') acc.pending += 1;
      else if (task.status === 'running') acc.running += 1;
      else if (task.status === 'failed') acc.failed += 1;
      else acc.done += 1;
      return acc;
    },
    { pending: 0, running: 0, failed: 0, done: 0 },
  );
}

function summarizeDiscovery(discovered: DiscoveredSourceRecord[]): {
  draft: number;
  approved: number;
  active: number;
  rejected: number;
} {
  return discovered.reduce(
    (acc, item) => {
      acc[item.status] += 1;
      return acc;
    },
    { draft: 0, approved: 0, active: 0, rejected: 0 },
  );
}

function summarizeKeywords(records: KeywordRecord[]): {
  draft: number;
  active: number;
  retired: number;
} {
  return records.reduce(
    (acc, record) => {
      acc[record.status] += 1;
      return acc;
    },
    { draft: 0, active: 0, retired: 0 },
  );
}

function summarizeApiSources(records: ApiSourceRecord[]): {
  draft: number;
  approved: number;
  active: number;
  rejected: number;
} {
  return records.reduce(
    (acc, record) => {
      acc[record.status] += 1;
      return acc;
    },
    { draft: 0, approved: 0, active: 0, rejected: 0 },
  );
}

function summarizeHealing(records: SourceHealingSuggestion[]): {
  draft: number;
  applied: number;
  resolved: number;
} {
  return records.reduce(
    (acc, record) => {
      if (record.status === 'draft') acc.draft += 1;
      else if (record.status === 'applied') acc.applied += 1;
      else if (record.status === 'resolved') acc.resolved += 1;
      return acc;
    },
    { draft: 0, applied: 0, resolved: 0 },
  );
}

function healingActions(status: SourceHealingSuggestionStatus): Array<{ label: string; next: SourceHealingSuggestionStatus; style?: string }> {
  if (status === 'draft') {
    return [
      { label: 'Apply', next: 'applied', style: 'primary' },
      { label: 'Reject', next: 'rejected' },
    ];
  }
  if (status === 'applied') {
    return [
      { label: 'Resolve', next: 'resolved', style: 'primary' },
      { label: 'Reject', next: 'rejected' },
    ];
  }
  if (status === 'rejected') {
    return [{ label: 'Restore', next: 'draft', style: 'primary' }];
  }
  return [];
}

function discoveryActions(status: DiscoveredSourceStatus): Array<{ label: string; next: DiscoveredSourceStatus; style?: string }> {
  if (status === 'draft') {
    return [
      { label: 'Approve', next: 'approved', style: 'primary' },
      { label: 'Reject', next: 'rejected' },
    ];
  }
  if (status === 'approved') {
    return [
      { label: 'Activate', next: 'active', style: 'primary' },
      { label: 'Reject', next: 'rejected' },
    ];
  }
  if (status === 'active') {
    return [
      { label: 'Deactivate', next: 'approved' },
      { label: 'Reject', next: 'rejected' },
    ];
  }
  return [{ label: 'Re-approve', next: 'approved', style: 'primary' }];
}

function keywordActions(status: KeywordStatus): Array<{ label: string; next: KeywordStatus; style?: string }> {
  if (status === 'draft') {
    return [
      { label: 'Activate', next: 'active', style: 'primary' },
      { label: 'Retire', next: 'retired' },
    ];
  }
  if (status === 'active') {
    return [
      { label: 'Draft', next: 'draft' },
      { label: 'Retire', next: 'retired' },
    ];
  }
  return [{ label: 'Restore', next: 'draft', style: 'primary' }];
}

function apiActions(status: ApiSourceStatus): Array<{ label: string; next: ApiSourceStatus; style?: string }> {
  if (status === 'draft') {
    return [
      { label: 'Approve', next: 'approved', style: 'primary' },
      { label: 'Reject', next: 'rejected' },
    ];
  }
  if (status === 'approved') {
    return [
      { label: 'Activate', next: 'active', style: 'primary' },
      { label: 'Reject', next: 'rejected' },
    ];
  }
  if (status === 'active') {
    return [
      { label: 'Deactivate', next: 'approved' },
      { label: 'Reject', next: 'rejected' },
    ];
  }
  return [{ label: 'Re-approve', next: 'approved', style: 'primary' }];
}

export class SourceOpsPanel extends Panel {
  private readonly onClickBound: (event: MouseEvent) => void;
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private inFlight = false;

  constructor() {
    super({
      id: 'source-ops',
      title: 'Source Ops',
      showCount: true,
      trackActivity: false,
    });

    this.onClickBound = (event: MouseEvent) => this.handleClick(event);
    this.content.addEventListener('click', this.onClickBound);
    void this.refresh();
    this.refreshTimer = setInterval(() => {
      void this.refresh();
    }, 15_000);
  }

  public async refresh(): Promise<void> {
    if (this.inFlight) return;
    this.inFlight = true;
    try {
      const [registry, tasks, discovered, keywords, apiSources, logEvents, credibility, healingSuggestions, networkCaptures] = await Promise.all([
        listSourceRegistrySnapshot(),
        listInvestigationTasks(),
        listDiscoveredSources(),
        listKeywordRegistry(),
        listApiSourceRegistry(),
        listSourceOpsEvents(24),
        listSourceCredibilityProfiles(32),
        listSourceHealingSuggestions(32),
        listNetworkDiscoveryCaptures(32),
      ]);
      this.renderSnapshot(registry.records, registry.overrides, tasks, discovered, keywords, apiSources, logEvents, credibility, healingSuggestions, networkCaptures);
    } catch (error) {
      console.warn('[source-ops] refresh failed', error);
      this.showError('Source operations state unavailable');
    } finally {
      this.inFlight = false;
    }
  }

  private renderSnapshot(
    records: FeedSourceRecord[],
    overrides: FeedSourceOverride[],
    tasks: SourceInvestigationTask[],
    discovered: DiscoveredSourceRecord[],
    keywords: KeywordRecord[],
    apiSources: ApiSourceRecord[],
    logEvents: SourceOpsEvent[],
    credibility: SourceCredibilityProfile[],
    healingSuggestions: SourceHealingSuggestion[],
    networkCaptures: NetworkDiscoveryCapture[],
  ): void {
    const health = summarizeSourceStatus(records);
    const queue = summarizeQueue(tasks);
    const discovery = summarizeDiscovery(discovered);
    const keywordSummary = summarizeKeywords(keywords);
    const apiSummary = summarizeApiSources(apiSources);
    const healingSummary = summarizeHealing(healingSuggestions);

    const degradedRows = records
      .filter(record => record.status !== 'healthy')
      .slice(0, 10);
    const queueRows = tasks
      .filter(task => task.status !== 'done')
      .slice(0, 10);
    const discoveredRows = discovered.slice(0, 12);
    const keywordRows = keywords.slice(0, 14);
    const apiRows = apiSources.slice(0, 12);
    const eventRows = logEvents.slice(0, 20);

    const totalCount = records.length + discovered.length + keywords.length + apiSources.length + credibility.length + healingSuggestions.length + networkCaptures.length;
    this.setCount(totalCount);

    const summaryHtml = `
      <div class="source-ops-summary-grid">
        <div class="source-ops-summary-card">
          <div class="source-ops-summary-title">Feed Health</div>
          <div class="source-ops-summary-row"><span>Healthy</span><strong>${health.healthy}</strong></div>
          <div class="source-ops-summary-row"><span>Degraded</span><strong>${health.degraded}</strong></div>
          <div class="source-ops-summary-row"><span>Investigating</span><strong>${health.investigating}</strong></div>
        </div>
        <div class="source-ops-summary-card">
          <div class="source-ops-summary-title">Investigation Queue</div>
          <div class="source-ops-summary-row"><span>Pending</span><strong>${queue.pending}</strong></div>
          <div class="source-ops-summary-row"><span>Running</span><strong>${queue.running}</strong></div>
          <div class="source-ops-summary-row"><span>Failed</span><strong>${queue.failed}</strong></div>
        </div>
        <div class="source-ops-summary-card">
          <div class="source-ops-summary-title">Discovered Sources</div>
          <div class="source-ops-summary-row"><span>Draft</span><strong>${discovery.draft}</strong></div>
          <div class="source-ops-summary-row"><span>Approved</span><strong>${discovery.approved}</strong></div>
          <div class="source-ops-summary-row"><span>Active</span><strong>${discovery.active}</strong></div>
        </div>
        <div class="source-ops-summary-card">
          <div class="source-ops-summary-title">Keyword Registry</div>
          <div class="source-ops-summary-row"><span>Draft</span><strong>${keywordSummary.draft}</strong></div>
          <div class="source-ops-summary-row"><span>Active</span><strong>${keywordSummary.active}</strong></div>
          <div class="source-ops-summary-row"><span>Retired</span><strong>${keywordSummary.retired}</strong></div>
        </div>
        <div class="source-ops-summary-card">
          <div class="source-ops-summary-title">API Source Registry</div>
          <div class="source-ops-summary-row"><span>Draft</span><strong>${apiSummary.draft}</strong></div>
          <div class="source-ops-summary-row"><span>Approved</span><strong>${apiSummary.approved}</strong></div>
          <div class="source-ops-summary-row"><span>Active</span><strong>${apiSummary.active}</strong></div>
        </div>
        <div class="source-ops-summary-card">
          <div class="source-ops-summary-title">Healing Suggestions</div>
          <div class="source-ops-summary-row"><span>Draft</span><strong>${healingSummary.draft}</strong></div>
          <div class="source-ops-summary-row"><span>Applied</span><strong>${healingSummary.applied}</strong></div>
          <div class="source-ops-summary-row"><span>Resolved</span><strong>${healingSummary.resolved}</strong></div>
        </div>
      </div>
      <div class="source-ops-meta">
        <span>Overrides: <strong>${overrides.length}</strong></span>
        <span>Updated: <strong>${new Date().toLocaleTimeString()}</strong></span>
      </div>
    `;

    const degradedHtml = degradedRows.length > 0
      ? degradedRows.map((row) => `
        <tr>
          <td>${escapeHtml(row.feedName)}</td>
          <td><span class="source-ops-pill ${row.status}">${row.status.toUpperCase()}</span></td>
          <td>${row.failureCount}</td>
          <td title="${escapeHtml(row.lastFailureReason || '')}">${escapeHtml(clampText(row.lastFailureReason || '-'))}</td>
          <td>${fmtTs(row.lastSuccessAt)}</td>
        </tr>
      `).join('')
      : '<tr><td colspan="5" class="source-ops-empty">No degraded feeds</td></tr>';

    const queueHtml = queueRows.length > 0
      ? queueRows.map((row) => `
        <tr>
          <td>${escapeHtml(row.feedName)}</td>
          <td><span class="source-ops-pill ${row.status}">${row.status.toUpperCase()}</span></td>
          <td>${row.attempts}</td>
          <td title="${escapeHtml(row.reason)}">${escapeHtml(clampText(row.reason, 90))}</td>
          <td>${fmtTs(row.updatedAt)}</td>
        </tr>
      `).join('')
      : '<tr><td colspan="5" class="source-ops-empty">No pending investigations</td></tr>';

    const discoveredHtml = discoveredRows.length > 0
      ? discoveredRows.map((row) => {
        const encodedId = encodeURIComponent(row.id);
        const actions = discoveryActions(row.status).map(action => `
          <button
            class="source-ops-action ${action.style || ''}"
            data-source-id="${encodedId}"
            data-source-next="${action.next}"
          >${action.label}</button>
        `).join('');
        const safeUrl = escapeHtml(row.url);
        const topicPreview = Array.isArray(row.topics) && row.topics.length > 0
          ? row.topics.slice(0, 2).map(topic => escapeHtml(clampText(topic, 44))).join(' · ')
          : '-';
        return `
          <tr>
            <td>${escapeHtml(row.feedName)}</td>
            <td>${escapeHtml(row.category)}</td>
            <td><span class="source-ops-pill ${row.status}">${row.status.toUpperCase()}</span></td>
            <td>${row.confidence}</td>
            <td><span class="source-ops-pill">${escapeHtml(row.discoveredBy || '-')}</span><div class="source-ops-subtext">${topicPreview}</div></td>
            <td><a class="source-ops-link" href="${safeUrl}" target="_blank" rel="noopener noreferrer">${escapeHtml(row.domain || row.url)}</a></td>
            <td class="source-ops-actions">${actions}</td>
          </tr>
        `;
      }).join('')
      : '<tr><td colspan="7" class="source-ops-empty">No discovered sources</td></tr>';

    const keywordHtml = keywordRows.length > 0
      ? keywordRows.map((row) => {
        const encodedId = encodeURIComponent(row.id);
        const actions = keywordActions(row.status).map(action => `
          <button
            class="source-ops-action ${action.style || ''}"
            data-keyword-id="${encodedId}"
            data-keyword-next="${action.next}"
          >${action.label}</button>
        `).join('');
        return `
          <tr>
            <td>${escapeHtml(row.term)}</td>
            <td>${escapeHtml(row.domain)}</td>
            <td><span class="source-ops-pill ${row.status}">${row.status.toUpperCase()}</span></td>
            <td>${Math.round(row.qualityScore)}</td>
            <td>${Math.round(row.confidence)}</td>
            <td>${fmtTs(row.lastSeen)}</td>
            <td class="source-ops-actions">${actions}</td>
          </tr>
        `;
      }).join('')
      : '<tr><td colspan="7" class="source-ops-empty">No keyword records</td></tr>';

    const apiHtml = apiRows.length > 0
      ? apiRows.map((row) => {
        const encodedId = encodeURIComponent(row.id);
        const actions = apiActions(row.status).map(action => `
          <button
            class="source-ops-action ${action.style || ''}"
            data-api-id="${encodedId}"
            data-api-next="${action.next}"
          >${action.label}</button>
        `).join('');
        const refreshBtn = `
          <button
            class="source-ops-action"
            data-api-id="${encodedId}"
            data-api-refresh="1"
          >Recheck</button>
        `;
        return `
          <tr>
            <td>${escapeHtml(row.name)}</td>
            <td>${escapeHtml(row.category)}</td>
            <td><span class="source-ops-pill ${row.status}">${row.status.toUpperCase()}</span></td>
            <td>${Math.round(row.confidence)}</td>
            <td><span class="source-ops-pill ${row.healthStatus}">${row.healthStatus.toUpperCase()}</span></td>
            <td><a class="source-ops-link" href="${escapeHtml(row.sampleUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(clampText(row.sampleUrl, 56))}</a></td>
            <td class="source-ops-actions">${actions}${refreshBtn}</td>
          </tr>
        `;
      }).join('')
      : '<tr><td colspan="7" class="source-ops-empty">No API source records</td></tr>';

    const eventHtml = eventRows.length > 0
      ? eventRows.map((row) => `
        <tr>
          <td>${fmtDateTime(row.createdAt)}</td>
          <td><span class="source-ops-pill">${escapeHtml(row.kind.toUpperCase())}</span></td>
          <td><span class="source-ops-pill ${escapeHtml(row.status || 'info')}">${escapeHtml((row.actor || 'system').toUpperCase())}</span></td>
          <td>${escapeHtml(row.title)}</td>
          <td>${escapeHtml(clampText(row.detail || row.action || '-', 140))}</td>
          <td>${row.url ? `<a class="source-ops-link" href="${escapeHtml(row.url)}" target="_blank" rel="noopener noreferrer">open</a>` : '-'}</td>
        </tr>
      `).join('')
      : '<tr><td colspan="6" class="source-ops-empty">No discovery events logged yet</td></tr>';

    const networkHtml = networkCaptures.length > 0
      ? networkCaptures.slice(0, 14).map((row) => `
        <tr>
          <td>${fmtDateTime(row.discoveredAt)}</td>
          <td><span class="source-ops-pill">${escapeHtml(row.source)}</span></td>
          <td><span class="source-ops-pill ${escapeHtml(row.schemaHint)}">${escapeHtml(row.schemaHint.toUpperCase())}</span></td>
          <td><a class="source-ops-link" href="${escapeHtml(row.requestUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(clampText(row.requestUrl, 68))}</a></td>
          <td>${escapeHtml(clampText(row.sampleKeys.join(', ') || '-', 120))}</td>
        </tr>
      `).join('')
      : '<tr><td colspan="5" class="source-ops-empty">No network intercepts captured yet</td></tr>';

    const credibilityHtml = credibility.length > 0
      ? credibility.slice(0, 14).map((row) => `
        <tr>
          <td>${escapeHtml(row.source)}</td>
          <td>${row.credibilityScore}</td>
          <td>${row.corroborationScore}</td>
          <td>${row.historicalAccuracyScore}</td>
          <td>${row.feedHealthScore}</td>
          <td>${row.propagandaRiskScore}</td>
          <td>${escapeHtml(row.notes.slice(0, 2).join(' | ') || '-')}</td>
        </tr>
      `).join('')
      : '<tr><td colspan="7" class="source-ops-empty">No credibility profiles yet</td></tr>';

    const healingHtml = healingSuggestions.length > 0
      ? healingSuggestions.slice(0, 14).map((row) => {
        const encodedId = encodeURIComponent(row.id);
        const actions = healingActions(row.status).map((action) => `
          <button
            class="source-ops-action ${action.style || ''}"
            data-healing-id="${encodedId}"
            data-healing-next="${action.next}"
          >${action.label}</button>
        `).join('');
        return `
          <tr>
            <td>${escapeHtml(row.feedName)}</td>
            <td>${escapeHtml(row.type)}</td>
            <td><span class="source-ops-pill ${row.status}">${row.status.toUpperCase()}</span></td>
            <td>${row.confidence}</td>
            <td>${row.suggestedUrl ? `<a class="source-ops-link" href="${escapeHtml(row.suggestedUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(clampText(row.suggestedUrl, 56))}</a>` : escapeHtml(clampText(row.selectorHint || '-', 56))}</td>
            <td>${escapeHtml(clampText(row.reason, 120))}</td>
            <td class="source-ops-actions">${actions || '-'}</td>
          </tr>
        `;
      }).join('')
      : '<tr><td colspan="7" class="source-ops-empty">No healing suggestions yet</td></tr>';

    this.setContent(`
      <div class="source-ops-root">
        ${summaryHtml}

        <section class="source-ops-section">
          <div class="source-ops-section-title source-ops-section-title-with-actions">
            <span>Discovery / Provenance Log</span>
            <span class="source-ops-subtext">${logEvents.length} recent events</span>
          </div>
          <div class="source-ops-table-wrap">
            <table class="source-ops-table">
              <thead>
                <tr><th>Time</th><th>Kind</th><th>Actor</th><th>Title</th><th>Detail</th><th>Link</th></tr>
              </thead>
              <tbody>${eventHtml}</tbody>
            </table>
          </div>
        </section>

        <section class="source-ops-section">
          <div class="source-ops-section-title source-ops-section-title-with-actions">
            <span>Playwright Network Intercepts</span>
            <span class="source-ops-subtext">${networkCaptures.length} captured endpoints</span>
          </div>
          <div class="source-ops-table-wrap">
            <table class="source-ops-table">
              <thead>
                <tr><th>Time</th><th>Source</th><th>Schema</th><th>Request URL</th><th>Sample Keys</th></tr>
              </thead>
              <tbody>${networkHtml}</tbody>
            </table>
          </div>
        </section>

        <section class="source-ops-section">
          <div class="source-ops-section-title">Source Credibility Re-evaluation</div>
          <div class="source-ops-table-wrap">
            <table class="source-ops-table">
              <thead>
                <tr><th>Source</th><th>Cred</th><th>Corroboration</th><th>History</th><th>Health</th><th>Propaganda</th><th>Notes</th></tr>
              </thead>
              <tbody>${credibilityHtml}</tbody>
            </table>
          </div>
        </section>

        <section class="source-ops-section">
          <div class="source-ops-section-title">Source Healing Suggestions</div>
          <div class="source-ops-table-wrap">
            <table class="source-ops-table">
              <thead>
                <tr><th>Feed</th><th>Type</th><th>Status</th><th>Conf</th><th>Suggestion</th><th>Reason</th><th>Actions</th></tr>
              </thead>
              <tbody>${healingHtml}</tbody>
            </table>
          </div>
        </section>

        <section class="source-ops-section">
          <div class="source-ops-section-title">Degraded Feed Registry</div>
          <div class="source-ops-table-wrap">
            <table class="source-ops-table">
              <thead>
                <tr><th>Feed</th><th>Status</th><th>Fails</th><th>Last Reason</th><th>Last OK</th></tr>
              </thead>
              <tbody>${degradedHtml}</tbody>
            </table>
          </div>
        </section>

        <section class="source-ops-section">
          <div class="source-ops-section-title">Investigation Queue</div>
          <div class="source-ops-table-wrap">
            <table class="source-ops-table">
              <thead>
                <tr><th>Feed</th><th>Status</th><th>Attempts</th><th>Reason</th><th>Updated</th></tr>
              </thead>
              <tbody>${queueHtml}</tbody>
            </table>
          </div>
        </section>

        <section class="source-ops-section">
          <div class="source-ops-section-title source-ops-section-title-with-actions">
            <span>Discovered Sources (Draft/Approval)</span>
            <button class="source-ops-action primary" data-bulk-source-apply="1">Apply All</button>
          </div>
          <div class="source-ops-table-wrap">
            <table class="source-ops-table">
              <thead>
                <tr><th>Name</th><th>Category</th><th>Status</th><th>Conf</th><th>By / Topics</th><th>Domain</th><th>Actions</th></tr>
              </thead>
              <tbody>${discoveredHtml}</tbody>
            </table>
          </div>
        </section>

        <section class="source-ops-section">
          <div class="source-ops-section-title source-ops-section-title-with-actions">
            <span>Keyword Registry</span>
            <button class="source-ops-action primary" data-bulk-keyword-apply="1">Apply All</button>
          </div>
          <div class="source-ops-table-wrap">
            <table class="source-ops-table">
              <thead>
                <tr><th>Keyword</th><th>Domain</th><th>Status</th><th>Quality</th><th>Conf</th><th>Last Seen</th><th>Actions</th></tr>
              </thead>
              <tbody>${keywordHtml}</tbody>
            </table>
          </div>
        </section>

        <section class="source-ops-section">
          <div class="source-ops-section-title source-ops-section-title-with-actions">
            <span>API Source Registry</span>
            <button class="source-ops-action primary" data-bulk-api-apply="1">Apply All</button>
          </div>
          <div class="source-ops-table-wrap">
            <table class="source-ops-table">
              <thead>
                <tr><th>Name</th><th>Category</th><th>Status</th><th>Conf</th><th>Health</th><th>Sample URL</th><th>Actions</th></tr>
              </thead>
              <tbody>${apiHtml}</tbody>
            </table>
          </div>
        </section>
      </div>
    `);
  }

  private handleClick(event: MouseEvent): void {
    const target = event.target as HTMLElement | null;

    const bulkSourceBtn = target?.closest<HTMLButtonElement>('button[data-bulk-source-apply]');
    if (bulkSourceBtn) {
      bulkSourceBtn.disabled = true;
      void listDiscoveredSources()
        .then((items) => Promise.all(items
          .filter((item) => item.status !== 'active' && item.status !== 'rejected')
          .map((item) => setDiscoveredSourceStatus(item.id, 'active'))))
        .then(() => this.refresh())
        .catch((error) => console.warn('[source-ops] bulk source apply failed', error))
        .finally(() => {
          bulkSourceBtn.disabled = false;
        });
      return;
    }

    const bulkKeywordBtn = target?.closest<HTMLButtonElement>('button[data-bulk-keyword-apply]');
    if (bulkKeywordBtn) {
      bulkKeywordBtn.disabled = true;
      void listKeywordRegistry()
        .then((items) => Promise.all(items
          .filter((item) => item.status === 'draft')
          .map((item) => setKeywordStatus(item.id, 'active'))))
        .then(() => this.refresh())
        .catch((error) => console.warn('[source-ops] bulk keyword apply failed', error))
        .finally(() => {
          bulkKeywordBtn.disabled = false;
        });
      return;
    }

    const bulkApiBtn = target?.closest<HTMLButtonElement>('button[data-bulk-api-apply]');
    if (bulkApiBtn) {
      bulkApiBtn.disabled = true;
      void listApiSourceRegistry()
        .then((items) => Promise.all(items
          .filter((item) => item.status !== 'active' && item.status !== 'rejected')
          .map((item) => setApiSourceStatus(item.id, 'active'))))
        .then(() => this.refresh())
        .catch((error) => console.warn('[source-ops] bulk api apply failed', error))
        .finally(() => {
          bulkApiBtn.disabled = false;
        });
      return;
    }

    const discoveredBtn = target?.closest<HTMLButtonElement>('button[data-source-id][data-source-next]');
    if (discoveredBtn) {
      const encodedId = discoveredBtn.dataset.sourceId || '';
      const next = discoveredBtn.dataset.sourceNext as DiscoveredSourceStatus | undefined;
      if (!encodedId || !next) return;
      discoveredBtn.disabled = true;
      void setDiscoveredSourceStatus(decodeURIComponent(encodedId), next)
        .then(() => this.refresh())
        .catch((error) => console.warn('[source-ops] discovered source transition failed', error))
        .finally(() => {
          discoveredBtn.disabled = false;
        });
      return;
    }

    const keywordBtn = target?.closest<HTMLButtonElement>('button[data-keyword-id][data-keyword-next]');
    if (keywordBtn) {
      const encodedId = keywordBtn.dataset.keywordId || '';
      const next = keywordBtn.dataset.keywordNext as KeywordStatus | undefined;
      if (!encodedId || !next) return;
      keywordBtn.disabled = true;
      void setKeywordStatus(decodeURIComponent(encodedId), next)
        .then(() => this.refresh())
        .catch((error) => console.warn('[source-ops] keyword transition failed', error))
        .finally(() => {
          keywordBtn.disabled = false;
        });
      return;
    }

    const apiStatusBtn = target?.closest<HTMLButtonElement>('button[data-api-id][data-api-next]');
    if (apiStatusBtn) {
      const encodedId = apiStatusBtn.dataset.apiId || '';
      const next = apiStatusBtn.dataset.apiNext as ApiSourceStatus | undefined;
      if (!encodedId || !next) return;
      apiStatusBtn.disabled = true;
      void setApiSourceStatus(decodeURIComponent(encodedId), next)
        .then(() => this.refresh())
        .catch((error) => console.warn('[source-ops] api source transition failed', error))
        .finally(() => {
          apiStatusBtn.disabled = false;
        });
      return;
    }

    const apiRefreshBtn = target?.closest<HTMLButtonElement>('button[data-api-id][data-api-refresh]');
    if (apiRefreshBtn) {
      const encodedId = apiRefreshBtn.dataset.apiId || '';
      if (!encodedId) return;
      apiRefreshBtn.disabled = true;
      void refreshApiSourceHealth(decodeURIComponent(encodedId))
        .then(() => this.refresh())
        .catch((error) => console.warn('[source-ops] api source recheck failed', error))
        .finally(() => {
          apiRefreshBtn.disabled = false;
        });
      return;
    }

    const healingBtn = target?.closest<HTMLButtonElement>('button[data-healing-id][data-healing-next]');
    if (healingBtn) {
      const encodedId = healingBtn.dataset.healingId || '';
      const next = healingBtn.dataset.healingNext as SourceHealingSuggestionStatus | undefined;
      if (!encodedId || !next) return;
      healingBtn.disabled = true;
      void setSourceHealingSuggestionStatus(decodeURIComponent(encodedId), next)
        .then(() => this.refresh())
        .catch((error) => console.warn('[source-ops] healing suggestion transition failed', error))
        .finally(() => {
          healingBtn.disabled = false;
        });
    }
  }

  public override destroy(): void {
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
    this.content.removeEventListener('click', this.onClickBound);
    super.destroy();
  }
}
