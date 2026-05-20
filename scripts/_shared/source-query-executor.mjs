import {
  ensureResearchOsSchema,
  normalizeKnowledgeKey,
  stableResearchOsId,
  upsertKnowledgeEdge,
  upsertKnowledgeEdgeEvidence,
  upsertKnowledgeNode,
} from './adjacency-graph.mjs';
import { collectEvidenceForQuestion, persistEvidenceBundles } from './evidence-collector.mjs';
import { loadResearchOsPolicy, requirePolicyNumber } from './research-os-policy.mjs';
import { ensureAutomationSchema } from './schema-automation.mjs';
import {
  buildEvidenceClassQueryVariants,
  evidenceClassCueHit as universalEvidenceClassCueHit,
  inferEvidenceClassFromText,
} from './universal-evidence-contract.mjs';
import {
  buildProviderQueryVariants,
  routeEvidenceProvider,
} from './evidence-provider-router.mjs';
import { evaluateEvidenceClassAcceptance } from './evidence-class-playbooks.mjs';
import { collectorCapability } from './collector-capability-matrix.mjs';
import { recordOperatorSeedEvidenceOutcome } from './operator-research-seeds.mjs';

function compact(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function uniqueStrings(values = []) {
  const seen = new Set();
  const out = [];
  for (const value of values || []) {
    const text = compact(value);
    if (!text) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(text);
  }
  return out;
}

async function runLimited(items = [], concurrency = 1, worker = async (item) => item) {
  const list = asArray(items);
  const limit = Math.max(1, Math.min(list.length || 1, Math.floor(Number(concurrency || 1))));
  const results = new Array(list.length);
  let nextIndex = 0;
  async function runWorker() {
    while (nextIndex < list.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await worker(list[index], index);
    }
  }
  await Promise.all(Array.from({ length: limit }, () => runWorker()));
  return results;
}

function normalizeText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9\s/-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function lowerRaw(value) {
  return String(value || '').toLowerCase();
}

function operatorSeedIdsFromOptions(options = {}) {
  return uniqueStrings(options.operatorSeedIds || options.operatorSeedId || []);
}

function operatorSeedFilterEnabled(options = {}) {
  return Boolean(options.operatorSeedCreatedOnly) || operatorSeedIdsFromOptions(options).length > 0;
}

export function sourceQueryApprovalBlocker(approval = {}) {
  const payload = approval.payload || {};
  const subject = payload.subject && typeof payload.subject === 'object' ? payload.subject : {};
  const raw = [
    payload.query,
    payload.subjectKey,
    ...(Array.isArray(payload.themes) ? payload.themes : []),
    subject.subjectType,
    subject.subjectId,
    subject.displayName,
  ].map(lowerRaw).join(' ');

  if (lowerRaw(subject.subjectType) === 'no_bound_candidate') {
    return 'no-bound-candidate-subject';
  }
  if (lowerRaw(subject.subjectId).startsWith('no-match-')) {
    return 'no-bound-candidate-subject';
  }
  if (raw.includes('no-match-') || raw.includes('no theme report bound to') || raw.includes('no bound candidate')) {
    return 'no-bound-candidate-query';
  }
  return null;
}

export function isInvalidSourceQueryApproval(approval = {}) {
  return Boolean(sourceQueryApprovalBlocker(approval));
}

function splitThemeTerms(theme) {
  const normalized = normalizeText(theme).replace(/-/g, ' ');
  return uniqueStrings([theme, normalized, ...normalized.split(' ').filter((part) => part.length >= 4)]);
}

function isNumericIdentifier(value) {
  return /^\d+$/.test(String(value || '').trim());
}

function evidenceThemes(payload = {}, candidate = null) {
  return uniqueStrings([
    ...(Array.isArray(candidate?.themes) ? candidate.themes : []),
    ...(Array.isArray(payload.themes) ? payload.themes : []),
  ]).filter((theme) => !isNumericIdentifier(theme));
}

function extractQueryTerms(query) {
  const quoted = [...String(query || '').matchAll(/"([^"]+)"/g)].map((match) => match[1]);
  const words = normalizeText(query)
    .split(' ')
    .filter((word) => word.length >= 4)
    .filter((word) => !['evidence', 'supplier', 'bottleneck', 'manufacturer', 'supply', 'chain', 'direct', 'capacity', 'customer', 'product'].includes(word));
  return uniqueStrings([...quoted, ...words]).slice(0, 18);
}

function quoteQueryTerm(value) {
  const text = compact(value).replace(/"/g, '');
  if (!text) return '';
  return text.includes(' ') ? `"${text}"` : text;
}

function queryThemeTerm(theme) {
  const normalized = normalizeText(theme).replace(/-/g, ' ');
  if (!normalized) return '';
  if (/defense/.test(normalized)) return 'defense';
  if (/space/.test(normalized)) return 'space';
  return normalized
    .split(' ')
    .filter((part) => part.length >= 4)
    .slice(0, 2)
    .join(' ');
}

function candidateDiscoverySourceQueries(candidate = null) {
  return uniqueStrings([
    ...(Array.isArray(candidate?.evidence_summary?.discovery?.sourceQueries) ? candidate.evidence_summary.discovery.sourceQueries : []),
    ...(Array.isArray(candidate?.metadata?.discovery?.sourceQueries) ? candidate.metadata.discovery.sourceQueries : []),
    ...(Array.isArray(candidate?.discovery?.sourceQueries) ? candidate.discovery.sourceQueries : []),
  ]);
}

function queryHasPrimaryTarget(query, payload = {}, candidate = null) {
  const normalized = normalizeText(query);
  return approvalPrimaryTerms({
    ...payload,
    connector: payload.connector || candidate?.connector_name,
    supplier: payload.supplier || candidate?.supplier_name,
    target: payload.target || candidate?.connector_name || candidate?.supplier_name,
  }).some((term) => textIncludes(normalized, term));
}

function retryAttemptFromPayload(payload = {}) {
  return Number(payload.repair?.attempt || payload.retryAttempt || 0);
}

function payloadSubjectDisplay(payload = {}) {
  const subject = payload.subject && typeof payload.subject === 'object' ? payload.subject : {};
  return compact(payload.target || subject.displayName || '');
}

function payloadSubjectKeyTerm(payload = {}) {
  const subject = payload.subject && typeof payload.subject === 'object' ? payload.subject : {};
  const raw = compact(payload.subjectKey || subject.subjectId || '');
  if (!raw || /^\d+$/.test(raw) || raw.toLowerCase().startsWith('no-match-')) return '';
  return raw;
}

function approvalPrimaryTerms(payload = {}) {
  const rawTerms = uniqueStrings([
    payload.supplier,
    payload.connector,
    payloadSubjectDisplay(payload),
    payloadSubjectKeyTerm(payload),
  ]).filter((term) => !sourceQueryApprovalBlocker({ payload: { ...payload, query: term } }));
  const expanded = [];
  for (const term of rawTerms) {
    expanded.push(term);
    const normalized = normalizeText(term);
    const withoutQualifiers = normalized
      .split(' ')
      .filter((part) => !['capacity', 'supplier', 'bottleneck', 'evidence', 'constraint', 'candidate'].includes(part))
      .join(' ')
      .trim();
    if (withoutQualifiers && withoutQualifiers !== normalized) expanded.push(withoutQualifiers);
    const words = withoutQualifiers.split(' ').filter(Boolean);
    if (words.length >= 3) expanded.push(words.slice(0, 3).join(' '));
    if (words.length >= 2 && words.includes('motor')) expanded.push(words.slice(Math.max(0, words.indexOf('motor') - 1), words.indexOf('motor') + 1).join(' '));
  }
  return uniqueStrings([
    ...expanded,
  ]);
}

function targetLabel(payload = {}, candidate = null) {
  return compact(
    payload.supplier
    || payload.connector
    || payload.target
    || payloadSubjectDisplay(payload)
    || candidate?.supplier_name
    || candidate?.connector_name
    || extractQueryTerms(payload.query)[0],
  );
}

function classifySourceQueryFailure({
  collectedCount = 0,
  externalCollectedCount = 0,
  acceptedBundleCount = 0,
  persistedBundleCount = 0,
  contextBundleCount = 0,
  negativeControlCount = 0,
  noiseCount = 0,
  edgeCount = 0,
  directEvidenceCount = 0,
  externalError = null,
} = {}) {
  if (acceptedBundleCount > 0 && edgeCount > 0) return 'resolved';
  if (acceptedBundleCount > 0 && edgeCount === 0) return 'accepted-bundles-no-edge';
  if (directEvidenceCount <= 0 && acceptedBundleCount > 0) return 'low-directness';
  if (negativeControlCount > 0) return 'negative-control-collected';
  if (contextBundleCount > 0) return 'context-collected';
  if (persistedBundleCount > 0 || noiseCount > 0) return 'weak-noise-only';
  if (collectedCount + externalCollectedCount <= 0) return externalError ? 'source-fetch-failed' : 'no-results';
  return 'low-relevance';
}

function fallbackTechnicalTerms(payload = {}, policy = loadResearchOsPolicy()) {
  const text = normalizeText([
    payload.query,
    payload.supplier,
    payload.connector,
    ...(payload.themes || []),
  ].filter(Boolean).join(' '));
  const cues = (policy.relationExtraction?.technicalCueTerms || [])
    .filter((term) => {
      const normalized = normalizeText(term);
      return normalized && (text.includes(normalized) || normalized.split(' ').some((part) => part.length >= 5 && text.includes(part)));
    });
  return uniqueStrings(cues);
}

export function buildSourceQueryRetryVariants(approval = {}, candidate = null, policy = loadResearchOsPolicy()) {
  const payload = approval.payload || {};
  const desiredEvidenceClass = desiredEvidenceClassFromPayload(payload);
  const target = targetLabel(payload, candidate);
  const themes = evidenceThemes(payload, candidate);
  const connector = compact(payload.connector || candidate?.connector_name);
  const supplier = compact(payload.supplier || candidate?.supplier_name);
  const queryTerms = extractQueryTerms(payload.query);
  const providerRoutePlan = providerRoutePlanFromPayload(payload, candidate, {
    desiredEvidenceClass,
    target,
    themes,
  });
  const routeSpecificVariants = buildProviderQueryVariants({
    providerRoutePlan,
    evidenceClass: desiredEvidenceClass,
    query: '',
    subject: payloadSubjectDisplay(payload) || payload.subjectKey || target,
    target,
    themes,
    issuerUniverse: [
      ...(Array.isArray(payload.issuerHints) ? payload.issuerHints : []),
      ...(Array.isArray(payload.symbols) ? payload.symbols : []),
      ...(Array.isArray(payload.issuerUniverse) ? payload.issuerUniverse : []),
      ...(Array.isArray(payload.target?.issuerUniverseSymbols) ? payload.target.issuerUniverseSymbols : []),
    ],
  });
  const maxTerms = Math.max(1, requirePolicyNumber(policy, 'sourceExpansion.retry.maxRewriteTerms'));
  const technicalTerms = fallbackTechnicalTerms(payload, policy).slice(0, maxTerms);
  const primaryTerms = approvalPrimaryTerms({
    ...payload,
    connector: connector || payload.connector,
    supplier: supplier || payload.supplier,
    target: target || payload.target,
  });
  const targetCore = primaryTerms.find((term) => normalizeText(term).split(' ').length <= 3) || target || supplier || connector || queryTerms[0];
  const targetTerm = quoteQueryTerm(targetCore);
  const targetFullTerm = quoteQueryTerm(target || targetCore);
  const themeText = themes.slice(0, 2).map(queryThemeTerm).filter(Boolean).join(' ');
  const connectorTerm = quoteQueryTerm(connector);
  const supplierTerm = quoteQueryTerm(supplier);
  const technicalText = technicalTerms.slice(0, maxTerms).map(quoteQueryTerm).filter(Boolean).join(' ');
  const domainQueries = uniqueStrings([
    payload.originalQuery,
    ...candidateDiscoverySourceQueries(candidate),
  ]).filter((query) => queryHasPrimaryTarget(query, payload, candidate));
  const secondaryAnchor = uniqueStrings([supplierTerm, connectorTerm, targetFullTerm])
    .find((term) => normalizeText(term) !== normalizeText(targetTerm));
  const legacyEvidenceClasses = new Set([
    'supplier_capacity',
    'technical_qualification',
    'procurement_trigger',
    'substitution_limit',
    'issuer_exposure',
    'negative_control',
  ]);
  const classSpecificVariants = (() => {
    if (!legacyEvidenceClasses.has(desiredEvidenceClass)) {
      return buildEvidenceClassQueryVariants({
        subject: payloadSubjectDisplay(payload) || payload.subjectKey || target,
        evidenceClass: desiredEvidenceClass,
        issuerUniverse: uniqueStrings([
          ...(Array.isArray(payload.issuerHints) ? payload.issuerHints : []),
          ...(Array.isArray(payload.symbols) ? payload.symbols : []),
          ...(Array.isArray(payload.issuerUniverse) ? payload.issuerUniverse : []),
        ]),
        themes,
        target,
      });
    }
    switch (desiredEvidenceClass) {
      case 'technical_qualification':
        return [
          [targetTerm, '"qualified supplier"', '"energetic materials"', '"missile production"'].filter(Boolean).join(' '),
          [targetTerm, 'qualification certification propellant test firing supplier'].filter(Boolean).join(' '),
          [targetTerm, 'certified supplier energetic propellant production evidence'].filter(Boolean).join(' '),
        ];
      case 'substitution_limit':
        return [
          [targetTerm, 'chemical chokepoint supply-chain bottleneck qualification constraint'].filter(Boolean).join(' '),
          [targetTerm, '"sole source"', '"limited suppliers"', '"hard to substitute"'].filter(Boolean).join(' '),
          [targetTerm, 'single source qualified supplier substitution bottleneck'].filter(Boolean).join(' '),
        ];
      case 'negative_control':
        return [
          [targetTerm, '"easy substitutes"', '"supplier redundancy"', '"no capacity constraint"'].filter(Boolean).join(' '),
          [targetTerm, '"alternative suppliers"', '"no procurement timing"', '"non-qualified supplier"'].filter(Boolean).join(' '),
          [targetTerm, 'redundant capacity substitute suppliers no bottleneck'].filter(Boolean).join(' '),
        ];
      case 'procurement_trigger':
        return [
          [targetTerm, 'procurement contract award funding budget program'].filter(Boolean).join(' '),
          [targetTerm, 'Pentagon DoD investment contract award missile production'].filter(Boolean).join(' '),
        ];
      case 'issuer_exposure':
        return [
          [targetTerm, 'issuer exposure revenue segment guidance backlog book-to-bill'].filter(Boolean).join(' '),
          [targetTerm, 'L3Harris Aerojet Northrop backlog guidance rocket motor'].filter(Boolean).join(' '),
        ];
      case 'supplier_capacity':
      default:
        return [
          [targetTerm, themeText, technicalText, 'production capacity supplier evidence'].filter(Boolean).join(' '),
          [targetTerm, secondaryAnchor, 'capacity expansion production facility supplier'].filter(Boolean).join(' '),
        ];
    }
  })();
  const variants = desiredEvidenceClass === 'supplier_capacity' ? [
    ...domainQueries,
    ...routeSpecificVariants,
    ...classSpecificVariants,
    [targetTerm, themeText, technicalText, 'production capacity supplier evidence'].filter(Boolean).join(' '),
    [targetTerm, secondaryAnchor, 'qualified supplier technical production evidence'].filter(Boolean).join(' '),
    [targetTerm, themeText, 'annual report backlog supplier evidence'].filter(Boolean).join(' '),
    [targetFullTerm, ...queryTerms.slice(0, Math.max(1, maxTerms - 1)).map(quoteQueryTerm), 'technical supplier'].filter(Boolean).join(' '),
  ] : [
    ...routeSpecificVariants,
    ...classSpecificVariants,
    ...domainQueries,
    [targetTerm, themeText, technicalText, 'production capacity supplier evidence'].filter(Boolean).join(' '),
    [targetTerm, secondaryAnchor, 'qualified supplier technical production evidence'].filter(Boolean).join(' '),
    [targetTerm, themeText, 'annual report backlog supplier evidence'].filter(Boolean).join(' '),
    [targetFullTerm, ...queryTerms.slice(0, Math.max(1, maxTerms - 1)).map(quoteQueryTerm), 'technical supplier'].filter(Boolean).join(' '),
  ];
  const variantLimit = Math.max(1, requirePolicyNumber(policy, 'sourceExpansion.retry.queryVariantsPerFailure'));
  return uniqueStrings(variants)
    .filter((query) => normalizeText(query) !== normalizeText(payload.query))
    .filter((query) => !hasRepeatedTargetPhrase(query, targetCore))
    .slice(0, variantLimit);
}

function hasRepeatedTargetPhrase(query = '', target = '') {
  const normalizedTarget = normalizeText(target);
  if (!normalizedTarget || normalizedTarget.split(' ').length < 3) return false;
  const normalizedQuery = normalizeText(query);
  let count = 0;
  let idx = normalizedQuery.indexOf(normalizedTarget);
  while (idx !== -1) {
    count += 1;
    if (count > 1) return true;
    idx = normalizedQuery.indexOf(normalizedTarget, idx + normalizedTarget.length);
  }
  return false;
}

export function repairSourceQueryApprovalPayload(approval = {}, candidate = null, policy = loadResearchOsPolicy()) {
  const payload = approval.payload || {};
  const maxAttempts = Math.max(0, requirePolicyNumber(policy, 'sourceExpansion.retry.maxAttempts'));
  const attempt = retryAttemptFromPayload(payload);
  const variants = buildSourceQueryRetryVariants(approval, candidate, policy);
  if (!variants.length || attempt >= maxAttempts) {
    return {
      payload,
      changed: false,
      exhausted: attempt >= maxAttempts,
      attempt,
      suggestedQueries: variants,
    };
  }
  const nextQuery = variants[attempt % variants.length];
  return {
    payload: {
      ...payload,
      originalQuery: payload.originalQuery || payload.query || '',
      query: nextQuery,
      repair: {
        ...(payload.repair || {}),
        attempt: attempt + 1,
        maxAttempts,
        previousQuery: payload.query || '',
        rewrittenAt: new Date().toISOString(),
        strategy: 'target-theme-technical-evidence-rewrite',
        suggestedQueries: variants,
      },
    },
    changed: nextQuery !== payload.query,
    exhausted: false,
    attempt: attempt + 1,
    suggestedQueries: variants,
  };
}

function textIncludes(text, term) {
  const normalizedTerm = normalizeText(term);
  if (!normalizedTerm) return false;
  return text.includes(normalizedTerm);
}

function bundleText(bundle = {}) {
  return normalizeText([
    bundle.title,
    bundle.textExcerpt || bundle.text_excerpt,
    bundle.sourceType || bundle.source_type,
    bundle.url,
    bundle.metadata?.source,
    bundle.metadata?.sourceProvider,
    bundle.metadata?.provider,
    bundle.metadata?.publisher,
    bundle.metadata?.url,
    bundle.metadata?.theme,
  ].filter(Boolean).join(' '));
}

const EVIDENCE_USE_RANK = {
  promotion_candidate: 5,
  negative_control_candidate: 4,
  supporting_context: 3,
  weak_noise: 2,
  rejected: 1,
};

function desiredEvidenceClassFromPayload(payload = {}, query = payload.query) {
  const explicit = compact(payload.desiredEvidenceClass || payload.evidenceClass || payload.metadata?.desiredEvidenceClass || payload.metadata?.evidenceClass);
  if (explicit) return explicit;
  const text = normalizeText([
    payload.originalQuery,
    payload.repair?.previousQuery,
    query,
  ].filter(Boolean).join(' '));
  if (/\b(hard to substitute|sole source|single source|substitution limit)\b/i.test(text)) return 'substitution_limit';
  if (/\b(easy substitutes?|supplier redundancy|no capacity constraint|non-qualified supplier|no procurement timing|negative control)\b/i.test(text)) return 'negative_control';
  if (/\b(qualified|qualification|certification|technical|energetic|propellant|test)\b/i.test(text)) return 'technical_qualification';
  if (/\b(procurement|contract|award|funding|budget|program|appropriation)\b/i.test(text)) return 'procurement_trigger';
  if (/\b(substitute|alternative|redundancy|sole source|single source|hard to substitute)\b/i.test(text)) return 'substitution_limit';
  if (/\b(capex|capital expenditure|capital spending|capital allocation|infrastructure spending|buildout)\b/i.test(text)) return 'capex_confirmation';
  if (/\b(power demand|grid interconnection|electricity|cooling|energy bottleneck|megawatt|mw)\b/i.test(text)) return 'power_constraint';
  if (/\b(cloud revenue|cloud demand|ai cloud|workload monetization)\b/i.test(text)) return 'cloud_revenue';
  if (/\b(compute demand|accelerator|gpu|workload|inference|training)\b/i.test(text)) return 'compute_demand';
  if (/\b(event study|abnormal return|relative return|benchmark|factor|regime|t-stat|t stat)\b/i.test(text)) return 'market_validation';
  if (/\b(10-k|10-q|8-k|m[ .]?d[ .]?a|risk factor|annual report|quarterly report)\b/i.test(text)) return 'primary_filing';
  if (/\b(earnings call|management commentary|transcript|ceo|cfo)\b/i.test(text)) return 'issuer_commentary';
  if (/\b(issuer|exposure|revenue|segment|guidance|backlog|book-to-bill|book to bill)\b/i.test(text)) return 'issuer_exposure';
  const inferred = inferEvidenceClassFromText(text);
  if (inferred) return inferred;
  return 'supplier_capacity';
}

function providerRoutePlanFromPayload(payload = {}, candidate = null, hints = {}) {
  if (payload.providerRoutePlan && typeof payload.providerRoutePlan === 'object' && !Array.isArray(payload.providerRoutePlan)) {
    return payload.providerRoutePlan;
  }
  const desiredEvidenceClass = hints.desiredEvidenceClass || desiredEvidenceClassFromPayload(payload);
  const target = hints.target || targetLabel(payload, candidate);
  const themes = hints.themes || evidenceThemes(payload, candidate);
  return routeEvidenceProvider({
    evidenceClass: desiredEvidenceClass,
    providerRoute: payload.providerRoute || payload.metadata?.providerRoute || payload.evidenceContract?.providerRoute,
    query: payload.query,
    subject: payloadSubjectDisplay(payload) || payload.subjectKey || target,
    target,
    themes,
    ontologyKey: payload.ontologyKey || payload.evidenceContract?.ontologyKey || payload.metadata?.ontologyKey,
    ontologyKeys: payload.ontologyKeys || payload.evidenceContract?.ontologyKeys,
    issuerUniverse: [
      ...(Array.isArray(payload.issuerHints) ? payload.issuerHints : []),
      ...(Array.isArray(payload.symbols) ? payload.symbols : []),
      ...(Array.isArray(payload.issuerUniverse) ? payload.issuerUniverse : []),
      ...(Array.isArray(payload.target?.issuerUniverseSymbols) ? payload.target.issuerUniverseSymbols : []),
    ],
    metadata: payload.metadata || {},
  });
}

function evidenceClassCueHit(evidenceClass, text = '') {
  if (universalEvidenceClassCueHit(evidenceClass, text)) return true;
  switch (String(evidenceClass || '').trim()) {
    case 'negative_control':
      return /\b(easy substitutes?|supplier redundancy|no capacity constraint|non-qualified supplier|no procurement timing|limited qualified substitutes?|no near-term|hard to substitute|alternative suppliers?|redundant capacity)\b/i.test(text);
    case 'technical_qualification':
      return /\b(qualified|qualification|certification|certified|technical|nozzle|energetic|propellant|material|specification|test(?:ed|s|ing)?|test firing|developed|development|certification)\b/i.test(text);
    case 'procurement_trigger':
      return /\b(procurement|contract|award|funding|budget|dod|pentagon|program|appropriation|solicitation|invest|investment)\b/i.test(text);
    case 'policy_funding':
      return /\b(policy|funding|budget|appropriation|authorization|program element|budget justification|government|federal)\b/i.test(text);
    case 'mission_award':
      return /\b(mission|launch|program|contract|award|task order|agreement|ground systems|range operations|space force|nasa)\b/i.test(text);
    case 'launch_manifest':
      return /\b(launch cadence|launch manifest|launch operations|spaceport|range|mission|payload|backlog)\b/i.test(text);
    case 'propulsion_constraint':
      return /\b(propellant|cryogenic|lox|liquid oxygen|liquid hydrogen|helium|fueling|fuel farm|propellant loading|ground support equipment)\b/i.test(text);
    case 'substitution_limit':
      return /\b(substitute|substitution|alternative|redundancy|single source|sole source|limited suppliers?|hard to substitute|no near-term|chokepoint|bottleneck|supply[- ]?chain constraint|chemical constraint|qualification constraint)\b/i.test(text);
    case 'issuer_exposure':
      return /\b(revenue|segment|guidance|issuer|exposure|margin|backlog|book-to-bill|book to bill|lmt|rtx|noc|gd|lhx|northrop|aerojet|l3harris|lockheed|raytheon)\b/i.test(text);
    case 'supplier_capacity':
    default:
      return /\b(capacity|facility|plant|factory|production|throughput|line|supplier|manufacturer|expansion)\b/i.test(text);
  }
}

function officialProcurementCueHit(bundle = {}, text = bundleText(bundle)) {
  const sourceText = normalizeText([
    bundle.sourceType || bundle.source_type,
    bundle.url,
    bundle.metadata?.source,
    bundle.metadata?.sourceProvider,
    bundle.metadata?.provider,
    bundle.metadata?.publisher,
    bundle.metadata?.url,
  ].filter(Boolean).join(' '));
  const officialSource = /\b(usaspending|defense\.gov|war\.gov|dod|department of defense|pentagon|sam\.gov|spaceforce\.mil|ssc\.spaceforce\.mil|nasa\.gov|budget justification|appropriation|procurement budget|contract award|contract obligation)\b/i.test(sourceText);
  const officialText = /\b(usaspending|defense\.gov|war\.gov|dod|department of defense|space force|nasa|budget justification|appropriation|contract award|contract obligation|procurement line item|program element|award amount|obligation|agreement)\b/i.test(text);
  const programText = /\b(PAC-3|THAAD|GMLRS|PrSM|SM-6|interceptor|missile|munition|solid rocket motor|rocket motor|space force|nasa|launch|range|ground system|procurement|contract|award|funding|budget|agreement)\b/i.test(text);
  const procurementDetail = officialText || /\b(procurement|contract|award|funding|budget|obligation|program)\b/i.test(text);
  return officialSource && programText && procurementDetail;
}

function negativeControlFinding(text = '') {
  if (/\b(hard to substitute|substitutes? remain difficult|limited qualified suppliers?|limited supplier redundancy|no near-term supplier redundancy|sole source|single source|qualification constraint|capacity constrained|demand exceeds supply|supply shortage)\b/i.test(text)) {
    return 'supported_constraint';
  }
  if (/\b(easy substitutes?|alternative suppliers?|supplier redundancy|redundant capacity|no capacity constraint|no shortage|ample capacity|no bottleneck)\b/i.test(text)) {
    return 'invalidator';
  }
  return 'checked_no_direct';
}

function negativeControlFindingCounts(bundles = []) {
  const counts = {};
  for (const bundle of bundles || []) {
    if (bundle.desiredEvidenceClass !== 'negative_control') continue;
    if (bundle.evidenceUse !== 'negative_control_candidate') continue;
    const finding = bundle.negativeControlFinding || 'checked_no_direct';
    counts[finding] = (counts[finding] || 0) + 1;
  }
  return counts;
}

function negativeControlClosureForBundles(bundles = [], evidenceClass = '') {
  if (String(evidenceClass || '') !== 'negative_control') return null;
  const candidateCounts = negativeControlFindingCounts(bundles);
  if ((candidateCounts.invalidator || 0) > 0) return 'invalidator';
  if ((candidateCounts.supported_constraint || 0) > 0) return 'supported_constraint';
  if ((candidateCounts.checked_no_direct || 0) > 0) return 'checked_no_direct';
  const inspectedNegativeBundles = (bundles || [])
    .filter((bundle) => bundle.desiredEvidenceClass === 'negative_control' && bundle.persistable);
  return inspectedNegativeBundles.length ? 'checked_no_direct' : 'unchecked';
}

function closureReasonForEvidenceUse(evidenceUse = '') {
  return ({
    promotion_candidate: 'promotion_collected',
    supporting_context: 'context_collected',
    negative_control_candidate: 'negative_collected',
    weak_noise: 'weak_noise_collected',
    rejected: 'rejected',
  })[String(evidenceUse || '').trim()] || null;
}

function classifySourceQueryEvidenceUse({
  evidenceClass,
  relevanceScore = 0,
  minThreshold = 0.35,
  directThreshold = 0.65,
  targetHit = false,
  rejectedReason = null,
  classCueHit = false,
  strongClassCueHit = classCueHit,
  themeHitCount = 0,
  queryHitCount = 0,
} = {}) {
  const weakThreshold = Math.max(0.12, minThreshold * 0.45);
  if (rejectedReason) {
    if (relevanceScore >= weakThreshold || themeHitCount > 0 || queryHitCount > 0) {
      return {
        evidenceUse: 'weak_noise',
        relevanceTier: 'weak_noise',
        persistable: true,
        promotionEligible: false,
        usable: false,
      };
    }
    return {
      evidenceUse: 'rejected',
      relevanceTier: 'rejected',
      persistable: false,
      promotionEligible: false,
      usable: false,
    };
  }
  if (evidenceClass === 'negative_control') {
    if (targetHit && classCueHit && relevanceScore >= weakThreshold) {
      return {
        evidenceUse: 'negative_control_candidate',
        relevanceTier: 'negative_control',
        persistable: true,
        promotionEligible: false,
        usable: true,
      };
    }
    return {
      evidenceUse: 'weak_noise',
      relevanceTier: 'weak_noise',
      persistable: true,
      promotionEligible: false,
      usable: false,
    };
  }
  if (evidenceClass === 'procurement_trigger') {
    if (targetHit && strongClassCueHit && relevanceScore >= minThreshold) {
      return {
        evidenceUse: 'promotion_candidate',
        relevanceTier: 'promotion_candidate',
        persistable: true,
        promotionEligible: true,
        usable: true,
      };
    }
    if (targetHit && (classCueHit || relevanceScore >= weakThreshold || themeHitCount > 0 || queryHitCount > 0)) {
      return {
        evidenceUse: 'supporting_context',
        relevanceTier: 'supporting_context',
        persistable: true,
        promotionEligible: false,
        usable: true,
      };
    }
    return {
      evidenceUse: 'weak_noise',
      relevanceTier: 'weak_noise',
      persistable: true,
      promotionEligible: false,
      usable: false,
    };
  }
  if (evidenceClass === 'substitution_limit') {
    if (targetHit && strongClassCueHit && relevanceScore >= directThreshold) {
      return {
        evidenceUse: 'promotion_candidate',
        relevanceTier: 'promotion_candidate',
        persistable: true,
        promotionEligible: true,
        usable: true,
      };
    }
    if (targetHit && (classCueHit || relevanceScore >= weakThreshold || themeHitCount > 0 || queryHitCount > 0)) {
      return {
        evidenceUse: 'supporting_context',
        relevanceTier: 'supporting_context',
        persistable: true,
        promotionEligible: false,
        usable: true,
      };
    }
    return {
      evidenceUse: 'weak_noise',
      relevanceTier: 'weak_noise',
      persistable: true,
      promotionEligible: false,
      usable: false,
    };
  }
  if (targetHit && (relevanceScore >= directThreshold || (relevanceScore >= minThreshold && classCueHit))) {
    return {
      evidenceUse: 'promotion_candidate',
      relevanceTier: 'promotion_candidate',
      persistable: true,
      promotionEligible: true,
      usable: true,
    };
  }
  if (targetHit && (relevanceScore >= weakThreshold || themeHitCount > 0 || queryHitCount > 0)) {
    return {
      evidenceUse: 'supporting_context',
      relevanceTier: 'supporting_context',
      persistable: true,
      promotionEligible: false,
      usable: true,
    };
  }
  if (relevanceScore >= weakThreshold || themeHitCount > 0 || queryHitCount > 0) {
    return {
      evidenceUse: 'weak_noise',
      relevanceTier: 'weak_noise',
      persistable: true,
      promotionEligible: false,
      usable: false,
    };
  }
  return {
    evidenceUse: 'rejected',
    relevanceTier: 'rejected',
    persistable: false,
    promotionEligible: false,
    usable: false,
  };
}

function decodeXml(value) {
  return String(value || '')
    .replace(/<!\[CDATA\[(.*?)\]\]>/gs, '$1')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function stripTags(value) {
  return decodeXml(value).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function tagValue(itemXml, tag) {
  const match = String(itemXml || '').match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'));
  return match ? stripTags(match[1]) : '';
}

export function parseExternalRssItems(xml, options = {}) {
  const limit = Math.max(1, Number(options.limit || 10));
  const items = [...String(xml || '').matchAll(/<item\b[\s\S]*?<\/item>/gi)].slice(0, limit);
  return items.map((match) => {
    const itemXml = match[0];
    const title = tagValue(itemXml, 'title');
    const link = tagValue(itemXml, 'link');
    const description = tagValue(itemXml, 'description');
    const publishedAt = tagValue(itemXml, 'pubDate');
    const source = tagValue(itemXml, 'source');
    return { title, link, description, publishedAt, source };
  }).filter((item) => item.title || item.link);
}

async function collectExternalRssBundles(question, approval, policy) {
  if (policy?.sourceExpansion?.externalRssEnabled === false) return { bundles: [], error: null };
  const maxItems = Math.max(1, requirePolicyNumber(policy, 'sourceExpansion.externalRssMaxItems'));
  const timeoutMs = Math.max(1000, requirePolicyNumber(policy, 'sourceExpansion.externalRssTimeoutMs'));
  const providerRoutePlan = providerRoutePlanFromPayload(approval.payload || {});
  const queries = uniqueStrings([
    approval.payload?.query,
    ...asArray(providerRoutePlan?.queryVariants),
  ]).slice(0, 3);
  if (!queries.length) return { bundles: [], error: null };
  const bundles = [];
  try {
    for (const query of queries) {
      if (bundles.length >= maxItems) break;
      const url = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=en-US&gl=US&ceid=US:en`;
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);
      const response = await fetch(url, {
        signal: controller.signal,
        headers: { 'user-agent': 'LatticeResearchOS/1.0 source-query evidence collector' },
      });
      clearTimeout(timeout);
      if (!response.ok) {
        return { bundles, error: `external-rss-http-${response.status}` };
      }
      const xml = await response.text();
      const items = parseExternalRssItems(xml, { limit: Math.max(1, maxItems - bundles.length) });
      bundles.push(...items.map((item) => ({
        // Keep external evidence in Research OS private bundles only. Do not write it into canonical articles.
        questionId: question.id,
        sourceType: 'external-rss',
        sourceId: stableResearchOsId(['external-rss', item.link || item.title, query]),
        title: item.title,
        textExcerpt: compact([item.description, item.source].filter(Boolean).join(' ')).slice(0, 700),
        url: item.link || url,
        publishedAt: Number.isNaN(Date.parse(item.publishedAt || '')) ? null : new Date(item.publishedAt).toISOString(),
        relevanceScore: 0.5,
        metadata: {
          source: item.source || 'google-news-rss',
          provider: 'google-news-rss',
          query,
          providerRoutePlan,
          approvalId: String(approval.id || ''),
          candidateId: approval.payload?.candidateId ? String(approval.payload.candidateId) : null,
          isolation: 'research_os_private_evidence',
        },
      })));
    }
    return { bundles, error: null };
  } catch (error) {
    return { bundles, error: String(error?.message || error) };
  }
}

export function buildSourceQueryQuestionPayload(approval = {}) {
  const payload = approval.payload || {};
  const themes = uniqueStrings(payload.themes || []).filter((theme) => !isNumericIdentifier(theme));
  const query = compact(payload.query);
  const primaryTerms = uniqueStrings([
    ...approvalPrimaryTerms(payload),
    ...extractQueryTerms(query).slice(0, 6),
  ]);
  return {
    id: stableResearchOsId(['source-query-approval', approval.id, query]),
    questionType: 'source_query',
    themes,
    seedTerms: uniqueStrings([
      query,
      payload.supplier,
      payload.connector,
      ...themes,
      ...extractQueryTerms(query),
    ]),
    prompt: `Evidence expansion query: ${query}. Validate whether the target is a real cross-theme connector and identify direct supporting sources.`,
    triggerReason: `Approved source-query for cross-theme candidate ${payload.candidateId || 'unknown'}`,
    noveltyScore: 0.3,
    heatScore: 0.3,
    gapScore: 0.8,
    priorityScore: 0.8,
    status: 'new',
    metadata: {
      approvalId: String(approval.id || ''),
      candidateId: payload.candidateId ? String(payload.candidateId) : null,
      query,
      supplier: payload.supplier || null,
      connector: payload.connector || null,
      subject: payloadSubjectDisplay(payload) || null,
      source: 'source-query-executor',
      primaryTerms,
      providerRoutePlan: providerRoutePlanFromPayload(payload),
    },
  };
}

export function scoreSourceQueryBundle(bundle = {}, approval = {}, policy = loadResearchOsPolicy()) {
  const payload = approval.payload || {};
  const queryTerms = extractQueryTerms(payload.query);
  const desiredEvidenceClass = desiredEvidenceClassFromPayload(payload);
  const primaryTerms = approvalPrimaryTerms(payload);
  const themes = uniqueStrings(payload.themes || []).filter((theme) => !isNumericIdentifier(theme));
  const themeTerms = uniqueStrings(themes.flatMap(splitThemeTerms));
  const text = bundleText(bundle);
  const primaryHitCount = primaryTerms.filter((term) => textIncludes(text, term)).length;
  const themeHitCount = themeTerms.filter((term) => textIncludes(text, term)).length;
  const queryHitCount = queryTerms.filter((term) => textIncludes(text, term)).length;
  const primaryScore = primaryTerms.length
    ? Math.min(1, primaryHitCount / primaryTerms.length)
    : Math.min(1, queryHitCount / Math.max(1, queryTerms.length));
  const themeScore = themeTerms.length ? Math.min(1, themeHitCount / Math.min(themeTerms.length, 3)) : 0;
  const queryScore = queryTerms.length ? Math.min(1, queryHitCount / Math.min(queryTerms.length, 5)) : 0;
  const relevanceScore = Math.min(1,
    primaryScore * requirePolicyNumber(policy, 'sourceExpansion.queryScoring.primaryHit')
    + themeScore * requirePolicyNumber(policy, 'sourceExpansion.queryScoring.themeHit')
    + queryScore * requirePolicyNumber(policy, 'sourceExpansion.queryScoring.queryOverlap'),
  );
  const directThreshold = requirePolicyNumber(policy, 'sourceExpansion.directBundleRelevance');
  const minThreshold = requirePolicyNumber(policy, 'sourceExpansion.minBundleRelevance');
  const isAdjacentCandidateQuery = payload.collectionKind === 'adjacent_theme_candidate'
    || Boolean(payload.adjacentCandidateKey)
    || String(payload.target?.type || '') === 'adjacent_theme_candidate';
  const classCueHit = evidenceClassCueHit(desiredEvidenceClass, text);
  const strongClassCueHit = desiredEvidenceClass === 'substitution_limit'
    ? /\b(sole source|single source|hard to substitute|limited qualified suppliers?|qualified supplier count|qualification constraint|qualification lead time|test lead time|certification bottleneck|certification constraint|energetic material constraint|propellant qualification|no near-term alternative|cannot substitute|not interchangeable)\b/i.test(text)
    : desiredEvidenceClass === 'procurement_trigger'
      ? officialProcurementCueHit(bundle, text)
      : classCueHit;
  const requiresTargetHit = payload.candidateId || payload.reportType === 'cross_theme_bottleneck_report';
  const adjacentQueryTargetHit = primaryHitCount > 0 || ((classCueHit || strongClassCueHit) && queryHitCount >= 2);
  const targetHit = requiresTargetHit
    ? (primaryHitCount > 0 || (isAdjacentCandidateQuery && adjacentQueryTargetHit))
    : (primaryHitCount > 0 || queryHitCount >= 2);
  const rejectedReason = requiresTargetHit && !targetHit
    ? (isAdjacentCandidateQuery && queryHitCount >= 2 && !classCueHit && !strongClassCueHit
      ? 'missing-adjacent-class-cue'
      : 'missing-target-or-query-hit')
    : null;
  const tier = classifySourceQueryEvidenceUse({
    evidenceClass: desiredEvidenceClass,
    relevanceScore,
    minThreshold,
    directThreshold,
    targetHit,
    rejectedReason,
    classCueHit,
    strongClassCueHit,
    themeHitCount,
    queryHitCount,
  });
  const providerRoutePlan = providerRoutePlanFromPayload(payload);
  const capability = collectorCapability('source-query', desiredEvidenceClass);
  const acceptance = evaluateEvidenceClassAcceptance({
    evidenceClass: desiredEvidenceClass,
    provider: 'source-query',
    sourceType: bundle.sourceType || bundle.source_type || bundle.metadata?.sourceType || bundle.metadata?.source || 'source-query',
    text,
    title: bundle.title || '',
    textExcerpt: bundle.textExcerpt || bundle.text_excerpt || '',
    metadata: {
      ...(bundle.metadata || {}),
      providerRoutePlan,
      sourceQueryRelevance: relevanceScore,
    },
    evidenceUse: tier.evidenceUse,
    maxEvidenceUse: tier.evidenceUse,
    targetHit,
    classCueHit,
    strongClassCueHit,
    rejectedReason,
  });
  const acceptedTier = {
    ...tier,
    evidenceUse: acceptance.evidenceUse,
    relevanceTier: acceptance.evidenceUse === 'promotion_candidate'
      ? 'promotion_candidate'
      : acceptance.evidenceUse === 'negative_control_candidate'
        ? 'negative_control'
        : acceptance.evidenceUse,
    promotionEligible: acceptance.evidenceUse === 'promotion_candidate',
    usable: ['promotion_candidate', 'supporting_context', 'negative_control_candidate'].includes(acceptance.evidenceUse),
    persistable: acceptance.evidenceUse !== 'rejected' ? true : tier.persistable,
  };
  return {
    ...bundle,
    sourceQueryRelevance: relevanceScore,
    evidenceStrength: relevanceScore >= directThreshold ? 'direct' : 'indirect',
    desiredEvidenceClass,
    evidenceUse: acceptedTier.evidenceUse,
    relevanceTier: acceptedTier.relevanceTier,
    negativeControlFinding: desiredEvidenceClass === 'negative_control' ? negativeControlFinding(text) : null,
    persistable: acceptedTier.persistable,
    promotionEligible: acceptedTier.promotionEligible,
    usableEvidence: acceptedTier.usable,
    accepted: acceptedTier.promotionEligible,
    factsExtracted: acceptance.factsExtracted || [],
    factKeys: acceptance.factKeys || [],
    missingFacts: acceptance.missingFacts || [],
    requiredFacts: acceptance.requiredFacts || [],
    acceptanceVerdict: acceptance.acceptanceVerdict || acceptedTier.evidenceUse,
    collectorCapability: capability,
    closureReason: acceptance.closureReason || closureReasonForEvidenceUse(acceptedTier.evidenceUse),
    scoring: {
      primaryHitCount,
      themeHitCount,
      queryHitCount,
      primaryScore,
      themeScore,
      queryScore,
      minThreshold,
      directThreshold,
      requiresTargetHit: Boolean(requiresTargetHit),
      targetHit,
      rejectedReason,
      desiredEvidenceClass,
      classCueHit,
      strongClassCueHit,
      playbookMatchedCriteria: acceptance.matchedCriteria || [],
    },
  };
}

export function filterAndScoreSourceQueryBundles(bundles = [], approval = {}, policy = loadResearchOsPolicy()) {
  return (bundles || [])
    .map((bundle) => scoreSourceQueryBundle(bundle, approval, policy))
    .filter((bundle) => bundle.promotionEligible)
    .sort(sortSourceQueryBundles);
}

function sortSourceQueryBundles(left, right) {
  const rankDiff = (EVIDENCE_USE_RANK[right.evidenceUse] || 0) - (EVIDENCE_USE_RANK[left.evidenceUse] || 0);
  if (rankDiff) return rankDiff;
  return right.sourceQueryRelevance - left.sourceQueryRelevance;
}

function scoreAllSourceQueryBundles(bundles = [], approval = {}, policy = loadResearchOsPolicy()) {
  return (bundles || [])
    .map((bundle) => scoreSourceQueryBundle(bundle, approval, policy))
    .sort(sortSourceQueryBundles);
}

function sourceQueryTierCounts(bundles = []) {
  const negativeCounts = negativeControlFindingCounts(bundles);
  return {
    persistedBundleCount: bundles.filter((bundle) => bundle.persistable).length,
    promotionBundleCount: bundles.filter((bundle) => bundle.promotionEligible).length,
    contextBundleCount: bundles.filter((bundle) => bundle.evidenceUse === 'supporting_context').length,
    negativeControlCount: bundles.filter((bundle) => bundle.evidenceUse === 'negative_control_candidate').length,
    noiseCount: bundles.filter((bundle) => bundle.evidenceUse === 'weak_noise').length,
    negativeControlFindingCounts: negativeCounts,
  };
}

async function upsertSourceQueryResearchQuestion(queryable, question) {
  const { rows } = await queryable.query(
    `INSERT INTO research_questions (
       deterministic_id, question_type, themes, seed_terms, prompt, trigger_reason,
       novelty_score, heat_score, gap_score, priority_score, status, metadata
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb)
     ON CONFLICT (deterministic_id) WHERE deterministic_id IS NOT NULL DO UPDATE
       SET themes = EXCLUDED.themes,
           seed_terms = EXCLUDED.seed_terms,
           prompt = EXCLUDED.prompt,
           trigger_reason = EXCLUDED.trigger_reason,
           metadata = research_questions.metadata || EXCLUDED.metadata,
           updated_at = NOW()
     RETURNING id, question_type, themes, seed_terms, prompt, trigger_reason, metadata`,
    [
      question.id,
      question.questionType,
      question.themes,
      question.seedTerms,
      question.prompt,
      question.triggerReason,
      question.noveltyScore,
      question.heatScore,
      question.gapScore,
      question.priorityScore,
      question.status,
      JSON.stringify({ ...(question.metadata || {}), deterministicId: question.id }),
    ],
  );
  return rows[0];
}

async function loadCandidate(queryable, candidateId) {
  if (!candidateId) return null;
  if (!/^\d+$/.test(String(candidateId))) return null;
  const { rows } = await queryable.query(
    `SELECT c.*,
            cn.canonical_name AS connector_name,
            cn.node_type AS connector_type,
            sn.canonical_name AS supplier_name,
            sn.node_type AS supplier_type
       FROM cross_theme_candidates c
       LEFT JOIN knowledge_nodes cn ON cn.id = c.connector_node_id
       LEFT JOIN knowledge_nodes sn ON sn.id = c.supplier_node_id
      WHERE c.id = $1
      LIMIT 1`,
    [candidateId],
  );
  return rows[0] || null;
}

function sourceName(bundle = {}) {
  return compact(bundle.metadata?.source || bundle.sourceType || bundle.source_type || 'unknown').toLowerCase();
}

function edgeRelationForTarget(candidate = {}, targetNode = {}) {
  const type = targetNode.node_type || targetNode.nodeType || candidate.supplier_type || candidate.connector_type;
  return ['company', 'supplier'].includes(String(type || '').toLowerCase()) ? 'exposed_to' : 'requires';
}

async function upsertCandidateEvidenceEdges(queryable, candidate, approval, bundles, policy) {
  if (!candidate || !bundles.length) {
    return { edgeCount: 0, edgeEvidenceCount: 0, sourceDiversityRaw: 0, directEvidenceCount: 0 };
  }
  const targetId = candidate.connector_node_id || candidate.supplier_node_id;
  const targetName = candidate.connector_name || candidate.supplier_name || approval.payload?.connector || approval.payload?.supplier;
  if (!targetId || !targetName) {
    return { edgeCount: 0, edgeEvidenceCount: 0, sourceDiversityRaw: 0, directEvidenceCount: 0 };
  }
  const targetNode = {
    node_type: candidate.connector_node_id ? candidate.connector_type : candidate.supplier_type,
    canonical_name: targetName,
  };
  const themes = evidenceThemes(approval.payload || {}, candidate);
  const sourceDiversityRaw = new Set(bundles.map(sourceName)).size;
  const directEvidenceCount = bundles.filter((bundle) => bundle.evidenceStrength === 'direct').length;
  const edgeConfidence = requirePolicyNumber(policy, 'sourceExpansion.evidenceEdgeConfidence');
  let edgeCount = 0;
  let edgeEvidenceCount = 0;
  for (const theme of themes) {
    const themeNode = await upsertKnowledgeNode(queryable, {
      nodeType: 'theme',
      canonicalName: theme,
      aliases: [theme],
      status: 'candidate',
      createdBy: 'source-query-executor',
      metadata: { source: 'source-query-executor' },
    }, { skipEnsure: true });
    const edge = await upsertKnowledgeEdge(queryable, {
      sourceNodeId: themeNode.id,
      targetNodeId: targetId,
      relationType: edgeRelationForTarget(candidate, targetNode),
      confidence: edgeConfidence,
      evidenceCount: bundles.length,
      sourceDiversity: sourceDiversityRaw,
      status: 'candidate',
      createdBy: 'source-query-executor',
      metadata: {
        approvalId: String(approval.id),
        candidateId: String(candidate.id),
        query: approval.payload?.query || '',
        evidenceMode: 'approved-source-query',
      },
    }, new Map(), { skipEnsure: true });
    await queryable.query(
      `UPDATE knowledge_edges
          SET status = 'candidate',
              metadata = metadata || $2::jsonb,
              updated_at = NOW()
        WHERE id = $1
          AND status = 'archived'
          AND created_by = 'source-query-executor'`,
      [
        edge.id,
        JSON.stringify({
          reactivatedBy: 'source-query-executor',
          reactivatedReason: 'new approved source-query evidence attached',
          reactivatedAt: new Date().toISOString(),
        }),
      ],
    );
    edgeCount += 1;
    for (const bundle of bundles) {
      await upsertKnowledgeEdgeEvidence(queryable, {
        edgeId: edge.id,
        sourceType: bundle.sourceType || bundle.source_type,
        sourceId: bundle.sourceId || bundle.source_id,
        quote: bundle.textExcerpt || bundle.text_excerpt || bundle.title || '',
        evidenceStrength: bundle.evidenceStrength || 'indirect',
        url: bundle.url || null,
        metadata: {
          approvalId: String(approval.id),
          candidateId: String(candidate.id),
          questionId: String(bundle.questionId || bundle.question_id || ''),
          relevance: bundle.sourceQueryRelevance,
          evidenceUse: bundle.evidenceUse || null,
          relevanceTier: bundle.relevanceTier || null,
          desiredEvidenceClass: bundle.desiredEvidenceClass || null,
          factsExtracted: bundle.factsExtracted || [],
          factKeys: bundle.factKeys || [],
          missingFacts: bundle.missingFacts || [],
          requiredFacts: bundle.requiredFacts || [],
          acceptanceVerdict: bundle.acceptanceVerdict || bundle.evidenceUse || null,
          collectorCapability: bundle.collectorCapability || null,
          closureReason: bundle.closureReason || closureReasonForEvidenceUse(bundle.evidenceUse),
          promotionEligible: Boolean(bundle.promotionEligible),
          scoring: bundle.scoring || {},
        },
      }, { skipEnsure: true });
      edgeEvidenceCount += 1;
    }
  }
  return { edgeCount, edgeEvidenceCount, sourceDiversityRaw, directEvidenceCount };
}

async function deleteSourceQueryEdgeEvidenceForApproval(queryable, approvalId) {
  if (!approvalId) return { deletedCount: 0 };
  const { rowCount } = await queryable.query(
    `DELETE FROM knowledge_edge_evidence
      WHERE metadata->>'approvalId' = $1`,
    [String(approvalId)],
  );
  return { deletedCount: rowCount || 0 };
}

async function updateCandidateEvidenceSummary(queryable, candidate, edgeResult, bundleCount, tierCounts = {}, approvalId = null) {
  if (!candidate?.id) return;
  const previous = candidate.evidence_summary || {};
  const approvalKey = approvalId ? String(approvalId) : null;
  const sourceQueryApprovalTiers = {
    ...(previous.sourceQueryApprovalTiers && typeof previous.sourceQueryApprovalTiers === 'object'
      ? previous.sourceQueryApprovalTiers
      : {}),
  };
  if (approvalKey) {
    sourceQueryApprovalTiers[approvalKey] = {
      promotionBundleCount: Number(bundleCount || 0),
      persistedBundleCount: Number(tierCounts.persistedBundleCount || 0),
      contextBundleCount: Number(tierCounts.contextBundleCount || 0),
      negativeControlCount: Number(tierCounts.negativeControlCount || 0),
      noiseCount: Number(tierCounts.noiseCount || 0),
      updatedAt: new Date().toISOString(),
    };
  }
  const approvalTierValues = Object.values(sourceQueryApprovalTiers || {});
  const sumTier = (key) => approvalTierValues.reduce((sum, item) => sum + Number(item?.[key] || 0), 0);
  const sourceDiversityRaw = Math.max(Number(previous.sourceDiversityRaw || 0), edgeResult.sourceDiversityRaw || 0);
  const directEvidenceCount = Math.max(Number(previous.directEvidenceCount || 0), edgeResult.directEvidenceCount || 0);
  const sourceQueryEvidenceCount = approvalKey
    ? sumTier('promotionBundleCount')
    : Math.max(Number(previous.sourceQueryEvidenceCount || 0), bundleCount);
  const sourceQueryPersistedCount = approvalKey
    ? sumTier('persistedBundleCount')
    : Number(previous.sourceQueryPersistedCount || 0) + Number(tierCounts.persistedBundleCount || 0);
  const sourceQueryContextCount = approvalKey
    ? sumTier('contextBundleCount')
    : Number(previous.sourceQueryContextCount || 0) + Number(tierCounts.contextBundleCount || 0);
  const sourceQueryNegativeControlCount = approvalKey
    ? sumTier('negativeControlCount')
    : Number(previous.sourceQueryNegativeControlCount || 0) + Number(tierCounts.negativeControlCount || 0);
  const sourceQueryNoiseCount = approvalKey
    ? sumTier('noiseCount')
    : Number(previous.sourceQueryNoiseCount || 0) + Number(tierCounts.noiseCount || 0);
  const sourceDiversityScore = sourceDiversityRaw > 0 ? Math.min(1, sourceDiversityRaw / 5) : 0;
  const sourceQueryEvidenceQuality = sourceQueryEvidenceCount > 0
    ? Math.min(
      0.72,
      0.2
        + Math.min(sourceQueryEvidenceCount, 8) * 0.035
        + Math.min(sourceDiversityRaw, 5) * 0.035
        + Math.min(directEvidenceCount, 2) * 0.17,
    )
    : 0;
  const merged = {
    ...previous,
    sourceQueryEvidenceCount,
    sourceQueryPersistedCount,
    sourceQueryContextCount,
    sourceQueryNegativeControlCount,
    sourceQueryNoiseCount,
    sourceQueryApprovalTiers,
    directEvidenceCount,
    sourceDiversityRaw,
    sourceDiversity: Math.max(Number(previous.sourceDiversity || 0), sourceDiversityScore),
    evidenceQuality: Math.max(Number(previous.evidenceQuality || 0), sourceQueryEvidenceQuality),
    sourceQueryLastExecutedAt: new Date().toISOString(),
  };
  await queryable.query(
    `UPDATE cross_theme_candidates
        SET evidence_summary = evidence_summary || $2::jsonb,
            metadata = metadata || $3::jsonb,
            updated_at = NOW()
      WHERE id = $1`,
    [
      candidate.id,
      JSON.stringify(merged),
      JSON.stringify({
        lastSourceQueryExecution: {
          bundleCount,
          ...tierCounts,
          ...edgeResult,
        },
      }),
    ],
  );
}

async function updateCandidateSourceQueryFailure(queryable, candidate, failure = {}) {
  if (!candidate?.id) return;
  await queryable.query(
    `UPDATE cross_theme_candidates
        SET metadata = metadata || $2::jsonb,
            updated_at = NOW()
      WHERE id = $1`,
    [
      candidate.id,
      JSON.stringify({
        sourceQueryFailure: {
          ...failure,
          failedAt: new Date().toISOString(),
        },
      }),
    ],
  );
}

async function markApproval(queryable, approvalId, status, reasoning) {
  await queryable.query(
    `UPDATE approval_queue
        SET status = $2,
            reviewer = 'source-query-executor',
            reviewed_at = NOW(),
            reasoning = CONCAT(COALESCE(reasoning, ''), CASE WHEN COALESCE(reasoning, '') = '' THEN '' ELSE E'\n' END, $3::text)
      WHERE id = $1`,
    [approvalId, status, reasoning],
  );
}

async function markReportBackfillRejectedForApproval(queryable, approval, reason) {
  const taskId = String(approval?.payload?.reportBackfillTaskId || '').trim();
  if (!/^\d+$/.test(taskId)) return;
  await queryable.query(
    `UPDATE report_backfill_tasks
        SET status = 'rejected',
            last_error = $2,
            metadata = metadata || $3::jsonb,
            updated_at = NOW()
      WHERE id = $1`,
    [
      taskId,
      reason,
      JSON.stringify({
        automation: {
          rejectedAt: new Date().toISOString(),
          rejectedBy: 'source-query-executor',
          reason,
        },
      }),
    ],
  ).catch(() => {});
}

async function rejectInvalidSourceQueryApproval(queryable, approval, blocker) {
  const reason = `source-query-executor: rejected invalid source-query approval; blocker=${blocker}`;
  await markApproval(queryable, approval.id, 'rejected', reason);
  await markReportBackfillRejectedForApproval(queryable, approval, reason);
}

export async function quarantineInvalidSourceQueryApprovals(queryable, options = {}) {
  const limit = Math.max(25, Math.min(1000, Number(options.limit || 250)));
  const statuses = options.statuses || ['pending', 'approved', 'needs-fix'];
  const reportId = compact(options.reportId);
  const reportCreatedOnly = Boolean(options.reportCreatedOnly);
  const operatorOnly = operatorSeedFilterEnabled(options);
  const operatorSeedIds = operatorSeedIdsFromOptions(options);
  const { rows } = await queryable.query(
    `SELECT id, payload, status, created_at
       FROM approval_queue
      WHERE action_type = 'source-query'
        AND status = ANY($2::text[])
        AND (
          $3::text IS NULL
          OR payload->>'reportId' = $3::text
          OR payload->>'latestReportId' = $3::text
        )
        AND (
          $4::boolean IS NOT TRUE
          OR payload ? 'reportId'
          OR payload ? 'latestReportId'
          OR payload ? 'reportBackfillTaskId'
          OR payload->>'source' = 'report-deep-research-pack'
          OR payload->>'collectionKind' = 'universal_evidence_contract'
        )
        AND (
          $5::boolean IS NOT TRUE
          OR payload->>'createdBy' = 'operator-mechanism-seed'
          OR payload->>'source' = 'operator-mechanism-seed'
          OR payload->>'collectionKind' = 'operator_mechanism_seed'
        )
        AND (cardinality($6::text[]) = 0 OR payload->>'operatorSeedId' = ANY($6::text[]))
      ORDER BY created_at ASC
      LIMIT $1`,
    [limit, statuses, reportId || null, reportCreatedOnly, operatorOnly, operatorSeedIds],
  );
  const rejected = [];
  for (const row of rows) {
    const approval = { ...row, payload: row.payload || {} };
    const blocker = sourceQueryApprovalBlocker(approval);
    if (!blocker) continue;
    if (!options.dryRun) await rejectInvalidSourceQueryApproval(queryable, approval, blocker);
    rejected.push({
      approvalId: String(approval.id),
      status: approval.status,
      blocker,
      reportBackfillTaskId: approval.payload?.reportBackfillTaskId ? String(approval.payload.reportBackfillTaskId) : null,
    });
  }
  return {
    ok: true,
    dryRun: Boolean(options.dryRun),
    inspectedCount: rows.length,
    rejectedCount: rejected.length,
    rejected,
  };
}

async function markSourceQueryRetryExhausted(queryable, approvalId, repair) {
  const patch = {
    exhausted: true,
    exhaustedAt: new Date().toISOString(),
    suggestedQueries: repair.suggestedQueries || [],
  };
  await queryable.query(
    `UPDATE approval_queue
        SET payload = jsonb_set(
              payload,
              '{repair}',
              COALESCE(payload->'repair', '{}'::jsonb) || $2::jsonb,
              true
            ),
            reasoning = CONCAT(COALESCE(reasoning, ''), CASE WHEN COALESCE(reasoning, '') = '' THEN '' ELSE E'\n' END, $3::text)
      WHERE id = $1`,
    [approvalId, JSON.stringify(patch), `source-query-executor: retry attempts exhausted at attempt ${repair.attempt}`],
  );
}

function directProviderClosureForSourceQuery({ evidenceClass = '', failureCategory = '' } = {}) {
  const cls = String(evidenceClass || '').replace(/-/g, '_');
  if (failureCategory !== 'weak-noise-only') return null;
  if (cls === 'market_validation') {
    return {
      closureReason: 'source_query_market_validation_context_only',
      closureState: 'market_validation_pending',
      nextAction: 'run local controlled market validation; source-query cannot promote market_validation',
    };
  }
  if (['issuer_exposure', 'issuer_commentary', 'primary_filing', 'capex_confirmation', 'cloud_revenue'].includes(cls)) {
    return {
      closureReason: 'broad_search_exhausted_direct_provider_required',
      closureState: 'direct_provider_required',
      nextAction: 'run direct SEC/IR/transcript/contract issuer bridge collectors',
    };
  }
  return {
    closureReason: 'weak_noise_only',
    closureState: 'direct_provider_required',
    nextAction: 'switch from broad source-query to class-specific provider route',
  };
}

async function updateSourceQueryOutcomeMetadata(queryable, approval, outcome = {}) {
  if (!approval?.id) return;
  const evidenceClass = desiredEvidenceClassFromPayload(approval.payload || {});
  const directClosure = directProviderClosureForSourceQuery({
    evidenceClass,
    failureCategory: outcome.failureCategory,
  });
  const patch = {
    sourceQueryFailure: {
      category: outcome.failureCategory || null,
      collected: Number(outcome.collectedCount || 0),
      external: Number(outcome.externalCollectedCount || 0),
      accepted: Number(outcome.acceptedBundleCount || 0),
      persisted: Number(outcome.persistedBundleCount || 0),
      context: Number(outcome.contextBundleCount || 0),
      negativeControl: Number(outcome.negativeControlCount || 0),
      negativeControlClosure: outcome.negativeControlClosure || null,
      negativeControlFindingCounts: outcome.negativeControlFindingCounts || {},
      noise: Number(outcome.noiseCount || 0),
      updatedAt: new Date().toISOString(),
    },
    ...(directClosure || {}),
  };
  if (directClosure?.nextAction) {
    patch.providerRoutePlan = {
      ...(approval.payload?.providerRoutePlan || {}),
      evidenceClass,
      closureReason: directClosure.closureReason,
      nextAction: directClosure.nextAction,
    };
  }
  await queryable.query(
    `UPDATE approval_queue
        SET payload = payload || $2::jsonb
      WHERE id = $1`,
    [approval.id, JSON.stringify(patch)],
  ).catch(() => {});
  const taskId = String(approval.payload?.reportBackfillTaskId || '').trim();
  if (/^\d+$/.test(taskId)) {
    await queryable.query(
      `UPDATE report_backfill_tasks
          SET metadata = metadata || $2::jsonb,
              updated_at = NOW()
        WHERE id = $1`,
      [taskId, JSON.stringify({
        sourceQueryFailure: patch.sourceQueryFailure,
        closureReason: patch.closureReason || null,
        closureState: patch.closureState || null,
        nextAction: patch.nextAction || null,
      })],
    ).catch(() => {});
  }
}

async function updateOperatorSeedEvidenceOutcomeForApproval(queryable, approval, outcome = {}) {
  const payload = approval?.payload || {};
  const seedId = compact(payload.operatorSeedId);
  if (!seedId) return null;
  const evidenceClass = desiredEvidenceClassFromPayload(payload);
  return recordOperatorSeedEvidenceOutcome(queryable, {
    seedId,
    approvalId: approval.id,
    evidenceClass,
    query: payload.query || '',
    status: outcome.status || '',
    failureCategory: outcome.failureCategory || '',
    collectedCount: outcome.collectedCount || 0,
    externalCollectedCount: outcome.externalCollectedCount || 0,
    acceptedBundleCount: outcome.acceptedBundleCount || 0,
    persistedBundleCount: outcome.persistedBundleCount || 0,
    promotionBundleCount: outcome.promotionBundleCount || 0,
    contextBundleCount: outcome.contextBundleCount || 0,
    negativeControlCount: outcome.negativeControlCount || 0,
    negativeControlFinding: outcome.negativeControlFinding || outcome.negativeControlClosure || null,
    negativeControlClosure: outcome.negativeControlClosure || null,
    negativeControlFindingCounts: outcome.negativeControlFindingCounts || {},
    noiseCount: outcome.noiseCount || 0,
    sourceQueryFailure: {
      category: outcome.failureCategory || null,
      collected: Number(outcome.collectedCount || 0),
      external: Number(outcome.externalCollectedCount || 0),
      accepted: Number(outcome.acceptedBundleCount || 0),
      persisted: Number(outcome.persistedBundleCount || 0),
      context: Number(outcome.contextBundleCount || 0),
      negativeControl: Number(outcome.negativeControlCount || 0),
      noise: Number(outcome.noiseCount || 0),
    },
    metadata: {
      collectionKind: payload.collectionKind || null,
      createdBy: payload.createdBy || payload.source || null,
      providerRoutePlan: payload.providerRoutePlan || null,
      promotionEligible: Boolean(payload.promotionEligible),
      evidenceUse: payload.evidenceUse || null,
      negativeControlClosure: outcome.negativeControlClosure || null,
      negativeControlFindingCounts: outcome.negativeControlFindingCounts || {},
    },
  }).catch((error) => ({ ok: false, seedId, error: String(error?.message || error) }));
}

export async function approvePendingSourceQueries(queryable, options = {}) {
  const limit = Math.max(1, Number(options.limit || 25));
  const reviewer = options.reviewer || 'codex-current-request';
  const reportId = compact(options.reportId);
  const approvalIds = uniqueStrings(options.approvalIds || []);
  const reportCreatedOnly = Boolean(options.reportCreatedOnly);
  const operatorOnly = operatorSeedFilterEnabled(options);
  const operatorSeedIds = operatorSeedIdsFromOptions(options);
  const { rows } = await queryable.query(
    `UPDATE approval_queue
        SET status = 'approved',
            reviewer = $2,
            reviewed_at = NOW(),
            reasoning = CONCAT(COALESCE(reasoning, ''), CASE WHEN COALESCE(reasoning, '') = '' THEN '' ELSE E'\n' END, $3::text)
      WHERE id IN (
        SELECT id
          FROM approval_queue
         WHERE action_type = 'source-query'
           AND status = 'pending'
           AND (
             $4::text IS NULL
             OR payload->>'reportId' = $4::text
             OR payload->>'latestReportId' = $4::text
           )
           AND (cardinality($5::bigint[]) = 0 OR id = ANY($5::bigint[]))
           AND (
             $8::boolean IS NOT TRUE
             OR payload ? 'reportId'
             OR payload ? 'latestReportId'
             OR payload ? 'reportBackfillTaskId'
             OR payload->>'source' = 'report-deep-research-pack'
             OR payload->>'collectionKind' = 'universal_evidence_contract'
           )
           AND (
             $6::boolean IS NOT TRUE
             OR payload->>'createdBy' = 'operator-mechanism-seed'
             OR payload->>'source' = 'operator-mechanism-seed'
             OR payload->>'collectionKind' = 'operator_mechanism_seed'
           )
           AND (cardinality($7::text[]) = 0 OR payload->>'operatorSeedId' = ANY($7::text[]))
         ORDER BY created_at ASC
         LIMIT $1
      )
      RETURNING id`,
    [
      limit,
      reviewer,
      options.reason || 'Approved for current S-tier Research OS convergence run.',
      reportId || null,
      approvalIds.filter((id) => /^\d+$/.test(id)).map((id) => Number(id)),
      operatorOnly,
      operatorSeedIds,
      reportCreatedOnly,
    ],
  );
  return { approvedCount: rows.length, approvalIds: rows.map((row) => String(row.id)) };
}

export async function previewPendingSourceQueries(queryable, options = {}) {
  const limit = Math.max(1, Number(options.limit || 25));
  const reportId = compact(options.reportId);
  const approvalIds = uniqueStrings(options.approvalIds || []);
  const reportCreatedOnly = Boolean(options.reportCreatedOnly);
  const operatorOnly = operatorSeedFilterEnabled(options);
  const operatorSeedIds = operatorSeedIdsFromOptions(options);
  const { rows } = await queryable.query(
    `SELECT id
       FROM approval_queue
      WHERE action_type = 'source-query'
        AND status = 'pending'
        AND (
          $2::text IS NULL
          OR payload->>'reportId' = $2::text
          OR payload->>'latestReportId' = $2::text
        )
        AND (cardinality($3::bigint[]) = 0 OR id = ANY($3::bigint[]))
        AND (
          $6::boolean IS NOT TRUE
          OR payload ? 'reportId'
          OR payload ? 'latestReportId'
          OR payload ? 'reportBackfillTaskId'
          OR payload->>'source' = 'report-deep-research-pack'
          OR payload->>'collectionKind' = 'universal_evidence_contract'
        )
        AND (
          $4::boolean IS NOT TRUE
          OR payload->>'createdBy' = 'operator-mechanism-seed'
          OR payload->>'source' = 'operator-mechanism-seed'
          OR payload->>'collectionKind' = 'operator_mechanism_seed'
        )
        AND (cardinality($5::text[]) = 0 OR payload->>'operatorSeedId' = ANY($5::text[]))
      ORDER BY created_at ASC
      LIMIT $1`,
    [
      limit,
      reportId || null,
      approvalIds.filter((id) => /^\d+$/.test(id)).map((id) => Number(id)),
      operatorOnly,
      operatorSeedIds,
      reportCreatedOnly,
    ],
  );
  return { approvedCount: rows.length, approvalIds: rows.map((row) => String(row.id)), dryRun: true };
}

export async function loadApprovedSourceQueryApprovals(queryable, options = {}) {
  const limit = Math.max(1, Number(options.limit || 25));
  const statuses = options.reprocessExecuted
    ? ['approved', 'needs-fix', 'executed', 'context-collected', 'negative-control-collected', 'weak-noise-collected']
    : (options.retryNeedsFix ? ['approved', 'needs-fix'] : ['approved']);
  const reportId = compact(options.reportId);
  const approvalIds = uniqueStrings(options.approvalIds || []);
  const reportCreatedOnly = Boolean(options.reportCreatedOnly);
  const operatorOnly = operatorSeedFilterEnabled(options);
  const operatorSeedIds = operatorSeedIdsFromOptions(options);
  const { rows } = await queryable.query(
    `SELECT id, payload, reasoning, status, created_at
       FROM approval_queue
      WHERE action_type = 'source-query'
        AND status = ANY($2::text[])
        AND (
          $3::text IS NULL
          OR payload->>'reportId' = $3::text
          OR payload->>'latestReportId' = $3::text
        )
        AND (cardinality($4::bigint[]) = 0 OR id = ANY($4::bigint[]))
        AND (
          $8::boolean IS NOT TRUE
          OR payload ? 'reportId'
          OR payload ? 'latestReportId'
          OR payload ? 'reportBackfillTaskId'
          OR payload->>'source' = 'report-deep-research-pack'
          OR payload->>'collectionKind' = 'universal_evidence_contract'
        )
        AND (
          $6::boolean IS NOT TRUE
          OR payload->>'createdBy' = 'operator-mechanism-seed'
          OR payload->>'source' = 'operator-mechanism-seed'
          OR payload->>'collectionKind' = 'operator_mechanism_seed'
        )
        AND (cardinality($7::text[]) = 0 OR payload->>'operatorSeedId' = ANY($7::text[]))
        AND (
          status <> 'needs-fix'
          OR $5::boolean
          OR payload->'repair'->>'exhausted' IS DISTINCT FROM 'true'
        )
      ORDER BY created_at ASC
      LIMIT $1`,
    [
      limit,
      statuses,
      reportId || null,
      approvalIds.filter((id) => /^\d+$/.test(id)).map((id) => Number(id)),
      Boolean(options.reopenExhausted),
      operatorOnly,
      operatorSeedIds,
      reportCreatedOnly,
    ],
  );
  return rows.map((row) => ({
    ...row,
    payload: row.payload || {},
  }));
}

export async function executeSourceQueryApproval(queryable, approval, options = {}) {
  const policy = options.policy || loadResearchOsPolicy();
  await ensureResearchOsSchema(queryable);
  await ensureAutomationSchema(queryable);
  const invalidBlocker = sourceQueryApprovalBlocker(approval);
  if (invalidBlocker) {
    let operatorSeedOutcome = null;
    if (!options.dryRun) {
      await rejectInvalidSourceQueryApproval(queryable, approval, invalidBlocker);
      operatorSeedOutcome = await updateOperatorSeedEvidenceOutcomeForApproval(queryable, approval, {
        status: 'rejected',
        failureCategory: invalidBlocker,
      });
    }
    return {
      ok: true,
      skipped: true,
      approvalId: String(approval.id),
      status: 'rejected',
      reason: invalidBlocker,
      operatorSeedOutcome,
    };
  }
  const approvalStatus = String(approval.status || 'approved');
  const reprocessableStatus = options.reprocessExecuted
    && ['executed', 'context-collected', 'negative-control-collected', 'weak-noise-collected'].includes(approvalStatus);
  if (!['approved', 'needs-fix'].includes(approvalStatus) && !reprocessableStatus) {
    return { ok: false, skipped: true, approvalId: String(approval.id), reason: 'approval is not approved' };
  }
  const initialCandidate = await loadCandidate(queryable, approval.payload?.candidateId);
  const mergedThemes = evidenceThemes(approval.payload || {}, initialCandidate);
  let activeApproval = mergedThemes.length
    ? { ...approval, payload: { ...(approval.payload || {}), themes: mergedThemes } }
    : approval;
  if (options.reopenExhausted && approvalStatus === 'needs-fix' && activeApproval.payload?.repair?.exhausted === true) {
    activeApproval = {
      ...activeApproval,
      payload: {
        ...activeApproval.payload,
        repair: {
          ...(activeApproval.payload.repair || {}),
          attempt: 0,
          exhausted: false,
          reopenedAt: new Date().toISOString(),
          reopenedReason: 'operator requested source-query retry with improved class-specific variants',
        },
      },
    };
  }
  let repair = { changed: false, exhausted: false, suggestedQueries: [] };
  if (approvalStatus === 'needs-fix') {
    repair = repairSourceQueryApprovalPayload(activeApproval, initialCandidate, policy);
    activeApproval = { ...activeApproval, payload: repair.payload };
    if (repair.changed && !options.dryRun) {
      await queryable.query(
        `UPDATE approval_queue
            SET payload = $2::jsonb,
                reasoning = CONCAT(COALESCE(reasoning, ''), CASE WHEN COALESCE(reasoning, '') = '' THEN '' ELSE E'\n' END, $3::text),
                updated_at = NOW()
          WHERE id = $1`,
        [approval.id, JSON.stringify(activeApproval.payload), `source-query-executor: rewritten query for retry attempt ${repair.attempt}`],
      ).catch(async () => {
        await queryable.query(
          `UPDATE approval_queue
              SET payload = $2::jsonb,
                  reasoning = CONCAT(COALESCE(reasoning, ''), CASE WHEN COALESCE(reasoning, '') = '' THEN '' ELSE E'\n' END, $3::text)
            WHERE id = $1`,
          [approval.id, JSON.stringify(activeApproval.payload), `source-query-executor: rewritten query for retry attempt ${repair.attempt}`],
        );
      });
    }
  }
  if (approvalStatus === 'needs-fix' && repair.exhausted) {
    let operatorSeedOutcome = null;
    if (!options.dryRun && activeApproval.payload?.repair?.exhausted !== true) {
      await markSourceQueryRetryExhausted(queryable, approval.id, repair);
      operatorSeedOutcome = await updateOperatorSeedEvidenceOutcomeForApproval(queryable, activeApproval, {
        status: 'needs-fix',
        failureCategory: 'retry-exhausted',
      });
    }
    return {
      ok: true,
      skipped: true,
      approvalId: String(approval.id),
      status: 'needs-fix',
      reason: 'retry attempts exhausted',
      suggestedQueries: repair.suggestedQueries,
      operatorSeedOutcome,
    };
  }
  const questionPayload = buildSourceQueryQuestionPayload(activeApproval);
  const question = options.dryRun
    ? {
      id: questionPayload.id,
      question_type: questionPayload.questionType,
      themes: questionPayload.themes,
      seed_terms: questionPayload.seedTerms,
      prompt: questionPayload.prompt,
      trigger_reason: questionPayload.triggerReason,
      metadata: questionPayload.metadata,
    }
    : await upsertSourceQueryResearchQuestion(queryable, questionPayload);
  const perQueryLimit = Math.max(1, Number(options.perQueryLimit || requirePolicyNumber(policy, 'sourceExpansion.perQueryEvidenceLimit')));
  const collected = await collectEvidenceForQuestion(queryable, question, { limit: perQueryLimit });
  let externalResult = { bundles: [], error: null };
  const externalTrigger = requirePolicyNumber(policy, 'sourceExpansion.externalRssTriggerBelowAccepted');
  let allScoredBundles = scoreAllSourceQueryBundles(collected.bundles, activeApproval, policy);
  let promotionBundles = allScoredBundles.filter((bundle) => bundle.promotionEligible);
  if (promotionBundles.length < externalTrigger) {
    externalResult = await collectExternalRssBundles(question, activeApproval, policy);
    allScoredBundles = scoreAllSourceQueryBundles([...collected.bundles, ...externalResult.bundles], activeApproval, policy);
    promotionBundles = allScoredBundles.filter((bundle) => bundle.promotionEligible);
  }
  const persistedBundles = allScoredBundles
    .filter((bundle) => bundle.persistable)
    .slice(0, perQueryLimit)
    .map((bundle) => ({
      ...bundle,
      questionId: question.id,
      metadata: {
        ...(bundle.metadata || {}),
        approvalId: String(approval.id),
        candidateId: activeApproval.payload?.candidateId ? String(activeApproval.payload.candidateId) : null,
        reportId: activeApproval.payload?.latestReportId || activeApproval.payload?.reportId || null,
        reportType: activeApproval.payload?.reportType || null,
        reportBackfillTaskId: activeApproval.payload?.reportBackfillTaskId || null,
        reportBackfillPackName: activeApproval.payload?.packName || null,
        reportSubjectKey: activeApproval.payload?.subjectKey || null,
        reportSubjectDisplay: payloadSubjectDisplay(activeApproval.payload) || null,
        collectionKind: activeApproval.payload?.collectionKind || null,
        createdBy: activeApproval.payload?.createdBy || activeApproval.payload?.source || null,
        operatorSeedId: activeApproval.payload?.operatorSeedId || null,
        operatorSeedTitle: activeApproval.payload?.seedTitle || null,
        operatorSeedStatus: activeApproval.payload?.seedStatus || null,
        adjacentCandidateKey: activeApproval.payload?.adjacentCandidateKey || null,
        adjacentLane: activeApproval.payload?.adjacentLane || null,
        adjacentStatus: activeApproval.payload?.adjacentStatus || null,
        sourceTerms: activeApproval.payload?.sourceTerms || [],
        seedTerms: activeApproval.payload?.seedTerms || [],
        evidenceClasses: activeApproval.payload?.evidenceClasses || [],
        failureReason: activeApproval.payload?.failureReason || null,
        sourceQueryRelevance: bundle.sourceQueryRelevance,
        evidenceStrength: bundle.evidenceStrength,
        desiredEvidenceClass: bundle.desiredEvidenceClass || null,
        evidenceUse: bundle.evidenceUse || null,
        issuerUniverse: activeApproval.payload?.issuerUniverse || activeApproval.payload?.issuerHints || [],
        negativeControlFinding: bundle.negativeControlFinding || null,
        negativeControlClosure: bundle.desiredEvidenceClass === 'negative_control' ? (bundle.negativeControlFinding || null) : null,
        relevanceTier: bundle.relevanceTier || null,
        providerRoutePlan: activeApproval.payload?.providerRoutePlan || providerRoutePlanFromPayload(activeApproval.payload, initialCandidate),
        factsExtracted: bundle.factsExtracted || [],
        factKeys: bundle.factKeys || [],
        missingFacts: bundle.missingFacts || [],
        requiredFacts: bundle.requiredFacts || [],
        acceptanceVerdict: bundle.acceptanceVerdict || bundle.evidenceUse || null,
        collectorCapability: bundle.collectorCapability || null,
        closureReason: bundle.closureReason || closureReasonForEvidenceUse(bundle.evidenceUse),
        promotionEligible: Boolean(bundle.promotionEligible),
        persistable: Boolean(bundle.persistable),
        usableEvidence: Boolean(bundle.usableEvidence),
        scoring: bundle.scoring || {},
      },
    }));
  promotionBundles = persistedBundles.filter((bundle) => bundle.promotionEligible);
  const tierCounts = sourceQueryTierCounts(persistedBundles);
  const desiredEvidenceClass = desiredEvidenceClassFromPayload(activeApproval.payload || {});
  const negativeControlClosure = negativeControlClosureForBundles(persistedBundles, desiredEvidenceClass);
  if (options.dryRun) {
    return {
      ok: true,
      dryRun: true,
      approvalId: String(approval.id),
      candidateId: activeApproval.payload?.candidateId ? String(activeApproval.payload.candidateId) : null,
      collectedCount: collected.bundles.length + externalResult.bundles.length,
      externalCollectedCount: externalResult.bundles.length,
      externalError: externalResult.error,
      acceptedBundleCount: promotionBundles.length,
      negativeControlClosure,
      ...tierCounts,
      repair,
    };
  }
  await persistEvidenceBundles(queryable, persistedBundles);
  const candidate = initialCandidate || await loadCandidate(queryable, activeApproval.payload?.candidateId);
  await deleteSourceQueryEdgeEvidenceForApproval(queryable, approval.id);
  const edgeResult = await upsertCandidateEvidenceEdges(queryable, candidate, activeApproval, promotionBundles, policy);
  if (candidate) {
    await updateCandidateEvidenceSummary(queryable, candidate, edgeResult, promotionBundles.length, tierCounts, approval.id);
  }
  const status = promotionBundles.length
    ? 'executed'
    : (tierCounts.negativeControlCount > 0
      ? 'negative-control-collected'
      : (tierCounts.contextBundleCount > 0
        ? 'context-collected'
        : (tierCounts.noiseCount > 0 ? 'weak-noise-collected' : 'needs-fix')));
  const retryExhaustedAfterThisRun = approvalStatus === 'needs-fix'
    && Number(repair.attempt || 0) >= requirePolicyNumber(policy, 'sourceExpansion.retry.maxAttempts');
  const failureCategory = classifySourceQueryFailure({
    collectedCount: collected.bundles.length,
    externalCollectedCount: externalResult.bundles.length,
    acceptedBundleCount: promotionBundles.length,
    ...tierCounts,
    edgeCount: edgeResult.edgeCount,
    directEvidenceCount: edgeResult.directEvidenceCount,
    externalError: externalResult.error,
  });
  await updateSourceQueryOutcomeMetadata(queryable, activeApproval, {
    status,
    failureCategory,
    collectedCount: collected.bundles.length,
    externalCollectedCount: externalResult.bundles.length,
    acceptedBundleCount: promotionBundles.length,
    negativeControlClosure,
    ...tierCounts,
  });
  const operatorSeedOutcome = await updateOperatorSeedEvidenceOutcomeForApproval(queryable, activeApproval, {
    status,
    failureCategory,
    collectedCount: collected.bundles.length,
    externalCollectedCount: externalResult.bundles.length,
    acceptedBundleCount: promotionBundles.length,
    negativeControlClosure,
    ...tierCounts,
  });
  if (status === 'needs-fix') {
    await updateCandidateSourceQueryFailure(queryable, candidate, {
      category: failureCategory,
      query: activeApproval.payload?.query || '',
      collected: collected.bundles.length,
      external: externalResult.bundles.length,
      accepted: promotionBundles.length,
      persisted: tierCounts.persistedBundleCount,
      context: tierCounts.contextBundleCount,
      negativeControl: tierCounts.negativeControlCount,
      noise: tierCounts.noiseCount,
      externalError: externalResult.error || null,
      suggestedQueries: repair.suggestedQueries?.length ? repair.suggestedQueries : buildSourceQueryRetryVariants(activeApproval, candidate, policy),
    });
    if (retryExhaustedAfterThisRun && !options.dryRun) {
      await markSourceQueryRetryExhausted(queryable, approval.id, repair);
    }
  }
  await markApproval(
    queryable,
    approval.id,
    status,
    `source-query-executor: ${status}; failure=${failureCategory}; collected=${collected.bundles.length}; external=${externalResult.bundles.length}; accepted=${promotionBundles.length}; persisted=${tierCounts.persistedBundleCount}; context=${tierCounts.contextBundleCount}; negative=${tierCounts.negativeControlCount}; noise=${tierCounts.noiseCount}; edges=${edgeResult.edgeCount}; edgeEvidence=${edgeResult.edgeEvidenceCount}${repair.changed ? `; repairAttempt=${repair.attempt}` : ''}${retryExhaustedAfterThisRun ? '; retryExhausted=true' : ''}${externalResult.error ? `; externalError=${externalResult.error}` : ''}`,
  );
  return {
    ok: true,
    approvalId: String(approval.id),
    status,
    candidateId: activeApproval.payload?.candidateId ? String(activeApproval.payload.candidateId) : null,
    questionId: String(question.id),
    collectedCount: collected.bundles.length + externalResult.bundles.length,
    externalCollectedCount: externalResult.bundles.length,
    externalError: externalResult.error,
    acceptedBundleCount: promotionBundles.length,
    negativeControlClosure,
    ...tierCounts,
    failureCategory,
    operatorSeedOutcome,
    repair,
    ...edgeResult,
  };
}

export async function executeApprovedSourceQueries(queryable, options = {}) {
  await ensureResearchOsSchema(queryable);
  await ensureAutomationSchema(queryable);
  const quarantine = await quarantineInvalidSourceQueryApprovals(queryable, {
    dryRun: options.dryRun,
    limit: Math.max(100, Number(options.limit || 25) * 10),
    reportId: options.reportId,
    reportCreatedOnly: options.reportCreatedOnly,
    operatorSeedCreatedOnly: options.operatorSeedCreatedOnly,
    operatorSeedIds: options.operatorSeedIds,
  });
  const approved = options.approvePending
    ? await (options.dryRun ? previewPendingSourceQueries : approvePendingSourceQueries)(queryable, {
      limit: options.limit,
      reviewer: options.reviewer,
      reason: options.approvalReason,
      reportId: options.reportId,
      approvalIds: options.approvalIds,
      reportCreatedOnly: options.reportCreatedOnly,
      operatorSeedCreatedOnly: options.operatorSeedCreatedOnly,
      operatorSeedIds: options.operatorSeedIds,
    })
    : { approvedCount: 0, approvalIds: [] };
  const approvals = await loadApprovedSourceQueryApprovals(queryable, options);
  const concurrency = Math.max(1, Math.min(12, Number(options.concurrency || 1)));
  const results = await runLimited(
    approvals,
    concurrency,
    async (approval) => {
      const useDedicatedClient = concurrency > 1 && typeof options.createWorkerClient === 'function';
      const workerClient = useDedicatedClient ? await options.createWorkerClient() : queryable;
      try {
        return await executeSourceQueryApproval(workerClient, approval, options);
      } finally {
        if (useDedicatedClient) await workerClient.end().catch(() => {});
      }
    },
  );
  return {
    ok: true,
    dryRun: Boolean(options.dryRun),
    quarantine,
    approvedPending: approved,
    processedCount: results.length,
    executedCount: results.filter((item) => item.status === 'executed').length,
    contextCollectedCount: results.filter((item) => item.status === 'context-collected').length,
    negativeControlCollectedCount: results.filter((item) => item.status === 'negative-control-collected').length,
    weakNoiseCollectedCount: results.filter((item) => item.status === 'weak-noise-collected').length,
    needsFixCount: results.filter((item) => item.status === 'needs-fix').length,
    evidenceInserted: results.reduce((sum, item) => sum + Number(item.acceptedBundleCount || 0), 0),
    persistedEvidenceInserted: results.reduce((sum, item) => sum + Number(item.persistedBundleCount || 0), 0),
    promotionBundleCount: results.reduce((sum, item) => sum + Number(item.promotionBundleCount || 0), 0),
    contextBundleCount: results.reduce((sum, item) => sum + Number(item.contextBundleCount || 0), 0),
    negativeControlCount: results.reduce((sum, item) => sum + Number(item.negativeControlCount || 0), 0),
    noiseCount: results.reduce((sum, item) => sum + Number(item.noiseCount || 0), 0),
    edgeEvidenceInserted: results.reduce((sum, item) => sum + Number(item.edgeEvidenceCount || 0), 0),
    operatorSeedOutcomeCount: results.filter((item) => item.operatorSeedOutcome?.ok).length,
    results,
  };
}
