export const FERC_INTERCONNECTION_REFORM_READONLY_VERSION = 'ferc-interconnection-reform-readonly-v2';

export const FERC_INTERCONNECTION_REFORM_SUPPORTED_EVIDENCE_CLASSES = Object.freeze([
  'engineering_process',
  'permitting_regulatory',
]);

export const FERC_INTERCONNECTION_REFORM_ALLOWED_SOURCE_GROUPS = Object.freeze([
  'official_government',
  'official_ferc_rulemaking',
]);

export const FERC_INTERCONNECTION_REFORM_SUBJECT_TERMS = Object.freeze([
  'FERC',
  'generator interconnection',
  'interconnection reform',
  'interconnection queue',
  'interconnection study',
  'interconnection procedures',
  'generator interconnection agreement',
  'cluster study',
  'network upgrade',
  'transmission provider',
  'Order No. 2023',
]);

export const FERC_INTERCONNECTION_REFORM_OPERATING_TERMS = Object.freeze([
  'queue processing',
  'study deadline',
  'processing capacity',
  'study delay',
  'cost allocation',
  'commercial readiness',
  'withdrawal penalty',
  'site control',
  'affected system',
  'first-ready',
  'project delay',
]);

export const FERC_INTERCONNECTION_REFORM_PERMITTING_REGULATORY_TERMS = Object.freeze([
  'final rule',
  'compliance filing',
  'tariff revisions',
  'interconnection procedures',
  'generator interconnection agreement',
  'regulatory requirement',
  'site control',
  'commercial readiness deposits',
  'withdrawal penalties',
  'affected system coordination',
]);

export const DEFAULT_FERC_INTERCONNECTION_REFORM_FIXTURES = Object.freeze([
  {
    fixtureId: 'positive_operating_bridge_fixture',
    fixtureKind: 'positive_operating_bridge_fixture',
    sourceGroup: 'official_government',
    sourceFamily: 'ferc_interconnection_reform',
    sourceIndependence: 'official_government_rulemaking',
    sourceUrl: 'https://www.ferc.gov/news-events/news/fact-sheet-improvements-generator-interconnection-procedures-and-agreements',
    documentTitle: 'FERC generator interconnection reform rulemaking fixture',
    documentType: 'ferc_rulemaking_fixture',
    documentDate: '2023-07-27',
    rawTextSnippet: 'Official FERC interconnection reform fixture: Order No. 2023 final rule requires transmission providers to file tariff revisions for generator interconnection procedures and pro forma generator interconnection agreements. The regulatory requirement uses first-ready, first-served cluster studies, firm study deadlines, affected system coordination, commercial readiness deposits, site control, and standard network upgrade cost allocation. The process changes link generator interconnection queues to queue processing capacity, study delay reduction, withdrawal penalties, compliance filings, and faster project interconnection.',
  },
  {
    fixtureId: 'no_result_fixture',
    fixtureKind: 'no_result_fixture',
    sourceGroup: 'official_government',
    sourceFamily: 'ferc_document_search',
    sourceIndependence: 'official_government_rulemaking',
    sourceUrl: 'https://www.ferc.gov/search/no-result-interconnection-reform-fixture',
    documentTitle: 'FERC interconnection reform no-result fixture',
    documentType: 'ferc_search_fixture',
    documentDate: '2023-07-27',
    rawTextSnippet: '',
  },
  {
    fixtureId: 'timeout_or_source_unavailable_fixture',
    fixtureKind: 'timeout_or_source_unavailable_fixture',
    sourceGroup: 'official_government',
    sourceFamily: 'ferc_interconnection_reform',
    sourceIndependence: 'official_government_rulemaking',
    sourceUrl: 'https://www.ferc.gov/source-unavailable-interconnection-reform-fixture',
    documentTitle: 'FERC source unavailable fixture',
    documentType: 'ferc_timeout_fixture',
    documentDate: '2023-07-27',
    rawTextSnippet: '',
  },
  {
    fixtureId: 'ticker_only_rejection_fixture',
    fixtureKind: 'ticker_only_rejection_fixture',
    sourceGroup: 'official_government',
    sourceFamily: 'ferc_document_search',
    sourceIndependence: 'official_government_rulemaking',
    sourceUrl: 'https://www.ferc.gov/search/ticker-only-interconnection-reform-fixture',
    documentTitle: 'FERC ticker-only rejection fixture',
    documentType: 'ferc_identifier_lookup_fixture',
    documentDate: '2023-07-27',
    rawTextSnippet: 'FERC RM22-14 Order No. 2023',
    tickerOnly: true,
  },
  {
    fixtureId: 'raw_metadata_only_rejection_fixture',
    fixtureKind: 'raw_metadata_only_rejection_fixture',
    sourceGroup: 'official_government',
    sourceFamily: 'ferc_document_search',
    sourceIndependence: 'official_government_rulemaking',
    sourceUrl: 'https://www.ferc.gov/search/raw-metadata-only-interconnection-reform-fixture',
    documentTitle: 'FERC metadata-only rejection fixture',
    documentType: 'ferc_metadata_fixture',
    documentDate: '2023-07-27',
    rawTextSnippet: 'FERC metadata: docket=RM22-14 documentType=final rule orderNumber=2023 commission=Federal Energy Regulatory Commission',
    rawMetadataOnly: true,
  },
]);

const ZERO_MUTATION_BOUNDARY = Object.freeze({
  providerActivationWrites: 0,
  sourceRegistryWrites: 0,
  canonicalWrites: 0,
  readinessPromotionWrites: 0,
  reportCandidateWrites: 0,
  portfolioActionWrites: 0,
});

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (value === null || value === undefined || value === '') return [];
  return [value];
}

function compact(value = '') {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function uniqueStrings(values = [], limit = 100) {
  const seen = new Set();
  const out = [];
  for (const value of values.flatMap(asArray)) {
    const text = compact(value);
    if (!text) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(text);
    if (out.length >= limit) break;
  }
  return out;
}

export function normalizeFercInterconnectionReformEvidenceClass(value = '') {
  const evidenceClass = compact(value).toLowerCase();
  return FERC_INTERCONNECTION_REFORM_SUPPORTED_EVIDENCE_CLASSES.includes(evidenceClass)
    ? evidenceClass
    : 'engineering_process';
}

function subjectTermsForEvidenceClass(evidenceClass = 'engineering_process', terms = []) {
  return uniqueStrings([
    FERC_INTERCONNECTION_REFORM_SUBJECT_TERMS,
    terms,
    normalizeFercInterconnectionReformEvidenceClass(evidenceClass) === 'permitting_regulatory'
      ? ['final rule', 'tariff revisions', 'compliance filing']
      : [],
  ], 120);
}

function operatingTermsForEvidenceClass(evidenceClass = 'engineering_process', terms = []) {
  return uniqueStrings([
    FERC_INTERCONNECTION_REFORM_OPERATING_TERMS,
    normalizeFercInterconnectionReformEvidenceClass(evidenceClass) === 'permitting_regulatory'
      ? FERC_INTERCONNECTION_REFORM_PERMITTING_REGULATORY_TERMS
      : [],
    terms,
  ], 120);
}

function textIncludes(text = '', term = '') {
  return String(text || '').toLowerCase().includes(String(term || '').toLowerCase());
}

function termsMatched(text = '', terms = []) {
  return uniqueStrings(asArray(terms).filter((term) => textIncludes(text, term)), 80);
}

function bodyText(row = {}) {
  return compact([
    row.rawTextSnippet,
    row.extractedTextSnippet,
    row.operatingBridgeSnippet,
    row.textExcerpt,
    row.bodyText,
    row.text,
  ].join(' '));
}

function allowedSourceGroup(row = {}) {
  return FERC_INTERCONNECTION_REFORM_ALLOWED_SOURCE_GROUPS.includes(String(row.sourceGroup || '').toLowerCase());
}

export function findFercInterconnectionReformBridge(text = '', {
  subjectTerms = FERC_INTERCONNECTION_REFORM_SUBJECT_TERMS,
  operatingTerms = FERC_INTERCONNECTION_REFORM_OPERATING_TERMS,
  windowChars = 1400,
} = {}) {
  const body = compact(text);
  const lower = body.toLowerCase();
  const matchedSubjectTerms = termsMatched(body, subjectTerms);
  const matchedOperatingTerms = termsMatched(body, operatingTerms);
  if (!matchedSubjectTerms.length || !matchedOperatingTerms.length) {
    return {
      matched: false,
      matchedSubjectTerms,
      matchedOperatingTerms,
      proximityWindow: windowChars,
      proximityScore: 0,
      operatingBridgeSnippet: body.slice(0, Math.min(900, body.length)),
    };
  }

  for (const subjectTerm of matchedSubjectTerms) {
    const subjectIndex = lower.indexOf(subjectTerm.toLowerCase());
    for (const operatingTerm of matchedOperatingTerms) {
      const operatingIndex = lower.indexOf(operatingTerm.toLowerCase());
      if (subjectIndex >= 0 && operatingIndex >= 0 && Math.abs(subjectIndex - operatingIndex) <= windowChars) {
        const start = Math.max(0, Math.min(subjectIndex, operatingIndex) - 360);
        return {
          matched: true,
          matchedSubjectTerms,
          matchedOperatingTerms,
          proximityWindow: windowChars,
          proximityScore: 1 - Math.min(1, Math.abs(subjectIndex - operatingIndex) / windowChars),
          operatingBridgeSnippet: body.slice(start, start + Math.min(1000, windowChars + 240)),
        };
      }
    }
  }

  return {
    matched: false,
    matchedSubjectTerms,
    matchedOperatingTerms,
    proximityWindow: windowChars,
    proximityScore: 0,
    operatingBridgeSnippet: body.slice(0, Math.min(900, body.length)),
  };
}

export function fercInterconnectionReformAcceptanceDetail(row = {}, {
  subjectTerms = FERC_INTERCONNECTION_REFORM_SUBJECT_TERMS,
  operatingTerms = FERC_INTERCONNECTION_REFORM_OPERATING_TERMS,
  windowChars = 1400,
  evidenceClass = row.evidenceClass || row.desiredEvidenceClass,
} = {}) {
  const normalizedEvidenceClass = normalizeFercInterconnectionReformEvidenceClass(evidenceClass);
  const text = bodyText(row);
  const bridge = findFercInterconnectionReformBridge(text, {
    subjectTerms: subjectTermsForEvidenceClass(normalizedEvidenceClass, subjectTerms),
    operatingTerms: operatingTermsForEvidenceClass(normalizedEvidenceClass, operatingTerms),
    windowChars,
  });
  const rejectionReasons = [];
  if (!allowedSourceGroup(row)) rejectionReasons.push('source_group_not_allowed_for_ferc_interconnection_reform');
  if (!text) rejectionReasons.push('body_snippet_missing');
  if (row.tickerOnly === true) rejectionReasons.push('ticker_only');
  if (row.rawMetadataOnly === true) rejectionReasons.push('raw_metadata_only');
  if (!bridge.matchedSubjectTerms.length) rejectionReasons.push('subject_term_missing_in_body');
  if (!bridge.matchedOperatingTerms.length) rejectionReasons.push('operating_bridge_missing_in_body');
  if (bridge.matchedSubjectTerms.length && bridge.matchedOperatingTerms.length && !bridge.matched) {
    rejectionReasons.push('subject_operating_terms_not_proximate');
  }
  return {
    accepted: rejectionReasons.length === 0,
    rejectionReasons,
    matchedSubjectTerms: bridge.matchedSubjectTerms,
    matchedOperatingTerms: bridge.matchedOperatingTerms,
    operatingBridgeSnippet: bridge.operatingBridgeSnippet,
    proximityWindow: bridge.proximityWindow,
    proximityScore: bridge.proximityScore,
  };
}

function fixtureFailureClassification(source = {}, detail = {}) {
  switch (source.fixtureKind) {
    case 'timeout_or_source_unavailable_fixture':
      return 'TIMEOUT';
    case 'no_result_fixture':
      return 'NO_RESULT';
    case 'ticker_only_rejection_fixture':
      return 'TICKER_ONLY';
    case 'raw_metadata_only_rejection_fixture':
      return 'WEAK_EVIDENCE';
    default:
      return detail.accepted ? 'ACCEPTED' : 'WEAK_EVIDENCE';
  }
}

export function buildFercInterconnectionReformRawEvidence(source = {}, {
  seedId = 'ferc-interconnection-reform-seed',
  taskId = null,
  generatedAt = new Date().toISOString(),
  index = 0,
  evidenceClass = source.evidenceClass || source.desiredEvidenceClass || 'engineering_process',
  subjectTerms = FERC_INTERCONNECTION_REFORM_SUBJECT_TERMS,
  operatingTerms = FERC_INTERCONNECTION_REFORM_OPERATING_TERMS,
  windowChars = 1400,
} = {}) {
  const normalizedEvidenceClass = normalizeFercInterconnectionReformEvidenceClass(evidenceClass);
  const rawTextSnippet = compact(source.rawTextSnippet || source.fixtureText || source.extractedTextSnippet || '');
  const detail = fercInterconnectionReformAcceptanceDetail({
    ...source,
    evidenceClass: normalizedEvidenceClass,
    desiredEvidenceClass: normalizedEvidenceClass,
    rawTextSnippet,
  }, { evidenceClass: normalizedEvidenceClass, subjectTerms, operatingTerms, windowChars });
  const failureClassification = source.failureClassification || fixtureFailureClassification(source, detail);
  const accepted = failureClassification === 'ACCEPTED' && detail.accepted;
  const rejectionReason = accepted ? null : uniqueStrings([
    failureClassification,
    detail.rejectionReasons,
  ], 16).join(',');
  const documentTitle = compact(source.documentTitle || source.title || source.fixtureId || `FERC interconnection reform fixture ${index}`);
  const summary = accepted
    ? `Official FERC interconnection reform engineering-process bridge: ${detail.operatingBridgeSnippet}`
    : `FERC interconnection reform fixture rejected: ${rejectionReason || failureClassification}`;

  return {
    evidenceId: `ferc_interconnection_reform:${normalizedEvidenceClass}:${seedId}:${source.fixtureId || `fixture-${index}`}`,
    taskId,
    seedId,
    providerName: 'ferc_interconnection_reform',
    evidenceClass: normalizedEvidenceClass,
    desiredEvidenceClass: normalizedEvidenceClass,
    source: 'ferc_interconnection_reform',
    provider: 'ferc_interconnection_reform',
    sourceProvider: 'ferc_interconnection_reform',
    providerRoute: 'ferc_interconnection_reform',
    sourceType: 'official_government',
    sourceGroup: source.sourceGroup || 'official_government',
    sourceFamily: source.sourceFamily || 'ferc_interconnection_reform',
    sourceUrl: source.sourceUrl || null,
    documentTitle,
    title: documentTitle,
    documentType: source.documentType || 'ferc_rulemaking_fixture',
    documentDate: source.documentDate || source.publishedAt || null,
    publishedAt: source.publishedAt || null,
    observedAt: generatedAt,
    rawTextSnippet,
    extractedTextSnippet: rawTextSnippet,
    textExcerpt: rawTextSnippet,
    summary,
    matchedSubjectTerms: detail.matchedSubjectTerms,
    matchedOperatingTerms: detail.matchedOperatingTerms,
    operatingBridgeSnippet: detail.operatingBridgeSnippet,
    sourceIndependence: source.sourceIndependence || 'official_government_rulemaking',
    proximityWindow: detail.proximityWindow,
    proximityScore: detail.proximityScore,
    fixtureKind: source.fixtureKind || source.fixtureId || 'unspecified_fixture',
    fixtureBackedProviderExecution: true,
    validationFixtureOnly: false,
    failureClassification,
    rejectionReason,
    acceptanceReason: accepted ? 'official_ferc_rulemaking_with_subject_and_operating_bridge' : null,
    acceptanceVerdict: accepted ? 'accepted' : 'not_evaluated_ferc_interconnection_reform_raw',
    accepted,
    promotionEligible: false,
    evidenceUse: accepted ? 'supporting_context' : 'weak_noise',
    coveredEvidenceClasses: [],
    generatedAt,
    collectedAt: generatedAt,
    mutationBoundary: { ...ZERO_MUTATION_BOUNDARY },
  };
}

export function collectFercInterconnectionReformReadonly({
  seedId = 'ferc-interconnection-reform-seed',
  task = {},
  evidenceClass = task.evidenceClass || task.desiredEvidenceClass || 'engineering_process',
  generatedAt = new Date().toISOString(),
  sourceAllowlist = DEFAULT_FERC_INTERCONNECTION_REFORM_FIXTURES,
  maxSources = 5,
  subjectTerms = FERC_INTERCONNECTION_REFORM_SUBJECT_TERMS,
  operatingTerms = FERC_INTERCONNECTION_REFORM_OPERATING_TERMS,
  windowChars = 1400,
} = {}) {
  const normalizedEvidenceClass = normalizeFercInterconnectionReformEvidenceClass(evidenceClass);
  const taskSubjectTerms = uniqueStrings([
    subjectTermsForEvidenceClass(normalizedEvidenceClass, subjectTerms),
    task.acceptanceCriteria?.requiredTerms,
    task.acceptanceCriteria?.keyTerms,
    task.acceptanceCriteria?.matchTerms,
  ], 80);
  const taskOperatingTerms = uniqueStrings([
    operatingTermsForEvidenceClass(normalizedEvidenceClass, operatingTerms),
    task.acceptanceCriteria?.bridgeTerms,
  ], 80);
  const rawEvidence = asArray(sourceAllowlist)
    .slice(0, Number(maxSources || 5))
    .map((source, index) => buildFercInterconnectionReformRawEvidence(source, {
      seedId: seedId || task.seedId || 'ferc-interconnection-reform-seed',
      taskId: task.taskId || null,
      generatedAt,
      index,
      evidenceClass: normalizedEvidenceClass,
      subjectTerms: taskSubjectTerms.length ? taskSubjectTerms : subjectTerms,
      operatingTerms: taskOperatingTerms.length ? taskOperatingTerms : operatingTerms,
      windowChars,
    }));
  return {
    version: FERC_INTERCONNECTION_REFORM_READONLY_VERSION,
    source: 'ferc-interconnection-reform-readonly',
    providerName: 'ferc_interconnection_reform',
    evidenceClass: normalizedEvidenceClass,
    supportedEvidenceClasses: [...FERC_INTERCONNECTION_REFORM_SUPPORTED_EVIDENCE_CLASSES],
    rawEvidence,
    sourceGroupsUsed: uniqueStrings(rawEvidence.map((row) => row.sourceGroup), 20),
    sourceFamiliesUsed: uniqueStrings(rawEvidence.map((row) => row.sourceFamily), 20),
    fixtureKindsCovered: uniqueStrings(rawEvidence.map((row) => row.fixtureKind), 20),
    fixtureRequired: true,
    acceptedCandidateCount: rawEvidence.filter((row) => row.accepted === true).length,
    failureClassifications: rawEvidence.reduce((counts, row) => {
      const key = row.failureClassification || 'WEAK_EVIDENCE';
      counts[key] = (counts[key] || 0) + 1;
      return counts;
    }, {}),
    acceptanceSafety: {
      rawEvidenceAutoPromotes: false,
      tickerOnlyAccepted: false,
      rawMetadataOnlyAccepted: false,
      weakSourceQueryAccepted: false,
    },
    mutationBoundary: { ...ZERO_MUTATION_BOUNDARY },
  };
}
