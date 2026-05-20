import crypto from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import {
  buildRouteAwareSeedEvidencePlan,
} from './seed-evidence-plan.mjs';
import {
  filterIssuerSymbols,
} from './theme-ontology.mjs';
import {
  summarizeOperatorSeedClosure,
} from './operator-seed-closure.mjs';

export const OPERATOR_SEED_GAP_STATE_VERSION = 'operator-seed-gap-closure-state-v1';
export const DEFAULT_OPERATOR_SEED_GAP_STATE_PATH = path.resolve(
  process.cwd(),
  'data/runtime/operator-seed-gap-closure-state.json',
);

const GAP_PROVIDER_MAP = Object.freeze({
  provider_gap_dart: {
    provider: 'dart',
    evidenceClasses: ['issuer_exposure', 'issuer_commentary', 'primary_filing', 'supplier_capacity', 'capex_confirmation', 'cloud_revenue'],
    adapterScope: 'read-only Korea DART issuer filing evidence collector',
    sourceType: 'non_us_official_filing',
  },
  provider_gap_edinet: {
    provider: 'edinet',
    evidenceClasses: ['issuer_exposure', 'issuer_commentary', 'primary_filing', 'supplier_capacity', 'capex_confirmation'],
    adapterScope: 'read-only Japan EDINET issuer filing evidence collector',
    sourceType: 'non_us_official_filing',
  },
  provider_gap_tdnet: {
    provider: 'tdnet',
    evidenceClasses: ['issuer_exposure', 'issuer_commentary', 'primary_filing', 'supplier_capacity'],
    adapterScope: 'read-only Japan TDnet timely disclosure evidence collector',
    sourceType: 'non_us_official_disclosure',
  },
  provider_gap_eu_ted: {
    provider: 'eu_ted',
    evidenceClasses: ['procurement_trigger', 'policy_funding', 'mission_award', 'supplier_capacity'],
    adapterScope: 'read-only EU TED procurement award evidence collector',
    sourceType: 'government_procurement',
  },
  provider_gap_patent_api: {
    provider: 'patent_api',
    evidenceClasses: ['technical_qualification', 'mechanism_validation', 'substitution_limit', 'supplier_capacity'],
    adapterScope: 'read-only patent and technical qualification evidence collector',
    sourceType: 'technical_ip',
  },
  provider_gap_trade_media: {
    provider: 'trade_media',
    evidenceClasses: ['mechanism_validation', 'supplier_capacity', 'substitution_limit', 'negative_control', 'historical_analog', 'issuer_exposure'],
    adapterScope: 'reviewed trade-media source search lane',
    sourceType: 'trade_press',
  },
  provider_gap_grid_interconnection_queue: {
    provider: 'grid_interconnection_queue',
    evidenceClasses: ['power_constraint', 'grid_interconnection', 'supplier_capacity', 'mechanism_validation'],
    adapterScope: 'read-only grid interconnection queue and utility planning evidence collector',
    sourceType: 'utility_planning',
  },
});

const PROVIDER_QUERY_SUFFIXES = Object.freeze({
  dart: ['annual report capacity backlog supplier exposure', 'business report segment revenue capacity constraint'],
  edinet: ['annual securities report capacity supplier exposure backlog', 'management discussion capacity expansion supplier risk'],
  tdnet: ['timely disclosure capacity expansion supplier backlog', 'company disclosure production capacity lead time'],
  eu_ted: ['contract award procurement capacity supplier funding', 'public tender award production capacity infrastructure'],
  patent_api: ['patent qualification technical process supplier capacity', 'patent process equipment qualification bottleneck'],
  trade_media: ['trade press capacity lead time backlog suppliers', 'industry source shortage capacity expansion qualification'],
  grid_interconnection_queue: ['interconnection queue transformer lead time utility planning', 'grid queue substation transformer capacity bottleneck'],
});

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (value === null || value === undefined || value === '') return [];
  return [value];
}

function compact(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function slugify(value = '') {
  return compact(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 160);
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

function stableId(parts = []) {
  return crypto.createHash('sha1').update(parts.map((part) => compact(part)).join('|')).digest('hex').slice(0, 16);
}

function seedFromRow(row = {}) {
  return row.seed_json || row.seedJson || row;
}

function evidencePlanForSeedRow(row = {}) {
  const existing = row.evidence_plan || row.evidencePlan || {};
  if (existing?.routeAware && Array.isArray(existing.providerRoutePlans)) return existing;
  return buildRouteAwareSeedEvidencePlan(seedFromRow(row));
}

function outcomeLedger(row = {}) {
  return asArray((row.evidence_plan || row.evidencePlan || {}).outcomeLedger);
}

function strongEvidenceClasses(row = {}) {
  const strong = new Set();
  for (const outcome of outcomeLedger(row)) {
    if (['promotion_candidate', 'supporting_context', 'negative_control_candidate'].includes(String(outcome?.outcomeTier || ''))) {
      strong.add(String(outcome.evidenceClass || ''));
    }
  }
  return strong;
}

function unresolvedEvidenceClasses(row = {}) {
  const plan = evidencePlanForSeedRow(row);
  const strong = strongEvidenceClasses(row);
  return uniqueStrings(asArray(plan.providerRoutePlans)
    .map((route) => route.evidenceClass)
    .filter((evidenceClass) => evidenceClass && !strong.has(evidenceClass)), 40);
}

function providerGapsForRow(row = {}) {
  const seed = seedFromRow(row);
  return uniqueStrings([
    row.provider_gaps,
    row.providerGaps,
    seed.providerGaps,
    seed.biasAudit?.provider_gap_labels,
  ], 80).filter((gap) => gap.startsWith('provider_gap_'));
}

function seedSubject(seed = {}) {
  return compact(seed.bottleneck?.label || seed.seedTitle || seed.theme?.label || seed.seedId || 'mechanism seed');
}

function seedTheme(row = {}) {
  const seed = seedFromRow(row);
  return compact(seed.theme?.key || row.theme_key || '');
}

function seedSymbols(seed = {}) {
  return filterIssuerSymbols(uniqueStrings([
    seed.supplierCategory?.publicIssuerCandidates,
    seed.candidateIssuerUniverse,
    seed.issuerUniverse,
  ], 30));
}

function classRoute(row = {}, evidenceClass = '') {
  const plan = evidencePlanForSeedRow(row);
  return asArray(plan.providerRoutePlans).find((route) => route.evidenceClass === evidenceClass) || null;
}

function sourceTermsForSeed(seed = {}, limit = 12) {
  return uniqueStrings([
    seed.requiredInputs,
    seed.physicalProcess,
    seed.bottleneck?.mechanism,
    seed.evidenceQueries,
  ], limit);
}

function evidenceClassesForGap(row = {}, gap = '') {
  const spec = GAP_PROVIDER_MAP[gap];
  const unresolved = unresolvedEvidenceClasses(row);
  if (!spec) return unresolved.slice(0, 4);
  const matched = spec.evidenceClasses.filter((cls) => unresolved.includes(cls));
  return matched.length ? matched : spec.evidenceClasses.slice(0, 3);
}

function queryTemplatesForProvider(provider = '', subject = '', seed = {}, evidenceClass = '') {
  const symbols = seedSymbols(seed).slice(0, 4).join(' ');
  const inputs = sourceTermsForSeed(seed, 5).join(' ');
  const suffixes = PROVIDER_QUERY_SUFFIXES[provider] || ['official evidence capacity supplier bottleneck'];
  return uniqueStrings(suffixes.map((suffix) => compact(`${symbols} ${subject} ${inputs} ${evidenceClass.replace(/_/g, ' ')} ${suffix}`)), 4);
}

export function buildProviderGapProposals(row = {}, options = {}) {
  const seed = seedFromRow(row);
  const subject = seedSubject(seed);
  const gaps = providerGapsForRow(row);
  const proposals = [];
  for (const gap of gaps) {
    const spec = GAP_PROVIDER_MAP[gap] || {
      provider: gap.replace(/^provider_gap_/, '').replace(/^missing_/, ''),
      evidenceClasses: unresolvedEvidenceClasses(row).slice(0, 3),
      adapterScope: 'reviewed source coverage gap proposal',
      sourceType: 'unknown_gap',
    };
    const evidenceClassesBlocked = evidenceClassesForGap(row, gap);
    if (!evidenceClassesBlocked.length) continue;
    const queryMap = {};
    for (const evidenceClass of evidenceClassesBlocked) {
      queryMap[evidenceClass] = queryTemplatesForProvider(spec.provider, subject, seed, evidenceClass);
    }
    proposals.push({
      proposalId: `pgap-${stableId([seed.seedId || row.seed_id, gap, evidenceClassesBlocked.join(',')])}`,
      type: 'provider-gap',
      providerGap: gap,
      provider: spec.provider,
      sourceType: spec.sourceType,
      reason: `${gap} blocks direct evidence for ${subject}.`,
      evidenceClassesBlocked,
      seedIds: uniqueStrings([seed.seedId || row.seed_id], 4),
      seedTitle: seed.seedTitle || row.seed_title || subject,
      theme: seedTheme(row),
      exampleQueries: uniqueStrings(Object.values(queryMap).flat(), Number(options.queryLimitPerProposal || 8)),
      queryMap,
      suggestedAdapterScope: spec.adapterScope,
      activationAllowed: false,
      activationPolicy: 'proposal_only_review_gated',
      noProviderActivation: true,
      noCanonicalMutation: true,
    });
  }
  return proposals;
}

function evidenceUseForClass(evidenceClass = '') {
  if (evidenceClass === 'negative_control') return 'negative_control_candidate';
  if (evidenceClass === 'market_validation') return 'supporting_context';
  return ['issuer_exposure', 'issuer_commentary', 'primary_filing', 'supplier_capacity', 'mechanism_validation', 'technical_qualification', 'substitution_limit', 'procurement_trigger', 'policy_funding'].includes(evidenceClass)
    ? 'promotion_candidate'
    : 'supporting_context';
}

function promotionEligibleForClass(evidenceClass = '') {
  return !['negative_control', 'market_validation', 'historical_analog'].includes(evidenceClass);
}

export function buildReviewedSourceQueryDrafts(row = {}, proposals = buildProviderGapProposals(row), options = {}) {
  const seed = seedFromRow(row);
  const subject = seedSubject(seed);
  const drafts = [];
  const perSeedLimit = Math.max(1, Math.min(200, Number(options.queryLimitPerSeed || 24)));
  const perClassLimit = Math.max(1, Math.min(6, Number(options.queryLimitPerClass || 2)));
  for (const proposal of proposals) {
    for (const evidenceClass of proposal.evidenceClassesBlocked) {
      const route = classRoute(row, evidenceClass);
      const queries = uniqueStrings(proposal.queryMap?.[evidenceClass] || proposal.exampleQueries || [], perClassLimit);
      queries.forEach((query, index) => {
        const evidenceUse = evidenceUseForClass(evidenceClass);
        const promotionEligible = promotionEligibleForClass(evidenceClass);
        const providerGapProposal = {
          proposalId: proposal.proposalId,
          type: proposal.type || 'provider-gap',
          provider: proposal.provider,
          providerGap: proposal.providerGap,
          sourceType: proposal.sourceType,
          reason: proposal.reason,
          evidenceClassesBlocked: proposal.evidenceClassesBlocked || [],
          seedIds: proposal.seedIds || [],
          suggestedAdapterScope: proposal.suggestedAdapterScope,
          activationAllowed: false,
          activationPolicy: proposal.activationPolicy || 'proposal_only_review_gated',
          noProviderActivation: true,
          noCanonicalMutation: true,
        };
        drafts.push({
          draftId: `operator-gap:${seed.seedId || row.seed_id}:${proposal.provider}:${evidenceClass}:${index}`,
          query,
          reason: `Reviewed provider-gap source-query for ${proposal.providerGap}; adapter activation remains review-gated.`,
          source: 'operator-provider-gap',
          createdBy: 'operator-mechanism-seed',
          collectionKind: 'operator_mechanism_seed',
          gapClosureKind: 'provider_gap_reviewed_source_query',
          operatorSeedId: seed.seedId || row.seed_id || null,
          seedTitle: seed.seedTitle || row.seed_title || subject,
          subjectKey: seed.seedId || row.seed_id || null,
          subject: {
            subjectType: 'operator_mechanism_seed',
            subjectId: seed.seedId || row.seed_id || null,
            displayName: subject,
          },
          target: {
            type: 'operator_mechanism_seed',
            seedId: seed.seedId || row.seed_id || null,
            displayName: subject,
            issuerUniverseSymbols: route?.issuerUniverse || seedSymbols(seed),
            candidateIssuerUniverseSymbols: route?.candidateIssuerUniverse || seedSymbols(seed),
          },
          themes: uniqueStrings([seed.theme?.key, seed.theme?.label, row.theme_key], 8),
          desiredEvidenceClass: evidenceClass,
          evidenceClass,
          evidenceUse,
          promotionEligible,
          providerGap: proposal.providerGap,
          providerGapProposalId: proposal.proposalId,
          providerGapProvider: proposal.provider,
          providerGapProposal,
          activationAllowed: false,
          providerRoutePlan: {
            ...(route || {}),
            providerGap: proposal.providerGap,
            providerGapProvider: proposal.provider,
            sourceType: proposal.sourceType,
            nextAction: `review source-query result; if no class-qualified evidence appears, keep ${proposal.provider} as adapter_required`,
          },
          issuerHints: route?.collectionUniverse || seedSymbols(seed),
          issuerUniverse: route?.issuerUniverse || [],
          candidateIssuerUniverse: route?.candidateIssuerUniverse || seedSymbols(seed),
          metadata: {
            source: 'operator-provider-gap',
            operatorSeedId: seed.seedId || row.seed_id || null,
            desiredEvidenceClass: evidenceClass,
            evidenceClass,
            evidenceUse,
            promotionEligible,
            gapClosureKind: 'provider_gap_reviewed_source_query',
            providerGap: proposal.providerGap,
            providerGapProposalId: proposal.proposalId,
            providerGapProvider: proposal.provider,
            providerGapProposal,
            suggestedAdapterScope: proposal.suggestedAdapterScope,
            providerRoutePlan: route || null,
            activationAllowed: false,
            noProviderActivation: true,
            noCanonicalMutation: true,
          },
        });
      });
      if (drafts.length >= perSeedLimit) return drafts.slice(0, perSeedLimit);
    }
  }
  return drafts.slice(0, perSeedLimit);
}

function stateAwareDraftBuildOptions(options = {}) {
  const perSeedLimit = Math.max(1, Math.min(200, Number(options.queryLimitPerSeed || 24)));
  if (!options.state && !options.expandForTerminalState) return options;
  return {
    ...options,
    queryLimitPerSeed: Math.max(perSeedLimit * 4, perSeedLimit + 24),
  };
}

function limitReadyDrafts(filtered = {}, options = {}) {
  const perSeedLimit = Math.max(1, Math.min(200, Number(options.queryLimitPerSeed || 24)));
  return {
    ready: asArray(filtered.ready).slice(0, perSeedLimit),
    skipped: asArray(filtered.skipped),
  };
}

export function gapAttemptKey({ seedId = '', evidenceClass = '', provider = '', query = '' } = {}) {
  return [
    compact(seedId),
    compact(evidenceClass),
    compact(provider),
    stableId([query]),
  ].map(slugify).join(':');
}

export function createEmptyGapClosureState() {
  return {
    version: OPERATOR_SEED_GAP_STATE_VERSION,
    updatedAt: new Date().toISOString(),
    attempts: {},
  };
}

export async function loadOperatorSeedGapClosureState(filePath = DEFAULT_OPERATOR_SEED_GAP_STATE_PATH) {
  try {
    const parsed = JSON.parse(await readFile(filePath, 'utf8'));
    return {
      ...createEmptyGapClosureState(),
      ...parsed,
      attempts: parsed.attempts || {},
    };
  } catch {
    return createEmptyGapClosureState();
  }
}

export async function saveOperatorSeedGapClosureState(state = createEmptyGapClosureState(), filePath = DEFAULT_OPERATOR_SEED_GAP_STATE_PATH) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const payload = {
    ...state,
    version: OPERATOR_SEED_GAP_STATE_VERSION,
    updatedAt: new Date().toISOString(),
    attempts: state.attempts || {},
  };
  await writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  return payload;
}

export function shouldSkipGapAttempt(state = {}, draft = {}, options = {}) {
  const key = gapAttemptKey({
    seedId: draft.operatorSeedId,
    evidenceClass: draft.desiredEvidenceClass,
    provider: draft.providerGapProvider,
    query: draft.query,
  });
  const attempt = state.attempts?.[key];
  if (!attempt) return { skip: false, key };
  const maxAttempts = Math.max(1, Number(options.maxAttempts || 1));
  if (attempt.exhausted || Number(attempt.attempts || 0) >= maxAttempts) {
    return { skip: true, key, reason: 'attempt_exhausted', attempt };
  }
  const throttleHours = Math.max(0, Number(options.throttleHours || 0));
  if (throttleHours && attempt.updatedAt && Date.now() - Date.parse(attempt.updatedAt) < throttleHours * 3600_000) {
    return { skip: true, key, reason: 'attempt_throttled', attempt };
  }
  return { skip: false, key, attempt };
}

export function filterReviewedSourceQueryDraftsByState(drafts = [], state = createEmptyGapClosureState(), options = {}) {
  const ready = [];
  const skipped = [];
  for (const draft of asArray(drafts)) {
    if (options.force) {
      ready.push({
        draft,
        key: gapAttemptKey({
          seedId: draft.operatorSeedId,
          evidenceClass: draft.desiredEvidenceClass,
          provider: draft.providerGapProvider,
          query: draft.query,
        }),
      });
      continue;
    }
    const decision = shouldSkipGapAttempt(state, draft, options);
    if (decision.skip) skipped.push({ draft, ...decision });
    else ready.push({ draft, ...decision });
  }
  return { ready, skipped };
}

export function recordGapAttempt(state = createEmptyGapClosureState(), draft = {}, result = {}) {
  const key = gapAttemptKey({
    seedId: draft.operatorSeedId,
    evidenceClass: draft.desiredEvidenceClass,
    provider: draft.providerGapProvider,
    query: draft.query,
  });
  const previous = state.attempts?.[key] || {};
  const attempts = Number(previous.attempts || 0) + 1;
  return {
    ...state,
    updatedAt: new Date().toISOString(),
    attempts: {
      ...(state.attempts || {}),
      [key]: {
        key,
        seedId: draft.operatorSeedId || null,
        evidenceClass: draft.desiredEvidenceClass || null,
        provider: draft.providerGapProvider || null,
        providerGap: draft.providerGap || null,
        query: draft.query || '',
        attempts,
        status: result.status || 'queued',
        lastResult: result,
        exhausted: Boolean(result.exhausted) || attempts >= Math.max(1, Number(result.maxAttempts || 1)),
        updatedAt: new Date().toISOString(),
      },
    },
  };
}

function sourceQueryReasoningForDraft(draft = {}) {
  return [
    `Operator mechanism seed provider-gap source-query (${draft.desiredEvidenceClass})`,
    draft.reason,
    `Provider gap: ${draft.providerGap || 'unknown'} / ${draft.providerGapProvider || 'unknown'}.`,
    'Seed-scoped approval only; no canonical graph/source registry/provider activation mutation.',
  ].filter(Boolean).join(' ');
}

function payloadForGapDraft(draft = {}, key = '') {
  return {
    ...draft,
    metadata: {
      ...(draft.metadata || {}),
      gapAttemptKey: key || null,
      gapClosureStateVersion: OPERATOR_SEED_GAP_STATE_VERSION,
    },
  };
}

export async function enqueueProviderGapSourceQueryApprovals(client, rows = [], options = {}) {
  const state = options.state || createEmptyGapClosureState();
  const limit = Math.max(1, Math.min(1000, Number(options.limit || 100)));
  const seedRows = asArray(rows);
  const queued = [];
  const deduped = [];
  const skipped = [];
  const errors = [];
  let inspectedCount = 0;
  let insertedCount = 0;
  let dedupedCount = 0;
  let skippedCount = 0;
  let failedCount = 0;
  let nextState = state;

  for (const row of seedRows) {
    const proposals = buildProviderGapProposals(row, options);
    const drafts = buildReviewedSourceQueryDrafts(row, proposals, stateAwareDraftBuildOptions({
      ...options,
      state: nextState,
    }));
    const filtered = limitReadyDrafts(filterReviewedSourceQueryDraftsByState(drafts, nextState, options), options);
    for (const item of filtered.skipped) {
      skippedCount += 1;
      skipped.push({
        operatorSeedId: item.draft?.operatorSeedId || null,
        provider: item.draft?.providerGapProvider || null,
        evidenceClass: item.draft?.desiredEvidenceClass || null,
        query: item.draft?.query || '',
        reason: item.reason,
        attempts: item.attempt?.attempts || 0,
        exhausted: Boolean(item.attempt?.exhausted),
      });
    }

    for (const item of filtered.ready) {
      if (inspectedCount >= limit) break;
      const draft = item.draft;
      inspectedCount += 1;
      try {
        const key = item.key || gapAttemptKey({
          seedId: draft.operatorSeedId,
          evidenceClass: draft.desiredEvidenceClass,
          provider: draft.providerGapProvider,
          query: draft.query,
        });
        const existing = await client.query(`
          SELECT id, status
            FROM approval_queue
           WHERE action_type = 'source-query'
             AND payload->>'operatorSeedId' = $1
             AND LOWER(payload->>'query') = LOWER($2)
             AND payload->>'desiredEvidenceClass' = $3
             AND COALESCE(payload->>'providerGap', '') = $4
           ORDER BY created_at DESC
           LIMIT 1
        `, [
          String(draft.operatorSeedId || ''),
          draft.query,
          String(draft.desiredEvidenceClass || ''),
          String(draft.providerGap || ''),
        ]);
        const existingRow = existing.rows?.[0];
        if (existingRow?.id) {
          dedupedCount += 1;
          deduped.push({
            id: existingRow.id,
            status: existingRow.status,
            operatorSeedId: draft.operatorSeedId,
            provider: draft.providerGapProvider,
            evidenceClass: draft.desiredEvidenceClass,
            query: draft.query,
          });
          nextState = recordGapAttempt(nextState, draft, {
            status: 'deduped',
            approvalId: existingRow.id,
            approvalStatus: existingRow.status,
            maxAttempts: options.maxAttempts || 1,
          });
          continue;
        }

        const payload = payloadForGapDraft(draft, key);
        const inserted = await client.query(`
          INSERT INTO approval_queue (action_type, payload, status, reasoning)
          VALUES ('source-query', $1::jsonb, 'pending', $2)
          RETURNING id, status, created_at
        `, [JSON.stringify(payload), sourceQueryReasoningForDraft(draft)]);
        const insertedRow = inserted.rows?.[0] || {};
        insertedCount += 1;
        queued.push({
          id: insertedRow.id,
          status: insertedRow.status || 'pending',
          operatorSeedId: draft.operatorSeedId,
          provider: draft.providerGapProvider,
          evidenceClass: draft.desiredEvidenceClass,
          query: draft.query,
        });
        nextState = recordGapAttempt(nextState, draft, {
          status: 'queued',
          approvalId: insertedRow.id || null,
          maxAttempts: options.maxAttempts || 1,
        });
      } catch (error) {
        failedCount += 1;
        errors.push({
          operatorSeedId: draft?.operatorSeedId || null,
          provider: draft?.providerGapProvider || null,
          evidenceClass: draft?.desiredEvidenceClass || null,
          query: draft?.query || '',
          error: String(error?.message || error),
        });
        nextState = recordGapAttempt(nextState, draft, {
          status: 'error',
          error: String(error?.message || error),
          exhausted: false,
          maxAttempts: options.maxAttempts || 1,
        });
      }
    }
    if (inspectedCount >= limit) break;
  }

  return {
    ok: failedCount === 0,
    inspectedCount,
    insertedCount,
    dedupedCount,
    skippedCount,
    failedCount,
    queued,
    deduped,
    skipped,
    errors,
    state: nextState,
    approvalQueueWrites: insertedCount,
    sourceQueryApprovalWrites: insertedCount,
    reportBackfillWrites: 0,
    canonicalWrites: 0,
    sourceRegistryWrites: 0,
    providerActivationWrites: 0,
  };
}

export function buildProviderGapClosureSummary(row = {}, options = {}) {
  const proposals = buildProviderGapProposals(row, options);
  const state = options.state || createEmptyGapClosureState();
  const drafts = buildReviewedSourceQueryDrafts(row, proposals, stateAwareDraftBuildOptions({
    ...options,
    state,
  }));
  const filtered = limitReadyDrafts(filterReviewedSourceQueryDraftsByState(drafts, state, options), options);
  return {
    proposalCount: proposals.length,
    draftCount: drafts.length,
    readyDraftCount: filtered.ready.length,
    skippedDraftCount: filtered.skipped.length,
    providers: uniqueStrings(proposals.map((proposal) => proposal.provider), 20),
    evidenceClasses: uniqueStrings(proposals.flatMap((proposal) => proposal.evidenceClassesBlocked), 30),
    proposals,
    drafts,
    readyDrafts: filtered.ready.map((item) => item.draft),
    skippedDrafts: filtered.skipped.map((item) => ({
      draftId: item.draft?.draftId,
      operatorSeedId: item.draft?.operatorSeedId,
      provider: item.draft?.providerGapProvider,
      evidenceClass: item.draft?.desiredEvidenceClass,
      reason: item.reason,
      attempts: item.attempt?.attempts || 0,
      exhausted: Boolean(item.attempt?.exhausted),
    })),
    nextAction: proposals.length
      ? 'review provider-gap proposals or enqueue reviewed source-query gap closure drafts'
      : 'no provider gap proposal available',
  };
}

function scoreForRow(row = {}) {
  return Number(row.scores?.composite_seed_score || row.seed_json?.scores?.composite_seed_score || row.seedJson?.scores?.composite_seed_score || 0);
}

function reviewableProposal(proposal = {}, options = {}) {
  return {
    proposalId: proposal.proposalId,
    type: proposal.type || 'provider-gap',
    providerGap: proposal.providerGap,
    provider: proposal.provider,
    sourceType: proposal.sourceType,
    reason: proposal.reason,
    evidenceClassesBlocked: uniqueStrings(proposal.evidenceClassesBlocked || [], 30),
    seedIds: uniqueStrings(proposal.seedIds || [], 10),
    seedTitle: proposal.seedTitle,
    theme: proposal.theme,
    exampleQueries: uniqueStrings(proposal.exampleQueries || [], Number(options.queryLimitPerProposal || 5)),
    suggestedAdapterScope: proposal.suggestedAdapterScope,
    activationAllowed: false,
    activationPolicy: proposal.activationPolicy || 'proposal_only_review_gated',
    noProviderActivation: true,
    noCanonicalMutation: true,
  };
}

function reviewableRoute(route = {}) {
  return {
    evidenceClass: route.evidenceClass,
    providerRoute: route.providerRoute || null,
    providers: uniqueStrings(route.providers || [], 12),
    sourceProviders: uniqueStrings(route.sourceProviders || [], 12),
    issuerUniverse: uniqueStrings(route.issuerUniverse || [], 20),
    candidateIssuerUniverse: uniqueStrings(route.candidateIssuerUniverse || [], 20),
    providerAttempts: route.providerAttempts
      ? {
        attemptCount: route.providerAttempts.attemptCount,
        terminalAttemptCount: route.providerAttempts.terminalAttemptCount,
        deferredAttemptCount: route.providerAttempts.deferredAttemptCount,
        maxAttempts: route.providerAttempts.maxAttempts,
        exhausted: Boolean(route.providerAttempts.exhausted),
        deferred: Boolean(route.providerAttempts.deferred),
        lastStatus: route.providerAttempts.lastStatus,
        lastTier: route.providerAttempts.lastTier,
        lastFailureCategory: route.providerAttempts.lastFailureCategory,
        lastProviderRunStatus: route.providerAttempts.lastProviderRunStatus,
        lastReason: route.providerAttempts.lastReason,
      }
      : null,
    nextAction: route.nextAction || null,
  };
}

function providerGapReviewState(closure = {}, proposalSummary = {}) {
  const providerStatus = closure.providerBackfillPlan?.status || 'unknown';
  if (closure.negativeControl?.closure === 'invalidator') return 'negative_control_review';
  if (providerStatus === 'provider_backfill_exhausted') return proposalSummary.proposalCount
    ? 'adapter_or_source_coverage_review'
    : 'blocked_missing_provider_gap_labels';
  if (providerStatus === 'provider_backfill_deferred') return 'provider_retry_deferred';
  if (providerStatus === 'provider_backfill_required') return 'direct_provider_backfill_required';
  if (providerStatus === 'provider_backfill_complete') return proposalSummary.proposalCount
    ? 'residual_provider_gap_review'
    : 'provider_backfill_complete';
  return proposalSummary.proposalCount ? 'source_coverage_review' : 'no_provider_gap_review_needed';
}

function nextActionForProviderGapReview(reviewState = '', proposalSummary = {}, closure = {}) {
  if (reviewState === 'negative_control_review') return 'review negative-control invalidator before any promotion or report candidate work';
  if (reviewState === 'adapter_or_source_coverage_review') {
    return proposalSummary.readyDraftCount > 0
      ? 'review provider gap proposals; optionally enqueue reviewed seed-scoped source-query drafts before proposing adapters'
      : 'provider/source coverage remains blocked; propose read-only adapter scope or mark seed monitor-only';
  }
  if (reviewState === 'blocked_missing_provider_gap_labels') return 'add provider gap labels or refine source coverage audit for this seed';
  if (reviewState === 'provider_retry_deferred') return closure.providerBackfillPlan?.nextAction || 'wait for provider retry window';
  if (reviewState === 'direct_provider_backfill_required') return closure.providerBackfillPlan?.nextAction || 'run direct provider backfill before adapter review';
  if (reviewState === 'residual_provider_gap_review') return 'provider evidence exists; review remaining provider gaps before report-candidate promotion';
  if (reviewState === 'provider_backfill_complete') return 'provider evidence collected for direct routes; review seed for report candidate or remaining non-provider gaps';
  return proposalSummary.nextAction || 'no provider gap review needed';
}

export function buildProviderGapReviewItem(row = {}, options = {}) {
  const seed = seedFromRow(row);
  const closure = summarizeOperatorSeedClosure(row, options);
  const proposalSummary = buildProviderGapClosureSummary(row, options);
  const reviewState = providerGapReviewState(closure, proposalSummary);
  const providerBackfill = closure.providerBackfillPlan || {};
  const proposals = proposalSummary.proposals.map((proposal) => reviewableProposal(proposal, options));
  const providerGaps = providerGapsForRow(row);
  const evidenceClassesBlocked = uniqueStrings([
    proposalSummary.evidenceClasses,
    providerBackfill.exhaustedRoutes?.map((route) => route.evidenceClass),
  ], 50);
  return {
    seedId: seed.seedId || row.seed_id || row.seedId || null,
    title: seed.seedTitle || row.seed_title || seedSubject(seed),
    status: row.status || seed.status || '',
    theme: {
      key: seed.theme?.key || row.theme_key || '',
      label: seed.theme?.label || row.theme_label || '',
    },
    score: scoreForRow(row),
    reviewState,
    primaryBlocker: reviewState === 'adapter_or_source_coverage_review'
      ? 'direct_provider_exhausted'
      : reviewState,
    evidenceState: closure.evidenceState,
    negativeControl: closure.negativeControl,
    providerBackfill: {
      status: providerBackfill.status,
      providers: providerBackfill.providers || [],
      exhaustedProviders: providerBackfill.exhaustedProviders || [],
      deferredProviders: providerBackfill.deferredProviders || [],
      routeCount: providerBackfill.routeCount || 0,
      exhaustedCount: providerBackfill.exhaustedCount || 0,
      deferredCount: providerBackfill.deferredCount || 0,
      closedCount: providerBackfill.closedCount || 0,
      nextAction: providerBackfill.nextAction,
    },
    providerGaps,
    providers: proposalSummary.providers,
    evidenceClassesBlocked,
    proposalCount: proposalSummary.proposalCount,
    readyDraftCount: proposalSummary.readyDraftCount,
    skippedDraftCount: proposalSummary.skippedDraftCount,
    proposals,
    exhaustedRoutes: asArray(providerBackfill.exhaustedRoutes).map(reviewableRoute),
    closedRoutes: asArray(providerBackfill.closedRoutes).map(reviewableRoute),
    sampleQueries: uniqueStrings(
      asArray(proposalSummary.readyDrafts?.length ? proposalSummary.readyDrafts : proposalSummary.drafts)
        .map((draft) => draft.query),
      Number(options.sampleQueryLimit || 5),
    ),
    nextAction: nextActionForProviderGapReview(reviewState, proposalSummary, closure),
    mutationPolicy: {
      approvalQueueWrites: 0,
      reportBackfillWrites: 0,
      researchEvidenceBundleWrites: 0,
      canonicalWrites: 0,
      sourceRegistryWrites: 0,
      providerActivationWrites: 0,
      providerActivationAllowed: false,
      canonicalMutationAllowed: false,
    },
  };
}

function shouldIncludeProviderGapReviewItem(item = {}, options = {}) {
  if (options.includeComplete) return item.proposalCount > 0 || item.providerBackfill?.status === 'provider_backfill_complete';
  if (options.provider && !item.providers.includes(options.provider)) return false;
  return [
    'adapter_or_source_coverage_review',
    'blocked_missing_provider_gap_labels',
    'negative_control_review',
  ].includes(item.reviewState);
}

export function summarizeProviderGapReview(rows = [], options = {}) {
  const generatedAt = options.generatedAt || new Date().toISOString();
  const limit = Math.max(1, Math.min(500, Number(options.limit || 100)));
  const rawItems = asArray(rows).map((row) => buildProviderGapReviewItem(row, options));
  const items = rawItems
    .filter((item) => shouldIncludeProviderGapReviewItem(item, options))
    .slice(0, limit);
  const providerCounts = {};
  const providerGapCounts = {};
  const evidenceClassCounts = {};
  const reviewStateCounts = {};
  const seedStatusCounts = {};
  const themeCounts = {};
  for (const item of items) {
    reviewStateCounts[item.reviewState] = (reviewStateCounts[item.reviewState] || 0) + 1;
    seedStatusCounts[item.status || 'unknown'] = (seedStatusCounts[item.status || 'unknown'] || 0) + 1;
    if (item.theme?.key) themeCounts[item.theme.key] = (themeCounts[item.theme.key] || 0) + 1;
    for (const provider of item.providers || []) providerCounts[provider] = (providerCounts[provider] || 0) + 1;
    for (const gap of item.providerGaps || []) providerGapCounts[gap] = (providerGapCounts[gap] || 0) + 1;
    for (const evidenceClass of item.evidenceClassesBlocked || []) {
      evidenceClassCounts[evidenceClass] = (evidenceClassCounts[evidenceClass] || 0) + 1;
    }
  }
  return {
    ok: true,
    source: 'operator-seed-provider-gap-review',
    generatedAt,
    totalRows: rawItems.length,
    reviewItemCount: items.length,
    exhaustedSeedCount: rawItems.filter((item) => item.providerBackfill?.status === 'provider_backfill_exhausted').length,
    completeSeedCount: rawItems.filter((item) => item.providerBackfill?.status === 'provider_backfill_complete').length,
    proposalCount: items.reduce((sum, item) => sum + Number(item.proposalCount || 0), 0),
    readyDraftCount: items.reduce((sum, item) => sum + Number(item.readyDraftCount || 0), 0),
    skippedDraftCount: items.reduce((sum, item) => sum + Number(item.skippedDraftCount || 0), 0),
    providerCounts,
    providerGapCounts,
    evidenceClassCounts,
    reviewStateCounts,
    seedStatusCounts,
    themeCounts,
    items,
    boundaries: {
      dbWrites: 0,
      approvalQueueWrites: 0,
      sourceQueryApprovalWrites: 0,
      reportBackfillWrites: 0,
      researchEvidenceBundleWrites: 0,
      canonicalWrites: 0,
      sourceRegistryWrites: 0,
      providerActivationWrites: 0,
    },
    nextAction: items.length
      ? 'review provider gap items; queue only reviewed seed-scoped source-query drafts or open review-gated adapter proposals'
      : 'no provider gap review items; run direct provider backfill dry-run or inspect seed closure summary',
  };
}

export const __test = {
  GAP_PROVIDER_MAP,
  queryTemplatesForProvider,
  unresolvedEvidenceClasses,
};
