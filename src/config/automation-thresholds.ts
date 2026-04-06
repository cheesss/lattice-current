/**
 * Centralized automation thresholds.
 * All values can be overridden via environment variables.
 */

function envInt(key: string, fallback: number): number {
  const v = typeof process !== 'undefined' ? process.env?.[key] : undefined;
  return v != null ? parseInt(v, 10) : fallback;
}

function envFloat(key: string, fallback: number): number {
  const v = typeof process !== 'undefined' ? process.env?.[key] : undefined;
  return v != null ? parseFloat(v) : fallback;
}

export const AUTOMATION_THRESHOLDS = {
  // Investment idea generation
  investment: {
    minHorizonHours: envInt('MIN_HORIZON_HOURS', 48),
    minSingleSourceQuality: envInt('MIN_SINGLE_SOURCE_QUALITY', 44),
    intensityBypassFloor: envInt('INTENSITY_BYPASS_FLOOR', 64),
    stressBypassFloor: envFloat('STRESS_BYPASS_FLOOR', 0.42),
  },

  // Theme automation
  theme: {
    mode: 'guarded-auto' as const,
    minDiscoveryScore: envInt('THEME_MIN_DISCOVERY_SCORE', 40),
    minSampleCount: envInt('THEME_MIN_SAMPLE_COUNT', 4),
    minSourceCount: envInt('THEME_MIN_SOURCE_COUNT', 2),
    minCodexConfidence: envInt('THEME_MIN_CODEX_CONFIDENCE', 58),
    minAssetCount: envInt('THEME_MIN_ASSET_COUNT', 2),
    minPromotionScore: envInt('THEME_MIN_PROMOTION_SCORE', 55),
    maxOverlapWithKnownThemes: envFloat('THEME_MAX_OVERLAP', 0.62),
    maxPromotionsPerDay: envInt('THEME_MAX_PROMOTIONS_PER_DAY', 1),
  },

  // Dataset automation
  dataset: {
    minProposalScore: envInt('DATASET_MIN_PROPOSAL_SCORE', 60),
    autoRegisterScore: envInt('DATASET_AUTO_REGISTER_SCORE', 74),
    autoEnableScore: envInt('DATASET_AUTO_ENABLE_SCORE', 88),
    maxRegistrationsPerCycle: envInt('DATASET_MAX_REGISTRATIONS', 2),
    maxEnabledDatasets: envInt('DATASET_MAX_ENABLED', 12),
  },

  // Source automation
  source: {
    mode: 'guarded-auto' as const,
    minDiscoveredApproveConfidence: envInt('SOURCE_MIN_APPROVE', 84),
    minDiscoveredActivateConfidence: envInt('SOURCE_MIN_ACTIVATE', 92),
    minApiApproveConfidence: envInt('SOURCE_MIN_API_APPROVE', 90),
    minApiActivateConfidence: envInt('SOURCE_MIN_API_ACTIVATE', 94),
    maxDiscoveredActivationsPerCycle: envInt('SOURCE_MAX_ACTIVATIONS', 6),
    maxApiActivationsPerCycle: envInt('SOURCE_MAX_API_ACTIVATIONS', 4),
    cooldownHours: envInt('SOURCE_COOLDOWN_HOURS', 36),
  },

  // Scheduling
  schedule: {
    fetchEveryMinutes: envInt('FETCH_EVERY_MINUTES', 60),
    replayEveryMinutes: envInt('REPLAY_EVERY_MINUTES', 60),
    themeDiscoveryEveryMinutes: envInt('THEME_DISCOVERY_EVERY_MINUTES', 180),
    keywordLifecycleEveryMinutes: envInt('KEYWORD_LIFECYCLE_EVERY_MINUTES', 360),
    bucketHours: envInt('BUCKET_HOURS', 6),
    warmupFrameCount: envInt('WARMUP_FRAME_COUNT', 60),
    retentionDays: envInt('RETENTION_DAYS', 30),
  },

  // Position sizing
  position: {
    maxHoldingDaysStarter: envInt('MAX_HOLDING_STARTER', 5),
    maxHoldingDaysStandard: envInt('MAX_HOLDING_STANDARD', 14),
    maxHoldingDaysConviction: envInt('MAX_HOLDING_CONVICTION', 30),
    maxHoldingDaysHedge: envInt('MAX_HOLDING_HEDGE', 21),
  },

  // News locale
  locale: {
    newsLanguage: (typeof process !== 'undefined' ? process.env?.NEWS_LANGUAGE : undefined) || 'en',
    newsRegion: (typeof process !== 'undefined' ? process.env?.NEWS_REGION : undefined) || 'US',
  },
} as const;
