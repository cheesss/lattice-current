#!/usr/bin/env node
/**
 * fetch-news-archive.mjs
 *
 * Archive Guardian and NYT articles into NAS PostgreSQL.
 *
 * Usage:
 *   node scripts/fetch-news-archive.mjs --source=guardian --from=2020-01 --to=2025-12
 *   node scripts/fetch-news-archive.mjs --source=nyt --from=2020-01 --to=2025-12
 *   node scripts/fetch-news-archive.mjs --source=all --from=2020-01 --to=2025-12
 *
 * Required environment:
 *   GUARDIAN_API_KEY
 *   NYT_API_KEY
 *   PG_PASSWORD
 *
 * Optional environment:
 *   PG_HOST (default: 192.168.0.76)
 *   PG_PORT (default: 5433)
 *   PG_DATABASE (default: lattice)
 *   PG_USER (default: postgres)
 */

import { Client } from 'pg';

import { loadOptionalEnvFile, resolveNasPgConfig } from './_shared/nas-runtime.mjs';

loadOptionalEnvFile();

const GUARDIAN_KEY = process.env.GUARDIAN_API_KEY;
const NYT_KEY = process.env.NYT_API_KEY;
const PG_CONFIG = resolveNasPgConfig();

const THEMES = {
  conflict: '(war OR conflict OR military OR missile OR troops OR sanction)',
  economy: '(inflation OR recession OR GDP OR "trade war" OR tariff OR "federal reserve")',
  energy: '(oil OR gas OR OPEC OR pipeline OR "energy crisis" OR LNG)',
  tech: '(semiconductor OR "AI regulation" OR cyber OR chip OR "supply chain")',
  politics: '(election OR diplomacy OR sanctions OR summit OR protest OR coup)',
};

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function assertApiKey(value, label) {
  if (!String(value || '').trim()) {
    throw new Error(`Missing ${label}. Set it in the environment before running ${label.toLowerCase()} archive ingestion.`);
  }
}

async function fetchGuardianMonth(theme, query, year, month, client) {
  assertApiKey(GUARDIAN_KEY, 'GUARDIAN_API_KEY');
  const from = `${year}-${String(month).padStart(2, '0')}-01`;
  const to = new Date(year, month, 0).toISOString().slice(0, 10);
  const url = `https://content.guardianapis.com/search?q=${encodeURIComponent(query)}&from-date=${from}&to-date=${to}&page-size=200&show-fields=trailText&order-by=oldest&api-key=${GUARDIAN_KEY}`;

  const response = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error(`Guardian ${response.status}`);
  const payload = await response.json();
  const articles = payload?.response?.results || [];

  let inserted = 0;
  for (const article of articles) {
    const summary = article.fields?.trailText || '';
    await client.query(
      `INSERT INTO articles (source, theme, published_at, title, summary, url)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT DO NOTHING`,
      ['guardian', theme, article.webPublicationDate, article.webTitle, summary, article.webUrl],
    );
    inserted += 1;
  }
  return inserted;
}

async function fetchNytMonth(theme, query, year, month, client) {
  assertApiKey(NYT_KEY, 'NYT_API_KEY');
  const lastDay = new Date(year, month, 0).getDate();
  const baseUrl = `https://api.nytimes.com/svc/search/v2/articlesearch.json?q=${encodeURIComponent(query)}&begin_date=${year}${String(month).padStart(2, '0')}01&end_date=${year}${String(month).padStart(2, '0')}${String(lastDay).padStart(2, '0')}&sort=oldest&api-key=${NYT_KEY}`;

  let inserted = 0;
  const maxPages = 5;
  for (let page = 0; page < maxPages; page += 1) {
    const response = await fetch(`${baseUrl}&page=${page}`, { signal: AbortSignal.timeout(15_000) });
    if (response.status === 429) {
      await sleep(60_000);
      page -= 1;
      continue;
    }
    if (!response.ok) throw new Error(`NYT ${response.status}`);
    const payload = await response.json();
    const articles = payload?.response?.docs || [];
    if (articles.length === 0) break;

    for (const article of articles) {
      const summary = article.abstract || article.snippet || '';
      const publishedAt = article.pub_date;
      const webUrl = article.web_url;
      const title = article.headline?.main || '';
      await client.query(
        `INSERT INTO articles (source, theme, published_at, title, summary, url)
         VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT DO NOTHING`,
        ['nyt', theme, publishedAt, title, summary, webUrl],
      );
      inserted += 1;
    }

    if (articles.length < 10) break;
    await sleep(6_500);
  }
  return inserted;
}

async function ensureSchema(client) {
  await client.query('ALTER TABLE articles ADD COLUMN IF NOT EXISTS url TEXT').catch(() => {});
  await client.query('CREATE UNIQUE INDEX IF NOT EXISTS articles_url_idx ON articles (url)').catch(() => {});
}

function monthRange(from, to) {
  const [fromYear, fromMonth] = from.split('-').map(Number);
  const [toYear, toMonth] = to.split('-').map(Number);
  const months = [];
  let year = fromYear;
  let month = fromMonth;
  while (year < toYear || (year === toYear && month <= toMonth)) {
    months.push([year, month]);
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
  }
  return months;
}

function parseArgs(argv) {
  return Object.fromEntries(
    argv
      .map((arg) => arg.replace(/^--/, '').split('='))
      .filter((parts) => parts.length === 2),
  );
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const source = args.source || 'all';
  const from = args.from || '2020-01';
  const to = args.to || '2025-12';
  const months = monthRange(from, to);

  console.log(`Archive range: ${from} -> ${to} (${months.length} months)`);
  console.log(`Sources: ${source}, themes: ${Object.keys(THEMES).join(', ')}`);

  const client = new Client(PG_CONFIG);
  await client.connect();
  await ensureSchema(client);

  let totalInserted = 0;
  for (const [year, month] of months) {
    const label = `${year}-${String(month).padStart(2, '0')}`;
    for (const [theme, query] of Object.entries(THEMES)) {
      try {
        let count = 0;
        if (source === 'guardian' || source === 'all') {
          count += await fetchGuardianMonth(theme, query, year, month, client);
          await sleep(300);
        }
        if (source === 'nyt' || source === 'all') {
          count += await fetchNytMonth(theme, query, year, month, client);
          await sleep(6_500);
        }
        totalInserted += count;
        console.log(`  ${label} [${theme}] +${count} (total: ${totalInserted})`);
      } catch (error) {
        console.log(`  ${label} [${theme}] error: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  await client.end();
  console.log(`\nDone. Total inserted: ${totalInserted}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
