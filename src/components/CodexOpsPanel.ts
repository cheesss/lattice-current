import { Panel } from './Panel';
import { buildAutomationGovernanceSnapshot } from '@/services/automation-governance';
import { listApiSourceRegistry, type ApiSourceRecord } from '@/services/api-source-registry';
import {
  buildCodexAutomationChecklist,
  buildCodexQueueDiagnosis,
  getLocalCodexCliStatusRemote,
  type LocalCodexCliStatus,
  type LocalAutomationOpsSnapshotPayload,
  type RemoteAutomationStatusPayload,
} from '@/services/intelligence-automation-remote';
import { getDataFlowOpsSnapshot, refreshDataFlowOpsSnapshot } from '@/services/data-flow-ops';
import {
  getEffectiveSecrets,
  getSecretState,
  isFeatureAvailable,
  isFeatureEnabled,
  RUNTIME_FEATURES,
} from '@/services/runtime-config';
import { listKeywordRegistry, type KeywordRecord } from '@/services/keyword-registry';
import { listDiscoveredSources, type DiscoveredSourceRecord } from '@/services/source-registry';
import { escapeHtml } from '@/utils/sanitize';

function fmtDateTime(value?: string | number | null): string {
  if (!value) return '-';
  const parsed = typeof value === 'number' ? new Date(value) : new Date(String(value));
  if (Number.isNaN(parsed.getTime())) return '-';
  return parsed.toLocaleString();
}

function fmtAgo(value?: string | null): string {
  if (!value) return '-';
  const ts = Date.parse(value);
  if (!Number.isFinite(ts)) return '-';
  const deltaMs = Math.max(0, Date.now() - ts);
  const mins = Math.floor(deltaMs / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function tone(ok: boolean): string {
  return ok ? 'ready' : 'blocked';
}

function featureTone(status: 'ready' | 'watch' | 'blocked'): string {
  return status === 'ready' ? 'ready' : status === 'blocked' ? 'blocked' : 'watch';
}

export class CodexOpsPanel extends Panel {
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private readonly onClickBound: (event: MouseEvent) => void;
  private inFlight = false;

  constructor() {
    super({
      id: 'codex-ops',
      title: 'Codex Ops',
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

  public destroy(): void {
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
    this.content.removeEventListener('click', this.onClickBound);
    super.destroy();
  }

  public async refresh(forceRefresh = false): Promise<void> {
    if (this.inFlight) return;
    this.inFlight = true;
    try {
      const [opsSnapshot, codexStatus, discoveredSources, apiSources, keywords] = await Promise.all([
        forceRefresh ? refreshDataFlowOpsSnapshot() : getDataFlowOpsSnapshot(),
        getLocalCodexCliStatusRemote(),
        listDiscoveredSources(),
        listApiSourceRegistry(),
        listKeywordRegistry(),
      ]);
      this.renderPanel(opsSnapshot.automation, codexStatus, discoveredSources, apiSources, opsSnapshot.localOps, keywords);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Codex ops refresh failed';
      this.showError(message);
    } finally {
      this.inFlight = false;
    }
  }

  private renderPanel(
    status: RemoteAutomationStatusPayload | null,
    codexStatus: LocalCodexCliStatus,
    discoveredSources: DiscoveredSourceRecord[],
    apiSources: ApiSourceRecord[],
    localOps: LocalAutomationOpsSnapshotPayload | null,
    keywords: KeywordRecord[],
  ): void {
    const codexFeeds = discoveredSources
      .filter((record) => record.discoveredBy === 'codex-playwright')
      .slice(0, 20);
    const codexApis = apiSources
      .filter((record) => record.discoveredBy === 'codex-playwright')
      .slice(0, 20);
    const promotedThemes = status?.state.promotedThemes.slice().sort((a, b) =>
      Date.parse(b.promotedAt) - Date.parse(a.promotedAt),
    ) || [];
    const codexDatasetProposals = status?.state.datasetProposals
      .filter((proposal) => proposal.proposedBy === 'codex')
      .slice()
      .sort((a, b) => b.proposalScore - a.proposalScore) || [];
    const openThemeQueue = status?.state.themeQueue.filter((item) => item.status === 'open') || [];
    const checks = buildCodexAutomationChecklist(status, codexStatus);
    const diagnosis = buildCodexQueueDiagnosis(status, codexStatus, codexFeeds.length, codexApis.length);
    const totalCodexObjects = codexFeeds.length + codexApis.length + promotedThemes.length + codexDatasetProposals.length;

    this.setCount(totalCodexObjects);

    const enabledDatasets = status?.registry.datasets.filter((dataset) => dataset.enabled) || [];
    const activeReplayCount = enabledDatasets.filter((dataset) => status?.state.datasets[dataset.id]?.lastReplayAt).length;
    const blockedDatasets = enabledDatasets.filter((dataset) => status?.state.datasets[dataset.id]?.lastError);
    const accessRows = RUNTIME_FEATURES.map((feature) => {
      const requiredSecrets = getEffectiveSecrets(feature);
      const secretStates = requiredSecrets.map((key) => ({ key, state: getSecretState(key) }));
      const missingSecrets = secretStates.filter((entry) => !entry.state.valid).map((entry) => entry.key);
      const featureDatasetErrors = blockedDatasets
        .filter((dataset) => {
          const provider = String(dataset.provider || '').toLowerCase();
          if (feature.id === 'economicFred' || feature.id === 'supplyChain') return provider === 'fred' || provider === 'alfred';
          if (feature.id === 'acledConflicts') return provider === 'acled';
          return false;
        })
        .map((dataset) => `${dataset.id}: ${status?.state.datasets[dataset.id]?.lastError || 'error'}`);
      let currentStatus: 'ready' | 'watch' | 'blocked';
      let detail: string;

      if (!isFeatureEnabled(feature.id)) {
        currentStatus = 'watch';
        detail = 'Feature toggle is disabled.';
      } else if (feature.id === 'aiCodexLogin') {
        currentStatus = codexStatus.available && codexStatus.loggedIn ? 'ready' : 'blocked';
        detail = codexStatus.message;
      } else if (isFeatureAvailable(feature.id) && featureDatasetErrors.length === 0) {
        currentStatus = 'ready';
        detail = requiredSecrets.length
          ? `Verified: ${secretStates.map((entry) => `${entry.key}:${entry.state.source}`).join(', ')}`
          : feature.fallback;
      } else if (missingSecrets.length > 0) {
        currentStatus = 'blocked';
        detail = `Missing or invalid: ${missingSecrets.join(', ')}`;
      } else if (featureDatasetErrors.length > 0) {
        currentStatus = 'blocked';
        detail = featureDatasetErrors.join(' | ');
      } else {
        currentStatus = 'watch';
        detail = feature.fallback;
      }

      return `
        <tr>
          <td>${escapeHtml(feature.name)}</td>
          <td><span class="investment-action-chip ${featureTone(currentStatus)}">${escapeHtml(currentStatus.toUpperCase())}</span></td>
          <td>${requiredSecrets.length ? escapeHtml(requiredSecrets.join(', ')) : 'login/runtime'}</td>
          <td>${escapeHtml(detail)}</td>
        </tr>
      `;
    }).join('');
    const readyFeatureCount = RUNTIME_FEATURES.filter((feature) =>
      feature.id === 'aiCodexLogin'
        ? codexStatus.available && codexStatus.loggedIn
        : isFeatureEnabled(feature.id) && isFeatureAvailable(feature.id),
    ).length;
    const blockedFeatureCount = RUNTIME_FEATURES.length - readyFeatureCount;
    const governance = buildAutomationGovernanceSnapshot({
      status,
      localOps,
      discoveredSources,
      apiSources,
      keywords,
    });
    const localBlockerReasons = (localOps?.blockerReasons || []).slice(0, 8).map((reason) => `<li>${escapeHtml(reason)}</li>`).join('');
    const localCredentialSummary = localOps?.credentials
      ? `${(localOps.credentials.presentKeys || []).length} present / ${(localOps.credentials.missingRequiredKeys || []).length} required missing`
      : 'sidecar ops snapshot unavailable';
    const localOpsMeta = localOps?.automation?.state;
    const localLastCycleAt = localOps?.automation?.lastCycle?.completedAt || null;

    const checklistHtml = checks.map((item) => `
      <div class="codex-ops-check ${tone(item.ok)}">
        <div class="codex-ops-check-top">
          <span class="codex-ops-check-label">${escapeHtml(item.label)}</span>
          <span class="investment-action-chip ${tone(item.ok)}">${item.ok ? 'OK' : 'WAIT'}</span>
        </div>
        <div class="codex-ops-check-detail">${escapeHtml(item.detail)}</div>
      </div>
    `).join('');

    const diagnosisHtml = diagnosis.map((line) => `<li>${escapeHtml(line)}</li>`).join('');
    const openQueueRows = openThemeQueue.slice(0, 10).map((item) => `
      <tr>
        <td>${escapeHtml(item.label)}</td>
        <td>${item.signalScore}</td>
        <td>${item.sampleCount}</td>
        <td>${item.sourceCount}</td>
        <td>${item.overlapWithKnownThemes.toFixed(2)}</td>
        <td>${escapeHtml(item.datasetIds.join(', ') || '-')}</td>
      </tr>
    `).join('');

    const codexFeedRows = codexFeeds.map((row) => `
      <tr>
        <td>${escapeHtml(row.feedName)}</td>
        <td>${escapeHtml(row.category)}</td>
        <td>${escapeHtml(row.status.toUpperCase())}</td>
        <td>${row.confidence}</td>
        <td>${escapeHtml(row.domain)}</td>
        <td>${fmtDateTime(row.updatedAt)}</td>
      </tr>
    `).join('');

    const codexApiRows = codexApis.map((row) => `
      <tr>
        <td>${escapeHtml(row.name)}</td>
        <td>${escapeHtml(row.category)}</td>
        <td>${escapeHtml(row.status.toUpperCase())}</td>
        <td>${row.confidence}</td>
        <td>${escapeHtml(row.healthStatus.toUpperCase())}</td>
        <td>${fmtDateTime(row.updatedAt)}</td>
      </tr>
    `).join('');

    const promotedThemeRows = promotedThemes.slice(0, 12).map((entry) => `
      <tr>
        <td>${escapeHtml(entry.theme.label)}</td>
        <td>${entry.confidence}</td>
        <td>${escapeHtml(entry.sourceTopicKey)}</td>
        <td>${escapeHtml(entry.theme.triggers.slice(0, 4).join(', ') || '-')}</td>
        <td>${fmtDateTime(entry.promotedAt)}</td>
      </tr>
    `).join('');

    const datasetRows = codexDatasetProposals.slice(0, 12).map((proposal) => `
      <tr>
        <td>${escapeHtml(proposal.label)}</td>
        <td>${escapeHtml(proposal.provider.toUpperCase())}</td>
        <td>${proposal.proposalScore}</td>
        <td>${escapeHtml(proposal.pitSafety.toUpperCase())}</td>
        <td>${proposal.autoRegister ? 'yes' : 'no'}</td>
        <td>${proposal.autoEnable ? 'yes' : 'no'}</td>
      </tr>
    `).join('');

    const blockedDatasetRows = blockedDatasets.map((dataset) => `
      <tr>
        <td>${escapeHtml(dataset.id)}</td>
        <td>${escapeHtml(dataset.provider.toUpperCase())}</td>
        <td>${escapeHtml(status?.state.datasets[dataset.id]?.lastError || '-')}</td>
        <td>${fmtAgo(status?.state.datasets[dataset.id]?.nextEligibleAt || null)}</td>
      </tr>
    `).join('');

    const latestRuns = (status?.state.runs || [])
      .slice(-10)
      .reverse()
      .filter((run) => run.kind === 'theme-discovery' || run.kind === 'dataset-discovery' || run.kind === 'candidate-expansion' || run.kind === 'source-automation')
      .map((run) => `
        <tr>
          <td>${escapeHtml(run.kind)}</td>
          <td>${escapeHtml(run.datasetId || 'global')}</td>
          <td>${escapeHtml(run.status.toUpperCase())}</td>
          <td>${escapeHtml(run.detail)}</td>
          <td>${fmtDateTime(run.completedAt)}</td>
        </tr>
      `).join('');
    const governanceFeatureRows = governance.features.map((feature) => `
      <tr>
        <td>${escapeHtml(feature.label)}</td>
        <td><span class="investment-action-chip ${featureTone(feature.status)}">${escapeHtml(feature.level.toUpperCase())}</span></td>
        <td><span class="investment-action-chip ${featureTone(feature.biasRisk === 'high' ? 'blocked' : feature.biasRisk === 'medium' ? 'watch' : 'ready')}">${escapeHtml(feature.biasRisk.toUpperCase())}</span></td>
        <td>${feature.score}</td>
        <td>${escapeHtml(feature.touchpoints[0] || '-')}</td>
        <td>${escapeHtml(feature.detail)}</td>
      </tr>
    `).join('');
    const governanceWarningItems = governance.biasWarnings.map((warning) => `<li>${escapeHtml(warning)}</li>`).join('');
    const governanceTouchpointItems = governance.humanTouchpoints.map((item) => `<li>${escapeHtml(item)}</li>`).join('');
    const providerShareRows = governance.datasetProviders.map((entry) => `
      <tr>
        <td>${escapeHtml(entry.label)}</td>
        <td>${entry.count}</td>
        <td>${entry.pct.toFixed(1)}%</td>
      </tr>
    `).join('');
    const keywordDomainRows = governance.keywordDomains.map((entry) => `
      <tr>
        <td>${escapeHtml(entry.label)}</td>
        <td>${entry.count}</td>
        <td>${entry.pct.toFixed(1)}%</td>
      </tr>
    `).join('');
    const themeDatasetRows = governance.themeDatasets.map((entry) => `
      <tr>
        <td>${escapeHtml(entry.label)}</td>
        <td>${entry.count}</td>
        <td>${entry.pct.toFixed(1)}%</td>
      </tr>
    `).join('');
    const sourceOriginRows = governance.sourceOrigins.map((entry) => `
      <tr>
        <td>${escapeHtml(entry.label)}</td>
        <td>${entry.count}</td>
        <td>${entry.pct.toFixed(1)}%</td>
      </tr>
    `).join('');

    this.setContent(`
      <div class="codex-ops-shell">
        <div class="investment-panel-meta">
          <span>CODEX <b>${escapeHtml(codexStatus.loggedIn ? 'READY' : 'LOCKED')}</b></span>
          <span>ENABLED DATASETS <b>${enabledDatasets.length}</b></span>
          <span>REPLAYING <b>${activeReplayCount}</b></span>
          <span>OPEN QUEUE <b>${openThemeQueue.length}</b></span>
          <span>PROPOSED DATASETS <b>${codexDatasetProposals.length}</b></span>
        </div>

        <section class="investment-subcard">
          <div class="investment-subcard-head">
            <h4>Codex Automation Checklist</h4>
            <button type="button" class="backtest-lab-btn" data-action="refresh">Refresh</button>
          </div>
          <div class="codex-ops-checklist">${checklistHtml}</div>
        </section>

        <section class="investment-subcard">
          <div class="investment-subcard-head">
            <h4>Automation Governance</h4>
            <span class="investment-mini-label">${governance.automationScore}/100 automation score</span>
          </div>
          <div class="investment-coverage-grid">
            <div class="investment-coverage-stat"><span class="investment-mini-label">Status</span><b>${escapeHtml(governance.status.toUpperCase())}</b></div>
            <div class="investment-coverage-stat"><span class="investment-mini-label">Human touchpoints</span><b>${governance.humanTouchpoints.length}</b></div>
            <div class="investment-coverage-stat"><span class="investment-mini-label">Bias warnings</span><b>${governance.biasWarnings.length}</b></div>
            <div class="investment-coverage-stat"><span class="investment-mini-label">Top provider</span><b>${escapeHtml(governance.datasetProviders[0]?.label || '-')}</b></div>
          </div>
          <div class="investment-grid-two">
            <div>
              <div class="investment-policy-note">${escapeHtml(governance.biasWarnings[0] || 'No major concentration warning is currently active.')}</div>
              <ul class="codex-ops-diagnosis">${governanceTouchpointItems || '<li>No extra manual touchpoint beyond final deployment is currently reported.</li>'}</ul>
            </div>
            <div>
              <ul class="codex-ops-diagnosis">${governanceWarningItems || '<li>No major automation bias warning is currently active.</li>'}</ul>
            </div>
          </div>
          <table class="investment-table">
            <thead><tr><th>Workflow</th><th>Maturity</th><th>Bias risk</th><th>Score</th><th>Manual touchpoint</th><th>Detail</th></tr></thead>
            <tbody>${governanceFeatureRows}</tbody>
          </table>
        </section>

        <section class="investment-subcard">
          <div class="investment-subcard-head">
            <h4>Access Center</h4>
            <span class="investment-mini-label">${readyFeatureCount}/${RUNTIME_FEATURES.length} ready</span>
          </div>
          <div class="investment-coverage-grid">
            <div class="investment-coverage-stat"><span class="investment-mini-label">Ready features</span><b>${readyFeatureCount}</b></div>
            <div class="investment-coverage-stat"><span class="investment-mini-label">Blocked features</span><b>${blockedFeatureCount}</b></div>
            <div class="investment-coverage-stat"><span class="investment-mini-label">Codex login</span><b>${codexStatus.loggedIn ? 'ON' : 'OFF'}</b></div>
            <div class="investment-coverage-stat"><span class="investment-mini-label">Protected dataset blockers</span><b>${blockedDatasets.length}</b></div>
          </div>
          <table class="investment-table">
            <thead><tr><th>Feature</th><th>Status</th><th>Needs</th><th>Blocker / fallback</th></tr></thead>
            <tbody>${accessRows}</tbody>
          </table>
        </section>

        <section class="investment-subcard">
          <div class="investment-subcard-head">
            <h4>Operator Inbox</h4>
            <span class="investment-mini-label">${escapeHtml(localCredentialSummary)}</span>
          </div>
          <div class="investment-coverage-grid">
            <div class="investment-coverage-stat"><span class="investment-mini-label">Last cycle</span><b>${escapeHtml(fmtAgo(localLastCycleAt))}</b></div>
            <div class="investment-coverage-stat"><span class="investment-mini-label">Theme queue</span><b>${localOpsMeta?.queue?.openThemeQueueDepth ?? openThemeQueue.length}</b></div>
            <div class="investment-coverage-stat"><span class="investment-mini-label">Dataset proposals</span><b>${localOpsMeta?.queue?.datasetProposalDepth ?? codexDatasetProposals.length}</b></div>
            <div class="investment-coverage-stat"><span class="investment-mini-label">Failures</span><b>${localOpsMeta?.consecutiveFailures ?? 0}</b></div>
          </div>
          <ul class="codex-ops-diagnosis">${localBlockerReasons || '<li>No sidecar blocker reasons reported.</li>'}</ul>
          ${localOpsMeta?.lastError ? `<div class="investment-policy-note">Last automation error: ${escapeHtml(localOpsMeta.lastError)}</div>` : ''}
        </section>

        <section class="investment-subcard">
          <div class="investment-subcard-head">
            <h4>Why The Queue Is Still Empty</h4>
            <span class="investment-mini-label">${openThemeQueue.length} open items</span>
          </div>
          <ul class="codex-ops-diagnosis">${diagnosisHtml}</ul>
          <div class="investment-grid-two">
            <table class="investment-table">
              <thead><tr><th>Open theme motif</th><th>Score</th><th>Samples</th><th>Sources</th><th>Overlap</th><th>Datasets</th></tr></thead>
              <tbody>${openQueueRows || '<tr><td colspan="6">No open theme queue items yet</td></tr>'}</tbody>
            </table>
            <table class="investment-table">
              <thead><tr><th>Blocked dataset</th><th>Provider</th><th>Error</th><th>Retry</th></tr></thead>
              <tbody>${blockedDatasetRows || '<tr><td colspan="4">No enabled dataset is currently blocked</td></tr>'}</tbody>
            </table>
          </div>
        </section>

        <div class="investment-grid-two">
          <section class="investment-subcard">
            <div class="investment-subcard-head">
              <h4>Bias & Provenance</h4>
              <span class="investment-mini-label">what is shaping automation</span>
            </div>
            <div class="investment-grid-two">
              <table class="investment-table">
                <thead><tr><th>Source origin</th><th>Count</th><th>Share</th></tr></thead>
                <tbody>${sourceOriginRows || '<tr><td colspan="3">No discovered sources yet</td></tr>'}</tbody>
              </table>
              <table class="investment-table">
                <thead><tr><th>Dataset provider</th><th>Count</th><th>Share</th></tr></thead>
                <tbody>${providerShareRows || '<tr><td colspan="3">No dataset provider activity yet</td></tr>'}</tbody>
              </table>
            </div>
            <div class="investment-grid-two">
              <table class="investment-table">
                <thead><tr><th>Keyword domain</th><th>Count</th><th>Share</th></tr></thead>
                <tbody>${keywordDomainRows || '<tr><td colspan="3">No active keyword pool yet</td></tr>'}</tbody>
              </table>
              <table class="investment-table">
                <thead><tr><th>Theme dataset</th><th>Count</th><th>Share</th></tr></thead>
                <tbody>${themeDatasetRows || '<tr><td colspan="3">Theme queue is empty</td></tr>'}</tbody>
              </table>
            </div>
          </section>

          <section class="investment-subcard">
            <div class="investment-subcard-head">
              <h4>Codex Sources</h4>
              <span class="investment-mini-label">${codexFeeds.length + codexApis.length} tracked</span>
            </div>
            <table class="investment-table">
              <thead><tr><th>Feed</th><th>Category</th><th>Status</th><th>Conf</th><th>Domain</th><th>Updated</th></tr></thead>
              <tbody>${codexFeedRows || '<tr><td colspan="6">No Codex-discovered feed sources yet</td></tr>'}</tbody>
            </table>
            <table class="investment-table codex-ops-secondary-table">
              <thead><tr><th>API</th><th>Category</th><th>Status</th><th>Conf</th><th>Health</th><th>Updated</th></tr></thead>
              <tbody>${codexApiRows || '<tr><td colspan="6">No Codex-discovered API sources yet</td></tr>'}</tbody>
            </table>
          </section>

          <section class="investment-subcard">
            <div class="investment-subcard-head">
              <h4>Codex Themes</h4>
              <span class="investment-mini-label">${promotedThemes.length} promoted</span>
            </div>
            <table class="investment-table">
              <thead><tr><th>Theme</th><th>Conf</th><th>Topic key</th><th>Triggers</th><th>Promoted</th></tr></thead>
              <tbody>${promotedThemeRows || '<tr><td colspan="5">No Codex-promoted themes yet</td></tr>'}</tbody>
            </table>
          </section>
        </div>

        <div class="investment-grid-two">
          <section class="investment-subcard">
            <div class="investment-subcard-head">
              <h4>Codex Datasets</h4>
              <span class="investment-mini-label">${codexDatasetProposals.length} proposals</span>
            </div>
            <table class="investment-table">
              <thead><tr><th>Dataset</th><th>Provider</th><th>Score</th><th>PiT</th><th>Register</th><th>Enable</th></tr></thead>
              <tbody>${datasetRows || '<tr><td colspan="6">No Codex dataset proposals yet</td></tr>'}</tbody>
            </table>
          </section>

          <section class="investment-subcard">
            <div class="investment-subcard-head">
              <h4>Recent Codex Automation Runs</h4>
              <span class="investment-mini-label">${fmtAgo(status?.state.updatedAt || null)}</span>
            </div>
            <table class="investment-table">
              <thead><tr><th>Kind</th><th>Dataset</th><th>Status</th><th>Detail</th><th>Completed</th></tr></thead>
              <tbody>${latestRuns || '<tr><td colspan="5">No recent Codex-adjacent automation runs</td></tr>'}</tbody>
            </table>
          </section>
        </div>
      </div>
    `);
  }

  private handleClick(event: MouseEvent): void {
    const target = (event.target as HTMLElement | null)?.closest<HTMLElement>('[data-action]');
    if (!target) return;
    const action = target.dataset.action;
    if (action === 'refresh') {
      void this.refresh(true);
    }
  }
}
