import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { repoPath } from './_workspace-paths.mjs';

describe('signal-first product surface guardrails', () => {
  it('promotes signal-first panels and demotes replay validation in panel defaults', () => {
    const source = readFileSync(repoPath('src/config/panels.ts'), 'utf8');
    assert.equal(source.includes("'event-intelligence': { name: 'Event Intelligence', enabled: true, priority: 1 }"), true);
    assert.equal(source.includes("'source-ops': { name: 'Source Operations', enabled: true, priority: 1 }"), true);
    assert.equal(source.includes("'investment-workflow': { name: 'Decision Workflow', enabled: true, priority: 2 }"), true);
    assert.equal(source.includes("'investment-ideas': { name: 'Signal Candidates', enabled: true, priority: 2 }"), true);
    assert.equal(source.includes("'backtest-lab': { name: 'Replay Validation', enabled: true, priority: 3 }"), true);
  });

  it('reframes workspaces around signal and decision support instead of replay-first workflows', () => {
    const source = readFileSync(repoPath('src/config/workspaces.ts'), 'utf8');
    assert.equal(source.includes("featuredPanels: ['live-news', 'event-intelligence', 'insights', 'macro-signals']"), true);
    assert.equal(source.includes("title: 'Validate Workspace'"), true);
    assert.equal(source.includes("featuredPanels: ['backtest-lab', 'investment-workflow', 'investment-ideas', 'macro-signals']"), true);
    assert.equal(source.includes("featuredPanels: ['dataflow-ops', 'source-ops', 'runtime-config', 'resource-profiler']"), true);
  });

  it('keeps the five canonical workspaces, legacy aliases, and map semantics aligned with the signal model', () => {
    const source = readFileSync(repoPath('src/config/workspaces.ts'), 'utf8');
    assert.equal(source.includes("id: 'signals'"), true);
    assert.equal(source.includes("id: 'brief'"), true);
    assert.equal(source.includes("id: 'watch'"), true);
    assert.equal(source.includes("id: 'validate'"), true);
    assert.equal(source.includes("id: 'operate'"), true);
    assert.equal(source.includes("intelligence: 'brief'"), true);
    assert.equal(source.includes("investing: 'validate'"), true);
    assert.equal(source.includes("overview: 'signals'"), true);
    assert.equal(source.includes("operations: 'operate'"), true);
    assert.equal(source.includes("progress: 'watch'"), true);
    assert.equal(source.includes("showMap: false"), true);
    assert.equal(source.includes("focusAreas: ['Theme context', 'Country lens', 'Evidence quality'],\n    showMap: true"), true);
  });

  it('keeps the default dev stack from auto-starting heavy background automation', () => {
    const source = readFileSync(repoPath('scripts/dev-full.mjs'), 'utf8');
    assert.equal(source.includes("LOCAL_API_BACKGROUND_AUTOMATION: 'false'"), true);
  });

  it('keeps the desktop sidecar lazy-started instead of booting node on every desktop launch', () => {
    const source = readFileSync(repoPath('src-tauri/src/main.rs'), 'utf8');
    assert.equal(source.includes('fn ensure_local_api_started(app: AppHandle, webview: Webview) -> Result<u16, String> {'), true);
    assert.equal(source.includes('local API sidecar lazy-start is enabled; startup defers until the renderer requests local runtime services'), true);
    assert.equal(source.includes('if let Err(err) = start_local_api(&app.handle()) {'), false);
    assert.equal(source.includes('start_local_api(&app)?;'), true);
  });

  it('centralizes drawer-only source panels and keeps them out of the default signal surface', () => {
    const panelsSource = readFileSync(repoPath('src/config/panels.ts'), 'utf8');
    const settingsSource = readFileSync(repoPath('src/components/UnifiedSettings.ts'), 'utf8');
    assert.equal(panelsSource.includes('export const SOURCE_DRAWER_ONLY_PANEL_KEYS = ['), true);
    assert.equal(panelsSource.includes('export function isSourceDrawerOnlyPanelKey(key: string): boolean {'), true);
    assert.equal(panelsSource.includes('enabled: false,'), true);
    assert.equal(settingsSource.includes('!isSourceDrawerOnlyPanelKey(key)'), true);
  });

  it('uses signal-first settings categories instead of legacy variant feed walls', () => {
    const panelsSource = readFileSync(repoPath('src/config/panels.ts'), 'utf8');
    const settingsSource = readFileSync(repoPath('src/components/UnifiedSettings.ts'), 'utf8');
    assert.equal(panelsSource.includes("label: 'Signal Loop'"), true);
    assert.equal(panelsSource.includes("label: 'Market Impact'"), true);
    assert.equal(panelsSource.includes("label: 'Operate'"), true);
    assert.equal(panelsSource.includes('header.panelCatRegionalNews'), false);
    assert.equal(settingsSource.includes('catDef.label || (catDef.labelKey ? t(catDef.labelKey) : catKey)'), true);
  });

  it('keeps internal subtools aligned with the runtime and validate vocabulary', () => {
    const settingsWindowSource = readFileSync(repoPath('src/settings-main.ts'), 'utf8');
    const backtestHubSource = readFileSync(repoPath('src/backtest-hub-window.ts'), 'utf8');
    assert.equal(settingsWindowSource.includes("let activeSection = 'runtime';"), true);
    assert.equal(settingsWindowSource.includes('<span class=\"settings-nav-label\">Runtime</span>'), true);
    assert.equal(backtestHubSource.includes("type BacktestHubView = 'mission' | 'decision' | 'data' | 'history' | 'intel';"), true);
    assert.equal(backtestHubSource.includes("label: hubLabel('Mission', '미션')"), true);
    assert.equal(backtestHubSource.includes("private view: BacktestHubView = 'mission';"), true);
  });

  it('uses a message bridge for the embedded theme workspace instead of polling iframe URLs', () => {
    const shellSource = readFileSync(repoPath('src/app/event-handlers.ts'), 'utf8');
    const dashboardSource = readFileSync(repoPath('event-dashboard.html'), 'utf8');
    assert.equal(shellSource.includes("type: 'wm-theme-workspace-context'"), true);
    assert.equal(shellSource.includes("data.type === 'wm-theme-workspace-ready'"), true);
    assert.equal(shellSource.includes('themeWorkspaceSyncIntervalId'), false);
    assert.equal(dashboardSource.includes("source:'theme-workspace'"), true);
    assert.equal(dashboardSource.includes("source!=='operator-shell'"), true);
  });

  it('makes the theme shell the canonical root entry and retires the old main page from the user path', () => {
    const indexSource = readFileSync(repoPath('index.html'), 'utf8');
    const dashboardSource = readFileSync(repoPath('event-dashboard.html'), 'utf8');
    assert.equal(indexSource.includes("window.location.replace(target.toString());"), true);
    assert.equal(indexSource.includes('/event-dashboard.html'), true);
    assert.equal(dashboardSource.includes('The theme shell is now the primary product surface.'), true);
  });

  it('surfaces operator diagnostics directly inside the theme shell', () => {
    const dashboardSource = readFileSync(repoPath('event-dashboard.html'), 'utf8');
    assert.equal(dashboardSource.includes('id="operator-health"'), true);
    assert.equal(dashboardSource.includes('id="operator-data-quality"'), true);
    assert.equal(dashboardSource.includes('id="operator-codex-quality"'), true);
    assert.equal(dashboardSource.includes('loadSystemHealth(),loadDataQuality(),loadCodexQuality()'), true);
  });

  it('keeps absorbed legacy geo, transmission, and source-ops summaries visible in the theme shell', () => {
    const dashboardSource = readFileSync(repoPath('event-dashboard.html'), 'utf8');
    assert.equal(dashboardSource.includes('id="geo-pressure-snapshot"'), true);
    assert.equal(dashboardSource.includes('id="transmission-snapshot"'), true);
    assert.equal(dashboardSource.includes('id="source-ops-snapshot"'), true);
    assert.equal(dashboardSource.includes('renderGeoPressureSnapshot(data?.geoPressure||{},cachedAt,cached);'), true);
    assert.equal(dashboardSource.includes('renderTransmissionSnapshot(data?.transmission||{},cachedAt,cached);'), true);
    assert.equal(dashboardSource.includes('renderSourceOpsSnapshot(data?.sourceOps||{},cachedAt,cached);'), true);
  });

  it('shows persisted self-tuning state inside the compact investment shell and avoids default-browser-only profiles', () => {
    const dashboardSource = readFileSync(repoPath('event-dashboard.html'), 'utf8');
    const loaderSource = readFileSync(repoPath('src/app/data-loader.ts'), 'utf8');
    const learningStateSource = readFileSync(repoPath('src/services/investment/learning-state-io.ts'), 'utf8');
    const orchestratorSource = readFileSync(repoPath('src/services/investment/orchestrator.ts'), 'utf8');
    assert.equal(dashboardSource.includes('Self-tuning ${escapeHtml(String(tuning.lastAction||\'observe\').toUpperCase())}'), true);
    assert.equal(dashboardSource.includes('Signals ${escapeHtml(signalRuntime.source||\'missing\')} | coverage ${fmtWhole(signalRuntime.coverage||0)}/5'), true);
    assert.equal(loaderSource.includes('await hydratePersistedExperimentRegistry().catch(() => null);'), true);
    assert.equal(learningStateSource.includes('EXPERIMENT_REGISTRY_KEY'), true);
    assert.equal(learningStateSource.includes('applyExperimentRegistrySnapshot'), true);
    assert.equal(orchestratorSource.includes('integration.signalRuntime = buildSignalRuntimeMeta({'), true);
  });

  it('surfaces transmission freshness in the theme shell instead of silently using stale linkage data', () => {
    const dashboardSource = readFileSync(repoPath('event-dashboard.html'), 'utf8');
    const snapshotBuilderSource = readFileSync(repoPath('scripts/_shared/theme-shell-snapshot-builders.mjs'), 'utf8');
    assert.equal(dashboardSource.includes('Transmission ${snapshot.fresh?\'fresh\':\'stale\'}'), true);
    assert.equal(snapshotBuilderSource.includes('freshnessHours'), true);
    assert.equal(snapshotBuilderSource.includes('transmissionFreshnessHours'), true);
  });

  it('propagates evolution focus into the embedded 2D map lens context', () => {
    const dashboardSource = readFileSync(repoPath('event-dashboard.html'), 'utf8');
    const mapLensSource = readFileSync(repoPath('src/theme-map-lens.ts'), 'utf8');
    assert.equal(dashboardSource.includes('evolutionParent:state.evolutionParent||null'), true);
    assert.equal(dashboardSource.includes('emitEmbeddedContext();'), true);
    assert.equal(mapLensSource.includes('evolutionParent: string | null;'), true);
    assert.equal(mapLensSource.includes('resolvePreset(context.theme, context.evolutionParent)'), true);
  });

  it('keeps hotspots and conflict overlays enabled by default across all theme map presets', () => {
    const mapLensSource = readFileSync(repoPath('src/theme-map-lens.ts'), 'utf8');
    assert.equal(mapLensSource.includes("function buildTechnologyPreset(): LensPreset {\n  return {\n    id: 'technology-science'"), true);
    assert.equal(mapLensSource.includes("function buildMacroPreset(): LensPreset {\n  return {\n    id: 'macro-investment'"), true);
    assert.equal(mapLensSource.includes("function buildClimatePreset(): LensPreset {\n  return {\n    id: 'climate-resilience'"), true);
    assert.equal(mapLensSource.includes("'conflicts',\n      'datacenters'"), true);
    assert.equal(mapLensSource.includes("'conflicts',\n      'economic'"), true);
    assert.equal(mapLensSource.includes("'conflicts',\n      'climate'"), true);
    assert.equal(mapLensSource.includes("'hotspots',"), true);
  });
});
