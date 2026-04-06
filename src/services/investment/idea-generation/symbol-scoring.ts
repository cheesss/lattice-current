import type { MarketData } from '@/types';
import type { MacroRiskOverlay } from '../../macro-risk-overlay';

import type {
  InvestmentIdeaSymbol, DirectAssetMapping,
  ThemeAssetDefinition, InvestmentAssetKind,
} from '../types';
import { clamp } from '../utils';

// ============================================================================
// SYMBOL ROLE RANKING & SCORING
// ============================================================================

export function rankIdeaSymbolRole(role: InvestmentIdeaSymbol['role']): number {
  if (role === 'primary') return 3;
  if (role === 'confirm') return 2;
  return 1;
}

export function scoreIdeaSymbolChoice(symbol: InvestmentIdeaSymbol): number {
  return (
    rankIdeaSymbolRole(symbol.role) * 100
    + (typeof symbol.realityScore === 'number' ? symbol.realityScore : 0)
    + (typeof symbol.liquidityScore === 'number' ? symbol.liquidityScore * 0.5 : 0)
    + (typeof symbol.banditScore === 'number' ? symbol.banditScore * 10 : 0)
  );
}

export function dedupeIdeaSymbols(symbols: InvestmentIdeaSymbol[]): InvestmentIdeaSymbol[] {
  const bestByKey = new Map<string, InvestmentIdeaSymbol>();
  for (const symbol of symbols) {
    const key = `${symbol.symbol}::${symbol.direction}`;
    const existing = bestByKey.get(key);
    if (!existing || scoreIdeaSymbolChoice(symbol) > scoreIdeaSymbolChoice(existing)) {
      bestByKey.set(key, symbol);
    }
  }
  return Array.from(bestByKey.values()).sort(
    (left, right) =>
      rankIdeaSymbolRole(right.role) - rankIdeaSymbolRole(left.role)
      || (typeof right.banditScore === 'number' ? right.banditScore : -Infinity) - (typeof left.banditScore === 'number' ? left.banditScore : -Infinity)
      || (typeof right.realityScore === 'number' ? right.realityScore : 0) - (typeof left.realityScore === 'number' ? left.realityScore : 0),
  );
}

// ============================================================================
// LIQUIDITY & MACRO PENALTY SCORING
// ============================================================================

export function liquidityBaseline(kind: InvestmentAssetKind): number {
  if (kind === 'etf') return 72;
  if (kind === 'equity') return 64;
  if (kind === 'commodity') return 58;
  if (kind === 'rate') return 70;
  if (kind === 'fx') return 74;
  return 56;
}

export function macroPenaltyForAsset(asset: ThemeAssetDefinition, overlay: MacroRiskOverlay): number {
  if (overlay.killSwitch) {
    return asset.direction === 'hedge' ? 0 : 26;
  }
  if (overlay.state === 'risk-off') {
    if (asset.direction === 'hedge') return -4;
    return asset.assetKind === 'equity' || asset.assetKind === 'crypto' ? 16 : 10;
  }
  if (overlay.state === 'balanced') {
    return asset.direction === 'hedge' ? 0 : 6;
  }
  if (overlay.state === 'risk-on' && asset.direction === 'hedge') {
    return 4;
  }
  return 0;
}

// ============================================================================
// MARKET DATA MAPPING & EXECUTION READINESS
// ============================================================================

export function marketMoveMap(markets: MarketData[]): Map<string, MarketData> {
  const map = new Map<string, MarketData>();
  for (const market of markets) {
    if (market.symbol) map.set(market.symbol, market);
  }
  return map;
}

export function executionReadinessScore(mapping: Pick<
  DirectAssetMapping,
  'assetKind' | 'tradableNow' | 'sessionState' | 'liquidityScore' | 'executionPenaltyPct'
>): number {
  const tradableScore = mapping.tradableNow
    ? 100
    : mapping.assetKind === 'crypto'
      ? 78
      : 56;
  const sessionScore = mapping.sessionState === 'always-on'
    ? 100
    : mapping.sessionState === 'open'
      ? 96
      : mapping.sessionState === 'extended'
        ? 82
        : 58;
  const liquidityScore = clamp(Number(mapping.liquidityScore) || 0, 0, 100);
  const penaltyScore = clamp(100 - (Number(mapping.executionPenaltyPct) || 0) * 18, 0, 100);
  return clamp(
    Math.round(
      tradableScore * 0.34
      + sessionScore * 0.24
      + liquidityScore * 0.26
      + penaltyScore * 0.16
    ),
    0,
    100,
  );
}
