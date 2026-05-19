import pg from 'pg';
import { loadOptionalEnvFile, resolveNasPgConfig } from './nas-runtime.mjs';
import {
  REPORT_TYPES,
  buildCrossThemeBottleneckReportBundle,
  buildEventSignalReportBundle,
  buildRegimeTransmissionReportBundle,
  buildSymbolSignalReportBundle,
  buildSystemQualityReportBundle,
  buildThemeReportBundle,
  createEvidenceBundle,
} from './report-evidence-bundle.mjs';
import { planReportFigures } from './report-chart-planner.mjs';
import {
  attachSubjectFidelity,
  buildNoBoundCandidateBundle,
  classifySubjectMatch,
  isSystemWideReportType,
  resolveSubjectKey,
} from './report-subject-fidelity.mjs';
import { applyReportDataDiagnostics } from './report-data-diagnostics.mjs';
import { loadThemeContext, themeContextToBundleAdditions } from './report-theme-context.mjs';
import { loadCrossAssetPaths, crossAssetPathsToBundleAdditions } from './report-cross-asset-paths.mjs';
import { loadThemeHistoricalAnalogues, tagAnalogueContext, historicalAnaloguesToBundleAdditions } from './report-historical-analogues.mjs';
import { attachDeepResearchPack } from './report-deep-research-pack.mjs';
import { inferFrontierNodeEvidence } from './cross-theme-discovery-quality.mjs';
import {
  buildIssuerDiscoveryMap,
  candidateIssuerUniverseFromMap,
  groupIssuerDiscoveryMap,
  issuerDiscoverySummary,
  themeHintsForIssuerDiscovery,
} from './report-issuer-discovery-map.mjs';

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function uniqueStrings(values = []) {
  return [...new Set(asArray(values).map((value) => String(value || '').trim()).filter(Boolean))];
}

function slugify(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'unknown';
}

function escapeRegex(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function humanizeKey(value) {
  return String(value || '')
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => part.length <= 3 ? part.toUpperCase() : part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ') || 'Unknown';
}

function meaningfulLabel(label, fallbackKey) {
  const cleaned = String(label || '').trim();
  if (!cleaned || /^unknown$/i.test(cleaned)) return humanizeKey(fallbackKey);
  return cleaned;
}

function num(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function iso(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function freshnessFromTimestamp(value, slaHours = 24) {
  const timestamp = iso(value);
  if (!timestamp) return 'unknown';
  const ageHours = (Date.now() - new Date(timestamp).getTime()) / 3_600_000;
  if (!Number.isFinite(ageHours)) return 'unknown';
  if (ageHours <= slaHours) return 'fresh';
  if (ageHours <= slaHours * 3) return 'degraded';
  return 'stale';
}

function sourceSummaryFromEvidence(evidence = [], fallback = {}) {
  const sources = new Set(evidence.map((item) => item.publisher || item.source).filter(Boolean));
  const fallbackDistinct = num(fallback.distinctSources ?? fallback.unique_sources, NaN);
  const distinctSources = Number.isFinite(fallbackDistinct) && fallbackDistinct > 0 ? fallbackDistinct : sources.size;
  const fallbackDiversity = num(fallback.sourceDiversityScore ?? fallback.source_diversity, NaN);
  const sourceDiversityScore = Number.isFinite(fallbackDiversity) && fallbackDiversity > 0
    ? fallbackDiversity
    : (sources.size ? Math.min(1, sources.size / Math.max(3, evidence.length)) : 0);
  const explicitLow = fallback.lowDiversityFlag ?? fallback.low_diversity_flag;
  return {
    distinctSources,
    sourceDiversityScore,
    lowDiversityFlag: explicitLow === true ? distinctSources <= 1 : distinctSources <= 1,
  };
}

const ADJACENT_REPORT_READY_STATUSES = new Set([
  'ready_for_deep_report',
  'review_ready',
  'non_obvious_bottleneck_ready',
]);

function strictAdjacentStatusReconcile(adjacent = {}) {
  const metadata = adjacent.metadata || {};
  const strictEndogenousAdjacent = metadata.discoveryNamespace === 'strict_endogenous_adjacent'
    || metadata.frontierDiscovery === true;
  if (!strictEndogenousAdjacent || !ADJACENT_REPORT_READY_STATUSES.has(adjacent.status)) return adjacent;

  const frontierNodeSupported = metadata.frontierNodeSupported === true;
  const sourceDerivedNodeCount = num(metadata.sourceDerivedNodeCount, 0);
  const scarcityEvidenceScore = num(metadata.scarcityEvidenceScore, 0);
  if (frontierNodeSupported && sourceDerivedNodeCount >= 1 && scarcityEvidenceScore >= 0.28) return adjacent;

  const consensusPenalty = num(metadata.nonObviousDiscovery?.consensusPenalty ?? metadata.consensusPenalty, 0);
  const effectiveStatus = consensusPenalty >= 0.4 ? 'consensus_suppressed' : 'needs_scarcity_evidence';
  const reconcileReason = !sourceDerivedNodeCount
    ? 'missing_source_derived_frontier_node'
    : (!frontierNodeSupported ? 'frontier_node_not_supported' : 'scarcity_evidence_below_threshold');
  return {
    ...adjacent,
    status: effectiveStatus,
    failure_reason: effectiveStatus === 'consensus_suppressed' ? 'consensus_suppressed' : 'source_coverage_gap',
    next_action: effectiveStatus === 'consensus_suppressed'
      ? 'Keep the broad consensus narrative below narrower bottleneck nodes; collect direct scarcity evidence before re-ranking.'
      : 'Collect source-derived frontier-node scarcity evidence before treating this adjacent candidate as report-ready.',
    metadata: {
      ...metadata,
      storedStatus: adjacent.status,
      effectiveStatus,
      statusReconciledBy: 'report-db-adapter-frontier-gate',
      statusReconcileReason: reconcileReason,
    },
  };
}

function reconcileAdjacentFrontierSupportFromEvidence(adjacent = {}, evidence = []) {
  const metadata = adjacent.metadata || {};
  const strictEndogenousAdjacent = metadata.discoveryNamespace === 'strict_endogenous_adjacent'
    || metadata.frontierDiscovery === true;
  if (!strictEndogenousAdjacent) return adjacent;

  const promotionEvidence = asArray(evidence).filter((row) => (
    row.metadata?.promotionEligible === true
    || row.metadata?.evidenceUse === 'promotion_candidate'
    || row.evidenceGrade === 'promotion_candidate'
  ));
  const support = inferFrontierNodeEvidence(promotionEvidence);
  if (!support.supported) return adjacent;

  const restoredStatus = ADJACENT_REPORT_READY_STATUSES.has(metadata.storedStatus)
    ? metadata.storedStatus
    : (ADJACENT_REPORT_READY_STATUSES.has(adjacent.status)
      ? adjacent.status
      : 'non_obvious_bottleneck_ready');
  const scarcityEvidenceScore = Math.max(
    num(metadata.scarcityEvidenceScore, 0),
    Math.min(1, 0.28 + support.scarcityHitCount * 0.14 + support.officialHitCount * 0.08),
  );

  return {
    ...adjacent,
    status: restoredStatus,
    failure_reason: null,
    metadata: {
      ...metadata,
      effectiveStatus: restoredStatus,
      frontierNodeSupported: true,
      sourceDerivedNodeCount: Math.max(num(metadata.sourceDerivedNodeCount, 0), support.sourceDerivedNodeCount),
      scarcityEvidenceScore,
      frontierEvidenceReconciledBy: 'report-db-adapter-provider-evidence',
      sourceDerivedNodeBasis: metadata.sourceDerivedNodeBasis || 'provider_evidence',
      inferredFrontierNodeKeys: support.nodeKeys,
      inferredFrontierOfficialHitCount: support.officialHitCount,
      inferredFrontierScarcityHitCount: support.scarcityHitCount,
    },
  };
}

function themeAccelerationContext(row = {}) {
  const counts = row.metadata?.comparisonCounts || row.metadata?.comparison_counts || {};
  const current = num(counts.current, NaN);
  const previous = num(counts.previous, NaN);
  const previousPrevious = num(counts.previousPrevious ?? counts.previous_previous, NaN);
  const yearAgo = num(counts.yearAgo ?? counts.year_ago, NaN);
  const acceleration = num(row.trend_acceleration, NaN);
  const limitations = [];
  if (Number.isFinite(acceleration) && Math.abs(acceleration) > 100) limitations.push('baseline_distortion');
  if (Number.isFinite(previous) && previous <= 1) limitations.push('sparse_previous_period');
  if (Number.isFinite(previousPrevious) && previousPrevious <= 1 && Number.isFinite(previous) && previous > 0) {
    limitations.push('sparse_previous_growth_baseline');
  }
  if (Number.isFinite(yearAgo) && yearAgo <= 1) limitations.push('sparse_year_ago_baseline');
  if (Number.isFinite(current) && current <= 5) limitations.push('sparse_current_period');
  return {
    limitations: [...new Set(limitations)],
    metadata: {
      comparisonCounts: counts,
      rawTrendAcceleration: Number.isFinite(acceleration) ? acceleration : null,
      interpretation: limitations.length
        ? 'directional_only_due_to_sparse_or_zero_baseline'
        : 'magnitude_usable',
    },
  };
}

async function one(client, sql, params = []) {
  const result = await client.query(sql, params);
  return result.rows[0] || null;
}

async function many(client, sql, params = []) {
  const result = await client.query(sql, params);
  return result.rows;
}

function articleEvidence(row, index = 0) {
  return {
    evidenceId: `EVID-ARTICLE-${row.id ?? index + 1}`,
    kind: 'news_article',
    sourceId: row.id != null ? String(row.id) : null,
    publisher: row.source || row.publisher_group || 'article-source',
    title: row.title || 'Untitled article',
    publishedAt: iso(row.published_at),
    ingestedAt: iso(row.published_at),
    url: row.url || null,
    sourceQualityScore: row.source_quality_score ?? null,
    sourceDiversityGroup: row.publisher_group || row.wire_source || row.source || null,
    evidenceGrade: row.evidence_grade || 'article',
    freshnessStatus: freshnessFromTimestamp(row.published_at, 72),
    atomicFacts: row.summary ? [{ factId: `FACT-ARTICLE-${row.id ?? index + 1}`, text: row.summary }] : [],
    metadata: {
      marketRelevance: row.market_relevance || null,
      theme: row.theme || null,
    },
  };
}

function calculatedEvidence({ id, title, publisher = 'Lattice DB', grade = 'calculated', metadata = {} }) {
  return {
    evidenceId: id,
    kind: 'calculated',
    publisher,
    title,
    freshnessStatus: 'fresh',
    evidenceGrade: grade,
    sourceQualityScore: 0.75,
    metadata,
  };
}

async function buildAdjacentThemeCrossThemeBundle(client, input = {}, requestedSubject = '') {
  const subject = String(requestedSubject || resolveSubjectString(input) || '').trim();
  if (!subject) return null;
  const adjacent = await one(client, `
    SELECT *
      FROM adjacent_theme_candidates
     WHERE candidate_key = $1
        OR lower(label) = lower($1)
     ORDER BY updated_at DESC, confidence_score DESC
     LIMIT 1
  `, [subject]).catch(() => null);
  if (!adjacent) return null;
  let reportAdjacent = strictAdjacentStatusReconcile(adjacent);
  const parentSubject = reportAdjacent.parent_subject || reportAdjacent.parent_subject_key || '';
  const adjacentDisplayLabel = parentSubject
    ? String(reportAdjacent.label || '').replace(new RegExp(`\\s*:\\s*${escapeRegex(parentSubject)}\\s*$`, 'i'), '').trim()
    : String(reportAdjacent.label || '').trim();
  const displayLabel = adjacentDisplayLabel || reportAdjacent.label || reportAdjacent.candidate_key;
  const strictEndogenousAdjacent = reportAdjacent.metadata?.discoveryNamespace === 'strict_endogenous_adjacent'
    || reportAdjacent.metadata?.frontierDiscovery === true;
  const adjacentIssuerUniverse = strictEndogenousAdjacent
    ? []
    : asArray(reportAdjacent.metadata?.issuerUniverseSourceSymbols || reportAdjacent.metadata?.issuerUniverse || []);

  const evidenceRows = await many(client, `
    SELECT *
      FROM research_evidence_bundles
     WHERE metadata->>'adjacentCandidateKey' = $1
        OR metadata->>'candidateId' = $1
        OR metadata->>'adjacentCandidateKey' = $2
        OR metadata->>'candidateId' = $2
        OR metadata->>'reportId' ILIKE $3
        OR metadata->>'latestReportId' ILIKE $3
     ORDER BY CASE metadata->>'evidenceUse'
                WHEN 'promotion_candidate' THEN 0
                WHEN 'supporting_context' THEN 1
                WHEN 'negative_control_candidate' THEN 2
                WHEN 'weak_noise' THEN 3
                ELSE 4
              END,
              relevance_score DESC NULLS LAST,
              created_at DESC NULLS LAST
     LIMIT 24
  `, [
    reportAdjacent.candidate_key,
    reportAdjacent.metadata?.adjacentCandidateKey || reportAdjacent.metadata?.candidateKey || '',
    `%${reportAdjacent.candidate_key}%`,
  ]).catch(() => []);

  const evidence = evidenceRows.map((row, index) => ({
    evidenceId: `EVID-ADJACENT-${row.id || index + 1}`,
    kind: row.source_type || 'adjacent_candidate_evidence',
    sourceId: row.source_id || String(row.id || index + 1),
    publisher: row.metadata?.sourceProvider || row.metadata?.provider || row.metadata?.source || row.source_type || 'adjacent-candidate-evidence',
    title: row.title || 'Adjacent candidate evidence',
    url: row.url || null,
    publishedAt: iso(row.published_at),
    ingestedAt: iso(row.created_at),
    evidenceGrade: row.metadata?.evidenceUse || 'supporting_context',
    excerpt: row.text_excerpt || null,
    textExcerpt: row.text_excerpt || null,
    factText: row.text_excerpt || null,
    symbol: row.metadata?.issuerSymbol || row.metadata?.symbol || null,
    ticker: row.metadata?.issuerSymbol || row.metadata?.symbol || null,
    freshnessStatus: freshnessFromTimestamp(row.created_at, 168),
    sourceQualityScore: row.relevance_score ?? 0.55,
    atomicFacts: row.text_excerpt ? [{ factId: `FACT-ADJACENT-${row.id || index + 1}`, text: row.text_excerpt }] : [],
    metadata: {
      ...(row.metadata || {}),
      adjacentCandidateKey: reportAdjacent.candidate_key,
      adjacentLane: reportAdjacent.lane,
      evidenceUse: row.metadata?.evidenceUse || null,
      desiredEvidenceClass: row.metadata?.desiredEvidenceClass || null,
      providerRoutePlan: row.metadata?.providerRoutePlan || null,
      closureReason: row.metadata?.closureReason || null,
      promotionEligible: row.metadata?.promotionEligible ?? (row.metadata?.evidenceUse === 'promotion_candidate'),
    },
  }));

  reportAdjacent = reconcileAdjacentFrontierSupportFromEvidence(reportAdjacent, evidence);

  if (!evidence.length) {
    evidence.push(calculatedEvidence({
      id: `EVID-ADJACENT-${adjacent.id}`,
      title: reportAdjacent.next_action || `${displayLabel} adjacent candidate`,
      publisher: 'adjacent_theme_candidates',
      grade: reportAdjacent.status || 'candidate',
      metadata: {
        adjacentCandidateKey: reportAdjacent.candidate_key,
        adjacentLane: reportAdjacent.lane,
        failureReason: reportAdjacent.failure_reason,
      },
    }));
  }

  const closure = reportAdjacent.metadata?.sourceQueryClosure || {};
  const adjacentThemes = asArray(reportAdjacent.metadata?.themes).filter(Boolean);
  const themes = adjacentThemes.length
    ? adjacentThemes
    : uniqueStrings([
      reportAdjacent.parent_subject || reportAdjacent.parent_subject_key,
    ].filter(Boolean));
  const xtcBundle = planReportFigures(buildCrossThemeBottleneckReportBundle({
    candidate: {
      id: reportAdjacent.candidate_key,
      name: displayLabel,
      supplier: displayLabel,
      connector: parentSubject || displayLabel,
      themes,
      symbols: adjacentIssuerUniverse,
      score: num(reportAdjacent.confidence_score, 0) / 100,
      evidenceScore: Math.min(1, (num(closure.contextCount, 0) + num(closure.executedCount, 0)) / 5),
      seedSimilarity: 0,
      lane: reportAdjacent.lane,
      discovery: {
        ontologyKey: reportAdjacent.metadata?.ontologyKey || null,
        connector: reportAdjacent.parent_subject || null,
        mechanism: reportAdjacent.next_action || null,
        triggerTerms: [...asArray(reportAdjacent.seed_terms), ...asArray(reportAdjacent.source_terms)].slice(0, 24),
        adjacentCandidateKey: reportAdjacent.candidate_key,
        adjacentLane: reportAdjacent.lane,
        generatedLane: Boolean(reportAdjacent.metadata?.generatedLane),
        frontierDiscovery: Boolean(reportAdjacent.metadata?.frontierDiscovery),
        nonObviousDiscovery: reportAdjacent.metadata?.nonObviousDiscovery || null,
        concreteBottleneckNodes: asArray(reportAdjacent.metadata?.concreteBottleneckNodes).slice(0, 8),
        concreteBottleneckNodeSummary: reportAdjacent.metadata?.concreteBottleneckNodeSummary || null,
        discoveryNamespace: reportAdjacent.metadata?.discoveryNamespace || 'static_adjacent_playbook',
        evidenceQuotes: asArray(reportAdjacent.metadata?.evidenceQuotes).slice(0, 8),
      },
      discoveryFit: num(reportAdjacent.confidence_score, 0) / 100,
      constraintCriticality: Math.min(1, num(reportAdjacent.confidence_score, 0) / 100),
      geopoliticalRelevance: themes.includes('defense-industrial') ? 0.7 : 0.45,
    },
    evidence,
    sourceSummary: sourceSummaryFromEvidence(evidence),
    dataFreshness: [{
      dataset: 'adjacent_theme_candidates',
      freshnessStatus: freshnessFromTimestamp(adjacent.updated_at, 48),
      lastUpdatedAt: iso(adjacent.updated_at),
      slaHours: 48,
    }],
    metadata: {
      dbBacked: true,
      adjacentCandidate: reportAdjacent,
      adjacentCandidateKey: reportAdjacent.candidate_key,
      adjacentLane: reportAdjacent.lane,
      issuerUniverse: adjacentIssuerUniverse,
      generatedLane: Boolean(reportAdjacent.metadata?.generatedLane),
      frontierDiscovery: Boolean(reportAdjacent.metadata?.frontierDiscovery),
      frontierNodeSupported: Boolean(reportAdjacent.metadata?.frontierNodeSupported),
      sourceDerivedNodeCount: num(reportAdjacent.metadata?.sourceDerivedNodeCount, 0),
      scarcityEvidenceScore: num(reportAdjacent.metadata?.scarcityEvidenceScore, 0),
      nonObviousDiscovery: reportAdjacent.metadata?.nonObviousDiscovery || null,
      concreteBottleneckNodes: asArray(reportAdjacent.metadata?.concreteBottleneckNodes).slice(0, 8),
      concreteBottleneckNodeSummary: reportAdjacent.metadata?.concreteBottleneckNodeSummary || null,
      discoveryNamespace: reportAdjacent.metadata?.discoveryNamespace || 'static_adjacent_playbook',
      seedLeakageScore: num(reportAdjacent.metadata?.seedLeakageScore, 0),
      sourceDiversity: num(reportAdjacent.metadata?.sourceDiversity, 0),
      relationSupport: num(reportAdjacent.metadata?.relationSupport, 0),
      sourceQueryClosure: closure,
    },
  }));
  xtcBundle.issuerUniverse = adjacentIssuerUniverse;
  xtcBundle.metadata = {
    ...(xtcBundle.metadata || {}),
    issuerUniverse: adjacentIssuerUniverse,
    candidateIssuerUniverse: adjacentIssuerUniverse,
  };
  const issuerThemeHints = themeHintsForIssuerDiscovery({ bundle: xtcBundle });
  const autoThemeSymbolRows = !strictEndogenousAdjacent && issuerThemeHints.length
    ? await many(client, `
      SELECT theme, symbol, avg_abs_reaction, reaction_count, correlation, method
        FROM auto_theme_symbols
       WHERE theme = ANY($1::text[])
       ORDER BY reaction_count DESC NULLS LAST, avg_abs_reaction DESC NULLS LAST, correlation DESC NULLS LAST
       LIMIT 24
    `, [issuerThemeHints]).catch(() => [])
    : [];
  const issuerDiscoveryMap = buildIssuerDiscoveryMap({
    bundle: xtcBundle,
    rows: {
      research: evidenceRows,
      autoThemeSymbols: autoThemeSymbolRows.map((row) => ({
        ...row,
        source_type: 'auto_theme_symbols',
        metadata: {
          theme: row.theme,
          method: row.method,
        },
      })),
    },
    candidateIssuerUniverse: adjacentIssuerUniverse,
    strictEndogenous: strictEndogenousAdjacent,
    suppressedConsensusSymbols: reportAdjacent.metadata?.suppressedConsensusSymbols,
  });
  const candidateIssuerUniverse = candidateIssuerUniverseFromMap(issuerDiscoveryMap);
  xtcBundle.metadata = {
    ...(xtcBundle.metadata || {}),
    issuerDiscoveryVersion: 'issuer-discovery-map-v1',
    issuerDiscoveryMap,
    autoIssuerGroups: groupIssuerDiscoveryMap(issuerDiscoveryMap),
    issuerBridgeSummary: issuerDiscoverySummary(issuerDiscoveryMap),
    candidateIssuerUniverse,
    candidateSources: {
      adjacentIssuerUniverse,
      autoThemeSymbolCount: autoThemeSymbolRows.length,
      themeHints: issuerThemeHints,
    },
  };
  attachSubjectFidelity(xtcBundle, {
    requestedSubject: subject,
    matchStatus: 'subject-bound',
    resolvedSubjectKey: reportAdjacent.candidate_key,
    fallbackReason: null,
  });
  applyReportDataDiagnostics(xtcBundle);
  return xtcBundle;
}

export function createReportDbClient(overrides = {}) {
  loadOptionalEnvFile();
  return new pg.Client(resolveNasPgConfig(overrides));
}

export async function withReportDbClient(callback, options = {}) {
  const client = options.client || createReportDbClient(options.pg || {});
  const shouldClose = !options.client;
  if (shouldClose) await client.connect();
  try {
    return await callback(client);
  } finally {
    if (shouldClose) await client.end().catch(() => {});
  }
}

function resolveSubjectString(input = {}) {
  if (typeof input.subject === 'string') return input.subject;
  return input.subject?.displayName || input.subject?.subjectId || input.theme || input.symbol || input.eventId || input.candidateId || '';
}

function resolvePeriod(input = {}) {
  const period = String(input.period || input.periodType || 'week').toLowerCase();
  const map = { weekly: 'week', monthly: 'month', quarterly: 'quarter', yearly: 'year' };
  return map[period] || period;
}

async function recentThemeArticles(client, theme, limit = 6) {
  return many(client, `
    WITH ranked AS (
      SELECT id, source, theme, published_at, title, summary, url, wire_source, publisher_group, market_relevance,
             ROW_NUMBER() OVER (
               PARTITION BY COALESCE(NULLIF(source, ''), NULLIF(publisher_group, ''), 'unknown')
               ORDER BY published_at DESC NULLS LAST, id DESC
             ) AS source_rank
      FROM articles
      WHERE theme = $1
    )
    SELECT id, source, theme, published_at, title, summary, url, wire_source, publisher_group, market_relevance
    FROM ranked
    WHERE source_rank = 1
    ORDER BY published_at DESC NULLS LAST, id DESC
    LIMIT $2
  `, [theme, limit]);
}

async function repairEmptyThemeAggregate(client, row, periodType, evidenceCount) {
  if (!row || num(row.article_count) > 0 || Number(evidenceCount || 0) <= 0) {
    return { row, repaired: false, repair: null };
  }
  const repaired = await one(client, `
    SELECT *
    FROM theme_trend_aggregates
    WHERE period_type = $1
      AND theme = $2
      AND article_count > 0
      AND period_end >= (CURRENT_DATE - INTERVAL '45 days')::date
    ORDER BY period_end DESC NULLS LAST, computed_at DESC NULLS LAST
    LIMIT 1
  `, [periodType, row.theme]).catch(() => null);
  if (!repaired) return { row, repaired: false, repair: null };
  return {
    row: repaired,
    repaired: true,
    repair: {
      reason: 'latest aggregate row had zero articles while fresh evidence exists; selected the latest non-empty completed aggregate window',
      originalPeriodStart: row.period_start,
      originalPeriodEnd: row.period_end,
      originalComputedAt: row.computed_at,
      originalArticleCount: row.article_count,
      repairedPeriodStart: repaired.period_start,
      repairedPeriodEnd: repaired.period_end,
      repairedComputedAt: repaired.computed_at,
      repairedArticleCount: repaired.article_count,
    },
  };
}

export async function buildDbThemeReportBundle(client, input = {}) {
  const subject = resolveSubjectString(input);
  const requestedSubject = subject || input.theme || '';
  const allowFallback = input.allowFallback === true;
  const themeKey = slugify(subject || input.theme || '');
  const periodType = resolvePeriod(input);
  /* P1: strict subject match by theme key. Falls back to top-by-article-count
   * only when allowFallback=true (legacy behavior). Otherwise returns a
   * no-bound-candidate bundle so the report explicitly says "no theme aggregate
   * for X" rather than silently picking a different theme. */
  let row = themeKey ? await one(client, `
    SELECT *
    FROM theme_trend_aggregates
    WHERE period_type = $1
      AND (theme = $2 OR lower(theme_label) = lower($3))
    ORDER BY period_end DESC NULLS LAST, computed_at DESC NULLS LAST
    LIMIT 1
  `, [periodType, themeKey, requestedSubject || themeKey]) : null;
  let matchStatus = row ? 'subject-bound' : null;
  let fallbackReason = null;
  if (!row) {
    if (!allowFallback) {
      const noData = buildNoBoundCandidateBundle({
        reportType: REPORT_TYPES.THEME,
        requestedSubject: requestedSubject || themeKey || 'unknown',
        reason: `No theme_trend_aggregates row for theme=${themeKey || '(empty)'} in period=${periodType}. Allow fallback to top-by-article-count theme by passing --allowFallback.`,
      });
      return planReportFigures(applyReportDataDiagnostics(noData));
    }
    row = await one(client, `
      SELECT *
      FROM theme_trend_aggregates
      WHERE period_type = $1
      ORDER BY article_count DESC NULLS LAST, period_end DESC NULLS LAST, computed_at DESC NULLS LAST
      LIMIT 1
    `, [periodType]);
    matchStatus = 'fallback-used';
    fallbackReason = `theme=${themeKey} had no aggregate row; using top-by-article-count theme=${row?.theme || 'unknown'} as fallback.`;
  }
  if (!row) throw new Error('theme_trend_aggregates returned no rows');
  if (matchStatus === 'subject-bound') {
    matchStatus = classifySubjectMatch({ requested: requestedSubject || themeKey, actual: row.theme });
  }
  const articles = await recentThemeArticles(client, row.theme, Number(input.evidenceLimit || 6));
  const aggregateRepair = await repairEmptyThemeAggregate(client, row, periodType, articles.length);
  row = aggregateRepair.row;
  /* P2: load enriched theme context — subtopics, peer symbols, multi-regime
   * impacts, knowledge graph paths, event timeline. The bundle keeps its
   * existing shape; the enrichment is appended via metrics/marketReactions/
   * evidence arrays plus a metadata.themeContext snapshot. */
  const themeCtx = await loadThemeContext(client, row.theme, { periodType });
  const themeAdditions = themeContextToBundleAdditions(themeCtx, row.theme);
  /* P5: cross-asset paths (2-hop graph traversal) + historical analogues
   * (cosine similarity on Hawkes intensity profile). Both gracefully no-op
   * when the underlying graph or history is sparse. */
  const crossAsset = await loadCrossAssetPaths(client, row.theme);
  const crossAssetAdditions = crossAssetPathsToBundleAdditions(crossAsset);
  const analogueResult = await loadThemeHistoricalAnalogues(client, row.theme);
  if (analogueResult.available) {
    analogueResult.analogues = await tagAnalogueContext(client, row.theme, analogueResult.analogues);
  }
  const analogueAdditions = historicalAnaloguesToBundleAdditions(analogueResult);

  const evidence = articles.map(articleEvidence);
  const marketRows = await many(client, `
    SELECT *
    FROM regime_conditional_impact
    WHERE theme = $1
    ORDER BY sample_size DESC NULLS LAST, ABS(regime_multiplier) DESC NULLS LAST, ABS(avg_return) DESC NULLS LAST
    LIMIT 5
  `, [row.theme]).catch(() => []);
  const aggregateEvidenceMismatch = num(row.article_count) <= 0 && evidence.length > 0;
  const accelerationContext = themeAccelerationContext(row);
  const sourceSummary = sourceSummaryFromEvidence(evidence, {
    distinctSources: row.unique_sources,
    sourceDiversityScore: row.source_diversity,
    lowDiversityFlag: num(row.unique_sources) <= 1,
  });
  const bundle = planReportFigures(buildThemeReportBundle({
    subject: {
      subjectType: 'theme',
      subjectId: row.theme,
      displayName: meaningfulLabel(row.theme_label, row.theme),
    },
    theme: {
      key: row.theme,
      label: meaningfulLabel(row.theme_label, row.theme),
      yoy: num(row.vs_year_ago_pct),
      acceleration: num(row.trend_acceleration),
      accelerationLimitations: accelerationContext.limitations,
      accelerationMetadata: accelerationContext.metadata,
      sourceDiversity: sourceSummary.sourceDiversityScore,
    },
    period: row.period_type,
    metrics: [
      { metricId: 'MET-THEME-RECENT-EVIDENCE', kind: 'evidence_volume', name: 'recent_evidence_items', value: evidence.length, unit: 'articles', window: 'recent', asOf: iso(articles[0]?.published_at || row.computed_at) },
      { metricId: 'MET-THEME-ARTICLES', kind: 'theme_trend', name: 'article_count', value: num(row.article_count), unit: 'articles', window: row.period_type, asOf: iso(row.computed_at) },
      { metricId: 'MET-THEME-SHARE', kind: 'theme_trend', name: 'theme_share_pct', value: num(row.theme_share_pct), unit: 'percent', window: row.period_type, asOf: iso(row.computed_at) },
      { metricId: 'MET-THEME-NOVELTY', kind: 'theme_trend', name: 'novelty_score', value: num(row.novelty_score), unit: 'score', window: row.period_type, asOf: iso(row.computed_at) },
      ...themeAdditions.metrics,
      ...crossAssetAdditions.metrics,
      ...analogueAdditions.metrics,
    ],
    caveats: aggregateEvidenceMismatch ? [{
      caveatId: 'CAV-THEME-AGGREGATE-EVIDENCE-MISMATCH',
      severity: 'medium',
      type: 'aggregate_evidence_mismatch',
      text: 'The selected trend aggregate reports no current-period articles while the recent evidence ledger contains articles; distinguish period metrics from latest evidence.',
      appliesToClaimIds: ['CLM-001'],
    }] : [],
    evidence: [...evidence, ...themeAdditions.evidence],
    marketReactions: [
      ...marketRows.map((marketRow, index) => ({
        reactionId: `MRKT-THEME-${row.theme}-${index + 1}`,
        symbol: marketRow.symbol,
        benchmark: marketRow.regime || 'regime_baseline',
        eventWindow: marketRow.horizon,
        relativeReturnPct: num(marketRow.avg_return),
        uplift: num(marketRow.regime_multiplier),
        tStat: num(marketRow.hit_rate),
        alpha: num(marketRow.avg_return),
        controls: [`sample_size=${num(marketRow.sample_size)}`],
        validationStatus: num(marketRow.sample_size) >= 30 ? 'validated' : 'candidate',
        metadata: marketRow,
      })),
      ...themeAdditions.marketReactions,
    ],
    sourceSummary,
    watchIndicators: [{
      watchId: 'WATCH-DB-THEME-CONFIRMATION',
      label: 'Recheck fresh article coverage, source diversity, and trend acceleration at the next theme refresh.',
      threshold: 'fresh_articles && source_diversity_stable && acceleration_confirmed',
      direction: 'equals',
      source: 'theme_trend_aggregates',
      horizon: 'next refresh',
      claimIds: ['CLM-001'],
    }],
    dataFreshness: [{ dataset: 'theme_trend_aggregates', freshnessStatus: freshnessFromTimestamp(row.computed_at, 24), lastUpdatedAt: iso(row.computed_at), slaHours: 24 }],
    metadata: {
      dbBacked: true,
      row,
      aggregateRepair,
      ...(themeAdditions.extension || {}),
      ...(crossAssetAdditions.extension || {}),
      ...(analogueAdditions.extension || {}),
    },
  }));
  attachSubjectFidelity(bundle, {
    requestedSubject: requestedSubject || themeKey,
    matchStatus,
    resolvedSubjectKey: row.theme,
    fallbackReason,
  });
  applyReportDataDiagnostics(bundle);
  return bundle;
}

async function loadEventRow(client, input = {}, { allowFallback = false } = {}) {
  if (input.eventId) {
    return one(client, 'SELECT * FROM canonical_events WHERE id = $1 LIMIT 1', [input.eventId]);
  }
  /* P1: derive theme from subject if input.theme not explicitly set. Strict
   * filter — when no rows match the bound theme and !allowFallback, return
   * null so the caller emits a no-bound-candidate bundle. */
  const resolved = resolveSubjectKey(input.subject || input);
  const theme = input.theme ? slugify(input.theme) : (resolved.kind === 'theme' ? resolved.key : null);
  if (theme) {
    const bound = await one(client, `
      SELECT ce.*, MAX(ABS(eu.t_stat)) AS max_t_stat, MAX(ABS(eu.uplift)) AS max_uplift
      FROM canonical_events ce
      JOIN event_uplift eu ON eu.canonical_event_id = ce.id
      WHERE eu.evidence_grade IN ('E2','E3','E4')
        AND ce.theme = $1
      GROUP BY ce.id
      ORDER BY (COALESCE(MAX(ABS(eu.t_stat)),0) * 0.4 + COALESCE(MAX(ABS(eu.uplift)),0) * 0.6) DESC,
               ce.event_date DESC
      LIMIT 1
    `, [theme]);
    if (bound) return bound;
    if (!allowFallback) return null;
  }
  return one(client, `
    SELECT ce.*, MAX(ABS(eu.t_stat)) AS max_t_stat, MAX(ABS(eu.uplift)) AS max_uplift
    FROM canonical_events ce
    JOIN event_uplift eu ON eu.canonical_event_id = ce.id
    WHERE eu.evidence_grade IN ('E2','E3','E4')
    GROUP BY ce.id
    ORDER BY (COALESCE(MAX(ABS(eu.t_stat)),0) * 0.4 + COALESCE(MAX(ABS(eu.uplift)),0) * 0.6) DESC,
             ce.event_date DESC
    LIMIT 1
  `);
}

export async function buildDbEventSignalReportBundle(client, input = {}) {
  const allowFallback = input.allowFallback === true;
  const requestedSubject = resolveSubjectString(input);
  const resolved = resolveSubjectKey(input.subject || input);
  const event = await loadEventRow(client, input, { allowFallback });
  if (!event) {
    if (resolved.kind === 'theme' || requestedSubject) {
      const noData = buildNoBoundCandidateBundle({
        reportType: REPORT_TYPES.EVENT_SIGNAL,
        requestedSubject: requestedSubject || resolved.raw,
        reason: `No canonical_events with E2/E3/E4 evidence grade for theme=${resolved.key}. Allow fallback to top-by-uplift event by passing --allowFallback.`,
      });
      return planReportFigures(applyReportDataDiagnostics(noData));
    }
    throw new Error('No validated event signal found in DB');
  }
  const articles = await many(client, `
    SELECT a.id, a.source, a.theme, a.published_at, a.title, a.summary, a.url, a.wire_source, a.publisher_group, a.market_relevance
    FROM article_event_map aem
    JOIN articles a ON a.id = aem.article_id
    WHERE aem.canonical_event_id = $1
    ORDER BY a.published_at DESC NULLS LAST
    LIMIT $2
  `, [event.id, Number(input.evidenceLimit || 8)]);
  const upliftRows = await many(client, `
    SELECT *
    FROM event_uplift
    WHERE canonical_event_id = $1
    ORDER BY CASE WHEN evidence_grade IN ('E2','E3','E4') THEN 0 ELSE 1 END,
             ABS(t_stat) DESC NULLS LAST,
             ABS(uplift) DESC NULLS LAST
    LIMIT 8
  `, [event.id]);
  const hawkes = await one(client, `
    SELECT *
    FROM event_hawkes_intensity
    WHERE theme = $1 AND event_date = $2
    ORDER BY updated_at DESC NULLS LAST
    LIMIT 1
  `, [event.theme, event.event_date]);
  const evidence = articles.map(articleEvidence);
  if (!evidence.length) {
    evidence.push(calculatedEvidence({
      id: `EVID-EVENT-${event.id}`,
      title: event.representative_title,
      metadata: { canonicalEventId: event.id },
    }));
  }
  const bundle = planReportFigures(buildEventSignalReportBundle({
    event: {
      id: event.id,
      title: event.representative_title,
      temperature: num(hawkes?.normalized_temperature, num(hawkes?.hawkes_intensity)),
      articleCount: num(event.article_count),
      sourceCount: num(event.source_count),
      window: 'event',
    },
    subject: {
      subjectType: 'event_cluster',
      subjectId: String(event.id),
      displayName: event.representative_title,
      metadata: { theme: event.theme, eventDate: iso(event.event_date) },
    },
    evidence,
    marketReactions: upliftRows.map((row, index) => ({
      reactionId: `MRKT-EVENT-${event.id}-${row.symbol || index}`,
      symbol: row.symbol,
      benchmark: 'matched_controls',
      eventWindow: row.horizon,
      relativeReturnPct: num(row.event_alpha),
      uplift: num(row.uplift),
      tStat: num(row.t_stat),
      alpha: num(row.event_alpha),
      controls: [`n_controls=${num(row.n_controls)}`],
      validationStatus: ['E2', 'E3', 'E4'].includes(row.evidence_grade) ? 'validated' : 'candidate',
      metadata: { evidenceGrade: row.evidence_grade },
    })),
    sourceSummary: sourceSummaryFromEvidence(evidence, {
      distinctSources: event.source_count,
      sourceDiversityScore: event.source_diversity,
      lowDiversityFlag: num(event.source_count) <= 1,
    }),
    dataFreshness: [
      { dataset: 'canonical_events', freshnessStatus: freshnessFromTimestamp(event.created_at, 168), lastUpdatedAt: iso(event.created_at), slaHours: 168 },
      { dataset: 'event_uplift', freshnessStatus: upliftRows.length ? 'fresh' : 'stale', lastUpdatedAt: iso(event.event_date), slaHours: 168 },
    ],
    metadata: { dbBacked: true, event, hawkes },
  }));
  /* P1 fidelity: tag whether event.theme matches requested subject. */
  const eventMatchStatus = resolved.kind === 'theme'
    ? classifySubjectMatch({ requested: resolved.key, actual: event.theme })
    : (allowFallback ? 'fallback-used' : 'system-wide');
  attachSubjectFidelity(bundle, {
    requestedSubject: requestedSubject || resolved.raw,
    matchStatus: eventMatchStatus,
    resolvedSubjectKey: event.theme,
    fallbackReason: eventMatchStatus === 'fallback-used'
      ? `Requested subject "${resolved.raw}" had no E2+ event; using top-by-uplift event ${event.id} (theme=${event.theme}) as fallback.`
      : null,
  });
  applyReportDataDiagnostics(bundle);
  return bundle;
}

export async function buildDbCrossThemeBottleneckReportBundle(client, input = {}) {
  const subject = resolveSubjectString(input);
  const allowFallback = input.allowFallback === true;
  const resolvedSubject = resolveSubjectKey(input.subject || input);
  /* P1: include theme-array containment so a theme-key subject ('cloud-infrastructure')
   * matches candidates whose themes[] array contains it. The previous query only
   * matched on candidate id, deterministic_id, or node names. */
  const themeKey = resolvedSubject.kind === 'theme' ? resolvedSubject.key : null;
  let candidate = await one(client, `
    SELECT c.*, cn.canonical_name AS connector_name, cn.node_type AS connector_type,
           sn.canonical_name AS supplier_name, sn.node_type AS supplier_type
    FROM cross_theme_candidates c
    LEFT JOIN knowledge_nodes cn ON cn.id = c.connector_node_id
    LEFT JOIN knowledge_nodes sn ON sn.id = c.supplier_node_id
    WHERE ($1::text IS NOT NULL AND (
      c.id::text = $1 OR c.deterministic_id = $1
      OR lower(cn.canonical_name) = lower($1)
      OR lower(sn.canonical_name) = lower($1)
      OR ($2::text IS NOT NULL AND $2::text = ANY(c.themes))
    ))
    ORDER BY CASE WHEN c.status IN ('new','watch','accepted') THEN 0 ELSE 1 END,
             c.score DESC NULLS LAST,
             c.updated_at DESC NULLS LAST
    LIMIT 1
  `, [subject || null, themeKey]).catch(() => null);
  let xtcMatchStatus = candidate ? 'subject-bound' : null;
  let xtcFallbackReason = null;
  if (!candidate) {
    const adjacentBundle = await buildAdjacentThemeCrossThemeBundle(client, input, subject || resolvedSubject.raw);
    if (adjacentBundle) return adjacentBundle;
    if (!allowFallback) {
      const noData = buildNoBoundCandidateBundle({
        reportType: REPORT_TYPES.CROSS_THEME,
        requestedSubject: subject || resolvedSubject.raw,
        reason: `No cross_theme_candidates row matches requested subject "${subject}". Allow fallback to top-scored candidate by passing --allowFallback.`,
      });
      return planReportFigures(applyReportDataDiagnostics(noData));
    }
    candidate = await one(client, `
      SELECT c.*, cn.canonical_name AS connector_name, cn.node_type AS connector_type,
             sn.canonical_name AS supplier_name, sn.node_type AS supplier_type
      FROM cross_theme_candidates c
      LEFT JOIN knowledge_nodes cn ON cn.id = c.connector_node_id
      LEFT JOIN knowledge_nodes sn ON sn.id = c.supplier_node_id
      ORDER BY CASE WHEN c.status IN ('new','watch','accepted') THEN 0 ELSE 1 END,
               c.score DESC NULLS LAST,
               c.updated_at DESC NULLS LAST
      LIMIT 1
    `);
    xtcMatchStatus = 'fallback-used';
    xtcFallbackReason = `No cross-theme candidate matched "${subject}"; using top-scored candidate as fallback.`;
  }
  if (!candidate) throw new Error('No cross_theme_candidates row found');
  const nodeIds = [candidate.connector_node_id, candidate.supplier_node_id].filter(Boolean);
  const edgeEvidence = nodeIds.length ? await many(client, `
    SELECT kee.*, ke.relation_type, ke.confidence, ke.evidence_count, ke.source_diversity
    FROM knowledge_edges ke
    JOIN knowledge_edge_evidence kee ON kee.edge_id = ke.id
    WHERE ke.source_node_id = ANY($1::bigint[]) OR ke.target_node_id = ANY($1::bigint[])
    ORDER BY kee.created_at DESC NULLS LAST
    LIMIT 8
  `, [nodeIds]) : [];
  const evidence = edgeEvidence.map((row, index) => ({
    evidenceId: `EVID-KNOWLEDGE-${row.id || index + 1}`,
    kind: row.source_type || 'knowledge_edge',
    sourceId: row.source_id || String(row.edge_id),
    publisher: row.source_type || 'knowledge_edge_evidence',
    title: row.quote || `${row.relation_type || 'relationship'} evidence`,
    url: row.url || null,
    publishedAt: iso(row.created_at),
    ingestedAt: iso(row.created_at),
    evidenceGrade: row.evidence_strength || 'candidate',
    freshnessStatus: freshnessFromTimestamp(row.created_at, 168),
    sourceQualityScore: num(row.confidence, 0.5),
    metadata: {
      edgeId: row.edge_id,
      relationType: row.relation_type,
      evidenceCount: row.evidence_count,
      sourceDiversity: row.source_diversity,
    },
  }));
  if (!evidence.length) {
    evidence.push(calculatedEvidence({
      id: `EVID-XTC-${candidate.id}`,
      title: candidate.reason || 'Cross-theme candidate graph overlap',
      metadata: candidate.evidence_summary || {},
    }));
  }
  const summary = candidate.evidence_summary || {};
  const discovery = summary.discovery || candidate.metadata?.discovery || {};
  const name = candidate.supplier_name || candidate.connector_name || subject || 'Cross-theme connector';
  const xtcBundle = planReportFigures(buildCrossThemeBottleneckReportBundle({
    candidate: {
      id: String(candidate.id),
      name,
      supplier: candidate.supplier_name,
      connector: candidate.connector_name,
      themes: candidate.themes || [],
      score: num(candidate.score),
      evidenceScore: num(summary.evidenceQuality ?? summary.evidence_score ?? summary.evidence),
      seedSimilarity: num(summary.seedSimilarity),
      lane: candidate.lane,
      discovery,
      discoveryFit: num(summary.discoveryFit ?? discovery.discoveryFit),
      constraintCriticality: num(summary.constraintCriticality ?? discovery.constraintScore),
      geopoliticalRelevance: num(summary.geopoliticalRelevance ?? discovery.geopoliticalRelevance),
    },
    evidence,
    sourceSummary: sourceSummaryFromEvidence(evidence, {
      distinctSources: summary.sourceDiversityRaw ?? summary.sourceDiversity,
      sourceDiversityScore: summary.sourceDiversity,
      lowDiversityFlag: num(summary.sourceDiversityRaw ?? summary.sourceDiversity) <= 1,
    }),
    dataFreshness: [{ dataset: 'cross_theme_candidates', freshnessStatus: freshnessFromTimestamp(candidate.updated_at, 48), lastUpdatedAt: iso(candidate.updated_at), slaHours: 48 }],
    metadata: { dbBacked: true, candidate, discovery },
  }));
  attachSubjectFidelity(xtcBundle, {
    requestedSubject: subject || resolvedSubject.raw,
    matchStatus: xtcMatchStatus,
    resolvedSubjectKey: candidate.themes?.join(',') || candidate.id,
    fallbackReason: xtcFallbackReason,
  });
  applyReportDataDiagnostics(xtcBundle);
  return xtcBundle;
}

export async function buildDbRegimeTransmissionReportBundle(client, input = {}) {
  const latestQuotes = await many(client, `
    SELECT DISTINCT ON (symbol) symbol, observed_at, fetched_at, last_price, change_pct, provider
    FROM market_quotes
    WHERE symbol = ANY($1::text[])
    ORDER BY symbol, observed_at DESC NULLS LAST, fetched_at DESC NULLS LAST
  `, [['^VIX', 'VIX', 'CL=F', 'DX-Y.NYB', 'UUP', 'TLT']]);
  const impacts = await many(client, `
    SELECT *
    FROM regime_conditional_impact
    ORDER BY updated_at DESC NULLS LAST, sample_size DESC NULLS LAST, ABS(regime_multiplier) DESC NULLS LAST
    LIMIT 12
  `);
  const quoteMap = new Map(latestQuotes.map((row) => [row.symbol, row]));
  const vix = quoteMap.get('^VIX') || quoteMap.get('VIX');
  const oil = quoteMap.get('CL=F');
  const regime = impacts[0]?.regime || input.regime || 'unknown';
  const evidence = [
    calculatedEvidence({ id: 'EVID-REGIME-IMPACTS', title: `${impacts.length} regime-conditional impact rows loaded from DB`, metadata: { rows: impacts.slice(0, 5) } }),
    ...latestQuotes.slice(0, 4).map((row, index) => calculatedEvidence({
      id: `EVID-MARKET-QUOTE-${index + 1}`,
      title: `${row.symbol} latest quote ${row.last_price}`,
      metadata: row,
    })),
  ];
  const regimeBundle = planReportFigures(buildRegimeTransmissionReportBundle({
    regime: {
      label: input.subject?.displayName || `${regime} regime transmission`,
      confidence: Math.min(100, Math.round(impacts.reduce((sum, row) => sum + num(row.sample_size), 0) / Math.max(1, impacts.length))),
      vix: num(vix?.last_price),
      oil: num(oil?.last_price),
      edgeCount: impacts.length,
    },
    evidence,
    metrics: impacts.slice(0, 5).map((row, index) => ({
      metricId: `MET-REGIME-IMPACT-${index + 1}`,
      kind: 'regime_conditional_impact',
      name: `${row.theme}:${row.symbol}:${row.horizon}`,
      value: num(row.regime_multiplier),
      unit: 'multiplier',
      asOf: iso(row.updated_at),
      metadata: row,
    })),
    sourceSummary: sourceSummaryFromEvidence(evidence, { distinctSources: 2, sourceDiversityScore: 0.7, lowDiversityFlag: false }),
    dataFreshness: [
      { dataset: 'market_quotes', freshnessStatus: freshnessFromTimestamp(latestQuotes[0]?.observed_at || latestQuotes[0]?.fetched_at, 24), lastUpdatedAt: iso(latestQuotes[0]?.observed_at || latestQuotes[0]?.fetched_at), slaHours: 24 },
      { dataset: 'regime_conditional_impact', freshnessStatus: freshnessFromTimestamp(impacts[0]?.updated_at, 48), lastUpdatedAt: iso(impacts[0]?.updated_at), slaHours: 48 },
    ],
    metadata: { dbBacked: true, impacts: impacts.slice(0, 12), latestQuotes },
  }));
  attachSubjectFidelity(regimeBundle, {
    requestedSubject: input.subject?.displayName || input.subject || resolveSubjectString(input) || regime,
    matchStatus: 'system-wide',
    resolvedSubjectKey: regime,
  });
  applyReportDataDiagnostics(regimeBundle);
  return regimeBundle;
}

export async function buildDbSymbolSignalReportBundle(client, input = {}) {
  const subject = resolveSubjectString(input);
  const subjectAsTicker = /^[A-Za-z.=-]{1,8}$/.test(String(subject || '').trim()) && !String(subject || '').includes('-')
    ? String(subject).trim()
    : '';
  const symbol = String(input.symbol || subjectAsTicker || '').trim().toUpperCase();
  const allowFallback = input.allowFallback === true;
  const resolvedSubject = resolveSubjectKey(input.subject || input);
  /* P1: when subject is a theme slug (e.g. 'cloud-infrastructure'), bind the
   * sensitivity row to that theme. The previous query matched ALL rows when
   * the subject couldn't be coerced into a ticker. */
  const themeKey = resolvedSubject.kind === 'theme' ? resolvedSubject.key : null;
  let sensitivity = symbol
    ? await one(client, `
      SELECT * FROM stock_sensitivity_matrix
      WHERE symbol = $1
      ORDER BY updated_at DESC NULLS LAST, sample_size DESC NULLS LAST, ABS(sensitivity_zscore) DESC NULLS LAST
      LIMIT 1
    `, [symbol])
    : (themeKey
      ? await one(client, `
        SELECT * FROM stock_sensitivity_matrix
        WHERE theme = $1
        ORDER BY ABS(sensitivity_zscore) DESC NULLS LAST, sample_size DESC NULLS LAST, updated_at DESC NULLS LAST
        LIMIT 1
      `, [themeKey])
      : null);
  let symbolMatchStatus = sensitivity ? 'subject-bound' : null;
  let symbolFallbackReason = null;
  if (!sensitivity) {
    if (!allowFallback) {
      const noData = buildNoBoundCandidateBundle({
        reportType: REPORT_TYPES.SYMBOL,
        requestedSubject: subject || resolvedSubject.raw,
        reason: `No stock_sensitivity_matrix row for ${symbol ? `symbol=${symbol}` : `theme=${themeKey || '(empty)'}`}. Allow fallback to top-by-zscore row by passing --allowFallback.`,
      });
      return planReportFigures(applyReportDataDiagnostics(noData));
    }
    sensitivity = await one(client, `
      SELECT * FROM stock_sensitivity_matrix
      ORDER BY updated_at DESC NULLS LAST, sample_size DESC NULLS LAST, ABS(sensitivity_zscore) DESC NULLS LAST
      LIMIT 1
    `);
    symbolMatchStatus = 'fallback-used';
    symbolFallbackReason = `No sensitivity row for requested subject; using top-by-zscore symbol=${sensitivity?.symbol} (theme=${sensitivity?.theme}) as fallback.`;
  }
  if (!sensitivity) throw new Error('stock_sensitivity_matrix returned no rows');
  const quote = await one(client, `
    SELECT *
    FROM market_quotes
    WHERE symbol = $1
    ORDER BY observed_at DESC NULLS LAST, fetched_at DESC NULLS LAST
    LIMIT 1
  `, [sensitivity.symbol]);
  const evidence = [
    calculatedEvidence({ id: `EVID-SENSITIVITY-${sensitivity.id}`, title: `${sensitivity.symbol} sensitivity to ${sensitivity.theme}`, metadata: sensitivity }),
    ...(quote ? [calculatedEvidence({ id: `EVID-QUOTE-${sensitivity.symbol}`, title: `${sensitivity.symbol} latest quote ${quote.last_price}`, metadata: quote })] : []),
  ];
  const symbolBundle = planReportFigures(buildSymbolSignalReportBundle({
    symbol: {
      ticker: sensitivity.symbol,
      name: input.subject?.displayName || `${sensitivity.symbol} ${sensitivity.theme} exposure`,
      exposureScore: Math.min(1, Math.abs(num(sensitivity.sensitivity_zscore)) / 3),
      relativeReturnPct: num(sensitivity.avg_return),
      validationQuality: Math.min(1, num(sensitivity.sample_size) / 30),
    },
    evidence,
    marketReactions: [{
      reactionId: `MRKT-SYMBOL-${sensitivity.symbol}`,
      symbol: sensitivity.symbol,
      benchmark: 'baseline_return',
      eventWindow: sensitivity.horizon,
      relativeReturnPct: num(sensitivity.avg_return),
      uplift: num(sensitivity.avg_return) - num(sensitivity.baseline_return),
      tStat: num(sensitivity.sensitivity_zscore),
      alpha: num(sensitivity.avg_return) - num(sensitivity.baseline_return),
      controls: [`sample_size=${num(sensitivity.sample_size)}`],
      validationStatus: num(sensitivity.sample_size) >= 10 ? 'validated' : 'candidate',
    }],
    sourceSummary: sourceSummaryFromEvidence(evidence, { distinctSources: evidence.length, sourceDiversityScore: 0.7, lowDiversityFlag: evidence.length <= 1 }),
    dataFreshness: [{ dataset: 'stock_sensitivity_matrix', freshnessStatus: freshnessFromTimestamp(sensitivity.updated_at, 72), lastUpdatedAt: iso(sensitivity.updated_at), slaHours: 72 }],
    metadata: { dbBacked: true, sensitivity, quote },
  }));
  /* P1 fidelity: if the symbol's theme matches requested subject, mark bound.
   * If symbol was given directly (e.g. 'NVDA'), trust the row as-is. */
  if (symbolMatchStatus === 'subject-bound' && themeKey) {
    symbolMatchStatus = classifySubjectMatch({ requested: themeKey, actual: sensitivity.theme });
  }
  attachSubjectFidelity(symbolBundle, {
    requestedSubject: subject || resolvedSubject.raw,
    matchStatus: symbolMatchStatus,
    resolvedSubjectKey: `${sensitivity.symbol}@${sensitivity.theme}`,
    fallbackReason: symbolFallbackReason,
  });
  applyReportDataDiagnostics(symbolBundle);
  return symbolBundle;
}

export async function buildDbSystemQualityReportBundle(client, input = {}) {
  const selectedTables = [
    ['articles', 'published_at'],
    ['canonical_events', 'created_at'],
    ['event_uplift', null],
    ['theme_trend_aggregates', 'computed_at'],
    ['cross_theme_candidates', 'updated_at'],
    ['market_quotes', 'observed_at'],
    ['model_predictions', 'created_at'],
    ['model_eval', 'eval_date'],
  ];
  const freshnessRows = [];
  for (const [table, column] of selectedTables) {
    const countRow = await one(client, `SELECT count(*)::bigint AS count FROM ${table}`);
    let maxAt = null;
    if (column) {
      maxAt = (await one(client, `SELECT max(${column}) AS max_at FROM ${table}`))?.max_at || null;
    }
    freshnessRows.push({ table, count: num(countRow?.count), maxAt });
  }
  const latestEval = await one(client, 'SELECT * FROM model_eval ORDER BY eval_date DESC NULLS LAST LIMIT 1');
  const staleCount = freshnessRows.filter((row) => columnSla(row.table) && freshnessFromTimestamp(row.maxAt, columnSla(row.table)) === 'stale').length;
  const evidence = freshnessRows.map((row) => calculatedEvidence({
    id: `EVID-OPS-${row.table.toUpperCase().replace(/[^A-Z0-9]/g, '-')}`,
    title: `${row.table} rows=${row.count} latest=${iso(row.maxAt) || 'n/a'}`,
    metadata: row,
  }));
  const sysBundle = planReportFigures(buildSystemQualityReportBundle({
    ops: {
      freshDatasets: freshnessRows.length - staleCount,
      staleDatasets: staleCount,
      pendingValidation: num((await one(client, "SELECT count(*)::bigint AS count FROM approval_queue WHERE status IN ('pending','needs-fix')"))?.count),
      ece: num(latestEval?.ece),
    },
    evidence,
    sourceSummary: sourceSummaryFromEvidence(evidence, { distinctSources: evidence.length, sourceDiversityScore: 1, lowDiversityFlag: false }),
    dataFreshness: freshnessRows.map((row) => ({
      dataset: row.table,
      freshnessStatus: row.maxAt ? freshnessFromTimestamp(row.maxAt, columnSla(row.table) || 168) : 'fresh',
      lastUpdatedAt: iso(row.maxAt),
      slaHours: columnSla(row.table) || 168,
      metadata: { count: row.count },
    })),
    metadata: { dbBacked: true, freshnessRows, latestEval },
  }));
  attachSubjectFidelity(sysBundle, {
    requestedSubject: resolveSubjectString(input) || 'system_quality',
    matchStatus: 'system-wide',
    resolvedSubjectKey: 'system',
  });
  applyReportDataDiagnostics(sysBundle);
  return sysBundle;
}

function columnSla(table) {
  const map = {
    articles: 48,
    canonical_events: 168,
    theme_trend_aggregates: 48,
    cross_theme_candidates: 48,
    market_quotes: 24,
    model_predictions: 48,
    model_eval: 720,
  };
  return map[table] || null;
}

export async function buildDbReportBundle(client, input = {}) {
  const type = input.reportType || input.type || REPORT_TYPES.THEME;
  const build = async () => {
    if (type === REPORT_TYPES.THEME || type === 'theme') return buildDbThemeReportBundle(client, input);
    if (type === REPORT_TYPES.EVENT_SIGNAL || type === 'event' || type === 'event_signal') return buildDbEventSignalReportBundle(client, input);
    if (type === REPORT_TYPES.CROSS_THEME || type === 'cross-theme' || type === 'cross_theme') return buildDbCrossThemeBottleneckReportBundle(client, input);
    if (type === REPORT_TYPES.REGIME || type === 'regime') return buildDbRegimeTransmissionReportBundle(client, input);
    if (type === REPORT_TYPES.SYMBOL || type === 'symbol') return buildDbSymbolSignalReportBundle(client, input);
    if (type === REPORT_TYPES.SYSTEM_QUALITY || type === 'system' || type === 'ops') return buildDbSystemQualityReportBundle(client, input);
    return planReportFigures(createEvidenceBundle({ ...input, reportType: type }));
  };
  const base = await build();
  const useDeep = input.depth !== 'standard' && input.deep !== false;
  if (!useDeep) return base;
  const deep = await attachDeepResearchPack(base, {
    client,
    ensureSchema: input.ensureResearchSchema !== false,
  });
  return planReportFigures(applyReportDataDiagnostics(deep));
}
