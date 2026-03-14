import {
  registerApiDiscoveryCandidates,
  refreshApiSourceHealth,
  setApiSourceStatus,
  type ApiDiscoveryCandidate,
} from './api-source-registry';
import {
  addDiscoveredSource,
  setDiscoveredSourceStatus,
} from './source-registry';
import { getPersistentCache, setPersistentCache } from './persistent-cache';

type SeedTargetStatus = 'draft' | 'approved' | 'active';

interface CuratedApiSeed extends ApiDiscoveryCandidate {
  targetStatus: SeedTargetStatus;
}

interface CuratedFeedSeed {
  category: string;
  feedName: string;
  url: string;
  lang?: string;
  confidence: number;
  reason: string;
  topics?: string[];
  targetStatus: 'approved' | 'active';
}

interface SeedState {
  version: number;
  lastRunAt: number;
}

export interface CuratedSeedResult {
  apiRegistered: number;
  apiActivated: number;
  apiApproved: number;
  feedRegistered: number;
  feedActivated: number;
  feedApproved: number;
  ran: boolean;
}

const CURATED_SEED_STATE_KEY = 'curated-intel-source-seed:v1';
const CURATED_SEED_VERSION = 2;
const CURATED_SEED_INTERVAL_MS = 6 * 60 * 60 * 1000;

const CURATED_API_SOURCES: CuratedApiSeed[] = [
  {
    name: 'GDELT DOC 2.1',
    baseUrl: 'https://api.gdeltproject.org',
    sampleUrl:
      'https://api.gdeltproject.org/api/v2/doc/doc?query=(iran%20OR%20hormuz)&mode=artlist&format=json&maxrecords=20&sort=DateDesc',
    category: 'politics',
    confidence: 95,
    reason: 'Public global event/news API, JSON output',
    discoveredBy: 'manual',
    schemaHint: 'json',
    hasRateLimitInfo: true,
    hasTosInfo: true,
    targetStatus: 'active',
  },
  {
    name: 'OpenSanctions Search',
    baseUrl: 'https://api.opensanctions.org',
    sampleUrl: 'https://api.opensanctions.org/search/default?q=iran&limit=20',
    category: 'politics',
    confidence: 93,
    reason: 'Public sanctions/entity search API for risk intelligence',
    discoveredBy: 'manual',
    schemaHint: 'json',
    hasRateLimitInfo: true,
    hasTosInfo: true,
    targetStatus: 'active',
  },

  {
    name: 'ACLED API',
    baseUrl: 'https://api.acleddata.com',
    sampleUrl: 'https://api.acleddata.com/acled/readme',
    category: 'politics',
    confidence: 78,
    reason: 'High-value conflict data source; account/API token usually required',
    discoveredBy: 'manual',
    schemaHint: 'unknown',
    hasRateLimitInfo: true,
    hasTosInfo: true,
    targetStatus: 'draft',
  },
  {
    name: 'NASA FIRMS',
    baseUrl: 'https://firms.modaps.eosdis.nasa.gov',
    sampleUrl: 'https://firms.modaps.eosdis.nasa.gov/api/',
    category: 'politics',
    confidence: 76,
    reason: 'Satellite hotspot/fire intelligence; API key needed for operational queries',
    discoveredBy: 'manual',
    schemaHint: 'unknown',
    hasRateLimitInfo: true,
    hasTosInfo: true,
    targetStatus: 'draft',
  },
  {
    name: 'Sentinel Hub',
    baseUrl: 'https://services.sentinel-hub.com',
    sampleUrl: 'https://services.sentinel-hub.com/api/v1/process',
    category: 'politics',
    confidence: 74,
    reason: 'Satellite imagery API; OAuth credentials required',
    discoveredBy: 'manual',
    schemaHint: 'json',
    hasRateLimitInfo: true,
    hasTosInfo: true,
    targetStatus: 'draft',
  },
  {
    name: 'Shodan API',
    baseUrl: 'https://api.shodan.io',
    sampleUrl: 'https://api.shodan.io/api-info',
    category: 'politics',
    confidence: 73,
    reason: 'Cyber asset intelligence; API key required',
    discoveredBy: 'manual',
    schemaHint: 'json',
    hasRateLimitInfo: true,
    hasTosInfo: true,
    targetStatus: 'draft',
  },
  {
    name: 'TradingEconomics API',
    baseUrl: 'https://api.tradingeconomics.com',
    sampleUrl: 'https://api.tradingeconomics.com/calendar',
    category: 'finance',
    confidence: 72,
    reason: 'Macro indicators/events API; token needed for production use',
    discoveredBy: 'manual',
    schemaHint: 'json',
    hasRateLimitInfo: true,
    hasTosInfo: true,
    targetStatus: 'draft',
  },
  {
    name: 'Dataminr',
    baseUrl: 'https://www.dataminr.com',
    sampleUrl: 'https://www.dataminr.com',
    category: 'politics',
    confidence: 70,
    reason: 'Commercial early-warning platform; enterprise access required',
    discoveredBy: 'manual',
    schemaHint: 'unknown',
    hasRateLimitInfo: true,
    hasTosInfo: true,
    targetStatus: 'draft',
  },
  {
    name: 'Babel Street',
    baseUrl: 'https://www.babelstreet.com',
    sampleUrl: 'https://www.babelstreet.com',
    category: 'politics',
    confidence: 70,
    reason: 'Commercial OSINT platform; enterprise contract required',
    discoveredBy: 'manual',
    schemaHint: 'unknown',
    hasRateLimitInfo: true,
    hasTosInfo: true,
    targetStatus: 'draft',
  },
  {
    name: 'HawkEye 360',
    baseUrl: 'https://www.he360.com',
    sampleUrl: 'https://www.he360.com',
    category: 'supply-chain',
    confidence: 69,
    reason: 'Commercial RF geospatial intelligence; licensed access required',
    discoveredBy: 'manual',
    schemaHint: 'unknown',
    hasRateLimitInfo: true,
    hasTosInfo: true,
    targetStatus: 'draft',
  },
  {
    name: 'Planet Labs',
    baseUrl: 'https://api.planet.com',
    sampleUrl: 'https://api.planet.com/data/v1',
    category: 'supply-chain',
    confidence: 69,
    reason: 'Commercial imagery API; API key required',
    discoveredBy: 'manual',
    schemaHint: 'json',
    hasRateLimitInfo: true,
    hasTosInfo: true,
    targetStatus: 'draft',
  },
  {
    name: 'BlackSky',
    baseUrl: 'https://api.blacksky.com',
    sampleUrl: 'https://api.blacksky.com',
    category: 'supply-chain',
    confidence: 68,
    reason: 'Commercial geospatial analytics API; credentials required',
    discoveredBy: 'manual',
    schemaHint: 'json',
    hasRateLimitInfo: true,
    hasTosInfo: true,
    targetStatus: 'draft',
  },
  {
    name: 'Sayari',
    baseUrl: 'https://www.sayari.com',
    sampleUrl: 'https://www.sayari.com',
    category: 'supply-chain',
    confidence: 70,
    reason: 'Commercial supply-chain intelligence; contract required',
    discoveredBy: 'manual',
    schemaHint: 'unknown',
    hasRateLimitInfo: true,
    hasTosInfo: true,
    targetStatus: 'draft',
  },
  {
    name: 'Kharon',
    baseUrl: 'https://www.kharon.com',
    sampleUrl: 'https://www.kharon.com',
    category: 'supply-chain',
    confidence: 69,
    reason: 'Commercial sanctions-risk intelligence; subscription required',
    discoveredBy: 'manual',
    schemaHint: 'unknown',
    hasRateLimitInfo: true,
    hasTosInfo: true,
    targetStatus: 'draft',
  },
  {
    name: 'Recorded Future',
    baseUrl: 'https://api.recordedfuture.com',
    sampleUrl: 'https://api.recordedfuture.com',
    category: 'politics',
    confidence: 70,
    reason: 'Commercial threat intelligence API; token required',
    discoveredBy: 'manual',
    schemaHint: 'json',
    hasRateLimitInfo: true,
    hasTosInfo: true,
    targetStatus: 'draft',
  },
];

const CURATED_DISCOVERED_FEEDS: CuratedFeedSeed[] = [
  {
    category: 'thinktanks',
    feedName: 'ISW (Google News)',
    url: 'https://news.google.com/rss/search?q=site:understandingwar.org+when:7d&hl=en-US&gl=US&ceid=US:en',
    lang: 'en',
    confidence: 92,
    reason: 'ISW coverage via Google News RSS query',
    topics: ['war analysis', 'frontline assessment', 'campaign update'],
    targetStatus: 'active',
  },
  {
    category: 'crisis',
    feedName: 'Crisis Group (Google News)',
    url: 'https://news.google.com/rss/search?q=site:crisisgroup.org+when:7d&hl=en-US&gl=US&ceid=US:en',
    lang: 'en',
    confidence: 91,
    reason: 'International Crisis Group coverage via Google News RSS query',
    topics: ['crisiswatch', 'geopolitics', 'conflict risk'],
    targetStatus: 'active',
  },
  {
    category: 'thinktanks',
    feedName: 'Bellingcat Direct Feed',
    url: 'https://www.bellingcat.com/feed/',
    lang: 'en',
    confidence: 90,
    reason: 'Direct Bellingcat RSS feed',
    topics: ['osint', 'investigations', 'verification'],
    targetStatus: 'active',
  },
  {
    category: 'crisis',
    feedName: 'DeepStateMap Mentions',
    url: 'https://news.google.com/rss/search?q=site:deepstatemap.live+when:7d&hl=en-US&gl=US&ceid=US:en',
    lang: 'en',
    confidence: 84,
    reason: 'DeepStateMap mention stream via Google News RSS',
    topics: ['frontline map', 'war map', 'ukraine'],
    targetStatus: 'approved',
  },
  {
    category: 'thinktanks',
    feedName: 'C4ADS Mentions',
    url: 'https://news.google.com/rss/search?q=site:c4ads.org+when:30d&hl=en-US&gl=US&ceid=US:en',
    lang: 'en',
    confidence: 82,
    reason: 'C4ADS references via Google News RSS',
    topics: ['sanctions evasion', 'dark fleet', 'illicit finance'],
    targetStatus: 'approved',
  },
];

async function shouldRunSeed(force: boolean): Promise<boolean> {
  if (force) return true;
  try {
    const cached = await getPersistentCache<SeedState>(CURATED_SEED_STATE_KEY);
    const state = cached?.data;
    if (!state) return true;
    if (state.version !== CURATED_SEED_VERSION) return true;
    return Date.now() - state.lastRunAt >= CURATED_SEED_INTERVAL_MS;
  } catch {
    return true;
  }
}

async function markSeedRun(): Promise<void> {
  await setPersistentCache<SeedState>(CURATED_SEED_STATE_KEY, {
    version: CURATED_SEED_VERSION,
    lastRunAt: Date.now(),
  });
}

function toApiCandidate(seed: CuratedApiSeed): ApiDiscoveryCandidate {
  return {
    name: seed.name,
    baseUrl: seed.baseUrl,
    sampleUrl: seed.sampleUrl,
    category: seed.category,
    confidence: seed.confidence,
    reason: seed.reason,
    discoveredBy: seed.discoveredBy || 'manual',
    schemaHint: seed.schemaHint || 'unknown',
    hasRateLimitInfo: seed.hasRateLimitInfo,
    hasTosInfo: seed.hasTosInfo,
  };
}

export async function seedCuratedIntelSources(force = false): Promise<CuratedSeedResult> {
  const result: CuratedSeedResult = {
    apiRegistered: 0,
    apiActivated: 0,
    apiApproved: 0,
    feedRegistered: 0,
    feedActivated: 0,
    feedApproved: 0,
    ran: false,
  };

  if (!(await shouldRunSeed(force))) {
    return result;
  }

  result.ran = true;

  const apiRecords = await registerApiDiscoveryCandidates(
    CURATED_API_SOURCES.map(toApiCandidate),
  );
  result.apiRegistered = apiRecords.length;

  const apiBySample = new Map(apiRecords.map(record => [record.sampleUrl, record]));

  for (const seed of CURATED_API_SOURCES) {
    const record = apiBySample.get(seed.sampleUrl || '') ?? null;
    if (!record) continue;

    if (seed.targetStatus === 'active' && record.status !== 'active') {
      const updated = await setApiSourceStatus(record.id, 'active');
      if (updated) result.apiActivated += 1;
    } else if (seed.targetStatus === 'approved' && record.status === 'draft') {
      const updated = await setApiSourceStatus(record.id, 'approved');
      if (updated) result.apiApproved += 1;
    }

    if (seed.targetStatus === 'active' || seed.targetStatus === 'approved') {
      void refreshApiSourceHealth(record.id).catch(() => {});
    }
  }

  for (const seed of CURATED_DISCOVERED_FEEDS) {
    const record = await addDiscoveredSource({
      category: seed.category,
      feedName: seed.feedName,
      url: seed.url,
      lang: seed.lang || 'en',
      discoveredBy: 'manual',
      confidence: seed.confidence,
      reason: seed.reason,
      topics: seed.topics || [],
    });
    if (!record) continue;

    result.feedRegistered += 1;

    if (seed.targetStatus === 'active' && record.status !== 'active') {
      const updated = await setDiscoveredSourceStatus(record.id, 'active');
      if (updated) result.feedActivated += 1;
    } else if (seed.targetStatus === 'approved' && record.status === 'draft') {
      const updated = await setDiscoveredSourceStatus(record.id, 'approved');
      if (updated) result.feedApproved += 1;
    }
  }

  await markSeedRun();
  return result;
}

