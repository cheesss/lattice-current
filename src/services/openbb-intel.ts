import { COMMODITIES, CRYPTO_MAP, MARKET_SYMBOLS } from '@/config';
import { fetchCrypto, fetchMultipleStocks } from '@/services/market';
import { toRuntimeUrl } from '@/services/runtime';
import type { ClusteredEvent, MarketData, NewsItem } from '@/types';

export type CrossAssetClass = 'index' | 'equity' | 'commodity' | 'crypto' | 'fx' | 'rate';

export interface CrossAssetTapeRow {
  symbol: string;
  name: string;
  assetClass: CrossAssetClass;
  price: number;
  prevClose: number | null;
  changePct: number;
  changeAbs: number;
  volume: number | null;
  liquidityScore: number;
  volatilityScore: number;
  source: 'openbb' | 'fallback';
}

export interface EventImpactRow {
  id: string;
  title: string;
  region: string;
  impactScore: number;
  confidence: number;
  matchedSymbols: string[];
  marketStress: number;
  sourceCount: number;
  lastUpdated: Date;
  link: string;
}

export interface CountryExposureRow {
  id: string;
  pair: string;
  score: number;
  momentum: number;
  channels: string[];
  evidence: string;
}

export interface OpenbbCoverageSummary {
  commandCount: number;
  commands: string[];
  hasEquityPriceHistorical: boolean;
  hasEquityPriceQuote: boolean;
  hasCryptoPriceHistorical: boolean;
  hasCommodityPriceSpot: boolean;
}

export interface OpenbbIntelSnapshot {
  generatedAt: Date;
  source: 'openbb' | 'fallback';
  coverage: OpenbbCoverageSummary | null;
  tape: CrossAssetTapeRow[];
  eventImpact: EventImpactRow[];
  countryExposure: CountryExposureRow[];
}

interface BuildSnapshotInput {
  allNews: NewsItem[];
  clusters: ClusteredEvent[];
  latestMarkets: MarketData[];
}

export interface OpenbbTapeFetchRow {
  symbol: string;
  price: number;
  prevClose: number | null;
  changePct: number;
  changeAbs: number;
  volume: number | null;
}

export interface OpenbbTapeResponse {
  ok: boolean;
  rows: OpenbbTapeFetchRow[];
  coverage: OpenbbCoverageSummary | null;
  reason?: string;
}

const KEYWORD_TO_SYMBOLS: Array<{ pattern: RegExp; symbols: string[] }> = [
  { pattern: /\b(oil|crude|opec|hormuz|brent)\b/i, symbols: ['CL=F', 'XOM', 'CVX'] },
  { pattern: /\b(gold|bullion|safe haven)\b/i, symbols: ['GC=F'] },
  { pattern: /\b(gas|lng|nat(?:ural)?\s?gas)\b/i, symbols: ['NG=F'] },
  { pattern: /\b(copper|mining|smelter)\b/i, symbols: ['HG=F'] },
  { pattern: /\b(bitcoin|btc|crypto)\b/i, symbols: ['BTC-USD', 'ETH-USD'] },
  { pattern: /\b(semiconductor|chip|foundry|taiwan)\b/i, symbols: ['NVDA', 'TSM'] },
  { pattern: /\b(bank|credit|treasury|bond|yield|fed)\b/i, symbols: ['JPM', '^GSPC', '^DJI'] },
  { pattern: /\b(ai|datacenter|cloud)\b/i, symbols: ['NVDA', 'MSFT', 'AMZN', 'GOOGL'] },
  { pattern: /\b(shipping|red sea|suez|container|freight)\b/i, symbols: ['CL=F', '^VIX'] },
];

const COUNTRY_PAIR_RULES: Array<{
  id: string;
  pair: string;
  leftKeywords: string[];
  rightKeywords: string[];
  channels: string[];
}> = [
  {
    id: 'us-cn',
    pair: 'US-CN',
    leftKeywords: ['united states', 'u.s.', 'us', 'washington', 'america'],
    rightKeywords: ['china', 'beijing', 'prc'],
    channels: ['trade', 'chips', 'rates'],
  },
  {
    id: 'us-ir',
    pair: 'US-IR',
    leftKeywords: ['united states', 'u.s.', 'us', 'washington'],
    rightKeywords: ['iran', 'tehran'],
    channels: ['energy', 'shipping', 'security'],
  },
  {
    id: 'ru-ua',
    pair: 'RU-UA',
    leftKeywords: ['russia', 'moscow', 'kremlin'],
    rightKeywords: ['ukraine', 'kyiv', 'kiev'],
    channels: ['energy', 'grains', 'defense'],
  },
  {
    id: 'cn-tw',
    pair: 'CN-TW',
    leftKeywords: ['china', 'beijing', 'prc'],
    rightKeywords: ['taiwan', 'taipei'],
    channels: ['semiconductors', 'shipping', 'equities'],
  },
  {
    id: 'sa-ir',
    pair: 'SA-IR',
    leftKeywords: ['saudi', 'riyadh', 'saudi arabia'],
    rightKeywords: ['iran', 'tehran'],
    channels: ['oil', 'regional security'],
  },
  {
    id: 'us-eu',
    pair: 'US-EU',
    leftKeywords: ['united states', 'u.s.', 'us', 'washington'],
    rightKeywords: ['european union', 'eu', 'brussels', 'europe'],
    channels: ['rates', 'trade', 'equities'],
  },
];

const OPENBB_COMMANDS = {
  equityHistorical: '/equity/price/historical',
  equityQuote: '/equity/price/quote',
  cryptoHistorical: '/crypto/price/historical',
  commoditySpot: '/commodity/price/spot',
} as const;

function timeoutSignal(timeoutMs: number): AbortSignal {
  if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
    return AbortSignal.timeout(timeoutMs);
  }
  const controller = new AbortController();
  setTimeout(() => controller.abort(), timeoutMs);
  return controller.signal;
}

function toFiniteNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value.replace(/,/g, ''));
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function inferAssetClass(symbol: string): CrossAssetClass {
  if (symbol.startsWith('^')) return 'index';
  if (symbol.endsWith('=F')) return 'commodity';
  if (symbol.endsWith('-USD')) return 'crypto';
  if (symbol.includes('USD') && symbol.length <= 8) return 'fx';
  return 'equity';
}

function inferAssetName(symbol: string): string {
  const market = MARKET_SYMBOLS.find((item) => item.symbol === symbol);
  if (market) return market.name;
  const commodity = COMMODITIES.find((item) => item.symbol === symbol);
  if (commodity) return commodity.name;
  if (symbol === 'BTC-USD') return 'Bitcoin';
  if (symbol === 'ETH-USD') return 'Ethereum';
  return symbol;
}

function computeLiquidityScore(price: number, volume: number | null, assetClass: CrossAssetClass): number {
  const classBaseline: Record<CrossAssetClass, number> = {
    index: 72,
    equity: 64,
    commodity: 58,
    crypto: 52,
    fx: 66,
    rate: 68,
  };
  const volumeBoost = volume && volume > 0 ? Math.min(24, Math.log10(volume + 1) * 4) : 0;
  const priceBoost = Math.min(8, Math.max(0, Math.log10(price + 1) * 2));
  return clamp(Math.round(classBaseline[assetClass] + volumeBoost + priceBoost), 10, 99);
}

function computeVolatilityScore(changePct: number, assetClass: CrossAssetClass): number {
  const classMultiplier: Record<CrossAssetClass, number> = {
    index: 7.5,
    equity: 8.5,
    commodity: 10.5,
    crypto: 13.5,
    fx: 6.0,
    rate: 5.5,
  };
  return clamp(Math.round(Math.abs(changePct) * classMultiplier[assetClass]), 0, 99);
}

function hasCommand(commands: string[], command: string): boolean {
  return commands.includes(command);
}

function buildCoverageSummary(commands: string[]): OpenbbCoverageSummary {
  const deduped = Array.from(new Set(commands.filter(Boolean))).sort();
  return {
    commandCount: deduped.length,
    commands: deduped,
    hasEquityPriceHistorical: hasCommand(deduped, OPENBB_COMMANDS.equityHistorical),
    hasEquityPriceQuote: hasCommand(deduped, OPENBB_COMMANDS.equityQuote),
    hasCryptoPriceHistorical: hasCommand(deduped, OPENBB_COMMANDS.cryptoHistorical),
    hasCommodityPriceSpot: hasCommand(deduped, OPENBB_COMMANDS.commoditySpot),
  };
}

function parseCoverageFromPayload(payload: unknown): OpenbbCoverageSummary | null {
  if (!payload || typeof payload !== 'object') return null;

  const root = payload as Record<string, unknown>;
  const coverageRaw = (root.coverage && typeof root.coverage === 'object')
    ? root.coverage as Record<string, unknown>
    : root;

  const commandsRaw = coverageRaw.commands;
  if (!Array.isArray(commandsRaw)) return null;
  const commands = commandsRaw
    .map((item) => typeof item === 'string' ? item.trim() : '')
    .filter(Boolean);

  if (commands.length === 0) return null;
  return buildCoverageSummary(commands);
}

async function fetchOpenbbCoverage(): Promise<OpenbbCoverageSummary | null> {
  const endpoint = toRuntimeUrl('/api/local-openbb');
  const query = new URLSearchParams({ action: 'coverage' });

  try {
    const response = await fetch(`${endpoint}?${query.toString()}`, {
      method: 'GET',
      signal: timeoutSignal(15000),
    });
    if (!response.ok) return null;
    const payload = await response.json();
    return parseCoverageFromPayload(payload);
  } catch {
    return null;
  }
}

export async function fetchOpenbbPrimaryTape(symbols: string[]): Promise<OpenbbTapeResponse> {
  const endpoint = toRuntimeUrl('/api/local-openbb');
  const query = new URLSearchParams();
  query.set('action', 'tape');
  query.set('batch_size', '18');
  query.set('symbols', symbols.join(','));

  const fallbackCoverage = await fetchOpenbbCoverage();

  let response: Response;
  try {
    response = await fetch(`${endpoint}?${query.toString()}`, {
      method: 'GET',
      signal: timeoutSignal(30000),
    });
  } catch {
    return { ok: false, rows: [], coverage: fallbackCoverage, reason: 'Request failed' };
  }

  if (!response.ok) {
    return { ok: false, rows: [], coverage: fallbackCoverage, reason: `HTTP ${response.status}` };
  }

  let payload: unknown = null;
  try {
    payload = await response.json();
  } catch {
    return { ok: false, rows: [], coverage: fallbackCoverage, reason: 'Invalid JSON response' };
  }

  if (!payload || typeof payload !== 'object') {
    return { ok: false, rows: [], coverage: fallbackCoverage, reason: 'Unexpected payload' };
  }

  const root = payload as Record<string, unknown>;
  const rowsRaw = root.rows;
  const coverage = parseCoverageFromPayload(payload) ?? fallbackCoverage;

  if (!Array.isArray(rowsRaw)) {
    return {
      ok: false,
      rows: [],
      coverage,
      reason: typeof root.reason === 'string' ? root.reason : 'No rows',
    };
  }

  const rows = rowsRaw
    .map((row) => {
      if (!row || typeof row !== 'object') return null;
      const item = row as Record<string, unknown>;
      const symbol = typeof item.symbol === 'string' ? item.symbol.trim() : '';
      const price = toFiniteNumber(item.price);
      const changePct = toFiniteNumber(item.changePct) ?? 0;
      const changeAbs = toFiniteNumber(item.changeAbs) ?? 0;
      const prevClose = toFiniteNumber(item.prevClose);
      const volume = toFiniteNumber(item.volume);
      if (!symbol || price === null) return null;
      return {
        symbol,
        price,
        prevClose,
        changePct,
        changeAbs,
        volume,
      };
    })
    .filter((row): row is NonNullable<typeof row> => Boolean(row));

  return {
    ok: rows.length > 0,
    rows,
    coverage,
    reason: rows.length > 0 ? undefined : (typeof root.reason === 'string' ? root.reason : 'No rows'),
  };
}

async function buildFallbackTape(latestMarkets: MarketData[]): Promise<CrossAssetTapeRow[]> {
  const fallbackRows: CrossAssetTapeRow[] = [];
  const seen = new Set<string>();

  for (const row of latestMarkets) {
    if (row.price == null || row.change == null || seen.has(row.symbol)) continue;
    const assetClass = inferAssetClass(row.symbol);
    fallbackRows.push({
      symbol: row.symbol,
      name: row.name || inferAssetName(row.symbol),
      assetClass,
      price: row.price,
      prevClose: null,
      changePct: row.change,
      changeAbs: 0,
      volume: null,
      liquidityScore: computeLiquidityScore(row.price, null, assetClass),
      volatilityScore: computeVolatilityScore(row.change, assetClass),
      source: 'fallback',
    });
    seen.add(row.symbol);
  }

  const commodityRows = await fetchMultipleStocks(COMMODITIES);
  for (const row of commodityRows.data) {
    if (row.price == null || row.change == null || seen.has(row.symbol)) continue;
    const assetClass = inferAssetClass(row.symbol);
    fallbackRows.push({
      symbol: row.symbol,
      name: row.name || inferAssetName(row.symbol),
      assetClass,
      price: row.price,
      prevClose: null,
      changePct: row.change,
      changeAbs: 0,
      volume: null,
      liquidityScore: computeLiquidityScore(row.price, null, assetClass),
      volatilityScore: computeVolatilityScore(row.change, assetClass),
      source: 'fallback',
    });
    seen.add(row.symbol);
  }

  const crypto = await fetchCrypto();
  for (const coin of crypto) {
    const symbol = `${coin.symbol}-USD`;
    if (seen.has(symbol)) continue;
    const assetClass: CrossAssetClass = 'crypto';
    fallbackRows.push({
      symbol,
      name: coin.name,
      assetClass,
      price: coin.price,
      prevClose: null,
      changePct: coin.change,
      changeAbs: 0,
      volume: null,
      liquidityScore: computeLiquidityScore(coin.price, null, assetClass),
      volatilityScore: computeVolatilityScore(coin.change, assetClass),
      source: 'fallback',
    });
    seen.add(symbol);
  }

  return fallbackRows;
}

async function buildCrossAssetTape(latestMarkets: MarketData[]): Promise<{
  source: 'openbb' | 'fallback';
  rows: CrossAssetTapeRow[];
  coverage: OpenbbCoverageSummary | null;
}> {
  const coverage = await fetchOpenbbCoverage();

  const supportsEquity = coverage
    ? (coverage.hasEquityPriceHistorical || coverage.hasEquityPriceQuote)
    : true;
  const supportsCrypto = coverage
    ? coverage.hasCryptoPriceHistorical
    : true;

  const targetSymbols: string[] = [];
  if (supportsEquity) {
    targetSymbols.push(...MARKET_SYMBOLS.slice(0, 18).map((item) => item.symbol));
    targetSymbols.push(...COMMODITIES.map((item) => item.symbol));
  }
  if (supportsCrypto) {
    targetSymbols.push('BTC-USD', 'ETH-USD');
  }

  if (targetSymbols.length > 0) {
    try {
      const openbb = await fetchOpenbbPrimaryTape(targetSymbols);
      if (openbb.ok) {
        const mapped = openbb.rows
          .map((row) => {
            const assetClass = inferAssetClass(row.symbol);
            return {
              symbol: row.symbol,
              name: inferAssetName(row.symbol),
              assetClass,
              price: row.price,
              prevClose: row.prevClose,
              changePct: row.changePct,
              changeAbs: row.changeAbs,
              volume: row.volume,
              liquidityScore: computeLiquidityScore(row.price, row.volume, assetClass),
              volatilityScore: computeVolatilityScore(row.changePct, assetClass),
              source: 'openbb' as const,
            };
          })
          .sort((a, b) => Math.abs(b.changePct) - Math.abs(a.changePct));

        return {
          source: 'openbb',
          rows: mapped,
          coverage: openbb.coverage ?? coverage,
        };
      }
    } catch {
      // OpenBB optional path failed; fallback below.
    }
  }

  const fallbackRows = await buildFallbackTape(latestMarkets);
  fallbackRows.sort((a, b) => Math.abs(b.changePct) - Math.abs(a.changePct));
  return { source: 'fallback', rows: fallbackRows, coverage };
}

function detectRegion(text: string): string {
  const source = text.toLowerCase();
  if (/\b(ukraine|russia|europe|brussels|germany|france|poland)\b/.test(source)) return 'Europe';
  if (/\b(israel|iran|gaza|saudi|yemen|syria|hormuz)\b/.test(source)) return 'Middle East';
  if (/\b(china|taiwan|japan|korea|philippines|south china sea)\b/.test(source)) return 'Asia-Pacific';
  if (/\b(usa|united states|washington|new york|federal reserve)\b/.test(source)) return 'North America';
  if (/\b(brazil|argentina|chile|mexico|latam)\b/.test(source)) return 'Latin America';
  return 'Global';
}

function symbolMatchesHeadline(text: string): string[] {
  const out = new Set<string>();
  for (const rule of KEYWORD_TO_SYMBOLS) {
    if (rule.pattern.test(text)) {
      rule.symbols.forEach((symbol) => out.add(symbol));
    }
  }
  return Array.from(out);
}

function buildEventImpactRows(clusters: ClusteredEvent[], tape: CrossAssetTapeRow[]): EventImpactRow[] {
  if (clusters.length === 0 || tape.length === 0) return [];

  const tapeBySymbol = new Map(tape.map((row) => [row.symbol, row]));
  const now = Date.now();

  const rows: EventImpactRow[] = clusters
    .slice(0, 80)
    .map((cluster) => {
      const threatLevel = cluster.threat?.level ?? 'info';
      const threatWeight = threatLevel === 'critical'
        ? 42
        : threatLevel === 'high'
          ? 34
          : threatLevel === 'medium'
            ? 24
            : 14;
      const recencyHours = Math.max(0, (now - cluster.lastUpdated.getTime()) / (1000 * 60 * 60));
      const recencyBoost = clamp(Math.round(22 - recencyHours * 2), 0, 22);
      const sourceWeight = clamp(cluster.sourceCount * 6, 0, 30);
      const title = `${cluster.primaryTitle} ${(cluster.allItems[0]?.title || '')}`.trim();
      const matchedSymbols = symbolMatchesHeadline(title).filter((symbol) => tapeBySymbol.has(symbol));
      const matchedRows = matchedSymbols.map((symbol) => tapeBySymbol.get(symbol)!);
      const marketStress = matchedRows.length > 0
        ? matchedRows.reduce((sum, row) => sum + Math.abs(row.changePct), 0) / matchedRows.length
        : 0;
      const impactScore = clamp(Math.round(threatWeight + recencyBoost + sourceWeight + marketStress * 8), 0, 100);
      const confidence = clamp(Math.round(35 + sourceWeight + matchedSymbols.length * 12), 0, 99);
      const link = cluster.primaryLink || cluster.allItems[0]?.link || '#';

      return {
        id: cluster.id,
        title: cluster.primaryTitle,
        region: detectRegion(title),
        impactScore,
        confidence,
        matchedSymbols: matchedSymbols.slice(0, 4),
        marketStress: Number(marketStress.toFixed(2)),
        sourceCount: cluster.sourceCount,
        lastUpdated: cluster.lastUpdated,
        link,
      };
    })
    .sort((a, b) => b.impactScore - a.impactScore)
    .slice(0, 40);

  return rows;
}

function countHeadlinesWithKeywords(items: NewsItem[], keywords: string[]): number {
  const normalized = keywords.map((keyword) => keyword.toLowerCase());
  let count = 0;
  for (const item of items) {
    const title = item.title.toLowerCase();
    if (normalized.some((keyword) => title.includes(keyword))) {
      count += 1;
    }
  }
  return count;
}

function countCoMentions(items: NewsItem[], leftKeywords: string[], rightKeywords: string[]): number {
  const left = leftKeywords.map((item) => item.toLowerCase());
  const right = rightKeywords.map((item) => item.toLowerCase());
  let count = 0;
  for (const item of items) {
    const title = item.title.toLowerCase();
    if (left.some((keyword) => title.includes(keyword)) && right.some((keyword) => title.includes(keyword))) {
      count += 1;
    }
  }
  return count;
}

function buildCountryExposureRows(allNews: NewsItem[], tape: CrossAssetTapeRow[]): CountryExposureRow[] {
  if (allNews.length === 0) return [];

  const oilStress = Math.abs(tape.find((row) => row.symbol === 'CL=F')?.changePct ?? 0);
  const goldStress = Math.abs(tape.find((row) => row.symbol === 'GC=F')?.changePct ?? 0);
  const vixStress = Math.abs(tape.find((row) => row.symbol === '^VIX')?.changePct ?? 0);
  const stressComposite = oilStress * 1.3 + goldStress + vixStress * 0.9;

  return COUNTRY_PAIR_RULES
    .map((rule) => {
      const leftMentions = countHeadlinesWithKeywords(allNews, rule.leftKeywords);
      const rightMentions = countHeadlinesWithKeywords(allNews, rule.rightKeywords);
      const coMentions = countCoMentions(allNews, rule.leftKeywords, rule.rightKeywords);
      const base = coMentions * 18 + Math.sqrt(leftMentions * rightMentions) * 6;
      const score = clamp(Math.round(base + stressComposite * 2.2), 0, 100);
      const momentum = clamp(Math.round(stressComposite * 6 + coMentions * 8), 0, 100);
      const evidence = `${coMentions} co-mentions | ${leftMentions}/${rightMentions} bilateral mentions`;

      return {
        id: rule.id,
        pair: rule.pair,
        score,
        momentum,
        channels: rule.channels,
        evidence,
      };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 18);
}

export async function buildOpenbbIntelSnapshot(input: BuildSnapshotInput): Promise<OpenbbIntelSnapshot> {
  const { source, rows, coverage } = await buildCrossAssetTape(input.latestMarkets);
  const tape = rows.slice(0, 64);
  const eventImpact = buildEventImpactRows(input.clusters, tape);
  const countryExposure = buildCountryExposureRows(input.allNews, tape);

  return {
    generatedAt: new Date(),
    source,
    coverage,
    tape,
    eventImpact,
    countryExposure,
  };
}

export function getCryptoDefaultSymbols(): string[] {
  return Object.keys(CRYPTO_MAP);
}
