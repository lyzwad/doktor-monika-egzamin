/**
 * Skrypt przejęcia Service Workera przy zmianie wersji TREŚCI (importScripts w sw.js; vite.config.ts).
 * Treść skryptu przejęcia. Zasady (MDN/BCD: `skipWaiting`, `Clients.claim` — Safari 11.1/iOS 11.3;
 * `WindowClient.navigate` — Safari/iOS 16+, wcześniej `NotSupportedError`):
 *  - install: jeśli to AKTUALIZACJA (jest aktywny poprzedni worker) i znacznik wersji treści w Cache Storage
 *    jest inny niż ten build → zapis „przejęcie oczekuje” i `skipWaiting()`; pierwsza instalacja i zwykłe
 *    aktualizacje aplikacji bez zmiany treści — bez przejęcia (aktualizacja na żądanie, DECYZJE §11);
 *  - activate: znacznik = ta wersja; przy oczekującym przejęciu `clients.claim()`, wiadomość
 *    `DME_CONTENT_UPDATE` do okien (nowa aplikacja przeładowuje się sama) i `client.navigate(client.url)`
 *    (przeładowanie także STAREGO kodu, który wiadomości nie zna). `navigate` nie jest awaitowane w
 *    `waitUntil` — żądanie nawigacji czeka na zakończenie aktywacji;
 *  - fetch: dawna ścieżka banku `data/bank.json` w scope → 404 (bez sieci i bez pamięci HTTP przeglądarki);
 *  - stary precache tej aplikacji usuwa Workbox przy aktywacji (wpisy spoza nowego manifestu, tylko cache
 *    `workbox-precache-v2-<scope>` tej rejestracji); `cleanupOutdatedCaches` usuwa stare formaty Workboxa.
 */
/**
 * @param {{ bankVersion: string, bankSha256: string, bankFile: string }} release
 * @returns {string}
 */
export function takeoverScript(release) {
  const content = JSON.stringify({ bankVersion: release.bankVersion, bankSha256: release.bankSha256, bankFile: release.bankFile });
  return `/* Doktor Monika Egzamin — przejęcie po zmianie wersji treści (wygenerowane w vite.config.ts). */
(() => {
  const CONTENT = ${content};
  const scope = self.registration.scope;
  const MARKER_CACHE = 'dme-content-marker-v1:' + scope;
  const VERSION_KEY = new URL('__dme-content-version', scope).href;
  const PENDING_KEY = new URL('__dme-content-takeover', scope).href;
  // Dawna ścieżka banku (do v0.1.0) nie jest serwowana w scope aplikacji — także z pamięci HTTP przeglądarki.
  const LEGACY_BANK = new URL('data/bank.json', scope).href;
  self.addEventListener('fetch', (event) => {
    const url = event.request.url.split('#')[0].split('?')[0];
    if (url === LEGACY_BANK) {
      event.respondWith(new Response('404', { status: 404, headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' } }));
    }
  });
  self.addEventListener('install', (event) => {
    event.waitUntil((async () => {
      const cache = await caches.open(MARKER_CACHE);
      const stored = await cache.match(VERSION_KEY);
      const previous = stored ? await stored.text() : null;
      if (self.registration.active && previous !== CONTENT.bankVersion) {
        await cache.put(PENDING_KEY, new Response(CONTENT.bankVersion));
        await self.skipWaiting();
      }
    })());
  });
  self.addEventListener('activate', (event) => {
    event.waitUntil((async () => {
      const cache = await caches.open(MARKER_CACHE);
      const pending = await cache.match(PENDING_KEY);
      await cache.put(VERSION_KEY, new Response(CONTENT.bankVersion));
      if (!pending) return;
      await cache.delete(PENDING_KEY);
      await self.clients.claim();
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const client of windows) {
        try { client.postMessage({ type: 'DME_CONTENT_UPDATE', bankVersion: CONTENT.bankVersion }); } catch (e) { /* okno zamknięte */ }
        try {
          if (typeof client.navigate === 'function') client.navigate(client.url).catch(() => undefined);
        } catch (e) { /* Safari < 16: NotSupportedError — fallback: wiadomość, przeładowanie przy starcie/powrocie */ }
      }
    })());
  });
})();
`;
}
