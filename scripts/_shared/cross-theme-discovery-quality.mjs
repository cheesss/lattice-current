import { evidenceClassesForReportContract } from './universal-evidence-contract.mjs';

function asArray(value) { return Array.isArray(value) ? value : []; }

function compactText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function normalize(value) {
  return compactText(value).toLowerCase();
}

function titleCase(value = '') {
  return String(value || '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function num(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clamp(value, min = 0, max = 1) {
  return Math.max(min, Math.min(max, num(value, min)));
}

function unique(values = []) {
  return [...new Set(asArray(values).map(compactText).filter(Boolean))];
}

export const DISCOVERY_EVIDENCE_CLASSES = [
  'supplier_capacity',
  'technical_qualification',
  'procurement_trigger',
  'substitution_limit',
  'issuer_exposure',
  'negative_control',
];

const PROMOTION_EVIDENCE_CLASSES = DISCOVERY_EVIDENCE_CLASSES
  .filter((item) => item !== 'negative_control');

const EXCLUDED_DISCOVERY_CONTRACT_CLASSES = new Set([
  'market_validation',
  'historical_analog',
  'primary_filing',
  'issuer_commentary',
]);

const SYMBOL_STOPLIST = new Set([
  'AI', 'ML', 'API', 'SEC', 'FMP', 'EIA', 'FERC', 'RTO', 'ETF', 'GDP', 'CPI',
  'MW', 'GPU', 'CPU', 'ASIC', 'FPGA', 'PDF', 'HTML', 'CSV', 'JSON',
]);

function rowMetadata(row = {}) {
  return row.metadata || {};
}

function nestedProviderRow(row = {}) {
  return rowMetadata(row).row || {};
}

function nestedProviderMetadata(row = {}) {
  return nestedProviderRow(row).metadata || {};
}

function metadataValue(row = {}, key = '') {
  const metadata = rowMetadata(row);
  const nested = nestedProviderRow(row);
  const nestedMetadata = nestedProviderMetadata(row);
  return metadata[key] ?? nested[key] ?? nestedMetadata[key];
}

function metadataArray(row = {}, key = '') {
  const value = metadataValue(row, key);
  return Array.isArray(value) ? value : (value === undefined || value === null || value === '' ? [] : [value]);
}

function evidenceSymbols(row = {}) {
  const nested = nestedProviderRow(row);
  const nestedMetadata = nestedProviderMetadata(row);
  return unique([
    row.symbol,
    row.ticker,
    row.metadata?.symbol,
    row.metadata?.ticker,
    row.metadata?.issuerSymbol,
    row.metadata?.issuer_symbol,
    nested.symbol,
    nested.ticker,
    nested.issuerSymbol,
    nested.issuer_symbol,
    nestedMetadata.symbol,
    nestedMetadata.ticker,
    nestedMetadata.issuerSymbol,
  ].map((value) => compactText(value).toUpperCase()))
    .filter((symbol) => /^[A-Z][A-Z0-9.-]{0,9}$/.test(symbol) && !SYMBOL_STOPLIST.has(symbol));
}

function evidenceUseValue(row = {}) {
  return normalize(metadataValue(row, 'evidenceUse') || metadataValue(row, 'sourceQueryEvidenceUse') || row.evidenceUse || row.sourceQueryEvidenceUse);
}

function isIssuerScopedProviderEvidence(row = {}, sourceText = '') {
  if (!evidenceSymbols(row).length) return false;
  return /\b(sec|fmp|companyfacts|company_fundamentals|fundamental|valuation|transcript|earnings[-_\s]?release|management commentary|issuer|filing)\b/i
    .test(sourceText);
}

function words(value = '') {
  return normalize(value)
    .replace(/[^a-z0-9]+/g, ' ')
    .split(/\s+/)
    .filter((word) => word.length >= 3);
}

function evidenceText(row = {}) {
  const metadata = row.metadata || {};
  const nested = nestedProviderRow(row);
  const nestedMetadata = nestedProviderMetadata(row);
  const providerRow = metadata.row || {};
  return normalize([
    row.symbol,
    row.ticker,
    row.theme,
    row.kpi_key,
    row.kpiKey,
    row.kpi_name,
    row.kpiName,
    row.metric_name,
    row.metricName,
    row.source_type,
    row.sourceType,
    row.title,
    row.label,
    row.publisher,
    row.kind,
    row.evidenceGrade,
    row.evidence_grade,
    row.excerpt,
    row.fact_text,
    row.factText,
    row.summary,
    row.textExcerpt,
    ...asArray(row.atomicFacts).map((fact) => fact?.text || fact?.factText || fact?.statement || fact),
    metadata.title,
    metadata.excerpt,
    metadata.textExcerpt,
    metadata.sourceType,
    metadata.sourceProvider,
    metadata.provider,
    metadata.statement,
    metadata.concept,
    metadata.conceptDescription,
    metadata.evidenceStrength,
    metadata.desiredEvidenceClass,
    metadata.evidenceClass,
    metadata.evidenceUse,
    providerRow.metric_name,
    providerRow.metricName,
    providerRow.capitalExpenditure === undefined ? '' : `capitalExpenditure ${providerRow.capitalExpenditure}`,
    providerRow.operatingCashFlow === undefined ? '' : `operatingCashFlow ${providerRow.operatingCashFlow}`,
    providerRow.freeCashFlow === undefined ? '' : `freeCashFlow ${providerRow.freeCashFlow}`,
    providerRow.revenue === undefined ? '' : `revenue ${providerRow.revenue}`,
    nested.symbol,
    nested.ticker,
    nested.theme,
    nested.kpi_key,
    nested.kpiKey,
    nested.kpi_name,
    nested.kpiName,
    nested.metric_name,
    nested.metricName,
    nested.title,
    nested.label,
    nested.publisher,
    nested.source_type,
    nested.sourceType,
    nested.kind,
    nested.excerpt,
    nested.fact_text,
    nested.factText,
    nested.summary,
    nested.textExcerpt,
    ...asArray(nested.atomicFacts).map((fact) => fact?.text || fact?.factText || fact?.statement || fact),
    nested.mechanism,
    nested.direction,
    nested.edgeType,
    nested.sourceNode,
    nested.targetNode,
    nestedMetadata.title,
    nestedMetadata.excerpt,
    nestedMetadata.sourceType,
    nestedMetadata.sourceProvider,
    nestedMetadata.provider,
    nestedMetadata.desiredEvidenceClass,
    nestedMetadata.evidenceClass,
    nestedMetadata.evidenceUse,
    ...asArray(metadata.matchedTerms),
  ].map(compactText).join(' '));
}

function candidateFromBundle(bundle = {}) {
  const candidate = bundle.metadata?.candidate || {};
  const summary = candidate.evidence_summary || candidate.evidenceSummary || {};
  const discovery = candidate.discovery || summary.discovery || bundle.subject?.metadata?.discovery || bundle.metadata?.discovery || {};
  const themes = unique([
    ...asArray(candidate.themes),
    ...asArray(bundle.subject?.metadata?.themes),
    ...asArray(bundle.subject?.themes),
  ]);
  return { candidate, summary, discovery, themes };
}

export function isStrictEndogenousBundle(bundle = {}) {
  const discovery = bundle.subject?.metadata?.discovery || {};
  const adjacentMetadata = bundle.metadata?.adjacentCandidate?.metadata || {};
  const subjectMetadata = bundle.subject?.metadata || {};
  const bundleMetadata = bundle.metadata || {};
  return discovery.discoveryNamespace === 'strict_endogenous_adjacent'
    || adjacentMetadata.discoveryNamespace === 'strict_endogenous_adjacent'
    || subjectMetadata.discoveryNamespace === 'strict_endogenous_adjacent'
    || bundleMetadata.discoveryNamespace === 'strict_endogenous_adjacent'
    || bundleMetadata.strictEndogenous === true
    || bundleMetadata.strictEndogenousAdjacent === true
    || subjectMetadata.strictEndogenousAdjacent === true
    || adjacentMetadata.strictEndogenousAdjacent === true
    || discovery.frontierDiscovery === true
    || subjectMetadata.frontierDiscovery === true
    || bundleMetadata.frontierDiscovery === true
    || adjacentMetadata.frontierDiscovery === true;
}

export function isCrossThemeDiscoveryReport(bundle = {}) {
  return bundle.reportType === 'cross_theme_bottleneck_report'
    || bundle.subject?.subjectType === 'cross_theme_candidate'
    || bundle.subject?.subject_type === 'cross_theme_candidate';
}

export function crossThemeEvidenceTerms(bundle = {}) {
  const { discovery, themes } = candidateFromBundle(bundle);
  const strictEndogenous = isStrictEndogenousBundle(bundle);
  const subject = compactText(bundle.subject?.displayName || bundle.subject?.subjectId);
  const ontology = bundle.metadata?.deepResearch?.ontologyPack || {};
  const ontologyTerms = strictEndogenous ? [] : unique([
    ontology.ontologyKey,
    ontology.ontologyLabel,
    ...asArray(ontology.anchorFitRules?.highTerms),
    ...asArray(ontology.anchorFitRules?.mediumTerms),
    ...asArray(ontology.kpis).flatMap((kpi) => [kpi.displayName, kpi.kpiKey, ...asArray(kpi.queryTerms)]),
    ...asArray(ontology.missingKpis).flatMap((kpi) => [kpi.displayName, kpi.kpiKey, ...asArray(kpi.queryTerms)]),
  ]);
  const adjacentMetadata = bundle.metadata?.adjacentCandidate?.metadata || {};
  const concreteNodeTerms = unique([
    ...asArray(discovery.concreteBottleneckNodes).flatMap((node) => [
      node?.node,
      node?.key,
    ]),
    ...asArray(adjacentMetadata.concreteBottleneckNodes).flatMap((node) => [
      node?.node,
      node?.key,
    ]),
    ...asArray(discovery.concreteBottleneckNodeSummary?.topNodes),
    ...asArray(adjacentMetadata.concreteBottleneckNodeSummary?.topNodes),
  ]);
  const normalizedParentTerms = new Set([
    discovery.connector,
    ontology.ontologyKey,
    ontology.ontologyLabel,
    ...themes,
  ].map((term) => normalize(term).replace(/[^a-z0-9]+/g, ' ').trim()).filter(Boolean));
  const isParentThemeOnlyTerm = (term = '') => {
    const normalized = normalize(term).replace(/[^a-z0-9]+/g, ' ').trim();
    return normalizedParentTerms.has(normalized);
  };
  const connectorTerms = unique([
    subject,
    ...(strictEndogenous ? [] : [discovery.connector]),
    discovery.name,
    ...(strictEndogenous ? [] : [ontology.ontologyLabel]),
    ...concreteNodeTerms,
    ...(strictEndogenous && concreteNodeTerms.length ? [] : asArray(discovery.triggerTerms)),
    ...(strictEndogenous && concreteNodeTerms.length ? [] : asArray(discovery.sourceQueries).flatMap((query) => {
      const quoted = [...String(query || '').matchAll(/"([^"]+)"/g)].map((match) => match[1]);
      return quoted.length ? quoted : [query];
    })),
  ]).filter((term) => {
    if (strictEndogenous && isParentThemeOnlyTerm(term)) return false;
    return words(term).length >= 2 || /rocket|motor|capacity|supplier|material/i.test(term);
  });

  const globalDomainTerms = strictEndogenous ? [] : [
    'defense',
    'missile',
    'interceptor',
    'pentagon',
    'dod',
    'procurement',
    'munitions',
    'space',
    'launch',
    'rocket',
    'propulsion',
    'vehicle',
    'ai',
    'machine learning',
    'cloud',
    'data center',
    'datacenter',
    'power',
    'grid',
    'utility',
    'electricity',
    'interconnection',
    'semiconductor',
    'clean energy',
    'cybersecurity',
  ];

  const themeTerms = unique([
    ...(strictEndogenous ? [] : [discovery.connector, ontology.ontologyKey, ontology.ontologyLabel]),
    ...ontologyTerms,
    ...themes.flatMap((theme) => String(theme || '').split(/[-_\s]+/)),
    ...asArray(discovery.triggerTerms).flatMap((term) => String(term || '').split(/[-_\s]+/)),
    ...globalDomainTerms,
  ]).filter((term) => words(term).length || term.length >= 3);

  const supplierTerms = unique([
    discovery.supplier,
    ...(strictEndogenous ? [] : [
      'aerojet',
      'northrop',
      'karman',
      'systima',
      'x-bow',
      'xbow',
    ]),
  ]).filter(Boolean);

  return { connectorTerms, themeTerms, supplierTerms };
}

const GENERIC_CONNECTOR_WORDS = new Set([
  'capacity',
  'supplier',
  'market',
  'evidence',
  'backlog',
  'production',
  'growth',
  'theme',
  'industry',
]);

function containsWord(text = '', word = '') {
  const escaped = String(word || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return Boolean(escaped && new RegExp(`\\b${escaped}\\b`, 'i').test(text));
}

function termHit(text, terms = []) {
  return asArray(terms).some((term) => {
    const normalized = normalize(term);
    if (!normalized) return false;
    if (normalized.length >= 10 && text.includes(normalized)) return true;
    const termWords = words(normalized);
    if (!termWords.length) return false;
    if (termWords.length >= 2) {
      const specificHits = termWords
        .filter((word) => !GENERIC_CONNECTOR_WORDS.has(word))
        .filter((word) => containsWord(text, word));
      const genericHits = termWords
        .filter((word) => GENERIC_CONNECTOR_WORDS.has(word))
        .filter((word) => containsWord(text, word));
      return specificHits.length >= 1 && (specificHits.length + genericHits.length >= 2 || specificHits.some((word) => word.length >= 6));
    }
    const [word] = termWords;
    return !GENERIC_CONNECTOR_WORDS.has(word) && containsWord(text, word);
  });
}

const STRICT_GENERIC_CONNECTOR_WORDS = new Set([
  ...GENERIC_CONNECTOR_WORDS,
  'bottleneck',
  'constraint',
  'generated',
  'node',
]);

function strictGeneratedTermHit(text, terms = []) {
  return asArray(terms).some((term) => {
    const normalized = normalize(term);
    if (!normalized) return false;
    if (normalized.length >= 10 && text.includes(normalized)) return true;
    const termWords = words(normalized);
    if (termWords.length < 2) return false;
    const specificHits = termWords
      .filter((word) => !STRICT_GENERIC_CONNECTOR_WORDS.has(word))
      .filter((word) => containsWord(text, word));
    const genericHits = termWords
      .filter((word) => STRICT_GENERIC_CONNECTOR_WORDS.has(word))
      .filter((word) => containsWord(text, word));
    return specificHits.length >= 2;
  });
}

function connectorSpecificity(bundle = {}) {
  const subject = compactText(bundle.subject?.displayName || bundle.subject?.subjectId);
  const tokenCount = words(subject).length;
  const generic = /^(technology|software|platform|capacity|component|supplier|infrastructure|market|growth)$/i.test(subject);
  const technical = /rocket|motor|nozzle|energetic|propellant|semiconductor|hbm|transformer|switchgear|cryogenic|helium|cooling|grid|interconnection|substrate|wafer|launch|sensor|battery|uranium|copper/i.test(subject);
  return clamp((generic ? 0.15 : 0.25) + Math.min(0.45, tokenCount * 0.12) + (technical ? 0.35 : 0));
}

function sourceSlug(value = '') {
  return normalize(value)
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function isMarketReportText(text = '') {
  return /market size|market share|forecast|growth report|pages|tables|market report|research report|cagr|by 20[0-9]{2}/i.test(text);
}

function isOfficialPublicPlanningEvidence(row = {}, text = evidenceText(row)) {
  return /\b(public_planning_source|doe|doe-i2x|lbl|national[-_\s]?lab|eia|ferc|rto|iso|utility)\b/i
    .test(`${row.kind || ''} ${row.publisher || ''} ${row.source_type || row.sourceType || ''} ${row.metadata?.sourceType || ''} ${row.metadata?.sourceProvider || ''} ${nestedProviderRow(row).source_type || ''} ${nestedProviderMetadata(row).sourceProvider || ''} ${text}`);
}

function isDeepPackSummary(row = {}, text = evidenceText(row)) {
  return /deep[-_\s]?pack[-_\s]?summary|deep research pack summary|lattice research os|report deep research/i
    .test(`${row.evidenceId || row.evidence_id || ''} ${row.kind || ''} ${row.publisher || ''} ${text}`);
}

function isInternalBridgeEvidence(row = {}, text = evidenceText(row)) {
  return /\b(issuer[_-\s]?thesis[_-\s]?pack|issuer thesis bridge|issuer-discovery-map|cross_theme_action_bridge|cross-theme-action-bridge|universal evidence contract|deep research pack summary|lattice research os)\b/i
    .test(`${row.evidenceId || row.evidence_id || ''} ${row.kind || ''} ${row.publisher || ''} ${row.source_type || row.sourceType || ''} ${text}`);
}

function sourceGroup(row = {}) {
  const text = evidenceText(row);
  const nested = nestedProviderRow(row);
  const nestedMetadata = nestedProviderMetadata(row);
  const publicPlanningProvider = row.metadata?.sourceProvider
    || row.metadata?.publicPlanningProvider
    || nestedMetadata.sourceProvider
    || nestedMetadata.publicPlanningProvider;
  if (/\bpublic[_-\s]?planning[_-\s]?source\b/i.test(`${row.publisher || ''} ${row.source_type || row.sourceType || ''} ${row.metadata?.sourceType || ''} ${nested.source_type || nested.sourceType || ''}`) && publicPlanningProvider) {
    return sourceSlug(publicPlanningProvider) || 'public-planning-source';
  }
  if (isDeepPackSummary(row, text)) return 'lattice-research-os';
  if (/local[-_\s]?market[-_\s]?validation/.test(text)) return 'local-market-validation';
  if (/sec_companyfacts_facts/.test(text)) return 'sec-companyfacts-facts';
  if (/sec_direct_management_commentary/.test(text)) return 'sec-direct-management-commentary';
  if (/sec_earnings_release_exhibit/.test(text)) return 'sec-earnings-release-exhibit';
  if (/sec_investor_presentation_exhibit/.test(text)) return 'sec-investor-presentation-exhibit';
  if (/transcript_evidence/.test(text)) return 'issuer-call-transcript';
  if (/industry_kpi_observations/.test(text)) return 'industry-kpi-observations';
  if (/theme_trend_aggregates/.test(text)) return 'theme-trend-aggregates';
  if (isMarketReportText(text)) return 'market-research';
  if (/pr newswire|cision/.test(text)) return 'pr-newswire';
  if (/\borf\b|orfonline|observer research foundation/.test(text)) return 'orf';
  if (/manufacturing today/.test(text)) return 'manufacturing-today';
  if (/defense security monitor/.test(text)) return 'defense-security-monitor';
  if (/business wire/.test(text)) return 'business-wire';
  if (/\bgao\b|government accountability/.test(text)) return 'gao';
  if (/defense news/.test(text)) return 'defense-news';
  const raw = compactText(
    row.publisher
    || row.sourceId
    || row.source_id
    || row.source_type
    || row.sourceType
    || row.metadata?.sourceGroup
    || row.metadata?.publisher
    || row.metadata?.sourceType
    || row.metadata?.provider
    || nested.publisher
    || nested.source_type
    || nested.sourceType
    || nestedMetadata.sourceGroup
    || nestedMetadata.publisher
    || nestedMetadata.sourceType
    || nestedMetadata.provider
    || 'source-evidence'
  );
  const normalized = normalize(raw);
  if (/pr newswire|cision/.test(normalized)) return 'pr-newswire';
  if (/\borf\b|observer research foundation/.test(normalized)) return 'orf';
  if (/manufacturing today/.test(normalized)) return 'manufacturing-today';
  if (/defense security monitor/.test(normalized)) return 'defense-security-monitor';
  if (/business wire/.test(normalized)) return 'business-wire';
  if (/gao|government accountability/.test(normalized)) return 'gao';
  if (/defense news/.test(normalized)) return 'defense-news';
  return sourceSlug(raw) || 'source-evidence';
}

function discoveryEvidenceClass(row = {}, text = evidenceText(row)) {
  const metadataClass = compactText(
    row.metadata?.desiredEvidenceClass
    || row.metadata?.evidenceClass
    || row.desiredEvidenceClass
    || row.evidenceClass
    || nestedProviderRow(row).desiredEvidenceClass
    || nestedProviderRow(row).evidenceClass
    || nestedProviderMetadata(row).desiredEvidenceClass
    || nestedProviderMetadata(row).evidenceClass
  );
  if (metadataClass) return metadataClass;
  if (/\b(grid interconnection|interconnection queue|transmission access|utility connection|substation|rto|ferc)\b/i.test(text)) {
    return 'grid_interconnection';
  }
  if (/\b(purchase agreement|binding commitment|authorized purchasers?|customer commitment|bookings?|orders?)\b/i.test(text)
    && /\b(gpu|accelerator|instinct|trainium|asic|server|rack[-\s]?scale)\b/i.test(text)) {
    return 'accelerator_orders';
  }
  if (/\b(data[-\s]?center power|power availability|power demand|electricity demand|mw capacity|megawatt|utility|cooling energy|energy bottleneck|commercial sector electricity)\b/i.test(text)) {
    return 'power_constraint';
  }
  if (/\b(capex|capital expenditure|capital expenditures|capitalexpenditure|capital allocation|infrastructure spending|data[-\s]?center investment|cloud capex|ai capex)\b/i.test(text)) {
    return 'capex_confirmation';
  }
  if (/\b(compute demand|gpu demand|accelerator demand|ai workload|ai usage|inference|training workload|cloud demand|compute capacity|data[-\s]?center ai accelerator|ai accelerator opportunity)\b/i.test(text)) {
    return 'compute_demand';
  }
  if (/\b(cloud revenue|cloud services revenue|server products and cloud services revenue|aws revenue|azure revenue|google cloud revenue|commercial cloud|cloud segment|cloud growth|workload monetization)\b/i.test(text)) {
    return 'cloud_revenue';
  }
  if (/\b(gpu orders|gpu products|accelerator orders|server shipments|server orders|asic demand|allocation|accelerator backlog|rack[-\s]?scale ai solutions|ai accelerator opportunity)\b/i.test(text)) {
    return 'accelerator_orders';
  }
  if (/\b(data[-\s]?center utilization|leased capacity|absorption|occupancy|load ramp|capacity buildout|capacity buildout proxy)\b/i.test(text)) {
    return 'data_center_utilization';
  }
  if (/\b(operating kpi|operating metric|capacity buildout proxy|capex intensity proxy|filing activity kpi|market reaction strength kpi)\b/i.test(text)) {
    return 'operating_kpi';
  }
  if (/\b(easy substitutes?|supplier redundancy|no capacity constraint|non-qualified supplier|no procurement timing|limited qualified substitutes?|no near-term supplier redundancy|negative control|substitution risk|alternative suppliers?)\b/i.test(text)) {
    return 'negative_control';
  }
  if (/\b(qualified|qualification|certification|certified|technical|nozzle|energetic|propellant|material|specification|test(?:ed|s|ing)?|test firing|developed|development)\b/i.test(text)) {
    return 'technical_qualification';
  }
  if (/\b(procurement|contract|award|funding|budget|dod|pentagon|nato|program|appropriation|solicitation)\b/i.test(text)) {
    return 'procurement_trigger';
  }
  if (/\b(substitute|substitution|alternative|redundancy|single source|sole source|limited suppliers?|hard to substitute|no near-term|chokepoint|bottleneck|supply[- ]?chain constraint|chemical constraint|qualification constraint)\b/i.test(text)) {
    return 'substitution_limit';
  }
  if (/\b(revenue|segment|guidance|issuer|exposure|margin|backlog|book-to-bill|book to bill|lmt|rtx|noc|gd|lhx|northrop|aerojet|l3harris|lockheed|raytheon)\b/i.test(text)) {
    return 'issuer_exposure';
  }
  if (/\b(capacity|facility|plant|factory|production|throughput|line|supplier|manufacturer|expansion)\b/i.test(text)) {
    return 'supplier_capacity';
  }
  return 'supplier_capacity';
}

function directOperatingEvidence(row = {}, text = evidenceText(row)) {
  if (isDeepPackSummary(row, text) || isInternalBridgeEvidence(row, text) || (!isOfficialPublicPlanningEvidence(row, text) && isMarketReportText(text))) return false;
  return /\b(facility|factory|plant|production capacity|capacity expansion|contract award|contract|award|qualified supplier|qualified|qualification|procurement|funding|invest|investment|throughput|production line|energetic|propellant|test(?:ed|s|ing)?|test firing|developed|development|certification|chokepoint|bottleneck|grid interconnection|interconnection queue|power demand|mw capacity|megawatt|electricity demand|capex|capital expenditure|cloud revenue|data[-\s]?center|gpu demand|accelerator demand|server shipments|leased capacity|absorption|occupancy)\b/i.test(text);
}

function classSpecificEvidenceHit(evidenceClass = '', text = '') {
  const haystack = String(text || '');
  if (evidenceClass === 'grid_interconnection') return /\b(grid interconnection|interconnection queue|transmission access|utility connection|substation|rto|ferc)\b/i.test(haystack);
  if (evidenceClass === 'power_constraint') return /\b(data[-\s]?center power|power availability|power demand|electricity demand|mw capacity|megawatt|utility load|commercial sector electricity|energy contract|mwh|megawatt[-\s]?hours)\b/i.test(haystack);
  if (evidenceClass === 'capex_confirmation') return /\b(capex|capital expenditure|capital expenditures|capitalexpenditure|capital allocation|infrastructure spending|data[-\s]?center investment|cloud capex|ai capex)\b/i.test(haystack);
  if (evidenceClass === 'compute_demand') return /\b(compute demand|gpu demand|accelerator demand|ai workload|ai usage|customers expand(?:ing)? their ai|inference|training workload|ai infrastructure|compute infrastructure|compute capacity|data[-\s]?center ai accelerator|ai accelerator opportunity)\b/i.test(haystack);
  if (evidenceClass === 'cloud_revenue') return /\b(cloud revenue|cloud services revenue|server products and cloud services revenue|commercial cloud revenue|commercial cloud|intelligent cloud|aws revenue|azure(?: and other cloud services)? revenue|google cloud revenue|google cloud|cloud segment|cloud growth)\b/i.test(haystack);
  if (evidenceClass === 'accelerator_orders') return /\b(gpu orders|gpu products|purchase agreement.+gpu|binding commitment.+gpu|gigawatt equivalent.+gpu|accelerator orders|server shipments|server orders|asic demand|accelerator backlog|allocation|networking backlog|rack[-\s]?scale ai solutions|ai accelerator opportunity)\b/i.test(haystack);
  if (evidenceClass === 'data_center_utilization') return /\b(data[-\s]?center utilization|leased capacity|absorption|occupancy|load ramp|capacity buildout|data[-\s]?center load|large load)\b/i.test(haystack);
  if (evidenceClass === 'issuer_exposure') return /\b(segment revenue|cloud revenue|customer|contract|backlog|guidance|data[-\s]?center|ai infrastructure|grid modernization|transmission|large load)\b/i.test(haystack);
  if (evidenceClass === 'mechanism_validation') return /\b(mechanism|drives|driven by|because|constrained by|bottleneck|interconnection wait|load growth|power availability|transmission|connect(?:ing)? .{0,80} power grid|increases demand|demand .{0,80} solutions|exceeds supply|queue delays?|queue backlogs?|long delays?|lack(?:s|ing)? .{0,80} (?:tools|capabilities)|service load request|energization queue)\b/i.test(haystack);
  if (evidenceClass === 'supplier_capacity') return /\b(production capacity|capacity expansion|facility|factory|plant|throughput|supplier expansion|manufacturing capacity|lead time|bookings|book-to-bill|backlog|lack(?:s|ing)? .{0,80} (?:tools|capabilities)|queue management software|manage large interconnection queues|study capacity|technical review capacity)\b/i.test(haystack);
  if (evidenceClass === 'technical_qualification') return /\b(qualified|qualification|certification|certified|technical|specification|test(?:ed|s|ing)?|successfully tests?|test firing|developed|development|energetic materials?|propellant|nozzle|motor case)\b/i.test(haystack);
  if (evidenceClass === 'procurement_trigger') return /\b(procurement|contract award|award(?:ed|s)?|funding|budget|dod|pentagon|program|appropriation|solicitation|to invest|\$[0-9][0-9,.]*(?:\s?million|\s?billion)?)\b/i.test(haystack);
  if (evidenceClass === 'policy_funding') return /\b(policy|funding|budget|appropriation|subsidy|grant|tax credit|regulatory|authorization|final rule|federal register|fed\. reg\.|ferc|commission|tariff filings?|information collection requirements?)\b/i.test(haystack);
  if (evidenceClass === 'mission_award') return /\b(mission award|award(?:ed|s)?|contract|program|task order|delivery order|mission support)\b/i.test(haystack);
  if (evidenceClass === 'substitution_limit') return /\b(sole source|single source|limited suppliers?|limited qualified substitutes?|hard to substitute|qualification constraint|long lead time|critical[-\s]?path|chemical chokepoint|chokepoint|no near-term redundancy|interconnection wait|transmission queue|queue backlog|transmission interconnection infrastructure|connect(?:ing)? .{0,80} power grid|limited grid capacity|site control|commercial readiness deposit|withdrawal penalties|first-ready[, -]+first-served|cluster study process)\b/i.test(haystack);
  if (evidenceClass === 'negative_control') return /\b(easy substitutes?|alternative suppliers?|supplier redundancy|no capacity constraint|non-qualified supplier|no procurement timing|negative control|substitution risk|onsite generation|behind[-\s]?the[-\s]?meter|bridge resource|natural gas .{0,30} bridge|battery storage|energy contracts?|renewable energy .{0,80} generate|power capacity|interconnection reform|reduce .{0,40} queue|checked_no_direct|supported_constraint|invalidator)\b/i.test(haystack);
  if (evidenceClass === 'operating_kpi') return /\b(kpi|operating metric|load growth|capacity buildout|capex intensity|market reaction strength|filing activity|revenue|backlog|orders|utilization|gigawatt|megawatt|\b[0-9]+(?:\.[0-9]+)?%|\$[0-9][0-9,.]*\s?(?:million|billion)|[0-9]+\s+projects?|[0-9]+\s+kilowatt|[0-9]+\s+megawatt)\b/i.test(haystack);
  return false;
}

const FRONTIER_NODE_PATTERNS = Object.freeze([
  { key: 'interconnection_study', pattern: /\b(interconnection stud(?:y|ies)|impact stud(?:y|ies)|system impact stud(?:y|ies)|facilities stud(?:y|ies)|technical review(?:s)?)\b/i },
  { key: 'queue_processing', pattern: /\b(queue management|queue processing|queue backlog(?:s)?|energization queue(?:s)?|service load request(?:s)?|long delay(?:s)?|wait time(?:s)?)\b/i },
  { key: 'grid_interface', pattern: /\b(transmission provider(?:s)?|distribution utilit(?:y|ies)|rto|iso|substation(?:s)?|interconnection requirement(?:s)?|interconnection standard(?:s)?)\b/i },
  { key: 'large_load_interconnection', pattern: /\b(large load customer(?:s)?|grid manager(?:s)?|ercot|pjm|interconnection of new generating capacity|connect(?:ing)? .{0,60} grid quicker|modernize the grid)\b/i },
  { key: 'protection_control', pattern: /\b(protection relay(?:s)?|relay setting(?:s)?|substation automation|switchgear protection|control system(?:s)?)\b/i },
  { key: 'permitting_or_study_capacity', pattern: /\b(permitting queue(?:s)?|permit processing|study capacity|specialist labor|engineering review capacity|consultant capacity)\b/i },
  { key: 'qualification_testing', pattern: /\b(qualification lead time|approved supplier(?:s)?|qualification testing|certification test(?:ing)?|test facilit(?:y|ies)|validated and determine(?:d)?|test and validate)\b/i },
  { key: 'launch_ground_input', pattern: /\b(propellant loading|fuel farm(?:s)?|storage tank(?:s)?|liquid oxygen|hydrogen|helium|ground support|range support|mission support scheduling)\b/i },
  { key: 'scarcity_constraint', pattern: /\b(single source|sole source|limited qualified|supplier concentration|hard to substitute|critical path|replacement cycle|field failure|lead time(?:s)?|backlog(?:s)?)\b/i },
]);

function providerConfidence(row = {}) {
  const text = normalize([
    row.kind,
    row.publisher,
    row.source_type,
    row.sourceType,
    row.metadata?.sourceType,
    row.metadata?.sourceProvider,
    row.metadata?.provider,
    nestedProviderRow(row).source_type,
    nestedProviderRow(row).sourceType,
    nestedProviderMetadata(row).sourceType,
    nestedProviderMetadata(row).sourceProvider,
  ].join(' '));
  if (/\b(public_planning_source|doe|doe-i2x|ferc|eia|rto|iso|utility|lbl|national[-\s]?lab|sec|fmp|official)\b/i.test(text)) return 1;
  if (/\b(data-center-dynamics|utility-dive|payload-space|siliconangle|trade[-\s]?press|article)\b/i.test(text)) return 0.5;
  return 0;
}

function frontierNodeActualHit(text = '') {
  return FRONTIER_NODE_PATTERNS.some((entry) => entry.pattern.test(String(text || '')));
}

export function inferFrontierNodeEvidence(rows = []) {
  const hits = new Set();
  let officialHitCount = 0;
  let scarcityHitCount = 0;
  for (const row of rows) {
    const text = evidenceText(row);
    const rowHits = FRONTIER_NODE_PATTERNS
      .filter((entry) => entry.pattern.test(text))
      .map((entry) => entry.key);
    if (!rowHits.length) continue;
    rowHits.forEach((key) => hits.add(key));
    if (providerConfidence(row) >= 1) officialHitCount += 1;
    if (/\b(delay(?:s)?|higher costs?|backlog(?:s)?|long lead time(?:s)?|limited|lack the tools|lack .{0,60} capabilities|queue|single source|sole source|hard to substitute|critical path)\b/i.test(text)) {
      scarcityHitCount += 1;
    }
  }
  return {
    supported: officialHitCount >= 1 && hits.size >= 1 && scarcityHitCount >= 1,
    sourceDerivedNodeCount: hits.size,
    scarcityHitCount,
    officialHitCount,
    nodeKeys: [...hits].sort(),
  };
}

function evidenceClassListFromContract(bundle = {}) {
  const deep = bundle.metadata?.deepResearch || {};
  const required = [
    ...asArray(deep.universalEvidenceContract?.requiredClasses).map((row) => row.evidenceClass),
    ...asArray(deep.evidenceClassMatrix)
      .filter((row) => row.negativeControlIntent || row.promotionEligible !== false)
      .map((row) => row.evidenceClass),
    ...asArray(deep.crossThemeActionBridge?.evidenceMatrix).map((row) => row.evidenceClass),
    ...evidenceClassesForReportContract(bundle, { ontologyCoverage: deep.ontologyPack }),
  ].map(compactText);
  const selected = unique(required)
    .filter((klass) => klass && !EXCLUDED_DISCOVERY_CONTRACT_CLASSES.has(klass));
  if (!selected.includes('negative_control')) selected.push('negative_control');
  return selected.length ? selected : [...DISCOVERY_EVIDENCE_CLASSES];
}

function promotionEvidenceClassesForBundle(bundle = {}) {
  return evidenceClassListFromContract(bundle).filter((item) => item !== 'negative_control');
}

export function scoreCrossThemeAnchorFit(anchor = {}, bundle = {}) {
  const text = evidenceText(anchor);
  const strictEndogenous = isStrictEndogenousBundle(bundle);
  const { connectorTerms, themeTerms, supplierTerms } = crossThemeEvidenceTerms(bundle);
  const connectorHit = strictEndogenous
    ? strictGeneratedTermHit(text, connectorTerms)
    : termHit(text, connectorTerms);
  const supplierHit = termHit(text, supplierTerms);
  const frontierNodeHit = strictEndogenous && frontierNodeActualHit(text);
  const themeHit = termHit(text, themeTerms);
  const evidenceClass = discoveryEvidenceClass(anchor, text);
  const sourceText = `${anchor.source_type || anchor.sourceType || anchor.publisher || anchor.metadata?.sourceType || anchor.metadata?.provider || nestedProviderRow(anchor).source_type || ''} ${text}`;
  const structuredOperatingSource = /\b(fmp|sec_companyfacts_facts|company_fundamentals|industry_kpi_observations|daily_curated_news|articles_keyword_proxy|theme_trend_aggregates|public_planning_source|doe|doe-i2x|lbl|national[-_\s]?lab|eia|ferc|rto|utility|sec_filings_evidence|sec_direct_management_commentary|transcript_evidence)\b/i.test(sourceText);
  const classSpecificOperating = [
    'operating_kpi',
    'issuer_exposure',
    'policy_funding',
    'capex_confirmation',
    'compute_demand',
    'power_constraint',
    'grid_interconnection',
    'cloud_revenue',
    'accelerator_orders',
    'data_center_utilization',
    'supplier_capacity',
    'technical_qualification',
    'substitution_limit',
  ].includes(evidenceClass);
  const specificHit = connectorHit || supplierHit || frontierNodeHit;
  const constraintHit = /capacity|facility|factory|production|producer|supplier|qualified|qualification|nozzle|energetic|propellant|award|contract|procurement|funding|invest|investment|expansion|plant|line|throughput|test(?:ed|s|ing)?|developed|development|chokepoint|bottleneck|grid interconnection|interconnection queue|power demand|mw capacity|megawatt|electricity|capex|capital expenditure|cloud revenue|data[-\s]?center|gpu|accelerator|server|leased capacity|occupancy/i.test(text);
  const officialPublicPlanningSource = /\b(public_planning_source|doe|doe-i2x|lbl|national[-_\s]?lab|eia|ferc|rto|iso|utility)\b/i.test(sourceText);
  const marketReport = !officialPublicPlanningSource && isMarketReportText(text);
  const genericOutlook = /outlook|overview|trend|surge|commentary|opinion|analysis/i.test(text) && !constraintHit;
  const directGrade = /(^|[_\s-])direct($|[_\s-])/i.test(`${anchor.evidenceGrade || anchor.evidence_grade || anchor.metadata?.evidenceStrength || ''}`);
  const directIssuerBridgeEvidence = ['issuer_exposure', 'issuer_commentary', 'primary_filing'].includes(evidenceClass)
    && evidenceUseValue(anchor) === 'promotion_candidate';

  if (strictEndogenous && isIssuerScopedProviderEvidence(anchor, sourceText) && !directIssuerBridgeEvidence) {
    return {
      label: 'low',
      score: 0.1,
      reason: 'strict endogenous issuer-scoped provider evidence requires direct issuer bridge evidence before body promotion',
    };
  }

  if (strictEndogenous && !specificHit) {
    return {
      label: 'low',
      score: 0.1,
      reason: 'strict endogenous evidence requires a generated connector or concrete bottleneck-node hit',
    };
  }

  if (structuredOperatingSource && classSpecificOperating && classSpecificEvidenceHit(evidenceClass, text) && (themeHit || frontierNodeHit) && constraintHit && !marketReport && !isInternalBridgeEvidence(anchor, text)) {
    if (strictEndogenous && !specificHit) {
      return {
        label: 'low',
        score: 0.1,
        reason: 'strict endogenous structured evidence cannot promote on parent-theme terms alone',
      };
    }
    return {
      label: 'high',
      score: directGrade ? 1 : 0.88,
      reason: 'structured provider evidence satisfies a report-required operating evidence class',
    };
  }

  if (isDeepPackSummary(anchor, text) && specificHit) {
    return {
      label: 'medium',
      score: 0.52,
      reason: 'pack-level summary can provide context but cannot promote a direct bottleneck anchor',
    };
  }

  if (specificHit && themeHit && constraintHit && !marketReport) {
    return {
      label: 'high',
      score: directGrade ? 1 : 0.9,
      reason: 'connector-specific operating evidence tied to capacity, production, supplier, procurement, or qualification',
    };
  }
  if (specificHit && constraintHit && !marketReport) {
    return {
      label: 'high',
      score: directGrade ? 0.92 : 0.82,
      reason: 'connector-specific capacity or supplier evidence; verify cross-theme operating relevance',
    };
  }
  if (specificHit && marketReport) {
    return {
      label: 'medium',
      score: 0.45,
      reason: 'market-size or forecast evidence supports monitoring but cannot promote a bottleneck thesis',
    };
  }
  if (specificHit || (supplierHit && themeHit)) {
    return {
      label: 'medium',
      score: genericOutlook ? 0.5 : 0.62,
      reason: 'connector-adjacent evidence without enough operating constraint detail',
    };
  }
  return {
    label: 'low',
    score: 0.1,
    reason: 'not specific enough to the connector and linked themes for body evidence',
  };
}

export function classifyCrossThemeEvidence(row = {}, bundle = {}) {
  const fit = scoreCrossThemeAnchorFit(row, bundle);
  const text = evidenceText(row);
  const evidenceClass = discoveryEvidenceClass(row, text);
  const sourceGroupName = sourceGroup(row);
  const sourceQueryUse = compactText(
    row.metadata?.evidenceUse
    || row.metadata?.relevanceTier
    || row.evidenceUse
    || row.relevanceTier
    || nestedProviderRow(row).evidenceUse
    || nestedProviderRow(row).relevanceTier
    || nestedProviderMetadata(row).evidenceUse
    || nestedProviderMetadata(row).relevanceTier
  );
  const sourceQueryPromotionEligible = row.metadata?.promotionEligible === true
    || row.metadata?.promotionEligible === 'true'
    || row.promotionEligible === true
    || nestedProviderRow(row).promotionEligible === true
    || nestedProviderMetadata(row).promotionEligible === true
    || nestedProviderMetadata(row).promotionEligible === 'true';
  const packSummary = isDeepPackSummary(row, text);
  const internalBridge = isInternalBridgeEvidence(row, text);
  const marketReport = !isOfficialPublicPlanningEvidence(row, text) && isMarketReportText(text);
  const directGrade = /(^|[_\s-])direct($|[_\s-])/i.test(`${row.evidenceGrade || row.evidence_grade || row.metadata?.evidenceStrength || row.metadata?.directness || nestedProviderMetadata(row).directness || nestedProviderMetadata(row).sourceType || ''}`);
  const classSpecific = classSpecificEvidenceHit(evidenceClass, text);
  const sourceQueryForcedContext = ['supporting_context', 'weak_noise'].includes(sourceQueryUse);
  const direct = !sourceQueryForcedContext && !packSummary && !internalBridge && !marketReport && (directGrade || sourceQueryPromotionEligible || directOperatingEvidence(row, text));
  const baseBodyEligible = ['high', 'medium'].includes(fit.label) && fit.score >= 0.45;
  const bodyEligible = baseBodyEligible && !internalBridge && !['weak_noise', 'supporting_context'].includes(sourceQueryUse);
  const promotionEligible = bodyEligible
    && !packSummary
    && !internalBridge
    && !marketReport
    && evidenceClass !== 'negative_control'
    && classSpecific
    && (!sourceQueryUse || sourceQueryUse === 'promotion_candidate' || sourceQueryPromotionEligible);
  return {
    ...row,
    crossThemeFit: fit,
    desiredEvidenceClass: evidenceClass,
    sourceGroup: sourceGroupName,
    direct,
    directness: direct ? 'direct_operating' : (packSummary || marketReport ? 'context_only' : 'indirect'),
    crossThemeRole: sourceQueryUse === 'weak_noise'
      ? 'weak_noise'
      : (evidenceClass === 'negative_control' || sourceQueryUse === 'negative_control_candidate'
        ? 'negative_control'
        : (promotionEligible ? 'promotion_anchor' : 'context_only')),
    packSummary,
    marketReport,
    sourceQueryEvidenceUse: sourceQueryUse || null,
    promotionEligible,
    bodyEligible,
    noiseReason: bodyEligible ? null : fit.reason,
    text,
  };
}

export function crossThemeBodyEvidence(bundle = {}) {
  const classified = asArray(bundle.evidence)
    .map((row) => classifyCrossThemeEvidence(row, bundle))
    .sort((left, right) => {
      const scoreDiff = (right.crossThemeFit?.score || 0) - (left.crossThemeFit?.score || 0);
      if (scoreDiff) return scoreDiff;
      return Number(right.direct) - Number(left.direct);
    });
  return {
    bodyEvidence: classified.filter((row) => row.bodyEligible),
    appendixEvidence: classified.filter((row) => !row.bodyEligible),
    classified,
  };
}

function gradeFromScore(score) {
  return score >= 0.9 ? 'S' : score >= 0.78 ? 'A' : score >= 0.62 ? 'B' : score >= 0.45 ? 'C' : 'D';
}

function gradeRank(grade = '') {
  return { S: 4, A: 3, B: 2, C: 1, D: 0 }[grade] ?? 0;
}

function minGrade(...grades) {
  return grades.filter(Boolean).sort((a, b) => gradeRank(a) - gradeRank(b))[0] || 'D';
}

function hasOwn(obj = {}, key = '') {
  return Object.prototype.hasOwnProperty.call(obj || {}, key);
}

function discoveryTier(score, metrics = {}) {
  if (
    score >= 0.88
    && metrics.directEvidenceStrength >= 0.75
    && metrics.sourceDiversity >= 0.8
    && metrics.negativeControlPass >= 1
    && metrics.highFitAnchorCount >= 2
    && metrics.evidenceClassCoverage >= 0.8
    && !asArray(metrics.missingEvidenceClasses).length
  ) return 'review_ready_bottleneck';
  if (
    score >= 0.68
    && metrics.directEvidenceStrength >= 0.35
    && metrics.highFitAnchorCount >= 1
    && metrics.sourceDiversity >= 0.6
  ) return 'evidence_backed_bottleneck_candidate';
  if (score >= 0.42) return 'research_lead';
  return 'graph_adjacency';
}

export function discoveryTierLabel(tier = '') {
  return ({
    graph_adjacency: 'Graph adjacency',
    research_lead: 'Research lead',
    evidence_backed_bottleneck_candidate: 'Evidence-supported research candidate',
    review_ready_bottleneck: 'Review-ready evidence tier',
  })[tier] || titleCase(tier || 'cross-theme discovery');
}

export function computeCrossThemeDiscoveryQuality(bundle = {}) {
  if (!isCrossThemeDiscoveryReport(bundle)) return null;
  const { candidate, summary, discovery, themes } = candidateFromBundle(bundle);
  const adjacentMetadata = bundle.metadata?.adjacentCandidate?.metadata || {};
  const nonObviousDiscovery = adjacentMetadata.nonObviousDiscovery || bundle.metadata?.nonObviousDiscovery || {};
  const frontierDiscovery = Boolean(
    adjacentMetadata.frontierDiscovery
    || bundle.metadata?.frontierDiscovery
    || adjacentMetadata.discoveryNamespace === 'strict_endogenous_adjacent'
    || bundle.metadata?.discoveryNamespace === 'strict_endogenous_adjacent'
  );
  const scarcityEvidenceScore = clamp(
    bundle.metadata?.scarcityEvidenceScore
      ?? adjacentMetadata.scarcityEvidenceScore
      ?? nonObviousDiscovery.scarcitySignalScore
      ?? 0,
  );
  const nonObviousFrontierScore = num(nonObviousDiscovery.frontierScore, 0);
  const consensusPenalty = clamp(nonObviousDiscovery.consensusPenalty ?? 0);
  const discoveryClasses = evidenceClassListFromContract(bundle);
  const promotionClasses = promotionEvidenceClassesForBundle(bundle);
  const evidenceView = crossThemeBodyEvidence(bundle);
  const { bodyEvidence, appendixEvidence, classified } = evidenceView;
  const promotionEvidence = bodyEvidence.filter((row) => row.promotionEligible && promotionClasses.includes(row.desiredEvidenceClass));
  const inferredFrontierNodeEvidence = inferFrontierNodeEvidence(promotionEvidence);
  const explicitFrontierNodeSupport = hasOwn(bundle.metadata, 'frontierNodeSupported')
    || hasOwn(adjacentMetadata, 'frontierNodeSupported');
  const explicitSourceDerivedNodeCount = hasOwn(bundle.metadata, 'sourceDerivedNodeCount')
    || hasOwn(adjacentMetadata, 'sourceDerivedNodeCount');
  const frontierNodeSupported = explicitFrontierNodeSupport
    ? Boolean(bundle.metadata?.frontierNodeSupported || adjacentMetadata.frontierNodeSupported)
    : Boolean(frontierDiscovery && inferredFrontierNodeEvidence.supported);
  const sourceDerivedNodeCount = explicitSourceDerivedNodeCount
    ? num(bundle.metadata?.sourceDerivedNodeCount ?? adjacentMetadata.sourceDerivedNodeCount, 0)
    : (frontierDiscovery ? inferredFrontierNodeEvidence.sourceDerivedNodeCount : 0);
  const highFit = promotionEvidence.filter((row) => row.crossThemeFit?.label === 'high');
  const mediumFit = promotionEvidence.filter((row) => row.crossThemeFit?.label === 'medium');
  const directHigh = highFit.filter((row) => row.direct).length;
  const sourceGroups = unique(promotionEvidence
    .map((row) => row.sourceGroup)
    .filter((group) => group && !['lattice-research-os', 'market-research', 'source-evidence'].includes(group)));
  const bodySourceDiversity = sourceGroups.length ? clamp(sourceGroups.length / 5) : 0;
  const coveredClasses = unique(promotionEvidence
    .map((row) => row.desiredEvidenceClass)
    .filter((klass) => promotionClasses.includes(klass)));
  const missingEvidenceClasses = promotionClasses
    .filter((klass) => !coveredClasses.includes(klass));
  const evidenceClassCoverage = clamp(coveredClasses.length / Math.max(1, promotionClasses.length));
  const negativeEvidence = asArray(classified).filter((row) => row.desiredEvidenceClass === 'negative_control'
    || row.sourceQueryEvidenceUse === 'negative_control_candidate'
    || row.crossThemeRole === 'negative_control');
  const negativeControlSupport = negativeEvidence.some((row) => /\b(limited|no near-term|hard to substitute|no redundancy|supplier redundancy|no capacity constraint|easy substitutes?|non-qualified|no procurement timing|negative control|checked_no_direct|supported_constraint|invalidator)\b/i.test(row.text || ''));
  const negativeControlChecked = negativeEvidence.some((row) => row.sourceQueryEvidenceUse === 'negative_control_candidate'
    || /\b(checked_no_direct|supported_constraint|invalidator|negative control direct evidence extract)\b/i.test(row.text || ''));
  const seedSimilarity = clamp(candidate.seedSimilarity ?? summary.seedSimilarity ?? 0);
  const seedIndependence = clamp(1 - seedSimilarity);
  const explicitNovelty = Number(candidate.novelty ?? summary.novelty);
  const specificity = connectorSpecificity(bundle);
  const coMentionCount = Number(candidate.coMentionCount ?? summary.coMentionCount ?? summary.priorCoMentionCount);
  const coMentionNovelty = Number.isFinite(coMentionCount) ? clamp(1 - coMentionCount / 12) : 0.75;
  const novelty = clamp(Number.isFinite(explicitNovelty)
    ? explicitNovelty
    : seedIndependence * 0.6 + specificity * 0.25 + coMentionNovelty * 0.15);
  const themeDistance = clamp(
    Number(summary.themeDistance ?? summary.theme_distance)
      || (themes.length >= 2
        ? 0.78
        : (asArray(bundle.metadata?.adjacentCandidate?.metadata?.domains).length >= 2
          ? 0.78
          : 0.35)),
  );
  const relationSupport = num(bundle.metadata?.relationSupport ?? bundle.metadata?.adjacentCandidate?.metadata?.relationSupport, 0);
  const adjacentConfidence = num(bundle.metadata?.adjacentCandidate?.confidence_score ?? bundle.metadata?.adjacentCandidate?.confidenceScore, 0);
  const generatedConstraintSignal = bundle.metadata?.generatedLane || bundle.subject?.metadata?.discovery?.generatedLane
    ? Math.max(
      relationSupport ? Math.min(0.95, 0.45 + relationSupport / 12) : 0,
      adjacentConfidence ? Math.min(0.95, adjacentConfidence / 100) : 0,
    )
    : 0;
  const constraintCriticality = clamp(
    candidate.constraintCriticality
      ?? summary.constraintCriticality
      ?? discovery.constraintScore
      ?? discovery.constraintCriticality
      ?? generatedConstraintSignal,
  );
  const fallbackSourceDiversity = clamp(
    summary.sourceDiversity
      ?? bundle.sourceSummary?.sourceDiversityScore
      ?? (Number(summary.sourceDiversityRaw || 0) ? Number(summary.sourceDiversityRaw || 0) / 5 : 0),
  );
  const sourceDiversity = clamp(promotionEvidence.length ? bodySourceDiversity : fallbackSourceDiversity);
  const directEvidenceStrength = clamp(
    directHigh * 0.35
      + highFit.length * 0.14
      + mediumFit.length * 0.04
      + evidenceClassCoverage * 0.15,
  );
  const operationalAnchorShare = promotionEvidence.length
    ? highFit.length / promotionEvidence.length
    : 0;
  const noiseRatio = appendixEvidence.length / Math.max(1, bodyEvidence.length + appendixEvidence.length);
  const negativeControlPass = (negativeControlSupport || negativeControlChecked) && sourceGroups.length >= 2 && directHigh >= 1 ? 1 : 0;
  const evidenceBacked = Math.min(1, promotionEvidence.length / 4);
  const score = Math.round((
    0.18 * novelty
    + 0.12 * seedIndependence
    + 0.12 * themeDistance
    + 0.14 * specificity
    + 0.14 * constraintCriticality
    + 0.14 * directEvidenceStrength
    + 0.10 * sourceDiversity
    + 0.08 * negativeControlPass
    + 0.05 * evidenceBacked
    + 0.03 * evidenceClassCoverage
  ) * 1000) / 1000;
  const metrics = {
    novelty: Math.round(novelty * 1000) / 1000,
    seedIndependence: Math.round(seedIndependence * 1000) / 1000,
    themeDistance: Math.round(themeDistance * 1000) / 1000,
    connectorSpecificity: Math.round(specificity * 1000) / 1000,
    constraintCriticality: Math.round(constraintCriticality * 1000) / 1000,
    directEvidenceStrength: Math.round(directEvidenceStrength * 1000) / 1000,
    sourceDiversity: Math.round(sourceDiversity * 1000) / 1000,
    negativeControlPass,
    evidenceBacked,
    evidenceClassCoverage: Math.round(evidenceClassCoverage * 1000) / 1000,
    requiredEvidenceClasses: discoveryClasses,
    evidenceClassesCovered: coveredClasses,
    missingEvidenceClasses,
    independentSourceGroupCount: sourceGroups.length,
    independentSourceGroups: sourceGroups,
    highFitAnchorCount: highFit.length,
    mediumFitAnchorCount: mediumFit.length,
    directHighFitAnchorCount: directHigh,
    bodyEvidenceCount: bodyEvidence.length,
    appendixEvidenceCount: appendixEvidence.length,
    negativeControlEvidenceCount: negativeEvidence.length,
    coMentionNovelty: Math.round(coMentionNovelty * 1000) / 1000,
    frontierDiscovery: Number(frontierDiscovery),
    frontierNodeSupported: Number(frontierNodeSupported),
    sourceDerivedNodeCount,
    inferredFrontierNodeKeys: inferredFrontierNodeEvidence.nodeKeys,
    inferredFrontierOfficialHitCount: inferredFrontierNodeEvidence.officialHitCount,
    inferredFrontierScarcityHitCount: inferredFrontierNodeEvidence.scarcityHitCount,
    scarcityEvidenceScore: Math.round(scarcityEvidenceScore * 1000) / 1000,
    nonObviousFrontierScore: Math.round(nonObviousFrontierScore * 1000) / 1000,
    consensusPenalty: Math.round(consensusPenalty * 1000) / 1000,
  };
  const tier = discoveryTier(score, metrics);
  const caps = [];
  if (frontierDiscovery && (!frontierNodeSupported || sourceDerivedNodeCount < 1 || scarcityEvidenceScore < 0.28)) caps.push('B');
  if (!metrics.highFitAnchorCount) caps.push('C');
  if (metrics.directEvidenceStrength < 0.35) caps.push('C');
  if (metrics.negativeControlPass < 1) caps.push('B');
  if (metrics.missingEvidenceClasses.some((klass) => ['substitution_limit', 'issuer_exposure', 'negative_control'].includes(klass))) caps.push('B');
  else if (metrics.missingEvidenceClasses.length) caps.push('A');
  const uncappedGrade = gradeFromScore(score);
  return {
    score,
    grade: minGrade(uncappedGrade, ...caps),
    uncappedGrade,
    tier,
    label: discoveryTierLabel(tier),
    caps,
    metrics,
    bodyEvidence: bodyEvidence.slice(0, 8).map((row) => ({
      evidenceId: row.evidenceId || row.evidence_id,
      title: row.title,
      publisher: row.publisher,
      fit: row.crossThemeFit,
      direct: row.direct,
      desiredEvidenceClass: row.desiredEvidenceClass,
      sourceGroup: row.sourceGroup,
      directness: row.directness,
    })),
    appendixEvidenceCount: appendixEvidence.length,
    boundary: 'cross-theme discovery readiness; intentionally separate from investment readiness',
  };
}
