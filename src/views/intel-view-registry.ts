import type {
  RecommendationsResponse,
  ThemeIntensityResponse,
  ImpactTimelineResponse,
  ScenarioResult,
} from '@/types/intelligence-dashboard';
import { renderThemeRadarView, mountThemeRadarCharts } from '@/views/intel-theme-radar';
import { renderAssetIntelView, mountAssetIntelCharts } from '@/views/intel-asset-intel';
import { renderTimelineView, mountTimelineCharts } from '@/views/intel-timeline';
import { renderScenarioLabView, mountScenarioLabCharts } from '@/views/intel-scenario-lab';
import { renderEvidenceFeedView } from '@/views/intel-evidence-feed';

export type IntelView = 'theme-radar' | 'asset-intel' | 'timeline' | 'scenario' | 'evidence';

export interface IntelViewConfig {
  id: IntelView;
  label: string;
  labelKo: string;
  icon: string;
}

export const INTEL_VIEWS: IntelViewConfig[] = [
  { id: 'theme-radar', label: 'Theme Radar', labelKo: '테마 레이더', icon: '🔥' },
  { id: 'asset-intel', label: 'Asset Intel', labelKo: '자산 인텔', icon: '📊' },
  { id: 'timeline', label: 'Timeline', labelKo: '타임라인', icon: '⏱️' },
  { id: 'scenario', label: 'Scenario', labelKo: '시나리오', icon: '🧪' },
  { id: 'evidence', label: 'Evidence', labelKo: '근거 피드', icon: '📰' },
];

const API_ENDPOINTS: Partial<Record<IntelView, string>> = {
  'theme-radar': '/api/local-intelligence-theme-intensity',
  'asset-intel': '/api/local-intelligence-recommendations',
  'timeline': '/api/local-intelligence-impact-timeline',
  'evidence': '/api/local-intelligence-impact-timeline',
};

/**
 * Renders the tab bar for switching between Intelligence Dashboard views.
 */
export function renderIntelViewTabs(active: IntelView, locale: 'en' | 'ko'): string {
  const isKo = locale === 'ko';

  const tabs = INTEL_VIEWS.map((v) => {
    const label = isKo ? v.labelKo : v.label;
    const activeClass = v.id === active ? ' intel-view-tab-active' : '';
    return `<button class="intel-view-tab${activeClass}" data-intel-view="${v.id}" aria-current="${v.id === active ? 'page' : 'false'}">${v.icon} ${label}</button>`;
  }).join('');

  return `<nav class="intel-view-tabs" role="tablist" aria-label="${isKo ? '인텔리전스 뷰' : 'Intelligence views'}">${tabs}</nav>`;
}

/**
 * Fetches data from the appropriate API endpoint for a given view.
 * Returns parsed JSON on success, or fallback empty data on error.
 */
export async function fetchViewData(view: IntelView): Promise<
  ThemeIntensityResponse | RecommendationsResponse | ImpactTimelineResponse | null
> {
  const endpoint = API_ENDPOINTS[view];

  // Scenario view is user-driven; no initial data fetch required.
  if (!endpoint) return null;

  try {
    const res = await fetch(endpoint);
    if (!res.ok) {
      console.warn(`[intel-view-registry] fetch ${endpoint} responded ${res.status}`);
      return fallbackData(view);
    }
    return (await res.json()) as ThemeIntensityResponse | RecommendationsResponse | ImpactTimelineResponse;
  } catch (err) {
    console.warn(`[intel-view-registry] fetch ${endpoint} failed`, err);
    return fallbackData(view);
  }
}

function fallbackData(
  view: IntelView,
): ThemeIntensityResponse | RecommendationsResponse | ImpactTimelineResponse | null {
  switch (view) {
    case 'theme-radar':
      return { themes: [], sankeyFlow: { events: [], themes: [], assets: [], links: [] } };
    case 'asset-intel':
      return { recommendations: [], correlationMatrix: { symbols: [], correlations: [] }, regime: null };
    case 'timeline':
    case 'evidence':
      return { events: [], overlaps: [], scrubberSnapshots: [] };
    default:
      return null;
  }
}

/**
 * Dispatches to the appropriate view renderer based on the active view.
 * Lazily imports individual view modules to keep the registry lightweight.
 */
export function renderIntelView(
  view: IntelView,
  data: ThemeIntensityResponse | RecommendationsResponse | ImpactTimelineResponse | null,
  locale: 'en' | 'ko',
): string {
  switch (view) {
    case 'scenario': {
      // Inline import to avoid circular dependency at module level
      const themeData = data as ThemeIntensityResponse | null;
      return renderScenarioLabView({
        themes: themeData?.themes ?? [],
        locale,
      });
    }

    case 'evidence': {
      const tlData = data as ImpactTimelineResponse | null;
      const items = (tlData?.events ?? []).map((evt) => ({
        id: evt.id,
        timestamp: new Date(evt.timestamp).toISOString(),
        title: evt.title,
        intensity: evt.intensity,
        sources: evt.sources,
        themeIds: evt.themeIds,
        themeLabels: evt.themeIds, // labels resolved upstream
        assetImpacts: flattenImpacts(evt.assetImpacts),
        corroborationPct: 0,
        confidencePct: 0,
      }));
      return renderEvidenceFeedView({ items, activeFilter: null, sortBy: 'latest', locale });
    }

    // theme-radar, asset-intel, timeline are handled by other view modules.
    case 'theme-radar': {
      const themeData = data as ThemeIntensityResponse | null;
      return renderThemeRadarView({
        themes: themeData?.themes ?? [],
        sankeyFlow: themeData?.sankeyFlow ?? { events: [], themes: [], assets: [], links: [] },
        locale,
      });
    }

    case 'asset-intel': {
      const recData = data as RecommendationsResponse | null;
      return renderAssetIntelView({
        recommendations: recData?.recommendations ?? [],
        correlationMatrix: recData?.correlationMatrix ?? { symbols: [], correlations: [] },
        regime: recData?.regime ?? null,
        locale,
      });
    }

    case 'timeline': {
      const tlData = data as ImpactTimelineResponse | null;
      return renderTimelineView({
        events: tlData?.events ?? [],
        overlaps: tlData?.overlaps ?? [],
        scrubberSnapshots: tlData?.scrubberSnapshots ?? [],
        locale,
      });
    }

    default:
      return `<div class="intel-view-placeholder">${view}</div>`;
  }
}

/**
 * Mounts interactive charts after the view HTML has been inserted into the DOM.
 */
export function mountIntelViewCharts(
  view: IntelView,
  data: ThemeIntensityResponse | RecommendationsResponse | ImpactTimelineResponse | ScenarioResult | null,
): void {
  switch (view) {
    case 'scenario': {
      const scenarioResult = data as ScenarioResult | null;
      // Theme list can be empty when mounting without prior theme data.
      mountScenarioLabCharts(scenarioResult, []);
      break;
    }
    case 'theme-radar': {
      const themeData = data as ThemeIntensityResponse | null;
      mountThemeRadarCharts({
        themes: themeData?.themes ?? [],
        sankeyFlow: themeData?.sankeyFlow ?? { events: [], themes: [], assets: [], links: [] },
      });
      break;
    }
    case 'asset-intel': {
      mountAssetIntelCharts(data as RecommendationsResponse);
      break;
    }
    case 'timeline': {
      mountTimelineCharts(data as ImpactTimelineResponse);
      break;
    }
    default:
      break;
  }
}

/**
 * Flattens nested assetImpacts (Record<string, Record<string, number>>)
 * into a single Record<string, number> by averaging inner values.
 */
function flattenImpacts(impacts: Record<string, Record<string, number>>): Record<string, number> {
  const result: Record<string, number> = {};
  for (const [symbol, inner] of Object.entries(impacts)) {
    const vals = Object.values(inner);
    result[symbol] = vals.length > 0 ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
  }
  return result;
}
