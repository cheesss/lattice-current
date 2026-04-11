#!/usr/bin/env node

import pg from 'pg';
import { pathToFileURL } from 'node:url';

import { loadOptionalEnvFile, resolveNasPgConfig } from './_shared/nas-runtime.mjs';
import { getThemeConfig } from './_shared/theme-taxonomy.mjs';

loadOptionalEnvFile();

const { Client } = pg;

const OPENALEX_WORKS_BASE = 'https://api.openalex.org/works';
const DEFAULT_MAX_WORKS = 12;
const DEFAULT_LOOKBACK_YEARS = 5;
const DEFAULT_MAILTO = 'contact-required@example.com';

export const OPENALEX_THEME_EVIDENCE_SCHEMA_STATEMENTS = [
  `
    CREATE TABLE IF NOT EXISTS openalex_works (
      work_id TEXT PRIMARY KEY,
      display_name TEXT,
      title TEXT,
      publication_date DATE,
      publication_year INTEGER,
      cited_by_count INTEGER NOT NULL DEFAULT 0,
      source_display_name TEXT,
      source_type TEXT,
      primary_topic TEXT,
      language TEXT,
      doi TEXT,
      openalex_url TEXT,
      landing_page_url TEXT,
      authorships JSONB NOT NULL DEFAULT '[]'::jsonb,
      concepts JSONB NOT NULL DEFAULT '[]'::jsonb,
      abstract_text TEXT,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      raw_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
      imported_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `,
  `
    CREATE INDEX IF NOT EXISTS idx_openalex_works_pubdate
      ON openalex_works (publication_date DESC, cited_by_count DESC);
  `,
  `
    CREATE TABLE IF NOT EXISTS theme_openalex_evidence (
      evidence_key TEXT PRIMARY KEY,
      theme TEXT NOT NULL,
      work_id TEXT NOT NULL REFERENCES openalex_works(work_id) ON DELETE CASCADE,
      search_query TEXT,
      concept_overlap TEXT[] NOT NULL DEFAULT '{}'::text[],
      matched_keywords TEXT[] NOT NULL DEFAULT '{}'::text[],
      theme_match_score DOUBLE PRECISION,
      research_signal_score DOUBLE PRECISION,
      cited_by_count INTEGER NOT NULL DEFAULT 0,
      publication_date DATE,
      publication_year INTEGER,
      evidence_note TEXT,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      imported_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (theme, work_id)
    );
  `,
  `
    CREATE INDEX IF NOT EXISTS idx_theme_openalex_evidence_theme
      ON theme_openalex_evidence (theme, publication_date DESC, cited_by_count DESC);
  `,
  `
    CREATE TABLE IF NOT EXISTS openalex_theme_evidence (
      evidence_key TEXT PRIMARY KEY,
      theme TEXT NOT NULL,
      work_id TEXT NOT NULL,
      title TEXT NOT NULL,
      publication_date DATE,
      publication_year INTEGER,
      cited_by_count INTEGER NOT NULL DEFAULT 0,
      relevance_score DOUBLE PRECISION,
      primary_source TEXT,
      doi TEXT,
      openalex_url TEXT,
      source_url TEXT,
      authors TEXT[] NOT NULL DEFAULT '{}'::text[],
      institutions TEXT[] NOT NULL DEFAULT '{}'::text[],
      concepts TEXT[] NOT NULL DEFAULT '{}'::text[],
      abstract_excerpt TEXT,
      matched_keywords TEXT[] NOT NULL DEFAULT '{}'::text[],
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      raw_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
      imported_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (theme, work_id)
    );
  `,
  `
    CREATE INDEX IF NOT EXISTS idx_openalex_theme_evidence_theme
      ON openalex_theme_evidence (theme, publication_date DESC, cited_by_count DESC);
  `,
  `
    CREATE INDEX IF NOT EXISTS idx_openalex_theme_evidence_work
      ON openalex_theme_evidence (work_id, updated_at DESC);
  `,
];

function safeTrim(value) {
  return String(value ?? '').trim();
}

function normalizeThemeKey(value) {
  return safeTrim(value).toLowerCase();
}

function toArray(value) {
  if (Array.isArray(value)) return value;
  if (value == null) return [];
  return [value];
}

function toJson(value) {
  return JSON.stringify(value ?? {});
}

function dedupeStrings(values, limit = 12) {
  return Array.from(new Set(
    toArray(values)
      .map((entry) => safeTrim(entry))
      .filter(Boolean),
  )).slice(0, limit);
}

function normalizeDate(value) {
  const trimmed = safeTrim(value);
  if (!trimmed) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
  const date = new Date(trimmed);
  return Number.isNaN(date.valueOf()) ? null : date.toISOString().slice(0, 10);
}

function normalizeUrl(value) {
  const trimmed = safeTrim(value);
  return trimmed || null;
}

function buildSinceDate(lookbackYears = DEFAULT_LOOKBACK_YEARS, reference = new Date()) {
  const date = new Date(reference);
  date.setUTCFullYear(date.getUTCFullYear() - Math.max(1, Number(lookbackYears || DEFAULT_LOOKBACK_YEARS)));
  return date.toISOString().slice(0, 10);
}

export function reconstructAbstractFromInvertedIndex(inverted) {
  if (!inverted || typeof inverted !== 'object') return '';
  const tokens = [];
  for (const [token, positions] of Object.entries(inverted)) {
    for (const position of toArray(positions)) {
      const numeric = Number(position);
      if (Number.isFinite(numeric) && numeric >= 0) {
        tokens.push([numeric, token]);
      }
    }
  }
  tokens.sort((left, right) => left[0] - right[0]);
  return tokens.map((entry) => entry[1]).join(' ').replace(/\s+/g, ' ').trim();
}

export function buildOpenAlexHeaders(overrides = {}) {
  const mailto = safeTrim(
    overrides.mailto
    || process.env.OPENALEX_EMAIL
    || process.env.CONTACT_EMAIL
    || DEFAULT_MAILTO,
  );
  const userAgent = safeTrim(
    overrides.userAgent
    || process.env.OPENALEX_USER_AGENT
    || `lattice-trend-intelligence/0.1 (${mailto})`,
  );
  return {
    'User-Agent': userAgent,
    Accept: 'application/json',
  };
}

export function parseArgs(argv = process.argv.slice(2)) {
  const parsed = {
    theme: '',
    themes: [],
    maxWorks: DEFAULT_MAX_WORKS,
    limit: DEFAULT_MAX_WORKS,
    maxPages: 1,
    themeLimit: 24,
    lookbackYears: DEFAULT_LOOKBACK_YEARS,
    fromDate: '',
    dryRun: false,
    mailto: '',
    userAgent: '',
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if ((arg === '--theme' || arg === '--themes') && argv[index + 1]) {
      parsed.themes = safeTrim(argv[++index])
        .split(',')
        .map((value) => normalizeThemeKey(value))
        .filter(Boolean);
    } else if (arg === '--limit' && argv[index + 1]) {
      const value = Number(argv[++index]);
      if (Number.isFinite(value) && value > 0) {
        parsed.limit = Math.floor(value);
        parsed.maxWorks = Math.floor(value);
      }
    } else if (arg === '--max-works' && argv[index + 1]) {
      const value = Number(argv[++index]);
      if (Number.isFinite(value) && value > 0) {
        parsed.maxWorks = Math.floor(value);
        parsed.limit = Math.floor(value);
      }
    } else if (arg === '--theme-limit' && argv[index + 1]) {
      const value = Number(argv[++index]);
      if (Number.isFinite(value) && value > 0) parsed.themeLimit = Math.floor(value);
    } else if ((arg === '--from-date' || arg === '--from-publication-date' || arg === '--since-date') && argv[index + 1]) {
      parsed.fromDate = normalizeDate(argv[++index]) || '';
    } else if (arg === '--max-pages' && argv[index + 1]) {
      const value = Number(argv[++index]);
      if (Number.isFinite(value) && value > 0) parsed.maxPages = Math.floor(value);
    } else if (arg === '--lookback-years' && argv[index + 1]) {
      const value = Number(argv[++index]);
      if (Number.isFinite(value) && value > 0) parsed.lookbackYears = Math.floor(value);
    } else if (arg === '--dry-run') {
      parsed.dryRun = true;
    } else if (arg === '--mailto' && argv[index + 1]) {
      parsed.mailto = argv[++index];
    } else if (arg === '--user-agent' && argv[index + 1]) {
      parsed.userAgent = argv[++index];
    }
  }

  return parsed;
}

export function buildOpenAlexSearchQuery(themeKey) {
  const themeConfig = getThemeConfig(themeKey);
  if (!themeConfig) {
    throw new Error(`Unknown canonical theme: ${themeKey}`);
  }
  const seedTerms = dedupeStrings([
    themeConfig.label,
    ...toArray(themeConfig.keywords).slice(0, 4),
  ], 5);
  return seedTerms.join(' ');
}

export function buildOpenAlexWorksUrl(themeKey, options = {}) {
  const maxWorks = Math.max(1, Number(options.maxWorks || DEFAULT_MAX_WORKS));
  const sinceDate = normalizeDate(options.sinceDate || options.fromDate) || buildSinceDate(options.lookbackYears, options.referenceDate);
  const search = buildOpenAlexSearchQuery(themeKey);
  const url = new URL(OPENALEX_WORKS_BASE);
  url.searchParams.set('search', search);
  url.searchParams.set('sort', 'relevance_score:desc');
  url.searchParams.set('per-page', String(Math.min(maxWorks, 25)));
  url.searchParams.set('filter', `has_abstract:true,is_retracted:false,from_publication_date:${sinceDate}`);
  const mailto = safeTrim(options.mailto || process.env.OPENALEX_EMAIL || process.env.CONTACT_EMAIL);
  if (mailto) {
    url.searchParams.set('mailto', mailto);
  }
  return url.toString();
}

export function buildThemeOpenAlexSearch(themeKey) {
  return {
    theme: normalizeThemeKey(themeKey),
    query: buildOpenAlexSearchQuery(themeKey),
  };
}

export function buildOpenAlexUrl(themeKey, options = {}) {
  return buildOpenAlexWorksUrl(themeKey, {
    ...options,
    maxWorks: options.limit || options.maxWorks,
    sinceDate: options.fromDate || options.sinceDate,
  });
}

function buildEvidenceKey(theme, workId) {
  return `${normalizeThemeKey(theme)}::${safeTrim(workId)}`;
}

function buildAbstractExcerpt(result) {
  const abstractText = safeTrim(result?.abstract || result?.summary || '');
  if (abstractText) return abstractText.slice(0, 500);
  const inverted = result?.abstract_inverted_index;
  if (!inverted || typeof inverted !== 'object') return null;
  const rebuilt = reconstructAbstractFromInvertedIndex(inverted);
  if (!rebuilt) return null;
  return rebuilt.split(/\s+/).slice(0, 80).join(' ');
}

function buildMatchedKeywords(themeKey, title, abstractExcerpt, concepts = []) {
  const themeConfig = getThemeConfig(themeKey);
  const haystack = `${safeTrim(title)} ${safeTrim(abstractExcerpt)} ${dedupeStrings(concepts, 12).join(' ')}`.toLowerCase();
  return dedupeStrings(
    toArray(themeConfig?.keywords).filter((keyword) => haystack.includes(String(keyword || '').toLowerCase())),
    8,
  );
}

function buildConceptOverlap(themeKey, concepts = []) {
  const themeConfig = getThemeConfig(themeKey);
  const haystack = dedupeStrings(concepts, 12).join(' ').toLowerCase();
  return dedupeStrings(
    toArray(themeConfig?.keywords).filter((keyword) => haystack.includes(String(keyword || '').toLowerCase())),
    8,
  );
}

function buildThemeMatchScore(themeKey, matchedKeywords = [], conceptOverlap = []) {
  const themeConfig = getThemeConfig(themeKey);
  const seedTerms = dedupeStrings([
    themeConfig?.label,
    ...toArray(themeConfig?.keywords).slice(0, 4),
  ], 5);
  const base = Math.max(1, Math.min(seedTerms.length, 4));
  const score = ((matchedKeywords.length * 0.9) + (conceptOverlap.length * 0.6) + 0.1) / base;
  return Math.min(1, Math.round(score * 100) / 100);
}

export function normalizeOpenAlexWork(themeKey, result) {
  const workId = safeTrim(result?.id);
  const title = safeTrim(result?.display_name || result?.title);
  if (!workId || !title) return null;
  const publicationDate = normalizeDate(result?.publication_date);
  const abstractExcerpt = buildAbstractExcerpt(result);
  const authorships = toArray(result?.authorships);
  const primarySource = safeTrim(
    result?.primary_location?.source?.display_name
    || result?.host_venue?.display_name,
  );
  const sourceUrl = normalizeUrl(
    result?.primary_location?.landing_page_url
    || result?.primary_location?.pdf_url
    || result?.ids?.doi,
  );
  const authors = dedupeStrings(authorships.map((entry) => {
    if (typeof entry?.author === 'string') return entry.author;
    return entry?.author?.display_name;
  }), 10);
  const concepts = dedupeStrings(toArray(result?.concepts).map((entry) => entry?.display_name), 10);
  const matchedKeywords = buildMatchedKeywords(themeKey, title, abstractExcerpt, concepts);
  const conceptOverlap = buildConceptOverlap(themeKey, concepts);
  const themeMatchScore = buildThemeMatchScore(themeKey, matchedKeywords, conceptOverlap);
  return {
    evidenceKey: buildEvidenceKey(themeKey, workId),
    theme: normalizeThemeKey(themeKey),
    workId,
    title,
    publicationDate,
    publicationYear: Number(result?.publication_year || (publicationDate ? publicationDate.slice(0, 4) : 0)) || null,
    citedByCount: Number(result?.cited_by_count || 0),
    relevanceScore: Number.isFinite(Number(result?.relevance_score)) ? Number(result.relevance_score) : null,
    primarySource: primarySource || null,
    doi: normalizeUrl(result?.doi || result?.ids?.doi),
    openalexUrl: normalizeUrl(result?.id),
    sourceUrl,
    authors,
    institutions: dedupeStrings(
      authorships.flatMap((entry) => toArray(entry?.institutions).map((institution) => institution?.display_name)),
      10,
    ),
    concepts,
    abstractExcerpt: abstractExcerpt || null,
    matchedKeywords,
    conceptOverlap,
    themeMatchScore,
    metadata: {
      type: safeTrim(result?.type),
      primaryTopic: safeTrim(result?.primary_topic?.display_name),
      citedByApiUrl: normalizeUrl(result?.cited_by_api_url),
      language: safeTrim(result?.language),
    },
    rawPayload: result,
  };
}

export function mapOpenAlexWork(themeKey, result) {
  const normalized = normalizeOpenAlexWork(themeKey, result);
  if (!normalized) return null;
  return {
    workRow: {
      workId: normalized.workId,
      displayName: normalized.title,
      title: normalized.title,
      publicationDate: normalized.publicationDate,
      publicationYear: normalized.publicationYear,
      citedByCount: normalized.citedByCount,
      sourceDisplayName: normalized.primarySource,
      sourceType: normalized.metadata.type || 'research',
      primaryTopic: normalized.metadata.primaryTopic,
      language: normalized.metadata.language,
      doi: normalized.doi,
      openalexUrl: normalized.openalexUrl,
      landingPageUrl: normalized.sourceUrl,
      authorships: normalized.authors.map((author) => ({ author })),
      concepts: normalized.concepts.map((displayName) => ({ displayName })),
      abstractText: normalized.abstractExcerpt,
      metadata: normalized.metadata,
      rawPayload: normalized.rawPayload,
    },
    evidenceRow: {
      evidenceKey: normalized.evidenceKey,
      theme: normalized.theme,
      workId: normalized.workId,
      title: normalized.title,
      publicationDate: normalized.publicationDate,
      publicationYear: normalized.publicationYear,
      citedByCount: normalized.citedByCount,
      relevanceScore: normalized.relevanceScore,
      researchSignalScore: normalized.relevanceScore ?? normalized.themeMatchScore,
      matchedKeywords: normalized.matchedKeywords,
      conceptOverlap: normalized.conceptOverlap,
      themeMatchScore: normalized.themeMatchScore,
      evidenceNote: normalized.abstractExcerpt,
      metadata: normalized.metadata,
    },
  };
}

async function fetchJson(url, { fetchImpl = fetch, headers = {}, timeoutMs = 20_000 } = {}) {
  const response = await fetchImpl(url, {
    headers,
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) {
    throw new Error(`OpenAlex ${response.status} for ${url}`);
  }
  return response.json();
}

export async function ensureOpenAlexThemeEvidenceSchema(queryable) {
  for (const statement of OPENALEX_THEME_EVIDENCE_SCHEMA_STATEMENTS) {
    await queryable.query(statement);
  }
}

async function upsertOpenAlexWorks(client, rows) {
  let upserted = 0;
  for (const row of rows) {
    const result = await client.query(`
      INSERT INTO openalex_works (
        work_id, display_name, title, publication_date, publication_year,
        cited_by_count, source_display_name, source_type, primary_topic, language,
        doi, openalex_url, landing_page_url, authorships, concepts, abstract_text,
        metadata, raw_payload, imported_at, updated_at
      )
      VALUES (
        $1, $2, $3, $4::date, $5,
        $6, $7, $8, $9, $10,
        $11, $12, $13, $14::jsonb, $15::jsonb, $16,
        $17::jsonb, $18::jsonb, NOW(), NOW()
      )
      ON CONFLICT (work_id) DO UPDATE SET
        display_name = EXCLUDED.display_name,
        title = EXCLUDED.title,
        publication_date = EXCLUDED.publication_date,
        publication_year = EXCLUDED.publication_year,
        cited_by_count = EXCLUDED.cited_by_count,
        source_display_name = EXCLUDED.source_display_name,
        source_type = EXCLUDED.source_type,
        primary_topic = EXCLUDED.primary_topic,
        language = EXCLUDED.language,
        doi = EXCLUDED.doi,
        openalex_url = EXCLUDED.openalex_url,
        landing_page_url = EXCLUDED.landing_page_url,
        authorships = EXCLUDED.authorships,
        concepts = EXCLUDED.concepts,
        abstract_text = EXCLUDED.abstract_text,
        metadata = EXCLUDED.metadata,
        raw_payload = EXCLUDED.raw_payload,
        updated_at = NOW()
    `, [
      row.workId,
      row.displayName,
      row.title,
      row.publicationDate,
      row.publicationYear,
      row.citedByCount,
      row.sourceDisplayName,
      row.sourceType,
      row.primaryTopic,
      row.language,
      row.doi,
      row.openalexUrl,
      row.landingPageUrl,
      toJson(row.authorships),
      toJson(row.concepts),
      row.abstractText,
      toJson(row.metadata),
      toJson(row.rawPayload),
    ]);
    upserted += Number(result.rowCount || 0);
  }
  return upserted;
}

async function upsertThemeOpenAlexEvidence(client, rows) {
  let upserted = 0;
  for (const row of rows) {
    const result = await client.query(`
      INSERT INTO theme_openalex_evidence (
        evidence_key, theme, work_id, search_query, concept_overlap, matched_keywords,
        theme_match_score, research_signal_score, cited_by_count, publication_date, publication_year,
        evidence_note, metadata, imported_at, updated_at
      )
      VALUES (
        $1, $2, $3, $4, $5::text[], $6::text[],
        $7, $8, $9, $10::date, $11,
        $12, $13::jsonb, NOW(), NOW()
      )
      ON CONFLICT (evidence_key) DO UPDATE SET
        search_query = EXCLUDED.search_query,
        concept_overlap = EXCLUDED.concept_overlap,
        matched_keywords = EXCLUDED.matched_keywords,
        theme_match_score = EXCLUDED.theme_match_score,
        research_signal_score = EXCLUDED.research_signal_score,
        cited_by_count = EXCLUDED.cited_by_count,
        publication_date = EXCLUDED.publication_date,
        publication_year = EXCLUDED.publication_year,
        evidence_note = EXCLUDED.evidence_note,
        metadata = EXCLUDED.metadata,
        updated_at = NOW()
    `, [
      row.evidenceKey,
      row.theme,
      row.workId,
      row.searchQuery,
      row.conceptOverlap,
      row.matchedKeywords,
      row.themeMatchScore,
      row.researchSignalScore,
      row.citedByCount,
      row.publicationDate,
      row.publicationYear,
      row.evidenceNote,
      toJson(row.metadata),
    ]);
    upserted += Number(result.rowCount || 0);
  }
  return upserted;
}

async function upsertOpenAlexThemeEvidence(client, rows) {
  let upserted = 0;
  for (const row of rows) {
    const result = await client.query(`
      INSERT INTO openalex_theme_evidence (
        evidence_key, theme, work_id, title, publication_date, publication_year,
        cited_by_count, relevance_score, primary_source, doi, openalex_url, source_url,
        authors, institutions, concepts, abstract_excerpt, matched_keywords, metadata, raw_payload, imported_at, updated_at
      )
      VALUES (
        $1, $2, $3, $4, $5::date, $6,
        $7, $8, $9, $10, $11, $12,
        $13::text[], $14::text[], $15::text[], $16, $17::text[], $18::jsonb, $19::jsonb, NOW(), NOW()
      )
      ON CONFLICT (evidence_key) DO UPDATE SET
        title = EXCLUDED.title,
        publication_date = EXCLUDED.publication_date,
        publication_year = EXCLUDED.publication_year,
        cited_by_count = EXCLUDED.cited_by_count,
        relevance_score = EXCLUDED.relevance_score,
        primary_source = EXCLUDED.primary_source,
        doi = EXCLUDED.doi,
        openalex_url = EXCLUDED.openalex_url,
        source_url = EXCLUDED.source_url,
        authors = EXCLUDED.authors,
        institutions = EXCLUDED.institutions,
        concepts = EXCLUDED.concepts,
        abstract_excerpt = EXCLUDED.abstract_excerpt,
        matched_keywords = EXCLUDED.matched_keywords,
        metadata = EXCLUDED.metadata,
        raw_payload = EXCLUDED.raw_payload,
        updated_at = NOW()
    `, [
      row.evidenceKey,
      row.theme,
      row.workId,
      row.title,
      row.publicationDate,
      row.publicationYear,
      row.citedByCount,
      row.relevanceScore,
      row.primarySource,
      row.doi,
      row.openalexUrl,
      row.sourceUrl,
      row.authors,
      row.institutions,
      row.concepts,
      row.abstractExcerpt,
      row.matchedKeywords,
      toJson(row.metadata),
      toJson(row.rawPayload),
    ]);
    upserted += Number(result.rowCount || 0);
  }
  return upserted;
}

export async function runOpenAlexThemeEvidence(options = {}, dependencies = {}) {
  const config = { ...parseArgs([]), ...options };
  const themes = dedupeStrings(config.themes, Number(config.themeLimit || 24)).filter((theme) => getThemeConfig(theme));
  if (!themes.length) {
    throw new Error('At least one canonical theme is required.');
  }

  const queryable = dependencies.safeQuery
    ? { query: dependencies.safeQuery }
    : (() => {
      const client = new Client(dependencies.pgConfig || resolveNasPgConfig());
      return client;
    })();
  const ownsClient = typeof queryable.connect === 'function';
  if (ownsClient) {
    await queryable.connect();
  }

  const headers = buildOpenAlexHeaders({
    mailto: config.mailto,
    userAgent: config.userAgent,
  });

  try {
    const summaries = [];
    if (!config.dryRun) {
      await queryable.query('BEGIN');
      await ensureOpenAlexThemeEvidenceSchema(queryable);
    }

    for (const theme of themes) {
      const url = buildOpenAlexWorksUrl(theme, {
        maxWorks: config.limit || config.maxWorks,
        lookbackYears: config.lookbackYears,
        sinceDate: config.fromDate,
        mailto: config.mailto,
      });
      const payload = await fetchJson(url, {
        fetchImpl: dependencies.fetchImpl,
        headers,
        timeoutMs: dependencies.timeoutMs,
      });
      const mappedRows = toArray(payload?.results)
        .map((result) => mapOpenAlexWork(theme, result))
        .filter(Boolean);
      const limit = Number(config.limit || config.maxWorks || DEFAULT_MAX_WORKS);
      const topRows = mappedRows.slice(0, limit);
      const upsertedWorks = config.dryRun ? 0 : await upsertOpenAlexWorks(queryable, topRows.map((entry) => entry.workRow));
      const upsertedModernEvidence = config.dryRun ? 0 : await upsertThemeOpenAlexEvidence(queryable, topRows.map((entry) => ({
        ...entry.evidenceRow,
        searchQuery: buildOpenAlexSearchQuery(theme),
      })));
      const upsertedLegacyEvidence = config.dryRun ? 0 : await upsertOpenAlexThemeEvidence(queryable, topRows.map((entry) => ({
        evidenceKey: entry.evidenceRow.evidenceKey,
        theme: entry.evidenceRow.theme,
        workId: entry.evidenceRow.workId,
        title: entry.evidenceRow.title,
        publicationDate: entry.evidenceRow.publicationDate,
        publicationYear: entry.evidenceRow.publicationYear,
        citedByCount: entry.evidenceRow.citedByCount,
        relevanceScore: entry.evidenceRow.relevanceScore,
        primarySource: entry.workRow.sourceDisplayName,
        doi: entry.workRow.doi,
        openalexUrl: entry.workRow.openalexUrl,
        sourceUrl: entry.workRow.landingPageUrl,
        authors: entry.workRow.authorships.map((item) => item.author).filter(Boolean),
        institutions: [],
        concepts: entry.workRow.concepts.map((item) => item.displayName).filter(Boolean),
        abstractExcerpt: entry.workRow.abstractText,
        matchedKeywords: entry.evidenceRow.matchedKeywords,
        metadata: {
          ...entry.evidenceRow.metadata,
          themeMatchScore: entry.evidenceRow.themeMatchScore,
          conceptOverlap: entry.evidenceRow.conceptOverlap,
          searchQuery: buildOpenAlexSearchQuery(theme),
        },
        rawPayload: entry.workRow.rawPayload,
      })));
      summaries.push({
        theme,
        query: buildOpenAlexSearchQuery(theme),
        fetchedCount: mappedRows.length,
        storedCount: topRows.length,
        upserted: upsertedModernEvidence,
        sample: topRows.slice(0, 3).map((entry) => entry.workRow),
      });
      summaries[summaries.length - 1].upsertedWorks = upsertedWorks;
      summaries[summaries.length - 1].upsertedLegacyEvidence = upsertedLegacyEvidence;
    }

    if (!config.dryRun) {
      await queryable.query('COMMIT');
    }

    return {
      ok: true,
      dryRun: config.dryRun,
      themeCount: themes.length,
      workCount: summaries.reduce((sum, item) => sum + Number(item.storedCount || 0), 0),
      evidenceCount: summaries.reduce((sum, item) => sum + Number(item.storedCount || 0), 0),
      themes: summaries.map((item) => ({ theme: item.theme, query: item.query, storedCount: item.storedCount })),
      sample: {
        works: summaries.flatMap((item) => item.sample || []).slice(0, 5),
      },
      summaries,
    };
  } catch (error) {
    if (!config.dryRun) {
      await queryable.query('ROLLBACK').catch(() => {});
    }
    throw error;
  } finally {
    if (ownsClient) {
      await queryable.end();
    }
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
  runOpenAlexThemeEvidence(parseArgs())
    .then((summary) => {
      process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
    })
    .catch((error) => {
      process.stderr.write(`${String(error?.stack || error?.message || error)}\n`);
      process.exit(1);
    });
}
