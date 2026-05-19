import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import {
  ensureResearchOsSchema,
  normalizeKnowledgeKey,
  stableResearchOsId,
  upsertIncomingResearchSignal,
} from './adjacency-graph.mjs';
import { loadResearchOsPolicy, requirePolicyNumber } from './research-os-policy.mjs';
import { THEME_TAXONOMY } from './theme-taxonomy.mjs';

const STOPWORDS = new Set([
  'about', 'after', 'again', 'against', 'also', 'among', 'and', 'are', 'because',
  'been', 'before', 'between', 'but', 'can', 'could', 'from', 'have', 'into',
  'more', 'new', 'news', 'over', 'said', 'says', 'such', 'that', 'their',
  'there', 'these', 'this', 'through', 'under', 'using', 'with', 'would',
  'update', 'updates', 'briefing', 'report', 'reports', 'review', 'reviews',
  'company', 'market', 'markets', 'global', 'million', 'billion',
]);

function toNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clamp(value, min = 0, max = 1) {
  return Math.min(max, Math.max(min, value));
}

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (value == null) return [];
  return [value];
}

function uniqueStrings(values = [], limit = 50) {
  const seen = new Set();
  const out = [];
  for (const value of values) {
    const text = String(value || '').trim();
    if (!text) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(text);
    if (out.length >= limit) break;
  }
  return out;
}

function buildStableTaxonomyTerms() {
  const terms = new Set();
  for (const [key, value] of Object.entries(THEME_TAXONOMY || {})) {
    terms.add(normalizeKnowledgeKey(key));
    terms.add(normalizeKnowledgeKey(value.label));
    terms.add(normalizeKnowledgeKey(value.category));
    if (value.parentTheme) terms.add(normalizeKnowledgeKey(value.parentTheme));
    for (const keyword of value.keywords || []) terms.add(normalizeKnowledgeKey(keyword));
  }
  return terms;
}

function genericTerms(policy) {
  return new Set([
    ...(policy?.scoring?.genericNoise?.terms || []),
    ...(policy?.generation?.novelPhraseDenylist || []),
  ].map(normalizeKnowledgeKey).filter(Boolean));
}

function cleanLabel(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function normalizeTerm(value) {
  return cleanLabel(value)
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9\s/-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isUsableIncomingTerm(value, policy, options = {}) {
  const normalized = normalizeTerm(value);
  const key = normalizeKnowledgeKey(normalized);
  if (!key || key.length < 4) return false;
  if (/^\d+$/.test(key.replace(/-/g, ''))) return false;
  if (STOPWORDS.has(normalized) || STOPWORDS.has(key)) return false;
  if (genericTerms(policy).has(key)) return false;
  if (buildStableTaxonomyTerms().has(key)) return false;
  if (!options.allowSingleToken && key.split('-').filter(Boolean).length < 2) return false;
  if (key.split('-').every((part) => part.length <= 3)) return false;
  return true;
}

function technicalCueTerms(policy) {
  return uniqueStrings(policy?.relationExtraction?.technicalCueTerms || [], 200)
    .map((term) => normalizeTerm(term))
    .filter(Boolean);
}

function extractTermsFromText(value, policy, options = {}) {
  const text = normalizeTerm(value);
  if (!text) return [];
  const terms = [];
  for (const cue of technicalCueTerms(policy)) {
    if (cue && text.includes(cue) && isUsableIncomingTerm(cue, policy)) terms.push(cue);
  }
  const words = text.split(/\s+/).filter((word) => (
    word.length >= 4
    && !STOPWORDS.has(word)
    && !/^\d+$/.test(word)
  ));
  const maxNgram = Math.max(1, Number(options.maxNgram || 3));
  for (let size = 2; size <= maxNgram; size += 1) {
    for (let index = 0; index <= words.length - size; index += 1) {
      const phrase = words.slice(index, index + size).join(' ');
      if (!isUsableIncomingTerm(phrase, policy)) continue;
      const key = normalizeKnowledgeKey(phrase);
      const containsCue = technicalCueTerms(policy).some((cue) => key.includes(normalizeKnowledgeKey(cue)));
      if (containsCue || options.allowGeneralNgrams) terms.push(phrase);
    }
  }
  return uniqueStrings(terms, options.limit || 10);
}

function signalSourceWeight(sourceType, policy) {
  const weights = policy?.incoming?.sourceTypeWeights || {};
  return toNumber(weights[sourceType], 0.5);
}

function similarityToSeedTerm(name, seedExamples = []) {
  const key = normalizeKnowledgeKey(name);
  if (!key) return 0;
  let best = 0;
  for (const seed of seedExamples || []) {
    const terms = [
      ...(seed.expectedConnectors || []),
      ...(seed.expectedSuppliers || []),
      ...(seed.seedTerms || []),
    ].map(normalizeKnowledgeKey).filter(Boolean);
    for (const term of terms) {
      if (term === key) best = Math.max(best, 1);
      else if (term.includes(key) || key.includes(term)) best = Math.max(best, 0.7);
      else {
        const left = new Set(key.split('-'));
        const right = new Set(term.split('-'));
        const overlap = [...left].filter((part) => right.has(part)).length;
        best = Math.max(best, overlap / Math.max(left.size, right.size, 1));
      }
    }
  }
  return clamp(best);
}

function graphDistanceSummary(key, graphKeys = new Set()) {
  if (graphKeys.has(key)) return { known: true, distance: 0, reason: 'exact-node-match' };
  const parts = key.split('-').filter((part) => part.length >= 4);
  const partial = parts.filter((part) => graphKeys.has(part)).slice(0, 6);
  if (partial.length) return { known: false, distance: 1, partialMatches: partial };
  return { known: false, distance: 2, partialMatches: [] };
}

function createAccumulator() {
  return {
    labels: new Map(),
    signalTypes: new Set(),
    sourceTypes: new Set(),
    sourceIds: new Set(),
    sources: new Set(),
    linkedThemes: new Set(),
    evidenceRefs: [],
    observations: 0,
    sourceWeight: 0,
    firstSeen: null,
    lastSeen: null,
  };
}

function noteObservation(acc, observation) {
  acc.labels.set(observation.label, (acc.labels.get(observation.label) || 0) + 1);
  acc.signalTypes.add(observation.signalType);
  acc.sourceTypes.add(observation.sourceType);
  if (observation.sourceId) acc.sourceIds.add(String(observation.sourceId));
  if (observation.source) acc.sources.add(String(observation.source).toLowerCase());
  for (const theme of observation.themes || []) {
    const key = normalizeKnowledgeKey(theme);
    if (key && key !== 'unknown') acc.linkedThemes.add(key);
  }
  if (observation.evidenceRef) acc.evidenceRefs.push(observation.evidenceRef);
  acc.observations += 1;
  acc.sourceWeight += observation.sourceWeight || 0;
  const seen = observation.seenAt ? new Date(observation.seenAt) : null;
  if (seen && !Number.isNaN(seen.valueOf())) {
    const iso = seen.toISOString();
    if (!acc.firstSeen || iso < acc.firstSeen) acc.firstSeen = iso;
    if (!acc.lastSeen || iso > acc.lastSeen) acc.lastSeen = iso;
  }
}

function addObservation(groups, term, observation, policy, options = {}) {
  if (!isUsableIncomingTerm(term, policy, options)) return;
  const key = normalizeKnowledgeKey(term);
  const acc = groups.get(key) || createAccumulator();
  noteObservation(acc, { ...observation, label: cleanLabel(term) });
  groups.set(key, acc);
}

function dominantLabel(labels) {
  return [...labels.entries()].sort((left, right) => right[1] - left[1] || right[0].length - left[0].length)[0]?.[0] || '';
}

function dominantSignalType(signalTypes, sourceTypeCount) {
  if (sourceTypeCount >= 2) return 'cross_source_convergence';
  const types = [...signalTypes];
  if (types.includes('entity_exposure')) return 'source_bridge';
  if (types.includes('research_frontier')) return 'incoming_entity';
  if (types.includes('code_frontier')) return 'source_bridge';
  if (types.includes('article_phrase')) return 'incoming_entity';
  return types[0] || 'incoming_entity';
}

export function buildIncomingSignalsFromRows(input = {}, policy = loadResearchOsPolicy()) {
  const groups = new Map();
  const graphKeys = new Set((input.graphKeys || []).map(normalizeKnowledgeKey).filter(Boolean));
  const seedExamples = input.seedExamples || [];

  for (const topic of input.discoveryTopics || []) {
    const themes = uniqueStrings([
      topic.normalized_theme,
      topic.normalized_parent_theme,
      topic.category,
      topic.parent_theme,
    ].filter(Boolean));
    const companyTerms = uniqueStrings([
      ...(topic.key_companies || topic.keyCompanies || []),
    ], 20);
    const conceptTerms = uniqueStrings([
      ...(topic.key_technologies || topic.keyTechnologies || []),
      ...(topic.keywords || []),
      topic.label,
    ], 20);
    for (const term of companyTerms) {
      addObservation(groups, term, {
        signalType: 'topic_shift',
        sourceType: 'discoveryTopic',
        sourceId: topic.id,
        source: topic.status || 'discovery_topics',
        themes,
        sourceWeight: signalSourceWeight('discoveryTopic', policy),
        seenAt: topic.updated_at || topic.last_seen || topic.lastSeen,
        evidenceRef: {
          sourceType: 'discoveryTopic',
          sourceId: topic.id,
          title: topic.label,
          count: topic.article_count || topic.articleCount || 0,
        },
      }, policy, { allowSingleToken: true });
    }
    for (const term of conceptTerms) {
      addObservation(groups, term, {
        signalType: 'topic_shift',
        sourceType: 'discoveryTopic',
        sourceId: topic.id,
        source: topic.status || 'discovery_topics',
        themes,
        sourceWeight: signalSourceWeight('discoveryTopic', policy),
        seenAt: topic.updated_at || topic.last_seen || topic.lastSeen,
        evidenceRef: {
          sourceType: 'discoveryTopic',
          sourceId: topic.id,
          title: topic.label,
          count: topic.article_count || topic.articleCount || 0,
        },
      }, policy, { allowSingleToken: false });
    }
  }

  for (const article of input.articles || []) {
    const terms = extractTermsFromText(`${article.title || ''} ${article.summary || ''}`, policy, { limit: 8 });
    for (const term of terms) {
      addObservation(groups, term, {
        signalType: 'article_phrase',
        sourceType: 'article',
        sourceId: article.id,
        source: article.source,
        themes: [article.theme, article.theme_key, article.auto_theme, article.legacy_theme],
        sourceWeight: signalSourceWeight('article', policy),
        seenAt: article.published_at,
        evidenceRef: {
          sourceType: 'article',
          sourceId: article.id,
          title: article.title,
          source: article.source,
        },
      }, policy);
    }
  }

  for (const work of input.openalexWorks || []) {
    const terms = extractTermsFromText(`${work.title || work.display_name || ''} ${work.primary_topic || ''} ${work.abstract_text || ''}`, policy, {
      limit: 10,
      allowGeneralNgrams: true,
    });
    for (const term of terms) {
      addObservation(groups, term, {
        signalType: 'research_frontier',
        sourceType: 'openalex',
        sourceId: work.work_id,
        source: work.source_display_name,
        themes: [work.primary_topic, work.theme],
        sourceWeight: signalSourceWeight('openalex', policy),
        seenAt: work.updated_at || work.publication_date,
        evidenceRef: {
          sourceType: 'openalex',
          sourceId: work.work_id,
          title: work.title || work.display_name,
          source: work.source_display_name,
        },
      }, policy);
    }
  }

  for (const repo of input.githubRepos || []) {
    const terms = uniqueStrings([
      ...(repo.topics || []),
      ...extractTermsFromText(`${repo.full_name || ''} ${repo.name || ''} ${repo.description || ''}`, policy, {
        limit: 8,
        allowGeneralNgrams: true,
      }),
    ], 12);
    for (const term of terms) {
      addObservation(groups, term, {
        signalType: 'code_frontier',
        sourceType: 'github',
        sourceId: repo.repo_key || repo.full_name,
        source: repo.full_name,
        themes: repo.themes || [],
        sourceWeight: signalSourceWeight('github', policy),
        seenAt: repo.pushed_at || repo.updated_at,
        evidenceRef: {
          sourceType: 'github',
          sourceId: repo.repo_key || repo.full_name,
          title: repo.full_name,
          stars: repo.stargazers_count || repo.stargazersCount || 0,
        },
      }, policy, { allowSingleToken: true });
    }
  }

  for (const exposure of input.themeEntityExposures || []) {
    addObservation(groups, exposure.entity_label || exposure.entity_key, {
      signalType: 'entity_exposure',
      sourceType: 'sec',
      sourceId: exposure.exposure_key || `${exposure.theme}:${exposure.entity_key}`,
      source: exposure.evidence_source || 'theme_entity_exposure',
      themes: [exposure.theme],
      sourceWeight: signalSourceWeight('sec', policy),
      seenAt: exposure.updated_at,
      evidenceRef: {
        sourceType: 'sec',
        sourceId: exposure.exposure_key || exposure.entity_key,
        title: exposure.entity_label,
        relationType: exposure.relation_type,
      },
    }, policy, { allowSingleToken: true });
  }

  for (const bundle of input.externalEvidenceBundles || []) {
    const terms = extractTermsFromText(`${bundle.title || ''} ${bundle.text_excerpt || bundle.textExcerpt || ''}`, policy, {
      limit: 8,
      allowGeneralNgrams: true,
    });
    for (const term of terms) {
      addObservation(groups, term, {
        signalType: 'source_bridge',
        sourceType: 'externalRss',
        sourceId: bundle.source_id || bundle.sourceId,
        source: bundle.metadata?.source || bundle.source_type,
        themes: bundle.metadata?.themes || [],
        sourceWeight: signalSourceWeight('externalRss', policy),
        seenAt: bundle.published_at || bundle.created_at,
        evidenceRef: {
          sourceType: 'externalRss',
          sourceId: bundle.source_id || bundle.sourceId,
          title: bundle.title,
        },
      }, policy);
    }
  }

  const minObservations = requirePolicyNumber(policy, 'incoming.minObservationCount');
  const minSourceCount = requirePolicyNumber(policy, 'incoming.minSourceCount');
  const minNovelty = requirePolicyNumber(policy, 'incoming.minNoveltyScore');
  const minPriority = requirePolicyNumber(policy, 'incoming.minPriorityScore');
  const singleSourcePriorityCap = requirePolicyNumber(policy, 'incoming.singleSourcePriorityCap');
  const crossSourcePriorityBoost = requirePolicyNumber(policy, 'incoming.crossSourcePriorityBoost');
  const sourceBridgePriorityBoost = requirePolicyNumber(policy, 'incoming.sourceBridgePriorityBoost');
  const signals = [];

  for (const [key, acc] of groups.entries()) {
    const sourceTypes = [...acc.sourceTypes].sort();
    const sourceCount = Math.max(sourceTypes.length, acc.sources.size);
    if (!acc.linkedThemes.size && sourceTypes.length === 1) continue;
    const label = dominantLabel(acc.labels);
    const graphSummary = graphDistanceSummary(key, graphKeys);
    const seedSimilarity = similarityToSeedTerm(label, seedExamples);
    const graphNovelty = graphSummary.distance === 0 ? 0.25 : graphSummary.distance === 1 ? 0.65 : 1;
    const noveltyScore = clamp((1 - seedSimilarity) * 0.55 + graphNovelty * 0.45);
    const sourceDivergenceScore = sourceTypes.length === 1 && acc.observations >= minObservations ? 0.75 : 0.25;
    const crossSourceScore = clamp(sourceTypes.length / 3);
    const themeBreadth = clamp(acc.linkedThemes.size / 3);
    const evidenceScore = clamp(acc.observations / 8);
    const sourceWeightScore = clamp(acc.sourceWeight / Math.max(acc.observations, 1));
    const signalType = dominantSignalType(acc.signalTypes, sourceTypes.length);
    let priorityScore = clamp(
      noveltyScore * 0.3
      + crossSourceScore * 0.2
      + sourceDivergenceScore * 0.15
      + themeBreadth * 0.15
      + evidenceScore * 0.1
      + sourceWeightScore * 0.1,
    );
    if (sourceTypes.length > 1) priorityScore = clamp(priorityScore + crossSourcePriorityBoost);
    if (signalType === 'source_bridge') priorityScore = clamp(priorityScore + sourceBridgePriorityBoost);
    if (sourceTypes.length === 1 && acc.signalTypes.size === 1 && acc.signalTypes.has('topic_shift')) {
      priorityScore = Math.min(priorityScore, singleSourcePriorityCap);
    }
    if (acc.observations < minObservations || sourceCount < minSourceCount) continue;
    if (noveltyScore < minNovelty || priorityScore < minPriority) continue;
    signals.push({
      id: stableResearchOsId(['incoming-signal', signalType, key]),
      signalType,
      label,
      normalizedKey: key,
      sourceTypes,
      sourceCount,
      observationCount: acc.observations,
      evidenceRefs: acc.evidenceRefs.slice(0, 12),
      linkedThemes: [...acc.linkedThemes].sort().slice(0, 12),
      noveltyScore,
      sourceDivergenceScore,
      crossSourceScore,
      priorityScore,
      seedSimilarity,
      graphDistanceSummary: graphSummary,
      status: 'new',
      firstSeen: acc.firstSeen,
      lastSeen: acc.lastSeen,
      metadata: {
        signalTypes: [...acc.signalTypes].sort(),
        sourceIds: [...acc.sourceIds].slice(0, 20),
        sourceWeightScore,
        generatedBy: 'incoming-connection-miner',
      },
    });
  }

  return signals
    .sort((left, right) => right.priorityScore - left.priorityScore || right.noveltyScore - left.noveltyScore)
    .slice(0, requirePolicyNumber(policy, 'incoming.maxSignalsPerRun'));
}

export const buildIncomingResearchSignalsFromRows = buildIncomingSignalsFromRows;

async function safeRows(queryable, sql, params = []) {
  try {
    const { rows } = await queryable.query(sql, params);
    return rows;
  } catch {
    return [];
  }
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

async function loadGraphKeys(queryable) {
  const rows = await safeRows(queryable, `SELECT normalized_key FROM knowledge_nodes WHERE status <> 'archived'`);
  return rows.map((row) => row.normalized_key).filter(Boolean);
}

export async function collectIncomingResearchSignals(queryable, options = {}) {
  const policy = options.policy || loadResearchOsPolicy();
  const lookbackDays = Math.max(1, Number(options.lookbackDays || requirePolicyNumber(policy, 'incoming.lookbackDays')));
  const graphKeys = options.graphKeys || await loadGraphKeys(queryable);
  const discoveryTopics = options.discoveryTopics || await safeRows(queryable, `
    SELECT id, label, category, stage, status, promotion_state, keywords,
           key_companies, key_technologies, article_count, momentum,
           normalized_theme, normalized_parent_theme, parent_theme,
           first_seen, last_seen, updated_at
      FROM discovery_topics
     WHERE updated_at >= NOW() - ($1::int * INTERVAL '1 day')
     ORDER BY updated_at DESC
     LIMIT 240
  `, [lookbackDays]);
  const articles = options.articles || await safeRows(queryable, `
    SELECT a.id, a.title, a.summary, a.source, a.published_at, a.theme, a.legacy_theme,
           t.theme_key, t.auto_theme
      FROM articles a
      LEFT JOIN auto_article_themes t ON t.article_id = a.id
     WHERE a.published_at >= NOW() - ($1::int * INTERVAL '1 day')
     ORDER BY a.published_at DESC
     LIMIT 900
  `, [lookbackDays]);
  const openalexWorks = options.openalexWorks || await safeRows(queryable, `
    SELECT work_id, title, display_name, abstract_text, primary_topic,
           source_display_name, publication_date, cited_by_count, updated_at
      FROM openalex_works
     WHERE updated_at >= NOW() - ($1::int * INTERVAL '1 day')
        OR publication_date >= CURRENT_DATE - INTERVAL '540 days'
     ORDER BY updated_at DESC NULLS LAST, cited_by_count DESC NULLS LAST
     LIMIT 240
  `, [lookbackDays]);
  const githubRepos = options.githubRepos || await safeRows(queryable, `
    SELECT repo_key, full_name, name, description, language, topics,
           stargazers_count, pushed_at, updated_at
      FROM github_repositories
     WHERE updated_at >= NOW() - ($1::int * INTERVAL '1 day')
        OR pushed_at >= NOW() - ($1::int * INTERVAL '1 day')
     ORDER BY updated_at DESC NULLS LAST, stargazers_count DESC NULLS LAST
     LIMIT 240
  `, [lookbackDays]);
  const themeEntityExposures = options.themeEntityExposures || await safeRows(queryable, `
    SELECT exposure_key, theme, entity_type, entity_key, entity_label,
           relation_type, confidence, evidence_source, evidence_note, updated_at
      FROM theme_entity_exposure
     WHERE updated_at >= NOW() - ($1::int * INTERVAL '1 day')
     ORDER BY updated_at DESC
     LIMIT 240
  `, [lookbackDays]);
  const externalEvidenceBundles = options.externalEvidenceBundles || await safeRows(queryable, `
    SELECT source_type, source_id, title, text_excerpt, published_at, metadata, created_at
      FROM research_evidence_bundles
     WHERE source_type = 'external-rss'
       AND created_at >= NOW() - ($1::int * INTERVAL '1 day')
     ORDER BY created_at DESC
     LIMIT 160
  `, [lookbackDays]);

  const signals = buildIncomingSignalsFromRows({
    discoveryTopics,
    articles,
    openalexWorks,
    githubRepos,
    themeEntityExposures,
    externalEvidenceBundles,
    graphKeys,
    seedExamples: options.seedExamples || loadSeedExamples(),
  }, policy);

  return {
    ok: true,
    lookbackDays,
    sourceCounts: {
      discoveryTopics: discoveryTopics.length,
      articles: articles.length,
      openalexWorks: openalexWorks.length,
      githubRepos: githubRepos.length,
      themeEntityExposures: themeEntityExposures.length,
      externalEvidenceBundles: externalEvidenceBundles.length,
    },
    signals,
  };
}

export async function persistIncomingResearchSignals(queryable, signals = []) {
  await ensureResearchOsSchema(queryable);
  let inserted = 0;
  const activeIds = signals.map((signal) => signal.id || signal.deterministicId).filter(Boolean);
  for (const signal of signals) {
    const row = await upsertIncomingResearchSignal(queryable, signal, { skipEnsure: true });
    if (row) inserted += 1;
  }
  let archived = 0;
  if (activeIds.length) {
    const archivedResult = await queryable.query(
      `UPDATE incoming_research_signals
          SET status = 'archived',
              updated_at = NOW(),
              metadata = metadata || jsonb_build_object(
                'archivedBy', 'incoming-connection-miner',
                'archivedReason', 'not present in latest incoming signal window'
              )
        WHERE status = 'new'
          AND deterministic_id IS NOT NULL
          AND NOT (deterministic_id = ANY($1::text[]))`,
      [activeIds],
    );
    archived = archivedResult.rowCount || 0;
  }
  return { ok: true, inserted, archived };
}

export async function loadIncomingSignalsForQuestions(queryable, options = {}) {
  const policy = options.policy || loadResearchOsPolicy();
  const limit = Math.max(1, Math.min(
    requirePolicyNumber(policy, 'incoming.maxSignalsPerRun'),
    Number(options.limit || requirePolicyNumber(policy, 'incoming.maxSignalsPerRun')),
  ));
  const { rows } = await queryable.query(
    `SELECT deterministic_id, signal_type, label, normalized_key, source_types,
            source_count, observation_count, evidence_refs, linked_themes,
            novelty_score, source_divergence_score, cross_source_score,
            priority_score, seed_similarity, graph_distance_summary, status,
            metadata, first_seen, last_seen, updated_at
       FROM incoming_research_signals
      WHERE status = ANY($1::text[])
      ORDER BY priority_score DESC NULLS LAST, updated_at DESC
      LIMIT $2`,
    [options.statuses || ['new', 'watch'], limit],
  );
  return rows.map((row) => ({
    id: row.deterministic_id,
    signalType: row.signal_type,
    label: row.label,
    normalizedKey: row.normalized_key,
    sourceTypes: row.source_types || [],
    sourceCount: Number(row.source_count || 0),
    observationCount: Number(row.observation_count || 0),
    evidenceRefs: row.evidence_refs || [],
    linkedThemes: row.linked_themes || [],
    noveltyScore: Number(row.novelty_score || 0),
    sourceDivergenceScore: Number(row.source_divergence_score || 0),
    crossSourceScore: Number(row.cross_source_score || 0),
    priorityScore: Number(row.priority_score || 0),
    seedSimilarity: Number(row.seed_similarity || 0),
    graphDistanceSummary: row.graph_distance_summary || {},
    status: row.status,
    metadata: row.metadata || {},
    firstSeen: row.first_seen,
    lastSeen: row.last_seen,
    updatedAt: row.updated_at,
  }));
}

export async function runIncomingConnectionMiner(queryable, options = {}) {
  await ensureResearchOsSchema(queryable);
  const collected = await collectIncomingResearchSignals(queryable, options);
  const persisted = options.dryRun
    ? { ok: true, inserted: 0, dryRun: true }
    : await persistIncomingResearchSignals(queryable, collected.signals);
  return {
    ...collected,
    ...persisted,
    dryRun: Boolean(options.dryRun),
  };
}
