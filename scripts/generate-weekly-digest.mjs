#!/usr/bin/env node

import pg from 'pg';
import path from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { loadOptionalEnvFile, resolveNasPgConfig } from './_shared/nas-runtime.mjs';
import { ensureEmergingTechSchema } from './_shared/schema-emerging-tech.mjs';
import { ensureDailyCuratedNewsSchema } from './curate-daily-news.mjs';
import { runCodexJsonPrompt } from './_shared/codex-json.mjs';
import { CANONICAL_PARENT_THEME_KEYS } from './_shared/theme-taxonomy.mjs';

loadOptionalEnvFile();

const { Client } = pg;

export function parseArgs(argv = process.argv.slice(2)) {
  const parsed = {
    topicLimit: 8,
    reportLimit: 8,
    asOf: new Date().toISOString().slice(0, 10),
    codexOnly: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--topic-limit' && argv[index + 1]) {
      const value = Number(argv[++index]);
      if (Number.isFinite(value) && value > 0) parsed.topicLimit = Math.floor(value);
    } else if (arg === '--report-limit' && argv[index + 1]) {
      const value = Number(argv[++index]);
      if (Number.isFinite(value) && value > 0) parsed.reportLimit = Math.floor(value);
    } else if (arg === '--as-of' && argv[index + 1]) {
      parsed.asOf = argv[++index];
    } else if (arg === '--codex-only') {
      parsed.codexOnly = true;
    }
  }
  return parsed;
}

export function normalizeWeeklyDigestPayload(raw = {}, fallback = {}) {
  const toTextArray = (value, limit) => Array.isArray(value)
    ? value.map((item) => String(item || '').trim()).filter(Boolean).slice(0, limit)
    : [];
  return {
    headline: String(raw.headline || fallback.headline || '').trim(),
    summary: String(raw.summary || fallback.summary || '').trim(),
    watchlist: toTextArray(raw.watchlist || fallback.watchlist, 12),
  };
}

function buildDeterministicDigest(topics = [], reports = [], asOf) {
  const topTopic = topics[0];
  const reportLabels = reports.slice(0, 3).map((report) => String(report.topic_label || report.topic_id || '')).filter(Boolean);
  return {
    headline: topTopic
      ? `${topTopic.label || topTopic.id} leads the weekly emerging-tech watchlist`
      : `Emerging-tech watchlist for week ending ${asOf}`,
    summary: topTopic
      ? `${topTopic.label || topTopic.id} is leading on momentum while ${reportLabels.join(', ') || 'recent reports'} remain the core tracking set.`
      : `No emerging-tech topics reached reportable momentum this week.`,
    watchlist: [
      ...topics.slice(0, 5).map((topic) => String(topic.label || topic.id || '')),
      ...reportLabels,
    ].filter(Boolean),
  };
}

function buildPrompt(asOf, topics, reports) {
  return [
    'Generate a weekly operator digest for emerging-technology monitoring.',
    'This is a structural monitoring brief, not a news recap and not a trading note.',
    '',
    'Analyze in this order:',
    '1. Which topic most clearly represents the week’s structural change?',
    '2. Which supporting topics or reports reinforce that signal?',
    '3. What belongs on the watchlist for the next review cycle?',
    '',
    'Rules:',
    '- Headline must capture the most important structural change of the week.',
    '- Summary must explain what changed, why it matters, and what should stay on the watchlist.',
    '- Watchlist items must come only from the supplied topics or reports.',
    '- Prefer clarity and specificity over hype.',
    '',
    'Output rules:',
    '- Return strict JSON only.',
    '- Do not include markdown or commentary outside JSON.',
    '- The response must match this schema exactly.',
    '',
    'Schema:',
    '{',
    '  "headline": "1 sentence headline",',
    '  "summary": "2-4 sentence digest summary",',
    '  "watchlist": ["topic or symbol to monitor"]',
    '}',
    '',
    `Week ending: ${asOf}`,
    'Top topics:',
    ...topics.map((topic) => `- ${topic.label || topic.id}: momentum=${Number(topic.momentum || 0).toFixed(2)}, research=${Number(topic.research_momentum || 0).toFixed(2)}, novelty=${Number(topic.novelty || 0).toFixed(2)}`),
    '',
    'Latest reports:',
    ...reports.map((report) => `- ${report.topic_label || report.topic_id}: tracking=${Number(report.tracking_score || 0)}, thesis=${String(report.investment_thesis || '').slice(0, 180)}`),
  ].join('\n');
}

async function loadDigestContext(client, config) {
  await ensureDailyCuratedNewsSchema(client);
  let topicRows = [];
  try {
    const curated = await client.query(`
      WITH ranked AS (
        SELECT
          theme,
          parent_theme,
          category,
          COALESCE(NULLIF(topic_label, ''), NULLIF(theme, ''), 'unknown') AS label,
          COUNT(*)::int AS article_count,
          AVG(importance_score) AS momentum,
          AVG(novelty_score) AS novelty,
          MAX(updated_at) AS last_updated
        FROM daily_curated_news
        WHERE curated_date >= ($1::date - INTERVAL '6 days')
          AND curated_date <= $1::date
          AND COALESCE(NULLIF(parent_theme, ''), '') = ANY($2::text[])
          AND COALESCE(NULLIF(category, ''), 'other') <> 'other'
        GROUP BY theme, parent_theme, category, COALESCE(NULLIF(topic_label, ''), NULLIF(theme, ''), 'unknown')
      )
      SELECT
        theme AS id,
        label,
        momentum,
        0::double precision AS research_momentum,
        novelty,
        article_count
      FROM ranked
      ORDER BY momentum DESC NULLS LAST, article_count DESC, label ASC
      LIMIT $3
    `, [config.asOf, CANONICAL_PARENT_THEME_KEYS, config.topicLimit]);
    topicRows = curated.rows;
  } catch {
    topicRows = [];
  }

  if (topicRows.length === 0) {
    const fallback = await client.query(`
      SELECT id, label, momentum, research_momentum, novelty
      FROM discovery_topics
      WHERE status IN ('labeled', 'reported')
        AND COALESCE(NULLIF(parent_theme, ''), '') = ANY($1::text[])
        AND COALESCE(NULLIF(category, ''), 'other') <> 'other'
        AND COALESCE((codex_metadata->'taxonomyMigration'->>'operatorVisible')::boolean, true)
      ORDER BY momentum DESC NULLS LAST, research_momentum DESC NULLS LAST, novelty DESC NULLS LAST
      LIMIT $2
    `, [CANONICAL_PARENT_THEME_KEYS, config.topicLimit]);
    topicRows = fallback.rows;
  }
  const { rows: reportRows } = await client.query(`
    SELECT topic_id, topic_label, tracking_score, investment_thesis, generated_at
    FROM tech_reports
    WHERE generated_at >= ($1::date - INTERVAL '7 days')
    ORDER BY generated_at DESC
    LIMIT $2
  `, [config.asOf, config.reportLimit]);
  return { topics: topicRows, reports: reportRows };
}

export async function runWeeklyDigestGeneration(options = {}) {
  const config = { ...parseArgs([]), ...options };
  const client = new Client(resolveNasPgConfig());
  await client.connect();
  try {
    await ensureEmergingTechSchema(client);
    await ensureDailyCuratedNewsSchema(client);
    const context = await loadDigestContext(client, config);

    let digest = null;
    let mode = 'deterministic';
    const fallback = buildDeterministicDigest(context.topics, context.reports, config.asOf);
    const response = await runCodexJsonPrompt(buildPrompt(config.asOf, context.topics, context.reports), 95_000, {
      label: 'generate-weekly-digest',
      asOf: config.asOf,
    });
    if (response.parsed) {
      const normalized = normalizeWeeklyDigestPayload(response.parsed, fallback);
      if (normalized.headline && normalized.summary) {
        digest = normalized;
        mode = 'codex';
      }
    }

    if (!digest) {
      if (config.codexOnly) {
        return { generated: false, mode: 'codex-only', digest: null };
      }
      digest = fallback;
    }

    const payload = {
      weekEnding: config.asOf,
      generatedAt: new Date().toISOString(),
      mode,
      headline: digest.headline,
      summary: digest.summary,
      watchlist: digest.watchlist,
      topics: context.topics,
      reports: context.reports,
    };

    const outputDir = path.resolve('data');
    await mkdir(outputDir, { recursive: true });
    const outputPath = path.join(outputDir, `weekly-digest-${config.asOf}.json`);
    await writeFile(outputPath, JSON.stringify(payload, null, 2));
    return { generated: true, mode, outputPath, digest: payload };
  } finally {
    await client.end();
  }
}

async function main() {
  const summary = await runWeeklyDigestGeneration(parseArgs());
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
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
  main().catch((error) => {
    process.stderr.write(`${String(error?.stack || error?.message || error)}\n`);
    process.exit(1);
  });
}
