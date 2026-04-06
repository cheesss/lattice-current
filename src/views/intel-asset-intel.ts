import { escapeHtml } from '@/utils/sanitize';
import type { AssetRecommendation, RecommendationsResponse } from '@/types/intelligence-dashboard';

type Locale = 'en' | 'ko';

function t(locale: Locale, en: string, ko: string): string {
  return locale === 'ko' ? ko : en;
}

function directionLabel(dir: AssetRecommendation['direction'], locale: Locale): string {
  const labels: Record<AssetRecommendation['direction'], [string, string]> = {
    long: ['Long', '롱'],
    short: ['Short', '숏'],
    hedge: ['Hedge', '헤지'],
  };
  const pair = labels[dir];
  return locale === 'ko' ? pair[1] : pair[0];
}

function scoreBadgeClass(score: number): string {
  if (score >= 0.8) return 'intel-score-high';
  if (score >= 0.5) return 'intel-score-medium';
  return 'intel-score-low';
}

function renderRationale(rec: AssetRecommendation, locale: Locale): string {
  const r = rec.rationale;
  const headlines = r.topHeadlines.length > 0
    ? r.topHeadlines.map((h) => `<li>${escapeHtml(h)}</li>`).join('')
    : `<li>${escapeHtml(t(locale, 'No recent headlines.', '최근 헤드라인이 없습니다.'))}</li>`;

  return `
    <details class="intel-rationale-details">
      <summary class="intel-rationale-toggle">
        ${escapeHtml(t(locale, 'Rationale', '근거'))}
      </summary>
      <div class="intel-rationale-body">
        <div class="intel-rationale-section">
          <strong>${escapeHtml(t(locale, 'News', '뉴스'))} (${r.newsCount24h})</strong>
          <ul class="intel-headline-list">${headlines}</ul>
        </div>
        <dl class="intel-rationale-stats">
          <div class="intel-stat-pair">
            <dt>${escapeHtml(t(locale, 'Transmission', '전파 강도'))}</dt>
            <dd>${escapeHtml((r.transmissionStrength * 100).toFixed(1))}%</dd>
          </div>
          <div class="intel-stat-pair">
            <dt>${escapeHtml(t(locale, 'Transfer Entropy', '전달 엔트로피'))}</dt>
            <dd>${escapeHtml(r.transferEntropy.toFixed(3))}</dd>
          </div>
          <div class="intel-stat-pair">
            <dt>${escapeHtml(t(locale, 'Lead-Lag', '선행-후행'))}</dt>
            <dd>${escapeHtml(r.leadLagHours.toFixed(1))}h</dd>
          </div>
          <div class="intel-stat-pair">
            <dt>${escapeHtml(t(locale, 'Regime', '체제'))}</dt>
            <dd>${escapeHtml(r.regimeContext)}</dd>
          </div>
          <div class="intel-stat-pair">
            <dt>${escapeHtml(t(locale, 'Corroboration', '교차 검증'))}</dt>
            <dd>${escapeHtml(String(r.corroborationSources))} ${escapeHtml(t(locale, 'sources', '소스'))}</dd>
          </div>
          <div class="intel-stat-pair">
            <dt>${escapeHtml(t(locale, 'Confirmation', '확인 상태'))}</dt>
            <dd>${escapeHtml(r.confirmationState)}</dd>
          </div>
        </dl>
      </div>
    </details>`;
}

export function renderAssetIntelView(data: {
  recommendations: AssetRecommendation[];
  correlationMatrix: { symbols: string[]; correlations: number[][] };
  regime: { id: string; confidence: number } | null;
  locale: Locale;
}): string {
  const { recommendations, regime, locale } = data;

  if (recommendations.length === 0) {
    return `
      <section class="intel-asset-intel backtest-lab-section" aria-label="${escapeHtml(t(locale, 'Asset Intelligence', '자산 인텔리전스'))}">
        <div class="intel-empty-state backtest-lab-note">
          ${escapeHtml(t(locale, 'No recommendations available.', '사용 가능한 추천이 없습니다.'))}
        </div>
      </section>`;
  }

  const regimeBanner = regime
    ? `<div class="intel-regime-banner backtest-lab-note" role="status">
        <strong>${escapeHtml(t(locale, 'Regime', '체제'))}:</strong>
        ${escapeHtml(regime.id)}
        <span class="intel-regime-confidence">(${(regime.confidence * 100).toFixed(0)}%)</span>
      </div>`
    : '';

  const cards = recommendations.map((rec) => `
    <article
      class="intel-asset-card backtest-lab-card"
      data-symbol="${escapeHtml(rec.symbol)}"
      aria-label="${escapeHtml(rec.name)}"
    >
      <header class="intel-asset-card-header">
        <h3 class="intel-asset-name">
          <span class="intel-asset-symbol">${escapeHtml(rec.symbol)}</span>
          ${escapeHtml(rec.name)}
        </h3>
        <span class="intel-score-badge ${scoreBadgeClass(rec.score)}">
          ${escapeHtml((rec.score * 100).toFixed(0))}
        </span>
      </header>
      <div class="intel-asset-meta">
        <span class="intel-direction-tag intel-direction-${escapeHtml(rec.direction)}">
          ${escapeHtml(directionLabel(rec.direction, locale))}
        </span>
        <span class="intel-theme-tag">${escapeHtml(rec.themeLabel)}</span>
        <span class="intel-horizon-tag">${escapeHtml(String(rec.optimalHorizonHours))}h</span>
      </div>
      <div
        id="intel-horizon-${escapeHtml(rec.symbol)}"
        class="intel-horizon-chart-container intel-d3-container"
        role="img"
        aria-label="${escapeHtml(t(locale, 'Horizon returns for ', '수익 전망: ') + rec.symbol)}"
      ></div>
      ${renderRationale(rec, locale)}
    </article>
  `).join('');

  return `
    <section class="intel-asset-intel backtest-lab-section" aria-label="${escapeHtml(t(locale, 'Asset Intelligence', '자산 인텔리전스'))}">
      <h2 class="intel-section-heading">${escapeHtml(t(locale, 'Asset Intelligence', '자산 인텔리전스'))}</h2>
      ${regimeBanner}

      <div class="intel-asset-cards" role="list" aria-label="${escapeHtml(t(locale, 'Recommendations', '추천'))}">
        ${cards}
      </div>

      <div class="intel-chart-panel">
        <h3 class="intel-panel-heading">${escapeHtml(t(locale, 'Correlation Matrix', '상관관계 매트릭스'))}</h3>
        <div
          id="intel-correlation-container"
          class="intel-d3-container intel-correlation"
          role="img"
          aria-label="${escapeHtml(t(locale, 'Asset correlation matrix', '자산 상관관계 매트릭스'))}"
        ></div>
      </div>
    </section>`;
}

export function mountAssetIntelCharts(data: RecommendationsResponse): void {
  import('@/utils/d3-horizon-returns').then(({ renderHorizonReturns }) => {
    for (const rec of data.recommendations) {
      const containerId = `intel-horizon-${rec.symbol}`;
      const el = document.getElementById(containerId);
      if (el) renderHorizonReturns({
        containerId,
        data: rec.horizonReturns.map((h) => ({
          period: `${h.horizonHours}h`,
          avgReturn: h.avgReturnPct,
          best: h.bestReturnPct,
          worst: h.worstReturnPct,
          maxDrawdown: h.maxDrawdownPct,
          winRate: h.winRate,
          sampleCount: h.sampleCount,
        })),
        width: el.clientWidth || 600,
        height: 300,
      });
    }
  });

  import('@/utils/d3-correlation-matrix').then(({ renderCorrelationMatrix }) => {
    const el = document.getElementById('intel-correlation-container');
    if (el) {
      const cm = data.correlationMatrix;
      const correlations: { symbolA: string; symbolB: string; value: number }[] = [];
      for (let i = 0; i < cm.symbols.length; i++) {
        for (let j = 0; j < cm.symbols.length; j++) {
          correlations.push({ symbolA: cm.symbols[i]!, symbolB: cm.symbols[j]!, value: cm.correlations[i]![j]! });
        }
      }
      renderCorrelationMatrix({
        containerId: 'intel-correlation-container',
        symbols: cm.symbols,
        correlations,
        width: el.clientWidth || 600,
        height: 500,
      });
    }
  });
}
