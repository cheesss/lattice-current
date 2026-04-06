/**
 * LLM Fallback Status Utility
 *
 * Tracks which LLM provider is currently active in the fallback chain
 * and provides DOM elements to display the status to users.
 *
 * The fallback chain: Ollama → Groq → OpenAI → Codex → OpenRouter → Browser T5
 */

import { h } from './dom-utils';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export type LlmProvider = 'ollama' | 'groq' | 'openai' | 'codex' | 'openrouter' | 'browser' | 'cache' | 'fallback';

export interface LlmProviderStatus {
  provider: LlmProvider;
  healthy: boolean;
  latencyMs?: number;
  lastUsed?: string;
  errorCount: number;
}

export interface LlmFallbackState {
  activeProvider: LlmProvider;
  chain: LlmProviderStatus[];
  lastSwitchAt?: string;
  totalRequests: number;
  cacheHitRate: number;
}

/* ------------------------------------------------------------------ */
/*  State tracking                                                     */
/* ------------------------------------------------------------------ */

const CHAIN_ORDER: LlmProvider[] = ['ollama', 'groq', 'openai', 'codex', 'openrouter', 'browser'];

let _state: LlmFallbackState = {
  activeProvider: 'ollama',
  chain: CHAIN_ORDER.map((p) => ({ provider: p, healthy: true, errorCount: 0 })),
  totalRequests: 0,
  cacheHitRate: 0,
};

const _listeners = new Set<(state: LlmFallbackState) => void>();

export function getLlmFallbackState(): Readonly<LlmFallbackState> {
  return _state;
}

export function updateLlmProviderStatus(
  provider: LlmProvider,
  update: Partial<Pick<LlmProviderStatus, 'healthy' | 'latencyMs' | 'errorCount'>>,
): void {
  const entry = _state.chain.find((p) => p.provider === provider);
  if (entry) {
    Object.assign(entry, update);
    entry.lastUsed = new Date().toISOString();
  }
  _notifyListeners();
}

export function setActiveProvider(provider: LlmProvider): void {
  if (_state.activeProvider !== provider) {
    _state = { ..._state, activeProvider: provider, lastSwitchAt: new Date().toISOString() };
    _notifyListeners();
  }
}

export function recordLlmRequest(cached: boolean): void {
  _state.totalRequests++;
  if (cached) {
    _state.cacheHitRate = (_state.cacheHitRate * (_state.totalRequests - 1) + 100) / _state.totalRequests;
  } else {
    _state.cacheHitRate = (_state.cacheHitRate * (_state.totalRequests - 1)) / _state.totalRequests;
  }
  _notifyListeners();
}

export function onLlmFallbackChange(listener: (state: LlmFallbackState) => void): () => void {
  _listeners.add(listener);
  return () => _listeners.delete(listener);
}

function _notifyListeners(): void {
  for (const fn of _listeners) fn(_state);
}

/* ------------------------------------------------------------------ */
/*  DOM rendering                                                      */
/* ------------------------------------------------------------------ */

const PROVIDER_DISPLAY: Record<LlmProvider, { name: string; icon: string }> = {
  ollama: { name: 'Ollama', icon: '🦙' },
  groq: { name: 'Groq', icon: '⚡' },
  openai: { name: 'OpenAI', icon: '🤖' },
  codex: { name: 'Codex', icon: '📝' },
  openrouter: { name: 'OpenRouter', icon: '🔀' },
  browser: { name: 'Browser ML', icon: '🧠' },
  cache: { name: 'Cached', icon: '💾' },
  fallback: { name: 'Fallback', icon: '🔄' },
};

/**
 * Create a compact status indicator showing the active LLM provider
 * and fallback chain health.
 */
export function createLlmStatusIndicator(): HTMLElement {
  const state = _state;
  const active = PROVIDER_DISPLAY[state.activeProvider] ?? { name: state.activeProvider, icon: '?' };

  const chainDots = state.chain.map((p) => {
    const isActive = p.provider === state.activeProvider;
    return h('span', {
      className: `llm-chain-dot ${p.healthy ? 'healthy' : 'down'} ${isActive ? 'active' : ''}`,
      title: `${PROVIDER_DISPLAY[p.provider]?.name ?? p.provider}: ${p.healthy ? 'OK' : 'Down'}${p.latencyMs ? ` (${p.latencyMs}ms)` : ''}`,
    });
  });

  const indicator = h('div', { className: 'llm-fallback-indicator' },
    h('span', { className: 'llm-active-provider' },
      h('span', { className: 'llm-provider-icon' }, active.icon),
      h('span', { className: 'llm-provider-name' }, active.name),
    ),
    h('div', { className: 'llm-chain-dots' }, ...chainDots),
    h('span', { className: 'llm-cache-rate' }, `Cache ${Math.round(state.cacheHitRate)}%`),
  );

  return indicator;
}

/**
 * Create a detailed fallback chain panel for the governance dashboard.
 */
export function createLlmChainDetail(): HTMLElement {
  const state = _state;
  const rows = state.chain.map((p) => {
    const display = PROVIDER_DISPLAY[p.provider] ?? { name: p.provider, icon: '?' };
    const isActive = p.provider === state.activeProvider;
    return h('div', { className: `llm-chain-row ${isActive ? 'active' : ''} ${p.healthy ? '' : 'down'}` },
      h('span', { className: 'llm-chain-icon' }, display.icon),
      h('span', { className: 'llm-chain-name' }, display.name),
      h('span', { className: `llm-chain-status ${p.healthy ? 'ok' : 'err'}` }, p.healthy ? 'OK' : 'Down'),
      h('span', { className: 'llm-chain-latency' }, p.latencyMs ? `${p.latencyMs}ms` : '—'),
      h('span', { className: 'llm-chain-errors' }, p.errorCount > 0 ? `${p.errorCount} err` : ''),
    );
  });

  return h('div', { className: 'llm-chain-detail' },
    h('div', { className: 'llm-chain-header' }, 'LLM Fallback Chain'),
    ...rows,
    h('div', { className: 'llm-chain-footer' },
      `Total requests: ${state.totalRequests} · Cache hit rate: ${Math.round(state.cacheHitRate)}%`,
    ),
  );
}
