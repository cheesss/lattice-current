export const TDNET_READONLY_VERSION = 'tdnet-readonly-v1';

export const TDNET_ISSUER_EXPOSURE_ALLOWED_SOURCE_GROUPS = Object.freeze([
  'official_tdnet_disclosure',
  'non_us_official_disclosure',
]);

export const TDNET_ISSUER_EXPOSURE_SUBJECT_TERMS = Object.freeze([
  'ABF',
  'ABF substrate',
  'IC substrate',
  'package substrate',
  'semiconductor package',
  'high-end substrate',
  'AI server',
  'substrate',
]);

export const TDNET_ISSUER_EXPOSURE_OPERATING_TERMS = Object.freeze([
  'capacity',
  'capacity expansion',
  'capital expenditure',
  'capex',
  'production line',
  'customer demand',
  'sales',
  'revenue',
  'orders',
  'backlog',
  'guidance',
]);

export const DEFAULT_TDNET_ISSUER_EXPOSURE_FIXTURES = Object.freeze([
  {
    fixtureId: 'positive_operating_bridge_fixture',
    fixtureKind: 'positive_operating_bridge_fixture',
    issuer: '4062',
    issuerName: 'IBIDEN Co., Ltd.',
    sourceGroup: 'official_tdnet_disclosure',
    sourceFamily: 'tdnet_timely_disclosure_pdf',
    sourceIndependence: 'issuer_official_disclosure',
    sourceUrl: 'https://www.release.tdnet.info/inbs/140120260523000001.pdf',
    documentTitle: 'IBIDEN TDnet timely disclosure issuer exposure fixture',
    documentType: 'tdnet_timely_disclosure_fixture',
    documentDate: '2026-05-23',
    rawTextSnippet: 'Official TDnet timely disclosure fixture: IBIDEN describes ABF substrate and high-end IC substrate products in its electronics segment. The company disclosure links AI server customer demand to capacity expansion, production line investment, capital expenditure, sales, revenue, orders, and guidance for the substrate business.',
  },
  {
    fixtureId: 'no_result_fixture',
    fixtureKind: 'no_result_fixture',
    issuer: '4062',
    issuerName: 'IBIDEN Co., Ltd.',
    sourceGroup: 'official_tdnet_disclosure',
    sourceFamily: 'tdnet_document_search',
    sourceIndependence: 'issuer_official_disclosure',
    sourceUrl: 'https://www.release.tdnet.info/inbs/no-result-fixture.html',
    documentTitle: 'TDnet issuer exposure no-result fixture',
    documentType: 'tdnet_search_fixture',
    documentDate: '2026-05-23',
    rawTextSnippet: '',
  },
  {
    fixtureId: 'timeout_or_source_unavailable_fixture',
    fixtureKind: 'timeout_or_source_unavailable_fixture',
    issuer: '4062',
    issuerName: 'IBIDEN Co., Ltd.',
    sourceGroup: 'official_tdnet_disclosure',
    sourceFamily: 'tdnet_timely_disclosure_pdf',
    sourceIndependence: 'issuer_official_disclosure',
    sourceUrl: 'https://www.release.tdnet.info/source-unavailable-fixture',
    documentTitle: 'TDnet source unavailable fixture',
    documentType: 'tdnet_timeout_fixture',
    documentDate: '2026-05-23',
    rawTextSnippet: '',
  },
  {
    fixtureId: 'ticker_only_rejection_fixture',
    fixtureKind: 'ticker_only_rejection_fixture',
    issuer: '4062',
    issuerName: 'IBIDEN Co., Ltd.',
    sourceGroup: 'official_tdnet_disclosure',
    sourceFamily: 'tdnet_document_search',
    sourceIndependence: 'issuer_official_disclosure',
    sourceUrl: 'https://www.release.tdnet.info/inbs/ticker-only-fixture.html',
    documentTitle: 'TDnet ticker-only rejection fixture',
    documentType: 'tdnet_ticker_lookup_fixture',
    documentDate: '2026-05-23',
    rawTextSnippet: '4062 IBIDEN Co., Ltd.',
    tickerOnly: true,
  },
  {
    fixtureId: 'raw_metadata_only_rejection_fixture',
    fixtureKind: 'raw_metadata_only_rejection_fixture',
    issuer: '4062',
    issuerName: 'IBIDEN Co., Ltd.',
    sourceGroup: 'official_tdnet_disclosure',
    sourceFamily: 'tdnet_document_search',
    sourceIndependence: 'issuer_official_disclosure',
    sourceUrl: 'https://www.release.tdnet.info/inbs/raw-metadata-only-fixture.html',
    documentTitle: 'TDnet metadata-only rejection fixture',
    documentType: 'tdnet_metadata_fixture',
    documentDate: '2026-05-23',
    rawTextSnippet: 'TDnet disclosure metadata: code=4062 companyName=IBIDEN disclosureType=timely disclosure exchange=TSE',
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
  return TDNET_ISSUER_EXPOSURE_ALLOWED_SOURCE_GROUPS.includes(String(row.sourceGroup || '').toLowerCase());
}

export function findTdnetIssuerExposureBridge(text = '', {
  subjectTerms = TDNET_ISSUER_EXPOSURE_SUBJECT_TERMS,
  operatingTerms = TDNET_ISSUER_EXPOSURE_OPERATING_TERMS,
  windowChars = 1200,
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

export function tdnetIssuerExposureAcceptanceDetail(row = {}, {
  subjectTerms = TDNET_ISSUER_EXPOSURE_SUBJECT_TERMS,
  operatingTerms = TDNET_ISSUER_EXPOSURE_OPERATING_TERMS,
  windowChars = 1200,
} = {}) {
  const text = bodyText(row);
  const bridge = findTdnetIssuerExposureBridge(text, { subjectTerms, operatingTerms, windowChars });
  const rejectionReasons = [];
  if (!allowedSourceGroup(row)) rejectionReasons.push('source_group_not_allowed_for_tdnet_issuer_exposure');
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

export function buildTdnetIssuerExposureRawEvidence(source = {}, {
  seedId = 'tdnet-issuer-exposure-seed',
  taskId = null,
  generatedAt = new Date().toISOString(),
  index = 0,
  subjectTerms = TDNET_ISSUER_EXPOSURE_SUBJECT_TERMS,
  operatingTerms = TDNET_ISSUER_EXPOSURE_OPERATING_TERMS,
  windowChars = 1200,
} = {}) {
  const rawTextSnippet = compact(source.rawTextSnippet || source.fixtureText || source.extractedTextSnippet || '');
  const detail = tdnetIssuerExposureAcceptanceDetail({
    ...source,
    rawTextSnippet,
  }, { subjectTerms, operatingTerms, windowChars });
  const failureClassification = source.failureClassification || fixtureFailureClassification(source, detail);
  const accepted = failureClassification === 'ACCEPTED' && detail.accepted;
  const rejectionReason = accepted ? null : uniqueStrings([
    failureClassification,
    detail.rejectionReasons,
  ], 16).join(',');
  const documentTitle = compact(source.documentTitle || source.title || source.fixtureId || `TDnet issuer exposure fixture ${index}`);
  const summary = accepted
    ? `Official TDnet disclosure bridge: ${detail.operatingBridgeSnippet}`
    : `TDnet issuer exposure fixture rejected: ${rejectionReason || failureClassification}`;

  return {
    evidenceId: `tdnet:issuer_exposure:${seedId}:${source.fixtureId || `fixture-${index}`}`,
    taskId,
    seedId,
    providerName: 'tdnet',
    evidenceClass: 'issuer_exposure',
    desiredEvidenceClass: 'issuer_exposure',
    issuer: source.issuer || null,
    issuerName: source.issuerName || null,
    source: 'tdnet',
    provider: 'tdnet',
    sourceProvider: 'tdnet',
    providerRoute: 'tdnet',
    sourceType: 'non_us_official_disclosure',
    sourceGroup: source.sourceGroup || 'official_tdnet_disclosure',
    sourceFamily: source.sourceFamily || 'tdnet_timely_disclosure_pdf',
    sourceUrl: source.sourceUrl || null,
    documentTitle,
    title: documentTitle,
    documentType: source.documentType || 'tdnet_timely_disclosure_fixture',
    documentDate: source.documentDate || source.publishedAt || null,
    publishedAt: source.publishedAt || source.documentDate || null,
    rawTextSnippet,
    extractedTextSnippet: rawTextSnippet,
    textExcerpt: rawTextSnippet,
    summary,
    matchedSubjectTerms: detail.matchedSubjectTerms,
    matchedOperatingTerms: detail.matchedOperatingTerms,
    operatingBridgeSnippet: detail.operatingBridgeSnippet,
    sourceIndependence: source.sourceIndependence || 'issuer_official_disclosure',
    proximityWindow: detail.proximityWindow,
    proximityScore: detail.proximityScore,
    fixtureKind: source.fixtureKind || source.fixtureId || 'unspecified_fixture',
    fixtureBackedProviderExecution: true,
    validationFixtureOnly: false,
    failureClassification,
    rejectionReason,
    acceptanceReason: accepted ? 'official_tdnet_disclosure_with_subject_and_operating_bridge' : null,
    acceptanceVerdict: accepted ? 'accepted' : 'not_evaluated_tdnet_issuer_exposure_raw',
    accepted,
    promotionEligible: accepted,
    evidenceUse: accepted ? 'promotion_candidate' : 'weak_noise',
    coveredEvidenceClasses: accepted ? ['issuer_exposure'] : [],
    generatedAt,
    collectedAt: generatedAt,
    mutationBoundary: { ...ZERO_MUTATION_BOUNDARY },
  };
}

export function collectTdnetIssuerExposureReadonly({
  seedId = 'tdnet-issuer-exposure-seed',
  task = {},
  generatedAt = new Date().toISOString(),
  sourceAllowlist = DEFAULT_TDNET_ISSUER_EXPOSURE_FIXTURES,
  maxSources = 5,
  subjectTerms = TDNET_ISSUER_EXPOSURE_SUBJECT_TERMS,
  operatingTerms = TDNET_ISSUER_EXPOSURE_OPERATING_TERMS,
  windowChars = 1200,
} = {}) {
  const taskSubjectTerms = uniqueStrings([
    subjectTerms,
    task.acceptanceCriteria?.requiredTerms,
    task.acceptanceCriteria?.keyTerms,
    task.acceptanceCriteria?.matchTerms,
  ], 80);
  const taskOperatingTerms = uniqueStrings([
    operatingTerms,
    task.acceptanceCriteria?.bridgeTerms,
  ], 80);
  const rawEvidence = asArray(sourceAllowlist)
    .slice(0, Number(maxSources || 5))
    .map((source, index) => buildTdnetIssuerExposureRawEvidence(source, {
      seedId: seedId || task.seedId || 'tdnet-issuer-exposure-seed',
      taskId: task.taskId || null,
      generatedAt,
      index,
      subjectTerms: taskSubjectTerms.length ? taskSubjectTerms : subjectTerms,
      operatingTerms: taskOperatingTerms.length ? taskOperatingTerms : operatingTerms,
      windowChars,
    }));
  return {
    version: TDNET_READONLY_VERSION,
    source: 'tdnet-readonly',
    providerName: 'tdnet',
    evidenceClass: 'issuer_exposure',
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
