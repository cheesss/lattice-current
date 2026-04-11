#!/usr/bin/env node

import pg from 'pg';
import { pathToFileURL } from 'node:url';

import { loadOptionalEnvFile, resolveNasPgConfig } from './_shared/nas-runtime.mjs';
import { getThemeConfig } from './_shared/theme-taxonomy.mjs';

loadOptionalEnvFile();

const { Client } = pg;

const GITHUB_SEARCH_BASE = 'https://api.github.com/search/repositories';
const DEFAULT_MAX_REPOS = 10;

export const GITHUB_THEME_EVIDENCE_SCHEMA_STATEMENTS = [
  `
    CREATE TABLE IF NOT EXISTS github_repositories (
      repo_key TEXT PRIMARY KEY,
      full_name TEXT NOT NULL,
      owner_login TEXT,
      name TEXT,
      html_url TEXT,
      description TEXT,
      homepage_url TEXT,
      language TEXT,
      topics JSONB NOT NULL DEFAULT '[]'::jsonb,
      stargazers_count INTEGER NOT NULL DEFAULT 0,
      watchers_count INTEGER NOT NULL DEFAULT 0,
      forks_count INTEGER NOT NULL DEFAULT 0,
      open_issues_count INTEGER NOT NULL DEFAULT 0,
      default_branch TEXT,
      license_name TEXT,
      archived BOOLEAN NOT NULL DEFAULT FALSE,
      fork BOOLEAN NOT NULL DEFAULT FALSE,
      created_at_github TIMESTAMPTZ,
      pushed_at TIMESTAMPTZ,
      updated_at_github TIMESTAMPTZ,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      raw_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
      imported_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `,
  `
    CREATE INDEX IF NOT EXISTS idx_github_repositories_pushed
      ON github_repositories (pushed_at DESC, stargazers_count DESC);
  `,
  `
    CREATE TABLE IF NOT EXISTS theme_github_evidence (
      evidence_key TEXT PRIMARY KEY,
      theme TEXT NOT NULL,
      repo_key TEXT NOT NULL REFERENCES github_repositories(repo_key) ON DELETE CASCADE,
      search_query TEXT,
      matched_keywords TEXT[] NOT NULL DEFAULT '{}'::text[],
      github_signal_score DOUBLE PRECISION,
      stargazers_count INTEGER NOT NULL DEFAULT 0,
      pushed_at TIMESTAMPTZ,
      evidence_note TEXT,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      imported_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (theme, repo_key)
    );
  `,
  `
    CREATE INDEX IF NOT EXISTS idx_theme_github_evidence_theme
      ON theme_github_evidence (theme, pushed_at DESC, stargazers_count DESC);
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
  const date = new Date(trimmed);
  return Number.isNaN(date.valueOf()) ? null : date.toISOString();
}

function round(value, digits = 2) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  const factor = 10 ** digits;
  return Math.round(numeric * factor) / factor;
}

function clamp(value, min, max) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return min;
  return Math.min(max, Math.max(min, numeric));
}

export function parseArgs(argv = process.argv.slice(2)) {
  const parsed = {
    themes: [],
    limit: DEFAULT_MAX_REPOS,
    maxRepos: DEFAULT_MAX_REPOS,
    dryRun: false,
    userAgent: '',
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if ((arg === '--theme' || arg === '--themes') && argv[index + 1]) {
      parsed.themes = safeTrim(argv[++index])
        .split(',')
        .map((value) => normalizeThemeKey(value))
        .filter(Boolean);
    } else if ((arg === '--limit' || arg === '--max-repos') && argv[index + 1]) {
      const value = Number(argv[++index]);
      if (Number.isFinite(value) && value > 0) {
        parsed.limit = Math.floor(value);
        parsed.maxRepos = Math.floor(value);
      }
    } else if (arg === '--dry-run') {
      parsed.dryRun = true;
    } else if (arg === '--user-agent' && argv[index + 1]) {
      parsed.userAgent = argv[++index];
    }
  }

  return parsed;
}

export function buildGitHubHeaders(overrides = {}) {
  const headers = {
    'User-Agent': safeTrim(overrides.userAgent || process.env.GITHUB_USER_AGENT || 'lattice-trend-intelligence'),
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  const token = safeTrim(overrides.token || process.env.GITHUB_TOKEN || '');
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

export function buildGitHubSearchQuery(themeKey) {
  const themeConfig = getThemeConfig(themeKey);
  if (!themeConfig) {
    throw new Error(`Unknown canonical theme: ${themeKey}`);
  }
  const terms = dedupeStrings([
    themeConfig.label,
    ...toArray(themeConfig.keywords).slice(0, 4),
  ], 5);
  const query = terms
    .map((term) => `"${term.replace(/"/g, '')}"`)
    .join(' OR ');
  return `${query} in:name,description,readme archived:false fork:false`;
}

export function buildGitHubSearchUrl(themeKey, options = {}) {
  const maxRepos = Math.max(1, Number(options.maxRepos || DEFAULT_MAX_REPOS));
  const url = new URL(GITHUB_SEARCH_BASE);
  url.searchParams.set('q', buildGitHubSearchQuery(themeKey));
  url.searchParams.set('sort', 'stars');
  url.searchParams.set('order', 'desc');
  url.searchParams.set('per_page', String(Math.min(50, maxRepos)));
  return url.toString();
}

function findMatchedKeywords(themeConfig, repository) {
  const haystack = [
    repository.full_name,
    repository.name,
    repository.description,
    ...(repository.topics || []),
  ].join(' ').toLowerCase();
  return dedupeStrings(
    toArray(themeConfig?.keywords).filter((keyword) => haystack.includes(String(keyword).toLowerCase())),
    8,
  );
}

function computeGithubSignalScore(repository, matchedKeywords = []) {
  const stars = clamp(Math.log10(Number(repository.stargazersCount || 0) + 1), 0, 6);
  const forks = clamp(Math.log10(Number(repository.forksCount || 0) + 1), 0, 5);
  const recencyDays = repository.pushedAt
    ? Math.max(0, (Date.now() - new Date(repository.pushedAt).valueOf()) / 86_400_000)
    : 365;
  const recency = clamp(1 - (recencyDays / 365), 0, 1);
  const keywordScore = clamp(matchedKeywords.length / 4, 0, 1);
  return round((stars * 0.4) + (forks * 0.15) + (recency * 2.5) + (keywordScore * 2), 2);
}

export function mapGitHubRepository(item, themeConfig = null) {
  const repository = {
    repoKey: safeTrim(item?.node_id || item?.full_name || item?.name),
    fullName: safeTrim(item?.full_name),
    ownerLogin: safeTrim(item?.owner?.login),
    name: safeTrim(item?.name),
    htmlUrl: safeTrim(item?.html_url),
    description: safeTrim(item?.description),
    homepageUrl: safeTrim(item?.homepage),
    language: safeTrim(item?.language),
    topics: dedupeStrings(item?.topics || [], 12),
    stargazersCount: Number(item?.stargazers_count || 0),
    watchersCount: Number(item?.watchers_count || 0),
    forksCount: Number(item?.forks_count || 0),
    openIssuesCount: Number(item?.open_issues_count || 0),
    defaultBranch: safeTrim(item?.default_branch),
    licenseName: safeTrim(item?.license?.spdx_id || item?.license?.name),
    archived: Boolean(item?.archived),
    fork: Boolean(item?.fork),
    createdAt: normalizeDate(item?.created_at),
    pushedAt: normalizeDate(item?.pushed_at),
    updatedAt: normalizeDate(item?.updated_at),
    metadata: {
      score: Number(item?.score || 0),
      visibility: safeTrim(item?.visibility),
      isTemplate: Boolean(item?.is_template),
    },
    rawPayload: item || {},
  };
  const matchedKeywords = findMatchedKeywords(themeConfig, repository);
  repository.matchedKeywords = matchedKeywords;
  repository.githubSignalScore = computeGithubSignalScore(repository, matchedKeywords);
  return repository;
}

async function upsertRepositoryRows(client, repositories = []) {
  for (const repo of repositories) {
    await client.query(`
      INSERT INTO github_repositories (
        repo_key, full_name, owner_login, name, html_url, description, homepage_url, language, topics,
        stargazers_count, watchers_count, forks_count, open_issues_count, default_branch, license_name,
        archived, fork, created_at_github, pushed_at, updated_at_github, metadata, raw_payload, imported_at, updated_at
      )
      VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb,
        $10, $11, $12, $13, $14, $15,
        $16, $17, $18::timestamptz, $19::timestamptz, $20::timestamptz, $21::jsonb, $22::jsonb, NOW(), NOW()
      )
      ON CONFLICT (repo_key) DO UPDATE SET
        full_name = EXCLUDED.full_name,
        owner_login = EXCLUDED.owner_login,
        name = EXCLUDED.name,
        html_url = EXCLUDED.html_url,
        description = EXCLUDED.description,
        homepage_url = EXCLUDED.homepage_url,
        language = EXCLUDED.language,
        topics = EXCLUDED.topics,
        stargazers_count = EXCLUDED.stargazers_count,
        watchers_count = EXCLUDED.watchers_count,
        forks_count = EXCLUDED.forks_count,
        open_issues_count = EXCLUDED.open_issues_count,
        default_branch = EXCLUDED.default_branch,
        license_name = EXCLUDED.license_name,
        archived = EXCLUDED.archived,
        fork = EXCLUDED.fork,
        created_at_github = EXCLUDED.created_at_github,
        pushed_at = EXCLUDED.pushed_at,
        updated_at_github = EXCLUDED.updated_at_github,
        metadata = EXCLUDED.metadata,
        raw_payload = EXCLUDED.raw_payload,
        updated_at = NOW()
    `, [
      repo.repoKey,
      repo.fullName,
      repo.ownerLogin || null,
      repo.name || null,
      repo.htmlUrl || null,
      repo.description || null,
      repo.homepageUrl || null,
      repo.language || null,
      toJson(repo.topics || []),
      repo.stargazersCount,
      repo.watchersCount,
      repo.forksCount,
      repo.openIssuesCount,
      repo.defaultBranch || null,
      repo.licenseName || null,
      repo.archived,
      repo.fork,
      repo.createdAt,
      repo.pushedAt,
      repo.updatedAt,
      toJson(repo.metadata),
      toJson(repo.rawPayload),
    ]);
  }
}

async function upsertThemeEvidenceRows(client, themeKey, repositories = []) {
  for (const repo of repositories) {
    await client.query(`
      INSERT INTO theme_github_evidence (
        evidence_key, theme, repo_key, search_query, matched_keywords, github_signal_score,
        stargazers_count, pushed_at, evidence_note, metadata, imported_at, updated_at
      )
      VALUES (
        $1, $2, $3, $4, $5::text[], $6,
        $7, $8::timestamptz, $9, $10::jsonb, NOW(), NOW()
      )
      ON CONFLICT (theme, repo_key) DO UPDATE SET
        search_query = EXCLUDED.search_query,
        matched_keywords = EXCLUDED.matched_keywords,
        github_signal_score = EXCLUDED.github_signal_score,
        stargazers_count = EXCLUDED.stargazers_count,
        pushed_at = EXCLUDED.pushed_at,
        evidence_note = EXCLUDED.evidence_note,
        metadata = EXCLUDED.metadata,
        updated_at = NOW()
    `, [
      `${themeKey}::${repo.repoKey}`,
      themeKey,
      repo.repoKey,
      buildGitHubSearchQuery(themeKey),
      repo.matchedKeywords,
      repo.githubSignalScore,
      repo.stargazersCount,
      repo.pushedAt,
      `${repo.fullName} matched ${repo.matchedKeywords.length || 0} theme keywords with ${repo.stargazersCount} stars.`,
      toJson({
        ownerLogin: repo.ownerLogin,
        language: repo.language,
        forksCount: repo.forksCount,
      }),
    ]);
  }
}

export async function runGitHubThemeEvidence(options = {}, runtime = {}) {
  const themes = dedupeStrings(options.themes || [], Number(options.themeLimit || 24))
    .map((value) => normalizeThemeKey(value))
    .filter(Boolean);
  if (!themes.length) {
    return {
      ok: false,
      error: 'At least one canonical theme is required.',
      themeCount: 0,
      repoCount: 0,
      evidenceCount: 0,
      themes: [],
    };
  }

  const headers = buildGitHubHeaders(options);
  const fetchImpl = runtime.fetchImpl || globalThis.fetch;
  const dryRun = Boolean(options.dryRun);
  let client = null;
  if (!dryRun) {
    client = new Client(resolveNasPgConfig());
    await client.connect();
    for (const statement of GITHUB_THEME_EVIDENCE_SCHEMA_STATEMENTS) {
      await client.query(statement);
    }
  }

  try {
    const summaries = [];
    let totalRepos = 0;
    let totalEvidence = 0;

    for (const themeKey of themes) {
      const themeConfig = getThemeConfig(themeKey);
      if (!themeConfig) {
        summaries.push({ theme: themeKey, skipped: true, reason: 'unknown-theme' });
        continue;
      }
      const response = await fetchImpl(buildGitHubSearchUrl(themeKey, options), { headers });
      if (!response.ok) {
        throw new Error(`GitHub search failed for ${themeKey}: ${response.status} ${response.statusText}`);
      }
      const payload = await response.json();
      const repositories = dedupeStrings((payload.items || []).map((item) => item.full_name), Number(options.maxRepos || DEFAULT_MAX_REPOS))
        .map((fullName) => (payload.items || []).find((item) => item.full_name === fullName))
        .filter(Boolean)
        .map((item) => mapGitHubRepository(item, themeConfig))
        .sort((left, right) => Number(right.githubSignalScore || 0) - Number(left.githubSignalScore || 0))
        .slice(0, Number(options.maxRepos || DEFAULT_MAX_REPOS));

      totalRepos += repositories.length;
      totalEvidence += repositories.length;
      summaries.push({
        theme: themeKey,
        repoCount: repositories.length,
        topRepository: repositories[0]?.fullName || null,
      });

      if (!dryRun && repositories.length > 0) {
        await upsertRepositoryRows(client, repositories);
        await upsertThemeEvidenceRows(client, themeKey, repositories);
      }
    }

    return {
      ok: true,
      dryRun,
      themeCount: themes.length,
      repoCount: totalRepos,
      evidenceCount: totalEvidence,
      themes: summaries,
    };
  } finally {
    if (client) await client.end();
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
  runGitHubThemeEvidence(parseArgs())
    .then((summary) => {
      process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
    })
    .catch((error) => {
      process.stderr.write(`${String(error?.stack || error?.message || error)}\n`);
      process.exit(1);
    });
}
