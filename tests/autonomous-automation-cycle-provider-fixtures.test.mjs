import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  runAutonomousAutomationCycle,
} from '../scripts/run-autonomous-automation-cycle.mjs';

async function withTempRuntime(fn) {
  const runtimeRoot = await mkdtemp(path.join(os.tmpdir(), 'lattice-cycle-fixture-'));
  try {
    return await fn(runtimeRoot);
  } finally {
    await rm(runtimeRoot, { recursive: true, force: true });
  }
}

test('automation cycle verifies priority provider fixtures and stages read-only providers', async () => {
  await withTempRuntime(async (runtimeRoot) => {
    const result = await runAutonomousAutomationCycle({
      runtimeRoot,
      apply: true,
      writeArtifacts: true,
      limit: 5,
    });
    assert.equal(result.providerFixtureProbes.verifiedCount > 0, true);
    assert.equal(result.providerCollectorRegistry.ok, true);
    assert.equal(result.providerCollectorRegistry.collectorCount, 10);
    assert.equal(result.collectorBackedProviderCandidateCount, 1);
    assert.equal(result.providerFixtureProbes.missingCount, 0);
    assert.equal(
      result.sourceProviderActivation.summary.stagedCount,
      result.providerFixtureProbes.verifiedCount + result.collectorBackedProviderCandidateCount,
    );
    assert.equal(result.sourceProviderActivation.summary.needsFixtureCount, 0);
    assert.equal(
      result.sourceProviderActivation.records.some((record) => (
        record.candidateId === 'collector:iso_rto_interconnection_queue_report:engineering_process'
        && record.status === 'staged'
      )),
      true,
    );
    assert.equal(result.providerQualityFeedback.ok, true);
    assert.equal(result.sourceQualityScore.ok, true);
    assert.equal(result.sourceQualityScore.recordCount >= 0, true);
    assert.equal(result.providerQualityFeedback.summary.collectorRequirementCount, 0);
    assert.equal(result.sourceDiversityFeedback.ok, true);
    assert.equal(result.sourceDiversityFeedback.sourceSelectionPolicy.rawEvidenceRaisesReadiness, false);
    assert.equal(result.automationFeedbackRemediation.ok, true);
    assert.equal(result.automationFeedbackRemediation.summary.fixtureRequirementCount, 0);
    assert.equal(result.automationFeedbackRemediation.summary.targetedBackfillTaskCount >= 1, true);
    assert.equal(result.automationFeedbackCodeRepair.mode, 'plan_only');
    assert.equal(result.automationFeedbackCodeRepair.requestCount, 0);
    assert.equal(result.automationFeedbackCodeRepair.executedCount, 0);
    assert.equal(
      result.mutationBoundaries.sourceRegistryWrites,
      result.providerFixtureProbes.verifiedCount + result.collectorBackedProviderCandidateCount,
    );
    assert.equal(result.mutationBoundaries.providerActivationWrites, 0);
    assert.equal(result.mutationBoundaries.canonicalWrites, 0);
    assert.equal(result.mutationBoundaries.readinessPromotionWrites, 0);
    assert.equal(result.mutationBoundaries.reportCandidateWrites, 0);
    assert.equal(result.mutationBoundaries.portfolioActionWrites, 0);

    const probeArtifact = JSON.parse(await readFile(path.join(runtimeRoot, 'source-provider-fixture-probes.latest.json'), 'utf8'));
    assert.equal(probeArtifact.verifiedCount, result.providerFixtureProbes.verifiedCount);
    const consoleArtifact = JSON.parse(await readFile(path.join(runtimeRoot, 'automation-console.latest.json'), 'utf8'));
    assert.equal(consoleArtifact.providerFixtureProbes.verifiedCount, result.providerFixtureProbes.verifiedCount);
    assert.equal(consoleArtifact.providerCollectorRegistry.collectorCount, 10);
    assert.equal(consoleArtifact.providerQualityFeedback.available, true);
    assert.equal(consoleArtifact.sourceQualityScore.available, true);
    assert.equal(consoleArtifact.evidenceGateConsolidation.available, true);
    assert.equal(consoleArtifact.sourceDiversityFeedback.available, true);
    assert.equal(consoleArtifact.automationFeedbackRemediation.available, true);
    assert.equal(consoleArtifact.automationFeedbackRemediation.fixtureRequirementCount, 0);
    assert.equal(consoleArtifact.automationFeedbackCodeRepair.available, true);
    assert.equal(consoleArtifact.automationFeedbackCodeRepair.requestCount, 0);
    assert.equal(consoleArtifact.audit.providerFixtureProbes.probeResults.length, result.providerFixtureProbes.verifiedCount);
    const collectorArtifact = JSON.parse(await readFile(path.join(runtimeRoot, 'provider-collector-registry.latest.json'), 'utf8'));
    assert.equal(collectorArtifact.ok, true);
    assert.equal(collectorArtifact.collectorCount, 10);
  });
});

test('automation cycle feeds staged provider fixtures into bounded backfill execution without promotion', async () => {
  await withTempRuntime(async (runtimeRoot) => {
    await writeFile(path.join(runtimeRoot, 'seed-bias-backfill-plan.latest.json'), JSON.stringify({
      ok: true,
      tasks: [
        {
          taskId: 'cycle-holdout-task',
          seedId: 'seed-cycle',
          evidenceClass: 'holdout_validation',
          providerRoute: 'holdout-validation',
          status: 'queued',
          acceptanceCriteria: { sourceGroupMustDifferFromGeneration: true },
        },
      ],
    }), 'utf8');
    const result = await runAutonomousAutomationCycle({
      runtimeRoot,
      apply: true,
      writeArtifacts: true,
      limit: 5,
      executeStagedProviderLive: false,
      readDbContext: false,
    });
    assert.equal(result.providerFixtureProbes.verifiedCount > 0, true);
    assert.equal(result.backfillQueue.rawEvidenceStoredCount, 1);
    assert.equal(result.backfillQueue.acceptedEvidenceStoredCount, 1);
    assert.equal(result.backfillQueue.acceptedPromotionEvidenceStoredCount, 0);
    assert.equal(result.backfillQueue.readinessChanged, false);
    assert.equal(result.mutationBoundaries.providerActivationWrites, 0);
    assert.equal(result.mutationBoundaries.readinessPromotionWrites, 0);
    const queueArtifact = JSON.parse(await readFile(path.join(runtimeRoot, 'backfill-queue-executor.latest.json'), 'utf8'));
    assert.equal(queueArtifact.acceptedEvidence[0].validationFixtureOnly, true);
  });
});

test('automation cycle consumes prior remediation targeted backfill tasks on next run', async () => {
  await withTempRuntime(async (runtimeRoot) => {
    await writeFile(path.join(runtimeRoot, 'automation-feedback-remediation.latest.json'), JSON.stringify({
      version: 'automation-feedback-remediation-v1',
      targetedBackfillTasks: [
        {
          taskId: 'feedback-backfill-material_input',
          actionType: 'create_targeted_backfill_task',
          evidenceClass: 'material_input',
          providerRoute: ['official_filing', 'company_ir'],
          sourceBuckets: ['official_filing', 'company_ir'],
          status: 'queued_artifact_only',
          acceptanceCriteria: {
            sourceIndependenceRequired: true,
            operatingBridgeSnippetRequired: true,
            rawMetadataOnlyAccepted: false,
          },
        },
      ],
    }), 'utf8');

    const result = await runAutonomousAutomationCycle({
      runtimeRoot,
      apply: true,
      writeArtifacts: true,
      limit: 5,
      executeStagedProviderLive: false,
      readDbContext: false,
    });

    const feedbackTask = result.backfillQueue.tasks.find((task) => task.taskId === 'feedback-backfill-material_input:executor');
    assert.equal(Boolean(feedbackTask), true);
    assert.equal(feedbackTask.status, 'queued');
    assert.equal(result.backfillQueue.taskResults.some((row) => row.taskId === 'feedback-backfill-material_input:executor'), true);
    assert.equal(result.mutationBoundaries.readinessPromotionWrites, 0);
    assert.equal(result.mutationBoundaries.reportCandidateWrites, 0);

    const queueArtifact = JSON.parse(await readFile(path.join(runtimeRoot, 'backfill-queue-executor.latest.json'), 'utf8'));
    assert.equal(queueArtifact.tasks.some((task) => task.taskId === 'feedback-backfill-material_input:executor'), true);
  });
});

test('automation cycle consumes prior remediation converted gate tasks on next run', async () => {
  await withTempRuntime(async (runtimeRoot) => {
    await writeFile(path.join(runtimeRoot, 'automation-feedback-remediation.latest.json'), JSON.stringify({
      version: 'automation-feedback-remediation-v1',
      convertedGateTasks: [
        {
          taskId: 'gate-consolidation-negative-alternate',
          actionType: 'convert_gate_task_to_bounded_backfill',
          seedId: 'seed-gate',
          trackId: 'issuer_bridge_track',
          evidenceClass: 'negative_control',
          providerRoute: 'negative-control-official-route-alternate-query-family',
          status: 'queued_artifact_only',
          sourceQuery: 'narrower bounded negative-control check using a distinct official invalidator query family',
          acceptanceCriteria: {
            seedCentricGateClosure: true,
            acceptedPromotionEvidenceRequired: true,
            rawMetadataOnlyAccepted: false,
          },
        },
      ],
    }), 'utf8');

    const result = await runAutonomousAutomationCycle({
      runtimeRoot,
      apply: true,
      writeArtifacts: true,
      limit: 5,
      executeStagedProviderLive: false,
    });

    const gateTask = result.backfillQueue.tasks.find((task) => task.taskId === 'gate-consolidation-negative-alternate:executor');
    assert.equal(Boolean(gateTask), true);
    assert.equal(gateTask.evidenceClass, 'negative_control');
    assert.equal(gateTask.status, 'queued');
    assert.equal(result.backfillQueue.taskResults.some((row) => row.taskId === 'gate-consolidation-negative-alternate:executor'), true);
    assert.equal(result.mutationBoundaries.reportCandidateWrites, 0);
    assert.equal(result.mutationBoundaries.readinessPromotionWrites, 0);
  });
});

test('automation cycle consumes prior evidence gate consolidation tasks on next run', async () => {
  await withTempRuntime(async (runtimeRoot) => {
    await writeFile(path.join(runtimeRoot, 'evidence-gate-consolidation.latest.json'), JSON.stringify({
      version: 'evidence-gate-consolidator-v1',
      candidateSeed: { seedId: 'seed-gate', trackId: 'issuer_bridge_track' },
      suggestedBackfillTasks: [
        {
          taskId: 'gate-consolidation-market',
          seedId: 'seed-gate',
          trackId: 'issuer_bridge_track',
          evidenceClass: 'market_validation',
          providerRoute: 'local-market-validation',
          status: 'queued_local_market_validation',
          reviewRequired: false,
          sourceQuery: 'local controlled market validation for gate consolidation',
        },
      ],
    }), 'utf8');

    const result = await runAutonomousAutomationCycle({
      runtimeRoot,
      apply: true,
      writeArtifacts: true,
      limit: 5,
      executeStagedProviderLive: false,
    });

    const gateTask = result.backfillQueue.tasks.find((task) => task.taskId === 'gate-consolidation-market:executor');
    assert.equal(Boolean(gateTask), true);
    assert.equal(gateTask.evidenceClass, 'market_validation');
    assert.equal(gateTask.status, 'queued_local_market_validation');
    assert.equal(result.backfillQueue.taskResults.some((row) => row.taskId === 'gate-consolidation-market:executor'), true);
    assert.equal(result.mutationBoundaries.reportCandidateWrites, 0);
    assert.equal(result.mutationBoundaries.readinessPromotionWrites, 0);
  });
});

test('automation cycle runs staged provider live executor under bounded artifact-only policy', async () => {
  await withTempRuntime(async (runtimeRoot) => {
    await writeFile(path.join(runtimeRoot, 'seed-bias-backfill-plan.latest.json'), JSON.stringify({
      ok: true,
      tasks: [
        {
          taskId: 'cycle-live-issuer',
          seedId: 'seed-abf-live',
          evidenceClass: 'issuer_exposure',
          providerRoute: 'company_ir_direct_pdf',
          status: 'queued',
          acceptanceCriteria: {
            requiredTerms: ['ABF substrate', 'capacity', 'customer demand'],
            bridgeTerms: ['capacity', 'capex', 'customer demand', 'revenue'],
          },
        },
        {
          taskId: 'cycle-live-holdout',
          seedId: 'seed-abf-live',
          evidenceClass: 'holdout_validation',
          providerRoute: 'company_ir_direct_pdf',
          status: 'queued',
          acceptanceCriteria: { requiredTerms: ['ABF substrate', 'capacity'] },
        },
      ],
    }), 'utf8');
    const result = await runAutonomousAutomationCycle({
      runtimeRoot,
      apply: true,
      writeArtifacts: true,
      limit: 5,
      stagedProviderMaxTargets: 2,
      fetchImpl: async (url) => {
        const map = {
          'https://www.ibiden.com/ir/library/annual/': `
            <a href="/ir/library/annual/annual-2026.pdf">Annual Report 2026 ABF substrate capacity</a>
            <a href="/ir/library/annual/integrated-2026.pdf">Integrated Report 2026 IC substrate capacity</a>
          `,
          'https://www.ibiden.com/ir/library/annual/annual-2026.pdf': '%PDF-1.4 (Official annual report: ABF package substrate capacity and capex allocation are tied to customer demand, revenue, backlog, and lead time.) %%EOF',
          'https://www.ibiden.com/ir/library/annual/integrated-2026.pdf': '%PDF-1.4 (Official integrated report: high-end IC substrate capacity expansion supports customer demand and revenue growth.) %%EOF',
        };
        const body = map[String(url)];
        if (!body) return { ok: false, status: 404, headers: { get: () => 'text/plain' }, text: async () => '', arrayBuffer: async () => Buffer.from('', 'utf8') };
        return {
          ok: true,
          status: 200,
          headers: { get: () => String(url).endsWith('.pdf') ? 'application/pdf' : 'text/html; charset=utf-8' },
          text: async () => body,
          arrayBuffer: async () => Buffer.from(body, 'utf8'),
        };
      },
    });
    assert.equal(result.stagedProviderLiveExecution.targetCount >= 1, true);
    assert.equal(result.stagedProviderLiveExecution.acceptedPromotionEvidenceStoredCount, 1);
    assert.equal(result.evidenceGateConsolidation.primaryState.acceptedPromotionEvidenceCount >= 1, true);
    assert.equal(result.evidenceGateConsolidation.primaryState.missingGates.includes('negative_control_not_closed'), true);
    assert.equal(result.evidenceGateConsolidation.suggestedBackfillTaskCount, 1);
    assert.equal(result.sourceQualityScore.summary.promotionEligibleCount >= 1, true);
    assert.equal(result.providerQualityFeedback.summary.promotionCount >= 1, true);
    assert.equal(result.providerQualityFeedback.recommendedRemediationAction, 're_evaluate_negative_holdout_issuer_market_gates');
    assert.equal(result.automationFeedbackRemediation.summary.nextSafeAction, 'convert_gate_task_to_bounded_backfill');
    assert.equal(result.automationFeedbackRemediation.summary.convertedGateTaskCount, 1);
    assert.equal(result.stagedProviderLiveExecution.readinessChanged, false);
    assert.equal(result.mutationBoundaries.providerActivationWrites, 0);
    assert.equal(result.mutationBoundaries.readinessPromotionWrites, 0);
    assert.equal(result.mutationBoundaries.reportCandidateWrites, 0);

    const liveArtifact = JSON.parse(await readFile(path.join(runtimeRoot, 'staged-provider-live-executor.latest.json'), 'utf8'));
    assert.equal(liveArtifact.acceptedPromotionEvidenceStoredCount, 1);
    assert.equal(liveArtifact.providerCollectorRegistry.collectorCount, 10);
    assert.equal(liveArtifact.providerRuns[0].collectorKind, 'company_ir_document_extraction');
    const consoleArtifact = JSON.parse(await readFile(path.join(runtimeRoot, 'automation-console.latest.json'), 'utf8'));
    assert.equal(consoleArtifact.stagedProviderLiveExecution.acceptedPromotionEvidenceCount, 1);
    assert.equal(consoleArtifact.evidenceGateConsolidation.available, true);
    assert.equal(consoleArtifact.evidenceGateConsolidation.suggestedBackfillTaskCount, 1);
    assert.equal(consoleArtifact.sourceQualityScore.promotionEligibleCount >= 1, true);
    assert.equal(consoleArtifact.providerQualityFeedback.promotionCount >= 1, true);
    assert.equal(consoleArtifact.sourceDiversityFeedback.sourceSelectionPolicy.rawEvidenceRaisesReadiness, false);
    assert.equal(consoleArtifact.automationFeedbackRemediation.nextSafeAction, 'convert_gate_task_to_bounded_backfill');
    assert.equal(consoleArtifact.automationFeedbackRemediation.convertedGateTaskCount, 1);
    assert.equal(consoleArtifact.audit.stagedProviderLiveExecution.acceptedPromotionEvidenceStoredCount, 1);
  });
});

test('automation cycle can still show raw needs_fixture state when fixture verification is disabled', async () => {
  await withTempRuntime(async (runtimeRoot) => {
    const result = await runAutonomousAutomationCycle({
      runtimeRoot,
      apply: true,
      writeArtifacts: false,
      verifyProviderFixtures: false,
      limit: 5,
    });
    assert.equal(result.providerFixtureProbes.verifiedCount, 0);
    assert.equal(result.sourceProviderActivation.summary.needsFixtureCount > 0, true);
    assert.equal(result.sourceProviderActivation.boundaries.providerActivationWrites, 0);
    assert.equal(result.mutationBoundaries.readinessPromotionWrites, 0);
  });
});

test('automation cycle stages diagnostic report candidates for operator review only', async () => {
  await withTempRuntime(async (runtimeRoot) => {
    await writeFile(path.join(runtimeRoot, 'autonomous-research-repair-loop.latest.json'), JSON.stringify({
      runId: 'repair-loop-stage-test',
      reportCandidateAllowedDiagnostic: true,
      acceptedEvidenceAfter: 7,
      acceptedPromotionEvidenceAfter: 2,
      negativeControlAfter: 'CHECKED_NO_DIRECT',
      holdoutAfter: true,
      issuerBridgeAfter: 'closed',
      marketValidationAfter: 'controlled_ready',
      valuationBridgeStatus: 'human_review_caveated',
      readinessAfter: {
        blockers: ['investment_memo_readiness_blocked_until_valuation_or_expectation_bridge'],
      },
      iterations: [
        {
          evidenceCountsAfter: {
            acceptedEvidenceCount: 7,
            acceptedPromotionEvidenceCount: 2,
            independentSourceBreadth: 5,
          },
          actionResult: {
            reportCandidateAllowedDiagnostic: true,
            reportSubjectDryRun: {
              subjectId: 'dryrun-msd-child-stage-test',
              subjectLabel: 'staged report candidate subject',
              childSeedId: 'msd-child-stage-test',
              bottleneckNode: 'rocket motor casing composite capacity',
              issuerUniverse: ['NOC', 'LHX'],
            },
          },
        },
      ],
    }), 'utf8');
    const result = await runAutonomousAutomationCycle({
      runtimeRoot,
      apply: true,
      writeArtifacts: true,
      limit: 5,
      executeStagedProviderLive: false,
    });

    assert.equal(result.reportCandidateStaging.stagingStatus, 'staged_for_operator_review');
    assert.equal(result.evidenceGateConsolidation.stagedForOperatorReview, true);
    assert.equal(result.reportCandidateStaging.stageCount, 1);
    assert.equal(result.reportCandidateStaging.reportCandidateWriteAllowed, false);
    assert.equal(result.mutationBoundaries.reportCandidateWrites, 0);
    assert.equal(result.mutationBoundaries.reportCandidateStagedArtifactWrites, 1);

    const stagingArtifact = JSON.parse(await readFile(path.join(runtimeRoot, 'report-candidate-staging.latest.json'), 'utf8'));
    assert.equal(stagingArtifact.candidates[0].reviewStatus, 'pending');
    const consoleArtifact = JSON.parse(await readFile(path.join(runtimeRoot, 'automation-console.latest.json'), 'utf8'));
    assert.equal(consoleArtifact.evidenceGateConsolidation.stagedForOperatorReview, true);
    assert.equal(consoleArtifact.reportCandidateStaging.stageCount, 1);
    assert.equal(consoleArtifact.operatorRequiredActions.includes('report_candidate_staged_review'), true);
    assert.equal(consoleArtifact.approvalWorkflow.mutationBoundary.reportCandidateWrites, 0);
  });
});

test('automation cycle auto-links trusted valuation context for closed issuer bridge', async () => {
  await withTempRuntime(async (runtimeRoot) => {
    await writeFile(path.join(runtimeRoot, 'autonomous-research-repair-loop.latest.json'), JSON.stringify({
      runId: 'repair-loop-valuation-linker-test',
      acceptedEvidenceAfter: 7,
      acceptedPromotionEvidenceAfter: 2,
      negativeControlAfter: 'CHECKED_NO_DIRECT',
      holdoutAfter: true,
      issuerBridgeAfter: 'closed',
      marketValidationAfter: 'controlled_ready',
      iterations: [
        {
          evidenceCountsAfter: {
            acceptedEvidenceCount: 7,
            acceptedPromotionEvidenceCount: 2,
            independentSourceBreadth: 5,
          },
          actionResult: {
            reportSubjectDryRun: {
              subjectId: 'dryrun-msd-child-valuation-linker',
              subjectLabel: 'rocket motor casing composite capacity',
              childSeedId: 'msd-child-valuation-linker',
              bottleneckNode: 'rocket motor casing composite capacity',
              bottleneckClass: 'technical_qualification',
              issuerUniverse: ['LHX', 'NOC'],
            },
          },
        },
      ],
    }), 'utf8');
    await writeFile(path.join(runtimeRoot, 'historical-analogue-bridge.latest.json'), JSON.stringify({
      version: 'historical-analogue-bridge-v1',
      reflectionStatus: 'comparison_ready',
      usableAnalogueCount: 2,
      analogueMedianExcessMove90d: 0.16,
      bestAnalogueIds: ['solid_rocket_motor_capacity_2022', 'defense_composite_motor_case_capacity_2023'],
      topScores: [
        { analogueId: 'solid_rocket_motor_capacity_2022', peerBasket: ['LHX', 'LMT'], marketOutcome: { return90dExcess: 0.14 } },
        { analogueId: 'defense_composite_motor_case_capacity_2023', peerBasket: ['NOC', 'RTX'], marketOutcome: { return90dExcess: 0.18 } },
      ],
    }), 'utf8');
    await writeFile(path.join(runtimeRoot, 'trusted-local-valuation-cache.defense.latest.json'), JSON.stringify({
      version: 'trusted-local-valuation-fundamentals-cache-v1',
      rows: ['LHX', 'NOC'].map((issuer) => ({
        issuer,
        ticker: issuer,
        roleClass: 'propulsion_structure_supplier',
        sourceProvenance: 'trusted_local_market_cache',
        asOfDate: '2026-05-24',
        revenueGrowth: 0.05,
        backlog: 100,
        forwardPE: 18,
        evToEbitda: 14,
        evToSales: 2.1,
        peerGroup: ['LMT', 'RTX'],
        peerMedianForwardPE: 19,
        peerMedianEVEBITDA: 15,
        peerRelativeMultiple: '-0.04',
        premiumDiscountToPeer: -0.04,
        consensusRevenueGrowth: 0.05,
        consensusEPSGrowth: 0.07,
        consensusRevisionDirection: 'stable',
        localPriceWindow: {
          excessVsBenchmark90d: 0.02,
          excessVsPeerBasket90d: 0.02,
        },
      })),
    }), 'utf8');

    const result = await runAutonomousAutomationCycle({
      runtimeRoot,
      apply: true,
      writeArtifacts: true,
      limit: 5,
      executeStagedProviderLive: false,
    });

    assert.equal(result.valuationContextAutoLinker.gateEligible, true);
    assert.equal(result.valuationContextAutoLinker.contextRows.length, 2);
    assert.equal(result.valuationContextAutoLinker.reflectionStatus, 'under_reflected_candidate');
    assert.equal(result.valuationExpectationBridge.valuationBridgeStatus, 'valuation_bridge_closed');
    assert.equal(result.valuationExpectationBridge.expectationReflectionStatus, 'under_reflected_candidate');
    assert.equal(result.evidenceGateConsolidation.stagedForOperatorReview, true);
    assert.equal(result.reportCandidateStaging.stagingStatus, 'staged_for_operator_review');
    assert.equal(result.reportCandidateStaging.reportCandidateWriteAllowed, false);
    assert.equal(result.mutationBoundaries.readinessPromotionWrites, 0);
    assert.equal(result.mutationBoundaries.reportCandidateWrites, 0);
    assert.equal(result.mutationBoundaries.portfolioActionWrites, 0);

    const linkerArtifact = JSON.parse(await readFile(path.join(runtimeRoot, 'valuation-context-auto-linker.latest.json'), 'utf8'));
    assert.equal(linkerArtifact.contextRows.length, 2);
    const rotationArtifact = JSON.parse(await readFile(path.join(runtimeRoot, 'valuation-context-rotation.latest.json'), 'utf8'));
    assert.equal(rotationArtifact.valuationBlockedCandidates.length, 0);
    assert.equal(rotationArtifact.nextEligibleSeed.seedId, 'msd-child-valuation-linker');
    const consoleArtifact = JSON.parse(await readFile(path.join(runtimeRoot, 'automation-console.latest.json'), 'utf8'));
    assert.equal(consoleArtifact.valuationContextAutoLinker.issuerCoverage.contextRowCount, 2);
    assert.equal(consoleArtifact.valuationContextRotation.nextEligibleSeed.seedId, 'msd-child-valuation-linker');
    assert.equal(consoleArtifact.reportCandidateStaging.reportCandidateWriteAllowed, false);
  });
});

test('automation cycle blocks valuation-only seed pending cache instead of retrying broad provider tasks', async () => {
  await withTempRuntime(async (runtimeRoot) => {
    await writeFile(path.join(runtimeRoot, 'autonomous-research-repair-loop.latest.json'), JSON.stringify({
      runId: 'repair-loop-valuation-cache-required-test',
      acceptedEvidenceAfter: 7,
      acceptedPromotionEvidenceAfter: 2,
      negativeControlAfter: 'CHECKED_NO_DIRECT',
      holdoutAfter: true,
      issuerBridgeAfter: 'closed',
      marketValidationAfter: 'controlled_ready',
      iterations: [
        {
          evidenceCountsAfter: {
            acceptedEvidenceCount: 7,
            acceptedPromotionEvidenceCount: 2,
            independentSourceBreadth: 5,
          },
          actionResult: {
            reportSubjectDryRun: {
              subjectId: 'dryrun-msd-child-valuation-cache-required',
              subjectLabel: 'rocket motor casing composite capacity',
              childSeedId: 'msd-child-valuation-cache-required',
              bottleneckNode: 'rocket motor casing composite capacity',
              bottleneckClass: 'technical_qualification',
              issuerUniverse: ['LHX', 'NOC'],
            },
          },
        },
      ],
    }), 'utf8');
    await writeFile(path.join(runtimeRoot, 'historical-analogue-bridge.latest.json'), JSON.stringify({
      version: 'historical-analogue-bridge-v1',
      reflectionStatus: 'comparison_ready',
      usableAnalogueCount: 2,
      analogueMedianExcessMove90d: 0.16,
      bestAnalogueIds: ['solid_rocket_motor_capacity_2022', 'defense_composite_motor_case_capacity_2023'],
    }), 'utf8');

    const result = await runAutonomousAutomationCycle({
      runtimeRoot,
      apply: true,
      writeArtifacts: true,
      limit: 5,
      executeStagedProviderLive: false,
      readDbContext: false,
    });

    assert.equal(result.valuationContextAutoLinker.blockedPendingCache, true);
    assert.equal(result.valuationContextAutoLinker.blockType, 'valuation_blocked_pending_cache');
    assert.deepEqual(result.valuationContextAutoLinker.missingIssuerFundamentals, ['LHX', 'NOC']);
    assert.equal(result.valuationContextRotation.stopReason, 'valuation_context_cache_required');
    assert.equal(result.evidenceGateConsolidation.stopReason, 'valuation_context_cache_required');
    assert.equal(result.evidenceGateConsolidation.suggestedBackfillTaskCount, 0);
    assert.equal(result.reportCandidateStaging.stagingStatus, 'blocked_no_stage');
    assert.equal(result.mutationBoundaries.reportCandidateWrites, 0);
    assert.equal(result.mutationBoundaries.readinessPromotionWrites, 0);

    const requirements = JSON.parse(await readFile(path.join(runtimeRoot, 'local-market-valuation-fixture-requirements.latest.json'), 'utf8'));
    assert.equal(requirements.requirements.some((row) => row.issuer === 'LHX'), true);
    assert.equal(requirements.operatorRequiredActions.includes('provide_local_valuation_context'), true);
    const consoleArtifact = JSON.parse(await readFile(path.join(runtimeRoot, 'automation-console.latest.json'), 'utf8'));
    assert.equal(consoleArtifact.valuationContextRotation.valuationBlockedCandidateCount, 1);
    assert.equal(consoleArtifact.operatorRequiredActions.includes('provide_local_valuation_context'), true);
  });
});

test('automation cycle executes valuation context requirements and re-enters gate consolidation', async () => {
  await withTempRuntime(async (runtimeRoot) => {
    await writeFile(path.join(runtimeRoot, 'autonomous-research-repair-loop.latest.json'), JSON.stringify({
      runId: 'repair-loop-valuation-requirement-executor-test',
      acceptedEvidenceAfter: 7,
      acceptedPromotionEvidenceAfter: 2,
      negativeControlAfter: 'CHECKED_NO_DIRECT',
      holdoutAfter: true,
      issuerBridgeAfter: 'closed',
      marketValidationAfter: 'controlled_ready',
      iterations: [
        {
          evidenceCountsAfter: {
            acceptedEvidenceCount: 7,
            acceptedPromotionEvidenceCount: 2,
            independentSourceBreadth: 5,
          },
          actionResult: {
            reportSubjectDryRun: {
              subjectId: 'dryrun-msd-child-valuation-requirement',
              subjectLabel: 'generic test bottleneck',
              childSeedId: 'msd-child-valuation-requirement',
              bottleneckNode: 'generic test bottleneck',
              bottleneckClass: 'technical_qualification',
              issuerUniverse: ['AAA', 'BBB'],
            },
          },
        },
      ],
    }), 'utf8');
    await writeFile(path.join(runtimeRoot, 'historical-analogue-bridge.latest.json'), JSON.stringify({
      version: 'historical-analogue-bridge-v1',
      reflectionStatus: 'comparison_ready',
      usableAnalogueCount: 2,
      analogueMedianExcessMove90d: 0.16,
      bestAnalogueIds: ['generic_analogue_a', 'generic_analogue_b'],
      topScores: [
        { analogueId: 'generic_analogue_a', peerBasket: ['CCC', 'DDD'], marketOutcome: { return90dExcess: 0.14 } },
        { analogueId: 'generic_analogue_b', peerBasket: ['EEE'], marketOutcome: { return90dExcess: 0.18 } },
      ],
    }), 'utf8');
    await writeFile(path.join(runtimeRoot, 'local-market-price-context.latest.json'), JSON.stringify({
      version: 'trusted-local-market-price-context-v1',
      rows: ['AAA', 'BBB'].map((issuer) => ({
        issuer,
        sourceProvenance: 'trusted_local_market_cache',
        asOfDate: '2026-05-24',
        localPriceWindow: {
          return90d: 0.03,
          excessVsBenchmark90d: 0.01,
          excessVsPeerBasket90d: 0.02,
          realizedVol60d: 0.18,
        },
      })),
    }), 'utf8');

    const result = await runAutonomousAutomationCycle({
      runtimeRoot,
      apply: true,
      writeArtifacts: true,
      limit: 5,
      executeStagedProviderLive: false,
    });

    assert.equal(result.valuationContextRequirementExecutor.taskCount, 2);
    assert.equal(result.valuationContextRequirementExecutor.valuationContextRowsCreated, 2);
    assert.equal(result.valuationContextAutoLinker.contextRows.length, 2);
    assert.equal(result.valuationExpectationBridge.valuationBridgeStatus, 'valuation_bridge_caveated');
    assert.equal(result.evidenceGateConsolidation.stagedForOperatorReview, true);
    assert.equal(result.reportCandidateStaging.stagingStatus, 'staged_for_operator_review');
    assert.equal(result.reportCandidateStaging.reportCandidateWriteAllowed, false);
    assert.equal(result.mutationBoundaries.readinessPromotionWrites, 0);
    assert.equal(result.mutationBoundaries.reportCandidateWrites, 0);

    const executorArtifact = JSON.parse(await readFile(path.join(runtimeRoot, 'valuation-context-requirement-executor.latest.json'), 'utf8'));
    assert.equal(executorArtifact.valuationContextRowsCreated, 2);
    const generatedCache = JSON.parse(await readFile(path.join(runtimeRoot, 'trusted-local-valuation-cache.autogenerated.latest.json'), 'utf8'));
    assert.equal(generatedCache.rows.length, 2);
    const consoleArtifact = JSON.parse(await readFile(path.join(runtimeRoot, 'automation-console.latest.json'), 'utf8'));
    assert.equal(consoleArtifact.valuationContextRequirementExecutor.valuationContextRowsCreated, 2);
    assert.equal(consoleArtifact.valuationContextRequirementExecutor.valuationContextSourceStatus, 'context_created');
  });
});

test('automation cycle builds valuation context from read-only market quotes and company fundamentals', async () => {
  await withTempRuntime(async (runtimeRoot) => {
    await writeFile(path.join(runtimeRoot, 'autonomous-research-repair-loop.latest.json'), JSON.stringify({
      runId: 'repair-loop-db-valuation-context-test',
      acceptedEvidenceAfter: 7,
      acceptedPromotionEvidenceAfter: 2,
      negativeControlAfter: 'CHECKED_NO_DIRECT',
      holdoutAfter: true,
      issuerBridgeAfter: 'closed',
      marketValidationAfter: 'controlled_ready',
      iterations: [
        {
          evidenceCountsAfter: {
            acceptedEvidenceCount: 7,
            acceptedPromotionEvidenceCount: 2,
            independentSourceBreadth: 5,
          },
          actionResult: {
            reportSubjectDryRun: {
              subjectId: 'dryrun-msd-child-db-valuation',
              subjectLabel: 'generic database valuation bottleneck',
              childSeedId: 'msd-child-db-valuation',
              bottleneckNode: 'generic database valuation bottleneck',
              bottleneckClass: 'technical_qualification',
              issuerUniverse: ['AAA', 'BBB'],
            },
          },
        },
      ],
    }), 'utf8');
    await writeFile(path.join(runtimeRoot, 'historical-analogue-bridge.latest.json'), JSON.stringify({
      version: 'historical-analogue-bridge-v1',
      reflectionStatus: 'comparison_ready',
      usableAnalogueCount: 2,
      analogueMedianExcessMove90d: 0.16,
      bestAnalogueIds: ['generic_analogue_a', 'generic_analogue_b'],
      topScores: [
        { analogueId: 'generic_analogue_a', peerBasket: ['CCC', 'DDD'], marketOutcome: { return90dExcess: 0.14 } },
        { analogueId: 'generic_analogue_b', peerBasket: ['EEE'], marketOutcome: { return90dExcess: 0.18 } },
      ],
    }), 'utf8');
    const quoteRows = [
      ...['AAA', 'BBB'].flatMap((symbol) => [
        { symbol, observed_at: '2026-02-25T00:00:00.000Z', last_price: 100 },
        { symbol, observed_at: '2026-04-25T00:00:00.000Z', last_price: 104 },
        { symbol, observed_at: '2026-05-25T00:00:00.000Z', last_price: 108 },
      ]),
      { symbol: 'SPY', observed_at: '2026-02-25T00:00:00.000Z', last_price: 500 },
      { symbol: 'SPY', observed_at: '2026-05-25T00:00:00.000Z', last_price: 520 },
      { symbol: 'CCC', observed_at: '2026-02-25T00:00:00.000Z', last_price: 40 },
      { symbol: 'CCC', observed_at: '2026-05-25T00:00:00.000Z', last_price: 42 },
      { symbol: 'DDD', observed_at: '2026-02-25T00:00:00.000Z', last_price: 30 },
      { symbol: 'DDD', observed_at: '2026-05-25T00:00:00.000Z', last_price: 31 },
    ];
    const fundamentalRows = ['AAA', 'BBB'].flatMap((symbol) => [
      { symbol, period_end: '2026-03-31', metric_name: 'forward PE', value_num: 18, source_type: 'trusted_local_fundamentals_cache', metadata: {}, created_at: '2026-05-01T00:00:00.000Z' },
      { symbol, period_end: '2026-03-31', metric_name: 'EV EBITDA', value_num: 14, source_type: 'trusted_local_fundamentals_cache', metadata: {}, created_at: '2026-05-01T00:00:00.000Z' },
      { symbol, period_end: '2026-03-31', metric_name: 'EV sales', value_num: 2.1, source_type: 'trusted_local_fundamentals_cache', metadata: {}, created_at: '2026-05-01T00:00:00.000Z' },
      { symbol, period_end: '2026-03-31', metric_name: 'market cap', value_num: 70000000000, source_type: 'trusted_local_fundamentals_cache', metadata: {}, created_at: '2026-05-01T00:00:00.000Z' },
      { symbol, period_end: '2026-03-31', metric_name: 'consensus revenue growth', value_num: 0.05, source_type: 'trusted_local_fundamentals_cache', metadata: {}, created_at: '2026-05-01T00:00:00.000Z' },
      { symbol, period_end: '2026-03-31', metric_name: 'consensus EPS growth', value_num: 0.07, source_type: 'trusted_local_fundamentals_cache', metadata: {}, created_at: '2026-05-01T00:00:00.000Z' },
      { symbol, period_end: '2026-03-31', metric_name: 'peer median forward PE', value_num: 19, source_type: 'trusted_local_fundamentals_cache', metadata: {}, created_at: '2026-05-01T00:00:00.000Z' },
      { symbol, period_end: '2026-03-31', metric_name: 'peer median EV EBITDA', value_num: 15, source_type: 'trusted_local_fundamentals_cache', metadata: {}, created_at: '2026-05-01T00:00:00.000Z' },
      { symbol, period_end: '2026-03-31', metric_name: 'peer relative discount', value_num: null, source_type: 'trusted_local_fundamentals_cache', metadata: { direction: '-0.04' }, created_at: '2026-05-01T00:00:00.000Z' },
    ]);
    const dbClient = {
      async query(sql) {
        if (/FROM market_quotes/i.test(sql)) return { rows: quoteRows };
        if (/FROM company_fundamentals/i.test(sql)) return { rows: fundamentalRows };
        return { rows: [] };
      },
    };

    const result = await runAutonomousAutomationCycle({
      runtimeRoot,
      apply: true,
      writeArtifacts: true,
      limit: 5,
      executeStagedProviderLive: false,
      dbClient,
    });

    assert.equal(result.valuationContextRequirementExecutor.valuationContextRowsCreated, 2);
    assert.equal(result.valuationContextRequirementExecutor.dbContextRead.marketQuoteRowCount, quoteRows.length);
    assert.equal(result.valuationContextRequirementExecutor.dbContextRead.companyFundamentalRowCount, fundamentalRows.length);
    assert.equal(result.valuationExpectationBridge.valuationBridgeStatus, 'valuation_bridge_closed');
    assert.equal(result.evidenceGateConsolidation.stagedForOperatorReview, true);
    assert.equal(result.reportCandidateStaging.stagingStatus, 'staged_for_operator_review');
    assert.equal(result.reportCandidateStaging.reportCandidateWriteAllowed, false);
    assert.equal(result.mutationBoundaries.readinessPromotionWrites, 0);
    assert.equal(result.mutationBoundaries.portfolioActionWrites, 0);

    const executorArtifact = JSON.parse(await readFile(path.join(runtimeRoot, 'valuation-context-requirement-executor.latest.json'), 'utf8'));
    assert.equal(executorArtifact.dbContextRead.status, 'context_rows_loaded');
    const consoleArtifact = JSON.parse(await readFile(path.join(runtimeRoot, 'automation-console.latest.json'), 'utf8'));
    assert.equal(consoleArtifact.valuationContextRequirementExecutor.nextExecutableGateAction, 're_evaluate_valuation_bridge');
  });
});
