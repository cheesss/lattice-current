import {
  listDiscoveredSources,
  setDiscoveredSourceStatus,
  type DiscoveredSourceRecord,
} from '../source-registry';
import {
  listApiSourceRegistry,
  refreshApiSourceHealth,
  setApiSourceStatusWithMeta,
  type ApiSourceRecord,
} from '../api-source-registry';

export type SourceAutomationMode = 'manual' | 'guarded-auto' | 'full-auto';

export interface SourceAutomationPolicy {
  mode: SourceAutomationMode;
  minDiscoveredApproveConfidence: number;
  minDiscoveredActivateConfidence: number;
  minApiApproveConfidence: number;
  minApiActivateConfidence: number;
  maxDiscoveredActivationsPerCycle: number;
  maxApiActivationsPerCycle: number;
  maxDiscoveredActivationsPerCategory: number;
  maxDiscoveredActivationsPerDomain: number;
  maxApiActivationsPerCategory: number;
  maxApiActivationsPerBaseUrl: number;
  requireFeedLikeUrl: boolean;
  requireHealthyApi: boolean;
  minDiscoveredTopicCount: number;
  cooldownHours: number;
  healthRefreshBatch: number;
  staleHealthHours: number;
}

export interface SourceAutomationSweepResult {
  mode: SourceAutomationMode;
  discoveredApproved: string[];
  discoveredActivated: string[];
  apiApproved: string[];
  apiActivated: string[];
  refreshedApiHealth: string[];
}

const DEFAULT_SOURCE_AUTOMATION_POLICY: SourceAutomationPolicy = {
  mode: 'guarded-auto',
  minDiscoveredApproveConfidence: 84,
  minDiscoveredActivateConfidence: 92,
  minApiApproveConfidence: 90,
  minApiActivateConfidence: 94,
  maxDiscoveredActivationsPerCycle: 6,
  maxApiActivationsPerCycle: 4,
  maxDiscoveredActivationsPerCategory: 2,
  maxDiscoveredActivationsPerDomain: 1,
  maxApiActivationsPerCategory: 2,
  maxApiActivationsPerBaseUrl: 1,
  requireFeedLikeUrl: true,
  requireHealthyApi: true,
  minDiscoveredTopicCount: 2,
  cooldownHours: 36,
  healthRefreshBatch: 12,
  staleHealthHours: 12,
};

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function normalizeSourceAutomationPolicy(policy?: Partial<SourceAutomationPolicy> | null): SourceAutomationPolicy {
  return {
    mode: policy?.mode === 'manual' || policy?.mode === 'guarded-auto' || policy?.mode === 'full-auto'
      ? policy.mode
      : DEFAULT_SOURCE_AUTOMATION_POLICY.mode,
    minDiscoveredApproveConfidence: clamp(Math.round(Number(policy?.minDiscoveredApproveConfidence) || DEFAULT_SOURCE_AUTOMATION_POLICY.minDiscoveredApproveConfidence), 40, 98),
    minDiscoveredActivateConfidence: clamp(Math.round(Number(policy?.minDiscoveredActivateConfidence) || DEFAULT_SOURCE_AUTOMATION_POLICY.minDiscoveredActivateConfidence), 50, 99),
    minApiApproveConfidence: clamp(Math.round(Number(policy?.minApiApproveConfidence) || DEFAULT_SOURCE_AUTOMATION_POLICY.minApiApproveConfidence), 40, 98),
    minApiActivateConfidence: clamp(Math.round(Number(policy?.minApiActivateConfidence) || DEFAULT_SOURCE_AUTOMATION_POLICY.minApiActivateConfidence), 50, 99),
    maxDiscoveredActivationsPerCycle: clamp(Math.round(Number(policy?.maxDiscoveredActivationsPerCycle) || DEFAULT_SOURCE_AUTOMATION_POLICY.maxDiscoveredActivationsPerCycle), 1, 20),
    maxApiActivationsPerCycle: clamp(Math.round(Number(policy?.maxApiActivationsPerCycle) || DEFAULT_SOURCE_AUTOMATION_POLICY.maxApiActivationsPerCycle), 1, 20),
    maxDiscoveredActivationsPerCategory: clamp(Math.round(Number(policy?.maxDiscoveredActivationsPerCategory) || DEFAULT_SOURCE_AUTOMATION_POLICY.maxDiscoveredActivationsPerCategory), 1, 8),
    maxDiscoveredActivationsPerDomain: clamp(Math.round(Number(policy?.maxDiscoveredActivationsPerDomain) || DEFAULT_SOURCE_AUTOMATION_POLICY.maxDiscoveredActivationsPerDomain), 1, 4),
    maxApiActivationsPerCategory: clamp(Math.round(Number(policy?.maxApiActivationsPerCategory) || DEFAULT_SOURCE_AUTOMATION_POLICY.maxApiActivationsPerCategory), 1, 8),
    maxApiActivationsPerBaseUrl: clamp(Math.round(Number(policy?.maxApiActivationsPerBaseUrl) || DEFAULT_SOURCE_AUTOMATION_POLICY.maxApiActivationsPerBaseUrl), 1, 4),
    requireFeedLikeUrl: typeof policy?.requireFeedLikeUrl === 'boolean' ? policy.requireFeedLikeUrl : DEFAULT_SOURCE_AUTOMATION_POLICY.requireFeedLikeUrl,
    requireHealthyApi: typeof policy?.requireHealthyApi === 'boolean' ? policy.requireHealthyApi : DEFAULT_SOURCE_AUTOMATION_POLICY.requireHealthyApi,
    minDiscoveredTopicCount: clamp(Math.round(Number(policy?.minDiscoveredTopicCount) || DEFAULT_SOURCE_AUTOMATION_POLICY.minDiscoveredTopicCount), 0, 8),
    cooldownHours: clamp(Math.round(Number(policy?.cooldownHours) || DEFAULT_SOURCE_AUTOMATION_POLICY.cooldownHours), 1, 168),
    healthRefreshBatch: clamp(Math.round(Number(policy?.healthRefreshBatch) || DEFAULT_SOURCE_AUTOMATION_POLICY.healthRefreshBatch), 1, 32),
    staleHealthHours: clamp(Math.round(Number(policy?.staleHealthHours) || DEFAULT_SOURCE_AUTOMATION_POLICY.staleHealthHours), 1, 168),
  };
}

function isFeedLikeUrl(url: string): boolean {
  return /(rss|feed|atom|xml)/i.test(String(url || ''));
}

interface SourceAutomationContext {
  activeDiscoveredByCategory: Map<string, number>;
  activeDiscoveredByDomain: Map<string, number>;
  activeApiByCategory: Map<string, number>;
  activeApiByBaseUrl: Map<string, number>;
}

function incrementCount(map: Map<string, number>, key: string): void {
  if (!key) return;
  map.set(key, (map.get(key) || 0) + 1);
}

function buildContext(discovered: DiscoveredSourceRecord[], apiSources: ApiSourceRecord[]): SourceAutomationContext {
  const context: SourceAutomationContext = {
    activeDiscoveredByCategory: new Map<string, number>(),
    activeDiscoveredByDomain: new Map<string, number>(),
    activeApiByCategory: new Map<string, number>(),
    activeApiByBaseUrl: new Map<string, number>(),
  };
  for (const record of discovered) {
    if (record.status !== 'active') continue;
    incrementCount(context.activeDiscoveredByCategory, record.category);
    incrementCount(context.activeDiscoveredByDomain, record.domain);
  }
  for (const record of apiSources) {
    if (record.status !== 'active') continue;
    incrementCount(context.activeApiByCategory, record.category);
    incrementCount(context.activeApiByBaseUrl, record.baseUrl);
  }
  return context;
}

function discoveredSourceBias(value: DiscoveredSourceRecord['discoveredBy']): number {
  if (value === 'manual') return 0;
  if (value === 'codex-playwright') return 0;
  if (value === 'playwright') return 0;
  if (value === 'heuristic') return 0;
  return 0;
}

function apiSourceBias(value: ApiSourceRecord['discoveredBy']): number {
  if (value === 'manual') return 0;
  if (value === 'codex-playwright') return 0;
  if (value === 'playwright') return 0;
  if (value === 'heuristic') return 0;
  return 0;
}

function withinCooldown(updatedAtMs: number, cooldownHours: number): boolean {
  return Date.now() - updatedAtMs < cooldownHours * 60 * 60 * 1000;
}

function scoreDiscovered(record: DiscoveredSourceRecord, policy: SourceAutomationPolicy, context: SourceAutomationContext): number {
  const topicCount = record.topics?.length || 0;
  let score = record.confidence;
  score += Math.min(12, topicCount * 3);
  score += discoveredSourceBias(record.discoveredBy);
  score += isFeedLikeUrl(record.url) ? 10 : -12;
  score -= Math.min(14, (context.activeDiscoveredByCategory.get(record.category) || 0) * 4);
  score -= Math.min(18, (context.activeDiscoveredByDomain.get(record.domain) || 0) * 12);
  if (policy.mode === 'guarded-auto' && record.discoveredBy === 'heuristic' && topicCount < policy.minDiscoveredTopicCount) {
    score -= 12;
  }
  if (withinCooldown(record.updatedAt, policy.cooldownHours)) {
    score -= 8;
  }
  return clamp(Math.round(score), 0, 100);
}

function scoreApi(record: ApiSourceRecord, policy: SourceAutomationPolicy, context: SourceAutomationContext): number {
  let score = record.confidence;
  score += apiSourceBias(record.discoveredBy);
  if (record.healthStatus === 'ok') score += 8;
  else if (record.healthStatus === 'degraded') score += 1;
  else if (record.healthStatus === 'down') score -= 18;
  if (record.schemaHint === 'json' || record.schemaHint === 'xml') score += 4;
  if (record.hasRateLimitInfo) score += 4;
  if (record.hasTosInfo) score += 4;
  score -= Math.min(14, (context.activeApiByCategory.get(record.category) || 0) * 4);
  score -= Math.min(18, (context.activeApiByBaseUrl.get(record.baseUrl) || 0) * 12);
  if (withinCooldown(record.updatedAt, policy.cooldownHours)) {
    score -= 6;
  }
  return clamp(Math.round(score), 0, 100);
}

function canActivateDiscoveredInCycle(
  record: DiscoveredSourceRecord,
  policy: SourceAutomationPolicy,
  activatedByCategory: Map<string, number>,
  activatedByDomain: Map<string, number>,
): boolean {
  return (activatedByCategory.get(record.category) || 0) < policy.maxDiscoveredActivationsPerCategory
    && (activatedByDomain.get(record.domain) || 0) < policy.maxDiscoveredActivationsPerDomain;
}

function canActivateApiInCycle(
  record: ApiSourceRecord,
  policy: SourceAutomationPolicy,
  activatedByCategory: Map<string, number>,
  activatedByBaseUrl: Map<string, number>,
): boolean {
  return (activatedByCategory.get(record.category) || 0) < policy.maxApiActivationsPerCategory
    && (activatedByBaseUrl.get(record.baseUrl) || 0) < policy.maxApiActivationsPerBaseUrl;
}

function discoveredScoreNote(record: DiscoveredSourceRecord, score: number): string {
  return `Auto-reviewed by source policy: score=${score}, topics=${record.topics?.length || 0}, domain=${record.domain}, discoveredBy=${record.discoveredBy}.`;
}

function apiScoreNote(record: ApiSourceRecord, score: number): string {
  return `Auto-reviewed by API source policy: score=${score}, health=${record.healthStatus}, schema=${record.schemaHint}, discoveredBy=${record.discoveredBy}.`;
}

function staleHealth(record: ApiSourceRecord, staleHealthHours: number): boolean {
  if (!record.lastCheckedAt) return true;
  return Date.now() - record.lastCheckedAt >= staleHealthHours * 60 * 60 * 1000;
}

export async function runSourceAutomationSweep(policyInput?: Partial<SourceAutomationPolicy> | null): Promise<SourceAutomationSweepResult> {
  const policy = normalizeSourceAutomationPolicy(policyInput);
  const result: SourceAutomationSweepResult = {
    mode: policy.mode,
    discoveredApproved: [],
    discoveredActivated: [],
    apiApproved: [],
    apiActivated: [],
    refreshedApiHealth: [],
  };

  if (policy.mode === 'manual') return result;

  let discovered = await listDiscoveredSources();
  let apiSources = await listApiSourceRegistry();
  let context = buildContext(discovered, apiSources);

  const discoveredApprovals = discovered
    .filter((record) => record.status === 'draft')
    .map((record) => ({ record, score: scoreDiscovered(record, policy, context) }))
    .sort((a, b) => b.score - a.score || b.record.confidence - a.record.confidence);

  for (const { record, score } of discoveredApprovals) {
    if (policy.requireFeedLikeUrl && !isFeedLikeUrl(record.url)) continue;
    if ((record.topics?.length || 0) < policy.minDiscoveredTopicCount && policy.mode === 'guarded-auto') continue;
    if (score < policy.minDiscoveredApproveConfidence) continue;
    if (policy.mode === 'guarded-auto' && record.discoveredBy === 'manual') continue;
    const next = await setDiscoveredSourceStatus(record.id, 'approved', {
      actor: 'system',
      note: discoveredScoreNote(record, score),
    });
    if (next) result.discoveredApproved.push(next.id);
  }

  discovered = await listDiscoveredSources();
  apiSources = await listApiSourceRegistry();
  context = buildContext(discovered, apiSources);
  const activatedDiscoveredByCategory = new Map<string, number>();
  const activatedDiscoveredByDomain = new Map<string, number>();

  const discoveredActivations = discovered
    .filter((record) => record.status === 'approved')
    .map((record) => ({ record, score: scoreDiscovered(record, policy, context) }))
    .sort((a, b) => b.score - a.score || b.record.confidence - a.record.confidence);

  for (const { record, score } of discoveredActivations) {
    if (result.discoveredActivated.length >= policy.maxDiscoveredActivationsPerCycle) break;
    if (policy.requireFeedLikeUrl && !isFeedLikeUrl(record.url)) continue;
    if (score < policy.minDiscoveredActivateConfidence) continue;
    if (!canActivateDiscoveredInCycle(record, policy, activatedDiscoveredByCategory, activatedDiscoveredByDomain)) continue;
    const next = await setDiscoveredSourceStatus(record.id, 'active', {
      actor: 'system',
      note: discoveredScoreNote(record, score),
    });
    if (next) {
      result.discoveredActivated.push(next.id);
      incrementCount(activatedDiscoveredByCategory, record.category);
      incrementCount(activatedDiscoveredByDomain, record.domain);
    }
  }

  apiSources = await listApiSourceRegistry();
  for (const record of apiSources
    .filter((item) => item.status !== 'active' && item.status !== 'rejected' && staleHealth(item, policy.staleHealthHours))
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, policy.healthRefreshBatch)) {
    const next = await refreshApiSourceHealth(record.id).catch(() => null);
    if (next) result.refreshedApiHealth.push(next.id);
  }

  apiSources = await listApiSourceRegistry();
  discovered = await listDiscoveredSources();
  context = buildContext(discovered, apiSources);

  const apiApprovals = apiSources
    .filter((record) => record.status === 'draft')
    .map((record) => ({ record, score: scoreApi(record, policy, context) }))
    .sort((a, b) => b.score - a.score || b.record.confidence - a.record.confidence);

  for (const { record, score } of apiApprovals) {
    if (score < policy.minApiApproveConfidence) continue;
    if (policy.mode === 'guarded-auto' && record.discoveredBy === 'manual') continue;
    const next = await setApiSourceStatusWithMeta(record.id, 'approved', {
      actor: 'system',
      note: apiScoreNote(record, score),
    });
    if (next) result.apiApproved.push(next.id);
  }

  apiSources = await listApiSourceRegistry();
  discovered = await listDiscoveredSources();
  context = buildContext(discovered, apiSources);
  const activatedApiByCategory = new Map<string, number>();
  const activatedApiByBaseUrl = new Map<string, number>();

  const apiActivations = apiSources
    .filter((record) => record.status === 'approved')
    .map((record) => ({ record, score: scoreApi(record, policy, context) }))
    .sort((a, b) => b.score - a.score || b.record.confidence - a.record.confidence);

  for (const { record, score } of apiActivations) {
    if (result.apiActivated.length >= policy.maxApiActivationsPerCycle) break;
    if (score < policy.minApiActivateConfidence) continue;
    if (policy.requireHealthyApi && record.healthStatus !== 'ok') continue;
    if (!canActivateApiInCycle(record, policy, activatedApiByCategory, activatedApiByBaseUrl)) continue;
    const next = await setApiSourceStatusWithMeta(record.id, 'active', {
      actor: 'system',
      note: apiScoreNote(record, score),
    });
    if (next) {
      result.apiActivated.push(next.id);
      incrementCount(activatedApiByCategory, record.category);
      incrementCount(activatedApiByBaseUrl, record.baseUrl);
    }
  }

  return result;
}
