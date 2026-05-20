import assert from 'node:assert/strict';
import test from 'node:test';

import { normalizeMechanismSeed } from '../scripts/_shared/mechanism-seed-generator.mjs';
import { buildRouteAwareSeedEvidencePlan } from '../scripts/_shared/seed-evidence-plan.mjs';
import {
  buildOperatorSeedReportClosurePlan,
  buildOperatorSeedReportPayload,
  buildOperatorSeedUniversalSubject,
  promoteOperatorSeedReportCandidates,
} from '../scripts/_shared/operator-seed-report-closure.mjs';

const generatedAt = '2026-05-19T00:00:00.000Z';

function seedFromPrompt(prompt, overrides = {}) {
  return normalizeMechanismSeed({
    source: 'direct',
    themeKey: overrides.themeKey || 'defense-industrial',
    themeLabel: overrides.themeLabel || 'Defense Industrial',
    prompt,
    seedTerms: overrides.seedTerms || ['solid rocket motor capacity'],
    issuerCandidates: overrides.issuerCandidates || ['LHX', 'NOC'],
    sourceRefs: overrides.sourceRefs || [
      { sourceType: 'official_company', region: 'US' },
      { sourceType: 'trade_press', region: 'US' },
    ],
  }, { generatedAt });
}

function rowForSeed(seed, overrides = {}) {
  const evidencePlan = buildRouteAwareSeedEvidencePlan(seed, { queryLimitPerClass: 1 });
  return {
    seed_id: seed.seedId,
    seed_key: seed.seedId,
    seed_title: seed.seedTitle,
    status: 'report_candidate',
    theme_key: seed.theme.key,
    theme_label: seed.theme.label,
    seed_json: seed,
    scores: seed.scores,
    bias_audit: seed.biasAudit,
    provider_gaps: seed.providerGaps,
    evidence_plan: evidencePlan,
    review_state: {},
    ...overrides,
  };
}

test('Phase E closure treats review-ready seeds as preview-only unless explicitly included', () => {
  const seed = seedFromPrompt('Defense missile replenishment requires solid rocket motor production capacity, energetic binders, qualified suppliers, and test range throughput.');
  const row = rowForSeed(seed, { status: 'review_ready' });

  const blocked = buildOperatorSeedReportClosurePlan(row);
  assert.equal(blocked.ready, false);
  assert.equal(blocked.blockers.includes('seed_not_marked_report_candidate'), true);

  const preview = buildOperatorSeedReportClosurePlan(row, { includeReviewReady: true });
  assert.equal(preview.ready, true);
  assert.equal(preview.readinessState, 'report_candidate_ready');
});

test('Phase E closure blocks negative-control invalidators before report promotion', () => {
  const seed = seedFromPrompt('Defense missile replenishment requires solid rocket motor production capacity, energetic binders, qualified suppliers, and test range throughput.');
  const row = rowForSeed(seed, {
    evidence_plan: {
      ...buildRouteAwareSeedEvidencePlan(seed, { queryLimitPerClass: 1 }),
      outcomeLedger: [{
        evidenceClass: 'negative_control',
        outcomeTier: 'negative_control_candidate',
        negativeControlClosure: 'invalidator',
      }],
    },
  });

  const plan = buildOperatorSeedReportClosurePlan(row);
  assert.equal(plan.ready, false);
  assert.equal(plan.blockers.includes('negative_control_invalidator'), true);
});

test('Phase E universal subject preserves seed evidence plan and readiness boundaries', () => {
  const seed = seedFromPrompt('AI data center rack density raises power demand and transformer lead-time constraints.', {
    themeKey: 'cloud-infrastructure',
    themeLabel: 'Data Center Infrastructure',
    seedTerms: ['data center power constraint'],
    issuerCandidates: ['ETN', 'VRT'],
  });
  const row = rowForSeed(seed);
  const subject = buildOperatorSeedUniversalSubject(row);

  assert.equal(subject.subjectKey, seed.seedId);
  assert.equal(subject.sourceTypes.includes('operator_seed_report_candidate'), true);
  assert.equal(subject.metadata.operatorSeedId, seed.seedId);
  assert.equal(subject.metadata.seedEvidencePlan.routeAware, true);
  assert.equal(subject.metadata.seedReportClosure.ready, true);
  assert.equal(subject.metadata.seedReportClosure.reportType, 'cross_theme_bottleneck_report');
  assert.equal(subject.metadata.seedReportClosure.mutationPolicy.canonicalWrites, 0);
});

test('Phase E report payload carries operator seed metadata without raising readiness gates', () => {
  const seed = seedFromPrompt('Space launch cadence is increasing. Find LOX, liquid hydrogen, helium, cryogenic fuel farm, and propellant loading bottlenecks.', {
    themeKey: 'space',
    themeLabel: 'Space',
    seedTerms: ['space launch cryogenic infrastructure'],
    issuerCandidates: [],
  });
  const row = rowForSeed(seed);
  const payload = buildOperatorSeedReportPayload(row);

  assert.equal(payload.reportType, 'cross_theme_bottleneck_report');
  assert.equal(payload.metadata.operatorSeedId, seed.seedId);
  assert.equal(payload.metadata.seedQualityIsNotInvestmentReadiness, true);
  assert.equal(payload.metadata.seedEvidencePlan.routeAware, true);
  assert.equal(payload.subject.metadata.seedReportClosure.reportMode, 'monitor_only');
  assert.equal(payload.caveats.some((item) => item.type === 'seed_quality_boundary'), true);
  assert.equal(payload.claims[0].validationStatus, 'candidate');
});

test('Phase E apply writes only universal subject, seed closure metadata, and optional local report artifact', async () => {
  const seed = seedFromPrompt('Defense missile replenishment requires solid rocket motor production capacity, energetic binders, qualified suppliers, and test range throughput.');
  const row = rowForSeed(seed);
  const calls = [];
  const client = {
    async query(sql, values = []) {
      calls.push({ sql: String(sql).replace(/\s+/g, ' ').trim(), values });
      if (/update operator_research_seeds/i.test(sql)) {
        return {
          rows: [{
            seed_id: seed.seedId,
            status: 'report_generated',
            latest_report_id: 'RPT-test-seed',
            review_state: {},
            updated_at: generatedAt,
          }],
        };
      }
      throw new Error(`unexpected SQL: ${sql}`);
    },
  };
  const writtenSubjects = [];
  const result = await promoteOperatorSeedReportCandidates(client, {
    rows: [row],
    apply: true,
    generateReport: true,
    ensureSeedSchema: false,
    ensureUniversalSchema: false,
    writeUniversalSubject: async (subject) => {
      writtenSubjects.push(subject);
    },
    generateReportArtifact: async () => ({
      ok: true,
      reportId: 'RPT-test-seed',
      htmlPath: 'C:/tmp/report.html',
      queuedSourceQueryCount: 4,
      validation: { status: 'passed' },
    }),
  });

  assert.equal(result.ok, true);
  assert.equal(result.reportGeneratedCount, 1);
  assert.equal(result.mutationPolicy.universalResearchSubjectWrites, 1);
  assert.equal(result.mutationPolicy.operatorSeedWrites, 1);
  assert.equal(result.mutationPolicy.reportArtifactWrites, 1);
  assert.equal(result.mutationPolicy.localSourceQueueWrites, 4);
  assert.equal(result.mutationPolicy.approvalQueueWrites, 0);
  assert.equal(result.mutationPolicy.canonicalWrites, 0);
  assert.equal(result.mutationPolicy.sourceRegistryWrites, 0);
  assert.equal(result.mutationPolicy.providerActivationWrites, 0);
  assert.equal(writtenSubjects[0].metadata.operatorSeedId, seed.seedId);
  assert.equal(calls.some((call) => /approval_queue|source_registry|knowledge_edges/i.test(call.sql)), false);
});
