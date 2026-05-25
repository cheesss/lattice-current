import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import {
  acceptSeedEvidenceRows,
  coveredEvidenceClassesFromAccepted,
} from './seed-evidence-acceptance.mjs';
import {
  collectCompanyIrReadonly,
} from './external-data/company-ir-readonly.mjs';
import {
  collectGridOfficialReadonly,
} from './external-data/grid-official-readonly.mjs';
import {
  collectFercInterconnectionReformReadonly,
} from './external-data/ferc-interconnection-reform-readonly.mjs';
import {
  collectIsoRtoInterconnectionQueueReportReadonly,
} from './external-data/iso-rto-interconnection-queue-report-readonly.mjs';
import {
  collectGridIssuerBridgeReadonly,
} from './external-data/grid-issuer-bridge-readonly.mjs';
import {
  collectDartIssuerExposureReadonly,
} from './external-data/dart-readonly.mjs';
import {
  collectEdinetIssuerExposureReadonly,
} from './external-data/edinet-readonly.mjs';
import {
  collectTdnetIssuerExposureReadonly,
} from './external-data/tdnet-readonly.mjs';
import {
  collectTaiwanMopsIssuerExposureReadonly,
} from './external-data/taiwan-mops-readonly.mjs';
import {
  collectDefensePropulsionHoldoutReadonlySync,
  collectDefensePropulsionIssuerBridgeReadonlySync,
  collectDefensePropulsionNegativeControlReadonlySync,
  isDefensePropulsionTarget,
} from './external-data/defense-propulsion-readonly.mjs';
import {
  buildProviderCollectorRegistry,
  collectorDefinitionForProvider,
  trackedCollectorProviderNames,
} from './provider-collector-registry.mjs';
import {
  EXTENDED_FAILURE_TAXONOMY,
} from './source-quality-score.mjs';

export const STAGED_PROVIDER_LIVE_EXECUTOR_VERSION = 'staged-provider-live-executor-v1';
export const DEFAULT_STAGED_PROVIDER_LIVE_EXECUTOR_PATH = path.join(process.cwd(), 'data', 'runtime', 'staged-provider-live-executor.latest.json');

const EXECUTABLE_STATUSES = new Set([
  'queued',
  'needs_operator_review',
  'queued_local_market_validation',
]);

const COMPANY_IR_CLASSES = new Set([
  'issuer_exposure',
  'holdout_validation',
  'negative_control',
]);

const FAILURE_TAXONOMY = Object.freeze([
  ...EXTENDED_FAILURE_TAXONOMY,
]);

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (value === null || value === undefined || value === '') return [];
  return [value];
}

function compact(value = '') {
  return String(value || '').replace(/\s+/g, ' ').trim();
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

function stableHash(value = '') {
  let hash = 2166136261;
  for (const char of String(value || '')) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function zeroBoundary(extra = {}) {
  return {
    providerActivationWrites: 0,
    sourceRegistryWrites: 0,
    canonicalWrites: 0,
    readinessPromotionWrites: 0,
    reportCandidateWrites: 0,
    portfolioActionWrites: 0,
    ...extra,
  };
}

function addCounts(rows = [], key = 'failureClassification') {
  const counts = {};
  for (const row of asArray(rows)) {
    const value = compact(row[key] || 'NO_RESULT');
    counts[value] = (counts[value] || 0) + 1;
  }
  return counts;
}

function writeBoundaryFromAcceptance(acceptance = {}) {
  return zeroBoundary({
    rawEvidenceWrites: acceptance.rawEvidenceStoredCount || 0,
    acceptedEvidenceWrites: acceptance.acceptedEvidenceStoredCount || 0,
  });
}

function collectorRegistrySummary(registry = {}) {
  return {
    available: Boolean(registry),
    ok: registry.ok === true,
    version: registry.version || null,
    collectorCount: registry.collectorCount || 0,
    providerCount: registry.providerCount || 0,
    providersWithCollectors: registry.providersWithCollectors || [],
    invalidCollectors: registry.invalidCollectors || [],
    missingProviderManifests: registry.missingProviderManifests || [],
  };
}

function collectorForProvider(providerName = '', registry = {}) {
  return collectorDefinitionForProvider(providerName, registry) || null;
}

function collectorProviderSet(registry = {}) {
  const names = trackedCollectorProviderNames(registry);
  return new Set(names);
}

function addCollectorMetadata(providerRun = {}, providerName = '', registry = {}) {
  const collector = collectorForProvider(providerName, registry);
  if (!collector) return providerRun;
  return {
    collectorId: collector.collectorId,
    collectorKind: collector.collectorKind,
    targetMode: collector.targetMode,
    ...providerRun,
  };
}

async function writeJson(filePath, payload) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  return path.resolve(filePath);
}

async function readJsonIfExists(filePath) {
  if (!existsSync(filePath)) return null;
  try {
    return JSON.parse(await readFile(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function normalizeTask(task = {}, index = 0) {
  const evidenceClass = compact(task.evidenceClass || task.desiredEvidenceClass || task.evidence_class || 'provider_data_gap');
  const seedId = compact(task.seedId || task.operatorSeedId || task.seed_id || 'autonomous-seed');
  return {
    ...task,
    taskId: compact(task.taskId || task.id || task.task_id || `staged-provider-task-${seedId}-${evidenceClass}-${index}`),
    seedId,
    evidenceClass,
    providerRoute: compact(task.providerRoute || task.route || task.provider_route || 'staged_provider'),
    status: compact(task.status || 'queued'),
    acceptanceCriteria: task.acceptanceCriteria || task.acceptance_criteria || {},
  };
}

function normalizeRecord(record = {}) {
  return {
    ...record,
    providerName: compact(record.providerName || record.provider || record.providerRoute).toLowerCase(),
    evidenceClass: compact(record.evidenceClass || record.fillsEvidenceClass),
    status: compact(record.status || 'discovered_untrusted'),
    fixtureStatus: compact(record.fixtureStatus),
    sourceType: compact(record.sourceType || record.candidate?.sourceType),
    allowlist: asArray(record.allowlist || record.candidate?.allowlist),
  };
}

function stagedRecords(sourceProviderActivation = {}) {
  return asArray(sourceProviderActivation.records)
    .map(normalizeRecord)
    .filter((record) => (
      ['staged', 'active_limited'].includes(record.status)
      && record.fixtureStatus === 'fixture_verified'
      && record.reviewGatedActivation === true
    ));
}

function executableTasks(backfillPlan = {}, options = {}) {
  const includeReview = options.includeOperatorReviewTasksForReadOnly !== false;
  return asArray(backfillPlan.tasks)
    .map(normalizeTask)
    .filter((task) => {
      if (!EXECUTABLE_STATUSES.has(task.status)) return false;
      if (task.status === 'needs_operator_review' && !includeReview) return false;
      if (task.evidenceClass === 'provider_data_gap') return false;
      if (task.evidenceClass === 'market_validation') return false;
      return true;
    });
}

function selectedSeedFromRepairLoop(repairLoop = {}, seedId = '') {
  const selected = repairLoop.selectedChildSeed
    || repairLoop.inputState?.selectedSeed
    || repairLoop.selectedSeed
    || repairLoop.dryRunReportSubject?.seed
    || null;
  if (!selected) return null;
  const requested = compact(seedId);
  if (!requested) return selected;
  const selectedIds = uniqueStrings([
    selected.seedId,
    selected.childSeedId,
    selected.parentSeedId,
    selected.operatorSeedId,
  ], 10);
  return selectedIds.includes(requested) ? selected : null;
}

function taskSubject(task = {}) {
  return compact(
    task.bottleneckNode
    || task.subject
    || task.seedTitle
    || task.acceptanceCriteria?.requiredTerms?.[0]
    || task.acceptanceCriteria?.description
    || task.sourceQuery
    || task.evidenceClass,
  );
}

function seedFromTaskGroup(tasks = [], repairLoop = {}) {
  const first = tasks[0] || {};
  const selected = selectedSeedFromRepairLoop(repairLoop, first.seedId);
  const requiredTerms = uniqueStrings(tasks.flatMap((task) => task.acceptanceCriteria?.requiredTerms), 30);
  const bridgeTerms = uniqueStrings(tasks.flatMap((task) => task.acceptanceCriteria?.bridgeTerms), 30);
  const issuerUniverse = uniqueStrings([
    selected?.issuerUniverse,
    selected?.issuerCandidates,
    selected?.routeIssuerCandidates,
    first.issuerUniverse,
    first.issuerCandidates,
  ], 40);
  return {
    ...(selected || {}),
    seedId: first.seedId || selected?.seedId || selected?.childSeedId || 'staged-provider-seed',
    childSeedId: selected?.childSeedId || first.childSeedId || null,
    seedTitle: selected?.seedTitle || taskSubject(first),
    bottleneckNode: selected?.bottleneckNode || taskSubject(first),
    bottleneck: {
      ...(selected?.bottleneck || {}),
      label: selected?.bottleneck?.label || selected?.bottleneckNode || taskSubject(first),
      class: selected?.childClass || selected?.bottleneck?.class || first.evidenceClass,
    },
    issuerCandidates: issuerUniverse,
    routeIssuerCandidates: issuerUniverse,
    issuerUniverse,
    issuerRoleCandidates: asArray(selected?.issuerRoleCandidates),
    acceptanceCriteria: {
      ...(selected?.acceptanceCriteria || {}),
      requiredTerms: uniqueStrings([
        selected?.acceptanceCriteria?.requiredTerms,
        requiredTerms,
      ], 60),
      bridgeTerms: uniqueStrings([
        selected?.acceptanceCriteria?.bridgeTerms,
        bridgeTerms,
      ], 60),
    },
  };
}

function groupCompanyIrTargets(tasks = [], records = [], options = {}) {
  const companyIrRecords = records.filter((record) => (
    record.providerName === 'company_ir_direct_pdf'
    && ['issuer_exposure', 'holdout_validation'].includes(record.evidenceClass)
  ));
  if (!companyIrRecords.length) return [];
  const grouped = new Map();
  for (const task of tasks.filter((item) => COMPANY_IR_CLASSES.has(item.evidenceClass))) {
    const key = task.seedId || 'autonomous-seed';
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(task);
  }
  return [...grouped.entries()].slice(0, Number(options.maxTargets || 5)).map(([seedId, taskGroup], index) => ({
    targetId: `company-ir:${seedId}:${index}`,
    providerName: 'company_ir_direct_pdf',
    seedId,
    tasks: taskGroup,
    records: companyIrRecords,
  }));
}

function genericProbeTargets(tasks = [], records = [], options = {}) {
  const targets = [];
  const collectorProviders = collectorProviderSet(options.providerCollectorRegistry || {});
  for (const task of tasks) {
    const matching = records.filter((record) => (
      record.evidenceClass === task.evidenceClass
      && !collectorProviders.has(record.providerName)
    ));
    for (const record of matching) {
      targets.push({
        targetId: `${record.providerName}:${task.taskId}`,
        providerName: record.providerName,
        seedId: task.seedId,
        task,
        record,
      });
    }
  }
  return targets.slice(0, Number(options.maxProviderProbeTargets || options.maxTargets || 5));
}

function seedText(seed = {}, tasks = []) {
  return compact([
    seed.seedId,
    seed.childSeedId,
    seed.seedTitle,
    seed.bottleneckNode,
    seed.bottleneck?.label,
    seed.bottleneck?.class,
    seed.mechanism,
    seed.childClass,
    seed.acceptanceCriteria?.requiredTerms,
    seed.acceptanceCriteria?.bridgeTerms,
    asArray(tasks).flatMap((task) => [
      task.taskId,
      task.evidenceClass,
      task.providerRoute,
      task.sourceQuery,
      task.acceptanceCriteria?.description,
      task.acceptanceCriteria?.requiredTerms,
      task.acceptanceCriteria?.bridgeTerms,
    ]),
  ].flat(Infinity).join(' ')).toLowerCase();
}

function isGridMechanismTarget(seed = {}, tasks = []) {
  const text = seedText(seed, tasks);
  return /interconnection|queue|ferc|lbnl|iso|rto|utility planning|grid operator|network upgrade|study delay|study backlog/.test(text);
}

function isFercInterconnectionReformTarget(seed = {}, tasks = []) {
  const text = seedText(seed, tasks);
  const routeMatched = asArray(tasks).some((task) => compact(task.providerRoute).toLowerCase() === 'ferc_interconnection_reform');
  const supportedEvidenceRoute = asArray(tasks).some((task) => ['engineering_process', 'permitting_regulatory'].includes(compact(task.evidenceClass).toLowerCase()));
  return routeMatched
    || (supportedEvidenceRoute && isGridMechanismTarget(seed, tasks))
    || /\bferc\b|interconnection reform|generator interconnection|order no\.?\s*2023|cluster study|commercial readiness|network upgrade|queue processing|study deadline|tariff revisions|compliance filing|site control|regulatory requirement/.test(text);
}

function isIsoRtoInterconnectionQueueReportTarget(seed = {}, tasks = []) {
  const text = seedText(seed, tasks);
  const routeMatched = asArray(tasks).some((task) => compact(task.providerRoute).toLowerCase() === 'iso_rto_interconnection_queue_report');
  const supportedEvidenceRoute = asArray(tasks).some((task) => compact(task.evidenceClass).toLowerCase() === 'engineering_process');
  return routeMatched
    || (supportedEvidenceRoute && isGridMechanismTarget(seed, tasks) && /\biso\b|\brto\b|\bpjm\b|\bmiso\b|\bcaiso\b|\bercot\b|\bspp\b|queue report|grid operator|study timeline|processing delay|network upgrade delay/.test(text));
}

function isGridIssuerBridgeTarget(seed = {}, tasks = []) {
  const text = seedText(seed, tasks);
  return /power delivery|transmission|substation|utility infrastructure|grid modernization|electric infrastructure|epc backlog|project backlog|pwr|acm|jacobs|\bj\b/.test(text);
}

function isDartIssuerExposureTarget(seed = {}, tasks = []) {
  const text = seedText(seed, tasks);
  const routeMatched = asArray(tasks).some((task) => compact(task.providerRoute).toLowerCase() === 'dart');
  return routeMatched || isOfficialIssuerFilingTarget(tasks) || /\bdart\b|korea|korean|samsung|005930|sk hynix|000660|\bhbm\b|dram|memory semiconductor|ai semiconductor/.test(text);
}

function isEdinetIssuerExposureTarget(seed = {}, tasks = []) {
  const text = seedText(seed, tasks);
  const routeMatched = asArray(tasks).some((task) => compact(task.providerRoute).toLowerCase() === 'edinet');
  return routeMatched || isOfficialIssuerFilingTarget(tasks) || /\bedinet\b|japan|japanese|ibiden|shinko|ajinomoto|\b4062\b/.test(text);
}

function isTdnetIssuerExposureTarget(seed = {}, tasks = []) {
  const text = seedText(seed, tasks);
  const routeMatched = asArray(tasks).some((task) => compact(task.providerRoute).toLowerCase() === 'tdnet');
  return routeMatched || isOfficialIssuerFilingTarget(tasks) || /\btdnet\b|timely disclosure|japan|japanese|ibiden|shinko|ajinomoto|\b4062\b/.test(text);
}

function isTaiwanMopsIssuerExposureTarget(seed = {}, tasks = []) {
  const text = seedText(seed, tasks);
  const routeMatched = asArray(tasks).some((task) => compact(task.providerRoute).toLowerCase() === 'taiwan_mops');
  return routeMatched || isOfficialIssuerFilingTarget(tasks) || /\btaiwan_mops\b|\bmops\b|taiwan|taiwanese|unimicron|nan ya|kinsus|\b3037\b|\b8046\b|\b3189\b/.test(text);
}

function isOfficialIssuerFilingTarget(tasks = []) {
  return asArray(tasks).some((task) => {
    const route = compact(task.providerRoute).toLowerCase();
    const evidenceClass = compact(task.evidenceClass).toLowerCase();
    if (evidenceClass !== 'issuer_exposure') return false;
    return /issuer.*filing|filing.*transcript|official.*filing|transcript.*contract|issuer_filing_transcript_or_contract/.test(route);
  });
}

function groupSingleTaskTargets(tasks = [], records = [], providerName = '', predicate = () => true, options = {}) {
  const matchedRecords = records.filter((record) => record.providerName === providerName);
  if (!matchedRecords.length) return [];
  const out = [];
  for (const task of tasks) {
    const taskRecords = matchedRecords.filter((record) => record.evidenceClass === task.evidenceClass);
    if (!taskRecords.length) continue;
    const seed = seedFromTaskGroup([task], options.repairLoop || {});
    if (!predicate(seed, [task])) continue;
    out.push({
      targetId: `${providerName}:${task.seedId}:${task.taskId}`,
      providerName,
      seedId: task.seedId,
      task,
      seed,
      records: taskRecords,
    });
  }
  return out;
}

function collectorTargets(tasks = [], records = [], options = {}) {
  const maxTargets = Number(options.maxTargets || 5);
  const registry = options.providerCollectorRegistry || {};
  const companyTargets = collectorForProvider('company_ir_direct_pdf', registry)
    ? groupCompanyIrTargets(tasks, records, options)
    : [];
  const remainingAfterCompany = Math.max(0, maxTargets - companyTargets.length);
  const gridMechanismTargets = collectorForProvider('grid_official_readonly', registry) ? groupSingleTaskTargets(
    tasks,
    records,
    'grid_official_readonly',
    isGridMechanismTarget,
    options,
  ).slice(0, remainingAfterCompany) : [];
  const remainingAfterGridMechanism = Math.max(0, maxTargets - companyTargets.length - gridMechanismTargets.length);
  const fercTargets = collectorForProvider('ferc_interconnection_reform', registry) ? groupSingleTaskTargets(
    tasks,
    records,
    'ferc_interconnection_reform',
    isFercInterconnectionReformTarget,
    options,
  ).slice(0, remainingAfterGridMechanism) : [];
  const remainingAfterFerc = Math.max(0, maxTargets - companyTargets.length - gridMechanismTargets.length - fercTargets.length);
  const isoRtoQueueTargets = collectorForProvider('iso_rto_interconnection_queue_report', registry) ? groupSingleTaskTargets(
    tasks,
    records,
    'iso_rto_interconnection_queue_report',
    isIsoRtoInterconnectionQueueReportTarget,
    options,
  ).slice(0, remainingAfterFerc) : [];
  const remainingAfterIsoRtoQueue = Math.max(0, maxTargets - companyTargets.length - gridMechanismTargets.length - fercTargets.length - isoRtoQueueTargets.length);
  const gridIssuerTargets = collectorForProvider('grid_issuer_bridge_readonly', registry) ? groupSingleTaskTargets(
    tasks,
    records,
    'grid_issuer_bridge_readonly',
    isGridIssuerBridgeTarget,
    options,
  ).slice(0, remainingAfterIsoRtoQueue) : [];
  const remainingAfterGridIssuer = Math.max(0, maxTargets - companyTargets.length - gridMechanismTargets.length - fercTargets.length - isoRtoQueueTargets.length - gridIssuerTargets.length);
  const defenseTargets = collectorForProvider('defense_propulsion_readonly', registry) ? groupSingleTaskTargets(
    tasks,
    records,
    'defense_propulsion_readonly',
    (seed, taskGroup) => isDefensePropulsionTarget(seed) || isDefensePropulsionTarget({ seed: seedFromTaskGroup(taskGroup, options.repairLoop || {}) }),
    options,
  ).slice(0, remainingAfterGridIssuer) : [];
  const remainingAfterDefense = Math.max(0, maxTargets - companyTargets.length - gridMechanismTargets.length - fercTargets.length - isoRtoQueueTargets.length - gridIssuerTargets.length - defenseTargets.length);
  const dartTargets = collectorForProvider('dart', registry) ? groupSingleTaskTargets(
    tasks,
    records,
    'dart',
    isDartIssuerExposureTarget,
    options,
  ).slice(0, remainingAfterDefense) : [];
  const remainingAfterDart = Math.max(0, maxTargets - companyTargets.length - gridMechanismTargets.length - fercTargets.length - isoRtoQueueTargets.length - gridIssuerTargets.length - defenseTargets.length - dartTargets.length);
  const edinetTargets = collectorForProvider('edinet', registry) ? groupSingleTaskTargets(
    tasks,
    records,
    'edinet',
    isEdinetIssuerExposureTarget,
    options,
  ).slice(0, remainingAfterDart) : [];
  const remainingAfterEdinet = Math.max(0, maxTargets - companyTargets.length - gridMechanismTargets.length - fercTargets.length - isoRtoQueueTargets.length - gridIssuerTargets.length - defenseTargets.length - dartTargets.length - edinetTargets.length);
  const tdnetTargets = collectorForProvider('tdnet', registry) ? groupSingleTaskTargets(
    tasks,
    records,
    'tdnet',
    isTdnetIssuerExposureTarget,
    options,
  ).slice(0, remainingAfterEdinet) : [];
  const remainingAfterTdnet = Math.max(0, maxTargets - companyTargets.length - gridMechanismTargets.length - fercTargets.length - isoRtoQueueTargets.length - gridIssuerTargets.length - defenseTargets.length - dartTargets.length - edinetTargets.length - tdnetTargets.length);
  const taiwanMopsTargets = collectorForProvider('taiwan_mops', registry) ? groupSingleTaskTargets(
    tasks,
    records,
    'taiwan_mops',
    isTaiwanMopsIssuerExposureTarget,
    options,
  ).slice(0, remainingAfterTdnet) : [];
  return [
    ...companyTargets,
    ...gridMechanismTargets,
    ...fercTargets,
    ...isoRtoQueueTargets,
    ...gridIssuerTargets,
    ...defenseTargets,
    ...dartTargets,
    ...edinetTargets,
    ...tdnetTargets,
    ...taiwanMopsTargets,
  ].slice(0, maxTargets);
}

function classifyProbeFailure(error, response = null, body = '') {
  if (response?.ok === true && compact(body)) return 'WEAK_EVIDENCE';
  if (response?.ok === true) return 'NO_RESULT';
  const text = compact(error?.name || error?.message || response?.status || '');
  if (/abort|timeout/i.test(text)) return 'TIMEOUT';
  if (/404|not found/i.test(text)) return 'NO_RESULT';
  if (text) return 'SOURCE_UNAVAILABLE';
  return 'NO_RESULT';
}

function probeUrlForRecord(record = {}) {
  const raw = compact(record.sourceUrl || record.candidate?.sourceUrl);
  if (raw) return raw;
  const host = asArray(record.allowlist || record.candidate?.allowlist).map(compact).find(Boolean);
  if (!host) return '';
  if (/^https?:\/\//i.test(host)) return host;
  return `https://${host.replace(/^\/+|\/+$/g, '')}/`;
}

async function fetchWithTimeout(url, {
  fetchImpl = globalThis.fetch,
  timeoutMs = 5000,
} = {}) {
  if (!fetchImpl) throw new Error('fetch_unavailable');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Number(timeoutMs || 5000));
  try {
    const response = await fetchImpl(url, { signal: controller.signal });
    const text = await response.text().catch(() => '');
    return { response, text };
  } finally {
    clearTimeout(timer);
  }
}

async function runGenericProviderProbe(target = {}, options = {}) {
  const now = options.generatedAt || new Date().toISOString();
  const { task, record } = target;
  const url = probeUrlForRecord(record);
  let failureClassification = 'NO_RESULT';
  let summary = `${record.providerName} staged provider has no bounded live document collector yet.`;
  let title = `${record.providerName} staged provider live probe`;
  if (url && options.executeLive !== false) {
    try {
      const { response, text } = await fetchWithTimeout(url, options);
      failureClassification = classifyProbeFailure(null, response, text);
      summary = response.ok
        ? `${record.providerName} staged provider endpoint responded, but no provider-specific parser promoted evidence from the bounded probe.`
        : `${record.providerName} staged provider endpoint did not return usable evidence. HTTP ${response.status}.`;
      title = `${record.providerName} staged provider endpoint probe`;
    } catch (error) {
      failureClassification = classifyProbeFailure(error);
      summary = `${record.providerName} staged provider endpoint probe failed: ${compact(error?.message || error) || failureClassification}.`;
    }
  }
  return {
    evidenceId: `staged-provider:${record.providerName}:${task.taskId}:${stableHash(url || target.targetId)}`,
    taskId: task.taskId,
    seedId: task.seedId,
    evidenceClass: task.evidenceClass,
    desiredEvidenceClass: task.evidenceClass,
    source: record.providerName,
    provider: record.providerName,
    sourceProvider: record.providerName,
    sourceType: record.sourceType || 'staged_provider_probe',
    sourceGroup: record.sourceType || 'staged_provider_probe',
    providerRoute: record.providerRoute || task.providerRoute,
    sourceUrl: url,
    title,
    summary,
    observedAt: now,
    publishedAt: now,
    evidenceUse: 'weak_noise',
    acceptanceVerdict: 'not_evaluated_provider_live_probe',
    promotionEligible: false,
    failureClassification,
    fixtureBackedProviderExecution: false,
    stagedProviderLiveExecution: true,
    providerCollectorStatus: 'collector_not_implemented_or_no_direct_document_result',
    mutationBoundary: zeroBoundary(),
  };
}

async function runCompanyIrTarget(target = {}, options = {}) {
  const seed = seedFromTaskGroup(target.tasks, options.repairLoop || {});
  const collected = await collectCompanyIrReadonly({
    seed,
    tasks: target.tasks,
    fetchImpl: options.fetchImpl || globalThis.fetch,
    timeoutMs: options.timeoutMs || 8000,
    maxDocuments: options.companyIrMaxDocuments || 6,
    maxDocumentsPerIssuer: options.companyIrMaxDocumentsPerIssuer || 2,
    rateLimitMs: options.rateLimitMs ?? 0,
    generatedAt: options.generatedAt || new Date().toISOString(),
  });
  return {
    target,
    collected,
    rawEvidence: asArray(collected.rawEvidence).map((row) => ({
      ...row,
      fixtureBackedProviderExecution: false,
      stagedProviderLiveExecution: true,
      validationFixtureOnly: false,
      providerExecutionStatus: 'staged_provider_live_bounded',
    })),
    providerRun: addCollectorMetadata({
      targetId: target.targetId,
      providerName: target.providerName,
      seedId: target.seedId,
      taskIds: target.tasks.map((task) => task.taskId),
      evidenceClasses: uniqueStrings(target.tasks.map((task) => task.evidenceClass), 10),
      rawEvidenceCount: collected.rawEvidence?.length || 0,
      acceptedCandidateCount: collected.companyIrCollectorStatus?.acceptedCandidateCount || 0,
      failureClassifications: collected.companyIrCollectorStatus?.failureModes || [],
      collectorStatus: collected.companyIrCollectorStatus || {},
    }, target.providerName, options.providerCollectorRegistry || {}),
  };
}

function rowsForTask(rows = [], task = {}) {
  return asArray(rows).map((row, index) => ({
    ...row,
    evidenceId: row.evidenceId || `staged-provider:${task.taskId}:${index}`,
    taskId: task.taskId,
    seedId: task.seedId,
    evidenceClass: task.evidenceClass,
    desiredEvidenceClass: task.evidenceClass,
    summary: row.summary || row.extractedTextSnippet || row.matchedSnippet || row.textExcerpt || '',
    textExcerpt: row.textExcerpt || row.extractedTextSnippet || row.matchedSnippet || row.summary || '',
    stagedProviderLiveExecution: true,
    validationFixtureOnly: row.validationFixtureOnly === true ? true : false,
    providerExecutionStatus: 'staged_provider_live_bounded',
    mutationBoundary: zeroBoundary(row.mutationBoundary || {}),
  }));
}

function normalizeDefenseRows(rows = [], task = {}) {
  return rowsForTask(rows, task).map((row) => {
    if (row.failureClassification !== 'ACCEPTED_CANDIDATE') return row;
    if (task.evidenceClass === 'negative_control') return row;
    return {
      ...row,
      acceptanceVerdict: task.evidenceClass === 'holdout_validation'
        ? 'official_route_holdout_direct_candidate'
        : 'official_route_direct_candidate',
      evidenceUse: task.evidenceClass === 'holdout_validation' ? 'supporting_context' : 'promotion_candidate',
      promotionEligible: task.evidenceClass !== 'holdout_validation',
      failureClassification: 'ACCEPTED',
    };
  });
}

function runGridOfficialTarget(target = {}, options = {}) {
  const collected = collectGridOfficialReadonly({
    seedId: target.task.seedId,
    trackId: target.task.trackId || 'mechanism_validation_track',
    generatedAt: options.generatedAt || new Date().toISOString(),
    maxSources: options.gridOfficialMaxSources || 4,
  });
  return {
    rawEvidence: rowsForTask(collected.rawEvidence, target.task),
    providerRun: addCollectorMetadata({
      targetId: target.targetId,
      providerName: target.providerName,
      seedId: target.seedId,
      taskIds: [target.task.taskId],
      evidenceClasses: [target.task.evidenceClass],
      rawEvidenceCount: collected.rawEvidence.length,
      acceptedCandidateCount: collected.rawEvidence.filter((row) => row.accepted === true).length,
      failureClassifications: Object.keys(collected.failureClassifications || {}),
      collectorStatus: {
        source: collected.source,
        sourceGroupsUsed: collected.sourceGroupsUsed,
        sourceFamiliesUsed: collected.sourceFamiliesUsed,
        fixtureRequired: collected.fixtureRequired === true,
      },
    }, target.providerName, options.providerCollectorRegistry || {}),
  };
}

function runFercInterconnectionReformTarget(target = {}, options = {}) {
  const collected = collectFercInterconnectionReformReadonly({
    seedId: target.task.seedId,
    task: target.task,
    generatedAt: options.generatedAt || new Date().toISOString(),
    maxSources: options.fercInterconnectionReformMaxSources || 5,
  });
  const rawEvidence = rowsForTask(collected.rawEvidence, target.task);
  return {
    rawEvidence,
    providerRun: addCollectorMetadata({
      targetId: target.targetId,
      providerName: target.providerName,
      seedId: target.seedId,
      taskIds: [target.task.taskId],
      evidenceClasses: [target.task.evidenceClass],
      rawEvidenceCount: rawEvidence.length,
      acceptedCandidateCount: rawEvidence.filter((row) => row.accepted === true).length,
      failureClassifications: Object.keys(collected.failureClassifications || {}),
      collectorStatus: {
        sourceGroupsUsed: collected.sourceGroupsUsed,
        sourceFamiliesUsed: collected.sourceFamiliesUsed,
        fixtureKindsCovered: collected.fixtureKindsCovered,
        fixtureRequired: collected.fixtureRequired === true,
        acceptanceSafety: collected.acceptanceSafety,
      },
    }, target.providerName, options.providerCollectorRegistry || {}),
  };
}

function runIsoRtoInterconnectionQueueReportTarget(target = {}, options = {}) {
  const collected = collectIsoRtoInterconnectionQueueReportReadonly({
    seedId: target.task.seedId,
    task: target.task,
    generatedAt: options.generatedAt || new Date().toISOString(),
    maxSources: options.isoRtoInterconnectionQueueReportMaxSources || 5,
  });
  const rawEvidence = rowsForTask(collected.rawEvidence, target.task);
  return {
    rawEvidence,
    providerRun: addCollectorMetadata({
      targetId: target.targetId,
      providerName: target.providerName,
      seedId: target.seedId,
      taskIds: [target.task.taskId],
      evidenceClasses: [target.task.evidenceClass],
      rawEvidenceCount: rawEvidence.length,
      acceptedCandidateCount: rawEvidence.filter((row) => row.accepted === true).length,
      failureClassifications: Object.keys(collected.failureClassifications || {}),
      collectorStatus: {
        sourceGroupsUsed: collected.sourceGroupsUsed,
        sourceFamiliesUsed: collected.sourceFamiliesUsed,
        fixtureKindsCovered: collected.fixtureKindsCovered,
        fixtureRequired: collected.fixtureRequired === true,
        acceptanceSafety: collected.acceptanceSafety,
      },
    }, target.providerName, options.providerCollectorRegistry || {}),
  };
}

function runGridIssuerBridgeTarget(target = {}, options = {}) {
  const collected = collectGridIssuerBridgeReadonly({
    seedId: target.task.seedId,
    trackId: target.task.trackId || 'issuer_bridge_track',
    generatedAt: options.generatedAt || new Date().toISOString(),
    maxSources: options.gridIssuerMaxSources || 3,
  });
  return {
    rawEvidence: rowsForTask(collected.rawEvidence, target.task),
    providerRun: addCollectorMetadata({
      targetId: target.targetId,
      providerName: target.providerName,
      seedId: target.seedId,
      taskIds: [target.task.taskId],
      evidenceClasses: [target.task.evidenceClass],
      rawEvidenceCount: collected.rawEvidence.length,
      acceptedCandidateCount: collected.rawEvidence.filter((row) => row.accepted === true).length,
      failureClassifications: Object.keys(collected.failureClassifications || {}),
      collectorStatus: {
        source: collected.source,
        sourceGroupsUsed: collected.sourceGroupsUsed,
        sourceFamiliesUsed: collected.sourceFamiliesUsed,
        issuerCandidates: collected.issuerCandidates,
        issuerRoleClasses: collected.issuerRoleClasses,
        fixtureRequired: collected.fixtureRequired === true,
      },
    }, target.providerName, options.providerCollectorRegistry || {}),
  };
}

function runDartIssuerExposureTarget(target = {}, options = {}) {
  const collected = collectDartIssuerExposureReadonly({
    seedId: target.task.seedId,
    task: target.task,
    generatedAt: options.generatedAt || new Date().toISOString(),
    maxSources: options.dartMaxSources || 5,
  });
  const rawEvidence = rowsForTask(collected.rawEvidence, target.task);
  return {
    rawEvidence,
    providerRun: addCollectorMetadata({
      targetId: target.targetId,
      providerName: target.providerName,
      seedId: target.seedId,
      taskIds: [target.task.taskId],
      evidenceClasses: [target.task.evidenceClass],
      rawEvidenceCount: rawEvidence.length,
      acceptedCandidateCount: rawEvidence.filter((row) => row.accepted === true).length,
      failureClassifications: Object.keys(collected.failureClassifications || {}),
      collectorStatus: {
        sourceGroupsUsed: collected.sourceGroupsUsed,
        sourceFamiliesUsed: collected.sourceFamiliesUsed,
        fixtureKindsCovered: collected.fixtureKindsCovered,
        fixtureRequired: collected.fixtureRequired === true,
        acceptanceSafety: collected.acceptanceSafety,
      },
    }, target.providerName, options.providerCollectorRegistry || {}),
  };
}

function runEdinetIssuerExposureTarget(target = {}, options = {}) {
  const collected = collectEdinetIssuerExposureReadonly({
    seedId: target.task.seedId,
    task: target.task,
    generatedAt: options.generatedAt || new Date().toISOString(),
    maxSources: options.edinetMaxSources || 5,
  });
  const rawEvidence = rowsForTask(collected.rawEvidence, target.task);
  return {
    rawEvidence,
    providerRun: addCollectorMetadata({
      targetId: target.targetId,
      providerName: target.providerName,
      seedId: target.seedId,
      taskIds: [target.task.taskId],
      evidenceClasses: [target.task.evidenceClass],
      rawEvidenceCount: rawEvidence.length,
      acceptedCandidateCount: rawEvidence.filter((row) => row.accepted === true).length,
      failureClassifications: Object.keys(collected.failureClassifications || {}),
      collectorStatus: {
        sourceGroupsUsed: collected.sourceGroupsUsed,
        sourceFamiliesUsed: collected.sourceFamiliesUsed,
        fixtureKindsCovered: collected.fixtureKindsCovered,
        fixtureRequired: collected.fixtureRequired === true,
        acceptanceSafety: collected.acceptanceSafety,
      },
    }, target.providerName, options.providerCollectorRegistry || {}),
  };
}

function runTdnetIssuerExposureTarget(target = {}, options = {}) {
  const collected = collectTdnetIssuerExposureReadonly({
    seedId: target.task.seedId,
    task: target.task,
    generatedAt: options.generatedAt || new Date().toISOString(),
    maxSources: options.tdnetMaxSources || 5,
  });
  const rawEvidence = rowsForTask(collected.rawEvidence, target.task);
  return {
    rawEvidence,
    providerRun: addCollectorMetadata({
      targetId: target.targetId,
      providerName: target.providerName,
      seedId: target.seedId,
      taskIds: [target.task.taskId],
      evidenceClasses: [target.task.evidenceClass],
      rawEvidenceCount: rawEvidence.length,
      acceptedCandidateCount: rawEvidence.filter((row) => row.accepted === true).length,
      failureClassifications: Object.keys(collected.failureClassifications || {}),
      collectorStatus: {
        sourceGroupsUsed: collected.sourceGroupsUsed,
        sourceFamiliesUsed: collected.sourceFamiliesUsed,
        fixtureKindsCovered: collected.fixtureKindsCovered,
        fixtureRequired: collected.fixtureRequired === true,
        acceptanceSafety: collected.acceptanceSafety,
      },
    }, target.providerName, options.providerCollectorRegistry || {}),
  };
}

function runTaiwanMopsIssuerExposureTarget(target = {}, options = {}) {
  const collected = collectTaiwanMopsIssuerExposureReadonly({
    seedId: target.task.seedId,
    task: target.task,
    generatedAt: options.generatedAt || new Date().toISOString(),
    maxSources: options.taiwanMopsMaxSources || 5,
  });
  const rawEvidence = rowsForTask(collected.rawEvidence, target.task);
  return {
    rawEvidence,
    providerRun: addCollectorMetadata({
      targetId: target.targetId,
      providerName: target.providerName,
      seedId: target.seedId,
      taskIds: [target.task.taskId],
      evidenceClasses: [target.task.evidenceClass],
      rawEvidenceCount: rawEvidence.length,
      acceptedCandidateCount: rawEvidence.filter((row) => row.accepted === true).length,
      failureClassifications: Object.keys(collected.failureClassifications || {}),
      collectorStatus: {
        sourceGroupsUsed: collected.sourceGroupsUsed,
        sourceFamiliesUsed: collected.sourceFamiliesUsed,
        fixtureKindsCovered: collected.fixtureKindsCovered,
        fixtureRequired: collected.fixtureRequired === true,
        acceptanceSafety: collected.acceptanceSafety,
      },
    }, target.providerName, options.providerCollectorRegistry || {}),
  };
}

function runDefensePropulsionTarget(target = {}, options = {}) {
  const common = {
    seed: target.seed || seedFromTaskGroup([target.task], options.repairLoop || {}),
    trackId: target.task.trackId || 'issuer_bridge_track',
    generatedAt: options.generatedAt || new Date().toISOString(),
    maxSources: options.defenseMaxSources || 4,
  };
  const collected = target.task.evidenceClass === 'negative_control'
    ? collectDefensePropulsionNegativeControlReadonlySync(common)
    : target.task.evidenceClass === 'holdout_validation'
      ? collectDefensePropulsionHoldoutReadonlySync(common)
      : collectDefensePropulsionIssuerBridgeReadonlySync(common);
  const rawEvidence = normalizeDefenseRows(collected.rawEvidence, target.task);
  return {
    rawEvidence,
    providerRun: addCollectorMetadata({
      targetId: target.targetId,
      providerName: target.providerName,
      seedId: target.seedId,
      taskIds: [target.task.taskId],
      evidenceClasses: [target.task.evidenceClass],
      rawEvidenceCount: rawEvidence.length,
      acceptedCandidateCount: rawEvidence.filter((row) => row.acceptanceVerdict === 'official_route_direct_candidate' || row.acceptanceVerdict === 'accepted').length,
      failureClassifications: uniqueStrings(rawEvidence.map((row) => row.failureClassification), 20),
      collectorStatus: {
        sourceGroupsUsed: collected.sourceGroupsUsed,
        sourceFamiliesUsed: collected.sourceFamiliesUsed,
        issuers: collected.issuers,
        fixtureRequired: collected.fixtureRequired === true,
        negativeControlScope: collected.scope || null,
      },
    }, target.providerName, options.providerCollectorRegistry || {}),
  };
}

export async function buildStagedProviderLiveExecutorPayload(input = {}, options = {}) {
  const sourceProviderActivation = input.sourceProviderActivation || {};
  const backfillPlan = input.backfillPlan || { tasks: [] };
  const records = stagedRecords(sourceProviderActivation);
  const tasks = executableTasks(backfillPlan, options);
  const now = options.generatedAt || new Date().toISOString();
  const providerCollectorRegistry = options.providerCollectorRegistry || buildProviderCollectorRegistry({
    generatedAt: now,
  });
  const boundedCollectorTargets = collectorTargets(tasks, records, {
    ...options,
    providerCollectorRegistry,
    repairLoop: input.repairLoop,
  });
  const genericTargets = genericProbeTargets(tasks, records, {
    ...options,
    providerCollectorRegistry,
    maxProviderProbeTargets: Math.max(0, Number(options.maxTargets || 5) - boundedCollectorTargets.length),
  });
  const targets = options.executeLive === false
    ? []
    : [...boundedCollectorTargets, ...genericTargets].slice(0, Number(options.maxTargets || 5));
  const rawEvidence = [];
  const providerRuns = [];
  const taskResults = [];

  for (const target of targets) {
    const collector = collectorForProvider(target.providerName, providerCollectorRegistry);
    const collectorKind = collector?.collectorKind || target.providerName;
    if (collectorKind === 'company_ir_document_extraction') {
      const run = await runCompanyIrTarget(target, {
        ...options,
        repairLoop: input.repairLoop,
        providerCollectorRegistry,
        generatedAt: now,
      });
      rawEvidence.push(...run.rawEvidence);
      providerRuns.push(run.providerRun);
      for (const task of target.tasks) {
        taskResults.push({
          taskId: task.taskId,
          seedId: task.seedId,
          evidenceClass: task.evidenceClass,
          providerName: target.providerName,
          collectorId: collector?.collectorId || null,
          collectorKind,
          statusBefore: task.status,
          statusAfter: run.rawEvidence.some((row) => row.taskId === task.taskId) ? 'executed_staged_provider_live_pending_acceptance' : task.status,
          rawEvidenceCount: run.rawEvidence.filter((row) => row.taskId === task.taskId).length,
        });
      }
    } else if (collectorKind === 'grid_mechanism_validation') {
      const run = runGridOfficialTarget(target, { ...options, generatedAt: now, providerCollectorRegistry });
      rawEvidence.push(...run.rawEvidence);
      providerRuns.push(run.providerRun);
      taskResults.push({
        taskId: target.task.taskId,
        seedId: target.task.seedId,
        evidenceClass: target.task.evidenceClass,
        providerName: target.providerName,
        collectorId: collector?.collectorId || null,
        collectorKind,
        statusBefore: target.task.status,
        statusAfter: run.rawEvidence.length ? 'executed_staged_provider_live_pending_acceptance' : target.task.status,
        rawEvidenceCount: run.rawEvidence.length,
      });
    } else if (collectorKind === 'ferc_interconnection_reform_engineering_process') {
      const run = runFercInterconnectionReformTarget(target, { ...options, generatedAt: now, providerCollectorRegistry });
      rawEvidence.push(...run.rawEvidence);
      providerRuns.push(run.providerRun);
      taskResults.push({
        taskId: target.task.taskId,
        seedId: target.task.seedId,
        evidenceClass: target.task.evidenceClass,
        providerName: target.providerName,
        collectorId: collector?.collectorId || null,
        collectorKind,
        statusBefore: target.task.status,
        statusAfter: run.rawEvidence.length ? 'executed_staged_provider_live_pending_acceptance' : target.task.status,
        rawEvidenceCount: run.rawEvidence.length,
      });
    } else if (collectorKind === 'iso_rto_interconnection_queue_report_engineering_process') {
      const run = runIsoRtoInterconnectionQueueReportTarget(target, { ...options, generatedAt: now, providerCollectorRegistry });
      rawEvidence.push(...run.rawEvidence);
      providerRuns.push(run.providerRun);
      taskResults.push({
        taskId: target.task.taskId,
        seedId: target.task.seedId,
        evidenceClass: target.task.evidenceClass,
        providerName: target.providerName,
        collectorId: collector?.collectorId || null,
        collectorKind,
        statusBefore: target.task.status,
        statusAfter: run.rawEvidence.length ? 'executed_staged_provider_live_pending_acceptance' : target.task.status,
        rawEvidenceCount: run.rawEvidence.length,
      });
    } else if (collectorKind === 'grid_issuer_bridge') {
      const run = runGridIssuerBridgeTarget(target, { ...options, generatedAt: now, providerCollectorRegistry });
      rawEvidence.push(...run.rawEvidence);
      providerRuns.push(run.providerRun);
      taskResults.push({
        taskId: target.task.taskId,
        seedId: target.task.seedId,
        evidenceClass: target.task.evidenceClass,
        providerName: target.providerName,
        collectorId: collector?.collectorId || null,
        collectorKind,
        statusBefore: target.task.status,
        statusAfter: run.rawEvidence.length ? 'executed_staged_provider_live_pending_acceptance' : target.task.status,
        rawEvidenceCount: run.rawEvidence.length,
      });
    } else if (collectorKind === 'dart_issuer_exposure') {
      const run = runDartIssuerExposureTarget(target, { ...options, generatedAt: now, providerCollectorRegistry });
      rawEvidence.push(...run.rawEvidence);
      providerRuns.push(run.providerRun);
      taskResults.push({
        taskId: target.task.taskId,
        seedId: target.task.seedId,
        evidenceClass: target.task.evidenceClass,
        providerName: target.providerName,
        collectorId: collector?.collectorId || null,
        collectorKind,
        statusBefore: target.task.status,
        statusAfter: run.rawEvidence.length ? 'executed_staged_provider_live_pending_acceptance' : target.task.status,
        rawEvidenceCount: run.rawEvidence.length,
      });
    } else if (collectorKind === 'edinet_issuer_exposure') {
      const run = runEdinetIssuerExposureTarget(target, { ...options, generatedAt: now, providerCollectorRegistry });
      rawEvidence.push(...run.rawEvidence);
      providerRuns.push(run.providerRun);
      taskResults.push({
        taskId: target.task.taskId,
        seedId: target.task.seedId,
        evidenceClass: target.task.evidenceClass,
        providerName: target.providerName,
        collectorId: collector?.collectorId || null,
        collectorKind,
        statusBefore: target.task.status,
        statusAfter: run.rawEvidence.length ? 'executed_staged_provider_live_pending_acceptance' : target.task.status,
        rawEvidenceCount: run.rawEvidence.length,
      });
    } else if (collectorKind === 'tdnet_issuer_exposure') {
      const run = runTdnetIssuerExposureTarget(target, { ...options, generatedAt: now, providerCollectorRegistry });
      rawEvidence.push(...run.rawEvidence);
      providerRuns.push(run.providerRun);
      taskResults.push({
        taskId: target.task.taskId,
        seedId: target.task.seedId,
        evidenceClass: target.task.evidenceClass,
        providerName: target.providerName,
        collectorId: collector?.collectorId || null,
        collectorKind,
        statusBefore: target.task.status,
        statusAfter: run.rawEvidence.length ? 'executed_staged_provider_live_pending_acceptance' : target.task.status,
        rawEvidenceCount: run.rawEvidence.length,
      });
    } else if (collectorKind === 'taiwan_mops_issuer_exposure') {
      const run = runTaiwanMopsIssuerExposureTarget(target, { ...options, generatedAt: now, providerCollectorRegistry });
      rawEvidence.push(...run.rawEvidence);
      providerRuns.push(run.providerRun);
      taskResults.push({
        taskId: target.task.taskId,
        seedId: target.task.seedId,
        evidenceClass: target.task.evidenceClass,
        providerName: target.providerName,
        collectorId: collector?.collectorId || null,
        collectorKind,
        statusBefore: target.task.status,
        statusAfter: run.rawEvidence.length ? 'executed_staged_provider_live_pending_acceptance' : target.task.status,
        rawEvidenceCount: run.rawEvidence.length,
      });
    } else if (collectorKind === 'defense_propulsion_official') {
      const run = runDefensePropulsionTarget(target, { ...options, generatedAt: now, repairLoop: input.repairLoop, providerCollectorRegistry });
      rawEvidence.push(...run.rawEvidence);
      providerRuns.push(run.providerRun);
      taskResults.push({
        taskId: target.task.taskId,
        seedId: target.task.seedId,
        evidenceClass: target.task.evidenceClass,
        providerName: target.providerName,
        collectorId: collector?.collectorId || null,
        collectorKind,
        statusBefore: target.task.status,
        statusAfter: run.rawEvidence.length ? 'executed_staged_provider_live_pending_acceptance' : target.task.status,
        rawEvidenceCount: run.rawEvidence.length,
      });
    } else {
      const row = await runGenericProviderProbe(target, { ...options, generatedAt: now });
      rawEvidence.push(row);
      providerRuns.push({
        targetId: target.targetId,
        providerName: target.providerName,
        collectorId: null,
        collectorKind: 'generic_staged_provider_probe',
        seedId: target.seedId,
        taskIds: [target.task.taskId],
        evidenceClasses: [target.task.evidenceClass],
        rawEvidenceCount: 1,
        acceptedCandidateCount: 0,
        failureClassifications: [row.failureClassification],
        collectorStatus: row.providerCollectorStatus,
      });
      taskResults.push({
        taskId: target.task.taskId,
        seedId: target.task.seedId,
        evidenceClass: target.task.evidenceClass,
        providerName: target.providerName,
        collectorId: null,
        collectorKind: 'generic_staged_provider_probe',
        statusBefore: target.task.status,
        statusAfter: 'executed_staged_provider_probe_raw_only',
        rawEvidenceCount: 1,
      });
    }
  }

  const acceptance = acceptSeedEvidenceRows(rawEvidence, {
    tasks,
    now: new Date(now),
  });
  const acceptedPromotionEvidence = acceptance.acceptedEvidence
    .filter((row) => row.promotionEligible === true && row.validationFixtureOnly !== true);
  return {
    ok: true,
    version: STAGED_PROVIDER_LIVE_EXECUTOR_VERSION,
    generatedAt: now,
    mode: options.mode || 'execute-safe-artifact',
    source: 'staged-provider-live-executor',
    executeLive: options.executeLive !== false,
    stagedProviderCount: records.length,
    executableTaskCount: tasks.length,
    providerCollectorRegistry: collectorRegistrySummary(providerCollectorRegistry),
    targetCount: targets.length,
    executedTargetCount: providerRuns.length,
    targets: targets.map((target) => ({
      targetId: target.targetId,
      providerName: target.providerName,
      collectorId: collectorForProvider(target.providerName, providerCollectorRegistry)?.collectorId || null,
      collectorKind: collectorForProvider(target.providerName, providerCollectorRegistry)?.collectorKind || 'generic_staged_provider_probe',
      seedId: target.seedId,
      taskIds: target.tasks ? target.tasks.map((task) => task.taskId) : [target.task?.taskId],
      evidenceClasses: target.tasks ? uniqueStrings(target.tasks.map((task) => task.evidenceClass), 10) : [target.task?.evidenceClass].filter(Boolean),
    })),
    providerRuns,
    taskResults,
    failureTaxonomy: [...FAILURE_TAXONOMY],
    failureClassificationCounts: addCounts(acceptance.rawEvidence),
    rawEvidence: acceptance.rawEvidence,
    acceptedEvidence: acceptance.acceptedEvidence,
    acceptedPromotionEvidence,
    rawEvidenceStoredCount: acceptance.rawEvidenceStoredCount,
    acceptedEvidenceStoredCount: acceptance.acceptedEvidenceStoredCount,
    acceptedPromotionEvidenceStoredCount: acceptedPromotionEvidence.length,
    coveredEvidenceClasses: coveredEvidenceClassesFromAccepted(acceptedPromotionEvidence),
    readinessChanged: false,
    nextActionHint: acceptedPromotionEvidence.length
      ? 're_evaluate_negative_holdout_issuer_market_gates'
      : providerRuns.some((run) => asArray(run.failureClassifications).includes('SOURCE_UNAVAILABLE'))
        ? 'quarantine_or_retry_unavailable_staged_provider'
        : 'continue_bounded_provider_collection_or_create_provider_gap',
    mutationBoundaries: writeBoundaryFromAcceptance(acceptance),
    providerExecutionBoundary: {
      providerActivationWrites: 0,
      canonicalWrites: 0,
      sourceRegistryWrites: 0,
      approvalQueueWrites: 0,
      readinessPromotionWrites: 0,
      reportCandidateWrites: 0,
      portfolioActionWrites: 0,
    },
    safety: {
      providerActivationAllowed: false,
      readinessPromotionAllowed: false,
      reportCandidateWriteAllowed: false,
      activeUsageRequiresStagedOrActiveLimitedProvider: true,
      fixtureOnlyPromotionEvidenceAllowed: false,
      rawEvidencePromotesReadiness: false,
    },
  };
}

export async function runStagedProviderLiveExecutor(input = {}, options = {}) {
  const artifactPath = options.artifactPath || DEFAULT_STAGED_PROVIDER_LIVE_EXECUTOR_PATH;
  const payload = await buildStagedProviderLiveExecutorPayload(input, options);
  if (options.writeArtifact !== false) payload.artifactPath = await writeJson(artifactPath, payload);
  return payload;
}

export async function loadLatestStagedProviderLiveExecutorArtifact(filePath = DEFAULT_STAGED_PROVIDER_LIVE_EXECUTOR_PATH) {
  return await readJsonIfExists(filePath);
}
