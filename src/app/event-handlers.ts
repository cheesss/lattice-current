import type { AppContext, AppModule } from '@/app/app-context';
import type { PanelConfig } from '@/types';
import type { MapView } from '@/components';
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
import { invokeTauri } from '@/services/tauri-bridge';
import { dataFreshness } from '@/services/data-freshness';
import { mlWorker } from '@/services/ml-worker';
import { openBacktestHubWindow } from '@/services/backtest-hub-launcher';
import { UnifiedSettings } from '@/components/UnifiedSettings';
import { t, getCurrentLanguage } from '@/services/i18n';
import { TvModeController } from '@/services/tv-mode';
import {
  getWorkspaceDefinition,
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
  private idleTimeoutId: ReturnType<typeof setTimeout> | null = null;
  private snapshotIntervalId: ReturnType<typeof setInterval> | null = null;
  private clockIntervalId: ReturnType<typeof setInterval> | null = null;
  private tapeHeadlineIntervalId: ReturnType<typeof setInterval> | null = null;
  private tapeHeadlines: string[] = [];
  private tapeHeadlineIndex = -1;
  private focusedHeadlineIndex = -1;
  private readonly IDLE_PAUSE_MS = 2 * 60 * 1000;
  private activeWorkspace: WorkspaceId = getWorkspaceDefinition().id;

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
    const openHub = (hub: 'analysis' | 'codex' | 'backtest' | 'ontology'): void => {
      const hideOverlayHubs = (): void => {
        this.ctx.analysisHubPage?.hide();
        this.ctx.codexHubPage?.hide();
        this.ctx.ontologyGraphPage?.hide();
      };

      if (hub === 'analysis') {
        const alreadyVisible = this.ctx.analysisHubPage?.isVisible() ?? false;
        hideOverlayHubs();
        if (!alreadyVisible) this.ctx.analysisHubPage?.show();
        return;
      }
      if (hub === 'codex') {
        const alreadyVisible = this.ctx.codexHubPage?.isVisible() ?? false;
        hideOverlayHubs();
        if (!alreadyVisible) this.ctx.codexHubPage?.show();
        return;
      }
      if (hub === 'backtest') {
        void openBacktestHubWindow();
        return;
      }
      const alreadyVisible = this.ctx.ontologyGraphPage?.isVisible() ?? false;
      hideOverlayHubs();
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
      this.ctx.map?.setCenter(lat, lon, nextZoom);
      document.getElementById('mapSection')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    };
    window.addEventListener('wm:focus-news-location', this.boundNewsMapFocusHandler);
  }

  private setupWorkspaceShell(): void {
    this.activeWorkspace = getWorkspaceDefinition(
      localStorage.getItem(WORKSPACE_STORAGE_KEY) || localStorage.getItem(LEGACY_WORKSPACE_STORAGE_KEY),
      SITE_VARIANT,
    ).id;

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
    this.applyWorkspaceMode();
  }

  private applyWorkspaceMode(): void {
    const workspace = getWorkspaceDefinition(this.activeWorkspace, SITE_VARIANT);
    const isKoreanUi = getCurrentLanguage() === 'ko';
    document.documentElement.dataset.workspace = workspace.id;

    const allowedPanels = workspace.id === 'all' ? null : new Set(workspace.panelKeys);
    const enabledPanels = new Set(
      Object.entries(this.ctx.panelSettings)
        .filter(([, config]) => config.enabled !== false)
        .map(([key]) => key),
    );

    let visibleCount = 0;
    document.querySelectorAll<HTMLElement>('#panelsGrid .panel[data-panel]').forEach((panelEl) => {
      const key = panelEl.dataset.panel;
      if (!key) return;
      const enabled = enabledPanels.has(key);
      const inWorkspace = !allowedPanels || allowedPanels.has(key);
      const shouldShow = enabled && inWorkspace;
      panelEl.classList.toggle('workspace-hidden', !shouldShow);
      panelEl.setAttribute('aria-hidden', shouldShow ? 'false' : 'true');
      if (shouldShow) visibleCount += 1;
    });

    const mapEnabled = this.ctx.panelSettings.map?.enabled !== false;
    const mapVisible = mapEnabled && workspace.showMap;
    const mapSection = document.getElementById('mapSection');
    mapSection?.classList.toggle('workspace-hidden', !mapVisible);
    this.ctx.map?.setRenderPaused(!mapVisible);

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
        .filter((key) => enabledPanels.has(key) && (!allowedPanels || allowedPanels.has(key)))
        .map((key) => this.ctx.panelSettings[key]?.name ?? DEFAULT_PANELS[key]?.name ?? key)
        .slice(0, 4);
      featuredEl.innerHTML = chips.length > 0
        ? chips.map((label) => `<span class="workspace-chip">${escapeHtml(label)}</span>`).join('')
        : '<span class="workspace-chip muted">Workspace suggestions update as this surface fills in</span>';
    }

    requestAnimationFrame(() => {
      this.ctx.map?.render();
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
    if (!this.ctx.map) return;
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
      }
    });
    update();
  }

  syncUrlState(): void {
    const shareUrl = this.getShareUrl();
    if (!shareUrl) return;
    history.replaceState(null, '', shareUrl);
  }

  getShareUrl(): string | null {
    if (!this.ctx.map) return null;
    const state = this.ctx.map.getState();
    const center = this.ctx.map.getCenter();
    const baseUrl = `${window.location.origin}${window.location.pathname}`;
    return buildMapUrl(baseUrl, {
      view: state.view,
      zoom: state.zoom,
      center,
      timeRange: state.timeRange,
      layers: state.layers,
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
    this.ctx.map?.setOnLayerChange((layer, enabled, source) => {
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

