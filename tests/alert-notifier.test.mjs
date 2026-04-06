import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtempSync, readFileSync } from 'node:fs';

import { readAlertLog, sendAlert } from '../scripts/_shared/alert-notifier.mjs';

test('sendAlert persists alerts locally without webhook', async () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), 'alert-notifier-'));
  const filePath = path.join(tempDir, 'alerts.json');

  const result = await sendAlert('warning', 'data quality degraded', { overall: 0.42 }, { filePath });
  assert.equal(result.ok, true);
  assert.equal(result.delivered, false);

  const alerts = JSON.parse(readFileSync(filePath, 'utf8'));
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].severity, 'warning');
  assert.equal(alerts[0].context.overall, 0.42);
  assert.equal(readAlertLog(filePath).length, 1);
});

