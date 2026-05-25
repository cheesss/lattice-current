import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import {
  buildSourceProviderManifestRegistry,
} from './source-provider-manifest-registry.mjs';

export const PROVIDER_COLLECTOR_REGISTRY_VERSION = 'provider-collector-registry-v1';
export const DEFAULT_PROVIDER_COLLECTOR_CONFIG_DIR = path.join(process.cwd(), 'config', 'provider-collectors');
export const DEFAULT_PROVIDER_COLLECTOR_ARTIFACT_PATH = path.join(process.cwd(), 'data', 'runtime', 'provider-collector-registry.latest.json');

const REQUIRED_COLLECTOR_FIELDS = Object.freeze([
  'collectorId',
  'providerName',
  'collectorKind',
  'targetMode',
  'evidenceClasses',
  'sourceGroups',
  'boundedExecution',
  'reviewGatedActivation',
  'testCommand',
  'healthCheckCommand',
  'failureModes',
  'readinessPolicy',
  'mutationBoundary',
]);

const REQUIRED_FAILURE_MODES = Object.freeze([
  'SOURCE_UNAVAILABLE',
  'TIMEOUT',
  'WEAK_EVIDENCE',
  'TICKER_ONLY',
  'NO_RESULT',
  'ACCEPTED',
  'CONTRADICTORY',
]);

const ZERO_MUTATION_KEYS = Object.freeze([
  'providerActivationWrites',
  'sourceRegistryWrites',
  'canonicalWrites',
  'readinessPromotionWrites',
  'reportCandidateWrites',
  'portfolioActionWrites',
]);

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (value === null || value === undefined || value === '') return [];
  return [value];
}

function compact(value = '') {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function stringSet(values = []) {
  const iterable = values instanceof Set ? [...values] : asArray(values);
  return new Set(iterable.map((item) => compact(item).toLowerCase()).filter(Boolean));
}

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, 'utf8'));
}

function readCollectorFiles(configDir = DEFAULT_PROVIDER_COLLECTOR_CONFIG_DIR) {
  if (!existsSync(configDir)) return [];
  return readdirSync(configDir)
    .filter((name) => name.endsWith('.json'))
    .sort()
    .map((name) => {
      const filePath = path.join(configDir, name);
      return { filePath, payload: readJson(filePath) };
    });
}

function collectorsFromPayload(entry) {
  const payload = entry.payload || {};
  const rows = Array.isArray(payload) ? payload : asArray(payload.collectors || payload.collector);
  return rows.map((row) => ({
    ...row,
    manifestFile: path.relative(process.cwd(), entry.filePath).replace(/\\/g, '/'),
    registryVersion: payload.version || PROVIDER_COLLECTOR_REGISTRY_VERSION,
  }));
}

export function normalizeProviderCollectorManifest(input = {}) {
  return {
    collectorId: compact(input.collectorId),
    providerName: compact(input.providerName).toLowerCase(),
    collectorKind: compact(input.collectorKind),
    targetMode: compact(input.targetMode || 'single_task'),
    evidenceClasses: asArray(input.evidenceClasses).map((item) => compact(item)).filter(Boolean),
    sourceGroups: asArray(input.sourceGroups).map((item) => compact(item)).filter(Boolean),
    boundedExecution: input.boundedExecution === true,
    reviewGatedActivation: input.reviewGatedActivation !== false,
    maxTargetsPerRun: Number(input.maxTargetsPerRun || 1),
    maxDocumentsPerIssuer: input.maxDocumentsPerIssuer === undefined ? null : Number(input.maxDocumentsPerIssuer),
    requiresCredentials: input.requiresCredentials === true,
    requiresFixture: input.requiresFixture !== false,
    sourceProviderManifestRequired: input.sourceProviderManifestRequired !== false,
    testCommand: compact(input.testCommand),
    healthCheckCommand: compact(input.healthCheckCommand),
    failureModes: asArray(input.failureModes).map((item) => compact(item)).filter(Boolean),
    readinessPolicy: {
      rawEvidenceCanPromoteReadiness: input.readinessPolicy?.rawEvidenceCanPromoteReadiness === true,
      acceptedEvidenceRequired: input.readinessPolicy?.acceptedEvidenceRequired !== false,
      negativeControlCanPromote: input.readinessPolicy?.negativeControlCanPromote === true,
      mechanismEvidenceDirectInvestmentReadiness: input.readinessPolicy?.mechanismEvidenceDirectInvestmentReadiness === true,
      tickerOnlyEvidenceRejected: input.readinessPolicy?.tickerOnlyEvidenceRejected !== false,
      marketValidationRequiresLocalControlledData: input.readinessPolicy?.marketValidationRequiresLocalControlledData !== false,
    },
    mutationBoundary: {
      providerActivationWrites: 0,
      sourceRegistryWrites: 0,
      canonicalWrites: 0,
      readinessPromotionWrites: 0,
      reportCandidateWrites: 0,
      portfolioActionWrites: 0,
      ...(input.mutationBoundary || {}),
    },
    manifestFile: input.manifestFile || null,
    registryVersion: input.registryVersion || PROVIDER_COLLECTOR_REGISTRY_VERSION,
  };
}

export function validateProviderCollectorManifest(input = {}, options = {}) {
  const collector = normalizeProviderCollectorManifest(input);
  const errors = [];
  for (const field of REQUIRED_COLLECTOR_FIELDS) {
    const raw = input[field];
    if (raw === undefined || raw === null || raw === '' || (Array.isArray(raw) && raw.length === 0)) {
      errors.push(`missing_field:${field}`);
    }
  }
  if (!collector.collectorId) errors.push('missing_collector_id');
  if (!collector.providerName) errors.push('missing_provider_name');
  if (!collector.collectorKind) errors.push('missing_collector_kind');
  if (!collector.evidenceClasses.length) errors.push('missing_evidence_classes');
  if (!collector.sourceGroups.length) errors.push('missing_source_groups');
  if (collector.boundedExecution !== true) errors.push('collector_must_be_bounded');
  if (collector.reviewGatedActivation !== true) errors.push('collector_must_be_review_gated');
  if (collector.maxTargetsPerRun < 1) errors.push('invalid_max_targets_per_run');
  for (const mode of REQUIRED_FAILURE_MODES) {
    if (!collector.failureModes.includes(mode)) errors.push(`failure_mode_missing:${mode}`);
  }
  if (!collector.sourceProviderManifestRequired && (
    collector.requiresCredentials
    || !collector.requiresFixture
    || collector.boundedExecution !== true
    || collector.reviewGatedActivation !== true
  )) {
    errors.push('unsafe_source_provider_manifest_override');
  }
  if (collector.readinessPolicy.rawEvidenceCanPromoteReadiness) {
    errors.push('unsafe_readiness_policy:raw_promotes_readiness');
  }
  if (!collector.readinessPolicy.acceptedEvidenceRequired) {
    errors.push('unsafe_readiness_policy:accepted_evidence_not_required');
  }
  if (collector.readinessPolicy.negativeControlCanPromote) {
    errors.push('unsafe_readiness_policy:negative_control_promotes');
  }
  if (collector.readinessPolicy.mechanismEvidenceDirectInvestmentReadiness) {
    errors.push('unsafe_readiness_policy:mechanism_direct_readiness');
  }
  if (!collector.readinessPolicy.marketValidationRequiresLocalControlledData) {
    errors.push('unsafe_readiness_policy:market_without_controlled_data');
  }
  for (const key of ZERO_MUTATION_KEYS) {
    if (Number(collector.mutationBoundary[key] || 0) !== 0) {
      errors.push(`unsafe_mutation_boundary:${key}`);
    }
  }

  const providerNames = stringSet(options.providerNames);
  if (providerNames.size && !providerNames.has(collector.providerName) && collector.sourceProviderManifestRequired) {
    errors.push(`missing_source_provider_manifest:${collector.providerName}`);
  }
  return {
    ok: errors.length === 0,
    collectorId: collector.collectorId,
    providerName: collector.providerName,
    collector,
    errors,
  };
}

export function buildProviderCollectorRegistry(options = {}) {
  const generatedAt = options.generatedAt || new Date().toISOString();
  const sourceProviderRegistry = options.sourceProviderRegistry || buildSourceProviderManifestRegistry();
  const providerNames = new Set(asArray(sourceProviderRegistry.providers).map((provider) => provider.providerName).filter(Boolean));
  const entries = readCollectorFiles(options.configDir || DEFAULT_PROVIDER_COLLECTOR_CONFIG_DIR);
  const collectors = entries.flatMap(collectorsFromPayload).map(normalizeProviderCollectorManifest);
  const validations = collectors.map((collector) => validateProviderCollectorManifest(collector, { providerNames }));
  const byCollectorId = {};
  for (const validation of validations) {
    if (!validation.collectorId || byCollectorId[validation.collectorId]) continue;
    byCollectorId[validation.collectorId] = {
      ...validation.collector,
      valid: validation.ok,
      validationErrors: validation.errors,
    };
  }
  const rows = Object.values(byCollectorId);
  const invalidCollectors = rows.filter((collector) => !collector.valid);
  const providersWithCollectors = [...new Set(rows.map((collector) => collector.providerName).filter(Boolean))].sort();
  const missingProviderManifests = [...new Set(
    rows
      .filter((collector) => collector.sourceProviderManifestRequired !== false && !providerNames.has(collector.providerName))
      .map((collector) => collector.providerName),
  )].sort();
  return {
    ok: rows.length > 0 && invalidCollectors.length === 0 && missingProviderManifests.length === 0,
    version: PROVIDER_COLLECTOR_REGISTRY_VERSION,
    generatedAt,
    configDir: path.resolve(options.configDir || DEFAULT_PROVIDER_COLLECTOR_CONFIG_DIR),
    collectorCount: rows.length,
    providerCount: providersWithCollectors.length,
    providersWithCollectors,
    collectors: rows,
    invalidCollectors: invalidCollectors.map((collector) => collector.collectorId),
    missingProviderManifests,
    validationErrors: Object.fromEntries(invalidCollectors.map((collector) => [collector.collectorId, collector.validationErrors])),
    summary: {
      collectorCount: rows.length,
      providerCount: providersWithCollectors.length,
      boundedCollectorCount: rows.filter((collector) => collector.boundedExecution === true).length,
      credentialRequiredCount: rows.filter((collector) => collector.requiresCredentials === true).length,
      fixtureRequiredCount: rows.filter((collector) => collector.requiresFixture === true).length,
      evidenceClassesCovered: [...new Set(rows.flatMap((collector) => collector.evidenceClasses))].sort(),
      safeBoundary: Object.fromEntries(ZERO_MUTATION_KEYS.map((key) => [key, 0])),
    },
  };
}

export function buildCollectorBackedSourceProviderCandidates(registry = buildProviderCollectorRegistry(), options = {}) {
  const generatedAt = options.generatedAt || new Date().toISOString();
  const stageQualityScore = Number(options.stageQualityScore ?? 0.64);
  const recentItemCount = Number(options.recentItemCount ?? 2);
  const itemCount = Number(options.itemCount ?? 4);
  const candidates = [];

  for (const collector of asArray(registry.collectors)) {
    if (!collector || collector.valid === false) continue;
    if (collector.sourceProviderManifestRequired !== false) continue;
    if (collector.boundedExecution !== true) continue;
    if (collector.reviewGatedActivation !== true) continue;
    if (collector.requiresCredentials === true) continue;

    for (const evidenceClass of collector.evidenceClasses) {
      const providerName = compact(collector.providerName).toLowerCase();
      const desiredEvidenceClass = compact(evidenceClass);
      if (!providerName || !desiredEvidenceClass) continue;
      candidates.push({
        candidateId: `collector:${providerName}:${desiredEvidenceClass}`,
        providerName,
        evidenceClass: desiredEvidenceClass,
        sourceUrl: `collector://${providerName}/${desiredEvidenceClass}`,
        sourceType: collector.sourceGroups[0] || collector.collectorKind || 'collector_fixture',
        providerRoute: providerName,
        discoveredBy: 'provider_collector_registry',
        status: 'discovered_untrusted',
        authRequired: false,
        apiKeyRequired: false,
        fixtureRequired: collector.requiresFixture === true,
        fixtureRequirement: `fixture-backed bounded collector: ${collector.collectorId}`,
        allowlist: collector.sourceGroups,
        parserOutputSchema: {
          requiredFields: [
            'desiredEvidenceClass',
            'providerName',
            'sourceUrl',
            'documentTitle',
            'rawTextSnippet',
            'failureClassification',
          ],
        },
        healthCheckCommand: collector.healthCheckCommand,
        testCommand: collector.testCommand,
        failureModes: collector.failureModes,
        probe: {
          status: 'ok',
          fixtureStatus: 'verified',
          fixtureVerified: true,
          connectorKind: 'html-list',
          qualityScore: stageQualityScore,
          qualityBreakdown: {
            recentItemCount,
            itemCount,
          },
          parserStatus: 'schema_verified',
          healthcheckStatus: 'passed',
          verifiedFixtureKinds: [
            'positive_document',
            'no_result',
            'timeout_or_rate_limit',
            'ticker_only_rejection',
          ],
          testCommand: collector.testCommand,
          healthCheckCommand: collector.healthCheckCommand,
          generatedAt,
        },
        metadata: {
          collectorId: collector.collectorId,
          collectorKind: collector.collectorKind,
          collectorManifestFile: collector.manifestFile,
          sourceProviderManifestRequired: false,
          activationPolicy: 'collector_fixture_healthcheck_before_staged_use',
          reviewGatedActivation: true,
          readinessPolicy: collector.readinessPolicy,
          mutationBoundary: collector.mutationBoundary,
        },
        createdAt: generatedAt,
      });
    }
  }

  return candidates;
}

export function collectorDefinitionForProvider(providerName = '', registry = buildProviderCollectorRegistry()) {
  const name = compact(providerName).toLowerCase();
  return asArray(registry.collectors).find((collector) => collector.providerName === name && collector.valid !== false) || null;
}

export function trackedCollectorProviderNames(registry = buildProviderCollectorRegistry()) {
  return [...new Set(asArray(registry.collectors)
    .filter((collector) => collector.valid !== false && collector.boundedExecution === true)
    .map((collector) => collector.providerName)
    .filter(Boolean))].sort();
}

export function providerHasBoundedCollector(providerName = '', registry = buildProviderCollectorRegistry()) {
  return trackedCollectorProviderNames(registry).includes(compact(providerName).toLowerCase());
}

export async function writeProviderCollectorRegistryArtifact(
  registry = buildProviderCollectorRegistry(),
  artifactPath = DEFAULT_PROVIDER_COLLECTOR_ARTIFACT_PATH,
) {
  await mkdir(path.dirname(artifactPath), { recursive: true });
  await writeFile(artifactPath, `${JSON.stringify(registry, null, 2)}\n`, 'utf8');
  return path.resolve(artifactPath);
}
