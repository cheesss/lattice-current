#!/usr/bin/env node

import pg from 'pg';
import { pathToFileURL } from 'node:url';
import { loadOptionalEnvFile, resolveNasPgConfig } from './_shared/nas-runtime.mjs';
import { THEME_ENTITY_SEEDS } from './_shared/theme-entity-seeds.mjs';

loadOptionalEnvFile();

const { Client } = pg;

const SEC_TICKER_LOOKUP_URL = 'https://www.sec.gov/files/company_tickers.json';
const SEC_COMPANY_FACTS_BASE = 'https://data.sec.gov/api/xbrl/companyfacts';
const SEC_SUBMISSIONS_BASE = 'https://data.sec.gov/submissions';
const DEFAULT_MAX_FACTS = 250;
const DEFAULT_MAX_FILINGS = 50;
const DEFAULT_SEC_USER_AGENT = 'lattice-trend-intelligence/0.1 contact-required@example.com';

export const SEC_COMPANY_FACTS_SCHEMA_STATEMENTS = [
  `
    CREATE TABLE IF NOT EXISTS sec_entity_profiles (
      cik TEXT PRIMARY KEY,
      ticker TEXT,
      entity_name TEXT NOT NULL,
      tickers TEXT[] NOT NULL DEFAULT '{}'::text[],
      exchanges TEXT[] NOT NULL DEFAULT '{}'::text[],
      sic TEXT,
      sic_description TEXT,
      category TEXT,
      fiscal_year_end TEXT,
      state_of_incorporation TEXT,
      description TEXT,
      website TEXT,
      investor_website TEXT,
      source_urls JSONB NOT NULL DEFAULT '{}'::jsonb,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      last_refreshed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `,
  `
    CREATE INDEX IF NOT EXISTS idx_sec_entity_profiles_ticker
      ON sec_entity_profiles (ticker);
  `,
  `
    CREATE TABLE IF NOT EXISTS sec_companyfacts_facts (
      fact_key TEXT PRIMARY KEY,
      cik TEXT NOT NULL REFERENCES sec_entity_profiles(cik) ON DELETE CASCADE,
      ticker TEXT,
      entity_name TEXT,
      taxonomy TEXT NOT NULL,
      concept TEXT NOT NULL,
      concept_label TEXT,
      concept_description TEXT,
      unit TEXT NOT NULL,
      fiscal_year TEXT,
      fiscal_period TEXT,
      form TEXT,
      filed_at DATE,
      period_end DATE,
      frame TEXT,
      accession TEXT,
      numeric_value DOUBLE PRECISION,
      text_value TEXT,
      value_type TEXT NOT NULL DEFAULT 'number',
      source_url TEXT,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      imported_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `,
  `
    CREATE INDEX IF NOT EXISTS idx_sec_companyfacts_facts_entity
      ON sec_companyfacts_facts (cik, filed_at DESC, period_end DESC);
  `,
  `
    CREATE INDEX IF NOT EXISTS idx_sec_companyfacts_facts_concept
      ON sec_companyfacts_facts (taxonomy, concept, filed_at DESC);
  `,
  `
    CREATE INDEX IF NOT EXISTS idx_sec_companyfacts_facts_form
      ON sec_companyfacts_facts (form, filed_at DESC);
  `,
  `
    CREATE TABLE IF NOT EXISTS sec_filings_evidence (
      filing_key TEXT PRIMARY KEY,
      cik TEXT NOT NULL REFERENCES sec_entity_profiles(cik) ON DELETE CASCADE,
      ticker TEXT,
      entity_name TEXT,
      accession TEXT NOT NULL,
      filing_type TEXT NOT NULL,
      filing_date DATE,
      report_date DATE,
      accepted_at TIMESTAMPTZ,
      act TEXT,
      film_number TEXT,
      primary_document TEXT,
      primary_doc_description TEXT,
      primary_doc_url TEXT,
      items TEXT[] NOT NULL DEFAULT '{}'::text[],
      size_bytes BIGINT,
      is_xbrl BOOLEAN,
      is_inline_xbrl BOOLEAN,
      source_url TEXT,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      imported_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `,
  `
    CREATE INDEX IF NOT EXISTS idx_sec_filings_evidence_entity
      ON sec_filings_evidence (cik, filing_date DESC);
  `,
  `
    CREATE INDEX IF NOT EXISTS idx_sec_filings_evidence_type
      ON sec_filings_evidence (filing_type, filing_date DESC);
  `,
  `
    CREATE TABLE IF NOT EXISTS theme_entity_exposure (
      exposure_key TEXT PRIMARY KEY,
      theme TEXT NOT NULL,
      entity_type TEXT NOT NULL DEFAULT 'company',
      entity_key TEXT NOT NULL,
      entity_label TEXT,
      relation_type TEXT NOT NULL DEFAULT 'beneficiary',
      sign TEXT NOT NULL DEFAULT 'positive',
      confidence DOUBLE PRECISION NOT NULL DEFAULT 0,
      horizon TEXT NOT NULL DEFAULT 'long',
      evidence_source TEXT NOT NULL DEFAULT 'sec_connector',
      evidence_note TEXT,
      supporting_fact_keys TEXT[] NOT NULL DEFAULT '{}'::text[],
      supporting_filing_keys TEXT[] NOT NULL DEFAULT '{}'::text[],
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (theme, entity_type, entity_key, relation_type)
    );
  `,
  `
    CREATE INDEX IF NOT EXISTS idx_theme_entity_exposure_theme
      ON theme_entity_exposure (theme, confidence DESC, updated_at DESC);
  `,
  `
    CREATE INDEX IF NOT EXISTS idx_theme_entity_exposure_entity
      ON theme_entity_exposure (entity_key, entity_type, updated_at DESC);
  `,
];

function toJson(value) {
  return JSON.stringify(value ?? {});
}

function safeTrim(value) {
  return String(value ?? '').trim();
}

function toUpperTicker(value) {
  const normalized = safeTrim(value).toUpperCase();
  return normalized || null;
}

function toArray(value) {
  if (Array.isArray(value)) return value;
  if (value == null) return [];
  return [value];
}

export function normalizeCik(value) {
  const digits = String(value ?? '').replace(/\D+/g, '');
  return digits ? digits.padStart(10, '0') : '';
}

function normalizeDate(value) {
  const trimmed = safeTrim(value);
  if (!trimmed) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
  const date = new Date(trimmed);
  return Number.isNaN(date.valueOf()) ? null : date.toISOString().slice(0, 10);
}

function normalizeTimestamp(value) {
  const trimmed = safeTrim(value);
  if (!trimmed) return null;
  const date = new Date(trimmed);
  return Number.isNaN(date.valueOf()) ? null : date.toISOString();
}

function toBigIntLike(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  return Math.trunc(numeric);
}

function normalizeItems(value) {
  if (Array.isArray(value)) {
    return value.map((entry) => safeTrim(entry)).filter(Boolean);
  }
  const trimmed = safeTrim(value);
  if (!trimmed) return [];
  return trimmed
    .split(/[,;]+/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function normalizeForms(forms) {
  const normalized = toArray(forms)
    .flatMap((entry) => String(entry ?? '').split(','))
    .map((entry) => safeTrim(entry).toUpperCase())
    .filter(Boolean);
  return normalized.length > 0 ? normalized : [];
}

function asMaybeNumber(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

export function buildSecHeaders(overrides = {}) {
  const userAgent = safeTrim(
    overrides.userAgent
    || process.env.SEC_USER_AGENT
    || process.env.EDGAR_USER_AGENT
    || DEFAULT_SEC_USER_AGENT,
  );
  return {
    'User-Agent': userAgent,
    Accept: 'application/json',
    'Accept-Encoding': 'gzip, deflate',
  };
}

export function parseArgs(argv = process.argv.slice(2)) {
  const parsed = {
    ticker: '',
    cik: '',
    dryRun: false,
    includeFacts: true,
    includeFilings: true,
    maxFacts: DEFAULT_MAX_FACTS,
    maxFilings: DEFAULT_MAX_FILINGS,
    forms: [],
    userAgent: '',
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--ticker' && argv[index + 1]) {
      parsed.ticker = argv[++index];
    } else if (arg === '--cik' && argv[index + 1]) {
      parsed.cik = argv[++index];
    } else if (arg === '--dry-run') {
      parsed.dryRun = true;
    } else if (arg === '--facts-only') {
      parsed.includeFacts = true;
      parsed.includeFilings = false;
    } else if (arg === '--filings-only') {
      parsed.includeFacts = false;
      parsed.includeFilings = true;
    } else if (arg === '--max-facts' && argv[index + 1]) {
      const value = Number(argv[++index]);
      if (Number.isFinite(value) && value >= 0) parsed.maxFacts = Math.floor(value);
    } else if (arg === '--max-filings' && argv[index + 1]) {
      const value = Number(argv[++index]);
      if (Number.isFinite(value) && value >= 0) parsed.maxFilings = Math.floor(value);
    } else if (arg === '--forms' && argv[index + 1]) {
      parsed.forms = normalizeForms(argv[++index]);
    } else if (arg === '--user-agent' && argv[index + 1]) {
      parsed.userAgent = argv[++index];
    }
  }
  return parsed;
}

async function fetchJson(url, { fetchImpl = fetch, headers = {}, timeoutMs = 20_000 } = {}) {
  const response = await fetchImpl(url, {
    headers,
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) {
    throw new Error(`SEC ${response.status} for ${url}`);
  }
  return response.json();
}

export async function resolveCikForTicker(ticker, options = {}) {
  const normalizedTicker = toUpperTicker(ticker);
  if (!normalizedTicker) {
    throw new Error('Ticker is required to resolve a CIK.');
  }
  const headers = buildSecHeaders(options);
  const payload = await fetchJson(SEC_TICKER_LOOKUP_URL, {
    fetchImpl: options.fetchImpl,
    headers,
    timeoutMs: options.timeoutMs,
  });
  for (const entry of Object.values(payload || {})) {
    if (toUpperTicker(entry?.ticker) === normalizedTicker) {
      return normalizeCik(entry?.cik_str);
    }
  }
  throw new Error(`No SEC CIK mapping found for ticker ${normalizedTicker}.`);
}

export function buildEntityProfile(companyFactsPayload, submissionsPayload, options = {}) {
  const cik = normalizeCik(options.cik || companyFactsPayload?.cik || submissionsPayload?.cik);
  const tickers = [
    ...toArray(submissionsPayload?.tickers).map((value) => toUpperTicker(value)).filter(Boolean),
    toUpperTicker(options.ticker),
    toUpperTicker(companyFactsPayload?.ticker),
  ].filter(Boolean);
  const exchanges = toArray(submissionsPayload?.exchanges).map((value) => safeTrim(value)).filter(Boolean);
  const entityName = safeTrim(
    companyFactsPayload?.entityName
    || submissionsPayload?.name
    || options.entityName,
  );
  return {
    cik,
    ticker: tickers[0] || null,
    entityName,
    tickers: [...new Set(tickers)],
    exchanges: [...new Set(exchanges)],
    sic: safeTrim(submissionsPayload?.sic) || null,
    sicDescription: safeTrim(submissionsPayload?.sicDescription) || null,
    category: safeTrim(submissionsPayload?.category) || null,
    fiscalYearEnd: safeTrim(submissionsPayload?.fiscalYearEnd) || null,
    stateOfIncorporation: safeTrim(submissionsPayload?.stateOfIncorporation) || null,
    description: safeTrim(submissionsPayload?.description) || null,
    website: safeTrim(submissionsPayload?.website) || null,
    investorWebsite: safeTrim(submissionsPayload?.investorWebsite) || null,
    sourceUrls: {
      companyFacts: `${SEC_COMPANY_FACTS_BASE}/CIK${cik}.json`,
      submissions: `${SEC_SUBMISSIONS_BASE}/CIK${cik}.json`,
    },
    metadata: {
      ein: safeTrim(submissionsPayload?.ein) || null,
      phone: safeTrim(submissionsPayload?.phone) || null,
      formerNames: toArray(submissionsPayload?.formerNames),
      mailingAddress: submissionsPayload?.addresses?.mailing || null,
      businessAddress: submissionsPayload?.addresses?.business || null,
      flags: submissionsPayload?.flags || null,
    },
  };
}

export function buildFactKey(row) {
  return [
    row.cik,
    row.taxonomy,
    row.concept,
    row.unit,
    safeTrim(row.accession) || 'na',
    safeTrim(row.filedAt) || 'na',
    safeTrim(row.periodEnd) || 'na',
    safeTrim(row.frame) || 'na',
  ].join('::');
}

export function buildFilingKey(row) {
  return [
    row.cik,
    safeTrim(row.accession) || 'na',
    safeTrim(row.filingType) || 'na',
    safeTrim(row.filingDate) || 'na',
  ].join('::');
}

export function buildExposureKey(row) {
  return [
    safeTrim(row.theme) || 'unknown',
    safeTrim(row.entityType) || 'company',
    safeTrim(row.entityKey) || 'unknown',
    safeTrim(row.relationType) || 'beneficiary',
  ].join('::');
}

function findSeedLinksForTicker(ticker) {
  const normalizedTicker = toUpperTicker(ticker);
  if (!normalizedTicker) return [];
  const links = [];
  for (const [theme, seeds] of Object.entries(THEME_ENTITY_SEEDS)) {
    for (const seed of seeds) {
      const seedTicker = toUpperTicker(seed?.symbol || seed?.ticker || seed?.entityKey);
      if (seedTicker !== normalizedTicker) continue;
      links.push({ theme, seed });
    }
  }
  return links;
}

export function buildSeedOnlyExposureRows(profile, options = {}) {
  const normalizedTicker = toUpperTicker(
    profile?.ticker
    || toArray(profile?.tickers)[0]
    || options.ticker,
  );
  const links = findSeedLinksForTicker(normalizedTicker);
  if (!normalizedTicker || links.length === 0) {
    return [];
  }

  const entityLabel = safeTrim(
    profile?.entityName
    || options.entityName
    || links[0]?.seed?.company
    || normalizedTicker,
  ) || normalizedTicker;
  const fallbackReason = safeTrim(options.fallbackReason) || 'SEC mapping unavailable for seeded entity.';

  return links.map(({ theme, seed }) => {
    const row = {
      theme,
      entityType: 'company',
      entityKey: normalizedTicker,
      entityLabel,
      relationType: safeTrim(seed?.relationType) || 'beneficiary',
      sign: safeTrim(seed?.sign) || 'positive',
      confidence: 0.42,
      horizon: safeTrim(seed?.horizon) || 'long',
      evidenceSource: 'theme_entity_seed',
      evidenceNote: `${entityLabel} remains linked via the canonical seed map even though SEC mapping was unavailable for ${normalizedTicker}.`,
      supportingFactKeys: [],
      supportingFilingKeys: [],
      metadata: {
        ticker: normalizedTicker,
        entityName: entityLabel,
        source: 'theme_entity_seed',
        fallbackReason,
      },
    };
    return {
      ...row,
      exposureKey: buildExposureKey(row),
    };
  });
}

export function extractCompanyFactsRows(companyFactsPayload, options = {}) {
  const cik = normalizeCik(options.cik || companyFactsPayload?.cik);
  const entityName = safeTrim(options.entityName || companyFactsPayload?.entityName);
  const ticker = toUpperTicker(options.ticker || companyFactsPayload?.ticker);
  const formsFilter = normalizeForms(options.forms);
  const maxFacts = Number.isFinite(Number(options.maxFacts)) ? Math.max(0, Number(options.maxFacts)) : 0;
  const rows = [];
  const factsByTaxonomy = companyFactsPayload?.facts || {};
  const sourceUrl = `${SEC_COMPANY_FACTS_BASE}/CIK${cik}.json`;

  for (const [taxonomy, concepts] of Object.entries(factsByTaxonomy)) {
    for (const [concept, conceptPayload] of Object.entries(concepts || {})) {
      const units = conceptPayload?.units || {};
      for (const [unit, facts] of Object.entries(units)) {
        for (const fact of toArray(facts)) {
          const form = safeTrim(fact?.form).toUpperCase() || null;
          if (formsFilter.length > 0 && (!form || !formsFilter.includes(form))) continue;

          const numericValue = asMaybeNumber(fact?.val);
          const row = {
            cik,
            ticker,
            entityName,
            taxonomy,
            concept,
            conceptLabel: safeTrim(conceptPayload?.label) || null,
            conceptDescription: safeTrim(conceptPayload?.description) || null,
            unit: safeTrim(unit),
            fiscalYear: safeTrim(fact?.fy) || null,
            fiscalPeriod: safeTrim(fact?.fp) || null,
            form,
            filedAt: normalizeDate(fact?.filed),
            periodEnd: normalizeDate(fact?.end),
            frame: safeTrim(fact?.frame) || null,
            accession: safeTrim(fact?.accn) || null,
            numericValue,
            textValue: numericValue == null && fact?.val != null ? String(fact.val) : null,
            valueType: numericValue == null ? 'text' : 'number',
            sourceUrl,
            metadata: {
              footnote: fact?.footnote || null,
            },
          };
          rows.push({
            ...row,
            factKey: buildFactKey(row),
          });
          if (maxFacts > 0 && rows.length >= maxFacts) {
            return rows;
          }
        }
      }
    }
  }

  return rows;
}

function buildPrimaryDocUrl(cik, accession, primaryDocument) {
  const normalizedCik = String(Number(normalizeCik(cik) || 0));
  const accessionNoDashes = safeTrim(accession).replace(/-/g, '');
  const documentName = safeTrim(primaryDocument);
  if (!normalizedCik || !accessionNoDashes || !documentName) return null;
  return `https://www.sec.gov/Archives/edgar/data/${normalizedCik}/${accessionNoDashes}/${documentName}`;
}

export function extractRecentFilings(submissionsPayload, options = {}) {
  const cik = normalizeCik(options.cik || submissionsPayload?.cik);
  const entityName = safeTrim(options.entityName || submissionsPayload?.name);
  const ticker = toUpperTicker(options.ticker) || toUpperTicker(submissionsPayload?.tickers?.[0]);
  const formsFilter = normalizeForms(options.forms);
  const maxFilings = Number.isFinite(Number(options.maxFilings)) ? Math.max(0, Number(options.maxFilings)) : 0;
  const recent = submissionsPayload?.filings?.recent || {};
  const lengths = Object.values(recent).filter(Array.isArray).map((value) => value.length);
  const total = lengths.length > 0 ? Math.max(...lengths) : 0;
  const sourceUrl = `${SEC_SUBMISSIONS_BASE}/CIK${cik}.json`;
  const rows = [];

  for (let index = 0; index < total; index += 1) {
    const filingType = safeTrim(recent.form?.[index]).toUpperCase();
    if (formsFilter.length > 0 && (!filingType || !formsFilter.includes(filingType))) continue;

    const row = {
      cik,
      ticker,
      entityName,
      accession: safeTrim(recent.accessionNumber?.[index]),
      filingType: filingType || 'UNKNOWN',
      filingDate: normalizeDate(recent.filingDate?.[index]),
      reportDate: normalizeDate(recent.reportDate?.[index]),
      acceptedAt: normalizeTimestamp(recent.acceptanceDateTime?.[index]),
      act: safeTrim(recent.act?.[index]) || null,
      filmNumber: safeTrim(recent.filmNumber?.[index]) || null,
      primaryDocument: safeTrim(recent.primaryDocument?.[index]) || null,
      primaryDocDescription: safeTrim(recent.primaryDocDescription?.[index]) || null,
      primaryDocUrl: buildPrimaryDocUrl(cik, recent.accessionNumber?.[index], recent.primaryDocument?.[index]),
      items: normalizeItems(recent.items?.[index]),
      sizeBytes: toBigIntLike(recent.size?.[index]),
      isXbrl: recent.isXBRL?.[index] === 1 || recent.isXBRL?.[index] === '1' || recent.isXBRL?.[index] === true,
      isInlineXbrl: recent.isInlineXBRL?.[index] === 1 || recent.isInlineXBRL?.[index] === '1' || recent.isInlineXBRL?.[index] === true,
      sourceUrl,
      metadata: {
        accessionNumber: safeTrim(recent.accessionNumber?.[index]) || null,
      },
    };
    rows.push({
      ...row,
      filingKey: buildFilingKey(row),
    });
    if (maxFilings > 0 && rows.length >= maxFilings) {
      return rows;
    }
  }

  return rows;
}

export function buildThemeEntityExposureRows(profile, factRows = [], filingRows = []) {
  const knownTickers = new Set(
    [
      toUpperTicker(profile?.ticker),
      ...toArray(profile?.tickers).map((value) => toUpperTicker(value)),
    ].filter(Boolean),
  );
  if (knownTickers.size === 0) {
    return [];
  }

  const factKeys = factRows.map((row) => row.factKey).filter(Boolean).slice(0, 16);
  const filingKeys = filingRows.map((row) => row.filingKey).filter(Boolean).slice(0, 16);
  const evidenceStrength = Math.min(0.96, 0.56 + (factKeys.length > 0 ? 0.14 : 0) + (filingKeys.length > 0 ? 0.12 : 0));
  const rows = [];

  for (const [theme, seeds] of Object.entries(THEME_ENTITY_SEEDS)) {
    for (const seed of seeds) {
      const seedTicker = toUpperTicker(seed?.symbol || seed?.ticker || seed?.entityKey);
      if (!seedTicker || !knownTickers.has(seedTicker)) continue;

      const row = {
        theme,
        entityType: 'company',
        entityKey: seedTicker,
        entityLabel: safeTrim(seed?.company || seed?.companyName || profile?.entityName || seedTicker) || seedTicker,
        relationType: safeTrim(seed?.relationType) || 'beneficiary',
        sign: safeTrim(seed?.sign) || 'positive',
        confidence: evidenceStrength,
        horizon: safeTrim(seed?.horizon) || 'long',
        evidenceSource: 'theme_entity_seed+sec',
        evidenceNote: `Seeded from the canonical theme-entity map and refreshed with SEC company facts/filings for ${seedTicker}.`,
        supportingFactKeys: factKeys,
        supportingFilingKeys: filingKeys,
        metadata: {
          cik: normalizeCik(profile?.cik),
          ticker: seedTicker,
          entityName: safeTrim(profile?.entityName || seed?.company || seedTicker) || seedTicker,
          exchanges: toArray(profile?.exchanges).filter(Boolean),
          source: 'sec_company_facts',
        },
      };
      rows.push({
        ...row,
        exposureKey: buildExposureKey(row),
      });
    }
  }

  return rows;
}

export async function ensureSecCompanyFactsSchema(queryable) {
  for (const statement of SEC_COMPANY_FACTS_SCHEMA_STATEMENTS) {
    await queryable.query(statement);
  }
}

async function upsertEntityProfile(client, profile) {
  await client.query(`
    INSERT INTO sec_entity_profiles (
      cik, ticker, entity_name, tickers, exchanges, sic, sic_description, category, fiscal_year_end,
      state_of_incorporation, description, website, investor_website, source_urls, metadata,
      last_refreshed_at, updated_at
    )
    VALUES (
      $1, $2, $3, $4::text[], $5::text[], $6, $7, $8, $9,
      $10, $11, $12, $13, $14::jsonb, $15::jsonb,
      NOW(), NOW()
    )
    ON CONFLICT (cik) DO UPDATE SET
      ticker = EXCLUDED.ticker,
      entity_name = EXCLUDED.entity_name,
      tickers = EXCLUDED.tickers,
      exchanges = EXCLUDED.exchanges,
      sic = EXCLUDED.sic,
      sic_description = EXCLUDED.sic_description,
      category = EXCLUDED.category,
      fiscal_year_end = EXCLUDED.fiscal_year_end,
      state_of_incorporation = EXCLUDED.state_of_incorporation,
      description = EXCLUDED.description,
      website = EXCLUDED.website,
      investor_website = EXCLUDED.investor_website,
      source_urls = EXCLUDED.source_urls,
      metadata = EXCLUDED.metadata,
      last_refreshed_at = NOW(),
      updated_at = NOW()
  `, [
    profile.cik,
    profile.ticker,
    profile.entityName,
    profile.tickers,
    profile.exchanges,
    profile.sic,
    profile.sicDescription,
    profile.category,
    profile.fiscalYearEnd,
    profile.stateOfIncorporation,
    profile.description,
    profile.website,
    profile.investorWebsite,
    toJson(profile.sourceUrls),
    toJson(profile.metadata),
  ]);
}

async function upsertCompanyFacts(client, rows) {
  let inserted = 0;
  for (const row of rows) {
    const result = await client.query(`
      INSERT INTO sec_companyfacts_facts (
        fact_key, cik, ticker, entity_name, taxonomy, concept, concept_label, concept_description,
        unit, fiscal_year, fiscal_period, form, filed_at, period_end, frame, accession,
        numeric_value, text_value, value_type, source_url, metadata, imported_at
      )
      VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8,
        $9, $10, $11, $12, $13, $14, $15, $16,
        $17, $18, $19, $20, $21::jsonb, NOW()
      )
      ON CONFLICT (fact_key) DO UPDATE SET
        ticker = EXCLUDED.ticker,
        entity_name = EXCLUDED.entity_name,
        concept_label = EXCLUDED.concept_label,
        concept_description = EXCLUDED.concept_description,
        fiscal_year = EXCLUDED.fiscal_year,
        fiscal_period = EXCLUDED.fiscal_period,
        form = EXCLUDED.form,
        filed_at = EXCLUDED.filed_at,
        period_end = EXCLUDED.period_end,
        frame = EXCLUDED.frame,
        accession = EXCLUDED.accession,
        numeric_value = EXCLUDED.numeric_value,
        text_value = EXCLUDED.text_value,
        value_type = EXCLUDED.value_type,
        source_url = EXCLUDED.source_url,
        metadata = EXCLUDED.metadata,
        imported_at = NOW()
    `, [
      row.factKey,
      row.cik,
      row.ticker,
      row.entityName,
      row.taxonomy,
      row.concept,
      row.conceptLabel,
      row.conceptDescription,
      row.unit,
      row.fiscalYear,
      row.fiscalPeriod,
      row.form,
      row.filedAt,
      row.periodEnd,
      row.frame,
      row.accession,
      row.numericValue,
      row.textValue,
      row.valueType,
      row.sourceUrl,
      toJson(row.metadata),
    ]);
    inserted += Number(result.rowCount || 0);
  }
  return inserted;
}

async function upsertFilingsEvidence(client, rows) {
  let inserted = 0;
  for (const row of rows) {
    const result = await client.query(`
      INSERT INTO sec_filings_evidence (
        filing_key, cik, ticker, entity_name, accession, filing_type, filing_date, report_date,
        accepted_at, act, film_number, primary_document, primary_doc_description, primary_doc_url,
        items, size_bytes, is_xbrl, is_inline_xbrl, source_url, metadata, imported_at
      )
      VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8,
        $9, $10, $11, $12, $13, $14,
        $15::text[], $16, $17, $18, $19, $20::jsonb, NOW()
      )
      ON CONFLICT (filing_key) DO UPDATE SET
        ticker = EXCLUDED.ticker,
        entity_name = EXCLUDED.entity_name,
        filing_date = EXCLUDED.filing_date,
        report_date = EXCLUDED.report_date,
        accepted_at = EXCLUDED.accepted_at,
        act = EXCLUDED.act,
        film_number = EXCLUDED.film_number,
        primary_document = EXCLUDED.primary_document,
        primary_doc_description = EXCLUDED.primary_doc_description,
        primary_doc_url = EXCLUDED.primary_doc_url,
        items = EXCLUDED.items,
        size_bytes = EXCLUDED.size_bytes,
        is_xbrl = EXCLUDED.is_xbrl,
        is_inline_xbrl = EXCLUDED.is_inline_xbrl,
        source_url = EXCLUDED.source_url,
        metadata = EXCLUDED.metadata,
        imported_at = NOW()
    `, [
      row.filingKey,
      row.cik,
      row.ticker,
      row.entityName,
      row.accession,
      row.filingType,
      row.filingDate,
      row.reportDate,
      row.acceptedAt,
      row.act,
      row.filmNumber,
      row.primaryDocument,
      row.primaryDocDescription,
      row.primaryDocUrl,
      row.items,
      row.sizeBytes,
      row.isXbrl,
      row.isInlineXbrl,
      row.sourceUrl,
      toJson(row.metadata),
    ]);
    inserted += Number(result.rowCount || 0);
  }
  return inserted;
}

async function upsertThemeEntityExposure(client, rows) {
  let inserted = 0;
  for (const row of rows) {
    const result = await client.query(`
      INSERT INTO theme_entity_exposure (
        exposure_key, theme, entity_type, entity_key, entity_label, relation_type, sign,
        confidence, horizon, evidence_source, evidence_note, supporting_fact_keys,
        supporting_filing_keys, metadata, updated_at
      )
      VALUES (
        $1, $2, $3, $4, $5, $6, $7,
        $8, $9, $10, $11, $12::text[],
        $13::text[], $14::jsonb, NOW()
      )
      ON CONFLICT (exposure_key) DO UPDATE SET
        entity_label = EXCLUDED.entity_label,
        sign = EXCLUDED.sign,
        confidence = EXCLUDED.confidence,
        horizon = EXCLUDED.horizon,
        evidence_source = EXCLUDED.evidence_source,
        evidence_note = EXCLUDED.evidence_note,
        supporting_fact_keys = EXCLUDED.supporting_fact_keys,
        supporting_filing_keys = EXCLUDED.supporting_filing_keys,
        metadata = EXCLUDED.metadata,
        updated_at = NOW()
    `, [
      row.exposureKey,
      row.theme,
      row.entityType,
      row.entityKey,
      row.entityLabel,
      row.relationType,
      row.sign,
      row.confidence,
      row.horizon,
      row.evidenceSource,
      row.evidenceNote,
      row.supportingFactKeys,
      row.supportingFilingKeys,
      toJson(row.metadata),
    ]);
    inserted += Number(result.rowCount || 0);
  }
  return inserted;
}

export async function runSecCompanyFacts(options = {}, dependencies = {}) {
  const config = { ...parseArgs([]), ...options };
  const normalizedTicker = toUpperTicker(config.ticker);
  let cik = normalizeCik(config.cik);
  if (!cik && !normalizedTicker) {
    throw new Error('Provide either --ticker or --cik.');
  }

  const fetchImpl = dependencies.fetchImpl || fetch;
  const headers = buildSecHeaders(config);
  if (!cik) {
    try {
      cik = await resolveCikForTicker(normalizedTicker, {
        fetchImpl,
        timeoutMs: dependencies.timeoutMs,
        userAgent: config.userAgent,
      });
    } catch (error) {
      const fallbackRows = buildSeedOnlyExposureRows(
        { ticker: normalizedTicker, tickers: [normalizedTicker], entityName: normalizedTicker },
        { fallbackReason: String(error?.message || error || 'SEC mapping unavailable') },
      );
      if (fallbackRows.length === 0) {
        throw error;
      }

      if (config.dryRun) {
        return {
          ok: true,
          dryRun: true,
          fallbackUsed: true,
          cik: null,
          ticker: normalizedTicker,
          entityName: normalizedTicker,
          factCount: 0,
          filingCount: 0,
          exposureCount: fallbackRows.length,
          sample: {
            profile: {
              cik: null,
              ticker: normalizedTicker,
              entityName: normalizedTicker,
              fallbackReason: String(error?.message || error || 'SEC mapping unavailable'),
            },
            facts: [],
            filings: [],
            exposures: fallbackRows.slice(0, 3),
          },
        };
      }

      const client = new Client(dependencies.pgConfig || resolveNasPgConfig());
      await client.connect();
      try {
        await client.query('BEGIN');
        await ensureSecCompanyFactsSchema(client);
        const upsertedExposures = await upsertThemeEntityExposure(client, fallbackRows);
        await client.query('COMMIT');
        return {
          ok: true,
          dryRun: false,
          fallbackUsed: true,
          cik: null,
          ticker: normalizedTicker,
          entityName: normalizedTicker,
          factCount: 0,
          filingCount: 0,
          exposureCount: fallbackRows.length,
          upsertedFacts: 0,
          upsertedFilings: 0,
          upsertedExposures,
        };
      } catch (persistError) {
        await client.query('ROLLBACK').catch(() => {});
        throw persistError;
      } finally {
        await client.end();
      }
    }
  }

  const companyFactsUrl = `${SEC_COMPANY_FACTS_BASE}/CIK${cik}.json`;
  const submissionsUrl = `${SEC_SUBMISSIONS_BASE}/CIK${cik}.json`;
  const [companyFactsPayload, submissionsPayload] = await Promise.all([
    config.includeFacts
      ? fetchJson(companyFactsUrl, { fetchImpl, headers, timeoutMs: dependencies.timeoutMs })
      : Promise.resolve(null),
    config.includeFilings || !config.includeFacts
      ? fetchJson(submissionsUrl, { fetchImpl, headers, timeoutMs: dependencies.timeoutMs })
      : Promise.resolve(null),
  ]);

  const profile = buildEntityProfile(companyFactsPayload, submissionsPayload, {
    cik,
    ticker: normalizedTicker,
  });
  const factRows = config.includeFacts
    ? extractCompanyFactsRows(companyFactsPayload, {
      cik,
      ticker: profile.ticker,
      entityName: profile.entityName,
      maxFacts: config.maxFacts,
      forms: config.forms,
    })
    : [];
  const filingRows = config.includeFilings
    ? extractRecentFilings(submissionsPayload, {
      cik,
      ticker: profile.ticker,
      entityName: profile.entityName,
      maxFilings: config.maxFilings,
      forms: config.forms,
    })
    : [];
  const exposureRows = buildThemeEntityExposureRows(profile, factRows, filingRows);

  if (config.dryRun) {
    return {
      ok: true,
      dryRun: true,
      cik: profile.cik,
      ticker: profile.ticker,
      entityName: profile.entityName,
      factCount: factRows.length,
      filingCount: filingRows.length,
      exposureCount: exposureRows.length,
      sample: {
        profile,
        facts: factRows.slice(0, 3),
        filings: filingRows.slice(0, 3),
        exposures: exposureRows.slice(0, 3),
      },
    };
  }

  const client = new Client(dependencies.pgConfig || resolveNasPgConfig());
  await client.connect();
  try {
    await client.query('BEGIN');
    await ensureSecCompanyFactsSchema(client);
    await upsertEntityProfile(client, profile);
    const upsertedFacts = await upsertCompanyFacts(client, factRows);
    const upsertedFilings = await upsertFilingsEvidence(client, filingRows);
    const upsertedExposures = await upsertThemeEntityExposure(client, exposureRows);
    await client.query('COMMIT');
    return {
      ok: true,
      dryRun: false,
      cik: profile.cik,
      ticker: profile.ticker,
      entityName: profile.entityName,
      factCount: factRows.length,
      filingCount: filingRows.length,
      exposureCount: exposureRows.length,
      upsertedFacts,
      upsertedFilings,
      upsertedExposures,
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    await client.end();
  }
}

const isDirectRun = (() => {
  const entryArg = process.argv[1];
  if (!entryArg) return false;
  try {
    return import.meta.url === pathToFileURL(entryArg).href;
  } catch {
    return false;
  }
})();

if (isDirectRun) {
  runSecCompanyFacts(parseArgs())
    .then((summary) => {
      process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
    })
    .catch((error) => {
      process.stderr.write(`${String(error?.stack || error?.message || error)}\n`);
      process.exit(1);
    });
}
