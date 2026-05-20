/*
 * Financial Modeling Prep (FMP) adapter.
 *
 * Paid (Starter $19/mo, Premium $49/mo, Pro $99/mo). Adds:
 *   - Income statement / balance sheet / cash flow (5+ years)
 *   - Analyst estimates + revisions
 *   - Peer comparison metrics
 *   - Insider trading / institutional ownership
 *   - Earnings calendar
 *
 * This is the cheapest path to fundamentals. Use FMP for the core report
 * fundamentals; upgrade to FactSet / Capital IQ later if institutional-
 * grade is required.
 *
 * Get a key:
 *   1. https://site.financialmodelingprep.com/developer/docs
 *   2. Free tier (250 req/day, basic data) for testing
 *   3. Starter $19/mo unlocks 5y financials + analyst estimates
 *   4. Add to .env.local: FMP_API_KEY=your-key
 */

import { safeFetchJson, resolveEnvKey, SUBJECT_KINDS } from './adapter-base.mjs';

export const provider = {
  name: 'fmp',
  displayName: 'Financial Modeling Prep',
  keyEnvVar: 'FMP_API_KEY',
  signupUrl: 'https://site.financialmodelingprep.com/developer/docs',
  subjectKinds: [SUBJECT_KINDS.SYMBOL],
  pricing: 'paid',
  monthlyCost: 19,
  dataKinds: ['fundamentals', 'analyst_estimates', 'peer_comparison', 'earnings_calendar', 'earnings_transcripts'],
};

export function isAvailable() {
  return resolveEnvKey('FMP_API_KEY') !== null;
}

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (value === null || value === undefined || value === '') return [];
  return [value];
}

function normalizeQuarter(value) {
  const text = String(value || '').trim().toUpperCase();
  const match = text.match(/Q?([1-4])/);
  return match ? Number(match[1]) : null;
}

function normalizeYear(value) {
  const parsed = Number(String(value || '').match(/\d{4}/)?.[0]);
  return Number.isFinite(parsed) ? parsed : null;
}

function compactText(value = '', max = 1200) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function excerptAroundTerms(text = '', terms = []) {
  const body = compactText(text, 50_000);
  if (!body) return '';
  const lowered = body.toLowerCase();
  const term = terms.map((item) => String(item || '').toLowerCase()).find((item) => item && lowered.includes(item));
  if (!term) return compactText(body, 1800);
  const index = Math.max(0, lowered.indexOf(term) - 500);
  return compactText(body.slice(index, index + 2200), 1800);
}

function normalizeTranscriptDate(row = {}) {
  const year = normalizeYear(row.year ?? row.fiscalYear ?? row.fiscal_year ?? row.calendarYear ?? row.date);
  const quarter = normalizeQuarter(row.quarter ?? row.period ?? row.fiscalQuarter ?? row.fiscal_quarter);
  if (!year || !quarter) return null;
  return {
    year,
    quarter,
    date: row.date || row.transcriptDate || row.eventDate || null,
  };
}

function normalizeTranscriptPayload(row = {}, fallback = {}, terms = []) {
  const transcriptText = row.transcript || row.content || row.text || row.transcript_text || row.finalTranscript || '';
  const excerpt = excerptAroundTerms(transcriptText, terms);
  if (!excerpt) return null;
  return {
    id: row.id || `${fallback.symbol}-${fallback.year}-Q${fallback.quarter}`,
    symbol: row.symbol || row.ticker || fallback.symbol,
    fiscalYear: normalizeYear(row.year ?? row.fiscalYear ?? fallback.year),
    quarter: normalizeQuarter(row.quarter ?? row.period ?? fallback.quarter),
    eventDate: row.date || row.eventDate || fallback.date || null,
    eventType: row.eventType || row.title || 'earnings_call',
    excerpt,
    url: row.url || row.link || row.transcriptUrl || null,
    speaker: row.speaker || null,
    source: 'fmp_earning_call_transcript',
  };
}

function adapterError(kind, result = {}, extra = {}) {
  return {
    kind,
    error: result.error || 'request_failed',
    status: result.status ?? null,
    retryable: Boolean(result.retryable),
    rateLimited: Boolean(result.rateLimited),
    retryAfterSec: result.retryAfterSec ?? null,
    ...extra,
  };
}

export async function loadFor(subject, opts = {}) {
  const apiKey = resolveEnvKey('FMP_API_KEY');
  if (!apiKey) return { ok: false, errors: [{ kind: 'no_key', message: 'FMP_API_KEY not set.' }] };
  const symbol = subject?.kind === SUBJECT_KINDS.SYMBOL ? subject.key : (opts.symbol || subject?.symbol);
  if (!symbol) return { ok: false, errors: [{ kind: 'no_symbol' }] };

  const base = 'https://financialmodelingprep.com/stable';
  /* Income statement annual */
  const income = await safeFetchJson(`${base}/income-statement?symbol=${encodeURIComponent(symbol)}&limit=5&apikey=${apiKey}`);
  /* Cash flow annual */
  const cashflow = await safeFetchJson(`${base}/cash-flow-statement?symbol=${encodeURIComponent(symbol)}&limit=5&apikey=${apiKey}`);
  /* Analyst estimates. Annual works on the basic plan; quarterly may require an upgrade. */
  const estimates = await safeFetchJson(`${base}/analyst-estimates?symbol=${encodeURIComponent(symbol)}&period=annual&limit=4&apikey=${apiKey}`);
  /* Key metrics TTM */
  const metricsTtm = await safeFetchJson(`${base}/key-metrics-ttm?symbol=${encodeURIComponent(symbol)}&apikey=${apiKey}`);
  /* Peers */
  const peers = await safeFetchJson(`${base}/stock-peers?symbol=${encodeURIComponent(symbol)}&apikey=${apiKey}`);
  const includeTranscripts = opts.includeTranscripts !== false;
  const transcriptTerms = asArray(opts.transcriptTerms).length
    ? asArray(opts.transcriptTerms)
    : ['artificial intelligence', 'AI', 'capex', 'capital expenditure', 'data center', 'cloud', 'demand', 'supply', 'power', 'utilization', 'accelerator', 'GPU'];
  const transcriptDates = includeTranscripts
    ? await safeFetchJson(`${base}/earning-call-transcript-dates?symbol=${encodeURIComponent(symbol)}&apikey=${apiKey}`)
    : { ok: true, json: [] };
  const transcriptDateRows = transcriptDates.ok
    ? asArray(transcriptDates.json?.data || transcriptDates.json?.transcripts || transcriptDates.json)
      .map(normalizeTranscriptDate)
      .filter(Boolean)
      .slice(0, opts.transcriptLimit || 2)
    : [];
  const transcriptResults = [];
  if (includeTranscripts) {
    for (const transcriptDate of transcriptDateRows) {
      const transcript = await safeFetchJson(`${base}/earning-call-transcript?symbol=${encodeURIComponent(symbol)}&year=${transcriptDate.year}&quarter=${transcriptDate.quarter}&apikey=${apiKey}`);
      transcriptResults.push({ transcriptDate, ...transcript });
    }
  }

  const errors = [];
  for (const [name, r] of Object.entries({ income, cashflow, estimates, metricsTtm, peers, transcriptDates })) {
    if (!r.ok) errors.push(adapterError(`${name}_failed`, r, { endpoint: name }));
  }
  for (const result of transcriptResults) {
    if (!result.ok) errors.push(adapterError('transcript_failed', result, {
      endpoint: 'earning-call-transcript',
      year: result.transcriptDate?.year,
      quarter: result.transcriptDate?.quarter,
    }));
  }

  /* Normalize selected fields per response */
  const incomeRows = Array.isArray(income.json) ? income.json.slice(0, 5).map((row) => ({
    fiscalYear: row.calendarYear,
    revenue: row.revenue,
    operatingIncome: row.operatingIncome,
    netIncome: row.netIncome,
    grossProfitRatio: row.grossProfitRatio,
    operatingIncomeRatio: row.operatingIncomeRatio,
    eps: row.eps,
    period: row.period,
    date: row.date,
  })) : [];
  const cashflowRows = Array.isArray(cashflow.json) ? cashflow.json.slice(0, 5).map((row) => ({
    fiscalYear: row.calendarYear,
    operatingCashFlow: row.operatingCashFlow,
    capitalExpenditure: row.capitalExpenditure,
    freeCashFlow: row.freeCashFlow,
    date: row.date,
  })) : [];
  const estimateRows = Array.isArray(estimates.json) ? estimates.json.slice(0, 4).map((row) => ({
    date: row.date,
    estimatedRevenueAvg: row.estimatedRevenueAvg ?? row.revenueAvg,
    estimatedRevenueLow: row.estimatedRevenueLow ?? row.revenueLow,
    estimatedRevenueHigh: row.estimatedRevenueHigh ?? row.revenueHigh,
    estimatedEpsAvg: row.estimatedEpsAvg ?? row.epsAvg,
    numberAnalystEstimatedRevenue: row.numberAnalystEstimatedRevenue ?? row.numAnalystsRevenue,
  })) : [];
  const ttm = Array.isArray(metricsTtm.json) ? metricsTtm.json[0] : null;
  const peerList = Array.isArray(peers.json)
    ? peers.json.map((peer) => peer.symbol || peer.ticker).filter(Boolean)
    : [];
  const earningsTranscripts = transcriptResults
    .flatMap((result) => asArray(result.json?.data || result.json?.transcripts || result.json)
      .map((row) => normalizeTranscriptPayload(row, { symbol, ...result.transcriptDate }, transcriptTerms))
      .filter(Boolean))
    .slice(0, opts.transcriptLimit || 2);

  return {
    ok: !errors.some((error) => error.rateLimited),
    retryable: errors.some((error) => error.retryable),
    rateLimited: errors.some((error) => error.rateLimited),
    retryAfterSec: errors.map((error) => Number(error.retryAfterSec)).filter(Number.isFinite)[0] || null,
    pack: {
      available: incomeRows.length > 0 || estimateRows.length > 0,
      symbol,
      incomeAnnual: incomeRows,
      cashflowAnnual: cashflowRows,
      analystEstimates: estimateRows,
      keyMetricsTtm: ttm ? {
        peRatio: ttm.peRatioTTM,
        priceBookRatio: ttm.priceBookValueRatioTTM,
        roe: ttm.roeTTM,
        debtToEquity: ttm.debtToEquityTTM,
        currentRatio: ttm.currentRatioTTM,
        evToEbitda: ttm.enterpriseValueOverEBITDATTM,
      } : null,
      peers: peerList.slice(0, 8),
      earningsTranscripts,
    },
    errors,
  };
}

export async function loadValuationSnapshot(symbol, opts = {}) {
  const apiKey = resolveEnvKey('FMP_API_KEY');
  if (!apiKey) return { status: 'no_key', symbol };
  if (!symbol) return { status: 'no_symbol' };
  const base = 'https://financialmodelingprep.com/stable';
  const ratios = await safeFetchJson(`${base}/ratios-ttm?symbol=${encodeURIComponent(symbol)}&apikey=${apiKey}`);
  const metrics = await safeFetchJson(`${base}/key-metrics-ttm?symbol=${encodeURIComponent(symbol)}&apikey=${apiKey}`);
  const peers = opts.includePeers === false
    ? { ok: true, json: [] }
    : await safeFetchJson(`${base}/stock-peers?symbol=${encodeURIComponent(symbol)}&apikey=${apiKey}`);
  const errors = [];
  for (const [name, result] of Object.entries({ ratios, metrics, peers })) {
    if (!result.ok) {
      errors.push(adapterError(`${name}_failed`, result, { endpoint: name }));
    }
  }
  const ratiosRow = Array.isArray(ratios.json) ? ratios.json[0] : ratios.json;
  const metricsRow = Array.isArray(metrics.json) ? metrics.json[0] : metrics.json;
  const peerSymbols = Array.isArray(peers.json) ? peers.json.map((row) => row.peers || row.peer || row).flat() : [];
  const peerList = Array.from(new Set(peerSymbols.map((value) => String(value || '').toUpperCase()).filter(Boolean))).slice(0, 8);
  const peTtm = Number(ratiosRow?.peRatioTTM ?? metricsRow?.peRatioTTM);
  const evEbitdaTtm = Number(ratiosRow?.enterpriseValueOverEBITDATTM ?? metricsRow?.enterpriseValueOverEBITDATTM);
  const priceToBookTtm = Number(ratiosRow?.priceBookValueRatioTTM ?? metricsRow?.priceBookValueRatioTTM);
  let peVsPeerMedian = null;
  if (opts.peerMedianPE && Number.isFinite(peTtm) && Number.isFinite(opts.peerMedianPE) && opts.peerMedianPE > 0) {
    peVsPeerMedian = peTtm / opts.peerMedianPE;
  }
  return {
    status: errors.length === 0 ? 'ok' : 'partial',
    symbol,
    peTtm: Number.isFinite(peTtm) ? peTtm : null,
    evEbitdaTtm: Number.isFinite(evEbitdaTtm) ? evEbitdaTtm : null,
    priceToBookTtm: Number.isFinite(priceToBookTtm) ? priceToBookTtm : null,
    peVsPeerMedian,
    peers: peerList,
    rawForwardEpsGrowth: Number.isFinite(Number(metricsRow?.epsGrowthTTM)) ? Number(metricsRow.epsGrowthTTM) : null,
    forwardEpsGrowth: Number.isFinite(Number(metricsRow?.epsGrowthTTM)) ? Number(metricsRow.epsGrowthTTM) : null,
    errors,
  };
}
