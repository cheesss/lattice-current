import assert from 'node:assert/strict';
import test from 'node:test';

import { REPORT_TYPES } from '../scripts/_shared/report-evidence-bundle.mjs';
import { buildDbReportBundle, withReportDbClient } from '../scripts/_shared/report-db-adapter.mjs';
import { generateDeterministicAnalystDraft } from '../scripts/_shared/report-llm-analyst.mjs';
import { validateReportBundle } from '../scripts/_shared/report-validator.mjs';

test('DB cross-theme adapter binds adjacent theme candidates by stable subject key', async () => {
  const client = {
    async query(sql) {
      if (/FROM cross_theme_candidates/i.test(sql)) return { rows: [] };
      if (/FROM adjacent_theme_candidates/i.test(sql)) {
        return { rows: [{
          id: 1,
          candidate_key: 'adjacent-16776-launch-fueling-or-cryogenic-infrastructure',
          parent_subject_key: '16776',
          parent_subject: 'solid rocket motor capacity',
          parent_report_id: 'RPT-parent',
          parent_report_path: 'data/reports/RPT-parent/report.html',
          lane: 'launch_fueling_or_cryogenic_infrastructure',
          label: 'Launch fueling or cryogenic infrastructure: solid rocket motor capacity',
          status: 'ready_for_deep_report',
          seed_terms: ['launch cadence'],
          source_terms: ['cryogenic', 'LOX'],
          issuer_candidates: [],
          evidence_classes: ['supplier_capacity'],
          confidence_score: 84,
          failure_reason: null,
          next_action: 'Promote adjacent candidate to universal research subject.',
          query_variants: [],
          metadata: { themes: ['space'], sourceQueryClosure: { contextCount: 3 } },
          updated_at: new Date().toISOString(),
        }] };
      }
      if (/FROM research_evidence_bundles/i.test(sql)) {
        return { rows: [{
          id: 99,
          question_id: 1,
          source_type: 'external-rss',
          source_id: 'rss-99',
          title: 'Cryogenic propellant management in space',
          text_excerpt: 'Cryogenic propellant management is a launch infrastructure constraint.',
          url: 'https://example.com/cryogenic',
          published_at: new Date().toISOString(),
          relevance_score: 0.82,
          metadata: {
            adjacentCandidateKey: 'adjacent-16776-launch-fueling-or-cryogenic-infrastructure',
            adjacentLane: 'launch_fueling_or_cryogenic_infrastructure',
            evidenceUse: 'supporting_context',
            desiredEvidenceClass: 'supplier_capacity',
          },
          created_at: new Date().toISOString(),
        }] };
      }
      return { rows: [] };
    },
  };

  const bundle = await buildDbReportBundle(client, {
    reportType: REPORT_TYPES.CROSS_THEME,
    subject: 'adjacent-16776-launch-fueling-or-cryogenic-infrastructure',
    depth: 'standard',
  });

  assert.equal(bundle.metadata.adjacentCandidateKey, 'adjacent-16776-launch-fueling-or-cryogenic-infrastructure');
  assert.equal(bundle.metadata.subjectMatchStatus, 'subject-bound');
  assert.equal(bundle.subject.displayName, 'Launch fueling or cryogenic infrastructure');
  assert.equal(Array.isArray(bundle.metadata.issuerDiscoveryMap), true);
  assert.equal(Array.isArray(bundle.metadata.candidateIssuerUniverse), true);
  assert.doesNotMatch(bundle.subject.displayName, /No cross theme bottleneck report bound/i);
  assert.equal(bundle.evidence.some((item) => /Cryogenic propellant/i.test(item.title)), true);
});

test('DB cross-theme adapter isolates strict endogenous adjacent issuer metadata from stale broad symbols', async () => {
  let autoThemeSymbolsQueried = false;
  const client = {
    async query(sql) {
      if (/FROM cross_theme_candidates/i.test(sql)) return { rows: [] };
      if (/FROM adjacent_theme_candidates/i.test(sql)) {
        return { rows: [{
          id: 2,
          candidate_key: 'endogenous-adjacent-clean-energy-generated-approved-supplier-qualification-lead-time',
          parent_subject_key: 'clean-energy',
          parent_subject: 'Clean Energy',
          lane: 'generated_approved-supplier-qualification-lead-time',
          label: 'approved-supplier qualification lead time: Clean Energy',
          status: 'ready_for_deep_report',
          seed_terms: [],
          source_terms: ['approved-supplier qualification lead time'],
          issuer_candidates: [],
          evidence_classes: ['substitution_limit'],
          confidence_score: 72,
          failure_reason: null,
          next_action: 'Collect direct issuer bridge evidence.',
          query_variants: [],
          metadata: {
            themes: ['clean-energy'],
            domains: ['semiconductor', 'clean_energy', 'industrial_materials'],
            discoveryNamespace: 'strict_endogenous_adjacent',
            frontierDiscovery: true,
            issuerUniverseSourceSymbols: ['AMZN', 'AMD', 'ASML', 'TSM', 'NVDA'],
            issuerUniverse: ['AMZN', 'AMD', 'ASML', 'TSM', 'NVDA'],
            sourceQueryClosure: { contextCount: 1 },
          },
          updated_at: new Date().toISOString(),
        }] };
      }
      if (/FROM research_evidence_bundles/i.test(sql)) return { rows: [] };
      if (/FROM auto_theme_symbols/i.test(sql)) {
        autoThemeSymbolsQueried = true;
        return { rows: [{ theme: 'clean-energy', symbol: 'AMZN' }, { theme: 'clean-energy', symbol: 'TSM' }] };
      }
      return { rows: [] };
    },
  };

  const bundle = await buildDbReportBundle(client, {
    reportType: REPORT_TYPES.CROSS_THEME,
    subject: 'endogenous-adjacent-clean-energy-generated-approved-supplier-qualification-lead-time',
    depth: 'standard',
  });

  assert.equal(autoThemeSymbolsQueried, false);
  assert.equal(bundle.metadata.adjacentCandidate.status, 'needs_scarcity_evidence');
  assert.equal(bundle.metadata.adjacentCandidate.metadata.storedStatus, 'ready_for_deep_report');
  assert.equal(bundle.metadata.adjacentCandidate.metadata.effectiveStatus, 'needs_scarcity_evidence');
  assert.equal(bundle.metadata.adjacentCandidate.metadata.statusReconcileReason, 'missing_source_derived_frontier_node');
  assert.deepEqual(bundle.metadata.issuerUniverse, []);
  assert.deepEqual(bundle.issuerUniverse, []);
  assert.deepEqual(bundle.metadata.candidateIssuerUniverse.sort(), ['ETN', 'PWR']);
  assert.equal(bundle.metadata.candidateIssuerUniverse.includes('AMZN'), false);
  assert.equal(bundle.metadata.candidateIssuerUniverse.includes('TSM'), false);
  assert.deepEqual(bundle.metadata.issuerDiscoveryMap.map((row) => row.symbol).sort(), ['ETN', 'PWR']);
});

test('DB cross-theme adapter restores strict frontier support from direct provider evidence', async () => {
  const client = {
    async query(sql) {
      if (/FROM cross_theme_candidates/i.test(sql)) return { rows: [] };
      if (/FROM adjacent_theme_candidates/i.test(sql)) {
        return { rows: [{
          id: 3,
          candidate_key: 'endogenous-adjacent-ai-generated-interconnection-study-capacity',
          parent_subject_key: 'ai-ml',
          parent_subject: 'AI / ML',
          lane: 'generated_interconnection-study-capacity',
          label: 'interconnection study capacity: AI / ML',
          status: 'ready_for_deep_report',
          seed_terms: [],
          source_terms: ['interconnection study capacity'],
          issuer_candidates: [],
          evidence_classes: ['grid_interconnection', 'substitution_limit'],
          confidence_score: 76,
          failure_reason: null,
          next_action: 'Promote strict frontier candidate after direct source evidence.',
          query_variants: [],
          metadata: {
            themes: ['ai-ml'],
            discoveryNamespace: 'strict_endogenous_adjacent',
            frontierDiscovery: true,
            frontierNodeSupported: false,
            sourceDerivedNodeCount: 0,
            scarcityEvidenceScore: 0.1,
            sourceQueryClosure: { contextCount: 1 },
          },
          updated_at: new Date().toISOString(),
        }] };
      }
      if (/FROM research_evidence_bundles/i.test(sql)) {
        return { rows: [{
          id: 1001,
          question_id: 1,
          source_type: 'public_planning_source',
          source_id: 'ferc-1001',
          title: 'FERC interconnection study backlog and queue processing final rule',
          text_excerpt: 'FERC final rule cites interconnection study backlog, queue processing delays, and transmission provider study capacity constraints.',
          url: 'https://example.com/ferc',
          published_at: new Date().toISOString(),
          relevance_score: 0.93,
          metadata: {
            adjacentCandidateKey: 'endogenous-adjacent-ai-generated-interconnection-study-capacity',
            sourceProvider: 'ferc',
            evidenceUse: 'promotion_candidate',
            desiredEvidenceClass: 'substitution_limit',
            promotionEligible: true,
          },
          created_at: new Date().toISOString(),
        }] };
      }
      return { rows: [] };
    },
  };

  const bundle = await buildDbReportBundle(client, {
    reportType: REPORT_TYPES.CROSS_THEME,
    subject: 'endogenous-adjacent-ai-generated-interconnection-study-capacity',
    depth: 'standard',
  });

  assert.equal(bundle.metadata.adjacentCandidate.status, 'ready_for_deep_report');
  assert.equal(bundle.metadata.adjacentCandidate.metadata.frontierNodeSupported, true);
  assert.equal(bundle.metadata.frontierNodeSupported, true);
  assert.equal(bundle.metadata.sourceDerivedNodeCount >= 1, true);
  assert.equal(bundle.metadata.adjacentCandidate.metadata.frontierEvidenceReconciledBy, 'report-db-adapter-provider-evidence');
});

test('DB report adapter builds S-grade bundles for all report types when PostgreSQL is available', async (t) => {
  let dbAvailable = false;
  await withReportDbClient(async (client) => {
    await client.query('SELECT 1');
    dbAvailable = true;
  }).catch((error) => {
    t.skip(`PostgreSQL unavailable: ${String(error?.message || error)}`);
  });
  if (!dbAvailable) return;

  await withReportDbClient(async (client) => {
    for (const reportType of Object.values(REPORT_TYPES)) {
      const bundle = await buildDbReportBundle(client, {
        reportType,
        subject: { displayName: 'cloud-infrastructure' },
      });
      const analysis = generateDeterministicAnalystDraft(bundle);
      const validation = validateReportBundle(bundle, { analysis });
      assert.equal(validation.ok, true, `${reportType}: ${JSON.stringify(validation.blockers)}`);
      assert.equal(validation.quality.artifactGrade, 'S', `${reportType} should be S-grade artifact quality from DB-backed data`);
      assert.equal(typeof validation.quality.publishable, 'boolean', `${reportType} should expose publishability`);
      if (validation.quality.publishable === false) {
        assert.equal(validation.quality.publishabilityReasons.length > 0, true, `${reportType} should explain non-publishable status`);
        assert.equal(['B', 'C', 'D'].includes(validation.quality.grade), true, `${reportType} should be capped when data depth or freshness is not publishable`);
      } else {
        assert.equal(['S', 'A', 'B', 'C'].includes(validation.quality.grade), true, `${reportType} final grade should be truthful and usable`);
      }
      assert.ok(validation.quality.triageUsefulness?.grade, `${reportType} should expose triage usefulness separately`);
      assert.ok(validation.quality.analystMemoQuality?.grade, `${reportType} should expose analyst memo quality separately`);
      assert.ok(validation.quality.investmentReadinessQuality?.grade, `${reportType} should expose investment readiness separately`);
      assert.equal(validation.quality.metrics.analysis_sectionCompleteness, 1, `${reportType} should include full analyst section coverage`);
      assert.equal(bundle.metadata?.dbBacked, true, `${reportType} should be marked dbBacked`);
      assert.equal(bundle.evidence.length > 0, true, `${reportType} should include DB-backed evidence`);
    }
  });
});
