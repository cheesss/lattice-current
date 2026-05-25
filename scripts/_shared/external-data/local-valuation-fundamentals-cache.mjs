import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

export const LOCAL_VALUATION_FUNDAMENTALS_CACHE_VERSION = 'local-valuation-fundamentals-cache-v1';

const FORBIDDEN_SOURCE_PATTERNS = /rss|web_snippet|market_commentary|google_news|search_result/i;

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

function parseJsonFile(filePath) {
  if (!filePath) return null;
  const resolved = path.resolve(filePath);
  if (!existsSync(resolved)) return null;
  return JSON.parse(readFileSync(resolved, 'utf8'));
}

function numberOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function nestedNumber(row = {}, objectKey = '', field = '') {
  return numberOrNull(row?.[objectKey]?.[field] ?? row[field]);
}

export function normalizeLocalValuationFundamentalRow(row = {}) {
  const sourceProvenance = compact(row.sourceProvenance || row.source || row.provider || '');
  const asOfDate = compact(row.asOfDate || row.multipleAsOfDate || row.consensusAsOfDate || '');
  const ticker = compact(row.ticker || row.issuer || row.symbol || '').toUpperCase();
  const sourceAllowed = Boolean(sourceProvenance)
    && !FORBIDDEN_SOURCE_PATTERNS.test(sourceProvenance)
    && /fixture|local|trusted|fundamental|valuation|consensus|peer|cache|internal/i.test(sourceProvenance);
  const normalized = {
    issuer: compact(row.issuer || ticker).toUpperCase(),
    ticker,
    companyName: compact(row.companyName || row.name || ''),
    roleClass: compact(row.roleClass || 'issuer_operating_bridge_candidate'),
    acceptedIssuerBridgeEvidenceIds: uniqueStrings(row.acceptedIssuerBridgeEvidenceIds || row.acceptedEvidenceIds || [], 30),
    sourceProvenance,
    asOfDate,
    revenue: numberOrNull(row.revenue),
    revenueGrowth: numberOrNull(row.revenueGrowth),
    segmentRevenue: numberOrNull(row.segmentRevenue),
    backlog: numberOrNull(row.backlog),
    bookToBill: numberOrNull(row.bookToBill),
    guidanceRevenue: numberOrNull(row.guidanceRevenue),
    guidanceMargin: numberOrNull(row.guidanceMargin),
    operatingMargin: numberOrNull(row.operatingMargin),
    ebitda: numberOrNull(row.ebitda ?? row.EBITDA),
    ebitdaMargin: numberOrNull(row.ebitdaMargin ?? row['EBITDA margin']),
    freeCashFlow: numberOrNull(row.freeCashFlow),
    capex: numberOrNull(row.capex),
    utilityInfrastructureExposure: compact(row.utilityInfrastructureExposure || ''),
    powerDeliveryExposure: compact(row.powerDeliveryExposure || ''),
    transmissionSubstationExposure: compact(row.transmissionSubstationExposure || ''),
    backlogToRevenueCommentary: compact(row.backlogToRevenueCommentary || ''),
    marketCap: numberOrNull(row.marketCap),
    enterpriseValue: numberOrNull(row.enterpriseValue),
    forwardPE: numberOrNull(row.forwardPE),
    evToEbitda: numberOrNull(row.evToEbitda),
    evToSales: numberOrNull(row.evToSales),
    priceToSales: numberOrNull(row.priceToSales),
    fcfYield: numberOrNull(row.fcfYield),
    historicalMultipleBand: compact(row.historicalMultipleBand || ''),
    peerRelativeMultiple: compact(row.peerRelativeMultiple || ''),
    peerRelativeMove: nestedNumber(row, 'peerContext', 'peerRelativeMove'),
    multipleAsOfDate: compact(row.multipleAsOfDate || asOfDate),
    consensusRevenueGrowth: numberOrNull(row.consensusRevenueGrowth),
    consensusEPSGrowth: numberOrNull(row.consensusEPSGrowth),
    consensusEBITDAMargin: numberOrNull(row.consensusEBITDAMargin),
    consensusRevisionDirection: compact(row.consensusRevisionDirection || ''),
    consensusAsOfDate: compact(row.consensusAsOfDate || asOfDate),
    analystExpectationSummary: compact(row.analystExpectationSummary || ''),
    estimateRevisionEvidence: compact(row.estimateRevisionEvidence || ''),
    expectationContextCaveat: compact(row.expectationContextCaveat || row.fundamentalsCaveat || ''),
    valuationContextSourceStatus: compact(row.valuationContextSourceStatus || ''),
    valuationContextExecutionFailureReason: compact(row.valuationContextExecutionFailureReason || ''),
    peerGroup: uniqueStrings(row.peerGroup || [], 20),
    peerMedianForwardPE: numberOrNull(row.peerMedianForwardPE),
    peerMedianEVEBITDA: numberOrNull(row.peerMedianEVEBITDA),
    peerMedianEVSales: numberOrNull(row.peerMedianEVSales),
    premiumDiscountToPeer: numberOrNull(row.premiumDiscountToPeer),
    peerComparisonCaveat: compact(row.peerComparisonCaveat || ''),
    pricedInRisk: Boolean(row.pricedInRisk),
    pricedInRiskEvidence: compact(row.pricedInRiskEvidence || ''),
    contradictory: Boolean(row.contradictory || row.pricedInRisk),
    localPriceWindow: {
      return30d: nestedNumber(row, 'localPriceWindow', 'return30d'),
      return90d: nestedNumber(row, 'localPriceWindow', 'return90d'),
      ytdReturn: nestedNumber(row, 'localPriceWindow', 'ytdReturn'),
      excessVsBenchmark30d: nestedNumber(row, 'localPriceWindow', 'excessVsBenchmark30d'),
      excessVsBenchmark90d: nestedNumber(row, 'localPriceWindow', 'excessVsBenchmark90d'),
      excessVsPeerBasket90d: nestedNumber(row, 'localPriceWindow', 'excessVsPeerBasket90d'),
      realizedVol60d: nestedNumber(row, 'localPriceWindow', 'realizedVol60d'),
    },
    peerContext: {
      peerGroup: uniqueStrings(row.peerContext?.peerGroup || row.peerGroup || [], 20),
      peerMedianForwardPE: numberOrNull(row.peerContext?.peerMedianForwardPE ?? row.peerMedianForwardPE),
      peerMedianEVEBITDA: numberOrNull(row.peerContext?.peerMedianEVEBITDA ?? row.peerMedianEVEBITDA),
      peerRelativeMultiple: compact(row.peerContext?.peerRelativeMultiple || row.peerRelativeMultiple || ''),
      peerRelativeMove: nestedNumber(row, 'peerContext', 'peerRelativeMove'),
    },
    fundamentalsContext: {
      revenueGrowth: numberOrNull(row.fundamentalsContext?.revenueGrowth ?? row.revenueGrowth),
      backlog: numberOrNull(row.fundamentalsContext?.backlog ?? row.backlog),
      segmentRevenue: numberOrNull(row.fundamentalsContext?.segmentRevenue ?? row.segmentRevenue),
      guidanceRevenue: numberOrNull(row.fundamentalsContext?.guidanceRevenue ?? row.guidanceRevenue),
      operatingMargin: numberOrNull(row.fundamentalsContext?.operatingMargin ?? row.operatingMargin),
      consensusRevisionDirection: compact(row.fundamentalsContext?.consensusRevisionDirection || row.consensusRevisionDirection || ''),
    },
    sourceUrls: uniqueStrings(row.sourceUrls || row.sourceUrl || [], 20),
    sourceAllowed,
    validationErrors: uniqueStrings([
      ticker ? null : 'missing_ticker',
      sourceProvenance ? null : 'missing_source_provenance',
      asOfDate ? null : 'missing_as_of_date',
      sourceAllowed ? null : 'untrusted_source_provenance',
    ], 10),
  };
  return normalized;
}

export function loadLocalValuationFundamentalsCache({
  fixturePath = null,
  rows = null,
  issuerUniverse = [],
} = {}) {
  const parsed = rows ? { rows } : parseJsonFile(fixturePath);
  const rawRows = asArray(parsed?.rows || parsed?.data || parsed);
  const normalizedRows = rawRows.map(normalizeLocalValuationFundamentalRow);
  const issuers = uniqueStrings(issuerUniverse, 10).map((issuer) => issuer.toUpperCase());
  const trustedRows = normalizedRows.filter((row) => row.sourceAllowed && row.validationErrors.length === 0 && issuers.includes(row.issuer));
  const rejectedRows = normalizedRows.filter((row) => !trustedRows.includes(row));
  const foundIssuers = new Set(trustedRows.map((row) => row.issuer));
  const missingIssuers = issuers.filter((issuer) => !foundIssuers.has(issuer));
  return {
    ok: true,
    version: LOCAL_VALUATION_FUNDAMENTALS_CACHE_VERSION,
    source: 'trusted_local_cache',
    fixturePath: fixturePath ? path.resolve(fixturePath) : null,
    issuerUniverse: issuers,
    rows: trustedRows,
    rejectedRows,
    missingIssuers,
    rowCount: trustedRows.length,
    sourceProvenance: uniqueStrings(trustedRows.map((row) => row.sourceProvenance), 20),
    asOfDates: uniqueStrings(trustedRows.map((row) => row.asOfDate), 20),
    externalProviderCalls: 0,
    providerActivationWrites: 0,
  };
}
