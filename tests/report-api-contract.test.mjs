import assert from 'node:assert/strict';
import { rm } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import { resolveEventDashboardResponse } from '../scripts/event-dashboard-api.mjs';

test('reports API generates artifact-backed HTML report without canonical writes', async () => {
  const response = await resolveEventDashboardResponse('/api/reports/generate', {
    method: 'POST',
    body: {
      sample: true,
      reportType: 'theme_report',
      subject: { displayName: 'Cloud Infrastructure' },
    },
  });
  assert.equal(response.status, 200);
  const payload = JSON.parse(response.body);
  assert.equal(payload.ok, true);
  assert.equal(payload.manifest.reportType, 'theme_report');
  assert.equal(payload.manifest.section_role_coverage, 1);
  assert.equal(payload.manifest.narrative_archetype, 'theme_research_memo');
  assert.equal(payload.validation.status === 'passed' || payload.validation.status === 'warning', true);

  const htmlResponse = await resolveEventDashboardResponse(`/api/reports/${payload.reportId}/html`, {
    method: 'GET',
  });
  assert.equal(htmlResponse.status, 200);
  assert.equal(htmlResponse.contentType, 'text/html; charset=utf-8');
  assert.match(htmlResponse.body, /Cloud Infrastructure/);
  assert.match(htmlResponse.body, /Executive Judgment/);
  assert.match(htmlResponse.body, /What the Market Is Trying to Decide/);
  assert.match(htmlResponse.body, /Mechanism Test/);
  assert.doesNotMatch(htmlResponse.body, /<h2>Signal Triage<\/h2>/);
  assert.doesNotMatch(htmlResponse.body, /Evidence Base|Metric Ledger|Query Manifest|\brefs\s+\d+\b/i);

  const auditResponse = await resolveEventDashboardResponse(`/api/reports/${payload.reportId}/audit`, {
    method: 'GET',
  });
  assert.equal(auditResponse.status, 200);
  assert.match(auditResponse.body, /Evidence Base/);
  assert.match(auditResponse.body, /Signal Cards/);

  const feedbackResponse = await resolveEventDashboardResponse(`/api/reports/${payload.reportId}/feedback`, {
    method: 'POST',
    body: {
      type: 'need_source_query',
      claimId: 'CLM-001',
      note: 'Need more source evidence before treating this as durable.',
      reviewer: 'test',
    },
  });
  assert.equal(feedbackResponse.status, 200);
  const feedbackPayload = JSON.parse(feedbackResponse.body);
  assert.equal(feedbackPayload.ok, true);
  assert.equal(feedbackPayload.summary.needsSourceQuery, 1);

  const latestResponse = await resolveEventDashboardResponse('/api/reports/latest?limit=5', { method: 'GET' });
  assert.equal(latestResponse.status, 200);
  const latestPayload = JSON.parse(latestResponse.body);
  assert.equal(latestPayload.ok, true);
  assert.equal(latestPayload.reports.some((report) => report.reportId === payload.reportId), true);

  const queueResponse = await resolveEventDashboardResponse('/api/reports/source-queue?limit=20', { method: 'GET' });
  assert.equal(queueResponse.status, 200);
  const queuePayload = JSON.parse(queueResponse.body);
  assert.equal(queuePayload.ok, true);
  assert.equal(Array.isArray(queuePayload.queue), true);

  const indexResponse = await resolveEventDashboardResponse('/api/reports/index', { method: 'GET' });
  assert.equal(indexResponse.status, 200);
  assert.equal(indexResponse.contentType, 'text/html; charset=utf-8');
  assert.match(indexResponse.body, /Lattice Report Registry/);

  const exportResponse = await resolveEventDashboardResponse(`/api/reports/${payload.reportId}/export`, {
    method: 'POST',
    body: { pdf: false },
  });
  assert.equal(exportResponse.status, 200);
  const exportPayload = JSON.parse(exportResponse.body);
  assert.equal(exportPayload.ok, true);
  assert.match(exportPayload.pptx, /briefing-deck\.pptx$/);

  await rm(path.join('data', 'reports', payload.reportId), { recursive: true, force: true });
});
