function getVariantEnv(): string {
  try {
    const value = import.meta.env?.VITE_VARIANT;
    if (typeof value === 'string' && value.trim()) return value.trim();
  } catch {
    // Node/tsx runtime without Vite env injection.
  }

  if (typeof process !== 'undefined' && typeof process.env?.VITE_VARIANT === 'string' && process.env.VITE_VARIANT.trim()) {
    return process.env.VITE_VARIANT.trim();
  }

  return 'full';
}

export const VARIANT_STORAGE_KEY = 'lattice-current-variant';
export const LEGACY_VARIANT_STORAGE_KEY = 'worldmonitor-variant';

function readStoredVariant(): string | null {
  try {
    const stored = localStorage.getItem(VARIANT_STORAGE_KEY) || localStorage.getItem(LEGACY_VARIANT_STORAGE_KEY);
    if (stored === 'tech' || stored === 'full' || stored === 'finance' || stored === 'happy' || stored === 'commodity') {
      return stored;
    }
  } catch {
    // ignore localStorage access failures
  }
  return null;
}

export const SITE_VARIANT: string = (() => {
  if (typeof window === 'undefined') return getVariantEnv();

  const isTauri = '__TAURI_INTERNALS__' in window || '__TAURI__' in window;
  if (isTauri) {
    const stored = readStoredVariant();
    if (stored) return stored;
    return getVariantEnv();
  }

  const h = location.hostname;
  if (h.startsWith('tech.')) return 'tech';
  if (h.startsWith('finance.')) return 'finance';
  if (h.startsWith('happy.')) return 'happy';
  if (h.startsWith('commodity.')) return 'commodity';

  const stored = readStoredVariant();
  if (stored) return stored;

  if (h === 'localhost' || h === '127.0.0.1') return getVariantEnv();

  return getVariantEnv();
})();
