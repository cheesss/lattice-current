#!/usr/bin/env node

import pg from 'pg';
import { pathToFileURL } from 'node:url';
import { loadOptionalEnvFile, resolveNasPgConfig } from './_shared/nas-runtime.mjs';
import { ensureAutomationSchema } from './_shared/schema-automation.mjs';
import { ensureCodexProposalSchema } from './_shared/schema-proposals.mjs';
import { ensureEmergingTechSchema } from './_shared/schema-emerging-tech.mjs';
import { checkKillSwitch, checkBudget, consumeBudget } from './_shared/automation-budget.mjs';
import { logAutomationAction } from './_shared/automation-audit.mjs';
import { createLogger } from './_shared/structured-logger.mjs';
import { runCodexJsonPrompt } from './_shared/codex-json.mjs';
import { listBaseInvestmentThemes } from '../src/services/investment/theme-registry.ts';
import { buildThemeProposalEvidence } from '../src/services/server/proposal-evidence-builder.ts';

loadOptionalEnvFile();

const logger = createLogger('generate-codex-theme-proposals');
const { Client } = pg;
const DEFAULT_CATEGORIES = Object.freeze(['technology', 'science', 'environment', 'geopolitics', 'macro']);
const GENERIC_NORMALIZED_THEMES = new Set([
  'technology-general',
  'science-general',
  'environment-general',
  'geopolitics',
  'macroeconomics',
  'economy',
  'politics',
  'tech',
  'energy',
  'conflict',
]);
const SPECIALIZED_LABEL_CATEGORIES = new Set([
  'security',
  'robotics',
  'quantum',
  'semiconductor',
  'biotech',
  'materials',
  'energy',
]);

export function parseArgs(argv = process.argv.slice(2)) {
  const parsed = {
    limit: 3,
    minArticleCount: 250,
    minMomentum: 1.1,
    minNovelty: 0.12,
    minInvestmentRelevance: 0.55,
    categories: DEFAULT_CATEGORIES.slice(),
    dryRun: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--limit' && argv[index + 1]) {
      const value = Number(argv[++index]);
      if (Number.isFinite(value) && value > 0) parsed.limit = Math.floor(value);
    } else if (arg === '--min-article-count' && argv[index + 1]) {
      const value = Number(argv[++index]);
      if (Number.isFinite(value) && value > 0) parsed.minArticleCount = Math.floor(value);
    } else if (arg === '--min-momentum' && argv[index + 1]) {
      const value = Number(argv[++index]);
      if (Number.isFinite(value) && value > 0) parsed.minMomentum = value;
    } else if (arg === '--min-novelty' && argv[index + 1]) {
      const value = Number(argv[++index]);
      if (Number.isFinite(value) && value >= 0) parsed.minNovelty = value;
    } else if (arg === '--min-investment-relevance' && argv[index + 1]) {
      const value = Number(argv[++index]);
      if (Number.isFinite(value) && value >= 0) parsed.minInvestmentRelevance = value;
    } else if (arg === '--categories' && argv[index + 1]) {
      const values = String(argv[++index] || '')
        .split(',')
        .map((entry) => entry.trim().toLowerCase())
        .filter(Boolean);
      if (values.length > 0) parsed.categories = values;
    } else if (arg === '--dry-run') {
      parsed.dryRun = true;
    }
  }

  return parsed;
}

function normalize(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function slugify(value) {
  return normalize(value).replace(/\s+/g, '-').slice(0, 72) || 'theme';
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function scoreTopic(row) {
  const articleScore = clamp(Number(row.article_count || 0) / 1200, 0, 1);
  const momentumScore = clamp((Number(row.momentum || 0) - 1) / 1.5, 0, 1);
  const noveltyScore = clamp(Number(row.novelty || 0), 0, 1);
  const investmentScore = clamp(Number(row.investment_relevance || 0), 0, 1);
  const sourceScore = clamp((Number(row.source_count || 0) || Number(row.diversity || 0)) / 6, 0, 1);
  return Math.round(
    (investmentScore * 0.35
      + noveltyScore * 0.2
      + momentumScore * 0.2
      + sourceScore * 0.15
      + articleScore * 0.1) * 100,
  );
}

function computeKnownThemeOverlap(row, knownThemes) {
  const phrases = [
    row.label,
    ...(Array.isArray(row.key_technologies) ? row.key_technologies : []),
    ...(Array.isArray(row.keywords) ? row.keywords : []),
    row.normalized_theme,
    row.normalized_parent_theme,
  ]
    .map((entry) => normalize(entry))
    .filter(Boolean);

  if (phrases.length === 0) return 0;

  let best = 0;
  for (const theme of knownThemes) {
    const themeTerms = [
      theme.id,
      theme.label,
      ...(theme.triggers || []),
      ...(theme.sectors || []),
      ...(theme.commodities || []),
    ]
      .map((entry) => normalize(entry))
      .filter(Boolean);

    for (const phrase of phrases) {
      for (const term of themeTerms) {
        if (!term) continue;
        if (phrase === term) return 1;
        if (phrase.includes(term) || term.includes(phrase)) {
          best = Math.max(best, Math.min(phrase.length, term.length) / Math.max(phrase.length, term.length));
        }
      }
    }
  }
  return Number(best.toFixed(2));
}

function scoreKnownThemeRelevance(theme, row) {
  const phrasePool = [
    row.label,
    ...(Array.isArray(row.key_technologies) ? row.key_technologies : []),
    ...(Array.isArray(row.keywords) ? row.keywords : []),
    row.normalized_theme,
    row.normalized_parent_theme,
    row.normalized_category,
    row.labeled_category,
  ]
    .map((entry) => normalize(entry))
    .filter(Boolean);

  if (phrasePool.length === 0) return 0;

  const themeTerms = [
    theme.id,
    theme.label,
    ...(theme.triggers || []).slice(0, 8),
    ...(theme.sectors || []).slice(0, 4),
    ...(theme.commodities || []).slice(0, 4),
  ]
    .map((entry) => normalize(entry))
    .filter(Boolean);

  let score = 0;
  for (const phrase of phrasePool) {
    for (const term of themeTerms) {
      if (phrase === term) score += 6;
      else if (phrase.includes(term) || term.includes(phrase)) score += 2;
    }
  }
  if (normalize(theme.id) === normalize(row.normalized_theme)) score += 4;
  if (normalize(theme.id) === normalize(row.normalized_parent_theme)) score += 2;
  return score;
}

function selectKnownThemesForPrompt(row, knownThemes) {
  const selected = knownThemes
    .map((theme) => ({ theme, score: scoreKnownThemeRelevance(theme, row) }))
    .sort((left, right) => right.score - left.score || left.theme.id.localeCompare(right.theme.id))
    .filter((entry) => entry.score > 0)
    .slice(0, 6)
    .map((entry) => entry.theme);
  return selected.length > 0 ? selected : knownThemes.slice(0, 6);
}

function buildTopicReason(row) {
  const parts = [
    `${row.article_count} articles`,
    `momentum ${Number(row.momentum || 0).toFixed(2)}x`,
    `novelty ${Math.round(Number(row.novelty || 0) * 100)}%`,
    `investment relevance ${Math.round(Number(row.investment_relevance || 0) * 100)}%`,
  ];
  if (row.labeled_category) parts.push(`codex category ${row.labeled_category}`);
  return parts.join(' | ');
}

function normalizeAssetKind(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (['equity', 'commodity', 'fx', 'rate', 'crypto'].includes(normalized)) return normalized;
  return 'etf';
}

function normalizeDirection(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (['short', 'hedge', 'watch', 'pair'].includes(normalized)) return normalized;
  return 'long';
}

function normalizeRole(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'hedge' || normalized === 'confirm') return normalized;
  return 'primary';
}

function normalizeTransmissionOrder(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (['direct', 'second-order', 'third-order', 'fourth-order', 'proxy'].includes(normalized)) return normalized;
  return 'direct';
}

function normalizeRelationType(value) {
  const normalized = String(value || '').trim().toLowerCase();
  const allowed = [
    'direct-beneficiary',
    'supplier',
    'infrastructure',
    'input-cost',
    'customer',
    'financing',
    'insurance',
    'policy-beneficiary',
    'policy-loser',
    'regional-proxy',
    'hedge',
    'substitute',
  ];
  if (allowed.includes(normalized)) return normalized;
  return 'direct-beneficiary';
}

function buildThemeLookupMap(themes = []) {
  const lookup = new Map();
  for (const theme of themes) {
    const id = String(theme?.id || '').trim().toLowerCase();
    if (!id) continue;
    lookup.set(id, theme);
  }
  return lookup;
}

function buildCompactThemePrompt(row, queueItem, promptKnownThemes, evidence) {
  const knownThemeRows = promptKnownThemes
    .slice(0, 6)
    .map((theme) => `- ${theme.id}: ${theme.label} (${theme.triggers.slice(0, 4).join(', ')})`)
    .join('\n');
  const shortEvidence = [
    evidence?.summary ? `Evidence summary: ${evidence.summary}` : '',
    evidence?.historicalAnalogs?.length ? `Historical analogs: ${evidence.historicalAnalogs.slice(0, 4).join(' | ')}` : '',
    evidence?.coverageSignals?.length ? `Coverage signals: ${evidence.coverageSignals.slice(0, 4).join(' | ')}` : '',
    evidence?.techTrends?.length ? `Tech trends: ${evidence.techTrends.slice(0, 3).join(' | ')}` : '',
  ].filter(Boolean);

  return [
    'You are evaluating whether this discovery topic deserves promotion into a new reusable investment theme.',
    'This is not a generic brainstorming task. You must make an explicit judgment call.',
    '',
    'Analyze the topic in this order:',
    '1. Distinctness: is it meaningfully different from the existing themes listed below?',
    '2. Durability: is it a multi-week or multi-quarter structural motif rather than a one-off headline burst?',
    '3. Transmission path: what direct, second-order, third-order, or fourth-order pathways carry the topic into investable markets?',
    '4. Investability: can it be expressed with at least 2 liquid public market symbols, even if some are indirect beneficiaries, suppliers, infrastructure, policy proxies, insurance names, or hedges?',
    '5. Coherence: do the triggers, thesis, invalidation, pathways, and assets clearly fit together?',
    '',
    'Decision rules:',
    '- Return "reject" if the topic mostly overlaps an existing theme.',
    '- Return "attach" if the topic is not distinct enough for a new canonical theme, but it reveals a reusable adjacent pathway, second-order effect, third-order effect, or proxy under an existing theme.',
    '- Return "reject" if the topic is interesting but not durable.',
    '- Return "reject" if you cannot identify at least 2 valid liquid symbols with a concrete transmission path for a new theme, or at least 1 valid liquid symbol for an attachment.',
    '- Return "reject" if the topic is noisy, hype-driven, or too event-specific.',
    '- Do not reject only because the best symbols are indirect. Indirect beneficiaries are valid if the transmission path is concrete, durable, and not hand-wavy.',
    '- Return "propose" only if the topic is distinct, durable, investable, and explainable through a credible transmission chain.',
    '- Return "attach" when the best answer is: keep the existing theme, but add new adjacent pathways, indirect beneficiaries, suppliers, insurers, financiers, regional proxies, or hedges under that theme.',
    '',
    'Output rules:',
    '- Return strict JSON only.',
    '- Do not include markdown fences.',
    '- Do not include any explanation outside JSON.',
    '- If decision is "reject", proposal and attachment must both be null.',
    '- If decision is "attach", proposal must be null and attachment must be populated.',
    '- If decision is "propose", proposal.assets must contain 2-8 valid liquid symbols.',
    '- If decision is "attach", attachment.assets must contain 1-8 valid liquid symbols and attachment.targetTheme must be one of the existing themes below.',
    '- Every asset must include symbol, assetKind, sector, direction, and role.',
    '- Every asset should also include relationType, transmissionOrder, and transmissionPath when possible.',
    '- Use transmissionOrder values: direct, second-order, third-order, fourth-order, proxy.',
    '- Use relationType values such as direct-beneficiary, supplier, infrastructure, input-cost, customer, financing, insurance, policy-beneficiary, policy-loser, regional-proxy, hedge, substitute.',
    '',
    'Schema:',
    '{"decision":"propose|attach|reject","reason":"short decision summary","overlapTheme":"existing-theme-id-or-null","proposal":{"id":"kebab-case","label":"text","confidence":0-100,"triggers":["keyword"],"sectors":["sector"],"commodities":["commodity"],"timeframe":"1d-90d","thesis":"2-3 sentence thesis covering what changed, why it matters, the key transmission path, and why the theme is durable","invalidation":["risk"],"transmissionChannels":["direct or indirect mechanism"],"assets":[{"symbol":"QQQ","name":"Invesco QQQ Trust","assetKind":"etf|equity|commodity|fx|rate|crypto","sector":"text","commodity":null,"direction":"long|short|hedge|watch|pair","role":"primary|confirm|hedge","relationType":"direct-beneficiary|supplier|infrastructure|input-cost|customer|financing|insurance|policy-beneficiary|policy-loser|regional-proxy|hedge|substitute","transmissionOrder":"direct|second-order|third-order|fourth-order|proxy","transmissionPath":"one short sentence describing how this asset is affected"}],"suggestedSources":[{"url":"https://...","domain":"example.com","confidence":0-100}],"suggestedGdeltKeywords":["keyword"]},"attachment":{"targetTheme":"existing-theme-id","label":"short adjacent pathway label","confidence":0-100,"relationType":"supplier|infrastructure|insurance|regional-proxy|hedge|substitute|direct-beneficiary","transmissionOrder":"direct|second-order|third-order|fourth-order|proxy","transmissionPath":"one short sentence describing the mechanism","thesis":"2-3 sentence explanation of how this pathway fits inside the target theme","invalidation":["risk"],"transmissionChannels":["direct or indirect mechanism"],"assets":[{"symbol":"QQQ","name":"Invesco QQQ Trust","assetKind":"etf|equity|commodity|fx|rate|crypto","sector":"text","commodity":null,"direction":"long|short|hedge|watch|pair","role":"primary|confirm|hedge","relationType":"direct-beneficiary|supplier|infrastructure|input-cost|customer|financing|insurance|policy-beneficiary|policy-loser|regional-proxy|hedge|substitute","transmissionOrder":"direct|second-order|third-order|fourth-order|proxy","transmissionPath":"one short sentence describing how this asset is affected"}],"suggestedSources":[{"url":"https://...","domain":"example.com","confidence":0-100}],"suggestedGdeltKeywords":["keyword"]}}',
    `Topic label: ${queueItem.label}`,
    `Topic reason: ${queueItem.reason}`,
    `Normalized theme: ${row.normalized_theme || 'none'}`,
    `Normalized parent theme: ${row.normalized_parent_theme || 'none'}`,
    `Category: ${row.normalized_category || row.labeled_category || 'unknown'}`,
    `Key technologies: ${(Array.isArray(row.key_technologies) ? row.key_technologies : []).slice(0, 6).join(', ') || '(none)'}`,
    `Representative headlines: ${queueItem.supportingHeadlines.slice(0, 5).join(' || ') || '(none)'}`,
    ...shortEvidence,
    'Existing themes (do not duplicate):',
    knownThemeRows || '(none)',
  ].join('\n');
}

function normalizeThemeProposal(raw, queueItem) {
  const decision = String(raw?.decision || '').trim().toLowerCase();
  if (decision === 'reject' || decision === 'attach') return null;
  const payload = raw?.proposal && typeof raw.proposal === 'object' ? raw.proposal : raw;

  const assets = Array.isArray(payload?.assets)
    ? payload.assets
      .map((asset) => ({
        symbol: String(asset?.symbol || '').trim().toUpperCase(),
        name: String(asset?.name || asset?.symbol || '').trim(),
        assetKind: normalizeAssetKind(asset?.assetKind),
        sector: String(asset?.sector || 'cross-asset').trim().toLowerCase() || 'cross-asset',
        commodity: asset?.commodity ? String(asset.commodity).trim().toLowerCase() : null,
        direction: normalizeDirection(asset?.direction),
        role: normalizeRole(asset?.role),
        relationType: normalizeRelationType(asset?.relationType),
        transmissionOrder: normalizeTransmissionOrder(asset?.transmissionOrder),
        transmissionPath: String(asset?.transmissionPath || '').trim().slice(0, 220),
      }))
      .filter((asset) => asset.symbol)
      .slice(0, 8)
    : [];
  if (assets.length === 0) return null;

  return {
    id: slugify(String(payload?.id || queueItem.topicKey)),
    label: String(payload?.label || queueItem.label).trim() || queueItem.label,
    confidence: clamp(Number(payload?.confidence || queueItem.signalScore), 25, 95),
    reason: String(raw?.reason || payload?.reason || `Codex proposed a reusable theme for ${queueItem.label}.`).slice(0, 280),
    triggers: Array.isArray(payload?.triggers)
      ? payload.triggers.map((item) => String(item || '').trim().toLowerCase()).filter(Boolean).slice(0, 18)
      : queueItem.hints.slice(0, 8),
    sectors: Array.isArray(payload?.sectors)
      ? payload.sectors.map((item) => String(item || '').trim().toLowerCase()).filter(Boolean).slice(0, 8)
      : [],
    commodities: Array.isArray(payload?.commodities)
      ? payload.commodities.map((item) => String(item || '').trim().toLowerCase()).filter(Boolean).slice(0, 6)
      : [],
    timeframe: String(payload?.timeframe || '1d-30d').trim() || '1d-30d',
    thesis: String(payload?.thesis || `Repeated motif ${queueItem.label} appears to carry reusable event-to-asset structure.`).trim(),
    invalidation: Array.isArray(payload?.invalidation)
      ? payload.invalidation.map((item) => String(item || '').trim()).filter(Boolean).slice(0, 6)
      : [],
    transmissionChannels: Array.isArray(payload?.transmissionChannels)
      ? payload.transmissionChannels.map((item) => String(item || '').trim()).filter(Boolean).slice(0, 8)
      : [],
    suggestedSources: Array.isArray(payload?.suggestedSources)
      ? payload.suggestedSources
        .map((source) => ({
          url: String(source?.url || '').trim(),
          domain: String(source?.domain || '').trim().toLowerCase(),
          confidence: clamp(Math.round(Number(source?.confidence) || 0), 0, 100),
        }))
        .filter((source) => source.url && source.domain)
        .slice(0, 8)
      : [],
    suggestedGdeltKeywords: Array.isArray(payload?.suggestedGdeltKeywords)
      ? payload.suggestedGdeltKeywords.map((item) => String(item || '').trim().toLowerCase()).filter(Boolean).slice(0, 12)
      : [],
    assets,
  };
}

function normalizeThemeAttachment(raw, queueItem, themeLookup) {
  const decision = String(raw?.decision || '').trim().toLowerCase();
  if (decision !== 'attach') return null;
  const payload = raw?.attachment && typeof raw.attachment === 'object' ? raw.attachment : raw;
  const targetTheme = String(payload?.targetTheme || raw?.overlapTheme || '').trim().toLowerCase();
  if (!targetTheme || !themeLookup.has(targetTheme)) return null;

  const assets = Array.isArray(payload?.assets)
    ? payload.assets
      .map((asset) => ({
        symbol: String(asset?.symbol || '').trim().toUpperCase(),
        name: String(asset?.name || asset?.symbol || '').trim(),
        assetKind: normalizeAssetKind(asset?.assetKind),
        sector: String(asset?.sector || 'cross-asset').trim().toLowerCase() || 'cross-asset',
        commodity: asset?.commodity ? String(asset.commodity).trim().toLowerCase() : null,
        direction: normalizeDirection(asset?.direction),
        role: normalizeRole(asset?.role),
        relationType: normalizeRelationType(asset?.relationType || payload?.relationType),
        transmissionOrder: normalizeTransmissionOrder(asset?.transmissionOrder || payload?.transmissionOrder),
        transmissionPath: String(asset?.transmissionPath || payload?.transmissionPath || '').trim().slice(0, 220),
      }))
      .filter((asset) => asset.symbol)
      .slice(0, 8)
    : [];
  if (assets.length === 0) return null;

  const target = themeLookup.get(targetTheme);
  const attachmentLabel = String(payload?.label || queueItem.label).trim() || queueItem.label;
  const attachmentKey = `${targetTheme}::${slugify(String(payload?.id || attachmentLabel || queueItem.topicKey))}`;

  return {
    attachmentKey,
    targetTheme,
    targetThemeLabel: String(target?.label || targetTheme).trim(),
    label: attachmentLabel,
    confidence: clamp(Number(payload?.confidence || raw?.confidence || queueItem.signalScore), 25, 95),
    reason: String(raw?.reason || payload?.reason || `Codex attached an adjacent pathway to ${targetTheme}.`).slice(0, 280),
    relationType: normalizeRelationType(payload?.relationType),
    transmissionOrder: normalizeTransmissionOrder(payload?.transmissionOrder),
    transmissionPath: String(payload?.transmissionPath || '').trim().slice(0, 220),
    thesis: String(payload?.thesis || `Adjacent pathway ${attachmentLabel} maps into ${targetTheme}.`).trim(),
    invalidation: Array.isArray(payload?.invalidation)
      ? payload.invalidation.map((item) => String(item || '').trim()).filter(Boolean).slice(0, 6)
      : [],
    transmissionChannels: Array.isArray(payload?.transmissionChannels)
      ? payload.transmissionChannels.map((item) => String(item || '').trim()).filter(Boolean).slice(0, 8)
      : [],
    triggers: Array.isArray(payload?.triggers)
      ? payload.triggers.map((item) => String(item || '').trim().toLowerCase()).filter(Boolean).slice(0, 18)
      : queueItem.hints.slice(0, 8),
    sectors: Array.isArray(payload?.sectors)
      ? payload.sectors.map((item) => String(item || '').trim().toLowerCase()).filter(Boolean).slice(0, 8)
      : [],
    commodities: Array.isArray(payload?.commodities)
      ? payload.commodities.map((item) => String(item || '').trim().toLowerCase()).filter(Boolean).slice(0, 6)
      : [],
    timeframe: String(payload?.timeframe || '1d-90d').trim() || '1d-90d',
    suggestedSources: Array.isArray(payload?.suggestedSources)
      ? payload.suggestedSources
        .map((source) => ({
          url: String(source?.url || '').trim(),
          domain: String(source?.domain || '').trim().toLowerCase(),
          confidence: clamp(Math.round(Number(source?.confidence) || 0), 0, 100),
        }))
        .filter((source) => source.url && source.domain)
        .slice(0, 8)
      : [],
    suggestedGdeltKeywords: Array.isArray(payload?.suggestedGdeltKeywords)
      ? payload.suggestedGdeltKeywords.map((item) => String(item || '').trim().toLowerCase()).filter(Boolean).slice(0, 12)
      : [],
    assets,
  };
}

function buildQueueItem(row, knownThemes, articleMap) {
  const representativeArticles = (Array.isArray(row.representative_article_ids) ? row.representative_article_ids : [])
    .map((id) => articleMap.get(Number(id)))
    .filter(Boolean);
  const supportingHeadlines = representativeArticles
    .map((article) => String(article.title || '').trim())
    .filter(Boolean)
    .slice(0, 6);
  const supportingSources = Array.from(new Set(
    representativeArticles.map((article) => String(article.source || '').trim().toLowerCase()).filter(Boolean),
  ));
  const hints = Array.from(new Set([
    ...(Array.isArray(row.key_technologies) ? row.key_technologies : []),
    ...(Array.isArray(row.keywords) ? row.keywords : []),
    row.normalized_theme,
    row.normalized_parent_theme,
    row.normalized_category,
    row.labeled_category,
  ].map((entry) => String(entry || '').trim()).filter(Boolean))).slice(0, 12);

  return {
    id: `theme-discovery:${row.id}`,
    topicKey: slugify(row.label || row.id),
    label: String(row.label || row.id || '').trim(),
    status: 'open',
    signalScore: scoreTopic(row),
    overlapWithKnownThemes: computeKnownThemeOverlap(row, knownThemes),
    sampleCount: Number(row.article_count || 0),
    sourceCount: Number(row.source_count || row.diversity || 0),
    regionCount: Number(row.diversity || 0),
    supportingHeadlines,
    supportingRegions: [],
    supportingSources,
    datasetIds: Array.from(new Set([row.normalized_category, row.normalized_parent_theme].filter(Boolean))),
    suggestedSymbols: [],
    hints,
    reason: buildTopicReason(row),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

async function loadCandidateTopics(client, options) {
  const { rows } = await client.query(`
    SELECT
      dt.id,
      COALESCE(dt.label, dt.codex_metadata->'labeling'->>'topicName') AS label,
      COALESCE(dt.description, dt.codex_metadata->'labeling'->>'description', '') AS description,
      dt.article_count,
      dt.momentum,
      dt.novelty,
      dt.diversity,
      dt.key_technologies,
      dt.key_companies,
      dt.keywords,
      dt.representative_article_ids,
      dt.normalized_theme,
      dt.normalized_parent_theme,
      dt.normalized_category,
      dt.promotion_state,
      dt.status,
      COALESCE((dt.codex_metadata->'labeling'->>'investmentRelevance')::double precision, 0) AS investment_relevance,
      LOWER(COALESCE(dt.codex_metadata->'labeling'->>'category', '')) AS labeled_category,
      COALESCE((dt.source_quality_breakdown->>'distinctSourceCount')::int, 0) AS source_count
    FROM discovery_topics dt
    WHERE dt.promotion_state IN ('watch', 'canonical')
      AND dt.status IN ('labeled', 'reported')
      AND COALESCE(dt.article_count, 0) >= $1
      AND COALESCE(dt.momentum, 0) >= $2
      AND COALESCE(dt.novelty, 0) >= $3
      AND COALESCE((dt.codex_metadata->'labeling'->>'investmentRelevance')::double precision, 0) >= $4
      AND COALESCE(dt.normalized_category, '') = ANY($5::text[])
      AND (
        COALESCE(dt.normalized_theme, '') = ANY($6::text[])
        OR LOWER(COALESCE(dt.codex_metadata->'labeling'->>'category', '')) = ANY($7::text[])
      )
      AND NOT EXISTS (
        SELECT 1
        FROM codex_proposals cp
        WHERE cp.proposal_type IN ('add-theme', 'attach-theme')
          AND COALESCE(cp.payload->>'sourceTopicId', cp.payload->>'topicId') = dt.id
      )
    ORDER BY investment_relevance DESC, dt.novelty DESC, dt.article_count DESC, dt.momentum DESC
    LIMIT $8
  `, [
    options.minArticleCount,
    options.minMomentum,
    options.minNovelty,
    options.minInvestmentRelevance,
    options.categories,
    Array.from(GENERIC_NORMALIZED_THEMES),
    Array.from(SPECIALIZED_LABEL_CATEGORIES),
    Math.max(options.limit * 3, options.limit),
  ]);

  return rows.filter((row) => String(row.label || '').trim());
}

async function loadRepresentativeArticleMap(client, rows) {
  const articleIds = Array.from(new Set(
    rows.flatMap((row) => (Array.isArray(row.representative_article_ids) ? row.representative_article_ids : []))
      .map((id) => Number(id))
      .filter((id) => Number.isFinite(id) && id > 0),
  ));
  if (articleIds.length === 0) return new Map();

  const { rows: articleRows } = await client.query(`
    SELECT id, title, source
    FROM articles
    WHERE id = ANY($1::int[])
  `, [articleIds]);

  return new Map(articleRows.map((row) => [Number(row.id), row]));
}

async function loadExistingThemeProposalIds(client) {
  const { rows } = await client.query(`
    SELECT DISTINCT LOWER(COALESCE(payload->>'id', '')) AS theme_id
    FROM codex_proposals
    WHERE proposal_type = 'add-theme'
      AND COALESCE(payload->>'id', '') <> ''
  `);
  return new Set(rows.map((row) => String(row.theme_id || '').trim()).filter(Boolean));
}

async function loadExistingAttachmentKeys(client) {
  const { rows } = await client.query(`
    SELECT DISTINCT LOWER(COALESCE(payload->>'attachmentKey', '')) AS attachment_key
    FROM codex_proposals
    WHERE proposal_type = 'attach-theme'
      AND COALESCE(payload->>'attachmentKey', '') <> ''
  `);
  return new Set(rows.map((row) => String(row.attachment_key || '').trim()).filter(Boolean));
}

export async function runGenerateCodexThemeProposals(options = {}) {
  checkKillSwitch();
  const config = { ...parseArgs([]), ...options };
  const client = new Client(resolveNasPgConfig());
  await client.connect();

  try {
    await ensureAutomationSchema(client);
    await ensureCodexProposalSchema(client);
    await ensureEmergingTechSchema(client);

    const knownThemes = listBaseInvestmentThemes();
    const themeLookup = buildThemeLookupMap(knownThemes);
    const knownThemeIds = new Set(knownThemes.map((theme) => String(theme.id || '').trim().toLowerCase()).filter(Boolean));
    const [topics, existingProposalIds, existingAttachmentKeys] = await Promise.all([
      loadCandidateTopics(client, config),
      loadExistingThemeProposalIds(client),
      loadExistingAttachmentKeys(client),
    ]);
    const articleMap = await loadRepresentativeArticleMap(client, topics);

    const queued = [];
    const attached = [];
    const skipped = [];
    const attemptedTopicIds = [];

    for (const row of topics) {
      if (queued.length + attached.length >= config.limit) break;

      const budget = await checkBudget(client, 'codexCalls', 1);
      if (!budget.allowed) {
        skipped.push({
          topicId: row.id,
          label: row.label,
          reason: budget.reason || 'codex budget exhausted',
        });
        break;
      }

      const promptKnownThemes = selectKnownThemesForPrompt(row, knownThemes);
      const queueItem = buildQueueItem(row, promptKnownThemes, articleMap);
      const evidence = buildThemeProposalEvidence({
        queueItem,
        knownThemes: promptKnownThemes,
        techTrends: [
          `normalizedTheme=${row.normalized_theme || 'unknown'}`,
          `investmentRelevance=${Math.round(Number(row.investment_relevance || 0) * 100)}%`,
          `keyTechnologies=${(Array.isArray(row.key_technologies) ? row.key_technologies : []).slice(0, 3).join(', ') || 'none'}`,
        ],
      });

      const prompt = buildCompactThemePrompt(row, queueItem, promptKnownThemes, evidence);
      const codexResult = await runCodexJsonPrompt(prompt, 45_000, {
        label: 'generate-codex-theme-proposals',
        topicId: row.id,
      });
      const proposal = codexResult.parsed
        ? normalizeThemeProposal(codexResult.parsed, queueItem)
        : null;
      const attachment = codexResult.parsed
        ? normalizeThemeAttachment(codexResult.parsed, queueItem, themeLookup)
        : null;
      const codexReason = codexResult.parsed && typeof codexResult.parsed === 'object'
        ? String(codexResult.parsed.reason || '').trim()
        : '';
      attemptedTopicIds.push(row.id);
      if (!config.dryRun) {
        await consumeBudget(client, 'codexCalls', 1, {
          purpose: 'generate-codex-theme-proposals',
          sourceTopicId: row.id,
          sourceTopicLabel: row.label,
        });
      }

      if (!proposal && !attachment) {
        skipped.push({
          topicId: row.id,
          label: row.label,
          reason: codexResult.parsed
            ? (codexReason || 'codex returned no valid theme proposal')
            : String(codexResult.stderr || codexResult.message || 'codex exec failed').slice(0, 180),
        });
        continue;
      }

      if (proposal) {
        const normalizedProposalId = String(proposal.id || '').trim().toLowerCase();
        if (!normalizedProposalId || knownThemeIds.has(normalizedProposalId) || existingProposalIds.has(normalizedProposalId)) {
          skipped.push({
            topicId: row.id,
            label: row.label,
            reason: `proposal id ${normalizedProposalId || '(missing)'} already exists or is invalid`,
          });
          continue;
        }

        const payload = {
          ...proposal,
          symbols: Array.isArray(proposal.assets)
            ? proposal.assets.map((asset) => String(asset?.symbol || '').trim()).filter(Boolean)
            : [],
          sourceTopicId: row.id,
          sourceTopicLabel: row.label,
          sourceTopicCategory: row.normalized_category,
          sourceTopicNormalizedTheme: row.normalized_theme,
          sourceTopicNormalizedParentTheme: row.normalized_parent_theme,
          sourceTopicInvestmentRelevance: Number(row.investment_relevance || 0),
          sourceTopicKeywords: Array.isArray(row.keywords) ? row.keywords : [],
          sourceTopicKeyTechnologies: Array.isArray(row.key_technologies) ? row.key_technologies : [],
          queueItem,
        };

        if (!config.dryRun) {
          await client.query(`
            INSERT INTO codex_proposals (proposal_type, payload, status, reasoning, source)
            VALUES ('add-theme', $1::jsonb, 'pending', $2, 'topic-discovery-theme')
          `, [
            JSON.stringify(payload),
            String(proposal.reason || queueItem.reason || 'generated from topic discovery').slice(0, 500),
          ]);
        }

        existingProposalIds.add(normalizedProposalId);
        queued.push({
          topicId: row.id,
          topicLabel: row.label,
          proposalId: proposal.id,
          proposalLabel: proposal.label,
          confidence: proposal.confidence,
        });
        continue;
      }

      const attachmentKey = String(attachment?.attachmentKey || '').trim().toLowerCase();
      if (!attachmentKey || existingAttachmentKeys.has(attachmentKey)) {
        skipped.push({
          topicId: row.id,
          label: row.label,
          reason: `attachment key ${attachmentKey || '(missing)'} already exists or is invalid`,
        });
        continue;
      }

      const attachmentPayload = {
        ...attachment,
        symbols: Array.isArray(attachment.assets)
          ? attachment.assets.map((asset) => String(asset?.symbol || '').trim()).filter(Boolean)
          : [],
        sourceTopicId: row.id,
        sourceTopicLabel: row.label,
        sourceTopicCategory: row.normalized_category,
        sourceTopicNormalizedTheme: row.normalized_theme,
        sourceTopicNormalizedParentTheme: row.normalized_parent_theme,
        sourceTopicInvestmentRelevance: Number(row.investment_relevance || 0),
        sourceTopicKeywords: Array.isArray(row.keywords) ? row.keywords : [],
        sourceTopicKeyTechnologies: Array.isArray(row.key_technologies) ? row.key_technologies : [],
        queueItem,
      };

      if (!config.dryRun) {
        await client.query(`
          INSERT INTO codex_proposals (proposal_type, payload, status, reasoning, source)
          VALUES ('attach-theme', $1::jsonb, 'pending', $2, 'topic-discovery-theme')
        `, [
          JSON.stringify(attachmentPayload),
          String(attachment.reason || queueItem.reason || 'generated attachment from topic discovery').slice(0, 500),
        ]);
      }

      existingAttachmentKeys.add(attachmentKey);
      attached.push({
        topicId: row.id,
        topicLabel: row.label,
        targetTheme: attachment.targetTheme,
        attachmentKey,
        attachmentLabel: attachment.label,
        confidence: attachment.confidence,
      });
    }

    await logAutomationAction(client, {
      type: 'generate-codex-theme-proposals',
      params: {
        limit: config.limit,
        minArticleCount: config.minArticleCount,
        minMomentum: config.minMomentum,
        minNovelty: config.minNovelty,
        minInvestmentRelevance: config.minInvestmentRelevance,
        categories: config.categories,
        attemptedTopicIds,
      },
      result: queued.length > 0 || attached.length > 0 ? 'success' : 'skipped',
      reason: queued.length > 0
        ? `queued ${queued.length} add-theme proposals`
        : attached.length > 0
          ? `queued ${attached.length} attach-theme proposals`
        : skipped[0]?.reason || 'no eligible discovery topics',
    });

    logger.info('theme proposal generation complete', {
      candidateCount: topics.length,
      queuedCount: queued.length,
      attachedCount: attached.length,
      skippedCount: skipped.length,
      dryRun: config.dryRun,
    });

    return {
      ok: true,
      dryRun: config.dryRun,
      scannedTopics: topics.length,
      attemptedTopics: attemptedTopicIds.length,
      queuedCount: queued.length,
      attachedCount: attached.length,
      queued,
      attached,
      skipped,
    };
  } finally {
    await client.end();
  }
}

async function main() {
  const summary = await runGenerateCodexThemeProposals(parseArgs());
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
    logger.error('generate-codex-theme-proposals failed', {
      error: String(error?.message || error),
    });
    process.stderr.write(`${String(error?.stack || error?.message || error)}\n`);
    process.exit(1);
  });
}
