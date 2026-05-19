import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  appendReportFeedback,
  readReportFeedback,
  summarizeReportFeedback,
} from '../scripts/_shared/report-feedback.mjs';

test('report feedback is append-only and summarizes source-query needs', async () => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'lattice-report-feedback-'));
  try {
    await appendReportFeedback('RPT-test-1', {
      type: 'need_source_query',
      claimId: 'CLM-001',
      note: 'Need source expansion.',
    }, { reportDir: tmp });
    await appendReportFeedback('RPT-test-1', {
      type: 'too_speculative',
      claimId: 'CLM-001',
      note: 'Too much interpretation.',
    }, { reportDir: tmp });
    const rows = await readReportFeedback('RPT-test-1', { reportDir: tmp });
    const summary = summarizeReportFeedback(rows);
    assert.equal(rows.length, 2);
    assert.equal(summary.needsSourceQuery, 1);
    assert.equal(summary.tooSpeculative, 1);
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});
