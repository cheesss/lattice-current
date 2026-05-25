import {
  buildRouteAwareSeedEvidencePlan,
} from './seed-evidence-plan.mjs';
import {
  filterIssuerSymbols,
} from './theme-ontology.mjs';

const DIRECT_PROVIDER_PRIORITY = Object.freeze([
  'dod-contracts',
  'usaspending',
  'public-planning-source',
  'sec',
  'fmp',
  'eia',
]);

const DIRECT_PROVIDER_SET = new Set([
  ...DIRECT_PROVIDER_PRIORITY,
  'polygon',
]);

const STRONG_OUTCOME_TIERS = new Set([
  'promotion_candidate',
  'supporting_context',
  'negative_control_candidate',
]);

const PROVIDER_TERMINAL_OUTCOME_TIERS = new Set([
  'needs_fix',
  'weak_noise',
  'rejected',
]);

const PROVIDER_TERMINAL_FAILURE_PATTERNS = Object.freeze([
  /no class-qualified official provider rows/i,
  /provider-no-hit/i,
  /provider no hit/i,
  /official-provider-no-hit/i,
  /acceptance_failed/i,
  /weak-noise-only/i,
]);

const PROVIDER_DEFERRED_STATUSES = new Set([
  'retry_wait',
  'deferred_provider',
]);

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (value === null || value === undefined || value === '') return [];
  return [value];
}

function compact(value) {
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

function evidencePlanForSeedRow(row = {}) {
  const existing = row.evidence_plan || row.evidencePlan || {};
  if (existing?.routeAware && Array.isArray(existing.providerRoutePlans)) return existing;
  const seed = row.seed_json || row.seedJson || row;
  return buildRouteAwareSeedEvidencePlan(seed);
}

function outcomeLedger(row = {}) {
  return asArray((row.evidence_plan || row.evidencePlan || {}).outcomeLedger);
}

export function classifyNegativeControlClosure(rowOrOutcomes = {}) {
  const outcomes = Array.isArray(rowOrOutcomes)
    ? rowOrOutcomes
    : outcomeLedger(rowOrOutcomes);
  const negativeOutcomes = outcomes.filter((outcome) => String(outcome?.evidenceClass || '') === 'negative_control');
  const findingCounts = {};
  for (const outcome of negativeOutcomes) {
    const explicitFinding = compact(outcome.negativeControlFinding || outcome.negativeControlClosure);
    if (explicitFinding && explicitFinding !== 'unchecked') {
      findingCounts[explicitFinding] = (findingCounts[explicitFinding] || 0) + 1;
    }
    for (const [key, value] of Object.entries(outcome.negativeControlFindingCounts || {})) {
      findingCounts[key] = (findingCounts[key] || 0) + Number(value || 0);
    }
  }

  if ((findingCounts.invalidator || 0) > 0) {
    return {
      status: 'negative-control reject',
      closure: 'invalidator',
      findingCounts,
      searchedCount: negativeOutcomes.length,
      reason: 'negative control found substitute, redundancy, no-capacity-pressure, or timing invalidator evidence',
    };
  }
  if ((findingCounts.supported_constraint || 0) > 0) {
    return {
      status: 'supported_constraint',
      closure: 'supported_constraint',
      findingCounts,
      searchedCount: negativeOutcomes.length,
      reason: 'negative control search found evidence that supports the bottleneck constraint rather than invalidating it',
    };
  }
  if ((findingCounts.checked_no_direct || 0) > 0 || negativeOutcomes.length >= 2) {
    return {
      status: 'checked_no_direct',
      closure: 'checked_no_direct',
      findingCounts,
      searchedCount: negativeOutcomes.length,
      reason: 'negative control searches ran without a direct invalidator candidate',
    };
  }
  return {
    status: 'unchecked',
    closure: 'unchecked',
    findingCounts,
    searchedCount: negativeOutcomes.length,
    reason: negativeOutcomes.length ? 'negative control search has only weak or incomplete evidence' : 'negative control has not run',
  };
}

function strongestOutcomeByClass(row = {}) {
  const byClass = new Map();
  for (const outcome of outcomeLedger(row)) {
    const evidenceClass = compact(outcome.evidenceClass);
    if (!evidenceClass) continue;
    const tier = compact(outcome.outcomeTier);
    const existing = byClass.get(evidenceClass);
    if (!existing || STRONG_OUTCOME_TIERS.has(tier)) {
      byClass.set(evidenceClass, { tier, status: outcome.status || '', outcome });
    }
  }
  return byClass;
}

function isProviderBackfillOutcome(outcome = {}) {
  const metadata = outcome.metadata || {};
  return metadata.collectionKind === 'operator_mechanism_seed_provider'
    || metadata.source === 'run-mechanism-seed-provider-backfill'
    || Boolean(metadata.providerRunStatus)
    || Boolean(metadata.providerEvidenceReason);
}

function providerTerminalFailure(outcome = {}) {
  const tier = compact(outcome.outcomeTier);
  if (PROVIDER_TERMINAL_OUTCOME_TIERS.has(tier)) return true;
  const text = [
    outcome.status,
    outcome.failureCategory,
    outcome.metadata?.providerEvidenceReason,
    outcome.sourceQueryFailure?.category,
  ].map(compact).join(' ');
  return PROVIDER_TERMINAL_FAILURE_PATTERNS.some((pattern) => pattern.test(text));
}

function providerDeferred(outcome = {}) {
  const runStatus = compact(outcome.metadata?.providerRunStatus || outcome.status);
  return PROVIDER_DEFERRED_STATUSES.has(runStatus)
    && !providerTerminalFailure(outcome);
}

export function providerBackfillAttemptSummary(row = {}, evidenceClass = '', options = {}) {
  const maxAttempts = Math.max(1, Number(options.maxProviderAttempts || options.maxAttempts || 1));
  const attempts = outcomeLedger(row)
    .filter((outcome) => compact(outcome.evidenceClass) === evidenceClass)
    .filter(isProviderBackfillOutcome);
  const terminalAttempts = attempts.filter(providerTerminalFailure);
  const deferredAttempts = attempts.filter(providerDeferred);
  const lastAttempt = attempts[attempts.length - 1] || null;
  const exhausted = terminalAttempts.length >= maxAttempts;
  const deferred = !exhausted && deferredAttempts.length > 0;
  return {
    evidenceClass,
    attemptCount: attempts.length,
    terminalAttemptCount: terminalAttempts.length,
    deferredAttemptCount: deferredAttempts.length,
    maxAttempts,
    exhausted,
    deferred,
    lastStatus: lastAttempt?.status || null,
    lastTier: lastAttempt?.outcomeTier || null,
    lastFailureCategory: lastAttempt?.failureCategory || null,
    lastProviderRunStatus: lastAttempt?.metadata?.providerRunStatus || null,
    lastReason: lastAttempt?.metadata?.providerEvidenceReason || lastAttempt?.failureCategory || null,
    recordedAt: lastAttempt?.recordedAt || null,
  };
}

function providerPriority(provider = '') {
  const idx = DIRECT_PROVIDER_PRIORITY.indexOf(provider);
  return idx === -1 ? DIRECT_PROVIDER_PRIORITY.length + 1 : idx;
}

export function buildOperatorSeedProviderBackfillPlan(row = {}, options = {}) {
  const plan = evidencePlanForSeedRow(row);
  const outcomeByClass = strongestOutcomeByClass(row);
  const routes = [];
  const deferredRoutes = [];
  const exhaustedRoutes = [];
  const closedRoutes = [];
  const requestedProviders = new Set(uniqueStrings(options.providers || DIRECT_PROVIDER_PRIORITY, 20));

  for (const route of asArray(plan.providerRoutePlans)) {
    const evidenceClass = compact(route.evidenceClass);
    if (!evidenceClass) continue;
    if (evidenceClass === 'negative_control' || evidenceClass === 'market_validation') continue;
    const outcome = outcomeByClass.get(evidenceClass);
    if (outcome && STRONG_OUTCOME_TIERS.has(outcome.tier)) {
      closedRoutes.push({
        evidenceClass,
        providerRoute: route.providerRoute || null,
        outcomeTier: outcome.tier,
        outcomeStatus: outcome.status,
        nextAction: `provider evidence already collected for ${evidenceClass}`,
      });
      continue;
    }
    const attemptSummary = providerBackfillAttemptSummary(row, evidenceClass, options);
    if (route.blocked) {
      const routeSummary = {
        evidenceClass,
        providerRoute: route.providerRoute || null,
        providers: [],
        sourceProviders: uniqueStrings(route.sourceProviders || [], 12),
        issuerUniverse: uniqueStrings(route.issuerUniverse || route.collectionUniverse || [], 20),
        candidateIssuerUniverse: uniqueStrings(route.candidateIssuerUniverse || [], 20),
        queryVariants: uniqueStrings(route.queryVariants || [], 6),
        blockedReason: route.blockedReason || 'blocked',
        providerAttempts: attemptSummary,
      };
      if (attemptSummary.exhausted) {
        exhaustedRoutes.push({
          ...routeSummary,
          nextAction: `adapter/source coverage required for ${evidenceClass}; direct providers exhausted after ${attemptSummary.terminalAttemptCount}/${attemptSummary.maxAttempts} terminal attempt(s)`,
        });
        continue;
      }
      if (attemptSummary.deferred) {
        deferredRoutes.push({
          ...routeSummary,
          nextAction: `wait for provider retry window or resolve ${route.blockedReason || 'blocked route'} for ${evidenceClass}`,
        });
        continue;
      }
      continue;
    }
    const providers = uniqueStrings(asArray(route.executableCollectors)
      .filter((provider) => provider !== 'source-query')
      .filter((provider) => DIRECT_PROVIDER_SET.has(provider))
      .filter((provider) => requestedProviders.has(provider))
      .sort((left, right) => providerPriority(left) - providerPriority(right)), 12);
    if (!providers.length) continue;
    const routeSummary = {
      evidenceClass,
      providerRoute: route.providerRoute || null,
      providers,
      sourceProviders: uniqueStrings(route.sourceProviders || [], 12),
      issuerUniverse: uniqueStrings(route.issuerUniverse || route.collectionUniverse || [], 20),
      candidateIssuerUniverse: uniqueStrings(route.candidateIssuerUniverse || [], 20),
      queryVariants: uniqueStrings(route.queryVariants || [], 6),
      providerAttempts: attemptSummary,
    };
    if (attemptSummary.exhausted) {
      exhaustedRoutes.push({
        ...routeSummary,
        nextAction: `adapter/source coverage required for ${evidenceClass}; direct providers exhausted after ${attemptSummary.terminalAttemptCount}/${attemptSummary.maxAttempts} terminal attempt(s)`,
      });
      continue;
    }
    if (attemptSummary.deferred) {
      deferredRoutes.push({
        ...routeSummary,
        nextAction: `wait for provider retry window or run with --force for ${evidenceClass}: ${providers.join(', ')}`,
      });
      continue;
    }
    routes.push({
      ...routeSummary,
      nextAction: `run official provider collectors for ${evidenceClass}: ${providers.join(', ')}`,
    });
  }

  const providers = uniqueStrings(routes.flatMap((route) => route.providers), 20)
    .sort((left, right) => providerPriority(left) - providerPriority(right));
  const deferredProviders = uniqueStrings(deferredRoutes.flatMap((route) => route.providers), 20)
    .sort((left, right) => providerPriority(left) - providerPriority(right));
  const exhaustedProviders = uniqueStrings(exhaustedRoutes.flatMap((route) => route.providers), 20)
    .sort((left, right) => providerPriority(left) - providerPriority(right));
  const status = routes.length
    ? 'provider_backfill_required'
    : deferredRoutes.length
      ? 'provider_backfill_deferred'
      : exhaustedRoutes.length
        ? 'provider_backfill_exhausted'
        : closedRoutes.length
          ? 'provider_backfill_complete'
          : 'no_direct_provider_route';
  return {
    status,
    providers,
    deferredProviders,
    exhaustedProviders,
    routes,
    deferredRoutes,
    exhaustedRoutes,
    closedRoutes,
    routeCount: routes.length,
    deferredCount: deferredRoutes.length,
    exhaustedCount: exhaustedRoutes.length,
    closedCount: closedRoutes.length,
    nextAction: routes.length
      ? `run mechanism seed provider backfill with providers ${providers.join(', ')}`
      : deferredRoutes.length
        ? `wait for provider retry window or force retry for ${deferredProviders.join(', ')}`
        : exhaustedRoutes.length
          ? 'direct provider backfill exhausted; review provider gap proposals or add missing read-only adapter/source coverage'
          : closedRoutes.length
            ? 'provider evidence collected for direct routes; review seed for report candidate or remaining non-provider gaps'
            : 'refine source-query, resolve issuer universe, or add missing provider adapter',
  };
}

export function summarizeOperatorSeedClosure(row = {}, options = {}) {
  const negativeControl = classifyNegativeControlClosure(row);
  const providerBackfillPlan = buildOperatorSeedProviderBackfillPlan(row, options);
  return {
    negativeControl,
    providerBackfillPlan,
    evidenceState: negativeControl.closure === 'invalidator'
      ? 'negative-control reject'
      : providerBackfillPlan.status === 'provider_backfill_exhausted'
        ? 'provider backfill exhausted'
        : providerBackfillPlan.status === 'provider_backfill_deferred'
          ? 'provider backfill deferred'
          : providerBackfillPlan.status === 'provider_backfill_complete'
            ? 'provider backfill complete'
          : (providerBackfillPlan.routeCount ? 'targeted provider backfill needed' : 'source-query review needed'),
    nextAction: negativeControl.closure === 'invalidator'
      ? 'review negative-control invalidator before promotion or report generation'
      : providerBackfillPlan.nextAction,
  };
}

export function operatorSeedProviderTarget(row = {}, options = {}) {
  const seed = row.seed_json || row.seedJson || row;
  const closure = summarizeOperatorSeedClosure(row, options);
  const providerBackfillPlan = closure.providerBackfillPlan;
  const routes = providerBackfillPlan.routes.map((route) => {
    const evidencePlan = evidencePlanForSeedRow(row);
    return asArray(evidencePlan.providerRoutePlans)
      .find((plan) => compact(plan.evidenceClass) === route.evidenceClass)
      || route;
  });
  const symbols = filterIssuerSymbols(uniqueStrings([
    seed.supplierCategory?.publicIssuerCandidates,
    routes.flatMap((route) => [route.issuerUniverse, route.collectionUniverse, route.candidateIssuerUniverse]),
  ], 30));
  return {
    targetKey: `operator-seed:${seed.seedId || row.seed_id || row.seedId}`,
    theme: seed.theme?.key || row.theme_key || options.theme || 'operator-mechanism-seed',
    label: seed.seedTitle || row.seed_title || seed.bottleneck?.label || row.seed_id || 'operator mechanism seed',
    symbols,
    sources: ['operator_mechanism_seed', 'provider_backfill_plan'],
    operatorSeedId: seed.seedId || row.seed_id || row.seedId || null,
    operatorSeedTitle: seed.seedTitle || row.seed_title || null,
    providerRoutePlans: routes,
    desiredEvidenceClasses: uniqueStrings(routes.map((route) => route.evidenceClass), 30),
  };
}
