/**
 * Testy jednostkowe warstwy PWA (tests/pwa) — środowisko node, atrapy Service Workera.
 *
 *   npx vitest run --config scripts/vitest.pwa.config.mjs
 *
 * Projekt `pwa` jest też w vitest.config.ts, więc testy PWA uruchamia zwykłe `npm test` (i workflow Pages).
 * Ta konfiguracja służy tylko do szybkiego, zawężonego uruchomienia (równoważnie: `npx vitest run tests/pwa`).
 */
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  root: fileURLToPath(new URL('..', import.meta.url)),
  test: {
    name: 'pwa',
    environment: 'node',
    include: ['tests/pwa/**/*.test.ts'],
    restoreMocks: true,
  },
});
