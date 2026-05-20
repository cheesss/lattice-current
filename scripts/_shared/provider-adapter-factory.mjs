import crypto from 'node:crypto';

import {
  summarizeProviderGapReview,
} from './provider-gap-proposals.mjs';

export const PROVIDER_ADAPTER_FACTORY_VERSION = 'provider-adapter-factory-v1';

const PROVIDER_ADAPTER_SPECS = Object.freeze({
  dart: {
    provider: 'dart',
    providerGapLabels: ['provider_gap_dart'],
    sourceType: 'non_us_official_filing',
    suggestedAdapterScope: 'read-only Korea DART issuer filing evidence collector',
    authRequired: false,
    apiKeyRequired: false,
    rateLimit: { policy: 'public endpoint; throttle live collection until fixture-backed limits are verified' },
    allowlistFiles: [
      'scripts/_shared/external-data/dart.mjs',
      'scripts/collect-free-external-data.mjs',
      'tests/provider-adapter-dart.test.mjs',
      'tests/fixtures/providers/dart/*.json',
    ],
    fixtureRequirements: [
      'public DART company filing fixture',
      'issuer symbol/identifier mapping fixture',
      'no-result fixture for unavailable issuer',
    ],
    healthCheckCommand: 'node --import tsx scripts/collect-free-external-data.mjs --providers dart --limit 1 --dry-run',
    testCommand: 'node --import tsx --test tests/provider-adapter-dart.test.mjs',
  },
  edinet: {
    provider: 'edinet',
    providerGapLabels: ['provider_gap_edinet'],
    sourceType: 'non_us_official_filing',
    suggestedAdapterScope: 'read-only Japan EDINET issuer filing evidence collector',
    authRequired: false,
    apiKeyRequired: false,
    rateLimit: { policy: 'public endpoint; handle HTTP 429 as deferred_provider' },
    allowlistFiles: [
      'scripts/_shared/external-data/edinet.mjs',
      'scripts/collect-free-external-data.mjs',
      'tests/provider-adapter-edinet.test.mjs',
      'tests/fixtures/providers/edinet/*.json',
    ],
    fixtureRequirements: [
      'public EDINET filing fixture',
      'Japanese issuer identifier fixture',
      'rate-limit or unavailable API fixture',
    ],
    healthCheckCommand: 'node --import tsx scripts/collect-free-external-data.mjs --providers edinet --limit 1 --dry-run',
    testCommand: 'node --import tsx --test tests/provider-adapter-edinet.test.mjs',
  },
  tdnet: {
    provider: 'tdnet',
    providerGapLabels: ['provider_gap_tdnet'],
    sourceType: 'non_us_official_disclosure',
    suggestedAdapterScope: 'read-only Japan TDnet timely disclosure evidence collector',
    authRequired: false,
    apiKeyRequired: false,
    rateLimit: { policy: 'public listing/PDF fetches; throttle and cache by disclosure id' },
    allowlistFiles: [
      'scripts/_shared/external-data/tdnet.mjs',
      'scripts/collect-free-external-data.mjs',
      'tests/provider-adapter-tdnet.test.mjs',
      'tests/fixtures/providers/tdnet/*.json',
    ],
    fixtureRequirements: [
      'TDnet timely disclosure listing fixture',
      'company disclosure PDF/text fixture',
      'no-match fixture',
    ],
    healthCheckCommand: 'node --import tsx scripts/collect-free-external-data.mjs --providers tdnet --limit 1 --dry-run',
    testCommand: 'node --import tsx --test tests/provider-adapter-tdnet.test.mjs',
  },
  eu_ted: {
    provider: 'eu_ted',
    providerGapLabels: ['provider_gap_eu_ted'],
    sourceType: 'government_procurement',
    suggestedAdapterScope: 'read-only EU TED procurement award evidence collector',
    authRequired: false,
    apiKeyRequired: false,
    rateLimit: { policy: 'public procurement API/search; defer on 429 or unavailable source' },
    allowlistFiles: [
      'scripts/_shared/external-data/eu-ted.mjs',
      'scripts/collect-free-external-data.mjs',
      'tests/provider-adapter-eu-ted.test.mjs',
      'tests/fixtures/providers/eu-ted/*.json',
    ],
    fixtureRequirements: [
      'TED contract notice fixture',
      'TED award notice fixture',
      'procurement no-result fixture',
    ],
    healthCheckCommand: 'node --import tsx scripts/collect-free-external-data.mjs --providers eu_ted --limit 1 --dry-run',
    testCommand: 'node --import tsx --test tests/provider-adapter-eu-ted.test.mjs',
  },
  patent_api: {
    provider: 'patent_api',
    providerGapLabels: ['provider_gap_patent_api'],
    sourceType: 'technical_ip',
    suggestedAdapterScope: 'read-only patent and technical qualification evidence collector',
    authRequired: true,
    apiKeyRequired: true,
    rateLimit: { policy: 'provider-key dependent; require explicit throttle and 429 fixture before activation' },
    allowlistFiles: [
      'scripts/_shared/external-data/patent-api.mjs',
      'scripts/collect-free-external-data.mjs',
      'tests/provider-adapter-patent-api.test.mjs',
      'tests/fixtures/providers/patent-api/*.json',
    ],
    fixtureRequirements: [
      'patent search result fixture',
      'assignee normalization fixture',
      'technical qualification keyword fixture',
    ],
    healthCheckCommand: 'node --import tsx scripts/collect-free-external-data.mjs --providers patent_api --limit 1 --dry-run',
    testCommand: 'node --import tsx --test tests/provider-adapter-patent-api.test.mjs',
  },
  trade_media: {
    provider: 'trade_media',
    providerGapLabels: ['provider_gap_trade_media'],
    sourceType: 'trade_press',
    suggestedAdapterScope: 'reviewed trade-media source discovery and search lane',
    authRequired: false,
    apiKeyRequired: false,
    rateLimit: { policy: 'source-specific robots/paywall constraints; no paid access activation from proposal' },
    allowlistFiles: [
      'scripts/_shared/external-data/trade-media.mjs',
      'scripts/collect-free-external-data.mjs',
      'tests/provider-adapter-trade-media.test.mjs',
      'tests/fixtures/providers/trade-media/*.json',
    ],
    fixtureRequirements: [
      'reviewed trade publication source fixture',
      'article extraction fixture',
      'paywall/no-access fixture',
    ],
    healthCheckCommand: 'node --import tsx scripts/collect-free-external-data.mjs --providers trade_media --limit 1 --dry-run',
    testCommand: 'node --import tsx --test tests/provider-adapter-trade-media.test.mjs',
  },
  grid_interconnection_queue: {
    provider: 'grid_interconnection_queue',
    providerGapLabels: ['provider_gap_grid_interconnection_queue'],
    sourceType: 'utility_planning',
    suggestedAdapterScope: 'read-only grid interconnection queue and utility planning evidence collector',
    authRequired: false,
    apiKeyRequired: false,
    rateLimit: { policy: 'ISO/RTO/utility-source dependent; throttle PDF/listing fetches and defer on 429' },
    allowlistFiles: [
      'scripts/_shared/external-data/grid-interconnection-queue.mjs',
      'scripts/collect-free-external-data.mjs',
      'tests/provider-adapter-grid-interconnection-queue.test.mjs',
      'tests/fixtures/providers/grid-interconnection-queue/*.json',
    ],
    fixtureRequirements: [
      'ISO/RTO interconnection queue fixture',
      'utility planning PDF/text fixture',
      'region mapping fixture',
    ],
    healthCheckCommand: 'node --import tsx scripts/collect-free-external-data.mjs --providers grid_interconnection_queue --limit 1 --dry-run',
    testCommand: 'node --import tsx --test tests/provider-adapter-grid-interconnection-queue.test.mjs',
  },
});

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (value === null || value === undefined || value === '') return [];
  return [value];
}

function compact(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function uniqueStrings(values = [], limit = 100) {
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

function providerSpec(provider = '') {
  const key = compact(provider);
  return PROVIDER_ADAPTER_SPECS[key] || {
    provider: key || 'unknown_provider',
    providerGapLabels: key ? [`provider_gap_${key}`] : [],
    sourceType: 'unknown_gap',
    suggestedAdapterScope: 'review-gated read-only evidence collector',
    authRequired: true,
    apiKeyRequired: true,
    rateLimit: { policy: 'unknown provider; require documented limits before activation' },
    allowlistFiles: [
      `scripts/_shared/external-data/${key || 'provider'}.mjs`,
      'scripts/collect-free-external-data.mjs',
      `tests/provider-adapter-${key || 'provider'}.test.mjs`,
    ],
    fixtureRequirements: [
      'positive evidence fixture',
      'no-result fixture',
      'rate-limit or unavailable provider fixture',
    ],
    healthCheckCommand: `node --import tsx scripts/collect-free-external-data.mjs --providers ${key || '<provider>'} --limit 1 --dry-run`,
    testCommand: `node --import tsx --test tests/provider-adapter-${key || 'provider'}.test.mjs`,
  };
}

function parserOutputSchemaForSpec(spec = {}) {
  return spec.parserOutputSchema || {
    type: 'research_evidence_bundle_metadata',
    requiredFields: [
      'provider',
      'sourceUrl',
      'title',
      'publishedAt',
      'desiredEvidenceClass',
      'evidenceUse',
      'promotionEligible',
      'metadata',
    ],
    metadataFields: [
      'providerRoutePlan',
      'collectorCapability',
      'sourceType',
      'factsExtracted',
      'missingFacts',
      'acceptanceVerdict',
    ],
  };
}

function failureModesForSpec(spec = {}) {
  return spec.failureModes || [
    'provider_rate_limited',
    'provider_unavailable',
    'no_result',
    'parser_error',
    'identifier_mapping_missing',
    'acceptance_failed',
  ];
}

function seedIdsForItem(item = {}) {
  return uniqueStrings([
    item.seedId,
    item.seedIds,
    asArray(item.proposals).flatMap((proposal) => proposal.seedIds || []),
  ], 100);
}

function providerItems(items = [], provider = '') {
  return asArray(items).filter((item) => asArray(item.providers).includes(provider));
}

function rankProposal(proposal = {}) {
  return (
    Number(proposal.blockedSeedCount || 0) * 10
    + Number(proposal.evidenceClassesBlocked?.length || 0) * 3
    + Number(proposal.exampleQueries?.length || 0)
    + (proposal.repeatedGap ? 5 : 0)
  );
}

function safetyChecklistForSpec(spec = {}) {
  return {
    branchOnly: true,
    allowlistFiles: spec.allowlistFiles || [],
    fixtureRequired: true,
    fixtureRequirements: spec.fixtureRequirements || [],
    healthCheckRequired: true,
    healthCheckCommand: spec.healthCheckCommand || '',
    testRequired: true,
    testCommand: spec.testCommand || '',
    humanReviewRequired: true,
    providerActivationAllowed: false,
    canonicalMutationAllowed: false,
    sourceRegistryMutationAllowed: false,
    paidProviderActivationAllowed: false,
  };
}

function implementationPlanForSpec(spec = {}) {
  return [
    `Create a read-only ${spec.provider} collector behind collect-free-external-data provider selection.`,
    'Parse provider responses with fixtures before enabling live collection.',
    'Persist only report/seed-scoped evidence metadata until human review approves broader source coverage.',
    'Keep provider activation and source registry changes out of the adapter proposal.',
  ];
}

export function buildProviderAdapterProposalsFromReviewItems(items = [], options = {}) {
  const providers = uniqueStrings(asArray(items).flatMap((item) => item.providers || []), 50);
  const minSeedCount = Math.max(1, Number(options.minSeedCount || 1));
  const proposals = [];
  for (const provider of providers) {
    const spec = providerSpec(provider);
    const matched = providerItems(items, provider);
    const seedIds = uniqueStrings(matched.flatMap(seedIdsForItem), 200);
    if (seedIds.length < minSeedCount) continue;
    const evidenceClassesBlocked = uniqueStrings(matched.flatMap((item) => item.evidenceClassesBlocked || []), 80);
    const matchedProposalGaps = matched.flatMap((item) => (
      asArray(item.proposals)
        .filter((proposal) => proposal.provider === provider)
        .map((proposal) => proposal.providerGap)
    ));
    const providerGapLabels = uniqueStrings([
      spec.providerGapLabels,
      matchedProposalGaps,
    ], 50).filter((gap) => gap.startsWith('provider_gap_'));
    const themes = uniqueStrings(matched.map((item) => item.theme?.key || item.theme?.label), 50);
    const exampleQueries = uniqueStrings([
      matched.flatMap((item) => item.sampleQueries || []),
      matched.flatMap((item) => asArray(item.proposals).flatMap((proposal) => proposal.exampleQueries || [])),
    ], Number(options.queryLimit || 12));
    const proposalId = `padapt-${stableId([provider, providerGapLabels.join(','), evidenceClassesBlocked.join(','), seedIds.join(',')])}`;
    const blockedSeedCount = seedIds.length;
    proposals.push({
      proposalId,
      type: 'provider-gap',
      proposalKind: 'provider_adapter_scope',
      version: PROVIDER_ADAPTER_FACTORY_VERSION,
      provider,
      providerName: provider,
      providerGapLabels,
      sourceType: spec.sourceType,
      reason: `${provider} coverage blocks ${evidenceClassesBlocked.length || 'multiple'} evidence class(es) across ${blockedSeedCount} operator seed(s).`,
      evidenceClassesBlocked,
      fillsEvidenceClass: evidenceClassesBlocked[0] || '',
      fillsEvidenceClasses: evidenceClassesBlocked,
      seedIds,
      reportIds: uniqueStrings(matched.flatMap((item) => item.reportIds || item.latestReportId || []), 100),
      themes,
      exampleQueries,
      suggestedAdapterScope: spec.suggestedAdapterScope,
      suggestedAdapterStatus: 'proposal_only',
      priorityScore: 0,
      repeatedGap: blockedSeedCount > 1,
      authRequired: Boolean(spec.authRequired),
      apiKeyRequired: Boolean(spec.apiKeyRequired),
      rateLimit: spec.rateLimit || { policy: 'document provider rate limits before activation' },
      parserOutputSchema: parserOutputSchemaForSpec(spec),
      failureModes: failureModesForSpec(spec),
      allowlistFiles: spec.allowlistFiles || [],
      fixtureRequirements: spec.fixtureRequirements || [],
      fixtureRequirement: (spec.fixtureRequirements || [])[0] || 'fixture required before live activation',
      healthCheckCommand: spec.healthCheckCommand || '',
      testCommand: spec.testCommand || '',
      safetyChecklist: safetyChecklistForSpec(spec),
      implementationPlan: implementationPlanForSpec(spec),
      activationAllowed: false,
      reviewGatedActivation: true,
      activationPolicy: 'review_gated_no_automatic_activation',
      codeMutationAllowed: false,
      noProviderActivation: true,
      noCanonicalMutation: true,
      noSourceRegistryMutation: true,
      mutationPolicy: {
        dbWrites: 0,
        approvalQueueWrites: 0,
        sourceQueryApprovalWrites: 0,
        reportBackfillWrites: 0,
        researchEvidenceBundleWrites: 0,
        canonicalWrites: 0,
        sourceRegistryWrites: 0,
        providerActivationWrites: 0,
      },
    });
  }
  return proposals
    .map((proposal) => ({ ...proposal, priorityScore: rankProposal(proposal) }))
    .sort((a, b) => b.priorityScore - a.priorityScore || a.provider.localeCompare(b.provider));
}

export function summarizeProviderAdapterProposals(rowsOrReviewSummary = [], options = {}) {
  const generatedAt = options.generatedAt || new Date().toISOString();
  const reviewSummary = rowsOrReviewSummary?.items
    ? rowsOrReviewSummary
    : summarizeProviderGapReview(rowsOrReviewSummary, {
      ...options,
      includeComplete: Boolean(options.includeComplete),
      limit: options.reviewLimit || options.limit || 100,
    });
  const proposals = buildProviderAdapterProposalsFromReviewItems(reviewSummary.items || [], options);
  const providerCounts = {};
  const evidenceClassCounts = {};
  const themeCounts = {};
  for (const proposal of proposals) {
    providerCounts[proposal.provider] = (providerCounts[proposal.provider] || 0) + 1;
    for (const evidenceClass of proposal.evidenceClassesBlocked || []) {
      evidenceClassCounts[evidenceClass] = (evidenceClassCounts[evidenceClass] || 0) + 1;
    }
    for (const theme of proposal.themes || []) themeCounts[theme] = (themeCounts[theme] || 0) + 1;
  }
  return {
    ok: true,
    source: 'operator-provider-adapter-factory',
    version: PROVIDER_ADAPTER_FACTORY_VERSION,
    generatedAt,
    reviewItemCount: reviewSummary.reviewItemCount || 0,
    proposalCount: proposals.length,
    providerCounts,
    evidenceClassCounts,
    themeCounts,
    proposals,
    boundaries: {
      dbWrites: 0,
      codexProposalWrites: 0,
      approvalQueueWrites: 0,
      sourceQueryApprovalWrites: 0,
      reportBackfillWrites: 0,
      researchEvidenceBundleWrites: 0,
      canonicalWrites: 0,
      sourceRegistryWrites: 0,
      providerActivationWrites: 0,
    },
    nextAction: proposals.length
      ? 'review adapter proposals; scaffold read-only provider collectors only on a branch with fixtures, tests, and human approval'
      : 'no adapter proposal needed; run provider-gap review after direct provider backfill has exhausted',
  };
}

export async function persistProviderAdapterProposalReviews(client, proposals = [], options = {}) {
  const status = compact(options.status || 'human-review');
  const source = 'operator-provider-adapter-factory';
  const inserted = [];
  const deduped = [];
  const errors = [];
  for (const proposal of asArray(proposals)) {
    try {
      const existing = await client.query(`
        SELECT id, status
          FROM codex_proposals
         WHERE proposal_type = 'provider-gap'
           AND payload->>'proposalId' = $1
         ORDER BY created_at DESC
         LIMIT 1
      `, [proposal.proposalId]);
      const existingRow = existing.rows?.[0];
      if (existingRow?.id) {
        deduped.push({ id: existingRow.id, status: existingRow.status, proposalId: proposal.proposalId });
        continue;
      }
      const insertedRow = await client.query(`
        INSERT INTO codex_proposals (proposal_type, payload, status, reasoning, source)
        VALUES ('provider-gap', $1::jsonb, $2, $3, $4)
        RETURNING id, status, created_at
      `, [
        JSON.stringify({
          ...proposal,
          activationAllowed: false,
          codeMutationAllowed: false,
          noProviderActivation: true,
          noCanonicalMutation: true,
          noSourceRegistryMutation: true,
        }),
        status,
        `Review-gated provider adapter proposal for ${proposal.provider}; no provider activation or source registry mutation.`,
        source,
      ]);
      inserted.push({
        id: insertedRow.rows?.[0]?.id || null,
        status: insertedRow.rows?.[0]?.status || status,
        proposalId: proposal.proposalId,
        provider: proposal.provider,
      });
    } catch (error) {
      errors.push({
        proposalId: proposal.proposalId || null,
        provider: proposal.provider || null,
        error: String(error?.message || error),
      });
    }
  }
  return {
    ok: errors.length === 0,
    insertedCount: inserted.length,
    dedupedCount: deduped.length,
    failedCount: errors.length,
    inserted,
    deduped,
    errors,
    boundaries: {
      dbWrites: inserted.length,
      codexProposalWrites: inserted.length,
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

export const __test = {
  PROVIDER_ADAPTER_SPECS,
  providerSpec,
  rankProposal,
};
