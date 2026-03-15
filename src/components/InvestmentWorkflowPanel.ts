import { Panel } from './Panel';
import {
  getInvestmentIntelligenceSnapshot,
  requestCodexCandidateExpansion,
  setCandidateExpansionReviewStatus,
  setUniverseExpansionPolicyMode,
  type DirectAssetMapping,
  type InvestmentIntelligenceSnapshot,
} from '@/services/investment-intelligence';
import type { MarketRegimeState } from '@/services/math-models/regime-model';
import {
  clearInvestmentFocusContext,
  getInvestmentFocusContext,
  setInvestmentFocusContext,
  subscribeInvestmentFocusContext,
  type InvestmentFocusContext,
} from '@/services/investment-focus-context';
import { escapeHtml } from '@/utils/sanitize';

function workflowTone(status: string): string {
  if (status === 'ready') return 'ready';
  if (status === 'watch') return 'watch';
  return 'blocked';
}

function sensitivityTone(value: number): string {
  if (value >= 80) return 'critical';
  if (value >= 65) return 'elevated';
  if (value >= 45) return 'watch';
  return 'normal';
}

function formatPct(value: number | null | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 'n/a';
  return `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function buildThemeOptions(snapshot: InvestmentIntelligenceSnapshot): Array<{ id: string; label: string }> {
  const seen = new Map<string, string>();
  for (const row of snapshot.directMappings) {
    if (!seen.has(row.themeId)) seen.set(row.themeId, row.themeLabel);
  }
  return Array.from(seen.entries())
    .map(([id, label]) => ({ id, label }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

function buildRegionOptions(snapshot: InvestmentIntelligenceSnapshot): string[] {
  return Array.from(new Set(snapshot.directMappings.map((row) => row.region).filter(Boolean))).sort();
}

function renderRegimeDial(regime: MarketRegimeState | null | undefined): string {
  if (!regime) {
    return '<div class="investment-regime-empty">Regime data unavailable</div>';
  }
  const order: Array<MarketRegimeState['id']> = ['risk-on', 'risk-off', 'inflation-shock', 'deflation-bust'];
  const idx = Math.max(0, order.indexOf(regime.id));
  const angle = -72 + idx * 48;
  const confidenceWidth = clamp(regime.confidence, 0, 100);
  const radialRows: Array<[string, number]> = [
    ['Growth Stress', regime.features.growthStress],
    ['Inflation', regime.features.inflationPressure],
    ['War', regime.features.warIntensity],
    ['Policy', regime.features.policyStress],
  ];
  const scoreRows = order.map((id) => ({
    id,
    label: id.replace(/-/g, ' '),
    score: regime.scores[id],
    active: id === regime.id,
  }));

  return `
    <div class="investment-regime-card">
      <div class="investment-regime-header">
        <div>
          <div class="investment-mini-label">Market Regime</div>
          <div class="investment-regime-title">${escapeHtml(regime.label)}</div>
        </div>
        <div class="investment-regime-confidence">
          <span>confidence</span>
          <b>${regime.confidence}%</b>
        </div>
      </div>
      <div class="investment-regime-dial-wrap">
        <svg viewBox="0 0 240 150" class="investment-regime-dial" aria-label="Market regime dial">
          <path d="M 30 120 A 90 90 0 0 1 210 120" class="regime-dial-arc" />
          <path d="M 30 120 A 90 90 0 0 1 90 42" class="regime-dial-segment regime-risk-on" />
          <path d="M 90 42 A 90 90 0 0 1 150 42" class="regime-dial-segment regime-risk-off" />
          <path d="M 150 42 A 90 90 0 0 1 190 72" class="regime-dial-segment regime-inflation-shock" />
          <path d="M 190 72 A 90 90 0 0 1 210 120" class="regime-dial-segment regime-deflation-bust" />
          <g transform="translate(120 120)">
            <line x1="0" y1="0" x2="${(Math.cos((angle - 90) * Math.PI / 180) * 70).toFixed(1)}" y2="${(Math.sin((angle - 90) * Math.PI / 180) * 70).toFixed(1)}" class="regime-dial-needle" />
            <circle cx="0" cy="0" r="5" class="regime-dial-hub" />
          </g>
          <text x="48" y="136" class="regime-dial-label">Risk-on</text>
          <text x="96" y="28" class="regime-dial-label">Risk-off</text>
          <text x="160" y="36" class="regime-dial-label">Inflation</text>
          <text x="192" y="136" class="regime-dial-label" text-anchor="end">Deflation</text>
        </svg>
        <div class="investment-regime-body">
          <div class="investment-confidence-bar">
            <span class="investment-mini-label">Regime confidence</span>
            <div class="investment-confidence-track">
              <div class="investment-confidence-fill" style="width:${confidenceWidth}%"></div>
            </div>
          </div>
          <div class="investment-radar-bars">
            ${radialRows.map(([label, value]) => `
              <div class="investment-radar-row">
                <span>${escapeHtml(label)}</span>
                <div class="investment-radar-track"><div class="investment-radar-fill" style="width:${clamp(Number(value), 0, 100)}%"></div></div>
                <b>${Math.round(Number(value))}</b>
              </div>
            `).join('')}
          </div>
          <div class="investment-regime-scores">
            ${scoreRows.map((row) => `
              <div class="investment-regime-score ${row.active ? 'active' : ''}">
                <span>${escapeHtml(row.label)}</span>
                <b>${row.score.toFixed(1)}</b>
              </div>
            `).join('')}
          </div>
        </div>
      </div>
      <div class="investment-regime-notes">
        ${(regime.notes || []).map((note) => `<span>${escapeHtml(note)}</span>`).join('')}
      </div>
    </div>
  `;
}

function renderBanditCloud(mappings: DirectAssetMapping[]): string {
  const rows = mappings
    .filter((row) => typeof row.banditMean === 'number' && typeof row.banditUncertainty === 'number')
    .sort((a, b) => (b.conviction - a.conviction) || ((b.banditUncertainty || 0) - (a.banditUncertainty || 0)))
    .slice(0, 8);
  if (!rows.length) {
    return '<div class="investment-bandit-empty">Bandit uncertainty unavailable</div>';
  }

  const span = Math.max(
    0.12,
    ...rows.map((row) => Math.abs(row.banditMean || 0) + Math.abs(row.banditUncertainty || 0)),
  );
  const width = 560;
  const rowHeight = 34;
  const height = 34 + rows.length * rowHeight;
  const scale = (value: number): number => 40 + ((value + span) / (span * 2 || 1)) * (width - 80);
  const zeroX = scale(0);

  const svgRows = rows.map((row, index) => {
    const y = 28 + index * rowHeight;
    const mean = row.banditMean || 0;
    const uncertainty = row.banditUncertainty || 0;
    const left = scale(mean - uncertainty);
    const right = scale(mean + uncertainty);
    const pointX = scale(mean);
    return `
      <g class="investment-bandit-row">
        <text x="12" y="${y}" class="investment-bandit-label">${escapeHtml(row.symbol)}</text>
        <rect x="${left.toFixed(1)}" y="${(y - 12).toFixed(1)}" width="${Math.max(4, right - left).toFixed(1)}" height="14" rx="7" class="investment-bandit-range" />
        <circle cx="${pointX.toFixed(1)}" cy="${(y - 5).toFixed(1)}" r="4.5" class="investment-bandit-point" />
        <text x="${(width - 8).toFixed(1)}" y="${y}" text-anchor="end" class="investment-bandit-value">
          ${(row.banditScore || 0).toFixed(2)}
        </text>
      </g>
    `;
  }).join('');

  return `
    <div class="investment-bandit-card">
      <div class="investment-bandit-title-row">
        <div>
          <div class="investment-mini-label">Bandit Confidence Interval Cloud</div>
          <div class="investment-bandit-title">Upper-confidence arms with uncertainty</div>
        </div>
      </div>
      <svg viewBox="0 0 ${width} ${height}" class="investment-bandit-svg" aria-label="Bandit uncertainty cloud">
        <line x1="${zeroX.toFixed(1)}" y1="10" x2="${zeroX.toFixed(1)}" y2="${(height - 10).toFixed(1)}" class="investment-bandit-zero" />
        <text x="${zeroX.toFixed(1)}" y="14" text-anchor="middle" class="investment-bandit-zero-label">neutral</text>
        ${svgRows}
      </svg>
    </div>
  `;
}

function filterSnapshot(
  snapshot: InvestmentIntelligenceSnapshot,
  focus: InvestmentFocusContext,
): {
  mappings: DirectAssetMapping[];
  ideaCards: InvestmentIntelligenceSnapshot['ideaCards'];
  trackedIdeas: InvestmentIntelligenceSnapshot['trackedIdeas'];
  backtests: InvestmentIntelligenceSnapshot['backtests'];
  analogs: InvestmentIntelligenceSnapshot['analogs'];
  sensitivity: InvestmentIntelligenceSnapshot['sectorSensitivity'];
} {
  const byTheme = focus.themeId
    ? snapshot.directMappings.filter((row) => row.themeId === focus.themeId)
    : snapshot.directMappings.slice();
  const mappings = focus.region
    ? byTheme.filter((row) => row.region === focus.region)
    : byTheme;
  const symbolSet = new Set(mappings.map((row) => row.symbol));
  const ideaCards = snapshot.ideaCards.filter((card) =>
    (!focus.themeId || card.themeId === focus.themeId)
    && (!focus.region || card.title.endsWith(`| ${focus.region}`)),
  );
  const trackedIdeas = snapshot.trackedIdeas.filter((idea) =>
    !focus.themeId || idea.themeId === focus.themeId,
  );
  const backtests = snapshot.backtests.filter((row) =>
    (!focus.themeId || row.themeId === focus.themeId)
    && (!symbolSet.size || symbolSet.has(row.symbol)),
  );
  const analogs = snapshot.analogs.filter((row) =>
    !focus.themeId || row.themes.includes(focus.themeId),
  );
  const sensitivity = snapshot.sectorSensitivity.filter((row) =>
    !symbolSet.size || row.symbols.some((symbol) => symbolSet.has(symbol)),
  );
  return { mappings, ideaCards, trackedIdeas, backtests, analogs, sensitivity };
}

export class InvestmentWorkflowPanel extends Panel {
  private snapshot: InvestmentIntelligenceSnapshot | null = null;
  private focus = getInvestmentFocusContext();
  private unsubscribeFocus: (() => void) | null = null;

  constructor() {
    super({ id: 'investment-workflow', title: 'Macro Investment Workflow', showCount: true });

    this.unsubscribeFocus = subscribeInvestmentFocusContext((context) => {
      this.focus = context;
      this.renderPanel();
    });

    this.content.addEventListener('change', (event) => {
      const target = event.target as HTMLSelectElement | null;
      const field = target?.dataset.field;
      if (!field) return;
      if (field === 'theme') {
        setInvestmentFocusContext({ themeId: target.value || null });
      } else if (field === 'region') {
        setInvestmentFocusContext({ region: target.value || null });
      }
    });

    this.content.addEventListener('click', (event) => {
      const target = event.target as HTMLElement | null;
      const actionEl = target?.closest<HTMLElement>('[data-action]');
      if (!actionEl) return;
      const action = actionEl.dataset.action;
      if (action === 'clear-focus') {
        clearInvestmentFocusContext();
        return;
      }
      if (action === 'focus-theme') {
        setInvestmentFocusContext({ themeId: actionEl.dataset.themeId || null });
        return;
      }
      if (action === 'approve-review' && actionEl.dataset.reviewId) {
        void this.handleReviewStatus(actionEl.dataset.reviewId, 'accepted');
        return;
      }
      if (action === 'reject-review' && actionEl.dataset.reviewId) {
        void this.handleReviewStatus(actionEl.dataset.reviewId, 'rejected');
        return;
      }
      if (action === 'reopen-review' && actionEl.dataset.reviewId) {
        void this.handleReviewStatus(actionEl.dataset.reviewId, 'open');
        return;
      }
      if (action === 'ask-codex' && actionEl.dataset.themeId) {
        void this.handleCodexReview(actionEl.dataset.themeId);
        return;
      }
      if (action === 'set-policy-mode' && actionEl.dataset.mode) {
        void this.handlePolicyMode(actionEl.dataset.mode as 'manual' | 'guarded-auto' | 'full-auto');
      }
    });
  }

  public destroy(): void {
    this.unsubscribeFocus?.();
    this.unsubscribeFocus = null;
    super.destroy();
  }

  public setData(snapshot: InvestmentIntelligenceSnapshot | null): void {
    this.snapshot = snapshot;
    this.renderPanel();
  }

  private async handleReviewStatus(
    reviewId: string,
    status: 'accepted' | 'rejected' | 'open',
  ): Promise<void> {
    await setCandidateExpansionReviewStatus(reviewId, status);
    this.snapshot = await getInvestmentIntelligenceSnapshot();
    this.renderPanel();
  }

  private async handleCodexReview(themeId: string): Promise<void> {
    try {
      await requestCodexCandidateExpansion(themeId);
      this.snapshot = await getInvestmentIntelligenceSnapshot();
      this.renderPanel();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Codex candidate expansion failed';
      this.showError(message);
    }
  }

  private async handlePolicyMode(mode: 'manual' | 'guarded-auto' | 'full-auto'): Promise<void> {
    await setUniverseExpansionPolicyMode(mode);
    this.snapshot = await getInvestmentIntelligenceSnapshot();
    this.renderPanel();
  }

  private renderPanel(): void {
    const snapshot = this.snapshot;
    if (!snapshot) {
      this.showError('Investment workflow not ready');
      return;
    }

    const filtered = filterSnapshot(snapshot, this.focus);
    const falsePositive = snapshot.falsePositive;
    const themeOptions = buildThemeOptions(snapshot);
    const regionOptions = buildRegionOptions(snapshot);
    const coverageGaps = snapshot.coverageGaps.filter((gap) =>
      (!this.focus.themeId || gap.themeId === this.focus.themeId)
      && (!this.focus.region || gap.region === this.focus.region),
    );
    const candidateReviews = snapshot.candidateReviews.filter((review) =>
      !this.focus.themeId || review.themeId === this.focus.themeId,
    );
    const activeThemeForCodex = this.focus.themeId || filtered.mappings[0]?.themeId || snapshot.directMappings[0]?.themeId || '';

    const workflow = snapshot.workflow.map((step) => `
      <div class="investment-workflow-step ${workflowTone(step.status)}">
        <div class="investment-workflow-top">
          <span class="investment-workflow-label">${escapeHtml(step.label)}</span>
          <span class="investment-workflow-metric">${step.metric}</span>
        </div>
        <div class="investment-workflow-summary">${escapeHtml(step.summary)}</div>
      </div>
    `).join('');

    const mappingRows = filtered.mappings.slice(0, 10).map((row) => `
      <tr>
        <td>
          <button type="button" class="backtest-lab-link" data-action="focus-theme" data-theme-id="${escapeHtml(row.themeId)}">${escapeHtml(row.eventTitle)}</button>
        </td>
        <td>${escapeHtml(row.symbol)}</td>
        <td>${escapeHtml(row.direction.toUpperCase())}</td>
        <td>${row.conviction}</td>
        <td>${row.falsePositiveRisk}</td>
        <td>${(row.transferEntropy ?? 0).toFixed(2)}</td>
      </tr>
    `).join('');

    const sensitivityRows = filtered.sensitivity.slice(0, 8).map((row) => `
      <tr class="${sensitivityTone(row.sensitivityScore)}">
        <td>${escapeHtml(row.sector)}</td>
        <td>${escapeHtml(row.commodity || '-')}</td>
        <td>${escapeHtml(row.bias)}</td>
        <td>${row.sensitivityScore}</td>
        <td>${row.sampleSize}</td>
        <td>${formatPct(row.liveReturnPct)}</td>
        <td>${row.backtestWinRate ?? 'n/a'}%</td>
        <td>${escapeHtml(row.symbols.slice(0, 3).join(', '))}</td>
      </tr>
    `).join('');

    const analogRows = filtered.analogs.slice(0, 6).map((analog) => `
      <tr>
        <td>${escapeHtml(analog.label)}</td>
        <td>${analog.similarity}</td>
        <td>${analog.avgMovePct >= 0 ? '+' : ''}${analog.avgMovePct.toFixed(2)}%</td>
        <td>${analog.winRate}%</td>
        <td>${analog.sampleSize}</td>
      </tr>
    `).join('');

    const trackedRows = filtered.trackedIdeas.slice(0, 8).map((idea) => `
      <tr>
        <td>${escapeHtml(idea.title)}</td>
        <td>${escapeHtml(idea.status.toUpperCase())}</td>
        <td>${formatPct(idea.status === 'closed' ? idea.realizedReturnPct : idea.currentReturnPct)}</td>
        <td>${idea.daysHeld.toFixed(1)}</td>
        <td>${escapeHtml(idea.exitReason || '-')}</td>
      </tr>
    `).join('');

    const backtestRows = filtered.backtests.slice(0, 8).map((row) => `
      <tr>
        <td>${escapeHtml(row.symbol)}</td>
        <td>${escapeHtml(row.direction.toUpperCase())}</td>
        <td>${row.sampleSize}</td>
        <td>${row.hitRate}%</td>
        <td>${formatPct(row.avgReturnPct)}</td>
      </tr>
    `).join('');

    const coverageStats = `
      <div class="investment-coverage-grid">
        <div class="investment-coverage-stat"><span class="investment-mini-label">Catalog</span><b>${snapshot.universeCoverage.totalCatalogAssets}</b></div>
        <div class="investment-coverage-stat"><span class="investment-mini-label">Direct mappings</span><b>${snapshot.universeCoverage.directMappingCount}</b></div>
        <div class="investment-coverage-stat"><span class="investment-mini-label">Approved expansions</span><b>${snapshot.universeCoverage.dynamicApprovedCount}</b></div>
        <div class="investment-coverage-stat"><span class="investment-mini-label">Open reviews</span><b>${snapshot.universeCoverage.openReviewCount}</b></div>
        <div class="investment-coverage-stat"><span class="investment-mini-label">Coverage gaps</span><b>${snapshot.universeCoverage.gapCount}</b></div>
        <div class="investment-coverage-stat"><span class="investment-mini-label">Themes with gaps</span><b>${snapshot.universeCoverage.uncoveredThemeCount}</b></div>
      </div>
    `;
    const policy = snapshot.universePolicy;
    const policyControls = `
      <div class="investment-policy-toolbar">
        <button type="button" class="backtest-lab-btn${policy.mode === 'manual' ? ' selected' : ''}" data-action="set-policy-mode" data-mode="manual">Manual</button>
        <button type="button" class="backtest-lab-btn${policy.mode === 'guarded-auto' ? ' selected' : ''}" data-action="set-policy-mode" data-mode="guarded-auto">Guarded Auto</button>
        <button type="button" class="backtest-lab-btn${policy.mode === 'full-auto' ? ' selected' : ''}" data-action="set-policy-mode" data-mode="full-auto">Full Auto</button>
      </div>
      <div class="investment-policy-note">
        Codex auto-add mode is <b>${escapeHtml(policy.mode)}</b>. Threshold=${policy.minCodexConfidence}, max auto approvals per theme=${policy.maxAutoApprovalsPerTheme}, probation=${policy.probationCycles} active cycles, auto-demote after ${policy.autoDemoteMisses} misses.
      </div>
    `;

    const gapRows = coverageGaps.slice(0, 10).map((gap) => `
      <tr class="${gap.severity}">
        <td><button type="button" class="backtest-lab-link" data-action="focus-theme" data-theme-id="${escapeHtml(gap.themeId)}">${escapeHtml(gap.themeLabel)}</button></td>
        <td>${escapeHtml(gap.region)}</td>
        <td>${escapeHtml(gap.severity.toUpperCase())}</td>
        <td>${escapeHtml(gap.missingAssetKinds.join(', ') || '-')}</td>
        <td>${escapeHtml(gap.missingSectors.join(', ') || '-')}</td>
        <td>${escapeHtml(gap.suggestedSymbols.join(', ') || '-')}</td>
      </tr>
    `).join('');

    const reviewRows = candidateReviews.slice(0, 12).map((review) => {
      const actions = review.status === 'open'
        ? `
          <button type="button" class="backtest-lab-btn" data-action="approve-review" data-review-id="${escapeHtml(review.id)}">Approve</button>
          <button type="button" class="backtest-lab-btn secondary" data-action="reject-review" data-review-id="${escapeHtml(review.id)}">Reject</button>
        `
        : `
          <button type="button" class="backtest-lab-btn secondary" data-action="reopen-review" data-review-id="${escapeHtml(review.id)}">Reopen</button>
        `;
      return `
        <tr class="investment-review-row ${escapeHtml(review.status)}">
          <td><button type="button" class="backtest-lab-link" data-action="focus-theme" data-theme-id="${escapeHtml(review.themeId)}">${escapeHtml(review.themeLabel)}</button></td>
          <td>${escapeHtml(review.symbol)}</td>
          <td>${escapeHtml(review.sector)}</td>
          <td>${escapeHtml(review.direction.toUpperCase())}</td>
          <td>${review.confidence}</td>
          <td>${escapeHtml(review.source.toUpperCase())}</td>
          <td>${review.autoApproved ? escapeHtml((review.autoApprovalMode || 'auto').toUpperCase()) : '-'}</td>
          <td>${escapeHtml(review.probationStatus.toUpperCase())}</td>
          <td>${review.requiresMarketData ? 'yes' : 'no'}</td>
          <td>${escapeHtml(review.status.toUpperCase())}</td>
          <td class="investment-review-actions">${actions}</td>
        </tr>
      `;
    }).join('');

    const summary = snapshot.summaryLines.map((line) => `<li>${escapeHtml(line)}</li>`).join('');
    const focusBadge = this.focus.themeId || this.focus.region
      ? `<div class="investment-focus-badge">Focus: ${escapeHtml(this.focus.themeId || 'all themes')} ${this.focus.region ? `| ${escapeHtml(this.focus.region)}` : ''}</div>`
      : '<div class="investment-focus-badge muted">Focus: global</div>';

    this.setCount(filtered.ideaCards.length || snapshot.workflow.length);
    this.setContent(`
      <div class="investment-panel-shell">
        <div class="investment-panel-meta">
          <span>UPDATED <b>${escapeHtml(new Date(snapshot.generatedAt).toLocaleTimeString())}</b></span>
          <span>FILTERED <b>${falsePositive.kept}/${falsePositive.screened}</b></span>
          <span>REJECTED <b>${falsePositive.rejected}</b></span>
          <span>MAPPINGS <b>${filtered.mappings.length}</b></span>
        </div>
        <div class="investment-focus-toolbar">
          ${focusBadge}
          <label>
            <span class="investment-mini-label">Theme</span>
            <select data-field="theme">
              <option value="">All themes</option>
              ${themeOptions.map((option) => `<option value="${escapeHtml(option.id)}"${option.id === this.focus.themeId ? ' selected' : ''}>${escapeHtml(option.label)}</option>`).join('')}
            </select>
          </label>
          <label>
            <span class="investment-mini-label">Region</span>
            <select data-field="region">
              <option value="">All regions</option>
              ${regionOptions.map((region) => `<option value="${escapeHtml(region)}"${region === this.focus.region ? ' selected' : ''}>${escapeHtml(region)}</option>`).join('')}
            </select>
          </label>
          <button type="button" class="backtest-lab-btn" data-action="clear-focus">Clear focus</button>
        </div>
        <div class="investment-visual-grid">
          ${renderRegimeDial(snapshot.regime)}
          ${renderBanditCloud(filtered.mappings)}
        </div>
        <div class="investment-workflow-grid">${workflow}</div>
        <div class="investment-summary-block">
          <h4>Workflow Summary</h4>
          <ul>${summary}</ul>
        </div>
        <section class="investment-subcard investment-coverage-card">
          <div class="investment-subcard-head">
            <h4>Coverage-aware Universe</h4>
            ${activeThemeForCodex ? `<button type="button" class="backtest-lab-btn" data-action="ask-codex" data-theme-id="${escapeHtml(activeThemeForCodex)}">Ask Codex For Candidates</button>` : ''}
          </div>
          ${policyControls}
          ${coverageStats}
          <div class="investment-coverage-note">Approved expansions become active on the next intelligence refresh, then flow into idea generation, tracking, and replay/backtest evaluation.</div>
        </section>
        <div class="investment-grid-two">
          <section class="investment-subcard">
            <h4>Direct Event -> Asset Map</h4>
            <table class="investment-table">
              <thead><tr><th>Event</th><th>Asset</th><th>Dir</th><th>Conv</th><th>FP</th><th>TE</th></tr></thead>
              <tbody>${mappingRows || '<tr><td colspan="6">No direct mappings</td></tr>'}</tbody>
            </table>
          </section>
          <section class="investment-subcard">
            <h4>Sector / Commodity Sensitivity</h4>
            <table class="investment-table">
              <thead><tr><th>Sector</th><th>Commodity</th><th>Bias</th><th>Score</th><th>N</th><th>Live</th><th>Hit</th><th>Symbols</th></tr></thead>
              <tbody>${sensitivityRows || '<tr><td colspan="8">No sensitivity rows</td></tr>'}</tbody>
            </table>
          </section>
        </div>
        <div class="investment-grid-two">
          <section class="investment-subcard">
            <h4>Historical Analogs</h4>
            <table class="investment-table">
              <thead><tr><th>Analog</th><th>Sim</th><th>Avg Move</th><th>Win</th><th>N</th></tr></thead>
              <tbody>${analogRows || '<tr><td colspan="5">No analog history yet</td></tr>'}</tbody>
            </table>
          </section>
          <section class="investment-subcard">
            <h4>Tracked Ideas</h4>
            <table class="investment-table">
              <thead><tr><th>Idea</th><th>Status</th><th>Return</th><th>Days</th><th>Exit</th></tr></thead>
              <tbody>${trackedRows || '<tr><td colspan="5">No tracked ideas yet</td></tr>'}</tbody>
            </table>
          </section>
        </div>
        <section class="investment-subcard">
          <h4>Price-backed Backtests</h4>
          <table class="investment-table">
            <thead><tr><th>Symbol</th><th>Dir</th><th>N</th><th>Hit</th><th>Avg Return</th></tr></thead>
            <tbody>${backtestRows || '<tr><td colspan="5">No backtest rows yet</td></tr>'}</tbody>
          </table>
        </section>
        <div class="investment-grid-two">
          <section class="investment-subcard">
            <h4>Coverage Gaps</h4>
            <table class="investment-table">
              <thead><tr><th>Theme</th><th>Region</th><th>Severity</th><th>Missing kinds</th><th>Missing sectors</th><th>Suggestions</th></tr></thead>
              <tbody>${gapRows || '<tr><td colspan="6">No coverage gaps in current focus</td></tr>'}</tbody>
            </table>
          </section>
          <section class="investment-subcard">
            <div class="investment-subcard-head">
              <h4>Candidate Expansion Review Queue</h4>
              <span class="investment-mini-label">${candidateReviews.length} items</span>
            </div>
            <table class="investment-table">
              <thead><tr><th>Theme</th><th>Symbol</th><th>Sector</th><th>Dir</th><th>Conf</th><th>Source</th><th>Auto</th><th>Probation</th><th>Needs market</th><th>Status</th><th>Actions</th></tr></thead>
              <tbody>${reviewRows || '<tr><td colspan="11">No candidate reviews in current focus</td></tr>'}</tbody>
            </table>
          </section>
        </div>
      </div>
    `);
  }
}
