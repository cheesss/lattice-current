import type { MarketData, ClusteredEvent, NewsItem } from '@/types';
import type { KeywordGraphSnapshot } from './keyword-registry';
import type { KalmanState } from './math-models/kalman-filter';
import type { MarketRegimeState } from './math-models/regime-model';
import { inferMarketRegime, regimeMultiplierForRelation } from './math-models/regime-model';
import { createKalmanState, updateKalmanState } from './math-models/kalman-filter';
import { getPersistentCache, setPersistentCache } from './persistent-cache';
import { logSourceOpsEvent } from './source-ops-log';

export interface EventMarketTransmissionEdge {
  id: string;
  eventTitle: string;
  eventSource: string;
  eventUrl: string;
  marketSymbol: string;
  marketName: string;
  marketUrl: string;
  relationType: 'commodity' | 'equity' | 'currency' | 'rates' | 'country' | 'supply-chain';
  strength: number;
  rawStrength?: number;
  kalmanStrength?: number;
  regimeMultiplier?: number;
  reason: string;
  keywords: string[];
}

export interface EventMarketTransmissionSnapshot {
  generatedAt: string;
  edges: EventMarketTransmissionEdge[];
  summaryLines: string[];
  regime?: MarketRegimeState | null;
}

const EVENT_MARKET_TRANSMISSION_KEY = 'event-market-transmission:v1';
const MAX_EDGES = 120;

const RELATION_RULES: Array<{
  type: EventMarketTransmissionEdge['relationType'];
  eventTerms: string[];
  marketTerms: string[];
  reason: string;
}> = [
  {
    type: 'commodity',
    eventTerms: ['oil', 'crude', 'hormuz', 'opec', 'lng', 'gas', 'refinery', 'shipping'],
    marketTerms: ['oil', 'energy', 'lng', 'gas', 'crude', 'xle', 'uso'],
    reason: 'Energy or shipping shock likely transmits into oil/gas/energy pricing.',
  },
  {
    type: 'equity',
    eventTerms: ['semiconductor', 'chip', 'export control', 'ai', 'data center', 'cloud'],
    marketTerms: ['nvda', 'amd', 'asml', 'tsm', 'semiconductor', 'cloud', 'tech'],
    reason: 'Technology export or compute shock likely transmits into semiconductor and cloud equities.',
  },
  {
    type: 'supply-chain',
    eventTerms: ['port', 'shipping', 'cable', 'container', 'supply chain', 'freight', 'chokepoint'],
    marketTerms: ['shipping', 'freight', 'logistics', 'port', 'transport'],
    reason: 'Supply-chain disruption likely transmits into logistics and transport pricing.',
  },
  {
    type: 'currency',
    eventTerms: ['sanction', 'tariff', 'trade', 'central bank', 'debt', 'fx'],
    marketTerms: ['usd', 'eur', 'jpy', 'fx', 'dxy', 'currency'],
    reason: 'Macro or trade regime change likely transmits into FX pricing.',
  },
  {
    type: 'rates',
    eventTerms: ['inflation', 'bond', 'yield', 'rates', 'central bank', 'debt'],
    marketTerms: ['bond', 'yield', 'rates', 'treasury'],
    reason: 'Macro shock likely transmits into rates and sovereign debt markets.',
  },
  {
    type: 'country',
    eventTerms: ['iran', 'russia', 'china', 'taiwan', 'ukraine', 'israel', 'qatar'],
    marketTerms: ['defense', 'oil', 'energy', 'shipping', 'fertilizer'],
    reason: 'Country-specific geopolitical escalation likely transmits into exposed sectors.',
  },
];

interface PersistedTransmission {
  snapshot: EventMarketTransmissionSnapshot | null;
  kalmanStates?: Record<string, KalmanState>;
}

let loaded = false;
let currentSnapshot: EventMarketTransmissionSnapshot | null = null;
let currentKalmanStates: Record<string, KalmanState> = {};

function normalize(value: string): string {
  return String(value || '').toLowerCase().replace(/[^\p{L}\p{N}\s\-_.]/gu, ' ').replace(/\s+/g, ' ').trim();
}

async function ensureLoaded(): Promise<void> {
  if (loaded) return;
  loaded = true;
  try {
    const cached = await getPersistentCache<PersistedTransmission>(EVENT_MARKET_TRANSMISSION_KEY);
    currentSnapshot = cached?.data?.snapshot ?? null;
    currentKalmanStates = cached?.data?.kalmanStates ?? {};
  } catch (error) {
    console.warn('[event-market-transmission] load failed', error);
  }
}

async function persist(): Promise<void> {
  await setPersistentCache(EVENT_MARKET_TRANSMISSION_KEY, {
    snapshot: currentSnapshot,
    kalmanStates: currentKalmanStates,
  });
}

function marketUrl(symbol: string): string {
  return `https://finance.yahoo.com/quote/${encodeURIComponent(symbol)}`;
}

function threatBoost(item: NewsItem): number {
  const level = String(item.threat?.level || '').toLowerCase();
  if (level === 'critical') return 20;
  if (level === 'high') return 14;
  if (level === 'medium') return 8;
  if (level === 'low') return 4;
  return 0;
}

function matchRule(eventText: string, marketText: string): {
  type: EventMarketTransmissionEdge['relationType'];
  strength: number;
  reason: string;
  keywords: string[];
} | null {
  let best: ReturnType<typeof matchRule> = null;
  for (const rule of RELATION_RULES) {
    const matchedEventTerms = rule.eventTerms.filter((term) => eventText.includes(term));
    if (matchedEventTerms.length === 0) continue;
    const matchedMarketTerms = rule.marketTerms.filter((term) => marketText.includes(term));
    if (matchedMarketTerms.length === 0) continue;
    const strength = Math.min(100, 30 + matchedEventTerms.length * 18 + matchedMarketTerms.length * 14);
    if (!best || strength > best.strength) {
      best = {
        type: rule.type,
        strength,
        reason: rule.reason,
        keywords: [...matchedEventTerms.slice(0, 3), ...matchedMarketTerms.slice(0, 3)],
      };
    }
  }
  return best;
}

export async function recomputeEventMarketTransmission(args: {
  news: NewsItem[];
  clusters: ClusteredEvent[];
  markets: MarketData[];
  keywordGraph?: KeywordGraphSnapshot | null;
}): Promise<EventMarketTransmissionSnapshot> {
  await ensureLoaded();

  const eventCandidates = [
    ...args.clusters.slice(0, 40).map((cluster) => ({
      title: cluster.primaryTitle,
      source: cluster.primarySource || 'cluster',
      url: cluster.primaryLink || '',
      text: normalize([
        cluster.primaryTitle,
        cluster.primarySource,
        ...(cluster.relations?.evidence || []),
      ].join(' ')),
      boost: (cluster.isAlert ? 15 : 0) + cluster.sourceCount * 5,
    })),
    ...args.news.slice(0, 80).map((item) => ({
      title: item.title,
      source: item.source,
      url: item.link,
      text: normalize([
        item.title,
        item.source,
        item.locationName || '',
        item.threat?.level || '',
      ].join(' ')),
      boost: (item.isAlert ? 15 : 0) + threatBoost(item),
    })),
  ]
    .filter((item) => item.title && item.url)
    .slice(0, 100);

  const graphHints = new Set((args.keywordGraph?.nodes || []).slice(0, 32).map((node) => normalize(node.term)));
  const regime = inferMarketRegime({
    markets: args.markets,
    clusters: args.clusters,
    news: args.news,
    previous: currentSnapshot?.regime ?? null,
  });
  const markets = args.markets
    .slice()
    .sort((a, b) => Math.abs(b.change || 0) - Math.abs(a.change || 0))
    .slice(0, 24);

  const edges: EventMarketTransmissionEdge[] = [];
  for (const event of eventCandidates) {
    for (const market of markets) {
      const marketText = normalize(`${market.symbol} ${market.name || ''} ${market.display || ''}`);
      const matched = matchRule(event.text, marketText);
      if (!matched) continue;
      const graphBonus = matched.keywords.some((keyword) => graphHints.has(normalize(keyword))) ? 8 : 0;
      const moveBonus = Math.min(18, Math.round(Math.abs(market.change || 0) * 3));
      const rawStrength = Math.max(1, Math.min(100, matched.strength + moveBonus + event.boost + graphBonus));
      const regimeMultiplier = regimeMultiplierForRelation(regime, matched.type);
      const measurement = Math.max(1, Math.min(100, rawStrength * regimeMultiplier));
      const kalmanState = updateKalmanState(
        currentKalmanStates[`${event.title}::${market.symbol}`.toLowerCase()] ?? createKalmanState(measurement, { processNoise: 1.2, measurementNoise: 5.6 }),
        measurement,
        { processNoise: 1.2, measurementNoise: 5.6 },
      );
      currentKalmanStates[`${event.title}::${market.symbol}`.toLowerCase()] = kalmanState;
      const strength = Math.max(1, Math.min(100, Math.round(kalmanState.x)));
      edges.push({
        id: `${event.title}::${market.symbol}`.toLowerCase(),
        eventTitle: event.title,
        eventSource: event.source,
        eventUrl: event.url,
        marketSymbol: market.symbol,
        marketName: market.name || market.symbol,
        marketUrl: marketUrl(market.symbol),
        relationType: matched.type,
        strength,
        rawStrength,
        kalmanStrength: Number(kalmanState.x.toFixed(2)),
        regimeMultiplier: Number(regimeMultiplier.toFixed(3)),
        reason: `${matched.reason} Regime=${regime.label} (${regime.confidence}) adjusted via Kalman smoothing.`,
        keywords: matched.keywords,
      });
    }
  }

  const deduped = new Map<string, EventMarketTransmissionEdge>();
  for (const edge of edges) {
    const previous = deduped.get(edge.id);
    if (!previous || edge.strength > previous.strength) {
      deduped.set(edge.id, edge);
    }
  }

  const sorted = Array.from(deduped.values())
    .sort((a, b) => b.strength - a.strength)
    .slice(0, MAX_EDGES);

  currentSnapshot = {
    generatedAt: new Date().toISOString(),
    regime,
    edges: sorted,
    summaryLines: sorted.slice(0, 8).map((edge) =>
      `${edge.eventTitle} -> ${edge.marketSymbol} (${edge.relationType}, ${edge.strength}, regime=${regime.id})`,
    ),
  };
  await persist();
  await logSourceOpsEvent({
    kind: 'transmission',
    action: 'recomputed',
    actor: 'system',
    title: 'Event-market transmission updated',
    detail: `edges=${sorted.length}`,
    status: 'ok',
    category: 'transmission',
  });
  return currentSnapshot;
}

export async function getEventMarketTransmissionSnapshot(): Promise<EventMarketTransmissionSnapshot | null> {
  await ensureLoaded();
  return currentSnapshot;
}
