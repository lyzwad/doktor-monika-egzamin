# Raport kontroli — Doktor Monika Egzamin

Raport końcowy według `05_KONTROLA/01_KRYTERIA_ODBIORU.txt` (kryterium G07). Przebieg kontroli na banku `release-2026-10-23c`: **23.10.2026, 14:11–14:15 (Europe/Warsaw, CEST)**, a po aktualizacji dokumentacji ponowny typecheck i Vitest (§3). Raport podaje osobno: wersje i środowisko (§1), stan kodu i buildu (§2), stan testów (§3), rzeczywistą pulę (§4), status recenzji treści (§5), testy niewykonane i pominięte (§6), wdrożenie (§7) i macierz kryteriów A01–G07 (§8).

PASS testu albo walidatora to kontrola działania aplikacji i struktury danych. Nie jest oceną poprawności medycznej pytań ani prognozą wyniku egzaminu.

**Dwie osobne oceny:**

- **Gotowość techniczna aplikacji: tak** (w emulacji i lokalnie). Typecheck, Vitest, build pod podścieżką, `check-dist`, `check-offline` i e2e w WebKit „iPhone 15” oraz Chromium przeszły na ostatecznym banku (§2–§3). Nie wykonano testu na fizycznym iPhonie 15 (G05) ani publikacji (§6–§7).
- **Kryterium treści (pula 2000–3000 pytań): niespełnione.** Pula ma 1097 pytań, czyli o 903 mniej niż dolna granica. Walidator paczki w trybie `--release` zwraca FAIL z jednym błędem `RELEASE_COUNT`. Pierwotnego progu 2000 nie obniżono (§4). Żadne pytanie nie ma recenzji lekarskiej (§5).

Zgodność tego raportu z repozytorium sprawdza test `tests/docs/raport-kontroli.test.ts` (projekt Vitest `docs`). Test pilnuje sekcji, pełnej macierzy, statusu G05, zgodności liczb z `public/data/bank.json`, opisu każdego pominiętego testu e2e oraz braku adresu wdrożenia.

## 1. Wersje i środowisko

| Element | Wartość |
|---|---|
| Aplikacja | `doktor-monika-egzamin` 0.1.0 (wersja w buildzie: `0.1.0`, bez sufiksu `APP_BUILD_ID`) |
| Kod | lokalne repozytorium git (`main`) **bez commitów**, więc nie ma identyfikatora commita. Kontrolowano pliki robocze z 23.10.2026, 14:10 |
| Bank pytań | `release-2026-10-23c`, plik `public/data/bank.json` (szczegóły w §4) |
| System | macOS 26.5.2 (25F84), Apple M1 Pro (8 rdzeni), 16 GB RAM. Maszyna współdzielona z innymi procesami, więc testy szły sekwencyjnie (`--maxWorkers=2`, `--workers=1`) |
| Obciążenie w czasie przebiegu | load average (1 / 5 / 15 min): 14:10 — 5,14 / 3,92 / 3,05; 14:11 (Vitest) — 4,45–5,36; 14:12 (build, `check-offline`) — 6,25 / 4,43 / 3,32; e2e 14:12–14:14 — 5,45 → 3,86. Przy 8 rdzeniach obciążenie nie blokowało testów; żadnej kontroli nie przerwano limitem czasu |
| Node.js / npm | 24.18.1 / 11.16.0 |
| TypeScript / Vite / vite-plugin-pwa / Vitest | 7.0.2 / 8.3.5 / 2.0.0 / 5.0.5 |
| Playwright | 1.63.0. Projekty: WebKit 26.6 (rev. 2359) z emulacją „iPhone 15” (393×852, DPR 3, dotyk) oraz Chromium 153.0.8010.12 (rev. 1243) w trybie mobilnym 393×852 (wersje odczytane z `browser.version()` w tym przebiegu) |
| Walidator paczki | `05_KONTROLA/validate_package.py` (Python 3, kopia robocza paczki w redakcji), uruchomiony 14:15:39 |
| Urządzenie fizyczne | **brak**: nie wykonano testu na iPhonie 15 (G05, §6) |

## 2. Stan kodu i buildu

Zintegrowano: silnik domeny (`src/domain`), trwałość IndexedDB z kopią danych i importem pul (`src/persistence`), rzeczywisty kontroler (`src/app/appController.ts`), ekrany S01–S24 według Claude Design (`src/ui`) i Service Worker z aktualizacją na żądanie (`src/pwa`). Mock kontrolera działa tylko w `npm run dev` z `?mock=1`; w buildzie go nie ma (sprawdza to `check-dist`). Architekturę opisuje `docs/ARCHITEKTURA_APP.md`, a wiążące decyzje `docs/DECYZJE_ARCHITEKTURY.md`.

Zmiany kodu w tym przebiegu: tylko usunięcie twardych liczb starego banku (test wydajności porównuje liczbę pytań z `bank.counts.questions`, komentarze w `src/ui/format.ts` i `src/ui/screens/SettingsScreens.tsx` mają przykładowe liczby, komentarz E03 w `tests/e2e/dostepnosc.spec.ts` opisuje najmniejszy koszyk nowego banku). Nie znaleziono usterek kodu, więc nie było poprawek aplikacji.

| Kontrola | Komenda | Wynik |
|---|---|---|
| Build produkcyjny pod podścieżką | `BASE_PATH=/doktor-monika-egzamin/ npm run build` | **PASS** (14:11:44, 3 s): typecheck, potem `vite build` (86 modułów). Wynik w `dist/`: 25 plików, 2 595 336 B; pakiet JS `assets/index-CHp2Q252.js`. Precache SW ma 22 wpisy (2514,84 KiB), w tym `data/bank.json` (1 922 212 B, 11,5% limitu 16 MB) i 4 figury |
| Statyczna kontrola `dist` | `node scripts/check-dist.mjs --base /doktor-monika-egzamin/` | **53/53 PASS** (FAIL 0, WARN 0; 14:11:47). Sprawdza: odwołania pod base, manifest (nazwa, `lang` pl, `start_url`/`scope`/`id`, ikony 192/512/maskable), pełny precache wraz z każdą figurą z banku, `navigateFallback`, brak `clientsClaim`, `skipWaiting` tylko na żądanie, scope rejestracji SW, brak hostów zewnętrznych, CDN fontów, `support.js`, kluczy i tokenów, odwołań do anthropic/openai/claude.ai, mocka i map źródeł, SVG bez skryptów. W `bank.json` 217 adresów źródeł (tekst danych, otwierany tylko przez użytkowniczkę) |

E2E (§3) buduje aplikację ponownie w `webServer` Playwrighta z tym samym `BASE_PATH`. Ten build dał ten sam pakiet JS z tym samym hashem treści (`index-CHp2Q252.js`) i ten sam rozmiar `dist` (2 595 336 B), więc `check-dist`, `check-offline` i e2e dotyczą tego samego kodu.

## 3. Stan testów

| Kontrola | Komenda | Wynik | Uwagi |
|---|---|---|---|
| Typy | `npm run typecheck` | **PASS** (14:11:09, 2 s; powtórzony po zmianach dokumentacji: PASS) | 4 konfiguracje `tsc`: domain (bez DOM i Node), app, test, node |
| Testy jednostkowe i integracyjne | `npx vitest run --maxWorkers=2 --testTimeout=60000` | **607/607 PASS** (50 plików) w przebiegu końcowym po aktualizacji dokumentacji (14:18:20, 20,3 s; typecheck przed nim 14:18:17: PASS) | Pierwszy przebieg (14:11:17–14:11:36, 19,6 s): 603 PASS, 4 FAIL — wszystkie w `tests/docs/raport-kontroli.test.ts`, bo raport opisywał jeszcze poprzedni bank (wersja, SHA-256, liczby). To oczekiwany sygnał testu G07, nie usterka aplikacji; po aktualizacji raportu test przechodzi. Projekty (przebieg końcowy): domain 290 (20 plików), persistence 91 (7), app 47 (4; rzeczywisty kontroler, fake-indexeddb, prawdziwy bank), pwa 25 (1), ui 137 (17; jsdom), docs 17 (1; test G07 tego raportu). Load average: 3,79 przed i 4,93 po przebiegu |
| E2E (build z `BASE_PATH` w `webServer`) | `npx playwright test --workers=1` | **83 PASS, 1 SKIP, 0 FAIL** (84 testy w 11 plikach) | 14:12:26–14:14:55 (2,5 min). WebKit „iPhone 15”: 41 PASS i 1 SKIP; Chromium mobile: 42 PASS. Obejmuje m.in. schematy ANAT-Q001 i DEV-Q041 (P przed odpowiedzią, O po, offline z precache), „Uwzględnij błędy” i Moje błędy (D06), przerwanie i „Kontynuuj” po przeładowaniu (E/F01), eksport i import kopii z uszkodzonym plikiem (F), E03 na najmniejszym koszyku. Serwer `scripts/serve-dist.mjs` działa jak GitHub Pages (tylko base, `Cache-Control: max-age=600`, 404 dla braków). Pominięcie opisuje §6 |
| Service Worker w przeglądarkach | `node scripts/check-offline.mjs --base /doktor-monika-egzamin/` | **54/54 PASS** (Chromium 27, WebKit 27) | 14:11:48–14:12:11 (23 s). Sprawdza: rejestrację i scope, precache 22/22, start offline z banku i lokalnego fontu, trasę hash offline, `navigateFallback`, aktualizację czekającą do `SKIP_WAITING`, nieudane pobranie aktualizacji (stara wersja działa), przerwane pierwsze przygotowanie z „Spróbuj ponownie” i ponownym otwarciem bez sieci |
| Kontrola `dist` | `node scripts/check-dist.mjs --base /doktor-monika-egzamin/` | **53/53 PASS** | szczegóły w §2 |
| Walidator paczki (treść) | `python3 -I 05_KONTROLA/validate_package.py --root-package <paczka redakcji> --bank 03_DANE/questions.release.json --release` | **FAIL — tylko `RELEASE_COUNT`** (14:15:39) | Bank źródłowy `questions.release.json` (SHA-256 `23c847b7d5830c3bde10e8c9b18c8ae2611651f44ef2e4f01c81b9fecfcc62b7`, zgodny z `release_bank_sha256` w `docs/MANIFEST_PULI.json`): 1097 pytań, 1097 unikalnych ID i fingerprintów, 810 rodzin, 0 deklarowanych recenzji klinicznych; ostrzeżenia: 12 × `MANUFACTURER_SCOPE`. To kontrola treści, nie aplikacji (§4) |

Testy e2e nie czytają klucza z interfejsu: klucz pochodzi z `public/data/bank.json` na dysku, a zapis sprawdzają przez odczyt IndexedDB w stronie. Zrzuty kluczowych stanów (WebKit 393×852) są w `docs/zrzuty/`. Żadnej kontroli nie oznaczono jako NIEROZSTRZYGNIĘTEJ: obciążenie maszyny (§1) nie przerwało żadnego polecenia.

## 4. Pula pytań

Liczby odczytano z pliku `public/data/bank.json`, a test `tests/docs/raport-kontroli.test.ts` porównuje je z tym plikiem. Pełny opis puli i uzgodnienie liczebności po identyfikatorach: `docs/RAPORT_PULI.md` (§2a, §2b), manifest: `docs/MANIFEST_PULI.json` (pola `reconciliation`, `seed_blind_review`).

| Pole (`bank.json`) | Wartość |
|---|---|
| `bank_version` | `release-2026-10-23c` |
| SHA-256 pliku | `ae49224b3ad5049489e44f45f8c231cda472266ee84c77bb376280ec49e16fc1` |
| `counts.questions` (pytania: 245 z pakietu startowego + 852 nowe; uzgodnienie 248 − 3 + 729 + 164 − 41 = 1097) | 1097 |
| `counts.families` (rodziny w runtime = pojemność Testu „cały zakres”; w banku źródłowym 810, 4 scalenia bliskich wariantów seedu tylko w runtime) | 806 |
| `counts.by_domain.ANAT` (anatomia) | 124 |
| `counts.by_domain.INJ` (iniekcje) | 141 |
| `counts.by_domain.SKIN` (skóra i dermatologia) | 182 |
| `counts.by_domain.THER` (pozostałe terapie) | 155 |
| `counts.by_domain.DEV` (urządzenia) | 317 |
| `counts.by_domain.SAFE` (bezpieczeństwo i prawo) | 178 |
| `counts.by_difficulty.basic` (łatwy) | 306 |
| `counts.by_difficulty.intermediate` (średni) | 596 |
| `counts.by_difficulty.advanced` (trudny) | 195 |
| `counts.schematic` (ANAT-Q001 i DEV-Q041, rewizja 2; figury FIG-ANAT-01-P/-O i FIG-DEV-01-P/-O) | 2 |

**Cel 2000–3000 pytań nie został osiągnięty — kryterium treści jest niespełnione.** Do dolnej granicy brakuje 903 pytań. Dostarczony materiał źródłowy nie pozwalał na więcej różnych pytań bez parafraz i dopowiadania faktów (`docs/RAPORT_PULI.md` §2). Etap rozbudowy puli pozostaje nieukończony. Walidator paczki w trybie `--release` zwraca FAIL z jednym błędem `RELEASE_COUNT` (sprawdzone w tym przebiegu, §3); pozostałe bramki release przechodzą bez błędów. Pierwotny próg 2000 pozostaje w walidatorze i w kryteriach bez zmian. Aplikacja pokazuje rzeczywiste liczby i notę `pool_note_pl` („Docelowej puli 2000–3000 pytań nie osiągnięto…”) na ekranach „O bazie” i w Ustawieniach. Nie ma tam fałszywego licznika.

Najmniejszy koszyk domena × poziom to SKIN/zaawansowany z 19 rodzinami (test e2e E03 działa na nim, §6).

## 5. Status recenzji treści

| Pole | Wartość |
|---|---|
| `clinical_signoff` | false |
| `official_exam_question_bank` | false |
| `review_status: draft_pending_clinical_review` | 1097 |
| `approved_for_question_key: true` | 0 |
| `content_check_status: independently_checked_draft` | 1097 |
| `counts.independently_checked_draft` | 1097 |

- Wszystkie 1097 pytań przeszły odrębny, ślepy **przegląd AI** (`independent_ai_review`): rozwiązanie bez klucza, potem odsłonięcie i ocena. 852 nowe pytania sprawdzono w partiach redakcji. Wszystkie 248 dostarczonych pytań seed przeszły ślepy przegląd AI: 173 `verified`, 72 `verified_with_note`, 3 do kwarantanny (ANAT-Q022, DEV-Q030, SAFE-Q022), które usunięto z puli. W puli zostało 245 pytań seed (`docs/MANIFEST_PULI.json` → `seed_blind_review`).
- To **nie jest recenzja lekarska**: 0 recenzji lekarskich (`qualified_human_review: 0`, `declared_clinical_reviews: 0` w walidatorze). Wszystkie klucze są robocze. To nie jest oficjalny bank pytań PTMEiAA, a wynik w aplikacji nie jest oceną komisji egzaminacyjnej.
- Uwagi do danych zostawiono redakcji, bez zmian w banku:
  - `status_pl` zawiera nazwy pól technicznych („clinical_signoff=false, approved_for_question_key=false”), które interfejs pokazuje dosłownie.
  - W DEV-Q041 (rewizja 2) wersja pytania (P) używa słowa „kolumna mikrouszkodzenia”, które pojawia się też w kluczu. W ocenie testu `schematy.spec.ts` nie zdradza ono klucza, ale warto to potwierdzić w recenzji.
  - Walidator zgłasza 12 ostrzeżeń `MANUFACTURER_SCOPE` (źródła producenta do oceny zakresu).

## 6. Testy niewykonane i pominięte

| Pozycja | Status | Powód | Co sprawdzono zamiast tego |
|---|---|---|---|
| G05: fizyczny iPhone 15 w Safari i po „Do ekranu głównego” (pierwszy start, safe-area, klawiatura własnego N, tap, przewijanie komentarza, powiększenie schematu, podgląd tylko do odczytu, wznowienie, zapis kopii w Plikach, wybór pliku do importu, tryb samolotowy, aktualizacja, Dynamic Type, VoiceOver) | **NOT RUN** | brak urządzenia w środowisku wykonawczym, więc nie ma też numeru wersji iOS | emulacja WebKit „iPhone 15” w e2e (to nie jest urządzenie). Protokół do wypełnienia: `docs/INSTALACJA_IPHONE.md` §6 (18 kroków, wszystkie NOT RUN) |
| Publikacja na GitHub Pages i test pod adresem HTTPS | wykonano: **PASS** (23.10.2026) | — | §7: workflow `pages.yml` (run 39954751951) zakończony sukcesem; wszystkie 25 plików `dist` pod https://lyzwad.github.io/doktor-monika-egzamin/ — HTTP 200 i treść identyczna z buildem czystego klonu; e2e Playwright na żywym adresie: 31 PASS, 1 SKIP (ten sam WebKit `setOffline`) |
| `pwa.spec.ts`: „G02 + A04: offline (context.setOffline)” w projekcie WebKit | **SKIP** | Playwright WebKit (rev. 2359) przy `context.setOffline(true)` blokuje każdą nawigację, także obsługiwaną przez Service Workera („WebKit encountered an internal error”). To ograniczenie narzędzia, nie aplikacji | w Chromium ten sam test: PASS. W WebKit: `pwa.spec.ts` „G02 (serwer niedostępny)”: PASS, `schematy.spec.ts` (figury offline): PASS, `check-offline.mjs`: 27/27 PASS |
| `dostepnosc.spec.ts`: E03 (brak zastępstwa dla wcześniejszej pozycji) | wykonany: **PASS** w obu przeglądarkach | test pomija się warunkowo, gdy w banku nie ma koszyka domena × poziom z co najwyżej 40 rodzinami. W banku `release-2026-10-23c` najmniejszy koszyk to SKIN/zaawansowany z 19 rodzinami, więc test nie był pominięty | — |
| Recenzja lekarska kluczy | **NOT RUN** | poza zakresem kontroli aplikacji; wymaga lekarza recenzenta | status w §5 |
| Kryterium treści: pula ≥ 2000 | **FAIL** (niespełnione) | brak materiału źródłowego na więcej różnych pytań (`docs/RAPORT_PULI.md` §2) | walidator `--release`: tylko `RELEASE_COUNT` (§3–§4) |
| Porównanie pikselowe z Claude Design | **NOT RUN** | brak wzorcowych obrazów referencyjnych w tej samej rozdzielczości | tokeny z PRZEKAZANIE §4 i zrzuty `docs/zrzuty/01–09` (ocena wzrokowa) |
| `npm audit` | nie powtórzono 23.10 | kontrola bez zmian zależności | 22.10.2026 (etap fundamentu): 0 podatności. Zależności przypięte w `package-lock.json` |

## 7. Wdrożenie

Adres wdrożenia: https://lyzwad.github.io/doktor-monika-egzamin/ (GitHub Pages, repozytorium https://github.com/lyzwad/doktor-monika-egzamin; wdrożenie 23.10.2026 z commita `930ab22`, workflow „Publikacja na GitHub Pages”, run 39954751951 — build z `npm test`, `npm run build`, `check-dist` oraz deploy: sukces).

Kontrola po wdrożeniu (23.10.2026, 14:38–14:41, macOS, Playwright 1.63.0, WebKit 26.6 „iPhone 15” i Chromium 153 mobile, `--workers=1`, load 3–6):
- https://lyzwad.github.io/doktor-monika-egzamin/ → 200 `text/html`; adres bez końcowego ukośnika → 301 na adres z ukośnikiem;
- wszystkie 25 plików `dist` (index, JS/CSS, fonty woff2, ikony, `manifest.webmanifest`, `sw.js`, Workbox, `data/bank.json`, 4 figury SVG) pod `/doktor-monika-egzamin/`: HTTP 200, SHA-256 zgodne z buildem czystego klonu repozytorium; brak błędów ścieżek;
- manifest: `name`/`short_name` „Doktor Monika Egzamin”, `id` `/doktor-monika-egzamin/`, `start_url` i `scope` `.`, `display` standalone; bank `release-2026-10-23c`: 1097 pytań, 806 rodzin, 2 schematy;
- e2e na żywym adresie (smoke, flow A, flows B–F, pwa G02/G03, schematy ANAT-Q001 i DEV-Q041 z offline): **31 PASS, 1 SKIP** (WebKit `setOffline`, §6), w tym brak żądań do hostów zewnętrznych.

- Konfiguracja jest gotowa do przeglądu: `.github/workflows/pages.yml` (oficjalne akcje Pages przypięte do commitów; `BASE_PATH` liczony z nazwy repozytorium; przed publikacją `npm test`, build i `check-dist`). Kroki ręczne opisuje `docs/WDROZENIE.md`.
- Aplikacji nie zainstalowano jeszcze na fizycznym telefonie: G05 pozostaje **NOT RUN** do czasu wyników testu użytkowniczki (protokół `docs/INSTALACJA_IPHONE.md` §6).
- Wdrożenie nie zmienia statusu treści: A03 PARTIAL (pula 1097 < 2000, walidator `--release`: RELEASE_COUNT), przegląd AI to nie recenzja lekarska.

## 8. Macierz kryteriów A01–G07

Wynik opiera się na przebiegach z §2–§3 z 23.10.2026 (14:11–14:15, bank `release-2026-10-23c`). G05 pozostaje NOT RUN. „PASS” w emulacji przeglądarkowej nie zastępuje G05. Macierz ocenia kryteria odbioru aplikacji; osobne kryterium ilości treści (pula ≥ 2000, walidator `--release`) jest **niespełnione** (§4) i opisuje je wiersz A03.

Środowiska (wszystkie: macOS 26.5.2, Apple M1 Pro, Node 24.18.1, 23.10.2026): **V** — Vitest 5.0.5 (domain, persistence z fake-indexeddb, app z rzeczywistym kontrolerem i bankiem, docs; ui w jsdom); **W** — Playwright WebKit 26.6, emulacja „iPhone 15” 393×852; **C** — Playwright Chromium 153 mobile 393×852; **D** — `check-dist.mjs` (statyczna kontrola `dist`); **O** — `check-offline.mjs` (Chromium i WebKit); **K** — inspekcja kodu i dokumentacji; **P** — walidator paczki (Python 3).

| ID | Wynik | Dowód | Środowisko | Ograniczenie |
|---|---|---|---|---|
| A01 | PASS | `tests/ui/App.test.tsx` „Start (S01–S02)” (nazwa, dwa tryby, Historia i Ustawienia jako pomocnicze). Inspekcja `src/`: brak timera (jedyny `setTimeout` chowa toast), czatu, kont, odznak, serii dni, zakładek pytań, „Nie wiem”, pytań rynkowych i o marki. Zrzut `docs/zrzuty/01-start.png` | V, K, W | przełącznik „Testy / Free Flow” w Historii to element nawigacji z Design, a nie zakładki pytań |
| A02 | PASS | e2e `smoke.spec.ts` (nazwa, metadane PWA, lokalny font z polskimi znakami, jasny motyw przy ciemnym motywie systemu); `check-dist.mjs` (manifest „Doktor Monika Egzamin”, `lang` pl); tokeny z PRZEKAZANIE §4 w `src/ui/styles/tokens.css`; zrzuty `docs/zrzuty/01–09` | W, C, D, K | zgodność wizualną oceniano na zrzutach WebKit 393×852, bez porównania pikselowego (§6); wygląd na urządzeniu zależy od G05 |
| A03 | PARTIAL | Rozbudowa puli NIEUKOŃCZONA: 1097 < 2000 (brakuje 903; walidator --release FAIL wyłącznie RELEASE_COUNT, próg bez zmian) — część dotycząca rzetelnego licznika spełniona: liczby z pliku: `tests/domain/bank-smoke.test.ts` „liczebności z pliku”, `tests/app/wydajnosc.test.ts` (katalog = `bank.counts.questions`); UI: `tests/app/regresje-p3.test.ts` i `tests/ui/regresje-p3.test.tsx` (liczby z `bank.counts`, `pool_note_pl` z „2000–3000” na „O bazie” i w Ustawieniach), `tests/ui/App.test.tsx` „liczby z banku”; raport liczby, rodzin i pokrycia: `docs/RAPORT_PULI.md`, `docs/MANIFEST_PULI.json`, §4 tego raportu; walidator `--release` (1097 unikalnych ID i fingerprintów; poza `RELEASE_COUNT` brak błędów) | V, P, K | **pula 1097 < 2000: kryterium treści niespełnione** (brakuje 903; walidator `--release`: FAIL tylko `RELEASE_COUNT`; próg 2000 bez zmian). A03 wymaga uczciwego licznika i raportu, nie progu, a UI i dokumentacja jawnie pokazują niedobór. Etap rozbudowy puli jest nieukończony |
| A04 | PASS | e2e `smoke.spec.ts`, `flow-a.spec.ts`, `pwa.spec.ts` (śledzenie żądań: brak żądań do innych hostów w czasie nauki); `check-dist.mjs` (brak hostów zewnętrznych, kluczy i tokenów, odwołań do anthropic/openai/claude.ai) | W, C, D | linki do źródeł w wyjaśnieniach otwiera tylko użytkowniczka |
| B01 | PASS | `tests/domain/catalog.test.ts` „buildCatalog — walidacja rekordów (B01)”; `tests/persistence/paczki.test.ts` „B01: nie 4 warianty, powtórzone warianty, klucz spoza wariantów…” | V | — |
| B02 | PASS | `tests/domain/answer.test.ts` „B02 — 24 permutacje kolejności opcji”; e2e `flows.spec.ts` „E/F01” (ta sama kolejność po przeładowaniu) | V, W, C | — |
| B03 | PASS | `tests/domain/answer.test.ts` „B03”; `tests/app/appController.test.ts`; `tests/ui/AnswerCard.test.tsx`, `tests/ui/QuestionScreen.test.tsx`; e2e `interactions.spec.ts` „B03: drugi szybki tap… i dwuklik…” | V, W, C | tap na fizycznym ekranie zależy od G05 |
| B04 | PASS | e2e `flow-a.spec.ts` (przed odpowiedzią brak klucza, wyjaśnienia, źródeł, lokatora i oznaczeń poprawności w DOM i atrybutach); e2e `schematy.spec.ts` (ANAT-Q001, DEV-Q041: tylko wersja P, bez słów z klucza w alt, podpisie, etykiecie, nazwie pliku i tekście SVG); `tests/app/appController.test.ts`; `tests/ui/Figure.test.tsx` | V, W, C | uwaga do DEV-Q041 w §5 |
| B05 | PASS | `tests/ui/AnswerCard.test.tsx`; e2e `flow-a.spec.ts` (kolor, ikona i tekst; prawidłowa wskazana osobno) | V, W, C | — |
| B06 | PASS | `tests/ui/ExplanationPanel.test.tsx` (bez odwołań do liter wariantów; źródło); `tests/ui/QuestionScreen.test.tsx`; e2e `flow-a.spec.ts` (źródło po odpowiedzi; komentarz przed „Pokaż wynik”) | V, W, C | — |
| C01 | PASS | `tests/domain/pool.test.ts` „C01 — walidacja N”; `tests/ui/App.test.tsx`, `tests/ui/NumberStepper.test.tsx`; `tests/app/regresje-p3.test.ts`; e2e `interactions.spec.ts` „C01” | V, W, C | klawiatura iOS przy własnym N zależy od G05 |
| C02 | PASS | `tests/domain/test-flow.test.ts` „C02 — plan i konfiguracja zamrożone przy starcie” | V | — |
| C03 | PASS | `tests/domain/test-flow.test.ts` „C03/C05”; `tests/ui/QuestionScreen.test.tsx` | V | — |
| C04 | PASS | `tests/domain/scoring.test.ts` „isPassed — granice C04”; `tests/domain/test-flow.test.ts` „C04 — granice zaliczenia na pełnych sesjach” | V | — |
| C05 | PASS | `tests/domain/test-flow.test.ts` „C03/C05 … unfinished”; e2e `flows.spec.ts` (zamknięcie bez wyniku, wpis „Niedokończony” poza wykresem) | V, W, C | — |
| D01 | PASS | `tests/domain/retry.test.ts` „D01–D02”; e2e `flows.spec.ts` „B: Uwzględnij błędy” | V, W, C | — |
| D02 | PASS | `tests/domain/retry.test.ts`, `tests/domain/niezmienniki.test.ts`; `tests/app/regresje-p3.test.ts` „D02” | V | — |
| D03 | PASS | `tests/domain/retry.test.ts` „D03” | V | — |
| D04 | PASS | `tests/domain/selection.test.ts` „D04”; `tests/domain/polityki-v2.test.ts` (TEST_POLICY_V2 na prawdziwym banku) | V | nowość ma pierwszeństwo przed bilansem domen (DECYZJE §6) |
| D05 | PASS | `tests/domain/freeflow.test.ts` „D05 — Free Flow”; `tests/domain/bank-smoke.test.ts`; e2e `flows.spec.ts` „C: Free Flow” | V, W, C | — |
| D06 | PASS | `tests/domain/my-errors.test.ts` „D06”; e2e `flows-extra.spec.ts` „D06” | V, W, C | — |
| D07 | PASS | `tests/domain/my-errors.test.ts` „D07 — Test z Moje błędy w puli o pojemności 30”; `tests/domain/pool.test.ts` | V | — |
| E01 | PASS | `tests/domain/report.test.ts` „E01–E02”; `tests/domain/pool.test.ts` „E01: blokada po ID, fingerprincie albo rodzinie” | V | — |
| E02 | PASS | `tests/domain/report.test.ts`; `tests/app/appController.test.ts`; `tests/ui/QuestionScreen.test.tsx`; e2e `flows.spec.ts` „D: zgłoszenie z zastępstwem” | V, W, C | — |
| E03 | PASS | `tests/domain/report.test.ts` „E03” (2 przypadki); `tests/app/regresje-weryfikacji.test.ts`; e2e `dostepnosc.spec.ts` „E03” (koszyk SKIN/zaawansowany, 19 rodzin) | V, W, C | — |
| E04 | PASS | `tests/domain/report.test.ts` „E04”; e2e `flows-extra.spec.ts` „E04” | V, W, C | — |
| E05 | PASS | `tests/domain/report.test.ts` „E05 — Cofnij i Przywróć”; `tests/app/appController.test.ts`; e2e `flows.spec.ts` „D” | V, W, C | — |
| E06 | PASS | `tests/domain/report.test.ts` „E06”; `tests/persistence/blokady-domena.test.ts`, `tests/persistence/paczki.test.ts`; `tests/persistence/commit.test.ts` (dwie równoczesne komendy: jedna zapisana, druga Conflict); `tests/app/regresje-p3.test.ts` „LOG-05” | V | — |
| F01 | PASS | `tests/persistence/commit.test.ts` (dane po ponownym otwarciu); `tests/app/appController.test.ts`; e2e `flows.spec.ts` „E/F01” | V, W, C | zamknięcie aplikacji z ekranu głównego iOS zależy od G05 |
| F02 | PASS | `tests/persistence/kopia.test.ts` „F02 — round-trip”; `tests/app/appController.test.ts`; `tests/ui/regresje-p3.test.tsx`; e2e `flows.spec.ts` „F: eksport kopii… import…” | V, W, C | zapis pliku w aplikacji Pliki zależy od G05 |
| F03 | PASS | `tests/persistence/kopia.test.ts` „F03 — błędny plik nie zmienia danych”; `tests/persistence/commit.test.ts`; `tests/app/regresje-weryfikacji.test.ts`; e2e `flows.spec.ts` „F” (uszkodzony plik) | V, W, C | — |
| F04 | PASS | `tests/domain/history.test.ts` „F04 — snapshoty niezależne od późniejszej zmiany katalogu” | V | — |
| F05 | PASS | `tests/domain/history.test.ts` „F05”; `tests/ui/HistoryChart.test.tsx`; `tests/ui/App.test.tsx` „pusta historia… bez 0%”; e2e `flows.spec.ts` „B” (◆ na wykresie) | V, W, C | — |
| G01 | PASS | build z `BASE_PATH` i `check-dist.mjs` 53/53 (§2); e2e `layout.spec.ts` „odświeżenie ekranu pomocniczego pod podścieżką (G01)”; `check-offline.mjs` (scope, `navigateFallback`) | D, W, C, O | serwer lokalny naśladuje GitHub Pages; pod prawdziwym adresem Pages nie sprawdzono (§7) |
| G02 | PASS | e2e `pwa.spec.ts` (Chromium: `setOffline`; obie przeglądarki: „serwer niedostępny”); e2e `schematy.spec.ts` (figury offline); `check-offline.mjs` 54/54 | W, C, O | sprawdzone tylko w emulacji; `setOffline` w WebKit to SKIP (§6); tryb samolotowy na iPhonie zależy od G05 |
| G03 | PASS | e2e `integration.spec.ts` „G03: aktualizacja między dwoma buildami” i „błąd zapisu bez fałszywego sukcesu” (`QuotaExceededError`); e2e `pwa.spec.ts` „G03”; `check-offline.mjs` (aktualizacja czeka; nieudane pobranie zostawia starą wersję) | W, C, O | aktualizacja aplikacji z ekranu głównego iOS zależy od G05 |
| G04 | PASS | `check-dist.mjs` (brak CDN fontów i `support.js`, SVG bez skryptów i zasobów zewnętrznych); `tests/persistence/paczki.test.ts` (G04: obce HTML/SVG/skrypty, adresy i ścieżki z importu); e2e `smoke.spec.ts` (lokalny font) | D, V, W, C | — |
| G05 | NOT RUN | brak fizycznego iPhone 15 w środowisku; protokół `docs/INSTALACJA_IPHONE.md` §6 (18 kroków) nie jest wypełniony | — (brak urządzenia) | e2e w WebKit „iPhone 15” to emulacja silnika, nie urządzenie |
| G06 | PASS | e2e `layout.spec.ts` (320, 393 i 430 px; tekst 100–200%; każdy widoczny tekst ≥ 16 px; touch-targety ≥ 44 px; bez poziomego przewijania i łamania słów); `tests/ui/typography.test.ts` | W, C, V | wyjątek 13 px dotyczy tylko osi i dat wykresu (DECYZJE §12); Dynamic Type i VoiceOver na iPhonie zależą od G05 |
| G07 | PASS | ten raport (§1–§8) z wynikami przebiegu 23.10.2026 14:11–14:15; test `tests/docs/raport-kontroli.test.ts` (wersja, SHA-256 i liczby zgodne z `bank.json`); README odsyła do raportu | V, K | samoocena wykonawcy, do potwierdzenia przy ponownym odbiorze |

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

Na macOS bez `timeout` każde polecenie można ograniczyć czasowo: `perl -e 'alarm shift; exec @ARGV' 1800 <polecenie>`. Po każdym przebiegu zaktualizuj datę, wyniki, load average i środowisko w §1–§3. Po zmianie `public/data/bank.json` zaktualizuj §4–§5; inaczej test `tests/docs/raport-kontroli.test.ts` nie przejdzie.
