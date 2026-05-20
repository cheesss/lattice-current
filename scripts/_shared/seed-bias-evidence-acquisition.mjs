import {
  evaluateAutonomousSeedReportCandidateGate,
} from './seed-bias-diagnostics.mjs';
import {
  acceptSeedEvidenceRows,
} from './seed-evidence-acceptance.mjs';
import {
  buildRouteAwareSeedEvidencePlan,
} from './seed-evidence-plan.mjs';
import {
  parseExternalRssItems,
  scoreSourceQueryBundle,
} from './source-query-executor.mjs';

export const SEED_BIAS_EVIDENCE_ACQUISITION_VERSION = 'seed-bias-evidence-acquisition-v1';

export const DEFAULT_SEED_BIAS_ACQUISITION_CLASSES = Object.freeze([
  'negative_control',
  'holdout_validation',
  'issuer_exposure',
]);

const HOLDOUT_SOURCE_GROUPS = Object.freeze([
  'official_government',
  'sec_ir_transcript',
  'trade_media',
  'provider_feed',
]);

const NEGATIVE_QUERY_FAMILIES = Object.freeze([
  'easy substitutes',
  'supplier redundancy',
  'no timing pressure',
  'no capacity constraint',
  'no issuer exposure',
  'management denies constraint',
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

function safeId(value = '') {
  return compact(value).replace(/[^a-zA-Z0-9_.:-]+/g, '-').replace(/^-+|-+$/g, '') || 'item';
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

function seedTitle(seed = {}) {
  return compact(seed.seedTitle || seed.seed_title || seed.bottleneck?.label || seedId(seed));
}

function seedSubject(seed = {}) {
  return compact(seed.bottleneck?.label || seedTitle(seed));
}

function taskPayload(task = {}) {
  return task.payload || task;
}

function taskId(task = {}) {
  return compact(task.task_id || task.taskId || task.payload?.taskId);
}

function taskEvidenceClass(task = {}) {
  return compact(task.evidence_class || task.evidenceClass || task.payload?.evidenceClass);
}

function taskSeedId(task = {}) {
  return compact(task.seed_id || task.seedId || task.payload?.seedId);
}

function providerRoute(task = {}) {
  return compact(task.provider_route || task.providerRoute || task.payload?.providerRoute);
}

function acceptanceCriteria(task = {}) {
  return task.acceptance_criteria || task.acceptanceCriteria || task.payload?.acceptanceCriteria || {};
}

function firstSourceQuery(task = {}) {
  const payload = taskPayload(task);
  return compact(task.source_query || payload.sourceQuery || payload.sourceQueryDrafts?.[0]?.query);
}

function taskSourceQueryDrafts(task = {}) {
  const payload = taskPayload(task);
  return uniqueStrings([
    firstSourceQuery(task),
    asArray(payload.sourceQueryDrafts).map((draft) => draft.query || draft),
  ], 12);
}

function rawBase(task = {}, seed = {}, options = {}) {
  const klass = taskEvidenceClass(task);
  return {
    seedId: taskSeedId(task) || seedId(seed),
    taskId: taskId(task),
    evidenceClass: klass,
    desiredEvidenceClass: klass,
    providerRoute: providerRoute(task),
    source: 'seed-bias-class-limited-acquisition',
    sourceType: 'source_query_task',
    createdAt: options.generatedAt || new Date().toISOString(),
    accepted: false,
    acceptanceVerdict: 'not_evaluated_task_ready',
    acquisitionStatus: 'source_query_task_ready',
    executionBoundary: {
      providerActivationWrites: 0,
      sourceRegistryWrites: 0,
      canonicalWrites: 0,
      reportPromotionWrites: 0,
    },
  };
}

function negativeControlRawEvidence(task = {}, seed = {}, options = {}) {
  const subject = seedSubject(seed);
  return NEGATIVE_QUERY_FAMILIES.map((family) => {
    const query = `${subject} ${family}`;
    return {
      ...rawBase(task, seed, options),
      evidenceId: `seed-acq:${safeId(taskId(task))}:${safeId(family)}`,
      negativeControlFamily: family,
      query,
      title: `Negative-control source-query task ready: ${family}`,
      summary: `Executable negative-control source-query prepared for ${subject}; no accepted disconfirming or surviving evidence has been collected yet.`,
      negativeControlIntent: true,
      evidenceUse: 'negative_control_candidate',
      promotionEligible: false,
    };
  });
}

function holdoutRawEvidence(task = {}, seed = {}, options = {}) {
  const subject = seedSubject(seed);
  return HOLDOUT_SOURCE_GROUPS.map((group) => ({
    ...rawBase(task, seed, options),
    evidenceId: `seed-acq:${safeId(taskId(task))}:${safeId(group)}`,
    sourceGroup: group,
    query: `${subject} ${group.replace(/_/g, ' ')} holdout confirmation`,
    title: `Holdout validation task ready: ${group}`,
    summary: `Holdout validation source group ${group} is staged for ${subject}; no independent confirmation has been collected yet.`,
    promotionEligible: false,
  }));
}

function issuerExposureRawEvidence(task = {}, seed = {}, options = {}) {
  const subject = seedSubject(seed);
  const issuers = uniqueStrings([
    seed.supplierCategory?.publicIssuerCandidates,
    seed.issuerUniverse,
    taskPayload(task).candidateIssuerUniverse,
    taskPayload(task).providerRoutePlan?.candidateIssuerUniverse,
  ], 20);
  const query = firstSourceQuery(task)
    || `${issuers.join(' ')} ${subject} segment revenue backlog guidance capacity customer exposure`;
  return [{
    ...rawBase(task, seed, options),
    evidenceId: `seed-acq:${safeId(taskId(task))}:issuer-exposure-source-query`,
    sourceGroup: 'issuer_filing_ir_transcript',
    issuerCandidates: issuers,
    query,
    title: 'Issuer exposure source-query task ready',
    summary: `Executable issuer-exposure query prepared for ${subject}; ticker mentions alone are not accepted without filing/IR/transcript/contract linkage to backlog, guidance, capacity, or customer exposure.`,
    acceptanceCriteria: acceptanceCriteria(task),
    promotionEligible: false,
  }];
}

function rawEvidenceForTask(task = {}, seed = {}, options = {}) {
  const klass = taskEvidenceClass(task);
  if (klass === 'negative_control') return negativeControlRawEvidence(task, seed, options);
  if (klass === 'holdout_validation') return holdoutRawEvidence(task, seed, options);
  if (klass === 'issuer_exposure') return issuerExposureRawEvidence(task, seed, options);
  return [];
}

function queriesForSourceQueryExecution(task = {}, seed = {}) {
  const klass = taskEvidenceClass(task);
  const subject = seedSubject(seed);
  if (klass === 'negative_control') {
    return NEGATIVE_QUERY_FAMILIES.map((family) => ({
      query: `${subject} ${family}`,
      family,
      sourceGroup: 'negative_control_source_query',
    }));
  }
  if (klass === 'holdout_validation') {
    return HOLDOUT_SOURCE_GROUPS.map((group) => ({
      query: `${subject} ${group.replace(/_/g, ' ')} holdout confirmation`,
      sourceGroup: group,
    }));
  }
  if (klass === 'issuer_exposure') {
    const drafts = taskSourceQueryDrafts(task);
    const queries = drafts.length
      ? drafts.slice(0, 1)
      : [`${subject} issuer exposure segment revenue backlog guidance capacity customer exposure`];
    return uniqueStrings(queries, 1).map((query) => ({
      query,
      sourceGroup: 'issuer_filing_ir_transcript',
    }));
  }
  return [];
}

function approvalForSourceQuery(task = {}, seed = {}, query = '') {
  const klass = taskEvidenceClass(task);
  const payload = taskPayload(task);
  const issuers = uniqueStrings([
    seed.supplierCategory?.publicIssuerCandidates,
    seed.issuerUniverse,
    payload.candidateIssuerUniverse,
    payload.providerRoutePlan?.candidateIssuerUniverse,
  ], 20);
  return {
    id: `seed-bias:${taskId(task)}:${stableHash(query)}`,
    payload: {
      query,
      desiredEvidenceClass: klass,
      evidenceClass: klass,
      subjectKey: seedId(seed),
      subject: {
        subjectType: 'operator_seed',
        subjectId: seedId(seed),
        displayName: seedSubject(seed),
      },
      target: seedSubject(seed),
      supplier: seedSubject(seed),
      connector: seedSubject(seed),
      themes: uniqueStrings([seed.theme?.key, seed.theme?.label], 10),
      issuerHints: issuers,
      symbols: issuers,
      providerRoute: providerRoute(task),
      providerRoutePlan: payload.providerRoutePlan,
      metadata: {
        ...(payload.metadata || {}),
        source: 'seed-bias-source-query-executor',
        operatorSeedId: seedId(seed),
        taskId: taskId(task),
      },
    },
  };
}

async function fetchRssItems(query = '', {
  fetchImpl = globalThis.fetch,
  timeoutMs = 8000,
  maxItems = 3,
} = {}) {
  if (typeof fetchImpl !== 'function') {
    return { query, items: [], error: 'fetch-unavailable' };
  }
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=en-US&gl=US&ceid=US:en`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Math.max(1000, Number(timeoutMs || 8000)));
  try {
    const response = await fetchImpl(url, {
      signal: controller.signal,
      headers: { 'user-agent': 'LatticeResearchOS/1.0 seed-bias source-query evidence collector' },
    });
    clearTimeout(timeout);
    if (!response?.ok) {
      return { query, items: [], error: `external-rss-http-${response?.status || 'unknown'}` };
    }
    const xml = await response.text();
    return { query, items: parseExternalRssItems(xml, { limit: maxItems }), error: null };
  } catch (error) {
    clearTimeout(timeout);
    return { query, items: [], error: String(error?.message || error) };
  }
}

function sourceQueryItemToRawEvidence({
  task = {},
  seed = {},
  query = '',
  item = {},
  scored = {},
  family = '',
  sourceGroup = '',
  generatedAt = new Date().toISOString(),
} = {}) {
  const klass = taskEvidenceClass(task);
  const evidenceId = `seed-srcq:${safeId(taskId(task))}:${stableHash(`${query}:${item.link || item.title}`)}`;
  return {
    ...rawBase(task, seed, { generatedAt }),
    evidenceId,
    source: 'seed-bias-source-query-executor',
    provider: 'google-news-rss',
    sourceProvider: item.source || scored.metadata?.source || 'google-news-rss',
    sourceType: 'seed_bias_source_query',
    originalSourceType: scored.sourceType || 'external-rss',
    acquisitionStatus: 'source_query_executed',
    acceptanceVerdict: scored.acceptanceVerdict || scored.evidenceUse || 'source_query_scored',
    evidenceUse: scored.evidenceUse || 'weak_noise',
    sourceQueryEvidenceUse: scored.evidenceUse || 'weak_noise',
    promotionEligible: scored.promotionEligible === true,
    accepted: false,
    query,
    negativeControlFamily: family || null,
    sourceGroup: sourceGroup || item.source || null,
    title: item.title || scored.title || '',
    summary: compact([scored.textExcerpt || item.description, item.source].filter(Boolean).join(' ')),
    textExcerpt: scored.textExcerpt || item.description || '',
    url: item.link || scored.url || '',
    sourceUrl: item.link || scored.url || '',
    publishedAt: scored.publishedAt || item.publishedAt || null,
    relevanceScore: scored.sourceQueryRelevance ?? scored.relevanceScore ?? 0,
    desiredEvidenceClass: klass,
    scoring: scored.scoring || {},
    factsExtracted: scored.factsExtracted || [],
    factKeys: scored.factKeys || [],
    missingFacts: scored.missingFacts || [],
    requiredFacts: scored.requiredFacts || [],
    negativeControlFinding: scored.negativeControlFinding || null,
    closureReason: scored.closureReason || null,
    executionBoundary: {
      providerActivationWrites: 0,
      sourceRegistryWrites: 0,
      canonicalWrites: 0,
      approvalQueueWrites: 0,
      reportPromotionWrites: 0,
    },
  };
}

export async function executeSeedBiasSourceQueries({
  seed = {},
  tasks = [],
  generatedAt = new Date().toISOString(),
  fetchImpl = globalThis.fetch,
  maxItemsPerQuery = 2,
  timeoutMs = 8000,
} = {}) {
  const selectedTasks = asArray(tasks).filter((task) => DEFAULT_SEED_BIAS_ACQUISITION_CLASSES.includes(taskEvidenceClass(task)));
  const rawEvidence = [];
  const queryRuns = [];
  for (const task of selectedTasks) {
    for (const spec of queriesForSourceQueryExecution(task, seed)) {
      const fetched = await fetchRssItems(spec.query, {
        fetchImpl,
        timeoutMs,
        maxItems: maxItemsPerQuery,
      });
      queryRuns.push({
        taskId: taskId(task),
        evidenceClass: taskEvidenceClass(task),
        query: spec.query,
        sourceGroup: spec.sourceGroup || null,
        family: spec.family || null,
        itemCount: fetched.items.length,
        error: fetched.error || null,
      });
      if (!fetched.items.length) {
        rawEvidence.push({
          ...rawBase(task, seed, { generatedAt }),
          evidenceId: `seed-srcq:${safeId(taskId(task))}:${stableHash(`${spec.query}:no-results`)}`,
          source: 'seed-bias-source-query-executor',
          sourceType: 'seed_bias_source_query',
          provider: 'google-news-rss',
          acquisitionStatus: fetched.error ? 'source_query_fetch_failed' : 'source_query_no_results',
          acceptanceVerdict: 'source_query_no_accepted_result',
          evidenceUse: 'weak_noise',
          sourceQueryEvidenceUse: 'weak_noise',
          query: spec.query,
          negativeControlFamily: spec.family || null,
          sourceGroup: spec.sourceGroup || null,
          title: 'Source-query returned no accepted result',
          summary: fetched.error ? `Source-query failed: ${fetched.error}` : 'Source-query executed but returned no result rows for this query.',
          promotionEligible: false,
        });
        continue;
      }
      for (const item of fetched.items) {
        const bundle = {
          questionId: `seed-bias:${seedId(seed)}`,
          sourceType: 'external-rss',
          sourceId: `seed-srcq:${stableHash(item.link || item.title || spec.query)}`,
          title: item.title,
          textExcerpt: compact([item.description, item.source].filter(Boolean).join(' ')).slice(0, 700),
          url: item.link,
          publishedAt: Number.isNaN(Date.parse(item.publishedAt || '')) ? null : new Date(item.publishedAt).toISOString(),
          metadata: {
            source: item.source || 'google-news-rss',
            provider: 'google-news-rss',
            query: spec.query,
            sourceGroup: spec.sourceGroup || null,
          },
        };
        const scored = scoreSourceQueryBundle(bundle, approvalForSourceQuery(task, seed, spec.query));
        rawEvidence.push(sourceQueryItemToRawEvidence({
          task,
          seed,
          query: spec.query,
          item,
          scored,
          family: spec.family || '',
          sourceGroup: spec.sourceGroup || '',
          generatedAt,
        }));
      }
    }
  }
  return {
    ok: true,
    sourceQueryExecution: true,
    providerExecution: false,
    rawEvidence,
    queryRuns,
    queryCount: queryRuns.length,
    resultCount: rawEvidence.length,
  };
}

function negativeControlResult(seed = {}, rawRows = [], acceptedRows = []) {
  const negativeAccepted = asArray(acceptedRows).filter((row) => row.evidenceClass === 'negative_control');
  let survivalStatus = 'INCONCLUSIVE';
  let survivalReason = 'negative-control source-query tasks are ready, but no accepted negative-control evidence has been collected';
  if (negativeAccepted.some((row) => /invalidator|rejected/i.test(JSON.stringify(row)))) {
    survivalStatus = 'REJECTED';
    survivalReason = 'accepted negative-control invalidator matched';
  } else if (negativeAccepted.some((row) => /checked_no_direct|no direct invalidator|no direct contradiction/i.test(JSON.stringify(row)))) {
    survivalStatus = 'CHECKED_NO_DIRECT';
    survivalReason = 'accepted negative-control evidence found no direct invalidator';
  } else if (negativeAccepted.length) {
    survivalStatus = 'SURVIVED';
    survivalReason = 'accepted negative-control evidence supports survival';
  }
  return {
    ok: true,
    items: [{
      seedId: seedId(seed),
      negativeControlQueries: uniqueStrings([
        NEGATIVE_QUERY_FAMILIES.map((family) => `${seedSubject(seed)} ${family}`),
        rawRows.filter((row) => row.evidenceClass === 'negative_control').map((row) => row.query),
      ], 20),
      negativeControlEvidence: rawRows.filter((row) => row.evidenceClass === 'negative_control'),
      survivalStatus,
      survivalReason,
    }],
    negativeControlSurvivalRate: ['SURVIVED', 'CHECKED_NO_DIRECT'].includes(survivalStatus) ? 1 : 0,
  };
}

function holdoutResult(seed = {}, rawRows = [], acceptedRows = []) {
  const holdoutAccepted = asArray(acceptedRows).filter((row) => row.evidenceClass === 'holdout_validation');
  const matchedEvidenceClasses = uniqueStrings(holdoutAccepted.flatMap((row) => row.matchedEvidenceClasses || row.coveredEvidenceClasses || []), 40);
  const sourceGroupsUsed = uniqueStrings([
    rawRows.filter((row) => row.evidenceClass === 'holdout_validation').map((row) => row.sourceGroup),
    holdoutAccepted.map((row) => row.sourceGroup),
  ], 20);
  const contradictionCount = holdoutAccepted.filter((row) => /contradict|invalidator|oversupply|no exposure/i.test(JSON.stringify(row))).length;
  const confirmationCount = Math.max(0, holdoutAccepted.length - contradictionCount);
  const holdoutConfirmed = confirmationCount > contradictionCount;
  return {
    ok: true,
    items: [{
      seedId: seedId(seed),
      holdoutSourceGroup: 'official_government_sec_ir_trade_provider_holdout',
      holdoutConfirmed,
      confirmed: holdoutConfirmed,
      matchedEvidenceClasses,
      confirmationCount,
      contradictionCount,
      holdoutConfirmationRate: holdoutAccepted.length ? confirmationCount / holdoutAccepted.length : 0,
      sourceGroupsUsed,
    }],
    holdoutConfirmed,
    holdoutConfirmationRate: holdoutConfirmed ? 1 : 0,
    matchedEvidenceClasses,
    contradictionCount,
    sourceGroupsUsed,
  };
}

function issuerBridgeStatus(acceptedRows = []) {
  return asArray(acceptedRows).some((row) => (
    row.evidenceClass === 'issuer_exposure'
    && row.promotionEligible !== false
    && asArray(row.coveredEvidenceClasses).includes('issuer_exposure')
  )) ? 'attached' : 'missing';
}

export function buildSeedBiasEvidenceAcquisition({
  seed = {},
  tasks = [],
  existingRawEvidence = [],
  existingAcceptedEvidence = [],
  collectedRawEvidence = null,
  diagnosis = {},
  targetedBackfillRan = true,
  generatedAt = new Date().toISOString(),
} = {}) {
  const selectedTasks = asArray(tasks).filter((task) => DEFAULT_SEED_BIAS_ACQUISITION_CLASSES.includes(taskEvidenceClass(task)));
  const newRawRows = Array.isArray(collectedRawEvidence)
    ? collectedRawEvidence
    : selectedTasks.flatMap((task) => rawEvidenceForTask(task, seed, { generatedAt }));
  const acceptance = acceptSeedEvidenceRows(newRawRows, { tasks: selectedTasks, now: new Date(generatedAt) });
  const rawEvidence = [
    ...asArray(existingRawEvidence).map((row) => row.payload || row),
    ...acceptance.rawEvidence,
  ];
  const acceptedEvidence = [
    ...asArray(existingAcceptedEvidence).map((row) => ({
      ...(row.payload || row),
      evidenceId: row.evidence_id || row.evidenceId,
      seedId: row.seed_id || row.seedId,
      evidenceClass: row.evidence_class || row.evidenceClass,
      evidenceUse: row.evidence_use || row.evidenceUse,
      coveredEvidenceClasses: row.covered_evidence_classes || row.coveredEvidenceClasses || [],
    })),
    ...acceptance.acceptedEvidence,
  ];
  const negativeControlSurvival = negativeControlResult(seed, rawEvidence, acceptedEvidence);
  const holdoutValidation = holdoutResult(seed, rawEvidence, acceptedEvidence);
  const issuerStatus = issuerBridgeStatus(acceptedEvidence);
  const plan = buildRouteAwareSeedEvidencePlan(seed);
  const gate = evaluateAutonomousSeedReportCandidateGate(seed, {
    evidencePlan: plan,
    biasDiagnosis: diagnosis,
    targetedBackfillRan,
    rawEvidence,
    acceptedEvidence,
    negativeControlSurvival,
    holdoutValidation,
    issuerBridge: issuerStatus === 'attached' ? { status: 'closed' } : {},
    marketValidation: {},
  });

  return {
    ok: true,
    version: SEED_BIAS_EVIDENCE_ACQUISITION_VERSION,
    generatedAt,
    seedId: seedId(seed),
    selectedEvidenceClasses: DEFAULT_SEED_BIAS_ACQUISITION_CLASSES,
    sourceQueryExecution: Array.isArray(collectedRawEvidence),
    untouchedEvidenceClasses: [
      'technical_qualification',
      'permitting_regulatory',
      'material_input',
      'engineering_process',
      'test_facility_capacity',
      'provider_data_gap',
      'market_validation',
    ],
    executedTaskCount: selectedTasks.length,
    newRawEvidence: acceptance.rawEvidence,
    newAcceptedEvidence: acceptance.acceptedEvidence,
    rawEvidence,
    acceptedEvidence,
    rawEvidenceCount: rawEvidence.length,
    acceptedEvidenceCount: acceptedEvidence.length,
    negativeControlSurvival,
    holdoutValidation,
    issuerBridgeStatus: issuerStatus,
    gateResult: gate,
    visualStatus: gate.visualStatus,
    finalBlocker: gate.blockers?.[0] || null,
    readinessChanged: acceptedEvidence.length > asArray(existingAcceptedEvidence).length,
    boundaries: {
      approvalQueueWrites: 0,
      sourceQueryApprovalWrites: 0,
      reportBackfillWrites: 0,
      researchEvidenceBundleWrites: 0,
      canonicalWrites: 0,
      sourceRegistryWrites: 0,
      providerActivationWrites: 0,
    },
  };
}
