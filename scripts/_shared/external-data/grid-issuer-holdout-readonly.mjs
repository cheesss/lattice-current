export const GRID_ISSUER_HOLDOUT_READONLY_VERSION = 'grid-issuer-holdout-readonly-v1';

export const GRID_ISSUER_HOLDOUT_ALLOWED_SOURCE_GROUPS = Object.freeze([
  'official_customer_utility_announcement',
  'utility_capex_plan',
  'utility_ir_or_regulatory_filing',
  'official_grid_operator_planning',
  'government_infrastructure_award',
  'official_industry_dataset',
  'official_regulatory_document',
  'official_project_award',
]);

export const GRID_ISSUER_HOLDOUT_FORBIDDEN_SOURCE_GROUPS = Object.freeze([
  'official_filing',
  'issuer_ir',
  'issuer_transcript',
  'official_company_release',
  'official_customer_contract',
]);

export const GRID_ISSUER_HOLDOUT_EXPOSURE_TERMS = Object.freeze([
  'transmission',
  'substation',
  'power delivery',
  'electric grid',
  'grid infrastructure',
  'grid modernization',
  'utility infrastructure',
  'transmission and distribution',
  't&d',
  'power grid investment',
  'interconnection upgrades',
  'network upgrades',
]);

export const GRID_ISSUER_HOLDOUT_DEMAND_TERMS = Object.freeze([
  'capital plan',
  'capex',
  'approved project',
  'project award',
  'contract award',
  'utility spending',
  'transmission expansion',
  'substation upgrade',
  'project pipeline',
  'investment plan',
  'grid upgrade',
  'approved budget',
  'customer demand',
  'reliability investment',
  'load growth',
  'data center load',
  'electrification demand',
]);

export const GRID_ISSUER_HOLDOUT_CONTRADICTION_TERMS = Object.freeze([
  'capex deferral',
  'capital plan deferred',
  'project cancellation',
  'project cancelled',
  'transmission delay',
  'rate-case rejection',
  'rate case rejection',
  'budget reduction',
  'investment plan delayed',
  'project suspended',
]);

export const DEFAULT_GRID_ISSUER_HOLDOUT_SOURCE_ALLOWLIST = Object.freeze([
  {
    sourceId: 'utility-capex-transmission-plan-fixture',
    sourceGroup: 'utility_capex_plan',
    sourceFamily: 'utility_capital_investment_plan',
    sourceUrl: 'https://utility.example.test/capital-plan-grid-modernization-fixture',
    documentTitle: 'Utility capital plan transmission and substation modernization fixture',
    documentType: 'utility_capex_plan_fixture',
    documentDate: '2025-04-10',
    allowedForTrack: 'issuer_bridge_track',
    fixtureText: 'The utility capital plan approved transmission expansion, substation upgrade work, and grid modernization projects. The approved budget and utility spending plan support a multi-year project pipeline tied to load growth and reliability investment.',
  },
  {
    sourceId: 'iso-rto-network-upgrade-plan-fixture',
    sourceGroup: 'official_grid_operator_planning',
    sourceFamily: 'iso_rto_transmission_expansion_plan',
    sourceUrl: 'https://grid-operator.example.test/transmission-expansion-fixture',
    documentTitle: 'ISO/RTO transmission expansion and network upgrades fixture',
    documentType: 'grid_operator_planning_fixture',
    documentDate: '2025-03-22',
    allowedForTrack: 'issuer_bridge_track',
    fixtureText: 'The planning report lists transmission expansion and network upgrades in the project pipeline. Approved project needs are driven by data center load, electrification demand, and reliability investment across the regional electric grid.',
  },
]);

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

function evidenceText(row = {}) {
  return compact([
    row.extractedTextSnippet,
    row.matchedSnippet,
    row.fixtureText,
    row.text,
    row.textExcerpt,
    row.bodyText,
    row.summary,
  ].join(' '));
}

function textIncludes(text = '', term = '') {
  return String(text || '').toLowerCase().includes(String(term || '').toLowerCase());
}

function matchedTerms(text = '', terms = []) {
  return asArray(terms).filter((term) => textIncludes(text, term));
}

function sourceGroup(row = {}) {
  return String(row.sourceGroup || row.source_group || '').toLowerCase();
}

function allowedSourceGroup(row = {}) {
  return GRID_ISSUER_HOLDOUT_ALLOWED_SOURCE_GROUPS.includes(sourceGroup(row));
}

function forbiddenIssuerSourceGroup(row = {}) {
  return GRID_ISSUER_HOLDOUT_FORBIDDEN_SOURCE_GROUPS.includes(sourceGroup(row));
}

function sameDocumentAsIssuerBridge(row = {}) {
  return row.sameDocumentAsIssuerExposure === true
    || row.sameDocumentAsIssuerBridge === true
    || row.sourceIndependenceFromIssuerBridge === false
    || /same_document|issuer_bridge_reuse|not_independent/i.test(compact([
      row.rejectionReason,
      row.sourceIndependenceFromIssuerBridge,
      row.independenceStatus,
    ].join(' ')));
}

function weakOrMetadataOnly(row = {}, text = '') {
  return row.rawMetadataOnly === true
    || row.titleOnly === true
    || row.tickerOnly === true
    || /not_evaluated/i.test(String(row.acceptanceVerdict || ''))
    || !text;
}

function genericDemandOnly(row = {}, text = '') {
  if (row.genericElectricityDemand === true || row.genericMarketCommentary === true || row.rssWeakRow === true) return true;
  const combined = compact([row.documentTitle, row.title, text].join(' ')).toLowerCase();
  return /electricity demand is rising|grid is important|utility infrastructure is important|power demand is growing/i.test(combined)
    && !matchedTerms(text, GRID_ISSUER_HOLDOUT_DEMAND_TERMS).length;
}

export function findGridIssuerHoldoutProximity(text = '', {
  exposureTerms = GRID_ISSUER_HOLDOUT_EXPOSURE_TERMS,
  demandTerms = GRID_ISSUER_HOLDOUT_DEMAND_TERMS,
  windowChars = 1000,
} = {}) {
  const body = compact(text);
  const lower = body.toLowerCase();
  const matchedExposureTerms = matchedTerms(body, exposureTerms);
  const matchedDemandTerms = matchedTerms(body, demandTerms);
  if (!matchedExposureTerms.length || !matchedDemandTerms.length) {
    return {
      matched: false,
      matchedExposureTerms,
      matchedDemandTerms,
      proximityWindow: windowChars,
      proximityScore: 0,
      matchedSnippet: '',
    };
  }
  for (const exposureTerm of matchedExposureTerms) {
    const exposureIndex = lower.indexOf(exposureTerm.toLowerCase());
    for (const demandTerm of matchedDemandTerms) {
      const demandIndex = lower.indexOf(demandTerm.toLowerCase());
      if (exposureIndex >= 0 && demandIndex >= 0 && Math.abs(exposureIndex - demandIndex) <= windowChars) {
        const start = Math.max(0, Math.min(exposureIndex, demandIndex) - 360);
        return {
          matched: true,
          matchedExposureTerms,
          matchedDemandTerms,
          proximityWindow: windowChars,
          proximityScore: 1 - Math.min(1, Math.abs(exposureIndex - demandIndex) / windowChars),
          matchedSnippet: body.slice(start, start + Math.min(1000, windowChars + 240)),
        };
      }
    }
  }
  return {
    matched: false,
    matchedExposureTerms,
    matchedDemandTerms,
    proximityWindow: windowChars,
    proximityScore: 0,
    matchedSnippet: body.slice(0, Math.min(760, body.length)),
  };
}

export function gridIssuerHoldoutAcceptanceDetail(row = {}, {
  issuerBridgeSourceUrls = [],
  issuerBridgeDocumentIds = [],
  windowChars = 1000,
} = {}) {
  const text = evidenceText(row);
  const proximity = findGridIssuerHoldoutProximity(text, { windowChars });
  const sourceUrl = compact(row.sourceUrl || row.url).toLowerCase();
  const documentId = compact(row.documentId || row.sourceId).toLowerCase();
  const bridgeUrls = new Set(asArray(issuerBridgeSourceUrls).map((value) => compact(value).toLowerCase()).filter(Boolean));
  const bridgeDocuments = new Set(asArray(issuerBridgeDocumentIds).map((value) => compact(value).toLowerCase()).filter(Boolean));
  const contradictionTerms = matchedTerms(text, GRID_ISSUER_HOLDOUT_CONTRADICTION_TERMS);
  const rejectionReasons = [];
  if (!allowedSourceGroup(row)) rejectionReasons.push(forbiddenIssuerSourceGroup(row) ? 'issuer_source_group_not_allowed_for_holdout' : 'source_group_not_allowed_for_holdout');
  if (sameDocumentAsIssuerBridge(row)) rejectionReasons.push('same_document_as_issuer_bridge');
  if (sourceUrl && bridgeUrls.has(sourceUrl)) rejectionReasons.push('same_source_url_as_issuer_bridge');
  if (documentId && bridgeDocuments.has(documentId)) rejectionReasons.push('same_document_id_as_issuer_bridge');
  if (weakOrMetadataOnly(row, text)) rejectionReasons.push('raw_metadata_or_not_evaluated');
  if (!proximity.matchedExposureTerms.length) rejectionReasons.push('holdout_exposure_term_missing');
  if (!proximity.matchedDemandTerms.length) rejectionReasons.push('holdout_demand_bridge_missing');
  if (proximity.matchedExposureTerms.length && proximity.matchedDemandTerms.length && !proximity.matched) {
    rejectionReasons.push('holdout_terms_not_proximate');
  }
  if (genericDemandOnly(row, text)) rejectionReasons.push('generic_demand_without_project_bridge');
  if (contradictionTerms.length) rejectionReasons.push('holdout_contradiction_found');
  return {
    accepted: rejectionReasons.length === 0,
    rejectionReasons,
    contradictionFound: contradictionTerms.length > 0,
    contradictionTerms,
    matchedExposureTerms: proximity.matchedExposureTerms,
    matchedDemandTerms: proximity.matchedDemandTerms,
    matchedSnippet: proximity.matchedSnippet || text.slice(0, Math.min(700, text.length)),
    proximityWindow: proximity.proximityWindow,
    proximityScore: proximity.proximityScore,
  };
}

function failureForHoldoutSource(source = {}, detail = {}) {
  if (source.allowedForTrack !== 'issuer_bridge_track') return 'TRACK_NOT_ALLOWED';
  if (detail.contradictionFound) return 'CONTRADICTORY';
  if (detail.rejectionReasons.includes('issuer_source_group_not_allowed_for_holdout')) return 'SOURCE_NOT_INDEPENDENT_FROM_ISSUER_BRIDGE';
  if (detail.rejectionReasons.includes('source_group_not_allowed_for_holdout')) return 'SOURCE_GROUP_NOT_ALLOWED';
  if (detail.rejectionReasons.includes('same_document_as_issuer_bridge') || detail.rejectionReasons.includes('same_source_url_as_issuer_bridge') || detail.rejectionReasons.includes('same_document_id_as_issuer_bridge')) return 'SOURCE_NOT_INDEPENDENT_FROM_ISSUER_BRIDGE';
  if (detail.rejectionReasons.includes('raw_metadata_or_not_evaluated')) return 'WEAK_EVIDENCE';
  if (detail.rejectionReasons.includes('generic_demand_without_project_bridge')) return 'WEAK_EVIDENCE';
  if (detail.rejectionReasons.includes('holdout_terms_not_proximate')) return 'WEAK_EVIDENCE';
  if (detail.rejectionReasons.length) return 'NO_ACCEPTANCE_MATCH';
  return null;
}

export function buildGridIssuerHoldoutRawEvidence(source = {}, {
  seedId = 'track-b-seed',
  trackId = 'issuer_bridge_track',
  generatedAt = new Date().toISOString(),
  index = 0,
  issuerBridgeSourceUrls = [],
  issuerBridgeDocumentIds = [],
  windowChars = 1000,
} = {}) {
  const text = compact(source.fixtureText || source.extractedTextSnippet || source.text || source.bodyText || '');
  const detail = gridIssuerHoldoutAcceptanceDetail({
    ...source,
    extractedTextSnippet: text,
  }, {
    issuerBridgeSourceUrls,
    issuerBridgeDocumentIds,
    windowChars,
  });
  const failureClassification = failureForHoldoutSource(source, detail);
  const accepted = detail.accepted && !failureClassification;
  const holdoutStatus = detail.contradictionFound ? 'CONTRADICTED' : accepted ? 'CONFIRMED' : 'INCONCLUSIVE';
  return {
    evidenceId: `grid-issuer-holdout:${seedId}:${source.sourceId || `source-${index}`}`,
    seedId,
    trackId,
    evidenceClass: 'holdout_validation',
    sourceId: source.sourceId || `source-${index}`,
    sourceGroup: source.sourceGroup,
    sourceFamily: source.sourceFamily,
    sourceUrl: source.sourceUrl || null,
    documentTitle: source.documentTitle || source.title || source.sourceId || '',
    documentType: source.documentType || 'official_holdout_source',
    documentDate: source.documentDate || source.publishedAt || null,
    provider: source.sourceFamily || 'grid_issuer_holdout_readonly',
    source: source.sourceFamily || 'grid_issuer_holdout_readonly',
    allowedForTrack: source.allowedForTrack || 'issuer_bridge_track',
    sourceIndependenceFromIssuerBridge: accepted,
    extractedTextSnippet: text,
    matchedExposureTerms: detail.matchedExposureTerms,
    matchedDemandTerms: detail.matchedDemandTerms,
    matchedSnippet: detail.matchedSnippet,
    proximityWindow: detail.proximityWindow,
    proximityScore: detail.proximityScore,
    holdoutStatus,
    contradictionFound: detail.contradictionFound,
    contradictionTerms: detail.contradictionTerms,
    failureClassification,
    rejectionReason: accepted ? null : uniqueStrings([failureClassification, detail.rejectionReasons], 12).join(','),
    acceptanceReason: accepted ? 'independent_official_holdout_source_with_grid_project_and_demand_bridge' : null,
    acceptanceVerdict: accepted ? 'accepted' : 'not_evaluated_holdout_raw',
    accepted,
    evidenceUse: accepted ? 'supporting_context' : 'weak_noise',
    promotionEligible: false,
    coveredEvidenceClasses: accepted ? ['holdout_validation'] : [],
    fixtureBacked: Boolean(source.fixtureText),
    generatedAt,
    collectedAt: generatedAt,
  };
}

export function summarizeGridIssuerHoldoutScope(rows = []) {
  const rawRows = asArray(rows);
  const acceptedRows = rawRows.filter((row) => row.accepted === true || row.acceptanceVerdict === 'accepted');
  const contradictionRows = rawRows.filter((row) => row.contradictionFound === true || row.holdoutStatus === 'CONTRADICTED');
  const checkedSourceGroups = new Set(acceptedRows.map((row) => row.sourceGroup || row.source_group).filter(Boolean));
  const checkedSourceFamilies = new Set(acceptedRows.map((row) => row.sourceFamily || row.source || row.provider).filter(Boolean));
  const sourceUnavailableRows = rawRows.filter((row) => /503|unavailable|timeout|credential|required|fixture_required/i.test(compact(row.failureClassification || row.error || '')));
  const weakRows = rawRows.filter((row) => /WEAK_EVIDENCE|NO_ACCEPTANCE_MATCH|SOURCE_GROUP_NOT_ALLOWED|SOURCE_NOT_INDEPENDENT/i.test(String(row.failureClassification || '')));
  let holdoutStatus = 'INCONCLUSIVE';
  if (contradictionRows.length > 0) {
    holdoutStatus = 'CONTRADICTED';
  } else if (acceptedRows.length > 0) {
    holdoutStatus = 'CONFIRMED';
  } else if (rawRows.length > 0 && sourceUnavailableRows.length === rawRows.length) {
    holdoutStatus = 'SOURCE_UNAVAILABLE';
  } else if (weakRows.length > 0) {
    holdoutStatus = 'INCONCLUSIVE';
  }
  return {
    holdoutStatus,
    holdoutConfirmed: holdoutStatus === 'CONFIRMED',
    acceptedHoldoutEvidenceCount: acceptedRows.length,
    contradictionCount: contradictionRows.length,
    contradictionFound: contradictionRows.length > 0,
    contradictionTerms: uniqueStrings(rawRows.flatMap((row) => row.contradictionTerms || []), 20),
    checkedSourceGroups: [...checkedSourceGroups],
    checkedSourceFamilies: [...checkedSourceFamilies],
    matchedExposureTerms: uniqueStrings(acceptedRows.flatMap((row) => row.matchedExposureTerms || []), 20),
    matchedDemandTerms: uniqueStrings(acceptedRows.flatMap((row) => row.matchedDemandTerms || []), 20),
    sourceUnavailableCount: sourceUnavailableRows.length,
    weakEvidenceCount: weakRows.length,
  };
}

export function collectGridIssuerHoldoutReadonly({
  seedId = 'track-b-seed',
  trackId = 'issuer_bridge_track',
  generatedAt = new Date().toISOString(),
  sourceAllowlist = DEFAULT_GRID_ISSUER_HOLDOUT_SOURCE_ALLOWLIST,
  maxSources = 6,
  issuerBridgeSourceUrls = [],
  issuerBridgeDocumentIds = [],
  windowChars = 1000,
} = {}) {
  const rawEvidence = asArray(sourceAllowlist)
    .filter((source) => source?.allowedForTrack === 'issuer_bridge_track')
    .slice(0, maxSources)
    .map((source, index) => buildGridIssuerHoldoutRawEvidence(source, {
      seedId,
      trackId,
      generatedAt,
      index,
      issuerBridgeSourceUrls,
      issuerBridgeDocumentIds,
      windowChars,
    }));
  const scope = summarizeGridIssuerHoldoutScope(rawEvidence);
  return {
    version: GRID_ISSUER_HOLDOUT_READONLY_VERSION,
    source: 'grid-issuer-holdout-readonly',
    rawEvidence,
    scope,
    sourceGroupsUsed: uniqueStrings(rawEvidence.map((row) => row.sourceGroup), 20),
    sourceFamiliesUsed: uniqueStrings(rawEvidence.map((row) => row.sourceFamily), 20),
    matchedExposureTerms: scope.matchedExposureTerms,
    matchedDemandTerms: scope.matchedDemandTerms,
    failureClassifications: rawEvidence.reduce((counts, row) => {
      if (row.failureClassification) counts[row.failureClassification] = (counts[row.failureClassification] || 0) + 1;
      return counts;
    }, {}),
  };
}
