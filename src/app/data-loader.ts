import type { AppContext, AppModule } from '@/app/app-context';
import type { NewsItem, MapLayers, SocialUnrestEvent, AisDisruptionEvent, AisDensityZone } from '@/types';
import type { MarketData } from '@/types';
import type { TimeRange } from '@/components';
import {
  FEEDS,
  INTEL_SOURCES,
  SECTORS,
  COMMODITIES,
  MARKET_SYMBOLS,
  CRYPTO_MAP,
  SITE_VARIANT,
  LAYER_TO_SOURCE,
  getSourceTier,
} from '@/config';
import { INTEL_HOTSPOTS, CONFLICT_ZONES } from '@/config/geo';
import {
  fetchCategoryFeeds,
  getFeedFailures,
  fetchMultipleStocks,
  fetchCrypto,
  fetchPredictions,
  fetchEarthquakes,
  clusterNews,
  analyzeCorrelations,
  fetchWeatherAlerts,
  fetchFredData,
  fetchInternetOutages,
  isOutagesConfigured,
  fetchAisSignals,
  getAisStatus,
  isAisConfigured,
  fetchCableActivity,
  fetchCableHealth,
  fetchProtestEvents,
  getProtestStatus,
  fetchFlightDelays,
  fetchMilitaryFlights,
  fetchMilitaryVessels,
  initMilitaryVesselStream,
  isMilitaryVesselTrackingConfigured,
  fetchUSNIFleetReport,
  updateBaseline,
  calculateDeviation,
  addToSignalHistory,
  analysisWorker,
  fetchPizzIntStatus,
  fetchGdeltTensions,
  fetchNaturalEvents,
  fetchRecentAwards,
  fetchOilAnalytics,
  fetchBisData,
  fetchCyberThreats,
  drainTrendingSignals,
  fetchTradeRestrictions,
  fetchTariffTrends,
  fetchTradeFlows,
  fetchTradeBarriers,
  fetchShippingRates,
  fetchChokepointStatus,
  fetchCriticalMinerals,
  fetchGlintGeoMarkers,
  fetchGlintCountrySignals,
  fetchGlintFeedRecords,
  isGlintAuthTokenUsable,
  getGlintAuthToken,
  GlintMarketWatchClient,
  isGlintGeoEnabled,
  buildOpenbbIntelSnapshot,
  fetchOpenbbPrimaryTape,
  fetchPortWatchSnapshot,
  toPortWatchAisOverlays,
  fetchGpsInterference,
  fetchTelegramFeed,
  fetchArxivPapers,
  fetchTrendingRepos,
  fetchHackernewsItems,
  fetchMilitaryBases,
  annotateClustersWithRelations,
  updateEventCorrelationSnapshot,
  getActiveDynamicFeedsForCategory,
  startSourceAutonomyLoop,
  stopSourceAutonomyLoop,
  updateAutonomousDiscoveryHints,
  triggerSourceAutonomyOnce,
  buildKeywordTemplateFeedsForCategory,
  collectNewsFromActiveApiSources,
  extractKeywordCandidatesFromText,
  getKeywordGraphSnapshot,
  isLowSignalKeywordTerm,
  listApiSourceRegistry,
  registerApiDiscoveryCandidates,
  reviewKeywordRegistryLifecycle,
  refreshKeywordCanonicalMappings,
  observeTemporalKeywordRelations,
  upsertKeywordCandidates,
  buildGraphRagSummary,
  extractMultimodalFindingsBatch,
  seedCuratedIntelSources,
  maybeGenerateScheduledReport,
  listScheduledReports,
  recomputeSourceCredibility,
  listSourceCredibilityProfiles,
  listSourceHealingSuggestions,
  recomputeEventMarketTransmission,
  getEventMarketTransmissionSnapshot,
  recordGraphTimeslice,
  listGraphTimeslices,
  listCanonicalEntities,
  buildOntologyGraphSnapshot,
  recordOntologySnapshotEvent,
  listOntologyLedgerEvents,
  replayOntologyStateAt,
  buildStixBundle,
  ingestNetworkDiscoveryCaptures,
  listNetworkDiscoveryCaptures,
  networkCapturesToApiDiscoveryCandidates,
  recomputeMultiHopInferences,
  listMultiHopInferences,
  recomputeInvestmentIntelligence,
} from '@/services';
import { mlWorker } from '@/services/ml-worker';
import { clusterNewsHybrid } from '@/services/clustering';
import { nameToCountryCode } from '@/services/country-geometry';
import { ingestProtests, ingestFlights, ingestVessels, ingestEarthquakes, detectGeoConvergence, geoConvergenceToSignal } from '@/services/geo-convergence';
import { signalAggregator } from '@/services/signal-aggregator';
import { updateAndCheck } from '@/services/temporal-baseline';
import { fetchAllFires, flattenFires, computeRegionStats, toMapFires } from '@/services/wildfires';
import { analyzeFlightsForSurge, surgeAlertToSignal, detectForeignMilitaryPresence, foreignPresenceToSignal, type TheaterPostureSummary } from '@/services/military-surge';
import { fetchCachedTheaterPosture } from '@/services/cached-theater-posture';
import { ingestProtestsForCII, ingestMilitaryForCII, ingestNewsForCII, ingestOutagesForCII, ingestConflictsForCII, ingestUcdpForCII, ingestHapiForCII, ingestDisplacementForCII, ingestClimateForCII, ingestGlintForCII, ingestAisForCII, isInLearningMode } from '@/services/country-instability';
import { dataFreshness, type DataSourceId } from '@/services/data-freshness';
import { fetchConflictEvents, fetchUcdpClassifications, fetchHapiSummary, fetchUcdpEvents, deduplicateAgainstAcled, fetchIranEvents } from '@/services/conflict';
import { fetchUnhcrPopulation } from '@/services/displacement';
import { fetchClimateAnomalies } from '@/services/climate';
import { enrichEventsWithExposure } from '@/services/population-exposure';
import { debounce, getCircuitBreakerCooldownInfo } from '@/utils';
import { isFeatureAvailable } from '@/services/runtime-config';
import { canUseLocalAgentEndpoints, isDesktopRuntime, toRuntimeUrl } from '@/services/runtime';
import { getAiFlowSettings } from '@/services/ai-flow-settings';
import { getCurrentLanguage, t } from '@/services/i18n';
import { measureResourceOperation, startResourceSpan } from '@/services/resource-telemetry';
import { maybeShowDownloadBanner } from '@/components/DownloadBanner';
import { mountCommunityWidget } from '@/components/CommunityWidget';
import { ResearchServiceClient } from '@/generated/client/worldmonitor/research/v1/service_client';
import {
  MarketPanel,
  HeatmapPanel,
  CommoditiesPanel,
  CryptoPanel,
  PredictionPanel,
  MonitorPanel,
  InsightsPanel,
  CIIPanel,
  StrategicPosturePanel,
  EconomicPanel,
  TechReadinessPanel,
  UcdpEventsPanel,
  DisplacementPanel,
  ClimateAnomalyPanel,
  PopulationExposurePanel,
  TradePolicyPanel,
  SupplyChainPanel,
  CrossAssetTapePanel,
  EventImpactScreenerPanel,
  CountryExposureMatrixPanel,
  DataQAPanel,
  SourceOpsPanel,
  TransmissionSankeyPanel,
  SignalRidgelinePanel,
  InvestmentWorkflowPanel,
  InvestmentIdeasPanel,
  BacktestLabPanel,
  hideOpenbbFallbackBanner,
  showOpenbbFallbackBanner,
} from '@/components';
import { SatelliteFiresPanel } from '@/components/SatelliteFiresPanel';
import { classifyNewsItem } from '@/services/positive-classifier';
import { fetchGivingSummary } from '@/services/giving';
import { fetchSecurityAdvisories } from '@/services/security-advisories';
import { GivingPanel } from '@/components';
import { fetchProgressData } from '@/services/progress-data';
import { fetchConservationWins } from '@/services/conservation-data';
import { fetchRenewableEnergyData, fetchEnergyCapacity } from '@/services/renewable-energy-data';
import { checkMilestones } from '@/services/celebration';
import { fetchHappinessScores } from '@/services/happiness-data';
import { fetchRenewableInstallations } from '@/services/renewable-installations';
import { filterBySentiment } from '@/services/sentiment-gate';
import { fetchAllPositiveTopicIntelligence } from '@/services/gdelt-intel';
import { fetchPositiveGeoEvents, geocodePositiveNewsItems } from '@/services/positive-events-geo';
import { fetchKindnessData } from '@/services/kindness-data';
import { getPersistentCache, setPersistentCache } from '@/services/persistent-cache';
import type { GlintFeedRecord, GlintNewsLocation } from '@/services/glint';

const CYBER_LAYER_ENABLED = import.meta.env.VITE_ENABLE_CYBER_LAYER === 'true';

type MapNewsLocation = {
  lat: number;
  lon: number;
  title: string;
  threatLevel: string;
  timestamp?: Date;
};
type TemporalObservationInput = Parameters<typeof observeTemporalKeywordRelations>[0][number];

function timeoutSignal(timeoutMs: number): AbortSignal {
  if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
    return AbortSignal.timeout(timeoutMs);
  }
  const controller = new AbortController();
  setTimeout(() => controller.abort(), timeoutMs);
  return controller.signal;
}

function dedupeAisDisruptions(events: AisDisruptionEvent[]): AisDisruptionEvent[] {
  const byId = new Map<string, AisDisruptionEvent>();
  for (const event of events) {
    const id = event.id || `${event.name}:${event.lat.toFixed(2)}:${event.lon.toFixed(2)}`;
    const existing = byId.get(id);
    if (!existing) {
      byId.set(id, event);
      continue;
    }
    if (existing.severity === 'high') continue;
    if (event.severity === 'high' || event.changePct > existing.changePct) {
      byId.set(id, event);
    }
  }
  return Array.from(byId.values());
}

function dedupeAisDensity(zones: AisDensityZone[]): AisDensityZone[] {
  const byId = new Map<string, AisDensityZone>();
  for (const zone of zones) {
    const id = zone.id || `${zone.name}:${zone.lat.toFixed(2)}:${zone.lon.toFixed(2)}`;
    const existing = byId.get(id);
    if (!existing || zone.intensity > existing.intensity) {
      byId.set(id, zone);
    }
  }
  return Array.from(byId.values());
}

const LLM_KEYWORD_SIGNAL_RE = /(drone|missile|war|sanction|military|naval|defense|strike|nuclear|oil|gas|lng|power|grid|energy|battery|uranium|ai|semiconductor|chip|quantum|llm|model|cloud|compute|vaccine|biotech|drug|inflation|yield|bond|equity|shipping|freight|port|supply|pipeline|cable|satellite)/;
const LLM_KEYWORD_WEAK_CONTEXT = new Set([
  'department', 'responsible', 'owner', 'durable', 'generation', 'gains', 'campaign', 'times', 'erupts',
  'first', 'hour', 'hours', 'potential', 'best', 'tail', 'tails', 'used', 'using', 'over', 'under', 'after',
  'before', 'during', 'can', 'could', 'would', 'should', 'may', 'might', 'still', 'already', 'just', 'only',
  'really', 'nearly',
]);

function normalizeKeywordProbe(raw: string): string {
  return String(raw || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s\-_/+.]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function looksHighSignalLlmKeywordTerm(raw: string): boolean {
  const normalized = normalizeKeywordProbe(raw);
  if (!normalized || isLowSignalKeywordTerm(normalized)) return false;
  const tokens = normalized.split(' ').filter(Boolean);
  if (tokens.length === 0 || tokens.length > 4) return false;

  const hasCountryLikeToken = tokens.some(token => Boolean(nameToCountryCode(token)));
  const signalCount = tokens.filter(token => LLM_KEYWORD_SIGNAL_RE.test(token)).length;
  const weakCount = tokens.filter(token => LLM_KEYWORD_WEAK_CONTEXT.has(token)).length;

  if (!hasCountryLikeToken && signalCount === 0) return false;
  if (!hasCountryLikeToken && tokens.length >= 3 && signalCount < 2) return false;
  if (!hasCountryLikeToken && weakCount >= Math.max(1, tokens.length - 1)) return false;
  if (!hasCountryLikeToken && tokens.length === 2 && signalCount === 1 && weakCount >= 1) return false;

  return true;
}

export interface DataLoaderCallbacks {
  renderCriticalBanner: (postures: TheaterPostureSummary[]) => void;
  refreshOpenCountryBrief?: () => void;
}

export class DataLoaderManager implements AppModule {
  private ctx: AppContext;
  private callbacks: DataLoaderCallbacks;

  private mapFlashCache: Map<string, number> = new Map();
  private glintOverlayRequestId = 0;
  private glintRealtimeClient: GlintMarketWatchClient | null = null;
  private glintRealtimeStarted = false;
  private glintRefreshPromise: Promise<void> | null = null;
  private openbbStartupHealthChecked = false;
  private openbbStartupHealthInFlight = false;
  private openbbStartupRetryHandle: ReturnType<typeof setTimeout> | null = null;
  private openbbIntelRefreshQueued = false;
  private portWatchOverlayDisruptions: AisDisruptionEvent[] = [];
  private portWatchOverlayDensity: AisDensityZone[] = [];
  private lastKeywordLifecycleReviewAt = 0;
  private lastApiDiscoveryRunAt = 0;
  private lastLlmKeywordExtractionAt = 0;
  private lastMultimodalExtractionAt = 0;
  private keywordRefreshInFlight = false;
  private apiDiscoveryInFlight = false;
  private multimodalInFlight = false;
  private advancedIntelInFlight = false;
  private readonly MAP_FLASH_COOLDOWN_MS = 10 * 60 * 1000;
  private readonly KEYWORD_LIFECYCLE_INTERVAL_MS = 12 * 60 * 1000;
  private readonly API_DISCOVERY_INTERVAL_MS = 20 * 60 * 1000;
  private readonly LLM_KEYWORD_EXTRACTION_INTERVAL_MS = 30 * 60 * 1000;
  private readonly MULTIMODAL_EXTRACTION_INTERVAL_MS = 25 * 60 * 1000;
  private readonly applyTimeRangeFilterToNewsPanelsDebounced = debounce(() => {
    this.applyTimeRangeFilterToNewsPanels();
  }, 120);
  private readonly triggerGlintRealtimeRefreshDebounced = debounce(() => {
    void this.refreshGlintRealtime();
  }, 900);
  private readonly refreshOpenbbIntelDebounced = debounce(() => {
    void this.refreshOpenbbIntelPanels();
  }, 700);
  private readonly refreshCiiPanelDebounced = debounce(() => {
    (this.ctx.panels['cii'] as CIIPanel | undefined)?.refresh();
  }, 650);

  public updateSearchIndex: () => void = () => {};

  constructor(ctx: AppContext, callbacks: DataLoaderCallbacks) {
    this.ctx = ctx;
    this.callbacks = callbacks;
  }

  init(): void {
    // Start background codex+playwright source hunt loop once runtime is up.
    startSourceAutonomyLoop();
    void triggerSourceAutonomyOnce(false);
  }

  destroy(): void {
    this.stopGlintRealtime();
    stopSourceAutonomyLoop();
    if (this.openbbStartupRetryHandle) {
      clearTimeout(this.openbbStartupRetryHandle);
      this.openbbStartupRetryHandle = null;
    }
  }

  private shouldShowOpenbbFallbackBanner(): boolean {
    return SITE_VARIANT === 'finance';
  }

  private scheduleOpenbbStartupHealthRetry(delayMs = 8000): void {
    if (this.ctx.isDestroyed) return;
    if (this.openbbStartupHealthChecked) return;
    if (this.openbbStartupRetryHandle) return;

    this.openbbStartupRetryHandle = setTimeout(() => {
      this.openbbStartupRetryHandle = null;
      if (this.ctx.isDestroyed || this.openbbStartupHealthChecked) return;
      void this.ensureOpenbbStartupHealth();
    }, delayMs);
  }

  private showOpenbbFallback(message: string): void {
    if (!isDesktopRuntime()) return;
    if (!this.shouldShowOpenbbFallbackBanner()) return;
    showOpenbbFallbackBanner(message);
  }

  private hideOpenbbFallback(): void {
    if (!isDesktopRuntime()) return;
    hideOpenbbFallbackBanner();
  }

  private async ensureOpenbbStartupHealth(): Promise<void> {
    if (this.openbbStartupHealthChecked || this.openbbStartupHealthInFlight) return;

    if (!isDesktopRuntime() || !this.shouldRefreshOpenbbIntel()) {
      this.hideOpenbbFallback();
      this.openbbStartupHealthChecked = true;
      return;
    }

    this.openbbStartupHealthInFlight = true;
    let healthy = false;
    let failureReason = 'openbb-api health failed';

    try {
      const endpoint = toRuntimeUrl('/api/local-openbb');
      const query = new URLSearchParams({ action: 'health' });
      const response = await fetch(`${endpoint}?${query.toString()}`, {
        method: 'GET',
        signal: timeoutSignal(35_000),
      });

      if (!response.ok) {
        failureReason = `openbb-api health HTTP ${response.status}`;
      } else {
        const payload = await response.json() as { ok?: boolean; reason?: string };
        if (payload.ok) {
          healthy = true;
        } else {
          failureReason = typeof payload.reason === 'string' && payload.reason.trim()
            ? payload.reason
            : 'openbb-api health failed';
        }
      }
    } catch {
      failureReason = 'openbb-api unavailable at startup';
    } finally {
      this.openbbStartupHealthInFlight = false;
    }

    if (healthy) {
      this.openbbStartupHealthChecked = true;
      this.hideOpenbbFallback();
      this.ctx.statusPanel?.updateApi('OpenBB', { status: 'ok' });
      return;
    }

    this.openbbStartupHealthChecked = false;
    this.showOpenbbFallback(`${failureReason} (fallback active)`);
    this.ctx.statusPanel?.updateApi('OpenBB', { status: 'warning' });
    this.scheduleOpenbbStartupHealthRetry();
  }

  public startGlintRealtime(): void {
    if (this.glintRealtimeStarted || this.ctx.isDestroyed) return;
    if (SITE_VARIANT !== 'full' || !isGlintGeoEnabled()) return;

    const authToken = getGlintAuthToken();
    this.glintRealtimeClient = new GlintMarketWatchClient({
      authToken,
      rooms: ['feed', 'market_watch'],
      reconnect: Boolean(authToken),
      onStatus: (status, detail) => {
        if (status === 'authenticated' || status === 'connected') {
          this.triggerGlintRealtimeRefreshDebounced();
        }
        if (status === 'error' && detail) {
          console.warn('[Glint] Realtime status error:', detail);
        }
      },
      onMessage: (message) => {
        if (this.shouldTriggerGlintRealtimeRefresh(message)) {
          this.triggerGlintRealtimeRefreshDebounced();
        }
      },
    });

    this.glintRealtimeStarted = true;
    void this.glintRealtimeClient.connect();
  }

  public stopGlintRealtime(): void {
    this.glintRealtimeClient?.disconnect();
    this.glintRealtimeClient = null;
    this.glintRealtimeStarted = false;
  }

  public async refreshGlintRealtime(): Promise<void> {
    if (this.ctx.isDestroyed || SITE_VARIANT !== 'full' || !isGlintGeoEnabled()) return;
    if (this.ctx.inFlight.has('intelligence')) return;
    await this.refreshGlintIntelligence();
  }

  private shouldTriggerGlintRealtimeRefresh(message: Record<string, unknown>): boolean {
    const action = typeof message.action === 'string' ? message.action.trim().toLowerCase() : '';
    const room = typeof message.room === 'string' ? message.room.trim().toLowerCase() : '';

    if (room === 'feed') return true;
    if (room === 'market_watch') return true;
    if (action.includes('feed') || action.includes('news') || action.includes('market') || action.includes('mover')) return true;
    if (
      'feed_item' in message
      || 'news' in message
      || 'tweet' in message
      || 'telegram' in message
      || 'reddit' in message
      || 'related_market' in message
      || 'related_markets' in message
    ) {
      return true;
    }
    return false;
  }

  private shouldShowIntelligenceNotifications(): boolean {
    return !this.ctx.isMobile && !!this.ctx.findingsBadge?.isPopupEnabled();
  }

  private refreshAutonomyHintsFromSnapshot(): void {
    const hints: string[] = [];

    const topClusterTitles = this.ctx.latestClusters
      .slice(0, 12)
      .map(cluster => cluster.primaryTitle)
      .filter((title): title is string => typeof title === 'string' && title.trim().length > 0);
    hints.push(...topClusterTitles);

    const topNewsTitles = this.ctx.allNews
      .slice(0, 20)
      .map(item => item.title)
      .filter((title): title is string => typeof title === 'string' && title.trim().length > 0);
    hints.push(...topNewsTitles);

    const movers = [...this.ctx.latestMarkets]
      .sort((a, b) => Math.abs(b.change || 0) - Math.abs(a.change || 0))
      .slice(0, 8)
      .map((market) => `${market.symbol} ${market.name} market volatility`);
    hints.push(...movers);

    const military = this.ctx.intelligenceCache.military;
    if (military?.flights?.length) {
      hints.push('military flight surge and operator pattern');
    }
    if (military?.vessels?.length) {
      hints.push('naval movement and maritime chokepoint risk');
    }
    if (this.ctx.intelligenceCache.outages?.length) {
      hints.push('critical internet outage and infrastructure disruption');
    }

    updateAutonomousDiscoveryHints(hints);
  }

  private parseLlmKeywordTerms(raw: string): string[] {
    const text = String(raw || '').trim();
    if (!text) return [];

    const directJson = (() => {
      try {
        const parsed = JSON.parse(text) as unknown;
        if (Array.isArray(parsed)) {
          return parsed.map(item => String(item || '').trim()).filter(Boolean);
        }
        if (parsed && typeof parsed === 'object' && Array.isArray((parsed as { keywords?: unknown[] }).keywords)) {
          return ((parsed as { keywords?: unknown[] }).keywords || [])
            .map(item => String(item || '').trim())
            .filter(Boolean);
        }
      } catch {
        return null;
      }
      return null;
    })();
    if (directJson && directJson.length > 0) {
      return directJson
        .map(item => String(item || '').trim())
        .filter(item => item.length >= 3)
        .filter(item => item.split(/\s+/).length <= 4)
        .filter(item => !isLowSignalKeywordTerm(item))
        .filter(item => looksHighSignalLlmKeywordTerm(item))
        .slice(0, 24);
    }

    const arrayMatch = text.match(/\[[\s\S]*\]/);
    if (arrayMatch?.[0]) {
      try {
        const parsed = JSON.parse(arrayMatch[0]) as unknown[];
        if (Array.isArray(parsed)) {
          return parsed
            .map(item => String(item || '').trim())
            .filter(item => item.length >= 3)
            .filter(item => item.split(/\s+/).length <= 4)
            .filter(item => !isLowSignalKeywordTerm(item))
            .filter(item => looksHighSignalLlmKeywordTerm(item))
            .slice(0, 24);
        }
      } catch {
        // fallback
      }
    }

    return text
      .split(/\r?\n|,/)
      .map(line => line.replace(/^[\-\*\d.\)\s]+/, '').trim())
      .filter(line => line.length >= 3)
      .filter(line => line.split(/\s+/).length <= 4)
      .filter(line => !isLowSignalKeywordTerm(line))
      .filter(line => looksHighSignalLlmKeywordTerm(line))
      .slice(0, 24);
  }

  private async extractLlmKeywordCandidates(): Promise<Array<{
    term: string;
    domain?: 'tech' | 'defense' | 'energy' | 'bio' | 'macro' | 'supply-chain' | 'mixed';
    aliases?: string[];
    lang?: string;
    weight?: number;
    confidence?: number;
    sourceTier?: number;
    marketRelevance?: number;
    ingress?: 'manual' | 'llm' | 'market' | 'playwright';
    relatedTerms?: string[];
  }>> {
    if (!canUseLocalAgentEndpoints()) {
      return [];
    }

    if (Date.now() - this.lastLlmKeywordExtractionAt < this.LLM_KEYWORD_EXTRACTION_INTERVAL_MS) {
      return [];
    }

    const headlines = this.ctx.allNews.slice(0, 36).map(item => item.title).filter(Boolean);
    if (headlines.length === 0) return [];

    const response = await fetch('/api/local-codex-summarize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        mode: 'chat',
        geoContext: 'Return JSON only: {"keywords":["..."]}. Extract emerging technology/geopolitical/economic terms from snapshot headlines.',
        variant: SITE_VARIANT,
        lang: getCurrentLanguage(),
        headlines: [
          'TASK: Extract up to 20 high-signal emerging keywords.',
          'RULES: Return strict JSON object {"keywords":[...]} with short terms only.',
          ...headlines,
        ].slice(0, 60),
      }),
      signal: AbortSignal.timeout(25_000),
    });
    if (!response.ok) return [];

    const payload = await response.json() as { summary?: string };
    const terms = this.parseLlmKeywordTerms(payload.summary || '');
    if (terms.length === 0) return [];
    this.lastLlmKeywordExtractionAt = Date.now();

    return terms
      .filter(term => !isLowSignalKeywordTerm(term))
      .filter(term => looksHighSignalLlmKeywordTerm(term))
      .slice(0, 20)
      .map((term) => ({
        term,
        ingress: 'llm' as const,
        confidence: 70,
        marketRelevance: 60,
        sourceTier: 2,
        aliases: ['llm-extracted'],
        lang: getCurrentLanguage(),
      }));
  }

  private buildTemporalRelationObservations(): TemporalObservationInput[] {
    const observations: TemporalObservationInput[] = [];
    const seen = new Set<string>();
    const observedAt = Date.now();
    const lang = getCurrentLanguage();

    const pushPairs = (terms: string[], evidence: string, weight: number): void => {
      const uniqueTerms = Array.from(new Set(
        terms
          .map(term => String(term || '').trim().toLowerCase())
          .filter(term => term.length >= 3),
      )).slice(0, 7);
      if (uniqueTerms.length < 2) return;

      for (let i = 0; i < uniqueTerms.length; i += 1) {
        for (let j = i + 1; j < uniqueTerms.length; j += 1) {
          const left = uniqueTerms[i]!;
          const right = uniqueTerms[j]!;
          const key = left < right ? `${left}::${right}` : `${right}::${left}`;
          if (seen.has(key)) continue;
          seen.add(key);
          observations.push({
            sourceTerm: left,
            targetTerm: right,
            weight,
            evidence: evidence.slice(0, 320),
            observedAt,
          });
          if (observations.length >= 260) return;
        }
      }
    };

    for (const item of this.ctx.allNews.slice(0, 80)) {
      const extracted = extractKeywordCandidatesFromText(
        `${item.title} ${item.locationName || ''}`,
        { lang, ingress: 'llm' },
      );
      const terms = [
        ...extracted.slice(0, 6).map(candidate => candidate.term),
        item.locationName || '',
      ];
      pushPairs(terms, `${item.source}: ${item.title}`, item.isAlert ? 2 : 1);
      if (observations.length >= 260) break;
    }

    if (observations.length < 260) {
      for (const cluster of this.ctx.latestClusters.slice(0, 50)) {
        const extracted = extractKeywordCandidatesFromText(
          `${cluster.primaryTitle} ${(cluster.relations?.evidence || []).join(' ')}`,
          { lang, ingress: 'llm' },
        );
        const terms = [
          ...extracted.slice(0, 6).map(candidate => candidate.term),
        ];
        const relationEvidence = [
          cluster.primaryTitle,
          ...(cluster.relations?.evidence || []).slice(0, 3),
        ].join(' | ');
        pushPairs(terms, relationEvidence, cluster.isAlert ? 2.4 : 1.1);
        if (observations.length >= 260) break;
      }
    }

    return observations;
  }

  private buildKeywordCandidateBatch(): Array<{
    term: string;
    domain?: 'tech' | 'defense' | 'energy' | 'bio' | 'macro' | 'supply-chain' | 'mixed';
    aliases?: string[];
    lang?: string;
    weight?: number;
    confidence?: number;
    sourceTier?: number;
    marketRelevance?: number;
    ingress?: 'manual' | 'llm' | 'market' | 'playwright';
    relatedTerms?: string[];
  }> {
    const lang = getCurrentLanguage();
    const candidates: Array<{
      term: string;
      domain?: 'tech' | 'defense' | 'energy' | 'bio' | 'macro' | 'supply-chain' | 'mixed';
      aliases?: string[];
      lang?: string;
      weight?: number;
      confidence?: number;
      sourceTier?: number;
      marketRelevance?: number;
      ingress?: 'manual' | 'llm' | 'market' | 'playwright';
      relatedTerms?: string[];
    }> = [];

    const topNews = this.ctx.allNews.slice(0, 180);
    for (const news of topNews) {
      const extracted = extractKeywordCandidatesFromText(
        `${news.title} ${news.locationName || ''}`,
        { lang, ingress: 'llm' },
      );
      const sourceTier = getSourceTier(news.source);
      for (const item of extracted.slice(0, 8)) {
        candidates.push({
          ...item,
          sourceTier,
          marketRelevance: news.isAlert ? 70 : 45,
          confidence: news.isAlert ? 72 : 58,
          aliases: [news.source, ...(item.aliases || [])],
          relatedTerms: [news.locationName || '', ...(item.relatedTerms || [])].filter(Boolean),
        });
      }
    }

    const topClusters = this.ctx.latestClusters.slice(0, 80);
    for (const cluster of topClusters) {
      const extracted = extractKeywordCandidatesFromText(
        `${cluster.primaryTitle} ${(cluster.relations?.evidence || []).join(' ')}`,
        { lang, ingress: 'llm' },
      );
      for (const item of extracted.slice(0, 6)) {
        candidates.push({
          ...item,
          sourceTier: getSourceTier(cluster.primarySource),
          marketRelevance: cluster.isAlert ? 78 : 50,
          confidence: cluster.isAlert ? 75 : 60,
          relatedTerms: [
            ...((cluster.relations?.evidence || []).slice(0, 4)),
            ...(item.relatedTerms || []),
          ],
        });
      }
    }

    const movers = [...this.ctx.latestMarkets]
      .sort((a, b) => Math.abs(b.change || 0) - Math.abs(a.change || 0))
      .slice(0, 12);
    for (const mover of movers) {
      const magnitude = Math.abs(mover.change || 0);
      if (!Number.isFinite(magnitude) || magnitude < 1.2) continue;
      candidates.push({
        term: `${mover.symbol} volatility`,
        aliases: [mover.symbol, mover.name, `${mover.display || ''}`],
        ingress: 'market',
        domain: 'macro',
        sourceTier: 1,
        marketRelevance: Math.max(40, Math.min(100, Math.round(magnitude * 18))),
        confidence: Math.max(58, Math.min(95, Math.round(55 + magnitude * 8))),
        weight: 1.2,
        relatedTerms: [`${mover.symbol} price move`, `${mover.name} market`],
        lang,
      });
    }

    return candidates;
  }

  private async refreshKeywordGraphContext(): Promise<void> {
    if (this.keywordRefreshInFlight) return;
    this.keywordRefreshInFlight = true;
    try {
      const candidates = this.buildKeywordCandidateBatch();
      const llmCandidates = await this.extractLlmKeywordCandidates().catch(() => []);
      candidates.push(...llmCandidates);
      if (candidates.length > 0) {
        await upsertKeywordCandidates(candidates.slice(0, 420));
      }

      const temporalObservations = this.buildTemporalRelationObservations();
      if (temporalObservations.length > 0) {
        await observeTemporalKeywordRelations(temporalObservations);
      }

      if (Date.now() - this.lastKeywordLifecycleReviewAt > this.KEYWORD_LIFECYCLE_INTERVAL_MS) {
        await reviewKeywordRegistryLifecycle();
        await refreshKeywordCanonicalMappings(90);
        this.lastKeywordLifecycleReviewAt = Date.now();
      }

      const graph = await getKeywordGraphSnapshot();
      this.ctx.intelligenceCache.keywordGraph = graph;
      this.ctx.intelligenceCache.graphRagSummary = buildGraphRagSummary(graph);
      updateAutonomousDiscoveryHints(graph.nodes.slice(0, 10).map(node => node.term));
    } catch (error) {
      console.warn('[data-loader] keyword registry refresh failed', error);
    } finally {
      this.keywordRefreshInFlight = false;
    }
  }

  private async runApiDiscoveryCycle(force = false): Promise<void> {
    if (!canUseLocalAgentEndpoints()) {
      this.ctx.intelligenceCache.apiSources = await listApiSourceRegistry().catch(() => []);
      this.lastApiDiscoveryRunAt = Date.now();
      return;
    }
    if (this.apiDiscoveryInFlight) return;
    if (!force && Date.now() - this.lastApiDiscoveryRunAt < this.API_DISCOVERY_INTERVAL_MS) return;
    this.apiDiscoveryInFlight = true;
    try {
      const topicHints = [
        ...(this.ctx.intelligenceCache.keywordGraph?.nodes || []).slice(0, 10).map(node => node.term),
        ...this.ctx.latestMarkets
          .slice(0, 6)
          .map(item => `${item.symbol} api data source`),
      ].filter(Boolean);
      if (topicHints.length > 0) {
        const response = await fetch('/api/local-api-source-hunt', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            topics: topicHints,
            timeoutMs: 25_000,
          }),
          signal: AbortSignal.timeout(30_000),
        });

        if (response.ok) {
          const payload = await response.json() as {
            success?: boolean;
            candidates?: Array<{
              name?: string;
              baseUrl?: string;
              sampleUrl?: string;
              category?: string;
              confidence?: number;
              reason?: string;
              discoveredBy?: 'playwright' | 'codex-playwright' | 'manual' | 'heuristic';
              schemaHint?: 'json' | 'xml' | 'unknown';
              hasRateLimitInfo?: boolean;
              hasTosInfo?: boolean;
            }>;
          };
          if (Array.isArray(payload.candidates) && payload.candidates.length > 0) {
            await registerApiDiscoveryCandidates(payload.candidates.map((candidate) => ({
              name: candidate.name || 'Discovered API',
              baseUrl: candidate.baseUrl || candidate.sampleUrl || '',
              sampleUrl: candidate.sampleUrl,
              category: candidate.category || 'intel',
              confidence: candidate.confidence ?? 55,
              reason: candidate.reason || 'autonomous api discovery',
              discoveredBy: candidate.discoveredBy || 'playwright',
              schemaHint: candidate.schemaHint || 'unknown',
              hasRateLimitInfo: Boolean(candidate.hasRateLimitInfo),
              hasTosInfo: Boolean(candidate.hasTosInfo),
            })));
          }
        }
      }
    } catch (error) {
      console.warn('[data-loader] api discovery cycle failed', error);
    } finally {
      this.lastApiDiscoveryRunAt = Date.now();
      this.ctx.intelligenceCache.apiSources = await listApiSourceRegistry().catch(() => []);
      this.apiDiscoveryInFlight = false;
    }
  }

  private async runMultimodalExtractionCycle(force = false): Promise<void> {
    if (!canUseLocalAgentEndpoints()) return;
    if (this.multimodalInFlight) return;
    if (!force && Date.now() - this.lastMultimodalExtractionAt < this.MULTIMODAL_EXTRACTION_INTERVAL_MS) return;
    this.multimodalInFlight = true;
    try {
      const targets = this.ctx.allNews
        .filter(item => /^https?:\/\//i.test(item.link))
        .slice(0, 16)
        .map(item => ({
          url: item.link,
          topic: `${item.source}${item.locationName ? `/${item.locationName}` : ''}`,
        }));
      if (targets.length === 0) return;

      const findings = await extractMultimodalFindingsBatch(targets, 4);
      if (findings.length === 0) return;

      const merged = new Map<string, (typeof findings)[number]>();
      for (const finding of findings) {
        merged.set(`${finding.url}::${finding.topic}`, finding);
      }
      for (const previous of this.ctx.intelligenceCache.multimodalFindings || []) {
        const key = `${previous.url}::${previous.topic}`;
        if (!merged.has(key)) merged.set(key, previous);
      }

      this.ctx.intelligenceCache.multimodalFindings = Array.from(merged.values())
        .sort((a, b) => new Date(b.capturedAt).getTime() - new Date(a.capturedAt).getTime())
        .slice(0, 48);

      const rawNetworkCaptures = findings.flatMap((finding) => finding.networkCaptures ?? []);
      if (rawNetworkCaptures.length > 0) {
        const captures = await ingestNetworkDiscoveryCaptures(rawNetworkCaptures, 'multimodal').catch(() => []);
        if (captures.length > 0) {
          await registerApiDiscoveryCandidates(
            networkCapturesToApiDiscoveryCandidates(captures),
          ).catch(() => {});
        }
      }

      this.ctx.intelligenceCache.networkDiscoveries = await listNetworkDiscoveryCaptures(64).catch(() => []);
      this.lastMultimodalExtractionAt = Date.now();
    } catch (error) {
      console.warn('[data-loader] multimodal extraction failed', error);
    } finally {
      this.multimodalInFlight = false;
    }
  }

  private async refreshDynamicRegistries(): Promise<void> {
    await this.refreshCuratedSourceSeeds(false);
    await this.refreshKeywordGraphContext();
    await this.runApiDiscoveryCycle(false);
    await this.runMultimodalExtractionCycle(false);
    await this.refreshAdvancedIntelligenceArtifacts();
  }

  private async refreshAdvancedIntelligenceArtifacts(): Promise<void> {
    if (this.advancedIntelInFlight) return;
    this.advancedIntelInFlight = true;
    try {
      const credibility = await measureResourceOperation(
        'analytics:source-credibility',
        {
          label: 'Source credibility recompute',
          kind: 'analytics',
          feature: 'source-credibility',
          inputCount: this.ctx.allNews.length,
        },
        async () => recomputeSourceCredibility(this.ctx.allNews, this.ctx.latestClusters).catch(() => []),
        (result) => ({ outputCount: result.length }),
      );
      this.ctx.intelligenceCache.sourceCredibility = credibility;

      const healingSuggestions = await listSourceHealingSuggestions(48).catch(() => []);
      this.ctx.intelligenceCache.sourceHealingSuggestions = healingSuggestions;

      if (this.ctx.latestMarkets.length > 0 || this.ctx.latestClusters.length > 0) {
        this.ctx.intelligenceCache.eventMarketTransmission = await measureResourceOperation(
          'risk:event-market-transmission',
          {
            label: 'Event-to-market transmission',
            kind: 'risk',
            feature: 'event-market-transmission',
            inputCount: this.ctx.latestClusters.length + this.ctx.latestMarkets.length,
          },
          async () => recomputeEventMarketTransmission({
            news: this.ctx.allNews,
            clusters: this.ctx.latestClusters,
            markets: this.ctx.latestMarkets,
            keywordGraph: this.ctx.intelligenceCache.keywordGraph,
          }).catch(async () => getEventMarketTransmissionSnapshot()),
        );
      } else {
        this.ctx.intelligenceCache.eventMarketTransmission = await getEventMarketTransmissionSnapshot();
      }

      if (this.ctx.intelligenceCache.keywordGraph) {
        await measureResourceOperation(
          'graph:timeslice-record',
          {
            label: 'Graph timeslice record',
            kind: 'graph',
            feature: 'graph-timeslice',
            inputCount: this.ctx.intelligenceCache.keywordGraph.nodes.length,
          },
          async () => recordGraphTimeslice(
            this.ctx.intelligenceCache.keywordGraph!,
            this.ctx.intelligenceCache.graphRagSummary,
          ).catch(() => null),
        );
        this.ctx.intelligenceCache.graphTimeslices = await listGraphTimeslices(18).catch(() => []);
      } else {
        this.ctx.intelligenceCache.graphTimeslices = await listGraphTimeslices(18).catch(() => []);
      }

      this.ctx.intelligenceCache.ontologyEntities = await listCanonicalEntities(180).catch(() => []);
      this.ctx.intelligenceCache.ontologyGraph = await measureResourceOperation(
        'graph:ontology-snapshot',
        {
          label: 'Ontology snapshot build',
          kind: 'graph',
          feature: 'ontology-graph',
          inputCount: (this.ctx.intelligenceCache.ontologyEntities ?? []).length,
        },
        async () => buildOntologyGraphSnapshot({
          keywordGraph: this.ctx.intelligenceCache.keywordGraph ?? null,
          entities: this.ctx.intelligenceCache.ontologyEntities ?? [],
        }).catch(() => null),
      );
      this.ctx.intelligenceCache.stixBundle = buildStixBundle({
        threats: this.ctx.cyberThreatsCache ?? [],
        advisories: this.ctx.intelligenceCache.advisories ?? [],
        clusters: this.ctx.latestClusters ?? [],
        transmission: this.ctx.intelligenceCache.eventMarketTransmission ?? null,
        entities: this.ctx.intelligenceCache.ontologyEntities ?? [],
      });
      if (this.ctx.intelligenceCache.ontologyGraph) {
        await recordOntologySnapshotEvent(this.ctx.intelligenceCache.ontologyGraph).catch(() => null);
        this.ctx.intelligenceCache.ontologyLedger = await listOntologyLedgerEvents(80).catch(() => []);
        const replayAnchor = this.ctx.intelligenceCache.ontologyLedger
          ?.filter((event) => event.type === 'snapshot-built')
          ?.sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp))[1]
          ?? this.ctx.intelligenceCache.ontologyLedger?.[0]
          ?? null;
        this.ctx.intelligenceCache.ontologyReplayState = replayAnchor
          ? await replayOntologyStateAt(replayAnchor.timestamp).catch(() => null)
          : null;
      } else {
        this.ctx.intelligenceCache.ontologyLedger = await listOntologyLedgerEvents(80).catch(() => []);
        this.ctx.intelligenceCache.ontologyReplayState = null;
      }
      this.ctx.intelligenceCache.networkDiscoveries = await listNetworkDiscoveryCaptures(80).catch(() => []);
      this.ctx.intelligenceCache.multiHopInferences = await measureResourceOperation(
        'graph:multi-hop-inference',
        {
          label: 'Multi-hop inference',
          kind: 'graph',
          feature: 'multi-hop-inference',
          inputCount: (this.ctx.intelligenceCache.ontologyEntities ?? []).length,
        },
        async () => recomputeMultiHopInferences({
          transmission: this.ctx.intelligenceCache.eventMarketTransmission ?? null,
          keywordGraph: this.ctx.intelligenceCache.keywordGraph,
          ontologyEntities: this.ctx.intelligenceCache.ontologyEntities ?? [],
        }).catch(async () => listMultiHopInferences(48)),
        (result) => ({ outputCount: result.length }),
      );
      if (!this.ctx.intelligenceCache.sourceCredibility?.length) {
        this.ctx.intelligenceCache.sourceCredibility = await listSourceCredibilityProfiles(60).catch(() => []);
      }
      this.ctx.intelligenceCache.investmentIntelligence = await measureResourceOperation(
        'analytics:investment-intelligence',
        {
          label: 'Investment intelligence recompute',
          kind: 'analytics',
          feature: 'investment-intelligence',
          inputCount: (this.ctx.latestClusters ?? []).length + (this.ctx.latestMarkets ?? []).length,
        },
        async () => recomputeInvestmentIntelligence({
          clusters: this.ctx.latestClusters ?? [],
          markets: this.ctx.latestMarkets ?? [],
          transmission: this.ctx.intelligenceCache.eventMarketTransmission ?? null,
          sourceCredibility: this.ctx.intelligenceCache.sourceCredibility ?? [],
          reports: this.ctx.intelligenceCache.scheduledReports ?? [],
          keywordGraph: this.ctx.intelligenceCache.keywordGraph ?? null,
        }).catch(() => null),
        (result) => ({ outputCount: result?.ideaCards?.length ?? 0 }),
      );
    } catch (error) {
      console.warn('[data-loader] advanced intelligence artifacts refresh failed', error);
    } finally {
      this.advancedIntelInFlight = false;
    }
  }

  private refreshAdvancedVisualizationPanels(): void {
    const sankeyPanel = this.ctx.panels['transmission-sankey'] as TransmissionSankeyPanel | undefined;
    sankeyPanel?.setData(
      this.ctx.intelligenceCache.eventMarketTransmission ?? null,
      this.ctx.intelligenceCache.sourceCredibility ?? [],
    );

    const ridgelinePanel = this.ctx.panels['signal-ridgeline'] as SignalRidgelinePanel | undefined;
    ridgelinePanel?.setData(
      this.ctx.intelligenceCache.graphTimeslices ?? [],
      this.ctx.intelligenceCache.keywordGraph ?? null,
      this.ctx.intelligenceCache.scheduledReports ?? [],
    );

    const workflowPanel = this.ctx.panels['investment-workflow'] as InvestmentWorkflowPanel | undefined;
    workflowPanel?.setData(this.ctx.intelligenceCache.investmentIntelligence ?? null);

    const ideasPanel = this.ctx.panels['investment-ideas'] as InvestmentIdeasPanel | undefined;
    ideasPanel?.setData(this.ctx.intelligenceCache.investmentIntelligence ?? null);

    const backtestLabPanel = this.ctx.panels['backtest-lab'] as BacktestLabPanel | undefined;
    void backtestLabPanel?.refreshData();
  }

  private async refreshScheduledReports(force = false): Promise<void> {
    if (SITE_VARIANT === 'happy') return;
    const sourceCount = new Set(this.ctx.allNews.map((item) => item.source).filter(Boolean)).size;
    const topHeadlines = this.ctx.latestClusters.length > 0
      ? this.ctx.latestClusters.slice(0, 12).map((cluster) => cluster.primaryTitle)
      : this.ctx.allNews.slice(0, 12).map((item) => item.title);
    const topThemes = [
      ...(this.ctx.intelligenceCache.graphRagSummary?.globalThemes || []).slice(0, 8),
      ...(this.ctx.intelligenceCache.keywordGraph?.nodes || []).slice(0, 8).map((node) => node.term),
    ].filter(Boolean).slice(0, 12);
    const topMarkets = this.ctx.latestMarkets
      .slice()
      .sort((a, b) => Math.abs(b.change || 0) - Math.abs(a.change || 0))
      .slice(0, 8)
      .map((item) => `${item.symbol} ${item.change != null ? `${item.change >= 0 ? '+' : ''}${item.change.toFixed(2)}%` : 'n/a'}`);

    await maybeGenerateScheduledReport({
      variant: SITE_VARIANT,
      newsCount: this.ctx.allNews.length,
      clusterCount: this.ctx.latestClusters.length,
      marketCount: this.ctx.latestMarkets.length,
      sourceCount,
      topHeadlines,
      topThemes,
      topMarkets,
    }, { force });

    this.ctx.intelligenceCache.scheduledReports = await listScheduledReports(8).catch(() => []);
  }

  public async refreshApiDiscovery(): Promise<void> {
    await this.runApiDiscoveryCycle(false);
    this.ctx.intelligenceCache.apiSources = await listApiSourceRegistry().catch(() => []);
  }

  public async refreshMultimodalExtraction(): Promise<void> {
    await this.runMultimodalExtractionCycle(false);
  }

  private async refreshCuratedSourceSeeds(force = false): Promise<void> {
    try {
      const seeded = await seedCuratedIntelSources(force);
      if (seeded.ran) {
        this.ctx.intelligenceCache.apiSources = await listApiSourceRegistry().catch(() => []);
      }
    } catch (error) {
      console.warn('[data-loader] curated source seed failed', error);
    }
  }

  async loadAllData(): Promise<void> {
    const loadAllSpan = startResourceSpan('orchestration:load-all-data', {
      label: 'Full data refresh',
      kind: 'orchestration',
      feature: 'load-all-data',
      sampleStorage: true,
    });
    try {
      await this.ensureOpenbbStartupHealth();
      await this.refreshCuratedSourceSeeds(false);

      const runGuarded = async (
      name: string,
      fn: () => Promise<void>,
      telemetry: {
        label?: string;
        kind?: 'collection' | 'analytics' | 'risk' | 'graph' | 'backtest' | 'storage' | 'api' | 'orchestration';
        feature?: string;
        outputCount?: () => number | null;
        inputCount?: () => number | null;
      } = {},
      ): Promise<void> => {
        if (this.ctx.isDestroyed || this.ctx.inFlight.has(name)) return;
        this.ctx.inFlight.add(name);
        try {
          await measureResourceOperation(
            `collection:${name}`,
            {
              label: telemetry.label || name,
              kind: telemetry.kind || 'collection',
              feature: telemetry.feature || name,
              inputCount: telemetry.inputCount?.() ?? null,
            },
            async () => {
              await fn();
              return null;
            },
            () => ({
              outputCount: telemetry.outputCount?.() ?? null,
            }),
          );
        } catch (e) {
          if (!this.ctx.isDestroyed) console.error(`[App] ${name} failed:`, e);
        } finally {
          this.ctx.inFlight.delete(name);
        }
      };

      const tasks: Array<{ name: string; task: Promise<void> }> = [
        {
          name: 'news',
          task: runGuarded('news', () => this.loadNews(), {
            label: 'News collection',
            feature: 'news',
            outputCount: () => this.ctx.allNews.length,
          }),
        },
      ];

    // Happy variant only loads news data -- skip all geopolitical/financial/military data
      if (SITE_VARIANT !== 'happy') {
        tasks.push({ name: 'markets', task: runGuarded('markets', () => this.loadMarkets(), { label: 'Market data collection', feature: 'markets', outputCount: () => this.ctx.latestMarkets.length }) });
        tasks.push({ name: 'predictions', task: runGuarded('predictions', () => this.loadPredictions(), { label: 'Prediction market collection', feature: 'predictions', outputCount: () => this.ctx.latestPredictions.length }) });
        tasks.push({ name: 'pizzint', task: runGuarded('pizzint', () => this.loadPizzInt(), { label: 'Strategic posture feed', feature: 'pizzint' }) });
        tasks.push({ name: 'fred', task: runGuarded('fred', () => this.loadFredData(), { label: 'Economic indicator collection', feature: 'fred' }) });
        tasks.push({ name: 'oil', task: runGuarded('oil', () => this.loadOilAnalytics(), { label: 'Oil analytics', feature: 'oil-analytics' }) });
        tasks.push({ name: 'spending', task: runGuarded('spending', () => this.loadGovernmentSpending(), { label: 'Government spending feed', feature: 'government-spending' }) });
        tasks.push({ name: 'bis', task: runGuarded('bis', () => this.loadBisData(), { label: 'BIS data collection', feature: 'bis' }) });

        // Trade policy data (FULL and FINANCE only)
        if (SITE_VARIANT === 'full' || SITE_VARIANT === 'finance') {
          tasks.push({ name: 'tradePolicy', task: runGuarded('tradePolicy', () => this.loadTradePolicy(), { label: 'Trade policy collection', feature: 'trade-policy' }) });
          tasks.push({ name: 'supplyChain', task: runGuarded('supplyChain', () => this.loadSupplyChain(), { label: 'Supply chain collection', feature: 'supply-chain' }) });
        }
      }

    // Progress charts data (happy variant only)
      if (SITE_VARIANT === 'happy') {
        tasks.push({
          name: 'progress',
          task: runGuarded('progress', () => this.loadProgressData()),
        });
      tasks.push({
        name: 'species',
        task: runGuarded('species', () => this.loadSpeciesData()),
      });
      tasks.push({
        name: 'renewable',
        task: runGuarded('renewable', () => this.loadRenewableData()),
      });
      tasks.push({
        name: 'happinessMap',
        task: runGuarded('happinessMap', async () => {
          const data = await fetchHappinessScores();
          this.ctx.map?.setHappinessScores(data);
        }),
      });
      tasks.push({
        name: 'renewableMap',
        task: runGuarded('renewableMap', async () => {
          const installations = await fetchRenewableInstallations();
          this.ctx.map?.setRenewableInstallations(installations);
        }),
      });
    }

    // Global giving activity data (all variants)
      tasks.push({
        name: 'giving',
        task: runGuarded('giving', async () => {
          const givingResult = await fetchGivingSummary();
          if (!givingResult.ok) {
            dataFreshness.recordError('giving', 'Giving data unavailable (retaining prior state)');
            return;
          }
          const data = givingResult.data;
          (this.ctx.panels['giving'] as GivingPanel)?.setData(data);
          if (data.platforms.length > 0) dataFreshness.recordUpdate('giving', data.platforms.length);
        }),
      });

      if (SITE_VARIANT === 'full') {
        tasks.push({ name: 'intelligence', task: runGuarded('intelligence', () => this.loadIntelligenceSignals(), { label: 'Intelligence signal collection', feature: 'intelligence-signals' }) });
      }

      if (SITE_VARIANT === 'full') tasks.push({ name: 'firms', task: runGuarded('firms', () => this.loadFirmsData()) });
      if (this.ctx.mapLayers.natural) tasks.push({ name: 'natural', task: runGuarded('natural', () => this.loadNatural()) });
      if (SITE_VARIANT !== 'happy' && this.ctx.mapLayers.weather) tasks.push({ name: 'weather', task: runGuarded('weather', () => this.loadWeatherAlerts()) });
      if (SITE_VARIANT !== 'happy' && this.ctx.mapLayers.ais) tasks.push({ name: 'ais', task: runGuarded('ais', () => this.loadAisSignals()) });
      if (SITE_VARIANT !== 'happy' && this.ctx.mapLayers.cables) tasks.push({ name: 'cables', task: runGuarded('cables', () => this.loadCableActivity()) });
      if (SITE_VARIANT !== 'happy' && this.ctx.mapLayers.cables) tasks.push({ name: 'cableHealth', task: runGuarded('cableHealth', () => this.loadCableHealth()) });
      if (SITE_VARIANT !== 'happy' && this.ctx.mapLayers.flights) tasks.push({ name: 'flights', task: runGuarded('flights', () => this.loadFlightDelays()) });
      if (SITE_VARIANT !== 'happy' && CYBER_LAYER_ENABLED && this.ctx.mapLayers.cyberThreats) tasks.push({ name: 'cyberThreats', task: runGuarded('cyberThreats', () => this.loadCyberThreats()) });
      if (SITE_VARIANT !== 'happy' && (this.ctx.mapLayers.techEvents || SITE_VARIANT === 'tech')) tasks.push({ name: 'techEvents', task: runGuarded('techEvents', () => this.loadTechEvents()) });

      if (SITE_VARIANT === 'tech') {
        tasks.push({ name: 'techReadiness', task: runGuarded('techReadiness', () => (this.ctx.panels['tech-readiness'] as TechReadinessPanel)?.refresh()) });
      }

      const results = await Promise.allSettled(tasks.map(t => t.task));

      results.forEach((result, idx) => {
        if (result.status === 'rejected') {
          console.error(`[App] ${tasks[idx]?.name} load failed:`, result.reason);
        }
      });

    // Ensure OpenBB intelligence panels run once after concurrent loaders settle.
      if (this.shouldRefreshOpenbbIntel()) {
        this.refreshOpenbbIntelDebounced();
      }

      await measureResourceOperation(
        'analytics:dynamic-registries',
        {
          label: 'Dynamic registry refresh',
          kind: 'analytics',
          feature: 'dynamic-registries',
          inputCount: this.ctx.allNews.length,
        },
        async () => {
          await this.refreshDynamicRegistries();
          return null;
        },
      );
      await measureResourceOperation(
        'analytics:scheduled-reports',
        {
          label: 'Scheduled report refresh',
          kind: 'analytics',
          feature: 'scheduled-reports',
          inputCount: this.ctx.allNews.length,
        },
        async () => {
          await this.refreshScheduledReports(false);
          return null;
        },
      );
      this.refreshAdvancedVisualizationPanels();
      this.refreshAutonomyHintsFromSnapshot();
      void triggerSourceAutonomyOnce(false);

      this.updateSearchIndex();
      (this.ctx.panels['data-qa'] as DataQAPanel | undefined)?.refreshSnapshot();
      void (this.ctx.panels['source-ops'] as SourceOpsPanel | undefined)?.refresh();
      this.ctx.analysisHubPage?.refresh();
      void this.ctx.codexHubPage?.refresh();
      this.ctx.ontologyGraphPage?.refresh();
    } finally {
      loadAllSpan.end({
        outputCount: this.ctx.allNews.length + this.ctx.latestMarkets.length + this.ctx.latestPredictions.length,
        sampleStorage: true,
      });
    }
  }

  async loadDataForLayer(layer: keyof MapLayers): Promise<void> {
    if (this.ctx.isDestroyed || this.ctx.inFlight.has(layer)) return;
    this.ctx.inFlight.add(layer);
    this.ctx.map?.setLayerLoading(layer, true);
    try {
      switch (layer) {
        case 'natural':
          await this.loadNatural();
          break;
        case 'fires':
          await this.loadFirmsData();
          break;
        case 'weather':
          await this.loadWeatherAlerts();
          break;
        case 'outages':
          await this.loadOutages();
          break;
        case 'cyberThreats':
          await this.loadCyberThreats();
          break;
        case 'ais':
          await this.loadAisSignals();
          break;
        case 'cables':
          await Promise.all([this.loadCableActivity(), this.loadCableHealth()]);
          break;
        case 'protests':
          await this.loadProtests();
          break;
        case 'flights':
          await this.loadFlightDelays();
          break;
        case 'military':
          await this.loadMilitary();
          break;
        case 'techEvents':
          console.log('[loadDataForLayer] Loading techEvents...');
          await this.loadTechEvents();
          console.log('[loadDataForLayer] techEvents loaded');
          break;
        case 'positiveEvents':
          await this.loadPositiveEvents();
          break;
        case 'kindness':
          this.loadKindnessData();
          break;
        case 'ucdpEvents':
        case 'displacement':
        case 'climate':
          await this.loadIntelligenceSignals();
          break;
      }
    } finally {
      this.ctx.inFlight.delete(layer);
      this.ctx.map?.setLayerLoading(layer, false);
      (this.ctx.panels['data-qa'] as DataQAPanel | undefined)?.refreshSnapshot();
      this.ctx.analysisHubPage?.refresh();
      void this.ctx.codexHubPage?.refresh();
    }
  }

  private findFlashLocation(title: string): { lat: number; lon: number } | null {
    const titleLower = title.toLowerCase();
    let bestMatch: { lat: number; lon: number; matches: number } | null = null;

    const countKeywordMatches = (keywords: string[] | undefined): number => {
      if (!keywords) return 0;
      let matches = 0;
      for (const keyword of keywords) {
        const cleaned = keyword.trim().toLowerCase();
        if (cleaned.length >= 3 && titleLower.includes(cleaned)) {
          matches++;
        }
      }
      return matches;
    };

    for (const hotspot of INTEL_HOTSPOTS) {
      const matches = countKeywordMatches(hotspot.keywords);
      if (matches > 0 && (!bestMatch || matches > bestMatch.matches)) {
        bestMatch = { lat: hotspot.lat, lon: hotspot.lon, matches };
      }
    }

    for (const conflict of CONFLICT_ZONES) {
      const matches = countKeywordMatches(conflict.keywords);
      if (matches > 0 && (!bestMatch || matches > bestMatch.matches)) {
        bestMatch = { lat: conflict.center[1], lon: conflict.center[0], matches };
      }
    }

    return bestMatch;
  }

  private flashMapForNews(items: NewsItem[]): void {
    if (!this.ctx.map || !this.ctx.initialLoadComplete) return;
    if (!getAiFlowSettings().mapNewsFlash) return;
    const now = Date.now();

    for (const [key, timestamp] of this.mapFlashCache.entries()) {
      if (now - timestamp > this.MAP_FLASH_COOLDOWN_MS) {
        this.mapFlashCache.delete(key);
      }
    }

    for (const item of items) {
      const cacheKey = `${item.source}|${item.link || item.title}`;
      const lastSeen = this.mapFlashCache.get(cacheKey);
      if (lastSeen && now - lastSeen < this.MAP_FLASH_COOLDOWN_MS) {
        continue;
      }

      const location = this.findFlashLocation(item.title);
      if (!location) continue;

      this.ctx.map.flashLocation(location.lat, location.lon);
      this.mapFlashCache.set(cacheKey, now);
    }
  }

  private mergeMapNewsLocations(
    baseLocations: MapNewsLocation[],
    glintLocations: GlintNewsLocation[],
  ): MapNewsLocation[] {
    const merged: MapNewsLocation[] = [];
    const seen = new Set<string>();

    const push = (item: MapNewsLocation): void => {
      if (!Number.isFinite(item.lat) || !Number.isFinite(item.lon)) return;
      const qLat = Math.round(item.lat * 10) / 10;
      const qLon = Math.round(item.lon * 10) / 10;
      const key = `${qLat}:${qLon}:${item.title.slice(0, 48).toLowerCase()}`;
      if (seen.has(key)) return;
      seen.add(key);
      merged.push(item);
    };

    for (const location of baseLocations) {
      push(location);
    }

    for (const location of glintLocations) {
      push({
        lat: location.lat,
        lon: location.lon,
        title: location.title,
        threatLevel: location.threatLevel,
        timestamp: location.timestamp,
      });
    }

    merged.sort((a, b) => {
      const at = a.timestamp instanceof Date ? a.timestamp.getTime() : 0;
      const bt = b.timestamp instanceof Date ? b.timestamp.getTime() : 0;
      return bt - at;
    });

    return merged.slice(0, 220);
  }

  private toGlintNewsItems(records: GlintFeedRecord[]): NewsItem[] {
    const out: NewsItem[] = [];
    for (const record of records) {
      const source = `Glint/${record.sourceType}: ${record.sourceLabel}`;
      const title = record.title?.trim();
      if (!title) continue;
      const isHighImpactMarket = record.sourceType === 'market'
        && /impact:\s*(high|critical)/i.test(record.snippet || '');
      out.push({
        source,
        title,
        link: record.link || 'https://glint.trade/',
        pubDate: record.timestamp,
        isAlert: record.sourceType === 'telegram' || isHighImpactMarket,
      });
    }
    return out;
  }

  private getBaseClusterNewsLocations(): MapNewsLocation[] {
    return this.ctx.latestClusters
      .filter((cluster): cluster is typeof cluster & { lat: number; lon: number } => cluster.lat != null && cluster.lon != null)
      .map((cluster) => ({
        lat: cluster.lat,
        lon: cluster.lon,
        title: cluster.primaryTitle,
        threatLevel: cluster.threat?.level ?? 'info',
        timestamp: cluster.lastUpdated,
      }));
  }

  private async refreshGlintIntelligence(): Promise<void> {
    if (this.glintRefreshPromise) {
      await this.glintRefreshPromise;
      return;
    }

    this.glintRefreshPromise = (async () => {
      if (!isGlintGeoEnabled() || this.ctx.isDestroyed) return;

      try {
        const authToken = getGlintAuthToken();
        const [signals, feedRecords, glintLocations] = await Promise.all([
          fetchGlintCountrySignals({ maxCountries: 80, authToken }),
          fetchGlintFeedRecords({ maxItems: 160, authToken }),
          fetchGlintGeoMarkers({ maxMarkers: 160, authToken }),
        ]);

        ingestGlintForCII(signals);
        signalAggregator.ingestGlintSignals(signals);

        const glintItems = this.toGlintNewsItems(feedRecords);
        this.ctx.newsByCategory['glint-feed'] = glintItems;
        if (this.ctx.newsPanels['glint-feed']) {
          if (glintItems.length === 0) {
            if (!authToken) {
              this.ctx.newsPanels['glint-feed'].renderAuthRequired(
                'Glint authentication required. Open Settings > General, click "Open Glint Login", sign in, then "Sync Token from Login Window".'
              );
            } else {
              const tokenOk = await isGlintAuthTokenUsable(authToken);
              if (!tokenOk) {
                this.ctx.newsPanels['glint-feed'].renderAuthRequired(
                  'Glint token appears invalid or expired. Open Settings > General, click "Sync Token from Login Window", then retry.'
                );
              } else {
                this.renderNewsForCategory('glint-feed', glintItems);
              }
            }
          } else {
            this.renderNewsForCategory('glint-feed', glintItems);
          }
        }

        const baseLocations = this.getBaseClusterNewsLocations();
        if (glintLocations.length > 0 || baseLocations.length > 0) {
          const merged = this.mergeMapNewsLocations(baseLocations, glintLocations);
          if (merged.length > 0) {
            this.ctx.map?.setNewsLocations(merged);
          }
        }

        const totalItems = signals.reduce((sum, signal) => sum + signal.signalCount, 0);
        const hasAnyGlintData = signals.length > 0 || glintItems.length > 0;
        this.ctx.statusPanel?.updateApi('Glint', { status: hasAnyGlintData ? 'ok' : 'warning' });
        this.ctx.statusPanel?.updateFeed('Glint', { status: hasAnyGlintData ? 'ok' : 'warning', itemCount: Math.max(totalItems, glintItems.length) });

        if (hasAnyGlintData) {
          dataFreshness.recordUpdate('glint', Math.max(totalItems, glintItems.length));
        }
      } catch (error) {
        console.error('[Intelligence] Glint intelligence fetch failed:', error);
        this.ctx.statusPanel?.updateApi('Glint', { status: 'error' });
        this.ctx.statusPanel?.updateFeed('Glint', { status: 'error' });
        dataFreshness.recordError('glint', String(error));
      }
    })();

    try {
      await this.glintRefreshPromise;
    } finally {
      this.glintRefreshPromise = null;
    }
  }

  private async enrichNewsLocationsWithGlint(baseLocations: MapNewsLocation[]): Promise<void> {
    if (SITE_VARIANT === 'happy' || !isGlintGeoEnabled() || this.ctx.isDestroyed) return;

    const requestId = ++this.glintOverlayRequestId;
    try {
      const glintLocations = await fetchGlintGeoMarkers({ maxMarkers: 160 });
      if (this.ctx.isDestroyed || requestId !== this.glintOverlayRequestId) return;
      if (glintLocations.length === 0) return;

      const merged = this.mergeMapNewsLocations(baseLocations, glintLocations);
      if (merged.length > 0) {
        this.ctx.map?.setNewsLocations(merged);
      }
    } catch (error) {
      console.warn('[Glint] Failed to enrich map markers:', error);
    }
  }

  getTimeRangeWindowMs(range: TimeRange): number {
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

  filterItemsByTimeRange(items: NewsItem[], range: TimeRange = this.ctx.currentTimeRange): NewsItem[] {
    if (range === 'all') return items;
    const cutoff = Date.now() - this.getTimeRangeWindowMs(range);
    return items.filter((item) => {
      const ts = item.pubDate instanceof Date ? item.pubDate.getTime() : new Date(item.pubDate).getTime();
      return Number.isFinite(ts) ? ts >= cutoff : true;
    });
  }

  getTimeRangeLabel(range: TimeRange = this.ctx.currentTimeRange): string {
    const labels: Record<TimeRange, string> = {
      '1h': 'the last hour',
      '6h': 'the last 6 hours',
      '24h': 'the last 24 hours',
      '48h': 'the last 48 hours',
      '7d': 'the last 7 days',
      'all': 'all time',
    };
    return labels[range];
  }

  private getFlattenedNewsFromCategories(): NewsItem[] {
    return Object.values(this.ctx.newsByCategory).flat();
  }

  private emitNewsTelemetry(items: NewsItem[]): void {
    const normalized = items
      .filter((item) => item && typeof item.title === 'string' && item.title.trim().length > 0)
      .slice()
      .sort((a, b) => {
        const ta = a.pubDate instanceof Date ? a.pubDate.getTime() : new Date(a.pubDate).getTime();
        const tb = b.pubDate instanceof Date ? b.pubDate.getTime() : new Date(b.pubDate).getTime();
        return (Number.isFinite(tb) ? tb : 0) - (Number.isFinite(ta) ? ta : 0);
      });

    const total = normalized.length;
    const alerts = normalized.filter((item) => item.isAlert).length;
    const sourceCount = new Set(
      normalized
        .map((item) => item.source?.trim())
        .filter((source): source is string => typeof source === 'string' && source.length > 0)
    ).size;

    let latestTimestamp: string | null = null;
    if (normalized.length > 0) {
      const latest = normalized[0]?.pubDate;
      if (latest != null) {
        const latestTs = latest instanceof Date ? latest.getTime() : new Date(latest).getTime();
        if (Number.isFinite(latestTs)) {
          latestTimestamp = new Date(latestTs).toISOString();
        }
      }
    }

    const headlines = normalized.slice(0, 30).map((item) => item.title.trim());

    window.dispatchEvent(new CustomEvent('wm:news-telemetry', {
      detail: {
        total,
        alerts,
        sourceCount,
        latestTimestamp,
        headlines,
      },
    }));
  }

  renderNewsForCategory(category: string, items: NewsItem[]): void {
    this.ctx.newsByCategory[category] = items;
    this.emitNewsTelemetry(this.getFlattenedNewsFromCategories());
    const panel = this.ctx.newsPanels[category];
    if (!panel) return;
    const filteredItems = this.filterItemsByTimeRange(items);
    if (filteredItems.length === 0 && items.length > 0) {
      panel.renderFilteredEmpty(`No items in ${this.getTimeRangeLabel()}`);
      return;
    }
    panel.renderNews(filteredItems);
  }

  applyTimeRangeFilterToNewsPanels(): void {
    Object.entries(this.ctx.newsByCategory).forEach(([category, items]) => {
      this.renderNewsForCategory(category, items);
    });
  }

  applyTimeRangeFilterDebounced(): void {
    this.applyTimeRangeFilterToNewsPanelsDebounced();
  }

  private async loadNewsCategory(category: string, feeds: typeof FEEDS.politics): Promise<NewsItem[]> {
    const span = startResourceSpan(`collection:news:${category}`, {
      label: `News category: ${category}`,
      kind: 'collection',
      feature: `news:${category}`,
      inputCount: (feeds ?? []).length,
    });
    let outputCount = 0;
    try {
      const panel = this.ctx.newsPanels[category];
      const renderIntervalMs = 100;
      let lastRenderTime = 0;
      let renderTimeout: ReturnType<typeof setTimeout> | null = null;
      let pendingItems: NewsItem[] | null = null;

      const enabledFeeds = (feeds ?? []).filter(f => !this.ctx.disabledSources.has(f.name));
      const dynamicFeeds = await getActiveDynamicFeedsForCategory(category);
      const keywordTemplateFeeds = await buildKeywordTemplateFeedsForCategory(category, {
        lang: getCurrentLanguage(),
        maxKeywords: 12,
        maxFeeds: 26,
      });
      const mergedFeeds = [...enabledFeeds, ...dynamicFeeds, ...keywordTemplateFeeds].filter((feed, index, arr) => {
        const key = `${feed.name}::${typeof feed.url === 'string' ? feed.url : JSON.stringify(feed.url)}`;
        return arr.findIndex(candidate => `${candidate.name}::${typeof candidate.url === 'string' ? candidate.url : JSON.stringify(candidate.url)}` === key) === index;
      });
      if (mergedFeeds.length === 0) {
        delete this.ctx.newsByCategory[category];
        if (panel) panel.showError(t('common.allSourcesDisabled'));
        this.ctx.statusPanel?.updateFeed(category.charAt(0).toUpperCase() + category.slice(1), {
          status: 'ok',
          itemCount: 0,
        });
        return [];
      }

      const flushPendingRender = () => {
        if (!pendingItems) return;
        this.renderNewsForCategory(category, pendingItems);
        pendingItems = null;
        lastRenderTime = Date.now();
      };

      const scheduleRender = (partialItems: NewsItem[]) => {
        if (!panel) return;
        pendingItems = partialItems;
        const elapsed = Date.now() - lastRenderTime;
        if (elapsed >= renderIntervalMs) {
          if (renderTimeout) {
            clearTimeout(renderTimeout);
            renderTimeout = null;
          }
          flushPendingRender();
          return;
        }

        if (!renderTimeout) {
          renderTimeout = setTimeout(() => {
            renderTimeout = null;
            flushPendingRender();
          }, renderIntervalMs - elapsed);
        }
      };

      const items = await fetchCategoryFeeds(mergedFeeds, {
        onBatch: (partialItems) => {
          scheduleRender(partialItems);
          this.flashMapForNews(partialItems);
        },
      });

      const apiItems = await collectNewsFromActiveApiSources(category, 4, 3);
      const combinedItems = [...items, ...apiItems]
        .sort((a, b) => b.pubDate.getTime() - a.pubDate.getTime())
        .slice(0, 40);
      outputCount = combinedItems.length;

      this.renderNewsForCategory(category, combinedItems);
      if (panel) {
        if (renderTimeout) {
          clearTimeout(renderTimeout);
          renderTimeout = null;
          pendingItems = null;
        }

        if (combinedItems.length === 0) {
          const failures = getFeedFailures();
          const failedFeeds = mergedFeeds.filter(f => failures.has(f.name));
          if (failedFeeds.length > 0) {
            const names = failedFeeds.map(f => f.name).join(', ');
            panel.showError(`${t('common.noNewsAvailable')} (${names} failed)`);
          }
        }

        try {
          const baseline = await updateBaseline(`news:${category}`, combinedItems.length);
          const deviation = calculateDeviation(combinedItems.length, baseline);
          panel.setDeviation(deviation.zScore, deviation.percentChange, deviation.level);
        } catch (e) { console.warn(`[Baseline] news:${category} write failed:`, e); }
      }

      this.ctx.statusPanel?.updateFeed(category.charAt(0).toUpperCase() + category.slice(1), {
        status: 'ok',
        itemCount: combinedItems.length,
      });
      this.ctx.statusPanel?.updateApi('RSS2JSON', { status: 'ok' });

      return combinedItems;
    } catch (error) {
      this.ctx.statusPanel?.updateFeed(category.charAt(0).toUpperCase() + category.slice(1), {
        status: 'error',
        errorMessage: String(error),
      });
      this.ctx.statusPanel?.updateApi('RSS2JSON', { status: 'error' });
      delete this.ctx.newsByCategory[category];
      return [];
    } finally {
      span.end({ outputCount });
    }
  }

  async loadNews(): Promise<void> {
    // Reset happy variant accumulator for fresh pipeline run
    if (SITE_VARIANT === 'happy') {
      this.ctx.happyAllItems = [];
    }

    const categories = Object.entries(FEEDS)
      .filter((entry): entry is [string, typeof FEEDS[keyof typeof FEEDS]] => Array.isArray(entry[1]) && entry[1].length > 0)
      .map(([key, feeds]) => ({ key, feeds }));

    const maxCategoryConcurrency = SITE_VARIANT === 'tech' ? 4 : 5;
    const categoryConcurrency = Math.max(1, Math.min(maxCategoryConcurrency, categories.length));
    const categoryResults: PromiseSettledResult<NewsItem[]>[] = [];
    for (let i = 0; i < categories.length; i += categoryConcurrency) {
      const chunk = categories.slice(i, i + categoryConcurrency);
      const chunkResults = await Promise.allSettled(
        chunk.map(({ key, feeds }) => this.loadNewsCategory(key, feeds))
      );
      categoryResults.push(...chunkResults);
    }

    const collectedNews: NewsItem[] = [];
    categoryResults.forEach((result, idx) => {
      if (result.status === 'fulfilled') {
        const items = result.value;
        // Tag items with content categories for happy variant
        if (SITE_VARIANT === 'happy') {
          for (const item of items) {
            item.happyCategory = classifyNewsItem(item.source, item.title);
          }
          // Accumulate curated items for the positive news pipeline
          this.ctx.happyAllItems = this.ctx.happyAllItems.concat(items);
        }
        collectedNews.push(...items);
      } else {
        console.error(`[App] News category ${categories[idx]?.key} failed:`, result.reason);
      }
    });

    if (SITE_VARIANT === 'full') {
      const enabledIntelSources = INTEL_SOURCES.filter(f => !this.ctx.disabledSources.has(f.name));
      const intelPanel = this.ctx.newsPanels['intel'];
      if (enabledIntelSources.length === 0) {
        delete this.ctx.newsByCategory['intel'];
        if (intelPanel) intelPanel.showError(t('common.allIntelSourcesDisabled'));
        this.ctx.statusPanel?.updateFeed('Intel', { status: 'ok', itemCount: 0 });
      } else {
        const intelResult = await Promise.allSettled([fetchCategoryFeeds(enabledIntelSources)]);
        if (intelResult[0]?.status === 'fulfilled') {
          const intel = intelResult[0].value;
          this.renderNewsForCategory('intel', intel);
          if (intelPanel) {
            try {
              const baseline = await updateBaseline('news:intel', intel.length);
              const deviation = calculateDeviation(intel.length, baseline);
              intelPanel.setDeviation(deviation.zScore, deviation.percentChange, deviation.level);
            } catch (e) { console.warn('[Baseline] news:intel write failed:', e); }
          }
          this.ctx.statusPanel?.updateFeed('Intel', { status: 'ok', itemCount: intel.length });
          collectedNews.push(...intel);
          this.flashMapForNews(intel);
        } else {
          delete this.ctx.newsByCategory['intel'];
          console.error('[App] Intel feed failed:', intelResult[0]?.reason);
        }
      }
    }

    this.ctx.allNews = collectedNews;
    this.emitNewsTelemetry(this.ctx.allNews);
    this.ctx.initialLoadComplete = true;
    maybeShowDownloadBanner();
    mountCommunityWidget();
    updateAndCheck([
      { type: 'news', region: 'global', count: collectedNews.length },
    ]).then(anomalies => {
      if (anomalies.length > 0) signalAggregator.ingestTemporalAnomalies(anomalies);
    }).catch(() => { });

    this.ctx.map?.updateHotspotActivity(this.ctx.allNews);

    this.updateMonitorResults();

    try {
      this.ctx.latestClusters = await this.clusterNewsWithFallback(this.ctx.allNews);
      this.ctx.latestClusters = annotateClustersWithRelations(this.ctx.latestClusters);

      if (this.ctx.latestClusters.length > 0) {
        const insightsPanel = this.ctx.panels['insights'] as InsightsPanel | undefined;
        insightsPanel?.updateInsights(this.ctx.latestClusters);
      }

      const geoLocated: MapNewsLocation[] = this.ctx.latestClusters
        .filter((c): c is typeof c & { lat: number; lon: number } => c.lat != null && c.lon != null)
        .map(c => ({
          lat: c.lat,
          lon: c.lon,
          title: c.primaryTitle,
          threatLevel: c.threat?.level ?? 'info',
          timestamp: c.lastUpdated,
        }));
      if (geoLocated.length > 0) {
        this.ctx.map?.setNewsLocations(geoLocated);
      }
      void this.enrichNewsLocationsWithGlint(geoLocated);
    } catch (error) {
      console.error('[App] Clustering failed, clusters unchanged:', error);
    }

    // Happy variant: run multi-stage positive news pipeline + map layers
    if (SITE_VARIANT === 'happy') {
      await this.loadHappySupplementaryAndRender();
      await Promise.allSettled([
        this.ctx.mapLayers.positiveEvents ? this.loadPositiveEvents() : Promise.resolve(),
        this.ctx.mapLayers.kindness ? Promise.resolve(this.loadKindnessData()) : Promise.resolve(),
      ]);
    }

    if (this.shouldRefreshOpenbbIntel()) {
      this.refreshOpenbbIntelDebounced();
    }
  }

  async loadMarkets(): Promise<void> {
    await this.ensureOpenbbStartupHealth();

    if (this.shouldRefreshOpenbbIntel()) {
      const openbbLoaded = await this.loadMarketsOpenbbFirst();
      if (!openbbLoaded) {
        await this.loadMarketsFallbackOnly();
      }
    } else {
      await this.loadMarketsFallbackOnly();
    }

    this.refreshOpenbbIntelDebounced();
  }

  private async loadMarketsOpenbbFirst(): Promise<boolean> {
    const marketPanel = this.ctx.panels['markets'] as MarketPanel | undefined;
    const heatmapPanel = this.ctx.panels['heatmap'] as HeatmapPanel | undefined;
    const commoditiesPanel = this.ctx.panels['commodities'] as CommoditiesPanel | undefined;
    const cryptoPanel = this.ctx.panels['crypto'] as CryptoPanel | undefined;

    const cryptoTargets = Object.values(CRYPTO_MAP).map((item) => ({
      symbol: `${item.symbol.toUpperCase()}-USD`,
      displaySymbol: item.symbol.toUpperCase(),
      name: item.name,
    }));

    const symbolSet = new Set<string>();
    MARKET_SYMBOLS.forEach((item) => symbolSet.add(item.symbol));
    COMMODITIES.forEach((item) => symbolSet.add(item.symbol));
    cryptoTargets.forEach((item) => symbolSet.add(item.symbol));

    const openbb = await fetchOpenbbPrimaryTape(Array.from(symbolSet));
    if (!openbb.ok || openbb.rows.length === 0) {
      const reason = openbb.reason || 'OpenBB tape unavailable';
      this.showOpenbbFallback(`${reason} (fallback active)`);
      this.ctx.statusPanel?.updateApi('OpenBB', { status: 'warning' });
      return false;
    }

    this.hideOpenbbFallback();
    this.ctx.statusPanel?.updateApi('OpenBB', { status: 'ok' });
    const openbbMap = new Map(openbb.rows.map((row) => [row.symbol.toUpperCase(), row]));

    let marketRows: MarketData[] = MARKET_SYMBOLS.map((item) => {
      const row = openbbMap.get(item.symbol.toUpperCase());
      return {
        symbol: item.symbol,
        name: item.name,
        display: item.display,
        price: row?.price ?? null,
        change: row?.changePct ?? null,
      };
    });

    const missingMarketSymbols = marketRows
      .filter((item) => item.price == null || item.change == null)
      .map((item) => item.symbol);

    if (missingMarketSymbols.length > 0) {
      const missingMeta = MARKET_SYMBOLS.filter((item) => missingMarketSymbols.includes(item.symbol));
      const fallbackStocks = await fetchMultipleStocks(missingMeta);
      const fallbackMap = new Map(fallbackStocks.data.map((item) => [item.symbol.toUpperCase(), item]));
      marketRows = marketRows.map((item) => {
        if (item.price != null && item.change != null) return item;
        const fallback = fallbackMap.get(item.symbol.toUpperCase());
        if (!fallback) return item;
        return {
          ...item,
          price: fallback.price,
          change: fallback.change,
          sparkline: fallback.sparkline,
        };
      });
    }

    const renderableMarkets = marketRows.filter((item) => item.price != null && item.change != null);
    if (renderableMarkets.length === 0) {
      this.showOpenbbFallback('OpenBB market payload missing core quotes (fallback active)');
      this.ctx.statusPanel?.updateApi('OpenBB', { status: 'warning' });
      return false;
    }

    this.ctx.latestMarkets = renderableMarkets;
    marketPanel?.renderMarkets(renderableMarkets);
    this.ctx.statusPanel?.updateApi('Finnhub', { status: missingMarketSymbols.length > 0 ? 'ok' : 'warning' });

    try {
      const sectorsResult = await fetchMultipleStocks(
        SECTORS.map((s) => ({ ...s, display: s.name })),
        {
          onBatch: (partialSectors) => {
            heatmapPanel?.renderHeatmap(partialSectors.map((s) => ({ name: s.name, change: s.change })));
          },
        }
      );
      heatmapPanel?.renderHeatmap(sectorsResult.data.map((s) => ({ name: s.name, change: s.change })));
    } catch {
      heatmapPanel?.showError('Sector data unavailable');
    }

    let commodityRows: Array<{
      symbol: string;
      display: string;
      price: number | null;
      change: number | null;
      sparkline?: number[];
    }> = COMMODITIES.map((item) => {
      const row = openbbMap.get(item.symbol.toUpperCase());
      return {
        symbol: item.symbol,
        display: item.display,
        price: row?.price ?? null,
        change: row?.changePct ?? null,
        sparkline: undefined,
      };
    });

    const missingCommoditySymbols = commodityRows
      .filter((item) => item.price == null || item.change == null)
      .map((item) => item.symbol);

    if (missingCommoditySymbols.length > 0) {
      const missingMeta = COMMODITIES.filter((item) => missingCommoditySymbols.includes(item.symbol));
      const fallbackCommodities = await fetchMultipleStocks(missingMeta, {
        onBatch: (partial) => {
          const mapped = partial
            .filter((item) => item.price != null && item.change != null)
            .map((item) => ({
              display: item.display,
              price: item.price,
              change: item.change,
              sparkline: item.sparkline,
            }));
          if (mapped.length > 0) {
            commoditiesPanel?.renderCommodities(mapped);
          }
        },
      });
      const fallbackMap = new Map(fallbackCommodities.data.map((item) => [item.symbol.toUpperCase(), item]));
      commodityRows = commodityRows.map((item) => {
        if (item.price != null && item.change != null) return item;
        const fallback = fallbackMap.get(item.symbol.toUpperCase());
        if (!fallback) return item;
        return {
          ...item,
          price: fallback.price,
          change: fallback.change,
          sparkline: fallback.sparkline,
        };
      });
    }

    const commodityRenderable = commodityRows
      .filter((item): item is { symbol: string; display: string; price: number; change: number; sparkline?: number[] } => item.price != null && item.change != null)
      .map((item) => ({
        display: item.display,
        price: item.price,
        change: item.change,
        sparkline: item.sparkline,
      }));

    if (commodityRenderable.length > 0) {
      commoditiesPanel?.renderCommodities(commodityRenderable);
    } else {
      commoditiesPanel?.renderCommodities([]);
    }

    let cryptoRows: Array<{
      name: string;
      symbol: string;
      price: number | null;
      change: number | null;
      sparkline?: number[];
    }> = cryptoTargets.map((item) => {
      const row = openbbMap.get(item.symbol.toUpperCase());
      return {
        name: item.name,
        symbol: item.displaySymbol,
        price: row?.price ?? null,
        change: row?.changePct ?? null,
        sparkline: undefined,
      };
    });

    const missingCryptoSymbols = cryptoRows
      .filter((item) => item.price == null || item.change == null)
      .map((item) => item.symbol);

    if (missingCryptoSymbols.length > 0) {
      const fallbackCrypto = await fetchCrypto();
      const fallbackMap = new Map(fallbackCrypto.map((item) => [item.symbol.toUpperCase(), item]));
      cryptoRows = cryptoRows.map((item) => {
        if (item.price != null && item.change != null) return item;
        const fallback = fallbackMap.get(item.symbol.toUpperCase());
        if (!fallback) return item;
        return {
          ...item,
          price: fallback.price,
          change: fallback.change,
          sparkline: fallback.sparkline,
        };
      });
    }

    const cryptoRenderable = cryptoRows
      .filter((item): item is { name: string; symbol: string; price: number; change: number; sparkline?: number[] } => item.price != null && item.change != null)
      .map((item) => ({
        name: item.name,
        symbol: item.symbol,
        price: item.price,
        change: item.change,
        sparkline: item.sparkline,
      }));

    cryptoPanel?.renderCrypto(cryptoRenderable);
    this.ctx.statusPanel?.updateApi('CoinGecko', {
      status: cryptoRenderable.length > 0 ? (missingCryptoSymbols.length > 0 ? 'ok' : 'warning') : 'error',
    });

    return true;
  }

  private async loadMarketsFallbackOnly(): Promise<void> {
    try {
      const stocksResult = await fetchMultipleStocks(MARKET_SYMBOLS, {
        onBatch: (partialStocks) => {
          this.ctx.latestMarkets = partialStocks;
          (this.ctx.panels['markets'] as MarketPanel).renderMarkets(partialStocks);
        },
      });

      const finnhubConfigMsg = 'FINNHUB_API_KEY not configured - add in Settings';
      this.ctx.latestMarkets = stocksResult.data;
      (this.ctx.panels['markets'] as MarketPanel).renderMarkets(stocksResult.data, stocksResult.rateLimited);

      if (stocksResult.rateLimited && stocksResult.data.length === 0) {
        const rlMsg = 'Market data temporarily unavailable (rate limited) - retrying shortly';
        this.ctx.panels['heatmap']?.showError(rlMsg);
        this.ctx.panels['commodities']?.showError(rlMsg);
      } else if (stocksResult.skipped) {
        this.ctx.statusPanel?.updateApi('Finnhub', { status: 'error' });
        if (stocksResult.data.length === 0) {
          this.ctx.panels['markets']?.showConfigError(finnhubConfigMsg);
        }
        this.ctx.panels['heatmap']?.showConfigError(finnhubConfigMsg);
      } else {
        this.ctx.statusPanel?.updateApi('Finnhub', { status: 'ok' });

        const sectorsResult = await fetchMultipleStocks(
          SECTORS.map((s) => ({ ...s, display: s.name })),
          {
            onBatch: (partialSectors) => {
              (this.ctx.panels['heatmap'] as HeatmapPanel).renderHeatmap(
                partialSectors.map((s) => ({ name: s.name, change: s.change }))
              );
            },
          }
        );
        (this.ctx.panels['heatmap'] as HeatmapPanel).renderHeatmap(
          sectorsResult.data.map((s) => ({ name: s.name, change: s.change }))
        );
      }

      const commoditiesPanel = this.ctx.panels['commodities'] as CommoditiesPanel;
      const mapCommodity = (c: MarketData) => ({ display: c.display, price: c.price, change: c.change, sparkline: c.sparkline });

      let commoditiesLoaded = stocksResult.rateLimited && stocksResult.data.length === 0;
      for (let attempt = 0; attempt < 3 && !commoditiesLoaded; attempt++) {
        if (attempt > 0) {
          commoditiesPanel.showRetrying();
          await new Promise(r => setTimeout(r, 20_000));
        }
        const commoditiesResult = await fetchMultipleStocks(COMMODITIES, {
          onBatch: (partial) => commoditiesPanel.renderCommodities(partial.map(mapCommodity)),
        });
        const mapped = commoditiesResult.data.map(mapCommodity);
        if (mapped.some(d => d.price !== null)) {
          commoditiesPanel.renderCommodities(mapped);
          commoditiesLoaded = true;
        }
      }
      if (!commoditiesLoaded) {
        commoditiesPanel.renderCommodities([]);
      }
    } catch {
      this.ctx.statusPanel?.updateApi('Finnhub', { status: 'error' });
    }

    try {
      let crypto = await fetchCrypto();
      if (crypto.length === 0) {
        (this.ctx.panels['crypto'] as CryptoPanel).showRetrying();
        await new Promise(r => setTimeout(r, 20_000));
        crypto = await fetchCrypto();
      }
      (this.ctx.panels['crypto'] as CryptoPanel).renderCrypto(crypto);
      this.ctx.statusPanel?.updateApi('CoinGecko', { status: crypto.length > 0 ? 'ok' : 'error' });
    } catch {
      this.ctx.statusPanel?.updateApi('CoinGecko', { status: 'error' });
    }
  }

  private shouldRefreshOpenbbIntel(): boolean {
    return SITE_VARIANT === 'full' || SITE_VARIANT === 'finance' || SITE_VARIANT === 'tech';
  }

  private async refreshOpenbbIntelPanels(): Promise<void> {
    if (!this.shouldRefreshOpenbbIntel()) return;
    if (this.ctx.inFlight.has('openbb-intel')) {
      // Keep the latest refresh request and run it once current fetch completes.
      this.openbbIntelRefreshQueued = true;
      return;
    }

    const tapePanel = this.ctx.panels['cross-asset-tape'] as CrossAssetTapePanel | undefined;
    const eventPanel = this.ctx.panels['event-impact-screener'] as EventImpactScreenerPanel | undefined;
    const exposurePanel = this.ctx.panels['country-exposure-matrix'] as CountryExposureMatrixPanel | undefined;
    if (!tapePanel && !eventPanel && !exposurePanel) return;

    this.openbbIntelRefreshQueued = false;
    this.ctx.inFlight.add('openbb-intel');
    try {
      const snapshot = await buildOpenbbIntelSnapshot({
        allNews: this.ctx.allNews,
        clusters: this.ctx.latestClusters,
        latestMarkets: this.ctx.latestMarkets,
      });

      tapePanel?.setData(snapshot.tape, snapshot.generatedAt, snapshot.source, snapshot.coverage);
      eventPanel?.setData(snapshot.eventImpact, snapshot.generatedAt, snapshot.coverage);
      exposurePanel?.setData(snapshot.countryExposure, snapshot.generatedAt, snapshot.coverage);

      if (snapshot.source === 'openbb') {
        this.openbbStartupHealthChecked = true;
        this.hideOpenbbFallback();
      } else if (this.shouldShowOpenbbFallbackBanner()) {
        this.showOpenbbFallback('OpenBB intelligence fallback active');
      }

      this.ctx.statusPanel?.updateApi('OpenBB', {
        status: snapshot.source === 'openbb' ? 'ok' : 'warning',
      });
    } catch (error) {
      tapePanel?.showError('Cross-asset stream unavailable');
      eventPanel?.showError('Impact screening unavailable');
      exposurePanel?.showError('Exposure matrix unavailable');
      this.ctx.statusPanel?.updateApi('OpenBB', {
        status: 'error',
        latency: undefined,
      });
      console.error('[OpenBB Intel] refresh failed:', error);
    } finally {
      this.ctx.inFlight.delete('openbb-intel');
      if (this.openbbIntelRefreshQueued && !this.ctx.isDestroyed) {
        this.openbbIntelRefreshQueued = false;
        this.refreshOpenbbIntelDebounced();
      }
    }
  }

  async loadPredictions(): Promise<void> {
    try {
      const predictions = await fetchPredictions();
      this.ctx.latestPredictions = predictions;
      (this.ctx.panels['polymarket'] as PredictionPanel).renderPredictions(predictions);

      this.ctx.statusPanel?.updateFeed('Polymarket', { status: 'ok', itemCount: predictions.length });
      this.ctx.statusPanel?.updateApi('Polymarket', { status: 'ok' });
      dataFreshness.recordUpdate('polymarket', predictions.length);
      dataFreshness.recordUpdate('predictions', predictions.length);

      void this.runCorrelationAnalysis();
    } catch (error) {
      this.ctx.statusPanel?.updateFeed('Polymarket', { status: 'error', errorMessage: String(error) });
      this.ctx.statusPanel?.updateApi('Polymarket', { status: 'error' });
      dataFreshness.recordError('polymarket', String(error));
      dataFreshness.recordError('predictions', String(error));
    }
  }

  async loadNatural(): Promise<void> {
    const [earthquakeResult, eonetResult] = await Promise.allSettled([
      fetchEarthquakes(),
      fetchNaturalEvents(30),
    ]);

    if (earthquakeResult.status === 'fulfilled') {
      this.ctx.intelligenceCache.earthquakes = earthquakeResult.value;
      this.ctx.map?.setEarthquakes(earthquakeResult.value);
      ingestEarthquakes(earthquakeResult.value);
      this.ctx.statusPanel?.updateApi('USGS', { status: 'ok' });
      dataFreshness.recordUpdate('usgs', earthquakeResult.value.length);
    } else {
      this.ctx.intelligenceCache.earthquakes = [];
      this.ctx.map?.setEarthquakes([]);
      this.ctx.statusPanel?.updateApi('USGS', { status: 'error' });
      dataFreshness.recordError('usgs', String(earthquakeResult.reason));
    }

    if (eonetResult.status === 'fulfilled') {
      this.ctx.map?.setNaturalEvents(eonetResult.value);
      this.ctx.statusPanel?.updateFeed('EONET', {
        status: 'ok',
        itemCount: eonetResult.value.length,
      });
      this.ctx.statusPanel?.updateApi('NASA EONET', { status: 'ok' });
    } else {
      this.ctx.map?.setNaturalEvents([]);
      this.ctx.statusPanel?.updateFeed('EONET', { status: 'error', errorMessage: String(eonetResult.reason) });
      this.ctx.statusPanel?.updateApi('NASA EONET', { status: 'error' });
    }

    const hasEarthquakes = earthquakeResult.status === 'fulfilled' && earthquakeResult.value.length > 0;
    const hasEonet = eonetResult.status === 'fulfilled' && eonetResult.value.length > 0;
    this.ctx.map?.setLayerReady('natural', hasEarthquakes || hasEonet);
  }

  async loadTechEvents(): Promise<void> {
    console.log('[loadTechEvents] Called. SITE_VARIANT:', SITE_VARIANT, 'techEvents layer:', this.ctx.mapLayers.techEvents);
    if (SITE_VARIANT !== 'tech' && !this.ctx.mapLayers.techEvents) {
      console.log('[loadTechEvents] Skipping - not tech variant and layer disabled');
      return;
    }

    try {
      const client = new ResearchServiceClient('', { fetch: (...args: Parameters<typeof fetch>) => globalThis.fetch(...args) });
      const data = await client.listTechEvents({
        type: 'conference',
        mappable: true,
        days: 90,
        limit: 50,
      });
      if (!data.success) throw new Error(data.error || 'Unknown error');

      const now = new Date();
      const mapEvents = data.events.map((e: any) => ({
        id: e.id,
        title: e.title,
        location: e.location,
        lat: e.coords?.lat ?? 0,
        lng: e.coords?.lng ?? 0,
        country: e.coords?.country ?? '',
        startDate: e.startDate,
        endDate: e.endDate,
        url: e.url,
        daysUntil: Math.ceil((new Date(e.startDate).getTime() - now.getTime()) / (1000 * 60 * 60 * 24)),
      }));

      this.ctx.map?.setTechEvents(mapEvents);
      this.ctx.map?.setLayerReady('techEvents', mapEvents.length > 0);
      this.ctx.statusPanel?.updateFeed('Tech Events', { status: 'ok', itemCount: mapEvents.length });

      if (SITE_VARIANT === 'tech' && this.ctx.searchModal) {
        this.ctx.searchModal.registerSource('techevent', mapEvents.map((e: { id: string; title: string; location: string; startDate: string }) => ({
          id: e.id,
          title: e.title,
          subtitle: `${e.location} - ${new Date(e.startDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`,
          data: e,
        })));
      }
    } catch (error) {
      console.error('[App] Failed to load tech events:', error);
      this.ctx.map?.setTechEvents([]);
      this.ctx.map?.setLayerReady('techEvents', false);
      this.ctx.statusPanel?.updateFeed('Tech Events', { status: 'error', errorMessage: String(error) });
    }
  }

  async loadWeatherAlerts(): Promise<void> {
    try {
      const alerts = await fetchWeatherAlerts();
      this.ctx.map?.setWeatherAlerts(alerts);
      this.ctx.map?.setLayerReady('weather', alerts.length > 0);
      this.ctx.statusPanel?.updateFeed('Weather', { status: 'ok', itemCount: alerts.length });
      dataFreshness.recordUpdate('weather', alerts.length);
    } catch (error) {
      this.ctx.map?.setLayerReady('weather', false);
      this.ctx.statusPanel?.updateFeed('Weather', { status: 'error' });
      dataFreshness.recordError('weather', String(error));
    }
  }

  private mergeCategoryNews(category: string, incoming: NewsItem[], maxItems = 60): NewsItem[] {
    if (!Array.isArray(incoming) || incoming.length === 0) {
      return this.ctx.newsByCategory[category] ?? [];
    }

    const existing = this.ctx.newsByCategory[category] ?? [];
    const merged = [...incoming, ...existing].sort((a, b) => b.pubDate.getTime() - a.pubDate.getTime());
    const deduped: NewsItem[] = [];
    const seen = new Set<string>();

    for (const item of merged) {
      const key = `${(item.link || '').trim().toLowerCase()}|${item.title.trim().toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      deduped.push(item);
      if (deduped.length >= maxItems) break;
    }

    this.renderNewsForCategory(category, deduped);
    return deduped;
  }

  private async loadIranEventsSignals(): Promise<void> {
    const events = await fetchIranEvents();
    this.ctx.intelligenceCache.iranEvents = events;
    this.ctx.map?.setIranEvents(events);
    this.ctx.map?.setLayerReady('iranAttacks', events.length > 0);
    this.ctx.statusPanel?.updateFeed('Iran Events', {
      status: events.length > 0 ? 'ok' : 'warning',
      itemCount: events.length,
      errorMessage: events.length === 0 ? 'No Iran events available' : undefined,
    });
  }

  private async loadGpsJammingSignals(): Promise<void> {
    const payload = await fetchGpsInterference();
    const hexes = payload?.hexes ?? [];
    this.ctx.map?.setGpsJamming(hexes);
    this.ctx.map?.setLayerReady('gpsJamming', hexes.length > 0);
    this.ctx.statusPanel?.updateFeed('GPS Jamming', {
      status: payload ? (hexes.length > 0 ? 'ok' : 'warning') : 'warning',
      itemCount: hexes.length,
      errorMessage: payload ? undefined : 'GPS interference feed unavailable',
    });
  }

  private async loadResearchSignals(): Promise<void> {
    const [papersRes, reposRes, hnRes] = await Promise.allSettled([
      fetchArxivPapers('cs.AI', '', 40),
      fetchTrendingRepos('typescript', 'daily', 40),
      fetchHackernewsItems('top', 40),
    ]);

    let total = 0;

    if (papersRes.status === 'fulfilled' && papersRes.value.length > 0) {
      const items: NewsItem[] = papersRes.value.map((paper) => ({
        source: 'ArXiv',
        title: paper.title,
        link: paper.url,
        pubDate: new Date((paper.publishedAt || Date.now()) > 10_000_000_000 ? (paper.publishedAt || Date.now()) : (paper.publishedAt || Date.now()) * 1_000),
        isAlert: false,
      }));
      total += items.length;
      this.mergeCategoryNews('ai', items, 80);
    }

    if (reposRes.status === 'fulfilled' && reposRes.value.length > 0) {
      const items: NewsItem[] = reposRes.value.map((repo) => ({
        source: 'GitHub Trending',
        title: repo.description ? `${repo.fullName} - ${repo.description}` : repo.fullName,
        link: repo.url,
        pubDate: new Date(),
        isAlert: false,
      }));
      total += items.length;
      this.mergeCategoryNews('github', items, 80);
    }

    if (hnRes.status === 'fulfilled' && hnRes.value.length > 0) {
      const items: NewsItem[] = hnRes.value.map((entry) => ({
        source: 'Hacker News',
        title: entry.title,
        link: entry.url || `https://news.ycombinator.com/item?id=${entry.id}`,
        pubDate: new Date((entry.submittedAt || Date.now()) > 10_000_000_000 ? (entry.submittedAt || Date.now()) : (entry.submittedAt || Date.now()) * 1_000),
        isAlert: false,
      }));
      total += items.length;
      this.mergeCategoryNews('dev', items, 80);
    }

    this.ctx.statusPanel?.updateFeed('Research', {
      status: total > 0 ? 'ok' : 'warning',
      itemCount: total,
      errorMessage: total === 0 ? 'Research sources returned no items' : undefined,
    });
  }

  private async loadMilitaryBasesSignals(): Promise<void> {
    const result = await fetchMilitaryBases(-80, -180, 80, 180, 2);
    const bases = result?.bases ?? [];
    this.ctx.map?.setMilitaryBases(bases);
    this.ctx.statusPanel?.updateFeed('Military Bases', {
      status: bases.length > 0 ? 'ok' : 'warning',
      itemCount: bases.length,
      errorMessage: bases.length === 0 ? 'Military base API returned no markers' : undefined,
    });
  }

  async loadIntelligenceSignals(): Promise<void> {
    const tasks: Promise<void>[] = [];

    tasks.push((async () => {
      try {
        const outages = await fetchInternetOutages();
        this.ctx.intelligenceCache.outages = outages;
        ingestOutagesForCII(outages);
        signalAggregator.ingestOutages(outages);
        dataFreshness.recordUpdate('outages', outages.length);
        if (this.ctx.mapLayers.outages) {
          this.ctx.map?.setOutages(outages);
          this.ctx.map?.setLayerReady('outages', outages.length > 0);
          this.ctx.statusPanel?.updateFeed('NetBlocks', { status: 'ok', itemCount: outages.length });
        }
      } catch (error) {
        console.error('[Intelligence] Outages fetch failed:', error);
        dataFreshness.recordError('outages', String(error));
      }
    })());

    const protestsTask = (async (): Promise<SocialUnrestEvent[]> => {
      try {
        const protestData = await fetchProtestEvents();
        this.ctx.intelligenceCache.protests = protestData;
        ingestProtests(protestData.events);
        ingestProtestsForCII(protestData.events);
        signalAggregator.ingestProtests(protestData.events);
        const protestCount = protestData.sources.acled + protestData.sources.gdelt;
        if (protestCount > 0) dataFreshness.recordUpdate('acled', protestCount);
        if (protestData.sources.gdelt > 0) dataFreshness.recordUpdate('gdelt', protestData.sources.gdelt);
        if (protestData.sources.gdelt > 0) dataFreshness.recordUpdate('gdelt_doc', protestData.sources.gdelt);
        if (this.ctx.mapLayers.protests) {
          this.ctx.map?.setProtests(protestData.events);
          this.ctx.map?.setLayerReady('protests', protestData.events.length > 0);
          const status = getProtestStatus();
          this.ctx.statusPanel?.updateFeed('Protests', {
            status: 'ok',
            itemCount: protestData.events.length,
            errorMessage: status.acledConfigured === false ? 'ACLED not configured - using GDELT only' : undefined,
          });
        }
        return protestData.events;
      } catch (error) {
        console.error('[Intelligence] Protests fetch failed:', error);
        dataFreshness.recordError('acled', String(error));
        return [];
      }
    })();
    tasks.push(protestsTask.then(() => undefined));

    tasks.push((async () => {
      try {
        const conflictData = await fetchConflictEvents();
        ingestConflictsForCII(conflictData.events);
        if (conflictData.count > 0) dataFreshness.recordUpdate('acled_conflict', conflictData.count);
      } catch (error) {
        console.error('[Intelligence] Conflict events fetch failed:', error);
        dataFreshness.recordError('acled_conflict', String(error));
      }
    })());

    tasks.push((async () => {
      try {
        const classifications = await fetchUcdpClassifications();
        ingestUcdpForCII(classifications);
        if (classifications.size > 0) dataFreshness.recordUpdate('ucdp', classifications.size);
      } catch (error) {
        console.error('[Intelligence] UCDP fetch failed:', error);
        dataFreshness.recordError('ucdp', String(error));
      }
    })());

    tasks.push((async () => {
      try {
        const summaries = await fetchHapiSummary();
        ingestHapiForCII(summaries);
        if (summaries.size > 0) dataFreshness.recordUpdate('hapi', summaries.size);
      } catch (error) {
        console.error('[Intelligence] HAPI fetch failed:', error);
        dataFreshness.recordError('hapi', String(error));
      }
    })());

    tasks.push((async () => {
      try {
        if (isMilitaryVesselTrackingConfigured()) {
          initMilitaryVesselStream();
        }
        const [flightData, vesselData] = await Promise.all([
          fetchMilitaryFlights(),
          fetchMilitaryVessels(),
        ]);
        this.ctx.intelligenceCache.military = {
          flights: flightData.flights,
          flightClusters: flightData.clusters,
          vessels: vesselData.vessels,
          vesselClusters: vesselData.clusters,
        };
        fetchUSNIFleetReport().then((report) => {
          if (report) this.ctx.intelligenceCache.usniFleet = report;
        }).catch(() => {});
        ingestFlights(flightData.flights);
        ingestVessels(vesselData.vessels);
        ingestMilitaryForCII(flightData.flights, vesselData.vessels);
        updateEventCorrelationSnapshot({
          flights: flightData.flights,
          vessels: vesselData.vessels,
        });
        signalAggregator.ingestFlights(flightData.flights);
        signalAggregator.ingestVessels(vesselData.vessels);
        dataFreshness.recordUpdate('opensky', flightData.flights.length);
        updateAndCheck([
          { type: 'military_flights', region: 'global', count: flightData.flights.length },
          { type: 'vessels', region: 'global', count: vesselData.vessels.length },
        ]).then(anomalies => {
          if (anomalies.length > 0) signalAggregator.ingestTemporalAnomalies(anomalies);
        }).catch(() => { });
        if (this.ctx.mapLayers.military) {
          this.ctx.map?.setMilitaryFlights(flightData.flights, flightData.clusters);
          this.ctx.map?.setMilitaryVessels(vesselData.vessels, vesselData.clusters);
          this.ctx.map?.updateMilitaryForEscalation(flightData.flights, vesselData.vessels);
          const militaryCount = flightData.flights.length + vesselData.vessels.length;
          this.ctx.statusPanel?.updateFeed('Military', {
            status: militaryCount > 0 ? 'ok' : 'warning',
            itemCount: militaryCount,
          });
        }
        if (!isInLearningMode()) {
          const surgeAlerts = analyzeFlightsForSurge(flightData.flights);
          if (surgeAlerts.length > 0) {
            const surgeSignals = surgeAlerts.map(surgeAlertToSignal);
            addToSignalHistory(surgeSignals);
            if (this.shouldShowIntelligenceNotifications()) this.ctx.signalModal?.show(surgeSignals);
          }
          const foreignAlerts = detectForeignMilitaryPresence(flightData.flights);
          if (foreignAlerts.length > 0) {
            const foreignSignals = foreignAlerts.map(foreignPresenceToSignal);
            addToSignalHistory(foreignSignals);
            if (this.shouldShowIntelligenceNotifications()) this.ctx.signalModal?.show(foreignSignals);
          }
        }
      } catch (error) {
        console.error('[Intelligence] Military fetch failed:', error);
        dataFreshness.recordError('opensky', String(error));
      }
    })());

    tasks.push((async () => {
      try {
        const protestEvents = await protestsTask;
        let result = await fetchUcdpEvents();
        for (let attempt = 1; attempt < 3 && !result.success; attempt++) {
          await new Promise(r => setTimeout(r, 15_000));
          result = await fetchUcdpEvents();
        }
        if (!result.success) {
          dataFreshness.recordError('ucdp_events', 'UCDP events unavailable (retaining prior event state)');
          return;
        }
        const acledEvents = protestEvents.map(e => ({
          latitude: e.lat, longitude: e.lon, event_date: e.time.toISOString(), fatalities: e.fatalities ?? 0,
        }));
        const events = deduplicateAgainstAcled(result.data, acledEvents);
        (this.ctx.panels['ucdp-events'] as UcdpEventsPanel)?.setEvents(events);
        if (this.ctx.mapLayers.ucdpEvents) {
          this.ctx.map?.setUcdpEvents(events);
        }
        if (events.length > 0) dataFreshness.recordUpdate('ucdp_events', events.length);
      } catch (error) {
        console.error('[Intelligence] UCDP events fetch failed:', error);
        dataFreshness.recordError('ucdp_events', String(error));
      }
    })());

    tasks.push((async () => {
      try {
        const unhcrResult = await fetchUnhcrPopulation();
        if (!unhcrResult.ok) {
          dataFreshness.recordError('unhcr', 'UNHCR displacement unavailable (retaining prior displacement state)');
          return;
        }
        const data = unhcrResult.data;
        (this.ctx.panels['displacement'] as DisplacementPanel)?.setData(data);
        ingestDisplacementForCII(data.countries);
        if (this.ctx.mapLayers.displacement && data.topFlows) {
          this.ctx.map?.setDisplacementFlows(data.topFlows);
        }
        if (data.countries.length > 0) dataFreshness.recordUpdate('unhcr', data.countries.length);
      } catch (error) {
        console.error('[Intelligence] UNHCR displacement fetch failed:', error);
        dataFreshness.recordError('unhcr', String(error));
      }
    })());

    tasks.push((async () => {
      try {
        const climateResult = await fetchClimateAnomalies();
        if (!climateResult.ok) {
          dataFreshness.recordError('climate', 'Climate anomalies unavailable (retaining prior climate state)');
          return;
        }
        const anomalies = climateResult.anomalies;
        (this.ctx.panels['climate'] as ClimateAnomalyPanel)?.setAnomalies(anomalies);
        ingestClimateForCII(anomalies);
        if (this.ctx.mapLayers.climate) {
          this.ctx.map?.setClimateAnomalies(anomalies);
        }
        if (anomalies.length > 0) dataFreshness.recordUpdate('climate', anomalies.length);
      } catch (error) {
        console.error('[Intelligence] Climate anomalies fetch failed:', error);
        dataFreshness.recordError('climate', String(error));
      }
    })());

    tasks.push(this.refreshGlintIntelligence());

    tasks.push((async () => {
      try {
        await this.loadIranEventsSignals();
      } catch (error) {
        console.error('[Intelligence] Iran events fetch failed:', error);
      }
    })());

    tasks.push((async () => {
      try {
        await this.loadGpsJammingSignals();
      } catch (error) {
        console.error('[Intelligence] GPS jamming fetch failed:', error);
      }
    })());

    tasks.push((async () => {
      try {
        await this.loadResearchSignals();
      } catch (error) {
        console.error('[Intelligence] Research fetch failed:', error);
      }
    })());

    tasks.push((async () => {
      try {
        await this.loadMilitaryBasesSignals();
      } catch (error) {
        console.error('[Intelligence] Military bases fetch failed:', error);
      }
    })());

    await Promise.allSettled(tasks);

    try {
      const ucdpEvts = (this.ctx.panels['ucdp-events'] as UcdpEventsPanel)?.getEvents?.() || [];
      const events = [
        ...(this.ctx.intelligenceCache.protests?.events || []).slice(0, 10).map(e => ({
          id: e.id, lat: e.lat, lon: e.lon, type: 'conflict' as const, name: e.title || 'Protest',
        })),
        ...ucdpEvts.slice(0, 10).map(e => ({
          id: e.id, lat: e.latitude, lon: e.longitude, type: e.type_of_violence as string, name: `${e.side_a} vs ${e.side_b}`,
        })),
      ];
      if (events.length > 0) {
        const exposures = await enrichEventsWithExposure(events);
        (this.ctx.panels['population-exposure'] as PopulationExposurePanel)?.setExposures(exposures);
        if (exposures.length > 0) dataFreshness.recordUpdate('worldpop', exposures.length);
      } else {
        (this.ctx.panels['population-exposure'] as PopulationExposurePanel)?.setExposures([]);
      }
    } catch (error) {
      console.error('[Intelligence] Population exposure fetch failed:', error);
      dataFreshness.recordError('worldpop', String(error));
    }

    (this.ctx.panels['cii'] as CIIPanel)?.refresh();
    console.log('[Intelligence] All signals loaded for CII calculation');
  }

  async loadOutages(): Promise<void> {
    if (this.ctx.intelligenceCache.outages) {
      const outages = this.ctx.intelligenceCache.outages;
      this.ctx.map?.setOutages(outages);
      this.ctx.map?.setLayerReady('outages', outages.length > 0);
      this.ctx.statusPanel?.updateFeed('NetBlocks', { status: 'ok', itemCount: outages.length });
      return;
    }
    try {
      const outages = await fetchInternetOutages();
      this.ctx.intelligenceCache.outages = outages;
      this.ctx.map?.setOutages(outages);
      this.ctx.map?.setLayerReady('outages', outages.length > 0);
      ingestOutagesForCII(outages);
      signalAggregator.ingestOutages(outages);
      this.ctx.statusPanel?.updateFeed('NetBlocks', { status: 'ok', itemCount: outages.length });
      dataFreshness.recordUpdate('outages', outages.length);
    } catch (error) {
      this.ctx.map?.setLayerReady('outages', false);
      this.ctx.statusPanel?.updateFeed('NetBlocks', { status: 'error' });
      dataFreshness.recordError('outages', String(error));
    }
  }

  async loadCyberThreats(): Promise<void> {
    if (!CYBER_LAYER_ENABLED) {
      this.ctx.mapLayers.cyberThreats = false;
      this.ctx.map?.setLayerReady('cyberThreats', false);
      return;
    }

    if (this.ctx.cyberThreatsCache) {
      this.ctx.map?.setCyberThreats(this.ctx.cyberThreatsCache);
      this.ctx.map?.setLayerReady('cyberThreats', this.ctx.cyberThreatsCache.length > 0);
      this.ctx.statusPanel?.updateFeed('Cyber Threats', { status: 'ok', itemCount: this.ctx.cyberThreatsCache.length });
      return;
    }

    try {
      const threats = await fetchCyberThreats({ limit: 500, days: 14 });
      this.ctx.cyberThreatsCache = threats;
      this.ctx.map?.setCyberThreats(threats);
      this.ctx.map?.setLayerReady('cyberThreats', threats.length > 0);
      this.ctx.statusPanel?.updateFeed('Cyber Threats', { status: 'ok', itemCount: threats.length });
      this.ctx.statusPanel?.updateApi('Cyber Threats API', { status: 'ok' });
      dataFreshness.recordUpdate('cyber_threats', threats.length);
    } catch (error) {
      this.ctx.map?.setLayerReady('cyberThreats', false);
      this.ctx.statusPanel?.updateFeed('Cyber Threats', { status: 'error', errorMessage: String(error) });
      this.ctx.statusPanel?.updateApi('Cyber Threats API', { status: 'error' });
      dataFreshness.recordError('cyber_threats', String(error));
    }
  }

  async loadAisSignals(): Promise<void> {
    try {
      const { disruptions, density } = await fetchAisSignals();
      const mergedDisruptions = dedupeAisDisruptions([
        ...disruptions,
        ...this.portWatchOverlayDisruptions,
      ]);
      const mergedDensity = dedupeAisDensity([
        ...density,
        ...this.portWatchOverlayDensity,
      ]);
      const aisStatus = getAisStatus();
      console.log('[Ships] Events:', {
        disruptions: mergedDisruptions.length,
        density: mergedDensity.length,
        vessels: aisStatus.vessels,
      });
      this.ctx.map?.setAisData(mergedDisruptions, mergedDensity);
      updateEventCorrelationSnapshot({
        disruptions: mergedDisruptions,
        density: mergedDensity,
      });
      ingestAisForCII(mergedDisruptions, mergedDensity);
      this.refreshCiiPanelDebounced();
      signalAggregator.ingestAisDisruptions(mergedDisruptions);
      updateAndCheck([
        { type: 'ais_gaps', region: 'global', count: mergedDisruptions.length },
      ]).then(anomalies => {
        if (anomalies.length > 0) signalAggregator.ingestTemporalAnomalies(anomalies);
      }).catch(() => { });

      const hasData = mergedDisruptions.length > 0 || mergedDensity.length > 0;
      this.ctx.map?.setLayerReady('ais', hasData);

      const shippingCount = mergedDisruptions.length + mergedDensity.length;
      const shippingStatus = shippingCount > 0 ? 'ok' : (aisStatus.connected ? 'warning' : 'error');
      this.ctx.statusPanel?.updateFeed('Shipping', {
        status: shippingStatus,
        itemCount: shippingCount,
        errorMessage: !aisStatus.connected && shippingCount === 0 ? 'AIS snapshot unavailable' : undefined,
      });
      this.ctx.statusPanel?.updateApi('AISStream', {
        status: aisStatus.connected ? 'ok' : 'warning',
      });
      if (hasData) {
        dataFreshness.recordUpdate('ais', shippingCount);
      }
    } catch (error) {
      this.ctx.map?.setLayerReady('ais', false);
      this.ctx.statusPanel?.updateFeed('Shipping', { status: 'error', errorMessage: String(error) });
      this.ctx.statusPanel?.updateApi('AISStream', { status: 'error' });
      dataFreshness.recordError('ais', String(error));
    }
  }

  waitForAisData(): void {
    const maxAttempts = 30;
    let attempts = 0;

    const checkData = () => {
      if (this.ctx.isDestroyed) return;
      attempts++;
      const status = getAisStatus();

      if (status.vessels > 0 || status.connected) {
        this.loadAisSignals();
        this.ctx.map?.setLayerLoading('ais', false);
        return;
      }

      if (attempts >= maxAttempts) {
        this.ctx.map?.setLayerLoading('ais', false);
        this.ctx.map?.setLayerReady('ais', false);
        this.ctx.statusPanel?.updateFeed('Shipping', {
          status: 'error',
          errorMessage: 'Connection timeout'
        });
        return;
      }

      setTimeout(checkData, 1000);
    };

    checkData();
  }

  async loadCableActivity(): Promise<void> {
    try {
      const activity = await fetchCableActivity();
      this.ctx.map?.setCableActivity(activity.advisories, activity.repairShips);
      const itemCount = activity.advisories.length + activity.repairShips.length;
      this.ctx.statusPanel?.updateFeed('CableOps', { status: 'ok', itemCount });
    } catch {
      this.ctx.statusPanel?.updateFeed('CableOps', { status: 'error' });
    }
  }

  async loadCableHealth(): Promise<void> {
    try {
      const healthData = await fetchCableHealth();
      this.ctx.map?.setCableHealth(healthData.cables);
      const cableIds = Object.keys(healthData.cables);
      const faultCount = cableIds.filter((id) => healthData.cables[id]?.status === 'fault').length;
      const degradedCount = cableIds.filter((id) => healthData.cables[id]?.status === 'degraded').length;
      this.ctx.statusPanel?.updateFeed('CableHealth', { status: 'ok', itemCount: faultCount + degradedCount });
    } catch {
      this.ctx.statusPanel?.updateFeed('CableHealth', { status: 'error' });
    }
  }

  async loadProtests(): Promise<void> {
    if (this.ctx.intelligenceCache.protests) {
      const protestData = this.ctx.intelligenceCache.protests;
      this.ctx.map?.setProtests(protestData.events);
      this.ctx.map?.setLayerReady('protests', protestData.events.length > 0);
      const status = getProtestStatus();
      this.ctx.statusPanel?.updateFeed('Protests', {
        status: 'ok',
        itemCount: protestData.events.length,
        errorMessage: status.acledConfigured === false ? 'ACLED not configured - using GDELT only' : undefined,
      });
      if (status.acledConfigured === true) {
        this.ctx.statusPanel?.updateApi('ACLED', { status: 'ok' });
      } else if (status.acledConfigured === null) {
        this.ctx.statusPanel?.updateApi('ACLED', { status: 'warning' });
      }
      this.ctx.statusPanel?.updateApi('GDELT Doc', { status: 'ok' });
      if (protestData.sources.gdelt > 0) dataFreshness.recordUpdate('gdelt_doc', protestData.sources.gdelt);
      return;
    }
    try {
      const protestData = await fetchProtestEvents();
      this.ctx.intelligenceCache.protests = protestData;
      this.ctx.map?.setProtests(protestData.events);
      this.ctx.map?.setLayerReady('protests', protestData.events.length > 0);
      ingestProtests(protestData.events);
      ingestProtestsForCII(protestData.events);
      signalAggregator.ingestProtests(protestData.events);
      const protestCount = protestData.sources.acled + protestData.sources.gdelt;
      if (protestCount > 0) dataFreshness.recordUpdate('acled', protestCount);
      if (protestData.sources.gdelt > 0) dataFreshness.recordUpdate('gdelt', protestData.sources.gdelt);
      if (protestData.sources.gdelt > 0) dataFreshness.recordUpdate('gdelt_doc', protestData.sources.gdelt);
      (this.ctx.panels['cii'] as CIIPanel)?.refresh();
      const status = getProtestStatus();
      this.ctx.statusPanel?.updateFeed('Protests', {
        status: 'ok',
        itemCount: protestData.events.length,
        errorMessage: status.acledConfigured === false ? 'ACLED not configured - using GDELT only' : undefined,
      });
      if (status.acledConfigured === true) {
        this.ctx.statusPanel?.updateApi('ACLED', { status: 'ok' });
      } else if (status.acledConfigured === null) {
        this.ctx.statusPanel?.updateApi('ACLED', { status: 'warning' });
      }
      this.ctx.statusPanel?.updateApi('GDELT Doc', { status: 'ok' });
    } catch (error) {
      this.ctx.map?.setLayerReady('protests', false);
      this.ctx.statusPanel?.updateFeed('Protests', { status: 'error', errorMessage: String(error) });
      this.ctx.statusPanel?.updateApi('ACLED', { status: 'error' });
      this.ctx.statusPanel?.updateApi('GDELT Doc', { status: 'error' });
      dataFreshness.recordError('gdelt_doc', String(error));
    }
  }

  async loadFlightDelays(): Promise<void> {
    try {
      const delays = await fetchFlightDelays();
      this.ctx.map?.setFlightDelays(delays);
      this.ctx.map?.setLayerReady('flights', delays.length > 0);
      this.ctx.statusPanel?.updateFeed('Flights', {
        status: 'ok',
        itemCount: delays.length,
      });
      this.ctx.statusPanel?.updateApi('FAA', { status: 'ok' });
    } catch (error) {
      this.ctx.map?.setLayerReady('flights', false);
      this.ctx.statusPanel?.updateFeed('Flights', { status: 'error', errorMessage: String(error) });
      this.ctx.statusPanel?.updateApi('FAA', { status: 'error' });
    }
  }

  async loadMilitary(): Promise<void> {
    if (this.ctx.intelligenceCache.military) {
      const { flights, flightClusters, vessels, vesselClusters } = this.ctx.intelligenceCache.military;
      this.ctx.map?.setMilitaryFlights(flights, flightClusters);
      this.ctx.map?.setMilitaryVessels(vessels, vesselClusters);
      this.ctx.map?.updateMilitaryForEscalation(flights, vessels);
      updateEventCorrelationSnapshot({
        flights,
        vessels,
      });
      this.loadCachedPosturesForBanner();
      const insightsPanel = this.ctx.panels['insights'] as InsightsPanel | undefined;
      insightsPanel?.setMilitaryFlights(flights);
      const hasData = flights.length > 0 || vessels.length > 0;
      this.ctx.map?.setLayerReady('military', hasData);
      const militaryCount = flights.length + vessels.length;
      this.ctx.statusPanel?.updateFeed('Military', {
        status: militaryCount > 0 ? 'ok' : 'warning',
        itemCount: militaryCount,
        errorMessage: militaryCount === 0 ? 'No military activity in view' : undefined,
      });
      this.ctx.statusPanel?.updateApi('OpenSky', { status: 'ok' });
      return;
    }
    try {
      if (isMilitaryVesselTrackingConfigured()) {
        initMilitaryVesselStream();
      }
      const [flightData, vesselData] = await Promise.all([
        fetchMilitaryFlights(),
        fetchMilitaryVessels(),
      ]);
      this.ctx.intelligenceCache.military = {
        flights: flightData.flights,
        flightClusters: flightData.clusters,
        vessels: vesselData.vessels,
        vesselClusters: vesselData.clusters,
      };
      fetchUSNIFleetReport().then((report) => {
        if (report) this.ctx.intelligenceCache.usniFleet = report;
      }).catch(() => {});
      this.ctx.map?.setMilitaryFlights(flightData.flights, flightData.clusters);
      this.ctx.map?.setMilitaryVessels(vesselData.vessels, vesselData.clusters);
      updateEventCorrelationSnapshot({
        flights: flightData.flights,
        vessels: vesselData.vessels,
      });
      ingestFlights(flightData.flights);
      ingestVessels(vesselData.vessels);
      ingestMilitaryForCII(flightData.flights, vesselData.vessels);
      signalAggregator.ingestFlights(flightData.flights);
      signalAggregator.ingestVessels(vesselData.vessels);
      updateAndCheck([
        { type: 'military_flights', region: 'global', count: flightData.flights.length },
        { type: 'vessels', region: 'global', count: vesselData.vessels.length },
      ]).then(anomalies => {
        if (anomalies.length > 0) signalAggregator.ingestTemporalAnomalies(anomalies);
      }).catch(() => { });
      this.ctx.map?.updateMilitaryForEscalation(flightData.flights, vesselData.vessels);
      (this.ctx.panels['cii'] as CIIPanel)?.refresh();
      if (!isInLearningMode()) {
        const surgeAlerts = analyzeFlightsForSurge(flightData.flights);
        if (surgeAlerts.length > 0) {
          const surgeSignals = surgeAlerts.map(surgeAlertToSignal);
          addToSignalHistory(surgeSignals);
          if (this.shouldShowIntelligenceNotifications()) this.ctx.signalModal?.show(surgeSignals);
        }
        const foreignAlerts = detectForeignMilitaryPresence(flightData.flights);
        if (foreignAlerts.length > 0) {
          const foreignSignals = foreignAlerts.map(foreignPresenceToSignal);
          addToSignalHistory(foreignSignals);
          if (this.shouldShowIntelligenceNotifications()) this.ctx.signalModal?.show(foreignSignals);
        }
      }

      this.loadCachedPosturesForBanner();
      const insightsPanel = this.ctx.panels['insights'] as InsightsPanel | undefined;
      insightsPanel?.setMilitaryFlights(flightData.flights);

      const hasData = flightData.flights.length > 0 || vesselData.vessels.length > 0;
      this.ctx.map?.setLayerReady('military', hasData);
      const militaryCount = flightData.flights.length + vesselData.vessels.length;
      this.ctx.statusPanel?.updateFeed('Military', {
        status: militaryCount > 0 ? 'ok' : 'warning',
        itemCount: militaryCount,
        errorMessage: militaryCount === 0 ? 'No military activity in view' : undefined,
      });
      this.ctx.statusPanel?.updateApi('OpenSky', { status: 'ok' });
      dataFreshness.recordUpdate('opensky', flightData.flights.length);
    } catch (error) {
      this.ctx.map?.setLayerReady('military', false);
      this.ctx.statusPanel?.updateFeed('Military', { status: 'error', errorMessage: String(error) });
      this.ctx.statusPanel?.updateApi('OpenSky', { status: 'error' });
      dataFreshness.recordError('opensky', String(error));
    }
  }

  private async loadCachedPosturesForBanner(): Promise<void> {
    try {
      const data = await fetchCachedTheaterPosture();
      if (data && data.postures.length > 0) {
        this.callbacks.renderCriticalBanner(data.postures);
        const posturePanel = this.ctx.panels['strategic-posture'] as StrategicPosturePanel | undefined;
        posturePanel?.updatePostures(data);
      }
    } catch (error) {
      console.warn('[App] Failed to load cached postures for banner:', error);
    }
  }

  async loadFredData(): Promise<void> {
    const economicPanel = this.ctx.panels['economic'] as EconomicPanel;
    const cbInfo = getCircuitBreakerCooldownInfo('FRED Economic');
    if (cbInfo.onCooldown) {
      economicPanel?.setErrorState(true, `Temporarily unavailable (retry in ${cbInfo.remainingSeconds}s)`);
      this.ctx.statusPanel?.updateApi('FRED', { status: 'error' });
      return;
    }

    try {
      economicPanel?.setLoading(true);
      const data = await fetchFredData();

      const postInfo = getCircuitBreakerCooldownInfo('FRED Economic');
      if (postInfo.onCooldown) {
        economicPanel?.setErrorState(true, `Temporarily unavailable (retry in ${postInfo.remainingSeconds}s)`);
        this.ctx.statusPanel?.updateApi('FRED', { status: 'error' });
        return;
      }

      if (data.length === 0) {
        if (!isFeatureAvailable('economicFred')) {
          economicPanel?.setErrorState(true, 'FRED_API_KEY not configured - add in Settings');
          this.ctx.statusPanel?.updateApi('FRED', { status: 'error' });
          return;
        }
        economicPanel?.showRetrying();
        await new Promise(r => setTimeout(r, 20_000));
        const retryData = await fetchFredData();
        if (retryData.length === 0) {
          economicPanel?.setErrorState(true, 'FRED data temporarily unavailable - will retry');
          this.ctx.statusPanel?.updateApi('FRED', { status: 'error' });
          return;
        }
        economicPanel?.setErrorState(false);
        economicPanel?.update(retryData);
        this.ctx.statusPanel?.updateApi('FRED', { status: 'ok' });
        dataFreshness.recordUpdate('economic', retryData.length);
        return;
      }

      economicPanel?.setErrorState(false);
      economicPanel?.update(data);
      this.ctx.statusPanel?.updateApi('FRED', { status: 'ok' });
      dataFreshness.recordUpdate('economic', data.length);
    } catch {
      if (isFeatureAvailable('economicFred')) {
        economicPanel?.showRetrying();
        try {
          await new Promise(r => setTimeout(r, 20_000));
          const retryData = await fetchFredData();
          if (retryData.length > 0) {
            economicPanel?.setErrorState(false);
            economicPanel?.update(retryData);
            this.ctx.statusPanel?.updateApi('FRED', { status: 'ok' });
            dataFreshness.recordUpdate('economic', retryData.length);
            return;
          }
        } catch { /* fall through */ }
      }
      this.ctx.statusPanel?.updateApi('FRED', { status: 'error' });
      economicPanel?.setErrorState(true, 'FRED data temporarily unavailable - will retry');
      economicPanel?.setLoading(false);
    }
  }

  async loadOilAnalytics(): Promise<void> {
    const economicPanel = this.ctx.panels['economic'] as EconomicPanel;
    try {
      const data = await fetchOilAnalytics();
      economicPanel?.updateOil(data);
      const hasData = !!(data.wtiPrice || data.brentPrice || data.usProduction || data.usInventory);
      this.ctx.statusPanel?.updateApi('EIA', { status: hasData ? 'ok' : 'error' });
      if (hasData) {
        const metricCount = [data.wtiPrice, data.brentPrice, data.usProduction, data.usInventory].filter(Boolean).length;
        dataFreshness.recordUpdate('oil', metricCount || 1);
      } else {
        dataFreshness.recordError('oil', 'Oil analytics returned no values');
      }
    } catch (e) {
      console.error('[App] Oil analytics failed:', e);
      this.ctx.statusPanel?.updateApi('EIA', { status: 'error' });
      dataFreshness.recordError('oil', String(e));
    }
  }

  async loadGovernmentSpending(): Promise<void> {
    const economicPanel = this.ctx.panels['economic'] as EconomicPanel;
    try {
      const data = await fetchRecentAwards({ daysBack: 7, limit: 15 });
      economicPanel?.updateSpending(data);
      this.ctx.statusPanel?.updateApi('USASpending', { status: data.awards.length > 0 ? 'ok' : 'error' });
      if (data.awards.length > 0) {
        dataFreshness.recordUpdate('spending', data.awards.length);
      } else {
        dataFreshness.recordError('spending', 'No awards returned');
      }
    } catch (e) {
      console.error('[App] Government spending failed:', e);
      this.ctx.statusPanel?.updateApi('USASpending', { status: 'error' });
      dataFreshness.recordError('spending', String(e));
    }
  }

  async loadBisData(): Promise<void> {
    const economicPanel = this.ctx.panels['economic'] as EconomicPanel;
    try {
      const data = await fetchBisData();
      economicPanel?.updateBis(data);
      const hasData = data.policyRates.length > 0;
      this.ctx.statusPanel?.updateApi('BIS', { status: hasData ? 'ok' : 'error' });
      if (hasData) {
        dataFreshness.recordUpdate('bis', data.policyRates.length);
      }
    } catch (e) {
      console.error('[App] BIS data failed:', e);
      this.ctx.statusPanel?.updateApi('BIS', { status: 'error' });
      dataFreshness.recordError('bis', String(e));
    }
  }

  async loadTradePolicy(): Promise<void> {
    const tradePanel = this.ctx.panels['trade-policy'] as TradePolicyPanel | undefined;
    if (!tradePanel) return;

    try {
      const [restrictions, tariffs, flows, barriers] = await Promise.all([
        fetchTradeRestrictions([], 50),
        fetchTariffTrends('840', '156', '', 10),
        fetchTradeFlows('840', '156', 10),
        fetchTradeBarriers([], '', 50),
      ]);

      tradePanel.updateRestrictions(restrictions);
      tradePanel.updateTariffs(tariffs);
      tradePanel.updateFlows(flows);
      tradePanel.updateBarriers(barriers);

      const totalItems = restrictions.restrictions.length + tariffs.datapoints.length + flows.flows.length + barriers.barriers.length;
      const anyUnavailable = restrictions.upstreamUnavailable || tariffs.upstreamUnavailable || flows.upstreamUnavailable || barriers.upstreamUnavailable;

      this.ctx.statusPanel?.updateApi('WTO', { status: anyUnavailable ? 'warning' : totalItems > 0 ? 'ok' : 'error' });

      if (totalItems > 0) {
        dataFreshness.recordUpdate('wto_trade', totalItems);
      } else if (anyUnavailable) {
        dataFreshness.recordError('wto_trade', 'WTO upstream temporarily unavailable');
      }
    } catch (e) {
      console.error('[App] Trade policy failed:', e);
      this.ctx.statusPanel?.updateApi('WTO', { status: 'error' });
      dataFreshness.recordError('wto_trade', String(e));
    }
  }

  async loadSupplyChain(): Promise<void> {
    const scPanel = this.ctx.panels['supply-chain'] as SupplyChainPanel | undefined;
    if (!scPanel) return;

    try {
      const [shipping, chokepoints, minerals, portWatch] = await Promise.allSettled([
        fetchShippingRates(),
        fetchChokepointStatus(),
        fetchCriticalMinerals(),
        fetchPortWatchSnapshot(),
      ]);

      const shippingData = shipping.status === 'fulfilled' ? shipping.value : null;
      const chokepointData = chokepoints.status === 'fulfilled' ? chokepoints.value : null;
      const mineralsData = minerals.status === 'fulfilled' ? minerals.value : null;
      const portWatchData = portWatch.status === 'fulfilled' ? portWatch.value : null;

      if (shippingData) scPanel.updateShippingRates(shippingData);
      if (chokepointData) scPanel.updateChokepointStatus(chokepointData);
      if (mineralsData) scPanel.updateCriticalMinerals(mineralsData);

      let portWatchCount = 0;
      if (portWatchData) {
        const overlays = toPortWatchAisOverlays(portWatchData);
        this.portWatchOverlayDisruptions = overlays.disruptions;
        this.portWatchOverlayDensity = overlays.density;
        portWatchCount = overlays.disruptions.length + overlays.density.length;
        this.ctx.statusPanel?.updateApi('PortWatch', {
          status: portWatchData.upstreamUnavailable ? 'warning' : portWatchCount > 0 ? 'ok' : 'warning',
        });
        if (portWatchCount > 0) {
          dataFreshness.recordUpdate('portwatch', portWatchCount);
        } else if (portWatchData.upstreamUnavailable) {
          dataFreshness.recordError('portwatch', 'PortWatch upstream unavailable');
        }
        if (this.ctx.mapLayers.ais) {
          void this.loadAisSignals();
        }
      } else {
        this.ctx.statusPanel?.updateApi('PortWatch', { status: 'error' });
        dataFreshness.recordError('portwatch', 'PortWatch fetch failed');
      }

      const totalItems = (shippingData?.indices.length || 0)
        + (chokepointData?.chokepoints.length || 0)
        + (mineralsData?.minerals.length || 0)
        + portWatchCount;
      const anyUnavailable = Boolean(
        shippingData?.upstreamUnavailable
        || chokepointData?.upstreamUnavailable
        || mineralsData?.upstreamUnavailable
        || portWatchData?.upstreamUnavailable,
      );

      this.ctx.statusPanel?.updateApi('SupplyChain', { status: anyUnavailable ? 'warning' : totalItems > 0 ? 'ok' : 'error' });

      if (totalItems > 0) {
        dataFreshness.recordUpdate('supply_chain', totalItems);
      } else if (anyUnavailable) {
        dataFreshness.recordError('supply_chain', 'Supply chain upstream temporarily unavailable');
      }
    } catch (e) {
      console.error('[App] Supply chain failed:', e);
      this.ctx.statusPanel?.updateApi('SupplyChain', { status: 'error' });
      this.ctx.statusPanel?.updateApi('PortWatch', { status: 'error' });
      dataFreshness.recordError('portwatch', String(e));
      dataFreshness.recordError('supply_chain', String(e));
    }
  }

  updateMonitorResults(): void {
    const monitorPanel = this.ctx.panels['monitors'] as MonitorPanel;
    monitorPanel.renderResults(this.ctx.allNews);
  }

  private async clusterNewsWithFallback(items: NewsItem[]): Promise<Awaited<ReturnType<typeof clusterNewsHybrid>>> {
    try {
      return mlWorker.isAvailable
        ? await clusterNewsHybrid(items)
        : await analysisWorker.clusterNews(items);
    } catch (error) {
      console.warn('[DataLoader] Worker clustering failed, falling back to main thread:', error);
      return clusterNews(items);
    }
  }

  private async analyzeCorrelationsWithFallback(): Promise<ReturnType<typeof analyzeCorrelations>> {
    try {
      return await analysisWorker.analyzeCorrelations(
        this.ctx.latestClusters,
        this.ctx.latestPredictions,
        this.ctx.latestMarkets
      );
    } catch (error) {
      console.warn('[DataLoader] Worker correlation failed, falling back to main thread:', error);
      return analyzeCorrelations(
        this.ctx.latestClusters,
        this.ctx.latestPredictions,
        this.ctx.latestMarkets
      );
    }
  }

  async runCorrelationAnalysis(): Promise<void> {
    try {
      if (this.ctx.latestClusters.length === 0 && this.ctx.allNews.length > 0) {
        this.ctx.latestClusters = await this.clusterNewsWithFallback(this.ctx.allNews);
        this.ctx.latestClusters = annotateClustersWithRelations(this.ctx.latestClusters);
      }

      if (this.ctx.latestClusters.length > 0) {
        ingestNewsForCII(this.ctx.latestClusters);
        dataFreshness.recordUpdate('gdelt', this.ctx.latestClusters.length);
        (this.ctx.panels['cii'] as CIIPanel)?.refresh();
      }

      const signals = await this.analyzeCorrelationsWithFallback();

      let geoSignals: ReturnType<typeof geoConvergenceToSignal>[] = [];
      if (!isInLearningMode()) {
        const geoAlerts = detectGeoConvergence(this.ctx.seenGeoAlerts);
        geoSignals = geoAlerts.map(geoConvergenceToSignal);
      }

      const keywordSpikeSignals = drainTrendingSignals();
      const allSignals = [...signals, ...geoSignals, ...keywordSpikeSignals];
      if (allSignals.length > 0) {
        addToSignalHistory(allSignals);
        if (this.shouldShowIntelligenceNotifications()) this.ctx.signalModal?.show(allSignals);
      }
    } catch (error) {
      console.error('[App] Correlation analysis failed:', error);
    }
  }

  async loadFirmsData(): Promise<void> {
    try {
      const fireResult = await fetchAllFires(1);
      if (fireResult.skipped) {
        this.ctx.panels['satellite-fires']?.showConfigError('NASA_FIRMS_API_KEY not configured - add in Settings');
        this.ctx.statusPanel?.updateApi('FIRMS', { status: 'error' });
        return;
      }
      const { regions, totalCount } = fireResult;
      if (totalCount > 0) {
        const flat = flattenFires(regions);
        const stats = computeRegionStats(regions);

        signalAggregator.ingestSatelliteFires(flat.map(f => ({
          lat: f.location?.latitude ?? 0,
          lon: f.location?.longitude ?? 0,
          brightness: f.brightness,
          frp: f.frp,
          region: f.region,
          acq_date: new Date(f.detectedAt).toISOString().slice(0, 10),
        })));

        this.ctx.map?.setFires(toMapFires(flat));

        (this.ctx.panels['satellite-fires'] as SatelliteFiresPanel)?.update(stats, totalCount);

        dataFreshness.recordUpdate('firms', totalCount);

        updateAndCheck([
          { type: 'satellite_fires', region: 'global', count: totalCount },
        ]).then(anomalies => {
          if (anomalies.length > 0) {
            signalAggregator.ingestTemporalAnomalies(anomalies);
          }
        }).catch(() => { });
      } else {
        (this.ctx.panels['satellite-fires'] as SatelliteFiresPanel)?.update([], 0);
      }
      this.ctx.statusPanel?.updateApi('FIRMS', { status: 'ok' });
    } catch (e) {
      console.warn('[App] FIRMS load failed:', e);
      (this.ctx.panels['satellite-fires'] as SatelliteFiresPanel)?.update([], 0);
      this.ctx.statusPanel?.updateApi('FIRMS', { status: 'error' });
      dataFreshness.recordError('firms', String(e));
    }
  }

  async loadPizzInt(): Promise<void> {
    try {
      const [status, tensions] = await Promise.all([
        fetchPizzIntStatus(),
        fetchGdeltTensions()
      ]);

      if (status.locationsMonitored === 0) {
        this.ctx.pizzintIndicator?.hide();
        this.ctx.statusPanel?.updateApi('PizzINT', { status: 'error' });
        dataFreshness.recordError('pizzint', 'No monitored locations returned');
        return;
      }

      this.ctx.pizzintIndicator?.show();
      this.ctx.pizzintIndicator?.updateStatus(status);
      this.ctx.pizzintIndicator?.updateTensions(tensions);
      this.ctx.statusPanel?.updateApi('PizzINT', { status: 'ok' });
      dataFreshness.recordUpdate('pizzint', Math.max(status.locationsMonitored, tensions.length));
    } catch (error) {
      console.error('[App] PizzINT load failed:', error);
      this.ctx.pizzintIndicator?.hide();
      this.ctx.statusPanel?.updateApi('PizzINT', { status: 'error' });
      dataFreshness.recordError('pizzint', String(error));
    }
  }

  async refreshTemporalBaseline(): Promise<void> {
    try {
      const protests = this.ctx.intelligenceCache.protests?.events?.length ?? 0;
      const flights = this.ctx.intelligenceCache.military?.flights?.length ?? 0;
      const vessels = this.ctx.intelligenceCache.military?.vessels?.length ?? 0;
      const aisGaps = this.ctx.intelligenceCache.outages?.length ?? 0;

      const anomalies = await updateAndCheck([
        { type: 'protests', region: 'global', count: protests },
        { type: 'military_flights', region: 'global', count: flights },
        { type: 'vessels', region: 'global', count: vessels },
        { type: 'ais_gaps', region: 'global', count: aisGaps },
      ]);

      if (anomalies.length > 0) {
        signalAggregator.ingestTemporalAnomalies(anomalies);
      }
    } catch (error) {
      console.warn('[DataLoader] refreshTemporalBaseline failed:', error);
    }
  }

  async loadSecurityAdvisories(): Promise<void> {
    try {
      const result = await fetchSecurityAdvisories();
      if (!result.ok) return;

      this.ctx.intelligenceCache.advisories = result.advisories;
      const panel = this.ctx.panels['security-advisories'] as
        | { setData: (advisories: typeof result.advisories) => void }
        | undefined;
      panel?.setData(result.advisories);
    } catch (error) {
      console.warn('[DataLoader] loadSecurityAdvisories failed:', error);
    }
  }

  async loadTelegramIntel(): Promise<void> {
    const panel = this.ctx.panels['telegram-intel'] as
      | { setData?: (payload: unknown) => void }
      | undefined;
    if (!panel?.setData) return;

    try {
      const payload = await fetchTelegramFeed(80);
      panel.setData(payload);

      const items: NewsItem[] = (payload.items || []).map((item) => ({
        source: item.channelTitle || item.channel || 'Telegram',
        title: item.text,
        link: item.url,
        pubDate: new Date(item.ts),
        isAlert: item.earlySignal || item.topic === 'breaking' || item.topic === 'conflict',
      }));
      this.ctx.newsByCategory['telegram-intel'] = items;
      this.emitNewsTelemetry(this.getFlattenedNewsFromCategories());

      this.ctx.statusPanel?.updateFeed('Telegram', {
        status: payload.enabled ? 'ok' : 'warning',
        itemCount: payload.count ?? items.length,
        errorMessage: payload.enabled ? undefined : 'Telegram relay is disabled',
      });
    } catch (error) {
      console.error('[DataLoader] Telegram intel fetch failed:', error);
      this.ctx.statusPanel?.updateFeed('Telegram', {
        status: 'error',
        errorMessage: String(error),
      });
    }
  }

  syncDataFreshnessWithLayers(): void {
    for (const [layer, sourceIds] of Object.entries(LAYER_TO_SOURCE)) {
      const enabled = this.ctx.mapLayers[layer as keyof MapLayers] ?? false;
      for (const sourceId of sourceIds) {
        dataFreshness.setEnabled(sourceId as DataSourceId, enabled);
      }
    }

    if (!isAisConfigured()) {
      dataFreshness.setEnabled('ais', false);
    }
    if (isOutagesConfigured() === false) {
      dataFreshness.setEnabled('outages', false);
    }
  }

  private static readonly HAPPY_ITEMS_CACHE_KEY = 'happy-all-items';

  async hydrateHappyPanelsFromCache(): Promise<void> {
    try {
      type CachedItem = Omit<NewsItem, 'pubDate'> & { pubDate: number };
      const entry = await getPersistentCache<CachedItem[]>(DataLoaderManager.HAPPY_ITEMS_CACHE_KEY);
      if (!entry || !entry.data || entry.data.length === 0) return;
      if (Date.now() - entry.updatedAt > 24 * 60 * 60 * 1000) return;

      const items: NewsItem[] = entry.data.map(item => ({
        ...item,
        pubDate: new Date(item.pubDate),
      }));

      const scienceSources = ['GNN Science', 'ScienceDaily', 'Nature News', 'Live Science', 'New Scientist', 'Singularity Hub', 'Human Progress', 'Greater Good (Berkeley)'];
      this.ctx.breakthroughsPanel?.setItems(
        items.filter(item => scienceSources.includes(item.source) || item.happyCategory === 'science-health')
      );
      this.ctx.heroPanel?.setHeroStory(
        items.filter(item => item.happyCategory === 'humanity-kindness')
          .sort((a, b) => b.pubDate.getTime() - a.pubDate.getTime())[0]
      );
      this.ctx.digestPanel?.setStories(
        [...items].sort((a, b) => b.pubDate.getTime() - a.pubDate.getTime()).slice(0, 5)
      );
      this.ctx.positivePanel?.renderPositiveNews(items);
    } catch (err) {
      console.warn('[App] Happy panel cache hydration failed:', err);
    }
  }

  private async loadHappySupplementaryAndRender(): Promise<void> {
    if (!this.ctx.positivePanel) return;

    const curated = [...this.ctx.happyAllItems];
    this.ctx.positivePanel.renderPositiveNews(curated);

    let supplementary: NewsItem[] = [];
    try {
      const gdeltTopics = await fetchAllPositiveTopicIntelligence();
      const gdeltItems: NewsItem[] = gdeltTopics.flatMap(topic =>
        topic.articles.map(article => ({
          source: 'GDELT',
          title: article.title,
          link: article.url,
          pubDate: article.date ? new Date(article.date) : new Date(),
          isAlert: false,
          imageUrl: article.image || undefined,
          happyCategory: classifyNewsItem('GDELT', article.title),
        }))
      );

      supplementary = await filterBySentiment(gdeltItems);
    } catch (err) {
      console.warn('[App] Happy supplementary pipeline failed, using curated only:', err);
    }

    if (supplementary.length > 0) {
      const merged = [...curated, ...supplementary];
      merged.sort((a, b) => b.pubDate.getTime() - a.pubDate.getTime());
      this.ctx.positivePanel.renderPositiveNews(merged);
    }

    const scienceSources = ['GNN Science', 'ScienceDaily', 'Nature News', 'Live Science', 'New Scientist', 'Singularity Hub', 'Human Progress', 'Greater Good (Berkeley)'];
    const scienceItems = this.ctx.happyAllItems.filter(item =>
      scienceSources.includes(item.source) || item.happyCategory === 'science-health'
    );
    this.ctx.breakthroughsPanel?.setItems(scienceItems);

    const heroItem = this.ctx.happyAllItems
      .filter(item => item.happyCategory === 'humanity-kindness')
      .sort((a, b) => b.pubDate.getTime() - a.pubDate.getTime())[0];
    this.ctx.heroPanel?.setHeroStory(heroItem);

    const digestItems = [...this.ctx.happyAllItems]
      .sort((a, b) => b.pubDate.getTime() - a.pubDate.getTime())
      .slice(0, 5);
    this.ctx.digestPanel?.setStories(digestItems);

    setPersistentCache(
      DataLoaderManager.HAPPY_ITEMS_CACHE_KEY,
      this.ctx.happyAllItems.map(item => ({ ...item, pubDate: item.pubDate.getTime() }))
    ).catch(() => {});
  }

  private async loadPositiveEvents(): Promise<void> {
    const gdeltEvents = await fetchPositiveGeoEvents();
    const rssEvents = geocodePositiveNewsItems(
      this.ctx.happyAllItems.map(item => ({
        title: item.title,
        category: item.happyCategory,
      }))
    );
    const seen = new Set<string>();
    const merged = [...gdeltEvents, ...rssEvents].filter(e => {
      if (seen.has(e.name)) return false;
      seen.add(e.name);
      return true;
    });
    this.ctx.map?.setPositiveEvents(merged);
  }

  private loadKindnessData(): void {
    const kindnessItems = fetchKindnessData(
      this.ctx.happyAllItems.map(item => ({
        title: item.title,
        happyCategory: item.happyCategory,
      }))
    );
    this.ctx.map?.setKindnessData(kindnessItems);
  }

  private async loadProgressData(): Promise<void> {
    const datasets = await fetchProgressData();
    this.ctx.progressPanel?.setData(datasets);
  }

  private async loadSpeciesData(): Promise<void> {
    const species = await fetchConservationWins();
    this.ctx.speciesPanel?.setData(species);
    this.ctx.map?.setSpeciesRecoveryZones(species);
    if (SITE_VARIANT === 'happy' && species.length > 0) {
      checkMilestones({
        speciesRecoveries: species.map(s => ({ name: s.commonName, status: s.recoveryStatus })),
        newSpeciesCount: species.length,
      });
    }
  }

  private async loadRenewableData(): Promise<void> {
    const data = await fetchRenewableEnergyData();
    this.ctx.renewablePanel?.setData(data);
    if (SITE_VARIANT === 'happy' && data?.globalPercentage) {
      checkMilestones({
        renewablePercent: data.globalPercentage,
      });
    }
    try {
      const capacity = await fetchEnergyCapacity();
      this.ctx.renewablePanel?.setCapacityData(capacity);
    } catch {
      // EIA failure does not break the existing World Bank gauge
    }
  }
}
