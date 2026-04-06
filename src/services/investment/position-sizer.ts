import { InvestmentIdeaSymbol, PositionSizingRule, InvestmentDirection } from './types';
import { estimateAtrLikePct } from './idea-tracker';
import { getAdaptiveParamStore } from './adaptive-params';
export { chooseSizingRule } from './sizing-rule';

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

export function applyAtrAdjustedRule(
  rule: PositionSizingRule,
  symbols: InvestmentIdeaSymbol[],
  themeId?: string,
  direction?: InvestmentDirection,
): PositionSizingRule {
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
