import { discoverProviderBackfillTargets } from '../collect-free-external-data.mjs';
import {
  ADJACENT_FRONTIER_REPORT_STATUSES,
  ensureAdjacentThemeCandidateSchema,
  loadAdjacentThemeSubjects,
  STRICT_ENDOGENOUS_DISCOVERY_VERSION,
  STRICT_ENDOGENOUS_NAMESPACE,
} from './report-adjacent-expansion.mjs';
import { REPORT_TYPES } from './report-evidence-bundle.mjs';

function compactText(value, max = 240) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function slugify(value) {
  return compactText(value)
    .toLowerCase()
    .replace(/['"]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 160);
}

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (value === null || value === undefined || value === '') return [];
  if (typeof value === 'object') return Object.values(value);
  return String(value).split(',');
}

function uniqueStrings(values = [], limit = 80) {
  const seen = new Set();
  const out = [];
  for (const value of values) {
    const text = compactText(value);
    if (!text) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(text);
    if (out.length >= limit) break;
  }
  return out;
}

function num(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

async function queryOptional(client, sql, params = []) {
  try {
    return await client.query(sql, params);
  } catch {
    return { rows: [] };
  }
}

export function inferUniversalSubjectType(subject = {}) {
  const key = slugify(subject.subjectKey || subject.theme || subject.label);
  const label = compactText(subject.label || subject.subjectLabel || key).toLowerCase();
  const sources = new Set(asArray(subject.sourceTypes || subject.sources).map((source) => String(source).toLowerCase()));
  const symbols = asArray(subject.symbols).filter(Boolean);
  if (symbols.length || /^[A-Z]{1,6}([.-][A-Z])?$/.test(compactText(subject.label))) return 'company_or_symbol';
  if (sources.has('source_registry') || sources.has('add-rss') || /^https?:\/\//i.test(label)) return 'source';
  if (sources.has('cross_theme_candidates') || sources.has('research_questions')) return 'cross_theme_candidate';
  if (sources.has('theme_kpi_map') || sources.has('theme_trend_aggregates')) return 'theme';
  if (/sanction|tariff|regulation|policy|procurement|subsidy|election|diplomacy/i.test(label)) return 'policy_or_geopolitics';
  if (/helium|hydrogen|lithium|uranium|copper|gas|fuel|cooling|cryogenic|magnet|wafer|power|grid|capacity/i.test(label)) return 'material_or_bottleneck';
  if (/event|attack|strike|war|breach|shutdown|disruption|launch|approval/i.test(label)) return 'event';
  if (key.split('-').length <= 2 && key.length < 32) return 'theme_candidate';
  return 'research_subject';
}

export function selectDataPacksForSubject(subject = {}) {
  const type = subject.subjectType || inferUniversalSubjectType(subject);
  const packs = new Set(['evidencePack', 'causalPack']);
  if (type === 'company_or_symbol') {
    ['marketPack', 'fundamentalPack', 'filingPack', 'transcriptPack', 'historicalAnalogPack'].forEach((pack) => packs.add(pack));
  } else if (type === 'theme' || type === 'theme_candidate') {
    ['marketPack', 'industryPack', 'researchPack', 'policyPack', 'historicalAnalogPack'].forEach((pack) => packs.add(pack));
  } else if (type === 'material_or_bottleneck' || type === 'cross_theme_candidate') {
    ['industryPack', 'researchPack', 'policyPack', 'sourceQueryPack', 'historicalAnalogPack'].forEach((pack) => packs.add(pack));
  } else if (type === 'policy_or_geopolitics' || type === 'event') {
    ['marketPack', 'policyPack', 'regimePack', 'historicalAnalogPack'].forEach((pack) => packs.add(pack));
  } else if (type === 'source') {
    ['sourceQualityPack', 'sourceQueryPack'].forEach((pack) => packs.add(pack));
  } else {
    ['researchPack', 'sourceQueryPack', 'historicalAnalogPack'].forEach((pack) => packs.add(pack));
  }
  return [...packs];
}

export function reportTypeForUniversalSubjectType(subjectType = '') {
  const type = String(subjectType || '').toLowerCase();
  if (type === 'cross_theme_candidate' || type === 'material_or_bottleneck') return REPORT_TYPES.CROSS_THEME;
  if (type === 'company_or_symbol') return REPORT_TYPES.SYMBOL;
  return REPORT_TYPES.THEME;
}

export function reportSubjectArgumentForUniversalSubject(subject = {}) {
  const type = String(subject.subject_type || subject.subjectType || '').toLowerCase();
  const key = subject.subject_key || subject.subjectKey || '';
  const label = subject.subject_label || subject.subjectLabel || subject.label || '';
  if (type === 'material_or_bottleneck' && subject.metadata?.adjacentStatus) {
    return subject.metadata?.adjacentCandidateKey || key || label;
  }
  if (type === 'cross_theme_candidate' || type === 'material_or_bottleneck') return label || key;
  return key || label;
}

export function normalizeUniversalSubject(input = {}) {
  const subjectKey = slugify(input.subjectKey || input.theme || input.normalizedKey || input.normalized_key || input.label || input.name || input.query);
  if (!subjectKey) return null;
  const label = compactText(input.label || input.subjectLabel || input.name || input.theme || input.query || subjectKey);
  const symbols = uniqueStrings(asArray(input.symbols || input.tickers || input.symbol).map((symbol) => String(symbol).toUpperCase().replace(/[^A-Z0-9.\-]/g, '')), 20);
  const aliases = uniqueStrings([
    label,
    ...(input.aliases || []),
    input.query,
    input.reason,
  ], 40);
  const sourceTypes = uniqueStrings(asArray(input.sourceTypes || input.sources || input.discoveredFrom || input.source), 30);
  const subjectType = input.subjectType || inferUniversalSubjectType({ ...input, subjectKey, label, symbols, sourceTypes });
  const dataPacks = uniqueStrings(input.dataPacks || selectDataPacksForSubject({ ...input, subjectKey, label, symbols, sourceTypes, subjectType }), 20);
  const priorityScore = Math.max(0, Math.min(100, num(input.priorityScore, 40)
    + (symbols.length ? 10 : 0)
    + (sourceTypes.length > 1 ? 10 : 0)
    + (dataPacks.includes('sourceQueryPack') ? 5 : 0)));
  return {
    subjectKey,
    subjectLabel: label,
    subjectType,
    aliases,
    symbols,
    sourceTypes,
    sourceRefs: input.sourceRefs || input.source_refs || [],
    dataPacks,
    priorityScore,
    status: input.status || 'active',
    metadata: input.metadata || {},
  };
}

export function normalizeUniversalSubjects(inputs = []) {
  const map = new Map();
  for (const input of inputs) {
    const subject = normalizeUniversalSubject(input);
    if (!subject) continue;
    const existing = map.get(subject.subjectKey);
    if (!existing) {
      map.set(subject.subjectKey, subject);
      continue;
    }
    existing.aliases = uniqueStrings([...existing.aliases, ...subject.aliases], 60);
    existing.symbols = uniqueStrings([...existing.symbols, ...subject.symbols], 30);
    existing.sourceTypes = uniqueStrings([...existing.sourceTypes, ...subject.sourceTypes], 40);
    existing.dataPacks = uniqueStrings([...existing.dataPacks, ...subject.dataPacks], 30);
    existing.priorityScore = Math.max(existing.priorityScore, subject.priorityScore);
    existing.sourceRefs = [...asArray(existing.sourceRefs), ...asArray(subject.sourceRefs)].slice(0, 100);
    if (subject.metadata?.adjacentStatus || subject.sourceTypes.includes('adjacent_theme_candidates')) {
      existing.subjectType = subject.subjectType;
      existing.subjectLabel = subject.subjectLabel || existing.subjectLabel;
    }
    existing.metadata = { ...existing.metadata, ...subject.metadata };
  }
  return [...map.values()].sort((left, right) => right.priorityScore - left.priorityScore || left.subjectKey.localeCompare(right.subjectKey));
}

function strictEndogenousSubjectRank(subject = {}) {
  const type = subject.subjectType || subject.subject_type || '';
  const metadata = subject.metadata || {};
  const status = metadata.adjacentStatus || '';
  const strictFrontier = metadata.discoveryNamespace === STRICT_ENDOGENOUS_NAMESPACE || metadata.frontierDiscovery === true;
  const parentReady = metadata.parentReadyForAdjacent === true || String(metadata.parentReadyForAdjacent || '').toLowerCase() === 'true';
  if (type === 'material_or_bottleneck' && strictFrontier) {
    if (!parentReady) return 9;
    if (status === 'non_obvious_bottleneck_ready') return 0;
    if (status === 'ready_for_deep_report') return 1;
    if (status === 'needs_scarcity_evidence') return 2;
    if (status === 'frontier_candidate') return 3;
    return 4;
  }
  if (type === 'theme' || type === 'theme_candidate') return 5;
  if (type === 'material_or_bottleneck') return 6;
  if (type === 'cross_theme_candidate' || type === 'company_or_symbol') return 8;
  return 7;
}

function strictEndogenousSpecificityRank(subject = {}) {
  const metadata = subject.metadata || {};
  const text = [
    subject.subjectLabel,
    subject.label,
    subject.subjectKey,
    ...asArray(subject.sourceTypes),
    metadata.lane,
    metadata.generatedLane,
    ...asArray(metadata.sourceTerms),
    ...asArray(metadata.adjacentSourceTerms),
    ...asArray(metadata.concreteBottleneckNodes).flatMap((node) => [node?.node, node?.key]),
  ].join(' ');
  let rank = 0;
  if (/\b(interconnection stud(?:y|ies)|system impact stud(?:y|ies)|facilities stud(?:y|ies)|protection relay|substation automation|switchgear|transformer|fuel farm|propellant loading|storage tank|permit queue|service[-\s]?upgrade|ground[-\s]?support|input material|dielectric|electrical steel|test facility)\b/i.test(text)) {
    rank -= 2;
  }
  if (/\b(approved[-\s]?supplier qualification lead time|production capacity matches|raw evidence|company supplier component|evidence availability|signal does support thesis)\b/i.test(text)) {
    rank += 2;
  }
  if (metadata.failureReason === 'source_coverage_gap' || metadata.failure_reason === 'source_coverage_gap') rank += 0.4;
  return rank;
}

function adjacentParentReadyForStrictMode(subject = {}) {
  const metadata = subject.metadata || {};
  const key = String(subject.subjectKey || subject.subject_key || '').toLowerCase();
  const sourceTypes = asArray(subject.sourceTypes || subject.source_types).map((item) => String(item || '').toLowerCase());
  const evidenceSummary = metadata.evidenceSummary || metadata.evidence_summary || {};
  const isCrossThemeParent = sourceTypes.includes('cross_theme_candidates');
  if (isCrossThemeParent) {
    const parentReady = evidenceSummary.parentReadyForAdjacent === true
      || String(evidenceSummary.parentReadyForAdjacent || metadata.parentReadyForAdjacent || '').toLowerCase() === 'true';
    const frontierReportReady = evidenceSummary.frontierParentReportReady === true
      || metadata.frontierParentReportReady === true
      || String(evidenceSummary.frontierParentReportReady || metadata.frontierParentReportReady || '').toLowerCase() === 'true';
    const collectionEligible = evidenceSummary.frontierParentCollectionEligible === true
      || metadata.frontierParentCollectionEligible === true
      || String(evidenceSummary.frontierParentCollectionEligible || metadata.frontierParentCollectionEligible || '').toLowerCase() === 'true';
    return parentReady && (frontierReportReady || collectionEligible);
  }
  const adjacentDerived = key.startsWith('adjacent-')
    || key.startsWith('endogenous-adjacent-')
    || sourceTypes.includes('adjacent_theme_candidates')
    || Boolean(metadata.adjacentCandidateKey || metadata.adjacentStatus);
  if (!adjacentDerived) return true;
  return metadata.parentReadyForAdjacent === true || String(metadata.parentReadyForAdjacent || '').toLowerCase() === 'true';
}

export function sortStrictEndogenousSubjects(subjects = []) {
  return subjects.slice().sort((left, right) => (
    strictEndogenousSubjectRank(left) - strictEndogenousSubjectRank(right)
    || strictEndogenousSpecificityRank(left) - strictEndogenousSpecificityRank(right)
    || num(right.metadata?.nonObviousDiscovery?.frontierScore, 0) - num(left.metadata?.nonObviousDiscovery?.frontierScore, 0)
    || right.priorityScore - left.priorityScore
    || left.subjectKey.localeCompare(right.subjectKey)
  ));
}

export async function ensureUniversalResearchSchema(client) {
  await ensureAdjacentThemeCandidateSchema(client);
  await client.query(`
    CREATE TABLE IF NOT EXISTS universal_research_subjects (
      subject_key TEXT PRIMARY KEY,
      subject_label TEXT NOT NULL,
      subject_type TEXT NOT NULL,
      aliases TEXT[] NOT NULL DEFAULT '{}'::text[],
      symbols TEXT[] NOT NULL DEFAULT '{}'::text[],
      source_types TEXT[] NOT NULL DEFAULT '{}'::text[],
      source_refs JSONB NOT NULL DEFAULT '[]'::jsonb,
      data_packs TEXT[] NOT NULL DEFAULT '{}'::text[],
      priority_score DOUBLE PRECISION NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'active',
      last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_backfill_at TIMESTAMPTZ,
      last_research_cycle_at TIMESTAMPTZ,
      last_report_id TEXT,
      last_report_path TEXT,
      last_report_at TIMESTAMPTZ,
      last_report_quality JSONB NOT NULL DEFAULT '{}'::jsonb,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_universal_research_subjects_status_priority
      ON universal_research_subjects (status, priority_score DESC, updated_at DESC)
  `);
  await client.query(`
    ALTER TABLE universal_research_subjects
      ADD COLUMN IF NOT EXISTS last_report_at TIMESTAMPTZ
  `);
  await client.query(`
    CREATE TABLE IF NOT EXISTS universal_research_actions (
      id BIGSERIAL PRIMARY KEY,
      subject_key TEXT REFERENCES universal_research_subjects(subject_key) ON DELETE CASCADE,
      action_type TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'planned',
      reason TEXT,
      payload JSONB NOT NULL DEFAULT '{}'::jsonb,
      result JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      finished_at TIMESTAMPTZ
    )
  `);
  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_universal_research_actions_subject_time
      ON universal_research_actions (subject_key, action_type, created_at DESC)
  `);
  await client.query(`
    CREATE TABLE IF NOT EXISTS universal_research_runs (
      id BIGSERIAL PRIMARY KEY,
      status TEXT NOT NULL DEFAULT 'running',
      options JSONB NOT NULL DEFAULT '{}'::jsonb,
      summary JSONB NOT NULL DEFAULT '{}'::jsonb,
      started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      finished_at TIMESTAMPTZ
    )
  `);
}

async function loadRecentResearchSubjects(client, options = {}) {
  const sinceHours = Math.max(1, Math.floor(num(options.sinceHours, 336)));
  const limit = Math.max(1, Math.min(500, Math.floor(num(options.limit, 50))));
  const incoming = await queryOptional(client, `
    SELECT normalized_key, label, signal_type, source_types, linked_themes,
           evidence_refs, priority_score, status, updated_at
      FROM incoming_research_signals
     WHERE updated_at >= NOW() - make_interval(hours => $1::int)
     ORDER BY priority_score DESC NULLS LAST, updated_at DESC
     LIMIT $2
  `, [sinceHours, limit]);
  const crossTheme = await queryOptional(client, `
    SELECT c.id, c.themes, c.score, c.lane, c.status, c.reason, c.evidence_summary,
           COALESCE(sn.canonical_name, cn.canonical_name, c.reason, c.deterministic_id) AS label
      FROM cross_theme_candidates c
      LEFT JOIN knowledge_nodes cn ON c.connector_node_id = cn.id
      LEFT JOIN knowledge_nodes sn ON c.supplier_node_id = sn.id
     WHERE c.updated_at >= NOW() - make_interval(hours => $1::int)
     ORDER BY c.score DESC NULLS LAST, c.updated_at DESC
     LIMIT $2
  `, [sinceHours, limit]);
  return [
    ...incoming.rows.map((row) => ({
      subjectKey: row.normalized_key,
      label: row.label,
      aliases: row.linked_themes || [],
      sourceTypes: ['incoming_research_signals', ...(row.source_types || [])],
      sourceRefs: row.evidence_refs || [],
      priorityScore: row.priority_score,
      metadata: { signalType: row.signal_type, status: row.status },
    })),
    ...crossTheme.rows.map((row) => ({
      subjectKey: row.label || `candidate-${row.id}`,
      label: row.label || row.reason || `candidate-${row.id}`,
      aliases: row.themes || [],
      sourceTypes: ['cross_theme_candidates', row.lane],
      sourceRefs: [{ sourceType: 'cross_theme_candidates', sourceId: row.id }],
      priorityScore: num(row.score, 0) * 100,
      metadata: { themes: row.themes, lane: row.lane, status: row.status, evidenceSummary: row.evidence_summary },
    })),
  ];
}

export async function discoverUniversalResearchSubjects(client, options = {}) {
  const providerTargets = await discoverProviderBackfillTargets(client, options);
  const providerSubjects = providerTargets.map((target) => ({
    subjectKey: target.theme,
    label: target.label,
    aliases: target.aliases,
    symbols: target.symbols,
    sourceTypes: target.sources,
    sourceRefs: target.sourceRowIds?.map((id) => ({ sourceType: 'provider_target', sourceId: id })) || [],
    priorityScore: target.symbols?.length ? 75 : 55,
    metadata: { targetKey: target.targetKey, trackingTargetIds: target.trackingTargetIds || [] },
  }));
  const researchSubjects = await loadRecentResearchSubjects(client, options);
  const adjacentSubjects = await loadAdjacentThemeSubjects(client, {
    limit: options.adjacentLimit || options.limit || 50,
    statuses: options.strictEndogenousAdjacent ? ADJACENT_FRONTIER_REPORT_STATUSES : undefined,
    discoveryNamespace: options.strictEndogenousAdjacent ? STRICT_ENDOGENOUS_NAMESPACE : '',
    frontierOnly: Boolean(options.strictEndogenousAdjacent),
    excludeStaticAdjacentKeys: Boolean(options.strictEndogenousAdjacent),
    minStrictEndogenousVersion: options.strictEndogenousAdjacent ? STRICT_ENDOGENOUS_DISCOVERY_VERSION : 0,
  });
  const normalized = normalizeUniversalSubjects([...providerSubjects, ...researchSubjects, ...adjacentSubjects]);
  const filtered = options.strictEndogenousAdjacent
    ? normalized.filter(adjacentParentReadyForStrictMode)
    : normalized;
  const ordered = options.strictEndogenousAdjacent ? sortStrictEndogenousSubjects(filtered) : filtered;
  return ordered.slice(0, Math.max(1, Math.min(500, num(options.limit, 50))));
}

export async function upsertUniversalResearchSubjects(client, subjects = []) {
  const rows = [];
  for (const subject of subjects) {
    const result = await client.query(`
      INSERT INTO universal_research_subjects (
        subject_key, subject_label, subject_type, aliases, symbols, source_types,
        source_refs, data_packs, priority_score, status, last_seen_at, metadata, updated_at
      )
      VALUES ($1, $2, $3, $4::text[], $5::text[], $6::text[], $7::jsonb, $8::text[], $9, $10, NOW(), $11::jsonb, NOW())
      ON CONFLICT (subject_key) DO UPDATE SET
        subject_label = COALESCE(NULLIF(EXCLUDED.subject_label, ''), universal_research_subjects.subject_label),
        subject_type = EXCLUDED.subject_type,
        aliases = ARRAY(SELECT DISTINCT x FROM unnest(universal_research_subjects.aliases || EXCLUDED.aliases) AS x WHERE x IS NOT NULL AND x <> ''),
        symbols = ARRAY(SELECT DISTINCT x FROM unnest(universal_research_subjects.symbols || EXCLUDED.symbols) AS x WHERE x IS NOT NULL AND x <> ''),
        source_types = ARRAY(SELECT DISTINCT x FROM unnest(universal_research_subjects.source_types || EXCLUDED.source_types) AS x WHERE x IS NOT NULL AND x <> ''),
        source_refs = universal_research_subjects.source_refs || EXCLUDED.source_refs,
        data_packs = ARRAY(SELECT DISTINCT x FROM unnest(universal_research_subjects.data_packs || EXCLUDED.data_packs) AS x WHERE x IS NOT NULL AND x <> ''),
        priority_score = GREATEST(universal_research_subjects.priority_score, EXCLUDED.priority_score),
        status = CASE WHEN universal_research_subjects.status = 'archived' THEN 'archived' ELSE EXCLUDED.status END,
        last_seen_at = NOW(),
        metadata = universal_research_subjects.metadata || EXCLUDED.metadata,
        updated_at = NOW()
      RETURNING *
    `, [
      subject.subjectKey,
      subject.subjectLabel,
      subject.subjectType,
      subject.aliases,
      subject.symbols,
      subject.sourceTypes,
      JSON.stringify(subject.sourceRefs || []),
      subject.dataPacks,
      subject.priorityScore,
      subject.status,
      JSON.stringify(subject.metadata || {}),
    ]);
    rows.push(result.rows[0]);
  }
  return rows;
}

export async function recordUniversalResearchAction(client, {
  subjectKey = null,
  actionType,
  status = 'planned',
  reason = '',
  payload = {},
  result = {},
}) {
  const inserted = await client.query(`
    INSERT INTO universal_research_actions (
      subject_key, action_type, status, reason, payload, result,
      finished_at
    )
    VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, CASE WHEN $3 IN ('ok','failed','skipped') THEN NOW() ELSE NULL END)
    RETURNING id
  `, [subjectKey, actionType, status, reason, JSON.stringify(payload || {}), JSON.stringify(result || {})]);
  return inserted.rows[0];
}

export async function chooseReportSubjects(client, subjects = [], limit = 3, options = {}) {
  const maxSubjects = Math.max(1, Math.min(25, Math.floor(num(limit, 3))));
  const adjacentReadyStatuses = new Set(['ready_for_deep_report', 'non_obvious_bottleneck_ready']);
  const adjacentFrontierStatuses = new Set(['needs_scarcity_evidence', 'frontier_candidate']);
  const includeFrontierResearchLeads = Boolean(options.strictEndogenousAdjacent || options.includeFrontierAdjacentReports);
  const adjacentStatusPriority = (subject) => {
    const status = subject.metadata?.adjacentStatus || '';
    if (status === 'non_obvious_bottleneck_ready') return 0;
    if (status === 'ready_for_deep_report') return 1;
    if (includeFrontierResearchLeads && status === 'needs_scarcity_evidence') return 2;
    if (includeFrontierResearchLeads && status === 'frontier_candidate') return 3;
    return 9;
  };
  const adjacentLanePriority = (lane = '') => ({
    launch_fueling_or_cryogenic_infrastructure: 0,
    range_operations_or_ground_systems_support: 1,
    power_cooling_or_utility_infrastructure: 2,
    qualification_testing_or_mission_support: 3,
    propulsion_input_materials: 4,
    material_supply_or_substitution: 5,
  })[String(lane || '')] ?? 20;
  const reportableSubjectTypes = new Set([
    'theme',
    'theme_candidate',
    'cross_theme_candidate',
    'material_or_bottleneck',
    'company_or_symbol',
  ]);
  const reportableUniversalSubjects = subjects
    .filter((subject) => reportableSubjectTypes.has(subject.subject_type || subject.subjectType))
    .filter((subject) => !options.strictEndogenousAdjacent || adjacentParentReadyForStrictMode(subject))
    .map((subject, index) => ({
      key: subject.subject_key || subject.subjectKey,
      label: subject.subject_label || subject.subjectLabel || subject.label,
      type: subject.subject_type || subject.subjectType,
      priority: Number(subject.priority_score ?? subject.priorityScore ?? 0),
      metadata: subject.metadata || {},
      order: index,
    }))
    .filter((subject) => subject.key)
    .sort((a, b) => (b.priority - a.priority) || (a.order - b.order));
  const adjacentReadySubjects = reportableUniversalSubjects
    .filter((subject) => subject.type === 'material_or_bottleneck'
      && (
        !options.strictEndogenousAdjacent
        || subject.metadata?.discoveryNamespace !== STRICT_ENDOGENOUS_NAMESPACE
        || subject.metadata?.parentReadyForAdjacent === true
        || String(subject.metadata?.parentReadyForAdjacent || '').toLowerCase() === 'true'
      )
      && (
        adjacentReadyStatuses.has(subject.metadata?.adjacentStatus)
        || (
          includeFrontierResearchLeads
          && subject.metadata?.frontierDiscovery
          && subject.metadata?.discoveryNamespace === STRICT_ENDOGENOUS_NAMESPACE
          && adjacentFrontierStatuses.has(subject.metadata?.adjacentStatus)
        )
      ))
    .sort((left, right) => (
      adjacentStatusPriority(left) - adjacentStatusPriority(right)
      || adjacentLanePriority(left.metadata?.lane) - adjacentLanePriority(right.metadata?.lane)
      || strictEndogenousSpecificityRank({
        subjectKey: left.key,
        subjectLabel: left.label,
        subjectType: left.type,
        sourceTypes: [],
        metadata: left.metadata,
      }) - strictEndogenousSpecificityRank({
        subjectKey: right.key,
        subjectLabel: right.label,
        subjectType: right.type,
        sourceTypes: [],
        metadata: right.metadata,
      })
      || Number(right.metadata?.nonObviousDiscovery?.frontierScore || 0) - Number(left.metadata?.nonObviousDiscovery?.frontierScore || 0)
      || right.priority - left.priority
      || left.order - right.order
    ))
    .map((subject) => subject.key);
  const priorityKeys = uniqueStrings(adjacentReadySubjects, maxSubjects);
  if (priorityKeys.length >= maxSubjects) return priorityKeys;
  const strictFrontierParentSubjects = options.strictEndogenousAdjacent
    ? reportableUniversalSubjects
      .filter((subject) => subject.type === 'cross_theme_candidate')
      .map((subject) => {
        const evidenceSummary = subject.metadata?.evidenceSummary || subject.metadata?.evidence_summary || {};
        return {
          ...subject,
          parentReadyForAdjacent: evidenceSummary.parentReadyForAdjacent === true
            || String(evidenceSummary.parentReadyForAdjacent || '').toLowerCase() === 'true',
          frontierParentReportReady: evidenceSummary.frontierParentReportReady === true
            || String(evidenceSummary.frontierParentReportReady || '').toLowerCase() === 'true',
          frontierParentCollectionEligible: evidenceSummary.frontierParentCollectionEligible === true
            || String(evidenceSummary.frontierParentCollectionEligible || '').toLowerCase() === 'true',
          frontierParentScore: Number(evidenceSummary.frontierParentScore || 0),
          frontierScore: Number(evidenceSummary.nonObviousDiscovery?.frontierScore || 0),
        };
      })
      .filter((subject) => subject.parentReadyForAdjacent && (subject.frontierParentReportReady || subject.frontierParentCollectionEligible))
      .sort((left, right) => (
        Number(right.frontierParentReportReady) - Number(left.frontierParentReportReady)
        || right.frontierParentScore - left.frontierParentScore
        || right.frontierScore - left.frontierScore
        || right.priority - left.priority
        || left.order - right.order
      ))
      .map((subject) => subject.key)
    : [];
  if (strictFrontierParentSubjects.length) {
    const selected = uniqueStrings([...priorityKeys, ...strictFrontierParentSubjects], maxSubjects);
    if (selected.length >= maxSubjects) return selected;
  }
  const reportableThemeSubjects = subjects
    .filter((subject) => ['theme', 'theme_candidate'].includes(subject.subject_type || subject.subjectType))
    .map((subject, index) => ({
      key: subject.subject_key || subject.subjectKey,
      type: subject.subject_type || subject.subjectType,
      priority: Number(subject.priority_score ?? subject.priorityScore ?? 0),
      order: index,
    }))
    .filter((subject) => subject.key);
  const themeKeys = reportableThemeSubjects
    .map((subject) => subject.key)
    .filter(Boolean);
  const remainingSlots = Math.max(1, maxSubjects - priorityKeys.length);
  if (themeKeys.length) {
    const match = await queryOptional(client, `
      WITH requested(theme, subject_type, priority_score, subject_order) AS (
        SELECT *
          FROM jsonb_to_recordset($1::jsonb)
            AS x(theme text, subject_type text, priority_score double precision, subject_order int)
      ),
      latest AS (
        SELECT DISTINCT ON (tta.theme)
               tta.theme,
               tta.theme_label,
               tta.article_count,
               tta.unique_sources,
               tta.source_diversity,
               tta.computed_at,
               r.subject_type,
               r.priority_score,
               r.subject_order
          FROM theme_trend_aggregates tta
          JOIN requested r ON r.theme = tta.theme
         WHERE tta.theme IS NOT NULL
         ORDER BY tta.theme, tta.computed_at DESC NULLS LAST, tta.article_count DESC NULLS LAST
      )
      SELECT theme
        FROM latest
       ORDER BY
             CASE WHEN subject_type = 'theme' THEN 0 ELSE 1 END,
             CASE WHEN COALESCE(NULLIF(LOWER(theme_label), 'unknown'), theme) = theme THEN 1 ELSE 0 END,
             LEAST(COALESCE(priority_score, 0), 100) DESC,
             COALESCE(unique_sources, 0) DESC,
             COALESCE(source_diversity, 0) DESC,
             COALESCE(article_count, 0) DESC,
             subject_order ASC
       LIMIT $2
    `, [JSON.stringify(reportableThemeSubjects.map((subject) => ({
      theme: subject.key,
      subject_type: subject.type,
      priority_score: subject.priority,
      subject_order: subject.order,
    }))), remainingSlots]);
    const matches = uniqueStrings(match.rows.map((row) => row.theme).filter(Boolean), remainingSlots);
    if (priorityKeys.length || matches.length >= remainingSlots) {
      const selected = uniqueStrings([...priorityKeys, ...matches], maxSubjects);
      if (selected.length >= maxSubjects) return selected;
    }
    if (matches.length) {
      const supplement = uniqueStrings([
        ...priorityKeys,
        ...matches,
        ...reportableUniversalSubjects
          .filter((subject) => !priorityKeys.includes(subject.key) && !matches.includes(subject.key))
          .map((subject) => subject.key),
      ], maxSubjects);
      return supplement;
    }
  }
  const fallback = await queryOptional(client, `
    SELECT theme
      FROM theme_trend_aggregates
     WHERE theme IS NOT NULL
     ORDER BY COALESCE(unique_sources, 0) DESC,
              COALESCE(source_diversity, 0) DESC,
              COALESCE(article_count, 0) DESC,
              computed_at DESC NULLS LAST
     LIMIT $1
  `, [maxSubjects]);
  const fallbackThemes = uniqueStrings(fallback.rows.map((row) => row.theme).filter(Boolean), maxSubjects);
  if (priorityKeys.length || fallbackThemes.length >= maxSubjects) {
    const selected = uniqueStrings([...priorityKeys, ...fallbackThemes], maxSubjects);
    if (selected.length >= maxSubjects) return selected;
  }
  const supplemented = uniqueStrings([
    ...priorityKeys,
    ...fallbackThemes,
    ...reportableUniversalSubjects
      .filter((subject) => !priorityKeys.includes(subject.key) && !fallbackThemes.includes(subject.key))
      .map((subject) => subject.key),
  ], maxSubjects);
  return supplemented.length ? supplemented : ['cloud-infrastructure'];
}

export async function chooseReportSubject(client, subjects = []) {
  const [subject] = await chooseReportSubjects(client, subjects, 1);
  return subject || 'cloud-infrastructure';
}
