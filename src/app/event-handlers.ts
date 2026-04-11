import type { AppContext, AppModule } from '@/app/app-context';
import type { PanelConfig } from '@/types';
import type { MapView, TimeRange } from '@/components';
import type { ClusteredEvent } from '@/types';
import type { DashboardSnapshot } from '@/services/storage';
import {
  PlaybackControl,
  StatusPanel,
  MobileWarningModal,
  PizzIntIndicator,
  CIIPanel,
  PredictionPanel,
} from '@/components';
import {
  buildMapUrl,
  debounce,
  saveToStorage,
  ExportPanel,
  getCurrentTheme,
  setTheme,
} from '@/utils';
import { escapeHtml } from '@/utils/sanitize';
import {
  STORAGE_KEYS,
  SITE_VARIANT,
  LAYER_TO_SOURCE,
  FEEDS,
  INTEL_SOURCES,
  DEFAULT_PANELS,
} from '@/config';
import {
  saveSnapshot,
  initAisStream,
  disconnectAisStream,
} from '@/services';
import {
  trackPanelView,
  trackVariantSwitch,
  trackThemeChanged,
  trackMapViewChange,
  trackMapLayerToggle,
  trackPanelToggled,
} from '@/services/analytics';
import { cycleDensityMode } from '@/services/density-mode';
import { invokeTauri } from '@/services/tauri-bridge';
import { dataFreshness } from '@/services/data-freshness';
import { mlWorker } from '@/services/ml-worker';
import { openBacktestHubWindow } from '@/services/backtest-hub-launcher';
import {
  getInvestmentFocusContext,
  INVESTMENT_FOCUS_EVENT_NAME,
  setInvestmentFocusContext,
} from '@/services/investment-focus-context';
import { UnifiedSettings } from '@/components/UnifiedSettings';
import { t, getCurrentLanguage } from '@/services/i18n';
import { TvModeController } from '@/services/tv-mode';
import { getCountryNameByCode } from '@/services/country-geometry';
import {
  getWorkspaceDefinition,
  resolveWorkspaceId,
  LEGACY_WORKSPACE_STORAGE_KEY,
  type WorkspaceDefinition,
  type WorkspaceId,
  WORKSPACE_STORAGE_KEY,
} from '@/config/workspaces';
import { LEGACY_VARIANT_STORAGE_KEY, VARIANT_STORAGE_KEY } from '@/config/variant';

export interface EventHandlerCallbacks {
  updateSearchIndex: () => void;
  loadAllData: () => Promise<void>;
  flushStaleRefreshes: () => void;
  setHiddenSince: (ts: number) => void;
  ensureMapMounted?: (forceRender?: boolean) => boolean;
  loadDataForLayer: (layer: string) => void;
  waitForAisData: () => void;
  syncDataFreshnessWithLayers: () => void;
  ensureCorrectZones?: () => void;
  refreshOpenCountryBrief?: () => void;
  flushIntelligenceFabric?: () => void;
}

export class EventHandlerManager implements AppModule {
  private ctx: AppContext;
  private callbacks: EventHandlerCallbacks;

  private boundFullscreenHandler: (() => void) | null = null;
  private boundResizeHandler: (() => void) | null = null;
  private boundVisibilityHandler: (() => void) | null = null;
  private boundDesktopExternalLinkHandler: ((e: MouseEvent) => void) | null = null;
  private boundIdleResetHandler: (() => void) | null = null;
  private boundHotkeyHandler: ((e: KeyboardEvent) => void) | null = null;
  private boundNewsTelemetryHandler: ((e: Event) => void) | null = null;
  private boundNewsMapFocusHandler: ((e: Event) => void) | null = null;
  private boundOpenCodexHubHandler: ((e: Event) => void) | null = null;
  private boundOpenHubRequestHandler: ((e: Event) => void) | null = null;
  private boundHubVisibilityHandler: ((e: Event) => void) | null = null;
  private boundOperatorContextHandler: ((e: Event) => void) | null = null;
  private boundThemeFocusRequestHandler: ((e: Event) => void) | null = null;
  private boundThemeWorkspaceMessageHandler: ((e: MessageEvent) => void) | null = null;
  private boundInvestmentFocusHandler: ((e: Event) => void) | null = null;
  private boundDeferredMapBootstrapHandler: (() => void) | null = null;
  private idleTimeoutId: ReturnType<typeof setTimeout> | null = null;
  private snapshotIntervalId: ReturnType<typeof setInterval> | null = null;
  private clockIntervalId: ReturnType<typeof setInterval> | null = null;
  private tapeHeadlineIntervalId: ReturnType<typeof setInterval> | null = null;
  private tapeHeadlines: string[] = [];
  private tapeHeadlineIndex = -1;
  private focusedHeadlineIndex = -1;
  private readonly IDLE_PAUSE_MS = 2 * 60 * 1000;
  private activeWorkspace: WorkspaceId = getWorkspaceDefinition().id;
  private mapLayerHandlersBound = false;
  private urlStateSyncBound = false;

  constructor(ctx: AppContext, callbacks: EventHandlerCallbacks) {
    this.ctx = ctx;
    this.callbacks = callbacks;
  }

  private renderWorkspaceStory(workspace: WorkspaceDefinition): string {
    return workspace.flowSteps.map((step) => `
      <article class="workspace-story-card">
        <span class="workspace-story-label">${escapeHtml(step.label)}</span>
        <p>${escapeHtml(step.summary)}</p>
      </article>
    `).join('');
  }

  private renderWorkspaceFocus(workspace: WorkspaceDefinition): string {
    return workspace.focusAreas
      .map((item) => `<span class="workspace-chip workspace-focus-chip">${escapeHtml(item)}</span>`)
      .join('');
  }

  init(): void {
    this.setupEventListeners();
    this.setupWorkspaceShell();
    this.setupOperatorContextBinding();
    this.setupThemeWorkspaceShell();
    this.setupSourceDrawer();
    this.setupTerminalTape();
    this.setupKeyboardShortcuts();
    this.setupIdleDetection();
    this.setupTvMode();
  }

  private setupTvMode(): void {
    if (SITE_VARIANT !== 'happy') return;

    const tvBtn = document.getElementById('tvModeBtn');
    const tvExitBtn = document.getElementById('tvExitBtn');
    if (tvBtn) {
      tvBtn.addEventListener('click', () => this.toggleTvMode());
    }
    if (tvExitBtn) {
      tvExitBtn.addEventListener('click', () => this.toggleTvMode());
    }
    // Keyboard shortcut: Shift+T
    document.addEventListener('keydown', (e) => {
      if (e.shiftKey && e.key === 'T' && !e.ctrlKey && !e.metaKey && !e.altKey) {
        const active = document.activeElement;
        if (active?.tagName !== 'INPUT' && active?.tagName !== 'TEXTAREA') {
          e.preventDefault();
          this.toggleTvMode();
        }
      }
    });
  }

  private toggleTvMode(): void {
    const panelKeys = Object.keys(DEFAULT_PANELS).filter(
      key => this.ctx.panelSettings[key]?.enabled !== false
    );
    if (!this.ctx.tvMode) {
      this.ctx.tvMode = new TvModeController({
        panelKeys,
        onPanelChange: () => {
          document.getElementById('tvModeBtn')?.classList.toggle('active', this.ctx.tvMode?.active ?? false);
        }
      });
    } else {
      this.ctx.tvMode.updatePanelKeys(panelKeys);
    }
    this.ctx.tvMode.toggle();
    document.getElementById('tvModeBtn')?.classList.toggle('active', this.ctx.tvMode.active);
  }

  destroy(): void {
    if (this.boundFullscreenHandler) {
      document.removeEventListener('fullscreenchange', this.boundFullscreenHandler);
      this.boundFullscreenHandler = null;
    }
    if (this.boundResizeHandler) {
      window.removeEventListener('resize', this.boundResizeHandler);
      this.boundResizeHandler = null;
    }
    if (this.boundVisibilityHandler) {
      document.removeEventListener('visibilitychange', this.boundVisibilityHandler);
      this.boundVisibilityHandler = null;
    }
    if (this.boundDesktopExternalLinkHandler) {
      document.removeEventListener('click', this.boundDesktopExternalLinkHandler, true);
      this.boundDesktopExternalLinkHandler = null;
    }
    if (this.idleTimeoutId) {
      clearTimeout(this.idleTimeoutId);
      this.idleTimeoutId = null;
    }
    if (this.boundIdleResetHandler) {
      ['mousedown', 'keydown', 'scroll', 'touchstart', 'mousemove'].forEach(event => {
        document.removeEventListener(event, this.boundIdleResetHandler!);
      });
      this.boundIdleResetHandler = null;
    }
    if (this.snapshotIntervalId) {
      clearInterval(this.snapshotIntervalId);
      this.snapshotIntervalId = null;
    }
    if (this.clockIntervalId) {
      clearInterval(this.clockIntervalId);
      this.clockIntervalId = null;
    }
    if (this.tapeHeadlineIntervalId) {
      clearInterval(this.tapeHeadlineIntervalId);
      this.tapeHeadlineIntervalId = null;
    }
    if (this.boundNewsTelemetryHandler) {
      window.removeEventListener('wm:news-telemetry', this.boundNewsTelemetryHandler);
      this.boundNewsTelemetryHandler = null;
    }
    if (this.boundNewsMapFocusHandler) {
      window.removeEventListener('wm:focus-news-location', this.boundNewsMapFocusHandler);
      this.boundNewsMapFocusHandler = null;
    }
    if (this.boundOpenCodexHubHandler) {
      window.removeEventListener('wm:open-codex-hub', this.boundOpenCodexHubHandler);
      this.boundOpenCodexHubHandler = null;
    }
    if (this.boundOpenHubRequestHandler) {
      window.removeEventListener('wm:open-hub', this.boundOpenHubRequestHandler);
      this.boundOpenHubRequestHandler = null;
    }
    if (this.boundHubVisibilityHandler) {
      window.removeEventListener('wm:hub-visibility', this.boundHubVisibilityHandler);
      this.boundHubVisibilityHandler = null;
    }
    if (this.boundOperatorContextHandler) {
      window.removeEventListener('wm:operator-context-changed', this.boundOperatorContextHandler);
      this.boundOperatorContextHandler = null;
    }
    if (this.boundThemeFocusRequestHandler) {
      window.removeEventListener('wm:focus-theme', this.boundThemeFocusRequestHandler);
      this.boundThemeFocusRequestHandler = null;
    }
    if (this.boundThemeWorkspaceMessageHandler) {
      window.removeEventListener('message', this.boundThemeWorkspaceMessageHandler);
      this.boundThemeWorkspaceMessageHandler = null;
    }
    if (this.boundInvestmentFocusHandler) {
      window.removeEventListener(INVESTMENT_FOCUS_EVENT_NAME, this.boundInvestmentFocusHandler);
      this.boundInvestmentFocusHandler = null;
    }
    if (this.boundDeferredMapBootstrapHandler) {
      window.removeEventListener('wm:map-mounted', this.boundDeferredMapBootstrapHandler);
      this.boundDeferredMapBootstrapHandler = null;
    }
    if (this.boundHotkeyHandler) {
      document.removeEventListener('keydown', this.boundHotkeyHandler);
      this.boundHotkeyHandler = null;
    }
    this.ctx.tvMode?.destroy();
    this.ctx.tvMode = null;
    this.ctx.unifiedSettings?.destroy();
    this.ctx.unifiedSettings = null;
  }

  private setupEventListeners(): void {
    const syncHubQuickNav = (active: 'analysis' | 'codex' | 'backtest' | 'ontology' | null): void => {
      const buttonMap: Record<string, 'analysis' | 'codex' | 'backtest' | 'ontology'> = {
        analysisHubBtn: 'analysis',
        codexHubBtn: 'codex',
        backtestHubBtn: 'backtest',
        ontologyGraphBtn: 'ontology',
      };
      Object.entries(buttonMap).forEach(([id, hub]) => {
        const button = document.getElementById(id);
        button?.classList.toggle('active', active === hub);
      });
    };

    const resolveVisibleHub = (): 'analysis' | 'codex' | 'ontology' | null => {
      if (this.ctx.analysisHubPage?.isVisible()) return 'analysis';
      if (this.ctx.codexHubPage?.isVisible()) return 'codex';
      if (this.ctx.ontologyGraphPage?.isVisible()) return 'ontology';
      return null;
    };

    const openHub = (hub: 'analysis' | 'codex' | 'backtest' | 'ontology'): void => {
      const hideOverlayHubs = (): void => {
        this.ctx.analysisHubPage?.hide();
        this.ctx.codexHubPage?.hide();
        this.ctx.ontologyGraphPage?.hide();
      };

      if (hub === 'analysis') {
        const alreadyVisible = this.ctx.analysisHubPage?.isVisible() ?? false;
        hideOverlayHubs();
        syncHubQuickNav(alreadyVisible ? null : 'analysis');
        if (!alreadyVisible) this.ctx.analysisHubPage?.show();
        return;
      }
      if (hub === 'codex') {
        const alreadyVisible = this.ctx.codexHubPage?.isVisible() ?? false;
        hideOverlayHubs();
        syncHubQuickNav(alreadyVisible ? null : 'codex');
        if (!alreadyVisible) this.ctx.codexHubPage?.show();
        return;
      }
      if (hub === 'backtest') {
        syncHubQuickNav('backtest');
        void openBacktestHubWindow();
        window.setTimeout(() => syncHubQuickNav(null), 1400);
        return;
      }
      const alreadyVisible = this.ctx.ontologyGraphPage?.isVisible() ?? false;
      hideOverlayHubs();
      syncHubQuickNav(alreadyVisible ? null : 'ontology');
      if (!alreadyVisible) this.ctx.ontologyGraphPage?.show();
    };

    document.getElementById('searchBtn')?.addEventListener('click', () => {
      this.callbacks.updateSearchIndex();
      this.ctx.searchModal?.open();
    });
    document.getElementById('analysisHubBtn')?.addEventListener('click', () => {
      openHub('analysis');
    });
    document.getElementById('codexHubBtn')?.addEventListener('click', () => {
      openHub('codex');
    });
    document.getElementById('backtestHubBtn')?.addEventListener('click', () => {
      openHub('backtest');
    });
    document.getElementById('ontologyGraphBtn')?.addEventListener('click', () => {
      openHub('ontology');
    });
    this.ctx.container.querySelectorAll<HTMLElement>('[data-open-hub]').forEach((button) => {
      button.addEventListener('click', () => {
        const hub = button.dataset.openHub;
        if (hub === 'analysis' || hub === 'codex' || hub === 'backtest' || hub === 'ontology') {
          openHub(hub);
        }
      });
    });

    if (this.boundOpenCodexHubHandler) {
      window.removeEventListener('wm:open-codex-hub', this.boundOpenCodexHubHandler);
    }
    this.boundOpenCodexHubHandler = () => {
      this.ctx.codexHubPage?.show();
    };
    window.addEventListener('wm:open-codex-hub', this.boundOpenCodexHubHandler);

    if (this.boundOpenHubRequestHandler) {
      window.removeEventListener('wm:open-hub', this.boundOpenHubRequestHandler);
    }
    this.boundOpenHubRequestHandler = (event: Event) => {
      const detail = (event as CustomEvent<{ hub?: string }>).detail;
      const hub = detail?.hub;
      if (hub === 'analysis' || hub === 'codex' || hub === 'backtest' || hub === 'ontology') {
        openHub(hub);
      }
    };
    window.addEventListener('wm:open-hub', this.boundOpenHubRequestHandler);

    if (this.boundHubVisibilityHandler) {
      window.removeEventListener('wm:hub-visibility', this.boundHubVisibilityHandler);
    }
    this.boundHubVisibilityHandler = (event: Event) => {
      const detail = (event as CustomEvent<{ hub?: string; visible?: boolean }>).detail;
      if (!detail || (detail.hub !== 'analysis' && detail.hub !== 'codex' && detail.hub !== 'ontology')) return;
      syncHubQuickNav(detail.visible ? detail.hub : resolveVisibleHub());
    };
    window.addEventListener('wm:hub-visibility', this.boundHubVisibilityHandler);

    document.getElementById('copyLinkBtn')?.addEventListener('click', async () => {
      const shareUrl = this.getShareUrl();
      if (!shareUrl) return;
      const button = document.getElementById('copyLinkBtn');
      try {
        await this.copyToClipboard(shareUrl);
        this.setCopyLinkFeedback(button, 'Copied!');
      } catch (error) {
        console.warn('Failed to copy share link:', error);
        this.setCopyLinkFeedback(button, 'Copy failed');
      }
    });

    window.addEventListener('storage', (e) => {
      if (e.key === STORAGE_KEYS.panels && e.newValue) {
        try {
          this.ctx.panelSettings = JSON.parse(e.newValue) as Record<string, PanelConfig>;
          this.applyPanelSettings();
          this.ctx.unifiedSettings?.refreshPanelToggles();
        } catch (_) {}
      }
      if (e.key === STORAGE_KEYS.liveChannels && e.newValue) {
        const panel = this.ctx.panels['live-news'];
        if (panel && typeof (panel as unknown as { refreshChannelsFromStorage?: () => void }).refreshChannelsFromStorage === 'function') {
          (panel as unknown as { refreshChannelsFromStorage: () => void }).refreshChannelsFromStorage();
        }
      }
    });

    document.getElementById('headerThemeToggle')?.addEventListener('click', () => {
      const next = getCurrentTheme() === 'dark' ? 'light' : 'dark';
      setTheme(next);
      this.updateHeaderThemeIcon();
      trackThemeChanged(next);
    });

    // Density mode toggle
    document.getElementById('densityToggleBtn')?.addEventListener('click', () => {
      cycleDensityMode();
    });

    this.ctx.container.querySelectorAll<HTMLAnchorElement>('.variant-option').forEach(link => {
      link.addEventListener('click', (e) => {
        const variant = link.dataset.variant;
        if (!variant || variant === SITE_VARIANT) return;
        e.preventDefault();
        trackVariantSwitch(SITE_VARIANT, variant);
        localStorage.setItem(VARIANT_STORAGE_KEY, variant);
        localStorage.setItem(LEGACY_VARIANT_STORAGE_KEY, variant);
        window.location.reload();
      });
    });

    const fullscreenBtn = document.getElementById('fullscreenBtn');
    if (!this.ctx.isDesktopApp && fullscreenBtn) {
      fullscreenBtn.addEventListener('click', () => this.toggleFullscreen());
      this.boundFullscreenHandler = () => {
        fullscreenBtn.textContent = document.fullscreenElement ? '\u26F6' : '\u26F6';
        fullscreenBtn.classList.toggle('active', !!document.fullscreenElement);
      };
      document.addEventListener('fullscreenchange', this.boundFullscreenHandler);
    }

    const regionSelect = document.getElementById('regionSelect') as HTMLSelectElement;
    regionSelect?.addEventListener('change', () => {
      this.ctx.map?.setView(regionSelect.value as MapView);
      this.ctx.setOperatorContext({ mapView: regionSelect.value as MapView });
      trackMapViewChange(regionSelect.value);
    });

    this.boundResizeHandler = () => {
      this.ctx.map?.render();
    };
    window.addEventListener('resize', this.boundResizeHandler);

    this.setupMapResize();
    this.setupMapPin();

    this.boundVisibilityHandler = () => {
      document.body.classList.toggle('animations-paused', document.hidden);
      if (document.hidden) {
        this.callbacks.setHiddenSince(Date.now());
        mlWorker.unloadOptionalModels();
        void this.callbacks.flushIntelligenceFabric?.();
      } else {
        this.resetIdleTimer();
        this.callbacks.flushStaleRefreshes();
      }
    };
    document.addEventListener('visibilitychange', this.boundVisibilityHandler);

    window.addEventListener('focal-points-ready', () => {
      (this.ctx.panels['cii'] as CIIPanel)?.refresh(true);
    });

    window.addEventListener('theme-changed', () => {
      this.ctx.map?.render();
      this.updateHeaderThemeIcon();
    });

    if (this.ctx.isDesktopApp) {
      if (this.boundDesktopExternalLinkHandler) {
        document.removeEventListener('click', this.boundDesktopExternalLinkHandler, true);
      }
      this.boundDesktopExternalLinkHandler = (e: MouseEvent) => {
        if (!(e.target instanceof Element)) return;
        const anchor = e.target.closest('a[href]') as HTMLAnchorElement | null;
        if (!anchor) return;
        const href = anchor.href;
        if (!href || href.startsWith('javascript:') || href === '#' || href.startsWith('#')) return;
        try {
          const url = new URL(href, window.location.href);
          if (url.origin === window.location.origin) return;
          e.preventDefault();
          e.stopPropagation();
          void invokeTauri<void>('open_url', { url: url.toString() }).catch(() => {
            window.open(url.toString(), '_blank');
          });
        } catch { /* malformed URL -- let browser handle */ }
      };
      document.addEventListener('click', this.boundDesktopExternalLinkHandler, true);
    }

    if (this.boundNewsMapFocusHandler) {
      window.removeEventListener('wm:focus-news-location', this.boundNewsMapFocusHandler);
    }
    this.boundNewsMapFocusHandler = (event: Event) => {
      const detail = (event as CustomEvent<{ lat?: number; lon?: number; zoom?: number }>).detail;
      const lat = Number(detail?.lat);
      const lon = Number(detail?.lon);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;
      const zoom = Number(detail?.zoom);
      const nextZoom = Number.isFinite(zoom) ? Math.max(2, Math.min(7, zoom)) : 4;
      if (!getWorkspaceDefinition(this.activeWorkspace, SITE_VARIANT).showMap) {
        this.setActiveWorkspace('brief');
      }
      this.callbacks.ensureMapMounted?.(true);
      this.ctx.map?.setCenter(lat, lon, nextZoom);
      document.getElementById('mapSection')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    };
    window.addEventListener('wm:focus-news-location', this.boundNewsMapFocusHandler);

    if (this.boundThemeFocusRequestHandler) {
      window.removeEventListener('wm:focus-theme', this.boundThemeFocusRequestHandler);
    }
    this.boundThemeFocusRequestHandler = (event: Event) => {
      const detail = (event as CustomEvent<{
        themeId?: string;
        workspaceId?: WorkspaceId | string;
        scrollTarget?: 'theme-workspace' | 'validation' | 'none';
      }>).detail;
      const workspaceId = resolveWorkspaceId(detail?.workspaceId, SITE_VARIANT);
      if (workspaceId === 'validate') {
        this.openValidationWorkspace(detail?.themeId, detail?.scrollTarget === 'none' ? 'none' : 'validation');
        return;
      }
      this.focusThemeInWorkspace(detail?.themeId, workspaceId, detail?.scrollTarget ?? 'theme-workspace');
    };
    window.addEventListener('wm:focus-theme', this.boundThemeFocusRequestHandler);

    if (this.boundInvestmentFocusHandler) {
      window.removeEventListener(INVESTMENT_FOCUS_EVENT_NAME, this.boundInvestmentFocusHandler);
    }
    this.boundInvestmentFocusHandler = (event: Event) => {
      const detail = (event as CustomEvent<{ themeId?: string | null }>).detail;
      const themeId = this.normalizeThemeId(detail?.themeId || null);
      if (!themeId || themeId === this.ctx.operatorContext.selectedThemeId) return;
      this.ctx.setOperatorContext({ selectedThemeId: themeId });
    };
    window.addEventListener(INVESTMENT_FOCUS_EVENT_NAME, this.boundInvestmentFocusHandler);
  }

  private setupWorkspaceShell(): void {
    this.activeWorkspace = getWorkspaceDefinition(this.ctx.operatorContext.workspaceId, SITE_VARIANT).id;
    this.ctx.setOperatorContext({ workspaceId: this.activeWorkspace }, { persist: false });

    this.ctx.container.querySelectorAll<HTMLButtonElement>('[data-workspace-target]').forEach((button) => {
      button.addEventListener('click', () => {
        const next = button.dataset.workspaceTarget;
        if (!next) return;
        this.setActiveWorkspace(next as WorkspaceId);
      });
    });

    this.applyWorkspaceMode();
  }

  private setActiveWorkspace(nextWorkspace: WorkspaceId): void {
    const resolved = getWorkspaceDefinition(nextWorkspace, SITE_VARIANT).id;
    if (resolved === this.activeWorkspace) return;
    this.activeWorkspace = resolved;
    localStorage.setItem(WORKSPACE_STORAGE_KEY, this.activeWorkspace);
    localStorage.setItem(LEGACY_WORKSPACE_STORAGE_KEY, this.activeWorkspace);
    this.ctx.setOperatorContext({ workspaceId: this.activeWorkspace });
    this.applyWorkspaceMode();
    this.syncUrlState();
  }

  private normalizeThemeId(value: string | null | undefined): string | null {
    if (typeof value !== 'string') return null;
    const normalized = value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
    if (!normalized || normalized === 'unknown') return null;
    return normalized;
  }

  private scrollWorkspaceTarget(target: 'theme-workspace' | 'validation' | 'none' = 'none'): void {
    if (target === 'none') return;
    window.requestAnimationFrame(() => {
      if (target === 'theme-workspace') {
        document.getElementById('themeWorkspaceShell')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        return;
      }
      document.querySelector<HTMLElement>('[data-panel="backtest-lab"]')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }

  private syncValidationFocusFromOperatorContext(): void {
    const selectedThemeId = this.normalizeThemeId(this.ctx.operatorContext.selectedThemeId);
    const focus = getInvestmentFocusContext();
    if (selectedThemeId && focus.themeId !== selectedThemeId) {
      setInvestmentFocusContext({ themeId: selectedThemeId });
    }
  }

  private focusThemeInWorkspace(
    themeId: string | null | undefined,
    workspaceId: WorkspaceId = 'brief',
    scrollTarget: 'theme-workspace' | 'validation' | 'none' = 'theme-workspace',
  ): void {
    const normalizedThemeId = this.normalizeThemeId(themeId);
    if (!normalizedThemeId) return;
    this.ctx.setOperatorContext({ selectedThemeId: normalizedThemeId });
    if (workspaceId === 'validate') {
      this.syncValidationFocusFromOperatorContext();
    }
    if (this.activeWorkspace !== workspaceId) {
      this.setActiveWorkspace(workspaceId);
    }
    if (workspaceId === 'brief' || workspaceId === 'watch') {
      this.syncThemeWorkspaceFrameFromContext(true);
    } else {
      this.syncValidationFocusFromOperatorContext();
    }
    this.syncUrlState();
    this.scrollWorkspaceTarget(scrollTarget);
  }

  private openValidationWorkspace(themeId?: string | null, scrollTarget: 'validation' | 'none' = 'validation'): void {
    const normalizedThemeId = this.normalizeThemeId(themeId ?? this.ctx.operatorContext.selectedThemeId);
    if (normalizedThemeId) {
      this.ctx.setOperatorContext({ selectedThemeId: normalizedThemeId });
      setInvestmentFocusContext({ themeId: normalizedThemeId });
    }
    if (this.activeWorkspace !== 'validate') {
      this.setActiveWorkspace('validate');
    } else {
      this.syncUrlState();
    }
    this.scrollWorkspaceTarget(scrollTarget);
  }

  private applyWorkspaceMode(): void {
    const workspace = getWorkspaceDefinition(this.activeWorkspace, SITE_VARIANT);
    const isKoreanUi = getCurrentLanguage() === 'ko';
    document.documentElement.dataset.workspace = workspace.id;

    const allowedPanels = new Set(workspace.panelKeys);
    const requiredPanels = new Set(workspace.featuredPanels);
    const enabledPanels = new Set(
      Object.entries(this.ctx.panelSettings)
        .filter(([, config]) => config.enabled !== false)
        .map(([key]) => key),
    );

    let visibleCount = 0;
    document.querySelectorAll<HTMLElement>('#panelsGrid .panel[data-panel]').forEach((panelEl) => {
      const key = panelEl.dataset.panel;
      if (!key) return;
      const enabled = enabledPanels.has(key) || requiredPanels.has(key);
      const shouldShow = enabled && allowedPanels.has(key);
      panelEl.classList.toggle('workspace-hidden', !shouldShow);
      panelEl.setAttribute('aria-hidden', shouldShow ? 'false' : 'true');
      if (shouldShow) visibleCount += 1;
    });

    const mapEnabled = this.ctx.panelSettings.map?.enabled !== false;
    const mapVisible = mapEnabled && workspace.showMap;
    if (mapVisible) {
      this.callbacks.ensureMapMounted?.(true);
    }
    const mapSection = document.getElementById('mapSection');
    mapSection?.classList.toggle('workspace-hidden', !mapVisible);
    this.ctx.map?.setRenderPaused(!mapVisible);

    const themeWorkspaceShell = document.getElementById('themeWorkspaceShell');
    const themeWorkspaceVisible = workspace.id === 'brief' || workspace.id === 'watch';
    themeWorkspaceShell?.classList.toggle('workspace-hidden', !themeWorkspaceVisible);
    if (themeWorkspaceVisible) {
      this.syncThemeWorkspaceFrameFromContext();
    }
    if (workspace.id === 'validate') {
      this.syncValidationFocusFromOperatorContext();
    }

    this.ctx.container.querySelectorAll<HTMLButtonElement>('[data-workspace-target]').forEach((button) => {
      const active = button.dataset.workspaceTarget === workspace.id;
      button.classList.toggle('active', active);
      button.setAttribute('aria-selected', active ? 'true' : 'false');
    });

    const titleEl = document.getElementById('workspaceTitle');
    if (titleEl) titleEl.textContent = workspace.title;
    const eyebrowEl = document.getElementById('workspaceEyebrow');
    if (eyebrowEl) eyebrowEl.textContent = workspace.eyebrow;
    const summaryEl = document.getElementById('workspaceSummary');
    if (summaryEl) summaryEl.textContent = workspace.description;
    const intentTitleEl = document.getElementById('workspaceIntentTitle');
    if (intentTitleEl) intentTitleEl.textContent = workspace.heroTitle;
    const intentSummaryEl = document.getElementById('workspaceIntentSummary');
    if (intentSummaryEl) intentSummaryEl.textContent = workspace.heroSummary;
    const storyEl = document.getElementById('workspaceStory');
    if (storyEl) storyEl.innerHTML = this.renderWorkspaceStory(workspace);
    const statEl = document.getElementById('workspaceStat');
    if (statEl) statEl.textContent = `${visibleCount} modules in view · ${Math.max(workspace.featuredPanels.length, 1)} curated`;
    const mapModeEl = document.getElementById('workspaceMapMode');
    if (mapModeEl) mapModeEl.textContent = workspace.showMap ? 'Context map active' : 'Context map tucked away';
    const statOverrideEl = document.getElementById('workspaceStat');
    if (statOverrideEl) {
      const curatedCount = Math.max(workspace.featuredPanels.length, 1);
      statOverrideEl.textContent = isKoreanUi
        ? `${visibleCount}개 표시 중 · 추천 ${curatedCount}개`
        : `${visibleCount} visible now · ${curatedCount} recommended`;
    }
    const mapModeOverrideEl = document.getElementById('workspaceMapMode');
    if (mapModeOverrideEl) {
      mapModeOverrideEl.textContent = workspace.showMap
        ? (isKoreanUi ? '지도 컨텍스트 표시 중' : 'Context map active')
        : (isKoreanUi ? '지도는 필요할 때만 표시' : 'Context map tucked away');
    }
    const focusEl = document.getElementById('workspaceFocusAreas');
    if (focusEl) focusEl.innerHTML = this.renderWorkspaceFocus(workspace);

    const featuredEl = document.getElementById('workspaceFeatured');
    if (featuredEl) {
      const chips = workspace.featuredPanels
        .filter((key) => (enabledPanels.has(key) || requiredPanels.has(key)) && allowedPanels.has(key))
        .map((key) => this.ctx.panelSettings[key]?.name ?? DEFAULT_PANELS[key]?.name ?? key)
        .slice(0, 4);
      featuredEl.innerHTML = chips.length > 0
        ? chips.map((label) => `<span class="workspace-chip">${escapeHtml(label)}</span>`).join('')
        : '<span class="workspace-chip muted">Workspace suggestions update as this surface fills in</span>';
    }

    requestAnimationFrame(() => {
      this.ctx.map?.render();
    });
    this.renderOperatorContextChips();
  }

  private setupOperatorContextBinding(): void {
    this.boundOperatorContextHandler = () => {
      this.renderOperatorContextChips();
      if (this.activeWorkspace === 'brief' || this.activeWorkspace === 'watch') {
        this.syncThemeWorkspaceFrameFromContext();
      }
      this.syncValidationFocusFromOperatorContext();
      this.syncUrlState();
    };
    window.addEventListener('wm:operator-context-changed', this.boundOperatorContextHandler);
    this.renderOperatorContextChips();
    this.syncValidationFocusFromOperatorContext();
  }

  private getOperatorTimeRangeLabel(range: TimeRange): string {
    const isKoreanUi = getCurrentLanguage() === 'ko';
    const labels: Record<string, string> = isKoreanUi
      ? {
          '1h': '1시간',
          '6h': '6시간',
          '24h': '24시간',
          '48h': '48시간',
          '7d': '7일',
          all: '전체',
        }
      : {
          '1h': '1h',
          '6h': '6h',
          '24h': '24h',
          '48h': '48h',
          '7d': '7d',
          all: 'All',
        };
    return labels[range] ?? range;
  }

  private getOperatorViewLabel(view: MapView): string {
    const labels: Record<MapView, string> = {
      global: t('components.deckgl.views.global'),
      america: t('components.deckgl.views.americas'),
      mena: t('components.deckgl.views.mena'),
      eu: t('components.deckgl.views.europe'),
      asia: t('components.deckgl.views.asia'),
      latam: t('components.deckgl.views.latam'),
      africa: t('components.deckgl.views.africa'),
      oceania: t('components.deckgl.views.oceania'),
    };
    return labels[view] ?? view;
  }

  private renderOperatorContextChips(): void {
    const workspace = getWorkspaceDefinition(this.ctx.operatorContext.workspaceId, SITE_VARIANT);
    const workspaceEl = document.getElementById('operatorContextWorkspace');
    if (workspaceEl) workspaceEl.textContent = workspace.label;

    const regionEl = document.getElementById('operatorContextRegion');
    if (regionEl) regionEl.textContent = this.getOperatorViewLabel(this.ctx.operatorContext.mapView);

    const timeRangeEl = document.getElementById('operatorContextTimeRange');
    if (timeRangeEl) timeRangeEl.textContent = this.getOperatorTimeRangeLabel(this.ctx.operatorContext.timeRange);

    const themeChipEl = document.getElementById('operatorContextThemeChip');
    const themeEl = document.getElementById('operatorContextTheme');
    const selectedTheme = this.ctx.operatorContext.selectedThemeId;
    if (themeEl) {
      themeEl.textContent = selectedTheme ? selectedTheme.replace(/-/g, ' ') : '';
    }
    if (themeChipEl) {
      if (selectedTheme) {
        themeChipEl.removeAttribute('hidden');
      } else {
        themeChipEl.setAttribute('hidden', 'hidden');
      }
    }

    const countryChipEl = document.getElementById('operatorContextCountryChip');
    const countryEl = document.getElementById('operatorContextCountry');
    const countryCode = this.ctx.operatorContext.selectedCountryCode;
    if (countryEl) {
      countryEl.textContent = countryCode
        ? (this.ctx.countryBriefPage?.getName() ?? getCountryNameByCode(countryCode) ?? countryCode)
        : '';
    }
    if (countryChipEl) {
      if (countryCode) {
        countryChipEl.removeAttribute('hidden');
      } else {
        countryChipEl.setAttribute('hidden', 'hidden');
      }
    }
  }

  private getThemeWorkspacePeriod(range: TimeRange): 'week' | 'month' | 'quarter' | 'year' {
    switch (range) {
      case '1h':
      case '6h':
      case '24h':
      case '48h':
      case '7d':
        return 'week';
      case 'all':
      default:
        return 'quarter';
    }
  }

  private buildThemeWorkspaceEmbedUrl(): string {
    const url = new URL('/event-dashboard.html', window.location.origin);
    url.searchParams.set('embed', '1');
    return url.toString();
  }

  private buildThemeWorkspaceStandaloneUrl(): string {
    const url = new URL('/event-dashboard.html', window.location.origin);
    url.searchParams.set('period', this.getThemeWorkspacePeriod(this.ctx.operatorContext.timeRange));
    if (this.ctx.operatorContext.selectedThemeId) {
      url.searchParams.set('theme', this.ctx.operatorContext.selectedThemeId);
    }
    return url.toString();
  }

  private postThemeWorkspaceContext(): void {
    const frame = document.getElementById('themeWorkspaceFrame') as HTMLIFrameElement | null;
    const targetWindow = frame?.contentWindow;
    if (!targetWindow) return;
    targetWindow.postMessage({
      source: 'operator-shell',
      type: 'wm-theme-workspace-context',
      payload: {
        themeId: this.ctx.operatorContext.selectedThemeId,
        period: this.getThemeWorkspacePeriod(this.ctx.operatorContext.timeRange),
        workspaceId: this.activeWorkspace,
      },
    }, window.location.origin);
  }

  private syncThemeWorkspaceFrameFromContext(force = false): void {
    const frame = document.getElementById('themeWorkspaceFrame') as HTMLIFrameElement | null;
    const standaloneLink = document.getElementById('themeWorkspaceOpenStandalone') as HTMLAnchorElement | null;
    const validationButton = document.getElementById('themeWorkspaceOpenValidation') as HTMLButtonElement | null;
    const summary = document.getElementById('themeWorkspaceSummary');
    if (!frame) return;

    const embedUrl = this.buildThemeWorkspaceEmbedUrl();
    if (force || !frame.src || frame.src !== embedUrl) {
      frame.src = embedUrl;
    } else {
      this.postThemeWorkspaceContext();
    }
    if (standaloneLink) {
      standaloneLink.href = this.buildThemeWorkspaceStandaloneUrl();
    }
    if (summary) {
      summary.textContent = this.ctx.operatorContext.selectedThemeId
        ? `Focused on ${this.ctx.operatorContext.selectedThemeId.replace(/-/g, ' ')}. Move into validation without losing the live evidence trail.`
        : 'Follow themes, structural alerts, and evidence lanes without leaving the workbench.';
    }
    if (validationButton) {
      validationButton.disabled = !this.ctx.operatorContext.selectedThemeId;
    }
  }

  private setupThemeWorkspaceMessageBridge(): void {
    if (this.boundThemeWorkspaceMessageHandler) {
      window.removeEventListener('message', this.boundThemeWorkspaceMessageHandler);
    }
    this.boundThemeWorkspaceMessageHandler = (event: MessageEvent) => {
      const frame = document.getElementById('themeWorkspaceFrame') as HTMLIFrameElement | null;
      if (!frame?.contentWindow || event.source !== frame.contentWindow) return;
      if (event.origin !== window.location.origin) return;
      const data = event.data as {
        source?: string;
        type?: string;
        payload?: { theme?: string | null; period?: string | null };
      } | null;
      if (!data || data.source !== 'theme-workspace') return;
      if (data.type === 'wm-theme-workspace-ready') {
        this.postThemeWorkspaceContext();
        return;
      }
      if (data.type !== 'wm-theme-workspace-context') return;

      const nextTheme = this.normalizeThemeId(data.payload?.theme ?? null);
      const currentTheme = this.normalizeThemeId(this.ctx.operatorContext.selectedThemeId);
      if (nextTheme !== currentTheme) {
        this.ctx.setOperatorContext({ selectedThemeId: nextTheme });
      }
      const nextPeriod = String(data.payload?.period || '').trim().toLowerCase();
      if (nextPeriod) {
        const timeRange = nextPeriod === 'week'
          ? '7d'
          : nextPeriod === 'month'
            ? 'all'
            : nextPeriod === 'quarter'
              ? 'all'
              : nextPeriod === 'year'
                ? 'all'
                : null;
        if (timeRange && timeRange !== this.ctx.operatorContext.timeRange) {
          this.ctx.setOperatorContext({ timeRange });
        }
      }
    };
    window.addEventListener('message', this.boundThemeWorkspaceMessageHandler);
  }

  private setupThemeWorkspaceShell(): void {
    const frame = document.getElementById('themeWorkspaceFrame') as HTMLIFrameElement | null;
    const validationButton = document.getElementById('themeWorkspaceOpenValidation') as HTMLButtonElement | null;
    if (!frame) return;
    validationButton?.addEventListener('click', () => {
      this.openValidationWorkspace(this.ctx.operatorContext.selectedThemeId);
    });
    this.setupThemeWorkspaceMessageBridge();
    frame.addEventListener('load', () => {
      this.postThemeWorkspaceContext();
    });
    this.syncThemeWorkspaceFrameFromContext(true);
  }

  private ensureDeferredMapBootstrap(): void {
    if (this.ctx.map || this.boundDeferredMapBootstrapHandler) return;
    this.boundDeferredMapBootstrapHandler = () => {
      if (this.boundDeferredMapBootstrapHandler) {
        window.removeEventListener('wm:map-mounted', this.boundDeferredMapBootstrapHandler);
        this.boundDeferredMapBootstrapHandler = null;
      }
      this.setupMapLayerHandlers();
      this.setupUrlStateSync();
    };
    window.addEventListener('wm:map-mounted', this.boundDeferredMapBootstrapHandler, { once: true });
  }

  private setupSourceDrawer(): void {
    const drawer = document.getElementById('sourceDrawer');
    if (!drawer) return;

    const setOpen = (open: boolean) => {
      drawer.classList.toggle('open', open);
      drawer.setAttribute('aria-hidden', open ? 'false' : 'true');
      document.documentElement.classList.toggle('source-drawer-open', open);
    };

    document.getElementById('sourceDrawerBtn')?.addEventListener('click', () => {
      const next = !drawer.classList.contains('open');
      setOpen(next);
    });

    document.getElementById('sourceDrawerClose')?.addEventListener('click', () => {
      setOpen(false);
    });

    drawer.querySelectorAll<HTMLElement>('[data-close-source-drawer]').forEach((el) => {
      el.addEventListener('click', () => setOpen(false));
    });
  }

  private setupTerminalTape(): void {
    const tape = document.getElementById('terminalTape');
    if (!tape || SITE_VARIANT === 'happy') return;

    const headlineEl = document.getElementById('terminalTapeHeadline');
    const newsCountEl = document.getElementById('terminalTapeNewsCount');
    const sourceCountEl = document.getElementById('terminalTapeSourceCount');
    const alertCountEl = document.getElementById('terminalTapeAlertCount');
    const updatedEl = document.getElementById('terminalTapeUpdated');
    if (!headlineEl || !newsCountEl || !sourceCountEl || !alertCountEl || !updatedEl) return;

    const updateFromTelemetry = (event: Event) => {
      const detail = (event as CustomEvent<{
        total?: number;
        alerts?: number;
        sourceCount?: number;
        latestTimestamp?: string | null;
        headlines?: string[];
      }>).detail;

      const total = Number.isFinite(detail?.total) ? Number(detail.total) : 0;
      const alerts = Number.isFinite(detail?.alerts) ? Number(detail.alerts) : 0;
      const sourceCount = Number.isFinite(detail?.sourceCount) ? Number(detail.sourceCount) : 0;
      const latest = typeof detail?.latestTimestamp === 'string' ? detail.latestTimestamp : null;
      const headlines = Array.isArray(detail?.headlines) ? detail.headlines.filter((text) => typeof text === 'string' && text.length > 0) : [];

      newsCountEl.textContent = `NEWS ${total}`;
      sourceCountEl.textContent = `SRC ${sourceCount}`;
      alertCountEl.textContent = `ALERT ${alerts}`;
      alertCountEl.classList.toggle('active', alerts > 0);

      if (latest) {
        const date = new Date(latest);
        if (Number.isFinite(date.getTime())) {
          updatedEl.textContent = `UPDATED ${date.toLocaleTimeString()}`;
        }
      }

      if (headlines.length > 0) {
        this.tapeHeadlines = headlines;
        if (this.tapeHeadlineIndex < 0) {
          this.tapeHeadlineIndex = 0;
          headlineEl.textContent = headlines[0] ?? '';
        }
      }
    };

    if (this.boundNewsTelemetryHandler) {
      window.removeEventListener('wm:news-telemetry', this.boundNewsTelemetryHandler);
    }
    this.boundNewsTelemetryHandler = updateFromTelemetry;
    window.addEventListener('wm:news-telemetry', this.boundNewsTelemetryHandler);

    this.tapeHeadlineIntervalId = setInterval(() => {
      if (this.tapeHeadlines.length === 0) return;
      this.tapeHeadlineIndex = (this.tapeHeadlineIndex + 1) % this.tapeHeadlines.length;
      const nextHeadline = this.tapeHeadlines[this.tapeHeadlineIndex];
      if (!nextHeadline) return;
      headlineEl.classList.remove('flash');
      requestAnimationFrame(() => {
        headlineEl.textContent = nextHeadline;
        headlineEl.classList.add('flash');
      });
    }, 3500);
  }

  private setupKeyboardShortcuts(): void {
    if (this.boundHotkeyHandler) {
      document.removeEventListener('keydown', this.boundHotkeyHandler);
    }

    this.boundHotkeyHandler = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const isTypingTarget = !!target && (
        target.tagName === 'INPUT'
        || target.tagName === 'TEXTAREA'
        || target.tagName === 'SELECT'
        || target.isContentEditable
      );

      if (event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey && /^[1-7]$/.test(event.key)) {
        if (!isTypingTarget) {
          const index = Number(event.key) - 1;
          const buttons = Array.from(
            this.ctx.container.querySelectorAll<HTMLButtonElement>('[data-workspace-target]'),
          );
          const next = buttons[index];
          if (next) {
            event.preventDefault();
            next.click();
          }
        }
        return;
      }

      if ((event.ctrlKey || event.metaKey) && event.shiftKey && (event.key === 'A' || event.key === 'a')) {
        if (!isTypingTarget) {
          event.preventDefault();
          this.ctx.analysisHubPage?.toggle();
        }
        return;
      }

      if ((event.ctrlKey || event.metaKey) && event.shiftKey && (event.key === 'C' || event.key === 'c')) {
        if (!isTypingTarget) {
          event.preventDefault();
          this.ctx.codexHubPage?.toggle();
        }
        return;
      }

      if ((event.ctrlKey || event.metaKey) && event.shiftKey && (event.key === 'O' || event.key === 'o')) {
        if (!isTypingTarget) {
          event.preventDefault();
          this.ctx.ontologyGraphPage?.toggle();
        }
        return;
      }

      if (event.key === '/' && !isTypingTarget && !event.ctrlKey && !event.metaKey && !event.altKey) {
        event.preventDefault();
        this.callbacks.updateSearchIndex();
        this.ctx.searchModal?.open();
        return;
      }

      if (isTypingTarget || event.ctrlKey || event.metaKey || event.altKey) return;

      if (event.key === 'g' || event.key === 'G') {
        event.preventDefault();
        const mapSection = document.getElementById('mapSection');
        if (mapSection) {
          mapSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
          mapSection.classList.add('hotkey-focus');
          window.setTimeout(() => mapSection.classList.remove('hotkey-focus'), 700);
        }
        return;
      }

      if (event.key === 'n' || event.key === 'N') {
        event.preventDefault();
        this.focusNextHeadline();
        return;
      }

      if (/^[1-9]$/.test(event.key)) {
        event.preventDefault();
        this.focusPanelByHotkey(Number(event.key) - 1);
      }
    };

    document.addEventListener('keydown', this.boundHotkeyHandler);
  }

  private focusNextHeadline(): void {
    const headlines = Array.from(document.querySelectorAll<HTMLAnchorElement>('.item .item-title'));
    if (headlines.length === 0) return;

    this.focusedHeadlineIndex = (this.focusedHeadlineIndex + 1) % headlines.length;
    const target = headlines[this.focusedHeadlineIndex];
    if (!target) return;

    target.focus({ preventScroll: true });
    target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    target.classList.add('hotkey-focus');
    window.setTimeout(() => target.classList.remove('hotkey-focus'), 700);
  }

  private focusPanelByHotkey(index: number): void {
    const panels = Array.from(document.querySelectorAll<HTMLElement>('#panelsGrid .panel'))
      .filter((panel) => panel.offsetParent !== null);
    const target = panels[index];
    if (!target) return;
    target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    target.classList.add('hotkey-focus');
    window.setTimeout(() => target.classList.remove('hotkey-focus'), 700);
  }

  private setupIdleDetection(): void {
    this.boundIdleResetHandler = () => {
      if (this.ctx.isIdle) {
        this.ctx.isIdle = false;
        document.body.classList.remove('animations-paused');
      }
      this.resetIdleTimer();
    };

    ['mousedown', 'keydown', 'scroll', 'touchstart', 'mousemove'].forEach(event => {
      document.addEventListener(event, this.boundIdleResetHandler!, { passive: true });
    });

    this.resetIdleTimer();
  }

  resetIdleTimer(): void {
    if (this.idleTimeoutId) {
      clearTimeout(this.idleTimeoutId);
    }
    this.idleTimeoutId = setTimeout(() => {
      if (!document.hidden) {
        this.ctx.isIdle = true;
        document.body.classList.add('animations-paused');
        console.log('[App] User idle - pausing animations to save resources');
      }
    }, this.IDLE_PAUSE_MS);
  }

  setupUrlStateSync(): void {
    if (!this.ctx.map) {
      this.ensureDeferredMapBootstrap();
      return;
    }
    if (this.urlStateSyncBound) {
      this.syncUrlState();
      return;
    }
    const update = debounce(() => {
      this.syncUrlState();
    }, 250);

    this.ctx.map.onStateChanged(() => {
      update();
      const regionSelect = document.getElementById('regionSelect') as HTMLSelectElement;
      if (regionSelect && this.ctx.map) {
        const state = this.ctx.map.getState();
        if (regionSelect.value !== state.view) {
          regionSelect.value = state.view;
        }
        if (
          state.view !== this.ctx.operatorContext.mapView
          || state.timeRange !== this.ctx.operatorContext.timeRange
        ) {
          this.ctx.setOperatorContext({
            mapView: state.view,
            timeRange: state.timeRange,
          });
        }
      }
    });
    this.urlStateSyncBound = true;
    update();
  }

  syncUrlState(): void {
    const shareUrl = this.getShareUrl();
    if (!shareUrl) return;
    history.replaceState(null, '', shareUrl);
  }

  getShareUrl(): string | null {
    const state = this.ctx.map?.getState();
    const center = this.ctx.map?.getCenter();
    const baseUrl = `${window.location.origin}${window.location.pathname}`;
    return buildMapUrl(baseUrl, {
      workspace: this.activeWorkspace,
      theme: this.ctx.operatorContext.selectedThemeId ?? undefined,
      view: state?.view ?? this.ctx.operatorContext.mapView,
      zoom: state?.zoom ?? this.ctx.initialUrlState?.zoom ?? 1,
      center,
      timeRange: state?.timeRange ?? this.ctx.operatorContext.timeRange,
      layers: state?.layers ?? this.ctx.mapLayers,
      country: this.ctx.countryBriefPage?.isVisible() ? (this.ctx.countryBriefPage.getCode() ?? undefined) : undefined,
    });
  }

  private async copyToClipboard(text: string): Promise<void> {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return;
    }
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand('copy');
    document.body.removeChild(textarea);
  }

  private setCopyLinkFeedback(button: HTMLElement | null, message: string): void {
    if (!button) return;
    const originalText = button.textContent ?? '';
    button.textContent = message;
    button.classList.add('copied');
    window.setTimeout(() => {
      button.textContent = originalText;
      button.classList.remove('copied');
    }, 1500);
  }

  toggleFullscreen(): void {
    if (document.fullscreenElement) {
      try { void document.exitFullscreen()?.catch(() => {}); } catch {}
    } else {
      const el = document.documentElement as HTMLElement & { webkitRequestFullscreen?: () => void };
      if (el.requestFullscreen) {
        try { void el.requestFullscreen()?.catch(() => {}); } catch {}
      } else if (el.webkitRequestFullscreen) {
        try { el.webkitRequestFullscreen(); } catch {}
      }
    }
  }

  updateHeaderThemeIcon(): void {
    const btn = document.getElementById('headerThemeToggle');
    if (!btn) return;
    const isDark = getCurrentTheme() === 'dark';
    btn.innerHTML = isDark
      ? '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>'
      : '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z"/></svg>';
  }

  startHeaderClock(): void {
    const el = document.getElementById('headerClock');
    if (!el) return;
    const tick = () => {
      el.textContent = new Date().toUTCString().replace('GMT', 'UTC');
    };
    tick();
    this.clockIntervalId = setInterval(tick, 1000);
  }

  setupMobileWarning(): void {
    if (MobileWarningModal.shouldShow()) {
      this.ctx.mobileWarningModal = new MobileWarningModal();
      this.ctx.mobileWarningModal.show();
    }
  }

  setupStatusPanel(): void {
    this.ctx.statusPanel = new StatusPanel();
    const headerLeft = this.ctx.container.querySelector('.header-left');
    if (headerLeft) {
      headerLeft.appendChild(this.ctx.statusPanel.getElement());
    }
  }

  setupPizzIntIndicator(): void {
    if (SITE_VARIANT === 'tech' || SITE_VARIANT === 'finance' || SITE_VARIANT === 'happy') return;

    this.ctx.pizzintIndicator = new PizzIntIndicator();
    const headerLeft = this.ctx.container.querySelector('.header-left');
    if (headerLeft) {
      headerLeft.appendChild(this.ctx.pizzintIndicator.getElement());
    }
  }

  setupExportPanel(): void {
    this.ctx.exportPanel = new ExportPanel(() => ({
      news: this.ctx.latestClusters.length > 0 ? this.ctx.latestClusters : this.ctx.allNews,
      markets: this.ctx.latestMarkets,
      predictions: this.ctx.latestPredictions,
      timestamp: Date.now(),
    }));

    const headerRight = this.ctx.container.querySelector('.header-right');
    if (headerRight) {
      headerRight.insertBefore(this.ctx.exportPanel.getElement(), headerRight.firstChild);
    }
  }

  setupUnifiedSettings(): void {
    this.ctx.unifiedSettings = new UnifiedSettings({
      getPanelSettings: () => this.ctx.panelSettings,
      togglePanel: (key: string) => {
        const config = this.ctx.panelSettings[key];
        if (config) {
          config.enabled = !config.enabled;
          trackPanelToggled(key, config.enabled);
          saveToStorage(STORAGE_KEYS.panels, this.ctx.panelSettings);
          this.applyPanelSettings();
        }
      },
      getDisabledSources: () => this.ctx.disabledSources,
      toggleSource: (name: string) => {
        if (this.ctx.disabledSources.has(name)) {
          this.ctx.disabledSources.delete(name);
        } else {
          this.ctx.disabledSources.add(name);
        }
        saveToStorage(STORAGE_KEYS.disabledFeeds, Array.from(this.ctx.disabledSources));
      },
      setSourcesEnabled: (names: string[], enabled: boolean) => {
        for (const name of names) {
          if (enabled) this.ctx.disabledSources.delete(name);
          else this.ctx.disabledSources.add(name);
        }
        saveToStorage(STORAGE_KEYS.disabledFeeds, Array.from(this.ctx.disabledSources));
      },
      getAllSourceNames: () => this.getAllSourceNames(),
      getLocalizedPanelName: (key: string, fallback: string) => this.getLocalizedPanelName(key, fallback),
      isDesktopApp: this.ctx.isDesktopApp,
    });

    const mount = document.getElementById('unifiedSettingsMount');
    if (mount) {
      mount.appendChild(this.ctx.unifiedSettings.getButton());
    }
  }

  setupPlaybackControl(): void {
    this.ctx.playbackControl = new PlaybackControl();
    this.ctx.playbackControl.onSnapshot((snapshot) => {
      if (snapshot) {
        this.ctx.isPlaybackMode = true;
        this.restoreSnapshot(snapshot);
      } else {
        this.ctx.isPlaybackMode = false;
        this.callbacks.loadAllData();
      }
    });

    const headerRight = this.ctx.container.querySelector('.header-right');
    if (headerRight) {
      headerRight.insertBefore(this.ctx.playbackControl.getElement(), headerRight.firstChild);
    }
  }

  setupSnapshotSaving(): void {
    const saveCurrentSnapshot = async () => {
      if (this.ctx.isPlaybackMode || this.ctx.isDestroyed) return;

      const marketPrices: Record<string, number> = {};
      this.ctx.latestMarkets.forEach(m => {
        if (m.price !== null) marketPrices[m.symbol] = m.price;
      });

      await saveSnapshot({
        timestamp: Date.now(),
        events: this.ctx.latestClusters,
        marketPrices,
        predictions: this.ctx.latestPredictions.map(p => ({
          title: p.title,
          yesPrice: p.yesPrice
        })),
        hotspotLevels: this.ctx.map?.getHotspotLevels() ?? {}
      });
    };

    void saveCurrentSnapshot().catch((e) => console.warn('[Snapshot] save failed:', e));
    this.snapshotIntervalId = setInterval(() => void saveCurrentSnapshot().catch((e) => console.warn('[Snapshot] save failed:', e)), 15 * 60 * 1000);
  }

  restoreSnapshot(snapshot: DashboardSnapshot): void {
    for (const panel of Object.values(this.ctx.newsPanels)) {
      panel.showLoading();
    }

    const events = snapshot.events as ClusteredEvent[];
    this.ctx.latestClusters = events;

    const predictions = snapshot.predictions.map((p, i) => ({
      id: `snap-${i}`,
      title: p.title,
      yesPrice: p.yesPrice,
      noPrice: 100 - p.yesPrice,
      volume24h: 0,
      liquidity: 0,
    }));
    this.ctx.latestPredictions = predictions;
    (this.ctx.panels['polymarket'] as PredictionPanel).renderPredictions(predictions);

    this.ctx.map?.setHotspotLevels(snapshot.hotspotLevels);
  }

  setupMapLayerHandlers(): void {
    if (!this.ctx.map) {
      this.ensureDeferredMapBootstrap();
      return;
    }
    if (this.mapLayerHandlersBound) return;

    this.ctx.map.setOnLayerChange((layer, enabled, source) => {
      console.log(`[App.onLayerChange] ${layer}: ${enabled} (${source})`);
      trackMapLayerToggle(layer, enabled, source);
      this.ctx.mapLayers[layer] = enabled;
      saveToStorage(STORAGE_KEYS.mapLayers, this.ctx.mapLayers);

      const sourceIds = LAYER_TO_SOURCE[layer];
      if (sourceIds) {
        for (const sourceId of sourceIds) {
          dataFreshness.setEnabled(sourceId, enabled);
        }
      }

      if (layer === 'ais') {
        if (enabled) {
          this.ctx.map?.setLayerLoading('ais', true);
          initAisStream();
          this.callbacks.waitForAisData();
        } else {
          disconnectAisStream();
        }
        return;
      }

      if (enabled) {
        this.callbacks.loadDataForLayer(layer);
      }
    });
    this.mapLayerHandlersBound = true;
  }

  setupPanelViewTracking(): void {
    const viewedPanels = new Set<string>();
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting && entry.intersectionRatio >= 0.3) {
          const id = (entry.target as HTMLElement).dataset.panel;
          if (id && !viewedPanels.has(id)) {
            viewedPanels.add(id);
            trackPanelView(id);
          }
        }
      }
    }, { threshold: 0.3 });

    const grid = document.getElementById('panelsGrid');
    if (grid) {
      for (const child of Array.from(grid.children)) {
        if ((child as HTMLElement).dataset.panel) {
          observer.observe(child);
        }
      }
    }
  }

  showToast(msg: string): void {
    document.querySelector('.toast-notification')?.remove();
    const el = document.createElement('div');
    el.className = 'toast-notification';
    el.textContent = msg;
    document.body.appendChild(el);
    requestAnimationFrame(() => el.classList.add('visible'));
    setTimeout(() => { el.classList.remove('visible'); setTimeout(() => el.remove(), 300); }, 3000);
  }

  shouldShowIntelligenceNotifications(): boolean {
    return !this.ctx.isMobile && !!this.ctx.findingsBadge?.isPopupEnabled();
  }

  setupMapResize(): void {
    const mapSection = document.getElementById('mapSection');
    const resizeHandle = document.getElementById('mapResizeHandle');
    if (!mapSection || !resizeHandle) return;

    const getMinHeight = () => (window.innerWidth >= 2000 ? 320 : 400);
    const getMaxHeight = () => Math.max(getMinHeight(), window.innerHeight - 60);

    const savedHeight = localStorage.getItem('map-height');
    if (savedHeight) {
      const numeric = Number.parseInt(savedHeight, 10);
      if (Number.isFinite(numeric)) {
        const clamped = Math.max(getMinHeight(), Math.min(numeric, getMaxHeight()));
        mapSection.style.height = `${clamped}px`;
        if (clamped !== numeric) {
          localStorage.setItem('map-height', `${clamped}px`);
        }
      } else {
        localStorage.removeItem('map-height');
      }
    }

    let isResizing = false;
    let startY = 0;
    let startHeight = 0;

    resizeHandle.addEventListener('mousedown', (e) => {
      isResizing = true;
      startY = e.clientY;
      startHeight = mapSection.offsetHeight;
      mapSection.classList.add('resizing');
      document.body.style.cursor = 'ns-resize';
      e.preventDefault();
    });

    document.addEventListener('mousemove', (e) => {
      if (!isResizing) return;
      const deltaY = e.clientY - startY;
      const newHeight = Math.max(getMinHeight(), Math.min(startHeight + deltaY, getMaxHeight()));
      mapSection.style.height = `${newHeight}px`;
      this.ctx.map?.render();
    });

    document.addEventListener('mouseup', () => {
      if (!isResizing) return;
      isResizing = false;
      mapSection.classList.remove('resizing');
      document.body.style.cursor = '';
      localStorage.setItem('map-height', mapSection.style.height);
      this.ctx.map?.render();
    });
  }

  setupMapPin(): void {
    const mapSection = document.getElementById('mapSection');
    const pinBtn = document.getElementById('mapPinBtn');
    if (!mapSection || !pinBtn) return;

    const isPinned = localStorage.getItem('map-pinned') === 'true';
    if (isPinned) {
      mapSection.classList.add('pinned');
      pinBtn.classList.add('active');
    }

    pinBtn.addEventListener('click', () => {
      const nowPinned = mapSection.classList.toggle('pinned');
      pinBtn.classList.toggle('active', nowPinned);
      localStorage.setItem('map-pinned', String(nowPinned));
    });
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

  applyPanelSettings(): void {
    Object.entries(this.ctx.panelSettings).forEach(([key, config]) => {
      if (key === 'map') {
        const mapSection = document.getElementById('mapSection');
        if (mapSection) {
          mapSection.classList.toggle('hidden', !config.enabled);
        }
        return;
      }
      const panel = this.ctx.panels[key];
      panel?.toggle(config.enabled);
    });
    this.applyWorkspaceMode();
  }
}

