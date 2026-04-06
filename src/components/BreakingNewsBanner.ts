import type { BreakingAlert } from '@/services/breaking-news-alerts';
import { getAlertSettings } from '@/services/breaking-news-alerts';
import { getSourcePanelId } from '@/config/feeds';
import { t } from '@/services/i18n';

const MAX_ALERTS = 3;
const CRITICAL_DISMISS_MS = 0; // Critical: manual dismiss only (Phase 3.2)
const HIGH_DISMISS_MS = 120_000; // High: shrink to badge after 120s
const SOUND_COOLDOWN_MS = 5 * 60 * 1000;
const MAX_HISTORY = 50;

interface ActiveAlert {
  alert: BreakingAlert;
  element: HTMLElement;
  timer: ReturnType<typeof setTimeout> | null;
  remainingMs: number;
  timerStartedAt: number;
  shrunk?: boolean; // Phase 3.2: high alerts shrink instead of disappearing
}

/** Stored alert for history timeline */
export interface AlertHistoryEntry {
  alert: BreakingAlert;
  receivedAt: number;
  dismissedAt?: number;
  wasRead: boolean;
}

export class BreakingNewsBanner {
  private container: HTMLElement;
  private activeAlerts: ActiveAlert[] = [];
  private audio: HTMLAudioElement | null = null;
  private lastSoundMs = 0;
  private mutationObserver: MutationObserver | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private observedPostureBanner: Element | null = null;
  private boundOnAlert: (e: Event) => void;
  private boundOnVisibility: () => void;
  private boundOnResize: () => void;
  private dismissed = new Map<string, number>();

  // Phase 3.2: Alert history and missed count
  private alertHistory: AlertHistoryEntry[] = [];
  private missedCount = 0;
  private missedBadgeEl: HTMLElement | null = null;
  private historyPanelEl: HTMLElement | null = null;
  private historyVisible = false;

  constructor() {
    this.container = document.createElement('div');
    this.container.className = 'breaking-news-container';
    document.body.appendChild(this.container);

    this.initAudio();
    this.createMissedBadge();
    this.createHistoryPanel();
    this.updatePosition();
    this.setupObservers();

    this.boundOnAlert = (e: Event) => this.handleAlert((e as CustomEvent<BreakingAlert>).detail);
    this.boundOnVisibility = () => this.handleVisibility();
    this.boundOnResize = () => this.updatePosition();

    document.addEventListener('wm:breaking-news', this.boundOnAlert);
    document.addEventListener('visibilitychange', this.boundOnVisibility);
    window.addEventListener('resize', this.boundOnResize);

    this.container.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      const alertEl = target.closest('.breaking-alert') as HTMLElement | null;
      if (!alertEl) return;

      if (target.closest('.breaking-alert-dismiss')) {
        const id = alertEl.getAttribute('data-alert-id');
        if (id) this.dismissAlert(id);
        return;
      }

      const panelId = alertEl.getAttribute('data-target-panel');
      if (panelId) this.scrollToPanel(panelId);
    });
  }

  private initAudio(): void {
    this.audio = new Audio('data:audio/wav;base64,UklGRnoGAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQoGAACBhYqFbF1fdJivrJBhNjVgodDbq2EcBj+a2teleQYjfKapmWswEjCJvuPQfSoXZZ+3qqBJESSP0unGaxMJVYiytrFeLhR6p8znrFUXRW+bs7V3Qx1hn8Xjp1cYPnegprhkMCFmoLi1k0sZTYGlqqlUIA==');
    this.audio.volume = 0.3;
  }

  private playSound(): void {
    const settings = getAlertSettings();
    if (!settings.soundEnabled || !this.audio) return;
    if (Date.now() - this.lastSoundMs < SOUND_COOLDOWN_MS) return;
    this.audio.currentTime = 0;
    this.audio.play()?.catch(() => {});
    this.lastSoundMs = Date.now();
  }

  private setupObservers(): void {
    this.mutationObserver = new MutationObserver(() => this.updatePosition());
    this.mutationObserver.observe(document.body, {
      attributes: true,
      attributeFilter: ['class'],
    });
  }

  private attachResizeObserverIfNeeded(): void {
    const postureBanner = document.querySelector('.critical-posture-banner');
    if (!postureBanner) return;
    if (postureBanner === this.observedPostureBanner) return;

    if (this.resizeObserver) this.resizeObserver.disconnect();
    this.resizeObserver = new ResizeObserver(() => this.updatePosition());
    this.resizeObserver.observe(postureBanner);
    this.observedPostureBanner = postureBanner;
  }

  private updatePosition(): void {
    let top = 50;
    if (document.body?.classList.contains('has-critical-banner')) {
      this.attachResizeObserverIfNeeded();
      const postureBanner = document.querySelector('.critical-posture-banner');
      if (postureBanner) {
        top += postureBanner.getBoundingClientRect().height;
      }
    }
    this.container.style.top = `${top}px`;
    this.updateOffset();
  }

  private updateOffset(): void {
    const height = this.container.offsetHeight;
    document.documentElement.style.setProperty(
      '--breaking-alert-offset',
      height > 0 ? `${height}px` : '0px'
    );
    document.body?.classList.toggle('has-breaking-alert', this.activeAlerts.length > 0);
  }

  private isDismissedRecently(id: string): boolean {
    const ts = this.dismissed.get(id);
    if (ts === undefined) return false;
    if (Date.now() - ts >= 30 * 60 * 1000) {
      this.dismissed.delete(id);
      return false;
    }
    return true;
  }

  private handleAlert(alert: BreakingAlert): void {
    if (this.isDismissedRecently(alert.id)) return;

    const existing = this.activeAlerts.find(a => a.alert.id === alert.id);
    if (existing) return;

    // Phase 3.2: Track in history
    this.addToHistory(alert);

    if (alert.threatLevel === 'critical') {
      const highAlerts = this.activeAlerts.filter(a => a.alert.threatLevel === 'high');
      for (const h of highAlerts) {
        this.removeAlert(h);
        const idx = this.activeAlerts.indexOf(h);
        if (idx !== -1) this.activeAlerts.splice(idx, 1);
      }
    }

    while (this.activeAlerts.length >= MAX_ALERTS) {
      const oldest = this.activeAlerts.shift();
      if (oldest) this.removeAlert(oldest);
    }

    const el = this.createAlertElement(alert);
    this.container.appendChild(el);

    const dismissMs = alert.threatLevel === 'critical' ? CRITICAL_DISMISS_MS : HIGH_DISMISS_MS;
    const now = Date.now();
    const active: ActiveAlert = {
      alert,
      element: el,
      timer: null,
      remainingMs: dismissMs,
      timerStartedAt: now,
    };

    // Phase 3.2: Critical alerts have no auto-dismiss (dismissMs = 0 → manual only)
    // High alerts shrink to badge after HIGH_DISMISS_MS
    if (dismissMs > 0 && !document.hidden) {
      active.timer = setTimeout(() => this.shrinkAlert(alert.id), dismissMs);
    }

    this.activeAlerts.push(active);
    this.playSound();
    this.updateOffset();

    // If tab is hidden, increment missed counter
    if (document.hidden) {
      this.missedCount++;
      this.updateMissedBadge();
    }
  }

  private resolveTargetPanel(alert: BreakingAlert): string {
    if (alert.origin === 'oref_siren') return 'oref-sirens';
    if (alert.origin === 'rss_alert') return getSourcePanelId(alert.source);
    return 'politics';
  }

  private scrollToPanel(panelId: string): void {
    const panel = document.querySelector(`[data-panel="${panelId}"]`);
    if (!panel) return;
    panel.scrollIntoView({ behavior: 'smooth', block: 'center' });
    panel.classList.add('flash-highlight');
    setTimeout(() => panel.classList.remove('flash-highlight'), 1500);
  }

  private createAlertElement(alert: BreakingAlert): HTMLElement {
    const el = document.createElement('div');
    el.className = `breaking-alert severity-${alert.threatLevel}`;
    el.setAttribute('data-alert-id', alert.id);
    el.setAttribute('data-target-panel', this.resolveTargetPanel(alert));
    el.style.cursor = 'pointer';

    const icon = alert.threatLevel === 'critical' ? '🚨' : '⚠️';
    const levelText = alert.threatLevel === 'critical'
      ? t('components.breakingNews.critical')
      : t('components.breakingNews.high');
    const timeAgo = this.formatTimeAgo(alert.timestamp);

    const iconSpan = document.createElement('span');
    iconSpan.className = 'breaking-alert-icon';
    iconSpan.textContent = icon;

    const content = document.createElement('div');
    content.className = 'breaking-alert-content';

    const levelSpan = document.createElement('span');
    levelSpan.className = 'breaking-alert-level';
    levelSpan.textContent = levelText;

    const headlineSpan = document.createElement('span');
    headlineSpan.className = 'breaking-alert-headline';
    headlineSpan.textContent = alert.headline;

    const metaSpan = document.createElement('span');
    metaSpan.className = 'breaking-alert-meta';
    metaSpan.textContent = `${alert.source} · ${timeAgo}`;

    content.appendChild(levelSpan);
    content.appendChild(headlineSpan);
    content.appendChild(metaSpan);

    const dismissBtn = document.createElement('button');
    dismissBtn.className = 'breaking-alert-dismiss';
    dismissBtn.textContent = '×';
    dismissBtn.title = t('components.breakingNews.dismiss');

    el.appendChild(iconSpan);
    el.appendChild(content);
    el.appendChild(dismissBtn);

    return el;
  }

  private formatTimeAgo(date: Date): string {
    const ms = Date.now() - date.getTime();
    if (ms < 60_000) return t('components.intelligenceFindings.time.justNow');
    if (ms < 3_600_000) return t('components.intelligenceFindings.time.minutesAgo', { count: String(Math.floor(ms / 60_000)) });
    return t('components.intelligenceFindings.time.hoursAgo', { count: String(Math.floor(ms / 3_600_000)) });
  }

  /**
   * Phase 3.2: Shrink a high alert to a small badge instead of removing it.
   * This reduces the "disappeared and I missed it" feeling.
   */
  private shrinkAlert(id: string): void {
    const idx = this.activeAlerts.findIndex(a => a.alert.id === id);
    if (idx === -1) return;
    const active = this.activeAlerts[idx]!;
    if (active.shrunk) return;
    active.shrunk = true;
    if (active.timer) {
      clearTimeout(active.timer);
      active.timer = null;
    }
    active.element.classList.add('breaking-alert-shrunk');
    // Replace full content with compact badge
    const badge = document.createElement('div');
    badge.className = 'breaking-alert-shrunk-content';
    const icon = active.alert.threatLevel === 'critical' ? '🚨' : '⚠️';
    badge.innerHTML = `<span class="shrunk-icon">${icon}</span><span class="shrunk-headline">${this.escapeText(active.alert.headline.slice(0, 60))}${active.alert.headline.length > 60 ? '...' : ''}</span>`;
    // Keep dismiss button
    const dismissBtn = active.element.querySelector('.breaking-alert-dismiss');
    active.element.innerHTML = '';
    active.element.appendChild(badge);
    if (dismissBtn) active.element.appendChild(dismissBtn);
    this.updateOffset();
  }

  private escapeText(text: string): string {
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  private dismissAlert(id: string): void {
    this.dismissed.set(id, Date.now());
    // Mark in history as dismissed
    const histEntry = this.alertHistory.find(h => h.alert.id === id);
    if (histEntry) histEntry.dismissedAt = Date.now();

    const idx = this.activeAlerts.findIndex(a => a.alert.id === id);
    if (idx === -1) return;
    const active = this.activeAlerts[idx]!;
    this.removeAlert(active);
    this.activeAlerts.splice(idx, 1);
    this.updateOffset();
  }

  private removeAlert(active: ActiveAlert): void {
    if (active.timer) clearTimeout(active.timer);
    active.element.remove();
  }

  // ── Phase 3.2: Alert history ───────────────────────────────────────────────

  private addToHistory(alert: BreakingAlert): void {
    this.alertHistory.unshift({
      alert,
      receivedAt: Date.now(),
      wasRead: !document.hidden,
    });
    // Cap history size
    if (this.alertHistory.length > MAX_HISTORY) {
      this.alertHistory.length = MAX_HISTORY;
    }
    this.renderHistoryPanel();
  }

  /** Get the alert history (newest first) */
  public getAlertHistory(): readonly AlertHistoryEntry[] {
    return this.alertHistory;
  }

  /** Get count of unread (missed) alerts */
  public getMissedCount(): number {
    return this.missedCount;
  }

  // ── Phase 3.2: Missed alert badge ─────────────────────────────────────────

  private createMissedBadge(): void {
    this.missedBadgeEl = document.createElement('button');
    this.missedBadgeEl.className = 'alert-missed-badge';
    this.missedBadgeEl.style.display = 'none';
    this.missedBadgeEl.title = 'Missed alerts — click to view history';
    this.missedBadgeEl.addEventListener('click', () => this.toggleHistory());
    document.body.appendChild(this.missedBadgeEl);
  }

  private updateMissedBadge(): void {
    if (!this.missedBadgeEl) return;
    if (this.missedCount <= 0) {
      this.missedBadgeEl.style.display = 'none';
      return;
    }
    this.missedBadgeEl.style.display = 'flex';
    this.missedBadgeEl.textContent = this.missedCount > 9 ? '9+' : `${this.missedCount}`;
  }

  // ── Phase 3.2: Alert history panel ────────────────────────────────────────

  private createHistoryPanel(): void {
    this.historyPanelEl = document.createElement('div');
    this.historyPanelEl.className = 'alert-history-panel';
    this.historyPanelEl.style.display = 'none';
    this.historyPanelEl.innerHTML = `
      <div class="alert-history-header">
        <span class="alert-history-title">Alert History</span>
        <button class="alert-history-close">\u00d7</button>
      </div>
      <div class="alert-history-list"></div>
    `;
    this.historyPanelEl.querySelector('.alert-history-close')?.addEventListener('click', () => {
      this.toggleHistory(false);
    });
    document.body.appendChild(this.historyPanelEl);
  }

  private toggleHistory(force?: boolean): void {
    this.historyVisible = force ?? !this.historyVisible;
    if (this.historyPanelEl) {
      this.historyPanelEl.style.display = this.historyVisible ? 'flex' : 'none';
    }
    if (this.historyVisible) {
      // Clear missed count when user opens history
      this.missedCount = 0;
      this.updateMissedBadge();
      // Mark all as read
      for (const entry of this.alertHistory) {
        entry.wasRead = true;
      }
      this.renderHistoryPanel();
    }
  }

  private renderHistoryPanel(): void {
    if (!this.historyPanelEl) return;
    const list = this.historyPanelEl.querySelector('.alert-history-list');
    if (!list) return;

    if (this.alertHistory.length === 0) {
      list.innerHTML = '<div class="alert-history-empty">No alerts yet</div>';
      return;
    }

    list.innerHTML = this.alertHistory.slice(0, 20).map((entry) => {
      const icon = entry.alert.threatLevel === 'critical' ? '🚨' : '⚠️';
      const timeStr = this.formatTimeAgo(new Date(entry.receivedAt));
      const unread = !entry.wasRead ? ' alert-history-unread' : '';
      return `
        <div class="alert-history-item${unread}">
          <span class="alert-history-icon">${icon}</span>
          <div class="alert-history-content">
            <span class="alert-history-headline">${this.escapeText(entry.alert.headline)}</span>
            <span class="alert-history-meta">${this.escapeText(entry.alert.source)} · ${timeStr}</span>
          </div>
        </div>
      `;
    }).join('');
  }

  private handleVisibility(): void {
    const now = Date.now();
    if (document.hidden) {
      for (const active of this.activeAlerts) {
        if (active.timer) {
          clearTimeout(active.timer);
          active.timer = null;
          const elapsed = now - active.timerStartedAt;
          active.remainingMs = Math.max(0, active.remainingMs - elapsed);
        }
      }
    } else {
      // Clear missed count when tab becomes visible
      if (this.missedCount > 0) {
        // Keep the badge visible so user notices, but don't auto-clear
      }

      const toShrink: string[] = [];
      for (const active of this.activeAlerts) {
        // Phase 3.2: Critical alerts never auto-dismiss/shrink
        if (active.alert.threatLevel === 'critical') continue;
        if (!active.timer && active.remainingMs > 0 && !active.shrunk) {
          active.timerStartedAt = now;
          active.timer = setTimeout(() => this.shrinkAlert(active.alert.id), active.remainingMs);
        } else if (active.remainingMs <= 0 && !active.shrunk) {
          toShrink.push(active.alert.id);
        }
      }
      for (const id of toShrink) this.shrinkAlert(id);
    }
  }

  public destroy(): void {
    document.removeEventListener('wm:breaking-news', this.boundOnAlert);
    document.removeEventListener('visibilitychange', this.boundOnVisibility);
    window.removeEventListener('resize', this.boundOnResize);
    this.mutationObserver?.disconnect();
    this.resizeObserver?.disconnect();

    for (const active of this.activeAlerts) {
      if (active.timer) clearTimeout(active.timer);
    }
    this.activeAlerts = [];
    this.alertHistory = [];
    this.container.remove();
    this.missedBadgeEl?.remove();
    this.historyPanelEl?.remove();
    document.body.classList.remove('has-breaking-alert');
    document.documentElement.style.removeProperty('--breaking-alert-offset');
  }
}
