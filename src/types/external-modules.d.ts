declare module 'virtual:pwa-register' {
  export function registerSW(options?: {
    onRegisteredSW?: (swUrl: string, registration?: ServiceWorkerRegistration) => void;
    onOfflineReady?: () => void;
  }): (() => void) | undefined;
}

declare module 'posthog-js';
