# Dodatek 247 pytań z webinarów — wydanie „V18 + webinary”

Stan: 15.11.2026. Aplikacja dostaje **dodatek**: do niezmienionego banku V18 (`chatgpt-combined-v18-2026-11-09-1fb7f7546332`, 700 pytań, produkcja od 09.11.2026, commit `39d9d46`) dochodzi 247 pytań przygotowanych z transkrypcji webinarów. Razem **947 pytań** w wydaniu **`dme-v18-webinary-2026-11-15-8622d52b9a42`**. Profile, wyniki i stan nauki z V18 zostają (§3). Specyfikacja: `_bmad-output/specs/spec-webinary-247/` (`SPEC.md`, `kontrakt-danych.md`, `teksty-ui.md`).

Pytania webinarowe to materiał egzaminacyjny z wykładów (napisy automatyczne), a nie zweryfikowane aktualne wytyczne. Klucz sprawdziła AI względem transkrypcji; nie było recenzji klinicznej (`clinical_signoff = false`).

## 1. Treść w aplikacji

Wejścia scalania (w repozytorium, poza katalogiem publicznym):

| Plik | Rola | SHA-256 |
|---|---|---|
| `content/v18/bank.json` | bank V18 bajt w bajt (jak `bank-5db40505308f.json` na produkcji), baza scalania | `5db40505308f0183ed85d5be4b2e9f8c3871d091f6ec7413f5518c88b39966f6` |
| `content/v18/allowed_question_ids.json` | allowlista V18 (700 ID) — bez zmian | `982cf1cf97b14c711b864833153f26a79866a036208b97f50e90f00bfce8a64b` |
| `content/v18/retired_question_ids.json`, `content/v18/training_profile.json` | pliki towarzyszące V18 (dawne `retired-question-ids-54a05ea91281.json` i `training-profile-2bdad504f50e.json`) — wejście dla listy wycofanych ID i profilu | jak w `content/v18/MANIFEST.json` |
| `content/webinary-2026-11-15/bank_webinar_addendum.json` | dodatek `dme-webinar-addendum` (`webinar-addendum-2026-11-15-2fdd243bcfc0`): 247 pytań, 17 źródeł `W01`…`W17` | `ae7a7321f163a5c7bb4fd06529921a4ef5e8c12e2df2c7c52600a37f08aed40c` |
| `content/webinary-2026-11-15/MANIFEST.json` | 247 `active_ids`, `bank_sha256` dodatku, `mode: append` | — |
| `content/webinary-2026-11-15/Wykluczone_powtorzenia.json` | 3 ID odrzucone przez redakcję jako powtórzenia (nie ma ich w dodatku) — tylko do raportu | — |

Kontrola paczki dodatku przed scaleniem: `python3 -I content/webinary-2026-11-15/validate_addendum.py content/webinary-2026-11-15` — PASS (247 pytań, tryb append, unikalne ID, struktura i SHA; bez oceny poprawności medycznej). Scalanie: `node scripts/webinary-addendum.mjs` (adapter dodatku do formatu `dme-runtime-bank` i idempotentne scalanie; ponowne uruchomienie — także na wyniku z WB — daje bajtowo te same pliki; ten sam ID z inną treścią przerywa budowanie). Wersja wydania `dme-v18-webinary-2026-11-15-8622d52b9a42`: `8622d52b9a42` = pierwsze 12 znaków SHA-256 tekstu `"<SHA banku V18>+<SHA dodatku>"` (`kontrakt-danych.md`). Raport identycznych pytań pod różnymi ID (ten sam fingerprint): **0 par**.

Pliki w `public/data/` (i w `dist/data/`):

| Plik | Zawartość | SHA-256 |
|---|---|---|
| `bank-475c1fef0099.json` | scalony bank `dme-runtime-bank` 1.0: 700 rekordów V18 bez zmian (ta sama kolejność i treść, porównanie 1:1 w testach) + 247 rekordów WB (kolejność dodatku); 408 źródeł (391 V18 + `W01`…`W17`), wpis `addenda` z SHA dodatku | `475c1fef009903f4151cd8234ca279ece879a89b6dabfb86e5e29045f7af171e` |
| `retired-question-ids-40450ecb4f2b.json` | te same 3120 historycznych ID co V18 (żadne nie jest aktywne), nowa `bank_version` | `40450ecb4f2bdba293b29a77a7b0093e8781cc40c93095fd316e6fb0e122c5ba` |
| `training-profile-a8bf8dbe7e3b.json` | wagi i przykład 20 pytań jak V18; każde z 947 pytań w jednej grupie | `a8bf8dbe7e3b23ed08e73a99396dcb412d842b9ebceac8d655e3775bbc8c664f` |

Allowlista wydania: `content/v18-webinary/allowed_question_ids.json` (`mode: v18_plus_webinar_addendum`, 700 ID V18 w kolejności V18, potem 247 ID WB w kolejności dodatku; SHA-256 `3af684c4716ad8721d7b4f23328b7a5db08afcc898b669cdcc6266e02d6fd9f5`), w kodzie jako `src/persistence/v18Allowlist.ts` (947 wierszy: ID, rewizja, fingerprint, klucz, rodzina, dziedzina — bez treści). Aplikacja przy starcie sprawdza, że katalog jest jej równy; inaczej pokazuje błąd i nie pokazuje pytań. Wersję, sumy i liczby trzyma `src/domain/contentRelease.ts` (`CONTENT_RELEASE`).

Pliki V18 (`bank-5db40505308f.json`, `retired-question-ids-54a05ea91281.json`, `training-profile-2bdad504f50e.json`) znikają z `public/data/`. Dawne ścieżki zwracają **404** — z serwera GitHub Pages i z nowego Service Workera (każdy plik w `data/` poza trzema bieżącymi), także gdy przeglądarka ma je w pamięci HTTP.

Rekord WB zachowuje 1:1 treść, opcje, klucz, wyjaśnienie, źródła i dowód z dodatku; adapter dokłada tylko pola formatu aplikacji (`origin: "webinar"`, temat `WB-T-<Wxx>-<DZIEDZINA>`, statusy, fingerprint, lokalizator „Gdzie w źródle”). Każda treść pytania WB kończy się dosłownie `[webinar]`. Źródło webinaru ma `url: null` — aplikacja nie pokazuje linku, tylko po odpowiedzi przycisk „Źródło webinaru” z wewnętrznym panelem: nazwa pliku transkrypcji, informacja o automatycznych napisach i krótki cytat dowodowy. Transkrypcje, e-booki i paczka redakcji nie trafiają do repozytorium ani na stronę.

## 2. Pula

| Pole | Przed (V18) | Dodane (WB) | Po (wydanie) |
|---|---|---|---|
| `counts.questions` (pytania) | 700 | 247 | **947** |
| `counts.families` (rodziny = pojemność Testu „cały zakres”) | 692 | 247 | **939** |
| `counts.by_domain.ANAT` (anatomia) | 141 | 6 | 147 |
| `counts.by_domain.SKIN` (skóra i dermatologia) | 160 | 36 | 196 |
| `counts.by_domain.DEV` (urządzenia) | 145 | 118 | 263 |
| `counts.by_domain.INJ` (iniekcje) | 160 | 26 | 186 |
| `counts.by_domain.THER` (pozostałe terapie) | 58 | 14 | 72 |
| `counts.by_domain.SAFE` (bezpieczeństwo i prawo) | 36 | 47 | 83 |
| `counts.by_difficulty.basic` (w WB techniczny placeholder) | 400 | 247 | 647 |
| `counts.by_difficulty.intermediate` | 200 | — | 200 |
| `counts.by_difficulty.advanced` | 100 | — | 100 |
| `content_check_status: independently_checked_draft` | 600 | — | 600 |
| `content_check_status: author_checked_draft` | 100 | — | 100 |
| `content_check_status: source_checked_AI_draft` | — | 247 | 247 |

- Test, Free Flow i runda błędów losują z pełnej puli 947, bez wyboru trudności i bez osobnego trybu „tylko webinary”. `basic` w pytaniach WB to techniczny placeholder — interfejs nie pokazuje trudności.
- Profil treningowy: grupy V18 bez zmian plus pytania WB według działu (`SKIN` → `skin`, `ANAT` → `facial_anatomy`, pozostałe → `other`): `skin` 196, `facial_anatomy` 147, `other` 604; udziały 35/25/40 jak w V18 (redakcyjna proporcja treningu, nie oficjalny rozkład egzaminu).
- „O bazie pytań” pokazuje 947 pytań, 939 rodzin, wiersz „Pytania z webinarów” = 247 i dotychczasowy licznik przeglądu AI (600). Wszystkie 947 pytań ma `review_status: draft_pending_clinical_review` i `approved_for_question_key: false` — nigdzie nie ma deklaracji zatwierdzenia klinicznego.
- Nic nie zostało usunięte ani dopisane na podstawie podobieństwa.

## 3. Migracja danych w telefonie (każdy profil osobno)

Każdy profil ma własną bazę IndexedDB. Migracja wykonuje się przy pierwszym otwarciu profilu w nowej wersji: baza przechodzi z wersji 4 na **5** w **jednej transakcji `versionchange`** (`createMigrationV5` w `src/persistence/schema.ts`). Krok v5 odczytuje wszystkie magazyny, przekształca je funkcją `transformToCurrentBank` (`src/persistence/bankMigration.ts`) i zapisuje wynik. Wydanie docelowe jest parametrem tej funkcji (`BankTarget`, domyślnie `CURRENT_BANK_TARGET`): wersja banku i SHA-256 z `CONTENT_RELEASE`, allowlista wydania (ID, rewizja, fingerprint, klucz) i wersja-poprzednik V18. Tę samą funkcję stosuje wczytanie kopii danych i eksport kopii, a także automatyczne kopie bezpieczeństwa zapisane w bazie.

Nowe wydanie jest nadzbiorem V18, a 700 pytań V18 ma niezmienioną treść, więc **nic z V18 nie przepada**. Pytanie „zgodne” = ID z allowlisty, a każdy jego zapis ma tę samą rewizję, fingerprint (treść + opcje) i klucz co wydanie; odpowiedzi nigdy nie są przypisywane do innych ID na podstawie podobieństwa.

| Dane z V18 | Po migracji |
|---|---|
| Sesje V18 — ukończone, zakończone, otwarte, także puste (V18 to poprzednik wydania) | **Zostają aktywne**: status, plan, wynik, sloty i przegląd odpowiedzi bez zmian; wersja banku sesji i snapshotów = nowe wydanie (`revision` sesji + 1); otwarty test można dokończyć przez „Kontynuuj” |
| Sesja V18 z niezgodnym snapshotem (ta sama ID, inna treść — przy niezmienionej treści V18 nie występuje) | Podsumowanie bez treści (`legacy.reason = bank_v18_update`), jak przy V18 |
| Odpowiedzi i stan powtórek („Moje błędy”, runda błędów) | Zostają |
| Zgłoszenia (wykluczone pytania) | Zostają aktywne |
| Podsumowania sprzed V18 (sesje `legacy` z migracji V15 → V18) | Bez zmian |
| Zaimportowane pule | Usunięte (import pul jest wyłączony) |
| Ustawienia, zdarzenia | Bez zmian (filtr trudności → cała pula, jak od V18) |
| Rekordy `meta` | `content` = nowe wydanie (`bankVersion`, SHA-256 banku); nowy rekord `migration:bank-v18-webinary` (z wersji 4 na 5, z raportem liczbowym); rekord `migration:bank-v18` z aplikacji V18 zostaje |

Krok v4 (bank V18) jest od tego wydania krokiem historycznym bez zmian danych. Urządzenie, które wciąż ma V15 (`b6f9201`, baza v3) albo wersję sprzed profili (`b50eb19`), przechodzi do wersji 5 **jedną** transformacją: sesje V15 stają się podsumowaniami (`legacy.reason = bank_v18_update`, otwarte — „Przerwany aktualizacją banku pytań”), a w `meta` jest tylko rekord `migration:bank-v18-webinary` (`docs/MIGRACJA_V18.md` §3).

**Kopia danych.** Plik kopii z aplikacji V18 wczytany do nowej wersji daje ten sam stan co migracja bazy. Kopia zachowuje nowe opcjonalne pola snapshotu pytania WB (`webinarEvidence`, `sources[].fileName`, `sources[].webinar`); pole o złym typie odrzuca plik jako nieprawidłową kopię.

**Atomowość.** Błąd w transakcji ją przerywa: baza zostaje w wersji 4 (albo 3) z nietkniętymi danymi, a aplikacja pokazuje „Aktualizacja danych nie powiodła się” z „Spróbuj ponownie” i nie pokazuje pytań. Migracja jest idempotentna i nie kasuje baz innych profili — baza drugiego profilu czeka nietknięta do własnego otwarcia.

**Warunek wdrożenia.** Krok v5 przekształca dane jeden raz — przy podniesieniu schematu z 4 na 5. Dlatego nowa wersja bazy (historia 2) i nowe wydanie treści (historia 1) muszą trafić na produkcję **w jednym wdrożeniu** (cała gałąź `feat/webinary-247`); build z bazą v5 i treścią V18 zostawiłby w telefonach dane, których kolejne wydanie już nie przeniesie.

## 4. Service Worker i iPhone

Nowa wersja treści zmienia znacznik w Cache Storage (`<bankVersion>#profile-1`: z `chatgpt-combined-v18-2026-11-09-1fb7f7546332#profile-1` na `dme-v18-webinary-2026-11-15-8622d52b9a42#profile-1`) oraz nazwę skryptu przejęcia (z `dme-sw-takeover-5db40505308f-profile-1.js` na `dme-sw-takeover-475c1fef0099-profile-1.js`, więc `sw.js` jest inny bajtowo). Nowy Service Worker przejmuje otwarte karty sam (mechanizm od V15: `skipWaiting` → `clients.claim` → wiadomość `DME_CONTENT_UPDATE` i przeładowanie; fallback `dme-release.json` przy starcie i powrocie z tła; Safari < 16 bez `navigate` — przeładowanie przez wiadomość). Workbox usuwa stary precache (bank V18) tej rejestracji. Po pierwszym połączeniu i aktualizacji aplikacja działa offline na nowym wydaniu, łącznie z panelem źródła webinaru.

Instrukcja dla użytkowniczki iPhone'a:

1. Otwórz aplikację z ikony **przy włączonym internecie** i poczekaj kilka sekund — przeładuje się sama i pokaże „Aktualizacja banku pytań…”. Nie trzeba usuwać ikony ani danych witryny.
2. Wybierz swój profil. Ustawienia → „O bazie pytań” powinno pokazywać 947 pytań i wiersz „Pytania z webinarów” z liczbą 247.
3. Dawne wyniki są w Historii razem z przeglądem odpowiedzi; rozpoczęty wcześniej test można dokończyć przez „Kontynuuj”. „Moje błędy” pamięta wcześniejsze pomyłki.
4. Jeśli widać „Aktualizacja danych czeka” — zamknij inne karty z aplikacją i dotknij „Spróbuj ponownie”.
5. Jeśli „Aktualizacja banku pytań…” trwa ponad minutę — całkowicie zamknij aplikację (przesuń ją w górę w przełączniku aplikacji) i otwórz ją ponownie z ikony przy włączonym internecie.

Telefon całkowicie offline nie dostanie aktualizacji; po pierwszym połączeniu zadziała jak wyżej.

## 5. Weryfikacja

Treść i aplikacja (historie 1 i 3):

- `tests/domain/webinary-addendum.test.ts`, `tests/domain/webinary-cli.test.ts` — adapter, idempotentne scalanie, konflikt ID z inną treścią, raport identycznych pytań, deterministyczne pliki; `tests/domain/bank-webinary.test.ts`, `tests/domain/bank-v18.test.ts` — wydanie 947: 700 rekordów V18 głęboko równych `content/v18/bank.json`, 247 rekordów WB 1:1 z dodatkiem, SHA i liczby; `tests/domain/catalog-webinar.test.ts` — walidacja katalogu z dowodem webinaru.
- `tests/ui/` (m.in. `o-bazie-webinary.test.tsx`, `teksty-wydania.test.tsx`, `ExplanationPanel.test.tsx`) — panel „Źródło webinaru” bez linków, wiersz „Pytania z webinarów”, teksty wydania.
- `tests/docs/migracja-webinary.test.ts` — ten dokument: wersja, nazwy i SHA-256 plików, liczby „przed + dodane = po” policzone z plików banków.

Dane (historia 2):

- `tests/persistence/migracja-webinary.test.ts` — przejście V18 → wydanie: każda sesja V18 (ukończona, runda błędów ze zgłoszeniem, Free Flow, pusta) aktywna, próby, powtórki i blokady bez zmian, puste sesje V15/V16 → przerwane, niezgodny snapshot → podsumowanie, sesje `legacy` bez zmian, idempotencja, przerwanie po każdym magazynie (baza zostaje w v4), v1/v3 → v5, dwa profile, kopia z polami webinaru; `tests/app/migracja-webinary.test.ts` — rzeczywisty kontroler na profilu V18 (baza v4) z prawdziwym wydaniem 947; `tests/persistence/migracja-v18.test.ts`, `tests/app/migracja-v18.test.ts` — ścieżki V15/V16/V17 przestawione na v5.

Service Worker i aktualizacja zainstalowanej aplikacji (historia 4):

- `tests/pwa/tresc-sw.test.ts` — przejście ze znacznika V18 na bieżące wydanie (przejęcie, Safari < 16, ten sam znacznik bez przejęcia), 404 dla plików V18 (`bank-5db40505308f.json` i towarzyszące, także z `?v=`) i V15, pliki bieżącego wydania przechodzą, nowa nazwa skryptu przejęcia.
- E2E `tests/e2e/aktualizacja-webinary.spec.ts` — aktualizacja zainstalowanej aplikacji z produkcji `39d9d46` z dwoma profilami: przejęcie karty, migracja każdego profilu osobno (v4 → v5), stare wyniki V18 aktywne, „Kontynuuj” i dokończenie otwartego testu, historia z przeglądem, „O bazie pytań” (947, „Pytania z webinarów” 247), Test z „Moje błędy”, Test 20, runda błędów, Free Flow z pytaniem WB i panelem źródła bez `<a>`, 404 dawnych plików (SW i serwer), start offline z pytaniem WB.
- E2E `tests/e2e/aktualizacja-v18.spec.ts` (ścieżka z V15 `b6f9201`) i `tests/e2e/profile.spec.ts` (V15 bez profili `b50eb19`) — prowadzą do bieżącego wydania: pierwszy sprawdza jeden krok v3 → v5 (rekord `migration:bank-v18-webinary`, bez `migration:bank-v18`), drugi — bazę profilu w schemacie 5 z bieżącą wersją treści.
- `scripts/check-dist.mjs` — allowlista 947, SHA-256, brak plików V18 i V15 w `dist`, precache i kodzie; `scripts/check-offline.mjs` — Service Worker na zbudowanym `dist` (bank z `dist/dme-release.json`).

Wyniki przebiegów: `docs/RAPORT_KONTROLI.md` §2–§3.

Fizyczny iPhone (G05): **NOT RUN** — emulacja WebKit w Playwright nie jest testem urządzenia.

## 6. Kopia i postępowanie przy awarii (bez cofania)

Prywatna kopia sprzed wdrożenia (poza repozytorium i poza katalogiem publicznym): `~/DEWELOPER_CLAUDE/projekty/_kopie/doktor-monika-egzamin-2026-11-15-przed-webinarami/` — lustro działającej strony V18 (`strona/`, 24 pliki z precache, `sw.js`, `dme-release.json` i skrypt przejęcia), pakiet git z pełną historią (`repo-doktor-monika-egzamin.bundle`), wdrożony commit (`WDROZONY_COMMIT.txt`: `39d9d46b67cb9274cf8aae9c706bc480718d9808`, aplikacja `0.1.0+39d9d46`), konfiguracja GitHub Pages i dane ostatniego wdrożenia (`pages-config.json`, `ostatnie-wdrozenie.json`), instrukcja `JAK_COFNAC.txt` oraz oryginalna paczka z pytaniami webinarowymi (`paczka/` — prywatna, nie publikować). Aplikacja nie ma serwera ani bazy danych — dane użytkowniczek są wyłącznie w ich przeglądarkach. Lustro `strona/` i pakiet git służą do porównania i odtworzenia historii — **nie** do ponownego wdrożenia starej wersji.

**Zwykłego cofnięcia nie wolno robić** — ani `git revert` Pull Requesta z webinarami, ani ponownego wdrożenia `39d9d46` czy lustra `strona/`. Po aktualizacji telefony mają dane, których aplikacja V18 nie obsłuży:

- baza profilu jest w wersji 5, a aplikacja V18 ma schemat 4: przy otwarciu pokazuje „Dane na tym urządzeniu zapisała nowsza wersja aplikacji…” i nauka jest niemożliwa — odświeżenie nic nie zmienia, bo serwer podaje tę samą starą wersję;
- nawet przy zgodnym schemacie sesje mają już nową wersję banku (`dme-v18-webinary-2026-11-15-8622d52b9a42`), więc aplikacja V18 odrzuca ich zapis (ochrona przed zapisem sesji innej wersji treści) — „Kontynuuj” i dalsza nauka w tych sesjach nie działają;
- próby i sesje z pytaniami WB odwoływałyby się do pytań, których stara aplikacja nie zna.

Jedyna droga przy poważnym błędzie to **poprawka „do przodu”** — nowy Pull Request do `main`, wdrażany jak każda zmiana:

1. Błąd w kodzie albo tekście: zwykła poprawka na nowej gałęzi, bez zmiany treści i schematu bazy.
2. Konieczność wycofania pytań WB (albo powrotu do samego V18): **nowe** wydanie treści z nową `bankVersion` (np. 700 pytań V18 pod nową wersją) **razem** z nową migracją IndexedDB **v6**, która przenosi dane z wersji 5 do tego wydania według allowlisty — sesje V18 zostają aktywne, sesje z pytaniami WB stają się podsumowaniami bez treści, a próby i „Moje błędy” pytań WB znikają z nauki. Nowa treść zmienia znacznik w Cache Storage, więc Service Worker przejmie otwarte karty sam, a migracja v6 obsłuży każdy profil osobno przy jego otwarciu.
3. Przed scaleniem poprawka przechodzi te same kontrole co to wydanie: Vitest, e2e aktualizacji z poprzedniej produkcji (dla wariantu 2 — z buildu tego wydania z dwoma profilami), `check-dist` i `check-offline`.

Sprawdzenie po wdrożeniu poprawki: `curl -s https://wiedza.doktormonika.pl/dme-release.json` pokazuje nową wersję (`appVersion` z nowym skrótem commita, a w wariancie 2 także nową `bankVersion`).
