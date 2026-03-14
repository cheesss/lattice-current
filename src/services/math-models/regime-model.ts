import type { ClusteredEvent, MarketData, NewsItem } from '@/types';

export type MarketRegimeId = 'risk-on' | 'risk-off' | 'inflation-shock' | 'deflation-bust';

export interface MarketRegimeState {
  id: MarketRegimeId;
  label: string;
  confidence: number;
  scores: Record<MarketRegimeId, number>;
  features: {
    vixChange: number;
    oilChange: number;
    gasChange: number;
    goldChange: number;
    equityChange: number;
    techChange: number;
    warIntensity: number;
    inflationPressure: number;
    growthStress: number;
    policyStress: number;
  };
  relationMultipliers: Record<string, number>;
  notes: string[];
  generatedAt: string;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function normalize(value: string): string {
  return String(value || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s\-_.]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function average(values: number[]): number {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function marketChange(markets: MarketData[], symbols: string[]): number {
  const matched = markets
    .filter((market) => symbols.includes(market.symbol))
    .map((market) => market.change)
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
  return matched.length ? average(matched) : 0;
}

function tokenPressure(texts: string[], patterns: RegExp[]): number {
  if (!texts.length) return 0;
  let matches = 0;
  for (const text of texts) {
    if (patterns.some((pattern) => pattern.test(text))) matches += 1;
  }
  return matches / texts.length;
}

function buildRelationMultipliers(id: MarketRegimeId, confidence: number): Record<string, number> {
  const confidenceAdj = 1 + confidence / 300;
  const base: Record<MarketRegimeId, Record<string, number>> = {
    'risk-on': {
      commodity: 0.94,
      equity: 1.12,
      currency: 0.96,
      rates: 0.94,
      country: 0.98,
      'supply-chain': 0.98,
    },
    'risk-off': {
      commodity: 1.06,
      equity: 0.9,
      currency: 1.08,
      rates: 1.02,
      country: 1.12,
      'supply-chain': 1.08,
    },
    'inflation-shock': {
      commodity: 1.22,
      equity: 0.92,
      currency: 1.08,
      rates: 1.18,
      country: 1.1,
      'supply-chain': 1.14,
    },
    'deflation-bust': {
      commodity: 0.88,
      equity: 0.9,
      currency: 1.04,
      rates: 1.16,
      country: 1.06,
      'supply-chain': 1.02,
    },
  };
  const multipliers = base[id];
  return Object.fromEntries(
    Object.entries(multipliers).map(([key, value]) => [key, Number((1 + (value - 1) * confidenceAdj).toFixed(3))]),
  );
}

export function inferMarketRegime(args: {
  markets: MarketData[];
  clusters?: ClusteredEvent[];
  news?: NewsItem[];
  previous?: MarketRegimeState | null;
}): MarketRegimeState {
  const markets = args.markets || [];
  const texts = [
    ...(args.clusters || []).slice(0, 48).map((cluster) =>
      normalize([cluster.primaryTitle, ...(cluster.relations?.evidence || []), cluster.threat?.level || ''].join(' ')),
    ),
    ...(args.news || []).slice(0, 64).map((item) =>
      normalize([item.title, item.source, item.locationName || '', item.threat?.level || ''].join(' ')),
    ),
  ].filter(Boolean);

  const vixChange = marketChange(markets, ['^VIX']);
  const oilChange = marketChange(markets, ['CL=F']);
  const gasChange = marketChange(markets, ['NG=F']);
  const goldChange = marketChange(markets, ['GC=F']);
  const equityChange = marketChange(markets, ['^GSPC', '^DJI']);
  const techChange = marketChange(markets, ['^IXIC', 'NVDA', 'TSM', 'SMH', 'XLK']);

  const warIntensity = tokenPressure(texts, [/\b(war|strike|missile|navy|drone|attack|mine|hormuz|escort)\b/]);
  const inflationPressure = tokenPressure(texts, [/\b(inflation|oil|energy|gas|yield|rates|tariff|shipping shock)\b/]);
  const growthStress = tokenPressure(texts, [/\b(recession|slowdown|layoffs|demand slump|bankruptcy|shutdown)\b/]);
  const policyStress = tokenPressure(texts, [/\b(central bank|fed|ecb|rate cut|rate hike|treasury|bond)\b/]);

  const scores: Record<MarketRegimeId, number> = {
    'risk-on':
      Math.max(0, -vixChange * 5)
      + Math.max(0, equityChange * 9)
      + Math.max(0, techChange * 11)
      + Math.max(0, -growthStress * 16)
      + Math.max(0, -warIntensity * 12),
    'risk-off':
      Math.max(0, vixChange * 7)
      + Math.max(0, -equityChange * 10)
      + Math.max(0, -techChange * 11)
      + warIntensity * 22
      + policyStress * 8,
    'inflation-shock':
      Math.max(0, oilChange * 11)
      + Math.max(0, gasChange * 9)
      + inflationPressure * 24
      + warIntensity * 14
      + Math.max(0, goldChange * 4),
    'deflation-bust':
      Math.max(0, -oilChange * 8)
      + Math.max(0, -equityChange * 8)
      + growthStress * 26
      + policyStress * 12
      + Math.max(0, vixChange * 4),
  };

  let selected = (Object.entries(scores).sort((a, b) => b[1] - a[1])[0]?.[0] as MarketRegimeId) || 'risk-off';
  const sortedScores = Object.values(scores).sort((a, b) => b - a);
  const rawConfidence = clamp(42 + ((sortedScores[0] ?? 0) - (sortedScores[1] || 0)) * 2.4, 28, 94);

  if (args.previous && args.previous.id !== selected) {
    const prevScore = scores[args.previous.id];
    if (prevScore >= scores[selected] * 0.94) {
      selected = args.previous.id;
    }
  }

  const confidence = clamp(rawConfidence + (args.previous?.id === selected ? 6 : 0), 28, 96);
  const relationMultipliers = buildRelationMultipliers(selected, confidence);
  const notes: string[] = [];
  if (selected === 'inflation-shock') notes.push('Energy and shipping shocks dominate cross-asset reaction.');
  if (selected === 'risk-off') notes.push('Volatility bid and equity drawdown regime active.');
  if (selected === 'risk-on') notes.push('Growth/tech beta regime outweighs macro stress.');
  if (selected === 'deflation-bust') notes.push('Growth stress and falling cyclicals dominate transmission.');

  return {
    id: selected,
    label: selected.replace(/-/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase()),
    confidence: Math.round(confidence),
    scores: Object.fromEntries(
      Object.entries(scores).map(([key, value]) => [key, Number(value.toFixed(2))]),
    ) as Record<MarketRegimeId, number>,
    features: {
      vixChange: Number(vixChange.toFixed(2)),
      oilChange: Number(oilChange.toFixed(2)),
      gasChange: Number(gasChange.toFixed(2)),
      goldChange: Number(goldChange.toFixed(2)),
      equityChange: Number(equityChange.toFixed(2)),
      techChange: Number(techChange.toFixed(2)),
      warIntensity: Number((warIntensity * 100).toFixed(1)),
      inflationPressure: Number((inflationPressure * 100).toFixed(1)),
      growthStress: Number((growthStress * 100).toFixed(1)),
      policyStress: Number((policyStress * 100).toFixed(1)),
    },
    relationMultipliers,
    notes,
    generatedAt: new Date().toISOString(),
  };
}

export function regimeMultiplierForRelation(
  regime: MarketRegimeState | null | undefined,
  relationType: string,
): number {
  if (!regime) return 1;
  return regime.relationMultipliers[relationType] ?? 1;
}

export function regimeMultiplierForTheme(
  regime: MarketRegimeState | null | undefined,
  themeId: string,
  contextTokens: string[] = [],
): number {
  if (!regime) return 1;
  const blob = normalize([themeId, ...contextTokens].join(' '));
  if (/(oil|lng|gas|shipping|fertilizer|uranium|energy)/.test(blob)) {
    return regimeMultiplierForRelation(regime, 'commodity');
  }
  if (/(chip|semiconductor|cloud|ai|data center|compute|tech)/.test(blob)) {
    return regimeMultiplierForRelation(regime, 'equity');
  }
  if (/(treasury|yield|rates|bond)/.test(blob)) {
    return regimeMultiplierForRelation(regime, 'rates');
  }
  if (/(supply|freight|port|cable|container|logistics)/.test(blob)) {
    return regimeMultiplierForRelation(regime, 'supply-chain');
  }
  return 1;
}
