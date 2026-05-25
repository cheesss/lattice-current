import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildSectorPackRegistry,
  validateSectorPack,
} from '../scripts/_shared/sector-pack-registry.mjs';
import {
  buildSectorPositivePathRegistry,
} from '../scripts/_shared/sector-positive-path-registry.mjs';

test('sector pack registry covers six sectors with real official route metadata', () => {
  const registry = buildSectorPackRegistry({ generatedAt: '2026-05-22T00:00:00.000Z' });
  assert.equal(registry.ok, true);
  assert.equal(registry.sectorCount, 6);
  assert.deepEqual(registry.missingSectors, []);
  assert.deepEqual(registry.invalidSectors, []);
  assert.equal(registry.summary.validationFixtureOnlyCount, 6);
  assert.equal(registry.summary.productionReadinessEvidenceCount, 0);
  assert.equal(registry.summary.longFormReportPackCount, 6);
  assert.equal(registry.sectors.every((sector) => sector.realEvidenceRoute.routeType), true);
  assert.equal(registry.sectors.every((sector) => sector.productionReadinessEvidence === false), true);
});

test('sector pack config feeds existing positive-path registry without readiness promotion', () => {
  const registry = buildSectorPositivePathRegistry({ generatedAt: '2026-05-22T00:00:00.000Z' });
  assert.equal(registry.configBacked, true);
  assert.equal(registry.sectors.length, 6);
  assert.equal(registry.sectors.every((sector) => sector.validationFixtureOnly === true), true);
  assert.equal(registry.sectors.every((sector) => sector.readinessBoundary.investmentMemoReady === false), true);
  assert.equal(registry.sectors.every((sector) => sector.readinessBoundary.portfolioActionAllowed === false), true);
  assert.equal(registry.sectors.every((sector) => sector.realEvidenceDryRun.productionReadinessEvidence === false), true);
});

test('sector pack validator rejects production readiness evidence in config', () => {
  const validation = validateSectorPack({
    sectorId: 'unsafe_sector',
    childSeed: { childSeedId: 'child', bottleneckNode: 'node', childClass: 'supplier_capacity' },
    issuerUniverse: [{ symbol: 'ABC', roleClass: 'issuer' }],
    officialRoutes: ['SEC 10-K'],
    negativeControlQueries: ['no bottleneck'],
    holdoutRoutes: ['official holdout'],
    controlledMarketValidationFixture: 'local event window',
    realEvidenceRoute: { routeType: 'official', allowedSources: ['SEC 10-K'] },
    productionReadinessEvidence: true,
  });
  assert.equal(validation.ok, false);
  assert.equal(validation.errors.includes('sector_pack_cannot_set_production_readiness'), true);
});
