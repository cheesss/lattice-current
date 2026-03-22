
import type { MarketData, ClusteredEvent, NewsItem } from '@/types';

export interface MarketRegimeState {
  id: 'standard' | 'volatility' | 'momentum' | 'stress';
  label: string;
  confidence: number;
}

export interface RegimeInferenceArgs {
  markets: MarketData[];
  clusters: ClusteredEvent[];
  news: NewsItem[];
  previous: MarketRegimeState | null;
}

/**
 * Infers the current market regime based on multi-domain indicators.
 */
export function inferMarketRegime(args: RegimeInferenceArgs): MarketRegimeState {
  const avgAbsChange = args.markets.length > 0
    ? args.markets.reduce((sum, m) => sum + Math.abs(m.change || 0), 0) / args.markets.length
    : 0;
  
  const highImpactClusters = args.clusters.filter(c => c.isAlert || c.sourceCount > 4).length;
  const criticalNews = args.news.filter(n => n.threat?.level === 'critical').length;

  let id: MarketRegimeState['id'] = 'standard';
  let confidence = 0.6;

  if (avgAbsChange > 2.5 || criticalNews > 2) {
    id = 'stress';
    confidence = Math.min(0.95, 0.5 + avgAbsChange * 0.1 + criticalNews * 0.1);
  } else if (avgAbsChange > 1.2 || highImpactClusters > 5) {
    id = 'volatility';
    confidence = 0.7;
  } else if (avgAbsChange < 0.3) {
    id = 'momentum'; // Low volatility momentum
    confidence = 0.65;
  }

  const labels: Record<MarketRegimeState['id'], string> = {
    standard: 'Standard Equilibrium',
    volatility: 'Elevated Volatility',
    momentum: 'Low-Vol Momentum',
    stress: 'Systemic Stress',
  };

  return { id, label: labels[id], confidence };
}

/**
 * Returns a multiplier for transmission strength based on the current regime and relation type.
 */
export function regimeMultiplierForRelation(regime: MarketRegimeState, relationType: string): number {
  if (regime.id === 'stress') return 1.4;
  if (regime.id === 'volatility') return 1.15;
  if (regime.id === 'momentum' && (relationType === 'commodity' || relationType === 'equity')) return 1.1;
  return 1.0;
}
