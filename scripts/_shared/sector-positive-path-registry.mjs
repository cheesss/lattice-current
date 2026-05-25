import {
  buildSectorPackRegistry,
} from './sector-pack-registry.mjs';

export const SECTOR_POSITIVE_PATH_REGISTRY_VERSION = 'sector-positive-path-registry-v1';

const SECTOR_FIXTURES = Object.freeze([
  {
    sectorId: 'defense_space',
    themes: ['defense-industrial', 'space'],
    childSeed: {
      childSeedId: 'sector-fixture-defense-space-test-facility',
      bottleneckNode: 'solid rocket motor qualification test facility capacity',
      childClass: 'test_facility_capacity',
      mechanism: 'qualification test stands and range schedules can bottleneck propulsion production ramps',
    },
    issuerUniverse: [
      { symbol: 'LMT', roleClass: 'prime_or_program_owner' },
      { symbol: 'RTX', roleClass: 'prime_or_program_owner' },
      { symbol: 'NOC', roleClass: 'propulsion_supplier_or_integrator' },
      { symbol: 'TXT', roleClass: 'range_support_or_test_operator' },
    ],
    officialRoutes: ['SEC 10-K / 10-Q', 'earnings transcript', 'official contract award', 'DoD budget/procurement document'],
    negativeControlQueries: ['test facility capacity improving', 'qualification delays resolved', 'supplier redundancy sufficient'],
    holdoutRoutes: ['official_government_contract', 'issuer_ir_transcript'],
    controlledMarketValidationFixture: 'local defense/space event window with peer/ETF controls',
    requiredEvidenceClasses: ['issuer_exposure', 'technical_qualification', 'test_facility_capacity', 'negative_control', 'holdout_validation', 'market_validation'],
  },
  {
    sectorId: 'semiconductor_advanced_packaging',
    themes: ['semiconductor', 'materials-science'],
    childSeed: {
      childSeedId: 'sector-fixture-semiconductor-probe-test',
      bottleneckNode: 'probe card and test socket capacity for HBM and accelerators',
      childClass: 'test_facility_capacity',
      mechanism: 'test hardware qualification and burn-in throughput can bottleneck advanced package ramps',
    },
    issuerUniverse: [
      { symbol: 'FORM', roleClass: 'probe_card_capacity_owner' },
      { symbol: 'TER', roleClass: 'test_equipment_supplier' },
      { symbol: 'A', roleClass: 'test_measurement_supplier' },
      { symbol: 'NVMI', roleClass: 'inspection_metrology_supplier' },
    ],
    officialRoutes: ['SEC 10-K / 10-Q', 'company IR presentation', 'earnings transcript', 'official capacity announcement'],
    negativeControlQueries: ['probe card capacity expansion completed', 'test socket supply improving', 'alternative suppliers sufficient'],
    holdoutRoutes: ['issuer_ir_transcript', 'specialist_trade_media', 'official_customer_release'],
    controlledMarketValidationFixture: 'local semicap/test equipment event window with SOXX/peer controls',
    requiredEvidenceClasses: ['issuer_exposure', 'technical_qualification', 'supplier_capacity', 'negative_control', 'holdout_validation', 'market_validation'],
  },
  {
    sectorId: 'grid_utility_infrastructure',
    themes: ['cloud-infrastructure', 'climate-change', 'utilities'],
    childSeed: {
      childSeedId: 'sector-fixture-grid-epc-backlog',
      bottleneckNode: 'transmission and substation EPC backlog',
      childClass: 'engineering_process',
      mechanism: 'grid EPC project execution capacity can bottleneck utility and large-load infrastructure delivery',
    },
    issuerUniverse: [
      { symbol: 'PWR', roleClass: 'grid_epc_capacity_owner' },
      { symbol: 'ACM', roleClass: 'utility_infrastructure_engineering' },
      { symbol: 'J', roleClass: 'utility_infrastructure_engineering' },
    ],
    officialRoutes: ['SEC 10-K / 10-Q', 'earnings transcript', 'IR presentation', 'official utility contract announcement'],
    negativeControlQueries: ['utility capex slowdown', 'backlog declining', 'project delays hurting margin', 'management denies grid bottleneck'],
    holdoutRoutes: ['utility_capex_plan', 'official_grid_operator_planning'],
    controlledMarketValidationFixture: 'local grid EPC event window with industrial/utilities controls',
    requiredEvidenceClasses: ['issuer_exposure', 'issuer_commentary', 'backlog', 'negative_control', 'holdout_validation', 'market_validation'],
  },
  {
    sectorId: 'healthcare_glp1_manufacturing',
    themes: ['biotech', 'healthcare', 'logistics'],
    childSeed: {
      childSeedId: 'sector-fixture-healthcare-fill-finish',
      bottleneckNode: 'sterile fill-finish line capacity for injectable GLP-1 drugs',
      childClass: 'supplier_capacity',
      mechanism: 'sterile fill-finish and device assembly lines can bottleneck injectable drug supply',
    },
    issuerUniverse: [
      { symbol: 'NVO', roleClass: 'drug_sponsor_capacity_owner' },
      { symbol: 'LLY', roleClass: 'drug_sponsor_capacity_owner' },
      { symbol: 'CTLT', roleClass: 'fill_finish_cdmo' },
      { symbol: 'WST', roleClass: 'injectable_component_supplier' },
    ],
    officialRoutes: ['SEC 10-K / 10-Q', 'annual report', 'company IR presentation', 'official manufacturing capacity announcement'],
    negativeControlQueries: ['fill finish supply normalized', 'autoinjector supply improving', 'demand slowdown obesity drugs'],
    holdoutRoutes: ['issuer_ir_transcript', 'FDA/official manufacturing notice', 'trusted pharma trade source'],
    controlledMarketValidationFixture: 'local GLP-1 manufacturing event window with pharma/CDMO controls',
    requiredEvidenceClasses: ['issuer_exposure', 'supplier_capacity', 'technical_qualification', 'negative_control', 'holdout_validation', 'market_validation'],
  },
  {
    sectorId: 'materials_critical_minerals',
    themes: ['geopolitics', 'materials-science', 'semiconductor', 'defense-industrial'],
    childSeed: {
      childSeedId: 'sector-fixture-critical-minerals-tungsten',
      bottleneckNode: 'non-China tungsten supply for defense and semiconductor tooling',
      childClass: 'material_input',
      mechanism: 'qualified non-China tungsten supply can bottleneck defense tooling and semiconductor hard-metal applications',
    },
    issuerUniverse: [
      { symbol: 'ALB', roleClass: 'critical_material_supplier' },
      { symbol: 'MP', roleClass: 'non_china_mineral_supplier' },
      { symbol: 'HAYN', roleClass: 'specialty_material_supplier' },
    ],
    officialRoutes: ['SEC 10-K / 10-Q', 'government critical minerals document', 'company IR presentation', 'official supply agreement'],
    negativeControlQueries: ['tungsten supply improving', 'substitute materials sufficient', 'inventory surplus critical minerals'],
    holdoutRoutes: ['official_government_dataset', 'issuer_filing', 'specialist_trade_media'],
    controlledMarketValidationFixture: 'local critical-minerals event window with metals/industrial controls',
    requiredEvidenceClasses: ['issuer_exposure', 'material_input', 'substitution_limit', 'negative_control', 'holdout_validation', 'market_validation'],
  },
  {
    sectorId: 'industrial_test_equipment',
    themes: ['industrial', 'semiconductor', 'grid'],
    childSeed: {
      childSeedId: 'sector-fixture-industrial-test-equipment',
      bottleneckNode: 'high-voltage and advanced electronics test equipment capacity',
      childClass: 'test_facility_capacity',
      mechanism: 'specialized test equipment and calibration throughput can delay qualification of grid, aerospace, and advanced electronics projects',
    },
    issuerUniverse: [
      { symbol: 'KEYS', roleClass: 'test_measurement_supplier' },
      { symbol: 'TER', roleClass: 'semiconductor_test_supplier' },
      { symbol: 'AME', roleClass: 'industrial_instrumentation_supplier' },
    ],
    officialRoutes: ['SEC 10-K / 10-Q', 'company IR presentation', 'earnings transcript', 'official product/customer announcement'],
    negativeControlQueries: ['test equipment supply improving', 'qualification capacity sufficient', 'customer capex slowdown'],
    holdoutRoutes: ['issuer_ir_transcript', 'official_customer_release', 'specialist_trade_media'],
    controlledMarketValidationFixture: 'local test-equipment event window with industrial technology controls',
    requiredEvidenceClasses: ['issuer_exposure', 'technical_qualification', 'test_facility_capacity', 'negative_control', 'holdout_validation', 'market_validation'],
  },
]);

const REAL_EVIDENCE_ROUTES = Object.freeze({
  defense_space: {
    routeType: 'official_defense_and_issuer_source',
    allowedSources: ['SEC 10-K / 10-Q', 'issuer earnings transcript', 'DoD contract award', 'DoD budget/procurement document'],
    dryRunCommand: 'node --import tsx scripts/run-autonomous-research-repair-loop.mjs --mode execute-safe --max-seeds 1 --max-tracks 1 --sector defense_space',
    acceptanceBoundary: 'official defense/issuer source only; fixture rows are regression-only and cannot set production readiness',
  },
  semiconductor_advanced_packaging: {
    routeType: 'official_semicap_issuer_source',
    allowedSources: ['SEC 10-K / 10-Q', 'company IR presentation', 'earnings transcript', 'official capacity announcement'],
    dryRunCommand: 'node --import tsx scripts/run-autonomous-research-repair-loop.mjs --mode execute-safe --max-seeds 1 --max-tracks 1 --sector semiconductor_advanced_packaging',
    acceptanceBoundary: 'official issuer/trusted source with direct bottleneck and operating bridge snippet',
  },
  grid_utility_infrastructure: {
    routeType: 'sec_ir_plus_utility_planning_source',
    allowedSources: ['SEC 10-K / 10-Q', 'earnings transcript', 'IR presentation', 'utility capex plan', 'official grid operator planning'],
    dryRunCommand: 'node --import tsx scripts/run-autonomous-research-repair-loop.mjs --mode execute-safe --max-seeds 1 --max-tracks 1 --sector grid_utility_infrastructure',
    acceptanceBoundary: 'Track B issuer bridge requires SEC/IR evidence; Track A mechanism evidence cannot raise investment readiness alone',
  },
  healthcare_glp1_manufacturing: {
    routeType: 'official_healthcare_capacity_source',
    allowedSources: ['SEC 10-K / 10-Q', 'annual report', 'company IR presentation', 'official manufacturing capacity announcement'],
    dryRunCommand: 'node --import tsx scripts/run-autonomous-research-repair-loop.mjs --mode execute-safe --max-seeds 1 --max-tracks 1 --sector healthcare_glp1_manufacturing',
    acceptanceBoundary: 'official sponsor/CDMO/component source with manufacturing capacity bridge',
  },
  materials_critical_minerals: {
    routeType: 'official_government_minerals_plus_issuer_filing',
    allowedSources: ['government critical minerals document', 'SEC 10-K / 10-Q', 'company IR presentation', 'official supply agreement'],
    dryRunCommand: 'node --import tsx scripts/run-autonomous-research-repair-loop.mjs --mode execute-safe --max-seeds 1 --max-tracks 1 --sector materials_critical_minerals',
    acceptanceBoundary: 'official government/minerals source plus issuer filing bridge required',
  },
  industrial_test_equipment: {
    routeType: 'official_test_equipment_issuer_source',
    allowedSources: ['SEC 10-K / 10-Q', 'company IR presentation', 'earnings transcript', 'official product/customer announcement'],
    dryRunCommand: 'node --import tsx scripts/run-autonomous-research-repair-loop.mjs --mode execute-safe --max-seeds 1 --max-tracks 1 --sector industrial_test_equipment',
    acceptanceBoundary: 'official issuer/customer source with test equipment capacity or qualification bridge',
  },
});

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (value === null || value === undefined || value === '') return [];
  return [value];
}

function compact(value = '') {
  return String(value || '').replace(/\s+/g, ' ').trim();
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

export function buildSectorPositivePathRegistry(options = {}) {
  const generatedAt = options.generatedAt || new Date().toISOString();
  const sectorPackRegistry = buildSectorPackRegistry(options);
  const sectorFixtures = sectorPackRegistry.ok && sectorPackRegistry.sectors.length
    ? sectorPackRegistry.sectors
    : SECTOR_FIXTURES;
  return {
    ok: true,
    version: SECTOR_POSITIVE_PATH_REGISTRY_VERSION,
    generatedAt,
    configBacked: sectorPackRegistry.ok === true,
    sectorPackRegistryVersion: sectorPackRegistry.version,
    purpose: 'fixture-backed positive-path regression coverage only; not production readiness evidence',
    sectors: sectorFixtures.map((sector) => ({
      ...sector,
      realEvidenceRoute: sector.realEvidenceRoute || REAL_EVIDENCE_ROUTES[sector.sectorId],
      realEvidenceDryRun: {
        status: 'blocked_until_real_official_evidence',
        productionReadinessEvidence: false,
        readinessChanged: false,
        fixtureRowsUsableForProductionReadiness: false,
      },
      validationFixtureOnly: sector.validationFixtureOnly !== false,
      productionReadinessEvidence: false,
      readinessBoundary: {
        investmentMemoReady: false,
        decisionReady: false,
        portfolioActionAllowed: false,
        reportCandidateWrites: 'dry_run_only',
      },
      acceptancePolicy: {
        rawEvidenceFirst: true,
        acceptedEvidenceRequired: true,
        negativeControlRequired: true,
        holdoutRequired: true,
        issuerBridgeRequired: true,
        controlledMarketValidationRequired: true,
      },
    })),
  };
}

export function validateSectorPositivePathRegistry(registry = buildSectorPositivePathRegistry()) {
  const requiredSectors = [
    'defense_space',
    'semiconductor_advanced_packaging',
    'grid_utility_infrastructure',
    'healthcare_glp1_manufacturing',
    'materials_critical_minerals',
    'industrial_test_equipment',
  ];
  const sectors = asArray(registry.sectors);
  const ids = new Set(sectors.map((sector) => sector.sectorId));
  const errors = [];
  for (const sectorId of requiredSectors) {
    if (!ids.has(sectorId)) errors.push(`missing_sector:${sectorId}`);
  }
  for (const sector of sectors) {
    if (!sector.childSeed?.bottleneckNode) errors.push(`missing_bottleneck:${sector.sectorId}`);
    if (!asArray(sector.issuerUniverse).length) errors.push(`missing_issuer_universe:${sector.sectorId}`);
    if (!asArray(sector.officialRoutes).length) errors.push(`missing_official_routes:${sector.sectorId}`);
    if (!sector.realEvidenceRoute?.routeType) errors.push(`missing_real_evidence_route:${sector.sectorId}`);
    if (!asArray(sector.realEvidenceRoute?.allowedSources).length) errors.push(`missing_real_allowed_sources:${sector.sectorId}`);
    if (!sector.realEvidenceRoute?.dryRunCommand) errors.push(`missing_real_dry_run_command:${sector.sectorId}`);
    if (sector.realEvidenceDryRun?.productionReadinessEvidence !== false) errors.push(`unsafe_real_evidence_status:${sector.sectorId}`);
    if (!asArray(sector.negativeControlQueries).length) errors.push(`missing_negative_control:${sector.sectorId}`);
    if (!asArray(sector.holdoutRoutes).length) errors.push(`missing_holdout:${sector.sectorId}`);
    if (!sector.controlledMarketValidationFixture) errors.push(`missing_market_fixture:${sector.sectorId}`);
    if (sector.validationFixtureOnly !== true) errors.push(`not_fixture_only:${sector.sectorId}`);
    if (sector.readinessBoundary?.investmentMemoReady !== false) errors.push(`unsafe_investment_boundary:${sector.sectorId}`);
    if (sector.readinessBoundary?.portfolioActionAllowed !== false) errors.push(`unsafe_portfolio_boundary:${sector.sectorId}`);
  }
  return {
    ok: errors.length === 0,
    version: SECTOR_POSITIVE_PATH_REGISTRY_VERSION,
    requiredSectors,
    sectorCount: sectors.length,
    errors,
  };
}

export function buildSectorPositivePathSummary(registry = buildSectorPositivePathRegistry()) {
  const validation = validateSectorPositivePathRegistry(registry);
  const sectors = asArray(registry.sectors);
  return {
    ok: validation.ok,
    version: SECTOR_POSITIVE_PATH_REGISTRY_VERSION,
    sectorCount: sectors.length,
    validationFixtureOnlyCount: sectors.filter((sector) => sector.validationFixtureOnly === true).length,
    sectors: sectors.map((sector) => ({
      sectorId: sector.sectorId,
      bottleneckNode: sector.childSeed?.bottleneckNode || null,
      childClass: sector.childSeed?.childClass || null,
      issuerCount: asArray(sector.issuerUniverse).length,
      officialRouteCount: asArray(sector.officialRoutes).length,
      requiredEvidenceClasses: uniqueStrings(sector.requiredEvidenceClasses, 20),
      controlledMarketValidationFixture: Boolean(sector.controlledMarketValidationFixture),
      realEvidenceRouteType: sector.realEvidenceRoute?.routeType || null,
      realEvidenceStatus: sector.realEvidenceDryRun?.status || null,
      productionReadinessEvidence: sector.realEvidenceDryRun?.productionReadinessEvidence === true,
      validationFixtureOnly: sector.validationFixtureOnly === true,
      investmentMemoReady: sector.readinessBoundary?.investmentMemoReady === true,
      portfolioActionAllowed: sector.readinessBoundary?.portfolioActionAllowed === true,
    })),
    validationErrors: validation.errors,
  };
}
