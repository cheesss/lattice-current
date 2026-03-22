import type { InternetOutage, SocialUnrestEvent, MilitaryFlight, MilitaryFlightCluster, MilitaryVessel, MilitaryVesselCluster, USNIFleetReport, PanelConfig, MapLayers, NewsItem, MarketData, ClusteredEvent, CyberThreat, Monitor } from '@/types';
import type { AirportDelayAlert, PositionSample } from '@/services/aviation';
import type { IranEvent } from '@/generated/client/worldmonitor/conflict/v1/service_client';
import type { SanctionsPressureResult } from '@/services/sanctions-pressure';
import type { RadiationWatchResult } from '@/services/radiation';
import type { SecurityAdvisory } from '@/services/security-advisories';
import type { Earthquake } from '@/services/earthquakes';

export type { CountryBriefSignals } from '@/types';

export interface IntelligenceCache {
  flightDelays?: AirportDelayAlert[];
  aircraftPositions?: PositionSample[];
  outages?: InternetOutage[];
  protests?: { events: SocialUnrestEvent[]; sources: { acled: number; gdelt: number } };
  military?: { flights: MilitaryFlight[]; flightClusters: MilitaryFlightCluster[]; vessels: MilitaryVessel[]; vesselClusters: MilitaryVesselCluster[] };
  earthquakes?: Earthquake[];
  usniFleet?: USNIFleetReport;
  iranEvents?: IranEvent[];
  orefAlerts?: { alertCount: number; historyCount24h: number };
  advisories?: SecurityAdvisory[];
  sanctions?: SanctionsPressureResult;
  radiation?: RadiationWatchResult;
  imageryScenes?: Array<{ id: string; satellite: string; datetime: string; resolutionM: number; mode: string; geometryGeojson: string; previewUrl: string; assetUrl: string }>;

  // Strategic Intelligence (missing previously)
  keywordGraph?: import('@/services/keyword-registry').KeywordGraphSnapshot;
  graphRagSummary?: import('@/services/graph-rag').GraphRagSummary;
  ontologyGraph?: import('@/services/ontology-graph').OntologyGraphSnapshot;
  multimodalFindings?: Array<{ topic: string; url: string; summary: string; capturedAt: Date | string; evidence?: string[] }>;
  sourceCredibility?: import('@/services/source-credibility').SourceCredibilityProfile[];
  eventMarketTransmission?: import('@/services/event-market-transmission').EventMarketTransmissionSnapshot;
  scheduledReports?: import('@/services/scheduled-reports').ScheduledReport[];
  multiHopInferences?: Array<{ title: string; severity: string; category: string; confidence: number; summary: string; chain: string[] }>;
  ontologyEntities?: import('@/services/entity-ontology').CanonicalEntity[];
}

export interface AppContext {
  map: import('@/components').MapContainer | null;
  readonly isMobile: boolean;
  readonly isDesktopApp: boolean;
  readonly container: HTMLElement;

  panels: Record<string, import('@/components').Panel>;
  newsPanels: Record<string, import('@/components').NewsPanel>;
  panelSettings: Record<string, PanelConfig>;

  mapLayers: MapLayers;

  allNews: NewsItem[];
  newsByCategory: Record<string, NewsItem[]>;
  latestMarkets: MarketData[];
  latestPredictions: import('@/services/prediction').PredictionMarket[];
  latestClusters: ClusteredEvent[];
  intelligenceCache: IntelligenceCache;
  cyberThreatsCache: CyberThreat[] | null;

  disabledSources: Set<string>;
  currentTimeRange: import('@/components').TimeRange;

  inFlight: Set<string>;
  seenGeoAlerts: Set<string>;
  monitors: Monitor[];

  signalModal: import('@/components').SignalModal | null;
  statusPanel: import('@/components').StatusPanel | null;
  searchModal: import('@/components').SearchModal | null;
  findingsBadge: import('@/components').IntelligenceGapBadge | null;
  breakingBanner: import('@/components/BreakingNewsBanner').BreakingNewsBanner | null;
  playbackControl: import('@/components').PlaybackControl | null;
  exportPanel: import('@/utils').ExportPanel | null;
  unifiedSettings: import('@/components/UnifiedSettings').UnifiedSettings | null;
  pizzintIndicator: import('@/components').PizzIntIndicator | null;
  correlationEngine: import('@/services/correlation-engine').CorrelationEngine | null;
  llmStatusIndicator: import('@/components').LlmStatusIndicator | null;
  countryBriefPage: import('@/components/CountryBriefPanel').CountryBriefPanel | null;
  countryTimeline: import('@/components/CountryTimeline').CountryTimeline | null;

  tvMode: import('@/services/tv-mode').TvModeController | null;
  isDestroyed: boolean;
  isPlaybackMode: boolean;
  isIdle: boolean;
  initialLoadComplete: boolean;
  resolvedLocation: 'global' | 'america' | 'mena' | 'eu' | 'asia' | 'latam' | 'africa' | 'oceania';

  initialUrlState: import('@/utils').ParsedMapUrlState | null;
  readonly PANEL_ORDER_KEY: string;
  readonly PANEL_SPANS_KEY: string;
}

export interface AppModule {
  init(): void | Promise<void>;
  destroy(): void;
}
