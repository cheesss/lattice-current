/**
 * AI Transparency Utilities
 *
 * Provides visual building blocks to show users:
 *  - Which AI model/provider produced a given judgment
 *  - Confidence level (band + numeric)
 *  - Whether the result came from cache, fallback, or a specific provider
 *
 * All functions return plain DOM elements (no framework dependency).
 */

import { h } from './dom-utils';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export type ConfidenceLevel = 'high' | 'building' | 'guarded' | 'low';

export interface AiJudgmentMeta {
  /** Which provider generated this output. */
  provider: string;
  /** Confidence band. */
  confidence: ConfidenceLevel;
  /** Numeric confidence 0–100 (optional, shown as tooltip). */
  confidenceScore?: number;
  /** Human-readable model name, e.g. "DistilBERT-SST2", "Llama-3". */
  modelName?: string;
  /** Whether this came from cache. */
  cached?: boolean;
  /** Free-form provenance string, e.g. "Ollama → Groq fallback". */
  provenance?: string;
  /** Timestamp of the judgment. */
  timestamp?: string;
}

/* ------------------------------------------------------------------ */
/*  Confidence badge                                                   */
/* ------------------------------------------------------------------ */

const CONFIDENCE_LABELS: Record<ConfidenceLevel, string> = {
  high: 'High',
  building: 'Building',
  guarded: 'Guarded',
  low: 'Low',
};

const CONFIDENCE_ICONS: Record<ConfidenceLevel, string> = {
  high: '●',
  building: '◕',
  guarded: '◑',
  low: '○',
};

/**
 * Create a compact confidence badge element.
 *
 * Renders as:  ● High  or  ◑ Guarded  etc.
 * Includes a tooltip with the numeric score if available.
 */
export function createConfidenceBadge(
  level: ConfidenceLevel,
  score?: number,
): HTMLElement {
  const tooltip = score !== undefined
    ? `Confidence: ${CONFIDENCE_LABELS[level]} (${score}%)`
    : `Confidence: ${CONFIDENCE_LABELS[level]}`;

  const badge = h('span', {
    className: `ai-confidence-badge ai-confidence-${level}`,
    title: tooltip,
  },
    h('span', { className: 'ai-confidence-icon' }, CONFIDENCE_ICONS[level]),
    h('span', { className: 'ai-confidence-label' }, CONFIDENCE_LABELS[level]),
  );

  return badge;
}

/* ------------------------------------------------------------------ */
/*  Provider source pill                                               */
/* ------------------------------------------------------------------ */

const PROVIDER_SHORT: Record<string, string> = {
  ollama: 'Ollama',
  groq: 'Groq',
  openai: 'OpenAI',
  codex: 'Codex',
  openrouter: 'OpenRouter',
  browser: 'Browser ML',
  cache: 'Cached',
  fallback: 'Fallback',
};

/**
 * Create a small provider pill element.
 *
 * Shows provider name + optional model + cache indicator.
 */
export function createProviderPill(meta: Pick<AiJudgmentMeta, 'provider' | 'modelName' | 'cached'>): HTMLElement {
  const displayName = PROVIDER_SHORT[meta.provider] ?? meta.provider;
  const parts: (HTMLElement | string)[] = [];

  if (meta.cached) {
    parts.push(h('span', { className: 'ai-provider-cache-dot', title: 'Served from cache' }, '⚡'));
  }

  parts.push(h('span', { className: 'ai-provider-name' }, displayName));

  if (meta.modelName) {
    parts.push(h('span', { className: 'ai-provider-model' }, meta.modelName));
  }

  return h('span', { className: 'ai-provider-pill' }, ...parts);
}

/* ------------------------------------------------------------------ */
/*  Combined attribution line                                          */
/* ------------------------------------------------------------------ */

/**
 * Create a full attribution line combining confidence + provider.
 *
 * Example output:  ● High  ·  Groq  Llama-3  ·  2 min ago
 */
export function createAiAttribution(meta: AiJudgmentMeta): HTMLElement {
  const children: (HTMLElement | string)[] = [];

  // Confidence
  children.push(createConfidenceBadge(meta.confidence, meta.confidenceScore));

  // Separator
  children.push(h('span', { className: 'ai-attr-sep' }, '·'));

  // Provider
  children.push(createProviderPill(meta));

  // Provenance (if different from provider)
  if (meta.provenance) {
    children.push(h('span', { className: 'ai-attr-sep' }, '·'));
    children.push(h('span', { className: 'ai-attr-provenance', title: meta.provenance }, meta.provenance));
  }

  // Timestamp
  if (meta.timestamp) {
    children.push(h('span', { className: 'ai-attr-sep' }, '·'));
    children.push(h('span', { className: 'ai-attr-time' }, formatRelativeTime(meta.timestamp)));
  }

  return h('div', { className: 'ai-attribution' }, ...children);
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function formatRelativeTime(iso: string): string {
  try {
    const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
    if (diff < 60) return 'just now';
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    return `${Math.floor(diff / 86400)}d ago`;
  } catch {
    return iso;
  }
}

/**
 * Convert a numeric confidence score (0–100) to a ConfidenceLevel band.
 */
export function scoreToConfidenceLevel(score: number): ConfidenceLevel {
  if (score >= 78) return 'high';
  if (score >= 58) return 'building';
  if (score >= 38) return 'guarded';
  return 'low';
}
