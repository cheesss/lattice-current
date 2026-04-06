import { escapeHtml } from '@/utils/sanitize';


export interface EvidenceItem {
  id: string;
  timestamp: string;
  title: string;
  intensity: number;
  sources: string[];
  themeIds: string[];
  themeLabels: string[];
  assetImpacts: Record<string, number>; // symbol -> 48h return
  corroborationPct: number;
  confidencePct: number;
}

interface FilterDef {
  id: string | null;
  label: string;
}

const FILTERS: FilterDef[] = [
  { id: null, label: '전체' },
  { id: 'me-energy', label: 'ME Energy' },
  { id: 'defense', label: 'Defense' },
  { id: 'safe-haven', label: 'Safe-Haven' },
  { id: 'semi', label: 'Semi' },
];

const SORT_OPTIONS: { key: 'latest' | 'intensity' | 'impact'; label: string }[] = [
  { key: 'latest', label: '최신순' },
  { key: 'intensity', label: '강도순' },
  { key: 'impact', label: '영향도순' },
];

/**
 * Renders the Evidence Feed view with filterable, sortable news/event cards
 * that include inline mini heatmaps and confidence indicators.
 */
export function renderEvidenceFeedView(data: {
  items: EvidenceItem[];
  activeFilter: string | null;
  sortBy: 'latest' | 'intensity' | 'impact';
  locale: 'en' | 'ko';
}): string {
  const { items, activeFilter, sortBy, locale } = data;
  const isKo = locale === 'ko';
  const title = isKo ? '근거 피드' : 'Evidence Feed';

  const filterButtons = FILTERS.map((f) => {
    const active = f.id === activeFilter ? ' intel-filter-active' : '';
    const val = f.id !== null ? escapeHtml(f.id) : '';
    return `<button class="intel-filter-btn${active}" data-filter="${val}">${escapeHtml(f.label)}</button>`;
  }).join('');

  const sortButtons = SORT_OPTIONS.map((s) => {
    const active = s.key === sortBy ? ' intel-sort-active' : '';
    return `<button class="intel-sort-btn${active}" data-sort="${s.key}">${escapeHtml(s.label)}</button>`;
  }).join('');

  const filtered = activeFilter
    ? items.filter((item) => item.themeIds.includes(activeFilter))
    : items;

  const sorted = sortItems(filtered, sortBy);

  const cards = sorted.length > 0
    ? sorted.map((item) => renderEvidenceCard(item, isKo)).join('')
    : renderEmptyState(isKo);

  return `
<section class="intel-evidence-feed" aria-label="${escapeHtml(title)}">
  <h2 class="intel-section-title">${escapeHtml(title)}</h2>

  <div class="intel-evidence-toolbar">
    <div class="intel-filter-group" role="group" aria-label="${isKo ? '필터' : 'Filters'}">
      ${filterButtons}
    </div>
    <div class="intel-sort-group" role="group" aria-label="${isKo ? '정렬' : 'Sort'}">
      ${sortButtons}
    </div>
  </div>

  <div class="intel-evidence-list">${cards}</div>
</section>`;
}

function sortItems(items: EvidenceItem[], sortBy: 'latest' | 'intensity' | 'impact'): EvidenceItem[] {
  const copy = [...items];
  switch (sortBy) {
    case 'latest':
      return copy.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    case 'intensity':
      return copy.sort((a, b) => b.intensity - a.intensity);
    case 'impact': {
      const maxImpact = (item: EvidenceItem): number => {
        const vals = Object.values(item.assetImpacts);
        return vals.length > 0 ? Math.max(...vals.map(Math.abs)) : 0;
      };
      return copy.sort((a, b) => maxImpact(b) - maxImpact(a));
    }
  }
}

function renderEvidenceCard(item: EvidenceItem, isKo: boolean): string {
  const badgeColor = intensityColor(item.intensity);
  const ts = formatTimestamp(item.timestamp, isKo);
  const srcList = item.sources.map((s) => escapeHtml(s)).join(', ');
  const themeTags = item.themeLabels
    .map((lbl) => `<span class="intel-evidence-theme-tag">${escapeHtml(lbl)}</span>`)
    .join('');
  const heatmap = renderMiniHeatmap(item.assetImpacts);
  const alertLabel = isKo ? '알림 설정' : 'Set Alert';

  return `
<article class="intel-evidence-card" data-id="${escapeHtml(item.id)}">
  <div class="intel-evidence-header">
    <span class="intel-evidence-badge" style="background:${badgeColor}"
          title="Intensity ${item.intensity.toFixed(2)}">${item.intensity.toFixed(1)}</span>
    <div class="intel-evidence-meta">
      <h3 class="intel-evidence-title">${escapeHtml(item.title)}</h3>
      <span class="intel-evidence-ts">${escapeHtml(ts)}</span>
      <span class="intel-evidence-sources">${srcList}</span>
    </div>
  </div>
  <div class="intel-evidence-tags">${themeTags}</div>
  <div class="intel-evidence-heatmap" aria-label="${isKo ? '자산 영향' : 'Asset impacts'}">${heatmap}</div>
  <div class="intel-evidence-bars">
    ${renderBar(isKo ? '교차검증' : 'Corroboration', item.corroborationPct)}
    ${renderBar(isKo ? '신뢰도' : 'Confidence', item.confidencePct)}
  </div>
  <div class="intel-evidence-actions">
    <button class="intel-btn intel-btn-sm" data-action="set-alert" data-item-id="${escapeHtml(item.id)}">
      ${escapeHtml(alertLabel)}
    </button>
  </div>
</article>`;
}

function renderMiniHeatmap(impacts: Record<string, number>): string {
  const entries = Object.entries(impacts);
  if (entries.length === 0) return '<span class="intel-heatmap-empty">—</span>';

  return entries
    .map(([sym, ret]) => {
      const color = ret > 0 ? 'var(--intel-positive)' : ret < 0 ? 'var(--intel-negative)' : 'var(--intel-neutral)';
      const pct = (Math.abs(ret) * 100).toFixed(1);
      return `<span class="intel-heatmap-cell" style="background:${color}" title="${escapeHtml(sym)}: ${ret > 0 ? '+' : ''}${pct}%">${escapeHtml(sym)}</span>`;
    })
    .join('');
}

function renderBar(label: string, pct: number): string {
  const clamped = Math.max(0, Math.min(100, pct));
  return `
<div class="intel-bar-group">
  <span class="intel-bar-label">${escapeHtml(label)}</span>
  <div class="intel-bar-track">
    <div class="intel-bar-fill" style="width:${clamped}%"></div>
  </div>
  <span class="intel-bar-value">${Math.round(clamped)}%</span>
</div>`;
}

function intensityColor(intensity: number): string {
  if (intensity >= 0.8) return 'var(--intel-intensity-high, #ef4444)';
  if (intensity >= 0.5) return 'var(--intel-intensity-mid, #f59e0b)';
  return 'var(--intel-intensity-low, #22c55e)';
}

function formatTimestamp(ts: string, isKo: boolean): string {
  try {
    const d = new Date(ts);
    return d.toLocaleString(isKo ? 'ko-KR' : 'en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return ts;
  }
}

function renderEmptyState(isKo: boolean): string {
  const msg = isKo ? '표시할 근거 항목이 없습니다.' : 'No evidence items to display.';
  return `<div class="intel-evidence-empty"><p>${escapeHtml(msg)}</p></div>`;
}
