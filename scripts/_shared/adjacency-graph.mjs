import { createHash } from 'node:crypto';
import { THEME_TAXONOMY } from './theme-taxonomy.mjs';
import { THEME_ENTITY_SEEDS } from './theme-entity-seeds.mjs';
import { discoveryEntriesForTheme } from './theme-ontology.mjs';

export const RESEARCH_OS_SCHEMA_STATEMENTS = Object.freeze([
  `CREATE TABLE IF NOT EXISTS research_os_policy (
    policy_key TEXT PRIMARY KEY,
    policy_value JSONB NOT NULL,
    default_value JSONB NOT NULL,
    description TEXT,
    bounds JSONB NOT NULL DEFAULT '{}'::jsonb,
    status TEXT NOT NULL DEFAULT 'active',
    updated_by TEXT NOT NULL DEFAULT 'system',
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `CREATE TABLE IF NOT EXISTS research_os_policy_proposals (
    id BIGSERIAL PRIMARY KEY,
    policy_key TEXT NOT NULL,
    current_value JSONB NOT NULL,
    proposed_value JSONB NOT NULL,
    reason TEXT NOT NULL,
    expected_effect JSONB NOT NULL DEFAULT '{}'::jsonb,
    risk_summary TEXT,
    shadow_result JSONB NOT NULL DEFAULT '{}'::jsonb,
    rollback_rule JSONB NOT NULL DEFAULT '{}'::jsonb,
    status TEXT NOT NULL DEFAULT 'pending',
    created_by TEXT NOT NULL DEFAULT 'policy-advisor',
    reviewed_by TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    reviewed_at TIMESTAMPTZ
  )`,
  `CREATE TABLE IF NOT EXISTS research_questions (
    id BIGSERIAL PRIMARY KEY,
    deterministic_id TEXT,
    question_type TEXT NOT NULL,
    themes TEXT[] NOT NULL DEFAULT '{}'::text[],
    seed_terms TEXT[] NOT NULL DEFAULT '{}'::text[],
    prompt TEXT NOT NULL,
    trigger_reason TEXT,
    novelty_score DOUBLE PRECISION,
    heat_score DOUBLE PRECISION,
    gap_score DOUBLE PRECISION,
    priority_score DOUBLE PRECISION,
    status TEXT NOT NULL DEFAULT 'new',
    run_count INT NOT NULL DEFAULT 0,
    last_run_at TIMESTAMPTZ,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `CREATE INDEX IF NOT EXISTS idx_research_questions_status_priority
    ON research_questions(status, priority_score DESC NULLS LAST, created_at DESC)`,
  `ALTER TABLE research_questions
    ADD COLUMN IF NOT EXISTS deterministic_id TEXT`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_research_questions_deterministic
    ON research_questions(deterministic_id)
    WHERE deterministic_id IS NOT NULL`,
  `CREATE TABLE IF NOT EXISTS incoming_research_signals (
    id BIGSERIAL PRIMARY KEY,
    deterministic_id TEXT,
    signal_type TEXT NOT NULL,
    label TEXT NOT NULL,
    normalized_key TEXT NOT NULL,
    source_types TEXT[] NOT NULL DEFAULT '{}'::text[],
    source_count INT NOT NULL DEFAULT 0,
    observation_count INT NOT NULL DEFAULT 0,
    evidence_refs JSONB NOT NULL DEFAULT '[]'::jsonb,
    linked_themes TEXT[] NOT NULL DEFAULT '{}'::text[],
    novelty_score DOUBLE PRECISION NOT NULL DEFAULT 0,
    source_divergence_score DOUBLE PRECISION NOT NULL DEFAULT 0,
    cross_source_score DOUBLE PRECISION NOT NULL DEFAULT 0,
    priority_score DOUBLE PRECISION NOT NULL DEFAULT 0,
    seed_similarity DOUBLE PRECISION NOT NULL DEFAULT 0,
    graph_distance_summary JSONB NOT NULL DEFAULT '{}'::jsonb,
    status TEXT NOT NULL DEFAULT 'new',
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    first_seen TIMESTAMPTZ,
    last_seen TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `ALTER TABLE incoming_research_signals
    ADD COLUMN IF NOT EXISTS deterministic_id TEXT`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_incoming_research_signals_deterministic
    ON incoming_research_signals(deterministic_id)
    WHERE deterministic_id IS NOT NULL`,
  `CREATE INDEX IF NOT EXISTS idx_incoming_research_signals_status_priority
    ON incoming_research_signals(status, priority_score DESC NULLS LAST, updated_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_incoming_research_signals_key
    ON incoming_research_signals(normalized_key, status, updated_at DESC)`,
  `CREATE TABLE IF NOT EXISTS knowledge_nodes (
    id BIGSERIAL PRIMARY KEY,
    node_type TEXT NOT NULL,
    canonical_name TEXT NOT NULL,
    normalized_key TEXT NOT NULL,
    aliases TEXT[] NOT NULL DEFAULT '{}'::text[],
    status TEXT NOT NULL DEFAULT 'candidate',
    created_by TEXT NOT NULL DEFAULT 'system',
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(node_type, normalized_key)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_knowledge_nodes_type_status
    ON knowledge_nodes(node_type, status, updated_at DESC)`,
  `CREATE TABLE IF NOT EXISTS knowledge_edges (
    id BIGSERIAL PRIMARY KEY,
    source_node_id BIGINT NOT NULL REFERENCES knowledge_nodes(id),
    target_node_id BIGINT NOT NULL REFERENCES knowledge_nodes(id),
    relation_type TEXT NOT NULL,
    confidence DOUBLE PRECISION NOT NULL DEFAULT 0,
    evidence_count INT NOT NULL DEFAULT 0,
    source_diversity INT NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'candidate',
    created_by TEXT NOT NULL DEFAULT 'system',
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(source_node_id, target_node_id, relation_type)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_knowledge_edges_source
    ON knowledge_edges(source_node_id, status, relation_type)`,
  `CREATE INDEX IF NOT EXISTS idx_knowledge_edges_target
    ON knowledge_edges(target_node_id, status, relation_type)`,
  `CREATE TABLE IF NOT EXISTS knowledge_edge_evidence (
    id BIGSERIAL PRIMARY KEY,
    edge_id BIGINT NOT NULL REFERENCES knowledge_edges(id) ON DELETE CASCADE,
    source_type TEXT NOT NULL,
    source_id TEXT NOT NULL,
    quote TEXT,
    evidence_strength TEXT NOT NULL DEFAULT 'weak',
    url TEXT,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(edge_id, source_type, source_id)
  )`,
  `CREATE TABLE IF NOT EXISTS research_evidence_bundles (
    id BIGSERIAL PRIMARY KEY,
    question_id BIGINT NOT NULL REFERENCES research_questions(id),
    source_type TEXT NOT NULL,
    source_id TEXT NOT NULL,
    title TEXT,
    text_excerpt TEXT,
    url TEXT,
    published_at TIMESTAMPTZ,
    relevance_score DOUBLE PRECISION,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(question_id, source_type, source_id)
  )`,
  `CREATE TABLE IF NOT EXISTS cross_theme_candidates (
    id BIGSERIAL PRIMARY KEY,
    deterministic_id TEXT,
    themes TEXT[] NOT NULL,
    connector_node_id BIGINT REFERENCES knowledge_nodes(id),
    supplier_node_id BIGINT REFERENCES knowledge_nodes(id),
    score DOUBLE PRECISION,
    lane TEXT NOT NULL DEFAULT 'exploration',
    status TEXT NOT NULL DEFAULT 'new',
    reason TEXT,
    evidence_summary JSONB NOT NULL DEFAULT '{}'::jsonb,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
  `CREATE INDEX IF NOT EXISTS idx_cross_theme_candidates_status_score
    ON cross_theme_candidates(status, score DESC NULLS LAST, updated_at DESC)`,
  `ALTER TABLE cross_theme_candidates
    ADD COLUMN IF NOT EXISTS deterministic_id TEXT`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_cross_theme_candidates_deterministic
    ON cross_theme_candidates(deterministic_id)
    WHERE deterministic_id IS NOT NULL`,
  `CREATE TABLE IF NOT EXISTS adjacency_feedback (
    id BIGSERIAL PRIMARY KEY,
    candidate_id BIGINT REFERENCES cross_theme_candidates(id),
    decision TEXT NOT NULL,
    relation_override TEXT,
    priority TEXT,
    evidence_quality TEXT,
    reason TEXT,
    user_id TEXT NOT NULL DEFAULT 'default',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`,
]);

export const RESEARCH_OS_ALLOWED_WRITE_TABLES = Object.freeze([
  'research_os_policy',
  'research_os_policy_proposals',
  'research_questions',
  'incoming_research_signals',
  'knowledge_nodes',
  'knowledge_edges',
  'knowledge_edge_evidence',
  'research_evidence_bundles',
  'cross_theme_candidates',
  'adjacency_feedback',
]);

export const RESEARCH_OS_FORBIDDEN_AUTO_WRITE_TABLES = Object.freeze([
  'discovery_topics',
  'auto_article_themes',
  'auto_theme_symbols',
  'model_predictions',
  'model_eval',
  'labeled_outcomes',
  'theme_trend_aggregates',
]);

export const REVIEW_LOCKED_CANDIDATE_STATUSES = Object.freeze([
  'accepted',
  'rejected',
  'trusted',
  'watch',
  'archived',
]);

export function isReviewLockedCandidateStatus(status) {
  return REVIEW_LOCKED_CANDIDATE_STATUSES.includes(String(status || '').toLowerCase());
}

export function normalizeKnowledgeKey(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function stableResearchOsId(parts) {
  return createHash('sha1').update((parts || []).join('|')).digest('hex').slice(0, 16);
}

function uniqueStrings(values) {
  const seen = new Set();
  const out = [];
  for (const value of values || []) {
    const text = String(value || '').trim();
    if (!text) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(text);
  }
  return out;
}

export function buildThemeTaxonomyGraphSeed(themeTaxonomy = THEME_TAXONOMY, entitySeeds = THEME_ENTITY_SEEDS) {
  const nodes = [];
  const edges = [];
  const nodeKey = new Map();

  function addNode(nodeType, canonicalName, aliases = [], metadata = {}) {
    const normalizedKey = normalizeKnowledgeKey(canonicalName);
    const key = `${nodeType}:${normalizedKey}`;
    if (!normalizedKey) return null;
    if (!nodeKey.has(key)) {
      const node = {
        id: key,
        nodeType,
        canonicalName,
        normalizedKey,
        aliases: uniqueStrings([canonicalName, ...aliases]),
        status: 'candidate',
        createdBy: 'seed',
        metadata,
      };
      nodeKey.set(key, node);
      nodes.push(node);
    } else {
      const existing = nodeKey.get(key);
      existing.aliases = uniqueStrings([...(existing.aliases || []), canonicalName, ...aliases]);
      existing.metadata = {
        ...(existing.metadata || {}),
        ...metadata,
        sourceThemes: uniqueStrings([
          ...((existing.metadata || {}).sourceThemes || []),
          (existing.metadata || {}).sourceTheme,
          metadata.sourceTheme,
        ]),
        discoveryImportance: Math.max(Number((existing.metadata || {}).discoveryImportance || 0), Number(metadata.discoveryImportance || 0)) || undefined,
        constraintScore: Math.max(Number((existing.metadata || {}).constraintScore || 0), Number(metadata.constraintScore || 0)) || undefined,
        geopoliticalRelevance: Math.max(Number((existing.metadata || {}).geopoliticalRelevance || 0), Number(metadata.geopoliticalRelevance || 0)) || undefined,
        technicalMaturity: Math.max(Number((existing.metadata || {}).technicalMaturity || 0), Number(metadata.technicalMaturity || 0)) || undefined,
      };
    }
    return nodeKey.get(key);
  }

  function addEdge(source, target, relationType, metadata = {}) {
    if (!source || !target) return;
    const confidence = Number(metadata.confidence);
    const evidenceCount = Number(metadata.evidenceCount ?? metadata.evidence_count);
    const sourceDiversity = Number(metadata.sourceDiversity ?? metadata.source_diversity);
    edges.push({
      id: stableResearchOsId([source.id, relationType, target.id]),
      sourceId: source.id,
      targetId: target.id,
      relationType,
      confidence: Number.isFinite(confidence) ? confidence : 0.5,
      evidenceCount: Number.isFinite(evidenceCount) ? evidenceCount : 0,
      sourceDiversity: Number.isFinite(sourceDiversity) ? sourceDiversity : 0,
      status: 'candidate',
      createdBy: 'seed',
      metadata,
    });
  }

  for (const [themeKey, config] of Object.entries(themeTaxonomy || {})) {
    const theme = addNode('theme', themeKey, [config.label, ...(config.keywords || [])], {
      label: config.label,
      category: config.category,
      parentTheme: config.parentTheme,
      lifecycleHint: config.lifecycleHint,
    });
    if (config.parentTheme) {
      const parent = addNode('theme', config.parentTheme, [], { relation: 'taxonomy-parent' });
      addEdge(theme, parent, 'adjacent_to', { reason: 'taxonomy parent' });
    }
    for (const keyword of config.keywords || []) {
      const keywordNode = addNode('technology', keyword, [], { sourceTheme: themeKey });
      addEdge(theme, keywordNode, 'uses', { reason: 'taxonomy keyword' });
    }
    for (const entry of discoveryEntriesForTheme({
      themeId: themeKey,
      theme: themeKey,
      label: config.label,
      parentTheme: config.parentTheme,
      category: config.category,
    })) {
      const discoveryNode = addNode(entry.nodeType, entry.name, entry.aliases, {
        source: 'theme-ontology-discovery',
        sourceTheme: themeKey,
        ontologyKey: entry.ontologyKey,
        ontologyLabel: entry.ontologyLabel,
        discoveryRole: entry.role,
        discoveryImportance: entry.importance,
        constraintScore: entry.constraintScore,
        geopoliticalRelevance: entry.geopoliticalRelevance,
        technicalMaturity: entry.technicalMaturity,
        mechanism: entry.mechanism,
        whyNow: entry.whyNow,
        triggerTerms: entry.triggerTerms,
        sourceQueries: entry.sourceQueries,
        symbol: entry.symbol || undefined,
      });
      addEdge(theme, discoveryNode, entry.relationType, {
        source: 'theme-ontology-discovery',
        reason: `${entry.ontologyLabel} discovery ${entry.role}`,
        role: entry.role,
        mechanism: entry.mechanism,
        whyNow: entry.whyNow,
        confidence: 0.45 + Math.min(0.25, entry.importance * 0.25),
        evidenceCount: 0,
        sourceDiversity: 0,
      });
    }
  }

  for (const [themeKey, entries] of Object.entries(entitySeeds || {})) {
    const theme = addNode('theme', themeKey, [], { source: 'theme-entity-seeds' });
    for (const entry of entries || []) {
      const company = addNode('company', entry.company || entry.symbol, [entry.symbol], {
        symbol: entry.symbol,
        relationType: entry.relationType,
      });
      const symbol = entry.symbol ? addNode('symbol', entry.symbol, [entry.company], {
        company: entry.company,
      }) : null;
      addEdge(theme, company, entry.relationType || 'exposed_to', { source: 'theme-entity-seeds' });
      if (symbol) addEdge(company, symbol, 'exposed_to', { source: 'theme-entity-seeds' });
    }
  }

  return { nodes, edges };
}

export async function ensureResearchOsSchema(queryable) {
  for (const statement of RESEARCH_OS_SCHEMA_STATEMENTS) {
    await queryable.query(statement);
  }
}

function toJson(value) {
  return JSON.stringify(value || {});
}

export async function upsertKnowledgeNode(queryable, node, options = {}) {
  if (!options.skipEnsure) await ensureResearchOsSchema(queryable);
  const normalizedKey = node.normalizedKey || normalizeKnowledgeKey(node.canonicalName);
  const { rows } = await queryable.query(
    `INSERT INTO knowledge_nodes (
       node_type, canonical_name, normalized_key, aliases, status, created_by, metadata
     ) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb)
     ON CONFLICT (node_type, normalized_key) DO UPDATE
       SET canonical_name = EXCLUDED.canonical_name,
           aliases = (
             SELECT ARRAY(
               SELECT DISTINCT value
               FROM unnest(knowledge_nodes.aliases || EXCLUDED.aliases) AS value
               WHERE value IS NOT NULL AND value <> ''
             )
           ),
           metadata = knowledge_nodes.metadata || EXCLUDED.metadata,
           updated_at = NOW()
     RETURNING id, node_type, canonical_name, normalized_key`,
    [
      node.nodeType || node.node_type,
      node.canonicalName || node.canonical_name,
      normalizedKey,
      node.aliases || [],
      node.status || 'candidate',
      node.createdBy || node.created_by || 'system',
      toJson(node.metadata),
    ],
  );
  return rows[0];
}

export async function upsertKnowledgeEdge(queryable, edge, nodeIdMap = new Map(), options = {}) {
  if (!options.skipEnsure) await ensureResearchOsSchema(queryable);
  const sourceNodeId = nodeIdMap.get(edge.sourceId) || edge.sourceNodeId || edge.source_node_id;
  const targetNodeId = nodeIdMap.get(edge.targetId) || edge.targetNodeId || edge.target_node_id;
  if (!sourceNodeId || !targetNodeId) {
    throw new Error(`[adjacency-graph] cannot upsert edge without resolved node ids: ${edge.sourceId} -> ${edge.targetId}`);
  }
  const { rows } = await queryable.query(
    `INSERT INTO knowledge_edges (
       source_node_id, target_node_id, relation_type, confidence, evidence_count,
       source_diversity, status, created_by, metadata
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)
     ON CONFLICT (source_node_id, target_node_id, relation_type) DO UPDATE
       SET confidence = GREATEST(knowledge_edges.confidence, EXCLUDED.confidence),
           evidence_count = GREATEST(knowledge_edges.evidence_count, EXCLUDED.evidence_count),
           source_diversity = GREATEST(knowledge_edges.source_diversity, EXCLUDED.source_diversity),
           metadata = knowledge_edges.metadata || EXCLUDED.metadata,
           updated_at = NOW()
     RETURNING id`,
    [
      sourceNodeId,
      targetNodeId,
      edge.relationType || edge.relation_type,
      Number(edge.confidence || 0),
      Number(edge.evidenceCount ?? edge.evidence_count ?? 0),
      Number(edge.sourceDiversity ?? edge.source_diversity ?? 0),
      edge.status || 'candidate',
      edge.createdBy || edge.created_by || 'system',
      toJson(edge.metadata),
    ],
  );
  return rows[0];
}

export async function upsertKnowledgeEdgeEvidence(queryable, evidence, options = {}) {
  if (!options.skipEnsure) await ensureResearchOsSchema(queryable);
  if (!evidence.edgeId && !evidence.edge_id) {
    throw new Error('[adjacency-graph] cannot upsert edge evidence without edgeId');
  }
  const { rows } = await queryable.query(
    `INSERT INTO knowledge_edge_evidence (
       edge_id, source_type, source_id, quote, evidence_strength, url, metadata
     ) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb)
     ON CONFLICT (edge_id, source_type, source_id) DO UPDATE
       SET quote = COALESCE(EXCLUDED.quote, knowledge_edge_evidence.quote),
           evidence_strength = EXCLUDED.evidence_strength,
           url = COALESCE(EXCLUDED.url, knowledge_edge_evidence.url),
           metadata = knowledge_edge_evidence.metadata || EXCLUDED.metadata
     RETURNING id`,
    [
      evidence.edgeId || evidence.edge_id,
      evidence.sourceType || evidence.source_type,
      String(evidence.sourceId || evidence.source_id),
      evidence.quote || null,
      evidence.evidenceStrength || evidence.evidence_strength || 'weak',
      evidence.url || null,
      toJson(evidence.metadata),
    ],
  );
  return rows[0];
}

export async function persistGraphSeed(queryable, graphSeed = buildThemeTaxonomyGraphSeed()) {
  await ensureResearchOsSchema(queryable);
  const nodeIdMap = new Map();
  const nodePayload = [...(graphSeed.nodes || []).reduce((acc, node) => {
    const payload = {
      memory_id: node.id,
      node_type: node.nodeType || node.node_type,
      canonical_name: node.canonicalName || node.canonical_name,
      normalized_key: node.normalizedKey || normalizeKnowledgeKey(node.canonicalName || node.canonical_name),
      aliases: node.aliases || [],
      status: node.status || 'candidate',
      created_by: node.createdBy || node.created_by || 'system',
      metadata: node.metadata || {},
    };
    const key = `${payload.node_type}:${payload.normalized_key}`;
    const previous = acc.get(key);
    if (previous) {
      previous.aliases = [...new Set([...(previous.aliases || []), ...(payload.aliases || [])])];
      previous.metadata = { ...(previous.metadata || {}), ...(payload.metadata || {}) };
    } else {
      acc.set(key, payload);
    }
    return acc;
  }, new Map()).values()];
  if (nodePayload.length) {
    const { rows } = await queryable.query(
      `WITH input AS (
         SELECT *
         FROM jsonb_to_recordset($1::jsonb) AS x(
           memory_id text,
           node_type text,
           canonical_name text,
           normalized_key text,
           aliases jsonb,
           status text,
           created_by text,
           metadata jsonb
         )
       ),
       upserted AS (
         INSERT INTO knowledge_nodes (
           node_type, canonical_name, normalized_key, aliases, status, created_by, metadata
         )
         SELECT node_type,
                canonical_name,
                normalized_key,
                ARRAY(SELECT jsonb_array_elements_text(COALESCE(aliases, '[]'::jsonb))),
                COALESCE(status, 'candidate'),
                COALESCE(created_by, 'system'),
                COALESCE(metadata, '{}'::jsonb)
           FROM input
         ON CONFLICT (node_type, normalized_key) DO UPDATE
           SET canonical_name = EXCLUDED.canonical_name,
               aliases = (
                 SELECT ARRAY(
                   SELECT DISTINCT value
                   FROM unnest(knowledge_nodes.aliases || EXCLUDED.aliases) AS value
                   WHERE value IS NOT NULL AND value <> ''
                 )
               ),
               metadata = knowledge_nodes.metadata || EXCLUDED.metadata,
               updated_at = NOW()
         RETURNING id, node_type, normalized_key
       )
       SELECT input.memory_id, input.node_type, input.normalized_key, upserted.id
         FROM input
         JOIN upserted
           ON upserted.node_type = input.node_type
          AND upserted.normalized_key = input.normalized_key`,
      [JSON.stringify(nodePayload)],
    );
    const dbIdByKey = new Map(rows.map((row) => [`${row.node_type}:${row.normalized_key}`, row.id]));
    for (const node of graphSeed.nodes || []) {
      const type = node.nodeType || node.node_type;
      const normalized = node.normalizedKey || normalizeKnowledgeKey(node.canonicalName || node.canonical_name);
      const id = dbIdByKey.get(`${type}:${normalized}`);
      if (id) nodeIdMap.set(node.id, id);
    }
  }
  let edgeCount = 0;
  const edgePayload = [...(graphSeed.edges || [])
    .map((edge) => ({
      source_node_id: nodeIdMap.get(edge.sourceId),
      target_node_id: nodeIdMap.get(edge.targetId),
      relation_type: edge.relationType || edge.relation_type,
      confidence: Number(edge.confidence || 0),
      evidence_count: Number(edge.evidenceCount ?? edge.evidence_count ?? 0),
      source_diversity: Number(edge.sourceDiversity ?? edge.source_diversity ?? 0),
      status: edge.status || 'candidate',
      created_by: edge.createdBy || edge.created_by || 'system',
      metadata: edge.metadata || {},
    }))
    .filter((edge) => edge.source_node_id && edge.target_node_id && edge.relation_type)
    .reduce((acc, edge) => {
      const key = `${edge.source_node_id}:${edge.target_node_id}:${edge.relation_type}`;
      const previous = acc.get(key);
      if (previous) {
        previous.confidence = Math.max(previous.confidence, edge.confidence);
        previous.evidence_count = Math.max(previous.evidence_count, edge.evidence_count);
        previous.source_diversity = Math.max(previous.source_diversity, edge.source_diversity);
        previous.metadata = { ...(previous.metadata || {}), ...(edge.metadata || {}) };
      } else {
        acc.set(key, edge);
      }
      return acc;
    }, new Map()).values()];
  if (edgePayload.length) {
    const result = await queryable.query(
      `WITH input AS (
         SELECT *
         FROM jsonb_to_recordset($1::jsonb) AS x(
           source_node_id bigint,
           target_node_id bigint,
           relation_type text,
           confidence double precision,
           evidence_count int,
           source_diversity int,
           status text,
           created_by text,
           metadata jsonb
         )
       )
       INSERT INTO knowledge_edges (
         source_node_id, target_node_id, relation_type, confidence, evidence_count,
         source_diversity, status, created_by, metadata
       )
       SELECT source_node_id,
              target_node_id,
              relation_type,
              COALESCE(confidence, 0),
              COALESCE(evidence_count, 0),
              COALESCE(source_diversity, 0),
              COALESCE(status, 'candidate'),
              COALESCE(created_by, 'system'),
              COALESCE(metadata, '{}'::jsonb)
         FROM input
       ON CONFLICT (source_node_id, target_node_id, relation_type) DO UPDATE
         SET confidence = GREATEST(knowledge_edges.confidence, EXCLUDED.confidence),
             evidence_count = GREATEST(knowledge_edges.evidence_count, EXCLUDED.evidence_count),
             source_diversity = GREATEST(knowledge_edges.source_diversity, EXCLUDED.source_diversity),
             metadata = knowledge_edges.metadata || EXCLUDED.metadata,
             updated_at = NOW()`,
      [JSON.stringify(edgePayload)],
    );
    edgeCount = result.rowCount || edgePayload.length;
  }
  return {
    ok: true,
    nodeCount: nodeIdMap.size,
    edgeCount,
  };
}

export async function loadKnowledgeGraph(queryable, options = {}) {
  await ensureResearchOsSchema(queryable);
  const nodeLimit = Math.max(1, Number(options.nodeLimit || 10000));
  const edgeLimit = Math.max(1, Number(options.edgeLimit || 20000));
  const nodeRows = await queryable.query(
    `SELECT id, node_type, canonical_name, normalized_key, aliases, status, created_by, metadata
       FROM knowledge_nodes
      WHERE status <> 'archived'
      ORDER BY updated_at DESC
      LIMIT $1`,
    [nodeLimit],
  );
  const edgeRows = await queryable.query(
    `SELECT id, source_node_id, target_node_id, relation_type, confidence,
            evidence_count, source_diversity, status, created_by, metadata
       FROM knowledge_edges
      WHERE status <> 'archived'
      ORDER BY updated_at DESC
      LIMIT $1`,
    [edgeLimit],
  );
  return {
    nodes: nodeRows.rows.map((row) => ({
      id: String(row.id),
      nodeType: row.node_type,
      canonicalName: row.canonical_name,
      normalizedKey: row.normalized_key,
      aliases: row.aliases || [],
      status: row.status,
      createdBy: row.created_by,
      metadata: row.metadata || {},
    })),
    edges: edgeRows.rows.map((row) => ({
      id: String(row.id),
      sourceId: String(row.source_node_id),
      targetId: String(row.target_node_id),
      relationType: row.relation_type,
      confidence: Number(row.confidence || 0),
      evidenceCount: Number(row.evidence_count || 0),
      sourceDiversity: Number(row.source_diversity || 0),
      status: row.status,
      createdBy: row.created_by,
      metadata: row.metadata || {},
    })),
  };
}

export async function upsertResearchQuestion(queryable, question, options = {}) {
  if (!options.skipEnsure) await ensureResearchOsSchema(queryable);
  const { rows } = await queryable.query(
    `INSERT INTO research_questions (
       deterministic_id, question_type, themes, seed_terms, prompt, trigger_reason, novelty_score,
       heat_score, gap_score, priority_score, status, metadata
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb)
     ON CONFLICT (deterministic_id) WHERE deterministic_id IS NOT NULL DO NOTHING
     RETURNING id`,
    [
      question.id || null,
      question.questionType || question.question_type,
      question.themes || [],
      question.seedTerms || question.seed_terms || [],
      question.prompt,
      question.triggerReason || question.trigger_reason || '',
      Number(question.noveltyScore ?? question.novelty_score ?? 0),
      Number(question.heatScore ?? question.heat_score ?? 0),
      Number(question.gapScore ?? question.gap_score ?? 0),
      Number(question.priorityScore ?? question.priority_score ?? 0),
      question.status || 'new',
      toJson({ ...(question.metadata || {}), deterministicId: question.id || null }),
    ],
  );
  return rows[0] || null;
}

export async function upsertIncomingResearchSignal(queryable, signal, options = {}) {
  if (!options.skipEnsure) await ensureResearchOsSchema(queryable);
  const deterministicId = signal.id || signal.deterministicId || stableResearchOsId([
    'incoming-signal',
    signal.signalType || signal.signal_type,
    signal.normalizedKey || signal.normalized_key || normalizeKnowledgeKey(signal.label),
  ]);
  const normalizedKey = signal.normalizedKey || signal.normalized_key || normalizeKnowledgeKey(signal.label);
  const { rows } = await queryable.query(
    `INSERT INTO incoming_research_signals (
       deterministic_id, signal_type, label, normalized_key, source_types, source_count,
       observation_count, evidence_refs, linked_themes, novelty_score, source_divergence_score,
       cross_source_score, priority_score, seed_similarity, graph_distance_summary,
       status, metadata, first_seen, last_seen
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,$11,$12,$13,$14,$15::jsonb,$16,$17::jsonb,$18,$19)
     ON CONFLICT (deterministic_id) WHERE deterministic_id IS NOT NULL DO UPDATE
       SET source_types = EXCLUDED.source_types,
           source_count = EXCLUDED.source_count,
           observation_count = EXCLUDED.observation_count,
           evidence_refs = EXCLUDED.evidence_refs,
           linked_themes = EXCLUDED.linked_themes,
           novelty_score = EXCLUDED.novelty_score,
           source_divergence_score = EXCLUDED.source_divergence_score,
           cross_source_score = EXCLUDED.cross_source_score,
           priority_score = EXCLUDED.priority_score,
           seed_similarity = EXCLUDED.seed_similarity,
           graph_distance_summary = EXCLUDED.graph_distance_summary,
           status = CASE
             WHEN incoming_research_signals.status IN ('suppressed','archived') THEN incoming_research_signals.status
             ELSE EXCLUDED.status
           END,
           metadata = incoming_research_signals.metadata || EXCLUDED.metadata,
           first_seen = LEAST(COALESCE(incoming_research_signals.first_seen, EXCLUDED.first_seen), COALESCE(EXCLUDED.first_seen, incoming_research_signals.first_seen)),
           last_seen = GREATEST(COALESCE(incoming_research_signals.last_seen, EXCLUDED.last_seen), COALESCE(EXCLUDED.last_seen, incoming_research_signals.last_seen)),
           updated_at = NOW()
     RETURNING id, deterministic_id, status`,
    [
      deterministicId,
      signal.signalType || signal.signal_type,
      signal.label,
      normalizedKey,
      signal.sourceTypes || signal.source_types || [],
      Number(signal.sourceCount ?? signal.source_count ?? 0),
      Number(signal.observationCount ?? signal.observation_count ?? 0),
      toJson(signal.evidenceRefs || signal.evidence_refs || []),
      signal.linkedThemes || signal.linked_themes || [],
      Number(signal.noveltyScore ?? signal.novelty_score ?? 0),
      Number(signal.sourceDivergenceScore ?? signal.source_divergence_score ?? 0),
      Number(signal.crossSourceScore ?? signal.cross_source_score ?? 0),
      Number(signal.priorityScore ?? signal.priority_score ?? 0),
      Number(signal.seedSimilarity ?? signal.seed_similarity ?? 0),
      toJson(signal.graphDistanceSummary || signal.graph_distance_summary || {}),
      signal.status || 'new',
      toJson({ ...(signal.metadata || {}), deterministicId }),
      signal.firstSeen || signal.first_seen || null,
      signal.lastSeen || signal.last_seen || null,
    ],
  );
  return rows[0] || null;
}

export async function upsertCrossThemeCandidate(queryable, candidate, nodeIdMap = new Map(), options = {}) {
  if (!options.skipEnsure) await ensureResearchOsSchema(queryable);
  const connectorNodeId = candidate.connectorNodeId ? nodeIdMap.get(candidate.connectorNodeId) || candidate.connectorNodeId : null;
  const supplierNodeId = candidate.supplierNodeId ? nodeIdMap.get(candidate.supplierNodeId) || candidate.supplierNodeId : null;
  const { rows } = await queryable.query(
    `INSERT INTO cross_theme_candidates (
       deterministic_id, themes, connector_node_id, supplier_node_id, score, lane, status, reason,
       evidence_summary, metadata
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10::jsonb)
     ON CONFLICT (deterministic_id) WHERE deterministic_id IS NOT NULL DO UPDATE
       SET score = EXCLUDED.score,
           lane = CASE
             WHEN cross_theme_candidates.status IN ('accepted','rejected','trusted','watch','archived') THEN cross_theme_candidates.lane
             ELSE EXCLUDED.lane
           END,
           status = CASE
             WHEN cross_theme_candidates.status IN ('accepted','rejected','trusted','watch','archived') THEN cross_theme_candidates.status
             ELSE EXCLUDED.status
           END,
           reason = EXCLUDED.reason,
           evidence_summary = EXCLUDED.evidence_summary,
           metadata = (
             CASE
               WHEN EXCLUDED.status = 'research_backlog'
                 THEN cross_theme_candidates.metadata - 'archivedBy' - 'archivedReason'
               WHEN EXCLUDED.status <> 'research_backlog'
                 THEN cross_theme_candidates.metadata - 'archivedBy' - 'archivedReason' - 'backlogReason'
               ELSE cross_theme_candidates.metadata
             END
           ) || EXCLUDED.metadata || (
             CASE
               WHEN cross_theme_candidates.status IN ('accepted','rejected','trusted','watch','archived')
                 THEN jsonb_build_object(
                   'reviewStatePreserved', true,
                   'preservedStatus', cross_theme_candidates.status
                 )
               ELSE '{}'::jsonb
             END
           ),
           updated_at = NOW()
     RETURNING id`,
    [
      candidate.id || null,
      candidate.themes || [],
      connectorNodeId,
      supplierNodeId,
      Number(candidate.score || 0),
      candidate.lane || 'exploration',
      candidate.status || 'new',
      candidate.reason || '',
      toJson(candidate.evidenceSummary),
      toJson({ ...(candidate.metadata || {}), deterministicId: candidate.id || null }),
    ],
  );
  return rows[0];
}

export async function buildResearchOsDataPathAudit(queryable) {
  await ensureResearchOsSchema(queryable);
  const tableList = RESEARCH_OS_ALLOWED_WRITE_TABLES.map((table) => `'${table}'::regclass`).join(',');
  const triggerRows = await queryable.query(
    `SELECT tgname, tgrelid::regclass::text AS table_name
       FROM pg_trigger
      WHERE NOT tgisinternal
        AND tgrelid IN (${tableList})
      ORDER BY table_name, tgname`,
  );
  const constraintRows = await queryable.query(
    `SELECT conname,
            conrelid::regclass::text AS source_table,
            confrelid::regclass::text AS target_table
       FROM pg_constraint
      WHERE contype = 'f'
        AND (
          conrelid IN (${tableList})
          OR confrelid IN (${tableList})
        )
      ORDER BY source_table, target_table, conname`,
  );
  const allowedFkPairs = new Set([
    'knowledge_edges->knowledge_nodes',
    'knowledge_edge_evidence->knowledge_edges',
    'research_evidence_bundles->research_questions',
    'cross_theme_candidates->knowledge_nodes',
    'adjacency_feedback->cross_theme_candidates',
  ]);
  const unexpectedForeignKeys = constraintRows.rows.filter((row) => {
    const pair = `${row.source_table}->${row.target_table}`;
    return !allowedFkPairs.has(pair);
  });
  return {
    ok: triggerRows.rows.length === 0 && unexpectedForeignKeys.length === 0,
    allowedWriteTables: [...RESEARCH_OS_ALLOWED_WRITE_TABLES],
    forbiddenAutoWriteTables: [...RESEARCH_OS_FORBIDDEN_AUTO_WRITE_TABLES],
    triggers: triggerRows.rows,
    foreignKeys: constraintRows.rows,
    unexpectedForeignKeys,
    note: 'Research OS candidate/private tables must not auto-promote into canonical/model tables.',
  };
}
