/**
 * Unified Error Boundary System for World Monitor
 *
 * Provides structured error classification, panel-level error isolation,
 * and automatic recovery orchestration. Replaces the pattern of adding
 * ever-growing Sentry ignoreErrors lists with a proper classification
 * layer that routes errors to the right handler.
 *
 * Architecture:
 *   Raw Error → classify() → ErrorCategory → handler
 *     NetworkError     → silent retry (circuit breaker handles it)
 *     RenderError      → panel showError() + Sentry breadcrumb
 *     DataError        → showError() + data freshness badge
 *     WebGLError       → silent (maplibre/deck.gl internals)
 *     ThirdPartyError  → silent (YouTube, extensions, etc.)
 *     SecurityError    → log + Sentry
 *     UnknownError     → Sentry
 */

export type ErrorCategory =
  | 'network'
  | 'render'
  | 'data'
  | 'webgl'
  | 'third-party'
  | 'security'
  | 'abort'
  | 'unknown';

export interface ClassifiedError {
  category: ErrorCategory;
  original: unknown;
  message: string;
  /** Whether this error should be reported to Sentry */
  reportable: boolean;
  /** Whether this error should be shown to the user */
  userVisible: boolean;
  /** Whether the operation should be retried */
  retryable: boolean;
}

// ── Classification Rules ────────────────────────────────────────────

interface ClassificationRule {
  category: ErrorCategory;
  test: (error: unknown, message: string) => boolean;
  reportable: boolean;
  userVisible: boolean;
  retryable: boolean;
}

const RULES: ClassificationRule[] = [
  // Abort — never report, never show, never retry
  {
    category: 'abort',
    test: (error) =>
      error instanceof DOMException && error.name === 'AbortError'
      || (error instanceof Error && /abort/i.test(error.message)),
    reportable: false,
    userVisible: false,
    retryable: false,
  },

  // Network — silent, circuit breaker retries
  {
    category: 'network',
    test: (_error, msg) =>
      /^(Load failed|Failed to fetch|NetworkError|ERR_CONNECTION|ECONNREFUSED|ENOTFOUND|ETIMEDOUT|net::ERR_|TypeError: cancelled|NS_ERROR_NET)/i.test(msg)
      || /^(429|502|503|504|fetch.*fail|network.*error|connection.*reset)/i.test(msg),
    reportable: false,
    userVisible: false,
    retryable: true,
  },

  // WebGL — silent, maplibre/deck.gl internals
  {
    category: 'webgl',
    test: (_error, msg) =>
      /WebGL|imageManager|getProjection|Style is not done loading|_layers.*null|shader|FRAMEBUFFER|rendering context/i.test(msg),
    reportable: false,
    userVisible: false,
    retryable: false,
  },

  // Third-party — YouTube, browser extensions, vendor libraries
  {
    category: 'third-party',
    test: (error, msg) => {
      // YouTube IFrame API
      if (/yt-player|playVideo|pauseVideo|loadVideoById|postMessage.*youtube/i.test(msg)) return true;
      // Browser extensions
      if (/webkit\.messageHandlers|java.*gone|chrome-extension|moz-extension/i.test(msg)) return true;
      // Vendor CDN
      if (error instanceof Error && error.stack && /cdnjs\.cloudflare|unpkg\.com|cdn\.jsdelivr/i.test(error.stack)) return true;
      // ResizeObserver (browser limitation, not a bug)
      if (/ResizeObserver loop/i.test(msg)) return true;
      // Autoplay policy
      if (/NotAllowedError|play\(\) request was interrupted/i.test(msg)) return true;
      return false;
    },
    reportable: false,
    userVisible: false,
    retryable: false,
  },

  // Security — always report
  {
    category: 'security',
    test: (_error, msg) =>
      /CSP|Content Security Policy|CORS|SecurityError|cross-origin|blocked.*frame/i.test(msg),
    reportable: true,
    userVisible: false,
    retryable: false,
  },

  // Data — malformed responses, JSON parse errors, schema violations
  {
    category: 'data',
    test: (_error, msg) =>
      /JSON\.parse|Unexpected token|Invalid JSON|SyntaxError.*JSON|malformed|schema|missing required/i.test(msg),
    reportable: true,
    userVisible: true,
    retryable: true,
  },

  // Render — DOM manipulation errors
  {
    category: 'render',
    test: (_error, msg) =>
      /DOM|innerHTML|querySelector|isConnected|removeChild|insertBefore|NotFoundError|stale.*ref/i.test(msg)
      || /Cannot read.*null.*get(Element|Attribute|Bounding)/i.test(msg),
    reportable: true,
    userVisible: true,
    retryable: true,
  },
];

// ── Classifier ──────────────────────────────────────────────────────

export function classifyError(error: unknown): ClassifiedError {
  const message = extractMessage(error);

  for (const rule of RULES) {
    if (rule.test(error, message)) {
      return {
        category: rule.category,
        original: error,
        message,
        reportable: rule.reportable,
        userVisible: rule.userVisible,
        retryable: rule.retryable,
      };
    }
  }

  return {
    category: 'unknown',
    original: error,
    message,
    reportable: true,
    userVisible: true,
    retryable: false,
  };
}

function extractMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  try { return String(error); } catch { return 'Unknown error'; }
}

// ── Panel Error Boundary ────────────────────────────────────────────

export interface PanelErrorBoundaryOptions {
  /** Maximum consecutive errors before disabling the panel's refresh */
  maxConsecutiveErrors?: number;
  /** Callback to display error in the panel UI */
  onShowError?: (message: string, retryable: boolean) => void;
  /** Callback to clear error state */
  onClearError?: () => void;
  /** Optional Sentry-like captureException function */
  captureException?: (error: unknown, context?: Record<string, unknown>) => void;
  /** Panel name for logging context */
  panelName?: string;
}

/**
 * Wraps an async panel operation with error classification and recovery.
 *
 * Usage in a panel:
 * ```ts
 * const boundary = createPanelErrorBoundary({
 *   panelName: 'MarketQuotes',
 *   onShowError: (msg, retry) => this.showError(msg),
 *   onClearError: () => {},
 *   maxConsecutiveErrors: 3,
 * });
 *
 * // In refresh handler:
 * await boundary.execute(async () => {
 *   const data = await fetchMarketData(this.signal);
 *   this.renderQuotes(data);
 * });
 * ```
 */
export function createPanelErrorBoundary(options: PanelErrorBoundaryOptions = {}) {
  const maxErrors = options.maxConsecutiveErrors ?? 3;
  let consecutiveErrors = 0;
  let disabled = false;

  return {
    /** Execute an async operation with error boundary protection */
    async execute<T>(fn: () => Promise<T>): Promise<T | undefined> {
      if (disabled) return undefined;

      try {
        const result = await fn();
        // Success resets the error counter
        if (consecutiveErrors > 0) {
          consecutiveErrors = 0;
          options.onClearError?.();
        }
        return result;
      } catch (error) {
        const classified = classifyError(error);

        // Abort errors are expected lifecycle events — ignore completely
        if (classified.category === 'abort') return undefined;

        consecutiveErrors += 1;

        // Report to Sentry if appropriate
        if (classified.reportable && options.captureException) {
          options.captureException(classified.original, {
            category: classified.category,
            panelName: options.panelName,
            consecutiveErrors,
          });
        }

        // Show error to user if appropriate
        if (classified.userVisible && options.onShowError) {
          options.onShowError(classified.message, classified.retryable);
        }

        // Disable panel refresh after too many consecutive failures
        if (consecutiveErrors >= maxErrors) {
          disabled = true;
          if (options.onShowError) {
            options.onShowError(
              `Panel suspended after ${maxErrors} consecutive errors. Click retry to resume.`,
              true,
            );
          }
        }

        return undefined;
      }
    },

    /** Reset the error counter and re-enable the panel */
    reset() {
      consecutiveErrors = 0;
      disabled = false;
      options.onClearError?.();
    },

    /** Whether the panel is currently disabled due to errors */
    get isDisabled() {
      return disabled;
    },

    /** Current consecutive error count */
    get errorCount() {
      return consecutiveErrors;
    },
  };
}

// ── Async Lifecycle Guard ───────────────────────────────────────────

/**
 * Creates a reusable guard for async panel operations.
 * Replaces the repetitive `if (signal.aborted || !this.element?.isConnected) return;`
 * pattern after every await.
 *
 * Usage:
 * ```ts
 * const guard = createAsyncGuard(this.signal, this.element);
 *
 * const data = await fetchData();
 * if (guard.isStale()) return;  // element disconnected or signal aborted
 *
 * this.renderData(data);
 * ```
 */
export function createAsyncGuard(
  signal: AbortSignal,
  element?: Element | null,
) {
  return {
    /** Returns true if the operation should be abandoned */
    isStale(): boolean {
      return signal.aborted || (element != null && !element.isConnected);
    },

    /** Throws AbortError if stale — useful for chaining */
    assertFresh(): void {
      if (signal.aborted) {
        throw new DOMException('Operation aborted', 'AbortError');
      }
      if (element != null && !element.isConnected) {
        throw new DOMException('Element disconnected', 'AbortError');
      }
    },

    /** The underlying signal for passing to fetch() etc. */
    signal,
  };
}

// ── Global Error Stats ──────────────────────────────────────────────

interface ErrorStats {
  counts: Record<ErrorCategory, number>;
  lastError: ClassifiedError | null;
  lastErrorAt: number;
}

const stats: ErrorStats = {
  counts: {
    network: 0,
    render: 0,
    data: 0,
    webgl: 0,
    'third-party': 0,
    security: 0,
    abort: 0,
    unknown: 0,
  },
  lastError: null,
  lastErrorAt: 0,
};

/** Record a classified error in global stats */
export function recordError(classified: ClassifiedError): void {
  stats.counts[classified.category] += 1;
  if (classified.category !== 'abort') {
    stats.lastError = classified;
    stats.lastErrorAt = Date.now();
  }
}

/** Get current error statistics (for diagnostics / settings panel) */
export function getErrorStats(): Readonly<ErrorStats> {
  return { ...stats, counts: { ...stats.counts } };
}

/** Reset all error statistics */
export function resetErrorStats(): void {
  for (const key of Object.keys(stats.counts) as ErrorCategory[]) {
    stats.counts[key] = 0;
  }
  stats.lastError = null;
  stats.lastErrorAt = 0;
}
