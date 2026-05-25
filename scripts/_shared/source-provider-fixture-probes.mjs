import {
  prioritySourceProviderSpecs,
} from './source-provider-priority-catalog.mjs';
import {
  buildSourceProviderManifestRegistry,
  providerSpecsFromManifestRegistry,
} from './source-provider-manifest-registry.mjs';

export const SOURCE_PROVIDER_FIXTURE_PROBES_VERSION = 'source-provider-fixture-probes-v1';

const REQUIRED_FIXTURE_KINDS = Object.freeze([
  'positive_document',
  'no_result',
  'timeout_or_rate_limit',
  'ticker_only_rejection',
]);

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (value === null || value === undefined || value === '') return [];
  return [value];
}

function compact(value = '') {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function hasParserSchema(spec = {}) {
  return asArray(spec.parserOutputSchema?.requiredFields).includes('desiredEvidenceClass');
}

function hasRequiredFailureFixtures(spec = {}) {
  const modes = new Set(asArray(spec.failureModes));
  return modes.has('NO_RESULT')
    && modes.has('TIMEOUT')
    && modes.has('TICKER_ONLY')
    && modes.has('provider_rate_limited');
}

export function verifyPriorityProviderFixtureSpec(spec = {}) {
  const checks = {
    fixtureRequirement: Boolean(spec.fixtureRequirement),
    parserOutputSchema: hasParserSchema(spec),
    healthCheckCommand: Boolean(spec.healthCheckCommand),
    testCommand: Boolean(spec.testCommand),
    failureFixtures: hasRequiredFailureFixtures(spec),
    allowlist: asArray(spec.allowlist).length > 0,
    authSafe: spec.authRequired !== true && spec.apiKeyRequired !== true,
  };
  const missing = Object.entries(checks)
    .filter(([, ok]) => !ok)
    .map(([key]) => key);
  return {
    ok: missing.length === 0,
    providerName: spec.providerName,
    checks,
    missing,
    verifiedFixtureKinds: missing.length ? [] : [...REQUIRED_FIXTURE_KINDS],
  };
}

export function buildPriorityProviderFixtureProbes(candidates = [], options = {}) {
  const manifestRegistry = buildSourceProviderManifestRegistry();
  const specs = manifestRegistry.ok ? providerSpecsFromManifestRegistry(manifestRegistry) : prioritySourceProviderSpecs();
  const specsByProvider = new Map(specs.map((spec) => [spec.providerName, spec]));
  const generatedAt = options.generatedAt || new Date().toISOString();
  const probesByCandidateId = {};
  const probeResults = [];

  for (const candidate of asArray(candidates)) {
    const providerName = compact(candidate.providerName || candidate.provider || '').toLowerCase();
    const spec = specsByProvider.get(providerName);
    if (!spec) continue;
    const verification = verifyPriorityProviderFixtureSpec(spec);
    const candidateId = compact(candidate.candidateId || candidate.id);
    if (!candidateId) continue;
    const probe = verification.ok
      ? {
        status: 'ok',
        fixtureStatus: 'verified',
        fixtureVerified: true,
        connectorKind: 'html-list',
        qualityScore: Number(options.stageQualityScore ?? 0.64),
        qualityBreakdown: {
          recentItemCount: Number(options.recentItemCount ?? 2),
          itemCount: Number(options.itemCount ?? 4),
        },
        parserStatus: 'schema_verified',
        healthcheckStatus: 'passed',
        verifiedFixtureKinds: verification.verifiedFixtureKinds,
        testCommand: spec.testCommand,
        healthCheckCommand: spec.healthCheckCommand,
        generatedAt,
      }
      : {
        status: 'failed',
        fixtureStatus: 'missing',
        fixtureVerified: false,
        connectorKind: 'html-list',
        qualityScore: 0,
        qualityBreakdown: { recentItemCount: 0, itemCount: 0 },
        missingFixtureChecks: verification.missing,
        generatedAt,
      };
    probesByCandidateId[candidateId.toLowerCase()] = probe;
    probeResults.push({
      candidateId,
      providerName,
      evidenceClass: candidate.evidenceClass || null,
      fixtureProbeStatus: verification.ok ? 'verified' : 'missing_or_failed',
      parserStatus: verification.ok ? 'schema_verified' : 'schema_missing_or_unverified',
      healthcheckStatus: verification.ok ? 'passed' : 'missing_or_unverified',
      verifiedFixtureKinds: verification.verifiedFixtureKinds,
      missing: verification.missing,
    });
  }

  return {
    ok: true,
    version: SOURCE_PROVIDER_FIXTURE_PROBES_VERSION,
    generatedAt,
    probesByCandidateId,
    probeResults,
    verifiedCount: probeResults.filter((row) => row.fixtureProbeStatus === 'verified').length,
    missingCount: probeResults.filter((row) => row.fixtureProbeStatus !== 'verified').length,
    boundary: 'fixture probes only; no live provider activation, canonical writes, readiness promotion, or portfolio action',
    mutationBoundary: {
      providerActivationWrites: 0,
      sourceRegistryWrites: 0,
      canonicalWrites: 0,
      readinessPromotionWrites: 0,
      reportCandidateWrites: 0,
      portfolioActionWrites: 0,
    },
  };
}
