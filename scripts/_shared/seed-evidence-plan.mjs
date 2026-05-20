import {
  buildSeedEvidencePlan,
} from './mechanism-seed-generator.mjs';
import {
  providerListForRoutes,
  routeEvidenceProvider,
} from './evidence-provider-router.mjs';
import {
  filterIssuerSymbols,
} from './theme-ontology.mjs';

export const SEED_EVIDENCE_PLAN_VERSION = 'seed-evidence-plan-v1';

const TERMINAL_SEED_STATUSES = Object.freeze([
  'rejected',
  'promoted',
  'report_candidate',
  'report_generated',
  'exhausted',
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

function seedSubject(seed = {}) {
  return compact(seed.bottleneck?.label || seed.seedTitle || seed.theme?.label || seed.seedId || 'mechanism seed');
}

function seedThemes(seed = {}) {
  return uniqueStrings([
    seed.theme?.key,
    seed.theme?.label,
    seed.lineage?.sourceTypes,
  ], 8);
}

function seedText(seed = {}) {
  return [
    seed.theme?.key,
    seed.theme?.label,
    seed.seedTitle,
    seed.growthDriver,
    seed.realActivity,
    seed.physicalProcess,
    seed.requiredInputs,
    seed.bottleneck?.label,
    seed.bottleneck?.class,
    seed.bottleneck?.mechanism,
    seed.supplierCategory?.label,
    seed.evidenceQueries,
  ].flatMap(asArray).join(' ');
}

function seedCandidateIssuers(seed = {}, options = {}) {
  return filterIssuerSymbols(uniqueStrings([
    options.candidateIssuerUniverse,
    seed.candidateIssuerUniverse,
    seed.supplierCategory?.publicIssuerCandidates,
    seed.metadata?.candidateIssuerUniverse,
    seed.lineage?.candidateIssuerUniverse,
  ], 24));
}

function seedPromotionIssuers(seed = {}, options = {}) {
  return filterIssuerSymbols(uniqueStrings([
    options.issuerUniverse,
    seed.issuerUniverse,
    seed.metadata?.issuerUniverse,
    seed.lineage?.issuerUniverse,
  ], 24));
}

function routeInputForSeed(seed = {}, evidenceClass = '', options = {}) {
  const subject = seedSubject(seed);
  return {
    evidenceClass,
    subject,
    target: subject,
    themes: seedThemes(seed),
    ontologyKey: options.ontologyKey || seed.theme?.key || null,
    ontologyKeys: uniqueStrings([options.ontologyKeys, seed.theme?.key], 8),
    issuerUniverse: seedPromotionIssuers(seed, options),
    candidateIssuerUniverse: seedCandidateIssuers(seed, options),
    query: asArray(seed.evidenceQueries)[0] || subject,
    seedTerms: uniqueStrings([seed.requiredInputs, seed.evidenceQueries, seed.counterEvidenceQueries], 24),
    sourceTerms: uniqueStrings([seed.requiredInputs, seed.physicalProcess, seed.bottleneck?.mechanism], 24),
    metadata: {
      operatorSeedId: seed.seedId || null,
      source: 'operator-mechanism-seed',
      sourceTerms: uniqueStrings([seed.requiredInputs, seed.physicalProcess], 16),
      seedTerms: uniqueStrings([seed.requiredInputs, seed.evidenceQueries], 16),
      target: {
        type: 'operator_mechanism_seed',
        seedId: seed.seedId || null,
        displayName: subject,
        candidateIssuerUniverseSymbols: seedCandidateIssuers(seed, options),
        issuerUniverseSymbols: seedPromotionIssuers(seed, options),
      },
    },
    queryVariantLimit: options.queryVariantLimit || 8,
  };
}

function additionalEvidenceClassesForSeed(seed = {}) {
  const text = seedText(seed);
  const out = [];
  if (/\b(defen[cs]e|missile|munition|interceptor|solid rocket|srm|energetic|replenishment|dod)\b/i.test(text)) {
    out.push('procurement_trigger', 'policy_funding');
  }
  if (/\b(data.?center|power|grid|interconnection|switchgear|transformer|substation|cooling|utility)\b/i.test(text)) {
    out.push('power_constraint', 'capex_confirmation');
  }
  if (/\b(cloud|hyperscaler|ai workload)\b/i.test(text)) {
    out.push('cloud_revenue');
  }
  return uniqueStrings(out, 12);
}

const TARGET_THEME_INCOMPATIBLE_CLASSES = Object.freeze({
  'ai-ml': ['mission_award', 'propulsion_constraint', 'missile_replenishment'],
  'cloud-infrastructure': ['mission_award', 'propulsion_constraint', 'missile_replenishment'],
  'data-center-infrastructure': ['mission_award', 'propulsion_constraint', 'missile_replenishment'],
  'clean-energy': ['mission_award', 'propulsion_constraint', 'missile_replenishment', 'cloud_revenue'],
  semiconductor: ['mission_award', 'propulsion_constraint', 'missile_replenishment', 'cloud_revenue'],
  semiconductors: ['mission_award', 'propulsion_constraint', 'missile_replenishment', 'cloud_revenue'],
  'defense-industrial': ['cloud_revenue'],
  space: ['cloud_revenue'],
});

function normalizeEvidenceClassesForTarget(seed = {}, evidenceClasses = []) {
  const targetTheme = compact(seed.theme?.key || seed.theme?.label).toLowerCase();
  const incompatible = new Set([
    ...(TARGET_THEME_INCOMPATIBLE_CLASSES[targetTheme] || []),
    ...(targetTheme.includes('ai') ? TARGET_THEME_INCOMPATIBLE_CLASSES['ai-ml'] : []),
    ...(targetTheme.includes('cloud') ? TARGET_THEME_INCOMPATIBLE_CLASSES['cloud-infrastructure'] : []),
    ...(targetTheme.includes('clean') ? TARGET_THEME_INCOMPATIBLE_CLASSES['clean-energy'] : []),
    ...(targetTheme.includes('defense') ? TARGET_THEME_INCOMPATIBLE_CLASSES['defense-industrial'] : []),
  ]);
  const retained = [];
  const removed = [];
  for (const evidenceClass of uniqueStrings(evidenceClasses, 32)) {
    if (incompatible.has(evidenceClass)) removed.push(evidenceClass);
    else retained.push(evidenceClass);
  }
  return {
    evidenceClasses: retained,
    contaminationWarning: removed.length ? {
      seedId: seed.seedId || null,
      sourceTheme: uniqueStrings([seed.lineage?.sourceTypes, seed.lineage?.sourceIds], 8).join(', '),
      targetTheme: seed.theme?.key || seed.theme?.label || '',
      removedEvidenceClasses: removed,
      retainedEvidenceClasses: retained,
      contaminationWarning: 'adjacent_lane_evidence_class_renormalized_to_target_theme',
    } : null,
  };
}

function evidenceUseForRoute(route = {}) {
  const evidenceClass = String(route.evidenceClass || '');
  if (evidenceClass === 'negative_control') return 'negative_control_candidate';
  if (evidenceClass === 'market_validation') return 'supporting_context';
  return route.promotionEligible ? 'promotion_candidate' : 'supporting_context';
}

function sourceQueryPromotionEligible(route = {}) {
  const evidenceClass = String(route.evidenceClass || '');
  if (evidenceClass === 'negative_control') return false;
  if (evidenceClass === 'market_validation') return false;
  return Boolean(route.promotionEligible);
}

function normalizedQueryKey(value = '') {
  return compact(value).toLowerCase();
}

function routeQueriesWithoutGenericSeedQuery(route = {}, seed = {}) {
  const genericSeedQueries = new Set(asArray(seed.evidenceQueries).map(normalizedQueryKey).filter(Boolean));
  const variants = uniqueStrings(route.queryVariants, 24);
  const specific = variants.filter((query) => !genericSeedQueries.has(normalizedQueryKey(query)));
  return specific.length ? specific : variants;
}

function sourceQueryDraftQueries(route = {}, seed = {}, options = {}) {
  const queryLimit = Math.max(1, Math.min(6, Number(options.queryLimitPerClass || 2)));
  const evidenceClass = String(route.evidenceClass || '');
  const negativeQueries = evidenceClass === 'negative_control' ? seed.counterEvidenceQueries : [];
  return uniqueStrings([
    negativeQueries,
    routeQueriesWithoutGenericSeedQuery(route, seed),
  ], 24).slice(0, queryLimit);
}

function sourceQueryDraftForRoute(seed = {}, route = {}, query = '', index = 0) {
  const evidenceClass = String(route.evidenceClass || '');
  const evidenceUse = evidenceUseForRoute(route);
  const promotionEligible = sourceQueryPromotionEligible(route);
  const subject = seedSubject(seed);
  return {
    draftId: uniqueStrings(['operator-mechanism-seed', seed.seedId, evidenceClass, String(index)], 4).join(':'),
    query,
    reason: `Operator mechanism seed evidence collection for ${evidenceClass}.`,
    source: 'operator-mechanism-seed',
    createdBy: 'operator-mechanism-seed',
    collectionKind: 'operator_mechanism_seed',
    operatorSeedId: seed.seedId || null,
    seedTitle: seed.seedTitle || subject,
    subjectKey: seed.seedId || null,
    subject: {
      subjectType: 'operator_mechanism_seed',
      subjectId: seed.seedId || null,
      displayName: subject,
    },
    target: {
      type: 'operator_mechanism_seed',
      seedId: seed.seedId || null,
      displayName: subject,
      issuerUniverseSymbols: route.promotionUniverse || [],
      candidateIssuerUniverseSymbols: route.candidateIssuerUniverse || [],
    },
    themes: seedThemes(seed),
    desiredEvidenceClass: evidenceClass,
    evidenceClass,
    evidenceUse,
    promotionEligible,
    negativeControlIntent: Boolean(route.negativeControlIntent),
    providerRoutePlan: route,
    issuerHints: route.collectionUniverse || [],
    issuerUniverse: route.issuerUniverse || [],
    candidateIssuerUniverse: route.candidateIssuerUniverse || [],
    metadata: {
      source: 'operator-mechanism-seed',
      operatorSeedId: seed.seedId || null,
      desiredEvidenceClass: evidenceClass,
      evidenceClass,
      evidenceUse,
      promotionEligible,
      providerRoutePlan: route,
      seedEvidencePlanVersion: SEED_EVIDENCE_PLAN_VERSION,
    },
  };
}

function buildSourceQueryDrafts(seed = {}, routes = [], options = {}) {
  const drafts = [];
  for (const route of routes) {
    if (!asArray(route.executableCollectors).includes('source-query')) continue;
    const queries = sourceQueryDraftQueries(route, seed, options);
    queries.forEach((query, index) => {
      drafts.push(sourceQueryDraftForRoute(seed, route, query, index));
    });
  }
  return drafts;
}

function buildMarketValidationPlan(seed = {}, routes = []) {
  const route = routes.find((item) => item.evidenceClass === 'market_validation') || null;
  return {
    evidenceClass: 'market_validation',
    source: 'local_controlled_market_data',
    promotionFromSourceQueryAllowed: false,
    route,
    status: route?.blocked
      ? route.blockedReason || 'blocked'
      : (route ? 'planned' : 'not_required'),
    nextAction: route?.blocked
      ? route.nextAction || 'resolve issuer universe before controlled market validation'
      : 'run local controlled market validation from issuer/event/control rows',
  };
}

export function buildRouteAwareSeedEvidencePlan(seed = {}, options = {}) {
  const base = buildSeedEvidencePlan(seed);
  const normalized = normalizeEvidenceClassesForTarget(seed, uniqueStrings([
    base.evidenceClasses,
    seed.expectedEvidenceClasses,
    additionalEvidenceClassesForSeed(seed),
  ], 32));
  const evidenceClasses = normalized.evidenceClasses;
  const providerRoutePlans = evidenceClasses.map((evidenceClass) => routeEvidenceProvider(routeInputForSeed(seed, evidenceClass, options)));
  const sourceQueryDrafts = buildSourceQueryDrafts(seed, providerRoutePlans, options);
  const negativeControlDrafts = sourceQueryDrafts.filter((draft) => draft.desiredEvidenceClass === 'negative_control');
  const blockedRoutes = providerRoutePlans.filter((route) => route.blocked).map((route) => ({
    evidenceClass: route.evidenceClass,
    blockedReason: route.blockedReason,
    nextAction: route.nextAction,
  }));
  const providerGapLabels = uniqueStrings([
    base.providerGaps,
    seed.providerGaps,
    seed.biasAudit?.provider_gap_labels,
  ], 80);
  return {
    ...base,
    version: SEED_EVIDENCE_PLAN_VERSION,
    routeAware: true,
    evidenceClasses,
    providerRoutePlans,
    executableProviders: providerListForRoutes(providerRoutePlans, options),
    sourceQueryDrafts,
    negativeControlDrafts,
    marketValidationPlan: buildMarketValidationPlan(seed, providerRoutePlans),
    blockedRoutes,
    providerGapLabels,
    contaminationWarnings: normalized.contaminationWarning ? [normalized.contaminationWarning] : [],
    enqueueDefault: false,
    enqueueAllowed: true,
    nextAction: sourceQueryDrafts.length
      ? 'review seed, then run --enqueue-evidence to create seed-scoped source-query approvals'
      : (blockedRoutes[0]?.nextAction || base.nextAction),
  };
}

export async function enqueueSeedEvidenceSourceQueries(client, seeds = [], options = {}) {
  const seedList = asArray(seeds);
  const limit = Math.max(1, Math.min(500, Number(options.limit || 100)));
  let inspectedCount = 0;
  let insertedCount = 0;
  let dedupedCount = 0;
  let failedCount = 0;
  const queued = [];
  const deduped = [];
  const errors = [];

  for (const seed of seedList) {
    const plan = seed.evidencePlan && seed.evidencePlan.routeAware
      ? seed.evidencePlan
      : buildRouteAwareSeedEvidencePlan(seed, options);
    const drafts = asArray(plan.sourceQueryDrafts);
    let seedQueued = 0;
    for (const draft of drafts) {
      if (inspectedCount >= limit) break;
      inspectedCount += 1;
      try {
        const existing = await client.query(`
          SELECT id, status
            FROM approval_queue
           WHERE action_type = 'source-query'
             AND payload->>'operatorSeedId' = $1
             AND LOWER(payload->>'query') = LOWER($2)
             AND payload->>'desiredEvidenceClass' = $3
           ORDER BY created_at DESC
           LIMIT 1
        `, [String(draft.operatorSeedId || ''), draft.query, draft.desiredEvidenceClass]);
        const existingRow = existing.rows?.[0];
        if (existingRow?.id) {
          dedupedCount += 1;
          seedQueued += 1;
          deduped.push({ id: existingRow.id, status: existingRow.status, query: draft.query, operatorSeedId: draft.operatorSeedId });
          continue;
        }
        const reasoning = [
          `Operator mechanism seed source-query (${draft.desiredEvidenceClass})`,
          draft.reason,
          'Seed-scoped approval only; no canonical graph/source registry/provider activation mutation.',
        ].filter(Boolean).join(': ');
        const inserted = await client.query(`
          INSERT INTO approval_queue (action_type, payload, status, reasoning)
          VALUES ('source-query', $1::jsonb, 'pending', $2)
          RETURNING id, status, created_at
        `, [JSON.stringify(draft), reasoning]);
        insertedCount += 1;
        seedQueued += 1;
        queued.push({ id: inserted.rows?.[0]?.id, status: inserted.rows?.[0]?.status || 'pending', query: draft.query, operatorSeedId: draft.operatorSeedId });
      } catch (error) {
        failedCount += 1;
        errors.push({ query: draft.query, operatorSeedId: draft.operatorSeedId, error: String(error?.message || error) });
      }
    }
    if (seedQueued > 0 && options.updateSeedStatus !== false && seed.seedId) {
      await client.query(`
        UPDATE operator_research_seeds
           SET status = CASE
                 WHEN status = ANY($3::text[]) THEN status
                 ELSE 'evidence_running'
               END,
               evidence_plan = $2::jsonb,
               updated_at = NOW()
         WHERE seed_id = $1
      `, [seed.seedId, JSON.stringify(plan), TERMINAL_SEED_STATUSES]);
    }
    if (inspectedCount >= limit) break;
  }

  return {
    ok: failedCount === 0,
    inspectedCount,
    insertedCount,
    dedupedCount,
    failedCount,
    queued,
    deduped,
    errors,
    approvalQueueWrites: insertedCount,
    sourceQueryApprovalWrites: insertedCount,
    reportBackfillWrites: 0,
    canonicalWrites: 0,
    sourceRegistryWrites: 0,
    providerActivationWrites: 0,
  };
}

export const __test = {
  additionalEvidenceClassesForSeed,
  evidenceUseForRoute,
  sourceQueryDraftForRoute,
  normalizeEvidenceClassesForTarget,
};
