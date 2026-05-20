import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

const ROOT = process.cwd();

async function read(relPath) {
  return readFile(path.join(ROOT, relPath), 'utf8');
}

async function listFiles(relDir, extensions) {
  const dir = path.join(ROOT, relDir);
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const relPath = `${relDir}/${entry.name}`;
    if (entry.isDirectory()) {
      files.push(...await listFiles(relPath, extensions));
    } else if (extensions.some((ext) => entry.name.endsWith(ext))) {
      files.push(relPath);
    }
  }
  return files;
}

const USER_FACING_EVIDENCE_FILES = [
  'api/event-uplift-grades.js',
  'api/kpi-summary.js',
  'scripts/event-dashboard-api.mjs',
  'scripts/_shared/ai-analysis-builder.mjs',
  'scripts/_shared/event-decision-alerts.mjs',
  'scripts/_shared/event-intelligence-builder.mjs',
];

test('user-facing evidence routes must gate raw E2/E3/E4 before promotion', async () => {
  for (const relPath of USER_FACING_EVIDENCE_FILES) {
    const source = await read(relPath);
    if (!source.includes('event_uplift')) continue;
    assert.match(
      source,
      /HOT_EVENTS_MIN_PROMOTION_CONTROLS|MIN_PROMOTION_CONTROLS/,
      `${relPath} reads event_uplift but does not reference the promotion-control threshold`,
    );
    assert.match(
      source,
      /n_controls/,
      `${relPath} reads event_uplift but does not gate/report matched controls`,
    );
    assert.match(
      source,
      /market_relevance/,
      `${relPath} reads event_uplift but does not gate/report market relevance`,
    );
  }
});

test('serverless user-facing APIs must not fall back to hardcoded NAS passwords', async () => {
  const apiFiles = (await readdir(path.join(ROOT, 'api')))
    .filter((name) => name.endsWith('.js'))
    .map((name) => `api/${name}`);
  for (const relPath of apiFiles) {
    const source = await read(relPath);
    assert.equal(source.includes('lattice1234'), false, `${relPath} contains a hardcoded NAS password fallback`);
  }
});

test('runtime scripts must not contain the old hardcoded NAS password', async () => {
  const files = [
    ...await listFiles('api', ['.js']),
    ...await listFiles('scripts', ['.mjs', '.js', '.py']),
    ...await listFiles('src', ['.ts', '.tsx', '.js']),
  ];
  for (const relPath of files) {
    const source = await read(relPath);
    assert.equal(source.includes('lattice1234'), false, `${relPath} contains the old hardcoded NAS password`);
  }
});

test('ops status freshness thresholds match actual daemon cadence', async () => {
  const source = await read('scripts/event-dashboard-api.mjs');
  assert.match(source, /OPS_DAEMON_FRESH_MS = 30 \* 60 \* 1000/);
  assert.match(source, /OPS_ACCUMULATOR_FRESH_MS = 150 \* 60 \* 1000/);
  assert.match(source, /rollUpOpsLevel/);
  assert.match(source, /healthStatus: modelHealthStatus/);
  assert.match(source, /effectiveECE/);
  assert.match(source, /promotionGates/);
  assert.match(source, /recommendedActions/);
});

test('read-only calibration API does not emit alerts unless explicitly requested', async () => {
  const source = await read('scripts/event-dashboard-api.mjs');
  assert.match(source, /segments\[0\] === 'api' && segments\[1\] === 'calibration'/);
  assert.match(source, /emit_alert/);
  assert.match(source, /emitAlert \? \{ alertFn: sendAlert \} : \{\}/);
  assert.match(source, /message\.startsWith\('Meta-model calibration drift:'\)/);
});

test('locale JSON files must parse cleanly before runtime language loading', async () => {
  const localeFiles = (await readdir(path.join(ROOT, 'src/locales')))
    .filter((name) => name.endsWith('.json'))
    .map((name) => `src/locales/${name}`);
  for (const relPath of localeFiles) {
    const source = await read(relPath);
    assert.doesNotThrow(() => JSON.parse(source), `${relPath} is invalid JSON`);
  }
});

test('dashboard peek must render raw blocked grades differently from promoted grades', async () => {
  const source = await read('event-dashboard.html');
  assert.match(source, /formatUpliftGradeForPeek/, 'event peek should use the raw/promoted grade formatter');
  assert.match(source, /rawEvidenceGrade/, 'event peek should inspect rawEvidenceGrade');
  assert.match(source, /blocked:/, 'event peek should surface blocked raw-grade reasons');
});

test('primary dashboard and locale files must not expose known mojibake separators', async () => {
  for (const relPath of ['event-dashboard.html', 'src/locales/en.json', 'src/locales/ko.json', 'scripts/_shared/ai-analysis-builder.mjs']) {
    const source = await read(relPath);
    for (const token of ['\uCA0C', '\uD69E', '\uFFFD']) {
      assert.equal(source.includes(token), false, `${relPath} still contains mojibake separator text`);
    }
  }
});

test('serverless KPI summary must query latest signal values per signal, not by global timestamp', async () => {
  const source = await read('api/kpi-summary.js');
  assert.match(source, /FROM signal_history sh/, 'KPI signal query should alias the outer signal_history table');
  assert.match(source, /FROM signal_history sh2/, 'KPI signal query should use a separate inner alias');
  assert.match(source, /sh2\.signal_name = sh\.signal_name/, 'KPI latest-signal subquery must correlate by signal name');
});

test('regime timeline routes must de-duplicate intraday VIX rows by date', async () => {
  for (const relPath of ['api/regime-timeline.js', 'scripts/event-dashboard-api.mjs']) {
    const source = await read(relPath);
    assert.match(source, /DISTINCT ON \(DATE\(ts\)\)/, `${relPath} should select one VIX row per date`);
    assert.match(source, /ORDER BY DATE\(ts\), ts DESC/, `${relPath} should use the latest VIX sample per date`);
  }
});

test('dashboard surfaces must resolve API base dynamically for local and deployed modes', async () => {
  const dashboard = await read('event-dashboard.html');
  const mapLens = await read('src/theme-map-lens.ts');
  assert.match(dashboard, /function resolveSignalApiBase\(\)/, 'dashboard should not hardcode only localhost API base');
  assert.match(mapLens, /function resolveSignalApiBase\(\)/, 'map lens should not hardcode only localhost API base');
  assert.equal(dashboard.includes("const API='http://localhost:46200/api'"), false);
  assert.equal(dashboard.includes("const NAS_API = 'http://localhost:46200/api'"), false);
  assert.equal(mapLens.includes("const API = 'http://localhost:46200/api'"), false);
});

test('dashboard deep report flow stays DB-first with local API fallback and clear status', async () => {
  const dashboard = await read('event-dashboard.html');
  assert.match(dashboard, /id="deep-research-report-section"/, 'home should expose the primary deep report workflow');
  assert.match(dashboard, /Same Deep Research generator as above/, 'workspace shortcut should not read as a second generator');
  assert.match(dashboard, /function setDeepReportStatus\(html\)/, 'status should mirror across both deep report entry points');
  assert.match(dashboard, /id="deep-report-status-workspace"/, 'workspace shortcut should have a mirrored status target');
  assert.match(dashboard, /const SIGNAL_API_PORT='46200'/, 'dashboard should preserve the local signal API port fallback');
  assert.equal(
    dashboard.includes("candidates.push(`http://localhost:${SIGNAL_API_PORT}/api`);"),
    true,
    'report generation should keep localhost:46200 as a fallback candidate',
  );
  assert.equal(
    dashboard.includes('fetch(`${base}/reports/generate`,'),
    true,
    'deep report generation should POST to /reports/generate',
  );
  assert.match(dashboard, /requestDeepReport\(\{\.\.\.basePayload,db:false,source:'offline-fallback',sample:false\}\)/);
  assert.match(dashboard, /Open report/, 'successful generation should surface the report link');
});

test('dashboard followed themes should stay compact and canonicalized', async () => {
  const dashboard = await read('event-dashboard.html');
  assert.match(dashboard, /function renderThemeCompactRow/, 'followed themes should render through compact rows');
  assert.match(dashboard, /class="theme-collapse"/, 'followed theme lists should be collapsible');
  assert.match(dashboard, /theme-watchlist-rail/, 'followed themes should expose a compact chip rail');
  assert.match(dashboard, /function normalizeThemeRecordMap/, 'legacy localStorage theme metadata should be canonicalized');
  assert.equal(
    dashboard.includes(".replace(/[^a-z0-9]+/g,'-')"),
    true,
    'theme keys should collapse spaces, slashes, and underscores to a single canonical slug',
  );
});

test('decision inbox should not resurface finalized discovery triage items', async () => {
  const dashboard = await read('event-dashboard.html');
  assert.match(dashboard, /function isFinalDiscoveryTriageItem\(triage\)/);
  assert.match(dashboard, /state === 'canonical' \|\| state === 'suppressed'/);
  assert.match(dashboard, /\.filter\(\(triage\) => !isFinalDiscoveryTriageItem\(triage\)\)/);
});

test('decision inbox exposes a safe accept-all keyword path for discovery items', async () => {
  const dashboard = await read('event-dashboard.html');
  const api = await read('scripts/event-dashboard-api.mjs');
  assert.match(dashboard, /id="inbox-accept-keywords"/, 'decision inbox should expose an accept-all keywords button');
  assert.match(dashboard, /function getVisibleKeywordInboxItems\(\)/, 'bulk keyword action should operate on currently visible inbox items');
  assert.match(dashboard, /item\.type === 'triage'/, 'bulk keyword action should only target discovery triage items');
  assert.match(dashboard, /function inboxAcceptAllKeywords\(\)/, 'dashboard should implement a dedicated bulk keyword action');
  assert.match(dashboard, /\/discovery-triage\/bulk-review/, 'dashboard should call the server bulk-review endpoint');
  assert.match(api, /segments\[2\] === 'bulk-review'/, 'API should expose discovery-triage bulk-review');
  assert.match(api, /\.slice\(0, 100\)/, 'bulk-review should cap request fanout');
  assert.match(api, /recordInboxAction\(getPool\(\), \{[\s\S]*itemType: 'discovery'/, 'bulk-review should write inbox audit rows');
});

test('blocked approval items must expose a safe retry path instead of a dead accept state', async () => {
  const dashboard = await read('event-dashboard.html');
  assert.match(dashboard, /data-inbox-action="retry"/, 'blocked approval rows should show a Retry Check button');
  assert.match(dashboard, /retry: 'accept'/, 'retry should map to the existing server-side approval execution path');
  assert.match(dashboard, /Retry Check re-runs the same server-side gates/, 'retry copy should explain that validation gates still apply');
});

test('ops surface must expose model trust as a first-class card', async () => {
  const dashboard = await read('event-dashboard.html');
  assert.match(dashboard, /id="operator-model-health"/);
  assert.match(dashboard, /async function loadModelHealth\(\)/);
  assert.match(dashboard, /Promotion gates/);
  assert.match(dashboard, /Effective ECE/);
  assert.match(dashboard, /loadModelHealth\(\)/);
});

test('user-facing event uplift routes must bound the historical evidence window', async () => {
  for (const relPath of ['api/event-uplift-grades.js', 'scripts/event-dashboard-api.mjs']) {
    const source = await read(relPath);
    assert.match(source, /EVIDENCE_GRADE_WINDOW_DAYS/, `${relPath} should expose a bounded UI evidence window`);
    assert.match(source, /event_date >= CURRENT_DATE - INTERVAL/, `${relPath} should bound event_uplift UI reads by event_date`);
  }
});

test('weekly digest endpoint must be cache-first unless explicit refresh is requested', async () => {
  const source = await read('scripts/_shared/ai-analysis-builder.mjs');
  const dashboard = await read('event-dashboard.html');
  assert.match(source, /WEEKLY_DIGEST_CACHE_TTL_MS/, 'weekly digest should define a freshness window');
  assert.match(source, /if \(cached && !forceRefresh && isFreshWeeklyDigestCache\(cached\)\)/, 'weekly digest should serve fresh cache without Codex');
  assert.match(source, /if \(!forceRefresh\)/, 'weekly digest default path should not call Codex');
  assert.match(source, /buildDeterministicWeeklyDigest/, 'weekly digest should have a deterministic non-Codex fallback');
  assert.match(dashboard, /weekly-digest\?refresh=1/, 'manual Generate via Codex button should explicitly request refresh');
});

test('dashboard API reads should avoid broken URLs and unscoped hot-event aggregation', async () => {
  const dashboard = await read('event-dashboard.html');
  const api = await read('scripts/event-dashboard-api.mjs');
  const hotEvents = await read('scripts/_shared/event-intelligence-builder.mjs');
  assert.equal(dashboard.includes('/regime//'), false, 'dashboard should not call a double-slash regime URL');
  assert.match(hotEvents, /JOIN recent_events re ON re\.id = aem\.canonical_event_id/, 'hot events should scope article quality to candidate events');
  assert.match(hotEvents, /JOIN recent_events re ON re\.id = eu\.canonical_event_id/, 'hot events should scope uplift aggregation to candidate events');
  assert.match(api, /WITH topic_keywords\(topic, keyword\) AS/, 'trends endpoint should scan topics in one grouped query');
  assert.equal(api.match(/FROM articles WHERE \$\{cond\}/)?.length || 0, 0, 'trends endpoint should not run sequential per-topic article scans');
});

test('dashboard should not download unbounded pending validation payloads', async () => {
  const dashboard = await read('event-dashboard.html');
  const api = await read('scripts/event-dashboard-api.mjs');
  assert.match(dashboard, /\/pending\?limit=20/, 'dashboard should request a bounded pending page');
  assert.match(api, /Math\.min\(200, Number\(params\.get\('limit'\)\)/, 'pending endpoint should clamp caller-provided limit');
  assert.match(api, /LIMIT \$1/, 'pending endpoint should apply SQL LIMIT');
  assert.match(api, /PARTITION BY COALESCE\(symbol, ''\), COALESCE\(theme, ''\)/, 'pending endpoint should collapse duplicate symbol/theme rows for the dashboard overview');
});
