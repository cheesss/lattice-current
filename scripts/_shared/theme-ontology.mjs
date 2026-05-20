import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

function asArray(value) { return Array.isArray(value) ? value : []; }

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

function unique(items) {
  return [...new Set(asArray(items).map((item) => compactText(item)).filter(Boolean))];
}

function uniqueObjectsByName(items = []) {
  const seen = new Set();
  const out = [];
  for (const item of asArray(items)) {
    const name = compactText(item?.name || item?.label || item?.canonicalName || item);
    if (!name) continue;
    const role = compactText(item?.role || item?.discoveryRole || item?.type);
    const key = `${role}:${slugify(name)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ ...((typeof item === 'object' && item) || {}), name, role });
  }
  return out;
}

function num(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function ratio(numerator, denominator, emptyValue = 1) {
  const den = Number(denominator || 0);
  if (den <= 0) return emptyValue;
  return Math.max(0, Math.min(1, Number(numerator || 0) / den));
}

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_CONFIG_PATH = path.resolve(MODULE_DIR, '../../config/theme-ontology.defaults.json');

let cachedConfig = null;

export function loadThemeOntologyConfig(configPath = DEFAULT_CONFIG_PATH) {
  if (cachedConfig && configPath === DEFAULT_CONFIG_PATH) return cachedConfig;
  const parsed = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  if (configPath === DEFAULT_CONFIG_PATH) cachedConfig = parsed;
  return parsed;
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
  ].map(compactText).filter(Boolean).join(' ').toLowerCase();
}

function archetypeMatches(archetype = {}, theme = {}) {
  const text = themeText(theme);
  const keys = [
    theme.themeId,
    theme.theme,
    theme.key,
    theme.subjectId,
  ].map(slugify).filter(Boolean);
  const themeIds = asArray(archetype.themeIds).map(slugify);
  if (keys.some((key) => themeIds.includes(key))) return true;
  return asArray(archetype.matchPatterns).some((pattern) => {
    const needle = String(pattern || '').toLowerCase().trim();
    if (!needle) return false;
    if (/^[a-z0-9]{1,2}$/.test(needle)) {
      return new RegExp(`(^|[^a-z0-9])${needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z0-9]|$)`, 'i').test(text);
    }
    return text.includes(needle);
  });
}

function genericFallbackRequiredKpis() {
  return [
    {
      kpiKey: 'generic_independent_evidence_breadth',
      displayName: 'Independent evidence breadth',
      dataPack: 'evidencePack',
      unit: 'items',
      sourceTypes: ['daily_curated_news', 'approval_queue', 'source_registry'],
      freshnessSlaHours: 720,
      priority: 78,
      requiredFor: 'thesis_validation',
      critical: true,
      definitionText: 'Independent evidence breadth sufficient to separate real signal from isolated coverage.',
      queryTerms: ['independent evidence', 'source breadth', 'multiple sources', 'current evidence'],
    },
    {
      kpiKey: 'generic_operating_driver_evidence',
      displayName: 'Operating driver evidence',
      dataPack: 'industryPack',
      unit: 'items',
      sourceTypes: ['industry_kpi_observations', 'daily_curated_news', 'transcript_evidence', 'sec_filings_evidence'],
      freshnessSlaHours: 2160,
      priority: 86,
      requiredFor: 'investment_memo',
      critical: true,
      definitionText: 'Theme-specific operating driver, demand, supply, capacity, pricing, or utilization evidence.',
      queryTerms: ['operating driver', 'demand', 'supply', 'capacity', 'pricing', 'utilization'],
    },
    {
      kpiKey: 'generic_fundamental_market_bridge',
      displayName: 'Fundamental and market bridge',
      dataPack: 'marketPack',
      unit: 'items',
      sourceTypes: ['company_fundamentals', 'valuation_snapshots', 'market_quotes', 'stock_sensitivity_matrix'],
      freshnessSlaHours: 2160,
      priority: 84,
      requiredFor: 'investment_memo',
      critical: true,
      definitionText: 'Evidence linking the theme to issuer fundamentals, valuation expectations, or controlled market sensitivity.',
      queryTerms: ['revenue', 'margin', 'guidance', 'valuation', 'relative return', 'market sensitivity'],
    },
    {
      kpiKey: 'direct_management_commentary',
      displayName: 'Direct issuer management commentary',
      dataPack: 'transcriptPack',
      unit: 'symbols',
      sourceTypes: ['transcript_evidence', 'sec_filings_evidence'],
      freshnessSlaHours: 2160,
      priority: 88,
      requiredFor: 'investment_memo',
      critical: true,
      definitionText: 'Direct issuer commentary that can confirm or reject the theme-specific operating mechanism.',
      queryTerms: ['earnings call transcript', 'management commentary', 'guidance', 'demand', 'capacity'],
    },
  ];
}

export function resolveThemeOntology(theme = {}, options = {}) {
  const config = options.config || loadThemeOntologyConfig(options.configPath);
  const matches = asArray(config.archetypes).filter((archetype) => archetypeMatches(archetype, theme));
  const primary = matches[0] || null;
  if (!primary) {
    return {
      version: config.version,
      key: 'generic',
      label: 'Generic',
      themeIds: [],
      requiredKpis: genericFallbackRequiredKpis(),
      anchorFitRules: {
        highTerms: ['guidance', 'backlog', 'orders', 'capacity', 'utilization', 'pricing', 'contract', 'revenue', 'margin', 'capex'],
        mediumTerms: ['policy', 'adoption', 'demand', 'supply', 'investment', 'funding', 'deployment'],
        lowTerms: ['generic', 'culture', 'opinion', 'rumor', 'viral'],
      },
      issuerUniverse: { minDirectManagementCommentarySymbols: 1 },
      matchedArchetypes: [],
      isGenericFallback: true,
    };
  }
  return {
    ...primary,
    version: config.version,
    matchedArchetypes: matches.map((item) => item.key),
    isGenericFallback: false,
  };
}

function discoveryNodeTypeForRole(role = '', item = {}) {
  const explicit = compactText(item.nodeType || item.node_type);
  if (explicit) return explicit;
  const normalizedRole = slugify(role);
  if (normalizedRole.includes('supplier') || normalizedRole.includes('company')) return 'company';
  if (normalizedRole.includes('material') || normalizedRole.includes('commodity')) return 'material';
  if (normalizedRole.includes('component') || normalizedRole.includes('subsystem')) return 'component';
  if (normalizedRole.includes('infrastructure') || normalizedRole.includes('constraint') || normalizedRole.includes('bottleneck')) return 'infrastructure';
  if (normalizedRole.includes('policy') || normalizedRole.includes('geopolitical') || normalizedRole.includes('trigger')) return 'policy';
  if (normalizedRole.includes('driver')) return 'technology';
  return 'technology';
}

function discoveryRelationForRole(role = '') {
  const normalizedRole = slugify(role);
  if (normalizedRole.includes('supplier') || normalizedRole.includes('company')) return 'exposed_to';
  if (normalizedRole.includes('material') || normalizedRole.includes('component') || normalizedRole.includes('infrastructure')) return 'requires';
  if (normalizedRole.includes('constraint') || normalizedRole.includes('bottleneck')) return 'constrained_by';
  if (normalizedRole.includes('policy') || normalizedRole.includes('geopolitical') || normalizedRole.includes('trigger')) return 'influenced_by';
  return 'linked_to';
}

function quoteSearchTerm(value = '') {
  const text = compactText(value).replace(/"/g, '');
  if (!text) return '';
  return text.includes(' ') ? `"${text}"` : text;
}

function defaultDiscoverySourceQueries(item = {}, role = '', ontology = {}) {
  const name = compactText(item.name);
  if (!name) return [];
  const quotedName = quoteSearchTerm(name);
  const ontologyTerm = quoteSearchTerm(ontology.label || ontology.key);
  const mechanismTerms = compactText(item.mechanism || item.why || item.rationale)
    .split(/\s+/)
    .filter((term) => term.length >= 7)
    .slice(0, 4)
    .join(' ');
  if (/constraint|bottleneck|component|material|infrastructure/i.test(role)) {
    return unique([
      `${quotedName} capacity supplier evidence ${ontologyTerm}`.trim(),
      `${quotedName} production capacity backlog contract award supplier`.trim(),
      `${quotedName} technical qualification substitute supplier ${mechanismTerms}`.trim(),
    ]);
  }
  if (/supplier|company/i.test(role)) {
    return unique([
      `${quotedName} ${ontologyTerm} revenue backlog customer contract`.trim(),
      `${quotedName} production capacity guidance supplier evidence`.trim(),
    ]);
  }
  if (/policy|trigger|geopolitical/i.test(role)) {
    return unique([
      `${quotedName} procurement funding policy contract award`.trim(),
      `${quotedName} budget authorization procurement evidence`.trim(),
    ]);
  }
  return unique([
    `${quotedName} ${ontologyTerm} demand capacity evidence`.trim(),
    `${quotedName} adoption deployment customer evidence`.trim(),
  ]);
}

export function discoveryEntriesForTheme(theme = {}, options = {}) {
  const ontology = options.ontology || resolveThemeOntology(theme, options);
  const discovery = ontology.discovery || {};
  const groups = [
    ['driver', discovery.drivers],
    ['constraint', discovery.constraints],
    ['component', discovery.components],
    ['material', discovery.materials],
    ['supplier', discovery.suppliers],
    ['policy_trigger', discovery.policyTriggers || discovery.geopoliticalTriggers],
    ['technical_signal', discovery.technicalSignals],
  ];
  const entries = [];
  for (const [role, values] of groups) {
    for (const item of uniqueObjectsByName(values)) {
      const mergedRole = compactText(item.role || role);
      const explicitSourceQueries = unique(asArray(item.sourceQueries || item.source_queries));
      const sourceQueries = explicitSourceQueries.length
        ? explicitSourceQueries
        : defaultDiscoverySourceQueries(item, mergedRole, ontology);
      entries.push({
        name: item.name,
        role: mergedRole,
        nodeType: discoveryNodeTypeForRole(mergedRole, item),
        relationType: compactText(item.relationType || item.relation_type || discoveryRelationForRole(mergedRole)),
        aliases: unique(asArray(item.aliases)),
        importance: Math.max(0, Math.min(1, num(item.importance, mergedRole === 'constraint' ? 0.8 : 0.65))),
        constraintScore: Math.max(0, Math.min(1, num(item.constraintScore ?? item.constraint_score, /constraint|bottleneck|material|component/i.test(mergedRole) ? 0.75 : 0.35))),
        geopoliticalRelevance: Math.max(0, Math.min(1, num(item.geopoliticalRelevance ?? item.geopolitical_relevance, /policy|geopolitical|defense|procurement|sanction/i.test(`${mergedRole} ${item.name}`) ? 0.7 : 0.3))),
        technicalMaturity: Math.max(0, Math.min(1, num(item.technicalMaturity ?? item.technical_maturity, 0.5))),
        mechanism: compactText(item.mechanism || item.why || item.rationale),
        whyNow: compactText(item.whyNow || item.why_now || item.triggerReason),
        triggerTerms: unique(asArray(item.triggerTerms || item.trigger_terms || item.queryTerms)),
        sourceQueries,
        symbol: compactText(item.symbol || item.ticker).toUpperCase(),
        ontologyKey: ontology.key,
        ontologyLabel: ontology.label,
      });
    }
  }
  return entries;
}

export function discoveryProfileForTheme(theme = {}, options = {}) {
  const ontology = options.ontology || resolveThemeOntology(theme, options);
  const entries = discoveryEntriesForTheme(theme, { ...options, ontology });
  return {
    ontologyKey: ontology.key,
    ontologyLabel: ontology.label,
    isGenericFallback: Boolean(ontology.isGenericFallback),
    entries,
    drivers: entries.filter((entry) => entry.role === 'driver'),
    constraints: entries.filter((entry) => /constraint|bottleneck/i.test(entry.role)),
    components: entries.filter((entry) => entry.role === 'component'),
    materials: entries.filter((entry) => entry.role === 'material'),
    suppliers: entries.filter((entry) => entry.role === 'supplier'),
    triggers: entries.filter((entry) => /trigger|signal/i.test(entry.role)),
  };
}

export function ontologyKpiDefinitionsForTheme(theme = {}, options = {}) {
  const ontology = resolveThemeOntology(theme, options);
  return asArray(ontology.requiredKpis).map((definition) => ({
    kpiKey: normalizeKpiKey(definition.kpiKey),
    displayName: compactText(definition.displayName || definition.kpiKey),
    dataPack: compactText(definition.dataPack || 'industryPack'),
    unit: compactText(definition.unit || 'items'),
    leadingOrLagging: compactText(definition.leadingOrLagging || 'context'),
    sourceTypes: unique(definition.sourceTypes || ['manual_or_adapter']),
    freshnessSlaHours: Math.max(1, Math.floor(num(definition.freshnessSlaHours, 720))),
    priority: Math.max(1, Math.min(100, Math.floor(num(definition.priority, 80)))),
    definitionText: compactText(definition.definitionText || definition.displayName || definition.kpiKey),
    metadata: {
      ontologyVersion: ontology.version,
      ontologyKey: ontology.key,
      ontologyLabel: ontology.label,
      requiredFor: definition.requiredFor || 'thesis_validation',
      critical: Boolean(definition.critical),
      queryTerms: unique(definition.queryTerms),
    },
  }));
}

export function classifySymbolForOntology(symbol, options = {}) {
  const ticker = String(symbol || '').trim().toUpperCase();
  if (!ticker) return { symbol: ticker, securityType: 'unknown', issuer: false, reason: 'empty_symbol' };
  const config = options.config || loadThemeOntologyConfig(options.configPath);
  const excluded = new Set([
    ...asArray(config.global?.nonIssuerSymbols),
    ...asArray(options.excludeSymbols),
  ].map((item) => String(item || '').toUpperCase()));
  if (excluded.has(ticker)) return { symbol: ticker, securityType: 'fund_or_macro_proxy', issuer: false, reason: 'configured_non_issuer' };
  if (/^\^/.test(ticker) || /=F$/i.test(ticker) || /\./.test(ticker) && ticker.length > 5) {
    return { symbol: ticker, securityType: 'index_or_future', issuer: false, reason: 'market_proxy_pattern' };
  }
  if (/^[A-Z]{1,5}$/.test(ticker)) return { symbol: ticker, securityType: 'issuer', issuer: true, reason: 'ticker_shape' };
  return { symbol: ticker, securityType: 'unknown', issuer: false, reason: 'unsupported_symbol_shape' };
}

export function filterIssuerSymbols(symbols = [], options = {}) {
  return unique(asArray(symbols).map((symbol) => String(symbol || '').toUpperCase()))
    .filter((symbol) => classifySymbolForOntology(symbol, options).issuer);
}

function rowKpiKey(row = {}) {
  return normalizeKpiKey(row.kpi_key || row.kpiKey || row.metric_name || row.kpi_name || row.name);
}

function isFreshObservation(row = {}) {
  const status = String(row.freshness_status || row.freshnessStatus || '').toLowerCase();
  return !['stale', 'degraded', 'expired'].includes(status);
}

function observationText(row = {}) {
  const metadata = row.metadata || {};
  return [
    row.kpi_key,
    row.kpiKey,
    row.kpi_name,
    row.kpiName,
    row.metric_name,
    row.source_type,
    row.unit,
    row.title,
    row.excerpt,
    row.fact_text,
    metadata.excerpt,
    metadata.title,
    metadata.sourceBoundary,
    metadata.evidenceBoundary,
    ...asArray(metadata.matchedTerms),
  ].map(compactText).join(' ').toLowerCase();
}

function observationEvidenceText(row = {}) {
  const metadata = row.metadata || {};
  return [
    row.source_type,
    row.unit,
    row.excerpt,
    metadata.excerpt,
    metadata.title,
    metadata.sourceBoundary,
    metadata.evidenceBoundary,
    ...asArray(metadata.matchedTerms),
  ].map(compactText).join(' ').toLowerCase();
}

function observationSatisfiesDefinition(row = {}, definition = {}) {
  if (!isFreshObservation(row)) return false;
  const key = rowKpiKey(row);
  const targetKey = normalizeKpiKey(definition.kpiKey);
  const text = observationEvidenceText(row);
  const sourceType = compactText(row.source_type).toLowerCase();
  if (key !== targetKey) {
    if (targetKey === 'data_center_power_capacity') {
      const isElectricityProxy = ['electricity_demand_proxy', 'power_demand_proxy'].includes(key)
        || /eia|electricity|commercial sector electricity|power demand|grid interconnection|mw capacity/.test(text);
      if (isElectricityProxy) return true;
    }
    if (targetKey === 'hyperscaler_capex') {
      const isCapexProxy = ['capex_intensity_proxy', 'capital_expenditure', 'capital_expenditure_proxy'].includes(key)
        || (/capex|capital expenditure|capital expenditures|data center investment|cloud capex|ai capex/.test(text)
          && /sec_companyfacts|fmp|fundamental|cashflow|companyfacts/.test(`${sourceType} ${text}`));
      if (isCapexProxy) return true;
    }
    return false;
  }
  if (definition.kpiKey === 'defense_book_to_bill') {
    const unit = compactText(row.unit).toLowerCase();
    const numeric = Number(row.value_num ?? row.valueNum);
    return /book[-\s/]*to[-\s/]*bill|book\/bill|bookings[-\s/]*to[-\s/]*sales|orders[-\s/]*to[-\s/]*sales/.test(text)
      || (unit === 'ratio' && Number.isFinite(numeric) && numeric > 0 && numeric !== 1);
  }
  return true;
}

const WEAK_PACK_EVIDENCE_TERMS = new Set([
  'evidence',
  'current evidence',
  'multiple sources',
  'demand',
  'supply',
  'capacity',
  'orders',
  'guidance',
]);

function packEvidenceText(row = {}) {
  const metadata = row.metadata || {};
  const nestedRow = metadata.row || {};
  return [
    row.kpi_key,
    row.kpiKey,
    row.kpi_name,
    row.kpiName,
    row.metric_name,
    row.metricName,
    row.theme,
    row.symbol,
    row.ticker,
    row.unit,
    row.title,
    row.excerpt,
    row.fact_text,
    row.factText,
    row.summary,
    row.source_type,
    metadata.sourceType,
    metadata.provider,
    metadata.statement,
    metadata.concept,
    metadata.conceptDescription,
    nestedRow.metric_name,
    nestedRow.metricName,
    nestedRow.capitalExpenditure === undefined ? '' : `capitalExpenditure ${nestedRow.capitalExpenditure}`,
    nestedRow.operatingCashFlow === undefined ? '' : `operatingCashFlow ${nestedRow.operatingCashFlow}`,
    nestedRow.freeCashFlow === undefined ? '' : `freeCashFlow ${nestedRow.freeCashFlow}`,
  ].map(compactText).join(' ').toLowerCase();
}

function packEvidenceSatisfiesDefinition(row = {}, definition = {}) {
  if (definition.kpiKey === 'defense_book_to_bill') {
    // Do not let generated pack titles such as "Defense book-to-bill" clear
    // the investment gate. This KPI needs an actual observation/transcript
    // row with ratio/book-to-bill wording, not a generic pack attachment.
    return false;
  }
  const text = packEvidenceText(row);
  if (!text) return false;
  const targetKey = normalizeKpiKey(definition.kpiKey);
  const sourceType = compactText(row.source_type || row.sourceType || row.metadata?.sourceType || row.metadata?.provider).toLowerCase();
  if (targetKey === 'data_center_power_capacity') {
    const hasPowerCapacityTerm = /\b(data[-\s]?center power|power availability|power demand|grid interconnection|interconnection queue|mw capacity|megawatt|electricity demand|commercial sector electricity|substation|transmission capacity|utility connection)\b/i.test(text);
    const hasStructuredOrIndustrySource = /industry_kpi_observations|daily_curated_news|articles_keyword_proxy|theme_trend_aggregates|eia|utility|ferc|rto|sec_filings_evidence/.test(`${sourceType} ${text}`);
    const hasCapacityBuildoutProxy = /\b(capacity buildout proxy|cloud[-\s]?infrastructure.*capacity|data[-\s]?center.*capacity)\b/i.test(text);
    if (hasStructuredOrIndustrySource && (hasPowerCapacityTerm || hasCapacityBuildoutProxy)) return true;
  }
  if (targetKey === 'hyperscaler_capex') {
    const hasCapexTerm = /\b(capex|capital expenditure|capital expenditures|capitalexpenditure|capital allocation|infrastructure spending|data[-\s]?center investment|cloud capex|ai capex)\b/i.test(text);
    const hasIssuerFundamentalSource = /fmp|sec_companyfacts|company_fundamentals|cashflow|cash[-\s]?flow|companyfacts|sec_filings_evidence|transcript_evidence/.test(`${sourceType} ${text}`);
    if (hasCapexTerm && hasIssuerFundamentalSource) return true;
  }
  const terms = unique([
    definition.displayName,
    definition.kpiKey,
    definition.definitionText,
    ...asArray(definition.metadata?.queryTerms),
  ]).map((term) => term.toLowerCase());
  const matched = terms.filter((term) => term && text.includes(term));
  if (!matched.length) return false;
  const strongMatched = matched.filter((term) => {
    const normalized = term.replace(/[^a-z0-9]+/g, ' ').trim();
    if (!normalized || WEAK_PACK_EVIDENCE_TERMS.has(normalized)) return false;
    return normalized.length >= 7 || /\s/.test(normalized);
  });
  return strongMatched.length > 0 || matched.length >= 2;
}

function evidenceRowSatisfiesDefinition(row = {}, definition = {}) {
  const text = packEvidenceText(row);
  if (!text) return false;
  if (definition.kpiKey === 'defense_book_to_bill') {
    return /book[-\s/]*to[-\s/]*bill|book\/bill|bookings[-\s/]*to[-\s/]*sales|orders[-\s/]*to[-\s/]*sales/.test(text);
  }
  return packEvidenceSatisfiesDefinition(row, definition);
}

function directManagementRows(rows = [], issuerSymbols = []) {
  const issuers = new Set(asArray(issuerSymbols).map((symbol) => String(symbol || '').toUpperCase()));
  return asArray(rows).filter((row) => {
    const symbol = String(row.symbol || row.ticker || '').toUpperCase();
    if (symbol && issuers.size && !issuers.has(symbol)) return false;
    const text = `${row.source_type || ''} ${row.topic || ''} ${row.title || ''} ${row.metadata?.directTranscriptEvidence || ''} ${row.metadata?.directManagementCommentaryEvidence || ''} ${row.metadata?.proxyCaveat || ''}`;
    if (/proxy/i.test(text)) return false;
    return (
      row.metadata?.directManagementCommentaryEvidence === true
      || row.metadata?.directManagementCommentaryEvidence === 'true'
      || row.metadata?.directTranscriptEvidence === true
      || row.metadata?.directTranscriptEvidence === 'true'
      || /direct_management_commentary|earnings[_-]?release|earnings[_-]?call|transcript|8-k direct management/i.test(text)
    );
  });
}

export function scoreOntologyAnchorFit(anchor = {}, ontology = {}) {
  const rules = ontology.anchorFitRules || {};
  const text = [
    anchor.title,
    anchor.summary,
    anchor.one_line_summary,
    anchor.why_it_matters,
    anchor.theme,
    anchor.topic_label,
  ].map(compactText).join(' ').toLowerCase();
  const has = (terms) => asArray(terms).some((term) => text.includes(String(term || '').toLowerCase()));
  const high = has(rules.highTerms);
  const medium = has(rules.mediumTerms);
  const low = has(rules.lowTerms);
  const isDefense = /defense_industrial|defense/i.test(`${ontology.key || ''} ${ontology.label || ''}`);
  if (isDefense) {
    const hasDefenseContext = has([
      'defense',
      'military',
      'dod',
      'pentagon',
      'nato',
      'munitions',
      'missile',
      'air defense',
      'shipyard',
      'fighter',
      'contractor',
      'procurement budget',
      'program award',
      'contract award',
    ]);
    if (low && !hasDefenseContext) {
      return {
        label: 'low',
        score: 0.25,
        reason: `Adjacent or noisy evidence for ${ontology.label || 'the theme'}; use as context, not thesis support`,
      };
    }
    if (high && !hasDefenseContext) {
      return {
        label: 'unknown',
        score: 0.4,
        reason: 'Procurement-like wording lacks defense operating context',
      };
    }
  }
  const label = high ? 'high' : medium ? 'medium' : low ? 'low' : 'unknown';
  const score = high ? 1 : medium ? 0.66 : low ? 0.25 : 0.4;
  return {
    label,
    score,
    reason: label === 'high'
      ? `${ontology.label || 'Theme'} operating KPI or mechanism evidence`
      : label === 'medium'
        ? `${ontology.label || 'Theme'} context evidence, but not direct operating KPI confirmation`
        : label === 'low'
          ? `Adjacent or noisy evidence for ${ontology.label || 'the theme'}; use as context, not thesis support`
          : 'Insufficient ontology terms to classify the anchor',
  };
}

function anchorFitDistribution(anchors = [], ontology = {}) {
  const distribution = { high: 0, medium: 0, low: 0, unknown: 0 };
  const scored = asArray(anchors).map((anchor) => ({ anchor, fit: scoreOntologyAnchorFit(anchor, ontology) }));
  for (const item of scored) distribution[item.fit.label] = (distribution[item.fit.label] || 0) + 1;
  return { distribution, scored };
}

export function evaluateOntologyCoverage(bundle = {}, options = {}) {
  const ontology = options.ontology || resolveThemeOntology({
    themeId: bundle.subject?.subjectId,
    themeLabel: bundle.subject?.displayName,
    category: bundle.metadata?.row?.category || bundle.metadata?.themeContext?.category,
    parentTheme: bundle.metadata?.row?.parent_theme || bundle.metadata?.themeContext?.parentTheme,
    metadata: bundle.subject?.metadata,
  }, options);
  const requiredKpis = ontologyKpiDefinitionsForTheme({
    themeId: bundle.subject?.subjectId,
    themeLabel: bundle.subject?.displayName,
    category: bundle.metadata?.row?.category || bundle.metadata?.themeContext?.category,
    parentTheme: bundle.metadata?.row?.parent_theme || bundle.metadata?.themeContext?.parentTheme,
    metadata: bundle.subject?.metadata,
  }, { ...options, config: options.config }).filter((definition) => definition.metadata?.ontologyKey === ontology.key);
  const kpiState = options.kpiState || options.rows?.genericKpis || {};
  const observations = asArray(kpiState.observations);
  const packEvidenceRows = options.packEvidenceRows || {};
  const hasPackEvidence = (definition) => asArray(packEvidenceRows[definition.dataPack])
    .some((row) => packEvidenceSatisfiesDefinition(row, definition));
  const symbols = unique([
    ...asArray(options.symbols),
    ...asArray(options.rows?.symbols),
    ...asArray(bundle.marketReactions).map((row) => row.symbol),
    ...asArray(bundle.metadata?.themeContext?.peerSymbols?.positive).map((row) => row.symbol),
    ...asArray(bundle.metadata?.themeContext?.peerSymbols?.negative).map((row) => row.symbol),
  ]).map((symbol) => symbol.toUpperCase());
  const issuerUniverseSymbols = filterIssuerSymbols(symbols, {
    ...options,
    excludeSymbols: ontology.issuerUniverse?.excludeSymbols,
  });
  const directRows = directManagementRows(options.transcripts || options.rows?.transcripts || [], issuerUniverseSymbols);
  const directManagementSymbols = new Set(directRows.map((row) => String(row.symbol || row.ticker || '').toUpperCase()).filter(Boolean));
  const requiredIssuerCommentary = Math.min(
    Math.max(0, num(ontology.issuerUniverse?.minDirectManagementCommentarySymbols, 0)),
    issuerUniverseSymbols.length || num(ontology.issuerUniverse?.minDirectManagementCommentarySymbols, 0),
  );
  const statusByKpi = requiredKpis.map((definition) => {
    const key = definition.kpiKey;
    const isDirectCommentary = key === 'direct_management_commentary';
    const hasObservation = observations.some((row) => observationSatisfiesDefinition(row, definition));
    const hasDirectEvidence = directRows.some((row) => evidenceRowSatisfiesDefinition(row, definition));
    const satisfied = isDirectCommentary
      ? requiredIssuerCommentary > 0 && directManagementSymbols.size >= requiredIssuerCommentary
      : hasObservation || hasDirectEvidence || hasPackEvidence(definition);
    return {
      kpiKey: key,
      displayName: definition.displayName,
      dataPack: definition.dataPack,
      requiredFor: definition.metadata?.requiredFor || 'thesis_validation',
      critical: Boolean(definition.metadata?.critical),
      priority: definition.priority,
      queryTerms: asArray(definition.metadata?.queryTerms),
      satisfied,
      reason: satisfied
        ? (hasObservation || hasDirectEvidence ? 'fresh observation or direct issuer evidence is available' : 'report backfill evidence is attached for this data pack')
        : 'required ontology KPI is not satisfied by current evidence',
    };
  });
  const missing = statusByKpi.filter((item) => !item.satisfied);
  const investmentCriticalGaps = missing.filter((item) => item.critical && item.requiredFor === 'investment_memo');
  const thesisCriticalGaps = missing.filter((item) => item.critical);
  const industryKpis = statusByKpi.filter((item) => item.dataPack === 'industryPack');
  const anchors = [
    ...asArray(bundle.metadata?.themeContext?.events),
    ...asArray(bundle.evidence).slice(0, 20),
  ];
  const fit = anchorFitDistribution(anchors, ontology);
  const requiredKpiCoverage = ratio(statusByKpi.length - missing.length, statusByKpi.length, ontology.isGenericFallback ? 1 : 0);
  const issuerCommentaryCoverage = ratio(directManagementSymbols.size, requiredIssuerCommentary, requiredIssuerCommentary ? 0 : 1);
  const industryKpiCoverage = ratio(industryKpis.filter((item) => item.satisfied).length, industryKpis.length, industryKpis.length ? 0 : 1);
  const blockers = [];
  if (investmentCriticalGaps.length) {
    blockers.push(`theme ontology critical KPI coverage ${(requiredKpiCoverage * 100).toFixed(0)}%; missing ${investmentCriticalGaps.slice(0, 5).map((item) => item.displayName).join(', ')}`);
  }
  if (requiredIssuerCommentary > 0 && directManagementSymbols.size < requiredIssuerCommentary) {
    blockers.push(`direct issuer management-commentary coverage ${directManagementSymbols.size}/${requiredIssuerCommentary} is below ontology threshold`);
  }
  const readinessTier = blockers.length
    ? 'signal_triage'
    : thesisCriticalGaps.length
      ? 'thesis_validation'
      : 'investment_memo_candidate';
  return {
    version: ontology.version,
    ontologyKey: ontology.key,
    ontologyLabel: ontology.label,
    anchorFitRules: ontology.anchorFitRules || {},
    matchedArchetypes: ontology.matchedArchetypes || [],
    isGenericFallback: Boolean(ontology.isGenericFallback),
    requiredKpiCount: statusByKpi.length,
    satisfiedKpiCount: statusByKpi.filter((item) => item.satisfied).length,
    requiredKpiCoverage: Math.round(requiredKpiCoverage * 1000) / 1000,
    investmentCriticalGapCount: investmentCriticalGaps.length,
    thesisCriticalGapCount: thesisCriticalGaps.length,
    issuerUniverseSymbols,
    excludedSymbols: symbols.filter((symbol) => !issuerUniverseSymbols.includes(symbol)),
    directManagementCommentarySymbolCount: directManagementSymbols.size,
    requiredIssuerCommentarySymbolCount: requiredIssuerCommentary,
    issuerCommentaryCoverage: Math.round(issuerCommentaryCoverage * 1000) / 1000,
    industryKpiCoverage: Math.round(industryKpiCoverage * 1000) / 1000,
    anchorFitDistribution: fit.distribution,
    topAnchorFits: fit.scored
      .sort((a, b) => b.fit.score - a.fit.score)
      .slice(0, 8)
      .map((item) => ({
        title: item.anchor.title || item.anchor.topic_label || item.anchor.evidenceId || item.anchor.evidence_id || 'anchor',
        fit: item.fit,
      })),
    kpis: statusByKpi,
    missingKpis: missing,
    blockers,
    readinessTier,
    boundary: 'deterministic theme ontology coverage; missing KPIs become collection tasks, not hidden report assumptions',
  };
}

export function buildOntologyBackfillTasks(coverage = {}, options = {}) {
  const subject = compactText(options.subject || coverage.ontologyLabel || 'theme');
  const issuerSymbols = asArray(coverage.issuerUniverseSymbols).slice(0, 8);
  const issuerPhrase = issuerSymbols.length ? ` ${issuerSymbols.join(' ')}` : '';
  const tasks = [];
  for (const gap of asArray(coverage.missingKpis).filter((item) => item.critical).slice(0, 8)) {
    const queryTerms = unique(gap.queryTerms).join(' ');
    const query = gap.kpiKey === 'direct_management_commentary'
      ? `${subject}${issuerPhrase} earnings call transcript management commentary backlog book-to-bill contract awards guidance`
      : `${subject}${issuerPhrase} ${gap.displayName} ${queryTerms} evidence`;
    tasks.push({
      packName: gap.dataPack || 'industryPack',
      taskType: 'source_query',
      query: query.replace(/\s+/g, ' ').trim(),
      reason: `${coverage.ontologyLabel || 'Theme'} ontology requires ${gap.displayName} before upgrading investment readiness.`,
      severity: gap.requiredFor === 'investment_memo' ? 'high' : 'medium',
      priority: Math.max(70, Math.min(98, num(gap.priority, 80))),
      collectionPlan: true,
      collectionKind: 'ontology_required_kpi',
      requiredFor: gap.requiredFor || 'investment_memo',
      target: {
        ontologyKey: coverage.ontologyKey,
        kpiKey: gap.kpiKey,
        displayName: gap.displayName,
        issuerUniverseSymbols: issuerSymbols,
      },
      metadata: {
        ontologyKey: coverage.ontologyKey,
        ontologyLabel: coverage.ontologyLabel,
        kpiKey: gap.kpiKey,
        collectionPlan: true,
        collectionKind: 'ontology_required_kpi',
        reviewGate: true,
      },
    });
  }
  return tasks;
}
