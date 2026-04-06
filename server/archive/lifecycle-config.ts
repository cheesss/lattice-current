export type LifecycleCategory =
  | 'market-realtime'
  | 'news-event'
  | 'backtest'
  | 'analysis-result'
  | 'source-score'
  | 'generic';

export interface LifecyclePolicy {
  category: LifecycleCategory;
  redisRetentionSeconds: number;
  postgresRetentionDays: number;
  coldArchiveAfterDays: number | null;
  coldDeleteAfterDays: number | null;
}

export const LIFECYCLE_POLICIES: Record<LifecycleCategory, LifecyclePolicy> = {
  'market-realtime': { category: 'market-realtime', redisRetentionSeconds: 24 * 60 * 60, postgresRetentionDays: 0, coldArchiveAfterDays: null, coldDeleteAfterDays: null },
  'news-event': { category: 'news-event', redisRetentionSeconds: 24 * 60 * 60, postgresRetentionDays: 90, coldArchiveAfterDays: 90, coldDeleteAfterDays: 120 },
  backtest: { category: 'backtest', redisRetentionSeconds: 24 * 60 * 60, postgresRetentionDays: 365, coldArchiveAfterDays: 365, coldDeleteAfterDays: 395 },
  'analysis-result': { category: 'analysis-result', redisRetentionSeconds: 24 * 60 * 60, postgresRetentionDays: 30, coldArchiveAfterDays: 30, coldDeleteAfterDays: 60 },
  'source-score': { category: 'source-score', redisRetentionSeconds: 7 * 24 * 60 * 60, postgresRetentionDays: 3650, coldArchiveAfterDays: null, coldDeleteAfterDays: null },
  generic: { category: 'generic', redisRetentionSeconds: 24 * 60 * 60, postgresRetentionDays: 30, coldArchiveAfterDays: 30, coldDeleteAfterDays: 60 },
};

const CATEGORY_MATCHERS: Array<{ test: RegExp; category: LifecycleCategory }> = [
  { test: /^(market:|crypto:|commodity:)/, category: 'market-realtime' },
  { test: /^(news:|conflict:|positive-events:|unrest:|aviation:)/, category: 'news-event' },
  { test: /^(backtest:|replay-frame:|historical-)/, category: 'backtest' },
  { test: /^(ci-sebuf:|summary:|analysis:|report:)/, category: 'analysis-result' },
  { test: /^(source-score|source:score|seed-meta:)/, category: 'source-score' },
];

export function resolveLifecycleCategory(keyOrSource: string): LifecycleCategory {
  const normalized = String(keyOrSource || '').trim();
  const match = CATEGORY_MATCHERS.find((entry) => entry.test.test(normalized));
  return match?.category || 'generic';
}

export function getLifecyclePolicy(keyOrSource: string): LifecyclePolicy {
  return LIFECYCLE_POLICIES[resolveLifecycleCategory(keyOrSource)];
}

