/**
 * meta-model-inference.ts — Python GPU 추론 서버 클라이언트
 *
 * PyTorch 모델을 Python FastAPI 서버에서 GPU로 추론하고,
 * TS에서는 HTTP 요청으로 결과를 받습니다.
 *
 * 서버: scripts/meta-model-server.py (FastAPI + uvicorn)
 * 포트: 8100 (기본값, META_MODEL_PORT 환경변수로 변경 가능)
 */

import { createLogger } from '@/utils/logger';

const logger = createLogger('meta-model');

const META_MODEL_URL = (typeof process !== 'undefined' && process.env?.META_MODEL_URL)
  || 'http://localhost:8100';

export interface MetaModelPrediction {
  alphaProb: number;
  expectedAlpha: number;
  downsideRisk: number;
  timeToPeak: string;
  timeToPeakProbs: number[];
  modelVersion: string;
}

export interface MetaModelInput {
  sourceCount: number;
  sourceDiversity: number;
  articleCount: number;
  hawkesIntensity: number;
  hawkesMomentum: number;
  vixValue: number;
  vixZscore: number;
  vixMomentum: number;
  yieldSpread: number;
  oilPrice: number;
  dollarIndex: number;
  creditSpreadHy: number;
  marketStress: number;
  transmissionStrength: number;
  eventIntensity: number;
  regimeMultiplier: number;
  riskGauge: number;
  regimeId: number;
}

const REGIME_MAP: Record<string, number> = {
  'risk-on-strong': 0, 'risk-on': 1, 'balanced': 2, 'risk-off': 3, 'crisis': 4,
};

let serverAvailable: boolean | null = null;
let lastHealthCheck = 0;
const HEALTH_CHECK_INTERVAL_MS = 60_000;

export function regimeToId(regime: string): number {
  return REGIME_MAP[regime] ?? 2;
}

async function checkServerHealth(): Promise<boolean> {
  if (serverAvailable !== null && Date.now() - lastHealthCheck < HEALTH_CHECK_INTERVAL_MS) {
    return serverAvailable;
  }
  try {
    const resp = await fetch(`${META_MODEL_URL}/health`, {
      signal: AbortSignal.timeout(3000),
    });
    serverAvailable = resp.ok;
  } catch {
    serverAvailable = false;
  }
  lastHealthCheck = Date.now();
  return serverAvailable;
}

export async function predictMetaModel(input: MetaModelInput): Promise<MetaModelPrediction | null> {
  const healthy = await checkServerHealth();
  if (!healthy) return null;

  try {
    const resp = await fetch(`${META_MODEL_URL}/predict`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        source_count: input.sourceCount,
        source_diversity: input.sourceDiversity,
        article_count: input.articleCount,
        hawkes_intensity: input.hawkesIntensity,
        hawkes_momentum: input.hawkesMomentum,
        vix_value: input.vixValue,
        vix_zscore: input.vixZscore,
        vix_momentum: input.vixMomentum,
        yield_spread: input.yieldSpread,
        oil_price: input.oilPrice,
        dollar_index: input.dollarIndex,
        credit_spread_hy: input.creditSpreadHy,
        market_stress: input.marketStress,
        transmission_strength: input.transmissionStrength,
        event_intensity: input.eventIntensity,
        regime_multiplier: input.regimeMultiplier,
        risk_gauge: input.riskGauge,
        regime_id: input.regimeId,
      }),
      signal: AbortSignal.timeout(5000),
    });

    if (!resp.ok) return null;
    const data = await resp.json() as {
      alpha_prob: number;
      expected_alpha: number;
      downside_risk: number;
      time_to_peak: string;
      time_to_peak_probs: number[];
      model_version: string;
    };

    return {
      alphaProb: data.alpha_prob,
      expectedAlpha: data.expected_alpha,
      downsideRisk: data.downside_risk,
      timeToPeak: data.time_to_peak,
      timeToPeakProbs: data.time_to_peak_probs,
      modelVersion: data.model_version,
    };
  } catch (err) {
    logger.warn('meta-model inference failed', { error: String(err) });
    return null;
  }
}

export function isMetaModelAvailable(): boolean {
  return serverAvailable === true;
}
