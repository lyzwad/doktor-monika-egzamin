import { defineConfig, devices } from '@playwright/test';

/**
 * Testy e2e na PRODUKCYJNYM buildzie serwowanym pod podścieżką jak na GitHub Pages
 * (`scripts/serve-dist.mjs`: tylko `base`, `Cache-Control: max-age=600`, 404 dla braków).
 *
 * Projekty (przeglądarki z ~/Library/Caches/ms-playwright — chromium-1243, webkit-2359 — bez pobierania):
 * - `webkit-iphone15` — silnik Safari, emulacja iPhone 15: 393×852, deviceScaleFactor 3, isMobile, hasTouch;
 * - `chromium-mobile` — Chromium z tymi samymi wymiarami i dotykiem (UA Androida).
 * UWAGA: to nie zastępuje testu na fizycznym iPhonie (kryterium G05).
 *
 * Zmienne: BASE_PATH (domyślnie /, jak na wiedza.doktormonika.pl), E2E_PORT (4173),
 * E2E_SKIP_BUILD=1 — użyj istniejącego `dist` (szybsze iteracje; build musi mieć ten sam BASE_PATH).
 */
const basePath = process.env.BASE_PATH ?? '/';
const port = Number(process.env.E2E_PORT ?? 4173);
const serve = `node scripts/serve-dist.mjs --dist dist --base ${basePath} --port ${port}`;

const viewport = { width: 393, height: 852 };

export default defineConfig({
  testDir: 'tests/e2e',
  outputDir: 'test-results',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.E2E_WORKERS ? Number(process.env.E2E_WORKERS) : 4,
  timeout: 90_000,
  expect: { timeout: 10_000 },
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://127.0.0.1:${port}${basePath}`,
    locale: 'pl-PL',
    timezoneId: 'Europe/Warsaw',
    trace: 'retain-on-failure',
    serviceWorkers: 'allow',
  },
  projects: [
    { name: 'webkit-iphone15', use: { ...devices['iPhone 15'], viewport } },
    {
      name: 'chromium-mobile',
      use: {
        browserName: 'chromium',
        viewport,
        deviceScaleFactor: 3,
        isMobile: true,
        hasTouch: true,
        userAgent: devices['Pixel 7'].userAgent,
      },
    },
  ],
  webServer: {
    command: process.env.E2E_SKIP_BUILD ? serve : `npm run build && ${serve}`,
    env: { BASE_PATH: basePath },
    url: `http://127.0.0.1:${port}${basePath}`,
    reuseExistingServer: false,
    timeout: 240_000,
  },
});
