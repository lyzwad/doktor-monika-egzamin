/**
 * Wspólny `test` e2e z profilem (DECYZJE §16): zwykłe scenariusze startują w profilu `E2E_PROFILE` (profil karty
 * w sessionStorage ustawiony przed załadowaniem strony — bez ekranu wyboru). Scenariusze profili i aktualizacji
 * wyłączają to przez `test.use({ presetProfile: null })` i przechodzą przez „Wybierz profil”.
 */
import { test as base, expect } from '@playwright/test';

export const E2E_PROFILE = 'monika@doktormonika.pl';
/** Klucz profilu karty (src/main.tsx). */
export const TAB_PROFILE_KEY = 'dme-profil-karty';

export const test = base.extend<{ presetProfile: string | null }>({
  presetProfile: [E2E_PROFILE, { option: true }],
  context: async ({ context, presetProfile }, use) => {
    if (presetProfile) {
      await context.addInitScript(
        ([key, email]) => {
          try {
            if (!sessionStorage.getItem(key)) sessionStorage.setItem(key, email);
          } catch {
            /* bez sessionStorage — ekran wyboru */
          }
        },
        [TAB_PROFILE_KEY, presetProfile] as const,
      );
    }
    await use(context);
  },
});

export { expect };
