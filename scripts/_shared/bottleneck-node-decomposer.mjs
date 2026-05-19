function compactText(value, max = 320) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (value === null || value === undefined || value === '') return [];
  return [value];
}

function uniqueStrings(values = [], limit = 80) {
  const seen = new Set();
  const out = [];
  for (const value of values.flatMap(asArray)) {
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

function matchesAny(text = '', patterns = []) {
  return patterns.some((pattern) => pattern.test(text));
}

const CONCRETE_NODE_ARCHETYPES = [
  {
    key: 'permitting_queue',
    cues: [/\bpermit|permitting|approval|siting|interconnection queue|subsidy\b/i],
    node: 'permit queue processing capacity',
    nodeType: 'permitting_process',
    evidenceClasses: ['policy_funding', 'supplier_capacity', 'substitution_limit'],
    acceptanceCriteria: [
      'permit or approval queue count',
      'median approval or study cycle time',
      'agency, utility, or consultant capacity evidence',
    ],
  },
  {
    key: 'interconnection_study_capacity',
    cues: [/\b(interconnection|grid|utility|substation|transmission|power)\b/i],
    node: 'interconnection study capacity',
    nodeType: 'engineering_process',
    evidenceClasses: ['grid_interconnection', 'power_constraint', 'supplier_capacity'],
    acceptanceCriteria: [
      'study backlog or queue duration',
      'utility/RTO/ISO planning document',
      'issuer exposure to interconnection engineering or grid-study work',
    ],
  },
  {
    key: 'qualification_test_capacity',
    cues: [/\b(qualification|qualified|certification|certified|test|testing|test facility|test range)\b/i],
    node: 'qualification test facility capacity',
    nodeType: 'test_or_certification_process',
    evidenceClasses: ['technical_qualification', 'substitution_limit', 'supplier_capacity'],
    acceptanceCriteria: [
      'test facility utilization or waiting-time evidence',
      'qualification lead-time evidence',
      'approved supplier or certification dependency',
    ],
  },
  {
    key: 'approved_supplier_onboarding',
    cues: [/\b(sole[-\s]?source|single[-\s]?source|approved supplier|qualified supplier|hard to substitute|substitution)\b/i],
    node: 'approved-supplier qualification lead time',
    nodeType: 'supplier_qualification',
    evidenceClasses: ['substitution_limit', 'technical_qualification', 'supplier_capacity'],
    acceptanceCriteria: [
      'qualified or approved supplier count',
      'supplier onboarding or qualification lead time',
      'sole/single-source or substitution barrier evidence',
    ],
  },
  {
    key: 'service_upgrade_queue',
    cues: [/\b(data center|campus|load growth|utility service|service upgrade|MW|megawatt)\b/i],
    node: 'utility service-upgrade queue',
    nodeType: 'utility_process',
    evidenceClasses: ['power_constraint', 'grid_interconnection', 'supplier_capacity'],
    acceptanceCriteria: [
      'service-upgrade queue or energization timing',
      'utility capex or planning evidence',
      'customer load request or data-center demand evidence',
    ],
  },
  {
    key: 'substation_equipment_lead_time',
    cues: [/\b(substation|switchgear|transformer|breaker|relay|protection|cable)\b/i],
    node: 'substation equipment lead time',
    nodeType: 'physical_equipment',
    evidenceClasses: ['supplier_capacity', 'power_constraint', 'substitution_limit'],
    acceptanceCriteria: [
      'equipment lead-time or backlog evidence',
      'supplier capacity or allocation evidence',
      'utility/project delay tied to the equipment node',
    ],
  },
  {
    key: 'range_or_ground_support_capacity',
    cues: [/\b(space|launch|launch range|test range|range support|mission support|ground system|propellant|fueling|spaceport|storage tank)\b/i],
    node: 'launch range or ground-support scheduling capacity',
    nodeType: 'operations_process',
    evidenceClasses: ['launch_manifest', 'mission_award', 'supplier_capacity'],
    acceptanceCriteria: [
      'range, ground-system, or mission-support contract evidence',
      'launch schedule bottleneck or manifest delay evidence',
      'issuer exposure to ground-support operations',
    ],
  },
  {
    key: 'input_material_availability',
    cues: [/\b(material|feedstock|chemical|gas|fluid|steel|copper|substrate|wafer|component|parts?)\b/i],
    node: 'input material availability',
    nodeType: 'input_material',
    evidenceClasses: ['supplier_capacity', 'commodity_input', 'substitution_limit'],
    acceptanceCriteria: [
      'input material supply/demand or capacity evidence',
      'supplier concentration or substitution evidence',
      'issuer cost, backlog, or margin exposure to the input',
    ],
  },
  {
    key: 'semiconductor_fab_capacity',
    cues: [/\b(wafer|fab|foundry|euv|advanced packaging|hbm|interposer|substrate|photoresist|cmp|lithography)\b/i],
    node: 'wafer fab or advanced-packaging capacity',
    nodeType: 'physical_equipment',
    evidenceClasses: ['supplier_capacity', 'technical_qualification', 'substitution_limit'],
    acceptanceCriteria: [
      'wafer-fab utilization, packaging backlog, or tool delivery lead time',
      'qualified supplier or substitution barrier evidence',
      'issuer exposure to fab tools, packaging, or substrate supply',
    ],
  },
  {
    key: 'biotech_manufacturing_capacity',
    cues: [/\b(gmp|fill[-\s]?finish|drug substance|drug product|biologics manufacturing|cell therapy|gene therapy|cdmo|fda inspection)\b/i],
    node: 'GMP biologics manufacturing capacity',
    nodeType: 'regulated_production_process',
    evidenceClasses: ['supplier_capacity', 'technical_qualification', 'policy_funding'],
    acceptanceCriteria: [
      'GMP facility utilization, fill-finish slot, or CDMO lead time',
      'regulatory approval or qualified-supplier dependency evidence',
      'issuer exposure to biologics or cell/gene-therapy manufacturing capacity',
    ],
  },
  {
    key: 'clinical_trial_site_capacity',
    cues: [/\b(clinical trial|trial site|patient enrollment|recruiting|principal investigator|cro)\b/i],
    node: 'clinical trial site or enrollment capacity',
    nodeType: 'clinical_process',
    evidenceClasses: ['supplier_capacity', 'policy_funding', 'historical_analog'],
    acceptanceCriteria: [
      'trial site backlog, enrollment lead time, or CRO capacity evidence',
      'historical enrollment or completion benchmark',
      'issuer exposure to clinical-trial throughput or site network',
    ],
  },
  {
    key: 'incident_response_capacity',
    cues: [/\b(incident response|breach response|forensics?|dfir|threat hunting|soc analyst|response retainer)\b/i],
    node: 'cyber incident-response analyst capacity',
    nodeType: 'specialist_service',
    evidenceClasses: ['supplier_capacity', 'substitution_limit', 'technical_qualification'],
    acceptanceCriteria: [
      'incident-response staffing, retainer backlog, or response-time evidence',
      'qualified analyst or vendor substitution constraint',
      'issuer exposure to DFIR, MSSP, or incident-retainer revenue',
    ],
  },
  {
    key: 'munitions_production_capacity',
    cues: [/\b(munitions?|ammunition|artillery shell|solid rocket motor|interceptor production|missile production|propellant supply|warhead)\b/i],
    node: 'munitions or propulsion production capacity',
    nodeType: 'physical_equipment',
    evidenceClasses: ['mission_award', 'policy_funding', 'supplier_capacity'],
    acceptanceCriteria: [
      'production-rate, backlog, or expansion-funding evidence',
      'sole-source or qualified-supplier dependency',
      'issuer exposure to munitions, propulsion, or specialty energetics',
    ],
  },
];

const SOURCE_DERIVED_FRONTIER_NODES = [
  {
    key: 'protection_relay_lead_time',
    cues: [/\b(protection relay|relay settings?|protective relay)\b/i],
    node: 'substation protection relay qualification lead time',
    nodeType: 'protection_control_system',
    evidenceClasses: ['technical_qualification', 'power_constraint', 'substitution_limit'],
    acceptanceCriteria: [
      'relay qualification or settings approval lead time',
      'utility/RTO/ISO interconnection study dependency',
      'issuer exposure to protection-control equipment or engineering work',
    ],
  },
  {
    key: 'substation_automation_integration',
    cues: [/\b(substation automation|automation integration|scada integration|control system integration)\b/i],
    node: 'substation automation integration capacity',
    nodeType: 'protection_control_system',
    evidenceClasses: ['technical_qualification', 'supplier_capacity', 'power_constraint'],
    acceptanceCriteria: [
      'automation integration backlog or certification evidence',
      'qualified engineer or installer availability',
      'project delay tied to control-system integration',
    ],
  },
  {
    key: 'interconnection_study_specialist_capacity',
    cues: [/\b(interconnection stud(y|ies)|grid stud(y|ies)|system impact stud(y|ies)|facilities stud(y|ies))\b/i],
    node: 'interconnection study specialist capacity',
    nodeType: 'engineering_process',
    evidenceClasses: ['grid_interconnection', 'power_constraint', 'supplier_capacity'],
    acceptanceCriteria: [
      'study backlog, restudy rate, or queue duration',
      'RTO/ISO/utility planning or tariff evidence',
      'issuer exposure to grid-study, power-engineering, or consulting work',
    ],
  },
  {
    key: 'switchgear_testing_capacity',
    cues: [/\b(switchgear|breaker|circuit breaker)\b/i],
    node: 'switchgear testing and delivery capacity',
    nodeType: 'physical_equipment',
    evidenceClasses: ['supplier_capacity', 'technical_qualification', 'substitution_limit'],
    acceptanceCriteria: [
      'switchgear lead-time, backlog, or test-slot evidence',
      'approved supplier or qualification evidence',
      'issuer backlog, pricing, or delivery-timing exposure',
    ],
  },
  {
    key: 'transformer_input_material',
    cues: [/\b(transformer insulation|electrical steel|grain[-\s]?oriented steel|insulating oil|dielectric fluid)\b/i],
    node: 'transformer input material availability',
    nodeType: 'input_material',
    evidenceClasses: ['supplier_capacity', 'commodity_input', 'substitution_limit'],
    acceptanceCriteria: [
      'input-material supply, lead-time, or allocation evidence',
      'supplier concentration or substitution barrier evidence',
      'issuer margin, backlog, or production exposure to the input',
    ],
  },
  {
    key: 'permit_queue_processing_capacity',
    cues: [/\b(permit queue|permitting staff|permit processing|siting approval|environmental review)\b/i],
    node: 'permit queue processing capacity',
    nodeType: 'permitting_process',
    evidenceClasses: ['policy_funding', 'supplier_capacity', 'substitution_limit'],
    acceptanceCriteria: [
      'permit queue count or median processing time',
      'agency, utility, or consultant staffing capacity evidence',
      'issuer project timing or revenue recognition exposure',
    ],
  },
  {
    key: 'fuel_farm_throughput',
    cues: [/\b(fuel farm|propellant farm|launch fuel farm)\b/i],
    node: 'launch fuel farm throughput',
    nodeType: 'operations_process',
    evidenceClasses: ['supplier_capacity', 'launch_manifest', 'technical_qualification'],
    acceptanceCriteria: [
      'fuel-farm throughput, storage, or turnaround evidence',
      'launch manifest or cadence dependency',
      'issuer exposure to fueling infrastructure or operations',
    ],
  },
  {
    key: 'propellant_loading_infrastructure',
    cues: [/\b(propellant loading|loading equipment|loading infrastructure|propellant transfer)\b/i],
    node: 'propellant loading infrastructure qualification',
    nodeType: 'test_or_certification_process',
    evidenceClasses: ['technical_qualification', 'supplier_capacity', 'substitution_limit'],
    acceptanceCriteria: [
      'loading equipment qualification or test evidence',
      'approved supplier or operations dependency',
      'launch cadence or mission delay tied to loading infrastructure',
    ],
  },
  {
    key: 'storage_tank_availability',
    cues: [/\b(storage tank|cryogenic tank|pressure vessel|tank availability)\b/i],
    node: 'specialized storage tank availability',
    nodeType: 'physical_equipment',
    evidenceClasses: ['supplier_capacity', 'technical_qualification', 'substitution_limit'],
    acceptanceCriteria: [
      'storage-tank capacity, delivery, or qualification evidence',
      'supplier concentration or approved-source evidence',
      'issuer exposure to storage, fueling, or launch infrastructure',
    ],
  },
  {
    key: 'ground_support_scheduling',
    cues: [/\b(ground support scheduling|mission support staffing|range support|ground support operations)\b/i],
    node: 'ground support scheduling capacity',
    nodeType: 'operations_process',
    evidenceClasses: ['mission_award', 'launch_manifest', 'supplier_capacity'],
    acceptanceCriteria: [
      'mission-support task order or staffing evidence',
      'range or launch-window schedule bottleneck evidence',
      'issuer exposure to ground-support operations',
    ],
  },
  {
    key: 'specialist_labor_queue',
    cues: [/\b(specialist labor|qualified technicians?|certified technicians?|engineering staffing|installer shortage)\b/i],
    node: 'specialist labor or service queue',
    nodeType: 'specialist_labor',
    evidenceClasses: ['supplier_capacity', 'technical_qualification', 'substitution_limit'],
    acceptanceCriteria: [
      'qualified labor, technician, or engineering backlog evidence',
      'certification or training lead-time evidence',
      'issuer revenue, backlog, or project timing exposure',
    ],
  },
  {
    key: 'maintenance_replacement_cycle',
    cues: [/\b(replacement cycle|maintenance interval|field failure|spare parts?|service backlog)\b/i],
    node: 'maintenance and replacement cycle capacity',
    nodeType: 'maintenance_process',
    evidenceClasses: ['supplier_capacity', 'historical_analog', 'substitution_limit'],
    acceptanceCriteria: [
      'replacement-cycle, field-failure, or maintenance-interval evidence',
      'spare-part or service capacity evidence',
      'issuer aftermarket, service, or margin exposure',
    ],
  },
  {
    key: 'insurance_risk_transfer_capacity',
    cues: [/\b(insurance|warranty|risk transfer|coverage limit|claims severity|underwriting capacity)\b/i],
    node: 'insurance or warranty risk-transfer capacity',
    nodeType: 'financial_risk_process',
    evidenceClasses: ['negative_control', 'market_validation', 'issuer_exposure'],
    acceptanceCriteria: [
      'coverage limit, warranty reserve, or claims severity evidence',
      'pricing or underwriting capacity evidence',
      'issuer exposure to risk-transfer economics',
    ],
  },
];

function nodeScore(node = {}, text = '') {
  const accepted = asArray(node.acceptanceCriteria).length;
  let score = 0.45 + Math.min(0.25, accepted * 0.04);
  if (/\b(lead[-\s]?time|queue|backlog|qualified|approved supplier|sole[-\s]?source|single[-\s]?source|test facility|permitting)\b/i.test(text)) score += 0.16;
  if (/\b(price|pricing|margin|capacity allocation|revenue recognition|guidance)\b/i.test(text)) score += 0.08;
  if (node.key === 'substation_equipment_lead_time' && /\b(transformer|switchgear|breaker|relay|substation|cable)\b/i.test(text)) score += 0.12;
  if (node.key === 'input_material_availability' && /\b(material|feedstock|steel|copper|gas|fluid|substrate|wafer)\b/i.test(text)) score += 0.1;
  if (node.key === 'range_or_ground_support_capacity' && /\b(launch|range|mission support|ground support)\b/i.test(text)) score += 0.1;
  if (node.sourceDerived || node.frontierNode) score += 0.14;
  return Math.max(0, Math.min(1, score));
}

function buildNodeResult(node = {}, {
  phrase = '',
  sourceTerms = [],
  classSet = new Set(),
  text = '',
  sourceDerived = false,
} = {}) {
  const nodeEvidenceClasses = uniqueStrings([
    ...asArray(node.evidenceClasses),
    ...[...classSet].filter((klass) => asArray(node.evidenceClasses).includes(klass)),
  ], 8);
  return {
    key: node.key,
    node: node.node,
    nodeType: node.nodeType,
    status: 'probe_needs_evidence',
    evidenceClasses: nodeEvidenceClasses,
    acceptanceCriteria: node.acceptanceCriteria,
    sourceTerms: uniqueStrings([phrase, ...asArray(sourceTerms)].filter(Boolean), 8),
    queryVariants: uniqueStrings([
      `${node.node} lead time backlog qualification official evidence`,
      `${node.node} supplier concentration filing contract`,
      `${node.node} pricing power margin backlog capacity allocation`,
    ], 4),
    sourceDerived: Boolean(sourceDerived),
    frontierNode: Boolean(sourceDerived),
    score: nodeScore({ ...node, sourceDerived }, text),
  };
}

export function deriveConcreteBottleneckNodes({
  phrase = '',
  sourceTerms = [],
  context = {},
  evidenceClasses = [],
  limit = 5,
} = {}) {
  const text = compactText([
    phrase,
    ...asArray(sourceTerms),
    context.parentSubject,
    context.ontologyKey,
    ...asArray(context.themes),
    ...asArray(context.triggerTerms),
    compactText(context.corpus || '', 1600),
  ].join(' '), 5000);
  if (!text) return [];
  const classSet = new Set(uniqueStrings(evidenceClasses, 40));
  const nodes = [];
  for (const patternNode of SOURCE_DERIVED_FRONTIER_NODES) {
    if (!matchesAny(text, patternNode.cues)) continue;
    nodes.push(buildNodeResult(patternNode, {
      phrase,
      sourceTerms,
      classSet,
      text,
      sourceDerived: true,
    }));
  }
  for (const archetype of CONCRETE_NODE_ARCHETYPES) {
    if (!matchesAny(text, archetype.cues)) continue;
    if (nodes.some((node) => node.key === archetype.key || node.node === archetype.node)) continue;
    nodes.push(buildNodeResult(archetype, {
      phrase,
      sourceTerms,
      classSet,
      text,
      sourceDerived: false,
    }));
  }
  return nodes
    .sort((left, right) => (
      Number(right.sourceDerived) - Number(left.sourceDerived)
      || right.score - left.score
      || left.node.localeCompare(right.node)
    ))
    .slice(0, Math.max(1, Math.min(12, Number(limit) || 5)));
}

export function summarizeConcreteBottleneckNodes(nodes = []) {
  const list = asArray(nodes).filter(Boolean);
  return {
    count: list.length,
    topNodes: list.slice(0, 5).map((node) => node.node),
    evidenceClasses: uniqueStrings(list.flatMap((node) => node.evidenceClasses || []), 12),
    queryVariants: uniqueStrings(list.flatMap((node) => node.queryVariants || []), 12),
  };
}
