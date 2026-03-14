import { Panel } from './Panel';
import type { InvestmentIdeaCard, InvestmentIntelligenceSnapshot } from '@/services/investment-intelligence';
import {
  clearInvestmentFocusContext,
  getInvestmentFocusContext,
  setInvestmentFocusContext,
  subscribeInvestmentFocusContext,
  type InvestmentFocusContext,
} from '@/services/investment-focus-context';
import { escapeHtml } from '@/utils/sanitize';

function directionTone(direction: string): string {
  if (direction === 'long') return 'long';
  if (direction === 'short') return 'short';
  if (direction === 'hedge') return 'hedge';
  return 'watch';
}

function formatPct(value: number | null | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 'n/a';
  return `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`;
}

function buildThemeOptions(snapshot: InvestmentIntelligenceSnapshot): Array<{ id: string; label: string }> {
  const seen = new Map<string, string>();
  for (const card of snapshot.ideaCards) {
    if (!seen.has(card.themeId)) {
      const label = card.title.split('|')[0]?.trim() || card.themeId;
      seen.set(card.themeId, label);
    }
  }
  return Array.from(seen.entries())
    .map(([id, label]) => ({ id, label }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

function buildRegionOptions(snapshot: InvestmentIntelligenceSnapshot): string[] {
  return Array.from(
    new Set(
      snapshot.ideaCards
        .map((card) => card.title.split('|')[1]?.trim() || '')
        .filter(Boolean),
    ),
  ).sort();
}

function matchesFocus(card: InvestmentIdeaCard, focus: InvestmentFocusContext): boolean {
  if (focus.themeId && card.themeId !== focus.themeId) return false;
  if (focus.region) {
    const region = card.title.split('|')[1]?.trim() || '';
    if (region !== focus.region) return false;
  }
  return true;
}

function urgencyTone(card: InvestmentIdeaCard): string {
  if (card.conviction >= 85 && card.falsePositiveRisk <= 30) return 'critical-hot';
  if (card.conviction >= 72 && card.falsePositiveRisk <= 42) return 'elevated-hot';
  return '';
}

export class InvestmentIdeasPanel extends Panel {
  private snapshot: InvestmentIntelligenceSnapshot | null = null;
  private focus = getInvestmentFocusContext();
  private unsubscribeFocus: (() => void) | null = null;

  constructor() {
    super({ id: 'investment-ideas', title: 'Auto Investment Ideas', showCount: true });

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
      const action = actionEl.dataset.action || '';
      if (action === 'clear-focus') {
        clearInvestmentFocusContext();
        return;
      }
      if (action === 'focus-theme') {
        setInvestmentFocusContext({ themeId: actionEl.dataset.themeId || null });
        return;
      }
      if (action === 'focus-region') {
        setInvestmentFocusContext({ region: actionEl.dataset.region || null });
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

  private renderPanel(): void {
    const snapshot = this.snapshot;
    if (!snapshot || snapshot.ideaCards.length === 0) {
      this.showError('No investment ideas yet');
      return;
    }

    const themeOptions = buildThemeOptions(snapshot);
    const regionOptions = buildRegionOptions(snapshot);
    const filteredCards = snapshot.ideaCards.filter((card) => matchesFocus(card, this.focus));
    const sizingRules = new Map(snapshot.positionSizingRules.map((rule) => [rule.id, rule]));

    if (filteredCards.length === 0) {
      this.setCount(0);
      this.setContent(`
        <div class="investment-panel-shell">
          <div class="investment-focus-toolbar">
            <div class="investment-focus-badge">Focus: ${escapeHtml(this.focus.themeId || 'all themes')} ${this.focus.region ? `| ${escapeHtml(this.focus.region)}` : ''}</div>
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
          <div class="panel-empty">No ideas match the current focus.</div>
        </div>
      `);
      return;
    }

    const cards = filteredCards.slice(0, 8).map((card) => {
      const matchingRule = snapshot.positionSizingRules.find((rule) =>
        card.conviction >= rule.minConviction && card.falsePositiveRisk <= rule.maxFalsePositiveRisk,
      ) || sizingRules.get(card.direction === 'hedge' ? 'hedge' : 'starter');
      const region = card.title.split('|')[1]?.trim() || '';
      const symbols = card.symbols.map((symbol) =>
        `<span class="investment-symbol-chip">${escapeHtml(symbol.symbol)} <small>${escapeHtml(symbol.role)}</small></span>`,
      ).join('');
      const triggers = card.triggers.map((item) => `<li>${escapeHtml(item)}</li>`).join('');
      const invalidation = card.invalidation.map((item) => `<li>${escapeHtml(item)}</li>`).join('');
      const evidence = card.evidence.map((item) => `<li>${escapeHtml(item)}</li>`).join('');
      const analogRefs = card.analogRefs.length > 0
        ? `<div class="investment-card-meta-line">Analogs: ${escapeHtml(card.analogRefs.join(' | '))}</div>`
        : '';
      const trackingLine = `
        <div class="investment-card-meta-line">
          Track ${escapeHtml((card.trackingStatus || 'new').toUpperCase())}
          ${typeof card.daysHeld === 'number' ? ` | days ${card.daysHeld.toFixed(1)}` : ''}
          ${card.exitReason ? ` | exit ${escapeHtml(card.exitReason)}` : ''}
        </div>
      `;
      const performanceLine = `
        <div class="investment-card-meta-line">
          Live ${formatPct(card.liveReturnPct)} | Realized ${formatPct(card.realizedReturnPct)}
          | Backtest hit ${card.backtestHitRate ?? 'n/a'}%
          | Avg ${formatPct(card.backtestAvgReturnPct)}
        </div>
      `;

      return `
        <article class="investment-idea-card ${directionTone(card.direction)} ${urgencyTone(card)}">
          <div class="investment-idea-top">
            <div>
              <h4>
                <button type="button" class="backtest-lab-link investment-focus-link" data-action="focus-theme" data-theme-id="${escapeHtml(card.themeId)}">
                  ${escapeHtml(card.title)}
                </button>
              </h4>
              <div class="investment-card-meta-line">${escapeHtml(card.direction.toUpperCase())} | conviction ${card.conviction} | false-positive ${card.falsePositiveRisk}</div>
              <div class="investment-card-meta-line">Suggested size ${card.sizePct.toFixed(2)}% | timeframe ${escapeHtml(card.timeframe)}</div>
              ${matchingRule ? `<div class="investment-card-meta-line">Rule: ${escapeHtml(matchingRule.label)} | stop ${matchingRule.stopLossPct}% | take ${matchingRule.takeProfitPct}%</div>` : ''}
              ${trackingLine}
              ${performanceLine}
              ${analogRefs}
            </div>
          </div>
          <div class="investment-idea-region-row">
            ${region ? `<button type="button" class="investment-focus-chip" data-action="focus-region" data-region="${escapeHtml(region)}">${escapeHtml(region)}</button>` : ''}
            <span class="investment-focus-chip muted">${escapeHtml(card.themeId)}</span>
          </div>
          <div class="investment-idea-thesis">${escapeHtml(card.thesis)}</div>
          <div class="investment-symbol-chip-row">${symbols}</div>
          <div class="investment-idea-grid">
            <section>
              <h5>Triggers</h5>
              <ul>${triggers}</ul>
            </section>
            <section>
              <h5>Invalidation</h5>
              <ul>${invalidation}</ul>
            </section>
            <section>
              <h5>Evidence</h5>
              <ul>${evidence}</ul>
            </section>
          </div>
        </article>
      `;
    }).join('');

    this.setCount(filteredCards.length);
    this.setContent(`
      <div class="investment-panel-shell">
        <div class="investment-focus-toolbar">
          <div class="investment-focus-badge">Focus: ${escapeHtml(this.focus.themeId || 'all themes')} ${this.focus.region ? `| ${escapeHtml(this.focus.region)}` : ''}</div>
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
        <div class="investment-idea-list">${cards}</div>
      </div>
    `);
  }
}
