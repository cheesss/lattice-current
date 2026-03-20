export type CoverageSourceFamily =
  | 'broad-news'
  | 'sector-news'
  | 'company-newsroom'
  | 'policy-release'
  | 'macro'
  | 'market'
  | 'crypto-market'
  | 'conflict-events'
  | 'other';

export type CoverageFeatureFamily =
  | 'news'
  | 'policy'
  | 'macro'
  | 'market'
  | 'crypto'
  | 'conflict'
  | 'other';

export interface CoverageLedgerEntry {
  id: string;
  datasetId: string;
  sourceFamily: CoverageSourceFamily;
  featureFamily: CoverageFeatureFamily;
  frameCount: number;
  newsCount: number;
  marketCount: number;
  coverageDensity: number;
  completenessScore: number;
  featureBirthAt: string;
  lastObservedAt: string;
  knowledgeLagHours: number;
  gapRatio: number;
  rateLimitLossEstimate: number;
}

export interface CoverageLedgerThemeEntry {
  themeId: string;
  datasetCount: number;
  sourceFamilyDiversity: number;
  featureFamilyDiversity: number;
  sampleSize: number;
  coverageDensity: number;
  completenessScore: number;
  coveragePenalty: number;
}

export interface CoverageLedgerSnapshot {
  updatedAt: string;
  entries: CoverageLedgerEntry[];
  themeEntries: CoverageLedgerThemeEntry[];
  globalCoverageDensity: number;
  globalCompletenessScore: number;
}

export interface CoveragePenaltyBreakdown {
  coveragePenalty: number;
  completenessScore: number;
  coverageDensity: number;
  sourceFamilyDiversity: number;
  featureFamilyDiversity: number;
}

export interface CoverageOpsDatasetRecordLike {
  id: string;
  label?: string | null;
  enabled?: boolean;
  provider?: string | null;
}

export interface CoverageOpsDatasetSummaryLike {
  datasetId: string;
  provider?: string | null;
  label?: string | null;
  enabled?: boolean;
  rawRecordCount?: number;
  frameCount?: number;
  warmupFrameCount?: number;
  firstValidTime?: string | null;
  lastValidTime?: string | null;
  firstTransactionTime?: string | null;
  lastTransactionTime?: string | null;
  importedAt?: string | null;
  metadata?: Record<string, unknown>;
}

export interface CoverageOpsDatasetStatus {
  datasetId: string;
  label: string | null;
  provider: string | null;
  enabled: boolean;
  sourceFamilies: CoverageSourceFamily[];
  featureFamilies: CoverageFeatureFamily[];
  frameCount: number;
  rawRecordCount: number;
  warmupFrameCount: number;
  newsCount: number;
  marketCount: number;
  coverageDensity: number;
  completenessScore: number;
  knowledgeLagHours: number;
  gapRatio: number;
  rateLimitLossEstimate: number;
  firstObservedAt: string | null;
  lastObservedAt: string | null;
  firstValidTime: string | null;
  lastValidTime: string | null;
  firstTransactionTime: string | null;
  lastTransactionTime: string | null;
  importedAt: string | null;
}

export interface CoverageOpsSourceFamilyStatus {
  sourceFamily: CoverageSourceFamily;
  featureFamilyDiversity: number;
  datasetCount: number;
  frameCount: number;
  newsCount: number;
  marketCount: number;
  coverageDensity: number;
  completenessScore: number;
  knowledgeLagHours: number;
  gapRatio: number;
  rateLimitLossEstimate: number;
  datasetIds: string[];
}

export interface CoverageOpsThemeStatus extends CoverageLedgerThemeEntry {
  themeLabel: string | null;
}

export interface CoverageOpsSnapshot {
  updatedAt: string;
  coverage: CoverageLedgerSnapshot;
  datasetCount: number;
  sourceFamilyCount: number;
  themeCount: number;
  frameCount: number;
  newsCount: number;
  marketCount: number;
  datasets: CoverageOpsDatasetStatus[];
  sourceFamilies: CoverageOpsSourceFamilyStatus[];
  themes: CoverageOpsThemeStatus[];
}

export interface CoverageFrameLike {
  id?: string;
  datasetId?: string;
  timestamp: string;
  knowledgeBoundary?: string | null;
  news: Array<{ source?: string; link?: string | null; title?: string }>;
  markets: Array<{ symbol?: string }>;
  metadata?: Record<string, unknown>;
}

export interface CoverageThemeBinding {
  frameId?: string | null;
  themeId: string;
}

export interface CoverageMappingLike {
  themeId: string;
  eventSource?: string;
  eventTitle?: string;
  assetKind?: string;
  marketMovePct?: number | null;
  sourceDiversity?: number;
  corroborationQuality?: number;
  realityScore?: number;
  recentEvidenceScore?: number;
  executionPenaltyPct?: number;
  confirmationScore?: number;
}

const DEFAULT_DATASET_ID = 'current-live';

function nowIso(): string {
  return new Date().toISOString();
}

function asTs(value: string | null | undefined): number {
  if (!value) return 0;
  const ts = Date.parse(value);
  return Number.isFinite(ts) ? ts : 0;
}

function clamp(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) return min;
  return Math.max(min, Math.min(max, value));
}

function average(values: number[]): number {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function normalize(value: string): string {
  return String(value || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s./:-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function stableId(parts: Array<string | number | null | undefined>): string {
  return parts
    .map((part) => String(part ?? '').trim())
    .filter(Boolean)
    .join('::')
    .slice(0, 240);
}

function minIso(current: string | null, candidate: string | null): string | null {
  if (!candidate) return current;
  if (!current) return candidate;
  return asTs(candidate) < asTs(current) ? candidate : current;
}

function maxIso(current: string | null, candidate: string | null): string | null {
  if (!candidate) return current;
  if (!current) return candidate;
  return asTs(candidate) > asTs(current) ? candidate : current;
}

function rateLimitEstimateForProvider(provider: string): number {
  const normalized = normalize(provider);
  if (normalized.includes('gdelt')) return 0.22;
  if (normalized.includes('rss')) return 0.08;
  if (normalized.includes('acled')) return 0.05;
  return 0.02;
}

function familyFromHints(hintBlob: string, provider: string): { sourceFamily: CoverageSourceFamily; featureFamily: CoverageFeatureFamily } {
  const normalizedProvider = normalize(provider);
  const normalizedHint = normalize(hintBlob);

  if (normalizedProvider.includes('fred') || normalizedProvider.includes('alfred')) {
    return { sourceFamily: 'macro', featureFamily: 'macro' };
  }
  if (normalizedProvider.includes('coingecko')) {
    return { sourceFamily: 'crypto-market', featureFamily: 'crypto' };
  }
  if (normalizedProvider.includes('yahoo')) {
    return { sourceFamily: 'market', featureFamily: 'market' };
  }
  if (normalizedProvider.includes('acled') || normalizedHint.includes('acled')) {
    return { sourceFamily: 'conflict-events', featureFamily: 'conflict' };
  }
  if (
    /whitehouse|treasury|sec\.gov|federal reserve|federalreserve|state.gov|defense.gov|justice.gov|press release|policy/.test(normalizedHint)
  ) {
    return { sourceFamily: 'policy-release', featureFamily: 'policy' };
  }
  if (
    /cnbc|marketwatch|financial times|ft\.com|yahoo finance|reuters business|wsj|bloomberg|semiconductor|chip|cyber|ai/.test(normalizedHint)
  ) {
    return { sourceFamily: 'sector-news', featureFamily: 'news' };
  }
  if (
    /investor relations|newsroom|pr newswire|business wire|globenewswire|company announcement/.test(normalizedHint)
  ) {
    return { sourceFamily: 'company-newsroom', featureFamily: 'news' };
  }
  return { sourceFamily: 'broad-news', featureFamily: 'news' };
}

export function inferCoverageFamilies(args: {
  provider?: string | null;
  datasetId?: string | null;
  sourceName?: string | null;
  sourceId?: string | null;
  title?: string | null;
  link?: string | null;
}): { sourceFamily: CoverageSourceFamily; featureFamily: CoverageFeatureFamily } {
  const provider = String(args.provider || '').trim();
  const blob = [
    args.datasetId,
    args.sourceName,
    args.sourceId,
    args.title,
    args.link,
  ].map((value) => String(value || '').trim()).filter(Boolean).join(' ');
  return familyFromHints(blob, provider);
}

function computeEntryMetrics(args: {
  frameCount: number;
  newsCount: number;
  marketCount: number;
  knowledgeLagHours: number;
  gapRatio: number;
  rateLimitLossEstimate: number;
  sourceFamily: CoverageSourceFamily;
}): { coverageDensity: number; completenessScore: number } {
  const totalUnits = args.newsCount + args.marketCount;
  const unitWeight = args.sourceFamily === 'market' || args.sourceFamily === 'crypto-market' || args.sourceFamily === 'macro'
    ? 14
    : 10;
  const coverageDensity = clamp(
    Math.round(Math.min(100, Math.log1p(totalUnits) * unitWeight + Math.log1p(args.frameCount) * 16)),
    0,
    100,
  );
  const completenessScore = clamp(
    Math.round(
      coverageDensity * 0.52
      + (1 - clamp(args.gapRatio, 0, 1)) * 28
      + Math.max(0, 100 - args.knowledgeLagHours * 8) * 0.12
      + Math.max(0, 100 - args.rateLimitLossEstimate * 100) * 0.08,
    ),
    0,
    100,
  );
  return { coverageDensity, completenessScore };
}

function safeNumber(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function groupCoverageFamilies(
  entries: CoverageLedgerEntry[],
): CoverageOpsSourceFamilyStatus[] {
  const familyBuckets = new Map<CoverageSourceFamily, {
    datasetIds: Set<string>;
    frameCount: number[];
    newsCount: number[];
    marketCount: number[];
    coverageDensity: number[];
    completenessScore: number[];
    knowledgeLagHours: number[];
    gapRatio: number[];
    rateLimitLossEstimate: number[];
    featureFamilies: Set<CoverageFeatureFamily>;
  }>();

  for (const entry of entries) {
    const bucket = familyBuckets.get(entry.sourceFamily) || {
      datasetIds: new Set<string>(),
      frameCount: [],
      newsCount: [],
      marketCount: [],
      coverageDensity: [],
      completenessScore: [],
      knowledgeLagHours: [],
      gapRatio: [],
      rateLimitLossEstimate: [],
      featureFamilies: new Set<CoverageFeatureFamily>(),
    };
    bucket.datasetIds.add(entry.datasetId);
    bucket.frameCount.push(entry.frameCount);
    bucket.newsCount.push(entry.newsCount);
    bucket.marketCount.push(entry.marketCount);
    bucket.coverageDensity.push(entry.coverageDensity);
    bucket.completenessScore.push(entry.completenessScore);
    bucket.knowledgeLagHours.push(entry.knowledgeLagHours);
    bucket.gapRatio.push(entry.gapRatio);
    bucket.rateLimitLossEstimate.push(entry.rateLimitLossEstimate);
    bucket.featureFamilies.add(entry.featureFamily);
    familyBuckets.set(entry.sourceFamily, bucket);
  }

  return Array.from(familyBuckets.entries()).map(([sourceFamily, bucket]) => ({
    sourceFamily,
    featureFamilyDiversity: bucket.featureFamilies.size,
    datasetCount: bucket.datasetIds.size,
    frameCount: Math.round(average(bucket.frameCount)),
    newsCount: Math.round(average(bucket.newsCount)),
    marketCount: Math.round(average(bucket.marketCount)),
    coverageDensity: Number(average(bucket.coverageDensity).toFixed(2)),
    completenessScore: Number(average(bucket.completenessScore).toFixed(2)),
    knowledgeLagHours: Number(average(bucket.knowledgeLagHours).toFixed(2)),
    gapRatio: Number(average(bucket.gapRatio).toFixed(4)),
    rateLimitLossEstimate: Number(average(bucket.rateLimitLossEstimate).toFixed(4)),
    datasetIds: Array.from(bucket.datasetIds).sort(),
  })).sort((a, b) =>
    b.completenessScore - a.completenessScore
    || b.coverageDensity - a.coverageDensity
    || a.sourceFamily.localeCompare(b.sourceFamily));
}

function groupCoverageDatasets(
  entries: CoverageLedgerEntry[],
  registryDatasets: CoverageOpsDatasetRecordLike[] = [],
  datasetSummaries: CoverageOpsDatasetSummaryLike[] = [],
): CoverageOpsDatasetStatus[] {
  const registryById = new Map(registryDatasets.map((dataset) => [dataset.id, dataset] as const));
  const summaryById = new Map(datasetSummaries.map((dataset) => [dataset.datasetId, dataset] as const));
  const buckets = new Map<string, {
    datasetId: string;
    sourceFamilies: Set<CoverageSourceFamily>;
    featureFamilies: Set<CoverageFeatureFamily>;
    frameCount: number[];
    newsCount: number[];
    marketCount: number[];
    coverageDensity: number[];
    completenessScore: number[];
    knowledgeLagHours: number[];
    gapRatio: number[];
    rateLimitLossEstimate: number[];
    firstObservedAt: string | null;
    lastObservedAt: string | null;
  }>();

  for (const entry of entries) {
    const bucket = buckets.get(entry.datasetId) || {
      datasetId: entry.datasetId,
      sourceFamilies: new Set<CoverageSourceFamily>(),
      featureFamilies: new Set<CoverageFeatureFamily>(),
      frameCount: [],
      newsCount: [],
      marketCount: [],
      coverageDensity: [],
      completenessScore: [],
      knowledgeLagHours: [],
      gapRatio: [],
      rateLimitLossEstimate: [],
      firstObservedAt: null,
      lastObservedAt: null,
    };
    bucket.sourceFamilies.add(entry.sourceFamily);
    bucket.featureFamilies.add(entry.featureFamily);
    bucket.frameCount.push(entry.frameCount);
    bucket.newsCount.push(entry.newsCount);
    bucket.marketCount.push(entry.marketCount);
    bucket.coverageDensity.push(entry.coverageDensity);
    bucket.completenessScore.push(entry.completenessScore);
    bucket.knowledgeLagHours.push(entry.knowledgeLagHours);
    bucket.gapRatio.push(entry.gapRatio);
    bucket.rateLimitLossEstimate.push(entry.rateLimitLossEstimate);
    bucket.firstObservedAt = minIso(bucket.firstObservedAt, entry.featureBirthAt);
    bucket.lastObservedAt = maxIso(bucket.lastObservedAt, entry.lastObservedAt);
    buckets.set(entry.datasetId, bucket);
  }

  for (const summary of datasetSummaries) {
    if (!buckets.has(summary.datasetId)) {
      buckets.set(summary.datasetId, {
        datasetId: summary.datasetId,
        sourceFamilies: new Set<CoverageSourceFamily>(),
        featureFamilies: new Set<CoverageFeatureFamily>(),
        frameCount: [safeNumber(summary.frameCount)],
        newsCount: [0],
        marketCount: [0],
        coverageDensity: [0],
        completenessScore: [0],
        knowledgeLagHours: [0],
        gapRatio: [1],
        rateLimitLossEstimate: [0],
        firstObservedAt: summary.firstValidTime || summary.firstTransactionTime || summary.importedAt || null,
        lastObservedAt: summary.lastValidTime || summary.lastTransactionTime || summary.importedAt || null,
      });
    }
  }

  return Array.from(buckets.values()).map((bucket) => {
    const registry = registryById.get(bucket.datasetId);
    const summary = summaryById.get(bucket.datasetId);
    const sourceFamilies = Array.from(bucket.sourceFamilies);
    const featureFamilies = Array.from(bucket.featureFamilies);
    return {
      datasetId: bucket.datasetId,
      label: summary?.label || registry?.label || null,
      provider: summary?.provider || registry?.provider || null,
      enabled: summary?.enabled ?? registry?.enabled ?? false,
      sourceFamilies,
      featureFamilies,
      frameCount: Math.round(average(bucket.frameCount)),
      rawRecordCount: Math.max(0, Math.round(summary?.rawRecordCount || bucket.frameCount.reduce((sum, value) => sum + value, 0))),
      warmupFrameCount: Math.max(0, Math.round(summary?.warmupFrameCount || 0)),
      newsCount: Math.round(average(bucket.newsCount)),
      marketCount: Math.round(average(bucket.marketCount)),
      coverageDensity: Number(average(bucket.coverageDensity).toFixed(2)),
      completenessScore: Number(average(bucket.completenessScore).toFixed(2)),
      knowledgeLagHours: Number(average(bucket.knowledgeLagHours).toFixed(2)),
      gapRatio: Number(average(bucket.gapRatio).toFixed(4)),
      rateLimitLossEstimate: Number(average(bucket.rateLimitLossEstimate).toFixed(4)),
      firstObservedAt: bucket.firstObservedAt,
      lastObservedAt: bucket.lastObservedAt,
      firstValidTime: summary?.firstValidTime || null,
      lastValidTime: summary?.lastValidTime || null,
      firstTransactionTime: summary?.firstTransactionTime || null,
      lastTransactionTime: summary?.lastTransactionTime || null,
      importedAt: summary?.importedAt || null,
    };
  }).sort((a, b) =>
    b.completenessScore - a.completenessScore
    || b.coverageDensity - a.coverageDensity
    || a.datasetId.localeCompare(b.datasetId));
}

function groupCoverageThemes(
  snapshot: CoverageLedgerSnapshot | null | undefined,
  themeLabels: Record<string, string | null | undefined> = {},
): CoverageOpsThemeStatus[] {
  if (!snapshot) return [];
  return snapshot.themeEntries.map((entry) => ({
    ...entry,
    themeLabel: themeLabels[entry.themeId] || null,
  }));
}

export function buildCoverageOpsSnapshot(args: {
  ledger?: CoverageLedgerSnapshot | null;
  registryDatasets?: CoverageOpsDatasetRecordLike[];
  datasetSummaries?: CoverageOpsDatasetSummaryLike[];
  themeLabels?: Record<string, string | null | undefined>;
}): CoverageOpsSnapshot {
  const updatedAt = args.ledger?.updatedAt || nowIso();
  const coverage = args.ledger || {
    updatedAt,
    entries: [],
    themeEntries: [],
    globalCoverageDensity: 0,
    globalCompletenessScore: 0,
  };
  const datasets = groupCoverageDatasets(
    coverage.entries,
    args.registryDatasets || [],
    args.datasetSummaries || [],
  );
  const sourceFamilies = groupCoverageFamilies(coverage.entries);
  const themes = groupCoverageThemes(coverage, args.themeLabels || {});
  const frameCount = Math.round(coverage.entries.reduce((sum, entry) => sum + entry.frameCount, 0));
  const newsCount = Math.round(coverage.entries.reduce((sum, entry) => sum + entry.newsCount, 0));
  const marketCount = Math.round(coverage.entries.reduce((sum, entry) => sum + entry.marketCount, 0));
  return {
    updatedAt,
    coverage,
    datasetCount: datasets.length,
    sourceFamilyCount: sourceFamilies.length,
    themeCount: themes.length,
    frameCount,
    newsCount,
    marketCount,
    datasets,
    sourceFamilies,
    themes,
  };
}

export function buildCoverageLedgerFromFrames(
  frames: CoverageFrameLike[],
  bindings: CoverageThemeBinding[] = [],
): CoverageLedgerSnapshot {
  const updatedAt = nowIso();
  const entryBuckets = new Map<string, {
    datasetId: string;
    sourceFamily: CoverageSourceFamily;
    featureFamily: CoverageFeatureFamily;
    frameCount: number;
    newsCount: number;
    marketCount: number;
    featureBirthAt: string | null;
    lastObservedAt: string | null;
    knowledgeLagHours: number[];
    gapRatios: number[];
    rateLimitLossEstimate: number[];
  }>();
  const frameFamilies = new Map<string, { datasetId: string; sourceFamily: CoverageSourceFamily; featureFamily: CoverageFeatureFamily }>();

  for (const frame of frames) {
    const metadata = frame.metadata || {};
    const provider = String(metadata.provider || frame.datasetId || '').trim();
    const inferred = inferCoverageFamilies({
      provider,
      datasetId: frame.datasetId || DEFAULT_DATASET_ID,
      sourceName: String(metadata.sourceName || ''),
      sourceId: String(metadata.sourceId || ''),
    });
    const datasetId = String(frame.datasetId || DEFAULT_DATASET_ID);
    const knowledgeLagHours = Math.max(0, (asTs(frame.timestamp) - asTs(frame.knowledgeBoundary || frame.timestamp)) / 3_600_000);
    const newsCount = Array.isArray(frame.news) ? frame.news.length : 0;
    const marketCount = Array.isArray(frame.markets) ? frame.markets.length : 0;
    const expectedUnits = inferred.featureFamily === 'market' || inferred.featureFamily === 'crypto' || inferred.featureFamily === 'macro'
      ? 1
      : 2;
    const observedUnits = newsCount + marketCount;
    const gapRatio = clamp(1 - Math.min(1, observedUnits / Math.max(1, expectedUnits)), 0, 1);
    const rateLimitLossEstimate = typeof metadata.rateLimitLossEstimate === 'number'
      ? clamp(Number(metadata.rateLimitLossEstimate), 0, 1)
      : rateLimitEstimateForProvider(provider);
    const key = stableId([datasetId, inferred.sourceFamily, inferred.featureFamily]);
    const bucket = entryBuckets.get(key) || {
      datasetId,
      sourceFamily: inferred.sourceFamily,
      featureFamily: inferred.featureFamily,
      frameCount: 0,
      newsCount: 0,
      marketCount: 0,
      featureBirthAt: null,
      lastObservedAt: null,
      knowledgeLagHours: [],
      gapRatios: [],
      rateLimitLossEstimate: [],
    };
    bucket.frameCount += 1;
    bucket.newsCount += newsCount;
    bucket.marketCount += marketCount;
    bucket.featureBirthAt = minIso(bucket.featureBirthAt, frame.timestamp);
    bucket.lastObservedAt = maxIso(bucket.lastObservedAt, frame.timestamp);
    bucket.knowledgeLagHours.push(knowledgeLagHours);
    bucket.gapRatios.push(gapRatio);
    bucket.rateLimitLossEstimate.push(rateLimitLossEstimate);
    entryBuckets.set(key, bucket);
    if (frame.id) {
      frameFamilies.set(String(frame.id), {
        datasetId,
        sourceFamily: inferred.sourceFamily,
        featureFamily: inferred.featureFamily,
      });
    }
  }

  const entries = Array.from(entryBuckets.values()).map((bucket) => {
    const gapRatio = average(bucket.gapRatios);
    const rateLimitLossEstimate = average(bucket.rateLimitLossEstimate);
    const knowledgeLagHours = Number(average(bucket.knowledgeLagHours).toFixed(2));
    const metrics = computeEntryMetrics({
      frameCount: bucket.frameCount,
      newsCount: bucket.newsCount,
      marketCount: bucket.marketCount,
      knowledgeLagHours,
      gapRatio,
      rateLimitLossEstimate,
      sourceFamily: bucket.sourceFamily,
    });
    return {
      id: stableId([bucket.datasetId, bucket.sourceFamily, bucket.featureFamily]),
      datasetId: bucket.datasetId,
      sourceFamily: bucket.sourceFamily,
      featureFamily: bucket.featureFamily,
      frameCount: bucket.frameCount,
      newsCount: bucket.newsCount,
      marketCount: bucket.marketCount,
      coverageDensity: metrics.coverageDensity,
      completenessScore: metrics.completenessScore,
      featureBirthAt: bucket.featureBirthAt || updatedAt,
      lastObservedAt: bucket.lastObservedAt || updatedAt,
      knowledgeLagHours,
      gapRatio: Number(gapRatio.toFixed(4)),
      rateLimitLossEstimate: Number(rateLimitLossEstimate.toFixed(4)),
    };
  }).sort((a, b) => b.completenessScore - a.completenessScore || b.coverageDensity - a.coverageDensity);

  const themeBuckets = new Map<string, {
    datasetIds: Set<string>;
    sourceFamilies: Set<CoverageSourceFamily>;
    featureFamilies: Set<CoverageFeatureFamily>;
    sampleSize: number;
    coverageDensity: number[];
    completenessScore: number[];
  }>();

  for (const binding of bindings) {
    const themeId = normalize(binding.themeId);
    if (!themeId) continue;
    const family = frameFamilies.get(String(binding.frameId || ''));
    if (!family) continue;
    const matchingEntry = entries.find((entry) =>
      entry.datasetId === family.datasetId
      && entry.sourceFamily === family.sourceFamily
      && entry.featureFamily === family.featureFamily,
    );
    if (!matchingEntry) continue;
    const bucket = themeBuckets.get(themeId) || {
      datasetIds: new Set<string>(),
      sourceFamilies: new Set<CoverageSourceFamily>(),
      featureFamilies: new Set<CoverageFeatureFamily>(),
      sampleSize: 0,
      coverageDensity: [],
      completenessScore: [],
    };
    bucket.datasetIds.add(matchingEntry.datasetId);
    bucket.sourceFamilies.add(matchingEntry.sourceFamily);
    bucket.featureFamilies.add(matchingEntry.featureFamily);
    bucket.sampleSize += 1;
    bucket.coverageDensity.push(matchingEntry.coverageDensity);
    bucket.completenessScore.push(matchingEntry.completenessScore);
    themeBuckets.set(themeId, bucket);
  }

  const themeEntries = Array.from(themeBuckets.entries()).map(([themeId, bucket]) => {
    const coverageDensity = Number(average(bucket.coverageDensity).toFixed(2));
    const completenessScore = Number(average(bucket.completenessScore).toFixed(2));
    const sourceFamilyDiversity = bucket.sourceFamilies.size;
    const featureFamilyDiversity = bucket.featureFamilies.size;
    const coveragePenalty = clamp(
      Math.round(
        Math.max(0, 34 - completenessScore * 0.24)
        + Math.max(0, 2 - sourceFamilyDiversity) * 9
        + Math.max(0, 2 - featureFamilyDiversity) * 7,
      ),
      0,
      72,
    );
    return {
      themeId,
      datasetCount: bucket.datasetIds.size,
      sourceFamilyDiversity,
      featureFamilyDiversity,
      sampleSize: bucket.sampleSize,
      coverageDensity,
      completenessScore,
      coveragePenalty,
    };
  }).sort((a, b) => b.completenessScore - a.completenessScore || b.sampleSize - a.sampleSize);

  return {
    updatedAt,
    entries,
    themeEntries,
    globalCoverageDensity: Number(average(entries.map((entry) => entry.coverageDensity)).toFixed(2)),
    globalCompletenessScore: Number(average(entries.map((entry) => entry.completenessScore)).toFixed(2)),
  };
}

export function buildCoverageLedgerFromMappings(mappings: CoverageMappingLike[]): CoverageLedgerSnapshot {
  const updatedAt = nowIso();
  const entryBuckets = new Map<string, {
    datasetId: string;
    sourceFamily: CoverageSourceFamily;
    featureFamily: CoverageFeatureFamily;
    newsCount: number;
    marketCount: number;
    sampleSize: number;
  }>();
  const themeBuckets = new Map<string, {
    sourceFamilies: Set<CoverageSourceFamily>;
    featureFamilies: Set<CoverageFeatureFamily>;
    sampleSize: number;
    corroboration: number[];
    reality: number[];
    recency: number[];
    confirmation: number[];
  }>();

  for (const mapping of mappings) {
    const inferred = inferCoverageFamilies({
      provider: mapping.assetKind || '',
      sourceName: mapping.eventSource || '',
      title: mapping.eventTitle || '',
    });
    const featureFamily: CoverageFeatureFamily = mapping.assetKind === 'crypto'
      ? 'crypto'
      : mapping.assetKind === 'etf' || mapping.assetKind === 'equity' || mapping.assetKind === 'rate' || mapping.assetKind === 'commodity' || mapping.assetKind === 'fx'
        ? 'market'
        : inferred.featureFamily;
    const key = stableId([DEFAULT_DATASET_ID, inferred.sourceFamily, featureFamily]);
    const entry = entryBuckets.get(key) || {
      datasetId: DEFAULT_DATASET_ID,
      sourceFamily: inferred.sourceFamily,
      featureFamily,
      newsCount: 0,
      marketCount: 0,
      sampleSize: 0,
    };
    entry.sampleSize += 1;
    if (featureFamily === 'market' || featureFamily === 'crypto' || featureFamily === 'macro') entry.marketCount += 1;
    else entry.newsCount += 1;
    entryBuckets.set(key, entry);

    const themeId = normalize(mapping.themeId);
    const bucket = themeBuckets.get(themeId) || {
      sourceFamilies: new Set<CoverageSourceFamily>(),
      featureFamilies: new Set<CoverageFeatureFamily>(),
      sampleSize: 0,
      corroboration: [],
      reality: [],
      recency: [],
      confirmation: [],
    };
    bucket.sampleSize += 1;
    bucket.sourceFamilies.add(inferred.sourceFamily);
    bucket.featureFamilies.add(featureFamily);
    bucket.corroboration.push(Number(mapping.corroborationQuality) || 0);
    bucket.reality.push(Number(mapping.realityScore) || 0);
    bucket.recency.push(Number(mapping.recentEvidenceScore) || 0);
    bucket.confirmation.push(Number(mapping.confirmationScore) || 0);
    themeBuckets.set(themeId, bucket);
  }

  const entries = Array.from(entryBuckets.values()).map((entry) => {
    const gapRatio = clamp(entry.sampleSize <= 1 ? 0.42 : 1 / Math.max(2, entry.sampleSize), 0, 1);
    const metrics = computeEntryMetrics({
      frameCount: entry.sampleSize,
      newsCount: entry.newsCount,
      marketCount: entry.marketCount,
      knowledgeLagHours: 0,
      gapRatio,
      rateLimitLossEstimate: 0,
      sourceFamily: entry.sourceFamily,
    });
    return {
      id: stableId([entry.datasetId, entry.sourceFamily, entry.featureFamily]),
      datasetId: entry.datasetId,
      sourceFamily: entry.sourceFamily,
      featureFamily: entry.featureFamily,
      frameCount: entry.sampleSize,
      newsCount: entry.newsCount,
      marketCount: entry.marketCount,
      coverageDensity: metrics.coverageDensity,
      completenessScore: metrics.completenessScore,
      featureBirthAt: updatedAt,
      lastObservedAt: updatedAt,
      knowledgeLagHours: 0,
      gapRatio: Number(gapRatio.toFixed(4)),
      rateLimitLossEstimate: 0,
    };
  });

  const themeEntries = Array.from(themeBuckets.entries()).map(([themeId, bucket]) => {
    const completenessScore = clamp(
      Math.round(
        average(bucket.corroboration) * 0.28
        + average(bucket.reality) * 0.28
        + average(bucket.recency) * 0.18
        + average(bucket.confirmation) * 0.26,
      ),
      0,
      100,
    );
    const coverageDensity = clamp(
      Math.round(Math.log1p(bucket.sampleSize) * 24 + bucket.sourceFamilies.size * 12 + bucket.featureFamilies.size * 10),
      0,
      100,
    );
    const sourceFamilyDiversity = bucket.sourceFamilies.size;
    const featureFamilyDiversity = bucket.featureFamilies.size;
    const coveragePenalty = clamp(
      Math.round(
        Math.max(0, 32 - completenessScore * 0.22)
        + Math.max(0, 2 - sourceFamilyDiversity) * 10
        + Math.max(0, 2 - featureFamilyDiversity) * 8,
      ),
      0,
      72,
    );
    return {
      themeId,
      datasetCount: 1,
      sourceFamilyDiversity,
      featureFamilyDiversity,
      sampleSize: bucket.sampleSize,
      coverageDensity,
      completenessScore,
      coveragePenalty,
    };
  });

  return {
    updatedAt,
    entries,
    themeEntries,
    globalCoverageDensity: Number(average(entries.map((entry) => entry.coverageDensity)).toFixed(2)),
    globalCompletenessScore: Number(average(entries.map((entry) => entry.completenessScore)).toFixed(2)),
  };
}

export function mergeCoverageLedgerSnapshots(snapshots: Array<CoverageLedgerSnapshot | null | undefined>): CoverageLedgerSnapshot | null {
  const available = snapshots.filter((snapshot): snapshot is CoverageLedgerSnapshot => Boolean(snapshot));
  if (!available.length) return null;
  const entryBuckets = new Map<string, CoverageLedgerEntry[]>();
  const themeBuckets = new Map<string, CoverageLedgerThemeEntry[]>();
  for (const snapshot of available) {
    for (const entry of snapshot.entries) {
      const bucket = entryBuckets.get(entry.id) || [];
      bucket.push(entry);
      entryBuckets.set(entry.id, bucket);
    }
    for (const entry of snapshot.themeEntries) {
      const bucket = themeBuckets.get(entry.themeId) || [];
      bucket.push(entry);
      themeBuckets.set(entry.themeId, bucket);
    }
  }
  const entries = Array.from(entryBuckets.entries()).map(([id, bucket]) => {
    const head = bucket[0]!;
    let featureBirthAt: string | null = head.featureBirthAt;
    let lastObservedAt: string | null = head.lastObservedAt;
    for (const entry of bucket) {
      featureBirthAt = minIso(featureBirthAt, entry.featureBirthAt);
      lastObservedAt = maxIso(lastObservedAt, entry.lastObservedAt);
    }
    return {
      id,
      datasetId: head.datasetId,
      sourceFamily: head.sourceFamily,
      featureFamily: head.featureFamily,
      frameCount: Math.round(average(bucket.map((entry) => entry.frameCount))),
      newsCount: Math.round(average(bucket.map((entry) => entry.newsCount))),
      marketCount: Math.round(average(bucket.map((entry) => entry.marketCount))),
      coverageDensity: Number(average(bucket.map((entry) => entry.coverageDensity)).toFixed(2)),
      completenessScore: Number(average(bucket.map((entry) => entry.completenessScore)).toFixed(2)),
      featureBirthAt: featureBirthAt || head.featureBirthAt,
      lastObservedAt: lastObservedAt || head.lastObservedAt,
      knowledgeLagHours: Number(average(bucket.map((entry) => entry.knowledgeLagHours)).toFixed(2)),
      gapRatio: Number(average(bucket.map((entry) => entry.gapRatio)).toFixed(4)),
      rateLimitLossEstimate: Number(average(bucket.map((entry) => entry.rateLimitLossEstimate)).toFixed(4)),
    };
  });
  const themeEntries = Array.from(themeBuckets.entries()).map(([themeId, bucket]) => ({
    themeId,
    datasetCount: Math.round(average(bucket.map((entry) => entry.datasetCount))),
    sourceFamilyDiversity: Math.round(average(bucket.map((entry) => entry.sourceFamilyDiversity))),
    featureFamilyDiversity: Math.round(average(bucket.map((entry) => entry.featureFamilyDiversity))),
    sampleSize: Math.round(average(bucket.map((entry) => entry.sampleSize))),
    coverageDensity: Number(average(bucket.map((entry) => entry.coverageDensity)).toFixed(2)),
    completenessScore: Number(average(bucket.map((entry) => entry.completenessScore)).toFixed(2)),
    coveragePenalty: Number(average(bucket.map((entry) => entry.coveragePenalty)).toFixed(2)),
  }));
  return {
    updatedAt: available[0]!.updatedAt,
    entries,
    themeEntries,
    globalCoverageDensity: Number(average(entries.map((entry) => entry.coverageDensity)).toFixed(2)),
    globalCompletenessScore: Number(average(entries.map((entry) => entry.completenessScore)).toFixed(2)),
  };
}

export function getCoveragePenaltyForTheme(
  snapshot: CoverageLedgerSnapshot | null | undefined,
  themeId: string,
): CoveragePenaltyBreakdown {
  if (!snapshot) {
    return {
      coveragePenalty: 18,
      completenessScore: 52,
      coverageDensity: 48,
      sourceFamilyDiversity: 1,
      featureFamilyDiversity: 1,
    };
  }
  const theme = snapshot.themeEntries.find((entry) => entry.themeId === normalize(themeId));
  if (!theme) {
    return {
      coveragePenalty: clamp(Math.round(Math.max(0, 28 - snapshot.globalCompletenessScore * 0.18)), 8, 36),
      completenessScore: snapshot.globalCompletenessScore,
      coverageDensity: snapshot.globalCoverageDensity,
      sourceFamilyDiversity: 1,
      featureFamilyDiversity: 1,
    };
  }
  return {
    coveragePenalty: theme.coveragePenalty,
    completenessScore: theme.completenessScore,
    coverageDensity: theme.coverageDensity,
    sourceFamilyDiversity: theme.sourceFamilyDiversity,
    featureFamilyDiversity: theme.featureFamilyDiversity,
  };
}

export function scoreCoverageGain(args: {
  snapshot: CoverageLedgerSnapshot | null | undefined;
  sourceFamily: CoverageSourceFamily;
  featureFamily: CoverageFeatureFamily;
  themeId?: string | null;
}): { coverageGain: number; diversificationGain: number; duplicationPenalty: number } {
  const snapshot = args.snapshot;
  if (!snapshot) {
    return { coverageGain: 24, diversificationGain: 18, duplicationPenalty: 0 };
  }
  const sameFamily = snapshot.entries.filter((entry) =>
    entry.sourceFamily === args.sourceFamily
    && entry.featureFamily === args.featureFamily,
  );
  const theme = args.themeId
    ? snapshot.themeEntries.find((entry) => entry.themeId === normalize(String(args.themeId || '')))
    : null;
  const duplicationPenalty = clamp(Math.round(sameFamily.length * 8 + average(sameFamily.map((entry) => entry.coverageDensity)) * 0.08), 0, 42);
  const diversificationGain = clamp(
    Math.round(
      Math.max(0, 18 - sameFamily.length * 5)
      + Math.max(0, 2 - (theme?.sourceFamilyDiversity || 0)) * 6,
    ),
    0,
    24,
  );
  const coverageGain = clamp(
    Math.round(
      Math.max(0, 72 - (theme?.completenessScore ?? snapshot.globalCompletenessScore) * 0.6)
      + diversificationGain
      - duplicationPenalty * 0.35,
    ),
    0,
    100,
  );
  return { coverageGain, diversificationGain, duplicationPenalty };
}
