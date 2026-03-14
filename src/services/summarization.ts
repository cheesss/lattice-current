/**
 * Summarization Service with Fallback Chain
 * Server-side Redis caching handles cross-user deduplication
 * Fallback: Ollama -> Groq -> OpenAI -> Codex Login -> OpenRouter -> Browser T5
 *
 * Uses NewsServiceClient.summarizeArticle() RPC instead of legacy
 * per-provider fetch endpoints.
 */

import { mlWorker } from './ml-worker';
import { SITE_VARIANT } from '@/config';
import { BETA_MODE } from '@/config/beta';
import { isFeatureAvailable, type RuntimeFeatureId } from './runtime-config';
import { trackLLMUsage, trackLLMFailure } from './analytics';
import { NewsServiceClient, type SummarizeArticleResponse } from '@/generated/client/worldmonitor/news/v1/service_client';
import { createCircuitBreaker } from '@/utils';
import { isDesktopRuntime } from './runtime';

export type SummarizationProvider = 'ollama' | 'groq' | 'openai' | 'codex' | 'openrouter' | 'browser' | 'cache' | 'fallback';
export type SummarizationMode = 'brief' | 'analysis' | 'deep';

export interface SummarizationResult {
  summary: string;
  provider: SummarizationProvider;
  model: string;
  cached: boolean;
}

export type ProgressCallback = (step: number, total: number, message: string) => void;

export interface SummarizeOptions {
  skipCloudProviders?: boolean;  // true = skip Ollama/Groq/OpenAI/Codex/OpenRouter, go straight to browser T5
  skipBrowserFallback?: boolean; // true = skip browser T5 fallback
  mode?: SummarizationMode;
}

// ?? Sebuf client (replaces direct fetch to /api/{provider}-summarize) ??

const newsClient = new NewsServiceClient('', { fetch: (...args) => globalThis.fetch(...args) });
const summaryBreaker = createCircuitBreaker<SummarizeArticleResponse>({ name: 'News Summarization', cacheTtlMs: 0 });

const emptySummaryFallback: SummarizeArticleResponse = {
  summary: '',
  provider: '',
  model: '',
  fallback: true,
  tokens: 0,
  error: '',
  errorType: '',
  status: 'SUMMARIZE_STATUS_ERROR',
  statusDetail: '',
};

function isSkippedResponse(resp: SummarizeArticleResponse): boolean {
  return resp.status === 'SUMMARIZE_STATUS_SKIPPED';
}

function isCachedResponse(resp: SummarizeArticleResponse): boolean {
  return resp.status === 'SUMMARIZE_STATUS_CACHED';
}

// ?? Provider definitions ??

interface ApiProviderDef {
  featureId: RuntimeFeatureId;
  provider: SummarizationProvider;
  label: string;
}

const API_PROVIDERS: ApiProviderDef[] = [
  { featureId: 'aiOllama',      provider: 'ollama',     label: 'Ollama' },
  { featureId: 'aiGroq',        provider: 'groq',       label: 'Groq AI' },
  { featureId: 'aiOpenAI',      provider: 'openai',     label: 'OpenAI' },
  { featureId: 'aiCodexLogin',  provider: 'codex',      label: 'Codex Login' },
  { featureId: 'aiOpenRouter',  provider: 'openrouter', label: 'OpenRouter' },
];

let lastAttemptedProvider = 'none';
const LOCAL_CODEX_TIMEOUT_MS = 18_000;
const LOCAL_CODEX_STATUS_TTL_MS = 15_000;
const LOCAL_CODEX_BACKOFF_MS = 60_000;
const SUMMARY_LOG_THROTTLE_MS = 60_000;

let localCodexStatusCache:
  | { checkedAt: number; available: boolean; loggedIn: boolean }
  | null = null;
let localCodexBackoffUntil = 0;
const summaryLogTimestamps = new Map<string, number>();

function shouldEmitSummaryLog(key: string, ttlMs = SUMMARY_LOG_THROTTLE_MS): boolean {
  const now = Date.now();
  const previous = summaryLogTimestamps.get(key) || 0;
  if (now - previous < ttlMs) return false;
  summaryLogTimestamps.set(key, now);
  return true;
}

function canUseLocalCodexApi(): boolean {
  return isDesktopRuntime() || import.meta.env.DEV;
}

interface LocalCodexSummaryResponse {
  summary?: string;
  model?: string;
}

interface LocalCodexStatusResponse {
  available?: boolean;
  loggedIn?: boolean;
}

async function getLocalCodexStatus(): Promise<{ available: boolean; loggedIn: boolean }> {
  const now = Date.now();
  if (localCodexStatusCache && now - localCodexStatusCache.checkedAt < LOCAL_CODEX_STATUS_TTL_MS) {
    return {
      available: localCodexStatusCache.available,
      loggedIn: localCodexStatusCache.loggedIn,
    };
  }

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 1_500);
    const response = await fetch('/api/local-codex-status', {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    }).finally(() => clearTimeout(timer));
    if (!response.ok) {
      localCodexStatusCache = { checkedAt: now, available: false, loggedIn: false };
      return { available: false, loggedIn: false };
    }
    const payload = await response.json() as LocalCodexStatusResponse;
    const status = {
      available: payload.available === true,
      loggedIn: payload.loggedIn === true,
    };
    localCodexStatusCache = { checkedAt: now, ...status };
    return status;
  } catch {
    localCodexStatusCache = { checkedAt: now, available: false, loggedIn: false };
    return { available: false, loggedIn: false };
  }
}

async function tryCodexProvider(
  headlines: string[],
  mode: 'brief' | 'analysis' | 'deep' | 'translate',
  geoContext: string,
  variant: string,
  lang: string,
): Promise<SummarizationResult | null> {
  if (!canUseLocalCodexApi()) return null;
  if (Date.now() < localCodexBackoffUntil) return null;

  const status = await getLocalCodexStatus();
  if (!status.available || !status.loggedIn) return null;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), LOCAL_CODEX_TIMEOUT_MS);
    const response = await fetch('/api/local-codex-summarize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        headlines,
        mode,
        geoContext,
        variant,
        lang,
      }),
    }).finally(() => clearTimeout(timer));
    if (!response.ok) return null;

    const payload = await response.json() as LocalCodexSummaryResponse;
    const summary = typeof payload.summary === 'string' ? payload.summary.trim() : '';
    if (!summary) return null;

    const model = typeof payload.model === 'string' && payload.model.trim() ? payload.model.trim() : 'codex-cli';
    console.log('[Summarization] Codex Login success:', model);
    return {
      summary,
      provider: 'codex',
      model,
      cached: false,
    };
  } catch (error) {
    localCodexBackoffUntil = Date.now() + LOCAL_CODEX_BACKOFF_MS;
    const name = error instanceof Error ? error.name : '';
    if (name === 'AbortError') {
      console.info('[Summarization] Codex Login timed out; backing off for 60s');
      return null;
    }
    console.warn('[Summarization] Codex Login failed:', error);
    return null;
  }
}

// ?? Unified API provider caller (via SummarizeArticle RPC) ??

async function tryApiProvider(
  providerDef: ApiProviderDef,
  headlines: string[],
  mode: SummarizationMode = 'brief',
  geoContext?: string,
  lang?: string,
): Promise<SummarizationResult | null> {
  if (!isFeatureAvailable(providerDef.featureId)) return null;
  lastAttemptedProvider = providerDef.provider;

  if (providerDef.provider === 'codex') {
    return tryCodexProvider(headlines, mode, geoContext || '', SITE_VARIANT, lang || 'en');
  }

  try {
    const resp: SummarizeArticleResponse = await summaryBreaker.execute(async () => {
      return newsClient.summarizeArticle({
        provider: providerDef.provider,
        headlines,
        mode,
        geoContext: geoContext || '',
        variant: SITE_VARIANT,
        lang: lang || 'en',
      });
    }, emptySummaryFallback);

    // Provider skipped (credentials missing) or signaled fallback
    if (isSkippedResponse(resp) || resp.fallback) return null;

    const summary = typeof resp.summary === 'string' ? resp.summary.trim() : '';
    if (!summary) return null;

    const cached = isCachedResponse(resp);
    const resultProvider = cached ? 'cache' : providerDef.provider;
    console.log(`[Summarization] ${cached ? 'Redis cache hit' : `${providerDef.label} success`}:`, resp.model);
    return {
      summary,
      provider: resultProvider as SummarizationProvider,
      model: resp.model || providerDef.provider,
      cached,
    };
  } catch (error) {
    console.warn(`[Summarization] ${providerDef.label} failed:`, error);
    return null;
  }
}

// ?? Browser T5 provider (different interface -- no API call) ??

async function tryBrowserT5(
  headlines: string[],
  modelId?: string,
  mode: SummarizationMode = 'brief',
  geoContext = '',
): Promise<SummarizationResult | null> {
  try {
    if (!mlWorker.isAvailable) {
      if (shouldEmitSummaryLog('browser-ml-unavailable')) {
        console.log('[Summarization] Browser ML not available');
      }
      return null;
    }
    lastAttemptedProvider = 'browser';

    const headlineLimit = mode === 'deep' ? 20 : 5;
    const truncLen = mode === 'deep' ? 140 : 80;
    const combinedText = headlines.slice(0, headlineLimit).map(h => h.slice(0, truncLen)).join('. ');
    const prompt = mode === 'deep'
      ? [
          'Synthesize all items into a dense intelligence report.',
          'Format exactly with these sections:',
          'Executive Brief:',
          '- bullet 1',
          '- bullet 2',
          '- bullet 3',
          'Critical Drivers:',
          '- bullet 1',
          '- bullet 2',
          '- bullet 3',
          'Scenarios:',
          '- 24h: ... (probability %)',
          '- 7d: ... (probability %)',
          '- 30d: ... (probability %)',
          'Watchlist:',
          '- entities/locations/assets to monitor next',
          geoContext ? `Context: ${geoContext.slice(0, 1200)}` : '',
          `Input headlines: ${combinedText}`,
        ].filter(Boolean).join('\n')
      : `Summarize the most important headline in 2 concise sentences (under 60 words): ${combinedText}`;

    const [summary] = await mlWorker.summarize([prompt], modelId);

    if (!summary || summary.length < 20 || summary.toLowerCase().includes('summarize')) {
      return null;
    }

    console.log('[Summarization] Browser T5 success');
    return {
      summary,
      provider: 'browser',
      model: modelId || 't5-small',
      cached: false,
    };
  } catch (error) {
    console.warn('[Summarization] Browser T5 failed:', error);
    return null;
  }
}

// ?? Fallback chain runner ??

async function runApiChain(
  providers: ApiProviderDef[],
  headlines: string[],
  mode: SummarizationMode,
  geoContext: string | undefined,
  lang: string | undefined,
  onProgress: ProgressCallback | undefined,
  stepOffset: number,
  totalSteps: number,
): Promise<SummarizationResult | null> {
  for (const [i, provider] of providers.entries()) {
    onProgress?.(stepOffset + i, totalSteps, `Connecting to ${provider.label}...`);
    const result = await tryApiProvider(provider, headlines, mode, geoContext, lang);
    if (result) return result;
  }
  return null;
}

/**
 * Generate a summary using the fallback chain: Ollama -> Groq -> OpenAI -> Codex Login -> OpenRouter -> Browser T5
 * Server-side Redis caching is handled by the SummarizeArticle RPC handler
 * @param geoContext Optional geographic signal context to include in the prompt
 */
export async function generateSummary(
  headlines: string[],
  onProgress?: ProgressCallback,
  geoContext?: string,
  lang: string = 'en',
  options?: SummarizeOptions,
): Promise<SummarizationResult | null> {
  if (!headlines || headlines.length < 2) {
    return null;
  }

  lastAttemptedProvider = 'none';
  const result = await generateSummaryInternal(headlines, onProgress, geoContext, lang, options);

  // Track at generateSummary return only (not inside tryApiProvider) to avoid
  // double-counting beta comparison traffic. Only the winning provider is recorded.
  if (result) {
    trackLLMUsage(result.provider, result.model, result.cached);
  } else {
    trackLLMFailure(lastAttemptedProvider);
  }

  return result;
}

async function generateSummaryInternal(
  headlines: string[],
  onProgress: ProgressCallback | undefined,
  geoContext: string | undefined,
  lang: string,
  options?: SummarizeOptions,
): Promise<SummarizationResult | null> {
  const mode = options?.mode ?? 'brief';

  if (BETA_MODE) {
    const modelReady = mlWorker.isAvailable && mlWorker.isModelLoaded('summarization-beta');

    if (modelReady) {
      const totalSteps = 1 + API_PROVIDERS.length;
      // Model already loaded -- use browser T5-small first
      if (!options?.skipBrowserFallback) {
        onProgress?.(1, totalSteps, 'Running local AI model (beta)...');
        const browserResult = await tryBrowserT5(headlines, 'summarization-beta', mode, geoContext || '');
        if (browserResult) {
          console.log('[BETA] Browser T5-small:', browserResult.summary);
          const groqProvider = API_PROVIDERS.find(p => p.provider === 'groq');
          if (groqProvider && !options?.skipCloudProviders) tryApiProvider(groqProvider, headlines, mode, geoContext, lang).then(r => {
            if (r) console.log('[BETA] Groq comparison:', r.summary);
          }).catch(() => {});

          return browserResult;
        }
      }

      // Warm model failed inference -- fallback through API providers
      if (!options?.skipCloudProviders) {
        const chainResult = await runApiChain(API_PROVIDERS, headlines, mode, geoContext, lang, onProgress, 2, totalSteps);
        if (chainResult) return chainResult;
      }
    } else {
      const totalSteps = API_PROVIDERS.length + 2;
      console.log('[BETA] T5-small not loaded yet, using cloud providers first');
      if (mlWorker.isAvailable && !options?.skipBrowserFallback) {
        mlWorker.loadModel('summarization-beta').catch(() => {});
      }

      // API providers while model loads
      if (!options?.skipCloudProviders) {
        const chainResult = await runApiChain(API_PROVIDERS, headlines, mode, geoContext, lang, onProgress, 1, totalSteps);
        if (chainResult) {
          if (chainResult.provider === 'groq') console.log('[BETA] Groq:', chainResult.summary);
          return chainResult;
        }
      }

      // Last resort: try browser T5 (may have finished loading by now)
      if (mlWorker.isAvailable && !options?.skipBrowserFallback) {
        onProgress?.(API_PROVIDERS.length + 1, totalSteps, 'Waiting for local AI model...');
        const browserResult = await tryBrowserT5(headlines, 'summarization-beta', mode, geoContext || '');
        if (browserResult) return browserResult;
      }

      onProgress?.(totalSteps, totalSteps, 'No providers available');
    }

    if (shouldEmitSummaryLog('beta-all-providers-failed')) {
      console.warn('[BETA] All providers failed');
    }
    return null;
  }

  // Normal mode: API chain -> Browser T5
  const totalSteps = API_PROVIDERS.length + 1;
  let chainResult: SummarizationResult | null = null;

  if (!options?.skipCloudProviders) {
    chainResult = await runApiChain(API_PROVIDERS, headlines, mode, geoContext, lang, onProgress, 1, totalSteps);
  }
  if (chainResult) return chainResult;

  if (!options?.skipBrowserFallback) {
    onProgress?.(totalSteps, totalSteps, 'Loading local AI model...');
    const browserResult = await tryBrowserT5(headlines, undefined, mode, geoContext || '');
    if (browserResult) return browserResult;
  }

  if (shouldEmitSummaryLog('all-providers-failed')) {
    console.warn('[Summarization] All providers failed');
  }
  return null;
}


/**
 * Translate text using the fallback chain (via SummarizeArticle RPC with mode='translate')
 * @param text Text to translate
 * @param targetLang Target language code (e.g., 'fr', 'es')
 */
export async function translateText(
  text: string,
  targetLang: string,
  onProgress?: ProgressCallback
): Promise<string | null> {
  if (!text) return null;

  const totalSteps = API_PROVIDERS.length;
  for (const [i, providerDef] of API_PROVIDERS.entries()) {
    if (!isFeatureAvailable(providerDef.featureId)) continue;

    onProgress?.(i + 1, totalSteps, `Translating with ${providerDef.label}...`);

    if (providerDef.provider === 'codex') {
      const codexResult = await tryCodexProvider([text], 'translate', '', targetLang, '');
      if (codexResult?.summary) return codexResult.summary;
      continue;
    }

    try {
      const resp = await summaryBreaker.execute(async () => {
        return newsClient.summarizeArticle({
          provider: providerDef.provider,
          headlines: [text],
          mode: 'translate',
          geoContext: '',
          variant: targetLang,
          lang: '',
        });
      }, emptySummaryFallback);

      if (resp.fallback || isSkippedResponse(resp)) continue;
      const summary = typeof resp.summary === 'string' ? resp.summary.trim() : '';
      if (summary) return summary;
    } catch (e) {
      console.warn(`${providerDef.label} translation failed`, e);
    }
  }

  return null;
}

