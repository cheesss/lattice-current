import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildValuationExpectationBridgeDryRun,
  validateValuationExpectationBridgeDryRun,
} from '../scripts/_shared/valuation-expectation-bridge-dry-run.mjs';

const issuerEvidence = {
  trackBIssuerEvidenceByIssuer: {
    NOC: [{ evidenceId: 'accepted:noc:bridge' }],
    LHX: [{ evidenceId: 'accepted:lhx:bridge' }],
  },
  trackBAcceptedIssuerEvidenceCount: 2,
  issuerUniverse: ['NOC', 'LHX'],
  evidenceClasses: ['issuer_exposure', 'backlog', 'capacity', 'holdout_validation'],
  bottleneckClass: 'technical_qualification',
  bottleneckNode: 'rocket motor casing composite capacity',
};

const analogues = [
  {
    analogueId: 'solid-motor-capacity',
    bottleneckClass: 'technical_qualification',
    bottleneckNode: 'qualified propulsion component capacity',
    issuerRolePattern: ['propulsion_structure_supplier'],
    evidenceClasses: ['issuer_exposure', 'backlog', 'capacity', 'holdout_validation'],
    catalystTypes: ['program backlog', 'capacity expansion'],
    issuerBasket: ['NOC'],
    peerBasket: ['LHX', 'LMT'],
    marketOutcome: { return90dExcess: 0.14, multipleChange: 0.08 },
    invalidators: [],
    sourceProvenance: 'trusted_local_analogue_library',
  },
  {
    analogueId: 'composite-case-capacity',
    bottleneckClass: 'technical_qualification',
    bottleneckNode: 'composite motor case qualification capacity',
    issuerRolePattern: ['propulsion_structure_supplier'],
    evidenceClasses: ['issuer_exposure', 'backlog', 'capacity', 'holdout_validation'],
    catalystTypes: ['program backlog', 'capacity expansion'],
    issuerBasket: ['LHX'],
    peerBasket: ['NOC', 'LMT'],
    marketOutcome: { return90dExcess: 0.1, multipleChange: 0.06 },
    invalidators: [],
    sourceProvenance: 'trusted_local_analogue_library',
  },
];

function valuationRows(overrides = {}) {
  return ['NOC', 'LHX'].map((issuer) => ({
    issuer,
    roleClass: 'propulsion_structure_supplier',
    sourceProvenance: 'trusted_local_market_cache',
    asOfDate: '2026-05-24',
    acceptedIssuerBridgeEvidenceIds: [`accepted:${issuer.toLowerCase()}:bridge`],
    revenue: 40000000000,
    ebitda: 5000000000,
    marketCap: 70000000000,
    forwardPE: 18,
    evToEbitda: 14,
    evToSales: 2.1,
    peerGroup: ['LMT', 'RTX'],
    peerMedianForwardPE: 19,
    peerMedianEVEBITDA: 15,
    peerRelativeMultiple: -0.03,
    premiumDiscountToPeer: 0.01,
    consensusRevenueGrowth: 0.05,
    consensusEPSGrowth: 0.07,
    consensusRevisionDirection: 'stable',
    localPriceWindow: {
      excessVsBenchmark90d: 0.02,
      excessVsPeerBasket90d: 0.02,
      realizedVol60d: 0.17,
    },
    ...overrides,
  }));
}

test('accepted issuer evidence plus local valuation and analogues can close valuation bridge without readiness promotion', () => {
  const result = buildValuationExpectationBridgeDryRun({
    ...issuerEvidence,
    localValuationRows: valuationRows(),
    historicalAnalogueCases: analogues,
    requireHistoricalAnalogueBridge: true,
    marketValidationStatus: 'controlled_ready',
    marketValidationWindowResults: [
      { eventId: 'e1', benchmarkReturn: 0.01, eventMinusControl: 0.02, controlSampleSize: 40, tStat: 2.1, volatilityRegime: 'normal_vol', rateRegime: 'stable_rate', sectorRegime: 'industrial_neutral', marketRegime: 'neutral' },
      { eventId: 'e2', benchmarkReturn: 0.01, eventMinusControl: 0.03, controlSampleSize: 40, tStat: 2.2, volatilityRegime: 'normal_vol', rateRegime: 'stable_rate', sectorRegime: 'industrial_neutral', marketRegime: 'neutral' },
    ],
    marketValidationBenchmarkUsed: 'SPY',
    marketValidationControlUsed: true,
    marketValidationEventAnchorCount: 2,
  });

  assert.equal(result.valuationBridgeStatus, 'valuation_bridge_closed');
  assert.equal(result.expectationReflectionStatus, 'under_reflected_candidate');
  assert.equal(result.pricedInRiskDiagnostics.every((row) => row.reflectionStatus === 'under_reflected_candidate'), true);
  assert.equal(result.investmentMemoReady, false);
  assert.equal(result.decisionReady, false);
  assert.equal(result.portfolioActionAllowed, false);
  assert.equal(validateValuationExpectationBridgeDryRun(result).ok, true);
});

test('priced-in current move versus analogues makes valuation bridge contradictory', () => {
  const result = buildValuationExpectationBridgeDryRun({
    ...issuerEvidence,
    localValuationRows: valuationRows({
      localPriceWindow: {
        excessVsBenchmark90d: 0.3,
        excessVsPeerBasket90d: 0.3,
      },
      premiumDiscountToPeer: 0.2,
    }),
    historicalAnalogueCases: analogues,
    requireHistoricalAnalogueBridge: true,
    marketValidationStatus: 'controlled_ready',
  });

  assert.equal(result.valuationBridgeStatus, 'valuation_bridge_contradictory');
  assert.equal(result.expectationReflectionStatus, 'priced_in_risk');
  assert.equal(result.investmentMemoReadinessDiagnostic.status, 'blocked_priced_in_or_contradictory_valuation');
  assert.equal(result.investmentMemoReady, false);
});

test('insufficient analogue count keeps comparison caveated instead of fabricating valuation certainty', () => {
  const result = buildValuationExpectationBridgeDryRun({
    ...issuerEvidence,
    localValuationRows: valuationRows(),
    historicalAnalogueCases: [analogues[0]],
    requireHistoricalAnalogueBridge: true,
    marketValidationStatus: 'controlled_ready',
  });

  assert.equal(result.valuationBridgeStatus, 'valuation_bridge_caveated');
  assert.equal(result.expectationReflectionStatus, 'insufficient_comparison_data');
  assert.equal(result.missingValuationFields.includes('usable historical analogue count >= 2'), true);
  assert.equal(result.investmentMemoReady, false);
});

test('trusted local price-only context is caveated instead of valuation missing', () => {
  const result = buildValuationExpectationBridgeDryRun({
    ...issuerEvidence,
    localValuationRows: [{
      issuer: 'NOC',
      sourceProvenance: 'trusted_local_market_quotes_cache',
      asOfDate: '2026-05-24',
      acceptedIssuerBridgeEvidenceIds: ['accepted:noc:bridge'],
      localPriceWindow: {
        return90d: -0.2,
        excessVsBenchmark90d: -0.28,
        realizedVol60d: 0.1,
      },
      expectationContextCaveat: 'derived from local market_quotes only; fundamentals missing; human review required',
    }],
    historicalAnalogueCases: analogues,
    requireHistoricalAnalogueBridge: true,
    marketValidationStatus: 'controlled_ready',
  });

  const noc = result.issuerValuationBridgeTable.find((row) => row.issuer === 'NOC');
  assert.equal(noc.valuationBridgeStatus, 'valuation_bridge_caveated');
  assert.equal(result.valuationBridgeStatus, 'valuation_bridge_caveated');
  assert.equal(result.investmentMemoReady, false);
  assert.equal(result.decisionReady, false);
  assert.equal(result.portfolioActionAllowed, false);
});
