const BANNER_ID = 'openbbFallbackBanner';

function ensureBanner(): HTMLDivElement | null {
  if (typeof document === 'undefined') return null;
  const existing = document.getElementById(BANNER_ID);
  if (existing instanceof HTMLDivElement) {
    return existing;
  }

  const banner = document.createElement('div');
  banner.id = BANNER_ID;
  banner.className = 'openbb-fallback-banner';
  banner.innerHTML = `
    <span class="openbb-fallback-badge">OPENBB FALLBACK</span>
    <span class="openbb-fallback-text" data-openbb-fallback-text>openbb-api unavailable</span>
  `;
  document.body.appendChild(banner);
  return banner;
}

export function showOpenbbFallbackBanner(message?: string): void {
  const banner = ensureBanner();
  if (!banner) return;

  const text = banner.querySelector('[data-openbb-fallback-text]');
  if (text) {
    text.textContent = message && message.trim()
      ? message.trim()
      : 'openbb-api unavailable, fallback data path enabled';
  }

  banner.classList.add('visible');
}

export function hideOpenbbFallbackBanner(): void {
  if (typeof document === 'undefined') return;
  const banner = document.getElementById(BANNER_ID);
  if (banner) {
    banner.classList.remove('visible');
  }
}
