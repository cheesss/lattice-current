export interface ProviderCooldownState {
  until: number;
  reason: string;
  updatedAt: number;
}

const STORAGE_PREFIX = 'wm:provider-cooldown:';

function storageKey(providerKey: string): string {
  return `${STORAGE_PREFIX}${String(providerKey || '').trim().toLowerCase()}`;
}

function safeStorage(): Storage | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function getProviderCooldownState(providerKey: string): ProviderCooldownState | null {
  const storage = safeStorage();
  if (!storage) return null;
  const key = storageKey(providerKey);
  try {
    const raw = storage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<ProviderCooldownState>;
    const until = Number(parsed?.until);
    if (!Number.isFinite(until) || until <= 0) {
      storage.removeItem(key);
      return null;
    }
    if (Date.now() >= until) {
      storage.removeItem(key);
      return null;
    }
    return {
      until,
      reason: String(parsed?.reason || ''),
      updatedAt: Number(parsed?.updatedAt) || Date.now(),
    };
  } catch {
    storage.removeItem(key);
    return null;
  }
}

export function isProviderCooldownActive(providerKey: string): boolean {
  return Boolean(getProviderCooldownState(providerKey));
}

export function setProviderCooldown(providerKey: string, durationMs: number, reason: string): void {
  const storage = safeStorage();
  if (!storage) return;
  const until = Date.now() + Math.max(1_000, Math.round(durationMs || 0));
  const payload: ProviderCooldownState = {
    until,
    reason: String(reason || ''),
    updatedAt: Date.now(),
  };
  try {
    storage.setItem(storageKey(providerKey), JSON.stringify(payload));
  } catch {
    // Ignore storage write failures.
  }
}

export function clearProviderCooldown(providerKey: string): void {
  const storage = safeStorage();
  if (!storage) return;
  try {
    storage.removeItem(storageKey(providerKey));
  } catch {
    // Ignore storage write failures.
  }
}
