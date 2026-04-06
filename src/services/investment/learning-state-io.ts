import type { BanditArmState } from '../math-models/contextual-bandit';
// FIX-3: Removed direct PersistentCache calls — all access through StateStore adapter
// IS-4: StateStore adapter for transactional safety
import { getStateStoreAdapter } from '../state/persistent-cache-adapter';
import { StateMigrationManager } from '../state/state-migration';
import { getMarketWatchlistEntries } from '../market-watchlist';
import type {
  CandidateExpansionReview,
  ConvictionModelState,
  InvestmentAssetKind,
  InvestmentDirection,
  InvestmentHistoryEntry,
  InvestmentIntelligenceSnapshot,
  InvestmentLearningState,
  InvestmentThemeDefinition,
  MarketHistoryPoint,
  MappingPerformanceStats,
  TrackedIdeaState,
  UniverseExpansionMode,
  UniverseExpansionPolicy,
} from './types';
import {
  SNAPSHOT_KEY,
  HISTORY_KEY,
  TRACKED_IDEAS_KEY,
  MARKET_HISTORY_KEY,
  MAPPING_STATS_KEY,
  BANDIT_STATE_KEY,
  CANDIDATE_REVIEWS_KEY,
  UNIVERSE_POLICY_KEY,
  CONVICTION_MODEL_KEY,
  HAWKES_STATES_KEY,
  DISCOVERED_LINKS_KEY,
  FINGERPRINTS_KEY,
  MAX_HISTORY,
  MAX_TRACKED_IDEAS,
  MAX_MARKET_HISTORY_POINTS,
  MAX_MAPPING_STATS,
  MAX_BANDIT_STATES,
  MAX_CANDIDATE_REVIEWS,
} from './constants';
import * as S from './module-state';
import { nowIso, clamp, themeAssetKey, candidateReviewId } from './utils';
import {
  normalizeInvestmentSnapshot,
} from './normalizers';
import {
  normalizeUniverseExpansionPolicy,
  normalizeCandidateReview,
  applyUniverseExpansionPolicy,
} from './universe-expansion';
import { getThemeRule, getEffectiveThemeAssets } from './theme-registry';
import { rebuildMarketHistoryIndex } from './idea-tracker';
import type { HawkesCarryState } from './module-state';
import type { DiscoveredLink, ClusterFingerprint } from '@/services/pattern-discovery';

function getStore() {
  return getStateStoreAdapter();
}

interface PersistedSnapshotStore {
  snapshot: InvestmentIntelligenceSnapshot | null;
}

interface PersistedHistoryStore {
  entries: InvestmentHistoryEntry[];
}

interface PersistedTrackedIdeasStore {
  ideas: TrackedIdeaState[];
}

interface PersistedMarketHistoryStore {
  points: MarketHistoryPoint[];
}

interface PersistedMappingStatsStore {
  stats: MappingPerformanceStats[];
}

interface PersistedBanditStateStore {
  states: BanditArmState[];
}

interface PersistedCandidateReviewStore {
  reviews: CandidateExpansionReview[];
}

interface PersistedUniversePolicyStore {
  policy: UniverseExpansionPolicy;
}

interface PersistedConvictionModelStore {
  model: ConvictionModelState;
}

interface ThemeAssetDefinition {
  symbol: string;
  name: string;
  assetKind: InvestmentAssetKind;
  sector: string;
  commodity?: string;
  direction: InvestmentDirection;
  role: 'primary' | 'confirm' | 'hedge';
}

export interface CodexCandidateExpansionProposal {
  symbol: string;
  assetName?: string;
  assetKind?: InvestmentAssetKind;
  sector?: string;
  commodity?: string | null;
  direction?: InvestmentDirection;
  role?: ThemeAssetDefinition['role'];
  confidence?: number;
  reason?: string;
  supportingSignals?: string[];
}

interface LocalCodexCandidateExpansionResponse {
  proposals?: CodexCandidateExpansionProposal[];
}

export async function ensureLoaded(): Promise<void> {
  if (S.loaded) return;
  S.setLoaded(true);

  // IS-4: Run schema migrations before loading state
  try {
    const stateStore = getStateStoreAdapter();
    const migrationManager = new StateMigrationManager(undefined, true);
    await migrationManager.runMigrations(stateStore, { major: 2, minor: 0, patch: 0, migratedAt: new Date().toISOString() });
  } catch (migrationError) {
    console.warn('[investment-intelligence] state migration failed (non-fatal)', migrationError);
  }

  try {
    const snapshotCached = await getStore().get<PersistedSnapshotStore>(SNAPSHOT_KEY);
    S.setCurrentSnapshot(normalizeInvestmentSnapshot(snapshotCached?.snapshot ?? null));
  } catch (error) {
    console.warn('[investment-intelligence] snapshot load failed', error);
  }
  try {
    const historyCached = await getStore().get<PersistedHistoryStore>(HISTORY_KEY);
    S.setCurrentHistory(historyCached?.entries ?? []);
  } catch (error) {
    console.warn('[investment-intelligence] history load failed', error);
  }
  try {
    const trackedCached = await getStore().get<PersistedTrackedIdeasStore>(TRACKED_IDEAS_KEY);
    S.setTrackedIdeas(trackedCached?.ideas ?? []);
  } catch (error) {
    console.warn('[investment-intelligence] tracked ideas load failed', error);
  }
  try {
    const marketCached = await getStore().get<PersistedMarketHistoryStore>(MARKET_HISTORY_KEY);
    S.setMarketHistory(marketCached?.points ?? []);
    rebuildMarketHistoryIndex();
  } catch (error) {
    console.warn('[investment-intelligence] market history load failed', error);
  }
  try {
    const mappingCached = await getStore().get<PersistedMappingStatsStore>(MAPPING_STATS_KEY);
    S.setMappingStats(new Map((mappingCached?.stats ?? []).map((entry) => [entry.id, entry] as const)));
  } catch (error) {
    console.warn('[investment-intelligence] mapping stats load failed', error);
  }
  try {
    const banditCached = await getStore().get<PersistedBanditStateStore>(BANDIT_STATE_KEY);
    S.setBanditStates(new Map((banditCached?.states ?? []).map((entry) => [entry.id, entry] as const)));
  } catch (error) {
    console.warn('[investment-intelligence] bandit state load failed', error);
  }
  try {
    const reviewCached = await getStore().get<PersistedCandidateReviewStore>(CANDIDATE_REVIEWS_KEY);
    S.setCandidateReviews(new Map((reviewCached?.reviews ?? []).map((entry) => {
      const normalized = normalizeCandidateReview(entry);
      return [normalized.id, normalized] as const;
    })));
  } catch (error) {
    console.warn('[investment-intelligence] candidate review load failed', error);
  }
  try {
    const policyCached = await getStore().get<PersistedUniversePolicyStore>(UNIVERSE_POLICY_KEY);
    S.setUniverseExpansionPolicy(normalizeUniverseExpansionPolicy(policyCached?.policy));
  } catch (error) {
    console.warn('[investment-intelligence] universe policy load failed', error);
  }
  try {
    const convictionCached = await getStore().get<PersistedConvictionModelStore>(CONVICTION_MODEL_KEY);
    if (convictionCached?.model) {
      S.setConvictionModelState({
        ...S.convictionModelState,
        ...convictionCached.model,
        weights: {
          ...S.convictionModelState.weights,
          ...(convictionCached.model.weights || {}),
        },
      });
    }
  } catch (error) {
    console.warn('[investment-intelligence] conviction model load failed', error);
  }

  // Load hawkes states
  try {
    const hawkesCached = await getStore().get<{ states: Record<string, HawkesCarryState> }>(HAWKES_STATES_KEY);
    if (hawkesCached?.states) {
      for (const [key, value] of Object.entries(hawkesCached.states)) {
        S.setHawkesState(key, value);
      }
    }
  } catch (error) {
    console.warn('[investment-intelligence] hawkes state load failed', error);
  }

  // Load discovered links and fingerprints
  try {
    const linksCached = await getStore().get<{ links: Record<string, DiscoveredLink> }>(DISCOVERED_LINKS_KEY);
    if (linksCached?.links) {
      const { restoreDiscoveredLinks } = await import('@/services/pattern-discovery');
      restoreDiscoveredLinks(linksCached.links);
    }
  } catch (error) {
    console.warn('[investment-intelligence] discovered links load failed', error);
  }
  try {
    const fpsCached = await getStore().get<{ fingerprints: Record<string, ClusterFingerprint[]> }>(FINGERPRINTS_KEY);
    if (fpsCached?.fingerprints) {
      const { restoreFingerprints } = await import('@/services/pattern-discovery');
      restoreFingerprints(fpsCached.fingerprints);
    }
  } catch (error) {
    console.warn('[investment-intelligence] fingerprints load failed', error);
  }
}

export async function persist(): Promise<void> {
  // IS-4: Take snapshot before writing for rollback safety
  const stateStore = getStateStoreAdapter();
  let rollbackSnapshot;
  try {
    rollbackSnapshot = await stateStore.snapshot();
  } catch {
    // Snapshot failed — proceed without rollback safety
  }

  try {
    await _doPersist();
  } catch (persistError) {
    // Attempt rollback if we have a snapshot
    if (rollbackSnapshot) {
      try {
        await stateStore.restore(rollbackSnapshot);
        console.warn('[investment-intelligence] persist failed, rolled back to snapshot');
      } catch (rollbackError) {
        console.error('[investment-intelligence] rollback also failed', rollbackError);
      }
    }
    throw persistError;
  }
}

async function _doPersist(): Promise<void> {
  const store = getStore();
  await store.set(SNAPSHOT_KEY, { snapshot: S.currentSnapshot });
  await store.set(HISTORY_KEY, { entries: S.currentHistory.slice(0, MAX_HISTORY) });
  await store.set(TRACKED_IDEAS_KEY, { ideas: S.trackedIdeas.slice(0, MAX_TRACKED_IDEAS) });
  await store.set(MARKET_HISTORY_KEY, { points: S.marketHistory.slice(-MAX_MARKET_HISTORY_POINTS) });
  await store.set(MAPPING_STATS_KEY, {
    stats: Array.from(S.mappingStats.values())
      .sort((a, b) => Date.parse(b.lastUpdatedAt) - Date.parse(a.lastUpdatedAt) || b.observations - a.observations)
      .slice(0, MAX_MAPPING_STATS),
  });
  await store.set(BANDIT_STATE_KEY, {
    states: Array.from(S.banditStates.values())
      .sort((a, b) => Date.parse(b.lastUpdatedAt) - Date.parse(a.lastUpdatedAt) || b.pulls - a.pulls)
      .slice(0, MAX_BANDIT_STATES),
  });
  await store.set(CANDIDATE_REVIEWS_KEY, {
    reviews: Array.from(S.candidateReviews.values())
      .sort((a, b) => Date.parse(b.lastUpdatedAt) - Date.parse(a.lastUpdatedAt))
      .slice(0, MAX_CANDIDATE_REVIEWS),
  });
  await store.set(UNIVERSE_POLICY_KEY, {
    policy: S.universeExpansionPolicy,
  });
  await store.set(CONVICTION_MODEL_KEY, {
    model: S.convictionModelState,
  });

  // Persist hawkes states
  const hawkesData: Record<string, HawkesCarryState> = {};
  for (const [key, value] of S.getAllHawkesStates()) {
    hawkesData[key] = value;
  }
  await store.set(HAWKES_STATES_KEY, { states: hawkesData });

  // Persist discovered links and fingerprints
  try {
    const { getAllDiscoveredLinks, getAllFingerprints } = await import('@/services/pattern-discovery');
    const linksData: Record<string, DiscoveredLink> = {};
    for (const [key, value] of getAllDiscoveredLinks()) {
      linksData[key] = value;
    }
    await store.set(DISCOVERED_LINKS_KEY, { links: linksData });

    const fpsData: Record<string, ClusterFingerprint[]> = {};
    for (const [key, value] of getAllFingerprints()) {
      fpsData[key] = value;
    }
    await store.set(FINGERPRINTS_KEY, { fingerprints: fpsData });
  } catch {
    // Pattern discovery persistence is best-effort
  }
}

export async function getInvestmentIntelligenceSnapshot(): Promise<InvestmentIntelligenceSnapshot | null> {
  await ensureLoaded();
  return S.currentSnapshot;
}

export async function getUniverseExpansionPolicy(): Promise<UniverseExpansionPolicy> {
  await ensureLoaded();
  return { ...S.universeExpansionPolicy };
}

export async function setUniverseExpansionPolicyMode(mode: UniverseExpansionMode): Promise<UniverseExpansionPolicy> {
  await ensureLoaded();
  S.setUniverseExpansionPolicy(normalizeUniverseExpansionPolicy({
    ...S.universeExpansionPolicy,
    mode,
  }));
  const snapshot = S.currentSnapshot;
  if (snapshot) {
    S.setCurrentSnapshot({
      ...snapshot,
      universePolicy: { ...S.universeExpansionPolicy },
    });
  }
  await persist();
  return { ...S.universeExpansionPolicy };
}

function syncSnapshotReviewState(): void {
  const snapshot = S.currentSnapshot;
  if (!snapshot) return;
  const reviews = Array.from(S.candidateReviews.values())
    .sort((a, b) => {
      const statusRank = (value: CandidateExpansionReview['status']): number => (value === 'open' ? 0 : value === 'accepted' ? 1 : 2);
      return statusRank(a.status) - statusRank(b.status)
        || b.confidence - a.confidence
        || Date.parse(b.lastUpdatedAt) - Date.parse(a.lastUpdatedAt);
    })
    .slice(0, MAX_CANDIDATE_REVIEWS);
  S.setCurrentSnapshot({
    ...snapshot,
    universePolicy: { ...S.universeExpansionPolicy },
    candidateReviews: reviews,
    universeCoverage: {
      ...snapshot.universeCoverage,
      dynamicApprovedCount: reviews.filter((review) => review.status === 'accepted').length,
      openReviewCount: reviews.filter((review) => review.status === 'open').length,
    },
    summaryLines: [
      ...snapshot.summaryLines.filter((line) =>
        !/^\d+ approved expansion candidates, /i.test(line)
        && !/^Universe policy=/i.test(line),
      ),
      `${reviews.filter((review) => review.status === 'accepted').length} approved expansion candidates, ${reviews.filter((review) => review.status === 'open').length} open review items, and ${snapshot.coverageGaps.length} current coverage gaps tracked.`,
      `Universe policy=${S.universeExpansionPolicy.mode} scoreThreshold=${S.universeExpansionPolicy.minAutoApproveScore} codexFloor=${S.universeExpansionPolicy.minCodexConfidence} requireMarketData=${S.universeExpansionPolicy.requireMarketData ? 'yes' : 'no'} sectorCap=${S.universeExpansionPolicy.maxAutoApprovalsPerSectorPerTheme} kindCap=${S.universeExpansionPolicy.maxAutoApprovalsPerAssetKindPerTheme}.`,
    ],
  });
}

export async function listCandidateExpansionReviews(limit = 48): Promise<CandidateExpansionReview[]> {
  await ensureLoaded();
  return Array.from(S.candidateReviews.values())
    .sort((a, b) => {
      const statusRank = (value: CandidateExpansionReview['status']): number => (value === 'open' ? 0 : value === 'accepted' ? 1 : 2);
      return statusRank(a.status) - statusRank(b.status)
        || b.confidence - a.confidence
        || Date.parse(b.lastUpdatedAt) - Date.parse(a.lastUpdatedAt);
    })
    .slice(0, Math.max(1, limit))
    .map((review) => ({ ...review, supportingSignals: review.supportingSignals.slice() }));
}

export async function setCandidateExpansionReviewStatus(
  reviewId: string,
  status: CandidateExpansionReview['status'],
): Promise<CandidateExpansionReview | null> {
  await ensureLoaded();
  const existing = S.candidateReviews.get(reviewId);
  if (!existing) return null;
  const next: CandidateExpansionReview = {
    ...existing,
    status,
    autoApproved: status === 'accepted' ? false : existing.autoApproved,
    autoApprovalMode: status === 'accepted' ? null : existing.autoApprovalMode,
    acceptedAt: status === 'accepted' ? nowIso() : existing.acceptedAt || null,
    probationStatus: status === 'accepted' ? 'n/a' : existing.probationStatus,
    probationCycles: status === 'accepted' ? 0 : existing.probationCycles,
    probationHits: status === 'accepted' ? 0 : existing.probationHits,
    probationMisses: status === 'accepted' ? 0 : existing.probationMisses,
    lastUpdatedAt: nowIso(),
  };
  const updated = new Map(S.candidateReviews);
  updated.set(reviewId, next);
  S.setCandidateReviews(updated);
  syncSnapshotReviewState();
  await persist();
  return { ...next, supportingSignals: next.supportingSignals.slice() };
}

export function getInvestmentThemeDefinition(themeId: string): InvestmentThemeDefinition | null {
  const theme = getThemeRule(themeId);
  if (!theme) return null;
  return {
    ...theme,
    triggers: theme.triggers.slice(),
    sectors: theme.sectors.slice(),
    commodities: theme.commodities.slice(),
    invalidation: theme.invalidation.slice(),
    assets: getEffectiveThemeAssets(theme).map((asset) => ({ ...asset })),
  };
}

function applyCurrentUniversePolicyToReviews(): void {
  const applied = applyUniverseExpansionPolicy(
    Array.from(S.candidateReviews.values()).map((review) => normalizeCandidateReview(review)),
    S.universeExpansionPolicy,
  );
  S.setCandidateReviews(new Map(applied.map((review) => [review.id, review] as const)));
}

export async function ingestCodexCandidateExpansionProposals(
  themeId: string,
  proposals: CodexCandidateExpansionProposal[],
): Promise<CandidateExpansionReview[]> {
  await ensureLoaded();
  const theme = getThemeRule(themeId);
  const snapshot = S.currentSnapshot;
  if (!theme || !snapshot) return [];

  const existingAssets = new Set(getEffectiveThemeAssets(theme).map(themeAssetKey));
  const inserted: CandidateExpansionReview[] = [];

  for (const proposal of (proposals || []).slice(0, 10)) {
    const symbol = String(proposal.symbol || '').trim().toUpperCase();
    if (!symbol) continue;
    const direction = proposal.direction || 'watch';
    const role = proposal.role || (direction === 'hedge' ? 'hedge' : 'confirm');
    const assetKind = proposal.assetKind || 'equity';
    const asset: ThemeAssetDefinition = {
      symbol,
      name: String(proposal.assetName || symbol).trim() || symbol,
      assetKind,
      sector: String(proposal.sector || theme.sectors[0] || 'cross-asset').trim() || 'cross-asset',
      commodity: proposal.commodity || undefined,
      direction,
      role,
    };
    if (existingAssets.has(themeAssetKey(asset))) continue;
    const reviewId = candidateReviewId(theme.id, symbol, direction, role);
    const previous = S.candidateReviews.get(reviewId);
    const next: CandidateExpansionReview = {
      id: reviewId,
      themeId: theme.id,
      themeLabel: theme.label,
      symbol,
      assetName: asset.name,
      assetKind,
      sector: asset.sector,
      commodity: proposal.commodity || null,
      direction,
      role,
      confidence: clamp(Math.round(Number(proposal.confidence) || 62), 25, 95),
      source: 'codex',
      status: previous?.status || 'open',
      reason: String(proposal.reason || `Codex proposed ${symbol} as an additional ${theme.label} candidate.`).slice(0, 280),
      supportingSignals: Array.isArray(proposal.supportingSignals)
        ? proposal.supportingSignals.map((signal) => String(signal).slice(0, 140)).filter(Boolean).slice(0, 8)
        : [`Theme=${theme.label}`, 'Codex review proposal'],
      requiresMarketData: !snapshot.directMappings.some((mapping) => mapping.symbol === symbol),
      autoApproved: previous?.autoApproved || false,
      autoApprovalMode: previous?.autoApprovalMode || null,
      acceptedAt: previous?.acceptedAt || null,
      probationStatus: previous?.probationStatus || 'n/a',
      probationCycles: previous?.probationCycles || 0,
      probationHits: previous?.probationHits || 0,
      probationMisses: previous?.probationMisses || 0,
      lastUpdatedAt: nowIso(),
    };
    const updated = new Map(S.candidateReviews);
    updated.set(reviewId, next);
    S.setCandidateReviews(updated);
  }

  applyCurrentUniversePolicyToReviews();

  for (const proposal of (proposals || []).slice(0, 10)) {
    const symbol = String(proposal.symbol || '').trim().toUpperCase();
    if (!symbol) continue;
    const direction = proposal.direction || 'watch';
    const role = proposal.role || (direction === 'hedge' ? 'hedge' : 'confirm');
    const reviewId = candidateReviewId(theme.id, symbol, direction, role);
    const stored = S.candidateReviews.get(reviewId);
    if (stored) inserted.push({ ...stored, supportingSignals: stored.supportingSignals.slice() });
  }

  syncSnapshotReviewState();
  await persist();
  return inserted;
}

export async function requestCodexCandidateExpansion(themeId: string): Promise<CandidateExpansionReview[]> {
  await ensureLoaded();
  const theme = getThemeRule(themeId);
  const snapshot = S.currentSnapshot;
  if (!theme || !snapshot) return [];

  const themeMappings = snapshot.directMappings
    .filter((mapping) => mapping.themeId === themeId)
    .slice(0, 8)
    .map((mapping) => ({
      symbol: mapping.symbol,
      assetName: mapping.assetName,
      assetKind: mapping.assetKind,
      sector: mapping.sector,
      commodity: mapping.commodity,
      direction: mapping.direction,
      role: mapping.role,
      conviction: mapping.conviction,
      falsePositiveRisk: mapping.falsePositiveRisk,
      transferEntropy: mapping.transferEntropy ?? 0,
    }));
  const watchlist = getMarketWatchlistEntries().slice(0, 20);
  const response = await fetch('/api/local-codex-candidate-expansion', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      themeId: theme.id,
      themeLabel: theme.label,
      thesis: theme.thesis,
      timeframe: theme.timeframe,
      triggers: theme.triggers.slice(0, 12),
      sectors: theme.sectors,
      commodities: theme.commodities,
      invalidation: theme.invalidation,
      topMappings: themeMappings,
      watchlist,
      existingSymbols: getEffectiveThemeAssets(theme).map((asset) => asset.symbol),
    }),
  });
  if (!response.ok) {
    throw new Error(`Codex candidate expansion failed: ${response.status}`);
  }
  const payload = await response.json() as LocalCodexCandidateExpansionResponse;
  return ingestCodexCandidateExpansionProposals(themeId, Array.isArray(payload.proposals) ? payload.proposals : []);
}

export async function listMappingPerformanceStats(limit = 160): Promise<MappingPerformanceStats[]> {
  await ensureLoaded();
  return Array.from(S.mappingStats.values())
    .sort((a, b) => Date.parse(b.lastUpdatedAt) - Date.parse(a.lastUpdatedAt) || b.observations - a.observations)
    .slice(0, Math.max(1, limit))
    .map((entry) => ({ ...entry }));
}

export async function exportInvestmentLearningState(): Promise<InvestmentLearningState> {
  await ensureLoaded();
  const snapshot = S.currentSnapshot;
  return {
    snapshot: snapshot ? {
      ...snapshot,
      workflow: snapshot.workflow.map((step) => ({ ...step })),
      directMappings: snapshot.directMappings.map((item) => ({ ...item, reasons: item.reasons.slice(), transmissionPath: item.transmissionPath.slice(), tags: item.tags.slice() })),
      sectorSensitivity: snapshot.sectorSensitivity.map((row) => ({ ...row, drivers: row.drivers.slice(), symbols: row.symbols.slice() })),
      analogs: snapshot.analogs.map((item) => ({ ...item, symbols: item.symbols.slice(), themes: item.themes.slice() })),
      backtests: snapshot.backtests.map((row) => ({ ...row, notes: row.notes.slice() })),
      positionSizingRules: snapshot.positionSizingRules.map((rule) => ({ ...rule, notes: rule.notes.slice() })),
      ideaCards: snapshot.ideaCards.map((card) => ({
        ...card,
        symbols: card.symbols.map((symbol) => ({ ...symbol })),
        triggers: card.triggers.slice(),
        invalidation: card.invalidation.slice(),
        evidence: card.evidence.slice(),
        transmissionPath: card.transmissionPath.slice(),
        sectorExposure: card.sectorExposure.slice(),
        analogRefs: card.analogRefs.slice(),
      })),
      trackedIdeas: snapshot.trackedIdeas.map((idea) => ({
        ...idea,
        symbols: idea.symbols.map((symbol) => ({ ...symbol })),
        evidence: idea.evidence.slice(),
        triggers: idea.triggers.slice(),
        invalidation: idea.invalidation.slice(),
      })),
      falsePositive: {
        ...snapshot.falsePositive,
        reasons: snapshot.falsePositive.reasons.map((reason) => ({ ...reason })),
      },
      universePolicy: { ...snapshot.universePolicy },
      universeCoverage: {
        ...snapshot.universeCoverage,
        activeAssetKinds: snapshot.universeCoverage.activeAssetKinds.slice(),
        activeSectors: snapshot.universeCoverage.activeSectors.slice(),
      },
      coverageGaps: snapshot.coverageGaps.map((gap) => ({
        ...gap,
        missingAssetKinds: gap.missingAssetKinds.slice(),
        missingSectors: gap.missingSectors.slice(),
        suggestedSymbols: gap.suggestedSymbols.slice(),
      })),
      candidateReviews: snapshot.candidateReviews.map((review) => ({
        ...review,
        supportingSignals: review.supportingSignals.slice(),
      })),
      summaryLines: snapshot.summaryLines.slice(),
    } : null,
    history: S.currentHistory.map((entry) => ({ ...entry, themes: entry.themes.slice(), regions: entry.regions.slice(), symbols: entry.symbols.slice() })),
    trackedIdeas: S.trackedIdeas.map((idea) => ({
      ...idea,
      symbols: idea.symbols.map((symbol) => ({ ...symbol })),
      evidence: idea.evidence.slice(),
      triggers: idea.triggers.slice(),
      invalidation: idea.invalidation.slice(),
    })),
    marketHistory: S.marketHistory.map((point) => ({ ...point })),
    mappingStats: Array.from(S.mappingStats.values()).map((entry) => ({ ...entry })),
    banditStates: Array.from(S.banditStates.values()).map((entry) => ({
      ...entry,
      matrixA: entry.matrixA.map((row) => row.slice()),
      vectorB: entry.vectorB.slice(),
    })),
    candidateReviews: Array.from(S.candidateReviews.values()).map((review) => ({
      ...review,
      supportingSignals: review.supportingSignals.slice(),
    })),
    convictionModel: {
      ...S.convictionModelState,
      weights: { ...S.convictionModelState.weights },
    },
  };
}

export async function resetInvestmentLearningState(seed?: Partial<InvestmentLearningState>): Promise<void> {
  await ensureLoaded();
  S.setCurrentSnapshot(seed?.snapshot ?? null);
  S.setCurrentSnapshot(normalizeInvestmentSnapshot(S.currentSnapshot));
  S.setUniverseExpansionPolicy(normalizeUniverseExpansionPolicy(S.currentSnapshot?.universePolicy || S.universeExpansionPolicy));
  S.setCurrentHistory((seed?.history ?? []).map((entry) => ({
    ...entry,
    themes: entry.themes.slice(),
    regions: entry.regions.slice(),
    symbols: entry.symbols.slice(),
  })));
  S.setTrackedIdeas((seed?.trackedIdeas ?? []).map((idea) => ({
    ...idea,
    symbols: idea.symbols.map((symbol) => ({ ...symbol })),
    evidence: idea.evidence.slice(),
    triggers: idea.triggers.slice(),
    invalidation: idea.invalidation.slice(),
  })));
  S.setMarketHistory((seed?.marketHistory ?? []).map((point) => ({ ...point })));
  rebuildMarketHistoryIndex();
  S.setMappingStats(new Map((seed?.mappingStats ?? []).map((entry) => [entry.id, { ...entry }] as const)));
  S.setBanditStates(new Map((seed?.banditStates ?? []).map((entry) => [entry.id, {
    ...entry,
    matrixA: entry.matrixA.map((row) => row.slice()),
    vectorB: entry.vectorB.slice(),
  }] as const)));
  S.setConvictionModelState(seed?.convictionModel
    ? {
      ...S.convictionModelState,
      ...seed.convictionModel,
      weights: {
        ...S.convictionModelState.weights,
        ...(seed.convictionModel.weights || {}),
      },
    }
    : S.convictionModelState);
  S.setCandidateReviews(new Map((seed?.candidateReviews ?? []).map((review) => {
    const normalized = normalizeCandidateReview(review);
    return [normalized.id, normalized] as const;
  })));
  await persist();
}
