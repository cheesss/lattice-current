import type { ApiSourceRecord } from './api-source-registry';
import type { RemoteAutomationStatusPayload, LocalAutomationOpsSnapshotPayload } from './intelligence-automation-remote';
import type { KeywordRecord } from './keyword-registry';
import type { DiscoveredSourceRecord } from './source-registry';

export type AutomationGovernanceStatus = 'ready' | 'watch' | 'blocked';
export type AutomationMaturityLevel = 'manual' | 'assisted' | 'guarded-auto' | 'full-auto';
export type AutomationBiasRisk = 'low' | 'medium' | 'high';

export interface AutomationGovernanceShare {
  label: string;
  count: number;
  pct: number;
}

export interface AutomationGovernanceFeature {
  id: string;
  label: string;
  level: AutomationMaturityLevel;
  status: AutomationGovernanceStatus;
  score: number;
  biasRisk: AutomationBiasRisk;
  detail: string;
  touchpoints: string[];
}

export interface AutomationGovernanceSnapshot {
  status: AutomationGovernanceStatus;
  automationScore: number;
  humanTouchpoints: string[];
  biasWarnings: string[];
  features: AutomationGovernanceFeature[];
  sourceOrigins: AutomationGovernanceShare[];
  sourceDomains: AutomationGovernanceShare[];
  keywordDomains: AutomationGovernanceShare[];
  themeDatasets: AutomationGovernanceShare[];
  datasetProviders: AutomationGovernanceShare[];
}

function levelScore(level: AutomationMaturityLevel): number {
  if (level === 'full-auto') return 92;
  if (level === 'guarded-auto') return 72;
  if (level === 'assisted') return 48;
  return 18;
}

function pct(value: number, total: number): number {
  if (!Number.isFinite(total) || total <= 0) return 0;
  return Math.round((value / total) * 1000) / 10;
}

function pushCount(map: Map<string, number>, label: string): void {
  const key = String(label || '').trim();
  if (!key) return;
  map.set(key, (map.get(key) || 0) + 1);
}

function buildShares(values: string[], limit = 6): AutomationGovernanceShare[] {
  const counts = new Map<string, number>();
  for (const value of values) pushCount(counts, value);
  const total = values.length;
  return Array.from(counts.entries())
    .map(([label, count]) => ({ label, count, pct: pct(count, total) }))
    .sort((left, right) => right.count - left.count || left.label.localeCompare(right.label))
    .slice(0, limit);
}

function topShare(shares: AutomationGovernanceShare[]): AutomationGovernanceShare | null {
  return shares[0] || null;
}

function worseStatus(left: AutomationGovernanceStatus, right: AutomationGovernanceStatus): AutomationGovernanceStatus {
  const rank = (value: AutomationGovernanceStatus): number => (value === 'blocked' ? 2 : value === 'watch' ? 1 : 0);
  return rank(right) > rank(left) ? right : left;
}

function levelFromThemeMode(mode: string | undefined): AutomationMaturityLevel {
  if (mode === 'full-auto') return 'full-auto';
  if (mode === 'guarded-auto') return 'guarded-auto';
  return 'manual';
}

export function buildAutomationGovernanceSnapshot(args: {
  status: RemoteAutomationStatusPayload | null;
  localOps: LocalAutomationOpsSnapshotPayload | null;
  discoveredSources: DiscoveredSourceRecord[];
  apiSources: ApiSourceRecord[];
  keywords: KeywordRecord[];
}): AutomationGovernanceSnapshot {
  const enabledDatasets = args.status?.registry.datasets.filter((dataset) => dataset.enabled) || [];
  const promotedThemes = args.status?.state.promotedThemes || [];
  const openThemeQueue = args.status?.state.themeQueue.filter((item) => item.status === 'open') || [];
  const datasetProposals = args.status?.state.datasetProposals || [];
  const activeKeywords = args.keywords.filter((record) => record.status === 'active');
  const sourceOrigins = buildShares([
    ...args.discoveredSources.map((record) => record.discoveredBy),
    ...args.apiSources.map((record) => record.discoveredBy),
  ]);
  const sourceDomains = buildShares(args.discoveredSources.map((record) => record.domain));
  const keywordDomains = buildShares(activeKeywords.map((record) => record.domain));
  const datasetProviders = buildShares([
    ...enabledDatasets.map((dataset) => dataset.provider),
    ...datasetProposals.map((proposal) => proposal.provider),
  ]);

  const queueByTopicKey = new Map((args.status?.state.themeQueue || []).map((item) => [item.topicKey, item] as const));
  const themeDatasets = buildShares([
    ...openThemeQueue.flatMap((item) => item.datasetIds || []),
    ...promotedThemes.flatMap((entry) => queueByTopicKey.get(entry.sourceTopicKey)?.datasetIds || []),
  ]);

  const missingRequiredKeys = args.localOps?.credentials?.missingRequiredKeys || [];
  const codexLoggedIn = Boolean(args.localOps?.codex?.available && args.localOps?.codex?.loggedIn);
  const sourceOriginTop = topShare(sourceOrigins);
  const sourceDomainTop = topShare(sourceDomains);
  const keywordDomainTop = topShare(keywordDomains);
  const datasetProviderTop = topShare(datasetProviders);
  const themeDatasetTop = topShare(themeDatasets);
  const humanTouchpoints: string[] = [];
  const biasWarnings: string[] = [];

  if (missingRequiredKeys.length > 0) {
    humanTouchpoints.push(`Provider credentials still require manual setup: ${missingRequiredKeys.join(', ')}.`);
  }
  if (!codexLoggedIn) {
    humanTouchpoints.push('Codex login is still a manual prerequisite for theme, dataset, and candidate proposal loops.');
  }
  humanTouchpoints.push('Final portfolio deployment remains human-controlled; the app produces decision support, not unattended live execution.');
  if (args.discoveredSources.some((record) => record.discoveredBy === 'manual') || args.apiSources.some((record) => record.discoveredBy === 'manual')) {
    humanTouchpoints.push('Manual source entries still need explicit review because guarded-auto does not blindly promote manual records.');
  }

  if ((sourceOriginTop?.pct || 0) >= 65) {
    biasWarnings.push(`Source discovery is concentrated in ${sourceOriginTop?.label} origins (${sourceOriginTop?.pct}%). New-source flow may be overfitting to one discovery path.`);
  }
  if ((sourceDomainTop?.pct || 0) >= 55) {
    biasWarnings.push(`Discovered source domains are concentrated in ${sourceDomainTop?.label} (${sourceDomainTop?.pct}%). Domain diversity may be too narrow.`);
  }
  if ((keywordDomainTop?.pct || 0) >= 48) {
    biasWarnings.push(`Active keyword automation is skewed toward ${keywordDomainTop?.label} (${keywordDomainTop?.pct}%). Slower domains may be under-sampled.`);
  }
  if ((datasetProviderTop?.pct || 0) >= 55) {
    biasWarnings.push(`Historical dataset coverage is concentrated in ${datasetProviderTop?.label} (${datasetProviderTop?.pct}%). Provider concentration may bias replay evidence.`);
  }
  if ((themeDatasetTop?.pct || 0) >= 55) {
    biasWarnings.push(`Theme discovery is leaning heavily on ${themeDatasetTop?.label} (${themeDatasetTop?.pct}%). Motif promotion may be too dependent on one dataset family.`);
  }

  const features: AutomationGovernanceFeature[] = [
    {
      id: 'historical-pipeline',
      label: 'Historical fetch / import / replay / walk-forward',
      level: enabledDatasets.length > 0 ? 'full-auto' : 'manual',
      status: enabledDatasets.length > 0 ? 'ready' : 'watch',
      score: enabledDatasets.length > 0 ? 90 : 24,
      biasRisk: (datasetProviderTop?.pct || 0) >= 55 ? 'high' : (datasetProviderTop?.pct || 0) >= 40 ? 'medium' : 'low',
      detail: enabledDatasets.length > 0
        ? `${enabledDatasets.length} enabled datasets are already in unattended historical cycles.`
        : 'No enabled historical dataset is currently feeding unattended replay cycles.',
      touchpoints: missingRequiredKeys.length > 0 ? ['Credentials can still block protected providers.'] : [],
    },
    {
      id: 'source-discovery',
      label: 'New source / API discovery',
      level: 'assisted',
      status: args.discoveredSources.length + args.apiSources.length > 0 ? 'watch' : 'blocked',
      score: 46,
      biasRisk: (sourceOriginTop?.pct || 0) >= 65 || (sourceDomainTop?.pct || 0) >= 55 ? 'high' : 'medium',
      detail: `${args.discoveredSources.length} feed candidates and ${args.apiSources.length} API candidates are trackable, but net-new discovery still depends on hunts and validation.`,
      touchpoints: ['Initial hunts and unusual sources still need human or Codex-triggered discovery.'],
    },
    {
      id: 'keyword-lifecycle',
      label: 'Keyword lifecycle and autonomous topics',
      level: 'full-auto',
      status: activeKeywords.length > 0 ? 'ready' : 'watch',
      score: 88,
      biasRisk: (keywordDomainTop?.pct || 0) >= 48 ? 'high' : 'medium',
      detail: `${activeKeywords.length} active keywords are being pruned and refreshed automatically.`,
      touchpoints: ['Keyword quality still depends on available source diversity and recency.'],
    },
    {
      id: 'theme-promotion',
      label: 'Theme queue and promotion',
      level: levelFromThemeMode(args.status?.registry.themeAutomation.mode),
      status: args.status?.registry.themeAutomation.mode === 'manual'
        ? 'watch'
        : !codexLoggedIn
          ? 'blocked'
          : promotedThemes.length > 0 || openThemeQueue.length > 0
            ? 'ready'
            : 'watch',
      score: levelScore(levelFromThemeMode(args.status?.registry.themeAutomation.mode)),
      biasRisk: (themeDatasetTop?.pct || 0) >= 55 ? 'high' : 'medium',
      detail: `${openThemeQueue.length} motifs are open and ${promotedThemes.length} themes have been promoted under ${args.status?.registry.themeAutomation.mode || 'manual'} mode.`,
      touchpoints: codexLoggedIn ? [] : ['Theme proposal promotion still stops when Codex is unavailable.'],
    },
    {
      id: 'dataset-discovery',
      label: 'Dataset proposal, validation, and enablement',
      level: args.status?.registry.datasetAutomation.enabled ? 'guarded-auto' : 'manual',
      status: args.status?.registry.datasetAutomation.enabled ? 'ready' : 'watch',
      score: args.status?.registry.datasetAutomation.enabled ? 72 : 24,
      biasRisk: (datasetProviderTop?.pct || 0) >= 55 ? 'high' : (datasetProviderTop?.pct || 0) >= 40 ? 'medium' : 'low',
      detail: `${datasetProposals.length} dataset proposals are in play, with mini-replay validation guarding auto-enable.`,
      touchpoints: ['Provider allow-lists and credentials still constrain the discovery universe.'],
    },
    {
      id: 'candidate-expansion',
      label: 'Candidate / asset expansion',
      level: codexLoggedIn ? 'guarded-auto' : 'assisted',
      status: args.localOps?.automation?.state?.lastCandidateExpansionAt ? 'ready' : 'watch',
      score: codexLoggedIn ? 68 : 42,
      biasRisk: 'medium',
      detail: args.localOps?.automation?.state?.lastCandidateExpansionAt
        ? `Candidate expansion last ran ${args.localOps.automation.state.lastCandidateExpansionAt}.`
        : 'Candidate expansion is available but has not recently refreshed.',
      touchpoints: codexLoggedIn ? [] : ['Candidate proposals still depend on Codex availability.'],
    },
    {
      id: 'risk-deployment',
      label: 'Live investment deployment',
      level: 'manual',
      status: 'watch',
      score: 12,
      biasRisk: 'low',
      detail: 'The system currently supports decision assistance and portfolio suggestions; humans still approve real capital deployment.',
      touchpoints: ['Human approval is intentionally required before any real portfolio change.'],
    },
  ];

  let status: AutomationGovernanceStatus = 'ready';
  if (biasWarnings.length > 0) status = worseStatus(status, 'watch');
  if (missingRequiredKeys.length > 0 || !codexLoggedIn) status = worseStatus(status, 'blocked');
  const automationScore = Math.round(features.reduce((sum, feature) => sum + feature.score, 0) / Math.max(1, features.length));

  return {
    status,
    automationScore,
    humanTouchpoints,
    biasWarnings,
    features,
    sourceOrigins,
    sourceDomains,
    keywordDomains,
    themeDatasets,
    datasetProviders,
  };
}
