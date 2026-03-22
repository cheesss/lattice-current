import type {
  AnalyzeStockResponse,
  BacktestStockResponse,
  BacktestStockEvaluation,
  MarketServiceHandler,
} from '../../../../src/generated/server/worldmonitor/market/v1/service_server';
import { cachedFetchJson } from '../../../_shared/redis';
import {
  buildAnalysisResponse,
  buildTechnicalSnapshot,
  fetchYahooHistory,
  getFallbackOverlay,
  signalDirection,
  type Candle,
  STOCK_ANALYSIS_ENGINE_VERSION,
} from './analyze-stock';
import {
  getStoredHistoricalBacktestAnalyses,
  storeHistoricalBacktestAnalysisRecords,
  storeStockBacktestSnapshot,
} from './premium-stock-store';
import { sanitizeSymbol } from './_shared';

const CACHE_TTL_SECONDS = 900;
const DEFAULT_WINDOW_DAYS = 10;
const MIN_REQUIRED_BARS = 80;
const MAX_EVALUATIONS = 8;
const MIN_ANALYSIS_BARS = 60;

function round(value: number, digits = 2): number {
  return Number.isFinite(value) ? Number(value.toFixed(digits)) : 0;
}

function compareByAnalysisAtDesc<T extends { analysisAt: number }>(a: T, b: T): number {
  return (b.analysisAt || 0) - (a.analysisAt || 0);
}

function simulateEvaluation(
  analysis: AnalyzeStockResponse,
  forwardBars: Candle[],
): BacktestStockEvaluation | null {
  const direction = signalDirection(analysis.signal);
  if (!direction || forwardBars.length === 0) return null;

  // Real-world execution: enter at the open of the first forward bar (the day after signal generation)
  const firstBar = forwardBars[0];
  if (!firstBar) return null;
  
  // Apply 0.15% (15 bps) slippage penalty to simulate real-world execution friction
  const SLIPPAGE_RATE = 0.0015;
  const entryPrice = direction === 'long' 
    ? firstBar.open * (1 + SLIPPAGE_RATE) 
    : firstBar.open * (1 - SLIPPAGE_RATE);

  const initialStopLoss = analysis.stopLoss;
  const takeProfit = analysis.takeProfit;
  if (!entryPrice || !initialStopLoss || !takeProfit) return null;

  let currentStopLoss = initialStopLoss;
  let exitPrice = forwardBars[forwardBars.length - 1]?.close ?? entryPrice;
  let outcome = 'time_stop'; // Default if neither TP nor SL hit by end of window

  for (let i = 0; i < forwardBars.length; i++) {
    const bar = forwardBars[i];
    if (!bar) continue;

    if (direction === 'long') {
      // Gap down below stop loss at open -> fill at open price
      if (bar.open <= currentStopLoss) {
        exitPrice = bar.open * (1 - SLIPPAGE_RATE);
        outcome = currentStopLoss > initialStopLoss ? 'trailing_stop' : 'stop_loss';
        break;
      }
      // Gap up above take profit at open -> fill at open price
      if (bar.open >= takeProfit) {
        exitPrice = bar.open * (1 - SLIPPAGE_RATE);
        outcome = 'take_profit';
        break;
      }
      // Intra-day movement: conservative assumption (stop hit before TP)
      if (bar.low <= currentStopLoss) {
        exitPrice = currentStopLoss * (1 - SLIPPAGE_RATE);
        outcome = currentStopLoss > initialStopLoss ? 'trailing_stop' : 'stop_loss';
        break;
      }
      if (bar.high >= takeProfit) {
        exitPrice = takeProfit * (1 - SLIPPAGE_RATE);
        outcome = 'take_profit';
        break;
      }
      
      // Trailing Stop rule: move stop up to 3% below the highest high observed so far
      const potentialTrail = bar.high * 0.97;
      if (potentialTrail > currentStopLoss) {
        currentStopLoss = potentialTrail;
      }
    } else {
      // Short direction
      if (bar.open >= currentStopLoss) {
        exitPrice = bar.open * (1 + SLIPPAGE_RATE);
        outcome = currentStopLoss < initialStopLoss ? 'trailing_stop' : 'stop_loss';
        break;
      }
      if (bar.open <= takeProfit) {
        exitPrice = bar.open * (1 + SLIPPAGE_RATE);
        outcome = 'take_profit';
        break;
      }
      if (bar.high >= currentStopLoss) {
        exitPrice = currentStopLoss * (1 + SLIPPAGE_RATE);
        outcome = currentStopLoss < initialStopLoss ? 'trailing_stop' : 'stop_loss';
        break;
      }
      if (bar.low <= takeProfit) {
        exitPrice = takeProfit * (1 + SLIPPAGE_RATE);
        outcome = 'take_profit';
        break;
      }
      
      // Trailing rule: move stop down to 3% above the lowest low observed so far
      const potentialTrail = bar.low * 1.03;
      if (potentialTrail < currentStopLoss) {
        currentStopLoss = potentialTrail;
      }
    }
  }

  // If time_stop, apply exit slippage to the final unforced close
  if (outcome === 'time_stop') {
    exitPrice = direction === 'long' 
      ? exitPrice * (1 - SLIPPAGE_RATE)
      : exitPrice * (1 + SLIPPAGE_RATE);
  }

  const simulatedReturnPct = direction === 'long'
    ? ((exitPrice - entryPrice) / entryPrice) * 100
    : ((entryPrice - exitPrice) / entryPrice) * 100;

  return {
    analysisId: analysis.analysisId,
    analysisAt: analysis.analysisAt,
    signal: analysis.signal,
    signalScore: round(analysis.signalScore),
    entryPrice: round(entryPrice),
    exitPrice: round(exitPrice),
    simulatedReturnPct: round(simulatedReturnPct),
    directionCorrect: simulatedReturnPct > 0,
    outcome,
    stopLoss: round(initialStopLoss),
    takeProfit: round(takeProfit),
  };
}

const ledgerInFlight = new Map<string, Promise<AnalyzeStockResponse[]>>();

async function ensureHistoricalAnalysisLedger(
  symbol: string,
  name: string,
  currency: string,
  candles: Candle[],
): Promise<AnalyzeStockResponse[]> {
  const existing = ledgerInFlight.get(symbol);
  if (existing) return existing;
  const promise = _ensureHistoricalAnalysisLedger(symbol, name, currency, candles);
  ledgerInFlight.set(symbol, promise);
  try {
    return await promise;
  } finally {
    ledgerInFlight.delete(symbol);
  }
}

async function _ensureHistoricalAnalysisLedger(
  symbol: string,
  name: string,
  currency: string,
  candles: Candle[],
): Promise<AnalyzeStockResponse[]> {
  const existing = await getStoredHistoricalBacktestAnalyses(symbol);
  const latestStoredAt = existing[0]?.analysisAt || 0;
  const latestCandleAt = candles[candles.length - 1]?.timestamp || 0;
  if (existing.length > 0 && latestStoredAt >= latestCandleAt) {
    return existing.sort(compareByAnalysisAtDesc);
  }

  const generated: AnalyzeStockResponse[] = [];
  for (let index = MIN_ANALYSIS_BARS - 1; index < candles.length; index++) {
    const analysisWindow = candles.slice(0, index + 1);
    const technical = buildTechnicalSnapshot(analysisWindow);
    technical.currency = currency;
    const analysisAt = candles[index]?.timestamp || 0;
    if (!analysisAt) continue;

    generated.push(buildAnalysisResponse({
      symbol,
      name,
      currency,
      technical,
      headlines: [],
      overlay: getFallbackOverlay(name, technical, []),
      includeNews: false,
      analysisAt,
      generatedAt: new Date(analysisAt).toISOString(),
      analysisId: `ledger:${STOCK_ANALYSIS_ENGINE_VERSION}:${symbol}:${analysisAt}`,
    }));
  }

  await storeHistoricalBacktestAnalysisRecords(generated);
  return generated.sort(compareByAnalysisAtDesc);
}

export const backtestStock: MarketServiceHandler['backtestStock'] = async (
  _ctx,
  req,
): Promise<BacktestStockResponse> => {
  const symbol = sanitizeSymbol(req.symbol || '');
  if (!symbol) {
    return {
      available: false,
      symbol: '',
      name: req.name || '',
      display: '',
      currency: 'USD',
      evalWindowDays: req.evalWindowDays || DEFAULT_WINDOW_DAYS,
      evaluationsRun: 0,
      actionableEvaluations: 0,
      winRate: 0,
      directionAccuracy: 0,
      avgSimulatedReturnPct: 0,
      cumulativeSimulatedReturnPct: 0,
      latestSignal: '',
      latestSignalScore: 0,
      summary: 'No symbol provided.',
      generatedAt: new Date().toISOString(),
      evaluations: [],
      engineVersion: STOCK_ANALYSIS_ENGINE_VERSION,
      sharpeRatio: 0,
      sortinoRatio: 0,
      maxDrawdownPct: 0,
      kellyCriterionPct: 0,
    };
  }

  const evalWindowDays = Math.max(3, Math.min(30, req.evalWindowDays || DEFAULT_WINDOW_DAYS));
  const cacheKey = `market:backtest:v2:${symbol}:${evalWindowDays}`;

  try {
    const cached = await cachedFetchJson<BacktestStockResponse>(cacheKey, CACHE_TTL_SECONDS, async () => {
      const history = await fetchYahooHistory(symbol);
      if (!history || history.candles.length < MIN_REQUIRED_BARS) return null;

      const analyses = await ensureHistoricalAnalysisLedger(
        symbol,
        req.name || symbol,
        history.currency || 'USD',
        history.candles,
      );
      if (analyses.length === 0) return null;

      const candleIndexByTimestamp = new Map<number, number>();
      history.candles.forEach((candle, index) => {
        candleIndexByTimestamp.set(candle.timestamp, index);
      });

      const evaluations = analyses
        .map((analysis) => {
          const candleIndex = candleIndexByTimestamp.get(analysis.analysisAt);
          if (candleIndex == null) return null;
          const forwardBars = history.candles.slice(candleIndex + 1, candleIndex + 1 + evalWindowDays);
          if (forwardBars.length < evalWindowDays) return null;
          return simulateEvaluation(analysis, forwardBars);
        })
        .filter((evaluation): evaluation is BacktestStockEvaluation => !!evaluation)
        .sort(compareByAnalysisAtDesc);

      if (evaluations.length === 0) return null;

      const actionableEvaluations = evaluations.length;
      const profitable = evaluations.filter((evaluation) => evaluation.simulatedReturnPct > 0);
      const losses = evaluations.filter((evaluation) => evaluation.simulatedReturnPct <= 0);
      const winRate = (profitable.length / actionableEvaluations) * 100;
      const directionAccuracy = (evaluations.filter((evaluation) => evaluation.directionCorrect).length / actionableEvaluations) * 100;
      const avgSimulatedReturnPct = evaluations.reduce((sum, evaluation) => sum + evaluation.simulatedReturnPct, 0) / actionableEvaluations;
      const cumulativeSimulatedReturnPct = evaluations.reduce((sum, evaluation) => sum + evaluation.simulatedReturnPct, 0);
      const latest = evaluations[0]!;

      // Advanced Analytics (Sharpe, Sortino, MDD, Kelly)
      const returns = evaluations.map(e => e.simulatedReturnPct);
      const negativeReturns = returns.filter(r => r < 0);
      
      const stdDev = Math.sqrt(returns.reduce((sq, r) => sq + Math.pow(r - avgSimulatedReturnPct, 2), 0) / (actionableEvaluations || 1));
      const downsideDeviation = Math.sqrt(negativeReturns.reduce((sq, r) => sq + Math.pow(r, 2), 0) / (negativeReturns.length || 1));
      
      const sharpeRatio = stdDev === 0 ? 0 : avgSimulatedReturnPct / stdDev;
      const sortinoRatio = downsideDeviation === 0 ? 0 : avgSimulatedReturnPct / downsideDeviation;

      // Max Drawdown
      let peak = 0;
      let maxDrawdownPct = 0;
      let currentEquity = 0;
      // Reverse evaluations so chronological order for drawdown
      for (const e of [...evaluations].reverse()) {
        currentEquity += e.simulatedReturnPct;
        if (currentEquity > peak) {
          peak = currentEquity;
        }
        const drawdown = peak - currentEquity;
        if (drawdown > maxDrawdownPct) {
          maxDrawdownPct = drawdown;
        }
      }

      // Kelly Criterion: W - ((1 - W) / R)
      // R = Average Win / Absolute Average Loss
      const avgWin = profitable.length ? profitable.reduce((sum, e) => sum + e.simulatedReturnPct, 0) / profitable.length : 0;
      const avgLoss = losses.length ? Math.abs(losses.reduce((sum, e) => sum + e.simulatedReturnPct, 0) / losses.length) : 1;
      const W = profitable.length / actionableEvaluations;
      const R = avgWin / (avgLoss || 1);
      let kellyCriterionPct = 0;
      if (R > 0) {
        kellyCriterionPct = (W - ((1 - W) / R)) * 100; // as percentage
        if (kellyCriterionPct < 0) kellyCriterionPct = 0;
      }

      const response: BacktestStockResponse = {
        available: true,
        symbol,
        name: req.name || symbol,
        display: symbol,
        currency: history.currency || 'USD',
        evalWindowDays,
        evaluationsRun: analyses.length,
        actionableEvaluations,
        winRate: round(winRate),
        directionAccuracy: round(directionAccuracy),
        avgSimulatedReturnPct: round(avgSimulatedReturnPct),
        cumulativeSimulatedReturnPct: round(cumulativeSimulatedReturnPct),
        latestSignal: latest.signal,
        latestSignalScore: round(latest.signalScore),
        summary: `Validated ${actionableEvaluations} records over ${evalWindowDays} days. WinRate: ${round(winRate)}%, Sharpe: ${round(sharpeRatio)}, MDD: ${round(maxDrawdownPct)}%.`,
        generatedAt: new Date().toISOString(),
        evaluations: evaluations.slice(0, MAX_EVALUATIONS),
        engineVersion: STOCK_ANALYSIS_ENGINE_VERSION,
        sharpeRatio: round(sharpeRatio),
        sortinoRatio: round(sortinoRatio),
        maxDrawdownPct: round(maxDrawdownPct),
        kellyCriterionPct: round(kellyCriterionPct),
      };
      await storeStockBacktestSnapshot(response);
      return response;
    });
    if (cached) return cached;
  } catch (err) {
    console.warn(`[backtestStock] ${symbol} failed:`, (err as Error).message);
  }

  return {
    available: false,
    symbol,
    name: req.name || symbol,
    display: symbol,
    currency: 'USD',
    evalWindowDays,
    evaluationsRun: 0,
    actionableEvaluations: 0,
    winRate: 0,
    directionAccuracy: 0,
    avgSimulatedReturnPct: 0,
    cumulativeSimulatedReturnPct: 0,
    latestSignal: '',
    latestSignalScore: 0,
    summary: 'Backtest unavailable for this symbol.',
    generatedAt: new Date().toISOString(),
    evaluations: [],
    engineVersion: STOCK_ANALYSIS_ENGINE_VERSION,
    sharpeRatio: 0,
    sortinoRatio: 0,
    maxDrawdownPct: 0,
    kellyCriterionPct: 0,
  };
};
