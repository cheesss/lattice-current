import { stableResearchOsId } from './adjacency-graph.mjs';

const STOPWORDS = new Set([
  'about', 'after', 'again', 'against', 'also', 'among', 'and', 'are', 'because',
  'been', 'before', 'between', 'but', 'can', 'could', 'from', 'has', 'have',
  'into', 'its', 'more', 'new', 'not', 'over', 'said', 'such', 'that', 'the',
  'their', 'then', 'there', 'these', 'this', 'through', 'under', 'using', 'was',
  'were', 'when', 'where', 'which', 'while', 'with', 'would',
  'phrase', 'emerging', 'outside', 'stable', 'taxonomy', 'determine', 'whether',
  'component', 'material', 'supplier', 'process', 'bottleneck', 'noise', 'current',
  'coverage', 'limited', 'upstream', 'hidden', 'physical', 'connecting',
  'components', 'materials', 'suppliers', 'processes', 'bottlenecks', 'inputs',
  'missing', 'brief', 'supplier/entity', 'entities',
]);

function compactText(value, maxLength = 700) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

function normalizeTerm(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s/-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isSearchTermUsable(value) {
  const term = normalizeTerm(value);
  if (term.length < 3) return false;
  if (/^\d+$/.test(term.replace(/[-/]/g, ''))) return false;
  if (STOPWORDS.has(term)) return false;
  return true;
}

function extractPromptTerms(question = {}) {
  const seeds = Array.isArray(question.seed_terms || question.seedTerms) ? (question.seed_terms || question.seedTerms) : [];
  const themes = Array.isArray(question.themes) ? question.themes : [];
  const prompt = String(question.prompt || '');
  const promptTerms = normalizeTerm(prompt)
    .split(' ')
    .filter((word) => word.length >= 5 && !STOPWORDS.has(word) && !/^\d+$/.test(word.replace(/[-/]/g, '')))
    .slice(0, 12);
  return [...new Set([...seeds, ...themes, ...promptTerms].map(normalizeTerm).filter(isSearchTermUsable))].slice(0, 18);
}

function rowToBundle(question, row, sourceType) {
  const sourceId = sourceType === 'openalex'
    ? row.work_id
    : row.id;
  return {
    questionId: question.id,
    sourceType,
    sourceId: String(sourceId),
    title: row.title || row.display_name || '',
    textExcerpt: compactText(row.summary || row.abstract_text || row.text_excerpt || row.title || ''),
    url: row.url || row.openalex_url || row.landing_page_url || null,
    publishedAt: row.published_at || row.publication_date || null,
    relevanceScore: Number(row.relevance_score || 0),
    metadata: {
      deterministicId: stableResearchOsId(['evidence', question.id, sourceType, sourceId]),
      source: row.source || row.source_display_name || null,
      theme: row.theme || row.primary_topic || null,
    },
  };
}

async function safeRows(queryable, sql, params = []) {
  try {
    const { rows } = await queryable.query(sql, params);
    return rows;
  } catch {
    return [];
  }
}

export async function loadResearchQuestionsForEvidence(queryable, options = {}) {
  const limit = Math.max(1, Number(options.limit || 24));
  const status = options.status || 'new';
  const { rows } = await queryable.query(
    `SELECT id, question_type, themes, seed_terms, prompt, trigger_reason, metadata
       FROM research_questions
      WHERE status = $1
      ORDER BY priority_score DESC NULLS LAST, created_at DESC
      LIMIT $2`,
    [status, limit],
  );
  return rows;
}

export async function collectEvidenceForQuestion(queryable, question, options = {}) {
  const limit = Math.max(1, Math.min(100, Number(options.limit || 24)));
  const terms = extractPromptTerms(question);
  if (!terms.length) return { question, terms, bundles: [] };
  const patterns = terms.map((term) => `%${term}%`);
  const themeKeys = Array.isArray(question.themes)
    ? question.themes.map(normalizeTerm).filter(isSearchTermUsable)
    : [];
  const articles = await safeRows(queryable, `
    SELECT id, source, theme, published_at, title, summary, url,
           (
             CASE WHEN lower(COALESCE(theme,'')) = ANY($2::text[]) THEN 0.75 ELSE 0 END
             + CASE WHEN lower(COALESCE(legacy_theme,'')) = ANY($2::text[]) THEN 0.45 ELSE 0 END
             + CASE WHEN lower(COALESCE(title,'')) ILIKE ANY($1::text[]) THEN 0.65 ELSE 0 END
             + CASE WHEN lower(COALESCE(summary,'')) ILIKE ANY($1::text[]) THEN 0.35 ELSE 0 END
           ) AS relevance_score
      FROM articles
     WHERE lower(COALESCE(title,'')) ILIKE ANY($1::text[])
        OR lower(COALESCE(summary,'')) ILIKE ANY($1::text[])
        OR lower(COALESCE(theme,'')) = ANY($2::text[])
        OR lower(COALESCE(legacy_theme,'')) = ANY($2::text[])
     ORDER BY relevance_score DESC, published_at DESC NULLS LAST
     LIMIT $3
  `, [patterns, themeKeys, limit]);
  const openalex = await safeRows(queryable, `
    SELECT work_id, title, abstract_text, openalex_url, landing_page_url,
           publication_date, source_display_name, primary_topic,
           (
             CASE WHEN lower(COALESCE(title,'')) ILIKE ANY($1::text[]) THEN 0.65 ELSE 0 END
             + CASE WHEN lower(COALESCE(abstract_text,'')) ILIKE ANY($1::text[]) THEN 0.35 ELSE 0 END
             + CASE WHEN lower(COALESCE(primary_topic,'')) ILIKE ANY($1::text[]) THEN 0.35 ELSE 0 END
           ) AS relevance_score
      FROM openalex_works
     WHERE lower(COALESCE(title,'')) ILIKE ANY($1::text[])
        OR lower(COALESCE(abstract_text,'')) ILIKE ANY($1::text[])
        OR lower(COALESCE(primary_topic,'')) ILIKE ANY($1::text[])
     ORDER BY relevance_score DESC, publication_date DESC NULLS LAST
     LIMIT $2
  `, [patterns, Math.ceil(limit / 2)]);
  const bundles = [
    ...articles.map((row) => rowToBundle(question, row, 'article')),
    ...openalex.map((row) => rowToBundle(question, row, 'openalex')),
  ];
  return { question, terms, bundles };
}

export async function persistEvidenceBundles(queryable, bundles = []) {
  let inserted = 0;
  for (const bundle of bundles) {
    const result = await queryable.query(
      `INSERT INTO research_evidence_bundles (
         question_id, source_type, source_id, title, text_excerpt, url, published_at,
         relevance_score, metadata
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)
       ON CONFLICT (question_id, source_type, source_id) DO UPDATE
         SET title = EXCLUDED.title,
             text_excerpt = EXCLUDED.text_excerpt,
             url = COALESCE(EXCLUDED.url, research_evidence_bundles.url),
             published_at = COALESCE(EXCLUDED.published_at, research_evidence_bundles.published_at),
             relevance_score = GREATEST(
               COALESCE(research_evidence_bundles.relevance_score, 0),
               COALESCE(EXCLUDED.relevance_score, 0)
             ),
             metadata = research_evidence_bundles.metadata || EXCLUDED.metadata
       RETURNING id`,
      [
        bundle.questionId,
        bundle.sourceType,
        bundle.sourceId,
        bundle.title,
        bundle.textExcerpt,
        bundle.url,
        bundle.publishedAt,
        Number(bundle.relevanceScore || 0),
        JSON.stringify(bundle.metadata || {}),
      ],
    );
    if (result.rows.length) inserted += 1;
  }
  return { ok: true, inserted };
}

export async function collectResearchEvidence(queryable, options = {}) {
  const questions = options.questions || await loadResearchQuestionsForEvidence(queryable, options);
  const allBundles = [];
  const perQuestion = [];
  for (const question of questions) {
    const collected = await collectEvidenceForQuestion(queryable, question, options);
    allBundles.push(...collected.bundles);
    perQuestion.push({
      questionId: String(question.id),
      terms: collected.terms,
      bundleCount: collected.bundles.length,
    });
  }
  const persistResult = options.dryRun ? { ok: true, inserted: 0, dryRun: true } : await persistEvidenceBundles(queryable, allBundles);
  return {
    ok: true,
    dryRun: Boolean(options.dryRun),
    questionCount: questions.length,
    bundleCount: allBundles.length,
    perQuestion,
    ...persistResult,
  };
}
