#!/usr/bin/env node

import pg from 'pg';
import { pathToFileURL } from 'node:url';
import { loadOptionalEnvFile, resolveNasPgConfig } from './_shared/nas-runtime.mjs';

loadOptionalEnvFile();

const { Client } = pg;

function parseArgs(argv = process.argv.slice(2)) {
  const parsed = {
    query: '',
    from: '2024-01-01',
    limit: 1000,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--query' && argv[index + 1]) {
      parsed.query = argv[++index];
    } else if (arg === '--from' && argv[index + 1]) {
      parsed.from = argv[++index];
    } else if (arg === '--limit' && argv[index + 1]) {
      const value = Number(argv[++index]);
      if (Number.isFinite(value) && value > 0) parsed.limit = Math.floor(value);
    }
  }
  return parsed;
}

function assertEnv(name) {
  const value = String(process.env[name] || '').trim();
  return value;
}

async function ensureSchema(client) {
  await client.query('ALTER TABLE articles ADD COLUMN IF NOT EXISTS url TEXT').catch(() => {});
  await client.query('CREATE UNIQUE INDEX IF NOT EXISTS articles_url_idx ON articles (url)').catch(() => {});
}

async function fetchGuardian(query, from, limit) {
  const apiKey = assertEnv('GUARDIAN_API_KEY');
  if (!apiKey) return [];
  const url = new URL('https://content.guardianapis.com/search');
  url.searchParams.set('q', query);
  url.searchParams.set('from-date', from);
  url.searchParams.set('page-size', String(Math.min(200, limit)));
  url.searchParams.set('show-fields', 'trailText');
  url.searchParams.set('order-by', 'newest');
  url.searchParams.set('api-key', apiKey);
  const response = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error(`Guardian ${response.status}`);
  const payload = await response.json();
  return (payload?.response?.results || []).map((article) => ({
    source: 'guardian',
    publishedAt: article.webPublicationDate,
    title: article.webTitle,
    summary: article.fields?.trailText || '',
    url: article.webUrl,
  }));
}

async function fetchNyt(query, from, limit) {
  const apiKey = assertEnv('NYT_API_KEY');
  if (!apiKey) return [];
  const beginDate = String(from).replace(/-/g, '').slice(0, 8);
  const articles = [];
  const maxPages = Math.max(1, Math.min(5, Math.ceil(limit / 10)));
  for (let page = 0; page < maxPages; page += 1) {
    const url = new URL('https://api.nytimes.com/svc/search/v2/articlesearch.json');
    url.searchParams.set('q', query);
    url.searchParams.set('begin_date', beginDate);
    url.searchParams.set('sort', 'newest');
    url.searchParams.set('page', String(page));
    url.searchParams.set('api-key', apiKey);
    const response = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    if (!response.ok) throw new Error(`NYT ${response.status}`);
    const payload = await response.json();
    const docs = payload?.response?.docs || [];
    for (const doc of docs) {
      articles.push({
        source: 'nyt',
        publishedAt: doc.pub_date,
        title: doc.headline?.main || '',
        summary: doc.abstract || doc.snippet || '',
        url: doc.web_url,
      });
    }
    if (docs.length < 10) break;
  }
  return articles.slice(0, limit);
}

export async function runKeywordNewsBackfill(options = {}) {
  const args = { ...parseArgs([]), ...options };
  if (!String(args.query || '').trim()) {
    throw new Error('Missing --query');
  }
  if (!assertEnv('GUARDIAN_API_KEY') && !assertEnv('NYT_API_KEY')) {
    throw new Error('Missing GUARDIAN_API_KEY and NYT_API_KEY');
  }
  const [guardian, nyt] = await Promise.all([
    fetchGuardian(args.query, args.from, args.limit),
    fetchNyt(args.query, args.from, args.limit),
  ]);
  const articles = [...guardian, ...nyt].slice(0, Math.max(args.limit, 1) * 2);
  const client = new Client(resolveNasPgConfig());
  await client.connect();
  try {
    await ensureSchema(client);
    let inserted = 0;
    for (const article of articles) {
      const result = await client.query(
        `
          INSERT INTO articles (source, theme, published_at, title, summary, url)
          VALUES ($1, $2, $3, $4, $5, $6)
          ON CONFLICT DO NOTHING
        `,
        [
          article.source,
          'emerging-tech',
          article.publishedAt,
          String(article.title || '').slice(0, 500),
          String(article.summary || '').slice(0, 4000),
          String(article.url || ''),
        ],
      );
      inserted += Number(result.rowCount || 0);
    }
    return {
      ok: true,
      fetched: articles.length,
      inserted,
      query: args.query,
    };
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
  runKeywordNewsBackfill(parseArgs())
    .then((summary) => process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`))
    .catch((error) => {
      process.stderr.write(`${String(error?.stack || error?.message || error)}\n`);
      process.exit(1);
    });
}
