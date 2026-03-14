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

export const SITE_VARIANT: string = (() => {
  if (typeof window === 'undefined') return getVariantEnv();

  const isTauri = '__TAURI_INTERNALS__' in window || '__TAURI__' in window;
  if (isTauri) {
    const stored = localStorage.getItem('worldmonitor-variant');
    if (stored === 'tech' || stored === 'full' || stored === 'finance' || stored === 'happy' || stored === 'commodity') return stored;
    return getVariantEnv();
  }

  const h = location.hostname;
  if (h.startsWith('tech.')) return 'tech';
  if (h.startsWith('finance.')) return 'finance';
  if (h.startsWith('happy.')) return 'happy';
  if (h.startsWith('commodity.')) return 'commodity';

  if (h === 'localhost' || h === '127.0.0.1') {
    const stored = localStorage.getItem('worldmonitor-variant');
    if (stored === 'tech' || stored === 'full' || stored === 'finance' || stored === 'happy' || stored === 'commodity') return stored;
    return getVariantEnv();
  }

  return 'full';
})();
