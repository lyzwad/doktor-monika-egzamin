---
title: 'Service Worker, e2e aktualizacji z produkcji 39d9d46 i dokumentacja'
type: 'feature'
created: '2026-11-15'
status: 'done'
baseline_revision: 'e251fb3f7dd06f4ae71be8380c76bc8bb08b40d4'
review_loop_iteration: 0
followup_review_recommended: true
context:
  - '{project-root}/_bmad-output/specs/spec-webinary-247/SPEC.md'
  - '{project-root}/_bmad-output/specs/spec-webinary-247/kontrakt-danych.md'
  - '{project-root}/_bmad-output/specs/spec-webinary-247/teksty-ui.md'
  - '{project-root}/docs/MIGRACJA_V18.md'
warnings: ['oversized']
deferred:
  - summary: >-
      docs/ARCHITEKTURA_APP.md i docs/MANIFEST_PULI.json nadal opisują bank V15 jako bieżący (README nie oznacza ich jako historyczne).
    evidence: |-
      ARCHITEKTURA_APP.md l. 9 i 109 (bank-37f3980a1129.json, schemat v2), MANIFEST_PULI.json — stan sprzed V18; nieaktualne już po wdrożeniu V18 (09.11.2026), nie spowodowane tą historią.
    location: >-
      docs/ARCHITEKTURA_APP.md:9
    severity: low
  - summary: >-
      Brak e2e dla dwóch wariantów aktualizacji z produkcji 39d9d46: zamknięcie karty w trakcie pobierania nowej wersji i druga karta starej wersji trzymająca bazę („Aktualizacja danych czeka”).
    evidence: |-
      Wariant „zamknięcie karty” istnieje tylko dla ścieżki z V15 (aktualizacja-v18.spec.ts, Chromium; WebKit SKIP). Stan „Aktualizacja danych czeka” opisują instrukcje (MIGRACJA_WEBINARY.md §4), a sprawdzają go wyłącznie testy jednostkowe historii 2 (blokada versionchange). Kryteria historii 4 tych wariantów nie wymieniają.
    location: >-
      tests/e2e/aktualizacja-webinary.spec.ts
    severity: medium
---

<intent-contract>

## Intent

**Problem:** Zainstalowana PWA (produkcja `39d9d46`, bank V18, 700 pytań, IndexedDB v4) musi sama przejść na wydanie „V18 + webinary” (947 pytań), zachować dane obu profili i działać offline, a dawne pliki V18 w `data/` mają zwracać 404. Brakuje dowodu end-to-end tej aktualizacji, testów Service Workera dla przejścia V18 → nowe wydanie i dokumentacji wdrożenia.

**Approach:** Service Worker i konfiguracja biorą wszystko z `CONTENT_RELEASE` (historia 1 je podmienia), więc tu dochodzą testy jednostkowe na sparametryzowanym wydaniu, e2e aktualizacji z buildu `39d9d46` z dwoma profilami i dokumentacja. Praca ma dwie fazy: **A** — teraz, na gałęzi bez historii 1–3; **B** — po scaleniu `feat/webinary-247` z historiami 1–3 do `story/4` (wtedy `CONTENT_RELEASE.bankVersion` = `dme-v18-webinary-2026-11-15-8622d52b9a42`).

## Boundaries & Constraints

**Always:** TDD (najpierw test czerwony z właściwego powodu); wartości wydania czytane z `CONTENT_RELEASE`/pliku banku, nie wpisane na sztywno w testach; e2e startuje z buildu commita `39d9d46` (git archive) pod tym samym adresem serwera; emulacja WebKit opisywana jako emulacja, fizyczny iPhone = NOT RUN; każde `test.skip` w e2e ma wiersz w `docs/RAPORT_KONTROLI.md` §6; ścieżka aktualizacji z `b6f9201` (V15) zostaje.

**Never:** edycja `src/domain/*`, `src/persistence/*`, `src/ui/*`, `src/app/*`, `public/`, `content/`, `scripts/check-dist.mjs`, `scripts/v18-allowlist.mjs`, skryptu scalania; nowe zależności; push, merge do innych gałęzi, wdrożenie; nowe teksty UI; czyszczenie danych przeglądarki w e2e aktualizacji.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Aktualizacja treści | SW nowego wydania instaluje się przy aktywnym SW, w Cache Storage znacznik V18 `chatgpt-combined-v18-2026-11-09-1fb7f7546332#profile-1` | `skipWaiting`, `clients.claim`, `DME_CONTENT_UPDATE` z nową wersją, `navigate` okien | Safari < 16 (`navigate` rzuca) — aktywacja kończy się, okno dostaje wiadomość |
| Dawne pliki V18 | żądanie `data/bank-5db40505308f.json`, `data/retired-question-ids-54a05ea91281.json`, `data/training-profile-2bdad504f50e.json` (także z `?v=`) w scope SW nowego wydania | 404 z SW, bez sieci | — |
| Bieżące pliki | trzy pliki `data/` nowego wydania, `index.html`, `assets/*` | SW nie odpowiada (przechodzi do precache/sieci) | — |
| Ten sam znacznik | instalacja przy aktywnym SW, znacznik = nowe wydanie | brak przejęcia (aktualizacja na żądanie) | — |
| Offline po aktualizacji | serwer zrywa połączenia | aplikacja startuje z precache, profil, Free Flow, pytanie WB ze źródłem | nieudane sprawdzenie `dme-release.json` nie jest błędem testu |

</intent-contract>

## Code Map

- `scripts/sw-takeover.mjs` -- `takeoverScript(release)`, `takeoverFileName`, `DATA_EPOCH='profile-1'`; znacznik `<bankVersion>#<epoka>`; reguła 404 dla `data/` spoza `release.{bankFile,retiredFile,profileFile}`. Logika ogólna — bez wartości V18. Zmieniać tylko komentarze, jeśli wymieniają konkretne wersje.
- `vite.config.ts:32-76,164` -- `PRECACHE_REQUIRED`, `contentReleasePlugin` (kontrola `public/data`, emisja `dme-release.json` i skryptu przejęcia) — wszystko z `CONTENT_RELEASE`; komunikaty/komentarze mówią „V15” (np. błąd „pliki spoza banku V15”) → neutralne „bieżące wydanie treści”.
- `scripts/check-offline.mjs:47-49` -- `BANK_FILE` czytany regexem z `src/domain/contentRelease.ts` (kruche, gdy historia 1 zmieni format pliku) → czytać `bankFile` z `<dist>/dme-release.json`.
- `tests/pwa/tresc-sw.test.ts` -- atrapa zakresu SW `swScope()` (wykonuje `takeoverScript(CONTENT_RELEASE)` przez `new Function`), atrapa okna `windowPwa()`. Wzór dla nowych testów; `swScope` sparametryzować wydaniem.
- `src/pwa/swController.ts`, `src/pwa/registerSW.ts:66` -- okno: `contentBankVersion: CONTENT_RELEASE.bankVersion`, `parseReleaseInfo`, przeładowanie przy innej wersji. Bez zmian kodu (ogólne).
- `tests/e2e/aktualizacja-v18.spec.ts` -- wzór e2e: `ensureOldDist` (git archive → vite build do `test-results/`, atomowy `rename`), `waitControlled`, `chooseProfile`, `ensureProfile`, `dumpDb`, `cacheUrls`, `collectProblems`, przejęcie karty przez znacznik `window.__dmeOld`, `server.hooks.dist/offline/delay`. Scenariusz z `b6f9201` (V15).
- `tests/e2e/profile.spec.ts` -- ścieżka z `b50eb19` (V15 bez profili); oczekuje `legacy.reason === 'bank_v18_update'`.
- `tests/e2e/helpers.ts` -- `BANK` (plik banku z `CONTENT_RELEASE.bankFile`), `answer(page, correct)`, `currentQuestion`, `next`, `profileDb(email)`, `readStore`; selektory UI `39d9d46` = obecne (od `39d9d46` zmieniły się tylko BMAD i `content/`).
- `scripts/serve-dist.mjs` -- `startDistServer({dist, base, port:0})`, haki `dist`, `offline`, `delay`, `fail`, `requests`.
- UI (tylko do odczytu): „Kontynuuj” = `section.resume`; „Moje błędy” = przełącznik na konfiguracji, opis `Najpierw N pytań z wcześniejszymi błędami…`; „O bazie pytań” = Ustawienia → przycisk `/O bazie pytań/`, tekst `Wbudowana pula zawiera N pytań`; wiersz „Pytania z webinarów” i przycisk „Źródło webinaru” dostarcza historia 3 (`teksty-ui.md`).
- IndexedDB profilu: baza `doktor-monika-egzamin:profil:<email>`, magazyny `meta, settings, sessions, attempts, questionStats, blocks, events, packs, backups`; v4 → v5 (historia 2): sesje V18 zostają aktywne z nową `bankVersion` (sesja i snapshoty), bez `legacy`.
- `tests/docs/raport-kontroli.test.ts` -- porównuje `docs/RAPORT_KONTROLI.md` z plikiem banku (wersja, SHA, `counts.*`, statusy), wymaga wiersza §6 dla każdego `test.skip`.
- Kopia: `~/DEWELOPER_CLAUDE/projekty/_kopie/doktor-monika-egzamin-2026-11-15-przed-webinarami/` (`strona/` lustro 24 plików, `repo-doktor-monika-egzamin.bundle`, `WDROZONY_COMMIT.txt` = `39d9d46b67cb9274cf8aae9c706bc480718d9808`, `JAK_COFNAC.txt`, `paczka/` — prywatna).

## Tasks & Acceptance

**Execution — faza A (teraz):**
- `tests/pwa/tresc-sw.test.ts` -- `swScope` przyjmuje wydanie (domyślnie `CONTENT_RELEASE`); nowy blok: syntetyczne „następne wydanie” (inna `bankVersion`, SHA, trzy nowe pliki) przy znaczniku V18 → przejęcie; pliki V18 i V15 → 404; pliki nowego wydania przechodzą; `takeoverFileName` różny od V18; ten sam znacznik → brak przejęcia.
- `vite.config.ts`, `scripts/sw-takeover.mjs`, `scripts/check-offline.mjs` -- neutralne komentarze/komunikaty; `check-offline` czyta `bankFile` z `dist/dme-release.json`.
- `tests/e2e/aktualizacja.ts` (nowy, wspólny) -- wydzielić z `aktualizacja-v18.spec.ts`: `ensureOldDist(ref, nazwa, plikGotowości)`, `waitControlled`, `chooseProfile`, `ensureProfile`, `dumpDb`, `cacheUrls`, `collectProblems(context, ignorowanePliki)`; `aktualizacja-v18.spec.ts` korzysta z modułu (zachowanie bez zmian, przechodzi na obecnym V18).
- `tests/e2e/aktualizacja-webinary.spec.ts` (nowy) -- build `39d9d46`; Monika: ukończony test 3 z ≥ 1 błędną, zakończony Free Flow 2, otwarty test 5 z 2 odpowiedziami (1 błędna) i zgłoszeniem; Iza: ukończony test 2 z 1 błędną; zrzut obu baz (v4, sesje z `bankVersion` V18). Dalej scenariusz po aktualizacji jak w AC.
- `docs/MIGRACJA_WEBINARY.md` -- szkic wg wzoru `MIGRACJA_V18.md` (§1 treść, §2 pula, §3 migracja, §4 SW i iPhone, §5 weryfikacja, §6 kopia i cofnięcie); liczby z wejść: 700 + 247 = 947, 692 + 247 = 939 rodzin, by_domain i by_difficulty z kontraktu.

**Execution — faza B (po scaleniu historii 1–3 do `story/4`):**
- `tests/pwa/tresc-sw.test.ts` -- test na bieżącym `CONTENT_RELEASE`: pliki V18 → 404 (czerwony przed scaleniem historii 1).
- `tests/e2e/aktualizacja-webinary.spec.ts`, `aktualizacja-v18.spec.ts`, `profile.spec.ts` -- dopasować do allowlisty 947, `DB_SCHEMA_VERSION` 5, `legacy.reason` z historii 2, UI źródła webinaru z historii 3; tytuły bez „700 pytań V18”.
- `docs/MIGRACJA_WEBINARY.md` (SHA i nazwy plików z `public/data`), `docs/RAPORT_KONTROLI.md` (nowe wydanie, wyniki przebiegów, §6), `docs/INSTALACJA_IPHONE.md` §5, `README.md` (stan puli); `tests/docs/migracja-webinary.test.ts` -- dokument zawiera `bankVersion`, SHA trzech plików, ich nazwy i liczby 700/247/947 z banku.

**Acceptance Criteria:**
- Given build `39d9d46` z dwoma profilami z historią, when pod tym samym adresem pojawia się nowy build, then pierwsza karta zostaje przejęta bez przeładowania przez test, a `dme-release.json` ma `CONTENT_RELEASE.bankVersion`.
- Given przejęta karta, when każdy profil otwiera się osobno, then jego baza ma `DB_SCHEMA_VERSION`, każda sesja V18 (ukończona, zakończona, otwarta) zostaje z wynikiem, slotami i nową `bankVersion` bez `legacy`, a próby, `questionStats` i zgłoszenia zostają.
- Given Monika po migracji, when otwiera „Kontynuuj” i kończy otwarty test, then dostaje wynik; historia pokazuje dawne wyniki z dostępnym przeglądem odpowiedzi.
- Given nowe wydanie, when użytkowniczka otwiera „O bazie pytań”, then widzi 947 pytań i wiersz „Pytania z webinarów” 247.
- Given nowe wydanie, when robi Test 20, rundę błędów, Test z „Moje błędy” i Free Flow, then pytania należą do allowlisty 947 bez powtórzeń, a pytanie WB ma przycisk „Źródło webinaru”, panel z cytatem i zero `<a>` w wyjaśnieniu.
- Given nowe wydanie, when test pyta o pliki `data/` V18 i V15, then SW i serwer zwracają 404, a Cache Storage nie ma pliku banku V18.
- Given serwer niedostępny, when karta się przeładowuje, then aplikacja startuje z precache i Free Flow pokazuje pytanie WB ze źródłem; przez cały scenariusz 0 błędów konsoli i 0 odpowiedzi ≥ 400 poza celowymi.

## Spec Change Log

## Review Triage Log

### 2026-11-15 — Review pass
- verdicts: 30 findings — high 0, medium 8, low 18, false 4, maybe-false 0
- findings:
  - `[medium]` `[patch]` (blind) docs/WDROZENIE.md opisuje V18 jako bieżące wydanie (precache, check-dist 700, „pytania banku V18”, „Od 09.11.2026 … wyłącznie V18”) — poprawiono 4 miejsca na wydanie „V18 + webinary” (947, allowlista wydania, skrypt scalania); część o ARCHITEKTURA_APP.md i MANIFEST_PULI.json (opis V15, nieaktualny od 09.11) — odłożona (`deferred`), stan sprzed tej historii.
  - `[low]` `[patch]` (blind) docs/PROFILE.md: „Schemat IndexedDB jest w wersji 3” i „allowlista V18 przy imporcie” — poprawiono (schemat 3 wprowadził profile, obecnie 5; allowlista bieżącego wydania 947).
  - `[medium]` `[patch]` (blind) MIGRACJA_V18.md §5 i MIGRACJA_WEBINARY.md §5 przypisywały profile.spec.ts kontrolę rekordu migracji v3 → v5 — poprawiono opis: profile.spec.ts sprawdza schemat 5 i bieżącą wersję treści bazy profilu; rekordy migracji sprawdza aktualizacja-v18.spec.ts.
  - `[false]` `[reject]` (blind) RAPORT §2 „każda z czterech historii przeszła przegląd” przy statusie in-progress — raport trafia do gałęzi razem z zakończeniem tego przeglądu (status done), więc zdanie jest prawdziwe w commicie.
  - `[low]` `[reject]` (blind) Spec Change Log pusty mimo zmian zakresu (pageerror, próg E03, §6 bez cofania) — poprawka polega na edycji specyfikacji tej budowy (odrzucane z zasady); zmiany wynikają z poleceń lidera (M1, M2) i są opisane w raporcie i dokumentach.
  - `[low]` `[patch]` (blind) drugi test aktualizacja-pomocnicze.spec.ts nie sprawdzał listy `network` — dodano asercję, że komunikat pliku pomocniczego jest na liście `network`.
  - `[medium]` `[patch]` (blind) wyjątek `isWebKitNetworkFailure` za szeroki i lista `network` nigdzie niewidoczna — zawężono do plików pomocniczych `sw.js`, `pwa-precache.json`, `dme-release.json` (przerwane pobranie np. banku oblewa test; nowy test), lista dołączana do wyniku testu (`attachNetwork`).
  - `[medium]` `[patch]` (blind) krok offline wyłącza wszystkie kontrole — odpowiedzi ≥ 400 są teraz zbierane zawsze (offline odpowiada tylko Service Worker), pauza dotyczy wyłącznie błędów konsoli (oczekiwane nieudane sprawdzenie `dme-release.json`); nowy test.
  - `[medium]` `[defer]` (blind) brak e2e dla zamknięcia karty w trakcie pobierania aktualizacji z 39d9d46 i dla drugiej karty starej wersji („Aktualizacja danych czeka”) — poza kryteriami historii; wpis w `deferred`.
  - `[low]` `[patch]` (blind) instrukcje iPhone bez zalecenia „zamknij aplikację, gdy aktualizacja trwa ponad minutę”, uzasadnienie „stara pula nie może pozostać” nie pasuje do dodatku — dopisano krok 5 w MIGRACJA_WEBINARY.md §4 i zdanie w INSTALACJA_IPHONE.md §5, zmieniono uzasadnienie.
  - `[low]` `[patch]` (blind) „92 testy w 17 plikach” — poprawiono na 15 plików.
  - `[low]` `[patch]` (blind) brak wyjaśnienia 0 WARN w check-offline (przy V18: 2 WARN) — dopisano, że to zależne od czasu zachowanie WebKit (20/21 plików zachowane w tym przebiegu); część „check-offline nie porównuje pliku z repo” odrzucona — zgodność `dist` z repozytorium sprawdza check-dist (87/87).
  - `[low]` `[patch]` (blind) komentarze vite.config.ts: „figury SVG”, „docelowy bank 2000–3000 pytań” — poprawiono.
  - `[low]` `[patch]` (blind) test MIGRACJA_WEBINARY.md nie pilnował §4 i części liczb — dodano testy: nazwy skryptów przejęcia (`takeoverFileName`) i znaczniki (`DATA_EPOCH`), liczba źródeł, wycofanych ID i grupy profilu z plików; §1 wymienia `validate_addendum.py` (z testem).
  - `[low]` `[patch]` (blind) próg E03 80 tuż nad 72; README odsyła do nieistniejącego schematy.spec.ts; RAPORT §9 bez E2E_PORT — poprawiono README i §9; próg odrzucony (kolejny dodatek do THER pokaże SKIP w wynikach e2e i wymaga wiersza §6 — test raportu; inna konstrukcja testu to więcej niż prosta poprawka).
  - `[false]` `[reject]` (edge) `expect.poll` przy zniszczonym kontekście nie ponawia — Playwright łapie wyjątki generatora w `expect.poll` i ponawia do limitu czasu; ten sam wzorzec przechodzi w obu przeglądarkach (90/90 i przebiegi V18).
  - `[medium]` `[patch]` (edge) 404 „z SW” nieodróżnialne od 404 serwera — test sprawdza teraz, że karta jest kontrolowana przez nowy SW i że w czasie zapytań „SW” żadne żądanie `data/` nie dotarło do serwera; potem osobno 404 z serwera.
  - `[medium]` `[patch]` (edge) lista `network` nigdy nie sprawdzana — ten sam powód co wyjątek WebKit wyżej (zawężenie + załącznik).
  - `[medium]` `[patch]` (edge) twierdzenie „0 błędów … poza celowymi” z nieograniczonym wyjątkiem — ten sam powód; opis w RAPORT §3 poprawiony (lista plików pomocniczych).
  - `[low]` `[reject]` (edge) twierdzenie w specyfikacji „aktualizacja-v18.spec.ts bez zmian zachowania” — dotyczyło refaktoru fazy A; zaostrzenie (pageerror) to zamierzona poprawka M2 z recenzji lidera, opisana w raporcie.
  - `[low]` `[reject]` (intent) 404 sprawdzone na atrapie SW i lokalnym serwerze, nie na GitHub Pages — kontrola publicznego adresu jest możliwa dopiero po wdrożeniu; zapisana w RAPORT §7 jako krok do wykonania.
  - `[low]` `[reject]` (intent) stara aplikacja budowana z commita 39d9d46, nie z bajtów produkcji — zgodne ze specyfikacją (git archive), ten sam kod źródłowy; lustro produkcji zostaje w kopii.
  - `[low]` `[reject]` (intent) tryb standalone z ikony nieobjęty e2e — ograniczenie Playwright, opisane jako NOT RUN (RAPORT §6, G05).
  - `[low]` `[reject]` (intent) przepływy po aktualizacji tylko na profilu Moniki, panel WB w Teście przypadkowy — kryteria wymagają migracji każdego profilu (sprawdzone dla obu) i działania trybów; Free Flow wymusza pytanie WB ze źródłem (online i offline).
  - `[low]` `[reject]` (intent) offline = niedostępny serwer, nie tryb samolotowy — ograniczenie Playwright WebKit (`setOffline`), opisane w RAPORT §6.
  - `[low]` `[patch]` (intent) wyjątki od „0 błędów” — ten sam powód co wyjątek WebKit (zawężenie + załącznik).
  - `[false]` `[reject]` (intent) §6 bez procedury cofnięcia mimo planu „kopia i cofnięcie” — intencja i SPEC nie wymagają cofnięcia; zwykły revert jest szkodliwy (baza v5, sesje nowej wersji) — poprawka M1 z recenzji lidera.
  - `[low]` `[reject]` (intent) instrukcja iPhone niesprawdzona na urządzeniu — G05 NOT RUN, opisane wprost.
  - `[false]` `[reject]` (intent) zmiana progu E03 poza zakresem — bez niej test E03 zostałby po cichu pominięty na nowej puli (THER 72 rodziny); opisane w RAPORT §6.
  - `[low]` `[reject]` (intent) wyniki przebiegów w raporcie to tekst — raport podaje komendy (§9) i datę przebiegu; test raportu sprawdza zgodność z plikami, nie liczby przebiegów (zmieniają się z kodem).

## Design Notes

Faza A nie może przejść e2e aktualizacji: bez historii 1 nowy build ma ten sam znacznik treści co `39d9d46`, więc nie ma przejęcia. W fazie A uruchamia się tylko część „przed aktualizacją” nowego e2e (asercje stanu starej aplikacji) oraz pełny `aktualizacja-v18.spec.ts` po refaktorze. Pytanie WB w Free Flow: losowanie do skutku (do 40 pytań; 247/947 ≈ 26% na pytanie).

## Verification

**Commands:**
- `npm test` -- faza A: wszystkie przechodzą poza znanym niestabilnym `tests/domain/freeflow.test.ts` (timeout); faza B: wszystkie.
- `npm run typecheck` -- bez błędów.
- `npm run build` -- PASS.
- `E2E_SKIP_BUILD=1 BASE_PATH=/ E2E_WORKERS=2 npx playwright test tests/e2e/aktualizacja-v18.spec.ts` -- faza A: PASS (Chromium i WebKit, 1 znany SKIP WebKit).
- `E2E_SKIP_BUILD=1 BASE_PATH=/ E2E_WORKERS=2 npx playwright test` -- faza B: wszystkie PASS poza opisanymi SKIP.
- `node scripts/check-offline.mjs --base /` -- faza B: 0 FAIL.

## Auto Run Result

Status: done

**Zmiana.** Service Worker i konfiguracja nie miały wartości V18 na sztywno (wszystko z `CONTENT_RELEASE`) — po wydaniu „V18 + webinary” przejęcie kart i 404 dla plików V18 działają bez zmian logiki; poprawiono tylko komentarze i komunikat builda, a `check-offline.mjs` czyta plik banku z `dist/dme-release.json`. Doszły: testy SW przejścia z V18 (syntetyczne i bieżące wydanie), e2e aktualizacji zainstalowanej aplikacji z produkcji `39d9d46` z dwoma profilami (przejęcie, migracja v4 → v5 każdego profilu, „Kontynuuj”, historia z przeglądem, „O bazie” 947/247, Test z „Moje błędy”, Test 20, runda błędów, Free Flow z pytaniem WB i panelem źródła bez `<a>`, 404 V18/V15 z SW i z serwera, offline), wspólny moduł e2e z kontrolą nieobsłużonych wyjątków (`pageerror`), dopasowanie ścieżek z V15 (`b6f9201`, `b50eb19`) do schematu v5, dokumentacja wydania i raport kontroli.

**Pliki.**
- `tests/pwa/tresc-sw.test.ts` — przejście ze znacznika V18 na następne i bieżące wydanie, 404 plików V18/V15.
- `tests/e2e/aktualizacja-webinary.spec.ts` (nowy) — e2e z produkcji `39d9d46`.
- `tests/e2e/aktualizacja.ts` (nowy) — wspólne narzędzia e2e aktualizacji; `collectProblems` z `pageerror`, odpowiedziami ≥ 400 także offline i osobną listą komunikatów WebKit o plikach pomocniczych.
- `tests/e2e/aktualizacja-pomocnicze.spec.ts` (nowy) — testy `collectProblems`.
- `tests/e2e/aktualizacja-v18.spec.ts`, `tests/e2e/profile.spec.ts` — ścieżki z V15 do bieżącego wydania (v3 → v5).
- `tests/e2e/dostepnosc.spec.ts` — próg E03 80 rodzin (najmniejsza dziedzina wydania: THER, 72).
- `tests/docs/migracja-webinary.test.ts` (nowy) — dokument wydania zgodny z plikami i kodem.
- `vite.config.ts`, `scripts/sw-takeover.mjs`, `scripts/check-offline.mjs` — komentarze, komunikat, odczyt pliku banku z `dme-release.json`.
- `docs/MIGRACJA_WEBINARY.md` (nowy), `docs/RAPORT_KONTROLI.md`, `docs/MIGRACJA_V18.md`, `docs/INSTALACJA_IPHONE.md`, `docs/PROFILE.md`, `docs/WDROZENIE.md`, `README.md`, `docs/zrzuty/` (zrzuty z e2e na nowym wydaniu).

**Przegląd.** 30 uwag: poprawki 16 wierszy (wg werdyktu: medium 7, low 9; wpisy po grupowaniu: medium 5 — WDROZENIE, opis profile.spec, wyjątek WebKit/lista `network`, odpowiedzi ≥ 400 offline, 404 SW vs serwer), 2 odłożone (`deferred`: nieaktualne ARCHITEKTURA_APP/MANIFEST_PULI sprzed tej historii; brak e2e zamknięcia karty i drugiej karty dla ścieżki z `39d9d46`), pozostałe odrzucone z uzasadnieniem w Review Triage Log. Poprawki zastosował orkiestrator (podagent implementacji z fazy A nie znał zmian fazy B).

**Zalecenie kolejnego przeglądu: tak.** Na pierwszym przebiegu poprawiono 5 wpisów `medium`. Niezweryfikowane ryzyko: zawężona lista plików pomocniczych w `collectProblems` (`sw.js`, `pwa-precache.json`, `dme-release.json`) i zbieranie odpowiedzi ≥ 400 w kroku offline sprawdzono jednym pełnym przebiegiem e2e — w kolejnych przebiegach WebKit może zgłosić przerwane pobranie innego pliku (np. fontu) przy przeładowaniu karty, co obleje test bez błędu aplikacji.

**Weryfikacja (15.11.2026, po scaleniu historii 1–3 z poprawkami 2b i 3b):**
- `npm run typecheck` — PASS.
- `npx vitest run` — 864/864 PASS (69 plików); we wcześniejszych przebiegach przy obciążonym komputerze 1–2 przekroczenia limitu 5 s (`freeflow.test.ts`, raz `regresje-weryfikacji.test.ts`).
- `BASE_PATH=/ npm run build` — PASS (precache 21 wpisów, 2699,37 KiB).
- `node scripts/check-dist.mjs --dist dist --base /` — 87/87 PASS.
- `node scripts/check-offline.mjs --base /` — 54 kontrole, 0 FAIL, 0 WARN.
- `E2E_SKIP_BUILD=1 BASE_PATH=/ E2E_PORT=4184 E2E_WORKERS=2 npx playwright test` — 92 PASS, 2 SKIP (znane WebKit: zamknięcie karty w trakcie aktualizacji, `setOffline`), 0 FAIL; `aktualizacja-webinary.spec.ts` PASS w WebKit i Chromium.
- Czerwone przed kodem: testy SW bieżącego wydania (na treści V18), test dokumentu (przed uzupełnieniem), §6 bez revertu, `pageerror`, plik pomocniczy vs bank, ≥ 400 offline.

**Ryzyka.** Fizyczny iPhone (G05): NOT RUN — emulacja WebKit nie jest testem urządzenia. Historie 1 i 2 muszą trafić na produkcję razem. Po wdrożeniu nie wolno cofać zmiany zwykłym revertem (MIGRACJA_WEBINARY.md §6). Kontrola publicznego adresu po wdrożeniu — do wykonania (RAPORT §7).

