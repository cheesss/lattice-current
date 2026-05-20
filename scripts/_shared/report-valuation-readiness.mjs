const VALUATION_READINESS_VERSION = 'report-valuation-readiness-v1';

const DEFAULT_BENCHMARK_BY_SECTOR = Object.freeze({
  default: 'SPY',
});

const SECTOR_HINT_RE = /\b(power|grid|utility|electricity|substation|transformer|interconnection|generation|transmission)\b/i;
const TECH_HINT_RE = /\b(ai|ml|cloud|compute|data[-\s]?center|software|saas|accelerator|gpu|chip|semiconductor|wafer)\b/i;
const INDUSTRIAL_HINT_RE = /\b(industrial|manufacturing|machinery|factory|materials?|steel|copper|aluminum|fabrication)\b/i;

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (value === null || value === undefined || value === '') return [];
  return [value];
}

function uniqueSymbols(values = []) {
  const seen = new Set();
  const out = [];
  for (const value of asArray(values).flatMap(asArray)) {
    const symbol = String(value || '').trim().toUpperCase();
    if (!symbol || seen.has(symbol)) continue;
    seen.add(symbol);
    out.push(symbol);
  }
  return out;
}

function round(value, decimals = 4) {
  if (!Number.isFinite(value)) return null;
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function pickSectorBenchmark(themeText = '') {
  if (SECTOR_HINT_RE.test(themeText)) return 'XLU';
  if (TECH_HINT_RE.test(themeText)) return 'QQQ';
  if (INDUSTRIAL_HINT_RE.test(themeText)) return 'XLI';
  return DEFAULT_BENCHMARK_BY_SECTOR.default;
}

function totalReturn(quotes = []) {
  if (!Array.isArray(quotes) || quotes.length < 2) return null;
  const sorted = quotes.slice().sort((a, b) => Date.parse(a.observed_at) - Date.parse(b.observed_at));
  const first = Number(sorted[0]?.last_price);
  const last = Number(sorted[sorted.length - 1]?.last_price);
  if (!Number.isFinite(first) || first <= 0 || !Number.isFinite(last)) return null;
  return (last / first) - 1;
}

function maxDrawdown(quotes = []) {
  if (!Array.isArray(quotes) || quotes.length < 2) return null;
  const sorted = quotes.slice().sort((a, b) => Date.parse(a.observed_at) - Date.parse(b.observed_at));
  let peak = Number(sorted[0]?.last_price);
  let worst = 0;
  for (const quote of sorted) {
    const price = Number(quote?.last_price);
    if (!Number.isFinite(price) || price <= 0) continue;
    if (price > peak) peak = price;
    const drawdown = (price / peak) - 1;
    if (drawdown < worst) worst = drawdown;
  }
  return worst;
}

function dailyReturns(quotes = []) {
  if (!Array.isArray(quotes) || quotes.length < 2) return [];
  const sorted = quotes.slice().sort((a, b) => Date.parse(a.observed_at) - Date.parse(b.observed_at));
  const returns = [];
  for (let i = 1; i < sorted.length; i += 1) {
    const prev = Number(sorted[i - 1]?.last_price);
    const curr = Number(sorted[i]?.last_price);
    if (!Number.isFinite(prev) || prev <= 0 || !Number.isFinite(curr)) continue;
    returns.push((curr / prev) - 1);
  }
  return returns;
}

function realizedVol(quotes = []) {
  const returns = dailyReturns(quotes);
  if (returns.length < 2) return null;
  const mean = returns.reduce((sum, value) => sum + value, 0) / returns.length;
  const variance = returns.reduce((sum, value) => sum + (value - mean) ** 2, 0) / Math.max(1, returns.length - 1);
  return Math.sqrt(variance) * Math.sqrt(252);
}

function ytdRange(now = new Date()) {
  const startOfYear = new Date(Date.UTC(now.getUTCFullYear(), 0, 1));
  return { start: startOfYear, end: now };
}

function windowFromDays(days = 30, now = new Date()) {
  const start = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  return { start, end: now };
}

export async function loadQuoteSeries(client, symbol, { start, end }) {
  if (!client?.query || !symbol) return [];
  const result = await client.query(`
    SELECT observed_at, last_price
      FROM market_quotes
     WHERE symbol = $1
       AND observed_at >= $2
       AND observed_at <= $3
     ORDER BY observed_at ASC
  `, [String(symbol).toUpperCase(), start, end]).catch(() => ({ rows: [] }));
  return Array.isArray(result?.rows) ? result.rows : [];
}

export function computeReturnsProfile(quotes30 = [], quotes90 = [], quotesYtd = []) {
  return {
    return30d: round(totalReturn(quotes30)),
    return90d: round(totalReturn(quotes90)),
    returnYtd: round(totalReturn(quotesYtd)),
    drawdown90d: round(maxDrawdown(quotes90)),
    realizedVol60d: round(realizedVol(quotes90 && quotes90.length ? quotes90 : quotes30)),
  };
}

export function classifyValuationTier({ excessVsSpy90d, excessVsSectorEtf90d, drawdown90d, peVsPeerMedian } = {}) {
  const reasons = [];
  const toFinite = (value) => {
    if (value === null || value === undefined || value === '') return null;
    const num = Number(value);
    return Number.isFinite(num) ? num : null;
  };
  const excessSpy = toFinite(excessVsSpy90d);
  const excessSector = toFinite(excessVsSectorEtf90d);
  const drawdown = toFinite(drawdown90d);
  const peRatio = toFinite(peVsPeerMedian);
  const overheatedByExcess = (excessSpy !== null && excessSpy >= 0.30)
    || (excessSector !== null && excessSector >= 0.30);
  const overheatedByPe = peRatio !== null && peRatio >= 1.5;
  if (overheatedByExcess && (overheatedByPe || peRatio === null)) {
    reasons.push('excess_return_vs_benchmark_above_30pct');
    if (overheatedByPe) reasons.push('pe_vs_peer_median_above_1_5x');
    return { tier: 'overheated', reasons };
  }
  if (excessSpy !== null && excessSpy >= 0.15 && (drawdown === null || drawdown > -0.05)) {
    reasons.push('excess_return_above_15pct_without_meaningful_drawdown');
    return { tier: 'extended', reasons };
  }
  if ((excessSpy !== null && excessSpy <= -0.10) || (peRatio !== null && peRatio <= 0.8)) {
    reasons.push('underperforming_benchmark_or_pe_below_peer_median');
    return { tier: 'cheap', reasons };
  }
  if (excessSpy === null) {
    return { tier: 'unknown', reasons: ['benchmark_excess_return_not_computable'] };
  }
  return { tier: 'fairly_valued', reasons };
}

export async function computeSymbolValuation(client, symbol, options = {}) {
  const now = options.now || new Date();
  const benchmark = options.benchmark || 'SPY';
  const sectorBenchmark = options.sectorBenchmark || null;
  const range30 = windowFromDays(30, now);
  const range90 = windowFromDays(90, now);
  const rangeYtd = ytdRange(now);
  const [quotes30, quotes90, quotesYtd, spy90, sector90] = await Promise.all([
    loadQuoteSeries(client, symbol, range30),
    loadQuoteSeries(client, symbol, range90),
    loadQuoteSeries(client, symbol, rangeYtd),
    loadQuoteSeries(client, benchmark, range90),
    sectorBenchmark ? loadQuoteSeries(client, sectorBenchmark, range90) : Promise.resolve([]),
  ]);
  const returns = computeReturnsProfile(quotes30, quotes90, quotesYtd);
  const spyReturn90 = round(totalReturn(spy90));
  const sectorReturn90 = round(totalReturn(sector90));
  const excessVsSpy90d = Number.isFinite(returns.return90d) && Number.isFinite(spyReturn90)
    ? round(returns.return90d - spyReturn90)
    : null;
  const excessVsSectorEtf90d = Number.isFinite(returns.return90d) && Number.isFinite(sectorReturn90)
    ? round(returns.return90d - sectorReturn90)
    : null;
  return {
    symbol: String(symbol || '').toUpperCase(),
    quoteCount30d: quotes30.length,
    quoteCount90d: quotes90.length,
    quoteCountYtd: quotesYtd.length,
    returns,
    benchmark,
    benchmarkReturn90d: spyReturn90,
    excessVsSpy90d,
    sectorBenchmark,
    sectorReturn90d: sectorReturn90,
    excessVsSectorEtf90d,
  };
}

export async function loadValuationSnapshotFromFmp(symbol, options = {}) {
  const { fmpModule } = options;
  if (!fmpModule || typeof fmpModule.loadValuationSnapshot !== 'function') {
    return { status: 'fmp_not_available', symbol };
  }
  try {
    const snapshot = await fmpModule.loadValuationSnapshot(symbol, options);
    return { status: 'ok', symbol, ...snapshot };
  } catch (error) {
    return { status: 'fmp_error', symbol, error: String(error?.message || error) };
  }
}

export function buildValuationSymbolRow({ symbolReturns = {}, valuationSnapshot = null } = {}) {
  const peTtm = Number(valuationSnapshot?.peTtm);
  const peVsPeerMedian = Number(valuationSnapshot?.peVsPeerMedian);
  const tier = classifyValuationTier({
    excessVsSpy90d: symbolReturns?.excessVsSpy90d,
    excessVsSectorEtf90d: symbolReturns?.excessVsSectorEtf90d,
    drawdown90d: symbolReturns?.returns?.drawdown90d,
    peVsPeerMedian: Number.isFinite(peVsPeerMedian) ? peVsPeerMedian : null,
  });
  const nextAction = tier.tier === 'overheated'
    ? 'flag run-up risk; require entry plan and pullback discipline before promotion'
    : tier.tier === 'extended'
    ? 'monitor for momentum exhaustion; defer sizing until consolidation'
    : tier.tier === 'cheap'
    ? 'check for negative-control or value-trap risk before confirming opportunity'
    : tier.tier === 'unknown'
    ? 'fetch market_quotes coverage and re-evaluate before issuer promotion'
    : 'valuation gate clear; continue evidence-class promotion';
  return {
    symbol: symbolReturns?.symbol,
    returns: symbolReturns?.returns,
    benchmark: symbolReturns?.benchmark,
    benchmarkReturn90d: symbolReturns?.benchmarkReturn90d,
    excessVsSpy90d: symbolReturns?.excessVsSpy90d,
    sectorBenchmark: symbolReturns?.sectorBenchmark,
    sectorReturn90d: symbolReturns?.sectorReturn90d,
    excessVsSectorEtf90d: symbolReturns?.excessVsSectorEtf90d,
    valuation: {
      peTtm: Number.isFinite(peTtm) ? peTtm : null,
      peVsPeerMedian: Number.isFinite(peVsPeerMedian) ? peVsPeerMedian : null,
      forwardEpsGrowth: Number.isFinite(Number(valuationSnapshot?.forwardEpsGrowth)) ? Number(valuationSnapshot.forwardEpsGrowth) : null,
    },
    quoteCount90d: symbolReturns?.quoteCount90d || 0,
    tier: tier.tier,
    tierReasons: tier.reasons,
    nextAction,
  };
}

export function summarizeValuation(rows = []) {
  const tiers = { cheap: 0, fairly_valued: 0, extended: 0, overheated: 0, unknown: 0 };
  for (const row of rows) {
    const key = row?.tier;
    if (key && tiers[key] !== undefined) tiers[key] += 1;
  }
  const overheated = tiers.overheated;
  const extended = tiers.extended;
  const knownCount = rows.filter((row) => row?.tier && row.tier !== 'unknown').length;
  const missingClass = [];
  if (rows.every((row) => !row?.quoteCount90d)) missingClass.push('no_market_quotes');
  if (rows.every((row) => !row?.valuation?.peTtm)) missingClass.push('valuation_external_pending');
  let tier = 'unknown';
  if (knownCount > 0) {
    if (overheated > 0) tier = 'overheated';
    else if (extended > 0) tier = 'extended';
    else if (tiers.cheap > 0 && tiers.cheap >= tiers.fairly_valued) tier = 'cheap';
    else if (tiers.fairly_valued > 0) tier = 'fairly_valued';
    else tier = 'mixed';
  }
  return {
    tier,
    overheatedSymbolCount: overheated,
    extendedSymbolCount: extended,
    cheapSymbolCount: tiers.cheap,
    fairlyValuedSymbolCount: tiers.fairly_valued,
    unknownSymbolCount: tiers.unknown,
    missingClass,
    boundary: missingClass.length
      ? 'valuation lane is partial; gaps remain'
      : 'valuation lane covered across resolved issuer universe',
  };
}

export async function buildReportValuationReadiness(client, artifact = {}, options = {}) {
  const issuerUniverse = uniqueSymbols(options.issuerUniverse
    || artifact?.bundle?.exposedIssuers
    || artifact?.bundle?.symbols
    || []);
  const themeText = String(artifact?.bundle?.subject?.displayName || artifact?.bundle?.theme || options.theme || '');
  const sectorBenchmark = pickSectorBenchmark(themeText);
  if (!issuerUniverse.length) {
    return {
      version: VALUATION_READINESS_VERSION,
      perSymbol: [],
      summary: {
        tier: 'unknown',
        overheatedSymbolCount: 0,
        extendedSymbolCount: 0,
        cheapSymbolCount: 0,
        fairlyValuedSymbolCount: 0,
        unknownSymbolCount: 0,
        missingClass: ['no_issuer_universe'],
        boundary: 'valuation lane idle until issuer universe resolves',
      },
      sectorBenchmark,
      themeHint: themeText || null,
    };
  }
  if (!client?.query) {
    return {
      version: VALUATION_READINESS_VERSION,
      perSymbol: issuerUniverse.map((symbol) => ({
        symbol,
        tier: 'unknown',
        tierReasons: ['no_market_client'],
        quoteCount90d: 0,
        nextAction: 'attach a DB client to compute return profile and tier',
        returns: null,
        valuation: null,
      })),
      summary: {
        tier: 'unknown',
        overheatedSymbolCount: 0,
        extendedSymbolCount: 0,
        cheapSymbolCount: 0,
        fairlyValuedSymbolCount: 0,
        unknownSymbolCount: issuerUniverse.length,
        missingClass: ['no_market_client'],
        boundary: 'valuation lane requires a DB client to compute returns',
      },
      sectorBenchmark,
      themeHint: themeText || null,
    };
  }
  const fmpModule = options.fmpModule || null;
  const perSymbol = [];
  for (const symbol of issuerUniverse) {
    const symbolReturns = await computeSymbolValuation(client, symbol, {
      now: options.now,
      benchmark: options.benchmark || 'SPY',
      sectorBenchmark,
    });
    let valuationSnapshot = null;
    if (fmpModule) {
      const snapshot = await loadValuationSnapshotFromFmp(symbol, { ...options, fmpModule });
      if (snapshot?.status === 'ok') valuationSnapshot = snapshot;
    }
    perSymbol.push(buildValuationSymbolRow({ symbolReturns, valuationSnapshot }));
  }
  return {
    version: VALUATION_READINESS_VERSION,
    perSymbol,
    summary: summarizeValuation(perSymbol),
    sectorBenchmark,
    themeHint: themeText || null,
  };
}
