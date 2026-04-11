import type { AppContext, AppModule } from '@/app/app-context';
import type { RelatedAsset } from '@/types';
import type { TheaterPostureSummary } from '@/services/military-surge';
import {
  MapContainer,
  NewsPanel,
  MarketPanel,
  HeatmapPanel,
  CommoditiesPanel,
  CryptoPanel,
  PredictionPanel,
  MonitorPanel,
  EconomicPanel,
  GdeltIntelPanel,
  LiveNewsPanel,
  CIIPanel,
  CascadePanel,
  StrategicRiskPanel,
  StrategicPosturePanel,
  TechEventsPanel,
  ServiceStatusPanel,
  RuntimeConfigPanel,
  InsightsPanel,
  TechReadinessPanel,
  MacroSignalsPanel,
  ETFFlowsPanel,
  StablecoinPanel,
  UcdpEventsPanel,
  DisplacementPanel,
  ClimateAnomalyPanel,
  PopulationExposurePanel,
  InvestmentsPanel,
  TradePolicyPanel,
  SupplyChainPanel,
  CrossAssetTapePanel,
  EventImpactScreenerPanel,
  CountryExposureMatrixPanel,
  DataQAPanel,
  SourceOpsPanel,
  CodexOpsPanel,
  DataFlowOpsPanel,
  OntologyGraphPage,
  TransmissionSankeyPanel,
  SignalRidgelinePanel,
  InvestmentWorkflowPanel,
  InvestmentIdeasPanel,
  BacktestLabPanel,
  ResourceProfilerPanel,
  EventIntelligencePanel,
} from '@/components';
import { SatelliteFiresPanel } from '@/components/SatelliteFiresPanel';
import { PositiveNewsFeedPanel } from '@/components/PositiveNewsFeedPanel';
import { CountersPanel } from '@/components/CountersPanel';
import { ProgressChartsPanel } from '@/components/ProgressChartsPanel';
import { BreakthroughsTickerPanel } from '@/components/BreakthroughsTickerPanel';
import { HeroSpotlightPanel } from '@/components/HeroSpotlightPanel';
import { GoodThingsDigestPanel } from '@/components/GoodThingsDigestPanel';
import { SpeciesComebackPanel } from '@/components/SpeciesComebackPanel';
import { RenewableEnergyPanel } from '@/components/RenewableEnergyPanel';
import { GivingPanel } from '@/components';
import { focusInvestmentOnMap } from '@/services/investments-focus';
import { buildDataQASnapshot } from '@/services/data-qa';
import { getFabricBackedRuntimeView } from '@/services/intelligence-fabric';
import { signalAggregator, type RegionalConvergence } from '@/services/signal-aggregator';
import { getDensityMode, isPanelVisibleInDensity, onDensityChange, DENSITY_MODES } from '@/services/density-mode';
import { debounce, saveToStorage } from '@/utils';
import { escapeHtml } from '@/utils/sanitize';
import {
  FEEDS,
  INTEL_SOURCES,
  DEFAULT_PANELS,
  STORAGE_KEYS,
  SITE_VARIANT,
} from '@/config';
import { isSourceDrawerOnlyPanelKey } from '@/config/panels';
import {
  getWorkspaceDefinition,
  getWorkspaceDefinitions,
  type WorkspaceDefinition,
} from '@/config/workspaces';
import { APP_BRAND } from '@/config/brand';
import { BETA_MODE } from '@/config/beta';
import { t } from '@/services/i18n';
import { getCurrentTheme } from '@/utils';
import { trackCriticalBannerAction } from '@/services/analytics';
import { AnalysisHubPage, type AnalysisHubSnapshot } from '@/components/AnalysisHubPage';
import { CodexHubPage } from '@/components/CodexHubPage';

export interface PanelLayoutCallbacks {
  openCountryStory: (code: string, name: string) => void;
  openCountryBrief?: (code: string) => void;
  loadAllData: () => Promise<void>;
  updateMonitorResults: () => void;
  loadSecurityAdvisories?: () => Promise<void>;
}

function shouldCreateStandaloneSourcePanel(key: string): boolean {
  return !isSourceDrawerOnlyPanelKey(key);
}

function sourceCategoryLabel(key: string): string {
  return DEFAULT_PANELS[key]?.name
    ?? key
      .split(/[-_]+/)
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(' ');
}

function renderSourceDrawer(): string {
  const cards: string[] = [];
  const feedEntries = Object.entries(FEEDS as Record<string, unknown>)
    .filter(([key, value]) => isSourceDrawerOnlyPanelKey(key) && Array.isArray(value))
    .map(([key, value]) => ({
      key,
      label: sourceCategoryLabel(key),
      feeds: value as Array<{ name?: string }>,
    }))
    .sort((a, b) => a.label.localeCompare(b.label));

  for (const entry of feedEntries) {
    const preview = entry.feeds
      .map((feed) => String(feed?.name || '').trim())
      .filter(Boolean)
      .slice(0, 4);
    cards.push(`
      <article class="source-drawer-card">
        <div class="source-drawer-card-head">
          <strong>${escapeHtml(entry.label)}</strong>
          <span>${entry.feeds.length} feeds</span>
        </div>
        <p>${escapeHtml(preview.join(' | ') || 'Dynamic feed bundle')}</p>
      </article>
    `);
  }

  if (Array.isArray(INTEL_SOURCES) && INTEL_SOURCES.length > 0) {
    const preview = INTEL_SOURCES
      .map((feed) => String(feed?.name || '').trim())
      .filter(Boolean)
      .slice(0, 4);
    cards.unshift(`
      <article class="source-drawer-card source-drawer-card-highlight">
        <div class="source-drawer-card-head">
          <strong>${escapeHtml(sourceCategoryLabel('intel'))}</strong>
          <span>${INTEL_SOURCES.length} feeds</span>
        </div>
        <p>${escapeHtml(preview.join(' | ') || 'OSINT and intelligence bundle')}</p>
      </article>
    `);
  }

  cards.unshift(`
    <article class="source-drawer-card source-drawer-card-highlight">
      <div class="source-drawer-card-head">
        <strong>Signal-first source model</strong>
        <span>Core rule</span>
      </div>
      <p>Source categories stay available, but they no longer occupy the main workspace. The core UI consumes normalized signals instead of feed tiles.</p>
    </article>
  `);

  return `
    <aside class="source-drawer" id="sourceDrawer" aria-hidden="true">
      <div class="source-drawer-backdrop" data-close-source-drawer="true"></div>
      <section class="source-drawer-panel" aria-label="Source categories">
        <div class="source-drawer-head">
          <div class="source-drawer-copy">
            <span class="source-drawer-kicker">Sources</span>
            <strong>Source categories moved behind the signal surface</strong>
            <p>Use this drawer to inspect source bundles without turning each category into a standalone dashboard panel.</p>
          </div>
          <button type="button" class="workspace-link-btn" id="sourceDrawerClose">Close</button>
        </div>
        <div class="source-drawer-grid">
          ${cards.join('')}
        </div>
      </section>
    </aside>
  `;
}

function renderWorkspaceStoryCards(workspace: WorkspaceDefinition): string {
  return workspace.flowSteps.map((step) => `
    <article class="workspace-story-card">
      <span class="workspace-story-label">${escapeHtml(step.label)}</span>
      <p>${escapeHtml(step.summary)}</p>
    </article>
  `).join('');
}

function renderWorkspaceFocusAreas(workspace: WorkspaceDefinition): string {
  return workspace.focusAreas
    .map((item) => `<span class="workspace-chip workspace-focus-chip">${escapeHtml(item)}</span>`)
    .join('');
}

function renderOperatorContextBar(ctx: AppContext): string {
  const workspace = getWorkspaceDefinition(ctx.operatorContext.workspaceId, SITE_VARIANT);
  const viewLabels: Record<string, string> = {
    global: t('components.deckgl.views.global'),
    america: t('components.deckgl.views.americas'),
    mena: t('components.deckgl.views.mena'),
    eu: t('components.deckgl.views.europe'),
    asia: t('components.deckgl.views.asia'),
    latam: t('components.deckgl.views.latam'),
    africa: t('components.deckgl.views.africa'),
    oceania: t('components.deckgl.views.oceania'),
  };
  const timeRangeLabels: Record<string, string> = {
    '1h': '1h',
    '6h': '6h',
    '24h': '24h',
    '48h': '48h',
    '7d': '7d',
    all: t('common.all'),
  };
  const selectedTheme = ctx.operatorContext.selectedThemeId;
  const selectedCountry = ctx.operatorContext.selectedCountryCode;
  return `
    <div class="operator-context-bar" id="operatorContextBar" aria-label="Active operator context">
      <span class="operator-context-chip">
        <span class="operator-context-label">Workspace</span>
        <strong class="operator-context-value" id="operatorContextWorkspace">${escapeHtml(workspace.label)}</strong>
      </span>
      <span class="operator-context-chip">
        <span class="operator-context-label">Region</span>
        <strong class="operator-context-value" id="operatorContextRegion">${escapeHtml(viewLabels[ctx.operatorContext.mapView] ?? ctx.operatorContext.mapView)}</strong>
      </span>
      <span class="operator-context-chip">
        <span class="operator-context-label">Range</span>
        <strong class="operator-context-value" id="operatorContextTimeRange">${escapeHtml(timeRangeLabels[ctx.operatorContext.timeRange] ?? ctx.operatorContext.timeRange)}</strong>
      </span>
      <span class="operator-context-chip" id="operatorContextThemeChip"${selectedTheme ? '' : ' hidden'}>
        <span class="operator-context-label">Theme</span>
        <strong class="operator-context-value" id="operatorContextTheme">${escapeHtml(selectedTheme ?? '')}</strong>
      </span>
      <span class="operator-context-chip" id="operatorContextCountryChip"${selectedCountry ? '' : ' hidden'}>
        <span class="operator-context-label">Country</span>
        <strong class="operator-context-value" id="operatorContextCountry">${escapeHtml(selectedCountry ?? '')}</strong>
      </span>
    </div>
  `;
}

function renderThemeWorkspaceShell(ctx: AppContext): string {
  const selectedTheme = ctx.operatorContext.selectedThemeId;
  const showThemeWorkspace = ctx.operatorContext.workspaceId === 'brief' || ctx.operatorContext.workspaceId === 'watch';
  const shellClass = showThemeWorkspace ? 'theme-workspace-shell' : 'theme-workspace-shell workspace-hidden';
  return `
    <section class="${shellClass}" id="themeWorkspaceShell" aria-label="Theme workspace">
      <div class="theme-workspace-shell-head">
        <div class="theme-workspace-shell-copy">
          <span class="theme-workspace-shell-kicker">Theme Workspace</span>
          <strong>Structural change briefing inside the main shell</strong>
          <span id="themeWorkspaceSummary">${selectedTheme ? `Focused on ${escapeHtml(selectedTheme)}` : 'Follow themes, structural alerts, and evidence lanes without leaving the workbench.'}</span>
        </div>
        <div class="theme-workspace-shell-actions">
          <button
            type="button"
            class="workspace-link-btn primary"
            id="themeWorkspaceOpenValidation"
            ${selectedTheme ? '' : 'disabled'}
          >Open validation</button>
          <a class="workspace-link-btn" id="themeWorkspaceOpenStandalone" href="/event-dashboard.html" target="_blank" rel="noopener">Open standalone</a>
        </div>
      </div>
      <div class="theme-workspace-shell-body">
        <iframe
          id="themeWorkspaceFrame"
          class="theme-workspace-frame"
          src="/event-dashboard.html"
          title="Theme Workspace"
          loading="lazy"
          referrerpolicy="strict-origin-when-cross-origin"
        ></iframe>
      </div>
    </section>
  `;
}

export class PanelLayoutManager implements AppModule {
  private ctx: AppContext;
  private callbacks: PanelLayoutCallbacks;
  private panelDragCleanupHandlers: Array<() => void> = [];
  private criticalBannerEl: HTMLElement | null = null;
  private readonly applyTimeRangeFilterDebounced: () => void;
  private densityUnsubscribe: (() => void) | null = null;
  private mapBindingsApplied = false;
  private initialUrlStateApplied = false;

  constructor(ctx: AppContext, callbacks: PanelLayoutCallbacks) {
    this.ctx = ctx;
    this.callbacks = callbacks;
    this.applyTimeRangeFilterDebounced = debounce(() => {
      this.applyTimeRangeFilterToNewsPanels();
    }, 120);
  }

  private dispatchMapFocus(lat: number, lon: number, zoom = 4): void {
    window.dispatchEvent(new CustomEvent('wm:focus-news-location', {
      detail: { lat, lon, zoom },
    }));
  }

  init(): void {
    this.renderLayout();
    // Re-apply panel visibility when density mode changes
    this.densityUnsubscribe = onDensityChange(() => {
      this.applyPanelSettings();
      this.updateDensityToggleUI();
    });
  }

  destroy(): void {
    this.densityUnsubscribe?.();
    this.densityUnsubscribe = null;
    this.ctx.analysisHubPage?.destroy();
    this.ctx.analysisHubPage = null;
    this.ctx.codexHubPage?.destroy();
    this.ctx.codexHubPage = null;
    this.ctx.ontologyGraphPage?.destroy();
    this.ctx.ontologyGraphPage = null;
    this.panelDragCleanupHandlers.forEach((cleanup) => cleanup());
    this.panelDragCleanupHandlers = [];
    if (this.criticalBannerEl) {
      this.criticalBannerEl.remove();
      this.criticalBannerEl = null;
    }
    // Clean up happy variant panels
    this.ctx.tvMode?.destroy();
    this.ctx.tvMode = null;
    this.ctx.countersPanel?.destroy();
    this.ctx.progressPanel?.destroy();
    this.ctx.breakthroughsPanel?.destroy();
    this.ctx.heroPanel?.destroy();
    this.ctx.digestPanel?.destroy();
    this.ctx.speciesPanel?.destroy();
    this.ctx.renewablePanel?.destroy();
  }

  renderLayout(): void {
    const workspaceStrip = this.renderWorkspaceStrip();
    const operatorContextBar = renderOperatorContextBar(this.ctx);
    const themeWorkspaceShell = renderThemeWorkspaceShell(this.ctx);
    const sourceDrawer = SITE_VARIANT === 'happy' ? '' : renderSourceDrawer();
    this.ctx.container.innerHTML = `
      <div class="header">
        <div class="header-left">
          <div class="variant-switcher">${(() => {
            return `
            <a href="#"
               class="variant-option ${SITE_VARIANT === 'full' ? 'active' : ''}"
               data-variant="full"
               title="Geo lens${SITE_VARIANT === 'full' ? ` ${t('common.currentVariant')}` : ''}">
              <span class="variant-icon">${APP_BRAND.variants.full.icon}</span>
              <span class="variant-label">${APP_BRAND.variants.full.label}</span>
            </a>
            <span class="variant-divider"></span>
            <a href="#"
               class="variant-option ${SITE_VARIANT === 'tech' ? 'active' : ''}"
               data-variant="tech"
               title="Build lens${SITE_VARIANT === 'tech' ? ` ${t('common.currentVariant')}` : ''}">
              <span class="variant-icon">${APP_BRAND.variants.tech.icon}</span>
              <span class="variant-label">${APP_BRAND.variants.tech.label}</span>
            </a>
            <span class="variant-divider"></span>
            <a href="#"
               class="variant-option ${SITE_VARIANT === 'finance' ? 'active' : ''}"
               data-variant="finance"
               title="Markets lens${SITE_VARIANT === 'finance' ? ` ${t('common.currentVariant')}` : ''}">
              <span class="variant-icon">${APP_BRAND.variants.finance.icon}</span>
              <span class="variant-label">${APP_BRAND.variants.finance.label}</span>
            </a>
            <span class="variant-divider"></span>
            <a href="#"
               class="variant-option ${SITE_VARIANT === 'happy' ? 'active' : ''}"
               data-variant="happy"
               title="Progress lens${SITE_VARIANT === 'happy' ? ` ${t('common.currentVariant')}` : ''}">
              <span class="variant-icon">${APP_BRAND.variants.happy.icon}</span>
              <span class="variant-label">${APP_BRAND.variants.happy.label}</span>
            </a>`;
          })()}</div>
          <span class="brand-lockup"><span class="logo">${APP_BRAND.mark}</span><span class="logo-subtitle">${APP_BRAND.descriptor}</span></span><span class="version">v${__APP_VERSION__}</span>${BETA_MODE ? '<span class="beta-badge">BETA</span>' : ''}
          <span class="brand-tagline-pill">${APP_BRAND.tagline}</span>
          <a href="https://github.com/koala73/worldmonitor" target="_blank" rel="noopener" class="github-link" title="${t('header.viewOnGitHub')}">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/></svg>
          </a>
          <div class="status-indicator">
            <span class="status-dot"></span>
            <span>${t('header.live')}</span>
          </div>
          <div class="region-selector">
            <select id="regionSelect" class="region-select">
              <option value="global"${this.ctx.operatorContext.mapView === 'global' ? ' selected' : ''}>${t('components.deckgl.views.global')}</option>
              <option value="america"${this.ctx.operatorContext.mapView === 'america' ? ' selected' : ''}>${t('components.deckgl.views.americas')}</option>
              <option value="mena"${this.ctx.operatorContext.mapView === 'mena' ? ' selected' : ''}>${t('components.deckgl.views.mena')}</option>
              <option value="eu"${this.ctx.operatorContext.mapView === 'eu' ? ' selected' : ''}>${t('components.deckgl.views.europe')}</option>
              <option value="asia"${this.ctx.operatorContext.mapView === 'asia' ? ' selected' : ''}>${t('components.deckgl.views.asia')}</option>
              <option value="latam"${this.ctx.operatorContext.mapView === 'latam' ? ' selected' : ''}>${t('components.deckgl.views.latam')}</option>
              <option value="africa"${this.ctx.operatorContext.mapView === 'africa' ? ' selected' : ''}>${t('components.deckgl.views.africa')}</option>
              <option value="oceania"${this.ctx.operatorContext.mapView === 'oceania' ? ' selected' : ''}>${t('components.deckgl.views.oceania')}</option>
            </select>
          </div>
          ${operatorContextBar}
        </div>
        <div class="header-right">
          <div class="header-hub-quicknav" aria-label="Desk shortcuts">
            <button class="hub-toggle-btn" id="analysisHubBtn" title="${APP_BRAND.hubs.analysis}">
              <span class="hub-toggle-icon">A</span>
              <span class="hub-toggle-label">${APP_BRAND.hubs.analysis}</span>
            </button>
            <button class="hub-toggle-btn" id="codexHubBtn" title="${APP_BRAND.hubs.codex}">
              <span class="hub-toggle-icon">C</span>
              <span class="hub-toggle-label">${APP_BRAND.hubs.codex}</span>
            </button>
            <button class="hub-toggle-btn" id="backtestHubBtn" title="${APP_BRAND.hubs.backtest}">
              <span class="hub-toggle-icon">R</span>
              <span class="hub-toggle-label">${APP_BRAND.hubs.backtest}</span>
            </button>
            <button class="hub-toggle-btn" id="ontologyGraphBtn" title="${APP_BRAND.hubs.ontology}">
              <span class="hub-toggle-icon">G</span>
              <span class="hub-toggle-label">${APP_BRAND.hubs.ontology}</span>
            </button>
          </div>
          <button class="density-toggle-btn" id="densityToggleBtn" title="Toggle information density">
            <span class="density-toggle-icon">${DENSITY_MODES.find(m => m.id === getDensityMode())?.icon ?? '▣'}</span>
            <span class="density-toggle-label">${DENSITY_MODES.find(m => m.id === getDensityMode())?.label ?? 'Full'}</span>
          </button>
          <button class="search-btn" id="searchBtn"><kbd>Ctrl+K</kbd> ${t('header.search')}</button>
          ${this.ctx.isDesktopApp ? '' : `<button class="copy-link-btn" id="copyLinkBtn">${t('header.copyLink')}</button>`}
          <button class="theme-toggle-btn" id="headerThemeToggle" title="${t('header.toggleTheme')}">
            ${getCurrentTheme() === 'dark'
        ? '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>'
        : '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z"/></svg>'}
          </button>
          ${this.ctx.isDesktopApp ? '' : `<button class="fullscreen-btn" id="fullscreenBtn" title="${t('header.fullscreen')}">FS</button>`}
          <span id="unifiedSettingsMount"></span>
        </div>
      </div>
      ${SITE_VARIANT === 'happy' ? '' : `
      <div class="terminal-tape" id="terminalTape" aria-live="polite">
        <div class="terminal-tape-left">
          <span class="terminal-chip terminal-chip-label">${APP_BRAND.liveFeedLabel}</span>
          <span class="terminal-chip" id="terminalTapeNewsCount">NEWS 0</span>
          <span class="terminal-chip" id="terminalTapeSourceCount">SRC 0</span>
          <span class="terminal-chip terminal-chip-alert" id="terminalTapeAlertCount">ALERT 0</span>
          <span class="terminal-chip terminal-chip-dim" id="terminalTapeUpdated">UPDATED --:--:--</span>
        </div>
        <div class="terminal-tape-headline" id="terminalTapeHeadline">Waiting for live headlines...</div>
      </div>`}
      ${workspaceStrip}
      ${themeWorkspaceShell}
      ${sourceDrawer}
      <div class="main-content">
        <div class="map-section" id="mapSection">
          <div class="panel-header">
            <div class="panel-header-left">
              <span class="panel-title">${SITE_VARIANT === 'tech' ? APP_BRAND.mapLabels.tech : SITE_VARIANT === 'finance' ? APP_BRAND.mapLabels.finance : SITE_VARIANT === 'happy' ? APP_BRAND.mapLabels.happy : APP_BRAND.mapLabels.full}</span>
            </div>
            <span class="header-clock" id="headerClock"></span>
            <button class="map-pin-btn" id="mapPinBtn" title="${t('header.pinMap')}">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                <path d="M12 17v5M9 10.76a2 2 0 01-1.11 1.79l-1.78.9A2 2 0 005 15.24V16a1 1 0 001 1h12a1 1 0 001-1v-.76a2 2 0 00-1.11-1.79l-1.78-.9A2 2 0 0115 10.76V7a1 1 0 011-1 1 1 0 001-1V4a1 1 0 00-1-1H8a1 1 0 00-1 1v1a1 1 0 001 1 1 1 0 011 1v3.76z"/>
              </svg>
            </button>
          </div>
          <div class="map-container" id="mapContainer"></div>
          ${SITE_VARIANT === 'happy' ? '<button class="tv-exit-btn" id="tvExitBtn">Exit TV Mode</button>' : ''}
          <div class="map-resize-handle" id="mapResizeHandle"></div>
        </div>
        <div class="panels-grid" id="panelsGrid"></div>
      </div>
    `;

    this.createPanels();
  }

  private renderWorkspaceStrip(): string {
    const activeWorkspace = getWorkspaceDefinition(this.ctx.operatorContext.workspaceId, SITE_VARIANT);
    const availablePanels = new Set(Object.keys(DEFAULT_PANELS));
    const workspaceDefs = getWorkspaceDefinitions(SITE_VARIANT).filter((workspace) =>
      workspace.panelKeys.some((key) => availablePanels.has(key)),
    );
    const featuredLabels = activeWorkspace.featuredPanels
      .map((key) => this.ctx.panelSettings[key]?.name ?? DEFAULT_PANELS[key]?.name ?? null)
      .filter((value): value is string => Boolean(value))
      .slice(0, 4);
    const visibleCount = activeWorkspace.panelKeys.filter((key) => availablePanels.has(key)).length;
    const curatedCount = Math.max(
      featuredLabels.length,
      activeWorkspace.featuredPanels.filter((key) => availablePanels.has(key)).length,
    );

    return `
      <div class="workspace-strip" id="workspaceStrip">
        <div class="workspace-strip-main">
          <div class="workspace-strip-kicker">${APP_BRAND.workspaceKicker}</div>
          <div class="workspace-strip-copy">
            <span class="workspace-strip-eyebrow" id="workspaceEyebrow">${escapeHtml(activeWorkspace.eyebrow)}</span>
            <strong id="workspaceTitle">${escapeHtml(activeWorkspace.title)}</strong>
            <span id="workspaceSummary">${escapeHtml(activeWorkspace.description)}</span>
          </div>
          <div class="workspace-switcher" id="workspaceSwitcher" role="tablist" aria-label="Workspace switcher">
            ${workspaceDefs.map((workspace, index) => `
              <button
                class="workspace-tab${workspace.id === activeWorkspace.id ? ' active' : ''}"
                id="workspaceTab-${workspace.id}"
                data-workspace-target="${workspace.id}"
                type="button"
                role="tab"
                aria-selected="${workspace.id === activeWorkspace.id}"
                title="Alt+${index + 1}"
              >${escapeHtml(workspace.label)}</button>
            `).join('')}
          </div>
          <div class="workspace-story" id="workspaceStory">
            ${renderWorkspaceStoryCards(activeWorkspace)}
          </div>
        </div>
        <div class="workspace-strip-side">
          <div class="workspace-intent">
            <span class="workspace-intent-kicker">${escapeHtml(APP_BRAND.tagline)}</span>
            <strong id="workspaceIntentTitle">${escapeHtml(activeWorkspace.heroTitle)}</strong>
            <p id="workspaceIntentSummary">${escapeHtml(activeWorkspace.heroSummary)}</p>
            <div class="workspace-intent-actions">
              ${SITE_VARIANT === 'happy' ? '' : '<button class="workspace-link-btn" type="button" id="sourceDrawerBtn">Open Sources</button>'}
              <button class="workspace-link-btn primary" type="button" data-open-hub="analysis">Open ${APP_BRAND.hubs.analysis}</button>
              ${SITE_VARIANT === 'happy' ? '' : `<button class="workspace-link-btn" type="button" data-open-hub="codex">Open ${APP_BRAND.hubs.codex}</button>`}
              ${SITE_VARIANT === 'happy' ? '' : `<button class="workspace-link-btn" type="button" data-open-hub="backtest">Open ${APP_BRAND.hubs.backtest}</button>`}
              ${SITE_VARIANT === 'happy' ? '' : `<button class="workspace-link-btn" type="button" data-open-hub="ontology">Open ${APP_BRAND.hubs.ontology}</button>`}
            </div>
          </div>
          <div class="workspace-strip-stats">
            <span class="workspace-stat" id="workspaceStat">${visibleCount} modules in view · ${curatedCount} curated</span>
            <span class="workspace-stat subtle" id="workspaceMapMode">${activeWorkspace.showMap ? 'Context map active' : 'Context map tucked away'}</span>
          </div>
          <div class="workspace-focus" id="workspaceFocusAreas">
            ${renderWorkspaceFocusAreas(activeWorkspace)}
          </div>
          <div class="workspace-featured" id="workspaceFeatured">
            ${featuredLabels.length > 0
        ? featuredLabels.map((label) => `<span class="workspace-chip">${escapeHtml(label)}</span>`).join('')
        : '<span class="workspace-chip muted">Workspace suggestions update as this surface fills in</span>'}
          </div>
        </div>
      </div>
    `;
  }

  renderCriticalBanner(postures: TheaterPostureSummary[]): void {
    if (this.ctx.isMobile) {
      if (this.criticalBannerEl) {
        this.criticalBannerEl.remove();
        this.criticalBannerEl = null;
      }
      document.body.classList.remove('has-critical-banner');
      return;
    }

    const dismissedAt = sessionStorage.getItem('banner-dismissed');
    if (dismissedAt && Date.now() - parseInt(dismissedAt, 10) < 30 * 60 * 1000) {
      return;
    }

    const critical = postures.filter(
      (p) => p.postureLevel === 'critical' || (p.postureLevel === 'elevated' && p.strikeCapable)
    );

    if (critical.length === 0) {
      if (this.criticalBannerEl) {
        this.criticalBannerEl.remove();
        this.criticalBannerEl = null;
        document.body.classList.remove('has-critical-banner');
      }
      return;
    }

    const top = critical[0]!;
    const isCritical = top.postureLevel === 'critical';

    if (!this.criticalBannerEl) {
      this.criticalBannerEl = document.createElement('div');
      this.criticalBannerEl.className = 'critical-posture-banner';
      const header = document.querySelector('.header');
      if (header) header.insertAdjacentElement('afterend', this.criticalBannerEl);
    }

    document.body.classList.add('has-critical-banner');
    this.criticalBannerEl.className = `critical-posture-banner ${isCritical ? 'severity-critical' : 'severity-elevated'}`;
    this.criticalBannerEl.innerHTML = `
      <div class="banner-content">
        <span class="banner-icon">${isCritical ? '!!' : '!'}</span>
        <span class="banner-headline">${escapeHtml(top.headline)}</span>
        <span class="banner-stats">${top.totalAircraft} aircraft - ${escapeHtml(top.summary)}</span>
        ${top.strikeCapable ? '<span class="banner-strike">STRIKE CAPABLE</span>' : ''}
      </div>
      <button class="banner-view" data-lat="${top.centerLat}" data-lon="${top.centerLon}">View Region</button>
      <button class="banner-dismiss">x</button>
    `;

    this.criticalBannerEl.querySelector('.banner-view')?.addEventListener('click', () => {
      console.log('[Banner] View Region clicked:', top.theaterId, 'lat:', top.centerLat, 'lon:', top.centerLon);
      trackCriticalBannerAction('view', top.theaterId);
      if (typeof top.centerLat === 'number' && typeof top.centerLon === 'number') {
        this.dispatchMapFocus(top.centerLat, top.centerLon, 4);
      } else {
        console.error('[Banner] Missing coordinates for', top.theaterId);
      }
    });

    this.criticalBannerEl.querySelector('.banner-dismiss')?.addEventListener('click', () => {
      trackCriticalBannerAction('dismiss', top.theaterId);
      this.criticalBannerEl?.classList.add('dismissed');
      document.body.classList.remove('has-critical-banner');
      sessionStorage.setItem('banner-dismissed', Date.now().toString());
    });
  }

  applyPanelSettings(): void {
    const densityMode = getDensityMode();
    Object.entries(this.ctx.panelSettings).forEach(([key, config]) => {
      // A panel is visible only if both: (1) user has it enabled, AND (2) density mode allows it.
      const densityVisible = isPanelVisibleInDensity(key, densityMode);
      const effectiveVisible = config.enabled && densityVisible;

      if (key === 'map') {
        const mapSection = document.getElementById('mapSection');
        if (mapSection) {
          // Map is always visible in all density modes (included in all compact sets)
          mapSection.classList.toggle('hidden', !config.enabled);
        }
        return;
      }
      const panel = this.ctx.panels[key];
      panel?.toggle(effectiveVisible);
    });
  }

  private updateDensityToggleUI(): void {
    const btn = document.getElementById('densityToggleBtn');
    if (!btn) return;
    const mode = getDensityMode();
    const meta = DENSITY_MODES.find(m => m.id === mode);
    const icon = btn.querySelector('.density-toggle-icon');
    const label = btn.querySelector('.density-toggle-label');
    if (icon) icon.textContent = meta?.icon ?? '▣';
    if (label) label.textContent = meta?.label ?? 'Full';
    btn.title = meta?.description ?? 'Toggle information density';
  }

  public ensureMapMounted(forceRender = false): boolean {
    if (!this.ctx.map) {
      const mapContainer = document.getElementById('mapContainer') as HTMLElement | null;
      if (!mapContainer) return false;
      mapContainer.innerHTML = '';
      this.ctx.map = new MapContainer(mapContainer, {
        zoom: this.ctx.isMobile ? 2.5 : 1.0,
        pan: { x: 0, y: 0 },
        view: this.ctx.operatorContext.mapView,
        layers: this.ctx.mapLayers,
        timeRange: this.ctx.operatorContext.timeRange,
      });

      this.ctx.map.initEscalationGetters();
      this.ctx.currentTimeRange = this.ctx.map.getTimeRange();
      this.ctx.setOperatorContext({
        mapView: this.ctx.map.getState().view,
        timeRange: this.ctx.currentTimeRange,
      }, { persist: false });
      this.bindMapStateBridge();
      this.applyInitialUrlState();
      window.dispatchEvent(new CustomEvent('wm:map-mounted'));
    }

    if (forceRender) {
      this.ctx.map?.render();
    }
    return !!this.ctx.map;
  }

  private bindMapStateBridge(): void {
    if (!this.ctx.map || this.mapBindingsApplied) return;
    this.ctx.map.onTimeRangeChanged((range) => {
      this.ctx.currentTimeRange = range;
      this.ctx.setOperatorContext({ timeRange: range }, { persist: false });
      this.applyTimeRangeFilterDebounced();
    });
    this.mapBindingsApplied = true;
  }

  private createPanels(): void {
    const panelsGrid = document.getElementById('panelsGrid')!;
    if (getWorkspaceDefinition(this.ctx.operatorContext.workspaceId, SITE_VARIANT).showMap) {
      this.ensureMapMounted();
    }

    const createSourceNewsPanel = (key: string, label: string): NewsPanel | null => {
      if (!shouldCreateStandaloneSourcePanel(key)) return null;
      const panel = new NewsPanel(key, label);
      this.attachRelatedAssetHandlers(panel);
      this.ctx.newsPanels[key] = panel;
      this.ctx.panels[key] = panel;
      return panel;
    };

    createSourceNewsPanel('politics', t('panels.politics'));
    createSourceNewsPanel('tech', t('panels.tech'));
    createSourceNewsPanel('finance', t('panels.finance'));

    const heatmapPanel = new HeatmapPanel();
    this.ctx.panels['heatmap'] = heatmapPanel;

    const marketsPanel = new MarketPanel();
    this.ctx.panels['markets'] = marketsPanel;

    const monitorPanel = new MonitorPanel(this.ctx.monitors);
    this.ctx.panels['monitors'] = monitorPanel;
    monitorPanel.onChanged((monitors) => {
      this.ctx.monitors = monitors;
      saveToStorage(STORAGE_KEYS.monitors, monitors);
      this.callbacks.updateMonitorResults();
    });

    const commoditiesPanel = new CommoditiesPanel();
    this.ctx.panels['commodities'] = commoditiesPanel;

    const predictionPanel = new PredictionPanel();
    this.ctx.panels['polymarket'] = predictionPanel;

    createSourceNewsPanel('gov', t('panels.gov'));
    createSourceNewsPanel('intel', t('panels.intel'));

    const cryptoPanel = new CryptoPanel();
    this.ctx.panels['crypto'] = cryptoPanel;

    createSourceNewsPanel('middleeast', t('panels.middleeast'));
    createSourceNewsPanel('layoffs', t('panels.layoffs'));
    createSourceNewsPanel('ai', t('panels.ai'));
    createSourceNewsPanel('startups', t('panels.startups'));
    createSourceNewsPanel('vcblogs', t('panels.vcblogs'));
    createSourceNewsPanel('regionalStartups', t('panels.regionalStartups'));
    createSourceNewsPanel('unicorns', t('panels.unicorns'));
    createSourceNewsPanel('accelerators', t('panels.accelerators'));
    createSourceNewsPanel('funding', t('panels.funding'));
    createSourceNewsPanel('producthunt', t('panels.producthunt'));
    createSourceNewsPanel('security', t('panels.security'));
    createSourceNewsPanel('policy', t('panels.policy'));
    createSourceNewsPanel('hardware', t('panels.hardware'));
    createSourceNewsPanel('cloud', t('panels.cloud'));
    createSourceNewsPanel('dev', t('panels.dev'));
    createSourceNewsPanel('github', t('panels.github'));
    createSourceNewsPanel('ipo', t('panels.ipo'));
    createSourceNewsPanel('thinktanks', t('panels.thinktanks'));

    const economicPanel = new EconomicPanel();
    this.ctx.panels['economic'] = economicPanel;

    if (SITE_VARIANT === 'full' || SITE_VARIANT === 'finance') {
      const tradePolicyPanel = new TradePolicyPanel();
      this.ctx.panels['trade-policy'] = tradePolicyPanel;

      const supplyChainPanel = new SupplyChainPanel();
      this.ctx.panels['supply-chain'] = supplyChainPanel;
    }

    createSourceNewsPanel('africa', t('panels.africa'));
    createSourceNewsPanel('latam', t('panels.latam'));
    createSourceNewsPanel('asia', t('panels.asia'));
    createSourceNewsPanel('energy', t('panels.energy'));

    for (const key of Object.keys(FEEDS)) {
      if (!shouldCreateStandaloneSourcePanel(key)) continue;
      if (this.ctx.newsPanels[key]) continue;
      if (!Array.isArray((FEEDS as Record<string, unknown>)[key])) continue;
      const panelKey = this.ctx.panels[key] && !this.ctx.newsPanels[key] ? `${key}-news` : key;
      if (this.ctx.panels[panelKey]) continue;
      const panelConfig = DEFAULT_PANELS[panelKey] ?? DEFAULT_PANELS[key];
      const label = panelConfig?.name ?? key.charAt(0).toUpperCase() + key.slice(1);
      const panel = new NewsPanel(panelKey, label);
      this.attachRelatedAssetHandlers(panel);
      this.ctx.newsPanels[key] = panel;
      this.ctx.panels[panelKey] = panel;
    }

    if (SITE_VARIANT === 'full') {
      if (shouldCreateStandaloneSourcePanel('glint-feed')) {
        const glintFeedPanel = new NewsPanel('glint-feed', 'Glint Feed');
        this.attachRelatedAssetHandlers(glintFeedPanel);
        this.ctx.newsPanels['glint-feed'] = glintFeedPanel;
        this.ctx.panels['glint-feed'] = glintFeedPanel;
      }

      const gdeltIntelPanel = new GdeltIntelPanel();
      this.ctx.panels['gdelt-intel'] = gdeltIntelPanel;

      const ciiPanel = new CIIPanel();
      ciiPanel.setShareStoryHandler((code, name) => {
        this.callbacks.openCountryStory(code, name);
      });
      this.ctx.panels['cii'] = ciiPanel;

      const cascadePanel = new CascadePanel();
      this.ctx.panels['cascade'] = cascadePanel;

      const satelliteFiresPanel = new SatelliteFiresPanel();
      this.ctx.panels['satellite-fires'] = satelliteFiresPanel;

      const strategicRiskPanel = new StrategicRiskPanel();
      strategicRiskPanel.setLocationClickHandler((lat, lon) => {
        this.dispatchMapFocus(lat, lon, 4);
      });
      this.ctx.panels['strategic-risk'] = strategicRiskPanel;

      const strategicPosturePanel = new StrategicPosturePanel();
      strategicPosturePanel.setLocationClickHandler((lat, lon) => {
        console.log('[App] StrategicPosture handler called:', { lat, lon, hasMap: !!this.ctx.map });
        this.dispatchMapFocus(lat, lon, 4);
      });
      this.ctx.panels['strategic-posture'] = strategicPosturePanel;

      const ucdpEventsPanel = new UcdpEventsPanel();
      ucdpEventsPanel.setEventClickHandler((lat, lon) => {
        this.dispatchMapFocus(lat, lon, 5);
      });
      this.ctx.panels['ucdp-events'] = ucdpEventsPanel;

      const displacementPanel = new DisplacementPanel();
      displacementPanel.setCountryClickHandler((lat, lon) => {
        this.dispatchMapFocus(lat, lon, 4);
      });
      this.ctx.panels['displacement'] = displacementPanel;

      const climatePanel = new ClimateAnomalyPanel();
      climatePanel.setZoneClickHandler((lat, lon) => {
        this.dispatchMapFocus(lat, lon, 4);
      });
      this.ctx.panels['climate'] = climatePanel;

      const populationExposurePanel = new PopulationExposurePanel();
      this.ctx.panels['population-exposure'] = populationExposurePanel;
    }

    if (SITE_VARIANT === 'finance') {
      const investmentsPanel = new InvestmentsPanel((inv) => {
        if (this.ensureMapMounted(true)) {
          focusInvestmentOnMap(this.ctx.map, this.ctx.mapLayers, inv.lat, inv.lon);
        }
      });
      this.ctx.panels['gcc-investments'] = investmentsPanel;
    }

    if (SITE_VARIANT !== 'happy') {
      const liveNewsPanel = new LiveNewsPanel();
      this.ctx.panels['live-news'] = liveNewsPanel;

      if (shouldCreateStandaloneSourcePanel('events')) {
        this.ctx.panels['events'] = new TechEventsPanel('events');
      }

      const serviceStatusPanel = new ServiceStatusPanel();
      this.ctx.panels['service-status'] = serviceStatusPanel;

      const dataQaPanel = new DataQAPanel(
        () => buildDataQASnapshot(this.ctx),
        'Data Q&A'
      );
      this.ctx.panels['data-qa'] = dataQaPanel;

      this.ctx.panels['source-ops'] = new SourceOpsPanel();
      this.ctx.panels['codex-ops'] = new CodexOpsPanel();
      this.ctx.panels['dataflow-ops'] = new DataFlowOpsPanel();

      const techReadinessPanel = new TechReadinessPanel();
      this.ctx.panels['tech-readiness'] = techReadinessPanel;

      this.ctx.panels['macro-signals'] = new MacroSignalsPanel();
      this.ctx.panels['etf-flows'] = new ETFFlowsPanel();
      this.ctx.panels['stablecoins'] = new StablecoinPanel();
      this.ctx.panels['transmission-sankey'] = new TransmissionSankeyPanel();
      this.ctx.panels['signal-ridgeline'] = new SignalRidgelinePanel();
      this.ctx.panels['investment-workflow'] = new InvestmentWorkflowPanel();
      this.ctx.panels['investment-ideas'] = new InvestmentIdeasPanel();
      this.ctx.panels['backtest-lab'] = new BacktestLabPanel();
      this.ctx.panels['resource-profiler'] = new ResourceProfilerPanel();

      if (SITE_VARIANT === 'full' || SITE_VARIANT === 'finance' || SITE_VARIANT === 'tech') {
        this.ctx.panels['cross-asset-tape'] = new CrossAssetTapePanel();
        this.ctx.panels['event-impact-screener'] = new EventImpactScreenerPanel();
        this.ctx.panels['country-exposure-matrix'] = new CountryExposureMatrixPanel();
        const eventIntelPanel = new EventIntelligencePanel();
        this.ctx.panels['event-intelligence'] = eventIntelPanel;
      }
    }

    if (this.ctx.isDesktopApp) {
      const runtimeConfigPanel = new RuntimeConfigPanel({ mode: 'alert' });
      this.ctx.panels['runtime-config'] = runtimeConfigPanel;
    }

    const insightsPanel = new InsightsPanel();
    this.ctx.panels['insights'] = insightsPanel;

    // Global Giving panel (all variants)
    this.ctx.panels['giving'] = new GivingPanel();

    // Happy variant panels
    if (SITE_VARIANT === 'happy') {
      this.ctx.positivePanel = new PositiveNewsFeedPanel();
      this.ctx.panels['positive-feed'] = this.ctx.positivePanel;

      this.ctx.countersPanel = new CountersPanel();
      this.ctx.panels['counters'] = this.ctx.countersPanel;
      this.ctx.countersPanel.startTicking();

      this.ctx.progressPanel = new ProgressChartsPanel();
      this.ctx.panels['progress'] = this.ctx.progressPanel;

      this.ctx.breakthroughsPanel = new BreakthroughsTickerPanel();
      this.ctx.panels['breakthroughs'] = this.ctx.breakthroughsPanel;

      this.ctx.heroPanel = new HeroSpotlightPanel();
      this.ctx.panels['spotlight'] = this.ctx.heroPanel;
      this.ctx.heroPanel.onLocationRequest = (lat: number, lon: number) => {
        this.ctx.map?.setCenter(lat, lon, 4);
        this.ctx.map?.flashLocation(lat, lon, 3000);
      };

      this.ctx.digestPanel = new GoodThingsDigestPanel();
      this.ctx.panels['digest'] = this.ctx.digestPanel;

      this.ctx.speciesPanel = new SpeciesComebackPanel();
      this.ctx.panels['species'] = this.ctx.speciesPanel;

      this.ctx.renewablePanel = new RenewableEnergyPanel();
      this.ctx.panels['renewable'] = this.ctx.renewablePanel;
    }

    const defaultOrder = Object.keys(DEFAULT_PANELS).filter(k => k !== 'map');
    const savedOrder = this.getSavedPanelOrder();
    let panelOrder = defaultOrder;
    if (savedOrder.length > 0) {
      const missing = defaultOrder.filter(k => !savedOrder.includes(k));
      const valid = savedOrder.filter(k => defaultOrder.includes(k));
      const monitorsIdx = valid.indexOf('monitors');
      if (monitorsIdx !== -1) valid.splice(monitorsIdx, 1);
      const insertIdx = valid.indexOf('politics') + 1 || 0;
      const newPanels = missing.filter(k => k !== 'monitors');
      valid.splice(insertIdx, 0, ...newPanels);
      if (SITE_VARIANT !== 'happy') {
        valid.push('monitors');
      }
      panelOrder = valid;
    }

    if (SITE_VARIANT !== 'happy') {
      const liveNewsIdx = panelOrder.indexOf('live-news');
      if (liveNewsIdx > 0) {
        panelOrder.splice(liveNewsIdx, 1);
        panelOrder.unshift('live-news');
      }

      const webcamsIdx = panelOrder.indexOf('live-webcams');
      if (webcamsIdx !== -1 && webcamsIdx !== panelOrder.indexOf('live-news') + 1) {
        panelOrder.splice(webcamsIdx, 1);
        const afterNews = panelOrder.indexOf('live-news') + 1;
        panelOrder.splice(afterNews, 0, 'live-webcams');
      }
    }

    if (this.ctx.isDesktopApp) {
      const runtimeIdx = panelOrder.indexOf('runtime-config');
      if (runtimeIdx > 1) {
        panelOrder.splice(runtimeIdx, 1);
        panelOrder.splice(1, 0, 'runtime-config');
      } else if (runtimeIdx === -1) {
        panelOrder.splice(1, 0, 'runtime-config');
      }
    }

    panelOrder.forEach((key: string) => {
      const panel = this.ctx.panels[key];
      if (panel) {
        const el = panel.getElement();
        this.makeDraggable(el, key);
        panelsGrid.appendChild(el);
      }
    });

    this.bindMapStateBridge();

    if (!this.ctx.analysisHubPage) {
      this.ctx.analysisHubPage = new AnalysisHubPage({
        getSnapshot: () => this.buildAnalysisHubSnapshot(),
        onFocusMap: (lat, lon, zoom = 4) => {
          this.dispatchMapFocus(lat, lon, zoom);
        },
      });
    }

    if (!this.ctx.codexHubPage && SITE_VARIANT !== 'happy') {
      this.ctx.codexHubPage = new CodexHubPage({
        getDataQAPanel: () => (this.ctx.panels['data-qa'] as DataQAPanel | undefined) ?? null,
        getSourceOpsPanel: () => (this.ctx.panels['source-ops'] as SourceOpsPanel | undefined) ?? null,
        getCodexOpsPanel: () => (this.ctx.panels['codex-ops'] as CodexOpsPanel | undefined) ?? null,
        getIntelligenceArtifacts: () => {
          const runtimeView = getFabricBackedRuntimeView(this.ctx);
          return {
            reports: runtimeView.intelligenceCache.scheduledReports ?? [],
            transmission: runtimeView.intelligenceCache.eventMarketTransmission ?? null,
            sourceCredibility: runtimeView.intelligenceCache.sourceCredibility ?? [],
          };
        },
      });
    }

    if (!this.ctx.ontologyGraphPage && SITE_VARIANT !== 'happy') {
      this.ctx.ontologyGraphPage = new OntologyGraphPage({
        getSnapshot: () => {
          const runtimeView = getFabricBackedRuntimeView(this.ctx);
          return {
            generatedAt: new Date(),
            keywordGraph: runtimeView.intelligenceCache.keywordGraph ?? null,
            ontologyGraph: runtimeView.intelligenceCache.ontologyGraph ?? null,
            graphRagSummary: runtimeView.intelligenceCache.graphRagSummary ?? null,
            reports: runtimeView.intelligenceCache.scheduledReports ?? [],
            timeslices: runtimeView.intelligenceCache.graphTimeslices ?? [],
            entities: runtimeView.intelligenceCache.ontologyEntities ?? [],
            ledger: runtimeView.intelligenceCache.ontologyLedger ?? [],
            replayState: runtimeView.intelligenceCache.ontologyReplayState ?? null,
            stixBundle: runtimeView.intelligenceCache.stixBundle ?? null,
          };
        },
      });
    }

    this.applyPanelSettings();
    this.applyInitialUrlState();
  }

  private getClusterImportanceScore(cluster: import('@/types').ClusteredEvent): number {
    const threat = String(cluster.threat?.level || '').toLowerCase();
    const threatWeight = threat === 'critical' ? 4 : threat === 'high' ? 3 : threat === 'medium' ? 2 : 1;
    const alertBoost = cluster.isAlert ? 1.4 : 1.0;
    const velocity = cluster.velocity?.level === 'spike'
      ? 1.4
      : cluster.velocity?.level === 'elevated'
        ? 1.15
        : 1;
    return cluster.sourceCount * threatWeight * alertBoost * velocity;
  }

  private getTopConvergenceZones(): RegionalConvergence[] {
    return signalAggregator
      .getRegionalConvergence()
      .slice()
      .sort((a, b) => b.totalSignals - a.totalSignals)
      .slice(0, 8);
  }

  private buildAnalysisHubSnapshot(): AnalysisHubSnapshot {
    const runtimeView = getFabricBackedRuntimeView(this.ctx);
    const strategicRiskPanel = this.ctx.panels['strategic-risk'] as StrategicRiskPanel | undefined;
    const ciiPanel = this.ctx.panels['cii'] as CIIPanel | undefined;
    const strategicPosturePanel = this.ctx.panels['strategic-posture'] as StrategicPosturePanel | undefined;

    const riskOverview = strategicRiskPanel?.getOverview() ?? null;
    const alerts = (strategicRiskPanel?.getAlerts() ?? [])
      .slice()
      .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

    const ciiTop = (ciiPanel?.getScores() ?? [])
      .filter((country) => country.score > 0)
      .slice()
      .sort((a, b) => b.score - a.score)
      .slice(0, 12);

    const topClusters = runtimeView.latestClusters
      .slice()
      .sort((a, b) => this.getClusterImportanceScore(b) - this.getClusterImportanceScore(a))
      .slice(0, 12);

    const topPostures = (strategicPosturePanel?.getPostures() ?? [])
      .slice()
      .sort((a, b) => {
        const score = (p: import('@/services/military-surge').TheaterPostureSummary): number => {
          const level = p.postureLevel === 'critical'
            ? 4
            : p.postureLevel === 'elevated'
              ? 3
              : p.postureLevel === 'normal'
                ? 2
                : 1;
          return level * 100 + p.totalAircraft;
        };
        return score(b) - score(a);
      })
      .slice(0, 8);

    return {
      generatedAt: new Date(),
      riskOverview,
      alerts,
      ciiTop,
      topClusters,
      topPostures,
      convergence: this.getTopConvergenceZones(),
      reports: runtimeView.intelligenceCache.scheduledReports ?? [],
      transmission: runtimeView.intelligenceCache.eventMarketTransmission ?? null,
      sourceCredibility: runtimeView.intelligenceCache.sourceCredibility ?? [],
      multiHopInferences: runtimeView.intelligenceCache.multiHopInferences ?? [],
      investmentIntelligence: runtimeView.intelligenceCache.investmentIntelligence ?? null,
    };
  }

  private applyTimeRangeFilterToNewsPanels(): void {
    Object.entries(this.ctx.newsByCategory).forEach(([category, items]) => {
      const panel = this.ctx.newsPanels[category];
      if (!panel) return;
      const filtered = this.filterItemsByTimeRange(items);
      if (filtered.length === 0 && items.length > 0) {
        panel.renderFilteredEmpty(`No items in ${this.getTimeRangeLabel()}`);
        return;
      }
      panel.renderNews(filtered);
    });
  }

  private filterItemsByTimeRange(items: import('@/types').NewsItem[], range: import('@/components').TimeRange = this.ctx.currentTimeRange): import('@/types').NewsItem[] {
    if (range === 'all') return items;
    const ranges: Record<string, number> = {
      '1h': 60 * 60 * 1000, '6h': 6 * 60 * 60 * 1000,
      '24h': 24 * 60 * 60 * 1000, '48h': 48 * 60 * 60 * 1000,
      '7d': 7 * 24 * 60 * 60 * 1000, 'all': Infinity,
    };
    const cutoff = Date.now() - (ranges[range] ?? Infinity);
    return items.filter((item) => {
      const ts = item.pubDate instanceof Date ? item.pubDate.getTime() : new Date(item.pubDate).getTime();
      return Number.isFinite(ts) ? ts >= cutoff : true;
    });
  }

  private getTimeRangeLabel(): string {
    const labels: Record<string, string> = {
      '1h': 'the last hour', '6h': 'the last 6 hours',
      '24h': 'the last 24 hours', '48h': 'the last 48 hours',
      '7d': 'the last 7 days', 'all': 'all time',
    };
    return labels[this.ctx.currentTimeRange] ?? 'the last 7 days';
  }

  private applyInitialUrlState(): void {
    if (this.initialUrlStateApplied || !this.ctx.initialUrlState || !this.ctx.map) return;

    const { view, zoom, lat, lon, timeRange, layers } = this.ctx.initialUrlState;

    if (view) {
      this.ctx.map.setView(view);
    }

    if (timeRange) {
      this.ctx.map.setTimeRange(timeRange);
    }

    if (layers) {
      this.ctx.mapLayers = layers;
      saveToStorage(STORAGE_KEYS.mapLayers, this.ctx.mapLayers);
      this.ctx.map.setLayers(layers);
    }

    if (!view) {
      if (zoom !== undefined) {
        this.ctx.map.setZoom(zoom);
      }
      if (lat !== undefined && lon !== undefined && zoom !== undefined && zoom > 2) {
        this.ctx.map.setCenter(lat, lon);
      }
    }

    const regionSelect = document.getElementById('regionSelect') as HTMLSelectElement;
    const currentView = this.ctx.map.getState().view;
    if (regionSelect && currentView) {
      regionSelect.value = currentView;
    }
    this.ctx.currentTimeRange = this.ctx.map.getTimeRange();
    this.ctx.setOperatorContext({
      mapView: currentView,
      timeRange: this.ctx.currentTimeRange,
    }, { persist: false });
    this.initialUrlStateApplied = true;
  }

  private getSavedPanelOrder(): string[] {
    try {
      const saved = localStorage.getItem(this.ctx.PANEL_ORDER_KEY);
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  }

  savePanelOrder(): void {
    const grid = document.getElementById('panelsGrid');
    if (!grid) return;
    const order = Array.from(grid.children)
      .map((el) => (el as HTMLElement).dataset.panel)
      .filter((key): key is string => !!key);
    localStorage.setItem(this.ctx.PANEL_ORDER_KEY, JSON.stringify(order));
  }

  private attachRelatedAssetHandlers(panel: NewsPanel): void {
    panel.setRelatedAssetHandlers({
      onRelatedAssetClick: (asset) => this.handleRelatedAssetClick(asset),
      onRelatedAssetsFocus: (assets) => {
        if (this.ensureMapMounted()) {
          this.ctx.map?.highlightAssets(assets);
        }
      },
      onRelatedAssetsClear: () => this.ctx.map?.highlightAssets(null),
    });
  }

  private handleRelatedAssetClick(asset: RelatedAsset): void {
    if (!this.ensureMapMounted(true)) return;
    const map = this.ctx.map;
    if (!map) return;

    switch (asset.type) {
      case 'pipeline':
        map.enableLayer('pipelines');
        this.ctx.mapLayers.pipelines = true;
        saveToStorage(STORAGE_KEYS.mapLayers, this.ctx.mapLayers);
        map.triggerPipelineClick(asset.id);
        break;
      case 'cable':
        map.enableLayer('cables');
        this.ctx.mapLayers.cables = true;
        saveToStorage(STORAGE_KEYS.mapLayers, this.ctx.mapLayers);
        map.triggerCableClick(asset.id);
        break;
      case 'datacenter':
        map.enableLayer('datacenters');
        this.ctx.mapLayers.datacenters = true;
        saveToStorage(STORAGE_KEYS.mapLayers, this.ctx.mapLayers);
        map.triggerDatacenterClick(asset.id);
        break;
      case 'base':
        map.enableLayer('bases');
        this.ctx.mapLayers.bases = true;
        saveToStorage(STORAGE_KEYS.mapLayers, this.ctx.mapLayers);
        map.triggerBaseClick(asset.id);
        break;
      case 'nuclear':
        map.enableLayer('nuclear');
        this.ctx.mapLayers.nuclear = true;
        saveToStorage(STORAGE_KEYS.mapLayers, this.ctx.mapLayers);
        map.triggerNuclearClick(asset.id);
        break;
    }
  }

  private makeDraggable(el: HTMLElement, key: string): void {
    el.dataset.panel = key;
    let isDragging = false;
    let dragStarted = false;
    let startX = 0;
    let startY = 0;
    let rafId = 0;
    const DRAG_THRESHOLD = 8;

    const onMouseDown = (e: MouseEvent) => {
      if (e.button !== 0) return;
      const target = e.target as HTMLElement;
      if (el.dataset.resizing === 'true') return;
      if (target.classList?.contains('panel-resize-handle') || target.closest?.('.panel-resize-handle')) return;
      if (target.closest('button, a, input, select, textarea, .panel-content')) return;

      isDragging = true;
      dragStarted = false;
      startX = e.clientX;
      startY = e.clientY;
      e.preventDefault();
    };

    const onMouseMove = (e: MouseEvent) => {
      if (!isDragging) return;
      if (!dragStarted) {
        const dx = Math.abs(e.clientX - startX);
        const dy = Math.abs(e.clientY - startY);
        if (dx < DRAG_THRESHOLD && dy < DRAG_THRESHOLD) return;
        dragStarted = true;
        el.classList.add('dragging');
      }
      const cx = e.clientX;
      const cy = e.clientY;
      if (rafId) cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        this.handlePanelDragMove(el, cx, cy);
        rafId = 0;
      });
    };

    const onMouseUp = () => {
      if (!isDragging) return;
      isDragging = false;
      if (rafId) { cancelAnimationFrame(rafId); rafId = 0; }
      if (dragStarted) {
        el.classList.remove('dragging');
        this.savePanelOrder();
      }
      dragStarted = false;
    };

    el.addEventListener('mousedown', onMouseDown);
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);

    this.panelDragCleanupHandlers.push(() => {
      el.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      if (rafId) {
        cancelAnimationFrame(rafId);
        rafId = 0;
      }
      isDragging = false;
      dragStarted = false;
      el.classList.remove('dragging');
    });
  }

  private handlePanelDragMove(dragging: HTMLElement, clientX: number, clientY: number): void {
    const grid = document.getElementById('panelsGrid');
    if (!grid) return;

    dragging.style.pointerEvents = 'none';
    const target = document.elementFromPoint(clientX, clientY);
    dragging.style.pointerEvents = '';

    if (!target) return;
    const targetPanel = target.closest('.panel') as HTMLElement | null;
    if (!targetPanel || targetPanel === dragging || targetPanel.classList.contains('hidden')) return;
    if (targetPanel.parentElement !== grid) return;

    const targetRect = targetPanel.getBoundingClientRect();
    const draggingRect = dragging.getBoundingClientRect();

    const children = Array.from(grid.children);
    const dragIdx = children.indexOf(dragging);
    const targetIdx = children.indexOf(targetPanel);
    if (dragIdx === -1 || targetIdx === -1) return;

    const sameRow = Math.abs(draggingRect.top - targetRect.top) < 30;
    const targetMid = sameRow
      ? targetRect.left + targetRect.width / 2
      : targetRect.top + targetRect.height / 2;
    const cursorPos = sameRow ? clientX : clientY;

    if (dragIdx < targetIdx) {
      if (cursorPos > targetMid) {
        grid.insertBefore(dragging, targetPanel.nextSibling);
      }
    } else {
      if (cursorPos < targetMid) {
        grid.insertBefore(dragging, targetPanel);
      }
    }
  }

  public ensureCorrectZones(): void {
    // Compatibility shim: previous layout manager exposed this hook.
    // The current layout no longer keeps separate zone caches; a resize is enough.
    this.ctx.map?.resize();
  }

  getLocalizedPanelName(panelKey: string, fallback: string): string {
    if (panelKey === 'runtime-config') {
      return t('modals.runtimeConfig.title');
    }
    const key = panelKey.replace(/-([a-z])/g, (_match, group: string) => group.toUpperCase());
    const lookup = `panels.${key}`;
    const localized = t(lookup);
    return localized === lookup ? fallback : localized;
  }

  getAllSourceNames(): string[] {
    const sources = new Set<string>();
    Object.values(FEEDS).forEach(feeds => {
      if (feeds) feeds.forEach(f => sources.add(f.name));
    });
    INTEL_SOURCES.forEach(f => sources.add(f.name));
    return Array.from(sources).sort((a, b) => a.localeCompare(b));
  }
}
