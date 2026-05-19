import {
  discoveryEntriesForTheme,
  filterIssuerSymbols,
  resolveThemeOntology,
} from './theme-ontology.mjs';
import { isStrictEndogenousBundle } from './cross-theme-discovery-quality.mjs';

export const ISSUER_DISCOVERY_VERSION = 'issuer-discovery-map-v1';

export const ISSUER_DISCOVERY_ROLES = Object.freeze([
  'demand_owner',
  'infrastructure_operator',
  'equipment_supplier',
  'capacity_owner',
  'service_or_epc',
  'customer_pass_through',
  'unclear',
]);

const ROLE_ORDER = new Map(ISSUER_DISCOVERY_ROLES.map((role, index) => [role, index]));
const STATUS_ORDER = new Map([
  ['issuer_exposure_attached', 0],
  ['direct_node_exposure_attached', 1],
  ['market_attached', 2],
  ['probable_exposure', 3],
  ['exposure_collecting', 4],
  ['frontier_node_candidate', 5],
  ['candidate', 6],
  ['suppressed_consensus_issuer', 7],
  ['issuer_candidate_unverified', 8],
  ['rejected_or_invalidated', 9],
]);

const SYMBOL_FIELD_PATTERN = /^(symbol|ticker|symbols|tickers|issuerUniverse|issuerSymbols|issuerUniverseSymbols|candidateIssuerUniverse|collectionUniverse|promotionUniverse)$/i;
const SYMBOL_TEXT_STOPLIST = new Set([
  'SEC', 'API', 'RSS', 'ETF', 'FX', 'USD', 'CPI', 'GDP', 'FRED', 'EIA', 'FMP',
  'AI', 'ML', 'OS', 'DB', 'NATO', 'EU', 'UN', 'US', 'USA', 'DOD', 'MOD',
  'MW', 'LLM', 'ARR', 'NRR', 'FY', 'Q1', 'Q2', 'Q3', 'Q4',
  'CPU', 'GPU', 'ASIC', 'FPGA', 'EPS', 'MD', 'PDF', 'HTML', 'CSV', 'JSON', 'ICP',
]);

function asArray(value) {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function compact(value = '') {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function slug(value = '') {
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

function num(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function symbolCandidates(value) {
  if (value == null || typeof value === 'number') return [];
  if (typeof value === 'object') {
    return unique([
      ...symbolCandidates(value.symbol),
      ...symbolCandidates(value.ticker),
      ...symbolCandidates(value.entityKey),
      ...symbolCandidates(value.entity_key),
    ]);
  }
  const text = compact(value).toUpperCase();
  if (!text || SYMBOL_TEXT_STOPLIST.has(text)) return [];
  return /^[A-Z][A-Z0-9.-]{0,9}$/.test(text) ? [text] : [];
}

function bundleFrom(input = {}) {
  if (input.bundle) return input.bundle;
  if (input.artifact?.bundle) return input.artifact.bundle;
  return input.artifact || input;
}

function sourceRowsFrom(input = {}) {
  const rows = input.rows || {};
  return [
    ...asArray(input.evidence),
    ...asArray(bundleFrom(input).evidence),
    ...asArray(rows.research),
    ...asArray(rows.fundamentals),
    ...asArray(rows.filings),
    ...asArray(rows.transcripts),
    ...asArray(rows.policy),
    ...asArray(rows.industry),
    ...asArray(rows.evidenceClassExtractions),
    ...asArray(rows.autoThemeSymbols),
  ];
}

function isFrontierParentScopedBundle(bundle = {}) {
  const summary = bundle.metadata?.candidate?.evidence_summary || bundle.metadata?.candidate?.evidenceSummary || {};
  const metadata = bundle.metadata?.candidate?.metadata || {};
  const discovery = bundle.subject?.metadata?.discovery || {};
  const subjectKey = compact(bundle.subject?.subjectId || bundle.subject?.metadata?.candidateId || discovery.adjacentCandidateKey).toLowerCase();
  return Boolean(
    summary.frontierParentCollectionEligible
    || summary.frontierParentReportReady
    || metadata.frontierParentCollectionEligible
    || metadata.frontierParentReportReady
    || subjectKey.startsWith('endogenous-frontier-parent-')
  );
}

function collectText(value, depth = 0, out = []) {
  if (!value || depth > 5) return out;
  if (typeof value === 'string' || typeof value === 'number') {
    const text = compact(value);
    if (text) out.push(text);
    return out;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectText(item, depth + 1, out);
    return out;
  }
  if (typeof value === 'object') {
    for (const key of [
      'displayName',
      'title',
      'name',
      'label',
      'connector',
      'mechanism',
      'whyNow',
      'query',
      'nextAction',
      'triggerTerms',
      'sourceTerms',
      'source_terms',
      'seed_terms',
      'evidenceQuotes',
      'excerpt',
      'text',
      'body',
      'description',
      'text_excerpt',
      'fact_text',
      'summary',
    ]) {
      collectText(value[key], depth + 1, out);
    }
  }
  return out;
}

function rowText(row = {}) {
  return compact([
    collectText(row).join(' '),
    row.excerpt,
    row.text_excerpt,
    row.textExcerpt,
    row.text,
  ].join(' ')).toLowerCase();
}

const OFFICIAL_ISSUER_SOURCE_PATTERN = /\b(sec|edgar|10-k|10-q|8-k|filing|transcript|earnings|investor|company_ir|company ir|management commentary|fmp)\b/i;
const OPERATING_EXPOSURE_PATTERN = /\b(lead\s*time|backlog|booking|order|award|contract|customer|revenue|margin|pricing|price|capacity|allocation|shortage|supply\s*constraint|delivery|shipment|production|manufacturing|project|facility|service|solution|infrastructure|utility|grid|transmission|distribution|data\s*center|commissioning|qualification|certification|approved\s*supplier|single\s*source)\b/i;
const FRONTIER_SINGLE_TERM_STOPLIST = new Set([
  'transformer',
  'power',
  'capacity',
  'queue',
  'cloud',
  'security',
  'model',
  'software',
  'supply',
  'demand',
]);

function frontierTermAllowed(term = '') {
  const text = compact(term).toLowerCase();
  if (!text) return false;
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 1 && FRONTIER_SINGLE_TERM_STOPLIST.has(words[0])) return false;
  return true;
}

function frontierNodeTerms(bundle = {}) {
  const candidateSummary = bundle.metadata?.candidate?.evidence_summary || bundle.metadata?.candidate?.evidenceSummary || {};
  const candidateMetadata = bundle.metadata?.candidate?.metadata || {};
  const discovery = bundle.subject?.metadata?.discovery || {};
  const subjectTerm = compact(bundle.subject?.displayName || bundle.subject?.subjectId || '').toLowerCase();
  const termBelongsToSubject = (value = '') => {
    const term = compact(value).toLowerCase();
    if (!subjectTerm || !term) return true;
    return subjectTerm.includes(term) || term.includes(subjectTerm);
  };
  const subjectTopNodes = asArray(discovery.concreteBottleneckNodeSummary?.topNodes)
    .filter(termBelongsToSubject);
  const subjectNodes = asArray(discovery.concreteBottleneckNodes)
    .filter((node) => termBelongsToSubject(node.node || node.key));
  return unique([
    bundle.subject?.displayName,
    bundle.subject?.subjectId,
    candidateSummary.discovery?.name,
    candidateSummary.discovery?.label,
    candidateMetadata.discovery?.name,
    candidateMetadata.discovery?.label,
    discovery.name,
    discovery.label,
    ...subjectTopNodes,
    ...subjectNodes.flatMap((node) => [
      node.node,
      node.key,
    ]),
  ]).map((term) => compact(term).toLowerCase()).filter((term) => term.length >= 4 && frontierTermAllowed(term));
}

function rowMentionsFrontierNode(row = {}, bundle = {}) {
  const text = rowText(row);
  if (!text) return false;
  return frontierNodeTerms(bundle).some((term) => {
    if (text.includes(term)) return true;
    const words = term.split(/\s+/).filter((word) => word.length >= 4);
    return words.length >= 2 && words.every((word) => text.includes(word));
  });
}

function frontierNodeFamilyTerms(bundle = {}) {
  const discovery = bundle.subject?.metadata?.discovery || {};
  const subjectTerm = compact(bundle.subject?.displayName || bundle.subject?.subjectId || '').toLowerCase();
  const termBelongsToSubject = (value = '') => {
    const term = compact(value).toLowerCase();
    if (!subjectTerm || !term) return true;
    return subjectTerm.includes(term) || term.includes(subjectTerm);
  };
  const nodes = asArray(discovery.concreteBottleneckNodes)
    .filter((node) => termBelongsToSubject(node.node || node.key));
  const nodeTypes = new Set(nodes.map((node) => slug(node.nodeType)));
  const baseTerms = [
    ...frontierNodeTerms(bundle),
  ];
  const familyTerms = [];
  if ([...nodeTypes].some((type) => /equipment|physical/.test(type)) || /\b(substation|transformer|switchgear|relay|breaker)\b/i.test(baseTerms.join(' '))) {
    familyTerms.push(
      'electrical infrastructure',
      'power infrastructure',
      'grid equipment',
      'substation equipment',
      'switchgear',
      'transformer',
      'protection relay',
      'circuit breaker',
      'low-voltage',
      'medium-voltage',
      'high-voltage',
      'power distribution',
    );
  }
  if ([...nodeTypes].some((type) => /permit|study|queue|service/.test(type)) || /\b(interconnection|permitting|queue|study)\b/i.test(baseTerms.join(' '))) {
    familyTerms.push(
      'interconnection study',
      'interconnection queue',
      'utility service',
      'service upgrade',
      'permitting queue',
      'grid planning',
      'transmission study',
    );
  }
  if ([...nodeTypes].some((type) => /material|input|commodity/.test(type)) || /\b(material|alloy|magnet|feedstock|chemical)\b/i.test(baseTerms.join(' '))) {
    familyTerms.push(
      'input material',
      'specialty material',
      'specialty alloy',
      'rare earth',
      'magnet',
      'copper',
      'steel',
      'insulation',
      'feedstock',
    );
  }
  if ([...nodeTypes].some((type) => /qualification|testing|certification/.test(type)) || /\b(qualification|certification|approved supplier|test)\b/i.test(baseTerms.join(' '))) {
    familyTerms.push(
      'qualified supplier',
      'approved supplier',
      'supplier qualification',
      'certification',
      'test facility',
      'validation testing',
    );
  }
  if ([...nodeTypes].some((type) => /labor|service|maintenance|epc/.test(type)) || /\b(epc|construction|maintenance|commissioning)\b/i.test(baseTerms.join(' '))) {
    familyTerms.push(
      'engineering services',
      'construction services',
      'field service',
      'maintenance',
      'commissioning',
      'EPC',
    );
  }
  return unique([...baseTerms, ...familyTerms])
    .map((term) => compact(term).toLowerCase())
    .filter((term) => term.length >= 4 && frontierTermAllowed(term));
}

function rowMentionsFrontierFamily(row = {}, bundle = {}) {
  return frontierFamilyMatchSpans(row, bundle).length > 0;
}

const STRONG_FRONTIER_FAMILY_TERMS = new Set([
  'substation equipment',
  'switchgear',
  'transformer',
  'protection relay',
  'circuit breaker',
  'power distribution',
  'interconnection study',
  'interconnection queue',
  'grid planning',
  'transmission study',
  'qualified supplier',
  'approved supplier',
  'supplier qualification',
  'certification',
  'test facility',
  'validation testing',
  'specialty alloy',
  'rare earth',
  'magnet',
  'copper',
  'steel',
  'insulation',
  'feedstock',
  'commissioning',
  'EPC',
].map((term) => term.toLowerCase()));

function rowMentionsStrongFrontierFamily(row = {}, bundle = {}) {
  const text = compact([
    rowText(row),
    row.excerpt,
    row.text_excerpt,
    row.textExcerpt,
    row.text,
  ].join(' ')).toLowerCase();
  if (rowMentionsFrontierNode(row, bundle)) return true;
  if (/\b(substation|transformer|switchgear|protection relay|circuit breaker|interconnection study|interconnection queue|qualified supplier|approved supplier|supplier qualification|test facility|validation testing)\b/i.test(text)) {
    return true;
  }
  return frontierFamilyMatchSpans(row, bundle)
    .some((span) => STRONG_FRONTIER_FAMILY_TERMS.has(String(span.term || '').toLowerCase()));
}

function frontierFamilyMatchSpans(row = {}, bundle = {}) {
  const text = compact([
    rowText(row),
    row.excerpt,
    row.text_excerpt,
    row.textExcerpt,
    row.text,
  ].join(' ')).toLowerCase();
  if (!text) return [];
  const spans = [];
  for (const term of frontierNodeFamilyTerms(bundle)) {
    const exactIndex = text.indexOf(term);
    if (exactIndex >= 0) {
      spans.push({ term, index: exactIndex });
      continue;
    }
    const words = term.split(/\s+/).filter((word) => word.length >= 4 && !/^(lead|time|queue|data|center|power|input|material|source|terms?)$/.test(word));
    if (words.length < 2) continue;
    const matched = words
      .map((word) => ({ word, index: text.indexOf(word) }))
      .filter((item) => item.index >= 0);
    if (matched.length >= 2) {
      const positions = matched.map((item) => item.index);
      if (Math.max(...positions) - Math.min(...positions) <= 120) {
        spans.push({ term, index: Math.min(...positions) });
      }
    }
  }
  return spans;
}

function officialIssuerSource(row = {}) {
  const text = compact([
    row.source_type,
    row.sourceType,
    row.kind,
    row.topic,
    row.title,
    row.metadata?.provider,
    row.metadata?.sourceProvider,
    row.metadata?.sourceType,
    row.metadata?.boundary,
    row.metadata?.filingType,
  ].join(' '));
  return OFFICIAL_ISSUER_SOURCE_PATTERN.test(text);
}

function rowHasOperatingExposureFact(row = {}) {
  return OPERATING_EXPOSURE_PATTERN.test(rowText(row));
}

function issuerIdentityTerms(row = {}) {
  const text = compact([
    row.issuerName,
    row.companyName,
    row.company_name,
    row.speaker,
    row.metadata?.issuerName,
    row.metadata?.companyName,
  ].join(' ')).toLowerCase();
  const stop = new Set([
    'inc',
    'corp',
    'corporation',
    'company',
    'co',
    'ltd',
    'plc',
    'limited',
    'holdings',
    'group',
    'class',
    'common',
    'stock',
  ]);
  return unique(text
    .replace(/[^a-z0-9\s.-]+/g, ' ')
    .split(/\s+/)
    .filter((word) => word.length >= 4 && !stop.has(word)));
}

function frontierMatchHasIssuerProximity(row = {}, bundle = {}) {
  const text = rowText(row);
  const identity = issuerIdentityTerms(row);
  if (!identity.length) return true;
  const spans = frontierFamilyMatchSpans(row, bundle);
  if (!spans.length) return false;
  return spans.some((span) => {
    const start = Math.max(0, span.index - 420);
    const end = Math.min(text.length, span.index + 420);
    const window = text.slice(start, end);
    if (/\b(before joining|prior to joining|previously|earlier in (her|his|their) career|career spans|worked at|joins? .* from|since joining)\b/i.test(window)
      && /\b(appointed|appointment|executive|cfo|ceo|career|experience|joins?|joined)\b/i.test(window)) {
      return false;
    }
    return identity.some((term) => window.includes(term));
  });
}

function frontierNodeCandidateEvidence(row = {}, bundle = {}) {
  const symbol = row.symbol || row.ticker || row.metadata?.symbol || row.metadata?.issuerSymbol;
  if (!symbolCandidates(symbol).length) return false;
  if (row.metadata?.currentIssuerDiscoveryMap && String(row.status || '').toLowerCase() === 'frontier_node_candidate') {
    return true;
  }
  if (!officialIssuerSource(row)) return false;
  if (!rowHasOperatingExposureFact(row)) return false;
  if (rowMentionsFrontierNode(row, bundle)) return true;
  return rowMentionsFrontierFamily(row, bundle) && frontierMatchHasIssuerProximity(row, bundle);
}

function frontierNodeDirectOfficialEvidence(row = {}, bundle = {}) {
  const symbol = row.symbol || row.ticker || row.metadata?.symbol || row.metadata?.issuerSymbol;
  if (!symbolCandidates(symbol).length) return false;
  if (!officialIssuerSource(row)) return false;
  if (!rowHasOperatingExposureFact(row)) return false;
  if (!rowMentionsStrongFrontierFamily(row, bundle)) return false;
  return frontierMatchHasIssuerProximity(row, bundle);
}

function normalizeThemeHint(value = '') {
  const key = slug(value);
  if (!key) return '';
  const aliases = {
    ai: 'ai-ml',
    ai_ml: 'ai-ml',
    machine_learning: 'ai-ml',
    ai_data_center: 'ai-ml',
    data_center: 'data-center',
    datacenter: 'data-center',
    data_center_infrastructure: 'data-center',
    cloud_infrastructure: 'cloud-infrastructure',
    semiconductor: 'semiconductor',
    semiconductors: 'semiconductor',
    clean_energy: 'clean-energy',
    cleanenergy: 'clean-energy',
    defense: 'defense-industrial',
    defense_industrial: 'defense-industrial',
    space_launch: 'space',
    space_economy: 'space',
  };
  return aliases[key] || key.replace(/_/g, '-');
}

export function themeHintsForIssuerDiscovery(input = {}) {
  const bundle = bundleFrom(input);
  const strictEndogenous = Boolean(input.strictEndogenous) || isStrictEndogenousBundle(bundle) || isFrontierParentScopedBundle(bundle);
  const adjacent = bundle.metadata?.adjacentCandidate || {};
  const adjacentMetadata = adjacent.metadata || {};
  const subjectMetadata = bundle.subject?.metadata || {};
  const ontologyCoverage = input.ontologyCoverage || bundle.metadata?.deepResearch?.ontologyPack || {};
  const hintSources = strictEndogenous ? [
    subjectMetadata.theme,
    subjectMetadata.themeKey,
    ...asArray(subjectMetadata.themes),
    ...asArray(bundle.subject?.themes),
    bundle.metadata?.theme,
    bundle.metadata?.themeKey,
    ...asArray(bundle.metadata?.candidate?.themes),
    ...asArray(adjacent.themes),
    ...asArray(adjacentMetadata.themes),
  ] : [
    bundle.subject?.subjectId,
    bundle.subject?.displayName,
    subjectMetadata.theme,
    subjectMetadata.themeKey,
    subjectMetadata.connector,
    ...asArray(subjectMetadata.themes),
    ...asArray(bundle.subject?.themes),
    bundle.metadata?.theme,
    bundle.metadata?.themeKey,
    bundle.metadata?.candidate?.theme,
    bundle.metadata?.candidate?.themeKey,
    ...asArray(bundle.metadata?.candidate?.themes),
    ...asArray(bundle.metadata?.themeContext?.themes),
    ...asArray(adjacent.themes),
    ...asArray(adjacentMetadata.themes),
    ...asArray(adjacentMetadata.domains),
    ontologyCoverage.ontologyKey,
    ontologyCoverage.ontologyLabel,
    ...asArray(ontologyCoverage.matchedArchetypes),
  ];
  const hints = unique(hintSources.map(normalizeThemeHint));
  return hints.filter((hint) => hint && !/^(unknown|report|cross-theme|cross-theme-bottleneck-report)$/.test(hint)).slice(0, 12);
}

function roleFromRelationType(value = '') {
  const relation = slug(value);
  if (/adopter|customer|consumer|user|buyer/.test(relation)) return 'demand_owner';
  if (/operator|owner|platform|infrastructure/.test(relation)) return 'infrastructure_operator';
  if (/supplier|vendor|component|equipment|beneficiary/.test(relation)) return 'equipment_supplier';
  if (/epc|construction|service|integrator/.test(relation)) return 'service_or_epc';
  if (/proxy|pass[_-]?through/.test(relation)) return 'customer_pass_through';
  return '';
}

function classifyIssuerRole({ entry = {}, sourceText = '', fallback = '' } = {}) {
  const relationRole = roleFromRelationType(entry.relationType || entry.relation_type || entry.role);
  if (relationRole) return relationRole;
  const haystack = compact([
    sourceText,
    entry.name,
    entry.company,
    entry.issuerName,
    entry.role,
    entry.mechanism,
  ].join(' ')).toLowerCase();
  if (/\b(hyperscaler|cloud capex|ai workload|tenant|customer demand|demand owner)\b/.test(haystack)) return 'demand_owner';
  if (/\b(data center operator|colocation|campus operator|utility|electric utility|power provider|infrastructure operator)\b/.test(haystack)) return 'infrastructure_operator';
  if (/\b(epc|engineering procurement construction|construction|transmission buildout|grid contractor|services?)\b/.test(haystack)) return 'service_or_epc';
  if (/\b(capacity owner|capacity provider|plant owner|generation owner|pipeline owner)\b/.test(haystack)) return 'capacity_owner';
  if (/\b(equipment|supplier|component|switchgear|transformer|cooling|thermal|rack|power equipment|vendor)\b/.test(haystack)) return 'equipment_supplier';
  if (fallback && ISSUER_DISCOVERY_ROLES.includes(fallback)) return fallback;
  return 'unclear';
}

function statusRank(status = '') {
  return STATUS_ORDER.has(status) ? STATUS_ORDER.get(status) : 99;
}

function roleRank(role = '') {
  return ROLE_ORDER.has(role) ? ROLE_ORDER.get(role) : 99;
}

function addCandidate(map, symbol, detail = {}) {
  const [filtered] = filterIssuerSymbols(symbolCandidates(symbol));
  if (!filtered) return;
  if (!map.has(filtered)) {
    map.set(filtered, {
      symbol: filtered,
      issuerName: filtered,
      roleVotes: [],
      confidence: 0,
      sourceTypes: new Set(),
      sourceTerms: new Set(),
      evidenceRefs: new Set(),
      statuses: new Set(),
      details: [],
    });
  }
  const row = map.get(filtered);
  const issuerName = compact(detail.issuerName || detail.companyName || detail.company || detail.entityLabel);
  if (issuerName && row.issuerName === filtered) row.issuerName = issuerName;
  const explicitRole = detail.role && ISSUER_DISCOVERY_ROLES.includes(detail.role) ? detail.role : '';
  const looseSource = ['candidate_universe', 'report_candidate_universe', 'provider_route_plan', 'calculated']
    .includes(String(detail.sourceType || ''));
  const role = explicitRole || (looseSource
    ? 'unclear'
    : classifyIssuerRole({ entry: detail, sourceText: asArray(detail.sourceTerms).join(' ') }));
  row.roleVotes.push(role);
  row.confidence = Math.max(row.confidence, num(detail.confidence, 0));
  for (const sourceType of asArray(detail.sourceType || detail.sourceTypes)) {
    if (sourceType) row.sourceTypes.add(sourceType);
  }
  for (const term of asArray(detail.sourceTerms)) {
    const text = compact(term);
    if (text) row.sourceTerms.add(text);
  }
  for (const ref of asArray(detail.evidenceRef || detail.evidenceRefs)) {
    const text = compact(ref);
    if (text) row.evidenceRefs.add(text);
  }
  if (detail.status) row.statuses.add(detail.status);
  row.details.push({
    sourceType: detail.sourceType || null,
    role,
    confidence: num(detail.confidence, 0),
    primaryOntology: Boolean(detail.primaryOntology),
  });
}

function roleConsensus(roleVotes = []) {
  const counts = new Map();
  for (const role of roleVotes || []) {
    const safe = ISSUER_DISCOVERY_ROLES.includes(role) ? role : 'unclear';
    counts.set(safe, (counts.get(safe) || 0) + 1);
  }
  const entries = [...counts.entries()];
  const nonUnclear = entries.filter(([role]) => role !== 'unclear');
  return (nonUnclear.length ? nonUnclear : entries)
    .sort((a, b) => b[1] - a[1] || roleRank(a[0]) - roleRank(b[0]))[0]?.[0] || 'unclear';
}

function statusConsensus(statuses = new Set(), promotionSymbols = new Set()) {
  const list = [...statuses].filter(Boolean);
  if (promotionSymbols.size && list.some((status) => status === 'issuer_exposure_attached')) return 'issuer_exposure_attached';
  if (list.includes('rejected_or_invalidated')) return 'rejected_or_invalidated';
  if (list.includes('issuer_exposure_attached')) return 'issuer_exposure_attached';
  if (list.includes('direct_node_exposure_attached')) return 'direct_node_exposure_attached';
  if (list.includes('market_attached')) return 'market_attached';
  if (list.includes('probable_exposure')) return 'probable_exposure';
  if (list.includes('exposure_collecting')) return 'exposure_collecting';
  if (list.includes('suppressed_consensus_issuer')) return 'suppressed_consensus_issuer';
  if (list.includes('frontier_node_candidate')) return 'frontier_node_candidate';
  if (list.includes('candidate')) return 'candidate';
  return 'issuer_candidate_unverified';
}

function candidateWhyRelated(row = {}) {
  const terms = asArray(row.sourceTerms).slice(0, 4).join(', ');
  const sources = asArray(row.sourceTypes).slice(0, 3).join(', ');
  const basis = terms || sources || 'report source context';
  if (row.status === 'direct_node_exposure_attached') {
    return `${row.role.replace(/_/g, ' ')} direct node exposure from ${basis}`;
  }
  if (row.status === 'probable_exposure') {
    return `${row.role.replace(/_/g, ' ')} probable exposure from repeated ${basis}`;
  }
  if (row.status === 'frontier_node_candidate') {
    return `${row.role.replace(/_/g, ' ')} frontier-node collection candidate from ${basis}`;
  }
  if (row.status === 'suppressed_consensus_issuer') {
    return `${row.role.replace(/_/g, ' ')} consensus issuer suppressed until direct node exposure attaches`;
  }
  return `${row.role.replace(/_/g, ' ')} candidate from ${basis}`;
}

function nextValidation(row = {}) {
  if (row.status === 'issuer_exposure_attached' || row.status === 'direct_node_exposure_attached') {
    return 'validate same-symbol market sensitivity and economics.';
  }
  if (row.status === 'probable_exposure') {
    return 'attach direct SEC/IR/transcript/contract exposure before any actionability or market bridge promotion.';
  }
  if (row.status === 'frontier_node_candidate') {
    return 'collect direct frontier-node exposure from filings, IR, contracts, or official provider evidence before bridge promotion.';
  }
  if (row.status === 'suppressed_consensus_issuer') {
    return 'keep out of the discovery headline until direct node evidence ties the issuer to the narrow bottleneck.';
  }
  if (row.status === 'rejected_or_invalidated') return 'do not promote unless contrary direct evidence appears.';
  return 'collect SEC/IR/transcript/contract evidence for direct exposure before promotion.';
}

function promotedStatusForCandidate({ status = '', role = 'unclear', confidence = 0, sourceTypes = [] } = {}) {
  if ([
    'issuer_exposure_attached',
    'direct_node_exposure_attached',
    'market_attached',
    'rejected_or_invalidated',
    'suppressed_consensus_issuer',
  ].includes(status)) return status;
  if (role === 'unclear') return status;
  const sources = new Set(asArray(sourceTypes).map((item) => String(item || '')));
  const hasCollectionRoute = sources.has('provider_route_plan') || sources.has('candidate_universe') || sources.has('report_candidate_universe');
  const hasBodyOrOntologySignal = sources.has('article') || sources.has('evidence_row') || sources.has('theme_ontology');
  const hasRepeatedDiscovery = sourceTypes.length >= 3 && confidence >= 0.68;
  if (status === 'frontier_node_candidate' && !hasRepeatedDiscovery) return status;
  if (hasCollectionRoute && hasBodyOrOntologySignal && hasRepeatedDiscovery) return 'probable_exposure';
  return status;
}

function collectExplicitFields(value, add, detail = {}, depth = 0) {
  if (!value || depth > 7) return;
  if (Array.isArray(value)) {
    for (const item of value) collectExplicitFields(item, add, detail, depth + 1);
    return;
  }
  if (typeof value !== 'object') return;
  const directSymbol = symbolCandidates(value).find(Boolean);
  if (directSymbol) {
    add(directSymbol, {
      ...detail,
      issuerName: value.company_name || value.companyName || value.entity_name || value.entityLabel || value.name || value.issuerName,
      relationType: value.relation_type || value.relationType,
      role: value.role || value.issuerBridgeRole || value.metadata?.role || value.metadata?.issuerBridgeRole || detail.role,
      status: value.status || value.metadata?.status || detail.status,
      evidenceRef: value.evidenceId || value.evidence_id || value.id || value.source_id,
    });
  }
  for (const [key, child] of Object.entries(value)) {
    if (SYMBOL_FIELD_PATTERN.test(key)) {
      for (const item of asArray(child)) {
        if (item && typeof item === 'object') {
          for (const symbol of symbolCandidates(item)) add(symbol, { ...detail, issuerName: item.companyName || item.company_name || item.name });
        } else {
          for (const symbol of symbolCandidates(item)) add(symbol, detail);
        }
      }
    } else if (child && typeof child === 'object' && !/marketValidation|marketReactions|matchedControls|eventUplift/i.test(key)) {
      collectExplicitFields(child, add, detail, depth + 1);
    }
  }
}

function desiredEvidenceClass(row = {}) {
  const metadata = row.metadata || {};
  return slug(row.desiredEvidenceClass || row.evidenceClass || metadata.desiredEvidenceClass || metadata.evidenceClass);
}

function evidenceUse(row = {}) {
  const metadata = row.metadata || {};
  return slug(row.evidenceUse || row.sourceQueryEvidenceUse || metadata.evidenceUse || metadata.sourceQueryEvidenceUse);
}

function directNodeEvidence(row = {}) {
  const metadata = row.metadata || {};
  return Boolean(
    metadata.directNodeExposure
    || metadata.directNodeBridge
    || metadata.frontierNodeEvidence
    || metadata.frontierNodeBridge
    || metadata.providerRoutePlan?.directNodeExposure
    || metadata.providerRoutePlan?.frontierNodeEvidence
  );
}

function promotionSymbolsFromRows(rows = [], options = {}) {
  const out = [];
  for (const row of asArray(rows)) {
    const klass = desiredEvidenceClass(row);
    const use = evidenceUse(row);
    const isDirect = ['issuer_exposure', 'issuer_commentary', 'primary_filing'].includes(klass)
      && use === 'promotion_candidate';
    if (!isDirect) continue;
    if (options.requireFrontierNodeHit && !directNodeEvidence(row) && !rowMentionsFrontierNode(row, options.bundle)) {
      continue;
    }
    out.push(...symbolCandidates(row.symbol || row.ticker || row.metadata?.symbol || row.metadata?.issuerSymbol));
  }
  return filterIssuerSymbols(out);
}

function symbolListFromConsensusItems(items = []) {
  return filterIssuerSymbols(asArray(items)
    .flatMap((item) => {
      if (!item || typeof item !== 'object') return symbolCandidates(item);
      return symbolCandidates(item.symbol || item.ticker || item.value || item.term || item.name || item);
    }));
}

function ontologySupplierCandidates(input = {}, textTerms = []) {
  const hints = themeHintsForIssuerDiscovery(input);
  const ontologyCoverage = input.ontologyCoverage || bundleFrom(input).metadata?.deepResearch?.ontologyPack || {};
  const ontologyKeys = new Set(asArray(ontologyCoverage.ontologyKey).concat(asArray(ontologyCoverage.matchedArchetypes)).map(slug));
  const text = compact(textTerms.join(' ')).toLowerCase();
  const rows = [];
  for (const hint of hints) {
    const ontology = resolveThemeOntology({ themeId: hint, themeLabel: hint, metadata: { theme: hint } });
    const primaryOntology = slug(ontology.key) === slug(ontologyCoverage.ontologyKey)
      || slug(ontology.label) === slug(ontologyCoverage.ontologyLabel);
    const ontologyIsActive = ontologyKeys.has(slug(ontology.key))
      || ontologyKeys.has(slug(ontology.label))
      || text.includes(String(ontology.key || '').replace(/_/g, ' '))
      || text.includes(String(ontology.label || '').toLowerCase())
      || !ontology.isGenericFallback;
    if (!ontologyIsActive || ontology.isGenericFallback) continue;
    for (const entry of discoveryEntriesForTheme({ themeId: hint, themeLabel: hint }, { ontology })) {
      const symbol = entry.symbol || entry.ticker;
      if (!symbol) continue;
      const entryTerms = unique([entry.name, ...asArray(entry.aliases), ...asArray(entry.triggerTerms), ontology.label, ontology.key]);
      const confidence = Math.min(0.9, Math.max(0.35, 0.48 + 0.32 * num(entry.importance, 0.65) + (primaryOntology ? 0.08 : -0.08)));
      rows.push({
        symbol,
        issuerName: entry.name,
        role: classifyIssuerRole({
          entry,
          sourceText: `${text} ${entry.name} ${entry.role} ${entry.mechanism}`,
          fallback: /supplier/i.test(entry.role) ? 'equipment_supplier' : 'unclear',
        }),
        sourceType: 'theme_ontology',
        sourceTerms: entryTerms,
        confidence,
        ontologyKey: ontology.key,
        primaryOntology,
        status: 'candidate',
      });
    }
  }
  return rows;
}

export function buildIssuerDiscoveryMap(input = {}) {
  const bundle = bundleFrom(input);
  const strictEndogenous = Boolean(input.strictEndogenous) || isStrictEndogenousBundle(bundle);
  const frontierParentScoped = isFrontierParentScopedBundle(bundle);
  const scopedDiscovery = strictEndogenous || frontierParentScoped;
  const adjacent = bundle.metadata?.adjacentCandidate || {};
  const adjacentMetadata = adjacent.metadata || {};
  const adjacentNonObvious = adjacentMetadata.nonObviousDiscovery || bundle.metadata?.nonObviousDiscovery || {};
  const rows = sourceRowsFrom(input);
  const sourceTerms = unique([
    ...asArray(input.sourceTerms),
    ...asArray(bundle.subject?.metadata?.discovery?.triggerTerms),
    ...asArray(bundle.subject?.metadata?.discovery?.sourceTerms),
    ...asArray(bundle.metadata?.adjacentCandidate?.source_terms),
    ...asArray(bundle.metadata?.adjacentCandidate?.seed_terms),
    ...asArray(bundle.metadata?.adjacentCandidate?.metadata?.sourceTerms),
    ...asArray(bundle.metadata?.adjacentCandidate?.metadata?.source_terms),
    ...asArray(bundle.metadata?.adjacentCandidate?.metadata?.evidenceQuotes),
    ...collectText(bundle.subject || {}),
    ...rows.flatMap((row) => collectText(row).slice(0, 4)),
  ]).slice(0, 36);
  const promotionEligibleSymbols = new Set(filterIssuerSymbols(unique([
    ...asArray(input.promotionEligibleSymbols),
    ...promotionSymbolsFromRows(rows, { requireFrontierNodeHit: frontierParentScoped, bundle }),
  ])));
  const suppressedConsensusSymbols = new Set(symbolListFromConsensusItems([
    ...asArray(input.suppressedConsensusSymbols),
    ...asArray(bundle.metadata?.suppressedConsensusSymbols),
    ...asArray(adjacentMetadata.suppressedConsensusSymbols),
    ...asArray(adjacentNonObvious.suppressedConsensusSymbols),
    ...asArray(adjacentMetadata.consensusProfile?.frequentSymbols),
    ...asArray(bundle.metadata?.consensusProfile?.frequentSymbols),
  ]));
  const candidates = new Map();
  const add = (symbol, detail = {}) => addCandidate(candidates, symbol, {
    sourceTerms,
    ...detail,
  });
  const candidateStatus = (symbol, sourceType = '', fallback = 'candidate') => {
    const [filtered] = filterIssuerSymbols(symbolCandidates(symbol));
    if (!scopedDiscovery || !filtered) return fallback;
    if (suppressedConsensusSymbols.has(filtered)) return 'suppressed_consensus_issuer';
    if (sourceType === 'theme_ontology' && (adjacentMetadata.frontierDiscovery || bundle.metadata?.frontierDiscovery)) {
      return 'suppressed_consensus_issuer';
    }
    return fallback;
  };

  for (const symbol of asArray(input.issuerUniverse)) {
    add(symbol, {
      sourceType: 'promotion_universe',
      status: promotionEligibleSymbols.has(String(symbol || '').toUpperCase()) ? 'issuer_exposure_attached' : 'candidate',
      confidence: 0.72,
    });
  }
  for (const symbol of asArray(input.candidateIssuerUniverse)) {
    add(symbol, { sourceType: 'candidate_universe', status: candidateStatus(symbol, 'candidate_universe', 'candidate'), confidence: 0.62 });
  }

  collectExplicitFields({
    ...(scopedDiscovery ? {} : {
      issuerUniverse: bundle.issuerUniverse,
      metadataIssuerUniverse: bundle.metadata?.issuerUniverse,
      candidateIssuerUniverse: bundle.metadata?.candidateIssuerUniverse,
      issuerUniverseSourceSymbols: bundle.metadata?.adjacentCandidate?.metadata?.issuerUniverseSourceSymbols,
      adjacentCandidateUniverse: bundle.metadata?.adjacentCandidate?.metadata?.candidateIssuerUniverse,
      subjectDiscovery: bundle.subject?.metadata?.discovery,
      existingIssuerDiscoveryMap: bundle.metadata?.issuerDiscoveryMap,
      deepIssuerDiscoveryRows: bundle.metadata?.deepResearch?.packs?.issuerDiscoveryPack?.rows,
      deepAutoIssuerRows: bundle.metadata?.deepResearch?.crossThemeActionBridge?.autoDiscoveredIssuers,
    }),
  }, add, { sourceType: 'report_candidate_universe', status: 'candidate', confidence: scopedDiscovery ? 0.5 : 0.58 });

  for (const row of rows) {
    const klass = desiredEvidenceClass(row);
    const use = evidenceUse(row);
    const issuerBridgeClass = ['issuer_exposure', 'issuer_commentary', 'primary_filing'].includes(klass);
    const marketBridgeClass = klass === 'market_validation';
    const collecting = issuerBridgeClass || marketBridgeClass;
    const nodeDirect = directNodeEvidence(row) && use === 'promotion_candidate';
    const officialNodeDirect = frontierParentScoped && frontierNodeDirectOfficialEvidence(row, bundle);
    const frontierCandidate = frontierParentScoped && frontierNodeCandidateEvidence(row, bundle);
    if (frontierParentScoped && !issuerBridgeClass && !marketBridgeClass && !nodeDirect && !officialNodeDirect && !frontierCandidate) {
      continue;
    }
    const direct = issuerBridgeClass
      && use === 'promotion_candidate'
      && (!frontierParentScoped || directNodeEvidence(row) || rowMentionsFrontierNode(row, bundle));
    const marketAttached = marketBridgeClass && use === 'promotion_candidate';
    const status = direct
      ? 'issuer_exposure_attached'
        : marketAttached
          ? 'market_attached'
      : (nodeDirect || officialNodeDirect)
        ? 'direct_node_exposure_attached'
      : frontierCandidate
        ? 'frontier_node_candidate'
      : (collecting ? 'exposure_collecting' : 'candidate');
    const explicitRow = (marketBridgeClass || frontierParentScoped)
      ? {
        symbol: row.symbol || row.ticker || row.metadata?.symbol || row.metadata?.issuerSymbol,
        issuerName: row.issuerName || row.companyName || row.metadata?.issuerName,
        evidenceId: row.id || row.source_id || row.metadata?.sourceId,
      }
      : row;
    collectExplicitFields(explicitRow, add, {
      sourceType: row.source_type || row.kind || row.metadata?.sourceProvider || 'evidence_row',
      status,
      confidence: direct || nodeDirect || officialNodeDirect || marketAttached ? 0.9 : (frontierCandidate ? 0.66 : (collecting ? 0.68 : 0.5)),
      sourceTerms: [
        row.title,
        row.topic,
        row.metadata?.providerRoutePlan?.evidenceClass,
        row.metadata?.desiredEvidenceClass,
        row.metadata?.frontierNode,
        row.metadata?.bottleneckNode,
        ...(frontierCandidate ? frontierNodeFamilyTerms(bundle).slice(0, 4) : []),
      ],
    });
    const route = row.metadata?.providerRoutePlan || row.providerRoutePlan || {};
    if (marketBridgeClass) continue;
    if (scopedDiscovery) continue;
    for (const symbol of [
      ...asArray(route.collectionUniverse),
      ...asArray(route.issuerUniverse),
      ...asArray(row.metadata?.issuerUniverse),
      ...asArray(row.metadata?.target?.issuerUniverseSymbols),
    ]) {
      add(symbol, {
        sourceType: 'provider_route_plan',
        status: collecting ? 'exposure_collecting' : candidateStatus(symbol, 'provider_route_plan', 'candidate'),
        confidence: collecting ? 0.64 : 0.5,
        sourceTerms: [route.evidenceClass || klass, row.title],
      });
    }
  }

  for (const ontologyCandidate of ontologySupplierCandidates(input, sourceTerms)) {
    add(ontologyCandidate.symbol, {
      ...ontologyCandidate,
      status: candidateStatus(ontologyCandidate.symbol, 'theme_ontology', ontologyCandidate.status || 'candidate'),
    });
  }

  const out = [...candidates.values()].map((item) => {
    const role = roleConsensus(item.roleVotes);
    const sourceTypes = [...item.sourceTypes].filter(Boolean);
    const status = promotionEligibleSymbols.has(item.symbol)
      ? 'issuer_exposure_attached'
      : statusConsensus(item.statuses, promotionEligibleSymbols);
    const confidence = Math.max(
      item.confidence,
      status === 'issuer_exposure_attached' ? 0.9 : 0,
      sourceTypes.length >= 2 ? 0.7 : 0,
    );
    const finalStatus = promotedStatusForCandidate({
      status,
      role,
      confidence,
      sourceTypes,
    });
    const row = {
      symbol: item.symbol,
      issuerName: item.issuerName || item.symbol,
      role,
      confidence: Math.round(Math.max(0, Math.min(1, confidence)) * 1000) / 1000,
      primaryOntology: item.details.some((detail) => detail.primaryOntology),
      sourceTerms: [...item.sourceTerms].slice(0, 8),
      evidenceRefs: [...item.evidenceRefs].slice(0, 8),
      sourceTypes: sourceTypes.slice(0, 8),
      status: finalStatus,
      candidateOnly: finalStatus !== 'issuer_exposure_attached'
        && finalStatus !== 'direct_node_exposure_attached'
        && finalStatus !== 'market_attached',
      promotionEligible: finalStatus === 'issuer_exposure_attached' || finalStatus === 'direct_node_exposure_attached',
    };
    return {
      ...row,
      whyRelated: candidateWhyRelated(row),
      nextValidation: nextValidation(row),
    };
  }).sort((a, b) => {
    const directStatus = (row) => row.status === 'issuer_exposure_attached' || row.status === 'direct_node_exposure_attached';
    const directDelta = Number(directStatus(b)) - Number(directStatus(a));
    if (directDelta) return directDelta;
    const clarityDelta = Number(a.role === 'unclear') - Number(b.role === 'unclear');
    if (clarityDelta) return clarityDelta;
    const primaryDelta = Number(b.primaryOntology) - Number(a.primaryOntology);
    if (primaryDelta) return primaryDelta;
    return b.confidence - a.confidence
      || roleRank(a.role) - roleRank(b.role)
      || statusRank(a.status) - statusRank(b.status)
      || a.symbol.localeCompare(b.symbol);
  });

  return out;
}

export function groupIssuerDiscoveryMap(rows = []) {
  const groups = new Map();
  for (const row of asArray(rows)) {
    const role = ISSUER_DISCOVERY_ROLES.includes(row.role) ? row.role : 'unclear';
    if (!groups.has(role)) groups.set(role, []);
    groups.get(role).push(row);
  }
  return [...groups.entries()]
    .sort((a, b) => roleRank(a[0]) - roleRank(b[0]))
    .map(([role, issuers]) => ({
      role,
      issuers: issuers.slice().sort((a, b) => b.confidence - a.confidence || a.symbol.localeCompare(b.symbol)),
    }));
}

export function candidateIssuerUniverseFromMap(rows = []) {
  return filterIssuerSymbols(unique(asArray(rows).map((row) => row.symbol)));
}

export function issuerDiscoverySummary(rows = []) {
  const list = asArray(rows);
  const bridgeAttachedCount = list.filter((row) => row.status === 'issuer_exposure_attached' || row.status === 'direct_node_exposure_attached').length;
  const directNodeBridgeCount = list.filter((row) => row.status === 'direct_node_exposure_attached').length;
  const marketAttachedCount = list.filter((row) => row.status === 'market_attached').length;
  const probableExposureCount = list.filter((row) => row.status === 'probable_exposure').length;
  const suppressedConsensusCount = list.filter((row) => row.status === 'suppressed_consensus_issuer').length;
  const frontierNodeCandidateCount = list.filter((row) => row.status === 'frontier_node_candidate').length;
  const candidateCount = list.filter((row) => row.candidateOnly).length;
  return {
    version: ISSUER_DISCOVERY_VERSION,
    candidateIssuerCount: candidateCount,
    probableExposureCount,
    frontierNodeCandidateCount,
    suppressedConsensusCount,
    bridgeAttachedCount,
    directNodeBridgeCount,
    marketAttachedCount,
    issuerMappingGapCount: Math.max(0, candidateCount - bridgeAttachedCount),
    roles: groupIssuerDiscoveryMap(list).map((group) => ({
      role: group.role,
      count: group.issuers.length,
    })),
    boundary: 'candidate and probable-exposure issuers are collection targets and report context; they do not raise actionability until direct issuer evidence attaches.',
  };
}

export const __test = {
  normalizeThemeHint,
  themeHintsForIssuerDiscovery,
  classifyIssuerRole,
  promotionSymbolsFromRows,
  frontierNodeTerms,
  frontierNodeFamilyTerms,
  rowMentionsFrontierNode,
  rowMentionsFrontierFamily,
  frontierNodeCandidateEvidence,
  rowText,
};
