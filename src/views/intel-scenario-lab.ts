import { escapeHtml } from '@/utils/sanitize';
import type { ThemeIntensityData, ScenarioResult, ScenarioInterpretation } from '@/types/intelligence-dashboard';

/**
 * Renders the Scenario Lab view for interactive what-if analysis.
 * Users select themes, adjust intensity sliders, and observe projected impacts.
 */
export function renderScenarioLabView(data: {
  themes: ThemeIntensityData[];
  locale: 'en' | 'ko';
}): string {
  const { themes, locale } = data;
  const isKo = locale === 'ko';

  const title = isKo ? '시나리오 연구실' : 'Scenario Lab';
  const runLabel = isKo ? '시뮬레이션 실행' : 'Run Simulation';
  const resetLabel = isKo ? '초기화' : 'Reset';
  const builderTitle = isKo ? '테마 조합 구성' : 'Multi-Theme Combination';
  const resultTitle = isKo ? '시뮬레이션 결과' : 'Simulation Results';
  const emptyMsg = isKo
    ? '테마를 선택하고 강도를 조정한 후 시뮬레이션을 실행하세요.'
    : 'Select themes, adjust intensities, then run the simulation.';

  const themeControls = themes.length > 0
    ? themes.map((t) => renderThemeControl(t, isKo)).join('')
    : `<p class="intel-scenario-empty">${isKo ? '사용 가능한 테마가 없습니다.' : 'No themes available.'}</p>`;

  return `
<section class="intel-scenario-lab" aria-label="${escapeHtml(title)}">
  <h2 class="intel-section-title">${escapeHtml(title)}</h2>

  <div class="intel-scenario-controls">
    <h3 class="intel-subsection-title">${escapeHtml(builderTitle)}</h3>
    <div class="intel-scenario-theme-list">${themeControls}</div>
    <div class="intel-scenario-actions">
      <button class="intel-btn intel-btn-primary" data-action="run-scenario">${escapeHtml(runLabel)}</button>
      <button class="intel-btn intel-btn-secondary" data-action="reset-scenario">${escapeHtml(resetLabel)}</button>
    </div>
  </div>

  <div class="intel-scenario-visuals">
    <div id="intel-scenario-chart-container" class="intel-chart-container"
         aria-label="${isKo ? '그룹 막대 차트' : 'Grouped bar chart'}"></div>
    <div id="intel-scenario-decay-container" class="intel-chart-container"
         aria-label="${isKo ? '감쇠 곡선 비교' : 'Decay curve comparison'}"></div>
  </div>

  <div id="intel-scenario-interpretation" class="intel-rec-card" style="margin-top:16px;">
    <h4>${isKo ? '시나리오 해석' : 'Scenario Interpretation'}</h4>
    <div id="intel-scenario-interpretation-content">
      <p style="color:var(--text-secondary)">${isKo ? '시나리오를 실행하면 AI 해석이 표시됩니다' : 'Run a scenario to see AI interpretation'}</p>
    </div>
  </div>

  <div class="intel-scenario-result" id="intel-scenario-result-area">
    <h3 class="intel-subsection-title">${escapeHtml(resultTitle)}</h3>
    <p class="intel-scenario-placeholder">${escapeHtml(emptyMsg)}</p>
  </div>
</section>`;
}

function renderThemeControl(theme: ThemeIntensityData, isKo: boolean): string {
  const label = escapeHtml(theme.themeLabel);
  const id = escapeHtml(theme.themeId);
  const current = Math.round(theme.currentIntensity * 100);
  const intensityLabel = isKo ? '강도' : 'Intensity';

  return `
<div class="intel-scenario-theme-item" data-theme-id="${id}">
  <label class="intel-scenario-checkbox-label">
    <input type="checkbox" class="intel-scenario-theme-check" value="${id}" />
    <span class="intel-scenario-theme-name">${label}</span>
  </label>
  <div class="intel-scenario-slider-group">
    <span class="intel-scenario-slider-label">${escapeHtml(intensityLabel)}</span>
    <input type="range" class="intel-scenario-slider" min="0" max="100" value="${current}"
           data-theme-id="${id}" aria-label="${label} ${escapeHtml(intensityLabel)}" />
    <span class="intel-scenario-slider-value">${current}%</span>
  </div>
</div>`;
}

/**
 * Mounts D3 charts for the scenario lab after HTML is in the DOM.
 * Renders a grouped bar comparison chart and a decay curve overlay.
 */
export function mountScenarioLabCharts(
  scenarioResult: ScenarioResult | null,
  themes: ThemeIntensityData[],
): void {
  const chartEl = document.getElementById('intel-scenario-chart-container');
  const decayEl = document.getElementById('intel-scenario-decay-container');
  const interpEl = document.getElementById('intel-scenario-interpretation-content');

  if (!chartEl || !decayEl) return;

  if (!scenarioResult) {
    chartEl.innerHTML = '';
    decayEl.innerHTML = '';
    if (interpEl) interpEl.innerHTML = '<p style="color:var(--text-secondary)">Run a scenario to see AI interpretation</p>';
    return;
  }

  renderScenarioComparison(chartEl, scenarioResult);
  renderDecayCurve(decayEl, scenarioResult, themes);
  if (interpEl) renderInterpretation(interpEl, scenarioResult.interpretation || []);
}

function renderScenarioComparison(
  container: HTMLElement,
  result: ScenarioResult,
): void {
  const symbols = new Set<string>();
  for (const sym of Object.keys(result.currentState)) symbols.add(sym);
  for (const sym of Object.keys(result.scenarioState)) symbols.add(sym);

  if (symbols.size === 0) {
    container.innerHTML = '<p class="intel-chart-empty">No comparison data.</p>';
    return;
  }

  const rows = Array.from(symbols).map((sym) => {
    const cur = result.currentState[sym] ?? {};
    const scn = result.scenarioState[sym] ?? {};
    const curAvg = average(Object.values(cur));
    const scnAvg = average(Object.values(scn));
    return `<div class="intel-scenario-bar-row" data-symbol="${escapeHtml(sym)}">
      <span class="intel-scenario-bar-label">${escapeHtml(sym)}</span>
      <div class="intel-scenario-bar intel-scenario-bar-current" style="width:${clampPct(curAvg)}%"></div>
      <div class="intel-scenario-bar intel-scenario-bar-scenario" style="width:${clampPct(scnAvg)}%"></div>
    </div>`;
  });

  container.innerHTML = `<div class="intel-scenario-chart">${rows.join('')}</div>`;
}

function renderDecayCurve(
  container: HTMLElement,
  result: ScenarioResult,
  _themes: ThemeIntensityData[],
): void {
  const { currentBetaHours, scenarioBetaHours } = result.decayCurve;
  container.innerHTML = `
<div class="intel-decay-comparison">
  <div class="intel-decay-item">
    <span class="intel-decay-label">Current &beta;</span>
    <span class="intel-decay-value">${currentBetaHours.toFixed(1)}h</span>
  </div>
  <div class="intel-decay-item">
    <span class="intel-decay-label">Scenario &beta;</span>
    <span class="intel-decay-value">${scenarioBetaHours.toFixed(1)}h</span>
  </div>
</div>`;
}

function renderInterpretation(
  container: HTMLElement,
  interpretations: ScenarioInterpretation[],
): void {
  if (interpretations.length === 0) {
    container.innerHTML = '<p style="color:var(--text-secondary)">No interpretation data available.</p>';
    return;
  }

  const cards = interpretations.map((interp) => {
    const directionIcon = interp.direction === 'escalation' ? '&#x25B2;'
      : interp.direction === 'de-escalation' ? '&#x25BC;' : '&#x25CF;';
    const directionColor = interp.direction === 'escalation' ? 'var(--intel-red, #e74c3c)'
      : interp.direction === 'de-escalation' ? 'var(--intel-green, #2ecc71)' : 'var(--text-secondary)';

    const riskList = interp.riskFactors.length > 0
      ? `<ul class="intel-interpretation-risks">${interp.riskFactors.map(r => `<li>${escapeHtml(r)}</li>`).join('')}</ul>`
      : '';

    const beneficiaryList = interp.topBeneficiaries.length > 0
      ? `<div class="intel-interpretation-beneficiaries"><strong>Top movers:</strong> ${interp.topBeneficiaries.map(b => `<span class="intel-interpretation-tag">${escapeHtml(b)}</span>`).join(' ')}</div>`
      : '';

    return `
    <div class="intel-interpretation-card" style="border-left:3px solid ${directionColor}; padding:8px 12px; margin-bottom:8px; background:var(--bg-secondary, #f8f9fa); border-radius:4px;">
      <div style="display:flex; align-items:center; gap:8px; margin-bottom:4px;">
        <span style="color:${directionColor}; font-size:14px;">${directionIcon}</span>
        <strong>${escapeHtml(interp.themeId)}</strong>
        <span style="color:var(--text-secondary); font-size:12px;">${escapeHtml(interp.direction)} @ ${interp.intensity}%</span>
      </div>
      <p style="margin:4px 0;">${escapeHtml(interp.expectedImpact)}</p>
      ${riskList}
      ${beneficiaryList}
    </div>`;
  });

  container.innerHTML = cards.join('');
}

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function clampPct(v: number): number {
  return Math.max(0, Math.min(100, Math.abs(v) * 100));
}
