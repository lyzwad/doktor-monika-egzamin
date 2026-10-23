/**
 * INTERFEJS KONTROLERA APLIKACJI (DECYZJE §1): komenda → domena → commit → dopiero po sukcesie
 * publikacja stanu jako trwałego. Błąd zapisu = stan „niezapisane” z ponowieniem tej samej komendy
 * (ten sam `commandId`), nigdy fałszywy sukces.
 *
 * Implementacje:
 * - rzeczywista (IndexedDB + domena) — agent integracji, np. src/app/appController.ts,
 * - `createMockController` (src/app/mockController.ts) — w pamięci, tylko dev (`?mock=1`) i testy UI.
 *
 * Wiązanie z React: `useSyncExternalStore(controller.subscribe, controller.getState)`
 * (gotowe hooki: src/app/ControllerContext.tsx).
 */
import type {
  BlockId,
  Catalog,
  HistoryFilter,
  IsoDateTime,
  OptionId,
  RuntimeBank,
  SessionId,
  SessionKind,
  SlotId,
  UserState,
} from '../domain/types';
import type { ExportedFile, Repository } from '../persistence/api';
import type { PwaPort } from '../pwa/api';
import type { HistoryTab, ReviewFilter, Route } from './routes';
import type {
  BootState,
  ConfigDraft,
  PreparationState,
  ResumeVM,
  SaveStatus,
  ScreenVM,
  StorageStatusVM,
  ToastVM,
  UpdateState,
} from './viewModels';

/**
 * Obserwowalny stan aplikacji. Niemutowalny: każda zmiana publikuje NOWY obiekt
 * (referencyjna równość = brak zmian, wymagane przez `useSyncExternalStore`).
 */
export interface AppState {
  boot: BootState;
  /** Bieżąca trasa (zsynchronizowana z `location.hash` przez warstwę app). */
  route: Route;
  /** Model widoku bieżącego ekranu; `null` podczas ładowania/błędu krytycznego. */
  screen: ScreenVM | null;
  /** Katalog pytań (bank + paczki); `null` przed wczytaniem. Do odczytu. */
  catalog: Catalog | null;
  /** Ostatni TRWALE zapisany stan użytkowniczki; `null` przed wczytaniem. Do odczytu. */
  userState: UserState | null;
  /** Otwarta sesja do wznowienia (karta „Kontynuuj”), także poza ekranem startowym. */
  resume: ResumeVM | null;
  save: SaveStatus;
  toast: ToastVM | null;
  /** `navigator.onLine` — banery offline; nauka nie wymaga sieci. */
  online: boolean;
  update: UpdateState;
  /** Pierwsze przygotowanie materiałów offline; `null` = nie dotyczy/ukończone. */
  preparation: PreparationState | null;
  storage: StorageStatusVM;
  appVersion: string;
}

/** Wynik akcji UI (błędy już odzwierciedlone w `AppState` — zwrot służy testom i fokusowi). */
export type ActionResult = { ok: true } | { ok: false; code: string; messagePl: string };

/**
 * Kontroler aplikacji: stan obserwowalny + akcje odpowiadające elementom ekranów Design.
 * Akcje asynchroniczne kończą się po zapisie (albo jego niepowodzeniu).
 * Akcje wywołane w niewłaściwym stanie (np. „Dalej” przed odpowiedzią) są ignorowane z `ok: false`.
 * Wszystkie metody muszą działać bez powiązania `this` (UI przekazuje je jako callbacki,
 * a `getState`/`subscribe` trafiają wprost do `useSyncExternalStore`).
 */
export interface AppController {
  /* ---------- Stan ---------- */
  getState(): AppState;
  /** Subskrypcja zmian stanu; zwraca funkcję wyrejestrowania. */
  subscribe(listener: () => void): () => void;
  /** Uruchomienie: otwarcie bazy, wczytanie banku i danych, wznowienie trasy z hasha. */
  start(): Promise<void>;
  /** Ponowienie po błędzie krytycznym uruchomienia. */
  retryBoot(): Promise<void>;
  dispose(): void;

  /* ---------- Nawigacja ---------- */
  /** Przejście do trasy (np. z `hashchange`). Trasy do nieistniejących sesji → start. */
  navigate(route: Route): void;
  /** „Wstecz” ekranu pomocniczego (PRZEKAZANIE §7). */
  goBack(): void;
  /** „Wróć do startu”. */
  goHome(): void;

  /* ---------- S01–S02 Start ---------- */
  /** „Kontynuuj” — otwiera przerwaną sesję na najdalszej pozycji. */
  resume(): void;
  /** Zamknięcie wskazówki instalacji (zapamiętane w ustawieniach). */
  dismissInstallHint(): Promise<ActionResult>;

  /* ---------- S03–S05 Konfiguracja ---------- */
  /** Karta „Free Flow” / „Test” na starcie. Szkic = ostatnia jawna konfiguracja albo domyślna. */
  openConfig(mode: SessionKind): void;
  /** Zmiana szkicu (zakres, trudność, pole N, ±10, szybkie wartości, „Moje błędy”, „Przejdź do zwykłego zakresu”). */
  updateConfigDraft(patch: Partial<ConfigDraft>): void;
  /** „Rozpocznij test” (zamyka przerwaną sesję jako niedokończoną/zakończoną). */
  startTest(): Promise<ActionResult>;
  /** „Rozpocznij” Free Flow. */
  startFreeFlow(): Promise<ActionResult>;

  /* ---------- S06–S15, S24 Pytanie ---------- */
  /** Pierwsze dotknięcie opcji — zapis próby (idempotentny); kolejne dotknięcia ignorowane. */
  answer(optionId: OptionId): Promise<ActionResult>;
  /** „Dalej” (Test: następna pozycja; Free Flow: dobór kolejnego pytania). */
  next(): Promise<ActionResult>;
  /** „‹” poprzednie pytanie (podgląd tylko do odczytu). */
  showPrevious(): void;
  /** „Do bieżącego” — powrót z podglądu na `reached`. */
  backToCurrent(): void;
  /** Flaga „Zgłoś błąd w pytaniu” na bieżącym widoku (pytanie, podgląd lub szczegół przeglądu). */
  report(): Promise<ActionResult>;
  /** „Cofnij” w toaście / „Cofnij zgłoszenie” przy braku zastępstwa. */
  undoReport(): Promise<ActionResult>;
  /** „Pokaż wynik” po ostatniej ocenionej pozycji testu. */
  showResult(): Promise<ActionResult>;
  /** „Kontynuuj później” — wyjście na start; sesja pozostaje otwarta. */
  pauseSession(): void;
  /** „Zamknij test bez wyniku” (arkusz przerwania, menu ⋮ na starcie, S24 brak zastępstwa). */
  closeUnfinished(sessionId?: SessionId): Promise<ActionResult>;
  /** „Zakończ sesję” Free Flow (arkusz wyjścia, menu ⋮, S24 pusta pula). */
  endFreeFlow(sessionId?: SessionId): Promise<ActionResult>;
  /** „Spróbuj zapisać ponownie” — powtarza tę samą komendę. */
  retrySave(): Promise<ActionResult>;
  /** Zamknięcie toastu (toast z „Cofnij” znika też przy następnej mutacji sesji). */
  dismissToast(): void;

  /* ---------- S16–S18 Wynik, przegląd, nowa runda ---------- */
  /** „Przejrzyj odpowiedzi” / „Przejrzyj błędy”. */
  openReview(sessionId: SessionId, filter?: ReviewFilter): void;
  /** Segmented „Wszystkie / Tylko błędy”. */
  setReviewFilter(filter: ReviewFilter): void;
  /** Szczegół pozycji przeglądu (tylko do odczytu). */
  openReviewItem(slotId: SlotId): void;
  /** „Rozpocznij rundę” w arkuszu „Uwzględnij błędy” / „Nowa runda”. */
  startRetryRound(sourceSessionId?: SessionId): Promise<ActionResult>;

  /* ---------- S19–S20 Historia ---------- */
  /** „Historia” na starcie / „Zobacz historię Free Flow”. */
  openHistory(tab?: HistoryTab): void;
  setHistoryTab(tab: HistoryTab): void;
  /** „Porównuj podobne testy” — filtr konfiguracji wykresu i listy. */
  setHistoryFilter(filter: HistoryFilter): void;
  /** Wybór punktu wykresu (`null` = odznacz). */
  selectChartPoint(sessionId: SessionId | null): void;
  /** Otwarcie wpisu historii (wynik testu / podsumowanie Free Flow). */
  openHistoryEntry(sessionId: SessionId): void;

  /* ---------- S21–S23 Ustawienia, kopia, import, wykluczone ---------- */
  openSettings(): void;
  openBackup(): void;
  openPoolImport(): void;
  openExcluded(): void;
  openAbout(): void;
  /** „Zapisz kopię” — buduje plik i przekazuje do zapisu (akcja użytkownika). */
  exportBackup(): Promise<ActionResult>;
  /** „Wybierz plik kopii” → sprawdzanie → podsumowanie do decyzji (dane jeszcze bez zmian). */
  selectBackupFile(file: Blob, fileName: string): Promise<ActionResult>;
  /** „Zabezpiecz bieżące dane i zastąp”. */
  confirmBackupReplace(): Promise<ActionResult>;
  /** „Anuluj — zostaw obecne dane”. */
  cancelBackupReplace(): void;
  /**
   * Pobranie automatycznej kopii bezpieczeństwa: bez argumentu — kopii właśnie utworzonej przy
   * wczytaniu (baner sukcesu), z `backupId` — dowolnej z listy kopii bezpieczeństwa (F03).
   */
  downloadSafetyBackup(backupId?: string): Promise<ActionResult>;
  /**
   * „Przywróć tę kopię” z listy automatycznych kopii bezpieczeństwa: sprawdza ją jak plik kopii
   * i przechodzi do tego samego podsumowania do decyzji (dane jeszcze bez zmian; zamiana dopiero
   * po „Zabezpiecz bieżące dane i zastąp”, z nową kopią bezpieczeństwa bieżącego stanu).
   */
  restoreSafetyBackup(backupId: string): Promise<ActionResult>;
  /** „Wybierz inny plik” po błędzie. */
  resetBackupFlow(): void;
  /** „Wybierz plik puli” → sprawdzanie → import albo lista niezgodności. */
  importPackFile(file: Blob, fileName: string): Promise<ActionResult>;
  resetPoolImportFlow(): void;
  /** „Przywróć” wykluczone pytanie (tylko przyszłe losowania). */
  restoreBlock(blockId: BlockId): Promise<ActionResult>;
  /** Prośba o trwałe przechowywanie danych (`navigator.storage.persist()`). */
  requestPersistentStorage(): Promise<ActionResult>;

  /* ---------- PWA (S24) ---------- */
  /** „Uruchom ponownie” na banerze aktualizacji — dopiero po zapisie stanu i poza ekranem pytania. */
  applyUpdate(): Promise<ActionResult>;
  /** „Spróbuj ponownie” przy przerwanym przygotowaniu materiałów. */
  retryPreparation(): Promise<ActionResult>;
}

/* ========================================================================== */
/* Zależności implementacji rzeczywistej (dla agenta integracji)              */
/* ========================================================================== */

/**
 * Usługi platformy wstrzykiwane do kontrolera (testowalne bez przeglądarki).
 * Jedyne miejsce, gdzie aplikacja czyta zegar i losowość (DECYZJE §3).
 */
export interface Platform {
  /** Bieżący czas ISO (UTC). */
  nowIso(): IsoDateTime;
  /** Początek następnego dnia kalendarzowego w Europe/Warsaw względem `nowIso`, jako ISO UTC. */
  nextDayStartIso(nowIso: IsoDateTime): IsoDateTime;
  /** `crypto.randomUUID()`. */
  randomId(): string;
  /** 32-bitowy seed z `crypto.getRandomValues`. */
  randomSeed(): number;
  /** Zapis pliku przez użytkowniczkę (pobranie / arkusz udostępniania). */
  saveFile(file: ExportedFile): Promise<void>;
  isOnline(): boolean;
  onOnlineChange(listener: (online: boolean) => void): () => void;
  /** Odczyt i zapis `location.hash`. */
  getHash(): string;
  setHash(hash: string, mode: 'push' | 'replace'): void;
  onHashChange(listener: (hash: string) => void): () => void;
}

export interface ControllerDeps {
  repository: Repository;
  /** Wczytanie `data/bank.json` (względnie do `import.meta.env.BASE_URL`; z precache offline). */
  loadBank(): Promise<RuntimeBank>;
  platform: Platform;
  pwa: PwaPort;
  appVersion: string;
}

export type CreateAppController = (deps: ControllerDeps) => AppController;
