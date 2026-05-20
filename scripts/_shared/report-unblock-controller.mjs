import { routeEvidenceProvider } from './evidence-provider-router.mjs';
import {
  issuerUniverseForEvidenceClass,
  resolveReportIssuerUniverse,
} from './report-issuer-universe.mjs';

const ISSUER_BRIDGE_CLASSES = new Set([
  'issuer_commentary',
  'primary_filing',
  'issuer_exposure',
  'capex_confirmation',
  'cloud_revenue',
  'budget_signal',
  'vendor_exposure',
  'pipeline_exposure',
]);

const NEGATIVE_READY = new Set([
  'supported_constraint',
  'checked_no_direct',
  'checked',
  'negative_collected',
]);

const NEGATIVE_REJECT = new Set([
  'invalidator',
  'invalidated',
  'negative_control_reject',
]);

function asArray(value) {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function compact(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function slugify(value) {
  return compact(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function unique(values = [], normalizer = (value) => compact(value)) {
  const seen = new Set();
  const out = [];
  for (const value of values || []) {
    const item = normalizer(value);
    if (!item) continue;
    const key = String(item).toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

function reportId(artifact = {}) {
  return artifact.reportId
    || artifact.manifest?.reportId
    || artifact.validation?.report?.id
    || artifact.bundle?.reportId
    || null;
}

function reportSubject(artifact = {}) {
  const subject = artifact.bundle?.subject || artifact.manifest?.subject || {};
  if (typeof subject === 'string') return subject;
  return subject.displayName || subject.display || subject.title || subject.subjectId || reportId(artifact) || 'report';
}

function reportType(artifact = {}) {
  return artifact.bundle?.reportType
    || artifact.manifest?.reportType
    || artifact.validation?.report?.type
    || 'report';
}

function reportThemes(artifact = {}) {
  const bundle = artifact.bundle || {};
  const subject = bundle.subject || {};
  return unique([
    subject.theme,
    subject.themeKey,
    subject.subjectType === 'theme' ? subject.subjectId : null,
    subject.metadata?.theme,
    subject.metadata?.themeKey,
    ...asArray(subject.metadata?.themes),
    ...asArray(bundle.metadata?.candidate?.themes),
    ...asArray(bundle.metadata?.themeContext?.themes),
  ]);
}

function validationBlockers(artifact = {}) {
  return [
    ...asArray(artifact.validation?.blockers),
    ...asArray(artifact.validation?.quality?.blockers),
  ];
}

export function normalizeUnblockBlockerType(input = {}) {
  const evidenceClass = slugify(input.evidenceClass || '');
  const state = slugify(input.state || input.visualStatus || '');
  const text = compact([
    input.type,
    input.message,
    input.reason,
    input.primaryBlocker,
    input.closureReason,
  ].join(' ')).toLowerCase();

  if (/repeated_client_phrase|render|export|artifact|figure|html|markdown/.test(text)) return 'technical_render_blocker';
  if (state === 'exhausted' || /exhaust/.test(text)) return 'search_exhausted';
  if (evidenceClass === 'negative_control' || /negative.?control/.test(text)) return 'negative_control_unchecked';
  if (state === 'blocked_missing_issuer_universe' || ISSUER_BRIDGE_CLASSES.has(evidenceClass) || /issuer/.test(text)) return 'issuer_bridge_missing';
  if (evidenceClass === 'market_validation') return 'market_validation_missing';
  if (evidenceClass) return 'evidence_missing';
  if (/market_validation|market validation/.test(text)) return 'market_validation_missing';
  return 'evidence_missing';
}

function stateAttemptsForClass(state = {}, evidenceClass = '') {
  const normalized = slugify(evidenceClass);
  const matches = Object.values(state.routes || {})
    .filter((entry) => slugify(entry.evidenceClass || '') === normalized);
  return {
    attempts: matches.reduce((sum, entry) => sum + Number(entry.attempts || 0), 0),
    exhausted: matches.length > 0 && matches.every((entry) => entry.exhausted),
    lastResult: matches.map((entry) => entry.lastResult).filter(Boolean).at(-1) || null,
    providers: unique(matches.flatMap((entry) => asArray(entry.providers))),
  };
}

function routeForBlocker({ artifact = {}, evidenceClass, query = null, issuerResolution = null, options = {} } = {}) {
  const normalized = slugify(evidenceClass);
  if (!normalized || normalized === 'unknown') return null;
  const resolution = issuerResolution || resolveReportIssuerUniverse(artifact, options);
  const issuerStatus = issuerUniverseForEvidenceClass(normalized, resolution, options);
  return routeEvidenceProvider({
    evidenceClass: normalized,
    query,
    subject: reportSubject(artifact),
    target: reportSubject(artifact),
    themes: reportThemes(artifact),
    issuerUniverse: issuerStatus.issuerUniverse,
    metadata: {
      reportId: reportId(artifact),
      reportType: reportType(artifact),
    },
  });
}

function technicalBlockers(artifact = {}) {
  return validationBlockers(artifact)
    .filter((item) => normalizeUnblockBlockerType(item) === 'technical_render_blocker')
    .map((item) => ({
      type: 'technical_render_blocker',
      evidenceClass: null,
      state: 'needs_fix',
      message: item.message || item.type || 'technical render blocker',
      nextAction: 'fix render/export validation blocker and regenerate report',
      promotionEligible: false,
    }));
}

function isCrossClassNextAction(action = '', type = '') {
  const text = compact(action).toLowerCase();
  if (!text) return false;
  if (type !== 'market_validation_missing' && /market validation|controlled market/.test(text)) return true;
  if (type !== 'negative_control_unchecked' && /negative.?control|invalidator/.test(text)) return true;
  if (type !== 'issuer_bridge_missing' && /issuer universe|issuer-specific|issuer bridge/.test(text)) return true;
  if (type !== 'technical_render_blocker' && /render|export|artifact/.test(text)) return true;
  return false;
}

function blockerFromClassRow({ artifact, row = {}, ledger = {}, state = {}, issuerResolution, options = {} } = {}) {
  const evidenceClass = slugify(row.evidenceClass);
  const attempts = stateAttemptsForClass(state, evidenceClass);
  const type = attempts.exhausted
    ? 'search_exhausted'
    : normalizeUnblockBlockerType({
      evidenceClass,
      state: row.state || row.visualStatus,
      primaryBlocker: ledger.primaryBlocker,
      closureReason: row.closureReason,
    });
  const rowNextAction = row.nextAction
    && !isCrossClassNextAction(row.nextAction, type)
    ? row.nextAction
    : null;
  const route = routeForBlocker({
    artifact,
    evidenceClass,
    query: row.query || row.nextQuery || null,
    issuerResolution,
    options,
  });
  return {
    type,
    evidenceClass,
    state: attempts.exhausted ? 'exhausted' : (row.state || row.visualStatus || 'pending'),
    tier: row.tier || 'missing',
    providerRoute: route?.providerRoute || row.providerRoute || null,
    executableCollectors: route?.executableCollectors || [],
    sourceProviders: route?.sourceProviders || [],
    queryVariants: route?.queryVariants || [],
    requiredFacts: route?.requiredFacts || [],
    collectorCapabilities: route?.collectorCapabilities || [],
    issuerUniverse: route?.issuerUniverse || [],
    promotionEligible: Boolean(route?.promotionEligible),
    negativeControlIntent: Boolean(route?.negativeControlIntent),
    blockedReason: route?.blockedReason || null,
    nextAction: route?.nextAction || rowNextAction || nextActionForBlockerType(type, evidenceClass),
    attempts: attempts.attempts,
    lastResult: attempts.lastResult,
  };
}

function nextActionForBlockerType(type, evidenceClass = '') {
  if (type === 'technical_render_blocker') return 'fix render/export validation blocker and regenerate report';
  if (type === 'issuer_bridge_missing') return 'resolve issuer universe and run issuer-specific collectors';
  if (type === 'market_validation_missing') return 'run local controlled market validation';
  if (type === 'negative_control_unchecked') return 'run separate negative-control lane';
  if (type === 'search_exhausted') return 'stop broad retries and review exhausted search path';
  return `stop broad source-query and run class-specific collector for ${evidenceClass || 'open evidence class'}`;
}

function statusFromBlockers({ blockers = [], ledger = {} } = {}) {
  const negativeStatus = slugify(ledger.negativeControlStatus || '');
  if (NEGATIVE_REJECT.has(negativeStatus) || blockers.some((item) => item.type === 'negative_control_reject')) {
    return 'negative_control_reject';
  }
  const nonTechnical = blockers.filter((item) => item.type !== 'technical_render_blocker');
  if (!blockers.length && (ledger.evidenceState === 'decision_ready_review' || ledger.marketTier === 'decision_grade')) {
    return 'decision_review_ready';
  }
  if (nonTechnical.length && nonTechnical.every((item) => item.type === 'search_exhausted' || item.state === 'exhausted')) {
    return 'search_exhausted_not_validated';
  }
  if (ledger.counts?.running || ledger.counts?.approved || ledger.counts?.pending) return 'blocked_collecting';
  if (blockers.length) return 'targeted_backfill_needed';
  return 'decision_review_ready';
}

function labelForUnblockStatus(status) {
  return {
    blocked_collecting: 'Blocked, collecting evidence',
    targeted_backfill_needed: 'Targeted backfill needed',
    decision_review_ready: 'Decision review ready',
    search_exhausted_not_validated: 'Search exhausted, not validated',
    negative_control_reject: 'Negative-control reject',
  }[status] || status || 'Targeted backfill needed';
}

function blockedClassRows(ledger = {}) {
  const open = new Set(asArray(ledger.openClasses).map(slugify));
  return asArray(ledger.classRows)
    .filter((row) => {
      const evidenceClass = slugify(row.evidenceClass);
      if (!evidenceClass) return false;
      if (open.has(evidenceClass)) return true;
      const state = slugify(row.state || row.visualStatus);
      const tier = slugify(row.tier || '');
      return ['pending', 'approved', 'running', 'needs_fix', 'exhausted', 'blocked_missing_issuer_universe'].includes(state)
        || ['missing', 'weak_noise', 'weak_screen'].includes(tier);
    });
}

export function buildGenericEvidenceUnblockPlan({
  artifact = {},
  closureLedger = {},
  state = {},
  options = {},
} = {}) {
  const issuerResolution = resolveReportIssuerUniverse(artifact, options);
  const classBlockers = blockedClassRows(closureLedger)
    .map((row) => blockerFromClassRow({
      artifact,
      row,
      ledger: closureLedger,
      state,
      issuerResolution,
      options,
    }));
  const blockers = [
    ...technicalBlockers(artifact),
    ...classBlockers,
  ];
  const deduped = [];
  const seen = new Set();
  for (const blocker of blockers) {
    const key = `${blocker.type}:${blocker.evidenceClass || blocker.message || ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(blocker);
  }
  const blockerCounts = deduped.reduce((acc, item) => {
    acc[item.type] = (acc[item.type] || 0) + 1;
    return acc;
  }, {});
  const unblockStatus = statusFromBlockers({ blockers: deduped, ledger: closureLedger });
  return {
    ok: true,
    reportId: reportId(artifact),
    subject: reportSubject(artifact),
    reportType: reportType(artifact),
    unblockStatus,
    unblockStatusLabel: labelForUnblockStatus(unblockStatus),
    blockerCounts,
    blockers: deduped,
    routePlans: deduped.filter((item) => item.evidenceClass).map((item) => ({
      evidenceClass: item.evidenceClass,
      providerRoute: item.providerRoute,
      executableCollectors: item.executableCollectors,
      sourceProviders: item.sourceProviders,
      queryVariants: item.queryVariants,
      requiredFacts: item.requiredFacts,
      collectorCapabilities: item.collectorCapabilities,
      issuerUniverse: item.issuerUniverse,
      promotionEligible: item.promotionEligible,
      negativeControlIntent: item.negativeControlIntent,
      blockedReason: item.blockedReason,
      nextAction: item.nextAction,
    })),
    issuerUniverse: issuerResolution.issuerUniverse,
    issuerResolution: {
      issuerUniverse: issuerResolution.issuerUniverse,
      excludedSymbols: issuerResolution.excludedSymbols,
      reason: issuerResolution.reason,
      themes: issuerResolution.themes,
      legacyMappings: issuerResolution.legacyMappings,
    },
    nextAction: deduped[0]?.nextAction || closureLedger.nextAction || 'decision review',
    closureEvidenceState: closureLedger.evidenceState || null,
    closureVisualStatus: closureLedger.visualStatus || null,
    marketTier: closureLedger.marketTier || null,
    negativeControlStatus: closureLedger.negativeControlStatus || 'unchecked',
  };
}

export const __test = {
  NEGATIVE_READY,
  stateAttemptsForClass,
  statusFromBlockers,
};
