import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { normalizeSourceBucket } from './source-diversity-feedback.mjs';

export const SOURCE_QUALITY_SCORE_VERSION = 'source-quality-score-v1';
export const DEFAULT_SOURCE_QUALITY_SCORE_PATH = path.join(process.cwd(), 'data', 'runtime', 'source-quality-score.latest.json');

export const EXTENDED_FAILURE_TAXONOMY = Object.freeze([
  'SOURCE_UNAVAILABLE',
  'TIMEOUT',
  'WEAK_EVIDENCE',
  'OPERATOR_REVIEW_REQUIRED',
  'PROVIDER_GAP',
  'TICKER_ONLY',
  'NO_RESULT',
  'ACCEPTED',
  'CONTRADICTORY',
  'OFFICIAL_BUT_GENERIC',
  'NO_OPERATING_BRIDGE',
  'NO_BOTTLENECK_DIRECTNESS',
  'NO_ISSUER_SEGMENT_LINK',
  'EXTRACTION_WEAK',
  'TABLE_ONLY_UNPARSED',
  'LANGUAGE_UNSUPPORTED',
  'SOURCE_SEED_ROUTE_MISMATCH',
  'STALE_ONLY',
  'DUPLICATE_ONLY',
  'VALUATION_BRIDGE_MISSING',
  'EXPECTATION_CONTEXT_MISSING',
]);

const ISSUER_CLASSES = new Set([
  'issuer_exposure',
  'issuer_commentary',
  'primary_filing',
  'backlog',
  'guidance',
  'segment_revenue',
  'capacity',
]);

const MECHANISM_CLASSES = new Set([
  'mechanism_validation',
  'grid_interconnection',
  'engineering_process',
  'permitting_regulatory',
  'technical_qualification',
  'material_input',
  'test_facility_capacity',
]);

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (value === null || value === undefined || value === '') return [];
  return [value];
}

function compact(value = '') {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function compactKey(value = '') {
  return compact(value).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'unknown';
}

function uniqueStrings(values = [], limit = 80) {
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

function score(value) {
  return Math.max(0, Math.min(1, Number(value || 0)));
}

function sourceId(row = {}, index = 0) {
  return compact(row.evidenceId || row.sourceId || row.rawEvidenceId || `${row.providerName || row.provider || 'source'}:${row.evidenceClass || 'unknown'}:${index}`);
}

function providerName(row = {}) {
  return compact(row.providerName || row.provider || row.sourceProvider || row.sourceType || row.providerRoute || 'unknown_provider');
}

function evidenceClass(row = {}) {
  return compact(row.evidenceClass || row.desiredEvidenceClass || row.fillsEvidenceClass || 'unknown_class');
}

function rowText(row = {}) {
  return compact([
    row.documentTitle,
    row.title,
    row.summary,
    row.rawTextSnippet,
    row.extractedTextSnippet,
    row.matchedSnippet,
    row.operatingBridgeSnippet,
    row.description,
    row.sourceUrl,
  ].filter(Boolean).join(' '));
}

function isOfficial(row = {}, bucket = '') {
  const text = compact([
    bucket,
    row.sourceGroup,
    row.sourceType,
    row.providerName,
    row.provider,
    row.documentType,
    row.sourceUrl,
  ].join(' ')).toLowerCase();
  return /official|filing|sec|10-k|10-q|20-f|mops|edinet|tdnet|dart|company_ir|annual|investor|government|ferc|iso|rto|utility|grid_operator/.test(text);
}

function extractionQuality(row = {}) {
  const text = compact(row.rawTextSnippet || row.extractedTextSnippet || row.matchedSnippet || row.operatingBridgeSnippet || '');
  const extractedCharCount = Number(row.extractedCharCount || row.extractedTextLength || text.length || 0);
  const detectedLanguages = uniqueStrings([row.language, row.detectedLanguage, row.matchedLanguage, row.detectedLanguages], 8);
  const tableExtractionAvailable = row.tableExtractionAvailable === true || /table_extracted|parsed/i.test(String(row.tableExtractionStatus || ''));
  const tableOnly = row.tableOnly === true || /table_only/i.test(String(row.extractionStatus || row.failureClassification || row.rejectionReason || ''));
  const hasPageOrSpan = Boolean(row.pageNumber || row.textSpan || row.page || row.span);
  const matchedSnippetCount = [
    row.matchedSnippet,
    row.operatingBridgeSnippet,
    row.rawTextSnippet,
    row.extractedTextSnippet,
  ].filter((value) => compact(value)).length;
  const proximityMatchCount = Number(row.proximityMatchCount || (row.proximityScore ? 1 : 0) || (row.operatingBridgeSnippet ? 1 : 0));
  const textExtracted = extractedCharCount >= 80 || compact(row.matchedSnippet || row.operatingBridgeSnippet).length >= 40;
  let extractionQualityScore = 0;
  if (textExtracted) extractionQualityScore += 0.45;
  if (extractedCharCount >= 500) extractionQualityScore += 0.15;
  if (matchedSnippetCount > 0) extractionQualityScore += 0.15;
  if (proximityMatchCount > 0) extractionQualityScore += 0.15;
  if (hasPageOrSpan) extractionQualityScore += 0.05;
  if (tableOnly && !tableExtractionAvailable) extractionQualityScore -= 0.25;
  return {
    textExtracted,
    extractedCharCount,
    detectedLanguages,
    tableExtractionAvailable,
    hasPageOrSpan,
    matchedSnippetCount,
    proximityMatchCount,
    extractionQualityScore: score(extractionQualityScore),
    extractionFailureReason: !textExtracted
      ? 'extracted_text_too_short'
      : tableOnly && !tableExtractionAvailable
        ? 'table_only_unparsed'
        : null,
    tableOnly,
  };
}

function subjectTerms(row = {}) {
  return uniqueStrings([
    row.matchedSubjectTerms,
    row.matchedBottleneckTerms,
    row.bottleneckTerms,
    row.requiredTerms,
    row.bottleneckNode,
    row.mechanismNode,
  ], 30);
}

function operatingTerms(row = {}) {
  return uniqueStrings([
    row.matchedOperatingTerms,
    row.operatingTerms,
    row.operatingBridgeTerms,
  ], 30);
}

function textHasBottleneck(text = '') {
  return /(bottleneck|capacity|lead time|qualification|interconnection|queue|study delay|network upgrade|substrate|package|rocket motor|test facility|permitting|regulatory|material|supply|allocation|backlog|power delivery|substation|transmission)/i.test(text);
}

function textHasOperatingBridge(text = '') {
  return /(segment revenue|revenue|backlog|guidance|capacity|capex|customer demand|customer exposure|lead time|allocation|order|orders|contract|margin|production|utilization|project execution|delay|cost|withdrawal rate|processing)/i.test(text);
}

function textHasIssuerSegment(text = '') {
  return /(segment|revenue|backlog|guidance|customer|contract|capacity|project|orders|margin|sales|business unit|division|exposure)/i.test(text);
}

function stale(row = {}, now = new Date()) {
  const year = Number(row.fiscalYear || row.year || '');
  if (year && year < 2019) return true;
  const dateText = row.publishedAt || row.filedAt || row.documentDate || row.createdAt;
  const date = dateText ? new Date(dateText) : null;
  if (!date || Number.isNaN(date.getTime())) return false;
  return (now.getTime() - date.getTime()) / (24 * 60 * 60 * 1000) > 365 * 7;
}

function diagnosticKind(row = {}, klass = '', rawFailure = '') {
  const provider = providerName(row).toLowerCase();
  const fixtureKind = compact(row.fixtureKind);
  if (klass === 'provider_data_gap' || /PROVIDER_GAP/i.test(rawFailure) || /adapter_proposal_only/.test(provider)) {
    return 'provider_gap';
  }
  if (/OPERATOR_REVIEW_REQUIRED/i.test(rawFailure)) return 'operator_review_required';
  if (fixtureKind && row.accepted !== true && !/positive_operating_bridge_fixture/i.test(fixtureKind)) {
    return 'provider_fixture_rejection';
  }
  if (row.evidenceUse === 'rejected' && row.fixtureBackedProviderExecution === true && row.accepted !== true) {
    return 'provider_fixture_rejection';
  }
  return null;
}

export function classifySeedSourceCompatibility(row = {}) {
  const klass = evidenceClass(row);
  const provider = providerName(row).toLowerCase();
  const bucket = normalizeSourceBucket(row);
  const text = compact([
    row.bottleneckNode,
    row.mechanismNode,
    row.seedLabel,
    row.subjectLabel,
    row.sourceQuery,
    row.documentTitle,
    row.rawTextSnippet,
  ].join(' ')).toLowerCase();
  const interconnectionStudy = /interconnection.*study|study.*interconnection|queue duration|study backlog|network upgrade/.test(text);
  const issuerRoute = /sec|10-k|10-q|20-f|issuer|company_ir|annual|transcript|pwr|acm|jacobs|\bj\b/.test(`${provider} ${bucket} ${text}`);
  const gridMechanismRoute = /ferc|lbnl|iso|rto|pjm|miso|caiso|ercot|spp|grid_operator|government_official|utility/.test(`${provider} ${bucket}`);
  if (interconnectionStudy && issuerRoute && !gridMechanismRoute) {
    return {
      compatibility: 'mismatch',
      reason: 'interconnection study capacity is a process bottleneck; direct issuer route should be split',
      recommendedTrack: 'mechanism_validation',
      blocker: 'SOURCE_SEED_ROUTE_MISMATCH',
    };
  }
  if (interconnectionStudy && gridMechanismRoute) {
    return {
      compatibility: 'mechanism_only',
      reason: 'grid official route can validate mechanism but not investment readiness by itself',
      recommendedTrack: 'mechanism_validation',
      blocker: null,
    };
  }
  if (ISSUER_CLASSES.has(klass) && /generic_staged_provider_probe|trade_media|news/.test(`${provider} ${bucket}`)) {
    return {
      compatibility: 'issuer_bridge_only',
      reason: 'issuer exposure needs official filing or company IR route',
      recommendedTrack: 'issuer_bridge',
      blocker: 'SOURCE_SEED_ROUTE_MISMATCH',
    };
  }
  if (MECHANISM_CLASSES.has(klass)) {
    return {
      compatibility: 'mechanism_only',
      reason: 'mechanism class supports process validation and must not directly raise investment readiness',
      recommendedTrack: 'mechanism_validation',
      blocker: null,
    };
  }
  return {
    compatibility: 'compatible',
    reason: 'source route is compatible with requested evidence class',
    recommendedTrack: null,
    blocker: null,
  };
}

export function scoreSourceQuality(row = {}, {
  index = 0,
  now = new Date(),
} = {}) {
  const klass = evidenceClass(row);
  const provider = providerName(row);
  const bucket = normalizeSourceBucket(row);
  const text = rowText(row);
  const extraction = extractionQuality(row);
  const subjectMatches = subjectTerms(row);
  const operatingMatches = operatingTerms(row);
  const sourceAuthorityScore = isOfficial(row, bucket) ? 1 : bucket === 'trade_media' ? 0.45 : 0.25;
  const documentAccessScore = row.sourceUrl || row.documentTitle || text ? 1 : 0;
  const bottleneckDirectnessScore = subjectMatches.length || textHasBottleneck(text) ? 1 : 0;
  const operatingBridgeScore = operatingMatches.length || row.operatingBridgeSnippet || textHasOperatingBridge(text) ? 1 : 0;
  const issuerSegmentLinkScore = ISSUER_CLASSES.has(klass)
    ? (row.issuerRoleClass || textHasIssuerSegment(text) ? 1 : 0)
    : 1;
  const freshnessScore = stale(row, now) ? 0 : 1;
  const independenceScore = row.sourceIndependence === false || row.duplicateSource === true ? 0 : 1;
  const compatibility = classifySeedSourceCompatibility(row);
  const failureReasons = [];
  const rawFailure = compact(row.failureClassification || row.acceptanceFailureClassification || row.terminalFailureClassification || '');
  const diagnostic = diagnosticKind(row, klass, rawFailure);

  if (/SOURCE_UNAVAILABLE|HTTP_|NETWORK_DISABLED|SOURCE_URL_MISSING/i.test(rawFailure)) failureReasons.push('SOURCE_UNAVAILABLE');
  if (/TIMEOUT|RATE_LIMIT/i.test(rawFailure)) failureReasons.push('TIMEOUT');
  if (/WEAK_EVIDENCE/i.test(rawFailure)) failureReasons.push('WEAK_EVIDENCE');
  if (/OPERATOR_REVIEW_REQUIRED/i.test(rawFailure)) failureReasons.push('OPERATOR_REVIEW_REQUIRED');
  if (/PROVIDER_GAP/i.test(rawFailure) || diagnostic === 'provider_gap') failureReasons.push('PROVIDER_GAP');
  if (/TICKER_ONLY/i.test(rawFailure) || row.tickerOnly === true) failureReasons.push('TICKER_ONLY');
  if (/NO_RESULT|NO_MATCH|NO_ACCEPTANCE_MATCH/i.test(rawFailure)) failureReasons.push('NO_RESULT');
  if (/CONTRADICTORY|REJECTED/i.test(rawFailure)) failureReasons.push('CONTRADICTORY');
  if (diagnostic === null) {
    if (compatibility.blocker) failureReasons.push(compatibility.blocker);
    if (extraction.extractionQualityScore < 0.35) failureReasons.push('EXTRACTION_WEAK');
    if (extraction.tableOnly && !extraction.tableExtractionAvailable) failureReasons.push('TABLE_ONLY_UNPARSED');
    if (
      extraction.detectedLanguages.length
      && extraction.detectedLanguages.every((lang) => /unsupported|unknown/i.test(lang))
    ) failureReasons.push('LANGUAGE_UNSUPPORTED');
    if (bottleneckDirectnessScore === 0) failureReasons.push('NO_BOTTLENECK_DIRECTNESS');
    if (operatingBridgeScore === 0) failureReasons.push('NO_OPERATING_BRIDGE');
    if (issuerSegmentLinkScore === 0) failureReasons.push('NO_ISSUER_SEGMENT_LINK');
    if (sourceAuthorityScore >= 0.9 && bottleneckDirectnessScore === 0 && operatingBridgeScore === 0) failureReasons.push('OFFICIAL_BUT_GENERIC');
    if (freshnessScore === 0) failureReasons.push('STALE_ONLY');
    if (independenceScore === 0) failureReasons.push('DUPLICATE_ONLY');
    if (/VALUATION_BRIDGE_MISSING/i.test(rawFailure)) failureReasons.push('VALUATION_BRIDGE_MISSING');
    if (/EXPECTATION_CONTEXT_MISSING/i.test(rawFailure)) failureReasons.push('EXPECTATION_CONTEXT_MISSING');
  }

  const uniqueFailures = uniqueStrings(failureReasons, 20);
  const acceptedEligible = uniqueFailures.length === 0 && row.accepted === true;
  const promotionEligible = acceptedEligible
    && row.promotionEligible === true
    && row.validationFixtureOnly !== true
    && !['mechanism_only', 'holdout_only', 'negative_control_only'].includes(compatibility.compatibility);
  const overallEvidenceQualityScore = score(
    0.18 * sourceAuthorityScore
    + 0.12 * documentAccessScore
    + 0.18 * extraction.extractionQualityScore
    + 0.18 * bottleneckDirectnessScore
    + 0.18 * operatingBridgeScore
    + 0.08 * issuerSegmentLinkScore
    + 0.04 * freshnessScore
    + 0.04 * independenceScore,
  );

  return {
    sourceId: sourceId(row, index),
    providerName: provider,
    sourceBucket: bucket,
    evidenceClass: klass,
    sourceAuthorityScore,
    documentAccessScore,
    extractionQualityScore: extraction.extractionQualityScore,
    bottleneckDirectnessScore,
    operatingBridgeScore,
    issuerSegmentLinkScore,
    freshnessScore,
    independenceScore,
    overallEvidenceQualityScore,
    acceptedEligible,
    promotionEligible,
    failureReasons: uniqueFailures,
    extractionQuality: extraction,
    diagnosticKind: diagnostic,
    compatibility,
    rawFailureClassification: rawFailure || null,
    terminalFailureClassification: uniqueFailures[0] || (acceptedEligible ? 'ACCEPTED' : 'WEAK_EVIDENCE'),
  };
}

function rowsFromArtifacts({ stagedProviderLiveExecution = {}, backfillQueue = {} } = {}) {
  const rows = [
    ...asArray(stagedProviderLiveExecution.rawEvidence),
    ...asArray(backfillQueue.rawEvidence),
    ...asArray(stagedProviderLiveExecution.acceptedEvidence).map((row) => ({
      ...row,
      accepted: true,
      failureClassification: row.failureClassification || 'ACCEPTED',
    })),
    ...asArray(backfillQueue.acceptedEvidence).map((row) => ({
      ...row,
      accepted: true,
      failureClassification: row.failureClassification || 'ACCEPTED',
    })),
    ...asArray(stagedProviderLiveExecution.acceptedPromotionEvidence).map((row) => ({
      ...row,
      accepted: true,
      promotionEligible: row.validationFixtureOnly !== true,
      failureClassification: row.failureClassification || 'ACCEPTED',
    })),
    ...asArray(backfillQueue.acceptedPromotionEvidence).map((row) => ({
      ...row,
      accepted: true,
      promotionEligible: row.validationFixtureOnly !== true,
      failureClassification: row.failureClassification || 'ACCEPTED',
    })),
  ];
  const byId = new Map();
  rows.forEach((row, index) => {
    const id = sourceId(row, index);
    byId.set(id, {
      ...(byId.get(id) || {}),
      ...row,
    });
  });
  return [...byId.values()];
}

function countBy(rows = [], mapper = (row) => row) {
  const out = {};
  for (const row of asArray(rows)) {
    const key = compact(mapper(row));
    if (!key) continue;
    out[key] = (out[key] || 0) + 1;
  }
  return out;
}

function average(rows = [], field = '') {
  const values = asArray(rows).map((row) => Number(row[field] || 0));
  if (!values.length) return 0;
  return Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(4));
}

function terminalBlockType(record = {}) {
  const reasons = asArray(record.failureReasons);
  if (record.diagnosticKind === 'provider_fixture_rejection') return null;
  if (record.diagnosticKind === 'operator_review_required') return null;
  if (record.diagnosticKind === 'provider_gap' || reasons.includes('PROVIDER_GAP')) return 'provider_gap';
  if (reasons.includes('SOURCE_SEED_ROUTE_MISMATCH')) return 'source_seed_route_mismatch';
  if (reasons.includes('OFFICIAL_BUT_GENERIC')) return 'issuer_disclosure_too_generic';
  if (reasons.includes('NO_BOTTLENECK_DIRECTNESS')) return 'official_document_not_available';
  if (reasons.includes('VALUATION_BRIDGE_MISSING')) return 'valuation_data_missing';
  if (reasons.includes('EXTRACTION_WEAK') || reasons.includes('TABLE_ONLY_UNPARSED')) return 'document_extraction_weak';
  return null;
}

export function buildSourceQualityScore({
  stagedProviderLiveExecution = {},
  backfillQueue = {},
  generatedAt = new Date().toISOString(),
} = {}) {
  const now = new Date(generatedAt);
  const records = rowsFromArtifacts({ stagedProviderLiveExecution, backfillQueue })
    .map((row, index) => scoreSourceQuality(row, { index, now }));
  const failureReasonCounts = {};
  for (const record of records) {
    for (const reason of record.failureReasons) failureReasonCounts[reason] = (failureReasonCounts[reason] || 0) + 1;
  }
  const terminalBlockers = records
    .map((record) => ({ ...record, blockType: terminalBlockType(record) }))
    .filter((record) => record.blockType)
    .map((record) => ({
      sourceId: record.sourceId,
      providerName: record.providerName,
      evidenceClass: record.evidenceClass,
      blockType: record.blockType,
      failureReasons: record.failureReasons,
      recommendedTrack: record.compatibility.recommendedTrack || null,
    }));
  const lowQualityRecords = records
    .filter((record) => record.overallEvidenceQualityScore < 0.45 || record.failureReasons.length)
    .sort((left, right) => left.overallEvidenceQualityScore - right.overallEvidenceQualityScore)
    .slice(0, 25);
  return {
    ok: true,
    version: SOURCE_QUALITY_SCORE_VERSION,
    generatedAt,
    recordCount: records.length,
    records,
    summary: {
      averageOverallEvidenceQualityScore: average(records, 'overallEvidenceQualityScore'),
      averageExtractionQualityScore: average(records, 'extractionQualityScore'),
      acceptedEligibleCount: records.filter((record) => record.acceptedEligible).length,
      promotionEligibleCount: records.filter((record) => record.promotionEligible).length,
      failureReasonCounts,
      sourceBucketCounts: countBy(records, (record) => record.sourceBucket),
      evidenceClassCounts: countBy(records, (record) => record.evidenceClass),
      routeMismatchCount: records.filter((record) => record.failureReasons.includes('SOURCE_SEED_ROUTE_MISMATCH')).length,
      extractionWeakCount: records.filter((record) => record.failureReasons.includes('EXTRACTION_WEAK')).length,
      officialButGenericCount: records.filter((record) => record.failureReasons.includes('OFFICIAL_BUT_GENERIC')).length,
      terminalBlockerCount: terminalBlockers.length,
    },
    lowQualityRecords,
    terminalBlockers,
    failureTaxonomy: [...EXTENDED_FAILURE_TAXONOMY],
    mutationBoundary: {
      providerActivationWrites: 0,
      sourceRegistryWrites: 0,
      canonicalWrites: 0,
      readinessPromotionWrites: 0,
      reportCandidateWrites: 0,
      portfolioActionWrites: 0,
    },
  };
}

export async function writeSourceQualityScoreArtifact(payload, filePath = DEFAULT_SOURCE_QUALITY_SCORE_PATH) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  return path.resolve(filePath);
}

export async function loadSourceQualityScore(filePath = DEFAULT_SOURCE_QUALITY_SCORE_PATH) {
  if (!existsSync(filePath)) return null;
  try {
    return JSON.parse(await readFile(filePath, 'utf8'));
  } catch {
    return null;
  }
}
