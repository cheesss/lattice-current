import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildSectorPositivePathRegistry,
  buildSectorPositivePathSummary,
  validateSectorPositivePathRegistry,
} from '../scripts/_shared/sector-positive-path-registry.mjs';

test('sector positive-path registry covers required sectors without readiness promotion', () => {
  const registry = buildSectorPositivePathRegistry({ generatedAt: '2026-05-22T00:00:00.000Z' });
  const validation = validateSectorPositivePathRegistry(registry);
  assert.equal(validation.ok, true);
  assert.deepEqual(validation.errors, []);
  assert.equal(registry.sectors.length, 6);
  assert.equal(registry.sectors.every((sector) => sector.validationFixtureOnly === true), true);
  assert.equal(registry.sectors.every((sector) => sector.readinessBoundary.investmentMemoReady === false), true);
  assert.equal(registry.sectors.every((sector) => sector.readinessBoundary.decisionReady === false), true);
  assert.equal(registry.sectors.every((sector) => sector.readinessBoundary.portfolioActionAllowed === false), true);
  assert.equal(registry.sectors.every((sector) => sector.realEvidenceDryRun.productionReadinessEvidence === false), true);
  assert.equal(registry.sectors.every((sector) => sector.realEvidenceDryRun.readinessChanged === false), true);
});

test('sector positive-path registry has narrow seeds, official routes and gate fixtures', () => {
  const registry = buildSectorPositivePathRegistry();
  for (const sector of registry.sectors) {
    assert.ok(sector.childSeed.childSeedId);
    assert.ok(sector.childSeed.bottleneckNode);
    assert.ok(sector.childSeed.childClass);
    assert.equal(sector.issuerUniverse.length >= 2, true);
    assert.equal(sector.officialRoutes.length >= 2, true);
    assert.equal(sector.negativeControlQueries.length >= 1, true);
    assert.equal(sector.holdoutRoutes.length >= 1, true);
    assert.ok(sector.controlledMarketValidationFixture);
    assert.ok(sector.realEvidenceRoute.routeType);
    assert.equal(sector.realEvidenceRoute.allowedSources.length >= 2, true);
    assert.match(sector.realEvidenceRoute.dryRunCommand, /run-autonomous-research-repair-loop/);
    assert.equal(sector.acceptancePolicy.acceptedEvidenceRequired, true);
    assert.equal(sector.acceptancePolicy.controlledMarketValidationRequired, true);
  }
});

test('sector summary exposes validation fixture coverage for dashboard/API', () => {
  const summary = buildSectorPositivePathSummary();
  assert.equal(summary.ok, true);
  assert.equal(summary.sectorCount, 6);
  assert.equal(summary.validationFixtureOnlyCount, 6);
  assert.equal(summary.sectors.some((sector) => sector.sectorId === 'healthcare_glp1_manufacturing'), true);
  assert.equal(summary.sectors.some((sector) => sector.sectorId === 'materials_critical_minerals'), true);
  assert.equal(summary.sectors.every((sector) => sector.portfolioActionAllowed === false), true);
  assert.equal(summary.sectors.every((sector) => sector.realEvidenceStatus === 'blocked_until_real_official_evidence'), true);
  assert.equal(summary.sectors.every((sector) => Boolean(sector.realEvidenceRouteType)), true);
});
