import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

export const EVIDENCE_EXECUTOR_REGISTRY_VERSION = 'evidence-executor-registry-v1';
export const DEFAULT_EVIDENCE_EXECUTOR_CONFIG_DIR = path.join(process.cwd(), 'config', 'evidence-executors');
export const DEFAULT_EVIDENCE_EXECUTOR_ARTIFACT_PATH = path.join(process.cwd(), 'data', 'runtime', 'evidence-executor-registry.latest.json');

export const BACKFILL_FAILURE_TAXONOMY = Object.freeze([
  'SOURCE_UNAVAILABLE',
  'TIMEOUT',
  'WEAK_EVIDENCE',
  'TICKER_ONLY',
  'NO_RESULT',
  'ACCEPTED',
  'CONTRADICTORY',
]);

const REQUIRED_CLASSES = Object.freeze([
  'issuer_exposure',
  'mechanism_validation',
  'negative_control',
  'holdout_validation',
  'market_validation',
  'technical_qualification',
  'test_facility_capacity',
  'material_input',
  'engineering_process',
  'permitting_regulatory',
  'provider_data_gap',
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

function readExecutorFiles(configDir = DEFAULT_EVIDENCE_EXECUTOR_CONFIG_DIR) {
  if (!existsSync(configDir)) return [];
  return readdirSync(configDir)
    .filter((name) => name.endsWith('.json'))
    .sort()
    .map((name) => {
      const filePath = path.join(configDir, name);
      return { filePath, payload: readJson(filePath) };
    });
}

function executorsFromPayload(entry) {
  const payload = entry.payload || {};
  const rows = Array.isArray(payload) ? payload : asArray(payload.executors || payload.executor);
  return rows.map((row) => ({
    ...row,
    manifestFile: path.relative(process.cwd(), entry.filePath).replace(/\\/g, '/'),
    registryVersion: payload.version || EVIDENCE_EXECUTOR_REGISTRY_VERSION,
  }));
}

export function normalizeEvidenceExecutorManifest(input = {}) {
  const routes = asArray(input.routes || input.executorRoutes).map((item) => compact(item)).filter(Boolean);
  return {
    evidenceClass: compact(input.evidenceClass),
    routes,
    executionMode: compact(input.executionMode || 'bounded_executor_artifact_only'),
    acceptedUseAllowed: asArray(input.acceptedUseAllowed || ['supporting_context', 'promotion_candidate']),
    promotionEvidenceAllowed: input.promotionEvidenceAllowed !== false,
    requiresLocalControlledData: input.requiresLocalControlledData === true,
    terminalFailureTaxonomy: asArray(input.terminalFailureTaxonomy || BACKFILL_FAILURE_TAXONOMY),
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
    registryVersion: input.registryVersion || EVIDENCE_EXECUTOR_REGISTRY_VERSION,
  };
}

export function validateEvidenceExecutorManifest(input = {}) {
  const executor = normalizeEvidenceExecutorManifest(input);
  const errors = [];
  if (!executor.evidenceClass) errors.push('missing_evidence_class');
  if (!executor.routes.length) errors.push('missing_routes');
  for (const mode of BACKFILL_FAILURE_TAXONOMY) {
    if (!executor.terminalFailureTaxonomy.includes(mode)) errors.push(`missing_failure_taxonomy:${mode}`);
  }
  if (executor.evidenceClass === 'negative_control' && executor.promotionEvidenceAllowed !== false) {
    errors.push('negative_control_promotion_must_be_false');
  }
  if (executor.evidenceClass === 'market_validation' && executor.requiresLocalControlledData !== true) {
    errors.push('market_validation_requires_local_controlled_data');
  }
  for (const [key, value] of Object.entries(executor.mutationBoundary)) {
    if (['canonicalWrites', 'readinessPromotionWrites', 'reportCandidateWrites', 'portfolioActionWrites'].includes(key) && Number(value) !== 0) {
      errors.push(`unsafe_mutation_boundary:${key}`);
    }
  }
  return { ok: errors.length === 0, evidenceClass: executor.evidenceClass, executor, errors };
}

export function buildEvidenceExecutorRegistry(options = {}) {
  const generatedAt = options.generatedAt || new Date().toISOString();
  const entries = readExecutorFiles(options.configDir || DEFAULT_EVIDENCE_EXECUTOR_CONFIG_DIR);
  const executors = entries.flatMap(executorsFromPayload).map(normalizeEvidenceExecutorManifest);
  const validations = executors.map(validateEvidenceExecutorManifest);
  const byClass = {};
  for (const validation of validations) {
    if (!validation.evidenceClass || byClass[validation.evidenceClass]) continue;
    byClass[validation.evidenceClass] = {
      ...validation.executor,
      valid: validation.ok,
      validationErrors: validation.errors,
    };
  }
  const missingClasses = REQUIRED_CLASSES.filter((evidenceClass) => !byClass[evidenceClass]);
  const invalidExecutors = Object.values(byClass).filter((executor) => !executor.valid);
  return {
    ok: missingClasses.length === 0 && invalidExecutors.length === 0,
    version: EVIDENCE_EXECUTOR_REGISTRY_VERSION,
    generatedAt,
    configDir: path.resolve(options.configDir || DEFAULT_EVIDENCE_EXECUTOR_CONFIG_DIR),
    requiredEvidenceClasses: [...REQUIRED_CLASSES],
    executorCount: Object.keys(byClass).length,
    executors: Object.values(byClass),
    missingClasses,
    invalidExecutors: invalidExecutors.map((executor) => executor.evidenceClass),
    classExecutorPlan: Object.fromEntries(Object.entries(byClass).map(([evidenceClass, executor]) => [evidenceClass, [...executor.routes]])),
    failureTaxonomy: [...BACKFILL_FAILURE_TAXONOMY],
    summary: {
      executorCount: Object.keys(byClass).length,
      requiredClassCoverage: REQUIRED_CLASSES.length ? (REQUIRED_CLASSES.length - missingClasses.length) / REQUIRED_CLASSES.length : 0,
      promotionDisabledClasses: Object.values(byClass).filter((executor) => executor.promotionEvidenceAllowed === false).map((executor) => executor.evidenceClass),
      localControlledMarketClasses: Object.values(byClass).filter((executor) => executor.requiresLocalControlledData).map((executor) => executor.evidenceClass),
    },
  };
}

export function buildEvidenceClassExecutorPlan(registry = buildEvidenceExecutorRegistry()) {
  return {
    ...registry.classExecutorPlan,
    supplier_capacity: registry.classExecutorPlan?.supplier_capacity || ['supplier_filing', 'official_capacity_announcement', 'contract_or_order_disclosure'],
  };
}

export function executorRoutesForEvidenceClass(evidenceClass, registry = buildEvidenceExecutorRegistry()) {
  return buildEvidenceClassExecutorPlan(registry)[evidenceClass] || ['source_query'];
}

export async function writeEvidenceExecutorRegistryArtifact(
  registry = buildEvidenceExecutorRegistry(),
  artifactPath = DEFAULT_EVIDENCE_EXECUTOR_ARTIFACT_PATH,
) {
  await mkdir(path.dirname(artifactPath), { recursive: true });
  await writeFile(artifactPath, `${JSON.stringify(registry, null, 2)}\n`, 'utf8');
  return path.resolve(artifactPath);
}
