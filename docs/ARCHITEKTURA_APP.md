# Doktor Monika Egzamin — architektura aplikacji

Stan: 24.10.2026 — **wyłącznie bank V15** (`docs/MIGRACJA_V15.md`); wcześniej 23.10.2026 etap **domknięcie na finalnej puli** (fundament → silnik → trwałość → UI → PWA → integracja → weryfikacja → poprawki → domknięcie). Ten dokument opisuje faktyczną strukturę kodu, kontrakty między warstwami, komendy i zasady testów. Wiążące decyzje funkcjonalne i polityki doboru są w `docs/DECYZJE_ARCHITEKTURY.md` — ten plik ich nie zmienia.

Co jest gotowe:

- Silnik domeny (`src/domain`), repozytorium IndexedDB z kopią danych i migracją treści do V15 (`src/persistence`; import pul wyłączony od 24.10.2026), ekrany S01–S24 (`src/ui`), Service Worker z aktualizacją na żądanie i przejęciem przy zmianie wersji treści (`src/pwa`, `scripts/sw-takeover.mjs`).
- **Rzeczywisty kontroler** `src/app/appController.ts` (`createAppController`) spinający domenę, IndexedDB i SW; platforma przeglądarki `src/app/platform.ts`; modele widoku `src/app/screenModels.ts`; punkt wejścia `src/main.tsx` uruchamia go w produkcji. Mock kontrolera działa wyłącznie w `npm run dev` z `?mock=1` i jest wycinany z buildu (kontrola: `scripts/check-dist.mjs`).
- Bank V15 `public/data/bank-37f3980a1129.json` (`chatgpt-editorial-v15-2026-10-24-f020a0440df8`, bajt w bajt z paczki redakcji): 2987 pytań (1048 / 1366 / 573), 2501 rodzin, 133 ID wyłączone (`retired-question-ids-83b36ff80986.json`), profil treningowy 35/25/40 (`training-profile-c0edd4ca07c2.json`), 2 pytania ze schematem (ANAT-Q001, DEV-Q041; figury `public/figures/*.svg` z paczki V15). Wersja i sumy: `src/domain/contentRelease.ts`. Liczby w UI są liczone z katalogu i sprawdzane względem `bank.counts` (`docs/RAPORT_PULI.md`). Dawny bank `release-2026-10-23c` usunięto.
- Testy: jednostkowe/integracyjne (Vitest: domain, persistence, app, pwa, ui, docs) i e2e (Playwright: WebKit „iPhone 15” 393×852 i Chromium mobile) na buildzie produkcyjnym pod katalogiem głównym `/` (jak na https://wiedza.doktormonika.pl/). Wyniki ostatniego przebiegu, środowisko i macierz kryteriów A01–G07: `docs/RAPORT_KONTROLI.md`.
- Nie wykonano: testu na fizycznym iPhonie 15 (G05 — NOT RUN). Publikacja wersji 0.1.0 na GitHub Pages: 23.10.2026; wersja z bankiem V15 wdrożona 24.10.2026; od 25.10.2026 pod https://wiedza.doktormonika.pl/ (`docs/RAPORT_KONTROLI.md` §7).

## 1. Stos i wersje

Wersje dobrane 22.10.2026 (`npm view`), przypięte dokładnie w `package.json` i `package-lock.json`. Node: `^22.22.2 || >=24.15.0` (`.nvmrc`: 24; sprawdzono na 24.18.1).

| Pakiet | Wersja | Rola |
|---|---|---|
| react, react-dom | 19.3.1 | UI |
| workbox-window | 7.4.1 | rejestracja SW (przez `virtual:pwa-register`) |
| @fontsource/hanken-grotesk | 5.3.0 | lokalne woff2 (OFL 1.1) |
| typescript | 7.0.2 | kontrola typów (`tsc`, wersja natywna) |
| vite | 8.3.5 | dev server, build |
| @vitejs/plugin-react | 6.1.2 | JSX/Fast Refresh |
| vite-plugin-pwa | 2.0.0 | manifest + Workbox `generateSW` |
| vitest | 5.0.5 | testy jednostkowe/integracyjne |
| jsdom | 30.1.3 | środowisko testów UI |
| fake-indexeddb | 6.2.6 | IndexedDB w testach Node |
| @testing-library/react, @testing-library/dom | 16.3.3, 10.4.2 | testy komponentów |
| @playwright/test | 1.63.0 | e2e (używa przeglądarek z cache: chromium-1243, webkit-2359) |
| @types/react, @types/react-dom, @types/node | 19.3.0, 19.3.0, 24.19.2 | typy |

Nowe zależności instaluje wyłącznie agent fundamentu. Inni agenci opisują potrzebę w raporcie.

## 2. Struktura katalogów i moduły

```
index.html                 lang=pl, viewport-fit=cover (bez blokady zoomu), theme-color, meta Apple
vite.config.ts             base = BASE_PATH ?? '/', plugin React, plugin PWA (manifest, Workbox generateSW, precache)
vitest.config.ts           projekty: domain, persistence, app, pwa, docs (node; fake-indexeddb tam, gdzie IndexedDB), ui (jsdom)
playwright.config.ts       e2e na buildzie produkcyjnym (scripts/serve-dist.mjs pod podścieżką), WebKit „iPhone 15” + Chromium mobile
tsconfig.*.json            domain (ES2023, BEZ DOM i Node), app (DOM), test (DOM + Node), node (konfiguracje, e2e)
public/data/               WYŁĄCZNIE bank V15: bank-<sha12>.json (dme-runtime-bank v1), retired-question-ids-<sha12>.json,
                           training-profile-<sha12>.json — z paczki redakcji, nie edytować (build sprawdza SHA-256)
public/figures/*.svg       schematy (wersja pytania -p i objaśnienia -o) — generowane w redakcji, w precache
public/icons/              ikony PWA (autorski znak „DM”, scripts/generate-icons.mjs)
scripts/                   check-dist.mjs (kontrola dist i treści V15), check-offline.mjs (SW w przeglądarkach), serve-dist.mjs (serwer jak GitHub Pages
                           + haki testów), sw-takeover.mjs (skrypt przejęcia SW przy zmianie wersji treści), v15-carryover.mjs (lista
                           niezmienionych pytań: ID + fingerprint), generate-icons.mjs
src/main.tsx               punkt wejścia: rzeczywisty kontroler + AppRoot (w dev z ?mock=1 — mock)
src/domain/                czysty silnik (bez DOM/IndexedDB/zegara/losowości):
                           api.ts (kontrakt i delegacja), types.ts, catalog.ts (parseRuntimeBank, buildCatalog, bankSummaryOf,
                           checkRuntimeQuestion), pool.ts (pula, pojemność = rodziny, walidacja N), sessions.ts (start testu,
                           Free Flow, runda „Uwzględnij błędy”, odpowiedź, dalej, wynik, zamknięcia), testPolicy.ts (TEST_POLICY_V2),
                           freeFlowPolicy.ts (FREE_FLOW_POLICY_V2), report.ts (zgłoszenia, zastępstwa, cofnięcie, blokady),
                           review.ts (REVIEW_POLICY_V1), selectors.ts (historia, wykres, przegląd, podgląd rundy), scoring.ts,
                           settings.ts, snapshot.ts, seen.ts, state.ts, tx.ts (changeset), rng.ts (mulberry32), fingerprint.ts, util.ts
src/persistence/           api.ts (kontrakt), repository.ts (createIndexedDbRepository), idb.ts + schema.ts (migracje; v2 = treść V15),
                           v15Migration.ts (transformToV15 — migracja, import i eksport kopii), v15Carryover.ts (332 niezmienione:
                           ID + fingerprint, wygenerowane), backup.ts (eksport/walidacja/zamiana kopii, kopie bezpieczeństwa),
                           validation.ts, storage.ts (persist/estimate), errors.ts (PersistenceError z komunikatem PL)
src/app/                   controller.ts (interfejs), appController.ts (implementacja), screenModels.ts (VM z domeny),
                           viewModels.ts, routes.ts, platform.ts (zegar, UUID, seed, pobieranie pliku, Europe/Warsaw),
                           appVersion.ts, ControllerContext.tsx, mockController.ts (tylko dev/testy UI)
src/ui/                    App.tsx, router.ts, format.ts (teksty PL i liczebniki), hooks.ts (pułapka fokusu, łagodne przewinięcie),
                           components/ (AnswerCard, Banner, Controls, ExplanationPanel, Figure + ZoomViewer, HistoryChart, Icon,
                           NumberStepper, QuestionChrome, Screen, Sheet), screens/ (Home, Config, Question, Result, Review,
                           RetrySheet, FreeFlowSummary, History, Settings/About/Excluded, Data (kopia, import puli), System, Loading),
                           styles/ (tokens, fonts, base, components), icons.ts
src/pwa/                   api.ts (port PwaPort), registerSW.ts, swController.ts (przygotowanie offline, aktualizacja), updateGuard.ts
tests/domain|persistence|app|pwa|ui|docs|e2e
```

## 3. Odpowiedzialność warstw i pliki kontraktów

| Warstwa | Katalogi | Zasada |
|---|---|---|
| Domena | `src/domain/**`, `tests/domain/**` | Jedyne miejsce punktacji, doboru, powtórek i blokad. Zmiana mulberry32/fingerprintu zmienia odtwarzalność zapisanych sesji — tylko jako nowa wersja polityki. |
| Trwałość | `src/persistence/**`, `tests/persistence/**` | IndexedDB, kopia danych, import pul (jeden walidator: `packs.ts`). |
| Kontroler | `src/app/**`, `src/main.tsx`, `tests/app/**` | Komenda → domena → commit → publikacja; modele widoku. |
| UI | `src/ui/**`, `tests/ui/**` | Renderuje wyłącznie modele widoku; teksty PL z Design (`format.ts`, ekrany). |
| PWA | `src/pwa/**`, część PWA w `vite.config.ts`, `public/icons/**`, `.github/workflows/**`, `docs/WDROZENIE.md` | Rejestracja SW przez `virtual:pwa-register`, aktualizacja na żądanie. |
| Dane | `public/data/*` (wyłącznie bank V15 i pliki towarzyszące), `public/figures/**` | Z paczki redakcji V15 bajt w bajt; aplikacja ich nie modyfikuje (build i `check-dist` sprawdzają SHA-256). |

Pliki kontraktów — `src/domain/types.ts`, sygnatury w `src/domain/api.ts`, `src/persistence/api.ts`, `src/app/controller.ts`, `src/app/viewModels.ts`, `src/app/routes.ts`, `src/pwa/api.ts` — są wspólne. Zmiany w nich: tylko addytywne albo opisane w tym dokumencie. `npm run typecheck` musi przechodzić po każdej zmianie.

## 4. Kontrakty i przepływ komendy

### 4.1 Domena (`src/domain`)

- Bez React, DOM, IndexedDB, `Date.now()`, `Math.random()`, `crypto.randomUUID`. Wymusza to `tsconfig.domain.json` (brak lib DOM i typów Node) oraz test `tests/domain/czystosc.test.ts`.
- Komenda: `(state: UserState, catalog, input, ctx: CommandContext) → CommandResult<DomainOutcome<V>>`. `DomainOutcome = { state, changeset, events, value }`. Wejściowy stan pozostaje niezmieniony.
- `CommandContext = { now, nextDayStart, commandId, newId }` — czas, początek następnego dnia w Europe/Warsaw (liczy kontroler) i generator identyfikatorów (w aplikacji `crypto.randomUUID()`, w testach licznik). Seed sesji (32 bit) przychodzi w `input`.
- `Changeset = { commandId, guards, stores: { [magazyn]: { put: [], delete: [] } } }`. `guards` = oczekiwana `revision` sesji, sprawdzana w tej samej transakcji (ochrona przed równoległą zmianą, np. z innej karty).
- Idempotencja: `answer` z tym samym `ctx.commandId` zwraca `replayed: true` i pusty changeset.
- Cofnięcie zgłoszenia: `UndoToken` (z `ReportCheckpoint`) trzyma kontroler w pamięci; ważny, dopóki `session.mutationSeq` się nie zmieni (`isUndoValid`).
- Selektory (bez changesetu): `poolFor`, `capacityFor`, `validateTestN`, `sessionProgress`, `summarizeSession`, `reviewItems`, `summarizeHistory`, `chartPoints`, `previewRetryRound`, `activeSession`, `activeBlocks`.
- Parametry polityk (`policies.ts`) to wartości z DECYZJE §4–§8; zmiana = nowa wersja polityki.
- Runda z „Uwzględnij błędy”/„Nowa runda” zawsze zapisuje `retry = { sourceSessionId, retryChainId, roundIndex, repeatedCount }` (SPECYFIKACJA §6: parent i numer w łańcuchu); oznaczenie „Powtórka”/◆ tylko przy `repeatedCount > 0` (D02, DECYZJE §13).
- Katalog niesie `bankSummary` (`bankSummaryOf`): liczby WBUDOWANEJ puli policzone z pytań katalogu (pytania, rodziny, domeny, poziomy, schematy, `independently_checked_draft`) + `pool_note_pl`/`family_merges_note_pl` z banku; rozbieżność z `bank.counts` → `catalog.issues` (`COUNTS_MISMATCH`), a UI pokazuje liczby policzone.

### 4.2 Trwałość (`src/persistence`)

- `Repository`: `open`, `loadUserState`, `commit(changeset)` (JEDNA transakcja readwrite + `guards`), `exportBackup`, `parseAndValidateBackup(Blob|string)`, `replaceAllFromBackup` (automatyczna kopia do `backups` i zamiana w jednej transakcji), `listBackups`, `getBackupFile`, `importPack`, `listPacks`, `storage` (persist/estimate), `close`.
- Magazyny i klucze główne: `STORE_NAMES`, `STORE_KEY_PATHS` (`questionStats` po `questionId`, pozostałe po `id`, `meta` po `key`). Wartości boolean nie są kluczami IndexedDB — indeks kolejki błędów opierać na `dueAt`.
- Błędy: `PersistenceError` (`QuotaExceeded`, `WriteFailed`, `Conflict`, `InvalidBackup` z `reasonsPl`, `UnsupportedBackupVersion`, `BackupTooLarge`, `Unavailable`, `Blocked`, `MigrationFailed`, `NotFound`) z komunikatem PL.
- Kopia: `BackupFileV1` (`dme-backup`, `formatVersion: 1`, `appId`, `exportedAt`, `appVersion`, `bankVersions`, `data` = tablice rekordów magazynów; `packs` zawsze puste od V15, paczki starszych kopii odrzucane; eksport i import przechodzą `transformToV15`). Limit importu 25 MB. Zawartość (`BACKUP_DATA_STORES`): ustawienia, sesje ZE SNAPSHOTAMI PYTAŃ (treść, warianty, klucz, wyjaśnienie), próby, stan powtórek, blokady, zdarzenia, bez zaimportowanych pul i bez wbudowanego banku (opis na ekranie: F02); sesje sprzed V15 tylko jako podsumowania.
- Pule pytań: od 24.10.2026 import WYŁĄCZONY (`packs.ts` usunięty, brak `importPack`/`listPacks`; katalog = wyłącznie bank V15). Magazyn `packs` zostaje pusty; paczki w starszych kopiach są odrzucane przy wczytaniu.
- Schemat v2 (`createMigrationV2`): transformacja danych do V15 w transakcji `versionchange` (`transformToV15`), `meta.content` = V15, rekord `migration:bank-v15`; `setUpgradeListener` (komunikat „Aktualizacja banku pytań…”), `readContentMeta`. `commit` odrzuca sesję innej wersji treści, która nie jest `legacy` (`MSG_STALE_CONTENT_WRITE`).

### 4.3 Kontroler (`src/app`)

- `AppController`: `getState()` + `subscribe()` (dla `useSyncExternalStore`, hooki w `ControllerContext.tsx`) oraz metody akcji wszystkich ekranów Design (start, konfiguracja, odpowiedź, dalej, poprzednie/do bieżącego, zgłoś, cofnij, pokaż wynik, kontynuuj później, zamknij bez wyniku, zakończ Free Flow, nowa runda, przegląd z filtrem, historia, ustawienia, kopia, import puli, przywróć blokadę, wskazówka instalacji, aktualizacja, ponowienie zapisu).
- `AppState`: `boot`, `route`, `screen` (model widoku bieżącego ekranu), `catalog`, `userState` (tylko TRWALE zapisany), `resume`, `save` (`idle | saving | error` z ponowieniem), `toast` (z „Cofnij”), `online`, `update`, `preparation`, `storage`, `appVersion`.
- Przepływ komendy (DECYZJE §1):
  1. kontroler tworzy `commandId`, `ctx` (czas z `Platform`), ewentualnie seed;
  2. wywołuje funkcję domeny na bieżącym `userState`; błąd domeny → komunikat, bez zapisu;
  3. `repository.commit(changeset)`; w trakcie `save.status = 'saving'` (odpowiedź widoczna jako `pending`);
  4. sukces → publikacja nowego `userState` i VM; porażka → `save.status = 'error'`, stan trwały bez zmian, „Spróbuj zapisać ponownie” ponawia ten sam changeset/komendę z tym samym `commandId`;
  5. `markShown` przy pierwszym pokazaniu slotu (nie unieważnia „Cofnij”); prośba `navigator.storage.persist()` po pierwszej zapisanej odpowiedzi.
- Modele widoku (`viewModels.ts`): UI renderuje tylko je. Przed odpowiedzią `QuestionVM` nie zawiera klucza, wyjaśnienia, źródeł ani figury objaśnienia (B04). Teksty UI (z Design) mapuje UI; VM niesie dane i klucze (`ToastKind`, kody walidacji `NValidation`).
- Routing hash (`routes.ts`): `#/`, `#/test`, `#/free-flow`, `#/sesja/<id>`, `#/wynik/<id>`, `#/przeglad/<id>[/<slot>]?filtr=bledy`, `#/podsumowanie/<id>`, `#/historia[/free-flow]`, `#/ustawienia[/kopia|/import-puli|/wykluczone|/o-bazie]`. Nieznany hash → start.
- Zależności rzeczywistego kontrolera: `ControllerDeps = { repository, loadBank, platform: Platform, pwa: PwaPort, appVersion }`. `Platform` jest jedynym miejscem odczytu zegara i losowości.

### 4.3a Implementacja kontrolera (`src/app/appController.ts`)

- **Uruchomienie** (`start`): `repository.open()` (migracja do V15 przy pierwszym starcie: etap `migrating`) → `loadBank()` (`src/app/contentLoader.ts`: trzy pliki V15 z `CONTENT_RELEASE`, SHA-256 bajtów banku; offline z precache SW) → asercja treści (SHA-256, wersje, liczby 2987/1048/1366/573, 133 wyłączone) → `loadUserState()` → `buildCatalog(bank, { retiredQuestionIds, profile, requiredBankVersion })` → sprawdzenie `dme-release.json` (nowsza wersja treści → etap `content-update` i przeładowanie) → trasa z `location.hash`. Błędy → `boot.phase = 'fatal'` z komunikatem PL i „Spróbuj ponownie”: brak IndexedDB / odmowa zapisu (`STORAGE_UNAVAILABLE` — z wyjaśnieniem, że nauka bez zapisu na urządzeniu nie jest możliwa), niedostępny bank (`BANK_UNAVAILABLE`), uszkodzony albo inny niż V15 bank (`BANK_INVALID`), migracja (`MIGRATION_FAILED` — „Aktualizacja danych nie powiodła się”, `MIGRATION_BLOCKED` — „Aktualizacja danych czeka”), nowsza wersja treści nieprzejęta w 60 s (`CONTENT_UPDATE_FAILED`).
- **Kolejka komend**: każda komenda zapisująca wykonuje się po poprzedniej (żadna nie liczy się na nieaktualnym stanie). `commandId`, `now`, `nextDayStart` (Europe/Warsaw, `nextDayStartInZone`) i identyfikatory z `Platform`; seed sesji losowany raz przed komendą.
- **Zapis przed publikacją**: `userState` w `AppState` to zawsze stan po udanym `commit`. W trakcie — `save.status = 'saving'` (karta odpowiedzi `pending`). Błąd (np. `QuotaExceeded`) → `save.status = 'error'`, stan trwały bez zmian, „Spróbuj zapisać ponownie” wysyła **ten sam changeset z tym samym `commandId`**; do tego czasu kolejne komendy zapisujące są odrzucane (`UNSAVED_PENDING`). `Conflict` (np. zmiana w innej karcie) → ponowne wczytanie danych z bazy i komunikat, bez fałszywego sukcesu.
- **Zapisy w tle**: `markShown` przy pierwszym pokazaniu slotu (bez stanu „zapisywanie”, nie unieważnia „Cofnij”); po pierwszej zapisanej odpowiedzi `navigator.storage.persist()` i znacznik `persistRequestedAt` w ustawieniach.
- **„Cofnij”**: token domeny w pamięci; wygasa przy każdej mutacji punktowej (odpowiedź, kolejne zgłoszenie, zamknięcie) oraz przy „Kontynuuj później”.
- **Podwójne dotknięcia**: odpowiedź — blokada w `AnswerList` + `pendingAnswer`, a także `BUSY`, gdy inna komenda użytkownika (np. zgłoszenie) jest w toku (LOG-05); „Dalej”, „Pokaż wynik”, zgłoszenie, „Cofnij” — ignorowane, gdy komenda użytkownika jest w toku (`BUSY`); start testu/Free Flow/rundy — flaga `starting` (LOG-06: także `startRetryRound`); „Zakończ sesję” i „Zamknij test bez wyniku” — blokada na czas zamykania danej sesji (LOG-06, `BUSY` bez komunikatu).
- **Komunikat błędu a „Cofnij”** (LOG-05): błąd akcji przy widocznym toaście z WAŻNYM „Cofnij” nie zastępuje toastu — trafia do `ToastVM.alertPl` (w UI osobny `role="alert"` nad toastem).
- **Trasy**: `location.hash` przez `Platform` (`pushState` dla zmian w aplikacji, `replaceState` dla przekierowań); nieważna trasa (np. zamknięta sesja) → start.
- **PWA**: `onNeedRefresh` → `update.available`; `canApplyNow` = `isUpdateSafe` (poza ekranem pytania, nic nie czeka na zapis); `applyUpdate` przez port PWA; toast „Aplikacja zaktualizowana…” po przeładowaniu (`consumeUpdatedFlag`). `onPreparationProgress/Error`, `onOfflineReady` → `preparation`.
- **Kopia**: eksport (`repository.exportBackup` → `Platform.saveFile`, pobranie pliku `<a download>`; aplikacja nie dostaje potwierdzenia zapisu, więc komunikat brzmi „Przygotowano plik kopii … — sprawdź, czy zapisał się w Plikach (Pobrane)”, LOG-08), wybór pliku → walidacja bez zmian danych → podsumowanie → zamiana z automatyczną kopią bezpieczeństwa → ponowne wczytanie danych; błąd = dane bez zmian. Lista automatycznych kopii bezpieczeństwa (`repository.listBackups`) na ekranie „Kopia danych” z „Pobierz” (`downloadSafetyBackup(id)`) i „Przywróć” (`restoreSafetyBackup(id)` → ta sama walidacja i decyzja co plik). Przy niezapisanej zmianie wczytanie kopii jest odrzucane (DECYZJE §1).
- **Import puli**: wyłączony — `importPackFile` zwraca `PACKS_DISABLED` z komunikatem „Aplikacja używa wyłącznie banku pytań V15…”; ekran „Pula pytań” wyjaśnia to bez wyboru pliku.
- **Sesje sprzed V15** (`session.legacy`): wynik i historia z liczb zapisanych w migracji; przegląd bez listy pytań (komunikat o niedostępnej treści), bez rundy błędów (`LEGACY_SESSION`); `interrupted_by_update` — w historii, poza wykresem, niewznawialna.
- **Pozycje czekające na zastępstwo**: ponowna próba obsadzenia po imporcie puli, „Przywróć”, po każdym uruchomieniu (np. nowy bank po aktualizacji) i przy „Kontynuuj” (dwie ostatnie w tle). `QuestionVM.awaitingElsewhere` + akcja `go-awaiting` („Przejdź do pytania k”) na ocenionej ostatniej pozycji; `ResumeVM.awaitingCount` na karcie „Kontynuuj”.
- Dodane addytywnie do kontraktu: `ToastKind` `reported_excluded` (Free Flow: wykluczenie wcześniejszej pozycji) i `action_failed` (`params.messagePl` — akcja odrzucona bez zapisu).

### 4.4 Mock kontrolera

`src/app/mockController.ts` — kontroler w pamięci z uproszczoną logiką, na prawdziwym banku, bez danych demonstracyjnych. Ładowany tylko:

- w `npm run dev` z `?mock=1` (dynamiczny import pod `import.meta.env.DEV`, wycinany z buildu — sprawdzone: brak mocka w `dist`); dostępny w konsoli jako `window.__dmeMock`,
- w testach UI: `createMockController({ bank, seed, now })`.

`simulate({ saveFailure, offline, updateAvailable, preparation, installHint })` pozwala oglądać stany S24 i banery. Uproszczenia mocka (bez kwot domen, uproszczona kolejka błędów) nie są wzorcem dla silnika.

### 4.5 PWA

`vite.config.ts`: `registerType: 'prompt'`, `injectRegister: false`, w `sw.js` bez `skipWaiting`/`clientsClaim`; `importScripts: ['dme-sw-takeover-<sha12>.js']` — przejęcie stron tylko przy zmianie wersji treści (DECYZJE §11); `dme-release.json` (poza precache) i kontrola `public/data` (SHA-256) w pluginie `dme-content-release`; manifest (`name` i `short_name`: `Doktor Monika Egzamin`, `lang: pl`, `standalone`, `#FAFBFC`, `start_url`/`scope` = `.`), precache: shell, JS/CSS, woff2, trzy pliki banku V15, SVG (w tym każda figura z `bank.figures` — kontroluje `check-dist.mjs`); limit pliku w precache 16 MB (docelowy bank). Build pod `BASE_PATH=/doktor-monika-egzamin/` daje poprawne ścieżki (sprawdzone e2e).

## 5. Styl, typografia, ikony

- `src/ui/styles/tokens.css` — tokeny z PRZEKAZANIE §4 bez zmian + odstępy, `--gutter` (20 px, 16 px do 340 px), kolumna 560 px, skala typografii w `rem` (1rem = 17 px; każdy tekst ≥ 16 px, wyjątek 13 px tylko oś/daty wykresu — DECYZJE §12), safe-area. `color-scheme: light` także przy ciemnym motywie systemu.
- `src/ui/styles/base.css` — `html { font: -apple-system-body; font-family: var(--font) }` ograniczone do iOS (`@supports (-webkit-touch-callout: none)`), bo w Safari na macOS ten krój systemowy ma 13 px; poza iOS baza 17 px. Bez blokady zoomu. Klasy pomocnicze: `.screen-column`, `.screen-top`, `.screen-bottom`, `.tabular-nums`, `.visually-hidden`; `prefers-reduced-motion`.
- `src/ui/styles/fonts.css` — Hanken Grotesk 400/500/600/700, latin + latin-ext, tylko woff2 z `@fontsource/hanken-grotesk`, `font-display: swap`.
- `src/ui/icons.ts` — 33 ikony z `_zrodla/design/assets/ikony.json` (Material Icons, Apache 2.0); `src/ui/components/Icon.tsx` — inline SVG, `currentColor`, dekoracyjna bez `label`.
- Kolejność importu stylów: `fonts.css`, `tokens.css`, `base.css` (w `main.tsx`).

## 6. Komendy

| Komenda | Działanie |
|---|---|
| `npm install` | instalacja z lockfile (`npm ci` w CI) |
| `npm run dev` | serwer deweloperski (`?mock=1` — mock kontrolera) |
| `npm run typecheck` | `tsc` dla domain, app, test, node |
| `npm test` | Vitest: domain + persistence + app + pwa + ui + docs (na obciążonej maszynie: `npx vitest run --maxWorkers=2`) |
| `npm run test:watch` | Vitest w trybie obserwacji |
| `npm run build` | typecheck + `vite build` (+ SW i manifest) do `dist/` |
| `BASE_PATH=/<repo>/ npm run build` | build pod podścieżkę (GitHub Pages) |
| `npm run preview` | podgląd `dist/` (narzędzie lokalne, nie serwer produkcyjny) |
| `npm run test:e2e` | Playwright: build z `BASE_PATH=/` + `scripts/serve-dist.mjs` (jak GitHub Pages) + WebKit „iPhone 15” 393×852 i Chromium mobile; zrzuty kluczowych stanów → `docs/zrzuty/` (WebKit). `E2E_SKIP_BUILD=1` — użyj istniejącego `dist` |
| `node scripts/check-dist.mjs --base /` | statyczna kontrola `dist` (precache — w tym każda figura z `bank.figures`, manifest, brak hostów zewnętrznych i mocka) |
| `node scripts/check-offline.mjs --base /` | Service Worker w Chromium i WebKit: precache, start offline, aktualizacja, przerwane przygotowanie |

## 7. Zasady testów

- Projekty Vitest: `tests/domain/**/*.test.ts` (node), `tests/persistence/**/*.test.ts` (node, `fake-indexeddb/auto` w setup), `tests/app/**/*.test.ts` (rzeczywisty kontroler na fake-indexeddb i prawdziwym banku, node), `tests/pwa/**/*.test.ts` (logika SW na atrapach, node), `tests/ui/**/*.test.{ts,tsx}` (jsdom), `tests/docs/**/*.test.ts` (node: zgodność `docs/RAPORT_KONTROLI.md` z repozytorium i `bank.json` — G07). E2E: `tests/e2e/**/*.spec.ts`.
- E2E nie czyta klucza z UI (B04): pytanie rozpoznawane po treści, klucz z pliku banku V15 na dysku; audyt zapisu przez odczyt IndexedDB w stronie.
- Treść V15 w testach: `tests/content.ts` (te same pliki i ścieżki co aplikacja, `v15Catalog()`); migracja: `tests/persistence/migracja-v15.test.ts`, `tests/app/migracja-v15.test.ts`; wyłączone ID: `tests/domain/wylaczone-v15.test.ts`; SW: `tests/pwa/tresc-v15.test.ts`; e2e aktualizacji ze starej aplikacji (tag `v0.1.0-pages`): `tests/e2e/aktualizacja-v15.spec.ts`.
- W testach domeny: jawny stan, stały `now`, licznikowy `newId`, stały seed — wyniki deterministyczne. Kryteria odbioru (C04, B02 — 24 permutacje, D01–D07, E01–E06) jako testy parametryczne.
- Test czystości domeny i test zgodności fingerprintu z bankiem muszą przechodzić.
- W środowisku jsdom `import.meta.url` nie jest adresem `file:` — pliki projektu czytać przez `resolve(process.cwd(), …)`.
- Testy persystencji: unikalna nazwa bazy na test (`RepositoryOptions.dbName`), sprawdzanie atomowości (błąd w środku = brak częściowego zapisu), mapowanie `QuotaExceededError`.
- Testy e2e nie zastępują testu na fizycznym iPhonie 15 (G05) — taki test raportować jako NOT RUN, dopóki nie zostanie wykonany na urządzeniu.
- Regresje zgłoszeń weryfikacji: `tests/app/regresje-weryfikacji.test.ts`, `tests/app/regresje-p3.test.ts` (D02, LOG-05, LOG-06, LOG-08, C01 i stan puli na rzeczywistym kontrolerze), `tests/ui/regresje-weryfikacji.test.tsx`, `tests/ui/regresje-p3.test.tsx` (UI-03, UI-04, F02, LOG-08, LOG-05, „O bazie”/ustawienia).
- Wydajność na finalnym banku: `tests/app/wydajnosc.test.ts` — czas ściany i CPU (minimum z 5) dla wczytania + walidacji + katalogu, startu testu 60/mieszany/cały zakres i modeli widoku; cel ≤ ~200 ms na laptopie, asercja na czasie CPU z zapasem (maszyny testowe bywają przeciążone).

### 7.1 Pokrycie e2e (`tests/e2e`, każdy test w WebKit „iPhone 15” i Chromium mobile)

| Plik | Zakres |
|---|---|
| `flow-a.spec.ts` | A: Test 20 → błędna odpowiedź → komentarz → „Dalej” … → „Pokaż wynik” (16/20) → „Przejrzyj błędy” (tylko błędy) → szczegół; B04 (brak klucza, wyjaśnienia, źródeł, lokatora i oznaczeń poprawności w DOM i atrybutach przed odpowiedzią), B05, B06 (źródło po odpowiedzi), A04; zrzuty 01–05 |
| `flows.spec.ts` | B: „Uwzględnij błędy” → runda 2 („Powtórka · runda 2”, „Z poprzedniej rundy”), ◆ na wykresie; C: Free Flow z zakończeniem i podsumowaniem; D: zgłoszenie z zastępstwem, „Cofnij”, wygaśnięcie po odpowiedzi, „Przywróć”; E/F01: przeładowanie strony → to samo pytanie i kolejność opcji, „Kontynuuj”, zamknięcie bez wyniku → „Niedokończony” poza wykresem; F: eksport (pobranie), import (`setInputFiles`) z podsumowaniem i zamianą, uszkodzony plik → błąd bez zmian; zrzuty 06–09 |
| `flows-extra.spec.ts` | E04 (zgłoszenie w przeglądzie zamkniętego testu), nowa sesja przy przerwanym teście (PRZEKAZANIE §8), D06 (Free Flow z „Moje błędy” i jednorazowa informacja po ich wyczerpaniu) |
| `interactions.spec.ts` | B03 (drugi szybki tap, dwuklik, podgląd i restart bez dopisywania prób), C01 (walidacja N w UI, działania naprawcze, ±10, szybkie wartości) |
| `integration.spec.ts` | `markShown` przed odpowiedzią; błąd zapisu (`QuotaExceededError` w IndexedDB przeglądarki) bez fałszywego sukcesu i ponowienie tej samej komendy (ten sam `commandId`); `navigator.storage.persist()` raz, po pierwszej zapisanej odpowiedzi; G03 na **dwóch rzeczywistych buildach** (`APP_BUILD_ID=e2e-v2` → `test-results/dist-v2-<projekt>`): nieudane pobranie nowej wersji zostawia starą, udane czeka bez przeładowania pytania, baner poza pytaniem, po „Uruchom ponownie” nowa wersja z sesją, także bez sieci |
| `pwa.spec.ts` | G02 offline (`context.setOffline` — Chromium; „serwer niedostępny” — obie przeglądarki), A04, G03 (zmieniony `sw.js`) |
| `layout.spec.ts` | G06: brak poziomego przewijania przy 320/393 px i 100/200% tekstu, każdy widoczny tekst ≥ 16 px na głównych ekranach (wyjątek: oś/daty wykresu), touch-targety ≥ 44 px; Ustawienia i Kopia danych przy 320/393/430 px i 150/200% tekstu bez łamania słów w środku (PRZEKAZANIE §9); G01 (odświeżenie ekranu pomocniczego pod podścieżką) |
| `dostepnosc.spec.ts` | PRZEKAZANIE §13: pułapka fokusu w arkuszach (Tab/Shift+Tab nie wychodzą do tła także w WebKit, Escape zamyka, fokus wraca); E03: brak zastępstwa wcześniejszej pozycji → „Przejdź do pytania 1” zamiast martwego ekranu, baner S24g, liczba oczekujących na karcie „Kontynuuj” (koszyk domena × poziom o najmniejszej liczbie rodzin — w banku V15 INJ/zaawansowany, 45 rodzin; test pomijany dopiero powyżej 60 rodzin) |
| `aktualizacja-v15.spec.ts` | aktualizacja z prawdziwej starej aplikacji (tag `v0.1.0-pages`, build do `test-results/`) do V15 pod tym samym adresem: dane przez UI, przejęcie otwartych kart przez nowy SW (bez ręcznego przeładowania), migracja v1 → v2, historia bez treści, przerwana sesja, brak starej treści w IndexedDB i Cache Storage, `data/bank.json` → 404, nowe sesje tylko V15, offline; przerwanie aktualizacji (zamknięcie karty) i ponowne otwarcie |
| `system.spec.ts` | brak IndexedDB oraz odmowa otwarcia bazy (tryb prywatny) → komunikat, nauka bez zapisu niedostępna, „Spróbuj ponownie” |
| `smoke.spec.ts` | metadane PWA, manifest, bank, lokalny font z polskimi znakami, jasny motyw przy ciemnym systemie |
| `schematy.spec.ts` | schematy na prawdziwych danych banku V15 (ANAT-Q001, DEV-Q041): przed odpowiedzią tylko wersja pytania (P) bez słów zdradzających klucz (alt, podpis, etykieta, nazwa pliku, tekst SVG; porównanie z kluczem i wersją O), brak O i wyjaśnienia w DOM; powiększenie 100–300%, „Dopasuj”, „Opis tekstowy”, „Zamknij”, powrót fokusu; po odpowiedzi wersja O w wyjaśnieniu; figury w precache i offline (serwer niedostępny). Pytanie ze schematem osiągane deterministycznie: seed sesji liczony w Node tym samym silnikiem i podstawiony w `crypto.getRandomValues` skryptem testowym — bez zmian logiki doboru |
| `dostepnosc.spec.ts` (UI-03) | odpowiedź wybrana klawiaturą (Enter) → fokus na nagłówku „Dlaczego ta odpowiedź jest poprawna”, nie na `<body>` |

`scripts/serve-dist.mjs` ma haki dla testów: `transformSw`, `fail`, `offline` i `dist` (podmiana katalogu buildu pod tym samym adresem — „wdrożenie” nowej wersji).
- Bez fałszywych liczników i danych demonstracyjnych w kodzie produkcyjnym; liczba pytań zawsze z pliku banku.

## 8. Znane kwestie (stan po domknięciu)

1. ~~**Fingerprint w `bank.json`** liczony z tekstu sprzed poprawek odstępów (SAFE-Q014, SAFE-Q025, SAFE-Q031)~~ — w banku `release-2026-10-23c` test fingerprintów obejmuje wszystkie 1097 pytań i nie zgłasza niewyjaśnionych rozbieżności (przebieg 23.10.2026). Test `tests/domain/fingerprint.test.ts` nadal toleruje wyłącznie rozbieżności wyjaśnione dawnymi `DISPLAY_FIXES`; walidator pul porównuje treść po tekście, nie tylko po zapisanym fingerprincie.
2. `normalizeText` odwzorowuje Pythonowe `casefold()` przez `toLowerCase()` + ß→ss, ς→σ; pozostałe różnice dotyczą rzadkich znaków (greckie z diakrytykami). Zgodność potwierdzona na całym banku i przypadkach referencyjnych.
3. Web Crypto (`crypto.subtle`) i `crypto.randomUUID()` wymagają bezpiecznego kontekstu: test na telefonie przez `http://<IP>:5173` nie zadziała — używać https (np. podgląd wdrożenia) albo localhost.
4. Ikony PWA: autorski znak „DM” rasteryzowany skryptem `scripts/generate-icons.mjs` — wygląd na ekranie głównym iPhone’a do oceny na urządzeniu (G05).
5. Dynamic Type przez `-apple-system-body` wymaga sprawdzenia na fizycznym iPhonie.
6. `npm install` zgłasza ostrzeżenie o przestarzałym `glob@11.1.0` (zależność build-time `workbox-build`) oraz nieuruchomiony skrypt instalacyjny opcjonalnego `fsevents` (polityka allow-scripts npm 11) — bez wpływu na aplikację; `npm audit`: 0 podatności.
7. Playwright WebKit (2359): `context.setOffline(true)` blokuje każdą nawigację, także obsługiwaną przez Service Workera („WebKit encountered an internal error”). Test offline z `setOffline` działa w Chromium; w WebKit tę samą ścieżkę sprawdza test „serwer niedostępny” (serwer zrywa połączenia) oraz `scripts/check-offline.mjs`. Tryb samolotowy na iPhonie — G05.
8. ~~TEST_POLICY_V1 wybiera „najpierw niewidziane” w obrębie koszyka domena × poziom~~ — rozwiązane 23.10.2026: TEST_POLICY_V2 (DECYZJE §6) stosuje „najpierw niewidziane” w całym wybranym zakresie (test regresji na prawdziwym banku: `tests/domain/polityki-v2.test.ts`). Skutek uboczny: bilans domen/poziomów może odbiegać od kwot na rzecz nowości (zapis `reason: 'unseen'` w `allocation.redistributed`).
9. ~~Dane: „Ocenaoff-label” w SAFE-Q030~~ — w finalnym banku brak tego zlepienia.
12. Dane (do decyzji redakcji, bank nie był modyfikowany): `status_pl` zawiera nazwy pól technicznych („clinical_signoff=false, approved_for_question_key=false”), które UI pokazuje dosłownie w „O bazie” i w ustawieniach. W DEV-Q041 wersja pytania (P) używa słowa „kolumna mikrouszkodzenia”, które występuje też w kluczu („kolumny usunięcia… / kolumny koagulacji”); opisuje wzór frakcyjny nazwany już w treści pytania i nie rozróżnia ablacji od koagulacji — w ocenie testu nie zdradza klucza, ale warto to potwierdzić w recenzji.
13. Pojemność zakresu to liczba rodzin (bank V15: cały zakres 2501; najmniejszy koszyk domena × poziom INJ/zaawansowany — 45 rodzin; `docs/RODZINY_I_POJEMNOSC.md`). UI nazywa ją „różnymi zadaniami (rodzinami)” i pokazuje obok liczbę pytań (C01). Poziom trudny ma 573 pytania (< 1000).
10. Stabilność e2e pod obciążeniem (4 procesy testów + równoległe buildy wariantu v2): przed utwardzeniem testów zdarzyły się pojedyncze niepowodzenia — WebKit: jedno `registration.update()` nie zainstalowało nowej wersji w 30 s (osobno nie odtworzone, 6/6 i 5/5 PASS); Chromium: strona po 4 przeładowaniach wciąż niekontrolowana przez SW i na ekranie „Otwieranie danych na urządzeniu…” (1 na ok. 100 przebiegów); oraz wyścig dwóch procesów budujących wariant v2 do jednego katalogu (`--repeat-each`). Poprawki dotyczą tylko testów: osobny katalog buildu v2 na proces, ponawiane sprawdzanie aktualizacji co ok. 5 s (jak automatyczne sprawdzenie aplikacji), `navigator.serviceWorker.ready` i do 8 przeładowań w `reloadUntilControlled`, oczekiwanie na ekran startowy. Po zmianach: pełny zestaw ×3 (153 PASS, 3 SKIP) bez niepowodzeń.
11. `repository.open()` nie ma limitu czasu: gdyby IndexedDB w przeglądarce nie odpowiadało (bez `success`/`error`/`blocked`), aplikacja zostaje na ekranie „Otwieranie danych na urządzeniu…” bez komunikatu. Odmowa, brak API i blokada przez inną kartę są obsłużone komunikatem. Do rozważenia: limit czasu z ekranem błędu i „Spróbuj ponownie”.
