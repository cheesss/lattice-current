import { getApiBaseUrl } from './runtime';

export interface RuntimeIngestArticleInput {
  title: string;
  source: string;
  url?: string;
  publishedAt: string;
  theme?: string;
}

export interface RuntimeMarketSignalInput {
  symbol: string;
  price: number;
  timestamp?: string;
}

export interface RuntimeGdeltStressInput {
  goldstein: number;
  tone: number;
  eventCount: number;
  date?: string;
}

function getLocalAnalysisEngineUrl(): string {
  return `${getApiBaseUrl()}/api/local-analysis-engine`;
}

async function postLocalAnalysisAction(action: string, payload: unknown): Promise<boolean> {
  if (typeof window === 'undefined' || typeof fetch !== 'function') {
    return false;
  }
  try {
    const response = await fetch(getLocalAnalysisEngineUrl(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, payload }),
      signal: AbortSignal.timeout(3_000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

export async function ingestArticleBatch(articles: RuntimeIngestArticleInput[]): Promise<boolean> {
  if (!Array.isArray(articles) || articles.length === 0) return false;
  return postLocalAnalysisAction('ingest-articles', { articles });
}

export async function pushMarketSignalsBatch(signals: RuntimeMarketSignalInput[]): Promise<boolean> {
  if (!Array.isArray(signals) || signals.length === 0) return false;
  return postLocalAnalysisAction('push-market-signals', { signals });
}

export async function pushGdeltStressBatch(signals: RuntimeGdeltStressInput[]): Promise<boolean> {
  if (!Array.isArray(signals) || signals.length === 0) return false;
  return postLocalAnalysisAction('push-gdelt-stress', { signals });
}
