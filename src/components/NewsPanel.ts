import { Panel } from './Panel';
import { WindowedList } from './VirtualList';
import type { NewsItem, ClusteredEvent, DeviationLevel, RelatedAsset, RelatedAssetContext } from '@/types';
import { THREAT_PRIORITY } from '@/services/threat-classifier';
import { formatTime, getCSSColor } from '@/utils';
import { escapeHtml, sanitizeUrl } from '@/utils/sanitize';
import { analysisWorker, enrichWithVelocityML, getClusterAssetContext, MAX_DISTANCE_KM, activityTracker, generateSummary, translateText, annotateClustersWithRelations, clusterNews as clusterNewsMainThread } from '@/services';
import { getSourcePropagandaRisk, getSourceTier, getSourceType } from '@/config/feeds';
import { SITE_VARIANT } from '@/config';
import { t, getCurrentLanguage } from '@/services/i18n';

/** Threshold for enabling virtual scrolling */
const VIRTUAL_SCROLL_THRESHOLD = 15;

/** Summary cache TTL in milliseconds (10 minutes) */
const SUMMARY_CACHE_TTL = 10 * 60 * 1000;

const NEWS_VIEW_STORAGE_KEY = 'lattice-current-news-view-mode';
const DEFAULT_NEWS_FOCUS_LIMIT = 12;

type NewsViewMode = 'focus' | 'full';

/** Prepared cluster data for rendering */
interface PreparedCluster {
  cluster: ClusteredEvent;
  isNew: boolean;
  shouldHighlight: boolean;
  showNewTag: boolean;
}

type ScanLevel = 'critical' | 'high' | 'watch' | 'normal';

interface ScanCue {
  level: ScanLevel;
  score: number;
  rankLabel: 'P1' | 'P2' | 'P3' | 'P4';
  reason: string;
}

const CRITICAL_HEADLINE_PATTERN = /\b(war|missile|strike|attack|invasion|nuclear|sanction|hostage|coup|blockade|ceasefire|hormuz)\b/i;
const HIGH_HEADLINE_PATTERN = /\b(fed|rates?|inflation|opec|oil|gas|tariff|export control|chip|shipping|default|bank run|debt ceiling)\b/i;

export class NewsPanel extends Panel {
  private clusteredMode = true;
  private deviationEl: HTMLElement | null = null;
  private relatedAssetContext = new Map<string, RelatedAssetContext>();
  private onRelatedAssetClick?: (asset: RelatedAsset) => void;
  private onRelatedAssetsFocus?: (assets: RelatedAsset[], originLabel: string) => void;
  private onRelatedAssetsClear?: () => void;
  private isFirstRender = true;
  private windowedList: WindowedList<PreparedCluster> | null = null;
  private useVirtualScroll = true;
  private renderRequestId = 0;
  private boundScrollHandler: (() => void) | null = null;
  private boundClickHandler: (() => void) | null = null;

  // Panel summary feature
  private summaryBtn: HTMLButtonElement | null = null;
  private summaryContainer: HTMLElement | null = null;
  private focusBtn: HTMLButtonElement | null = null;
  private fullBtn: HTMLButtonElement | null = null;
  private viewStatusEl: HTMLElement | null = null;
  private viewMode: NewsViewMode = this.loadViewMode();
  private latestItems: NewsItem[] = [];
  private currentHeadlines: string[] = [];
  private lastHeadlineSignature = '';
  private isSummarizing = false;

  constructor(id: string, title: string) {
    super({ id, title, showCount: true, trackActivity: true });
    this.createDeviationIndicator();
    this.createSummarizeButton();
    this.createViewControls();
    this.setupActivityTracking();
    this.initWindowedList();
  }

  private isKoreanUi(): boolean {
    return getCurrentLanguage() === 'ko';
  }

  private getViewCopy() {
    const korean = this.isKoreanUi();
    return {
      focus: korean ? '집중' : 'Focus',
      full: korean ? '전체' : 'Full',
      focusTitle: korean ? '우선순위가 높은 뉴스만 먼저 봅니다.' : 'Show highest-priority items first.',
      fullTitle: korean ? '원시 뉴스 스트림 전체를 봅니다.' : 'Show the full raw news stream.',
      focusStatus: (visible: number, total: number) => korean
        ? `상위 ${visible} / ${total}`
        : `Top ${visible} / ${total}`,
      fullStatus: (visible: number) => korean
        ? `전체 ${visible}`
        : `All ${visible}`,
      focusNote: (visible: number, total: number) => korean
        ? `지금은 우선순위가 높은 ${visible}개만 먼저 보여주고 있습니다. 전체 ${total}건 스트림이 필요하면 '전체'로 전환하세요.`
        : `Showing the highest-priority ${visible} items first. Switch to Full if you need the raw stream of all ${total}.`,
    };
  }

  private loadViewMode(): NewsViewMode {
    try {
      const stored = localStorage.getItem(NEWS_VIEW_STORAGE_KEY);
      return stored === 'full' ? 'full' : 'focus';
    } catch {
      return 'focus';
    }
  }

  private persistViewMode(): void {
    try {
      localStorage.setItem(NEWS_VIEW_STORAGE_KEY, this.viewMode);
    } catch {
      // Ignore storage failures.
    }
  }

  private initWindowedList(): void {
    this.windowedList = new WindowedList<PreparedCluster>(
      {
        container: this.content,
        chunkSize: 8, // Render 8 items per chunk
        bufferChunks: 1, // 1 chunk buffer above/below
      },
      (prepared) => this.renderClusterHtmlSafely(
        prepared.cluster,
        prepared.isNew,
        prepared.shouldHighlight,
        prepared.showNewTag
      ),
      () => this.bindRelatedAssetEvents()
    );
  }

  private setupActivityTracking(): void {
    // Register with activity tracker
    activityTracker.register(this.panelId);

    // Listen for new count changes
    activityTracker.onChange(this.panelId, (newCount) => {
      // Pulse if there are new items
      this.setNewBadge(newCount, newCount > 0);
    });

    // Mark as seen when panel content is scrolled
    this.boundScrollHandler = () => {
      activityTracker.markAsSeen(this.panelId);
    };
    this.content.addEventListener('scroll', this.boundScrollHandler);

    // Mark as seen on click anywhere in panel
    this.boundClickHandler = () => {
      activityTracker.markAsSeen(this.panelId);
    };
    this.element.addEventListener('click', this.boundClickHandler);
  }

  public setRelatedAssetHandlers(options: {
    onRelatedAssetClick?: (asset: RelatedAsset) => void;
    onRelatedAssetsFocus?: (assets: RelatedAsset[], originLabel: string) => void;
    onRelatedAssetsClear?: () => void;
  }): void {
    this.onRelatedAssetClick = options.onRelatedAssetClick;
    this.onRelatedAssetsFocus = options.onRelatedAssetsFocus;
    this.onRelatedAssetsClear = options.onRelatedAssetsClear;
  }

  private createDeviationIndicator(): void {
    const header = this.getElement().querySelector('.panel-header-left');
    if (header) {
      this.deviationEl = document.createElement('span');
      this.deviationEl.className = 'deviation-indicator';
      header.appendChild(this.deviationEl);
    }
  }

  private createSummarizeButton(): void {
    // Create summary container (inserted between header and content)
    this.summaryContainer = document.createElement('div');
    this.summaryContainer.className = 'panel-summary';
    this.summaryContainer.style.display = 'none';
    this.element.insertBefore(this.summaryContainer, this.content);

    // Create summarize button
    this.summaryBtn = document.createElement('button');
    this.summaryBtn.className = 'panel-summarize-btn';
    this.summaryBtn.innerHTML = '✨';
    this.summaryBtn.title = t('components.newsPanel.summarize');
    this.summaryBtn.addEventListener('click', () => this.handleSummarize());

    // Insert before count element (use inherited this.header directly)
    const countEl = this.header.querySelector('.panel-count');
    if (countEl) {
      this.header.insertBefore(this.summaryBtn, countEl);
    } else {
      this.header.appendChild(this.summaryBtn);
    }
  }

  private createViewControls(): void {
    const copy = this.getViewCopy();
    const controls = document.createElement('div');
    controls.className = 'panel-news-view-toggle';

    this.focusBtn = document.createElement('button');
    this.focusBtn.type = 'button';
    this.focusBtn.className = 'panel-news-view-btn';
    this.focusBtn.textContent = copy.focus;
    this.focusBtn.title = copy.focusTitle;
    this.focusBtn.addEventListener('click', () => this.setViewMode('focus'));

    this.fullBtn = document.createElement('button');
    this.fullBtn.type = 'button';
    this.fullBtn.className = 'panel-news-view-btn';
    this.fullBtn.textContent = copy.full;
    this.fullBtn.title = copy.fullTitle;
    this.fullBtn.addEventListener('click', () => this.setViewMode('full'));

    this.viewStatusEl = document.createElement('span');
    this.viewStatusEl.className = 'panel-news-view-status';

    controls.append(this.focusBtn, this.fullBtn, this.viewStatusEl);
    const countEl = this.header.querySelector('.panel-count');
    if (countEl) {
      this.header.insertBefore(controls, countEl);
    } else {
      this.header.appendChild(controls);
    }

    this.updateViewControls(0, 0);
  }

  private setViewMode(mode: NewsViewMode): void {
    if (mode === this.viewMode) return;
    this.viewMode = mode;
    this.persistViewMode();
    this.updateViewControls(this.latestItems.length, Math.min(this.latestItems.length, DEFAULT_NEWS_FOCUS_LIMIT));
    if (this.latestItems.length > 0) {
      this.renderNews([...this.latestItems]);
    }
  }

  private updateViewControls(totalCount: number, visibleCount: number): void {
    const copy = this.getViewCopy();
    if (this.focusBtn) {
      this.focusBtn.classList.toggle('active', this.viewMode === 'focus');
      this.focusBtn.textContent = copy.focus;
      this.focusBtn.title = copy.focusTitle;
    }
    if (this.fullBtn) {
      this.fullBtn.classList.toggle('active', this.viewMode === 'full');
      this.fullBtn.textContent = copy.full;
      this.fullBtn.title = copy.fullTitle;
    }
    if (this.viewStatusEl) {
      this.viewStatusEl.textContent = totalCount <= 0
        ? ''
        : this.viewMode === 'focus'
          ? copy.focusStatus(visibleCount, totalCount)
          : copy.fullStatus(visibleCount);
    }
  }

  private trimToVisible<T>(items: T[]): T[] {
    return this.viewMode === 'focus'
      ? items.slice(0, DEFAULT_NEWS_FOCUS_LIMIT)
      : items;
  }

  private renderViewModeNote(totalCount: number, visibleCount: number): string {
    if (this.viewMode !== 'focus' || totalCount <= visibleCount) return '';
    return `<div class="panel-news-focus-note">${escapeHtml(this.getViewCopy().focusNote(visibleCount, totalCount))}</div>`;
  }

  private async handleSummarize(): Promise<void> {
    if (this.isSummarizing || !this.summaryContainer || !this.summaryBtn) return;
    if (this.currentHeadlines.length === 0) return;

    // Check cache first (include variant, version, and language)
    const currentLang = getCurrentLanguage();
    const cacheKey = `panel_summary_v3_${SITE_VARIANT}_${this.panelId}_${currentLang}`;
    const cached = this.getCachedSummary(cacheKey);
    if (cached) {
      this.showSummary(cached);
      return;
    }

    // Show loading state
    this.isSummarizing = true;
    this.summaryBtn.innerHTML = '<span class="panel-summarize-spinner"></span>';
    this.summaryBtn.disabled = true;
    this.summaryContainer.style.display = 'block';
    this.summaryContainer.innerHTML = `<div class="panel-summary-loading">${t('components.newsPanel.generatingSummary')}</div>`;

    const sigAtStart = this.lastHeadlineSignature;

    try {
      const result = await generateSummary(this.currentHeadlines.slice(0, 8), undefined, this.panelId, currentLang);
      if (this.lastHeadlineSignature !== sigAtStart) {
        this.hideSummary();
        return;
      }
      if (result?.summary) {
        this.setCachedSummary(cacheKey, result.summary);
        this.showSummary(result.summary);
      } else {
        this.summaryContainer.innerHTML = '<div class="panel-summary-error">Could not generate summary</div>';
        setTimeout(() => this.hideSummary(), 3000);
      }
    } catch {
      this.summaryContainer.innerHTML = '<div class="panel-summary-error">Summary failed</div>';
      setTimeout(() => this.hideSummary(), 3000);
    } finally {
      this.isSummarizing = false;
      this.summaryBtn.innerHTML = '✨';
      this.summaryBtn.disabled = false;
    }
  }

  private async handleTranslate(element: HTMLElement, text: string): Promise<void> {
    const currentLang = getCurrentLanguage();
    if (currentLang === 'en') return; // Assume news is mostly English, no need to translate if UI is English (or add detection later)

    const titleEl = element.closest('.item')?.querySelector('.item-title') as HTMLElement;
    if (!titleEl) return;

    const originalText = titleEl.textContent || '';

    // Visual feedback
    element.innerHTML = '...';
    element.style.pointerEvents = 'none';

    try {
      const translated = await translateText(text, currentLang);
      if (translated) {
        titleEl.textContent = translated;
        titleEl.dataset.original = originalText;
        element.innerHTML = '✓';
        element.title = 'Original: ' + originalText;
        element.classList.add('translated');
      } else {
        element.innerHTML = '文';
        // Shake animation or error state could be added here
      }
    } catch (e) {
      console.error('Translation failed', e);
      element.innerHTML = '文';
    } finally {
      element.style.pointerEvents = 'auto';
    }
  }

  private showSummary(summary: string): void {
    if (!this.summaryContainer) return;
    this.summaryContainer.style.display = 'block';
    this.summaryContainer.innerHTML = `
      <div class="panel-summary-content">
        <span class="panel-summary-text">${escapeHtml(summary)}</span>
        <button class="panel-summary-close" title="${t('components.newsPanel.close')}">×</button>
      </div>
    `;
    this.summaryContainer.querySelector('.panel-summary-close')?.addEventListener('click', () => this.hideSummary());
  }

  private hideSummary(): void {
    if (!this.summaryContainer) return;
    this.summaryContainer.style.display = 'none';
    this.summaryContainer.innerHTML = '';
  }

  private getHeadlineSignature(): string {
    return JSON.stringify(this.currentHeadlines.slice(0, 5).sort());
  }

  private updateHeadlineSignature(): void {
    const newSig = this.getHeadlineSignature();
    if (newSig !== this.lastHeadlineSignature) {
      this.lastHeadlineSignature = newSig;
      if (this.summaryContainer?.style.display === 'block') {
        this.hideSummary();
      }
    }
  }

  private getCachedSummary(key: string): string | null {
    try {
      const cached = localStorage.getItem(key);
      if (!cached) return null;
      const parsed = JSON.parse(cached);
      if (!parsed.headlineSignature) { localStorage.removeItem(key); return null; }
      if (parsed.headlineSignature !== this.lastHeadlineSignature) return null;
      if (Date.now() - parsed.timestamp > SUMMARY_CACHE_TTL) { localStorage.removeItem(key); return null; }
      return parsed.summary;
    } catch {
      return null;
    }
  }

  private setCachedSummary(key: string, summary: string): void {
    try {
      localStorage.setItem(key, JSON.stringify({
        headlineSignature: this.lastHeadlineSignature,
        summary,
        timestamp: Date.now(),
      }));
    } catch { /* storage full */ }
  }

  public setDeviation(zScore: number, percentChange: number, level: DeviationLevel): void {
    if (!this.deviationEl) return;

    if (level === 'normal') {
      this.deviationEl.textContent = '';
      this.deviationEl.className = 'deviation-indicator';
      return;
    }

    const arrow = zScore > 0 ? '↑' : '↓';
    const sign = percentChange > 0 ? '+' : '';
    this.deviationEl.textContent = `${arrow}${sign}${percentChange}%`;
    this.deviationEl.className = `deviation-indicator ${level}`;
    this.deviationEl.title = `z-score: ${zScore} (vs 7-day avg)`;
  }

  public renderNews(items: NewsItem[]): void {
    this.latestItems = [...items];
    if (items.length === 0) {
      this.renderRequestId += 1; // Cancel in-flight clustering from previous renders.
      this.setDataBadge('unavailable');
      this.updateViewControls(0, 0);
      this.showError(t('common.noNewsAvailable'));
      return;
    }

    this.setDataBadge('live');

    // Always show flat items immediately for instant visual feedback,
    // then upgrade to clustered view in the background when ready.
    this.renderFlat(items);

    if (this.clusteredMode) {
      void this.renderClustersAsync(items);
    }
  }

  public renderFilteredEmpty(message: string): void {
    this.renderRequestId += 1; // Cancel in-flight clustering from previous renders.
    this.setDataBadge('live');
    this.setCount(0);
    this.latestItems = [];
    this.relatedAssetContext.clear();
    this.currentHeadlines = [];
    this.updateHeadlineSignature();
    this.updateViewControls(0, 0);
    this.setContent(`<div class="panel-empty">${escapeHtml(message)}</div>`);
  }

  public renderAuthRequired(message: string): void {
    this.renderRequestId += 1; // Cancel in-flight clustering from previous renders.
    this.setDataBadge('unavailable', 'AUTH REQUIRED');
    this.setCount(0);
    this.latestItems = [];
    this.relatedAssetContext.clear();
    this.currentHeadlines = [];
    this.updateHeadlineSignature();
    this.updateViewControls(0, 0);
    this.showError(message);
  }

  private async renderClustersAsync(items: NewsItem[]): Promise<void> {
    const requestId = ++this.renderRequestId;

    try {
      const clusters = await analysisWorker.clusterNews(items);
      if (requestId !== this.renderRequestId) return;
      const enriched = await enrichWithVelocityML(clusters);
      const withRelations = annotateClustersWithRelations(enriched);
      this.renderClusters(withRelations);
    } catch (error) {
      if (requestId !== this.renderRequestId) return;
      console.warn('[NewsPanel] Worker clustering failed, falling back to main thread:', error);
      try {
        const fallbackClusters = clusterNewsMainThread(items);
        const enriched = await enrichWithVelocityML(fallbackClusters);
        const withRelations = annotateClustersWithRelations(enriched);
        if (requestId !== this.renderRequestId) return;
        this.renderClusters(withRelations);
      } catch (fallbackError) {
        if (requestId !== this.renderRequestId) return;
        // Keep already-rendered flat list visible when every clustering path fails.
        console.warn('[NewsPanel] Main-thread clustering fallback failed, keeping flat list:', fallbackError);
      }
    }
  }

  private clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
  }

  private resolveCueLevel(score: number): ScanCue['level'] {
    if (score >= 72) return 'critical';
    if (score >= 52) return 'high';
    if (score >= 34) return 'watch';
    return 'normal';
  }

  private cueLabel(level: ScanCue['level']): ScanCue['rankLabel'] {
    if (level === 'critical') return 'P1';
    if (level === 'high') return 'P2';
    if (level === 'watch') return 'P3';
    return 'P4';
  }

  private scoreFlatItem(item: NewsItem): ScanCue {
    const title = item.title.toLowerCase();
    const minutesSince = Math.max(0, (Date.now() - new Date(item.pubDate).getTime()) / 60_000);
    const recencyBoost = minutesSince < 15 ? 10 : minutesSince < 60 ? 7 : minutesSince < 180 ? 4 : 1;

    let score = 8 + recencyBoost;
    const reasons: string[] = [];

    if (item.isAlert) {
      score += 38;
      reasons.push('Alert flag');
    }

    const threatLevel = item.threat?.level;
    if (threatLevel) {
      const threatBonus: Record<string, number> = {
        critical: 34,
        high: 24,
        medium: 15,
        low: 8,
        info: 4,
      };
      score += threatBonus[threatLevel] ?? 0;
      if (threatLevel !== 'info') reasons.push(`Threat ${threatLevel}`);
    }

    if (CRITICAL_HEADLINE_PATTERN.test(title)) {
      score += 22;
      reasons.push('Conflict keyword');
    } else if (HIGH_HEADLINE_PATTERN.test(title)) {
      score += 12;
      reasons.push('Macro/market keyword');
    }

    const sourceTier = getSourceTier(item.source);
    if (sourceTier <= 2) {
      score += 5;
      reasons.push(sourceTier === 1 ? 'Wire source' : 'Verified outlet');
    }

    const clamped = this.clamp(Math.round(score), 0, 99);
    const level = this.resolveCueLevel(clamped);
    return {
      level,
      score: clamped,
      rankLabel: this.cueLabel(level),
      reason: reasons[0] || 'Routine update',
    };
  }

  private scoreCluster(cluster: ClusteredEvent): ScanCue {
    let score = 10;
    const reasons: string[] = [];

    const threatLevel = cluster.threat?.level ?? 'info';
    const threatBonus: Record<string, number> = {
      critical: 42,
      high: 30,
      medium: 20,
      low: 11,
      info: 5,
    };
    score += threatBonus[threatLevel] ?? 0;
    if (threatLevel !== 'info') reasons.push(`Threat ${threatLevel}`);

    if (cluster.isAlert) {
      score += 24;
      reasons.push('Alert cluster');
    }

    const sourceBoost = this.clamp(cluster.sourceCount * 4, 0, 20);
    score += sourceBoost;
    if (cluster.sourceCount >= 3) reasons.push('Multi-source confirmation');

    const velocity = cluster.velocity;
    if (velocity && velocity.level !== 'normal') {
      score += velocity.level === 'spike' ? 16 : 9;
      reasons.push(velocity.level === 'spike' ? 'Volume spike' : 'Rising velocity');
    }

    const relation = cluster.relations;
    if (relation && relation.confidenceScore >= 60) {
      score += relation.confidenceScore >= 80 ? 12 : 7;
      reasons.push('Cross-domain corroboration');
    }

    if (CRITICAL_HEADLINE_PATTERN.test(cluster.primaryTitle.toLowerCase())) {
      score += 14;
      reasons.push('Conflict keyword');
    }

    const minutesSince = Math.max(0, (Date.now() - cluster.lastUpdated.getTime()) / 60_000);
    score += minutesSince < 20 ? 8 : minutesSince < 90 ? 5 : 2;

    const clamped = this.clamp(Math.round(score), 0, 99);
    const level = this.resolveCueLevel(clamped);
    return {
      level,
      score: clamped,
      rankLabel: this.cueLabel(level),
      reason: reasons[0] || 'Context update',
    };
  }

  private emphasizeHeadline(title: string): string {
    const escaped = escapeHtml(title);
    return escaped.replace(
      /\b(war|missile|strike|attack|invasion|nuclear|sanction|fed|rate|inflation|oil|gas|tariff|chip|shipping)\b/gi,
      '<mark class="news-keyword">$1</mark>',
    );
  }

  private renderFlat(items: NewsItem[]): void {
    const ranked = items
      .map((item) => ({ item, cue: this.scoreFlatItem(item) }))
      .sort((a, b) => {
        if (b.cue.score !== a.cue.score) return b.cue.score - a.cue.score;
        return new Date(b.item.pubDate).getTime() - new Date(a.item.pubDate).getTime();
      });

    const visibleRanked = this.trimToVisible(ranked);
    this.setCount(ranked.length);
    this.updateViewControls(ranked.length, visibleRanked.length);
    this.currentHeadlines = visibleRanked
      .slice(0, 5)
      .map(({ item }) => item.title)
      .filter((title): title is string => typeof title === 'string' && title.trim().length > 0);

    this.updateHeadlineSignature();

    const html = visibleRanked
      .map(
        ({ item, cue }) => `
      <div class="item scan-${cue.level} ${item.isAlert ? 'alert' : ''}" ${item.monitorColor ? `style="border-inline-start-color: ${escapeHtml(item.monitorColor)}"` : ''}>
        <div class="terminal-news-row">
          <span class="item-time terminal-time">${formatTime(item.pubDate)}</span>
          <div class="item-source terminal-source">
            <span class="scan-pill ${cue.level}" title="Priority ${cue.score}/100">${cue.rankLabel}</span>
            ${escapeHtml(item.source)}
            ${item.lang && item.lang !== getCurrentLanguage() ? `<span class="lang-badge">${item.lang.toUpperCase()}</span>` : ''}
            ${item.isAlert ? '<span class="alert-tag">ALERT</span>' : ''}
          </div>
          <a class="item-title terminal-title" href="${sanitizeUrl(item.link)}" target="_blank" rel="noopener">${this.emphasizeHeadline(item.title)}</a>
          <div class="item-cue-line">${escapeHtml(cue.reason)} | score ${cue.score}</div>
          <div class="terminal-row-actions">
            ${item.lat != null && item.lon != null ? `<button class="item-map-btn" title="Focus on map" data-lat="${item.lat}" data-lon="${item.lon}">MAP</button>` : ''}
            ${getCurrentLanguage() !== 'en' ? `<button class="item-translate-btn" title="Translate" data-text="${escapeHtml(item.title)}">?</button>` : ''}
          </div>
        </div>
      </div>
    `
      )
      .join('');

    this.setContent(`${this.renderViewModeNote(ranked.length, visibleRanked.length)}${html}`);
  }

  private renderClusters(clusters: ClusteredEvent[]): void {
    // Sort by reading priority score, then by recency.
    const sorted = [...clusters].sort((a, b) => {
      const sa = this.scoreCluster(a).score;
      const sb = this.scoreCluster(b).score;
      if (sb !== sa) return sb - sa;
      const pa = THREAT_PRIORITY[a.threat?.level ?? 'info'];
      const pb = THREAT_PRIORITY[b.threat?.level ?? 'info'];
      if (pb !== pa) return pb - pa;
      return b.lastUpdated.getTime() - a.lastUpdated.getTime();
    });

    const visibleClusters = this.trimToVisible(sorted);
    const totalItems = sorted.reduce((sum, c) => sum + c.sourceCount, 0);
    const visibleItems = visibleClusters.reduce((sum, c) => sum + c.sourceCount, 0);
    this.setCount(totalItems);
    this.updateViewControls(totalItems, visibleItems);
    this.relatedAssetContext.clear();

    // Store headlines for summarization (cap at 5 to reduce entity conflation in small models)
    this.currentHeadlines = visibleClusters.slice(0, 5).map(c => c.primaryTitle);

    this.updateHeadlineSignature();

    const clusterIds = visibleClusters.map(c => c.id);
    let newItemIds: Set<string>;

    if (this.isFirstRender) {
      // First render: mark all items as seen
      activityTracker.updateItems(this.panelId, clusterIds);
      activityTracker.markAsSeen(this.panelId);
      newItemIds = new Set();
      this.isFirstRender = false;
    } else {
      // Subsequent renders: track new items
      const newIds = activityTracker.updateItems(this.panelId, clusterIds);
      newItemIds = new Set(newIds);
    }

    // Prepare all clusters with their rendering data (defer HTML creation)
    const prepared: PreparedCluster[] = visibleClusters.map(cluster => {
      const isNew = newItemIds.has(cluster.id);
      const shouldHighlight = activityTracker.shouldHighlight(this.panelId, cluster.id);
      const showNewTag = activityTracker.isNewItem(this.panelId, cluster.id) && isNew;

      return {
        cluster,
        isNew,
        shouldHighlight,
        showNewTag,
      };
    });

    // Use windowed rendering for large lists, direct render for small
    if (this.useVirtualScroll && visibleClusters.length > VIRTUAL_SCROLL_THRESHOLD && this.windowedList) {
      this.windowedList.setItems(prepared);
    } else {
      // Direct render for small lists
      const focusNote = this.renderViewModeNote(totalItems, visibleItems);
      const html = prepared
        .map(p => this.renderClusterHtmlSafely(p.cluster, p.isNew, p.shouldHighlight, p.showNewTag))
        .join('');
      this.setContent(`${focusNote}${html}`);
      this.bindRelatedAssetEvents();
    }
  }

  private renderClusterHtmlSafely(
    cluster: ClusteredEvent,
    isNew: boolean,
    shouldHighlight: boolean,
    showNewTag: boolean
  ): string {
    try {
      return this.renderClusterHtml(cluster, isNew, shouldHighlight, showNewTag);
    } catch (error) {
      console.error('[NewsPanel] Failed to render cluster card:', error, cluster);
      const clusterId = typeof cluster?.id === 'string' ? cluster.id : 'unknown-cluster';
      return `
        <div class="item clustered item-render-error" data-cluster-id="${escapeHtml(clusterId)}">
          <div class="item-source">${t('common.error')}</div>
          <div class="item-title">Failed to display this cluster.</div>
        </div>
      `;
    }
  }

  /**
   * Render a single cluster to HTML string
   */
  private renderClusterHtml(
    cluster: ClusteredEvent,
    isNew: boolean,
    shouldHighlight: boolean,
    showNewTag: boolean
  ): string {
    const cue = this.scoreCluster(cluster);
    const sourceBadge = cluster.sourceCount > 1
      ? `<span class="source-count">${t('components.newsPanel.sources', { count: String(cluster.sourceCount) })}</span>`
      : '';

    const velocity = cluster.velocity;
    const velocityBadge = velocity && velocity.level !== 'normal' && cluster.sourceCount > 1
      ? `<span class="velocity-badge ${velocity.level}">${velocity.trend === 'rising' ? '?' : ''}+${velocity.sourcesPerHour}/hr</span>`
      : '';

    const sentimentIcon = velocity?.sentiment === 'negative' ? '?' : velocity?.sentiment === 'positive' ? '?' : '';
    const sentimentBadge = sentimentIcon && Math.abs(velocity?.sentimentScore || 0) > 2
      ? `<span class="sentiment-badge ${velocity?.sentiment}">${sentimentIcon}</span>`
      : '';

    const newTag = showNewTag ? `<span class="new-tag">${t('common.new')}</span>` : '';
    const langBadge = cluster.lang && cluster.lang !== getCurrentLanguage()
      ? `<span class="lang-badge">${cluster.lang.toUpperCase()}</span>`
      : '';

    // Propaganda risk indicator for primary source
    const primaryPropRisk = getSourcePropagandaRisk(cluster.primarySource);
    const primaryPropBadge = primaryPropRisk.risk !== 'low'
      ? `<span class="propaganda-badge ${primaryPropRisk.risk}" title="${escapeHtml(primaryPropRisk.note || `State-affiliated: ${primaryPropRisk.stateAffiliated || 'Unknown'}`)}">${primaryPropRisk.risk === 'high' ? '? State Media' : '! Caution'}</span>`
      : '';

    // Source credibility badge for primary source (T1=Wire, T2=Verified outlet)
    const primaryTier = getSourceTier(cluster.primarySource);
    const primaryType = getSourceType(cluster.primarySource);
    const tierLabel = primaryTier === 1 ? 'Wire' : ''; // Don't show "Major" - confusing with story importance
    const tierBadge = primaryTier <= 2
      ? `<span class="tier-badge tier-${primaryTier}" title="${primaryType === 'wire' ? 'Wire Service - Highest reliability' : primaryType === 'gov' ? 'Official Government Source' : 'Verified News Outlet'}">${primaryTier === 1 ? '?' : '?'}${tierLabel ? ` ${tierLabel}` : ''}</span>`
      : '';

    // Build "Also reported by" section for multi-source confirmation
    const otherSources = cluster.topSources.filter(s => s.name !== cluster.primarySource);
    const topSourcesHtml = otherSources.length > 0
      ? `<span class="also-reported">Also:</span>` + otherSources
        .map(s => {
          const propRisk = getSourcePropagandaRisk(s.name);
          const propBadge = propRisk.risk !== 'low'
            ? `<span class="propaganda-badge ${propRisk.risk}" title="${escapeHtml(propRisk.note || `State-affiliated: ${propRisk.stateAffiliated || 'Unknown'}`)}">${propRisk.risk === 'high' ? '?' : '!'}</span>`
            : '';
          return `<span class="top-source tier-${s.tier}">${escapeHtml(s.name)}${propBadge}</span>`;
        })
        .join('')
      : '';

    const assetContext = getClusterAssetContext(cluster);
    if (assetContext && assetContext.assets.length > 0) {
      this.relatedAssetContext.set(cluster.id, assetContext);
    }

    const relatedAssetsHtml = assetContext && assetContext.assets.length > 0
      ? `
        <div class="related-assets" data-cluster-id="${escapeHtml(cluster.id)}">
          <div class="related-assets-header">
            ${t('components.newsPanel.relatedAssetsNear', { location: escapeHtml(assetContext.origin.label) })}
            <span class="related-assets-range">(${MAX_DISTANCE_KM}km)</span>
          </div>
          <div class="related-assets-list">
            ${assetContext.assets.map(asset => `
              <button class="related-asset" data-cluster-id="${escapeHtml(cluster.id)}" data-asset-id="${escapeHtml(asset.id)}" data-asset-type="${escapeHtml(asset.type)}">
                <span class="related-asset-type">${escapeHtml(this.getLocalizedAssetLabel(asset.type))}</span>
                <span class="related-asset-name">${escapeHtml(asset.name)}</span>
                <span class="related-asset-distance">${Math.round(asset.distanceKm)}km</span>
              </button>
            `).join('')}
          </div>
        </div>
      `
      : '';

    const relation = cluster.relations;
    const relationHtml = relation && (
      relation.relatedNews.length > 0
      || relation.airEventMatches > 0
      || relation.maritimeEventMatches > 0
    )
      ? `
        <div class="news-relations">
          ${relation.relatedNews.length > 0
            ? `<span class="relation-chip news">NEWS ${relation.relatedNews.length}</span>`
            : ''
          }
          ${relation.airEventMatches > 0
            ? `<span class="relation-chip air">AIR ${relation.airEventMatches}</span>`
            : ''
          }
          ${relation.maritimeEventMatches > 0
            ? `<span class="relation-chip sea">SEA ${relation.maritimeEventMatches}</span>`
            : ''
          }
          <span class="relation-chip confidence">CONF ${relation.confidenceScore}</span>
          ${relation.evidence[0]
            ? `<span class="relation-evidence">${escapeHtml(relation.evidence[0])}</span>`
            : ''
          }
        </div>
      `
      : '';

    // Category tag from threat classification
    const cat = cluster.threat?.category;
    const catLabel = cat && cat !== 'general' ? cat.charAt(0).toUpperCase() + cat.slice(1) : '';
    const threatVarMap: Record<string, string> = { critical: '--threat-critical', high: '--threat-high', medium: '--threat-medium', low: '--threat-low', info: '--threat-info' };
    const catColor = cluster.threat ? getCSSColor(threatVarMap[cluster.threat.level] || '--text-dim') : '';
    const categoryBadge = catLabel
      ? `<span class="category-tag" style="color:${catColor};border-color:${catColor}40;background:${catColor}20">${catLabel}</span>`
      : '';

    // Build class list for item
    const itemClasses = [
      'item',
      'clustered',
      `scan-${cue.level}`,
      cluster.isAlert ? 'alert' : '',
      shouldHighlight ? 'item-new-highlight' : '',
      isNew ? 'item-new' : '',
    ].filter(Boolean).join(' ');

    return `
      <div class="${itemClasses}" ${cluster.monitorColor ? `style="border-inline-start-color: ${escapeHtml(cluster.monitorColor)}"` : ''} data-cluster-id="${escapeHtml(cluster.id)}" data-news-id="${escapeHtml(cluster.primaryLink)}">
        <div class="terminal-news-row">
          <span class="item-time terminal-time">${formatTime(cluster.lastUpdated)}</span>
          <div class="item-source terminal-source">
            <span class="scan-pill ${cue.level}" title="Priority ${cue.score}/100">${cue.rankLabel}</span>
            ${tierBadge}
            ${escapeHtml(cluster.primarySource)}
            ${primaryPropBadge}
            ${langBadge}
            ${newTag}
            ${sourceBadge}
            ${velocityBadge}
            ${sentimentBadge}
            ${cluster.isAlert ? '<span class="alert-tag">ALERT</span>' : ''}
            ${categoryBadge}
          </div>
          <a class="item-title terminal-title" href="${sanitizeUrl(cluster.primaryLink)}" target="_blank" rel="noopener">${this.emphasizeHeadline(cluster.primaryTitle)}</a>
          <div class="item-cue-line">${escapeHtml(cue.reason)} | score ${cue.score}</div>
          <div class="terminal-row-actions">
            ${cluster.lat != null && cluster.lon != null ? `<button class="item-map-btn" title="Focus on map" data-lat="${cluster.lat}" data-lon="${cluster.lon}">MAP</button>` : ''}
            ${getCurrentLanguage() !== 'en' ? `<button class="item-translate-btn" title="Translate" data-text="${escapeHtml(cluster.primaryTitle)}">?</button>` : ''}
          </div>
        </div>
        <div class="cluster-meta">
          <span class="top-sources">${topSourcesHtml}</span>
          <span class="item-time cluster-updated">UPDATED ${formatTime(cluster.lastUpdated)}</span>
        </div>
        ${relationHtml}
        ${relatedAssetsHtml}
      </div>
    `;
  }

  private bindRelatedAssetEvents(): void {
    const containers = this.content.querySelectorAll<HTMLDivElement>('.related-assets');
    containers.forEach((container) => {
      const clusterId = container.dataset.clusterId;
      if (!clusterId) return;
      const context = this.relatedAssetContext.get(clusterId);
      if (!context) return;

      container.addEventListener('mouseenter', () => {
        this.onRelatedAssetsFocus?.(context.assets, context.origin.label);
      });

      container.addEventListener('mouseleave', () => {
        this.onRelatedAssetsClear?.();
      });
    });

    const assetButtons = this.content.querySelectorAll<HTMLButtonElement>('.related-asset');
    assetButtons.forEach((button) => {
      button.addEventListener('click', (event) => {
        event.stopPropagation();
        const clusterId = button.dataset.clusterId;
        const assetId = button.dataset.assetId;
        const assetType = button.dataset.assetType as RelatedAsset['type'] | undefined;
        if (!clusterId || !assetId || !assetType) return;
        const context = this.relatedAssetContext.get(clusterId);
        const asset = context?.assets.find(item => item.id === assetId && item.type === assetType);
        if (asset) {
          this.onRelatedAssetClick?.(asset);
        }
      });
    });

    // Translation buttons
    const translateBtns = this.content.querySelectorAll<HTMLElement>('.item-translate-btn');
    translateBtns.forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const text = btn.dataset.text;
        if (text) this.handleTranslate(btn, text);
      });
    });

    const mapBtns = this.content.querySelectorAll<HTMLElement>('.item-map-btn');
    mapBtns.forEach((btn) => {
      btn.addEventListener('click', (event) => {
        event.stopPropagation();
        const lat = Number(btn.dataset.lat);
        const lon = Number(btn.dataset.lon);
        if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;
        window.dispatchEvent(new CustomEvent('wm:focus-news-location', {
          detail: { lat, lon, zoom: 4.5 },
        }));
      });
    });
  }

  private getLocalizedAssetLabel(type: RelatedAsset['type']): string {
    const keyMap: Record<RelatedAsset['type'], string> = {
      pipeline: 'modals.countryBrief.infra.pipeline',
      cable: 'modals.countryBrief.infra.cable',
      datacenter: 'modals.countryBrief.infra.datacenter',
      base: 'modals.countryBrief.infra.base',
      nuclear: 'modals.countryBrief.infra.nuclear',
    };
    return t(keyMap[type]);
  }

  /**
   * Clean up resources
   */
  public destroy(): void {
    // Clean up windowed list
    this.windowedList?.destroy();
    this.windowedList = null;

    // Remove activity tracking listeners
    if (this.boundScrollHandler) {
      this.content.removeEventListener('scroll', this.boundScrollHandler);
      this.boundScrollHandler = null;
    }
    if (this.boundClickHandler) {
      this.element.removeEventListener('click', this.boundClickHandler);
      this.boundClickHandler = null;
    }

    // Unregister from activity tracker
    activityTracker.unregister(this.panelId);

    // Call parent destroy
    super.destroy();
  }
}
