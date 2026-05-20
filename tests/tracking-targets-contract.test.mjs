import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

const ROOT = process.cwd();

async function read(relPath) {
  return readFile(path.join(ROOT, relPath), 'utf8');
}

test('tracking targets stay isolated from canonical discovery and model tables', async () => {
  const source = await read('scripts/_shared/tracking-targets.mjs');
  assert.match(source, /CREATE TABLE IF NOT EXISTS tracked_targets/);
  assert.match(source, /CREATE TABLE IF NOT EXISTS tracked_target_hits/);
  assert.match(source, /buildTrackingDataPathAudit/);
  assert.equal(/INSERT\s+INTO\s+discovery_topics/i.test(source), false, 'tracking targets must not insert discovery topics');
  assert.equal(/UPDATE\s+discovery_topics/i.test(source), false, 'tracking targets must not update discovery topics');
  assert.equal(/INSERT\s+INTO\s+auto_article_themes/i.test(source), false, 'tracking targets must not write auto theme labels');
  assert.equal(/INSERT\s+INTO\s+model_predictions/i.test(source), false, 'tracking targets must not write model predictions');
  assert.equal(/INSERT\s+INTO\s+labeled_outcomes/i.test(source), false, 'tracking targets must not write training labels');
});

test('dashboard API exposes private tracking routes and audit endpoint', async () => {
  const api = await read('scripts/event-dashboard-api.mjs');
  assert.match(api, /tracking-targets/);
  assert.match(api, /buildTrackedTargetsPayload/);
  assert.match(api, /buildTrackingDataPathAudit/);
  assert.match(api, /refreshTrackedTargetHits/);
  assert.match(api, /tracked_targets \/ tracked_target_hits/);
});

test('dashboard exposes user-entered keyword and symbol tracking UI', async () => {
  const dashboard = await read('event-dashboard.html');
  assert.match(dashboard, /Track Keyword \/ Symbol/);
  assert.match(dashboard, /id="tracking-label-input"/);
  assert.match(dashboard, /function createTrackedTarget\(\)/);
  assert.match(dashboard, /function loadTrackedTargets\(\)/);
  assert.match(dashboard, /\/tracking-targets/);
  assert.match(dashboard, /promoteToMain:false/, 'user targets must not auto-promote into canonical themes');
});
