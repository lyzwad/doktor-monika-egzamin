# Raport kontroli — Doktor Monika Egzamin

Raport końcowy według `05_KONTROLA/01_KRYTERIA_ODBIORU.txt` (kryterium G07). Dotyczy przejścia na **wyłącznie bank V15** (`chatgpt-editorial-v15-2026-10-24-f020a0440df8`) z migracją danych lokalnych. Przebieg kontroli: **24.10.2026, 14:36–14:50 (Europe/Warsaw, CEST)**. Raport podaje osobno: wersje i środowisko (§1), stan kodu i buildu (§2), stan testów (§3), pulę (§4), status recenzji treści (§5), testy niewykonane i pominięte (§6), wdrożenie (§7) oraz macierz kryteriów A01–G07 (§8). Opis migracji: `docs/MIGRACJA_V15.md`.

PASS testu albo kontroli oznacza, że aplikacja działa zgodnie z wymaganiami i że struktura danych jest poprawna. Nie jest oceną poprawności medycznej pytań ani prognozą wyniku egzaminu.

**Trzy osobne oceny:**

- **Gotowość techniczna aplikacji: tak, w emulacji i lokalnie.** Typecheck, Vitest, build pod podścieżką, `check-dist`, `check-offline` i e2e w WebKit „iPhone 15” oraz w Chromium przeszły na banku V15 (§2–§3). W e2e jest też aktualizacja z prawdziwej starej aplikacji (tag `v0.1.0-pages`) pod tym samym adresem. Testu na fizycznym iPhonie 15 (G05) nie wykonano (§6). Wersji z V15 nie wdrożono: wdrożenie wykona koordynator (§7).
- **Liczebność puli.** Próg 2000 pytań jest spełniony (2987). **Minimum 1000 pytań na każdy poziom nie jest spełnione dla poziomu trudnego: advanced 573 < 1000** (§4, wiersz A03).
- **Recenzja treści.** Żadne pytanie nie ma recenzji lekarskiej (§5).

Zgodność raportu z repozytorium sprawdza test `tests/docs/raport-kontroli.test.ts` (projekt Vitest `docs`). Pilnuje on sekcji, pełnej macierzy, statusu G05 i zgodności liczb, wersji oraz SHA-256 z plikiem `public/data/bank-37f3980a1129.json`. Sprawdza też liczbę wyłączonych ID, nazwanie poziomu poniżej 1000 pytań (wtedy A03 nie może mieć PASS), opis każdego pominiętego testu e2e i adres wdrożenia.

## 1. Wersje i środowisko

| Element | Wartość |
|---|---|
| Aplikacja | `doktor-monika-egzamin` 0.1.0 (build lokalny bez sufiksu `APP_BUILD_ID`) |
| Kod | gałąź `main`, commity z 24.10.2026 (lista w §2), bez wypchnięcia (`git push` wykona koordynator) |
| Bank pytań | `chatgpt-editorial-v15-2026-10-24-f020a0440df8`, plik `public/data/bank-37f3980a1129.json` (szczegóły w §4) |
| System | macOS 26.5.2 (25F84), Apple M1 Pro (8 rdzeni), 16 GB RAM. Maszynę współdzielą inne procesy, więc testy szły sekwencyjnie (`--maxWorkers=2`, `--workers=1`) z limitem czasu `perl -e 'alarm shift; exec @ARGV'` |
| Obciążenie w czasie przebiegu | load average (1 / 5 / 15 min): typecheck i Vitest 14:36 — 3,28 / 4,89 / 5,12; build i `check-dist` 14:37 — 3,61–3,96; e2e 14:37–14:50 — 3,57–5,64. Przy 8 rdzeniach obciążenie nie blokowało testów; żadnej kontroli nie przerwał limit czasu |
| Node.js / npm | 24.18.1 / 11.16.0 |
| TypeScript / Vite / vite-plugin-pwa / Vitest | 7.0.2 / 8.3.5 / 2.0.0 / 5.0.5 |
| Playwright | 1.63.0. Projekty: WebKit 26.6 (rev. 2359) z emulacją „iPhone 15” (393×852, DPR 3, dotyk) oraz Chromium 153 (rev. 1243) w trybie mobilnym 393×852 |
| Stara aplikacja do e2e aktualizacji | tag `v0.1.0-pages` (`934ca14`), `git archive` do `test-results/`, build z `BASE_PATH=/doktor-monika-egzamin/`. Plik `data/bank.json` ma SHA-256 `ae49224b…16fc1`, taki sam jak wdrożony bank `release-2026-10-23c`. `sw.js` i pakiet JS różnią się od wdrożonych tylko rewizją `index.html` i hashem pakietu: wdrożony build miał `APP_BUILD_ID` z CI |
| Urządzenie fizyczne | **brak**: nie wykonano testu na iPhonie 15 (G05, §6) |

## 2. Stan kodu i buildu

Zmiany z 24.10.2026:

- Treść V15: `public/data/` zawiera wyłącznie trzy pliki V15 pod wersjonowanymi nazwami, a figury pochodzą z paczki V15.
- Katalog nie łączy żadnych paczek. Wyłączone ID są wykluczane we wszystkich trybach, a wersja banku, SHA-256 i liczby są sprawdzane.
- Import pul jest wyłączony w interfejsie i w logice.
- Migracja IndexedDB v1 → v2 działa w transakcji `versionchange` (`src/persistence/schema.ts`, `v15Migration.ts`). Ta sama transformacja obsługuje import i eksport kopii, a repozytorium odrzuca zapisy sesji innej wersji treści.
- Nowe polityki doboru: TEST_POLICY_V3 i FREE_FLOW_POLICY_V3 (profil 35/25/40).
- Service Worker ma skrypt przejęcia przy zmianie wersji treści (`scripts/sw-takeover.mjs`) oraz fallback `dme-release.json`.
- Ekrany obsługują sesje sprzed V15 i sesje przerwane aktualizacją.

Zasady opisuje `docs/DECYZJE_ARCHITEKTURY.md` §6a, §7a, §10a, §11 i §14, a strukturę kodu `docs/ARCHITEKTURA_APP.md`.

Commity: `6527930` (bank V15, katalog, migracja, profil, SW), `6462903` (e2e aktualizacji ze starej aplikacji, testy przejęcia SW, 404 dawnej ścieżki), commit dokumentacji i poprawek testów kontrolnych tego przebiegu (`git log`).

| Kontrola | Komenda | Wynik |
|---|---|---|
| Build produkcyjny pod podścieżką | `BASE_PATH=/doktor-monika-egzamin/ npm run build` | **PASS** (14:37:15): typecheck, potem `vite build` (89 modułów). Wynik w `dist/`: 29 plików, 6 577 152 B; pakiet JS `assets/index-BIQHtL80.js` (508 817 B). Precache SW: 25 wpisów (6402,45 KiB), w tym `data/bank-37f3980a1129.json` (5 801 985 B, 34,6% limitu 16 MB), lista wyłączonych ID, profil, 4 figury i skrypt przejęcia. `dme-release.json` poza precache |
| Statyczna kontrola `dist` | `node scripts/check-dist.mjs --base /doktor-monika-egzamin/` | **72/72 PASS** (FAIL 0, WARN 0; 14:37:17). Sprawdza między innymi: SHA-256 banku V15, `bank_version` trzech plików, liczby 2987 / 1048 / 1366 / 573 zgodne z `counts`, 133 wyłączone ID (żadnego w banku) i profil obejmujący każde pytanie dokładnie raz. W `data/` są wyłącznie trzy pliki V15, a **`data/bank.json` nie występuje w `dist`, w precache ani w kodzie JS**. `dme-release.json` jest poza precache. Skrypt przejęcia ma warunkowy `skipWaiting`, `clients.claim`, `navigate`, `DME_CONTENT_UPDATE` i odpowiedź 404 dla dawnej ścieżki. Dalej: odwołania pod base, manifest, pełny precache z figurami, `navigateFallback`, w `sw.js` brak `clientsClaim` i samoczynnego `skipWaiting`, brak hostów zewnętrznych, kluczy i mocka, SVG bez skryptów |

## 3. Stan testów

| Kontrola | Komenda | Wynik | Uwagi |
|---|---|---|---|
| Typy | `npm run typecheck` | **PASS** (14:36:54; powtórzony po uzupełnieniu raportu: PASS) | 4 konfiguracje `tsc`: domain (bez DOM i Node), app, test, node |
| Testy jednostkowe i integracyjne | `npx vitest run --maxWorkers=2 --testTimeout=60000` | **621/621 PASS** (52 pliki; 14:36:56) | Projekty: domain 310 (21 plików), persistence 74 (6), app 50 (5; rzeczywisty kontroler, fake-indexeddb, bank V15), pwa 32 (2), ui 137 (17; jsdom), docs 18 (1; test G07 tego raportu, w przebiegu jeszcze z miejscami na wyniki — po ich wpisaniu powtórzony: PASS). Względem 23.10: usunięto testy importu pul (`paczki.test.ts`, `blokady-domena.test.ts`) — import wyłączony; dodano testy migracji, wyłączonych ID, profilu i przejęcia SW |
| E2E | `npx playwright test --workers=1` (na buildzie z `BASE_PATH`; `E2E_SKIP_BUILD=1` po buildzie z §2) | **87 PASS, 1 SKIP, 0 FAIL** (88 testów w 12 plikach; przebieg końcowy 14:47:10–14:50:29, 3,3 min; WebKit: 43 PASS + 1 SKIP, Chromium: 44 PASS). Wcześniejsze przebiegi tego dnia: 14:37 — 85 PASS, 2 FAIL; 14:42 — 86 PASS, 1 FAIL — za każdym razem `schematy.spec.ts` „figury z banku działają offline”: kontrola testu `caches.match` (wszystkie cache) nie znajdowała figur zaraz po gotowości offline, choć aplikacja zweryfikowała komplet precache (od V15 istnieje też cache znacznika wersji treści). Test zmieniono na sprawdzanie wprost cache precache Workboxa; ×4 w obu przeglądarkach i przebieg końcowy: PASS. Kod aplikacji bez zmian | Zawiera `aktualizacja-v15.spec.ts` (2 testy w każdej przeglądarce). Pierwszy test: stara aplikacja z tagu `v0.1.0-pages` z danymi wpisanymi przez UI (ukończony test, Free Flow, otwarty test ze zgłoszeniem), potem podmiana `dist` pod tym samym adresem. Nowy SW przejmuje obie otwarte karty, bez ręcznego czyszczenia i bez przeładowania przez test. Pojawia się komunikat „Aktualizacja banku pytań…” i baza przechodzi v1 → v2. Test sprawdza też: historię z podsumowaniami bez treści, przerwany test niewznawialny, wynik i przegląd sesji sprzed V15 bez treści i bez rundy błędów, brak starej treści w IndexedDB, brak `data/bank.json` w Cache Storage (404 z SW i z serwera), nowy test wyłącznie z V15 z wyjaśnieniem i linkiem źródła po odpowiedzi, rundę „Uwzględnij błędy” oraz start offline na V15. Drugi test: zamknięcie karty w trakcie pobierania aktualizacji, a po ponownym otwarciu dokończona migracja. Pozostałe testy z poprzedniego przebiegu działają na V15 (schematy ANAT-Q001 i DEV-Q041, przepływy A–F, G02/G03, układ). Pominięcie opisuje §6 |
| Service Worker w przeglądarkach | `node scripts/check-offline.mjs --base /doktor-monika-egzamin/` | **54/54 PASS** (Chromium 27, WebKit 27; 14:42:31). Pierwszy przebieg (14:37:18): 1 FAIL (Chromium) i 1 WARN (WebKit) w scenariuszu „ponowienie pobiera tylko brakujące pliki” — liczony był skrypt przejęcia `dme-sw-takeover-<sha12>.js`, który przeglądarka pobiera z `importScripts` przy każdej instalacji SW (część skryptu SW, nie precache). Skrypt kontrolny pomija teraz pliki z `importScripts` | Rejestracja i scope, komplet precache, start offline z banku V15 (wersjonowana ścieżka) i lokalnego fontu, trasa hash offline, `navigateFallback`, aktualizacja czekająca do `SKIP_WAITING` (ta sama wersja treści, bez przejęcia), nieudane pobranie aktualizacji (stara wersja działa dalej), przerwane pierwsze przygotowanie |
| Kontrola `dist` | `node scripts/check-dist.mjs --base /doktor-monika-egzamin/` | **72/72 PASS** (FAIL 0, WARN 0; 14:37:17) | szczegóły w §2 |

Testy e2e nie czytają klucza z interfejsu: klucz pochodzi z pliku banku V15 na dysku, a zapis sprawdzają przez odczyt IndexedDB w stronie. Zrzuty kluczowych stanów (WebKit 393×852, bank V15) są w `docs/zrzuty/`.

Testy dodane przy przejściu na V15:

- `tests/persistence/migracja-v15.test.ts`: realistyczne dane starej aplikacji, brak starej treści w całej bazie, podsumowania bez zmian liczb, sesje przerwane, powtórki i blokady tylko dla niezmienionych pytań, czyszczenie paczek i kopii bezpieczeństwa, meta V15, idempotencja, przerwanie po każdym z 4 magazynów (baza zostaje v1 bez zmian, a ponowienie działa), import starej kopii, odrzucenie opóźnionych zapisów, stara karta.
- `tests/app/migracja-v15.test.ts`: kontroler na bazie starej aplikacji.
- `tests/domain/wylaczone-v15.test.ts`: wyłączone ID we wszystkich trybach.
- `tests/domain/bank-smoke.test.ts`: katalog = 2987 rekordów V15, porównanych 1:1 z plikiem we wszystkich 20 polach każdego pytania. Profil: 20 → 7 + 5 + 8, także dla 1, 2, 3, 30, 40, 50 i 60, redystrybucja przy niedoborze grupy, zakres jednej domeny bez profilu, Free Flow w udziałach 35/25/40.
- `tests/pwa/tresc-v15.test.ts`: skrypt przejęcia w atrapie zakresu SW (aktualizacja, pierwsza instalacja, Safari < 16) i fallback w oknie.

## 4. Pula pytań

Liczby odczytano z pliku `public/data/bank-37f3980a1129.json`. Test `tests/docs/raport-kontroli.test.ts` porównuje je z tym plikiem. Opis puli: `docs/RAPORT_PULI.md`, manifest z sumami kontrolnymi: `docs/MANIFEST_PULI.json`.

| Pole (`bank-37f3980a1129.json`) | Wartość |
|---|---|
| `bank_version` | `chatgpt-editorial-v15-2026-10-24-f020a0440df8` |
| SHA-256 pliku (bajt w bajt z paczki redakcji V15) | `37f3980a1129f782213553360ba0221fbe9281f4710d31f86dfdea2a488f0770` |
| `counts.questions` | 2987 |
| `counts.families` (rodziny = pojemność Testu „cały zakres”) | 2501 |
| `counts.by_domain.ANAT` (anatomia) | 535 |
| `counts.by_domain.INJ` (iniekcje) | 318 |
| `counts.by_domain.SKIN` (skóra i dermatologia) | 621 |
| `counts.by_domain.THER` (pozostałe terapie) | 285 |
| `counts.by_domain.DEV` (urządzenia) | 901 |
| `counts.by_domain.SAFE` (bezpieczeństwo i prawo) | 327 |
| `counts.by_difficulty.basic` (łatwy) | 1048 |
| `counts.by_difficulty.intermediate` (średni) | 1366 |
| `counts.by_difficulty.advanced` (trudny) | 573 |
| `counts.schematic` (ANAT-Q001 i DEV-Q041; figury FIG-ANAT-01-P/-O i FIG-DEV-01-P/-O z paczki V15) | 2 |
| `retired_question_ids` (plik `retired-question-ids-83b36ff80986.json`; żadne nie występuje w banku) | 133 |

**Liczebność.** Próg 2000 pytań jest spełniony (2987). **Minimum 1000 pytań na poziom nie jest spełnione: advanced 573 < 1000** (basic 1048 i intermediate 1366 spełniają). Aplikacja nie dopisuje ani nie przekwalifikowuje pytań. Poziomy są redakcyjne, bez kalibracji empirycznej (`pool_note_pl`). Ekrany „O bazie” i Ustawienia pokazują rzeczywiste liczby z banku: pytania, rodziny, dziedziny, poziomy, liczbę wyłączonych, profil oraz `status_pl` i `pool_note_pl`.

**Profil treningowy** (`training-profile-c0edd4ca07c2.json`): `skin` 993, `facial_anatomy` 486, `other` 1508 pytań, udziały 35/25/40 w całym zakresie (DECYZJE §6a, §7a).

**Względem poprzedniej puli** (`release-2026-10-23c`, 1097 pytań, usunięta z aplikacji): 1001 wspólnych ID, z czego 332 bez zmian treści, 669 zmienionych pod tym samym ID, a 96 dawnych ID jest wyłączonych (`docs/RAPORT_PULI.md` §6).

Najmniejszy koszyk domena × poziom to INJ/trudny z 45 rodzinami (test e2e E03 działa na nim, §6).

## 5. Status recenzji treści

| Pole | Wartość |
|---|---|
| `clinical_signoff` | false |
| `official_exam_question_bank` | false |
| `review_status: draft_pending_clinical_review` | 2987 |
| `approved_for_question_key: true` | 0 |
| `content_check_status: independently_checked_draft` | 1322 |
| `content_check_status: editorially_revised_draft` | 1665 |
| `counts.independently_checked_draft` | 1322 |

- Status materiału (`status_pl` z banku): „Istniejący bank po redakcji pod praktyczny test. Bez nowego researchu. Zmiany redakcyjne nie są nowym zatwierdzeniem klinicznym.” Aplikacja pokazuje go w „O bazie” i w Ustawieniach.
- To **nie jest recenzja lekarska**: wszystkie klucze są robocze. To nie jest oficjalny bank pytań PTMEiAA, a wynik w aplikacji nie jest oceną komisji egzaminacyjnej.
- Treść V15 nie była zmieniana w aplikacji: klucze, poziomy, źródła, figury i metadane pozostały bez zmian (porównanie 1:1 w `tests/domain/bank-smoke.test.ts`).

## 6. Testy niewykonane i pominięte

| Pozycja | Status | Powód | Co sprawdzono zamiast tego |
|---|---|---|---|
| G05: fizyczny iPhone 15 w Safari i po „Do ekranu głównego”, w tym aktualizacja do V15 z ikony (przejęcie przez nowy SW, `WindowClient.navigate` w prawdziwym Safari iOS, migracja, komunikat „Aktualizacja banku pytań…”) | **NOT RUN** | brak urządzenia w środowisku wykonawczym, więc nie ma też numeru wersji iOS | emulacja WebKit „iPhone 15” w e2e (to nie jest urządzenie ani tryb standalone). Dane zgodności MDN: `navigate` od iOS 16, `skipWaiting` i `claim` od iOS 11.3. Protokół: `docs/INSTALACJA_IPHONE.md` §6 (wszystkie kroki NOT RUN) |
| `pwa.spec.ts`: „G02 + A04: offline (context.setOffline)” w projekcie WebKit | **SKIP** | Playwright WebKit (rev. 2359) przy `context.setOffline(true)` blokuje każdą nawigację, także obsługiwaną przez Service Workera. To ograniczenie narzędzia, nie aplikacji | w Chromium ten sam test: PASS. W WebKit: `pwa.spec.ts` „G02 (serwer niedostępny)”, `schematy.spec.ts` (figury offline), `aktualizacja-v15.spec.ts` (start offline na V15) i `check-offline.mjs`: PASS |
| `dostepnosc.spec.ts`: E03 (brak zastępstwa dla wcześniejszej pozycji) | wykonany: **PASS** w obu przeglądarkach | test pomija się warunkowo, gdy w banku nie ma koszyka domena × poziom z co najwyżej 60 rodzinami. W banku V15 najmniejszy koszyk to INJ/trudny z 45 rodzinami, więc test nie był pominięty | — |
| Aktualizacja w trybie standalone (aplikacja z ikony) i w karcie zamrożonej w tle | **NOT RUN** | Playwright nie emuluje trybu standalone iOS ani zamrażania kart | fallback w kodzie (`dme-release.json` przy starcie i powrocie z tła, wiadomość `DME_CONTENT_UPDATE`) pokrywa `tests/pwa/tresc-v15.test.ts` |
| Publikacja wersji z V15 na GitHub Pages | **NOT RUN** | zgodnie z poleceniem bez `git push`; wdrożenie wykona koordynator | §7 |
| Recenzja lekarska kluczy | **NOT RUN** | poza zakresem kontroli aplikacji; wymaga lekarza recenzenta | status w §5 |
| Kryterium treści: minimum 1000 pytań na poziom | **FAIL** (niespełnione dla advanced: 573) | bank V15 dostarczono jako zamknięty; aplikacja nie dopisuje pytań | §4 |
| Porównanie pikselowe z Claude Design | **NOT RUN** | brak wzorcowych obrazów referencyjnych w tej samej rozdzielczości | zrzuty `docs/zrzuty/01–09` (ocena wzrokowa) |

## 7. Wdrożenie

Adres wdrożenia: https://lyzwad.github.io/doktor-monika-egzamin/ (GitHub Pages, repozytorium https://github.com/lyzwad/doktor-monika-egzamin). Obecnie działa tam **poprzednia wersja**: wdrożenie z 23.10.2026 z commita `930ab22` (tag `v0.1.0-pages`), bank `release-2026-10-23c`. Kontrolę tamtego wdrożenia opisuje poprzednia wersja tego raportu w historii git.

Wersji z V15 nie wypchnięto i nie wdrożono: zrobi to koordynator. Po wdrożeniu nowy Service Worker przejmie otwarte karty i aplikację z ikony, a migracja wykona się przy pierwszym uruchomieniu (`docs/MIGRACJA_V15.md` §3–§4). Kontrolę po wdrożeniu trzeba wykonać i dopisać tutaj. G05 pozostaje **NOT RUN**.

## 8. Macierz kryteriów A01–G07

Wynik opiera się na przebiegach z §2–§3 (24.10.2026, 14:36–14:50, bank V15). G05 pozostaje NOT RUN. PASS w emulacji przeglądarkowej nie zastępuje G05.

Środowiska (wszystkie: macOS 26.5.2, Apple M1 Pro, Node 24.18.1, 24.10.2026):

- **V**: Vitest 5.0.5 (domain, persistence z fake-indexeddb, app z rzeczywistym kontrolerem i bankiem V15, pwa, docs; ui w jsdom).
- **W**: Playwright WebKit 26.6, emulacja „iPhone 15” 393×852.
- **C**: Playwright Chromium 153 mobile 393×852.
- **D**: `check-dist.mjs`, statyczna kontrola `dist`.
- **O**: `check-offline.mjs` (Chromium i WebKit).
- **K**: inspekcja kodu i dokumentacji.

| ID | Wynik | Dowód | Środowisko | Ograniczenie |
|---|---|---|---|---|
| A01 | PASS | `tests/ui/App.test.tsx` „Start (S01–S02)”. Inspekcja `src/`: brak timera, czatu, kont, odznak, serii dni, zakładek pytań i „Nie wiem” | V, K, W | — |
| A02 | PASS | e2e `smoke.spec.ts` (nazwa, metadane PWA, lokalny font, jasny motyw); `check-dist.mjs` (manifest); zrzuty `docs/zrzuty/01–09` (bank V15) | W, C, D, K | bez porównania pikselowego (§6); wygląd na urządzeniu zależy od G05 |
| A03 | PARTIAL | Liczby pochodzą z plików: `tests/domain/bank-smoke.test.ts` (2987 / 1048 / 1366 / 573, 133 wyłączone, katalog 1:1 z plikiem), `tests/app/wydajnosc.test.ts`, `check-dist.mjs` (liczby i SHA-256). UI: `tests/app/regresje-p3.test.ts`, `tests/ui/regresje-p3.test.tsx` (liczby z `bank.counts`, `pool_note_pl`, `status_pl`). Raport liczby, rodzin i pokrycia: `docs/RAPORT_PULI.md`, `docs/MANIFEST_PULI.json`, §4 | V, D, K | **minimum 1000 pytań na poziom niespełnione: advanced 573 < 1000**. Próg 2000 pytań spełniony (2987). Aplikacja nie dopisuje pytań |
| A04 | PASS | e2e `smoke.spec.ts`, `flow-a.spec.ts`, `pwa.spec.ts` (brak żądań do innych hostów w czasie nauki); `check-dist.mjs` | W, C, D | linki do źródeł otwiera tylko użytkowniczka |
| B01 | PASS | `tests/domain/catalog.test.ts` „buildCatalog — walidacja rekordów (B01)”; katalog V15 bez odrzuceń (`tests/domain/bank-smoke.test.ts`) | V | import pul wyłączony (V15), walidacja dotyczy wbudowanego banku |
| B02 | PASS | `tests/domain/answer.test.ts` „B02 — 24 permutacje”; e2e `flows.spec.ts` „E/F01” | V, W, C | — |
| B03 | PASS | `tests/domain/answer.test.ts` „B03”; `tests/app/appController.test.ts`; `tests/ui/AnswerCard.test.tsx`; e2e `interactions.spec.ts` „B03” | V, W, C | tap na fizycznym ekranie zależy od G05 |
| B04 | PASS | e2e `flow-a.spec.ts` (przed odpowiedzią brak klucza, wyjaśnienia, źródeł i lokatora w DOM); e2e `schematy.spec.ts` (ANAT-Q001, DEV-Q041 z banku V15); e2e `aktualizacja-v15.spec.ts` (brak wyjaśnienia przed odpowiedzią, link źródła dopiero po niej) | V, W, C | — |
| B05 | PASS | `tests/ui/AnswerCard.test.tsx`; e2e `flow-a.spec.ts` | V, W, C | — |
| B06 | PASS | `tests/ui/ExplanationPanel.test.tsx`; e2e `flow-a.spec.ts`, `aktualizacja-v15.spec.ts` (źródło z linkiem https po odpowiedzi) | V, W, C | — |
| C01 | PASS | `tests/domain/pool.test.ts` „C01”; `tests/ui/NumberStepper.test.tsx`; `tests/app/regresje-p3.test.ts`; e2e `interactions.spec.ts` „C01” | V, W, C | klawiatura iOS zależy od G05 |
| C02 | PASS | `tests/domain/test-flow.test.ts` „C02” | V | — |
| C03 | PASS | `tests/domain/test-flow.test.ts` „C03/C05”; `tests/ui/QuestionScreen.test.tsx` | V | — |
| C04 | PASS | `tests/domain/scoring.test.ts` „C04”; `tests/domain/test-flow.test.ts` | V | — |
| C05 | PASS | `tests/domain/test-flow.test.ts` „C03/C05”; e2e `flows.spec.ts` („Niedokończony” poza wykresem); sesje „Przerwany aktualizacją banku pytań” poza wykresem (`tests/persistence/migracja-v15.test.ts`, e2e `aktualizacja-v15.spec.ts`) | V, W, C | — |
| D01 | PASS | `tests/domain/retry.test.ts` „D01–D02”; e2e `flows.spec.ts` „B”, `aktualizacja-v15.spec.ts` (runda na V15) | V, W, C | runda błędów z sesji sprzed V15 jest niedostępna (`LEGACY_SESSION`) |
| D02 | PASS | `tests/domain/retry.test.ts`, `tests/domain/niezmienniki.test.ts`; `tests/app/regresje-p3.test.ts` „D02” | V | — |
| D03 | PASS | `tests/domain/retry.test.ts` „D03” | V | — |
| D04 | PASS | `tests/domain/selection.test.ts` „D04”; `tests/domain/polityki-v2.test.ts` („najpierw niewidziane” na banku V15, TEST_POLICY_V3) | V | — |
| D05 | PASS | `tests/domain/freeflow.test.ts` „D05”; `tests/domain/bank-smoke.test.ts` (FREE_FLOW_POLICY_V3, udziały 35/25/40); e2e `flows.spec.ts` „C” | V, W, C | — |
| D06 | PASS | `tests/domain/my-errors.test.ts` „D06”; e2e `flows-extra.spec.ts` „D06”; `tests/app/migracja-v15.test.ts` (aktywny błąd pytania niezmienionego zachowany) | V, W, C | — |
| D07 | PASS | `tests/domain/my-errors.test.ts` „D07”; `tests/domain/pool.test.ts` | V | — |
| E01 | PASS | `tests/domain/report.test.ts` „E01–E02”; `tests/domain/pool.test.ts` | V | — |
| E02 | PASS | `tests/domain/report.test.ts`; `tests/app/appController.test.ts`; e2e `flows.spec.ts` „D” | V, W, C | — |
| E03 | PASS | `tests/domain/report.test.ts` „E03”; `tests/app/regresje-weryfikacji.test.ts`; e2e `dostepnosc.spec.ts` „E03” (koszyk INJ/zaawansowany, 45 rodzin) | V, W, C | — |
| E04 | PASS | `tests/domain/report.test.ts` „E04”; e2e `flows-extra.spec.ts` „E04” | V, W, C | — |
| E05 | PASS | `tests/domain/report.test.ts` „E05”; `tests/app/appController.test.ts`; e2e `flows.spec.ts` „D” | V, W, C | — |
| E06 | PASS | `tests/domain/report.test.ts` „E06” (kopia treści i wariant rodziny poza pulą); `tests/persistence/commit.test.ts`; `tests/app/regresje-p3.test.ts` „LOG-05” | V | blokady pytań zmienionych w V15 są nieaktywne (`docs/MIGRACJA_V15.md` §2) |
| F01 | PASS | `tests/persistence/commit.test.ts`; `tests/app/appController.test.ts`; e2e `flows.spec.ts` „E/F01” | V, W, C | zamknięcie aplikacji z ekranu głównego iOS zależy od G05 |
| F02 | PASS | `tests/persistence/kopia.test.ts` „F02 — round-trip”; `tests/persistence/migracja-v15.test.ts` (import starej kopii, eksport bez starej treści, idempotencja); e2e `flows.spec.ts` „F” | V, W, C | zapis pliku w aplikacji Pliki zależy od G05 |
| F03 | PASS | `tests/persistence/kopia.test.ts` „F03”; `tests/app/regresje-weryfikacji.test.ts`; e2e `flows.spec.ts` „F” | V, W, C | — |
| F04 | PASS | `tests/domain/history.test.ts` „F04”; sesje sprzed V15 jako podsumowania bez treści, bez podstawiania nowej treści pod stare ID (`tests/persistence/migracja-v15.test.ts`, `tests/app/migracja-v15.test.ts`) | V | przegląd treści sesji sprzed V15 jest celowo niedostępny |
| F05 | PASS | `tests/domain/history.test.ts` „F05”; `tests/ui/HistoryChart.test.tsx`; e2e `flows.spec.ts` „B”; wykres bez zmian liczb po migracji (`tests/persistence/migracja-v15.test.ts`) | V, W, C | — |
| G01 | PASS | build z `BASE_PATH` i `check-dist.mjs` (§2); e2e `layout.spec.ts` „G01”; `check-offline.mjs` | D, W, C, O | serwer lokalny naśladuje GitHub Pages |
| G02 | PASS | e2e `pwa.spec.ts`, `schematy.spec.ts`, `aktualizacja-v15.spec.ts` (offline na V15); `check-offline.mjs` | W, C, O | `setOffline` w WebKit: SKIP (§6); tryb samolotowy na iPhonie zależy od G05 |
| G03 | PASS | e2e `integration.spec.ts` „G03” (zwykła aktualizacja na żądanie); e2e `aktualizacja-v15.spec.ts` (zmiana wersji treści: przejęcie kart, migracja, przerwanie i ponowienie); `tests/pwa/tresc-v15.test.ts`; `check-offline.mjs` | W, C, O, V | Safari iOS i aplikacja z ikony zależą od G05 (§6) |
| G04 | PASS | `check-dist.mjs` (brak CDN fontów i `support.js`, SVG bez skryptów i zasobów zewnętrznych, brak `data/bank.json`); e2e `smoke.spec.ts` | D, W, C | — |
| G05 | NOT RUN | brak fizycznego iPhone 15 w środowisku; protokół `docs/INSTALACJA_IPHONE.md` §6 nie jest wypełniony | — (brak urządzenia) | e2e w WebKit „iPhone 15” to emulacja silnika, nie urządzenie |
| G06 | PASS | e2e `layout.spec.ts`; `tests/ui/typography.test.ts` | W, C, V | Dynamic Type i VoiceOver na iPhonie zależą od G05 |
| G07 | PASS | ten raport (§1–§8); test `tests/docs/raport-kontroli.test.ts` (wersja, SHA-256, liczby, wyłączone ID, poziom poniżej 1000 nazwany wprost); README odsyła do raportu | V, K | samoocena wykonawcy, do potwierdzenia przy ponownym odbiorze |

## 9. Jak powtórzyć kontrolę

```bash
npm ci
npm run typecheck
npx vitest run --maxWorkers=2 --testTimeout=60000
BASE_PATH=/doktor-monika-egzamin/ npm run build
node scripts/check-dist.mjs --base /doktor-monika-egzamin/
node scripts/check-offline.mjs --base /doktor-monika-egzamin/
npx playwright test --workers=1                            # albo: E2E_SKIP_BUILD=1 npx playwright test --workers=1 (na istniejącym dist)
```

Na macOS bez `timeout` każde polecenie można ograniczyć czasowo: `perl -e 'alarm shift; exec @ARGV' 1800 <polecenie>`. E2E `aktualizacja-v15.spec.ts` buduje przy pierwszym uruchomieniu starą aplikację z tagu `v0.1.0-pages` do `test-results/` (`git archive`, potrzebny tag w repozytorium). Po każdym przebiegu zaktualizuj datę, wyniki, load average i środowisko w §1–§3. Po zmianie treści (`src/domain/contentRelease.ts`, `public/data/`) zaktualizuj §4–§5. Inaczej test `tests/docs/raport-kontroli.test.ts` nie przejdzie.
