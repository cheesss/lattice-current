/**
 * event-decision-bridge.ts — 이벤트 결정 엔진 브릿지
 *
 * 기존 orchestrator의 InvestmentIdeaCard에 메타모델 예측값과
 * evidence grade를 주입하는 중간 레이어.
 *
 * 흐름:
 *   orchestrator → idea cards 생성 (기존 conviction/FPR)
 *   → event-decision-bridge → meta-model 추론 + evidence grade 조회
 *   → enriched idea cards (alphaProb, expectedAlpha, downsideRisk, evidenceGrade)
 */

import { createLogger } from '@/utils/logger';
import type { InvestmentIdeaCard } from './investment/types';
import type { MacroRiskOverlay } from './macro-risk-overlay';
import { predictMetaModel, regimeToId, isMetaModelAvailable } from './meta-model-inference';
import type { MetaModelInput } from './meta-model-inference';

const logger = createLogger('event-decision-bridge');

export interface EventDecisionContext {
  vixValue: number | null;
  vixZscore: number | null;
  vixMomentum: number | null;
  yieldSpread: number | null;
  oilPrice: number | null;
  dollarIndex: number | null;
  creditSpreadHy: number | null;
  marketStress: number | null;
  transmissionStrength: number | null;
  eventIntensity: number | null;
  macroOverlay: MacroRiskOverlay | null;
}

// NAS에서 조회한 evidence grade 캐시
let evidenceCache: Map<string, string> | null = null;
let evidenceCacheExpiry = 0;
const EVIDENCE_CACHE_TTL_MS = 5 * 60 * 1000; // 5분

function evidenceCacheKey(themeId: string, symbol: string, horizon: string): string {
  return `${themeId}::${symbol}::${horizon}`;
}

export async function loadEvidenceGrades(): Promise<Map<string, string>> {
  if (evidenceCache && Date.now() < evidenceCacheExpiry) return evidenceCache;

  try {
    // Fetch from API or direct DB — for now use a lightweight endpoint
    const resp = await fetch('/api/event-uplift-grades');
    if (!resp.ok) {
      logger.warn('evidence grades fetch failed', { status: resp.status });
      return evidenceCache ?? new Map();
    }
    const rows: Array<{ theme: string; symbol: string; horizon: string; evidence_grade: string }> = await resp.json();
    const cache = new Map<string, string>();
    for (const row of rows) {
      cache.set(evidenceCacheKey(row.theme, row.symbol, row.horizon), row.evidence_grade);
    }
    evidenceCache = cache;
    evidenceCacheExpiry = Date.now() + EVIDENCE_CACHE_TTL_MS;
    logger.info('evidence grades loaded', { count: cache.size });
    return cache;
  } catch {
    return evidenceCache ?? new Map();
  }
}

function buildMetaModelInput(
  card: InvestmentIdeaCard,
  context: EventDecisionContext,
): MetaModelInput | null {
  const overlay = context.macroOverlay;
  if (context.vixValue == null) return null;

  return {
    sourceCount: card.symbols?.length ?? 1,
    sourceDiversity: 1.0,
    articleCount: 1,
    hawkesIntensity: card.transmissionStress ?? 0,
    hawkesMomentum: 0,
    vixValue: context.vixValue ?? 20,
    vixZscore: context.vixZscore ?? 0,
    vixMomentum: context.vixMomentum ?? 0,
    yieldSpread: context.yieldSpread ?? 0,
    oilPrice: context.oilPrice ?? 80,
    dollarIndex: context.dollarIndex ?? 100,
    creditSpreadHy: context.creditSpreadHy ?? 4,
    marketStress: context.marketStress ?? 0,
    transmissionStrength: context.transmissionStrength ?? 0,
    eventIntensity: context.eventIntensity ?? 0,
    regimeMultiplier: card.regimeMultiplier ?? 1,
    riskGauge: overlay?.riskGauge ?? 50,
    regimeId: regimeToId(overlay?.state ?? 'balanced'),
  };
}

export async function enrichIdeaCardsWithMetaModel(
  cards: InvestmentIdeaCard[],
  context: EventDecisionContext,
): Promise<InvestmentIdeaCard[]> {
  if (!isMetaModelAvailable() && cards.length > 0) {
    // Try loading once
    const testInput = buildMetaModelInput(cards[0]!, context);
    if (testInput) await predictMetaModel(testInput);
  }

  const grades = await loadEvidenceGrades();

  const enriched: InvestmentIdeaCard[] = [];
  for (const card of cards) {
    const input = buildMetaModelInput(card, context);
    let prediction = null;
    if (input && isMetaModelAvailable()) {
      prediction = await predictMetaModel(input);
    }

    // Lookup evidence grade from cache
    const primarySymbol = card.symbols?.[0]?.symbol ?? '';
    const gradeKey = evidenceCacheKey(card.themeId, primarySymbol, card.timeframe || '2w');
    const grade = grades.get(gradeKey) ?? null;

    enriched.push({
      ...card,
      alphaProb: prediction?.alphaProb ?? null,
      expectedAlpha: prediction?.expectedAlpha ?? null,
      downsideRisk: prediction?.downsideRisk ?? null,
      timeToPeak: prediction?.timeToPeak ?? null,
      evidenceGrade: grade,
    });
  }

  if (enriched.length > 0 && enriched.some(c => c.alphaProb != null)) {
    logger.info('enriched idea cards with meta-model', {
      total: enriched.length,
      withPrediction: enriched.filter(c => c.alphaProb != null).length,
      withGrade: enriched.filter(c => c.evidenceGrade != null).length,
    });
  }

  return enriched;
}
