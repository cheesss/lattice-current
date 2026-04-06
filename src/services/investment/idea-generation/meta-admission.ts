import type { MacroRiskOverlay } from '../../macro-risk-overlay';
import type { ReplayAdaptationSnapshot } from '../../replay-adaptation';
import { getReplayThemeProfileFromSnapshot, getCurrentThemePerformanceFromSnapshot } from '../../replay-adaptation';
import { computeThemeStabilityAdjustment } from '../portfolio-optimizer';
import { predictHitProbability } from '../adaptive-params/weight-learner.js';
import type { MetaWeights } from '../adaptive-params/weight-learner.js';

import type {
  IdeaGenerationRuntimeContext,
  InvestmentIdeaCard,
} from '../types';
import { clamp } from '../utils';
import {
  getThemeRule,
  resolveThemePolicy,
} from '../theme-registry';

// ============================================================================
// META WEIGHTS LOADING
// ============================================================================

type MetaWeightsLoadStatus = 'ready' | 'missing' | 'invalid' | 'unsupported';

export interface MetaWeightsLoadState {
  status: MetaWeightsLoadStatus;
  weights: MetaWeights | null;
  path: string | null;
  error: string | null;
}

function isNodeRuntime(): boolean {
  return typeof process !== 'undefined' && Boolean(process.versions?.node);
}

function isMetaWeights(weights: unknown): weights is MetaWeights {
  if (!weights || typeof weights !== 'object') return false;
  const candidate = weights as MetaWeights;
  return Array.isArray(candidate.featureNames)
    && candidate.featureNames.length === 11
    && Array.isArray(candidate.weights)
    && candidate.weights.length === 11
    && candidate.featureNames.includes('confidence')
    && candidate.featureNames.includes('driftPenalty');
}

function buildMetaWeightsLoadState(): MetaWeightsLoadState {
  if (!isNodeRuntime()) {
    return {
      status: 'unsupported',
      weights: null,
      path: null,
      error: 'Meta weights loading is only available in a Node-capable runtime.',
    };
  }

  const configuredPath = String(
    process.env.WM_META_WEIGHTS_PATH
    || process.env.LEARNED_META_WEIGHTS_PATH
    || 'data/learned_meta_weights.json',
  ).trim();

  try {
    const nodeRequire = (new Function(
      'return typeof require === "function" ? require : null;',
    )() as ((specifier: string) => {
      resolveWeightsPath: (inputPath: string) => string;
      loadWeightsSync: (pathLike: string) => unknown;
    }) | null);

    if (!nodeRequire) {
      return {
        status: 'unsupported',
        weights: null,
        path: configuredPath,
        error: 'Meta weights loading requires Node require().',
      };
    }

    let nodeLoader:
      | {
        resolveWeightsPath: (inputPath: string) => string;
        loadWeightsSync: (pathLike: string) => unknown;
      }
      | null = null;
    let lastError: unknown = null;
    for (const specifier of [
      './adaptive-params/weight-learner.node.js',
      './adaptive-params/weight-learner.node.ts',
    ]) {
      try {
        nodeLoader = nodeRequire(specifier);
        break;
      } catch (error) {
        lastError = error;
      }
    }

    if (!nodeLoader) {
      throw lastError instanceof Error
        ? lastError
        : new Error('Unable to load node weight loader.');
    }

    const resolvedPath = nodeLoader.resolveWeightsPath(configuredPath);
    const loaded = nodeLoader.loadWeightsSync(resolvedPath);
    if (!isMetaWeights(loaded)) {
      return {
        status: 'invalid',
        weights: null,
        path: resolvedPath,
        error: `Unexpected meta weight shape at ${resolvedPath}.`,
      };
    }

    return {
      status: 'ready',
      weights: loaded,
      path: resolvedPath,
      error: null,
    };
  } catch (error) {
    const message = String(error instanceof Error ? error.message : error);
    return {
      status: /ENOENT|no such file/i.test(message) ? 'missing' : 'invalid',
      weights: null,
      path: configuredPath,
      error: message,
    };
  }
}

const metaWeightsState = buildMetaWeightsLoadState();

export function getMetaWeightsLoadState(): MetaWeightsLoadState {
  return {
    status: metaWeightsState.status,
    weights: metaWeightsState.weights
      ? {
        featureNames: [...metaWeightsState.weights.featureNames],
        weights: [...metaWeightsState.weights.weights],
        bias: metaWeightsState.weights.bias,
      }
      : null,
    path: metaWeightsState.path,
    error: metaWeightsState.error,
  };
}

// ============================================================================
// META TRADE ADMISSION
// ============================================================================

export function applyMetaTradeAdmission(
  card: InvestmentIdeaCard,
  macroOverlay: MacroRiskOverlay,
  replayAdaptation: ReplayAdaptationSnapshot | null,
  runtimeContext: IdeaGenerationRuntimeContext,
): InvestmentIdeaCard {
  const theme = getThemeRule(card.themeId);
  const themePolicy = theme ? resolveThemePolicy(theme) : null;
  const replayProfile = getReplayThemeProfileFromSnapshot(replayAdaptation, card.themeId);
  const currentPerformance = getCurrentThemePerformanceFromSnapshot(replayAdaptation, card.themeId);
  const stability = computeThemeStabilityAdjustment(card.themeId);
  const narrativePenalty = Number(
    themePolicy?.narrative.enabled
      ? card.narrativeShadowState === 'mismatch'
        ? themePolicy.narrative.mismatchPenalty
        : card.narrativeShadowState === 'weak'
          ? themePolicy.narrative.weakPenalty
          : 0
      : 0,
  ) || 0;
  const symbolRules = card.symbols
    .map((symbol) => themePolicy?.symbolAdjustments[String(symbol.symbol || '').trim().toUpperCase()])
    .filter((value): value is NonNullable<typeof value> => Boolean(value));
  const specialSymbolPenalty = symbolRules.reduce((sum, rule) => sum + (rule.metaScorePenalty || 0), 0);
  const specialSizeMultiplier = symbolRules.length > 0
    ? Math.min(...symbolRules.map((rule) => rule.sizeMultiplier ?? 1))
    : 1;
  const specialWeightBlock = symbolRules.some((rule) => rule.requireRiskOff) && !macroOverlay.killSwitch && macroOverlay.state === 'risk-on';
  const hedgeHeavyPenalty =
    themePolicy?.classification === 'hedge-heavy'
      ? macroOverlay.state === 'risk-on'
        ? 0.08
        : macroOverlay.state === 'balanced'
          ? 0.03
          : 0
      : 0;

  const replayHitRate = clamp(Number(replayProfile?.hitRate ?? card.backtestHitRate ?? 50), 0, 100);
  const replayReturnPct = Number(replayProfile?.costAdjustedAvgReturnPct ?? card.backtestAvgReturnPct ?? 0) || 0;
  const currentHitRate = clamp(Number(currentPerformance?.hitRate ?? replayHitRate), 0, 100);
  const currentReturnPct = Number(currentPerformance?.avgReturnPct ?? replayReturnPct) || 0;
  const driftPenalty = clamp(Math.abs(Math.min(0, Number(replayProfile?.currentVsReplayDrift ?? 0))) / 2.5, 0, 1);
  const confidence = clamp(card.calibratedConfidence / 100, 0, 1);
  const confirmation = clamp(card.confirmationScore / 100, 0, 1);
  const reality = clamp(card.realityScore / 100, 0, 1);
  const coverage = clamp(1 - card.coveragePenalty / 120, 0, 1);
  const bandit = clamp((Number(card.banditScore) || 50) / 100, 0, 1);
  const transfer = clamp(Number(card.transferEntropy) || 0, 0, 1);
  const clusterConfidence = clamp((Number(card.clusterConfidence) || 0) / 100, 0, 1);
  const gp = runtimeContext.signal.transmissionProxy;
  const signalSnapshot = runtimeContext.signal.signalSnapshot;
  const marketStressPrior = clamp(Number(card.marketStressPrior) || (gp?.marketStress ?? 0), 0, 1);
  const transmissionStress = clamp(Number(card.transmissionStress ?? card.marketStressPrior ?? 0) || (gp?.transmissionStrength ?? 0), 0, 1);
  const evidenceSupport = clamp(
    clusterConfidence * 0.58
    + marketStressPrior * 0.24
    + transmissionStress * 0.18,
    0,
    1,
  );
  const falsePositivePenalty = clamp(card.falsePositiveRisk / 100, 0, 1);
  const shadowPosterior = clamp((Number(card.narrativeShadowPosterior) || 0) / 100, 0, 1);
  const shadowDisagreement = clamp((Number(card.narrativeShadowDisagreement) || 0) / 100, 0, 1);
  const narrativeAlignment = clamp((Number(card.narrativeAlignmentScore) || 50) / 100, 0, 1);
  const shadowThemeAgreement = card.narrativeShadowTopThemeId
    ? String(card.narrativeShadowTopThemeId).trim().toLowerCase() === String(card.themeId).trim().toLowerCase()
      ? 1
      : 0
    : 0.5;
  const shadowSupport = clamp(
    shadowPosterior * (0.56 + shadowThemeAgreement * 0.44)
    + narrativeAlignment * 0.18
    - shadowDisagreement * 0.72,
    0,
    1,
  );
  const shadowPenalty = clamp(
    (card.narrativeShadowState === 'mismatch'
      ? 0.12
      : card.narrativeShadowState === 'weak'
        ? 0.05
        : 0)
    + shadowDisagreement * 0.08
    + (shadowThemeAgreement === 0 && shadowPosterior >= 0.58 ? 0.05 : 0),
    0,
    0.45,
  );
  const stressPenalty = macroOverlay.killSwitch
    ? 0.22
    : macroOverlay.state === 'risk-off'
      ? 0.1
      : macroOverlay.state === 'balanced'
        ? 0.04
        : 0;
  const signalStressPenalty = signalSnapshot?.vix != null && signalSnapshot.vix > 25
    ? clamp((signalSnapshot.vix - 25) / 40, 0, 0.12)
    : 0;
  const stabilityExposure = clamp(stability.exposureMultiplier, 0, 1.2);
  let mlProbability: number | null = null;
  if (metaWeightsState.weights) {
    mlProbability = predictHitProbability(metaWeightsState.weights, {
      confidence,
      confirmation,
      reality,
      replayHitRate,
      currentHitRate,
      coverage,
      bandit,
      transfer,
      stability: stabilityExposure,
      falsePositivePenalty,
      driftPenalty,
    });
  }
  const hardcodedBaseProb = Number((
    confidence * 0.18
    + confirmation * 0.18
    + reality * 0.16
    + (replayHitRate / 100) * 0.16
    + (currentHitRate / 100) * 0.1
    + coverage * 0.08
    + bandit * 0.08
    + transfer * 0.06
    + evidenceSupport * 0.08
    + stabilityExposure * 0.06
    - falsePositivePenalty * 0.14
    - driftPenalty * 0.08
  ).toFixed(4));
  const ragConfidence = clamp(runtimeContext.rag.confidence ?? 0, 0, 1);
  const ragAdjustment = runtimeContext.rag.hitRate != null
    ? (clamp(runtimeContext.rag.hitRate, 0, 1) - 0.5) * ragConfidence * 0.12
    : 0;
  const baseProb = (mlProbability ?? hardcodedBaseProb) + ragAdjustment;
  const fallbackMetaHitProbability = clamp(
    Number((hardcodedBaseProb - stressPenalty - signalStressPenalty - hedgeHeavyPenalty - shadowPenalty).toFixed(4)),
    0.03,
    0.97,
  );

  const metaHitProbability = mlProbability === null
    ? fallbackMetaHitProbability
    : clamp(baseProb - stressPenalty - signalStressPenalty - hedgeHeavyPenalty - shadowPenalty, 0.03, 0.97);

  const metaExpectedReturnPct = Number((
    replayReturnPct * 0.55
    + currentReturnPct * 0.2
    + Math.max(0, card.calibratedConfidence - 55) * 0.015
    + Math.max(0, card.realityScore - 60) * 0.01
    + Math.max(0, stability.lcbUtility) * 0.18
    + clusterConfidence * 0.85
    + marketStressPrior * 0.65
    + transmissionStress * 0.45
    - card.falsePositiveRisk * 0.012
    - card.coveragePenalty * 0.01
    - driftPenalty * 0.55
    - stressPenalty * 1.8
    - signalStressPenalty * 1.4
    - narrativePenalty * 0.05
    - shadowPenalty * 1.4
  ).toFixed(3));

  const metaDecisionScore = Number((
    metaHitProbability * 100
    + metaExpectedReturnPct * 7
    + stability.stabilityScore * 0.22
    + (Number(card.narrativeAlignmentScore) || 50) * 0.08
    + evidenceSupport * 10
    - card.falsePositiveRisk * 0.28
    - card.coveragePenalty * 0.12
    - specialSymbolPenalty
    - narrativePenalty * 1.2
    - shadowPenalty * 16
  ).toFixed(2));

  // ── Continuous Conviction Score ─────────────────
  const continuousConviction = clamp(
    metaHitProbability * 45
    + Math.max(0, metaExpectedReturnPct) * 8
    + (metaDecisionScore / 100) * 35
    + evidenceSupport * 12,
    0,
    100,
  );

  const thresholdPolicy = runtimeContext.admission.thresholds ?? themePolicy?.admission;
  // Legacy threshold variables — retained for threshold-optimizer integration (Phase 2).
  void (thresholdPolicy?.rejectHitProbability ?? 0.44);
  void (thresholdPolicy?.watchHitProbability ?? 0.52);
  void (thresholdPolicy?.rejectExpectedReturnPct ?? -0.2);
  void (thresholdPolicy?.watchExpectedReturnPct ?? 0.08);
  void (thresholdPolicy?.rejectScore ?? 38);
  void (thresholdPolicy?.watchScore ?? 52);

  // admissionState derived from continuousConviction (for logging + backward compat)
  let admissionState: 'accepted' | 'watch' | 'rejected' = 'accepted';
  let autonomyAction = card.autonomyAction;

  if (specialWeightBlock || continuousConviction < 15) {
    admissionState = 'rejected';
    autonomyAction = 'abstain';
  } else if (continuousConviction < 55) {
    admissionState = 'watch';
    if (autonomyAction === 'deploy') autonomyAction = 'watch';
  }

  // Continuous sizing: sigmoid-like scaling from conviction
  // conviction 0 → ~0.02, 25 → ~0.15, 50 → ~0.50, 75 → ~0.88, 100 → ~0.98
  const convictionFraction = continuousConviction / 100;
  const metaSizeScale = continuousConviction < 10
    ? 0
    : clamp(
      0.05 + convictionFraction * convictionFraction * 1.08,
      0.05,
      1.18,
    );

  return {
    ...card,
    autonomyAction,
    admissionState,
    continuousConviction: Number(continuousConviction.toFixed(2)),
    metaHitProbability: Number((metaHitProbability * 100).toFixed(2)),
    metaExpectedReturnPct,
    metaDecisionScore,
    sizePct: Number((card.sizePct * metaSizeScale * specialSizeMultiplier).toFixed(2)),
    autonomyReasons: Array.from(new Set([
      ...card.autonomyReasons,
      `Meta gate: hit=${(metaHitProbability * 100).toFixed(1)}%, exp=${metaExpectedReturnPct.toFixed(2)}%, score=${metaDecisionScore.toFixed(1)}.`,
      `Evidence prior: cluster=${(clusterConfidence * 100).toFixed(1)}%, stressPrior=${marketStressPrior.toFixed(2)}, transmission=${transmissionStress.toFixed(2)}.`,
      specialSymbolPenalty > 0 ? `Special-symbol calibration penalty=${specialSymbolPenalty.toFixed(1)}.` : '',
      card.narrativeShadowState ? `Narrative shadow=${card.narrativeShadowState} (${Number(card.narrativeAlignmentScore || 0).toFixed(0)}), posterior=${Number(card.narrativeShadowPosterior || 0).toFixed(1)}%, disagreement=${Number(card.narrativeShadowDisagreement || 0).toFixed(1)}, support=${(shadowSupport * 100).toFixed(1)}%.` : '',
      specialWeightBlock ? 'Risk-on regime blocked a risk-off-only special symbol.' : '',
      admissionState === 'rejected'
        ? 'Selective abstention rejected this idea before capital allocation.'
        : admissionState === 'watch'
          ? 'Selective gate downgraded this idea to watch-only because expected edge is too thin.'
          : 'Selective gate accepted this idea for allocation review.',
    ])).slice(0, 6),
  };
}
