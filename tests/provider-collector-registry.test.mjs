import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildCollectorBackedSourceProviderCandidates,
  buildProviderCollectorRegistry,
  collectorDefinitionForProvider,
  providerHasBoundedCollector,
  trackedCollectorProviderNames,
  validateProviderCollectorManifest,
} from '../scripts/_shared/provider-collector-registry.mjs';
import {
  buildSourceProviderManifestRegistry,
} from '../scripts/_shared/source-provider-manifest-registry.mjs';

test('provider collector registry validates bounded read-only collectors', () => {
  const sourceProviderRegistry = buildSourceProviderManifestRegistry({ generatedAt: '2026-05-22T00:00:00.000Z' });
  const registry = buildProviderCollectorRegistry({
    sourceProviderRegistry,
    generatedAt: '2026-05-22T00:00:00.000Z',
  });

  assert.equal(registry.ok, true);
  assert.equal(registry.collectorCount, 10);
  assert.equal(registry.providerCount, 10);
  assert.deepEqual(registry.invalidCollectors, []);
  assert.deepEqual(registry.missingProviderManifests, []);
  assert.equal(registry.summary.boundedCollectorCount, 10);
  assert.equal(registry.summary.credentialRequiredCount, 0);
  assert.equal(registry.summary.safeBoundary.providerActivationWrites, 0);
  assert.equal(registry.summary.safeBoundary.readinessPromotionWrites, 0);
  assert.equal(registry.summary.evidenceClassesCovered.includes('issuer_exposure'), true);
  assert.equal(registry.summary.evidenceClassesCovered.includes('mechanism_validation'), true);
});

test('collector registry exposes tracked providers for staged execution dispatch', () => {
  const registry = buildProviderCollectorRegistry();
  const tracked = trackedCollectorProviderNames(registry);
  assert.deepEqual(tracked, [
    'company_ir_direct_pdf',
    'dart',
    'edinet',
    'defense_propulsion_readonly',
    'ferc_interconnection_reform',
    'grid_issuer_bridge_readonly',
    'grid_official_readonly',
    'iso_rto_interconnection_queue_report',
    'taiwan_mops',
    'tdnet',
  ].sort());
  assert.equal(providerHasBoundedCollector('company_ir_direct_pdf', registry), true);
  assert.equal(providerHasBoundedCollector('dart', registry), true);
  assert.equal(providerHasBoundedCollector('edinet', registry), true);
  assert.equal(providerHasBoundedCollector('ferc_interconnection_reform', registry), true);
  assert.equal(providerHasBoundedCollector('iso_rto_interconnection_queue_report', registry), true);
  assert.equal(providerHasBoundedCollector('taiwan_mops', registry), true);
  assert.equal(providerHasBoundedCollector('tdnet', registry), true);
  assert.equal(collectorDefinitionForProvider('grid_issuer_bridge_readonly', registry).collectorKind, 'grid_issuer_bridge');
  assert.equal(collectorDefinitionForProvider('dart', registry).collectorKind, 'dart_issuer_exposure');
  assert.equal(collectorDefinitionForProvider('edinet', registry).collectorKind, 'edinet_issuer_exposure');
  assert.equal(collectorDefinitionForProvider('ferc_interconnection_reform', registry).collectorKind, 'ferc_interconnection_reform_engineering_process');
  assert.equal(collectorDefinitionForProvider('ferc_interconnection_reform', registry).evidenceClasses.includes('permitting_regulatory'), true);
  assert.equal(collectorDefinitionForProvider('iso_rto_interconnection_queue_report', registry).collectorKind, 'iso_rto_interconnection_queue_report_engineering_process');
  assert.equal(collectorDefinitionForProvider('iso_rto_interconnection_queue_report', registry).sourceProviderManifestRequired, false);
  assert.equal(collectorDefinitionForProvider('tdnet', registry).collectorKind, 'tdnet_issuer_exposure');
  assert.equal(collectorDefinitionForProvider('taiwan_mops', registry).collectorKind, 'taiwan_mops_issuer_exposure');
});

test('collector-backed candidates stage manifest-free bounded collectors', () => {
  const registry = buildProviderCollectorRegistry();
  const candidates = buildCollectorBackedSourceProviderCandidates(registry, {
    generatedAt: '2026-05-22T00:00:00.000Z',
  });
  assert.equal(candidates.length, 1);
  const [candidate] = candidates;
  assert.equal(candidate.providerName, 'iso_rto_interconnection_queue_report');
  assert.equal(candidate.evidenceClass, 'engineering_process');
  assert.equal(candidate.discoveredBy, 'provider_collector_registry');
  assert.equal(candidate.fixtureRequired, true);
  assert.equal(candidate.probe.fixtureStatus, 'verified');
  assert.equal(candidate.probe.parserStatus, 'schema_verified');
  assert.equal(candidate.probe.healthcheckStatus, 'passed');
  assert.equal(candidate.metadata.sourceProviderManifestRequired, false);
  assert.equal(candidate.metadata.mutationBoundary.providerActivationWrites, 0);
  assert.equal(candidate.metadata.mutationBoundary.readinessPromotionWrites, 0);
});

test('collector validator rejects unsafe readiness or mutation policies', () => {
  const validation = validateProviderCollectorManifest({
    collectorId: 'unsafe.collector',
    providerName: 'company_ir_direct_pdf',
    collectorKind: 'unsafe',
    targetMode: 'single_task',
    evidenceClasses: ['issuer_exposure'],
    sourceGroups: ['official_company_ir'],
    boundedExecution: true,
    reviewGatedActivation: true,
    testCommand: 'node --test',
    healthCheckCommand: 'node --test',
    failureModes: ['SOURCE_UNAVAILABLE', 'TIMEOUT', 'WEAK_EVIDENCE', 'TICKER_ONLY', 'NO_RESULT', 'ACCEPTED', 'CONTRADICTORY'],
    readinessPolicy: {
      rawEvidenceCanPromoteReadiness: true,
      acceptedEvidenceRequired: false,
      negativeControlCanPromote: true,
      marketValidationRequiresLocalControlledData: false,
    },
    mutationBoundary: {
      providerActivationWrites: 1,
      sourceRegistryWrites: 0,
      canonicalWrites: 0,
      readinessPromotionWrites: 0,
      reportCandidateWrites: 0,
      portfolioActionWrites: 0,
    },
  }, {
    providerNames: ['company_ir_direct_pdf'],
  });

  assert.equal(validation.ok, false);
  assert.equal(validation.errors.includes('unsafe_readiness_policy:raw_promotes_readiness'), true);
  assert.equal(validation.errors.includes('unsafe_readiness_policy:accepted_evidence_not_required'), true);
  assert.equal(validation.errors.includes('unsafe_readiness_policy:negative_control_promotes'), true);
  assert.equal(validation.errors.includes('unsafe_readiness_policy:market_without_controlled_data'), true);
  assert.equal(validation.errors.includes('unsafe_mutation_boundary:providerActivationWrites'), true);
});
