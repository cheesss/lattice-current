export const GRID_ISSUER_BRIDGE_READONLY_VERSION = 'grid-issuer-bridge-readonly-v1';

export const GRID_ISSUER_BRIDGE_ALLOWED_SOURCE_GROUPS = Object.freeze([
  'official_filing',
  'issuer_ir',
  'issuer_transcript',
  'official_company_release',
  'official_customer_contract',
]);

export const GRID_ISSUER_BRIDGE_ALLOWED_ROLE_CLASSES = Object.freeze([
  'grid_epc_capacity_owner',
  'utility_infrastructure_services',
  'transmission_substation_execution',
  'engineering_construction_exposure',
]);

export const GRID_ISSUER_BRIDGE_EXPOSURE_TERMS = Object.freeze([
  'power delivery',
  'transmission',
  'substation',
  'utility infrastructure',
  'electric infrastructure',
  'grid modernization',
  'power grid investment',
  'grid infrastructure',
  'transmission and distribution',
  'epc backlog',
  'project backlog',
  'utility customer demand',
]);

export const GRID_ISSUER_BRIDGE_OPERATING_TERMS = Object.freeze([
  'backlog',
  'revenue',
  'segment revenue',
  'guidance',
  'margin',
  'customer demand',
  'project execution',
  'capacity',
  'book-to-bill',
  'contract award',
  'capex cycle',
  'utility spending',
  'demand visibility',
]);

export const DEFAULT_GRID_ISSUER_BRIDGE_SOURCE_ALLOWLIST = Object.freeze([
  {
    sourceId: 'pwr-power-delivery-filing-fixture',
    issuer: 'PWR',
    issuerName: 'Quanta Services',
    issuerRoleClass: 'grid_epc_capacity_owner',
    sourceGroup: 'official_filing',
    sourceFamily: 'sec_10k',
    sourceUrl: 'https://www.sec.gov/Archives/edgar/data/pwr-grid-epc-fixture',
    documentTitle: 'PWR 10-K power delivery backlog fixture',
    documentType: 'sec_10k_fixture',
    documentDate: '2025-02-20',
    allowedForTrack: 'issuer_bridge_track',
    fixtureText: 'The Power Delivery segment performs electric power transmission and distribution, substation, and grid modernization services for utility customers. Backlog and demand visibility increased as utility customer demand and project execution requirements supported revenue growth and guidance for power delivery work.',
  },
  {
    sourceId: 'acm-grid-infrastructure-ir-fixture',
    issuer: 'ACM',
    issuerName: 'AECOM',
    issuerRoleClass: 'utility_infrastructure_services',
    sourceGroup: 'issuer_ir',
    sourceFamily: 'investor_presentation',
    sourceUrl: 'https://investors.aecom.com/grid-infrastructure-fixture',
    documentTitle: 'ACM investor presentation transmission and substation fixture',
    documentType: 'investor_presentation_fixture',
    documentDate: '2025-05-01',
    allowedForTrack: 'issuer_bridge_track',
    fixtureText: 'Utility infrastructure and grid infrastructure programs include transmission and substation design, engineering, and project execution. Customer demand and utility spending are driving revenue visibility across electric infrastructure work.',
  },
  {
    sourceId: 'j-grid-infrastructure-transcript-fixture',
    issuer: 'J',
    issuerName: 'Jacobs',
    issuerRoleClass: 'engineering_construction_exposure',
    sourceGroup: 'issuer_transcript',
    sourceFamily: 'earnings_transcript',
    sourceUrl: 'https://invest.jacobs.com/transcript-grid-fixture',
    documentTitle: 'J earnings transcript grid infrastructure fixture',
    documentType: 'earnings_transcript_fixture',
    documentDate: '2025-04-15',
    allowedForTrack: 'issuer_bridge_track',
    fixtureText: 'In the quarter, grid modernization and electric infrastructure programs contributed to project backlog. Management cited customer demand from utilities, power grid investment, and project execution as drivers of guidance and margin visibility.',
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

function textIncludes(text = '', term = '') {
  return String(text || '').toLowerCase().includes(String(term || '').toLowerCase());
}

function termsMatched(text = '', terms = []) {
  return asArray(terms).filter((term) => textIncludes(text, term));
}

function bodyText(row = {}) {
  return compact([
    row.extractedTextSnippet,
    row.matchedSnippet,
    row.transcriptAnswer,
    row.transcriptQuestion,
    row.text,
    row.textExcerpt,
    row.bodyText,
    row.pageText,
  ].join(' '));
}

export function findGridIssuerBridgeProximity(text = '', {
  exposureTerms = GRID_ISSUER_BRIDGE_EXPOSURE_TERMS,
  operatingTerms = GRID_ISSUER_BRIDGE_OPERATING_TERMS,
  windowChars = 1000,
} = {}) {
  const body = compact(text);
  const lower = body.toLowerCase();
  const matchedExposureTerms = termsMatched(body, exposureTerms);
  const matchedOperatingTerms = termsMatched(body, operatingTerms);
  if (!matchedExposureTerms.length || !matchedOperatingTerms.length) {
    return {
      matched: false,
      matchedExposureTerms,
      matchedOperatingTerms,
      proximityWindow: windowChars,
      proximityScore: 0,
      matchedSnippet: '',
    };
  }
  for (const exposureTerm of matchedExposureTerms) {
    const exposureIndex = lower.indexOf(exposureTerm.toLowerCase());
    for (const operatingTerm of matchedOperatingTerms) {
      const operatingIndex = lower.indexOf(operatingTerm.toLowerCase());
      if (exposureIndex >= 0 && operatingIndex >= 0 && Math.abs(exposureIndex - operatingIndex) <= windowChars) {
        const start = Math.max(0, Math.min(exposureIndex, operatingIndex) - 360);
        return {
          matched: true,
          matchedExposureTerms,
          matchedOperatingTerms,
          proximityWindow: windowChars,
          proximityScore: 1 - Math.min(1, Math.abs(exposureIndex - operatingIndex) / windowChars),
          matchedSnippet: body.slice(start, start + Math.min(1000, windowChars + 240)),
        };
      }
    }
  }
  return {
    matched: false,
    matchedExposureTerms,
    matchedOperatingTerms,
    proximityWindow: windowChars,
    proximityScore: 0,
    matchedSnippet: body.slice(0, Math.min(760, body.length)),
  };
}

function allowedSourceGroup(row = {}) {
  return GRID_ISSUER_BRIDGE_ALLOWED_SOURCE_GROUPS.includes(String(row.sourceGroup || row.source_group || '').toLowerCase());
}

function allowedRoleClass(row = {}) {
  return GRID_ISSUER_BRIDGE_ALLOWED_ROLE_CLASSES.includes(String(row.issuerRoleClass || row.roleClass || '').toLowerCase());
}

function genericInfrastructureOnly(row = {}, text = '') {
  if (row.genericInfrastructureDescription === true) return true;
  const combined = compact([row.title, row.documentTitle, text].join(' ')).toLowerCase();
  return /participates in infrastructure markets|diversified infrastructure operations|infrastructure markets and has diversified operations/i.test(combined)
    && !termsMatched(text, GRID_ISSUER_BRIDGE_OPERATING_TERMS).length;
}

export function gridIssuerBridgeAcceptanceDetail(row = {}, {
  windowChars = 1000,
} = {}) {
  const text = bodyText(row);
  const proximity = findGridIssuerBridgeProximity(text, { windowChars });
  const rejectionReasons = [];
  if (!allowedSourceGroup(row)) rejectionReasons.push('source_group_not_allowed_for_issuer_bridge');
  if (!allowedRoleClass(row)) rejectionReasons.push('issuer_role_class_not_allowed');
  if (!text) rejectionReasons.push('body_snippet_missing');
  if (row.tickerOnly) rejectionReasons.push('ticker_only');
  if (row.rawMetadataOnly) rejectionReasons.push('raw_metadata_only');
  if (/not_evaluated/i.test(String(row.acceptanceVerdict || ''))) rejectionReasons.push('not_evaluated_raw_evidence');
  if (!proximity.matchedExposureTerms.length) rejectionReasons.push('exposure_term_missing_in_body');
  if (!proximity.matchedOperatingTerms.length) rejectionReasons.push('operating_bridge_missing_in_body');
  if (proximity.matchedExposureTerms.length && proximity.matchedOperatingTerms.length && !proximity.matched) {
    rejectionReasons.push('exposure_operating_terms_not_proximate');
  }
  if (genericInfrastructureOnly(row, text)) rejectionReasons.push('generic_infrastructure_description');
  return {
    accepted: rejectionReasons.length === 0,
    rejectionReasons,
    matchedExposureTerms: proximity.matchedExposureTerms,
    matchedOperatingTerms: proximity.matchedOperatingTerms,
    matchedSnippet: proximity.matchedSnippet || text.slice(0, Math.min(700, text.length)),
    proximityWindow: proximity.proximityWindow,
    proximityScore: proximity.proximityScore,
  };
}

function failureForSource(source = {}, text = '') {
  if (source.allowedForTrack !== 'issuer_bridge_track') return 'TRACK_NOT_ALLOWED';
  if (!allowedSourceGroup(source)) return 'SOURCE_GROUP_NOT_ALLOWED';
  if (!allowedRoleClass(source)) return 'ISSUER_ROLE_CLASS_NOT_ALLOWED';
  if (!text) return 'FIXTURE_REQUIRED';
  return null;
}

export function buildGridIssuerBridgeRawEvidence(source = {}, {
  seedId = 'track-b-seed',
  trackId = 'issuer_bridge_track',
  generatedAt = new Date().toISOString(),
  index = 0,
  windowChars = 1000,
} = {}) {
  const text = compact(source.fixtureText || source.extractedTextSnippet || source.text || source.bodyText || '');
  const failureClassification = failureForSource(source, text);
  const detail = gridIssuerBridgeAcceptanceDetail({
    ...source,
    extractedTextSnippet: text,
  }, { windowChars });
  const accepted = detail.accepted && !failureClassification;
  return {
    evidenceId: `grid-issuer-bridge:${seedId}:${source.sourceId || `source-${index}`}`,
    seedId,
    trackId,
    evidenceClass: 'issuer_exposure',
    issuer: source.issuer || null,
    issuerName: source.issuerName || null,
    issuerRoleClass: source.issuerRoleClass || source.roleClass || 'unclear',
    roleClass: source.issuerRoleClass || source.roleClass || 'unclear',
    sourceId: source.sourceId || `source-${index}`,
    source: source.sourceFamily || source.sourceId || 'grid_issuer_bridge_readonly',
    provider: source.sourceFamily || 'grid_issuer_bridge_readonly',
    sourceGroup: source.sourceGroup,
    sourceFamily: source.sourceFamily,
    sourceUrl: source.sourceUrl || null,
    documentTitle: source.documentTitle || source.title || source.sourceId || '',
    documentType: source.documentType || 'official_issuer_source',
    documentDate: source.documentDate || source.publishedAt || null,
    publishedAt: source.publishedAt || source.documentDate || null,
    allowedForTrack: source.allowedForTrack || 'issuer_bridge_track',
    extractedTextSnippet: text,
    matchedExposureTerms: detail.matchedExposureTerms,
    matchedOperatingTerms: detail.matchedOperatingTerms,
    matchedSnippet: detail.matchedSnippet,
    proximityWindow: detail.proximityWindow,
    proximityScore: detail.proximityScore,
    extractionStatus: failureClassification ? 'fixture_required' : (accepted ? 'extracted' : 'extracted_no_acceptance_match'),
    failureClassification,
    rejectionReason: accepted ? null : uniqueStrings([failureClassification, detail.rejectionReasons], 12).join(','),
    acceptanceReason: accepted ? 'official_issuer_source_with_grid_exposure_and_operating_bridge' : null,
    acceptanceVerdict: accepted ? 'accepted' : 'not_evaluated_issuer_bridge_raw',
    accepted,
    promotionEligible: accepted,
    evidenceUse: accepted ? 'promotion_candidate' : 'weak_noise',
    coveredEvidenceClasses: accepted ? ['issuer_exposure'] : [],
    fixtureBacked: Boolean(source.fixtureText),
    generatedAt,
    collectedAt: generatedAt,
  };
}

export function collectGridIssuerBridgeReadonly({
  seedId = 'track-b-seed',
  trackId = 'issuer_bridge_track',
  generatedAt = new Date().toISOString(),
  sourceAllowlist = DEFAULT_GRID_ISSUER_BRIDGE_SOURCE_ALLOWLIST,
  maxSources = 3,
  windowChars = 1000,
} = {}) {
  const selectedSources = asArray(sourceAllowlist)
    .filter((source) => source?.allowedForTrack === 'issuer_bridge_track')
    .slice(0, maxSources);
  const rawEvidence = selectedSources.map((source, index) => buildGridIssuerBridgeRawEvidence(source, {
    seedId,
    trackId,
    generatedAt,
    index,
    windowChars,
  }));
  return {
    version: GRID_ISSUER_BRIDGE_READONLY_VERSION,
    source: 'grid-issuer-bridge-readonly',
    rawEvidence,
    sourceFamiliesUsed: uniqueStrings(rawEvidence.map((row) => row.sourceFamily), 20),
    sourceGroupsUsed: uniqueStrings(rawEvidence.map((row) => row.sourceGroup), 20),
    issuerCandidates: uniqueStrings(rawEvidence.map((row) => row.issuer), 20),
    issuerRoleClasses: uniqueStrings(rawEvidence.map((row) => row.issuerRoleClass), 20),
    fixtureRequired: rawEvidence.some((row) => row.failureClassification === 'FIXTURE_REQUIRED'),
    failureClassifications: rawEvidence.reduce((counts, row) => {
      if (row.failureClassification) counts[row.failureClassification] = (counts[row.failureClassification] || 0) + 1;
      return counts;
    }, {}),
  };
}
