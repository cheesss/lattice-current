#!/usr/bin/env node

import pg from 'pg';
import { pathToFileURL } from 'node:url';
import { loadOptionalEnvFile, resolveNasPgConfig } from './_shared/nas-runtime.mjs';
import { ensureEmergingTechSchema } from './_shared/schema-emerging-tech.mjs';
import { runCodexJsonPrompt } from './_shared/codex-json.mjs';
import { createWhereBuilder } from './_shared/query-builder.mjs';

loadOptionalEnvFile();

const { Client } = pg;

export function parseArgs(argv = process.argv.slice(2)) {
  const parsed = {
    limit: 5,
    topicId: '',
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--limit' && argv[index + 1]) {
      const value = Number(argv[++index]);
      if (Number.isFinite(value) && value > 0) parsed.limit = Math.floor(value);
    } else if (arg === '--topic-id' && argv[index + 1]) {
      parsed.topicId = argv[++index];
    }
  }
  return parsed;
}

export function normalizeDiscoveryTopicPayload(raw = {}) {
  const toTextArray = (value, limit) => Array.isArray(value)
    ? value.map((item) => String(item || '').trim()).filter(Boolean).slice(0, limit)
    : [];

  const clamp = (value, minimum, maximum) => {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return minimum;
    return Math.min(maximum, Math.max(minimum, numeric));
  };

  return {
    topicName: String(raw.topic_name || raw.topicName || '').trim(),
    category: String(raw.category || '').trim().toLowerCase(),
    stage: String(raw.stage || '').trim().toLowerCase(),
    description: String(raw.description || '').trim(),
    keyCompanies: toTextArray(raw.key_companies || raw.keyCompanies, 12),
    keyTechnologies: toTextArray(raw.key_technologies || raw.keyTechnologies, 16),
    investmentRelevance: clamp(raw.investment_relevance ?? raw.investmentRelevance, 0, 1),
    novelty: clamp(raw.novelty, 0, 1),
    uncertainty: clamp(raw.uncertainty, 0, 1),
  };
}

function buildPrompt(topic, articles) {
  return [
    'You are labeling an emerging-technology article cluster for downstream theme governance.',
    'Do not merely summarize the headlines. Decide what the cluster is, how mature it is, and whether it is coherent enough to track.',
    '',
    'Analyze in this order:',
    '1. Cluster coherence: are the articles about one topic or a mixed/noisy bundle?',
    '2. Category fit: which single category best describes the cluster?',
    '3. Lifecycle stage: is it research, early-commercial, mature, or decline?',
    '4. Market relevance: does the cluster have real investment relevance or is it mostly noise?',
    '',
    'Rules:',
    '- If the cluster is mixed or noisy, use category "other".',
    '- Use conservative scores when evidence is weak or conflicting.',
    '- Keep key_companies and key_technologies grounded in the supplied articles only.',
    '',
    'Output rules:',
    '- Return strict JSON only.',
    '- Do not include markdown or commentary outside JSON.',
    '- The response must match this schema exactly.',
    '',
    'Schema:',
    '{',
    '  "topic_name": "clear topic label",',
    '  "category": "semiconductor|biotech|energy|robotics|materials|quantum|security|other",',
    '  "stage": "research|early-commercial|mature|decline",',
    '  "description": "2-3 sentence summary",',
    '  "key_companies": ["company"],',
    '  "key_technologies": ["technology keyword"],',
    '  "investment_relevance": 0.0,',
    '  "novelty": 0.0,',
    '  "uncertainty": 0.0',
    '}',
    '',
    `Topic id: ${topic.id}`,
    `Current keywords: ${(topic.keywords || []).join(', ')}`,
    `Article count: ${topic.article_count}`,
    `Momentum: ${topic.momentum}`,
    `Parent theme: ${topic.parent_theme || 'emerging-tech'}`,
    '',
    'Representative articles:',
    ...articles.map((article, index) => `${index + 1}. ${article.title} [${article.source}]`),
  ].join('\n');
}

async function loadPendingTopics(client, options) {
  const where = createWhereBuilder([`status = 'pending'`]);
  if (options.topicId) {
    where.addValue(options.topicId, (placeholder) => `id = ${placeholder}`);
  }
  const { whereClause, params } = where.build();
  params.push(options.limit);
  const { rows } = await client.query(`
    SELECT *
    FROM discovery_topics
    ${whereClause}
    ORDER BY momentum DESC NULLS LAST, article_count DESC
    LIMIT $${params.length}
  `, params);
  return rows;
}

async function loadRepresentativeArticles(client, topic) {
  const articleIds = Array.isArray(topic.representative_article_ids)
    ? topic.representative_article_ids
    : [];
  if (articleIds.length === 0) return [];
  const { rows } = await client.query(`
    SELECT id, title, source, published_at, url
    FROM articles
    WHERE id = ANY($1::int[])
    ORDER BY published_at DESC
  `, [articleIds]);
  return rows;
}

async function updateTopic(client, topicId, normalized, rawResponse) {
  await client.query(`
    UPDATE discovery_topics
    SET
      label = $2,
      description = $3,
      category = $4,
      stage = $5,
      key_companies = $6::text[],
      key_technologies = $7::text[],
      novelty = $8,
      codex_metadata = COALESCE(codex_metadata, '{}'::jsonb) || $9::jsonb,
      status = 'labeled',
      updated_at = NOW()
    WHERE id = $1
  `, [
    topicId,
    normalized.topicName,
    normalized.description,
    normalized.category,
    normalized.stage,
    normalized.keyCompanies,
    normalized.keyTechnologies,
    normalized.novelty,
    JSON.stringify({
      labeling: normalized,
      rawResponse,
      labeledAt: new Date().toISOString(),
    }),
  ]);
}

export async function runDiscoveryTopicLabeling(options = {}) {
  const client = new Client(resolveNasPgConfig());
  await client.connect();
  try {
    await ensureEmergingTechSchema(client);
    const topics = await loadPendingTopics(client, { ...parseArgs([]), ...options });
    const labeled = [];
    for (const topic of topics) {
      const articles = await loadRepresentativeArticles(client, topic);
      const response = await runCodexJsonPrompt(buildPrompt(topic, articles), 95_000, {
        label: 'label-discovery-topics',
        topicId: topic.id,
      });
      if (!response.parsed) {
        continue;
      }
      const normalized = normalizeDiscoveryTopicPayload(response.parsed);
      if (!normalized.topicName || !normalized.description) {
        continue;
      }
      await updateTopic(client, topic.id, normalized, response.parsed);
      labeled.push({
        id: topic.id,
        topicName: normalized.topicName,
        category: normalized.category,
        stage: normalized.stage,
      });
    }
    return {
      requested: topics.length,
      labeledCount: labeled.length,
      labeled,
    };
  } finally {
    await client.end();
  }
}

async function main() {
  const summary = await runDiscoveryTopicLabeling(parseArgs());
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
