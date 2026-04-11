import 'maplibre-gl/dist/maplibre-gl.css';
import './styles/main.css';

import { DeckGLMap, type DeckMapView, type TimeRange } from './components/DeckGLMap';
import { DEFAULT_MAP_LAYERS } from './config';
import type { MapLayers, NewsItem } from './types';
import { fetchEarthquakes } from './services/earthquakes';
import { fetchWeatherAlerts } from './services/weather';
import { fetchInternetOutages, isOutagesConfigured } from './services/infrastructure';
import { fetchCyberThreats } from './services/cyber';
import { fetchAisSignals } from './services/maritime';
import { fetchCableActivity } from './services/cable-activity';
import { fetchProtestEvents } from './services/unrest';
import { fetchFlightDelays } from './services/aviation';
import { fetchMilitaryFlights } from './services/military-flights';
import { fetchMilitaryVessels } from './services/military-vessels';
import { fetchNaturalEvents } from './services/eonet';
import { fetchAllFires, flattenFires, toMapFires } from './services/wildfires';
import { fetchUcdpEvents, fetchIranEvents } from './services/conflict';
import { fetchClimateAnomalies } from './services/climate';
import { fetchGpsInterference } from './services/gps-interference';

type LensContext = {
  theme: string | null;
  period: 'week' | 'month' | 'quarter' | 'year';
  evolutionParent: string | null;
  followedThemes: string[];
};

type LensPreset = {
  id: string;
  label: string;
  description: string;
  view: DeckMapView;
  layers: MapLayers;
};

type SourceStatus = {
  key: string;
  label: string;
  status: 'live' | 'stale' | 'offline';
  detail: string;
};

const API = 'http://localhost:46200/api';
const REFRESH_MS = 180_000;
const PERIOD_LABELS: Record<LensContext['period'], string> = {
  week: 'Week',
  month: 'Month',
  quarter: 'Quarter',
  year: 'Year',
};
const EMPTY_CONTEXT: LensContext = {
  theme: null,
  period: 'quarter',
  evolutionParent: null,
  followedThemes: [],
};

const mapHost = document.getElementById('lens-map');
if (!(mapHost instanceof HTMLElement)) {
  throw new Error('Missing #lens-map host');
}

const map = new DeckGLMap(
  mapHost,
  {
    zoom: 2.3,
    pan: { x: 0, y: 0 },
    view: 'global',
    layers: createEmptyLayers(),
    timeRange: 'all',
  },
  {
    disableProjectionToggle: true,
    initialProjectionMode: 'mercator',
    lockProjectionMode: 'mercator',
  },
);

let currentContext: LensContext = { ...EMPTY_CONTEXT };
let currentPreset = buildCrossDomainPreset();
let refreshHandle: number | null = null;

function createEmptyLayers(): MapLayers {
  const next = { ...DEFAULT_MAP_LAYERS } as Record<string, boolean>;
  Object.keys(next).forEach((key) => { next[key] = false; });
  return next as unknown as MapLayers;
}

function humanize(value: string | null | undefined): string {
  const normalized = String(value || '')
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase())
    .trim();
  return normalized || 'Unknown';
}

function sanitizeToken(value: unknown): string {
  const normalized = String(value ?? '').trim();
  if (!normalized) return '';
  const lowered = normalized.toLowerCase();
  if (lowered === 'undefined' || lowered === 'null' || lowered === 'unknown' || lowered === 'n/a') {
    return '';
  }
  return normalized;
}

function periodToTimeRange(period: LensContext['period']): TimeRange {
  if (period === 'week') return '7d';
  if (period === 'month') return '7d';
  return 'all';
}

function enableLayers(base: MapLayers, keys: Array<keyof MapLayers>): MapLayers {
  const next = { ...base };
  for (const key of keys) {
    next[key] = true;
  }
  return next;
}

function activeLayerKeys(layers: MapLayers): Array<keyof MapLayers> {
  return Object.entries(layers)
    .filter(([, enabled]) => Boolean(enabled))
    .map(([key]) => key as keyof MapLayers);
}

function themeMatches(theme: string, candidates: string[]): boolean {
  return candidates.some((candidate) => theme.includes(candidate));
}

function buildCrossDomainPreset(): LensPreset {
  return {
    id: 'cross-domain',
    label: 'Cross-domain risk',
    description: 'Balanced preset across geopolitical, infrastructure, macro, and technology layers.',
    view: 'global',
    layers: enableLayers(createEmptyLayers(), [
      'conflicts',
      'hotspots',
      'cables',
      'pipelines',
      'waterways',
      'outages',
      'cyberThreats',
      'protests',
      'military',
      'natural',
      'ucdpEvents',
      'climate',
      'economic',
      'tradeRoutes',
      'datacenters',
      'gpsJamming',
    ]),
  };
}

function buildTechnologyPreset(): LensPreset {
  return {
    id: 'technology-science',
    label: 'Technology and science',
    description: 'Hardware, compute, network, research geography, and global risk overlays without globe mode.',
    view: 'global',
    layers: enableLayers(createEmptyLayers(), [
      'conflicts',
      'datacenters',
      'startupHubs',
      'cloudRegions',
      'accelerators',
      'techHQs',
      'cables',
      'outages',
      'cyberThreats',
      'minerals',
      'spaceports',
      'hotspots',
    ]),
  };
}

function buildMacroPreset(): LensPreset {
  return {
    id: 'macro-investment',
    label: 'Macro and market impact',
    description: 'Country, infrastructure, and conflict context for market stress, trade, liquidity, and exposure.',
    view: 'global',
    layers: enableLayers(createEmptyLayers(), [
      'conflicts',
      'economic',
      'stockExchanges',
      'financialCenters',
      'centralBanks',
      'commodityHubs',
      'waterways',
      'tradeRoutes',
      'cables',
      'outages',
      'hotspots',
      'datacenters',
    ]),
  };
}

function buildClimatePreset(): LensPreset {
  return {
    id: 'climate-resilience',
    label: 'Climate and resilience',
    description: 'Climate anomalies, natural events, fires, chokepoints, and geopolitical risk spillovers.',
    view: 'global',
    layers: enableLayers(createEmptyLayers(), [
      'conflicts',
      'climate',
      'natural',
      'fires',
      'weather',
      'waterways',
      'outages',
      'cables',
      'renewableInstallations',
      'hotspots',
    ]),
  };
}

function buildGeopoliticalPreset(): LensPreset {
  return {
    id: 'geopolitics-risk',
    label: 'Geopolitics and conflict',
    description: 'Conflict zones, force posture, infrastructure risk, population stress, and border spillovers.',
    view: 'global',
    layers: enableLayers(createEmptyLayers(), [
      'conflicts',
      'bases',
      'cables',
      'pipelines',
      'hotspots',
      'outages',
      'cyberThreats',
      'protests',
      'military',
      'natural',
      'ucdpEvents',
      'displacement',
      'climate',
      'tradeRoutes',
      'iranAttacks',
      'gpsJamming',
    ]),
  };
}

function resolvePreset(theme: string | null, evolutionParent: string | null): LensPreset {
  const themeKey = sanitizeToken(theme).toLowerCase();
  const evolutionKey = sanitizeToken(evolutionParent).toLowerCase();
  const normalized = themeKey || evolutionKey;
  if (!normalized) return buildCrossDomainPreset();
  if (themeMatches(normalized, ['quantum', 'ai', 'robotics', 'autonomous', 'semiconductor', 'cloud', 'cyber', 'biotech', 'materials', 'science', 'space'])) {
    return buildTechnologyPreset();
  }
  if (themeMatches(normalized, ['inflation', 'macroe', 'fiscal', 'rates', 'liquidity', 'trade', 'commodity', 'energy transition', 'supply-chain', 'supply chain'])) {
    return buildMacroPreset();
  }
  if (themeMatches(normalized, ['climate', 'environment', 'water', 'agriculture', 'food', 'renewable', 'wildfire', 'heat'])) {
    return buildClimatePreset();
  }
  if (themeMatches(normalized, ['conflict', 'migration', 'diplomacy', 'defense', 'war', 'security', 'sanction', 'iran', 'ukraine', 'middle east'])) {
    return buildGeopoliticalPreset();
  }
  return buildCrossDomainPreset();
}

function formatFollowedThemes(themes: string[]): string {
  if (!themes.length) return 'Followed themes from the briefing surface appear here for quick context.';
  if (themes.length === 1) return `Watching ${humanize(themes[0])}.`;
  return `Watching ${themes.length} followed themes from the current briefing context.`;
}

function setText(id: string, value: string): void {
  const element = document.getElementById(id);
  if (element) {
    element.textContent = value;
  }
}

function setHtml(id: string, value: string): void {
  const element = document.getElementById(id);
  if (element) {
    element.innerHTML = value;
  }
}

function renderPresetMeta(preset: LensPreset, context: LensContext, layers: MapLayers): void {
  const active = activeLayerKeys(layers);
  const activeTheme = sanitizeToken(context.theme);
  const evolutionFocus = sanitizeToken(context.evolutionParent);
  setText('lens-title', activeTheme ? `${humanize(activeTheme)} lens` : evolutionFocus ? `${humanize(evolutionFocus)} lens` : 'Global signal lens');
  setText('lens-theme', activeTheme ? humanize(activeTheme) : evolutionFocus ? `${humanize(evolutionFocus)} focus` : 'Global');
  setText('lens-period', PERIOD_LABELS[context.period]);
  setText('lens-preset', preset.label);
  setText('lens-layer-count', `${active.length} active`);
  setText('lens-copy', preset.description);
  setText('lens-context-copy', evolutionFocus ? `${formatFollowedThemes(context.followedThemes)} Evolution focus: ${humanize(evolutionFocus)}.` : formatFollowedThemes(context.followedThemes));
  setHtml(
    'lens-active-layers',
      active.length
      ? active.map((key) => `<span class="lens-pill">${humanize(String(key))}</span>`).join('')
      : '<span class="lens-empty">No active layers</span>',
  );
  setHtml(
    'lens-followed-themes',
    context.followedThemes.length
      ? context.followedThemes.slice(0, 8).map((theme) => `<span class="lens-theme-chip">${humanize(theme)}</span>`).join('')
      : '<span class="lens-empty">No followed themes selected.</span>',
  );
}

function renderSourceStatuses(statuses: SourceStatus[]): void {
  if (!statuses.length) {
    setHtml('lens-sources', '<div class="lens-empty">No live data sources are active for the current preset.</div>');
    setText('lens-health', 'Preset only');
    document.getElementById('lens-health')?.setAttribute('class', 'lens-badge stale');
    setText('lens-status-line', 'The current lens is showing static strategic layers only.');
    return;
  }

  const offline = statuses.filter((item) => item.status === 'offline').length;
  const stale = statuses.filter((item) => item.status === 'stale').length;
  const healthLabel = offline > 0 ? 'Partial' : stale > 0 ? 'Mixed' : 'Live';
  const healthClass = offline > 0 ? 'offline' : stale > 0 ? 'stale' : 'live';

  const html = statuses.map((item) => (
    `<div class="lens-stat">`
      + `<div class="lens-row"><strong>${item.label}</strong><span class="lens-badge ${item.status}">${humanize(item.status)}</span></div>`
      + `<div class="lens-copy" style="margin-top:8px">${item.detail}</div>`
      + `</div>`
  )).join('');

  setHtml('lens-sources', html);
  const health = document.getElementById('lens-health');
  if (health) {
    health.textContent = healthLabel;
    health.className = `lens-badge ${healthClass}`;
  }
  setText('lens-status-line', `${statuses.length} dynamic source lanes evaluated. Offline ${offline}, stale ${stale}.`);
}

function mapPeriod(period: string | null | undefined): LensContext['period'] {
  const normalized = String(period || '').trim().toLowerCase();
  if (normalized === 'week' || normalized === 'month' || normalized === 'quarter' || normalized === 'year') {
    return normalized;
  }
  return 'quarter';
}

function normalizeContext(payload: unknown): LensContext {
  if (!payload || typeof payload !== 'object') return { ...EMPTY_CONTEXT };
  const raw = payload as Record<string, unknown>;
  const followed = Array.isArray(raw.followedThemes)
    ? raw.followedThemes.map((entry) => sanitizeToken(entry).toLowerCase()).filter(Boolean)
    : [];
  const theme = sanitizeToken(raw.theme);
  const evolutionParent = sanitizeToken(raw.evolutionParent);
  return {
    theme: theme ? theme.toLowerCase() : null,
    period: mapPeriod(typeof raw.period === 'string' ? raw.period : null),
    evolutionParent: evolutionParent ? evolutionParent.toLowerCase() : null,
    followedThemes: Array.from(new Set(followed)).slice(0, 20),
  };
}

async function fetchHotspotActivity(theme: string | null): Promise<NewsItem[]> {
  const response = await fetch(`${API}/today`, { signal: AbortSignal.timeout(20_000) });
  if (!response.ok) return [];
  const payload = await response.json() as { events?: Array<{ title?: string; source?: string; publishedAt?: string; theme?: string }> };
  const themeKey = String(theme || '').trim().toLowerCase();
  return (Array.isArray(payload.events) ? payload.events : [])
    .filter((item) => !themeKey || String(item.theme || '').trim().toLowerCase() === themeKey)
    .slice(0, 20)
    .map((item) => ({
      source: String(item.source || 'theme-dashboard'),
      title: String(item.title || 'Event'),
      link: '',
      pubDate: item.publishedAt ? new Date(item.publishedAt) : new Date(),
      isAlert: true,
    }));
}

async function refreshDynamicData(): Promise<void> {
  const layers = map.getState().layers;
  const statuses: SourceStatus[] = [];

  const record = async (key: string, label: string, job: () => Promise<void>): Promise<void> => {
    try {
      await job();
      statuses.push({ key, label, status: 'live', detail: 'Updated in the current lens refresh cycle.' });
    } catch (error) {
      statuses.push({ key, label, status: 'offline', detail: String(error instanceof Error ? error.message : error || 'Unavailable') });
    }
  };

  const tasks: Promise<void>[] = [];

  if (layers.hotspots) {
    tasks.push(record('hotspots', 'Headline hotspots', async () => {
      const items = await fetchHotspotActivity(currentContext.theme);
      map.updateHotspotActivity(items);
    }));
  }

  if (layers.natural) {
    tasks.push(record('earthquakes', 'Earthquakes', async () => {
      map.setEarthquakes(await fetchEarthquakes());
    }));
    tasks.push(record('natural-events', 'Natural events', async () => {
      map.setNaturalEvents(await fetchNaturalEvents());
    }));
  }

  if (layers.weather) {
    tasks.push(record('weather', 'Weather alerts', async () => {
      map.setWeatherAlerts(await fetchWeatherAlerts());
    }));
  }

  if (layers.outages && isOutagesConfigured() !== false) {
    tasks.push(record('outages', 'Internet outages', async () => {
      map.setOutages(await fetchInternetOutages());
    }));
  }

  if (layers.cyberThreats) {
    tasks.push(record('cyber', 'Cyber threats', async () => {
      map.setCyberThreats(await fetchCyberThreats({ limit: 100, days: 14 }));
    }));
  }

  if (layers.ais) {
    tasks.push(record('ais', 'AIS disruption overlays', async () => {
      const ais = await fetchAisSignals();
      map.setAisData(ais.disruptions, ais.density);
    }));
  }

  if (layers.cables) {
    tasks.push(record('cables', 'Cable advisories', async () => {
      const activity = await fetchCableActivity();
      map.setCableActivity(activity.advisories, activity.repairShips);
    }));
  }

  if (layers.protests) {
    tasks.push(record('protests', 'Unrest events', async () => {
      const protestData = await fetchProtestEvents();
      map.setProtests(protestData.events);
    }));
  }

  if (layers.flights) {
    tasks.push(record('flights', 'Flight delays', async () => {
      map.setFlightDelays(await fetchFlightDelays());
    }));
  }

  if (layers.military) {
    tasks.push(record('military-flights', 'Military flights', async () => {
      const flights = await fetchMilitaryFlights();
      map.setMilitaryFlights(flights.flights, flights.clusters);
    }));
    tasks.push(record('military-vessels', 'Military vessels', async () => {
      const vessels = await fetchMilitaryVessels();
      map.setMilitaryVessels(vessels.vessels, vessels.clusters);
    }));
  }

  if (layers.fires) {
    tasks.push(record('fires', 'Wildfire detections', async () => {
      const firePayload = await fetchAllFires(1);
      const flattened = flattenFires(firePayload.regions || {});
      map.setFires(toMapFires(flattened));
    }));
  }

  if (layers.ucdpEvents) {
    tasks.push(record('ucdp', 'Conflict event feed', async () => {
      const ucdp = await fetchUcdpEvents();
      map.setUcdpEvents(ucdp.data || []);
    }));
  }

  if (layers.iranAttacks) {
    tasks.push(record('iran', 'Iran regional incidents', async () => {
      map.setIranEvents(await fetchIranEvents());
    }));
  }

  if (layers.climate) {
    tasks.push(record('climate', 'Climate anomalies', async () => {
      const anomalies = await fetchClimateAnomalies();
      map.setClimateAnomalies(anomalies.anomalies || []);
    }));
  }

  if (layers.gpsJamming) {
    tasks.push(record('gps-jamming', 'GPS interference', async () => {
      const payload = await fetchGpsInterference();
      map.setGpsJamming(payload?.hexes || []);
    }));
  }

  await Promise.all(tasks);
  renderSourceStatuses(statuses);
  map.render();
}

function applyContext(context: LensContext): void {
  currentContext = context;
  currentPreset = resolvePreset(context.theme, context.evolutionParent);
  map.setLayers(currentPreset.layers);
  map.setView(currentPreset.view);
  map.setTimeRange(periodToTimeRange(context.period));
  renderPresetMeta(currentPreset, currentContext, currentPreset.layers);
  map.render();
  void refreshDynamicData();
}

function installBridge(): void {
  window.addEventListener('message', (event) => {
    if (event.origin !== window.location.origin) return;
    const message = event.data as { source?: string; type?: string; payload?: unknown } | null;
    if (!message || message.source !== 'theme-workspace' || message.type !== 'wm-map-lens-context') return;
    applyContext(normalizeContext(message.payload));
  });

  if (window.parent !== window) {
    window.parent.postMessage({ source: 'map-lens', type: 'wm-map-lens-ready' }, window.location.origin);
  }
}

function installMapObservers(): void {
  map.setOnLayerChange(() => {
    renderPresetMeta(currentPreset, currentContext, map.getState().layers);
  });
  map.setOnStateChange((state) => {
    const view = humanize(state.view);
    setText('lens-notes', `The 3D globe is intentionally removed here. Current view is ${view}, and the embedded controls remain available for manual layer toggles.`);
  });
}

function scheduleRefresh(): void {
  if (refreshHandle != null) {
    window.clearInterval(refreshHandle);
  }
  refreshHandle = window.setInterval(() => {
    void refreshDynamicData();
  }, REFRESH_MS);
}

installBridge();
installMapObservers();
applyContext({ ...EMPTY_CONTEXT });
scheduleRefresh();
