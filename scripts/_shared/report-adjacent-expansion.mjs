import path from 'node:path';
import { existsSync } from 'node:fs';
import { readdir, readFile, stat } from 'node:fs/promises';
import {
  buildDynamicConsensusProfile,
  classifyNonObviousFrontierStatus,
  scoreNonObviousBottleneckDiscovery,
  summarizeNonObviousScores,
} from './non-obvious-bottleneck-discovery.mjs';
import {
  deriveConcreteBottleneckNodes,
  summarizeConcreteBottleneckNodes,
} from './bottleneck-node-decomposer.mjs';
import {
  evaluateParentCandidateReadiness,
  parentBackfillQueriesForReadiness,
  parentEvidenceSummaryFromReportArtifact,
  parentReadinessMetadata,
} from './parent-candidate-readiness.mjs';
import { routeEvidenceProvider } from './evidence-provider-router.mjs';

export const ADJACENT_THEME_STATUSES = [
  'candidate',
  'frontier_candidate',
  'needs_evidence',
  'needs_scarcity_evidence',
  'provider_collecting',
  'needs_parent_evidence',
  'ready_for_deep_report',
  'non_obvious_bottleneck_ready',
  'consensus_suppressed',
  'review_ready',
  'search_exhausted_not_validated',
  'rejected',
  'needs_fix',
];

export const ADJACENT_REPORT_READY_STATUSES = [
  'ready_for_deep_report',
  'non_obvious_bottleneck_ready',
  'review_ready',
];

export const ADJACENT_FRONTIER_REPORT_STATUSES = [
  ...ADJACENT_REPORT_READY_STATUSES,
  'needs_scarcity_evidence',
  'frontier_candidate',
];

export const ADJACENT_FAILURE_REASONS = [
  'vocabulary_gap',
  'source_coverage_gap',
  'graph_edge_gap',
  'issuer_mapping_gap',
  'provider_route_gap',
  'scheduler_selection_gap',
  'consensus_suppressed',
  'seed_contamination_holdout',
  'direct_evidence_required',
  'market_validation_missing',
  'parent_readiness_gap',
];

const REPORT_SCAN_MAX_JSON_BYTES = 2_500_000;
const READY_CONFIDENCE_THRESHOLD = 70;

const OPEN_CLASS_NAMES = new Set([
  'supplier_capacity',
  'propulsion_constraint',
  'launch_manifest',
  'mission_award',
  'substitution_limit',
  'technical_qualification',
  'procurement_trigger',
  'policy_funding',
]);

const DOMAIN_HINTS = {
  space: [
    'space',
    'launch',
    'orbital',
    'rocket',
    'spaceport',
    'satellite',
    'mission',
    'range',
  ],
  defense: [
    'defense',
    'missile',
    'interceptor',
    'munition',
    'dod',
    'army',
    'navy',
    'air force',
  ],
  ai_data_center: [
    'ai',
    'data center',
    'compute',
    'gpu',
    'cloud',
  ],
  semiconductor: [
    'semiconductor',
    'fab',
    'wafer',
    'tooling',
    'packaging',
    'foundry',
  ],
  clean_energy: [
    'battery',
    'lithium',
    'hydrogen',
    'electrolyzer',
    'grid',
    'renewable',
  ],
  cybersecurity: [
    'cyber',
    'ransomware',
    'security operations',
    'identity',
    'vulnerability',
  ],
  industrial_materials: [
    'industrial gas',
    'specialty gas',
    'oxygen',
    'hydrogen',
    'helium',
    'propellant',
    'storage tank',
    'fuel farm',
    'materials',
    'chemical',
    'steel',
    'copper',
    'alloy',
    'feedstock',
    'fluid',
  ],
  insurance_finance: [
    'insurance',
    'reinsurance',
    'warranty',
    'financial risk',
    'credit',
  ],
  aviation_transport: [
    'aviation',
    'airline',
    'travel',
    'logistics',
    'transport',
  ],
  healthcare: [
    'health',
    'biotech',
    'pharma',
    'glp-1',
    'medical',
  ],
  nuclear: [
    'nuclear',
    'reactor',
    'smr',
    'uranium',
    'forging',
    'turbine',
  ],
};

export const STRICT_ENDOGENOUS_HOLDOUT_TERMS = Object.freeze([
  'cryogenic',
  'lox',
  'liquid oxygen',
  'helium',
  'linde',
  'amtm',
  'amentum',
  'range operations',
  'ground systems',
  'data center power',
  'liquid cooling',
]);

export const STRICT_ENDOGENOUS_NAMESPACE = 'strict_endogenous_adjacent';
export const STRICT_ENDOGENOUS_DISCOVERY_VERSION = 3;
const NON_ISSUER_SYMBOL_TOKENS = new Set([
  'AI',
  'ML',
  'GPU',
  'CPU',
  'ASIC',
  'MW',
  'KPI',
  'SEC',
  'FMP',
  'EIA',
  'API',
]);

const ENDOGENOUS_GENERIC_CUE_RE = /\b(requires?|depends?\s+on|depends_on|dependent\s+on|relies?\s+on|constrained\s+by|constrained_by|limited\s+by|limited_by|linked\s+to|linked_to|bottlenecks?\s+by|bottlenecked\s+by|needs?|shortage\s+of|lack\s+of|capacity|supplier|material|process|infrastructure|qualification|substitution|constraint|availability|throughput|lead\s+time|backlog|contract|award|operations?|support)\b/i;
const ENDOGENOUS_RELATION_RE = /\b(requires?|depends?\s+on|depends_on|dependent\s+on|relies?\s+on|constrained\s+by|constrained_by|limited\s+by|limited_by|linked\s+to|linked_to|bottlenecks?\s+by|bottlenecked\s+by|needs?|shortage\s+of|lack\s+of)\b/i;
const ENDOGENOUS_STOPWORDS = new Set([
  'about', 'after', 'again', 'against', 'also', 'among', 'and', 'are', 'because',
  'be', 'been', 'before', 'between', 'but', 'can', 'could', 'from', 'has', 'have',
  'by', 'for', 'into', 'its', 'more', 'new', 'not', 'on', 'or', 'over', 'said', 'such', 'that',
  'the', 'their', 'then', 'there', 'these', 'this', 'through', 'to', 'under', 'using',
  'was', 'were', 'when', 'where', 'which', 'while', 'who', 'would', 'with',
  'without', 'will', 'may', 'might', 'should', 'still', 'report', 'candidate', 'theme',
  'constrained', 'constrainted', 'depend', 'depends', 'dependent', 'linked', 'limited', 'relies',
  'require', 'requires', 'need', 'needs', 'evid', 'edge', 'knowledge', 'graph', 'fresh',
  'analyst', 'analysis', 'validation', 'validated', 'thesis', 'memo', 'visible',
  'cite', 'cites', 'cited', 'provider', 'providers', 'team', 'teams', 'operator',
  'operators', 'project', 'projects', 'campus', 'campuses', 'hall', 'halls', 'open',
  'clearance', 'increase', 'action', 'bridge', 'nbsp', 'link', 'filing',
]);
const ENDOGENOUS_GENERIC_ONLY_TERMS = new Set([
  'capacity', 'supplier', 'suppliers', 'material', 'materials', 'process',
  'processes', 'infrastructure', 'qualification', 'substitution', 'constraint',
  'constraints', 'availability', 'throughput', 'contract', 'award', 'operations',
  'support', 'system', 'systems', 'pressure', 'utilization', 'orders', 'order',
  'adoption', 'deployment', 'demand', 'supply', 'capex', 'customer', 'customers',
  'earnings', 'pricing', 'visibility', 'allocation', 'company', 'component',
  'components', 'chokepoint', 'substitute', 'qualified', 'real', 'affects',
  'hard', 'guidance', 'backlog',
]);
const ENDOGENOUS_CONCRETE_NODE_RE = /\b(relay|breaker|switchgear|transformer|insulation|dielectric|coolant|fluid|pump|heat exchanger|sensor|valve|cable|connector|substation|automation|control system|protection|study|consultant|permitting|permit|inspection|maintenance|test facility|test range|range support|fuel farm|storage tank|propellant|feedstock|substrate|photoresist|wafer|interposer|inverter|compressor|turbine|forging|warranty|insurance|steel|copper|gas|oxygen|hydrogen|helium|water rights|interconnection study)\b/i;
const ENDOGENOUS_NOISE_RE = /\b(model|models|benchmark|benchmarks|dataset|datasets|accuracy|metric|metrics|paper|papers|study|studies|learning|training|simulation|framework|algorithm|algorithms|software|platform|newsletter|podcast|subscribe|macro|inflation|gdp)\b/i;
const ENDOGENOUS_INTERNAL_NOISE_RE = /\b(playbook|evidence contract|universal[- ]evidence[- ]contract|queued to backfill|backfill|acceptance failed|search exhausted|strict subject filter|no cross theme bottleneck|mechanism transmission path|issuer exposure segment revenue|issuer-specific evidence|client memo|audit appendix|promotion requires|acceptable source boundary|source boundary|source breadth|still needs|research burden|follow-on tracking|report should|economic mechanism|infrastructure economics|alignment across evidence|upgrade case|segment revenue|multiple expansion|downside-risk|valuation|margin|attribution analyst|analyst validation|knowledge edge|knowledge graph|fresh candidate|matrix|thesis on|book-to-bill|action bridge|cross-theme action bridge|actionability|nbsp|operating kpi action|mechanism validation action|issuer exposure action)\b/i;
const ENDOGENOUS_NEGATIVE_CONTROL_RE = /\b(no capacity constraint|no capacity|no procurement timing pressure|non-qualified supplier invalidator|non-qualified supplier|easy substitutes?|supplier redundancy|no direct invalidator|negative control)\b/i;

export const ADJACENT_LANE_PLAYBOOKS = [
  {
    lane: 'launch_fueling_or_cryogenic_infrastructure',
    label: 'Launch fueling or cryogenic infrastructure',
    domains: ['space'],
    evidenceClasses: ['supplier_capacity', 'propulsion_constraint', 'launch_manifest', 'mission_award', 'technical_qualification'],
    terms: [
      'cryogenic',
      'lox',
      'liquid oxygen',
      'liquid hydrogen',
      'hydrogen',
      'helium',
      'fueling',
      'fuel farm',
      'industrial gas',
      'propellant loading',
      'spaceport',
      'ground support equipment',
    ],
    querySubject: 'space launch fueling cryogenic infrastructure',
    readyTerms: [
      'cryogenic',
      'lox',
      'liquid oxygen',
      'liquid hydrogen',
      'hydrogen',
      'helium',
      'fueling',
      'fuel farm',
      'industrial gas',
      'propellant loading',
    ],
    queryTemplates: [
      '{laneSubject} LOX liquid oxygen liquid hydrogen helium supplier',
      'spaceport cryogenic fuel farm LOX hydrogen helium infrastructure supplier annual report',
      'launch vehicle cryogenic propellant loading ground support official contract filing',
      'launch pad cryogenic storage tank LOX hydrogen helium supplier capacity',
    ],
    nextAction: 'Run class-specific source-query/provider collection for launch fueling, cryogenic gas, and spaceport infrastructure evidence.',
  },
  {
    lane: 'range_operations_or_ground_systems_support',
    label: 'Range operations or ground systems support',
    domains: ['space', 'defense'],
    evidenceClasses: ['launch_manifest', 'mission_award', 'supplier_capacity', 'technical_qualification', 'procurement_trigger'],
    terms: [
      'space launch',
      'launch',
      'range operations',
      'launch range',
      'ground systems',
      'ground support',
      'mission support',
      'range safety',
      'tracking telemetry',
      'spaceport operations',
      'launch operations',
      'test range',
    ],
    querySubject: 'space launch range operations ground systems support',
    queryTemplates: [
      '{laneSubject} contract',
      'launch range safety telemetry mission support provider contract',
      'space launch ground systems support operations official award filing',
    ],
    nextAction: 'Run mission-support and government-contract source-query/provider collection before creating any issuer bridge.',
  },
  {
    lane: 'propulsion_input_materials',
    label: 'Propulsion input materials',
    domains: ['space', 'defense'],
    evidenceClasses: ['supplier_capacity', 'propulsion_constraint', 'substitution_limit', 'technical_qualification', 'procurement_trigger'],
    terms: [
      'propellant',
      'energetic material',
      'oxidizer',
      'binder',
      'motor case',
      'nozzle',
      'source expansion',
      'qualified supplier',
      'test firing',
    ],
    queryTemplates: [
      '{subject} propulsion input materials qualified supplier capacity source expansion',
      '{subject} propellant energetic materials supplier qualification test firing official evidence',
      '{subject} motor case nozzle binder oxidizer production bottleneck contract filing',
    ],
    nextAction: 'Collect official supplier-capacity, qualification, and substitution-limit evidence for propulsion inputs.',
  },
  {
    lane: 'qualification_testing_or_mission_support',
    label: 'Qualification testing or mission support',
    domains: ['space', 'defense', 'semiconductor', 'clean_energy'],
    evidenceClasses: ['technical_qualification', 'substitution_limit', 'propulsion_constraint', 'mission_award', 'supplier_capacity'],
    terms: [
      'qualification',
      'certification',
      'acceptance test',
      'test firing',
      'qualification testing',
      'mission assurance',
      'mission support',
      'technical readiness',
      'flight test',
    ],
    queryTemplates: [
      '{subject} qualification testing certification acceptance test supplier bottleneck official',
      '{subject} mission assurance technical readiness test provider contract',
      '{subject} flight test qualification delay certified supplier evidence',
    ],
    nextAction: 'Collect qualification/test evidence and close whether the bottleneck is technical, timing, or only contextual.',
  },
  {
    lane: 'power_cooling_or_utility_infrastructure',
    label: 'Power, cooling, or utility infrastructure',
    domains: ['ai_data_center'],
    evidenceClasses: ['power_constraint', 'supplier_capacity', 'capex_confirmation', 'technical_qualification'],
    terms: [
      'data center',
      'power constraint',
      'power availability',
      'power capacity',
      'grid',
      'utility interconnect',
      'utility',
      'interconnection',
      'electricity',
      'substation',
      'cooling',
      'water',
      'data center capacity',
      'grid queue',
    ],
    queryTemplates: [
      '{subject} data center power utility interconnection cooling capacity constraint',
      '{subject} AI data center substation water cooling utility filing',
      '{subject} cloud capex power availability grid queue official source',
    ],
    nextAction: 'Route to EIA, utility, policy, company filing, and source-query context lanes for power/cooling constraints.',
  },
  {
    lane: 'fab_capacity_or_tooling',
    label: 'Fab capacity or tooling',
    domains: ['semiconductor'],
    evidenceClasses: ['supplier_capacity', 'technical_qualification', 'substitution_limit', 'capex_confirmation'],
    terms: [
      'fab capacity',
      'wafer starts',
      'tooling',
      'lithography',
      'packaging capacity',
      'foundry',
      'substrate',
    ],
    queryTemplates: [
      '{subject} semiconductor fab capacity wafer starts tooling supplier bottleneck',
      '{subject} advanced packaging substrate qualification supplier capacity official',
      '{subject} foundry capacity capex expansion filing conference call',
    ],
    nextAction: 'Collect fab/tooling capacity evidence and classify promotion only when throughput or qualification facts exist.',
  },
  {
    lane: 'material_supply_or_substitution',
    label: 'Material supply or substitution constraint',
    domains: ['clean_energy', 'semiconductor', 'space', 'defense'],
    evidenceClasses: ['supplier_capacity', 'substitution_limit', 'technical_qualification'],
    terms: [
      'material supply',
      'substitution',
      'qualified supplier',
      'single source',
      'sole source',
      'certification',
      'feedstock',
    ],
    queryTemplates: [
      '{subject} material supply substitution qualified supplier single source official',
      '{subject} feedstock capacity certification supplier constraint filing',
      '{subject} sole source supplier qualification lead time bottleneck evidence',
    ],
    nextAction: 'Run substitution-limit playbook against qualified supplier count, sole-source, and qualification lead-time evidence.',
  },
  {
    lane: 'security_operations_or_incident_response',
    label: 'Security operations or incident response',
    domains: ['cybersecurity'],
    evidenceClasses: ['issuer_exposure', 'issuer_commentary', 'negative_control', 'market_validation'],
    terms: [
      'security operations',
      'incident response',
      'managed detection',
      'identity security',
      'ransomware response',
      'vulnerability management',
    ],
    queryTemplates: [
      '{subject} cybersecurity security operations incident response issuer exposure filing',
      '{subject} managed detection response identity security customer demand transcript',
      '{subject} ransomware incident response negative control demand pressure evidence',
    ],
    nextAction: 'Separate issuer exposure and negative-control lanes before any investment-actionability upgrade.',
  },
];

function compactText(value, max = 320) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function slugify(value) {
  return compactText(value, 240)
    .toLowerCase()
    .replace(/['"]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 180);
}

function normalizeSymbol(value = '') {
  const symbol = String(value || '').trim().toUpperCase();
  return /^[A-Z][A-Z0-9.-]{0,9}$/.test(symbol) ? symbol : '';
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

function escapeRegex(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function containsTerm(haystack, term) {
  const text = String(haystack || '').toLowerCase();
  const needle = String(term || '').toLowerCase().trim();
  if (!needle) return false;
  if (/^[a-z0-9][a-z0-9\s.-]*[a-z0-9]$/i.test(needle)) {
    return new RegExp(`(^|[^a-z0-9])${escapeRegex(needle)}([^a-z0-9]|$)`, 'i').test(text);
  }
  return text.includes(needle);
}

function clamp(value, min, max) {
  const parsed = Number(value);
  const finite = Number.isFinite(parsed) ? parsed : min;
  return Math.max(min, Math.min(max, finite));
}

function collectStrings(value, {
  limit = 260,
  maxDepth = 8,
  maxString = 500,
  includeKeys = false,
} = {}, depth = 0, out = []) {
  if (out.length >= limit || depth > maxDepth || value === null || value === undefined) return out;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    const text = compactText(value, maxString);
    if (text) out.push(text);
    return out;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      collectStrings(item, { limit, maxDepth, maxString, includeKeys }, depth + 1, out);
      if (out.length >= limit) break;
    }
    return out;
  }
  if (typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) {
      if (includeKeys) out.push(key);
      collectStrings(item, { limit, maxDepth, maxString, includeKeys }, depth + 1, out);
      if (out.length >= limit) break;
    }
  }
  return out;
}

function collectTextFragments(value, {
  limit = 260,
  maxDepth = 4,
  maxString = 500,
} = {}, depth = 0, out = []) {
  if (out.length >= limit || depth > maxDepth || value === null || value === undefined) return out;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    const pieces = String(value || '')
      .split(/[\r\n]+|(?<=[.!?])\s+|[;|]+/g)
      .map((piece) => compactText(piece, maxString))
      .filter((piece) => piece.length >= 16);
    for (const piece of pieces) {
      out.push(piece);
      if (out.length >= limit) break;
    }
    return out;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      collectTextFragments(item, { limit, maxDepth, maxString }, depth + 1, out);
      if (out.length >= limit) break;
    }
    return out;
  }
  if (typeof value === 'object') {
    for (const item of Object.values(value)) {
      collectTextFragments(item, { limit, maxDepth, maxString }, depth + 1, out);
      if (out.length >= limit) break;
    }
  }
  return out;
}

function collectValuesForKeys(value, keys = new Set(), depth = 0, out = []) {
  if (!value || depth > 9 || out.length > 400) return out;
  if (Array.isArray(value)) {
    for (const item of value) collectValuesForKeys(item, keys, depth + 1, out);
    return out;
  }
  if (typeof value !== 'object') return out;
  for (const [key, item] of Object.entries(value)) {
    if (keys.has(key) || keys.has(key.toLowerCase())) out.push(item);
    if (item && typeof item === 'object') collectValuesForKeys(item, keys, depth + 1, out);
  }
  return out;
}

function collectEvidenceClasses(artifact = {}) {
  const values = collectValuesForKeys(artifact, new Set([
    'desiredEvidenceClass',
    'desired_evidence_class',
    'evidenceClass',
    'evidence_class',
    'className',
    'class',
  ]));
  return uniqueStrings(values.flatMap(asArray).map((value) => String(value).trim()), 80)
    .map((value) => value.toLowerCase().replace(/[^a-z0-9_]+/g, '_'))
    .filter(Boolean);
}

function collectIssuerUniverse(artifact = {}) {
  const values = collectValuesForKeys(artifact, new Set([
    'issuerUniverse',
    'issuer_universe',
    'issuerUniverseSymbols',
    'issuerHints',
    'symbols',
  ]));
  return uniqueStrings(values.flatMap(asArray).map((value) => String(value).toUpperCase().replace(/[^A-Z0-9.\-]/g, '')), 40)
    .filter((symbol) => /^[A-Z]{1,6}([.-][A-Z])?$/.test(symbol))
    .filter((symbol) => !NON_ISSUER_SYMBOL_TOKENS.has(symbol));
}

function inferDomains(context = {}) {
  const haystack = [
    context.parentSubject,
    context.reportType,
    context.ontologyKey,
    ...(context.themes || []),
    context.corpus,
  ].join(' ').toLowerCase();
  const domains = [];
  for (const [domain, terms] of Object.entries(DOMAIN_HINTS)) {
    if (terms.some((term) => containsTerm(haystack, term))) domains.push(domain);
  }
  if (!domains.length && /defense_industrial/.test(haystack)) domains.push('defense');
  return uniqueStrings(domains, 8);
}

function termHitsForLane(context = {}, lane = {}) {
  const haystack = String(context.corpus || '').toLowerCase();
  return uniqueStrings((lane.terms || []).filter((term) => containsTerm(haystack, term)), 20);
}

function classHitsForLane(context = {}, lane = {}) {
  const classes = new Set((context.evidenceClasses || []).map((value) => String(value).toLowerCase()));
  return uniqueStrings((lane.evidenceClasses || []).filter((klass) => classes.has(String(klass).toLowerCase())), 20);
}

function domainHitsForLane(context = {}, lane = {}) {
  const domains = new Set(context.domains || []);
  return uniqueStrings((lane.domains || []).filter((domain) => domains.has(domain)), 8);
}

function extractSourceTerms(context = {}, lane = {}, termHits = []) {
  const sourceTerms = [
    ...termHits,
    ...context.triggerTerms,
    ...context.watchTerms,
    ...context.queryTerms,
  ];
  const laneTerms = new Set((lane.terms || []).map((term) => String(term).toLowerCase()));
  const adjacentTerms = sourceTerms.filter((term) => {
    const lower = String(term || '').toLowerCase();
    return laneTerms.has(lower) || (lane.terms || []).some((laneTerm) => containsTerm(lower, laneTerm));
  });
  return uniqueStrings(adjacentTerms.length ? adjacentTerms : termHits, 30);
}

function buildLaneQueryVariants(context = {}, lane = {}) {
  const subject = compactText(context.parentSubject || context.parentSubjectKey || 'reported subject', 160);
  const laneSubject = compactText(lane.querySubject || subject, 160);
  const themeText = uniqueStrings([...(context.themes || []), context.ontologyKey].filter(Boolean), 8).join(' ');
  const replacements = {
    '{subject}': subject,
    '{laneSubject}': laneSubject,
    '{themes}': themeText,
  };
  const variants = (lane.queryTemplates || []).map((template) => {
    let text = template;
    for (const [key, value] of Object.entries(replacements)) text = text.replaceAll(key, value);
    return compactText(text.replace(/\s+/g, ' '), 260);
  });
  return uniqueStrings(variants, 12);
}

function inferFailureReason({ termHits = [], classHits = [], domainHits = [], lane = {}, context = {} } = {}) {
  if (!classHits.length && !domainHits.length) return 'vocabulary_gap';
  if (!termHits.length) return 'source_coverage_gap';
  if (!buildLaneQueryVariants(context, lane).length) return 'provider_route_gap';
  return 'graph_edge_gap';
}

function nextActionForFailure(reason, lane = {}) {
  if (reason === 'vocabulary_gap') return 'Extend ontology/lane vocabulary for this domain before retrying adjacent discovery.';
  if (reason === 'source_coverage_gap') return lane.nextAction || 'Create source discovery and source-query actions for this adjacent lane.';
  if (reason === 'issuer_mapping_gap') return 'Collect issuer exposure evidence before adding any issuer to the report universe.';
  if (reason === 'provider_route_gap') return 'Add provider route coverage for this evidence class/lane combination.';
  if (reason === 'scheduler_selection_gap') return 'Raise adjacent candidate priority in the report scheduler when evidence threshold is met.';
  return lane.nextAction || 'Run relation extraction and provider/source-query collection for this adjacent lane.';
}

function evidenceClassForAdjacentQuery(candidate = {}, query = '') {
  const classes = new Set(asArray(candidate.evidenceClasses).map((item) => String(item || '').trim()).filter(Boolean));
  const text = compactText([
    query,
    candidate.lane,
    candidate.label,
    candidate.parentSubject,
  ].join(' '), 1000).toLowerCase();
  if (classes.has('mission_award') && /\b(award|contract|task order|agreement|mission support|launch contract)\b/.test(text)) {
    return 'mission_award';
  }
  if (classes.has('procurement_trigger') && /\b(procurement|contract|award|funding|budget|proposal|solicitation|space force|nasa|dod)\b/.test(text)) {
    return 'procurement_trigger';
  }
  if (classes.has('launch_manifest') && /\b(launch cadence|manifest|launch operations|spaceport|range)\b/.test(text)) {
    return 'launch_manifest';
  }
  if (classes.has('technical_qualification') && /\b(qualification|certification|test|technical|propellant loading|ground support equipment)\b/.test(text)) {
    return 'technical_qualification';
  }
  if (classes.has('propulsion_constraint') && /\b(propellant|cryogenic|lox|liquid oxygen|hydrogen|helium|fueling|fuel farm)\b/.test(text)) {
    return 'propulsion_constraint';
  }
  if (classes.has('supplier_capacity')) return 'supplier_capacity';
  return asArray(candidate.evidenceClasses)[0] || 'adjacent_candidate_evidence';
}

function adjacentSourceProvidersForClass(evidenceClass = '') {
  if (['procurement_trigger', 'policy_funding', 'mission_award'].includes(String(evidenceClass))) {
    return ['government-contracts', 'usaspending', 'dod-contracts', 'official-pdf', 'source-query'];
  }
  if (['technical_qualification', 'substitution_limit', 'propulsion_constraint'].includes(String(evidenceClass))) {
    return ['official-company', 'official-test-release', 'company-technical-release', 'official-pdf', 'research-source', 'source-query'];
  }
  return ['official-company', 'company-ir', 'official-pdf', 'trade-press', 'source-query'];
}

function scoreLane({ termHits = [], classHits = [], domainHits = [], context = {}, lane = {} } = {}) {
  let score = 20;
  score += Math.min(30, termHits.length * 10);
  score += Math.min(25, classHits.length * 8);
  score += Math.min(15, domainHits.length * 10);
  if ((context.queryTerms || []).length) score += 5;
  if ((context.issuerUniverse || []).length) score += 3;
  if ((lane.domains || []).includes('space') && (context.domains || []).includes('space')) score += 5;
  if ((lane.domains || []).includes('defense') && (context.domains || []).includes('defense')) score += 4;
  return clamp(score, 0, 100);
}

function shouldCreateLane(context = {}, lane = {}, hits = {}) {
  if (hits.termHits.length && (!lane.domains?.length || hits.domainHits.length)) return true;
  if (hits.classHits.length && hits.domainHits.length) return true;
  const openClasses = new Set((context.evidenceClasses || []).filter((klass) => OPEN_CLASS_NAMES.has(klass)));
  if (!openClasses.size) return false;
  if ((context.domains || []).includes('space') && ['launch_fueling_or_cryogenic_infrastructure', 'range_operations_or_ground_systems_support'].includes(lane.lane)) {
    return ['supplier_capacity', 'launch_manifest', 'mission_award', 'technical_qualification', 'propulsion_constraint'].some((klass) => openClasses.has(klass));
  }
  if ((context.domains || []).includes('defense') && ['propulsion_input_materials', 'qualification_testing_or_mission_support', 'range_operations_or_ground_systems_support'].includes(lane.lane)) {
    return ['supplier_capacity', 'procurement_trigger', 'technical_qualification', 'substitution_limit', 'propulsion_constraint'].some((klass) => openClasses.has(klass));
  }
  return false;
}

function splitSentences(value = '') {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .split(/(?<=[.!?])\s+|[\r\n]+|[;|]+/g)
    .map((sentence) => compactText(sentence, 520))
    .filter((sentence) => sentence.length >= 24);
}

function tokenizeEndogenous(value = '') {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9/%.-]+/g, ' ')
    .split(/\s+/)
    .map((token) => token.replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, ''))
    .filter((token) => token.length >= 2 && !/^evid[-_]/.test(token) && !ENDOGENOUS_STOPWORDS.has(token));
}

function cleanEndogenousPhrase(value = '') {
  const tokens = tokenizeEndogenous(value)
    .filter((token) => !/^\d+$/.test(token))
    .slice(-7);
  while (tokens.length && ENDOGENOUS_GENERIC_ONLY_TERMS.has(tokens[0])) tokens.shift();
  while (tokens.length && ['requires', 'require', 'depends', 'dependent', 'relies', 'needs', 'need'].includes(tokens[0])) tokens.shift();
  while (tokens.length && ENDOGENOUS_GENERIC_ONLY_TERMS.has(tokens[tokens.length - 1]) && tokens.length > 2) {
    const tail = tokens[tokens.length - 1];
    if (['capacity', 'infrastructure', 'support', 'operations', 'qualification'].includes(tail)) break;
    tokens.pop();
  }
  if (tokens.length < 2 || tokens.length > 7) return '';
  if (tokens.every((token) => ENDOGENOUS_GENERIC_ONLY_TERMS.has(token))) return '';
  const phrase = tokens.join(' ');
  const nonGenericTokens = tokens.filter((token) => !ENDOGENOUS_GENERIC_ONLY_TERMS.has(token));
  if (nonGenericTokens.length <= 1 && !ENDOGENOUS_CONCRETE_NODE_RE.test(phrase)) return '';
  if (ENDOGENOUS_NOISE_RE.test(phrase)) return '';
  if (ENDOGENOUS_INTERNAL_NOISE_RE.test(phrase)) return '';
  if (ENDOGENOUS_NEGATIVE_CONTROL_RE.test(phrase)) return '';
  if (phrase.length < 7 || phrase.length > 120) return '';
  if (/\b(ai-ml|clean-energy|space-economy|defense-industrial|cybersecurity|semiconductor)\b/.test(phrase)) return '';
  return phrase;
}

function phraseNgramsFromSentence(sentence = '') {
  const tokens = tokenizeEndogenous(sentence);
  const phrases = [];
  for (let size = 2; size <= 4; size += 1) {
    for (let index = 0; index <= tokens.length - size; index += 1) {
      const slice = tokens.slice(index, index + size);
      if (slice.every((token) => ENDOGENOUS_GENERIC_ONLY_TERMS.has(token))) continue;
      if (!slice.some((token) => token.length >= 4 || /[0-9]/.test(token))) continue;
      const phrase = cleanEndogenousPhrase(slice.join(' '));
      if (phrase) phrases.push(phrase);
    }
  }
  return phrases;
}

function relationPhrasesFromSentence(sentence = '') {
  const phrases = [];
  const afterPattern = /\b(?:requires?|depends?\s+on|depends_on|dependent\s+on|relies?\s+on|constrained\s+by|constrained_by|limited\s+by|limited_by|linked\s+to|linked_to|bottlenecks?\s+by|bottlenecked\s+by|needs?|shortage\s+of|lack\s+of)\s+([^.,:()]{4,120})/gi;
  let match = afterPattern.exec(sentence);
  while (match) {
    const phrase = cleanEndogenousPhrase(match[1]);
    if (phrase) phrases.push(phrase);
    match = afterPattern.exec(sentence);
  }
  const beforeRelationPattern = /([^.,:()]{4,120})\s+\b(?:requires?|depends?\s+on|depends_on|dependent\s+on|relies?\s+on|constrained\s+by|constrained_by|limited\s+by|limited_by|linked\s+to|linked_to|bottlenecks?\s+by|bottlenecked\s+by|needs?)\b/gi;
  match = beforeRelationPattern.exec(sentence);
  while (match) {
    const phrase = cleanEndogenousPhrase(match[1]);
    if (phrase) phrases.push(phrase);
    match = beforeRelationPattern.exec(sentence);
  }
  const beforePattern = /([^.,:()]{4,120})\s+\b(?:capacity|constraint|shortage|bottleneck|supplier|qualification|substitution|infrastructure|availability|throughput|lead\s+time|backlog)\b/gi;
  match = beforePattern.exec(sentence);
  while (match) {
    const phrase = cleanEndogenousPhrase(match[1]);
    if (phrase) phrases.push(phrase);
    match = beforePattern.exec(sentence);
  }
  return phrases;
}

function inferEndogenousEvidenceClasses(phrase = '', sentence = '', context = {}) {
  const text = `${phrase} ${sentence}`.toLowerCase();
  const classes = new Set();
  if (/\b(capacity|throughput|availability|shortage|supplier|suppliers|source|sourcing|facility|facilities|production)\b/.test(text)) classes.add('supplier_capacity');
  if (/\b(qualification|qualified|certification|certified|acceptance|test|testing|technical readiness|lead time)\b/.test(text)) classes.add('technical_qualification');
  if (/\b(substitute|substitution|alternative|redundancy|redundant|sole source|single source|interchangeable)\b/.test(text)) classes.add('substitution_limit');
  if (/\b(procurement|contract|award|funding|budget|obligation|solicitation)\b/.test(text)) classes.add('procurement_trigger');
  if (/\b(subsidy|permitting|policy|regulatory|tax credit|incentive)\b/.test(text)) classes.add('policy_funding');
  if (/\b(mission support|mission award|task order|launch service|services contract)\b/.test(text)) classes.add('mission_award');
  if (/\b(manifest|cadence|launch operations|backlog|schedule)\b/.test(text)) classes.add('launch_manifest');
  if (/\b(power|electricity|interconnection|substation|megawatt|mw|utility|cooling water|water availability)\b/.test(text)) classes.add('power_constraint');

  const open = new Set((context.evidenceClasses || []).filter((klass) => OPEN_CLASS_NAMES.has(klass) || klass === 'power_constraint'));
  const filtered = [...classes].filter((klass) => !open.size || open.has(klass));
  if (filtered.length) return filtered;
  if (open.has('supplier_capacity') || /\b(capacity|supplier|infrastructure|availability|throughput)\b/.test(text)) return ['supplier_capacity'];
  return [];
}

function buildStrictLeakageAudit({ seedTerms = [], queryVariants = [], sourceTerms = [] } = {}) {
  const seedText = seedTerms.join(' ').toLowerCase();
  const queryText = queryVariants.join(' ').toLowerCase();
  const sourceText = sourceTerms.join(' ').toLowerCase();
  const seedMatches = STRICT_ENDOGENOUS_HOLDOUT_TERMS.filter((term) => containsTerm(seedText, term));
  const queryMatches = STRICT_ENDOGENOUS_HOLDOUT_TERMS.filter((term) => containsTerm(queryText, term));
  const sourceEchoes = STRICT_ENDOGENOUS_HOLDOUT_TERMS.filter((term) => containsTerm(sourceText, term));
  return {
    seedLeakageScore: seedMatches.length ? 1 : 0,
    seedMatches,
    queryTargetEchoes: queryMatches,
    sourceTargetEchoes: sourceEchoes,
  };
}

function hasStrictHoldoutEcho(value = '') {
  const text = String(value || '').toLowerCase();
  return STRICT_ENDOGENOUS_HOLDOUT_TERMS.some((term) => containsTerm(text, term));
}

function strictEndogenousArtifactExcluded(artifact = {}, reportDir = '') {
  const manifest = artifact.manifest || artifact || {};
  const bundle = artifact.bundle || {};
  const subject = manifest.subject || bundle.subject || artifact.subject || {};
  const metadata = subject.metadata || {};
  const reportName = path.basename(String(reportDir || '')).toLowerCase();
  const metadataText = [
    manifest.reportId,
    bundle.reportId,
    subject.subjectType,
    subject.subjectId,
    subject.displayName,
    metadata.adjacentCandidateKey,
    metadata.adjacentLane,
    bundle.metadata?.adjacentCandidateKey,
    bundle.metadata?.adjacentLane,
  ].join(' ').toLowerCase();
  const text = [reportName, metadataText].join(' ').toLowerCase();
  if (String(subject.subjectType || '').toLowerCase() === 'no_bound_candidate') return true;
  if (/no[-_ ]?match[-_ ]theme/.test(text)) return true;
  if (/no cross theme bottleneck report bound to/.test(text)) return true;
  if (/^rpt-.*adjacent[-_]/.test(reportName)) return true;
  if (/(^|[^a-z0-9])adjacent[-_][a-z0-9-]+/.test(metadataText)) return true;
  return false;
}

function buildEndogenousPhraseRecords(context = {}) {
  const sentences = splitSentences(context.corpus)
    .filter((sentence) => ENDOGENOUS_GENERIC_CUE_RE.test(sentence))
    .filter((sentence) => !ENDOGENOUS_INTERNAL_NOISE_RE.test(sentence));
  const records = new Map();
  for (const sentence of sentences) {
    const hasRelationVerb = ENDOGENOUS_RELATION_RE.test(sentence);
    const phraseCandidates = uniqueStrings([
      ...relationPhrasesFromSentence(sentence),
      ...(hasRelationVerb ? phraseNgramsFromSentence(sentence) : phraseNgramsFromSentence(sentence).filter((phrase) => /\b(capacity|supplier|material|infrastructure|qualification|substitution|contract|award|operations|support|availability|throughput)\b/i.test(phrase))),
    ], 80);
    for (const phrase of phraseCandidates) {
      if (!phrase || ENDOGENOUS_NOISE_RE.test(`${phrase} ${sentence}`) || ENDOGENOUS_INTERNAL_NOISE_RE.test(`${phrase} ${sentence}`) || ENDOGENOUS_NEGATIVE_CONTROL_RE.test(`${phrase} ${sentence}`)) continue;
      const key = phrase.toLowerCase();
      const existing = records.get(key) || {
        phrase,
        count: 0,
        relationSupport: 0,
        quotes: new Set(),
        evidenceClasses: new Set(),
      };
      existing.count += 1;
      if (hasRelationVerb) existing.relationSupport += 1;
      existing.quotes.add(compactText(sentence, 260));
      for (const klass of inferEndogenousEvidenceClasses(phrase, sentence, context)) existing.evidenceClasses.add(klass);
      existing.sentences = existing.sentences || new Set();
      existing.sentences.add(compactText(sentence, 360));
      records.set(key, existing);
    }
  }
  return [...records.values()]
    .map((record) => {
      const evidenceClasses = [...record.evidenceClasses];
      const sourceDiversity = record.quotes.size;
      const sentenceText = [...(record.sentences || [])].join(' ');
      const nonObvious = scoreNonObviousBottleneckDiscovery({
        phrase: record.phrase,
        sentence: sentenceText,
        context,
        relationSupport: record.relationSupport,
        sourceDiversity,
        evidenceClasses,
      });
      const score = record.count * 8
        + record.relationSupport * 12
        + sourceDiversity * 10
        + evidenceClasses.length * 6
        + (context.domains?.length ? 4 : 0)
        + Math.round(Number(nonObvious.frontierScore || 0) / 4);
      return {
        ...record,
        quotes: [...record.quotes],
        sentences: [...(record.sentences || [])],
        evidenceClasses,
        sourceDiversity,
        nonObvious,
        score,
      };
    })
    .filter((record) => record.evidenceClasses.length)
    .sort((left, right) => (
      Number(right.nonObvious?.frontierScore || 0) - Number(left.nonObvious?.frontierScore || 0)
      || right.score - left.score
      || right.relationSupport - left.relationSupport
      || right.phrase.length - left.phrase.length
    ))
    .slice(0, 30);
}

function primaryEndogenousClass(record = {}) {
  return asArray(record.evidenceClasses)[0] || 'supplier_capacity';
}

function pickDiverseEndogenousRecords(records = [], limit = 6) {
  const picked = [];
  const seenQuotes = new Set();
  for (const record of records) {
    const quoteKey = compactText(asArray(record.quotes)[0] || '', 180).toLowerCase();
    if (quoteKey && seenQuotes.has(quoteKey)) continue;
    picked.push(record);
    if (quoteKey) seenQuotes.add(quoteKey);
    if (picked.length >= limit) return picked;
  }
  for (const record of records) {
    if (picked.includes(record)) continue;
    picked.push(record);
    if (picked.length >= limit) break;
  }
  return picked;
}

function buildEndogenousQueryVariants(context = {}, sourceTerms = [], evidenceClasses = []) {
  const subject = compactText(context.parentSubject || context.parentSubjectKey || 'reported subject', 160);
  const terms = uniqueStrings(sourceTerms, 8);
  const classText = uniqueStrings(evidenceClasses, 4).join(' ').replace(/_/g, ' ');
  const termText = terms.slice(0, 4).join(' ');
  return uniqueStrings([
    `${termText} lead time qualification approved supplier capacity evidence official`,
    `${termText} ${classText} contract filing official source`,
    `${termText} constraint availability qualification substitution evidence`,
    `${termText} pricing power backlog margin capacity allocation evidence`,
  ].map((query) => compactText(query, 260)), 8);
}

function frontierNodeSupport({
  concreteNodes = [],
  nonObviousDiscovery = {},
  relationSupport = 0,
  sourceDiversity = 0,
  evidenceClasses = [],
} = {}) {
  const nodes = asArray(concreteNodes);
  const hasSourceDerivedNode = nodes.some((node) => node?.sourceDerived || node?.frontierNode);
  const scarcityEvidenceScore = Math.max(
    Number(nonObviousDiscovery.scarcitySignalScore || 0),
    ...nodes.map((node) => Number(node.score || 0) >= 0.74 ? 0.28 : 0),
  );
  const supported = hasSourceDerivedNode
    && Number(relationSupport || 0) >= 2
    && Number(sourceDiversity || 0) >= 2
    && asArray(evidenceClasses).length > 0
    && scarcityEvidenceScore >= 0.28
    && Number(nonObviousDiscovery.bottleneckSpecificityScore || 0) >= 0.42
    && Number(nonObviousDiscovery.consensusPenalty || 0) < 0.5;
  return {
    frontierNodeSupported: Boolean(supported),
    scarcityEvidenceScore,
    sourceDerivedNodeCount: nodes.filter((node) => node?.sourceDerived || node?.frontierNode).length,
  };
}

function gateStrictEndogenousStatus(status = '', support = {}, nonObviousDiscovery = {}) {
  if (support.frontierNodeSupported && Number(nonObviousDiscovery.frontierScore || 0) >= 62) {
    return 'non_obvious_bottleneck_ready';
  }
  if (support.frontierNodeSupported && Number(nonObviousDiscovery.frontierScore || 0) >= 55) {
    return 'ready_for_deep_report';
  }
  if (!support.sourceDerivedNodeCount && status === 'frontier_candidate' && Number(nonObviousDiscovery.consensusPenalty || 0) >= 0.18) {
    return 'needs_scarcity_evidence';
  }
  if (!ADJACENT_REPORT_READY_STATUSES.includes(status)) return status;
  if (support.frontierNodeSupported) return status;
  if (Number(nonObviousDiscovery.consensusPenalty || 0) >= 0.4) return 'consensus_suppressed';
  return 'needs_scarcity_evidence';
}

function failureReasonForStrictStatus(status = '', readyForReport = false) {
  if (readyForReport) return null;
  if (status === 'needs_parent_evidence') return 'parent_readiness_gap';
  if (status === 'consensus_suppressed') return 'consensus_suppressed';
  return 'source_coverage_gap';
}

function nextActionForStrictStatus(status = '', readyForReport = false) {
  if (readyForReport) {
    return 'Promote generated adjacent candidate to universal research subject, run a deep report, then execute report-scoped closure.';
  }
  if (status === 'needs_parent_evidence') {
    return 'Run parent-level evidence backfill first; this graph-overlap parent is not eligible for adjacent deep-report promotion yet.';
  }
  if (status === 'consensus_suppressed') {
    return 'Keep the broad consensus narrative below narrower bottleneck nodes; collect direct scarcity evidence before re-ranking.';
  }
  return 'Collect independent scarcity, qualification, substitution, pricing-power, or direct-provider evidence for the generated dependency lane before deep-report promotion.';
}

function buildEndogenousAdjacentCandidatesFromContext(context = {}) {
  const parentReadiness = context.parentReadiness || evaluateParentCandidateReadiness({});
  const records = buildEndogenousPhraseRecords(context);
  if (!records.length) {
    const hasCueSentences = splitSentences(context.corpus).some((sentence) => ENDOGENOUS_GENERIC_CUE_RE.test(sentence));
    if (!parentReadiness.parentReadyForAdjacent) {
      return {
        candidates: [],
        diagnostics: [{
          lane: null,
          status: 'needs_parent_evidence',
          failureReason: 'parent_readiness_gap',
          nextAction: nextActionForStrictStatus('needs_parent_evidence', false),
          confidenceScore: 0,
          discoveryNamespace: STRICT_ENDOGENOUS_NAMESPACE,
          parentReadiness,
        }],
      };
    }
    return {
      candidates: [],
      diagnostics: [{
        lane: null,
        status: 'needs_fix',
        failureReason: hasCueSentences ? 'vocabulary_gap' : 'source_coverage_gap',
        nextAction: hasCueSentences
          ? 'Open-vocabulary extraction found dependency cues but no usable component/material/process/infrastructure phrase.'
          : 'No dependency-cue source text was available; collect source evidence before endogenous adjacent discovery.',
        confidenceScore: 0,
        discoveryNamespace: STRICT_ENDOGENOUS_NAMESPACE,
      }],
    };
  }

  const grouped = new Map();
  for (const record of records) {
    const key = primaryEndogenousClass(record);
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(record);
  }
  if (records.length >= 2) {
    grouped.set('frontier_bottleneck', pickDiverseEndogenousRecords(records, 8));
  }

  const candidates = [];
  for (const [primaryClass, group] of grouped.entries()) {
    const selected = pickDiverseEndogenousRecords(group, 6);
    const sourceTerms = uniqueStrings(selected.map((record) => record.phrase), 12);
    const evidenceClasses = uniqueStrings(selected.flatMap((record) => record.evidenceClasses), 12);
    const relationSupport = selected.reduce((sum, record) => sum + record.relationSupport, 0);
    const sourceDiversity = new Set(selected.flatMap((record) => record.quotes)).size;
    const nonObviousDiscovery = summarizeNonObviousScores(selected);
    const confidenceScore = clamp(
      20
      + Math.min(20, sourceTerms.length * 4)
      + Math.min(20, relationSupport * 8)
      + Math.min(14, sourceDiversity * 5)
      + Math.min(10, evidenceClasses.length * 3)
      + Math.min(16, Number(nonObviousDiscovery.frontierScore || 0) / 6),
      0,
      100,
    );
    const ready = confidenceScore >= READY_CONFIDENCE_THRESHOLD && relationSupport >= 2 && sourceDiversity >= 2 && evidenceClasses.length > 0;
    const initialStatus = classifyNonObviousFrontierStatus({
      baseReady: ready,
      nonObvious: nonObviousDiscovery,
      hasEvidenceClass: evidenceClasses.length > 0,
    });
    const concreteNodes = deriveConcreteBottleneckNodes({
      phrase: sourceTerms.join(' '),
      sourceTerms,
      context,
      evidenceClasses,
      limit: 6,
    });
    const concreteNodeSummary = summarizeConcreteBottleneckNodes(concreteNodes);
    const frontierSupport = frontierNodeSupport({
      concreteNodes,
      nonObviousDiscovery,
      relationSupport,
      sourceDiversity,
      evidenceClasses,
    });
    let status = gateStrictEndogenousStatus(initialStatus, frontierSupport, nonObviousDiscovery);
    if (!parentReadiness.parentReadyForAdjacent) {
      status = 'needs_parent_evidence';
    }
    const readyForReport = ADJACENT_REPORT_READY_STATUSES.includes(status);
    const concreteLabel = concreteNodes[0]?.node || '';
    const lane = `generated_${slugify(concreteLabel || sourceTerms.slice(0, 3).join('_') || primaryClass)}`.slice(0, 160);
    const queryVariants = parentReadiness.parentReadyForAdjacent
      ? uniqueStrings([
        ...concreteNodeSummary.queryVariants,
        ...buildEndogenousQueryVariants(context, sourceTerms, evidenceClasses),
      ], 16)
      : uniqueStrings(parentBackfillQueriesForReadiness({
        subject: context.parentSubject,
        ontologyKey: context.ontologyKey,
        evidenceClasses: context.evidenceClasses?.length ? context.evidenceClasses : evidenceClasses,
      }), 16);
    const leakageAudit = buildStrictLeakageAudit({ seedTerms: [], queryVariants, sourceTerms });
    const parentMetadata = parentReadinessMetadata({ metadata: parentReadiness });
    candidates.push({
      candidateKey: slugify([
        'endogenous-adjacent',
        context.parentSubjectKey || context.parentSubject || context.reportId,
        lane,
      ].filter(Boolean).join('-')),
      label: concreteLabel || sourceTerms[0] || primaryClass,
      parentSubjectKey: context.parentSubjectKey,
      parentSubject: context.parentSubject,
      parentReportId: context.reportId,
      parentReportPath: context.reportPath,
      lane,
      seedTerms: [],
      sourceTerms,
      issuerCandidates: [],
      evidenceClasses,
      confidenceScore,
      failureReason: failureReasonForStrictStatus(status, readyForReport),
      nextAction: nextActionForStrictStatus(status, readyForReport),
      status,
      queryVariants,
      metadata: {
        domains: context.domains,
        ontologyKey: context.ontologyKey,
        themes: context.themes,
        generatedLane: true,
        frontierDiscovery: true,
        discoveryNamespace: STRICT_ENDOGENOUS_NAMESPACE,
        strictEndogenousVersion: STRICT_ENDOGENOUS_DISCOVERY_VERSION,
        ...parentMetadata,
        parentReadiness,
        parentSelection: {
          selectedBecause: parentReadiness.parentReadyForAdjacent
            ? 'parent_candidate_passed_readiness_contract'
            : parentReadiness.parentReadinessReason,
          parentReadinessState: parentReadiness.parentReadinessState,
          parentReadyForAdjacent: parentReadiness.parentReadyForAdjacent,
          backfillNextAction: parentReadiness.parentReadyForAdjacent ? null : 'parent_evidence_backfill_required',
        },
        sourceDiversity,
        relationSupport,
        initialStatus,
        frontierNodeSupported: frontierSupport.frontierNodeSupported,
        scarcityEvidenceScore: frontierSupport.scarcityEvidenceScore,
        sourceDerivedNodeCount: frontierSupport.sourceDerivedNodeCount,
        nonObviousDiscovery,
        consensusProfileVersion: nonObviousDiscovery.consensusProfileVersion,
        suppressedConsensusSymbols: nonObviousDiscovery.suppressedConsensusSymbols || [],
        consensusPenaltyBasis: nonObviousDiscovery.consensusPenaltyBasis || [],
        consensusProfile: context.consensusProfile || null,
        concreteBottleneckNodes: concreteNodes,
        concreteBottleneckNodeSummary: concreteNodeSummary,
        issuerUniverseSourceSymbols: context.issuerUniverse,
        seedLeakageScore: leakageAudit.seedLeakageScore,
        leakageAudit,
        evidenceQuotes: uniqueStrings(selected.flatMap((record) => record.quotes), 8),
        phraseScores: selected.map((record) => ({
          phrase: record.phrase,
          score: record.score,
          nonObvious: record.nonObvious,
          relationSupport: record.relationSupport,
          sourceDiversity: record.sourceDiversity,
          evidenceClasses: record.evidenceClasses,
        })),
        staticLanePlaybookUsed: false,
        issuerPromotionAllowed: false,
        createdBy: 'strict-endogenous-adjacent-discovery',
      },
    });
  }

  const statusRank = (status = '') => ({
    non_obvious_bottleneck_ready: 0,
    needs_scarcity_evidence: 1,
    frontier_candidate: 2,
    ready_for_deep_report: 3,
    needs_evidence: 4,
    needs_parent_evidence: 5,
    consensus_suppressed: 6,
  })[String(status || '')] ?? 9;
  candidates.sort((left, right) => (
    statusRank(left.status) - statusRank(right.status)
    || Number(right.metadata?.nonObviousDiscovery?.frontierScore || 0) - Number(left.metadata?.nonObviousDiscovery?.frontierScore || 0)
    || right.confidenceScore - left.confidenceScore
  ));
  return {
    candidates: candidates.slice(0, 8),
    diagnostics: candidates.slice(0, 12).map((candidate) => ({
      lane: candidate.lane,
      status: candidate.status,
      failureReason: candidate.failureReason,
      nextAction: candidate.nextAction,
      confidenceScore: candidate.confidenceScore,
      discoveryNamespace: STRICT_ENDOGENOUS_NAMESPACE,
      generatedLane: true,
      seedLeakageScore: candidate.metadata.seedLeakageScore,
    })),
  };
}

function extractIssuerCandidates(context = {}) {
  const explicit = collectValuesForKeys(context.rawArtifact || {}, new Set([
    'issuerCandidates',
    'issuer_candidates',
    'adjacentIssuerCandidates',
    'adjacent_issuer_candidates',
  ])).flatMap(asArray);
  const normalized = [];
  for (const item of explicit) {
    if (!item) continue;
    if (typeof item === 'object') {
      const label = compactText(item.label || item.name || item.company || item.issuer || item.symbol, 120);
      if (!label) continue;
      normalized.push({
        label,
        symbol: compactText(item.symbol || item.ticker || '', 16) || null,
        status: item.status || 'issuer_candidate_unverified',
        evidence: item.evidence || item.source || null,
      });
      continue;
    }
    const label = compactText(item, 120);
    if (label) normalized.push({ label, symbol: null, status: 'issuer_candidate_unverified' });
  }
  const seen = new Set();
  return normalized.filter((item) => {
    const key = `${String(item.label || '').toLowerCase()}|${String(item.symbol || '').toUpperCase()}`;
    if (!item.label || seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 20);
}

function buildContextFromArtifact(artifact = {}, options = {}) {
  const manifest = artifact.manifest || artifact;
  const bundle = artifact.bundle || {};
  const validation = artifact.validation || {};
  const drafts = artifact.drafts || artifact.sourceQueryDrafts || artifact.source_query_drafts || [];
  const subject = manifest.subject || bundle.subject || artifact.subject || {};
  const discovery = subject.metadata?.discovery || bundle.subject?.metadata?.discovery || artifact.discovery || {};
  const reportId = compactText(manifest.reportId || bundle.reportId || artifact.reportId || options.reportId || '', 160);
  const reportType = compactText(manifest.reportType || bundle.reportType || artifact.reportType || '', 120);
  const subjectType = compactText(subject.subjectType || subject.subject_type || artifact.subjectType || artifact.subject_type || '', 80);
  const parentSubject = compactText(subject.displayName || subject.label || subject.subject || artifact.subjectLabel || artifact.parentSubject || discovery.connector || '', 180);
  const parentSubjectKey = slugify(subject.subjectId || discovery.connector || parentSubject || reportId || 'report');
  const themes = uniqueStrings([
    ...asArray(subject.metadata?.themes || artifact.themes),
    ...asArray(discovery.themes),
    ...asArray(manifest.themes),
  ], 20);
  const triggerTerms = uniqueStrings(asArray(discovery.triggerTerms || artifact.triggerTerms), 60);
  const sourceQueries = uniqueStrings([
    ...asArray(discovery.sourceQueries),
    ...collectValuesForKeys(drafts, new Set(['query', 'queryText', 'queryVariants', 'sourceQueries'])).flatMap(asArray),
  ], 120).filter((query) => !options.strictEndogenousAdjacent || !hasStrictHoldoutEcho(query));
  const watchTerms = uniqueStrings([
    ...asArray(manifest.watchVocabulary || bundle.watchVocabulary || artifact.watchVocabulary),
    ...asArray(manifest.watchTerms || artifact.watchTerms),
  ], 80);
  const evidenceClasses = uniqueStrings(collectEvidenceClasses({ manifest, bundle, validation, drafts, artifact }), 100);
  const issuerUniverse = collectIssuerUniverse({ manifest, bundle, validation, drafts, artifact });
  const issuerDiscoveryValues = collectValuesForKeys({ manifest, bundle, validation, drafts, artifact }, new Set([
    'issuerDiscoveryMap',
    'issuerDiscovery',
    'autoIssuerGroups',
    'issuerBridgeSummary',
    'issuerName',
    'issuer_name',
    'symbol',
    'ticker',
  ])).flatMap(asArray);
  const consensusTerms = uniqueStrings([
    parentSubject,
    parentSubjectKey,
    ...themes,
    ...issuerUniverse,
    ...issuerDiscoveryValues.map((value) => {
      if (value && typeof value === 'object') return value.issuerName || value.issuer_name || value.symbol || value.ticker || value.name || value.label || '';
      return value;
    }),
  ], 100);
  const consensusProfile = buildDynamicConsensusProfile({
    consensusTerms,
    reportSubjects: [
      parentSubject,
      parentSubjectKey,
      manifest.reportId,
      bundle.reportId,
      artifact.reportId,
    ],
    issuerUniverse,
    candidateIssuerUniverse: [
      ...asArray(bundle.metadata?.candidateIssuerUniverse),
      ...asArray(bundle.metadata?.adjacentCandidate?.metadata?.candidateIssuerUniverse),
    ],
    issuerDiscoveryMap: issuerDiscoveryValues,
    ontologySupplierSymbols: [
      ...asArray(bundle.metadata?.deepResearch?.ontologyPack?.supplierSymbols),
      ...asArray(bundle.metadata?.deepResearch?.ontologyPack?.trackedSymbols),
    ],
    providerRows: [
      ...asArray(bundle.metadata?.deepResearch?.packs?.issuerDiscoveryPack?.rows),
      ...asArray(bundle.metadata?.deepResearch?.crossThemeActionBridge?.autoDiscoveredIssuers),
    ],
    backfillRows: [
      ...asArray(bundle.metadata?.reportClosureLedger?.classes),
      ...asArray(bundle.metadata?.deepResearch?.reportClosureLedger?.classes),
    ],
  });
  const parentEvidenceSummary = parentEvidenceSummaryFromReportArtifact({ manifest, bundle, validation, drafts, artifact });
  const candidateMetadata = bundle.metadata?.candidate?.metadata || {};
  const candidateReason = compactText(bundle.metadata?.candidate?.reason || artifact.candidate?.reason || discovery.reason || '', 260);
  const parentReadinessGateRequired = Boolean(
    subjectType === 'cross_theme_candidate'
    || bundle.metadata?.candidate
    || artifact.candidate
    || /shared dependency graph overlap|cross[-_\s]?theme candidate/i.test(candidateReason)
  );
  const parentReadiness = parentReadinessGateRequired
    ? evaluateParentCandidateReadiness({
      evidenceSummary: parentEvidenceSummary,
      metadata: {
        ...candidateMetadata,
        ...(bundle.metadata || {}),
        nonObviousDiscovery: bundle.metadata?.nonObviousDiscovery || subject.metadata?.discovery?.nonObviousDiscovery || {},
        sourceQueryFailure: candidateMetadata.sourceQueryFailure,
        lastSourceQueryExecution: candidateMetadata.lastSourceQueryExecution,
      },
    })
    : {
      ...parentReadinessMetadata({
        evidenceSummary: {
          directEvidenceCount: 1,
          sourceDiversityRaw: 2,
          officialProviderEvidenceCount: 1,
        },
      }),
      parentReadinessReason: 'non_cross_theme_parent_not_readiness_gated',
      parentReadyForAdjacent: true,
      parentGateRequired: false,
    };
  const extraTextFragments = asArray(artifact.extraText || [])
    .flatMap((text) => collectTextFragments(text, { limit: 120, maxDepth: 3, maxString: 500 }))
    .slice(0, 320);
  const corpusParts = uniqueStrings([
    parentSubject,
    reportType,
    discovery.ontologyKey,
    discovery.ontologyLabel,
    discovery.mechanism,
    discovery.connector,
    ...themes,
    ...triggerTerms,
    ...sourceQueries,
    ...watchTerms,
    ...collectStrings(drafts, { limit: 220, maxDepth: 6, maxString: 400 }),
    ...(options.strictEndogenousAdjacent ? [] : collectStrings(validation, { limit: 80, maxDepth: 5, maxString: 320 })),
    ...extraTextFragments,
    ...(options.strictEndogenousAdjacent ? collectStrings(bundle.evidence || bundle.claims || [], { limit: 180, maxDepth: 5, maxString: 420 }) : []),
    ...(options.strictEndogenousAdjacent ? collectStrings(artifact.relations || artifact.knowledgeGraph || artifact.graph || [], { limit: 120, maxDepth: 5, maxString: 420 }) : []),
  ], 520);
  const context = {
    reportId,
    reportType,
    reportPath: options.reportPath || artifact.reportPath || '',
    parentSubject,
    parentSubjectKey,
    ontologyKey: compactText(discovery.ontologyKey || artifact.ontologyKey || '', 80),
    themes,
    triggerTerms,
    watchTerms,
    queryTerms: sourceQueries,
    evidenceClasses,
    issuerUniverse,
    consensusTerms,
    consensusProfile,
    parentReadiness,
    rawArtifact: artifact,
    corpus: corpusParts.join('. '),
    bundleSkipped: Boolean(artifact.bundleSkipped),
  };
  context.domains = inferDomains(context);
  context.issuerCandidates = extractIssuerCandidates(context);
  return context;
}

function buildCandidate(context = {}, lane = {}, hits = {}) {
  const parentReadiness = context.parentReadiness || evaluateParentCandidateReadiness({});
  const confidenceScore = scoreLane({ ...hits, context, lane });
  const readyTerms = lane.readyTerms || lane.terms || [];
  const readyTermSignal = hits.termHits.some((term) => readyTerms.some((readyTerm) => String(term).toLowerCase() === String(readyTerm).toLowerCase()));
  const parentReady = parentReadiness.parentReadyForAdjacent !== false;
  const ready = parentReady && confidenceScore >= READY_CONFIDENCE_THRESHOLD && readyTermSignal && hits.classHits.length > 0;
  const failureReason = !parentReady
    ? 'parent_readiness_gap'
    : (ready ? null : (readyTermSignal ? inferFailureReason({ ...hits, context, lane }) : 'source_coverage_gap'));
  const status = !parentReady ? 'needs_parent_evidence' : (ready ? 'ready_for_deep_report' : 'needs_evidence');
  const sourceTerms = extractSourceTerms(context, lane, hits.termHits);
  const evidenceClasses = uniqueStrings([
    ...hits.classHits,
    ...asArray(lane.evidenceClasses),
  ], 20);
  const queryVariants = parentReady
    ? buildLaneQueryVariants(context, lane)
    : parentBackfillQueriesForReadiness({
      subject: context.parentSubject,
      ontologyKey: context.ontologyKey,
      evidenceClasses: context.evidenceClasses?.length ? context.evidenceClasses : evidenceClasses,
    });
  const candidateKey = slugify([
    'adjacent',
    context.parentSubjectKey || context.parentSubject || context.reportId,
    lane.lane,
  ].filter(Boolean).join('-'));
  return {
    candidateKey,
    label: `${lane.label}: ${context.parentSubject || context.parentSubjectKey || 'reported subject'}`,
    parentSubjectKey: context.parentSubjectKey,
    parentSubject: context.parentSubject,
    parentReportId: context.reportId,
    parentReportPath: context.reportPath,
    lane: lane.lane,
    seedTerms: uniqueStrings([...(context.triggerTerms || []), ...(context.watchTerms || [])], 30),
    sourceTerms,
    issuerCandidates: context.issuerCandidates || [],
    evidenceClasses,
    confidenceScore,
    failureReason,
    nextAction: ready
      ? 'Promote adjacent candidate to universal research subject, run a deep report, then execute report-scoped closure.'
      : (status === 'needs_parent_evidence' ? nextActionForStrictStatus(status, false) : nextActionForFailure(failureReason, lane)),
    status,
    queryVariants,
    metadata: {
      domains: context.domains,
      ontologyKey: context.ontologyKey,
      themes: context.themes,
      termHits: hits.termHits,
      classHits: hits.classHits,
      domainHits: hits.domainHits,
      issuerUniverseSourceSymbols: context.issuerUniverse,
      issuerPromotionAllowed: false,
      bundleSkipped: context.bundleSkipped,
      ...parentReadinessMetadata({ metadata: parentReadiness }),
      parentReadiness,
      parentSelection: {
        selectedBecause: parentReady
          ? 'parent_candidate_passed_readiness_contract'
          : parentReadiness.parentReadinessReason,
        parentReadinessState: parentReadiness.parentReadinessState,
        parentReadyForAdjacent: parentReady,
        backfillNextAction: parentReady ? null : 'parent_evidence_backfill_required',
      },
      createdBy: 'report-adjacent-expansion',
    },
  };
}

export function buildAdjacentThemeCandidatesFromArtifact(artifact = {}, options = {}) {
  const context = buildContextFromArtifact(artifact, options);
  if (options.strictEndogenousAdjacent) {
    if (strictEndogenousArtifactExcluded(artifact, options.reportPath || context.reportPath || '')) {
      return {
        candidates: [],
        diagnostics: [{
          lane: null,
          status: 'eval_excluded',
          failureReason: 'seed_contamination_holdout',
          nextAction: 'Excluded legacy adjacent/no-bound artifact from strict endogenous discovery evaluation.',
          confidenceScore: 0,
          discoveryNamespace: STRICT_ENDOGENOUS_NAMESPACE,
        }],
        context: { ...context, strictExcluded: true },
      };
    }
    const result = buildEndogenousAdjacentCandidatesFromContext(context);
    return { ...result, context };
  }
  const candidates = [];
  for (const lane of ADJACENT_LANE_PLAYBOOKS) {
    const hits = {
      termHits: termHitsForLane(context, lane),
      classHits: classHitsForLane(context, lane),
      domainHits: domainHitsForLane(context, lane),
    };
    if (!shouldCreateLane(context, lane, hits)) continue;
    candidates.push(buildCandidate(context, lane, hits));
  }
  const diagnostics = candidates.length
    ? candidates.map((candidate) => ({
      lane: candidate.lane,
      status: candidate.status,
      failureReason: candidate.failureReason,
      nextAction: candidate.nextAction,
      confidenceScore: candidate.confidenceScore,
    }))
    : [{
      lane: null,
      status: 'needs_fix',
      failureReason: context.evidenceClasses.length ? 'vocabulary_gap' : 'source_coverage_gap',
      nextAction: context.evidenceClasses.length
        ? 'No adjacent lane matched the report evidence classes; add ontology/lane vocabulary or class mapping.'
        : 'No report evidence classes were available; generate or repair the report evidence contract first.',
      confidenceScore: 0,
    }];
  return { candidates, diagnostics, context };
}

async function readJsonIfExists(filePath, { maxBytes = Number.MAX_SAFE_INTEGER } = {}) {
  if (!existsSync(filePath)) return null;
  const info = await stat(filePath);
  if (info.size > maxBytes) return { skipped: true, size: info.size, path: filePath };
  const raw = await readFile(filePath, 'utf8');
  return JSON.parse(raw);
}

async function readTextIfExists(filePath, { maxBytes = 1_000_000 } = {}) {
  if (!existsSync(filePath)) return '';
  const info = await stat(filePath);
  if (info.size > maxBytes) return '';
  return readFile(filePath, 'utf8');
}

export async function buildAdjacentThemeCandidatesFromReportDir(reportDir, options = {}) {
  const manifest = await readJsonIfExists(path.join(reportDir, 'manifest.json'));
  const drafts = await readJsonIfExists(path.join(reportDir, 'source-query-drafts.json'));
  const validation = await readJsonIfExists(path.join(reportDir, 'validation.json'));
  const shouldIncludeBundle = options.includeBundle || options.strictEndogenousAdjacent;
  const bundleResult = shouldIncludeBundle
    ? await readJsonIfExists(path.join(reportDir, 'bundle.json'), { maxBytes: options.maxBundleBytes || REPORT_SCAN_MAX_JSON_BYTES })
    : null;
  const strictArtifactText = options.strictEndogenousAdjacent
    ? [
      await readTextIfExists(path.join(reportDir, 'report.md'), { maxBytes: 1_000_000 }),
      await readTextIfExists(path.join(reportDir, 'evidence_table.csv'), { maxBytes: 1_000_000 }),
      await readTextIfExists(path.join(reportDir, 'audit_appendix.json'), { maxBytes: 1_000_000 }),
    ].filter(Boolean)
    : [];
  const artifact = {
    manifest: manifest?.skipped ? null : manifest,
    drafts: drafts?.skipped ? [] : (drafts || []),
    validation: validation?.skipped ? null : validation,
    bundle: bundleResult?.skipped ? null : bundleResult,
    bundleSkipped: Boolean(bundleResult?.skipped),
    extraText: strictArtifactText,
    reportPath: path.join(reportDir, 'report.html'),
  };
  return buildAdjacentThemeCandidatesFromArtifact(artifact, { ...options, reportPath: artifact.reportPath });
}

export async function discoverAdjacentCandidatesFromLatestReports({
  reportRoot = path.join('data', 'reports'),
  limit = 25,
  includeBundle = false,
  strictEndogenousAdjacent = false,
} = {}) {
  const max = Math.max(1, Math.min(100, Math.floor(Number(limit) || 25)));
  if (!existsSync(reportRoot)) return { candidates: [], diagnostics: [], reportDirs: [] };
  const entries = await readdir(reportRoot, { withFileTypes: true });
  const dirs = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (strictEndogenousAdjacent && entry.name.includes('adjacent-')) continue;
    const dir = path.join(reportRoot, entry.name);
    if (!existsSync(path.join(dir, 'manifest.json'))) continue;
    const info = await stat(path.join(dir, 'manifest.json')).catch(() => null);
    dirs.push({ dir, mtimeMs: info?.mtimeMs || 0 });
  }
  dirs.sort((left, right) => right.mtimeMs - left.mtimeMs);
  const candidatesByKey = new Map();
  const diagnostics = [];
  const reportDirs = [];
  for (const { dir } of dirs.slice(0, max)) {
    const result = await buildAdjacentThemeCandidatesFromReportDir(dir, { includeBundle, strictEndogenousAdjacent });
    if (strictEndogenousAdjacent && result.context?.strictExcluded) continue;
    reportDirs.push(dir);
    diagnostics.push(...result.diagnostics.map((item) => ({ ...item, reportDir: dir, reportId: result.context.reportId })));
    for (const candidate of result.candidates) {
      const key = `${candidate.parentReportId}|${candidate.candidateKey}`;
      const existing = candidatesByKey.get(key);
      if (!existing || candidate.confidenceScore > existing.confidenceScore) candidatesByKey.set(key, candidate);
    }
  }
  return { candidates: [...candidatesByKey.values()], diagnostics, reportDirs };
}

export async function ensureAdjacentThemeCandidateSchema(client) {
  if (!client?.query) return;
  await client.query(`
    CREATE TABLE IF NOT EXISTS adjacent_theme_candidates (
      id BIGSERIAL PRIMARY KEY,
      candidate_key TEXT NOT NULL,
      parent_subject_key TEXT,
      parent_subject TEXT,
      parent_report_id TEXT,
      parent_report_path TEXT,
      lane TEXT NOT NULL,
      label TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'candidate',
      seed_terms TEXT[] NOT NULL DEFAULT '{}'::text[],
      source_terms TEXT[] NOT NULL DEFAULT '{}'::text[],
      issuer_candidates JSONB NOT NULL DEFAULT '[]'::jsonb,
      evidence_classes TEXT[] NOT NULL DEFAULT '{}'::text[],
      confidence_score DOUBLE PRECISION NOT NULL DEFAULT 0,
      failure_reason TEXT,
      next_action TEXT,
      query_variants TEXT[] NOT NULL DEFAULT '{}'::text[],
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(candidate_key, parent_report_id)
    )
  `);
  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_adjacent_theme_candidates_status_score
      ON adjacent_theme_candidates (status, confidence_score DESC, updated_at DESC)
  `);
  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_adjacent_theme_candidates_parent_report
      ON adjacent_theme_candidates (parent_report_id, lane)
  `);
}

export async function upsertAdjacentThemeCandidates(client, candidates = []) {
  if (!client?.query || !Array.isArray(candidates) || !candidates.length) return [];
  await ensureAdjacentThemeCandidateSchema(client);
  const rows = [];
  for (const candidate of candidates) {
    const result = await client.query(`
      INSERT INTO adjacent_theme_candidates (
        candidate_key, parent_subject_key, parent_subject, parent_report_id,
        parent_report_path, lane, label, status, seed_terms, source_terms,
        issuer_candidates, evidence_classes, confidence_score, failure_reason,
        next_action, query_variants, metadata, last_seen_at, updated_at
      )
      VALUES (
        $1, $2, $3, $4,
        $5, $6, $7, $8, $9::text[], $10::text[],
        $11::jsonb, $12::text[], $13, $14,
        $15, $16::text[], $17::jsonb, NOW(), NOW()
      )
      ON CONFLICT (candidate_key, parent_report_id) DO UPDATE SET
        label = EXCLUDED.label,
        status = CASE
          WHEN adjacent_theme_candidates.status IN ('review_ready','rejected','search_exhausted_not_validated') THEN adjacent_theme_candidates.status
          WHEN EXCLUDED.status IN ('ready_for_deep_report','non_obvious_bottleneck_ready') THEN EXCLUDED.status
          WHEN adjacent_theme_candidates.status IN ('ready_for_deep_report','non_obvious_bottleneck_ready')
            AND EXCLUDED.status IN ('candidate','frontier_candidate','needs_evidence','needs_scarcity_evidence','provider_collecting','consensus_suppressed') THEN adjacent_theme_candidates.status
          WHEN adjacent_theme_candidates.status = 'provider_collecting'
            AND EXCLUDED.status IN ('candidate','frontier_candidate','needs_evidence','needs_scarcity_evidence','consensus_suppressed') THEN adjacent_theme_candidates.status
          ELSE EXCLUDED.status
        END,
        seed_terms = ARRAY(SELECT DISTINCT x FROM unnest(adjacent_theme_candidates.seed_terms || EXCLUDED.seed_terms) AS x WHERE x IS NOT NULL AND x <> ''),
        source_terms = ARRAY(SELECT DISTINCT x FROM unnest(adjacent_theme_candidates.source_terms || EXCLUDED.source_terms) AS x WHERE x IS NOT NULL AND x <> ''),
        issuer_candidates = EXCLUDED.issuer_candidates,
        evidence_classes = ARRAY(SELECT DISTINCT x FROM unnest(adjacent_theme_candidates.evidence_classes || EXCLUDED.evidence_classes) AS x WHERE x IS NOT NULL AND x <> ''),
        confidence_score = GREATEST(adjacent_theme_candidates.confidence_score, EXCLUDED.confidence_score),
        failure_reason = EXCLUDED.failure_reason,
        next_action = EXCLUDED.next_action,
        query_variants = CASE
          WHEN array_length(EXCLUDED.query_variants, 1) > 0 THEN EXCLUDED.query_variants
          ELSE adjacent_theme_candidates.query_variants
        END,
        metadata = adjacent_theme_candidates.metadata || EXCLUDED.metadata,
        last_seen_at = NOW(),
        updated_at = NOW()
      RETURNING *
    `, [
      candidate.candidateKey,
      candidate.parentSubjectKey || null,
      candidate.parentSubject || null,
      candidate.parentReportId || '',
      candidate.parentReportPath || null,
      candidate.lane,
      candidate.label,
      candidate.status || 'candidate',
      candidate.seedTerms || [],
      candidate.sourceTerms || [],
      JSON.stringify(candidate.issuerCandidates || []),
      candidate.evidenceClasses || [],
      Number(candidate.confidenceScore || 0),
      candidate.failureReason || null,
      candidate.nextAction || null,
      candidate.queryVariants || [],
      JSON.stringify(candidate.metadata || {}),
    ]);
    rows.push(result.rows[0]);
  }
  return rows;
}

export async function enqueueAdjacentCandidateSourceQueries(client, candidates = [], {
  limit = 30,
  perCandidateLimit = 2,
} = {}) {
  if (!client?.query || !Array.isArray(candidates) || !candidates.length) {
    return { inspectedCount: 0, insertedCount: 0, dedupedCount: 0, failedCount: 0, errors: [] };
  }
  const max = Math.max(1, Math.min(200, Math.floor(Number(limit) || 30)));
  const perCandidate = Math.max(1, Math.min(5, Math.floor(Number(perCandidateLimit) || 2)));
  let inspectedCount = 0;
  let insertedCount = 0;
  let repairedCount = 0;
  let dedupedCount = 0;
  let failedCount = 0;
  const errors = [];
  const eligible = candidates
    .filter((candidate) => ['frontier_candidate', 'needs_evidence', 'needs_scarcity_evidence', 'provider_collecting', 'needs_parent_evidence', 'ready_for_deep_report', 'non_obvious_bottleneck_ready'].includes(String(candidate.status || '')))
    .slice(0, max);
  for (const candidate of eligible) {
    const queries = uniqueStrings(candidate.queryVariants || [], perCandidate);
    for (const query of queries) {
      const selectedEvidenceClass = evidenceClassForAdjacentQuery(candidate, query);
      const routePlan = routeEvidenceProvider({
        evidenceClass: selectedEvidenceClass,
        subject: candidate.label,
        target: candidate.label,
        query,
        themes: [
          ...asArray(candidate.metadata?.parentThemes),
          ...asArray(candidate.themes),
          candidate.parentSubject,
        ],
        ontologyKey: candidate.metadata?.ontologyKey || candidate.metadata?.discovery?.ontologyKey,
        metadata: {
          ...(candidate.metadata || {}),
          adjacentCandidateKey: candidate.candidateKey,
          adjacentLane: candidate.lane,
          adjacentStatus: candidate.status,
          discoveryNamespace: candidate.metadata?.discoveryNamespace || 'static_adjacent_playbook',
          frontierDiscovery: Boolean(candidate.metadata?.frontierDiscovery),
          parentReadinessState: candidate.metadata?.parentReadinessState || null,
          parentReadinessReason: candidate.metadata?.parentReadinessReason || null,
          parentReadyForAdjacent: candidate.metadata?.parentReadyForAdjacent ?? null,
        },
        queryVariantLimit: Math.max(3, perCandidate),
      });
      const sourceProviders = uniqueStrings([
        ...asArray(routePlan.sourceProviders),
        ...adjacentSourceProvidersForClass(selectedEvidenceClass),
      ], 24);
      const queryVariants = uniqueStrings([query, ...asArray(routePlan.queryVariants), ...asArray(candidate.queryVariants)], 12);
      inspectedCount += 1;
      try {
        const packName = `adjacent_theme:${candidate.lane}:${selectedEvidenceClass}`;
        const metadataPayload = {
          source: 'report-adjacent-expansion',
          reason: candidate.nextAction || 'Adjacent theme candidate requires class-specific evidence.',
          collectionKind: 'adjacent_theme_candidate',
          createdBy: 'report-adjacent-expansion',
          automationPath: 'report-adjacent-expansion -> report_backfill_tasks -> provider/source-query collection -> research_evidence_bundles',
          reviewGate: true,
          adjacentCandidateKey: candidate.candidateKey,
          adjacentLane: candidate.lane,
          adjacentStatus: candidate.status,
          generatedLane: Boolean(candidate.metadata?.generatedLane),
          discoveryNamespace: candidate.metadata?.discoveryNamespace || 'static_adjacent_playbook',
          seedLeakageScore: Number(candidate.metadata?.seedLeakageScore || 0),
          sourceDiversity: Number(candidate.metadata?.sourceDiversity || 0),
          relationSupport: Number(candidate.metadata?.relationSupport || 0),
          nonObviousDiscovery: candidate.metadata?.nonObviousDiscovery || null,
          frontierDiscovery: Boolean(candidate.metadata?.frontierDiscovery),
          consensusPenalty: Number(candidate.metadata?.nonObviousDiscovery?.consensusPenalty || 0),
          parentReadiness: candidate.metadata?.parentReadiness || null,
          parentReadinessState: candidate.metadata?.parentReadinessState || null,
          parentReadyForAdjacent: candidate.metadata?.parentReadyForAdjacent ?? null,
          parentReadinessReason: candidate.metadata?.parentReadinessReason || null,
          parentReportId: candidate.parentReportId || null,
          parentSubject: candidate.parentSubject || null,
          target: {
            type: 'adjacent_theme_candidate',
            lane: candidate.lane,
            label: candidate.label,
            parentSubject: candidate.parentSubject || null,
            issuerCandidates: candidate.issuerCandidates || [],
          },
          desiredEvidenceClass: selectedEvidenceClass,
          evidenceClass: selectedEvidenceClass,
          evidenceClasses: candidate.evidenceClasses || [],
          evidenceUse: 'supporting_context',
          sourceTerms: candidate.sourceTerms || [],
          seedTerms: candidate.seedTerms || [],
          queryVariants,
          failureReason: candidate.failureReason || null,
          closureReason: null,
          closureState: null,
          nextAction: null,
          providerRoutePlan: {
            ...routePlan,
            evidenceClass: selectedEvidenceClass,
            sourceProviders,
            queryVariants,
            generatedLane: Boolean(candidate.metadata?.generatedLane),
            frontierDiscovery: Boolean(candidate.metadata?.frontierDiscovery),
            nonObviousDiscovery: candidate.metadata?.nonObviousDiscovery || null,
            parentReadiness: candidate.metadata?.parentReadiness || null,
            parentReadinessState: candidate.metadata?.parentReadinessState || null,
            parentReadyForAdjacent: candidate.metadata?.parentReadyForAdjacent ?? null,
            parentReadinessReason: candidate.metadata?.parentReadinessReason || null,
            discoveryNamespace: candidate.metadata?.discoveryNamespace || 'static_adjacent_playbook',
          },
        };
        const result = await client.query(`
          INSERT INTO report_backfill_tasks (
            report_id, subject_key, pack_name, task_type, query, status, priority, metadata
          )
          SELECT $1, $2, $3, 'source_query', $4, 'pending', $5, $6::jsonb
          WHERE NOT EXISTS (
            SELECT 1
              FROM report_backfill_tasks
             WHERE subject_key = $2
               AND pack_name = $3
               AND LOWER(query) = LOWER($4)
               AND status = ANY($7::text[])
          )
          RETURNING id
        `, [
          candidate.parentReportId || null,
          candidate.candidateKey,
          packName,
          query,
          Math.round(Number(candidate.confidenceScore || 0)),
          JSON.stringify(metadataPayload),
          ['pending', 'retry_wait', 'queued_review'],
        ]);
        if (result.rows.length) {
          insertedCount += 1;
        } else {
          const repaired = await client.query(`
            UPDATE report_backfill_tasks
               SET status = CASE WHEN status IN ('queued_review', 'weak_noise_collected', 'context_collected') THEN 'pending' ELSE status END,
                   metadata = metadata || $5::jsonb,
                   updated_at = NOW()
             WHERE subject_key = $1
               AND pack_name = $2
               AND LOWER(query) = LOWER($3)
               AND status = ANY($4::text[])
               AND (
                 metadata->'providerRoutePlan'->>'providerRoute' = 'adjacent_lane_source_query'
                 OR metadata->>'closureReason' = 'weak_noise_only'
                 OR metadata->>'closureState' = 'direct_provider_required'
               )
             RETURNING id
          `, [
            candidate.candidateKey,
            packName,
            query,
            ['pending', 'retry_wait', 'queued_review', 'weak_noise_collected', 'context_collected'],
            JSON.stringify(metadataPayload),
          ]);
          if (repaired.rows.length) repairedCount += repaired.rows.length;
          else dedupedCount += 1;
        }
      } catch (error) {
        failedCount += 1;
        errors.push({ candidateKey: candidate.candidateKey, lane: candidate.lane, query, error: String(error?.message || error) });
      }
    }
  }
  return { inspectedCount, insertedCount, repairedCount, dedupedCount, failedCount, errors };
}

export async function loadAdjacentThemeSubjects(client, {
  limit = 50,
  statuses = ADJACENT_REPORT_READY_STATUSES,
  discoveryNamespace = '',
  frontierOnly = false,
  excludeStaticAdjacentKeys = false,
  minStrictEndogenousVersion = 0,
} = {}) {
  if (!client?.query) return [];
  await ensureAdjacentThemeCandidateSchema(client);
  const max = Math.max(1, Math.min(200, Math.floor(Number(limit) || 50)));
  const statusFilter = uniqueStrings(statuses, 12);
  const namespaceFilter = compactText(discoveryNamespace, 80);
  const result = await client.query(`
    WITH ranked AS (
      SELECT *,
             ROW_NUMBER() OVER (
               PARTITION BY candidate_key
               ORDER BY updated_at DESC, confidence_score DESC, parent_report_id DESC
             ) AS candidate_rank
        FROM adjacent_theme_candidates
       WHERE status = ANY($1::text[])
         AND ($3::text = '' OR metadata->>'discoveryNamespace' = $3)
         AND (NOT $4::boolean OR LOWER(COALESCE(metadata->>'frontierDiscovery', 'false')) = 'true')
         AND (NOT $4::boolean OR LOWER(COALESCE(metadata->>'parentReadyForAdjacent', 'false')) = 'true')
         AND (NOT $5::boolean OR candidate_key NOT LIKE 'adjacent-%')
         AND ($6::int <= 0 OR COALESCE(NULLIF(metadata->>'strictEndogenousVersion', '')::int, 0) >= $6::int)
    )
    SELECT *
      FROM ranked
     WHERE candidate_rank = 1
     ORDER BY
       CASE status
         WHEN 'non_obvious_bottleneck_ready' THEN 0
         WHEN 'ready_for_deep_report' THEN 1
         WHEN 'review_ready' THEN 2
         ELSE 3
       END,
       COALESCE(NULLIF(metadata->'nonObviousDiscovery'->>'frontierScore', '')::double precision, 0) DESC,
       confidence_score DESC,
       updated_at DESC
     LIMIT $2
  `, [
    statusFilter,
    max,
    namespaceFilter,
    Boolean(frontierOnly),
    Boolean(excludeStaticAdjacentKeys),
    Math.max(0, Math.floor(Number(minStrictEndogenousVersion) || 0)),
  ]);
  return result.rows.map((row) => ({
    subjectKey: row.candidate_key,
    label: row.label,
    aliases: uniqueStrings([row.parent_subject, row.lane, ...(row.source_terms || [])], 30),
    symbols: [],
    sourceTypes: ['adjacent_theme_candidates', row.lane],
    sourceRefs: [{ sourceType: 'adjacent_theme_candidates', sourceId: row.id, parentReportId: row.parent_report_id }],
    priorityScore: clamp(
      Number(row.confidence_score || 0)
      + (row.status === 'non_obvious_bottleneck_ready' ? 18 : row.status === 'ready_for_deep_report' ? 12 : 6),
      0,
      100,
    ),
    subjectType: 'material_or_bottleneck',
    status: 'active',
    metadata: {
      adjacentCandidateId: row.id,
      adjacentCandidateKey: row.candidate_key,
      adjacentStatus: row.status,
      parentReportId: row.parent_report_id,
      parentSubject: row.parent_subject,
      lane: row.lane,
      failureReason: row.failure_reason,
      nextAction: row.next_action,
      discoveryNamespace: row.metadata?.discoveryNamespace || 'static_adjacent_playbook',
      frontierDiscovery: Boolean(row.metadata?.frontierDiscovery),
      nonObviousDiscovery: row.metadata?.nonObviousDiscovery || null,
      consensusPenalty: Number(row.metadata?.nonObviousDiscovery?.consensusPenalty || 0),
      parentReadinessState: row.metadata?.parentReadinessState || null,
      parentReadinessReason: row.metadata?.parentReadinessReason || null,
      parentReadyForAdjacent: row.metadata?.parentReadyForAdjacent ?? null,
      parentBackfillState: row.metadata?.parentBackfillState || null,
      issuerPromotionAllowed: false,
    },
  }));
}

export function isRecursiveAdjacentCandidateKey(value = '') {
  const key = String(value || '').toLowerCase();
  return /^adjacent-(?:adjacent|endogenous-adjacent|endogenous-frontier-parent)-/.test(key)
    || /(^|-)adjacent-adjacent-/.test(key);
}

export function adjacentStatusFromSourceQueryClosure(row = {}) {
  if (isRecursiveAdjacentCandidateKey(row.candidate_key)) return 'needs_fix';
  const pending = Number(row.pending_count || 0);
  const approved = Number(row.approved_count || 0);
  const context = Number(row.context_count || 0);
  const executed = Number(row.executed_count || 0);
  const noise = Number(row.noise_count || 0);
  const rejected = Number(row.rejected_count || 0);
  const confidence = Number(row.confidence_score || 0);
  const strictFrontier = String(row.strict_frontier || '').toLowerCase() === 'true' || row.strict_frontier === true;
  const parentReadyForAdjacent = String(row.parent_ready_for_adjacent || '').toLowerCase() === 'true' || row.parent_ready_for_adjacent === true;
  const hasSourceCoverageGap = String(row.has_source_coverage_gap || '').toLowerCase() === 'true' || row.has_source_coverage_gap === true;
  const relationSupport = Number(row.relation_support || 0);
  const sourceDiversity = Number(row.source_diversity || 0);
  if (strictFrontier && !parentReadyForAdjacent) return 'needs_parent_evidence';
  if (pending || approved) return 'provider_collecting';
  if (strictFrontier && (hasSourceCoverageGap || relationSupport < 2 || sourceDiversity < 2)) {
    if (executed || context) return 'needs_scarcity_evidence';
    if (noise) return 'needs_evidence';
    if (rejected) return 'needs_fix';
    return 'needs_scarcity_evidence';
  }
  if (context >= 2 && confidence >= 55) return confidence >= 70 ? 'non_obvious_bottleneck_ready' : 'ready_for_deep_report';
  if (executed || context) return 'provider_collecting';
  if (noise) return 'needs_evidence';
  if (rejected) return 'needs_fix';
  return 'needs_evidence';
}

export async function reconcileAdjacentCandidateEvidenceStatus(client) {
  if (!client?.query) return { inspectedCount: 0, updatedCount: 0, rows: [] };
  await ensureAdjacentThemeCandidateSchema(client);
  const result = await client.query(`
    SELECT COALESCE(NULLIF(aq.payload->>'adjacentCandidateKey', ''), NULLIF(aq.payload->>'subjectKey', '')) AS candidate_key,
           array_agg(DISTINCT aq.status) FILTER (WHERE aq.status IS NOT NULL) AS statuses,
           COUNT(*) FILTER (WHERE aq.status = 'pending') AS pending_count,
           COUNT(*) FILTER (WHERE aq.status = 'approved') AS approved_count,
           COUNT(*) FILTER (WHERE aq.status = 'executed') AS executed_count,
           COUNT(*) FILTER (WHERE aq.status = 'context-collected') AS context_count,
           COUNT(*) FILTER (WHERE aq.status = 'weak-noise-collected') AS noise_count,
           COUNT(*) FILTER (WHERE aq.status = 'rejected') AS rejected_count,
           MAX(COALESCE(aq.reviewed_at, aq.created_at)) AS latest_at,
           MAX(atc.confidence_score) AS confidence_score,
           BOOL_OR(atc.failure_reason = 'source_coverage_gap') AS has_source_coverage_gap,
           BOOL_OR(
             LOWER(COALESCE(atc.metadata->>'discoveryNamespace', '')) = '${STRICT_ENDOGENOUS_NAMESPACE}'
             OR LOWER(COALESCE(atc.metadata->>'frontierDiscovery', 'false')) = 'true'
           ) AS strict_frontier,
           MAX(COALESCE(NULLIF(atc.metadata->>'relationSupport', '')::double precision, 0)) AS relation_support,
           MAX(COALESCE(NULLIF(atc.metadata->>'sourceDiversity', '')::double precision, 0)) AS source_diversity,
           BOOL_OR(LOWER(COALESCE(atc.metadata->>'parentReadyForAdjacent', 'false')) = 'true') AS parent_ready_for_adjacent,
           MAX(atc.metadata->>'parentReadinessState') AS parent_readiness_state,
           MAX(atc.metadata->>'parentReadinessReason') AS parent_readiness_reason
     FROM approval_queue aq
     LEFT JOIN (
       SELECT candidate_key, MAX(confidence_score) AS confidence_score, MAX(failure_reason) AS failure_reason, MAX(metadata::text)::jsonb AS metadata
         FROM adjacent_theme_candidates
        GROUP BY candidate_key
     ) atc
       ON atc.candidate_key = COALESCE(NULLIF(aq.payload->>'adjacentCandidateKey', ''), NULLIF(aq.payload->>'subjectKey', ''))
     WHERE aq.action_type = 'source-query'
       AND (
         aq.payload->>'collectionKind' = 'adjacent_theme_candidate'
         OR aq.payload->>'packName' LIKE 'adjacent_theme:%'
         OR aq.payload->>'subjectKey' LIKE 'adjacent-%'
       )
       AND COALESCE(NULLIF(aq.payload->>'adjacentCandidateKey', ''), NULLIF(aq.payload->>'subjectKey', '')) IS NOT NULL
     GROUP BY COALESCE(NULLIF(aq.payload->>'adjacentCandidateKey', ''), NULLIF(aq.payload->>'subjectKey', ''))
  `);
  const updated = [];
  for (const row of result.rows) {
    const nextStatus = adjacentStatusFromSourceQueryClosure(row);
    const closure = {
      statuses: row.statuses || [],
      pendingCount: Number(row.pending_count || 0),
      approvedCount: Number(row.approved_count || 0),
      executedCount: Number(row.executed_count || 0),
      contextCount: Number(row.context_count || 0),
      noiseCount: Number(row.noise_count || 0),
      rejectedCount: Number(row.rejected_count || 0),
      confidenceScore: Number(row.confidence_score || 0),
      strictFrontier: Boolean(row.strict_frontier),
      sourceCoverageGap: Boolean(row.has_source_coverage_gap),
      relationSupport: Number(row.relation_support || 0),
      sourceDiversity: Number(row.source_diversity || 0),
      parentReadyForAdjacent: Boolean(row.parent_ready_for_adjacent),
      parentReadinessState: row.parent_readiness_state || null,
      parentReadinessReason: row.parent_readiness_reason || null,
      readyForDeepReport: nextStatus === 'ready_for_deep_report',
      nonObviousBottleneckReady: nextStatus === 'non_obvious_bottleneck_ready',
      latestAt: row.latest_at || null,
      reconciledAt: new Date().toISOString(),
    };
    const patch = await client.query(`
      UPDATE adjacent_theme_candidates
         SET status = CASE
               WHEN $2 = 'needs_fix' AND $1 LIKE 'adjacent-%' THEN $2
               WHEN status IN ('review_ready','search_exhausted_not_validated','rejected') THEN status
               WHEN status IN ('ready_for_deep_report','non_obvious_bottleneck_ready')
                    AND $2 IN ('needs_parent_evidence','needs_scarcity_evidence','provider_collecting','needs_evidence','needs_fix') THEN $2
               WHEN status IN ('ready_for_deep_report','non_obvious_bottleneck_ready') THEN status
               ELSE $2
             END,
             failure_reason = CASE
               WHEN $2 IN ('ready_for_deep_report','non_obvious_bottleneck_ready') THEN NULL
               WHEN $2 = 'needs_parent_evidence' THEN 'parent_readiness_gap'
               WHEN $2 = 'needs_scarcity_evidence' THEN COALESCE(failure_reason, 'direct_evidence_required')
               WHEN $2 = 'needs_fix' AND $1 LIKE 'adjacent-%' THEN COALESCE(failure_reason, 'recursive_adjacent_parent_excluded')
               ELSE failure_reason
             END,
             next_action = CASE
               WHEN $2 IN ('ready_for_deep_report','non_obvious_bottleneck_ready')
                 THEN 'Promote adjacent candidate to universal research subject, run a deep report, then execute report-scoped closure.'
               WHEN $2 = 'needs_parent_evidence'
                 THEN 'Run parent-level evidence backfill first; this graph-overlap parent is not eligible for adjacent deep-report promotion yet.'
               WHEN $2 = 'needs_fix' AND $1 LIKE 'adjacent-%'
                 THEN 'Exclude recursive adjacent-derived candidate; return to original parent selection and node-specific evidence backfill.'
               ELSE next_action
             END,
             confidence_score = CASE
               WHEN $2 IN ('ready_for_deep_report','non_obvious_bottleneck_ready')
                 THEN GREATEST(
                   confidence_score,
                   LEAST(95, 70 + (COALESCE(($3::jsonb->>'contextCount')::int, 0) * 4) - (COALESCE(($3::jsonb->>'noiseCount')::int, 0) * 3))
                 )
               ELSE confidence_score
             END,
             metadata = metadata || jsonb_build_object('sourceQueryClosure', $3::jsonb),
             updated_at = NOW()
       WHERE candidate_key = $1
       RETURNING candidate_key, status
    `, [row.candidate_key, nextStatus, JSON.stringify(closure)]);
    if (patch.rows[0]) updated.push(patch.rows[0]);
  }
  return { inspectedCount: result.rows.length, updatedCount: updated.length, rows: updated };
}

function reportGradeRank(grade = '') {
  return ({ S: 5, A: 4, B: 3, C: 2, D: 1, F: 0 })[String(grade || '').trim().toUpperCase()] ?? 0;
}

async function readAdjacentReportBundle({ reportDir = '', reportPath = '' } = {}) {
  const candidates = uniqueStrings([
    reportDir ? path.join(reportDir, 'bundle.json') : '',
    reportPath ? path.join(path.dirname(reportPath), 'bundle.json') : '',
  ], 3);
  for (const file of candidates) {
    if (!file || !existsSync(file)) continue;
    try {
      return JSON.parse(await readFile(file, 'utf8'));
    } catch {
      return null;
    }
  }
  return null;
}

function numberFromPaths(object = {}, paths = []) {
  for (const pathParts of paths) {
    let current = object;
    for (const part of pathParts) {
      current = current?.[part];
      if (current === undefined || current === null) break;
    }
    const value = Number(current);
    if (Number.isFinite(value)) return value;
  }
  return 0;
}

function adjacentDeepReportSignals({
  candidate = {},
  bundle = null,
  quality = {},
  publishable = false,
} = {}) {
  const metadata = candidate.metadata || {};
  const bridgeSummary = bundle?.metadata?.issuerBridgeSummary || metadata.issuerBridgeSummary || {};
  const actionMetrics = bundle?.metadata?.deepResearch?.crossThemeActionBridge?.metrics
    || quality?.crossThemeActionability?.metrics
    || quality?.actionability?.metrics
    || {};
  const investmentReadiness = bundle?.metadata?.deepResearch?.investmentReadiness
    || quality?.investmentReadiness
    || {};
  const closureCounts = bundle?.metadata?.deepResearch?.reportClosureLedger?.counts || {};
  const extractionRows = asArray(bundle?.metadata?.deepResearch?.packs?.evidenceClassExtractionPack?.rows);
  const strictFrontier = metadata.discoveryNamespace === STRICT_ENDOGENOUS_NAMESPACE
    || metadata.frontierDiscovery === true
    || bundle?.metadata?.strictEndogenousAdjacent === true
    || bundle?.subject?.metadata?.strictEndogenousAdjacent === true;
  const bridgeAttachedCount = Math.max(
    numberFromPaths({ bridgeSummary, actionMetrics }, [
      ['bridgeSummary', 'bridgeAttachedCount'],
      ['actionMetrics', 'bridgeAttachedCount'],
      ['actionMetrics', 'issuerBridgeCount'],
    ]),
    0,
  );
  const probableExposureCount = Math.max(
    numberFromPaths({ bridgeSummary, actionMetrics }, [
      ['bridgeSummary', 'probableExposureCount'],
      ['actionMetrics', 'probableExposureCount'],
    ]),
    0,
  );
  const marketRowCount = Math.max(
    numberFromPaths({ investmentReadiness, actionMetrics }, [
      ['investmentReadiness', 'marketValidation', 'rowCount'],
      ['actionMetrics', 'marketRowCount'],
    ]),
    0,
  );
  const marketDecisionGradeCount = numberFromPaths({ investmentReadiness }, [
    ['investmentReadiness', 'marketValidation', 'decisionGradeRowCount'],
  ]);
  const promotionExtractionCount = extractionRows.filter((row) => {
    const evidenceUse = String(row.evidenceUse || row.metadata?.evidenceUse || '');
    const evidenceClass = String(row.evidenceClass || '').toLowerCase();
    const hasIssuerSymbol = Boolean(normalizeSymbol(row.symbol || row.issuerSymbol || row.metadata?.symbol || row.metadata?.issuerSymbol || ''));
    const directIssuerClass = /^(issuer_exposure|issuer_commentary|primary_filing)$/.test(evidenceClass);
    return hasIssuerSymbol
      && directIssuerClass
      && /promotion_candidate|direct_exposure_attached/i.test(evidenceUse)
      && !/weak_noise|supporting_context/i.test(evidenceUse);
  }).length;
  const providerRateLimitedCount = Number(closureCounts.provider_rate_limited || 0);
  const pendingCount = Number(closureCounts.pending || 0) + Number(closureCounts.approved || 0) + Number(closureCounts.running || 0);
  return {
    strictFrontier,
    candidateFailureReason: candidate.failure_reason || null,
    relationSupport: Number(metadata.relationSupport || 0),
    sourceDiversity: Number(metadata.sourceDiversity || 0),
    bridgeAttachedCount,
    probableExposureCount,
    marketRowCount,
    marketDecisionGradeCount,
    promotionExtractionCount,
    providerRateLimitedCount,
    pendingCount,
    marketMissingReason: investmentReadiness?.marketValidation?.missingReason || '',
    publishable: Boolean(publishable),
  };
}

function adjacentDeepReportGate(signals = {}, { reportOk = false, grade = '', publishable = false } = {}) {
  if (!reportOk) {
    return {
      nextStatus: 'needs_fix',
      failureReason: 'deep_report_validation_failed',
      nextAction: 'Fix generated adjacent report before reselecting this candidate.',
      reviewAllowed: false,
      gateReason: 'report_failed',
    };
  }
  const gradeReviewEligible = Boolean(publishable) || reportGradeRank(grade) >= reportGradeRank('B');
  if (!signals.strictFrontier) {
    return {
      nextStatus: gradeReviewEligible ? 'review_ready' : 'provider_collecting',
      failureReason: gradeReviewEligible ? null : 'direct_evidence_required',
      nextAction: gradeReviewEligible
        ? 'Review generated adjacent report and decide whether to promote canonical coverage.'
        : 'Continue evidence closure for missing direct classes.',
      reviewAllowed: gradeReviewEligible,
      gateReason: gradeReviewEligible ? 'legacy_report_grade_gate' : 'report_grade_below_review',
    };
  }
  const hasDirectIssuerBridge = signals.bridgeAttachedCount > 0 || signals.promotionExtractionCount > 0;
  const stillWeakGeneratedLane = signals.candidateFailureReason === 'source_coverage_gap'
    || signals.relationSupport < 2
    || signals.sourceDiversity < 2;
  if (!hasDirectIssuerBridge) {
    const nextStatus = (signals.providerRateLimitedCount > 0 || signals.pendingCount > 0)
      ? 'provider_collecting'
      : 'needs_scarcity_evidence';
    return {
      nextStatus,
      failureReason: stillWeakGeneratedLane ? 'source_coverage_gap' : 'issuer_mapping_gap',
      nextAction: 'Collect direct issuer/scarcity evidence from official provider routes before marking the generated adjacent report review-ready.',
      reviewAllowed: false,
      gateReason: signals.marketMissingReason || 'no_direct_issuer_bridge',
    };
  }
  if (signals.marketMissingReason === 'no_direct_issuer_bridge') {
    return {
      nextStatus: 'provider_collecting',
      failureReason: 'market_validation_missing',
      nextAction: 'Repair issuer bridge and report-scoped market validation before review-ready promotion.',
      reviewAllowed: false,
      gateReason: 'market_validation_missing_no_direct_bridge',
    };
  }
  return {
    nextStatus: gradeReviewEligible ? 'review_ready' : 'provider_collecting',
    failureReason: gradeReviewEligible ? null : 'direct_evidence_required',
    nextAction: gradeReviewEligible
      ? 'Review generated adjacent report and decide whether to promote canonical coverage.'
      : 'Continue evidence closure for missing direct classes.',
    reviewAllowed: gradeReviewEligible,
    gateReason: gradeReviewEligible ? 'strict_direct_gate_passed' : 'report_grade_below_review',
  };
}

export async function recordAdjacentDeepReportResult(client, {
  candidateKey = '',
  reportId = '',
  reportDir = '',
  reportPath = '',
  ok = false,
  validationStatus = '',
  grade = '',
  publishable = false,
  blockers = [],
  warnings = [],
  quality = {},
} = {}) {
  if (!client?.query || !candidateKey) return { updatedCount: 0, rows: [] };
  await ensureAdjacentThemeCandidateSchema(client);
  const candidateResult = await client.query(`
    SELECT candidate_key, status, failure_reason, metadata
      FROM adjacent_theme_candidates
     WHERE candidate_key = $1
     ORDER BY updated_at DESC NULLS LAST
     LIMIT 1
  `, [candidateKey]);
  const candidate = candidateResult.rows?.[0] || {};
  const bundle = await readAdjacentReportBundle({ reportDir, reportPath });
  const reportOk = Boolean(ok);
  const signals = adjacentDeepReportSignals({ candidate, bundle, quality, publishable });
  const gate = adjacentDeepReportGate(signals, { reportOk, grade, publishable });
  const nextStatus = gate.nextStatus;
  const nextAction = gate.nextAction;
  const latestDeepReport = {
    reportId: reportId || null,
    reportDir: reportDir || null,
    reportPath: reportPath || null,
    ok: reportOk,
    validationStatus: validationStatus || null,
    grade: grade || null,
    publishable: Boolean(publishable),
    blockers: asArray(blockers).slice(0, 20),
    warnings: asArray(warnings).slice(0, 20),
    quality,
    gate,
    signals,
    recordedAt: new Date().toISOString(),
  };
  const result = await client.query(`
    UPDATE adjacent_theme_candidates
       SET status = CASE
             WHEN status IN ('review_ready')
                  AND $6::boolean = false THEN $2
             WHEN status IN ('review_ready','rejected','search_exhausted_not_validated') THEN status
             ELSE $2
           END,
           failure_reason = CASE
             WHEN $2 = 'review_ready' THEN NULL
             ELSE COALESCE($5::jsonb->>'failureReason', failure_reason, 'direct_evidence_required')
           END,
           next_action = $3,
           metadata = metadata || jsonb_build_object('latestDeepReport', $4::jsonb),
           updated_at = NOW()
     WHERE candidate_key = $1
     RETURNING candidate_key, status, next_action
  `, [candidateKey, nextStatus, nextAction, JSON.stringify(latestDeepReport), JSON.stringify(gate), Boolean(gate.reviewAllowed)]);
  return { updatedCount: result.rows.length, rows: result.rows };
}

export async function loadAdjacentThemeCandidateSummaries({
  client = null,
  limit = 50,
  status = '',
} = {}) {
  if (!client?.query) return [];
  await ensureAdjacentThemeCandidateSchema(client);
  const max = Math.max(1, Math.min(500, Math.floor(Number(limit) || 50)));
  const statusFilter = compactText(status, 80);
  const params = statusFilter ? [statusFilter, max] : [max];
  const where = statusFilter ? 'WHERE status = $1' : '';
  const limitParam = statusFilter ? '$2' : '$1';
  const result = await client.query(`
    WITH ranked AS (
      SELECT *,
             ROW_NUMBER() OVER (
               PARTITION BY candidate_key
               ORDER BY updated_at DESC, confidence_score DESC, parent_report_id DESC
             ) AS candidate_rank
        FROM adjacent_theme_candidates
        ${where}
    )
    SELECT id, candidate_key, parent_subject_key, parent_subject, parent_report_id,
           parent_report_path, lane, label, status, seed_terms, source_terms,
           issuer_candidates, evidence_classes, confidence_score, failure_reason,
           next_action, query_variants, metadata, first_seen_at, last_seen_at, updated_at
      FROM ranked
     WHERE candidate_rank = 1
     ORDER BY
       CASE status
         WHEN 'non_obvious_bottleneck_ready' THEN 0
         WHEN 'ready_for_deep_report' THEN 1
         WHEN 'review_ready' THEN 2
         WHEN 'needs_scarcity_evidence' THEN 3
         WHEN 'frontier_candidate' THEN 4
         WHEN 'provider_collecting' THEN 5
         WHEN 'needs_evidence' THEN 6
         WHEN 'consensus_suppressed' THEN 7
         WHEN 'needs_fix' THEN 8
         WHEN 'search_exhausted_not_validated' THEN 9
         WHEN 'rejected' THEN 10
         ELSE 7
       END,
       confidence_score DESC,
       updated_at DESC
     LIMIT ${limitParam}
  `, params);
  return result.rows.map((row) => ({
    metadata: row.metadata || {},
    id: row.id,
    candidateKey: row.candidate_key,
    label: row.label,
    parentSubjectKey: row.parent_subject_key,
    parentSubject: row.parent_subject,
    parentReportId: row.parent_report_id,
    parentReportPath: row.parent_report_path,
    lane: row.lane,
    status: row.status,
    seedTerms: row.seed_terms || [],
    sourceTerms: row.source_terms || [],
    issuerCandidates: row.issuer_candidates || [],
    evidenceClasses: row.evidence_classes || [],
    confidenceScore: Number(row.confidence_score || 0),
    failureReason: row.failure_reason,
    nextAction: row.next_action,
    queryVariants: row.query_variants || [],
    generatedLane: Boolean(row.metadata?.generatedLane),
    discoveryNamespace: row.metadata?.discoveryNamespace || 'static_adjacent_playbook',
    seedLeakageScore: Number(row.metadata?.seedLeakageScore || 0),
    sourceDiversity: Number(row.metadata?.sourceDiversity || 0),
    relationSupport: Number(row.metadata?.relationSupport || 0),
    frontierDiscovery: Boolean(row.metadata?.frontierDiscovery),
    nonObviousDiscovery: row.metadata?.nonObviousDiscovery || null,
    candidateIssuerCount: Number(
      row.metadata?.issuerBridgeSummary?.candidateIssuerCount
      ?? row.metadata?.latestDeepReport?.quality?.crossThemeActionability?.metrics?.candidateIssuerCount
      ?? 0,
    ),
    bridgeAttachedCount: Number(
      row.metadata?.issuerBridgeSummary?.bridgeAttachedCount
      ?? row.metadata?.latestDeepReport?.quality?.crossThemeActionability?.metrics?.bridgeAttachedCount
      ?? 0,
    ),
    issuerMappingGapCount: Number(
      row.metadata?.issuerBridgeSummary?.issuerMappingGapCount
      ?? row.metadata?.latestDeepReport?.quality?.crossThemeActionability?.metrics?.issuerMappingGapCount
      ?? 0,
    ),
    latestReportPath: row.metadata?.latestDeepReport?.reportPath || null,
    firstSeenAt: row.first_seen_at,
    lastSeenAt: row.last_seen_at,
    updatedAt: row.updated_at,
  }));
}
