export const SEED_CHILD_BOTTLENECK_DECOMPOSITION_VERSION = 'seed-child-bottleneck-decomposition-v1';

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (value === null || value === undefined || value === '') return [];
  return [value];
}

function compact(value = '') {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function normalize(value = '') {
  return compact(value).toLowerCase();
}

function uniqueStrings(values = [], limit = 80) {
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

function safeId(value = '') {
  return compact(value)
    .replace(/[^a-zA-Z0-9_.:-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase()
    || 'child';
}

function stableHash(value = '') {
  let hash = 2166136261;
  for (const char of String(value || '')) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function seedId(seed = {}) {
  return compact(seed.seedId || seed.seed_id || seed.id);
}

function parentText(seed = {}) {
  return normalize([
    seed.seedTitle,
    seed.growthDriver,
    seed.realActivity,
    seed.physicalProcess,
    seed.requiredInputs,
    seed.bottleneck?.label,
    seed.bottleneck?.mechanism,
    seed.supplierCategory?.label,
    seed.evidenceQueries,
  ].flatMap(asArray).join(' '));
}

const REPRESENTATIVE_TICKERS = new Set([
  'NVDA',
  'MSFT',
  'GOOGL',
  'GOOG',
  'META',
  'VRT',
  'ETN',
  'PWR',
  'LMT',
  'RTX',
  'TSM',
  'ASML',
  'AMD',
]);

const CHILD_SELECTION_PRIORITY = Object.freeze([
  {
    rank: 1,
    label: 'ABF resin / build-up film / advanced substrate material capacity',
    pattern: /\b(abf|build-?up film|build-?up substrate|advanced substrate material)\b/i,
  },
  {
    rank: 2,
    label: 'probe card / test socket / burn-in capacity',
    pattern: /\b(probe card|test socket|burn-?in)\b/i,
  },
  {
    rank: 3,
    label: 'underfill / mold compound material capacity',
    pattern: /\b(underfill|mold compound)\b/i,
  },
  {
    rank: 4,
    label: 'temporary bonding / debonding throughput',
    pattern: /\b(temporary bonding|debonding)\b/i,
  },
  {
    rank: 5,
    label: 'silicon interposer inspection / metrology bottleneck',
    pattern: /\b(interposer inspection|metrology)\b/i,
  },
  {
    rank: 6,
    label: 'solid rocket motor qualification test facility capacity',
    pattern: /\b(solid rocket motor qualification test|static fire|propulsion test|test facility)\b/i,
  },
  {
    rank: 7,
    label: 'cryogenic valve and pump qualification',
    pattern: /\b(cryogenic valve|cryogenic pump|qualification)\b/i,
  },
]);

const POSITIVE_PATH_CHILD_PRIORITY = Object.freeze([
  {
    rank: 1,
    label: 'interconnection study capacity / PWR',
    pattern: /\b(interconnection study|system impact study|facilities study|grid study|pwr|quanta)\b/i,
    reason: 'narrow grid engineering bottleneck with SEC/IR-accessible PWR issuer bridge potential',
  },
  {
    rank: 2,
    label: 'solid rocket motor test facility capacity',
    pattern: /\b(solid rocket motor qualification test|static fire|propulsion test|test facility)\b/i,
    reason: 'narrow qualification/test bottleneck with defense official and issuer routes',
  },
  {
    rank: 3,
    label: 'substation equipment lead time',
    pattern: /\b(large transformer|switchgear|substation equipment|protection relay|substation automation)\b/i,
    reason: 'narrow grid equipment lead-time bottleneck with listed issuer filings and official utility routes',
  },
  {
    rank: 4,
    label: 'probe card / test socket / burn-in capacity',
    pattern: /\b(probe card|test socket|burn-?in)\b/i,
    reason: 'narrow test-interface bottleneck with SEC/IR-accessible issuer universe',
  },
  {
    rank: 5,
    label: 'temporary bonding / debonding throughput',
    pattern: /\b(temporary bonding|debonding)\b/i,
    reason: 'narrow process-equipment bottleneck with official issuer routes',
  },
  {
    rank: 6,
    label: 'advanced packaging inspection / metrology bottleneck',
    pattern: /\b(interposer inspection|metrology|inspection)\b/i,
    reason: 'narrow metrology bottleneck with listed equipment issuers',
  },
]);

const PROVIDER_BLOCKED_GAPS = Object.freeze([
  'taiwan_mops',
  'edinet',
  'tdnet',
  'company_ir_direct_pdf',
]);

const INTERCONNECTION_ISSUER_BRIDGE_CANDIDATES = new Set(['PWR', 'ACM', 'J', 'ETN', 'VRT']);

function providerGapProposalLink({
  providerName = '',
  fillsEvidenceClass = 'issuer_exposure',
  reason = '',
  seedId: seedIdentifier = '',
} = {}) {
  const provider = compact(providerName).toLowerCase().replace(/[^a-z0-9_]+/g, '_') || 'unknown_provider';
  return {
    proposalId: `child-provider-gap:${provider}:${stableHash(`${seedIdentifier}:${fillsEvidenceClass}:${provider}`)}`,
    providerName: provider,
    fillsEvidenceClass,
    status: 'provider_gap_proposal_required',
    reason: reason || `${provider} official route is needed before this child issuer bridge can be accepted.`,
    authRequired: provider.includes('patent') || provider.includes('paid'),
    apiKeyRequired: provider.includes('patent') || provider.includes('paid'),
    rateLimit: { policy: 'provider-specific limit must be fixture-backed before live activation' },
    allowlist: [
      `scripts/_shared/external-data/${provider}.mjs`,
      'scripts/collect-free-external-data.mjs',
      `tests/provider-adapter-${provider}.test.mjs`,
    ],
    parserOutputSchema: {
      type: 'seed_bias_official_evidence',
      requiredFields: ['providerName', 'sourceUrl', 'title', 'publishedAt', 'desiredEvidenceClass', 'evidenceUse', 'promotionEligible'],
    },
    fixtureRequirement: 'positive official filing/IR fixture plus no-result and rate-limit fixtures',
    healthCheckCommand: `node --import tsx scripts/collect-free-external-data.mjs --providers ${provider} --limit 1 --dry-run`,
    testCommand: `node --import tsx --test tests/provider-adapter-${provider}.test.mjs`,
    failureModes: ['provider_unavailable', 'identifier_mapping_missing', 'no_result', 'parser_error', 'acceptance_failed'],
    reviewGatedActivation: true,
    activationAllowed: false,
  };
}

function providerGapRequiredForSeed(childSeed = {}, companyIrStatus = {}) {
  const existing = uniqueStrings(asArray(childSeed.providerGapProposalLinks).map((item) => item.providerName), 20)
    .map((item) => item.replace(/-/g, '_'));
  const issuerSpecific = uniqueStrings(asArray(companyIrStatus.issuerSpecificProviderGap).flatMap((item) => item.providerGap), 20)
    .map((item) => item.replace(/_required$/i, '').replace(/-/g, '_'));
  const directPdfNeeded = asArray(companyIrStatus.missingIssuerDocuments).length ? ['company_ir_direct_pdf'] : [];
  return uniqueStrings([existing, issuerSpecific, directPdfNeeded], 20)
    .filter((provider) => PROVIDER_BLOCKED_GAPS.includes(provider));
}

function affectedIssuersForProvider(providerName = '', childSeed = {}, companyIrStatus = {}) {
  const provider = compact(providerName).replace(/-/g, '_');
  const missing = uniqueStrings(companyIrStatus.missingIssuerDocuments, 20);
  if (provider === 'taiwan_mops') return uniqueStrings(missing.filter((issuer) => ['UNICY', 'NANYF', 'KINSF'].includes(issuer)), 20);
  if (provider === 'company_ir_direct_pdf') return uniqueStrings(missing.length ? missing : childSeed.routeIssuerCandidates || childSeed.issuerCandidates, 20);
  if (provider === 'edinet' || provider === 'tdnet') {
    const byRoute = asArray(childSeed.issuerRoleCandidates)
      .filter((item) => asArray(item.routeProviders).some((route) => compact(route).replace(/-/g, '_') === provider))
      .map((item) => compact(item.symbol || item.issuerName || item.name).toUpperCase());
    return uniqueStrings(byRoute.length ? byRoute : ['IBIDY'], 20);
  }
  return uniqueStrings(childSeed.routeIssuerCandidates || childSeed.issuerCandidates, 20);
}

export function buildProviderBlockedGapArtifacts(childSeed = {}, companyIrStatus = {}) {
  const providerGapRequired = providerGapRequiredForSeed(childSeed, companyIrStatus);
  return providerGapRequired.map((providerName) => {
    const affectedIssuers = affectedIssuersForProvider(providerName, childSeed, companyIrStatus);
    return {
      providerName,
      fillsEvidenceClass: 'issuer_exposure',
      affectedIssuers,
      requiredDocumentTypes: providerName === 'company_ir_direct_pdf'
        ? ['annual_report', 'integrated_report', 'ir_presentation', 'earnings_presentation']
        : ['annual_report', 'integrated_report', 'official_filing', 'financial_results'],
      fixtureRequirement: `${providerName} fixture must include one positive ABF/substrate operating bridge document and one no-result fixture before activation.`,
      parserOutputSchema: {
        type: 'seed_bias_official_document',
        requiredFields: [
          'providerName',
          'issuer',
          'sourceUrl',
          'documentTitle',
          'documentType',
          'publishedAt',
          'extractedTextSnippet',
          'matchedBottleneckTerms',
          'matchedOperatingTerms',
          'proximityMatch',
          'desiredEvidenceClass',
          'evidenceUse',
          'promotionEligible',
        ],
      },
      healthCheckCommand: `node --import tsx scripts/collect-free-external-data.mjs --providers ${providerName} --limit 1 --dry-run`,
      failureModes: ['provider_unavailable', 'issuer_mapping_missing', 'document_not_found', 'parser_error', 'no_proximity_match', 'acceptance_failed'],
      reviewGatedActivation: true,
      activationAllowed: false,
    };
  });
}

export function buildDirectCompanyIrPdfAllowlistProposal(childSeed = {}, companyIrStatus = {}) {
  const missingIssuers = uniqueStrings(companyIrStatus.missingIssuerDocuments || childSeed.routeIssuerCandidates || childSeed.issuerCandidates, 20);
  return {
    proposalId: `direct-company-ir-pdf:${safeId(childSeed.seedId || childSeed.childSeedId)}:${stableHash(missingIssuers.join('|'))}`,
    providerName: 'company_ir_direct_pdf',
    childSeedId: childSeed.seedId || childSeed.childSeedId,
    parentSeedId: childSeed.parentSeedId,
    bottleneckNode: childSeed.bottleneckNode || childSeed.bottleneck?.label,
    status: 'needs_operator_review',
    activationAllowed: false,
    reviewGatedActivation: true,
    scope: 'abf_child_seed_only',
    manualFixtureRequired: true,
    allowlistEntriesDraft: missingIssuers.map((issuer) => ({
      issuer,
      issuerRoleClass: asArray(childSeed.issuerRoleCandidates).find((item) => compact(item.symbol).toUpperCase() === issuer)?.roleClass || 'substrate_capacity_owner',
      sourceUrl: null,
      documentType: 'annual_report_or_ir_presentation_pdf',
      sourceGroup: 'official_company_ir',
      requiredBeforeExecution: ['official URL', 'fixture document', 'parser expected snippet'],
    })),
    fixtureRequirement: 'Manual direct PDF allowlist must include positive and no-result fixtures; no automatic URL activation.',
    parserOutputSchema: {
      type: 'company_ir_direct_pdf_allowlist',
      requiredFields: ['issuer', 'sourceUrl', 'documentTitle', 'documentType', 'fiscalYear', 'sourceGroup'],
    },
  };
}

export function classifyChildProviderBlocked(childResult = {}, childSeed = childResult || {}) {
  const companyIrStatus = childResult.execution?.companyIrCollectorStatus || childResult.companyIrCollectorStatus || {};
  const providerGapRequired = buildProviderBlockedGapArtifacts(childSeed, companyIrStatus);
  const missingIssuerDocuments = uniqueStrings(companyIrStatus.missingIssuerDocuments, 20);
  const issuerCoverageSkew = companyIrStatus.issuerCoverageSkew === true;
  const acceptedEvidenceCount = Number(childResult.acceptedEvidenceCount || 0);
  const hasCompanyIrCoverageRun = companyIrStatus && Object.keys(companyIrStatus).length > 0;
  const providerBlocked = acceptedEvidenceCount === 0
    && hasCompanyIrCoverageRun
    && (issuerCoverageSkew || missingIssuerDocuments.length > 0 || providerGapRequired.length > 0)
    && (childResult.issuerBridgeStatus || 'missing') === 'missing';
  return {
    blockType: providerBlocked ? 'provider_blocked' : childResult.finalBlocker ? 'evidence_blocked' : null,
    providerBlocked,
    reportCandidateAllowed: false,
    excludedFromReportCandidateEvaluation: providerBlocked,
    terminalProviderBlocked: providerBlocked,
    providerGapRequired: providerGapRequired.map((item) => item.providerName),
    providerGapArtifacts: providerGapRequired,
    directCompanyIrPdfAllowlistProposal: providerBlocked
      ? buildDirectCompanyIrPdfAllowlistProposal(childSeed, companyIrStatus)
      : null,
    affectedIssuers: uniqueStrings(providerGapRequired.flatMap((item) => item.affectedIssuers), 40),
    missingIssuerDocuments,
    issuerCoverageSkew,
    selectedIssuerCoverage: companyIrStatus.issuerDocumentCoverage || [],
  };
}

function positivePathSyntheticParent({
  family = 'ai_grid_cloud_infrastructure',
  generatedAt = new Date().toISOString(),
} = {}) {
  if (family === 'defense_space_propulsion') {
    return {
      seedId: 'positive-path-defense-space-propulsion',
      seedTitle: 'positive path validation -> defense/space propulsion qualification bottlenecks',
      theme: { key: 'defense-industrial', label: 'Defense Industrial' },
      growthDriver: 'missile and space propulsion demand requires qualified test capacity',
      realActivity: 'solid rocket motor qualification and production-rate ramp',
      physicalProcess: 'static fire testing, qualification, environmental testing, and range scheduling',
      requiredInputs: ['qualification test stands', 'range slots', 'official issuer evidence'],
      bottleneck: {
        label: 'solid rocket motor qualification test bottlenecks',
        class: 'test_facility_capacity',
        mechanism: 'test facility capacity can delay supplier qualification',
      },
      evidenceQueries: ['solid rocket motor qualification test facility official filing backlog capacity'],
      counterEvidenceQueries: ['solid rocket motor qualification test capacity improving'],
      scores: { knownNarrativeScore: 0.24, seedSimilarityScore: 0.2 },
      metadata: { generatedAt, positivePathValidationParent: true },
      lineage: { source: 'positive_path_validation_pool', sourceIds: ['defense_space_propulsion'], generatedAt },
    };
  }
  if (family === 'advanced_packaging_material_process') {
    return {
      seedId: 'positive-path-advanced-packaging-test',
      seedTitle: 'positive path validation -> advanced packaging test bottlenecks',
      theme: { key: 'semiconductor', label: 'Semiconductor' },
      growthDriver: 'AI accelerator demand requires qualified advanced package test throughput',
      realActivity: 'advanced packaging test and qualification ramp',
      physicalProcess: 'wafer probe, final test, socket qualification, and inspection',
      requiredInputs: ['test sockets', 'probe cards', 'official issuer evidence'],
      bottleneck: {
        label: 'advanced packaging test and inspection bottlenecks',
        class: 'test_facility_capacity',
        mechanism: 'test hardware capacity can delay package qualification',
      },
      evidenceQueries: ['probe card test socket official filing backlog capacity'],
      counterEvidenceQueries: ['probe card test socket capacity improving'],
      scores: { knownNarrativeScore: 0.22, seedSimilarityScore: 0.2 },
      metadata: { generatedAt, positivePathValidationParent: true },
      lineage: { source: 'positive_path_validation_pool', sourceIds: ['advanced_packaging_material_process'], generatedAt },
    };
  }
  return {
    seedId: 'positive-path-ai-grid-interconnection',
    seedTitle: 'positive path validation -> AI/grid interconnection study bottlenecks',
    theme: { key: 'cloud-infrastructure', label: 'Cloud Infrastructure' },
    growthDriver: 'data-center load growth requires utility interconnection studies and grid engineering throughput',
    realActivity: 'large-load data center interconnection and grid upgrade approval',
    physicalProcess: 'load request intake, system impact study, facilities study, substation engineering, and utility approval',
    requiredInputs: ['grid study engineers', 'RTO/ISO study process', 'official issuer evidence'],
    bottleneck: {
      label: 'interconnection study capacity',
      class: 'engineering_process',
      mechanism: 'engineering study capacity can delay large-load data center energization',
    },
    evidenceQueries: ['interconnection study capacity PWR official filing backlog capacity customer demand'],
    counterEvidenceQueries: ['interconnection study capacity improving data center'],
    scores: { knownNarrativeScore: 0.35, seedSimilarityScore: 0.25 },
    metadata: { generatedAt, positivePathValidationParent: true },
    lineage: { source: 'positive_path_validation_pool', sourceIds: ['ai_grid_cloud_infrastructure'], generatedAt },
  };
}

export function buildPositivePathCandidateChildSeeds(options = {}) {
  const generatedAt = options.generatedAt || new Date().toISOString();
  const gridParent = positivePathSyntheticParent({ family: 'ai_grid_cloud_infrastructure', generatedAt });
  const defenseParent = positivePathSyntheticParent({ family: 'defense_space_propulsion', generatedAt });
  const packagingParent = positivePathSyntheticParent({ family: 'advanced_packaging_material_process', generatedAt });
  const specs = [
    AI_POWER_CHILD_SPECS.find((spec) => spec.key === 'interconnection_study_capacity'),
    DEFENSE_SPACE_CHILD_SPECS.find((spec) => spec.key === 'srm_qualification_test_facility'),
    AI_POWER_CHILD_SPECS.find((spec) => spec.key === 'large_transformer_allocation'),
    CHILD_BOTTLENECK_SPECS.find((spec) => spec.key === 'probe_card_test_socket_capacity'),
  ].filter(Boolean);
  const parentsByKey = {
    interconnection_study_capacity: gridParent,
    large_transformer_allocation: gridParent,
    srm_qualification_test_facility: defenseParent,
    probe_card_test_socket_capacity: packagingParent,
  };
  return specs.map((spec) => childSeedFromSpec(parentsByKey[spec.key] || gridParent, spec, {
    generatedAt,
    parentAcceptedEvidenceCount: 0,
    parentIssuerBridgeStatus: 'missing',
    parentNegativeControlStatus: 'INCONCLUSIVE',
    parentHoldoutConfirmed: false,
  })).map((seed) => ({
    ...seed,
    status: 'needs_evidence',
    metadata: {
      ...(seed.metadata || {}),
      positivePathValidationCandidate: true,
      positivePathSelectionPolicy: 'provider_coverage_good_single_child',
    },
  }));
}

function looksLikeInterconnectionProcessSeed(seed = {}) {
  return /\b(interconnection study|system impact study|facilities study|grid study|load request|queue processing)\b/i.test([
    seed.bottleneckNode,
    seed.bottleneck?.label,
    seed.physicalProcess,
    seed.requiredInputs,
    seed.officialTopicTerms,
    seed.metadata?.officialTopicTerms,
  ].flatMap(asArray).join(' '));
}

function hasOperatingIssuerCandidates(seed = {}) {
  return uniqueStrings([
    seed.routeIssuerCandidates,
    seed.issuerCandidates,
    seed.issuerUniverse,
    seed.supplierCategory?.publicIssuerCandidates,
  ], 30).some((ticker) => INTERCONNECTION_ISSUER_BRIDGE_CANDIDATES.has(ticker.toUpperCase()));
}

export function classifySeedRouteMismatch(childResult = {}, childSeed = childResult || {}) {
  const acceptedEvidenceCount = Number(childResult.acceptedEvidenceCount || 0);
  const officialRouteRuns = asArray(childResult.officialRouteRuns || childResult.execution?.officialRouteRuns);
  const officialRouteWeak = officialRouteRuns.some((run) => /WEAK_EVIDENCE|NO_RESULT|ticker-not-found/i.test(compact(run.error || '')));
  const routeMismatchDetected = looksLikeInterconnectionProcessSeed(childSeed)
    && hasOperatingIssuerCandidates(childSeed)
    && acceptedEvidenceCount === 0
    && (officialRouteWeak || childResult.issuerBridgeStatus === 'missing');
  return {
    routeMismatchDetected,
    blockType: routeMismatchDetected ? 'mechanism_issuer_route_mismatch' : null,
    routeMismatchCode: routeMismatchDetected ? 'INTERCONNECTION_PROCESS_SEED_WITH_OPERATING_ISSUER_ROUTE' : null,
    message: routeMismatchDetected
      ? 'interconnection study capacity is a process/mechanism bottleneck; PWR/ACM/J must be evaluated through a separate transmission/substation EPC issuer bridge seed.'
      : '',
    directIssuerRouteAllowed: !routeMismatchDetected,
    nextAction: routeMismatchDetected
      ? 'split into mechanism validation track and issuer bridge track'
      : 'continue current route',
  };
}

export function buildInterconnectionRouteSplitTracks(childSeed = {}, options = {}) {
  const generatedAt = options.generatedAt || new Date().toISOString();
  const parentSeedId = childSeed.seedId || childSeed.childSeedId || 'interconnection-process-seed';
  const mechanismSeedId = `msd-tracka-${stableHash(`${parentSeedId}:mechanism_validation_track`)}`;
  const issuerSeedId = `msd-trackb-${stableHash(`${parentSeedId}:issuer_bridge_track`)}`;
  const mechanismSeed = {
    seedId: mechanismSeedId,
    childSeedId: mechanismSeedId,
    parentSeedId,
    status: 'needs_evidence',
    seedTitle: 'interconnection study capacity -> mechanism validation track',
    theme: childSeed.theme || { key: 'cloud-infrastructure', label: 'Cloud Infrastructure' },
    growthDriver: childSeed.growthDriver || 'data-center load growth requires utility interconnection processing capacity',
    realActivity: childSeed.realActivity || 'large-load interconnection processing',
    physicalProcess: 'interconnection queue intake, system impact study, facilities study, restudy, network upgrade planning, and utility/RTO processing',
    requiredInputs: ['RTO/ISO queue processing', 'utility study engineers', 'network upgrade study capacity', 'official queue datasets'],
    bottleneck: {
      label: 'interconnection study capacity',
      class: 'engineering_process',
      mechanism: 'official grid queues can show study delays, restudies, queue duration, withdrawal rates, and network upgrade timing constraints',
    },
    bottleneckNode: 'interconnection study capacity',
    bottleneckClass: 'engineering_process',
    childClass: 'engineering_process',
    issuerCandidates: [],
    routeIssuerCandidates: [],
    issuerUniverse: [],
    requiredEvidenceClasses: ['grid_interconnection', 'mechanism_validation', 'operating_kpi', 'policy_funding', 'negative_control', 'holdout_validation'],
    expectedEvidenceClasses: ['grid_interconnection', 'mechanism_validation', 'operating_kpi', 'policy_funding', 'negative_control', 'holdout_validation'],
    evidenceQueries: [
      'LBNL interconnection queue study delay duration withdrawal network upgrade',
      'FERC interconnection reform study delay queue backlog network upgrades',
      'PJM MISO CAISO ERCOT SPP interconnection queue report study backlog',
      'utility transmission planning interconnection study delay large load',
    ],
    counterEvidenceQueries: [
      'interconnection queue improving study timelines',
      'FERC queue reform solved interconnection delays',
      'no interconnection study capacity constraint',
    ],
    negativeControlQueries: [
      'no queue delay',
      'interconnection queue improving',
      'study timelines improving',
      'queue reform solved bottleneck',
      'no capacity constraint',
    ],
    holdoutRoutes: ['official_grid_operator', 'official_research_dataset', 'official_government', 'utility_planning'],
    acceptanceCriteria: {
      evidenceClass: 'mechanism_validation',
      requiredTerms: [
        'interconnection queue',
        'study delay',
        'study backlog',
        'processing capacity',
        'queue duration',
        'withdrawal rate',
        'network upgrade delay',
      ],
      bridgeTerms: ['timing', 'capacity', 'cost', 'processing bottleneck', 'delay', 'duration'],
      acceptedSourceGroups: ['official_government', 'official_grid_operator', 'official_research_dataset', 'utility_planning'],
      investmentReadinessAllowed: false,
      issuerBridgeRequiredForInvestmentReadiness: true,
    },
    metadata: {
      routeMismatchSplitTrack: 'mechanism_validation_track',
      allowedSourceRoutes: ['lbnl_interconnection_queue', 'ferc_interconnection_reform', 'iso_rto_queue_reports', 'utility_transmission_planning'],
      generatedAt,
    },
    lineage: { source: 'route_mismatch_split', sourceIds: [parentSeedId], generatedAt },
  };
  const issuerBridgeSeed = {
    seedId: issuerSeedId,
    childSeedId: issuerSeedId,
    parentSeedId,
    status: 'needs_evidence',
    seedTitle: 'interconnection study capacity -> transmission/substation EPC issuer bridge track',
    theme: childSeed.theme || { key: 'cloud-infrastructure', label: 'Cloud Infrastructure' },
    growthDriver: childSeed.growthDriver || 'data-center and utility grid demand requires power delivery project execution capacity',
    realActivity: 'transmission, substation, and power delivery EPC execution',
    physicalProcess: 'engineering, procurement, construction, project execution, utility customer backlog conversion, and substation/transmission delivery',
    requiredInputs: ['power delivery EPC backlog', 'transmission project execution capacity', 'substation construction crews', 'utility customer demand'],
    bottleneck: {
      label: 'transmission and substation EPC backlog',
      class: 'issuer_exposure',
      mechanism: 'issuer filings can bridge grid infrastructure demand to backlog, revenue, margin, guidance, and project execution capacity',
    },
    bottleneckNode: 'transmission and substation EPC backlog',
    bottleneckClass: 'issuer_exposure',
    childClass: 'issuer_bridge',
    issuerCandidates: ['PWR', 'ACM', 'J'],
    routeIssuerCandidates: ['PWR', 'ACM', 'J'],
    issuerUniverse: ['PWR', 'ACM', 'J'],
    issuerRoleCandidates: [
      { symbol: 'PWR', issuerName: 'Quanta Services', roleClass: 'power_delivery_epc_backlog_owner', routeProviders: ['sec-edgar', 'company-ir', 'earnings-transcript'] },
      { symbol: 'ACM', issuerName: 'AECOM', roleClass: 'grid_engineering_backlog_owner', routeProviders: ['sec-edgar', 'company-ir', 'earnings-transcript'] },
      { symbol: 'J', issuerName: 'Jacobs', roleClass: 'grid_engineering_backlog_owner', routeProviders: ['sec-edgar', 'company-ir', 'earnings-transcript'] },
    ],
    issuerRoleClasses: ['power_delivery_epc_backlog_owner', 'grid_engineering_backlog_owner'],
    supplierCategory: {
      label: 'power delivery EPC and grid infrastructure engineering providers',
      publicIssuerCandidates: ['PWR', 'ACM', 'J'],
      privateOnly: false,
    },
    requiredEvidenceClasses: ['issuer_exposure', 'issuer_commentary', 'primary_filing', 'backlog', 'guidance', 'segment_revenue', 'capacity', 'negative_control', 'holdout_validation'],
    expectedEvidenceClasses: ['issuer_exposure', 'issuer_commentary', 'primary_filing', 'backlog', 'guidance', 'segment_revenue', 'capacity', 'negative_control', 'holdout_validation'],
    officialTopicTerms: ['power delivery', 'transmission', 'substation', 'utility infrastructure', 'grid modernization', 'electric infrastructure', 'EPC backlog', 'project execution'],
    evidenceQueries: [
      'PWR power delivery backlog guidance transmission substation official filing',
      'ACM utility infrastructure grid modernization backlog guidance official filing',
      'J transmission substation utility infrastructure project execution official filing',
    ],
    counterEvidenceQueries: [
      'power delivery backlog declining',
      'utility capex slowdown',
      'project delays hurting margin',
      'competition rising grid infrastructure EPC',
      'management denies grid infrastructure demand',
    ],
    negativeControlQueries: [
      'backlog declining',
      'utility capex slowdown',
      'project delays hurting margin',
      'competition rising',
      'no grid infrastructure demand',
      'management denies bottleneck',
    ],
    holdoutRoutes: ['official_company_filing', 'issuer_ir_transcript', 'official_customer_utility_source', 'specialist_trade_media'],
    acceptanceCriteria: {
      evidenceClass: 'issuer_exposure',
      requiredTerms: ['power delivery', 'transmission', 'substation', 'utility infrastructure', 'grid modernization', 'electric infrastructure', 'EPC backlog', 'project execution'],
      bridgeTerms: ['backlog', 'revenue', 'margin', 'guidance', 'capacity', 'customer demand', 'project execution'],
      officialOrTrustedSourceRequired: true,
      rejectTickerOnly: true,
      rejectGenericInfrastructureDescription: true,
      sourceIndependenceRequired: true,
    },
    scores: {
      knownNarrativeScore: 0.32,
      seedSimilarityScore: 0.25,
      childSpecificityScore: 0.9,
    },
    metadata: {
      routeMismatchSplitTrack: 'issuer_bridge_track',
      officialTopicTerms: ['power delivery', 'transmission', 'substation', 'utility infrastructure', 'grid modernization', 'electric infrastructure', 'EPC backlog', 'project execution'],
      officialBridgeTerms: ['backlog', 'revenue', 'margin', 'guidance', 'capacity', 'customer demand', 'project execution'],
      officialNegativeQueries: ['backlog declining', 'utility capex slowdown', 'project delays hurting margin', 'competition rising', 'no grid infrastructure demand', 'management denies bottleneck'],
      generatedAt,
    },
    lineage: { source: 'route_mismatch_split', sourceIds: [parentSeedId], generatedAt },
  };
  return {
    ok: true,
    routeMismatchDetected: true,
    parentSeedId,
    splitReason: 'interconnection process bottleneck needs official grid-source mechanism validation before separate issuer bridge testing',
    mechanismValidationTrack: {
      trackId: `track-a:${mechanismSeedId}`,
      track: 'mechanism_validation_track',
      status: 'pending_official_grid_source_collection',
      investmentReadinessAllowed: false,
      finalBlocker: 'issuer_bridge_required_for_investment_readiness',
      allowedSourceRoutes: mechanismSeed.metadata.allowedSourceRoutes,
      seed: mechanismSeed,
      acceptedEvidenceCount: 0,
    },
    issuerBridgeTrack: {
      trackId: `track-b:${issuerSeedId}`,
      track: 'issuer_bridge_track',
      status: 'pending_issuer_bridge_collection',
      investmentReadinessAllowed: false,
      finalBlocker: 'issuer_bridge_evidence_not_closed',
      allowedSourceRoutes: ['sec-edgar', 'company-ir', 'earnings-transcript', 'official-company-release', 'official-customer-utility-source'],
      seed: issuerBridgeSeed,
      acceptedEvidenceCount: 0,
    },
  };
}

function issuerRoleCandidatesForSpec(spec = {}) {
  if (Array.isArray(spec.issuerRoleCandidates) && spec.issuerRoleCandidates.length) {
    return spec.issuerRoleCandidates.map((item) => ({
      symbol: compact(item.symbol).toUpperCase() || null,
      issuerName: compact(item.issuerName || item.name || item.symbol),
      roleClass: compact(item.roleClass || 'unclear'),
      routeProviders: uniqueStrings(item.routeProviders || ['company-ir'], 8),
      representativeTicker: Boolean(item.representativeTicker),
    }));
  }
  return uniqueStrings(spec.issuerCandidates, 30).map((symbol) => ({
    symbol: symbol.toUpperCase(),
    issuerName: symbol.toUpperCase(),
    roleClass: 'unclear',
    routeProviders: ['sec-edgar', 'company-ir'],
    representativeTicker: REPRESENTATIVE_TICKERS.has(symbol.toUpperCase()),
  }));
}

const CHILD_BOTTLENECK_SPECS = Object.freeze([
  {
    key: 'cowos_packaging_capacity',
    bottleneckNode: 'CoWoS packaging capacity',
    bottleneckClass: 'supplier_capacity',
    mechanism: 'TSMC-style chip-on-wafer-on-substrate capacity constrains AI accelerator package output and allocation.',
    physicalProcess: 'CoWoS wafer-level integration, interposer attach, substrate attach, and final advanced packaging capacity allocation',
    requiredInputs: ['CoWoS capacity', '2.5D packaging lines', 'silicon interposers', 'advanced substrates', 'qualified OSAT capacity'],
    supplierCategory: 'foundry and OSAT advanced packaging suppliers',
    likelyIssuerRoles: ['foundry packaging capacity owner', 'OSAT packaging capacity provider', 'advanced package substrate attach provider'],
    issuerCandidates: ['TSM', 'ASX', 'AMKR'],
    issuerAliases: ['TSMC', 'Taiwan Semiconductor Manufacturing', 'ASE Technology', 'Amkor'],
    officialTopicTerms: ['CoWoS', 'chip-on-wafer-on-substrate', 'advanced packaging', '2.5D packaging', 'interposer', 'packaging capacity'],
    negativeControlQueries: [
      'CoWoS capacity expansion removes bottleneck',
      'CoWoS oversupply risk',
      'alternative CoWoS suppliers',
      'management says no CoWoS bottleneck',
      'CoWoS lead time improving',
    ],
    holdoutRoutes: ['official_company_filing', 'issuer_ir_transcript', 'specialist_trade_media', 'official_industry_data'],
    childKnownNarrativeScore: 0.72,
    childDiversityBucket: 'known_parent_decomposition',
  },
  {
    key: 'abf_substrate_capacity',
    bottleneckNode: 'ABF substrate capacity',
    bottleneckClass: 'material_input',
    mechanism: 'ABF substrate availability constrains high-end CPU/GPU package throughput when qualified substrate lines are tight.',
    physicalProcess: 'ABF substrate build-up layer production, package substrate qualification, and allocation to high-end processors',
    requiredInputs: ['ABF substrates', 'build-up substrate capacity', 'qualified package substrate suppliers'],
    supplierCategory: 'advanced package substrate suppliers',
    likelyIssuerRoles: ['ABF substrate supplier', 'package substrate capacity owner', 'processor substrate supplier'],
    issuerCandidates: ['IBIDY', 'UNICY', 'NANYF', 'KINSF', 'ATASY'],
    issuerAliases: ['Ibiden', 'Unimicron', 'Shinko', 'Nan Ya PCB', 'Kinsus', 'AT&S'],
    issuerRoleCandidates: [
      { issuerName: 'Ajinomoto', roleClass: 'material_input_owner', routeProviders: ['company-ir', 'official-company-release'] },
      { symbol: 'IBIDY', issuerName: 'Ibiden', roleClass: 'substrate_capacity_owner', routeProviders: ['edinet', 'tdnet', 'company-ir'] },
      { symbol: 'UNICY', issuerName: 'Unimicron', roleClass: 'substrate_capacity_owner', routeProviders: ['taiwan_mops', 'company-ir'] },
      { issuerName: 'Shinko Electric Industries', roleClass: 'substrate_capacity_owner', routeProviders: ['edinet', 'tdnet', 'company-ir'] },
      { symbol: 'NANYF', issuerName: 'Nan Ya PCB', roleClass: 'substrate_capacity_owner', routeProviders: ['taiwan_mops', 'company-ir'] },
      { symbol: 'KINSF', issuerName: 'Kinsus', roleClass: 'substrate_capacity_owner', routeProviders: ['taiwan_mops', 'company-ir'] },
      { symbol: 'ATASY', issuerName: 'AT&S', roleClass: 'substrate_capacity_owner', routeProviders: ['company-ir'] },
      { symbol: 'ASX', issuerName: 'ASE Technology', roleClass: 'osat_packaging_capacity', routeProviders: ['sec-edgar', 'company-ir'] },
      { symbol: 'AMKR', issuerName: 'Amkor', roleClass: 'osat_packaging_capacity', routeProviders: ['sec-edgar', 'company-ir'] },
      { symbol: 'AMD', issuerName: 'AMD', roleClass: 'customer_pass_through', routeProviders: ['sec-edgar', 'company-ir'], representativeTicker: true },
      { symbol: 'NVDA', issuerName: 'NVIDIA', roleClass: 'customer_pass_through', routeProviders: ['sec-edgar', 'company-ir'], representativeTicker: true },
    ],
    officialRouteProviderGaps: ['edinet', 'tdnet', 'taiwan_mops', 'company-ir'],
    officialTopicTerms: ['ABF', 'Ajinomoto build-up film', 'package substrate', 'substrate capacity', 'build-up substrate', 'advanced substrate'],
    negativeControlQueries: [
      'ABF substrate supply improving',
      'ABF substrate oversupply',
      'ABF substrate alternative suppliers',
      'management says no ABF substrate bottleneck',
      'ABF substrate lead time improving',
    ],
    holdoutRoutes: ['official_company_filing', 'issuer_ir_transcript', 'specialist_trade_media', 'official_industry_data'],
    childKnownNarrativeScore: 0.58,
    childDiversityBucket: 'material_input',
  },
  {
    key: 'hbm_integration_packaging_capacity',
    bottleneckNode: 'HBM integration / packaging capacity',
    bottleneckClass: 'technical_qualification',
    mechanism: 'HBM stack integration, qualification, and advanced package assembly can limit AI accelerator supply even when wafer starts are available.',
    physicalProcess: 'HBM stack qualification, logic-die integration, advanced package assembly, thermal/mechanical validation, and customer qualification',
    requiredInputs: ['HBM stacks', 'qualified HBM integration process', 'advanced packaging capacity', 'thermal/mechanical validation capacity'],
    supplierCategory: 'HBM memory and advanced integration suppliers',
    likelyIssuerRoles: ['HBM memory supplier', 'foundry integration partner', 'AI accelerator customer with package allocation exposure'],
    issuerCandidates: ['MU', 'TSM', 'NVDA', 'AMD'],
    issuerAliases: ['Micron', 'TSMC', 'NVIDIA', 'AMD', 'SK Hynix', 'Samsung'],
    officialTopicTerms: ['HBM', 'high bandwidth memory', 'advanced packaging', 'CoWoS', 'integrated package', 'memory stack'],
    negativeControlQueries: [
      'HBM packaging capacity no constraint',
      'HBM supply improving',
      'HBM oversupply risk',
      'alternative HBM suppliers',
      'management denies HBM packaging bottleneck',
    ],
    holdoutRoutes: ['official_company_filing', 'issuer_ir_transcript', 'specialist_trade_media', 'official_industry_data'],
    childKnownNarrativeScore: 0.68,
    childDiversityBucket: 'technical_qualification',
  },
  {
    key: 'underfill_mold_compound_supply',
    bottleneckNode: 'underfill and mold compound material capacity',
    bottleneckClass: 'material_input',
    mechanism: 'Underfill and mold compound availability can constrain advanced package reliability and ramp even when headline CoWoS capacity expands.',
    physicalProcess: 'underfill dispense, mold compound material qualification, package reliability validation, and supplier allocation',
    requiredInputs: ['underfill materials', 'mold compound', 'qualified encapsulation materials', 'reliability test capacity'],
    supplierCategory: 'semiconductor packaging material suppliers',
    likelyIssuerRoles: ['packaging material supplier', 'qualified underfill supplier', 'mold compound supplier'],
    issuerCandidates: ['HENKY', 'SHWDF', 'REXXF'],
    issuerAliases: ['Henkel', 'Showa Denko Materials', 'Resonac', 'Namics'],
    officialTopicTerms: ['underfill', 'mold compound', 'encapsulation', 'advanced packaging materials', 'package reliability'],
    negativeControlQueries: [
      'underfill supply improving advanced packaging',
      'mold compound oversupply advanced packaging',
      'alternative underfill suppliers',
      'management says no underfill bottleneck',
      'package material lead time improving',
    ],
    holdoutRoutes: ['official_company_filing', 'issuer_ir_transcript', 'specialist_trade_media', 'official_industry_data'],
    childKnownNarrativeScore: 0.28,
    childDiversityBucket: 'material_input',
  },
  {
    key: 'probe_card_test_socket_capacity',
    bottleneckNode: 'probe card and test socket capacity for HBM and accelerators',
    bottleneckClass: 'test_facility_capacity',
    mechanism: 'Probe cards and high-performance test sockets can limit wafer probe, final test, and qualification throughput for AI accelerators and HBM packages.',
    physicalProcess: 'probe card design, socket qualification, wafer probing, final test, and burn-in hardware allocation',
    requiredInputs: ['probe cards', 'test sockets', 'burn-in boards', 'test handlers', 'qualified test hardware'],
    supplierCategory: 'probe card, test socket, and semiconductor test interface suppliers',
    likelyIssuerRoles: ['probe card supplier', 'test socket supplier', 'semiconductor test interface supplier'],
    issuerCandidates: ['FELE', 'ONTO', 'TER'],
    issuerAliases: ['FormFactor', 'Onto Innovation', 'Teradyne', 'Yamaichi', 'ISC'],
    officialTopicTerms: ['probe card', 'test socket', 'wafer probe', 'burn-in', 'test interface', 'advanced packaging test'],
    negativeControlQueries: [
      'probe card capacity expansion HBM',
      'test socket supply improving AI accelerators',
      'probe card lead time improving',
      'alternative probe card suppliers',
      'management says no test socket bottleneck',
    ],
    holdoutRoutes: ['official_company_filing', 'issuer_ir_transcript', 'specialist_trade_media', 'official_industry_data'],
    childKnownNarrativeScore: 0.22,
    childDiversityBucket: 'test_bottleneck',
  },
  {
    key: 'temporary_bonding_debonding_throughput',
    bottleneckNode: 'temporary bonding and debonding throughput',
    bottleneckClass: 'engineering_process',
    mechanism: 'Temporary bonding and debonding throughput can become a process step constraint for thin wafer handling and 2.5D/3D advanced package flows.',
    physicalProcess: 'temporary bonding, carrier wafer handling, debonding, cleaning, yield stabilization, and process qualification',
    requiredInputs: ['temporary bonding tools', 'debonding tools', 'carrier wafers', 'process engineers', 'qualified adhesives'],
    supplierCategory: 'temporary bonding, debonding, and wafer handling equipment suppliers',
    likelyIssuerRoles: ['bonding equipment supplier', 'wafer handling equipment supplier', 'advanced packaging process tool supplier'],
    issuerCandidates: ['EVGPF', 'AMAT', 'TOELF'],
    issuerAliases: ['EV Group', 'Applied Materials', 'Tokyo Electron', 'SUSS MicroTec'],
    officialTopicTerms: ['temporary bonding', 'debonding', 'hybrid bonding', 'wafer handling', 'advanced packaging process'],
    negativeControlQueries: [
      'temporary bonding capacity improving',
      'debonding tool lead time improving',
      'alternative bonding equipment suppliers',
      'management says no bonding bottleneck',
      'advanced packaging bonding throughput no constraint',
    ],
    holdoutRoutes: ['official_company_filing', 'issuer_ir_transcript', 'specialist_trade_media', 'official_industry_data'],
    childKnownNarrativeScore: 0.24,
    childDiversityBucket: 'engineering_process',
  },
  {
    key: 'interposer_inspection_metrology_bottleneck',
    bottleneckNode: 'silicon interposer inspection and metrology bottleneck',
    bottleneckClass: 'technical_qualification',
    mechanism: 'Inspection and metrology capacity for interposers and advanced substrates can constrain yield learning and qualified package ramp.',
    physicalProcess: 'interposer inspection, overlay/metrology, defect review, warpage measurement, and yield qualification',
    requiredInputs: ['inspection tools', 'metrology tools', 'defect review capacity', 'warpage measurement', 'qualified process recipes'],
    supplierCategory: 'semiconductor inspection and metrology suppliers',
    likelyIssuerRoles: ['inspection equipment supplier', 'metrology supplier', 'process control supplier'],
    issuerCandidates: ['KLAC', 'ONTO', 'ASML'],
    issuerAliases: ['KLA', 'Onto Innovation', 'ASML', 'Nova'],
    officialTopicTerms: ['interposer inspection', 'metrology', 'defect review', 'warpage', 'process control', 'advanced packaging inspection'],
    negativeControlQueries: [
      'interposer inspection capacity improving',
      'metrology lead time improving advanced packaging',
      'alternative inspection suppliers',
      'management says no metrology bottleneck',
      'advanced packaging inspection no constraint',
    ],
    holdoutRoutes: ['official_company_filing', 'issuer_ir_transcript', 'specialist_trade_media', 'official_industry_data'],
    childKnownNarrativeScore: 0.25,
    childDiversityBucket: 'metrology',
  },
  {
    key: 'substrate_warpage_control_process',
    bottleneckNode: 'substrate warpage control process bottleneck',
    bottleneckClass: 'engineering_process',
    mechanism: 'Warpage control can limit advanced substrate yield, customer qualification, and package reliability when package size and thermal density rise.',
    physicalProcess: 'substrate warpage measurement, process tuning, reliability qualification, and customer-specific package yield learning',
    requiredInputs: ['warpage control process', 'substrate process engineers', 'reliability test capacity', 'metrology recipes'],
    supplierCategory: 'advanced substrate process and metrology suppliers',
    likelyIssuerRoles: ['advanced substrate supplier', 'metrology supplier', 'OSAT process owner'],
    issuerCandidates: ['ASX', 'AMKR', 'UNICY'],
    issuerAliases: ['ASE Technology', 'Amkor', 'Unimicron', 'Ibiden'],
    officialTopicTerms: ['warpage', 'substrate yield', 'package reliability', 'advanced substrate', 'customer qualification'],
    negativeControlQueries: [
      'substrate warpage improving',
      'warpage control no bottleneck advanced packaging',
      'alternative substrate process suppliers',
      'management says no warpage bottleneck',
      'advanced substrate yield improving',
    ],
    holdoutRoutes: ['official_company_filing', 'issuer_ir_transcript', 'specialist_trade_media', 'official_industry_data'],
    childKnownNarrativeScore: 0.18,
    childDiversityBucket: 'engineering_process',
  },
  {
    key: 'silicon_interposer_advanced_substrate_material_capacity',
    bottleneckNode: 'silicon interposer / advanced substrate material capacity',
    bottleneckClass: 'material_input',
    mechanism: 'Silicon interposer and advanced substrate material capacity can become the physical input constraint for 2.5D AI accelerator packages.',
    physicalProcess: 'silicon interposer fabrication, redistribution layer processing, substrate material preparation, and package material qualification',
    requiredInputs: ['silicon interposers', 'RDL processing capacity', 'advanced substrate materials', 'qualified packaging materials'],
    supplierCategory: 'interposer, substrate material, and advanced packaging material suppliers',
    likelyIssuerRoles: ['foundry interposer supplier', 'substrate material supplier', 'advanced packaging material supplier'],
    issuerCandidates: ['TSM', 'ASX', 'AMKR', 'UCTT'],
    issuerAliases: ['TSMC', 'ASE Technology', 'Amkor', 'Ultra Clean', 'silicon interposer suppliers'],
    officialTopicTerms: ['silicon interposer', 'interposer', 'RDL', 'redistribution layer', 'advanced substrate', 'packaging material'],
    negativeControlQueries: [
      'silicon interposer capacity expansion',
      'interposer supply improving',
      'advanced substrate material oversupply',
      'alternative interposer suppliers',
      'management says no interposer bottleneck',
    ],
    holdoutRoutes: ['official_company_filing', 'issuer_ir_transcript', 'specialist_trade_media', 'official_industry_data'],
    childKnownNarrativeScore: 0.45,
    childDiversityBucket: 'material_input',
  },
  {
    key: 'advanced_packaging_test_bonding_inspection_equipment_capacity',
    bottleneckNode: 'advanced packaging test / bonding / inspection equipment capacity',
    bottleneckClass: 'test_facility_capacity',
    mechanism: 'Thermo-compression bonding, wafer probing, final test, and inspection tool capacity can limit package ramp and qualification throughput.',
    physicalProcess: 'bonding, wafer probe, final test, metrology, inspection, and package qualification equipment throughput',
    requiredInputs: ['bonding tools', 'wafer probe capacity', 'final test capacity', 'inspection/metrology tools', 'qualified test handlers'],
    supplierCategory: 'semiconductor test, bonding, inspection, and packaging equipment suppliers',
    likelyIssuerRoles: ['test equipment supplier', 'inspection/metrology supplier', 'advanced packaging tool supplier'],
    issuerCandidates: ['TER', 'KLAC', 'AMAT', 'ASML', 'AEIS'],
    issuerAliases: ['Teradyne', 'KLA', 'Applied Materials', 'ASML', 'Advantest', 'Tokyo Electron', 'Disco'],
    officialTopicTerms: ['advanced packaging', 'bonding', 'hybrid bonding', 'thermo-compression', 'wafer probe', 'final test', 'inspection', 'metrology'],
    negativeControlQueries: [
      'advanced packaging bonding tool capacity expansion',
      'wafer probe final test capacity no constraint',
      'advanced packaging inspection equipment lead time improving',
      'alternative bonding equipment suppliers',
      'management denies advanced packaging equipment bottleneck',
    ],
    holdoutRoutes: ['official_company_filing', 'issuer_ir_transcript', 'specialist_trade_media', 'official_industry_data'],
    childKnownNarrativeScore: 0.42,
    childDiversityBucket: 'test_bottleneck',
  },
]);

const AI_POWER_CHILD_SPECS = Object.freeze([
  {
    key: 'interconnection_study_capacity',
    bottleneckNode: 'interconnection study capacity',
    bottleneckClass: 'engineering_process',
    mechanism: 'Data-center load growth can be delayed by utility/RTO study queues and specialist engineering throughput.',
    physicalProcess: 'load request intake, system impact study, facilities study, restudy, and interconnection approval',
    requiredInputs: ['grid study engineers', 'utility queue capacity', 'RTO/ISO study process', 'load interconnection data'],
    supplierCategory: 'grid engineering, utility interconnection, and power consulting providers',
    likelyIssuerRoles: ['power engineering consultant', 'utility contractor', 'grid interconnection services provider'],
    issuerCandidates: ['ACM', 'J', 'PWR'],
    issuerAliases: ['AECOM', 'Jacobs', 'Quanta Services'],
    officialTopicTerms: ['interconnection study', 'system impact study', 'facilities study', 'grid study', 'load request'],
    negativeControlQueries: ['interconnection queue improving data center', 'no interconnection study bottleneck', 'utility study cycle time improving'],
    holdoutRoutes: ['official_industry_or_government', 'official_company_filing', 'issuer_ir_transcript', 'specialist_trade_media'],
    childKnownNarrativeScore: 0.35,
    childDiversityBucket: 'engineering_process',
  },
  {
    key: 'protection_relay_lead_time',
    bottleneckNode: 'protection relay lead time',
    bottleneckClass: 'technical_qualification',
    mechanism: 'Protection relay specification and qualification can delay substation energization for large load interconnections.',
    physicalProcess: 'relay specification, protection settings approval, utility acceptance testing, and panel integration',
    requiredInputs: ['protection relays', 'settings engineers', 'substation panels', 'utility acceptance tests'],
    supplierCategory: 'protection relay and substation automation suppliers',
    likelyIssuerRoles: ['relay supplier', 'automation integrator', 'substation equipment supplier'],
    issuerCandidates: ['ETN', 'ABBNY', 'SBGSY'],
    issuerAliases: ['Eaton', 'ABB', 'Schneider Electric', 'SEL'],
    officialTopicTerms: ['protection relay', 'relay settings', 'substation automation', 'protection control'],
    negativeControlQueries: ['protection relay lead time improving', 'substation automation capacity no constraint', 'alternative relay suppliers'],
    holdoutRoutes: ['official_industry_or_government', 'official_company_filing', 'issuer_ir_transcript', 'specialist_trade_media'],
    childKnownNarrativeScore: 0.25,
    childDiversityBucket: 'technical_qualification',
  },
  {
    key: 'substation_automation_engineering_capacity',
    bottleneckNode: 'substation automation engineering capacity',
    bottleneckClass: 'engineering_process',
    mechanism: 'Automation and control engineering capacity can delay substation integration even after equipment is procured.',
    physicalProcess: 'SCADA integration, control panel design, factory acceptance testing, site commissioning, and utility cutover',
    requiredInputs: ['SCADA engineers', 'automation panels', 'commissioning crews', 'factory acceptance testing'],
    supplierCategory: 'substation automation integrators and power engineering firms',
    likelyIssuerRoles: ['automation integrator', 'engineering contractor', 'substation controls supplier'],
    issuerCandidates: ['J', 'ACM', 'ETN'],
    issuerAliases: ['Jacobs', 'AECOM', 'Eaton', 'Schweitzer Engineering Laboratories'],
    officialTopicTerms: ['substation automation', 'SCADA integration', 'commissioning', 'control systems', 'factory acceptance testing'],
    negativeControlQueries: ['substation automation capacity improving', 'SCADA integration no bottleneck', 'commissioning lead time improving'],
    holdoutRoutes: ['official_industry_or_government', 'official_company_filing', 'issuer_ir_transcript', 'specialist_trade_media'],
    childKnownNarrativeScore: 0.22,
    childDiversityBucket: 'engineering_process',
  },
  {
    key: 'large_transformer_allocation',
    bottleneckNode: 'large transformer and switchgear allocation',
    bottleneckClass: 'supplier_capacity',
    mechanism: 'Large transformer and switchgear allocation can delay data-center energization despite cloud capex demand.',
    physicalProcess: 'transformer manufacturing, switchgear assembly, factory testing, delivery allocation, and site energization',
    requiredInputs: ['large power transformers', 'switchgear', 'factory test slots', 'electrical steel'],
    supplierCategory: 'transformer, switchgear, and grid equipment manufacturers',
    likelyIssuerRoles: ['transformer supplier', 'switchgear supplier', 'electrical equipment supplier'],
    issuerCandidates: ['ETN', 'SBGSY', 'GEV'],
    issuerAliases: ['Eaton', 'Schneider Electric', 'GE Vernova', 'Hitachi Energy'],
    officialTopicTerms: ['large transformer', 'switchgear', 'electrical equipment backlog', 'allocation', 'factory test'],
    negativeControlQueries: ['large transformer lead time improving', 'switchgear supply improving', 'alternative transformer suppliers'],
    holdoutRoutes: ['official_industry_or_government', 'official_company_filing', 'issuer_ir_transcript', 'specialist_trade_media'],
    childKnownNarrativeScore: 0.46,
    childDiversityBucket: 'supplier_capacity',
  },
  {
    key: 'grid_permitting_queue_processing',
    bottleneckNode: 'grid permitting queue processing capacity',
    bottleneckClass: 'permitting_regulatory',
    mechanism: 'Permitting and utility approval queue processing can be the administrative constraint on large-load data-center projects.',
    physicalProcess: 'site permitting, utility approval, environmental review, queue processing, and municipal/agency coordination',
    requiredInputs: ['permitting staff', 'utility approval process', 'environmental review capacity', 'local authority records'],
    supplierCategory: 'permitting consultants, utilities, and grid planning authorities',
    likelyIssuerRoles: ['engineering consultant', 'utility planning provider', 'permitting consultant'],
    issuerCandidates: ['ACM', 'J'],
    issuerAliases: ['AECOM', 'Jacobs'],
    officialTopicTerms: ['permitting queue', 'utility approval', 'environmental review', 'large load interconnection', 'queue processing'],
    negativeControlQueries: ['data center permitting queue improving', 'utility approval no bottleneck', 'permitting staff capacity improving'],
    holdoutRoutes: ['official_industry_or_government', 'official_company_filing', 'issuer_ir_transcript', 'specialist_trade_media'],
    childKnownNarrativeScore: 0.21,
    childDiversityBucket: 'permitting_regulatory',
  },
]);

const DEFENSE_SPACE_CHILD_SPECS = Object.freeze([
  {
    key: 'energetic_binder_supplier_capacity',
    bottleneckNode: 'energetic binder qualified supplier capacity',
    bottleneckClass: 'material_input',
    mechanism: 'Qualified energetic binder supply can constrain solid rocket motor production even when prime demand is funded.',
    physicalProcess: 'energetic binder synthesis, qualification, lot acceptance, motor grain production, and supplier certification',
    requiredInputs: ['energetic binders', 'qualified chemical suppliers', 'lot acceptance testing'],
    supplierCategory: 'energetic material and specialty chemical suppliers',
    likelyIssuerRoles: ['energetic material supplier', 'specialty chemical supplier', 'qualified defense input supplier'],
    issuerCandidates: ['LHX', 'NOC'],
    issuerAliases: ['L3Harris', 'Northrop Grumman', 'Aerojet Rocketdyne'],
    issuerRoleCandidates: [
      { symbol: 'LHX', issuerName: 'L3Harris / Aerojet Rocketdyne', roleClass: 'solid_rocket_motor_supplier_exposure', routeProviders: ['sec-edgar', 'company-ir'] },
      { symbol: 'NOC', issuerName: 'Northrop Grumman', roleClass: 'solid_rocket_motor_supplier_exposure', routeProviders: ['sec-edgar', 'company-ir'] },
    ],
    officialTopicTerms: ['energetic binder', 'solid rocket motor', 'propellant', 'qualified supplier', 'energetic material'],
    negativeControlQueries: ['energetic binder supply improving', 'alternative energetic binder suppliers', 'no propellant bottleneck'],
    holdoutRoutes: ['official_industry_or_government', 'official_company_filing', 'issuer_ir_transcript', 'specialist_trade_media'],
    childKnownNarrativeScore: 0.28,
    childDiversityBucket: 'material_input',
  },
  {
    key: 'rocket_motor_composite_case_capacity',
    bottleneckNode: 'rocket motor casing composite capacity',
    bottleneckClass: 'supplier_capacity',
    mechanism: 'Composite motor case fabrication can become a production-rate constraint for missile and space propulsion ramps.',
    physicalProcess: 'carbon composite case winding, curing, NDI inspection, proof testing, and motor integration',
    requiredInputs: ['carbon composite cases', 'filament winding capacity', 'curing autoclaves', 'NDI inspection'],
    supplierCategory: 'composite motor case and propulsion structure suppliers',
    likelyIssuerRoles: ['composite case supplier', 'propulsion structure supplier', 'missile motor prime'],
    issuerCandidates: ['NOC', 'LHX'],
    issuerAliases: ['Northrop Grumman', 'L3Harris', 'Aerojet Rocketdyne'],
    issuerRoleCandidates: [
      { symbol: 'NOC', issuerName: 'Northrop Grumman', roleClass: 'propulsion_structure_supplier', routeProviders: ['sec-edgar', 'company-ir'] },
      { symbol: 'LHX', issuerName: 'L3Harris / Aerojet Rocketdyne', roleClass: 'solid_rocket_motor_supplier_exposure', routeProviders: ['sec-edgar', 'company-ir'] },
    ],
    officialTopicTerms: ['motor case', 'composite case', 'filament winding', 'solid rocket motor', 'propulsion structure'],
    negativeControlQueries: ['rocket motor case capacity expansion', 'composite motor case no bottleneck', 'alternative motor case suppliers'],
    holdoutRoutes: ['official_industry_or_government', 'official_company_filing', 'issuer_ir_transcript', 'specialist_trade_media'],
    childKnownNarrativeScore: 0.22,
    childDiversityBucket: 'supplier_capacity',
  },
  {
    key: 'srm_qualification_test_facility',
    bottleneckNode: 'solid rocket motor qualification test facility capacity',
    bottleneckClass: 'test_facility_capacity',
    mechanism: 'Qualification test stand and range capacity can delay new motor suppliers and production-rate increases.',
    physicalProcess: 'static fire testing, lot qualification, environmental testing, range scheduling, and test data review',
    requiredInputs: ['static fire test stands', 'qualification range slots', 'environmental test capacity'],
    supplierCategory: 'propulsion test facilities and qualified motor suppliers',
    likelyIssuerRoles: ['propulsion test facility operator', 'motor supplier', 'defense range support provider'],
    issuerCandidates: ['NOC', 'LHX', 'TXT'],
    issuerAliases: ['Northrop Grumman', 'L3Harris', 'Textron', 'Aerojet Rocketdyne'],
    issuerRoleCandidates: [
      { symbol: 'NOC', issuerName: 'Northrop Grumman', roleClass: 'propulsion_test_facility_operator', routeProviders: ['sec-edgar', 'company-ir'] },
      { symbol: 'LHX', issuerName: 'L3Harris / Aerojet Rocketdyne', roleClass: 'solid_rocket_motor_test_capacity_owner', routeProviders: ['sec-edgar', 'company-ir'] },
      { symbol: 'TXT', issuerName: 'Textron', roleClass: 'defense_range_support_provider', routeProviders: ['sec-edgar', 'company-ir'] },
    ],
    officialTopicTerms: ['static fire', 'qualification test', 'solid rocket motor', 'test facility', 'propulsion test'],
    negativeControlQueries: ['solid rocket motor test capacity improving', 'qualification test facility no bottleneck', 'alternative test facilities'],
    holdoutRoutes: ['official_industry_or_government', 'official_company_filing', 'issuer_ir_transcript', 'specialist_trade_media'],
    childKnownNarrativeScore: 0.24,
    childDiversityBucket: 'test_bottleneck',
  },
  {
    key: 'ammonium_perchlorate_supply',
    bottleneckNode: 'ammonium perchlorate supply',
    bottleneckClass: 'material_input',
    mechanism: 'Ammonium perchlorate availability can constrain solid rocket motor propellant throughput if qualified supply is concentrated.',
    physicalProcess: 'oxidizer production, particle size control, propellant mixing, qualification, and lot acceptance',
    requiredInputs: ['ammonium perchlorate', 'oxidizer production', 'qualified propellant inputs'],
    supplierCategory: 'propellant oxidizer and energetic input suppliers',
    likelyIssuerRoles: ['propellant input supplier', 'solid rocket motor supplier'],
    issuerCandidates: ['LHX', 'NOC'],
    issuerAliases: ['L3Harris', 'Northrop Grumman'],
    issuerRoleCandidates: [
      { symbol: 'LHX', issuerName: 'L3Harris / Aerojet Rocketdyne', roleClass: 'solid_rocket_motor_supplier_exposure', routeProviders: ['sec-edgar', 'company-ir'] },
      { symbol: 'NOC', issuerName: 'Northrop Grumman', roleClass: 'solid_rocket_motor_supplier_exposure', routeProviders: ['sec-edgar', 'company-ir'] },
    ],
    officialTopicTerms: ['ammonium perchlorate', 'oxidizer', 'propellant', 'solid rocket motor', 'energetic material'],
    negativeControlQueries: ['ammonium perchlorate supply improving', 'alternative propellant oxidizer suppliers', 'no ammonium perchlorate bottleneck'],
    holdoutRoutes: ['official_industry_or_government', 'official_company_filing', 'issuer_ir_transcript', 'specialist_trade_media'],
    childKnownNarrativeScore: 0.2,
    childDiversityBucket: 'material_input',
  },
]);

const CRYOGENIC_CHILD_SPECS = Object.freeze([
  {
    key: 'helium_supply_recovery_capacity',
    bottleneckNode: 'helium supply and recovery capacity',
    bottleneckClass: 'material_input',
    mechanism: 'Helium supply and recovery capacity can constrain space, fusion, and quantum cryogenic operations.',
    physicalProcess: 'helium sourcing, purification, recovery, storage, and cryogenic system refill logistics',
    requiredInputs: ['helium', 'recovery systems', 'cryogenic storage', 'purification capacity'],
    supplierCategory: 'industrial gas and helium recovery suppliers',
    likelyIssuerRoles: ['industrial gas supplier', 'helium recovery equipment supplier'],
    issuerCandidates: ['LIN', 'APD'],
    issuerAliases: ['Linde', 'Air Products'],
    officialTopicTerms: ['helium', 'helium recovery', 'cryogenic gas', 'industrial gas', 'supply capacity'],
    negativeControlQueries: ['helium supply improving', 'helium recovery capacity expansion', 'alternative helium suppliers'],
    holdoutRoutes: ['official_industry_or_government', 'official_company_filing', 'issuer_ir_transcript', 'specialist_trade_media'],
    childKnownNarrativeScore: 0.2,
    childDiversityBucket: 'material_input',
  },
  {
    key: 'cryogenic_valve_pump_qualification',
    bottleneckNode: 'cryogenic valve and pump qualification',
    bottleneckClass: 'technical_qualification',
    mechanism: 'Qualified cryogenic valves and pumps can delay launch, fusion, and quantum hardware buildout.',
    physicalProcess: 'cryogenic valve manufacturing, pump qualification, leak testing, thermal cycling, and supplier certification',
    requiredInputs: ['cryogenic valves', 'cryogenic pumps', 'leak test capacity', 'qualified suppliers'],
    supplierCategory: 'cryogenic valve, pump, and fluid control suppliers',
    likelyIssuerRoles: ['cryogenic component supplier', 'fluid control supplier'],
    issuerCandidates: ['XYL', 'PH'],
    issuerAliases: ['Xylem', 'Parker-Hannifin'],
    officialTopicTerms: ['cryogenic valve', 'cryogenic pump', 'qualification', 'thermal cycling', 'fluid control'],
    negativeControlQueries: ['cryogenic valve lead time improving', 'cryogenic pump capacity no constraint', 'alternative cryogenic valve suppliers'],
    holdoutRoutes: ['official_industry_or_government', 'official_company_filing', 'issuer_ir_transcript', 'specialist_trade_media'],
    childKnownNarrativeScore: 0.18,
    childDiversityBucket: 'technical_qualification',
  },
  {
    key: 'vacuum_chamber_high_vacuum_lead_time',
    bottleneckNode: 'vacuum chamber and high-vacuum equipment lead time',
    bottleneckClass: 'supplier_capacity',
    mechanism: 'High-vacuum equipment and chamber lead times can constrain fusion, quantum, and space hardware test capacity.',
    physicalProcess: 'vacuum chamber fabrication, pump integration, leak testing, bakeout, and acceptance testing',
    requiredInputs: ['vacuum chambers', 'high-vacuum pumps', 'leak testing', 'bakeout capacity'],
    supplierCategory: 'vacuum chamber and high-vacuum equipment suppliers',
    likelyIssuerRoles: ['vacuum equipment supplier', 'precision chamber fabricator'],
    issuerCandidates: ['ATLKY', 'AALBF'],
    issuerAliases: ['Atlas Copco', 'Pfeiffer Vacuum', 'Agilent'],
    officialTopicTerms: ['vacuum chamber', 'high vacuum', 'leak testing', 'vacuum pump', 'bakeout'],
    negativeControlQueries: ['vacuum chamber lead time improving', 'high vacuum equipment no bottleneck', 'alternative vacuum chamber suppliers'],
    holdoutRoutes: ['official_industry_or_government', 'official_company_filing', 'issuer_ir_transcript', 'specialist_trade_media'],
    childKnownNarrativeScore: 0.18,
    childDiversityBucket: 'supplier_capacity',
  },
]);

function suppressedRepresentativeTickers(values = []) {
  return uniqueStrings(values, 30)
    .map((ticker) => ticker.toUpperCase())
    .filter((ticker) => REPRESENTATIVE_TICKERS.has(ticker));
}

function nonRepresentativeIssuers(values = []) {
  return uniqueStrings(values, 30)
    .map((ticker) => ticker.toUpperCase())
    .filter((ticker) => !REPRESENTATIVE_TICKERS.has(ticker));
}

const REQUIRED_EVIDENCE_CLASSES = Object.freeze([
  'issuer_exposure',
  'holdout_validation',
  'negative_control',
  'market_validation',
  'technical_qualification',
]);

function parentLooksLikeAdvancedPackaging(seed = {}) {
  const text = parentText(seed);
  return /\b(advanced packaging|substrate|cowos|interposer|hbm|package substrate)\b/i.test(text);
}

function specsForParent(seed = {}) {
  const text = parentText(seed);
  if (parentLooksLikeAdvancedPackaging(seed)) return { family: 'advanced_packaging_material_process', specs: CHILD_BOTTLENECK_SPECS };
  if (/\b(ai|data center|cloud|grid|power|interconnection|substation|transformer|switchgear|load growth)\b/i.test(text)) {
    return { family: 'ai_grid_cloud_infrastructure', specs: AI_POWER_CHILD_SPECS };
  }
  if (/\b(defense|missile|solid rocket motor|srm|propulsion|munition|interceptor|energetic|ammonium perchlorate)\b/i.test(text)) {
    return { family: 'defense_space_propulsion', specs: DEFENSE_SPACE_CHILD_SPECS };
  }
  if (/\b(fusion|quantum|cryogenic|helium|vacuum|lox|lh2|superconducting)\b/i.test(text)) {
    return { family: 'space_fusion_quantum_cryogenic', specs: CRYOGENIC_CHILD_SPECS };
  }
  return { family: 'unmatched', specs: [] };
}

function childSeedFromSpec(parentSeed = {}, spec = {}, options = {}) {
  const parentSeedId = seedId(parentSeed) || 'parent-seed';
  const childSeedId = `msd-child-${stableHash(`${parentSeedId}:${spec.key}`)}`;
  const generatedAt = options.generatedAt || new Date().toISOString();
  const routeIssuerCandidates = uniqueStrings(spec.issuerCandidates, 20);
  const suppressedTickers = suppressedRepresentativeTickers(routeIssuerCandidates);
  const publicIssuerCandidates = nonRepresentativeIssuers(routeIssuerCandidates);
  const issuerRoleCandidates = issuerRoleCandidatesForSpec(spec);
  const issuerRoleClasses = uniqueStrings(issuerRoleCandidates.map((item) => item.roleClass), 20);
  const providerGapProposalLinks = uniqueStrings(spec.officialRouteProviderGaps, 20)
    .map((providerName) => providerGapProposalLink({
      providerName,
      fillsEvidenceClass: 'issuer_exposure',
      seedId: childSeedId,
      reason: `${providerName} official filings/disclosures are needed for ${spec.bottleneckNode} issuer exposure.`,
    }));
  const requiredTerms = uniqueStrings([spec.officialTopicTerms, spec.bottleneckNode], 30);
  const bridgeTerms = [
    'segment revenue',
    'revenue',
    'backlog',
    'guidance',
    'capex',
    'capital expenditure',
    'capacity',
    'allocation',
    'lead time',
    'customer demand',
  ];
  return {
    seedId: childSeedId,
    childSeedId,
    parentSeedId,
    status: 'needs_evidence',
    seedTitle: `${parentSeed.bottleneck?.label || 'advanced packaging parent'} -> ${spec.bottleneckNode}`,
    theme: parentSeed.theme || { key: 'semiconductor', label: 'Semiconductor' },
    growthDriver: parentSeed.growthDriver || 'AI accelerator demand requires advanced packaging throughput',
    realActivity: parentSeed.realActivity || 'AI accelerator advanced packaging ramp',
    physicalProcess: spec.physicalProcess,
    requiredInputs: uniqueStrings(spec.requiredInputs, 20),
    bottleneck: {
      label: spec.bottleneckNode,
      class: spec.bottleneckClass,
      mechanism: spec.mechanism,
    },
    bottleneckNode: spec.bottleneckNode,
    bottleneckClass: spec.bottleneckClass,
    childClass: spec.bottleneckClass,
    childDiversityBucket: spec.childDiversityBucket || spec.bottleneckClass,
    childKnownNarrativeScore: Number(spec.childKnownNarrativeScore ?? 0.35),
    childNodeSpecificityScore: 0.88,
    childTickerSuppressionApplied: suppressedTickers.length > 0,
    mechanism: spec.mechanism,
    likelyIssuerRoles: uniqueStrings(spec.likelyIssuerRoles, 12),
    issuerCandidates: routeIssuerCandidates,
    routeIssuerCandidates,
    issuerUniverse: publicIssuerCandidates,
    issuerRoleCandidates,
    issuerRoleClasses,
    issuerAliases: uniqueStrings(spec.issuerAliases, 20),
    suppressedRepresentativeTickers: suppressedTickers,
    providerGapProposalLinks,
    supplierCategory: {
      label: spec.supplierCategory,
      publicIssuerCandidates,
      privateOnly: false,
    },
    requiredEvidenceClasses: [...REQUIRED_EVIDENCE_CLASSES],
    expectedEvidenceClasses: [...REQUIRED_EVIDENCE_CLASSES],
    evidenceQueries: [
      `${spec.bottleneckNode} official filing capacity revenue backlog guidance`,
      `${spec.bottleneckNode} IR presentation capex customer demand allocation lead time`,
      `${spec.issuerAliases.join(' ')} ${spec.bottleneckNode} annual report capacity`,
    ],
    counterEvidenceQueries: [...spec.negativeControlQueries],
    negativeControlQueries: [...spec.negativeControlQueries],
    holdoutRoutes: [...spec.holdoutRoutes],
    acceptanceCriteria: {
      evidenceClass: 'issuer_exposure',
      requiredTerms,
      bridgeTerms,
      officialOrTrustedSourceRequired: true,
      rejectTickerOnly: true,
      rejectRawNotEvaluated: true,
      sourceIndependenceRequired: true,
    },
    scores: {
      ...(parentSeed.scores || {}),
      childSpecificityScore: 0.9,
      knownNarrativeScore: Number(spec.childKnownNarrativeScore ?? Math.min(Number(parentSeed.scores?.knownNarrativeScore ?? 0.35), 0.45)),
      childKnownNarrativeScore: Number(spec.childKnownNarrativeScore ?? 0.35),
      childNodeSpecificityScore: 0.88,
      childTickerSuppressionApplied: suppressedTickers.length > 0,
      seedSimilarityScore: Math.min(Number(parentSeed.scores?.seedSimilarityScore ?? 0.35), 0.5),
    },
    biasAudit: {
      ...(parentSeed.biasAudit || {}),
      decompositionRequired: true,
      parentBroadnessReason: 'advanced_packaging_substrate_capacity_parent_was_too_broad_for_issuer_bridge',
    },
    metadata: {
      ...(parentSeed.metadata || {}),
      parentSeedId,
      childSeedKey: spec.key,
      decompositionSource: 'advanced_packaging_child_bottleneck_map',
      generatedAt,
      officialTopicTerms: requiredTerms,
      officialBridgeTerms: bridgeTerms,
      officialNegativeQueries: [...spec.negativeControlQueries],
      childIssuerAliases: uniqueStrings(spec.issuerAliases, 20),
      routeIssuerCandidates,
      issuerRoleCandidates,
      issuerRoleClasses,
      suppressedRepresentativeTickers: suppressedTickers,
      providerGapProposalLinks,
      childClass: spec.bottleneckClass,
      childDiversityBucket: spec.childDiversityBucket || spec.bottleneckClass,
    },
    lineage: {
      source: 'child_bottleneck_decomposition',
      sourceIds: uniqueStrings([parentSeedId, parentSeed.lineage?.sourceIds], 20),
      generatedAt,
    },
    parentSeed: {
      seedId: parentSeedId,
      bottleneck: parentSeed.bottleneck?.label || null,
      acceptedEvidenceCount: Number(options.parentAcceptedEvidenceCount || 0),
      issuerBridgeStatus: options.parentIssuerBridgeStatus || 'missing',
      negativeControlStatus: options.parentNegativeControlStatus || 'INCONCLUSIVE',
      holdoutConfirmed: Boolean(options.parentHoldoutConfirmed),
    },
  };
}

export function selectPreferredChildBottleneckSeed(childSeeds = [], options = {}) {
  const children = asArray(childSeeds);
  if (!children.length) {
    return {
      childSeed: null,
      selectedChildSeed: null,
      selectionReason: 'no_child_seed_available',
      priorityRank: null,
    };
  }
  const explicit = compact(options.childSeedId || options.childNode || options.bottleneckNode);
  if (explicit) {
    const explicitNorm = normalize(explicit);
    const matched = children.find((child) => (
      normalize(child.seedId) === explicitNorm
      || normalize(child.childSeedId) === explicitNorm
      || normalize(child.bottleneckNode).includes(explicitNorm)
      || explicitNorm.includes(normalize(child.bottleneckNode))
    ));
    if (matched) {
      return {
        childSeed: matched,
        selectedChildSeed: matched,
        selectionReason: `explicit_child_match:${explicit}`,
        priorityRank: 0,
      };
    }
  }
  for (const priority of CHILD_SELECTION_PRIORITY) {
    const matched = children.find((child) => priority.pattern.test([
      child.bottleneckNode,
      child.bottleneck?.label,
      child.requiredInputs,
      child.mechanism,
    ].flatMap(asArray).join(' ')));
    if (matched) {
      return {
        childSeed: matched,
        selectedChildSeed: matched,
        selectionReason: `priority_${priority.rank}:${priority.label}`,
        priorityRank: priority.rank,
      };
    }
  }
  return {
    childSeed: children[0],
    selectedChildSeed: children[0],
    selectionReason: 'fallback_first_child',
    priorityRank: null,
  };
}

export function selectPositivePathCandidateChildSeed(childSeeds = [], options = {}) {
  const children = asArray(childSeeds)
    .filter((child) => normalize(child.seedId || child.childSeedId) !== normalize(options.excludeChildSeedId || ''));
  const explicit = compact(options.childSeedId || options.childNode || options.bottleneckNode);
  if (explicit) {
    const explicitNorm = normalize(explicit);
    const matched = children.find((child) => (
      normalize(child.seedId) === explicitNorm
      || normalize(child.childSeedId) === explicitNorm
      || normalize(child.bottleneckNode).includes(explicitNorm)
      || explicitNorm.includes(normalize(child.bottleneckNode))
    ));
    if (matched) {
      return {
        childSeed: matched,
        selectedChildSeed: matched,
        selectionReason: `positive_path_explicit_child_match:${explicit}`,
        selectionCriteria: 'operator-selected positive-path validation child',
        priorityRank: 0,
      };
    }
  }
  for (const priority of POSITIVE_PATH_CHILD_PRIORITY) {
    const matched = children.find((child) => priority.pattern.test([
      child.bottleneckNode,
      child.bottleneck?.label,
      child.requiredInputs,
      child.mechanism,
      child.issuerCandidates,
    ].flatMap(asArray).join(' ')));
    if (matched) {
      return {
        childSeed: matched,
        selectedChildSeed: matched,
        selectionReason: `positive_path_priority_${priority.rank}:${priority.label}`,
        selectionCriteria: priority.reason,
        priorityRank: priority.rank,
      };
    }
  }
  const fallback = children.find((child) => Number(child.childKnownNarrativeScore || child.scores?.knownNarrativeScore || 1) < 0.45) || children[0] || null;
  return {
    childSeed: fallback,
    selectedChildSeed: fallback,
    selectionReason: fallback ? 'positive_path_fallback_low_known_narrative_child' : 'no_positive_path_candidate_available',
    selectionCriteria: 'official route accessibility and narrow bottleneck node',
    priorityRank: fallback ? null : undefined,
  };
}

export function decomposeChildBottleneckSeeds(parentSeed = {}, options = {}) {
  const matched = specsForParent(parentSeed);
  if (!matched.specs.length && options.force !== true) {
    return {
      ok: true,
      version: SEED_CHILD_BOTTLENECK_DECOMPOSITION_VERSION,
      parentSeedId: seedId(parentSeed),
      parentBottleneck: parentSeed.bottleneck?.label || null,
      decomposed: false,
      reason: 'parent_seed_does_not_match_child_bottleneck_pattern',
      childSeeds: [],
    };
  }
  const specs = matched.specs.length ? matched.specs : CHILD_BOTTLENECK_SPECS;
  const limit = Math.max(1, Number(options.limit || specs.length));
  const childSeeds = specs
    .slice(0, limit)
    .map((spec) => childSeedFromSpec(parentSeed, spec, options));
  return {
    ok: true,
    version: SEED_CHILD_BOTTLENECK_DECOMPOSITION_VERSION,
    parentSeedId: seedId(parentSeed),
    parentBottleneck: parentSeed.bottleneck?.label || null,
    decomposed: true,
    family: matched.family,
    childCount: childSeeds.length,
    childSeeds,
    childClassDistribution: childSeeds.reduce((acc, seed) => {
      const klass = seed.childClass || seed.bottleneck?.class || 'unknown';
      acc[klass] = (acc[klass] || 0) + 1;
      return acc;
    }, {}),
    parentDisposition: 'BROAD_SEED_NEEDS_DECOMPOSITION',
  };
}

export function buildChildBottleneckBackfillTasks(childSeed = {}, options = {}) {
  const generatedAt = options.generatedAt || new Date().toISOString();
  const base = {
    seedId: childSeed.seedId,
    childSeedId: childSeed.seedId,
    parentSeedId: childSeed.parentSeedId,
    subject: childSeed.bottleneck?.label || childSeed.bottleneckNode,
    createdAt: generatedAt,
    mutationBoundary: {
      seedBiasLedgerWrites: true,
      approvalQueueWrites: false,
      canonicalWrites: false,
      sourceRegistryWrites: false,
      providerActivationWrites: false,
      investmentReportPromotionWrites: false,
    },
  };
  const sourceQueryBase = childSeed.bottleneck?.label || childSeed.bottleneckNode;
  return [
    {
      ...base,
      taskId: `child-task-${safeId(childSeed.seedId)}:issuer_exposure`,
      evidenceClass: 'issuer_exposure',
      providerRoute: 'official-issuer-route',
      providers: ['sec-edgar', 'company-ir', 'official-company-release', 'earnings-transcript'],
      sourceQuery: `${childSeed.issuerAliases?.join(' ')} ${sourceQueryBase} capacity revenue backlog guidance capex customer demand`,
      acceptanceCriteria: childSeed.acceptanceCriteria,
      providerGapProposalLinks: childSeed.providerGapProposalLinks || [],
      status: childSeed.providerGapProposalLinks?.length ? 'provider_gap_proposal_required' : 'queued',
      reviewRequired: Boolean(childSeed.providerGapProposalLinks?.length),
      promotionEligible: true,
    },
    {
      ...base,
      taskId: `child-task-${safeId(childSeed.seedId)}:holdout_validation`,
      evidenceClass: 'holdout_validation',
      providerRoute: 'official-holdout-validation',
      providers: childSeed.holdoutRoutes || ['official_company_filing', 'issuer_ir_transcript', 'specialist_trade_media'],
      sourceQuery: `${sourceQueryBase} independent official holdout validation`,
      acceptanceCriteria: {
        evidenceClass: 'holdout_validation',
        sourceGroupMustDifferFromGeneration: true,
        matchedEvidenceClasses: childSeed.requiredEvidenceClasses,
      },
      status: 'queued',
      reviewRequired: false,
      promotionEligible: false,
    },
    {
      ...base,
      taskId: `child-task-${safeId(childSeed.seedId)}:negative_control`,
      evidenceClass: 'negative_control',
      providerRoute: 'official-negative-control',
      providers: ['official-company-filing', 'company-ir', 'specialist-trade-media'],
      sourceQuery: childSeed.negativeControlQueries?.[0] || `${sourceQueryBase} no bottleneck capacity improving`,
      sourceQueryDrafts: asArray(childSeed.negativeControlQueries).map((query, index) => ({
        draftId: `child-neg:${safeId(childSeed.seedId)}:${index}`,
        query,
        evidenceClass: 'negative_control',
        desiredEvidenceClass: 'negative_control',
        evidenceUse: 'negative_control_candidate',
        promotionEligible: false,
      })),
      acceptanceCriteria: {
        evidenceClass: 'negative_control',
        negativeControlIntent: true,
        acceptedStatuses: ['SURVIVED', 'CHECKED_NO_DIRECT', 'CHECKED_NO_DIRECT_LIMITED_SCOPE', 'CHECKED_NO_DIRECT_SUFFICIENT_SCOPE', 'WEAKENED', 'REJECTED'],
      },
      status: 'needs_operator_review',
      reviewRequired: true,
      promotionEligible: false,
    },
  ];
}

export function summarizeChildBottleneckAcquisitions(parentSeed = {}, childResults = []) {
  const results = asArray(childResults);
  const childrenWithAcceptedEvidence = results.filter((item) => Number(item.acceptedEvidenceCount || 0) > 0);
  return {
    ok: true,
    parentSeedId: seedId(parentSeed),
    parentBottleneck: parentSeed.bottleneck?.label || null,
    childCount: results.length,
    childrenWithAcceptedEvidence: childrenWithAcceptedEvidence.map((item) => item.seedId),
    parentStatus: childrenWithAcceptedEvidence.length
      ? 'BROAD_PARENT_WITH_CHILD_EVIDENCE'
      : 'BROAD_SEED_NEEDS_DECOMPOSITION',
    reportCandidateChildSeeds: results
      .filter((item) => item.gateResult?.gate === 'report_candidate_allowed'
        && item.providerBlocked !== true
        && item.excludedFromReportCandidateEvaluation !== true)
      .map((item) => item.seedId),
    acceptedEvidenceTotal: results.reduce((sum, item) => sum + Number(item.acceptedEvidenceCount || 0), 0),
    rawEvidenceTotal: results.reduce((sum, item) => sum + Number(item.rawEvidenceCount || 0), 0),
  };
}
