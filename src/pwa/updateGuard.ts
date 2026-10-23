/**
 * Warunek bezpiecznej aktualizacji (DECYZJE §11, kryterium G03): „Uruchom ponownie” tylko poza ekranem
 * pytania i gdy nic nie czeka na zapis. Kontroler podaje tę funkcję jako `confirmUpdateSafe`
 * do `createServiceWorkerPwa` — bez jej potwierdzenia `applyUpdate()` odmawia (`UPDATE_NOT_SAFE`).
 *
 * Funkcja nie zależy od `update.canApplyNow`/`update.applying`, aby kontroler mógł ustawić `applying`
 * przed wywołaniem `pwa.applyUpdate()` — sprawdza stan źródłowy: uruchomienie, trasę, ekran i zapis.
 */
import type { AppState } from '../app/controller';

export type UpdateSafetyState = Pick<AppState, 'boot' | 'route' | 'screen' | 'save'>;

export function isUpdateSafe(state: UpdateSafetyState): boolean {
  // Otwieranie bazy / migracja / wczytywanie danych — nie przerywać.
  if (state.boot.phase === 'loading') return false;
  // Otwarty ekran pytania (także podgląd poprzedniego pytania i stany S24 w sesji).
  if (state.route.name === 'question' || state.screen?.name === 'question') return false;
  // Zapis w toku albo niezapisana zmiana (stan „niezapisane” z ponowieniem).
  if (state.save.status !== 'idle') return false;
  return true;
}
