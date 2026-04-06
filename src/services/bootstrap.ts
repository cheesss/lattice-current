const hydrationCache = new Map<string, unknown>();
const keyStates = new Map<string, 'hydrated' | 'missing' | 'fallback' | 'unknown'>();

let lastBootstrapHydrationStatus = {
  fetchedKeys: 0,
  missingKeys: 0,
  fallbackUsed: false,
  missingKeyNames: [] as string[],
  fallbackGeneratedAt: '',
  staleKeyNames: [] as string[],
};

export function getHydratedData(key: string): unknown | undefined {
  const val = hydrationCache.get(key);
  if (val !== undefined) hydrationCache.delete(key);
  return val;
}

function populateCache(data: Record<string, unknown>, state: 'hydrated' | 'fallback'): void {
  for (const [key, value] of Object.entries(data)) {
    if (value === null || value === undefined) continue;
    hydrationCache.set(key, value);
    keyStates.set(key, state);
    if (value && typeof value === 'object' && 'staleWarning' in value && (value as { staleWarning?: boolean }).staleWarning) {
      lastBootstrapHydrationStatus.staleKeyNames.push(key);
    }
  }
}

async function fetchTier(tier: string, signal: AbortSignal): Promise<void> {
  try {
    const resp = await fetch(`/api/bootstrap?tier=${tier}`, { signal });
    if (!resp.ok) return;
    const { data, missing } = (await resp.json()) as {
      data: Record<string, unknown>;
      missing?: string[];
    };
    populateCache(data || {}, 'hydrated');
    lastBootstrapHydrationStatus.fetchedKeys += Object.keys(data || {}).length;
    if (Array.isArray(missing)) {
      lastBootstrapHydrationStatus.missingKeys += missing.length;
      lastBootstrapHydrationStatus.missingKeyNames.push(...missing);
      for (const key of missing) {
        if (!keyStates.has(key)) keyStates.set(key, 'missing');
      }
    }
  } catch {
    // silent: panels will fall through to direct fetches
  }
}

async function fetchStaticFallback(targetKeys?: string[]): Promise<void> {
  try {
    const response = await fetch('/data/bootstrap-fallback.json', {
      signal: AbortSignal.timeout(1500),
    });
    if (!response.ok) return;
    const payload = await response.json() as {
      data?: Record<string, unknown>;
      meta?: { generatedAt?: string };
    };
    const fallbackData = payload.data || {};
    const selected = Array.isArray(targetKeys) && targetKeys.length > 0
      ? Object.fromEntries(Object.entries(fallbackData).filter(([key]) => targetKeys.includes(key)))
      : fallbackData;
    populateCache(selected, 'fallback');
    lastBootstrapHydrationStatus.fallbackUsed = Object.keys(selected).length > 0;
    lastBootstrapHydrationStatus.fallbackGeneratedAt = payload.meta?.generatedAt || '';
  } catch {
    // best-effort fallback
  }
}

export async function fetchBootstrapData(): Promise<void> {
  keyStates.clear();
  lastBootstrapHydrationStatus = {
    fetchedKeys: 0,
    missingKeys: 0,
    fallbackUsed: false,
    missingKeyNames: [],
    fallbackGeneratedAt: '',
    staleKeyNames: [],
  };

  const fastCtrl = new AbortController();
  const slowCtrl = new AbortController();
  const fastTimeout = setTimeout(() => fastCtrl.abort(), 1_500);
  const slowTimeout = setTimeout(() => slowCtrl.abort(), 2_000);

  try {
    await Promise.all([
      fetchTier('slow', slowCtrl.signal),
      fetchTier('fast', fastCtrl.signal),
    ]);
  } finally {
    clearTimeout(fastTimeout);
    clearTimeout(slowTimeout);
  }

  lastBootstrapHydrationStatus.missingKeyNames = Array.from(new Set(lastBootstrapHydrationStatus.missingKeyNames));
  lastBootstrapHydrationStatus.staleKeyNames = Array.from(new Set(lastBootstrapHydrationStatus.staleKeyNames));

  if (hydrationCache.size === 0) {
    await fetchStaticFallback();
  } else if (lastBootstrapHydrationStatus.missingKeyNames.length > 0) {
    await fetchStaticFallback(lastBootstrapHydrationStatus.missingKeyNames);
  }
}

export function getBootstrapHydrationStatus(): {
  fetchedKeys: number;
  missingKeys: number;
  fallbackUsed: boolean;
  missingKeyNames: string[];
  fallbackGeneratedAt: string;
  staleKeyNames: string[];
  coldStart: boolean;
} {
  return {
    ...lastBootstrapHydrationStatus,
    coldStart: lastBootstrapHydrationStatus.fetchedKeys === 0,
  };
}

export function getHydratedDataStatus(key: string): 'hydrated' | 'missing' | 'fallback' | 'unknown' {
  return keyStates.get(key) || 'unknown';
}
