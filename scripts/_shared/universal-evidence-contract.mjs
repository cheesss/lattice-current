import {
  filterIssuerSymbols,
  resolveThemeOntology,
} from './theme-ontology.mjs';

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (value === null || value === undefined || value === '') return [];
  return [value];
}

function compact(value = '') {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function slugify(value = '') {
  return compact(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '') || 'unknown';
}

function unique(values = [], normalizer = (value) => compact(value)) {
  const seen = new Set();
  const out = [];
  for (const value of asArray(values).flat()) {
    const normalized = normalizer(value);
    if (!normalized) continue;
    const key = String(normalized).toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(normalized);
  }
  return out;
}

function words(value = '') {
  return compact(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

function containsPhrase(text = '', phrase = '') {
  const needle = compact(phrase).toLowerCase();
  if (!needle) return false;
  if (needle.length >= 12) return text.includes(needle);
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`\\b${escaped}\\b`, 'i').test(text);
}

function rowText(row = {}) {
  return compact([
    row.title,
    row.label,
    row.publisher,
    row.source_type,
    row.sourceType,
    row.kind,
    row.fact_text,
    row.factText,
    row.summary,
    row.excerpt,
    row.textExcerpt,
    row.metadata?.title,
    row.metadata?.excerpt,
    row.metadata?.evidenceUse,
    row.metadata?.directness,
  ].filter(Boolean).join(' ')).toLowerCase();
}

export const COMMON_EVIDENCE_CLASSES = Object.freeze([
  'operating_kpi',
  'issuer_commentary',
  'primary_filing',
  'mechanism_validation',
  'issuer_exposure',
  'negative_control',
  'market_validation',
  'historical_analog',
]);

export const EVIDENCE_CLASS_PROFILES = Object.freeze({
  operating_kpi: {
    label: 'Operating KPI',
    providerRoute: 'industry_or_provider_kpi',
    dataPack: 'industryPack',
    acceptanceCriteria: 'theme-specific demand, supply, capacity, utilization, pricing, backlog, order, or operating metric evidence',
    queryTerms: ['demand', 'supply', 'capacity', 'utilization', 'pricing', 'orders', 'backlog'],
    cues: ['demand', 'supply', 'capacity', 'utilization', 'pricing', 'orders', 'backlog', 'shipment', 'production'],
    promotionEligible: true,
  },
  issuer_commentary: {
    label: 'Issuer commentary',
    providerRoute: 'transcript_or_issuer_release',
    dataPack: 'transcriptPack',
    acceptanceCriteria: 'issuer management commentary that confirms or rejects the operating mechanism',
    queryTerms: ['earnings call transcript', 'management commentary', 'guidance', 'demand', 'capacity'],
    cues: ['earnings call', 'management commentary', 'guidance', 'ceo', 'cfo', 'commentary', 'transcript'],
    issuerSpecific: true,
    promotionEligible: true,
  },
  primary_filing: {
    label: 'Primary filing',
    providerRoute: 'sec_or_company_filing',
    dataPack: 'filingPack',
    acceptanceCriteria: '10-K, 10-Q, 8-K, MD&A, risk factor, exhibit, or company-filed primary evidence',
    queryTerms: ['10-K', '10-Q', '8-K', 'MD&A', 'risk factor', 'exhibit', 'segment'],
    cues: ['10-k', '10-q', '8-k', 'm d a', 'risk factor', 'annual report', 'quarterly report', 'exhibit'],
    issuerSpecific: true,
    promotionEligible: true,
  },
  mechanism_validation: {
    label: 'Mechanism validation',
    providerRoute: 'source_query_or_research',
    dataPack: 'causalPack',
    acceptanceCriteria: 'evidence that links driver, mechanism, bottleneck, issuer exposure, and expected timing',
    queryTerms: ['mechanism', 'transmission path', 'driver', 'bottleneck', 'lag', 'exposure'],
    cues: ['mechanism', 'driver', 'bottleneck', 'constraint', 'transmission', 'lag', 'exposure'],
    promotionEligible: true,
  },
  issuer_exposure: {
    label: 'Issuer exposure',
    providerRoute: 'issuer_filing_transcript_or_contract',
    dataPack: 'fundamentalPack',
    acceptanceCriteria: 'issuer, segment, customer, revenue, backlog, contract, or guidance link to the theme',
    queryTerms: ['issuer exposure', 'segment revenue', 'customer', 'contract', 'backlog', 'guidance'],
    cues: ['issuer', 'revenue', 'segment', 'customer', 'contract', 'backlog', 'guidance', 'margin', 'book-to-bill', 'book to bill'],
    issuerSpecific: true,
    promotionEligible: true,
  },
  negative_control: {
    label: 'Negative control',
    providerRoute: 'source_query_negative_control',
    dataPack: 'evidencePack',
    acceptanceCriteria: 'evidence for substitutes, redundancy, no constraint, no timing pressure, or invalidating mechanism',
    queryTerms: ['easy substitutes', 'supplier redundancy', 'no capacity constraint', 'alternative suppliers', 'invalidator'],
    cues: ['easy substitute', 'easy substitutes', 'supplier redundancy', 'no capacity constraint', 'alternative supplier', 'alternative suppliers', 'invalidator', 'no timing pressure', 'not constrained'],
    negativeControlIntent: true,
    promotionEligible: false,
  },
  market_validation: {
    label: 'Market validation',
    providerRoute: 'market_event_study',
    dataPack: 'marketValidationPack',
    acceptanceCriteria: 'event-window sensitivity with benchmark, sector, factor, and regime controls where available',
    queryTerms: ['event study', 'abnormal return', 'benchmark', 'sector', 'factor', 'regime controls'],
    cues: ['event study', 'abnormal return', 'relative return', 'benchmark', 'factor', 'regime', 't-stat', 't stat'],
    issuerSpecific: true,
    promotionEligible: true,
  },
  historical_analog: {
    label: 'Historical analog',
    providerRoute: 'historical_memory',
    dataPack: 'historicalAnalogPack',
    acceptanceCriteria: 'named historical period or event with similarity, difference, outcome, and invalidator',
    queryTerms: ['historical analog', 'past cycle', 'similar regime', 'market outcome', 'invalidator'],
    cues: ['historical analog', 'past cycle', 'similar regime', 'market outcome', 'precedent', 'prior cycle'],
    promotionEligible: false,
  },
  supplier_capacity: {
    label: 'Supplier capacity',
    providerRoute: 'industry_official_or_company_source',
    dataPack: 'industryPack',
    acceptanceCriteria: 'facility, capacity, production-line, throughput, supplier, or expansion evidence',
    queryTerms: ['production capacity', 'facility', 'throughput', 'supplier', 'expansion', 'plant'],
    cues: ['capacity', 'facility', 'plant', 'factory', 'production', 'throughput', 'line', 'supplier', 'manufacturer', 'expansion'],
    promotionEligible: true,
  },
  technical_qualification: {
    label: 'Technical qualification',
    providerRoute: 'technical_or_company_source',
    dataPack: 'researchPack',
    acceptanceCriteria: 'qualification, certification, test, specification, material, or production-readiness evidence',
    queryTerms: ['qualification', 'certification', 'test', 'specification', 'technical readiness'],
    cues: ['qualified', 'qualification', 'certification', 'certified', 'technical', 'specification', 'test', 'tested', 'testing', 'test firing'],
    promotionEligible: true,
  },
  permitting_regulatory: {
    label: 'Permitting / regulatory',
    providerRoute: 'public_permit_or_regulatory_source',
    dataPack: 'policyPack',
    acceptanceCriteria: 'permit, interconnection, approval, queue, authority, regulatory filing, or local authorization evidence',
    queryTerms: ['permit', 'interconnection queue', 'regulatory filing', 'approval', 'authority'],
    cues: ['permit', 'permitting', 'interconnection', 'queue', 'regulatory', 'approval', 'authorized', 'authority', 'utility filing'],
    promotionEligible: true,
  },
  material_input: {
    label: 'Material input',
    providerRoute: 'trade_or_supplier_input_source',
    dataPack: 'industryPack',
    acceptanceCriteria: 'specific material, commodity, import/export, supplier filing, or input-cost bottleneck evidence',
    queryTerms: ['material input', 'commodity', 'import', 'export', 'supplier filing', 'input cost'],
    cues: ['material', 'commodity', 'input', 'feedstock', 'import', 'export', 'tariff', 'supplier filing'],
    promotionEligible: true,
  },
  engineering_process: {
    label: 'Engineering process',
    providerRoute: 'technical_or_process_source',
    dataPack: 'researchPack',
    acceptanceCriteria: 'engineering process, production step, yield, tooling, qualification, or process constraint evidence',
    queryTerms: ['engineering process', 'production step', 'yield', 'tooling', 'process constraint'],
    cues: ['engineering', 'process', 'yield', 'tooling', 'process step', 'qualification', 'ramp'],
    promotionEligible: true,
  },
  test_facility_capacity: {
    label: 'Test facility capacity',
    providerRoute: 'technical_or_public_facility_source',
    dataPack: 'researchPack',
    acceptanceCriteria: 'test stand, qualification facility, certification lab, range, queue, or throughput evidence',
    queryTerms: ['test facility', 'test stand', 'qualification facility', 'certification lab', 'test throughput'],
    cues: ['test stand', 'test facility', 'certification lab', 'qualification facility', 'range', 'throughput'],
    promotionEligible: true,
  },
  provider_data_gap: {
    label: 'Provider data gap',
    providerRoute: 'adapter_proposal_only',
    dataPack: 'auditPack',
    acceptanceCriteria: 'missing provider coverage label that blocks evidence collection; not promotion evidence',
    queryTerms: ['provider gap', 'adapter required', 'source coverage gap'],
    cues: ['provider gap', 'adapter required', 'missing source', 'coverage gap'],
    promotionEligible: false,
  },
  procurement_trigger: {
    label: 'Procurement trigger',
    providerRoute: 'official_contract_or_policy_source',
    dataPack: 'policyPack',
    acceptanceCriteria: 'contract, award, funding, budget, procurement, solicitation, or program trigger evidence',
    queryTerms: ['procurement', 'contract award', 'funding', 'budget', 'program', 'solicitation'],
    cues: ['procurement', 'contract', 'award', 'funding', 'budget', 'program', 'appropriation', 'solicitation', 'pentagon', 'dod'],
    promotionEligible: true,
  },
  substitution_limit: {
    label: 'Substitution limit',
    providerRoute: 'negative_control_or_supply_chain_source',
    dataPack: 'industryPack',
    acceptanceCriteria: 'sole-source, limited supplier, hard-to-substitute, qualification constraint, or chokepoint evidence',
    queryTerms: ['sole source', 'limited suppliers', 'hard to substitute', 'qualification constraint', 'chokepoint'],
    cues: ['substitute', 'substitution', 'alternative', 'redundancy', 'single source', 'sole source', 'limited supplier', 'limited suppliers', 'hard to substitute', 'chokepoint', 'bottleneck'],
    promotionEligible: true,
  },
  capex_confirmation: {
    label: 'Capex confirmation',
    providerRoute: 'filing_transcript_or_provider_fundamentals',
    dataPack: 'fundamentalPack',
    acceptanceCriteria: 'capex, capital allocation, data-center buildout, or infrastructure spending evidence',
    queryTerms: ['capex', 'capital expenditure', 'infrastructure spending', 'buildout', 'capital allocation'],
    cues: ['capex', 'capital expenditure', 'capital spending', 'capital allocation', 'buildout', 'data center build'],
    issuerSpecific: true,
    promotionEligible: true,
  },
  compute_demand: {
    label: 'Compute demand',
    providerRoute: 'industry_or_issuer_source',
    dataPack: 'industryPack',
    acceptanceCriteria: 'compute, accelerator, GPU, workload, inference, training, or cloud demand evidence',
    queryTerms: ['compute demand', 'accelerator demand', 'GPU demand', 'AI workload', 'inference'],
    cues: ['compute demand', 'accelerator', 'gpu', 'workload', 'inference', 'training', 'cloud demand'],
    promotionEligible: true,
  },
  power_constraint: {
    label: 'Power constraint',
    providerRoute: 'industry_policy_or_utility_source',
    dataPack: 'industryPack',
    acceptanceCriteria: 'power demand, grid, interconnection, electricity, cooling, or energy bottleneck evidence',
    queryTerms: ['power demand', 'grid interconnection', 'electricity demand', 'cooling', 'energy bottleneck'],
    cues: ['power demand', 'grid', 'interconnection', 'electricity', 'cooling', 'energy bottleneck', 'megawatt', 'mw'],
    promotionEligible: true,
  },
  data_center_utilization: {
    label: 'Data-center utilization',
    providerRoute: 'industry_or_issuer_source',
    dataPack: 'industryPack',
    acceptanceCriteria: 'data-center utilization, leased capacity, absorption, occupancy, or load-ramp evidence',
    queryTerms: ['data center utilization', 'leased capacity', 'absorption', 'occupancy', 'load ramp'],
    cues: ['data center utilization', 'leased capacity', 'absorption', 'occupancy', 'load ramp', 'utilization rate'],
    promotionEligible: true,
  },
  cloud_revenue: {
    label: 'Cloud revenue',
    providerRoute: 'issuer_fundamental_or_transcript',
    dataPack: 'fundamentalPack',
    acceptanceCriteria: 'cloud revenue, AI cloud demand, segment growth, or workload monetization evidence',
    queryTerms: ['cloud revenue', 'AI cloud demand', 'segment growth', 'workload monetization'],
    cues: ['cloud revenue', 'cloud demand', 'ai cloud', 'segment growth', 'workload monetization'],
    issuerSpecific: true,
    promotionEligible: true,
  },
  accelerator_orders: {
    label: 'Accelerator orders',
    providerRoute: 'issuer_or_supply_chain_source',
    dataPack: 'industryPack',
    acceptanceCriteria: 'GPU, accelerator, ASIC, networking, memory, order, allocation, or backlog evidence',
    queryTerms: ['GPU orders', 'accelerator orders', 'ASIC demand', 'allocation', 'backlog'],
    cues: ['gpu order', 'accelerator order', 'asic', 'allocation', 'backlog', 'hbm', 'networking'],
    promotionEligible: true,
  },
  trial_readout: {
    label: 'Trial readout',
    providerRoute: 'clinical_or_company_source',
    dataPack: 'researchPack',
    acceptanceCriteria: 'trial result, endpoint, safety, efficacy, enrollment, or phase milestone evidence',
    queryTerms: ['trial readout', 'endpoint', 'efficacy', 'safety', 'phase 2', 'phase 3'],
    cues: ['trial', 'endpoint', 'efficacy', 'safety', 'phase 2', 'phase 3', 'enrollment'],
    promotionEligible: true,
  },
  regulatory_milestone: {
    label: 'Regulatory milestone',
    providerRoute: 'regulatory_or_company_source',
    dataPack: 'policyPack',
    acceptanceCriteria: 'FDA, EMA, approval, filing, label, complete response, or regulatory decision evidence',
    queryTerms: ['FDA approval', 'regulatory filing', 'label', 'complete response', 'EMA'],
    cues: ['fda', 'ema', 'approval', 'regulatory', 'label', 'complete response', 'pdufa'],
    promotionEligible: true,
  },
  pipeline_exposure: {
    label: 'Pipeline exposure',
    providerRoute: 'issuer_filing_or_company_source',
    dataPack: 'fundamentalPack',
    acceptanceCriteria: 'pipeline, product, indication, market opportunity, partner, or revenue exposure evidence',
    queryTerms: ['pipeline', 'product exposure', 'indication', 'partner', 'revenue opportunity'],
    cues: ['pipeline', 'indication', 'partner', 'commercial opportunity', 'product candidate'],
    issuerSpecific: true,
    promotionEligible: true,
  },
  wafer_capacity: {
    label: 'Wafer capacity',
    providerRoute: 'industry_or_issuer_source',
    dataPack: 'industryPack',
    acceptanceCriteria: 'wafer capacity, fab utilization, foundry capacity, or node supply evidence',
    queryTerms: ['wafer capacity', 'fab utilization', 'foundry capacity', 'node supply'],
    cues: ['wafer', 'fab', 'foundry', 'utilization', 'node', 'capacity'],
    promotionEligible: true,
  },
  advanced_packaging: {
    label: 'Advanced packaging',
    providerRoute: 'industry_or_issuer_source',
    dataPack: 'industryPack',
    acceptanceCriteria: 'CoWoS, advanced packaging, substrate, interposer, or capacity bottleneck evidence',
    queryTerms: ['advanced packaging', 'CoWoS', 'substrate', 'interposer', 'capacity'],
    cues: ['advanced packaging', 'cowos', 'substrate', 'interposer', 'packaging capacity'],
    promotionEligible: true,
  },
  memory_bandwidth: {
    label: 'Memory bandwidth',
    providerRoute: 'industry_or_issuer_source',
    dataPack: 'industryPack',
    acceptanceCriteria: 'HBM, memory bandwidth, DRAM, supply, or allocation evidence',
    queryTerms: ['HBM', 'memory bandwidth', 'DRAM supply', 'allocation'],
    cues: ['hbm', 'memory bandwidth', 'dram', 'allocation', 'memory supply'],
    promotionEligible: true,
  },
  node_transition: {
    label: 'Node transition',
    providerRoute: 'industry_or_issuer_source',
    dataPack: 'industryPack',
    acceptanceCriteria: 'process-node migration, yield, design-win, or capacity transition evidence',
    queryTerms: ['node transition', 'process migration', 'yield', 'design win'],
    cues: ['node transition', 'process node', 'yield', 'design win', 'migration', 'ramp'],
    promotionEligible: true,
  },
  policy_funding: {
    label: 'Policy funding',
    providerRoute: 'official_policy_or_budget_source',
    dataPack: 'policyPack',
    acceptanceCriteria: 'subsidy, grant, tax credit, procurement funding, budget, or authorization evidence',
    queryTerms: ['subsidy', 'grant', 'tax credit', 'procurement funding', 'budget authorization'],
    cues: ['subsidy', 'grant', 'tax credit', 'funding', 'budget', 'authorization', 'appropriation'],
    promotionEligible: true,
  },
  grid_interconnection: {
    label: 'Grid interconnection',
    providerRoute: 'industry_policy_or_utility_source',
    dataPack: 'industryPack',
    acceptanceCriteria: 'interconnection queue, grid access, transmission, or utility-connection bottleneck evidence',
    queryTerms: ['grid interconnection', 'interconnection queue', 'transmission access', 'utility connection'],
    cues: ['interconnection queue', 'grid interconnection', 'transmission access', 'utility connection', 'queue backlog'],
    promotionEligible: true,
  },
  capacity_addition: {
    label: 'Capacity addition',
    providerRoute: 'industry_or_company_source',
    dataPack: 'industryPack',
    acceptanceCriteria: 'capacity addition, project pipeline, facility expansion, production ramp, or utilization evidence',
    queryTerms: ['capacity addition', 'project pipeline', 'facility expansion', 'production ramp'],
    cues: ['capacity addition', 'project pipeline', 'facility expansion', 'production ramp', 'capacity expansion'],
    promotionEligible: true,
  },
  commodity_input: {
    label: 'Commodity input',
    providerRoute: 'commodity_or_supply_chain_source',
    dataPack: 'industryPack',
    acceptanceCriteria: 'commodity input price, availability, bottleneck, inventory, or supply-chain evidence',
    queryTerms: ['commodity input', 'input cost', 'supply bottleneck', 'inventory'],
    cues: ['commodity input', 'input cost', 'supply bottleneck', 'inventory', 'shortage'],
    promotionEligible: true,
  },
  launch_manifest: {
    label: 'Launch manifest',
    providerRoute: 'industry_or_company_source',
    dataPack: 'industryPack',
    acceptanceCriteria: 'launch manifest, cadence, mission backlog, range slot, or failure-rate evidence',
    queryTerms: ['launch manifest', 'launch cadence', 'mission backlog', 'range availability'],
    cues: ['launch manifest', 'launch cadence', 'mission backlog', 'range availability', 'launch slot'],
    promotionEligible: true,
  },
  satellite_backlog: {
    label: 'Satellite backlog',
    providerRoute: 'issuer_or_industry_source',
    dataPack: 'industryPack',
    acceptanceCriteria: 'satellite backlog, constellation deployment, payload integration, or order evidence',
    queryTerms: ['satellite backlog', 'constellation deployment', 'payload integration', 'orders'],
    cues: ['satellite backlog', 'constellation deployment', 'payload integration', 'payload backlog'],
    promotionEligible: true,
  },
  propulsion_constraint: {
    label: 'Propulsion constraint',
    providerRoute: 'technical_or_supplier_source',
    dataPack: 'industryPack',
    acceptanceCriteria: 'propulsion supplier, motor, engine, qualification, capacity, or production constraint evidence',
    queryTerms: ['propulsion constraint', 'motor capacity', 'engine supplier', 'qualification'],
    cues: ['propulsion constraint', 'motor capacity', 'engine supplier', 'qualification', 'propulsion bottleneck'],
    promotionEligible: true,
  },
  mission_award: {
    label: 'Mission award',
    providerRoute: 'official_contract_or_company_source',
    dataPack: 'policyPack',
    acceptanceCriteria: 'mission award, launch contract, task order, procurement, or program funding evidence',
    queryTerms: ['mission award', 'launch contract', 'task order', 'program funding'],
    cues: ['mission award', 'launch contract', 'task order', 'program funding'],
    promotionEligible: true,
  },
  breach_driver: {
    label: 'Breach driver',
    providerRoute: 'security_incident_or_research_source',
    dataPack: 'researchPack',
    acceptanceCriteria: 'breach, ransomware, incident, vulnerability, exploit, or threat-driver evidence',
    queryTerms: ['breach', 'ransomware', 'incident', 'vulnerability', 'exploit'],
    cues: ['breach', 'ransomware', 'incident', 'vulnerability', 'exploit', 'threat actor'],
    promotionEligible: true,
  },
  budget_signal: {
    label: 'Budget signal',
    providerRoute: 'issuer_transcript_or_survey_source',
    dataPack: 'fundamentalPack',
    acceptanceCriteria: 'budget, spend, pipeline, ARR, billings, seat expansion, or security-demand evidence',
    queryTerms: ['security budget', 'spend', 'ARR', 'billings', 'seat expansion'],
    cues: ['security budget', 'spend', 'arr', 'billings', 'seat expansion', 'pipeline'],
    issuerSpecific: true,
    promotionEligible: true,
  },
  vendor_exposure: {
    label: 'Vendor exposure',
    providerRoute: 'issuer_filing_transcript_or_customer_source',
    dataPack: 'fundamentalPack',
    acceptanceCriteria: 'vendor, product, customer, module, segment, revenue, or exposure evidence',
    queryTerms: ['vendor exposure', 'product module', 'customer', 'segment revenue'],
    cues: ['vendor exposure', 'product module', 'customer', 'segment revenue', 'platform exposure'],
    issuerSpecific: true,
    promotionEligible: true,
  },
  regulatory_security_requirement: {
    label: 'Regulatory security requirement',
    providerRoute: 'policy_or_regulatory_source',
    dataPack: 'policyPack',
    acceptanceCriteria: 'regulatory disclosure, cyber rule, compliance mandate, incident-reporting, or procurement security requirement evidence',
    queryTerms: ['cyber regulation', 'disclosure rule', 'incident reporting', 'security requirement'],
    cues: ['cyber regulation', 'disclosure rule', 'incident reporting', 'security requirement', 'compliance mandate'],
    promotionEligible: true,
  },
  technology_maturity: {
    label: 'Technology maturity',
    providerRoute: 'research_patent_or_technical_source',
    dataPack: 'researchPack',
    acceptanceCriteria: 'paper, patent, technical milestone, deployment, performance, or maturity evidence',
    queryTerms: ['technical milestone', 'patent', 'paper', 'deployment', 'performance'],
    cues: ['patent', 'paper', 'technical milestone', 'deployment', 'performance', 'prototype'],
    promotionEligible: true,
  },
  developer_ecosystem: {
    label: 'Developer ecosystem',
    providerRoute: 'github_or_ecosystem_source',
    dataPack: 'researchPack',
    acceptanceCriteria: 'developer activity, GitHub, ecosystem adoption, package downloads, or integration evidence',
    queryTerms: ['GitHub', 'developer activity', 'ecosystem adoption', 'package downloads'],
    cues: ['github', 'developer', 'ecosystem', 'package', 'integration', 'repository'],
    promotionEligible: true,
  },
});

const DOMAIN_CLASS_MAP = Object.freeze({
  defense_industrial: ['supplier_capacity', 'technical_qualification', 'procurement_trigger', 'substitution_limit', 'policy_funding'],
  data_center_infrastructure: ['capex_confirmation', 'compute_demand', 'power_constraint', 'grid_interconnection', 'cloud_revenue', 'accelerator_orders', 'data_center_utilization'],
  semiconductor: ['wafer_capacity', 'advanced_packaging', 'memory_bandwidth', 'node_transition', 'capex_confirmation', 'accelerator_orders'],
  clean_energy: ['policy_funding', 'grid_interconnection', 'capacity_addition', 'commodity_input', 'power_constraint', 'technology_maturity'],
  space: ['launch_manifest', 'satellite_backlog', 'propulsion_constraint', 'mission_award', 'supplier_capacity', 'technical_qualification', 'issuer_exposure', 'policy_funding'],
  cybersecurity: ['breach_driver', 'budget_signal', 'vendor_exposure', 'regulatory_security_requirement', 'issuer_commentary', 'developer_ecosystem', 'mechanism_validation', 'negative_control'],
  biotech: ['trial_readout', 'regulatory_milestone', 'pipeline_exposure', 'issuer_commentary'],
  generic: [],
});

function subjectDisplay(bundle = {}) {
  return compact(bundle.subject?.displayName || bundle.subject?.label || bundle.subject?.subjectId || bundle.subjectId || bundle.theme || bundle.symbol || 'subject');
}

function themesFromBundle(bundle = {}) {
  return unique([
    bundle.subject?.themeId,
    bundle.subject?.theme,
    bundle.subject?.key,
    bundle.subject?.subjectId,
    bundle.metadata?.theme,
    ...asArray(bundle.subject?.themes),
    ...asArray(bundle.subject?.metadata?.themes),
    ...asArray(bundle.metadata?.candidate?.themes),
  ]);
}

function symbolsFromBundle(bundle = {}, extra = []) {
  return unique([
    bundle.subject?.symbol,
    bundle.subject?.ticker,
    bundle.subject?.subjectType === 'symbol' ? bundle.subject?.subjectId : null,
    ...asArray(bundle.symbols),
    ...asArray(bundle.metadata?.symbols),
    ...asArray(bundle.metadata?.candidate?.symbols),
    ...asArray(bundle.metadata?.candidate?.discovery?.symbol),
    ...asArray(extra),
  ], (value) => compact(value).toUpperCase());
}

function classSpec(evidenceClass = '') {
  const key = slugify(evidenceClass);
  const profile = EVIDENCE_CLASS_PROFILES[key] || {
    label: key.replace(/_/g, ' '),
    providerRoute: 'source_query',
    dataPack: 'evidencePack',
    acceptanceCriteria: `${key.replace(/_/g, ' ')} evidence`,
    queryTerms: [key.replace(/_/g, ' ')],
    cues: [key.replace(/_/g, ' ')],
    promotionEligible: true,
  };
  return {
    evidenceClass: key,
    ...profile,
  };
}

export function evidenceClassProfile(evidenceClass = '') {
  return classSpec(evidenceClass);
}

function crossThemeSupplementalClasses(bundle = {}, ontologyKeys = []) {
  const text = compact([
    subjectDisplay(bundle),
    bundle.subject?.metadata?.theme,
    bundle.subject?.metadata?.parentTheme,
    bundle.subject?.metadata?.discovery?.connector,
    bundle.subject?.metadata?.discovery?.mechanism,
    ...asArray(bundle.subject?.metadata?.discovery?.triggerTerms),
    ...ontologyKeys,
  ].filter(Boolean).join(' ')).toLowerCase();
  const domainKeys = new Set(asArray(ontologyKeys).map(slugify));
  if (domainKeys.has('defense_industrial') || domainKeys.has('space')
    || /\b(defense|missile|munition|rocket motor|solid rocket|interceptor|launch|propulsion|procurement)\b/i.test(text)) {
    return ['supplier_capacity', 'technical_qualification', 'procurement_trigger', 'substitution_limit'];
  }
  if (domainKeys.has('semiconductor')
    || /\b(fab|wafer|foundry|packaging|substrate|hbm|node|manufacturing capacity)\b/i.test(text)) {
    return ['supplier_capacity', 'technical_qualification', 'substitution_limit'];
  }
  if (domainKeys.has('clean_energy')
    || /\b(grid|interconnection|transmission|utility|power|energy|commodity|battery|solar|wind)\b/i.test(text)) {
    return ['supplier_capacity', 'substitution_limit'];
  }
  if (domainKeys.has('data_center_infrastructure')
    || /\b(data center|cloud|ai infrastructure|power availability|interconnection|cooling|substation)\b/i.test(text)) {
    return ['supplier_capacity'];
  }
  if (/\b(capacity|supplier|bottleneck|constraint|chokepoint)\b/i.test(text)) {
    return ['supplier_capacity', 'substitution_limit'];
  }
  return ['supplier_capacity'];
}

function isStrictEndogenousFrontierBundle(bundle = {}) {
  const discovery = bundle.subject?.metadata?.discovery || {};
  const adjacentMetadata = bundle.metadata?.adjacentCandidate?.metadata || {};
  const subjectMetadata = bundle.subject?.metadata || {};
  const bundleMetadata = bundle.metadata || {};
  return discovery.discoveryNamespace === 'strict_endogenous_adjacent'
    || adjacentMetadata.discoveryNamespace === 'strict_endogenous_adjacent'
    || subjectMetadata.discoveryNamespace === 'strict_endogenous_adjacent'
    || bundleMetadata.discoveryNamespace === 'strict_endogenous_adjacent'
    || discovery.frontierDiscovery === true
    || adjacentMetadata.frontierDiscovery === true
    || subjectMetadata.frontierDiscovery === true
    || bundleMetadata.frontierDiscovery === true
    || discovery.generatedLane === true
    || adjacentMetadata.generatedLane === true;
}

function strictFrontierNodeClasses(bundle = {}) {
  const discovery = bundle.subject?.metadata?.discovery || {};
  const adjacentMetadata = bundle.metadata?.adjacentCandidate?.metadata || {};
  const nodes = [
    ...asArray(discovery.concreteBottleneckNodes),
    ...asArray(adjacentMetadata.concreteBottleneckNodes),
  ];
  const nodeClasses = nodes.flatMap((node) => asArray(node?.evidenceClasses));
  const text = compact([
    subjectDisplay(bundle),
    discovery.connector,
    discovery.mechanism,
    adjacentMetadata.connector,
    adjacentMetadata.mechanism,
    ...asArray(discovery.triggerTerms),
    ...asArray(adjacentMetadata.sourceTerms),
    ...nodes.flatMap((node) => [
      node?.node,
      node?.key,
      node?.nodeType,
      ...asArray(node?.sourceTerms),
      ...asArray(node?.acceptanceCriteria),
    ]),
  ].filter(Boolean).join(' ')).toLowerCase();
  const inferred = [];
  if (/\b(interconnection|queue|transmission|substation|rto|iso|utility|grid)\b/i.test(text)) {
    inferred.push('grid_interconnection', 'power_constraint');
  }
  if (/\b(study|technical review|qualification|certification|standard|testing|approved supplier)\b/i.test(text)) {
    inferred.push('technical_qualification');
  }
  if (/\b(permitting|permit|policy|regulatory|rule|funding|grant|doe|ferc)\b/i.test(text)) {
    inferred.push('policy_funding');
  }
  if (/\b(capacity|supplier|bottleneck|constraint|lead time|backlog|limited|single source|sole source|hard to substitute|substitution)\b/i.test(text)) {
    inferred.push('supplier_capacity', 'substitution_limit');
  }
  return unique([...nodeClasses, ...inferred], slugify);
}

function contractClassList(bundle = {}, ontologyKeys = []) {
  const reportType = String(bundle.reportType || '');
  const subjectType = String(bundle.subject?.subjectType || bundle.subject?.subject_type || '');
  const crossTheme = reportType === 'cross_theme_bottleneck_report' || subjectType === 'cross_theme_candidate';
  const strictFrontier = crossTheme && isStrictEndogenousFrontierBundle(bundle);
  const classes = [
    ...COMMON_EVIDENCE_CLASSES,
    ...(strictFrontier ? strictFrontierNodeClasses(bundle) : ontologyKeys.flatMap((key) => DOMAIN_CLASS_MAP[key] || [])),
  ];
  if (crossTheme) {
    classes.push(...crossThemeSupplementalClasses(bundle, ontologyKeys));
  }
  if (reportType === 'symbol_signal_report' || subjectType === 'symbol') {
    classes.push('issuer_commentary', 'primary_filing', 'issuer_exposure', 'market_validation');
  }
  if (reportType === 'event_signal_report') {
    classes.push('mechanism_validation', 'issuer_exposure', 'market_validation', 'negative_control');
  }
  return unique(classes, slugify);
}

export function evidenceClassesForReportContract(bundle = {}, options = {}) {
  const themeInputs = themesFromBundle(bundle);
  const ontologyKeys = unique([
    options.ontologyCoverage?.ontologyKey,
    ...asArray(options.ontologyKeys),
    ...themeInputs.map((themeId) => resolveThemeOntology({ themeId, themeLabel: themeId }).key),
  ].filter(Boolean), slugify).filter((key) => key && key !== 'unknown');
  const archetype = ontologyKeys.find((key) => key && key !== 'generic') || 'generic';
  return contractClassList(bundle, ontologyKeys.length ? ontologyKeys : [archetype]);
}

export function buildUniversalEvidenceContract(bundle = {}, options = {}) {
  const themeInputs = themesFromBundle(bundle);
  const ontologyKeys = unique([
    options.ontologyCoverage?.ontologyKey,
    ...themeInputs.map((themeId) => resolveThemeOntology({ themeId, themeLabel: themeId }).key),
  ].filter(Boolean), slugify).filter((key) => key && key !== 'unknown');
  const archetype = ontologyKeys.find((key) => key && key !== 'generic') || 'generic';
  const issuerUniverse = filterIssuerSymbols(symbolsFromBundle(bundle, options.issuerUniverseSymbols), {
    excludeSymbols: options.ontologyCoverage?.excludedSymbols,
  });
  const requiredClasses = evidenceClassesForReportContract(bundle, { ontologyCoverage: options.ontologyCoverage, ontologyKeys })
    .map((evidenceClass) => classSpec(evidenceClass));
  const providerRoutes = unique(requiredClasses.map((item) => item.providerRoute));
  const negativeControls = requiredClasses
    .filter((item) => item.negativeControlIntent || item.evidenceClass === 'negative_control')
    .map((item) => ({
      evidenceClass: item.evidenceClass,
      query: compileEvidenceClassQuery({
        subject: subjectDisplay(bundle),
        classSpec: item,
        issuerUniverse,
        negativeControl: true,
      }),
      acceptanceCriteria: item.acceptanceCriteria,
    }));
  return {
    version: 'universal-evidence-contract-v1',
    subjectType: bundle.subject?.subjectType || bundle.subject?.subject_type || bundle.reportType || 'unknown',
    reportType: bundle.reportType || 'unknown',
    subject: subjectDisplay(bundle),
    ontologyKey: archetype,
    ontologyKeys,
    archetype,
    requiredClasses,
    providerRoutes,
    issuerUniverse,
    negativeControls,
    boundary: 'Specifies evidence needed for report readiness; it does not create facts or lower promotion gates.',
  };
}

export function evidenceClassCueHit(evidenceClass, text = '') {
  const profile = classSpec(evidenceClass);
  const normalized = compact(text).toLowerCase();
  return asArray(profile.cues).some((cue) => containsPhrase(normalized, cue));
}

export function inferEvidenceClassFromText(text = '') {
  const normalized = compact(text).toLowerCase();
  const ranked = Object.keys(EVIDENCE_CLASS_PROFILES)
    .map((evidenceClass) => ({
      evidenceClass,
      hits: asArray(EVIDENCE_CLASS_PROFILES[evidenceClass].cues).filter((cue) => containsPhrase(normalized, cue)).length,
    }))
    .filter((item) => item.hits > 0)
    .sort((left, right) => right.hits - left.hits);
  return ranked[0]?.evidenceClass || null;
}

export function compileEvidenceClassQuery({
  subject = '',
  classSpec: spec = {},
  issuerUniverse = [],
  negativeControl = false,
} = {}) {
  const issuerPhrase = spec.issuerSpecific && issuerUniverse.length ? `${issuerUniverse.slice(0, 5).join(' ')} ` : '';
  const terms = unique([
    ...(negativeControl ? ['easy substitutes', 'supplier redundancy', 'no constraint', 'invalidator'] : []),
    ...asArray(spec.queryTerms),
  ]).slice(0, 8);
  return compact(`${issuerPhrase}${subject} ${terms.join(' ')}`);
}

export function buildEvidenceClassQueryVariants({
  subject = '',
  evidenceClass = '',
  issuerUniverse = [],
  themes = [],
  target = '',
} = {}) {
  const spec = classSpec(evidenceClass);
  const baseSubject = compact(target || subject);
  const issuerPhrase = spec.issuerSpecific && issuerUniverse.length ? issuerUniverse.slice(0, 4).join(' ') : '';
  const themePhrase = asArray(themes).slice(0, 2).join(' ');
  return unique([
    compileEvidenceClassQuery({ subject: baseSubject, classSpec: spec, issuerUniverse }),
    compact(`${issuerPhrase} ${baseSubject} ${themePhrase} ${asArray(spec.queryTerms).slice(0, 5).join(' ')}`),
    compact(`${baseSubject} ${spec.acceptanceCriteria}`),
  ]).filter(Boolean);
}

function rowEvidenceClass(row = {}, contract = {}) {
  const metadata = row.metadata || {};
  const explicit = compact(metadata.desiredEvidenceClass || metadata.evidenceClass || row.desiredEvidenceClass || row.evidenceClass);
  if (explicit) return slugify(explicit);
  const text = rowText(row);
  const contractClasses = asArray(contract.requiredClasses).map((item) => item.evidenceClass);
  const matched = contractClasses.find((evidenceClass) => evidenceClassCueHit(evidenceClass, text));
  return matched || inferEvidenceClassFromText(text);
}

function rowSourceGroup(row = {}) {
  return slugify(row.metadata?.sourceGroup || row.publisher || row.source_type || row.sourceType || row.source || row.metadata?.source || 'source');
}

function rowEvidenceUse(row = {}) {
  return compact(row.metadata?.evidenceUse || row.metadata?.relevanceTier || row.evidenceUse || row.relevanceTier);
}

function rowPromotionEligible(row = {}) {
  const use = rowEvidenceUse(row);
  return row.metadata?.promotionEligible === true
    || row.metadata?.promotionEligible === 'true'
    || row.promotionEligible === true
    || row.crossThemeRole === 'promotion_anchor'
    || use === 'promotion_candidate';
}

function rowDirect(row = {}, evidenceClass = '') {
  const use = rowEvidenceUse(row);
  if (['weak_noise', 'supporting_context'].includes(use)) return false;
  if (rowPromotionEligible(row)) return true;
  const directness = compact(row.metadata?.directness || row.directness || row.evidenceStrength || row.evidenceGrade || row.evidence_grade).toLowerCase();
  if (/direct|primary|issuer|filing|transcript/.test(directness)) return true;
  return evidenceClassCueHit(evidenceClass, rowText(row)) && /contract|award|capacity|guidance|backlog|filing|transcript|facility|qualification|event study/i.test(rowText(row));
}

function rowsFromPacks(bundle = {}, packs = {}) {
  const rows = [...asArray(bundle.evidence)];
  for (const pack of Object.values(packs || {})) {
    rows.push(
      ...asArray(pack?.rows),
      ...asArray(pack?.fundamentals),
      ...asArray(pack?.valuations),
      ...asArray(pack?.cards),
      ...asArray(pack?.edges),
      ...asArray(pack?.analogues),
    );
  }
  return rows.filter(Boolean);
}

export function buildEvidenceClassMatrix({
  bundle = {},
  contract = buildUniversalEvidenceContract(bundle),
  packs = {},
  crossThemeEvidenceMatrix = null,
} = {}) {
  const rows = rowsFromPacks(bundle, packs);
  const crossThemeByClass = new Map(asArray(crossThemeEvidenceMatrix).map((item) => [slugify(item.evidenceClass), item]));
  return asArray(contract.requiredClasses).map((spec) => {
    const evidenceClass = spec.evidenceClass;
    const matchedRows = rows.filter((row) => rowEvidenceClass(row, contract) === evidenceClass);
    const cross = crossThemeByClass.get(evidenceClass);
    const directCount = matchedRows.filter((row) => rowDirect(row, evidenceClass)).length + Number(cross?.directCount || 0);
    const promotionEligibleCount = spec.negativeControlIntent
      ? 0
      : matchedRows.filter((row) => rowPromotionEligible(row)).length + Number(cross?.promotionEligibleCount || 0);
    const contextCount = matchedRows.filter((row) => ['supporting_context', 'weak_noise', 'negative_control_candidate'].includes(rowEvidenceUse(row))).length + Number(cross?.contextCount || 0);
    const sourceGroups = unique([
      ...matchedRows.map(rowSourceGroup),
      ...asArray(cross?.sourceGroups),
    ]).filter((group) => group && group !== 'source');
    const status = promotionEligibleCount > 0
      ? 'promotion_eligible'
      : directCount > 0
        ? 'direct'
        : contextCount > 0
          ? 'context'
          : 'missing';
    const nextQuery = compileEvidenceClassQuery({
      subject: subjectDisplay(bundle),
      classSpec: spec,
      issuerUniverse: contract.issuerUniverse,
      negativeControl: spec.negativeControlIntent,
    });
    return {
      evidenceClass,
      label: spec.label,
      status,
      directCount,
      contextCount,
      promotionEligibleCount,
      rowCount: matchedRows.length + Number(cross?.rowCount || 0),
      sourceGroups,
      missingReason: status === 'missing' ? `${spec.label} evidence has not reached context/direct threshold.` : null,
      nextQuery,
      providerRoute: spec.providerRoute,
      acceptanceCriteria: spec.acceptanceCriteria,
      promotionEligible: Boolean(spec.promotionEligible),
      negativeControlIntent: Boolean(spec.negativeControlIntent),
    };
  });
}

export function buildEvidenceContractCollectionTasks({
  bundle = {},
  contract = buildUniversalEvidenceContract(bundle),
  matrix = [],
  limit = 10,
} = {}) {
  const byClass = new Map(asArray(matrix).map((row) => [row.evidenceClass, row]));
  return asArray(contract.requiredClasses)
    .map((spec) => {
      const state = byClass.get(spec.evidenceClass);
      if (state && ['promotion_eligible', 'direct'].includes(state.status)) return null;
      const query = state?.nextQuery || compileEvidenceClassQuery({
        subject: contract.subject,
        classSpec: spec,
        issuerUniverse: contract.issuerUniverse,
        negativeControl: spec.negativeControlIntent,
      });
      return {
        packName: spec.dataPack || 'evidencePack',
        taskType: 'source_query',
        query,
        reason: `${spec.label} is ${state?.status || 'missing'}; collect ${spec.acceptanceCriteria}.`,
        severity: spec.negativeControlIntent ? 'medium' : 'high',
        priority: spec.negativeControlIntent ? 82 : (spec.issuerSpecific ? 90 : 86),
        collectionPlan: true,
        collectionKind: 'universal_evidence_contract',
        target: {
          evidenceClass: spec.evidenceClass,
          currentStatus: state?.status || 'missing',
          providerRoute: spec.providerRoute,
        },
        requiredFor: spec.negativeControlIntent ? 'negative_control_discipline' : 'evidence_contract_coverage',
        metadata: {
          collectionPlan: true,
          collectionKind: 'universal_evidence_contract',
          desiredEvidenceClass: spec.evidenceClass,
          evidenceClass: spec.evidenceClass,
          providerRoute: spec.providerRoute,
          acceptanceCriteria: spec.acceptanceCriteria,
          promotionEligible: Boolean(spec.promotionEligible),
          negativeControlIntent: Boolean(spec.negativeControlIntent),
          evidenceContract: {
            version: contract.version,
            ontologyKey: contract.ontologyKey,
            desiredEvidenceClass: spec.evidenceClass,
            evidenceClass: spec.evidenceClass,
            providerRoute: spec.providerRoute,
            acceptanceCriteria: spec.acceptanceCriteria,
            promotionEligible: Boolean(spec.promotionEligible),
            negativeControlIntent: Boolean(spec.negativeControlIntent),
          },
        },
      };
    })
    .filter(Boolean)
    .slice(0, limit);
}

export function buildUniversalActionBridge({
  bundle = {},
  contract = buildUniversalEvidenceContract(bundle),
  matrix = [],
  crossThemeActionBridge = null,
} = {}) {
  const crossRows = asArray(crossThemeActionBridge?.rows);
  if (crossRows.length) {
    return {
      version: 'universal-action-bridge-v1',
      source: 'cross_theme_action_bridge',
      rows: crossRows,
      metrics: crossThemeActionBridge.metrics || {},
    };
  }
  const issuerSymbols = asArray(contract.issuerUniverse);
  const issuerRows = issuerSymbols.flatMap((symbol) => asArray(matrix)
    .filter((row) => ['issuer_commentary', 'primary_filing', 'issuer_exposure', 'market_validation'].includes(row.evidenceClass))
    .map((row) => ({
      subject: subjectDisplay(bundle),
      evidenceClass: row.evidenceClass,
      issuer: symbol,
      symbol,
      exposureType: row.evidenceClass === 'market_validation' ? 'market_validation' : 'issuer_evidence',
      supportingEvidenceIds: [],
      requiredValidation: row.status === 'promotion_eligible' || row.status === 'direct'
        ? 'connect issuer-specific evidence to thesis and decision use'
        : row.nextQuery,
      promotionEligible: row.promotionEligibleCount > 0,
    })));
  return {
    version: 'universal-action-bridge-v1',
    source: 'universal_evidence_contract',
    rows: issuerRows,
    metrics: {
      issuerCount: issuerSymbols.length,
      issuerBridgeCount: issuerRows.filter((row) => row.promotionEligible).length,
      missingClasses: asArray(matrix).filter((row) => row.status === 'missing').map((row) => row.evidenceClass),
    },
  };
}
