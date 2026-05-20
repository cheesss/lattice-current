#!/usr/bin/env node

import pg from 'pg';
import { pathToFileURL } from 'node:url';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { ensureResearchOsSchema, loadKnowledgeGraph, upsertCrossThemeCandidate } from './_shared/adjacency-graph.mjs';
import { scoreCrossThemeConnectors } from './_shared/cross-theme-adjacency.mjs';
import { loadOptionalEnvFile, resolveNasPgConfig } from './_shared/nas-runtime.mjs';
import { loadResearchOsPolicy, requirePolicyNumber } from './_shared/research-os-policy.mjs';

const { Client } = pg;

function parseArgs(argv = process.argv.slice(2)) {
  const args = new Set(argv);
  return {
    dryRun: args.has('--dry-run'),
    limit: Number(argv.find((arg) => arg.startsWith('--limit='))?.split('=')[1] || 50),
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

async function tableColumns(client, tableName) {
  const rows = await safeRows(client, `
    SELECT column_name
      FROM information_schema.columns
     WHERE table_name = $1
  `, [tableName]);
  return new Set(rows.map((row) => row.column_name));
}

function pickColumn(columns, candidates) {
  return candidates.find((candidate) => columns.has(candidate));
}

async function loadHotThemes(client, limit, policy) {
  const columns = await tableColumns(client, 'theme_trend_aggregates');
  const themeColumn = pickColumn(columns, ['theme', 'theme_key', 'normalized_key']);
  const accelerationColumn = pickColumn(columns, ['trend_acceleration', 'acceleration', 'vs_previous_period_pct']);
  const yoyColumn = pickColumn(columns, ['vs_year_ago_pct', 'yoy_change', 'vs_previous_period_pct']);
  const updatedColumn = pickColumn(columns, ['computed_at', 'updated_at', 'period_end', 'created_at']);
  const periodColumn = pickColumn(columns, ['period_type', 'period']);
  const latestOrder = [
    updatedColumn ? `${updatedColumn} DESC NULLS LAST` : null,
    columns.has('period_end') ? 'period_end DESC NULLS LAST' : null,
  ].filter(Boolean).join(', ') || `${themeColumn || 'theme'} ASC`;
  const periodFilter = periodColumn ? `AND ${periodColumn} IN ('week', 'weekly', 'month', 'monthly', 'quarter', 'quarterly', 'year', 'yearly')` : '';
  const trendRows = themeColumn ? await safeRows(client, `
    WITH latest AS (
      SELECT DISTINCT ON (${themeColumn})
             ${themeColumn} AS key,
             LEAST(1, GREATEST(0, ABS(COALESCE(${accelerationColumn || '0'}::float8, 0)) / 100.0)) AS momentum,
             LEAST(1, GREATEST(0, ABS(COALESCE(${yoyColumn || '0'}::float8, 0)) / 100.0)) AS heat
        FROM theme_trend_aggregates
       WHERE ${themeColumn} IS NOT NULL
         ${periodFilter}
       ORDER BY ${themeColumn}, ${latestOrder}
    )
    SELECT key, heat, momentum
      FROM latest
     ORDER BY GREATEST(heat, momentum) DESC, key ASC
     LIMIT $1
  `, [limit]) : [];
  if (trendRows.length) {
    return trendRows.map((row) => ({
      key: row.key,
      heat: Number(row.heat || 0),
      momentum: Number(row.momentum || 0),
      source: 'theme_trend_aggregates',
    }));
  }
  const fallbackHeat = requirePolicyNumber(policy, 'automation.candidateRefresh.graphThemeFallbackHeat');
  const fallbackMomentum = requirePolicyNumber(policy, 'automation.candidateRefresh.graphThemeFallbackMomentum');
  const graphRows = await safeRows(client, `
    SELECT normalized_key AS key,
           $2::float8 AS heat,
           $3::float8 AS momentum
      FROM knowledge_nodes
     WHERE node_type = 'theme'
     ORDER BY updated_at DESC
     LIMIT $1
  `, [limit, fallbackHeat, fallbackMomentum]);
  return graphRows.map((row) => ({
    key: row.key,
    heat: Number(row.heat || 0),
    momentum: Number(row.momentum || 0),
    source: 'knowledge_nodes_fallback',
  }));
}

async function loadResearchQuestionThemes(client, limit = 24) {
  const rows = await safeRows(client, `
    SELECT themes
      FROM research_questions
     WHERE status = 'new'
       AND array_length(themes, 1) IS NOT NULL
     ORDER BY priority_score DESC NULLS LAST, created_at DESC
     LIMIT $1
  `, [limit]);
  return rows.flatMap((row) => Array.isArray(row.themes) ? row.themes : [])
    .map((theme) => String(theme || '').trim())
    .filter(Boolean);
}

async function loadGraphFrontierThemes(client, limit, policy) {
  const fallbackHeat = requirePolicyNumber(policy, 'automation.candidateRefresh.frontierThemeFallbackHeat');
  const fallbackMomentum = requirePolicyNumber(policy, 'automation.candidateRefresh.frontierThemeFallbackMomentum');
  const rows = await safeRows(client, `
    SELECT n.normalized_key AS key,
           $2::float8 AS heat,
           $3::float8 AS momentum,
           COUNT(e.id)::int AS graph_degree
      FROM knowledge_nodes n
      JOIN knowledge_edges e
        ON e.source_node_id = n.id
       AND e.status <> 'archived'
      JOIN knowledge_nodes target
        ON target.id = e.target_node_id
       AND target.node_type IN ('component','material','process','infrastructure','technology','supplier','company')
     WHERE n.node_type = 'theme'
       AND n.status <> 'archived'
     GROUP BY n.normalized_key
     ORDER BY COUNT(e.id) DESC, n.normalized_key ASC
     LIMIT $1
  `, [limit, fallbackHeat, fallbackMomentum]);
  return rows.map((row) => ({
    key: row.key,
    heat: Number(row.heat || 0),
    momentum: Number(row.momentum || 0),
    graphDegree: Number(row.graph_degree || 0),
    source: 'graph-frontier',
  }));
}

function loadSeedExamples() {
  const filePath = path.join(process.cwd(), 'data', 'eval', 'adjacency-goldset.json');
  if (!existsSync(filePath)) return [];
  try {
    return JSON.parse(readFileSync(filePath, 'utf8'));
  } catch {
    return [];
  }
}

export async function runRefreshCrossThemeCandidates(options = {}) {
  loadOptionalEnvFile();
  const policy = loadResearchOsPolicy();
  const client = options.client || new Client(options.pgConfig || resolveNasPgConfig());
  const ownClient = !options.client;
  if (ownClient) await client.connect();
  try {
    await ensureResearchOsSchema(client);
    const defaultLimit = requirePolicyNumber(policy, 'automation.candidateRefresh.hotThemeLimitDefault');
    const runLimit = Number(options.limit || defaultLimit);
    const questionLimitMin = requirePolicyNumber(policy, 'automation.candidateRefresh.questionThemeLimitMin');
    const questionLimitMultiplier = requirePolicyNumber(policy, 'automation.candidateRefresh.questionThemeLimitMultiplier');
    const questionFallbackHeat = requirePolicyNumber(policy, 'automation.candidateRefresh.researchQuestionThemeFallbackHeat');
    const questionFallbackMomentum = requirePolicyNumber(policy, 'automation.candidateRefresh.researchQuestionThemeFallbackMomentum');
    const frontierLimit = requirePolicyNumber(policy, 'automation.candidateRefresh.frontierThemeLimit');
    const graph = await loadKnowledgeGraph(client);
    const hotThemes = await loadHotThemes(client, runLimit, policy);
    const questionThemes = await loadResearchQuestionThemes(client, Math.max(questionLimitMin, runLimit * questionLimitMultiplier));
    const frontierThemes = await loadGraphFrontierThemes(client, frontierLimit, policy);
    const hotByKey = new Map(hotThemes.map((theme) => [theme.key, theme]));
    for (const theme of questionThemes) {
      if (!hotByKey.has(theme)) hotByKey.set(theme, {
        key: theme,
        heat: questionFallbackHeat,
        momentum: questionFallbackMomentum,
        source: 'research-question',
      });
    }
    for (const theme of frontierThemes) {
      if (!hotByKey.has(theme.key)) hotByKey.set(theme.key, theme);
    }
    const candidateThemes = [...hotByKey.values()];
    const scored = scoreCrossThemeConnectors({
      graph,
      themes: candidateThemes.map((theme) => theme.key),
      hotThemes: candidateThemes,
      seedExamples: loadSeedExamples(),
    }, policy);
    let inserted = 0;
    if (!options.dryRun) {
      const persistCandidates = [
        ...scored.candidates,
        ...(scored.backlogCandidates || []),
      ];
      const activeIds = persistCandidates.map((candidate) => candidate.id).filter(Boolean);
      for (const candidate of persistCandidates) {
        await upsertCrossThemeCandidate(client, candidate, new Map(), { skipEnsure: true });
        inserted += 1;
      }
      if (activeIds.length) {
        await client.query(
          `UPDATE cross_theme_candidates
              SET status = 'archived',
                  updated_at = NOW(),
                  metadata = metadata || jsonb_build_object(
                    'archivedBy', 'refresh-cross-theme-candidates',
                    'archivedReason', 'not present in latest scored candidate window'
                  )
            WHERE status IN ('new','research_backlog')
              AND deterministic_id IS NOT NULL
              AND NOT (deterministic_id = ANY($1::text[]))`,
          [activeIds],
        );
      }
    }
    return {
      ok: true,
      dryRun: Boolean(options.dryRun),
      hotThemeCount: hotThemes.length,
      researchQuestionThemeCount: questionThemes.length,
      frontierThemeCount: frontierThemes.length,
      graph: { nodes: graph.nodes.length, edges: graph.edges.length },
      candidateCount: scored.candidates.length,
      backlogCount: scored.backlogCandidates?.length || 0,
      inserted,
      metrics: scored.metrics,
    };
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
  runRefreshCrossThemeCandidates(parseArgs())
    .then((result) => console.log(JSON.stringify(result, null, 2)))
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
}
