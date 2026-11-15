# Raport kontroli — Doktor Monika Egzamin

Raport końcowy według `05_KONTROLA/01_KRYTERIA_ODBIORU.txt` (kryterium G07). Dotyczy wydania **„V18 + webinary” — 947 pytań** (`dme-v18-webinary-2026-11-15-8622d52b9a42`: niezmieniony bank V18 z 700 pytaniami + 247 pytań z transkrypcji webinarów jako dodatek) z migracją danych lokalnych wszystkich profili (IndexedDB v5). Przebieg kontroli: **15.11.2026 (Europe/Warsaw)**. Raport podaje osobno: wersje i środowisko (§1), stan kodu i buildu (§2), stan testów (§3), pulę (§4), status recenzji treści (§5), testy niewykonane i pominięte (§6), wdrożenie (§7) oraz macierz kryteriów A01–G07 (§8). Opis wydania, migracji, kopii i postępowania przy awarii: `docs/MIGRACJA_WEBINARY.md`. Poprzednie raporty (V15 z 24–25.10.2026, V18 z 09.11.2026) są w historii git tego pliku.

PASS testu albo kontroli oznacza, że aplikacja działa zgodnie z wymaganiami i że struktura danych jest poprawna. Nie jest oceną poprawności medycznej pytań ani prognozą wyniku egzaminu.

**Trzy osobne oceny:**

- **Gotowość techniczna aplikacji: tak, w emulacji i lokalnie; jeszcze niewdrożona (§7).** Typecheck, Vitest, build, `check-dist`, `check-offline` i e2e w WebKit „iPhone 15” oraz w Chromium (§2–§3), w tym aktualizacja zainstalowanej aplikacji z obecnej produkcji (`39d9d46`, V18) z dwoma profilami oraz ze starszych wersji V15 (`b6f9201`, `b50eb19`). Testu na fizycznym iPhonie (G05) nie wykonano (§6).
- **Liczebność puli: dokładnie 947 pytań z allowlisty wydania** (700 V18 + 247 WB). Dawne cele (2000 pytań, 1000 na poziom) **nie zostały osiągnięte** i decyzją właściciela z 09.11.2026 nie obowiązują — aplikacja nie dopisuje pytań (§4, A03).
- **Recenzja treści.** Żadne pytanie nie ma recenzji lekarskiej; 247 pytań WB ma klucz sprawdzony przez AI względem transkrypcji (napisy automatyczne), bez recenzji klinicznej; scalenie nie jest nową recenzją (§5).

Zgodność raportu z repozytorium sprawdza test `tests/docs/raport-kontroli.test.ts` (projekt Vitest `docs`): sekcje, pełna macierz, status G05, liczby, wersja i SHA-256 pliku `public/data/bank-475c1fef0099.json`, liczba wycofanych ID, nazwanie poziomów poniżej 1000 pytań (A03 nie może mieć PASS), opis każdego pominiętego testu e2e i adres wdrożenia. Dokument wydania sprawdza `tests/docs/migracja-webinary.test.ts`.

## 1. Wersje i środowisko

| Element | Wartość |
|---|---|
| Aplikacja | `doktor-monika-egzamin` 0.1.0; przebieg na gałęzi `story/4` = `feat/webinary-247` z historiami 1–3 (treść, migracja v5, interfejs źródła webinaru) + historia 4 (Service Worker, e2e, dokumentacja); Pull Request do `main` (§7) |
| Bank pytań | `dme-v18-webinary-2026-11-15-8622d52b9a42`, plik `public/data/bank-475c1fef0099.json` (szczegóły w §4) |
| Wejścia treści | bank V18 bajt w bajt (`content/v18/bank.json`, SHA-256 `5db40505…66f6`) i dodatek `content/webinary-2026-11-15/bank_webinar_addendum.json` (`webinar-addendum-2026-11-15-2fdd243bcfc0`, SHA-256 zgodny z `MANIFEST.json`); `python3 -I content/webinary-2026-11-15/validate_addendum.py content/webinary-2026-11-15` — **PASS: 247 pytań, tryb append, unikalne ID, struktura i SHA** (walidator nie ocenia poprawności medycznej) |
| System | macOS 26.7 (Darwin 25.6.0), Apple Silicon; w czasie przebiegu komputer obciążony testami innych projektów. Testy e2e z `--workers=2` (`E2E_WORKERS=2`), port `E2E_PORT=4184` |
| Node.js | 24.18.1 |
| TypeScript / Vite / vite-plugin-pwa / Vitest | 7.0.2 / 8.3.5 / 2.0.0 / 5.0.5 |
| Playwright | 1.63.0. Projekty: WebKit (rev. 2359) z emulacją „iPhone 15” (393×852, DPR 3, dotyk) oraz Chromium (rev. 1243) w trybie mobilnym 393×852 |
| Stare aplikacje w e2e aktualizacji | `39d9d46` (obecna produkcja od 09.11.2026: V18, IndexedDB v4, profile), `b6f9201` (produkcja 25.10–09.11.2026: V15 z profilami) oraz `b50eb19` (V15 bez profili) — `git archive` do `test-results/`, build z `BASE_PATH=/` |
| Urządzenie fizyczne | **brak**: nie wykonano testu na iPhonie (G05, §6) |

## 2. Stan kodu i buildu

Zmiany z 15.11.2026 (szczegóły: `docs/MIGRACJA_WEBINARY.md`; specyfikacja `_bmad-output/specs/spec-webinary-247/`). Każda z czterech historii przeszła przegląd w `bmad-build-auto` (warstwy recenzentów bez dostępu do wniosków wykonawcy):

- Treść: `scripts/webinary-addendum.mjs` łączy bajtowo niezmieniony bank V18 z dodatkiem w jedno wydanie (adapter, idempotentne scalanie, konflikt ID z inną treścią przerywa budowanie, raport identycznych pytań: 0 par). `public/data/` zawiera wyłącznie trzy pliki wydania; pliki V18 przeniesione jako wejście do `content/v18/`. Allowlista wydania w `content/v18-webinary/allowed_question_ids.json`, w kodzie jako `src/persistence/v18Allowlist.ts` (947 wierszy). Kontroler odrzuca bank, którego katalog nie jest równy allowliście.
- Migracja IndexedDB v4 → v5 (`createMigrationV5` w `src/persistence/schema.ts`, `transformToCurrentBank` z wydaniem docelowym `BankTarget` w `bankMigration.ts`) dla każdego profilu osobno, w jednej transakcji `versionchange`: sesje V18 (także otwarte i puste) zostają aktywne z nową wersją banku; próby, „Moje błędy” i zgłoszenia zostają. v4 to od teraz krok historyczny bez zmian danych (baza v3/v1 przechodzi do v5 jedną transformacją). Ta sama transformacja przy imporcie i eksporcie kopii; kopia zachowuje pola dowodu webinaru.
- Interfejs: po odpowiedzi na pytanie WB wiersz źródła webinaru z przyciskiem „Źródło webinaru” i lokalnym panelem (plik, cytat z automatycznych napisów, zastrzeżenia) — bez żadnego linku; „O bazie pytań” z wierszem „Pytania z webinarów”; teksty z liczbami wydania z `CONTENT_RELEASE`.
- Service Worker: bez zmian logiki — nazwy plików, SHA i wersja treści pochodzą z `CONTENT_RELEASE`, więc nowe wydanie zmienia znacznik treści i nazwę skryptu przejęcia (`dme-sw-takeover-475c1fef0099-profile-1.js`): przejęcie kart jak od V15, każdy plik w `data/` poza trzema bieżącymi (w tym pliki V18) → 404. `scripts/check-offline.mjs` czyta plik banku z `dist/dme-release.json`.

| Kontrola | Komenda | Wynik |
|---|---|---|
| Build produkcyjny | `BASE_PATH=/ npm run build` | **PASS** (15.11.2026, po scaleniu historii 1–3): typecheck, `vite build`; precache SW 21 wpisów (2699,37 KiB), w tym `data/bank-475c1fef0099.json` (1 901 801 B), lista wycofanych ID, profil i skrypt przejęcia `dme-sw-takeover-475c1fef0099-profile-1.js`; `dme-release.json` poza precache |
| Statyczna kontrola `dist` | `node scripts/check-dist.mjs --dist dist --base /` | **87/87 PASS** (FAIL 0, WARN 0; rozmiar `dist` 2 784 515 B). Między innymi: SHA-256 banku wydania, `bank_version` trzech plików i `dme-release.json`, 947 pytań (647 / 200 / 100) zgodne z `counts`, **ID banku = allowlista wydania (947 = V18 700: 600 V16 + 100 V17, WB 247)**, 247 pytań z webinarów z oznaczeniem `[webinar]` i 17 źródeł webinarów bez url/doi/pmid, 3120 wycofanych ID (żadne w banku), profil obejmuje każde pytanie dokładnie raz; w `data/` wyłącznie trzy pliki wydania; **brak plików V18 (`data/bank-5db40505308f.json` i towarzyszące) i starszych (`data/bank.json`, pliki V15) w `dist`, w precache i w kodzie/JSON**; skrypt przejęcia z regułą 404 dla innych plików w `data/` |

## 3. Stan testów

| Kontrola | Komenda | Wynik | Uwagi |
|---|---|---|---|
| Typy | `npm run typecheck` | **PASS** | 4 konfiguracje `tsc`: domain, app, test, node |
| Testy jednostkowe i integracyjne | `npx vitest run` | **864/864 PASS** (69 plików; 15.11.2026, 20:24, po scaleniu poprawek historii 2 i 3 z recenzji). Przy obciążonym komputerze w części wcześniejszych przebiegów 1–2 testy przekraczały limit 5 s (`tests/domain/freeflow.test.ts`, raz `tests/app/regresje-weryfikacji.test.ts`) — przekroczenia czasu, nie błędne wyniki | Nowe w tym wydaniu: `tests/domain/webinary-addendum.test.ts`, `webinary-cli.test.ts`, `bank-webinary.test.ts`, `catalog-webinar.test.ts` (scalanie, idempotencja, konflikty, 700 rekordów V18 głęboko równych wejściu, 247 WB 1:1 z dodatkiem, walidacja dowodu), `tests/persistence/migracja-webinary.test.ts` i `tests/app/migracja-webinary.test.ts` (migracja v4 → v5, dwa profile, idempotencja, przerwanie, kopia), `tests/ui/zrodlo-webinaru*.test.tsx`, `o-bazie-webinary.test.tsx`, `teksty-wydania.test.tsx` (panel źródła bez linków, liczniki), przejście SW z V18 w `tests/pwa/tresc-sw.test.ts`, `tests/docs/migracja-webinary.test.ts` |
| E2E | `E2E_SKIP_BUILD=1 BASE_PATH=/ E2E_PORT=4184 E2E_WORKERS=2 npx playwright test` | **92 PASS, 2 SKIP, 0 FAIL** (94 testy w 15 plikach; 15.11.2026, 20:19–20:23, 4,1 min; WebKit 45 PASS + 2 SKIP, Chromium 47 PASS) | `aktualizacja-webinary.spec.ts`: stara aplikacja z obecnej produkcji (`39d9d46`, V18) z danymi w dwóch profilach wpisanymi przez UI (ukończony test z błędem, Free Flow, otwarty test ze zgłoszeniem) → podmiana `dist` pod tym samym adresem → nowy SW sam przejmuje otwartą kartę; `dme-release.json` z nową wersją; każdy profil migruje przy własnym otwarciu (v4 → v5, rekord `migration:bank-v18-webinary`, rekord V18 bez zmian); każda sesja V18 aktywna z wynikiem, slotami i nową wersją banku, bez `legacy`; próby, „Moje błędy” i zgłoszenia bez zmian; „Kontynuuj” dokańcza otwarty test (4 z 5), historia z przeglądem dawnych odpowiedzi; „O bazie pytań” — 947 i „Pytania z webinarów” 247; Test z „Moje błędy” (błędy z V18 jako pozycje obowiązkowe), Test 20 **12/20 niezaliczony**, runda błędów, Free Flow — wyłącznie ID z allowlisty, bez powtórzeń; pytanie WB z przyciskiem „Źródło webinaru”, panelem z cytatem i **0 elementów `<a>`**; pliki V18 i V15 → 404 z SW i z serwera, brak plików V18 w Cache Storage; start offline z pytaniem WB i panelem źródła; **0 błędów konsoli, 0 nieobsłużonych wyjątków strony i 0 odpowiedzi ≥ 400** (poza celowymi 404 dawnych plików i nieudanym sprawdzeniem wersji offline; komunikaty WebKit o przerwanym pobieraniu plików pomocniczych `sw.js`, `pwa-precache.json`, `dme-release.json` przy przeładowaniu karty lub bez sieci są dołączane do wyniku testu jako osobna lista — `tests/e2e/aktualizacja-pomocnicze.spec.ts`). `aktualizacja-v18.spec.ts`: z V15 (`b6f9201`) do bieżącego wydania jedną migracją v3 → v5, Test 20 13/20 zaliczony i 12/20 niezaliczony. `profile.spec.ts`: z V15 bez profili (`b50eb19`) prosto do bieżącego wydania. `dostepnosc.spec.ts` E03 na dziedzinie THER (72 rodziny). Pominięcia: §6 |
| Service Worker w przeglądarkach | `node scripts/check-offline.mjs --base /` | **54 kontrole, 0 FAIL, 0 WARN** | Chromium i WebKit: rejestracja w scope `/`, komplet precache (21/21), start offline z `data/bank-475c1fef0099.json` (947 pytań) i fontami, aktualizacja na żądanie (`SKIP_WAITING`), odrzucona nieudana aktualizacja, przerwane pierwsze przygotowanie i obejście w aplikacji (S24a). Plik banku skrypt czyta z `dist/dme-release.json`. W przebiegu przed scaleniem historii 3, przy obciążonym komputerze, jedna kontrola WebKit S24a („Spróbuj ponownie”) przekroczyła limit 30 s; w przebiegu końcowym (ten sam `dist` co e2e) — PASS. Brak WARN (przy V18: 2 WARN w WebKit) nie oznacza zmiany w aplikacji: w tym przebiegu WebKit zachował 20/21 plików przerwanego przygotowania i dociągnął tylko brakujący — zależy to od czasu w silniku, więc w kolejnych przebiegach WARN może wrócić |

Testy e2e nie czytają klucza z interfejsu: klucz pochodzi z pliku banku na dysku, a zapis sprawdzają przez odczyt IndexedDB w stronie.

## 4. Pula pytań

Liczby odczytano z pliku `public/data/bank-475c1fef0099.json`. Test `tests/docs/raport-kontroli.test.ts` porównuje je z tym plikiem.

| Pole (`bank-475c1fef0099.json`) | Wartość |
|---|---|
| `bank_version` | `dme-v18-webinary-2026-11-15-8622d52b9a42` |
| SHA-256 pliku (wynik `scripts/webinary-addendum.mjs`, bajtowo powtarzalny) | `475c1fef009903f4151cd8234ca279ece879a89b6dabfb86e5e29045f7af171e` |
| `counts.questions` | 947 |
| `counts.families` (rodziny = pojemność Testu „cały zakres”) | 939 |
| `counts.by_domain.ANAT` (anatomia) | 147 |
| `counts.by_domain.SKIN` (skóra i dermatologia) | 196 |
| `counts.by_domain.DEV` (urządzenia) | 263 |
| `counts.by_domain.INJ` (iniekcje) | 186 |
| `counts.by_domain.THER` (pozostałe terapie) | 72 |
| `counts.by_domain.SAFE` (bezpieczeństwo i prawo) | 83 |
| `counts.by_difficulty.basic` (300 V16 + 100 V17 i 247 WB z technicznym placeholderem) | 647 |
| `counts.by_difficulty.intermediate` | 200 |
| `counts.by_difficulty.advanced` | 100 |
| `counts.schematic` | 0 |
| `counts.webinar` w `CONTENT_RELEASE` (pytania `origin: webinar`) | 247 |
| `retired_question_ids` (plik `retired-question-ids-40450ecb4f2b.json`; te same ID co w V18, w tym 2987 ID V15; żadne nie występuje w banku) | 3120 |

**Skład.** Allowlista wydania: 700 ID V18 (600 `V16-…` i 100 `V17-…`, kolejność V18) oraz 247 ID `WB-…` (kolejność dodatku) — katalog aplikacji jest jej dokładnym odpowiednikiem (bez pominięć i bez ID spoza listy). Każdy z 700 rekordów V18 jest głęboko równy rekordowi z `content/v18/bank.json`. Liczby „przed + dodane = po”: `docs/MIGRACJA_WEBINARY.md` §2.

**Liczebność.** Dawny cel 2000 pytań **nie został osiągnięty** (947, brakuje 1053), a dawne minimum 1000 pytań na poziom nie jest spełnione: basic 647 < 1000, intermediate 200 < 1000, advanced 100 < 1000. Oba wymogi odwołał właściciel 09.11.2026 („nie dopisuj pytań w celu spełnienia dawnych wymogów”). Aplikacja nie dopisuje ani nie przekwalifikowuje pytań. Trudność nie jest pokazywana: `basic` w 100 pytaniach V17 i w 247 WB to techniczny placeholder.

**Profil treningowy** (`training-profile-a8bf8dbe7e3b.json`): `skin` 196, `facial_anatomy` 147, `other` 604 pytań, udziały 35/25/40 w całym zakresie (DECYZJE §6a, §7a). Przy teście o maksymalnym N (939) brakujące miejsca grup skin i facial_anatomy przechodzą na other — każda rodzina trafia do testu (`tests/domain/bank-smoke.test.ts`).

**Względem poprzedniej puli** (V18, 700 pytań): wszystkie 700 pytań zostają bez zmian, dochodzi 247 WB; nic nie usunięto i niczego nie dopisano na podstawie podobieństwa.

## 5. Status recenzji treści

| Pole | Wartość |
|---|---|
| `clinical_signoff` | false |
| `official_exam_question_bank` | false |
| `review_status: draft_pending_clinical_review` | 947 |
| `approved_for_question_key: true` | 0 |
| `content_check_status: independently_checked_draft` | 600 |
| `content_check_status: author_checked_draft` | 100 |
| `content_check_status: source_checked_AI_draft` | 247 |
| `counts.independently_checked_draft` | 600 |

- Status materiału (`status_pl` z banku): zdania V18 o scalonej puli 600 + 100 oraz „247 pytań z transkrypcji webinarów (napisy automatyczne): klucz sprawdzony przez AI względem transkrypcji, bez recenzji klinicznej.” Aplikacja pokazuje go w „O bazie” i w Ustawieniach.
- To **nie jest recenzja lekarska**: wszystkie klucze są robocze. Pytania WB to materiał egzaminacyjny z wykładów, a nie zweryfikowane aktualne wytyczne; cytaty pochodzą z automatycznych napisów i mogą zawierać błędy rozpoznawania mowy (`audio_verified: false`). To nie jest oficjalny bank pytań PTMEiAA, a wynik w aplikacji nie jest oceną komisji egzaminacyjnej.
- Treść V18 nie była zmieniana (porównanie 1:1 w `tests/domain/bank-webinary.test.ts` i `bank-v18.test.ts`); treść WB jest 1:1 z dodatkiem.

## 6. Testy niewykonane i pominięte

| Pozycja | Status | Powód | Co sprawdzono zamiast tego |
|---|---|---|---|
| G05: fizyczny iPhone w Safari i po „Do ekranu głównego”, w tym aktualizacja do wydania „V18 + webinary” z ikony | **NOT RUN** | brak urządzenia w środowisku wykonawczym | emulacja WebKit „iPhone 15” w e2e (to nie jest urządzenie ani tryb standalone). Protokół: `docs/INSTALACJA_IPHONE.md` §6 (wszystkie kroki NOT RUN, w tym 14a — aktualizacja do nowego wydania) |
| `aktualizacja-v18.spec.ts`: „V18: zamknięcie karty w trakcie pobierania aktualizacji i ponowne otwarcie kończy aktualizację” w projekcie WebKit | **SKIP** | Playwright WebKit (rev. 2359): pobieranie banku przez instalujący się Service Worker, przerwane zamknięciem jedynej karty, nie kończy się ani nie zgłasza błędu — nowy SW zostaje w stanie „installing” w tym samym kontekście przeglądarki, także po ponownym otwarciu karty (diagnoza 09.11.2026). Stara aplikacja poprawnie wykrywa nową wersję i pokazuje „Aktualizacja banku pytań…”. Nie wiadomo, czy prawdziwy Safari iOS zachowuje się tak samo | w Chromium ten sam test: PASS. Główne scenariusze aktualizacji (bez przerwania) w WebKit: `aktualizacja-webinary.spec.ts` i `aktualizacja-v18.spec.ts`. Zalecenie dla użytkowniczki, gdy komunikat „Aktualizacja banku pytań…” trwa ponad minutę: całkowicie zamknąć aplikację (przesunąć w górę w przełączniku aplikacji) i otworzyć ponownie przy włączonym internecie |
| `pwa.spec.ts`: „G02 + A04: offline (context.setOffline)” w projekcie WebKit | **SKIP** | Playwright WebKit przy `context.setOffline(true)` blokuje każdą nawigację, także obsługiwaną przez Service Workera — ograniczenie narzędzia | w Chromium: PASS; w WebKit offline sprawdzają `aktualizacja-webinary.spec.ts` i `aktualizacja-v18.spec.ts` (start offline po aktualizacji, serwer niedostępny) oraz `check-offline.mjs` |
| `dostepnosc.spec.ts`: E03 (brak zastępstwa dla wcześniejszej pozycji) | wykonany | test pomija się tylko, gdy najmniejsza dziedzina ma ponad 80 rodzin; w wydaniu „V18 + webinary” najmniejsza to THER z 72 rodzinami (w V18 była to SAFE z 36 — próg podniesiono z 60, aby test nie zniknął po dodaniu pytań) | — |
| Aktualizacja w trybie standalone (aplikacja z ikony) i w karcie zamrożonej w tle | **NOT RUN** | Playwright nie emuluje trybu standalone iOS ani zamrażania kart | fallback w kodzie (`dme-release.json` przy starcie i powrocie z tła, wiadomość `DME_CONTENT_UPDATE`) — `tests/pwa/tresc-sw.test.ts` |
| Rzeczywiste profile użytkowniczek | **NOT RUN** | dane są wyłącznie w telefonach; nie ma serwera ani kopii danych użytkowników | migracja sprawdzona na danych wpisanych przez UI produkcyjnej wersji `39d9d46` (V18) i wersji V15 (e2e) oraz na danych syntetycznych (Vitest) |
| Zgodność cytatów WB z nagraniami (odsłuch) | **NOT RUN** | poza zakresem (SPEC: bez poprawiania błędów ASR i bez linków do nagrań); cytaty są fragmentami automatycznych napisów, `audio_verified: false` | panel źródła oznacza cytat jako fragment automatycznych napisów; cytat i ID fragmentów 1:1 z dodatku (`tests/domain/bank-webinary.test.ts`) |
| Recenzja lekarska kluczy | **NOT RUN** | poza zakresem kontroli aplikacji | status w §5 |

## 7. Wdrożenie

Adres wdrożenia: **https://wiedza.doktormonika.pl/** (GitHub Pages z własną domeną, repozytorium https://github.com/lyzwad/doktor-monika-egzamin, publiczne; workflow „Publikacja na GitHub Pages” po scaleniu do `main`). Dawny adres https://lyzwad.github.io/doktor-monika-egzamin/ odpowiada `301` na nowy (przekierowanie GitHub Pages po ustawieniu własnej domeny). VPS nie obsługuje tej domeny; DNS bez zmian.

**Stan na 15.11.2026: wydanie „V18 + webinary” nie jest jeszcze wdrożone.** Na produkcji działa commit `39d9d46` (bank V18, 700 pytań, `0.1.0+39d9d46`). Wdrożenie nastąpi przez Pull Request z `feat/webinary-247` do `main` i workflow „Publikacja na GitHub Pages” (testy Vitest, build, `check-dist`, deploy). Historie 1 (treść) i 2 (baza v5) muszą trafić na produkcję razem — `docs/MIGRACJA_WEBINARY.md` §3. Kopia sprzed wdrożenia (lustro strony V18, pakiet git, konfiguracja Pages): `docs/MIGRACJA_WEBINARY.md` §6. Po wdrożeniu **nie wolno** cofać zmiany zwykłym `git revert` (telefony będą miały bazę v5 i sesje nowej wersji banku, których aplikacja V18 nie otworzy) — przy awarii wyłącznie poprawka „do przodu” (§6 tamtego dokumentu).

Kontrola publicznego adresu po wdrożeniu (do wykonania): `dme-release.json` z `bankVersion` `dme-v18-webinary-2026-11-15-8622d52b9a42` i `bankSha256` `475c1fef…171e`; `data/bank-475c1fef0099.json` → `200`, 947 rekordów równych allowliście; pliki V18 (`data/bank-5db40505308f.json` i towarzyszące) oraz V15 → `404`.

**Poprzednie wdrożenie — V18 (09.11.2026).** Pull Request https://github.com/lyzwad/doktor-monika-egzamin/pull/3 scalony (squash) jako commit `954194d` (raport `39d9d46`); workflow `42695955540` — **success**. Kontrola publicznego adresu 09.11.2026: `dme-release.json` z wersją V18, bank 700 rekordów równych allowliście, dawne pliki V15 → `404`; WebKit „iPhone 15” i Chromium mobile na adresie produkcyjnym — PASS, 0 błędów konsoli, 0 odpowiedzi ≥ 400 (szczegóły w historii git tego pliku).

Aktualizacji już zainstalowanej aplikacji nie da się sprawdzić na produkcji po wdrożeniu (stara wersja nie jest już serwowana) — sprawdza ją e2e `aktualizacja-webinary.spec.ts` na tej samej wersji, która jest na produkcji (`39d9d46`). Fizyczny iPhone: G05 **NOT RUN**.

## 8. Macierz kryteriów A01–G07

Wynik opiera się na przebiegach z §2–§3 (15.11.2026, wydanie „V18 + webinary”). G05 pozostaje NOT RUN. PASS w emulacji przeglądarkowej nie zastępuje G05.

Środowiska: **V** — Vitest 5.0.5; **W** — Playwright WebKit, emulacja „iPhone 15”; **C** — Playwright Chromium mobile; **D** — `check-dist.mjs`; **O** — `check-offline.mjs`; **K** — inspekcja kodu i dokumentacji; **P** — kontrola publicznego adresu (§7; dla tego wydania jeszcze niewykonana).

| ID | Wynik | Dowód | Środowisko | Ograniczenie |
|---|---|---|---|---|
| A01 | PASS | `tests/ui/App.test.tsx` „Start (S01–S02)” | V, K, W | — |
| A02 | PASS | e2e `smoke.spec.ts`; `check-dist.mjs` (manifest) | W, C, D | bez porównania pikselowego; wygląd na urządzeniu zależy od G05 |
| A03 | PARTIAL | `tests/domain/bank-webinary.test.ts` (947 = allowlista, 700 V18 + 247 WB, treść 1:1), `check-dist.mjs`, `tests/ui/o-bazie-webinary.test.tsx` | V, D | dawne cele 2000 pytań i 1000 na poziom niespełnione (947; basic 647, intermediate 200, advanced 100) i odwołane przez właściciela 09.11.2026 |
| A04 | PASS | e2e `smoke.spec.ts`, `pwa.spec.ts`; `check-dist.mjs` | W, C, D | linki do źródeł otwiera tylko użytkowniczka; źródła webinarów nie mają linków |
| B01 | PASS | `tests/domain/catalog.test.ts`, `tests/domain/catalog-webinar.test.ts`; katalog wydania bez odrzuceń (`tests/domain/bank-webinary.test.ts`) | V | — |
| B02 | PASS | `tests/domain/answer.test.ts` „B02”; e2e `flows.spec.ts` | V, W, C | — |
| B03 | PASS | `tests/domain/answer.test.ts` „B03”; `tests/ui/AnswerCard.test.tsx`; e2e `interactions.spec.ts` | V, W, C | tap na fizycznym ekranie zależy od G05 |
| B04 | PASS | e2e `flow-a.spec.ts` (przed odpowiedzią brak klucza i wyjaśnienia w DOM) | V, W, C | — |
| B05 | PASS | `tests/ui/AnswerCard.test.tsx`; e2e `flow-a.spec.ts` | V, W, C | — |
| B06 | PASS | `tests/ui/ExplanationPanel.test.tsx`, `tests/ui/zrodlo-webinaru.test.tsx`; e2e `flow-a.spec.ts` (źródło z linkiem po odpowiedzi), `aktualizacja-webinary.spec.ts` (pytanie WB: przycisk „Źródło webinaru”, panel z cytatem, 0 elementów `<a>`, także offline) | V, W, C | — |
| C01 | PASS | `tests/domain/pool.test.ts`; e2e `interactions.spec.ts` „C01” (pojemność z banku, bez wyboru trudności) | V, W, C | klawiatura iOS zależy od G05 |
| C02 | PASS | `tests/domain/test-flow.test.ts` | V | — |
| C03 | PASS | `tests/domain/test-flow.test.ts`; `tests/ui/QuestionScreen.test.tsx` | V | — |
| C04 | PASS | `tests/domain/scoring.test.ts`; e2e `aktualizacja-v18.spec.ts` (13/20 zaliczony, 12/20 niezaliczony), `aktualizacja-webinary.spec.ts` (12/20 niezaliczony) | V, W, C | — |
| C05 | PASS | `tests/domain/test-flow.test.ts`; otwarty test V18 dokończony po aktualizacji (e2e `aktualizacja-webinary.spec.ts`, `tests/app/migracja-webinary.test.ts`) | V, W, C | — |
| D01 | PASS | `tests/domain/retry.test.ts`; e2e `aktualizacja-webinary.spec.ts`, `aktualizacja-v18.spec.ts` (runda błędów na nowym wydaniu) | V, W, C | runda błędów z sesji sprzed V18 niedostępna (`LEGACY_SESSION`) |
| D02 | PASS | `tests/domain/retry.test.ts`, `tests/domain/niezmienniki.test.ts` | V | — |
| D03 | PASS | `tests/domain/retry.test.ts` | V | — |
| D04 | PASS | `tests/domain/selection.test.ts`; `tests/domain/bank-smoke.test.ts` (N = 939 obejmuje każdą rodzinę) | V | — |
| D05 | PASS | `tests/domain/freeflow.test.ts`; `tests/domain/bank-smoke.test.ts`; e2e `aktualizacja-webinary.spec.ts` (Free Flow z pytaniem WB, także offline) | V, W, C | — |
| D06 | PASS | `tests/domain/my-errors.test.ts`; „Moje błędy” z V18 zachowane po migracji i użyte w Teście (`tests/persistence/migracja-webinary.test.ts`, e2e `aktualizacja-webinary.spec.ts`) | V, W, C | — |
| D07 | PASS | `tests/domain/my-errors.test.ts` | V | — |
| E01 | PASS | `tests/domain/report.test.ts` | V | — |
| E02 | PASS | `tests/domain/report.test.ts`; e2e `flows.spec.ts` | V, W, C | — |
| E03 | PASS | `tests/app/regresje-weryfikacji.test.ts`; e2e `dostepnosc.spec.ts` „E03” (dziedzina THER, 72 rodziny) | V, W, C | — |
| E04 | PASS | `tests/domain/report.test.ts`; e2e `flows-extra.spec.ts` | V, W, C | — |
| E05 | PASS | `tests/domain/report.test.ts`; e2e `flows.spec.ts` | V, W, C | — |
| E06 | PASS | `tests/domain/report.test.ts`; zgłoszenia V18 aktywne po migracji (`tests/persistence/migracja-webinary.test.ts`, e2e `aktualizacja-webinary.spec.ts`) | V, W, C | — |
| F01 | PASS | `tests/persistence/commit.test.ts`; e2e `flows.spec.ts` | V, W, C | zamknięcie aplikacji z ekranu głównego iOS zależy od G05 |
| F02 | PASS | `tests/persistence/kopia.test.ts`; `tests/persistence/migracja-webinary.test.ts` (kopia z V18 = migracja bazy, pola dowodu webinaru zachowane, zły typ → nieprawidłowa kopia); `tests/app/migracja-webinary.test.ts` (eksport → wczytanie) | V, W, C | zapis pliku w aplikacji Pliki zależy od G05 |
| F03 | PASS | `tests/persistence/kopia.test.ts`; automatyczne kopie bezpieczeństwa przekształcone migracją v5 | V, W, C | — |
| F04 | PASS | `tests/domain/history.test.ts`; e2e `aktualizacja-webinary.spec.ts` (wyniki V18 w historii z przeglądem odpowiedzi po aktualizacji) | V, W, C | przegląd treści sesji sprzed V18 celowo niedostępny |
| F05 | PASS | `tests/domain/history.test.ts`; wykres bez zmian liczb po migracji | V, W, C | — |
| G01 | PASS | build i `check-dist.mjs` (§2); e2e `layout.spec.ts` | D, W, C, O | — |
| G02 | PASS | e2e `pwa.spec.ts`, `aktualizacja-webinary.spec.ts` i `aktualizacja-v18.spec.ts` (offline po aktualizacji); `check-offline.mjs` | W, C, O | `setOffline` w WebKit: SKIP (§6); tryb samolotowy na iPhonie zależy od G05 |
| G03 | PASS | e2e `integration.spec.ts`; e2e `aktualizacja-webinary.spec.ts` (przejęcie karty z produkcji `39d9d46`, migracja każdego profilu, 404 plików V18); `tests/pwa/tresc-sw.test.ts`; `check-offline.mjs` | W, C, O, V | przerwana instalacja w WebKit: SKIP (§6); Safari iOS zależy od G05 |
| G04 | PASS | `check-dist.mjs` (brak plików V18 i starszych banków, brak hostów zewnętrznych); e2e `smoke.spec.ts` | D, W, C | — |
| G05 | NOT RUN | brak fizycznego iPhone'a; protokół `docs/INSTALACJA_IPHONE.md` §6 niewypełniony | — (brak urządzenia) | e2e w WebKit to emulacja silnika, nie urządzenie |
| G06 | PASS | e2e `layout.spec.ts`; `tests/ui/typography.test.ts` | W, C, V | Dynamic Type i VoiceOver zależą od G05 |
| G07 | PASS | ten raport; testy `tests/docs/raport-kontroli.test.ts` i `tests/docs/migracja-webinary.test.ts`; README odsyła do raportu | V, K | samoocena wykonawcy |

## 9. Jak powtórzyć kontrolę

```bash
npm ci
npm run typecheck
npx vitest run
BASE_PATH=/ npm run build
node scripts/check-dist.mjs --base /
node scripts/check-offline.mjs --base /
E2E_SKIP_BUILD=1 BASE_PATH=/ E2E_WORKERS=2 npx playwright test   # opcjonalnie E2E_PORT=<wolny port>, np. 4184 jak w §3
python3 -I content/webinary-2026-11-15/validate_addendum.py content/webinary-2026-11-15
```

E2E aktualizacji budują przy pierwszym uruchomieniu stare aplikacje z commitów `39d9d46`, `b6f9201` i `b50eb19` do `test-results/` (`git archive`). Po zmianie treści (`src/domain/contentRelease.ts`, `public/data/`) zaktualizuj §4–§5 oraz `docs/MIGRACJA_WEBINARY.md` §1–§2, inaczej testy `tests/docs/` nie przejdą.
