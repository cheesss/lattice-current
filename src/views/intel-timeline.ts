import { escapeHtml } from '@/utils/sanitize';
import type {
  ImpactTimelineResponse,
  TimelineEvent,
  ThemeOverlapResult,
} from '@/types/intelligence-dashboard';

type Locale = 'en' | 'ko';

type TimelineViewEvent = TimelineEvent & {
  assetImpacts: Record<string, Record<string, number>>;
};

function t(locale: Locale, en: string, ko: string): string {
  return locale === 'ko' ? ko : en;
}

function formatTimestamp(ts: number, locale: Locale): string {
  const d = new Date(ts);
  return d.toLocaleString(locale === 'ko' ? 'ko-KR' : 'en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

const PERIOD_FILTERS = [
  { id: '24h', en: '24h', ko: '24시간' },
  { id: '3d', en: '3d', ko: '3일' },
  { id: '1w', en: '1w', ko: '1주' },
  { id: '2w', en: '2w', ko: '2주' },
  { id: '1m', en: '1m', ko: '1개월' },
] as const;

function renderPeriodFilters(locale: Locale): string {
  return PERIOD_FILTERS.map((p) => `
    <button
      type="button"
      class="backtest-lab-btn secondary intel-period-btn${p.id === '1w' ? ' selected' : ''}"
      data-action="set-timeline-period"
      data-period="${p.id}"
      aria-pressed="${p.id === '1w' ? 'true' : 'false'}"
    >${escapeHtml(locale === 'ko' ? p.ko : p.en)}</button>
  `).join('');
}

function renderOverlapCards(
  overlaps: ThemeOverlapResult[],
  locale: Locale,
): string {
  if (overlaps.length === 0) return '';

  const cards = overlaps.map((ov) => {
    const themeList = ov.themeIds.map((id) => escapeHtml(id)).join(', ');
    const effectRows = ov.combinedEffect.map((eff) => `
      <tr>
        <td>${escapeHtml(eff.symbol)}</td>
        <td>${escapeHtml(eff.avgReturnPct.toFixed(2))}%</td>
        <td>${escapeHtml(eff.singleThemeAvg.toFixed(2))}%</td>
      </tr>
    `).join('');

    const start = formatTimestamp(ov.overlapStart, locale);
    const end = ov.overlapEnd
      ? formatTimestamp(ov.overlapEnd, locale)
      : t(locale, 'Ongoing', '진행 중');

    return `
      <article class="intel-overlap-card backtest-lab-card" aria-label="${escapeHtml(t(locale, 'Theme Overlap', '테마 겹침'))}">
        <header class="intel-overlap-header">
          <strong>${escapeHtml(t(locale, 'Overlap', '겹침'))}</strong>
          <span class="intel-overlap-themes">${themeList}</span>
        </header>
        <div class="intel-overlap-period backtest-lab-note">
          ${escapeHtml(start)} — ${escapeHtml(end)}
        </div>
        ${ov.combinedEffect.length > 0 ? `
          <table class="intel-overlap-table" aria-label="${escapeHtml(t(locale, 'Combined effect', '복합 효과'))}">
            <thead>
              <tr>
                <th>${escapeHtml(t(locale, 'Asset', '자산'))}</th>
                <th>${escapeHtml(t(locale, 'Combined', '복합'))}</th>
                <th>${escapeHtml(t(locale, 'Single', '단일'))}</th>
              </tr>
            </thead>
            <tbody>${effectRows}</tbody>
          </table>
        ` : ''}
      </article>`;
  }).join('');

  return `
    <div class="intel-overlap-section">
      <h3 class="intel-panel-heading">${escapeHtml(t(locale, 'Theme Overlaps', '테마 겹침'))}</h3>
      <div class="intel-overlap-cards" role="list">${cards}</div>
    </div>`;
}

function renderEventMarkers(events: TimelineViewEvent[], locale: Locale): string {
  if (events.length === 0) return '';

  return events.slice(0, 20).map((ev) => `
    <div
      class="intel-event-marker"
      data-event-id="${escapeHtml(ev.id)}"
      data-timestamp="${ev.timestamp}"
      aria-label="${escapeHtml(ev.title)}"
    >
      <span class="intel-event-time">${escapeHtml(formatTimestamp(ev.timestamp, locale))}</span>
      <span class="intel-event-title">${escapeHtml(ev.title)}</span>
      <span class="intel-event-intensity">${escapeHtml((ev.intensity * 100).toFixed(0))}%</span>
    </div>
  `).join('');
}

export function renderTimelineView(data: {
  events: TimelineViewEvent[];
  overlaps: ImpactTimelineResponse['overlaps'];
  scrubberSnapshots: ImpactTimelineResponse['scrubberSnapshots'];
  locale: Locale;
}): string {
  const { events, overlaps, locale } = data;

  if (events.length === 0) {
    return `
      <section class="intel-timeline backtest-lab-section" aria-label="${escapeHtml(t(locale, 'Impact Timeline', '영향 타임라인'))}">
        <div class="intel-empty-state backtest-lab-note">
          ${escapeHtml(t(locale, 'No timeline events found.', '타임라인 이벤트가 없습니다.'))}
        </div>
      </section>`;
  }

  return `
    <section class="intel-timeline backtest-lab-section" aria-label="${escapeHtml(t(locale, 'Impact Timeline', '영향 타임라인'))}">
      <h2 class="intel-section-heading">${escapeHtml(t(locale, 'Impact Timeline', '영향 타임라인'))}</h2>

      <nav class="intel-period-filters" aria-label="${escapeHtml(t(locale, 'Time period', '기간'))}">
        ${renderPeriodFilters(locale)}
      </nav>

      <div class="intel-chart-panel">
        <h3 class="intel-panel-heading">${escapeHtml(t(locale, 'Swimlane', '스윔레인'))}</h3>
        <div
          id="intel-swimlane-container"
          class="intel-d3-container intel-swimlane"
          role="img"
          aria-label="${escapeHtml(t(locale, 'Theme swimlane chart', '테마 스윔레인 차트'))}"
        ></div>
      </div>

      <div class="intel-chart-panel">
        <h3 class="intel-panel-heading">${escapeHtml(t(locale, 'Time Scrubber', '타임 스크러버'))}</h3>
        <div
          id="intel-scrubber-container"
          class="intel-d3-container intel-scrubber"
          role="slider"
          aria-label="${escapeHtml(t(locale, 'Timeline scrubber', '타임라인 스크러버'))}"
          aria-valuemin="0"
          aria-valuemax="100"
          aria-valuenow="100"
          tabindex="0"
        ></div>
      </div>

      <div class="intel-event-markers" aria-label="${escapeHtml(t(locale, 'Events', '이벤트'))}">
        ${renderEventMarkers(events, locale)}
      </div>

      ${renderOverlapCards(overlaps, locale)}
    </section>`;
}

export function mountTimelineCharts(data: ImpactTimelineResponse): void {
  import('@/utils/d3-swimlane').then(({ renderSwimlane }) => {
    const el = document.getElementById('intel-swimlane-container');
    if (el) {
      const themeMap = new Map<string, { start: number; end: number; intensity: number }[]>();
      for (const ev of data.events) {
        for (const tid of ev.themeIds) {
          if (!themeMap.has(tid)) themeMap.set(tid, []);
          themeMap.get(tid)!.push({ start: ev.timestamp, end: ev.timestamp + 3_600_000, intensity: ev.intensity * 100 });
        }
      }
      renderSwimlane({
        containerId: 'intel-swimlane-container',
        lanes: Array.from(themeMap.entries()).map(([id, segments]) => ({ id, label: id, segments })),
        events: data.events.map((ev) => ({ time: ev.timestamp, label: ev.title, lane: ev.themeIds[0] ?? '' })),
        nowTime: Date.now(),
        width: el.clientWidth || 900,
        height: 400,
      });
    }
  });
}
