import type { ThemeDiscoveryQueueItem } from './theme-discovery';

export type DatasetHistoricalProvider = 'fred' | 'alfred' | 'gdelt-doc' | 'coingecko' | 'acled';
export type DatasetAutomationMode = 'manual' | 'guarded-auto' | 'full-auto';

export interface DatasetRegistryLike {
  id: string;
  label: string;
  enabled: boolean;
  provider: DatasetHistoricalProvider;
  fetchArgs: Record<string, string | number | boolean>;
  importOptions?: Record<string, unknown>;
  replayOptions?: Record<string, unknown>;
  walkForwardOptions?: Record<string, unknown>;
  frameLoadOptions?: Record<string, unknown>;
  schedule?: Record<string, unknown>;
}

export interface DatasetDiscoveryThemeInput {
  themeId: string;
  label: string;
  triggers: string[];
  sectors: string[];
  commodities: string[];
  supportingHeadlines?: string[];
  suggestedSymbols?: string[];
  datasetIds?: string[];
  priority?: number;
}

export interface DatasetProposal {
  id: string;
  label: string;
  provider: DatasetHistoricalProvider;
  confidence: number;
  proposalScore: number;
  rationale: string;
  querySummary: string;
  sourceThemeId: string;
  fetchArgs: Record<string, string | number | boolean>;
  pitSafety: 'high' | 'medium' | 'low';
  estimatedCost: 'low' | 'medium' | 'high';
  autoRegister: boolean;
  autoEnable: boolean;
}

export interface DatasetDiscoveryPolicy {
  mode: DatasetAutomationMode;
  minProposalScore: number;
  autoRegisterScore: number;
  autoEnableScore: number;
  maxRegistrationsPerCycle: number;
  maxEnabledDatasets: number;
  allowProviders: DatasetHistoricalProvider[];
}

const DEFAULT_POLICY: DatasetDiscoveryPolicy = {
  mode: 'guarded-auto',
  minProposalScore: 58,
  autoRegisterScore: 72,
  autoEnableScore: 86,
  maxRegistrationsPerCycle: 2,
  maxEnabledDatasets: 10,
  allowProviders: ['fred', 'alfred', 'gdelt-doc', 'coingecko', 'acled'],
};

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function normalize(value: string): string {
  return String(value || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function slugify(value: string): string {
  return normalize(value).replace(/\s+/g, '-').slice(0, 96) || 'dataset';
}

function dedupe<T>(items: T[]): T[] {
  return Array.from(new Set(items));
}

function themeBlob(theme: DatasetDiscoveryThemeInput): string {
  return normalize([
    theme.label,
    ...(theme.triggers || []),
    ...(theme.sectors || []),
    ...(theme.commodities || []),
    ...(theme.supportingHeadlines || []),
    ...(theme.suggestedSymbols || []),
  ].join(' '));
}

function pickCountry(blob: string): string | null {
  const checks: Array<[RegExp, string]> = [
    [/\b(iran|tehran|hormuz|kharg)\b/, 'Iran'],
    [/\b(israel|gaza|hamas|hezbollah|lebanon)\b/, 'Israel'],
    [/\b(ukraine|kyiv|donbas|crimea)\b/, 'Ukraine'],
    [/\b(russia|moscow)\b/, 'Russia'],
    [/\b(taiwan|taipei)\b/, 'Taiwan'],
    [/\b(china|beijing)\b/, 'China'],
    [/\b(yemen|houthi|red sea)\b/, 'Yemen'],
  ];
  return checks.find(([pattern]) => pattern.test(blob))?.[1] || null;
}

function topTerms(theme: DatasetDiscoveryThemeInput): string[] {
  return dedupe([
    ...theme.triggers,
    ...theme.sectors,
    ...theme.commodities,
  ].map((value) => normalize(value)).filter((value) => value.length >= 3)).slice(0, 6);
}

function buildGdeltProposal(theme: DatasetDiscoveryThemeInput, priority: number): DatasetProposal | null {
  const terms = topTerms(theme);
  if (!terms.length) return null;
  const query = terms.map((term) => term.includes(' ') ? `"${term}"` : term).join(' OR ');
  const confidence = clamp(Math.round(priority * 0.74 + 18), 40, 96);
  return {
    id: `gdelt-${slugify(theme.label)}`,
    label: `${theme.label} / GDELT Event Feed`,
    provider: 'gdelt-doc',
    confidence,
    proposalScore: clamp(Math.round(confidence + Math.min(8, terms.length * 2)), 0, 100),
    rationale: `Repeated event motif ${theme.label} needs a broader historical news archive for replay and theme drift checks.`,
    querySummary: query,
    sourceThemeId: theme.themeId,
    fetchArgs: {
      query,
      mode: 'ArtList',
      max: 250,
    },
    pitSafety: 'medium',
    estimatedCost: 'low',
    autoRegister: false,
    autoEnable: false,
  };
}

function buildAcledProposal(theme: DatasetDiscoveryThemeInput, priority: number): DatasetProposal | null {
  const blob = themeBlob(theme);
  const country = pickCountry(blob);
  if (!country) return null;
  const confidence = clamp(Math.round(priority * 0.72 + 16), 38, 94);
  return {
    id: `acled-${slugify(country)}-${slugify(theme.label).slice(0, 36)}`,
    label: `${country} Conflict Events / ${theme.label}`,
    provider: 'acled',
    confidence,
    proposalScore: clamp(Math.round(confidence + 6), 0, 100),
    rationale: `Structured conflict events can validate whether ${theme.label} is supported by real-world incident frequency, not only headlines.`,
    querySummary: `${country} conflict events`,
    sourceThemeId: theme.themeId,
    fetchArgs: {
      country,
      event_types: 'Battles|Explosions/Remote violence|Violence against civilians',
      limit: 500,
    },
    pitSafety: 'high',
    estimatedCost: 'medium',
    autoRegister: false,
    autoEnable: false,
  };
}

function buildMacroFredProposal(theme: DatasetDiscoveryThemeInput, priority: number): DatasetProposal[] {
  const blob = themeBlob(theme);
  const proposals: DatasetProposal[] = [];
  const candidates: Array<{ id: string; label: string; series: string; reason: string }> = [];
  if (/\b(inflation|cpi|prices|tariff|yield|rates|bond|macro|fed|treasury)\b/.test(blob)) {
    candidates.push(
      { id: 'fred-cpi-core', label: 'FRED CPI Core', series: 'CPIAUCSL', reason: 'Inflation-sensitive themes should anchor against CPI and inflation persistence.' },
      { id: 'fred-yield-curve', label: 'FRED Yield Curve', series: 'T10Y2Y', reason: 'Macro risk should observe curve inversion and growth stress.' },
      { id: 'alfred-cpi-vintage', label: 'ALFRED CPI Vintage', series: 'CPIAUCSL', reason: 'Vintage macro data improves point-in-time replay and revision awareness.' },
    );
  }
  for (const candidate of candidates) {
    const provider = candidate.id.startsWith('alfred-') ? 'alfred' : 'fred';
    const confidence = clamp(Math.round(priority * 0.68 + (provider === 'alfred' ? 18 : 14)), 36, 95);
    proposals.push({
      id: `${candidate.id}-${slugify(theme.label).slice(0, 28)}`,
      label: `${candidate.label} / ${theme.label}`,
      provider,
      confidence,
      proposalScore: clamp(Math.round(confidence + (provider === 'alfred' ? 4 : 2)), 0, 100),
      rationale: candidate.reason,
      querySummary: candidate.series,
      sourceThemeId: theme.themeId,
      fetchArgs: provider === 'alfred'
        ? { series: candidate.series, observation_start: '2018-01-01', limit: 5000 }
        : { series: candidate.series, observation_start: '2018-01-01', limit: 5000 },
      pitSafety: provider === 'alfred' ? 'high' : 'medium',
      estimatedCost: 'low',
      autoRegister: false,
      autoEnable: false,
    });
  }
  return proposals;
}

function buildCryptoProposal(theme: DatasetDiscoveryThemeInput, priority: number): DatasetProposal[] {
  const blob = themeBlob(theme);
  const entries: Array<[RegExp, string, string]> = [
    [/\b(bitcoin|btc|crypto)\b/, 'bitcoin', 'BTC Core'],
    [/\b(ethereum|eth)\b/, 'ethereum', 'ETH Core'],
  ];
  return entries
    .filter(([pattern]) => pattern.test(blob))
    .map(([, id, label]) => {
      const confidence = clamp(Math.round(priority * 0.7 + 12), 34, 92);
      return {
        id: `coingecko-${slugify(id)}-${slugify(theme.label).slice(0, 28)}`,
        label: `CoinGecko ${label} / ${theme.label}`,
        provider: 'coingecko' as const,
        confidence,
        proposalScore: clamp(Math.round(confidence + 3), 0, 100),
        rationale: `${label} pricing is needed to validate whether ${theme.label} has repeatable crypto-market transmission.`,
        querySummary: id,
        sourceThemeId: theme.themeId,
        fetchArgs: { id, vs: 'usd', days: 365 },
        pitSafety: 'medium',
        estimatedCost: 'low',
        autoRegister: false,
        autoEnable: false,
      };
    });
}

export function normalizeDatasetDiscoveryPolicy(policy?: Partial<DatasetDiscoveryPolicy> | null): DatasetDiscoveryPolicy {
  return {
    mode: policy?.mode === 'manual' || policy?.mode === 'guarded-auto' || policy?.mode === 'full-auto'
      ? policy.mode
      : DEFAULT_POLICY.mode,
    minProposalScore: clamp(Number(policy?.minProposalScore) || DEFAULT_POLICY.minProposalScore, 35, 98),
    autoRegisterScore: clamp(Number(policy?.autoRegisterScore) || DEFAULT_POLICY.autoRegisterScore, 40, 99),
    autoEnableScore: clamp(Number(policy?.autoEnableScore) || DEFAULT_POLICY.autoEnableScore, 45, 99),
    maxRegistrationsPerCycle: clamp(Number(policy?.maxRegistrationsPerCycle) || DEFAULT_POLICY.maxRegistrationsPerCycle, 1, 8),
    maxEnabledDatasets: clamp(Number(policy?.maxEnabledDatasets) || DEFAULT_POLICY.maxEnabledDatasets, 1, 48),
    allowProviders: Array.isArray(policy?.allowProviders) && policy!.allowProviders!.length
      ? policy!.allowProviders!.filter((value): value is DatasetHistoricalProvider => (
        value === 'fred' || value === 'alfred' || value === 'gdelt-doc' || value === 'coingecko' || value === 'acled'
      ))
      : DEFAULT_POLICY.allowProviders.slice(),
  };
}

export function proposeDatasetsForThemes(args: {
  themes: DatasetDiscoveryThemeInput[];
  existingDatasets: DatasetRegistryLike[];
  policy?: Partial<DatasetDiscoveryPolicy> | null;
  queueItems?: ThemeDiscoveryQueueItem[];
}): DatasetProposal[] {
  const policy = normalizeDatasetDiscoveryPolicy(args.policy);
  const existingIds = new Set(args.existingDatasets.map((dataset) => dataset.id));
  const enabledCount = args.existingDatasets.filter((dataset) => dataset.enabled).length;
  const proposals = new Map<string, DatasetProposal>();

  for (const theme of args.themes) {
    const priority = clamp(Number(theme.priority) || 60, 25, 95);
    const candidates = [
      buildGdeltProposal(theme, priority),
      buildAcledProposal(theme, priority),
      ...buildMacroFredProposal(theme, priority),
      ...buildCryptoProposal(theme, priority),
    ].filter((proposal): proposal is DatasetProposal => Boolean(proposal));

    for (const proposal of candidates) {
      if (!policy.allowProviders.includes(proposal.provider)) continue;
      if (existingIds.has(proposal.id)) continue;
      if (proposal.proposalScore < policy.minProposalScore) continue;
      const previous = proposals.get(proposal.id);
      if (!previous || previous.proposalScore < proposal.proposalScore) {
        proposals.set(proposal.id, proposal);
      }
    }
  }

  return Array.from(proposals.values())
    .sort((a, b) => b.proposalScore - a.proposalScore || b.confidence - a.confidence || a.label.localeCompare(b.label))
    .map((proposal, index) => {
      const autoRegister = policy.mode !== 'manual'
        && proposal.proposalScore >= policy.autoRegisterScore
        && index < policy.maxRegistrationsPerCycle;
      const autoEnable = autoRegister
        && enabledCount + index < policy.maxEnabledDatasets
        && proposal.proposalScore >= policy.autoEnableScore
        && proposal.pitSafety !== 'low'
        && proposal.estimatedCost !== 'high';
      return {
        ...proposal,
        autoRegister,
        autoEnable,
      };
    })
    .slice(0, Math.max(4, policy.maxRegistrationsPerCycle * 3));
}

export function autoRegisterDatasetProposals(args: {
  registryDatasets: DatasetRegistryLike[];
  proposals: DatasetProposal[];
  policy?: Partial<DatasetDiscoveryPolicy> | null;
}): { datasets: DatasetRegistryLike[]; registered: DatasetProposal[] } {
  const policy = normalizeDatasetDiscoveryPolicy(args.policy);
  if (policy.mode === 'manual') {
    return { datasets: args.registryDatasets.slice(), registered: [] };
  }
  const existing = new Map(args.registryDatasets.map((dataset) => [dataset.id, { ...dataset }] as const));
  const registered: DatasetProposal[] = [];
  let enabledCount = args.registryDatasets.filter((dataset) => dataset.enabled).length;

  for (const proposal of args.proposals) {
    if (!proposal.autoRegister) continue;
    if (existing.has(proposal.id)) continue;
    const enableNow = proposal.autoEnable && enabledCount < policy.maxEnabledDatasets;
    if (enableNow) enabledCount += 1;
    existing.set(proposal.id, {
      id: proposal.id,
      label: proposal.label,
      enabled: enableNow,
      provider: proposal.provider,
      fetchArgs: proposal.fetchArgs,
      importOptions: {},
      replayOptions: {},
      walkForwardOptions: {},
      frameLoadOptions: {},
      schedule: {},
    });
    registered.push({
      ...proposal,
      autoEnable: enableNow,
    });
    if (registered.length >= policy.maxRegistrationsPerCycle) break;
  }

  return {
    datasets: Array.from(existing.values()).sort((a, b) => a.label.localeCompare(b.label)),
    registered,
  };
}
