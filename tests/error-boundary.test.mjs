import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  classifyError,
  createPanelErrorBoundary,
  createAsyncGuard,
  recordError,
  getErrorStats,
  resetErrorStats,
} from '../src/utils/error-boundary.ts';

// ── classifyError ───────────────────────────────────────────────────

describe('classifyError', () => {
  it('classifies AbortError as abort', () => {
    const err = new DOMException('signal is aborted', 'AbortError');
    const classified = classifyError(err);
    assert.equal(classified.category, 'abort');
    assert.equal(classified.reportable, false);
    assert.equal(classified.userVisible, false);
    assert.equal(classified.retryable, false);
  });

  it('classifies network errors', () => {
    for (const msg of ['Failed to fetch', 'Load failed', 'NetworkError when attempting', 'net::ERR_CONNECTION_REFUSED']) {
      const classified = classifyError(new TypeError(msg));
      assert.equal(classified.category, 'network', `Expected network for: ${msg}`);
      assert.equal(classified.reportable, false);
      assert.equal(classified.retryable, true);
    }
  });

  it('classifies HTTP status codes as network', () => {
    const classified = classifyError(new Error('429 Too Many Requests'));
    assert.equal(classified.category, 'network');
  });

  it('classifies WebGL errors', () => {
    for (const msg of ['Invalid WebGL2RenderingContext', 'getProjection() is null', 'Style is not done loading', 'shader compilation failed']) {
      const classified = classifyError(new Error(msg));
      assert.equal(classified.category, 'webgl', `Expected webgl for: ${msg}`);
      assert.equal(classified.reportable, false);
    }
  });

  it('classifies third-party errors', () => {
    for (const msg of ['ResizeObserver loop completed', 'NotAllowedError: play() request was interrupted', 'yt-player is not defined']) {
      const classified = classifyError(new Error(msg));
      assert.equal(classified.category, 'third-party', `Expected third-party for: ${msg}`);
    }
  });

  it('classifies security errors', () => {
    const classified = classifyError(new Error('Refused to load script because Content Security Policy'));
    assert.equal(classified.category, 'security');
    assert.equal(classified.reportable, true);
  });

  it('classifies data errors', () => {
    const classified = classifyError(new SyntaxError('Unexpected token < in JSON at position 0'));
    assert.equal(classified.category, 'data');
    assert.equal(classified.reportable, true);
    assert.equal(classified.retryable, true);
  });

  it('classifies render errors', () => {
    const classified = classifyError(new Error("Cannot read properties of null (reading 'getBoundingClientRect')"));
    assert.equal(classified.category, 'render');
    assert.equal(classified.userVisible, true);
  });

  it('classifies unknown errors as unknown', () => {
    const classified = classifyError(new Error('Something completely unexpected happened'));
    assert.equal(classified.category, 'unknown');
    assert.equal(classified.reportable, true);
  });

  it('handles non-Error inputs', () => {
    assert.equal(classifyError('string error').message, 'string error');
    assert.equal(classifyError(42).message, '42');
    assert.equal(classifyError(null).message, 'null');
    assert.equal(classifyError(undefined).message, 'undefined');
  });
});

// ── PanelErrorBoundary ──────────────────────────────────────────────

describe('PanelErrorBoundary', () => {
  it('returns result on success', async () => {
    const boundary = createPanelErrorBoundary();
    const result = await boundary.execute(async () => 42);
    assert.equal(result, 42);
    assert.equal(boundary.errorCount, 0);
  });

  it('resets error count on success after failure', async () => {
    const boundary = createPanelErrorBoundary();
    await boundary.execute(async () => { throw new Error('data error: JSON.parse failed'); });
    assert.equal(boundary.errorCount, 1);

    await boundary.execute(async () => 'ok');
    assert.equal(boundary.errorCount, 0);
  });

  it('ignores abort errors silently', async () => {
    let showErrorCalled = false;
    const boundary = createPanelErrorBoundary({
      onShowError: () => { showErrorCalled = true; },
    });

    await boundary.execute(async () => {
      throw new DOMException('aborted', 'AbortError');
    });

    assert.equal(showErrorCalled, false, 'showError should not be called for abort');
    assert.equal(boundary.errorCount, 0, 'Abort should not increment error count');
  });

  it('disables after maxConsecutiveErrors', async () => {
    const errors = [];
    const boundary = createPanelErrorBoundary({
      maxConsecutiveErrors: 2,
      onShowError: (msg) => errors.push(msg),
    });

    await boundary.execute(async () => { throw new Error('DOM stale ref error'); });
    assert.equal(boundary.isDisabled, false);

    await boundary.execute(async () => { throw new Error('DOM insertBefore error'); });
    assert.equal(boundary.isDisabled, true);
    assert.ok(errors[errors.length - 1].includes('suspended'));

    // Subsequent calls are no-ops
    const result = await boundary.execute(async () => 'should not run');
    assert.equal(result, undefined);
  });

  it('reset re-enables after disable', async () => {
    const boundary = createPanelErrorBoundary({ maxConsecutiveErrors: 1 });
    await boundary.execute(async () => { throw new Error('render DOM error'); });
    assert.equal(boundary.isDisabled, true);

    boundary.reset();
    assert.equal(boundary.isDisabled, false);
    assert.equal(boundary.errorCount, 0);

    const result = await boundary.execute(async () => 'recovered');
    assert.equal(result, 'recovered');
  });

  it('calls captureException for reportable errors', async () => {
    let captured = null;
    const boundary = createPanelErrorBoundary({
      captureException: (err, ctx) => { captured = { err, ctx }; },
      panelName: 'TestPanel',
    });

    const err = new SyntaxError('Unexpected token in JSON');
    await boundary.execute(async () => { throw err; });
    assert.ok(captured, 'captureException should be called');
    assert.equal(captured.ctx.panelName, 'TestPanel');
    assert.equal(captured.ctx.category, 'data');
  });

  it('does NOT call captureException for network errors', async () => {
    let captured = false;
    const boundary = createPanelErrorBoundary({
      captureException: () => { captured = true; },
    });

    await boundary.execute(async () => { throw new TypeError('Failed to fetch'); });
    assert.equal(captured, false, 'Network errors should not be reported to Sentry');
  });
});

// ── AsyncGuard ──────────────────────────────────────────────────────

describe('AsyncGuard', () => {
  it('isStale returns false for fresh signal', () => {
    const ac = new AbortController();
    const guard = createAsyncGuard(ac.signal);
    assert.equal(guard.isStale(), false);
  });

  it('isStale returns true after abort', () => {
    const ac = new AbortController();
    const guard = createAsyncGuard(ac.signal);
    ac.abort();
    assert.equal(guard.isStale(), true);
  });

  it('assertFresh throws AbortError on aborted signal', () => {
    const ac = new AbortController();
    const guard = createAsyncGuard(ac.signal);
    ac.abort();
    assert.throws(() => guard.assertFresh(), { name: 'AbortError' });
  });

  it('passes signal through for fetch usage', () => {
    const ac = new AbortController();
    const guard = createAsyncGuard(ac.signal);
    assert.equal(guard.signal, ac.signal);
  });
});

// ── Global Error Stats ──────────────────────────────────────────────

describe('Error Stats', () => {
  it('tracks error counts by category', () => {
    resetErrorStats();
    recordError(classifyError(new TypeError('Failed to fetch')));
    recordError(classifyError(new TypeError('Failed to fetch again')));
    recordError(classifyError(new SyntaxError('Unexpected token in JSON')));
    recordError(classifyError(new DOMException('aborted', 'AbortError')));

    const stats = getErrorStats();
    assert.equal(stats.counts.network, 2);
    assert.equal(stats.counts.data, 1);
    assert.equal(stats.counts.abort, 1);
    assert.ok(stats.lastError, 'Should have a last error');
    assert.notEqual(stats.lastError.category, 'abort', 'Abort should not be last error');
  });

  it('resetErrorStats clears everything', () => {
    resetErrorStats();
    const stats = getErrorStats();
    assert.equal(stats.counts.network, 0);
    assert.equal(stats.lastError, null);
  });
});
