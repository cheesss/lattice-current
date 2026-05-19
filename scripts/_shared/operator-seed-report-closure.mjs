import path from 'node:path';

import { buildBundleFromPayload } from '../build-report-bundle.mjs';
import { generateReportAnalystDraft } from './report-llm-analyst.mjs';
import {
  writeReportArtifactsToStore,
  writeReportIndex,
} from './report-local-store.mjs';
import { REPORT_TYPES } from './report-evidence-bundle.mjs';
import {
  ensureUniversalResearchSchema,
  upsertUniversalResearchSubjects,
} from './universal-research-orchestrator.mjs';
import {
  ensureOperatorResearchSeedSchema,
  loadOperatorResearchSeeds,
} from './operator-research-seeds.mjs';
import {
  buildRouteAwareSeedEvidencePlan,
} from './seed-evidence-plan.mjs';
import {
  summarizeOperatorSeedClosure,
} from './operator-seed-closure.mjs';
import {
  filterIssuerSymbols,
} from './theme-ontology.mjs';

export const OPERATOR_SEED_REPORT_CLOSURE_VERSION = 'operator-seed-report-closure-v1';

const DEFAULT_REPORT_ROOT = path.join(process.cwd(), 'data', 'reports');

const REPORT_READY_STATUSES = new Set([
  'report_candidate',
  'promoted',
  'report_generated',
]);

const REVIEW_READY_STATUSES = new Set([
  'review_ready',
]);

const FATAL_BIAS_FLAGS = new Set([
  'fatal_bias',
  'no_evidence_path',
  'generic_theme_narrative',
  'uninvestable_private_only_chain',
]);

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

function num(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function seedFromRow(row = {}) {
  return row.seed_json || row.seedJson || row.seed || row;
}

function seedIdForRow(row = {}) {
  const seed = seedFromRow(row);
  return compact(row.seed_id || row.seedId || seed.seedId);
}

function seedTitleForRow(row = {}) {
  const seed = seedFromRow(row);
  const raw = compact(row.seed_title || row.seedTitle || seed.seedTitle || seed.bottleneck?.label || seedIdForRow(row));
  const bottleneck = compact(seed.bottleneck?.label);
  if (bottleneck && /->/.test(raw)) return conciseBottleneckLabel(bottleneck);
  return raw;
}

function conciseBottleneckLabel(value = '') {
  const normalized = compact(value)
    .replace(/\bsolid rocket motors?\b/ig, 'SRM')
    .replace(/\benergetic-material\b/ig, 'energetics')
    .replace(/\bqualified supplier capacity\b/ig, 'supplier capacity')
    .replace(/\bpower-equipment\b/ig, 'power equipment')
    .replace(/\bground-support\b/ig, 'ground support');
  const words = normalized.split(/\s+/).filter(Boolean);
  if (words.length <= 6) return normalized;
  return words.slice(0, 6).join(' ');
}

function evidencePlanForRow(row = {}, options = {}) {
  const existing = row.evidence_plan || row.evidencePlan;
  if (existing?.routeAware) return existing;
  return buildRouteAwareSeedEvidencePlan(seedFromRow(row), options);
}

function outcomeLedger(plan = {}) {
  return asArray(plan.outcomeLedger);
}

function outcomeCounts(plan = {}) {
  return plan.outcomeCounts || {};
}

function promotionOutcomeCount(plan = {}) {
  return Number(outcomeCounts(plan).promotion_candidate || 0)
    + outcomeLedger(plan).filter((outcome) => (
      outcome?.outcomeTier === 'promotion_candidate'
      && outcome?.evidenceClass !== 'negative_control'
    )).length;
}

function contextOutcomeCount(plan = {}) {
  return Number(outcomeCounts(plan).supporting_context || 0)
    + outcomeLedger(plan).filter((outcome) => outcome?.outcomeTier === 'supporting_context').length;
}

function candidateIssuerUniverse(seed = {}, plan = {}, options = {}) {
  return filterIssuerSymbols(uniqueStrings([
    options.issuerUniverse,
    options.candidateIssuerUniverse,
    seed.issuerUniverse,
    seed.candidateIssuerUniverse,
    seed.metadata?.issuerUniverse,
    seed.metadata?.candidateIssuerUniverse,
    seed.supplierCategory?.publicIssuerCandidates,
    asArray(plan.providerRoutePlans).flatMap((route) => [
      route.issuerUniverse,
      route.promotionUniverse,
      route.collectionUniverse,
      route.candidateIssuerUniverse,
    ]),
  ], 60));
}

function biasAuditForRow(row = {}, seed = {}) {
  return row.bias_audit || row.biasAudit || seed.biasAudit || {};
}

function providerGapsForRow(row = {}, seed = {}) {
  const audit = biasAuditForRow(row, seed);
  return uniqueStrings([
    row.provider_gaps,
    row.providerGaps,
    seed.providerGaps,
    audit.provider_gap_labels,
  ], 80);
}

function biasFlagsForRow(row = {}, seed = {}) {
  return uniqueStrings(biasAuditForRow(row, seed).bias_flags || [], 40);
}

function missingSourcesForRow(row = {}, seed = {}) {
  return uniqueStrings(biasAuditForRow(row, seed).missing_sources || [], 40);
}

function hasCompleteSeedStructure(seed = {}) {
  const missing = [];
  if (!compact(seed.theme?.key || seed.theme?.label)) missing.push('theme');
  if (!compact(seed.growthDriver)) missing.push('growthDriver');
  if (!compact(seed.realActivity)) missing.push('realActivity');
  if (!compact(seed.physicalProcess)) missing.push('physicalProcess');
  if (!asArray(seed.requiredInputs).length) missing.push('requiredInputs');
  if (!compact(seed.bottleneck?.label)) missing.push('bottleneck.label');
  if (!compact(seed.bottleneck?.class)) missing.push('bottleneck.class');
  if (!compact(seed.supplierCategory?.label)) missing.push('supplierCategory.label');
  return { ok: missing.length === 0, missing };
}

function hasExplicitEvidencePlan(plan = {}) {
  return Boolean(
    plan.routeAware
    && asArray(plan.evidenceClasses).length
    && asArray(plan.providerRoutePlans).length
    && (
      asArray(plan.sourceQueryDrafts).length
      || asArray(plan.providerRoutePlans).some((route) => asArray(route.executableCollectors).length)
    ),
  );
}

function hasCounterEvidence(seed = {}, plan = {}) {
  const negativeRoutes = asArray(plan.providerRoutePlans).filter((route) => route.evidenceClass === 'negative_control');
  return asArray(seed.counterEvidenceQueries).length > 0
    && negativeRoutes.length > 0
    && negativeRoutes.every((route) => route.promotionEligible !== true);
}

function reportAllowedStatus(status = '', options = {}) {
  const normalized = compact(status);
  if (REPORT_READY_STATUSES.has(normalized)) return true;
  return Boolean(options.includeReviewReady) && REVIEW_READY_STATUSES.has(normalized);
}

function fatalBiasFlags(row = {}, seed = {}) {
  return biasFlagsForRow(row, seed).filter((flag) => FATAL_BIAS_FLAGS.has(flag));
}

export function buildOperatorSeedReportClosurePlan(row = {}, options = {}) {
  const seed = seedFromRow(row);
  const seedId = seedIdForRow(row);
  const seedTitle = seedTitleForRow(row);
  const plan = evidencePlanForRow(row, options);
  const closure = summarizeOperatorSeedClosure({ ...row, seed_json: seed, evidence_plan: plan }, options);
  const negativeClosure = closure.negativeControl?.closure || closure.negativeControl?.status || 'unchecked';
  const blockers = [];
  const warnings = [];
  const structure = hasCompleteSeedStructure(seed);
  const issuers = candidateIssuerUniverse(seed, plan, options);
  const directEvidenceCount = promotionOutcomeCount(plan);
  const supportingEvidenceCount = contextOutcomeCount(plan);
  const explicitPlan = hasExplicitEvidencePlan(plan);
  const counterEvidenceReady = hasCounterEvidence(seed, plan);
  const biasFlags = biasFlagsForRow(row, seed);
  const fatalFlags = fatalBiasFlags(row, seed);
  const providerGaps = providerGapsForRow(row, seed);
  const missingSources = missingSourcesForRow(row, seed);

  if (!seedId) blockers.push('missing_seed_id');
  if (!reportAllowedStatus(row.status || seed.status, options)) {
    blockers.push('seed_not_marked_report_candidate');
  }
  if (!structure.ok) blockers.push(...structure.missing.map((field) => `missing_${field}`));
  if (!explicitPlan && directEvidenceCount <= 0 && supportingEvidenceCount <= 0) blockers.push('missing_explicit_evidence_plan');
  if (!counterEvidenceReady) blockers.push('missing_counter_evidence_query');
  if (negativeClosure === 'invalidator') blockers.push('negative_control_invalidator');
  if (fatalFlags.length) blockers.push(...fatalFlags.map((flag) => `fatal_bias_${flag}`));
  if (seed.supplierCategory?.privateOnly && !issuers.length) warnings.push('private_only_monitor_only');
  if (!issuers.length) warnings.push('no_issuer_universe_monitor_only');
  if (directEvidenceCount <= 0) warnings.push('no_direct_promotion_evidence_yet');
  if (negativeClosure === 'unchecked') warnings.push('negative_control_unchecked');
  if (providerGaps.length) warnings.push('provider_gap_review_required');
  if (missingSources.length) warnings.push('source_coverage_gap_review_required');
  if (closure.providerBackfillPlan?.status === 'provider_backfill_exhausted') warnings.push('provider_backfill_exhausted');

  const reportMode = issuers.length ? 'issuer_research' : 'monitor_only';
  const ready = blockers.length === 0;
  return {
    ok: true,
    version: OPERATOR_SEED_REPORT_CLOSURE_VERSION,
    seedId,
    title: seedTitle,
    status: row.status || seed.status || '',
    ready,
    readinessState: ready
      ? (reportMode === 'monitor_only' ? 'monitor_only_report_candidate' : 'report_candidate_ready')
      : 'blocked',
    reportMode,
    reportType: options.reportType || REPORT_TYPES.CROSS_THEME,
    blockers,
    warnings: uniqueStrings(warnings, 40),
    structure,
    issuerUniverse: issuers,
    directEvidenceCount,
    supportingEvidenceCount,
    explicitEvidencePlan: explicitPlan,
    counterEvidenceReady,
    negativeControl: closure.negativeControl,
    providerBackfill: {
      status: closure.providerBackfillPlan?.status || 'unknown',
      routeCount: closure.providerBackfillPlan?.routeCount || 0,
      exhaustedCount: closure.providerBackfillPlan?.exhaustedCount || 0,
      nextAction: closure.providerBackfillPlan?.nextAction || '',
    },
    providerGaps,
    missingSources,
    biasFlags,
    nextAction: ready
      ? 'create universal research subject and generate operator-seed report artifact; then run evidence contract backfill cycle'
      : `fix Phase E blockers: ${blockers.join(', ')}`,
    mutationPolicy: {
      dryRunDefault: true,
      approvalQueueWrites: 0,
      reportBackfillWrites: 0,
      researchEvidenceBundleWrites: 0,
      canonicalWrites: 0,
      sourceRegistryWrites: 0,
      providerActivationWrites: 0,
    },
  };
}

export function buildOperatorSeedUniversalSubject(row = {}, options = {}) {
  const seed = seedFromRow(row);
  const plan = evidencePlanForRow(row, options);
  const closurePlan = buildOperatorSeedReportClosurePlan(row, options);
  const score = num(row.scores?.composite_seed_score ?? seed.scores?.composite_seed_score, 0);
  const subjectLabel = seedTitleForRow(row);
  return {
    subjectKey: seed.seedId || seedIdForRow(row),
    subjectLabel,
    subjectType: 'material_or_bottleneck',
    aliases: uniqueStrings([
      seed.bottleneck?.label,
      seed.requiredInputs,
      seed.supplierCategory?.label,
      seed.theme?.label,
    ], 30),
    symbols: closurePlan.issuerUniverse,
    sourceTypes: ['operator_mechanism_seed', 'operator_seed_report_candidate'],
    sourceRefs: [{
      sourceType: 'operator_research_seeds',
      sourceId: seed.seedId || seedIdForRow(row),
      status: row.status || seed.status || null,
    }],
    dataPacks: ['operator_seed_evidence_plan'],
    priorityScore: Math.round(score * 100),
    status: 'active',
    metadata: {
      operatorSeedId: seed.seedId || seedIdForRow(row),
      mechanismSeed: seed,
      seedScores: row.scores || seed.scores || {},
      biasAudit: biasAuditForRow(row, seed),
      providerGaps: providerGapsForRow(row, seed),
      seedEvidencePlan: plan,
      seedReportClosure: closurePlan,
      reportType: closurePlan.reportType,
      reportMode: closurePlan.reportMode,
      discovery: {
        operatorSeed: true,
        generatedLane: true,
        theme: seed.theme?.key || row.theme_key || null,
        mechanism: seed.bottleneck?.mechanism || seed.physicalProcess || null,
        connector: seed.bottleneck?.label || null,
        supplier: seed.supplierCategory?.label || null,
        triggerTerms: uniqueStrings([seed.requiredInputs, seed.evidenceQueries], 30),
      },
    },
  };
}

function seedEvidenceScore(plan = {}) {
  const promotions = promotionOutcomeCount(plan);
  const contexts = contextOutcomeCount(plan);
  if (promotions > 0) return Math.min(1, 0.55 + promotions * 0.1);
  if (contexts > 0) return Math.min(0.55, 0.25 + contexts * 0.06);
  return hasExplicitEvidencePlan(plan) ? 0.12 : 0;
}

export function buildOperatorSeedReportPayload(row = {}, options = {}) {
  const seed = seedFromRow(row);
  const plan = evidencePlanForRow(row, options);
  const closurePlan = buildOperatorSeedReportClosurePlan(row, options);
  const seedId = seed.seedId || seedIdForRow(row);
  const title = seedTitleForRow(row);
  const score = num(row.scores?.composite_seed_score ?? seed.scores?.composite_seed_score, 0);
  const evidenceScore = seedEvidenceScore(plan);
  const themes = uniqueStrings([seed.theme?.key, seed.theme?.label], 8);
  const metadata = {
    operatorSeedId: seedId,
    mechanismSeed: seed,
    seedScores: row.scores || seed.scores || {},
    biasAudit: biasAuditForRow(row, seed),
    providerGaps: providerGapsForRow(row, seed),
    seedEvidencePlan: plan,
    seedReportClosure: closurePlan,
    seedQualityIsNotInvestmentReadiness: true,
    phase: 'E',
  };
  const caveats = [
    {
      caveatId: 'CAV-OPERATOR-SEED-NOT-INVESTMENT-READINESS',
      severity: 'high',
      type: 'seed_quality_boundary',
      text: 'This operator seed is a research-subject promotion, not an investment-readiness promotion. Evidence Contract Closure must still validate issuer exposure, market validation, and negative controls.',
      appliesToClaimIds: ['CLM-001'],
    },
    ...(closurePlan.reportMode === 'monitor_only' ? [{
      caveatId: 'CAV-OPERATOR-SEED-MONITOR-ONLY',
      severity: 'high',
      type: 'missing_issuer_universe',
      text: 'The seed has no resolved issuer universe, so the report is monitor-only until issuer exposure is attached.',
      appliesToClaimIds: ['CLM-001'],
    }] : []),
    ...(closurePlan.negativeControl?.closure === 'unchecked' ? [{
      caveatId: 'CAV-OPERATOR-SEED-NEGATIVE-CONTROL-PENDING',
      severity: 'medium',
      type: 'negative_control_pending',
      text: 'Negative-control searches are not closed; substitutes, redundancy, or no-capacity-pressure invalidators must remain separate from promotion evidence.',
      appliesToClaimIds: ['CLM-001'],
    }] : []),
    ...(closurePlan.providerGaps.length ? [{
      caveatId: 'CAV-OPERATOR-SEED-PROVIDER-GAPS',
      severity: 'medium',
      type: 'provider_gap_review',
      text: 'Provider/source coverage gaps remain review-gated and must not be interpreted as direct evidence.',
      appliesToClaimIds: ['CLM-001'],
    }] : []),
  ];
  return {
    reportType: options.reportType || REPORT_TYPES.CROSS_THEME,
    subject: {
      subjectType: 'operator_mechanism_seed',
      subjectId: seedId,
      displayName: title,
      metadata,
    },
    candidate: {
      id: seedId,
      name: title,
      themes,
      connector: seed.bottleneck?.label || title,
      supplier: seed.supplierCategory?.label || '',
      score,
      evidenceScore,
      seedSimilarity: 0,
      discoveryFit: num(seed.scores?.physical_linkage ?? row.scores?.physical_linkage, score),
      constraintCriticality: num(seed.scores?.bottleneck_specificity ?? row.scores?.bottleneck_specificity, score),
      geopoliticalRelevance: /defen[cs]e|space/i.test(themes.join(' ')) ? 0.65 : 0.35,
      lane: closurePlan.reportMode === 'monitor_only' ? 'needs_evidence' : 'operator_seed_report_candidate',
      discovery: {
        operatorSeed: true,
        operatorSeedId: seedId,
        mechanismSeed: seed,
        seedScores: row.scores || seed.scores || {},
        biasAudit: biasAuditForRow(row, seed),
        providerGaps: providerGapsForRow(row, seed),
        seedEvidencePlan: plan,
        seedReportClosure: closurePlan,
        physicalProcess: seed.physicalProcess || '',
        requiredInputs: uniqueStrings(seed.requiredInputs || [], 30),
        bottleneckClass: seed.bottleneck?.class || '',
        mechanism: seed.bottleneck?.mechanism || '',
      },
    },
    metrics: [
      { metricId: 'MET-SEED-COMPOSITE', kind: 'operator_seed_score', name: 'composite_seed_score', value: score, unit: 'score' },
      { metricId: 'MET-SEED-EVIDENCE-CLASSES', kind: 'operator_seed_evidence_plan', name: 'evidence_class_count', value: asArray(plan.evidenceClasses).length, unit: 'classes' },
      { metricId: 'MET-SEED-SOURCE-QUERIES', kind: 'operator_seed_evidence_plan', name: 'source_query_drafts', value: asArray(plan.sourceQueryDrafts).length, unit: 'drafts' },
    ],
    caveats,
    claims: [{
      claimId: 'CLM-001',
      claimType: 'operator_seed_report_candidate',
      canonicalText: `${title} is an operator mechanism seed promoted into report closure. It should be treated as a research subject until direct issuer exposure, market validation, and negative-control lanes close under the Evidence Contract.`,
      supportingMetricIds: ['MET-SEED-COMPOSITE', 'MET-SEED-EVIDENCE-CLASSES', 'MET-SEED-SOURCE-QUERIES'],
      caveatIds: caveats.map((item) => item.caveatId),
      confidenceLevel: evidenceScore >= 0.55 ? 'medium' : 'low',
      validationStatus: 'candidate',
    }],
    watchIndicators: [{
      watchId: 'WATCH-SEED-BACKFILL-CLOSURE',
      label: 'Run evidence contract backfill cycle for issuer exposure, market validation, and negative controls.',
      threshold: 'closure_ready',
      direction: 'equals',
      source: 'run-evidence-contract-backfill-cycle',
      horizon: 'next cycle',
      claimIds: ['CLM-001'],
    }],
    queryManifest: {
      operatorSeedId: seedId,
      seedEvidencePlanVersion: plan.version || null,
      evidenceClasses: asArray(plan.evidenceClasses),
      sourceQueryDraftCount: asArray(plan.sourceQueryDrafts).length,
      negativeControlDraftCount: asArray(plan.negativeControlDrafts).length,
      providerGapLabels: closurePlan.providerGaps,
    },
    metadata,
  };
}

export async function generateOperatorSeedReportArtifact(row = {}, options = {}) {
  const payload = buildOperatorSeedReportPayload(row, options);
  const bundle = buildBundleFromPayload(payload, {
    type: payload.reportType,
    subject: payload.subject.displayName,
  });
  const analysis = await generateReportAnalystDraft(bundle, { provider: options.provider || 'deterministic' });
  const written = await writeReportArtifactsToStore({
    bundle,
    analysis,
    reportRoot: options.reportRoot || DEFAULT_REPORT_ROOT,
    outDir: options.outDir || null,
  });
  const index = await writeReportIndex(options.reportRoot || DEFAULT_REPORT_ROOT);
  return {
    ok: written.validation?.status !== 'blocked',
    reportId: written.bundle.reportId,
    reportDir: path.resolve(written.reportDir),
    htmlPath: path.resolve(written.reportDir, 'report.html'),
    validation: written.validation,
    manifest: written.manifest,
    sourceQueryDraftCount: written.sourceQueryDrafts?.length || 0,
    queuedSourceQueryCount: written.queuedSourceQueries?.length || 0,
    indexPath: path.resolve(index.indexPath),
  };
}

export async function recordOperatorSeedReportClosure(client, {
  seedId,
  reportId = null,
  reportPath = null,
  universalSubjectKey = null,
  closurePlan = {},
  reviewer = 'operator-seed-report-closure',
  reason = 'operator seed report closure',
} = {}) {
  const event = {
    status: reportId ? 'report_generated' : 'report_subject_promoted',
    reason,
    reviewer,
    reviewedAt: new Date().toISOString(),
    metadata: {
      source: 'operator-seed-report-closure',
      phase: 'E',
      reportId,
      reportPath,
      universalSubjectKey,
      closurePlan,
      canonicalWrites: 0,
      sourceRegistryWrites: 0,
      providerActivationWrites: 0,
    },
  };
  const result = await client.query(`
    UPDATE operator_research_seeds
       SET latest_report_id = COALESCE($2, latest_report_id),
           status = CASE WHEN $4::boolean THEN 'report_generated' ELSE status END,
           review_state = COALESCE(review_state, '{}'::jsonb)
             || jsonb_build_object(
               'latestReportClosure',
               $3::jsonb,
               'reportClosureHistory',
               COALESCE(review_state->'reportClosureHistory', '[]'::jsonb) || jsonb_build_array($3::jsonb)
             ),
           updated_at = NOW()
     WHERE seed_id = $1
     RETURNING seed_id, status, latest_report_id, review_state, updated_at
  `, [
    String(seedId || ''),
    reportId || null,
    JSON.stringify(event),
    Boolean(reportId),
  ]);
  return result.rows?.[0] || null;
}

export async function promoteOperatorSeedReportCandidates(client, options = {}) {
  const apply = Boolean(options.apply);
  const generateReport = Boolean(options.generateReport);
  const statuses = uniqueStrings([
    options.statuses,
    options.status,
    options.includeReviewReady ? ['report_candidate', 'review_ready'] : [],
  ], 20);
  const effectiveStatuses = statuses.length ? statuses : ['report_candidate'];
  if (apply && !client) throw new Error('client is required for apply mode');
  if (generateReport && !apply) throw new Error('--generate-report requires apply mode');
  if (client && options.ensureSeedSchema !== false) await ensureOperatorResearchSeedSchema(client);
  const rows = asArray(options.rows).length
    ? asArray(options.rows)
    : await loadOperatorResearchSeeds(client, {
      seedId: options.seedId,
      seedIds: options.seedIds,
      statuses: effectiveStatuses,
      limit: options.limit || 25,
    });
  const items = [];
  const mutationPolicy = {
    operatorSeedWrites: 0,
    universalResearchSubjectWrites: 0,
    reportArtifactWrites: 0,
    localSourceQueueWrites: 0,
    approvalQueueWrites: 0,
    reportBackfillWrites: 0,
    researchEvidenceBundleWrites: 0,
    canonicalWrites: 0,
    sourceRegistryWrites: 0,
    providerActivationWrites: 0,
  };

  if (apply && options.ensureUniversalSchema !== false) {
    await ensureUniversalResearchSchema(client);
  }

  for (const row of rows) {
    const closurePlan = buildOperatorSeedReportClosurePlan(row, {
      ...options,
      includeReviewReady: options.includeReviewReady || effectiveStatuses.includes('review_ready'),
    });
    const item = {
      seedId: closurePlan.seedId,
      title: closurePlan.title,
      ready: closurePlan.ready,
      readinessState: closurePlan.readinessState,
      reportMode: closurePlan.reportMode,
      reportType: closurePlan.reportType,
      blockers: closurePlan.blockers,
      warnings: closurePlan.warnings,
      nextAction: closurePlan.nextAction,
      universalSubject: null,
      report: null,
    };
    if (!closurePlan.ready) {
      items.push(item);
      continue;
    }
    const universalSubject = buildOperatorSeedUniversalSubject(row, options);
    item.universalSubject = {
      subjectKey: universalSubject.subjectKey,
      subjectLabel: universalSubject.subjectLabel,
      subjectType: universalSubject.subjectType,
      symbols: universalSubject.symbols,
      sourceTypes: universalSubject.sourceTypes,
      priorityScore: universalSubject.priorityScore,
      metadataKeys: Object.keys(universalSubject.metadata || {}),
    };
    let report = null;
    if (apply) {
      if (options.writeUniversalSubject) {
        await options.writeUniversalSubject(universalSubject, row, closurePlan);
      } else {
        await upsertUniversalResearchSubjects(client, [universalSubject]);
      }
      mutationPolicy.universalResearchSubjectWrites += 1;
      if (generateReport) {
        report = options.generateReportArtifact
          ? await options.generateReportArtifact(row, options)
          : await generateOperatorSeedReportArtifact(row, options);
        item.report = report;
        mutationPolicy.reportArtifactWrites += 1;
        mutationPolicy.localSourceQueueWrites += Number(report?.queuedSourceQueryCount || 0);
      }
      const recorded = await recordOperatorSeedReportClosure(client, {
        seedId: closurePlan.seedId,
        reportId: report?.reportId || null,
        reportPath: report?.htmlPath || null,
        universalSubjectKey: universalSubject.subjectKey,
        closurePlan,
        reviewer: options.reviewer || 'operator-seed-report-closure',
        reason: options.reason || (report ? 'generated operator seed report artifact' : 'promoted operator seed to universal research subject'),
      });
      mutationPolicy.operatorSeedWrites += recorded ? 1 : 0;
      item.recorded = recorded
        ? {
          seedId: recorded.seed_id,
          status: recorded.status,
          latestReportId: recorded.latest_report_id || null,
        }
        : null;
    }
    items.push(item);
  }
  const readyCount = items.filter((item) => item.ready).length;
  return {
    ok: items.every((item) => item.ready),
    source: 'operator-seed-report-closure',
    version: OPERATOR_SEED_REPORT_CLOSURE_VERSION,
    mode: apply ? 'apply' : 'dry-run',
    generatedAt: new Date().toISOString(),
    total: items.length,
    readyCount,
    blockedCount: items.length - readyCount,
    reportGeneratedCount: items.filter((item) => item.report?.reportId).length,
    items,
    mutationPolicy,
    boundaries: {
      ...mutationPolicy,
      dbWrites: mutationPolicy.operatorSeedWrites + mutationPolicy.universalResearchSubjectWrites,
    },
    nextAction: readyCount
      ? 'run evidence contract backfill cycle against generated report artifacts or promoted universal subjects'
      : 'resolve Phase E blockers before report closure',
  };
}
