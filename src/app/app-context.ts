import type { NewsItem, Monitor, PanelConfig, MapLayers, InternetOutage, SocialUnrestEvent, MilitaryFlight, MilitaryFlightCluster, MilitaryVessel, MilitaryVesselCluster, CyberThreat, USNIFleetReport } from '@/types';
import type { AirportDelayAlert, PositionSample } from '@/services/aviation';
import type { IranEvent } from '@/generated/client/worldmonitor/conflict/v1/service_client';
import type { SecurityAdvisory } from '@/services/security-advisories';
import type { MapContainer, Panel, NewsPanel, SignalModal, StatusPanel, SearchModal } from '@/components';
import type { IntelligenceGapBadge } from '@/components';
import type { MarketData, ClusteredEvent } from '@/types';
import type { PredictionMarket } from '@/services/prediction';
import type { TimeRange } from '@/components';
import type { Earthquake } from '@/services/earthquakes';
import type { CountryBriefPanel } from '@/components/CountryBriefPanel';
import type { CountryTimeline } from '@/components/CountryTimeline';
import type { PlaybackControl } from '@/components';
import type { ExportPanel } from '@/utils';
import type { UnifiedSettings } from '@/components/UnifiedSettings';
import type { PizzIntIndicator } from '@/components';
import type { ParsedMapUrlState } from '@/utils';
import type { PositiveNewsFeedPanel } from '@/components/PositiveNewsFeedPanel';
import type { CountersPanel } from '@/components/CountersPanel';
import type { ProgressChartsPanel } from '@/components/ProgressChartsPanel';
import type { BreakthroughsTickerPanel } from '@/components/BreakthroughsTickerPanel';
import type { HeroSpotlightPanel } from '@/components/HeroSpotlightPanel';
import type { GoodThingsDigestPanel } from '@/components/GoodThingsDigestPanel';
import type { SpeciesComebackPanel } from '@/components/SpeciesComebackPanel';
import type { RenewableEnergyPanel } from '@/components/RenewableEnergyPanel';
import type { AnalysisHubPage } from '@/components/AnalysisHubPage';
import type { CodexHubPage } from '@/components/CodexHubPage';
import type { OntologyGraphPage } from '@/components/OntologyGraphPage';
import type { TvModeController } from '@/services/tv-mode';
import type { BreakingNewsBanner } from '@/components/BreakingNewsBanner';
import type { MobileWarningModal } from '@/components/MobileWarningModal';
import type { KeywordGraphSnapshot } from '@/services/keyword-registry';
import type { ApiSourceRecord } from '@/services/api-source-registry';
import type { GraphRagSummary } from '@/services/graph-rag';
import type { MultimodalFinding } from '@/services/multimodal-intel';
import type { ScheduledReport } from '@/services/scheduled-reports';
import type { SourceCredibilityProfile } from '@/services/source-credibility';
import type { SourceHealingSuggestion } from '@/services/source-healing-suggestions';
import type { EventMarketTransmissionSnapshot } from '@/services/event-market-transmission';
import type { GraphTimeslice } from '@/services/graph-timeslice';
import type { CanonicalEntity } from '@/services/entity-ontology';
import type { NetworkDiscoveryCapture } from '@/services/network-discovery';
import type { MultiHopInferenceAlert } from '@/services/multi-hop-inference';
import type { OntologyGraphSnapshot } from '@/services/ontology-graph';
import type { OntologyLedgerEvent, OntologyReplayState } from '@/services/ontology-event-store';
import type { StixBundle } from '@/services/stix-intel';
import type { InvestmentIntelligenceSnapshot } from '@/services/investment-intelligence';
import type { OperatorContext, OperatorContextPatch } from '@/types/operator-context';

export interface CountryBriefSignals {
  criticalNews: number;
  protests: number;
  militaryFlights: number;
  militaryVessels: number;
  outages: number;
  aisDisruptions: number;
  satelliteFires: number;
  temporalAnomalies: number;
  cyberThreats: number;
  earthquakes: number;
  displacementOutflow: number;
  climateStress: number;
  conflictEvents: number;
  activeStrikes: number;
  orefSirens: number;
  orefHistory24h: number;
  aviationDisruptions: number;
  travelAdvisories: number;
  travelAdvisoryMaxLevel: string | null;
  gpsJammingHexes: number;
  isTier1: boolean;
}

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
  keywordGraph?: KeywordGraphSnapshot;
  graphRagSummary?: GraphRagSummary;
  apiSources?: ApiSourceRecord[];
  multimodalFindings?: MultimodalFinding[];
  scheduledReports?: ScheduledReport[];
  sourceCredibility?: SourceCredibilityProfile[];
  sourceHealingSuggestions?: SourceHealingSuggestion[];
  eventMarketTransmission?: EventMarketTransmissionSnapshot | null;
  graphTimeslices?: GraphTimeslice[];
  ontologyEntities?: CanonicalEntity[];
  ontologyGraph?: OntologyGraphSnapshot | null;
  ontologyLedger?: OntologyLedgerEvent[];
  ontologyReplayState?: OntologyReplayState | null;
  stixBundle?: StixBundle | null;
  networkDiscoveries?: NetworkDiscoveryCapture[];
  multiHopInferences?: MultiHopInferenceAlert[];
  investmentIntelligence?: InvestmentIntelligenceSnapshot | null;
}

export interface AppModule {
  init(): void | Promise<void>;
  destroy(): void;
}

export interface AppContext {
  map: MapContainer | null;
  readonly isMobile: boolean;
  readonly isDesktopApp: boolean;
  readonly container: HTMLElement;

  panels: Record<string, Panel>;
  newsPanels: Record<string, NewsPanel>;
  panelSettings: Record<string, PanelConfig>;

  mapLayers: MapLayers;

  allNews: NewsItem[];
  newsByCategory: Record<string, NewsItem[]>;
  latestMarkets: MarketData[];
  latestPredictions: PredictionMarket[];
  latestClusters: ClusteredEvent[];
  intelligenceCache: IntelligenceCache;
  cyberThreatsCache: CyberThreat[] | null;

  disabledSources: Set<string>;
  currentTimeRange: TimeRange;
  operatorContext: OperatorContext;
  setOperatorContext: (patch: OperatorContextPatch, options?: { persist?: boolean }) => OperatorContext;

  inFlight: Set<string>;
  seenGeoAlerts: Set<string>;
  monitors: Monitor[];

  signalModal: SignalModal | null;
  statusPanel: StatusPanel | null;
  searchModal: SearchModal | null;
  mobileWarningModal?: MobileWarningModal | null;
  findingsBadge: IntelligenceGapBadge | null;
  breakingBanner: BreakingNewsBanner | null;
  playbackControl: PlaybackControl | null;
  exportPanel: ExportPanel | null;
  unifiedSettings: UnifiedSettings | null;
  pizzintIndicator: PizzIntIndicator | null;
  analysisHubPage: AnalysisHubPage | null;
  codexHubPage: CodexHubPage | null;
  ontologyGraphPage: OntologyGraphPage | null;
  countryBriefPage: CountryBriefPanel | null;
  countryTimeline: CountryTimeline | null;

  // Happy variant state
  positivePanel: PositiveNewsFeedPanel | null;
  countersPanel: CountersPanel | null;
  progressPanel: ProgressChartsPanel | null;
  breakthroughsPanel: BreakthroughsTickerPanel | null;
  heroPanel: HeroSpotlightPanel | null;
  digestPanel: GoodThingsDigestPanel | null;
  speciesPanel: SpeciesComebackPanel | null;
  renewablePanel: RenewableEnergyPanel | null;
  tvMode: TvModeController | null;
  happyAllItems: NewsItem[];
  isDestroyed: boolean;
  isPlaybackMode: boolean;
  isIdle: boolean;
  initialLoadComplete: boolean;
  resolvedLocation: 'global' | 'america' | 'mena' | 'eu' | 'asia' | 'latam' | 'africa' | 'oceania';

  initialUrlState: ParsedMapUrlState | null;
  readonly PANEL_ORDER_KEY: string;
  readonly PANEL_SPANS_KEY: string;
}
