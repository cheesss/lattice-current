function envInt(key: string, fallback: number): number {
  const raw = typeof process !== 'undefined' ? process.env?.[key] : undefined;
  const parsed = Number.parseInt(String(raw ?? ''), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function envFloat(key: string, fallback: number): number {
  const raw = typeof process !== 'undefined' ? process.env?.[key] : undefined;
  const parsed = Number.parseFloat(String(raw ?? ''));
  return Number.isFinite(parsed) ? parsed : fallback;
}

export const THEME_DISCOVERY_TUNING = {
  tokenMinLength: envInt('THEME_DISCOVERY_TOKEN_MIN_LENGTH', 3),
  longTokenMinLength: envInt('THEME_DISCOVERY_LONG_TOKEN_MIN_LENGTH', 6),
  knownThemeOverlapReject: envFloat('THEME_DISCOVERY_KNOWN_THEME_OVERLAP_REJECT', 0.72),
  queueSignalFloor: envInt('THEME_DISCOVERY_QUEUE_SIGNAL_FLOOR', 48),
  defaultMinSamples: envInt('THEME_DISCOVERY_MIN_SAMPLES', 3),
  defaultMinSources: envInt('THEME_DISCOVERY_MIN_SOURCES', 2),
  defaultMaxQueueItems: envInt('THEME_DISCOVERY_MAX_QUEUE_ITEMS', 16),
  sampleWeight: envInt('THEME_DISCOVERY_SAMPLE_WEIGHT', 11),
  sourceWeight: envInt('THEME_DISCOVERY_SOURCE_WEIGHT', 9),
  regionWeight: envInt('THEME_DISCOVERY_REGION_WEIGHT', 6),
  overlapPenaltyWeight: envInt('THEME_DISCOVERY_OVERLAP_PENALTY_WEIGHT', 28),
} as const;

export const BACKTEST_REPLAY_TUNING = {
  maxHorizonCandidates: envInt('BACKTEST_MAX_HORIZON_CANDIDATES', 4),
  dedupeMinHours: envInt('BACKTEST_DEDUPE_MIN_HOURS', 12),
  dedupeMaxHours: envInt('BACKTEST_DEDUPE_MAX_HOURS', 72),
  dedupePreferredHorizonFactor: envFloat('BACKTEST_DEDUPE_PREFERRED_HORIZON_FACTOR', 0.35),
  convictionDedupeTolerance: envInt('BACKTEST_CONVICTION_DEDUPE_TOLERANCE', 8),
  entryLookaheadMinMinutes: envInt('BACKTEST_ENTRY_LOOKAHEAD_MIN_MINUTES', 30),
  exitLookaheadMinHours: envInt('BACKTEST_EXIT_LOOKAHEAD_MIN_HOURS', 6),
  seriesLookaheadMinHours: envInt('BACKTEST_SERIES_LOOKAHEAD_MIN_HOURS', 12),
  seriesLookaheadMaxDays: envInt('BACKTEST_SERIES_LOOKAHEAD_MAX_DAYS', 21),
  seriesLookaheadIntervalMultiplier: envFloat('BACKTEST_SERIES_LOOKAHEAD_INTERVAL_MULTIPLIER', 4.5),
  shortHorizonMaxHoldHours: envInt('BACKTEST_SHORT_HORIZON_MAX_HOLD_HOURS', 48),
  mediumHorizonMaxHoldHours: envInt('BACKTEST_MEDIUM_HORIZON_MAX_HOLD_HOURS', 120),
  longHorizonMaxHoldHours: envInt('BACKTEST_LONG_HORIZON_MAX_HOLD_HOURS', 480),
  targetReturnMinPct: envFloat('BACKTEST_TARGET_RETURN_MIN_PCT', 1.2),
  targetReturnMaxPct: envFloat('BACKTEST_TARGET_RETURN_MAX_PCT', 4.5),
  targetReturnHorizonDivisor: envFloat('BACKTEST_TARGET_RETURN_HORIZON_DIVISOR', 18),
  trailingStopMinPct: envFloat('BACKTEST_TRAILING_STOP_MIN_PCT', 0.8),
  trailingStopTargetFactor: envFloat('BACKTEST_TRAILING_STOP_TARGET_FACTOR', 0.65),
  minDrawdownDenominatorPct: envFloat('BACKTEST_MIN_DRAWDOWN_DENOMINATOR_PCT', 0.25),
} as const;

export const CODEX_PROPOSAL_TUNING = {
  maxEvidenceBullets: envInt('CODEX_PROPOSAL_MAX_EVIDENCE_BULLETS', 6),
  maxHistoricalAnalogs: envInt('CODEX_PROPOSAL_MAX_HISTORICAL_ANALOGS', 5),
  maxWeaknessBullets: envInt('CODEX_PROPOSAL_MAX_WEAKNESS_BULLETS', 4),
} as const;
