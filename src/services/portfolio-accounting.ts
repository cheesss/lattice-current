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
  executionPenaltyPct?: number | null;
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
  executionPenaltyPct?: number | null;
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
  worstPeriodReturnPct: number;
  sharpeRatio: number;
  volatilityPct: number;
  dailyVar95Pct: number;
  dailyCvar95Pct: number;
  avgCashPct: number;
  minCashPct: number;
  avgGrossExposurePct: number;
  maxGrossExposurePct: number;
  avgNetExposurePct: number;
  maxConcurrentPositions: number;
  tradeCount: number;
  plannedTradeCount: number;
  selectedTradeCount: number;
  sizingAdjustmentCount: number;
  riskGuardTriggerCount: number;
  forcedExitCount: number;
  drawdownGovernorTriggerCount: number;
  periodsPerYear: number;
}

export interface PortfolioAccountingRiskControls {
  grossExposureCapPct: number;
  minCashReservePct: number;
  maxSymbolExposurePct: number;
  maxThemeExposurePct: number;
  maxDailyVar95Pct: number;
  maxDailyCvar95Pct: number;
  drawdownGovernorPct: number;
  drawdownCooldownDays: number;
  targetPositionVolatilityPct: number;
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

function buildTrailingReturns(series: PricePoint[], targetTs: number, lookbackPoints = 20): number[] {
  const trailing = series.filter((point) => point.ts <= targetTs).slice(-Math.max(lookbackPoints + 1, 2));
  const returns: number[] = [];
  for (let index = 1; index < trailing.length; index += 1) {
    const prev = trailing[index - 1]!.price;
    const curr = trailing[index]!.price;
    if (!(prev > 0) || !(curr > 0)) continue;
    returns.push((curr / prev) - 1);
  }
  return returns;
}

function estimateSymbolDailyVolatilityPct(series: PricePoint[], targetTs: number): number {
  const lookbackMs = 90 * 24 * 60 * 60 * 1000;
  const cutoff = targetTs - lookbackMs;
  const trailingReturns = buildTrailingReturns(series.filter((point) => point.ts >= cutoff), targetTs);
  if (trailingReturns.length < 5) return DEFAULT_PORTFOLIO_ACCOUNTING_RISK_CONTROLS.targetPositionVolatilityPct;
  const mean = average(trailingReturns);
  const variance = average(trailingReturns.map((value) => (value - mean) ** 2));
  return Math.max(0.25, Math.sqrt(Math.max(variance, 0)) * 100);
}

function normalQuantile(probability: number): number {
  const p = Math.min(1 - 1e-9, Math.max(1e-9, probability));
  const a = [
    -3.969683028665376e+01,
    2.209460984245205e+02,
    -2.759285104469687e+02,
    1.38357751867269e+02,
    -3.066479806614716e+01,
    2.506628277459239e+00,
  ];
  const b = [
    -5.447609879822406e+01,
    1.615858368580409e+02,
    -1.556989798598866e+02,
    6.680131188771972e+01,
    -1.328068155288572e+01,
  ];
  const c = [
    -7.784894002430293e-03,
    -3.223964580411365e-01,
    -2.400758277161838e+00,
    -2.549732539343734e+00,
    4.374664141464968e+00,
    2.938163982698783e+00,
  ];
  const d = [
    7.784695709041462e-03,
    3.224671290700398e-01,
    2.445134137142996e+00,
    3.754408661907416e+00,
  ];
  const plow = 0.02425;
  const phigh = 1 - plow;
  let q = 0;
  let r = 0;
  if (p < plow) {
    q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0]! * q + c[1]!) * q + c[2]!) * q + c[3]!) * q + c[4]!) * q + c[5]!)
      / ((((d[0]! * q + d[1]!) * q + d[2]!) * q + d[3]!) * q + 1);
  }
  if (p > phigh) {
    q = Math.sqrt(-2 * Math.log(1 - p));
    return -(((((c[0]! * q + c[1]!) * q + c[2]!) * q + c[3]!) * q + c[4]!) * q + c[5]!)
      / ((((d[0]! * q + d[1]!) * q + d[2]!) * q + d[3]!) * q + 1);
  }
  q = p - 0.5;
  r = q * q;
  return (((((a[0]! * r + a[1]!) * r + a[2]!) * r + a[3]!) * r + a[4]!) * r + a[5]!) * q
    / (((((b[0]! * r + b[1]!) * r + b[2]!) * r + b[3]!) * r + b[4]!) * r + 1);
}

function estimatePortfolioRiskMetricsPct(
  positions: Array<{ symbol: string; notional: number }>,
  prices: Map<string, PricePoint[]>,
  targetTs: number,
  equity: number,
): { dailyVar95Pct: number; dailyCvar95Pct: number } {
  if (!(equity > 0) || positions.length === 0) {
    return { dailyVar95Pct: 0, dailyCvar95Pct: 0 };
  }
  const variance = positions.reduce((sum, position) => {
    const series = prices.get(position.symbol) || [];
    const dailyVolPct = estimateSymbolDailyVolatilityPct(series, targetTs);
    const weight = Math.abs(position.notional) / equity;
    return sum + Math.pow(weight * (dailyVolPct / 100), 2);
  }, 0);
  const portfolioVol = Math.sqrt(Math.max(variance, 0));
  const z95 = Math.abs(normalQuantile(0.05));
  const cvar95Multiplier = 2.06;
  return {
    dailyVar95Pct: Number((portfolioVol * z95 * 100).toFixed(4)),
    dailyCvar95Pct: Number((portfolioVol * cvar95Multiplier * 100).toFixed(4)),
  };
}

function calculateTailLossPct(returns: number[], probability: number): { varPct: number; cvarPct: number } {
  const clean = returns.filter((value) => Number.isFinite(value)).sort((left, right) => left - right);
  if (clean.length === 0) {
    return { varPct: 0, cvarPct: 0 };
  }
  const index = Math.min(clean.length - 1, Math.max(0, Math.floor(clean.length * probability)));
  const varValue = clean[index] ?? 0;
  const tail = clean.slice(0, index + 1);
  return {
    varPct: Number((Math.abs(varValue) * 100).toFixed(2)),
    cvarPct: Number((Math.abs(average(tail)) * 100).toFixed(2)),
  };
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
  if (role === 'primary') return 6;
  if (role === 'confirm') return 1;
  return 1;
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

const DEFAULT_PORTFOLIO_ACCOUNTING_RISK_CONTROLS: PortfolioAccountingRiskControls = {
  grossExposureCapPct: 95,
  minCashReservePct: 5,
  maxSymbolExposurePct: 25,
  maxThemeExposurePct: 60,
  maxDailyVar95Pct: 8,
  maxDailyCvar95Pct: 12,
  drawdownGovernorPct: 12,
  drawdownCooldownDays: 3,
  targetPositionVolatilityPct: 5,
};

function normalizePortfolioAccountingRiskControls(
  riskControls: Partial<PortfolioAccountingRiskControls> | null | undefined,
): PortfolioAccountingRiskControls {
  const safe = riskControls || {};
  const clampPct = (value: unknown, fallback: number) =>
    Number.isFinite(Number(value)) ? Math.max(0, Number(value)) : fallback;
  return {
    grossExposureCapPct: clampPct(safe.grossExposureCapPct, DEFAULT_PORTFOLIO_ACCOUNTING_RISK_CONTROLS.grossExposureCapPct),
    minCashReservePct: clampPct(safe.minCashReservePct, DEFAULT_PORTFOLIO_ACCOUNTING_RISK_CONTROLS.minCashReservePct),
    maxSymbolExposurePct: clampPct(safe.maxSymbolExposurePct, DEFAULT_PORTFOLIO_ACCOUNTING_RISK_CONTROLS.maxSymbolExposurePct),
    maxThemeExposurePct: clampPct(safe.maxThemeExposurePct, DEFAULT_PORTFOLIO_ACCOUNTING_RISK_CONTROLS.maxThemeExposurePct),
    maxDailyVar95Pct: clampPct(safe.maxDailyVar95Pct, DEFAULT_PORTFOLIO_ACCOUNTING_RISK_CONTROLS.maxDailyVar95Pct),
    maxDailyCvar95Pct: clampPct(safe.maxDailyCvar95Pct, DEFAULT_PORTFOLIO_ACCOUNTING_RISK_CONTROLS.maxDailyCvar95Pct),
    drawdownGovernorPct: clampPct(safe.drawdownGovernorPct, DEFAULT_PORTFOLIO_ACCOUNTING_RISK_CONTROLS.drawdownGovernorPct),
    drawdownCooldownDays: Math.max(0, Math.round(clampPct(safe.drawdownCooldownDays, DEFAULT_PORTFOLIO_ACCOUNTING_RISK_CONTROLS.drawdownCooldownDays))),
    targetPositionVolatilityPct: clampPct(safe.targetPositionVolatilityPct, DEFAULT_PORTFOLIO_ACCOUNTING_RISK_CONTROLS.targetPositionVolatilityPct),
  };
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
  riskControls?: Partial<PortfolioAccountingRiskControls>;
}): PortfolioAccountingSnapshot {
  const initialCapital = Number(args.initialCapital) > 0 ? Number(args.initialCapital) : 100;
  const riskControls = normalizePortfolioAccountingRiskControls(args.riskControls);
  const prices = buildPriceSeries(args.frames);
  const selectedReturns = selectAdaptiveForwardReturns(args.forwardReturns, args.ideaRuns).filter((row) => typeof row.signedReturnPct === 'number');
  const selectedByKey = new Map(selectedReturns.map((record) => [`${record.ideaRunId}::${record.symbol}`, record] as const));

  const plannedTrades: PortfolioAccountingTrade[] = [];
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
      plannedTrades.push({
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
        executionPenaltyPct: selected.executionPenaltyPct ?? null,
      });
    }
  }

  const entriesByDate = new Map<string, PortfolioAccountingTrade[]>();
  const exitsByDate = new Map<string, PortfolioAccountingTrade[]>();
  for (const trade of plannedTrades) {
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

  // Sort each date bucket by weightPct descending so that the highest-conviction
  // ideas are allocated first. Without this, the gross-exposure cap could starve
  // high-weight trades when lower-weight trades appear earlier in iteration order.
  for (const [key, bucket] of entriesByDate) {
    bucket.sort(
      (a, b) =>
        b.weightPct - a.weightPct
        || (b.signedReturnPct ?? -Infinity) - (a.signedReturnPct ?? -Infinity),
    );
    entriesByDate.set(key, bucket);
  }

  const tradeDates = plannedTrades.flatMap((trade) => [toDateKey(trade.entryTimestamp), trade.exitTimestamp ? toDateKey(trade.exitTimestamp) : null].filter((value): value is string => Boolean(value)));
  // Use trade dates as primary timeline; only fall back to frame dates if no trades exist
  const timelineDates = tradeDates.length > 0
    ? tradeDates
    : args.frames.map((frame) => toDateKey(frame.timestamp || frame.validTimeStart || frame.transactionTime || frame.knowledgeBoundary || nowIso()));
  const allDates = Array.from(new Set(timelineDates)).sort();
  const startTs = allDates.length > 0 ? endOfDayTs(allDates[0]!) : Date.now();
  const endTs = allDates.length > 0 ? endOfDayTs(allDates[allDates.length - 1]!) : startTs;
  const timeline = buildDateRange(startTs, endTs);

  const openPositions = new Map<string, OpenPosition>();
  const executedTrades: PortfolioAccountingTrade[] = [];
  const equityCurve: PortfolioAccountingPoint[] = [];
  let cash = initialCapital;
  let maxConcurrentPositions = 0;
  let sizingAdjustmentCount = 0;
  let riskGuardTriggerCount = 0;
  let forcedExitCount = 0;
  let drawdownGovernorTriggerCount = 0;
  let cooldownActiveUntilIndex = -1;
  let peakNav = initialCapital;

  for (const [dateIndex, dateKey] of timeline.entries()) {
    const dayTs = endOfDayTs(dateKey);
    const startingEquity = cash + Array.from(openPositions.values()).reduce((sum, position) => {
      const series = prices.get(position.symbol) || [];
      const price = findPriceAtOrBefore(series, dayTs)?.price ?? position.entryPrice;
      return sum + position.sign * position.quantity * price;
    }, 0);

    // Track running notional for exposure cap (avoids O(n²) re-scan)
    const grossExposureCap = Math.max(0, startingEquity * (riskControls.grossExposureCapPct / 100));
    const minCashReserve = Math.max(0, startingEquity * (riskControls.minCashReservePct / 100));
    const maxSymbolExposure = Math.max(0, startingEquity * (riskControls.maxSymbolExposurePct / 100));
    const maxThemeExposure = Math.max(0, startingEquity * (riskControls.maxThemeExposurePct / 100));
    const currentExposure = (matcher: (position: OpenPosition) => boolean): number =>
      Array.from(openPositions.values()).reduce((sum, position) => {
        if (!matcher(position)) return sum;
        const series = prices.get(position.symbol) || [];
        const price = findPriceAtOrBefore(series, dayTs)?.price ?? position.entryPrice;
        return sum + Math.abs(position.sign * position.quantity * price);
      }, 0);
    const currentRiskPositions = (): Array<{ symbol: string; notional: number }> =>
      Array.from(openPositions.values()).map((position) => {
        const series = prices.get(position.symbol) || [];
        const price = findPriceAtOrBefore(series, dayTs)?.price ?? position.entryPrice;
        return {
          symbol: position.symbol,
          notional: Math.abs(position.sign * position.quantity * price),
        };
      });
    let runningEntryNotional = currentExposure(() => true);

    for (const trade of entriesByDate.get(dateKey) || []) {
      if (openPositions.has(trade.id)) continue;
      if (dateIndex <= cooldownActiveUntilIndex) {
        riskGuardTriggerCount += 1;
        continue;
      }
      const sign = directionMultiplier(trade.direction);
      if (sign === 0) continue;
      const tradeEntryPrice = trade.entryPrice ?? findPriceAtOrBefore(prices.get(trade.symbol) || [], dayTs)?.price ?? null;
      if (!tradeEntryPrice || !Number.isFinite(tradeEntryPrice) || tradeEntryPrice <= 0) continue;
      const symbolSeries = prices.get(trade.symbol) || [];
      const symbolDailyVolatilityPct = estimateSymbolDailyVolatilityPct(symbolSeries, dayTs);
      const volatilityScaler = Math.max(
        0.35,
        Math.min(1.15, riskControls.targetPositionVolatilityPct / Math.max(symbolDailyVolatilityPct, 0.25)),
      );
      const impliedExecutionPenaltyPct = Math.max(0, Number(trade.executionPenaltyPct ?? 0));
      const executionScaler = Math.max(0.45, Math.min(1, 1 - (impliedExecutionPenaltyPct / 2.5)));
      const requestedNotional = Math.max(0, startingEquity * (trade.weightPct / 100) * volatilityScaler * executionScaler);
      if (requestedNotional + 1e-9 < Math.max(0, startingEquity * (trade.weightPct / 100))) {
        sizingAdjustmentCount += 1;
      }
      const remainingGrossBudget = Math.max(0, grossExposureCap - runningEntryNotional);
      const remainingSymbolBudget = Math.max(0, maxSymbolExposure - currentExposure((position) => position.symbol === trade.symbol));
      const remainingThemeBudget = Math.max(0, maxThemeExposure - currentExposure((position) => position.themeId === trade.themeId));
      const remainingCashBudget = sign > 0 ? Math.max(0, cash - minCashReserve) : Number.POSITIVE_INFINITY;
      const projectedRiskFor = (candidateNotional: number) =>
        estimatePortfolioRiskMetricsPct(
          [...currentRiskPositions(), { symbol: trade.symbol, notional: candidateNotional }],
          prices,
          dayTs,
          startingEquity,
        );
      const riskLimitedNotional = (() => {
        if (!(requestedNotional > 0)) return 0;
        const fullRisk = projectedRiskFor(requestedNotional);
        if (
          fullRisk.dailyVar95Pct <= riskControls.maxDailyVar95Pct + 1e-9
          && fullRisk.dailyCvar95Pct <= riskControls.maxDailyCvar95Pct + 1e-9
        ) {
          return requestedNotional;
        }
        const varScale = fullRisk.dailyVar95Pct > 0 ? riskControls.maxDailyVar95Pct / fullRisk.dailyVar95Pct : 1;
        const cvarScale = fullRisk.dailyCvar95Pct > 0 ? riskControls.maxDailyCvar95Pct / fullRisk.dailyCvar95Pct : 1;
        return Math.max(0, requestedNotional * Math.min(varScale, cvarScale));
      })();
      const notional = Math.max(
        0,
        Math.min(
          riskLimitedNotional,
          remainingGrossBudget,
          remainingSymbolBudget,
          remainingThemeBudget,
          remainingCashBudget,
        ),
      );
      if (notional + 1e-9 < requestedNotional) riskGuardTriggerCount += 1;
      if (notional <= 0) continue;
      const executedWeightPct = startingEquity > 0
        ? Number(((notional / startingEquity) * 100).toFixed(4))
        : 0;
      const quantity = notional / tradeEntryPrice;
      openPositions.set(trade.id, {
        id: trade.id,
        ideaRunId: trade.ideaRunId,
        themeId: trade.themeId,
        symbol: trade.symbol,
        direction: trade.direction,
        sign,
        role: trade.role,
        allocatedWeightPct: executedWeightPct,
        entryTimestamp: trade.entryTimestamp,
        exitTimestamp: trade.exitTimestamp,
        entryPrice: tradeEntryPrice,
        exitPrice: trade.exitPrice,
        quantity,
        entryNotional: notional,
        tradableNow: trade.tradableNow,
      });
      executedTrades.push({
        ...trade,
        entryPrice: tradeEntryPrice,
        weightPct: executedWeightPct,
      });
      runningEntryNotional += Math.abs(notional);
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
      const seriesPrice = findPriceAtOrBefore(series, dayTs)?.price ?? null;
      const tradeExitPrice = trade.exitPrice ?? seriesPrice ?? position.entryPrice;
      if (!tradeExitPrice || !Number.isFinite(tradeExitPrice)) continue;
      if (trade.exitPrice == null && seriesPrice == null) {
        console.warn(`[portfolio] price gap: using entryPrice fallback for ${position.symbol} at exit (trade=${trade.id})`);
      }
      cash += position.sign * position.quantity * tradeExitPrice;
      openPositions.delete(trade.id);
    }

    const markEquity = Array.from(openPositions.values()).reduce((sum, position) => {
      const series = prices.get(position.symbol) || [];
      const price = findPriceAtOrBefore(series, dayTs)?.price ?? position.entryPrice;
      return sum + position.sign * position.quantity * price;
    }, 0);
    let nav = cash + markEquity;
    peakNav = Math.max(peakNav, nav);
    const currentDrawdownPct = peakNav > 0 ? ((nav / peakNav) - 1) * 100 : 0;
    if (
      openPositions.size > 0
      && riskControls.drawdownGovernorPct > 0
      && currentDrawdownPct <= -Math.abs(riskControls.drawdownGovernorPct)
    ) {
      const forcedMarkEquity = Array.from(openPositions.values()).reduce((sum, position) => {
        const series = prices.get(position.symbol) || [];
        const price = findPriceAtOrBefore(series, dayTs)?.price ?? position.entryPrice;
        return sum + position.sign * position.quantity * price;
      }, 0);
      forcedExitCount += openPositions.size;
      drawdownGovernorTriggerCount += 1;
      cooldownActiveUntilIndex = Math.max(cooldownActiveUntilIndex, dateIndex + riskControls.drawdownCooldownDays);
      cash += forcedMarkEquity;
      openPositions.clear();
      nav = cash;
    }
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

  const weightedBase = executedTrades.reduce((sum, trade) => sum + Math.max(0, trade.weightPct || 0), 0);
  const weightedReturnPct = weightedBase > 0
    ? executedTrades.reduce((sum, trade) => sum + (trade.weightPct * (trade.signedReturnPct || 0)), 0) / weightedBase
    : 0;
  const weightedCostAdjustedReturnPct = weightedBase > 0
    ? executedTrades.reduce((sum, trade) => sum + (trade.weightPct * (trade.costAdjustedSignedReturnPct || 0)), 0) / weightedBase
    : 0;
  const weightedHitRate = weightedBase > 0
    ? (executedTrades.reduce((sum, trade) => sum + ((trade.costAdjustedSignedReturnPct ?? trade.signedReturnPct ?? 0) > 0 ? trade.weightPct : 0), 0) / weightedBase) * 100
    : 0;

  const navValues = equityCurve.map((point) => point.nav);
  const totalReturnPct = navValues.length > 0
    ? ((navValues[navValues.length - 1]! / initialCapital) - 1) * 100
    : 0;
  const startTsFinal = asTs(equityCurve[0]?.timestamp);
  const endTsFinal = asTs(equityCurve[equityCurve.length - 1]?.timestamp);
  const years = Math.max((endTsFinal - startTsFinal) / (365.25 * 24 * 60 * 60 * 1000), 1 / 365.25);
  // Guard against extreme annualization for very short periods (< 30 days)
  const cagrPct = navValues.length > 0 && years >= 30 / 365.25
    ? (Math.pow(navValues[navValues.length - 1]! / initialCapital, 1 / years) - 1) * 100
    : totalReturnPct;
  let peak = navValues[0] || initialCapital;
  let maxDrawdown = 0;
  for (const nav of navValues) {
    peak = Math.max(peak, nav);
    const drawdown = peak > 0 ? (nav / peak) - 1 : 0;
    maxDrawdown = Math.min(maxDrawdown, drawdown);
  }
  // Compute actual average period between equity curve points to correctly
  // annualize Sharpe. Using a hardcoded sqrt(252) assumes daily data; weekly or
  // intraday series would produce nonsensical values.
  const curveTimestamps = equityCurve.map((point) => asTs(point.timestamp));
  let avgPeriodDays = 1; // default: treat as daily
  if (curveTimestamps.length >= 2) {
    const totalSpanMs = curveTimestamps[curveTimestamps.length - 1]! - curveTimestamps[0]!;
    avgPeriodDays = Math.max(
      1 / 24, // floor at 1 hour to prevent sqrt explosion for intraday curves
      totalSpanMs / (curveTimestamps.length - 1) / (24 * 60 * 60 * 1000),
    );
  }
  const annualizationFactor = Math.sqrt(365 / avgPeriodDays);
  // Risk-free rate: 4.5% annual, prorated to the actual equity curve period
  const periodRiskFreeRate = 0.045 * (avgPeriodDays / 365);

  const dailyReturns: number[] = [];
  for (let index = 1; index < navValues.length; index += 1) {
    const prev = navValues[index - 1]!;
    const curr = navValues[index]!;
    if (prev <= 0 || curr <= 0) continue;
    dailyReturns.push((curr / prev) - 1);
  }
  const meanPeriod = average(dailyReturns);
  const stdPeriod = dailyReturns.length > 1
    ? Math.sqrt(average(dailyReturns.map((value) => (value - meanPeriod) ** 2)))
    : 0;
  const sharpeRatio = stdPeriod > 0 ? ((meanPeriod - periodRiskFreeRate) / stdPeriod) * annualizationFactor : 0;
  const volatilityPct = stdPeriod > 0 ? stdPeriod * annualizationFactor * 100 : 0;
  const tailLoss = calculateTailLossPct(dailyReturns, 0.05);
  const worstPeriodReturnPct = dailyReturns.length > 0
    ? Number((Math.min(...dailyReturns) * 100).toFixed(2))
    : 0;
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
      worstPeriodReturnPct,
      sharpeRatio: Number(sharpeRatio.toFixed(2)),
      volatilityPct: Number(volatilityPct.toFixed(2)),
      dailyVar95Pct: tailLoss.varPct,
      dailyCvar95Pct: tailLoss.cvarPct,
      avgCashPct: Number(avgCashPct.toFixed(2)),
      minCashPct: Number(minCashPct.toFixed(2)),
      avgGrossExposurePct: Number(avgGrossExposurePct.toFixed(2)),
      maxGrossExposurePct: Number(maxGrossExposurePct.toFixed(2)),
      avgNetExposurePct: Number(avgNetExposurePct.toFixed(2)),
      maxConcurrentPositions,
      tradeCount: executedTrades.length,
      plannedTradeCount: plannedTrades.length,
      selectedTradeCount: selectedReturns.length,
      sizingAdjustmentCount,
      riskGuardTriggerCount,
      forcedExitCount,
      drawdownGovernorTriggerCount,
      periodsPerYear: 252,
    },
    equityCurve,
    trades: executedTrades,
  };
}
