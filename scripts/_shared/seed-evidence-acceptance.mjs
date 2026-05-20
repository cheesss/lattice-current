export const SEED_EVIDENCE_ACCEPTANCE_VERSION = 'seed-evidence-acceptance-v1';

const PROMOTION_BLOCKED_CLASSES = new Set([
  'negative_control',
  'provider_data_gap',
]);

const NON_ACCEPTED_LEDGER_CLASSES = new Set([
  'holdout_validation',
  'provider_data_gap',
]);

const DEFAULT_MAX_AGE_DAYS = 730;

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

function evidenceClassOf(row = {}, task = {}) {
  return compact(
    row.desiredEvidenceClass
    || row.evidenceClass
    || row.desired_evidence_class
    || task.evidenceClass,
  );
}

function sourceKey(row = {}) {
  return compact(
    row.sourceUrl
    || row.url
    || row.canonicalUrl
    || row.provider
    || row.sourceProvider
    || row.source
    || row.title
    || row.evidenceId
    || row.id,
  ).toLowerCase();
}

function textOf(row = {}) {
  return compact([
    row.title,
    row.summary,
    row.textExcerpt,
    row.text_excerpt,
    row.text,
    row.finding,
    row.claim,
    row.url,
    row.sourceUrl,
    row.provider,
    row.sourceProvider,
    row.source,
    row.evidenceClass,
    row.desiredEvidenceClass,
  ].join(' '));
}

function publishedAt(row = {}) {
  const raw = row.publishedAt || row.date || row.observedAt || row.createdAt;
  if (!raw) return null;
  const parsed = new Date(raw);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

function isStale(row = {}, now = new Date(), maxAgeDays = DEFAULT_MAX_AGE_DAYS) {
  const date = publishedAt(row);
  if (!date) return false;
  const ageMs = now.getTime() - date.getTime();
  const maxMs = Number(maxAgeDays || DEFAULT_MAX_AGE_DAYS) * 24 * 60 * 60 * 1000;
  return ageMs > maxMs;
}

function criteriaTerms(criteria = {}) {
  return uniqueStrings([
    criteria.requiredTerms,
    criteria.keyTerms,
    criteria.matchTerms,
    criteria.queryTerms,
    criteria.description,
  ], 40);
}

function passesCriteria(row = {}, criteria = {}, evidenceClass = '') {
  if (criteria.pass === true || criteria.accepted === true) return true;
  const terms = criteriaTerms(criteria);
  if (!terms.length) return true;
  const text = textOf(row).toLowerCase();
  return terms.some((term) => text.includes(term.toLowerCase()))
    || text.includes(evidenceClass.replace(/_/g, ' '));
}

function isThemeCompatible(row = {}, task = {}) {
  if (row.incompatibleEvidenceClass === true || row.incompatible === true) return false;
  if (row.contaminationWarning || task.contaminationWarning) return false;
  const removed = uniqueStrings([row.removedEvidenceClasses, task.removedEvidenceClasses], 20);
  const klass = evidenceClassOf(row, task);
  return !removed.includes(klass);
}

function isLocalControlledMarket(row = {}) {
  return row.localControlledMarketData === true
    || row.sourceType === 'local_controlled_market_data'
    || row.provider === 'local-market-validation'
    || row.providerRoute === 'local-market-validation'
    || row.marketValidationSource === 'local_controlled_market_data';
}

function marketTierAccepted(row = {}) {
  return ['decision_grade', 'screening_grade', 'weak_screen'].includes(compact(row.marketTier || row.tier));
}

function acceptanceUseFor(evidenceClass = '', row = {}) {
  if (evidenceClass === 'negative_control') return 'negative_control_candidate';
  if (evidenceClass === 'market_validation') return marketTierAccepted(row) ? 'promotion_candidate' : 'supporting_context';
  if (PROMOTION_BLOCKED_CLASSES.has(evidenceClass)) return 'supporting_context';
  return row.evidenceUse || row.evidence_use || 'promotion_candidate';
}

function isSeedBiasSourceQuery(row = {}) {
  return row.source === 'seed-bias-source-query-executor'
    || row.sourceType === 'seed_bias_source_query'
    || row.source_type === 'seed_bias_source_query'
    || row.metadata?.source === 'seed-bias-source-query-executor';
}

function sourceQueryEvidenceIsDirect(row = {}, evidenceClass = '') {
  const use = compact(row.evidenceUse || row.evidence_use || row.sourceQueryEvidenceUse);
  if (evidenceClass === 'negative_control') return use === 'negative_control_candidate';
  return row.promotionEligible === true && use === 'promotion_candidate';
}

function issuerExposureHasOfficialBridge(row = {}) {
  const text = textOf(row).toLowerCase();
  const official = /\b(official|sec|10-k|10-q|8-k|annual report|quarterly report|investor relations|ir|earnings call|transcript|contract|customer contract|press release|company filing|company release)\b/i.test(text)
    || /\.(sec\.gov)\b/i.test(text)
    || /\b(investors?\.|ir\.)[a-z0-9.-]+\b/i.test(text);
  const issuerFact = /\b(issuer|asml|tsm|tsmc|pwr|etn|vrt|nvda|msft|googl|meta|lmt|rtx|noc|lhx|company|segment)\b/i.test(text);
  const operatingBridge = /\b(segment revenue|revenue|backlog|guidance|capacity|customer exposure|customer demand|book-to-bill|book to bill|contract|orders?|margin|sales)\b/i.test(text);
  return official && issuerFact && operatingBridge;
}

export function evaluateSeedEvidenceAcceptance(row = {}, {
  task = {},
  seenSources = new Set(),
  now = new Date(),
  maxAgeDays = DEFAULT_MAX_AGE_DAYS,
} = {}) {
  const evidenceClass = evidenceClassOf(row, task);
  const blockers = [];
  const warnings = [];
  const key = sourceKey(row);

  if (!evidenceClass) blockers.push('missing_evidence_class');
  if (!key) blockers.push('missing_source_identity');
  if (String(row.acceptanceVerdict || '').startsWith('not_evaluated')) blockers.push('raw_not_accepted_by_acceptance_lane');
  if (isSeedBiasSourceQuery(row) && !sourceQueryEvidenceIsDirect(row, evidenceClass)) blockers.push('source_query_result_not_direct_accepted');
  if (isSeedBiasSourceQuery(row) && evidenceClass === 'issuer_exposure' && !issuerExposureHasOfficialBridge(row)) blockers.push('issuer_exposure_requires_official_bridge');
  if (NON_ACCEPTED_LEDGER_CLASSES.has(evidenceClass)) blockers.push('ledger_class_not_accepted_evidence');
  if (key && seenSources.has(`${evidenceClass}:${key}`)) blockers.push('duplicate_source');
  if (isStale(row, now, maxAgeDays)) blockers.push('stale_evidence');
  if (!isThemeCompatible(row, task)) blockers.push('target_theme_incompatible');

  const desired = compact(task.evidenceClass);
  if (desired && evidenceClass && desired !== evidenceClass) blockers.push('evidence_class_mismatch');
  if (!passesCriteria(row, task.acceptanceCriteria || {}, evidenceClass)) blockers.push('acceptance_criteria_not_met');

  if (evidenceClass === 'market_validation') {
    if (!isLocalControlledMarket(row)) blockers.push('market_validation_requires_local_controlled_data');
    if (!marketTierAccepted(row)) blockers.push('market_validation_tier_not_accepted');
  }

  if (evidenceClass === 'negative_control') {
    warnings.push('negative_control_not_promotion_evidence');
  }

  const accepted = blockers.length === 0;
  const evidenceUse = accepted ? acceptanceUseFor(evidenceClass, row) : 'rejected';
  return {
    ok: true,
    evidenceId: compact(row.evidenceId || row.id || `raw-${task.taskId || evidenceClass || key}`),
    taskId: task.taskId || row.taskId || null,
    seedId: row.seedId || row.operatorSeedId || task.seedId || task.operatorSeedId || null,
    evidenceClass,
    accepted,
    evidenceUse,
    promotionEligible: accepted
      && evidenceUse === 'promotion_candidate'
      && !PROMOTION_BLOCKED_CLASSES.has(evidenceClass),
    blockers: uniqueStrings(blockers, 30),
    warnings: uniqueStrings(warnings, 20),
    acceptanceVerdict: accepted ? 'accepted' : 'rejected',
    coveredEvidenceClasses: accepted && evidenceUse === 'promotion_candidate' ? [evidenceClass] : [],
  };
}

function taskById(tasks = []) {
  const byId = new Map();
  for (const task of asArray(tasks)) {
    if (task.taskId) byId.set(task.taskId, task);
    if (task.evidenceClass && task.seedId) byId.set(`${task.seedId}:${task.evidenceClass}`, task);
  }
  return byId;
}

function taskForRow(row = {}, tasks = [], byId = taskById(tasks)) {
  return byId.get(row.taskId)
    || byId.get(`${row.seedId || row.operatorSeedId}:${row.evidenceClass || row.desiredEvidenceClass}`)
    || asArray(tasks).find((task) => task.evidenceClass === (row.evidenceClass || row.desiredEvidenceClass))
    || {};
}

export function acceptSeedEvidenceRows(rawRows = [], {
  tasks = [],
  now = new Date(),
  maxAgeDays = DEFAULT_MAX_AGE_DAYS,
} = {}) {
  const byId = taskById(tasks);
  const seenSources = new Set();
  const rawEvidence = [];
  const acceptedEvidence = [];

  for (const row of asArray(rawRows)) {
    const task = taskForRow(row, tasks, byId);
    const verdict = evaluateSeedEvidenceAcceptance(row, {
      task,
      seenSources,
      now,
      maxAgeDays,
    });
    const key = sourceKey(row);
    if (key && !verdict.blockers.includes('duplicate_source')) {
      seenSources.add(`${verdict.evidenceClass}:${key}`);
    }
    const raw = {
      ...row,
      evidenceId: verdict.evidenceId,
      taskId: verdict.taskId,
      seedId: verdict.seedId,
      evidenceClass: verdict.evidenceClass,
      rawStored: true,
      accepted: verdict.accepted,
      evidenceUse: verdict.evidenceUse,
      acceptanceVerdict: verdict.acceptanceVerdict,
      acceptanceBlockers: verdict.blockers,
      acceptanceWarnings: verdict.warnings,
      promotionEligible: verdict.promotionEligible,
      coveredEvidenceClasses: verdict.coveredEvidenceClasses,
    };
    rawEvidence.push(raw);
    if (verdict.accepted) {
      acceptedEvidence.push({
        evidenceId: verdict.evidenceId,
        taskId: verdict.taskId,
        seedId: verdict.seedId,
        evidenceClass: verdict.evidenceClass,
        evidenceUse: verdict.evidenceUse,
        promotionEligible: verdict.promotionEligible,
        coveredEvidenceClasses: verdict.coveredEvidenceClasses,
        source: row.source || row.provider || row.sourceProvider || 'seed-bias-backfill',
        providerRoute: row.providerRoute || task.providerRoute || null,
        title: row.title || row.summary || '',
        acceptedAt: now.toISOString(),
        payload: row,
      });
    }
  }

  return {
    ok: true,
    version: SEED_EVIDENCE_ACCEPTANCE_VERSION,
    rawEvidence,
    acceptedEvidence,
    rawEvidenceStoredCount: rawEvidence.length,
    acceptedEvidenceStoredCount: acceptedEvidence.length,
    coveredEvidenceClasses: uniqueStrings(acceptedEvidence.flatMap((item) => item.coveredEvidenceClasses), 80),
    readinessChanged: acceptedEvidence.length > 0,
    acceptanceBoundary: 'raw evidence is never promoted until evidence-class acceptance rules pass',
  };
}

export function coveredEvidenceClassesFromAccepted(acceptedEvidence = []) {
  return uniqueStrings(asArray(acceptedEvidence).flatMap((item) => (
    item.coveredEvidenceClasses?.length ? item.coveredEvidenceClasses : [item.evidenceClass]
  )), 100);
}
