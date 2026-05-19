#!/usr/bin/env node

import pg from 'pg';
import { pathToFileURL } from 'node:url';
import { ensureResearchOsSchema, persistGraphSeed, buildThemeTaxonomyGraphSeed, upsertResearchQuestion } from './_shared/adjacency-graph.mjs';
import { collectIncomingResearchSignals, loadIncomingSignalsForQuestions, persistIncomingResearchSignals } from './_shared/incoming-connection-miner.mjs';
import { generateResearchQuestions } from './_shared/research-question-generator.mjs';
import { loadOptionalEnvFile, resolveNasPgConfig } from './_shared/nas-runtime.mjs';
import { loadResearchOsPolicy } from './_shared/research-os-policy.mjs';

const { Client } = pg;

function parseArgs(argv = process.argv.slice(2)) {
  const args = new Set(argv);
  const incomingLimitArg = argv.find((arg) => arg.startsWith('--incoming-limit='));
  return {
    dryRun: args.has('--dry-run'),
    initSchema: args.has('--init-schema') || args.has('--all'),
    importSeeds: args.has('--import-seeds') || args.has('--all'),
    mineIncoming: args.has('--mine-incoming') || args.has('--all'),
    incomingLimit: incomingLimitArg ? Number(incomingLimitArg.split('=')[1]) : undefined,
    generateQuestions: args.has('--generate-questions') || args.has('--all'),
  };
}

async function safeRows(client, sql, params = []) {
  try {
    const { rows } = await client.query(sql, params);
    return rows;
  } catch {
    return [];
  }
}

export async function collectResearchQuestionSnapshot(client) {
  const trendRows = await safeRows(client, `
    SELECT theme AS key,
           theme AS label,
           COALESCE(NULLIF(acceleration, 'NaN'::float8), 0)::float8 AS momentum,
           LEAST(1, GREATEST(0, ABS(COALESCE(yoy_change, 0)::float8) / 100.0)) AS heat,
           COALESCE(source_diversity, 0)::float8 AS source_diversity,
           COALESCE(article_count, 0)::int AS article_count
      FROM theme_trend_aggregates
     ORDER BY updated_at DESC NULLS LAST
     LIMIT 32
  `);
  const articleRows = trendRows.length ? [] : await safeRows(client, `
    SELECT COALESCE(theme, 'unknown') AS key,
           COALESCE(theme, 'unknown') AS label,
           LEAST(1, COUNT(*)::float8 / 100.0) AS heat,
           LEAST(1, COUNT(*)::float8 / 200.0) AS momentum,
           COUNT(DISTINCT source)::int AS source_diversity,
           COUNT(*)::int AS article_count
      FROM articles
     WHERE published_at >= NOW() - INTERVAL '7 days'
     GROUP BY COALESCE(theme, 'unknown')
     ORDER BY COUNT(*) DESC
     LIMIT 32
  `);
  const novelRows = await safeRows(client, `
    SELECT label AS phrase,
           article_count AS count,
           keywords AS themes
      FROM discovery_topics
     WHERE updated_at >= NOW() - INTERVAL '14 days'
     ORDER BY momentum DESC NULLS LAST, article_count DESC
     LIMIT 24
  `);
  return {
    themes: (trendRows.length ? trendRows : articleRows).map((row) => ({
      key: row.key,
      label: row.label,
      heat: Number(row.heat || 0),
      momentum: Number(row.momentum || 0),
      sourceDiversity: Number(row.source_diversity || 0),
      supplierDiversity: Number(row.supplier_diversity || 0),
      articleCount: Number(row.article_count || 0),
    })),
    novelPhrases: novelRows.map((row) => ({
      phrase: row.phrase,
      count: Number(row.count || 0),
      themes: Array.isArray(row.themes) ? row.themes : [],
    })),
  };
}

export async function runResearchOsFoundation(options = {}) {
  loadOptionalEnvFile();
  const policy = loadResearchOsPolicy();
  const client = options.client || new Client(options.pgConfig || resolveNasPgConfig());
  const ownClient = !options.client;
  if (ownClient) await client.connect();
  try {
    const result = { ok: true, dryRun: Boolean(options.dryRun), steps: [] };
    if (options.initSchema) {
      if (!options.dryRun) await ensureResearchOsSchema(client);
      result.steps.push({ step: 'init-schema', ok: true, dryRun: Boolean(options.dryRun) });
    }
    if (options.importSeeds) {
      const seed = buildThemeTaxonomyGraphSeed();
      const importResult = options.dryRun
        ? { ok: true, nodeCount: seed.nodes.length, edgeCount: seed.edges.length, dryRun: true }
        : await persistGraphSeed(client, seed);
      result.steps.push({ step: 'import-seeds', ...importResult });
    }
    let incomingSignals = options.incomingSignals || null;
    if (options.mineIncoming) {
      if (!options.dryRun) await ensureResearchOsSchema(client);
      const collected = await collectIncomingResearchSignals(client, {
        policy,
        limit: options.incomingLimit,
      });
      const persisted = options.dryRun
        ? { ok: true, inserted: 0, archived: 0, dryRun: true }
        : await persistIncomingResearchSignals(client, collected.signals);
      incomingSignals = collected.signals;
      result.steps.push({
        step: 'mine-incoming-signals',
        ok: true,
        dryRun: Boolean(options.dryRun),
        generated: collected.signals.length,
        sourceCounts: collected.sourceCounts,
        inserted: persisted.inserted,
        archived: persisted.archived || 0,
      });
    }
    if (options.generateQuestions) {
      if (!incomingSignals && !options.dryRun) {
        incomingSignals = await loadIncomingSignalsForQuestions(client, { policy, limit: options.incomingLimit });
      }
      const snapshotBase = options.snapshot || await collectResearchQuestionSnapshot(client);
      const snapshot = {
        ...snapshotBase,
        incomingSignals: incomingSignals || snapshotBase.incomingSignals || [],
      };
      const generated = generateResearchQuestions(snapshot, policy);
      let inserted = 0;
      if (!options.dryRun) {
        await ensureResearchOsSchema(client);
        const activeIds = generated.questions.map((question) => question.id).filter(Boolean);
        for (const question of generated.questions) {
          const row = await upsertResearchQuestion(client, question, { skipEnsure: true });
          if (row) inserted += 1;
        }
        if (activeIds.length) {
          await client.query(
            `UPDATE research_questions
                SET status = 'archived',
                    updated_at = NOW(),
                    metadata = metadata || jsonb_build_object(
                      'archivedBy', 'research-os-foundation',
                      'archivedReason', 'not present in latest generated question window'
                    )
              WHERE status = 'new'
                AND deterministic_id IS NOT NULL
                AND NOT (deterministic_id = ANY($1::text[]))`,
            [activeIds],
          );
        }
      }
      result.steps.push({
        step: 'generate-questions',
        ok: true,
        generated: generated.questions.length,
        inserted,
        metrics: generated.metrics,
        dryRun: Boolean(options.dryRun),
      });
    }
    return result;
  } finally {
    if (ownClient) await client.end();
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
  const args = parseArgs();
  runResearchOsFoundation(args)
    .then((result) => {
      console.log(JSON.stringify(result, null, 2));
    })
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
}
