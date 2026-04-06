export const DEFAULT_STORAGE_SOURCE = 'generic-cache';

export const SCHEMA_VERSIONS = {
  'generic-cache': 1,
  'seed-earthquakes': 2,
  'bootstrap-markets': 1,
  'bootstrap-sectors': 1,
  'bootstrap-commodities': 1,
  'bootstrap-positive-geo-events': 1,
  'bootstrap-ucdp-events': 1,
  'historical-raw-item': 1,
  'historical-replay-frame': 1,
  'historical-dataset': 1,
  'backtest-run': 1,
  'backtest-run-summary': 1,
  'backtest-run-window': 1,
  'idea-run': 1,
  'source-score': 1,
  'mapping-stat': 1,
  'replay-frame': 3,
} as const;

type SourceMatcher = {
  test: RegExp;
  source: keyof typeof SCHEMA_VERSIONS;
};

const CACHE_KEY_MATCHERS: SourceMatcher[] = [
  { test: /^seismology:earthquakes/, source: 'seed-earthquakes' },
  { test: /^market:stocks/, source: 'bootstrap-markets' },
  { test: /^market:commodities/, source: 'bootstrap-commodities' },
  { test: /^market:sectors/, source: 'bootstrap-sectors' },
  { test: /^positive-events:geo/, source: 'bootstrap-positive-geo-events' },
  { test: /^conflict:ucdp-events/, source: 'bootstrap-ucdp-events' },
  { test: /^backtest:/, source: 'backtest-run' },
  { test: /^replay-frame:/, source: 'replay-frame' },
];

export function resolveStorageSource(sourceOrKey: string | null | undefined): keyof typeof SCHEMA_VERSIONS {
  const normalized = String(sourceOrKey || '').trim();
  if (!normalized) return DEFAULT_STORAGE_SOURCE;
  if (normalized in SCHEMA_VERSIONS) {
    return normalized as keyof typeof SCHEMA_VERSIONS;
  }
  const matcher = CACHE_KEY_MATCHERS.find((entry) => entry.test.test(normalized));
  return matcher?.source || DEFAULT_STORAGE_SOURCE;
}

export function resolveSchemaVersion(sourceOrKey: string | null | undefined): number {
  return SCHEMA_VERSIONS[resolveStorageSource(sourceOrKey)] ?? SCHEMA_VERSIONS[DEFAULT_STORAGE_SOURCE];
}

