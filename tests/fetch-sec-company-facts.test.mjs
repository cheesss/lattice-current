import test from 'node:test';
import assert from 'node:assert/strict';

import {
  SEC_COMPANY_FACTS_SCHEMA_STATEMENTS,
  buildExposureKey,
  buildEntityProfile,
  buildFactKey,
  buildFilingKey,
  buildSeedOnlyExposureRows,
  buildThemeEntityExposureRows,
  extractCompanyFactsRows,
  extractRecentFilings,
  normalizeCik,
  parseArgs,
  runSecCompanyFacts,
} from '../scripts/fetch-sec-company-facts.mjs';

const SAMPLE_COMPANY_FACTS = {
  cik: '320193',
  entityName: 'Apple Inc.',
  facts: {
    'us-gaap': {
      Revenues: {
        label: 'Revenue',
        description: 'Revenue from contracts with customers.',
        units: {
          USD: [
            {
              end: '2025-09-27',
              val: 391035000000,
              accn: '0000320193-25-000010',
              fy: 2025,
              fp: 'FY',
              form: '10-K',
              filed: '2025-10-31',
              frame: 'CY2025',
            },
          ],
        },
      },
      EntityCommonStockSharesOutstanding: {
        label: 'Shares outstanding',
        units: {
          shares: [
            {
              end: '2025-09-27',
              val: 15000000000,
              accn: '0000320193-25-000010',
              fy: 2025,
              fp: 'FY',
              form: '10-K',
              filed: '2025-10-31',
            },
          ],
        },
      },
    },
  },
};

const SAMPLE_SUBMISSIONS = {
  cik: '0000320193',
  name: 'Apple Inc.',
  tickers: ['AAPL'],
  exchanges: ['Nasdaq'],
  sic: '3571',
  sicDescription: 'Electronic Computers',
  category: 'Large accelerated filer',
  fiscalYearEnd: '0927',
  stateOfIncorporation: 'CA',
  filings: {
    recent: {
      accessionNumber: ['0000320193-25-000010', '0000320193-25-000011'],
      filingDate: ['2025-10-31', '2025-11-05'],
      reportDate: ['2025-09-27', '2025-11-01'],
      acceptanceDateTime: ['2025-10-31T16:10:11.000Z', '2025-11-05T12:10:11.000Z'],
      act: ['34', '34'],
      form: ['10-K', '8-K'],
      fileNumber: ['001-36743', '001-36743'],
      filmNumber: ['25123456', '25123457'],
      items: ['', '2.02,9.01'],
      size: [12500000, 4500000],
      isXBRL: [1, 0],
      isInlineXBRL: [1, 0],
      primaryDocument: ['aapl-20250927x10k.htm', 'aapl-20251105x8k.htm'],
      primaryDocDescription: ['10-K', '8-K'],
    },
  },
};

test('fetch-sec-company-facts parseArgs applies SEC defaults and toggles', () => {
  const defaults = parseArgs([]);
  assert.equal(defaults.dryRun, false);
  assert.equal(defaults.includeFacts, true);
  assert.equal(defaults.includeFilings, true);
  assert.equal(defaults.maxFacts, 250);
  assert.equal(defaults.maxFilings, 50);

  const overridden = parseArgs([
    '--ticker', 'aapl',
    '--dry-run',
    '--facts-only',
    '--max-facts', '12',
    '--forms', '10-K,8-K',
  ]);
  assert.equal(overridden.ticker, 'aapl');
  assert.equal(overridden.dryRun, true);
  assert.equal(overridden.includeFacts, true);
  assert.equal(overridden.includeFilings, false);
  assert.equal(overridden.maxFacts, 12);
  assert.deepEqual(overridden.forms, ['10-K', '8-K']);
});

test('fetch-sec-company-facts exports schema for profiles, facts, and filings evidence', () => {
  const joined = SEC_COMPANY_FACTS_SCHEMA_STATEMENTS.join('\n');
  assert.match(joined, /CREATE TABLE IF NOT EXISTS sec_entity_profiles/i);
  assert.match(joined, /CREATE TABLE IF NOT EXISTS sec_companyfacts_facts/i);
  assert.match(joined, /CREATE TABLE IF NOT EXISTS sec_filings_evidence/i);
  assert.match(joined, /CREATE TABLE IF NOT EXISTS theme_entity_exposure/i);
  assert.match(joined, /primary_doc_url TEXT/i);
  assert.match(joined, /numeric_value DOUBLE PRECISION/i);
});

test('fetch-sec-company-facts normalizes SEC entity profile and evidence rows', () => {
  const profile = buildEntityProfile(SAMPLE_COMPANY_FACTS, SAMPLE_SUBMISSIONS, { ticker: 'aapl' });
  assert.equal(profile.cik, '0000320193');
  assert.equal(profile.ticker, 'AAPL');
  assert.equal(profile.entityName, 'Apple Inc.');
  assert.deepEqual(profile.exchanges, ['Nasdaq']);

  const factRows = extractCompanyFactsRows(SAMPLE_COMPANY_FACTS, {
    ticker: profile.ticker,
    entityName: profile.entityName,
  });
  assert.equal(factRows.length, 2);
  assert.equal(factRows[0].taxonomy, 'us-gaap');
  assert.equal(factRows[0].concept, 'Revenues');
  assert.equal(factRows[0].numericValue, 391035000000);
  assert.ok(factRows[0].factKey);
  assert.equal(buildFactKey(factRows[0]), factRows[0].factKey);

  const filingRows = extractRecentFilings(SAMPLE_SUBMISSIONS, {
    ticker: profile.ticker,
    entityName: profile.entityName,
  });
  assert.equal(filingRows.length, 2);
  assert.equal(filingRows[0].filingType, '10-K');
  assert.match(filingRows[1].primaryDocUrl, /Archives\/edgar\/data/i);
  assert.deepEqual(filingRows[1].items, ['2.02', '9.01']);
  assert.equal(buildFilingKey(filingRows[1]), filingRows[1].filingKey);
});

test('fetch-sec-company-facts dry-run fetches ticker mapping, companyfacts, and filings without pg config', async () => {
  const responses = new Map([
    ['https://www.sec.gov/files/company_tickers.json', {
      ok: true,
      json: async () => ({
        0: { ticker: 'AAPL', cik_str: 320193, title: 'Apple Inc.' },
      }),
    }],
    ['https://data.sec.gov/api/xbrl/companyfacts/CIK0000320193.json', {
      ok: true,
      json: async () => SAMPLE_COMPANY_FACTS,
    }],
    ['https://data.sec.gov/submissions/CIK0000320193.json', {
      ok: true,
      json: async () => SAMPLE_SUBMISSIONS,
    }],
  ]);

  const summary = await runSecCompanyFacts(
    { ticker: 'AAPL', dryRun: true, maxFacts: 5, maxFilings: 5 },
    {
      fetchImpl: async (url) => {
        const key = typeof url === 'string' ? url : String(url);
        const response = responses.get(key);
        assert.ok(response, `unexpected SEC URL ${key}`);
        return response;
      },
    },
  );

  assert.equal(summary.ok, true);
  assert.equal(summary.dryRun, true);
  assert.equal(summary.cik, '0000320193');
  assert.equal(summary.ticker, 'AAPL');
  assert.equal(summary.factCount, 2);
  assert.equal(summary.filingCount, 2);
  assert.equal(summary.exposureCount, 0);
  assert.equal(summary.sample.profile.entityName, 'Apple Inc.');
  assert.equal(summary.sample.facts[0].concept, 'Revenues');
  assert.equal(summary.sample.filings[0].filingType, '10-K');
  assert.deepEqual(summary.sample.exposures, []);
});

test('fetch-sec-company-facts normalizes CIK values to SEC width', () => {
  assert.equal(normalizeCik('320193'), '0000320193');
  assert.equal(normalizeCik('0000320193'), '0000320193');
  assert.equal(normalizeCik(''), '');
});

test('fetch-sec-company-facts derives theme exposure rows for seeded companies', () => {
  const rows = buildThemeEntityExposureRows(
    {
      cik: '0001045810',
      ticker: 'NVDA',
      tickers: ['NVDA'],
      exchanges: ['Nasdaq'],
      entityName: 'NVIDIA CORP',
    },
    [
      { factKey: 'fact-1' },
      { factKey: 'fact-2' },
    ],
    [
      { filingKey: 'filing-1' },
    ],
  );

  assert.deepEqual(rows.map((row) => row.theme).sort(), ['ai-ml', 'semiconductor']);
  assert.equal(rows[0].entityKey, 'NVDA');
  assert.equal(rows[0].evidenceSource, 'theme_entity_seed+sec');
  assert.ok(rows[0].confidence > 0.7);
  assert.deepEqual(rows[0].supportingFactKeys, ['fact-1', 'fact-2']);
  assert.deepEqual(rows[0].supportingFilingKeys, ['filing-1']);
  assert.equal(buildExposureKey(rows[0]), rows[0].exposureKey);
});

test('fetch-sec-company-facts falls back to seed-only exposure rows when SEC mapping is unavailable', async () => {
  const fallbackRows = buildSeedOnlyExposureRows(
    { ticker: 'ABB', tickers: ['ABB'], entityName: 'ABB' },
    { fallbackReason: 'No SEC CIK mapping found for ticker ABB.' },
  );
  assert.equal(fallbackRows.length, 1);
  assert.equal(fallbackRows[0].theme, 'robotics-automation');
  assert.equal(fallbackRows[0].evidenceSource, 'theme_entity_seed');
  assert.match(fallbackRows[0].metadata.fallbackReason, /ABB/);

  const summary = await runSecCompanyFacts(
    { ticker: 'ABB', dryRun: true },
    {
      fetchImpl: async (url) => {
        const key = typeof url === 'string' ? url : String(url);
        if (key === 'https://www.sec.gov/files/company_tickers.json') {
          return {
            ok: true,
            json: async () => ({ 0: { ticker: 'AAPL', cik_str: 320193, title: 'Apple Inc.' } }),
          };
        }
        throw new Error(`unexpected SEC URL ${key}`);
      },
    },
  );

  assert.equal(summary.ok, true);
  assert.equal(summary.fallbackUsed, true);
  assert.equal(summary.cik, null);
  assert.equal(summary.exposureCount, 1);
  assert.equal(summary.sample.exposures[0].theme, 'robotics-automation');
});
