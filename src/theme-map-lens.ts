import 'maplibre-gl/dist/maplibre-gl.css';
import './styles/main.css';

import { DeckGLMap, type CountryClickPayload, type DeckMapView, type TimeRange } from './components/DeckGLMap';
import { DEFAULT_MAP_LAYERS } from './config';
import type { MapLayers, NewsItem } from './types';
import { getCountryAtCoordinates, getCountryNameByCode } from './services/country-geometry';
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

type LensThemeFilter = 'all' | 'conflict' | 'macro' | 'tech' | 'energy' | 'climate';
type LensZoomPresetId = 'global' | 'regional' | 'country' | 'city';

type CountryEvidenceSelection = {
  lat: number;
  lon: number;
  code: string | null;
  name: string;
};

type MapLensEventMarker = {
  id: string;
  title: string;
  theme: string | null;
  lat: number;
  lon: number;
  intensity: number;
  publishedAt: string | null;
};

type MapLensE2SignalMarker = {
  id: string;
  title: string;
  theme: string | null;
  symbol: string | null;
  horizon: string | null;
  evidenceGrade: string | null;
  uplift: number | null;
  tStat: number | null;
  lat: number;
  lon: number;
  publishedAt: string | null;
};

type MapLensTransmissionArc = {
  id: string;
  title: string;
  relationType: string;
  strength: number;
  sourceLat: number;
  sourceLon: number;
  targetLat: number;
  targetLon: number;
  targetLabel: string;
};

type MapLensOverlayPayload = {
  generatedAt: string;
  eventMarkers: MapLensEventMarker[];
  e2Signals: MapLensE2SignalMarker[];
  transmissionArcs: MapLensTransmissionArc[];
};

const SIGNAL_API_PORT = '46200';

function normalizeApiBase(raw: string | null | undefined): string {
  const value = String(raw || '').trim();
  if (!value) return '';
  return value.replace(/\/+$/, '').replace(/\/api$/, '/api');
}

function resolveSignalApiBase(): string {
  if (typeof window === 'undefined') return `http://localhost:${SIGNAL_API_PORT}/api`;
  const params = new URLSearchParams(window.location.search || '');
  const explicit = normalizeApiBase(params.get('api') || window.localStorage.getItem('lattice:signal-api-base'));
  if (explicit) return explicit;
  if (window.location.protocol === 'file:') return `http://localhost:${SIGNAL_API_PORT}/api`;
  const host = window.location.hostname || 'localhost';
  const origin = window.location.origin;
  if (window.location.port === SIGNAL_API_PORT) return `${origin}/api`;
  if (host === 'localhost' || host === '127.0.0.1') return `http://${host}:${SIGNAL_API_PORT}/api`;
  return `${origin}/api`;
}

const API = resolveSignalApiBase();
const REFRESH_MS = 180_000;
const OVERLAY_COLLAPSE_KEY = 'theme-map-lens:overlay-collapsed';
const PERIOD_LABELS: Record<LensContext['period'], string> = {
  week: 'Week',
  month: 'Month',
  quarter: 'Quarter',
  year: 'Year',
};
const FILTER_PERIODS: LensContext['period'][] = ['week', 'month', 'quarter', 'year'];
const FILTER_THEME_OVERRIDES: Record<LensThemeFilter, string | null> = {
  all: null,
  conflict: 'conflict',
  macro: 'macroeconomics',
  tech: 'technology-general',
  energy: 'energy-transition',
  climate: 'climate-change',
};
const ZOOM_PRESET_ZOOMS: Record<LensZoomPresetId, number> = {
  global: 1.65,
  regional: 3.15,
  country: 4.7,
  city: 7.25,
};
const BASE_SIGNAL_LAYERS: Array<keyof MapLayers> = [
  'hotspots',
];
const RELATIONSHIP_LAYER_KEYS: Array<keyof MapLayers> = [
  'tradeRoutes',
  'waterways',
  'economic',
  'stockExchanges',
  'financialCenters',
  'centralBanks',
];
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
let activeThemeFilter: LensThemeFilter = 'all';
let activeZoomPreset: LensZoomPresetId = 'global';
let relationshipMode = false;
let localPeriodOverride: LensContext['period'] | null = null;
let overlayCollapsed = false;
let renderPausedByHost = false;
let lastOverlayPayload: MapLensOverlayPayload | null = null;
let selectedCountry: CountryEvidenceSelection | null = null;

function createEmptyLayers(): MapLayers {
  const next = { ...DEFAULT_MAP_LAYERS } as Record<string, boolean>;
  Object.keys(next).forEach((key) => { next[key] = false; });
  return next as unknown as MapLayers;
}

function createBudgetedLayers(themeLayers: Array<keyof MapLayers>): MapLayers {
  const uniqueKeys = Array.from(new Set([...BASE_SIGNAL_LAYERS, ...themeLayers]));
  return enableLayers(createEmptyLayers(), uniqueKeys.slice(0, 3));
}

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
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

function readOverlayCollapsedState(): boolean {
  try {
    return window.localStorage.getItem(OVERLAY_COLLAPSE_KEY) === '1';
  } catch {
    return false;
  }
}

function writeOverlayCollapsedState(collapsed: boolean): void {
  try {
    window.localStorage.setItem(OVERLAY_COLLAPSE_KEY, collapsed ? '1' : '0');
  } catch {
    // Ignore storage failures in embedded contexts.
  }
}

function periodToTimeRange(period: LensContext['period']): TimeRange {
  if (period === 'week') return '7d';
  if (period === 'month') return '7d';
  return 'all';
}

function getEffectivePeriod(): LensContext['period'] {
  return localPeriodOverride ?? currentContext.period;
}

function getEffectiveContext(context: LensContext): LensContext {
  const filterOverride = FILTER_THEME_OVERRIDES[activeThemeFilter];
  const theme = sanitizeToken(filterOverride || context.theme);
  return {
    ...context,
    theme: theme ? theme.toLowerCase() : null,
    period: getEffectivePeriod(),
  };
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
    description: 'Small default budget: event hotspots, E2 markers, and the strongest cross-domain context layer.',
    view: 'global',
    layers: createBudgetedLayers(['conflicts', 'economic']),
  };
}

function buildTechnologyPreset(): LensPreset {
  return {
    id: 'technology-science',
    label: 'Technology and science',
    description: 'Technology preset keeps compute geography and cyber/event signals visible without turning on relationship overlays.',
    view: 'global',
    layers: createBudgetedLayers([
      'conflicts',
      'datacenters',
    ]),
  };
}

function buildMacroPreset(): LensPreset {
  return {
    id: 'macro-investment',
    label: 'Macro and market impact',
    description: 'Macro preset prioritizes event/E2 markers with market geography; relationship arcs stay opt-in.',
    view: 'global',
    layers: createBudgetedLayers([
      'conflicts',
      'economic',
    ]),
  };
}

function buildClimatePreset(): LensPreset {
  return {
    id: 'climate-resilience',
    label: 'Climate and resilience',
    description: 'Climate preset keeps anomaly and event evidence first; infrastructure spillovers require relationship mode.',
    view: 'global',
    layers: createBudgetedLayers([
      'conflicts',
      'climate',
    ]),
  };
}

function buildGeopoliticalPreset(): LensPreset {
  return {
    id: 'geopolitics-risk',
    label: 'Geopolitics and conflict',
    description: 'Geopolitical preset emphasizes live event/E2 markers and conflict evidence; routes and country links are opt-in.',
    view: 'global',
    layers: createBudgetedLayers(['conflicts', 'ucdpEvents']),
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

function renderToolbarState(): void {
  const root = document.getElementById('lens-root');
  root?.classList.toggle('overlay-collapsed', overlayCollapsed);

  const collapseButton = document.getElementById('lens-collapse-toggle') as HTMLButtonElement | null;
  if (collapseButton) {
    collapseButton.textContent = overlayCollapsed ? 'Show' : 'Hide';
    collapseButton.classList.toggle('active', !overlayCollapsed);
    collapseButton.setAttribute('aria-expanded', String(!overlayCollapsed));
    collapseButton.setAttribute('aria-label', overlayCollapsed ? 'Expand overlay panels' : 'Collapse overlay panels');
  }

  document.querySelectorAll<HTMLButtonElement>('[data-filter]').forEach((button) => {
    const isActive = button.dataset.filter === activeThemeFilter;
    button.classList.toggle('active', isActive);
    button.setAttribute('aria-pressed', String(isActive));
  });

  const periodSlider = document.getElementById('lens-period-slider') as HTMLInputElement | null;
  const effectivePeriod = getEffectivePeriod();
  const periodIndex = FILTER_PERIODS.indexOf(effectivePeriod);
  if (periodSlider && periodIndex >= 0) {
    periodSlider.value = String(periodIndex);
  }

  const relationshipButton = document.getElementById('lens-relationship-toggle') as HTMLButtonElement | null;
  if (relationshipButton) {
    relationshipButton.classList.toggle('active', relationshipMode);
    relationshipButton.textContent = relationshipMode ? 'Relationship mode - On' : 'Relationship mode';
    relationshipButton.setAttribute('aria-pressed', String(relationshipMode));
  }

  document.querySelectorAll<HTMLButtonElement>('[data-zoom-preset]').forEach((button) => {
    const isActive = button.dataset.zoomPreset === activeZoomPreset;
    button.classList.toggle('active', isActive);
    button.setAttribute('aria-pressed', String(isActive));
  });
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

async function fetchMapLensOverlays(context: LensContext): Promise<MapLensOverlayPayload> {
  const params = new URLSearchParams();
  params.set('period', context.period);
  params.set('filter', activeThemeFilter);
  if (context.theme) {
    params.set('theme', context.theme);
  }
  const response = await fetch(`${API}/map-lens-overlays?${params.toString()}`, {
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) {
    throw new Error(`Map overlay request failed (${response.status})`);
  }
  return response.json() as Promise<MapLensOverlayPayload>;
}

function toSignalNewsItem(marker: MapLensEventMarker | MapLensE2SignalMarker): NewsItem {
  return {
    source: 'map-lens',
    title: marker.title,
    link: '',
    pubDate: marker.publishedAt ? new Date(marker.publishedAt) : new Date(),
    isAlert: true,
  };
}

function formatCoordinate(value: number, axis: 'lat' | 'lon'): string {
  if (!Number.isFinite(value)) return 'not resolved';
  const suffix = axis === 'lat'
    ? value >= 0 ? 'N' : 'S'
    : value >= 0 ? 'E' : 'W';
  return `${Math.abs(value).toFixed(2)}${suffix}`;
}

function formatCountryCoords(country: CountryEvidenceSelection): string {
  return `${formatCoordinate(country.lat, 'lat')} / ${formatCoordinate(country.lon, 'lon')}`;
}

function normalizeCountrySelection(payload: CountryClickPayload): CountryEvidenceSelection {
  const lat = Number(payload.lat);
  const lon = Number(payload.lon);
  const payloadCode = sanitizeToken(payload.code).toUpperCase();
  const validPayloadCode = /^[A-Z]{2}$/.test(payloadCode) ? payloadCode : '';
  const coordinateHit = Number.isFinite(lat) && Number.isFinite(lon)
    ? getCountryAtCoordinates(lat, lon, validPayloadCode ? [validPayloadCode] : undefined)
    : null;
  const code = validPayloadCode || sanitizeToken(coordinateHit?.code).toUpperCase();
  const validCode = /^[A-Z]{2}$/.test(code) ? code : null;
  const payloadName = sanitizeToken(payload.name);
  const derivedName = validCode ? sanitizeToken(getCountryNameByCode(validCode)) : '';
  const coordinateName = sanitizeToken(coordinateHit?.name);
  const name = payloadName
    || derivedName
    || coordinateName
    || (validCode ? `Country ${validCode}` : 'Open water / no country boundary');
  return {
    lat: Number.isFinite(lat) ? lat : 0,
    lon: Number.isFinite(lon) ? lon : 0,
    code: validCode,
    name,
  };
}

function markerMatchesCountry(country: CountryEvidenceSelection, lat: number, lon: number): boolean {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return false;
  if (!country.code) {
    return Math.abs(lat - country.lat) <= 2.5 && Math.abs(lon - country.lon) <= 2.5;
  }
  const hit = getCountryAtCoordinates(lat, lon, [country.code]) ?? getCountryAtCoordinates(lat, lon);
  return hit?.code === country.code;
}

function formatEvidenceDate(value: string | null | undefined): string {
  if (!value) return 'live window';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return 'live window';
  return date.toLocaleDateString();
}

function buildCountryEvidenceItems(country: CountryEvidenceSelection): string[] {
  const payload = lastOverlayPayload;
  if (!payload) return [];

  const e2 = payload.e2Signals
    .filter((marker) => markerMatchesCountry(country, marker.lat, marker.lon))
    .slice(0, 3)
    .map((marker) => {
      const symbol = sanitizeToken(marker.symbol) || 'E2 signal';
      const grade = sanitizeToken(marker.evidenceGrade) || 'E2';
      const uplift = Number.isFinite(Number(marker.uplift)) ? `${Number(marker.uplift).toFixed(2)}% uplift` : 'uplift pending';
      return `<div class="lens-evidence-item"><strong>${escapeHtml(grade)} - ${escapeHtml(symbol)}</strong>${escapeHtml(marker.title)}<br><span style="opacity:.72">${escapeHtml(uplift)} | ${escapeHtml(formatEvidenceDate(marker.publishedAt))}</span></div>`;
    });

  const events = payload.eventMarkers
    .filter((marker) => markerMatchesCountry(country, marker.lat, marker.lon))
    .slice(0, 3)
    .map((marker) => (
      `<div class="lens-evidence-item"><strong>Event hotspot</strong>${escapeHtml(marker.title)}<br><span style="opacity:.72">Intensity ${Number(marker.intensity || 0).toFixed(1)} | ${escapeHtml(formatEvidenceDate(marker.publishedAt))}</span></div>`
    ));

  const arcs = payload.transmissionArcs
    .filter((arc) => (
      markerMatchesCountry(country, arc.sourceLat, arc.sourceLon)
      || markerMatchesCountry(country, arc.targetLat, arc.targetLon)
      || Boolean(country.code && sanitizeToken(arc.targetLabel).toUpperCase().includes(country.code))
      || Boolean(sanitizeToken(arc.targetLabel).toLowerCase().includes(country.name.toLowerCase()))
    ))
    .slice(0, 2)
    .map((arc) => (
      `<div class="lens-evidence-item"><strong>Relationship arc</strong>${escapeHtml(arc.title || arc.targetLabel)}<br><span style="opacity:.72">${escapeHtml(arc.relationType)} | strength ${Number(arc.strength || 0).toFixed(1)}</span></div>`
    ));

  return [...e2, ...events, ...arcs];
}

function renderCountryEvidenceDrawer(country: CountryEvidenceSelection): void {
  selectedCountry = country;
  const effectiveContext = getEffectiveContext(currentContext);
  const active = activeLayerKeys(map.getState().layers);
  const items = buildCountryEvidenceItems(country);
  const generatedAt = lastOverlayPayload?.generatedAt ? new Date(lastOverlayPayload.generatedAt) : null;
  const notes = [
    country.code
      ? `${country.name} resolved from country boundary ${country.code}.`
      : 'No country boundary resolved; showing coordinate-level context instead.',
    relationshipMode
      ? 'Relationship mode is active; arcs and country-link overlays are included.'
      : 'Relationship mode is off; event hotspots and E2 markers stay primary.',
    generatedAt && Number.isFinite(generatedAt.getTime())
      ? `Overlay generated ${generatedAt.toLocaleString()}.`
      : 'Overlay generation time is not available.',
  ];

  setText('lens-country-title', country.name);
  setText('lens-country-code', country.code ?? 'not resolved');
  setText('lens-country-coords', formatCountryCoords(country));
  setText('lens-country-context', `${humanize(effectiveContext.theme || 'global')} / ${PERIOD_LABELS[effectiveContext.period]}`);
  setText('lens-country-layers', `${active.length} active`);
  setHtml('lens-country-notes', notes.map((note) => `<li>${escapeHtml(note)}</li>`).join(''));
  setHtml(
    'lens-country-evidence',
    items.length ? items.join('') : '<div class="lens-empty">No matched E2/event evidence in the current theme and period.</div>',
  );

  const drawer = document.getElementById('lens-country-drawer');
  drawer?.classList.add('open');
  drawer?.setAttribute('aria-hidden', 'false');
}

function closeCountryEvidenceDrawer(): void {
  selectedCountry = null;
  map.clearCountryHighlight();
  const drawer = document.getElementById('lens-country-drawer');
  drawer?.classList.remove('open');
  drawer?.setAttribute('aria-hidden', 'true');
}

function applyZoomPreset(preset: LensZoomPresetId): void {
  activeZoomPreset = preset;
  const focus = selectedCountry ?? map.getCenter() ?? { lat: 20, lon: 0 };
  if (preset === 'global') {
    map.setView('global');
  } else {
    map.setCenter(focus.lat, focus.lon, ZOOM_PRESET_ZOOMS[preset]);
  }
  renderToolbarState();
  const target = preset === 'country' && !selectedCountry
    ? 'Country preset is centered on the current viewport until a country is selected.'
    : `${humanize(preset)} zoom preset is active.`;
  setText('lens-notes', `${target} Relationship overlays remain ${relationshipMode ? 'visible' : 'opt-in'}.`);
}

async function refreshDynamicData(): Promise<void> {
  if (renderPausedByHost) return;
  const effectiveContext = getEffectiveContext(currentContext);
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
      const items = await fetchHotspotActivity(effectiveContext.theme);
      map.updateHotspotActivity(items);
    }));
  }

  tasks.push(record('signal-map', 'Event hotspots and E2 markers', async () => {
    const overlays = await fetchMapLensOverlays(effectiveContext);
    lastOverlayPayload = overlays;
    const signalMarkers = [
      ...overlays.eventMarkers.map((marker) => ({
        id: marker.id,
        kind: 'hotspot' as const,
        title: marker.title,
        theme: marker.theme,
        lat: marker.lat,
        lon: marker.lon,
        intensity: marker.intensity,
        evidenceGrade: null,
        uplift: null,
        symbol: null,
        timestamp: marker.publishedAt,
      })),
      ...overlays.e2Signals.map((marker) => ({
        id: marker.id,
        kind: 'e2' as const,
        title: marker.title,
        theme: marker.theme,
        lat: marker.lat,
        lon: marker.lon,
        intensity: Math.max(1, Math.abs(Number(marker.uplift || 0)) * 12 + Math.abs(Number(marker.tStat || 0)) * 2),
        evidenceGrade: marker.evidenceGrade,
        uplift: marker.uplift,
        symbol: marker.symbol,
        timestamp: marker.publishedAt,
      })),
    ];
    const newsLocations = [
      ...overlays.eventMarkers.map((marker) => ({
        lat: marker.lat,
        lon: marker.lon,
        title: marker.title,
        threatLevel: marker.intensity >= 18 ? 'critical' : marker.intensity >= 10 ? 'high' : 'medium',
        timestamp: marker.publishedAt ? new Date(marker.publishedAt) : new Date(),
      })),
      ...overlays.e2Signals.map((marker) => ({
        lat: marker.lat,
        lon: marker.lon,
        title: `${marker.symbol || 'E2'} - ${marker.title}`,
        threatLevel: 'critical',
        timestamp: marker.publishedAt ? new Date(marker.publishedAt) : new Date(),
      })),
    ];
    map.setSignalMarkers(signalMarkers);
    map.setTransmissionOverlayArcs(overlays.transmissionArcs);
    map.setNewsLocations(newsLocations);
    map.updateHotspotActivity([
      ...overlays.eventMarkers.map((marker) => toSignalNewsItem(marker)),
      ...overlays.e2Signals.map((marker) => toSignalNewsItem(marker)),
    ]);
  }));

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
  if (selectedCountry) {
    renderCountryEvidenceDrawer(selectedCountry);
  }
  if (renderPausedByHost) return;
  map.render();
}

function applyContext(context: LensContext): void {
  currentContext = context;
  const effectiveContext = getEffectiveContext(context);
  currentPreset = resolvePreset(effectiveContext.theme, effectiveContext.evolutionParent);
  const nextLayers = { ...currentPreset.layers };
  if (relationshipMode) {
    for (const key of RELATIONSHIP_LAYER_KEYS) {
      nextLayers[key] = true;
    }
  }
  map.setLayers(nextLayers);
  map.setView(currentPreset.view);
  map.setTimeRange(periodToTimeRange(effectiveContext.period));
  map.setRelationshipMode(relationshipMode);
  renderPresetMeta(currentPreset, effectiveContext, nextLayers);
  if (selectedCountry) {
    renderCountryEvidenceDrawer(selectedCountry);
  }
  renderToolbarState();
  if (renderPausedByHost) return;
  map.render();
  void refreshDynamicData();
}

function installBridge(): void {
  window.addEventListener('message', (event) => {
    if (event.origin !== window.location.origin) return;
    const message = event.data as { source?: string; type?: string; payload?: unknown } | null;
    if (!message || message.source !== 'theme-workspace') return;
    if (message.type === 'wm-map-lens-context') {
      applyContext(normalizeContext(message.payload));
      return;
    }
    if (message.type === 'wm-map-lens-visibility') {
      const payload = message.payload as { paused?: unknown } | null;
      const nextPaused = Boolean(payload?.paused);
      const changed = renderPausedByHost !== nextPaused;
      renderPausedByHost = nextPaused;
      map.setRenderPaused(nextPaused);
      if (!nextPaused && changed) {
        applyContext(currentContext);
      }
    }
  });

  if (window.parent !== window) {
    window.parent.postMessage({ source: 'map-lens', type: 'wm-map-lens-ready' }, window.location.origin);
  }
}

function installControls(): void {
  overlayCollapsed = readOverlayCollapsedState();

  const collapseButton = document.getElementById('lens-collapse-toggle');
  collapseButton?.addEventListener('click', () => {
    overlayCollapsed = !overlayCollapsed;
    writeOverlayCollapsedState(overlayCollapsed);
    renderToolbarState();
  });

  document.querySelectorAll<HTMLButtonElement>('[data-filter]').forEach((button) => {
    button.addEventListener('click', () => {
      const nextFilter = String(button.dataset.filter || 'all') as LensThemeFilter;
      activeThemeFilter = nextFilter in FILTER_THEME_OVERRIDES ? nextFilter : 'all';
      applyContext(currentContext);
    });
  });

  document.querySelectorAll<HTMLButtonElement>('[data-zoom-preset]').forEach((button) => {
    button.addEventListener('click', () => {
      const nextPreset = String(button.dataset.zoomPreset || 'global') as LensZoomPresetId;
      applyZoomPreset(nextPreset in ZOOM_PRESET_ZOOMS ? nextPreset : 'global');
    });
  });

  const periodSlider = document.getElementById('lens-period-slider') as HTMLInputElement | null;
  periodSlider?.addEventListener('input', () => {
    const index = Math.max(0, Math.min(FILTER_PERIODS.length - 1, Number(periodSlider.value) || 0));
    localPeriodOverride = FILTER_PERIODS[index] ?? currentContext.period;
    applyContext(currentContext);
  });

  const relationshipButton = document.getElementById('lens-relationship-toggle');
  relationshipButton?.addEventListener('click', () => {
    relationshipMode = !relationshipMode;
    applyContext(currentContext);
  });

  document.getElementById('lens-country-close')?.addEventListener('click', () => {
    closeCountryEvidenceDrawer();
  });

  renderToolbarState();
}

function installMapObservers(): void {
  map.setOnLayerChange(() => {
    renderPresetMeta(currentPreset, getEffectiveContext(currentContext), map.getState().layers);
  });
  map.setOnStateChange((state) => {
    const view = humanize(state.view);
    const relationshipCopy = relationshipMode ? 'Relationship mode is active, so transmission and country-link arcs are emphasized.' : 'Switch relationship mode on to emphasize transmission and country-link arcs.';
    setText('lens-notes', `The 3D globe is intentionally removed here. Current view is ${view}. ${relationshipCopy}`);
  });
  map.setOnCountryClick((payload) => {
    const country = normalizeCountrySelection(payload);
    renderCountryEvidenceDrawer(country);
    if (country.code) {
      map.highlightCountry(country.code);
    } else {
      map.clearCountryHighlight();
    }
    if (activeZoomPreset === 'country' || activeZoomPreset === 'city') {
      map.setCenter(country.lat, country.lon, ZOOM_PRESET_ZOOMS[activeZoomPreset]);
    }
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
installControls();
installMapObservers();
applyContext({ ...EMPTY_CONTEXT });
scheduleRefresh();
