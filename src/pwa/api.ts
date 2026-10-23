/**
 * KONTRAKT PWA (DECYZJE §11) — port używany przez kontroler. Implementację rejestracji Service Workera
 * (vite-plugin-pwa, `virtual:pwa-register`, `registerType: 'prompt'`) dostarcza agent PWA w src/pwa.
 *
 * Zasady: bez automatycznego `skipWaiting`/`clientsClaim`; baner aktualizacji tylko poza ekranem pytania;
 * `applyUpdate()` wywoływane dopiero po zapisie stanu (kontroler pilnuje kolejności).
 */

/**
 * Postęp pierwszego przygotowania materiałów offline (S24a).
 * Implementacja `createServiceWorkerPwa` (src/pwa/registerSW.ts) podaje bajty plików precache;
 * `total = 0` oznacza nieznany rozmiar (postęp nieokreślony). UI pokazuje `done / total` jako procent.
 */
export interface PreparationProgress {
  done: number;
  total: number;
}

export interface PwaPort {
  /** Nowa wersja czeka (SW w stanie `waiting`). Zwraca funkcję wyrejestrowania. */
  onNeedRefresh(listener: () => void): () => void;
  /** Pierwsze pobranie zakończone — aplikacja działa offline. */
  onOfflineReady(listener: () => void): () => void;
  /** Postęp precache przy pierwszym uruchomieniu (jeśli dostępny). */
  onPreparationProgress(listener: (progress: PreparationProgress) => void): () => void;
  /** Błąd pobierania zasobów (np. przerwane połączenie przy pierwszym przygotowaniu). */
  onPreparationError(listener: (progress: PreparationProgress) => void): () => void;
  /**
   * Aktywuje oczekującą wersję i przeładowuje stronę. Implementacja z SW najpierw pyta kontroler
   * (`confirmUpdateSafe`) i bez potwierdzenia odrzuca obietnicę błędem `PwaError` (`UPDATE_NOT_SAFE`).
   */
  applyUpdate(): Promise<void>;
  /** Ręczne sprawdzenie aktualizacji / ponowienie przygotowania. */
  checkForUpdate(): Promise<void>;
}

/** Port bez Service Workera (tryb dev, testy, przeglądarki bez SW). */
export function createNoopPwa(): PwaPort {
  const noop = () => () => undefined;
  return {
    onNeedRefresh: noop,
    onOfflineReady: noop,
    onPreparationProgress: noop,
    onPreparationError: noop,
    applyUpdate: async () => undefined,
    checkForUpdate: async () => undefined,
  };
}
