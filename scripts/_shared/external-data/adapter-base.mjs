/*
 * External data adapter — common base.
 *
 * Goal: every provider (SEC EDGAR / FRED / EIA / World Bank / OpenAlex /
 * Lens / Quartr / FMP / Polygon) exports the same shape so the orchestrator
 * can iterate them uniformly.
 *
 * Provider interface:
 *
 *   export const provider = {
 *     name: 'sec-edgar',
 *     displayName: 'SEC EDGAR',
 *     keyEnvVar: null,                 // null when no key required
 *     signupUrl: 'https://...',        // where to acquire a key
 *     subjectKinds: ['symbol','theme'],// which subject types it handles
 *     pricing: 'free' | 'free-with-key' | 'paid',
 *     monthlyCost: 0 | 19 | 99 | ...,  // approximate USD if paid
 *     dataKinds: ['filings','transcripts','fundamentals','macro',...],
 *   };
 *
 *   export function isAvailable() — returns true if env key present (or
 *                                   no key required). Adapters that fail
 *                                   the env check return false here.
 *
 *   export async function loadFor(subject, opts = {})
 *                       — returns { ok, pack, errors } where pack is the
 *                         normalized data (provider-specific shape) and
 *                         errors is non-fatal warnings.
 *
 * The orchestrator does NOT call providers that return false from
 * isAvailable(); it logs them as 'skipped' so the pack manifest can list
 * what could have been included if the key were configured.
 *
 * Network policy:
 *   - All adapters must respect rate limits (built-in delay between calls
 *     when iterating multiple endpoints).
 *   - All adapters must time out (default 12s per call).
 *   - All adapters must catch errors and return { ok: false, errors }
 *     rather than throwing — the orchestrator should never crash because
 *     one provider is down.
 */

export const SUBJECT_KINDS = Object.freeze({
  THEME: 'theme',
  SYMBOL: 'symbol',
  EVENT: 'event',
  CROSS_THEME: 'cross_theme',
});

const DEFAULT_TIMEOUT_MS = 12_000;

/*
 * Lightweight fetch wrapper with timeout, JSON parsing, and standardized
 * error shape. Used by every adapter so error handling is consistent.
 */
export async function safeFetchJson(url, { headers = {}, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: {
        'Accept': 'application/json',
        'User-Agent': process.env.LATTICE_HTTP_USER_AGENT || 'Lattice-Intelligence-Reports/0.1 (research; contact via repo)',
        ...headers,
      },
      signal: controller.signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      const retryAfter = res.headers?.get?.('retry-after') || null;
      const retryAfterSec = retryAfter && /^\d+$/.test(retryAfter) ? Number(retryAfter) : null;
      return {
        ok: false,
        status: res.status,
        error: `HTTP ${res.status}`,
        body: text.slice(0, 400),
        rateLimited: res.status === 429,
        retryable: res.status === 429 || res.status >= 500,
        retryAfterSec,
      };
    }
    const json = await res.json().catch((e) => ({ __parseError: e.message }));
    if (json && json.__parseError) {
      return { ok: false, status: res.status, error: 'json_parse_failed', body: json.__parseError };
    }
    return { ok: true, status: res.status, json };
  } catch (e) {
    const isTimeout = e.name === 'AbortError';
    return {
      ok: false,
      status: 0,
      error: isTimeout ? 'timeout' : (e.message || String(e)),
      retryable: isTimeout,
      rateLimited: false,
    };
  } finally {
    clearTimeout(timer);
  }
}

/*
 * Shared helper for fetching multiple URLs with sequential pacing
 * (rate-limit polite for free APIs).
 */
export async function safeFetchJsonSequential(urls, opts = {}, paceMs = 250) {
  const results = [];
  for (const url of urls) {
    const r = await safeFetchJson(url, opts);
    results.push({ url, ...r });
    if (paceMs > 0 && urls.indexOf(url) < urls.length - 1) {
      await new Promise((resolve) => setTimeout(resolve, paceMs));
    }
  }
  return results;
}

/*
 * Build a "skipped" provider record for the manifest.
 */
export function buildSkippedProviderRecord(provider, reason) {
  return {
    provider: provider.name,
    available: false,
    skipped: true,
    reason,
    requiresKey: provider.keyEnvVar,
    signupUrl: provider.signupUrl,
    pricing: provider.pricing,
    monthlyCost: provider.monthlyCost,
  };
}

/*
 * Resolve env key for an adapter. Falls back to .env.local being already
 * loaded into process.env (NAS pipeline does this via export pattern).
 */
export function resolveEnvKey(envVarName) {
  if (!envVarName) return null;
  const value = process.env[envVarName];
  return value && String(value).trim() ? String(value).trim() : null;
}
