function compact(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function slugify(value) {
  return compact(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function asArray(value) {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
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

const PROVIDER_ALIASES = Object.freeze({
  'war.gov-contracts': 'dod-contracts',
  'defense.gov': 'dod-contracts',
  'dod-budget-pdf': 'dod-contracts',
  'government-budget': 'dod-contracts',
  'sec-edgar': 'sec',
  'annual-report': 'sec',
  'quarterly-report': 'sec',
  'company-ir': 'sec',
  'company-newsroom': 'source-query',
  'official-company': 'source-query',
  'company-technical-release': 'source-query',
  'official-test-release': 'source-query',
  'official-pdf': 'source-query',
  'trade-press': 'source-query',
  'supply-chain-source': 'source-query',
  'research-source': 'source-query',
  'historical-memory': 'source-query',
  'market-history': 'source-query',
  'source-query-negative-control': 'source-query',
  'fmp-transcripts': 'fmp',
  'fmp-fundamentals': 'fmp',
  'market-quotes': 'polygon',
  'market-returns': 'polygon',
  'local-market-db': 'polygon',
  'utility-filings': 'eia',
  'grid-operator': 'eia',
  ferc: 'public-planning-source',
  'rto-iso': 'public-planning-source',
  'interconnection-queue': 'public-planning-source',
  'public-planning-source': 'public-planning-source',
  'policy-source': 'source-query',
});

function canonicalProvider(provider = '') {
  const raw = compact(provider).toLowerCase();
  return PROVIDER_ALIASES[raw] || raw;
}

function capability(classes = [], maxEvidenceUse = 'supporting_context', options = {}) {
  return {
    classes: classes.map(slugify),
    maxEvidenceUse,
    tiers: unique([maxEvidenceUse, ...asArray(options.tiers)]),
    promotionRequiresPlaybook: Boolean(options.promotionRequiresPlaybook),
    notes: options.notes || null,
  };
}

export const COLLECTOR_CAPABILITY_MATRIX = Object.freeze({
  'dod-contracts': [
    capability(['procurement_trigger', 'policy_funding', 'mission_award'], 'promotion_candidate', {
      notes: 'Official DoD/War.gov contract, award, funding, and budget lanes.',
    }),
    capability(['supplier_capacity', 'propulsion_constraint', 'substitution_limit', 'mechanism_validation', 'technical_qualification'], 'supporting_context', {
      notes: 'Can support operating constraints when the award/budget row contains capacity or qualification details.',
    }),
    capability(['issuer_exposure', 'issuer_commentary'], 'supporting_context'),
  ],
  usaspending: [
    capability(['procurement_trigger', 'policy_funding', 'mission_award'], 'promotion_candidate', {
      notes: 'Official USAspending award/obligation lane.',
    }),
    capability(['issuer_exposure', 'supplier_capacity', 'propulsion_constraint', 'substitution_limit', 'mechanism_validation'], 'supporting_context'),
  ],
  sec: [
    capability(['issuer_commentary', 'primary_filing', 'issuer_exposure', 'capex_confirmation', 'cloud_revenue', 'budget_signal', 'vendor_exposure', 'pipeline_exposure'], 'promotion_candidate', {
      notes: 'Issuer filing and company IR lane.',
    }),
    capability(['supplier_capacity', 'substitution_limit', 'propulsion_constraint', 'power_constraint', 'technical_qualification'], 'promotion_candidate', {
      promotionRequiresPlaybook: true,
      notes: 'Promotion requires class-specific facts in filings or official company disclosures.',
    }),
    capability(['operating_kpi', 'mechanism_validation', 'capacity_addition', 'commodity_input', 'launch_manifest', 'satellite_backlog', 'technology_maturity', 'developer_ecosystem'], 'supporting_context'),
  ],
  fmp: [
    capability(['issuer_commentary', 'issuer_exposure', 'capex_confirmation', 'cloud_revenue', 'operating_kpi'], 'promotion_candidate', {
      promotionRequiresPlaybook: true,
    }),
    capability(['market_validation', 'supplier_capacity', 'compute_demand', 'data_center_utilization', 'accelerator_orders', 'wafer_capacity', 'advanced_packaging', 'memory_bandwidth', 'node_transition', 'capacity_addition', 'launch_manifest', 'satellite_backlog', 'developer_ecosystem'], 'supporting_context'),
  ],
  polygon: [
    capability(['market_validation'], 'promotion_candidate', {
      notes: 'Local controlled market validation lane uses market quotes/returns.',
    }),
  ],
  eia: [
    capability(['power_constraint', 'grid_interconnection', 'commodity_input'], 'promotion_candidate', {
      notes: 'Energy and electricity data lane.',
    }),
  ],
  'public-planning-source': [
    capability(['grid_interconnection', 'power_constraint', 'mechanism_validation', 'supplier_capacity', 'substitution_limit', 'policy_funding', 'operating_kpi', 'technical_qualification'], 'promotion_candidate', {
      promotionRequiresPlaybook: true,
      notes: 'Official/public planning, FERC, RTO/ISO, utility, and national-lab planning evidence lane.',
    }),
    capability(['permitting_regulatory', 'engineering_process', 'test_facility_capacity'], 'promotion_candidate', {
      promotionRequiresPlaybook: true,
      notes: 'Public planning and utility filings can validate permitting, process, and facility queue constraints.',
    }),
  ],
  fred: [
    capability(['operating_kpi', 'market_validation', 'commodity_input', 'material_input', 'capacity_addition'], 'supporting_context'),
  ],
  'source-query': [
    capability(['negative_control'], 'negative_control_candidate', {
      notes: 'Negative-control lane is never promotion-eligible.',
    }),
    capability([
      'supplier_capacity',
      'technical_qualification',
      'substitution_limit',
      'propulsion_constraint',
      'historical_analog',
      'procurement_trigger',
      'policy_funding',
      'mission_award',
      'issuer_commentary',
      'primary_filing',
      'issuer_exposure',
      'power_constraint',
      'market_validation',
      'mechanism_validation',
      'compute_demand',
      'data_center_utilization',
      'cloud_revenue',
      'accelerator_orders',
      'trial_readout',
      'regulatory_milestone',
      'pipeline_exposure',
      'wafer_capacity',
      'advanced_packaging',
      'memory_bandwidth',
      'node_transition',
      'grid_interconnection',
      'capacity_addition',
      'commodity_input',
      'launch_manifest',
      'satellite_backlog',
      'breach_driver',
      'budget_signal',
      'vendor_exposure',
      'regulatory_security_requirement',
      'technology_maturity',
      'developer_ecosystem',
      'operating_kpi',
      'primary_filing',
      'permitting_regulatory',
      'material_input',
      'engineering_process',
      'test_facility_capacity',
      'provider_data_gap',
    ], 'promotion_candidate', {
      promotionRequiresPlaybook: true,
      notes: 'Source-query is primarily context/specialist discovery; promotion requires playbook facts and an acceptable source boundary.',
    }),
  ],
});

function findCapability(provider = '', evidenceClass = '') {
  const canonical = canonicalProvider(provider);
  const cls = slugify(evidenceClass);
  const rows = asArray(COLLECTOR_CAPABILITY_MATRIX[canonical]);
  return rows.find((row) => row.classes.includes(cls)) || null;
}

export function collectorCapability(provider = '', evidenceClass = '') {
  const canonical = canonicalProvider(provider);
  const cls = slugify(evidenceClass);
  const match = findCapability(canonical, cls);
  if (!match) {
    return {
      collector: canonical || compact(provider),
      requestedProvider: provider || null,
      evidenceClass: cls,
      supported: false,
      maxEvidenceUse: null,
      tiers: [],
      promotionRequiresPlaybook: true,
      closureReason: 'collector_not_available',
      notes: null,
    };
  }
  return {
    collector: canonical,
    requestedProvider: provider || canonical,
    evidenceClass: cls,
    supported: true,
    maxEvidenceUse: match.maxEvidenceUse,
    tiers: match.tiers,
    promotionRequiresPlaybook: Boolean(match.promotionRequiresPlaybook),
    closureReason: null,
    notes: match.notes,
  };
}

export function collectorCapabilitiesForEvidenceClass(evidenceClass = '') {
  const cls = slugify(evidenceClass);
  return Object.keys(COLLECTOR_CAPABILITY_MATRIX)
    .map((provider) => collectorCapability(provider, cls))
    .filter((item) => item.supported);
}

export function routeCollectorCapabilities({ evidenceClass = '', collectors = [] } = {}) {
  return asArray(collectors).map((collector) => collectorCapability(collector, evidenceClass));
}

export function maxEvidenceUseForCollector(provider = '', evidenceClass = '') {
  return collectorCapability(provider, evidenceClass).maxEvidenceUse;
}

export function collectorCanPromote(provider = '', evidenceClass = '') {
  return collectorCapability(provider, evidenceClass).maxEvidenceUse === 'promotion_candidate';
}

export const __test = {
  PROVIDER_ALIASES,
  canonicalProvider,
};
