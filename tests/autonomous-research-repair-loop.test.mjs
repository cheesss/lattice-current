import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  __test,
  chooseNextAllowedAction,
  classifyCurrentResearchBlocker,
  executeSelectedRepairAction,
  parseAutonomousResearchRepairLoopArgs,
  runLimitedHoldoutValidationExecutor,
  runLimitedNegativeControlExecutor,
  runAutonomousResearchRepairLoop,
} from '../scripts/run-autonomous-research-repair-loop.mjs';
import {
  buildThesisValidationMemoDryRun,
  validateThesisValidationMemoDryRun,
} from '../scripts/_shared/thesis-validation-memo-dry-run.mjs';
import {
  buildValuationExpectationBridgeDryRun,
  validateValuationExpectationBridgeDryRun,
} from '../scripts/_shared/valuation-expectation-bridge-dry-run.mjs';

function inputState(acquisition = {}) {
  return {
    acquisition,
    selectedSeed: acquisition.selectedChildSeed || null,
    evidenceBefore: __test.evidenceCountsFromArtifact(acquisition),
    readinessBefore: __test.readinessFromArtifact(acquisition),
    boundariesBefore: {
      providerActivationWrites: Number(acquisition.boundaries?.providerActivationWrites || 0),
    },
  };
}

function passedClosureAcquisition() {
  const closure = __test.runEvidenceContractClosureDryRunExecutor(inputState({
    acceptedEvidenceCount: 10,
    acceptedPromotionEvidenceCount: 3,
    independentSourceBreadth: 3,
    issuerBridgeStatus: 'closed',
    negativeControlStatus: 'CHECKED_NO_DIRECT',
    holdoutConfirmed: true,
    marketValidationStatus: 'controlled_ready',
    marketValidationDirection: 'directionally_supported',
    marketValidationWarnings: ['sanity_check_extreme_tstat'],
    marketValidationCaveats: [],
    marketValidationEventAnchorCount: 3,
    reportCandidateAllowedDiagnostic: true,
    trackBAcceptedIssuerEvidenceCount: 3,
    trackBAcceptedPromotionEvidenceCount: 3,
    trackBAcceptedHoldoutEvidenceCount: 2,
    trackBAcceptedNegativeControlEvidenceCount: 3,
    trackBNegativeControlEvidenceIds: ['nc1', 'nc2', 'nc3'],
    trackBNegativeSourceGroupsUsed: ['official_company_ir', 'utility_planning'],
    trackBHoldoutSourceGroups: ['utility_capex_plan', 'official_grid_operator_planning'],
    trackBHoldoutEvidenceIds: ['h1', 'h2'],
    marketValidationEvidenceIds: ['market1'],
    splitTrackResults: [{
      track: 'mechanism_validation_track',
      acceptedEvidenceIds: ['m1', 'm2', 'm3'],
      sourceGroupsUsed: ['official_research_dataset', 'official_government', 'official_grid_operator'],
    }, {
      track: 'issuer_bridge_track',
      acceptedEvidenceIds: ['i1', 'i2', 'i3'],
      sourceGroupsUsed: ['official_filing', 'official_company_ir', 'earnings_transcript'],
    }],
    selectedChildSeed: {
      parentSeedId: 'positive-path-ai-grid-interconnection',
      childSeedId: 'msd-child-e19040c0',
    },
    splitTracks: {
      issuerBridgeTrack: {
        seed: { issuerCandidates: ['PWR', 'ACM', 'J'] },
      },
    },
  }));
  return {
    acceptedEvidenceCount: 10,
    acceptedPromotionEvidenceCount: 3,
    independentSourceBreadth: 3,
    issuerBridgeStatus: 'closed',
    negativeControlStatus: 'CHECKED_NO_DIRECT',
    holdoutConfirmed: true,
    marketValidationStatus: 'controlled_ready',
    reportCandidateAllowedDiagnostic: true,
    visualStatus: 'pending',
    finalBlocker: 'thesis_validation_memo_dry_run_required',
    evidenceContractClosureDryRun: true,
    evidenceContractClosureStatus: closure.closureStatus,
    evidenceContractMatrix: closure.evidenceContractMatrix,
    evidenceContractMatrixSummary: closure.evidenceContractMatrixSummary,
    dryRunReportSubject: closure.dryRunReportSubject,
    reportSubjectDryRun: closure.reportSubjectDryRun,
    closureCaveats: closure.caveats,
    closureContradictionWarnings: closure.contradictionWarnings,
  };
}

async function loadFixture(name) {
  return JSON.parse(await readFile(path.resolve('tests/fixtures', name), 'utf8'));
}

test('repair loop args keep provider activation and readiness promotion disabled', () => {
  const args = parseAutonomousResearchRepairLoopArgs([
    '--max-iterations',
    '12',
    '--max-files-changed',
    '3',
    '--max-seeds',
    '5',
    '--mode',
    'apply',
    '--allow-provider-activation',
    'true',
    '--allow-readiness-promotion',
    'true',
  ]);
  assert.equal(args.mode, 'apply');
  assert.equal(args.maxIterations, 12);
  assert.equal(args.maxFilesChanged, 3);
  assert.equal(args.maxSeeds, 5);
  assert.equal(args.allowProviderActivation, false);
  assert.equal(args.allowReadinessPromotion, false);
});

test('default mode is plan and dry-run aliases plan', () => {
  const defaults = parseAutonomousResearchRepairLoopArgs([]);
  assert.equal(defaults.mode, 'plan');
  assert.equal(defaults.maxIterations, 5);
  assert.equal(defaults.maxFilesChanged, 10);
  assert.equal(defaults.maxTracks, 1);
  assert.equal(defaults.stopOnTestFailure, true);
  assert.equal(defaults.stopAfterAction, true);
  assert.equal(defaults.continueSafe, false);
  assert.equal(defaults.allowReportCandidateWrite, false);
  assert.equal(parseAutonomousResearchRepairLoopArgs(['--dry-run']).mode, 'plan');
  const executeSafe = parseAutonomousResearchRepairLoopArgs(['--mode', 'execute-safe']);
  assert.equal(executeSafe.mode, 'execute-safe');
  assert.equal(executeSafe.stopAfterAction, false);
  assert.equal(executeSafe.continueSafe, true);
});

test('provider_blocked produces provider proposal and stops without activation', async () => {
  const result = await runAutonomousResearchRepairLoop({
    maxIterations: 3,
    inputState: inputState({
      blockType: 'provider_blocked',
      providerGapRequired: ['taiwan_mops', 'edinet'],
      selectedChildSeed: {
        childSeedId: 'msd-child-abf',
        bottleneckNode: 'ABF substrate capacity',
        requiredEvidenceClasses: ['issuer_exposure', 'holdout_validation'],
      },
      acceptedEvidenceCount: 0,
      gateResult: { gate: 'blocked', blockers: ['accepted_evidence_missing'] },
      visualStatus: 'pending',
      boundaries: { providerActivationWrites: 0 },
    }),
    writeArtifact: false,
  });
  assert.equal(result.iterationCount, 1);
  assert.equal(result.selectedAction, 'create_provider_gap_proposal');
  assert.equal(result.stopReason, 'operator_review_required_provider_gap');
  assert.equal(result.readinessAfter.reportCandidateAllowed, false);
  assert.equal(result.boundaries.providerActivationWrites, 0);
  const proposals = result.iterations[0].actionResult.proposals;
  assert.equal(proposals.length, 2);
  for (const proposal of proposals) {
    for (const field of __test.REQUIRED_PROVIDER_PROPOSAL_FIELDS) {
      assert.notEqual(proposal[field], undefined, `${field} missing from provider proposal`);
    }
    assert.equal(proposal.reviewGatedActivation, true);
    assert.equal(proposal.activationAllowed, false);
  }
});

test('route_mismatch without split tracks selects split-track action', async () => {
  const result = await runAutonomousResearchRepairLoop({
    maxIterations: 2,
    inputState: inputState({
      blockType: 'mechanism_issuer_route_mismatch',
      routeMismatchDetected: true,
      selectedChildSeed: {
        childSeedId: 'msd-child-grid',
        bottleneckNode: 'interconnection study capacity',
        childClass: 'engineering_process',
        issuerCandidates: ['PWR', 'ACM', 'J'],
      },
      acceptedEvidenceCount: 0,
      gateResult: { gate: 'blocked', blockers: ['accepted_evidence_missing'] },
      visualStatus: 'pending',
    }),
    writeArtifact: false,
  });
  assert.equal(result.iterationCount, 1);
  assert.equal(result.selectedAction, 'split_mechanism_and_issuer_tracks');
  assert.equal(result.stopReason, 'route_mismatch_split_created_or_confirmed');
  assert.equal(result.iterations[0].actionResult.splitTracks.mechanismValidationTrack.seed.bottleneckNode, 'interconnection study capacity');
  assert.equal(result.iterations[0].actionResult.splitTracks.issuerBridgeTrack.seed.bottleneckNode, 'transmission and substation EPC backlog');
  assert.equal(result.readinessAfter.reportCandidateAllowed, false);
});

test('execute-safe prioritizes split then Track A mechanism before downstream gates', async () => {
  const result = await runAutonomousResearchRepairLoop({
    mode: 'execute-safe',
    maxIterations: 5,
    maxQueries: 2,
    inputState: inputState({
      blockType: 'mechanism_issuer_route_mismatch',
      routeMismatchDetected: true,
      selectedChildSeed: {
        childSeedId: 'msd-child-grid',
        bottleneckNode: 'interconnection study capacity',
        childClass: 'engineering_process',
        issuerCandidates: ['PWR', 'ACM', 'J'],
      },
      acceptedEvidenceCount: 0,
      gateResult: { gate: 'blocked', blockers: ['accepted_evidence_missing', 'negative_control_not_closed'] },
      visualStatus: 'pending',
    }),
    writeArtifact: false,
  });
  assert.equal(result.iterationCount, 5);
  assert.deepEqual(result.iterations.map((item) => item.selectedAction), [
    'split_mechanism_and_issuer_tracks',
    'run_limited_grid_mechanism_validation',
    'run_limited_issuer_bridge_track',
    'run_limited_negative_control',
    'run_limited_holdout_validation',
  ]);
  assert.equal(result.iterations[0].trackLevelBlocker, 'route_mismatch_unresolved');
  assert.equal(result.iterations[1].trackLevelBlocker, 'track_a_mechanism_evidence_missing');
  assert.equal(result.iterations[2].trackLevelBlocker, 'track_b_issuer_bridge_missing');
  assert.equal(result.iterations[1].weakProgress, true);
  assert.equal(result.iterations[1].strongProgress, true);
  assert.equal(result.iterations[2].strongProgress, true);
  assert.equal(result.iterations[2].actionResult.acceptedPromotionEvidenceCount, 2);
  assert.equal(result.iterations[3].strongProgress, true);
  assert.equal(result.iterations[3].actionResult.negativeControlStatus, 'CHECKED_NO_DIRECT');
  assert.equal(result.iterations[3].nextRecommendedAction, 'run_limited_holdout_validation');
  assert.equal(result.iterations[4].strongProgress, true);
  assert.equal(result.iterations[4].actionResult.holdoutStatus, 'CONFIRMED');
  assert.equal(result.iterations[4].nextRecommendedAction, 'run_limited_controlled_market_validation');
  assert.equal(result.stopReason, 'max_iterations_reached');
  assert.equal(result.reportCandidateAllowedAfter, false);
  assert.equal(result.boundaries.providerActivationWrites, 0);
  assert.equal(result.boundaries.reportCandidateWrites, 0);
  assert.ok(result.iterations.every((item) => item.mutationBoundaries.providerActivationWrites === 0));
});

test('negative-control INCONCLUSIVE does not preempt Track A or Track B priority', async () => {
  const result = await runAutonomousResearchRepairLoop({
    mode: 'execute-safe',
    maxIterations: 2,
    maxQueries: 1,
    inputState: inputState({
      blockType: 'mechanism_issuer_route_mismatch',
      routeMismatchDetected: true,
      negativeControlStatus: 'INCONCLUSIVE',
      splitTracks: {
        mechanismValidationTrack: {
          finalBlocker: 'track_a_mechanism_validation_missing',
          seed: { seedId: 'track-a-seed', bottleneckNode: 'interconnection study capacity' },
        },
        issuerBridgeTrack: {
          finalBlocker: 'negative_control_not_closed',
          negativeControlStatus: 'INCONCLUSIVE',
          seed: { seedId: 'track-b-seed', bottleneckNode: 'transmission and substation EPC backlog' },
        },
      },
      gateResult: { gate: 'blocked', blockers: ['negative_control_not_closed', 'accepted_evidence_missing'] },
      visualStatus: 'pending',
    }),
    gridMechanismRawEvidence: [{
      evidenceId: 'grid-official-accepted',
      sourceGroup: 'official_research_dataset',
      sourceUrl: 'https://example.test/lbnl',
      title: 'Interconnection queue study delay and backlog dataset',
      extractedTextSnippet: 'Interconnection queue study delay increased queue duration and processing capacity bottlenecks.',
      acceptanceVerdict: 'accepted',
    }],
    writeArtifact: false,
  });
  assert.equal(result.iterations[0].selectedAction, 'run_limited_grid_mechanism_validation');
  assert.equal(result.iterations[1].selectedAction, 'run_limited_issuer_bridge_track');
  assert.equal(result.reportCandidateAllowedAfter, false);
});

test('already split route mismatch selects the next bounded negative-control lane', () => {
  const state = inputState({
    blockType: 'mechanism_issuer_route_mismatch',
    routeMismatchDetected: true,
    splitTracks: {
      mechanismValidationTrack: {
        acceptedEvidenceCount: 1,
      },
      issuerBridgeTrack: {
        finalBlocker: 'negative_control_not_closed',
        acceptedEvidenceCount: 1,
      },
    },
    acceptedEvidenceCountByTrack: {
      mechanism_validation_track: 1,
      issuer_bridge_track: 1,
    },
    issuerBridgeStatus: 'partial',
    acceptedEvidenceCount: 0,
    gateResult: { gate: 'blocked', blockers: ['negative_control_not_closed'] },
    visualStatus: 'pending',
  });
  const classification = classifyCurrentResearchBlocker(state);
  const action = chooseNextAllowedAction(classification, state);
  const executed = executeSelectedRepairAction(action, state);
  assert.equal(action.action, 'run_limited_negative_control');
  assert.equal(executed.executionDeferred, true);
  assert.equal(executed.task.evidenceClass, 'negative_control');
  assert.equal(executed.providerActivationWrites, 0);
  assert.equal(executed.reportCandidateAllowed, false);
});

test('split route mismatch uses track-level blocker instead of top-level route_mismatch', () => {
  const state = inputState({
    blockType: 'mechanism_issuer_route_mismatch',
    routeMismatchDetected: true,
    splitTracks: {
      mechanismValidationTrack: {
        finalBlocker: 'track_a_mechanism_validation_missing',
        seed: { seedId: 'track-a-seed', bottleneckNode: 'interconnection study capacity' },
      },
      issuerBridgeTrack: {
        finalBlocker: 'holdout_missing',
        seed: { seedId: 'track-b-seed', bottleneckNode: 'transmission and substation EPC backlog' },
      },
    },
    gateResult: { gate: 'blocked', blockers: ['holdout_missing', 'market_validation_missing'] },
    visualStatus: 'pending',
  });
  const classification = classifyCurrentResearchBlocker(state);
  const action = chooseNextAllowedAction(classification, state);
  assert.equal(classification.primaryBlocker, 'track_a_mechanism_evidence_missing');
  assert.equal(classification.topLevelBlocker, 'mechanism_issuer_route_mismatch');
  assert.equal(classification.trackLevelBlocker, 'track_a_mechanism_evidence_missing');
  assert.equal(action.action, 'run_limited_grid_mechanism_validation');
  assert.equal(action.actionPriorityRank, 2);
});

test('Track B issuer bridge missing runs before market validation', () => {
  const state = inputState({
    blockType: 'mechanism_issuer_route_mismatch',
    routeMismatchDetected: true,
    splitTracks: {
      mechanismValidationTrack: { acceptedEvidenceCount: 1 },
      issuerBridgeTrack: { finalBlocker: 'market_validation_missing' },
    },
    acceptedEvidenceCountByTrack: {
      mechanism_validation_track: 1,
    },
    gateResult: { gate: 'blocked', blockers: ['market_validation_missing'] },
    visualStatus: 'pending',
  });
  const classification = classifyCurrentResearchBlocker(state);
  const action = chooseNextAllowedAction(classification, state);
  assert.equal(classification.primaryBlocker, 'track_b_issuer_bridge_missing');
  assert.equal(action.action, 'run_limited_issuer_bridge_track');
  assert.equal(action.actionPriorityRank, 3);
});

test('market validation is gated when accepted evidence is zero', () => {
  const state = inputState({
    acceptedEvidenceCount: 0,
    acceptedPromotionEvidenceCount: 0,
    issuerBridgeStatus: 'closed',
    negativeControlStatus: 'CHECKED_NO_DIRECT',
    holdoutConfirmed: true,
    gateResult: { gate: 'blocked', blockers: ['market_validation_missing'] },
    visualStatus: 'pending',
  });
  const classification = classifyCurrentResearchBlocker(state);
  const action = chooseNextAllowedAction(classification, state);
  assert.equal(classification.primaryBlocker, 'market_validation_missing');
  assert.equal(action.action, 'generate_next_operator_review_task');
  assert.match(action.actionSkippedReasons.join(' '), /accepted evidence is required/i);
  assert.equal(action.whyMarketValidationAllowed.allowed, false);
});

test('repair loop uses provider quality feedback to avoid repeating weak providers', () => {
  const state = {
    ...inputState({
      acceptedEvidenceCount: 0,
      acceptedPromotionEvidenceCount: 0,
      gateResult: { gate: 'blocked', blockers: ['accepted_evidence_missing'] },
      visualStatus: 'pending',
    }),
    providerQualityFeedback: {
      summary: { repeatedFailureProviderCount: 1, collectorRequirementCount: 0 },
      recommendedRemediationAction: 'create_fixture_requirement',
      repeatedFailureProviders: [
        { providerName: 'company_ir_direct_pdf', evidenceClass: 'issuer_exposure' },
      ],
    },
  };
  const classification = classifyCurrentResearchBlocker(state);
  const action = chooseNextAllowedAction(classification, state);
  assert.equal(classification.blockers.includes('weak_evidence_only'), true);
  assert.equal(classification.providerQualityRecommendedAction, 'create_fixture_requirement');
  assert.equal(action.action, 'create_fixture_requirement');
  assert.equal(action.actionSkippedReasons.includes('accepted_evidence_missing_without_track_specific_action'), true);
});

test('repair loop turns repeated unavailable provider feedback into quarantine task', () => {
  const state = {
    ...inputState({
      acceptedEvidenceCount: 1,
      acceptedPromotionEvidenceCount: 1,
      independentSourceBreadth: 2,
      issuerBridgeStatus: 'closed',
      negativeControlStatus: 'CHECKED_NO_DIRECT',
      holdoutConfirmed: true,
      marketValidationStatus: 'controlled_ready',
      gateResult: { gate: 'blocked', blockers: [] },
      visualStatus: 'pending',
    }),
    providerQualityFeedback: {
      summary: { repeatedFailureProviderCount: 1, collectorRequirementCount: 0 },
      recommendedRemediationAction: 'quarantine_source_or_provider',
      repeatedFailureProviders: [
        { providerName: 'grid_official_readonly', evidenceClass: 'mechanism_validation' },
      ],
    },
  };
  const classification = classifyCurrentResearchBlocker(state);
  const action = chooseNextAllowedAction(classification, state);
  assert.equal(classification.blockers.includes('source_unavailable'), true);
  assert.equal(action.action, 'quarantine_source_or_provider');
  const executed = executeSelectedRepairAction(action, state, { mode: 'execute-safe' });
  assert.equal(executed.executionDeferred, true);
  assert.equal(executed.providerActivationWrites, 0);
});

test('repair loop exposes source diversity quota and underrepresented class feedback', () => {
  const state = {
    ...inputState({
      acceptedEvidenceCount: 0,
      acceptedPromotionEvidenceCount: 0,
      gateResult: { gate: 'blocked', blockers: ['accepted_evidence_missing'] },
      visualStatus: 'pending',
    }),
    sourceDiversityFeedback: {
      sourceBucketQuotaWarnings: [{ warning: 'generated_artifact_bucket_over_quota' }],
      underrepresentedEvidenceClasses: [{ evidenceClass: 'material_input' }],
      recommendedNextAction: 'create_targeted_backfill_task',
    },
  };
  const classification = classifyCurrentResearchBlocker(state);
  assert.equal(classification.blockers.includes('source_bucket_quota_violation'), true);
  assert.equal(classification.blockers.includes('underrepresented_evidence_class_missing'), true);
  assert.equal(classification.sourceDiversityRecommendedAction, 'create_targeted_backfill_task');
});

test('same action without progress stops instead of repeating', async () => {
  const result = await runAutonomousResearchRepairLoop({
    mode: 'execute-safe',
    maxIterations: 3,
    inputState: inputState({
      acceptedEvidenceCount: 0,
      rawEvidenceCount: 5,
      gateResult: { gate: 'blocked', blockers: ['accepted_evidence_missing'] },
      visualStatus: 'pending',
      finalBlocker: 'accepted_evidence_missing',
    }),
    writeArtifact: false,
  });
  assert.equal(result.iterationCount, 1);
  assert.equal(result.selectedAction, 'create_fixture_requirement');
  assert.equal(result.iterations[0].progressMade, false);
  assert.equal(result.stopReason, 'bounded_action_selected_requires_explicit_execution');
  assert.equal(result.readinessAfter.reportCandidateAllowed, false);
});

test('plan mode selects negative-control action but does not execute it', async () => {
  const result = await runAutonomousResearchRepairLoop({
    mode: 'plan',
    inputState: inputState({
      blockType: 'mechanism_issuer_route_mismatch',
      routeMismatchDetected: true,
      splitTracks: {
        mechanismValidationTrack: { acceptedEvidenceCount: 1 },
        issuerBridgeTrack: { finalBlocker: 'negative_control_not_closed', acceptedEvidenceCount: 1 },
      },
      acceptedEvidenceCountByTrack: {
        mechanism_validation_track: 1,
        issuer_bridge_track: 1,
      },
      issuerBridgeStatus: 'partial',
      gateResult: { gate: 'blocked', blockers: ['negative_control_not_closed'] },
      visualStatus: 'pending',
    }),
    writeArtifact: false,
  });
  assert.equal(result.selectedAction, 'run_limited_negative_control');
  assert.equal(result.iterations[0].actionResult.executionDeferred, true);
  assert.equal(result.iterations[0].actionResult.rawEvidence, undefined);
  assert.equal(result.stopReason, 'bounded_action_selected_requires_explicit_execution');
});

test('execute-safe mode runs bounded Track B negative-control and closes with sufficient official scope', async () => {
  const result = await runAutonomousResearchRepairLoop({
    mode: 'execute-safe',
    continueSafe: true,
    stopAfterAction: false,
    maxIterations: 2,
    maxQueries: 3,
    inputState: inputState({
      seedId: 'repair-seed',
      blockType: 'mechanism_issuer_route_mismatch',
      routeMismatchDetected: true,
      splitTracks: {
        mechanismValidationTrack: {
          acceptedEvidenceCount: 1,
        },
        issuerBridgeTrack: {
          finalBlocker: 'negative_control_not_closed',
          acceptedEvidenceCount: 1,
          seed: {
            seedId: 'track-b-seed',
            bottleneckNode: 'transmission and substation EPC backlog',
            negativeControlQueries: ['backlog declining', 'utility capex slowdown', 'management denies constraint', 'competition rising'],
          },
        },
      },
      acceptedEvidenceCountByTrack: {
        mechanism_validation_track: 1,
        issuer_bridge_track: 1,
      },
      issuerBridgeStatus: 'partial',
      splitTrackResults: [{
        track: 'issuer_bridge_track',
        seedId: 'track-b-seed',
        acceptedEvidenceCount: 1,
        negativeControlStatus: 'INCONCLUSIVE',
      }],
      gateResult: { gate: 'blocked', blockers: ['negative_control_not_closed'] },
      visualStatus: 'pending',
    }),
    writeArtifact: false,
  });
  const action = result.iterations[0].actionResult;
  assert.equal(result.selectedAction, 'run_limited_negative_control');
  assert.equal(action.executed, true);
  assert.equal(action.evidenceClass, 'negative_control');
  assert.equal(action.queryFamilies.length, 3);
  assert.equal(action.rawEvidenceIds.length, 3);
  assert.equal(action.acceptedEvidenceIds.length, 3);
  assert.equal(action.negativeControlStatus, 'CHECKED_NO_DIRECT');
  assert.equal(action.negativeControlScope, 'sufficient');
  assert.equal(action.checkedIssuerCount, 3);
  assert.equal(action.checkedSourceGroupCount, 3);
  assert.ok(action.checkedQueryFamilyCount >= 4);
  assert.equal(result.readinessAfter.reportCandidateAllowed, false);
  assert.equal(result.iterations[0].nextRecommendedAction, 'run_limited_holdout_validation');
  assert.equal(result.boundaries.providerActivationWrites, 0);
  assert.equal(result.boundaries.canonicalWrites, 0);
  assert.equal(result.boundaries.sourceRegistryWrites, 0);
  assert.equal(result.boundaries.reportCandidateWrites, 0);
});

test('Track B holdout confirmed moves next action to controlled market validation without opening report candidate', async () => {
  const state = inputState({
    seedId: 'repair-seed',
    blockType: 'mechanism_issuer_route_mismatch',
    routeMismatchDetected: true,
    splitTracks: {
      mechanismValidationTrack: { acceptedEvidenceCount: 1 },
      issuerBridgeTrack: {
        finalBlocker: 'holdout_missing',
        acceptedEvidenceCount: 1,
        seed: { seedId: 'track-b-seed', bottleneckNode: 'transmission and substation EPC backlog' },
      },
    },
    acceptedEvidenceCountByTrack: {
      mechanism_validation_track: 1,
      issuer_bridge_track: 1,
    },
    acceptedEvidenceCount: 6,
    acceptedPromotionEvidenceCount: 3,
    independentSourceBreadth: 3,
    issuerBridgeStatus: 'closed',
    negativeControlStatus: 'CHECKED_NO_DIRECT',
    holdoutConfirmed: false,
    gateResult: { gate: 'blocked', blockers: ['holdout_missing', 'market_validation_missing'] },
    visualStatus: 'pending',
  });
  const action = runLimitedHoldoutValidationExecutor(state, { maxQueries: 6 });
  assert.equal(action.holdoutStatus, 'CONFIRMED');
  assert.equal(action.holdoutConfirmed, true);
  assert.ok(action.acceptedEvidenceIds.length >= 1);
  assert.equal(action.gateImpact.reportCandidateAllowed, false);
  assert.equal(action.gateImpact.finalBlocker, 'market_validation_missing');
  assert.equal(action.boundaries.providerActivationWrites, 0);

  const result = await runAutonomousResearchRepairLoop({
    mode: 'execute-safe',
    continueSafe: true,
    stopAfterAction: false,
    maxIterations: 1,
    maxQueries: 6,
    inputState: state,
    writeArtifact: false,
  });
  assert.equal(result.selectedAction, 'run_limited_holdout_validation');
  assert.equal(result.iterations[0].actionResult.holdoutStatus, 'CONFIRMED');
  assert.equal(result.iterations[0].nextRecommendedAction, 'run_limited_controlled_market_validation');
  assert.equal(result.reportCandidateAllowedAfter, false);
  assert.equal(result.boundaries.reportCandidateWrites, 0);
});

test('negative-control inconclusive after accepted evidence first replans to issuer bridge when source breadth is low', async () => {
  const result = await runAutonomousResearchRepairLoop({
    mode: 'execute-safe',
    continueSafe: true,
    stopAfterAction: false,
    maxIterations: 1,
    inputState: inputState({
      selectedChildSeed: {
        childSeedId: 'defense-child',
        bottleneckNode: 'rocket motor casing composite capacity',
        issuerCandidates: ['NOC', 'LHX'],
      },
      acceptedEvidenceCount: 1,
      acceptedPromotionEvidenceCount: 1,
      independentSourceBreadth: 1,
      issuerBridgeStatus: 'attached',
      negativeControlStatus: 'INCONCLUSIVE',
      negativeControlCollectorVersion: 'generic-negative-control-bounded-raw',
      holdoutConfirmed: false,
      repairLoopState: {
        negativeControlAttempted: true,
      },
      gateResult: { gate: 'blocked', blockers: ['negative_control_not_closed', 'holdout_missing'] },
      visualStatus: 'pending',
    }),
    writeArtifact: false,
  });
  assert.equal(result.selectedAction, 'run_limited_issuer_bridge_track');
  assert.equal(result.iterations[0].actionSkippedReasons.includes('independent_source_breadth_missing'), true);
  assert.equal(result.reportCandidateAllowedAfter, false);
  assert.equal(result.boundaries.providerActivationWrites, 0);
  assert.equal(result.boundaries.reportCandidateWrites, 0);
});

test('negative-control inconclusive after accepted evidence replans to holdout when source breadth is sufficient', async () => {
  const result = await runAutonomousResearchRepairLoop({
    mode: 'execute-safe',
    continueSafe: true,
    stopAfterAction: false,
    maxIterations: 1,
    inputState: inputState({
      selectedChildSeed: {
        childSeedId: 'defense-child',
        bottleneckNode: 'rocket motor casing composite capacity',
        issuerCandidates: ['NOC', 'LHX'],
      },
      acceptedEvidenceCount: 2,
      acceptedPromotionEvidenceCount: 2,
      independentSourceBreadth: 2,
      issuerBridgeStatus: 'closed',
      negativeControlStatus: 'INCONCLUSIVE',
      negativeControlCollectorVersion: 'generic-negative-control-bounded-raw',
      holdoutConfirmed: false,
      repairLoopState: {
        negativeControlAttempted: true,
      },
      gateResult: { gate: 'blocked', blockers: ['negative_control_not_closed', 'holdout_missing'] },
      visualStatus: 'pending',
    }),
    writeArtifact: false,
  });
  assert.equal(result.selectedAction, 'run_limited_holdout_validation');
  assert.equal(result.iterations[0].actionSkippedReasons.includes('negative_control_inconclusive_already_attempted'), true);
  assert.equal(result.reportCandidateAllowedAfter, false);
  assert.equal(result.boundaries.providerActivationWrites, 0);
  assert.equal(result.boundaries.reportCandidateWrites, 0);
});

test('execute-safe blocks unsafe actions and asks for operator review', () => {
  const blocked = executeSelectedRepairAction({ action: 'activate_provider_without_review' }, inputState({}), {
    mode: 'execute-safe',
  });
  assert.equal(blocked.unsafeActionBlocked, true);
  assert.equal(blocked.providerActivationWrites, 0);
  assert.equal(blocked.boundaries.providerActivationWrites, 0);
});

test('broad known narrative becomes child decomposition / positive path selection only', async () => {
  const result = await runAutonomousResearchRepairLoop({
    inputState: inputState({
      selectedChildSeed: {
        childSeedId: 'known-parent',
        bottleneckNode: 'AI power demand',
        scores: { knownNarrativeScore: 0.9 },
      },
      acceptedEvidenceCount: 0,
      gateResult: { gate: 'blocked', blockers: ['accepted_evidence_missing'] },
      visualStatus: 'pending',
    }),
    writeArtifact: false,
  });
  assert.equal(result.selectedAction, 'select_positive_path_seed');
  assert.equal(result.readinessAfter.reportCandidateAllowed, false);
});

test('limited-scope checked-no-direct negative control does not open report candidate gate', () => {
  const result = runLimitedNegativeControlExecutor(inputState({
    selectedChildSeed: { childSeedId: 'limited-seed', negativeControlQueries: ['no direct invalidator'] },
    gateResult: { gate: 'blocked', blockers: ['negative_control_not_closed'] },
    visualStatus: 'pending',
  }), {
    negativeControlRawEvidence: [{
      evidenceId: 'nc-limited',
      seedId: 'limited-seed',
      evidenceClass: 'negative_control',
      source: 'official-negative-control',
      sourceGroup: 'official_negative_control',
      query: 'no direct invalidator',
      accepted: true,
      acceptanceVerdict: 'accepted',
      evidenceUse: 'negative_control_candidate',
      negativeControlFinding: 'checked_no_direct_limited_scope',
      summary: 'CHECKED_NO_DIRECT_LIMITED_SCOPE: no direct invalidator in limited official scope.',
    }],
    maxQueries: 1,
  });
  assert.equal(result.negativeControlStatus, 'CHECKED_NO_DIRECT_LIMITED_SCOPE');
  assert.equal(result.negativeControlScope, 'limited');
  assert.equal(result.acceptedEvidenceIds.length, 1);
  assert.equal(result.gateImpact.reportCandidateAllowed, false);
  assert.equal(result.gateImpact.finalBlocker, 'negative_control_limited_scope');
});

test('negative-control invalidators create downgrade or reject candidates without promotion', () => {
  const weakened = runLimitedNegativeControlExecutor(inputState({
    selectedChildSeed: { childSeedId: 'weak-seed', negativeControlQueries: ['oversupply'] },
    gateResult: { gate: 'blocked', blockers: ['negative_control_not_closed'] },
    visualStatus: 'pending',
  }), {
    negativeControlRawEvidence: [{
      evidenceId: 'nc-raw-invalidator',
      seedId: 'weak-seed',
      evidenceClass: 'negative_control',
      source: 'trade-negative-control',
      query: 'oversupply',
      summary: 'Oversupply and no bottleneck language appeared, but row is not accepted yet.',
      accepted: false,
    }],
    maxQueries: 1,
  });
  assert.equal(weakened.negativeControlStatus, 'WEAKENED');
  assert.equal(weakened.gateImpact.downgradeCandidate, true);
  assert.equal(weakened.gateImpact.reportCandidateAllowed, false);

  const rejected = runLimitedNegativeControlExecutor(inputState({
    selectedChildSeed: { childSeedId: 'reject-seed', negativeControlQueries: ['management denies constraint'] },
    gateResult: { gate: 'blocked', blockers: ['negative_control_not_closed'] },
    visualStatus: 'pending',
  }), {
    negativeControlRawEvidence: [{
      evidenceId: 'nc-accepted-invalidator',
      seedId: 'reject-seed',
      evidenceClass: 'negative_control',
      source: 'official-negative-control',
      query: 'management denies constraint',
      summary: 'Accepted invalidator: management denies bottleneck and says no capacity constraint.',
      accepted: true,
      acceptanceVerdict: 'accepted',
      evidenceUse: 'negative_control_candidate',
      negativeControlFinding: 'invalidator',
    }],
    maxQueries: 1,
  });
  assert.equal(rejected.negativeControlStatus, 'REJECTED');
  assert.equal(rejected.gateImpact.finalBlocker, 'negative_control_rejected');
  assert.equal(rejected.acceptedEvidence.every((row) => row.promotionEligible === false), true);
});

test('accepted evidence zero keeps report candidate blocked', async () => {
  const result = await runAutonomousResearchRepairLoop({
    inputState: inputState({
      acceptedEvidenceCount: 0,
      rawEvidenceCount: 12,
      gateResult: { gate: 'blocked', blockers: ['accepted_evidence_missing'] },
      visualStatus: 'pending',
      finalBlocker: 'accepted_evidence_missing',
    }),
    writeArtifact: false,
  });
  assert.equal(result.blockerBefore, 'accepted_evidence_missing');
  assert.equal(result.readinessAfter.reportCandidateAllowed, false);
  assert.notEqual(result.readinessAfter.visualStatus, 'review-ready');
});

test('no safe next action leads to operator review required', async () => {
  const result = await runAutonomousResearchRepairLoop({
    inputState: inputState({
      acceptedEvidenceCount: 2,
      gateResult: { gate: 'blocked', blockers: [] },
      visualStatus: 'pending',
    }),
    writeArtifact: false,
  });
  assert.equal(result.selectedAction, 'operator_review_required');
  assert.equal(result.stopReason, 'operator_review_required');
});

test('loop writes artifact with before after state and no mutation boundaries', async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'lattice-repair-loop-'));
  try {
    const result = await runAutonomousResearchRepairLoop({
      outputPath: path.join(tmp, 'autonomous-research-repair-loop.latest.json'),
      inputState: inputState({
        blockType: 'provider_blocked',
        providerGapRequired: ['company_ir_direct_pdf'],
        acceptedEvidenceCount: 0,
        gateResult: { gate: 'blocked', blockers: ['accepted_evidence_missing'] },
        visualStatus: 'pending',
      }),
    });
    const parsed = JSON.parse(await readFile(result.artifactPath, 'utf8'));
    assert.equal(parsed.iterationCount, 1);
    assert.equal(parsed.selectedAction, 'create_provider_gap_proposal');
    assert.equal(parsed.evidenceCountsBefore.acceptedEvidenceCount, 0);
    assert.equal(parsed.evidenceCountsAfter.readinessChanged, false);
    assert.equal(parsed.boundaries.providerActivationWrites, 0);
    assert.equal(parsed.boundaries.readinessPromotionWrites, 0);
    assert.equal(parsed.filesChanged.length, 0);
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});

test('loop does not run more than max iterations', async () => {
  const result = await runAutonomousResearchRepairLoop({
    maxIterations: 1,
    inputState: inputState({
      blockType: 'provider_blocked',
      providerGapRequired: ['edinet'],
      acceptedEvidenceCount: 0,
      gateResult: { gate: 'blocked', blockers: ['accepted_evidence_missing'] },
      visualStatus: 'pending',
    }),
    writeArtifact: false,
  });
  assert.equal(result.iterationCount, 1);
});

test('Track A grid mechanism evidence does not raise investment or report readiness', () => {
  const result = __test.runLimitedGridMechanismValidationExecutor(inputState({
    blockType: 'mechanism_issuer_route_mismatch',
    routeMismatchDetected: true,
    splitTracks: {
      mechanismValidationTrack: {
        seed: { seedId: 'track-a-seed', bottleneckNode: 'interconnection study capacity' },
      },
    },
    gateResult: { gate: 'blocked', blockers: ['issuer_bridge_missing'] },
    visualStatus: 'pending',
  }), {
    gridMechanismRawEvidence: [{
      evidenceId: 'grid-official-accepted',
      sourceGroup: 'official_research_dataset',
      sourceUrl: 'https://example.test/lbnl',
      title: 'Interconnection queue study delay and backlog dataset',
      extractedTextSnippet: 'Interconnection queue study delay increased queue duration and processing capacity bottlenecks.',
      acceptanceVerdict: 'accepted',
    }],
  });
  assert.equal(result.executed, true);
  assert.equal(result.acceptedEvidenceIds.length, 1);
  assert.equal(result.gateImpact.mechanismEvidenceAccepted, true);
  assert.equal(result.gateImpact.reportCandidateAllowed, false);
  assert.equal(result.gateImpact.finalBlocker, 'issuer_bridge_required_after_mechanism_validation');
  assert.equal(result.boundaries.readinessPromotionWrites, 0);
});

test('Track A accepts LBNL-style official grid evidence with bottleneck and operating bridge in body', () => {
  const result = __test.runLimitedGridMechanismValidationExecutor(inputState({
    splitTracks: {
      mechanismValidationTrack: {
        seed: { seedId: 'track-a-lbnl', bottleneckNode: 'interconnection study capacity' },
      },
    },
    visualStatus: 'pending',
  }), {
    gridMechanismRawEvidence: [{
      evidenceId: 'lbnl-style-positive',
      sourceGroup: 'official_research_dataset',
      sourceUrl: 'https://example.test/lbnl-queued-up',
      documentTitle: 'Queued Up interconnection queue dataset',
      extractedTextSnippet: 'The interconnection queue shows study backlog, queue duration, withdrawal rate, and backlog growth as a processing capacity bottleneck for projects seeking grid connection.',
      acceptanceVerdict: 'accepted',
    }],
  });
  assert.equal(result.acceptedEvidenceIds.length, 1);
  assert.equal(result.acceptedEvidence[0].evidenceClass, 'mechanism_validation');
  assert.equal(result.acceptedEvidence[0].promotionEligible, false);
  assert.deepEqual(result.sourceGroupsUsed, ['official_research_dataset']);
  assert.equal(result.gateImpact.reportCandidateAllowed, false);
});

test('Track A accepts ISO/RTO-style official grid operator evidence with study delay bridge', () => {
  const result = __test.runLimitedGridMechanismValidationExecutor(inputState({
    splitTracks: {
      mechanismValidationTrack: {
        seed: { seedId: 'track-a-iso', bottleneckNode: 'interconnection study capacity' },
      },
    },
    visualStatus: 'pending',
  }), {
    gridMechanismRawEvidence: [{
      evidenceId: 'iso-style-positive',
      sourceGroup: 'official_grid_operator',
      sourceUrl: 'https://example.test/iso-queue-report',
      documentTitle: 'ISO interconnection queue report',
      extractedTextSnippet: 'Interconnection study delay and network upgrade delay created processing delay and longer study timelines for queued generation and load projects.',
      acceptanceVerdict: 'accepted',
    }],
  });
  assert.equal(result.acceptedEvidenceIds.length, 1);
  assert.match(result.acceptedEvidence[0].acceptanceReason, /official_grid_source/);
  assert.equal(result.gateImpact.visualStatus, 'pending');
  assert.equal(result.gateImpact.reportCandidateAllowed, false);
});

test('Track A rejects generic electricity demand and title-only grid metadata', () => {
  const generic = __test.runLimitedGridMechanismValidationExecutor(inputState({
    splitTracks: {
      mechanismValidationTrack: {
        seed: { seedId: 'track-a-generic', bottleneckNode: 'interconnection study capacity' },
      },
    },
    visualStatus: 'pending',
  }), {
    gridMechanismRawEvidence: [{
      evidenceId: 'generic-power-demand',
      sourceGroup: 'official_research_dataset',
      documentTitle: 'Electricity demand is rising',
      extractedTextSnippet: 'Electricity demand is rising and data centers need more power. Interconnection is a topic for planners.',
      acceptanceVerdict: 'accepted',
    }, {
      evidenceId: 'title-only-grid',
      sourceGroup: 'official_government',
      documentTitle: 'FERC interconnection study backlog and processing delay',
      title: 'FERC interconnection study backlog and processing delay',
      extractedTextSnippet: '',
      acceptanceVerdict: 'accepted',
    }],
  });
  assert.equal(generic.acceptedEvidenceIds.length, 0);
  assert.match(generic.rawEvidence[0].rejectionReason, /generic_electricity_demand_only/);
  assert.match(generic.rawEvidence[1].rejectionReason, /body_snippet_missing/);
  assert.equal(generic.gateImpact.reportCandidateAllowed, false);
});

test('Track B generic infrastructure text is not accepted as issuer bridge evidence', () => {
  const result = __test.runLimitedIssuerBridgeTrackExecutor(inputState({
    splitTracks: {
      issuerBridgeTrack: {
        seed: { seedId: 'track-b-seed', bottleneckNode: 'transmission and substation EPC backlog' },
      },
    },
    gateResult: { gate: 'blocked', blockers: ['issuer_bridge_missing'] },
    visualStatus: 'pending',
  }), {
    issuerBridgeRawEvidence: [{
      evidenceId: 'issuer-generic',
      sourceGroup: 'official_company_ir',
      sourceUrl: 'https://example.test/ir',
      title: 'Company infrastructure overview',
      extractedTextSnippet: 'The company participates in infrastructure markets and has diversified operations.',
      acceptanceVerdict: 'accepted',
      genericInfrastructureDescription: true,
    }],
  });
  assert.equal(result.acceptedEvidenceIds.length, 0);
  assert.equal(result.issuerBridgeStatus, 'missing');
  assert.equal(result.gateImpact.reportCandidateAllowed, false);
});

test('Track B accepts PWR power delivery backlog official issuer fixture as promotion evidence', () => {
  const result = __test.runLimitedIssuerBridgeTrackExecutor(inputState({
    splitTracks: {
      issuerBridgeTrack: {
        seed: { seedId: 'track-b-pwr', bottleneckNode: 'transmission and substation EPC backlog' },
      },
    },
    gateResult: { gate: 'blocked', blockers: ['issuer_bridge_missing'] },
    visualStatus: 'pending',
  }), {
    issuerBridgeRawEvidence: [{
      evidenceId: 'pwr-official-filing',
      issuer: 'PWR',
      issuerRoleClass: 'grid_epc_capacity_owner',
      sourceGroup: 'official_filing',
      sourceUrl: 'https://www.sec.gov/Archives/pwr-fixture',
      documentTitle: 'PWR 10-K power delivery backlog fixture',
      extractedTextSnippet: 'Power Delivery provides transmission and substation services for utility customers. Backlog, demand visibility, and guidance reflect customer demand and project execution requirements.',
      acceptanceVerdict: 'accepted',
    }],
  });
  assert.equal(result.acceptedEvidenceIds.length, 1);
  assert.equal(result.acceptedPromotionEvidenceCount, 1);
  assert.equal(result.acceptedEvidence[0].promotionEligible, true);
  assert.equal(result.issuerBridgeStatus, 'partial');
  assert.equal(result.gateImpact.reportCandidateAllowed, false);
  assert.ok(result.gateImpact.blockers.includes('independent_source_breadth_missing'));
});

test('Track B accepts ACM/J-style official issuer sources and remains blocked by downstream gates', () => {
  const result = __test.runLimitedIssuerBridgeTrackExecutor(inputState({
    splitTracks: {
      issuerBridgeTrack: {
        seed: { seedId: 'track-b-acm-j', bottleneckNode: 'utility grid infrastructure execution capacity' },
      },
    },
    gateResult: { gate: 'blocked', blockers: ['issuer_bridge_missing'] },
    visualStatus: 'pending',
  }), {
    issuerBridgeRawEvidence: [{
      evidenceId: 'acm-ir',
      issuer: 'ACM',
      issuerRoleClass: 'utility_infrastructure_services',
      sourceGroup: 'issuer_ir',
      sourceUrl: 'https://investors.aecom.com/grid-fixture',
      documentTitle: 'ACM grid infrastructure investor presentation',
      extractedTextSnippet: 'Utility infrastructure programs include transmission and substation engineering. Customer demand and project execution support revenue visibility for grid infrastructure.',
      acceptanceVerdict: 'accepted',
    }, {
      evidenceId: 'j-transcript',
      issuer: 'J',
      issuerRoleClass: 'engineering_construction_exposure',
      sourceGroup: 'issuer_transcript',
      sourceUrl: 'https://invest.jacobs.com/grid-transcript-fixture',
      documentTitle: 'J grid modernization transcript fixture',
      extractedTextSnippet: 'Grid modernization and electric infrastructure projects increased project backlog. Management cited utility spending and margin visibility from project execution.',
      acceptanceVerdict: 'accepted',
    }],
  });
  assert.equal(result.acceptedEvidenceIds.length, 2);
  assert.equal(result.acceptedPromotionEvidenceCount, 2);
  assert.equal(result.independentSourceBreadth, 2);
  assert.equal(result.issuerBridgeStatus, 'closed');
  assert.equal(result.gateImpact.reportCandidateAllowed, false);
  assert.ok(result.gateImpact.blockers.includes('negative_control_not_closed'));
});

test('Track B rejects ticker-only official issuer row', () => {
  const result = __test.runLimitedIssuerBridgeTrackExecutor(inputState({
    splitTracks: {
      issuerBridgeTrack: {
        seed: { seedId: 'track-b-ticker-only', bottleneckNode: 'power delivery project backlog' },
      },
    },
    gateResult: { gate: 'blocked', blockers: ['issuer_bridge_missing'] },
    visualStatus: 'pending',
  }), {
    issuerBridgeRawEvidence: [{
      evidenceId: 'ticker-only-pwr',
      issuer: 'PWR',
      issuerRoleClass: 'grid_epc_capacity_owner',
      sourceGroup: 'official_filing',
      sourceUrl: 'https://www.sec.gov/Archives/pwr-ticker-only',
      documentTitle: 'PWR mention',
      extractedTextSnippet: 'PWR was mentioned near power delivery backlog but this evidence row is ticker-only.',
      acceptanceVerdict: 'accepted',
      tickerOnly: true,
    }],
  });
  assert.equal(result.acceptedEvidenceIds.length, 0);
  assert.match(result.rawEvidence[0].rejectionReason, /ticker_only/);
  assert.equal(result.gateImpact.reportCandidateAllowed, false);
});

test('non-grid issuer bridge route does not fall back to PWR/ACM/J grid fixture', () => {
  const result = __test.runLimitedIssuerBridgeTrackExecutor(inputState({
    splitTracks: {
      issuerBridgeTrack: {
        seed: {
          seedId: 'track-b-defense',
          bottleneckNode: 'energetic binder qualified supplier capacity',
          issuerCandidates: ['LHX', 'NOC'],
          routeIssuerCandidates: ['LHX', 'NOC'],
          acceptanceCriteria: {
            requiredTerms: ['energetic binder', 'solid rocket motor', 'propellant'],
            bridgeTerms: ['backlog', 'customer demand', 'capacity'],
          },
        },
      },
    },
    gateResult: { gate: 'blocked', blockers: ['issuer_bridge_missing'] },
    visualStatus: 'pending',
  }), { maxQueries: 4 });

  assert.deepEqual(result.issuerCandidates.sort(), ['LHX', 'NOC']);
  assert.doesNotMatch(JSON.stringify(result.rawEvidence), /\bPWR\b|\bACM\b|power delivery|substation/i);
  assert.equal(result.collectorVersion, 'defense-propulsion-readonly-v1');
  assert.ok(result.acceptedEvidenceIds.length >= 1);
  assert.equal(result.gateImpact.reportCandidateAllowed, false);
});

test('non-grid official issuer evidence can be accepted without grid exposure terms', () => {
  const result = __test.runLimitedIssuerBridgeTrackExecutor(inputState({
    splitTracks: {
      issuerBridgeTrack: {
        seed: {
          seedId: 'track-b-defense-accepted',
          bottleneckNode: 'energetic binder qualified supplier capacity',
          issuerCandidates: ['LHX'],
          acceptanceCriteria: {
            requiredTerms: ['energetic binder', 'solid rocket motor', 'propellant'],
            bridgeTerms: ['backlog', 'customer demand', 'capacity'],
          },
        },
      },
    },
    gateResult: { gate: 'blocked', blockers: ['issuer_bridge_missing'] },
    visualStatus: 'pending',
  }), {
    issuerBridgeRawEvidence: [{
      evidenceId: 'lhx-official-filing',
      issuer: 'LHX',
      issuerRoleClass: 'solid_rocket_motor_supplier_exposure',
      sourceGroup: 'official_filing',
      sourceUrl: 'https://www.sec.gov/Archives/lhx-fixture',
      documentTitle: 'LHX official filing propulsion capacity fixture',
      extractedTextSnippet: 'The propulsion segment includes solid rocket motor production and propellant capacity. Backlog and customer demand increased for missile programs, requiring additional capacity.',
      acceptanceVerdict: 'accepted',
    }],
  });

  assert.equal(result.acceptedEvidenceIds.length, 1);
  assert.equal(result.acceptedPromotionEvidenceCount, 1);
  assert.equal(result.issuerCandidates.includes('LHX'), true);
  assert.doesNotMatch(JSON.stringify(result.acceptedEvidence), /\bPWR\b|\bACM\b|power delivery/i);
  assert.equal(result.gateImpact.reportCandidateAllowed, false);
});

test('positive fixture opens report-candidate diagnostic only after accepted issuer, holdout, negative, breadth, and controlled market gates', async () => {
  const state = inputState({
    acceptedEvidenceCount: 1,
    acceptedPromotionEvidenceCount: 1,
    independentSourceBreadth: 2,
    issuerBridgeStatus: 'closed',
    holdoutConfirmed: true,
    negativeControlStatus: 'CHECKED_NO_DIRECT',
    marketValidationStatus: 'missing',
    gateResult: { gate: 'blocked', blockers: ['market_validation_missing'] },
    visualStatus: 'pending',
  });
  const result = await runAutonomousResearchRepairLoop({
    mode: 'execute-safe',
    inputState: state,
    marketValidationRawEvidence: [{
      evidenceId: 'local-market-controlled',
      sourceGroup: 'local_controlled_market',
      sourceUrl: 'local:event_uplift',
      marketValidationStatus: 'controlled_ready',
      summary: 'Local controlled market validation is controlled_ready for this issuer universe.',
    }],
    writeArtifact: false,
  });
  assert.equal(result.selectedAction, 'run_limited_controlled_market_validation');
  assert.equal(result.iterations[0].actionResult.acceptedEvidenceIds.length, 1);
  assert.equal(result.iterations[0].actionResult.reportCandidateAllowedDiagnostic, true);
  assert.equal(result.reportCandidateAllowedAfter, false);
  assert.equal(result.boundaries.reportCandidateWrites, 0);
  assert.equal(result.boundaries.readinessPromotionWrites, 0);
});

test('controlled market validation calculates local windows and keeps actual writes disabled', async () => {
  const result = await runAutonomousResearchRepairLoop({
    mode: 'execute-safe',
    maxIterations: 1,
    inputState: inputState({
      acceptedEvidenceCount: 10,
      acceptedPromotionEvidenceCount: 3,
      independentSourceBreadth: 3,
      issuerBridgeStatus: 'closed',
      holdoutConfirmed: true,
      negativeControlStatus: 'CHECKED_NO_DIRECT',
      gateResult: { gate: 'blocked', blockers: ['market_validation_missing'] },
      visualStatus: 'pending',
    }),
    useDefaultMarketAnchors: true,
    writeArtifact: false,
  });
  const actionResult = result.iterations[0].actionResult;
  assert.equal(result.selectedAction, 'run_limited_controlled_market_validation');
  assert.equal(actionResult.marketValidationStatus, 'controlled_ready');
  assert.equal(actionResult.marketValidationWindowResults.length > 0, true);
  assert.equal(actionResult.marketValidationBenchmarkUsed, 'SPY');
  assert.equal(actionResult.marketValidationControlUsed, true);
  assert.equal(actionResult.reportCandidateAllowedDiagnostic, true);
  assert.equal(result.reportCandidateAllowedAfter, false);
  assert.equal(result.nextRecommendedAction, 'evidence_contract_closure_dry_run');
  assert.equal(result.boundaries.reportCandidateWrites, 0);
  assert.equal(result.boundaries.readinessPromotionWrites, 0);
  assert.equal(result.boundaries.providerActivationWrites, 0);
});

test('evidence contract closure dry-run builds matrix and subject without report candidate writes', async () => {
  const result = await runAutonomousResearchRepairLoop({
    mode: 'execute-safe',
    maxIterations: 6,
    maxQueries: 6,
    inputState: inputState({
      blockType: 'mechanism_issuer_route_mismatch',
      routeMismatchDetected: true,
      splitTracks: {
        mechanismValidationTrack: {
          finalBlocker: 'track_a_mechanism_validation_missing',
          seed: { seedId: 'track-a-seed', bottleneckNode: 'interconnection study capacity' },
        },
        issuerBridgeTrack: {
          finalBlocker: 'issuer_bridge_missing',
          seed: { seedId: 'track-b-seed', bottleneckNode: 'transmission and substation EPC backlog', issuerCandidates: ['PWR', 'ACM', 'J'] },
        },
      },
      gateResult: { gate: 'blocked', blockers: ['market_validation_missing'] },
      visualStatus: 'pending',
    }),
    writeArtifact: false,
  });
  assert.deepEqual(result.iterations.map((item) => item.selectedAction), [
    'run_limited_grid_mechanism_validation',
    'run_limited_issuer_bridge_track',
    'run_limited_negative_control',
    'run_limited_holdout_validation',
    'run_limited_controlled_market_validation',
    'evidence_contract_closure_dry_run',
  ]);
  const closure = result.iterations[5].actionResult;
  assert.equal(closure.closureStatus, 'closure_passed_with_caveats');
  assert.equal(closure.reportCandidateAllowedDiagnostic, true);
  assert.equal(closure.dryRunReportSubject.thesisType, 'thesis_validation');
  assert.equal(closure.dryRunReportSubject.notDecisionReady, true);
  assert.equal(closure.dryRunReportSubject.investmentMemoReady, false);
  assert.equal(closure.evidenceContractMatrix.some((row) => row.evidenceClass === 'valuation_or_expectation_bridge' && row.status === 'missing_investment_readiness_only'), true);
  assert.equal(result.reportCandidateAllowedAfter, false);
  assert.equal(result.boundaries.reportCandidateWrites, 0);
  assert.equal(result.boundaries.readinessPromotionWrites, 0);
});

test('closure dry-run blocks when accepted promotion evidence is missing', () => {
  const result = __test.runEvidenceContractClosureDryRunExecutor(inputState({
    acceptedEvidenceCount: 3,
    acceptedPromotionEvidenceCount: 0,
    independentSourceBreadth: 3,
    issuerBridgeStatus: 'closed',
    negativeControlStatus: 'CHECKED_NO_DIRECT',
    holdoutConfirmed: true,
    marketValidationStatus: 'controlled_ready',
    reportCandidateAllowedDiagnostic: true,
    trackBAcceptedIssuerEvidenceCount: 3,
    trackBAcceptedPromotionEvidenceCount: 0,
    trackBAcceptedHoldoutEvidenceCount: 1,
    trackBAcceptedNegativeControlEvidenceCount: 1,
    marketValidationEventAnchorCount: 3,
    splitTrackResults: [{
      track: 'mechanism_validation_track',
      acceptedEvidenceIds: ['m1'],
    }, {
      track: 'issuer_bridge_track',
      acceptedEvidenceIds: ['i1', 'i2', 'i3'],
    }],
  }));
  assert.equal(result.closureStatus, 'closure_blocked_contradiction');
  assert.equal(result.reportCandidateAllowedDiagnostic, false);
  assert.equal(result.evidenceContractMatrix.find((row) => row.evidenceClass === 'issuer_exposure').blocking, true);
  assert.equal(result.reportCandidateWrites, 0);
});

test('closure dry-run blocks provider-blocked and low source breadth subjects', () => {
  const result = __test.runEvidenceContractClosureDryRunExecutor(inputState({
    blockType: 'provider_blocked',
    acceptedEvidenceCount: 4,
    acceptedPromotionEvidenceCount: 2,
    independentSourceBreadth: 1,
    issuerBridgeStatus: 'closed',
    negativeControlStatus: 'CHECKED_NO_DIRECT',
    holdoutConfirmed: true,
    marketValidationStatus: 'controlled_ready',
    reportCandidateAllowedDiagnostic: true,
    trackBAcceptedIssuerEvidenceCount: 2,
    trackBAcceptedPromotionEvidenceCount: 2,
    trackBAcceptedHoldoutEvidenceCount: 1,
    trackBAcceptedNegativeControlEvidenceCount: 1,
    splitTrackResults: [{
      track: 'mechanism_validation_track',
      acceptedEvidenceIds: ['m1'],
    }, {
      track: 'issuer_bridge_track',
      acceptedEvidenceIds: ['i1', 'i2'],
    }],
  }));
  assert.equal(result.closureStatus, 'closure_blocked_provider_gap');
  assert.equal(result.reportCandidateAllowedDiagnostic, false);
  assert.equal(result.contradictionWarnings.some((issue) => issue.code === 'PROVIDER_BLOCKED_SUBJECT_CLOSURE_ATTEMPTED'), true);
});

test('thesis validation memo dry-run creates safe memo artifacts without promotion writes', async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'lattice-thesis-memo-'));
  try {
    const result = await runAutonomousResearchRepairLoop({
      mode: 'execute-safe',
      maxIterations: 1,
      artifactRoot: tmp,
      outputPath: path.join(tmp, 'repair-loop.json'),
      inputState: inputState(passedClosureAcquisition()),
    });
    assert.equal(result.selectedAction, 'thesis_validation_memo_dry_run');
    assert.equal(result.thesisValidationMemoDryRunStatus, 'ready_with_caveats');
    assert.equal(result.memoType, 'thesis_validation_memo');
    assert.equal(result.memoDecisionUse, 'research_validation');
    assert.equal(result.notDecisionReady, true);
    assert.equal(result.investmentMemoReady, false);
    assert.equal(result.decisionReady, false);
    assert.equal(result.reportCandidateAllowedAfter, false);
    assert.equal(result.boundaries.reportCandidateWrites, 0);
    assert.equal(result.boundaries.readinessPromotionWrites, 0);
    assert.equal(result.boundaries.providerActivationWrites, 0);
    assert.match(result.clientMemoPath, /thesis-validation-memo-dry-run\.latest\.json$/);
    assert.match(result.auditAppendixPath, /thesis-validation-memo-audit-appendix\.latest\.json$/);
    const memo = JSON.parse(await readFile(result.clientMemoPath, 'utf8'));
    assert.equal(memo.metadata.notDecisionReady, true);
    assert.equal(memo.metadata.investmentMemoReady, false);
    assert.equal(memo.metadata.decisionReady, false);
    assert.match(memo.clientMemoMarkdown, /This is a thesis validation memo, not an investment decision memo\./);
    assert.match(memo.clientMemoMarkdown, /Controlled market validation is research-use support only until regime support and t-stat sanity are reviewed\./);
    assert.match(memo.clientMemoMarkdown, /## K\. Market Regime Support/);
    assert.match(memo.clientMemoMarkdown, /No buy\/sell\/position-sizing recommendation is made\./);
    assert.doesNotMatch(memo.clientMemoMarkdown, /grid-official:|grid-issuer-|rawEvidenceIds|queryPayload/i);
    assert.equal(memo.auditAppendix.claimEvidenceMap.length > 0, true);
    assert.equal(memo.auditAppendix.evidenceContractMatrixSummary.length > 0, true);
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});

test('execute-safe continues from closure dry-run into thesis validation memo dry-run', async () => {
  const result = await runAutonomousResearchRepairLoop({
    mode: 'execute-safe',
    maxIterations: 7,
    maxQueries: 6,
    inputState: inputState({
      blockType: 'mechanism_issuer_route_mismatch',
      routeMismatchDetected: true,
      splitTracks: {
        mechanismValidationTrack: {
          finalBlocker: 'track_a_mechanism_validation_missing',
          seed: { seedId: 'track-a-seed', bottleneckNode: 'interconnection study capacity' },
        },
        issuerBridgeTrack: {
          finalBlocker: 'issuer_bridge_missing',
          seed: { seedId: 'track-b-seed', bottleneckNode: 'transmission and substation EPC backlog', issuerCandidates: ['PWR', 'ACM', 'J'] },
        },
      },
      gateResult: { gate: 'blocked', blockers: ['market_validation_missing'] },
      visualStatus: 'pending',
    }),
    writeArtifact: false,
  });
  assert.deepEqual(result.iterations.map((item) => item.selectedAction), [
    'run_limited_grid_mechanism_validation',
    'run_limited_issuer_bridge_track',
    'run_limited_negative_control',
    'run_limited_holdout_validation',
    'run_limited_controlled_market_validation',
    'evidence_contract_closure_dry_run',
    'thesis_validation_memo_dry_run',
  ]);
  assert.equal(result.thesisValidationMemoDryRunStatus, 'ready_with_caveats');
  assert.equal(result.reportCandidateAllowedAfter, false);
  assert.equal(result.boundaries.reportCandidateWrites, 0);
  assert.equal(result.boundaries.readinessPromotionWrites, 0);
});

test('execute-safe continues from thesis memo into valuation expectation bridge dry-run without promotion writes', async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'lattice-valuation-bridge-'));
  try {
    const result = await runAutonomousResearchRepairLoop({
      mode: 'execute-safe',
      maxIterations: 8,
      maxQueries: 6,
      artifactRoot: tmp,
      outputPath: path.join(tmp, 'repair-loop.json'),
      inputState: inputState({
        blockType: 'mechanism_issuer_route_mismatch',
        routeMismatchDetected: true,
        splitTracks: {
          mechanismValidationTrack: {
            finalBlocker: 'track_a_mechanism_validation_missing',
            seed: { seedId: 'track-a-seed', bottleneckNode: 'interconnection study capacity' },
          },
          issuerBridgeTrack: {
            finalBlocker: 'issuer_bridge_missing',
            seed: { seedId: 'track-b-seed', bottleneckNode: 'transmission and substation EPC backlog', issuerCandidates: ['PWR', 'ACM', 'J'] },
          },
        },
        gateResult: { gate: 'blocked', blockers: ['market_validation_missing'] },
        visualStatus: 'pending',
      }),
    });
    assert.equal(result.iterations.at(-1).selectedAction, 'valuation_expectation_bridge_dry_run');
    assert.equal(result.valuationExpectationBridgeDryRunStatus, 'ready_with_caveats');
    assert.equal(result.valuationBridgeStatus, 'valuation_bridge_missing');
    assert.equal(result.marketValidationRegimeStatus, 'regime_supported');
    assert.equal(result.regimeCoverageScore, 1);
    assert.equal(result.unknownRegimeShare, 0);
    assert.equal(result.investmentMemoReady, false);
    assert.equal(result.decisionReady, false);
    assert.equal(result.reportCandidateAllowedAfter, false);
    assert.equal(result.boundaries.reportCandidateWrites, 0);
    assert.equal(result.boundaries.readinessPromotionWrites, 0);
    assert.equal(result.boundaries.providerActivationWrites, 0);
    assert.match(result.valuationBridgePath, /valuation-expectation-bridge-dry-run\.latest\.json$/);
    assert.match(result.marketRegimeSupportPath, /market-validation-regime-support\.latest\.json$/);
    const bridge = JSON.parse(await readFile(result.valuationBridgePath, 'utf8'));
    assert.equal(bridge.investmentMemoReady, false);
    assert.equal(bridge.decisionReady, false);
    assert.equal(bridge.marketRegimeSupport.marketValidationDecisionGradeAllowed, false);
    const memo = JSON.parse(await readFile(result.clientMemoPath, 'utf8'));
    assert.match(memo.clientMemoMarkdown, /## J\. Valuation \/ Expectation Bridge/);
    assert.doesNotMatch(memo.clientMemoMarkdown, /\b(rawEvidenceIds|market-validation:|local-market:)\b/i);
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});

test('thesis validation memo validator blocks unsafe or unsupported memo claims', () => {
  const valid = buildThesisValidationMemoDryRun({
    reportSubjectDryRun: {
      subjectId: 'dryrun-thesis-validation-test',
      subjectLabel: 'Grid infrastructure execution capacity',
      issuerUniverse: ['PWR', 'ACM', 'J'],
    },
    evidenceContractMatrix: passedClosureAcquisition().evidenceContractMatrix,
    caveats: ['sanity_check_extreme_tstat', 'DECISION_GRADE_MARKET_WITH_ZERO_REGIME_SUPPORT', 'valuation_or_expectation_bridge_missing_investment_readiness_blocked'],
    contradictionWarnings: [{ code: 'DECISION_GRADE_MARKET_WITH_ZERO_REGIME_SUPPORT', severity: 'warning', blocker: false }],
    remainingBlockers: ['investment_memo_readiness_blocked_until_valuation_or_expectation_bridge'],
  });
  assert.equal(validateThesisValidationMemoDryRun(valid).ok, true);

  const missingSanity = {
    ...valid,
    clientMemoMarkdown: valid.clientMemoMarkdown.replace(/sanity_check_extreme_tstat/g, 'market sanity issue'),
  };
  assert.equal(validateThesisValidationMemoDryRun(missingSanity).blockers.some((blocker) => blocker.type === 'missing_sanity_check_extreme_tstat'), true);

  const rawClaim = {
    ...valid,
    claims: [{ ...valid.claims[0], evidenceIds: ['raw:not-evaluated'] }],
  };
  assert.equal(validateThesisValidationMemoDryRun(rawClaim).blockers.some((blocker) => blocker.type === 'claim_uses_raw_evidence'), true);

  const leakedBody = {
    ...valid,
    clientMemoMarkdown: `${valid.clientMemoMarkdown}\nInternal raw id grid-official:leak should not be here.`,
  };
  assert.equal(validateThesisValidationMemoDryRun(leakedBody).blockers.some((blocker) => blocker.type === 'raw_payload_in_client_memo'), true);

  const unsafeAction = {
    ...valid,
    clientMemoMarkdown: valid.clientMemoMarkdown.replace('No buy/sell/position-sizing recommendation is made.', 'Buy PWR now and size the position aggressively.'),
  };
  assert.equal(validateThesisValidationMemoDryRun(unsafeAction).blockers.some((blocker) => blocker.type === 'portfolio_action_language'), true);
});

test('valuation expectation bridge keeps missing and caveated data out of investment readiness', () => {
  const missing = buildValuationExpectationBridgeDryRun({
    ...passedClosureAcquisition(),
    marketValidationStatus: 'controlled_ready',
    marketValidationWarnings: ['sanity_check_extreme_tstat', 'DECISION_GRADE_MARKET_WITH_ZERO_REGIME_SUPPORT'],
    marketValidationSampleSize: 3,
  });
  assert.equal(missing.valuationBridgeStatus, 'valuation_bridge_missing');
  assert.equal(missing.investmentMemoReady, false);
  assert.equal(missing.decisionReady, false);
  assert.equal(missing.investmentMemoReadinessDiagnostic.status, 'blocked_missing_valuation_bridge');
  assert.equal(missing.marketRegimeSupport.marketValidationDecisionGradeAllowed, false);
  assert.equal(validateValuationExpectationBridgeDryRun(missing).ok, true);

  const caveated = buildValuationExpectationBridgeDryRun({
    ...passedClosureAcquisition(),
    localValuationRows: [{
      issuer: 'PWR',
      forwardPE: 22,
      evToEbitda: 14,
      operatingExposure: 'power delivery backlog',
      backlogOrGuidanceEvidence: 'official guidance connects backlog to power delivery demand',
    }],
    marketValidationStatus: 'controlled_ready',
    marketValidationWarnings: ['sanity_check_extreme_tstat', 'DECISION_GRADE_MARKET_WITH_ZERO_REGIME_SUPPORT'],
    marketValidationSampleSize: 3,
  });
  assert.equal(caveated.valuationBridgeStatus, 'valuation_bridge_caveated');
  assert.equal(caveated.investmentMemoReady, false);
  assert.equal(caveated.decisionReady, false);
  assert.equal(caveated.investmentMemoReadinessDiagnostic.status, 'blocked_market_validation_regime_caveat');
});

test('valuation bridge dry-run ingests trusted local cache fixture without promotion writes', () => {
  const result = __test.runValuationExpectationBridgeDryRunExecutor(inputState({
    ...passedClosureAcquisition(),
    thesisValidationMemoDryRunStatus: 'ready_with_caveats',
    thesisValidationMemoDryRun: buildThesisValidationMemoDryRun({
      reportSubjectDryRun: passedClosureAcquisition().reportSubjectDryRun,
      evidenceContractMatrix: passedClosureAcquisition().evidenceContractMatrix,
      caveats: ['sanity_check_extreme_tstat', 'DECISION_GRADE_MARKET_WITH_ZERO_REGIME_SUPPORT'],
    }),
  }), {
    valuationCacheFixture: path.resolve('tests/fixtures/local-valuation-fundamentals-cache.caveated.json'),
  });
  assert.equal(result.valuationBridgeStatus, 'valuation_bridge_closed');
  assert.equal(result.expectationBridgeStatus, 'expectation_bridge_closed');
  assert.equal(result.localValuationCacheRowCount, 2);
  assert.deepEqual(result.localValuationCacheMissingIssuers, ['J']);
  assert.equal(result.issuerValuationBridgeTable.some((row) => row.peerMetricCoverage === 'covered'), true);
  assert.equal(result.investmentMemoReady, false);
  assert.equal(result.decisionReady, false);
  assert.equal(result.investmentMemoReadinessDiagnostic.status, 'blocked_market_validation_regime_caveat');
  assert.equal(result.boundaries.reportCandidateWrites, 0);
  assert.equal(result.boundaries.readinessPromotionWrites, 0);
  assert.match(result.updatedThesisValidationMemoDryRun.clientMemoMarkdown, /## J\. Valuation \/ Expectation Bridge/);
  assert.doesNotMatch(result.updatedThesisValidationMemoDryRun.clientMemoMarkdown, /raw valuation|rawEvidenceIds/i);
});

test('valuation bridge contradictory fixture flags priced-in risk without readiness promotion', () => {
  const result = __test.runValuationExpectationBridgeDryRunExecutor(inputState({
    ...passedClosureAcquisition(),
    thesisValidationMemoDryRunStatus: 'ready_with_caveats',
    thesisValidationMemoDryRun: buildThesisValidationMemoDryRun({
      reportSubjectDryRun: passedClosureAcquisition().reportSubjectDryRun,
      evidenceContractMatrix: passedClosureAcquisition().evidenceContractMatrix,
      caveats: ['sanity_check_extreme_tstat', 'DECISION_GRADE_MARKET_WITH_ZERO_REGIME_SUPPORT'],
    }),
  }), {
    valuationCacheFixture: path.resolve('tests/fixtures/local-valuation-fundamentals-cache.contradictory.json'),
  });
  assert.equal(result.valuationBridgeStatus, 'valuation_bridge_contradictory');
  assert.equal(result.issuerValuationBridgeTable.some((row) => row.pricedInRisk), true);
  assert.equal(result.investmentMemoReadinessDiagnostic.status, 'blocked_priced_in_or_contradictory_valuation');
  assert.equal(result.investmentMemoReady, false);
  assert.equal(result.boundaries.readinessPromotionWrites, 0);
});

test('valuation bridge validator blocks unsupported valuation language and unsafe readiness writes', () => {
  const bridge = buildValuationExpectationBridgeDryRun({
    ...passedClosureAcquisition(),
    localValuationRows: [{
      issuer: 'PWR',
      forwardPE: 20,
      evToEbitda: 12,
      consensusRevenueRevision: 0.05,
      consensusEpsRevision: 0.04,
    }],
    marketValidationStatus: 'controlled_ready',
    marketValidationSampleSize: 4,
    marketValidationControlUsed: true,
    marketValidationBenchmarkUsed: 'SPY',
    marketValidationEventAnchorCount: 4,
    regimeConsistencyScore: 0.7,
  });
  const unsafe = {
    ...bridge,
    investmentMemoReady: true,
    boundaries: { ...bridge.boundaries, readinessPromotionWrites: 1 },
    issuerValuationBridgeTable: [{
      ...bridge.issuerValuationBridgeTable[0],
      thesisUpsideCondition: 'The stock is cheap and should be bought.',
    }],
  };
  const validation = validateValuationExpectationBridgeDryRun(unsafe);
  assert.equal(validation.ok, false);
  assert.equal(validation.blockers.some((blocker) => blocker.type === 'investment_memo_ready_not_allowed'), true);
  assert.equal(validation.blockers.some((blocker) => blocker.type === 'readinessPromotionWrites_must_be_zero'), true);
  assert.equal(validation.blockers.some((blocker) => blocker.type === 'valuation_conclusion_language'), true);
});

test('zero regime support and extreme t-stat downgrade market validation for investment readiness', () => {
  const support = __test.buildMarketValidationRegimeSupport({
    marketValidationStatus: 'controlled_ready',
    marketValidationSampleSize: 5,
    marketValidationControlUsed: true,
    marketValidationBenchmarkUsed: 'SPY',
    marketValidationWarnings: ['sanity_check_extreme_tstat', 'DECISION_GRADE_MARKET_WITH_ZERO_REGIME_SUPPORT'],
    marketValidationWindowResults: [{ tStat: 42 }],
  });
  assert.equal(support.marketValidationRegimeStatus, 'regime_caveated');
  assert.equal(support.regimeConsistencyScore, 0);
  assert.equal(support.extremeTstatWarning, true);
  assert.equal(support.marketValidationDecisionGradeAllowed, false);
  assert.equal(support.investmentReadinessMarketStatus, 'market_validation_caveated_for_investment_readiness');
});

test('regime support can become supported from two local regime buckets without promotion writes', () => {
  const support = __test.buildMarketValidationRegimeSupport({
    marketValidationStatus: 'controlled_ready',
    marketValidationSampleSize: 48,
    marketValidationControlUsed: true,
    marketValidationBenchmarkUsed: 'SPY',
    marketValidationEventAnchorCount: 4,
    marketValidationWindowResults: [
      { eventId: 'pwr-1', window: '1d', abnormalReturn: 1.2, eventMinusControl: 0.8, controlSampleSize: 12, benchmarkReturn: 0.7, sectorAdjustedReturn: 0.4, vix: 14, rateChange: -0.08 },
      { eventId: 'pwr-2', window: '5d', abnormalReturn: 1.1, eventMinusControl: 0.7, controlSampleSize: 12, benchmarkReturn: 0.8, sectorAdjustedReturn: 0.3, vix: 16, rateChange: -0.03 },
      { eventId: 'acm-1', window: '1d', abnormalReturn: 0.9, eventMinusControl: 0.6, controlSampleSize: 12, benchmarkReturn: -0.7, sectorAdjustedReturn: 0.5, vix: 28, rateChange: 0.08 },
      { eventId: 'j-1', window: '5d', abnormalReturn: 0.8, eventMinusControl: 0.5, controlSampleSize: 12, benchmarkReturn: -0.6, sectorAdjustedReturn: 0.4, vix: 27, rateChange: 0.09 },
    ],
  });
  assert.equal(support.marketValidationRegimeStatus, 'regime_supported');
  assert.equal(support.marketValidationResearchUseAllowed, true);
  assert.equal(support.marketValidationInvestmentUseAllowed, true);
  assert.equal(support.marketValidationDecisionUseAllowed, false);
  assert.equal(support.marketValidationDecisionGradeAllowed, false);
  assert.equal(Number(support.regimeConsistencyScore) >= 0.67, true);
  assert.equal(Number(support.regimeCoverageScore) >= 0.5, true);
});

test('local regime-support fixtures classify positive, missing, and contradictory paths', async () => {
  const positive = __test.buildMarketValidationRegimeSupport(await loadFixture('local-market-regime-support.positive.json'));
  assert.equal(positive.marketValidationRegimeStatus, 'regime_supported');
  assert.equal(positive.marketValidationResearchUseAllowed, true);
  assert.equal(positive.marketValidationInvestmentUseAllowed, true);
  assert.equal(positive.marketValidationDecisionUseAllowed, false);
  assert.equal(positive.extremeTstatWarning, false);
  assert.equal(Number(positive.unknownRegimeShare), 0);

  const missing = __test.buildMarketValidationRegimeSupport(await loadFixture('local-market-regime-support.missing.json'));
  assert.match(missing.marketValidationRegimeStatus, /^regime_(missing|caveated)$/);
  assert.equal(missing.marketValidationInvestmentUseAllowed, false);

  const contradictory = __test.buildMarketValidationRegimeSupport(await loadFixture('local-market-regime-support.contradictory.json'));
  assert.equal(contradictory.marketValidationRegimeStatus, 'regime_contradictory');
  assert.equal(contradictory.marketValidationInvestmentUseAllowed, false);
});

test('regime contradictory fixture blocks investment memo readiness diagnostic', () => {
  const bridge = buildValuationExpectationBridgeDryRun({
    ...passedClosureAcquisition(),
    localValuationRows: [
      { issuer: 'PWR', forwardPE: 20, evToEbitda: 12, consensusRevenueRevision: 0.05, consensusEpsRevision: 0.04, peerGroup: ['ACM'], peerMedianForwardPE: 18 },
      { issuer: 'ACM', forwardPE: 18, evToEbitda: 11, consensusRevenueRevision: 0.04, consensusEpsRevision: 0.03, peerGroup: ['PWR'], peerMedianForwardPE: 19 },
    ],
    marketValidationStatus: 'controlled_ready',
    marketValidationSampleSize: 40,
    marketValidationControlUsed: true,
    marketValidationBenchmarkUsed: 'SPY',
    marketValidationEventAnchorCount: 4,
    marketValidationWindowResults: [
      { eventId: 'a', abnormalReturn: -1.1, eventMinusControl: -0.8, controlSampleSize: 10, benchmarkReturn: 0.8, sectorAdjustedReturn: 0.2, vix: 13, rateChange: -0.08 },
      { eventId: 'b', abnormalReturn: -1.3, eventMinusControl: -0.9, controlSampleSize: 10, benchmarkReturn: -0.8, sectorAdjustedReturn: -0.3, vix: 28, rateChange: 0.09 },
      { eventId: 'c', abnormalReturn: -0.7, eventMinusControl: -0.6, controlSampleSize: 10, benchmarkReturn: 0.9, sectorAdjustedReturn: 0.3, vix: 15, rateChange: -0.06 },
      { eventId: 'd', abnormalReturn: -0.6, eventMinusControl: -0.5, controlSampleSize: 10, benchmarkReturn: -0.9, sectorAdjustedReturn: -0.4, vix: 29, rateChange: 0.07 },
    ],
  });
  assert.equal(bridge.marketValidationRegimeStatus, 'regime_contradictory');
  assert.equal(bridge.investmentMemoReadinessDiagnostic.status, 'blocked_market_validation_contradictory');
  assert.equal(bridge.investmentMemoReady, false);
  assert.equal(bridge.decisionReady, false);
  assert.equal(bridge.portfolioActionAllowed, false);
});

test('market regime support repair can produce human-review diagnostic without actual readiness promotion', () => {
  const base = passedClosureAcquisition();
  const result = __test.runMarketValidationRegimeSupportRepairExecutor(inputState({
    ...base,
    valuationBridgeStatus: 'valuation_bridge_closed',
    expectationBridgeStatus: 'expectation_bridge_closed',
    investmentMemoReadinessDiagnostic: { status: 'blocked_market_validation_regime_caveat' },
    marketValidationWarnings: [],
    marketValidationCaveats: [],
    closureCaveats: [],
    thesisValidationMemoCaveats: [],
    closureContradictionWarnings: [],
    marketValidationSampleSize: 48,
    marketValidationControlUsed: true,
    marketValidationBenchmarkUsed: 'SPY',
    marketValidationEventAnchorCount: 4,
    marketValidationWindowResults: [
      { eventId: 'pwr-1', window: '1d', abnormalReturn: 1.2, eventMinusControl: 0.8, controlSampleSize: 12, benchmarkReturn: 0.7, sectorAdjustedReturn: 0.4, vix: 14, rateChange: -0.08 },
      { eventId: 'pwr-2', window: '5d', abnormalReturn: 1.1, eventMinusControl: 0.7, controlSampleSize: 12, benchmarkReturn: 0.8, sectorAdjustedReturn: 0.3, vix: 16, rateChange: -0.03 },
      { eventId: 'acm-1', window: '1d', abnormalReturn: 0.9, eventMinusControl: 0.6, controlSampleSize: 12, benchmarkReturn: -0.7, sectorAdjustedReturn: 0.5, vix: 28, rateChange: 0.08 },
      { eventId: 'j-1', window: '5d', abnormalReturn: 0.8, eventMinusControl: 0.5, controlSampleSize: 12, benchmarkReturn: -0.6, sectorAdjustedReturn: 0.4, vix: 27, rateChange: 0.09 },
    ],
  }));
  assert.equal(result.marketValidationRegimeStatus, 'regime_supported');
  assert.equal(result.investmentMemoReadinessDiagnostic.status, 'ready_for_human_investment_memo_review');
  assert.equal(result.readyForHumanInvestmentMemoReview, true);
  assert.equal(result.investmentMemoReady, false);
  assert.equal(result.decisionReady, false);
  assert.equal(result.portfolioActionAllowed, false);
  assert.equal(result.boundaries.readinessPromotionWrites, 0);
  assert.equal(result.boundaries.reportCandidateWrites, 0);
  assert.equal(result.boundaries.providerActivationWrites, 0);
  const marketRow = result.updatedEvidenceContractMatrix.find((row) => row.evidenceClass === 'controlled_market_validation');
  assert.equal(marketRow.regimeSupportStatus, 'regime_supported');
  assert.equal(marketRow.marketValidationDecisionUseAllowed, false);
});

test('positive local regime fixture opens only human-review investment memo diagnostic', async () => {
  const base = passedClosureAcquisition();
  const result = __test.runMarketValidationRegimeSupportRepairExecutor(inputState({
    ...base,
    valuationBridgeStatus: 'valuation_bridge_closed',
    expectationBridgeStatus: 'expectation_bridge_closed',
    investmentMemoReadinessDiagnostic: { status: 'blocked_market_validation_regime_caveat' },
    marketValidationWarnings: ['sanity_check_extreme_tstat', 'DECISION_GRADE_MARKET_WITH_ZERO_REGIME_SUPPORT'],
    closureCaveats: ['sanity_check_extreme_tstat'],
  }), {
    marketRegimeFixtureData: await loadFixture('local-market-regime-support.positive.json'),
  });
  assert.equal(result.marketValidationRegimeStatus, 'regime_supported');
  assert.equal(result.investmentMemoReadinessDiagnostic.status, 'ready_for_human_investment_memo_review');
  assert.equal(result.readyForHumanInvestmentMemoReview, true);
  assert.match(result.investmentMemoReadinessDiagnostic.notDecisionReadyReason, /human review required/i);
  assert.equal(result.investmentMemoReady, false);
  assert.equal(result.decisionReady, false);
  assert.equal(result.portfolioActionAllowed, false);
  assert.equal(result.boundaries.readinessPromotionWrites, 0);
  assert.equal(result.boundaries.reportCandidateWrites, 0);
  assert.equal(result.boundaries.providerActivationWrites, 0);
});

test('missing and contradictory local regime fixtures keep investment memo diagnostic blocked', async () => {
  const base = passedClosureAcquisition();
  const missing = __test.runMarketValidationRegimeSupportRepairExecutor(inputState({
    ...base,
    valuationBridgeStatus: 'valuation_bridge_closed',
    expectationBridgeStatus: 'expectation_bridge_closed',
  }), {
    marketRegimeFixtureData: await loadFixture('local-market-regime-support.missing.json'),
  });
  assert.notEqual(missing.investmentMemoReadinessDiagnostic.status, 'ready_for_human_investment_memo_review');
  assert.equal(missing.readyForHumanInvestmentMemoReview, false);
  assert.equal(missing.investmentMemoReady, false);

  const contradictory = __test.runMarketValidationRegimeSupportRepairExecutor(inputState({
    ...base,
    valuationBridgeStatus: 'valuation_bridge_closed',
    expectationBridgeStatus: 'expectation_bridge_closed',
  }), {
    marketRegimeFixtureData: await loadFixture('local-market-regime-support.contradictory.json'),
  });
  assert.equal(contradictory.marketValidationRegimeStatus, 'regime_contradictory');
  assert.equal(contradictory.investmentMemoReadinessDiagnostic.status, 'blocked_market_validation_contradictory');
  assert.equal(contradictory.readyForHumanInvestmentMemoReview, false);
  assert.equal(contradictory.investmentMemoReady, false);
});

test('source-query market evidence is rejected and cannot substitute local controlled validation', () => {
  const result = __test.runLimitedControlledMarketValidationExecutor(inputState({
    acceptedEvidenceCount: 1,
    acceptedPromotionEvidenceCount: 1,
    independentSourceBreadth: 2,
    issuerBridgeStatus: 'closed',
    holdoutConfirmed: true,
    negativeControlStatus: 'CHECKED_NO_DIRECT',
    gateResult: { gate: 'blocked', blockers: ['market_validation_missing'] },
    visualStatus: 'pending',
  }), {
    marketValidationRawEvidence: [{
      evidenceId: 'source-query-market-commentary',
      sourceGroup: 'source_query',
      provider: 'rss',
      sourceUrl: 'https://example.test/news',
      marketValidationStatus: 'controlled_ready',
      summary: 'Market commentary says grid names reacted well.',
    }],
  });
  assert.equal(result.acceptedEvidenceIds.length, 0);
  assert.equal(result.reportCandidateAllowedDiagnostic, false);
  assert.equal(result.gateImpact.reportCandidateAllowed, false);
});

test('raw or rejected local market evidence anchor is not accepted', () => {
  const result = __test.runLimitedControlledMarketValidationExecutor(inputState({
    acceptedEvidenceCount: 1,
    acceptedPromotionEvidenceCount: 1,
    independentSourceBreadth: 2,
    issuerBridgeStatus: 'closed',
    holdoutConfirmed: true,
    negativeControlStatus: 'CHECKED_NO_DIRECT',
    gateResult: { gate: 'blocked', blockers: ['market_validation_missing'] },
    visualStatus: 'pending',
  }), {
    marketValidationRawEvidence: [{
      evidenceId: 'local-market-rejected',
      sourceGroup: 'local_controlled_market',
      provider: 'local_market_quotes',
      sourceUrl: 'local:event_uplift',
      marketValidationStatus: 'controlled_ready',
      acceptanceVerdict: 'rejected',
      summary: 'Rejected local event row cannot become accepted evidence.',
    }],
  });
  assert.equal(result.acceptedEvidenceIds.length, 0);
  assert.equal(result.gateImpact.reportCandidateAllowed, false);
});

test('market validation caveat does not open diagnostic report-candidate path', () => {
  const result = __test.runLimitedControlledMarketValidationExecutor(inputState({
    acceptedEvidenceCount: 1,
    acceptedPromotionEvidenceCount: 1,
    independentSourceBreadth: 2,
    issuerBridgeStatus: 'closed',
    holdoutConfirmed: true,
    negativeControlStatus: 'CHECKED_NO_DIRECT',
    gateResult: { gate: 'blocked', blockers: ['market_validation_missing'] },
    visualStatus: 'pending',
  }), {
    marketValidationRawEvidence: [{
      evidenceId: 'local-market-caveated',
      sourceGroup: 'local_controlled_market',
      sourceUrl: 'local:event_uplift',
      marketValidationStatus: 'market_validation_caveated',
      summary: 'Local controlled market validation is caveated due to small controls.',
    }],
  });
  assert.equal(result.acceptedEvidenceIds.length, 1);
  assert.equal(result.marketValidationStatus, 'market_validation_caveated');
  assert.equal(result.reportCandidateAllowedDiagnostic, false);
  assert.equal(result.gateImpact.finalBlocker, 'market_validation_caveated');
  assert.equal(result.gateImpact.reportCandidateAllowed, false);
});

test('market validation missing keeps decision-ready blocked', async () => {
  const result = await runAutonomousResearchRepairLoop({
    mode: 'execute-safe',
    inputState: inputState({
      acceptedEvidenceCount: 1,
      acceptedPromotionEvidenceCount: 1,
      independentSourceBreadth: 2,
      issuerBridgeStatus: 'closed',
      holdoutConfirmed: true,
      negativeControlStatus: 'CHECKED_NO_DIRECT',
      gateResult: { gate: 'blocked', blockers: ['market_validation_missing'] },
      visualStatus: 'pending',
    }),
    marketQuotes: [],
    writeArtifact: false,
  });
  assert.equal(result.selectedAction, 'run_limited_controlled_market_validation');
  assert.equal(result.reportCandidateAllowedAfter, false);
  assert.equal(result.readinessAfter.finalBlocker, 'market_validation_missing');
});

test('stop-on-test-failure prevents bounded execution', async () => {
  const result = await runAutonomousResearchRepairLoop({
    mode: 'execute-safe',
    testResults: { executedByLoop: false, passed: 1, failed: 1 },
    inputState: inputState({
      negativeControlStatus: 'INCONCLUSIVE',
      gateResult: { gate: 'blocked', blockers: ['negative_control_not_closed'] },
      visualStatus: 'pending',
    }),
    writeArtifact: false,
  });
  assert.equal(result.stopReason, 'tests_failed');
  assert.equal(result.executed, false);
  assert.equal(result.boundaries.providerActivationWrites, 0);
});

test('loader can discover latest acquisition artifact under runtime root', async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'lattice-repair-loader-'));
  try {
    const nested = path.join(tmp, 'seed-bias-positive-path');
    await import('node:fs/promises').then((fs) => fs.mkdir(nested, { recursive: true }));
    await writeFile(path.join(nested, 'seed-bias-evidence-acquisition.latest.json'), `${JSON.stringify({
      blockType: 'mechanism_issuer_route_mismatch',
      routeMismatchDetected: true,
      acceptedEvidenceCount: 0,
      gateResult: { gate: 'blocked', blockers: ['accepted_evidence_missing'] },
      visualStatus: 'pending',
    }, null, 2)}\n`, 'utf8');
    const result = await runAutonomousResearchRepairLoop({
      artifactRoot: tmp,
      outputPath: path.join(tmp, 'out.json'),
    });
    assert.equal(result.selectedAction, 'split_mechanism_and_issuer_tracks');
    assert.match(result.inputState.acquisitionPath, /seed-bias-evidence-acquisition\.latest\.json$/);
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});

test('hardcoding audit detects risky core hardcoding in unseen core files', () => {
  const audit = __test.runAutonomousResearchHardcodingAudit({
    files: ['scripts/core-risk.mjs'],
    virtualFiles: {
      'scripts/core-risk.mjs': 'export const forced = \"PWR ABF substrate capacity\";',
    },
    strictCore: true,
  });
  assert.equal(audit.ok, false);
  assert.equal(audit.status, 'failed_risky_core_hardcoding');
  assert.equal(audit.findings.some((finding) => finding.status === 'RISKY_CORE_HARDCODING'), true);
});

test('final investment report dry-run can reach human-review-only with local regime support and validates safety boundaries', async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'lattice-final-report-'));
  try {
    const result = await runAutonomousResearchRepairLoop({
      mode: 'execute-safe',
      maxIterations: 10,
      maxQueries: 6,
      artifactRoot: tmp,
      outputPath: path.join(tmp, 'repair-loop.json'),
      inputState: inputState({
        blockType: 'mechanism_issuer_route_mismatch',
        routeMismatchDetected: true,
        splitTracks: {
          mechanismValidationTrack: {
            finalBlocker: 'track_a_mechanism_validation_missing',
            seed: { seedId: 'track-a-seed', bottleneckNode: 'interconnection study capacity' },
          },
          issuerBridgeTrack: {
            finalBlocker: 'issuer_bridge_missing',
            seed: { seedId: 'track-b-seed', bottleneckNode: 'transmission and substation EPC backlog', issuerCandidates: ['PWR', 'ACM', 'J'] },
          },
        },
        gateResult: { gate: 'blocked', blockers: ['market_validation_missing'] },
        visualStatus: 'pending',
      }),
      valuationCacheFixture: 'tests/fixtures/local-valuation-fundamentals-cache.caveated.json',
    });
    assert.equal(result.iterations.at(-1).selectedAction, 'final_investment_report_dry_run');
    assert.equal(result.marketValidationRegimeStatus, 'regime_supported');
    assert.equal(result.regimeCoverageScore, 1);
    assert.equal(result.unknownRegimeShare, 0);
    assert.equal(result.finalInvestmentReportDryRunStatus, 'human_review_required');
    assert.equal(result.readyForHumanInvestmentMemoReview, true);
    assert.equal(result.finalStopReason, 'pass_mvp_ready_human_review_required');
    assert.equal(result.validatorStatus, 'passed');
    assert.equal(result.memoType, 'investment_memo_dry_run');
    assert.equal(result.decisionUse, 'human_review_required');
    assert.equal(result.notDecisionReady, true);
    assert.equal(result.investmentMemoReady, false);
    assert.equal(result.decisionReady, false);
    assert.equal(result.boundaries.reportCandidateWrites, 0);
    assert.equal(result.boundaries.readinessPromotionWrites, 0);
    assert.equal(result.boundaries.providerActivationWrites, 0);
    assert.equal(result.boundaries.portfolioActionWrites, 0);
    assert.match(result.finalInvestmentReportDryRunPath, /final-investment-report-dry-run\.latest\.json$/);
    const report = JSON.parse(await readFile(result.finalInvestmentReportDryRunPath, 'utf8'));
    assert.match(report.clientMemoMarkdown, /This is a final investment report dry-run, not an approved investment memo\./);
    assert.match(report.clientMemoMarkdown, /No buy\/sell\/position-sizing recommendation is made\./);
    assert.match(report.clientMemoMarkdown, /Portfolio action is not allowed without human review\./);
    assert.match(report.clientMemoMarkdown, /Decision-ready status remains false\./);
    assert.doesNotMatch(report.clientMemoMarkdown, /\b(rawEvidenceIds|queryPayload|local-market:|market-validation:)\b/i);
    assert.equal(report.auditAppendix.claimEvidenceMap.length > 0, true);
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});

test('positive regime fixture reaches PASS_MVP_READY diagnostic and final dry-run without promotion writes', async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'lattice-final-report-positive-'));
  try {
    const result = await runAutonomousResearchRepairLoop({
      mode: 'execute-safe',
      maxIterations: 10,
      maxQueries: 6,
      artifactRoot: tmp,
      outputPath: path.join(tmp, 'repair-loop.json'),
      inputState: inputState({
        blockType: 'mechanism_issuer_route_mismatch',
        routeMismatchDetected: true,
        splitTracks: {
          mechanismValidationTrack: {
            finalBlocker: 'track_a_mechanism_validation_missing',
            seed: { seedId: 'track-a-seed', bottleneckNode: 'interconnection study capacity' },
          },
          issuerBridgeTrack: {
            finalBlocker: 'issuer_bridge_missing',
            seed: { seedId: 'track-b-seed', bottleneckNode: 'transmission and substation EPC backlog', issuerCandidates: ['PWR', 'ACM', 'J'] },
          },
        },
        gateResult: { gate: 'blocked', blockers: ['market_validation_missing'] },
        visualStatus: 'pending',
      }),
      valuationCacheFixture: 'tests/fixtures/local-valuation-fundamentals-cache.caveated.json',
      marketRegimeFixture: 'tests/fixtures/local-market-regime-support.positive.json',
    });
    assert.equal(result.iterations.at(-1).selectedAction, 'final_investment_report_dry_run');
    assert.equal(result.marketValidationRegimeStatus, 'regime_supported');
    assert.equal(result.investmentMemoReadinessDiagnostic.status, 'ready_for_human_investment_memo_review');
    assert.equal(result.readyForHumanInvestmentMemoReview, true);
    assert.equal(result.finalInvestmentReportDryRunStatus, 'human_review_required');
    assert.equal(result.validatorStatus, 'passed');
    assert.equal(result.finalStopReason, 'pass_mvp_ready_human_review_required');
    assert.equal(result.decisionUse, 'human_review_required');
    assert.equal(result.notDecisionReady, true);
    assert.equal(result.investmentMemoReady, false);
    assert.equal(result.decisionReady, false);
    assert.equal(result.portfolioActionAllowed, false);
    assert.equal(result.boundaries.reportCandidateWrites, 0);
    assert.equal(result.boundaries.readinessPromotionWrites, 0);
    assert.equal(result.boundaries.providerActivationWrites, 0);
    assert.equal(result.boundaries.portfolioActionWrites, 0);
    const report = JSON.parse(await readFile(result.finalInvestmentReportDryRunPath, 'utf8'));
    assert.equal(report.finalInvestmentReportDryRunStatus, 'human_review_required');
    assert.equal(report.metadata.investmentMemoReady, false);
    assert.equal(report.metadata.decisionReady, false);
    assert.equal(report.metadata.portfolioActionAllowed, false);
    assert.match(report.clientMemoMarkdown, /## H\. Market Regime Support/);
    assert.match(report.clientMemoMarkdown, /## I\. Valuation \/ Expectation Bridge/);
    assert.doesNotMatch(report.clientMemoMarkdown, /zero_regime_support|unknown_regime_share_high|VALUATION_OR_EXPECTATION_BRIDGE_MISSING/i);
    assert.doesNotMatch(report.clientMemoMarkdown, /\b(rawEvidenceIds|queryPayload|sourceQuery|local-market:|market-validation:)\b/i);
    assert.equal(report.auditAppendix.claimEvidenceMap.some((row) => row.section === 'H. Market Regime Support'), true);
    assert.equal(report.auditAppendix.mutationBoundary.reportCandidateWrites, 0);
    assert.equal(report.auditAppendix.mutationBoundary.readinessPromotionWrites, 0);
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});

test('final investment report validator rejects unsafe readiness and unsupported claims', () => {
  const base = __test.buildFinalInvestmentReportDryRun({
    ...passedClosureAcquisition(),
    valuationBridgeStatus: 'valuation_bridge_closed',
    expectationBridgeStatus: 'expectation_bridge_closed',
    marketValidationStatus: 'controlled_ready',
    marketValidationRegimeStatus: 'regime_caveated_with_human_review',
  });
  assert.equal(base.validation.ok, true);

  const unsafeReady = {
    ...base,
    metadata: { ...base.metadata, investmentMemoReady: true },
  };
  assert.equal(__test.validateFinalInvestmentReportDryRun(unsafeReady).blockers.some((blocker) => blocker.type === 'investmentMemoReady_invalid'), true);

  const rawClaim = {
    ...base,
    claims: [{ ...base.claims[0], evidenceIds: ['raw:evidence'] }],
  };
  assert.equal(__test.validateFinalInvestmentReportDryRun(rawClaim).blockers.some((blocker) => blocker.type === 'claim_uses_raw_or_rejected_evidence'), true);

  const actionLanguage = {
    ...base,
    clientMemoMarkdown: `${base.clientMemoMarkdown}\nTarget price and overweight language should fail.`,
  };
  assert.equal(__test.validateFinalInvestmentReportDryRun(actionLanguage).blockers.some((blocker) => blocker.type === 'portfolio_action_language'), true);
});

test('final investment report dry-run can remain blocked for missing valuation bridge without validator failure', () => {
  const blocked = __test.buildFinalInvestmentReportDryRun({
    ...passedClosureAcquisition(),
    valuationBridgeStatus: 'valuation_bridge_missing',
    expectationBridgeStatus: 'expectation_bridge_caveated',
    marketValidationStatus: 'controlled_ready',
    marketValidationRegimeStatus: 'regime_supported',
  });

  assert.equal(blocked.finalInvestmentReportDryRunStatus, 'blocked');
  assert.equal(blocked.validation.ok, true);
  assert.equal(blocked.metadata.investmentMemoReady, false);
  assert.equal(blocked.metadata.decisionReady, false);
  assert.equal(blocked.metadata.portfolioActionAllowed, false);
  assert.equal(blocked.remainingBlockers.includes('valuation_bridge'), true);
  assert.doesNotMatch(blocked.clientMemoMarkdown, /valuation conclusion/i);
});
