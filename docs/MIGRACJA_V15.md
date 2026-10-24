# Migracja do banku pytań V15

Stan: 24.10.2026. Aplikacja udostępnia **wyłącznie** bank V15 (`chatgpt-editorial-v15-2026-10-24-f020a0440df8`). Poprzednia pula (`release-2026-10-23c`, wdrożona 23.10.2026 z tagu `v0.1.0-pages`) nie jest już dostępna w żadnym trybie. Nie da się do niej wrócić z poziomu aplikacji.

## 1. Treść w aplikacji

| Plik w `public/data/` (i w `dist/data/`) | Zawartość | SHA-256 |
|---|---|---|
| `bank-37f3980a1129.json` | bank V15, bajt w bajt jak w paczce redakcji: 2987 pytań (1048 basic / 1366 intermediate / 573 advanced), 2501 rodzin | `37f3980a1129f782213553360ba0221fbe9281f4710d31f86dfdea2a488f0770` |
| `retired-question-ids-83b36ff80986.json` | 133 ID wyłączone z aktywnej puli (żadne nie występuje w banku V15) | `83b36ff80986596c73a49fa33646eb817d187d467ea03b4501172617b2ebca6a` |
| `training-profile-c0edd4ca07c2.json` | profil treningowy: udziały 35% skin / 25% facial_anatomy / 40% other według list ID | `c0edd4ca07c272fd07ed63635116aad433c2e4e9917f284dcb884f28d6d58dbc` |

Figury `public/figures/FIG-ANAT-01-{p,o}.svg` i `FIG-DEV-01-{p,o}.svg` pochodzą z paczki V15. Dawna ścieżka `data/bank.json` nie istnieje w buildzie. Nowy Service Worker odpowiada na nią 404, także gdy przeglądarka ma ją jeszcze w pamięci HTTP.

Pilnują tego kolejne warstwy:

- **Build** (`vite.config.ts`): przerywa się, gdy w `public/data` jest inny plik albo gdy suma SHA-256 się nie zgadza.
- **Kontrola dist** (`scripts/check-dist.mjs`): sprawdza SHA-256, `bank_version` trzech plików, liczby 2987 / 1048 / 1366 / 573, 133 wyłączone ID oraz brak `data/bank.json` w `dist`, w precache i w kodzie JS.
- **Uruchomienie** (`src/app/contentLoader.ts`, `src/app/appController.ts`): wczytuje bajty plików i liczy ich SHA-256 przez Web Crypto. Następnie sprawdza wersję wszystkich trzech plików i liczby katalogu. Każda niezgodność kończy się ekranem błędu, a aplikacja nigdy nie ładuje innego banku.
- **Katalog** (`buildCatalog`): ładuje tylko bank, bez paczek. Wyłączone ID zostają poza katalogiem, a wersja banku musi się zgadzać. `poolQuestions` odfiltrowuje wyłączone ID drugi raz, niezależnie od katalogu. Dotyczy to Testu, Free Flow, rundy błędów, zastępstw i „Moich błędów”.
- **Mock w trybie dev** (`?mock=1`): przyjmuje tylko bank V15 i korzysta z tego samego loadera.

Import dodatkowych pul pytań jest **wyłączony** w interfejsie i w logice kontrolera (komunikat: „Aplikacja używa wyłącznie banku pytań V15…”). Moduł importu pul usunięto.

## 2. Co migracja usuwa, a co zachowuje

Migracja działa przy pierwszym uruchomieniu nowej wersji: IndexedDB przechodzi z wersji 1 na 2 (`src/persistence/schema.ts`, `createMigrationV2`). Cała transformacja wykonuje się w **jednej transakcji `versionchange`**, przez funkcję `transformToV15` (`src/persistence/v15Migration.ts`). Ta sama funkcja obsługuje wczytanie starszej kopii danych i eksport kopii.

| Dane | Po migracji |
|---|---|
| Ukończone testy i zakończone Free Flow | **Podsumowanie zostaje**: daty, konfiguracja (zakres, poziom, N, „Moje błędy”), wynik (poprawne, N, procent, zaliczenie), łańcuch rund (`retry`), oznaczenie powtórki, liczba ocenionych pozycji. Wykres i historia pokazują te same liczby. Treść usunięto (`slots = {}`, `plan = []`): treść pytań, opcje, klucz, wyjaśnienia, źródła i figury. Sesja dostaje pole `legacy` z polami `previousBankVersion`, `contentBankVersion` (V15), `migratedAt`, `reason` i liczbami. Wynik nie jest przeliczany, a pod stare ID nie trafia nowa treść |
| Otwarte, niedokończone sesje (Test i Free Flow) | Status `interrupted_by_update`, bez wyniku i bez treści. Takiej sesji nie da się wznowić ani zakończyć, nie trafia na wykres, a w historii ma opis „Przerwany aktualizacją banku pytań” |
| Przegląd odpowiedzi, „Przejrzyj błędy”, „Uwzględnij błędy” dla sesji sprzed V15 | Zostaje samo podsumowanie z komunikatem „Treść pytań poprzedniej wersji banku nie jest dostępna”. Runda błędów z takiej sesji jest niedostępna (domena zwraca `LEGACY_SESSION`) |
| Stan powtórek (`questionStats`) i dziennik prób | Zostaje **tylko dla 332 pytań niezmienionych**: to samo ID oraz identyczne `fingerprint`, `revision`, klucz i wyjaśnienie. Listę ID z fingerprintami (bez treści) generuje `scripts/v15-carryover.mjs` do pliku `src/persistence/v15Carryover.ts`. Migracja sprawdza też, czy każdy snapshot i każda próba danego ID w danych użytkowniczki zgadza się z listą. Pozostałe pytania tracą stan powtórek, a wyłączone ID znikają z kolejek |
| Blokady (zgłoszenia) | Blokady pytań niezmienionych pozostają aktywne. Pozostałe są nieaktywne: `revokedAt` = data migracji, `inactiveReason: 'bank_version_changed'`, początek treści (`stemPreview`) usunięty |
| Zdarzenia | Zostają (nie zawierają treści pytań) |
| Zaimportowane pule (`packs`) | Usunięte |
| Automatyczne kopie bezpieczeństwa (`backups`) | Usunięte, bo zawierały starą treść |
| Ustawienia | Bez zmian |
| `meta` | `content` = wersja treści V15 (z SHA-256) oraz `migration:bank-v15` z raportem liczbowym |

Migracja nie kasuje całej bazy i nie dotyka danych ani cache innych aplikacji. Cache Service Workera jest ograniczony do scope tej aplikacji.

**Atomowość.** Każdy błąd w transakcji kończy się jej przerwaniem (abort). Baza zostaje wtedy w wersji 1 z nietkniętymi danymi, a aplikacja pokazuje „Aktualizacja danych nie powiodła się” z przyciskiem „Spróbuj ponownie” i nie pokazuje żadnych pytań. Zamknięcie karty w trakcie migracji też przerywa transakcję, a przy ponownym otwarciu migracja wykonuje się od początku. Przy kolejnych uruchomieniach migracja się nie powtarza (baza ma już wersję 2). Funkcja `transformToV15` jest idempotentna.

**Stara karta.** Gdy baza przechodzi na wersję 2, otwarte połączenie starego kodu dostaje `versionchange` i jest zamykane. Stary kod nie otworzy już bazy w wersji 1 (`VersionError`), więc jego opóźnione zapisy nie trafią do danych. Jeśli stara karta wstrzymuje aktualizację (`blocked`), aplikacja pokazuje komunikat „Aktualizacja danych czeka…” z przyciskiem „Spróbuj ponownie”. Dodatkowo repozytorium odrzuca zapis każdej sesji innej wersji treści, która nie jest sesją `legacy` (także sesji ze snapshotem innej wersji).

**Kopia danych.** Wczytanie starszej kopii (`dme-backup` v1 sprzed migracji albo eksportu ze starej aplikacji) przechodzi tę samą transformację: zostają ustawienia i podsumowania bez treści, otwarte sesje stają się przerwane, a paczki są odrzucane. Ekran decyzji podaje liczbę sesji z poprzedniej wersji, przerwanych i odrzuconych pul. Eksport kopii także przechodzi tę transformację, więc plik nigdy nie zawiera treści innej wersji banku.

## 3. Jak to działa na iPhonie (Service Worker)

Źródła: MDN i dane zgodności MDN (`@mdn/browser-compat-data` 8.1.7, odczyt 24.10.2026). `ServiceWorkerGlobalScope.skipWaiting()` i `Clients.claim()` działają od Safari 11.1 / iOS 11.3. `WindowClient.navigate()` działa od Safari 16 / iOS 16 (w Safari 11.1–15.6 metoda istnieje, ale zawsze rzuca `NotSupportedError`).

1. Gdy otwierasz aplikację z ikony albo w Safari, przeglądarka sprawdza `sw.js`. Nowy plik zawiera skrypt `dme-sw-takeover-<sha12>.js` (`scripts/sw-takeover.mjs`).
2. **Instalacja.** Jeśli działa poprzedni worker, a znacznik wersji treści w Cache Storage różni się od V15, nowy worker zapisuje informację o oczekującym przejęciu i wywołuje `skipWaiting()`. Przy pierwszej instalacji i przy zwykłych aktualizacjach aplikacji (bez zmiany treści) przejęcia nie ma: obowiązuje dotychczasowa aktualizacja na żądanie (DECYZJE §11).
3. **Aktywacja.** Workbox usuwa z precache tej rejestracji wpisy spoza nowego manifestu, w tym stary `data/bank.json`. Nowy worker zapisuje znacznik V15 i wywołuje `clients.claim()`. Do każdego okna wysyła wiadomość `DME_CONTENT_UPDATE`, a potem wywołuje `client.navigate(client.url)`, co przeładowuje także okno ze starym kodem.
4. Nowa aplikacja wykonuje migrację i w tym czasie pokazuje „Aktualizacja banku pytań…”.
5. **Fallback, gdy `navigate` nie zadziała** (iOS < 16, okno zamrożone w tle): nowa aplikacja przy starcie i po powrocie z tła (najwyżej raz na minutę) czyta `dme-release.json`. Ten plik jest poza precache i pobierany bez cache. Gdy wskazuje inną wersję banku, aplikacja pokazuje „Aktualizacja banku pytań…”, sprawdza Service Workera i przeładowuje się przed pokazaniem pytań. Gdy nowa wersja nie przejmie strony w ciągu 60 s, pojawia się błąd z przyciskiem „Spróbuj ponownie”. Ten mechanizm zabezpiecza przyszłe zmiany banku (np. V15 → V16).

**Ograniczenie:** kod sprzed V15 nie zna tego mechanizmu. Dopóki nowy Service Worker się nie zainstaluje (pobranie ok. 6,4 MB), stara karta albo aplikacja z ikony może jeszcze pokazywać pytania starej puli. Odpowiedzi udzielone w tym czasie migracja zamienia potem w podsumowanie albo sesję przerwaną.

## 4. Aktualizacja — instrukcja dla użytkowniczki

1. Przed aktualizacją możesz zapisać kopię (Ustawienia → Kopia danych). Kopia ze starej wersji wczyta się później tylko jako podsumowania, bez treści pytań.
2. Otwórz aplikację z ikony przy włączonym internecie. Po chwili aplikacja sama się przeładuje i pokaże „Aktualizacja banku pytań…”. Nie trzeba czyścić danych witryny.
3. Jeśli zobaczysz „Aktualizacja danych nie powiodła się” albo „Aktualizacja danych czeka”, zamknij inne karty z aplikacją i dotknij „Spróbuj ponownie”. Dane z poprzedniej wersji nie zostały usunięte.
4. Po aktualizacji: Ustawienia → „O bazie pytań” pokazuje 2987 pytań i wersję `chatgpt-editorial-v15-2026-10-24-f020a0440df8`. Historia zawiera dawne wyniki jako podsumowania, a sesja przerwana ma opis „Przerwany aktualizacją banku pytań”.

## 5. Profil treningowy (TEST_POLICY_V3, FREE_FLOW_POLICY_V3)

Opis zasad: `docs/DECYZJE_ARCHITEKTURY.md` §6a i §7a. Dla całego zakresu kwoty grup liczy metoda największych reszt: 20 → 7 + 5 + 8, 30 → 11 + 7 + 12, 40 → 14 + 10 + 16, 50 → 18 + 12 + 20, 60 → 21 + 15 + 24, 1 → 0 + 0 + 1, 2 → 1 + 0 + 1, 3 → 1 + 1 + 1. Gdy grupie brakuje rodzin, brakujące miejsca przechodzą na inne grupy z zapisem w `allocation.profile.redistributed`. Na przykład test 400/advanced przesuwa 7 miejsc, bo grupa facial_anatomy ma na poziomie advanced 93 rodziny. Zakres jednej dziedziny działa bez profilu. Free Flow dla całego zakresu stosuje wagi grup profilu z dotychczasową adaptacją i podłogą 0,05.

## 6. Weryfikacja

- Testy jednostkowe migracji: `tests/persistence/migracja-v15.test.ts` (realistyczne dane starej aplikacji, idempotencja, przerwanie po każdym magazynie, import starej kopii, odrzucenie opóźnionych zapisów, stara karta).
- Kontroler na danych starej aplikacji: `tests/app/migracja-v15.test.ts`.
- Wyłączone ID we wszystkich trybach: `tests/domain/wylaczone-v15.test.ts`.
- Katalog = 2987 rekordów V15 (porównanie treści 1:1 z plikiem) i profil: `tests/domain/bank-smoke.test.ts`.
- Skrypt przejęcia SW i fallback: `tests/pwa/tresc-v15.test.ts`.
- E2E, prawdziwa stara aplikacja zbudowana z tagu `v0.1.0-pages` i podmiana `dist` pod tym samym adresem: `tests/e2e/aktualizacja-v15.spec.ts`.

Nie zweryfikowano na fizycznym iPhonie (G05: NOT RUN), w tym zachowania `WindowClient.navigate` w prawdziwym Safari iOS i w aplikacji uruchomionej z ikony. Wyniki przebiegów opisuje `docs/RAPORT_KONTROLI.md`.
