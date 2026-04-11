#!/usr/bin/env node

import pg from 'pg';
import { pathToFileURL } from 'node:url';
import { loadOptionalEnvFile, resolveNasPgConfig } from './_shared/nas-runtime.mjs';
import { ensureEmergingTechSchema } from './_shared/schema-emerging-tech.mjs';
import { ensureCodexProposalSchema } from './_shared/schema-proposals.mjs';
import {
  evaluateDiscoveryTopicPromotion,
  THEME_TAXONOMY_VERSION,
} from './_shared/theme-taxonomy.mjs';
import { isLowSignalAddRssProposal } from './_shared/rss-proposal-quality.mjs';

loadOptionalEnvFile();

const { Client } = pg;
const DEFAULT_BATCH_SIZE = 200;

export function parseRepairArgs(argv = process.argv.slice(2)) {
  const parsed = {
    apply: false,
    limit: 0,
    batchSize: DEFAULT_BATCH_SIZE,
    repairTopics: true,
    pruneLowSignalProposals: true,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = String(argv[index] || '').trim().toLowerCase();
    if (arg === '--apply') {
      parsed.apply = true;
    } else if (arg === '--dry-run') {
      parsed.apply = false;
    } else if (arg === '--limit' && argv[index + 1]) {
      const value = Number(argv[++index]);
      if (Number.isFinite(value) && value > 0) parsed.limit = Math.floor(value);
    } else if (arg === '--batch-size' && argv[index + 1]) {
      const value = Number(argv[++index]);
      if (Number.isFinite(value) && value > 0) parsed.batchSize = Math.floor(value);
    } else if (arg === '--skip-topics') {
      parsed.repairTopics = false;
    } else if (arg === '--skip-proposals') {
      parsed.pruneLowSignalProposals = false;
    }
  }
  return parsed;
}

function normalizeStringArray(value) {
  return Array.isArray(value)
    ? value.map((item) => String(item || '').trim()).filter(Boolean)
    : [];
}

function mergeNormalizationMetadata(existingMetadata, normalization) {
  const base = existingMetadata && typeof existingMetadata === 'object'
    ? { ...existingMetadata }
    : {};
  return {
    ...base,
    normalization,
  };
}

export function buildDiscoveryTopicRepairRecord(row = {}) {
  const existingMetadata = row.codex_metadata && typeof row.codex_metadata === 'object'
    ? row.codex_metadata
    : {};
  const evaluation = evaluateDiscoveryTopicPromotion({
    id: row.id,
    label: row.label,
    description: row.description,
    category: row.category,
    stage: row.stage,
    parentTheme: row.parent_theme,
    keywords: normalizeStringArray(row.keywords),
    representativeTitles: normalizeStringArray(row.representative_titles),
    articleCount: Number(row.article_count || 0),
    momentum: Number(row.momentum || 0),
    researchMomentum: Number(row.research_momentum || 0),
    novelty: Number(row.novelty || 0),
    sourceQualityScore: Number(row.source_quality_score || 0),
  });
  const hasManualReview = Boolean(row.has_manual_review);
  const currentStatus = String(row.status || 'pending').trim().toLowerCase() || 'pending';
  const nextStatus = (
    !hasManualReview
    && evaluation.promotionState === 'suppressed'
    && currentStatus === 'pending'
  ) ? 'expired' : currentStatus;

  return {
    id: String(row.id || ''),
    hasManualReview,
    currentStatus,
    nextStatus,
    normalizedTheme: evaluation.canonicalTheme || null,
    normalizedParentTheme: evaluation.canonicalParentTheme || null,
    normalizedCategory: evaluation.canonicalCategory || null,
    promotionState: evaluation.promotionState || 'watch',
    suppressionReason: evaluation.suppressionReason || null,
    qualityFlags: Array.isArray(evaluation.qualityFlags) ? evaluation.qualityFlags : [],
    taxonomyVersion: evaluation.taxonomyVersion || THEME_TAXONOMY_VERSION,
    codexMetadata: mergeNormalizationMetadata(existingMetadata, evaluation),
  };
}

export function summarizeLowSignalProposalRows(rows = []) {
  const lowSignalIds = [];
  for (const row of rows) {
    if (isLowSignalAddRssProposal(row)) {
      lowSignalIds.push(Number(row.id));
    }
  }
  return {
    scanned: rows.length,
    lowSignalIds: lowSignalIds.filter((value) => Number.isFinite(value) && value > 0),
  };
}

async function tableExists(client, tableName) {
  const { rows } = await client.query(
    `SELECT to_regclass($1) AS table_name`,
    [`public.${tableName}`],
  );
  return Boolean(rows[0]?.table_name);
}

async function loadDiscoveryTopicRows(client, limit = 0) {
  const hasReviewTable = await tableExists(client, 'discovery_topic_reviews');
  const reviewSelect = hasReviewTable
    ? `EXISTS (
        SELECT 1
        FROM discovery_topic_reviews dtr
        WHERE dtr.topic_id = dt.id
      ) AS has_manual_review,`
    : 'FALSE AS has_manual_review,';
  const { rows } = await client.query(`
    SELECT
      dt.id,
      dt.label,
      dt.description,
      dt.category,
      dt.stage,
      dt.parent_theme,
      dt.keywords,
      dt.article_count,
      dt.momentum,
      dt.research_momentum,
      dt.novelty,
      dt.source_quality_score,
      dt.status,
      dt.codex_metadata,
      ${reviewSelect}
      ARRAY(
        SELECT a.title
        FROM discovery_topic_articles dta
        JOIN articles a ON a.id = dta.article_id
        WHERE dta.topic_id = dt.id
        ORDER BY a.published_at DESC, a.id DESC
        LIMIT 5
      ) AS representative_titles
    FROM discovery_topics dt
    ORDER BY dt.updated_at DESC NULLS LAST, dt.id ASC
  `);
  return limit > 0 ? rows.slice(0, limit) : rows;
}

async function applyDiscoveryTopicRepairs(client, records, batchSize) {
  let updatedRows = 0;
  let suppressedExpired = 0;
  for (let index = 0; index < records.length; index += batchSize) {
    const chunk = records.slice(index, index + batchSize);
    const values = [];
    const placeholders = chunk.map((record, rowIndex) => {
      const base = rowIndex * 10;
      values.push(
        record.id,
        record.hasManualReview,
        record.normalizedTheme,
        record.normalizedParentTheme,
        record.normalizedCategory,
        record.promotionState,
        record.suppressionReason,
        JSON.stringify(record.qualityFlags || []),
        record.taxonomyVersion,
        JSON.stringify(record.codexMetadata || {}),
      );
      return `($${base + 1}, $${base + 2}::boolean, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7}, $${base + 8}::jsonb, $${base + 9}, $${base + 10}::jsonb)`;
    }).join(',\n');

    const { rowCount } = await client.query(`
      UPDATE discovery_topics
      SET
        normalized_theme = CASE
          WHEN src.has_manual_review THEN discovery_topics.normalized_theme
          ELSE src.normalized_theme
        END,
        normalized_parent_theme = CASE
          WHEN src.has_manual_review THEN discovery_topics.normalized_parent_theme
          ELSE src.normalized_parent_theme
        END,
        normalized_category = CASE
          WHEN src.has_manual_review THEN discovery_topics.normalized_category
          ELSE src.normalized_category
        END,
        promotion_state = CASE
          WHEN src.has_manual_review THEN discovery_topics.promotion_state
          ELSE src.promotion_state
        END,
        suppression_reason = CASE
          WHEN src.has_manual_review THEN discovery_topics.suppression_reason
          ELSE src.suppression_reason
        END,
        quality_flags = src.quality_flags,
        taxonomy_version = src.taxonomy_version,
        parent_theme = CASE
          WHEN src.has_manual_review THEN COALESCE(discovery_topics.normalized_parent_theme, discovery_topics.parent_theme)
          ELSE COALESCE(src.normalized_parent_theme, discovery_topics.parent_theme)
        END,
        category = CASE
          WHEN src.has_manual_review THEN COALESCE(discovery_topics.normalized_category, discovery_topics.category)
          ELSE COALESCE(src.normalized_category, discovery_topics.category)
        END,
        codex_metadata = src.codex_metadata,
        status = CASE
          WHEN src.has_manual_review THEN discovery_topics.status
          WHEN src.promotion_state = 'suppressed' AND discovery_topics.status = 'pending' THEN 'expired'
          ELSE discovery_topics.status
        END,
        updated_at = NOW()
      FROM (
        VALUES ${placeholders}
      ) AS src(
        id,
        has_manual_review,
        normalized_theme,
        normalized_parent_theme,
        normalized_category,
        promotion_state,
        suppression_reason,
        quality_flags,
        taxonomy_version,
        codex_metadata
      )
      WHERE discovery_topics.id = src.id
    `, values);
    updatedRows += Number(rowCount || 0);
    suppressedExpired += chunk.filter((record) => (
      !record.hasManualReview
      && record.promotionState === 'suppressed'
      && record.currentStatus === 'pending'
    )).length;
  }
  return { updatedRows, suppressedExpired };
}

async function repairDiscoveryTopics(client, config) {
  const rows = await loadDiscoveryTopicRows(client, config.limit);
  const records = rows.map((row) => buildDiscoveryTopicRepairRecord(row));
  const summary = {
    scanned: records.length,
    canonical: records.filter((record) => record.promotionState === 'canonical').length,
    watch: records.filter((record) => record.promotionState === 'watch').length,
    suppressed: records.filter((record) => record.promotionState === 'suppressed').length,
    preservedManualReviews: records.filter((record) => record.hasManualReview).length,
    updatedRows: 0,
    suppressedExpired: 0,
  };
  if (config.apply && records.length > 0) {
    const applied = await applyDiscoveryTopicRepairs(client, records, config.batchSize);
    summary.updatedRows = applied.updatedRows;
    summary.suppressedExpired = applied.suppressedExpired;
  }
  return summary;
}

async function loadPendingProposalRows(client) {
  const { rows } = await client.query(`
    SELECT id, proposal_type, payload, status, reasoning, source, created_at
    FROM codex_proposals
    WHERE status IN ('pending', 'pending-review', 'pending-approval', 'approved')
      AND proposal_type = 'add-rss'
    ORDER BY created_at DESC
  `);
  return rows.map((row) => ({
    ...row,
    id: Number(row.id),
    proposal_type: String(row.proposal_type || ''),
    payload: row.payload || {},
    status: String(row.status || ''),
    reasoning: row.reasoning || '',
    source: row.source || '',
  }));
}

async function pruneLowSignalRssProposals(client, config) {
  const rows = await loadPendingProposalRows(client);
  const summary = summarizeLowSignalProposalRows(rows);
  if (config.apply && summary.lowSignalIds.length > 0) {
    const { rowCount } = await client.query(`
      UPDATE codex_proposals
      SET
        status = 'dead',
        result = jsonb_build_object(
          'reason', 'auto-pruned-low-signal-rss-query',
          'reviewedAt', NOW()
        ),
        executed_at = NOW()
      WHERE id = ANY($1::int[])
    `, [summary.lowSignalIds]);
    summary.pruned = Number(rowCount || 0);
  } else {
    summary.pruned = 0;
  }
  return summary;
}

export async function runThemeShellDataRepair(config = {}) {
  const normalizedConfig = {
    ...parseRepairArgs([]),
    ...config,
  };
  const client = new Client(resolveNasPgConfig());
  await client.connect();
  try {
    await ensureEmergingTechSchema(client);
    await ensureCodexProposalSchema(client);
    const summary = {
      apply: Boolean(normalizedConfig.apply),
      repairedTopics: null,
      prunedProposals: null,
    };
    if (normalizedConfig.repairTopics) {
      summary.repairedTopics = await repairDiscoveryTopics(client, normalizedConfig);
    }
    if (normalizedConfig.pruneLowSignalProposals) {
      summary.prunedProposals = await pruneLowSignalRssProposals(client, normalizedConfig);
    }
    return summary;
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
  const config = parseRepairArgs();
  runThemeShellDataRepair(config)
    .then((summary) => {
      process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
    })
    .catch((error) => {
      process.stderr.write(`${String(error?.stack || error || 'theme shell data repair failed')}\n`);
      process.exitCode = 1;
    });
}
