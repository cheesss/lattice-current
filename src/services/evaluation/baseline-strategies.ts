/**
 * Baseline Strategies — Phase 0.1
 *
 * Five reference strategies that the system must beat to justify its complexity.
 * Each strategy receives the same EvaluationFrame and produces BaselineSignal[].
 *
 * 1. RandomStrategy — coin flip (50/50 long/short)
 * 2. SentimentOnlyStrategy — positive average sentiment → long, else short
 * 3. MomentumStrategy — follow recent price direction
 * 4. AlwaysLongStrategy — unconditional long bias
 * 5. ContraryStrategy — fade the sentiment
 */

import type {
  BaselineStrategy,
  BaselineSignal,
  EvaluationFrame,
  InvestmentDirection,
} from './types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Deterministic pseudo-random from a string seed.
 * Uses a simple hash → LCG so results are reproducible per frame.
 */
function seededRandom(seed: string): () => number {
  let h = 0;
  for (let i = 0; i < seed.length; i++) {
    h = (Math.imul(31, h) + seed.charCodeAt(i)) | 0;
  }
  return () => {
    h = (Math.imul(h, 1103515245) + 12345) | 0;
    return ((h >>> 16) & 0x7fff) / 0x7fff;
  };
}

function tradableSymbols(frame: EvaluationFrame): string[] {
  return frame.markets
    .filter((m) => m.price != null && m.price > 0)
    .map((m) => m.symbol);
}

function avgSentiment(frame: EvaluationFrame): number {
  if (frame.news.length === 0) return 0;
  const sum = frame.news.reduce((acc, n) => acc + n.sentiment, 0);
  return sum / frame.news.length;
}

// ---------------------------------------------------------------------------
// 1. Random Strategy
// ---------------------------------------------------------------------------

export const RandomStrategy: BaselineStrategy = {
  name: 'random',
  description:
    'Coin flip: randomly picks long or short for each tradable symbol with 50% probability. ' +
    'Fixed conviction of 50. Uses deterministic seed per frame for reproducibility.',

  generateSignals(frame: EvaluationFrame): BaselineSignal[] {
    const symbols = tradableSymbols(frame);
    if (symbols.length === 0) return [];

    const rng = seededRandom(frame.id + frame.timestamp);
    const signals: BaselineSignal[] = [];

    // Pick up to 3 random symbols per frame (like the real system)
    const picked = symbols.sort(() => rng() - 0.5).slice(0, 3);

    for (const symbol of picked) {
      const direction: InvestmentDirection = rng() > 0.5 ? 'long' : 'short';
      signals.push({
        symbol,
        direction,
        conviction: 50,
        timestamp: frame.timestamp,
        reason: 'random coin flip',
      });
    }
    return signals;
  },
};

// ---------------------------------------------------------------------------
// 2. Sentiment-Only Strategy
// ---------------------------------------------------------------------------

export const SentimentOnlyStrategy: BaselineStrategy = {
  name: 'sentiment-only',
  description:
    'If average news sentiment is positive → long the top-3 most-changed symbols, ' +
    'if negative → short them. Conviction scales with sentiment magnitude.',

  generateSignals(frame: EvaluationFrame): BaselineSignal[] {
    const sentiment = avgSentiment(frame);
    if (Math.abs(sentiment) < 0.02) return []; // dead zone

    const symbols = frame.markets
      .filter((m) => m.price != null && m.changePercent != null)
      .sort((a, b) => Math.abs(b.changePercent ?? 0) - Math.abs(a.changePercent ?? 0))
      .slice(0, 3);

    if (symbols.length === 0) return [];

    const direction: InvestmentDirection = sentiment > 0 ? 'long' : 'short';
    const conviction = Math.min(95, Math.round(30 + Math.abs(sentiment) * 65));

    return symbols.map((m) => ({
      symbol: m.symbol,
      direction,
      conviction,
      timestamp: frame.timestamp,
      reason: `avg sentiment ${sentiment.toFixed(3)} → ${direction}`,
    }));
  },
};

// ---------------------------------------------------------------------------
// 3. Momentum Strategy
// ---------------------------------------------------------------------------

export const MomentumStrategy: BaselineStrategy = {
  name: 'momentum',
  description:
    'Follow recent price direction: if a symbol\'s changePercent > 0.3% → long, ' +
    'if < -0.3% → short. Conviction scales with move magnitude.',

  generateSignals(frame: EvaluationFrame): BaselineSignal[] {
    const threshold = 0.3; // percent
    const signals: BaselineSignal[] = [];

    const movers = frame.markets
      .filter((m) => m.price != null && m.changePercent != null && Math.abs(m.changePercent!) > threshold)
      .sort((a, b) => Math.abs(b.changePercent ?? 0) - Math.abs(a.changePercent ?? 0))
      .slice(0, 3);

    for (const m of movers) {
      const pct = m.changePercent!;
      const direction: InvestmentDirection = pct > 0 ? 'long' : 'short';
      const conviction = Math.min(95, Math.round(40 + Math.abs(pct) * 8));
      signals.push({
        symbol: m.symbol,
        direction,
        conviction,
        timestamp: frame.timestamp,
        reason: `momentum: ${m.symbol} moved ${pct.toFixed(2)}%`,
      });
    }
    return signals;
  },
};

// ---------------------------------------------------------------------------
// 4. Always-Long Strategy
// ---------------------------------------------------------------------------

export const AlwaysLongStrategy: BaselineStrategy = {
  name: 'always-long',
  description:
    'Unconditional long bias on the 3 most liquid (highest-priced) symbols. ' +
    'Fixed conviction of 60. Tests whether bull bias alone explains system returns.',

  generateSignals(frame: EvaluationFrame): BaselineSignal[] {
    const symbols = frame.markets
      .filter((m) => m.price != null && m.price! > 0)
      .sort((a, b) => (b.price ?? 0) - (a.price ?? 0))
      .slice(0, 3);

    return symbols.map((m) => ({
      symbol: m.symbol,
      direction: 'long' as InvestmentDirection,
      conviction: 60,
      timestamp: frame.timestamp,
      reason: 'always-long bias',
    }));
  },
};

// ---------------------------------------------------------------------------
// 5. Contrary Strategy
// ---------------------------------------------------------------------------

export const ContraryStrategy: BaselineStrategy = {
  name: 'contrary',
  description:
    'Fade the sentiment: if average sentiment is positive → short, negative → long. ' +
    'Contrarian bet that news sentiment is already priced in.',

  generateSignals(frame: EvaluationFrame): BaselineSignal[] {
    const sentiment = avgSentiment(frame);
    if (Math.abs(sentiment) < 0.02) return [];

    const symbols = frame.markets
      .filter((m) => m.price != null && m.changePercent != null)
      .sort((a, b) => Math.abs(b.changePercent ?? 0) - Math.abs(a.changePercent ?? 0))
      .slice(0, 3);

    if (symbols.length === 0) return [];

    // Fade: positive sentiment → short, negative → long
    const direction: InvestmentDirection = sentiment > 0 ? 'short' : 'long';
    const conviction = Math.min(95, Math.round(30 + Math.abs(sentiment) * 65));

    return symbols.map((m) => ({
      symbol: m.symbol,
      direction,
      conviction,
      timestamp: frame.timestamp,
      reason: `contrarian: avg sentiment ${sentiment.toFixed(3)} → fade to ${direction}`,
    }));
  },
};

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

export const ALL_BASELINE_STRATEGIES: BaselineStrategy[] = [
  RandomStrategy,
  SentimentOnlyStrategy,
  MomentumStrategy,
  AlwaysLongStrategy,
  ContraryStrategy,
];

export function getBaselineStrategy(name: string): BaselineStrategy | undefined {
  return ALL_BASELINE_STRATEGIES.find((s) => s.name === name);
}
