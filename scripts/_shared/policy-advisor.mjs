import { loadResearchOsPolicy, getPolicyValue } from './research-os-policy.mjs';

function proposal(policyKey, currentValue, proposedValue, reason, expectedEffect, rollbackRule) {
  return {
    policyKey,
    currentValue,
    proposedValue,
    reason,
    expectedEffect,
    riskSummary: 'Policy change requires approval or bounded shadow mode before production impact.',
    shadowResult: {},
    rollbackRule,
    status: 'pending',
  };
}

export function buildPolicyAdvisorProposals(metrics = {}, policy = loadResearchOsPolicy()) {
  const proposals = [];
  const autonomousTarget = Number(getPolicyValue(policy, 'autonomousQuestionRateTarget'));
  const seedCap = Number(getPolicyValue(policy, 'seedDependenceRatioMax'));
  const explorationMin = Number(getPolicyValue(policy, 'explorationQuotaMin'));
  const currentExploration = Number(metrics.explorationRate ?? explorationMin);
  const seedDependence = Number(metrics.seedDependenceRatio ?? 0);
  const autonomousRate = Number(metrics.autonomousQuestionRate ?? autonomousTarget);
  const rejectRate = Number(metrics.humanRejectRate ?? 0);

  if (autonomousRate < autonomousTarget) {
    proposals.push(proposal(
      'generation.maxQuestionsPerRun',
      getPolicyValue(policy, 'generation.maxQuestionsPerRun'),
      Math.ceil(Number(getPolicyValue(policy, 'generation.maxQuestionsPerRun')) * 1.25),
      `autonomous_question_rate ${autonomousRate.toFixed(3)} is below target ${autonomousTarget.toFixed(3)}`,
      { expected: 'more autonomous research questions from non-user triggers' },
      { metric: 'autonomous_question_rate', restoreIfBelow: autonomousTarget },
    ));
  }

  if (seedDependence > seedCap) {
    proposals.push(proposal(
      'explorationQuotaMin',
      explorationMin,
      Math.min(0.8, explorationMin + 0.1),
      `seed_dependence_ratio ${seedDependence.toFixed(3)} exceeds cap ${seedCap.toFixed(3)}`,
      { expected: 'increase non-seed exploration lane share' },
      { metric: 'seed_dependence_ratio', restoreIfAbove: seedCap },
    ));
  }

  if (rejectRate > 0.75 && currentExploration > explorationMin) {
    proposals.push(proposal(
      'explorationQuotaMin',
      explorationMin,
      Math.max(explorationMin, currentExploration - 0.1),
      `human reject rate ${rejectRate.toFixed(3)} is high while exploration exceeds floor`,
      { expected: 'reduce noisy exploration while preserving configured minimum' },
      { metric: 'novel_candidate_rate', restoreIfBelow: explorationMin },
    ));
  }

  return {
    ok: true,
    proposals,
    requiresApproval: proposals.length > 0,
  };
}
