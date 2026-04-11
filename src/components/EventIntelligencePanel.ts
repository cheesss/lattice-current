import { Panel } from './Panel';
import { escapeHtml } from '@/utils/sanitize';

const API_BASE = (import.meta as any).env?.VITE_EVENT_API_BASE ?? '/api/event-intel';

interface ThemeTemperature {
  theme: string;
  temperature: string;
  intensity: number;
}

interface LiveStatusResponse {
  temperatures: ThemeTemperature[];
  signals: Array<{ channel: string; value: number; label: string }>;
  pending?: number;
  todayArticles?: number;
  meta?: { updatedAt?: string; stale?: boolean; window?: string; cacheReason?: string };
}

interface HeatmapCell {
  theme: string;
  symbol: string;
  hitRate: number;
}

interface HeatmapResponse {
  themes: string[];
  symbols: string[];
  cells: HeatmapCell[];
  meta?: { updatedAt?: string; stale?: boolean; window?: string; cacheReason?: string };
}

interface TodayEvent {
  title: string;
  source: string;
  publishedAt: string;
  theme: string;
  expectedReactions: Array<{ symbol: string; direction: string; magnitude: number }>;
}

interface TodayResponse {
  events: TodayEvent[];
  meta?: { updatedAt?: string; stale?: boolean; window?: string; cacheReason?: string };
}

interface WhatIfStrategy {
  name: string;
  sharpe: number;
  expectedReturn: number;
  maxDrawdown: number;
  theme: string;
}

interface WhatIfResponse {
  strategies: WhatIfStrategy[];
  meta?: { updatedAt?: string; stale?: boolean; window?: string; cacheReason?: string };
}

function tempBadgeColor(temp: string): string {
  switch (temp.toUpperCase()) {
    case 'HOT': return '#ef4444';
    case 'WARM': return '#f59e0b';
    case 'COOL': return '#3b82f6';
    case 'COLD': return '#6b7280';
    default: return '#9ca3af';
  }
}

function hitRateColor(rate: number): string {
  if (rate >= 0.8) return 'rgba(239, 68, 68, 0.85)';
  if (rate >= 0.6) return 'rgba(245, 158, 11, 0.75)';
  if (rate >= 0.4) return 'rgba(234, 179, 8, 0.55)';
  if (rate >= 0.2) return 'rgba(59, 130, 246, 0.4)';
  return 'rgba(107, 114, 128, 0.2)';
}

function directionArrow(dir: string): string {
  if (dir === 'up') return '<span style="color:#22c55e">&#9650;</span>';
  if (dir === 'down') return '<span style="color:#ef4444">&#9660;</span>';
  return '<span style="color:#6b7280">&#9644;</span>';
}

function normalizeThemeId(value: string): string | null {
  const normalized = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (!normalized || normalized === 'unknown') return null;
  return normalized;
}

function humanizeTheme(value: string): string {
  return String(value || '')
    .split(/[-_]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function renderThemeChip(theme: string, action: 'brief' | 'validate' = 'brief', label?: string): string {
  const themeId = normalizeThemeId(theme);
  const text = label || humanizeTheme(themeId || theme || 'unknown');
  if (!themeId) {
    return `<span class="event-intel-theme-chip disabled">${escapeHtml(text)}</span>`;
  }
  return `<button type="button" class="event-intel-theme-chip" data-action="${action === 'validate' ? 'open-validation' : 'open-theme'}" data-theme-id="${escapeHtml(themeId)}">${escapeHtml(text)}</button>`;
}

function renderThemeAction(theme: string, label: string, action: 'brief' | 'validate'): string {
  const themeId = normalizeThemeId(theme);
  if (!themeId) return '';
  return `<button type="button" class="event-intel-action-btn${action === 'validate' ? ' secondary' : ''}" data-action="${action === 'validate' ? 'open-validation' : 'open-theme'}" data-theme-id="${escapeHtml(themeId)}">${escapeHtml(label)}</button>`;
}

export class EventIntelligencePanel extends Panel {
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private lastSuccessfulData: {
    live: LiveStatusResponse | null;
    heatmap: HeatmapResponse | null;
    today: TodayResponse | null;
    whatif: WhatIfResponse | null;
    updatedAt: string | null;
  } = { live: null, heatmap: null, today: null, whatif: null, updatedAt: null };

  constructor() {
    super({ id: 'event-intelligence', title: 'Event Intelligence', className: 'event-intelligence-panel' });
    this.content.addEventListener('click', (event) => {
      const target = event.target as HTMLElement | null;
      const button = target?.closest<HTMLButtonElement>('[data-action][data-theme-id]');
      if (!button) return;
      const themeId = normalizeThemeId(button.dataset.themeId || '');
      if (!themeId) return;
      const workspaceId = button.dataset.action === 'open-validation' ? 'validate' : 'brief';
      window.dispatchEvent(new CustomEvent('wm:focus-theme', {
        detail: {
          themeId,
          workspaceId,
          scrollTarget: workspaceId === 'validate' ? 'validation' : 'theme-workspace',
        },
      }));
    });
    void this.refresh();
  }

  public async refresh(): Promise<void> {
    try {
      if (!this.content.innerHTML.trim()) {
        this.setContent(this.buildLoadingState());
      }
      const [liveRes, heatmapRes, todayRes, whatifRes] = await Promise.allSettled([
        fetch(`${API_BASE}/live-status`),
        fetch(`${API_BASE}/heatmap`),
        fetch(`${API_BASE}/today`),
        fetch(`${API_BASE}/whatif`),
      ]);

      const live: LiveStatusResponse | null =
        liveRes.status === 'fulfilled' && liveRes.value.ok
          ? (await liveRes.value.json()) as LiveStatusResponse
          : null;

      const heatmap: HeatmapResponse | null =
        heatmapRes.status === 'fulfilled' && heatmapRes.value.ok
          ? (await heatmapRes.value.json()) as HeatmapResponse
          : null;

      let today: TodayResponse | null =
        todayRes.status === 'fulfilled' && todayRes.value.ok
          ? (await todayRes.value.json()) as TodayResponse
          : null;

      // Fallback: if today events empty, try sensitivity endpoint
      if (today && today.events.length === 0) {
        try {
          const fallbackRes = await fetch(`${API_BASE}/sensitivity`);
          if (fallbackRes.ok) {
            today = { ...today, meta: { ...today.meta, window: '7d-sensitivity-fallback' } };
          }
        } catch {
          // ignore fallback failure
        }
      }

      const whatif: WhatIfResponse | null =
        whatifRes.status === 'fulfilled' && whatifRes.value.ok
          ? (await whatifRes.value.json()) as WhatIfResponse
          : null;

      if (!live && !heatmap && !today && !whatif) {
        // All fetches failed -- use cached data with stale marker
        if (this.lastSuccessfulData.updatedAt) {
          const staleTime = this.lastSuccessfulData.updatedAt;
          const html = this.buildHtml(
            this.lastSuccessfulData.live,
            this.lastSuccessfulData.heatmap,
            this.lastSuccessfulData.today,
            this.lastSuccessfulData.whatif,
          );
          this.setContent(
            `<div style="font-size:10px;color:#f59e0b;padding:4px 8px;background:rgba(245,158,11,0.08);border-radius:6px;margin-bottom:8px">`
            + `데이터 갱신 대기 중 · 마지막 업데이트: ${escapeHtml(new Date(staleTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }))}`
            + `</div>${html}`,
          );
          return;
        }
        this.showError('Event Intelligence API offline', () => void this.refresh());
        return;
      }

      // Cache successful data
      this.lastSuccessfulData = {
        live: live ?? this.lastSuccessfulData.live,
        heatmap: heatmap ?? this.lastSuccessfulData.heatmap,
        today: today ?? this.lastSuccessfulData.today,
        whatif: whatif ?? this.lastSuccessfulData.whatif,
        updatedAt: new Date().toISOString(),
      };

      const html = this.buildHtml(live, heatmap, today, whatif);
      this.setContent(html);
    } catch {
      // Exception -- use cached data with stale marker
      if (this.lastSuccessfulData.updatedAt) {
        const staleTime = this.lastSuccessfulData.updatedAt;
        const html = this.buildHtml(
          this.lastSuccessfulData.live,
          this.lastSuccessfulData.heatmap,
          this.lastSuccessfulData.today,
          this.lastSuccessfulData.whatif,
        );
        this.setContent(
          `<div style="font-size:10px;color:#f59e0b;padding:4px 8px;background:rgba(245,158,11,0.08);border-radius:6px;margin-bottom:8px">`
          + `데이터 갱신 대기 중 · 마지막 업데이트: ${escapeHtml(new Date(staleTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }))}`
          + `</div>${html}`,
        );
        return;
      }
      this.showError('Event Intelligence API offline', () => void this.refresh());
    }
  }

  public startAutoRefresh(intervalMs = 60_000): void {
    this.stopAutoRefresh();
    void this.refresh();
    this.refreshTimer = setInterval(() => void this.refresh(), intervalMs);
  }

  public stopAutoRefresh(): void {
    if (this.refreshTimer !== null) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
  }

  public destroy(): void {
    this.stopAutoRefresh();
    super.destroy();
  }

  private buildHtml(
    live: LiveStatusResponse | null,
    heatmap: HeatmapResponse | null,
    today: TodayResponse | null,
    whatif: WhatIfResponse | null,
  ): string {
      const sections: string[] = [];

    sections.push(this.buildStatusStrip(live, today, heatmap, whatif));

    // --- Theme Temperatures ---
    sections.push(this.buildTemperatures(live));

    // --- Sensitivity Heatmap ---
    sections.push(this.buildHeatmap(heatmap));

    // --- Today's Events ---
    sections.push(this.buildTodayEvents(today));

    // --- Best Strategies ---
    sections.push(this.buildStrategies(whatif));

    return `<div style="display:flex;flex-direction:column;gap:12px;padding:4px 0">${sections.join('')}</div>`;
  }

  private buildLoadingState(): string {
    return `
      <div style="display:flex;flex-direction:column;gap:10px;padding:6px 0">
        <div style="font-size:11px;color:var(--text-dim)">Loading event intelligence...</div>
        <div style="height:22px;border-radius:6px;background:rgba(255,255,255,0.06)"></div>
        <div style="height:80px;border-radius:6px;background:rgba(255,255,255,0.04)"></div>
        <div style="height:96px;border-radius:6px;background:rgba(255,255,255,0.04)"></div>
      </div>`;
  }

  private buildStatusStrip(
    live: LiveStatusResponse | null,
    today: TodayResponse | null,
    heatmap: HeatmapResponse | null,
    whatif: WhatIfResponse | null,
  ): string {
    const updatedAt = live?.meta?.updatedAt ?? today?.meta?.updatedAt ?? heatmap?.meta?.updatedAt ?? whatif?.meta?.updatedAt;
    const stale = Boolean(live?.meta?.stale || today?.meta?.stale || heatmap?.meta?.stale || whatif?.meta?.stale);
    const status = stale ? 'STALE' : 'LIVE';
    const tone = stale ? '#f59e0b' : '#22c55e';
    const articleCount = Number(live?.todayArticles ?? today?.events?.length ?? 0);
    const pending = Number(live?.pending ?? 0);
    const updatedLabel = updatedAt
      ? new Date(updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      : 'collecting';

    return `
      <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;padding:6px 8px;border:1px solid rgba(255,255,255,0.08);border-radius:8px;background:rgba(255,255,255,0.03)">
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
          <span style="font-size:10px;font-weight:700;letter-spacing:0.5px;color:${tone}">${status}</span>
          <span style="font-size:10px;color:var(--text-dim)">Articles: ${articleCount}</span>
          <span style="font-size:10px;color:var(--text-dim)">Pending: ${pending}</span>
        </div>
        <span style="font-size:10px;color:var(--text-dim)">Updated ${escapeHtml(updatedLabel)}</span>
      </div>`;
  }

  private buildTemperatures(live: LiveStatusResponse | null): string {
    if (!live || live.temperatures.length === 0) {
      return `<div style="color:var(--text-dim);font-size:11px;padding:4px 0">테마 온도 수집 중</div>`;
    }

    const badges = live.temperatures
      .map((t) => {
        const bg = tempBadgeColor(t.temperature);
        const themeId = normalizeThemeId(t.theme);
        const label = humanizeTheme(themeId || t.theme);
        if (!themeId) {
          return `<span style="display:inline-block;padding:2px 8px;border-radius:999px;font-size:11px;font-weight:600;background:${bg};color:#fff;margin:2px">${escapeHtml(label)}: ${escapeHtml(t.temperature.toUpperCase())}</span>`;
        }
        return `<button type="button" class="event-intel-temp-chip" data-action="open-theme" data-theme-id="${escapeHtml(themeId)}" style="--event-intel-temp-bg:${bg}">${escapeHtml(label)} <span>${escapeHtml(t.temperature.toUpperCase())}</span></button>`;
      })
      .join('');

    return `
      <div>
        <div style="font-size:10px;text-transform:uppercase;letter-spacing:0.5px;color:var(--text-dim);margin-bottom:4px;font-weight:600">Theme Temperatures</div>
        <div style="display:flex;flex-wrap:wrap;gap:2px">${badges}</div>
      </div>`;
  }

  private buildHeatmap(heatmap: HeatmapResponse | null): string {
    if (!heatmap || heatmap.themes.length === 0 || heatmap.symbols.length === 0) {
      return `<div style="color:var(--text-dim);font-size:11px;padding:4px 0">민감도 데이터 로딩 중</div>`;
    }

    const themes = heatmap.themes;
    const symbols = heatmap.symbols;
    const cellMap = new Map<string, number>();
    for (const c of heatmap.cells) {
      cellMap.set(`${c.theme}|${c.symbol}`, c.hitRate);
    }

    const headerCells = symbols
      .map((s) => `<div style="font-size:9px;text-align:center;color:var(--text-dim);overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${escapeHtml(s)}">${escapeHtml(s)}</div>`)
      .join('');

    const rows = themes
      .map((theme) => {
        const cells = symbols
          .map((sym) => {
            const rate = cellMap.get(`${theme}|${sym}`) ?? 0;
            const bg = hitRateColor(rate);
            return `<div style="background:${bg};border-radius:2px;min-height:18px;font-size:9px;text-align:center;line-height:18px;color:#fff" title="${escapeHtml(theme)} x ${escapeHtml(sym)}: ${(rate * 100).toFixed(0)}%">${(rate * 100).toFixed(0)}</div>`;
          })
          .join('');
        return `<div style="display:flex;align-items:center;min-width:0;overflow:hidden">${renderThemeChip(theme, 'brief', humanizeTheme(theme))}</div>${cells}`;
      })
      .join('');

    return `
      <div>
        <div style="font-size:10px;text-transform:uppercase;letter-spacing:0.5px;color:var(--text-dim);margin-bottom:4px;font-weight:600">Sensitivity Heatmap</div>
        <div style="display:grid;grid-template-columns:minmax(60px,1fr) repeat(${symbols.length},1fr);gap:2px;overflow-x:auto">
          <div></div>${headerCells}
          ${rows}
        </div>
      </div>`;
  }

  private buildTodayEvents(today: TodayResponse | null): string {
    if (!today || today.events.length === 0) {
      return `<div style="color:var(--text-dim);font-size:11px;padding:4px 0">최근 7일 이벤트로 대체</div>`;
    }

    const items = today.events
      .slice(0, 10)
      .map((ev) => {
        const reactions = ev.expectedReactions
          .slice(0, 5)
          .map((r) => `${directionArrow(r.direction)} <span style="font-size:10px;color:var(--text)">${escapeHtml(r.symbol)}</span> <span style="font-size:10px;color:var(--text-dim)">${r.magnitude > 0 ? '+' : ''}${r.magnitude.toFixed(1)}%</span>`)
          .join('&nbsp; ');

        const time = ev.publishedAt
          ? new Date(ev.publishedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
          : '';

        return `
          <div style="padding:4px 0;border-bottom:1px solid rgba(255,255,255,0.05)">
            <div style="display:flex;justify-content:space-between;align-items:baseline">
              <span style="font-size:11px;color:var(--text);font-weight:500">${escapeHtml(ev.title)}</span>
              <span style="font-size:9px;color:var(--text-dim);white-space:nowrap;margin-left:8px">${escapeHtml(time)}</span>
            </div>
            <div style="display:flex;align-items:center;gap:6px;margin-top:2px">
              <span style="font-size:9px;color:var(--text-dim)">${escapeHtml(ev.source)}</span>
              ${renderThemeChip(ev.theme)}
            </div>
            <div style="margin-top:3px">${reactions}</div>
            <div class="event-intel-action-row">
              ${renderThemeAction(ev.theme, 'Open brief', 'brief')}
              ${renderThemeAction(ev.theme, 'Validate', 'validate')}
            </div>
          </div>`;
      })
      .join('');

    return `
      <div>
        <div style="font-size:10px;text-transform:uppercase;letter-spacing:0.5px;color:var(--text-dim);margin-bottom:4px;font-weight:600">Today's Events</div>
        ${items}
      </div>`;
  }

  private buildStrategies(whatif: WhatIfResponse | null): string {
    if (!whatif || whatif.strategies.length === 0) {
      return `<div style="color:var(--text-dim);font-size:11px;padding:4px 0">시뮬레이션 대기 중</div>`;
    }

    const top5 = whatif.strategies
      .sort((a, b) => b.sharpe - a.sharpe)
      .slice(0, 5);

    const rows = top5
      .map((s, i) => {
        const rank = i + 1;
        const returnColor = s.expectedReturn >= 0 ? '#22c55e' : '#ef4444';
        return `
          <div style="display:grid;grid-template-columns:20px minmax(0,1fr) 60px 60px 60px;gap:4px;align-items:center;padding:3px 0;border-bottom:1px solid rgba(255,255,255,0.04);font-size:11px">
            <span style="color:var(--text-dim);font-weight:600">#${rank}</span>
            <div style="display:grid;gap:4px;min-width:0">
              <span style="color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${escapeHtml(s.name)}">${escapeHtml(s.name)}</span>
              <div class="event-intel-action-row compact">
                ${renderThemeChip(s.theme)}
                ${renderThemeAction(s.theme, 'Validate', 'validate')}
              </div>
            </div>
            <span style="text-align:right;color:var(--text)" title="Sharpe">${s.sharpe.toFixed(2)}</span>
            <span style="text-align:right;color:${returnColor}" title="Expected Return">${s.expectedReturn >= 0 ? '+' : ''}${s.expectedReturn.toFixed(1)}%</span>
            <span style="text-align:right;color:#f59e0b" title="Max Drawdown">-${Math.abs(s.maxDrawdown).toFixed(1)}%</span>
          </div>`;
      })
      .join('');

    return `
      <div>
        <div style="font-size:10px;text-transform:uppercase;letter-spacing:0.5px;color:var(--text-dim);margin-bottom:4px;font-weight:600">Best Strategies (by Sharpe)</div>
        <div style="display:grid;grid-template-columns:20px 1fr 60px 60px 60px;gap:4px;padding:3px 0;font-size:9px;color:var(--text-dim);border-bottom:1px solid rgba(255,255,255,0.08)">
          <span></span><span>NAME</span><span style="text-align:right">SHARPE</span><span style="text-align:right">RETURN</span><span style="text-align:right">DD</span>
        </div>
        ${rows}
      </div>`;
  }
}
