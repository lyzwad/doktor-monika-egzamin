import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { CONTENT_RELEASE } from './src/domain/contentRelease';

/**
 * Ścieżka bazowa publikacji. Lokalnie `/`; dla GitHub Pages `/<repozytorium>/`
 * (ustawiane w workflow zmienną BASE_PATH). Manifest (start_url/scope = '.')
 * i rejestracja Service Workera są względne do `base`.
 */
const base = process.env.BASE_PATH ?? '/';

/**
 * Wersja aplikacji (src/app/appVersion.ts): `version` z package.json, opcjonalnie z identyfikatorem
 * buildu (`APP_BUILD_ID`, np. skrót commita w CI) — pokazywana w Ustawieniach i zapisywana w kopii.
 */
const packageVersion = (JSON.parse(readFileSync(resolve('package.json'), 'utf-8')) as { version: string }).version;
const appVersion = process.env.APP_BUILD_ID ? `${packageVersion}+${process.env.APP_BUILD_ID}` : packageVersion;

/* ---------------------------------------------------------------------------------------------- */
/* Część PWA: właściciel = agent PWA (DECYZJE §11). Opis i źródła: docs/WDROZENIE.md.             */
/* ---------------------------------------------------------------------------------------------- */

/** Lista precache (url, rewizja, rozmiar) do pomiaru postępu pierwszego przygotowania (src/pwa). */
const PRECACHE_INFO_FILE = 'pwa-precache.json';
/** Limit pojedynczego pliku w precache — docelowy bank (2000–3000 pytań) ma kilka MB; zapas do 16 MB. */
const PRECACHE_MAX_FILE_BYTES = 16 * 1024 * 1024;
/** Pliki, bez których nauka offline nie działa — brak w precache przerywa build (bank V15 pod wersjonowaną ścieżką). */
const PRECACHE_REQUIRED = ['index.html', CONTENT_RELEASE.bankFile, CONTENT_RELEASE.retiredFile, CONTENT_RELEASE.profileFile];
/** Plik wydania (wersja treści na serwerze) — poza precache, czytany bez cache (src/pwa/swController.ts). */
const RELEASE_INFO_FILE = 'dme-release.json';
/**
 * Skrypt Service Workera (importScripts w wygenerowanym sw.js): przejęcie kart i okien z ikony, gdy zmienia
 * się wersja TREŚCI (docs/MIGRACJA_V15.md, docs/WDROZENIE.md). Nazwa zawiera skrót sumy banku — nowa wersja
 * treści = nowy plik i inny bajtowo sw.js.
 */
const TAKEOVER_FILE = `dme-sw-takeover-${CONTENT_RELEASE.bankSha256.slice(0, 12)}.js`;

/**
 * Treść skryptu przejęcia. Zasady (MDN/BCD: `skipWaiting`, `Clients.claim` — Safari 11.1/iOS 11.3;
 * `WindowClient.navigate` — Safari/iOS 16+, wcześniej `NotSupportedError`):
 *  - install: jeśli to AKTUALIZACJA (jest aktywny poprzedni worker) i znacznik wersji treści w Cache Storage
 *    jest inny niż ten build → zapis „przejęcie oczekuje” i `skipWaiting()`; pierwsza instalacja i zwykłe
 *    aktualizacje aplikacji bez zmiany treści — bez przejęcia (aktualizacja na żądanie, DECYZJE §11);
 *  - activate: znacznik = ta wersja; przy oczekującym przejęciu `clients.claim()`, wiadomość
 *    `DME_CONTENT_UPDATE` do okien (nowa aplikacja przeładowuje się sama) i `client.navigate(client.url)`
 *    (przeładowanie także STAREGO kodu, który wiadomości nie zna). `navigate` nie jest awaitowane w
 *    `waitUntil` — żądanie nawigacji czeka na zakończenie aktywacji;
 *  - stary precache tej aplikacji usuwa Workbox przy aktywacji (wpisy spoza nowego manifestu, tylko cache
 *    `workbox-precache-v2-<scope>` tej rejestracji); `cleanupOutdatedCaches` usuwa stare formaty Workboxa.
 */
function takeoverScript(): string {
  const content = JSON.stringify({ bankVersion: CONTENT_RELEASE.bankVersion, bankSha256: CONTENT_RELEASE.bankSha256, bankFile: CONTENT_RELEASE.bankFile });
  return `/* Doktor Monika Egzamin — przejęcie po zmianie wersji treści (wygenerowane w vite.config.ts). */
(() => {
  const CONTENT = ${content};
  const scope = self.registration.scope;
  const MARKER_CACHE = 'dme-content-marker-v1:' + scope;
  const VERSION_KEY = new URL('__dme-content-version', scope).href;
  const PENDING_KEY = new URL('__dme-content-takeover', scope).href;
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

/**
 * Plik wydania, skrypt przejęcia i kontrola katalogu `public/data` (wyłącznie trzy pliki V15 z poprawnymi
 * sumami SHA-256) — build przerywa się przy niezgodności.
 */
function contentReleasePlugin(): Plugin {
  return {
    name: 'dme-content-release',
    apply: 'build',
    buildStart() {
      const dataDir = resolve('public/data');
      const expected = new Map([
        [CONTENT_RELEASE.bankFile.replace('data/', ''), CONTENT_RELEASE.bankSha256],
        [CONTENT_RELEASE.retiredFile.replace('data/', ''), CONTENT_RELEASE.retiredSha256],
        [CONTENT_RELEASE.profileFile.replace('data/', ''), CONTENT_RELEASE.profileSha256],
      ]);
      const present = readdirSync(dataDir).filter((f) => !f.startsWith('.'));
      const extra = present.filter((f) => !expected.has(f));
      if (extra.length > 0) throw new Error(`[treść] public/data zawiera pliki spoza banku V15: ${extra.join(', ')}`);
      for (const [file, sha] of expected) {
        const path = resolve(dataDir, file);
        if (!existsSync(path)) throw new Error(`[treść] Brak pliku ${file}`);
        const actual = createHash('sha256').update(readFileSync(path)).digest('hex');
        if (actual !== sha) throw new Error(`[treść] SHA-256 ${file} = ${actual}, oczekiwano ${sha}`);
      }
    },
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: TAKEOVER_FILE, source: takeoverScript() });
      this.emitFile({
        type: 'asset',
        fileName: RELEASE_INFO_FILE,
        source: `${JSON.stringify({ format: 'dme-release', version: 1, bankVersion: CONTENT_RELEASE.bankVersion, bankSha256: CONTENT_RELEASE.bankSha256, bankFile: CONTENT_RELEASE.bankFile, appVersion })}\n`,
      });
    },
  };
}
/** Nazwa manifestu webowego (domyślna w vite-plugin-pwa); plugin dodaje go do precache z rewizją MD5 treści. */
const WEB_MANIFEST_FILE = 'manifest.webmanifest';

interface PrecacheEntry {
  url: string;
  revision: string | null;
  size: number;
}

/**
 * Zapisuje `pwa-precache.json` w katalogu wyjściowym w trakcie generowania SW (manifestTransforms
 * workbox-build: wpisy z globa po filtrze rozmiaru, przed dodaniem manifestu webowego).
 * Plik jest poza precache (globIgnores) — używany tylko online przy pierwszym przygotowaniu.
 */
function precacheInfo(): { plugin: Plugin; transform: <T extends PrecacheEntry>(entries: T[]) => { manifest: T[]; warnings: string[] } } {
  let outDir = resolve('dist');
  return {
    plugin: {
      name: 'dme-pwa-precache-info',
      apply: 'build',
      configResolved(config) {
        outDir = resolve(config.root, config.build.outDir);
      },
    },
    transform(entries) {
      const missing = PRECACHE_REQUIRED.filter((url) => !entries.some((e) => e.url === url));
      if (missing.length > 0) {
        throw new Error(
          `[PWA] Brak w precache: ${missing.join(', ')} — sprawdź globPatterns i maximumFileSizeToCacheInBytes (${PRECACHE_MAX_FILE_BYTES} B).`,
        );
      }
      const listed: PrecacheEntry[] = entries.map(({ url, revision, size }) => ({ url, revision: revision ?? null, size }));
      // Manifest webowy dochodzi do precache po tej transformacji (additionalManifestEntries, rewizja = MD5 pliku).
      const manifestPath = resolve(outDir, WEB_MANIFEST_FILE);
      if (existsSync(manifestPath) && !listed.some((e) => e.url === WEB_MANIFEST_FILE)) {
        const content = readFileSync(manifestPath);
        listed.push({ url: WEB_MANIFEST_FILE, revision: createHash('md5').update(content).digest('hex'), size: content.length });
      }
      const info = { format: 'dme-precache-info', version: 1, entries: listed };
      writeFileSync(resolve(outDir, PRECACHE_INFO_FILE), `${JSON.stringify(info)}\n`);
      return { manifest: entries, warnings: [] };
    },
  };
}

const pwaPrecacheInfo = precacheInfo();

export default defineConfig({
  base,
  define: {
    __APP_VERSION__: JSON.stringify(appVersion),
  },
  plugins: [
    react(),
    contentReleasePlugin(),
    pwaPrecacheInfo.plugin,
    VitePWA({
      // Aktualizacja wyłącznie na żądanie użytkowniczki (baner poza ekranem pytania).
      registerType: 'prompt',
      // Rejestracja ręczna w src/pwa (virtual:pwa-register), bez skryptu wstrzykiwanego do HTML.
      injectRegister: false,
      manifest: {
        // Tożsamość aplikacji: ścieżka bazowa (id rozwiązywane względem originu start_url — MDN).
        id: base,
        name: 'Doktor Monika Egzamin',
        short_name: 'Doktor Monika Egzamin',
        description: 'Osobista nauka do egzaminu: pytania jednokrotnego wyboru, Free Flow i Test. Działa offline.',
        lang: 'pl',
        dir: 'ltr',
        display: 'standalone',
        orientation: 'portrait',
        theme_color: '#FAFBFC',
        background_color: '#FAFBFC',
        // Względem adresu manifestu (= base), więc działa pod podścieżką GitHub Pages.
        start_url: '.',
        scope: '.',
        // Ikony z autorskiego znaku „DM” (scripts/generate-icons.mjs, źródło scripts/icons/znak-dm.svg).
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: 'icons/icon-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      // Ikony (w tym apple-touch-icon 180) trafiają do precache przez glob *.png — bez dublowania wpisów.
      includeManifestIcons: false,
      workbox: {
        // Shell, JS/CSS, lokalne fonty woff2, ikony PNG, figury SVG i bank V15 (data/bank-<sha12>.json + pliki towarzyszące).
        globPatterns: ['**/*.{html,js,css,woff2,svg,png,json}'],
        globIgnores: ['**/node_modules/**/*', PRECACHE_INFO_FILE, RELEASE_INFO_FILE],
        // Przejęcie otwartych kart i aplikacji z ikony przy zmianie wersji treści (bank pytań).
        importScripts: [TAKEOVER_FILE],
        maximumFileSizeToCacheInBytes: PRECACHE_MAX_FILE_BYTES,
        manifestTransforms: [pwaPrecacheInfo.transform],
        // Nawigacja w obrębie scope (np. odświeżenie, wejście offline) → index.html z precache; routing hash.
        navigateFallback: 'index.html',
        cleanupOutdatedCaches: true,
        // Zwykłe aktualizacje aplikacji czekają na „Uruchom ponownie” (SKIP_WAITING z src/pwa); zmiana wersji
        // TREŚCI (bank pytań) przejmuje strony sama — skrypt TAKEOVER_FILE (skipWaiting, claim, navigate).
        skipWaiting: false,
        clientsClaim: false,
      },
      devOptions: {
        enabled: false,
      },
    }),
  ],
  build: {
    target: 'es2022',
    sourcemap: false,
  },
});
