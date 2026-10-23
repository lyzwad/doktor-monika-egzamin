/**
 * Rejestracja Service Workera w przeglądarce: `registerSW` z `virtual:pwa-register` (vite-plugin-pwa,
 * `registerType: 'prompt'`, `injectRegister: false`) + logika z `swController.ts`.
 *
 * Użycie (agent integracji, src/main.tsx):
 *
 *   let controller: AppController | null = null;
 *   const pwa = createServiceWorkerPwa({
 *     confirmUpdateSafe: () => controller !== null && isUpdateSafe(controller.getState()),
 *   });
 *   controller = createAppController({ ..., pwa });
 *   if (pwa.consumeUpdatedFlag()) { ...toast 'app_updated'... }
 *
 * W trybie deweloperskim (`npm run dev`) SW jest wyłączony (devOptions.enabled = false) — port zwraca
 * stan `unsupported` i nie zgłasza przygotowania ani aktualizacji.
 */
import { registerSW } from 'virtual:pwa-register';
import { createServiceWorkerPwaWith, PRECACHE_INFO_FILE, type ServiceWorkerPwa, type ServiceWorkerPwaOptions } from './swController';

function sessionStorageOrNull(): Storage | null {
  try {
    return typeof sessionStorage === 'undefined' ? null : sessionStorage;
  } catch {
    return null;
  }
}

function serviceWorkerOrNull(): ServiceWorkerContainer | null {
  if (!import.meta.env.PROD) return null;
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return null;
  // Service Worker wymaga bezpiecznego kontekstu (https albo localhost).
  if (!window.isSecureContext || !('serviceWorker' in navigator)) return null;
  return navigator.serviceWorker;
}

export function createServiceWorkerPwa(options: ServiceWorkerPwaOptions): ServiceWorkerPwa {
  const base = import.meta.env.BASE_URL;
  return createServiceWorkerPwaWith(
    {
      registerSW,
      serviceWorker: serviceWorkerOrNull(),
      caches: typeof caches === 'undefined' ? null : caches,
      swUrl: `${base}sw.js`,
      scope: base,
      scopeUrl: typeof window === 'undefined' ? undefined : new URL(base, window.location.href).href,
      async fetchPrecacheInfo() {
        // Ten sam origin; plik nie jest w precache (potrzebny tylko przy pierwszym przygotowaniu).
        const response = await fetch(`${base}${PRECACHE_INFO_FILE}`, { cache: 'no-store' });
        return response.ok ? ((await response.json()) as unknown) : null;
      },
      reload: () => window.location.reload(),
      isOnline: () => navigator.onLine,
      storage: sessionStorageOrNull(),
      onVisible(listener) {
        const handler = (): void => {
          if (document.visibilityState === 'visible') listener();
        };
        document.addEventListener('visibilitychange', handler);
        return () => document.removeEventListener('visibilitychange', handler);
      },
      onOnline(listener) {
        window.addEventListener('online', listener);
        return () => window.removeEventListener('online', listener);
      },
      now: () => Date.now(),
      setTimeout: (callback, ms) => window.setTimeout(callback, ms),
      clearTimeout: (handle) => window.clearTimeout(handle as number),
    },
    options,
  );
}

export { isUpdateSafe } from './updateGuard';
export { PwaError, type PwaErrorCode, type PwaStatus, type ServiceWorkerPwa, type ServiceWorkerPwaOptions } from './swController';
