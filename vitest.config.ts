import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

/**
 * Testy jednostkowe i integracyjne (bez przeglądarki):
 * - domain       — czysta logika, środowisko node,
 * - persistence  — IndexedDB przez fake-indexeddb, środowisko node,
 * - app          — rzeczywisty kontroler: domena + IndexedDB (fake-indexeddb) + prawdziwy bank, node,
 * - pwa          — logika Service Workera po stronie okna na atrapach, node,
 * - ui           — komponenty React w jsdom,
 * - docs         — zgodność raportu kontroli (docs/RAPORT_KONTROLI.md) z repozytorium i bankiem (G07), node.
 * Testy e2e (Playwright) są osobno: `npm run test:e2e`.
 */
export default defineConfig({
  plugins: [react()],
  test: {
    restoreMocks: true,
    projects: [
      {
        extends: true,
        test: {
          name: 'domain',
          environment: 'node',
          include: ['tests/domain/**/*.test.ts'],
        },
      },
      {
        extends: true,
        test: {
          name: 'persistence',
          environment: 'node',
          include: ['tests/persistence/**/*.test.ts'],
          setupFiles: ['fake-indexeddb/auto'],
        },
      },
      {
        extends: true,
        test: {
          name: 'app',
          environment: 'node',
          include: ['tests/app/**/*.test.ts'],
          setupFiles: ['fake-indexeddb/auto'],
        },
      },
      {
        extends: true,
        test: {
          name: 'pwa',
          environment: 'node',
          include: ['tests/pwa/**/*.test.ts'],
        },
      },
      {
        extends: true,
        test: {
          name: 'ui',
          environment: 'jsdom',
          include: ['tests/ui/**/*.test.{ts,tsx}'],
        },
      },
      {
        extends: true,
        test: {
          name: 'docs',
          environment: 'node',
          include: ['tests/docs/**/*.test.ts'],
        },
      },
    ],
  },
});
