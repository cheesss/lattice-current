import {
  filterIssuerSymbols,
  ontologyKpiDefinitionsForTheme,
} from './theme-ontology.mjs';

/*
 * Generic Theme -> KPI collection spine.
 *
 * This module deliberately avoids per-theme hardcoding such as
 * "cloud-infrastructure needs MW capacity". It creates a reusable ontology
 * of KPI archetypes, maps each theme to relevant archetypes from category and
 * observed context, materializes best-effort observations from existing DB
 * tables, and turns missing observations into collection jobs.
 */

function asArray(value) { return Array.isArray(value) ? value : []; }

function unique(items) {
  return [...new Set(asArray(items).filter(Boolean))];
}

function compactText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function slugify(value) {
  return compactText(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 90) || 'unknown';
}

function normalizeKpiKey(value) {
  return compactText(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 90) || 'unknown_kpi';
}

function num(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function int(value, fallback = 0) {
  const parsed = Math.floor(Number(value));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function iso(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

async function one(client, sql, params = []) {
  const result = await client.query(sql, params);
  return result.rows[0] || null;
}

async function many(client, sql, params = []) {
  const result = await client.query(sql, params);
  return result.rows;
}

async function tableExists(client, tableName) {
  if (!client || !tableName) return false;
  const row = await one(client, `
    SELECT EXISTS (
      SELECT 1
      FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = $1
    ) AS exists
  `, [tableName]).catch(() => null);
  return row?.exists === true;
}

async function safeRows(client, tableName, sql, params = []) {
  if (!await tableExists(client, tableName)) return [];
  return many(client, sql, params).catch(() => []);
}

const CORE_KPI_DEFINITIONS = Object.freeze([
  {
    kpiKey: 'attention_volume',
    displayName: 'Theme attention volume',
    dataPack: 'industryPack',
    unit: 'articles',
    leadingOrLagging: 'leading',
    sourceTypes: ['theme_trend_aggregates', 'articles'],
    freshnessSlaHours: 48,
    priority: 95,
    definitionText: 'Current observed attention volume for the theme, normalized as a KPI observation.',
  },
  {
    kpiKey: 'source_diversity',
    displayName: 'Independent source breadth',
    dataPack: 'industryPack',
    unit: 'score',
    leadingOrLagging: 'quality',
    sourceTypes: ['theme_trend_aggregates', 'articles'],
    freshnessSlaHours: 72,
    priority: 90,
    definitionText: 'How broad the source base is for this theme, so single-source spikes do not masquerade as structural evidence.',
  },
  {
    kpiKey: 'lifecycle_confidence',
    displayName: 'Lifecycle confidence',
    dataPack: 'industryPack',
    unit: 'score',
    leadingOrLagging: 'quality',
    sourceTypes: ['theme_trend_aggregates'],
    freshnessSlaHours: 168,
    priority: 75,
    definitionText: 'Confidence attached to the current lifecycle classification.',
  },
  {
    kpiKey: 'market_reaction_strength',
    displayName: 'Market reaction strength',
    dataPack: 'marketPack',
    unit: 'pct',
    leadingOrLagging: 'lagging',
    sourceTypes: ['regime_conditional_impact', 'market_returns'],
    freshnessSlaHours: 168,
    priority: 80,
    definitionText: 'Observed market sensitivity or reaction strength tied to the theme.',
  },
  {
    kpiKey: 'peer_exposure_count',
    displayName: 'Mapped peer exposure count',
    dataPack: 'fundamentalPack',
    unit: 'entities',
    leadingOrLagging: 'context',
    sourceTypes: ['theme_entity_exposure', 'stock_sensitivity_matrix'],
    freshnessSlaHours: 720,
    priority: 70,
    definitionText: 'Number of known companies, ETFs, or tradable exposures mapped to the theme.',
  },
  {
    kpiKey: 'filing_activity',
    displayName: 'Filing activity',
    dataPack: 'filingPack',
    unit: 'filings',
    leadingOrLagging: 'context',
    sourceTypes: ['sec_filings_evidence'],
    freshnessSlaHours: 720,
    priority: 70,
    definitionText: 'Recent SEC filing evidence attached to mapped entities.',
  },
  {
    kpiKey: 'research_velocity',
    displayName: 'Research and code velocity',
    dataPack: 'researchPack',
    unit: 'items',
    leadingOrLagging: 'leading',
    sourceTypes: ['openalex_theme_evidence', 'theme_github_evidence', 'research_evidence_bundles'],
    freshnessSlaHours: 720,
    priority: 75,
    definitionText: 'Observed research-paper, technical evidence, or code activity attached to the theme.',
  },
  {
    kpiKey: 'policy_activity',
    displayName: 'Policy and regulatory activity',
    dataPack: 'policyPack',
    unit: 'items',
    leadingOrLagging: 'leading',
    sourceTypes: ['policy_evidence', 'daily_curated_news'],
    freshnessSlaHours: 720,
    priority: 65,
    definitionText: 'Policy, regulation, subsidy, sanction, procurement, or public-sector activity related to the theme.',
  },
  {
    kpiKey: 'historical_memory_coverage',
    displayName: 'Historical memory coverage',
    dataPack: 'historicalAnalogPack',
    unit: 'windows',
    leadingOrLagging: 'context',
    sourceTypes: ['theme_trend_aggregates', 'historical_analog_cases'],
    freshnessSlaHours: 2160,
    priority: 60,
    definitionText: 'How much comparable same-theme history exists before the system tries a historical analogue.',
  },
  {
    kpiKey: 'feedback_signal_count',
    displayName: 'Feedback signal count',
    dataPack: 'feedbackPack',
    unit: 'items',
    leadingOrLagging: 'quality',
    sourceTypes: ['report_feedback', 'adjacency_feedback'],
    freshnessSlaHours: 2160,
    priority: 45,
    definitionText: 'Human feedback available to shape future scoring and report phrasing.',
  },
]);

const ACTIVE_JOB_STATUSES = Object.freeze(['pending', 'retry_wait', 'queued_review', 'approved', 'running']);

const ARCHETYPE_RULES = Object.freeze([
  {
    ruleKey: 'technical_or_infrastructure',
    pattern: /technology|tech|ai|machine|cloud|infrastructure|semiconductor|compute|computing|software|robot|automation|space|satellite|quantum|cyber/i,
    definitions: [
      {
        kpiKey: 'technical_maturity_proxy',
        displayName: 'Technical maturity proxy',
        dataPack: 'researchPack',
        unit: 'items',
        leadingOrLagging: 'leading',
        sourceTypes: ['openalex_theme_evidence', 'theme_github_evidence', 'patent_research_evidence'],
        freshnessSlaHours: 720,
        priority: 75,
        definitionText: 'Technical maturity evidence from papers, repositories, patents, or technical source bundles.',
      },
      {
        kpiKey: 'capacity_buildout_proxy',
        displayName: 'Capacity buildout proxy',
        dataPack: 'industryPack',
        unit: 'items',
        leadingOrLagging: 'leading',
        sourceTypes: ['daily_curated_news', 'sec_companyfacts_facts', 'articles'],
        freshnessSlaHours: 720,
        priority: 80,
        definitionText: 'Generic buildout/capacity/supply-demand proxy. The exact physical unit is source-specific and not hardcoded per theme.',
      },
      {
        kpiKey: 'capex_intensity_proxy',
        displayName: 'Capex intensity proxy',
        dataPack: 'fundamentalPack',
        unit: 'facts',
        leadingOrLagging: 'lagging',
        sourceTypes: ['sec_companyfacts_facts', 'sec_filings_evidence'],
        freshnessSlaHours: 2160,
        priority: 70,
        definitionText: 'Capital-expenditure or PP&E evidence for mapped entities.',
      },
    ],
  },
  {
    ruleKey: 'geopolitics_defense_supply',
    pattern: /geopolitic|defense|industrial|conflict|sanction|supply|security|trade|shipping|logistics|corridor|diplomacy/i,
    definitions: [
      {
        kpiKey: 'procurement_policy_pressure',
        displayName: 'Procurement and policy pressure',
        dataPack: 'policyPack',
        unit: 'items',
        leadingOrLagging: 'leading',
        sourceTypes: ['daily_curated_news', 'policy_evidence', 'approval_queue'],
        freshnessSlaHours: 720,
        priority: 80,
        definitionText: 'Public-sector procurement, contract, sanction, rule, or policy pressure attached to the theme.',
      },
      {
        kpiKey: 'logistics_capacity_proxy',
        displayName: 'Logistics and capacity pressure proxy',
        dataPack: 'industryPack',
        unit: 'items',
        leadingOrLagging: 'leading',
        sourceTypes: ['articles', 'daily_curated_news'],
        freshnessSlaHours: 336,
        priority: 75,
        definitionText: 'Generic logistics, bottleneck, inventory, backlog, delivery, or capacity pressure proxy.',
      },
    ],
  },
  {
    ruleKey: 'science_health',
    pattern: /science|bio|biotech|health|medical|drug|pharma|clinical|fda|research/i,
    definitions: [
      {
        kpiKey: 'trial_regulatory_milestone',
        displayName: 'Trial or regulatory milestone proxy',
        dataPack: 'industryPack',
        unit: 'items',
        leadingOrLagging: 'leading',
        sourceTypes: ['articles', 'daily_curated_news', 'policy_evidence'],
        freshnessSlaHours: 720,
        priority: 80,
        definitionText: 'Trial, approval, safety, regulator, or medical milestone evidence attached to the theme.',
      },
    ],
  },
  {
    ruleKey: 'energy_environment_resources',
    pattern: /energy|clean|climate|environment|resource|oil|gas|mineral|commodity|scarcity|electric|power|grid|water/i,
    definitions: [
      {
        kpiKey: 'commodity_supply_demand_proxy',
        displayName: 'Commodity supply-demand proxy',
        dataPack: 'industryPack',
        unit: 'items',
        leadingOrLagging: 'leading',
        sourceTypes: ['articles', 'daily_curated_news', 'market_quotes'],
        freshnessSlaHours: 336,
        priority: 80,
        definitionText: 'Commodity, resource, capacity, shortage, demand, or supply evidence attached to the theme.',
      },
      {
        kpiKey: 'policy_subsidy_activity',
        displayName: 'Policy and subsidy activity',
        dataPack: 'policyPack',
        unit: 'items',
        leadingOrLagging: 'leading',
        sourceTypes: ['policy_evidence', 'daily_curated_news'],
        freshnessSlaHours: 720,
        priority: 70,
        definitionText: 'Subsidy, permitting, regulation, or public investment evidence attached to the theme.',
      },
    ],
  },
  {
    ruleKey: 'macro_financial',
    pattern: /macro|monetary|fiscal|inflation|rates|credit|currency|fx|economy|globalization|trade/i,
    definitions: [
      {
        kpiKey: 'macro_regime_indicator',
        displayName: 'Macro regime indicator',
        dataPack: 'marketPack',
        unit: 'score',
        leadingOrLagging: 'context',
        sourceTypes: ['signal_history', 'regime_conditional_impact', 'fred_observations'],
        freshnessSlaHours: 168,
        priority: 80,
        definitionText: 'Macro, rate, commodity, FX, or regime data that contextualizes the theme.',
      },
    ],
  },
]);

function normalizeDefinition(definition = {}) {
  const queryTerms = unique(definition.queryTerms || definition.metadata?.queryTerms);
  return {
    kpiKey: normalizeKpiKey(definition.kpiKey || definition.key),
    displayName: compactText(definition.displayName || definition.name || definition.kpiKey),
    dataPack: compactText(definition.dataPack || 'industryPack'),
    unit: compactText(definition.unit || 'items'),
    leadingOrLagging: compactText(definition.leadingOrLagging || 'context'),
    sourceTypes: unique(definition.sourceTypes || ['manual_or_adapter']),
    freshnessSlaHours: Math.max(1, int(definition.freshnessSlaHours, 720)),
    priority: Math.max(1, Math.min(100, int(definition.priority, 50))),
    definitionText: compactText(definition.definitionText || definition.displayName || definition.kpiKey),
    metadata: {
      ...(definition.metadata || {}),
      ...(queryTerms.length ? { queryTerms } : {}),
    },
  };
}

function themeText(theme = {}) {
  return [
    theme.themeId,
    theme.theme,
    theme.themeLabel,
    theme.label,
    theme.parentTheme,
    theme.parent_theme,
    theme.category,
    theme.metadata?.category,
    theme.metadata?.parentTheme,
  ].map(compactText).filter(Boolean).join(' ');
}

export function inferKpiDefinitionsForTheme(theme = {}) {
  const text = themeText(theme);
  const defs = [
    ...CORE_KPI_DEFINITIONS,
    ...ontologyKpiDefinitionsForTheme(theme),
  ];
  for (const rule of ARCHETYPE_RULES) {
    if (rule.pattern.test(text)) defs.push(...rule.definitions.map((definition) => ({
      ...definition,
      metadata: { ...(definition.metadata || {}), archetypeRule: rule.ruleKey },
    })));
  }
  const byKey = new Map();
  for (const def of defs.map(normalizeDefinition)) {
    const existing = byKey.get(def.kpiKey);
    if (!existing || def.priority > existing.priority) byKey.set(def.kpiKey, def);
  }
  return [...byKey.values()].sort((a, b) => b.priority - a.priority || a.kpiKey.localeCompare(b.kpiKey));
}

export function buildKpiCollectionQuery({ themeId, themeLabel, definition, sourceType } = {}) {
  const label = compactText(themeLabel || themeId || 'theme');
  const source = compactText(sourceType || asArray(definition?.sourceTypes)[0] || 'evidence');
  const kpi = compactText(definition?.displayName || definition?.kpiKey || 'KPI');
  const queryTerms = unique(definition?.queryTerms || definition?.metadata?.queryTerms);
  return `${label} ${kpi} ${source} ${queryTerms.join(' ')} evidence`.replace(/\s+/g, ' ').trim();
}

export async function ensureGenericKpiSchema(client) {
  if (!client) return { ok: false, reason: 'no db client' };
  await client.query(`
    CREATE TABLE IF NOT EXISTS kpi_definition_registry (
      kpi_key TEXT PRIMARY KEY,
      display_name TEXT NOT NULL,
      data_pack TEXT NOT NULL,
      unit TEXT,
      theme_scope TEXT NOT NULL DEFAULT 'any',
      leading_or_lagging TEXT NOT NULL DEFAULT 'context',
      source_types JSONB NOT NULL DEFAULT '[]'::jsonb,
      freshness_sla_hours INTEGER NOT NULL DEFAULT 720,
      definition_text TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      created_by TEXT NOT NULL DEFAULT 'generic-kpi-collection',
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await client.query(`
    CREATE TABLE IF NOT EXISTS theme_kpi_map (
      theme_id TEXT NOT NULL,
      theme_label TEXT,
      kpi_key TEXT NOT NULL REFERENCES kpi_definition_registry(kpi_key) ON DELETE CASCADE,
      status TEXT NOT NULL DEFAULT 'candidate',
      priority INTEGER NOT NULL DEFAULT 50,
      confidence DOUBLE PRECISION NOT NULL DEFAULT 0.5,
      rationale TEXT,
      created_by TEXT NOT NULL DEFAULT 'generic-kpi-collection',
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (theme_id, kpi_key)
    )
  `);
  await client.query(`
    CREATE TABLE IF NOT EXISTS data_collection_jobs (
      id BIGSERIAL PRIMARY KEY,
      theme_id TEXT NOT NULL,
      kpi_key TEXT,
      data_pack TEXT,
      source_type TEXT NOT NULL,
      query TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      priority INTEGER NOT NULL DEFAULT 50,
      retry_count INTEGER NOT NULL DEFAULT 0,
      last_run_at TIMESTAMPTZ,
      next_run_at TIMESTAMPTZ,
      last_error TEXT,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await client.query(`
    CREATE TABLE IF NOT EXISTS industry_kpi_observations (
      id BIGSERIAL PRIMARY KEY,
      theme TEXT NOT NULL,
      kpi_name TEXT NOT NULL,
      value_num DOUBLE PRECISION,
      unit TEXT,
      geography TEXT,
      observed_at TIMESTAMPTZ,
      source_type TEXT DEFAULT 'manual_or_adapter',
      evidence_ref TEXT,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await client.query(`
    ALTER TABLE industry_kpi_observations
      ADD COLUMN IF NOT EXISTS kpi_key TEXT
  `).catch(() => {});
  await client.query(`
    ALTER TABLE industry_kpi_observations
      ADD COLUMN IF NOT EXISTS entity_id TEXT
  `).catch(() => {});
  await client.query(`
    ALTER TABLE industry_kpi_observations
      ADD COLUMN IF NOT EXISTS period_start TIMESTAMPTZ
  `).catch(() => {});
  await client.query(`
    ALTER TABLE industry_kpi_observations
      ADD COLUMN IF NOT EXISTS period_end TIMESTAMPTZ
  `).catch(() => {});
  await client.query(`
    ALTER TABLE industry_kpi_observations
      ADD COLUMN IF NOT EXISTS source_id TEXT
  `).catch(() => {});
  await client.query(`
    ALTER TABLE industry_kpi_observations
      ADD COLUMN IF NOT EXISTS confidence DOUBLE PRECISION DEFAULT 0.5
  `).catch(() => {});
  await client.query(`
    ALTER TABLE industry_kpi_observations
      ADD COLUMN IF NOT EXISTS freshness_status TEXT DEFAULT 'unknown'
  `).catch(() => {});
  await client.query(`
    ALTER TABLE industry_kpi_observations
      ADD COLUMN IF NOT EXISTS dedupe_key TEXT
  `).catch(() => {});
  await client.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS industry_kpi_observations_dedupe_idx
      ON industry_kpi_observations (dedupe_key)
      WHERE dedupe_key IS NOT NULL
  `).catch(() => {});
  await client.query(`
    CREATE INDEX IF NOT EXISTS theme_kpi_map_theme_status_idx
      ON theme_kpi_map (theme_id, status, priority DESC)
  `);
  await client.query(`
    CREATE INDEX IF NOT EXISTS data_collection_jobs_status_priority_idx
      ON data_collection_jobs (status, priority DESC, created_at ASC)
  `);
  await client.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS data_collection_jobs_active_dedupe_idx
      ON data_collection_jobs (theme_id, COALESCE(kpi_key, ''), source_type, lower(query))
      WHERE status IN ('pending','retry_wait','queued_review','approved','running')
  `).catch(() => {});
  return { ok: true };
}

async function loadThemesForDiscovery(client, options = {}) {
  const explicit = unique(options.themes || options.themeIds);
  if (explicit.length) {
    return explicit.map((theme) => ({ themeId: slugify(theme), themeLabel: compactText(theme), category: null, parentTheme: null }));
  }
  const limit = Math.max(1, Math.min(500, int(options.limit, 50)));
  const trendRows = await safeRows(client, 'theme_trend_aggregates', `
    SELECT DISTINCT ON (theme)
           theme AS "themeId",
           COALESCE(theme_label, theme) AS "themeLabel",
           category,
           parent_theme AS "parentTheme",
           metadata,
           article_count,
           computed_at
      FROM theme_trend_aggregates
     WHERE theme IS NOT NULL
     ORDER BY theme, computed_at DESC NULLS LAST, article_count DESC NULLS LAST
     LIMIT $1
  `, [limit]);
  if (trendRows.length) return trendRows;
  return safeRows(client, 'articles', `
    SELECT theme AS "themeId",
           theme AS "themeLabel",
           NULL::text AS category,
           NULL::text AS "parentTheme",
           COUNT(*)::int AS article_count,
           MAX(published_at) AS computed_at
      FROM articles
     WHERE theme IS NOT NULL
     GROUP BY theme
     ORDER BY COUNT(*) DESC
     LIMIT $1
  `, [limit]);
}

async function upsertKpiDefinition(client, definition) {
  const def = normalizeDefinition(definition);
  await client.query(`
    INSERT INTO kpi_definition_registry (
      kpi_key, display_name, data_pack, unit, leading_or_lagging, source_types,
      freshness_sla_hours, definition_text, metadata, updated_at
    )
    VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9::jsonb, NOW())
    ON CONFLICT (kpi_key) DO UPDATE SET
      display_name = EXCLUDED.display_name,
      data_pack = EXCLUDED.data_pack,
      unit = EXCLUDED.unit,
      leading_or_lagging = EXCLUDED.leading_or_lagging,
      source_types = EXCLUDED.source_types,
      freshness_sla_hours = EXCLUDED.freshness_sla_hours,
      definition_text = EXCLUDED.definition_text,
      metadata = kpi_definition_registry.metadata || EXCLUDED.metadata,
      updated_at = NOW()
  `, [
    def.kpiKey,
    def.displayName,
    def.dataPack,
    def.unit,
    def.leadingOrLagging,
    JSON.stringify(def.sourceTypes),
    def.freshnessSlaHours,
    def.definitionText,
    JSON.stringify(def.metadata || {}),
  ]);
  return def;
}

async function upsertThemeKpiMap(client, theme, definition) {
  const def = normalizeDefinition(definition);
  const themeId = slugify(theme.themeId || theme.theme || theme.label);
  const themeLabel = compactText(theme.themeLabel || theme.label || themeId);
  const isOntologySpecific = Boolean(def.metadata?.ontologyKey);
  await client.query(`
    INSERT INTO theme_kpi_map (
      theme_id, theme_label, kpi_key, status, priority, confidence, rationale,
      metadata, updated_at
    )
    VALUES ($1, $2, $3, 'candidate', $4, $5, $6, $7::jsonb, NOW())
    ON CONFLICT (theme_id, kpi_key) DO UPDATE SET
      theme_label = COALESCE(EXCLUDED.theme_label, theme_kpi_map.theme_label),
      priority = GREATEST(theme_kpi_map.priority, EXCLUDED.priority),
      confidence = GREATEST(theme_kpi_map.confidence, EXCLUDED.confidence),
      rationale = COALESCE(theme_kpi_map.rationale, EXCLUDED.rationale),
      metadata = theme_kpi_map.metadata || EXCLUDED.metadata,
      updated_at = NOW()
  `, [
    themeId,
    themeLabel,
    def.kpiKey,
    def.priority,
    Math.min(0.9, Math.max(0.35, def.priority / 100)),
    `Generic KPI archetype mapped from theme/category context: ${themeText(theme) || themeId}`,
    JSON.stringify({
      category: theme.category || null,
      parentTheme: theme.parentTheme || theme.parent_theme || null,
      createdBy: 'generic-kpi-collection',
      notThemeSpecific: !isOntologySpecific,
      ontologyKey: def.metadata?.ontologyKey || null,
      ontologyLabel: def.metadata?.ontologyLabel || null,
      requiredFor: def.metadata?.requiredFor || null,
      critical: def.metadata?.critical || false,
    }),
  ]);
  return { themeId, kpiKey: def.kpiKey };
}

export async function discoverThemeKpis(client, options = {}) {
  await ensureGenericKpiSchema(client);
  const themes = await loadThemesForDiscovery(client, options);
  let definitionCount = 0;
  let mapCount = 0;
  for (const theme of themes) {
    const definitions = inferKpiDefinitionsForTheme(theme);
    for (const definition of definitions) {
      await upsertKpiDefinition(client, definition);
      definitionCount += 1;
      await upsertThemeKpiMap(client, theme, definition);
      mapCount += 1;
    }
  }
  return { ok: true, themeCount: themes.length, definitionCount, mapCount };
}

async function loadThemeSymbols(client, themeId) {
  const exposure = await safeRows(client, 'theme_entity_exposure', `
    SELECT entity_key AS symbol, confidence
      FROM theme_entity_exposure
     WHERE theme = $1
       AND entity_type IN ('company','equity','ticker')
     ORDER BY confidence DESC NULLS LAST, updated_at DESC NULLS LAST
     LIMIT 12
  `, [themeId]);
  const regime = await safeRows(client, 'regime_conditional_impact', `
    SELECT symbol, MAX(sample_size) AS sample_size
      FROM regime_conditional_impact
     WHERE theme = $1
     GROUP BY symbol
     ORDER BY sample_size DESC NULLS LAST
     LIMIT 12
  `, [themeId]);
  return unique([...exposure.map((row) => row.symbol), ...regime.map((row) => row.symbol)])
    .map((symbol) => String(symbol).toUpperCase())
    .filter((symbol) => filterIssuerSymbols([symbol]).includes(symbol))
    .slice(0, 12);
}

async function latestTrend(client, themeId) {
  return one(client, `
    SELECT *
      FROM theme_trend_aggregates
     WHERE theme = $1
       AND COALESCE(article_count, 0) > 0
     ORDER BY period_end DESC NULLS LAST, computed_at DESC NULLS LAST
     LIMIT 1
  `, [themeId]).catch(() => null);
}

async function countThemeRows(client, tableName, sql, params) {
  if (!await tableExists(client, tableName)) return 0;
  const row = await one(client, sql, params).catch(() => null);
  return int(row?.count, 0);
}

async function buildObservationForKpi(client, mapRow) {
  const themeId = mapRow.theme_id;
  const kpiKey = mapRow.kpi_key;
  const trend = await latestTrend(client, themeId);
  const symbols = await loadThemeSymbols(client, themeId);
  const now = new Date().toISOString();
  const base = {
    theme: themeId,
    kpi_key: kpiKey,
    kpi_name: mapRow.display_name || kpiKey,
    unit: mapRow.unit || 'items',
    geography: null,
    source_type: null,
    evidence_ref: null,
    observed_at: trend?.period_end || trend?.computed_at || now,
    period_start: trend?.period_start || null,
    period_end: trend?.period_end || trend?.computed_at || now,
    confidence: Math.max(0.35, Math.min(0.85, num(mapRow.confidence, 0.5))),
    freshness_status: 'fresh',
    metadata: {
      dataPack: mapRow.data_pack,
      sourceTypes: asArray(mapRow.source_types),
      ...(mapRow.definition_metadata || {}),
      adapter: 'generic-kpi-collection',
    },
  };

  if (kpiKey === 'attention_volume' && trend) {
    return { ...base, value_num: num(trend.article_count), unit: 'articles', source_type: 'theme_trend_aggregates', metadata: { ...base.metadata, periodType: trend.period_type } };
  }
  if (kpiKey === 'source_diversity' && trend) {
    return { ...base, value_num: num(trend.source_diversity), unit: 'score', source_type: 'theme_trend_aggregates', metadata: { ...base.metadata, uniqueSources: trend.unique_sources } };
  }
  if (kpiKey === 'lifecycle_confidence' && trend) {
    return { ...base, value_num: num(trend.lifecycle_confidence, 0), unit: 'score', source_type: 'theme_trend_aggregates', metadata: { ...base.metadata, lifecycleStage: trend.lifecycle_stage } };
  }
  if (kpiKey === 'market_reaction_strength') {
    const row = await one(client, `
      SELECT AVG(ABS(avg_return)) AS value, SUM(sample_size)::int AS sample_size, COUNT(*)::int AS count
        FROM regime_conditional_impact
       WHERE theme = $1
    `, [themeId]).catch(() => null);
    if (num(row?.count, 0) > 0) return { ...base, value_num: num(row.value), unit: 'pct', source_type: 'regime_conditional_impact', metadata: { ...base.metadata, sampleSize: row.sample_size, rows: row.count } };
  }
  if (kpiKey === 'peer_exposure_count') {
    const count = await countThemeRows(client, 'theme_entity_exposure', `SELECT COUNT(*)::int AS count FROM theme_entity_exposure WHERE theme = $1`, [themeId]);
    if (count > 0) return { ...base, value_num: count, unit: 'entities', source_type: 'theme_entity_exposure', metadata: { ...base.metadata, symbols } };
  }
  if (kpiKey === 'filing_activity' && symbols.length) {
    const count = await countThemeRows(client, 'sec_filings_evidence', `
      SELECT COUNT(*)::int AS count
        FROM sec_filings_evidence
       WHERE ticker = ANY($1::text[])
         AND filing_date >= CURRENT_DATE - INTERVAL '180 days'
    `, [symbols]);
    if (count > 0) return { ...base, value_num: count, unit: 'filings', source_type: 'sec_filings_evidence', metadata: { ...base.metadata, symbols } };
  }
  if (kpiKey === 'research_velocity' || kpiKey === 'technical_maturity_proxy') {
    const openAlex = await countThemeRows(client, 'openalex_theme_evidence', `
      SELECT COUNT(*)::int AS count FROM openalex_theme_evidence WHERE theme = $1
    `, [themeId]);
    const github = await countThemeRows(client, 'theme_github_evidence', `
      SELECT COUNT(*)::int AS count FROM theme_github_evidence WHERE theme = $1
    `, [themeId]);
    const bundles = await countThemeRows(client, 'research_evidence_bundles', `
      SELECT COUNT(*)::int AS count
        FROM research_evidence_bundles
       WHERE COALESCE(metadata->>'theme', '') = $1
          OR title ILIKE $2
    `, [themeId, `%${themeId.replace(/[-_]+/g, ' ')}%`]);
    const value = openAlex + github + bundles;
    if (value > 0) return { ...base, value_num: value, unit: 'items', source_type: 'research_evidence_sources', metadata: { ...base.metadata, openAlex, github, bundles } };
  }
  if (kpiKey === 'policy_activity' || kpiKey === 'procurement_policy_pressure' || kpiKey === 'policy_subsidy_activity') {
    const count = await countThemeRows(client, 'daily_curated_news', `
      SELECT COUNT(*)::int AS count
        FROM daily_curated_news
       WHERE theme = $1
         AND (
          one_line_summary ~* $2
          OR why_it_matters ~* $2
          OR COALESCE(metadata->>'title', '') ~* $2
        )
    `, [themeId, 'policy|regulat|government|federal|subsid|sanction|procurement|award|contract|agency|law|tariff|tax|public|state|national|defense|department|ministry|program']);
    if (count > 0) return { ...base, value_num: count, unit: 'items', source_type: 'daily_curated_news_policy_proxy' };
  }
  if (kpiKey === 'historical_memory_coverage') {
    const count = await countThemeRows(client, 'theme_trend_aggregates', `
      SELECT COUNT(*)::int AS count
        FROM theme_trend_aggregates
       WHERE theme = $1
         AND COALESCE(article_count, 0) > 0
         AND period_end >= CURRENT_DATE - INTERVAL '365 days'
    `, [themeId]);
    if (count > 0) return { ...base, value_num: count, unit: 'windows', source_type: 'theme_trend_aggregates_memory' };
  }
  if (kpiKey === 'feedback_signal_count') {
    const count = await countThemeRows(client, 'report_feedback', `
      SELECT COUNT(*)::int AS count
        FROM report_feedback
       WHERE COALESCE(metadata->'subject'->>'subjectId', metadata->>'theme', '') = $1
    `, [themeId]);
    if (count > 0) return { ...base, value_num: count, unit: 'items', source_type: 'report_feedback' };
  }
  if (kpiKey === 'capacity_buildout_proxy' || kpiKey === 'logistics_capacity_proxy' || kpiKey === 'commodity_supply_demand_proxy' || kpiKey === 'trial_regulatory_milestone') {
    const pattern = kpiKey === 'trial_regulatory_milestone'
      ? 'trial|phase|readout|approval|fda|regulator|safety|clinical|drug|patient'
      : kpiKey === 'commodity_supply_demand_proxy'
        ? 'supply|demand|capacity|shortage|inventory|commodity|price|production|output|scarcity'
        : 'capacity|buildout|capex|supply|demand|backlog|orders|utilization|shipment|production|facility|bottleneck|delivery|infrastructure';
    const count = await countThemeRows(client, 'articles', `
      SELECT COUNT(*)::int AS count
        FROM articles
       WHERE theme = $1
         AND published_at >= NOW() - INTERVAL '180 days'
         AND (
          title ~* $2
          OR summary ~* $2
        )
    `, [themeId, pattern]);
    if (count > 0) return { ...base, value_num: count, unit: 'items', source_type: 'articles_keyword_proxy', metadata: { ...base.metadata, pattern } };
  }
  if (kpiKey === 'capex_intensity_proxy' && symbols.length) {
    const count = await countThemeRows(client, 'sec_companyfacts_facts', `
      SELECT COUNT(*)::int AS count
        FROM sec_companyfacts_facts
       WHERE ticker = ANY($1::text[])
         AND (concept ~* $2 OR concept_label ~* $2)
    `, [symbols, 'Capital|Property|Plant|Equipment|Capex|CapitalExpenditure|Additions']);
    if (count > 0) return { ...base, value_num: count, unit: 'facts', source_type: 'sec_companyfacts_facts', metadata: { ...base.metadata, symbols } };
  }
  if (kpiKey === 'macro_regime_indicator') {
    const row = await one(client, `
      SELECT COUNT(*)::int AS count,
             AVG(ABS(regime_multiplier)) AS value
        FROM regime_conditional_impact
       WHERE theme = $1
    `, [themeId]).catch(() => null);
    if (num(row?.count, 0) > 0) return { ...base, value_num: num(row.value), unit: 'score', source_type: 'regime_conditional_impact', metadata: { ...base.metadata, rows: row.count } };
  }
  return null;
}

async function insertObservation(client, observation) {
  if (!observation) return false;
  const dedupeKey = [
    observation.theme,
    observation.kpi_key,
    observation.source_type || 'unknown',
    iso(observation.period_end || observation.observed_at)?.slice(0, 10) || 'unknown',
  ].join('::');
  const result = await client.query(`
    INSERT INTO industry_kpi_observations (
      theme, kpi_name, value_num, unit, geography, observed_at, source_type,
      evidence_ref, metadata, kpi_key, entity_id, period_start, period_end,
      source_id, confidence, freshness_status, dedupe_key
    )
    SELECT $1, $2, $3, $4, $5, $6::timestamptz, $7, $8, $9::jsonb, $10,
           $11, $12::timestamptz, $13::timestamptz, $14, $15, $16, $17
    WHERE NOT EXISTS (
      SELECT 1 FROM industry_kpi_observations WHERE dedupe_key = $17
    )
    RETURNING id
  `, [
    observation.theme,
    observation.kpi_name,
    observation.value_num,
    observation.unit,
    observation.geography,
    iso(observation.observed_at),
    observation.source_type,
    observation.evidence_ref,
    JSON.stringify(observation.metadata || {}),
    observation.kpi_key,
    observation.entity_id || null,
    iso(observation.period_start),
    iso(observation.period_end),
    observation.source_id || null,
    observation.confidence,
    observation.freshness_status || 'fresh',
    dedupeKey,
  ]).catch(() => ({ rows: [] }));
  return result.rows.length > 0;
}

async function loadMappedKpis(client, options = {}) {
  const themes = unique(options.themes || options.themeIds);
  const limit = Math.max(1, Math.min(1000, int(options.limit, 200)));
  const where = themes.length ? 'WHERE m.theme_id = ANY($1::text[])' : '';
  const params = themes.length ? [themes, limit] : [limit];
  const sql = themes.length ? `
    SELECT m.theme_id, m.theme_label, m.kpi_key, m.status, m.priority, m.confidence,
           d.display_name, d.data_pack, d.unit, d.source_types, d.freshness_sla_hours,
           d.definition_text, d.metadata AS definition_metadata
      FROM theme_kpi_map m
      JOIN kpi_definition_registry d USING (kpi_key)
      ${where}
     ORDER BY m.priority DESC, m.theme_id, m.kpi_key
     LIMIT $2
  ` : `
    SELECT m.theme_id, m.theme_label, m.kpi_key, m.status, m.priority, m.confidence,
           d.display_name, d.data_pack, d.unit, d.source_types, d.freshness_sla_hours,
           d.definition_text, d.metadata AS definition_metadata
      FROM theme_kpi_map m
      JOIN kpi_definition_registry d USING (kpi_key)
     ORDER BY m.priority DESC, m.theme_id, m.kpi_key
     LIMIT $1
  `;
  const rows = await many(client, sql, params);
  return rows.map((row) => ({
    ...row,
    source_types: Array.isArray(row.source_types) ? row.source_types : asArray(row.source_types),
    definition_metadata: row.definition_metadata || {},
  }));
}

export async function materializeKpiObservations(client, options = {}) {
  await ensureGenericKpiSchema(client);
  const mapped = await loadMappedKpis(client, options);
  let inserted = 0;
  let computed = 0;
  const missing = [];
  for (const row of mapped) {
    const observation = await buildObservationForKpi(client, row);
    if (!observation) {
      missing.push(row);
      continue;
    }
    computed += 1;
    if (await insertObservation(client, observation)) inserted += 1;
  }
  return { ok: true, inspectedCount: mapped.length, computedCount: computed, insertedCount: inserted, missingCount: missing.length };
}

export async function enqueueMissingKpiCollectionJobs(client, options = {}) {
  await ensureGenericKpiSchema(client);
  await reconcileSatisfiedKpiCollectionJobs(client, options).catch(() => ({ ok: false }));
  const themes = unique(options.themes || options.themeIds);
  const limit = Math.max(1, Math.min(500, int(options.limit, 100)));
  const themeFilter = themes.length ? 'AND m.theme_id = ANY($1::text[])' : '';
  const params = themes.length ? [themes, limit] : [limit];
  const sql = themes.length ? `
    SELECT m.theme_id, m.theme_label, m.kpi_key, m.priority, m.confidence,
           d.display_name, d.data_pack, d.source_types, d.freshness_sla_hours, d.unit,
           d.metadata AS definition_metadata
      FROM theme_kpi_map m
      JOIN kpi_definition_registry d USING (kpi_key)
     WHERE NOT EXISTS (
       SELECT 1
         FROM industry_kpi_observations o
        WHERE o.theme = m.theme_id
          AND o.kpi_key = m.kpi_key
          AND COALESCE(o.observed_at, o.created_at) >= NOW() - ((d.freshness_sla_hours || ' hours')::interval)
     )
       ${themeFilter}
     ORDER BY m.priority DESC, m.theme_id, m.kpi_key
     LIMIT $2
  ` : `
    SELECT m.theme_id, m.theme_label, m.kpi_key, m.priority, m.confidence,
           d.display_name, d.data_pack, d.source_types, d.freshness_sla_hours, d.unit,
           d.metadata AS definition_metadata
      FROM theme_kpi_map m
      JOIN kpi_definition_registry d USING (kpi_key)
     WHERE NOT EXISTS (
       SELECT 1
         FROM industry_kpi_observations o
        WHERE o.theme = m.theme_id
          AND o.kpi_key = m.kpi_key
          AND COALESCE(o.observed_at, o.created_at) >= NOW() - ((d.freshness_sla_hours || ' hours')::interval)
     )
     ORDER BY m.priority DESC, m.theme_id, m.kpi_key
     LIMIT $1
  `;
  const rows = await many(client, sql, params).catch(() => []);
  let inserted = 0;
  for (const row of rows) {
    const sourceTypes = Array.isArray(row.source_types) ? row.source_types : asArray(row.source_types);
    const sources = sourceTypes.length ? sourceTypes.slice(0, 3) : ['source-query'];
    for (const sourceType of sources) {
      const query = buildKpiCollectionQuery({
        themeId: row.theme_id,
        themeLabel: row.theme_label,
        definition: {
          kpiKey: row.kpi_key,
          displayName: row.display_name,
          sourceTypes: sources,
          metadata: row.definition_metadata || {},
        },
        sourceType,
      });
      const result = await client.query(`
        INSERT INTO data_collection_jobs (
          theme_id, kpi_key, data_pack, source_type, query, status, priority, metadata, updated_at
        )
        SELECT $1, $2, $3, $4, $5, 'pending', $6, $7::jsonb, NOW()
        WHERE NOT EXISTS (
          SELECT 1
            FROM data_collection_jobs
           WHERE theme_id = $1
             AND COALESCE(kpi_key, '') = COALESCE($2, '')
             AND source_type = $4
             AND status = ANY($8::text[])
        )
        RETURNING id
      `, [
        row.theme_id,
        row.kpi_key,
        row.data_pack,
        sourceType,
        query,
        int(row.priority, 50),
        JSON.stringify({
          reason: 'Missing generic KPI observation',
          themeLabel: row.theme_label,
          displayName: row.display_name,
          freshnessSlaHours: row.freshness_sla_hours,
          ontologyKey: row.definition_metadata?.ontologyKey || null,
          requiredFor: row.definition_metadata?.requiredFor || null,
          critical: row.definition_metadata?.critical || false,
          approvalRequired: true,
          createdBy: 'generic-kpi-collection',
          boundary: 'collection job only; canonical report claims require supported observations',
        }),
        ACTIVE_JOB_STATUSES,
      ]).catch(() => ({ rows: [] }));
      inserted += result.rows.length;
    }
  }
  return { ok: true, inspectedCount: rows.length, insertedCount: inserted };
}

export async function reconcileSatisfiedKpiCollectionJobs(client, options = {}) {
  if (!client) return { ok: false, reason: 'no db client' };
  const themes = unique(options.themes || options.themeIds);
  const themeFilter = themes.length ? 'AND j.theme_id = ANY($2::text[])' : '';
  const params = themes.length
    ? [ACTIVE_JOB_STATUSES, themes]
    : [ACTIVE_JOB_STATUSES];
  const sql = `
    UPDATE data_collection_jobs j
       SET status = 'satisfied',
           updated_at = NOW(),
           metadata = metadata || jsonb_build_object(
             'satisfiedAt', NOW(),
             'satisfiedBy', 'generic-kpi-collection',
             'reason', 'A matching KPI observation now exists.'
           )
     WHERE j.status = ANY($1::text[])
       ${themeFilter}
       AND j.kpi_key IS NOT NULL
       AND EXISTS (
         SELECT 1
           FROM industry_kpi_observations o
           LEFT JOIN kpi_definition_registry d
             ON d.kpi_key = j.kpi_key
          WHERE o.theme = j.theme_id
            AND o.kpi_key = j.kpi_key
            AND COALESCE(o.observed_at, o.created_at) >= NOW() - ((COALESCE(d.freshness_sla_hours, 720) || ' hours')::interval)
       )
  `;
  const result = await client.query(sql, params).catch(() => ({ rowCount: 0 }));
  const duplicateSql = `
    WITH ranked AS (
      SELECT id,
             ROW_NUMBER() OVER (
               PARTITION BY theme_id, COALESCE(kpi_key, ''), source_type
               ORDER BY priority DESC, created_at ASC, id ASC
             ) AS rn
        FROM data_collection_jobs j
       WHERE j.status = ANY($1::text[])
         ${themeFilter}
    )
    UPDATE data_collection_jobs j
       SET status = 'superseded',
           updated_at = NOW(),
           metadata = metadata || jsonb_build_object(
             'supersededAt', NOW(),
             'supersededBy', 'generic-kpi-collection',
             'reason', 'Duplicate active KPI collection job for the same theme/kpi/source.'
           )
      FROM ranked r
     WHERE j.id = r.id
       AND r.rn > 1
  `;
  const duplicateResult = await client.query(duplicateSql, params).catch(() => ({ rowCount: 0 }));
  return { ok: true, satisfiedCount: result.rowCount || 0, supersededCount: duplicateResult.rowCount || 0 };
}

export async function runGenericKpiCollectionCycle(client, options = {}) {
  await ensureGenericKpiSchema(client);
  const discovery = await discoverThemeKpis(client, options);
  const themes = unique(options.themes || options.themeIds);
  const materialized = await materializeKpiObservations(client, {
    themes,
    limit: options.materializeLimit || options.limit || 200,
  });
  const reconciled = await reconcileSatisfiedKpiCollectionJobs(client, { themes });
  const jobs = await enqueueMissingKpiCollectionJobs(client, {
    themes,
    limit: options.jobLimit || options.limit || 100,
  });
  return { ok: true, discovery, materialized, reconciled, jobs };
}

export async function ensureKpiThemeCoverage(client, { themeId, themeLabel, category, parentTheme } = {}, options = {}) {
  if (!client || !themeId) return { ok: false, reason: 'missing client or theme' };
  await ensureGenericKpiSchema(client);
  const theme = { themeId: slugify(themeId), themeLabel: themeLabel || themeId, category, parentTheme };
  const definitions = inferKpiDefinitionsForTheme(theme);
  for (const definition of definitions) {
    await upsertKpiDefinition(client, definition);
    await upsertThemeKpiMap(client, theme, definition);
  }
  const materialized = await materializeKpiObservations(client, { themes: [theme.themeId], limit: options.limit || 80 });
  const reconciled = await reconcileSatisfiedKpiCollectionJobs(client, { themes: [theme.themeId] });
  const jobs = await enqueueMissingKpiCollectionJobs(client, { themes: [theme.themeId], limit: options.jobLimit || 40 });
  return { ok: true, themeId: theme.themeId, mappedCount: definitions.length, materialized, reconciled, jobs };
}

export async function loadThemeKpiCollectionState(client, { themeId, themeLabel, key } = {}) {
  if (!client) return { observations: [], definitions: [], maps: [], jobs: [], gaps: [], coverage: null };
  const candidates = unique([themeId, key]).map(slugify);
  if (!candidates.length) return { observations: [], definitions: [], maps: [], jobs: [], gaps: [], coverage: null };
  if (!await tableExists(client, 'theme_kpi_map')) {
    return { observations: [], definitions: [], maps: [], jobs: [], gaps: [], coverage: null };
  }
  const maps = await many(client, `
    SELECT m.theme_id, m.theme_label, m.kpi_key, m.status, m.priority, m.confidence,
           d.display_name, d.data_pack, d.unit, d.source_types, d.freshness_sla_hours,
           d.definition_text
      FROM theme_kpi_map m
      JOIN kpi_definition_registry d USING (kpi_key)
     WHERE m.theme_id = ANY($1::text[])
     ORDER BY m.priority DESC, m.kpi_key
  `, [candidates]).catch(() => []);
  const observations = await safeRows(client, 'industry_kpi_observations', `
    SELECT o.id::text AS id, o.theme, o.kpi_key, o.kpi_name, o.value_num, o.unit, o.geography,
           observed_at, period_start, period_end, source_type, source_id,
           evidence_ref, o.confidence, o.freshness_status, o.metadata, o.created_at,
           COALESCE(d.freshness_sla_hours, 720) AS freshness_sla_hours,
           (COALESCE(o.observed_at, o.created_at) >= NOW() - ((COALESCE(d.freshness_sla_hours, 720) || ' hours')::interval)) AS is_fresh,
           CONCAT(o.theme, ' ', COALESCE(o.kpi_name, o.kpi_key), ' KPI') AS title,
           CONCAT(COALESCE(o.kpi_name, o.kpi_key), ' = ', o.value_num, COALESCE(' ' || o.unit, ''), COALESCE(' in ' || o.geography, ''), '.') AS fact_text
      FROM industry_kpi_observations o
      LEFT JOIN kpi_definition_registry d
        ON d.kpi_key = o.kpi_key
     WHERE o.theme = ANY($1::text[])
       AND o.kpi_key IS NOT NULL
     ORDER BY o.created_at DESC, o.observed_at DESC NULLS LAST
     LIMIT 200
  `, [candidates]);
  const jobs = await safeRows(client, 'data_collection_jobs', `
    SELECT id::text AS id, theme_id, kpi_key, data_pack, source_type, query,
           status, priority, retry_count, last_run_at, next_run_at, last_error,
           metadata, created_at, updated_at
      FROM data_collection_jobs
     WHERE theme_id = ANY($1::text[])
       AND status = ANY($2::text[])
     ORDER BY priority DESC, created_at DESC
     LIMIT 80
  `, [candidates, ACTIVE_JOB_STATUSES]);
  const freshObservedKeys = new Set(observations
    .filter((row) => row.is_fresh !== false)
    .map((row) => `${row.theme}::${row.kpi_key}`));
  const gaps = maps
    .filter((row) => !freshObservedKeys.has(`${row.theme_id}::${row.kpi_key}`))
    .map((row) => ({
      themeId: row.theme_id,
      themeLabel: row.theme_label || themeLabel || row.theme_id,
      kpiKey: row.kpi_key,
      displayName: row.display_name,
      dataPack: row.data_pack,
      severity: int(row.priority, 50) >= 80 ? 'high' : 'medium',
      query: buildKpiCollectionQuery({
        themeId: row.theme_id,
        themeLabel: row.theme_label || themeLabel,
        definition: { kpiKey: row.kpi_key, displayName: row.display_name, sourceTypes: asArray(row.source_types) },
        sourceType: asArray(row.source_types)[0] || 'source-query',
      }),
      reason: `No fresh generic KPI observation is available for ${row.display_name || row.kpi_key}.`,
    }));
  const coverage = maps.length
    ? Math.round(((maps.length - gaps.length) / maps.length) * 1000) / 1000
    : null;
  return {
    observations,
    definitions: maps.map((row) => ({
      kpiKey: row.kpi_key,
      displayName: row.display_name,
      dataPack: row.data_pack,
      unit: row.unit,
      sourceTypes: asArray(row.source_types),
      freshnessSlaHours: row.freshness_sla_hours,
      definitionText: row.definition_text,
    })),
    maps,
    jobs,
    gaps,
    coverage,
  };
}
