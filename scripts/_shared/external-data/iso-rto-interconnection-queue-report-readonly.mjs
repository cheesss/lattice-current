export const ISO_RTO_INTERCONNECTION_QUEUE_REPORT_READONLY_VERSION = 'iso-rto-interconnection-queue-report-readonly-v1';

export const ISO_RTO_INTERCONNECTION_QUEUE_REPORT_SUPPORTED_EVIDENCE_CLASSES = Object.freeze([
  'engineering_process',
]);

export const ISO_RTO_INTERCONNECTION_QUEUE_REPORT_ALLOWED_SOURCE_GROUPS = Object.freeze([
  'official_grid_operator',
  'official_iso_rto_report',
]);

export const ISO_RTO_INTERCONNECTION_QUEUE_REPORT_SUBJECT_TERMS = Object.freeze([
  'ISO',
  'RTO',
  'PJM',
  'MISO',
  'CAISO',
  'ERCOT',
  'SPP',
  'interconnection queue',
  'interconnection queue report',
  'generator interconnection',
  'interconnection study',
  'queue report',
  'grid operator',
]);

export const ISO_RTO_INTERCONNECTION_QUEUE_REPORT_OPERATING_TERMS = Object.freeze([
  'study timeline',
  'study delay',
  'processing delay',
  'processing capacity',
  'queue congestion',
  'study backlog',
  'application backlog',
  'network upgrade delay',
  'restudy',
  'withdrawal rate',
  'cycle time',
  'project delay',
]);

export const DEFAULT_ISO_RTO_INTERCONNECTION_QUEUE_REPORT_FIXTURES = Object.freeze([
  {
    fixtureId: 'positive_operating_bridge_fixture',
    fixtureKind: 'positive_operating_bridge_fixture',
    sourceGroup: 'official_grid_operator',
    sourceFamily: 'iso_rto_interconnection_queue_report',
    sourceIndependence: 'official_grid_operator_report',
    sourceUrl: 'https://www.pjm.com/planning/service-requests/interconnection-queues',
    documentTitle: 'ISO/RTO interconnection queue report fixture',
    documentType: 'official_grid_operator_fixture',
    documentDate: '2024-12-31',
    rawTextSnippet: 'Official ISO/RTO interconnection queue report fixture: PJM, MISO, CAISO, ERCOT, and SPP queue reports describe generator interconnection requests moving through feasibility study, system impact study, facilities study, restudy, and network upgrade review. The interconnection queue report links study backlog, queue congestion, processing delay, network upgrade delay, withdrawal rate, and longer study timeline to constrained grid-operator processing capacity and project delay.',
  },
  {
    fixtureId: 'no_result_fixture',
    fixtureKind: 'no_result_fixture',
    sourceGroup: 'official_grid_operator',
    sourceFamily: 'iso_rto_interconnection_queue_report',
    sourceIndependence: 'official_grid_operator_report',
    sourceUrl: 'https://www.pjm.com/search/no-result-interconnection-queue-report-fixture',
    documentTitle: 'ISO/RTO interconnection queue no-result fixture',
    documentType: 'official_grid_operator_search_fixture',
    documentDate: '2024-12-31',
    rawTextSnippet: '',
  },
  {
    fixtureId: 'timeout_or_source_unavailable_fixture',
    fixtureKind: 'timeout_or_source_unavailable_fixture',
    sourceGroup: 'official_grid_operator',
    sourceFamily: 'iso_rto_interconnection_queue_report',
    sourceIndependence: 'official_grid_operator_report',
    sourceUrl: 'https://www.pjm.com/source-unavailable-interconnection-queue-report-fixture',
    documentTitle: 'ISO/RTO interconnection queue source unavailable fixture',
    documentType: 'official_grid_operator_timeout_fixture',
    documentDate: '2024-12-31',
    rawTextSnippet: '',
  },
  {
    fixtureId: 'ticker_only_rejection_fixture',
    fixtureKind: 'ticker_only_rejection_fixture',
    sourceGroup: 'official_grid_operator',
    sourceFamily: 'iso_rto_interconnection_queue_report',
    sourceIndependence: 'official_grid_operator_report',
    sourceUrl: 'https://www.pjm.com/search/ticker-only-interconnection-queue-report-fixture',
    documentTitle: 'ISO/RTO interconnection queue ticker-only rejection fixture',
    documentType: 'official_grid_operator_identifier_fixture',
    documentDate: '2024-12-31',
    rawTextSnippet: 'PJM MISO CAISO ERCOT SPP ISO RTO queue report',
    tickerOnly: true,
  },
  {
    fixtureId: 'raw_metadata_only_rejection_fixture',
    fixtureKind: 'raw_metadata_only_rejection_fixture',
    sourceGroup: 'official_grid_operator',
    sourceFamily: 'iso_rto_interconnection_queue_report',
    sourceIndependence: 'official_grid_operator_report',
    sourceUrl: 'https://www.pjm.com/search/raw-metadata-only-interconnection-queue-report-fixture',
    documentTitle: 'ISO/RTO interconnection queue metadata-only rejection fixture',
    documentType: 'official_grid_operator_metadata_fixture',
    documentDate: '2024-12-31',
    rawTextSnippet: 'ISO/RTO metadata: reportType=interconnection_queue operator=PJM fileName=queue_report_2024.csv publicationYear=2024',
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

export function normalizeIsoRtoInterconnectionQueueReportEvidenceClass(value = '') {
  const evidenceClass = compact(value).toLowerCase();
  return ISO_RTO_INTERCONNECTION_QUEUE_REPORT_SUPPORTED_EVIDENCE_CLASSES.includes(evidenceClass)
    ? evidenceClass
    : 'engineering_process';
}

function subjectTermsForEvidenceClass(evidenceClass = 'engineering_process', terms = []) {
  return uniqueStrings([
    ISO_RTO_INTERCONNECTION_QUEUE_REPORT_SUBJECT_TERMS,
    terms,
    normalizeIsoRtoInterconnectionQueueReportEvidenceClass(evidenceClass) === 'engineering_process'
      ? ['interconnection queue', 'interconnection queue report', 'interconnection study']
      : [],
  ], 120);
}

function operatingTermsForEvidenceClass(evidenceClass = 'engineering_process', terms = []) {
  return uniqueStrings([
    ISO_RTO_INTERCONNECTION_QUEUE_REPORT_OPERATING_TERMS,
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
  return ISO_RTO_INTERCONNECTION_QUEUE_REPORT_ALLOWED_SOURCE_GROUPS.includes(String(row.sourceGroup || '').toLowerCase());
}

export function findIsoRtoInterconnectionQueueReportBridge(text = '', {
  subjectTerms = ISO_RTO_INTERCONNECTION_QUEUE_REPORT_SUBJECT_TERMS,
  operatingTerms = ISO_RTO_INTERCONNECTION_QUEUE_REPORT_OPERATING_TERMS,
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

export function isoRtoInterconnectionQueueReportAcceptanceDetail(row = {}, {
  subjectTerms = ISO_RTO_INTERCONNECTION_QUEUE_REPORT_SUBJECT_TERMS,
  operatingTerms = ISO_RTO_INTERCONNECTION_QUEUE_REPORT_OPERATING_TERMS,
  windowChars = 1400,
  evidenceClass = row.evidenceClass || row.desiredEvidenceClass,
} = {}) {
  const normalizedEvidenceClass = normalizeIsoRtoInterconnectionQueueReportEvidenceClass(evidenceClass);
  const text = bodyText(row);
  const bridge = findIsoRtoInterconnectionQueueReportBridge(text, {
    subjectTerms: subjectTermsForEvidenceClass(normalizedEvidenceClass, subjectTerms),
    operatingTerms: operatingTermsForEvidenceClass(normalizedEvidenceClass, operatingTerms),
    windowChars,
  });
  const rejectionReasons = [];
  if (!allowedSourceGroup(row)) rejectionReasons.push('source_group_not_allowed_for_iso_rto_interconnection_queue_report');
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

export function buildIsoRtoInterconnectionQueueReportRawEvidence(source = {}, {
  seedId = 'iso-rto-interconnection-queue-report-seed',
  taskId = null,
  generatedAt = new Date().toISOString(),
  index = 0,
  evidenceClass = source.evidenceClass || source.desiredEvidenceClass || 'engineering_process',
  subjectTerms = ISO_RTO_INTERCONNECTION_QUEUE_REPORT_SUBJECT_TERMS,
  operatingTerms = ISO_RTO_INTERCONNECTION_QUEUE_REPORT_OPERATING_TERMS,
  windowChars = 1400,
} = {}) {
  const normalizedEvidenceClass = normalizeIsoRtoInterconnectionQueueReportEvidenceClass(evidenceClass);
  const rawTextSnippet = compact(source.rawTextSnippet || source.fixtureText || source.extractedTextSnippet || '');
  const detail = isoRtoInterconnectionQueueReportAcceptanceDetail({
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
  const documentTitle = compact(source.documentTitle || source.title || source.fixtureId || `ISO/RTO interconnection queue report fixture ${index}`);
  const summary = accepted
    ? `Official ISO/RTO interconnection queue engineering-process bridge: ${detail.operatingBridgeSnippet}`
    : `ISO/RTO interconnection queue report fixture rejected: ${rejectionReason || failureClassification}`;

  return {
    evidenceId: `iso_rto_interconnection_queue_report:${normalizedEvidenceClass}:${seedId}:${source.fixtureId || `fixture-${index}`}`,
    taskId,
    seedId,
    providerName: 'iso_rto_interconnection_queue_report',
    evidenceClass: normalizedEvidenceClass,
    desiredEvidenceClass: normalizedEvidenceClass,
    source: 'iso_rto_interconnection_queue_report',
    provider: 'iso_rto_interconnection_queue_report',
    sourceProvider: 'iso_rto_interconnection_queue_report',
    providerRoute: 'iso_rto_interconnection_queue_report',
    sourceType: 'official_grid_operator',
    sourceGroup: source.sourceGroup || 'official_grid_operator',
    sourceFamily: source.sourceFamily || 'iso_rto_interconnection_queue_report',
    sourceUrl: source.sourceUrl || null,
    documentTitle,
    title: documentTitle,
    documentType: source.documentType || 'official_grid_operator_fixture',
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
    sourceIndependence: source.sourceIndependence || 'official_grid_operator_report',
    proximityWindow: detail.proximityWindow,
    proximityScore: detail.proximityScore,
    fixtureKind: source.fixtureKind || source.fixtureId || 'unspecified_fixture',
    fixtureBackedProviderExecution: true,
    validationFixtureOnly: false,
    failureClassification,
    rejectionReason,
    acceptanceReason: accepted ? 'official_iso_rto_queue_report_with_subject_and_operating_bridge' : null,
    acceptanceVerdict: accepted ? 'accepted' : 'not_evaluated_iso_rto_interconnection_queue_report_raw',
    accepted,
    promotionEligible: false,
    evidenceUse: accepted ? 'supporting_context' : 'weak_noise',
    coveredEvidenceClasses: [],
    generatedAt,
    collectedAt: generatedAt,
    mutationBoundary: { ...ZERO_MUTATION_BOUNDARY },
  };
}

export function collectIsoRtoInterconnectionQueueReportReadonly({
  seedId = 'iso-rto-interconnection-queue-report-seed',
  task = {},
  evidenceClass = task.evidenceClass || task.desiredEvidenceClass || 'engineering_process',
  generatedAt = new Date().toISOString(),
  sourceAllowlist = DEFAULT_ISO_RTO_INTERCONNECTION_QUEUE_REPORT_FIXTURES,
  maxSources = 5,
  subjectTerms = ISO_RTO_INTERCONNECTION_QUEUE_REPORT_SUBJECT_TERMS,
  operatingTerms = ISO_RTO_INTERCONNECTION_QUEUE_REPORT_OPERATING_TERMS,
  windowChars = 1400,
} = {}) {
  const normalizedEvidenceClass = normalizeIsoRtoInterconnectionQueueReportEvidenceClass(evidenceClass);
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
    .map((source, index) => buildIsoRtoInterconnectionQueueReportRawEvidence(source, {
      seedId: seedId || task.seedId || 'iso-rto-interconnection-queue-report-seed',
      taskId: task.taskId || null,
      generatedAt,
      index,
      evidenceClass: normalizedEvidenceClass,
      subjectTerms: taskSubjectTerms.length ? taskSubjectTerms : subjectTerms,
      operatingTerms: taskOperatingTerms.length ? taskOperatingTerms : operatingTerms,
      windowChars,
    }));
  return {
    version: ISO_RTO_INTERCONNECTION_QUEUE_REPORT_READONLY_VERSION,
    source: 'iso-rto-interconnection-queue-report-readonly',
    providerName: 'iso_rto_interconnection_queue_report',
    evidenceClass: normalizedEvidenceClass,
    supportedEvidenceClasses: [...ISO_RTO_INTERCONNECTION_QUEUE_REPORT_SUPPORTED_EVIDENCE_CLASSES],
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
