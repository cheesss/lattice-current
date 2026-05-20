function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function unique(items) {
  return [...new Set(asArray(items).filter(Boolean))];
}

function byId(rows = [], key) {
  return new Map(asArray(rows).map((row) => [row?.[key], row]).filter(([id]) => id));
}

function normalizeStatus(value) {
  return String(value || '').toLowerCase();
}

function publisherKey(item = {}) {
  return String(item.publisher || item.sourceId || item.source_id || item.source || 'unknown').trim().toLowerCase();
}

function sourceQuality(item = {}) {
  const raw = Number(item.sourceQualityScore ?? item.source_quality_score ?? item.qualityScore ?? 0.5);
  return Number.isFinite(raw) ? Math.max(0, Math.min(1, raw)) : 0.5;
}

function evidenceGradeScore(item = {}) {
  const grade = String(item.evidenceGrade || item.evidence_grade || '').toUpperCase();
  if (grade === 'E2') return 1;
  if (grade === 'E1') return 0.82;
  if (grade === 'E0') return 0.55;
  return sourceQuality(item);
}

export function gradeEvidenceItem(item = {}) {
  const status = normalizeStatus(item.freshnessStatus || item.freshness_status);
  const stalePenalty = /stale|degraded/.test(status) ? 0.35 : 0;
  const score = Math.max(0, Math.min(1, (0.55 * evidenceGradeScore(item)) + (0.45 * sourceQuality(item)) - stalePenalty));
  let evidenceClass = 'D';
  if (score >= 0.9) evidenceClass = 'A';
  else if (score >= 0.75) evidenceClass = 'B';
  else if (score >= 0.55) evidenceClass = 'C';
  else if (score >= 0.35) evidenceClass = 'D';
  else evidenceClass = 'E';
  return {
    evidenceId: item.evidenceId,
    evidenceClass,
    score: Math.round(score * 1000) / 1000,
    freshnessStatus: status || 'unknown',
    publisher: item.publisher || item.sourceId || 'unknown',
    decisionUse: evidenceClass <= 'C'
      ? 'usable in memo body when linked to a claim'
      : 'appendix or research-queue support only',
  };
}

export function classifyClaimEvidenceStrength(claim = {}, bundle = {}) {
  const evidenceById = byId(bundle.evidence, 'evidenceId');
  const metricIds = asArray(claim.supportingMetricIds);
  const figureIds = asArray(claim.supportingFigureIds);
  const caveatIds = asArray(claim.caveatIds);
  const evidenceRows = asArray(claim.supportingEvidenceIds).map((id) => evidenceById.get(id)).filter(Boolean);
  const independentSources = unique(evidenceRows.map(publisherKey)).filter((key) => key !== 'unknown').length;
  const usableEvidence = evidenceRows.map(gradeEvidenceItem).filter((row) => ['A', 'B', 'C'].includes(row.evidenceClass)).length;
  const validated = normalizeStatus(claim.validationStatus) === 'validated';
  const confidence = normalizeStatus(claim.confidenceLevel);
  const caveatDrag = caveatIds.length >= 3 ? 1 : caveatIds.length ? 0.5 : 0;
  let evidenceClass = 'E';
  if (validated && usableEvidence >= 3 && independentSources >= 2 && metricIds.length && figureIds.length) evidenceClass = 'A';
  else if (usableEvidence >= 2 && independentSources >= 2 && metricIds.length) evidenceClass = 'B';
  else if (usableEvidence >= 2 || (usableEvidence >= 1 && metricIds.length && figureIds.length)) evidenceClass = 'C';
  else if (usableEvidence >= 1 || metricIds.length || figureIds.length) evidenceClass = 'D';

  if (confidence === 'low' && ['A', 'B'].includes(evidenceClass)) evidenceClass = 'C';
  if (confidence === 'insufficient') evidenceClass = 'E';
  if (caveatDrag && evidenceClass === 'A') evidenceClass = 'B';
  if (caveatDrag >= 1 && evidenceClass === 'B') evidenceClass = 'C';

  const decisionUse = {
    A: 'core thesis support',
    B: 'memo-body support with caveats',
    C: 'supporting evidence; avoid overclaiming',
    D: 'watch-level only',
    E: 'appendix or research queue only',
  }[evidenceClass];

  return {
    claimId: claim.claimId,
    evidenceClass,
    independentSources,
    usableEvidence,
    metricCount: metricIds.length,
    figureCount: figureIds.length,
    caveatCount: caveatIds.length,
    decisionUse,
  };
}

export function buildEvidenceStrengthSummary(bundle = {}) {
  const evidence = asArray(bundle.evidence).map(gradeEvidenceItem);
  const claims = asArray(bundle.claims).map((claim) => classifyClaimEvidenceStrength(claim, bundle));
  const bodyEligibleClaims = claims.filter((claim) => ['A', 'B', 'C'].includes(claim.evidenceClass));
  const appendixOnlyClaims = claims.filter((claim) => ['D', 'E'].includes(claim.evidenceClass));
  return {
    evidence,
    claims,
    bodyEligibleClaimIds: bodyEligibleClaims.map((claim) => claim.claimId),
    appendixOnlyClaimIds: appendixOnlyClaims.map((claim) => claim.claimId),
    strongestClass: claims.map((claim) => claim.evidenceClass).sort()[0] || 'E',
    weakestClass: claims.map((claim) => claim.evidenceClass).sort().reverse()[0] || 'E',
  };
}
