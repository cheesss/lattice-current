import crypto from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

export const EVIDENCE_GATE_CONSOLIDATOR_VERSION = 'evidence-gate-consolidator-v1';
export const DEFAULT_EVIDENCE_GATE_CONSOLIDATION_PATH = path.join(
  process.cwd(),
  'data',
  'runtime',
  'evidence-gate-consolidation.latest.json',
);

const CLOSED_NEGATIVE_CONTROL = new Set(['SURVIVED', 'CHECKED_NO_DIRECT']);
const CLOSED_MARKET_VALIDATION = new Set(['controlled_ready', 'human_review_caveated']);
const CLOSED_VALUATION_BRIDGE = new Set(['present', 'human_review_caveated']);
const PROMOTION_CLASSES = new Set([
  'issuer_exposure',
  'issuer_commentary',
  'primary_filing',
  'backlog',
  'guidance',
  'segment_revenue',
  'capacity',
  'technical_qualification',
  'test_facility_capacity',
  'material_input',
  'engineering_process',
  'permitting_regulatory',
]);

const ALTERNATE_GATE_ACTIONS = new Set([
  'run_limited_issuer_bridge_track',
  'run_limited_negative_control',
  'run_limited_holdout_validation',
]);

const ALTERNATE_GATE_ROUTE = {
  run_limited_issuer_bridge_track: 'issuer_filing_transcript_or_contract_alternate_official_bucket',
  run_limited_negative_control: 'negative-control-official-route-alternate-query-family',
  run_limited_holdout_validation: 'holdout-validation-independent-source-alternate-bucket',
};

const ALTERNATE_GATE_QUERY = {
  run_limited_issuer_bridge_track: 'alternate bounded issuer bridge route using a distinct official issuer/customer source bucket',
  run_limited_negative_control: 'narrower bounded negative-control check using a distinct official invalidator query family',
  run_limited_holdout_validation: 'alternate bounded holdout validation from a source group independent of generation and issuer exposure',
};

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (value === null || value === undefined || value === '') return [];
  return [value];
}

function compact(value = '') {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function stableHash(value) {
  return crypto.createHash('sha1').update(String(value || '')).digest('hex').slice(0, 12);
}

function zeroBoundary(extra = {}) {
  return {
    providerActivationWrites: 0,
    sourceRegistryWrites: 0,
    canonicalWrites: 0,
    readinessPromotionWrites: 0,
    reportCandidateWrites: 0,
    portfolioActionWrites: 0,
    approvalQueueWrites: 0,
    ...(extra || {}),
  };
}

function pick(row = {}, ...keys) {
  for (const key of keys) {
    const value = row?.[key] ?? row?.payload?.[key] ?? row?.raw?.[key];
    if (value !== undefined && value !== null && value !== '') return value;
  }
  return '';
}

function urlHost(value = '') {
  try {
    const url = new URL(String(value));
    return url.hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

function normalizeSeedId(row = {}) {
  return compact(
    pick(row, 'seedId', 'childSeedId', 'subjectId', 'operatorSeedId')
    || 'unknown-seed',
  );
}

function inferTrackId(row = {}) {
  const explicit = compact(pick(row, 'trackId', 'track', 'evidenceTrack'));
  if (explicit) return explicit;
  const evidenceClass = compact(pick(row, 'evidenceClass', 'desiredEvidenceClass'));
  if (['grid_interconnection', 'mechanism_validation', 'engineering_process', 'permitting_regulatory', 'operating_kpi', 'policy_funding'].includes(evidenceClass)) {
    return 'mechanism_validation_track';
  }
  if (['negative_control'].includes(evidenceClass)) return 'negative_control_track';
  if (['holdout_validation'].includes(evidenceClass)) return 'holdout_validation_track';
  if (['market_validation'].includes(evidenceClass)) return 'market_validation_track';
  return 'issuer_bridge_track';
}

function independentSourceKey(row = {}) {
  const sourceGroup = compact(pick(row, 'sourceGroup', 'sourceType', 'sourceBucket'));
  const provider = compact(pick(row, 'providerName', 'sourceProvider', 'provider', 'source'));
  const host = urlHost(pick(row, 'sourceUrl', 'url'));
  return compact([sourceGroup, provider || host].filter(Boolean).join(':'));
}

function latestIteration(repairLoop = {}) {
  return asArray(repairLoop?.iterations).at(-1) || {};
}

function repairLoopSubject(repairLoop = {}, finalReport = {}) {
  repairLoop = repairLoop || {};
  finalReport = finalReport || {};
  const latest = latestIteration(repairLoop);
  const subject = latest?.actionResult?.reportSubjectDryRun
    || latest?.actionResult?.dryRunReportSubject
    || repairLoop?.dryRunReportSubject
    || finalReport?.subject
    || {};
  const selectedSeed = latest?.inputState?.selectedSeed
    || repairLoop?.inputState?.selectedSeed
    || repairLoop?.selectedChildSeed
    || {};
  const issuerUniverse = asArray(
    subject.issuerUniverse
    || selectedSeed.issuerUniverse
    || repairLoop.issuerUniverse
    || finalReport.issuerUniverse,
  ).map(compact).filter(Boolean);
  return {
    seedId: compact(
      subject.childSeedId
      || subject.subjectId
      || selectedSeed.childSeedId
      || selectedSeed.seedId
      || repairLoop.seedId
      || '',
    ),
    trackId: compact(subject.trackId || selectedSeed.trackId || 'issuer_bridge_track'),
    subjectLabel: compact(subject.subjectLabel || selectedSeed.bottleneckNode || finalReport.subjectLabel || finalReport.title || ''),
    bottleneckNode: compact(subject.bottleneckNode || selectedSeed.bottleneckNode || ''),
    issuerUniverse,
  };
}

function normalizeHoldout(value) {
  if (value === true) return true;
  return /confirmed|true/i.test(compact(value));
}

function normalizeMarketValidation({ repairLoop = {}, finalReport = {}, row = {} } = {}) {
  repairLoop = repairLoop || {};
  finalReport = finalReport || {};
  const direct = compact(
    pick(row, 'marketValidationStatus')
    || repairLoop.marketValidationAfter
    || repairLoop.marketValidationStatus
    || finalReport.marketValidationStatus
    || '',
  );
  if (direct === 'decision_use_caveat') return 'human_review_caveated';
  if (direct) return direct;
  if (row.localControlledMarketData === true || row.payload?.localControlledMarketData === true) return 'controlled_ready';
  return 'missing';
}

function normalizeValuationBridge({ repairLoop = {}, finalReport = {}, row = {} } = {}) {
  repairLoop = repairLoop || {};
  finalReport = finalReport || {};
  const direct = compact(
    pick(row, 'valuationBridgeStatus', 'expectationBridgeStatus')
    || repairLoop.valuationBridgeStatus
    || repairLoop.valuationBridgeAfter
    || repairLoop.expectationBridgeStatus
    || finalReport.valuationBridgeStatus
    || finalReport.expectationBridgeStatus
    || '',
  );
  if (direct === 'decision_use_caveat') return 'human_review_caveated';
  if (direct) return direct;
  if (row.localValuationCache === true || row.payload?.localValuationCache === true) return 'present';
  return 'missing';
}

function normalizeMarketValidationBridgeArtifact(bridge = {}) {
  if (!bridge || typeof bridge !== 'object') return 'missing';
  const support = bridge.marketRegimeSupport || {};
  const direct = compact(
    bridge.marketValidationStatus
    || support.investmentReadinessMarketStatus
    || support.marketValidationStatus
    || '',
  );
  const regime = compact(bridge.marketValidationRegimeStatus || support.marketValidationRegimeStatus || '');
  if (/^controlled_ready$/i.test(direct) && regime === 'regime_supported') return 'controlled_ready';
  if (/controlled_ready|market_validation_caveated/i.test(direct) && ['regime_supported', 'regime_caveated'].includes(regime)) {
    return 'human_review_caveated';
  }
  if (support.marketValidationResearchUseAllowed === true && ['regime_supported', 'regime_caveated'].includes(regime)) {
    return 'human_review_caveated';
  }
  return 'missing';
}

function normalizeValuationBridgeArtifact(bridge = {}) {
  if (!bridge || typeof bridge !== 'object') return 'missing';
  const status = compact(bridge.valuationBridgeStatus || '');
  if (status === 'valuation_bridge_closed') return 'present';
  if (status === 'valuation_bridge_caveated') return 'human_review_caveated';
  if (status === 'valuation_bridge_contradictory') return 'contradictory';
  return 'missing';
}

function normalizedNegativeControl(repairLoop = {}, row = {}) {
  repairLoop = repairLoop || {};
  return compact(
    pick(row, 'negativeControlStatus', 'negativeControlAfter')
    || repairLoop.negativeControlAfter
    || repairLoop.negativeControlStatus
    || '',
  );
}

function createState(seedId, trackId) {
  return {
    seedId: compact(seedId || 'unknown-seed'),
    trackId: compact(trackId || 'issuer_bridge_track'),
    rawEvidenceCount: 0,
    acceptedEvidenceCount: 0,
    acceptedPromotionEvidenceCount: 0,
    acceptedEvidenceClasses: new Set(),
    promotionEvidenceClasses: new Set(),
    sourceKeys: new Set(),
    rawEvidenceIds: [],
    acceptedEvidenceIds: [],
    acceptedPromotionEvidenceIds: [],
    issuerBridgeStatus: 'missing',
    negativeControlStatus: 'not_closed',
    holdoutStatus: 'missing',
    holdoutConfirmed: false,
    marketValidationStatus: 'missing',
    valuationBridgeStatus: 'missing',
    subjectLabel: '',
    bottleneckNode: '',
    issuerUniverse: new Set(),
    evidenceRows: [],
  };
}

function rowEvidenceId(row = {}) {
  return compact(pick(row, 'evidenceId', 'id')) || `evidence:${stableHash(JSON.stringify(row).slice(0, 1000))}`;
}

function addRowToState(state, row = {}, lane = 'raw') {
  const evidenceClass = compact(pick(row, 'evidenceClass', 'desiredEvidenceClass'));
  const id = rowEvidenceId(row);
  if (lane === 'raw') {
    state.rawEvidenceCount += 1;
    state.rawEvidenceIds.push(id);
  }
  if (lane === 'accepted') {
    state.acceptedEvidenceCount += 1;
    state.acceptedEvidenceIds.push(id);
    if (evidenceClass) state.acceptedEvidenceClasses.add(evidenceClass);
    const sourceKey = independentSourceKey(row);
    if (sourceKey) state.sourceKeys.add(sourceKey);
  }
  if (lane === 'promotion') {
    state.acceptedPromotionEvidenceCount += 1;
    state.acceptedPromotionEvidenceIds.push(id);
    if (evidenceClass) {
      state.acceptedEvidenceClasses.add(evidenceClass);
      state.promotionEvidenceClasses.add(evidenceClass);
    }
    const sourceKey = independentSourceKey(row);
    if (sourceKey) state.sourceKeys.add(sourceKey);
  }
  state.evidenceRows.push({ lane, evidenceClass, evidenceId: id });
  if (compact(pick(row, 'subjectLabel'))) state.subjectLabel ||= compact(pick(row, 'subjectLabel'));
  if (compact(pick(row, 'bottleneckNode'))) state.bottleneckNode ||= compact(pick(row, 'bottleneckNode'));
  if (['issuer_exposure', 'issuer_commentary', 'primary_filing', 'backlog', 'guidance', 'segment_revenue', 'capacity'].includes(evidenceClass) && lane === 'promotion') {
    state.issuerBridgeStatus = 'closed';
  }
  if (evidenceClass === 'holdout_validation' && lane !== 'raw') {
    state.holdoutConfirmed = true;
    state.holdoutStatus = 'confirmed';
  }
  if (evidenceClass === 'negative_control') {
    const status = compact(pick(row, 'negativeControlStatus')) || (lane === 'accepted' ? 'CHECKED_NO_DIRECT' : '');
    if (status) state.negativeControlStatus = status;
  }
  if (evidenceClass === 'market_validation' && lane !== 'raw') {
    state.marketValidationStatus = normalizeMarketValidation({ row });
  }
  if (evidenceClass === 'valuation_expectation_bridge' && lane !== 'raw') {
    state.valuationBridgeStatus = normalizeValuationBridge({ row });
  }
}

function applyRepairLoopState(state, { repairLoop = {}, finalReport = {} } = {}) {
  repairLoop = repairLoop || {};
  finalReport = finalReport || {};
  const latest = latestIteration(repairLoop);
  const counts = latest?.evidenceCountsAfter || repairLoop?.evidenceCountsAfter || {};
  state.acceptedEvidenceCount = Math.max(
    state.acceptedEvidenceCount,
    Number(repairLoop.acceptedEvidenceAfter ?? counts.acceptedEvidenceCount ?? finalReport.acceptedEvidenceCount ?? 0),
  );
  state.acceptedPromotionEvidenceCount = Math.max(
    state.acceptedPromotionEvidenceCount,
    Number(repairLoop.acceptedPromotionEvidenceAfter ?? counts.acceptedPromotionEvidenceCount ?? finalReport.acceptedPromotionEvidenceCount ?? 0),
  );
  const breadth = Number(counts.independentSourceBreadth ?? repairLoop.independentSourceBreadth ?? finalReport.independentSourceBreadth ?? 0);
  for (let index = 0; index < breadth; index += 1) state.sourceKeys.add(`repair-loop-source-${index + 1}`);
  const negative = normalizedNegativeControl(repairLoop);
  if (negative) state.negativeControlStatus = negative;
  if (normalizeHoldout(repairLoop.holdoutAfter ?? finalReport.holdoutConfirmed)) {
    state.holdoutConfirmed = true;
    state.holdoutStatus = 'confirmed';
  }
  const issuer = compact(repairLoop.issuerBridgeAfter || repairLoop.issuerBridgeStatus || finalReport.issuerBridgeStatus || '');
  if (issuer) state.issuerBridgeStatus = issuer;
  const market = normalizeMarketValidation({ repairLoop, finalReport });
  if (market !== 'missing') state.marketValidationStatus = market;
  const valuation = normalizeValuationBridge({ repairLoop, finalReport });
  if (valuation !== 'missing') state.valuationBridgeStatus = valuation;
  const subject = repairLoopSubject(repairLoop, finalReport);
  state.subjectLabel ||= subject.subjectLabel;
  state.bottleneckNode ||= subject.bottleneckNode;
  for (const issuer of subject.issuerUniverse || []) state.issuerUniverse.add(issuer);
}

function applyValuationExpectationBridgeState(state, bridge = {}) {
  if (!bridge || typeof bridge !== 'object') return;
  const market = normalizeMarketValidationBridgeArtifact(bridge);
  if (market !== 'missing') state.marketValidationStatus = market;
  const valuation = normalizeValuationBridgeArtifact(bridge);
  if (valuation !== 'missing') state.valuationBridgeStatus = valuation;
  for (const issuer of asArray(bridge.issuerUniverse).map(compact).filter(Boolean)) {
    state.issuerUniverse.add(issuer);
  }
}

function applyGateSnapshotState(state, snapshot = {}) {
  if (!snapshot || typeof snapshot !== 'object') return;
  state.acceptedEvidenceCount = Math.max(
    state.acceptedEvidenceCount,
    Number(snapshot.acceptedEvidenceCount || 0),
  );
  state.acceptedPromotionEvidenceCount = Math.max(
    state.acceptedPromotionEvidenceCount,
    Number(snapshot.acceptedPromotionEvidenceCount || 0),
  );
  const breadth = Number(snapshot.independentSourceBreadth || 0);
  for (let index = 0; index < breadth; index += 1) state.sourceKeys.add(`report-staging-source-${index + 1}`);
  const snapshotNegative = compact(snapshot.negativeControlStatus);
  if (snapshotNegative && (!CLOSED_NEGATIVE_CONTROL.has(state.negativeControlStatus) || CLOSED_NEGATIVE_CONTROL.has(snapshotNegative))) {
    state.negativeControlStatus = snapshotNegative;
  }
  if (snapshot.holdoutConfirmed === true) {
    state.holdoutConfirmed = true;
    state.holdoutStatus = 'confirmed';
  }
  const snapshotIssuer = compact(snapshot.issuerBridgeStatus);
  if (snapshotIssuer && (state.issuerBridgeStatus !== 'closed' || snapshotIssuer === 'closed')) {
    state.issuerBridgeStatus = snapshotIssuer;
  }
  if (compact(snapshot.marketValidationStatus)) {
    const snapshotMarket = snapshot.marketValidationStatus === 'decision_use_caveat'
      ? 'human_review_caveated'
      : compact(snapshot.marketValidationStatus);
    if (!CLOSED_MARKET_VALIDATION.has(state.marketValidationStatus) || CLOSED_MARKET_VALIDATION.has(snapshotMarket)) {
      state.marketValidationStatus = snapshotMarket;
    }
  }
  if (compact(snapshot.valuationBridgeStatus)) {
    const snapshotValuation = snapshot.valuationBridgeStatus === 'decision_use_caveat'
      ? 'human_review_caveated'
      : compact(snapshot.valuationBridgeStatus);
    if (!CLOSED_VALUATION_BRIDGE.has(state.valuationBridgeStatus) || CLOSED_VALUATION_BRIDGE.has(snapshotValuation)) {
      state.valuationBridgeStatus = snapshotValuation;
    }
  }
}

function finalizeState(state, existing = null) {
  const acceptedEvidenceClasses = [...state.acceptedEvidenceClasses].sort();
  const promotionEvidenceClasses = [...state.promotionEvidenceClasses].sort();
  const independentSourceBreadth = state.sourceKeys.size;
  if (state.issuerBridgeStatus === 'missing' && promotionEvidenceClasses.some((item) => PROMOTION_CLASSES.has(item))) {
    state.issuerBridgeStatus = 'partial';
  }
  if (!state.negativeControlStatus || state.negativeControlStatus === 'not_closed') state.negativeControlStatus = 'not_closed';
  const missingGates = [];
  const closedGates = [];
  if (state.acceptedPromotionEvidenceCount >= 1) closedGates.push('accepted_promotion_evidence');
  else missingGates.push('accepted_promotion_evidence_missing');
  if (state.acceptedEvidenceCount >= 1) closedGates.push('accepted_evidence');
  else missingGates.push('accepted_evidence_missing');
  if (independentSourceBreadth >= 2) closedGates.push('independent_source_breadth');
  else missingGates.push('independent_source_breadth_missing');
  if (state.issuerBridgeStatus === 'closed') closedGates.push('issuer_bridge');
  else missingGates.push('issuer_bridge_missing');
  if (CLOSED_NEGATIVE_CONTROL.has(state.negativeControlStatus)) closedGates.push('negative_control');
  else missingGates.push('negative_control_not_closed');
  if (state.holdoutConfirmed === true) closedGates.push('holdout');
  else missingGates.push('holdout_missing');
  if (CLOSED_MARKET_VALIDATION.has(state.marketValidationStatus)) closedGates.push('market_validation');
  else missingGates.push('market_validation_missing');
  if (CLOSED_VALUATION_BRIDGE.has(state.valuationBridgeStatus)) closedGates.push('valuation_bridge');
  else missingGates.push('valuation_bridge_missing');

  const nextGateAction = nextActionForMissingGates(missingGates);
  const blockedPendingCache = isValuationOnlyBlocked({ missingGates, closedGates, nextGateAction });
  const blockType = blockedPendingCache ? 'valuation_blocked_pending_cache' : null;
  const previous = asArray(existing?.gateClosureStates).find((item) => (
    item.seedId === state.seedId
    && item.trackId === state.trackId
    && item.nextGateAction === nextGateAction
  ));
  const sameCounts = previous
    && Number(previous.acceptedPromotionEvidenceCount || 0) === state.acceptedPromotionEvidenceCount
    && Number(previous.acceptedEvidenceCount || 0) === state.acceptedEvidenceCount
    && Number(previous.independentSourceBreadth || 0) === independentSourceBreadth
    && previous.negativeControlStatus === state.negativeControlStatus
    && previous.holdoutConfirmed === state.holdoutConfirmed
    && previous.issuerBridgeStatus === state.issuerBridgeStatus
    && previous.marketValidationStatus === state.marketValidationStatus
    && previous.valuationBridgeStatus === state.valuationBridgeStatus;
  const repeatedWithoutStrongProgress = Boolean(previous && sameCounts && missingGates.length > 0);
  const lastGateAttemptFingerprint = gateAttemptFingerprint(state, nextGateAction, missingGates);
  const alternateGateAlreadyTried = Boolean(
    previous?.alternateGateTaskCreated === true
    && previous?.lastGateAttemptFingerprint === lastGateAttemptFingerprint,
  );
  const alternateGateTaskCreated = Boolean(
    repeatedWithoutStrongProgress
    && ALTERNATE_GATE_ACTIONS.has(nextGateAction)
    && !alternateGateAlreadyTried
    && blockedPendingCache !== true,
  );
  const gateTaskSuppressionReason = blockedPendingCache
    ? 'valuation_blocked_pending_cache'
    : repeatedWithoutStrongProgress && !alternateGateTaskCreated
      ? (alternateGateAlreadyTried
        ? 'same_gate_action_without_strong_progress_after_alternate_task'
        : 'same_gate_action_without_strong_progress_no_alternate_route')
      : null;
  return {
    seedId: state.seedId,
    trackId: state.trackId,
    subjectLabel: state.subjectLabel || state.bottleneckNode || state.seedId,
    bottleneckNode: state.bottleneckNode || null,
    issuerUniverse: [...state.issuerUniverse].sort(),
    rawEvidenceCount: state.rawEvidenceCount,
    acceptedEvidenceCount: state.acceptedEvidenceCount,
    acceptedPromotionEvidenceCount: state.acceptedPromotionEvidenceCount,
    acceptedEvidenceClasses,
    acceptedPromotionEvidenceClasses: promotionEvidenceClasses,
    independentSourceBreadth,
    issuerBridgeStatus: state.issuerBridgeStatus,
    negativeControlStatus: state.negativeControlStatus,
    holdoutStatus: state.holdoutStatus,
    holdoutConfirmed: state.holdoutConfirmed,
    marketValidationStatus: state.marketValidationStatus,
    valuationBridgeStatus: state.valuationBridgeStatus,
    rawEvidenceIds: state.rawEvidenceIds.slice(0, 50),
    acceptedEvidenceIds: state.acceptedEvidenceIds.slice(0, 50),
    acceptedPromotionEvidenceIds: state.acceptedPromotionEvidenceIds.slice(0, 50),
    closedGates,
    missingGates,
    nextGateAction,
    blockedPendingCache,
    blockType,
    terminalBlockers: blockedPendingCache
      ? ['valuation_context_missing', 'issuer_fundamentals_missing']
      : [],
    whyNotReportCandidate: missingGates.length
      ? `missing gates: ${missingGates.join(', ')}`
      : 'all seed-centric report gates closed for human review staging',
    gateClosureProgress: Number((closedGates.length / (closedGates.length + missingGates.length || 1)).toFixed(4)),
    reportCandidateAllowedDiagnostic: missingGates.length === 0,
    repeatedWithoutStrongProgress,
    alternateGateTaskCreated,
    lastGateAttemptFingerprint,
    gateTaskSuppressionReason,
    stopReason: blockedPendingCache
      ? 'valuation_context_cache_required'
      : (gateTaskSuppressionReason ? 'operator_review_required_no_gate_progress' : null),
    mutationBoundary: zeroBoundary(),
  };
}

function isValuationOnlyBlocked({ missingGates = [], closedGates = [], nextGateAction = '' } = {}) {
  const missing = new Set(asArray(missingGates));
  if (missing.size !== 1 || !missing.has('valuation_bridge_missing')) return false;
  return nextGateAction === 'local_market_or_valuation_fixture_required'
    && closedGates.includes('accepted_promotion_evidence')
    && closedGates.includes('accepted_evidence')
    && closedGates.includes('issuer_bridge')
    && closedGates.includes('negative_control')
    && closedGates.includes('holdout')
    && closedGates.includes('market_validation');
}

function nextActionForMissingGates(missingGates = []) {
  if (missingGates.includes('accepted_promotion_evidence_missing')) return 'run_limited_issuer_bridge_track';
  if (missingGates.includes('issuer_bridge_missing')) return 'run_limited_issuer_bridge_track';
  if (missingGates.includes('negative_control_not_closed')) return 'run_limited_negative_control';
  if (missingGates.includes('holdout_missing')) return 'run_limited_holdout_validation';
  if (missingGates.includes('market_validation_missing')) return 'run_limited_controlled_market_validation';
  if (missingGates.includes('valuation_bridge_missing')) return 'local_market_or_valuation_fixture_required';
  if (missingGates.includes('independent_source_breadth_missing')) return 'run_limited_holdout_validation';
  return 'stage_report_candidate_for_operator_review';
}

function gateAttemptFingerprint(state = {}, nextGateAction = '', missingGates = []) {
  return stableHash([
    state.seedId,
    state.trackId,
    nextGateAction,
    asArray(missingGates).join('|'),
    state.acceptedPromotionEvidenceCount,
    state.acceptedEvidenceCount,
    state.sourceKeys?.size || 0,
    state.issuerBridgeStatus,
    state.negativeControlStatus,
    state.holdoutConfirmed,
    state.marketValidationStatus,
    state.valuationBridgeStatus,
  ].join('::'));
}

function taskForState(state = {}) {
  if (!state || !state.nextGateAction || state.reportCandidateAllowedDiagnostic) return null;
  if (state.blockedPendingCache === true) return null;
  if (state.repeatedWithoutStrongProgress && state.alternateGateTaskCreated !== true) return null;
  if (state.acceptedPromotionEvidenceCount < 1) return null;
  const action = state.nextGateAction;
  const map = {
    run_limited_issuer_bridge_track: {
      evidenceClass: 'issuer_exposure',
      providerRoute: 'issuer_filing_transcript_or_contract',
      status: 'queued',
      sourceQuery: 'bounded issuer bridge evidence for seed-centric gate consolidation',
    },
    run_limited_negative_control: {
      evidenceClass: 'negative_control',
      providerRoute: 'negative-control-official-route',
      status: 'queued',
      sourceQuery: 'bounded negative-control check for accepted promotion evidence seed',
    },
    run_limited_holdout_validation: {
      evidenceClass: 'holdout_validation',
      providerRoute: 'holdout-validation-independent-source',
      status: 'queued',
      sourceQuery: 'bounded holdout validation from independent source group',
    },
    run_limited_controlled_market_validation: {
      evidenceClass: 'market_validation',
      providerRoute: 'local-market-validation',
      status: 'queued_local_market_validation',
      sourceQuery: 'local controlled market validation for seed-centric report gate',
    },
  };
  const spec = map[action];
  if (!spec) return null;
  const alternate = state.alternateGateTaskCreated === true;
  const taskIdSuffix = alternate ? `alternate-${state.lastGateAttemptFingerprint || stableHash(action)}` : action;
  return {
    taskId: `gate-consolidation-${stableHash(`${state.seedId}:${state.trackId}:${taskIdSuffix}`)}`,
    seedId: state.seedId,
    trackId: state.trackId,
    evidenceClass: spec.evidenceClass,
    providerRoute: alternate ? (ALTERNATE_GATE_ROUTE[action] || `${spec.providerRoute}-alternate`) : spec.providerRoute,
    status: spec.status,
    reviewRequired: false,
    sourceQuery: alternate ? (ALTERNATE_GATE_QUERY[action] || `alternate ${spec.sourceQuery}`) : spec.sourceQuery,
    acceptanceCriteria: {
      seedCentricGateClosure: true,
      acceptedPromotionEvidenceRequired: true,
      rawEvidenceRaisesReadiness: false,
      rawMetadataOnlyAccepted: false,
      sourceIndependenceRequired: true,
      originatingGateAction: action,
      attemptVariant: alternate ? 'alternate_official_source_bucket' : 'primary_gate_route',
      previousGateAttemptFingerprint: alternate ? state.lastGateAttemptFingerprint : null,
    },
    gateConsolidation: {
      missingGates: state.missingGates,
      nextGateAction: action,
      gateClosureProgress: state.gateClosureProgress,
      repeatedWithoutStrongProgress: state.repeatedWithoutStrongProgress === true,
      alternateGateTaskCreated: alternate,
      lastGateAttemptFingerprint: state.lastGateAttemptFingerprint || null,
      gateTaskSuppressionReason: state.gateTaskSuppressionReason || null,
    },
    mutationBoundary: zeroBoundary(),
    remediationSource: EVIDENCE_GATE_CONSOLIDATOR_VERSION,
  };
}

function localFixtureRequirementForState(state = {}, gate = '') {
  if (!state || !gate) return null;
  const base = {
    requirementId: `local-fixture-${stableHash(`${state.seedId}:${state.trackId}:${gate}`)}`,
    seedId: state.seedId,
    trackId: state.trackId,
    subjectLabel: state.subjectLabel,
    bottleneckNode: state.bottleneckNode,
    issuerUniverse: state.issuerUniverse || [],
    gate,
    status: 'local_market_or_valuation_fixture_required',
    sourcePolicy: {
      allowedSources: ['trusted_local_cache', 'local_controlled_market_data'],
      forbiddenSources: ['rss', 'source_query_market_context', 'news_snippet', 'llm_opinion'],
      promotionFromRawEvidenceAllowed: false,
      automaticReadinessPromotionAllowed: false,
    },
    mutationBoundary: zeroBoundary(),
  };
  if (gate === 'market_validation_missing') {
    return {
      ...base,
      requirementType: 'local_controlled_market_validation',
      requiredSchema: {
        issuer: 'string',
        eventId: 'string',
        window: 'string',
        benchmarkReturn: 'number',
        eventMinusControl: 'number',
        controlSampleSize: 'number',
        tStat: 'number',
        volatilityRegime: 'string',
        rateRegime: 'string',
        sectorRegime: 'string',
        marketRegime: 'string',
      },
      acceptanceBoundary: {
        benchmarkRequired: true,
        matchedControlRequired: true,
        regimeSupportRequired: true,
        sourceQueryMarketEvidenceAllowed: false,
        decisionReadyAllowed: false,
      },
    };
  }
  if (gate === 'valuation_bridge_missing') {
    return {
      ...base,
      requirementType: 'local_valuation_expectation_bridge',
      requiredSchema: {
        issuer: 'string',
        acceptedIssuerBridgeEvidenceIds: 'string[]',
        localPriceWindow: 'object',
        peerRelativeMove: 'number|string',
        fundamentalMetricCoverage: 'object',
        eventSensitivity: 'object|string',
        expectationCaveat: 'string',
        valuationBridgeStatus: 'present|human_review_caveated',
      },
      acceptanceBoundary: {
        acceptedIssuerBridgeRequired: true,
        localFundamentalsRequired: true,
        llmOpinionAllowed: false,
        buySellLanguageAllowed: false,
        decisionReadyAllowed: false,
      },
    };
  }
  if (gate === 'historical_analogue_missing') {
    return {
      ...base,
      requirementType: 'historical_analogue_bridge',
      requiredSchema: {
        analogueId: 'string',
        bottleneckClass: 'string',
        issuerRolePattern: 'string[]',
        evidenceClasses: 'string[]',
        catalystTypes: 'string[]',
        issuerBasket: 'string[]',
        peerBasket: 'string[]',
        marketOutcome: 'object',
        sourceProvenance: 'trusted_local_analogue_library|accepted_prior_report',
      },
      acceptanceBoundary: {
        usableAnalogueCountRequired: 2,
        generatedDryRunReportsAllowed: false,
        sourceQueryAnalogueAllowed: false,
        llmOpinionAllowed: false,
        readinessPromotionAllowed: false,
      },
    };
  }
  return null;
}

function localFixtureRequirementsForState(state = {}) {
  const gates = ['market_validation_missing'];
  if (asArray(state.missingGates).includes('valuation_bridge_missing')) {
    gates.push('valuation_bridge_missing', 'historical_analogue_missing');
  }
  return gates
    .filter((gate) => gate === 'historical_analogue_missing' || asArray(state.missingGates).includes(gate))
    .map((gate) => localFixtureRequirementForState(state, gate))
    .filter(Boolean);
}

function stopReasonForNoProgress(states = []) {
  if (asArray(states).some((state) => ALTERNATE_GATE_ACTIONS.has(state.nextGateAction))) {
    return 'operator_review_required_no_gate_progress';
  }
  const missing = new Set(states.flatMap((state) => state.missingGates || []));
  if (missing.has('market_validation_missing') || missing.has('valuation_bridge_missing')) {
    return 'local_market_or_valuation_fixture_required';
  }
  return 'operator_review_required_no_gate_progress';
}

function sortPriority(state = {}) {
  if (state.reportCandidateAllowedDiagnostic === true) return 1000;
  if (state.acceptedPromotionEvidenceCount > 0 && state.blockedPendingCache !== true && state.nextGateAction !== 'local_market_or_valuation_fixture_required') {
    return 800;
  }
  if (state.acceptedPromotionEvidenceCount > 0 && state.blockedPendingCache !== true) return 700;
  if (state.acceptedPromotionEvidenceCount > 0 && state.blockedPendingCache === true) return 100;
  return 0;
}

function evidenceRowsFromArtifacts(stagedProviderLiveExecution = {}, backfillQueue = {}) {
  return {
    raw: [
      ...asArray(stagedProviderLiveExecution?.rawEvidence),
      ...asArray(backfillQueue?.rawEvidence),
    ],
    accepted: [
      ...asArray(stagedProviderLiveExecution?.acceptedEvidence),
      ...asArray(backfillQueue?.acceptedEvidence),
    ],
    promotion: [
      ...asArray(stagedProviderLiveExecution?.acceptedPromotionEvidence),
      ...asArray(backfillQueue?.acceptedPromotionEvidence),
    ],
  };
}

export function buildEvidenceGateConsolidation({
  stagedProviderLiveExecution = {},
  backfillQueue = {},
  repairLoop = {},
  finalReport = {},
  valuationExpectationBridge = {},
  historicalAnalogueBridge = {},
  reportCandidateStaging = {},
  existing = null,
} = {}, options = {}) {
  stagedProviderLiveExecution = stagedProviderLiveExecution || {};
  backfillQueue = backfillQueue || {};
  repairLoop = repairLoop || {};
  finalReport = finalReport || {};
  valuationExpectationBridge = valuationExpectationBridge || {};
  historicalAnalogueBridge = historicalAnalogueBridge || {};
  reportCandidateStaging = reportCandidateStaging || {};
  const now = options.now ? new Date(options.now) : new Date();
  const rows = evidenceRowsFromArtifacts(stagedProviderLiveExecution, backfillQueue);
  const states = new Map();
  const ensure = (seedId, trackId) => {
    const key = `${seedId}::${trackId}`;
    if (!states.has(key)) states.set(key, createState(seedId, trackId));
    return states.get(key);
  };

  for (const lane of ['raw', 'accepted', 'promotion']) {
    for (const row of rows[lane]) {
      const state = ensure(normalizeSeedId(row), inferTrackId(row));
      addRowToState(state, row, lane);
    }
  }

  const repairSubject = repairLoopSubject(repairLoop, finalReport);
  const promotionStates = [...states.values()].filter((state) => state.acceptedPromotionEvidenceCount > 0);
  const repairTarget = repairSubject.seedId
    ? ensure(repairSubject.seedId, repairSubject.trackId || 'issuer_bridge_track')
    : (promotionStates.sort((a, b) => b.acceptedPromotionEvidenceCount - a.acceptedPromotionEvidenceCount)[0] || null);
  if (repairTarget) applyRepairLoopState(repairTarget, { repairLoop, finalReport });
  if (valuationExpectationBridge?.seedId) {
    applyValuationExpectationBridgeState(
      ensure(valuationExpectationBridge.seedId, valuationExpectationBridge.trackId || 'issuer_bridge_track'),
      valuationExpectationBridge,
    );
  } else if (repairTarget) {
    applyValuationExpectationBridgeState(repairTarget, valuationExpectationBridge);
  }
  const stagingSnapshot = reportCandidateStaging?.gateSnapshot || {};
  if (Object.keys(stagingSnapshot).length) {
    const stagingTarget = repairSubject.seedId
      ? ensure(repairSubject.seedId, repairSubject.trackId || 'issuer_bridge_track')
      : (promotionStates.sort((a, b) => b.acceptedPromotionEvidenceCount - a.acceptedPromotionEvidenceCount)[0] || null);
    if (stagingTarget) applyGateSnapshotState(stagingTarget, stagingSnapshot);
  }

  const finalized = [...states.values()]
    .map((state) => finalizeState(state, existing))
    .sort((a, b) => (
      (sortPriority(b) - sortPriority(a))
      || (b.acceptedPromotionEvidenceCount - a.acceptedPromotionEvidenceCount)
      || (b.gateClosureProgress - a.gateClosureProgress)
      || (b.acceptedEvidenceCount - a.acceptedEvidenceCount)
    ));
  const candidateStates = finalized.filter((state) => state.acceptedPromotionEvidenceCount > 0);
  const blockedCandidates = candidateStates.filter((state) => state.blockedPendingCache === true);
  const activeCandidateStates = candidateStates.filter((state) => state.blockedPendingCache !== true);
  const primaryState = activeCandidateStates[0] || candidateStates[0] || finalized[0] || null;
  const suggestedBackfillTasks = candidateStates
    .filter((state) => state.blockedPendingCache !== true)
    .map(taskForState)
    .filter(Boolean)
    .filter((task, index, tasks) => tasks.findIndex((item) => item.taskId === task.taskId) === index)
    .slice(0, Number(options.maxSuggestedTasks || 6));
  const nextGateTask = primaryState
    ? (suggestedBackfillTasks.find((task) => task.seedId === primaryState.seedId && task.trackId === primaryState.trackId) || suggestedBackfillTasks[0] || null)
    : null;
  const stagedState = finalized.find((state) => state.reportCandidateAllowedDiagnostic === true) || null;
  const noProgressStates = finalized.filter((state) => state.repeatedWithoutStrongProgress);
  const allCandidateStatesValuationBlocked = candidateStates.length > 0
    && activeCandidateStates.length === 0
    && blockedCandidates.length === candidateStates.length;
  const historicalAnalogueReady = historicalAnalogueBridge?.reflectionStatus === 'comparison_ready'
    || Number(historicalAnalogueBridge?.usableAnalogueCount || 0) >= 2;
  const localFixtureRequirements = candidateStates
    .flatMap(localFixtureRequirementsForState)
    .filter((requirement) => !(requirement.requirementType === 'historical_analogue_bridge' && historicalAnalogueReady))
    .filter((requirement, index, requirements) => requirements.findIndex((item) => item.requirementId === requirement.requirementId) === index);
  const stopReason = stagedState
    ? 'gate_closure_ready_for_operator_review'
    : suggestedBackfillTasks.length
      ? 'missing_seed_centric_report_gates'
      : allCandidateStatesValuationBlocked
      ? 'valuation_context_cache_required'
      : (noProgressStates.length ? stopReasonForNoProgress(noProgressStates) : 'missing_seed_centric_report_gates');
  const whyNoSuggestedBackfillTask = suggestedBackfillTasks.length
    ? null
    : !primaryState
      ? 'no_seed_track_evidence_state_available'
      : primaryState.blockedPendingCache
        ? 'valuation_blocked_pending_cache'
        : primaryState.gateTaskSuppressionReason
          || (primaryState.nextGateAction === 'local_market_or_valuation_fixture_required'
            ? 'local_market_or_valuation_fixture_required'
            : 'no_actionable_gate_task');
  const activeGateRunnerStatus = {
    status: suggestedBackfillTasks.length
      ? 'gate_task_ready'
      : stopReason,
    activeSeedId: primaryState?.seedId || null,
    activeTrackId: primaryState?.trackId || null,
    selectedAction: primaryState?.nextGateAction || null,
    suggestedBackfillTaskCount: suggestedBackfillTasks.length,
    nextGateTaskId: nextGateTask?.taskId || null,
    alternateGateTaskCreated: primaryState?.alternateGateTaskCreated === true,
    repeatedWithoutStrongProgress: primaryState?.repeatedWithoutStrongProgress === true,
    gateTaskSuppressionReason: primaryState?.gateTaskSuppressionReason || null,
    lastGateAttemptFingerprint: primaryState?.lastGateAttemptFingerprint || null,
    whyNoSuggestedBackfillTask,
  };

  return {
    ok: true,
    version: EVIDENCE_GATE_CONSOLIDATOR_VERSION,
    generatedAt: now.toISOString(),
    stateCount: finalized.length,
    activeCandidateSeed: primaryState ? {
      seedId: primaryState.seedId,
      trackId: primaryState.trackId,
      blockType: primaryState.blockType || null,
      nextGateAction: primaryState.nextGateAction || null,
    } : null,
    blockedCandidates,
    valuationBlockedCandidates: blockedCandidates,
    nextEligibleSeed: activeCandidateStates[0] ? {
      seedId: activeCandidateStates[0].seedId,
      trackId: activeCandidateStates[0].trackId,
      nextGateAction: activeCandidateStates[0].nextGateAction,
    } : null,
    rotationReason: blockedCandidates.length && activeCandidateStates.length
      ? 'valuation_blocked_candidate_rotated_out'
      : allCandidateStatesValuationBlocked
        ? 'valuation_context_cache_required'
        : 'primary_candidate_actionable',
    candidateSeed: primaryState ? {
      seedId: primaryState.seedId,
      trackId: primaryState.trackId,
      subjectLabel: primaryState.subjectLabel,
      bottleneckNode: primaryState.bottleneckNode,
    } : null,
    primaryState,
    gateClosureStates: finalized,
    suggestedBackfillTasks,
    suggestedBackfillTaskCount: suggestedBackfillTasks.length,
    nextGateTask,
    whyNoSuggestedBackfillTask,
    activeGateRunnerStatus,
    gateTaskSuppressionReason: primaryState?.gateTaskSuppressionReason || null,
    alternateGateTaskCreated: primaryState?.alternateGateTaskCreated === true,
    lastGateAttemptFingerprint: primaryState?.lastGateAttemptFingerprint || null,
    localFixtureRequirements,
    localFixtureRequirementCount: localFixtureRequirements.length,
    operatorRequiredActions: [
      localFixtureRequirements.some((item) => /market|valuation/.test(item.requirementType)) ? 'provide_local_market_or_valuation_fixture' : null,
      localFixtureRequirements.some((item) => item.requirementType === 'historical_analogue_bridge') ? 'provide_historical_analogue_fixture' : null,
    ].filter(Boolean),
    stagedForOperatorReview: Boolean(stagedState),
    stagedState,
    nextGateAction: primaryState?.nextGateAction || null,
    whyNotReportCandidate: primaryState?.whyNotReportCandidate || 'no seed/track evidence state available',
    stopReason,
    inputSummary: {
      liveAcceptedPromotionEvidenceCount: asArray(stagedProviderLiveExecution?.acceptedPromotionEvidence).length,
      backfillAcceptedPromotionEvidenceCount: asArray(backfillQueue?.acceptedPromotionEvidence).length,
      valuationExpectationBridgeStatus: valuationExpectationBridge?.valuationBridgeStatus || null,
      marketValidationRegimeStatus: valuationExpectationBridge?.marketValidationRegimeStatus
        || valuationExpectationBridge?.marketRegimeSupport?.marketValidationRegimeStatus
        || null,
      historicalAnalogueReflectionStatus: historicalAnalogueBridge?.reflectionStatus || null,
      historicalAnalogueUsableCount: historicalAnalogueBridge?.usableAnalogueCount || 0,
      reportCandidateStagingStatus: reportCandidateStaging?.stagingStatus || null,
    },
    mutationBoundary: zeroBoundary({
      gateConsolidationArtifactWrites: 1,
      generatedBackfillTaskArtifactWrites: suggestedBackfillTasks.length,
    }),
  };
}

export async function writeEvidenceGateConsolidationArtifact(
  payload,
  filePath = DEFAULT_EVIDENCE_GATE_CONSOLIDATION_PATH,
) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  return path.resolve(filePath);
}
