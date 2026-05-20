import assert from 'node:assert/strict';
import test from 'node:test';

import {
  acceptSeedEvidenceRows,
  evaluateSeedEvidenceAcceptance,
} from '../scripts/_shared/seed-evidence-acceptance.mjs';

const task = {
  taskId: 'task-issuer',
  seedId: 'seed-1',
  evidenceClass: 'issuer_exposure',
  providerRoute: 'issuer_exposure',
  acceptanceCriteria: {
    requiredTerms: ['switchgear backlog'],
  },
};

test('raw evidence is not automatically accepted without acceptance criteria match', () => {
  const result = evaluateSeedEvidenceAcceptance({
    evidenceId: 'raw-1',
    seedId: 'seed-1',
    evidenceClass: 'issuer_exposure',
    source: 'source-a',
    summary: 'general grid discussion',
  }, { task, now: new Date('2026-05-20T00:00:00.000Z') });
  assert.equal(result.accepted, false);
  assert.equal(result.blockers.includes('acceptance_criteria_not_met'), true);
});

test('accepted promotion evidence contributes covered evidence class', () => {
  const result = acceptSeedEvidenceRows([{
    evidenceId: 'raw-2',
    seedId: 'seed-1',
    taskId: 'task-issuer',
    evidenceClass: 'issuer_exposure',
    source: 'official-company',
    summary: 'official switchgear backlog segment exposure evidence',
  }], { tasks: [task], now: new Date('2026-05-20T00:00:00.000Z') });
  assert.equal(result.acceptedEvidenceStoredCount, 1);
  assert.deepEqual(result.coveredEvidenceClasses, ['issuer_exposure']);
});

test('duplicate stale and incompatible evidence is rejected', () => {
  const result = acceptSeedEvidenceRows([
    {
      evidenceId: 'raw-3a',
      seedId: 'seed-1',
      taskId: 'task-issuer',
      evidenceClass: 'issuer_exposure',
      source: 'source-dup',
      publishedAt: '2020-01-01T00:00:00.000Z',
      summary: 'official switchgear backlog segment exposure evidence',
    },
    {
      evidenceId: 'raw-3b',
      seedId: 'seed-1',
      taskId: 'task-issuer',
      evidenceClass: 'issuer_exposure',
      source: 'source-dup',
      contaminationWarning: true,
      summary: 'official switchgear backlog segment exposure evidence',
    },
  ], { tasks: [task], now: new Date('2026-05-20T00:00:00.000Z') });
  assert.equal(result.acceptedEvidenceStoredCount, 0);
  assert.equal(result.rawEvidence.some((row) => row.acceptanceBlockers.includes('stale_evidence')), true);
  assert.equal(result.rawEvidence.some((row) => row.acceptanceBlockers.includes('target_theme_incompatible')), true);
});

test('negative control cannot become promotion evidence', () => {
  const result = acceptSeedEvidenceRows([{
    evidenceId: 'raw-neg',
    seedId: 'seed-1',
    taskId: 'task-neg',
    evidenceClass: 'negative_control',
    source: 'negative-source',
    summary: 'no direct invalidator found after supplier redundancy search',
  }], {
    tasks: [{
      taskId: 'task-neg',
      seedId: 'seed-1',
      evidenceClass: 'negative_control',
      acceptanceCriteria: { requiredTerms: ['no direct invalidator'] },
    }],
    now: new Date('2026-05-20T00:00:00.000Z'),
  });
  assert.equal(result.acceptedEvidenceStoredCount, 1);
  assert.equal(result.acceptedEvidence[0].evidenceUse, 'negative_control_candidate');
  assert.equal(result.acceptedEvidence[0].promotionEligible, false);
  assert.deepEqual(result.coveredEvidenceClasses, []);
});

test('market validation requires local controlled market data for accepted promotion', () => {
  const result = acceptSeedEvidenceRows([{
    evidenceId: 'raw-market',
    seedId: 'seed-1',
    taskId: 'task-market',
    evidenceClass: 'market_validation',
    source: 'source-query',
    marketTier: 'decision_grade',
    summary: 'event study abnormal return',
  }], {
    tasks: [{
      taskId: 'task-market',
      seedId: 'seed-1',
      evidenceClass: 'market_validation',
      acceptanceCriteria: { requiredTerms: ['event study'] },
    }],
    now: new Date('2026-05-20T00:00:00.000Z'),
  });
  assert.equal(result.acceptedEvidenceStoredCount, 0);
  assert.equal(result.rawEvidence[0].acceptanceBlockers.includes('market_validation_requires_local_controlled_data'), true);
});
