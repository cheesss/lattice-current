/**
 * DeckGLMap - WebGL-accelerated map visualization for desktop
 * Uses deck.gl for high-performance rendering of large datasets
 * Mobile devices gracefully degrade to the D3/SVG-based Map component
 */
import { MapboxOverlay } from '@deck.gl/mapbox';
import type { Layer, LayersList, PickingInfo } from '@deck.gl/core';
import { GeoJsonLayer, ScatterplotLayer, PathLayer, IconLayer, TextLayer } from '@deck.gl/layers';
import { H3HexagonLayer } from '@deck.gl/geo-layers';
import { cellToLatLng, latLngToCell } from 'h3-js';
import maplibregl from 'maplibre-gl';
import Supercluster from 'supercluster';
import type {
  MapLayers,
  Hotspot,
  ConflictZone,
  NewsItem,
  InternetOutage,
  RelatedAsset,
  AssetType,
  AisDisruptionEvent,
  AisDensityZone,
  CableAdvisory,
  RepairShip,
  SocialUnrestEvent,
  AIDataCenter,
  MilitaryFlight,
  MilitaryVessel,
  MilitaryFlightCluster,
  MilitaryVesselCluster,
  NaturalEvent,
  UcdpGeoEvent,
  MapProtestCluster,
  MapTechHQCluster,
  MapTechEventCluster,
  MapDatacenterCluster,
  CyberThreat,
  CableHealthRecord,
  MilitaryBaseEnriched,
} from '@/types';
import type { AirportDelayAlert, PositionSample } from '@/services/aviation';
import type { DisplacementFlow } from '@/services/displacement';
import type { Earthquake } from '@/services/earthquakes';
import type { ClimateAnomaly } from '@/services/climate';
import type { IranEvent } from '@/services/conflict';
import type { GpsJamHex } from '@/services/gps-interference';
import { ArcLayer } from '@deck.gl/layers';
import { HeatmapLayer } from '@deck.gl/aggregation-layers';
import type { WeatherAlert } from '@/services/weather';
import { escapeHtml } from '@/utils/sanitize';
import { t } from '@/services/i18n';
import { debounce, rafSchedule, getCurrentTheme } from '@/utils/index';
import { listSourceOpsEvents, type SourceOpsEvent } from '@/services/source-ops-log';
import { listNetworkDiscoveryCaptures } from '@/services/network-discovery';
import {
  INTEL_HOTSPOTS,
  CONFLICT_ZONES,
  MILITARY_BASES,
  UNDERSEA_CABLES,
  NUCLEAR_FACILITIES,
  GAMMA_IRRADIATORS,
  PIPELINES,
  PIPELINE_COLORS,
  STRATEGIC_WATERWAYS,
  ECONOMIC_CENTERS,
  AI_DATA_CENTERS,
  SITE_VARIANT,
  STARTUP_HUBS,
  ACCELERATORS,
  TECH_HQS,
  CLOUD_REGIONS,
  PORTS,
  SPACEPORTS,
  APT_GROUPS,
  CRITICAL_MINERALS,
  STOCK_EXCHANGES,
  FINANCIAL_CENTERS,
  CENTRAL_BANKS,
  COMMODITY_HUBS,
  GULF_INVESTMENTS,
} from '@/config';
import type { GulfInvestment } from '@/types';
import { resolveTradeRouteSegments, TRADE_ROUTES as TRADE_ROUTES_LIST, type TradeRouteSegment } from '@/config/trade-routes';
import { MapPopup, type PopupType } from './MapPopup';
import {
  updateHotspotEscalation,
  getHotspotEscalation,
  setMilitaryData,
  setCIIGetter,
  setGeoAlertGetter,
} from '@/services/hotspot-escalation';
import { getCountryScore } from '@/services/country-instability';
import { getAlertsNearLocation } from '@/services/geo-convergence';
import type { PositiveGeoEvent } from '@/services/positive-events-geo';
import type { KindnessPoint } from '@/services/kindness-data';
import type { HappinessData } from '@/services/happiness-data';
import type { RenewableInstallation } from '@/services/renewable-installations';
import type { SpeciesRecovery } from '@/services/conservation-data';
import {
  getCountriesGeoJson,
  getCountryCentroid,
  getCountryNameByCode,
  getCountryAtCoordinates,
  ME_STRIKE_BOUNDS,
  matchCountryNamesInText,
} from '@/services/country-geometry';
import type { FeatureCollection, Geometry } from 'geojson';

export type TimeRange = '1h' | '6h' | '24h' | '48h' | '7d' | 'all';
export type DeckMapView = 'global' | 'america' | 'mena' | 'eu' | 'asia' | 'latam' | 'africa' | 'oceania';
type MapInteractionMode = 'flat' | '3d';
type MapProjectionMode = 'mercator' | 'globe';
type MapLodLevel = 'global' | 'regional' | 'local';

export interface CountryClickPayload {
  lat: number;
  lon: number;
  code?: string;
  name?: string;
}

interface DeckMapState {
  zoom: number;
  pan: { x: number; y: number };
  view: DeckMapView;
  layers: MapLayers;
  timeRange: TimeRange;
}

interface HotspotWithBreaking extends Hotspot {
  hasBreaking?: boolean;
}

interface TechEventMarker {
  id: string;
  title: string;
  location: string;
  lat: number;
  lng: number;
  country: string;
  startDate: string;
  endDate: string;
  url: string | null;
  daysUntil: number;
}

interface CountryInteractionArc {
  id: string;
  sourceCode: string;
  sourceName: string;
  sourceLon: number;
  sourceLat: number;
  targetCode: string;
  targetName: string;
  targetLon: number;
  targetLat: number;
  score: number;
  normalized: number;
  mentionCount: number;
  criticalCount: number;
  lastSeenTs: number;
  sampleTitle?: string;
}

interface CountryInteractionNode {
  id: string;
  code: string;
  name: string;
  lon: number;
  lat: number;
  score: number;
  normalized: number;
  mentionCount: number;
  criticalCount: number;
  lastSeenTs: number;
}

interface ConflictZoneLabelDatum {
  id: string;
  name: string;
  lon: number;
  lat: number;
  intensity: 'high' | 'medium' | 'low';
  tag: string;
}

interface RiskSurfacePoint {
  id: string;
  lon: number;
  lat: number;
  weight: number;
  confidence: number;
  sourceKind: 'news' | 'conflict' | 'maritime' | 'military' | 'cyber' | 'outage' | 'protest';
}

interface IntelDensityH3BreakdownEntry {
  sourceKind: RiskSurfacePoint['sourceKind'];
  count: number;
  weight: number;
}

interface IntelDensityH3Cell {
  id: string;
  hexagon: string;
  resolution: number;
  centerLon: number;
  centerLat: number;
  pointCount: number;
  totalWeight: number;
  averageConfidence: number;
  dominantSourceKind: RiskSurfacePoint['sourceKind'];
  breakdown: IntelDensityH3BreakdownEntry[];
}

interface GlowMarkerDatum {
  id: string;
  position: [number, number, number];
  color: [number, number, number, number];
  radius: number;
}

interface ArHudPayload {
  title: string;
  tone: 'alert' | 'cyber' | 'intel' | 'market';
  lines: string[];
}

// View presets with longitude, latitude, zoom
const VIEW_PRESETS: Record<DeckMapView, { longitude: number; latitude: number; zoom: number }> = {
  global: { longitude: 0, latitude: 20, zoom: 1.5 },
  america: { longitude: -95, latitude: 38, zoom: 3 },
  mena: { longitude: 45, latitude: 28, zoom: 3.5 },
  eu: { longitude: 15, latitude: 50, zoom: 3.5 },
  asia: { longitude: 105, latitude: 35, zoom: 3 },
  latam: { longitude: -60, latitude: -15, zoom: 3 },
  africa: { longitude: 20, latitude: 5, zoom: 3 },
  oceania: { longitude: 135, latitude: -25, zoom: 3.5 },
};

const MAP_INTERACTION_MODE: MapInteractionMode =
  import.meta.env.VITE_MAP_INTERACTION_MODE === 'flat' ? 'flat' : '3d';
const DEFAULT_MAP_PROJECTION: MapProjectionMode =
  import.meta.env.VITE_MAP_PROJECTION === 'mercator' ? 'mercator' : 'globe';
const MILITARY_FLIGHT_MARKER_LIMIT_BASE = Number.isFinite(Number(import.meta.env.VITE_MILITARY_FLIGHTS_MAX_MARKERS))
  ? Math.max(30, Number(import.meta.env.VITE_MILITARY_FLIGHTS_MAX_MARKERS))
  : 140;

// Theme-aware basemap vector style URLs (English labels, no local scripts)
// Happy variant uses self-hosted warm styles; default uses CARTO CDN
const DARK_STYLE = SITE_VARIANT === 'happy'
  ? '/map-styles/happy-dark.json'
  : 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json';
const LIGHT_STYLE = SITE_VARIANT === 'happy'
  ? '/map-styles/happy-light.json'
  : 'https://basemaps.cartocdn.com/gl/voyager-gl-style/style.json';

// Zoom thresholds for layer visibility and labels (matches old Map.ts)
// Zoom-dependent layer visibility and labels
const LAYER_ZOOM_THRESHOLDS: Partial<Record<keyof MapLayers, { minZoom: number; showLabels?: number }>> = {
  bases: { minZoom: 3, showLabels: 5 },
  nuclear: { minZoom: 3 },
  conflicts: { minZoom: 1, showLabels: 3 },
  economic: { minZoom: 3 },
  natural: { minZoom: 1, showLabels: 2 },
  datacenters: { minZoom: 5 },
  irradiators: { minZoom: 4 },
  spaceports: { minZoom: 3 },
  gulfInvestments: { minZoom: 2, showLabels: 5 },
};
// Export for external use
export { LAYER_ZOOM_THRESHOLDS };

const COUNTRY_TEXT_ALIAS_PATTERNS: Array<{ code: string; regex: RegExp }> = [
  { code: 'US', regex: /\bU\.?\s*S\.?\s*A?\.?\b/ },
  { code: 'US', regex: /\bunited states(?: of america)?\b/i },
  { code: 'US', regex: /\bamerican(?:s)?\b/i },
  { code: 'IR', regex: /\biran(?:ian)?\b/i },
  { code: 'IR', regex: /\btehran\b/i },
  { code: 'IL', regex: /\bisrael(?:i)?\b/i },
  { code: 'RU', regex: /\brussia(?:n)?\b/i },
  { code: 'UA', regex: /\bukrain(?:e|ian)\b/i },
  { code: 'GB', regex: /\bU\.?\s*K\.?\b/ },
  { code: 'GB', regex: /\b(?:united kingdom|britain|british)\b/i },
  { code: 'AE', regex: /\bU\.?\s*A\.?\s*E\.?\b/ },
  { code: 'AE', regex: /\bunited arab emirates?\b/i },
  { code: 'CN', regex: /\b(?:china|chinese)\b/i },
];

const HIGH_ATTENTION_CONFLICT_PAIRS = new Set<string>([
  'US|IR',
  'US|RU',
  'US|CN',
  'IL|IR',
  'RU|UA',
  'IN|PK',
]);

const STRATEGIC_WATERWAY_PATTERNS: Array<{ id: string; regex: RegExp }> = [
  { id: 'hormuz_strait', regex: /\b(hormuz|persian gulf|gulf of oman)\b/i },
  { id: 'bab_el_mandeb', regex: /\b(bab el[-\s]?mandeb|red sea chokepoint|red sea shipping)\b/i },
  { id: 'suez', regex: /\b(suez|suez canal)\b/i },
  { id: 'taiwan_strait', regex: /\b(taiwan strait)\b/i },
  { id: 'malacca_strait', regex: /\b(malacca strait|strait of malacca)\b/i },
  { id: 'bosphorus', regex: /\b(bosphorus)\b/i },
  { id: 'dardanelles', regex: /\b(dardanelles)\b/i },
  { id: 'gibraltar', regex: /\b(gibraltar|strait of gibraltar)\b/i },
  { id: 'panama', regex: /\b(panama canal)\b/i },
];

const MARITIME_CONFLICT_TERMS = /\b(ship|shipping|vessel|tanker|navy|naval|strait|canal|maritime|port|blockade|chokepoint|seaborne)\b/i;
const MARITIME_ZONE_TEXT_HINT = /\b(strait|canal|gulf|sea|maritime|offshore|chokepoint|shipping|hormuz|mandeb|suez|gibraltar|panama)\b/i;

const STRATEGIC_WATERWAY_COUNTRY_HINTS: Record<string, string[]> = {
  hormuz_strait: ['IR', 'OM', 'AE'],
  bab_el_mandeb: ['YE', 'DJ', 'ER', 'SA'],
  suez: ['EG'],
  taiwan_strait: ['TW', 'CN'],
  malacca_strait: ['MY', 'ID', 'SG'],
  bosphorus: ['TR'],
  dardanelles: ['TR'],
  gibraltar: ['ES', 'MA', 'GB'],
  panama: ['PA'],
};

const STATIC_CONFLICT_ZONE_COUNTRY_HINTS: Record<string, string[]> = {
  iran: ['IR'],
  ukraine: ['UA'],
  gaza: ['PS', 'IL'],
  south_lebanon: ['LB', 'IL'],
  sudan: ['SD'],
  myanmar: ['MM'],
  korean_dmz: ['KR', 'KP'],
  pak_afghan: ['PK', 'AF'],
};

const STATIC_MARITIME_ZONE_IDS = new Set<string>([
  'strait_hormuz',
  'yemen_redsea',
]);

// Theme-aware overlay color function — refreshed each buildLayers() call
function getOverlayColors() {
  const isLight = getCurrentTheme() === 'light';
  return {
    // Threat dots: IDENTICAL in both modes (user locked decision)
    hotspotHigh: [255, 68, 68, 200] as [number, number, number, number],
    hotspotElevated: [255, 165, 0, 200] as [number, number, number, number],
    hotspotLow: [255, 255, 0, 180] as [number, number, number, number],

    // Conflict zone fills: more transparent in light mode
    conflict: isLight
      ? [255, 0, 0, 60] as [number, number, number, number]
      : [255, 0, 0, 100] as [number, number, number, number],

    // Infrastructure/category markers: darker variants in light mode for map readability
    base: [0, 150, 255, 200] as [number, number, number, number],
    nuclear: isLight
      ? [180, 120, 0, 220] as [number, number, number, number]
      : [255, 215, 0, 200] as [number, number, number, number],
    datacenter: isLight
      ? [13, 148, 136, 200] as [number, number, number, number]
      : [0, 255, 200, 180] as [number, number, number, number],
    cable: [0, 200, 255, 150] as [number, number, number, number],
    cableHighlight: [255, 100, 100, 200] as [number, number, number, number],
    cableFault: [255, 50, 50, 220] as [number, number, number, number],
    cableDegraded: [255, 165, 0, 200] as [number, number, number, number],
    earthquake: [255, 100, 50, 200] as [number, number, number, number],
    vesselMilitary: [255, 100, 100, 220] as [number, number, number, number],
    flightMilitary: [255, 50, 50, 220] as [number, number, number, number],
    protest: [255, 150, 0, 200] as [number, number, number, number],
    outage: [255, 50, 50, 180] as [number, number, number, number],
    weather: [100, 150, 255, 180] as [number, number, number, number],
    startupHub: isLight
      ? [22, 163, 74, 220] as [number, number, number, number]
      : [0, 255, 150, 200] as [number, number, number, number],
    techHQ: [100, 200, 255, 200] as [number, number, number, number],
    accelerator: isLight
      ? [180, 120, 0, 220] as [number, number, number, number]
      : [255, 200, 0, 200] as [number, number, number, number],
    cloudRegion: [150, 100, 255, 180] as [number, number, number, number],
    stockExchange: isLight
      ? [20, 120, 200, 220] as [number, number, number, number]
      : [80, 200, 255, 210] as [number, number, number, number],
    financialCenter: isLight
      ? [0, 150, 110, 215] as [number, number, number, number]
      : [0, 220, 150, 200] as [number, number, number, number],
    centralBank: isLight
      ? [180, 120, 0, 220] as [number, number, number, number]
      : [255, 210, 80, 210] as [number, number, number, number],
    commodityHub: isLight
      ? [190, 95, 40, 220] as [number, number, number, number]
      : [255, 150, 80, 200] as [number, number, number, number],
    gulfInvestmentSA: [0, 168, 107, 220] as [number, number, number, number],
    gulfInvestmentUAE: [255, 0, 100, 220] as [number, number, number, number],
    ucdpStateBased: [255, 50, 50, 200] as [number, number, number, number],
    ucdpNonState: [255, 165, 0, 200] as [number, number, number, number],
    ucdpOneSided: [255, 255, 0, 200] as [number, number, number, number],
  };
}
// Initialize and refresh on every buildLayers() call
let COLORS = getOverlayColors();

// SVG icons as data URLs for different marker shapes
const MARKER_ICONS = {
  // Square - for datacenters
  square: 'data:image/svg+xml;base64,' + btoa(`<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32"><rect x="2" y="2" width="28" height="28" rx="3" fill="white"/></svg>`),
  // Diamond - for hotspots
  diamond: 'data:image/svg+xml;base64,' + btoa(`<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32"><polygon points="16,2 30,16 16,30 2,16" fill="white"/></svg>`),
  // Triangle up - for military bases
  triangleUp: 'data:image/svg+xml;base64,' + btoa(`<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32"><polygon points="16,2 30,28 2,28" fill="white"/></svg>`),
  // Hexagon - for nuclear
  hexagon: 'data:image/svg+xml;base64,' + btoa(`<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32"><polygon points="16,2 28,9 28,23 16,30 4,23 4,9" fill="white"/></svg>`),
  // Circle - fallback
  circle: 'data:image/svg+xml;base64,' + btoa(`<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32"><circle cx="16" cy="16" r="14" fill="white"/></svg>`),
  // Star - for special markers
  star: 'data:image/svg+xml;base64,' + btoa(`<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32"><polygon points="16,2 20,12 30,12 22,19 25,30 16,23 7,30 10,19 2,12 12,12" fill="white"/></svg>`),
};

export class DeckGLMap {
  private static readonly MAX_CLUSTER_LEAVES = 200;
  private static readonly HYBRID_SATELLITE_SOURCE_ID = 'wm-hybrid-satellite-source';
  private static readonly HYBRID_SATELLITE_LAYER_ID = 'wm-hybrid-satellite-layer';
  private static readonly HYBRID_TERRAIN_SOURCE_ID = 'wm-hybrid-terrain-source';

  private container: HTMLElement;
  private wrapperEl: HTMLDivElement | null = null;
  private deckOverlay: MapboxOverlay | null = null;
  private maplibreMap: maplibregl.Map | null = null;
  private state: DeckMapState;
  private popup: MapPopup;
  private arHudEl: HTMLDivElement | null = null;
  private borderStreamEl: HTMLDivElement | null = null;
  private borderStreamTracks: HTMLElement[] = [];
  private borderStreamTimerId: ReturnType<typeof setInterval> | null = null;
  private hudLocked = false;

  // Data stores
  private hotspots: HotspotWithBreaking[];
  private earthquakes: Earthquake[] = [];
  private weatherAlerts: WeatherAlert[] = [];
  private outages: InternetOutage[] = [];
  private cyberThreats: CyberThreat[] = [];
  private aisDisruptions: AisDisruptionEvent[] = [];
  private aisDensity: AisDensityZone[] = [];
  private cableAdvisories: CableAdvisory[] = [];
  private repairShips: RepairShip[] = [];
  private healthByCableId: Record<string, CableHealthRecord> = {};
  private protests: SocialUnrestEvent[] = [];
  private militaryFlights: MilitaryFlight[] = [];
  private militaryFlightClusters: MilitaryFlightCluster[] = [];
  private militaryVessels: MilitaryVessel[] = [];
  private militaryVesselClusters: MilitaryVesselCluster[] = [];
  private runtimeMilitaryBases: MilitaryBaseEnriched[] | null = null;
  private iranEvents: IranEvent[] = [];
  private gpsJammingHexes: GpsJamHex[] = [];
  private naturalEvents: NaturalEvent[] = [];
  private firmsFireData: Array<{ lat: number; lon: number; brightness: number; frp: number; confidence: number; region: string; acq_date: string; daynight: string }> = [];
  private dynamicConflictZones: ConflictZone[] = [];
  private techEvents: TechEventMarker[] = [];
  private flightDelays: AirportDelayAlert[] = [];
  private news: NewsItem[] = [];
  private newsLocations: Array<{ lat: number; lon: number; title: string; threatLevel: string; timestamp?: Date }> = [];
  private newsLocationFirstSeen = new Map<string, number>();
  private countryCentroids = new Map<string, { code: string; name: string; lon: number; lat: number }>();
  private countryInteractionArcs: CountryInteractionArc[] = [];
  private countryInteractionNodes: CountryInteractionNode[] = [];
  private countryInteractionSignature = '';
  private conflictZoneConfidence = new Map<string, number>();
  private ucdpEvents: UcdpGeoEvent[] = [];
  private displacementFlows: DisplacementFlow[] = [];
  private climateAnomalies: ClimateAnomaly[] = [];
  private tradeRouteSegments: TradeRouteSegment[] = resolveTradeRouteSegments();
  private positiveEvents: PositiveGeoEvent[] = [];
  private kindnessPoints: KindnessPoint[] = [];

  // Phase 8 overlay data
  private happinessScores: Map<string, number> = new Map();
  private happinessYear = 0;
  private happinessSource = '';
  private speciesRecoveryZones: Array<SpeciesRecovery & { recoveryZone: { name: string; lat: number; lon: number } }> = [];
  private renewableInstallations: RenewableInstallation[] = [];
  private countriesGeoJsonData: FeatureCollection<Geometry> | null = null;

  // Country highlight state
  private countryGeoJsonLoaded = false;
  private countryHoverSetup = false;
  private highlightedCountryCode: string | null = null;
  private conflictCountryRiskSignature = '';
  private projectionMode: MapProjectionMode = DEFAULT_MAP_PROJECTION;

  // Callbacks
  private onHotspotClick?: (hotspot: Hotspot) => void;
  private onTimeRangeChange?: (range: TimeRange) => void;
  private onCountryClick?: (country: CountryClickPayload) => void;
  private onLayerChange?: (layer: keyof MapLayers, enabled: boolean, source: 'user' | 'programmatic') => void;
  private onStateChange?: (state: DeckMapState) => void;
  private onAircraftPositionsUpdate?: (positions: PositionSample[]) => void;

  // Highlighted assets
  private highlightedAssets: Record<AssetType, Set<string>> = {
    pipeline: new Set(),
    cable: new Set(),
    datacenter: new Set(),
    base: new Set(),
    nuclear: new Set(),
  };

  private renderScheduled = false;
  private renderPaused = false;
  private renderPending = false;
  private mapInteractionActive = false;
  private webglLost = false;
  private resizeObserver: ResizeObserver | null = null;

  private layerCache: Map<string, Layer> = new Map();
  private lastZoomThreshold = 0;
  private protestSC: Supercluster | null = null;
  private techHQSC: Supercluster | null = null;
  private techEventSC: Supercluster | null = null;
  private datacenterSC: Supercluster | null = null;
  private protestClusters: MapProtestCluster[] = [];
  private techHQClusters: MapTechHQCluster[] = [];
  private techEventClusters: MapTechEventCluster[] = [];
  private datacenterClusters: MapDatacenterCluster[] = [];
  private lastSCZoom = -1;
  private lastSCBoundsKey = '';
  private lastSCMask = '';
  private protestSuperclusterSource: SocialUnrestEvent[] = [];
  private newsPulseIntervalId: ReturnType<typeof setInterval> | null = null;
  private readonly startupTime = Date.now();
  private lastCableHighlightSignature = '';
  private lastCableHealthSignature = '';
  private lastPipelineHighlightSignature = '';
  private debouncedRebuildLayers: () => void;
  private rafUpdateLayers: () => void;
  private moveTimeoutId: ReturnType<typeof setTimeout> | null = null;
  private replayMode = false;
  private replayPlaying = false;
  private replayCursorMs: number | null = null;
  private replayMinTs = 0;
  private replayMaxTs = 0;
  private replayTimerId: ReturnType<typeof setInterval> | null = null;
  private replayStepMs = 60 * 60 * 1000;

  constructor(container: HTMLElement, initialState: DeckMapState) {
    this.container = container;
    this.state = initialState;
    this.hotspots = [...INTEL_HOTSPOTS];
    this.projectionMode = this.getPreferredProjectionForView(initialState.view);

    this.debouncedRebuildLayers = debounce(() => {
      if (this.renderPaused || this.webglLost || !this.maplibreMap) return;
      this.maplibreMap.resize();
      try { this.deckOverlay?.setProps({ layers: this.buildLayers() }); } catch { /* map mid-teardown */ }
    }, 150);
    this.rafUpdateLayers = rafSchedule(() => {
      if (this.renderPaused || this.webglLost || !this.maplibreMap) return;
      try { this.deckOverlay?.setProps({ layers: this.buildLayers() }); } catch { /* map mid-teardown */ }
    });

    this.setupDOM();
    this.popup = new MapPopup(container);

    window.addEventListener('theme-changed', (e: Event) => {
      const theme = (e as CustomEvent).detail?.theme as 'dark' | 'light';
      if (theme) {
        this.switchBasemap(theme);
        this.render(); // Rebuilds Deck.GL layers with new theme-aware colors
      }
    });

    this.initMapLibre();

    this.maplibreMap?.on('load', () => {
      this.applyProjection(this.projectionMode);
      this.applyHybridBasemapEnhancements();
      this.rebuildTechHQSupercluster();
      this.rebuildDatacenterSupercluster();
      this.initDeck();
      this.loadCountryBoundaries();
      this.render();
    });

    this.setupResizeObserver();

    this.createControls();
    this.createTimeSlider();
    this.createLayerToggles();
    this.createLegend();
    this.startBorderStreamRefresh();
  }

  private setupDOM(): void {
    const wrapper = document.createElement('div');
    wrapper.className = 'deckgl-map-wrapper';
    wrapper.id = 'deckglMapWrapper';
    wrapper.style.cssText = 'position: relative; width: 100%; height: 100%; overflow: hidden;';
    this.wrapperEl = wrapper;

    // MapLibre container - deck.gl renders directly into MapLibre via MapboxOverlay
    const mapContainer = document.createElement('div');
    mapContainer.id = 'deckgl-basemap';
    mapContainer.style.cssText = 'position: absolute; top: 0; left: 0; width: 100%; height: 100%;';
    wrapper.appendChild(mapContainer);

    // Map attribution (CARTO basemap + OpenStreetMap data)
    const attribution = document.createElement('div');
    attribution.className = 'map-attribution';
    attribution.innerHTML = '© <a href="https://carto.com/attributions" target="_blank" rel="noopener">CARTO</a> © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>';
    wrapper.appendChild(attribution);

    const hud = document.createElement('div');
    hud.className = 'deckgl-ar-hud';
    wrapper.appendChild(hud);
    this.arHudEl = hud;

    const borderStream = document.createElement('div');
    borderStream.className = 'deckgl-data-stream-border';
    borderStream.innerHTML = `
      <div class="deckgl-data-stream-edge top"><div class="deckgl-data-stream-track"><span class="deckgl-data-stream-text"></span></div></div>
      <div class="deckgl-data-stream-edge right"><div class="deckgl-data-stream-track"><span class="deckgl-data-stream-text"></span></div></div>
      <div class="deckgl-data-stream-edge bottom"><div class="deckgl-data-stream-track"><span class="deckgl-data-stream-text"></span></div></div>
      <div class="deckgl-data-stream-edge left"><div class="deckgl-data-stream-track"><span class="deckgl-data-stream-text"></span></div></div>
    `;
    wrapper.appendChild(borderStream);
    this.borderStreamEl = borderStream;
    this.borderStreamTracks = Array.from(borderStream.querySelectorAll<HTMLElement>('.deckgl-data-stream-text'));

    this.container.appendChild(wrapper);
  }

  private initMapLibre(): void {
    const preset = VIEW_PRESETS[this.state.view];
    const initialTheme = getCurrentTheme();

    this.maplibreMap = new maplibregl.Map({
      container: 'deckgl-basemap',
      style: initialTheme === 'light' ? LIGHT_STYLE : DARK_STYLE,
      center: [preset.longitude, preset.latitude],
      zoom: preset.zoom,
      // Keep basemap render target at 1x DPR to reduce GPU fill-rate cost.
      pixelRatio: 1,
      renderWorldCopies: false,
      attributionControl: false,
      interactive: true,
      ...(MAP_INTERACTION_MODE === 'flat'
        ? {
          maxPitch: 0,
          pitchWithRotate: false,
          dragRotate: false,
          touchPitch: false,
        }
        : {}),
    });

    const canvas = this.maplibreMap.getCanvas();
    canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      this.webglLost = true;
      console.warn('[DeckGLMap] WebGL context lost — will restore when browser recovers');
    });
    canvas.addEventListener('webglcontextrestored', () => {
      this.webglLost = false;
      console.info('[DeckGLMap] WebGL context restored');
      this.maplibreMap?.triggerRepaint();
    });
  }

  private initDeck(): void {
    if (!this.maplibreMap) return;

    this.deckOverlay = new MapboxOverlay({
      interleaved: true,
      layers: this.buildLayers(),
      getTooltip: (info: PickingInfo) => this.getTooltip(info),
      onHover: (info: PickingInfo) => this.handleHover(info),
      onClick: (info: PickingInfo) => this.handleClick(info),
      // Keep picking narrow and lock DPR at 1x to reduce GPU cost on desktop.
      pickingRadius: 8,
      useDevicePixels: 1,
      onError: (error: Error) => console.warn('[DeckGLMap] Render error (non-fatal):', error.message),
    });

    this.maplibreMap.addControl(this.deckOverlay as unknown as maplibregl.IControl);

    const beginInteraction = () => {
      this.mapInteractionActive = true;
      if (this.moveTimeoutId) {
        clearTimeout(this.moveTimeoutId);
        this.moveTimeoutId = null;
      }
    };

    const finishInteraction = (rebuildLayers: boolean) => {
      this.mapInteractionActive = false;
      this.invalidateClusterViewportCache();
      if (rebuildLayers) {
        this.debouncedRebuildLayers();
        return;
      }
      if (this.renderPending) {
        this.renderPending = false;
        this.render();
        return;
      }
      this.rafUpdateLayers();
    };

    this.maplibreMap.on('movestart', () => {
      beginInteraction();
    });

    this.maplibreMap.on('moveend', () => {
      finishInteraction(false);
    });

    this.maplibreMap.on('zoomstart', () => {
      beginInteraction();
    });

    this.maplibreMap.on('zoomend', () => {
      const currentZoom = Math.floor(this.maplibreMap?.getZoom() || 2);
      const thresholdCrossed = Math.abs(currentZoom - this.lastZoomThreshold) >= 1;
      this.lastZoomThreshold = currentZoom;
      finishInteraction(thresholdCrossed);
    });

    this.maplibreMap.on('rotateend', () => {
      finishInteraction(false);
    });

    this.maplibreMap.on('pitchend', () => {
      finishInteraction(false);
    });
  }

  private setupResizeObserver(): void {
    this.resizeObserver = new ResizeObserver(() => {
      if (this.maplibreMap) {
        this.maplibreMap.resize();
      }
    });
    this.resizeObserver.observe(this.container);
  }


  private getSetSignature(set: Set<string>): string {
    return [...set].sort().join('|');
  }

  private getTimeRangeMs(range: TimeRange = this.state.timeRange): number {
    const ranges: Record<TimeRange, number> = {
      '1h': 60 * 60 * 1000,
      '6h': 6 * 60 * 60 * 1000,
      '24h': 24 * 60 * 60 * 1000,
      '48h': 48 * 60 * 60 * 1000,
      '7d': 7 * 24 * 60 * 60 * 1000,
      'all': Infinity,
    };
    return ranges[range];
  }

  private parseTime(value: Date | string | number | undefined | null): number | null {
    if (value == null) return null;
    const ts = value instanceof Date ? value.getTime() : new Date(value).getTime();
    return Number.isFinite(ts) ? ts : null;
  }

  private getTimeAnchorMs(): number {
    if (this.replayMode && this.replayCursorMs != null && Number.isFinite(this.replayCursorMs)) {
      return this.replayCursorMs;
    }
    return Date.now();
  }

  private filterByTime<T>(
    items: T[],
    getTime: (item: T) => Date | string | number | undefined | null
  ): T[] {
    if (this.state.timeRange === 'all') {
      if (!this.replayMode || this.replayCursorMs == null) return items;
      return items.filter((item) => {
        const ts = this.parseTime(getTime(item));
        if (ts == null) return false;
        return ts <= this.replayCursorMs!;
      });
    }
    const cutoff = this.getTimeAnchorMs() - this.getTimeRangeMs();
    return items.filter((item) => {
      const ts = this.parseTime(getTime(item));
      if (ts == null) return !this.replayMode;
      if (this.replayMode && this.replayCursorMs != null && ts > this.replayCursorMs) return false;
      return ts >= cutoff;
    });
  }

  private getLodLevel(zoom: number): MapLodLevel {
    if (zoom < 3.2) return 'global';
    if (zoom < 5.2) return 'regional';
    return 'local';
  }

  private getFilteredProtests(): SocialUnrestEvent[] {
    return this.filterByTime(this.protests, (event) => event.time);
  }

  private filterMilitaryFlightClustersByTime(clusters: MilitaryFlightCluster[]): MilitaryFlightCluster[] {
    return clusters
      .map((cluster) => {
        const flights = this.filterByTime(cluster.flights ?? [], (flight) => flight.lastSeen);
        if (flights.length === 0) return null;
        return {
          ...cluster,
          flights,
          flightCount: flights.length,
        };
      })
      .filter((cluster): cluster is MilitaryFlightCluster => cluster !== null);
  }

  private filterMilitaryVesselClustersByTime(clusters: MilitaryVesselCluster[]): MilitaryVesselCluster[] {
    return clusters
      .map((cluster) => {
        const vessels = this.filterByTime(cluster.vessels ?? [], (vessel) => vessel.lastAisUpdate);
        if (vessels.length === 0) return null;
        return {
          ...cluster,
          vessels,
          vesselCount: vessels.length,
        };
      })
      .filter((cluster): cluster is MilitaryVesselCluster => cluster !== null);
  }

  private scoreMilitaryFlightForVisibility(flight: MilitaryFlight): number {
    let score = 0;
    if (flight.isInteresting) score += 120;
    if (flight.confidence === 'high') score += 55;
    else if (flight.confidence === 'medium') score += 28;
    if (flight.aircraftType === 'bomber' || flight.aircraftType === 'reconnaissance' || flight.aircraftType === 'awacs') {
      score += 35;
    }
    score += Math.min(24, Math.max(0, flight.speed / 30));
    score += Math.min(18, Math.max(0, flight.altitude / 3500));
    return score;
  }

  private filterMilitaryFlightsForRendering(flights: MilitaryFlight[]): MilitaryFlight[] {
    if (flights.length === 0) return flights;

    const zoom = this.maplibreMap?.getZoom() || this.state.zoom || 2;
    const budget = zoom >= 5
      ? Math.max(MILITARY_FLIGHT_MARKER_LIMIT_BASE, 260)
      : zoom >= 3
        ? MILITARY_FLIGHT_MARKER_LIMIT_BASE
        : Math.min(70, MILITARY_FLIGHT_MARKER_LIMIT_BASE);

    if (flights.length <= budget) return flights;

    return [...flights]
      .sort((a, b) => this.scoreMilitaryFlightForVisibility(b) - this.scoreMilitaryFlightForVisibility(a))
      .slice(0, budget);
  }

  private getOverlayPosition(lon: number, lat: number, globeLiftMeters = 0): [number, number, number] {
    const z = this.projectionMode === 'globe' ? globeLiftMeters : 0;
    return [this.normalizeLongitude(lon), this.clampLatitude(lat), z];
  }

  private normalizeLongitude(lon: number): number {
    if (!Number.isFinite(lon)) return 0;
    // Keep longitudes stable in [-180, 180] so markers do not jump across wrap seams.
    return ((((lon + 180) % 360) + 360) % 360) - 180;
  }

  private clampLatitude(lat: number): number {
    if (!Number.isFinite(lat)) return 0;
    return Math.max(-85, Math.min(85, lat));
  }

  private sanitizeNewsLocations(
    data: Array<{ lat: number; lon: number; title: string; threatLevel: string; timestamp?: Date }>,
  ): Array<{ lat: number; lon: number; title: string; threatLevel: string; timestamp?: Date }> {
    const sanitized: Array<{ lat: number; lon: number; title: string; threatLevel: string; timestamp?: Date }> = [];
    const seen = new Set<string>();

    for (const item of data) {
      if (!Number.isFinite(item.lat) || !Number.isFinite(item.lon)) continue;
      const lat = this.clampLatitude(item.lat);
      const lon = this.normalizeLongitude(item.lon);
      const title = typeof item.title === 'string' && item.title.trim().length > 0
        ? item.title.trim()
        : 'Untitled event';
      const threatLevel = (item.threatLevel || 'info').toLowerCase();
      const key = `${Math.round(lat * 1000)}:${Math.round(lon * 1000)}:${title.slice(0, 56).toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      sanitized.push({
        lat,
        lon,
        title,
        threatLevel,
        timestamp: item.timestamp,
      });
    }

    return sanitized;
  }

  private computeGeometryBounds(geometry: Geometry | null | undefined): [number, number, number, number] | null {
    if (!geometry || !('coordinates' in geometry)) return null;
    let minLon = Infinity;
    let minLat = Infinity;
    let maxLon = -Infinity;
    let maxLat = -Infinity;
    let seen = false;

    const walk = (coords: unknown): void => {
      if (!Array.isArray(coords)) return;
      if (coords.length >= 2 && typeof coords[0] === 'number' && typeof coords[1] === 'number') {
        const lon = Number(coords[0]);
        const lat = Number(coords[1]);
        if (!Number.isFinite(lon) || !Number.isFinite(lat)) return;
        seen = true;
        if (lon < minLon) minLon = lon;
        if (lat < minLat) minLat = lat;
        if (lon > maxLon) maxLon = lon;
        if (lat > maxLat) maxLat = lat;
        return;
      }
      for (const child of coords) walk(child);
    };

    walk((geometry as { coordinates?: unknown }).coordinates);
    return seen ? [minLon, minLat, maxLon, maxLat] : null;
  }

  private ensureCountryCentroids(): void {
    if (this.countryCentroids.size > 0 || !this.countriesGeoJsonData) return;
    for (const feature of this.countriesGeoJsonData.features) {
      const props = (feature.properties ?? {}) as Record<string, unknown>;
      const codeRaw = props['ISO3166-1-Alpha-2'] ?? props.ISO_A2 ?? props.iso_a2;
      const nameRaw = props.name ?? props.NAME ?? props.admin;
      if (typeof codeRaw !== 'string' || typeof nameRaw !== 'string') continue;
      const code = codeRaw.trim().toUpperCase();
      const name = nameRaw.trim();
      if (!/^[A-Z]{2}$/.test(code) || !name) continue;
      const bounds = this.computeGeometryBounds(feature.geometry as Geometry | null | undefined);
      if (!bounds) continue;
      const [minLon, minLat, maxLon, maxLat] = bounds;
      const lon = (minLon + maxLon) / 2;
      const lat = (minLat + maxLat) / 2;
      if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;
      this.countryCentroids.set(code, { code, name, lon, lat });
    }
  }

  private normalizeCountryCodes(codes: Iterable<string>): string[] {
    const set = new Set<string>();
    for (const code of codes) {
      const normalized = String(code || '').trim().toUpperCase();
      if (/^[A-Z]{2}$/.test(normalized)) set.add(normalized);
    }
    return [...set];
  }

  private getCountryCentroidEntry(codeRaw: string): { code: string; name: string; lon: number; lat: number } | null {
    const code = String(codeRaw || '').trim().toUpperCase();
    if (!/^[A-Z]{2}$/.test(code)) return null;
    const existing = this.countryCentroids.get(code);
    if (existing) return existing;

    const centroid = getCountryCentroid(code, ME_STRIKE_BOUNDS);
    if (!centroid) return null;
    const entry = {
      code,
      name: getCountryNameByCode(code) ?? code,
      lon: centroid.lon,
      lat: centroid.lat,
    };
    this.countryCentroids.set(code, entry);
    return entry;
  }

  private getThreatScore(level?: string, isAlert = false): number {
    switch ((level || '').toLowerCase()) {
      case 'critical': return 5;
      case 'high': return 4;
      case 'medium': return 3;
      case 'low': return 2;
      case 'info': return 1;
      default: return isAlert ? 3 : 1;
    }
  }

  private getRecencyMultiplier(pubDate: Date | undefined, nowTs: number): number {
    if (!(pubDate instanceof Date)) return 0.8;
    const ts = pubDate.getTime();
    if (!Number.isFinite(ts)) return 0.8;
    const ageHours = Math.max(0, (nowTs - ts) / (60 * 60 * 1000));
    if (ageHours <= 6) return 1.25;
    if (ageHours <= 24) return 1.0;
    if (ageHours <= 48) return 0.8;
    if (ageHours <= 7 * 24) return 0.55;
    return 0.35;
  }

  private extractCountryCodesFromTextAliases(text: string): string[] {
    if (!text) return [];
    const matched = new Set<string>();
    for (const { code, regex } of COUNTRY_TEXT_ALIAS_PATTERNS) {
      if (regex.test(text)) {
        matched.add(code);
      }
    }
    return [...matched];
  }

  private extractCountryCodesFromNewsItem(item: NewsItem): string[] {
    const matched = new Set<string>();
    if (item.title) {
      for (const code of matchCountryNamesInText(item.title)) {
        const normalized = code.trim().toUpperCase();
        if (/^[A-Z]{2}$/.test(normalized)) matched.add(normalized);
      }
      for (const code of this.extractCountryCodesFromTextAliases(item.title)) {
        matched.add(code);
      }
    }
    if (item.locationName) {
      for (const code of matchCountryNamesInText(item.locationName)) {
        const normalized = code.trim().toUpperCase();
        if (/^[A-Z]{2}$/.test(normalized)) matched.add(normalized);
      }
      for (const code of this.extractCountryCodesFromTextAliases(item.locationName)) {
        matched.add(code);
      }
    }
    if (item.lat != null && item.lon != null) {
      const hintCodes = matched.size > 0 ? [...matched] : undefined;
      const countryHit = getCountryAtCoordinates(item.lat, item.lon, hintCodes);
      if (countryHit?.code) {
        matched.add(countryHit.code);
      }
    }

    const combinedText = `${item.title || ''} ${item.locationName || ''}`;
    for (const pattern of STRATEGIC_WATERWAY_PATTERNS) {
      if (!pattern.regex.test(combinedText)) continue;
      for (const hintCode of STRATEGIC_WATERWAY_COUNTRY_HINTS[pattern.id] ?? []) {
        matched.add(hintCode);
      }
    }

    return this.normalizeCountryCodes(matched);
  }

  private computeCountryInteractionSignature(): string {
    if (this.news.length === 0) return `${this.state.timeRange}|0`;
    const tail = this.news.slice(0, 80).map((item) => {
      const ts = item.pubDate instanceof Date ? item.pubDate.getTime() : 0;
      return `${item.title}|${ts}|${item.threat?.level || ''}`;
    }).join('||');
    return `${this.state.timeRange}|${this.news.length}|${tail}`;
  }

  private recomputeCountryInteractions(): void {
    this.ensureCountryCentroids();
    const signature = this.computeCountryInteractionSignature();
    if (signature === this.countryInteractionSignature) return;
    this.countryInteractionSignature = signature;
    this.countryInteractionArcs = [];
    this.countryInteractionNodes = [];

    if (this.news.length === 0) return;
    const now = Date.now();
    const filteredNews = this.filterByTime(this.news, (item) => item.pubDate).slice(0, 1200);
    if (filteredNews.length === 0) return;

    type PairAccumulator = {
      sourceCode: string;
      targetCode: string;
      score: number;
      mentionCount: number;
      criticalCount: number;
      lastSeenTs: number;
      sampleTitles: string[];
    };
    type NodeAccumulator = {
      code: string;
      score: number;
      mentionCount: number;
      criticalCount: number;
      lastSeenTs: number;
    };

    const pairMap = new Map<string, PairAccumulator>();
    const nodeMap = new Map<string, NodeAccumulator>();

    const touchNode = (code: string, score: number, critical: boolean, ts: number): void => {
      const current = nodeMap.get(code);
      if (!current) {
        nodeMap.set(code, {
          code,
          score,
          mentionCount: 1,
          criticalCount: critical ? 1 : 0,
          lastSeenTs: ts,
        });
        return;
      }
      current.score += score;
      current.mentionCount += 1;
      if (critical) current.criticalCount += 1;
      current.lastSeenTs = Math.max(current.lastSeenTs, ts);
    };

    const touchPair = (
      sourceCode: string,
      targetCode: string,
      score: number,
      critical: boolean,
      ts: number,
      title?: string
    ): void => {
      const key = `${sourceCode}|${targetCode}`;
      const current = pairMap.get(key);
      if (!current) {
        pairMap.set(key, {
          sourceCode,
          targetCode,
          score,
          mentionCount: 1,
          criticalCount: critical ? 1 : 0,
          lastSeenTs: ts,
          sampleTitles: title ? [title] : [],
        });
        return;
      }
      current.score += score;
      current.mentionCount += 1;
      if (critical) current.criticalCount += 1;
      current.lastSeenTs = Math.max(current.lastSeenTs, ts);
      if (title && current.sampleTitles.length < 3 && !current.sampleTitles.includes(title)) {
        current.sampleTitles.push(title);
      }
    };

    for (const item of filteredNews) {
      const countryCodes = this.extractCountryCodesFromNewsItem(item);
      if (countryCodes.length === 0) continue;

      const threatScore = this.getThreatScore(item.threat?.level, item.isAlert);
      const recency = this.getRecencyMultiplier(item.pubDate, now);
      const score = threatScore * recency;
      const ts = item.pubDate instanceof Date ? item.pubDate.getTime() : now;
      const isCritical = threatScore >= 4;
      const titleText = String(item.title || '');
      const locationText = String(item.locationName || '');
      const interactionText = `${titleText} ${locationText}`;
      const category = String(item.threat?.category || '').toLowerCase();
      const hasConflictSignal = /\b(war|attack|airstrike|air strike|drone|missile|retaliat|clash|strike|military|troops|bomb|offensive|hostilities)\b/i.test(interactionText);
      const hasBilateralVerb = /\b(vs\.?|against|between|targets?|targeting|retaliat(?:e|es|ed|ion)|exchanges? fire)\b/i.test(interactionText);
      const categoryBoost = category === 'conflict' || category === 'military' || category === 'terrorism' ? 1.25 : 1.0;
      const signalBoost = hasConflictSignal ? 1.18 : 1.0;
      const bilateralBoost = hasBilateralVerb ? 1.1 : 1.0;

      for (const code of countryCodes) {
        touchNode(code, score, isCritical, ts);
      }

      const uniqueCodes = [...new Set(countryCodes)].sort();
      if (uniqueCodes.length < 2) continue;
      const pairBoost = 1 + Math.min(0.35, (uniqueCodes.length - 2) * 0.1);

      for (let i = 0; i < uniqueCodes.length; i += 1) {
        for (let j = i + 1; j < uniqueCodes.length; j += 1) {
          const sourceCode = uniqueCodes[i];
          const targetCode = uniqueCodes[j];
          if (!sourceCode || !targetCode) continue;
          const sortedKey = sourceCode < targetCode ? `${sourceCode}|${targetCode}` : `${targetCode}|${sourceCode}`;
          const priorityPairBoost = hasConflictSignal && HIGH_ATTENTION_CONFLICT_PAIRS.has(sortedKey) ? 1.3 : 1.0;
          const weightedPairScore = score * pairBoost * categoryBoost * signalBoost * bilateralBoost * priorityPairBoost;
          touchPair(sourceCode, targetCode, weightedPairScore, isCritical, ts, item.title);
        }
      }
    }

    const filteredLocations = this.filterByTime(this.newsLocations, (location) => location.timestamp).slice(0, 600);
    for (const location of filteredLocations) {
      const country = getCountryAtCoordinates(location.lat, location.lon);
      if (!country?.code) continue;
      if (!this.getCountryCentroidEntry(country.code)) continue;
      const threatScore = this.getThreatScore(location.threatLevel, false);
      const score = threatScore * 0.9;
      const ts = location.timestamp instanceof Date ? location.timestamp.getTime() : now;
      touchNode(country.code, score, threatScore >= 4, ts);
    }

    if (this.displacementFlows.length > 0) {
      const flows = this.displacementFlows
        .filter((flow) => flow.originLat != null && flow.originLon != null && flow.asylumLat != null && flow.asylumLon != null)
        .slice(0, 60);
      const maxRefugees = Math.max(1, ...flows.map((flow) => Number(flow.refugees) || 0));
      const syntheticTs = now - 6 * 60 * 60 * 1000;
      for (const flow of flows) {
        const origin = getCountryAtCoordinates(flow.originLat!, flow.originLon!);
        const target = getCountryAtCoordinates(flow.asylumLat!, flow.asylumLon!);
        if (!origin?.code || !target?.code || origin.code === target.code) continue;
        if (!this.getCountryCentroidEntry(origin.code) || !this.getCountryCentroidEntry(target.code)) continue;
        const normalized = Math.min(1, (Number(flow.refugees) || 0) / maxRefugees);
        const score = 1.2 + normalized * 3.0;
        touchNode(origin.code, score * 0.6, true, syntheticTs);
        touchNode(target.code, score * 0.6, true, syntheticTs);
        touchPair(origin.code, target.code, score, true, syntheticTs, `${origin.name} → ${target.name} displacement`);
      }
    }

    if (this.tradeRouteSegments.length > 0) {
      const seen = new Set<string>();
      const syntheticTs = now - 12 * 60 * 60 * 1000;
      for (const segment of this.tradeRouteSegments) {
        const routeKey = `${segment.routeId}:${segment.sourcePosition.join(',')}:${segment.targetPosition.join(',')}`;
        if (seen.has(routeKey)) continue;
        seen.add(routeKey);
        const source = getCountryAtCoordinates(segment.sourcePosition[1], segment.sourcePosition[0]);
        const target = getCountryAtCoordinates(segment.targetPosition[1], segment.targetPosition[0]);
        if (!source?.code || !target?.code || source.code === target.code) continue;
        if (!this.getCountryCentroidEntry(source.code) || !this.getCountryCentroidEntry(target.code)) continue;
        const statusWeight = segment.status === 'disrupted' ? 3.2 : segment.status === 'high_risk' ? 2.4 : 1.3;
        const categoryWeight = segment.category === 'energy' ? 1.25 : segment.category === 'bulk' ? 1.1 : 1.0;
        const score = statusWeight * categoryWeight;
        touchNode(source.code, score * 0.45, segment.status !== 'active', syntheticTs);
        touchNode(target.code, score * 0.45, segment.status !== 'active', syntheticTs);
        touchPair(source.code, target.code, score, segment.status !== 'active', syntheticTs, `${segment.routeName} (${segment.status})`);
      }
    }

    const sortedPairs = [...pairMap.values()]
      .sort((a, b) => {
        const aPriority = a.score + a.criticalCount * 1.4 + a.mentionCount * 0.18;
        const bPriority = b.score + b.criticalCount * 1.4 + b.mentionCount * 0.18;
        return bPriority - aPriority;
      })
      .slice(0, 120);
    const maxPairScore = Math.max(1, ...sortedPairs.map((pair) => pair.score));
    this.countryInteractionArcs = sortedPairs.flatMap((pair, idx) => {
      const source = this.getCountryCentroidEntry(pair.sourceCode);
      const target = this.getCountryCentroidEntry(pair.targetCode);
      if (!source || !target) return [];
      return [{
        id: `country-relation-${idx}-${pair.sourceCode}-${pair.targetCode}`,
        sourceCode: pair.sourceCode,
        sourceName: source.name,
        sourceLon: source.lon,
        sourceLat: source.lat,
        targetCode: pair.targetCode,
        targetName: target.name,
        targetLon: target.lon,
        targetLat: target.lat,
        score: pair.score,
        normalized: Math.max(0.08, Math.min(1, pair.score / maxPairScore)),
        mentionCount: pair.mentionCount,
        criticalCount: pair.criticalCount,
        lastSeenTs: pair.lastSeenTs,
        sampleTitle: pair.sampleTitles[0],
      }];
    });

    const sortedNodes = [...nodeMap.values()]
      .sort((a, b) => b.score - a.score)
      .slice(0, 90);
    const maxNodeScore = Math.max(1, ...sortedNodes.map((node) => node.score));
    this.countryInteractionNodes = sortedNodes.flatMap((node, idx) => {
      const centroid = this.getCountryCentroidEntry(node.code);
      if (!centroid) return [];
      return [{
        id: `country-node-${idx}-${node.code}`,
        code: node.code,
        name: centroid.name,
        lon: centroid.lon,
        lat: centroid.lat,
        score: node.score,
        normalized: Math.max(0.08, Math.min(1, node.score / maxNodeScore)),
        mentionCount: node.mentionCount,
        criticalCount: node.criticalCount,
        lastSeenTs: node.lastSeenTs,
      }];
    });
  }

  private rebuildProtestSupercluster(source: SocialUnrestEvent[] = this.getFilteredProtests()): void {
    this.protestSuperclusterSource = source;
    const points = source.map((p, i) => ({
      type: 'Feature' as const,
      geometry: { type: 'Point' as const, coordinates: [p.lon, p.lat] as [number, number] },
      properties: {
        index: i,
        country: p.country,
        severity: p.severity,
        eventType: p.eventType,
        validated: Boolean(p.validated),
        fatalities: Number.isFinite(p.fatalities) ? Number(p.fatalities) : 0,
      },
    }));
    this.protestSC = new Supercluster({
      radius: 60,
      maxZoom: 14,
      map: (props: Record<string, unknown>) => ({
        index: Number(props.index ?? 0),
        country: String(props.country ?? ''),
        maxSeverityRank: props.severity === 'high' ? 2 : props.severity === 'medium' ? 1 : 0,
        riotCount: props.eventType === 'riot' ? 1 : 0,
        highSeverityCount: props.severity === 'high' ? 1 : 0,
        verifiedCount: props.validated ? 1 : 0,
        totalFatalities: Number(props.fatalities ?? 0) || 0,
      }),
      reduce: (acc: Record<string, unknown>, props: Record<string, unknown>) => {
        acc.maxSeverityRank = Math.max(Number(acc.maxSeverityRank ?? 0), Number(props.maxSeverityRank ?? 0));
        acc.riotCount = Number(acc.riotCount ?? 0) + Number(props.riotCount ?? 0);
        acc.highSeverityCount = Number(acc.highSeverityCount ?? 0) + Number(props.highSeverityCount ?? 0);
        acc.verifiedCount = Number(acc.verifiedCount ?? 0) + Number(props.verifiedCount ?? 0);
        acc.totalFatalities = Number(acc.totalFatalities ?? 0) + Number(props.totalFatalities ?? 0);
        if (!acc.country && props.country) acc.country = props.country;
      },
    });
    this.protestSC.load(points);
    this.lastSCZoom = -1;
  }

  private rebuildTechHQSupercluster(): void {
    const points = TECH_HQS.map((h, i) => ({
      type: 'Feature' as const,
      geometry: { type: 'Point' as const, coordinates: [h.lon, h.lat] as [number, number] },
      properties: {
        index: i,
        city: h.city,
        country: h.country,
        type: h.type,
      },
    }));
    this.techHQSC = new Supercluster({
      radius: 50,
      maxZoom: 14,
      map: (props: Record<string, unknown>) => ({
        index: Number(props.index ?? 0),
        city: String(props.city ?? ''),
        country: String(props.country ?? ''),
        faangCount: props.type === 'faang' ? 1 : 0,
        unicornCount: props.type === 'unicorn' ? 1 : 0,
        publicCount: props.type === 'public' ? 1 : 0,
      }),
      reduce: (acc: Record<string, unknown>, props: Record<string, unknown>) => {
        acc.faangCount = Number(acc.faangCount ?? 0) + Number(props.faangCount ?? 0);
        acc.unicornCount = Number(acc.unicornCount ?? 0) + Number(props.unicornCount ?? 0);
        acc.publicCount = Number(acc.publicCount ?? 0) + Number(props.publicCount ?? 0);
        if (!acc.city && props.city) acc.city = props.city;
        if (!acc.country && props.country) acc.country = props.country;
      },
    });
    this.techHQSC.load(points);
    this.lastSCZoom = -1;
  }

  private rebuildTechEventSupercluster(): void {
    const points = this.techEvents.map((e, i) => ({
      type: 'Feature' as const,
      geometry: { type: 'Point' as const, coordinates: [e.lng, e.lat] as [number, number] },
      properties: {
        index: i,
        location: e.location,
        country: e.country,
        daysUntil: e.daysUntil,
      },
    }));
    this.techEventSC = new Supercluster({
      radius: 50,
      maxZoom: 14,
      map: (props: Record<string, unknown>) => {
        const daysUntil = Number(props.daysUntil ?? Number.MAX_SAFE_INTEGER);
        return {
          index: Number(props.index ?? 0),
          location: String(props.location ?? ''),
          country: String(props.country ?? ''),
          soonestDaysUntil: Number.isFinite(daysUntil) ? daysUntil : Number.MAX_SAFE_INTEGER,
          soonCount: Number.isFinite(daysUntil) && daysUntil <= 14 ? 1 : 0,
        };
      },
      reduce: (acc: Record<string, unknown>, props: Record<string, unknown>) => {
        acc.soonestDaysUntil = Math.min(
          Number(acc.soonestDaysUntil ?? Number.MAX_SAFE_INTEGER),
          Number(props.soonestDaysUntil ?? Number.MAX_SAFE_INTEGER),
        );
        acc.soonCount = Number(acc.soonCount ?? 0) + Number(props.soonCount ?? 0);
        if (!acc.location && props.location) acc.location = props.location;
        if (!acc.country && props.country) acc.country = props.country;
      },
    });
    this.techEventSC.load(points);
    this.lastSCZoom = -1;
  }

  private rebuildDatacenterSupercluster(): void {
    const activeDCs = AI_DATA_CENTERS.filter(dc => dc.status !== 'decommissioned');
    const points = activeDCs.map((dc, i) => ({
      type: 'Feature' as const,
      geometry: { type: 'Point' as const, coordinates: [dc.lon, dc.lat] as [number, number] },
      properties: {
        index: i,
        country: dc.country,
        chipCount: dc.chipCount,
        powerMW: dc.powerMW ?? 0,
        status: dc.status,
      },
    }));
    this.datacenterSC = new Supercluster({
      radius: 70,
      maxZoom: 14,
      map: (props: Record<string, unknown>) => ({
        index: Number(props.index ?? 0),
        country: String(props.country ?? ''),
        totalChips: Number(props.chipCount ?? 0) || 0,
        totalPowerMW: Number(props.powerMW ?? 0) || 0,
        existingCount: props.status === 'existing' ? 1 : 0,
        plannedCount: props.status === 'planned' ? 1 : 0,
      }),
      reduce: (acc: Record<string, unknown>, props: Record<string, unknown>) => {
        acc.totalChips = Number(acc.totalChips ?? 0) + Number(props.totalChips ?? 0);
        acc.totalPowerMW = Number(acc.totalPowerMW ?? 0) + Number(props.totalPowerMW ?? 0);
        acc.existingCount = Number(acc.existingCount ?? 0) + Number(props.existingCount ?? 0);
        acc.plannedCount = Number(acc.plannedCount ?? 0) + Number(props.plannedCount ?? 0);
        if (!acc.country && props.country) acc.country = props.country;
      },
    });
    this.datacenterSC.load(points);
    this.lastSCZoom = -1;
  }

  private updateClusterData(): void {
    const zoom = Math.floor(this.maplibreMap?.getZoom() ?? 2);
    const bounds = this.maplibreMap?.getBounds();
    if (!bounds) return;
    const bbox: [number, number, number, number] = [
      bounds.getWest(), bounds.getSouth(), bounds.getEast(), bounds.getNorth(),
    ];
    const boundsKey = `${bbox[0].toFixed(3)}:${bbox[1].toFixed(3)}:${bbox[2].toFixed(3)}:${bbox[3].toFixed(3)}`;
    const layers = this.state.layers;
    const useProtests = layers.protests && this.protestSuperclusterSource.length > 0;
    const useTechHQ = SITE_VARIANT === 'tech' && layers.techHQs;
    const useTechEvents = SITE_VARIANT === 'tech' && layers.techEvents && this.techEvents.length > 0;
    const useDatacenterClusters = layers.datacenters && zoom < 5;
    const layerMask = `${Number(useProtests)}${Number(useTechHQ)}${Number(useTechEvents)}${Number(useDatacenterClusters)}`;
    if (zoom === this.lastSCZoom && boundsKey === this.lastSCBoundsKey && layerMask === this.lastSCMask) return;
    this.lastSCZoom = zoom;
    this.lastSCBoundsKey = boundsKey;
    this.lastSCMask = layerMask;

    if (useProtests && this.protestSC) {
      this.protestClusters = this.protestSC.getClusters(bbox, zoom).map(f => {
        const coords = f.geometry.coordinates as [number, number];
        if (f.properties.cluster) {
          const props = f.properties as Record<string, unknown>;
          const leaves = this.protestSC!.getLeaves(f.properties.cluster_id!, DeckGLMap.MAX_CLUSTER_LEAVES);
          const items = leaves.map(l => this.protestSuperclusterSource[l.properties.index]).filter((x): x is SocialUnrestEvent => !!x);
          const maxSeverityRank = Number(props.maxSeverityRank ?? 0);
          const maxSev = maxSeverityRank >= 2 ? 'high' : maxSeverityRank === 1 ? 'medium' : 'low';
          const riotCount = Number(props.riotCount ?? 0);
          const highSeverityCount = Number(props.highSeverityCount ?? 0);
          const verifiedCount = Number(props.verifiedCount ?? 0);
          const totalFatalities = Number(props.totalFatalities ?? 0);
          const clusterCount = Number(f.properties.point_count ?? items.length);
          const latestRiotEventTimeMs = items.reduce((max, it) => {
            if (it.eventType !== 'riot' || it.sourceType === 'gdelt') return max;
            const ts = it.time.getTime();
            return Number.isFinite(ts) ? Math.max(max, ts) : max;
          }, 0);
          return {
            id: `pc-${f.properties.cluster_id}`,
            lat: coords[1], lon: coords[0],
            count: clusterCount,
            items,
            country: String(props.country ?? items[0]?.country ?? ''),
            maxSeverity: maxSev as 'low' | 'medium' | 'high',
            hasRiot: riotCount > 0,
            latestRiotEventTimeMs: latestRiotEventTimeMs || undefined,
            totalFatalities,
            riotCount,
            highSeverityCount,
            verifiedCount,
            sampled: items.length < clusterCount,
          };
        }
        const item = this.protestSuperclusterSource[f.properties.index]!;
        return {
          id: `pp-${f.properties.index}`, lat: item.lat, lon: item.lon,
          count: 1, items: [item], country: item.country,
          maxSeverity: item.severity, hasRiot: item.eventType === 'riot',
          latestRiotEventTimeMs:
            item.eventType === 'riot' && item.sourceType !== 'gdelt' && Number.isFinite(item.time.getTime())
              ? item.time.getTime()
              : undefined,
          totalFatalities: item.fatalities ?? 0,
          riotCount: item.eventType === 'riot' ? 1 : 0,
          highSeverityCount: item.severity === 'high' ? 1 : 0,
          verifiedCount: item.validated ? 1 : 0,
          sampled: false,
        };
      });
    } else {
      this.protestClusters = [];
    }

    if (useTechHQ && this.techHQSC) {
      this.techHQClusters = this.techHQSC.getClusters(bbox, zoom).map(f => {
        const coords = f.geometry.coordinates as [number, number];
        if (f.properties.cluster) {
          const props = f.properties as Record<string, unknown>;
          const leaves = this.techHQSC!.getLeaves(f.properties.cluster_id!, DeckGLMap.MAX_CLUSTER_LEAVES);
          const items = leaves.map(l => TECH_HQS[l.properties.index]).filter(Boolean) as typeof TECH_HQS;
          const faangCount = Number(props.faangCount ?? 0);
          const unicornCount = Number(props.unicornCount ?? 0);
          const publicCount = Number(props.publicCount ?? 0);
          const clusterCount = Number(f.properties.point_count ?? items.length);
          const primaryType = faangCount >= unicornCount && faangCount >= publicCount
            ? 'faang'
            : unicornCount >= publicCount
              ? 'unicorn'
              : 'public';
          return {
            id: `hc-${f.properties.cluster_id}`,
            lat: coords[1], lon: coords[0],
            count: clusterCount,
            items,
            city: String(props.city ?? items[0]?.city ?? ''),
            country: String(props.country ?? items[0]?.country ?? ''),
            primaryType,
            faangCount,
            unicornCount,
            publicCount,
            sampled: items.length < clusterCount,
          };
        }
        const item = TECH_HQS[f.properties.index]!;
        return {
          id: `hp-${f.properties.index}`, lat: item.lat, lon: item.lon,
          count: 1, items: [item], city: item.city, country: item.country,
          primaryType: item.type,
          faangCount: item.type === 'faang' ? 1 : 0,
          unicornCount: item.type === 'unicorn' ? 1 : 0,
          publicCount: item.type === 'public' ? 1 : 0,
          sampled: false,
        };
      });
    } else {
      this.techHQClusters = [];
    }

    if (useTechEvents && this.techEventSC) {
      this.techEventClusters = this.techEventSC.getClusters(bbox, zoom).map(f => {
        const coords = f.geometry.coordinates as [number, number];
        if (f.properties.cluster) {
          const props = f.properties as Record<string, unknown>;
          const leaves = this.techEventSC!.getLeaves(f.properties.cluster_id!, DeckGLMap.MAX_CLUSTER_LEAVES);
          const items = leaves.map(l => this.techEvents[l.properties.index]).filter((x): x is TechEventMarker => !!x);
          const clusterCount = Number(f.properties.point_count ?? items.length);
          const soonestDaysUntil = Number(props.soonestDaysUntil ?? Number.MAX_SAFE_INTEGER);
          const soonCount = Number(props.soonCount ?? 0);
          return {
            id: `ec-${f.properties.cluster_id}`,
            lat: coords[1], lon: coords[0],
            count: clusterCount,
            items,
            location: String(props.location ?? items[0]?.location ?? ''),
            country: String(props.country ?? items[0]?.country ?? ''),
            soonestDaysUntil: Number.isFinite(soonestDaysUntil) ? soonestDaysUntil : Number.MAX_SAFE_INTEGER,
            soonCount,
            sampled: items.length < clusterCount,
          };
        }
        const item = this.techEvents[f.properties.index]!;
        return {
          id: `ep-${f.properties.index}`, lat: item.lat, lon: item.lng,
          count: 1, items: [item], location: item.location, country: item.country,
          soonestDaysUntil: item.daysUntil,
          soonCount: item.daysUntil <= 14 ? 1 : 0,
          sampled: false,
        };
      });
    } else {
      this.techEventClusters = [];
    }

    if (useDatacenterClusters && this.datacenterSC) {
      const activeDCs = AI_DATA_CENTERS.filter(dc => dc.status !== 'decommissioned');
      this.datacenterClusters = this.datacenterSC.getClusters(bbox, zoom).map(f => {
        const coords = f.geometry.coordinates as [number, number];
        if (f.properties.cluster) {
          const props = f.properties as Record<string, unknown>;
          const leaves = this.datacenterSC!.getLeaves(f.properties.cluster_id!, DeckGLMap.MAX_CLUSTER_LEAVES);
          const items = leaves.map(l => activeDCs[l.properties.index]).filter((x): x is AIDataCenter => !!x);
          const clusterCount = Number(f.properties.point_count ?? items.length);
          const existingCount = Number(props.existingCount ?? 0);
          const plannedCount = Number(props.plannedCount ?? 0);
          const totalChips = Number(props.totalChips ?? 0);
          const totalPowerMW = Number(props.totalPowerMW ?? 0);
          return {
            id: `dc-${f.properties.cluster_id}`,
            lat: coords[1], lon: coords[0],
            count: clusterCount,
            items,
            region: String(props.country ?? items[0]?.country ?? ''),
            country: String(props.country ?? items[0]?.country ?? ''),
            totalChips,
            totalPowerMW,
            majorityExisting: existingCount >= Math.max(1, clusterCount / 2),
            existingCount,
            plannedCount,
            sampled: items.length < clusterCount,
          };
        }
        const item = activeDCs[f.properties.index]!;
        return {
          id: `dp-${f.properties.index}`, lat: item.lat, lon: item.lon,
          count: 1, items: [item], region: item.country, country: item.country,
          totalChips: item.chipCount, totalPowerMW: item.powerMW ?? 0,
          majorityExisting: item.status === 'existing',
          existingCount: item.status === 'existing' ? 1 : 0,
          plannedCount: item.status === 'planned' ? 1 : 0,
          sampled: false,
        };
      });
    } else {
      this.datacenterClusters = [];
    }
  }

  private invalidateClusterViewportCache(): void {
    this.lastSCZoom = -1;
    this.lastSCBoundsKey = '';
    this.lastSCMask = '';
  }




  private isLayerVisible(layerKey: keyof MapLayers): boolean {
    const threshold = LAYER_ZOOM_THRESHOLDS[layerKey];
    if (!threshold) return true;
    const zoom = this.maplibreMap?.getZoom() || 2;
    return zoom >= threshold.minZoom;
  }

  private buildLayers(): LayersList {
    const startTime = performance.now();
    // Refresh theme-aware overlay colors on each rebuild
    COLORS = getOverlayColors();
    const layers: (Layer | null | false)[] = [];
    const { layers: mapLayers } = this.state;
    const filteredEarthquakes = this.filterByTime(this.earthquakes, (eq) => eq.occurredAt);
    const filteredNaturalEvents = this.filterByTime(this.naturalEvents, (event) => event.date);
    const filteredWeatherAlerts = this.filterByTime(this.weatherAlerts, (alert) => alert.onset);
    const filteredOutages = this.filterByTime(this.outages, (outage) => outage.pubDate);
    const filteredCableAdvisories = this.filterByTime(this.cableAdvisories, (advisory) => advisory.reported);
    const filteredFlightDelays = this.filterByTime(this.flightDelays, (delay) => delay.updatedAt);
    const currentZoom = this.maplibreMap?.getZoom() || 2;
    const lodLevel = this.getLodLevel(currentZoom);
    const filteredMilitaryFlights = this.filterMilitaryFlightsForRendering(
      this.filterByTime(this.militaryFlights, (flight) => flight.lastSeen),
    );
    const filteredMilitaryVessels = this.filterByTime(this.militaryVessels, (vessel) => vessel.lastAisUpdate);
    const filteredMilitaryFlightClusters = this.filterMilitaryFlightClustersByTime(this.militaryFlightClusters);
    const filteredMilitaryVesselClusters = this.filterMilitaryVesselClustersByTime(this.militaryVesselClusters);
    const filteredUcdpEvents = this.filterByTime(this.ucdpEvents, (event) => event.date_start);
    const baseData = this.runtimeMilitaryBases && this.runtimeMilitaryBases.length > 0
      ? this.runtimeMilitaryBases
      : MILITARY_BASES;

    // Undersea cables layer
    if (mapLayers.cables) {
      layers.push(this.createCablesLayer());
    } else {
      this.layerCache.delete('cables-layer');
    }

    // Pipelines layer
    if (mapLayers.pipelines) {
      layers.push(this.createPipelinesLayer());
    } else {
      this.layerCache.delete('pipelines-layer');
    }

    // Conflict zones layer
    if (mapLayers.conflicts) {
      layers.push(...this.createConflictZoneLayers());
    } else {
      this.updateConflictCountryRiskLayers([]);
    }

    if (mapLayers.conflicts || mapLayers.hotspots || mapLayers.military || mapLayers.ais || mapLayers.intelDensity) {
      const riskPoints = this.createRiskSurfacePoints();
      if (riskPoints.length > 0) {
        if (lodLevel === 'local') {
          // Global/regional heat bubbles dominated the map and obscured actual event markers.
          layers.push(this.createRiskSurfaceLayer(riskPoints, lodLevel));
        }
        if (mapLayers.intelDensity && lodLevel !== 'local') {
          const intelDensityLayer = this.createIntelDensityHexagonLayer(riskPoints, lodLevel);
          if (intelDensityLayer) layers.push(intelDensityLayer);
        }
      }
    }

    if (mapLayers.dayNight && lodLevel !== 'local') {
      layers.push(...this.createDayNightLayers());
    }

    // Military bases layer – hidden at low zoom (E: progressive disclosure) + ghost
    if (mapLayers.bases && this.isLayerVisible('bases') && lodLevel !== 'global') {
      layers.push(this.createBasesLayer());
      layers.push(this.createGhostLayer('bases-layer', baseData, d => [d.lon, d.lat], { radiusMinPixels: 12 }));
    }

    // Nuclear facilities layer – hidden at low zoom + ghost
    if (mapLayers.nuclear && this.isLayerVisible('nuclear') && lodLevel !== 'global') {
      layers.push(this.createNuclearLayer());
      layers.push(this.createGhostLayer('nuclear-layer', NUCLEAR_FACILITIES.filter(f => f.status !== 'decommissioned'), d => [d.lon, d.lat], { radiusMinPixels: 12 }));
    }

    // Gamma irradiators layer – hidden at low zoom
    if (mapLayers.irradiators && this.isLayerVisible('irradiators') && lodLevel === 'local') {
      layers.push(this.createIrradiatorsLayer());
    }

    // Spaceports layer – hidden at low zoom
    if (mapLayers.spaceports && this.isLayerVisible('spaceports') && lodLevel !== 'global') {
      layers.push(this.createSpaceportsLayer());
    }

    // Hotspots layer (all hotspots including high/breaking, with pulse + ghost)
    if (mapLayers.hotspots) {
      layers.push(...this.createHotspotsLayers());
    }

    // Datacenters layer - SQUARE icons at zoom >= 5, cluster dots at zoom < 5
    if (mapLayers.datacenters) {
      if (currentZoom >= 5) {
        layers.push(this.createDatacentersLayer());
      } else {
        layers.push(...this.createDatacenterClusterLayers());
      }
    }

    // Earthquakes layer + ghost for easier picking
    if (mapLayers.natural && filteredEarthquakes.length > 0) {
      layers.push(this.createEarthquakesLayer(filteredEarthquakes));
      layers.push(this.createGhostLayer('earthquakes-layer', filteredEarthquakes, d => [d.location?.longitude ?? 0, d.location?.latitude ?? 0], { radiusMinPixels: 12 }));
    }

    // Natural events layer
    if (mapLayers.natural && filteredNaturalEvents.length > 0) {
      layers.push(this.createNaturalEventsLayer(filteredNaturalEvents));
    }

    // Satellite fires layer (NASA FIRMS)
    if (mapLayers.fires && this.firmsFireData.length > 0) {
      layers.push(this.createFiresLayer());
    }

    // Weather alerts layer
    if (mapLayers.weather && filteredWeatherAlerts.length > 0) {
      layers.push(this.createWeatherLayer(filteredWeatherAlerts));
    }

    // Internet outages layer + ghost for easier picking
    if (mapLayers.outages && filteredOutages.length > 0 && lodLevel !== 'global') {
      layers.push(this.createOutagesLayer(filteredOutages));
      layers.push(this.createGhostLayer('outages-layer', filteredOutages, d => [d.lon, d.lat], { radiusMinPixels: 12 }));
    }

    // Cyber threat IOC layer
    if (mapLayers.cyberThreats && this.cyberThreats.length > 0 && lodLevel !== 'global') {
      layers.push(this.createCyberThreatsLayer());
      layers.push(this.createGhostLayer('cyber-threats-layer', this.cyberThreats, d => [d.lon, d.lat], { radiusMinPixels: 12 }));
    }

    // AIS density layer
    if (mapLayers.ais && this.aisDensity.length > 0) {
      layers.push(this.createAisDensityLayer());
    }

    // AIS disruptions layer (spoofing/jamming)
    if (mapLayers.ais && this.aisDisruptions.length > 0 && lodLevel !== 'global') {
      layers.push(this.createAisDisruptionsLayer());
    }

    // Strategic ports layer (shown with AIS)
    if (mapLayers.ais) {
      layers.push(this.createPortsLayer());
    }

    // Cable advisories layer (shown with cables)
    if (mapLayers.cables && filteredCableAdvisories.length > 0 && lodLevel !== 'global') {
      layers.push(this.createCableAdvisoriesLayer(filteredCableAdvisories));
    }

    // Repair ships layer (shown with cables)
    if (mapLayers.cables && this.repairShips.length > 0 && lodLevel !== 'global') {
      layers.push(this.createRepairShipsLayer());
    }

    // Flight delays layer
    if (mapLayers.flights && filteredFlightDelays.length > 0 && lodLevel !== 'global') {
      layers.push(this.createFlightDelaysLayer(filteredFlightDelays));
    }

    // Protests layer (Supercluster-based deck.gl layers)
    if (mapLayers.protests && this.protests.length > 0) {
      layers.push(...this.createProtestClusterLayers());
    }

    if (mapLayers.iranAttacks && this.iranEvents.length > 0 && lodLevel !== 'global') {
      layers.push(this.createIranEventsLayer());
    }

    if (mapLayers.gpsJamming && this.gpsJammingHexes.length > 0 && lodLevel !== 'global') {
      layers.push(this.createGpsJammingLayer());
    }

    // Military vessels layer
    if (mapLayers.military && filteredMilitaryVessels.length > 0 && lodLevel === 'local') {
      layers.push(this.createMilitaryVesselsLayer(filteredMilitaryVessels));
    }

    // Military vessel clusters layer
    if (mapLayers.military && filteredMilitaryVesselClusters.length > 0 && lodLevel !== 'local') {
      layers.push(this.createMilitaryVesselClustersLayer(filteredMilitaryVesselClusters));
    }

    // Military flights layer
    if (mapLayers.military && filteredMilitaryFlights.length > 0 && lodLevel === 'local') {
      layers.push(this.createMilitaryFlightsLayer(filteredMilitaryFlights));
    }

    // Military flight clusters layer
    if (mapLayers.military && filteredMilitaryFlightClusters.length > 0 && lodLevel !== 'local') {
      layers.push(this.createMilitaryFlightClustersLayer(filteredMilitaryFlightClusters));
    }

    // Strategic waterways layer
    if (mapLayers.waterways) {
      layers.push(this.createWaterwaysLayer());
    }

    // Economic centers layer — hidden at low zoom
    if (mapLayers.economic && this.isLayerVisible('economic')) {
      layers.push(this.createEconomicCentersLayer());
    }

    // Finance variant layers
    if (mapLayers.stockExchanges) {
      layers.push(this.createStockExchangesLayer());
    }
    if (mapLayers.financialCenters) {
      layers.push(this.createFinancialCentersLayer());
    }
    if (mapLayers.centralBanks) {
      layers.push(this.createCentralBanksLayer());
    }
    if (mapLayers.commodityHubs) {
      layers.push(this.createCommodityHubsLayer());
    }

    // Critical minerals layer
    if (mapLayers.minerals) {
      layers.push(this.createMineralsLayer());
    }

    // APT Groups layer (geopolitical variant only - always shown, no toggle)
    if (SITE_VARIANT !== 'tech' && SITE_VARIANT !== 'happy') {
      layers.push(this.createAPTGroupsLayer());
    }

    // UCDP georeferenced events layer
    if (mapLayers.ucdpEvents && filteredUcdpEvents.length > 0) {
      layers.push(this.createUcdpEventsLayer(filteredUcdpEvents));
    }

    // Displacement flows arc layer
    if (mapLayers.displacement && this.displacementFlows.length > 0) {
      layers.push(this.createDisplacementArcsLayer());
    }

    // Broad heatmap blobs overwhelm the geopolitical map at world/regional zoom.
    // Keep climate anomalies only for local inspection.
    if (mapLayers.climate && lodLevel === 'local' && this.climateAnomalies.length > 0) {
      layers.push(this.createClimateHeatmapLayer());
    }

    // Trade routes layer
    if (mapLayers.tradeRoutes) {
      layers.push(this.createTradeRoutesLayer());
      layers.push(this.createTradeChokepointsLayer());
    } else {
      this.layerCache.delete('trade-routes-layer');
      this.layerCache.delete('trade-chokepoints-layer');
    }

    // Tech variant layers (Supercluster-based deck.gl layers for HQs and events)
    if (SITE_VARIANT === 'tech') {
      if (mapLayers.startupHubs) {
        layers.push(this.createStartupHubsLayer());
      }
      if (mapLayers.techHQs) {
        layers.push(...this.createTechHQClusterLayers());
      }
      if (mapLayers.accelerators) {
        layers.push(this.createAcceleratorsLayer());
      }
      if (mapLayers.cloudRegions) {
        layers.push(this.createCloudRegionsLayer());
      }
      if (mapLayers.techEvents && this.techEvents.length > 0) {
        layers.push(...this.createTechEventClusterLayers());
      }
    }

    // Gulf FDI investments layer
    if (mapLayers.gulfInvestments) {
      layers.push(this.createGulfInvestmentsLayer());
    }

    // Positive events layer (happy variant)
    if (mapLayers.positiveEvents && this.positiveEvents.length > 0) {
      layers.push(...this.createPositiveEventsLayers());
    }

    // Kindness layer (happy variant -- green baseline pulses + real kindness events)
    if (mapLayers.kindness && this.kindnessPoints.length > 0) {
      layers.push(...this.createKindnessLayers());
    }

    // Phase 8: Happiness choropleth (rendered below point markers)
    if (mapLayers.happiness) {
      const choropleth = this.createHappinessChoroplethLayer();
      if (choropleth) layers.push(choropleth);
    }
    // Phase 8: Species recovery zones
    if (mapLayers.speciesRecovery && this.speciesRecoveryZones.length > 0) {
      layers.push(this.createSpeciesRecoveryLayer());
    }
    // Phase 8: Renewable energy installations
    if (mapLayers.renewableInstallations && this.renewableInstallations.length > 0) {
      layers.push(this.createRenewableInstallationsLayer());
    }

    // News geo-locations (always shown if data exists)
    if (this.countryInteractionArcs.length > 0 || this.countryInteractionNodes.length > 0) {
      layers.push(...this.createCountryInteractionLayers(lodLevel));
    }

    // News geo-locations (always shown if data exists)
    if (this.newsLocations.length > 0) {
      layers.push(...this.createNewsLocationsLayer(lodLevel));
    }

    const glowLayer = this.createPriorityGlowLayer(lodLevel);
    if (glowLayer) {
      layers.push(glowLayer);
    }

    const result = layers.filter(Boolean) as LayersList;
    const elapsed = performance.now() - startTime;
    if (import.meta.env.DEV && elapsed > 16) {
      console.warn(`[DeckGLMap] buildLayers took ${elapsed.toFixed(2)}ms (>16ms budget), ${result.length} layers`);
    }
    return result;
  }

  // Layer creation methods
  private createCablesLayer(): PathLayer {
    const highlightedCables = this.highlightedAssets.cable;
    const cacheKey = 'cables-layer';
    const cached = this.layerCache.get(cacheKey) as PathLayer | undefined;
    const highlightSignature = this.getSetSignature(highlightedCables);
    const healthSignature = Object.keys(this.healthByCableId).sort().join(',');
    if (cached && highlightSignature === this.lastCableHighlightSignature && healthSignature === this.lastCableHealthSignature) return cached;

    const health = this.healthByCableId;
    const layer = new PathLayer({
      id: cacheKey,
      data: UNDERSEA_CABLES,
      getPath: (d) => d.points,
      getColor: (d) => {
        if (highlightedCables.has(d.id)) return COLORS.cableHighlight;
        const h = health[d.id];
        if (h?.status === 'fault') return COLORS.cableFault;
        if (h?.status === 'degraded') return COLORS.cableDegraded;
        return COLORS.cable;
      },
      getWidth: (d) => {
        if (highlightedCables.has(d.id)) return 3;
        const h = health[d.id];
        if (h?.status === 'fault') return 2.5;
        if (h?.status === 'degraded') return 2;
        return 1;
      },
      widthMinPixels: 1,
      widthMaxPixels: 5,
      pickable: true,
      updateTriggers: { highlighted: highlightSignature, health: healthSignature },
    });

    this.lastCableHighlightSignature = highlightSignature;
    this.lastCableHealthSignature = healthSignature;
    this.layerCache.set(cacheKey, layer);
    return layer;
  }

  private createPipelinesLayer(): PathLayer {
    const highlightedPipelines = this.highlightedAssets.pipeline;
    const cacheKey = 'pipelines-layer';
    const cached = this.layerCache.get(cacheKey) as PathLayer | undefined;
    const highlightSignature = this.getSetSignature(highlightedPipelines);
    if (cached && highlightSignature === this.lastPipelineHighlightSignature) return cached;

    const layer = new PathLayer({
      id: cacheKey,
      data: PIPELINES,
      getPath: (d) => d.points,
      getColor: (d) => {
        if (highlightedPipelines.has(d.id)) {
          return [255, 100, 100, 200] as [number, number, number, number];
        }
        const colorKey = d.type as keyof typeof PIPELINE_COLORS;
        const hex = PIPELINE_COLORS[colorKey] || '#666666';
        return this.hexToRgba(hex, 150);
      },
      getWidth: (d) => highlightedPipelines.has(d.id) ? 3 : 1.5,
      widthMinPixels: 1,
      widthMaxPixels: 4,
      pickable: true,
      updateTriggers: { highlighted: highlightSignature },
    });

    this.lastPipelineHighlightSignature = highlightSignature;
    this.layerCache.set(cacheKey, layer);
    return layer;
  }

  private getConflictZoneIntensity(zone: ConflictZone): 'high' | 'medium' | 'low' {
    return zone.intensity === 'high' || zone.intensity === 'low' ? zone.intensity : 'medium';
  }

  private getConflictZoneLiftMeters(intensity: 'high' | 'medium' | 'low'): number {
    if (this.projectionMode !== 'globe') return 0;
    if (intensity === 'high') return 18000;
    if (intensity === 'medium') return 13000;
    return 9000;
  }

  private getConflictZoneTag(intensity: 'high' | 'medium' | 'low'): string {
    return intensity === 'high' ? 'WAR ZONE' : 'RISK ZONE';
  }

  private closeConflictZoneRing(ring: Array<[number, number, number]>): Array<[number, number, number]> {
    if (ring.length < 3) return [];
    const first = ring[0];
    const last = ring[ring.length - 1];
    if (!first || !last) return [];
    if (first[0] !== last[0] || first[1] !== last[1] || first[2] !== last[2]) {
      return [...ring, [first[0], first[1], first[2]]];
    }
    return ring;
  }

  private getConflictZoneRenderRing(zone: ConflictZone): Array<[number, number, number]> {
    const [centerLon, centerLat] = zone.center;
    const inflate = this.projectionMode === 'globe' ? 1.01 : 1;
    const intensity = this.getConflictZoneIntensity(zone);
    const lift = this.getConflictZoneLiftMeters(intensity);
    const ring = zone.coords
      .filter(([lon, lat]) => Number.isFinite(lon) && Number.isFinite(lat))
      .map(([lon, lat]) => {
      const shiftedLon = centerLon + (lon - centerLon) * inflate;
      const shiftedLat = centerLat + (lat - centerLat) * inflate;
        return [this.normalizeLongitude(shiftedLon), this.clampLatitude(shiftedLat), lift] as [number, number, number];
      });
    return this.closeConflictZoneRing(ring);
  }

  private getCountryRiskFilter(codes: string[]): maplibregl.FilterSpecification {
    if (codes.length === 0) return ['==', ['get', 'ISO3166-1-Alpha-2'], ''];
    return ['match', ['get', 'ISO3166-1-Alpha-2'], codes, true, false] as maplibregl.FilterSpecification;
  }

  private isMaritimeConflictZone(zone: ConflictZone): boolean {
    if (STATIC_MARITIME_ZONE_IDS.has(zone.id)) return true;
    if (zone.id.startsWith('dynamic-maritime-')) return true;
    const text = `${zone.name || ''} ${zone.location || ''} ${zone.description || ''}`.toLowerCase();
    return MARITIME_ZONE_TEXT_HINT.test(text);
  }

  private getCountryCodesForConflictZone(zone: ConflictZone): string[] {
    const staticHints = STATIC_CONFLICT_ZONE_COUNTRY_HINTS[zone.id];
    if (staticHints?.length) return this.normalizeCountryCodes(staticHints);
    if (this.isMaritimeConflictZone(zone)) return [];

    const centerHit = getCountryAtCoordinates(zone.center[1], zone.center[0]);
    if (centerHit?.code) return [centerHit.code];

    return this.normalizeCountryCodes(matchCountryNamesInText(`${zone.name || ''} ${zone.location || ''}`));
  }

  private updateConflictCountryRiskLayers(zones: ConflictZone[]): void {
    if (!this.maplibreMap || !this.countryGeoJsonLoaded) return;
    const high = new Set<string>();
    const medium = new Set<string>();
    const low = new Set<string>();

    for (const zone of zones) {
      const intensity = this.getConflictZoneIntensity(zone);
      const codes = this.getCountryCodesForConflictZone(zone);
      for (const code of codes) {
        if (!this.getCountryCentroidEntry(code)) continue;
        if (intensity === 'high') high.add(code);
        else if (intensity === 'medium') medium.add(code);
        else low.add(code);
      }
    }

    for (const code of high) {
      medium.delete(code);
      low.delete(code);
    }
    for (const code of medium) {
      low.delete(code);
    }

    const highCodes = this.normalizeCountryCodes(high);
    const mediumCodes = this.normalizeCountryCodes(medium);
    const lowCodes = this.normalizeCountryCodes(low);
    const signature = `h:${highCodes.join(',')}|m:${mediumCodes.join(',')}|l:${lowCodes.join(',')}`;
    if (signature === this.conflictCountryRiskSignature) return;
    this.conflictCountryRiskSignature = signature;

    const riskFilters: Array<[string, maplibregl.FilterSpecification]> = [
      ['country-risk-high-fill', this.getCountryRiskFilter(highCodes)],
      ['country-risk-high-border', this.getCountryRiskFilter(highCodes)],
      ['country-risk-medium-fill', this.getCountryRiskFilter(mediumCodes)],
      ['country-risk-medium-border', this.getCountryRiskFilter(mediumCodes)],
      ['country-risk-low-fill', this.getCountryRiskFilter(lowCodes)],
      ['country-risk-low-border', this.getCountryRiskFilter(lowCodes)],
    ];

    for (const [layerId, filter] of riskFilters) {
      try {
        if (this.maplibreMap.getLayer(layerId)) {
          this.maplibreMap.setFilter(layerId, filter);
        }
      } catch {
        // style reload race; a subsequent render will retry
      }
    }
  }

  private createConflictZonesLayer(zones: ConflictZone[]): GeoJsonLayer {
    const cacheKey = 'conflict-zones-layer';

    const features = zones
      .map((zone) => {
        if (!this.isMaritimeConflictZone(zone) && this.getCountryCodesForConflictZone(zone).length > 0) {
          return null;
        }
        const ring = this.getConflictZoneRenderRing(zone);
        if (ring.length < 4) return null;
        const intensity = this.getConflictZoneIntensity(zone);
        return {
          type: 'Feature' as const,
          properties: {
            id: zone.id,
            name: zone.name,
            intensity,
            tag: this.getConflictZoneTag(intensity),
            lift: this.getConflictZoneLiftMeters(intensity),
          },
          geometry: {
            type: 'Polygon' as const,
            coordinates: [ring],
          },
        };
      })
      .filter((feature): feature is {
        type: 'Feature';
        properties: {
          id: string;
          name: string;
          intensity: 'high' | 'medium' | 'low';
          tag: string;
          lift: number;
        };
        geometry: {
          type: 'Polygon';
          coordinates: Array<Array<[number, number, number]>>;
        };
      } => feature !== null);

    const geojsonData = {
      type: 'FeatureCollection' as const,
      features,
    };

    const layer = new GeoJsonLayer({
      id: cacheKey,
      data: geojsonData,
      filled: true,
      stroked: true,
      getFillColor: (feature) => {
        const intensity = feature?.properties?.intensity ?? 'medium';
        if (intensity === 'high') {
          const alpha = getCurrentTheme() === 'light' ? 44 : 72;
          return [255, 24, 24, alpha] as [number, number, number, number];
        }
        if (intensity === 'low') return getCurrentTheme() === 'light'
          ? [255, 178, 52, 32] as [number, number, number, number]
          : [255, 178, 52, 48] as [number, number, number, number];
        return getCurrentTheme() === 'light'
          ? [255, 106, 32, 36] as [number, number, number, number]
          : [255, 106, 32, 54] as [number, number, number, number];
      },
      getLineColor: (feature) => {
        const intensity = feature?.properties?.intensity ?? 'medium';
        if (intensity === 'high') {
          const alpha = getCurrentTheme() === 'light' ? 175 : 216;
          return [255, 30, 30, alpha] as [number, number, number, number];
        }
        if (intensity === 'low') {
          return getCurrentTheme() === 'light'
            ? [255, 148, 0, 118] as [number, number, number, number]
            : [255, 148, 0, 165] as [number, number, number, number];
        }
        return getCurrentTheme() === 'light'
          ? [255, 94, 0, 136] as [number, number, number, number]
          : [255, 94, 0, 185] as [number, number, number, number];
      },
      getLineWidth: (feature) => {
        const intensity = feature?.properties?.intensity ?? 'medium';
        if (intensity === 'high') return 2.4;
        if (intensity === 'low') return 1.3;
        return 1.8;
      },
      lineWidthMinPixels: 1,
      updateTriggers: {
        projection: this.projectionMode,
      },
      pickable: true,
    });
    return layer;
  }

  private createConflictZoneCentersLayer(zones: ConflictZone[]): ScatterplotLayer<ConflictZoneLabelDatum> {
    const data: ConflictZoneLabelDatum[] = zones
      .map((zone) => {
        const intensity = this.getConflictZoneIntensity(zone);
        return {
          id: zone.id,
          name: zone.name,
          lon: zone.center[0],
          lat: zone.center[1],
          intensity,
          tag: this.getConflictZoneTag(intensity),
        };
      })
      .filter((zone) => zone.intensity !== 'low')
      .slice(0, 14);
    return new ScatterplotLayer<ConflictZoneLabelDatum>({
      id: 'conflict-zone-centers-layer',
      data,
      getPosition: (d) => this.getOverlayPosition(d.lon, d.lat, this.getConflictZoneLiftMeters(d.intensity)),
      getRadius: (d) => d.intensity === 'high' ? 24000 : 18000,
      getFillColor: (d) => d.intensity === 'high'
        ? [255, 36, 36, 24] as [number, number, number, number]
        : [255, 120, 35, 20] as [number, number, number, number],
      getLineColor: (d) => d.intensity === 'high'
        ? [255, 42, 42, 190] as [number, number, number, number]
        : [255, 132, 45, 160] as [number, number, number, number],
      stroked: true,
      filled: true,
      lineWidthMinPixels: 1,
      radiusMinPixels: 3,
      radiusMaxPixels: 14,
      billboard: true,
      pickable: false,
      updateTriggers: {
        projection: this.projectionMode,
      },
    });
  }

  private createConflictZoneLabelsLayer(zones: ConflictZone[]): TextLayer<ConflictZoneLabelDatum> | null {
    const zoom = this.maplibreMap?.getZoom() || 2;
    if (zoom < 3.2) return null;
    const data: ConflictZoneLabelDatum[] = zones
      .map((zone) => {
        const intensity = this.getConflictZoneIntensity(zone);
        return {
          id: zone.id,
          name: zone.name,
          lon: zone.center[0],
          lat: zone.center[1],
          intensity,
          tag: this.getConflictZoneTag(intensity),
        };
      })
      .filter((zone) => zone.intensity === 'high')
      .slice(0, 8);

    return new TextLayer<ConflictZoneLabelDatum>({
      id: 'conflict-zone-labels-layer',
      data,
      getPosition: (d) => this.getOverlayPosition(d.lon, d.lat, this.getConflictZoneLiftMeters(d.intensity) + 2000),
      getText: (d) => d.tag,
      getColor: (d) => d.intensity === 'high'
        ? [255, 70, 70, 240] as [number, number, number, number]
        : [255, 165, 64, 218] as [number, number, number, number],
      getSize: 13,
      sizeUnits: 'pixels',
      getTextAnchor: 'middle',
      getAlignmentBaseline: 'center',
      billboard: true,
      pickable: false,
      updateTriggers: {
        projection: this.projectionMode,
      },
    });
  }

  private createConflictZoneLayers(): Layer[] {
    const zones = this.getRenderableConflictZones();
    for (const zone of zones) {
      if (this.conflictZoneConfidence.has(zone.id)) continue;
      const intensity = this.getConflictZoneIntensity(zone);
      const base = intensity === 'high' ? 0.76 : intensity === 'medium' ? 0.66 : 0.56;
      this.conflictZoneConfidence.set(zone.id, base);
    }
    this.updateConflictCountryRiskLayers(zones);
    if (zones.length === 0) return [];
    return [
      this.createConflictZonesLayer(zones),
      this.createConflictZoneCentersLayer(zones),
      this.createConflictZoneLabelsLayer(zones),
    ].filter(Boolean) as Layer[];
  }

  private getRenderableConflictZones(): ConflictZone[] {
    return this.dynamicConflictZones.length > 0 ? this.dynamicConflictZones : CONFLICT_ZONES;
  }

  private inferConflictPoint(
    item: NewsItem,
  ): { lat: number; lon: number; confidence: number; inferredKind: 'exact' | 'waterway' | 'country'; labelHint?: string } | null {
    if (item.lat != null && item.lon != null && Number.isFinite(item.lat) && Number.isFinite(item.lon)) {
      return {
        lat: item.lat,
        lon: item.lon,
        confidence: 1.0,
        inferredKind: 'exact',
      };
    }

    const text = `${item.title || ''} ${item.locationName || ''}`.trim();
    if (!text) return null;

    const matchedWaterwayPattern = STRATEGIC_WATERWAY_PATTERNS.find((entry) => entry.regex.test(text));
    if (matchedWaterwayPattern) {
      const waterway = STRATEGIC_WATERWAYS.find((w) => w.id === matchedWaterwayPattern.id);
      if (waterway) {
        return {
          lat: waterway.lat,
          lon: waterway.lon,
          confidence: 0.86,
          inferredKind: 'waterway',
          labelHint: waterway.name,
        };
      }
    }

    // Generic maritime story (no explicit coords) -> prefer known chokepoint mention when available.
    if (MARITIME_CONFLICT_TERMS.test(text)) {
      const directNamedWaterway = STRATEGIC_WATERWAYS.find((w) => {
        const simplified = w.name.toLowerCase();
        return text.toLowerCase().includes(simplified) || text.toLowerCase().includes(w.id.replace(/_/g, ' '));
      });
      if (directNamedWaterway) {
        return {
          lat: directNamedWaterway.lat,
          lon: directNamedWaterway.lon,
          confidence: 0.82,
          inferredKind: 'waterway',
          labelHint: directNamedWaterway.name,
        };
      }
    }

    this.ensureCountryCentroids();
    const countryCodes = this.extractCountryCodesFromNewsItem(item);
    const primaryCountryCode = countryCodes[0];
    if (primaryCountryCode) {
      const centroid = this.getCountryCentroidEntry(primaryCountryCode);
      if (centroid) {
        return {
          lat: centroid.lat,
          lon: centroid.lon,
          confidence: 0.52,
          inferredKind: 'country',
          labelHint: centroid.name,
        };
      }
    }

    return null;
  }

  private buildDynamicConflictZones(news: NewsItem[]): ConflictZone[] {
    const now = Date.now();
    const lookbackMs = 48 * 60 * 60 * 1000;
    const buckets = new Map<string, {
      lat: number;
      lon: number;
      count: number;
      qualityScore: number;
      alertCount: number;
      inferredCount: number;
      maritimeCount: number;
      latestTs: number;
      locationHits: Map<string, number>;
      titles: string[];
    }>();

    for (const item of news) {
      const ts = item.pubDate instanceof Date ? item.pubDate.getTime() : new Date(item.pubDate).getTime();
      if (!Number.isFinite(ts) || now - ts > lookbackMs) continue;

      const category = item.threat?.category ?? 'general';
      const conflictLike = item.isAlert
        || category === 'conflict'
        || category === 'military'
        || category === 'terrorism'
        || category === 'protest';
      if (!conflictLike) continue;

      const inferredPoint = this.inferConflictPoint(item);
      if (!inferredPoint) continue;

      const latBin = Math.round(inferredPoint.lat * 2) / 2;
      const lonBin = Math.round(inferredPoint.lon * 2) / 2;
      const key = `${latBin.toFixed(1)}:${lonBin.toFixed(1)}`;
      const bucket = buckets.get(key) ?? {
        lat: latBin,
        lon: lonBin,
        count: 0,
        qualityScore: 0,
        alertCount: 0,
        inferredCount: 0,
        maritimeCount: 0,
        latestTs: 0,
        locationHits: new Map<string, number>(),
        titles: [],
      };

      bucket.count += 1;
      bucket.qualityScore += inferredPoint.confidence;
      if (inferredPoint.inferredKind !== 'exact') bucket.inferredCount += 1;
      if (inferredPoint.inferredKind === 'waterway') bucket.maritimeCount += 1;
      if (item.isAlert) bucket.alertCount += 1;
      if (ts > bucket.latestTs) bucket.latestTs = ts;
      if (item.locationName) {
        const loc = item.locationName.trim();
        if (loc) bucket.locationHits.set(loc, (bucket.locationHits.get(loc) ?? 0) + 1);
      }
      if (inferredPoint.labelHint) {
        const hint = inferredPoint.labelHint.trim();
        if (hint) bucket.locationHits.set(hint, (bucket.locationHits.get(hint) ?? 0) + 1);
      }
      if (bucket.titles.length < 6) bucket.titles.push(item.title);
      buckets.set(key, bucket);
    }

    const dynamic = Array.from(buckets.values())
      .map((bucket) => {
        const recencyBoost = Math.max(0, 2 - (now - bucket.latestTs) / (6 * 60 * 60 * 1000));
        const score = bucket.qualityScore + bucket.alertCount * 2 + recencyBoost;
        const inferredOnly = bucket.inferredCount >= bucket.count;
        if (score < 3) return null;
        if (bucket.count < 2 && bucket.alertCount === 0 && bucket.maritimeCount === 0) return null;
        if (inferredOnly && bucket.alertCount === 0 && bucket.count < 3) return null;

        const dominantLocation = Array.from(bucket.locationHits.entries())
          .sort((a, b) => b[1] - a[1])[0]?.[0];
        const label = dominantLocation || 'Conflict Cluster';
        const radiusDeg = 0.7 + Math.min(2.0, bucket.count * 0.12 + bucket.alertCount * 0.28);
        const maritimeDominant = bucket.maritimeCount >= Math.max(1, Math.ceil(bucket.count * 0.4));

        const intensity: ConflictZone['intensity'] =
          bucket.alertCount >= 2 || bucket.count >= 8
            ? 'high'
            : (bucket.alertCount >= 1 || bucket.count >= 4 ? 'medium' : 'low');
        const confidence = Math.max(0.35, Math.min(0.95, bucket.qualityScore / Math.max(1, bucket.count)));

        const id = `dynamic-${maritimeDominant ? 'maritime' : 'land'}-${bucket.lat.toFixed(1)}-${bucket.lon.toFixed(1)}`;
        this.conflictZoneConfidence.set(id, confidence);

        return {
          id,
          name: `Dynamic ${label}`,
          coords: [
            [bucket.lon - radiusDeg, bucket.lat + radiusDeg],
            [bucket.lon + radiusDeg, bucket.lat + radiusDeg],
            [bucket.lon + radiusDeg, bucket.lat - radiusDeg],
            [bucket.lon - radiusDeg, bucket.lat - radiusDeg],
            [bucket.lon - radiusDeg, bucket.lat + radiusDeg],
          ],
          center: [bucket.lon, bucket.lat],
          intensity,
          location: label,
          description: `Auto-generated from ${bucket.count} recent conflict-related reports (${bucket.alertCount} alerts, inferred=${bucket.inferredCount}).`,
          keyDevelopments: bucket.titles.slice(0, 3),
        } as ConflictZone;
      })
      .filter((zone): zone is ConflictZone => zone !== null)
      .sort((a, b) => {
        const priority = (z: ConflictZone): number => {
          if (z.intensity === 'high') return 3;
          if (z.intensity === 'medium') return 2;
          return 1;
        };
        return priority(b) - priority(a);
      })
      .slice(0, 20);

    return dynamic;
  }

  private createBasesLayer(): IconLayer {
    const highlightedBases = this.highlightedAssets.base;
    const baseData = this.runtimeMilitaryBases && this.runtimeMilitaryBases.length > 0
      ? this.runtimeMilitaryBases
      : MILITARY_BASES;

    // Base colors by operator type - semi-transparent for layering
    // F: Fade in bases as you zoom — subtle at zoom 3, full at zoom 5+
    const zoom = this.maplibreMap?.getZoom() || 3;
    const alphaScale = Math.min(1, (zoom - 2.5) / 2.5); // 0.2 at zoom 3, 1.0 at zoom 5
    const a = Math.round(160 * Math.max(0.3, alphaScale));

    const getBaseColor = (type: string): [number, number, number, number] => {
      switch (type) {
        case 'us-nato': return [68, 136, 255, a];
        case 'russia': return [255, 68, 68, a];
        case 'china': return [255, 136, 68, a];
        case 'uk': return [68, 170, 255, a];
        case 'france': return [0, 85, 164, a];
        case 'india': return [255, 153, 51, a];
        case 'japan': return [188, 0, 45, a];
        default: return [136, 136, 136, a];
      }
    };

    // Military bases: TRIANGLE icons - color by operator, semi-transparent
    return new IconLayer({
      id: 'bases-layer',
      data: baseData,
      getPosition: (d) => [d.lon, d.lat],
      getIcon: () => 'triangleUp',
      iconAtlas: MARKER_ICONS.triangleUp,
      iconMapping: { triangleUp: { x: 0, y: 0, width: 32, height: 32, mask: true } },
      getSize: (d) => highlightedBases.has(d.id) ? 16 : 11,
      getColor: (d) => {
        if (highlightedBases.has(d.id)) {
          return [255, 100, 100, 220] as [number, number, number, number];
        }
        return getBaseColor(d.type);
      },
      sizeScale: 1,
      sizeMinPixels: 6,
      sizeMaxPixels: 16,
      pickable: true,
    });
  }

  private createNuclearLayer(): IconLayer {
    const highlightedNuclear = this.highlightedAssets.nuclear;
    const data = NUCLEAR_FACILITIES.filter(f => f.status !== 'decommissioned');

    // Nuclear: HEXAGON icons - yellow/orange color, semi-transparent
    return new IconLayer({
      id: 'nuclear-layer',
      data,
      getPosition: (d) => [d.lon, d.lat],
      getIcon: () => 'hexagon',
      iconAtlas: MARKER_ICONS.hexagon,
      iconMapping: { hexagon: { x: 0, y: 0, width: 32, height: 32, mask: true } },
      getSize: (d) => highlightedNuclear.has(d.id) ? 15 : 11,
      getColor: (d) => {
        if (highlightedNuclear.has(d.id)) {
          return [255, 100, 100, 220] as [number, number, number, number];
        }
        if (d.status === 'contested') {
          return [255, 50, 50, 200] as [number, number, number, number];
        }
        return [255, 220, 0, 200] as [number, number, number, number]; // Semi-transparent yellow
      },
      sizeScale: 1,
      sizeMinPixels: 6,
      sizeMaxPixels: 15,
      pickable: true,
    });
  }

  private createIrradiatorsLayer(): ScatterplotLayer {
    return new ScatterplotLayer({
      id: 'irradiators-layer',
      data: GAMMA_IRRADIATORS,
      getPosition: (d) => [d.lon, d.lat],
      getRadius: 6000,
      getFillColor: [255, 100, 255, 180] as [number, number, number, number], // Magenta
      radiusMinPixels: 4,
      radiusMaxPixels: 10,
      pickable: true,
    });
  }

  private createSpaceportsLayer(): ScatterplotLayer {
    return new ScatterplotLayer({
      id: 'spaceports-layer',
      data: SPACEPORTS,
      getPosition: (d) => [d.lon, d.lat],
      getRadius: 10000,
      getFillColor: [200, 100, 255, 200] as [number, number, number, number], // Purple
      radiusMinPixels: 5,
      radiusMaxPixels: 12,
      pickable: true,
    });
  }

  private createPortsLayer(): ScatterplotLayer {
    return new ScatterplotLayer({
      id: 'ports-layer',
      data: PORTS,
      getPosition: (d) => [d.lon, d.lat],
      getRadius: 6000,
      getFillColor: (d) => {
        // Color by port type (matching old Map.ts icons)
        switch (d.type) {
          case 'naval': return [100, 150, 255, 200] as [number, number, number, number]; // Blue - ⚓
          case 'oil': return [255, 140, 0, 200] as [number, number, number, number]; // Orange - 🛢️
          case 'lng': return [255, 200, 50, 200] as [number, number, number, number]; // Yellow - 🛢️
          case 'container': return [0, 200, 255, 180] as [number, number, number, number]; // Cyan - 🏭
          case 'mixed': return [150, 200, 150, 180] as [number, number, number, number]; // Green
          case 'bulk': return [180, 150, 120, 180] as [number, number, number, number]; // Brown
          default: return [0, 200, 255, 160] as [number, number, number, number];
        }
      },
      radiusMinPixels: 4,
      radiusMaxPixels: 10,
      pickable: true,
    });
  }

  private createFlightDelaysLayer(delays: AirportDelayAlert[]): ScatterplotLayer {
    return new ScatterplotLayer({
      id: 'flight-delays-layer',
      data: delays,
      getPosition: (d) => [d.lon, d.lat],
      getRadius: (d) => {
        if (d.severity === 'GDP') return 15000; // Ground Delay Program
        if (d.severity === 'GS') return 12000; // Ground Stop
        return 8000;
      },
      getFillColor: (d) => {
        if (d.severity === 'GS') return [255, 50, 50, 200] as [number, number, number, number]; // Red for ground stops
        if (d.severity === 'GDP') return [255, 150, 0, 200] as [number, number, number, number]; // Orange for delays
        return [255, 200, 100, 180] as [number, number, number, number]; // Yellow
      },
      radiusMinPixels: 4,
      radiusMaxPixels: 15,
      pickable: true,
    });
  }

  private createGhostLayer<T>(id: string, data: T[], getPosition: (d: T) => [number, number], opts: { radiusMinPixels?: number } = {}): ScatterplotLayer<T> {
    return new ScatterplotLayer<T>({
      id: `${id}-ghost`,
      data,
      getPosition,
      getRadius: 1,
      radiusMinPixels: opts.radiusMinPixels ?? 12,
      getFillColor: [0, 0, 0, 0],
      pickable: true,
    });
  }


  private createDatacentersLayer(): IconLayer {
    const highlightedDC = this.highlightedAssets.datacenter;
    const data = AI_DATA_CENTERS.filter(dc => dc.status !== 'decommissioned');

    // Datacenters: SQUARE icons - purple color, semi-transparent for layering
    return new IconLayer({
      id: 'datacenters-layer',
      data,
      getPosition: (d) => [d.lon, d.lat],
      getIcon: () => 'square',
      iconAtlas: MARKER_ICONS.square,
      iconMapping: { square: { x: 0, y: 0, width: 32, height: 32, mask: true } },
      getSize: (d) => highlightedDC.has(d.id) ? 14 : 10,
      getColor: (d) => {
        if (highlightedDC.has(d.id)) {
          return [255, 100, 100, 200] as [number, number, number, number];
        }
        if (d.status === 'planned') {
          return [136, 68, 255, 100] as [number, number, number, number]; // Transparent for planned
        }
        return [136, 68, 255, 140] as [number, number, number, number]; // ~55% opacity
      },
      sizeScale: 1,
      sizeMinPixels: 6,
      sizeMaxPixels: 14,
      pickable: true,
    });
  }

  private createEarthquakesLayer(earthquakes: Earthquake[]): ScatterplotLayer {
    return new ScatterplotLayer({
      id: 'earthquakes-layer',
      data: earthquakes,
      getPosition: (d) => [d.location?.longitude ?? 0, d.location?.latitude ?? 0],
      getRadius: (d) => Math.pow(2, d.magnitude) * 1000,
      getFillColor: (d) => {
        const mag = d.magnitude;
        if (mag >= 6) return [255, 0, 0, 200] as [number, number, number, number];
        if (mag >= 5) return [255, 100, 0, 200] as [number, number, number, number];
        return COLORS.earthquake;
      },
      radiusMinPixels: 4,
      radiusMaxPixels: 30,
      pickable: true,
    });
  }

  private createNaturalEventsLayer(events: NaturalEvent[]): ScatterplotLayer {
    return new ScatterplotLayer({
      id: 'natural-events-layer',
      data: events,
      getPosition: (d: NaturalEvent) => [d.lon, d.lat],
      getRadius: (d: NaturalEvent) => d.title.startsWith('🔴') ? 20000 : d.title.startsWith('🟠') ? 15000 : 8000,
      getFillColor: (d: NaturalEvent) => {
        if (d.title.startsWith('🔴')) return [255, 0, 0, 220] as [number, number, number, number];
        if (d.title.startsWith('🟠')) return [255, 140, 0, 200] as [number, number, number, number];
        return [255, 150, 50, 180] as [number, number, number, number];
      },
      radiusMinPixels: 5,
      radiusMaxPixels: 18,
      pickable: true,
    });
  }

  private createFiresLayer(): ScatterplotLayer {
    return new ScatterplotLayer({
      id: 'fires-layer',
      data: this.firmsFireData,
      getPosition: (d: (typeof this.firmsFireData)[0]) => [d.lon, d.lat],
      getRadius: (d: (typeof this.firmsFireData)[0]) => Math.min(d.frp * 200, 30000) || 5000,
      getFillColor: (d: (typeof this.firmsFireData)[0]) => {
        if (d.brightness > 400) return [255, 30, 0, 220] as [number, number, number, number];
        if (d.brightness > 350) return [255, 140, 0, 200] as [number, number, number, number];
        return [255, 220, 50, 180] as [number, number, number, number];
      },
      radiusMinPixels: 3,
      radiusMaxPixels: 12,
      pickable: true,
    });
  }

  private createWeatherLayer(alerts: WeatherAlert[]): ScatterplotLayer {
    // Filter weather alerts that have centroid coordinates
    const alertsWithCoords = alerts.filter(a => a.centroid && a.centroid.length === 2);

    return new ScatterplotLayer({
      id: 'weather-layer',
      data: alertsWithCoords,
      getPosition: (d) => d.centroid as [number, number], // centroid is [lon, lat]
      getRadius: 25000,
      getFillColor: (d) => {
        if (d.severity === 'Extreme') return [255, 0, 0, 200] as [number, number, number, number];
        if (d.severity === 'Severe') return [255, 100, 0, 180] as [number, number, number, number];
        if (d.severity === 'Moderate') return [255, 170, 0, 160] as [number, number, number, number];
        return COLORS.weather;
      },
      radiusMinPixels: 8,
      radiusMaxPixels: 20,
      pickable: true,
    });
  }

  private createOutagesLayer(outages: InternetOutage[]): ScatterplotLayer {
    return new ScatterplotLayer({
      id: 'outages-layer',
      data: outages,
      getPosition: (d) => [d.lon, d.lat],
      getRadius: 20000,
      getFillColor: COLORS.outage,
      radiusMinPixels: 6,
      radiusMaxPixels: 18,
      pickable: true,
    });
  }

  private createCyberThreatsLayer(): ScatterplotLayer<CyberThreat> {
    return new ScatterplotLayer<CyberThreat>({
      id: 'cyber-threats-layer',
      data: this.cyberThreats,
      getPosition: (d) => [d.lon, d.lat],
      getRadius: (d) => {
        switch (d.severity) {
          case 'critical': return 22000;
          case 'high': return 17000;
          case 'medium': return 13000;
          default: return 9000;
        }
      },
      getFillColor: (d) => {
        switch (d.severity) {
          case 'critical': return [255, 61, 0, 225] as [number, number, number, number];
          case 'high': return [255, 102, 0, 205] as [number, number, number, number];
          case 'medium': return [255, 176, 0, 185] as [number, number, number, number];
          default: return [255, 235, 59, 170] as [number, number, number, number];
        }
      },
      radiusMinPixels: 6,
      radiusMaxPixels: 18,
      pickable: true,
      stroked: true,
      getLineColor: [255, 255, 255, 160] as [number, number, number, number],
      lineWidthMinPixels: 1,
    });
  }

  private createIranEventsLayer(): ScatterplotLayer<IranEvent> {
    return new ScatterplotLayer<IranEvent>({
      id: 'iran-events-layer',
      data: this.iranEvents,
      getPosition: (d) => [d.longitude, d.latitude],
      getRadius: (d) => {
        const severity = String(d.severity || '').toLowerCase();
        if (severity === 'critical' || severity === 'high') return 28_000;
        if (severity === 'moderate') return 20_000;
        return 14_000;
      },
      getFillColor: (d) => {
        const severity = String(d.severity || '').toLowerCase();
        if (severity === 'critical' || severity === 'high') return [255, 80, 80, 200] as [number, number, number, number];
        if (severity === 'moderate') return [255, 160, 80, 185] as [number, number, number, number];
        return [255, 220, 120, 170] as [number, number, number, number];
      },
      stroked: true,
      getLineColor: [255, 255, 255, 210] as [number, number, number, number],
      lineWidthMinPixels: 1,
      radiusMinPixels: 5,
      radiusMaxPixels: 18,
      pickable: true,
    });
  }

  private createGpsJammingLayer(): ScatterplotLayer<GpsJamHex> {
    return new ScatterplotLayer<GpsJamHex>({
      id: 'gps-jamming-layer',
      data: this.gpsJammingHexes,
      getPosition: (d) => [d.lon, d.lat],
      getRadius: (d) => (d.level === 'high' ? 42_000 : 28_000),
      getFillColor: (d) => {
        const pct = Number.isFinite(d.pct) ? Math.max(0, Math.min(100, d.pct)) : 0;
        const alpha = Math.max(95, Math.min(215, Math.round(110 + pct)));
        if (d.level === 'high') return [255, 70, 70, alpha] as [number, number, number, number];
        return [255, 180, 70, alpha] as [number, number, number, number];
      },
      stroked: true,
      getLineColor: [255, 255, 255, 180] as [number, number, number, number],
      lineWidthMinPixels: 1,
      radiusMinPixels: 6,
      radiusMaxPixels: 22,
      pickable: true,
    });
  }

  private createAisDensityLayer(): ScatterplotLayer {
    return new ScatterplotLayer({
      id: 'ais-density-layer',
      data: this.aisDensity,
      getPosition: (d) => [d.lon, d.lat],
      getRadius: (d) => 4000 + d.intensity * 8000,
      getFillColor: (d) => {
        const intensity = Math.min(Math.max(d.intensity, 0.15), 1);
        const isCongested = (d.deltaPct || 0) >= 15;
        const alpha = Math.round(40 + intensity * 160);
        // Orange for congested areas, cyan for normal traffic
        if (isCongested) {
          return [255, 183, 3, alpha] as [number, number, number, number]; // #ffb703
        }
        return [0, 209, 255, alpha] as [number, number, number, number]; // #00d1ff
      },
      radiusMinPixels: 4,
      radiusMaxPixels: 12,
      pickable: true,
    });
  }

  private createAisDisruptionsLayer(): ScatterplotLayer {
    // AIS spoofing/jamming events
    return new ScatterplotLayer({
      id: 'ais-disruptions-layer',
      data: this.aisDisruptions,
      getPosition: (d) => [d.lon, d.lat],
      getRadius: 12000,
      getFillColor: (d) => {
        // Color by severity/type
        if (d.severity === 'high' || d.type === 'spoofing') {
          return [255, 50, 50, 220] as [number, number, number, number]; // Red
        }
        if (d.severity === 'medium') {
          return [255, 150, 0, 200] as [number, number, number, number]; // Orange
        }
        return [255, 200, 100, 180] as [number, number, number, number]; // Yellow
      },
      radiusMinPixels: 6,
      radiusMaxPixels: 14,
      pickable: true,
      stroked: true,
      getLineColor: [255, 255, 255, 150] as [number, number, number, number],
      lineWidthMinPixels: 1,
    });
  }

  private createCableAdvisoriesLayer(advisories: CableAdvisory[]): ScatterplotLayer {
    // Cable fault/maintenance advisories
    return new ScatterplotLayer({
      id: 'cable-advisories-layer',
      data: advisories,
      getPosition: (d) => [d.lon, d.lat],
      getRadius: 10000,
      getFillColor: (d) => {
        if (d.severity === 'fault') {
          return [255, 50, 50, 220] as [number, number, number, number]; // Red for faults
        }
        return [255, 200, 0, 200] as [number, number, number, number]; // Yellow for maintenance
      },
      radiusMinPixels: 5,
      radiusMaxPixels: 12,
      pickable: true,
      stroked: true,
      getLineColor: [0, 200, 255, 200] as [number, number, number, number], // Cyan outline (cable color)
      lineWidthMinPixels: 2,
    });
  }

  private createRepairShipsLayer(): ScatterplotLayer {
    // Cable repair ships
    return new ScatterplotLayer({
      id: 'repair-ships-layer',
      data: this.repairShips,
      getPosition: (d) => [d.lon, d.lat],
      getRadius: 8000,
      getFillColor: [0, 255, 200, 200] as [number, number, number, number], // Teal
      radiusMinPixels: 4,
      radiusMaxPixels: 10,
      pickable: true,
    });
  }

  private createMilitaryVesselsLayer(vessels: MilitaryVessel[]): ScatterplotLayer {
    return new ScatterplotLayer({
      id: 'military-vessels-layer',
      data: vessels,
      getPosition: (d) => [d.lon, d.lat],
      getRadius: 6000,
      getFillColor: (d) => {
        if (d.usniSource) return [255, 160, 60, 160] as [number, number, number, number]; // Orange, lower alpha for USNI-only
        return COLORS.vesselMilitary;
      },
      radiusMinPixels: 4,
      radiusMaxPixels: 10,
      pickable: true,
      stroked: true,
      getLineColor: (d) => {
        if (d.usniSource) return [255, 180, 80, 200] as [number, number, number, number]; // Orange outline
        return [0, 0, 0, 0] as [number, number, number, number]; // No outline for AIS
      },
      lineWidthMinPixels: 2,
    });
  }

  private createMilitaryVesselClustersLayer(clusters: MilitaryVesselCluster[]): ScatterplotLayer {
    return new ScatterplotLayer({
      id: 'military-vessel-clusters-layer',
      data: clusters,
      getPosition: (d) => [d.lon, d.lat],
      getRadius: (d) => 15000 + (d.vesselCount || 1) * 3000,
      getFillColor: (d) => {
        // Vessel types: 'exercise' | 'deployment' | 'transit' | 'unknown'
        const activity = d.activityType || 'unknown';
        if (activity === 'exercise' || activity === 'deployment') return [255, 100, 100, 200] as [number, number, number, number];
        if (activity === 'transit') return [255, 180, 100, 180] as [number, number, number, number];
        return [200, 150, 150, 160] as [number, number, number, number];
      },
      radiusMinPixels: 8,
      radiusMaxPixels: 25,
      pickable: true,
    });
  }

  private createMilitaryFlightsLayer(flights: MilitaryFlight[]): ScatterplotLayer {
    return new ScatterplotLayer({
      id: 'military-flights-layer',
      data: flights,
      getPosition: (d) => [d.lon, d.lat],
      getRadius: 8000,
      getFillColor: COLORS.flightMilitary,
      radiusMinPixels: 4,
      radiusMaxPixels: 12,
      pickable: true,
    });
  }

  private createMilitaryFlightClustersLayer(clusters: MilitaryFlightCluster[]): ScatterplotLayer {
    return new ScatterplotLayer({
      id: 'military-flight-clusters-layer',
      data: clusters,
      getPosition: (d) => [d.lon, d.lat],
      getRadius: (d) => 15000 + (d.flightCount || 1) * 3000,
      getFillColor: (d) => {
        const activity = d.activityType || 'unknown';
        if (activity === 'exercise' || activity === 'patrol') return [100, 150, 255, 200] as [number, number, number, number];
        if (activity === 'transport') return [255, 200, 100, 180] as [number, number, number, number];
        return [150, 150, 200, 160] as [number, number, number, number];
      },
      radiusMinPixels: 8,
      radiusMaxPixels: 25,
      pickable: true,
    });
  }

  private createWaterwaysLayer(): ScatterplotLayer {
    return new ScatterplotLayer({
      id: 'waterways-layer',
      data: STRATEGIC_WATERWAYS,
      getPosition: (d) => [d.lon, d.lat],
      getRadius: 10000,
      getFillColor: [100, 150, 255, 180] as [number, number, number, number],
      radiusMinPixels: 5,
      radiusMaxPixels: 12,
      pickable: true,
    });
  }

  private createEconomicCentersLayer(): ScatterplotLayer {
    return new ScatterplotLayer({
      id: 'economic-centers-layer',
      data: ECONOMIC_CENTERS,
      getPosition: (d) => [d.lon, d.lat],
      getRadius: 8000,
      getFillColor: [255, 215, 0, 180] as [number, number, number, number],
      radiusMinPixels: 4,
      radiusMaxPixels: 10,
      pickable: true,
    });
  }

  private createStockExchangesLayer(): ScatterplotLayer {
    return new ScatterplotLayer({
      id: 'stock-exchanges-layer',
      data: STOCK_EXCHANGES,
      getPosition: (d) => [d.lon, d.lat],
      getRadius: (d) => d.tier === 'mega' ? 18000 : d.tier === 'major' ? 14000 : 11000,
      getFillColor: (d) => {
        if (d.tier === 'mega') return [255, 215, 80, 220] as [number, number, number, number];
        if (d.tier === 'major') return COLORS.stockExchange;
        return [140, 210, 255, 190] as [number, number, number, number];
      },
      radiusMinPixels: 5,
      radiusMaxPixels: 14,
      pickable: true,
    });
  }

  private createFinancialCentersLayer(): ScatterplotLayer {
    return new ScatterplotLayer({
      id: 'financial-centers-layer',
      data: FINANCIAL_CENTERS,
      getPosition: (d) => [d.lon, d.lat],
      getRadius: (d) => d.type === 'global' ? 17000 : d.type === 'regional' ? 13000 : 10000,
      getFillColor: (d) => {
        if (d.type === 'global') return COLORS.financialCenter;
        if (d.type === 'regional') return [0, 190, 130, 185] as [number, number, number, number];
        return [0, 150, 110, 165] as [number, number, number, number];
      },
      radiusMinPixels: 4,
      radiusMaxPixels: 12,
      pickable: true,
    });
  }

  private createCentralBanksLayer(): ScatterplotLayer {
    return new ScatterplotLayer({
      id: 'central-banks-layer',
      data: CENTRAL_BANKS,
      getPosition: (d) => [d.lon, d.lat],
      getRadius: (d) => d.type === 'major' ? 15000 : d.type === 'supranational' ? 17000 : 12000,
      getFillColor: (d) => {
        if (d.type === 'major') return COLORS.centralBank;
        if (d.type === 'supranational') return [255, 235, 140, 220] as [number, number, number, number];
        return [235, 180, 80, 185] as [number, number, number, number];
      },
      radiusMinPixels: 4,
      radiusMaxPixels: 12,
      pickable: true,
    });
  }

  private createCommodityHubsLayer(): ScatterplotLayer {
    return new ScatterplotLayer({
      id: 'commodity-hubs-layer',
      data: COMMODITY_HUBS,
      getPosition: (d) => [d.lon, d.lat],
      getRadius: (d) => d.type === 'exchange' ? 14000 : d.type === 'port' ? 12000 : 10000,
      getFillColor: (d) => {
        if (d.type === 'exchange') return COLORS.commodityHub;
        if (d.type === 'port') return [80, 170, 255, 190] as [number, number, number, number];
        return [255, 110, 80, 185] as [number, number, number, number];
      },
      radiusMinPixels: 4,
      radiusMaxPixels: 11,
      pickable: true,
    });
  }

  private createAPTGroupsLayer(): ScatterplotLayer {
    // APT Groups - cyber threat actor markers (geopolitical variant only)
    // Made subtle to avoid visual clutter - small orange dots
    return new ScatterplotLayer({
      id: 'apt-groups-layer',
      data: APT_GROUPS,
      getPosition: (d) => [d.lon, d.lat],
      getRadius: 6000,
      getFillColor: [255, 140, 0, 140] as [number, number, number, number], // Subtle orange
      radiusMinPixels: 4,
      radiusMaxPixels: 8,
      pickable: true,
      stroked: false, // No outline - cleaner look
    });
  }

  private createMineralsLayer(): ScatterplotLayer {
    // Critical minerals projects
    return new ScatterplotLayer({
      id: 'minerals-layer',
      data: CRITICAL_MINERALS,
      getPosition: (d) => [d.lon, d.lat],
      getRadius: 8000,
      getFillColor: (d) => {
        // Color by mineral type
        switch (d.mineral) {
          case 'Lithium': return [0, 200, 255, 200] as [number, number, number, number]; // Cyan
          case 'Cobalt': return [100, 100, 255, 200] as [number, number, number, number]; // Blue
          case 'Rare Earths': return [255, 100, 200, 200] as [number, number, number, number]; // Pink
          case 'Nickel': return [100, 255, 100, 200] as [number, number, number, number]; // Green
          default: return [200, 200, 200, 200] as [number, number, number, number]; // Gray
        }
      },
      radiusMinPixels: 5,
      radiusMaxPixels: 12,
      pickable: true,
    });
  }

  // Tech variant layers
  private createStartupHubsLayer(): ScatterplotLayer {
    return new ScatterplotLayer({
      id: 'startup-hubs-layer',
      data: STARTUP_HUBS,
      getPosition: (d) => [d.lon, d.lat],
      getRadius: 10000,
      getFillColor: COLORS.startupHub,
      radiusMinPixels: 5,
      radiusMaxPixels: 12,
      pickable: true,
    });
  }

  private createAcceleratorsLayer(): ScatterplotLayer {
    return new ScatterplotLayer({
      id: 'accelerators-layer',
      data: ACCELERATORS,
      getPosition: (d) => [d.lon, d.lat],
      getRadius: 6000,
      getFillColor: COLORS.accelerator,
      radiusMinPixels: 3,
      radiusMaxPixels: 8,
      pickable: true,
    });
  }

  private createCloudRegionsLayer(): ScatterplotLayer {
    return new ScatterplotLayer({
      id: 'cloud-regions-layer',
      data: CLOUD_REGIONS,
      getPosition: (d) => [d.lon, d.lat],
      getRadius: 12000,
      getFillColor: COLORS.cloudRegion,
      radiusMinPixels: 4,
      radiusMaxPixels: 12,
      pickable: true,
    });
  }

  private createProtestClusterLayers(): Layer[] {
    this.updateClusterData();
    const layers: Layer[] = [];

    layers.push(new ScatterplotLayer<MapProtestCluster>({
      id: 'protest-clusters-layer',
      data: this.protestClusters,
      getPosition: d => [d.lon, d.lat],
      getRadius: d => 15000 + d.count * 2000,
      radiusMinPixels: 6,
      radiusMaxPixels: 22,
      getFillColor: d => {
        if (d.hasRiot) return [220, 40, 40, 200] as [number, number, number, number];
        if (d.maxSeverity === 'high') return [255, 80, 60, 180] as [number, number, number, number];
        if (d.maxSeverity === 'medium') return [255, 160, 40, 160] as [number, number, number, number];
        return [255, 220, 80, 140] as [number, number, number, number];
      },
      pickable: true,
      updateTriggers: { getRadius: this.lastSCZoom, getFillColor: this.lastSCZoom },
    }));

    layers.push(this.createGhostLayer('protest-clusters-layer', this.protestClusters, d => [d.lon, d.lat], { radiusMinPixels: 14 }));

    const multiClusters = this.protestClusters.filter(c => c.count > 1);
    if (multiClusters.length > 0) {
      layers.push(new TextLayer<MapProtestCluster>({
        id: 'protest-clusters-badge',
        data: multiClusters,
        getText: d => String(d.count),
        getPosition: d => [d.lon, d.lat],
        background: true,
        getBackgroundColor: [0, 0, 0, 180],
        backgroundPadding: [4, 2, 4, 2],
        getColor: [255, 255, 255, 255],
        getSize: 12,
        getPixelOffset: [0, -14],
        pickable: false,
        fontFamily: 'system-ui, sans-serif',
        fontWeight: 700,
      }));
    }

    return layers;
  }

  private createTechHQClusterLayers(): Layer[] {
    this.updateClusterData();
    const layers: Layer[] = [];
    const zoom = this.maplibreMap?.getZoom() || 2;

    layers.push(new ScatterplotLayer<MapTechHQCluster>({
      id: 'tech-hq-clusters-layer',
      data: this.techHQClusters,
      getPosition: d => [d.lon, d.lat],
      getRadius: d => 10000 + d.count * 1500,
      radiusMinPixels: 5,
      radiusMaxPixels: 18,
      getFillColor: d => {
        if (d.primaryType === 'faang') return [0, 220, 120, 200] as [number, number, number, number];
        if (d.primaryType === 'unicorn') return [255, 100, 200, 180] as [number, number, number, number];
        return [80, 160, 255, 180] as [number, number, number, number];
      },
      pickable: true,
      updateTriggers: { getRadius: this.lastSCZoom },
    }));

    layers.push(this.createGhostLayer('tech-hq-clusters-layer', this.techHQClusters, d => [d.lon, d.lat], { radiusMinPixels: 14 }));

    const multiClusters = this.techHQClusters.filter(c => c.count > 1);
    if (multiClusters.length > 0) {
      layers.push(new TextLayer<MapTechHQCluster>({
        id: 'tech-hq-clusters-badge',
        data: multiClusters,
        getText: d => String(d.count),
        getPosition: d => [d.lon, d.lat],
        background: true,
        getBackgroundColor: [0, 0, 0, 180],
        backgroundPadding: [4, 2, 4, 2],
        getColor: [255, 255, 255, 255],
        getSize: 12,
        getPixelOffset: [0, -14],
        pickable: false,
        fontFamily: 'system-ui, sans-serif',
        fontWeight: 700,
      }));
    }

    if (zoom >= 3) {
      const singles = this.techHQClusters.filter(c => c.count === 1);
      if (singles.length > 0) {
        layers.push(new TextLayer<MapTechHQCluster>({
          id: 'tech-hq-clusters-label',
          data: singles,
          getText: d => d.items[0]?.company ?? '',
          getPosition: d => [d.lon, d.lat],
          getSize: 11,
          getColor: [220, 220, 220, 200],
          getPixelOffset: [0, 12],
          pickable: false,
          fontFamily: 'system-ui, sans-serif',
        }));
      }
    }

    return layers;
  }

  private createTechEventClusterLayers(): Layer[] {
    this.updateClusterData();
    const layers: Layer[] = [];

    layers.push(new ScatterplotLayer<MapTechEventCluster>({
      id: 'tech-event-clusters-layer',
      data: this.techEventClusters,
      getPosition: d => [d.lon, d.lat],
      getRadius: d => 10000 + d.count * 1500,
      radiusMinPixels: 5,
      radiusMaxPixels: 18,
      getFillColor: d => {
        if (d.soonestDaysUntil <= 14) return [255, 220, 50, 200] as [number, number, number, number];
        return [80, 140, 255, 180] as [number, number, number, number];
      },
      pickable: true,
      updateTriggers: { getRadius: this.lastSCZoom },
    }));

    layers.push(this.createGhostLayer('tech-event-clusters-layer', this.techEventClusters, d => [d.lon, d.lat], { radiusMinPixels: 14 }));

    const multiClusters = this.techEventClusters.filter(c => c.count > 1);
    if (multiClusters.length > 0) {
      layers.push(new TextLayer<MapTechEventCluster>({
        id: 'tech-event-clusters-badge',
        data: multiClusters,
        getText: d => String(d.count),
        getPosition: d => [d.lon, d.lat],
        background: true,
        getBackgroundColor: [0, 0, 0, 180],
        backgroundPadding: [4, 2, 4, 2],
        getColor: [255, 255, 255, 255],
        getSize: 12,
        getPixelOffset: [0, -14],
        pickable: false,
        fontFamily: 'system-ui, sans-serif',
        fontWeight: 700,
      }));
    }

    return layers;
  }

  private createDatacenterClusterLayers(): Layer[] {
    this.updateClusterData();
    const layers: Layer[] = [];

    layers.push(new ScatterplotLayer<MapDatacenterCluster>({
      id: 'datacenter-clusters-layer',
      data: this.datacenterClusters,
      getPosition: d => [d.lon, d.lat],
      getRadius: d => 15000 + d.count * 2000,
      radiusMinPixels: 6,
      radiusMaxPixels: 20,
      getFillColor: d => {
        if (d.majorityExisting) return [160, 80, 255, 180] as [number, number, number, number];
        return [80, 160, 255, 180] as [number, number, number, number];
      },
      pickable: true,
      updateTriggers: { getRadius: this.lastSCZoom },
    }));

    layers.push(this.createGhostLayer('datacenter-clusters-layer', this.datacenterClusters, d => [d.lon, d.lat], { radiusMinPixels: 14 }));

    const multiClusters = this.datacenterClusters.filter(c => c.count > 1);
    if (multiClusters.length > 0) {
      layers.push(new TextLayer<MapDatacenterCluster>({
        id: 'datacenter-clusters-badge',
        data: multiClusters,
        getText: d => String(d.count),
        getPosition: d => [d.lon, d.lat],
        background: true,
        getBackgroundColor: [0, 0, 0, 180],
        backgroundPadding: [4, 2, 4, 2],
        getColor: [255, 255, 255, 255],
        getSize: 12,
        getPixelOffset: [0, -14],
        pickable: false,
        fontFamily: 'system-ui, sans-serif',
        fontWeight: 700,
      }));
    }

    return layers;
  }

  private createHotspotsLayers(): Layer[] {
    const zoom = this.maplibreMap?.getZoom() || 2;
    const zoomScale = Math.min(1, (zoom - 1) / 3);
    const maxPx = 6 + Math.round(14 * zoomScale);
    const baseOpacity = zoom < 2.5 ? 0.5 : zoom < 4 ? 0.7 : 1.0;
    const layers: Layer[] = [];

    layers.push(new ScatterplotLayer({
      id: 'hotspots-layer',
      data: this.hotspots,
      getPosition: (d) => [d.lon, d.lat],
      getRadius: (d) => {
        const score = d.escalationScore || 1;
        return 10000 + score * 5000;
      },
      getFillColor: (d) => {
        const score = d.escalationScore || 1;
        const a = Math.round((score >= 4 ? 200 : score >= 2 ? 200 : 180) * baseOpacity);
        if (score >= 4) return [255, 68, 68, a] as [number, number, number, number];
        if (score >= 2) return [255, 165, 0, a] as [number, number, number, number];
        return [255, 255, 0, a] as [number, number, number, number];
      },
      radiusMinPixels: 4,
      radiusMaxPixels: maxPx,
      pickable: true,
      stroked: true,
      getLineColor: (d) =>
        d.hasBreaking ? [255, 255, 255, 255] as [number, number, number, number] : [0, 0, 0, 0] as [number, number, number, number],
      lineWidthMinPixels: 2,
    }));

    layers.push(this.createGhostLayer('hotspots-layer', this.hotspots, d => [d.lon, d.lat], { radiusMinPixels: 14 }));

    return layers;
  }

  private createGulfInvestmentsLayer(): ScatterplotLayer {
    return new ScatterplotLayer<GulfInvestment>({
      id: 'gulf-investments-layer',
      data: GULF_INVESTMENTS,
      getPosition: (d: GulfInvestment) => [d.lon, d.lat],
      getRadius: (d: GulfInvestment) => {
        if (!d.investmentUSD) return 20000;
        if (d.investmentUSD >= 50000) return 70000;
        if (d.investmentUSD >= 10000) return 55000;
        if (d.investmentUSD >= 1000) return 40000;
        return 25000;
      },
      getFillColor: (d: GulfInvestment) =>
        d.investingCountry === 'SA' ? COLORS.gulfInvestmentSA : COLORS.gulfInvestmentUAE,
      getLineColor: [255, 255, 255, 80] as [number, number, number, number],
      lineWidthMinPixels: 1,
      radiusMinPixels: 5,
      radiusMaxPixels: 28,
      pickable: true,
    });
  }

  private canPulse(now = Date.now()): boolean {
    return now - this.startupTime > 60_000;
  }

  private needsPulseAnimation(_now = Date.now()): boolean {
    return false;
  }

  private syncPulseAnimation(now = Date.now()): void {
    if (this.renderPaused || this.replayMode) {
      if (this.newsPulseIntervalId !== null) this.stopPulseAnimation();
      return;
    }
    const shouldPulse = this.canPulse(now) && this.needsPulseAnimation(now);
    if (shouldPulse && this.newsPulseIntervalId === null) {
      this.startPulseAnimation();
    } else if (!shouldPulse && this.newsPulseIntervalId !== null) {
      this.stopPulseAnimation();
    }
  }

  private startPulseAnimation(): void {
    if (this.newsPulseIntervalId !== null) return;
    const PULSE_UPDATE_INTERVAL_MS = 500;

    this.newsPulseIntervalId = setInterval(() => {
      const now = Date.now();
      if (!this.needsPulseAnimation(now)) {
        this.stopPulseAnimation();
        this.rafUpdateLayers();
        return;
      }
      this.rafUpdateLayers();
    }, PULSE_UPDATE_INTERVAL_MS);
  }

  private stopPulseAnimation(): void {
    if (this.newsPulseIntervalId !== null) {
      clearInterval(this.newsPulseIntervalId);
      this.newsPulseIntervalId = null;
    }
  }

  private getCountryInteractionColor(normalized: number): [number, number, number, number] {
    const n = Math.max(0, Math.min(1, normalized));
    const isLight = getCurrentTheme() === 'light';
    if (n >= 0.8) return isLight ? [185, 28, 28, 230] : [255, 90, 90, 220];
    if (n >= 0.6) return isLight ? [194, 65, 12, 220] : [255, 145, 70, 210];
    if (n >= 0.35) return isLight ? [180, 83, 9, 210] : [255, 190, 80, 190];
    return isLight ? [29, 78, 216, 195] : [120, 180, 255, 175];
  }

  private createCountryInteractionArcsLayer(data: CountryInteractionArc[]): ArcLayer<CountryInteractionArc> {
    return new ArcLayer<CountryInteractionArc>({
      id: 'country-interaction-arcs-layer',
      data,
      getSourcePosition: (d) => this.getOverlayPosition(d.sourceLon, d.sourceLat, 6000),
      getTargetPosition: (d) => this.getOverlayPosition(d.targetLon, d.targetLat, 6000),
      getSourceColor: (d) => this.getCountryInteractionColor(d.normalized),
      getTargetColor: (d) => this.getCountryInteractionColor(d.normalized),
      getWidth: (d) => 1 + d.normalized * 6,
      widthMinPixels: 1,
      widthMaxPixels: 10,
      getHeight: (d) => 0.15 + d.normalized * 0.65,
      greatCircle: true,
      pickable: true,
    });
  }

  private createCountryInteractionLayers(lodLevel: MapLodLevel): Layer[] {
    if (this.countryInteractionArcs.length === 0 && this.countryInteractionNodes.length === 0) {
      return [];
    }
    const maxArcs = lodLevel === 'global' ? 40 : lodLevel === 'regional' ? 70 : 120;
    const arcsData = this.countryInteractionArcs.slice(0, maxArcs);
    return [
      this.createCountryInteractionArcsLayer(arcsData),
    ];
  }

  private createNewsLocationsLayer(lodLevel: MapLodLevel): ScatterplotLayer[] {
    if (lodLevel === 'global') return [];
    const globeProjection = this.projectionMode === 'globe';
    const zoom = this.maplibreMap?.getZoom() || 2;
    const alphaScale = zoom < 2.5 ? 0.4 : zoom < 4 ? 0.7 : 1.0;
    const filteredNewsLocations = this.filterByTime(this.newsLocations, (location) => location.timestamp);
    let renderedNewsLocations = lodLevel === 'regional'
      ? filteredNewsLocations.filter((_, idx) => idx % 2 === 0)
      : filteredNewsLocations;
    if (globeProjection) {
      const threatRank = (level: string): number => {
        switch ((level || '').toLowerCase()) {
          case 'critical': return 5;
          case 'high': return 4;
          case 'medium': return 3;
          case 'low': return 2;
          default: return 1;
        }
      };
      const maxNews = lodLevel === 'regional' ? 180 : 320;
      renderedNewsLocations = [...renderedNewsLocations]
        .sort((a, b) => threatRank(b.threatLevel) - threatRank(a.threatLevel))
        .slice(0, maxNews);
    }
    const THREAT_RGB: Record<string, [number, number, number]> = {
      critical: [239, 68, 68],
      high: [249, 115, 22],
      medium: [234, 179, 8],
      low: [34, 197, 94],
      info: [59, 130, 246],
    };
    const THREAT_ALPHA: Record<string, number> = {
      critical: 220,
      high: 190,
      medium: 160,
      low: 120,
      info: 80,
    };
    const shouldRenderNewsBubble = (level: string): boolean => {
      const normalized = String(level || '').toLowerCase();
      if (lodLevel === 'regional') {
        return normalized === 'critical' || normalized === 'high' || normalized === 'medium';
      }
      return true;
    };
    const bubbleRadiusMeters = (level: string): number => {
      const normalized = String(level || '').toLowerCase();
      if (lodLevel === 'regional') {
        switch (normalized) {
          case 'critical': return 14000;
          case 'high': return 11000;
          case 'medium': return 8500;
          default: return 0;
        }
      }
      switch (normalized) {
        case 'critical': return 18000;
        case 'high': return 15000;
        case 'medium': return 11000;
        case 'low': return 7000;
        case 'info': return 4200;
        default: return 6000;
      }
    };
    renderedNewsLocations = renderedNewsLocations.filter((item) => shouldRenderNewsBubble(item.threatLevel));

    const layers: ScatterplotLayer[] = [
      new ScatterplotLayer({
        id: 'news-locations-layer',
        data: renderedNewsLocations,
        getPosition: (d) => this.getOverlayPosition(d.lon, d.lat, 7000),
        getRadius: (d) => bubbleRadiusMeters(d.threatLevel),
        getFillColor: (d) => {
          const rgb = THREAT_RGB[d.threatLevel] || [59, 130, 246];
          const a = Math.round((THREAT_ALPHA[d.threatLevel] || 120) * alphaScale);
          return [...rgb, a] as [number, number, number, number];
        },
        radiusMinPixels: 3,
        radiusMaxPixels: 12,
        billboard: true,
        pickable: true,
      }),
    ];

    return layers;
  }

  private createPriorityGlowLayer(lodLevel: MapLodLevel): ScatterplotLayer<GlowMarkerDatum> | null {
    const points: GlowMarkerDatum[] = [];
    const currentPulse = 1;

    const topNodes = this.countryInteractionNodes
      .slice()
      .sort((a, b) => b.normalized - a.normalized)
      .slice(0, lodLevel === 'global' ? 14 : 20);
    for (const node of topNodes) {
      points.push({
        id: `interaction:${node.id}`,
        position: this.getOverlayPosition(node.lon, node.lat, 9000),
        color: [88, 168, 255, 56],
        radius: 18 + node.normalized * 22,
      });
    }

    const severityRank = (value: string): number => {
      switch (String(value || '').toLowerCase()) {
        case 'critical':
        case 'severe':
          return 4;
        case 'high':
        case 'major':
          return 3;
        case 'medium':
        case 'moderate':
          return 2;
        default:
          return 1;
      }
    };

    const topThreats = this.cyberThreats
      .slice()
      .sort((a, b) => severityRank(String(b.severity || '')) - severityRank(String(a.severity || '')))
      .slice(0, lodLevel === 'global' ? 8 : 12);
    for (const threat of topThreats) {
      if (!Number.isFinite(threat.lat) || !Number.isFinite(threat.lon)) continue;
      points.push({
        id: `cyber:${threat.id || `${threat.country}:${threat.lat}:${threat.lon}`}`,
        position: this.getOverlayPosition(threat.lon, threat.lat, 7000),
        color: [34, 211, 238, 66],
        radius: 16 + severityRank(String(threat.severity || '')) * 5,
      });
    }

    if (lodLevel !== 'global') {
      const highNews = this.newsLocations
        .filter((item) => ['critical', 'high'].includes(String(item.threatLevel || '').toLowerCase()))
        .slice(0, 14);
      for (const item of highNews) {
        points.push({
          id: `news:${item.title}:${item.lat}:${item.lon}`,
          position: this.getOverlayPosition(item.lon, item.lat, 9000),
          color: String(item.threatLevel || '').toLowerCase() === 'critical'
            ? [255, 82, 82, 58]
            : [255, 166, 77, 52],
          radius: String(item.threatLevel || '').toLowerCase() === 'critical' ? 18 : 14,
        });
      }
    }

    if (points.length === 0) return null;

    return new ScatterplotLayer<GlowMarkerDatum>({
      id: 'priority-glow-layer',
      data: points,
      getPosition: (d) => d.position,
      getRadius: (d) => d.radius,
      radiusUnits: 'pixels',
      radiusScale: currentPulse,
      radiusMinPixels: 10,
      radiusMaxPixels: 40,
      stroked: false,
      filled: true,
      billboard: true,
      getFillColor: (d) => d.color,
      pickable: false,
    });
  }

  private createPositiveEventsLayers(): Layer[] {
    const layers: Layer[] = [];

    const getCategoryColor = (category: string): [number, number, number, number] => {
      switch (category) {
        case 'nature-wildlife':
        case 'humanity-kindness':
          return [34, 197, 94, 200]; // green
        case 'science-health':
        case 'innovation-tech':
        case 'climate-wins':
          return [234, 179, 8, 200]; // gold
        case 'culture-community':
          return [139, 92, 246, 200]; // purple
        default:
          return [34, 197, 94, 200]; // green default
      }
    };

    // Dot layer (tooltip on hover via getTooltip)
    layers.push(new ScatterplotLayer({
      id: 'positive-events-layer',
      data: this.positiveEvents,
      getPosition: (d: PositiveGeoEvent) => [d.lon, d.lat],
      getRadius: 12000,
      getFillColor: (d: PositiveGeoEvent) => getCategoryColor(d.category),
      radiusMinPixels: 5,
      radiusMaxPixels: 10,
      pickable: true,
    }));

    // Gentle pulse ring for significant events (count > 8)
    return layers;
  }

  private createKindnessLayers(): Layer[] {
    const layers: Layer[] = [];
    if (this.kindnessPoints.length === 0) return layers;

    // Dot layer (tooltip on hover via getTooltip)
    layers.push(new ScatterplotLayer<KindnessPoint>({
      id: 'kindness-layer',
      data: this.kindnessPoints,
      getPosition: (d: KindnessPoint) => [d.lon, d.lat],
      getRadius: 12000,
      getFillColor: [74, 222, 128, 200] as [number, number, number, number],
      radiusMinPixels: 5,
      radiusMaxPixels: 10,
      pickable: true,
    }));

    // Pulse for real events
    return layers;
  }

  private createHappinessChoroplethLayer(): GeoJsonLayer | null {
    if (!this.countriesGeoJsonData || this.happinessScores.size === 0) return null;
    const scores = this.happinessScores;
    return new GeoJsonLayer({
      id: 'happiness-choropleth-layer',
      data: this.countriesGeoJsonData,
      filled: true,
      stroked: true,
      getFillColor: (feature: { properties?: Record<string, unknown> }) => {
        const code = feature.properties?.['ISO3166-1-Alpha-2'] as string | undefined;
        const score = code ? scores.get(code) : undefined;
        if (score == null) return [0, 0, 0, 0] as [number, number, number, number];
        const t = score / 10;
        return [
          Math.round(40 + (1 - t) * 180),
          Math.round(180 + t * 60),
          Math.round(40 + (1 - t) * 100),
          140,
        ] as [number, number, number, number];
      },
      getLineColor: [100, 100, 100, 60] as [number, number, number, number],
      getLineWidth: 1,
      lineWidthMinPixels: 0.5,
      pickable: true,
      updateTriggers: { getFillColor: [scores.size] },
    });
  }

  private createSpeciesRecoveryLayer(): ScatterplotLayer {
    return new ScatterplotLayer({
      id: 'species-recovery-layer',
      data: this.speciesRecoveryZones,
      getPosition: (d: (typeof this.speciesRecoveryZones)[number]) => [d.recoveryZone.lon, d.recoveryZone.lat],
      getRadius: 50000,
      radiusMinPixels: 8,
      radiusMaxPixels: 25,
      getFillColor: [74, 222, 128, 120] as [number, number, number, number],
      stroked: true,
      getLineColor: [74, 222, 128, 200] as [number, number, number, number],
      lineWidthMinPixels: 1.5,
      pickable: true,
    });
  }

  private createRenewableInstallationsLayer(): ScatterplotLayer {
    const typeColors: Record<string, [number, number, number, number]> = {
      solar: [255, 200, 50, 200],
      wind: [100, 200, 255, 200],
      hydro: [0, 180, 180, 200],
      geothermal: [255, 150, 80, 200],
    };
    const typeLineColors: Record<string, [number, number, number, number]> = {
      solar: [255, 200, 50, 255],
      wind: [100, 200, 255, 255],
      hydro: [0, 180, 180, 255],
      geothermal: [255, 150, 80, 255],
    };
    return new ScatterplotLayer({
      id: 'renewable-installations-layer',
      data: this.renewableInstallations,
      getPosition: (d: RenewableInstallation) => [d.lon, d.lat],
      getRadius: 30000,
      radiusMinPixels: 5,
      radiusMaxPixels: 18,
      getFillColor: (d: RenewableInstallation) => typeColors[d.type] ?? [200, 200, 200, 200] as [number, number, number, number],
      stroked: true,
      getLineColor: (d: RenewableInstallation) => typeLineColors[d.type] ?? [200, 200, 200, 255] as [number, number, number, number],
      lineWidthMinPixels: 1,
      pickable: true,
    });
  }

  private getTooltip(info: PickingInfo): { html: string } | null {
    if (!info.object) return null;

    const rawLayerId = info.layer?.id || '';
    const layerId = rawLayerId.endsWith('-ghost') ? rawLayerId.slice(0, -6) : rawLayerId;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const obj = info.object as any;
    const text = (value: unknown): string => escapeHtml(String(value ?? ''));

    switch (layerId) {
      case 'hotspots-layer':
        return { html: `<div class="deckgl-tooltip"><strong>${text(obj.name)}</strong><br/>${text(obj.subtext)}</div>` };
      case 'earthquakes-layer':
        return { html: `<div class="deckgl-tooltip"><strong>M${(obj.magnitude || 0).toFixed(1)} ${t('components.deckgl.tooltip.earthquake')}</strong><br/>${text(obj.place)}</div>` };
      case 'military-vessels-layer':
        return { html: `<div class="deckgl-tooltip"><strong>${text(obj.name)}</strong><br/>${text(obj.operatorCountry)}</div>` };
      case 'military-flights-layer':
        return { html: `<div class="deckgl-tooltip"><strong>${text(obj.callsign || obj.registration || t('components.deckgl.tooltip.militaryAircraft'))}</strong><br/>${text(obj.type)}</div>` };
      case 'military-vessel-clusters-layer':
        return { html: `<div class="deckgl-tooltip"><strong>${text(obj.name || t('components.deckgl.tooltip.vesselCluster'))}</strong><br/>${obj.vesselCount || 0} ${t('components.deckgl.tooltip.vessels')}<br/>${text(obj.activityType)}</div>` };
      case 'military-flight-clusters-layer':
        return { html: `<div class="deckgl-tooltip"><strong>${text(obj.name || t('components.deckgl.tooltip.flightCluster'))}</strong><br/>${obj.flightCount || 0} ${t('components.deckgl.tooltip.aircraft')}<br/>${text(obj.activityType)}</div>` };
      case 'protests-layer':
        return { html: `<div class="deckgl-tooltip"><strong>${text(obj.title)}</strong><br/>${text(obj.country)}</div>` };
      case 'protest-clusters-layer':
        if (obj.count === 1) {
          const item = obj.items?.[0];
          return { html: `<div class="deckgl-tooltip"><strong>${text(item?.title || t('components.deckgl.tooltip.protest'))}</strong><br/>${text(item?.city || item?.country || '')}</div>` };
        }
        return { html: `<div class="deckgl-tooltip"><strong>${t('components.deckgl.tooltip.protestsCount', { count: String(obj.count) })}</strong><br/>${text(obj.country)}</div>` };
      case 'tech-hq-clusters-layer':
        if (obj.count === 1) {
          const hq = obj.items?.[0];
          return { html: `<div class="deckgl-tooltip"><strong>${text(hq?.company || '')}</strong><br/>${text(hq?.city || '')}</div>` };
        }
        return { html: `<div class="deckgl-tooltip"><strong>${t('components.deckgl.tooltip.techHQsCount', { count: String(obj.count) })}</strong><br/>${text(obj.city)}</div>` };
      case 'tech-event-clusters-layer':
        if (obj.count === 1) {
          const ev = obj.items?.[0];
          return { html: `<div class="deckgl-tooltip"><strong>${text(ev?.title || '')}</strong><br/>${text(ev?.location || '')}</div>` };
        }
        return { html: `<div class="deckgl-tooltip"><strong>${t('components.deckgl.tooltip.techEventsCount', { count: String(obj.count) })}</strong><br/>${text(obj.location)}</div>` };
      case 'datacenter-clusters-layer':
        if (obj.count === 1) {
          const dc = obj.items?.[0];
          return { html: `<div class="deckgl-tooltip"><strong>${text(dc?.name || '')}</strong><br/>${text(dc?.owner || '')}</div>` };
        }
        return { html: `<div class="deckgl-tooltip"><strong>${t('components.deckgl.tooltip.dataCentersCount', { count: String(obj.count) })}</strong><br/>${text(obj.country)}</div>` };
      case 'bases-layer':
        return { html: `<div class="deckgl-tooltip"><strong>${text(obj.name)}</strong><br/>${text(obj.country)}</div>` };
      case 'nuclear-layer':
        return { html: `<div class="deckgl-tooltip"><strong>${text(obj.name)}</strong><br/>${text(obj.type)}</div>` };
      case 'datacenters-layer':
        return { html: `<div class="deckgl-tooltip"><strong>${text(obj.name)}</strong><br/>${text(obj.owner)}</div>` };
      case 'cables-layer':
        return { html: `<div class="deckgl-tooltip"><strong>${text(obj.name)}</strong><br/>${t('components.deckgl.tooltip.underseaCable')}</div>` };
      case 'pipelines-layer': {
        const pipelineType = String(obj.type || '').toLowerCase();
        const pipelineTypeLabel = pipelineType === 'oil'
          ? t('popups.pipeline.types.oil')
          : pipelineType === 'gas'
          ? t('popups.pipeline.types.gas')
          : pipelineType === 'products'
          ? t('popups.pipeline.types.products')
          : `${text(obj.type)} ${t('components.deckgl.tooltip.pipeline')}`;
        return { html: `<div class="deckgl-tooltip"><strong>${text(obj.name)}</strong><br/>${pipelineTypeLabel}</div>` };
      }
      case 'conflict-zones-layer': {
        const props = obj.properties || obj;
        const tag = String(props.tag || '');
        const intensity = String(props.intensity || 'medium').toUpperCase();
        const label = tag || (intensity === 'HIGH' ? 'WAR ZONE' : 'RISK ZONE');
        return {
          html: `<div class="deckgl-tooltip"><strong>${text(props.name)}</strong><br/>${text(label)} · ${text(intensity)}</div>`,
        };
      }
      case 'natural-events-layer':
        return { html: `<div class="deckgl-tooltip"><strong>${text(obj.title)}</strong><br/>${text(obj.category || t('components.deckgl.tooltip.naturalEvent'))}</div>` };
      case 'ais-density-layer':
        return { html: `<div class="deckgl-tooltip"><strong>${t('components.deckgl.layers.shipTraffic')}</strong><br/>${t('popups.intensity')}: ${text(obj.intensity)}</div>` };
      case 'waterways-layer':
        return { html: `<div class="deckgl-tooltip"><strong>${text(obj.name)}</strong><br/>${t('components.deckgl.layers.strategicWaterways')}</div>` };
      case 'economic-centers-layer':
        return { html: `<div class="deckgl-tooltip"><strong>${text(obj.name)}</strong><br/>${text(obj.country)}</div>` };
      case 'stock-exchanges-layer':
        return { html: `<div class="deckgl-tooltip"><strong>${text(obj.shortName)}</strong><br/>${text(obj.city)}, ${text(obj.country)}</div>` };
      case 'financial-centers-layer':
        return { html: `<div class="deckgl-tooltip"><strong>${text(obj.name)}</strong><br/>${text(obj.type)} ${t('components.deckgl.tooltip.financialCenter')}</div>` };
      case 'central-banks-layer':
        return { html: `<div class="deckgl-tooltip"><strong>${text(obj.shortName)}</strong><br/>${text(obj.city)}, ${text(obj.country)}</div>` };
      case 'commodity-hubs-layer':
        return { html: `<div class="deckgl-tooltip"><strong>${text(obj.name)}</strong><br/>${text(obj.type)} · ${text(obj.city)}</div>` };
      case 'startup-hubs-layer':
        return { html: `<div class="deckgl-tooltip"><strong>${text(obj.city)}</strong><br/>${text(obj.country)}</div>` };
      case 'tech-hqs-layer':
        return { html: `<div class="deckgl-tooltip"><strong>${text(obj.company)}</strong><br/>${text(obj.city)}</div>` };
      case 'accelerators-layer':
        return { html: `<div class="deckgl-tooltip"><strong>${text(obj.name)}</strong><br/>${text(obj.city)}</div>` };
      case 'cloud-regions-layer':
        return { html: `<div class="deckgl-tooltip"><strong>${text(obj.provider)}</strong><br/>${text(obj.region)}</div>` };
      case 'tech-events-layer':
        return { html: `<div class="deckgl-tooltip"><strong>${text(obj.title)}</strong><br/>${text(obj.location)}</div>` };
      case 'irradiators-layer':
        return { html: `<div class="deckgl-tooltip"><strong>${text(obj.name)}</strong><br/>${text(obj.type || t('components.deckgl.layers.gammaIrradiators'))}</div>` };
      case 'spaceports-layer':
        return { html: `<div class="deckgl-tooltip"><strong>${text(obj.name)}</strong><br/>${text(obj.country || t('components.deckgl.layers.spaceports'))}</div>` };
      case 'ports-layer': {
        const typeIcon = obj.type === 'naval' ? '⚓' : obj.type === 'oil' || obj.type === 'lng' ? '🛢️' : '🏭';
        return { html: `<div class="deckgl-tooltip"><strong>${typeIcon} ${text(obj.name)}</strong><br/>${text(obj.type || t('components.deckgl.tooltip.port'))} - ${text(obj.country)}</div>` };
      }
      case 'flight-delays-layer':
        return { html: `<div class="deckgl-tooltip"><strong>${text(obj.airport)}</strong><br/>${text(obj.severity)}: ${text(obj.reason)}</div>` };
      case 'apt-groups-layer':
        return { html: `<div class="deckgl-tooltip"><strong>${text(obj.name)}</strong><br/>${text(obj.aka)}<br/>${t('popups.sponsor')}: ${text(obj.sponsor)}</div>` };
      case 'minerals-layer':
        return { html: `<div class="deckgl-tooltip"><strong>${text(obj.name)}</strong><br/>${text(obj.mineral)} - ${text(obj.country)}<br/>${text(obj.operator)}</div>` };
      case 'ais-disruptions-layer':
        return { html: `<div class="deckgl-tooltip"><strong>AIS ${text(obj.type || t('components.deckgl.tooltip.disruption'))}</strong><br/>${text(obj.severity)} ${t('popups.severity')}<br/>${text(obj.description)}</div>` };
      case 'cable-advisories-layer': {
        const cableName = UNDERSEA_CABLES.find(c => c.id === obj.cableId)?.name || obj.cableId;
        return { html: `<div class="deckgl-tooltip"><strong>${text(cableName)}</strong><br/>${text(obj.severity || t('components.deckgl.tooltip.advisory'))}<br/>${text(obj.description)}</div>` };
      }
      case 'repair-ships-layer':
        return { html: `<div class="deckgl-tooltip"><strong>${text(obj.name || t('components.deckgl.tooltip.repairShip'))}</strong><br/>${text(obj.status)}</div>` };
      case 'weather-layer': {
        const areaDesc = typeof obj.areaDesc === 'string' ? obj.areaDesc : '';
        const area = areaDesc ? `<br/><small>${text(areaDesc.slice(0, 50))}${areaDesc.length > 50 ? '...' : ''}</small>` : '';
        return { html: `<div class="deckgl-tooltip"><strong>${text(obj.event || t('components.deckgl.layers.weatherAlerts'))}</strong><br/>${text(obj.severity)}${area}</div>` };
      }
      case 'iran-events-layer':
        return { html: `<div class="deckgl-tooltip"><strong>${text(obj.title || t('popups.iranEvent.title'))}</strong><br/>${text(obj.severity || t('popups.unknown'))} | ${text(obj.category || '')}</div>` };
      case 'gps-jamming-layer':
        return { html: `<div class="deckgl-tooltip"><strong>${t('popups.gpsJamming.title')}</strong><br/>${text(obj.level || t('popups.unknown'))} | ${text(obj.pct ?? 0)}%</div>` };
      case 'outages-layer':
        return { html: `<div class="deckgl-tooltip"><strong>${text(obj.asn || t('components.deckgl.tooltip.internetOutage'))}</strong><br/>${text(obj.country)}</div>` };
      case 'cyber-threats-layer':
        return { html: `<div class="deckgl-tooltip"><strong>${t('popups.cyberThreat.title')}</strong><br/>${text(obj.severity || t('components.deckgl.tooltip.medium'))} | ${text(obj.country || t('popups.unknown'))}</div>` };
      case 'news-locations-layer':
        return { html: `<div class="deckgl-tooltip"><strong>News | ${t('components.deckgl.tooltip.news')}</strong><br/>${text(obj.title?.slice(0, 80) || '')}</div>` };
      case 'country-interaction-arcs-layer': {
        const lastSeen = Number.isFinite(obj.lastSeenTs)
          ? new Date(obj.lastSeenTs).toLocaleString()
          : 'N/A';
        const severityPct = Math.round((Number(obj.normalized) || 0) * 100);
        const sample = typeof obj.sampleTitle === 'string' && obj.sampleTitle.length > 0
          ? `<br/><small style="opacity:.78">${text(obj.sampleTitle.slice(0, 96))}</small>`
          : '';
        return {
          html: `<div class="deckgl-tooltip">
            <strong>${text(obj.sourceName)} ↔ ${text(obj.targetName)}</strong><br/>
            Severity: ${severityPct}%<br/>
            Mentions: ${text(obj.mentionCount)}${obj.criticalCount ? ` (critical: ${text(obj.criticalCount)})` : ''}<br/>
            <span style="opacity:.72">Last seen: ${text(lastSeen)}</span>${sample}
          </div>`,
        };
      }
      case 'country-interaction-nodes-layer': {
        const lastSeen = Number.isFinite(obj.lastSeenTs)
          ? new Date(obj.lastSeenTs).toLocaleString()
          : 'N/A';
        const severityPct = Math.round((Number(obj.normalized) || 0) * 100);
        return {
          html: `<div class="deckgl-tooltip">
            <strong>${text(obj.name)}</strong><br/>
            Interaction pressure: ${severityPct}%<br/>
            Mentions: ${text(obj.mentionCount)}${obj.criticalCount ? ` (critical: ${text(obj.criticalCount)})` : ''}<br/>
            <span style="opacity:.72">Last seen: ${text(lastSeen)}</span>
          </div>`,
        };
      }
      case 'positive-events-layer': {
        const catLabel = obj.category ? obj.category.replace(/-/g, ' & ') : 'Positive Event';
        const countInfo = obj.count > 1 ? `<br/><span style="opacity:.7">${obj.count} sources reporting</span>` : '';
        return { html: `<div class="deckgl-tooltip"><strong>${text(obj.name)}</strong><br/><span style="text-transform:capitalize">${text(catLabel)}</span>${countInfo}</div>` };
      }
      case 'kindness-layer':
        return { html: `<div class="deckgl-tooltip"><strong>${text(obj.name)}</strong></div>` };
      case 'happiness-choropleth-layer': {
        const hcName = obj.properties?.name ?? 'Unknown';
        const hcCode = obj.properties?.['ISO3166-1-Alpha-2'];
        const hcScore = hcCode ? this.happinessScores.get(hcCode as string) : undefined;
        const hcScoreStr = hcScore != null ? hcScore.toFixed(1) : 'No data';
        return { html: `<div class="deckgl-tooltip"><strong>${text(hcName)}</strong><br/>Happiness: ${hcScoreStr}/10${hcScore != null ? `<br/><span style="opacity:.7">${text(this.happinessSource)} (${this.happinessYear})</span>` : ''}</div>` };
      }
      case 'species-recovery-layer': {
        return { html: `<div class="deckgl-tooltip"><strong>${text(obj.commonName)}</strong><br/>${text(obj.recoveryZone?.name ?? obj.region)}<br/><span style="opacity:.7">Status: ${text(obj.recoveryStatus)}</span></div>` };
      }
      case 'renewable-installations-layer': {
        const riTypeLabel = obj.type ? String(obj.type).charAt(0).toUpperCase() + String(obj.type).slice(1) : 'Renewable';
        return { html: `<div class="deckgl-tooltip"><strong>${text(obj.name)}</strong><br/>${riTypeLabel} &middot; ${obj.capacityMW?.toLocaleString() ?? '?'} MW<br/><span style="opacity:.7">${text(obj.country)} &middot; ${obj.year}</span></div>` };
      }
      case 'gulf-investments-layer': {
        const inv = obj as GulfInvestment;
        const flag = inv.investingCountry === 'SA' ? '🇸🇦' : '🇦🇪';
        const usd = inv.investmentUSD != null
          ? (inv.investmentUSD >= 1000 ? `$${(inv.investmentUSD / 1000).toFixed(1)}B` : `$${inv.investmentUSD}M`)
          : t('components.deckgl.tooltip.undisclosed');
        const stake = inv.stakePercent != null ? `<br/>${text(String(inv.stakePercent))}% ${t('components.deckgl.tooltip.stake')}` : '';
        return {
          html: `<div class="deckgl-tooltip">
            <strong>${flag} ${text(inv.assetName)}</strong><br/>
            <em>${text(inv.investingEntity)}</em><br/>
            ${text(inv.targetCountry)} · ${text(inv.sector)}<br/>
            <strong>${usd}</strong>${stake}<br/>
            <span style="text-transform:capitalize">${text(inv.status)}</span>
          </div>`,
        };
      }
      default:
        return null;
    }
  }

  private canonicalLayerId(rawLayerId: string): string {
    if (rawLayerId.endsWith('-ghost')) return rawLayerId.slice(0, -6);
    if (rawLayerId.startsWith('intel-density-h3-layer')) return 'intel-density-h3-layer';
    return rawLayerId;
  }

  private isArHudLayer(layerId: string): boolean {
    return new Set([
      'news-locations-layer',
      'country-interaction-arcs-layer',
      'intel-density-h3-layer',
      'cyber-threats-layer',
      'iran-events-layer',
      'military-flights-layer',
      'military-vessels-layer',
      'trade-routes-layer',
      'hotspots-layer',
      'outages-layer',
    ]).has(layerId);
  }

  private buildArHudPayload(layerId: string, raw: unknown): ArHudPayload | null {
    const obj = raw as Record<string, unknown>;
    switch (layerId) {
      case 'news-locations-layer':
        return {
          title: 'NEWS NODE',
          tone: 'intel',
          lines: [
            String(obj.title || 'Untitled event').slice(0, 110),
            `THREAT ${(String(obj.threatLevel || 'info')).toUpperCase()}`,
            Number.isFinite(new Date(String(obj.timestamp || '')).getTime()) ? `TS ${new Date(String(obj.timestamp)).toUTCString()}` : 'TS LIVE SNAPSHOT',
          ],
        };
      case 'country-interaction-arcs-layer':
        return {
          title: `${String(obj.sourceName || 'UNK')} -> ${String(obj.targetName || 'UNK')}`,
          tone: 'alert',
          lines: [
            `SEVERITY ${Math.round((Number(obj.normalized) || 0) * 100)}%`,
            `MENTIONS ${String(obj.mentionCount || 0)} / CRITICAL ${String(obj.criticalCount || 0)}`,
            String(obj.sampleTitle || 'Cross-border interaction pressure').slice(0, 110),
          ],
        };
      case 'intel-density-h3-layer': {
        const breakdown = Array.isArray(obj.breakdown) ? obj.breakdown as Array<Record<string, unknown>> : [];
        const totalWeight = Math.max(0.0001, Number(obj.totalWeight) || 0);
        const formatShare = (kind: string): string => {
          const match = breakdown.find((entry) => String(entry.sourceKind) === kind);
          const weight = Number(match?.weight) || 0;
          return `${kind.toUpperCase()} ${Math.round((weight / totalWeight) * 100)}%`;
        };
        return {
          title: `H3 CELL R${String(obj.resolution || 'NA')} ${String(obj.dominantSourceKind || 'mixed').toUpperCase()}`,
          tone: 'intel',
          lines: [
            `POINTS ${String(obj.pointCount || 0)} / SCORE ${Math.round(totalWeight * 10) / 10}`,
            `${formatShare('news')} | ${formatShare('cyber')} | ${formatShare('military')}`,
            `${formatShare('conflict')} | ${formatShare('maritime')} | ${formatShare('protest')}`,
            `${formatShare('outage')} | CONF ${Math.round((Number(obj.averageConfidence) || 0) * 100)}%`,
          ],
        };
      }
      case 'cyber-threats-layer':
        return {
          title: 'CYBER THREAT',
          tone: 'cyber',
          lines: [
            String(obj.country || 'Unknown geography'),
            `SEVERITY ${(String(obj.severity || 'medium')).toUpperCase()}`,
            String(obj.description || obj.title || 'Active malicious infrastructure signal').slice(0, 110),
          ],
        };
      case 'iran-events-layer':
        return {
          title: 'CRISIS EVENT',
          tone: 'alert',
          lines: [
            String(obj.title || 'Untitled event').slice(0, 100),
            `CATEGORY ${(String(obj.category || 'unknown')).toUpperCase()}`,
            `SEVERITY ${(String(obj.severity || 'medium')).toUpperCase()}`,
          ],
        };
      case 'military-flights-layer':
        return {
          title: String(obj.callsign || obj.registration || 'MIL FLIGHT'),
          tone: 'alert',
          lines: [
            String(obj.type || 'Unknown platform'),
            `ALT ${String(obj.altitude || 'NA')} / SPD ${String(obj.speed || 'NA')}`,
            String(obj.operatorCountry || obj.country || 'Unknown operator'),
          ],
        };
      case 'military-vessels-layer':
        return {
          title: String(obj.name || 'MIL VESSEL'),
          tone: 'alert',
          lines: [
            String(obj.type || 'Unknown class'),
            String(obj.operatorCountry || obj.country || 'Unknown operator'),
            `LAST AIS ${String(obj.lastAisUpdate || 'NA')}`.slice(0, 120),
          ],
        };
      case 'trade-routes-layer':
        return {
          title: String(obj.routeName || obj.routeId || 'TRADE FLOW'),
          tone: 'market',
          lines: [
            `STATUS ${(String(obj.status || 'active')).toUpperCase()}`,
            `CATEGORY ${(String(obj.category || 'general')).toUpperCase()}`,
            String(obj.volumeDesc || 'Capital and supply chain artery').slice(0, 110),
          ],
        };
      case 'hotspots-layer':
        return {
          title: String(obj.name || 'INTEL HOTSPOT'),
          tone: 'intel',
          lines: [
            String(obj.subtext || 'Escalation concentration zone').slice(0, 110),
            `RISK ${(String(obj.level || obj.threatLevel || 'elevated')).toUpperCase()}`,
          ],
        };
      case 'outages-layer':
        return {
          title: String(obj.asn || 'NETWORK OUTAGE'),
          tone: 'cyber',
          lines: [
            String(obj.country || 'Unknown geography'),
            String(obj.description || obj.summary || 'Connectivity degradation').slice(0, 110),
          ],
        };
      default:
        return null;
    }
  }

  private setArHud(payload: ArHudPayload | null, x: number, y: number, locked: boolean): void {
    if (!this.arHudEl || !this.wrapperEl) return;
    if (!payload) {
      this.arHudEl.classList.remove('active', 'locked', 'tone-alert', 'tone-cyber', 'tone-intel', 'tone-market');
      this.arHudEl.innerHTML = '';
      this.hudLocked = false;
      return;
    }

    const hudWidth = 280;
    const hudHeight = 132;
    const maxX = Math.max(16, this.wrapperEl.clientWidth - hudWidth - 16);
    const maxY = Math.max(16, this.wrapperEl.clientHeight - hudHeight - 16);
    const clampedX = Math.max(16, Math.min(maxX, x + 18));
    const clampedY = Math.max(16, Math.min(maxY, y - 22));

    this.arHudEl.className = `deckgl-ar-hud active tone-${payload.tone}${locked ? ' locked' : ''}`;
    this.arHudEl.style.left = `${clampedX}px`;
    this.arHudEl.style.top = `${clampedY}px`;
    this.arHudEl.innerHTML = `
      <div class="deckgl-ar-hud-header">
        <span class="deckgl-ar-hud-title">${escapeHtml(payload.title)}</span>
        <span class="deckgl-ar-hud-badge">${locked ? 'LOCK' : 'LIVE'}</span>
      </div>
      <div class="deckgl-ar-hud-body">
        ${payload.lines.map((line) => `<div class="deckgl-ar-hud-line">${escapeHtml(line)}</div>`).join('')}
      </div>
    `;
    this.hudLocked = locked;
  }

  private showArHudFromInfo(info: PickingInfo, locked: boolean): boolean {
    if (!info.object) return false;
    const layerId = this.canonicalLayerId(info.layer?.id || '');
    if (!this.isArHudLayer(layerId)) return false;
    const payload = this.buildArHudPayload(layerId, info.object);
    if (!payload) return false;
    this.setArHud(payload, info.x ?? 0, info.y ?? 0, locked);
    return true;
  }

  private handleHover(info: PickingInfo): void {
    if (this.hudLocked) return;
    if (!info.object) {
      this.setArHud(null, 0, 0, false);
      this.setArHud(null, 0, 0, false);
      return;
    }
    if (!this.showArHudFromInfo(info, false)) {
      this.setArHud(null, 0, 0, false);
    }
  }

  private handleClick(info: PickingInfo): void {
    if (!info.object) {
      // Empty map click → country detection
      if (info.coordinate && this.onCountryClick) {
        const [lon, lat] = info.coordinate as [number, number];
        const country = this.resolveCountryFromCoordinate(lon, lat);
        this.onCountryClick({
          lat,
          lon,
          ...(country ? { code: country.code, name: country.name } : {}),
        });
      }
      return;
    }

    const layerId = this.canonicalLayerId(info.layer?.id || '');
    this.showArHudFromInfo(info, true);

    // Hotspots show popup with related news
    if (layerId === 'hotspots-layer') {
      const hotspot = info.object as Hotspot;
      const relatedNews = this.getRelatedNews(hotspot);
      this.popup.show({
        type: 'hotspot',
        data: hotspot,
        relatedNews,
        x: info.x,
        y: info.y,
      });
      this.popup.loadHotspotGdeltContext(hotspot);
      this.onHotspotClick?.(hotspot);
      return;
    }

    // Handle cluster layers with single/multi logic
    if (layerId === 'protest-clusters-layer') {
      const cluster = info.object as MapProtestCluster;
      if (cluster.count === 1 && cluster.items[0]) {
        this.popup.show({ type: 'protest', data: cluster.items[0], x: info.x, y: info.y });
      } else {
        this.popup.show({
          type: 'protestCluster',
          data: {
            items: cluster.items,
            country: cluster.country,
            count: cluster.count,
            riotCount: cluster.riotCount,
            highSeverityCount: cluster.highSeverityCount,
            verifiedCount: cluster.verifiedCount,
            totalFatalities: cluster.totalFatalities,
            sampled: cluster.sampled,
          },
          x: info.x,
          y: info.y,
        });
      }
      return;
    }
    if (layerId === 'tech-hq-clusters-layer') {
      const cluster = info.object as MapTechHQCluster;
      if (cluster.count === 1 && cluster.items[0]) {
        this.popup.show({ type: 'techHQ', data: cluster.items[0], x: info.x, y: info.y });
      } else {
        this.popup.show({
          type: 'techHQCluster',
          data: {
            items: cluster.items,
            city: cluster.city,
            country: cluster.country,
            count: cluster.count,
            faangCount: cluster.faangCount,
            unicornCount: cluster.unicornCount,
            publicCount: cluster.publicCount,
            sampled: cluster.sampled,
          },
          x: info.x,
          y: info.y,
        });
      }
      return;
    }
    if (layerId === 'tech-event-clusters-layer') {
      const cluster = info.object as MapTechEventCluster;
      if (cluster.count === 1 && cluster.items[0]) {
        this.popup.show({ type: 'techEvent', data: cluster.items[0], x: info.x, y: info.y });
      } else {
        this.popup.show({
          type: 'techEventCluster',
          data: {
            items: cluster.items,
            location: cluster.location,
            country: cluster.country,
            count: cluster.count,
            soonCount: cluster.soonCount,
            sampled: cluster.sampled,
          },
          x: info.x,
          y: info.y,
        });
      }
      return;
    }
    if (layerId === 'datacenter-clusters-layer') {
      const cluster = info.object as MapDatacenterCluster;
      if (cluster.count === 1 && cluster.items[0]) {
        this.popup.show({ type: 'datacenter', data: cluster.items[0], x: info.x, y: info.y });
      } else {
        this.popup.show({
          type: 'datacenterCluster',
          data: {
            items: cluster.items,
            region: cluster.region || cluster.country,
            country: cluster.country,
            count: cluster.count,
            totalChips: cluster.totalChips,
            totalPowerMW: cluster.totalPowerMW,
            existingCount: cluster.existingCount,
            plannedCount: cluster.plannedCount,
            sampled: cluster.sampled,
          },
          x: info.x,
          y: info.y,
        });
      }
      return;
    }

    if (layerId === 'country-interaction-nodes-layer') {
      const node = info.object as CountryInteractionNode;
      if (node?.code) {
        this.highlightCountry(node.code);
        this.onCountryClick?.({
          lat: node.lat,
          lon: node.lon,
          code: node.code,
          name: node.name,
        });
      }
      return;
    }

    // Map layer IDs to popup types
    const layerToPopupType: Record<string, PopupType> = {
      'conflict-zones-layer': 'conflict',
      'bases-layer': 'base',
      'nuclear-layer': 'nuclear',
      'irradiators-layer': 'irradiator',
      'datacenters-layer': 'datacenter',
      'cables-layer': 'cable',
      'pipelines-layer': 'pipeline',
      'earthquakes-layer': 'earthquake',
      'weather-layer': 'weather',
      'iran-events-layer': 'iranEvent',
      'gps-jamming-layer': 'gpsJamming',
      'outages-layer': 'outage',
      'cyber-threats-layer': 'cyberThreat',
      'protests-layer': 'protest',
      'military-flights-layer': 'militaryFlight',
      'military-vessels-layer': 'militaryVessel',
      'military-vessel-clusters-layer': 'militaryVesselCluster',
      'military-flight-clusters-layer': 'militaryFlightCluster',
      'natural-events-layer': 'natEvent',
      'waterways-layer': 'waterway',
      'economic-centers-layer': 'economic',
      'stock-exchanges-layer': 'stockExchange',
      'financial-centers-layer': 'financialCenter',
      'central-banks-layer': 'centralBank',
      'commodity-hubs-layer': 'commodityHub',
      'spaceports-layer': 'spaceport',
      'ports-layer': 'port',
      'flight-delays-layer': 'flight',
      'startup-hubs-layer': 'startupHub',
      'tech-hqs-layer': 'techHQ',
      'accelerators-layer': 'accelerator',
      'cloud-regions-layer': 'cloudRegion',
      'tech-events-layer': 'techEvent',
      'apt-groups-layer': 'apt',
      'minerals-layer': 'mineral',
      'ais-disruptions-layer': 'ais',
      'cable-advisories-layer': 'cable-advisory',
      'repair-ships-layer': 'repair-ship',
    };

    const popupType = layerToPopupType[layerId];
    if (!popupType) return;

    // For GeoJSON layers, the data is in properties
    let data = info.object;
    if (layerId === 'conflict-zones-layer' && info.object.properties) {
      // Find the full conflict zone data from current static/dynamic set
      const conflictId = info.object.properties.id;
      const fullConflict = this.getRenderableConflictZones().find(c => c.id === conflictId);
      if (fullConflict) data = fullConflict;
    }

    // Get click coordinates relative to container
    const x = info.x ?? 0;
    const y = info.y ?? 0;

    this.popup.show({
      type: popupType,
      data: data,
      x,
      y,
    });
  }

  private buildTerminatorPath(now = Date.now()): Array<[number, number, number]> {
    const toJulian = (ts: number): number => ts / 86_400_000 - 0.5 + 2440588;
    const toDays = (ts: number): number => toJulian(ts) - 2451545;
    const rad = Math.PI / 180;
    const days = toDays(now);
    const meanAnomaly = rad * (357.5291 + 0.98560028 * days);
    const center = rad * (1.9148 * Math.sin(meanAnomaly) + 0.02 * Math.sin(2 * meanAnomaly) + 0.0003 * Math.sin(3 * meanAnomaly));
    const perihelion = rad * 102.9372;
    const eclipticLongitude = meanAnomaly + center + perihelion + Math.PI;
    const obliquity = rad * 23.4397;
    const declination = Math.asin(Math.sin(eclipticLongitude) * Math.sin(obliquity));
    const rightAscension = Math.atan2(
      Math.sin(eclipticLongitude) * Math.cos(obliquity),
      Math.cos(eclipticLongitude),
    );
    const sidereal = rad * (280.16 + 360.9856235 * days);
    const subsolarLongitude = this.normalizeLongitude(((rightAscension - sidereal) / rad) * -1);

    const sunVector: [number, number, number] = [
      Math.cos(declination) * Math.cos(subsolarLongitude * rad),
      Math.cos(declination) * Math.sin(subsolarLongitude * rad),
      Math.sin(declination),
    ];
    const ref: [number, number, number] = Math.abs(sunVector[2]) > 0.92 ? [1, 0, 0] : [0, 0, 1];
    const cross = (a: [number, number, number], b: [number, number, number]): [number, number, number] => [
      a[1] * b[2] - a[2] * b[1],
      a[2] * b[0] - a[0] * b[2],
      a[0] * b[1] - a[1] * b[0],
    ];
    const normalize = (v: [number, number, number]): [number, number, number] => {
      const mag = Math.hypot(v[0], v[1], v[2]) || 1;
      return [v[0] / mag, v[1] / mag, v[2] / mag];
    };
    const basisA = normalize(cross(ref, sunVector));
    const basisB = normalize(cross(sunVector, basisA));
    const points: Array<[number, number, number]> = [];
    for (let i = 0; i <= 180; i += 1) {
      const theta = (i / 180) * Math.PI * 2;
      const x = basisA[0] * Math.cos(theta) + basisB[0] * Math.sin(theta);
      const y = basisA[1] * Math.cos(theta) + basisB[1] * Math.sin(theta);
      const z = basisA[2] * Math.cos(theta) + basisB[2] * Math.sin(theta);
      const lon = Math.atan2(y, x) / rad;
      const lat = Math.asin(z) / rad;
      points.push(this.getOverlayPosition(lon, lat, 2500));
    }
    return points;
  }

  private createDayNightLayers(): Layer[] {
    const path = this.buildTerminatorPath(this.replayMode && this.replayCursorMs != null ? this.replayCursorMs : Date.now());
    return [
      new PathLayer({
        id: 'day-night-glow-layer',
        data: [{ path }],
        getPath: (d) => d.path,
        getColor: [56, 189, 248, 68],
        getWidth: 9,
        widthUnits: 'pixels',
        rounded: true,
        pickable: false,
      }),
      new PathLayer({
        id: 'day-night-layer',
        data: [{ path }],
        getPath: (d) => d.path,
        getColor: [191, 219, 254, 185],
        getWidth: 2,
        widthUnits: 'pixels',
        rounded: true,
        pickable: false,
      }),
    ];
  }

  // Utility methods
  private hexToRgba(hex: string, alpha: number): [number, number, number, number] {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    if (result && result[1] && result[2] && result[3]) {
      return [
        parseInt(result[1], 16),
        parseInt(result[2], 16),
        parseInt(result[3], 16),
        alpha,
      ];
    }
    return [100, 100, 100, alpha];
  }

  // UI Creation methods
  private createControls(): void {
    const controls = document.createElement('div');
    controls.className = 'map-controls deckgl-controls';
    controls.innerHTML = `
      <div class="zoom-controls">
        <button class="map-btn zoom-in" title="${t('components.deckgl.zoomIn')}">+</button>
        <button class="map-btn zoom-out" title="${t('components.deckgl.zoomOut')}">-</button>
        <button class="map-btn zoom-reset" title="${t('components.deckgl.resetView')}">&#8962;</button>
        <button class="map-btn projection-toggle" title="Switch to flat map" aria-label="Switch to flat map">GL</button>
      </div>
      <div class="view-selector">
        <select class="view-select">
          <option value="global">${t('components.deckgl.views.global')}</option>
          <option value="america">${t('components.deckgl.views.americas')}</option>
          <option value="mena">${t('components.deckgl.views.mena')}</option>
          <option value="eu">${t('components.deckgl.views.europe')}</option>
          <option value="asia">${t('components.deckgl.views.asia')}</option>
          <option value="latam">${t('components.deckgl.views.latam')}</option>
          <option value="africa">${t('components.deckgl.views.africa')}</option>
          <option value="oceania">${t('components.deckgl.views.oceania')}</option>
        </select>
      </div>
    `;

    this.container.appendChild(controls);

    // Bind events - use event delegation for reliability
    controls.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      if (target.classList.contains('zoom-in')) this.zoomIn();
      else if (target.classList.contains('zoom-out')) this.zoomOut();
      else if (target.classList.contains('zoom-reset')) this.resetView();
      else if (target.classList.contains('projection-toggle')) this.toggleProjectionMode();
    });

    const viewSelect = controls.querySelector('.view-select') as HTMLSelectElement;
    viewSelect.value = this.state.view;
    viewSelect.addEventListener('change', () => {
      this.setView(viewSelect.value as DeckMapView);
    });

    this.updateProjectionButton();
  }

  private getPreferredProjectionForView(view: DeckMapView): MapProjectionMode {
    return view === 'global' ? DEFAULT_MAP_PROJECTION : 'mercator';
  }

  private applyProjection(mode: MapProjectionMode): void {
    if (!this.maplibreMap) return;
    if (this.projectionMode === mode) {
      this.updateProjectionButton();
      return;
    }
    try {
      this.maplibreMap.setProjection({ type: mode });
      this.projectionMode = mode;
    } catch (error) {
      console.warn(`[DeckGLMap] Failed to set projection "${mode}"`, error);
      if (mode !== 'mercator') {
        try {
          this.maplibreMap.setProjection({ type: 'mercator' });
          this.projectionMode = 'mercator';
        } catch {
          // best effort fallback
        }
      }
    }
    // Keep expensive layer caches to reduce 2D/3D switch stutter.
    this.updateProjectionButton();
    this.render();
  }

  private toggleProjectionMode(): void {
    const nextMode: MapProjectionMode = this.projectionMode === 'globe' ? 'mercator' : 'globe';
    this.applyProjection(nextMode);
  }

  private updateProjectionButton(): void {
    const button = this.container.querySelector('.projection-toggle') as HTMLButtonElement | null;
    if (!button) return;
    const globe = this.projectionMode === 'globe';
    button.textContent = globe ? 'GL' : '2D';
    const label = globe ? 'Switch to flat map' : 'Switch to globe map';
    button.title = label;
    button.setAttribute('aria-label', label);
    button.classList.toggle('active', globe);
  }

  private createTimeSlider(): void {
    const slider = document.createElement('div');
    slider.className = 'time-slider deckgl-time-slider';
    slider.innerHTML = `
      <div class="time-options">
        <button class="time-btn ${this.state.timeRange === '1h' ? 'active' : ''}" data-range="1h">1h</button>
        <button class="time-btn ${this.state.timeRange === '6h' ? 'active' : ''}" data-range="6h">6h</button>
        <button class="time-btn ${this.state.timeRange === '24h' ? 'active' : ''}" data-range="24h">24h</button>
        <button class="time-btn ${this.state.timeRange === '48h' ? 'active' : ''}" data-range="48h">48h</button>
        <button class="time-btn ${this.state.timeRange === '7d' ? 'active' : ''}" data-range="7d">7d</button>
        <button class="time-btn ${this.state.timeRange === 'all' ? 'active' : ''}" data-range="all">${t('components.deckgl.timeAll')}</button>
      </div>
      <div class="replay-row">
        <button class="replay-toggle-btn" data-replay="toggle" aria-label="Toggle replay mode">REPLAY</button>
        <button class="replay-play-btn" data-replay="play" aria-label="Play/Pause replay" disabled>></button>
        <input class="replay-slider" data-replay="slider" type="range" min="0" max="1000" value="1000" step="1" disabled />
        <span class="replay-time-label" data-replay="label">LIVE</span>
      </div>
    `;

    this.container.appendChild(slider);

    slider.querySelectorAll('.time-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const range = (btn as HTMLElement).dataset.range as TimeRange;
        this.setTimeRange(range);
      });
    });

    const replayToggle = slider.querySelector('[data-replay="toggle"]') as HTMLButtonElement | null;
    replayToggle?.addEventListener('click', () => {
      this.setReplayMode(!this.replayMode);
    });

    const replayPlay = slider.querySelector('[data-replay="play"]') as HTMLButtonElement | null;
    replayPlay?.addEventListener('click', () => {
      this.toggleReplayPlayback();
    });

    const replaySlider = slider.querySelector('[data-replay="slider"]') as HTMLInputElement | null;
    replaySlider?.addEventListener('input', () => {
      const value = Number(replaySlider.value);
      if (!Number.isFinite(value)) return;
      this.setReplayCursorPercent(value / 1000);
    });
    this.updateReplayControls();
  }

  private updateTimeSliderButtons(): void {
    const slider = this.container.querySelector('.deckgl-time-slider');
    if (!slider) return;
    slider.querySelectorAll('.time-btn').forEach((btn) => {
      const range = (btn as HTMLElement).dataset.range as TimeRange | undefined;
      btn.classList.toggle('active', range === this.state.timeRange);
    });
    this.updateReplayBounds();
    this.updateReplayControls();
  }

  private updateReplayBounds(): void {
    const candidates: number[] = [];
    const pushTs = (value: Date | string | number | undefined | null): void => {
      const ts = this.parseTime(value);
      if (ts != null) candidates.push(ts);
    };

    for (const n of this.news) pushTs(n.pubDate);
    for (const n of this.newsLocations) pushTs(n.timestamp);
    for (const p of this.protests) pushTs(p.time);
    for (const f of this.militaryFlights) pushTs(f.lastSeen);
    for (const v of this.militaryVessels) pushTs(v.lastAisUpdate);
    for (const o of this.outages) pushTs(o.pubDate);
    for (const w of this.weatherAlerts) pushTs(w.onset);
    for (const e of this.earthquakes) pushTs(e.occurredAt);
    for (const n of this.naturalEvents) pushTs(n.date);
    for (const u of this.ucdpEvents) pushTs(u.date_start);

    if (candidates.length === 0) {
      const now = Date.now();
      this.replayMinTs = now - 24 * 60 * 60 * 1000;
      this.replayMaxTs = now;
      if (this.replayCursorMs == null) this.replayCursorMs = this.replayMaxTs;
      this.replayStepMs = 15 * 60 * 1000;
      return;
    }

    candidates.sort((a, b) => a - b);
    this.replayMinTs = candidates[0] ?? Date.now() - 24 * 60 * 60 * 1000;
    this.replayMaxTs = candidates[candidates.length - 1] ?? Date.now();
    const span = Math.max(1, this.replayMaxTs - this.replayMinTs);
    this.replayStepMs = Math.max(5 * 60 * 1000, Math.round(span / 120));
    if (this.replayCursorMs == null) this.replayCursorMs = this.replayMaxTs;
    this.replayCursorMs = Math.max(this.replayMinTs, Math.min(this.replayMaxTs, this.replayCursorMs));
  }

  private setReplayMode(enabled: boolean): void {
    if (this.replayMode === enabled) return;
    this.updateReplayBounds();
    this.replayMode = enabled;
    if (!enabled) {
      this.stopReplayTimer();
      this.replayPlaying = false;
      this.replayCursorMs = this.replayMaxTs || Date.now();
      this.syncPulseAnimation();
      this.render();
      this.updateReplayControls();
      return;
    }
    this.replayCursorMs = this.replayMaxTs || Date.now();
    this.stopPulseAnimation();
    this.render();
    this.updateReplayControls();
  }

  private stopReplayTimer(): void {
    if (this.replayTimerId != null) {
      clearInterval(this.replayTimerId);
      this.replayTimerId = null;
    }
  }

  private setReplayCursorPercent(percent: number): void {
    this.updateReplayBounds();
    const clamped = Math.max(0, Math.min(1, percent));
    const span = Math.max(1, this.replayMaxTs - this.replayMinTs);
    this.replayCursorMs = this.replayMinTs + span * clamped;
    if (this.replayMode) {
      this.render();
    }
    this.updateReplayControls();
  }

  private toggleReplayPlayback(): void {
    if (!this.replayMode) return;
    if (this.replayPlaying) {
      this.replayPlaying = false;
      this.stopReplayTimer();
      this.updateReplayControls();
      return;
    }
    this.replayPlaying = true;
    this.stopReplayTimer();
    this.replayTimerId = setInterval(() => {
      if (!this.replayMode) return;
      const next = (this.replayCursorMs ?? this.replayMinTs) + this.replayStepMs;
      if (next >= this.replayMaxTs) {
        this.replayCursorMs = this.replayMaxTs;
        this.replayPlaying = false;
        this.stopReplayTimer();
      } else {
        this.replayCursorMs = next;
      }
      this.render();
      this.updateReplayControls();
    }, 700);
    this.updateReplayControls();
  }

  private updateReplayControls(): void {
    const sliderHost = this.container.querySelector('.deckgl-time-slider');
    if (!sliderHost) return;
    const toggle = sliderHost.querySelector('[data-replay="toggle"]') as HTMLButtonElement | null;
    const play = sliderHost.querySelector('[data-replay="play"]') as HTMLButtonElement | null;
    const slider = sliderHost.querySelector('[data-replay="slider"]') as HTMLInputElement | null;
    const label = sliderHost.querySelector('[data-replay="label"]') as HTMLElement | null;

    if (toggle) toggle.classList.toggle('active', this.replayMode);
    if (play) {
      play.disabled = !this.replayMode;
      play.textContent = this.replayPlaying ? '⏸' : '▶';
    }
    if (slider) {
      slider.disabled = !this.replayMode;
      const span = Math.max(1, this.replayMaxTs - this.replayMinTs);
      const cursor = this.replayCursorMs ?? this.replayMaxTs;
      const pct = Math.round(((cursor - this.replayMinTs) / span) * 1000);
      slider.value = String(Math.max(0, Math.min(1000, pct)));
    }
    if (label) {
      if (!this.replayMode || this.replayCursorMs == null) {
        label.textContent = 'LIVE';
      } else {
        label.textContent = new Date(this.replayCursorMs).toLocaleString(undefined, {
          month: 'short',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
        });
      }
    }
  }

  private createLayerToggles(): void {
    const toggles = document.createElement('div');
    toggles.className = 'layer-toggles deckgl-layer-toggles';

    const layerConfig = SITE_VARIANT === 'tech'
      ? [
        { key: 'startupHubs', label: t('components.deckgl.layers.startupHubs'), icon: '&#128640;' },
        { key: 'techHQs', label: t('components.deckgl.layers.techHQs'), icon: '&#127970;' },
        { key: 'accelerators', label: t('components.deckgl.layers.accelerators'), icon: '&#9889;' },
        { key: 'cloudRegions', label: t('components.deckgl.layers.cloudRegions'), icon: '&#9729;' },
        { key: 'datacenters', label: t('components.deckgl.layers.aiDataCenters'), icon: '&#128421;' },
        { key: 'cables', label: t('components.deckgl.layers.underseaCables'), icon: '&#128268;' },
        { key: 'outages', label: t('components.deckgl.layers.internetOutages'), icon: '&#128225;' },
        { key: 'cyberThreats', label: t('components.deckgl.layers.cyberThreats'), icon: '&#128737;' },
        { key: 'intelDensity', label: 'Intel Density 3D', icon: '&#11014;' },
        { key: 'techEvents', label: t('components.deckgl.layers.techEvents'), icon: '&#128197;' },
        { key: 'natural', label: t('components.deckgl.layers.naturalEvents'), icon: '&#127755;' },
        { key: 'fires', label: t('components.deckgl.layers.fires'), icon: '&#128293;' },
      ]
      : SITE_VARIANT === 'finance'
      ? [
          { key: 'stockExchanges', label: t('components.deckgl.layers.stockExchanges'), icon: '&#127963;' },
          { key: 'financialCenters', label: t('components.deckgl.layers.financialCenters'), icon: '&#128176;' },
          { key: 'centralBanks', label: t('components.deckgl.layers.centralBanks'), icon: '&#127974;' },
          { key: 'commodityHubs', label: t('components.deckgl.layers.commodityHubs'), icon: '&#128230;' },
          { key: 'gulfInvestments', label: t('components.deckgl.layers.gulfInvestments'), icon: '&#127760;' },
          { key: 'tradeRoutes', label: t('components.deckgl.layers.tradeRoutes'), icon: '&#128674;' },
          { key: 'cables', label: t('components.deckgl.layers.underseaCables'), icon: '&#128268;' },
          { key: 'pipelines', label: t('components.deckgl.layers.pipelines'), icon: '&#128738;' },
          { key: 'outages', label: t('components.deckgl.layers.internetOutages'), icon: '&#128225;' },
          { key: 'weather', label: t('components.deckgl.layers.weatherAlerts'), icon: '&#9928;' },
          { key: 'economic', label: t('components.deckgl.layers.economicCenters'), icon: '&#128176;' },
          { key: 'intelDensity', label: 'Intel Density 3D', icon: '&#11014;' },
          { key: 'waterways', label: t('components.deckgl.layers.strategicWaterways'), icon: '&#9875;' },
          { key: 'natural', label: t('components.deckgl.layers.naturalEvents'), icon: '&#127755;' },
          { key: 'cyberThreats', label: t('components.deckgl.layers.cyberThreats'), icon: '&#128737;' },
        ]
      : SITE_VARIANT === 'happy'
      ? [
          { key: 'positiveEvents', label: 'Positive Events', icon: '&#127775;' },
          { key: 'kindness', label: 'Acts of Kindness', icon: '&#128154;' },
          { key: 'happiness', label: 'World Happiness', icon: '&#128522;' },
          { key: 'speciesRecovery', label: 'Species Recovery', icon: '&#128062;' },
          { key: 'renewableInstallations', label: 'Clean Energy', icon: '&#9889;' },
        ]
      : [
        { key: 'hotspots', label: t('components.deckgl.layers.intelHotspots'), icon: '&#127919;' },
        { key: 'conflicts', label: t('components.deckgl.layers.conflictZones'), icon: '&#9876;' },
        { key: 'bases', label: t('components.deckgl.layers.militaryBases'), icon: '&#127963;' },
        { key: 'nuclear', label: t('components.deckgl.layers.nuclearSites'), icon: '&#9762;' },
        { key: 'irradiators', label: t('components.deckgl.layers.gammaIrradiators'), icon: '&#9888;' },
        { key: 'spaceports', label: t('components.deckgl.layers.spaceports'), icon: '&#128640;' },
        { key: 'cables', label: t('components.deckgl.layers.underseaCables'), icon: '&#128268;' },
        { key: 'pipelines', label: t('components.deckgl.layers.pipelines'), icon: '&#128738;' },
        { key: 'datacenters', label: t('components.deckgl.layers.aiDataCenters'), icon: '&#128421;' },
        { key: 'military', label: t('components.deckgl.layers.militaryActivity'), icon: '&#9992;' },
        { key: 'ais', label: t('components.deckgl.layers.shipTraffic'), icon: '&#128674;' },
        { key: 'intelDensity', label: 'Intel Density 3D', icon: '&#11014;' },
        { key: 'tradeRoutes', label: t('components.deckgl.layers.tradeRoutes'), icon: '&#9875;' },
        { key: 'flights', label: t('components.deckgl.layers.flightDelays'), icon: '&#9992;' },
        { key: 'protests', label: t('components.deckgl.layers.protests'), icon: '&#128226;' },
        { key: 'ucdpEvents', label: t('components.deckgl.layers.ucdpEvents'), icon: '&#9876;' },
        { key: 'displacement', label: t('components.deckgl.layers.displacementFlows'), icon: '&#128101;' },
        { key: 'climate', label: t('components.deckgl.layers.climateAnomalies'), icon: '&#127787;' },
        { key: 'weather', label: t('components.deckgl.layers.weatherAlerts'), icon: '&#9928;' },
        { key: 'outages', label: t('components.deckgl.layers.internetOutages'), icon: '&#128225;' },
        { key: 'cyberThreats', label: t('components.deckgl.layers.cyberThreats'), icon: '&#128737;' },
        { key: 'natural', label: t('components.deckgl.layers.naturalEvents'), icon: '&#127755;' },
        { key: 'fires', label: t('components.deckgl.layers.fires'), icon: '&#128293;' },
        { key: 'waterways', label: t('components.deckgl.layers.strategicWaterways'), icon: '&#9875;' },
        { key: 'economic', label: t('components.deckgl.layers.economicCenters'), icon: '&#128176;' },
        { key: 'minerals', label: t('components.deckgl.layers.criticalMinerals'), icon: '&#128142;' },
      ];

    toggles.innerHTML = `
      <div class="toggle-header">
        <span>${t('components.deckgl.layersTitle')}</span>
        <button class="layer-help-btn" title="${t('components.deckgl.layerGuide')}">?</button>
        <button class="toggle-collapse">&#9660;</button>
      </div>
      <div class="toggle-list" style="max-height: 32vh; overflow-y: auto; scrollbar-width: thin;">
        ${layerConfig.map(({ key, label, icon }) => `
          <label class="layer-toggle" data-layer="${key}">
            <input type="checkbox" ${this.state.layers[key as keyof MapLayers] ? 'checked' : ''}>
            <span class="toggle-icon">${icon}</span>
            <span class="toggle-label">${label}</span>
          </label>
        `).join('')}
      </div>
    `;

    this.container.appendChild(toggles);

    // Bind toggle events
    toggles.querySelectorAll('.layer-toggle input').forEach(input => {
      input.addEventListener('change', () => {
        const layer = (input as HTMLInputElement).closest('.layer-toggle')?.getAttribute('data-layer') as keyof MapLayers;
        if (layer) {
          this.state.layers[layer] = (input as HTMLInputElement).checked;
          this.render();
          this.onLayerChange?.(layer, (input as HTMLInputElement).checked, 'user');
        }
      });
    });

    // Help button
    const helpBtn = toggles.querySelector('.layer-help-btn');
    helpBtn?.addEventListener('click', () => this.showLayerHelp());

    // Collapse toggle
    const collapseBtn = toggles.querySelector('.toggle-collapse');
    const toggleList = toggles.querySelector('.toggle-list');

    // Manual scroll: intercept wheel, prevent map zoom, scroll the list ourselves
    if (toggleList) {
      toggles.addEventListener('wheel', (e) => {
        e.stopPropagation();
        e.preventDefault();
        toggleList.scrollTop += e.deltaY;
      }, { passive: false });
      toggles.addEventListener('touchmove', (e) => e.stopPropagation(), { passive: false });
    }
    collapseBtn?.addEventListener('click', () => {
      toggleList?.classList.toggle('collapsed');
      if (collapseBtn) collapseBtn.innerHTML = toggleList?.classList.contains('collapsed') ? '&#9654;' : '&#9660;';
    });
  }

  /** Show layer help popup explaining each layer */
  private showLayerHelp(): void {
    const existing = this.container.querySelector('.layer-help-popup');
    if (existing) {
      existing.remove();
      return;
    }

    const popup = document.createElement('div');
    popup.className = 'layer-help-popup';

    const label = (layerKey: string): string => t(`components.deckgl.layers.${layerKey}`).toUpperCase();
    const staticLabel = (labelKey: string): string => t(`components.deckgl.layerHelp.labels.${labelKey}`).toUpperCase();
    const helpItem = (layerLabel: string, descriptionKey: string): string =>
      `<div class="layer-help-item"><span>${layerLabel}</span> ${t(`components.deckgl.layerHelp.descriptions.${descriptionKey}`)}</div>`;
    const helpSection = (titleKey: string, items: string[], noteKey?: string): string => `
      <div class="layer-help-section">
        <div class="layer-help-title">${t(`components.deckgl.layerHelp.sections.${titleKey}`)}</div>
        ${items.join('')}
        ${noteKey ? `<div class="layer-help-note">${t(`components.deckgl.layerHelp.notes.${noteKey}`)}</div>` : ''}
      </div>
    `;
    const helpHeader = `
      <div class="layer-help-header">
        <span>${t('components.deckgl.layerHelp.title')}</span>
        <button class="layer-help-close">×</button>
      </div>
    `;

    const techHelpContent = `
      ${helpHeader}
      <div class="layer-help-content">
        ${helpSection('techEcosystem', [
          helpItem(label('startupHubs'), 'techStartupHubs'),
          helpItem(label('cloudRegions'), 'techCloudRegions'),
          helpItem(label('techHQs'), 'techHQs'),
          helpItem(label('accelerators'), 'techAccelerators'),
          helpItem(label('techEvents'), 'techEvents'),
        ])}
        ${helpSection('infrastructure', [
          helpItem(label('underseaCables'), 'infraCables'),
          helpItem(label('aiDataCenters'), 'infraDatacenters'),
          helpItem(label('internetOutages'), 'infraOutages'),
          helpItem(label('cyberThreats'), 'techCyberThreats'),
        ])}
        ${helpSection('naturalEconomic', [
          helpItem(label('naturalEvents'), 'naturalEventsTech'),
          helpItem(label('fires'), 'techFires'),
          helpItem(staticLabel('countries'), 'countriesOverlay'),
        ])}
      </div>
    `;

    const financeHelpContent = `
      ${helpHeader}
      <div class="layer-help-content">
        ${helpSection('financeCore', [
          helpItem(label('stockExchanges'), 'financeExchanges'),
          helpItem(label('financialCenters'), 'financeCenters'),
          helpItem(label('centralBanks'), 'financeCentralBanks'),
          helpItem(label('commodityHubs'), 'financeCommodityHubs'),
          helpItem(label('gulfInvestments'), 'financeGulfInvestments'),
        ])}
        ${helpSection('infrastructureRisk', [
          helpItem(label('underseaCables'), 'financeCables'),
          helpItem(label('pipelines'), 'financePipelines'),
          helpItem(label('internetOutages'), 'financeOutages'),
          helpItem(label('cyberThreats'), 'financeCyberThreats'),
          helpItem(label('tradeRoutes'), 'tradeRoutes'),
        ])}
        ${helpSection('macroContext', [
          helpItem(label('economicCenters'), 'economicCenters'),
          helpItem(label('strategicWaterways'), 'macroWaterways'),
          helpItem(label('weatherAlerts'), 'weatherAlertsMarket'),
          helpItem(label('naturalEvents'), 'naturalEventsMacro'),
        ])}
      </div>
    `;

    const fullHelpContent = `
      ${helpHeader}
      <div class="layer-help-content">
        ${helpSection('timeFilter', [
          helpItem(staticLabel('timeRecent'), 'timeRecent'),
          helpItem(staticLabel('timeExtended'), 'timeExtended'),
        ], 'timeAffects')}
        ${helpSection('geopolitical', [
          helpItem(label('conflictZones'), 'geoConflicts'),
          helpItem(label('intelHotspots'), 'geoHotspots'),
          helpItem(staticLabel('sanctions'), 'geoSanctions'),
          helpItem(label('protests'), 'geoProtests'),
          helpItem(label('ucdpEvents'), 'geoUcdpEvents'),
          helpItem(label('displacementFlows'), 'geoDisplacement'),
        ])}
        ${helpSection('militaryStrategic', [
          helpItem(label('militaryBases'), 'militaryBases'),
          helpItem(label('nuclearSites'), 'militaryNuclear'),
          helpItem(label('gammaIrradiators'), 'militaryIrradiators'),
          helpItem(label('militaryActivity'), 'militaryActivity'),
          helpItem(label('spaceports'), 'militarySpaceports'),
        ])}
        ${helpSection('infrastructure', [
          helpItem(label('underseaCables'), 'infraCablesFull'),
          helpItem(label('pipelines'), 'infraPipelinesFull'),
          helpItem(label('internetOutages'), 'infraOutages'),
          helpItem(label('aiDataCenters'), 'infraDatacentersFull'),
          helpItem(label('cyberThreats'), 'infraCyberThreats'),
        ])}
        ${helpSection('transport', [
          helpItem(label('shipTraffic'), 'transportShipping'),
          helpItem(label('tradeRoutes'), 'tradeRoutes'),
          helpItem(label('flightDelays'), 'transportDelays'),
        ])}
        ${helpSection('naturalEconomic', [
          helpItem(label('naturalEvents'), 'naturalEventsFull'),
          helpItem(label('fires'), 'firesFull'),
          helpItem(label('weatherAlerts'), 'weatherAlerts'),
          helpItem(label('climateAnomalies'), 'climateAnomalies'),
          helpItem(label('economicCenters'), 'economicCenters'),
          helpItem(label('criticalMinerals'), 'mineralsFull'),
        ])}
        ${helpSection('labels', [
          helpItem(staticLabel('countries'), 'countriesOverlay'),
          helpItem(label('strategicWaterways'), 'waterwaysLabels'),
        ])}
      </div>
    `;

    popup.innerHTML = SITE_VARIANT === 'tech'
      ? techHelpContent
      : SITE_VARIANT === 'finance'
      ? financeHelpContent
      : fullHelpContent;

    popup.querySelector('.layer-help-close')?.addEventListener('click', () => popup.remove());

    // Prevent scroll events from propagating to map
    const content = popup.querySelector('.layer-help-content');
    if (content) {
      content.addEventListener('wheel', (e) => e.stopPropagation(), { passive: false });
      content.addEventListener('touchmove', (e) => e.stopPropagation(), { passive: false });
    }

    // Close on click outside
    setTimeout(() => {
      const closeHandler = (e: MouseEvent) => {
        if (!popup.contains(e.target as Node)) {
          popup.remove();
          document.removeEventListener('click', closeHandler);
        }
      };
      document.addEventListener('click', closeHandler);
    }, 100);

    this.container.appendChild(popup);
  }

  private createLegend(): void {
    const legend = document.createElement('div');
    legend.className = 'map-legend deckgl-legend';

    // SVG shapes for different marker types
    const shapes = {
      circle: (color: string) => `<svg width="12" height="12" viewBox="0 0 12 12"><circle cx="6" cy="6" r="5" fill="${color}"/></svg>`,
      triangle: (color: string) => `<svg width="12" height="12" viewBox="0 0 12 12"><polygon points="6,1 11,10 1,10" fill="${color}"/></svg>`,
      square: (color: string) => `<svg width="12" height="12" viewBox="0 0 12 12"><rect x="1" y="1" width="10" height="10" rx="1" fill="${color}"/></svg>`,
      hexagon: (color: string) => `<svg width="12" height="12" viewBox="0 0 12 12"><polygon points="6,1 10.5,3.5 10.5,8.5 6,11 1.5,8.5 1.5,3.5" fill="${color}"/></svg>`,
    };

    const isLight = getCurrentTheme() === 'light';
    const legendItems = SITE_VARIANT === 'tech'
      ? [
          { shape: shapes.circle(isLight ? 'rgb(22, 163, 74)' : 'rgb(0, 255, 150)'), label: t('components.deckgl.legend.startupHub') },
          { shape: shapes.circle('rgb(100, 200, 255)'), label: t('components.deckgl.legend.techHQ') },
          { shape: shapes.circle(isLight ? 'rgb(180, 120, 0)' : 'rgb(255, 200, 0)'), label: t('components.deckgl.legend.accelerator') },
          { shape: shapes.circle('rgb(150, 100, 255)'), label: t('components.deckgl.legend.cloudRegion') },
          { shape: shapes.square('rgb(136, 68, 255)'), label: t('components.deckgl.legend.datacenter') },
        ]
      : SITE_VARIANT === 'finance'
      ? [
          { shape: shapes.circle('rgb(255, 215, 80)'), label: t('components.deckgl.legend.stockExchange') },
          { shape: shapes.circle('rgb(0, 220, 150)'), label: t('components.deckgl.legend.financialCenter') },
          { shape: shapes.hexagon('rgb(255, 210, 80)'), label: t('components.deckgl.legend.centralBank') },
          { shape: shapes.square('rgb(255, 150, 80)'), label: t('components.deckgl.legend.commodityHub') },
          { shape: shapes.triangle('rgb(80, 170, 255)'), label: t('components.deckgl.legend.waterway') },
        ]
      : SITE_VARIANT === 'happy'
      ? [
          { shape: shapes.circle('rgb(34, 197, 94)'), label: 'Positive Event' },
          { shape: shapes.circle('rgb(234, 179, 8)'), label: 'Breakthrough' },
          { shape: shapes.circle('rgb(74, 222, 128)'), label: 'Act of Kindness' },
          { shape: shapes.circle('rgb(255, 100, 50)'), label: 'Natural Event' },
          { shape: shapes.square('rgb(34, 180, 100)'), label: 'Happy Country' },
          { shape: shapes.circle('rgb(74, 222, 128)'), label: 'Species Recovery Zone' },
          { shape: shapes.circle('rgb(255, 200, 50)'), label: 'Renewable Installation' },
        ]
      : [
          { shape: shapes.circle('rgb(255, 68, 68)'), label: t('components.deckgl.legend.highAlert') },
          { shape: shapes.circle('rgb(255, 165, 0)'), label: t('components.deckgl.legend.elevated') },
          { shape: shapes.circle(isLight ? 'rgb(180, 120, 0)' : 'rgb(255, 255, 0)'), label: t('components.deckgl.legend.monitoring') },
          { shape: shapes.triangle('rgb(68, 136, 255)'), label: t('components.deckgl.legend.base') },
          { shape: shapes.hexagon(isLight ? 'rgb(180, 120, 0)' : 'rgb(255, 220, 0)'), label: t('components.deckgl.legend.nuclear') },
          { shape: shapes.square('rgb(136, 68, 255)'), label: t('components.deckgl.legend.datacenter') },
        ];

    legend.innerHTML = `
      <span class="legend-label-title">${t('components.deckgl.legend.title')}</span>
      ${legendItems.map(({ shape, label }) => `<span class="legend-item">${shape}<span class="legend-label">${label}</span></span>`).join('')}
    `;

    this.container.appendChild(legend);
  }

  // Public API methods (matching MapComponent interface)
  public render(): void {
    if (this.renderPaused || this.mapInteractionActive) {
      this.renderPending = true;
      return;
    }
    if (this.renderScheduled) return;
    this.renderScheduled = true;

    requestAnimationFrame(() => {
      this.renderScheduled = false;
      this.updateLayers();
    });
  }

  public setRenderPaused(paused: boolean): void {
    if (this.renderPaused === paused) return;
    this.renderPaused = paused;
    if (paused) {
      this.stopPulseAnimation();
      this.stopReplayTimer();
      try {
        this.deckOverlay?.setProps({ layers: [] });
      } catch {
        // Map can be mid-teardown while focus modes hide the map.
      }
      return;
    }

    this.syncPulseAnimation();
    if (!paused && this.renderPending) {
      this.renderPending = false;
      this.render();
    } else if (!paused) {
      this.updateLayers();
    }
  }

  private updateLayers(): void {
    if (this.renderPaused || this.webglLost || !this.maplibreMap) return;
    const startTime = performance.now();
    try {
      this.deckOverlay?.setProps({ layers: this.buildLayers() });
    } catch { /* map may be mid-teardown (null.getProjection) */ }
    const elapsed = performance.now() - startTime;
    if (import.meta.env.DEV && elapsed > 16) {
      console.warn(`[DeckGLMap] updateLayers took ${elapsed.toFixed(2)}ms (>16ms budget)`);
    }
  }

  public setView(view: DeckMapView): void {
    this.state.view = view;
    const preset = VIEW_PRESETS[view];

    if (this.maplibreMap) {
      this.maplibreMap.flyTo({
        center: [preset.longitude, preset.latitude],
        zoom: preset.zoom,
        duration: 1000,
      });
    }

    const viewSelect = this.container.querySelector('.view-select') as HTMLSelectElement;
    if (viewSelect) viewSelect.value = view;

    const preferredProjection = this.getPreferredProjectionForView(view);
    if (preferredProjection !== this.projectionMode) {
      this.applyProjection(preferredProjection);
    }

    this.onStateChange?.(this.state);
  }

  public setZoom(zoom: number): void {
    this.state.zoom = zoom;
    if (this.maplibreMap) {
      this.maplibreMap.setZoom(zoom);
    }
  }

  public setCenter(lat: number, lon: number, zoom?: number): void {
    if (this.maplibreMap) {
      this.maplibreMap.flyTo({
        center: [lon, lat],
        ...(zoom != null && { zoom }),
        duration: 500,
      });
    }
  }

  public getCenter(): { lat: number; lon: number } | null {
    if (this.maplibreMap) {
      const center = this.maplibreMap.getCenter();
      return { lat: center.lat, lon: center.lng };
    }
    return null;
  }

  public setTimeRange(range: TimeRange): void {
    this.state.timeRange = range;
    this.rebuildProtestSupercluster();
    this.recomputeCountryInteractions();
    this.updateReplayBounds();
    if (this.replayMode) {
      this.replayCursorMs = this.replayMaxTs;
      this.updateReplayControls();
    }
    this.onTimeRangeChange?.(range);
    this.updateTimeSliderButtons();
    this.render(); // Debounced
  }

  public getTimeRange(): TimeRange {
    return this.state.timeRange;
  }

  public setLayers(layers: MapLayers): void {
    this.state.layers = layers;
    this.render(); // Debounced

    // Update toggle checkboxes
    Object.entries(layers).forEach(([key, value]) => {
      const toggle = this.container.querySelector(`.layer-toggle[data-layer="${key}"] input`) as HTMLInputElement;
      if (toggle) toggle.checked = value;
    });
  }

  public getState(): DeckMapState {
    return { ...this.state };
  }

  // Zoom controls - public for external access
  public zoomIn(): void {
    if (this.maplibreMap) {
      this.maplibreMap.zoomIn();
    }
  }

  public zoomOut(): void {
    if (this.maplibreMap) {
      this.maplibreMap.zoomOut();
    }
  }

  private resetView(): void {
    this.setView('global');
  }

  private createUcdpEventsLayer(events: UcdpGeoEvent[]): ScatterplotLayer<UcdpGeoEvent> {
    return new ScatterplotLayer<UcdpGeoEvent>({
      id: 'ucdp-events-layer',
      data: events,
      getPosition: (d) => [d.longitude, d.latitude],
      getRadius: (d) => Math.max(4000, Math.sqrt(d.deaths_best || 1) * 3000),
      getFillColor: (d) => {
        switch (d.type_of_violence) {
          case 'state-based': return COLORS.ucdpStateBased;
          case 'non-state': return COLORS.ucdpNonState;
          case 'one-sided': return COLORS.ucdpOneSided;
          default: return COLORS.ucdpStateBased;
        }
      },
      radiusMinPixels: 3,
      radiusMaxPixels: 20,
      pickable: false,
    });
  }

  private createDisplacementArcsLayer(): ArcLayer<DisplacementFlow> {
    const withCoords = this.displacementFlows.filter(f => f.originLat != null && f.asylumLat != null);
    const top50 = withCoords.slice(0, 50);
    const maxCount = Math.max(1, ...top50.map(f => f.refugees));
    return new ArcLayer<DisplacementFlow>({
      id: 'displacement-arcs-layer',
      data: top50,
      getSourcePosition: (d) => [d.originLon!, d.originLat!],
      getTargetPosition: (d) => [d.asylumLon!, d.asylumLat!],
      getSourceColor: getCurrentTheme() === 'light' ? [50, 80, 180, 220] : [100, 150, 255, 180],
      getTargetColor: getCurrentTheme() === 'light' ? [20, 150, 100, 220] : [100, 255, 200, 180],
      getWidth: (d) => Math.max(1, (d.refugees / maxCount) * 8),
      widthMinPixels: 1,
      widthMaxPixels: 8,
      pickable: false,
    });
  }

  private createClimateHeatmapLayer(): HeatmapLayer<ClimateAnomaly> {
    return new HeatmapLayer<ClimateAnomaly>({
      id: 'climate-heatmap-layer',
      data: this.climateAnomalies,
      getPosition: (d) => [d.lon, d.lat],
      getWeight: (d) => Math.abs(d.tempDelta) + Math.abs(d.precipDelta) * 0.1,
      radiusPixels: 40,
      intensity: 0.6,
      threshold: 0.15,
      opacity: 0.45,
      colorRange: [
        [68, 136, 255],
        [100, 200, 255],
        [255, 255, 100],
        [255, 200, 50],
        [255, 100, 50],
        [255, 50, 50],
      ],
      pickable: false,
    });
  }

  private getNewsThreatWeight(level: string): number {
    switch ((level || '').toLowerCase()) {
      case 'critical': return 3.6;
      case 'high': return 2.9;
      case 'medium': return 2.1;
      case 'low': return 1.3;
      default: return 0.9;
    }
  }

  private createRiskSurfacePoints(): RiskSurfacePoint[] {
    const points: RiskSurfacePoint[] = [];
    const globeProjection = this.projectionMode === 'globe';
    const capScale = globeProjection ? 0.45 : 1;
    const scaledCap = (value: number): number => Math.max(40, Math.round(value * capScale));
    const pushPoint = (
      id: string,
      lon: number,
      lat: number,
      weight: number,
      confidence: number,
      sourceKind: RiskSurfacePoint['sourceKind'],
    ): void => {
      if (!Number.isFinite(lat) || !Number.isFinite(lon) || !Number.isFinite(weight) || weight <= 0) return;
      points.push({
        id,
        lon: this.normalizeLongitude(lon),
        lat: this.clampLatitude(lat),
        weight: Math.max(0.2, Math.min(8, weight)),
        confidence: Math.max(0.05, Math.min(1, confidence)),
        sourceKind,
      });
    };

    const news = this.filterByTime(this.newsLocations, (location) => location.timestamp).slice(0, scaledCap(1400));
    for (let i = 0; i < news.length; i += 1) {
      const item = news[i]!;
      const weight = this.getNewsThreatWeight(item.threatLevel);
      const confidence = item.threatLevel === 'critical' || item.threatLevel === 'high' ? 0.82 : 0.68;
      pushPoint(`risk-news-${i}-${item.title.slice(0, 24)}`, item.lon, item.lat, weight, confidence, 'news');
    }

    const zones = this.getRenderableConflictZones();
    for (const zone of zones) {
      const intensity = this.getConflictZoneIntensity(zone);
      const baseWeight = intensity === 'high' ? 4.6 : intensity === 'medium' ? 3.2 : 2.2;
      const confidence = this.conflictZoneConfidence.get(zone.id) ?? (intensity === 'high' ? 0.76 : intensity === 'medium' ? 0.67 : 0.58);
      pushPoint(`risk-zone-${zone.id}`, zone.center[0], zone.center[1], baseWeight, confidence, this.isMaritimeConflictZone(zone) ? 'maritime' : 'conflict');
    }

    const protests = this.filterByTime(this.protests, (p) => p.time).slice(0, scaledCap(600));
    for (const event of protests) {
      const severityWeight = event.severity === 'high' ? 2.8 : event.severity === 'medium' ? 2.0 : 1.2;
      const confidence = event.confidence === 'high' ? 0.82 : event.confidence === 'medium' ? 0.66 : 0.48;
      pushPoint(`risk-protest-${event.id}`, event.lon, event.lat, severityWeight, confidence, 'protest');
    }

    for (const outage of this.filterByTime(this.outages, (o) => o.pubDate).slice(0, scaledCap(300))) {
      const weight = outage.severity === 'total' ? 2.6 : outage.severity === 'major' ? 2.0 : 1.4;
      pushPoint(`risk-outage-${outage.id}`, outage.lon, outage.lat, weight, 0.72, 'outage');
    }

    for (const threat of this.cyberThreats.slice(0, scaledCap(280))) {
      const weight = threat.severity === 'critical' ? 2.7 : threat.severity === 'high' ? 2.1 : threat.severity === 'medium' ? 1.5 : 1.0;
      const confidence = threat.severity === 'critical' ? 0.8 : threat.severity === 'high' ? 0.7 : 0.58;
      pushPoint(`risk-cyber-${threat.id}`, threat.lon, threat.lat, weight, confidence, 'cyber');
    }

    for (const disruption of this.aisDisruptions.slice(0, scaledCap(240))) {
      const weight = disruption.severity === 'high' ? 2.9 : disruption.severity === 'elevated' ? 2.1 : 1.4;
      const confidence = disruption.type === 'chokepoint_congestion' ? 0.78 : 0.62;
      pushPoint(`risk-ais-${disruption.id}`, disruption.lon, disruption.lat, weight, confidence, 'maritime');
    }

    for (const flight of this.filterByTime(this.militaryFlights, (f) => f.lastSeen).slice(0, scaledCap(240))) {
      const weight = flight.isInteresting ? 2.2 : 1.2;
      const confidence = flight.confidence === 'high' ? 0.78 : flight.confidence === 'medium' ? 0.63 : 0.45;
      pushPoint(`risk-flight-${flight.id}`, flight.lon, flight.lat, weight, confidence, 'military');
    }
    for (const vessel of this.filterByTime(this.militaryVessels, (v) => v.lastAisUpdate).slice(0, scaledCap(240))) {
      const weight = vessel.isDark ? 2.5 : vessel.isInteresting ? 2.1 : 1.1;
      const confidence = vessel.confidence === 'high' ? 0.79 : vessel.confidence === 'medium' ? 0.62 : 0.42;
      pushPoint(`risk-vessel-${vessel.id}`, vessel.lon, vessel.lat, weight, confidence, 'military');
    }

    return points;
  }

  private createRiskSurfaceLayer(data: RiskSurfacePoint[], lodLevel: MapLodLevel): HeatmapLayer<RiskSurfacePoint> {
    const radiusPixels = lodLevel === 'global' ? 66 : lodLevel === 'regional' ? 52 : 40;
    const opacity = lodLevel === 'global' ? 0.42 : lodLevel === 'regional' ? 0.36 : 0.3;
    return new HeatmapLayer<RiskSurfacePoint>({
      id: 'risk-surface-layer',
      data,
      getPosition: (d) => [d.lon, d.lat],
      getWeight: (d) => d.weight,
      radiusPixels,
      intensity: 0.95,
      threshold: 0.05,
      opacity,
      colorRange: [
        [35, 88, 180],
        [75, 145, 230],
        [145, 196, 110],
        [248, 199, 72],
        [245, 123, 42],
        [224, 54, 38],
      ],
      pickable: false,
      updateTriggers: {
        replayCursor: this.replayCursorMs ?? -1,
        replayMode: this.replayMode,
      },
    });
  }

  private getIntelDensityH3Resolution(lodLevel: MapLodLevel): number {
    return lodLevel === 'global' ? 2 : 3;
  }

  private aggregateRiskSurfacePointsToH3Cells(
    data: RiskSurfacePoint[],
    lodLevel: MapLodLevel,
  ): IntelDensityH3Cell[] {
    const resolution = this.getIntelDensityH3Resolution(lodLevel);
    const aggregates = new Map<string, {
      count: number;
      totalWeight: number;
      totalConfidence: number;
      breakdown: Map<RiskSurfacePoint['sourceKind'], { count: number; weight: number }>;
    }>();

    for (const point of data) {
      const cellId = latLngToCell(point.lat, point.lon, resolution);
      const aggregate = aggregates.get(cellId) ?? {
        count: 0,
        totalWeight: 0,
        totalConfidence: 0,
        breakdown: new Map<RiskSurfacePoint['sourceKind'], { count: number; weight: number }>(),
      };
      aggregate.count += 1;
      aggregate.totalWeight += point.weight * (0.8 + point.confidence);
      aggregate.totalConfidence += point.confidence;
      const sourceAggregate = aggregate.breakdown.get(point.sourceKind) ?? { count: 0, weight: 0 };
      sourceAggregate.count += 1;
      sourceAggregate.weight += point.weight;
      aggregate.breakdown.set(point.sourceKind, sourceAggregate);
      aggregates.set(cellId, aggregate);
    }

    const cells: IntelDensityH3Cell[] = [];
    for (const [cellId, aggregate] of aggregates.entries()) {
      const [centerLat, centerLon] = cellToLatLng(cellId);
      const breakdown = [...aggregate.breakdown.entries()]
        .map(([sourceKind, value]) => ({
          sourceKind,
          count: value.count,
          weight: Math.round(value.weight * 100) / 100,
        }))
        .sort((a, b) => b.weight - a.weight);
      cells.push({
        id: `intel-h3-${cellId}`,
        hexagon: cellId,
        resolution,
        centerLon,
        centerLat,
        pointCount: aggregate.count,
        totalWeight: Math.round(aggregate.totalWeight * 100) / 100,
        averageConfidence: aggregate.totalConfidence / Math.max(1, aggregate.count),
        dominantSourceKind: breakdown[0]?.sourceKind ?? 'news',
        breakdown,
      });
    }

    return cells.sort((a, b) => b.totalWeight - a.totalWeight);
  }

  private getIntelDensityCellColor(normalized: number): [number, number, number, number] {
    const n = Math.max(0, Math.min(1, normalized));
    if (n >= 0.9) return [239, 68, 68, 220];
    if (n >= 0.72) return [249, 115, 22, 214];
    if (n >= 0.54) return [245, 158, 11, 205];
    if (n >= 0.36) return [34, 211, 238, 192];
    if (n >= 0.18) return [59, 130, 246, 184];
    return [25, 52, 95, 172];
  }

  private createIntelDensityHexagonLayer(
    data: RiskSurfacePoint[],
    lodLevel: MapLodLevel,
  ): H3HexagonLayer<IntelDensityH3Cell> | null {
    const cells = this.aggregateRiskSurfacePointsToH3Cells(data, lodLevel);
    if (cells.length === 0) return null;
    const maxWeight = cells.reduce((max, cell) => Math.max(max, cell.totalWeight), 0.0001);
    return new H3HexagonLayer<IntelDensityH3Cell>({
      id: 'intel-density-h3-layer',
      data: cells,
      getHexagon: (d) => d.hexagon,
      highPrecision: 'auto',
      coverage: 0.88,
      extruded: true,
      elevationScale: lodLevel === 'global' ? 1.15 : 0.9,
      getElevation: (d) => 18_000 + d.totalWeight * (lodLevel === 'global' ? 16_000 : 11_000),
      getFillColor: (d) => this.getIntelDensityCellColor(d.totalWeight / maxWeight),
      getLineColor: (d) => {
        const dominant = d.dominantSourceKind;
        if (dominant === 'cyber') return [34, 211, 238, 255];
        if (dominant === 'military' || dominant === 'conflict' || dominant === 'maritime') return [255, 170, 80, 255];
        return [120, 180, 255, 235];
      },
      lineWidthMinPixels: 1,
      material: {
        ambient: 0.34,
        diffuse: 0.58,
        shininess: 20,
        specularColor: [120, 180, 255],
      },
      opacity: 0.68,
      pickable: true,
      autoHighlight: true,
      highlightColor: [255, 255, 255, 70],
      updateTriggers: {
        replayCursor: this.replayCursorMs ?? -1,
        replayMode: this.replayMode,
        maxWeight,
      },
    });
  }

  private createTradeRoutesLayer(): ArcLayer<TradeRouteSegment> {
    const active: [number, number, number, number] = getCurrentTheme() === 'light' ? [30, 100, 180, 200] : [100, 200, 255, 160];
    const disrupted: [number, number, number, number] = getCurrentTheme() === 'light' ? [200, 40, 40, 220] : [255, 80, 80, 200];
    const highRisk: [number, number, number, number] = getCurrentTheme() === 'light' ? [200, 140, 20, 200] : [255, 180, 50, 180];
    const colorFor = (status: string): [number, number, number, number] =>
      status === 'disrupted' ? disrupted : status === 'high_risk' ? highRisk : active;

    return new ArcLayer<TradeRouteSegment>({
      id: 'trade-routes-layer',
      data: this.tradeRouteSegments,
      getSourcePosition: (d) => d.sourcePosition,
      getTargetPosition: (d) => d.targetPosition,
      getSourceColor: (d) => colorFor(d.status),
      getTargetColor: (d) => colorFor(d.status),
      getWidth: (d) => d.category === 'energy' ? 3 : 2,
      widthMinPixels: 1,
      widthMaxPixels: 6,
      greatCircle: true,
      pickable: false,
    });
  }

  private createTradeChokepointsLayer(): ScatterplotLayer {
    const routeWaypointIds = new Set<string>();
    for (const seg of this.tradeRouteSegments) {
      const route = TRADE_ROUTES_LIST.find(r => r.id === seg.routeId);
      if (route) for (const wp of route.waypoints) routeWaypointIds.add(wp);
    }
    const chokepoints = STRATEGIC_WATERWAYS.filter(w => routeWaypointIds.has(w.id));
    const isLight = getCurrentTheme() === 'light';

    return new ScatterplotLayer({
      id: 'trade-chokepoints-layer',
      data: chokepoints,
      getPosition: (d: { lon: number; lat: number }) => [d.lon, d.lat],
      getFillColor: isLight ? [200, 140, 20, 200] : [255, 180, 50, 180],
      getLineColor: isLight ? [100, 70, 10, 255] : [255, 220, 120, 255],
      getRadius: 30000,
      stroked: true,
      lineWidthMinPixels: 1,
      radiusMinPixels: 4,
      radiusMaxPixels: 12,
      pickable: false,
    });
  }

  // Data setters - all use render() for debouncing
  public setEarthquakes(earthquakes: Earthquake[]): void {
    this.earthquakes = earthquakes;
    this.updateReplayBounds();
    this.render();
  }

  public setWeatherAlerts(alerts: WeatherAlert[]): void {
    this.weatherAlerts = alerts;
    this.updateReplayBounds();
    const withCentroid = alerts.filter(a => a.centroid && a.centroid.length === 2).length;
    console.log(`[DeckGLMap] Weather alerts: ${alerts.length} total, ${withCentroid} with coordinates`);
    this.render();
  }

  public setOutages(outages: InternetOutage[]): void {
    this.outages = outages;
    this.updateReplayBounds();
    this.render();
  }

  public setCyberThreats(threats: CyberThreat[]): void {
    this.cyberThreats = threats;
    this.render();
  }

  public setAisData(disruptions: AisDisruptionEvent[], density: AisDensityZone[]): void {
    this.aisDisruptions = disruptions;
    this.aisDensity = density;
    this.render();
  }

  public setCableActivity(advisories: CableAdvisory[], repairShips: RepairShip[]): void {
    this.cableAdvisories = advisories;
    this.repairShips = repairShips;
    this.render();
  }

  public setCableHealth(healthMap: Record<string, CableHealthRecord>): void {
    this.healthByCableId = healthMap;
    this.layerCache.delete('cables-layer');
    this.render();
  }

  public setProtests(events: SocialUnrestEvent[]): void {
    this.protests = events;
    this.rebuildProtestSupercluster();
    this.updateReplayBounds();
    this.render();
    this.syncPulseAnimation();
  }

  public setFlightDelays(delays: AirportDelayAlert[]): void {
    this.flightDelays = delays;
    this.render();
  }

  // Compatibility wrapper used by MapContainer adapter.
  public setAircraftPositions(positions: PositionSample[]): void {
    this.onAircraftPositionsUpdate?.(positions);
  }

  public setMilitaryFlights(flights: MilitaryFlight[], clusters: MilitaryFlightCluster[] = []): void {
    this.militaryFlights = flights;
    this.militaryFlightClusters = clusters;
    this.updateReplayBounds();
    this.render();
  }

  public setMilitaryVessels(vessels: MilitaryVessel[], clusters: MilitaryVesselCluster[] = []): void {
    this.militaryVessels = vessels;
    this.militaryVesselClusters = clusters;
    this.updateReplayBounds();
    this.render();
  }

  public setMilitaryBases(bases: MilitaryBaseEnriched[]): void {
    this.runtimeMilitaryBases = Array.isArray(bases) && bases.length > 0 ? bases : null;
    this.render();
  }

  public setNaturalEvents(events: NaturalEvent[]): void {
    this.naturalEvents = events;
    this.render();
  }

  public setFires(fires: Array<{ lat: number; lon: number; brightness: number; frp: number; confidence: number; region: string; acq_date: string; daynight: string }>): void {
    this.firmsFireData = fires;
    this.render();
  }

  public setTechEvents(events: TechEventMarker[]): void {
    this.techEvents = events;
    this.rebuildTechEventSupercluster();
    this.render();
  }

  public setUcdpEvents(events: UcdpGeoEvent[]): void {
    this.ucdpEvents = events;
    this.updateReplayBounds();
    this.render();
  }

  public setDisplacementFlows(flows: DisplacementFlow[]): void {
    this.displacementFlows = flows;
    this.recomputeCountryInteractions();
    this.render();
  }

  public setClimateAnomalies(anomalies: ClimateAnomaly[]): void {
    this.climateAnomalies = anomalies;
    this.render();
  }

  public setGpsJamming(hexes: GpsJamHex[]): void {
    this.gpsJammingHexes = (hexes || []).filter((hex) => Number.isFinite(hex.lat) && Number.isFinite(hex.lon));
    this.updateReplayBounds();
    this.render();
  }

  public setNewsLocations(data: Array<{ lat: number; lon: number; title: string; threatLevel: string; timestamp?: Date }>): void {
    const sanitized = this.sanitizeNewsLocations(data);
    const now = Date.now();
    for (const d of sanitized) {
      if (!this.newsLocationFirstSeen.has(d.title)) {
        this.newsLocationFirstSeen.set(d.title, now);
      }
    }
    for (const [key, ts] of this.newsLocationFirstSeen) {
      if (now - ts > 60_000) this.newsLocationFirstSeen.delete(key);
    }
    this.newsLocations = sanitized;
    this.updateReplayBounds();
    this.render();

    this.syncPulseAnimation(now);
  }

  public setIranEvents(events: IranEvent[]): void {
    this.iranEvents = (events || []).filter((event) => Number.isFinite(event.latitude) && Number.isFinite(event.longitude));
    this.updateReplayBounds();
    this.render();
  }

  public setPositiveEvents(events: PositiveGeoEvent[]): void {
    this.positiveEvents = events;
    this.syncPulseAnimation();
    this.render();
  }

  public setKindnessData(points: KindnessPoint[]): void {
    this.kindnessPoints = points;
    this.syncPulseAnimation();
    this.render();
  }

  public setHappinessScores(data: HappinessData): void {
    this.happinessScores = data.scores;
    this.happinessYear = data.year;
    this.happinessSource = data.source;
    this.render();
  }

  public setSpeciesRecoveryZones(species: SpeciesRecovery[]): void {
    this.speciesRecoveryZones = species.filter(
      (s): s is SpeciesRecovery & { recoveryZone: { name: string; lat: number; lon: number } } =>
        s.recoveryZone != null
    );
    this.render();
  }

  public setRenewableInstallations(installations: RenewableInstallation[]): void {
    this.renewableInstallations = installations;
    this.render();
  }

  // Compatibility wrapper used by MapContainer adapter.
  public setCIIScores(_scores: Array<{ code: string; score: number; level: string }>): void {
    this.render();
  }

  public updateHotspotActivity(news: NewsItem[]): void {
    this.news = news; // Store for related news lookup
    this.updateReplayBounds();

    // Update hotspot "breaking" indicators based on recent news
    const breakingKeywords = new Set<string>();
    const recentNews = news.filter(n =>
      Date.now() - n.pubDate.getTime() < 2 * 60 * 60 * 1000 // Last 2 hours
    );

    // Count matches per hotspot for escalation tracking
    const matchCounts = new Map<string, number>();

    recentNews.forEach(item => {
      this.hotspots.forEach(hotspot => {
        if (hotspot.keywords.some(kw =>
          item.title.toLowerCase().includes(kw.toLowerCase())
        )) {
          breakingKeywords.add(hotspot.id);
          matchCounts.set(hotspot.id, (matchCounts.get(hotspot.id) || 0) + 1);
        }
      });
    });

    this.hotspots.forEach(h => {
      h.hasBreaking = breakingKeywords.has(h.id);
      const matchCount = matchCounts.get(h.id) || 0;
      // Calculate a simple velocity metric (matches per hour normalized)
      const velocity = matchCount > 0 ? matchCount / 2 : 0; // 2 hour window
      updateHotspotEscalation(h.id, matchCount, h.hasBreaking || false, velocity);
    });

    this.conflictZoneConfidence.clear();
    this.dynamicConflictZones = this.buildDynamicConflictZones(news);

    this.recomputeCountryInteractions();
    this.render();
    this.syncPulseAnimation();
  }

  /** Get news items related to a hotspot by keyword matching */
  private getRelatedNews(hotspot: Hotspot): NewsItem[] {
    // High-priority conflict keywords that indicate the news is really about another topic
    const conflictTopics = ['gaza', 'ukraine', 'russia', 'israel', 'iran', 'china', 'taiwan', 'korea', 'syria'];

    return this.news
      .map((item) => {
        const titleLower = item.title.toLowerCase();
        const matchedKeywords = hotspot.keywords.filter((kw) => titleLower.includes(kw.toLowerCase()));

        if (matchedKeywords.length === 0) return null;

        // Check if this news mentions other hotspot conflict topics
        const conflictMatches = conflictTopics.filter(t =>
          titleLower.includes(t) && !hotspot.keywords.some(k => k.toLowerCase().includes(t))
        );

        // If article mentions a major conflict topic that isn't this hotspot, deprioritize heavily
        if (conflictMatches.length > 0) {
          // Only include if it ALSO has a strong local keyword (city name, agency)
          const strongLocalMatch = matchedKeywords.some(kw =>
            kw.toLowerCase() === hotspot.name.toLowerCase() ||
            hotspot.agencies?.some(a => titleLower.includes(a.toLowerCase()))
          );
          if (!strongLocalMatch) return null;
        }

        // Score: more keyword matches = more relevant
        const score = matchedKeywords.length;
        return { item, score };
      })
      .filter((x): x is { item: NewsItem; score: number } => x !== null)
      .sort((a, b) => b.score - a.score)
      .slice(0, 5)
      .map(x => x.item);
  }

  public updateMilitaryForEscalation(flights: MilitaryFlight[], vessels: MilitaryVessel[]): void {
    setMilitaryData(flights, vessels);
  }

  public getHotspotDynamicScore(hotspotId: string) {
    return getHotspotEscalation(hotspotId);
  }

  /** Get military flight clusters for rendering/analysis */
  public getMilitaryFlightClusters(): MilitaryFlightCluster[] {
    return this.militaryFlightClusters;
  }

  /** Get military vessel clusters for rendering/analysis */
  public getMilitaryVesselClusters(): MilitaryVesselCluster[] {
    return this.militaryVesselClusters;
  }

  public highlightAssets(assets: RelatedAsset[] | null): void {
    // Clear previous highlights
    Object.values(this.highlightedAssets).forEach(set => set.clear());

    if (assets) {
      assets.forEach(asset => {
        this.highlightedAssets[asset.type].add(asset.id);
      });
    }

    this.render(); // Debounced
  }

  public setOnHotspotClick(callback: (hotspot: Hotspot) => void): void {
    this.onHotspotClick = callback;
  }

  public setOnTimeRangeChange(callback: (range: TimeRange) => void): void {
    this.onTimeRangeChange = callback;
  }

  public setOnLayerChange(callback: (layer: keyof MapLayers, enabled: boolean, source: 'user' | 'programmatic') => void): void {
    this.onLayerChange = callback;
  }

  public setOnStateChange(callback: (state: DeckMapState) => void): void {
    this.onStateChange = callback;
  }

  public setOnAircraftPositionsUpdate(callback: (positions: PositionSample[]) => void): void {
    this.onAircraftPositionsUpdate = callback;
  }

  public getHotspotLevels(): Record<string, string> {
    const levels: Record<string, string> = {};
    this.hotspots.forEach(h => {
      levels[h.name] = h.level || 'low';
    });
    return levels;
  }

  public setHotspotLevels(levels: Record<string, string>): void {
    this.hotspots.forEach(h => {
      if (levels[h.name]) {
        h.level = levels[h.name] as 'low' | 'elevated' | 'high';
      }
    });
    this.render(); // Debounced
  }

  public initEscalationGetters(): void {
    setCIIGetter(getCountryScore);
    setGeoAlertGetter(getAlertsNearLocation);
  }

  // UI visibility methods
  public hideLayerToggle(layer: keyof MapLayers): void {
    const toggle = this.container.querySelector(`.layer-toggle[data-layer="${layer}"]`);
    if (toggle) (toggle as HTMLElement).style.display = 'none';
  }

  public setLayerLoading(layer: keyof MapLayers, loading: boolean): void {
    const toggle = this.container.querySelector(`.layer-toggle[data-layer="${layer}"]`);
    if (toggle) toggle.classList.toggle('loading', loading);
  }

  public setLayerReady(layer: keyof MapLayers, hasData: boolean): void {
    const toggle = this.container.querySelector(`.layer-toggle[data-layer="${layer}"]`);
    if (!toggle) return;

    toggle.classList.remove('loading');
    // Match old Map.ts behavior: set 'active' only when layer enabled AND has data
    if (this.state.layers[layer] && hasData) {
      toggle.classList.add('active');
    } else {
      toggle.classList.remove('active');
    }
  }

  public resize(): void {
    this.maplibreMap?.resize();
    this.render();
  }

  public setIsResizing(_isResizing: boolean): void {}

  public reloadBasemap(): void {
    const theme = getCurrentTheme() === 'light' ? 'light' : 'dark';
    this.switchBasemap(theme);
  }

  private getFirstSymbolLayerId(): string | undefined {
    return this.maplibreMap?.getStyle().layers?.find((layer) => layer.type === 'symbol')?.id;
  }

  private applyHybridBasemapEnhancements(): void {
    if (!this.maplibreMap) return;
    const map = this.maplibreMap;
    const theme = getCurrentTheme();
    const labelLayerId = this.getFirstSymbolLayerId();

    try {
      if (!map.getSource(DeckGLMap.HYBRID_SATELLITE_SOURCE_ID)) {
        map.addSource(DeckGLMap.HYBRID_SATELLITE_SOURCE_ID, {
          type: 'raster',
          tiles: ['https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
          tileSize: 256,
          attribution: 'Esri World Imagery',
        } as unknown as maplibregl.SourceSpecification);
      }
      if (!map.getLayer(DeckGLMap.HYBRID_SATELLITE_LAYER_ID)) {
        map.addLayer({
          id: DeckGLMap.HYBRID_SATELLITE_LAYER_ID,
          type: 'raster',
          source: DeckGLMap.HYBRID_SATELLITE_SOURCE_ID,
          paint: {
            'raster-opacity': theme === 'light' ? 0.08 : 0.14,
            'raster-contrast': 0.18,
            'raster-saturation': -0.92,
            'raster-brightness-min': theme === 'light' ? 0.12 : 0.02,
            'raster-brightness-max': theme === 'light' ? 0.72 : 0.38,
          } as unknown as Record<string, unknown>,
        } as unknown as maplibregl.LayerSpecification, labelLayerId);
      } else {
        map.setPaintProperty(DeckGLMap.HYBRID_SATELLITE_LAYER_ID, 'raster-opacity', theme === 'light' ? 0.08 : 0.14);
      }

      if (!map.getSource(DeckGLMap.HYBRID_TERRAIN_SOURCE_ID)) {
        map.addSource(DeckGLMap.HYBRID_TERRAIN_SOURCE_ID, {
          type: 'raster-dem',
          url: 'https://demotiles.maplibre.org/terrain-tiles/tiles.json',
          tileSize: 256,
        } as unknown as maplibregl.SourceSpecification);
      }

      if (
        MAP_INTERACTION_MODE === '3d'
        && this.projectionMode === 'mercator'
        && typeof (map as unknown as { setTerrain?: (terrain: unknown) => void }).setTerrain === 'function'
      ) {
        (map as unknown as { setTerrain: (terrain: unknown) => void }).setTerrain({
          source: DeckGLMap.HYBRID_TERRAIN_SOURCE_ID,
          exaggeration: 1.15,
        });
      }
    } catch (error) {
      if (import.meta.env.DEV) {
        console.warn('[DeckGLMap] hybrid basemap setup failed', error);
      }
    }
  }

  private formatBorderStreamEvent(event: SourceOpsEvent): string {
    const ts = new Date(event.createdAt).toISOString().slice(11, 19);
    const kind = event.kind.toUpperCase();
    const action = event.action.toUpperCase();
    const title = String(event.title || 'event').replace(/\s+/g, ' ').slice(0, 72);
    return `${ts}Z [${kind}] ${action} :: ${title}`;
  }

  private async refreshBorderStream(): Promise<void> {
    if (this.borderStreamTracks.length === 0) return;
    try {
      const [events, captures] = await Promise.all([
        listSourceOpsEvents(12),
        listNetworkDiscoveryCaptures(8),
      ]);
      const lines = [
        ...events.slice(0, 10).map((event) => this.formatBorderStreamEvent(event)),
        ...captures.slice(0, 4).map((capture) => {
          const ts = new Date(capture.discoveredAt).toISOString().slice(11, 19);
          return `${ts}Z [API] INTERCEPT :: ${capture.requestUrl.slice(0, 88)} :: ${capture.schemaHint.toUpperCase()} :: ${capture.category.toUpperCase()}`;
        }),
      ];
      const streamText = (lines.length > 0 ? lines : ['LOADER ACTIVE :: awaiting next discovery cycle']).join('   //   ');
      this.borderStreamTracks.forEach((track) => {
        track.textContent = `${streamText}   //   ${streamText}`;
      });
      this.borderStreamEl?.classList.add('active');
    } catch (error) {
      if (import.meta.env.DEV) {
        console.warn('[DeckGLMap] border stream refresh failed', error);
      }
    }
  }

  private startBorderStreamRefresh(): void {
    void this.refreshBorderStream();
    if (this.borderStreamTimerId !== null) {
      clearInterval(this.borderStreamTimerId);
    }
    this.borderStreamTimerId = setInterval(() => {
      void this.refreshBorderStream();
    }, 15_000);
  }

  public flashAssets(assetType: AssetType, ids: string[]): void {
    // Temporarily highlight assets
    ids.forEach(id => this.highlightedAssets[assetType].add(id));
    this.render();

    setTimeout(() => {
      ids.forEach(id => this.highlightedAssets[assetType].delete(id));
      this.render();
    }, 3000);
  }

  // Enable layer programmatically
  public enableLayer(layer: keyof MapLayers): void {
    if (!this.state.layers[layer]) {
      this.state.layers[layer] = true;
      const toggle = this.container.querySelector(`.layer-toggle[data-layer="${layer}"] input`) as HTMLInputElement;
      if (toggle) toggle.checked = true;
      this.render();
      this.onLayerChange?.(layer, true, 'programmatic');
    }
  }

  // Toggle layer on/off programmatically
  public toggleLayer(layer: keyof MapLayers): void {
    console.log(`[DeckGLMap.toggleLayer] ${layer}: ${this.state.layers[layer]} -> ${!this.state.layers[layer]}`);
    this.state.layers[layer] = !this.state.layers[layer];
    const toggle = this.container.querySelector(`.layer-toggle[data-layer="${layer}"] input`) as HTMLInputElement;
    if (toggle) toggle.checked = this.state.layers[layer];
    this.render();
    this.onLayerChange?.(layer, this.state.layers[layer], 'programmatic');
  }

  // Get center coordinates for programmatic popup positioning
  private getContainerCenter(): { x: number; y: number } {
    const rect = this.container.getBoundingClientRect();
    return { x: rect.width / 2, y: rect.height / 2 };
  }

  // Project lat/lon to screen coordinates without moving the map
  private projectToScreen(lat: number, lon: number): { x: number; y: number } | null {
    if (!this.maplibreMap) return null;
    const point = this.maplibreMap.project([lon, lat]);
    return { x: point.x, y: point.y };
  }

  // Trigger click methods - show popup at item location without moving the map
  public triggerHotspotClick(id: string): void {
    const hotspot = this.hotspots.find(h => h.id === id);
    if (!hotspot) return;

    // Get screen position for popup
    const screenPos = this.projectToScreen(hotspot.lat, hotspot.lon);
    const { x, y } = screenPos || this.getContainerCenter();

    // Get related news and show popup
    const relatedNews = this.getRelatedNews(hotspot);
    this.popup.show({
      type: 'hotspot',
      data: hotspot,
      relatedNews,
      x,
      y,
    });
    this.popup.loadHotspotGdeltContext(hotspot);
    this.onHotspotClick?.(hotspot);
  }

  public triggerConflictClick(id: string): void {
    const conflict = CONFLICT_ZONES.find(c => c.id === id);
    if (conflict) {
      // Don't pan - show popup at projected screen position or center
      const screenPos = this.projectToScreen(conflict.center[1], conflict.center[0]);
      const { x, y } = screenPos || this.getContainerCenter();
      this.popup.show({ type: 'conflict', data: conflict, x, y });
    }
  }

  public triggerBaseClick(id: string): void {
    const baseData = this.runtimeMilitaryBases && this.runtimeMilitaryBases.length > 0
      ? this.runtimeMilitaryBases
      : MILITARY_BASES;
    const base = baseData.find(b => b.id === id);
    if (base) {
      // Don't pan - show popup at projected screen position or center
      const screenPos = this.projectToScreen(base.lat, base.lon);
      const { x, y } = screenPos || this.getContainerCenter();
      this.popup.show({ type: 'base', data: base, x, y });
    }
  }

  public triggerPipelineClick(id: string): void {
    const pipeline = PIPELINES.find(p => p.id === id);
    if (pipeline && pipeline.points.length > 0) {
      const midIdx = Math.floor(pipeline.points.length / 2);
      const midPoint = pipeline.points[midIdx];
      // Don't pan - show popup at projected screen position or center
      const screenPos = midPoint ? this.projectToScreen(midPoint[1], midPoint[0]) : null;
      const { x, y } = screenPos || this.getContainerCenter();
      this.popup.show({ type: 'pipeline', data: pipeline, x, y });
    }
  }

  public triggerCableClick(id: string): void {
    const cable = UNDERSEA_CABLES.find(c => c.id === id);
    if (cable && cable.points.length > 0) {
      const midIdx = Math.floor(cable.points.length / 2);
      const midPoint = cable.points[midIdx];
      // Don't pan - show popup at projected screen position or center
      const screenPos = midPoint ? this.projectToScreen(midPoint[1], midPoint[0]) : null;
      const { x, y } = screenPos || this.getContainerCenter();
      this.popup.show({ type: 'cable', data: cable, x, y });
    }
  }

  public triggerDatacenterClick(id: string): void {
    const dc = AI_DATA_CENTERS.find(d => d.id === id);
    if (dc) {
      // Don't pan - show popup at projected screen position or center
      const screenPos = this.projectToScreen(dc.lat, dc.lon);
      const { x, y } = screenPos || this.getContainerCenter();
      this.popup.show({ type: 'datacenter', data: dc, x, y });
    }
  }

  public triggerNuclearClick(id: string): void {
    const facility = NUCLEAR_FACILITIES.find(n => n.id === id);
    if (facility) {
      // Don't pan - show popup at projected screen position or center
      const screenPos = this.projectToScreen(facility.lat, facility.lon);
      const { x, y } = screenPos || this.getContainerCenter();
      this.popup.show({ type: 'nuclear', data: facility, x, y });
    }
  }

  public triggerIrradiatorClick(id: string): void {
    const irradiator = GAMMA_IRRADIATORS.find(i => i.id === id);
    if (irradiator) {
      // Don't pan - show popup at projected screen position or center
      const screenPos = this.projectToScreen(irradiator.lat, irradiator.lon);
      const { x, y } = screenPos || this.getContainerCenter();
      this.popup.show({ type: 'irradiator', data: irradiator, x, y });
    }
  }

  public flashLocation(lat: number, lon: number, durationMs = 2000): void {
    // Don't pan - project coordinates to screen position
    const screenPos = this.projectToScreen(lat, lon);
    if (!screenPos) return;

    // Flash effect by temporarily adding a highlight at the location
    const flashMarker = document.createElement('div');
    flashMarker.className = 'flash-location-marker';
    flashMarker.style.cssText = `
      position: absolute;
      width: 40px;
      height: 40px;
      border-radius: 50%;
      background: rgba(255, 255, 255, 0.18);
      border: 2px solid #fff;
      pointer-events: none;
      z-index: 1000;
      left: ${screenPos.x}px;
      top: ${screenPos.y}px;
      transform: translate(-50%, -50%);
    `;

    const wrapper = this.container.querySelector('.deckgl-map-wrapper');
    if (wrapper) {
      wrapper.appendChild(flashMarker);
      setTimeout(() => flashMarker.remove(), durationMs);
    }
  }

  // --- Country click + highlight ---

  public setOnCountryClick(cb: (country: CountryClickPayload) => void): void {
    this.onCountryClick = cb;
  }

  private resolveCountryFromCoordinate(lon: number, lat: number): { code: string; name: string } | null {
    const fromGeometry = getCountryAtCoordinates(lat, lon);
    if (fromGeometry) return fromGeometry;
    if (!this.maplibreMap || !this.countryGeoJsonLoaded) return null;
    try {
      const point = this.maplibreMap.project([lon, lat]);
      const features = this.maplibreMap.queryRenderedFeatures(point, { layers: ['country-interactive'] });
      const properties = (features?.[0]?.properties ?? {}) as Record<string, unknown>;
      const code = typeof properties['ISO3166-1-Alpha-2'] === 'string'
        ? properties['ISO3166-1-Alpha-2'].trim().toUpperCase()
        : '';
      const name = typeof properties.name === 'string'
        ? properties.name.trim()
        : '';
      if (!code || !name) return null;
      return { code, name };
    } catch {
      return null;
    }
  }

  private loadCountryBoundaries(): void {
    if (!this.maplibreMap || this.countryGeoJsonLoaded) return;
    this.countryGeoJsonLoaded = true;

    getCountriesGeoJson()
      .then((geojson) => {
        if (!this.maplibreMap || !geojson) return;
        this.countriesGeoJsonData = geojson;
        this.countryCentroids.clear();
        this.countryInteractionSignature = '';
        this.conflictCountryRiskSignature = '';
        this.recomputeCountryInteractions();
        this.maplibreMap.addSource('country-boundaries', {
          type: 'geojson',
          data: geojson,
        });
        this.maplibreMap.addLayer({
          id: 'country-interactive',
          type: 'fill',
          source: 'country-boundaries',
          paint: {
            'fill-color': '#3b82f6',
            'fill-opacity': 0,
          },
        });
        this.maplibreMap.addLayer({
          id: 'country-risk-low-fill',
          type: 'fill',
          source: 'country-boundaries',
          paint: {
            'fill-color': '#f59e0b',
            'fill-opacity': 0.08,
          },
          filter: ['==', ['get', 'ISO3166-1-Alpha-2'], ''],
        });
        this.maplibreMap.addLayer({
          id: 'country-risk-medium-fill',
          type: 'fill',
          source: 'country-boundaries',
          paint: {
            'fill-color': '#f97316',
            'fill-opacity': 0.1,
          },
          filter: ['==', ['get', 'ISO3166-1-Alpha-2'], ''],
        });
        this.maplibreMap.addLayer({
          id: 'country-risk-high-fill',
          type: 'fill',
          source: 'country-boundaries',
          paint: {
            'fill-color': '#ef4444',
            'fill-opacity': 0.14,
          },
          filter: ['==', ['get', 'ISO3166-1-Alpha-2'], ''],
        });
        this.maplibreMap.addLayer({
          id: 'country-risk-low-border',
          type: 'line',
          source: 'country-boundaries',
          paint: {
            'line-color': '#f59e0b',
            'line-width': 0.9,
            'line-opacity': 0.55,
          },
          filter: ['==', ['get', 'ISO3166-1-Alpha-2'], ''],
        });
        this.maplibreMap.addLayer({
          id: 'country-risk-medium-border',
          type: 'line',
          source: 'country-boundaries',
          paint: {
            'line-color': '#f97316',
            'line-width': 1.1,
            'line-opacity': 0.65,
          },
          filter: ['==', ['get', 'ISO3166-1-Alpha-2'], ''],
        });
        this.maplibreMap.addLayer({
          id: 'country-risk-high-border',
          type: 'line',
          source: 'country-boundaries',
          paint: {
            'line-color': '#ef4444',
            'line-width': 1.25,
            'line-opacity': 0.78,
          },
          filter: ['==', ['get', 'ISO3166-1-Alpha-2'], ''],
        });
        this.maplibreMap.addLayer({
          id: 'country-hover-fill',
          type: 'fill',
          source: 'country-boundaries',
          paint: {
            'fill-color': '#3b82f6',
            'fill-opacity': 0.06,
          },
          filter: ['==', ['get', 'name'], ''],
        });
        this.maplibreMap.addLayer({
          id: 'country-highlight-fill',
          type: 'fill',
          source: 'country-boundaries',
          paint: {
            'fill-color': '#3b82f6',
            'fill-opacity': 0.12,
          },
          filter: ['==', ['get', 'ISO3166-1-Alpha-2'], ''],
        });
        this.maplibreMap.addLayer({
          id: 'country-highlight-border',
          type: 'line',
          source: 'country-boundaries',
          paint: {
            'line-color': '#3b82f6',
            'line-width': 1.5,
            'line-opacity': 0.5,
          },
          filter: ['==', ['get', 'ISO3166-1-Alpha-2'], ''],
        });

        if (!this.countryHoverSetup) this.setupCountryHover();
        this.updateCountryLayerPaint(getCurrentTheme());
        if (this.highlightedCountryCode) this.highlightCountry(this.highlightedCountryCode);
        this.updateConflictCountryRiskLayers(this.state.layers.conflicts ? this.getRenderableConflictZones() : []);
        this.render();
        console.log('[DeckGLMap] Country boundaries loaded');
      })
      .catch((err) => console.warn('[DeckGLMap] Failed to load country boundaries:', err));
  }

  private setupCountryHover(): void {
    if (!this.maplibreMap || this.countryHoverSetup) return;
    this.countryHoverSetup = true;
    const map = this.maplibreMap;
    let hoveredName: string | null = null;

    map.on('mousemove', (e) => {
      if (!this.onCountryClick) return;
      const features = map.queryRenderedFeatures(e.point, { layers: ['country-interactive'] });
      const name = features?.[0]?.properties?.name as string | undefined;

      try {
        if (name && name !== hoveredName) {
          hoveredName = name;
          if (map.getLayer('country-hover-fill')) {
            map.setFilter('country-hover-fill', ['==', ['get', 'name'], name]);
          }
          map.getCanvas().style.cursor = 'pointer';
        } else if (!name && hoveredName) {
          hoveredName = null;
          if (map.getLayer('country-hover-fill')) {
            map.setFilter('country-hover-fill', ['==', ['get', 'name'], '']);
          }
          map.getCanvas().style.cursor = '';
        }
      } catch { /* style not done loading during theme switch */ }
    });

    map.on('mouseout', () => {
      if (hoveredName) {
        hoveredName = null;
        try {
          if (map.getLayer('country-hover-fill')) {
            map.setFilter('country-hover-fill', ['==', ['get', 'name'], '']);
          }
        } catch { /* style not done loading */ }
        map.getCanvas().style.cursor = '';
      }
    });
  }

  public highlightCountry(code: string): void {
    this.highlightedCountryCode = code;
    if (!this.maplibreMap || !this.countryGeoJsonLoaded) return;
    const filter = ['==', ['get', 'ISO3166-1-Alpha-2'], code] as maplibregl.FilterSpecification;
    try {
      if (this.maplibreMap.getLayer('country-highlight-fill')) {
        this.maplibreMap.setFilter('country-highlight-fill', filter);
      }
      if (this.maplibreMap.getLayer('country-highlight-border')) {
        this.maplibreMap.setFilter('country-highlight-border', filter);
      }
    } catch { /* layer not ready yet */ }
  }

  public clearCountryHighlight(): void {
    this.highlightedCountryCode = null;
    if (!this.maplibreMap) return;
    const noMatch = ['==', ['get', 'ISO3166-1-Alpha-2'], ''] as maplibregl.FilterSpecification;
    try {
      if (this.maplibreMap.getLayer('country-highlight-fill')) {
        this.maplibreMap.setFilter('country-highlight-fill', noMatch);
      }
      if (this.maplibreMap.getLayer('country-highlight-border')) {
        this.maplibreMap.setFilter('country-highlight-border', noMatch);
      }
    } catch { /* layer not ready */ }
  }

  public fitCountry(code: string): void {
    this.highlightCountry(code);
  }

  private switchBasemap(theme: 'dark' | 'light'): void {
    if (!this.maplibreMap) return;
    this.maplibreMap.setStyle(theme === 'light' ? LIGHT_STYLE : DARK_STYLE);
    // setStyle() replaces all sources/layers — reset guard so country layers are re-added
    this.countryGeoJsonLoaded = false;
    this.maplibreMap.once('style.load', () => {
      this.applyProjection(this.projectionMode);
      this.applyHybridBasemapEnhancements();
      this.loadCountryBoundaries();
      this.updateCountryLayerPaint(theme);
      // Re-render deck.gl overlay after style swap — interleaved layers need
      // the new MapLibre style to be loaded before they can re-insert.
      this.render();
    });
  }

  private updateCountryLayerPaint(theme: 'dark' | 'light'): void {
    if (!this.maplibreMap || !this.countryGeoJsonLoaded) return;
    const hoverOpacity = theme === 'light' ? 0.10 : 0.06;
    const highlightOpacity = theme === 'light' ? 0.18 : 0.12;
    const riskLowOpacity = theme === 'light' ? 0.065 : 0.095;
    const riskMedOpacity = theme === 'light' ? 0.085 : 0.12;
    const riskHighOpacity = theme === 'light' ? 0.12 : 0.16;
    try {
      this.maplibreMap.setPaintProperty('country-hover-fill', 'fill-opacity', hoverOpacity);
      this.maplibreMap.setPaintProperty('country-highlight-fill', 'fill-opacity', highlightOpacity);
      this.maplibreMap.setPaintProperty('country-risk-low-fill', 'fill-opacity', riskLowOpacity);
      this.maplibreMap.setPaintProperty('country-risk-medium-fill', 'fill-opacity', riskMedOpacity);
      this.maplibreMap.setPaintProperty('country-risk-high-fill', 'fill-opacity', riskHighOpacity);
    } catch { /* layers may not be ready */ }
  }

  public destroy(): void {
    if (this.moveTimeoutId) {
      clearTimeout(this.moveTimeoutId);
      this.moveTimeoutId = null;
    }

    this.stopReplayTimer();

    this.stopPulseAnimation();

    if (this.borderStreamTimerId !== null) {
      clearInterval(this.borderStreamTimerId);
      this.borderStreamTimerId = null;
    }

    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
      this.resizeObserver = null;
    }

    this.layerCache.clear();

    this.deckOverlay?.finalize();
    this.deckOverlay = null;
    this.maplibreMap?.remove();
    this.maplibreMap = null;

    this.container.innerHTML = '';
  }
}
