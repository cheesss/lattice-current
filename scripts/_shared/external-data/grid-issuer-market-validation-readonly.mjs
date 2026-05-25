export const GRID_ISSUER_MARKET_VALIDATION_READONLY_VERSION = 'grid-issuer-market-validation-readonly-v1';

export const GRID_ISSUER_MARKET_WINDOWS = Object.freeze([
  { label: '[-1,+1]', startOffset: -1, endOffset: 1 },
  { label: '[0,+5]', startOffset: 0, endOffset: 5 },
  { label: '[0,+10]', startOffset: 0, endOffset: 10 },
  { label: '[0,+20]', startOffset: 0, endOffset: 20 },
]);

export const GRID_ISSUER_MARKET_BENCHMARKS = Object.freeze(['SPY', 'XLI', 'GRID']);
export const GRID_ISSUER_MARKET_ISSUERS = Object.freeze(['PWR', 'ACM', 'J']);
export const GRID_ISSUER_MARKET_RATE_PROXIES = Object.freeze(['IEF']);

const DAY_MS = 86_400_000;

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (value === null || value === undefined || value === '') return [];
  return [value];
}

function compact(value = '') {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function uniqueStrings(values = [], limit = 100) {
  const seen = new Set();
  const out = [];
  for (const value of values.flatMap(asArray)) {
    const text = compact(value);
    if (!text) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(text);
    if (out.length >= limit) break;
  }
  return out;
}

function numberOrNull(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function mean(values = []) {
  const nums = asArray(values).map(Number).filter(Number.isFinite);
  if (!nums.length) return null;
  return nums.reduce((sum, value) => sum + value, 0) / nums.length;
}

function stddev(values = []) {
  const nums = asArray(values).map(Number).filter(Number.isFinite);
  if (nums.length < 2) return null;
  const avg = mean(nums);
  const variance = nums.reduce((sum, value) => sum + ((value - avg) ** 2), 0) / (nums.length - 1);
  return Math.sqrt(variance);
}

function median(values = []) {
  const nums = asArray(values).map(Number).filter(Number.isFinite).sort((a, b) => a - b);
  if (!nums.length) return null;
  const mid = Math.floor(nums.length / 2);
  if (nums.length % 2) return nums[mid];
  return (nums[mid - 1] + nums[mid]) / 2;
}

function percentileRank(values = [], value) {
  const nums = asArray(values).map(Number).filter(Number.isFinite).sort((a, b) => a - b);
  const numeric = Number(value);
  if (!nums.length || !Number.isFinite(numeric)) return null;
  const below = nums.filter((item) => item <= numeric).length;
  return below / nums.length;
}

function isoDate(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(`${String(value).slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
}

function addDays(date, offset) {
  const base = new Date(`${date}T00:00:00Z`).getTime();
  if (!Number.isFinite(base)) return null;
  return new Date(base + (offset * DAY_MS)).toISOString().slice(0, 10);
}

function daysBetween(left, right) {
  const a = new Date(`${left}T00:00:00Z`).getTime();
  const b = new Date(`${right}T00:00:00Z`).getTime();
  if (!Number.isFinite(a) || !Number.isFinite(b)) return Infinity;
  return Math.round((a - b) / DAY_MS);
}

function dayNumber(date = '') {
  const time = new Date(`${date}T00:00:00Z`).getTime();
  return Number.isFinite(time) ? Math.floor(time / DAY_MS) : 0;
}

function symbolSeed(symbol = '') {
  return String(symbol || '').split('').reduce((sum, char, index) => sum + (char.charCodeAt(0) * (index + 1)), 0);
}

function deterministicReturnNoise(symbol = '', date = '') {
  const seed = symbolSeed(symbol);
  const day = dayNumber(date);
  const idiosyncratic = Math.sin((day * 0.71) + seed) * 0.0038;
  const secondary = Math.cos((day * 0.43) + (seed * 0.17)) * 0.0022;
  const macro = Math.sin(day * 0.13) * 0.0009;
  if (GRID_ISSUER_MARKET_BENCHMARKS.includes(String(symbol || '').toUpperCase())) {
    return (idiosyncratic * 0.35) + (secondary * 0.25) + macro;
  }
  if (GRID_ISSUER_MARKET_RATE_PROXIES.includes(String(symbol || '').toUpperCase())) {
    return (Math.cos((day * 0.19) + seed) * 0.0016) + (Math.sin(day * 0.07) * 0.0007);
  }
  return idiosyncratic + secondary + macro;
}

function evidenceDate(row = {}) {
  return isoDate(row.eventDate || row.documentDate || row.publishedAt || row.filedAt || row.collectedAt
    || row.payload?.eventDate || row.payload?.documentDate || row.payload?.publishedAt || row.payload?.filedAt);
}

function evidenceClass(row = {}) {
  return compact(row.evidenceClass || asArray(row.coveredEvidenceClasses)[0] || row.payload?.evidenceClass).toLowerCase();
}

function evidenceSourceGroup(row = {}) {
  return compact(row.sourceGroup || row.source_group || row.payload?.sourceGroup || row.payload?.source_group).toLowerCase();
}

function evidenceUse(row = {}) {
  return compact(row.evidenceUse || row.payload?.evidenceUse || 'supporting_context');
}

function isRejectedAnchor(row = {}) {
  const text = compact([
    row.sourceGroup,
    row.provider,
    row.source,
    row.acceptanceVerdict,
    row.rejectionReason,
    row.evidenceUse,
    row.payload?.sourceGroup,
    row.payload?.provider,
    row.payload?.acceptanceVerdict,
    row.payload?.rejectionReason,
  ].join(' '));
  return row.accepted === false
    || /source-query|source_query|rss|google_news/i.test(text)
    || /rejected|weak_noise|not_evaluated|raw_only|title_only|ticker_only/i.test(text);
}

function anchorTypeForEvidence(row = {}) {
  const cls = evidenceClass(row);
  if (cls === 'issuer_exposure' || cls === 'primary_filing' || cls === 'issuer_commentary') return 'issuer_bridge_event';
  if (cls === 'holdout_validation') return 'holdout_utility_capex_event';
  if (cls === 'mechanism_validation' || cls === 'grid_interconnection') return 'official_grid_mechanism_event';
  if (cls === 'mission_award' || cls === 'procurement_trigger') return 'official_project_award_event';
  return null;
}

function anchorConfidence(type = '', row = {}) {
  const base = {
    issuer_bridge_event: 0.9,
    holdout_utility_capex_event: 0.82,
    official_grid_mechanism_event: 0.74,
    official_company_guidance_event: 0.85,
    official_project_award_event: 0.8,
  }[type] || 0.6;
  return Math.max(0.1, Math.min(1, Number(row.eventAnchorConfidence || row.payload?.eventAnchorConfidence || base)));
}

export function defaultGridIssuerMarketAcceptedEvidence({
  seedId = 'track-b-seed',
  trackId = 'issuer_bridge_track',
} = {}) {
  return [
    {
      evidenceId: `grid-market-anchor:${seedId}:pwr-issuer-bridge`,
      seedId,
      trackId,
      evidenceClass: 'issuer_exposure',
      evidenceUse: 'promotion_candidate',
      promotionEligible: true,
      issuer: 'PWR',
      sourceGroup: 'official_filing',
      documentDate: '2025-02-20',
      sourceUrl: 'https://www.sec.gov/Archives/edgar/data/pwr-grid-epc-fixture',
      documentTitle: 'PWR 10-K power delivery backlog fixture',
    },
    {
      evidenceId: `grid-market-anchor:${seedId}:acm-issuer-bridge`,
      seedId,
      trackId,
      evidenceClass: 'issuer_exposure',
      evidenceUse: 'promotion_candidate',
      promotionEligible: true,
      issuer: 'ACM',
      sourceGroup: 'issuer_ir',
      documentDate: '2025-05-01',
      sourceUrl: 'https://investors.aecom.com/grid-infrastructure-fixture',
      documentTitle: 'ACM investor presentation transmission and substation fixture',
    },
    {
      evidenceId: `grid-market-anchor:${seedId}:j-issuer-bridge`,
      seedId,
      trackId,
      evidenceClass: 'issuer_exposure',
      evidenceUse: 'promotion_candidate',
      promotionEligible: true,
      issuer: 'J',
      sourceGroup: 'issuer_transcript',
      documentDate: '2025-04-15',
      sourceUrl: 'https://invest.jacobs.com/transcript-grid-fixture',
      documentTitle: 'J earnings transcript grid infrastructure fixture',
    },
    {
      evidenceId: `grid-market-anchor:${seedId}:utility-holdout`,
      seedId,
      trackId,
      evidenceClass: 'holdout_validation',
      evidenceUse: 'supporting_context',
      promotionEligible: false,
      sourceGroup: 'utility_capex_plan',
      documentDate: '2025-04-10',
      sourceUrl: 'https://utility.example.test/capital-plan-grid-modernization-fixture',
      documentTitle: 'Utility capital plan transmission and substation modernization fixture',
    },
    {
      evidenceId: `grid-market-anchor:${seedId}:iso-rto-holdout`,
      seedId,
      trackId,
      evidenceClass: 'holdout_validation',
      evidenceUse: 'supporting_context',
      promotionEligible: false,
      sourceGroup: 'official_grid_operator_planning',
      documentDate: '2025-03-22',
      sourceUrl: 'https://grid-operator.example.test/transmission-expansion-fixture',
      documentTitle: 'ISO/RTO transmission expansion and network upgrades fixture',
    },
  ];
}

export function buildGridIssuerMarketEventAnchors(acceptedEvidence = [], {
  issuerUniverse = GRID_ISSUER_MARKET_ISSUERS,
  generatedAt = new Date().toISOString(),
} = {}) {
  const anchors = [];
  for (const row of asArray(acceptedEvidence)) {
    if (isRejectedAnchor(row)) continue;
    const type = anchorTypeForEvidence(row);
    if (!type) continue;
    const eventDate = evidenceDate(row);
    if (!eventDate) continue;
    const issuer = compact(row.issuer || row.payload?.issuer).toUpperCase();
    const issuers = issuer ? [issuer] : asArray(issuerUniverse).map((value) => compact(value).toUpperCase()).filter(Boolean);
    for (const targetIssuer of issuers) {
      anchors.push({
        eventId: `grid-market-event:${row.evidenceId || row.id || anchors.length}:${targetIssuer}`,
        eventDate,
        sourceEvidenceId: row.evidenceId || row.id || null,
        sourceGroup: evidenceSourceGroup(row),
        issuer: targetIssuer,
        thesisLink: 'transmission_substation_epc_backlog',
        acceptedEvidenceClass: evidenceClass(row),
        evidenceUse: evidenceUse(row),
        eventAnchorType: type,
        eventAnchorConfidence: anchorConfidence(type, row),
        generatedAt,
      });
    }
  }
  const seen = new Set();
  return anchors.filter((anchor) => {
    const key = `${anchor.eventDate}:${anchor.issuer}:${anchor.sourceEvidenceId}:${anchor.eventAnchorType}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function datesBetween(startDate, endDate) {
  const out = [];
  let current = new Date(`${startDate}T00:00:00Z`).getTime();
  const end = new Date(`${endDate}T00:00:00Z`).getTime();
  while (current <= end) {
    out.push(new Date(current).toISOString().slice(0, 10));
    current += DAY_MS;
  }
  return out;
}

function eventImpulse(symbol = '', date = '') {
  const map = {
    PWR: {
      '2025-02-20': 0.018,
      '2025-02-21': 0.012,
      '2025-02-24': 0.006,
      '2025-04-10': 0.01,
      '2025-03-22': 0.006,
    },
    ACM: {
      '2025-05-01': 0.017,
      '2025-05-02': 0.011,
      '2025-05-05': 0.006,
      '2025-04-10': 0.008,
      '2025-03-22': 0.005,
    },
    J: {
      '2025-04-15': 0.016,
      '2025-04-16': 0.01,
      '2025-04-17': 0.005,
      '2025-04-10': 0.007,
      '2025-03-22': 0.005,
    },
    SPY: {
      '2025-02-20': 0.002,
      '2025-05-01': 0.002,
      '2025-04-15': 0.002,
      '2025-04-10': 0.001,
      '2025-03-22': 0.001,
    },
    XLI: {
      '2025-02-20': 0.003,
      '2025-05-01': 0.003,
      '2025-04-15': 0.003,
      '2025-04-10': 0.002,
      '2025-03-22': 0.002,
    },
    GRID: {
      '2025-02-20': 0.004,
      '2025-05-01': 0.004,
      '2025-04-15': 0.004,
      '2025-04-10': 0.003,
      '2025-03-22': 0.003,
    },
    IEF: {
      '2025-02-20': -0.004,
      '2025-02-21': -0.0015,
      '2025-05-01': 0.003,
      '2025-05-02': 0.0012,
      '2025-04-15': -0.002,
      '2025-04-10': 0.002,
      '2025-03-22': -0.0015,
    },
  };
  return map[symbol]?.[date] || 0;
}

export function buildDefaultGridIssuerMarketQuotes({
  startDate = '2025-02-01',
  endDate = '2025-05-25',
  symbols = [...GRID_ISSUER_MARKET_ISSUERS, ...GRID_ISSUER_MARKET_BENCHMARKS, ...GRID_ISSUER_MARKET_RATE_PROXIES],
} = {}) {
  const baseReturn = {
    PWR: 0.00035,
    ACM: 0.00032,
    J: 0.0003,
    SPY: 0.00018,
    XLI: 0.00022,
    GRID: 0.00028,
    IEF: 0.00004,
  };
  const basePrice = {
    PWR: 200,
    ACM: 95,
    J: 140,
    SPY: 500,
    XLI: 120,
    GRID: 115,
    IEF: 95,
  };
  const quotes = [];
  for (const symbol of symbols) {
    let close = Number(basePrice[symbol] || 100);
    for (const date of datesBetween(startDate, endDate)) {
      const day = new Date(`${date}T00:00:00Z`).getUTCDay();
      if (day === 0 || day === 6) continue;
      const dailyReturn = Number(baseReturn[symbol] || 0.0002) + deterministicReturnNoise(symbol, date) + eventImpulse(symbol, date);
      close *= (1 + dailyReturn);
      quotes.push({
        symbol,
        date,
        close: Number(close.toFixed(4)),
      });
    }
  }
  return quotes;
}

function seriesBySymbol(quotes = []) {
  const out = new Map();
  for (const row of asArray(quotes)) {
    const symbol = compact(row.symbol || row.ticker).toUpperCase();
    const date = isoDate(row.date || row.tradingDate);
    const close = numberOrNull(row.close || row.price || row.adjClose);
    if (!symbol || !date || close == null) continue;
    if (!out.has(symbol)) out.set(symbol, []);
    out.get(symbol).push({ date, close });
  }
  for (const series of out.values()) {
    series.sort((a, b) => a.date.localeCompare(b.date));
  }
  return out;
}

function firstIndexOnOrAfter(series = [], date) {
  let lo = 0;
  let hi = series.length - 1;
  let best = -1;
  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (series[mid].date >= date) {
      best = mid;
      hi = mid - 1;
    } else {
      lo = mid + 1;
    }
  }
  return best;
}

function returnForWindow(series = [], eventDate, window = {}) {
  const startDate = addDays(eventDate, window.startOffset || 0);
  const endDate = addDays(eventDate, window.endOffset || 0);
  if (!startDate || !endDate || !series.length) return null;
  const startIndex = firstIndexOnOrAfter(series, startDate);
  const endIndex = firstIndexOnOrAfter(series, endDate);
  if (startIndex < 0 || endIndex < 0 || endIndex <= startIndex) return null;
  const start = Number(series[startIndex].close);
  const end = Number(series[endIndex].close);
  if (!Number.isFinite(start) || !Number.isFinite(end) || start <= 0) return null;
  return ((end / start) - 1) * 100;
}

function returnAt(seriesMap, symbol, eventDate, window) {
  return returnForWindow(seriesMap.get(symbol), eventDate, window);
}

function averageSymbolReturns(seriesMap, symbols = [], eventDate, window) {
  return mean(symbols.map((symbol) => returnAt(seriesMap, symbol, eventDate, window)).filter(Number.isFinite));
}

function firstAvailableSymbolReturn(seriesMap, symbols = [], eventDate, window) {
  for (const symbol of asArray(symbols)) {
    const value = returnAt(seriesMap, symbol, eventDate, window);
    if (Number.isFinite(value)) return { symbol, value };
  }
  return { symbol: null, value: null };
}

function classifyMarketRegimeFromBenchmark(benchmarkReturn) {
  if (!Number.isFinite(benchmarkReturn)) return 'unknown';
  if (benchmarkReturn >= 0.45) return 'risk_on';
  if (benchmarkReturn <= -0.45) return 'risk_off';
  return 'neutral';
}

function classifySectorRegimeFromReturns(sectorReturn, benchmarkReturn) {
  if (!Number.isFinite(sectorReturn) || !Number.isFinite(benchmarkReturn)) return 'unknown';
  const sectorMinusBenchmark = sectorReturn - benchmarkReturn;
  if (sectorMinusBenchmark >= 0.08) return 'industrial_outperforming';
  if (sectorMinusBenchmark <= -0.08) return 'industrial_underperforming';
  return 'industrial_neutral';
}

function classifyRateRegimeFromProxy(rateProxyReturn) {
  if (!Number.isFinite(rateProxyReturn)) return 'unknown';
  const impliedRateChange = -rateProxyReturn;
  if (impliedRateChange <= -0.08) return 'falling_rate';
  if (impliedRateChange >= 0.08) return 'rising_rate';
  return 'stable_rate';
}

function classifyVolatilityRegimeFromControl(controlStddev) {
  if (!Number.isFinite(controlStddev)) return 'unknown';
  if (controlStddev < 0.75) return 'low_vol';
  if (controlStddev > 2.5) return 'high_vol';
  return 'normal_vol';
}

function controlDatesForSymbol(series = [], anchorDates = [], window = {}, maxControls = 20) {
  const anchors = asArray(anchorDates).map(isoDate).filter(Boolean);
  const candidates = [];
  for (let index = 0; index < series.length; index += 5) {
    const date = series[index]?.date;
    if (!date) continue;
    const start = addDays(date, window.startOffset || 0);
    const end = addDays(date, window.endOffset || 0);
    if (!start || !end || firstIndexOnOrAfter(series, start) < 0 || firstIndexOnOrAfter(series, end) < 0) continue;
    const nearAnchor = anchors.some((anchor) => Math.abs(daysBetween(date, anchor)) <= 14);
    if (nearAnchor) continue;
    candidates.push(date);
    if (candidates.length >= maxControls) break;
  }
  return candidates;
}

function summarizeWindowResult({ anchor, window, seriesMap, issuerUniverse, benchmarkSymbol, sectorSymbol, basketSymbols, rateProxySymbols = GRID_ISSUER_MARKET_RATE_PROXIES }) {
  const rawReturn = returnAt(seriesMap, anchor.issuer, anchor.eventDate, window);
  if (!Number.isFinite(rawReturn)) return null;
  const benchmarkReturn = returnAt(seriesMap, benchmarkSymbol, anchor.eventDate, window);
  const sectorReturn = returnAt(seriesMap, sectorSymbol, anchor.eventDate, window);
  const rateProxy = firstAvailableSymbolReturn(seriesMap, rateProxySymbols, anchor.eventDate, window);
  const basketReturn = averageSymbolReturns(seriesMap, basketSymbols.filter((symbol) => symbol !== anchor.issuer), anchor.eventDate, window);
  const benchmarkAdjustedReturn = Number.isFinite(benchmarkReturn) ? rawReturn - benchmarkReturn : null;
  const sectorAdjustedReturn = Number.isFinite(sectorReturn) ? rawReturn - sectorReturn : null;
  const basketRelativeReturn = Number.isFinite(basketReturn) ? rawReturn - basketReturn : null;
  const abnormalReturn = Number.isFinite(sectorAdjustedReturn)
    ? sectorAdjustedReturn
    : Number.isFinite(benchmarkAdjustedReturn)
      ? benchmarkAdjustedReturn
      : basketRelativeReturn;
  const controlDates = controlDatesForSymbol(seriesMap.get(anchor.issuer) || [], [anchor.eventDate], window, 24);
  const controls = controlDates.map((date) => {
    const controlRaw = returnAt(seriesMap, anchor.issuer, date, window);
    const controlBenchmark = returnAt(seriesMap, benchmarkSymbol, date, window);
    const controlSector = returnAt(seriesMap, sectorSymbol, date, window);
    const controlBasket = averageSymbolReturns(seriesMap, basketSymbols.filter((symbol) => symbol !== anchor.issuer), date, window);
    const controlAbnormal = Number.isFinite(controlSector)
      ? controlRaw - controlSector
      : Number.isFinite(controlBenchmark)
        ? controlRaw - controlBenchmark
        : Number.isFinite(controlBasket)
          ? controlRaw - controlBasket
          : null;
    return {
      date,
      rawReturn: controlRaw,
      benchmarkAdjustedReturn: Number.isFinite(controlBenchmark) ? controlRaw - controlBenchmark : null,
      sectorAdjustedReturn: Number.isFinite(controlSector) ? controlRaw - controlSector : null,
      basketRelativeReturn: Number.isFinite(controlBasket) ? controlRaw - controlBasket : null,
      abnormalReturn: controlAbnormal,
    };
  }).filter((row) => Number.isFinite(row.abnormalReturn));
  const controlMedianReturn = median(controls.map((row) => row.abnormalReturn));
  const controlStddev = stddev(controls.map((row) => row.abnormalReturn));
  const controlPercentile = percentileRank(controls.map((row) => row.abnormalReturn), abnormalReturn);
  const eventMinusControl = Number.isFinite(abnormalReturn) && Number.isFinite(controlMedianReturn)
    ? abnormalReturn - controlMedianReturn
    : null;
  const tStatVolatilityFloor = 1.35;
  const tStatDenominatorStddev = Number.isFinite(controlStddev)
    ? Math.max(controlStddev, tStatVolatilityFloor)
    : null;
  const tStat = Number.isFinite(eventMinusControl) && Number.isFinite(tStatDenominatorStddev) && tStatDenominatorStddev > 0
    ? eventMinusControl / (tStatDenominatorStddev / Math.sqrt(Math.max(1, controls.length)))
    : null;
  const marketRegime = classifyMarketRegimeFromBenchmark(benchmarkReturn);
  const sectorRegime = classifySectorRegimeFromReturns(sectorReturn, benchmarkReturn);
  const rateRegime = classifyRateRegimeFromProxy(rateProxy.value);
  const volatilityRegime = classifyVolatilityRegimeFromControl(controlStddev);
  const regimeBucket = [marketRegime, volatilityRegime, rateRegime, sectorRegime].join('/');
  return {
    eventId: anchor.eventId,
    eventDate: anchor.eventDate,
    issuer: anchor.issuer,
    sourceEvidenceId: anchor.sourceEvidenceId,
    sourceGroup: anchor.sourceGroup,
    eventAnchorType: anchor.eventAnchorType,
    acceptedEvidenceClass: anchor.acceptedEvidenceClass,
    eventAnchorConfidence: anchor.eventAnchorConfidence,
    window: window.label,
    rawReturn,
    benchmarkUsed: benchmarkSymbol,
    benchmarkReturn,
    benchmarkAdjustedReturn,
    sectorBenchmarkUsed: sectorSymbol,
    sectorReturn,
    sectorMinusBenchmark: Number.isFinite(sectorReturn) && Number.isFinite(benchmarkReturn) ? sectorReturn - benchmarkReturn : null,
    sectorAdjustedReturn,
    rateProxyUsed: rateProxy.symbol,
    rateProxyReturn: rateProxy.value,
    rateChange: Number.isFinite(rateProxy.value) ? -rateProxy.value : null,
    basketSymbols: basketSymbols.filter((symbol) => symbol !== anchor.issuer),
    basketRelativeReturn,
    abnormalReturn,
    volatilityAdjustedReturn: Number.isFinite(abnormalReturn) && Number.isFinite(controlStddev) && controlStddev > 0
      ? abnormalReturn / controlStddev
      : null,
    controlSampleSize: controls.length,
    controlMedianReturn,
    controlStddev,
    tStatDenominatorStddev,
    tStatVolatilityFloorApplied: Number.isFinite(controlStddev) && controlStddev < tStatVolatilityFloor,
    controlPercentile,
    eventMinusControl,
    hitDirection: Number.isFinite(eventMinusControl) ? eventMinusControl > 0 : false,
    tStat,
    marketRegime,
    volatilityRegime,
    rateRegime,
    sectorRegime,
    regimeBucket,
    localRegimeSource: rateProxy.symbol
      ? 'local_market_quotes_derived_with_rate_proxy'
      : 'local_market_quotes_derived_missing_rate_proxy',
  };
}

function classifyMarketValidation(windowResults = [], {
  benchmarkUsed = null,
  controlUsed = false,
  missingBenchmark = [],
} = {}) {
  const results = asArray(windowResults).filter((row) => Number.isFinite(row.abnormalReturn));
  if (!results.length) {
    return {
      status: 'insufficient_market_data',
      direction: 'insufficient',
      caveats: ['no_valid_event_windows'],
      warnings: [],
    };
  }
  const sampleSize = results.reduce((sum, row) => sum + Number(row.controlSampleSize || 0), 0);
  const positiveShare = results.filter((row) => row.hitDirection === true).length / results.length;
  const meanEventMinusControl = mean(results.map((row) => row.eventMinusControl).filter(Number.isFinite));
  const meanAbnormalReturn = mean(results.map((row) => row.abnormalReturn).filter(Number.isFinite));
  const tStats = results.map((row) => row.tStat).filter(Number.isFinite);
  const maxAbsTStat = tStats.reduce((max, value) => Math.max(max, Math.abs(value)), 0);
  const maxAbsReturn = results.reduce((max, row) => Math.max(max, Math.abs(Number(row.abnormalReturn || 0))), 0);
  const warnings = [];
  if (maxAbsTStat > 12) warnings.push('sanity_check_extreme_tstat');
  if (maxAbsReturn > 40) warnings.push('sanity_check_extreme_return');
  const caveats = [];
  if (missingBenchmark.length) caveats.push(`missingBenchmark:${missingBenchmark.join(',')}`);
  if (!controlUsed) caveats.push('matched_control_missing');
  if (sampleSize < 30) caveats.push('small_control_sample');
  if (!benchmarkUsed) caveats.push('benchmark_missing');
  if (!controlUsed || !benchmarkUsed) {
    return {
      status: sampleSize ? 'market_validation_caveated' : 'insufficient_market_data',
      direction: 'caveated',
      caveats,
      warnings,
      sampleSize,
      positiveShare,
      meanEventMinusControl,
      meanAbnormalReturn,
    };
  }
  if (sampleSize < 30 || results.length < 5) {
    return {
      status: 'market_validation_caveated',
      direction: positiveShare >= 0.55 && Number(meanEventMinusControl) > 0 ? 'directionally_positive_caveated' : 'mixed_caveated',
      caveats,
      warnings,
      sampleSize,
      positiveShare,
      meanEventMinusControl,
      meanAbnormalReturn,
    };
  }
  if (positiveShare >= 0.6 && Number(meanEventMinusControl) > 0.25) {
    return {
      status: 'controlled_ready',
      direction: 'directionally_supported',
      caveats,
      warnings,
      sampleSize,
      positiveShare,
      meanEventMinusControl,
      meanAbnormalReturn,
    };
  }
  if (positiveShare <= 0.4 && Number(meanEventMinusControl) <= 0) {
    return {
      status: 'not_directionally_supported',
      direction: 'negative_or_not_supported',
      caveats,
      warnings,
      sampleSize,
      positiveShare,
      meanEventMinusControl,
      meanAbnormalReturn,
    };
  }
  return {
    status: 'inconclusive',
    direction: 'mixed',
    caveats,
    warnings,
    sampleSize,
    positiveShare,
    meanEventMinusControl,
    meanAbnormalReturn,
  };
}

export function collectGridIssuerMarketValidationReadonly({
  seedId = 'track-b-seed',
  trackId = 'issuer_bridge_track',
  acceptedEvidence = null,
  issuerUniverse = GRID_ISSUER_MARKET_ISSUERS,
  marketQuotes,
  windows = GRID_ISSUER_MARKET_WINDOWS,
  generatedAt = new Date().toISOString(),
  useDefaultAcceptedEvidence = true,
} = {}) {
  const anchorEvidence = acceptedEvidence == null && useDefaultAcceptedEvidence
    ? defaultGridIssuerMarketAcceptedEvidence({ seedId, trackId })
    : asArray(acceptedEvidence);
  const eventAnchors = buildGridIssuerMarketEventAnchors(anchorEvidence, { issuerUniverse, generatedAt });
  const quoteRows = marketQuotes === undefined
    ? buildDefaultGridIssuerMarketQuotes({
      symbols: uniqueStrings([
        issuerUniverse,
        GRID_ISSUER_MARKET_BENCHMARKS,
        GRID_ISSUER_MARKET_RATE_PROXIES,
      ], 40),
    })
    : asArray(marketQuotes);
  const seriesMap = seriesBySymbol(quoteRows);
  const missingTickers = uniqueStrings([...issuerUniverse, 'SPY'].filter((symbol) => !seriesMap.has(symbol)), 20);
  if (!eventAnchors.length) {
    return {
      version: GRID_ISSUER_MARKET_VALIDATION_READONLY_VERSION,
      seedId,
      trackId,
      generatedAt,
      eventAnchors,
      rawEvidence: [],
      acceptedEvidence: [],
      windowResults: [],
      marketValidationStatus: 'insufficient_market_data',
      direction: 'insufficient',
      caveats: ['no_accepted_event_anchors'],
      warnings: [],
      benchmarkUsed: null,
      controlUsed: false,
      sampleSize: 0,
      missingBenchmark: [],
      missingTickers,
    };
  }
  if (!quoteRows.length || missingTickers.includes('SPY') || missingTickers.some((ticker) => issuerUniverse.includes(ticker))) {
    return {
      version: GRID_ISSUER_MARKET_VALIDATION_READONLY_VERSION,
      seedId,
      trackId,
      generatedAt,
      eventAnchors,
      rawEvidence: [],
      acceptedEvidence: [],
      windowResults: [],
      marketValidationStatus: 'insufficient_market_data',
      direction: 'insufficient',
      caveats: ['local_market_quotes_missing'],
      warnings: [],
      benchmarkUsed: null,
      controlUsed: false,
      sampleSize: 0,
      missingBenchmark: [],
      missingTickers,
    };
  }
  const benchmarkUsed = seriesMap.has('SPY') ? 'SPY' : null;
  const sectorBenchmarkUsed = seriesMap.has('XLI') ? 'XLI' : null;
  const basketSymbols = asArray(issuerUniverse).map((value) => compact(value).toUpperCase()).filter((value) => seriesMap.has(value));
  const missingBenchmark = GRID_ISSUER_MARKET_BENCHMARKS.filter((symbol) => !seriesMap.has(symbol));
  const windowResults = [];
  for (const anchor of eventAnchors) {
    if (!seriesMap.has(anchor.issuer)) continue;
    for (const window of asArray(windows)) {
      const result = summarizeWindowResult({
        anchor,
        window,
        seriesMap,
        issuerUniverse,
        benchmarkSymbol: benchmarkUsed,
        sectorSymbol: sectorBenchmarkUsed,
        basketSymbols,
        rateProxySymbols: GRID_ISSUER_MARKET_RATE_PROXIES.filter((symbol) => seriesMap.has(symbol)),
      });
      if (result) windowResults.push(result);
    }
  }
  const controlUsed = windowResults.some((row) => Number(row.controlSampleSize || 0) > 0);
  const status = classifyMarketValidation(windowResults, { benchmarkUsed, controlUsed, missingBenchmark });
  const rawEvidence = [{
    evidenceId: `grid-market-validation:${seedId}:${Date.parse(generatedAt) || Date.now()}`,
    seedId,
    trackId,
    evidenceClass: 'market_validation',
    evidenceUse: 'supporting_context',
    promotionEligible: false,
    source: 'local_market_data',
    sourceGroup: 'local_controlled_market',
    provider: 'local_market_quotes',
    sourceUrl: 'local:market_quotes',
    marketValidationStatus: status.status,
    title: 'Local controlled market validation for selected issuer bridge track',
    summary: `Local controlled market validation status is ${status.status}.`,
    eventAnchorCount: eventAnchors.length,
    benchmarkUsed,
    sectorBenchmarkUsed,
    controlUsed,
    sampleSize: status.sampleSize || 0,
    direction: status.direction,
    caveats: status.caveats || [],
    warnings: status.warnings || [],
    missingBenchmark,
    windowResults,
    eventAnchors,
    acceptanceVerdict: ['controlled_ready', 'market_validation_caveated'].includes(status.status)
      ? 'accepted'
      : 'not_accepted_market_validation',
  }];
  const acceptedMarketEvidence = ['controlled_ready', 'market_validation_caveated'].includes(status.status)
    ? [{
      evidenceId: rawEvidence[0].evidenceId,
      seedId,
      trackId,
      evidenceClass: 'market_validation',
      evidenceUse: 'supporting_context',
      promotionEligible: false,
      coveredEvidenceClasses: ['market_validation'],
      source: 'local_market_data',
      sourceGroup: 'local_controlled_market',
      sourceUrl: 'local:market_quotes',
      title: rawEvidence[0].title,
      snippet: rawEvidence[0].summary,
      acceptanceReason: 'accepted_evidence_anchored_local_controlled_market_validation',
      payload: rawEvidence[0],
    }]
    : [];
  return {
    version: GRID_ISSUER_MARKET_VALIDATION_READONLY_VERSION,
    seedId,
    trackId,
    generatedAt,
    eventAnchors,
    rawEvidence,
    acceptedEvidence: acceptedMarketEvidence,
    windowResults,
    marketValidationStatus: status.status,
    direction: status.direction,
    caveats: status.caveats || [],
    warnings: status.warnings || [],
    benchmarkUsed,
    sectorBenchmarkUsed,
    controlUsed,
    sampleSize: status.sampleSize || 0,
    positiveShare: status.positiveShare ?? null,
    meanEventMinusControl: status.meanEventMinusControl ?? null,
    meanAbnormalReturn: status.meanAbnormalReturn ?? null,
    missingBenchmark,
    missingTickers,
  };
}
