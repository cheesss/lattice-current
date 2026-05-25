export const GRID_ISSUER_NEGATIVE_CONTROL_READONLY_VERSION = 'grid-issuer-negative-control-readonly-v1';

export const GRID_ISSUER_NEGATIVE_ALLOWED_SOURCE_GROUPS = Object.freeze([
  'official_filing',
  'issuer_ir',
  'issuer_transcript',
  'official_company_release',
  'official_customer_contract',
  'official_industry_or_utility',
]);

export const GRID_ISSUER_NEGATIVE_QUERY_FAMILIES = Object.freeze([
  'utility capex slowdown',
  'transmission project slowdown',
  'power delivery backlog decline',
  'electric infrastructure demand weakening',
  'grid infrastructure awards slowing',
  'project delays hurting margin',
  'labor shortage hurting execution',
  'supply chain delays hurting project execution',
  'cost inflation reducing margins',
  'fixed-price contract margin pressure',
  'competition rising in utility EPC',
  'project awards becoming more competitive',
  'utility customers insourcing engineering',
  'alternative EPC suppliers taking share',
  'management says no grid infrastructure bottleneck',
  'management says demand normalizing',
  'management says backlog conversion slowing',
  'management denies capacity constraint',
  'permitting delays reducing project starts',
  'interconnection reform delaying awards',
  'utility budget deferral',
  'rate case delays reducing grid capex',
]);

export const GRID_ISSUER_NEGATIVE_DIRECT_INVALIDATOR_TERMS = Object.freeze([
  'backlog decline',
  'backlog is declining',
  'demand slowdown',
  'utility capex slowdown',
  'utility capex is being deferred',
  'budget deferral',
  'demand normalizing',
  'management denies capacity constraint',
  'no grid infrastructure bottleneck',
  'awards slowing',
]);

export const GRID_ISSUER_NEGATIVE_RISK_TERMS = Object.freeze([
  'project delays',
  'delays hurting margin',
  'labor shortage',
  'supply chain delays',
  'cost inflation',
  'margin pressure',
  'fixed-price contract',
  'competition rising',
  'more competitive',
  'rate case delays',
]);

export const DEFAULT_GRID_ISSUER_NEGATIVE_SOURCE_ALLOWLIST = Object.freeze([
  {
    sourceId: 'pwr-negative-official-filing-fixture',
    issuer: 'PWR',
    sourceGroup: 'official_filing',
    sourceFamily: 'sec_10k',
    sourceUrl: 'https://www.sec.gov/Archives/edgar/data/pwr-negative-fixture',
    documentTitle: 'PWR official filing negative-control fixture',
    documentDate: '2025-02-20',
    queryFamilies: ['utility capex slowdown', 'power delivery backlog decline'],
    allowedForTrack: 'issuer_bridge_track',
    fixtureText: 'Power delivery backlog and utility customer demand remained supported by grid modernization and transmission investment. The filing did not identify a demand slowdown, utility capex slowdown, or power delivery backlog decline as a direct constraint.',
  },
  {
    sourceId: 'acm-negative-ir-fixture',
    issuer: 'ACM',
    sourceGroup: 'issuer_ir',
    sourceFamily: 'investor_presentation',
    sourceUrl: 'https://investors.aecom.com/negative-control-fixture',
    documentTitle: 'ACM investor presentation negative-control fixture',
    documentDate: '2025-05-01',
    queryFamilies: ['project delays hurting margin', 'competition rising in utility EPC'],
    allowedForTrack: 'issuer_bridge_track',
    fixtureText: 'Management emphasized utility infrastructure project execution and customer demand. The presentation did not state that project awards were becoming more competitive or that delays were hurting margin in the grid infrastructure work.',
  },
  {
    sourceId: 'j-negative-transcript-fixture',
    issuer: 'J',
    sourceGroup: 'issuer_transcript',
    sourceFamily: 'earnings_transcript',
    sourceUrl: 'https://invest.jacobs.com/negative-control-fixture',
    documentTitle: 'J earnings transcript negative-control fixture',
    documentDate: '2025-04-15',
    queryFamilies: ['management says demand normalizing', 'rate case delays reducing grid capex'],
    allowedForTrack: 'issuer_bridge_track',
    fixtureText: 'The transcript discussed electric infrastructure demand visibility and grid modernization project backlog. Management did not say demand was normalizing, did not deny a capacity constraint, and did not cite rate case delays as reducing grid capex.',
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

function matchedTerms(text = '', terms = []) {
  return asArray(terms).filter((term) => textIncludes(text, term));
}

function evidenceText(row = {}) {
  return compact([
    row.extractedTextSnippet,
    row.matchedSnippet,
    row.text,
    row.textExcerpt,
    row.bodyText,
    row.summary,
  ].join(' '));
}

function allowedSource(row = {}) {
  return GRID_ISSUER_NEGATIVE_ALLOWED_SOURCE_GROUPS.includes(String(row.sourceGroup || row.source_group || '').toLowerCase());
}

function sourceUnavailable(row = {}) {
  return /503|unavailable|fetch_failed|timeout|credential|required/i.test(compact([
    row.failureClassification,
    row.acquisitionStatus,
    row.error,
  ].join(' ')));
}

function noResult(row = {}) {
  return /no_result|no result|not found/i.test(compact([
    row.failureClassification,
    row.acquisitionStatus,
    row.error,
  ].join(' ')));
}

export function classifyGridIssuerNegativeRawEvidence(row = {}) {
  const text = evidenceText(row);
  if (!allowedSource(row)) return { classification: 'SOURCE_GROUP_NOT_ALLOWED', accepted: false, status: 'INCONCLUSIVE' };
  if (sourceUnavailable(row)) return { classification: 'SOURCE_UNAVAILABLE', accepted: false, status: 'INCONCLUSIVE' };
  if (noResult(row)) return { classification: 'NO_RESULT', accepted: false, status: 'INCONCLUSIVE' };
  if (!text || row.rawMetadataOnly || row.tickerOnly || /not_evaluated/i.test(String(row.acceptanceVerdict || ''))) {
    return { classification: 'WEAK_EVIDENCE', accepted: false, status: 'INCONCLUSIVE' };
  }
  const matchedInvalidatorTerms = matchedTerms(text, GRID_ISSUER_NEGATIVE_DIRECT_INVALIDATOR_TERMS);
  const matchedRiskTerms = matchedTerms(text, GRID_ISSUER_NEGATIVE_RISK_TERMS);
  if (row.directInvalidatorFound === true || matchedInvalidatorTerms.length > 0 && !/did not|does not|not identify|not state|did not say|did not cite/i.test(text)) {
    return {
      classification: 'CONTRADICTORY',
      accepted: true,
      status: row.invalidatorSeverity === 'partial' ? 'WEAKENED' : 'REJECTED',
      matchedInvalidatorTerms,
      matchedRiskTerms,
    };
  }
  if (matchedRiskTerms.length > 0 && !/did not|does not|not identify|not state|did not say|did not cite/i.test(text)) {
    return {
      classification: 'WEAK_RISK_SIGNAL',
      accepted: true,
      status: 'WEAKENED',
      matchedInvalidatorTerms,
      matchedRiskTerms,
    };
  }
  return {
    classification: 'CHECKED_NO_DIRECT',
    accepted: true,
    status: 'CHECKED_NO_DIRECT',
    matchedInvalidatorTerms,
    matchedRiskTerms,
  };
}

export function buildGridIssuerNegativeRawEvidence(source = {}, {
  seedId = 'track-b-seed',
  trackId = 'issuer_bridge_track',
  generatedAt = new Date().toISOString(),
  index = 0,
} = {}) {
  const detail = classifyGridIssuerNegativeRawEvidence({
    ...source,
    extractedTextSnippet: source.fixtureText || source.extractedTextSnippet || source.text || '',
  });
  const queryFamilies = uniqueStrings(source.queryFamilies || [], 8);
  return {
    evidenceId: `grid-issuer-negative:${seedId}:${source.sourceId || `source-${index}`}`,
    seedId,
    trackId,
    evidenceClass: 'negative_control',
    sourceId: source.sourceId || `source-${index}`,
    issuer: source.issuer || null,
    sourceGroup: source.sourceGroup,
    sourceFamily: source.sourceFamily,
    sourceUrl: source.sourceUrl || null,
    documentTitle: source.documentTitle || source.sourceId || '',
    documentDate: source.documentDate || source.publishedAt || null,
    provider: source.sourceFamily || 'grid_issuer_negative_control_readonly',
    source: source.sourceFamily || 'grid_issuer_negative_control_readonly',
    queryFamilies,
    negativeControlFamily: queryFamilies.join('; '),
    negativeControlIntent: true,
    negativeControlStatus: detail.status,
    negativeControlFinding: detail.status === 'CHECKED_NO_DIRECT'
      ? 'checked_no_direct'
      : detail.status === 'WEAKENED'
        ? 'weakening_risk_signal'
        : detail.status === 'REJECTED'
          ? 'direct_invalidator'
          : 'inconclusive',
    negativeControlScope: 'source_row',
    checkedSourceGroups: source.sourceGroup ? [source.sourceGroup] : [],
    checkedIssuerCount: source.issuer ? 1 : 0,
    checkedQueryFamilyCount: queryFamilies.length,
    directInvalidatorFound: ['WEAKENED', 'REJECTED'].includes(detail.status),
    matchedInvalidatorTerms: detail.matchedInvalidatorTerms || [],
    matchedRiskTerms: detail.matchedRiskTerms || [],
    matchedSnippet: compact(source.fixtureText || source.extractedTextSnippet || source.text || '').slice(0, 1000),
    extractedTextSnippet: compact(source.fixtureText || source.extractedTextSnippet || source.text || ''),
    acceptanceReason: detail.accepted ? 'official_issuer_negative_control_scope_checked' : null,
    rejectionReason: detail.accepted ? null : detail.classification,
    failureClassification: detail.classification,
    acceptanceVerdict: detail.accepted ? 'accepted' : 'not_evaluated_negative_control_raw',
    accepted: detail.accepted,
    evidenceUse: detail.accepted ? 'negative_control_candidate' : 'weak_noise',
    promotionEligible: false,
    fixtureBacked: Boolean(source.fixtureText),
    generatedAt,
    collectedAt: generatedAt,
  };
}

export function summarizeGridIssuerNegativeScope(rows = []) {
  const rawRows = asArray(rows);
  const checkedRows = rawRows.filter((row) => row.accepted === true || row.acceptanceVerdict === 'accepted');
  const checkedIssuers = new Set(checkedRows.map((row) => row.issuer).filter(Boolean));
  const checkedSourceGroups = new Set(checkedRows.map((row) => row.sourceGroup || row.source_group).filter(Boolean));
  const checkedQueryFamilies = new Set(checkedRows.flatMap((row) => asArray(row.queryFamilies || row.negativeControlFamily)));
  const directInvalidatorRows = checkedRows.filter((row) => row.directInvalidatorFound === true || ['WEAKENED', 'REJECTED'].includes(row.negativeControlStatus));
  const weakRiskRows = checkedRows.filter((row) => row.negativeControlStatus === 'WEAKENED');
  const sourceUnavailableCount = rawRows.filter(sourceUnavailable).length;
  const noResultCount = rawRows.filter(noResult).length;
  const sourceUnavailableShare = rawRows.length ? sourceUnavailableCount / rawRows.length : 0;
  const checkedIssuerCount = checkedIssuers.size;
  const checkedSourceGroupCount = checkedSourceGroups.size;
  const checkedQueryFamilyCount = checkedQueryFamilies.size;
  const sufficientScope = checkedIssuerCount >= 2
    && checkedSourceGroupCount >= 2
    && checkedQueryFamilyCount >= 4
    && sourceUnavailableShare < 0.5
    && directInvalidatorRows.length === 0;
  let status = 'INCONCLUSIVE';
  let scope = 'insufficient';
  if (directInvalidatorRows.some((row) => row.negativeControlStatus === 'REJECTED')) {
    status = 'REJECTED';
    scope = 'invalidator';
  } else if (directInvalidatorRows.length || weakRiskRows.length) {
    status = 'WEAKENED';
    scope = 'invalidator_candidate';
  } else if (sufficientScope) {
    status = 'CHECKED_NO_DIRECT';
    scope = 'sufficient';
  } else if (checkedRows.length > 0) {
    status = 'CHECKED_NO_DIRECT_LIMITED_SCOPE';
    scope = 'limited';
  }
  return {
    negativeControlStatus: status,
    negativeControlScope: scope,
    checkedIssuerCount,
    checkedSourceGroupCount,
    checkedQueryFamilyCount,
    directInvalidatorCount: directInvalidatorRows.length,
    weakRiskSignalCount: weakRiskRows.length,
    noResultCount,
    sourceUnavailableCount,
    sourceUnavailableShare,
    directInvalidatorFound: directInvalidatorRows.length > 0,
    checkedSourceGroups: [...checkedSourceGroups],
    checkedIssuers: [...checkedIssuers],
    checkedQueryFamilies: [...checkedQueryFamilies],
    matchedInvalidatorTerms: uniqueStrings(checkedRows.flatMap((row) => row.matchedInvalidatorTerms || []), 20),
    matchedRiskTerms: uniqueStrings(checkedRows.flatMap((row) => row.matchedRiskTerms || []), 20),
  };
}

export function collectGridIssuerNegativeControlReadonly({
  seedId = 'track-b-seed',
  trackId = 'issuer_bridge_track',
  generatedAt = new Date().toISOString(),
  sourceAllowlist = DEFAULT_GRID_ISSUER_NEGATIVE_SOURCE_ALLOWLIST,
  maxSources = 6,
} = {}) {
  const rawEvidence = asArray(sourceAllowlist)
    .filter((source) => source?.allowedForTrack === 'issuer_bridge_track')
    .slice(0, maxSources)
    .map((source, index) => buildGridIssuerNegativeRawEvidence(source, {
      seedId,
      trackId,
      generatedAt,
      index,
    }));
  const scope = summarizeGridIssuerNegativeScope(rawEvidence);
  return {
    version: GRID_ISSUER_NEGATIVE_CONTROL_READONLY_VERSION,
    source: 'grid-issuer-negative-control-readonly',
    rawEvidence,
    scope,
    sourceGroupsUsed: uniqueStrings(rawEvidence.map((row) => row.sourceGroup), 20),
    sourceFamiliesUsed: uniqueStrings(rawEvidence.map((row) => row.sourceFamily), 20),
    issuerCandidates: uniqueStrings(rawEvidence.map((row) => row.issuer), 20),
    queryFamilies: scope.checkedQueryFamilies,
    failureClassifications: rawEvidence.reduce((counts, row) => {
      if (row.failureClassification) counts[row.failureClassification] = (counts[row.failureClassification] || 0) + 1;
      return counts;
    }, {}),
  };
}
