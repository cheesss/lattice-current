import type { InvestmentDirection, InvestmentIdeaCard, InvestmentIdeaSymbol, TrackedIdeaState, TrackedIdeaSymbolState, MappingPerformanceStats } from './types';
import type { MarketData } from '@/types';
import { getAdaptiveParamStore } from './adaptive-params';
import { trackedIdeas, setTrackedIdeas, marketHistory, setMarketHistory, marketHistoryKeys, setMarketHistoryKeys, mappingStats, banditStates } from './module-state';
import { MAX_TRACKED_IDEAS, MAX_MARKET_HISTORY_POINTS, BANDIT_DIMENSION, POSITION_RULES } from './constants';
import { marketHistoryKey, elapsedDays } from './utils';
import { createBanditArmState, BanditArmState } from '../math-models/contextual-bandit';
import { chooseSizingRule } from './sizing-rule';

// Helper functions
function average(values: number[]): number {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function marketPriceMap(markets: MarketData[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const market of markets) {
    if (market.symbol && typeof market.price === 'number' && Number.isFinite(market.price)) {
      map.set(market.symbol, market.price);
    }
  }
  return map;
}

function symbolRoleWeight(role: InvestmentIdeaSymbol['role']): number {
  if (role === 'primary') return 1;
  if (role === 'confirm') return 0.65;
  return 0.4;
}

export function rebuildMarketHistoryIndex(): void {
  let updated = marketHistory
    .slice()
    .sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
  setMarketHistory(updated);
  setMarketHistoryKeys(new Set(updated.map(marketHistoryKey)));
  if (updated.length > MAX_MARKET_HISTORY_POINTS) {
    updated = updated.slice(-MAX_MARKET_HISTORY_POINTS);
    setMarketHistory(updated);
    setMarketHistoryKeys(new Set(updated.map(marketHistoryKey)));
  }
}

export function findMarketHistoryInsertIndex(timestamp: string): number {
  const targetTs = Date.parse(timestamp);
  let lo = 0;
  let hi = marketHistory.length;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    const midTs = Date.parse(marketHistory[mid]?.timestamp || '');
    if (midTs <= targetTs) {
      lo = mid + 1;
    } else {
      hi = mid;
    }
  }
  return lo;
}

export function estimateAtrLikePct(symbols: string[]): number | null {
  const candidates = symbols
    .map((symbol) => {
      const points = marketHistory
        .filter((point) => point.symbol === symbol)
        .slice(-15);
      if (points.length < 2) return null;
      const returns: number[] = [];
      for (let index = 1; index < points.length; index += 1) {
        const prev = points[index - 1];
        const next = points[index];
        if (!prev || !next || !prev.price || !next.price) continue;
        returns.push(Math.abs(((next.price - prev.price) / prev.price) * 100));
      }
      if (!returns.length) return null;
      return average(returns);
    })
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
  if (!candidates.length) return null;
  return Number(average(candidates).toFixed(2));
}

export function computeDirectedReturnPct(direction: InvestmentDirection, entryPrice: number | null, currentPrice: number | null): number | null {
  if (entryPrice == null || currentPrice == null || !Number.isFinite(entryPrice) || !Number.isFinite(currentPrice) || !entryPrice || entryPrice <= 0) {
    return null;
  }
  const safeEntry = entryPrice;
  const safeCurrent = currentPrice;
  const raw = ((safeCurrent - safeEntry) / safeEntry) * 100;
  if (direction === 'short') return Number((-raw).toFixed(2));
  if (direction === 'watch' || direction === 'pair') return Number(raw.toFixed(2));
  return Number(raw.toFixed(2));
}

export function computeWeightedIdeaReturn(symbols: TrackedIdeaSymbolState[]): number | null {
  const weighted: Array<{ value: number; weight: number }> = [];
  for (const symbol of symbols) {
    if (typeof symbol.returnPct !== 'number' || !Number.isFinite(symbol.returnPct)) continue;
    weighted.push({ value: symbol.returnPct, weight: symbolRoleWeight(symbol.role) });
  }
  if (!weighted.length) return null;
  const numerator = weighted.reduce((sum, item) => sum + item.value * item.weight, 0);
  const denominator = weighted.reduce((sum, item) => sum + item.weight, 0);
  if (!denominator) return null;
  return Number((numerator / denominator).toFixed(2));
}

export function appendMarketHistory(markets: MarketData[], timestamp: string): void {
  const entries = markets
    .filter((market): market is MarketData & { symbol: string; price: number } =>
      Boolean(market.symbol) && typeof market.price === 'number' && Number.isFinite(market.price),
    )
    .map((market) => ({
      symbol: market.symbol,
      timestamp,
      price: market.price,
      change: market.change ?? null,
    }));
  if (!entries.length) return;
  let updated = marketHistory.slice();
  for (const point of entries) {
    const key = marketHistoryKey(point);
    if (marketHistoryKeys.has(key)) continue;
    const insertIndex = findMarketHistoryInsertIndex(point.timestamp);
    updated.splice(insertIndex, 0, point);
    marketHistoryKeys.add(key);
  }
  if (updated.length > MAX_MARKET_HISTORY_POINTS) {
    const trimmed = updated.slice(-MAX_MARKET_HISTORY_POINTS);
    setMarketHistory(trimmed);
    setMarketHistoryKeys(new Set(trimmed.map(marketHistoryKey)));
  } else {
    setMarketHistory(updated);
  }
}

export function mappingStatsId(themeId: string, symbol: string, direction: InvestmentDirection): string {
  return `${themeId}::${symbol}::${direction}`;
}

export function getMappingStats(themeId: string, symbol: string, direction: InvestmentDirection): MappingPerformanceStats | null {
  return mappingStats.get(mappingStatsId(themeId, symbol, direction)) || null;
}

export function banditArmId(themeId: string, symbol: string, direction: InvestmentDirection): string {
  return `${themeId}::${symbol}::${direction}`;
}

export function getBanditState(themeId: string, symbol: string, direction: InvestmentDirection): BanditArmState {
  return banditStates.get(banditArmId(themeId, symbol, direction)) || createBanditArmState(banditArmId(themeId, symbol, direction), BANDIT_DIMENSION);
}

function applyAtrAdjustedRule(
  rule: typeof POSITION_RULES[number],
  symbols: InvestmentIdeaSymbol[],
  themeId?: string,
  direction?: InvestmentDirection,
) {
  const store = getAdaptiveParamStore();
  const primarySymbol = symbols[0]?.symbol || '';
  const atrLikePct = estimateAtrLikePct(symbols.map((symbol) => symbol.symbol));
  let stopLossPct = rule.stopLossPct;
  let takeProfitPct = rule.takeProfitPct;
  if (atrLikePct != null) {
    stopLossPct = Number(Math.max(rule.stopLossPct, atrLikePct * 1.5).toFixed(2));
    takeProfitPct = Number(Math.max(rule.takeProfitPct, stopLossPct * 2).toFixed(2));
  }
  if (store.ready) {
    stopLossPct = store.stopLossPct(primarySymbol, stopLossPct);
    takeProfitPct = store.takeProfitPct(primarySymbol, takeProfitPct);
  }
  if (atrLikePct == null && !store.ready) return rule;
  const notes = atrLikePct != null
    ? [...rule.notes, `ATR-like stop ${stopLossPct.toFixed(2)}% / take ${takeProfitPct.toFixed(2)}%`].slice(0, 4)
    : rule.notes;
  let maxPositionPct = rule.maxPositionPct;
  if (store.ready && themeId != null && direction != null) {
    maxPositionPct = store.maxPositionPct(themeId, primarySymbol, direction, rule.maxPositionPct);
  }
  return {
    ...rule,
    stopLossPct,
    takeProfitPct,
    maxPositionPct,
    notes,
  };
}

export function makeTrackingId(ideaKey: string, openedAt: string): string {
  return `${ideaKey}:${openedAt}`;
}

export function updateTrackedSymbols(
  symbols: InvestmentIdeaSymbol[],
  existingSymbols: TrackedIdeaSymbolState[] | null,
  priceMap: Map<string, number>,
): TrackedIdeaSymbolState[] {
  return symbols.map((symbol) => {
    const existing = existingSymbols?.find((item) => item.symbol === symbol.symbol && item.role === symbol.role) || null;
    const currentPrice = priceMap.get(symbol.symbol) ?? existing?.currentPrice ?? null;
    const entryPrice = existing?.entryPrice ?? currentPrice ?? null;
    const returnPct = computeDirectedReturnPct(symbol.direction, entryPrice, currentPrice);
    return {
      symbol: symbol.symbol,
      name: symbol.name,
      role: symbol.role,
      direction: symbol.direction,
      sector: symbol.sector,
      contextVector: symbol.contextVector?.slice(),
      banditScore: symbol.banditScore ?? null,
      entryPrice,
      currentPrice,
      returnPct,
    };
  });
}

export function applyTrackedExitRules(idea: TrackedIdeaState, timestamp: string): TrackedIdeaState {
  if (idea.status === 'closed') return idea;
  const currentReturn = idea.currentReturnPct;
  const daysHeld = elapsedDays(idea.openedAt, timestamp);
  let exitReason: string | undefined;

  if (typeof currentReturn === 'number' && Number.isFinite(currentReturn)) {
    if (currentReturn <= -idea.stopLossPct) {
      exitReason = 'stop-loss';
    } else if (currentReturn >= idea.takeProfitPct) {
      exitReason = 'take-profit';
    }
  }
  if (!exitReason && daysHeld >= idea.maxHoldingDays) {
    exitReason = 'time-stop';
  }
  if (!exitReason && idea.staleCycles >= 3) {
    exitReason = 'signal-decay';
  }

  if (!exitReason) {
    return {
      ...idea,
      daysHeld: Number(daysHeld.toFixed(2)),
    };
  }

  return {
    ...idea,
    status: 'closed',
    closedAt: timestamp,
    daysHeld: Number(daysHeld.toFixed(2)),
    realizedReturnPct: currentReturn,
    exitReason,
  };
}

export function refreshTrackedIdea(
  ideaCard: InvestmentIdeaCard,
  existing: TrackedIdeaState | null,
  priceMap: Map<string, number>,
  timestamp: string,
): TrackedIdeaState {
  const rule = applyAtrAdjustedRule(
    chooseSizingRule(
      ideaCard.conviction,
      ideaCard.falsePositiveRisk,
      ideaCard.direction === 'watch' ? 'hedge' : ideaCard.direction,
    ),
    ideaCard.symbols,
    ideaCard.themeId,
    ideaCard.direction === 'watch' ? 'hedge' : ideaCard.direction,
  );
  const symbols = updateTrackedSymbols(ideaCard.symbols, existing?.symbols ?? null, priceMap);
  const currentReturnPct = computeWeightedIdeaReturn(symbols);
  const bestReturnPct = typeof currentReturnPct === 'number'
    ? Math.max(existing?.bestReturnPct ?? currentReturnPct, currentReturnPct)
    : existing?.bestReturnPct ?? 0;
  const worstReturnPct = typeof currentReturnPct === 'number'
    ? Math.min(existing?.worstReturnPct ?? currentReturnPct, currentReturnPct)
    : existing?.worstReturnPct ?? 0;

  const base: TrackedIdeaState = {
    trackingId: existing?.trackingId || makeTrackingId(ideaCard.id, timestamp),
    ideaKey: ideaCard.id,
    title: ideaCard.title,
    themeId: ideaCard.themeId,
    direction: ideaCard.direction,
    status: existing?.status === 'closed' ? 'closed' : 'open',
    openedAt: existing?.openedAt || timestamp,
    lastMarkedAt: timestamp,
    closedAt: existing?.closedAt,
    sizePct: ideaCard.sizePct,
    conviction: ideaCard.conviction,
    falsePositiveRisk: ideaCard.falsePositiveRisk,
    stopLossPct: rule.stopLossPct,
    takeProfitPct: rule.takeProfitPct,
    maxHoldingDays: rule.maxHoldingDays,
    daysHeld: Number(elapsedDays(existing?.openedAt || timestamp, timestamp).toFixed(2)),
    currentReturnPct,
    realizedReturnPct: existing?.realizedReturnPct ?? null,
    bestReturnPct: Number(bestReturnPct.toFixed(2)),
    worstReturnPct: Number(worstReturnPct.toFixed(2)),
    staleCycles: 0,
    exitReason: existing?.exitReason,
    convictionFeatures: ideaCard.convictionFeatures ? { ...ideaCard.convictionFeatures } : existing?.convictionFeatures,
    symbols,
    evidence: ideaCard.evidence.slice(0, 6),
    triggers: ideaCard.triggers.slice(0, 6),
    invalidation: ideaCard.invalidation.slice(0, 6),
  };

  if (existing?.status === 'closed') {
    return base;
  }
  return applyTrackedExitRules(base, timestamp);
}

export function decayMissingTrackedIdea(existing: TrackedIdeaState, priceMap: Map<string, number>, timestamp: string): TrackedIdeaState {
  if (existing.status === 'closed') return existing;
  const symbols = existing.symbols.map((symbol) => {
    const currentPrice = priceMap.get(symbol.symbol) ?? symbol.currentPrice ?? null;
    const returnPct = computeDirectedReturnPct(symbol.direction, symbol.entryPrice, currentPrice);
    return {
      ...symbol,
      currentPrice,
      returnPct,
    };
  });
  const currentReturnPct = computeWeightedIdeaReturn(symbols);
  const updated: TrackedIdeaState = {
    ...existing,
    lastMarkedAt: timestamp,
    symbols,
    staleCycles: existing.staleCycles + 1,
    daysHeld: Number(elapsedDays(existing.openedAt, timestamp).toFixed(2)),
    currentReturnPct,
    bestReturnPct: typeof currentReturnPct === 'number' ? Math.max(existing.bestReturnPct, currentReturnPct) : existing.bestReturnPct,
    worstReturnPct: typeof currentReturnPct === 'number' ? Math.min(existing.worstReturnPct, currentReturnPct) : existing.worstReturnPct,
    convictionFeatures: existing.convictionFeatures,
  };
  return applyTrackedExitRules(updated, timestamp);
}

export function updateTrackedIdeas(ideaCards: InvestmentIdeaCard[], markets: MarketData[], timestamp: string): TrackedIdeaState[] {
  const priceMap = marketPriceMap(markets);
  const nextTracked: TrackedIdeaState[] = [];
  const openExistingByKey = new Map(
    trackedIdeas
      .filter((idea) => idea.status === 'open')
      .map((idea) => [idea.ideaKey, idea] as const),
  );
  const currentKeys = new Set(ideaCards.map((idea) => idea.id));

  for (const idea of ideaCards) {
    const existing = openExistingByKey.get(idea.id) ?? null;
    const refreshed = refreshTrackedIdea(idea, existing, priceMap, timestamp);
    nextTracked.push(refreshed);
  }

  for (const existing of trackedIdeas) {
    if (existing.status === 'closed') {
      nextTracked.push(existing);
      continue;
    }
    if (currentKeys.has(existing.ideaKey)) continue;
    nextTracked.push(decayMissingTrackedIdea(existing, priceMap, timestamp));
  }

  const deduped = new Map<string, TrackedIdeaState>();
  for (const idea of nextTracked) {
    const key = idea.trackingId;
    const prev = deduped.get(key);
    if (!prev || Date.parse(idea.lastMarkedAt) >= Date.parse(prev.lastMarkedAt)) {
      deduped.set(key, idea);
    }
  }
  const result = Array.from(deduped.values())
    .sort((a, b) => Date.parse(b.lastMarkedAt) - Date.parse(a.lastMarkedAt))
    .slice(0, MAX_TRACKED_IDEAS);
  setTrackedIdeas(result);
  return result;
}
