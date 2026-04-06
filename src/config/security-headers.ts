export const SECURITY_HEADERS_SOURCE = '/(.*)';
export const HTML_ENTRY_ROUTES = ['/', '/index.html'] as const;

export const CSP_SCRIPT_HASHES = [
  'sha256-uPcMfMVY8vf09gaYsMIox+MMXHgfJy7rKbrosSoKRuE=',
  'sha256-RwhGJKgfSPmDNE+/lD0YoshsJrJmei0yfsU3hUM6pYI=',
  'sha256-XNY2Pei2tDLfPl/s7UKRHvt4VgmOvPLgvNTvoIB09Xk=',
] as const;

export const DISABLED_PERMISSIONS = [
  'camera=()',
  'microphone=()',
  'geolocation=()',
  'accelerometer=()',
  'bluetooth=()',
  'display-capture=()',
  'gyroscope=()',
  'hid=()',
  'idle-detection=()',
  'magnetometer=()',
  'midi=()',
  'payment=()',
  'screen-wake-lock=()',
  'serial=()',
  'usb=()',
  'xr-spatial-tracking=()',
] as const;

export const YOUTUBE_DELEGATED_PERMISSIONS = ['autoplay', 'encrypted-media', 'picture-in-picture'] as const;
export const YOUTUBE_EMBED_ORIGINS = ['https://www.youtube.com', 'https://www.youtube-nocookie.com'] as const;

export function buildPermissionsPolicy(): string {
  const delegated = YOUTUBE_DELEGATED_PERMISSIONS.map(
    (feature) => `${feature}=(self "${YOUTUBE_EMBED_ORIGINS[0]}" "${YOUTUBE_EMBED_ORIGINS[1]}")`,
  );
  return [...DISABLED_PERMISSIONS, ...delegated].join(', ');
}

export function buildContentSecurityPolicy(): string {
  const scriptHashes = CSP_SCRIPT_HASHES.map((hash) => `'${hash}'`).join(' ');
  return [
    "default-src 'self'",
    "connect-src 'self' https: wss: blob: data:",
    "img-src 'self' data: blob: https:",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    `script-src 'self' ${scriptHashes} 'wasm-unsafe-eval' https://www.youtube.com https://static.cloudflareinsights.com https://vercel.live https://challenges.cloudflare.com`,
    "worker-src 'self' blob:",
    "font-src 'self' data: https:",
    "media-src 'self' data: blob: https:",
    "frame-src 'self' https://worldmonitor.app https://tech.worldmonitor.app https://happy.worldmonitor.app https://www.youtube.com https://www.youtube-nocookie.com https://challenges.cloudflare.com",
    "frame-ancestors 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "form-action 'self'",
  ].join('; ');
}
