#!/usr/bin/env node

import pg from 'pg';
import { pathToFileURL } from 'node:url';
import { loadOptionalEnvFile, resolveNasPgConfig } from './_shared/nas-runtime.mjs';
import { ensureEmergingTechSchema } from './_shared/schema-emerging-tech.mjs';
import { runCodexJsonPrompt } from './_shared/codex-json.mjs';

loadOptionalEnvFile();

const { Client } = pg;
const CODEX_REPORT_TIMEOUT_MS = 35_000;
const CODEX_REPORT_CONCURRENCY = 2;

export function parseArgs(argv = process.argv.slice(2)) {
  const parsed = {
    limit: 5,
    topicId: '',
    force: false,
    codexOnly: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--limit' && argv[index + 1]) {
      const value = Number(argv[++index]);
      if (Number.isFinite(value) && value > 0) parsed.limit = Math.floor(value);
    } else if (arg === '--topic-id' && argv[index + 1]) {
      parsed.topicId = argv[++index];
    } else if (arg === '--force') {
      parsed.force = true;
    } else if (arg === '--codex-only') {
      parsed.codexOnly = true;
    }
  }
  return parsed;
}

function clamp(value, minimum, maximum) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return minimum;
  return Math.min(maximum, Math.max(minimum, numeric));
}

export function computeTrackingScore(topic, relatedSymbols = []) {
  const momentum = clamp(Number(topic?.momentum || 0), 0, 8);
  const researchMomentum = clamp(Number(topic?.research_momentum || 0), 0, 8);
  const novelty = clamp(Number(topic?.novelty || 0), 0, 1);
  const diversity = clamp(Number(topic?.diversity || 0), 0, 6);
  const sourceQuality = clamp(Number(topic?.source_quality_score || 0), 0, 1);
  const symbolScore = clamp(relatedSymbols.length, 0, 5);
  const raw = (
    momentum * 7
    + researchMomentum * 5
    + novelty * 20
    + diversity * 4
    + sourceQuality * 12
    + symbolScore * 5
  );
  return Math.round(clamp(raw, 0, 100));
}

export function buildDeterministicTechThesis(topic, articles = [], relatedSymbols = []) {
  const articleSummary = articles.length > 0
    ? `Recent coverage is led by ${articles.slice(0, 3).map((article) => article.title).join('; ')}.`
    : 'Recent coverage is still sparse.';
  const symbolSummary = relatedSymbols.length > 0
    ? `The strongest linked symbols are ${relatedSymbols.slice(0, 4).map((row) => row.symbol).join(', ')}.`
    : 'No symbol linkage is strong enough yet to treat as a primary watchlist.';
  const researchSummary = Number(topic?.research_momentum || 0) > 0
    ? `Research momentum is positive at ${Number(topic.research_momentum).toFixed(2)}.`
    : 'Research momentum is neutral to weak.';
  const sourceSummary = Number.isFinite(Number(topic?.source_quality_score))
    ? `Source quality is ${Number(topic.source_quality_score).toFixed(2)} on a 0-1 scale.`
    : 'Source quality has not been scored yet.';
  return [
    `${topic?.label || topic?.id || 'Emerging topic'} remains an operator watchlist candidate rather than a mature thesis.`,
    `${topic?.description || 'The cluster is still forming and needs continued monitoring.'}`,
    researchSummary,
    sourceSummary,
    articleSummary,
    symbolSummary,
  ].join(' ');
}

export function normalizeTechReportPayload(raw = {}, topic = {}, relatedSymbols = []) {
  const thesis = String(raw.investment_thesis || raw.investmentThesis || '').trim();
  const nextReviewDays = clamp(raw.next_review_days ?? raw.nextReviewDays, 1, 30);
  const trackingScore = clamp(
    raw.tracking_score ?? raw.trackingScore ?? computeTrackingScore(topic, relatedSymbols),
    0,
    100,
  );
  return {
    investmentThesis: thesis,
    trackingScore,
    nextReviewDays,
  };
}

function buildPrompt(topic, articles, relatedSymbols) {
  return [
    'You are generating an operator-facing emerging-technology tracking note.',
    'This is a monitoring memo, not a trading call.',
    '',
    'Write the thesis as a compact operator brief with this structure:',
    '1. What changed recently',
    '2. Why this topic matters now',
    '3. What evidence supports continued monitoring',
    '4. What should trigger the next review',
    '',
    'Rules:',
    '- Ground the note in the supplied topic metrics, articles, and related symbols only.',
    '- Be explicit about uncertainty when evidence is weak.',
    '- tracking_score should reflect monitoring priority, not price upside.',
    '- next_review_days should be shorter for fast-moving topics and longer for weak/noisy topics.',
    '',
    'Output rules:',
    '- Return strict JSON only.',
    '- Do not include markdown or commentary outside JSON.',
    '- The response must match this schema exactly.',
    '',
    'Schema:',
    '{',
    '  "investment_thesis": "3-5 sentence tracking thesis focused on why the topic matters now",',
    '  "tracking_score": 0,',
    '  "next_review_days": 7',
    '}',
    '',
    `Topic id: ${topic.id}`,
    `Label: ${topic.label || topic.id}`,
    `Description: ${topic.description || ''}`,
    `Category: ${topic.category || ''}`,
    `Stage: ${topic.stage || ''}`,
    `Momentum: ${topic.momentum ?? ''}`,
    `Research momentum: ${topic.research_momentum ?? ''}`,
    `Source quality score: ${topic.source_quality_score ?? ''}`,
    `Novelty: ${topic.novelty ?? ''}`,
    `Parent theme: ${topic.parent_theme || 'emerging-tech'}`,
    `Key companies: ${(topic.key_companies || []).join(', ')}`,
    `Key technologies: ${(topic.key_technologies || []).join(', ')}`,
    '',
    'Recent articles:',
    ...articles.map((article, index) => `${index + 1}. ${article.title} [${article.source}]`),
    '',
    'Related symbols:',
    ...relatedSymbols.map((row) => `${row.symbol}: avg_return=${Number(row.avg_return || 0).toFixed(4)}, hit_rate=${Number(row.hit_rate || 0).toFixed(4)}, sample_size=${Number(row.sample_size || 0)}`),
  ].join('\n');
}

async function loadTopics(client, options) {
  const params = [];
  const conditions = [`status IN ('labeled', 'reported')`];
  if (options.topicId) {
    params.push(options.topicId);
    conditions.push(`id = $${params.length}`);
  }
  if (!options.force) {
    conditions.push(`
      NOT EXISTS (
        SELECT 1
        FROM tech_reports tr
        WHERE tr.topic_id = discovery_topics.id
          AND tr.generated_at >= NOW() - INTERVAL '24 hours'
      )
    `);
  }
  params.push(options.limit);
  const { rows } = await client.query(`
    SELECT *
    FROM discovery_topics
    WHERE ${conditions.join(' AND ')}
    ORDER BY momentum DESC NULLS LAST, research_momentum DESC NULLS LAST, article_count DESC
    LIMIT $${params.length}
  `, params);
  return rows;
}

async function loadTopicContext(client, topicId, parentTheme) {
  const [articlesResponse, symbolsResponse] = await Promise.all([
    client.query(`
      SELECT a.id, a.title, a.source, a.published_at, a.url
      FROM discovery_topic_articles dta
      JOIN articles a ON a.id = dta.article_id
      WHERE dta.topic_id = $1
      ORDER BY a.published_at DESC
      LIMIT 10
    `, [topicId]),
    client.query(`
      SELECT symbol, avg_return, hit_rate, sample_size
      FROM stock_sensitivity_matrix
      WHERE theme = $1 OR theme = $2
      ORDER BY sample_size DESC, ABS(avg_return) DESC NULLS LAST
      LIMIT 10
    `, [topicId, String(parentTheme || 'emerging-tech')]).catch(() => ({ rows: [] })),
  ]);
  return {
    articles: articlesResponse.rows,
    relatedSymbols: symbolsResponse.rows,
  };
}

async function insertTechReport(client, topic, reportPayload, context, generationMode) {
  const now = new Date();
  const reportId = `${topic.id}:${now.toISOString()}`;
  const nextReviewAt = new Date(now.getTime() + (reportPayload.nextReviewDays * 24 * 60 * 60 * 1000)).toISOString();
  await client.query(`
    INSERT INTO tech_reports (
      id, topic_id, generated_at, topic_label, description, stage, momentum, research_momentum,
      source_quality_score, top_articles, related_symbols, monthly_timeline, investment_thesis, key_companies,
      novelty_score, tracking_score, next_review_at
    )
    VALUES (
      $1, $2, NOW(), $3, $4, $5, $6, $7,
      $8, $9::jsonb, $10::jsonb, $11::jsonb, $12, $13::text[],
      $14, $15, $16::timestamptz
    )
  `, [
    reportId,
    topic.id,
    topic.label || topic.id,
    topic.description || '',
    topic.stage || '',
    topic.momentum,
    topic.research_momentum,
    topic.source_quality_score,
    JSON.stringify(context.articles),
    JSON.stringify(context.relatedSymbols),
    JSON.stringify(topic.monthly_counts || {}),
    reportPayload.investmentThesis,
    Array.isArray(topic.key_companies) ? topic.key_companies : [],
    topic.novelty,
    reportPayload.trackingScore,
    nextReviewAt,
  ]);

  await client.query(`
    UPDATE discovery_topics
    SET
      status = 'reported',
      updated_at = NOW(),
      codex_metadata = COALESCE(codex_metadata, '{}'::jsonb) || $2::jsonb
    WHERE id = $1
  `, [
    topic.id,
    JSON.stringify({
      reportGeneration: {
        mode: generationMode,
        reportedAt: now.toISOString(),
        trackingScore: reportPayload.trackingScore,
        nextReviewAt,
      },
    }),
  ]);

  return {
    reportId,
    topicId: topic.id,
    trackingScore: reportPayload.trackingScore,
    generationMode,
  };
}

async function mapWithConcurrency(items, limit, iteratee) {
  const numericLimit = Math.max(1, Math.floor(Number(limit) || 1));
  const results = new Array(items.length);
  let index = 0;

  async function worker() {
    while (index < items.length) {
      const current = index;
      index += 1;
      results[current] = await iteratee(items[current], current);
    }
  }

  await Promise.all(Array.from({ length: Math.min(numericLimit, items.length) }, () => worker()));
  return results;
}

export async function runTechReportGeneration(options = {}) {
  const config = { ...parseArgs([]), ...options };
  const client = new Client(resolveNasPgConfig());
  await client.connect();
  try {
    await ensureEmergingTechSchema(client);
    const topics = await loadTopics(client, config);
    const reports = [];
    const topicContexts = [];
    for (const topic of topics) {
      const context = await loadTopicContext(client, topic.id, topic.parent_theme);
      topicContexts.push({ topic, context });
    }

    const prepared = await mapWithConcurrency(topicContexts, CODEX_REPORT_CONCURRENCY, async ({ topic, context }) => {
      let normalized = null;
      let generationMode = 'deterministic';

      if (!config.codexOnly || context.articles.length > 0) {
        const response = await runCodexJsonPrompt(
          buildPrompt(topic, context.articles, context.relatedSymbols),
          CODEX_REPORT_TIMEOUT_MS,
          {
            label: 'generate-tech-report',
            topicId: topic.id,
          },
        );
        if (response.parsed) {
          const candidate = normalizeTechReportPayload(response.parsed, topic, context.relatedSymbols);
          if (candidate.investmentThesis) {
            normalized = candidate;
            generationMode = 'codex';
          }
        }
      }

      if (!normalized) {
        if (config.codexOnly) return null;
        normalized = normalizeTechReportPayload({
          investment_thesis: buildDeterministicTechThesis(topic, context.articles, context.relatedSymbols),
          tracking_score: computeTrackingScore(topic, context.relatedSymbols),
          next_review_days: Number(topic.research_momentum || 0) > 1 ? 5 : 7,
        }, topic, context.relatedSymbols);
      }

      return { topic, context, normalized, generationMode };
    });

    for (const entry of prepared) {
      if (!entry?.normalized) continue;
      reports.push(await insertTechReport(client, entry.topic, entry.normalized, entry.context, entry.generationMode));
    }

    return {
      requested: topics.length,
      generatedCount: reports.length,
      reports,
    };
  } finally {
    await client.end();
  }
}

async function main() {
  const summary = await runTechReportGeneration(parseArgs());
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
