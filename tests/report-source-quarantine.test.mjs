import test from 'node:test';
import assert from 'node:assert/strict';

import {
  applyReportSourceQuarantineToSeeds,
  buildReportSourceQuarantine,
} from '../scripts/_shared/report-source-quarantine.mjs';

test('recent generated reports are quarantined from immediate seed feedback', () => {
  const now = new Date('2026-05-22T00:00:00.000Z');
  const quarantine = buildReportSourceQuarantine({
    now,
    cooldownHours: 168,
    reports: [
      {
        reportId: 'recent',
        subject: 'utility grid infrastructure execution capacity',
        generatedAt: '2026-05-21T23:00:00.000Z',
      },
      {
        reportId: 'old',
        subject: 'advanced substrate material capacity',
        generatedAt: '2026-04-01T00:00:00.000Z',
      },
    ],
  });
  assert.equal(quarantine.reportCount, 2);
  assert.equal(quarantine.activeQuarantineCount, 1);
  assert.equal(quarantine.rows.find((row) => row.reportId === 'recent').status, 'quarantined_as_seed_source');
  assert.equal(quarantine.rows.find((row) => row.reportId === 'old').status, 'cooldown_expired');
});

test('quarantine applies a penalty marker to matching seeds without deleting them', () => {
  const quarantine = buildReportSourceQuarantine({
    now: new Date('2026-05-22T00:00:00.000Z'),
    reports: [
      {
        reportId: 'recent',
        subject: 'substation equipment lead time',
        generatedAt: '2026-05-21T23:00:00.000Z',
      },
    ],
  });
  const seeds = applyReportSourceQuarantineToSeeds([
    { seedId: 'seed-1', seedTitle: 'substation equipment lead time' },
    { seedId: 'seed-2', seedTitle: 'cryogenic valve qualification' },
  ], quarantine);
  assert.equal(seeds[0].reportSourceQuarantine.applied, true);
  assert.equal(seeds[1].reportSourceQuarantine.applied, false);
});
