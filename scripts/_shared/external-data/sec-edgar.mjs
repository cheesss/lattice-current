/*
 * SEC EDGAR adapter.
 *
 * What it adds to a report:
 *   - Recent filings (10-K / 10-Q / 8-K) for a public-company subject.
 *   - Company facts (XBRL): revenue, R&D spend, capex, segment data.
 *   - Filing dates so the analyst can correlate news with filings.
 *
 * No API key required. Rate limit: 10 req/sec; we use safeFetchJsonSequential
 * with 200ms pacing to stay polite.
 *
 * Subject kinds:
 *   - 'symbol' (ticker → CIK lookup → submissions/companyfacts)
 *   - 'theme' (skipped — no theme-level filing data; use FMP/EIA instead)
 *
 * Limits:
 *   - The CIK lookup uses the static SEC ticker→CIK mapping, downloaded
 *     once per process (cached in module scope).
 *   - For private/foreign subjects, returns ok=true with empty pack.
 */

import { safeFetchJson, buildSkippedProviderRecord, SUBJECT_KINDS } from './adapter-base.mjs';

export const provider = {
  name: 'sec-edgar',
  displayName: 'SEC EDGAR',
  keyEnvVar: null,
  signupUrl: 'https://www.sec.gov/edgar/sec-api-documentation',
  subjectKinds: [SUBJECT_KINDS.SYMBOL, SUBJECT_KINDS.EVENT],
  pricing: 'free',
  monthlyCost: 0,
  dataKinds: ['filings', 'company_facts', 'segment_data'],
};

let cikMapCache = null;
let cikMapCacheAt = 0;
const CIK_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

async function loadCikMap() {
  if (cikMapCache && Date.now() - cikMapCacheAt < CIK_CACHE_TTL_MS) return cikMapCache;
  /* SEC publishes ticker→CIK mapping at this URL */
  const r = await safeFetchJson('https://www.sec.gov/files/company_tickers.json');
  if (!r.ok) return null;
  const map = new Map();
  for (const row of Object.values(r.json || {})) {
    if (row?.ticker && row?.cik_str != null) {
      map.set(String(row.ticker).toUpperCase(), {
        cik: String(row.cik_str).padStart(10, '0'),
        title: row.title || row.name || row.ticker,
      });
    }
  }
  cikMapCache = map;
  cikMapCacheAt = Date.now();
  return map;
}

export function isAvailable() {
  return true;
}

export async function loadFor(subject, opts = {}) {
  const symbol = (subject?.kind === SUBJECT_KINDS.SYMBOL ? subject.key : (opts.symbol || subject?.symbol || subject?.ticker));
  if (!symbol) {
    return { ok: false, errors: [{ kind: 'no_symbol', message: 'SEC EDGAR adapter needs a ticker; theme/event subjects skipped here.' }] };
  }
  const cikMap = await loadCikMap();
  if (!cikMap) {
    return { ok: false, errors: [{ kind: 'cik_map_load_failed', message: 'Could not load SEC ticker→CIK map.' }] };
  }
  const upper = String(symbol).toUpperCase();
  const cikRow = cikMap.get(upper);
  if (!cikRow) {
    return { ok: true, pack: { available: false, reason: `ticker ${upper} not in SEC CIK map (foreign / private / non-equity?)`, symbol: upper }, errors: [] };
  }

  /* 1. Submissions — recent filings list */
  const submissions = await safeFetchJson(`https://data.sec.gov/submissions/CIK${cikRow.cik}.json`);
  /* 2. Company facts — XBRL fundamentals */
  const facts = await safeFetchJson(`https://data.sec.gov/api/xbrl/companyfacts/CIK${cikRow.cik}.json`);

  const errors = [];
  if (!submissions.ok) errors.push({ kind: 'submissions_failed', message: submissions.error });
  if (!facts.ok) errors.push({ kind: 'facts_failed', message: facts.error });

  /* Normalize: pick the 8 most recent filings of any form, plus the most
   * recent 10-K/10-Q/8-K specifically. */
  const recent = submissions.ok ? extractRecentFilings(submissions.json, 12) : [];
  const tenK = recent.find((f) => f.form === '10-K');
  const tenQ = recent.find((f) => f.form === '10-Q');
  const eightK = recent.find((f) => f.form === '8-K');

  /* From companyfacts, pull the latest values for a few key metrics */
  const factSnapshots = facts.ok ? pickFactSnapshots(facts.json) : null;

  return {
    ok: true,
    pack: {
      available: true,
      symbol: upper,
      cik: cikRow.cik,
      companyName: cikRow.title,
      filings: {
        recent,
        latest10K: tenK || null,
        latest10Q: tenQ || null,
        latest8K: eightK || null,
      },
      facts: factSnapshots,
    },
    errors,
  };
}

function extractRecentFilings(submissionsJson, limit) {
  const recent = submissionsJson?.filings?.recent;
  if (!recent) return [];
  const out = [];
  const len = Math.min(recent.accessionNumber?.length || 0, 60);
  for (let i = 0; i < len && out.length < limit; i += 1) {
    out.push({
      accession: recent.accessionNumber[i],
      form: recent.form[i],
      filedAt: recent.filingDate[i],
      reportDate: recent.reportDate[i] || null,
      primaryDocument: recent.primaryDocument[i],
      url: `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${submissionsJson.cik}&type=${recent.form[i]}&dateb=&owner=include&count=10&action=getcompany`,
    });
  }
  return out;
}

function pickFactSnapshots(factsJson) {
  /* Pull the latest annual + quarterly value for a curated metric set.
   * XBRL concept names are documented at us-gaap-doc.fasb.org. */
  const concepts = {
    revenue: 'us-gaap:Revenues',
    revenueAlt: 'us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax',
    operatingIncome: 'us-gaap:OperatingIncomeLoss',
    netIncome: 'us-gaap:NetIncomeLoss',
    rd: 'us-gaap:ResearchAndDevelopmentExpense',
    capex: 'us-gaap:PaymentsToAcquirePropertyPlantAndEquipment',
    cashAndEquivalents: 'us-gaap:CashAndCashEquivalentsAtCarryingValue',
  };
  const out = {};
  const facts = factsJson?.facts?.['us-gaap'] || {};
  for (const [key, concept] of Object.entries(concepts)) {
    const conceptKey = concept.replace('us-gaap:', '');
    const conceptFacts = facts[conceptKey];
    if (!conceptFacts?.units?.USD) continue;
    /* Latest by 'end' date */
    const usdRows = conceptFacts.units.USD;
    const sorted = [...usdRows].sort((a, b) => String(b.end).localeCompare(String(a.end)));
    const latestAnnual = sorted.find((r) => r.fp === 'FY');
    const latestQuarterly = sorted.find((r) => r.fp && /^Q[1-4]$/.test(r.fp));
    if (latestAnnual) {
      out[`${key}Annual`] = { value: latestAnnual.val, end: latestAnnual.end, fy: latestAnnual.fy, accn: latestAnnual.accn };
    }
    if (latestQuarterly) {
      out[`${key}Quarterly`] = { value: latestQuarterly.val, end: latestQuarterly.end, fp: latestQuarterly.fp, fy: latestQuarterly.fy, accn: latestQuarterly.accn };
    }
  }
  return out;
}

export const __test = { extractRecentFilings, pickFactSnapshots, loadCikMap };
