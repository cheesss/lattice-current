/**
 * Source Profile — Phase 6
 *
 * Defines the fundamental characteristics of each data source,
 * including latency, accuracy, coverage, and freshness degradation.
 * Used to assign quality weights during frame construction and
 * enable cross-source validation.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SourceKind = 'sensor' | 'news' | 'research' | 'meta-aggregator' | 'market-data';

export interface LatencyCharacteristics {
  typicalDelayMinutes: number;
  maxDelayMinutes: number;
  jitter: 'low' | 'medium' | 'high';
}

export interface AccuracyProfile {
  baseReliability: number;            // 0-1
  falsePositiveRate: number;          // estimated false positive rate
  verificationLevel: 'none' | 'automated' | 'human-reviewed';
}

export interface CoverageProfile {
  geographicScope: 'global' | 'regional' | 'local';
  temporalResolution: 'realtime' | 'hourly' | 'daily' | 'weekly';
  topicBias: string[];                // topics this source over-represents
}

export interface SourceProfile {
  id: string;
  name: string;
  kind: SourceKind;
  latency: LatencyCharacteristics;
  accuracy: AccuracyProfile;
  coverage: CoverageProfile;
  /** Freshness degradation function: given age in hours, returns value multiplier 0-1. */
  freshnessCurve: 'sensor' | 'news' | 'research' | 'market';
}

export interface QualityWeightedRecord {
  sourceId: string;
  sourceProfile: SourceProfile;
  qualityWeight: number;
  freshnessScore: number;
  verificationBonus: number;
}

export interface CrossValidationResult {
  sensorConfirmed: boolean;
  researchConfirmed: boolean;
  confirmationLatencyHours: number | null;
  conflictingSignals: string[];
  confidenceAdjustment: number;       // -20 to +20
}

// ---------------------------------------------------------------------------
// Freshness Degradation Curves
// ---------------------------------------------------------------------------

const FRESHNESS_CURVES: Record<SourceProfile['freshnessCurve'], (ageHours: number) => number> = {
  /** Sensor data: value drops fast (1h half-life). */
  sensor: (ageHours: number) => Math.exp(-0.7 * ageHours),
  /** News: moderate decay (6h half-life). */
  news: (ageHours: number) => Math.exp(-0.115 * ageHours),
  /** Research: slow decay (7-day half-life). */
  research: (ageHours: number) => Math.exp(-0.004 * ageHours),
  /** Market data: fast for intraday, moderate for daily. */
  market: (ageHours: number) => ageHours < 1 ? 1 : Math.exp(-0.3 * (ageHours - 1)),
};

/** Compute freshness score for a given source and age. */
export function computeFreshnessScore(profile: SourceProfile, ageHours: number): number {
  const curve = FRESHNESS_CURVES[profile.freshnessCurve];
  return Math.max(0, Math.min(1, curve(Math.max(0, ageHours))));
}

// ---------------------------------------------------------------------------
// Default Source Profile Catalog (24 providers)
// ---------------------------------------------------------------------------

export const SOURCE_PROFILES: ReadonlyMap<string, SourceProfile> = new Map<string, SourceProfile>([
  // Meta-aggregators
  ['gdelt', { id: 'gdelt', name: 'GDELT', kind: 'meta-aggregator', latency: { typicalDelayMinutes: 30, maxDelayMinutes: 120, jitter: 'medium' }, accuracy: { baseReliability: 0.65, falsePositiveRate: 0.18, verificationLevel: 'automated' }, coverage: { geographicScope: 'global', temporalResolution: 'hourly', topicBias: ['conflict', 'political'] }, freshnessCurve: 'news' }],
  ['gdelt-doc', { id: 'gdelt-doc', name: 'GDELT DOC API', kind: 'meta-aggregator', latency: { typicalDelayMinutes: 45, maxDelayMinutes: 180, jitter: 'medium' }, accuracy: { baseReliability: 0.62, falsePositiveRate: 0.20, verificationLevel: 'automated' }, coverage: { geographicScope: 'global', temporalResolution: 'hourly', topicBias: ['conflict', 'political', 'economic'] }, freshnessCurve: 'news' }],

  // Research
  ['acled', { id: 'acled', name: 'ACLED', kind: 'research', latency: { typicalDelayMinutes: 2880, maxDelayMinutes: 10080, jitter: 'high' }, accuracy: { baseReliability: 0.92, falsePositiveRate: 0.04, verificationLevel: 'human-reviewed' }, coverage: { geographicScope: 'global', temporalResolution: 'weekly', topicBias: ['conflict', 'political-violence'] }, freshnessCurve: 'research' }],

  // Sensors
  ['opensky', { id: 'opensky', name: 'OpenSky Network', kind: 'sensor', latency: { typicalDelayMinutes: 0.5, maxDelayMinutes: 5, jitter: 'low' }, accuracy: { baseReliability: 0.97, falsePositiveRate: 0.01, verificationLevel: 'automated' }, coverage: { geographicScope: 'global', temporalResolution: 'realtime', topicBias: ['aviation', 'military'] }, freshnessCurve: 'sensor' }],
  ['ais', { id: 'ais', name: 'AIS Maritime', kind: 'sensor', latency: { typicalDelayMinutes: 1, maxDelayMinutes: 10, jitter: 'low' }, accuracy: { baseReliability: 0.95, falsePositiveRate: 0.02, verificationLevel: 'automated' }, coverage: { geographicScope: 'global', temporalResolution: 'realtime', topicBias: ['maritime', 'trade'] }, freshnessCurve: 'sensor' }],
  ['usgs', { id: 'usgs', name: 'USGS Earthquake', kind: 'sensor', latency: { typicalDelayMinutes: 2, maxDelayMinutes: 15, jitter: 'low' }, accuracy: { baseReliability: 0.99, falsePositiveRate: 0.005, verificationLevel: 'automated' }, coverage: { geographicScope: 'global', temporalResolution: 'realtime', topicBias: ['seismic', 'natural-disaster'] }, freshnessCurve: 'sensor' }],

  // News sources
  ['rss', { id: 'rss', name: 'RSS Feeds', kind: 'news', latency: { typicalDelayMinutes: 15, maxDelayMinutes: 60, jitter: 'medium' }, accuracy: { baseReliability: 0.70, falsePositiveRate: 0.12, verificationLevel: 'none' }, coverage: { geographicScope: 'global', temporalResolution: 'hourly', topicBias: [] }, freshnessCurve: 'news' }],
  ['reuters', { id: 'reuters', name: 'Reuters', kind: 'news', latency: { typicalDelayMinutes: 5, maxDelayMinutes: 30, jitter: 'low' }, accuracy: { baseReliability: 0.88, falsePositiveRate: 0.05, verificationLevel: 'human-reviewed' }, coverage: { geographicScope: 'global', temporalResolution: 'realtime', topicBias: ['finance', 'political'] }, freshnessCurve: 'news' }],
  ['ap', { id: 'ap', name: 'Associated Press', kind: 'news', latency: { typicalDelayMinutes: 5, maxDelayMinutes: 30, jitter: 'low' }, accuracy: { baseReliability: 0.90, falsePositiveRate: 0.04, verificationLevel: 'human-reviewed' }, coverage: { geographicScope: 'global', temporalResolution: 'realtime', topicBias: [] }, freshnessCurve: 'news' }],
  ['bbc', { id: 'bbc', name: 'BBC News', kind: 'news', latency: { typicalDelayMinutes: 10, maxDelayMinutes: 60, jitter: 'low' }, accuracy: { baseReliability: 0.87, falsePositiveRate: 0.06, verificationLevel: 'human-reviewed' }, coverage: { geographicScope: 'global', temporalResolution: 'hourly', topicBias: ['uk', 'political'] }, freshnessCurve: 'news' }],
  ['aljazeera', { id: 'aljazeera', name: 'Al Jazeera', kind: 'news', latency: { typicalDelayMinutes: 10, maxDelayMinutes: 60, jitter: 'medium' }, accuracy: { baseReliability: 0.80, falsePositiveRate: 0.08, verificationLevel: 'human-reviewed' }, coverage: { geographicScope: 'regional', temporalResolution: 'hourly', topicBias: ['middle-east', 'conflict'] }, freshnessCurve: 'news' }],
  ['nyt', { id: 'nyt', name: 'New York Times', kind: 'news', latency: { typicalDelayMinutes: 15, maxDelayMinutes: 60, jitter: 'medium' }, accuracy: { baseReliability: 0.86, falsePositiveRate: 0.06, verificationLevel: 'human-reviewed' }, coverage: { geographicScope: 'global', temporalResolution: 'hourly', topicBias: ['us-politics', 'finance'] }, freshnessCurve: 'news' }],
  ['ft', { id: 'ft', name: 'Financial Times', kind: 'news', latency: { typicalDelayMinutes: 10, maxDelayMinutes: 45, jitter: 'low' }, accuracy: { baseReliability: 0.89, falsePositiveRate: 0.05, verificationLevel: 'human-reviewed' }, coverage: { geographicScope: 'global', temporalResolution: 'hourly', topicBias: ['finance', 'markets', 'commodities'] }, freshnessCurve: 'news' }],

  // Market data
  ['yahoo-chart', { id: 'yahoo-chart', name: 'Yahoo Finance', kind: 'market-data', latency: { typicalDelayMinutes: 0.5, maxDelayMinutes: 5, jitter: 'low' }, accuracy: { baseReliability: 0.94, falsePositiveRate: 0.01, verificationLevel: 'automated' }, coverage: { geographicScope: 'global', temporalResolution: 'realtime', topicBias: [] }, freshnessCurve: 'market' }],
  ['coingecko', { id: 'coingecko', name: 'CoinGecko', kind: 'market-data', latency: { typicalDelayMinutes: 1, maxDelayMinutes: 10, jitter: 'low' }, accuracy: { baseReliability: 0.92, falsePositiveRate: 0.02, verificationLevel: 'automated' }, coverage: { geographicScope: 'global', temporalResolution: 'realtime', topicBias: ['crypto'] }, freshnessCurve: 'market' }],
  ['fred', { id: 'fred', name: 'FRED (St. Louis Fed)', kind: 'research', latency: { typicalDelayMinutes: 1440, maxDelayMinutes: 4320, jitter: 'high' }, accuracy: { baseReliability: 0.98, falsePositiveRate: 0.005, verificationLevel: 'human-reviewed' }, coverage: { geographicScope: 'regional', temporalResolution: 'daily', topicBias: ['macro', 'us-economy'] }, freshnessCurve: 'research' }],
  ['alfred', { id: 'alfred', name: 'ALFRED (Archival FRED)', kind: 'research', latency: { typicalDelayMinutes: 2880, maxDelayMinutes: 7200, jitter: 'high' }, accuracy: { baseReliability: 0.99, falsePositiveRate: 0.002, verificationLevel: 'human-reviewed' }, coverage: { geographicScope: 'regional', temporalResolution: 'weekly', topicBias: ['macro', 'historical'] }, freshnessCurve: 'research' }],

  // Intelligence / OSINT
  ['pizzint', { id: 'pizzint', name: 'PIZZINT OSINT', kind: 'news', latency: { typicalDelayMinutes: 30, maxDelayMinutes: 120, jitter: 'medium' }, accuracy: { baseReliability: 0.72, falsePositiveRate: 0.15, verificationLevel: 'automated' }, coverage: { geographicScope: 'global', temporalResolution: 'hourly', topicBias: ['intelligence', 'military'] }, freshnessCurve: 'news' }],
  ['glint', { id: 'glint', name: 'GLINT Geolocation', kind: 'sensor', latency: { typicalDelayMinutes: 5, maxDelayMinutes: 30, jitter: 'medium' }, accuracy: { baseReliability: 0.82, falsePositiveRate: 0.10, verificationLevel: 'automated' }, coverage: { geographicScope: 'global', temporalResolution: 'hourly', topicBias: ['imagery', 'military'] }, freshnessCurve: 'sensor' }],
  ['cyber-threats', { id: 'cyber-threats', name: 'Cyber Threat Feeds', kind: 'sensor', latency: { typicalDelayMinutes: 10, maxDelayMinutes: 60, jitter: 'medium' }, accuracy: { baseReliability: 0.78, falsePositiveRate: 0.14, verificationLevel: 'automated' }, coverage: { geographicScope: 'global', temporalResolution: 'hourly', topicBias: ['cyber', 'infrastructure'] }, freshnessCurve: 'sensor' }],

  // Specialized
  ['twitter-osint', { id: 'twitter-osint', name: 'Twitter OSINT', kind: 'news', latency: { typicalDelayMinutes: 2, maxDelayMinutes: 15, jitter: 'high' }, accuracy: { baseReliability: 0.45, falsePositiveRate: 0.35, verificationLevel: 'none' }, coverage: { geographicScope: 'global', temporalResolution: 'realtime', topicBias: ['breaking-news', 'social'] }, freshnessCurve: 'news' }],
  ['telegram-osint', { id: 'telegram-osint', name: 'Telegram OSINT', kind: 'news', latency: { typicalDelayMinutes: 5, maxDelayMinutes: 30, jitter: 'high' }, accuracy: { baseReliability: 0.40, falsePositiveRate: 0.40, verificationLevel: 'none' }, coverage: { geographicScope: 'regional', temporalResolution: 'realtime', topicBias: ['conflict', 'military'] }, freshnessCurve: 'news' }],
  ['janes', { id: 'janes', name: 'Janes Defence', kind: 'research', latency: { typicalDelayMinutes: 720, maxDelayMinutes: 2880, jitter: 'medium' }, accuracy: { baseReliability: 0.93, falsePositiveRate: 0.03, verificationLevel: 'human-reviewed' }, coverage: { geographicScope: 'global', temporalResolution: 'daily', topicBias: ['defense', 'military-equipment'] }, freshnessCurve: 'research' }],
  ['sipri', { id: 'sipri', name: 'SIPRI', kind: 'research', latency: { typicalDelayMinutes: 10080, maxDelayMinutes: 43200, jitter: 'high' }, accuracy: { baseReliability: 0.95, falsePositiveRate: 0.02, verificationLevel: 'human-reviewed' }, coverage: { geographicScope: 'global', temporalResolution: 'weekly', topicBias: ['arms-trade', 'military-spending'] }, freshnessCurve: 'research' }],
]);

// ---------------------------------------------------------------------------
// Quality Weight Computation
// ---------------------------------------------------------------------------

/**
 * Compute a quality weight for a record based on its source profile and age.
 * qualityWeight = reliability * freshness * verificationBonus
 */
export function computeQualityWeight(
  profile: SourceProfile,
  ageHours: number,
): number {
  const freshness = computeFreshnessScore(profile, ageHours);
  const verificationBonus = profile.accuracy.verificationLevel === 'human-reviewed'
    ? 1.15
    : profile.accuracy.verificationLevel === 'automated'
      ? 1.0
      : 0.85;
  return Math.min(1, profile.accuracy.baseReliability * freshness * verificationBonus);
}

/**
 * Get the source profile for a provider ID.
 * Returns a default low-confidence profile if provider is unknown.
 */
export function getSourceProfile(providerId: string): SourceProfile {
  const normalized = providerId.toLowerCase().replace(/[^a-z0-9-]/g, '-');
  const profile = SOURCE_PROFILES.get(normalized);
  if (profile) return profile;

  // Default profile for unknown providers
  return {
    id: normalized,
    name: providerId,
    kind: 'news',
    latency: { typicalDelayMinutes: 60, maxDelayMinutes: 240, jitter: 'high' },
    accuracy: { baseReliability: 0.50, falsePositiveRate: 0.25, verificationLevel: 'none' },
    coverage: { geographicScope: 'global', temporalResolution: 'hourly', topicBias: [] },
    freshnessCurve: 'news',
  };
}

// ---------------------------------------------------------------------------
// Cross-Source Validation
// ---------------------------------------------------------------------------

/**
 * Evaluate cross-source validation for a set of records about the same event.
 */
export function evaluateCrossValidation(
  sourceKinds: SourceKind[],
  hasConflictingSignals: boolean = false,
  confirmationLatencyHours: number | null = null,
): CrossValidationResult {
  const sensorConfirmed = sourceKinds.includes('sensor');
  const researchConfirmed = sourceKinds.includes('research');
  const conflictingSignals: string[] = [];

  if (hasConflictingSignals) {
    conflictingSignals.push('Conflicting signals detected between sources');
  }

  let confidenceAdjustment = 0;
  if (sensorConfirmed && researchConfirmed) {
    confidenceAdjustment = 15;  // Strong multi-source confirmation
  } else if (sensorConfirmed) {
    confidenceAdjustment = 10;  // Sensor confirmation
  } else if (researchConfirmed) {
    confidenceAdjustment = 8;   // Research confirmation (slower but reliable)
  } else if (sourceKinds.length >= 3) {
    confidenceAdjustment = 5;   // Multiple news sources
  } else if (sourceKinds.length === 1) {
    confidenceAdjustment = -5;  // Single-source, lower confidence
  }

  if (hasConflictingSignals) {
    confidenceAdjustment -= 10;
  }

  return {
    sensorConfirmed,
    researchConfirmed,
    confirmationLatencyHours,
    conflictingSignals,
    confidenceAdjustment: Math.max(-20, Math.min(20, confidenceAdjustment)),
  };
}

/**
 * Compute a conviction bonus/penalty based on source quality of supporting evidence.
 */
export function computeSourceQualityConvictionAdjustment(
  sourceProfiles: SourceProfile[],
): number {
  if (sourceProfiles.length === 0) return -10;

  const avgReliability = sourceProfiles.reduce(
    (sum: number, p: SourceProfile) => sum + p.accuracy.baseReliability, 0,
  ) / sourceProfiles.length;

  const hasHumanReviewed = sourceProfiles.some(
    (p: SourceProfile) => p.accuracy.verificationLevel === 'human-reviewed',
  );

  // High reliability sources → bonus, low → penalty
  let adjustment = (avgReliability - 0.7) * 30; // centered at 0.7 reliability
  if (hasHumanReviewed) adjustment += 5;

  return Math.round(Math.max(-15, Math.min(15, adjustment)));
}