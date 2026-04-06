/**
 * Mobile Bottom Sheet — Phase 3.5
 *
 * A draggable bottom sheet for mobile that shows panels below the map.
 * Supports three snap points: peek (header only), half, and full.
 * Includes swipe-left/right navigation between panels.
 */



export type SheetSnapPoint = 'peek' | 'half' | 'full';

const PEEK_HEIGHT = 64;   // px — just the drag handle + title
const HALF_RATIO = 0.45;  // 45% of viewport
const FULL_RATIO = 0.88;  // 88% of viewport
const SWIPE_THRESHOLD = 50; // px minimum swipe distance
const VELOCITY_THRESHOLD = 0.5; // px/ms for fast swipes

export interface MobileBottomSheetOptions {
  panelKeys: string[];
  panelNames: Record<string, string>;
  onPanelChange?: (key: string) => void;
}

export class MobileBottomSheet {
  private container: HTMLElement;
  private handle: HTMLElement;
  private contentArea: HTMLElement;
  private tabStrip: HTMLElement;
  private currentSnap: SheetSnapPoint = 'half';
  private currentPanelIndex = 0;
  private options: MobileBottomSheetOptions;

  // Drag state
  private isDragging = false;
  private dragStartY = 0;
  private dragStartHeight = 0;

  // Swipe state
  private swipeStartX = 0;
  private swipeStartY = 0;
  private swipeStartTime = 0;

  constructor(parent: HTMLElement, options: MobileBottomSheetOptions) {
    this.options = options;

    this.container = document.createElement('div');
    this.container.className = 'mobile-bottom-sheet';

    // Drag handle
    this.handle = document.createElement('div');
    this.handle.className = 'bottom-sheet-handle';
    this.handle.innerHTML = '<div class="bottom-sheet-handle-bar"></div>';

    // Tab strip for panel navigation
    this.tabStrip = document.createElement('div');
    this.tabStrip.className = 'bottom-sheet-tabs';
    this.renderTabs();

    // Content area
    this.contentArea = document.createElement('div');
    this.contentArea.className = 'bottom-sheet-content';
    this.contentArea.id = 'mobileSheetContent';

    this.container.appendChild(this.handle);
    this.container.appendChild(this.tabStrip);
    this.container.appendChild(this.contentArea);
    parent.appendChild(this.container);

    this.setupDragHandlers();
    this.setupSwipeHandlers();
    this.snap('half');
  }

  private renderTabs(): void {
    this.tabStrip.innerHTML = this.options.panelKeys.map((key, i) => {
      const name = this.options.panelNames[key] ?? key;
      const active = i === this.currentPanelIndex ? ' active' : '';
      return `<button class="bottom-sheet-tab${active}" data-tab-index="${i}" data-panel-key="${key}">${name}</button>`;
    }).join('');

    this.tabStrip.addEventListener('click', (e) => {
      const btn = (e.target as HTMLElement).closest<HTMLElement>('.bottom-sheet-tab');
      if (!btn) return;
      const idx = parseInt(btn.getAttribute('data-tab-index') ?? '0', 10);
      this.switchPanel(idx);
    });
  }

  private setupDragHandlers(): void {
    const onStart = (clientY: number) => {
      this.isDragging = true;
      this.dragStartY = clientY;
      this.dragStartHeight = this.container.getBoundingClientRect().height;
      this.container.classList.add('dragging');
    };

    const onMove = (clientY: number) => {
      if (!this.isDragging) return;
      const deltaY = this.dragStartY - clientY;
      const newHeight = Math.max(PEEK_HEIGHT, Math.min(window.innerHeight * FULL_RATIO, this.dragStartHeight + deltaY));
      this.container.style.height = `${newHeight}px`;
    };

    const onEnd = () => {
      if (!this.isDragging) return;
      this.isDragging = false;
      this.container.classList.remove('dragging');
      // Snap to nearest point
      const height = this.container.getBoundingClientRect().height;
      const vh = window.innerHeight;
      const peekDist = Math.abs(height - PEEK_HEIGHT);
      const halfDist = Math.abs(height - vh * HALF_RATIO);
      const fullDist = Math.abs(height - vh * FULL_RATIO);
      const min = Math.min(peekDist, halfDist, fullDist);
      if (min === peekDist) this.snap('peek');
      else if (min === fullDist) this.snap('full');
      else this.snap('half');
    };

    this.handle.addEventListener('touchstart', (e) => {
      const touch = e.touches[0];
      if (touch) onStart(touch.clientY);
    }, { passive: true });

    this.handle.addEventListener('touchmove', (e) => {
      const touch = e.touches[0];
      if (touch) onMove(touch.clientY);
    }, { passive: true });

    this.handle.addEventListener('touchend', () => onEnd(), { passive: true });

    // Mouse fallback for testing
    this.handle.addEventListener('mousedown', (e) => onStart(e.clientY));
    document.addEventListener('mousemove', (e) => onMove(e.clientY));
    document.addEventListener('mouseup', () => onEnd());
  }

  private setupSwipeHandlers(): void {
    this.contentArea.addEventListener('touchstart', (e) => {
      const touch = e.touches[0];
      if (!touch) return;
      this.swipeStartX = touch.clientX;
      this.swipeStartY = touch.clientY;
      this.swipeStartTime = Date.now();
    }, { passive: true });

    this.contentArea.addEventListener('touchend', (e) => {
      const touch = e.changedTouches[0];
      if (!touch) return;
      const deltaX = touch.clientX - this.swipeStartX;
      const deltaY = touch.clientY - this.swipeStartY;
      const elapsed = Date.now() - this.swipeStartTime;

      // Only count horizontal swipes (more X than Y movement)
      if (Math.abs(deltaX) < SWIPE_THRESHOLD || Math.abs(deltaX) < Math.abs(deltaY)) return;

      const velocity = Math.abs(deltaX) / Math.max(1, elapsed);
      if (velocity < VELOCITY_THRESHOLD && Math.abs(deltaX) < 100) return;

      if (deltaX < 0) {
        // Swipe left → next panel
        this.switchPanel(Math.min(this.currentPanelIndex + 1, this.options.panelKeys.length - 1));
      } else {
        // Swipe right → previous panel
        this.switchPanel(Math.max(this.currentPanelIndex - 1, 0));
      }
    }, { passive: true });
  }

  private switchPanel(index: number): void {
    if (index === this.currentPanelIndex) return;
    if (index < 0 || index >= this.options.panelKeys.length) return;
    this.currentPanelIndex = index;

    // Update tab active state
    const tabs = this.tabStrip.querySelectorAll('.bottom-sheet-tab');
    tabs.forEach((tab, i) => {
      tab.classList.toggle('active', i === index);
    });

    // Scroll active tab into view
    const activeTab = tabs[index] as HTMLElement | undefined;
    activeTab?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });

    const key = this.options.panelKeys[index]!;
    this.options.onPanelChange?.(key);
  }

  public snap(point: SheetSnapPoint): void {
    this.currentSnap = point;
    this.container.style.transition = 'height 0.3s cubic-bezier(0.25, 0.46, 0.45, 0.94)';
    switch (point) {
      case 'peek':
        this.container.style.height = `${PEEK_HEIGHT}px`;
        break;
      case 'half':
        this.container.style.height = `${window.innerHeight * HALF_RATIO}px`;
        break;
      case 'full':
        this.container.style.height = `${window.innerHeight * FULL_RATIO}px`;
        break;
    }
    // Remove transition after animation
    setTimeout(() => { this.container.style.transition = ''; }, 300);
  }

  public getContentElement(): HTMLElement {
    return this.contentArea;
  }

  public getCurrentSnap(): SheetSnapPoint {
    return this.currentSnap;
  }

  public getCurrentPanelKey(): string {
    return this.options.panelKeys[this.currentPanelIndex] ?? '';
  }

  public destroy(): void {
    this.container.remove();
  }
}
