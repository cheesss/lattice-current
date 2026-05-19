import assert from 'node:assert/strict';
import test from 'node:test';

import {
  providerListForRoutes,
  routeEvidenceProvider,
} from '../scripts/_shared/evidence-provider-router.mjs';

test('supplier_capacity routes to official company sources with government fallback for defense/space', () => {
  const route = routeEvidenceProvider({
    evidenceClass: 'supplier_capacity',
    subject: 'solid rocket motor capacity',
    themes: ['defense-industrial', 'space'],
    ontologyKeys: ['defense_industrial', 'space'],
    issuerUniverse: ['LHX', 'NOC', 'ITA', 'UUP'],
  });

  assert.equal(route.evidenceClass, 'supplier_capacity');
  assert.equal(route.sourceProviders.includes('official-company'), true);
  assert.equal(route.sourceProviders.includes('war.gov-contracts'), true);
  assert.equal(route.executableCollectors.includes('dod-contracts'), true);
  assert.equal(route.executableCollectors.includes('usaspending'), true);
  assert.equal(route.requiredFacts.includes('production_capacity'), true);
  assert.equal(route.collectorCapabilities.some((item) => item.collector === 'sec' && item.supported), true);
  assert.deepEqual(route.issuerUniverse, ['LHX', 'NOC']);
});

test('procurement_trigger routes to government and USAspending providers', () => {
  const route = routeEvidenceProvider({
    evidenceClass: 'procurement_trigger',
    subject: 'missile interceptor production',
    themes: ['defense-industrial'],
  });

  assert.deepEqual(route.executableCollectors, ['dod-contracts', 'usaspending', 'source-query']);
  assert.equal(route.sourceProviders.includes('defense.gov'), true);
  assert.equal(route.sourceProviders.includes('usaspending'), true);
  assert.equal(route.requiredFacts.includes('official_contract_or_award'), true);
  assert.equal(route.collectorCapabilities.some((item) => item.maxEvidenceUse === 'promotion_candidate'), true);
  assert.equal(route.queryVariants.some((query) => /site:war\.gov|site:defense\.gov|usaspending/i.test(query)), true);
});

test('issuer_commentary excludes ETF and macro symbols from issuer collectors', () => {
  const route = routeEvidenceProvider({
    evidenceClass: 'issuer_commentary',
    subject: 'Defense Industrial',
    issuerUniverse: ['RTX', 'LMT', 'ITA', 'UUP', 'QQQ'],
  });

  assert.deepEqual(route.issuerUniverse, ['RTX', 'LMT']);
  assert.equal(route.executableCollectors.includes('sec'), true);
  assert.equal(route.queryVariants.some((query) => /RTX LMT/.test(query)), true);
});

test('issuer-specific routes use candidate issuer universe for collection without promotion universe', () => {
  const route = routeEvidenceProvider({
    evidenceClass: 'issuer_exposure',
    subject: 'grid interconnection queue',
    issuerUniverse: ['SMH'],
    candidateIssuerUniverse: ['MSFT', 'VRT', 'QQQ'],
  });

  assert.equal(route.blocked, false);
  assert.deepEqual(route.promotionUniverse, []);
  assert.deepEqual(route.candidateIssuerUniverse.sort(), ['MSFT', 'VRT']);
  assert.deepEqual(route.collectionUniverse.sort(), ['MSFT', 'VRT']);
  assert.equal(route.issuerDiscoveryStatus, 'candidate_only');
  assert.equal(route.queryVariants.some((query) => /MSFT VRT/.test(query)), true);
});

test('issuer-specific routes do not infer candidate tickers from generic query acronyms', () => {
  const route = routeEvidenceProvider({
    evidenceClass: 'issuer_exposure',
    subject: 'grid interconnection queue',
    query: 'GPU ASIC EPS MD grid interconnection queue issuer exposure',
    candidateIssuerUniverse: ['VRT'],
  });

  assert.deepEqual(route.collectionUniverse, ['VRT']);
  assert.equal(route.collectionUniverse.includes('GPU'), false);
  assert.equal(route.collectionUniverse.includes('EPS'), false);
});

test('negative_control creates invalidator queries and remains out of promotion', () => {
  const route = routeEvidenceProvider({
    evidenceClass: 'negative_control',
    subject: 'solid rocket motor capacity',
  });

  assert.deepEqual(route.executableCollectors, ['source-query']);
  assert.equal(route.promotionEligible, false);
  assert.equal(route.negativeControlIntent, true);
  assert.equal(route.requiredFacts.includes('invalidator'), true);
  assert.equal(route.collectorCapabilities[0].maxEvidenceUse, 'negative_control_candidate');
  assert.equal(route.queryVariants.some((query) => /easy substitutes|supplier redundancy|no capacity pressure|no capacity constraint/i.test(query)), true);
});

test('AI capex and power classes route differently from defense procurement classes', () => {
  const capex = routeEvidenceProvider({
    evidenceClass: 'capex_confirmation',
    subject: 'AI / Machine Learning',
    themes: ['ai-ml'],
    issuerUniverse: ['MSFT', 'NVDA', 'SMH'],
  });
  const power = routeEvidenceProvider({
    evidenceClass: 'power_constraint',
    subject: 'AI / Machine Learning',
    themes: ['ai-ml'],
  });
  const procurement = routeEvidenceProvider({
    evidenceClass: 'procurement_trigger',
    subject: 'Defense Industrial',
    themes: ['defense-industrial'],
  });

  assert.equal(capex.executableCollectors.includes('sec'), true);
  assert.equal(capex.executableCollectors.includes('fmp'), true);
  assert.equal(capex.executableCollectors.includes('dod-contracts'), false);
  assert.equal(power.executableCollectors.includes('eia'), true);
  assert.equal(power.executableCollectors.includes('dod-contracts'), false);
  assert.equal(procurement.executableCollectors.includes('dod-contracts'), true);
});

test('grid policy_funding routes to public planning and EIA instead of defense procurement', () => {
  const route = routeEvidenceProvider({
    evidenceClass: 'policy_funding',
    subject: 'grid interconnection queue and data center power constraints',
    themes: ['ai-ml', 'clean-energy'],
    ontologyKeys: ['ai_data_center', 'clean_energy'],
  });

  assert.equal(route.executableCollectors.includes('public-planning-source'), true);
  assert.equal(route.executableCollectors.includes('eia'), true);
  assert.equal(route.executableCollectors.includes('dod-contracts'), false);
  assert.equal(route.sourceProviders.includes('ferc'), true);
  assert.equal(route.sourceProviders.includes('interconnection-queue'), true);
});

test('providerListForRoutes returns collect-free providers only', () => {
  const routes = [
    routeEvidenceProvider({ evidenceClass: 'market_validation', subject: 'AI / Machine Learning', issuerUniverse: ['MSFT'] }),
    routeEvidenceProvider({ evidenceClass: 'negative_control', subject: 'AI / Machine Learning' }),
  ];
  const providers = providerListForRoutes(routes, {
    providers: ['sec', 'fmp', 'polygon', 'dod-contracts', 'source-query'],
  });

  assert.deepEqual(providers.sort(), ['fmp', 'polygon']);
});

test('market validation route does not run on candidate-only issuers', () => {
  const route = routeEvidenceProvider({
    evidenceClass: 'market_validation',
    subject: 'high-voltage switchgear',
    issuerUniverse: [],
    candidateIssuerUniverse: ['PWR', 'ETN', 'VRT'],
  });

  assert.equal(route.blocked, true);
  assert.equal(route.blockedReason, 'blocked_missing_issuer_universe');
  assert.deepEqual(route.issuerUniverse, []);
  assert.deepEqual(route.collectionUniverse, []);
  assert.deepEqual(route.candidateIssuerUniverse.sort(), ['ETN', 'PWR', 'VRT']);
});
