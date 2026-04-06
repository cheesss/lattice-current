/**
 * Ablation Runner — Phase 0.3
 *
 * Tests each model's marginal contribution by running the evaluation
 * pipeline with individual models disabled.
 *
 * The ablation framework works by intercepting model outputs rather than
 * modifying the actual model code. When a model is "disabled", its output
 * is replaced with a neutral default value.
 */

import type {
  AblationTarget,
  AblationConfig,
  AblationResult,
  AblationReport,
  EvaluationFrame,
  BaselineStrategy,
  BaselineSignal,
  InvestmentDirection,
} from './types';
import { runStrategy } from './evaluation-pipeline';

// ---------------------------------------------------------------------------
// Ablation-Aware System Strategy
// ---------------------------------------------------------------------------

/**
 * Conviction feature weights — approximate contribution factors
 * derived from the ConvictionFeatureSnapshot in investment-intelligence.ts.
 *
 * When a model is disabled, its corresponding feature is zeroed out
 * and the remaining features are renormalised.
 */
const FEATURE_MODEL_MAP: Record<AblationTarget, string[]> = {
  kalman: [], // Kalman affects signal smoothing, not direct conviction features
  hmm: ['regimeMultiplier'],
  hawkes: [], // Hawkes affects event clustering intensity
  bandit: ['banditScore'],
  rmt: [], // RMT affects correlation/crowding penalty
  truthDiscovery: ['corroborationQuality'],
  transferEntropy: ['transferEntropy'],
  conviction: ['corroborationQuality', 'recentEvidenceScore', 'realityScore',
    'graphSignalScore', 'transferEntropy', 'banditScore', 'regimeMultiplier',
    'coveragePenalty', 'falsePositiveRisk'],
};

/**
 * Base feature weights — approximate from the scoreConvictionModel function.
 * These are the default weights before any online learning.
 */
const BASE_FEATURE_WEIGHTS: Record<string, number> = {
  corroborationQuality: 0.22,
  recentEvidenceScore: 0.15,
  realityScore: 0.12,
  graphSignalScore: 0.10,
  transferEntropy: 0.10,
  banditScore: 0.10,
  regimeMultiplier: 0.08,
  coveragePenalty: -0.07,
  falsePositiveRisk: -0.16,
};

/**
 * Creates a system strategy with specified models disabled.
 * When a model is disabled, its corresponding conviction features
 * are set to neutral (0), simulating what happens without that model.
 */
export function createAblatedSystemStrategy(
  disabledModels: AblationTarget[],
  label: string,
): BaselineStrategy {
  // Determine which features are zeroed out
  const disabledFeatures = new Set<string>();
  for (const model of disabledModels) {
    for (const feature of FEATURE_MODEL_MAP[model]) {
      disabledFeatures.add(feature);
    }
  }

  return {
    name: label,
    description: `System strategy with ${disabledModels.join(', ')} disabled`,

    generateSignals(frame: EvaluationFrame): BaselineSignal[] {
      // Simplified system signal generation using available features
      if (frame.clusters.length === 0 || frame.markets.length === 0) return [];

      const signals: BaselineSignal[] = [];

      // Use cluster severity and sentiment as primary signals
      const topClusters = frame.clusters
        .filter((c) => c.severity > 30)
        .sort((a, b) => b.severity - a.severity)
        .slice(0, 3);

      for (const cluster of topClusters) {
        // Compute a simplified conviction from available features
        let conviction = 0;
        let totalWeight = 0;

        // Corroboration quality: cluster event count
        if (!disabledFeatures.has('corroborationQuality')) {
          const cq = Math.min(100, cluster.eventCount * 15);
          conviction += cq * (BASE_FEATURE_WEIGHTS.corroborationQuality ?? 0);
          totalWeight += Math.abs(BASE_FEATURE_WEIGHTS.corroborationQuality ?? 0);
        }

        // Recent evidence: cluster severity
        if (!disabledFeatures.has('recentEvidenceScore')) {
          conviction += cluster.severity * (BASE_FEATURE_WEIGHTS.recentEvidenceScore ?? 0);
          totalWeight += Math.abs(BASE_FEATURE_WEIGHTS.recentEvidenceScore ?? 0);
        }

        // Reality score: market data availability
        if (!disabledFeatures.has('realityScore')) {
          const marketAvailability = frame.markets.filter((m) => m.price != null).length / Math.max(1, frame.markets.length);
          conviction += marketAvailability * 100 * (BASE_FEATURE_WEIGHTS.realityScore ?? 0);
          totalWeight += Math.abs(BASE_FEATURE_WEIGHTS.realityScore ?? 0);
        }

        // Graph signal: keyword connectivity
        if (!disabledFeatures.has('graphSignalScore')) {
          const keywordScore = Math.min(100, cluster.keywords.length * 12);
          conviction += keywordScore * (BASE_FEATURE_WEIGHTS.graphSignalScore ?? 0);
          totalWeight += Math.abs(BASE_FEATURE_WEIGHTS.graphSignalScore ?? 0);
        }

        // Transfer entropy: cross-asset signal (simplified)
        if (!disabledFeatures.has('transferEntropy')) {
          const movers = frame.markets.filter(
            (m) => m.changePercent != null && Math.abs(m.changePercent!) > 0.5,
          );
          const te = Math.min(1, movers.length / 5);
          conviction += te * 100 * (BASE_FEATURE_WEIGHTS.transferEntropy ?? 0);
          totalWeight += Math.abs(BASE_FEATURE_WEIGHTS.transferEntropy ?? 0);
        }

        // Bandit score: exploration bonus (simplified)
        if (!disabledFeatures.has('banditScore')) {
          conviction += 50 * (BASE_FEATURE_WEIGHTS.banditScore ?? 0);
          totalWeight += Math.abs(BASE_FEATURE_WEIGHTS.banditScore ?? 0);
        }

        // Regime multiplier
        if (!disabledFeatures.has('regimeMultiplier')) {
          conviction += 100 * (BASE_FEATURE_WEIGHTS.regimeMultiplier ?? 0);
          totalWeight += Math.abs(BASE_FEATURE_WEIGHTS.regimeMultiplier ?? 0);
        }

        // FP risk penalty
        if (!disabledFeatures.has('falsePositiveRisk')) {
          const fpRisk = cluster.eventCount < 3 ? 60 : 20;
          conviction += fpRisk * (BASE_FEATURE_WEIGHTS.falsePositiveRisk ?? 0);
          totalWeight += Math.abs(BASE_FEATURE_WEIGHTS.falsePositiveRisk ?? 0);
        }

        // Normalise conviction to 0-100
        if (totalWeight > 0) {
          conviction = conviction / totalWeight;
        }
        conviction = Math.max(0, Math.min(100, conviction));

        if (conviction < 30) continue;

        // Determine direction from sentiment
        const direction: InvestmentDirection =
          cluster.avgSentiment < -0.1 ? 'short' : 'long';

        // Pick the most-moved symbol as the target
        const topMover = frame.markets
          .filter((m) => m.price != null && m.changePercent != null)
          .sort((a, b) => Math.abs(b.changePercent ?? 0) - Math.abs(a.changePercent ?? 0))[0];

        if (topMover) {
          signals.push({
            symbol: topMover.symbol,
            direction,
            conviction: Math.round(conviction),
            timestamp: frame.timestamp,
            reason: `cluster "${cluster.label}" (severity ${cluster.severity})`,
          });
        }
      }

      return signals;
    },
  };
}

// ---------------------------------------------------------------------------
// Ablation Suite
// ---------------------------------------------------------------------------

const ALL_ABLATION_TARGETS: AblationTarget[] = [
  'kalman',
  'hmm',
  'hawkes',
  'bandit',
  'rmt',
  'truthDiscovery',
  'transferEntropy',
  'conviction',
];

export function buildAblationConfigs(): AblationConfig[] {
  return ALL_ABLATION_TARGETS.map((target) => ({
    label: `without-${target}`,
    disabledModels: [target],
  }));
}

export function runAblation(
  config: AblationConfig,
  frames: EvaluationFrame[],
  horizonHours = 24,
): AblationResult {
  const strategy = createAblatedSystemStrategy(config.disabledModels, config.label);
  const run = runStrategy(strategy, frames, horizonHours);
  return { config, run };
}

export function runFullAblationSuite(
  frames: EvaluationFrame[],
  horizonHours = 24,
): AblationReport {
  // Full system run (no models disabled)
  const fullSystemStrategy = createAblatedSystemStrategy([], 'full-system');
  const fullSystemRun = runStrategy(fullSystemStrategy, frames, horizonHours);

  // Ablate each model
  const configs = buildAblationConfigs();
  const ablations: AblationResult[] = configs.map((config) =>
    runAblation(config, frames, horizonHours),
  );

  // Compute marginal contributions
  const contributions = ablations.map((ablation) => ({
    model: ablation.config.disabledModels[0] as AblationTarget,
    hitRateDelta: fullSystemRun.hitRate - ablation.run.hitRate,
    avgReturnDelta: fullSystemRun.avgReturnPct - ablation.run.avgReturnPct,
    sharpeDelta: fullSystemRun.sharpeRatio - ablation.run.sharpeRatio,
  }));

  // Sort by absolute contribution (descending)
  contributions.sort((a, b) => Math.abs(b.sharpeDelta) - Math.abs(a.sharpeDelta));

  const firstFrame = frames[0];
  const lastFrame = frames[frames.length - 1];
  const period = firstFrame && lastFrame
    ? { start: firstFrame.timestamp, end: lastFrame.timestamp }
    : { start: '', end: '' };

  return {
    generatedAt: new Date().toISOString(),
    period,
    fullSystemRun,
    ablations,
    contributions,
  };
}
