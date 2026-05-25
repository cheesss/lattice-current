import crypto from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import {
  loadLocalValuationFundamentalsCache,
} from './external-data/local-valuation-fundamentals-cache.mjs';

export const VALUATION_CONTEXT_AUTO_LINKER_VERSION = 'valuation-context-auto-linker-v1';
export const VALUATION_CONTEXT_ROTATION_VERSION = 'valuation-context-rotation-v1';
export const DEFAULT_VALUATION_CONTEXT_AUTO_LINKER_PATH = path.join(
  process.cwd(),
  'data',
  'runtime',
  'valuation-context-auto-linker.latest.json',
);
export const DEFAULT_VALUATION_CONTEXT_ROTATION_PATH = path.join(
  process.cwd(),
  'data',
  'runtime',
  'valuation-context-rotation.latest.json',
);

const REQUIRED_CONTEXT_FIELDS = [
  'acceptedIssuerBridgeEvidenceIds',
  'localPriceWindow.excessVsBenchmark90d or excessVsPeerBasket90d',
  'peerContext.peerGroup',
  'peerContext.peerRelativeMultiple or peer valuation median',
  'fundamentalsContext.revenueGrowth/backlog/guidance/consensusRevisionDirection',
  'sourceProvenance=trusted_local_*',
];

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

function zeroBoundary(extra = {}) {
  return {
    providerActivationWrites: 0,
    sourceRegistryWrites: 0,
    canonicalWrites: 0,
    readinessPromotionWrites: 0,
    reportCandidateWrites: 0,
    portfolioActionWrites: 0,
    approvalQueueWrites: 0,
    ...extra,
  };
}

function numberOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function primaryGateState(evidenceGateConsolidation = {}) {
  return evidenceGateConsolidation?.primaryState
    || evidenceGateConsolidation?.stagedState
    || asArray(evidenceGateConsolidation?.gateClosureStates)[0]
    || {};
}

function gateClosureStates(evidenceGateConsolidation = {}) {
  const states = asArray(evidenceGateConsolidation?.gateClosureStates)
    .filter((state) => state && typeof state === 'object');
  if (states.length) return states;
  const primary = primaryGateState(evidenceGateConsolidation);
  return Object.keys(primary || {}).length ? [primary] : [];
}

function acceptedIssuerBridgeClosed(state = {}) {
  return compact(state.issuerBridgeStatus) === 'closed'
    && Number(state.acceptedPromotionEvidenceCount || 0) > 0;
}

function seedContextKey(state = {}) {
  return `${compact(state.seedId || 'unknown-seed')}::${compact(state.trackId || 'issuer_bridge_track')}`;
}

function acceptedBridgeIdsForIssuer(state = {}, row = {}, issuer = '') {
  const explicit = uniqueStrings([
    row.acceptedIssuerBridgeEvidenceIds,
    row.acceptedEvidenceIds,
    state.acceptedPromotionEvidenceIds,
    state.acceptedEvidenceIds,
  ], 50);
  if (explicit.length) return explicit;
  if (!acceptedIssuerBridgeClosed(state)) return [];
  return [`gate:${state.seedId || 'unknown-seed'}:${state.trackId || 'issuer_bridge_track'}:issuer_bridge_closed:${String(issuer || '').toUpperCase()}`];
}

function analoguePeerBasket(historicalAnalogueBridge = {}) {
  return uniqueStrings([
    asArray(historicalAnalogueBridge.topScores).flatMap((score) => score.peerBasket || []),
    asArray(historicalAnalogueBridge.scores)
      .filter((score) => asArray(historicalAnalogueBridge.bestAnalogueIds).includes(score.analogueId))
      .flatMap((score) => score.peerBasket || []),
  ], 20).map((issuer) => issuer.toUpperCase());
}

function peerGroupForRow(row = {}, { historicalAnalogueBridge = {}, sectorPeerDefaults = [] } = {}) {
  const localPeers = uniqueStrings([
    row.peerContext?.peerGroup,
    row.peerGroup,
  ], 20).map((issuer) => issuer.toUpperCase());
  if (localPeers.length) return { peerGroup: localPeers, peerBasketSource: 'trusted_local_valuation_cache' };
  const analoguePeers = analoguePeerBasket(historicalAnalogueBridge);
  if (analoguePeers.length) return { peerGroup: analoguePeers, peerBasketSource: 'historical_analogue_peer_basket' };
  const sectorPeers = uniqueStrings(sectorPeerDefaults, 20).map((issuer) => issuer.toUpperCase());
  if (sectorPeers.length) return { peerGroup: sectorPeers, peerBasketSource: 'sector_pack_peer_defaults' };
  return { peerGroup: [], peerBasketSource: 'peer_context_missing' };
}

function currentExcessMove90d(row = {}) {
  return numberOrNull(
    row.localPriceWindow?.excessVsPeerBasket90d
    ?? row.localPriceWindow?.excessVsBenchmark90d
    ?? row.excessVsPeerBasket90d
    ?? row.excessVsBenchmark90d,
  );
}

function reflectionStatusForRow(row = {}, historicalAnalogueBridge = {}) {
  const currentMove = currentExcessMove90d(row);
  const analogueMedian = numberOrNull(historicalAnalogueBridge?.analogueMedianExcessMove90d);
  const hasConsensus = Boolean(
    compact(row.fundamentalsContext?.consensusRevisionDirection)
    || compact(row.consensusRevisionDirection)
    || numberOrNull(row.consensusRevenueGrowth) !== null
    || numberOrNull(row.consensusEPSGrowth) !== null,
  );
  if (row.pricedInRisk || row.contradictory || row.alreadyPricedInRisk) return 'priced_in_risk';
  if (currentMove === null || analogueMedian === null || Number(historicalAnalogueBridge?.usableAnalogueCount || 0) < 2) {
    return 'insufficient_comparison_data';
  }
  if (currentMove >= analogueMedian) return 'priced_in_risk';
  if (currentMove <= analogueMedian - 0.05 && hasConsensus) return 'under_reflected_candidate';
  return 'partially_reflected';
}

function missingContextFields(row = {}, peerGroup = []) {
  return uniqueStrings([
    asArray(row.acceptedIssuerBridgeEvidenceIds).length ? null : 'acceptedIssuerBridgeEvidenceIds',
    currentExcessMove90d(row) === null ? 'localPriceWindow.excessVsBenchmark90d_or_excessVsPeerBasket90d' : null,
    peerGroup.length ? null : 'peerContext.peerGroup',
    compact(row.peerRelativeMultiple || row.peerContext?.peerRelativeMultiple)
      || numberOrNull(row.premiumDiscountToPeer) !== null
      ? null
      : 'peer_relative_multiple_or_premium_discount',
    compact(row.fundamentalsContext?.consensusRevisionDirection || row.consensusRevisionDirection)
      || numberOrNull(row.revenueGrowth) !== null
      || numberOrNull(row.backlog) !== null
      ? null
      : 'fundamentals_or_consensus_context',
  ], 20);
}

function fixtureRequirementForIssuer({ state = {}, issuer = '', reason = 'missing_trusted_local_valuation_context' } = {}) {
  const acceptedIssuerBridgeEvidenceIds = acceptedBridgeIdsForIssuer(state, {}, issuer);
  return {
    requirementId: `valuation-context-${stableHash(`${state.seedId}:${state.trackId}:${issuer}:${reason}`)}`,
    requirementType: 'local_valuation_expectation_context',
    seedId: state.seedId || null,
    trackId: state.trackId || 'issuer_bridge_track',
    subjectLabel: state.subjectLabel || null,
    bottleneckNode: state.bottleneckNode || null,
    issuer,
    acceptedIssuerBridgeEvidenceIds,
    status: 'local_market_or_valuation_fixture_required',
    reason,
    requiredFields: REQUIRED_CONTEXT_FIELDS,
    allowedSources: ['trusted_local_fundamentals_cache', 'trusted_local_market_cache', 'trusted_local_valuation_cache'],
    forbiddenSources: ['rss', 'source_query', 'google_news', 'news_snippet', 'llm_opinion'],
    mutationBoundary: zeroBoundary(),
  };
}

function buildContextRowsForState({
  state = {},
  cache = {},
  historicalAnalogueBridge = {},
  sectorPeerDefaults = [],
} = {}) {
  const issuerUniverse = uniqueStrings(state.issuerUniverse || [], 20)
    .map((issuer) => issuer.toUpperCase());
  const gateEligible = acceptedIssuerBridgeClosed(state);
  const trustedRowsByIssuer = new Map(asArray(cache.rows).map((row) => [String(row.issuer || row.ticker || '').toUpperCase(), row]));
  const contextRows = [];
  const rejectedIssuers = [];
  const missingIssuerFundamentals = [];
  const fixtureRequirements = [];
  const terminalBlockers = [];

  for (const issuer of issuerUniverse) {
    if (!gateEligible) {
      rejectedIssuers.push({ issuer, reason: 'accepted_issuer_bridge_not_closed' });
      continue;
    }
    const row = trustedRowsByIssuer.get(issuer);
    if (!row) {
      missingIssuerFundamentals.push(issuer);
      terminalBlockers.push('issuer_fundamentals_missing');
      fixtureRequirements.push(fixtureRequirementForIssuer({ state, issuer }));
      continue;
    }
    const acceptedIssuerBridgeEvidenceIds = acceptedBridgeIdsForIssuer(state, row, issuer);
    if (!acceptedIssuerBridgeEvidenceIds.length) {
      rejectedIssuers.push({ issuer, reason: 'accepted_issuer_bridge_evidence_id_missing' });
      terminalBlockers.push('valuation_context_missing');
      fixtureRequirements.push(fixtureRequirementForIssuer({ state, issuer, reason: 'accepted_issuer_bridge_evidence_id_missing' }));
      continue;
    }
    const { peerGroup, peerBasketSource } = peerGroupForRow(row, { historicalAnalogueBridge, sectorPeerDefaults });
    if (!peerGroup.length) terminalBlockers.push('peer_context_missing');
    const baseWithBridgeIds = {
      ...row,
      acceptedIssuerBridgeEvidenceIds,
    };
    const enriched = {
      ...baseWithBridgeIds,
      issuer,
      seedId: state.seedId || null,
      trackId: state.trackId || null,
      localPriceWindow: row.localPriceWindow || {},
      peerGroup,
      peerContext: {
        ...(row.peerContext || {}),
        peerGroup,
        peerRelativeMultiple: row.peerContext?.peerRelativeMultiple || row.peerRelativeMultiple || '',
      },
      fundamentalsContext: row.fundamentalsContext || {
        revenueGrowth: row.revenueGrowth ?? null,
        backlog: row.backlog ?? null,
        segmentRevenue: row.segmentRevenue ?? null,
        guidanceRevenue: row.guidanceRevenue ?? null,
        operatingMargin: row.operatingMargin ?? null,
        consensusRevisionDirection: row.consensusRevisionDirection || '',
      },
      peerBasketSource,
      reflectionStatus: reflectionStatusForRow(row, historicalAnalogueBridge),
      missingContextFields: missingContextFields(baseWithBridgeIds, peerGroup),
    };
    contextRows.push(enriched);
    if (enriched.missingContextFields.length) {
      if (enriched.missingContextFields.includes('peerContext.peerGroup')) terminalBlockers.push('peer_context_missing');
      else terminalBlockers.push('valuation_context_missing');
      fixtureRequirements.push(fixtureRequirementForIssuer({
        state,
        issuer,
        reason: `partial_context_missing:${enriched.missingContextFields.join(',')}`,
      }));
    }
  }

  const blockedPendingCache = Boolean(gateEligible && contextRows.length === 0 && missingIssuerFundamentals.length > 0);
  return {
    seedId: state.seedId || null,
    trackId: state.trackId || 'issuer_bridge_track',
    subjectLabel: state.subjectLabel || null,
    bottleneckNode: state.bottleneckNode || null,
    marketValidationStatus: state.marketValidationStatus || 'missing',
    valuationBridgeStatus: state.valuationBridgeStatus || 'missing',
    nextGateAction: state.nextGateAction || null,
    gateEligible,
    issuerUniverse,
    issuerCoverage: {
      issuerCount: issuerUniverse.length,
      contextRowCount: contextRows.length,
      missingIssuerFundamentals,
      rejectedIssuers,
      peerBasketSources: uniqueStrings(contextRows.map((row) => row.peerBasketSource), 10),
    },
    contextRows,
    missingIssuerFundamentals,
    rejectedIssuers,
    fixtureRequirements,
    blockedPendingCache,
    blockType: blockedPendingCache ? 'valuation_blocked_pending_cache' : null,
    terminalBlockers: uniqueStrings([
      terminalBlockers,
      blockedPendingCache ? 'valuation_context_missing' : null,
    ], 20),
    nextRequiredFixture: fixtureRequirements[0] || null,
  };
}

function buildValuationCoverageBiasDiagnostic(seedContexts = [], rotation = {}) {
  const eligibleContexts = asArray(seedContexts).filter((context) => context.gateEligible === true);
  const contextReadyContexts = eligibleContexts.filter((context) => asArray(context.contextRows).length > 0);
  const blockedContexts = eligibleContexts.filter((context) => context.blockedPendingCache === true);
  const coveredIssuers = uniqueStrings(contextReadyContexts.flatMap((context) => (
    asArray(context.contextRows).map((row) => row.issuer)
  )), 100);
  const missingIssuers = uniqueStrings(blockedContexts.flatMap((context) => context.missingIssuerFundamentals || []), 100);
  const denominator = coveredIssuers.length + missingIssuers.length;
  const issuerContextCoverageRate = denominator ? coveredIssuers.length / denominator : null;
  const sourceProvenance = uniqueStrings(contextReadyContexts.flatMap((context) => (
    asArray(context.contextRows).map((row) => row.sourceProvenance)
  )), 50);
  const peerBasketSources = uniqueStrings(contextReadyContexts.flatMap((context) => (
    asArray(context.contextRows).map((row) => row.peerBasketSource)
  )), 20);
  const warnings = uniqueStrings([
    contextReadyContexts.length > 0 && blockedContexts.length > 0
      ? 'valuation_context_availability_can_drive_seed_rotation'
      : null,
    rotation?.nextEligibleSeed?.reason === 'valuation_context_available' && blockedContexts.length > 0
      ? 'next_eligible_seed_selected_from_cache_available_subset'
      : null,
    issuerContextCoverageRate !== null && issuerContextCoverageRate < 0.5
      ? 'valuation_context_low_issuer_coverage'
      : null,
    contextReadyContexts.length > 0 && sourceProvenance.length <= 1
      ? 'valuation_context_single_source_provenance'
      : null,
    peerBasketSources.includes('historical_analogue_peer_basket')
      ? 'peer_context_uses_historical_analogue_fallback'
      : null,
  ], 20);
  const riskLevel = warnings.includes('next_eligible_seed_selected_from_cache_available_subset')
    || warnings.includes('valuation_context_low_issuer_coverage')
    ? 'high'
    : warnings.length
      ? 'medium'
      : eligibleContexts.length
        ? 'low'
        : 'not_applicable';
  return {
    coverageBiasRisk: riskLevel,
    eligibleSeedCount: eligibleContexts.length,
    contextReadySeedCount: contextReadyContexts.length,
    valuationBlockedSeedCount: blockedContexts.length,
    coveredIssuerCount: coveredIssuers.length,
    missingIssuerCount: missingIssuers.length,
    issuerContextCoverageRate,
    coveredIssuers,
    missingIssuers,
    sourceProvenance,
    peerBasketSources,
    warnings,
    recommendedAction: blockedContexts.length
      ? 'expand_trusted_local_valuation_context_coverage'
      : 'monitor_valuation_context_coverage',
    guardrails: {
      cachePresenceIsNotIdeaQuality: true,
      rawOrSourceQueryValuationRejected: true,
      readinessPromotionAllowed: false,
      reportCandidateWriteAllowed: false,
      keepBlockedSeedsInRotationBacklog: true,
    },
  };
}

export function buildSeedValuationContextStates({
  evidenceGateConsolidation = {},
  historicalAnalogueBridge = {},
  localValuationCache = null,
  localValuationRows = null,
  sectorPeerDefaults = [],
} = {}) {
  const states = gateClosureStates(evidenceGateConsolidation);
  const issuerUniverse = uniqueStrings(states.flatMap((state) => state.issuerUniverse || []), 100)
    .map((issuer) => issuer.toUpperCase());
  const cache = localValuationCache?.rows
    ? localValuationCache
    : loadLocalValuationFundamentalsCache({
      rows: localValuationRows || [],
      issuerUniverse,
    });
  const seen = new Set();
  const seedContexts = [];
  for (const state of states) {
    const key = seedContextKey(state);
    if (seen.has(key)) continue;
    seen.add(key);
    seedContexts.push(buildContextRowsForState({
      state,
      cache,
      historicalAnalogueBridge,
      sectorPeerDefaults,
    }));
  }
  return { seedContexts, cache };
}

function chooseBackwardCompatibleContext(seedContexts = [], evidenceGateConsolidation = {}) {
  const primary = primaryGateState(evidenceGateConsolidation);
  const primaryKey = seedContextKey(primary);
  return seedContexts.find((context) => seedContextKey(context) === primaryKey)
    || seedContexts.find((context) => context.contextRows.length > 0)
    || seedContexts.find((context) => context.gateEligible)
    || seedContexts[0]
    || {
      seedId: primary.seedId || null,
      trackId: primary.trackId || null,
      subjectLabel: primary.subjectLabel || null,
      bottleneckNode: primary.bottleneckNode || null,
      gateEligible: false,
      issuerUniverse: [],
      issuerCoverage: {
        issuerCount: 0,
        contextRowCount: 0,
        missingIssuerFundamentals: [],
        rejectedIssuers: [],
        peerBasketSources: [],
      },
      contextRows: [],
      missingIssuerFundamentals: [],
      rejectedIssuers: [],
      fixtureRequirements: [],
      blockedPendingCache: false,
      blockType: null,
      terminalBlockers: [],
      nextRequiredFixture: null,
    };
}

export function buildValuationContextRotation({
  seedContexts = [],
  evidenceGateConsolidation = {},
  generatedAt = new Date().toISOString(),
} = {}) {
  const valuationBlockedCandidates = seedContexts
    .filter((context) => context.blockedPendingCache)
    .map((context) => ({
      seedId: context.seedId,
      trackId: context.trackId,
      blockType: context.blockType,
      missingIssuerFundamentals: context.missingIssuerFundamentals,
      fixtureRequirementCount: context.fixtureRequirements.length,
    }));
  const contextReady = seedContexts.find((context) => context.contextRows.length > 0);
  const actionable = asArray(evidenceGateConsolidation?.gateClosureStates)
    .find((state) => (
      Number(state.acceptedPromotionEvidenceCount || 0) > 0
      && state.blockedPendingCache !== true
      && state.nextGateAction
      && state.nextGateAction !== 'local_market_or_valuation_fixture_required'
    ));
  const nextEligibleSeed = contextReady
    ? { seedId: contextReady.seedId, trackId: contextReady.trackId, reason: 'valuation_context_available' }
    : actionable
      ? { seedId: actionable.seedId, trackId: actionable.trackId, reason: actionable.nextGateAction }
      : null;
  const allEligibleValuationBlocked = seedContexts.length > 0
    && seedContexts.every((context) => !context.gateEligible || context.blockedPendingCache);
  const rotationReason = nextEligibleSeed
    ? 'rotated_to_next_eligible_seed'
    : allEligibleValuationBlocked
      ? 'valuation_context_cache_required'
      : 'no_accepted_issuer_bridge_seed_for_valuation';
  const rotation = {
    ok: true,
    version: VALUATION_CONTEXT_ROTATION_VERSION,
    generatedAt,
    activeCandidateSeed: evidenceGateConsolidation?.candidateSeed || null,
    valuationBlockedCandidates,
    missingIssuerFundamentalsBySeed: Object.fromEntries(seedContexts.map((context) => [
      `${context.seedId || 'unknown-seed'}::${context.trackId || 'issuer_bridge_track'}`,
      context.missingIssuerFundamentals,
    ]).filter(([, missing]) => missing.length)),
    nextEligibleSeed,
    rotationReason,
    valuationContextRequirements: seedContexts.flatMap((context) => context.fixtureRequirements),
    stopReason: nextEligibleSeed ? null : (allEligibleValuationBlocked ? 'valuation_context_cache_required' : 'no_safe_next_action'),
    mutationBoundary: zeroBoundary({
      valuationContextRotationArtifactWrites: 1,
    }),
  };
  return {
    ...rotation,
    valuationCoverageBias: buildValuationCoverageBiasDiagnostic(seedContexts, rotation),
  };
}

export function buildValuationContextAutoLinker({
  evidenceGateConsolidation = {},
  historicalAnalogueBridge = {},
  localValuationCache = null,
  localValuationRows = null,
  sectorPeerDefaults = [],
  generatedAt = new Date().toISOString(),
} = {}) {
  const { seedContexts, cache } = buildSeedValuationContextStates({
    evidenceGateConsolidation,
    historicalAnalogueBridge,
    localValuationCache,
    localValuationRows,
    sectorPeerDefaults,
  });
  const selectedContext = chooseBackwardCompatibleContext(seedContexts, evidenceGateConsolidation);
  const contextRows = selectedContext.contextRows || [];
  const missingIssuerFundamentals = selectedContext.missingIssuerFundamentals || [];
  const rejectedIssuers = selectedContext.rejectedIssuers || [];
  const fixtureRequirements = seedContexts.flatMap((context) => context.fixtureRequirements || []);
  const issuerContextRows = seedContexts.flatMap((context) => context.contextRows || []);
  const blockedSeedIds = seedContexts
    .filter((context) => context.blockedPendingCache)
    .map((context) => context.seedId)
    .filter(Boolean);
  const rotation = buildValuationContextRotation({
    seedContexts,
    evidenceGateConsolidation,
    generatedAt,
  });
  const valuationCoverageBias = buildValuationCoverageBiasDiagnostic(seedContexts, rotation);

  const pricedInRisk = contextRows.some((row) => row.reflectionStatus === 'priced_in_risk');
  const underReflected = contextRows.some((row) => row.reflectionStatus === 'under_reflected_candidate');
  const partial = contextRows.some((row) => row.reflectionStatus === 'partially_reflected');
  const reflectionStatus = pricedInRisk
    ? 'priced_in_risk'
    : underReflected
      ? 'under_reflected_candidate'
      : partial
        ? 'partially_reflected'
        : 'insufficient_comparison_data';

  return {
    ok: true,
    version: VALUATION_CONTEXT_AUTO_LINKER_VERSION,
    generatedAt,
    candidateSeed: evidenceGateConsolidation?.candidateSeed || {
      seedId: selectedContext.seedId || null,
      trackId: selectedContext.trackId || null,
      subjectLabel: selectedContext.subjectLabel || null,
      bottleneckNode: selectedContext.bottleneckNode || null,
    },
    gateEligible: selectedContext.gateEligible === true,
    issuerUniverse: selectedContext.issuerUniverse || [],
    issuerCoverage: {
      issuerCount: (selectedContext.issuerUniverse || []).length,
      contextRowCount: contextRows.length,
      missingIssuerFundamentals,
      rejectedIssuers,
      peerBasketSources: uniqueStrings(contextRows.map((row) => row.peerBasketSource), 10),
    },
    contextRows,
    seedContexts,
    issuerContextRows,
    missingIssuerFundamentals,
    missingIssuerFundamentalsBySeed: rotation.missingIssuerFundamentalsBySeed,
    blockedSeedIds,
    nextEligibleSeed: rotation.nextEligibleSeed,
    rotationReason: rotation.rotationReason,
    valuationBlockedCandidates: rotation.valuationBlockedCandidates,
    valuationCoverageBias,
    rejectedIssuers,
    fixtureRequirements,
    valuationContextRequirements: rotation.valuationContextRequirements,
    fixtureRequirementCount: fixtureRequirements.length,
    blockedPendingCache: selectedContext.blockedPendingCache === true,
    blockType: selectedContext.blockType || null,
    terminalBlockers: selectedContext.terminalBlockers || [],
    historicalAnalogueStatus: {
      reflectionStatus: historicalAnalogueBridge?.reflectionStatus || null,
      usableAnalogueCount: historicalAnalogueBridge?.usableAnalogueCount || 0,
      analogueMedianExcessMove90d: historicalAnalogueBridge?.analogueMedianExcessMove90d ?? null,
      bestAnalogueIds: historicalAnalogueBridge?.bestAnalogueIds || [],
    },
    reflectionStatus,
    pricedInRisk,
    nextRequiredFixture: selectedContext.nextRequiredFixture || fixtureRequirements[0] || null,
    localValuationCache: {
      rowCount: cache.rowCount || 0,
      missingIssuers: cache.missingIssuers || missingIssuerFundamentals,
      rejectedRowCount: asArray(cache.rejectedRows).length,
      sourceProvenance: cache.sourceProvenance || [],
      asOfDates: cache.asOfDates || [],
    },
    mutationBoundary: zeroBoundary({
      valuationContextArtifactWrites: 1,
    }),
  };
}

export async function writeValuationContextAutoLinkerArtifact(
  payload,
  filePath = DEFAULT_VALUATION_CONTEXT_AUTO_LINKER_PATH,
) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  return path.resolve(filePath);
}

export async function writeValuationContextRotationArtifact(
  payload,
  filePath = DEFAULT_VALUATION_CONTEXT_ROTATION_PATH,
) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  return path.resolve(filePath);
}
