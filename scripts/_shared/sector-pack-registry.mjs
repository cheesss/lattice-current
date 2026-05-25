import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

export const SECTOR_PACK_REGISTRY_VERSION = 'sector-pack-registry-v1';
export const DEFAULT_SECTOR_PACK_CONFIG_DIR = path.join(process.cwd(), 'config', 'sector-packs');
export const DEFAULT_SECTOR_PACK_ARTIFACT_PATH = path.join(process.cwd(), 'data', 'runtime', 'sector-pack-registry.latest.json');

const REQUIRED_SECTORS = Object.freeze([
  'defense_space',
  'semiconductor_advanced_packaging',
  'grid_utility_infrastructure',
  'healthcare_glp1_manufacturing',
  'materials_critical_minerals',
  'industrial_test_equipment',
]);

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (value === null || value === undefined || value === '') return [];
  return [value];
}

function compact(value = '') {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, 'utf8'));
}

function readSectorPackFiles(configDir = DEFAULT_SECTOR_PACK_CONFIG_DIR) {
  if (!existsSync(configDir)) return [];
  return readdirSync(configDir)
    .filter((name) => name.endsWith('.json'))
    .sort()
    .map((name) => {
      const filePath = path.join(configDir, name);
      return { filePath, payload: readJson(filePath) };
    });
}

function packsFromPayload(entry) {
  const payload = entry.payload || {};
  const rows = Array.isArray(payload) ? payload : asArray(payload.sectors || payload.packs || payload.sector);
  return rows.map((row) => ({
    ...row,
    manifestFile: path.relative(process.cwd(), entry.filePath).replace(/\\/g, '/'),
    registryVersion: payload.version || SECTOR_PACK_REGISTRY_VERSION,
  }));
}

export function normalizeSectorPack(input = {}) {
  return {
    sectorId: compact(input.sectorId),
    themes: asArray(input.themes).map((item) => compact(item)).filter(Boolean),
    childSeed: input.childSeed || {},
    issuerUniverse: asArray(input.issuerUniverse),
    officialRoutes: asArray(input.officialRoutes).map((item) => compact(item)).filter(Boolean),
    negativeControlQueries: asArray(input.negativeControlQueries).map((item) => compact(item)).filter(Boolean),
    holdoutRoutes: asArray(input.holdoutRoutes).map((item) => compact(item)).filter(Boolean),
    controlledMarketValidationFixture: compact(input.controlledMarketValidationFixture),
    requiredEvidenceClasses: asArray(input.requiredEvidenceClasses).map((item) => compact(item)).filter(Boolean),
    realEvidenceRoute: input.realEvidenceRoute || null,
    reportQualityExpectations: input.reportQualityExpectations || {
      exporterFamily: 'cross_theme_long_form',
      debugGateReceiptOnly: false,
    },
    validationFixtureOnly: input.validationFixtureOnly !== false,
    productionReadinessEvidence: input.productionReadinessEvidence === true,
    manifestFile: input.manifestFile || null,
    registryVersion: input.registryVersion || SECTOR_PACK_REGISTRY_VERSION,
  };
}

export function validateSectorPack(input = {}) {
  const pack = normalizeSectorPack(input);
  const errors = [];
  if (!pack.sectorId) errors.push('missing_sector_id');
  if (!pack.childSeed?.childSeedId) errors.push('missing_child_seed_id');
  if (!pack.childSeed?.bottleneckNode) errors.push('missing_bottleneck_node');
  if (!pack.childSeed?.childClass) errors.push('missing_child_class');
  if (!pack.issuerUniverse.length) errors.push('missing_issuer_universe');
  if (!pack.officialRoutes.length) errors.push('missing_official_routes');
  if (!pack.negativeControlQueries.length) errors.push('missing_negative_control_queries');
  if (!pack.holdoutRoutes.length) errors.push('missing_holdout_routes');
  if (!pack.controlledMarketValidationFixture) errors.push('missing_controlled_market_validation_fixture');
  if (!pack.realEvidenceRoute?.routeType) errors.push('missing_real_evidence_route');
  if (!asArray(pack.realEvidenceRoute?.allowedSources).length) errors.push('missing_real_evidence_allowed_sources');
  if (pack.productionReadinessEvidence === true) errors.push('sector_pack_cannot_set_production_readiness');
  return { ok: errors.length === 0, sectorId: pack.sectorId, pack, errors };
}

export function buildSectorPackRegistry(options = {}) {
  const generatedAt = options.generatedAt || new Date().toISOString();
  const entries = readSectorPackFiles(options.configDir || DEFAULT_SECTOR_PACK_CONFIG_DIR);
  const packs = entries.flatMap(packsFromPayload).map(normalizeSectorPack);
  const validations = packs.map(validateSectorPack);
  const bySector = {};
  for (const validation of validations) {
    if (!validation.sectorId || bySector[validation.sectorId]) continue;
    bySector[validation.sectorId] = {
      ...validation.pack,
      valid: validation.ok,
      validationErrors: validation.errors,
    };
  }
  const missingSectors = REQUIRED_SECTORS.filter((sectorId) => !bySector[sectorId]);
  const invalidSectors = Object.values(bySector).filter((pack) => !pack.valid);
  return {
    ok: missingSectors.length === 0 && invalidSectors.length === 0,
    version: SECTOR_PACK_REGISTRY_VERSION,
    generatedAt,
    configDir: path.resolve(options.configDir || DEFAULT_SECTOR_PACK_CONFIG_DIR),
    requiredSectors: [...REQUIRED_SECTORS],
    sectorCount: Object.keys(bySector).length,
    sectors: Object.values(bySector),
    missingSectors,
    invalidSectors: invalidSectors.map((pack) => pack.sectorId),
    summary: {
      sectorCount: Object.keys(bySector).length,
      validationFixtureOnlyCount: Object.values(bySector).filter((pack) => pack.validationFixtureOnly === true).length,
      productionReadinessEvidenceCount: Object.values(bySector).filter((pack) => pack.productionReadinessEvidence === true).length,
      longFormReportPackCount: Object.values(bySector).filter((pack) => pack.reportQualityExpectations?.exporterFamily === 'cross_theme_long_form').length,
    },
  };
}

export async function writeSectorPackRegistryArtifact(
  registry = buildSectorPackRegistry(),
  artifactPath = DEFAULT_SECTOR_PACK_ARTIFACT_PATH,
) {
  await mkdir(path.dirname(artifactPath), { recursive: true });
  await writeFile(artifactPath, `${JSON.stringify(registry, null, 2)}\n`, 'utf8');
  return path.resolve(artifactPath);
}
