# Raport kontroli — Doktor Monika Egzamin

Raport końcowy według `05_KONTROLA/01_KRYTERIA_ODBIORU.txt` (kryterium G07). Dotyczy podmiany banku na **V18 — komplet 700 pytań** (`chatgpt-combined-v18-2026-11-09-1fb7f7546332`: 600 pytań V16 + 100 pytań V17) z migracją danych lokalnych wszystkich profili. Przebieg kontroli: **09.11.2026 (Europe/Warsaw)**. Raport podaje osobno: wersje i środowisko (§1), stan kodu i buildu (§2), stan testów (§3), pulę (§4), status recenzji treści (§5), testy niewykonane i pominięte (§6), wdrożenie (§7) oraz macierz kryteriów A01–G07 (§8). Opis migracji, kopia i cofnięcie: `docs/MIGRACJA_V18.md`. Poprzedni raport (V15, 24–25.10.2026) jest w historii git tego pliku.

PASS testu albo kontroli oznacza, że aplikacja działa zgodnie z wymaganiami i że struktura danych jest poprawna. Nie jest oceną poprawności medycznej pytań ani prognozą wyniku egzaminu.

**Trzy osobne oceny:**

- **Gotowość techniczna aplikacji: tak, w emulacji i lokalnie; wdrożona na produkcję (§7).** Typecheck, Vitest, build, `check-dist`, `check-offline` i e2e w WebKit „iPhone 15” oraz w Chromium (§2–§3), w tym aktualizacja zainstalowanej aplikacji z produkcji V15 (`b6f9201`) z dwoma profilami. Testu na fizycznym iPhonie (G05) nie wykonano (§6).
- **Liczebność puli: dokładnie 700 pytań z allowlisty paczki** (600 V16 + 100 V17). Dawne cele (2000 pytań, 1000 na poziom) **nie zostały osiągnięte** i decyzją właściciela z 09.11.2026 nie obowiązują — aplikacja nie dopisuje pytań (§4, A03).
- **Recenzja treści.** Żadne pytanie nie ma recenzji lekarskiej; scalenie V18 nie jest nową recenzją (§5).

Zgodność raportu z repozytorium sprawdza test `tests/docs/raport-kontroli.test.ts` (projekt Vitest `docs`): sekcje, pełna macierz, status G05, liczby, wersja i SHA-256 pliku `public/data/bank-5db40505308f.json`, liczba wycofanych ID, nazwanie poziomów poniżej 1000 pytań (A03 nie może mieć PASS), opis każdego pominiętego testu e2e i adres wdrożenia.

## 1. Wersje i środowisko

| Element | Wartość |
|---|---|
| Aplikacja | `doktor-monika-egzamin` 0.1.0, gałąź `feat/bank-v18-700` (Pull Request do `main`, §7) |
| Bank pytań | `chatgpt-combined-v18-2026-11-09-1fb7f7546332`, plik `public/data/bank-5db40505308f.json` (szczegóły w §4) |
| Paczka źródłowa | `Doktor_Monika_V18_Komplet_700_Pytan.zip`: SHA-256 wszystkich 65 plików zgodne z `SHA256SUMS.txt`; `python3 validation/validate_bank.py .` — 24/24 kontroli, `all_pass: true` (`medical_validation: false`, `production_validation: false`) |
| System | macOS 26.6 (Darwin 25.6.0), Apple Silicon. Testy e2e z `--workers=2` (`E2E_WORKERS=2`) |
| Node.js | 24.18.1 |
| TypeScript / Vite / vite-plugin-pwa / Vitest | 7.0.2 / 8.3.5 / 2.0.0 / 5.0.5 |
| Playwright | 1.63.0. Projekty: WebKit (rev. 2359) z emulacją „iPhone 15” (393×852, DPR 3, dotyk) oraz Chromium (rev. 1243) w trybie mobilnym 393×852 |
| Stare aplikacje w e2e aktualizacji | `b6f9201` (produkcja od 25.10.2026: V15 z profilami) oraz `b50eb19` (V15 bez profili) — `git archive` do `test-results/`, build z `BASE_PATH=/` |
| Urządzenie fizyczne | **brak**: nie wykonano testu na iPhonie (G05, §6) |

## 2. Stan kodu i buildu

Zmiany z 09.11.2026 (szczegóły: `docs/MIGRACJA_V18.md`). Całość przeszła niezależną recenzję (agent recenzent, bez dostępu do moich wniosków); 5 uwag dotyczących przypadków brzegowych migracji poprawiono z testami, pozostałe dotyczyły stanu sprzed ostatniego commita:

- Treść: `public/data/` zawiera wyłącznie trzy pliki V18 bajt w bajt z paczki; pliki V15 i cztery figury V15 usunięte. Allowlista paczki w `content/v18/allowed_question_ids.json`, w kodzie jako `src/persistence/v18Allowlist.ts` (`scripts/v18-allowlist.mjs`). Kontroler odrzuca bank, którego katalog nie jest równy allowliście.
- Migracja IndexedDB v3 → v4 (`src/persistence/schema.ts`, `bankMigration.ts`) dla każdego profilu osobno, w jednej transakcji `versionchange`; ta sama transformacja przy imporcie i eksporcie kopii oraz dla automatycznych kopii bezpieczeństwa w bazie.
- Interfejs: jedna pula bez wyboru i etykiet trudności; dawne filtry trudności czyszczone.
- Service Worker: każdy plik w `data/` poza trzema bieżącymi → 404 (dawne banki nie wracają z pamięci przeglądarki); przejęcie kart przy zmianie wersji treści jak od V15.

| Kontrola | Komenda | Wynik |
|---|---|---|
| Build produkcyjny | `BASE_PATH=/ npm run build` | **PASS**: typecheck, `vite build`; precache SW 21 wpisów (2202,31 KiB), w tym `data/bank-5db40505308f.json` (1 410 659 B), lista wycofanych ID, profil i skrypt przejęcia; `dme-release.json` poza precache |
| Statyczna kontrola `dist` | `node scripts/check-dist.mjs --dist dist --base /` | **80/80 PASS** (FAIL 0, WARN 0). Między innymi: SHA-256 banku V18, `bank_version` trzech plików, liczby 700 / 400 / 200 / 100, **ID banku = allowlista paczki (700: 600 V16 + 100 V17)**, 3120 wycofanych ID (żadne w banku), profil obejmuje każde pytanie dokładnie raz; w `data/` wyłącznie trzy pliki V18; **brak dawnych plików banków (`data/bank.json`, `data/bank-37f3980a1129.json` i pliki towarzyszące V15) w `dist`, w precache i w kodzie/JSON**; brak `figures/`; skrypt przejęcia z regułą 404 dla innych plików w `data/` |

## 3. Stan testów

| Kontrola | Komenda | Wynik | Uwagi |
|---|---|---|---|
| Typy | `npm run typecheck` | **PASS** | 4 konfiguracje `tsc`: domain, app, test, node |
| Testy jednostkowe i integracyjne | `npx vitest run` | **665/665 PASS** (57 plików; 09.11.2026, po poprawkach z recenzji) | Nowe: `tests/domain/bank-v18.test.ts` (12: wydanie, pliki, allowlista 600 + 100, treść 1:1 wszystkich 700 rekordów, fingerprinty, trudność bez reklasyfikacji), `tests/persistence/migracja-v18.test.ts` (24: profile V15/V16/V17/mieszane, niezgodna treść, nieznane ID, idempotencja, v1/v3 → v4, przerwanie po każdym z 4 magazynów, dwa profile, import kopii; przypadki brzegowe z niezależnej recenzji — pusta sesja z innego banku, dawny filtr trudności w przeniesionej sesji, stan powtórek bez dowodu zgodności lub z obcą rodziną, zgłoszenie z obcą rodziną, próba innej rewizji), `tests/app/migracja-v18.test.ts` (3: rzeczywisty kontroler), `tests/ui/pula-v18.test.tsx` (6: brak trudności w UI), test 404 w `tests/pwa/tresc-sw.test.ts`, kontrola allowlisty w `tests/app/appController.test.ts`. Usunięte: testy migracji V15 (zastąpione) |
| E2E | `E2E_SKIP_BUILD=1 BASE_PATH=/ E2E_WORKERS=2 npx playwright test` | ****84 PASS, 2 SKIP, 0 FAIL** (86 testów w 14 plikach; 09.11.2026, 1,4–1,5 min; WebKit 41 PASS + 2 SKIP, Chromium 43 PASS; powtórzone po poprawkach z recenzji z tym samym wynikiem)** | `aktualizacja-v18.spec.ts`: stara aplikacja z produkcji (`b6f9201`) z danymi w dwóch profilach wpisanymi przez UI → podmiana `dist` pod tym samym adresem → nowy SW sam przejmuje otwartą kartę; każdy profil migruje przy własnym otwarciu (v3 → v4), wyniki i daty zostają, treść V15 znika z IndexedDB obu profili i z Cache Storage; dawne pliki banków → 404 z SW i z serwera; Test 20: **13/20 zaliczony, 12/20 niezaliczony**, runda błędów, Free Flow, odświeżenie i historia, rozdzielenie profili, start offline po aktualizacji — wyłącznie ID z allowlisty, bez powtórzeń; 0 błędów konsoli i 0 odpowiedzi ≥ 400 (poza celowymi 404 dawnych banków i nieudanym sprawdzeniem wersji w trybie offline). `profile.spec.ts`: aktualizacja z V15 bez profili (`b50eb19`) prosto do V18. Pominięcia: §6 |
| Service Worker w przeglądarkach | `node scripts/check-offline.mjs --base /` | **54 kontrole, 0 FAIL, 2 WARN** | WARN tylko w WebKit, te same co przy poprzednim wdrożeniu: ponowienie przerwanego pierwszego przygotowania pobiera pliki od nowa; obejście w aplikacji sprawdza scenariusz 6 (PASS) |

Testy e2e nie czytają klucza z interfejsu: klucz pochodzi z pliku banku V18 na dysku, a zapis sprawdzają przez odczyt IndexedDB w stronie.

## 4. Pula pytań

Liczby odczytano z pliku `public/data/bank-5db40505308f.json`. Test `tests/docs/raport-kontroli.test.ts` porównuje je z tym plikiem.

| Pole (`bank-5db40505308f.json`) | Wartość |
|---|---|
| `bank_version` | `chatgpt-combined-v18-2026-11-09-1fb7f7546332` |
| SHA-256 pliku (bajt w bajt z paczki V18, `MANIFEST.json`) | `5db40505308f0183ed85d5be4b2e9f8c3871d091f6ec7413f5518c88b39966f6` |
| `counts.questions` | 700 |
| `counts.families` (rodziny = pojemność Testu „cały zakres”) | 692 |
| `counts.by_domain.ANAT` (anatomia) | 141 |
| `counts.by_domain.SKIN` (skóra i dermatologia) | 160 |
| `counts.by_domain.DEV` (urządzenia) | 145 |
| `counts.by_domain.INJ` (iniekcje) | 160 |
| `counts.by_domain.THER` (pozostałe terapie) | 58 |
| `counts.by_domain.SAFE` (bezpieczeństwo i prawo) | 36 |
| `counts.by_difficulty.basic` (300 V16 + 100 V17 z technicznym placeholderem) | 400 |
| `counts.by_difficulty.intermediate` | 200 |
| `counts.by_difficulty.advanced` | 100 |
| `counts.schematic` | 0 |
| `retired_question_ids` (plik `retired-question-ids-54a05ea91281.json`; w tym 2987 ID V15; żadne nie występuje w banku) | 3120 |

**Skład.** Allowlista paczki: 600 ID `V16-…` i 100 ID `V17-001`…`V17-100` — katalog aplikacji jest jej dokładnym odpowiednikiem (bez pominięć i bez ID spoza listy).

**Liczebność.** Dawny cel 2000 pytań **nie został osiągnięty** (700, brakuje 1300), a dawne minimum 1000 pytań na poziom nie jest spełnione: basic 400 < 1000, intermediate 200 < 1000, advanced 100 < 1000. Oba wymogi odwołał właściciel 09.11.2026 („nie dopisuj pytań w celu spełnienia dawnych wymogów”). Aplikacja nie dopisuje ani nie przekwalifikowuje pytań. Trudność nie jest pokazywana: 100 pytań V17 ma `basic` tylko jako techniczny placeholder.

**Profil treningowy** (`training-profile-2bdad504f50e.json`): `skin` 160, `facial_anatomy` 141, `other` 399 pytań, udziały 35/25/40 w całym zakresie (DECYZJE §6a, §7a). Przy teście o maksymalnym N (692) brakujące miejsca grup skin i facial_anatomy przechodzą na other — każda rodzina trafia do testu.

**Względem poprzedniej puli** (V15, 2987 pytań, usunięta z aplikacji): 0 wspólnych ID, więc żadne pytanie V15 nie przechodzi do V18.

## 5. Status recenzji treści

| Pole | Wartość |
|---|---|
| `clinical_signoff` | false |
| `official_exam_question_bank` | false |
| `review_status: draft_pending_clinical_review` | 700 |
| `approved_for_question_key: true` | 0 |
| `content_check_status: independently_checked_draft` | 600 |
| `content_check_status: author_checked_draft` | 100 |
| `counts.independently_checked_draft` | 600 |

- Status materiału (`status_pl` z banku): „Scalona pula: 600 pytań V16 i 100 krótkich V17, bez zmian treści. Statusy kontroli odziedziczono z paczek wejściowych; scalanie nie jest nową recenzją medyczną.” Aplikacja pokazuje go w „O bazie” i w Ustawieniach.
- To **nie jest recenzja lekarska**: wszystkie klucze są robocze. To nie jest oficjalny bank pytań PTMEiAA, a wynik w aplikacji nie jest oceną komisji egzaminacyjnej.
- Treść V18 nie była zmieniana w aplikacji (porównanie 1:1 i przeliczone fingerprinty w `tests/domain/bank-v18.test.ts`).

## 6. Testy niewykonane i pominięte

| Pozycja | Status | Powód | Co sprawdzono zamiast tego |
|---|---|---|---|
| G05: fizyczny iPhone w Safari i po „Do ekranu głównego”, w tym aktualizacja do V18 z ikony | **NOT RUN** | brak urządzenia w środowisku wykonawczym | emulacja WebKit „iPhone 15” w e2e (to nie jest urządzenie ani tryb standalone). Protokół: `docs/INSTALACJA_IPHONE.md` §6 (wszystkie kroki NOT RUN) |
| `aktualizacja-v18.spec.ts`: „V18: zamknięcie karty w trakcie pobierania aktualizacji i ponowne otwarcie kończy aktualizację” w projekcie WebKit | **SKIP** | Playwright WebKit (rev. 2359): pobieranie banku przez instalujący się Service Worker, przerwane zamknięciem jedynej karty, nie kończy się ani nie zgłasza błędu — nowy SW zostaje w stanie „installing” w tym samym kontekście przeglądarki, także po ponownym otwarciu karty (diagnoza 09.11.2026). Stara aplikacja poprawnie wykrywa nową wersję i pokazuje „Aktualizacja banku pytań…”. Nie wiadomo, czy prawdziwy Safari iOS zachowuje się tak samo | w Chromium ten sam test: PASS. Główny scenariusz aktualizacji (bez przerwania) w WebKit: PASS. Zalecenie dla użytkowniczki, gdy komunikat „Aktualizacja banku pytań…” trwa ponad minutę: całkowicie zamknąć aplikację (przesunąć w górę w przełączniku aplikacji) i otworzyć ponownie przy włączonym internecie |
| `pwa.spec.ts`: „G02 + A04: offline (context.setOffline)” w projekcie WebKit | **SKIP** | Playwright WebKit przy `context.setOffline(true)` blokuje każdą nawigację, także obsługiwaną przez Service Workera — ograniczenie narzędzia | w Chromium: PASS; w WebKit offline sprawdzają `aktualizacja-v18.spec.ts` (start offline po aktualizacji, serwer niedostępny) i `check-offline.mjs` |
| `dostepnosc.spec.ts`: E03 (brak zastępstwa dla wcześniejszej pozycji) | wykonany | test pomija się tylko, gdy najmniejsza dziedzina ma ponad 60 rodzin; w V18 najmniejsza to SAFE z 36 rodzinami | — |
| Aktualizacja w trybie standalone (aplikacja z ikony) i w karcie zamrożonej w tle | **NOT RUN** | Playwright nie emuluje trybu standalone iOS ani zamrażania kart | fallback w kodzie (`dme-release.json` przy starcie i powrocie z tła, wiadomość `DME_CONTENT_UPDATE`) — `tests/pwa/tresc-sw.test.ts` |
| Rzeczywiste profile użytkowniczek | **NOT RUN** | dane są wyłącznie w telefonach; nie ma serwera ani kopii danych użytkowników | migracja sprawdzona na danych wpisanych przez UI produkcyjnej wersji V15 (e2e) i na danych syntetycznych V15/V16/V17/mieszanych (Vitest) |
| Recenzja lekarska kluczy | **NOT RUN** | poza zakresem kontroli aplikacji | status w §5 |

## 7. Wdrożenie

Adres wdrożenia: **https://wiedza.doktormonika.pl/** (GitHub Pages z własną domeną, repozytorium https://github.com/lyzwad/doktor-monika-egzamin, publiczne; workflow „Publikacja na GitHub Pages” po scaleniu do `main`). Hosting rozpoznany 09.11.2026: odpowiedź `server: GitHub.com`, API Pages — `build_type: workflow`, `cname: wiedza.doktormonika.pl`, HTTPS wymuszony, certyfikat ważny do 23.01.2027; wdrożony był commit `b6f9201` (bank V15). VPS nie obsługuje tej domeny i nie był zmieniany; DNS bez zmian. Dawny adres https://lyzwad.github.io/doktor-monika-egzamin/ odpowiada `301` na nowy (przekierowanie GitHub Pages po ustawieniu własnej domeny).

**Wdrożenie V18 (09.11.2026).** Pull Request https://github.com/lyzwad/doktor-monika-egzamin/pull/3 scalony (squash) jako commit `954194d`; przebieg workflow `42695955540` (20:45 UTC): testy Vitest, build, `check-dist` i deploy — **success**. Kopia sprzed wdrożenia i procedura cofnięcia: `docs/MIGRACJA_V18.md` §6.

Kontrola publicznego adresu po wdrożeniu (09.11.2026, ok. 21:50 CET):

- `dme-release.json`: `bankVersion` `chatgpt-combined-v18-2026-11-09-1fb7f7546332`, `bankSha256` `5db40505…66f6`, `appVersion` `0.1.0+954194d`;
- `data/bank-5db40505308f.json` → `200`, SHA-256 `5db40505308f0183ed85d5be4b2e9f8c3871d091f6ec7413f5518c88b39966f6` (zgodny z paczką); **700 rekordów, 700 unikalnych ID, równe allowliście paczki: 600 V16 + 100 V17**; pliki towarzyszące V18 → `200` z sumami zgodnymi z `MANIFEST.json`;
- dawne pliki → `404`: `data/bank.json`, `data/bank-37f3980a1129.json`, `data/retired-question-ids-83b36ff80986.json`, `data/training-profile-c0edd4ca07c2.json`, `figures/FIG-ANAT-01-p.svg` (strona 404 GitHub Pages, nie JSON ani aplikacja); `sw.js` wskazuje wyłącznie nowy bank;
- przeglądarka na adresie produkcyjnym (świeży profil przeglądarki, Playwright): **WebKit „iPhone 15” — PASS**: wersja V18, „O bazie pytań” — 700 pytań, brak wyboru trudności, Test 20 (domyślnie 20) z 20 różnymi ID z allowlisty, wynik **13 z 20**, źródła po odpowiedzi, historia z wynikiem po otwarciu w nowej karcie, 20 prób w IndexedDB wyłącznie z ID V18, bank V18 w Cache Storage; **0 błędów konsoli, 0 odpowiedzi ≥ 400, jedyny host `wiedza.doktormonika.pl`**. **Chromium mobile — PASS** dla tych samych kroków online oraz offline: po pierwszym wczytaniu start i Free Flow bez sieci, wyłącznie pytania V18.

Aktualizacji już zainstalowanej aplikacji nie da się sprawdzić na produkcji po wdrożeniu (stara wersja nie jest już serwowana) — sprawdza ją e2e `aktualizacja-v18.spec.ts` na tej samej wersji, która była na produkcji (`b6f9201`). Fizyczny iPhone: G05 **NOT RUN**.

## 8. Macierz kryteriów A01–G07

Wynik opiera się na przebiegach z §2–§3 (09.11.2026, bank V18). G05 pozostaje NOT RUN. PASS w emulacji przeglądarkowej nie zastępuje G05.

Środowiska: **V** — Vitest 5.0.5; **W** — Playwright WebKit, emulacja „iPhone 15”; **C** — Playwright Chromium mobile; **D** — `check-dist.mjs`; **O** — `check-offline.mjs`; **K** — inspekcja kodu i dokumentacji; **P** — kontrola publicznego adresu (§7).

| ID | Wynik | Dowód | Środowisko | Ograniczenie |
|---|---|---|---|---|
| A01 | PASS | `tests/ui/App.test.tsx` „Start (S01–S02)” | V, K, W | — |
| A02 | PASS | e2e `smoke.spec.ts`; `check-dist.mjs` (manifest) | W, C, D | bez porównania pikselowego; wygląd na urządzeniu zależy od G05 |
| A03 | PARTIAL | `tests/domain/bank-v18.test.ts` (700 = allowlista, 600 V16 + 100 V17, treść 1:1), `check-dist.mjs`, `tests/app/regresje-p3.test.ts`, `tests/ui/regresje-p3.test.tsx` | V, D, P | dawne cele 2000 pytań i 1000 na poziom niespełnione (700; basic 400, intermediate 200, advanced 100) i odwołane przez właściciela 09.11.2026 |
| A04 | PASS | e2e `smoke.spec.ts`, `pwa.spec.ts`; `check-dist.mjs` | W, C, D | linki do źródeł otwiera tylko użytkowniczka |
| B01 | PASS | `tests/domain/catalog.test.ts`; katalog V18 bez odrzuceń (`tests/domain/bank-v18.test.ts`) | V | — |
| B02 | PASS | `tests/domain/answer.test.ts` „B02”; e2e `flows.spec.ts` | V, W, C | — |
| B03 | PASS | `tests/domain/answer.test.ts` „B03”; `tests/ui/AnswerCard.test.tsx`; e2e `interactions.spec.ts` | V, W, C | tap na fizycznym ekranie zależy od G05 |
| B04 | PASS | e2e `flow-a.spec.ts` (przed odpowiedzią brak klucza i wyjaśnienia w DOM) | V, W, C | — |
| B05 | PASS | `tests/ui/AnswerCard.test.tsx`; e2e `flow-a.spec.ts` | V, W, C | — |
| B06 | PASS | `tests/ui/ExplanationPanel.test.tsx`; e2e `flow-a.spec.ts` (źródło z linkiem po odpowiedzi) | V, W, C | — |
| C01 | PASS | `tests/domain/pool.test.ts`; e2e `interactions.spec.ts` „C01” (pojemność 692, bez wyboru trudności) | V, W, C | klawiatura iOS zależy od G05 |
| C02 | PASS | `tests/domain/test-flow.test.ts` | V | — |
| C03 | PASS | `tests/domain/test-flow.test.ts`; `tests/ui/QuestionScreen.test.tsx` | V | — |
| C04 | PASS | `tests/domain/scoring.test.ts`; e2e `aktualizacja-v18.spec.ts` (13/20 zaliczony, 12/20 niezaliczony) | V, W, C | — |
| C05 | PASS | `tests/domain/test-flow.test.ts`; sesje „Przerwany aktualizacją banku pytań” poza wykresem (`tests/persistence/migracja-v18.test.ts`) | V, W, C | — |
| D01 | PASS | `tests/domain/retry.test.ts`; e2e `aktualizacja-v18.spec.ts` (runda błędów na V18) | V, W, C | runda błędów z sesji sprzed V18 niedostępna (`LEGACY_SESSION`) |
| D02 | PASS | `tests/domain/retry.test.ts`, `tests/domain/niezmienniki.test.ts` | V | — |
| D03 | PASS | `tests/domain/retry.test.ts` | V | — |
| D04 | PASS | `tests/domain/selection.test.ts`; `tests/domain/bank-smoke.test.ts` (N = 692 obejmuje każdą rodzinę) | V | — |
| D05 | PASS | `tests/domain/freeflow.test.ts`; `tests/domain/bank-smoke.test.ts`; e2e `aktualizacja-v18.spec.ts` (Free Flow, także offline) | V, W, C | — |
| D06 | PASS | `tests/domain/my-errors.test.ts`; `tests/app/migracja-v18.test.ts` (aktywny błąd zgodnego pytania V16 zachowany) | V, W, C | — |
| D07 | PASS | `tests/domain/my-errors.test.ts` | V | — |
| E01 | PASS | `tests/domain/report.test.ts` | V | — |
| E02 | PASS | `tests/domain/report.test.ts`; e2e `flows.spec.ts` | V, W, C | — |
| E03 | PASS | `tests/app/regresje-weryfikacji.test.ts`; e2e `dostepnosc.spec.ts` „E03” (dziedzina SAFE, 36 rodzin) | V, W, C | — |
| E04 | PASS | `tests/domain/report.test.ts`; e2e `flows-extra.spec.ts` | V, W, C | — |
| E05 | PASS | `tests/domain/report.test.ts`; e2e `flows.spec.ts` | V, W, C | — |
| E06 | PASS | `tests/domain/report.test.ts`; zgłoszenia pytań spoza V18 nieaktywne po migracji (`tests/persistence/migracja-v18.test.ts`) | V | — |
| F01 | PASS | `tests/persistence/commit.test.ts`; e2e `flows.spec.ts` | V, W, C | zamknięcie aplikacji z ekranu głównego iOS zależy od G05 |
| F02 | PASS | `tests/persistence/kopia.test.ts`; `tests/persistence/migracja-v18.test.ts` (import kopii V15/V17/mieszanej, eksport bez dawnej treści, idempotencja) | V, W, C | zapis pliku w aplikacji Pliki zależy od G05 |
| F03 | PASS | `tests/persistence/kopia.test.ts`; automatyczne kopie bezpieczeństwa przekształcone migracją (`tests/persistence/migracja-v18.test.ts`) | V, W, C | — |
| F04 | PASS | `tests/domain/history.test.ts`; e2e `aktualizacja-v18.spec.ts` (wyniki i daty sprzed aktualizacji w historii, bez treści) | V, W, C | przegląd treści sesji sprzed V18 celowo niedostępny |
| F05 | PASS | `tests/domain/history.test.ts`; wykres bez zmian liczb po migracji (`tests/persistence/migracja-v18.test.ts`) | V, W, C | — |
| G01 | PASS | build i `check-dist.mjs` (§2); e2e `layout.spec.ts` | D, W, C, O | — |
| G02 | PASS | e2e `pwa.spec.ts`, `aktualizacja-v18.spec.ts` (offline po aktualizacji); `check-offline.mjs` | W, C, O | `setOffline` w WebKit: SKIP (§6); tryb samolotowy na iPhonie zależy od G05 |
| G03 | PASS | e2e `integration.spec.ts`; e2e `aktualizacja-v18.spec.ts` (przejęcie kart, migracja profili); `tests/pwa/tresc-sw.test.ts`; `check-offline.mjs` | W, C, O, V | przerwana instalacja w WebKit: SKIP (§6); Safari iOS zależy od G05 |
| G04 | PASS | `check-dist.mjs` (brak dawnych plików banków, brak hostów zewnętrznych); e2e `smoke.spec.ts` | D, W, C | — |
| G05 | NOT RUN | brak fizycznego iPhone'a; protokół `docs/INSTALACJA_IPHONE.md` §6 niewypełniony | — (brak urządzenia) | e2e w WebKit to emulacja silnika, nie urządzenie |
| G06 | PASS | e2e `layout.spec.ts`; `tests/ui/typography.test.ts` | W, C, V | Dynamic Type i VoiceOver zależą od G05 |
| G07 | PASS | ten raport; test `tests/docs/raport-kontroli.test.ts`; README odsyła do raportu | V, K | samoocena wykonawcy |

## 9. Jak powtórzyć kontrolę

```bash
npm ci
npm run typecheck
npx vitest run
BASE_PATH=/ npm run build
node scripts/check-dist.mjs --base /
node scripts/check-offline.mjs --base /
E2E_SKIP_BUILD=1 BASE_PATH=/ E2E_WORKERS=2 npx playwright test
```

E2E aktualizacji budują przy pierwszym uruchomieniu stare aplikacje z commitów `b6f9201` i `b50eb19` do `test-results/` (`git archive`). Po zmianie treści (`src/domain/contentRelease.ts`, `public/data/`) zaktualizuj §4–§5, inaczej test `tests/docs/raport-kontroli.test.ts` nie przejdzie.
