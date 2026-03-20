import type { InvestmentDirection } from './investment-intelligence';

interface PortfolioAccountingFrameLike {
  timestamp: string;
  validTimeStart?: string;
  transactionTime?: string;
  knowledgeBoundary?: string;
  metadata?: Record<string, string | number | boolean | null>;
  markets: Array<{
    symbol: string;
    price: number | null;
  }>;
}

interface PortfolioAccountingSymbolLike {
  symbol: string;
  role: 'primary' | 'confirm' | 'hedge';
  direction: InvestmentDirection;
}

interface PortfolioAccountingIdeaRunLike {
  id: string;
  themeId: string;
  generatedAt: string;
  sizePct: number;
  preferredHorizonHours?: number | null;
  horizonCandidatesHours?: number[];
  symbols: PortfolioAccountingSymbolLike[];
}

interface PortfolioAccountingForwardReturnLike {
  ideaRunId: string;
  symbol: string;
  horizonHours: number;
  entryTimestamp: string;
  exitTimestamp: string | null;
  entryPrice: number | null;
  exitPrice: number | null;
  signedReturnPct: number | null;
  costAdjustedSignedReturnPct: number | null;
  direction: InvestmentDirection;
  tradableNow: boolean;
}

export interface PortfolioAccountingTrade {
  id: string;
  ideaRunId: string;
  themeId: string;
  symbol: string;
  direction: InvestmentDirection;
  role: 'primary' | 'confirm' | 'hedge';
  entryTimestamp: string;
  exitTimestamp: string | null;
  entryPrice: number | null;
  exitPrice: number | null;
  weightPct: number;
  rawReturnPct: number | null;
  signedReturnPct: number | null;
  costAdjustedSignedReturnPct: number | null;
  tradableNow: boolean;
}

export interface PortfolioAccountingPoint {
  timestamp: string;
  nav: number;
  cash: number;
  cashPct: number;
  grossExposurePct: number;
  netExposurePct: number;
  openPositionCount: number;
  activeIdeaCount: number;
  realizedReturnPct: number;
  unrealizedReturnPct: number;
}

export interface PortfolioAccountingSummary {
  initialCapital: number;
  finalCapital: number;
  totalReturnPct: number;
  weightedReturnPct: number;
  weightedCostAdjustedReturnPct: number;
  weightedHitRate: number;
  cagrPct: number;
  maxDrawdownPct: number;
  sharpeRatio: number;
  volatilityPct: number;
  avgCashPct: number;
  minCashPct: number;
  avgGrossExposurePct: number;
  maxGrossExposurePct: number;
  avgNetExposurePct: number;
  maxConcurrentPositions: number;
  tradeCount: number;
  selectedTradeCount: number;
  periodsPerYear: number;
}

export interface PortfolioAccountingSnapshot {
  updatedAt: string;
  summary: PortfolioAccountingSummary;
  equityCurve: PortfolioAccountingPoint[];
  trades: PortfolioAccountingTrade[];
}

interface PricePoint {
  ts: number;
  timestamp: string;
  price: number;
}

function nowIso(): string {
  return new Date().toISOString();
}

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function asTs(value: string | null | undefined): number {
  const ts = Date.parse(String(value || ''));
  return Number.isFinite(ts) ? ts : 0;
}

function toDateKey(timestamp: string): string {
  const ts = asTs(timestamp);
  if (!ts) return '1970-01-01';
  return new Date(ts).toISOString().slice(0, 10);
}

function endOfDayTs(dateKey: string): number {
  const ts = Date.parse(`${dateKey}T23:59:59.999Z`);
  return Number.isFinite(ts) ? ts : 0;
}

function effectiveFrameTimestamp(frame: PortfolioAccountingFrameLike): string {
  return frame.transactionTime || frame.knowledgeBoundary || frame.validTimeStart || frame.timestamp;
}

function parseMarketTimeMap(
  frame: PortfolioAccountingFrameLike,
  key: 'marketTimestampJson' | 'marketKnowledgeBoundaryJson',
): Record<string, string> {
  const raw = frame.metadata?.[key];
  if (typeof raw !== 'string' || !raw.trim()) return {};
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return Object.fromEntries(
      Object.entries(parsed).flatMap(([symbol, value]) =>
        typeof value === 'string' && value.trim() ? [[symbol, value]] : []),
    );
  } catch {
    return {};
  }
}

function buildPriceSeries(frames: PortfolioAccountingFrameLike[]): Map<string, PricePoint[]> {
  const bySymbol = new Map<string, PricePoint[]>();
  for (const frame of frames) {
    const timestampBySymbol = parseMarketTimeMap(frame, 'marketTimestampJson');
    for (const market of frame.markets) {
      if (!market?.symbol || typeof market.price !== 'number' || !Number.isFinite(market.price)) continue;
      const pointTimestamp = timestampBySymbol[market.symbol] || effectiveFrameTimestamp(frame);
      const ts = asTs(pointTimestamp);
      const bucket = bySymbol.get(market.symbol) || [];
      bucket.push({
        ts,
        timestamp: pointTimestamp,
        price: market.price,
      });
      bySymbol.set(market.symbol, bucket);
    }
  }

  for (const [symbol, series] of bySymbol.entries()) {
    const unique = new Map<number, PricePoint>();
    for (const point of series) unique.set(point.ts, point);
    bySymbol.set(symbol, Array.from(unique.values()).sort((a, b) => a.ts - b.ts));
  }
  return bySymbol;
}

function findPriceAtOrBefore(series: PricePoint[], targetTs: number): PricePoint | null {
  if (!series.length) return null;
  let left = 0;
  let right = series.length - 1;
  let best: PricePoint | null = null;
  while (left <= right) {
    const mid = Math.floor((left + right) / 2);
    const point = series[mid]!;
    if (point.ts <= targetTs) {
      best = point;
      left = mid + 1;
    } else {
      right = mid - 1;
    }
  }
  return best;
}

function selectAdaptiveForwardReturns(
  forwardReturns: PortfolioAccountingForwardReturnLike[],
  ideaRuns: PortfolioAccountingIdeaRunLike[],
): PortfolioAccountingForwardReturnLike[] {
  if (!forwardReturns.length) return [];
  const preferredByIdeaRun = new Map<string, number>();
  for (const run of ideaRuns) {
    if (typeof run.preferredHorizonHours === 'number' && Number.isFinite(run.preferredHorizonHours)) {
      preferredByIdeaRun.set(run.id, Math.max(1, Math.round(run.preferredHorizonHours)));
    }
  }
  const grouped = new Map<string, PortfolioAccountingForwardReturnLike[]>();
  for (const record of forwardReturns) {
    const key = `${record.ideaRunId}::${record.symbol}`;
    const bucket = grouped.get(key) || [];
    bucket.push(record);
    grouped.set(key, bucket);
  }
  const selected: PortfolioAccountingForwardReturnLike[] = [];
  for (const [key, bucket] of grouped.entries()) {
    const [ideaRunId = ''] = key.split('::');
    const preferred = preferredByIdeaRun.get(ideaRunId) ?? null;
    const sorted = bucket
      .slice()
      .sort((a, b) => a.horizonHours - b.horizonHours || asTs(a.exitTimestamp) - asTs(b.exitTimestamp));
    if (preferred == null) {
      selected.push(sorted[Math.floor(sorted.length / 2)] || sorted[0]!);
      continue;
    }
    const nearest = sorted.reduce<PortfolioAccountingForwardReturnLike | null>((best, record) => {
      if (!best) return record;
      const recordDistance = Math.abs(record.horizonHours - preferred);
      const bestDistance = Math.abs(best.horizonHours - preferred);
      if (recordDistance !== bestDistance) return recordDistance < bestDistance ? record : best;
      return record.horizonHours < best.horizonHours ? record : best;
    }, null);
    if (nearest) selected.push(nearest);
  }
  return selected;
}

function roleWeight(role: 'primary' | 'confirm' | 'hedge'): number {
  if (role === 'primary') return 1;
  if (role === 'confirm') return 0.72;
  return 0.48;
}

function directionMultiplier(direction: InvestmentDirection): number {
  if (direction === 'short') return -1;
  if (direction === 'watch') return 0;
  return 1;
}

interface OpenPosition {
  id: string;
  ideaRunId: string;
  themeId: string;
  symbol: string;
  direction: InvestmentDirection;
  sign: number;
  role: 'primary' | 'confirm' | 'hedge';
  allocatedWeightPct: number;
  entryTimestamp: string;
  exitTimestamp: string | null;
  entryPrice: number;
  exitPrice: number | null;
  quantity: number;
  entryNotional: number;
  tradableNow: boolean;
}

function buildDateRange(startTs: number, endTs: number): string[] {
  const dates: string[] = [];
  if (!Number.isFinite(startTs) || !Number.isFinite(endTs) || endTs < startTs) return dates;
  let cursor = new Date(startTs);
  cursor.setUTCHours(0, 0, 0, 0);
  const final = new Date(endTs);
  final.setUTCHours(0, 0, 0, 0);
  while (cursor.getTime() <= final.getTime()) {
    dates.push(cursor.toISOString().slice(0, 10));
    cursor = new Date(cursor.getTime() + 24 * 60 * 60 * 1000);
  }
  return dates;
}

export function clonePortfolioAccountingSnapshot(
  snapshot: PortfolioAccountingSnapshot | null | undefined,
): PortfolioAccountingSnapshot | null {
  if (!snapshot) return null;
  return {
    updatedAt: snapshot.updatedAt,
    summary: { ...snapshot.summary },
    equityCurve: Array.isArray(snapshot.equityCurve)
      ? snapshot.equityCurve.map((point) => ({ ...point }))
      : [],
    trades: Array.isArray(snapshot.trades)
      ? snapshot.trades.map((trade) => ({ ...trade }))
      : [],
  };
}

export function computePortfolioAccountingSnapshot(args: {
  frames: PortfolioAccountingFrameLike[];
  ideaRuns: PortfolioAccountingIdeaRunLike[];
  forwardReturns: PortfolioAccountingForwardReturnLike[];
  initialCapital?: number;
}): PortfolioAccountingSnapshot {
  const initialCapital = Number(args.initialCapital) > 0 ? Number(args.initialCapital) : 100;
  const prices = buildPriceSeries(args.frames);
  const selectedReturns = selectAdaptiveForwardReturns(args.forwardReturns, args.ideaRuns).filter((row) => typeof row.signedReturnPct === 'number');
  const selectedByKey = new Map(selectedReturns.map((record) => [`${record.ideaRunId}::${record.symbol}`, record] as const));

  const trades: PortfolioAccountingTrade[] = [];
  for (const ideaRun of args.ideaRuns) {
    const activeSymbols = ideaRun.symbols.filter((symbol) => directionMultiplier(symbol.direction) !== 0);
    if (!activeSymbols.length) continue;
    const totalRoleWeight = activeSymbols.reduce((sum, symbol) => sum + roleWeight(symbol.role), 0) || 1;
    for (const symbol of activeSymbols) {
      const selected = selectedByKey.get(`${ideaRun.id}::${symbol.symbol}`);
      if (!selected) continue;
      const entryTimestamp = selected.entryTimestamp || ideaRun.generatedAt;
      const exitTimestamp = selected.exitTimestamp || null;
      const entryPrice = selected.entryPrice ?? findPriceAtOrBefore(prices.get(symbol.symbol) || [], asTs(entryTimestamp))?.price ?? null;
      const exitPrice = selected.exitPrice ?? (exitTimestamp ? findPriceAtOrBefore(prices.get(symbol.symbol) || [], asTs(exitTimestamp))?.price ?? null : null);
      if (!entryPrice || !Number.isFinite(entryPrice) || entryPrice <= 0) continue;
      const allocatedWeightPct = Number(((ideaRun.sizePct * roleWeight(symbol.role)) / totalRoleWeight).toFixed(4));
      trades.push({
        id: `${ideaRun.id}:${symbol.symbol}:${selected.horizonHours}h`,
        ideaRunId: ideaRun.id,
        themeId: ideaRun.themeId,
        symbol: symbol.symbol,
        direction: selected.direction,
        role: symbol.role,
        entryTimestamp,
        exitTimestamp,
        entryPrice,
        exitPrice,
        weightPct: allocatedWeightPct,
        rawReturnPct: selected.signedReturnPct,
        signedReturnPct: selected.signedReturnPct,
        costAdjustedSignedReturnPct: selected.costAdjustedSignedReturnPct,
        tradableNow: selected.tradableNow,
      });
    }
  }

  const entriesByDate = new Map<string, PortfolioAccountingTrade[]>();
  const exitsByDate = new Map<string, PortfolioAccountingTrade[]>();
  for (const trade of trades) {
    const entryDate = toDateKey(trade.entryTimestamp);
    const exitDate = trade.exitTimestamp ? toDateKey(trade.exitTimestamp) : null;
    const entryBucket = entriesByDate.get(entryDate) || [];
    entryBucket.push(trade);
    entriesByDate.set(entryDate, entryBucket);
    if (exitDate) {
      const exitBucket = exitsByDate.get(exitDate) || [];
      exitBucket.push(trade);
      exitsByDate.set(exitDate, exitBucket);
    }
  }

  const frameDates = args.frames.map((frame) => toDateKey(frame.timestamp || frame.validTimeStart || frame.transactionTime || frame.knowledgeBoundary || nowIso()));
  const tradeDates = trades.flatMap((trade) => [toDateKey(trade.entryTimestamp), trade.exitTimestamp ? toDateKey(trade.exitTimestamp) : null].filter((value): value is string => Boolean(value)));
  const allDates = Array.from(new Set([...frameDates, ...tradeDates])).sort();
  const startTs = allDates.length > 0 ? endOfDayTs(allDates[0]!) : Date.now();
  const endTs = allDates.length > 0 ? endOfDayTs(allDates[allDates.length - 1]!) : startTs;
  const timeline = buildDateRange(startTs, endTs);

  const openPositions = new Map<string, OpenPosition>();
  const equityCurve: PortfolioAccountingPoint[] = [];
  let cash = initialCapital;
  let maxConcurrentPositions = 0;

  for (const dateKey of timeline) {
    const dayTs = endOfDayTs(dateKey);
    const startingEquity = cash + Array.from(openPositions.values()).reduce((sum, position) => {
      const series = prices.get(position.symbol) || [];
      const price = findPriceAtOrBefore(series, dayTs)?.price ?? position.entryPrice;
      return sum + position.sign * position.quantity * price;
    }, 0);

    for (const trade of entriesByDate.get(dateKey) || []) {
      if (openPositions.has(trade.id)) continue;
      const sign = directionMultiplier(trade.direction);
      if (sign === 0) continue;
      const tradeEntryPrice = trade.entryPrice ?? findPriceAtOrBefore(prices.get(trade.symbol) || [], dayTs)?.price ?? null;
      if (!tradeEntryPrice || !Number.isFinite(tradeEntryPrice) || tradeEntryPrice <= 0) continue;
      const notional = startingEquity * (trade.weightPct / 100);
      const quantity = notional / tradeEntryPrice;
      openPositions.set(trade.id, {
        id: trade.id,
        ideaRunId: trade.ideaRunId,
        themeId: trade.themeId,
        symbol: trade.symbol,
        direction: trade.direction,
        sign,
        role: trade.role,
        allocatedWeightPct: trade.weightPct,
        entryTimestamp: trade.entryTimestamp,
        exitTimestamp: trade.exitTimestamp,
        entryPrice: tradeEntryPrice,
        exitPrice: trade.exitPrice,
        quantity,
        entryNotional: notional,
        tradableNow: trade.tradableNow,
      });
      cash -= sign * notional;
    }

    const openEquity = Array.from(openPositions.values()).reduce((sum, position) => {
      const series = prices.get(position.symbol) || [];
      const price = findPriceAtOrBefore(series, dayTs)?.price ?? position.entryPrice;
      return sum + position.sign * position.quantity * price;
    }, 0);
    const navBeforeExit = cash + openEquity;

    for (const trade of exitsByDate.get(dateKey) || []) {
      const position = openPositions.get(trade.id);
      if (!position) continue;
      const series = prices.get(position.symbol) || [];
      const tradeExitPrice = trade.exitPrice ?? findPriceAtOrBefore(series, dayTs)?.price ?? position.entryPrice;
      if (!tradeExitPrice || !Number.isFinite(tradeExitPrice)) continue;
      cash += position.sign * position.quantity * tradeExitPrice;
      openPositions.delete(trade.id);
    }

    const markEquity = Array.from(openPositions.values()).reduce((sum, position) => {
      const series = prices.get(position.symbol) || [];
      const price = findPriceAtOrBefore(series, dayTs)?.price ?? position.entryPrice;
      return sum + position.sign * position.quantity * price;
    }, 0);
    const nav = cash + markEquity;
    const grossExposure = Array.from(openPositions.values()).reduce((sum, position) => {
      const series = prices.get(position.symbol) || [];
      const price = findPriceAtOrBefore(series, dayTs)?.price ?? position.entryPrice;
      return sum + Math.abs(position.sign * position.quantity * price);
    }, 0);
    const netExposure = Array.from(openPositions.values()).reduce((sum, position) => {
      const series = prices.get(position.symbol) || [];
      const price = findPriceAtOrBefore(series, dayTs)?.price ?? position.entryPrice;
      return sum + position.sign * position.quantity * price;
    }, 0);
    maxConcurrentPositions = Math.max(maxConcurrentPositions, openPositions.size);

    const realizedReturnPct = navBeforeExit === 0 ? 0 : ((nav - navBeforeExit) / navBeforeExit) * 100;
    const unrealizedReturnPct = initialCapital === 0 ? 0 : ((markEquity - openEquity) / initialCapital) * 100;

    equityCurve.push({
      timestamp: `${dateKey}T23:59:59.999Z`,
      nav: Number(nav.toFixed(2)),
      cash: Number(cash.toFixed(2)),
      cashPct: Number(((cash / initialCapital) * 100).toFixed(2)),
      grossExposurePct: Number(((grossExposure / initialCapital) * 100).toFixed(2)),
      netExposurePct: Number(((netExposure / initialCapital) * 100).toFixed(2)),
      openPositionCount: openPositions.size,
      activeIdeaCount: new Set(Array.from(openPositions.values()).map((position) => position.ideaRunId)).size,
      realizedReturnPct: Number(realizedReturnPct.toFixed(2)),
      unrealizedReturnPct: Number(unrealizedReturnPct.toFixed(2)),
    });
  }

  if (!equityCurve.length) {
    equityCurve.push({
      timestamp: nowIso(),
      nav: initialCapital,
      cash: initialCapital,
      cashPct: 100,
      grossExposurePct: 0,
      netExposurePct: 0,
      openPositionCount: 0,
      activeIdeaCount: 0,
      realizedReturnPct: 0,
      unrealizedReturnPct: 0,
    });
  }

  const weightedBase = trades.reduce((sum, trade) => sum + Math.max(0, trade.weightPct || 0), 0);
  const weightedReturnPct = weightedBase > 0
    ? trades.reduce((sum, trade) => sum + (trade.weightPct * (trade.signedReturnPct || 0)), 0) / weightedBase
    : 0;
  const weightedCostAdjustedReturnPct = weightedBase > 0
    ? trades.reduce((sum, trade) => sum + (trade.weightPct * (trade.costAdjustedSignedReturnPct || 0)), 0) / weightedBase
    : 0;
  const weightedHitRate = weightedBase > 0
    ? (trades.reduce((sum, trade) => sum + ((trade.costAdjustedSignedReturnPct ?? trade.signedReturnPct ?? 0) > 0 ? trade.weightPct : 0), 0) / weightedBase) * 100
    : 0;

  const navValues = equityCurve.map((point) => point.nav);
  const totalReturnPct = navValues.length > 0
    ? ((navValues[navValues.length - 1]! / initialCapital) - 1) * 100
    : 0;
  const startTsFinal = asTs(equityCurve[0]?.timestamp);
  const endTsFinal = asTs(equityCurve[equityCurve.length - 1]?.timestamp);
  const years = Math.max((endTsFinal - startTsFinal) / (365.25 * 24 * 60 * 60 * 1000), 1 / 365.25);
  const cagrPct = navValues.length > 0
    ? (Math.pow(navValues[navValues.length - 1]! / initialCapital, 1 / years) - 1) * 100
    : 0;
  let peak = navValues[0] || initialCapital;
  let maxDrawdown = 0;
  for (const nav of navValues) {
    peak = Math.max(peak, nav);
    const drawdown = peak > 0 ? (nav / peak) - 1 : 0;
    maxDrawdown = Math.min(maxDrawdown, drawdown);
  }
  const dailyReturns: number[] = [];
  for (let index = 1; index < navValues.length; index += 1) {
    const prev = navValues[index - 1]!;
    const curr = navValues[index]!;
    if (prev <= 0 || curr <= 0) continue;
    dailyReturns.push((curr / prev) - 1);
  }
  const meanDaily = average(dailyReturns);
  const stdDaily = dailyReturns.length > 1
    ? Math.sqrt(average(dailyReturns.map((value) => (value - meanDaily) ** 2)))
    : 0;
  const sharpeRatio = stdDaily > 0 ? (meanDaily / stdDaily) * Math.sqrt(252) : 0;
  const volatilityPct = stdDaily > 0 ? stdDaily * Math.sqrt(252) * 100 : 0;
  const avgCashPct = average(equityCurve.map((point) => point.cashPct));
  const minCashPct = equityCurve.length > 0 ? Math.min(...equityCurve.map((point) => point.cashPct)) : 0;
  const avgGrossExposurePct = average(equityCurve.map((point) => point.grossExposurePct));
  const maxGrossExposurePct = equityCurve.length > 0 ? Math.max(...equityCurve.map((point) => point.grossExposurePct)) : 0;
  const avgNetExposurePct = average(equityCurve.map((point) => point.netExposurePct));

  return {
    updatedAt: nowIso(),
    summary: {
      initialCapital,
      finalCapital: navValues[navValues.length - 1] || initialCapital,
      totalReturnPct: Number(totalReturnPct.toFixed(2)),
      weightedReturnPct: Number(weightedReturnPct.toFixed(2)),
      weightedCostAdjustedReturnPct: Number(weightedCostAdjustedReturnPct.toFixed(2)),
      weightedHitRate: Number(weightedHitRate.toFixed(2)),
      cagrPct: Number(cagrPct.toFixed(2)),
      maxDrawdownPct: Number((maxDrawdown * 100).toFixed(2)),
      sharpeRatio: Number(sharpeRatio.toFixed(2)),
      volatilityPct: Number(volatilityPct.toFixed(2)),
      avgCashPct: Number(avgCashPct.toFixed(2)),
      minCashPct: Number(minCashPct.toFixed(2)),
      avgGrossExposurePct: Number(avgGrossExposurePct.toFixed(2)),
      maxGrossExposurePct: Number(maxGrossExposurePct.toFixed(2)),
      avgNetExposurePct: Number(avgNetExposurePct.toFixed(2)),
      maxConcurrentPositions,
      tradeCount: trades.length,
      selectedTradeCount: selectedReturns.length,
      periodsPerYear: 252,
    },
    equityCurve,
    trades,
  };
}
