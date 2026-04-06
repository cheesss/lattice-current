/**
 * GovernanceDashboardPanel — automation governance and maturity overview.
 *
 * Displays:
 *  - Current maturity level (Manual → Guarded-Auto → Full-Auto)
 *  - Confidence band distribution
 *  - Recent autonomy actions with approval/rejection stats
 *  - LLM fallback chain status
 *  - Risk gate summary
 */

import { Panel } from './Panel';
import { t } from '@/services/i18n';
import { h, replaceChildren } from '@/utils/dom-utils';
import { createLlmChainDetail, getLlmFallbackState } from '@/utils/llm-fallback-status';
import { getOrchestratorHealth } from '@/services/investment/orchestrator';
import { getPipelineLog } from '@/services/investment/pipeline-logger';

type MaturityLevel = 'manual' | 'guarded-auto' | 'full-auto';

const MATURITY_CONFIG: Record<MaturityLevel, { label: string; color: string; threshold: number }> = {
  'manual': { label: 'Manual', color: '#dc3c3c', threshold: 0 },
  'guarded-auto': { label: 'Guarded Auto', color: '#f0c040', threshold: 58 },
  'full-auto': { label: 'Full Auto', color: '#28b478', threshold: 85 },
};

export class GovernanceDashboardPanel extends Panel {
  private refreshTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    super({
      id: 'governance-dashboard',
      title: t('panels.governanceDashboard') || 'Governance',
      showCount: false,
      trackActivity: true,
      infoTooltip: 'Automation governance dashboard — maturity levels, confidence bands, and LLM chain health.',
    });

    this.render();
    this.refreshTimer = setInterval(() => this.render(), 15_000);
    document.addEventListener('wm:intelligence-updated', () => this.render());
  }

  public destroy(): void {
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
  }

  private render = (): void => {
    const health = getOrchestratorHealth();
    const log = getPipelineLog();
    // Touch llmState to ensure chain is initialized (used by createLlmChainDetail)
    getLlmFallbackState();

    const container = h('div', { className: 'gov-dashboard' });

    // ── Maturity level indicator ──
    const maturityLevel = this.computeMaturityLevel();
    container.appendChild(this.buildMaturitySection(maturityLevel));

    // ── Confidence distribution ──
    container.appendChild(this.buildConfidenceDistribution());

    // ── LLM Fallback chain ──
    container.appendChild(createLlmChainDetail());

    // ── Recent actions summary ──
    const recentErrors = log.filter((e) => e.level === 'error').length;
    const recentWarns = log.filter((e) => e.level === 'warn').length;
    container.appendChild(this.buildActionsSummary(log.length, recentErrors, recentWarns));

    // ── Health indicator ──
    if (health) {
      container.appendChild(this.buildHealthRow(health));
    }

    replaceChildren(this.content, container);
  };

  private computeMaturityLevel(): MaturityLevel {
    const health = getOrchestratorHealth();
    if (!health) return 'manual';
    if (health.errors > 0 || health.degraded.length > 2) return 'manual';
    if (health.degraded.length > 0) return 'guarded-auto';
    return 'full-auto';
  }

  private buildMaturitySection(level: MaturityLevel): HTMLElement {
    const cfg = MATURITY_CONFIG[level];
    const pct = level === 'full-auto' ? 100 : level === 'guarded-auto' ? 60 : 20;

    return h('div', { className: 'gov-maturity' },
      h('div', { className: 'gov-section-title' }, 'Automation Maturity'),
      h('div', { className: 'gov-maturity-bar-bg' },
        h('div', {
          className: 'gov-maturity-bar-fill',
          style: `width: ${pct}%; background: ${cfg.color}`,
        }),
      ),
      h('div', { className: 'gov-maturity-label', style: `color: ${cfg.color}` }, cfg.label),
    );
  }

  private buildConfidenceDistribution(): HTMLElement {
    // Derive from pipeline log context
    const bands = { high: 0, building: 0, guarded: 0, low: 0 };
    const log = getPipelineLog();
    for (const entry of log) {
      const band = (entry.context?.['confidenceBand'] ?? '') as string;
      if (band in bands) bands[band as keyof typeof bands]++;
    }
    const total = Object.values(bands).reduce((a, b) => a + b, 0) || 1;

    const rows = (Object.keys(bands) as (keyof typeof bands)[]).map((band) => {
      const count = bands[band];
      const pct = Math.round((count / total) * 100);
      const colors = { high: '#28b478', building: '#64b4ff', guarded: '#f0c040', low: '#dc3c3c' };
      return h('div', { className: 'gov-conf-row' },
        h('span', { className: 'gov-conf-band' }, band),
        h('div', { className: 'gov-conf-bar-bg' },
          h('div', { className: 'gov-conf-bar-fill', style: `width: ${pct}%; background: ${colors[band]}` }),
        ),
        h('span', { className: 'gov-conf-pct' }, `${pct}%`),
      );
    });

    return h('div', { className: 'gov-confidence' },
      h('div', { className: 'gov-section-title' }, 'Confidence Distribution'),
      ...rows,
    );
  }

  private buildActionsSummary(total: number, errors: number, warns: number): HTMLElement {
    return h('div', { className: 'gov-actions' },
      h('div', { className: 'gov-section-title' }, 'Pipeline Activity'),
      h('div', { className: 'gov-actions-stats' },
        h('span', { className: 'gov-stat' }, `${total} events`),
        h('span', { className: 'gov-stat gov-stat-warn' }, `${warns} warnings`),
        h('span', { className: 'gov-stat gov-stat-error' }, `${errors} errors`),
      ),
    );
  }

  private buildHealthRow(health: { at: string; durationMs: number; errors: number; degraded: string[] }): HTMLElement {
    return h('div', { className: 'gov-health-row' },
      h('span', { className: 'gov-section-title' }, 'Last Pipeline Run'),
      h('span', { className: 'gov-health-val' }, `${health.durationMs}ms`),
      h('span', { className: 'gov-health-val' }, `${health.errors} errors`),
      h('span', { className: 'gov-health-val' }, `${health.degraded.length} degraded`),
    );
  }
}
