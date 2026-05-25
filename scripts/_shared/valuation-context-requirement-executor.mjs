import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import crypto from 'node:crypto';
import path from 'node:path';

import {
  normalizeLocalValuationFundamentalRow,
} from './external-data/local-valuation-fundamentals-cache.mjs';
import {
  loadOptionalEnvFile,
  resolveNasPgConfig,
} from './nas-runtime.mjs';

export const VALUATION_CONTEXT_REQUIREMENT_EXECUTOR_VERSION = 'valuation-context-requirement-executor-v1';
export const DEFAULT_VALUATION_CONTEXT_REQUIREMENT_EXECUTOR_PATH = path.join(
  process.cwd(),
  'data',
  'runtime',
  'valuation-context-requirement-executor.latest.json',
);

const TRUSTED_PRICE_CONTEXT_NAMES = [
  'local-market-price-context.latest.json',
  'trusted-local-market-price-context.latest.json',
  'local-price-expectation-context.latest.json',
];

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

function stableHash(value = '') {
  return crypto.createHash('sha1').update(String(value || '')).digest('hex').slice(0, 12);
}

function zeroBoundary(extra = {}) {
  return {
    providerActivationWrites: 0,
    sourceRegistryWrites: 0,
    canonicalWrites: 0,
    readinessPromotionWrites: 0,
    reportCandidateWrites: 0,
    portfolioActionWrites: 0,
    approvalQueueWrites: 0,
    ...extra,
  };
}

function numberOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function round(value, decimals = 4) {
  if (!Number.isFinite(value)) return null;
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function hasPriceContext(row = {}) {
  return numberOrNull(row.localPriceWindow?.excessVsBenchmark90d) !== null
    || numberOrNull(row.localPriceWindow?.excessVsPeerBasket90d) !== null
    || numberOrNull(row.localPriceWindow?.return90d) !== null
    || numberOrNull(row.excessVsBenchmark90d) !== null
    || numberOrNull(row.excessVsPeerBasket90d) !== null
    || numberOrNull(row.return90d) !== null;
}

function hasFundamentalsContext(row = {}) {
  return [
    row.forwardPE,
    row.evToEbitda,
    row.evToSales,
    row.marketCap,
    row.revenue,
    row.peerRelativeMultiple,
    row.peerMedianForwardPE,
    row.peerMedianEVEBITDA,
    row.consensusRevenueGrowth,
    row.consensusEPSGrowth,
    row.revenueGrowth,
    row.backlog,
    row.guidanceRevenue,
    row.operatingMargin,
    row.consensusRevisionDirection,
    row.fundamentalsContext?.revenueGrowth,
    row.fundamentalsContext?.backlog,
    row.fundamentalsContext?.guidanceRevenue,
    row.fundamentalsContext?.operatingMargin,
    row.fundamentalsContext?.consensusRevisionDirection,
  ].some((value) => {
    if (value === null || value === undefined || value === '') return false;
    return typeof value === 'string' ? Boolean(compact(value)) : Number.isFinite(Number(value));
  });
}

function hasAnyValuationContext(row = {}) {
  return hasPriceContext(row) || hasFundamentalsContext(row);
}

function trustedSourceProvenance(value = '') {
  const text = compact(value);
  return Boolean(text)
    && !/rss|source_query|google_news|news_snippet|llm|web_snippet/i.test(text)
    && /trusted|local|cache|valuation|market|fundamental/i.test(text);
}

function isoDate(value = null) {
  if (!value) return '';
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString().slice(0, 10) : compact(value);
}

async function readJson(filePath) {
  if (!existsSync(filePath)) return null;
  try {
    return JSON.parse(await readFile(filePath, 'utf8'));
  } catch {
    return null;
  }
}

export async function readTrustedLocalPriceContextRows(runtimeRoot = path.join(process.cwd(), 'data', 'runtime')) {
  const names = new Set(TRUSTED_PRICE_CONTEXT_NAMES);
  try {
    for (const name of await readdir(runtimeRoot)) {
      if (/^(trusted-)?local-(market-)?price-context\..+\.latest\.json$/i.test(name)) names.add(name);
      if (/^trusted-local-market-price-context\..+\.latest\.json$/i.test(name)) names.add(name);
    }
  } catch {
    // Missing runtime roots are valid in tests and dry-run workspaces.
  }
  const rows = [];
  const sourceFiles = [];
  for (const name of [...names].sort()) {
    const filePath = path.join(runtimeRoot, name);
    const parsed = await readJson(filePath);
    const fileRows = asArray(parsed?.rows || parsed?.data || parsed?.priceContextRows);
    if (!fileRows.length) continue;
    rows.push(...fileRows);
    sourceFiles.push(path.resolve(filePath));
  }
  return { rows, sourceFiles };
}

function returnFromQuotes(quotes = []) {
  const rows = asArray(quotes)
    .filter((row) => numberOrNull(row.last_price ?? row.price) !== null)
    .sort((left, right) => Date.parse(left.observed_at || left.fetched_at || 0) - Date.parse(right.observed_at || right.fetched_at || 0));
  if (rows.length < 2) return null;
  const first = numberOrNull(rows[0].last_price ?? rows[0].price);
  const last = numberOrNull(rows.at(-1)?.last_price ?? rows.at(-1)?.price);
  if (first === null || first <= 0 || last === null) return null;
  return round((last / first) - 1);
}

function realizedVolatility(quotes = []) {
  const rows = asArray(quotes)
    .filter((row) => numberOrNull(row.last_price ?? row.price) !== null)
    .sort((left, right) => Date.parse(left.observed_at || left.fetched_at || 0) - Date.parse(right.observed_at || right.fetched_at || 0));
  if (rows.length < 3) return null;
  const returns = [];
  for (let index = 1; index < rows.length; index += 1) {
    const prev = numberOrNull(rows[index - 1]?.last_price ?? rows[index - 1]?.price);
    const curr = numberOrNull(rows[index]?.last_price ?? rows[index]?.price);
    if (prev !== null && prev > 0 && curr !== null) returns.push((curr / prev) - 1);
  }
  if (returns.length < 2) return null;
  const mean = returns.reduce((sum, value) => sum + value, 0) / returns.length;
  const variance = returns.reduce((sum, value) => sum + (value - mean) ** 2, 0) / Math.max(1, returns.length - 1);
  return round(Math.sqrt(variance) * Math.sqrt(252));
}

function quoteWindowRows(rows = [], symbol = '', days = 90, now = new Date()) {
  const upper = compact(symbol).toUpperCase();
  const cutoff = now.getTime() - days * 24 * 60 * 60 * 1000;
  return asArray(rows).filter((row) => {
    const rowSymbol = compact(row.symbol || row.ticker).toUpperCase();
    const ts = Date.parse(row.observed_at || row.fetched_at || row.created_at || 0);
    return rowSymbol === upper && Number.isFinite(ts) && ts >= cutoff && ts <= now.getTime();
  });
}

function latestQuoteDate(rows = []) {
  return asArray(rows)
    .map((row) => Date.parse(row.observed_at || row.fetched_at || row.created_at || 0))
    .filter(Number.isFinite)
    .sort((left, right) => right - left)[0] || null;
}

function buildMarketQuoteContextRows({ quoteRows = [], issuers = [], peerGroup = [], benchmark = 'SPY', now = new Date() } = {}) {
  const allRows = asArray(quoteRows);
  const benchmark90 = returnFromQuotes(quoteWindowRows(allRows, benchmark, 90, now));
  return uniqueStrings(issuers, 100).map((issuer) => {
    const upper = issuer.toUpperCase();
    const issuer30Rows = quoteWindowRows(allRows, upper, 30, now);
    const issuer90Rows = quoteWindowRows(allRows, upper, 90, now);
    const peerReturns = uniqueStrings(peerGroup, 20)
      .filter((peer) => peer.toUpperCase() !== upper)
      .map((peer) => returnFromQuotes(quoteWindowRows(allRows, peer, 90, now)))
      .filter((value) => value !== null);
    const issuerReturn90 = returnFromQuotes(issuer90Rows);
    const peerMedian = peerReturns.length
      ? peerReturns.slice().sort((left, right) => left - right)[Math.floor(peerReturns.length / 2)]
      : null;
    const latestTs = latestQuoteDate([...issuer30Rows, ...issuer90Rows]);
    return {
      issuer: upper,
      sourceProvenance: 'trusted_local_market_quotes_cache',
      asOfDate: latestTs ? new Date(latestTs).toISOString().slice(0, 10) : '',
      localPriceWindow: {
        return30d: returnFromQuotes(issuer30Rows),
        return90d: issuerReturn90,
        excessVsBenchmark90d: issuerReturn90 !== null && benchmark90 !== null ? round(issuerReturn90 - benchmark90) : null,
        excessVsPeerBasket90d: issuerReturn90 !== null && peerMedian !== null ? round(issuerReturn90 - peerMedian) : null,
        realizedVol60d: realizedVolatility(issuer90Rows),
      },
      peerGroup: uniqueStrings(peerGroup, 20).filter((peer) => peer.toUpperCase() !== upper),
      peerContext: {
        peerGroup: uniqueStrings(peerGroup, 20).filter((peer) => peer.toUpperCase() !== upper),
        peerRelativeMove: issuerReturn90 !== null && peerMedian !== null ? round(issuerReturn90 - peerMedian) : null,
      },
      expectationContextCaveat: 'derived from local market_quotes only; fundamentals may be partial; human review required',
      sourceUrls: ['local:market_quotes'],
    };
  }).filter(hasPriceContext);
}

function metricValue(rows = [], pattern) {
  const found = asArray(rows).find((row) => pattern.test(`${row.metric_name || ''} ${row.source_type || ''} ${JSON.stringify(row.metadata || {})}`));
  return numberOrNull(found?.value_num ?? found?.value);
}

function metricText(rows = [], pattern) {
  const found = asArray(rows).find((row) => pattern.test(`${row.metric_name || ''} ${row.source_type || ''} ${JSON.stringify(row.metadata || {})}`));
  return compact(found?.metadata?.direction || found?.metadata?.commentary || found?.value_text || found?.metric_value_text || '');
}

function buildFundamentalContextRows({ fundamentalRows = [], issuers = [] } = {}) {
  const rows = asArray(fundamentalRows);
  return uniqueStrings(issuers, 100).map((issuer) => {
    const upper = issuer.toUpperCase();
    const issuerRows = rows
      .filter((row) => compact(row.symbol || row.issuer || row.ticker).toUpperCase() === upper)
      .sort((left, right) => Date.parse(right.period_end || right.created_at || 0) - Date.parse(left.period_end || left.created_at || 0));
    if (!issuerRows.length) return null;
    const latestDate = issuerRows.find((row) => row.period_end || row.created_at);
    const sourceTypes = uniqueStrings(issuerRows.map((row) => row.source_type || row.sourceProvenance), 20);
    const context = {
      issuer: upper,
      sourceProvenance: sourceTypes.some((source) => /trusted|local|cache/i.test(source))
        ? 'trusted_local_fundamentals_cache'
        : 'trusted_local_company_fundamentals_cache',
      asOfDate: isoDate(latestDate?.period_end || latestDate?.created_at),
      revenueGrowth: metricValue(issuerRows, /revenue.*growth|sales.*growth|growth.*revenue/i),
      backlog: metricValue(issuerRows, /backlog|order.?book|orders/i),
      guidanceRevenue: metricValue(issuerRows, /guidance.*revenue|revenue.*guidance/i),
      operatingMargin: metricValue(issuerRows, /operating.*margin|margin.*operating/i),
      forwardPE: metricValue(issuerRows, /forward.*p\/?e|forward.*pe/i),
      evToEbitda: metricValue(issuerRows, /ev.*ebitda|enterprise.*ebitda/i),
      evToSales: metricValue(issuerRows, /ev.*sales|enterprise.*sales/i),
      marketCap: metricValue(issuerRows, /market.*cap|market.*capitalization/i),
      revenue: metricValue(issuerRows, /^revenue$|sales/i),
      consensusRevenueGrowth: metricValue(issuerRows, /consensus.*revenue.*growth|revenue.*growth.*consensus/i),
      consensusEPSGrowth: metricValue(issuerRows, /consensus.*eps.*growth|eps.*growth.*consensus/i),
      peerMedianForwardPE: metricValue(issuerRows, /peer.*median.*forward.*p\/?e|peer.*median.*pe/i),
      peerMedianEVEBITDA: metricValue(issuerRows, /peer.*median.*ev.*ebitda/i),
      peerRelativeMultiple: metricText(issuerRows, /peer.*relative|premium|discount/i),
      consensusRevisionDirection: metricText(issuerRows, /consensus.*revision|estimate.*revision/i),
      expectationContextCaveat: 'derived from local company_fundamentals; missing fields are not estimated; human review required',
      sourceUrls: uniqueStrings(issuerRows.map((row) => row.evidence_ref).filter(Boolean), 20),
    };
    return hasFundamentalsContext(context) ? context : null;
  }).filter(Boolean);
}

function peerGroupFromSnapshot(value) {
  if (Array.isArray(value)) return uniqueStrings(value, 20);
  const text = compact(value);
  if (!text) return [];
  return uniqueStrings(text.split(/[,;|]/g), 20).map((peer) => peer.toUpperCase());
}

function buildValuationSnapshotContextRows({ valuationRows = [], issuers = [] } = {}) {
  const rows = asArray(valuationRows);
  return uniqueStrings(issuers, 100).map((issuer) => {
    const upper = issuer.toUpperCase();
    const issuerRows = rows
      .filter((row) => compact(row.symbol || row.issuer || row.ticker).toUpperCase() === upper)
      .sort((left, right) => Date.parse(right.observed_at || right.created_at || 0) - Date.parse(left.observed_at || left.created_at || 0));
    if (!issuerRows.length) return null;
    const latestDate = issuerRows.find((row) => row.observed_at || row.created_at);
    const sourceTypes = uniqueStrings(issuerRows.map((row) => row.source_type || row.sourceProvenance), 20);
    const peerGroup = uniqueStrings(issuerRows.flatMap((row) => peerGroupFromSnapshot(row.peer_group || row.peerGroup)), 20);
    const context = {
      issuer: upper,
      sourceProvenance: sourceTypes.some((source) => /trusted|local|cache/i.test(source))
        ? 'trusted_local_valuation_snapshots_cache'
        : 'trusted_local_valuation_snapshot_cache',
      asOfDate: isoDate(latestDate?.observed_at || latestDate?.created_at),
      forwardPE: metricValue(issuerRows, /forward.*p\/?e|forward.*pe|fwd.*p\/?e/i),
      evToEbitda: metricValue(issuerRows, /ev.*ebitda|enterprise.*ebitda/i),
      evToSales: metricValue(issuerRows, /ev.*sales|enterprise.*sales|ev\/sales/i),
      priceToSales: metricValue(issuerRows, /price.*sales|p\/s/i),
      fcfYield: metricValue(issuerRows, /fcf.*yield|free.*cash.*flow.*yield/i),
      marketCap: metricValue(issuerRows, /market.*cap|market.*capitalization/i),
      peerMedianForwardPE: metricValue(issuerRows, /peer.*median.*forward.*p\/?e|peer.*median.*pe/i),
      peerMedianEVEBITDA: metricValue(issuerRows, /peer.*median.*ev.*ebitda/i),
      peerRelativeMultiple: metricText(issuerRows, /peer.*relative|premium|discount/i),
      premiumDiscountToPeer: metricValue(issuerRows, /premium.*discount|discount.*premium|premium.*peer|discount.*peer/i),
      peerGroup,
      peerContext: {
        peerGroup,
        peerMedianForwardPE: metricValue(issuerRows, /peer.*median.*forward.*p\/?e|peer.*median.*pe/i),
        peerMedianEVEBITDA: metricValue(issuerRows, /peer.*median.*ev.*ebitda/i),
        peerRelativeMultiple: metricText(issuerRows, /peer.*relative|premium|discount/i),
      },
      expectationContextCaveat: 'derived from local valuation_snapshots; missing fields are not estimated; human review required',
      sourceUrls: uniqueStrings(issuerRows.map((row) => row.metadata?.sourceUrl || row.metadata?.source_url || row.source_url).filter(Boolean), 20),
    };
    return hasFundamentalsContext(context) ? context : null;
  }).filter(Boolean);
}

function mergeContextRows(rows = []) {
  const byIssuer = new Map();
  for (const row of asArray(rows).flatMap(asArray)) {
    const issuer = compact(row.issuer || row.ticker || row.symbol).toUpperCase();
    if (!issuer) continue;
    const existing = byIssuer.get(issuer) || { issuer, ticker: issuer };
    const merged = {
      ...existing,
      ...row,
      issuer,
      ticker: issuer,
      sourceProvenance: uniqueStrings([existing.sourceProvenance, row.sourceProvenance], 10).join(';'),
      sourceUrls: uniqueStrings([existing.sourceUrls, row.sourceUrls], 20),
      localPriceWindow: {
        ...(existing.localPriceWindow || {}),
        ...(row.localPriceWindow || {}),
      },
      peerGroup: uniqueStrings([existing.peerGroup, row.peerGroup], 20),
      peerContext: {
        ...(existing.peerContext || {}),
        ...(row.peerContext || {}),
        peerGroup: uniqueStrings([existing.peerContext?.peerGroup, existing.peerGroup, row.peerContext?.peerGroup, row.peerGroup], 20),
      },
      fundamentalsContext: {
        ...(existing.fundamentalsContext || {}),
        ...(row.fundamentalsContext || {}),
      },
      expectationContextCaveat: uniqueStrings([existing.expectationContextCaveat, row.expectationContextCaveat], 10).join('; '),
    };
    byIssuer.set(issuer, merged);
  }
  return [...byIssuer.values()];
}

async function safeQuery(client, sql, params = []) {
  if (!client?.query) return [];
  try {
    const result = await client.query(sql, params);
    return asArray(result?.rows);
  } catch {
    return [];
  }
}

async function createDbClient(pgConfig = null) {
  if (pgConfig === false) return null;
  try {
    loadOptionalEnvFile();
    const pg = await import('pg');
    const Pg = pg.default || pg;
    const config = pgConfig || resolveNasPgConfig();
    const client = new Pg.Client(config);
    await client.connect();
    return client;
  } catch {
    return null;
  }
}

async function readDbMarketQuoteRows(client, symbols = [], now = new Date()) {
  const unique = uniqueStrings(symbols, 120).map((symbol) => symbol.toUpperCase());
  if (!unique.length) return [];
  const start = new Date(now.getTime() - 120 * 24 * 60 * 60 * 1000).toISOString();
  return safeQuery(client, `
    SELECT symbol, observed_at, fetched_at, last_price, provider, currency, change_pct, exchange
      FROM market_quotes
     WHERE symbol = ANY($1::text[])
       AND COALESCE(observed_at, fetched_at) >= $2::timestamptz
       AND last_price IS NOT NULL
     ORDER BY symbol, observed_at ASC NULLS LAST, fetched_at ASC NULLS LAST
  `, [unique, start]);
}

async function readDbCompanyFundamentalRows(client, symbols = []) {
  const unique = uniqueStrings(symbols, 100).map((symbol) => symbol.toUpperCase());
  if (!unique.length) return [];
  return safeQuery(client, `
    SELECT symbol, period_end, metric_name, value_num, unit, source_type, evidence_ref, metadata, created_at
      FROM company_fundamentals
     WHERE symbol = ANY($1::text[])
     ORDER BY symbol, period_end DESC NULLS LAST, created_at DESC NULLS LAST
     LIMIT 500
  `, [unique]);
}

async function readDbValuationSnapshotRows(client, symbols = []) {
  const unique = uniqueStrings(symbols, 100).map((symbol) => symbol.toUpperCase());
  if (!unique.length) return [];
  return safeQuery(client, `
    SELECT symbol, observed_at, metric_name, value_num, peer_group, source_type, metadata, created_at
      FROM valuation_snapshots
     WHERE symbol = ANY($1::text[])
     ORDER BY symbol, observed_at DESC NULLS LAST, created_at DESC NULLS LAST
     LIMIT 500
  `, [unique]);
}

export async function readTrustedLocalDbValuationContextRows({
  issuers = [],
  historicalAnalogueBridge = {},
  sectorPeerDefaults = [],
  benchmark = 'SPY',
  dbClient = null,
  pgConfig = null,
  now = new Date(),
} = {}) {
  const issuerUniverse = uniqueStrings(issuers, 100).map((issuer) => issuer.toUpperCase());
  if (!issuerUniverse.length) return { rows: [], source: 'none', dbReadStatus: 'no_issuers' };
  const peerGroup = uniqueStrings([
    peerBasketFromAnalogue(historicalAnalogueBridge),
    sectorPeerDefaults,
  ], 40).map((issuer) => issuer.toUpperCase());
  const symbols = uniqueStrings([issuerUniverse, peerGroup, benchmark], 160).map((symbol) => symbol.toUpperCase());
  const ownsClient = !dbClient;
  const client = dbClient || await createDbClient(pgConfig);
  if (!client) return { rows: [], source: 'postgres', dbReadStatus: 'db_unavailable' };
  try {
    const [quoteRows, fundamentalRows, valuationSnapshotRows] = await Promise.all([
      readDbMarketQuoteRows(client, symbols, now),
      readDbCompanyFundamentalRows(client, issuerUniverse),
      readDbValuationSnapshotRows(client, issuerUniverse),
    ]);
    const marketRows = buildMarketQuoteContextRows({
      quoteRows,
      issuers: issuerUniverse,
      peerGroup,
      benchmark,
      now,
    });
    const fundamentalsRows = buildFundamentalContextRows({
      fundamentalRows,
      issuers: issuerUniverse,
    });
    const valuationRows = buildValuationSnapshotContextRows({
      valuationRows: valuationSnapshotRows,
      issuers: issuerUniverse,
    });
    const rows = mergeContextRows([...marketRows, ...fundamentalsRows, ...valuationRows]);
    return {
      rows,
      source: 'postgres',
      dbReadStatus: rows.length ? 'context_rows_loaded' : 'no_context_rows',
      marketQuoteRowCount: quoteRows.length,
      companyFundamentalRowCount: fundamentalRows.length,
      valuationSnapshotRowCount: valuationSnapshotRows.length,
    };
  } finally {
    if (ownsClient && typeof client.end === 'function') await client.end().catch(() => {});
  }
}

function acceptedEvidenceIdsForRequirement(requirement = {}) {
  const explicit = uniqueStrings(requirement.acceptedIssuerBridgeEvidenceIds || requirement.acceptedEvidenceIds, 50);
  if (explicit.length) return explicit;
  const issuer = compact(requirement.issuer).toUpperCase();
  if (!issuer || !requirement.seedId) return [];
  return [`gate:${requirement.seedId}:${requirement.trackId || 'issuer_bridge_track'}:issuer_bridge_closed:${issuer}`];
}

function peerBasketFromAnalogue(historicalAnalogueBridge = {}) {
  return uniqueStrings([
    asArray(historicalAnalogueBridge.topScores).flatMap((score) => score.peerBasket || []),
    asArray(historicalAnalogueBridge.scores)
      .filter((score) => asArray(historicalAnalogueBridge.bestAnalogueIds).includes(score.analogueId))
      .flatMap((score) => score.peerBasket || []),
  ], 20).map((issuer) => issuer.toUpperCase());
}

function priceContextForIssuer(priceRows = [], issuer = '') {
  const upper = compact(issuer).toUpperCase();
  return mergeContextRows(asArray(priceRows)
    .filter((row) => compact(row.issuer || row.ticker || row.symbol).toUpperCase() === upper))[0] || null;
}

function buildValuationRowFromRequirement({
  requirement = {},
  priceContext = {},
  historicalAnalogueBridge = {},
  sectorPeerDefaults = [],
  generatedAt = new Date().toISOString(),
} = {}) {
  const issuer = compact(requirement.issuer).toUpperCase();
  const peerGroup = uniqueStrings([
    priceContext.peerContext?.peerGroup,
    priceContext.peerGroup,
    peerBasketFromAnalogue(historicalAnalogueBridge),
    sectorPeerDefaults,
  ], 20).map((peer) => peer.toUpperCase()).filter((peer) => peer !== issuer);
  const row = {
    issuer,
    ticker: issuer,
    roleClass: compact(priceContext.roleClass || requirement.roleClass || 'issuer_operating_bridge_candidate'),
    acceptedIssuerBridgeEvidenceIds: acceptedEvidenceIdsForRequirement(requirement),
    sourceProvenance: compact(priceContext.sourceProvenance || 'trusted_local_market_cache_valuation_context_requirement_executor'),
    asOfDate: compact(priceContext.asOfDate || generatedAt.slice(0, 10)),
    localPriceWindow: {
      return30d: numberOrNull(priceContext.localPriceWindow?.return30d ?? priceContext.return30d),
      return90d: numberOrNull(priceContext.localPriceWindow?.return90d ?? priceContext.return90d),
      ytdReturn: numberOrNull(priceContext.localPriceWindow?.ytdReturn ?? priceContext.ytdReturn),
      excessVsBenchmark30d: numberOrNull(priceContext.localPriceWindow?.excessVsBenchmark30d ?? priceContext.excessVsBenchmark30d),
      excessVsBenchmark90d: numberOrNull(priceContext.localPriceWindow?.excessVsBenchmark90d ?? priceContext.excessVsBenchmark90d),
      excessVsPeerBasket90d: numberOrNull(priceContext.localPriceWindow?.excessVsPeerBasket90d ?? priceContext.excessVsPeerBasket90d),
      realizedVol60d: numberOrNull(priceContext.localPriceWindow?.realizedVol60d ?? priceContext.realizedVol60d),
    },
    peerGroup,
    peerContext: {
      peerGroup,
      peerMedianForwardPE: numberOrNull(priceContext.peerContext?.peerMedianForwardPE ?? priceContext.peerMedianForwardPE),
      peerMedianEVEBITDA: numberOrNull(priceContext.peerContext?.peerMedianEVEBITDA ?? priceContext.peerMedianEVEBITDA),
      peerRelativeMultiple: compact(priceContext.peerContext?.peerRelativeMultiple || priceContext.peerRelativeMultiple || ''),
      peerRelativeMove: numberOrNull(priceContext.peerContext?.peerRelativeMove ?? priceContext.peerRelativeMove),
    },
    forwardPE: numberOrNull(priceContext.forwardPE),
    evToEbitda: numberOrNull(priceContext.evToEbitda),
    evToSales: numberOrNull(priceContext.evToSales),
    priceToSales: numberOrNull(priceContext.priceToSales),
    fcfYield: numberOrNull(priceContext.fcfYield),
    marketCap: numberOrNull(priceContext.marketCap),
    revenue: numberOrNull(priceContext.revenue),
    consensusRevenueGrowth: numberOrNull(priceContext.consensusRevenueGrowth),
    consensusEPSGrowth: numberOrNull(priceContext.consensusEPSGrowth),
    premiumDiscountToPeer: numberOrNull(priceContext.premiumDiscountToPeer),
    consensusRevisionDirection: compact(priceContext.consensusRevisionDirection || ''),
    revenueGrowth: numberOrNull(priceContext.revenueGrowth),
    backlog: numberOrNull(priceContext.backlog),
    guidanceRevenue: numberOrNull(priceContext.guidanceRevenue),
    operatingMargin: numberOrNull(priceContext.operatingMargin),
    expectationContextCaveat: compact(
      priceContext.expectationContextCaveat
      || 'fundamentals_or_consensus_context_missing_trusted_cache; price context only; human review required',
    ),
    valuationContextSourceStatus: hasPriceContext(priceContext) && hasFundamentalsContext(priceContext)
      ? 'valuation_context_complete'
      : 'valuation_context_partial',
    valuationContextExecutionFailureReason: compact(priceContext.valuationContextExecutionFailureReason || ''),
    peerComparisonCaveat: compact(priceContext.peerComparisonCaveat || (peerGroup.length ? '' : 'peer_context_missing')),
    sourceUrls: uniqueStrings(priceContext.sourceUrls || priceContext.sourceUrl || ['local:trusted_market_price_context'], 20),
  };
  return normalizeLocalValuationFundamentalRow(row);
}

function taskForRequirement(requirement = {}, seedContext = {}) {
  const issuer = compact(requirement.issuer).toUpperCase();
  return {
    taskId: `valuation-context-${stableHash(`${requirement.seedId}:${requirement.trackId}:${issuer}`)}`,
    requirementId: requirement.requirementId || null,
    seedId: requirement.seedId || seedContext.seedId || null,
    trackId: requirement.trackId || seedContext.trackId || 'issuer_bridge_track',
    issuer,
    evidenceClass: 'valuation_or_expectation_bridge',
    status: 'pending',
    sourcePolicy: 'trusted_local_market_or_valuation_cache_only',
    mutationBoundary: zeroBoundary(),
  };
}

function targetedProviderBackfillTaskFrom(task = {}, generatedAt = new Date().toISOString()) {
  return {
    taskId: `valuation-provider-backfill-${stableHash(`${task.seedId}:${task.trackId}:${task.issuer}`)}`,
    seedId: task.seedId,
    trackId: task.trackId,
    issuer: task.issuer,
    evidenceClass: 'valuation_or_expectation_bridge',
    providerRoute: 'collect-free-external-data',
    providers: ['fmp', 'polygon'],
    status: 'queued_targeted_provider_backfill',
    command: [
      'node',
      '--import',
      'tsx',
      'scripts/collect-free-external-data.mjs',
      '--providers',
      'fmp,polygon',
      '--symbols',
      task.issuer,
      '--limit',
      '1',
    ],
    sourcePolicy: 'existing_readonly_or_credential_gated_provider_backfill_only',
    reviewBoundary: 'artifact_task_only_no_provider_activation_no_readiness_promotion',
    createdAt: generatedAt,
    mutationBoundary: zeroBoundary(),
  };
}

export function buildValuationContextRequirementTasks({
  valuationContextRotation = {},
  valuationContextAutoLinker = {},
} = {}) {
  const seedContexts = new Map(asArray(valuationContextAutoLinker.seedContexts).map((context) => [
    `${context.seedId || ''}::${context.trackId || 'issuer_bridge_track'}`,
    context,
  ]));
  return asArray(valuationContextRotation.valuationContextRequirements || valuationContextAutoLinker.valuationContextRequirements || valuationContextAutoLinker.fixtureRequirements)
    .filter((requirement) => compact(requirement.requirementType) === 'local_valuation_expectation_context')
    .filter((requirement) => compact(requirement.issuer))
    .map((requirement) => {
      const key = `${requirement.seedId || ''}::${requirement.trackId || 'issuer_bridge_track'}`;
      return { requirement, seedContext: seedContexts.get(key) || {} };
    })
    .filter(({ seedContext }) => seedContext.gateEligible === true)
    .map(({ requirement, seedContext }) => taskForRequirement(requirement, seedContext));
}

export async function runValuationContextRequirementExecutor({
  valuationContextRotation = {},
  valuationContextAutoLinker = {},
  historicalAnalogueBridge = {},
  existingLocalValuationRows = [],
  localPriceContextRows = null,
  dbClient = null,
  pgConfig = null,
  readDbContext = true,
  benchmark = 'SPY',
  runtimeRoot = path.join(process.cwd(), 'data', 'runtime'),
  generatedAt = new Date().toISOString(),
} = {}, {
  writeArtifact = false,
  artifactPath = DEFAULT_VALUATION_CONTEXT_REQUIREMENT_EXECUTOR_PATH,
  cacheArtifactPath = path.join(runtimeRoot, 'trusted-local-valuation-cache.autogenerated.latest.json'),
  mode = 'dry-run',
} = {}) {
  const tasks = buildValuationContextRequirementTasks({ valuationContextRotation, valuationContextAutoLinker });
  const priceRowsPayload = localPriceContextRows
    ? { rows: localPriceContextRows, sourceFiles: [] }
    : await readTrustedLocalPriceContextRows(runtimeRoot);
  const taskIssuers = uniqueStrings(tasks.map((task) => task.issuer), 100);
  const dbRowsPayload = readDbContext && (!localPriceContextRows || taskIssuers.some((issuer) => !priceContextForIssuer(priceRowsPayload.rows, issuer)))
    ? await readTrustedLocalDbValuationContextRows({
      issuers: taskIssuers,
      historicalAnalogueBridge,
      benchmark,
      dbClient,
      pgConfig,
      now: new Date(generatedAt),
    })
    : { rows: [], source: 'postgres', dbReadStatus: 'skipped' };
  const candidateContextRows = mergeContextRows([
    priceRowsPayload.rows,
    dbRowsPayload.rows,
  ]);
  const existingIssuers = new Set(asArray(existingLocalValuationRows).map((row) => compact(row.issuer || row.ticker).toUpperCase()).filter(Boolean));
  const requirementsByKey = new Map(asArray(valuationContextRotation.valuationContextRequirements || valuationContextAutoLinker.fixtureRequirements)
    .map((requirement) => [`${compact(requirement.seedId)}::${compact(requirement.trackId || 'issuer_bridge_track')}::${compact(requirement.issuer).toUpperCase()}`, requirement]));
  const createdRows = [];
  const taskResults = [];
  const missingIssuerFundamentalsAfterExecution = [];
  for (const task of tasks) {
    const requirementKey = `${compact(task.seedId)}::${compact(task.trackId)}::${task.issuer}`;
    const requirement = requirementsByKey.get(requirementKey) || task;
    if (existingIssuers.has(task.issuer)) {
      taskResults.push({ ...task, status: 'skipped_existing_trusted_cache_row' });
      continue;
    }
    const priceContext = priceContextForIssuer(candidateContextRows, task.issuer);
    if (!priceContext || !trustedSourceProvenance(priceContext.sourceProvenance) || !hasAnyValuationContext(priceContext)) {
      missingIssuerFundamentalsAfterExecution.push(task.issuer);
      taskResults.push({
        ...task,
        status: 'valuation_context_source_unavailable',
        failureReason: !priceContext
          ? 'trusted_local_price_context_missing'
          : !trustedSourceProvenance(priceContext.sourceProvenance)
            ? 'untrusted_price_context_source'
            : hasFundamentalsContext(priceContext)
              ? 'local_price_window_missing'
              : 'trusted_local_valuation_context_missing',
      });
      continue;
    }
    const row = buildValuationRowFromRequirement({
      requirement,
      priceContext,
      historicalAnalogueBridge,
      generatedAt,
    });
    if (!row.sourceAllowed || row.validationErrors.length || !hasAnyValuationContext(row)) {
      missingIssuerFundamentalsAfterExecution.push(task.issuer);
      taskResults.push({
        ...task,
        status: 'valuation_context_source_unavailable',
        failureReason: row.validationErrors[0] || 'normalized_price_context_incomplete',
      });
      continue;
    }
    createdRows.push(row);
    taskResults.push({
      ...task,
      status: 'valuation_context_row_created',
      sourceProvenance: row.sourceProvenance,
      asOfDate: row.asOfDate,
      caveated: Boolean(row.expectationContextCaveat),
    });
  }
  const valuationContextSourceStatus = createdRows.length
    ? (missingIssuerFundamentalsAfterExecution.length ? 'partial_context_created' : 'context_created')
    : tasks.length
      ? 'valuation_context_source_unavailable'
      : 'no_valuation_context_requirements';
  const payload = {
    ok: true,
    version: VALUATION_CONTEXT_REQUIREMENT_EXECUTOR_VERSION,
    generatedAt,
    mode,
    taskCount: tasks.length,
    valuationRequirementTasks: taskResults,
    valuationContextRowsCreated: createdRows.length,
    rows: createdRows,
    missingIssuerFundamentalsAfterExecution: uniqueStrings(missingIssuerFundamentalsAfterExecution, 50),
    valuationContextSourceStatus,
    valuationContextExecutionFailureReason: createdRows.length
      ? null
      : (tasks.length ? 'trusted_local_market_or_valuation_context_missing' : null),
    activeValuationBlockedSeed: valuationContextRotation.activeCandidateSeed || valuationContextAutoLinker.candidateSeed || null,
    nextSeedRotationAction: valuationContextRotation.nextEligibleSeed
      ? 'rotate_to_next_eligible_seed'
      : tasks.length && !createdRows.length
        ? 'wait_for_trusted_local_valuation_context_or_new_seed'
        : 're_evaluate_gate_consolidation',
    trustedLocalPriceContextSourceFiles: priceRowsPayload.sourceFiles,
    targetedProviderBackfillTasks: missingIssuerFundamentalsAfterExecution.map((issuer) => (
      targetedProviderBackfillTaskFrom(taskResults.find((task) => task.issuer === issuer) || { issuer }, generatedAt)
    )),
    targetedProviderBackfillTaskCount: missingIssuerFundamentalsAfterExecution.length,
    dbContextRead: {
      enabled: readDbContext === true,
      source: dbRowsPayload.source,
      status: dbRowsPayload.dbReadStatus,
      marketQuoteRowCount: dbRowsPayload.marketQuoteRowCount || 0,
      companyFundamentalRowCount: dbRowsPayload.companyFundamentalRowCount || 0,
      valuationSnapshotRowCount: dbRowsPayload.valuationSnapshotRowCount || 0,
    },
    mutationBoundary: zeroBoundary({
      valuationContextRequirementArtifactWrites: writeArtifact ? 1 : 0,
      valuationContextCacheArtifactWrites: writeArtifact && createdRows.length ? 1 : 0,
    }),
  };
  if (writeArtifact) {
    await mkdir(path.dirname(artifactPath), { recursive: true });
    await writeFile(artifactPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
    payload.artifactPath = path.resolve(artifactPath);
    if (createdRows.length) {
      const cachePayload = {
        version: 'trusted-local-valuation-fundamentals-cache-v1',
        generatedAt,
        sourcePolicy: 'auto-generated from trusted local market price context for accepted issuer bridge seeds; diagnostic only, not recommendation',
        rows: createdRows,
        mutationBoundary: zeroBoundary({
          valuationContextCacheArtifactWrites: 1,
        }),
      };
      await mkdir(path.dirname(cacheArtifactPath), { recursive: true });
      await writeFile(cacheArtifactPath, `${JSON.stringify(cachePayload, null, 2)}\n`, 'utf8');
      payload.cacheArtifactPath = path.resolve(cacheArtifactPath);
    }
  }
  return payload;
}
