#!/usr/bin/env node

import pg from 'pg';
import { pathToFileURL } from 'node:url';
import { loadOptionalEnvFile, resolveNasPgConfig } from './_shared/nas-runtime.mjs';
import { fetchHistoricalEnvelope } from './fetch-historical-data.mjs';

loadOptionalEnvFile();

const { Client } = pg;

function parseArgs(argv = process.argv.slice(2)) {
  const parsed = {
    from: '2024-01-01',
    limit: 20000,
    keywords: [],
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--from' && argv[index + 1]) {
      parsed.from = argv[++index];
    } else if (arg === '--limit' && argv[index + 1]) {
      const value = Number(argv[++index]);
      if (Number.isFinite(value) && value > 0) parsed.limit = Math.floor(value);
    } else if (arg === '--keywords' && argv[index + 1]) {
      parsed.keywords = argv[++index].split(',').map((value) => value.trim()).filter(Boolean);
    }
  }
  return parsed;
}

function formatGdeltDate(value) {
  return new Date(value).toISOString().replace(/[-:T.Z]/g, '').slice(0, 14);
}

async function ensureSchema(client) {
  await client.query('ALTER TABLE articles ADD COLUMN IF NOT EXISTS url TEXT').catch(() => {});
  await client.query('CREATE UNIQUE INDEX IF NOT EXISTS articles_url_idx ON articles (url)').catch(() => {});
}

function buildSummary(article) {
  return [
    article.domain ? `domain ${article.domain}` : '',
    article.language ? `language ${article.language}` : '',
    article.sourcecountry ? `country ${article.sourcecountry}` : '',
    article.seendate ? `seen ${article.seendate}` : '',
  ].filter(Boolean).join(' | ');
}

export async function runGdeltArticlesBackfill(options = {}) {
  const args = { ...parseArgs([]), ...options };
  const query = (Array.isArray(args.keywords) && args.keywords.length > 0)
    ? args.keywords.join(' OR ')
    : 'emerging technology OR semiconductor OR robotics OR biotech OR fusion OR quantum';
  const envelope = await fetchHistoricalEnvelope('gdelt-doc', {
    query,
    start: formatGdeltDate(args.from),
    end: formatGdeltDate(new Date().toISOString()),
    max: Math.min(250, Math.max(50, Math.floor(Math.min(args.limit, 5000) / 10) || 250)),
    window_days: 30,
    query_terms: Array.isArray(args.keywords) ? args.keywords.join('|') : '',
  });
  const articles = Array.isArray(envelope?.data?.articles) ? envelope.data.articles.slice(0, args.limit) : [];

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
          'gdelt-doc',
          'emerging-tech',
          article.seendate ? new Date(article.seendate).toISOString() : new Date().toISOString(),
          String(article.title || '').trim().slice(0, 500),
          buildSummary(article),
          String(article.url || '').trim(),
        ],
      );
      inserted += Number(result.rowCount || 0);
    }
    return {
      ok: true,
      query,
      fetched: articles.length,
      inserted,
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
  runGdeltArticlesBackfill(parseArgs())
    .then((summary) => process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`))
    .catch((error) => {
      process.stderr.write(`${String(error?.stack || error?.message || error)}\n`);
      process.exit(1);
    });
}
