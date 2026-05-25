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
  collectCompanyIrReadonly,
} from './external-data/company-ir-readonly.mjs';
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

export const DEFAULT_OFFICIAL_ISSUER_CANDIDATES = Object.freeze([
  'TSM',
  'ASML',
  'AMD',
  'NVDA',
  'AVGO',
]);

const OFFICIAL_HOLDOUT_SOURCE_GROUPS = Object.freeze([
  'official_company_filing',
  'issuer_ir_transcript',
  'official_industry_or_government',
  'specialist_trade_media',
]);

const OFFICIAL_NEGATIVE_QUERY_FAMILIES = Object.freeze([
  'advanced packaging substrate capacity expansion',
  'CoWoS capacity expansion oversupply risk',
  'ABF substrate supply improving',
  'advanced packaging alternative suppliers',
  'management says no substrate bottleneck',
  'HBM packaging capacity no constraint',
  'advanced packaging lead time improving',
]);

const OFFICIAL_TOPIC_TERMS = Object.freeze([
  'advanced packaging',
  'substrate',
  'substrates',
  'CoWoS',
  'chiplet',
  'chiplets',
  'interposer',
  'interposers',
  'HBM',
  'packaging capacity',
  'capacity allocation',
  'lead time',
]);

const OFFICIAL_BRIDGE_TERMS = Object.freeze([
  'revenue',
  'segment',
  'backlog',
  'guidance',
  'capacity',
  'allocation',
  'lead time',
  'customer',
  'demand',
  'capex',
  'capital expenditure',
  'contract',
]);

function officialTopicTermsForSeed(seed = {}) {
  return uniqueStrings([
    seed.metadata?.officialTopicTerms,
    seed.officialTopicTerms,
    seed.acceptanceCriteria?.requiredTerms,
    seed.bottleneck?.label,
    seed.requiredInputs,
    OFFICIAL_TOPIC_TERMS,
  ], 80);
}

function officialBridgeTermsForSeed(seed = {}) {
  return uniqueStrings([
    seed.metadata?.officialBridgeTerms,
    seed.officialBridgeTerms,
    seed.acceptanceCriteria?.bridgeTerms,
    OFFICIAL_BRIDGE_TERMS,
  ], 60);
}

function officialNegativeQueriesForSeed(seed = {}) {
  const seedSpecific = uniqueStrings([
    seed.metadata?.officialNegativeQueries,
    seed.negativeControlQueries,
    seed.counterEvidenceQueries,
  ], 30);
  if (seedSpecific.length) return seedSpecific;
  return uniqueStrings(OFFICIAL_NEGATIVE_QUERY_FAMILIES, 30);
}

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (value === null || value === undefined || value === '') return [];
  return [value];
}

function compact(value = '') {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function normalizeText(value = '') {
  return String(value || '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9\s./:-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
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

function textIncludesAny(text = '', terms = []) {
  const normalized = normalizeText(text);
  return asArray(terms).some((term) => normalized.includes(normalizeText(term)));
}

function stripHtml(value = '') {
  return String(value || '')
    .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#160;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function excerptAroundTerms(text = '', terms = [], radius = 420) {
  const normalized = normalizeText(text);
  let best = -1;
  for (const term of asArray(terms)) {
    const index = normalized.indexOf(normalizeText(term));
    if (index >= 0 && (best < 0 || index < best)) best = index;
  }
  if (best < 0) return compact(text).slice(0, radius * 2);
  const start = Math.max(0, best - radius);
  return compact(text).slice(start, start + radius * 2);
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

function classifyFailure(row = {}) {
  if (row.accepted === true || row.acceptanceVerdict === 'accepted') return 'ACCEPTED';
  if (/timeout|aborted/i.test([row.acquisitionStatus, row.summary, row.error].filter(Boolean).join(' '))) return 'TIMEOUT';
  if (/503|unavailable|fetch_failed|http/i.test([row.acquisitionStatus, row.summary, row.error].filter(Boolean).join(' '))) return 'SOURCE_UNAVAILABLE';
  if (/no_results?|no result/i.test([row.acquisitionStatus, row.summary, row.title].filter(Boolean).join(' '))) return 'NO_RESULT';
  if (row.negativeControlFinding === 'invalidator' || /invalidator|oversupply|no bottleneck|no capacity constraint/i.test(row.summary || row.title || '')) return 'CONTRADICTORY';
  if (row.evidenceClass === 'issuer_exposure' && asArray(row.acceptanceBlockers).includes('issuer_exposure_requires_official_bridge')) return 'TICKER_ONLY';
  return 'WEAK_EVIDENCE';
}

function summarizeFailureClassification(rows = []) {
  const items = asArray(rows).map((row) => ({
    evidenceId: row.evidenceId,
    evidenceClass: row.evidenceClass,
    query: row.query || null,
    source: row.source || row.provider || null,
    sourceGroup: row.sourceGroup || null,
    classification: row.failureClassification || classifyFailure(row),
    accepted: row.accepted === true,
    acceptanceBlockers: row.acceptanceBlockers || [],
  }));
  const counts = {};
  for (const item of items) counts[item.classification] = (counts[item.classification] || 0) + 1;
  return { counts, items };
}

async function fetchJson(url = '', {
  fetchImpl = globalThis.fetch,
  timeoutMs = 10000,
  headers = {},
} = {}) {
  if (typeof fetchImpl !== 'function') return { ok: false, json: null, error: 'fetch-unavailable', status: 0 };
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Math.max(1000, Number(timeoutMs || 10000)));
  try {
    const response = await fetchImpl(url, { signal: controller.signal, headers });
    clearTimeout(timeout);
    if (!response?.ok) return { ok: false, json: null, error: `http-${response?.status || 'unknown'}`, status: response?.status || 0 };
    return { ok: true, json: await response.json(), error: null, status: response.status };
  } catch (error) {
    clearTimeout(timeout);
    return { ok: false, json: null, error: String(error?.message || error), status: 0 };
  }
}

async function fetchText(url = '', {
  fetchImpl = globalThis.fetch,
  timeoutMs = 10000,
  headers = {},
} = {}) {
  if (typeof fetchImpl !== 'function') return { ok: false, text: '', error: 'fetch-unavailable', status: 0 };
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Math.max(1000, Number(timeoutMs || 10000)));
  try {
    const response = await fetchImpl(url, { signal: controller.signal, headers });
    clearTimeout(timeout);
    if (!response?.ok) return { ok: false, text: '', error: `http-${response?.status || 'unknown'}`, status: response?.status || 0 };
    return { ok: true, text: await response.text(), error: null, status: response.status };
  } catch (error) {
    clearTimeout(timeout);
    return { ok: false, text: '', error: String(error?.message || error), status: 0 };
  }
}

function secHeaders() {
  return {
    'user-agent': process.env.SEC_USER_AGENT || process.env.EDGAR_USER_AGENT || process.env.LATTICE_HTTP_USER_AGENT || 'LatticeResearchOS/1.0 seed-bias official evidence collector contact@example.com',
    accept: 'application/json,text/html,*/*',
  };
}

function cikPad(value = '') {
  return String(value || '').replace(/^0+/, '').padStart(10, '0');
}

function recentFilingCandidates(submissions = {}, limit = 4) {
  const recent = submissions.filings?.recent || {};
  const forms = recent.form || [];
  const accessions = recent.accessionNumber || [];
  const docs = recent.primaryDocument || [];
  const dates = recent.filingDate || [];
  const preferred = [];
  const formRank = (form = '') => {
    if (form === '10-K' || form === '20-F') return 0;
    if (form === '10-Q') return 1;
    if (form === '8-K') return 2;
    return 9;
  };
  for (let i = 0; i < forms.length; i += 1) {
    const form = compact(forms[i]);
    if (!['10-K', '20-F', '10-Q', '8-K'].includes(form)) continue;
    const accession = compact(accessions[i]);
    const primaryDocument = compact(docs[i]);
    if (!accession || !primaryDocument) continue;
    preferred.push({
      form,
      accession,
      accessionNoDashes: accession.replace(/-/g, ''),
      primaryDocument,
      filingDate: dates[i] || null,
      sourceOrder: i,
    });
    if (preferred.length >= Math.max(limit * 4, 12)) break;
  }
  return preferred
    .sort((a, b) => {
      const rankDelta = formRank(a.form) - formRank(b.form);
      if (rankDelta !== 0) return rankDelta;
      return a.sourceOrder - b.sourceOrder;
    })
    .slice(0, limit);
}

async function loadSecTickerMap(fetchImpl = globalThis.fetch, timeoutMs = 10000) {
  const result = await fetchJson('https://www.sec.gov/files/company_tickers.json', {
    fetchImpl,
    timeoutMs,
    headers: secHeaders(),
  });
  if (!result.ok) return { ok: false, byTicker: new Map(), error: result.error };
  const byTicker = new Map();
  for (const row of Object.values(result.json || {})) {
    const ticker = compact(row.ticker).toUpperCase();
    if (!ticker) continue;
    byTicker.set(ticker, {
      ticker,
      cik: cikPad(row.cik_str),
      title: row.title || ticker,
    });
  }
  return { ok: true, byTicker, error: null };
}

function officialRawNoResult(task = {}, seed = {}, {
  ticker = '',
  sourceGroup = '',
  query = '',
  error = '',
  generatedAt = new Date().toISOString(),
} = {}) {
  return {
    ...rawBase(task, seed, { generatedAt }),
    evidenceId: `seed-official:${safeId(taskId(task))}:${safeId(ticker || sourceGroup || 'official')}:${stableHash(`${query}:${error || 'no-result'}`)}`,
    source: 'seed-bias-official-route',
    sourceType: 'official_route',
    provider: 'official-route',
    sourceProvider: sourceGroup || 'official-route',
    sourceGroup,
    issuer: ticker || null,
    query,
    acquisitionStatus: error ? 'official_route_fetch_failed' : 'official_route_no_result',
    acceptanceVerdict: 'official_route_no_accepted_result',
    evidenceUse: 'weak_noise',
    promotionEligible: false,
    title: 'Official route returned no accepted result',
    summary: error ? `Official route failed: ${error}` : 'Official route executed but did not find a direct evidence row.',
  };
}

function officialIssuerExposureRaw(task = {}, seed = {}, {
  ticker = '',
  company = '',
  form = '',
  filingDate = '',
  url = '',
  excerpt = '',
  topicTerms = OFFICIAL_TOPIC_TERMS,
  bridgeTerms = OFFICIAL_BRIDGE_TERMS,
  generatedAt = new Date().toISOString(),
} = {}) {
  const subject = seedSubject(seed);
  const direct = textIncludesAny(excerpt, topicTerms) && textIncludesAny(excerpt, bridgeTerms);
  return {
    ...rawBase(task, seed, { generatedAt }),
    evidenceId: `seed-official:${safeId(taskId(task))}:${safeId(ticker)}:${stableHash(url)}`,
    source: 'seed-bias-official-route',
    sourceType: 'official_company_filing',
    provider: 'sec-edgar',
    sourceProvider: 'sec-edgar',
    sourceGroup: 'official_company_filing',
    issuer: ticker,
    company,
    form,
    filingDate,
    publishedAt: filingDate || null,
    url,
    sourceUrl: url,
    query: `${ticker} official filing ${subject} issuer exposure capacity revenue backlog guidance capex customer demand`,
    acquisitionStatus: 'official_route_executed',
    acceptanceVerdict: direct ? 'official_route_direct_candidate' : 'official_route_weak_candidate',
    evidenceUse: direct ? 'promotion_candidate' : 'weak_noise',
    promotionEligible: direct,
    title: `${ticker} ${form} official filing ${subject} check`,
    summary: excerpt,
    textExcerpt: excerpt,
    officialSource: true,
  };
}

function officialHoldoutRaw(task = {}, seed = {}, issuerRows = [], {
  generatedAt = new Date().toISOString(),
} = {}) {
  const subject = seedSubject(seed);
  const candidate = issuerRows.some((row) => row.promotionEligible === true);
  return OFFICIAL_HOLDOUT_SOURCE_GROUPS.map((group) => ({
    ...rawBase(task, seed, { generatedAt }),
    evidenceId: `seed-official:${safeId(taskId(task))}:${safeId(group)}:${stableHash(issuerRows.map((row) => row.evidenceId).join('|'))}`,
    source: 'seed-bias-official-route',
    sourceType: 'official_holdout_validation',
    provider: group,
    sourceProvider: group,
    sourceGroup: group,
    query: `official holdout ${group} ${subject}`,
    acquisitionStatus: candidate && group === 'official_company_filing' ? 'official_route_executed' : 'official_route_no_result',
    acceptanceVerdict: candidate && group === 'official_company_filing' ? 'holdout_candidate_raw_only' : 'official_route_no_accepted_result',
    evidenceUse: 'weak_noise',
    promotionEligible: false,
    holdoutConfirmed: false,
    holdoutCandidate: candidate && group === 'official_company_filing',
    matchedEvidenceClasses: [],
    rawEvidenceIds: issuerRows.map((row) => row.evidenceId),
    title: `Holdout validation ${group}`,
    summary: candidate && group === 'official_company_filing'
      ? `Official issuer filing holdout found a raw candidate ${subject} bridge; holdout is not confirmed until accepted evidence closes the bridge.`
      : 'No direct holdout confirmation collected for this source group.',
  }));
}

function officialNegativeRaw(task = {}, seed = {}, {
  family = '',
  issuerRows = [],
  generatedAt = new Date().toISOString(),
} = {}) {
  const invalidator = /oversupply|improving|alternative|no substrate bottleneck|no constraint|lead time improving/i.test(family);
  const directInvalidator = issuerRows.some((row) => invalidator && /oversupply|no bottleneck|no constraint|lead time improving|supply improving/i.test(row.summary || ''));
  return {
    ...rawBase(task, seed, { generatedAt }),
    evidenceId: `seed-official:${safeId(taskId(task))}:${safeId(family)}`,
    source: 'seed-bias-official-route',
    sourceType: 'official_negative_control_search',
    provider: 'official-route',
    sourceProvider: 'official-route',
    sourceGroup: 'official_negative_control',
    query: family,
    acquisitionStatus: directInvalidator ? 'official_route_executed' : 'official_route_no_result',
    acceptanceVerdict: directInvalidator ? 'negative_control_invalidator_candidate' : 'official_route_no_accepted_result',
    evidenceUse: directInvalidator ? 'negative_control_candidate' : 'weak_noise',
    promotionEligible: false,
    negativeControlIntent: true,
    negativeControlFinding: directInvalidator ? 'invalidator' : 'checked_no_direct',
    title: `Official negative-control route: ${family}`,
    summary: directInvalidator
      ? `Official route found potential invalidator for ${family}.`
      : `Official route did not find direct accepted negative-control evidence for ${family}.`,
  };
}

export async function executeSeedBiasOfficialRoutes({
  seed = {},
  tasks = [],
  issuerCandidates = DEFAULT_OFFICIAL_ISSUER_CANDIDATES,
  generatedAt = new Date().toISOString(),
  fetchImpl = globalThis.fetch,
  timeoutMs = 10000,
  executeCompanyIr = false,
  companyIrAllowlist = null,
} = {}) {
  const selectedTasks = asArray(tasks).filter((task) => DEFAULT_SEED_BIAS_ACQUISITION_CLASSES.includes(taskEvidenceClass(task)));
  const taskByClass = new Map(selectedTasks.map((task) => [taskEvidenceClass(task), task]));
  const rawEvidence = [];
  const routeRuns = [];
  const topicTerms = officialTopicTermsForSeed(seed);
  const bridgeTerms = officialBridgeTermsForSeed(seed);
  const negativeQueryFamilies = officialNegativeQueriesForSeed(seed);
  const tickers = uniqueStrings([issuerCandidates, seed.supplierCategory?.publicIssuerCandidates], 12)
    .map((ticker) => ticker.toUpperCase())
    .filter(Boolean);
  const companyIrExecution = executeCompanyIr
    ? await collectCompanyIrReadonly({
      seed,
      tasks: selectedTasks,
      allowlist: companyIrAllowlist || undefined,
      fetchImpl,
      timeoutMs,
      generatedAt,
    })
    : null;
  if (companyIrExecution?.rawEvidence?.length) {
    rawEvidence.push(...companyIrExecution.rawEvidence);
    routeRuns.push(...companyIrExecution.routeRuns);
  }
  const tickerMap = await loadSecTickerMap(fetchImpl, timeoutMs);
  if (!tickerMap.ok) {
    for (const task of selectedTasks) {
      rawEvidence.push(officialRawNoResult(task, seed, {
        sourceGroup: 'sec_ticker_map',
        query: 'SEC company ticker map',
        error: tickerMap.error,
        generatedAt,
      }));
    }
    return {
      ok: true,
      officialRouteExecution: true,
      companyIrExecution: Boolean(companyIrExecution),
      companyIrCollectorStatus: companyIrExecution?.companyIrCollectorStatus || null,
      providerExecution: false,
      rawEvidence,
      routeRuns: [...routeRuns, { route: 'sec_ticker_map', itemCount: 0, error: tickerMap.error }],
      queryCount: 1 + Number(companyIrExecution?.queryCount || 0),
      resultCount: rawEvidence.length,
    };
  }

  const issuerTask = taskByClass.get('issuer_exposure');
  const issuerRows = [];
  if (issuerTask) {
    for (const ticker of tickers) {
      const mapped = tickerMap.byTicker.get(ticker);
      if (!mapped) {
        const row = officialRawNoResult(issuerTask, seed, {
          ticker,
          sourceGroup: 'sec-edgar',
          query: `${ticker} SEC filing lookup`,
          error: 'ticker-not-found-in-sec-map',
          generatedAt,
        });
        rawEvidence.push(row);
        routeRuns.push({ route: 'sec-edgar', ticker, itemCount: 0, error: 'ticker-not-found-in-sec-map' });
        continue;
      }
      const submissionsUrl = `https://data.sec.gov/submissions/CIK${mapped.cik}.json`;
      const submissions = await fetchJson(submissionsUrl, { fetchImpl, timeoutMs, headers: secHeaders() });
      if (!submissions.ok) {
        const row = officialRawNoResult(issuerTask, seed, {
          ticker,
          sourceGroup: 'sec-edgar',
          query: submissionsUrl,
          error: submissions.error,
          generatedAt,
        });
        rawEvidence.push(row);
        routeRuns.push({ route: 'sec-edgar', ticker, itemCount: 0, error: submissions.error });
        continue;
      }
      const filings = recentFilingCandidates(submissions.json, 2);
      let foundForTicker = 0;
      for (const filing of filings) {
        const filingUrl = `https://www.sec.gov/Archives/edgar/data/${Number(mapped.cik)}/${filing.accessionNoDashes}/${filing.primaryDocument}`;
        const doc = await fetchText(filingUrl, { fetchImpl, timeoutMs, headers: secHeaders() });
        if (!doc.ok) {
          routeRuns.push({ route: 'sec-edgar-filing', ticker, form: filing.form, itemCount: 0, error: doc.error });
          continue;
        }
        const text = stripHtml(doc.text);
        if (!textIncludesAny(text, topicTerms)) {
          routeRuns.push({ route: 'sec-edgar-filing', ticker, form: filing.form, itemCount: 0, error: 'WEAK_EVIDENCE' });
          continue;
        }
        const excerpt = excerptAroundTerms(text, topicTerms);
        const row = officialIssuerExposureRaw(issuerTask, seed, {
          ticker,
          company: mapped.title,
          form: filing.form,
          filingDate: filing.filingDate,
          url: filingUrl,
          excerpt,
          topicTerms,
          bridgeTerms,
          generatedAt,
        });
        rawEvidence.push(row);
        issuerRows.push(row);
        foundForTicker += 1;
        routeRuns.push({
          route: 'sec-edgar-filing',
          ticker,
          form: filing.form,
          itemCount: 1,
          acceptedCandidate: row.promotionEligible === true,
          error: row.promotionEligible === true ? null : 'WEAK_EVIDENCE',
        });
        break;
      }
      if (!foundForTicker) {
        rawEvidence.push(officialRawNoResult(issuerTask, seed, {
          ticker,
          sourceGroup: 'sec-edgar',
          query: `${ticker} latest 10-K/20-F/10-Q ${seedSubject(seed)}`,
          generatedAt,
        }));
      }
    }
  }

  const holdoutTask = taskByClass.get('holdout_validation');
  if (holdoutTask) {
    rawEvidence.push(...officialHoldoutRaw(holdoutTask, seed, issuerRows, { generatedAt }));
    const directIssuerRows = issuerRows.filter((row) => row.promotionEligible === true);
    for (const group of OFFICIAL_HOLDOUT_SOURCE_GROUPS) {
      routeRuns.push({
        route: group,
        itemCount: group === 'official_company_filing' ? directIssuerRows.length : 0,
        error: group === 'official_company_filing' && directIssuerRows.length ? null : 'NO_RESULT',
      });
    }
  }

  const negativeTask = taskByClass.get('negative_control');
  if (negativeTask) {
    for (const family of negativeQueryFamilies) {
      const row = officialNegativeRaw(negativeTask, seed, { family, issuerRows, generatedAt });
      rawEvidence.push(row);
      routeRuns.push({
        route: 'official-negative-control',
        family,
        itemCount: row.acquisitionStatus === 'official_route_executed' ? 1 : 0,
        error: row.acquisitionStatus === 'official_route_executed' ? null : 'NO_RESULT',
      });
    }
  }

  return {
    ok: true,
    officialRouteExecution: true,
    companyIrExecution: Boolean(companyIrExecution),
    companyIrCollectorStatus: companyIrExecution?.companyIrCollectorStatus || null,
    providerExecution: false,
    issuerCandidates: tickers,
    rawEvidence,
    routeRuns,
    queryCount: routeRuns.length,
    resultCount: rawEvidence.length,
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
  let negativeControlScope = 'insufficient';
  let survivalReason = 'negative-control source-query tasks are ready, but no accepted negative-control evidence has been collected';
  if (negativeAccepted.some((row) => {
    const text = JSON.stringify(row);
    return /"negativeControlStatus":"(?:WEAKENED|REJECTED)"|"negativeControlFinding":"invalidator"|negative_control_invalidator_candidate/i.test(text);
  })) {
    survivalStatus = 'REJECTED';
    negativeControlScope = 'invalidator';
    survivalReason = 'accepted negative-control invalidator matched';
  } else if (negativeAccepted.some((row) => /CHECKED_NO_DIRECT_SUFFICIENT_SCOPE|checked_no_direct_sufficient_scope/i.test(JSON.stringify(row)))) {
    survivalStatus = 'CHECKED_NO_DIRECT_SUFFICIENT_SCOPE';
    negativeControlScope = 'sufficient';
    survivalReason = 'accepted sufficient-scope negative-control evidence found no direct invalidator';
  } else if (negativeAccepted.some((row) => /CHECKED_NO_DIRECT_LIMITED_SCOPE|checked_no_direct_limited_scope/i.test(JSON.stringify(row)))) {
    survivalStatus = 'CHECKED_NO_DIRECT_LIMITED_SCOPE';
    negativeControlScope = 'limited';
    survivalReason = 'accepted limited-scope negative-control evidence found no direct invalidator, but cannot close report-candidate gate';
  } else if (negativeAccepted.some((row) => /checked_no_direct|no direct invalidator|no direct contradiction/i.test(JSON.stringify(row)))) {
    survivalStatus = 'CHECKED_NO_DIRECT';
    negativeControlScope = 'generic';
    survivalReason = 'accepted negative-control evidence found no direct invalidator';
  } else if (negativeAccepted.some((row) => {
    const text = JSON.stringify(row);
    return /invalidator|rejected/i.test(text)
      && !/checked_no_direct|no direct invalidator|no direct contradiction/i.test(text);
  })) {
    survivalStatus = 'REJECTED';
    negativeControlScope = 'invalidator';
    survivalReason = 'accepted negative-control invalidator matched';
  } else if (negativeAccepted.length) {
    survivalStatus = 'SURVIVED';
    negativeControlScope = 'generic';
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
      negativeControlScope,
      survivalReason,
    }],
    negativeControlScope,
    negativeControlSurvivalRate: ['SURVIVED', 'CHECKED_NO_DIRECT', 'CHECKED_NO_DIRECT_SUFFICIENT_SCOPE'].includes(survivalStatus) ? 1 : 0,
  };
}

function holdoutResult(seed = {}, rawRows = [], acceptedRows = []) {
  const holdoutAccepted = asArray(acceptedRows).filter((row) => row.evidenceClass === 'holdout_validation');
  const holdoutRaw = asArray(rawRows).filter((row) => row.evidenceClass === 'holdout_validation');
  const rawConfirmed = holdoutRaw.filter((row) => row.holdoutConfirmed === true || row.confirmed === true);
  const matchedEvidenceClasses = uniqueStrings(holdoutAccepted.flatMap((row) => row.matchedEvidenceClasses || row.coveredEvidenceClasses || []), 40);
  const sourceGroupsUsed = uniqueStrings([
    holdoutRaw.map((row) => row.sourceGroup),
    holdoutAccepted.map((row) => row.sourceGroup),
  ], 20);
  const contradictionCount = [...holdoutAccepted, ...rawConfirmed].filter((row) => /contradict|invalidator|oversupply|no exposure/i.test(JSON.stringify(row))).length;
  const confirmationCount = Math.max(0, holdoutAccepted.length + rawConfirmed.length - contradictionCount);
  const inspectedCount = Math.max(1, holdoutAccepted.length + holdoutRaw.length);
  const holdoutConfirmed = confirmationCount > contradictionCount;
  return {
    ok: true,
    items: [{
      seedId: seedId(seed),
      holdoutSourceGroup: 'official_government_sec_ir_trade_provider_holdout',
      holdoutConfirmed,
      confirmed: holdoutConfirmed,
      matchedEvidenceClasses: uniqueStrings([matchedEvidenceClasses, rawConfirmed.flatMap((row) => row.matchedEvidenceClasses || [])], 40),
      confirmationCount,
      contradictionCount,
      holdoutConfirmationRate: confirmationCount / inspectedCount,
      sourceGroupsUsed,
      rawEvidenceIds: holdoutRaw.map((row) => row.evidenceId).filter(Boolean),
      acceptedEvidenceIds: holdoutAccepted.map((row) => row.evidenceId).filter(Boolean),
    }],
    holdoutConfirmed,
    holdoutConfirmationRate: holdoutConfirmed ? 1 : 0,
    matchedEvidenceClasses: uniqueStrings([matchedEvidenceClasses, rawConfirmed.flatMap((row) => row.matchedEvidenceClasses || [])], 40),
    contradictionCount,
    sourceGroupsUsed,
    rawEvidenceIds: holdoutRaw.map((row) => row.evidenceId).filter(Boolean),
    acceptedEvidenceIds: holdoutAccepted.map((row) => row.evidenceId).filter(Boolean),
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
  const classifiedNewRawEvidence = acceptance.rawEvidence.map((row) => ({
    ...row,
    failureClassification: classifyFailure(row),
  }));
  const newRawIds = new Set(classifiedNewRawEvidence.map((row) => row.evidenceId).filter(Boolean));
  const existingRawRows = asArray(existingRawEvidence)
    .map((row) => row.payload || row)
    .filter((row) => !newRawIds.has(row.evidenceId || row.evidence_id));
  const rawEvidence = [
    ...existingRawRows,
    ...classifiedNewRawEvidence,
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
  const failureClassification = summarizeFailureClassification(classifiedNewRawEvidence);
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
    newRawEvidence: classifiedNewRawEvidence,
    newAcceptedEvidence: acceptance.acceptedEvidence,
    rawEvidence,
    acceptedEvidence,
    rawEvidenceCount: rawEvidence.length,
    acceptedEvidenceCount: acceptedEvidence.length,
    negativeControlSurvival,
    negativeControlScope: negativeControlSurvival.negativeControlScope || negativeControlSurvival.items?.[0]?.negativeControlScope || 'insufficient',
    holdoutValidation,
    failureClassification,
    selfImprovement: {
      source: 'seed-bias-evidence-acquisition',
      seedId: seedId(seed),
      failureClassification,
      nextActions: Object.entries(failureClassification.counts)
        .filter(([, count]) => count > 0)
        .map(([classification]) => ({
          classification,
          nextAction: ({
            SOURCE_UNAVAILABLE: 'retry with non-RSS official route or provider-specific collector',
            TIMEOUT: 'retry with longer timeout or provider-specific collector',
            WEAK_EVIDENCE: 'tighten query toward official filing/transcript operating bridge',
            TICKER_ONLY: 'require filing/IR/transcript linkage before issuer exposure acceptance',
            NO_RESULT: 'route to provider gap or alternate official source group',
            CONTRADICTORY: 'review negative-control invalidator before promotion',
            ACCEPTED: 're-evaluate source breadth and remaining gates',
          })[classification] || 'review evidence lane',
        })),
    },
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
