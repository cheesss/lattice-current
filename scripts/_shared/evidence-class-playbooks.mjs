function asArray(value) {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function compact(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function slugify(value) {
  return compact(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
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

function regex(pattern, flags = 'i') {
  return new RegExp(pattern, flags);
}

const COMMON_TERMINAL_FAILURE_MODES = Object.freeze([
  'collector_not_available',
  'provider_no_hit',
  'acceptance_failed',
  'search_exhausted_not_validated',
]);

const GENERIC_CAPACITY_FACTS = Object.freeze([
  {
    key: 'production_capacity',
    label: 'production capacity or rate',
    patterns: [regex('\\b(capacity|production rate|annual rate|monthly rate|throughput|ramp(?:ing)?|output)\\b')],
  },
  {
    key: 'facility_or_line',
    label: 'facility, plant, or production line',
    patterns: [regex('\\b(facility|factory|plant|production line|manufacturing line|infrastructure|foundry|fab|shipyard)\\b')],
  },
  {
    key: 'capacity_expansion',
    label: 'capacity expansion or buildout',
    patterns: [regex('\\b(expansion|expand(?:ed|ing)?|buildout|new line|additional capacity|source expansion|scale(?:d| up)?)\\b')],
  },
  {
    key: 'supplier_linkage',
    label: 'supplier or customer linkage',
    patterns: [regex('\\b(supplier|manufacturer|contractor|customer|supply deal|supply agreement|support(?:s|ed|ing)? .{0,60}(operations|program|launch|production))\\b')],
  },
]);

const PLAYBOOKS = Object.freeze({
  procurement_trigger: {
    label: 'Procurement trigger',
    requiredFacts: ['official_contract_or_award', 'funding_or_budget', 'program_linkage', 'amount_or_quantity'],
    preferredProviders: ['dod-contracts', 'usaspending', 'war.gov-contracts', 'defense.gov', 'dod-budget-pdf', 'official-policy'],
    promotionCriteria: {
      anyFacts: ['official_contract_or_award', 'funding_or_budget'],
      supportingFacts: ['program_linkage', 'amount_or_quantity'],
      requiresOfficialSource: true,
      description: 'Official contract, award, funding, budget, or obligation evidence tied to the report subject or program.',
    },
    contextCriteria: {
      anyFacts: ['program_linkage', 'procurement_term', 'amount_or_quantity'],
      description: 'Procurement or program context without official award or budget confirmation.',
    },
    negativeCriteria: {},
    factPatterns: [
      { key: 'official_contract_or_award', label: 'official contract or award', patterns: [regex('\\b(contract award|task order|award(?:ed)?|obligation|recipient|solicitation|procurement contract|agreement)\\b')] },
      { key: 'funding_or_budget', label: 'funding or budget line', patterns: [regex('\\b(funding|budget justification|appropriation|program element|procurement line item|budget line|authorization)\\b')] },
      { key: 'program_linkage', label: 'program linkage', patterns: [regex('\\b(program|mission|platform|interceptor|missile|launch|deployment|customer)\\b')] },
      { key: 'amount_or_quantity', label: 'amount or quantity', patterns: [regex('(\\$\\s?[0-9][0-9,]*(?:\\.[0-9]+)?\\s?(?:million|billion|m|bn)?|\\b[0-9][0-9,]+\\s?(?:units|per year|/yr|annually|systems|missiles|vehicles)\\b)')] },
      { key: 'procurement_term', label: 'procurement term', patterns: [regex('\\b(procurement|contract|award|funding|budget|program)\\b')] },
    ],
    terminalFailureModes: COMMON_TERMINAL_FAILURE_MODES,
  },
  policy_funding: {
    label: 'Policy funding',
    requiredFacts: ['funding_or_budget', 'official_policy_source', 'program_linkage'],
    preferredProviders: ['dod-contracts', 'usaspending', 'defense.gov', 'official-policy', 'government-budget'],
    promotionCriteria: {
      anyFacts: ['funding_or_budget', 'official_policy_source'],
      requiresOfficialSource: true,
      description: 'Official funding, authorization, appropriation, or budget evidence.',
    },
    contextCriteria: { anyFacts: ['program_linkage', 'policy_signal'] },
    negativeCriteria: {},
    factPatterns: [
      { key: 'funding_or_budget', label: 'funding or budget line', patterns: [regex('\\b(funding|budget|appropriation|authorization|program element|budget justification|grant|DPA Title III|title iii)\\b')] },
      { key: 'official_policy_source', label: 'official policy source', patterns: [regex('\\b(government|department|agency|defense.gov|war.gov|federal|federal register|fed\\. reg\\.|ferc|commission|final rule|official|budget justification)\\b')] },
      { key: 'program_linkage', label: 'program linkage', patterns: [regex('\\b(program|mission|procurement|production|industrial base|capacity)\\b')] },
      { key: 'policy_signal', label: 'policy signal', patterns: [regex('\\b(policy|strategy|initiative|authorization|appropriation|funding priority)\\b')] },
    ],
    terminalFailureModes: COMMON_TERMINAL_FAILURE_MODES,
  },
  mission_award: {
    label: 'Mission award',
    requiredFacts: ['official_contract_or_award', 'program_linkage', 'contractor_or_recipient'],
    preferredProviders: ['dod-contracts', 'usaspending', 'official-company', 'government-contracts'],
    promotionCriteria: {
      anyFacts: ['official_contract_or_award'],
      supportingFacts: ['program_linkage', 'contractor_or_recipient'],
      requiresOfficialSource: true,
      description: 'Official mission, launch, program, task-order, or contract award evidence.',
    },
    contextCriteria: { anyFacts: ['program_linkage', 'contractor_or_recipient'] },
    negativeCriteria: {},
    factPatterns: [
      { key: 'official_contract_or_award', label: 'official contract or award', patterns: [regex('\\b(contract award|task order|mission award|launch contract|award(?:ed)?|obligation|agreement)\\b')] },
      { key: 'program_linkage', label: 'program linkage', patterns: [regex('\\b(mission|program|launch|deployment|customer|payload|platform)\\b')] },
      { key: 'contractor_or_recipient', label: 'contractor or recipient', patterns: [regex('\\b(contractor|recipient|supplier|provider|prime|subcontractor)\\b')] },
    ],
    terminalFailureModes: COMMON_TERMINAL_FAILURE_MODES,
  },
  supplier_capacity: {
    label: 'Supplier capacity',
    requiredFacts: ['production_capacity', 'facility_or_line', 'capacity_expansion', 'supplier_linkage'],
    preferredProviders: ['official-company', 'company-newsroom', 'official-pdf', 'trade-press', 'industry-kpi', 'sec', 'fmp'],
    promotionCriteria: {
      anyFacts: ['production_capacity', 'facility_or_line', 'capacity_expansion', 'supplier_linkage'],
      description: 'Concrete supplier, facility, throughput, production-rate, or capacity-expansion evidence.',
    },
    contextCriteria: {
      anyFacts: ['generic_supplier_or_bottleneck'],
      description: 'Generic supplier or bottleneck references without capacity facts.',
    },
    negativeCriteria: {},
    factPatterns: [
      ...GENERIC_CAPACITY_FACTS,
      { key: 'generic_supplier_or_bottleneck', label: 'generic supplier or bottleneck mention', patterns: [regex('\\b(supplier|bottleneck|constraint|shortage|chokepoint)\\b')] },
    ],
    terminalFailureModes: COMMON_TERMINAL_FAILURE_MODES,
  },
  technical_qualification: {
    label: 'Technical qualification',
    requiredFacts: ['qualification_or_certification', 'test_or_demo', 'technical_specification', 'production_readiness'],
    preferredProviders: ['official-company', 'company-technical-release', 'official-test-release', 'patents', 'papers', 'source-query'],
    promotionCriteria: {
      anyFacts: ['qualification_or_certification', 'test_or_demo', 'technical_specification', 'production_readiness'],
      description: 'Qualification, certification, test, technical milestone, or production-readiness evidence.',
    },
    contextCriteria: { anyFacts: ['technical_term'] },
    negativeCriteria: {},
    factPatterns: [
      { key: 'qualification_or_certification', label: 'qualification or certification', patterns: [regex('\\b(qualif(?:y|ied|ication)|certif(?:y|ied|ication)|approved for production|flight qualified|military qualified)\\b')] },
      { key: 'test_or_demo', label: 'test or demonstration', patterns: [regex('\\b(test(?:ed|s|ing)?|test firing|static fire|demo(?:nstration)?|qualification test|validation test)\\b')] },
      { key: 'technical_specification', label: 'technical specification', patterns: [regex('\\b(specification|technical|material|propellant|engine|motor|nozzle|thermal|performance)\\b')] },
      { key: 'production_readiness', label: 'production readiness', patterns: [regex('\\b(production readiness|ready for production|manufacturing readiness|rate production|developed .{0,40} production)\\b')] },
      { key: 'technical_term', label: 'technical term', patterns: [regex('\\b(technical|qualification|certification|test|material|specification)\\b')] },
    ],
    terminalFailureModes: COMMON_TERMINAL_FAILURE_MODES,
  },
  substitution_limit: {
    label: 'Substitution limit',
    requiredFacts: ['qualified_supplier_limit', 'sole_or_single_source', 'qualification_lead_time', 'certification_or_test_dependency', 'hard_to_substitute', 'mandatory_process_gate', 'readiness_or_penalty_requirement', 'queue_or_wait_constraint'],
    preferredProviders: ['official-company', 'company-ir', 'company-technical-release', 'supply-chain-source', 'trade-press', 'source-query'],
    promotionCriteria: {
      anyFacts: ['qualified_supplier_limit', 'sole_or_single_source', 'qualification_lead_time', 'certification_or_test_dependency', 'hard_to_substitute', 'mandatory_process_gate', 'readiness_or_penalty_requirement', 'queue_or_wait_constraint'],
      description: 'Qualified supplier limits, sole/single-source language, qualification lead time, certification/testing dependency, mandatory process gates, readiness penalties, or explicit hard-to-substitute evidence.',
    },
    contextCriteria: {
      anyFacts: ['generic_bottleneck_or_supplier', 'alternative_supplier_reference'],
      description: 'Generic bottleneck, supplier, or alternative references without qualification or substitution facts.',
    },
    negativeCriteria: {
      anyFacts: ['substitution_invalidator'],
      description: 'Evidence that alternatives are available, interchangeable, redundant, or unconstrained.',
    },
    factPatterns: [
      { key: 'qualified_supplier_limit', label: 'limited qualified suppliers', patterns: [regex('\\b(limited qualified suppliers?|qualified supplier count|few qualified suppliers?|limited supplier redundancy|supplier qualification constraint)\\b')] },
      { key: 'sole_or_single_source', label: 'sole or single source', patterns: [regex('\\b(sole source|single source|single-source|sole-source|only qualified supplier|sole supplier)\\b')] },
      { key: 'qualification_lead_time', label: 'qualification lead time', patterns: [regex('\\b(qualification lead time|test lead time|certification lead time|takes (?:years|months)|multi-year qualification|long qualification)\\b')] },
      { key: 'certification_or_test_dependency', label: 'certification or test dependency', patterns: [regex('\\b(certification bottleneck|certification constraint|testing dependency|qualification testing|propellant qualification|approved supplier list|certified supplier)\\b')] },
      { key: 'hard_to_substitute', label: 'hard to substitute', patterns: [regex('\\b(hard to substitute|difficult to substitute|cannot substitute|not interchangeable|no near-term alternative|substitutes? remain difficult)\\b')] },
      { key: 'mandatory_process_gate', label: 'mandatory process gate', patterns: [regex('\\b(impact stud(?:y|ies)|system impact stud(?:y|ies)|facilities stud(?:y|ies)|interconnection stud(?:y|ies)|cluster stud(?:y|ies)|cluster study process|first-ready[, -]+first-served|before (?:a )?project can connect|must undergo .{0,80} stud(?:y|ies)|required .{0,80} interconnection process)\\b')] },
      { key: 'readiness_or_penalty_requirement', label: 'readiness or penalty requirement', patterns: [regex('\\b(site control|commercial readiness deposit|commercial readiness|withdrawal penalties|readiness deposit|readiness requirement)\\b')] },
      { key: 'queue_or_wait_constraint', label: 'queue or wait constraint', patterns: [regex('\\b(interconnection queue backlogs?|interconnection wait(?:ing)? times?|queue backlogs?|long delays? in connect(?:ing)?|process .{0,80} too slow|delays? .{0,80} higher costs?)\\b')] },
      { key: 'alternative_supplier_reference', label: 'alternative supplier reference', patterns: [regex('\\b(alternative suppliers?|substitute suppliers?|redundancy|second source|dual source)\\b')] },
      { key: 'generic_bottleneck_or_supplier', label: 'generic bottleneck or supplier mention', patterns: [regex('\\b(bottleneck|chokepoint|supply-chain constraint|supplier constraint|capacity constraint|supplier)\\b')] },
      { key: 'substitution_invalidator', label: 'substitution invalidator', patterns: [regex('\\b(easy substitutes?|ample alternatives?|interchangeable|redundant capacity|no capacity constraint|no shortage|many qualified suppliers?|readily available alternatives?)\\b')] },
    ],
    terminalFailureModes: COMMON_TERMINAL_FAILURE_MODES,
  },
  propulsion_constraint: {
    label: 'Propulsion constraint',
    requiredFacts: ['production_rate', 'delivery_timing', 'test_or_qualification_delay', 'backlog_or_book_to_bill', 'program_linkage'],
    preferredProviders: ['official-company', 'company-technical-release', 'official-test-release', 'company-ir', 'sec', 'fmp', 'source-query'],
    promotionCriteria: {
      anyFacts: ['production_rate', 'delivery_timing', 'test_or_qualification_delay', 'backlog_or_book_to_bill'],
      supportingFacts: ['program_linkage'],
      description: 'Production-rate, delivery timing, qualification delay, backlog/book-to-bill, or program-linked propulsion constraint evidence.',
    },
    contextCriteria: {
      anyFacts: ['program_linkage', 'generic_propulsion_term'],
      description: 'Propulsion or program context without operating constraint facts.',
    },
    negativeCriteria: {},
    factPatterns: [
      { key: 'production_rate', label: 'production rate', patterns: [regex('\\b(production rate|capacity|annual rate|monthly rate|ramp|throughput|units per year|/yr)\\b')] },
      { key: 'delivery_timing', label: 'delivery timing', patterns: [regex('\\b(delivery timing|deliver(?:y|ies)|lead time|schedule delay|late delivery|timing pressure)\\b')] },
      { key: 'test_or_qualification_delay', label: 'test or qualification delay', patterns: [regex('\\b(qualification delay|test delay|certification delay|test constraint|qualification bottleneck)\\b')] },
      { key: 'backlog_or_book_to_bill', label: 'backlog or book-to-bill', patterns: [regex('\\b(backlog|book-to-bill|book to bill|order book|demand exceeds supply)\\b')] },
      { key: 'program_linkage', label: 'program linkage', patterns: [regex('\\b(program|mission|launch|interceptor|missile|vehicle|platform|customer)\\b')] },
      { key: 'generic_propulsion_term', label: 'generic propulsion term', patterns: [regex('\\b(propulsion|motor|engine|thruster|launch vehicle|missile motor|propellant)\\b')] },
    ],
    terminalFailureModes: COMMON_TERMINAL_FAILURE_MODES,
  },
  historical_analog: {
    label: 'Historical analog',
    requiredFacts: ['period_or_event', 'mechanism_match', 'affected_issuer', 'operating_or_market_outcome', 'current_case_difference_or_invalidator'],
    preferredProviders: ['historical-memory', 'market-history', 'research-source', 'source-query'],
    promotionCriteria: {
      anyFacts: [],
      description: 'Historical analogs are comparison context by default; they do not promote a thesis without current direct evidence.',
      promotionDisabled: true,
    },
    contextCriteria: {
      anyFacts: ['period_or_event', 'mechanism_match', 'operating_or_market_outcome'],
      minFacts: 2,
      description: 'Named period/event with comparable mechanism and outcome, plus differences or invalidators where possible.',
    },
    negativeCriteria: {
      anyFacts: ['current_case_difference_or_invalidator'],
    },
    factPatterns: [
      { key: 'period_or_event', label: 'period or event', patterns: [regex('\\b(19[0-9]{2}|20[0-9]{2}|past cycle|prior cycle|historical|precedent|during the|after the|before the)\\b')] },
      { key: 'mechanism_match', label: 'mechanism match', patterns: [regex('\\b(similar mechanism|analog|same mechanism|capacity cycle|shortage cycle|bottleneck cycle|constraint)\\b')] },
      { key: 'affected_issuer', label: 'affected issuer', patterns: [regex('\\b(issuer|company|supplier|manufacturer|contractor|equity|stock|shares|segment)\\b')] },
      { key: 'operating_or_market_outcome', label: 'operating or market outcome', patterns: [regex('\\b(margin|revenue|backlog|earnings|return|outperformance|underperformance|multiple|market reaction|share price)\\b')] },
      { key: 'current_case_difference_or_invalidator', label: 'current-case difference or invalidator', patterns: [regex('\\b(difference|unlike|invalidator|not comparable|changed|structural difference|counterexample)\\b')] },
    ],
    terminalFailureModes: COMMON_TERMINAL_FAILURE_MODES,
  },
  market_validation: {
    label: 'Market validation',
    requiredFacts: ['controlled_event_window', 'benchmark_or_factor_control', 'sample_size', 't_stat'],
    preferredProviders: ['local-market-db', 'polygon', 'fmp', 'market-quotes', 'market-returns'],
    promotionCriteria: {
      anyFacts: ['controlled_event_window'],
      supportingFacts: ['benchmark_or_factor_control', 'sample_size', 't_stat'],
      requiresLocalControlledData: true,
      description: 'Validated event-window result with sufficient controls, sample, and t-stat. Source-query can only add explanatory context.',
    },
    contextCriteria: { anyFacts: ['market_reaction_context'] },
    negativeCriteria: {},
    factPatterns: [
      { key: 'controlled_event_window', label: 'controlled event window', patterns: [regex('\\b(event window|validated row|controlled market|event study|abnormal return|relative return)\\b')] },
      { key: 'benchmark_or_factor_control', label: 'benchmark/factor/regime control', patterns: [regex('\\b(benchmark|factor|regime|matched controls?|sector control|control group)\\b')] },
      { key: 'sample_size', label: 'sample size', patterns: [regex('\\b(sample size|n\\s*=|events?\\s*=|controls?\\s*=)\\b')] },
      { key: 't_stat', label: 't-stat', patterns: [regex('\\b(t-stat|t stat|t=|z-stat|statistically significant)\\b')] },
      { key: 'market_reaction_context', label: 'market reaction context', patterns: [regex('\\b(market reaction|share reaction|stock reaction|relative move|return)\\b')] },
    ],
    terminalFailureModes: COMMON_TERMINAL_FAILURE_MODES,
  },
  negative_control: {
    label: 'Negative control',
    requiredFacts: ['substitute_or_redundancy', 'no_capacity_pressure', 'no_timing_pressure', 'invalidator', 'supported_constraint'],
    preferredProviders: ['source-query-negative-control', 'official-company', 'trade-press', 'supply-chain-source'],
    promotionCriteria: {
      promotionDisabled: true,
      description: 'Negative-control evidence is separated from promotion evidence.',
    },
    contextCriteria: {
      anyFacts: ['checked_no_direct'],
      description: 'Negative-control search ran but found no direct invalidator.',
    },
    negativeCriteria: {
      anyFacts: ['substitute_or_redundancy', 'no_capacity_pressure', 'no_timing_pressure', 'invalidator', 'supported_constraint'],
      description: 'Invalidator or constraint-supporting negative-control evidence.',
    },
    factPatterns: [
      { key: 'substitute_or_redundancy', label: 'substitute or redundancy', patterns: [regex('\\b(easy substitutes?|alternative suppliers?|supplier redundancy|redundant capacity|many qualified suppliers?|second source|dual source)\\b')] },
      { key: 'no_capacity_pressure', label: 'no capacity pressure', patterns: [regex('\\b(no capacity constraint|no shortage|ample capacity|not capacity constrained|no bottleneck)\\b')] },
      { key: 'no_timing_pressure', label: 'no timing pressure', patterns: [regex('\\b(no timing pressure|no procurement timing|no schedule pressure|not time critical)\\b')] },
      { key: 'invalidator', label: 'invalidator', patterns: [regex('\\b(invalidator|not constrained|not a bottleneck|overstated constraint|bear case)\\b')] },
      { key: 'supported_constraint', label: 'supported constraint', patterns: [regex('\\b(hard to substitute|limited qualified suppliers?|no near-term supplier redundancy|sole source|single source|qualification constraint|capacity constrained|demand exceeds supply)\\b')] },
      { key: 'checked_no_direct', label: 'checked no direct', patterns: [regex('\\b(no direct evidence|no direct invalidator|not found|no evidence that)\\b')] },
    ],
    terminalFailureModes: COMMON_TERMINAL_FAILURE_MODES,
  },
  issuer_exposure: {
    label: 'Issuer exposure',
    requiredFacts: ['issuer_symbol_or_name', 'segment_or_product_link', 'revenue_backlog_or_customer_link'],
    preferredProviders: ['sec', 'fmp', 'company-ir', 'company-newsroom', 'usaspending'],
    promotionCriteria: {
      anyFacts: ['segment_or_product_link', 'revenue_backlog_or_customer_link'],
      supportingFacts: ['issuer_symbol_or_name'],
      description: 'Issuer-specific segment, revenue, backlog, customer, contract, or guidance exposure.',
    },
    contextCriteria: { anyFacts: ['issuer_symbol_or_name'] },
    negativeCriteria: {},
    factPatterns: [
      { key: 'issuer_symbol_or_name', label: 'issuer symbol or company name', patterns: [regex('\\b([A-Z]{2,5}|company|issuer|segment|business unit)\\b')] },
      { key: 'segment_or_product_link', label: 'segment or product link', patterns: [regex('\\b(segment|product|program|platform|business unit|division|portfolio)\\b')] },
      { key: 'revenue_backlog_or_customer_link', label: 'revenue, backlog, or customer link', patterns: [regex('\\b(revenue|sales|backlog|book-to-bill|book to bill|customer|contract|guidance|margin)\\b')] },
    ],
    terminalFailureModes: COMMON_TERMINAL_FAILURE_MODES,
  },
  issuer_commentary: {
    label: 'Issuer commentary',
    requiredFacts: ['management_commentary', 'guidance_or_demand_signal', 'issuer_symbol_or_name'],
    preferredProviders: ['sec', 'fmp-transcripts', 'quartr', 'company-ir'],
    promotionCriteria: {
      anyFacts: ['management_commentary', 'guidance_or_demand_signal'],
      description: 'Management commentary, transcript, filing, or guidance tied to the requested subject.',
    },
    contextCriteria: { anyFacts: ['issuer_symbol_or_name'] },
    negativeCriteria: {},
    factPatterns: [
      { key: 'management_commentary', label: 'management commentary', patterns: [regex('\\b(earnings call|transcript|management said|CEO|CFO|commentary|prepared remarks)\\b')] },
      { key: 'guidance_or_demand_signal', label: 'guidance or demand signal', patterns: [regex('\\b(guidance|demand|outlook|backlog|book-to-bill|capacity|orders|pipeline)\\b')] },
      { key: 'issuer_symbol_or_name', label: 'issuer symbol or company name', patterns: [regex('\\b(company|issuer|segment|investor relations|10-k|10-q|8-k)\\b')] },
    ],
    terminalFailureModes: COMMON_TERMINAL_FAILURE_MODES,
  },
  primary_filing: {
    label: 'Primary filing',
    requiredFacts: ['filing_type', 'mdna_or_risk_factor', 'issuer_symbol_or_name'],
    preferredProviders: ['sec', 'company-ir', 'annual-report', 'quarterly-report'],
    promotionCriteria: {
      anyFacts: ['filing_type', 'mdna_or_risk_factor'],
      description: '10-K, 10-Q, 8-K, annual report, quarterly report, MD&A, risk factor, or filing exhibit.',
    },
    contextCriteria: { anyFacts: ['issuer_symbol_or_name'] },
    negativeCriteria: {},
    factPatterns: [
      { key: 'filing_type', label: 'filing type', patterns: [regex('\\b(10-k|10-q|8-k|annual report|quarterly report|form 10|sec filing)\\b')] },
      { key: 'mdna_or_risk_factor', label: 'MD&A/risk factor/exhibit', patterns: [regex('\\b(MD&A|management discussion|risk factor|exhibit|segment note|footnote)\\b', 'i')] },
      { key: 'issuer_symbol_or_name', label: 'issuer symbol or company name', patterns: [regex('\\b(company|issuer|registrant|segment|business)\\b')] },
    ],
    terminalFailureModes: COMMON_TERMINAL_FAILURE_MODES,
  },
  power_constraint: {
    label: 'Power constraint',
    requiredFacts: ['power_or_grid_capacity', 'utility_or_grid_operator', 'load_or_interconnection_timing'],
    preferredProviders: ['eia', 'utility-filings', 'grid-operator', 'company-ir', 'policy-source'],
    promotionCriteria: {
      anyFacts: ['power_or_grid_capacity', 'load_or_interconnection_timing'],
      supportingFacts: ['utility_or_grid_operator'],
      description: 'Power, grid, interconnection, load, cooling, utility, or energy bottleneck evidence.',
    },
    contextCriteria: { anyFacts: ['generic_power_term'] },
    negativeCriteria: {},
    factPatterns: [
      { key: 'power_or_grid_capacity', label: 'power or grid capacity', patterns: [regex('\\b(power demand|electricity demand|grid capacity|megawatt|mw|transmission|substation|cooling)\\b')] },
      { key: 'utility_or_grid_operator', label: 'utility or grid operator', patterns: [regex('\\b(utility|grid operator|ISO|RTO|interconnection queue|transmission provider|EIA)\\b')] },
      { key: 'load_or_interconnection_timing', label: 'load or interconnection timing', patterns: [regex('\\b(load ramp|interconnection|connection delay|queue|energization|power availability|lead time)\\b')] },
      { key: 'generic_power_term', label: 'generic power term', patterns: [regex('\\b(power demand|power availability|power capacity|data center power|grid|electricity|cooling|energy bottleneck|utility|interconnection|megawatt|mw)\\b')] },
    ],
    terminalFailureModes: COMMON_TERMINAL_FAILURE_MODES,
  },
  grid_interconnection: {
    label: 'Grid interconnection',
    requiredFacts: ['interconnection_queue', 'transmission_or_utility', 'capacity_or_timing'],
    preferredProviders: ['eia', 'ferc', 'rto-iso', 'utility-filings', 'public-planning-source', 'company-ir'],
    promotionCriteria: {
      anyFacts: ['interconnection_queue', 'capacity_or_timing'],
      supportingFacts: ['transmission_or_utility'],
      description: 'Interconnection queue, grid access, transmission, utility, capacity, or timing evidence.',
    },
    contextCriteria: { anyFacts: ['generic_grid_term'] },
    negativeCriteria: {},
    factPatterns: [
      { key: 'interconnection_queue', label: 'interconnection queue', patterns: [regex('\\b(interconnection queue|queue backlog|grid interconnection|interconnection request|interconnection agreement)\\b')] },
      { key: 'transmission_or_utility', label: 'transmission or utility', patterns: [regex('\\b(transmission|utility|rto|iso|grid operator|load serving|substation|transmission provider|ferc)\\b', 'i')] },
      { key: 'capacity_or_timing', label: 'capacity or timing', patterns: [regex('\\b(megawatt|mw|gigawatt|gw|capacity|lead time|delay|wait time|energization|load ramp|power availability)\\b', 'i')] },
      { key: 'generic_grid_term', label: 'generic grid term', patterns: [regex('\\b(grid|interconnection|transmission|utility|substation|queue|power availability)\\b', 'i')] },
    ],
    terminalFailureModes: COMMON_TERMINAL_FAILURE_MODES,
  },
  capex_confirmation: {
    label: 'Capex confirmation',
    requiredFacts: ['capex_or_infrastructure_spend', 'buildout_or_capacity_link', 'issuer_symbol_or_name'],
    preferredProviders: ['sec', 'fmp-fundamentals', 'fmp-transcripts', 'company-ir'],
    promotionCriteria: {
      anyFacts: ['capex_or_infrastructure_spend', 'buildout_or_capacity_link'],
      supportingFacts: ['issuer_symbol_or_name'],
      description: 'Issuer capex, capital allocation, infrastructure spending, or buildout evidence tied to the report subject.',
    },
    contextCriteria: { anyFacts: ['issuer_symbol_or_name', 'generic_capex_term'] },
    negativeCriteria: {},
    factPatterns: [
      { key: 'capex_or_infrastructure_spend', label: 'capex or infrastructure spend', patterns: [regex('\\b(capex|capital expenditures?|capital spending|capital investment|capital allocation|infrastructure spending)\\b', 'i')] },
      { key: 'buildout_or_capacity_link', label: 'buildout or capacity link', patterns: [regex('\\b(buildout|data centers?|capacity expansion|infrastructure build|leased capacity|megawatt|mw|power capacity|cloud infrastructure)\\b', 'i')] },
      { key: 'generic_capex_term', label: 'generic capex term', patterns: [regex('\\b(capex|capital|infrastructure|buildout)\\b', 'i')] },
    ],
    terminalFailureModes: COMMON_TERMINAL_FAILURE_MODES,
  },
  compute_demand: {
    label: 'Compute demand',
    requiredFacts: ['compute_or_ai_workload', 'demand_signal'],
    preferredProviders: ['company-ir', 'sec', 'fmp-transcripts', 'industry-source'],
    promotionCriteria: {
      anyFacts: ['compute_or_ai_workload', 'demand_signal'],
      description: 'Compute, accelerator, AI workload, training, inference, or cloud demand evidence.',
    },
    contextCriteria: { anyFacts: ['generic_compute_term'] },
    negativeCriteria: {},
    factPatterns: [
      { key: 'compute_or_ai_workload', label: 'compute or AI workload', patterns: [regex('\\b(compute demand|ai workload|training workload|inference|accelerator|gpu|cloud workload|AI infrastructure)\\b', 'i')] },
      { key: 'demand_signal', label: 'demand signal', patterns: [regex('\\b(demand|orders?|backlog|capacity demand|customer demand|growth|ramp)\\b', 'i')] },
      { key: 'generic_compute_term', label: 'generic compute term', patterns: [regex('\\b(compute|accelerator|gpu|inference|training|cloud)\\b', 'i')] },
    ],
    terminalFailureModes: COMMON_TERMINAL_FAILURE_MODES,
  },
  cloud_revenue: {
    label: 'Cloud revenue',
    requiredFacts: ['cloud_or_segment_revenue', 'workload_or_ai_demand', 'issuer_symbol_or_name'],
    preferredProviders: ['sec', 'fmp-fundamentals', 'fmp-transcripts', 'company-ir'],
    promotionCriteria: {
      anyFacts: ['cloud_or_segment_revenue', 'workload_or_ai_demand'],
      supportingFacts: ['issuer_symbol_or_name'],
      description: 'Issuer cloud segment revenue, AI cloud demand, workload monetization, or segment growth evidence.',
    },
    contextCriteria: { anyFacts: ['issuer_symbol_or_name', 'generic_cloud_term'] },
    negativeCriteria: {},
    factPatterns: [
      { key: 'cloud_or_segment_revenue', label: 'cloud or segment revenue', patterns: [regex('\\b(cloud revenue|cloud segment|segment revenue|cloud sales|revenue growth|operating income)\\b', 'i')] },
      { key: 'workload_or_ai_demand', label: 'workload or AI demand', patterns: [regex('\\b(ai demand|ai cloud|workload|training|inference|cloud demand|customer demand)\\b', 'i')] },
      { key: 'generic_cloud_term', label: 'generic cloud term', patterns: [regex('\\b(cloud|workload|ai infrastructure|data center)\\b', 'i')] },
    ],
    terminalFailureModes: COMMON_TERMINAL_FAILURE_MODES,
  },
  accelerator_orders: {
    label: 'Accelerator orders',
    requiredFacts: ['accelerator_or_gpu', 'order_or_backlog_signal'],
    preferredProviders: ['company-ir', 'sec', 'fmp-transcripts', 'supply-chain-source'],
    promotionCriteria: {
      anyFacts: ['accelerator_or_gpu', 'order_or_backlog_signal'],
      description: 'GPU, accelerator, ASIC, networking, memory, order, allocation, or backlog evidence.',
    },
    contextCriteria: { anyFacts: ['generic_accelerator_term'] },
    negativeCriteria: {},
    factPatterns: [
      { key: 'accelerator_or_gpu', label: 'accelerator or GPU', patterns: [regex('\\b(gpu|accelerator|asic|hbm|ai server|networking|memory bandwidth)\\b', 'i')] },
      { key: 'order_or_backlog_signal', label: 'order or backlog signal', patterns: [regex('\\b(order|orders|backlog|allocation|supply allocation|lead time|customer commitment|bookings)\\b', 'i')] },
      { key: 'generic_accelerator_term', label: 'generic accelerator term', patterns: [regex('\\b(gpu|accelerator|asic|hbm|networking)\\b', 'i')] },
    ],
    terminalFailureModes: COMMON_TERMINAL_FAILURE_MODES,
  },
  data_center_utilization: {
    label: 'Data-center utilization',
    requiredFacts: ['data_center_capacity', 'utilization_or_load_signal'],
    preferredProviders: ['company-ir', 'sec', 'utility-filings', 'industry-source'],
    promotionCriteria: {
      anyFacts: ['data_center_capacity', 'utilization_or_load_signal'],
      description: 'Data-center utilization, leased capacity, absorption, occupancy, load-ramp, or power-load evidence.',
    },
    contextCriteria: { anyFacts: ['generic_data_center_term'] },
    negativeCriteria: {},
    factPatterns: [
      { key: 'data_center_capacity', label: 'data-center capacity', patterns: [regex('\\b(data centers?|leased capacity|colocation|campus|facility|megawatt|mw|critical load)\\b', 'i')] },
      { key: 'utilization_or_load_signal', label: 'utilization or load signal', patterns: [regex('\\b(utilization|occupancy|absorption|load ramp|energization|power availability|capacity utilization)\\b', 'i')] },
      { key: 'generic_data_center_term', label: 'generic data center term', patterns: [regex('\\b(data center|colocation|leased capacity|load ramp|occupancy)\\b', 'i')] },
    ],
    terminalFailureModes: COMMON_TERMINAL_FAILURE_MODES,
  },
  operating_kpi: {
    label: 'Operating KPI',
    requiredFacts: ['operating_metric', 'demand_supply_or_capacity'],
    preferredProviders: ['eia', 'fred', 'industry-kpi', 'official-source', 'company-ir'],
    promotionCriteria: {
      anyFacts: ['operating_metric', 'demand_supply_or_capacity'],
      description: 'Operating metric evidence for demand, supply, capacity, utilization, pricing, shipments, orders, or backlog.',
    },
    contextCriteria: { anyFacts: ['generic_operating_term'] },
    negativeCriteria: {},
    factPatterns: [
      { key: 'operating_metric', label: 'operating metric', patterns: [regex('\\b(metric|index|series|observed|reported|utilization|shipments?|sales|load|capacity|backlog|orders?)\\b', 'i')] },
      { key: 'demand_supply_or_capacity', label: 'demand/supply/capacity', patterns: [regex('\\b(demand|supply|capacity|utilization|pricing|shipment|production|electricity sales|megawatt|mw)\\b', 'i')] },
      { key: 'generic_operating_term', label: 'generic operating term', patterns: [regex('\\b(demand|supply|capacity|utilization|orders|backlog|production)\\b', 'i')] },
    ],
    terminalFailureModes: COMMON_TERMINAL_FAILURE_MODES,
  },
});

const DEFAULT_PLAYBOOK = Object.freeze({
  label: 'Generic evidence class',
  requiredFacts: ['direct_subject_link', 'operating_or_source_detail'],
  preferredProviders: ['source-query', 'official-source', 'research-source'],
  promotionCriteria: {
    anyFacts: ['direct_subject_link', 'operating_or_source_detail'],
    description: 'Direct subject linkage plus operating, issuer, policy, technical, or market detail.',
  },
  contextCriteria: {
    anyFacts: ['generic_subject_reference'],
  },
  negativeCriteria: {},
  factPatterns: [
    { key: 'direct_subject_link', label: 'direct subject linkage', patterns: [regex('\\b(capacity|demand|revenue|backlog|contract|funding|technical|qualification|market|supplier|program|facility|launch|power|grid)\\b')] },
    { key: 'operating_or_source_detail', label: 'operating/source detail', patterns: [regex('\\b(amount|quantity|rate|segment|customer|official|filing|transcript|test|budget|award|event study|controls?)\\b')] },
    { key: 'generic_subject_reference', label: 'generic subject reference', patterns: [regex('\\b(theme|subject|supplier|market|source|research|industry)\\b')] },
  ],
  terminalFailureModes: COMMON_TERMINAL_FAILURE_MODES,
});

const SOURCE_QUERY_CONTEXT_ONLY_CLASSES = new Set([
  'market_validation',
]);

const OFFICIAL_SOURCE_RE = /\b(usaspending|defense\.gov|war\.gov|dod|department of defense|spaceforce\.mil|ssc\.spaceforce\.mil|nasa\.gov|sec|edgar|10-k|10-q|8-k|eia|ferc|energy\.gov|emp\.lbl\.gov|lbl\.gov|rto|iso|utility|public[-_\s]?planning|interconnection queue|federal|government|official|budget justification|appropriation|procurement line item|company-ir|investor relations|annual report|quarterly report)\b/i;
const LOCAL_MARKET_RE = /\b(local-market-db|event-control|market_returns|market_quotes|event_uplift|matched_controls|polygon|fmp)\b/i;

export const EVIDENCE_CLASS_PLAYBOOKS = PLAYBOOKS;

export function evidenceClassPlaybook(evidenceClass = '') {
  const key = slugify(evidenceClass);
  const playbook = PLAYBOOKS[key] || DEFAULT_PLAYBOOK;
  return {
    evidenceClass: key || 'generic',
    ...playbook,
    requiredFacts: [...asArray(playbook.requiredFacts)],
    preferredProviders: [...asArray(playbook.preferredProviders)],
    terminalFailureModes: [...asArray(playbook.terminalFailureModes || COMMON_TERMINAL_FAILURE_MODES)],
    promotionCriteria: { ...(playbook.promotionCriteria || {}) },
    contextCriteria: { ...(playbook.contextCriteria || {}) },
    negativeCriteria: { ...(playbook.negativeCriteria || {}) },
    factPatterns: [...asArray(playbook.factPatterns)],
  };
}

function textFromInput(input = {}) {
  const metadata = input.metadata || {};
  return compact([
    input.text,
    input.title,
    input.excerpt,
    input.textExcerpt,
    input.summary,
    input.url,
    input.sourceType,
    input.sourceProvider,
    input.provider,
    metadata.title,
    metadata.text,
    metadata.excerpt,
    metadata.source,
    metadata.sourceProvider,
    metadata.provider,
    metadata.publisher,
    metadata.url,
    asArray(metadata.hitKpis).join(' '),
  ].filter(Boolean).join(' '));
}

function sourceTextFromInput(input = {}) {
  const metadata = input.metadata || {};
  return compact([
    input.provider,
    input.sourceType,
    input.sourceProvider,
    input.url,
    metadata.provider,
    metadata.sourceProvider,
    metadata.source,
    metadata.publisher,
    metadata.url,
  ].filter(Boolean).join(' '));
}

function metadataFacts(evidenceClass = '', input = {}) {
  const metadata = input.metadata || {};
  const facts = [];
  const amount = Number(input.amountUsd || input.largestAwardUsd || metadata.amountUsd || metadata.largestAwardUsd || 0);
  const hitKpis = asArray(input.hitKpis || metadata.hitKpis).map((item) => slugify(item));
  if (metadata.symbol || metadata.issuerName || input.symbol || input.issuerName) {
    facts.push({ key: 'issuer_symbol_or_name', label: 'issuer symbol or company name', source: 'metadata' });
  }
  const sourceType = String(input.sourceType || metadata.sourceType || metadata.provider || '').toLowerCase();
  const filingType = String(metadata.filingType || input.filingType || '').toLowerCase();
  if (/\b(10-k|10-q|8-k)\b/.test(filingType) || /sec_.*filing|sec_direct_management_commentary|sec_earnings_release_exhibit/.test(sourceType)) {
    facts.push({ key: 'filing_type', label: 'filing type', source: 'metadata' });
  }
  if (/transcript|management_commentary|earnings_release|company-ir|investor relations/.test(sourceType)) {
    facts.push({ key: 'management_commentary', label: 'management commentary', source: 'metadata' });
  }
  if (amount > 0) {
    facts.push({ key: 'amount_or_quantity', label: 'amount or quantity', source: 'metadata' });
  }
  if (input.awardId || metadata.awardId) {
    facts.push({ key: 'official_contract_or_award', label: 'official contract or award', source: 'metadata' });
  }
  if (hitKpis.some((key) => /contract_awards|award|obligation|procurement/.test(key))) {
    facts.push({ key: 'official_contract_or_award', label: 'official contract or award', source: 'hitKpis' });
  }
  if (hitKpis.some((key) => /budget|funding|appropriation/.test(key))) {
    facts.push({ key: 'funding_or_budget', label: 'funding or budget line', source: 'hitKpis' });
  }
  if (hitKpis.some((key) => /capacity|production|throughput/.test(key))) {
    facts.push({ key: 'production_capacity', label: 'production capacity or rate', source: 'hitKpis' });
  }
  if (evidenceClass === 'market_validation') {
    const market = metadata.marketValidation || input.marketValidation || metadata;
    if (market.eventWindow || market.validated || market.decisionGrade || market.screeningGrade) {
      facts.push({ key: 'controlled_event_window', label: 'controlled event window', source: 'metadata' });
    }
    if (market.hasBenchmarkControl || market.hasFactorControl || market.regimeConsistent || market.controlCount) {
      facts.push({ key: 'benchmark_or_factor_control', label: 'benchmark/factor/regime control', source: 'metadata' });
    }
    if (Number(market.sampleSize || market.eventCount || 0) > 0) {
      facts.push({ key: 'sample_size', label: 'sample size', source: 'metadata' });
    }
    if (Number.isFinite(Number(market.tStat || market.maxAbsTStat))) {
      facts.push({ key: 't_stat', label: 't-stat', source: 'metadata' });
    }
  }
  return facts;
}

export function extractFactsForEvidenceClass(evidenceClass = '', input = {}) {
  const normalized = slugify(evidenceClass);
  const playbook = evidenceClassPlaybook(normalized);
  const text = textFromInput(input);
  const extracted = [];
  for (const fact of playbook.factPatterns) {
    const matched = asArray(fact.patterns).some((pattern) => pattern.test(text));
    if (!matched) continue;
    extracted.push({
      key: fact.key,
      label: fact.label || fact.key,
      source: 'text',
    });
  }
  extracted.push(...metadataFacts(normalized, input));
  const seen = new Set();
  const factsExtracted = [];
  for (const fact of extracted) {
    const key = compact(fact?.key);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    factsExtracted.push({
      key,
      label: fact.label || key,
      source: fact.source || 'text',
    });
  }
  const factKeys = factsExtracted.map((fact) => fact.key);
  const missingFacts = asArray(playbook.requiredFacts).filter((fact) => !factKeys.includes(fact));
  return {
    evidenceClass: normalized,
    factsExtracted,
    factKeys,
    missingFacts,
    requiredFacts: playbook.requiredFacts,
  };
}

function hasAny(keys = [], wanted = []) {
  const keySet = new Set(keys);
  return asArray(wanted).some((key) => keySet.has(key));
}

function countAny(keys = [], wanted = []) {
  const keySet = new Set(keys);
  return asArray(wanted).reduce((sum, key) => sum + (keySet.has(key) ? 1 : 0), 0);
}

function providerLooksOfficial(input = {}) {
  return OFFICIAL_SOURCE_RE.test(sourceTextFromInput(input)) || OFFICIAL_SOURCE_RE.test(textFromInput(input));
}

function providerLooksLocalMarket(input = {}) {
  return LOCAL_MARKET_RE.test(sourceTextFromInput(input)) || LOCAL_MARKET_RE.test(textFromInput(input));
}

function evidenceUseRank(value = '') {
  return ({
    promotion_candidate: 5,
    negative_control_candidate: 4,
    supporting_context: 3,
    weak_noise: 2,
    rejected: 1,
  })[String(value || '').trim()] || 0;
}

function useAtMost(evidenceUse = '', maxEvidenceUse = '') {
  if (!maxEvidenceUse) return evidenceUse;
  return evidenceUseRank(evidenceUse) <= evidenceUseRank(maxEvidenceUse) ? evidenceUse : maxEvidenceUse;
}

export function closureReasonForAcceptance(evidenceUse = '', fallback = null) {
  return ({
    promotion_candidate: 'promotion_collected',
    supporting_context: 'context_collected',
    negative_control_candidate: 'negative_collected',
    weak_noise: 'acceptance_failed',
    rejected: 'rejected',
  })[String(evidenceUse || '').trim()] || fallback || null;
}

export function evaluateEvidenceClassAcceptance({
  evidenceClass = '',
  provider = '',
  sourceType = '',
  text = '',
  title = '',
  excerpt = '',
  textExcerpt = '',
  metadata = {},
  evidenceUse = null,
  maxEvidenceUse = null,
  targetHit = true,
  classCueHit = false,
  strongClassCueHit = classCueHit,
  rejectedReason = null,
} = {}) {
  const normalized = slugify(evidenceClass);
  const playbook = evidenceClassPlaybook(normalized);
  const input = { provider, sourceType, text, title, excerpt, textExcerpt, metadata };
  const factResult = extractFactsForEvidenceClass(normalized, input);
  const factKeys = factResult.factKeys;
  const officialSource = providerLooksOfficial(input);
  const localMarketSource = providerLooksLocalMarket(input);
  const promotion = playbook.promotionCriteria || {};
  const context = playbook.contextCriteria || {};
  const negative = playbook.negativeCriteria || {};
  const promotionFactCount = countAny(factKeys, promotion.anyFacts);
  const contextFactCount = countAny(factKeys, context.anyFacts);
  const negativeFactCount = countAny(factKeys, negative.anyFacts);
  const promotionMinFacts = Number(promotion.minFacts || (asArray(promotion.anyFacts).length ? 1 : 0));
  const contextMinFacts = Number(context.minFacts || (asArray(context.anyFacts).length ? 1 : 0));
  const canPromote =
    !promotion.promotionDisabled
    && targetHit !== false
    && promotionFactCount >= promotionMinFacts
    && (!promotion.requiresOfficialSource || officialSource)
    && (!promotion.requiresLocalControlledData || localMarketSource);
  const hasContext =
    targetHit !== false
    && (
      contextFactCount >= contextMinFacts
      || factKeys.length > 0
      || classCueHit
      || strongClassCueHit
    );
  const hasNegative = negativeFactCount > 0;
  let verdict = 'rejected';
  let reason = rejectedReason || null;

  if (rejectedReason && evidenceUse === 'weak_noise') {
    verdict = 'weak_noise';
  } else if (rejectedReason && !factKeys.length) {
    verdict = 'rejected';
  } else if (normalized === 'negative_control') {
    verdict = hasNegative || hasContext ? 'negative_control_candidate' : 'weak_noise';
  } else if (SOURCE_QUERY_CONTEXT_ONLY_CLASSES.has(normalized) && String(provider || sourceType).includes('source-query')) {
    verdict = hasContext ? 'supporting_context' : 'weak_noise';
    reason = reason || 'source_query_market_validation_context_only';
  } else if (canPromote) {
    verdict = 'promotion_candidate';
  } else if (hasNegative && normalized === 'substitution_limit') {
    verdict = 'supporting_context';
    reason = reason || 'substitution_invalidator_context';
  } else if (evidenceUse === 'supporting_context' && targetHit !== false) {
    verdict = 'supporting_context';
    reason = reason || 'target_context_without_required_facts';
  } else if (hasContext) {
    verdict = 'supporting_context';
  } else if (evidenceUse === 'weak_noise' || factKeys.length > 0) {
    verdict = 'weak_noise';
  }

  if (evidenceUse === 'rejected' && verdict !== 'rejected') {
    verdict = 'weak_noise';
  }
  if (evidenceUse === 'weak_noise' && verdict === 'promotion_candidate') {
    verdict = strongClassCueHit ? 'promotion_candidate' : 'supporting_context';
  }
  verdict = useAtMost(verdict, maxEvidenceUse);

  return {
    evidenceClass: normalized,
    playbookLabel: playbook.label,
    requiredFacts: factResult.requiredFacts,
    factsExtracted: factResult.factsExtracted,
    factKeys,
    missingFacts: factResult.missingFacts,
    matchedCriteria: [
      promotionFactCount ? 'promotion_fact' : null,
      contextFactCount ? 'context_fact' : null,
      negativeFactCount ? 'negative_fact' : null,
      officialSource ? 'official_source' : null,
      localMarketSource ? 'local_market_source' : null,
    ].filter(Boolean),
    acceptanceVerdict: verdict,
    evidenceUse: verdict,
    promotionEligible: verdict === 'promotion_candidate',
    closureReason: closureReasonForAcceptance(verdict, factKeys.length ? 'acceptance_failed' : 'provider_no_hit'),
    reason,
    officialSource,
    localMarketSource,
  };
}

export const __test = {
  COMMON_TERMINAL_FAILURE_MODES,
  textFromInput,
  sourceTextFromInput,
  providerLooksOfficial,
  providerLooksLocalMarket,
};
