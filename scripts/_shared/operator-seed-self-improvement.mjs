import crypto from 'node:crypto';

import {
  buildRouteAwareSeedEvidencePlan,
} from './seed-evidence-plan.mjs';
import {
  summarizeOperatorSeedClosure,
} from './operator-seed-closure.mjs';

export const OPERATOR_SEED_SELF_IMPROVEMENT_VERSION = 'operator-seed-self-improvement-v1';

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

function seedFromRow(row = {}) {
  return row.seed_json || row.seedJson || row;
}

function seedIdForRow(row = {}) {
  return compact(row.seed_id || row.seedId || row.seed_json?.seedId || row.seedJson?.seedId);
}

function planForRow(row = {}) {
  const plan = row.evidence_plan || row.evidencePlan;
  if (plan && typeof plan === 'object' && Object.keys(plan).length) return plan;
  return buildRouteAwareSeedEvidencePlan(seedFromRow(row));
}

function biasAuditForRow(row = {}) {
  return row.bias_audit || row.biasAudit || seedFromRow(row).biasAudit || {};
}

function providerGapsForRow(row = {}) {
  const seed = seedFromRow(row);
  return uniqueStrings([
    row.provider_gaps,
    row.providerGaps,
    seed.providerGaps,
    biasAuditForRow(row).provider_gap_labels,
  ], 80).filter((gap) => gap.startsWith('provider_gap_'));
}

function themeForRow(row = {}) {
  const seed = seedFromRow(row);
  return compact(row.theme_key || seed.theme?.key || seed.theme?.label || 'unknown');
}

function titleForRow(row = {}) {
  const seed = seedFromRow(row);
  return compact(row.seed_title || seed.seedTitle || seed.bottleneck?.label || seedIdForRow(row));
}

function reviewText(row = {}) {
  const seed = seedFromRow(row);
  const review = row.review_state || row.reviewState || {};
  return [
    row.status,
    seed.status,
    seed.rejectionReason,
    seed.rejectionReasons,
    seed.diagnostics,
    review.latest?.reason,
    asArray(review.history).map((item) => item.reason),
  ].flatMap(asArray).map(compact).join(' ');
}

function hasStrongOutcome(row = {}, evidenceClass = '') {
  const plan = planForRow(row);
  return asArray(plan.outcomeLedger).some((outcome) => (
    compact(outcome.evidenceClass) === evidenceClass
    && ['promotion_candidate', 'supporting_context', 'negative_control_candidate'].includes(compact(outcome.outcomeTier))
  ));
}

function evidenceClassesMissingForRow(row = {}) {
  const plan = planForRow(row);
  return uniqueStrings(asArray(plan.providerRoutePlans)
    .map((route) => compact(route.evidenceClass))
    .filter((evidenceClass) => evidenceClass && !hasStrongOutcome(row, evidenceClass)), 80);
}

function issuerUniverseEmptyClasses(row = {}) {
  const plan = planForRow(row);
  return uniqueStrings(asArray(plan.providerRoutePlans)
    .filter((route) => ['issuer_exposure', 'issuer_commentary', 'primary_filing', 'market_validation'].includes(compact(route.evidenceClass)))
    .filter((route) => {
      const count = asArray(route.issuerUniverse).length + asArray(route.candidateIssuerUniverse).length + asArray(route.collectionUniverse).length;
      return count === 0 || route.blockedReason === 'blocked_missing_issuer_universe';
    })
    .map((route) => compact(route.evidenceClass)), 20);
}

function marketValidationProblem(row = {}) {
  const plan = planForRow(row);
  const market = plan.marketValidationPlan || asArray(plan.providerRoutePlans).find((route) => route.evidenceClass === 'market_validation') || {};
  const reason = compact(
    market.missingReason
    || market.blockedReason
    || market.reason
    || market.nextAction
    || '',
  );
  if (/no_event_uplift|event_uplift|no rows|no_event_candidates|no_issuer|weak_controls|below_tstat/i.test(reason)) return reason || 'market_validation_no_rows';
  if (market.blocked || market.status === 'missing') return reason || 'market_validation_missing';
  return '';
}

function negativeControlUnchecked(row = {}) {
  const closure = summarizeOperatorSeedClosure(row);
  const status = compact(closure.negativeControl?.closure || closure.negativeControl?.status || '');
  if (!status || status === 'unchecked' || status === 'missing') return true;
  return false;
}

function sourceCoverageMonoculture(row = {}) {
  const audit = biasAuditForRow(row);
  const flags = uniqueStrings([audit.bias_flags, audit.flags, audit.missing_sources], 80);
  const lowRegion = Number(audit.source_region_diversity ?? audit.sourceRegionDiversity ?? 0) <= 1;
  const lowType = Number(audit.source_type_diversity ?? audit.sourceTypeDiversity ?? 0) <= 1;
  return flags.some((flag) => /missing_non_us|single_source|monoculture|missing_trade|missing_official/i.test(flag)) || (lowRegion && lowType);
}

function bucketRows(rows = [], predicate) {
  return asArray(rows).filter((row) => {
    try {
      return predicate(row);
    } catch {
      return false;
    }
  });
}

function buildProposal(kind = '', rows = [], extra = {}, options = {}) {
  const seedIds = uniqueStrings(rows.map(seedIdForRow), 200);
  const themes = uniqueStrings(rows.map(themeForRow), 50);
  const sampleSeeds = rows.slice(0, Number(options.sampleLimit || 5)).map((row) => ({
    seedId: seedIdForRow(row),
    title: titleForRow(row),
    status: row.status || seedFromRow(row).status || '',
    theme: themeForRow(row),
  }));
  const severity = extra.severity || (seedIds.length >= Number(options.highSeverityCount || 5) ? 'high' : 'medium');
  const identity = compact(extra.identity || extra.metrics?.providerGap || extra.metrics?.evidenceClass || extra.reason || '');
  return {
    proposalId: `oseed-fix-${stableId([kind, identity, seedIds.join(','), themes.join(',')])}`,
    type: 'operator-seed-self-improvement',
    version: OPERATOR_SEED_SELF_IMPROVEMENT_VERSION,
    kind,
    severity,
    reason: extra.reason || `${kind} detected across ${seedIds.length} seed(s).`,
    seedIds,
    themes,
    sampleSeeds,
    metrics: extra.metrics || {},
    nextAction: extra.nextAction || 'review generator/scoring/provider coverage policy; proposal only, no automatic code mutation',
    proposedMutation: 'proposal_only',
    codeMutationAllowed: false,
    approvalQueueWritesAllowed: false,
    providerActivationAllowed: false,
    canonicalMutationAllowed: false,
  };
}

export function summarizeOperatorSeedSelfImprovement(rows = [], options = {}) {
  const generatedAt = options.generatedAt || new Date().toISOString();
  const minCount = Math.max(1, Number(options.minCount || 1));
  const proposals = [];

  const genericRows = bucketRows(rows, (row) => row.status === 'rejected' && /generic|missing physical process|missing required input|missing counter/i.test(reviewText(row)));
  if (genericRows.length >= minCount) {
    proposals.push(buildProposal('repeated_generic_narrative_rejection', genericRows, {
      reason: 'Rejected seeds repeatedly look generic or miss the activity/process/input chain.',
      nextAction: 'tighten operator-seed-prior penalties and mechanism templates before accepting more seeds from these themes',
      metrics: { rejectedCount: genericRows.length },
    }, options));
  }

  const monocultureRows = bucketRows(rows, sourceCoverageMonoculture);
  if (monocultureRows.length >= minCount) {
    proposals.push(buildProposal('source_coverage_monoculture', monocultureRows, {
      reason: 'Seed audit shows narrow region/source-type coverage, which can bias seed generation.',
      nextAction: 'add source-gap labels and prioritize non-US, official, trade, or technical source discovery before evidence enqueue',
      metrics: { affectedSeedCount: monocultureRows.length },
    }, options));
  }

  const providerGapCounts = {};
  const providerGapRows = {};
  for (const row of asArray(rows)) {
    for (const gap of providerGapsForRow(row)) {
      providerGapCounts[gap] = (providerGapCounts[gap] || 0) + 1;
      providerGapRows[gap] = [...(providerGapRows[gap] || []), row];
    }
  }
  for (const [gap, count] of Object.entries(providerGapCounts)) {
    if (count < minCount) continue;
    proposals.push(buildProposal('repeated_provider_gap', providerGapRows[gap], {
      reason: `${gap} repeatedly blocks direct evidence collection.`,
      nextAction: 'review provider adapter proposal or keep the gap as source-query-only until fixtures and health checks exist',
      metrics: { providerGap: gap, count },
      identity: gap,
      severity: count >= 3 ? 'high' : 'medium',
    }, options));
  }

  const classRows = {};
  for (const row of asArray(rows)) {
    for (const evidenceClass of evidenceClassesMissingForRow(row)) {
      classRows[evidenceClass] = [...(classRows[evidenceClass] || []), row];
    }
  }
  for (const [evidenceClass, matched] of Object.entries(classRows)) {
    if (matched.length < minCount) continue;
    proposals.push(buildProposal('evidence_class_repeatedly_missing', matched, {
      reason: `${evidenceClass} remains missing or weak across repeated operator seeds.`,
      nextAction: 'adjust expected evidence class routing, query templates, or provider coverage before report promotion',
      metrics: { evidenceClass, count: matched.length },
      identity: evidenceClass,
    }, options));
  }

  const issuerRows = bucketRows(rows, (row) => issuerUniverseEmptyClasses(row).length > 0);
  if (issuerRows.length >= minCount) {
    proposals.push(buildProposal('issuer_universe_repeatedly_empty', issuerRows, {
      reason: 'Issuer-specific evidence routes repeatedly lack issuer or candidate universe resolution.',
      nextAction: 'improve issuer resolver inputs from ontology supplier symbols, filings, transcripts, and seed evidence metadata',
      metrics: { affectedSeedCount: issuerRows.length },
    }, options));
  }

  const marketRows = bucketRows(rows, (row) => Boolean(marketValidationProblem(row)));
  if (marketRows.length >= minCount) {
    proposals.push(buildProposal('market_validation_repeatedly_no_rows', marketRows, {
      reason: 'Market validation plans repeatedly end without controlled event-uplift rows or adequate controls.',
      nextAction: 'repair event candidate generation and recent event_uplift/matched_controls coverage before treating seed readiness as decision-grade',
      metrics: {
        reasons: uniqueStrings(marketRows.map(marketValidationProblem), 20),
        affectedSeedCount: marketRows.length,
      },
    }, options));
  }

  const negativeRows = bucketRows(rows, negativeControlUnchecked);
  if (negativeRows.length >= minCount) {
    proposals.push(buildProposal('negative_control_repeatedly_unchecked', negativeRows, {
      reason: 'Negative-control lane remains unchecked, so promotion evidence is not sufficiently challenged.',
      nextAction: 'run or refine substitute/redundancy/no-capacity-pressure counter-evidence drafts before report candidate promotion',
      metrics: { affectedSeedCount: negativeRows.length },
    }, options));
  }

  const kindCounts = {};
  const severityCounts = {};
  for (const proposal of proposals) {
    kindCounts[proposal.kind] = (kindCounts[proposal.kind] || 0) + 1;
    severityCounts[proposal.severity] = (severityCounts[proposal.severity] || 0) + 1;
  }

  return {
    ok: true,
    source: 'operator-seed-self-improvement',
    version: OPERATOR_SEED_SELF_IMPROVEMENT_VERSION,
    generatedAt,
    seedCount: asArray(rows).length,
    proposalCount: proposals.length,
    kindCounts,
    severityCounts,
    proposals,
    boundaries: {
      dbWrites: 0,
      approvalQueueWrites: 0,
      sourceQueryApprovalWrites: 0,
      reportBackfillWrites: 0,
      researchEvidenceBundleWrites: 0,
      canonicalWrites: 0,
      sourceRegistryWrites: 0,
      providerActivationWrites: 0,
      codeMutationWrites: 0,
    },
    nextAction: proposals.length
      ? 'review self-improvement proposals; they are advisory only and do not mutate code, providers, queues, or canonical state'
      : 'no repeated mechanism seed failure pattern detected for loaded rows',
  };
}

export const __test = {
  evidenceClassesMissingForRow,
  issuerUniverseEmptyClasses,
  marketValidationProblem,
  sourceCoverageMonoculture,
  negativeControlUnchecked,
};
