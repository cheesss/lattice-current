import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildValuationContextAutoLinker,
} from '../scripts/_shared/valuation-context-auto-linker.mjs';

function gateState(overrides = {}) {
  return {
    candidateSeed: {
      seedId: 'msd-child-defense',
      trackId: 'issuer_bridge_track',
      bottleneckNode: 'rocket motor casing composite capacity',
    },
    primaryState: {
      seedId: 'msd-child-defense',
      trackId: 'issuer_bridge_track',
      subjectLabel: 'rocket motor casing composite capacity',
      bottleneckNode: 'rocket motor casing composite capacity',
      issuerUniverse: ['LHX', 'NOC'],
      acceptedPromotionEvidenceCount: 2,
      acceptedPromotionEvidenceIds: ['accepted:lhx:bridge', 'accepted:noc:bridge'],
      issuerBridgeStatus: 'closed',
      ...overrides,
    },
  };
}

function multiGateState(states = []) {
  return {
    candidateSeed: {
      seedId: states[0]?.seedId || 'seed-a',
      trackId: states[0]?.trackId || 'issuer_bridge_track',
      bottleneckNode: states[0]?.bottleneckNode || 'selected bottleneck',
    },
    primaryState: states[0] || {},
    gateClosureStates: states,
  };
}

function trustedRow(issuer, overrides = {}) {
  return {
    issuer,
    ticker: issuer,
    roleClass: 'propulsion_structure_supplier',
    sourceProvenance: 'trusted_local_market_cache',
    asOfDate: '2026-05-24',
    revenueGrowth: 0.05,
    backlog: 100,
    forwardPE: 18,
    evToEbitda: 14,
    peerGroup: ['LMT', 'RTX'],
    peerMedianForwardPE: 19,
    peerMedianEVEBITDA: 15,
    peerRelativeMultiple: '-0.04',
    consensusRevenueGrowth: 0.05,
    consensusEPSGrowth: 0.07,
    consensusRevisionDirection: 'stable',
    localPriceWindow: {
      excessVsBenchmark90d: 0.02,
      excessVsPeerBasket90d: 0.02,
    },
    ...overrides,
  };
}

const comparisonReadyAnalogue = {
  reflectionStatus: 'comparison_ready',
  usableAnalogueCount: 2,
  analogueMedianExcessMove90d: 0.16,
  bestAnalogueIds: ['solid_rocket_motor_capacity_2022', 'defense_composite_motor_case_capacity_2023'],
  topScores: [
    { analogueId: 'solid_rocket_motor_capacity_2022', peerBasket: ['LHX', 'LMT'], marketOutcome: { return90dExcess: 0.14 } },
    { analogueId: 'defense_composite_motor_case_capacity_2023', peerBasket: ['NOC', 'RTX'], marketOutcome: { return90dExcess: 0.18 } },
  ],
};

test('auto-linker creates issuer price expectation context only for closed accepted issuer bridge', () => {
  const result = buildValuationContextAutoLinker({
    evidenceGateConsolidation: gateState(),
    historicalAnalogueBridge: comparisonReadyAnalogue,
    localValuationRows: [
      trustedRow('LHX'),
      trustedRow('NOC'),
      { ...trustedRow('RTX'), sourceProvenance: 'google_news_snippet' },
    ],
  });

  assert.equal(result.gateEligible, true);
  assert.equal(result.contextRows.length, 2);
  assert.deepEqual(result.contextRows.map((row) => row.issuer).sort(), ['LHX', 'NOC']);
  assert.equal(result.contextRows.every((row) => row.acceptedIssuerBridgeEvidenceIds.length >= 1), true);
  assert.equal(result.contextRows.every((row) => row.peerBasketSource === 'trusted_local_valuation_cache'), true);
  assert.equal(result.reflectionStatus, 'under_reflected_candidate');
  assert.equal(result.missingIssuerFundamentals.length, 0);
  assert.equal(result.mutationBoundary.readinessPromotionWrites, 0);
  assert.equal(result.mutationBoundary.reportCandidateWrites, 0);
});

test('auto-linker excludes issuers when accepted issuer bridge is not closed', () => {
  const result = buildValuationContextAutoLinker({
    evidenceGateConsolidation: gateState({
      issuerBridgeStatus: 'missing',
      acceptedPromotionEvidenceCount: 0,
    }),
    historicalAnalogueBridge: comparisonReadyAnalogue,
    localValuationRows: [trustedRow('LHX'), trustedRow('NOC')],
  });

  assert.equal(result.gateEligible, false);
  assert.equal(result.contextRows.length, 0);
  assert.equal(result.rejectedIssuers.length, 2);
  assert.equal(result.rejectedIssuers.every((row) => row.reason === 'accepted_issuer_bridge_not_closed'), true);
});

test('auto-linker creates fixture requirements when trusted local cache rows are missing', () => {
  const result = buildValuationContextAutoLinker({
    evidenceGateConsolidation: gateState(),
    historicalAnalogueBridge: comparisonReadyAnalogue,
    localValuationRows: [trustedRow('LHX')],
  });

  assert.equal(result.contextRows.length, 1);
  assert.deepEqual(result.missingIssuerFundamentals, ['NOC']);
  assert.equal(result.fixtureRequirements.some((row) => row.issuer === 'NOC'), true);
  assert.equal(result.nextRequiredFixture.issuer, 'NOC');
  assert.equal(result.nextRequiredFixture.status, 'local_market_or_valuation_fixture_required');
});

test('auto-linker falls back to historical analogue peer basket when local peer group is absent', () => {
  const result = buildValuationContextAutoLinker({
    evidenceGateConsolidation: gateState({ issuerUniverse: ['LHX'] }),
    historicalAnalogueBridge: comparisonReadyAnalogue,
    localValuationRows: [
      trustedRow('LHX', {
        peerGroup: [],
        peerContext: { peerGroup: [] },
      }),
    ],
  });

  assert.equal(result.contextRows.length, 1);
  assert.equal(result.contextRows[0].peerBasketSource, 'historical_analogue_peer_basket');
  assert.equal(result.contextRows[0].peerGroup.includes('RTX'), true);
});

test('auto-linker marks priced-in risk when current move exceeds analogue median', () => {
  const result = buildValuationContextAutoLinker({
    evidenceGateConsolidation: gateState({ issuerUniverse: ['LHX'] }),
    historicalAnalogueBridge: comparisonReadyAnalogue,
    localValuationRows: [
      trustedRow('LHX', {
        localPriceWindow: {
          excessVsBenchmark90d: 0.25,
          excessVsPeerBasket90d: 0.25,
        },
      }),
    ],
  });

  assert.equal(result.reflectionStatus, 'priced_in_risk');
  assert.equal(result.pricedInRisk, true);
});

test('auto-linker processes multiple seed tracks and rotates past valuation-blocked candidates', () => {
  const result = buildValuationContextAutoLinker({
    evidenceGateConsolidation: multiGateState([
      {
        seedId: 'seed-missing-cache',
        trackId: 'issuer_bridge_track',
        subjectLabel: 'rocket motor casing composite capacity',
        bottleneckNode: 'rocket motor casing composite capacity',
        issuerUniverse: ['LHX', 'NOC'],
        acceptedPromotionEvidenceCount: 2,
        acceptedPromotionEvidenceIds: ['accepted:lhx', 'accepted:noc'],
        issuerBridgeStatus: 'closed',
      },
      {
        seedId: 'seed-with-cache',
        trackId: 'issuer_bridge_track',
        subjectLabel: 'power delivery project backlog',
        bottleneckNode: 'power delivery project backlog',
        issuerUniverse: ['PWR'],
        acceptedPromotionEvidenceCount: 1,
        acceptedPromotionEvidenceIds: ['accepted:pwr'],
        issuerBridgeStatus: 'closed',
      },
    ]),
    historicalAnalogueBridge: comparisonReadyAnalogue,
    localValuationRows: [
      trustedRow('PWR', {
        peerGroup: ['ACM', 'J'],
        localPriceWindow: { excessVsBenchmark90d: 0.01, excessVsPeerBasket90d: 0.01 },
      }),
    ],
  });

  assert.equal(result.seedContexts.length, 2);
  assert.deepEqual(result.blockedSeedIds, ['seed-missing-cache']);
  assert.equal(result.valuationBlockedCandidates[0].seedId, 'seed-missing-cache');
  assert.equal(result.nextEligibleSeed.seedId, 'seed-with-cache');
  assert.equal(result.issuerContextRows.length, 1);
  assert.equal(result.issuerContextRows[0].issuer, 'PWR');
  assert.equal(result.missingIssuerFundamentalsBySeed['seed-missing-cache::issuer_bridge_track'].length, 2);
  assert.equal(result.valuationCoverageBias.coverageBiasRisk, 'high');
  assert.equal(result.valuationCoverageBias.warnings.includes('next_eligible_seed_selected_from_cache_available_subset'), true);
  assert.equal(result.valuationCoverageBias.guardrails.cachePresenceIsNotIdeaQuality, true);
});

test('auto-linker rejects source-query and news provenance for valuation context rows', () => {
  const result = buildValuationContextAutoLinker({
    evidenceGateConsolidation: gateState({ issuerUniverse: ['LHX'] }),
    historicalAnalogueBridge: comparisonReadyAnalogue,
    localValuationRows: [
      trustedRow('LHX', {
        sourceProvenance: 'source_query_market_snippet',
      }),
    ],
  });

  assert.equal(result.contextRows.length, 0);
  assert.deepEqual(result.missingIssuerFundamentals, ['LHX']);
  assert.equal(result.blockedPendingCache, true);
  assert.equal(result.blockType, 'valuation_blocked_pending_cache');
  assert.equal(result.nextRequiredFixture.issuer, 'LHX');
});
