/**
 * Animation Manager — Phase 3.4
 *
 * Controls and limits concurrent CSS animations to reduce visual noise:
 * 1. Caps simultaneously active CSS animations (default: 5)
 * 2. Provides `prefers-reduced-motion` detection
 * 3. Manages animation priority queue
 *
 * This works by toggling a `.animation-paused` class on lower-priority
 * animated elements when the cap is exceeded.
 */

const MAX_CONCURRENT_ANIMATIONS = 5;
const SCAN_INTERVAL_MS = 2000;

/** Selectors for animated elements, ordered by priority (highest first) */
const ANIMATION_PRIORITY: readonly string[] = [
  '.breaking-alert',           // Breaking news — always animate
  '.severity-critical',        // Critical events
  '.panel-data-critical',      // Critical-data panels
  '.status-dot',               // Live status indicator
  '.terminal-tape-headline',   // Scrolling headline
  '.pulse',                    // Generic pulse badges
  '.live-blink',               // Live indicators
  '.hotspot-breaking',         // Map hotspot pulses
  '[class*="pulse-"]',         // Any pulse-* animation
  '.loading-dots',             // Loading indicators
];

let scanIntervalId: ReturnType<typeof setInterval> | null = null;
let reducedMotion = false;

/**
 * Check if the user prefers reduced motion.
 */
export function prefersReducedMotion(): boolean {
  return reducedMotion;
}

/**
 * Scan the DOM for animated elements and enforce the concurrent limit.
 * Lower-priority animations get paused when the cap is exceeded.
 */
function enforceAnimationLimit(): void {
  if (reducedMotion) return; // All animations already paused by CSS

  const allAnimated: HTMLElement[] = [];

  for (const selector of ANIMATION_PRIORITY) {
    try {
      const elements = document.querySelectorAll<HTMLElement>(selector);
      for (const el of elements) {
        // Only count elements that actually have an animation running
        const style = getComputedStyle(el);
        if (style.animationName && style.animationName !== 'none') {
          allAnimated.push(el);
        }
      }
    } catch {
      // Invalid selector, skip
    }
  }

  // Remove pause from all first
  for (const el of allAnimated) {
    el.classList.remove('animation-paused');
  }

  // If under limit, nothing to pause
  if (allAnimated.length <= MAX_CONCURRENT_ANIMATIONS) return;

  // Pause lowest-priority animations (last ones found)
  // The array is already in priority order due to ANIMATION_PRIORITY ordering
  const toPause = allAnimated.slice(MAX_CONCURRENT_ANIMATIONS);
  for (const el of toPause) {
    el.classList.add('animation-paused');
  }
}

/**
 * Initialize the animation manager.
 * - Detects reduced motion preference
 * - Starts periodic scan
 * Returns a cleanup function.
 */
export function initAnimationManager(): () => void {
  // Detect prefers-reduced-motion
  const mql = window.matchMedia?.('(prefers-reduced-motion: reduce)');
  reducedMotion = mql?.matches ?? false;

  const handleChange = (e: MediaQueryListEvent) => {
    reducedMotion = e.matches;
    document.documentElement.classList.toggle('reduced-motion', reducedMotion);
  };

  if (mql) {
    mql.addEventListener('change', handleChange);
    document.documentElement.classList.toggle('reduced-motion', reducedMotion);
  }

  // Start periodic scan
  scanIntervalId = setInterval(enforceAnimationLimit, SCAN_INTERVAL_MS);
  enforceAnimationLimit(); // initial

  return () => {
    if (scanIntervalId) clearInterval(scanIntervalId);
    scanIntervalId = null;
    mql?.removeEventListener('change', handleChange);
  };
}

/**
 * Force an immediate animation limit check.
 */
export function checkAnimationLimit(): void {
  enforceAnimationLimit();
}
