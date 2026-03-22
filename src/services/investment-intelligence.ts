
import type { ClusteredEvent, MarketData } from '@/types';
import type { SourceCredibilityProfile } from './source-credibility';
import type { ScheduledReport } from './scheduled-reports';
import type { EventMarketTransmissionSnapshot } from './event-market-transmission';
import { getPersistentCache, setPersistentCache } from './persistent-cache';

export type InvestmentDirection = 'long' | 'short' | 'watch';

export interface InvestmentIdeaCard {
  id: string;
  themeId: string;
  title: string;
  direction: InvestmentDirection;
  conviction: number;
  falsePositiveRisk: number;
  sizePct: number;
  timeframe: string;
  thesis: string;
  evidence: string[];
  triggers: string[];
  invalidation: string[];
  transmissionPath: string[];
  analogRefs: string[];
  symbols: Array<{
    symbol: string;
    name: string;
    role: 'primary' | 'confirm' | 'hedge';
    direction: InvestmentDirection;
    assetKind: 'etf' | 'equity' | 'commodity' | 'fx' | 'rate' | 'crypto';
    liquidityScore: number;
  }>;
}

export interface MappingPerformanceStats {
  id: string;
  term: string;
  category: string;
  priorWinRate: number;
  posteriorWinRate: number;
  observationCount: number;
  lastUpdated: string;
}

export interface InvestmentIntelligenceSnapshot {
  generatedAt: string;
  ideaCards: InvestmentIdeaCard[];
  trackedIdeas: string[]; // IDs
  workflow: Array<{ id: string; step: string; status: 'todo' | 'doing' | 'done' }>;
}

export interface InvestmentLearningState {
  banditStates: Record<string, { alpha: number; beta: number }>;
  candidateReviews: Record<string, { score: number; count: number }>;
  snapshot?: InvestmentIntelligenceSnapshot;
  mappingStats?: MappingPerformanceStats[];
}

const LEARNING_STATE_KEY = 'investment-learning:v1';

let learningState: InvestmentLearningState = {
  banditStates: {},
  candidateReviews: {},
};

export async function exportInvestmentLearningState(): Promise<InvestmentLearningState> {
  const cached = await getPersistentCache<InvestmentLearningState>(LEARNING_STATE_KEY);
  return cached?.data || learningState;
}

export async function resetInvestmentLearningState(state?: Partial<InvestmentLearningState>): Promise<void> {
  learningState = {
    banditStates: state?.banditStates || {},
    candidateReviews: state?.candidateReviews || {},
  };
  await setPersistentCache(LEARNING_STATE_KEY, learningState);
}

export async function listMappingPerformanceStats(limit = 100): Promise<MappingPerformanceStats[]> {
  // Mocking stats for now, in a real app these would be tracked based on backtest results
  return [
    { id: '1', term: 'Semiconductor', category: 'equity', priorWinRate: 55, posteriorWinRate: 62, observationCount: 12, lastUpdated: new Date().toISOString() },
    { id: '2', term: 'Oil Supply', category: 'commodity', priorWinRate: 50, posteriorWinRate: 48, observationCount: 8, lastUpdated: new Date().toISOString() },
  ].slice(0, limit);
}

export async function recomputeInvestmentIntelligence(args: {
  clusters: ClusteredEvent[];
  markets: MarketData[];
  transmission: EventMarketTransmissionSnapshot | null;
  sourceCredibility: SourceCredibilityProfile[];
  reports: ScheduledReport[];
  keywordGraph?: any;
}): Promise<InvestmentIntelligenceSnapshot> {
  const ideaCards: InvestmentIdeaCard[] = [];

  // Logic to generate idea cards from clusters and transmission
  for (const cluster of args.clusters.slice(0, 5)) {
    if (!cluster.isAlert && cluster.sourceCount < 3) continue;
    
    const relatedTransmission = args.transmission?.edges.filter(e => e.eventTitle === cluster.primaryTitle)[0];
    
    ideaCards.push({
      id: `idea:${cluster.id}`,
      themeId: cluster.themeId || 'geopolitics',
      title: `${cluster.primaryTitle} | ${relatedTransmission?.marketSymbol || 'Global'}`,
      direction: cluster.threat?.level === 'critical' ? 'short' : 'long',
      conviction: Math.min(95, 40 + cluster.sourceCount * 10),
      falsePositiveRisk: 30,
      sizePct: 2.5,
      timeframe: '2-4 weeks',
      thesis: `Transmission from ${cluster.primarySource} indicates potential move in ${relatedTransmission?.marketName || 'correlated assets'}.`,
      evidence: cluster.relations?.evidence || [],
      triggers: [`Breakout in ${relatedTransmission?.marketSymbol || 'related tickers'}`],
      invalidation: ['De-escalation of core event'],
      transmissionPath: [cluster.primarySource, relatedTransmission?.marketSymbol || 'Macro'].filter(Boolean),
      analogRefs: [],
      symbols: relatedTransmission ? [{
        symbol: relatedTransmission.marketSymbol,
        name: relatedTransmission.marketName,
        role: 'primary',
        direction: cluster.threat?.level === 'critical' ? 'short' : 'long',
        assetKind: 'equity',
        liquidityScore: 85
      }] : [],
    });
  }

  return {
    generatedAt: new Date().toISOString(),
    ideaCards,
    trackedIdeas: ideaCards.map(c => c.id),
    workflow: [
      { id: '1', step: 'Transmission Analysis', status: 'done' },
      { id: '2', step: 'Risk Assessment', status: 'doing' },
      { id: '3', step: 'Execution Planning', status: 'todo' },
    ],
  };
}
