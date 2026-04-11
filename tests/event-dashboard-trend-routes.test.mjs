import test from 'node:test';
import assert from 'node:assert/strict';

import { startEventDashboardServer } from '../scripts/event-dashboard-api.mjs';

test('event dashboard exposes trend workbench routes', async () => {
  const server = startEventDashboardServer(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;

  try {
    const pyramidResponse = await fetch(`http://127.0.0.1:${port}/api/trend-pyramid?period=quarter`);
    assert.equal(pyramidResponse.status, 200);
    const pyramidPayload = await pyramidResponse.json();
    assert.ok(Object.prototype.hasOwnProperty.call(pyramidPayload, 'periodType'));
    assert.ok(Object.prototype.hasOwnProperty.call(pyramidPayload, 'mainstream'));

    const evolutionResponse = await fetch(`http://127.0.0.1:${port}/api/theme-evolution/technology-general?period=quarter`);
    assert.equal(evolutionResponse.status, 200);
    const evolutionPayload = await evolutionResponse.json();
    assert.ok(Array.isArray(evolutionPayload.periods));
    assert.ok(Array.isArray(evolutionPayload.subThemes));

    const briefResponse = await fetch(`http://127.0.0.1:${port}/api/theme-brief/quantum-computing?period=quarter&since=2026-04-01T00:00:00.000Z`);
    assert.equal(briefResponse.status, 200);
    const briefPayload = await briefResponse.json();
    assert.equal(briefPayload.theme, 'quantum-computing');
    assert.ok(Object.prototype.hasOwnProperty.call(briefPayload, 'sections'));
    assert.ok(Object.prototype.hasOwnProperty.call(briefPayload, 'sectionMeta'));
    assert.ok(Object.prototype.hasOwnProperty.call(briefPayload, 'evidenceLedger'));
    assert.ok(Object.prototype.hasOwnProperty.call(briefPayload, 'deltaSinceLastVisit'));
    assert.ok(Object.prototype.hasOwnProperty.call(briefPayload, 'notebookState'));
    assert.ok(Array.isArray(briefPayload.sections.whatChanged));
    assert.equal(typeof briefPayload.sections.whyItMatters, 'object');
    assert.equal(typeof briefPayload.sections.evidence, 'object');
    assert.equal(typeof briefPayload.sections.subtopicMovement, 'object');
    assert.equal(typeof briefPayload.sections.relatedEntities, 'object');
    assert.equal(typeof briefPayload.sections.adjacentPathways, 'object');
    assert.ok(Array.isArray(briefPayload.sections.adjacentPathways?.items || []));
    assert.ok(Array.isArray(briefPayload.sections.risks));
    assert.ok(Array.isArray(briefPayload.sections.watchpoints));
    assert.equal(typeof briefPayload.sections.notebookHooks, 'object');
    assert.ok(Array.isArray(briefPayload.evidenceLedger.claims));
    assert.ok(Object.prototype.hasOwnProperty.call(briefPayload.sectionMeta, 'whatChanged'));
    assert.ok(Object.prototype.hasOwnProperty.call(briefPayload.sectionMeta, 'whyItMatters'));
    assert.ok(Object.prototype.hasOwnProperty.call(briefPayload.sectionMeta, 'evidence'));
    assert.ok(Object.prototype.hasOwnProperty.call(briefPayload.sectionMeta, 'subtopicMovement'));
    assert.ok(Object.prototype.hasOwnProperty.call(briefPayload.sectionMeta, 'relatedEntities'));
    assert.ok(Object.prototype.hasOwnProperty.call(briefPayload.sectionMeta, 'risks'));
    assert.ok(Object.prototype.hasOwnProperty.call(briefPayload.sectionMeta, 'watchpoints'));
    assert.ok(Array.isArray(briefPayload.evidenceLedger.evidenceClasses));
    assert.ok(Array.isArray(briefPayload.evidenceLedger.provenance));

    const notebookResponse = await fetch(`http://127.0.0.1:${port}/api/theme-brief-notebook/quantum-computing?period=quarter`);
    assert.equal(notebookResponse.status, 200);
    const notebookPayload = await notebookResponse.json();
    assert.equal(notebookPayload.theme, 'quantum-computing');
    assert.equal(notebookPayload.periodType, 'quarter');

    const notebookSaveResponse = await fetch(`http://127.0.0.1:${port}/api/theme-brief-notebook/quantum-computing?period=quarter`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        noteMarkdown: 'Track policy catalysts and supplier exposure.',
        tags: ['quantum-computing', 'watch'],
        pinned: true,
        shareRequested: true,
      }),
    });
    assert.equal(notebookSaveResponse.status, 200);
    const notebookSavePayload = await notebookSaveResponse.json();
    assert.equal(notebookSavePayload.pinned, true);
    assert.ok(Array.isArray(notebookSavePayload.tags));
    assert.equal(typeof notebookSavePayload.shareUrl, 'string');

    const exportResponse = await fetch(`http://127.0.0.1:${port}/api/theme-brief-export/quantum-computing?period=quarter&format=markdown`);
    assert.equal(exportResponse.status, 200);
    const exportPayload = await exportResponse.json();
    assert.equal(typeof exportPayload.content, 'string');
    assert.equal(typeof exportPayload.filename, 'string');

    if (notebookSavePayload.shareToken) {
      const sharedResponse = await fetch(`http://127.0.0.1:${port}/api/theme-brief-shared/${encodeURIComponent(notebookSavePayload.shareToken)}?period=quarter`);
      assert.equal(sharedResponse.status, 200);
      const sharedPayload = await sharedResponse.json();
      assert.equal(sharedPayload.brief.theme, 'quantum-computing');
      assert.ok(Object.prototype.hasOwnProperty.call(sharedPayload, 'brief'));
      assert.ok(Object.prototype.hasOwnProperty.call(sharedPayload, 'notebook'));
    }

    const followedBriefingResponse = await fetch(`http://127.0.0.1:${port}/api/followed-theme-briefing?period=week&themes=quantum-computing,ai-ml`);
    assert.equal(followedBriefingResponse.status, 200);
    const followedBriefingPayload = await followedBriefingResponse.json();
    assert.equal(followedBriefingPayload.periodType, 'week');
    assert.ok(Array.isArray(followedBriefingPayload.items));
    assert.equal(typeof followedBriefingPayload.snapshot, 'object');
    if (followedBriefingPayload.items.length > 0) {
      assert.ok(Object.prototype.hasOwnProperty.call(followedBriefingPayload.items[0], 'adjacentPathways'));
      assert.ok(Array.isArray(followedBriefingPayload.items[0].adjacentPathways || []));
    }

    const alertsResponse = await fetch(`http://127.0.0.1:${port}/api/structural-alerts?period=week&followed_themes=quantum-computing,ai-ml&limit=5`);
    assert.equal(alertsResponse.status, 200);
    const alertsPayload = await alertsResponse.json();
    assert.equal(alertsPayload.periodType, 'week');
    assert.deepEqual(alertsPayload.filters.themes, ['quantum-computing', 'ai-ml']);
    assert.ok(Array.isArray(alertsPayload.items));
    if (alertsPayload.items.length > 0) {
      assert.ok(Object.prototype.hasOwnProperty.call(alertsPayload.items[0], 'alertScore'));
    }

    const triageResponse = await fetch(`http://127.0.0.1:${port}/api/discovery-triage?limit=5`);
    assert.equal(triageResponse.status, 200);
    const triagePayload = await triageResponse.json();
    assert.ok(Object.prototype.hasOwnProperty.call(triagePayload, 'summary'));
    assert.ok(Array.isArray(triagePayload.items));

    const categoryResponse = await fetch(`http://127.0.0.1:${port}/api/category-trends/technology?period=quarter`);
    assert.equal(categoryResponse.status, 200);
    const categoryPayload = await categoryResponse.json();
    assert.ok(Object.prototype.hasOwnProperty.call(categoryPayload, 'category'));
    assert.ok(Array.isArray(categoryPayload.themes));

    const insightsResponse = await fetch(`http://127.0.0.1:${port}/api/insights/quarterly?period=quarter`);
    assert.equal(insightsResponse.status, 200);
    const insightsPayload = await insightsResponse.json();
    assert.ok(Object.prototype.hasOwnProperty.call(insightsPayload, 'periodType'));
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});
