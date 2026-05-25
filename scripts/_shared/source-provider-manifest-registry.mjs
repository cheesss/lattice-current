import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

export const SOURCE_PROVIDER_MANIFEST_REGISTRY_VERSION = 'source-provider-manifest-registry-v1';
export const DEFAULT_SOURCE_PROVIDER_MANIFEST_DIR = path.join(process.cwd(), 'config', 'source-providers');
export const DEFAULT_SOURCE_PROVIDER_MANIFEST_ARTIFACT_PATH = path.join(process.cwd(), 'data', 'runtime', 'provider-manifest-registry.latest.json');

const REQUIRED_PROVIDER_FIELDS = Object.freeze([
  'providerName',
  'fillsEvidenceClasses',
  'sourceType',
  'providerRoute',
  'authRequired',
  'apiKeyRequired',
  'fixtureRequired',
  'fixtureRequirement',
  'parserOutputSchema',
  'allowlist',
  'healthCheckCommand',
  'testCommand',
  'failureModes',
  'activationPolicy',
]);

const REQUIRED_SCHEMA_FIELDS = Object.freeze(['desiredEvidenceClass']);
const REQUIRED_FAILURE_MODES = Object.freeze(['NO_RESULT', 'TIMEOUT', 'TICKER_ONLY']);

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

function readManifestFiles(configDir = DEFAULT_SOURCE_PROVIDER_MANIFEST_DIR) {
  if (!existsSync(configDir)) return [];
  return readdirSync(configDir)
    .filter((name) => name.endsWith('.json'))
    .sort()
    .map((name) => {
      const filePath = path.join(configDir, name);
      return { filePath, payload: readJson(filePath) };
    });
}

function manifestsFromPayload(entry) {
  const payload = entry.payload || {};
  const rows = Array.isArray(payload) ? payload : asArray(payload.providers || payload.manifests || payload.provider);
  return rows.map((row) => ({
    ...row,
    manifestFile: path.relative(process.cwd(), entry.filePath).replace(/\\/g, '/'),
    registryVersion: payload.version || SOURCE_PROVIDER_MANIFEST_REGISTRY_VERSION,
  }));
}

export function normalizeSourceProviderManifest(manifest = {}) {
  return {
    providerName: compact(manifest.providerName).toLowerCase(),
    fillsEvidenceClasses: asArray(manifest.fillsEvidenceClasses).map((item) => compact(item)).filter(Boolean),
    sourceType: compact(manifest.sourceType),
    providerRoute: compact(manifest.providerRoute),
    authRequired: manifest.authRequired === true,
    apiKeyRequired: manifest.apiKeyRequired === true,
    fixtureRequired: manifest.fixtureRequired === true,
    fixtureRequirement: compact(manifest.fixtureRequirement),
    parserOutputSchema: manifest.parserOutputSchema || null,
    allowlist: asArray(manifest.allowlist).map((item) => compact(item)).filter(Boolean),
    healthCheckCommand: compact(manifest.healthCheckCommand),
    testCommand: compact(manifest.testCommand),
    failureModes: asArray(manifest.failureModes).map((item) => compact(item)).filter(Boolean),
    activationPolicy: {
      reviewGatedActivation: manifest.activationPolicy?.reviewGatedActivation !== false,
      allowedAutomaticStatuses: asArray(manifest.activationPolicy?.allowedAutomaticStatuses || ['staged', 'active_limited']),
      activeUseRequiresProbe: manifest.activationPolicy?.activeUseRequiresProbe !== false,
      canonicalWritesAllowed: manifest.activationPolicy?.canonicalWritesAllowed === true,
      readinessPromotionAllowed: manifest.activationPolicy?.readinessPromotionAllowed === true,
      portfolioActionAllowed: manifest.activationPolicy?.portfolioActionAllowed === true,
    },
    priorityProvider: manifest.priorityProvider !== false,
    manifestFile: manifest.manifestFile || null,
    registryVersion: manifest.registryVersion || SOURCE_PROVIDER_MANIFEST_REGISTRY_VERSION,
  };
}

export function validateSourceProviderManifest(manifestInput = {}) {
  const manifest = normalizeSourceProviderManifest(manifestInput);
  const errors = [];
  for (const field of REQUIRED_PROVIDER_FIELDS) {
    const value = manifestInput[field];
    if (value === undefined || value === null || value === '' || (Array.isArray(value) && value.length === 0)) {
      errors.push(`missing_field:${field}`);
    }
  }
  if (!manifest.providerName) errors.push('invalid_provider_name');
  if (!manifest.fillsEvidenceClasses.length) errors.push('missing_fills_evidence_classes');
  if (!manifest.allowlist.length) errors.push('missing_allowlist');
  const requiredSchemaFields = asArray(manifest.parserOutputSchema?.requiredFields);
  for (const field of REQUIRED_SCHEMA_FIELDS) {
    if (!requiredSchemaFields.includes(field)) errors.push(`parser_schema_missing:${field}`);
  }
  for (const mode of REQUIRED_FAILURE_MODES) {
    if (!manifest.failureModes.includes(mode)) errors.push(`failure_mode_missing:${mode}`);
  }
  if (manifest.activationPolicy.canonicalWritesAllowed) errors.push('unsafe_activation_policy:canonical_writes');
  if (manifest.activationPolicy.readinessPromotionAllowed) errors.push('unsafe_activation_policy:readiness_promotion');
  if (manifest.activationPolicy.portfolioActionAllowed) errors.push('unsafe_activation_policy:portfolio_action');
  return {
    ok: errors.length === 0,
    providerName: manifest.providerName,
    manifest,
    errors,
  };
}

export function buildSourceProviderManifestRegistry(options = {}) {
  const generatedAt = options.generatedAt || new Date().toISOString();
  const entries = readManifestFiles(options.configDir || DEFAULT_SOURCE_PROVIDER_MANIFEST_DIR);
  const manifests = entries.flatMap(manifestsFromPayload).map(normalizeSourceProviderManifest);
  const validations = manifests.map(validateSourceProviderManifest);
  const providers = validations.map((validation) => ({
    ...validation.manifest,
    valid: validation.ok,
    validationErrors: validation.errors,
    lifecycleDefault: validation.manifest.authRequired || validation.manifest.apiKeyRequired
      ? 'needs_credentials'
      : (validation.manifest.fixtureRequired ? 'needs_fixture' : 'discovered_untrusted'),
  }));
  const invalidProviders = providers.filter((provider) => !provider.valid);
  return {
    ok: invalidProviders.length === 0 && providers.length > 0,
    version: SOURCE_PROVIDER_MANIFEST_REGISTRY_VERSION,
    generatedAt,
    configDir: path.resolve(options.configDir || DEFAULT_SOURCE_PROVIDER_MANIFEST_DIR),
    providerCount: providers.length,
    providers,
    invalidProviders: invalidProviders.map((provider) => provider.providerName),
    validationErrors: Object.fromEntries(invalidProviders.map((provider) => [provider.providerName, provider.validationErrors])),
    summary: {
      providerCount: providers.length,
      validProviderCount: providers.filter((provider) => provider.valid).length,
      needsCredentialsCount: providers.filter((provider) => provider.authRequired || provider.apiKeyRequired).length,
      fixtureRequiredCount: providers.filter((provider) => provider.fixtureRequired).length,
      readOnlyProviderCount: providers.filter((provider) => !provider.authRequired && !provider.apiKeyRequired).length,
      priorityProviderCount: providers.filter((provider) => provider.priorityProvider !== false).length,
      safeBoundary: {
        canonicalWrites: 0,
        readinessPromotionWrites: 0,
        portfolioActionWrites: 0,
      },
    },
  };
}

export function providerSpecsFromManifestRegistry(registry = buildSourceProviderManifestRegistry()) {
  return asArray(registry.providers)
    .filter((provider) => provider.valid !== false)
    .map((provider) => ({
      providerName: provider.providerName,
      priorityProvider: provider.priorityProvider !== false,
      fillsEvidenceClasses: [...provider.fillsEvidenceClasses],
      sourceType: provider.sourceType,
      providerRoute: provider.providerRoute,
      authRequired: provider.authRequired,
      apiKeyRequired: provider.apiKeyRequired,
      fixtureRequired: provider.fixtureRequired,
      fixtureRequirement: provider.fixtureRequirement,
      parserOutputSchema: provider.parserOutputSchema,
      allowlist: [...provider.allowlist],
      healthCheckCommand: provider.healthCheckCommand,
      testCommand: provider.testCommand,
      failureModes: [...provider.failureModes],
      activationPolicy: { ...provider.activationPolicy },
      manifestFile: provider.manifestFile,
    }));
}

export function buildSourceProviderManifestCandidates(options = {}) {
  const registry = options.registry || buildSourceProviderManifestRegistry(options);
  const generatedAt = options.generatedAt || new Date().toISOString();
  return providerSpecsFromManifestRegistry(registry).flatMap((spec) => (
    spec.fillsEvidenceClasses.map((evidenceClass) => ({
      candidateId: `manifest:${spec.providerName}:${evidenceClass}`,
      providerName: spec.providerName,
      evidenceClass,
      sourceUrl: '',
      sourceType: spec.sourceType,
      providerRoute: spec.providerRoute,
      status: 'discovered_untrusted',
      discoveredBy: 'source_provider_manifest_registry',
      authRequired: spec.authRequired,
      apiKeyRequired: spec.apiKeyRequired,
      fixtureRequired: spec.fixtureRequired,
      fixtureRequirement: spec.fixtureRequirement,
      allowlist: spec.allowlist,
      parserOutputSchema: spec.parserOutputSchema,
      healthCheckCommand: spec.healthCheckCommand,
      testCommand: spec.testCommand,
      failureModes: spec.failureModes,
      metadata: {
        providerManifestRegistryVersion: SOURCE_PROVIDER_MANIFEST_REGISTRY_VERSION,
        manifestFile: spec.manifestFile,
        reviewGatedActivation: true,
        activationPolicy: 'probe_fixture_healthcheck_before_active_use',
        createdAt: generatedAt,
      },
    }))
  ));
}

export async function writeSourceProviderManifestRegistryArtifact(
  registry = buildSourceProviderManifestRegistry(),
  artifactPath = DEFAULT_SOURCE_PROVIDER_MANIFEST_ARTIFACT_PATH,
) {
  await mkdir(path.dirname(artifactPath), { recursive: true });
  await writeFile(artifactPath, `${JSON.stringify(registry, null, 2)}\n`, 'utf8');
  return path.resolve(artifactPath);
}
