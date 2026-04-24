#!/usr/bin/env node
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import pg from 'pg';
import { loadOptionalEnvFile, resolveNasPgConfig } from './_shared/nas-runtime.mjs';
import { resolveThemeTaxonomy } from './_shared/theme-taxonomy.mjs';
import { classifySeedItemTheme } from './proposal-executor.mjs';

const { Client } = pg;

function parseArgs(argv = process.argv.slice(2)) {
  const out = {
    days: 14,
    limit: 2000,
    sourceLike: '',
    methodLike: 'dynamic-rss%',
    dryRun: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) continue;
    const [rawKey, inlineValue] = token.slice(2).split('=');
    const key = rawKey.trim();
    const value = inlineValue ?? argv[index + 1];
    if (inlineValue == null && value && !String(value).startsWith('--')) index += 1;
    if (key === 'days') out.days = Number(value || out.days);
    else if (key === 'limit') out.limit = Number(value || out.limit);
    else if (key === 'source-like' || key === 'sourceLike') out.sourceLike = String(value || '');
    else if (key === 'method-like' || key === 'methodLike') out.methodLike = String(value || out.methodLike);
    else if (key === 'dry-run' || key === 'dryRun') out.dryRun = true;
  }
  out.days = Math.max(1, Math.min(3650, Math.floor(Number(out.days) || 14)));
  out.limit = Math.max(1, Math.min(10000, Math.floor(Number(out.limit) || 2000)));
  return out;
}

function summarizeChange(changes, fromTheme, toTheme) {
  const key = `${fromTheme || 'unknown'} -> ${toTheme || 'unknown'}`;
  changes.set(key, Number(changes.get(key) || 0) + 1);
}

async function repairDynamicRssThemes(options = {}) {
  loadOptionalEnvFile(options.envFile || '.env.local');
  const config = { ...parseArgs([]), ...options };
  const client = new Client(resolveNasPgConfig());
  await client.connect();
  const summary = {
    ok: true,
    dryRun: Boolean(config.dryRun),
    scanned: 0,
    updated: 0,
    unchanged: 0,
    changes: {},
    samples: [],
  };
  const changes = new Map();
  try {
    const { rows } = await client.query(`
      SELECT
        a.id,
        a.source,
        a.title,
        a.theme AS article_theme,
        t.auto_theme,
        t.method
      FROM articles a
      JOIN auto_article_themes t ON t.article_id = a.id
      WHERE a.published_at >= NOW() - ($1::int * INTERVAL '1 day')
        AND ($2 = '' OR a.source ILIKE '%' || $2 || '%')
        AND ($3 = '' OR COALESCE(t.method, '') ILIKE $3)
      ORDER BY a.published_at DESC, a.id DESC
      LIMIT $4
    `, [config.days, config.sourceLike, config.methodLike, config.limit]);

    for (const row of rows) {
      summary.scanned += 1;
      const nextTheme = classifySeedItemTheme(
        { title: row.title },
        row.source,
        row.auto_theme || row.article_theme || '',
        { qualityBreakdown: { themeRelevance: 0 } },
      ) || 'unknown';
      const currentTheme = String(row.auto_theme || row.article_theme || 'unknown').trim().toLowerCase();
      if (nextTheme === currentTheme) {
        summary.unchanged += 1;
        continue;
      }
      summarizeChange(changes, currentTheme, nextTheme);
      if (summary.samples.length < 20) {
        summary.samples.push({
          id: Number(row.id),
          source: row.source,
          title: row.title,
          from: currentTheme,
          to: nextTheme,
        });
      }
      if (!config.dryRun) {
        const taxonomy = nextTheme === 'unknown' ? {} : resolveThemeTaxonomy(nextTheme);
        await client.query(`
          UPDATE articles
          SET theme = $2
          WHERE id = $1
        `, [row.id, nextTheme]);
        await client.query(`
          UPDATE auto_article_themes
          SET auto_theme = $2,
              confidence = $3,
              method = CASE
                WHEN COALESCE(method, '') LIKE '%:repaired' THEN method
                ELSE COALESCE(NULLIF(method, ''), 'dynamic-rss') || ':repaired'
              END,
              theme_key = $4,
              theme_label = $5,
              parent_theme = $6,
              theme_category = $7
          WHERE article_id = $1
        `, [
          row.id,
          nextTheme,
          nextTheme === 'unknown' ? 0.2 : 0.58,
          taxonomy.themeKey || null,
          taxonomy.themeLabel || null,
          taxonomy.parentTheme || null,
          taxonomy.category || null,
        ]);
      }
      summary.updated += 1;
    }
    summary.changes = Object.fromEntries(changes.entries());
    return summary;
  } finally {
    await client.end().catch(() => {});
  }
}

async function main() {
  const summary = await repairDynamicRssThemes(parseArgs());
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`${String(error?.stack || error?.message || error)}\n`);
    process.exitCode = 1;
  });
}

export { parseArgs, repairDynamicRssThemes };
