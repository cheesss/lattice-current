import type { HistoricalBackfillOptions, HistoricalFrameLoadOptions } from './importer/historical-stream-worker';
import type { HistoricalReplayOptions, WalkForwardBacktestOptions } from './historical-intelligence';
import type { ThemeDiscoveryQueueItem } from './theme-discovery';
import { AUTOMATION_THRESHOLDS } from '@/config/automation-thresholds';
import { STOP_WORDS, SUPPRESSED_TRENDING_TERMS } from '@/utils/analysis-constants';

export type DatasetHistoricalProvider = 'fred' | 'alfred' | 'gdelt-doc' | 'coingecko' | 'acled' | 'yahoo-chart' | 'rss-feed';
export type DatasetAutomationMode = 'manual' | 'guarded-auto' | 'full-auto';

export interface DatasetRegistryLike {
  id: string;
  label: string;
  enabled: boolean;
  provider: DatasetHistoricalProvider;
  fetchArgs: Record<string, string | number | boolean>;
  importOptions?: Partial<HistoricalBackfillOptions>;
  replayOptions?: Partial<HistoricalReplayOptions>;
  walkForwardOptions?: Partial<WalkForwardBacktestOptions>;
  frameLoadOptions?: Partial<HistoricalFrameLoadOptions>;
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
  proposedBy: 'heuristic' | 'codex';
  confidence: number;
  proposalScore: number;
  rationale: string;
  querySummary: string;
  sourceThemeId: string;
  fetchArgs: Record<string, string | number | boolean>;
  importOptions?: Partial<HistoricalBackfillOptions>;
  replayOptions?: Partial<HistoricalReplayOptions>;
  walkForwardOptions?: Partial<WalkForwardBacktestOptions>;
  frameLoadOptions?: Partial<HistoricalFrameLoadOptions>;
  schedule?: Record<string, unknown>;
  pitSafety: 'high' | 'medium' | 'low';
  estimatedCost: 'low' | 'medium' | 'high';
  valueScore?: number;
  coverageGain?: number;
  utilityGain?: number;
  regimeDiversificationGain?: number;
  validationStatus?: 'pending' | 'passed' | 'failed' | 'skipped';
  validationSummary?: string;
  miniReplayScore?: number;
  miniReplayFrameCount?: number;
  miniReplayIdeaRunCount?: number;
  miniReplayCostAdjustedAvgReturnPct?: number;
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
  mode: AUTOMATION_THRESHOLDS.theme.mode,
  minProposalScore: AUTOMATION_THRESHOLDS.dataset.minProposalScore,
  autoRegisterScore: AUTOMATION_THRESHOLDS.dataset.autoRegisterScore,
  autoEnableScore: AUTOMATION_THRESHOLDS.dataset.autoEnableScore,
  maxRegistrationsPerCycle: AUTOMATION_THRESHOLDS.dataset.maxRegistrationsPerCycle,
  maxEnabledDatasets: AUTOMATION_THRESHOLDS.dataset.maxEnabledDatasets,
  allowProviders: ['fred', 'alfred', 'gdelt-doc', 'coingecko', 'acled', 'yahoo-chart', 'rss-feed'],
};

const RSS_QUERY_BLOCKLIST = new Set([
  ...STOP_WORDS,
  ...SUPPRESSED_TRENDING_TERMS,
  'technology',
  'science',
  'environment',
  'society',
  'health',
  'hl',
  'gl',
  'ceid',
  'when',
]);

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

function takeFirst<T>(items: T[], limit: number): T[] {
  return items.slice(0, Math.max(0, limit));
}

function isMeaningfulRssTerm(value: string): boolean {
  const normalized = normalize(value);
  if (!normalized || normalized.length < 3) return false;
  if (/^\d+$/.test(normalized)) return false;
  const tokens = normalized.split(/\s+/).filter(Boolean);
  if (!tokens.length) return false;
  return tokens.some((token) => token.length >= 3 && !RSS_QUERY_BLOCKLIST.has(token));
}

function sanitizeRssTerms(values: string[], limit: number): string[] {
  return takeFirst(
    dedupe(values
      .map((value) => normalize(value))
      .filter((value) => value.length >= 3)
      .filter((value) => isMeaningfulRssTerm(value))),
    limit,
  );
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

function buildGoogleNewsRssUrl(query: string, locale?: string): string {
  const lang = locale || `${AUTOMATION_THRESHOLDS.locale.newsLanguage}-${AUTOMATION_THRESHOLDS.locale.newsRegion}`;
  const [langCode, regionCode] = lang.split('-');
  return `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=${lang}&gl=${regionCode || 'US'}&ceid=${regionCode || 'US'}:${langCode || 'en'}`;
}

function hasPolicySignal(blob: string): boolean {
  return /\b(tariff|sanction|regulat|policy|fed|treasury|export control|export restriction|licen|subsid|antitrust|compliance)\b/.test(blob);
}

function hasTechSignal(blob: string): boolean {
  return /\b(ai|chip|semiconductor|software|cloud|cyber|data center|compute|foundry|model|developer|platform)\b/.test(blob);
}

function hasFinanceSignal(blob: string): boolean {
  return /\b(market|bond|yield|rate|macro|inflation|credit|bank|liquidity|fx|forex|equity|volatility|treasury)\b/.test(blob);
}

function buildProposalDefaults(args: {
  provider: DatasetHistoricalProvider;
  sourceFamily?: string | null;
  featureFamily?: string | null;
}): Pick<DatasetProposal, 'importOptions' | 'replayOptions' | 'walkForwardOptions' | 'frameLoadOptions' | 'schedule'> {
  const provider = args.provider;
  const sourceFamily = normalize(String(args.sourceFamily || ''));
  const featureFamily = normalize(String(args.featureFamily || ''));
  const isNewsLike = provider === 'gdelt-doc' || provider === 'acled' || provider === 'rss-feed' || featureFamily === 'news' || featureFamily === 'policy' || featureFamily === 'conflict';
  const bucketHours = provider === 'yahoo-chart' || provider === 'fred' || provider === 'alfred' || provider === 'coingecko'
    ? 24
    : 6;
  const importOptions: Partial<HistoricalBackfillOptions> = {
    bucketHours,
    warmupFrameCount: isNewsLike ? 24 : 16,
    transactionTimeMode: provider === 'alfred' || provider === 'gdelt-doc' ? 'provider' : 'valid-time',
    bucketTimeMode: provider === 'alfred' ? 'transaction-time' : 'valid-time',
  };
  if (isNewsLike) {
    importOptions.newsLookbackHours = Math.max(24, bucketHours * 8);
  }
  const replayOptions: Partial<HistoricalReplayOptions> = {
    warmupFrameCount: isNewsLike ? 24 : 16,
  };
  const walkForwardOptions: Partial<WalkForwardBacktestOptions> = {
    warmupFrameCount: isNewsLike ? 24 : 16,
  };
  const frameLoadOptions: Partial<HistoricalFrameLoadOptions> = {
    includeWarmup: true,
    maxFrames: isNewsLike ? 240 : 180,
  };
  const schedule = isNewsLike
    ? { fetchEveryMinutes: sourceFamily === 'policy-release' ? 360 : 180, replayEveryMinutes: 360 }
    : { fetchEveryMinutes: 360, replayEveryMinutes: 360 };
  return { importOptions, replayOptions, walkForwardOptions, frameLoadOptions, schedule };
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
    proposedBy: 'heuristic',
    confidence,
    proposalScore: clamp(Math.round(confidence + Math.min(8, terms.length * 2)), 0, 100),
    rationale: `Repeated event motif ${theme.label} needs a broader historical news archive for replay and theme drift checks.`,
    querySummary: query,
    sourceThemeId: theme.themeId,
    fetchArgs: {
      query,
      mode: 'ArtList',
      max: 250,
      query_terms: terms.join('|'),
      shard_size: Math.min(3, Math.max(1, Math.ceil(terms.length / 2))),
      window_days: 14,
    },
    ...buildProposalDefaults({ provider: 'gdelt-doc', sourceFamily: 'broad-news', featureFamily: 'news' }),
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
    proposedBy: 'heuristic',
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
    ...buildProposalDefaults({ provider: 'acled', sourceFamily: 'conflict-events', featureFamily: 'conflict' }),
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
      proposedBy: 'heuristic',
      confidence,
      proposalScore: clamp(Math.round(confidence + (provider === 'alfred' ? 4 : 2)), 0, 100),
      rationale: candidate.reason,
      querySummary: candidate.series,
      sourceThemeId: theme.themeId,
      fetchArgs: provider === 'alfred'
        ? { series: candidate.series, observation_start: '2018-01-01', limit: 5000 }
        : { series: candidate.series, observation_start: '2018-01-01', limit: 5000 },
      ...buildProposalDefaults({ provider, sourceFamily: 'macro', featureFamily: 'macro' }),
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
        proposedBy: 'heuristic',
        confidence,
        proposalScore: clamp(Math.round(confidence + 3), 0, 100),
        rationale: `${label} pricing is needed to validate whether ${theme.label} has repeatable crypto-market transmission.`,
        querySummary: id,
        sourceThemeId: theme.themeId,
        fetchArgs: { id, vs: 'usd', days: 365 },
        ...buildProposalDefaults({ provider: 'coingecko', sourceFamily: 'crypto-market', featureFamily: 'crypto' }),
        pitSafety: 'medium',
        estimatedCost: 'low',
        autoRegister: false,
        autoEnable: false,
      };
    });
}

function buildYahooChartProposals(theme: DatasetDiscoveryThemeInput, priority: number): DatasetProposal[] {
  const symbols = takeFirst(
    dedupe((theme.suggestedSymbols || [])
      .map((value) => String(value || '').trim().toUpperCase())
      .filter((value) => /^[A-Z0-9.^=-]{1,16}$/.test(value))),
    4,
  );
  return symbols.map((symbol, index) => {
    const confidence = clamp(Math.round(priority * 0.7 + 18 - (index * 2)), 38, 95);
    return {
      id: `yahoo-chart-${slugify(symbol)}-${slugify(theme.label).slice(0, 28)}`,
      label: `Yahoo Chart ${symbol} / ${theme.label}`,
      provider: 'yahoo-chart' as const,
      proposedBy: 'heuristic',
      confidence,
      proposalScore: clamp(Math.round(confidence + 5), 0, 100),
      rationale: `${symbol} market history adds low-cost price confirmation and improves replay coverage for ${theme.label}.`,
      querySummary: symbol,
      sourceThemeId: theme.themeId,
      fetchArgs: { symbol, range: '5y', interval: '1d' },
      ...buildProposalDefaults({ provider: 'yahoo-chart', sourceFamily: 'market', featureFamily: 'market' }),
      pitSafety: 'medium',
      estimatedCost: 'low',
      autoRegister: false,
      autoEnable: false,
    };
  });
}

function buildRssFeedProposals(theme: DatasetDiscoveryThemeInput, priority: number): DatasetProposal[] {
  const blob = themeBlob(theme);
  const terms = topTerms(theme);
  const symbols = dedupe((theme.suggestedSymbols || [])
    .map((value) => String(value || '').trim().toUpperCase())
    .filter((value) => /^[A-Z0-9.^=-]{1,16}$/.test(value)))
    .slice(0, 4);
  const proposals: DatasetProposal[] = [];
  if (terms.length === 0 && symbols.length === 0) return proposals;

  const baseTerms = sanitizeRssTerms([
    ...terms,
    ...symbols.map((symbol) => symbol.toLowerCase()),
  ], 6);
  if (baseTerms.length === 0) return proposals;
  const broadQuery = `${baseTerms.map((term) => term.includes(' ') ? `"${term}"` : term).join(' OR ')} when:30d`;
  const broadConfidence = clamp(Math.round(priority * 0.66 + 12), 34, 90);
  proposals.push({
    id: `rss-broad-${slugify(theme.label)}`,
    label: `RSS Broad News / ${theme.label}`,
    provider: 'rss-feed',
    proposedBy: 'heuristic',
    confidence: broadConfidence,
    proposalScore: clamp(Math.round(broadConfidence + Math.min(8, baseTerms.length)), 0, 100),
    rationale: `Broad RSS search coverage helps measure whether ${theme.label} is supported beyond the currently active source mix.`,
    querySummary: broadQuery,
    sourceThemeId: theme.themeId,
    fetchArgs: {
      url: buildGoogleNewsRssUrl(broadQuery),
      name: `${theme.label} broad news`,
      limit: 120,
      source_family: 'broad-news',
      feature_family: 'news',
    },
    ...buildProposalDefaults({ provider: 'rss-feed', sourceFamily: 'broad-news', featureFamily: 'news' }),
    pitSafety: 'medium',
    estimatedCost: 'low',
    autoRegister: false,
    autoEnable: false,
  });

  const sectorTerms = sanitizeRssTerms([
    ...symbols,
    ...(theme.sectors || []).map((sector) => normalize(sector)),
    ...takeFirst((theme.supportingHeadlines || []).map((headline) => normalize(headline)).filter(Boolean), 2),
  ], 6);
  if (sectorTerms.length >= 2) {
    const sectorQuery = `${sectorTerms.map((term) => term.includes(' ') ? `"${term}"` : term).join(' OR ')} when:30d`;
    const sourceFamily = hasTechSignal(blob) || hasFinanceSignal(blob) ? 'sector-news' : 'broad-news';
    const sectorConfidence = clamp(Math.round(priority * 0.68 + 16), 36, 92);
    proposals.push({
      id: `rss-sector-${slugify(theme.label)}`,
      label: `RSS Sector News / ${theme.label}`,
      provider: 'rss-feed',
      proposedBy: 'heuristic',
      confidence: sectorConfidence,
      proposalScore: clamp(Math.round(sectorConfidence + Math.min(10, sectorTerms.length * 2)), 0, 100),
      rationale: `Sector-focused RSS capture improves source-family diversity and supplies denser evidence for ${theme.label}.`,
      querySummary: sectorQuery,
      sourceThemeId: theme.themeId,
      fetchArgs: {
        url: buildGoogleNewsRssUrl(sectorQuery),
        name: `${theme.label} sector news`,
        limit: 120,
        source_family: sourceFamily,
        feature_family: 'news',
      },
      ...buildProposalDefaults({ provider: 'rss-feed', sourceFamily, featureFamily: 'news' }),
      pitSafety: 'medium',
      estimatedCost: 'low',
      autoRegister: false,
      autoEnable: false,
    });
  }

  if (hasPolicySignal(blob)) {
    const policyTerms = sanitizeRssTerms([
      ...terms,
      ...['policy', 'regulation', 'export control', 'sanction'],
    ], 6);
    if (policyTerms.length >= 2) {
      const policyQuery = `${policyTerms.map((term) => term.includes(' ') ? `"${term}"` : term).join(' OR ')} when:60d`;
      const policyConfidence = clamp(Math.round(priority * 0.67 + 18), 38, 94);
      proposals.push({
        id: `rss-policy-${slugify(theme.label)}`,
        label: `RSS Policy Release / ${theme.label}`,
        provider: 'rss-feed',
        proposedBy: 'heuristic',
        confidence: policyConfidence,
        proposalScore: clamp(Math.round(policyConfidence + 6), 0, 100),
        rationale: `Policy/news-release RSS helps separate policy-driven drift from ordinary media noise for ${theme.label}.`,
        querySummary: policyQuery,
        sourceThemeId: theme.themeId,
        fetchArgs: {
          url: buildGoogleNewsRssUrl(policyQuery),
          name: `${theme.label} policy coverage`,
          limit: 100,
          source_family: 'policy-release',
          feature_family: 'policy',
        },
        ...buildProposalDefaults({ provider: 'rss-feed', sourceFamily: 'policy-release', featureFamily: 'policy' }),
        pitSafety: 'high',
        estimatedCost: 'low',
        autoRegister: false,
        autoEnable: false,
      });
    }
  }

  return proposals;
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
        value === 'fred' || value === 'alfred' || value === 'gdelt-doc' || value === 'coingecko' || value === 'acled' || value === 'rss-feed' || value === 'yahoo-chart'
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
      ...buildYahooChartProposals(theme, priority),
      ...buildRssFeedProposals(theme, priority),
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
    const enableNow = proposal.autoEnable
      && proposal.validationStatus === 'passed'
      && enabledCount < policy.maxEnabledDatasets;
    if (enableNow) enabledCount += 1;
    existing.set(proposal.id, {
      id: proposal.id,
      label: proposal.label,
      enabled: enableNow,
      provider: proposal.provider,
      fetchArgs: proposal.fetchArgs,
      importOptions: proposal.importOptions || {},
      replayOptions: proposal.replayOptions || {},
      walkForwardOptions: proposal.walkForwardOptions || {},
      frameLoadOptions: proposal.frameLoadOptions || {},
      schedule: proposal.schedule || {},
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

export interface DatasetDiscoveryOpsProposalStatus {
  id: string;
  label: string;
  provider: DatasetHistoricalProvider;
  proposedBy: 'heuristic' | 'codex';
  proposalScore: number;
  confidence: number;
  validationStatus: DatasetProposal['validationStatus'];
  autoRegister: boolean;
  autoEnable: boolean;
  coverageGain: number;
  utilityGain: number;
  regimeDiversificationGain: number;
  miniReplayScore: number;
  miniReplayFrameCount: number;
  miniReplayIdeaRunCount: number;
  miniReplayCostAdjustedAvgReturnPct: number;
  rationale: string;
}

export interface DatasetDiscoveryOpsProviderStatus {
  provider: DatasetHistoricalProvider;
  proposalCount: number;
  autoRegisterCount: number;
  autoEnableCount: number;
  validationPassedCount: number;
  validationFailedCount: number;
  validationPendingCount: number;
  averageProposalScore: number;
  averageConfidence: number;
  averageCoverageGain: number;
  averageUtilityGain: number;
  averageRegimeDiversificationGain: number;
}

export interface DatasetDiscoveryOpsSnapshot {
  updatedAt: string;
  policy: DatasetDiscoveryPolicy;
  registryDatasetCount: number;
  enabledDatasetCount: number;
  proposalCount: number;
  autoRegisterCount: number;
  autoEnableCount: number;
  validationPassedCount: number;
  validationFailedCount: number;
  validationPendingCount: number;
  proposals: DatasetDiscoveryOpsProposalStatus[];
  providerStatuses: DatasetDiscoveryOpsProviderStatus[];
}

function averageOrZero(values: number[]): number {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function buildDatasetDiscoveryOpsSnapshot(args: {
  registryDatasets: DatasetRegistryLike[];
  proposals: DatasetProposal[];
  policy?: Partial<DatasetDiscoveryPolicy> | null;
}): DatasetDiscoveryOpsSnapshot {
  const policy = normalizeDatasetDiscoveryPolicy(args.policy);
  const proposals = args.proposals.slice().sort((a, b) =>
    b.proposalScore - a.proposalScore
    || b.confidence - a.confidence
    || a.label.localeCompare(b.label));
  const registryDatasetCount = args.registryDatasets.length;
  const enabledDatasetCount = args.registryDatasets.filter((dataset) => dataset.enabled).length;
  const autoRegisterCount = proposals.filter((proposal) => proposal.autoRegister).length;
  const autoEnableCount = proposals.filter((proposal) => proposal.autoEnable).length;
  const validationPassedCount = proposals.filter((proposal) => proposal.validationStatus === 'passed').length;
  const validationFailedCount = proposals.filter((proposal) => proposal.validationStatus === 'failed').length;
  const validationPendingCount = proposals.filter((proposal) => !proposal.validationStatus || proposal.validationStatus === 'pending').length;
  const providerStatuses = Array.from(
    proposals.reduce((bucket, proposal) => {
      const current = bucket.get(proposal.provider) || [];
      current.push(proposal);
      bucket.set(proposal.provider, current);
      return bucket;
    }, new Map<DatasetHistoricalProvider, DatasetProposal[]>()),
  )
    .map(([provider, providerProposals]) => ({
      provider,
      proposalCount: providerProposals.length,
      autoRegisterCount: providerProposals.filter((proposal) => proposal.autoRegister).length,
      autoEnableCount: providerProposals.filter((proposal) => proposal.autoEnable).length,
      validationPassedCount: providerProposals.filter((proposal) => proposal.validationStatus === 'passed').length,
      validationFailedCount: providerProposals.filter((proposal) => proposal.validationStatus === 'failed').length,
      validationPendingCount: providerProposals.filter((proposal) => !proposal.validationStatus || proposal.validationStatus === 'pending').length,
      averageProposalScore: Number(averageOrZero(providerProposals.map((proposal) => proposal.proposalScore)).toFixed(2)),
      averageConfidence: Number(averageOrZero(providerProposals.map((proposal) => proposal.confidence)).toFixed(2)),
      averageCoverageGain: Number(averageOrZero(providerProposals.map((proposal) => Number(proposal.coverageGain) || 0)).toFixed(2)),
      averageUtilityGain: Number(averageOrZero(providerProposals.map((proposal) => Number(proposal.utilityGain) || 0)).toFixed(2)),
      averageRegimeDiversificationGain: Number(averageOrZero(providerProposals.map((proposal) => Number(proposal.regimeDiversificationGain) || 0)).toFixed(2)),
    }))
    .sort((a, b) =>
      b.autoEnableCount - a.autoEnableCount
      || b.proposalCount - a.proposalCount
      || a.provider.localeCompare(b.provider));

  return {
    updatedAt: new Date().toISOString(),
    policy,
    registryDatasetCount,
    enabledDatasetCount,
    proposalCount: proposals.length,
    autoRegisterCount,
    autoEnableCount,
    validationPassedCount,
    validationFailedCount,
    validationPendingCount,
    proposals: proposals.map((proposal) => ({
      id: proposal.id,
      label: proposal.label,
      provider: proposal.provider,
      proposedBy: proposal.proposedBy,
      proposalScore: proposal.proposalScore,
      confidence: proposal.confidence,
      validationStatus: proposal.validationStatus,
      autoRegister: proposal.autoRegister,
      autoEnable: proposal.autoEnable,
      coverageGain: Number(proposal.coverageGain) || 0,
      utilityGain: Number(proposal.utilityGain) || 0,
      regimeDiversificationGain: Number(proposal.regimeDiversificationGain) || 0,
      miniReplayScore: Number(proposal.miniReplayScore) || 0,
      miniReplayFrameCount: Number(proposal.miniReplayFrameCount) || 0,
      miniReplayIdeaRunCount: Number(proposal.miniReplayIdeaRunCount) || 0,
      miniReplayCostAdjustedAvgReturnPct: Number(proposal.miniReplayCostAdjustedAvgReturnPct) || 0,
      rationale: proposal.rationale,
    })),
    providerStatuses,
  };
}
