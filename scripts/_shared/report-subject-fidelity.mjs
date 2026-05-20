/*
 * Report subject fidelity helpers.
 *
 * Goal: every generated report must declare what subject was requested, what
 * subject was actually matched in DB, and whether a fallback was used. The DB
 * adapters previously filtered with patterns like `($1 IS NULL OR theme = $1)`,
 * which silently matched all rows when the subject couldn't be coerced into the
 * adapter's expected key — producing reports about TLT, Medicare AI, etc.,
 * inside a "cloud-infrastructure" pack.
 *
 * This module provides:
 *
 *   - resolveSubjectKey(input)        canonical {kind, key, raw} for filtering
 *   - buildNoBoundCandidateBundle()   structurally valid "no-data" bundle
 *                                     when strict filtering finds no rows
 *   - attachSubjectFidelity()         tag every bundle with requestedSubject
 *                                     + subjectMatchStatus
 *
 * Status values used downstream:
 *
 *   'subject-bound'        DB row matched the requested subject directly.
 *   'no-bound-candidate'   No DB row matched; bundle is a no-data sentinel.
 *   'fallback-used'        allowFallback=true; bundle uses an unrelated row
 *                          and the report carries an explicit caveat.
 *   'system-wide'          Report type does not bind to a subject (regime,
 *                          system_quality). Always considered correct.
 */

import { REPORT_TYPES, createEvidenceBundle } from './report-evidence-bundle.mjs';

const SYSTEM_WIDE_TYPES = new Set([
  REPORT_TYPES.REGIME,
  REPORT_TYPES.SYSTEM_QUALITY,
]);

function slugify(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || '';
}

/*
 * Resolve a subject input into a canonical {kind, key, raw} record.
 *
 * Inputs commonly arrive as:
 *   - 'cloud-infrastructure' (theme slug, hyphenated)
 *   - 'NVDA' (ticker)
 *   - 12345 (event id)
 *   - { subjectId, displayName }
 *   - { theme: 'cloud-infrastructure' }
 *
 * The kind discrimination is a heuristic, but it gives DB adapters a clear
 * predicate for filtering rather than the previous ambiguous pass-through.
 */
export function resolveSubjectKey(input = {}) {
  const raw = (typeof input === 'string' ? input : (
    input.subjectKey
    || input.subject?.subjectId
    || input.subject?.displayName
    || input.theme
    || input.symbol
    || input.eventId
    || input.candidateId
    || input.subject
    || ''
  ));
  const trimmed = String(raw).trim();
  if (!trimmed) return { kind: 'unknown', key: '', raw: '' };

  // Numeric id → event or candidate
  if (/^\d+$/.test(trimmed)) {
    return { kind: 'numeric_id', key: trimmed, raw: trimmed };
  }

  // Tickers — short uppercase, no hyphens (NVDA, TLT, ^VIX, CL=F, BRK.B)
  if (/^[\^]?[A-Z][A-Z0-9.=-]{0,7}$/.test(trimmed) && !/^[a-z]/.test(trimmed)) {
    return { kind: 'symbol', key: trimmed.toUpperCase(), raw: trimmed };
  }

  // Hyphenated lower-case → theme slug
  const slug = slugify(trimmed);
  if (slug) return { kind: 'theme', key: slug, raw: trimmed };

  return { kind: 'unknown', key: trimmed, raw: trimmed };
}

/*
 * Whether the report type binds to a subject. Regime and system_quality are
 * inherently system-wide.
 */
export function isSystemWideReportType(reportType) {
  return SYSTEM_WIDE_TYPES.has(reportType);
}

/*
 * Build a structurally valid "no-bound-candidate" bundle. Used when strict
 * subject filtering finds no rows.
 *
 * The bundle is intentionally bare — no claim, no evidence, no metrics. The
 * downstream analyst draft and HTML compiler render this as a one-line
 * report saying "no subject-bound <type> for <subject>". The validator passes
 * because there are no claims to support.
 */
export function buildNoBoundCandidateBundle({
  reportType,
  requestedSubject,
  reason = 'No DB row matched the requested subject under strict filtering.',
} = {}) {
  const resolved = resolveSubjectKey(requestedSubject);
  const display = resolved.raw || 'unknown';
  const bundle = createEvidenceBundle({
    reportType,
    subject: {
      subjectType: 'no_bound_candidate',
      subjectId: `NO-MATCH-${resolved.kind}-${resolved.key || 'unknown'}`,
      displayName: `No ${reportType.replace(/_/g, ' ')} bound to ${display}`,
    },
    evidence: [{
      evidenceId: 'EVID-NO-BOUND-CANDIDATE',
      kind: 'calculated',
      publisher: 'Lattice DB',
      title: `Strict subject filter found no ${reportType.replace(/_/g, ' ')} row for ${display}.`,
      freshnessStatus: 'fresh',
      evidenceGrade: 'no-data',
    }],
    claims: [{
      claimId: 'CLM-001',
      claimType: 'subject_fidelity_negative',
      canonicalText: `No subject-bound ${reportType.replace(/_/g, ' ')} candidate exists for "${display}". This is intentional — the system declines to fall back to an unrelated top candidate.`,
      supportingEvidenceIds: ['EVID-NO-BOUND-CANDIDATE'],
      supportingMetricIds: [],
      caveatIds: ['CAV-NO-BOUND-CANDIDATE'],
      confidenceLevel: 'insufficient',
      validationStatus: 'no-data',
    }],
    caveats: [{
      caveatId: 'CAV-NO-BOUND-CANDIDATE',
      severity: 'high',
      type: 'no_bound_candidate',
      text: reason,
      appliesToClaimIds: ['CLM-001'],
    }],
    metadata: {
      dbBacked: true,
      requestedSubject: display,
      subjectMatchStatus: 'no-bound-candidate',
      noBoundCandidateReason: reason,
    },
  });
  return bundle;
}

/*
 * Attach subject fidelity metadata to an existing bundle. Mutates and returns.
 *
 * Always sets:
 *   metadata.requestedSubject  the original user-facing subject string
 *   metadata.subjectMatchStatus  one of the four status values above
 *
 * For fallback-used, also appends a caveat so the report renders the warning
 * inline (CAV-SUBJECT-FALLBACK).
 */
export function attachSubjectFidelity(bundle, {
  requestedSubject,
  matchStatus,
  resolvedSubjectKey = null,
  fallbackReason = null,
} = {}) {
  if (!bundle) return bundle;
  const display = typeof requestedSubject === 'string'
    ? requestedSubject
    : (requestedSubject?.displayName || requestedSubject?.subjectId || '');
  bundle.metadata = bundle.metadata || {};
  bundle.metadata.requestedSubject = display || null;
  bundle.metadata.subjectMatchStatus = matchStatus || 'unknown';
  if (resolvedSubjectKey) bundle.metadata.resolvedSubjectKey = resolvedSubjectKey;
  if (matchStatus === 'fallback-used') {
    bundle.metadata.fallbackReason = fallbackReason || null;
    const fallbackCaveat = {
      caveatId: 'CAV-SUBJECT-FALLBACK',
      severity: 'high',
      type: 'subject_fallback',
      text: `The requested subject "${display}" had no bound candidate. This report uses an unrelated top-ranked row as a fallback (allowFallback=true). Treat its subject as informational, not as the requested topic.`,
      appliesToClaimIds: bundle.claims?.map((c) => c.claimId) || [],
    };
    bundle.caveats = bundle.caveats || [];
    if (!bundle.caveats.some((c) => c.caveatId === fallbackCaveat.caveatId)) {
      bundle.caveats.push(fallbackCaveat);
    }
  }
  return bundle;
}

/*
 * Decide subject match status given the actual row's subject key vs requested.
 * Defensive — returns 'subject-bound' only when both keys exist and match.
 */
export function classifySubjectMatch({ requested, actual }) {
  const reqKey = resolveSubjectKey(requested).key.toLowerCase();
  const actKey = String(actual || '').toLowerCase();
  if (!reqKey || !actKey) return 'unknown';
  if (reqKey === actKey) return 'subject-bound';
  // Hyphen / underscore tolerance for theme slugs
  if (reqKey.replace(/[-_]/g, '') === actKey.replace(/[-_]/g, '')) return 'subject-bound';
  return 'subject-mismatch';
}
