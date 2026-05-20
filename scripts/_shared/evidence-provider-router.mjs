import {
  buildEvidenceClassQueryVariants,
  evidenceClassProfile,
} from './universal-evidence-contract.mjs';
import {
  filterIssuerSymbols,
  resolveThemeOntology,
} from './theme-ontology.mjs';
import {
  evidenceClassPlaybook,
} from './evidence-class-playbooks.mjs';
import {
  routeCollectorCapabilities,
} from './collector-capability-matrix.mjs';

const COLLECT_FREE_PROVIDERS = Object.freeze([
  'fred',
  'eia',
  'public-planning-source',
  'sec',
  'fmp',
  'polygon',
  'dod-contracts',
  'usaspending',
]);

const SOURCE_QUERY_ONLY = Object.freeze(['source-query']);
const ISSUER_COLLECTOR_CLASSES = new Set([
  'issuer_commentary',
  'primary_filing',
  'issuer_exposure',
  'capex_confirmation',
  'cloud_revenue',
  'budget_signal',
  'vendor_exposure',
  'pipeline_exposure',
  'market_validation',
]);
const SYMBOL_TEXT_STOPLIST = new Set([
  'SEC', 'KPI', 'API', 'URL', 'RSS', 'ETF', 'FX', 'USD', 'CPI', 'GDP',
  'FRED', 'EIA', 'FMP', 'AI', 'ML', 'OS', 'DB', 'NATO', 'EU', 'UN',
  'US', 'USA', 'DOD', 'MOD', 'MW', 'LLM', 'ARR', 'NRR', 'FY', 'Q1', 'Q2', 'Q3', 'Q4',
  'CPU', 'GPU', 'ASIC', 'FPGA', 'EPS', 'MD', 'PDF', 'HTML', 'CSV', 'JSON', 'ICP',
]);

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function compact(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function slugify(value) {
  return compact(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 120);
}

function unique(values = [], normalizer = (value) => compact(value)) {
  const seen = new Set();
  const out = [];
  for (const value of values || []) {
    const item = normalizer(value);
    if (!item) continue;
    const key = String(item).toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

function ontologyKeysFrom(input = {}) {
  return unique([
    input.ontologyKey,
    ...asArray(input.ontologyKeys),
    input.evidenceContract?.ontologyKey,
    ...asArray(input.evidenceContract?.ontologyKeys),
    ...asArray(input.themes).map((theme) => resolveThemeOntology({
      themeId: theme,
      themeLabel: theme,
    }).key),
  ], slugify).filter((key) => key && key !== 'unknown');
}

function hasAnyOntology(ontologyKeys = [], patterns = []) {
  const text = ontologyKeys.join(' ');
  return patterns.some((pattern) => pattern.test(text));
}

function subjectTerms({ subject = '', target = '', label = '' } = {}) {
  return compact(target || label || subject || 'subject');
}

function issuerPhrase(issuerUniverse = []) {
  return filterIssuerSymbols(issuerUniverse).slice(0, 6).join(' ');
}

function symbolsFromText(value = '') {
  const matches = String(value || '').match(/\b[A-Z][A-Z0-9.-]{1,9}\b/g) || [];
  return matches
    .map((item) => item.toUpperCase())
    .filter((item) => !SYMBOL_TEXT_STOPLIST.has(item));
}

function withIssuer(query, issuerUniverse = []) {
  const issuers = issuerPhrase(issuerUniverse);
  return compact(`${issuers} ${query}`);
}

function routeDefaultsForClass(evidenceClass, context = {}) {
  const ontologyKeys = ontologyKeysFrom(context);
  const defenseOrSpace = hasAnyOntology(ontologyKeys, [/defense/, /space/])
    || /\b(defense|space|missile|launch|aerospace|procurement)\b/i.test([
      context.subject,
      context.target,
      ...asArray(context.themes),
    ].join(' '));
  const powerOrGrid = hasAnyOntology(ontologyKeys, [/ai/, /data/, /cloud/, /power/, /grid/])
    || /\b(data.?center|power|electric|utility|grid|interconnection|transmission|substation|cooling|MW|megawatt)\b/i.test([
      context.subject,
      context.target,
      ...asArray(context.themes),
    ].join(' '));

  switch (evidenceClass) {
    case 'issuer_commentary':
      return {
        executableCollectors: ['sec', 'fmp', 'source-query'],
        sourceProviders: ['sec-edgar', 'fmp-transcripts', 'quartr', 'company-ir', 'company-newsroom'],
      };
    case 'primary_filing':
      return {
        executableCollectors: ['sec', 'source-query'],
        sourceProviders: ['sec-edgar', 'company-ir', 'annual-report', 'quarterly-report'],
      };
    case 'issuer_exposure':
      return {
        executableCollectors: ['sec', 'fmp', 'source-query', ...(defenseOrSpace ? ['usaspending'] : [])],
        sourceProviders: [
          'sec-edgar',
          'fmp-fundamentals',
          'fmp-transcripts',
          'company-ir',
          ...(defenseOrSpace ? ['usaspending'] : []),
          ...(powerOrGrid ? ['utility-filings', 'ferc', 'rto-iso', 'interconnection-queue', 'public-planning-source'] : []),
        ],
      };
    case 'capex_confirmation':
    case 'cloud_revenue':
      return {
        executableCollectors: ['sec', 'fmp', 'source-query'],
        sourceProviders: ['sec-edgar', 'fmp-fundamentals', 'fmp-transcripts', 'quartr', 'company-ir'],
      };
    case 'procurement_trigger':
    case 'mission_award':
      return {
        executableCollectors: ['dod-contracts', 'usaspending', 'source-query'],
        sourceProviders: ['war.gov-contracts', 'defense.gov', 'usaspending', 'dod-budget-pdf', 'official-policy'],
      };
    case 'policy_funding':
      return {
        executableCollectors: unique([
          ...(powerOrGrid ? ['public-planning-source', 'eia'] : []),
          ...(defenseOrSpace ? ['dod-contracts', 'usaspending'] : []),
          'source-query',
        ]),
        sourceProviders: unique([
          'official-policy',
          'government-budget',
          'regulatory-filing',
          ...(powerOrGrid ? ['ferc', 'rto-iso', 'utility-filings', 'interconnection-queue', 'public-planning-source', 'eia'] : []),
          ...(defenseOrSpace ? ['war.gov-contracts', 'defense.gov', 'usaspending', 'dod-budget-pdf'] : []),
        ]),
      };
    case 'supplier_capacity':
      return {
        executableCollectors: unique(['sec', 'fmp', ...(powerOrGrid ? ['public-planning-source'] : []), 'source-query', ...(defenseOrSpace ? ['dod-contracts', 'usaspending'] : [])]),
        sourceProviders: unique([
          'official-company',
          'company-newsroom',
          'official-pdf',
          'trade-press',
          ...(powerOrGrid ? ['utility-filings', 'ferc', 'rto-iso', 'interconnection-queue', 'public-planning-source'] : []),
          ...(defenseOrSpace ? ['war.gov-contracts', 'defense.gov', 'usaspending', 'dod-budget-pdf'] : []),
        ]),
      };
    case 'technical_qualification':
    case 'propulsion_constraint':
    case 'technology_maturity':
      return {
        executableCollectors: unique([...(powerOrGrid ? ['public-planning-source'] : []), 'source-query', ...(defenseOrSpace ? ['dod-contracts'] : [])]),
        sourceProviders: ['official-company', 'company-technical-release', 'patents', 'papers', 'official-test-release', ...(powerOrGrid ? ['utility-standard', 'ferc', 'rto-iso', 'public-planning-source'] : []), ...(defenseOrSpace ? ['defense.gov'] : [])],
      };
    case 'permitting_regulatory':
      return {
        executableCollectors: unique(['public-planning-source', ...(powerOrGrid ? ['eia'] : []), 'source-query']),
        sourceProviders: ['iso-rto-data', 'utility-queue', 'government-permit-db', 'local-authority-records', 'ferc', 'rto-iso', 'interconnection-queue', 'public-planning-source', 'policy-source'],
      };
    case 'material_input':
      return {
        executableCollectors: unique(['fred', 'eia', 'sec', 'fmp', 'source-query']),
        sourceProviders: ['trade-data', 'commodity-data', 'supplier-filings', 'import-export-data', 'official-company', 'trade-press', 'provider-fundamentals'],
      };
    case 'engineering_process':
      return {
        executableCollectors: unique(['sec', 'fmp', ...(powerOrGrid ? ['public-planning-source'] : []), 'source-query']),
        sourceProviders: ['company-technical-release', 'patents', 'papers', 'official-company', 'technical-standard', 'trade-press', 'process-engineering-source'],
      };
    case 'test_facility_capacity':
      return {
        executableCollectors: unique([...(defenseOrSpace ? ['dod-contracts', 'usaspending'] : []), ...(powerOrGrid ? ['public-planning-source'] : []), 'source-query']),
        sourceProviders: ['official-test-release', 'certification-docs', 'test-stand-records', 'government-facility-source', 'technical-paper', 'company-technical-release', ...(defenseOrSpace ? ['defense.gov', 'war.gov-contracts'] : [])],
      };
    case 'provider_data_gap':
      return {
        executableCollectors: [],
        sourceProviders: ['adapter-proposal', 'provider-gap-review'],
      };
    case 'substitution_limit':
      return {
        executableCollectors: unique([...(powerOrGrid ? ['public-planning-source'] : []), 'source-query', ...(defenseOrSpace ? ['dod-contracts', 'usaspending'] : [])]),
        sourceProviders: ['official-company', 'supply-chain-source', 'trade-press', 'negative-control-source', ...(powerOrGrid ? ['utility-filings', 'ferc', 'rto-iso', 'public-planning-source'] : []), ...(defenseOrSpace ? ['defense.gov', 'war.gov-contracts'] : [])],
      };
    case 'market_validation':
      return {
        executableCollectors: ['polygon', 'fmp'],
        sourceProviders: ['local-market-db', 'polygon', 'fmp', 'market-quotes', 'market-returns'],
      };
    case 'power_constraint':
    case 'grid_interconnection':
      return {
        executableCollectors: ['eia', 'public-planning-source', 'sec', 'fmp', 'source-query'],
        sourceProviders: ['eia', 'utility-filings', 'ferc', 'rto-iso', 'grid-operator', 'interconnection-queue', 'public-planning-source', 'company-ir', 'policy-source'],
      };
    case 'operating_kpi':
    case 'mechanism_validation':
    case 'compute_demand':
    case 'data_center_utilization':
    case 'accelerator_orders':
    case 'wafer_capacity':
    case 'advanced_packaging':
    case 'memory_bandwidth':
    case 'node_transition':
    case 'capacity_addition':
    case 'commodity_input':
    case 'launch_manifest':
    case 'satellite_backlog':
      return {
        executableCollectors: unique(['fred', 'eia', ...(powerOrGrid ? ['public-planning-source'] : []), 'sec', 'fmp', 'source-query']),
        sourceProviders: ['industry-kpi', 'company-ir', 'official-company', 'trade-press', 'provider-fundamentals', ...(powerOrGrid ? ['utility-filings', 'ferc', 'rto-iso', 'interconnection-queue', 'public-planning-source'] : [])],
      };
    case 'negative_control':
      return {
        executableCollectors: [...SOURCE_QUERY_ONLY],
        sourceProviders: ['source-query-negative-control', 'trade-press', 'official-company', 'supply-chain-source'],
      };
    case 'historical_analog':
      return {
        executableCollectors: [...SOURCE_QUERY_ONLY],
        sourceProviders: ['historical-memory', 'market-history', 'research-source'],
      };
    default:
      return {
        executableCollectors: [...SOURCE_QUERY_ONLY],
        sourceProviders: ['source-query', 'official-source', 'research-source'],
      };
  }
}

function providerQueriesForClass(evidenceClass, context = {}) {
  const subject = subjectTerms(context);
  const themes = asArray(context.themes).slice(0, 3).join(' ');
  const issuerUniverse = filterIssuerSymbols(unique([
    ...asArray(context.collectionUniverse),
    ...asArray(context.issuerUniverse),
    ...asArray(context.symbols),
  ]));
  const base = compact(`${subject} ${themes}`);
  const defenseProgramTerms = /defense|missile|rocket|interceptor|munition|aerojet|northrop|solid rocket|air defense|space/i.test(`${subject} ${themes} ${context.ontologyKey || ''} ${asArray(context.ontologyKeys).join(' ')}`)
    ? 'PAC-3 THAAD GMLRS PrSM SM-6 interceptor solid rocket motor Aerojet Northrop'
    : '';

  switch (evidenceClass) {
    case 'issuer_commentary':
      return [
        withIssuer(`${subject} earnings call transcript management commentary guidance demand capacity`, issuerUniverse),
        withIssuer(`${subject} investor relations presentation transcript guidance`, issuerUniverse),
        withIssuer(`${subject} 8-K earnings release management commentary`, issuerUniverse),
      ];
    case 'primary_filing':
      return [
        withIssuer(`${subject} 10-K 10-Q 8-K MD&A risk factor segment exhibit`, issuerUniverse),
        withIssuer(`${subject} annual report quarterly report SEC filing`, issuerUniverse),
      ];
    case 'issuer_exposure':
      return [
        withIssuer(`${subject} issuer exposure segment revenue backlog customer contract guidance`, issuerUniverse),
        withIssuer(`${subject} book-to-bill backlog revenue customer exposure`, issuerUniverse),
        withIssuer(`${subject} utility interconnection queue power capacity data center customer contract guidance SEC filing transcript`, issuerUniverse),
        withIssuer(`${subject} FERC RTO ISO utility filing interconnection queue capacity customer exposure`, issuerUniverse),
      ];
    case 'capex_confirmation':
      return [
        withIssuer(`${subject} capex capital expenditure infrastructure spending buildout capital allocation`, issuerUniverse),
        withIssuer(`${subject} cash flow capital expenditures data center buildout`, issuerUniverse),
      ];
    case 'cloud_revenue':
      return [
        withIssuer(`${subject} cloud revenue AI cloud demand segment growth workload monetization`, issuerUniverse),
        withIssuer(`${subject} cloud segment revenue AI workload demand earnings transcript`, issuerUniverse),
      ];
    case 'procurement_trigger':
      return [
        compact(`${base} ${defenseProgramTerms} procurement contract award funding budget program solicitation site:war.gov`),
        compact(`${base} ${defenseProgramTerms} procurement contract award funding budget program site:defense.gov`),
        compact(`${base} ${defenseProgramTerms} award recipient contract obligation site:usaspending.gov`),
        compact(`${base} ${defenseProgramTerms} DoD budget justification procurement funding program`),
      ];
    case 'policy_funding':
    case 'mission_award':
      return [
        compact(`${base} ${defenseProgramTerms} funding budget authorization appropriation grant award site:war.gov`),
        compact(`${base} ${defenseProgramTerms} funding budget authorization program budget justification site:defense.gov`),
        compact(`${base} ${defenseProgramTerms} award obligation recipient contract site:usaspending.gov`),
        compact(`${base} ${defenseProgramTerms} DoD budget justification procurement funding program`),
      ];
    case 'supplier_capacity':
      return [
        `${base} production capacity facility throughput expansion official company`,
        `${base} factory plant line ramp capacity PDF newsroom`,
        `${base} supplier capacity expansion production facility trade press`,
        `${base} capacity funding production line site:war.gov OR site:defense.gov`,
      ];
    case 'technical_qualification':
    case 'propulsion_constraint':
    case 'technology_maturity':
      return [
        `${base} qualification certification test specification technical readiness`,
        `${base} official test release qualified supplier technical milestone`,
        `${base} patent paper qualification testing production readiness`,
      ];
    case 'permitting_regulatory':
      return [
        `${base} permit approval interconnection queue regulatory filing local authority`,
        `${base} ISO RTO utility queue permit authority approval delay`,
        `${base} government permit database regulatory approval project queue`,
      ];
    case 'material_input':
      return [
        `${base} material input commodity supplier filing import export bottleneck`,
        `${base} feedstock input cost supplier capacity trade data shortage`,
        `${base} commodity data supplier filing material availability constraint`,
      ];
    case 'engineering_process':
      return [
        `${base} engineering process production step yield tooling bottleneck`,
        `${base} process qualification production readiness technical constraint`,
        `${base} manufacturing process yield ramp tooling qualification evidence`,
      ];
    case 'test_facility_capacity':
      return [
        `${base} test facility capacity test stand qualification throughput queue`,
        `${base} certification lab test range capacity official test release`,
        `${base} qualification facility bottleneck test throughput lead time`,
      ];
    case 'provider_data_gap':
      return [
        `${base} provider gap adapter required source coverage missing data`,
        `${base} missing official provider evidence class adapter proposal`,
      ];
    case 'substitution_limit':
      return [
        `${base} sole source limited suppliers hard to substitute qualification constraint`,
        `${base} alternative suppliers redundancy chokepoint bottleneck substitution limit`,
        `${base} supply-chain bottleneck qualification constraint limited qualified suppliers`,
      ];
    case 'negative_control':
      return [
        `${subject} easy substitutes supplier redundancy no capacity constraint alternative suppliers`,
        `${subject} no shortage no capacity pressure redundant capacity substitute suppliers`,
        `${subject} no procurement timing pressure non-qualified supplier invalidator`,
      ];
    case 'market_validation':
      return [
        withIssuer(`${subject} event study abnormal return benchmark sector factor regime controls`, issuerUniverse),
        withIssuer(`${subject} relative return market reaction market validation`, issuerUniverse),
      ];
    case 'power_constraint':
    case 'grid_interconnection':
      return [
        `${base} power demand grid interconnection electricity cooling megawatt utility`,
        `${base} data center power constraint transmission interconnection queue`,
        `${base} EIA electricity demand grid capacity bottleneck`,
      ];
    case 'historical_analog':
      return [
        `${subject} historical analog past cycle similar regime market outcome invalidator`,
        `${subject} prior cycle bottleneck precedent market outcome`,
      ];
    default:
      return [];
  }
}

export function buildProviderQueryVariants(input = {}) {
  const evidenceClass = slugify(input.evidenceClass || input.desiredEvidenceClass || input.providerRoutePlan?.evidenceClass || '');
  const plan = input.providerRoutePlan || null;
  const profileVariants = buildEvidenceClassQueryVariants({
    subject: input.subject || input.label || input.target || '',
    evidenceClass,
    issuerUniverse: input.collectionUniverse || input.issuerUniverse || input.symbols || [],
    themes: input.themes || [],
    target: input.target || input.subject || '',
  });
  return unique([
    input.query,
    ...asArray(plan?.queryVariants),
    ...providerQueriesForClass(evidenceClass, input),
    ...profileVariants,
  ]);
}

export function routeEvidenceProvider(input = {}) {
  const evidenceClass = slugify(input.evidenceClass || input.desiredEvidenceClass || input.metadata?.desiredEvidenceClass || input.metadata?.evidenceClass || '');
  const profile = evidenceClassProfile(evidenceClass);
  const promotionUniverse = filterIssuerSymbols(unique([
    ...asArray(input.issuerUniverse),
    ...asArray(input.issuerUniverseSymbols),
    ...asArray(input.symbols),
    ...asArray(input.metadata?.issuerUniverse),
    ...asArray(input.metadata?.symbols),
    ...asArray(input.metadata?.target?.issuerUniverseSymbols),
  ]));
  const candidateIssuerUniverse = filterIssuerSymbols(unique([
    ...asArray(input.candidateIssuerUniverse),
    ...asArray(input.collectionUniverse),
    ...asArray(input.metadata?.candidateIssuerUniverse),
    ...asArray(input.metadata?.collectionUniverse),
    ...asArray(input.metadata?.providerRoutePlan?.candidateIssuerUniverse),
    ...asArray(input.metadata?.providerRoutePlan?.collectionUniverse),
    ...asArray(input.metadata?.issuerDiscoveryMap).map((row) => row.symbol),
    ...asArray(input.metadata?.target?.candidateIssuerUniverse),
    ...asArray(input.metadata?.target?.candidateIssuerUniverseSymbols),
  ]));
  const marketValidationNeedsDirectBridge = evidenceClass === 'market_validation';
  const issuerUniverse = marketValidationNeedsDirectBridge
    ? promotionUniverse
    : filterIssuerSymbols(unique([...promotionUniverse, ...candidateIssuerUniverse]));
  const defaults = routeDefaultsForClass(evidenceClass, input);
  const playbook = evidenceClassPlaybook(evidenceClass);
  const issuerSpecificWithoutIssuers = ISSUER_COLLECTOR_CLASSES.has(evidenceClass) && issuerUniverse.length === 0;
  const executableCollectors = issuerSpecificWithoutIssuers
    ? []
    : defaults.executableCollectors;
  const collectorCapabilities = routeCollectorCapabilities({ evidenceClass, collectors: executableCollectors });
  const hasExecutableCapability = collectorCapabilities.some((item) => item.supported);
  const collectorUnavailable = !issuerSpecificWithoutIssuers && executableCollectors.length > 0 && !hasExecutableCapability;
  const route = {
    evidenceClass,
    providerRoute: input.providerRoute || profile.providerRoute || 'source_query',
    executableCollectors: unique(executableCollectors),
    sourceProviders: unique([...asArray(defaults.sourceProviders), ...asArray(playbook.preferredProviders)]),
    queryVariants: [],
    issuerUniverse,
    collectionUniverse: issuerUniverse,
    promotionUniverse,
    candidateIssuerUniverse,
    issuerDiscoveryStatus: promotionUniverse.length
      ? 'exposure_attached'
      : (candidateIssuerUniverse.length ? 'candidate_only' : 'missing'),
    promotionEligible: Boolean(profile.promotionEligible),
    negativeControlIntent: Boolean(profile.negativeControlIntent || evidenceClass === 'negative_control'),
    acceptanceCriteria: profile.acceptanceCriteria || playbook.promotionCriteria?.description || null,
    requiredFacts: playbook.requiredFacts,
    promotionCriteria: playbook.promotionCriteria,
    contextCriteria: playbook.contextCriteria,
    negativeCriteria: playbook.negativeCriteria,
    terminalFailureModes: playbook.terminalFailureModes,
    collectorCapabilities,
    dataPack: profile.dataPack || input.packName || null,
    ontologyKey: ontologyKeysFrom(input)[0] || input.ontologyKey || null,
    metadata: {
      adjacentCandidateKey: input.metadata?.adjacentCandidateKey || input.adjacentCandidateKey || null,
      adjacentLane: input.metadata?.adjacentLane || input.adjacentLane || null,
      adjacentStatus: input.metadata?.adjacentStatus || input.adjacentStatus || null,
      sourceTerms: asArray(input.metadata?.sourceTerms || input.sourceTerms).slice(0, 16),
      seedTerms: asArray(input.metadata?.seedTerms || input.seedTerms).slice(0, 16),
      parentReadinessState: input.metadata?.parentReadinessState || null,
      parentReadinessReason: input.metadata?.parentReadinessReason || null,
      parentReadyForAdjacent: input.metadata?.parentReadyForAdjacent ?? null,
      parentBackfillState: input.metadata?.parentBackfillState || null,
    },
    blocked: issuerSpecificWithoutIssuers || collectorUnavailable,
    blockedReason: issuerSpecificWithoutIssuers
      ? 'blocked_missing_issuer_universe'
      : collectorUnavailable
        ? 'collector_not_available'
        : null,
    nextAction: issuerSpecificWithoutIssuers
      ? 'resolve issuer universe'
      : collectorUnavailable
        ? `add or enable a collector for ${evidenceClass}`
        : null,
  };
  route.queryVariants = buildProviderQueryVariants({
    ...input,
    evidenceClass,
    issuerUniverse,
    collectionUniverse: issuerUniverse,
    providerRoutePlan: route,
  }).slice(0, Math.max(1, Math.min(12, Number(input.queryVariantLimit || 8))));
  return route;
}

export function routeEvidenceBackfillTasks(tasks = [], options = {}) {
  return asArray(tasks).map((task) => {
    const metadata = task.metadata || {};
    const target = metadata.target || task.target || {};
    const evidenceClass = metadata.desiredEvidenceClass
      || metadata.evidenceClass
      || target.evidenceClass
      || metadata.evidenceContract?.desiredEvidenceClass
      || metadata.evidenceContract?.evidenceClass
      || task.desiredEvidenceClass
      || task.evidenceClass;
    const route = routeEvidenceProvider({
      ...options,
      evidenceClass,
      providerRoute: metadata.providerRoute || target.providerRoute || metadata.evidenceContract?.providerRoute,
      query: task.query || metadata.query,
      subject: metadata.subject?.displayName || metadata.subject?.subjectId || task.subject_label || task.subjectKey || task.subject_key || options.subject,
      target: target.displayName || target.label || metadata.targetName || task.target,
      themes: unique([
        ...asArray(metadata.themes),
        ...asArray(metadata.candidateThemes),
        ...asArray(metadata.subject?.metadata?.themes),
        task.subject_key,
        options.ontologyKey,
      ]),
      ontologyKey: metadata.evidenceContract?.ontologyKey || metadata.ontologyKey || options.ontologyKey,
      ontologyKeys: metadata.evidenceContract?.ontologyKeys || options.ontologyKeys,
      issuerUniverse: [
        ...asArray(metadata.issuerUniverse),
        ...asArray(metadata.symbols),
        ...asArray(target.issuerUniverseSymbols),
        ...asArray(options.issuerUniverse),
      ],
      candidateIssuerUniverse: [
        ...asArray(metadata.candidateIssuerUniverse),
        ...asArray(metadata.collectionUniverse),
        ...asArray(target.candidateIssuerUniverse),
        ...asArray(target.candidateIssuerUniverseSymbols),
        ...asArray(options.candidateIssuerUniverse),
      ],
      metadata,
    });
    return { task, route };
  });
}

export function providerListForRoutes(routes = [], options = {}) {
  const requested = unique(options.providers || COLLECT_FREE_PROVIDERS);
  const routeList = asArray(routes);
  if (!routeList.length) return [];
  const routeProviders = unique(routeList.flatMap((item) => {
    const route = item?.route || item?.providerRoutePlan || item;
    const supportedCollectors = asArray(route?.collectorCapabilities)
      .filter((capability) => capability?.supported)
      .map((capability) => capability.collector || capability.requestedProvider);
    return supportedCollectors.length ? supportedCollectors : asArray(route?.executableCollectors);
  })).filter((provider) => COLLECT_FREE_PROVIDERS.includes(provider));
  if (routeList.length && !routeProviders.length) return [];
  const selected = routeProviders.length
    ? requested.filter((provider) => routeProviders.includes(provider))
    : requested;
  return selected.length ? selected : requested.filter((provider) => COLLECT_FREE_PROVIDERS.includes(provider));
}

export const __test = {
  ontologyKeysFrom,
  routeDefaultsForClass,
  providerQueriesForClass,
};
