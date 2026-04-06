import { escapeHtml } from '@/utils/sanitize';
import type { ThemeIntensityData, SankeyFlowData } from '@/types/intelligence-dashboard';

type Locale = 'en' | 'ko';

function t(locale: Locale, en: string, ko: string): string {
  return locale === 'ko' ? ko : en;
}

function formatIntensity(value: number): string {
  return (value * 100).toFixed(1) + '%';
}

function statusTone(intensity: number): string {
  if (intensity >= 0.7) return 'intel-status-high';
  if (intensity >= 0.4) return 'intel-status-medium';
  return 'intel-status-low';
}

export function renderThemeRadarView(data: {
  themes: ThemeIntensityData[];
  sankeyFlow: SankeyFlowData;
  locale: Locale;
}): string {
  const { themes, locale } = data;

  if (themes.length === 0) {
    return `
      <section class="intel-theme-radar backtest-lab-section" aria-label="${escapeHtml(t(locale, 'Theme Radar', '테마 레이더'))}">
        <div class="intel-empty-state backtest-lab-note">
          ${escapeHtml(t(locale, 'No active themes detected.', '감지된 활성 테마가 없습니다.'))}
        </div>
      </section>`;
  }

  const themeCards = themes.map((theme) => `
    <article
      class="intel-theme-card backtest-lab-card"
      data-theme-id="${escapeHtml(theme.themeId)}"
      aria-label="${escapeHtml(theme.themeLabel)}"
    >
      <header class="intel-theme-card-header">
        <h3 class="intel-theme-title">${escapeHtml(theme.themeLabel)}</h3>
        <span class="intel-intensity-badge ${statusTone(theme.currentIntensity)}">
          ${escapeHtml(formatIntensity(theme.currentIntensity))}
        </span>
      </header>
      <dl class="intel-theme-stats">
        <div class="intel-stat-pair">
          <dt>${escapeHtml(t(locale, 'Half-life', '반감기'))}</dt>
          <dd>${escapeHtml(theme.fittedBetaHours.toFixed(1))}h</dd>
        </div>
        <div class="intel-stat-pair">
          <dt>${escapeHtml(t(locale, 'Excitation', '여기'))}</dt>
          <dd>${escapeHtml(theme.excitationMass.toFixed(2))}</dd>
        </div>
        <div class="intel-stat-pair">
          <dt>${escapeHtml(t(locale, 'Status', '상태'))}</dt>
          <dd class="${statusTone(theme.currentIntensity)}">
            ${escapeHtml(theme.currentIntensity >= 0.7
              ? t(locale, 'Active', '활성')
              : theme.currentIntensity >= 0.4
                ? t(locale, 'Moderate', '보통')
                : t(locale, 'Fading', '감쇠'))}
          </dd>
        </div>
      </dl>
      <div
        id="intel-decay-${escapeHtml(theme.themeId)}"
        class="intel-decay-chart-container"
        role="img"
        aria-label="${escapeHtml(t(locale, 'Decay curve for ', '감쇠 곡선: ') + theme.themeLabel)}"
      ></div>
      <div class="intel-theme-actions">
        <button
          type="button"
          class="backtest-lab-btn secondary intel-alert-btn"
          data-action="set-theme-alert"
          data-theme-id="${escapeHtml(theme.themeId)}"
          aria-label="${escapeHtml(t(locale, 'Set alert for ', '알림 설정: ') + theme.themeLabel)}"
        >
          ${escapeHtml(t(locale, 'Set Alert', '알림 설정'))}
        </button>
      </div>
    </article>
  `).join('');

  return `
    <section class="intel-theme-radar backtest-lab-section" aria-label="${escapeHtml(t(locale, 'Theme Radar', '테마 레이더'))}">
      <h2 class="intel-section-heading">${escapeHtml(t(locale, 'Theme Radar', '테마 레이더'))}</h2>

      <div class="intel-chart-panel">
        <h3 class="intel-panel-heading">${escapeHtml(t(locale, 'Theme Intensity Heatmap', '테마 강도 히트맵'))}</h3>
        <div
          id="intel-heatmap-container"
          class="intel-d3-container intel-heatmap"
          role="img"
          aria-label="${escapeHtml(t(locale, 'Theme intensity heatmap', '테마 강도 히트맵'))}"
        ></div>
      </div>

      <div class="intel-chart-panel">
        <h3 class="intel-panel-heading">${escapeHtml(t(locale, 'Transmission Flow', '전파 흐름'))}</h3>
        <div
          id="intel-sankey-container"
          class="intel-d3-container intel-sankey"
          role="img"
          aria-label="${escapeHtml(t(locale, 'Sankey flow diagram', '산키 흐름 다이어그램'))}"
        ></div>
      </div>

      <div class="intel-theme-cards" role="list" aria-label="${escapeHtml(t(locale, 'Theme cards', '테마 카드'))}">
        ${themeCards}
      </div>
    </section>`;
}

export function mountThemeRadarCharts(data: {
  themes: ThemeIntensityData[];
  sankeyFlow: SankeyFlowData;
}): void {
  import('@/utils/d3-heatmap').then(({ renderHeatmap }) => {
    const el = document.getElementById('intel-heatmap-container');
    if (el) renderHeatmap({
      containerId: 'intel-heatmap-container',
      data: data.themes.flatMap((theme) =>
        theme.intensityTimeSeries.map((pt) => ({
          row: theme.themeLabel,
          col: pt.timestamp,
          value: pt.intensity,
        })),
      ),
      colorScale: 'sequential',
      width: el.clientWidth || 800,
      height: 400,
    });
  });

  import('@/utils/d3-sankey-flow').then(({ renderSankeyFlow }) => {
    const el = document.getElementById('intel-sankey-container');
    if (el) {
      const sf = data.sankeyFlow;
      renderSankeyFlow({
        containerId: 'intel-sankey-container',
        nodes: [
          ...sf.events.map((e) => ({ id: e.id, label: e.label, column: 'event' as const })),
          ...sf.themes.map((t) => ({ id: t.id, label: t.label, column: 'theme' as const })),
          ...sf.assets.map((a) => ({ id: a.id, label: a.label, column: 'asset' as const })),
        ],
        links: sf.links.map((l) => ({
          source: l.source,
          target: l.target,
          value: l.strength,
          direction: l.direction,
        })),
        width: el.clientWidth || 800,
        height: 500,
      });
    }
  });

  import('@/utils/d3-decay-curve').then(({ renderDecayCurve }) => {
    for (const theme of data.themes) {
      const containerId = `intel-decay-${theme.themeId}`;
      const el = document.getElementById(containerId);
      if (el) renderDecayCurve({
        containerId,
        data: theme.predictedDecay.map((d) => ({
          hour: d.hoursFromNow,
          intensity: d.intensity,
          sigma: d.uncertainty,
        })),
        nowHour: 0,
        width: el.clientWidth || 400,
        height: 200,
      });
    }
  });
}
