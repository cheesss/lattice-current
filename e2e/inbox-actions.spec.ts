/**
 * Smoke tests for event-dashboard.html — Decision Inbox actions.
 *
 * These tests run against event-dashboard.html served at http://127.0.0.1:4173.
 * All API calls are intercepted with page.route() so no live DB is required.
 *
 * Run: npx playwright test e2e/inbox-actions.spec.ts
 * (Requires the API server to be up OR all routes fully mocked via page.route)
 */

import { expect, test, type Page, type Route } from '@playwright/test';

const DASHBOARD_URL = 'http://127.0.0.1:4173/event-dashboard.html';
const API_BASE = 'http://localhost:46200/api';

type MockJsonResponse = {
  status?: number;
  body: unknown;
};

type MockApiOptions = {
  triageReviewResponse?: MockJsonResponse;
  themeShellSnapshotsResponse?: MockJsonResponse;
};

// ── Fixtures ──────────────────────────────────────────────────────────────────

const MOCK_APPROVAL_ITEM = {
  id: 'approval-smoke-001',
  rawId: 'approval-smoke-001',
  type: 'approval',
  subtype: 'add-rss',
  title: 'Flightradar24 Eastern Mediterranean feed',
  source: 'codex',
  theme: 'defense',
  freshness: 'fresh',
  freshnessLabel: 'Fresh (3h ago)',
  payload: {
    label: 'Flightradar24 Eastern Mediterranean feed',
    url: 'https://www.flightradar24.com/',
    name: 'Flightradar24',
    theme: 'defense',
    proposalType: 'add-rss',
  },
};

const MOCK_PROPOSAL_ITEM = {
  id: 'proposal-smoke-001',
  rawId: 'proposal-smoke-001',
  type: 'proposal',
  subtype: 'add-theme',
  title: 'Add biotech-ai theme',
  source: 'codex',
  theme: 'biotech',
  freshness: 'fresh',
  freshnessLabel: 'Fresh (1h ago)',
  payload: { label: 'Add biotech-ai theme', targetTheme: 'biotech-ai', proposalType: 'add-theme' },
};

const MOCK_TRIAGE_ITEM = {
  id: 'triage-smoke-001',
  rawId: 'triage-smoke-001',
  type: 'triage',
  subtype: 'new-topic',
  title: 'AI chip export controls',
  source: 'discovery',
  theme: 'technology-general',
  freshness: 'recent',
  freshnessLabel: 'Recent (6h ago)',
  payload: { normalizedTheme: 'ai-chip-exports', category: 'technology' },
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function isAllowedReadOnlyDashboardApi(apiPath: string) {
  const exactPaths = new Set([
    '/api/automation-budget',
    '/api/automation-log',
    '/api/health',
    '/api/data-quality',
    '/api/codex-quality',
    '/api/structural-alerts',
    '/api/today',
    '/api/trends',
    '/api/emerging-tech',
    '/api/digest/weekly',
    '/api/whatif',
    '/api/anomalies',
    '/api/codex-latest',
    '/api/pending',
    '/api/regime',
    '/api/regime/',
    '/api/regime//',
    '/api/heatmap',
    '/api/regime-timeline',
    '/api/event-uplift-grades',
    '/api/kpi-summary',
    '/api/signals',
    '/api/alpha-decay',
    '/api/signal-correlation',
    '/api/hawkes-heatmap',
    '/api/calibration',
    '/api/live-status',
  ]);
  if (exactPaths.has(apiPath)) return true;
  return [
    '/api/daily-digest',
    '/api/trend-pyramid',
    '/api/theme-evolution/',
    '/api/category-trends',
    '/api/insights/quarterly',
    '/api/theme-brief/',
    '/api/followed-theme-briefing',
    '/api/reports/latest',
    '/api/reports/',
    '/api/signals/history',
    '/api/correlation',
  ].some(prefix => apiPath.startsWith(prefix));
}

async function fulfillJson(route: Route, response: MockJsonResponse) {
  return route.fulfill({
    status: response.status ?? 200,
    contentType: 'application/json',
    body: JSON.stringify(response.body),
  });
}

async function mockAllApis(page: Page, options: MockApiOptions = {}) {
  await page.route('**/api/**', route => {
    const request = route.request();
    const url = request.url();
    const apiPath = new URL(url).pathname;
    const method = request.method();
    if (method === 'GET' && apiPath === '/api/proposal-inbox') {
      return fulfillJson(route, {
        body: {
          proposals: [{
            id: MOCK_PROPOSAL_ITEM.rawId,
            proposal_type: MOCK_PROPOSAL_ITEM.subtype,
            status: 'pending',
            source: MOCK_PROPOSAL_ITEM.source,
            payload: MOCK_PROPOSAL_ITEM.payload,
            reasoning: 'Codex proposal smoke fixture',
            created_at: new Date().toISOString(),
          }],
          approvals: [{
            id: MOCK_APPROVAL_ITEM.rawId,
            action_type: MOCK_APPROVAL_ITEM.subtype,
            status: 'pending',
            payload: MOCK_APPROVAL_ITEM.payload,
            reasoning: 'Human review required smoke fixture',
            created_at: new Date().toISOString(),
          }],
          summary: {
            pendingProposals: 1,
            pendingApprovals: 1,
            actionableCount: 2,
          },
        },
      });
    }
    if (method === 'GET' && apiPath === '/api/discovery-triage') {
      return fulfillJson(route, {
        body: {
          items: [{
            id: MOCK_TRIAGE_ITEM.rawId,
            label: MOCK_TRIAGE_ITEM.title,
            category: 'technology',
            parentTheme: MOCK_TRIAGE_ITEM.theme,
            normalizedTheme: MOCK_TRIAGE_ITEM.payload.normalizedTheme,
            promotionState: 'watch',
            structuralScore: 0.62,
            momentum: 1.4,
            articleCount: 12,
            keywords: ['ai', 'chips', 'exports'],
            updatedAt: new Date().toISOString(),
          }],
          summary: { total: 1 },
        },
      });
    }
    if (method === 'POST' && apiPath === '/api/discovery-triage/review') {
      return fulfillJson(route, options.triageReviewResponse || {
        body: { ok: true, decision: 'canonical', topicId: MOCK_TRIAGE_ITEM.rawId },
      });
    }
    if (method === 'POST' && apiPath === '/api/runtime-issues') {
      return fulfillJson(route, { body: { ok: true, captured: true } });
    }
    if (method === 'GET' && apiPath === '/api/theme-shell-snapshots') {
      return fulfillJson(route, options.themeShellSnapshotsResponse || {
        body: { risk: {}, macro: {}, investment: {}, validation: {}, transmission: {}, sourceOps: {}, geo: {} },
      });
    }
    if (apiPath.startsWith('/api/approval-queue/')
      || apiPath.startsWith('/api/codex-proposals/')) {
      return route.fallback();
    }
    if (method === 'GET' && isAllowedReadOnlyDashboardApi(apiPath)) {
      return fulfillJson(route, {
        body: { ok: true, data: null, items: [], events: [], signals: [], grades: [], meta: { testFixture: true } },
      });
    }
    return fulfillJson(route, {
      status: 501,
      body: { error: `Unexpected mocked API call: ${method} ${apiPath}` },
    });
  });
}

async function goToDashboard(page: Page, options: MockApiOptions = {}) {
  await mockAllApis(page, options);
  await page.goto(DASHBOARD_URL, { waitUntil: 'domcontentloaded' });
  // Wait for nav to be visible
  await page.waitForSelector('.surface-nav', { timeout: 10_000 });
}

async function switchToInbox(page: Page) {
  await page.click('.surface-nav-btn[data-surface="inbox"]');
  await page.waitForSelector('.surface[data-surface="inbox"].active', { timeout: 5_000 });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

test.describe('surface navigation', () => {
  test('all 5 nav buttons exist and switch surface', async ({ page }) => {
    await goToDashboard(page);

    const surfaces = ['home', 'inbox', 'investigate', 'geo', 'ops'] as const;

    for (const surface of surfaces) {
      await page.click(`.surface-nav-btn[data-surface="${surface}"]`);
      // Active button matches
      await expect(page.locator(`.surface-nav-btn[data-surface="${surface}"].active`)).toBeVisible();
      // Corresponding surface panel is visible
      await expect(page.locator(`.surface[data-surface="${surface}"].active`)).toBeVisible();
      // Other surfaces are hidden
      for (const other of surfaces) {
        if (other === surface) continue;
        await expect(page.locator(`.surface[data-surface="${other}"].active`)).toHaveCount(0);
      }
    }
  });

  test('URL hash updates on surface switch', async ({ page }) => {
    await goToDashboard(page);
    await page.click('.surface-nav-btn[data-surface="inbox"]');
    await expect(page).toHaveURL(/#inbox/);
    await page.click('.surface-nav-btn[data-surface="ops"]');
    await expect(page).toHaveURL(/#ops/);
  });
});

test.describe('Decision Inbox — Simulate button (dryRun preflight)', () => {
  test('Simulate button appears only for approval items', async ({ page }) => {
    await goToDashboard(page);
    await switchToInbox(page);

    // Wait for inbox items to render from the current proposal + discovery endpoints.
    await page.waitForTimeout(1_000);

    // Click the approval item
    const approvalItem = page.locator('.inbox-item').filter({ hasText: 'Flightradar24' }).first();
    await approvalItem.click();

    // Simulate button must be visible in the action bar
    await expect(page.locator('.inbox-actions button', { hasText: 'Simulate' })).toBeVisible();

    // Simulate button must NOT appear after clicking proposal item
    const proposalItem = page.locator('.inbox-item').filter({ hasText: 'Add biotech-ai theme' }).first();
    await proposalItem.click();
    await expect(page.locator('.inbox-actions button', { hasText: 'Simulate' })).toHaveCount(0);
  });

  test('Simulate click calls dryRun API and shows SKIPPED banner for failed source probes', async ({ page }) => {
    // Override approval-queue review endpoint with dryRun response
    await page.route(`${API_BASE}/approval-queue/approval-smoke-001/review`, route => {
      const body = route.request().postDataJSON();
      if (body?.dryRun === true) {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            approval: { status: 'pending' },
            execution: {
              skipped: true,
              reason: 'Feed quality below threshold (0.31 < 0.40)',
              feedName: 'Flightradar24',
              url: 'https://www.flightradar24.com/',
              quality: 0.31,
              articleCount: 0,
            },
            dryRun: true,
          }),
        });
      }
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) });
    });

    await goToDashboard(page);
    await switchToInbox(page);
    await page.waitForTimeout(1_000);

    const approvalItem = page.locator('.inbox-item').filter({ hasText: 'Flightradar24' }).first();
    await approvalItem.click();
    await page.locator('.inbox-actions button', { hasText: 'Simulate' }).click();

    // Failed source probes remain dry-run safe, but must be visibly marked as skipped.
    await expect(page.locator('.inbox-result.warning .trust-chip-stale', { hasText: 'SKIPPED' })).toBeVisible({ timeout: 5_000 });

    // Result copy must mention simulation
    const copy = await page.locator('.inbox-result.warning .inbox-result-copy').textContent();
    expect(copy).toMatch(/simulation|no changes/i);

    // Failed probe leaves the item in the queue, but under the Needs Fix segment.
    await expect(page.locator('.inbox-filter-chip[data-status-filter="needs-fix"]')).toContainText('1');
    await page.click('.inbox-filter-chip[data-status-filter="needs-fix"]');
    await expect(page.locator('.inbox-item').filter({ hasText: 'Flightradar24' })).toBeVisible();
  });

  test('Simulate button does not remove item from inbox', async ({ page }) => {
    await page.route(`${API_BASE}/approval-queue/approval-smoke-001/review`, route =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          approval: { status: 'pending' },
          execution: { skipped: true, reason: 'Quality too low' },
          dryRun: true,
        }),
      }),
    );

    await goToDashboard(page);
    await switchToInbox(page);
    await page.waitForTimeout(1_000);

    const allChipBefore = await page.locator('.inbox-filter-chip[data-status-filter="all"]').innerText();
    const approvalItem = page.locator('.inbox-item').filter({ hasText: 'Flightradar24' }).first();
    await approvalItem.click();
    await page.locator('.inbox-actions button', { hasText: 'Simulate' }).click();
    await page.waitForTimeout(500);

    const allChipAfter = await page.locator('.inbox-filter-chip[data-status-filter="all"]').innerText();
    expect(allChipAfter).toBe(allChipBefore);
  });

  test('Failed source probe moves approval into Needs Fix segment and hides Accept', async ({ page }) => {
    await page.route(`${API_BASE}/approval-queue/approval-smoke-001/review`, route =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          approval: { status: 'pending' },
          execution: {
            skipped: true,
            reason: 'quality 0.31 below threshold or feed not found',
            qualityScore: 0.31,
            recentItemCount: 0,
            url: 'https://www.flightradar24.com/',
          },
          dryRun: true,
        }),
      }),
    );

    await goToDashboard(page);
    await switchToInbox(page);
    await page.waitForTimeout(1_000);

    const approvalItem = page.locator('.inbox-item').filter({ hasText: 'Flightradar24' }).first();
    await approvalItem.click();
    await page.locator('.inbox-actions button', { hasText: 'Simulate' }).click();

    await expect(page.locator('.inbox-filter-chip[data-status-filter="needs-fix"]')).toContainText('1');
    await expect(page.locator('.inbox-filter-chip[data-status-filter="actionable"]')).toContainText('2');
    await page.click('.inbox-filter-chip[data-status-filter="needs-fix"]');
    await expect(page.locator('.inbox-item').filter({ hasText: 'Flightradar24' })).toBeVisible();
    await expect(page.locator('.inbox-actions button', { hasText: 'Accept' })).toHaveCount(0);
    await expect(page.locator('.inbox-preview')).toContainText('SKIPPED');
    await expect(page.locator('.inbox-preview')).toContainText('quality 0.31 below threshold');
  });
});

test.describe('Decision Inbox — action result banners', () => {
  test('Accept shows EXECUTED banner for approval items', async ({ page }) => {
    await page.route(`${API_BASE}/approval-queue/approval-smoke-001/review`, route =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          approval: { status: 'executed' },
          execution: {
            summary: 'Feed registered. 12 articles seeded.',
            feedName: 'Flightradar24',
            articleCount: 12,
            quality: 0.72,
            url: 'https://www.flightradar24.com/',
          },
        }),
      }),
    );

    await goToDashboard(page);
    await switchToInbox(page);
    await page.waitForTimeout(1_000);

    const approvalItem = page.locator('.inbox-item').filter({ hasText: 'Flightradar24' }).first();
    await approvalItem.click();
    await page.locator('.inbox-actions button', { hasText: 'Accept' }).click();

    await expect(page.locator('.inbox-result.success .trust-chip', { hasText: 'EXECUTED' })).toBeVisible({ timeout: 5_000 });
    // Meta chips should show feed info
    await expect(page.locator('.inbox-result-meta')).toContainText('Feed');
  });

  test('Reject shows REJECTED banner', async ({ page }) => {
    await page.route(`${API_BASE}/approval-queue/approval-smoke-001/review`, route =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          approval: { status: 'rejected', reasoning: 'Operator rejected manually.' },
        }),
      }),
    );

    await goToDashboard(page);
    await switchToInbox(page);
    await page.waitForTimeout(1_000);

    const approvalItem = page.locator('.inbox-item').filter({ hasText: 'Flightradar24' }).first();
    await approvalItem.click();
    await page.locator('.inbox-actions button', { hasText: 'Reject' }).click();

    await expect(page.locator('.inbox-result.warning .trust-chip', { hasText: 'REJECTED' })).toBeVisible({ timeout: 5_000 });
  });

  test('API error shows FAILED banner', async ({ page }) => {
    await page.route(`${API_BASE}/approval-queue/approval-smoke-001/review`, route =>
      route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'Internal server error' }) }),
    );

    await goToDashboard(page);
    await switchToInbox(page);
    await page.waitForTimeout(1_000);

    const approvalItem = page.locator('.inbox-item').filter({ hasText: 'Flightradar24' }).first();
    await approvalItem.click();
    await page.locator('.inbox-actions button', { hasText: 'Accept' }).click();

    await expect(page.locator('.inbox-result.error .trust-chip-critical', { hasText: 'FAILED' })).toBeVisible({ timeout: 5_000 });
  });

  test('Canonical posts triage decisions to the review endpoint', async ({ page }) => {
    let triageReviewRequest: { url: string; body: any } | null = null;
    page.on('request', request => {
      if (request.method() !== 'POST') return;
      if (!request.url().includes('/api/discovery-triage/review')) return;
      triageReviewRequest = { url: request.url(), body: request.postDataJSON() };
    });

    await goToDashboard(page);
    await switchToInbox(page);
    await page.waitForTimeout(1_000);

    const triageItem = page.locator('.inbox-item').filter({ hasText: 'AI chip export controls' }).first();
    await triageItem.click();
    await page.locator('.inbox-actions button', { hasText: 'Canonical' }).click();

    await expect.poll(() => triageReviewRequest?.url || '').toContain('/api/discovery-triage/review');
    expect(triageReviewRequest?.body).toMatchObject({
      topicId: MOCK_TRIAGE_ITEM.rawId,
      decision: 'canonical',
    });
  });

  test('Canonical API error shows FAILED banner and reports runtime issue', async ({ page }) => {
    let runtimeIssueRequest: any = null;
    page.on('request', request => {
      if (request.method() !== 'POST') return;
      if (!request.url().includes('/api/runtime-issues')) return;
      runtimeIssueRequest = request.postDataJSON();
    });

    await goToDashboard(page, {
      triageReviewResponse: {
        status: 500,
        body: { error: 'Discovery triage write failed' },
      },
    });
    await switchToInbox(page);
    await page.waitForTimeout(1_000);

    const triageItem = page.locator('.inbox-item').filter({ hasText: 'AI chip export controls' }).first();
    await triageItem.click();
    await page.locator('.inbox-actions button', { hasText: 'Canonical' }).click();

    await expect(page.locator('.inbox-result.error .trust-chip-critical', { hasText: 'FAILED' })).toBeVisible({ timeout: 5_000 });
    await expect.poll(() => runtimeIssueRequest).not.toBeNull();
    expect(runtimeIssueRequest).toMatchObject({
      surface: 'decision-inbox',
      action: 'inbox.canonical',
      itemType: 'triage',
      itemId: MOCK_TRIAGE_ITEM.rawId,
      apiRoute: '/api/discovery-triage/review',
      classification: 'api-contract',
      severity: 'review',
    });
  });
});

test.describe('Decision Inbox — bulk action guards', () => {
  test('bulk buttons are disabled with no selection', async ({ page }) => {
    await goToDashboard(page);
    await switchToInbox(page);
    await page.waitForTimeout(1_000);

    // Bulk bar should be hidden / buttons disabled when nothing selected
    const acceptAll = page.locator('#inbox-bulk-accept');
    const rejectAll = page.locator('#inbox-bulk-reject');
    await expect(acceptAll).toBeDisabled();
    await expect(rejectAll).toBeDisabled();
  });

  test('mixed type selection (approval + triage) disables incompatible bulk actions', async ({ page }) => {
    await goToDashboard(page);
    await switchToInbox(page);
    await page.waitForTimeout(1_000);

    // Ctrl+click to multi-select approval + triage (incompatible for bulk accept/reject)
    const approvalItem = page.locator('.inbox-item').filter({ hasText: 'Flightradar24' }).first();
    const triageItem = page.locator('.inbox-item').filter({ hasText: 'AI chip export controls' }).first();

    await approvalItem.click({ modifiers: ['Control'] });
    await triageItem.click({ modifiers: ['Control'] });

    // When mixed types are selected, canBulkApplyDecision('accept') returns false
    // because approval.accept resolves to 'accept' but triage.accept resolves to 'canonical'
    // → bulk accept button should be disabled
    const acceptAll = page.locator('#inbox-bulk-accept');
    await expect(acceptAll).toBeDisabled();
  });
});

test.describe('Decision Inbox — stale/fallback badge', () => {
  test('stale badge appears when snapshot data is old', async ({ page }) => {
    const oldTimestamp = new Date(Date.now() - 60 * 60 * 60 * 1000).toISOString();

    await goToDashboard(page, {
      themeShellSnapshotsResponse: {
        body: {
          risk: {
            generatedAt: new Date().toISOString(),
            oldestInternalUpdatedAt: oldTimestamp,
            updatedAt: oldTimestamp,
            level: 'watch',
            score: 0,
            summary: {},
          },
        },
      },
    });
    // Stay on home surface — risk snapshot card is on home
    await page.waitForTimeout(2_000);

    // Some stale-indicating element should appear (trust-chip-stale or trust-chip-critical)
    // depending on freshness classification
    await expect(page.locator('#risk-snapshot .trust-chip-stale')).toBeVisible({ timeout: 8_000 });
  });
});
