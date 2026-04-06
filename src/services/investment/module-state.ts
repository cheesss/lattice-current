import {
  InvestmentIntelligenceSnapshot,
  InvestmentHistoryEntry,
  TrackedIdeaState,
  MarketHistoryPoint,
  MappingPerformanceStats,
  CandidateExpansionReview,
  InvestmentThemeDefinition,
  UniverseExpansionPolicy,
  ConvictionModelState,
} from './types';
import { BanditArmState } from '../math-models/contextual-bandit';
import { DEFAULT_UNIVERSE_EXPANSION_POLICY } from './constants';

const MAX_MARKET_HISTORY_KEYS = 10_000;

// Mutable module-level state
export let loaded = false;
export let currentSnapshot: InvestmentIntelligenceSnapshot | null = null;
export let currentHistory: InvestmentHistoryEntry[] = [];
export let trackedIdeas: TrackedIdeaState[] = [];
export let marketHistory: MarketHistoryPoint[] = [];
export let marketHistoryKeys = new Set<string>();
export let mappingStats = new Map<string, MappingPerformanceStats>();
export let banditStates = new Map<string, BanditArmState>();
export let candidateReviews = new Map<string, CandidateExpansionReview>();
export let automatedThemes = new Map<string, InvestmentThemeDefinition>();
export let universeExpansionPolicy: UniverseExpansionPolicy = { ...DEFAULT_UNIVERSE_EXPANSION_POLICY };
export let convictionModelState: ConvictionModelState = {
  weights: {
    corroborationQuality: 0.22,
    recentEvidenceScore: 0.16,
    realityScore: 0.17,
    graphSignalScore: 0.11,
    transferEntropy: 0.1,
    banditScore: 0.09,
    regimeMultiplier: 0.08,
    coveragePenalty: -0.14,
    falsePositiveRisk: -0.18,
  },
  bias: 0,
  observations: 0,
  learningRate: 0.08,
  updatedAt: new Date().toISOString(),
};

// Setter functions for external mutation
export function setLoaded(v: boolean) {
  loaded = v;
}

export function setCurrentSnapshot(v: InvestmentIntelligenceSnapshot | null) {
  currentSnapshot = v;
}

export function setCurrentHistory(v: InvestmentHistoryEntry[]) {
  currentHistory = v;
}

export function setTrackedIdeas(v: TrackedIdeaState[]) {
  trackedIdeas = v;
}

export function setMarketHistory(v: MarketHistoryPoint[]) {
  marketHistory = v;
}

export function setMarketHistoryKeys(v: Set<string>) {
  marketHistoryKeys = v;
  boundMarketHistoryKeys();
}

function boundMarketHistoryKeys(): void {
  if (marketHistoryKeys.size <= MAX_MARKET_HISTORY_KEYS) return;
  const toRemove = Math.floor(marketHistoryKeys.size * 0.2);
  let removed = 0;
  for (const key of marketHistoryKeys.keys()) {
    if (removed >= toRemove) break;
    marketHistoryKeys.delete(key);
    removed++;
  }
}

export function setMappingStats(v: Map<string, MappingPerformanceStats>) {
  mappingStats = v;
}

export function setBanditStates(v: Map<string, BanditArmState>) {
  banditStates = v;
}

export function setCandidateReviews(v: Map<string, CandidateExpansionReview>) {
  candidateReviews = v;
}

export function setAutomatedThemes(v: Map<string, InvestmentThemeDefinition>) {
  automatedThemes = v;
}

export function setUniverseExpansionPolicy(v: UniverseExpansionPolicy) {
  universeExpansionPolicy = v;
}

export function setConvictionModelState(v: ConvictionModelState) {
  convictionModelState = v;
}

// --- Hawkes state persistence across frames ---
export interface HawkesCarryState {
  themeId: string;
  lastLambda: number;
  lastNormalized: number;
  fittedAlpha: number;
  fittedBetaHours: number;
  eventPoints: Array<{ timestamp: number; weight: number }>;
  updatedAt: string;
}

const hawkesStates = new Map<string, HawkesCarryState>();

export function getHawkesState(themeId: string): HawkesCarryState | null {
  return hawkesStates.get(themeId) ?? null;
}

export function setHawkesState(themeId: string, state: HawkesCarryState): void {
  hawkesStates.set(themeId, state);
  if (hawkesStates.size > 20) {
    const oldest = [...hawkesStates.entries()].sort((a, b) =>
      new Date(a[1].updatedAt).getTime() - new Date(b[1].updatedAt).getTime()
    )[0];
    if (oldest) hawkesStates.delete(oldest[0]);
  }
}

export function getAllHawkesStates(): Map<string, HawkesCarryState> {
  return hawkesStates;
}

// --- Pattern discovery persistence ---
import type { DiscoveredLink, ClusterFingerprint } from '@/services/pattern-discovery';

let persistedDiscoveredLinks: Record<string, DiscoveredLink> = {};
let persistedFingerprints: Record<string, ClusterFingerprint[]> = {};

export function getPersistedDiscoveredLinks(): Record<string, DiscoveredLink> {
  return persistedDiscoveredLinks;
}

const MAX_DISCOVERED_LINK_SAMPLES = 100;

export function setPersistedDiscoveredLinks(links: Record<string, DiscoveredLink>): void {
  for (const link of Object.values(links)) {
    if (link.samples && link.samples.length > MAX_DISCOVERED_LINK_SAMPLES) {
      link.samples = link.samples.slice(-MAX_DISCOVERED_LINK_SAMPLES);
    }
  }
  persistedDiscoveredLinks = links;
}

export function getPersistedFingerprints(): Record<string, ClusterFingerprint[]> {
  return persistedFingerprints;
}

export function setPersistedFingerprints(fps: Record<string, ClusterFingerprint[]>): void {
  persistedFingerprints = fps;
}
