---
title: 'Wydanie treści V18 + webinary (adapter, scalanie, katalog)'
type: 'feature'
created: '2026-11-15'
status: 'done'
baseline_revision: 'e251fb3f7dd06f4ae71be8380c76bc8bb08b40d4'
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/_bmad-output/specs/spec-webinary-247/SPEC.md'
  - '{project-root}/_bmad-output/specs/spec-webinary-247/kontrakt-danych.md'
  - '{project-root}/_bmad-output/specs/spec-webinary-247/teksty-ui.md'
warnings: ['oversized']
deferred:
  - summary: >-
      README.md (sekcja „Stan puli pytań”, generator allowlisty) opisuje jeszcze wyłącznie bank V18 (700 pytań, bank-5db40505308f.json, scripts/v18-allowlist.mjs).
    evidence: |-
      README.md nie należy do plików historii 1 (docs/ ma historia 4, README nie jest przypisany nikomu). Po tej zmianie wydanie ma 947 pytań, a allowlistę generuje scripts/webinary-addendum.mjs. Lider powinien przypisać aktualizację README.
    location: >-
      README.md
    severity: low
  - summary: >-
      src/app/mockController.ts:1652 ma na sztywno komunikat „…banku pytań V18 (700 pytań)…”, a prawdziwy kontroler liczy go już z CONTENT_RELEASE (V18 + webinary, 947).
    evidence: |-
      Decyzja lidera pozwalała w mockController.ts tylko na mapowanie trzech nowych pól. Tekst należy do historii 3 (teksty UI). Mock ładuje bieżący bank 947, więc w trybie ?mock=1 pokaże nieaktualną liczbę.
    location: >-
      src/app/mockController.ts:1652
    severity: low
  - summary: >-
      Walidacja kopii danych (src/persistence/backup.ts) nie sprawdza nowego pola snapshotu webinarEvidence ani pól źródła fileName/webinar.
    evidence: |-
      Uszkodzona lub spreparowana kopia z webinarEvidence bez tablicy unitIds przejdzie walidację (nieznane klucze są ignorowane), a reorderSnapshot (runda błędów, gdy pytania nie ma w katalogu) rzuci TypeError przy kopiowaniu unitIds. Walidacja kopii należy do historii 2 („kopia zachowuje nowe opcjonalne pola snapshotu”).
    location: >-
      src/persistence/backup.ts:325-358; src/domain/snapshot.ts:68
    severity: low
---

<intent-contract>

## Intent

**Problem:** Aplikacja ma tylko bank V18 (700 pytań). 247 pytań z webinarów (`content/webinary-2026-11-15/`) trzeba dołożyć jako dodatek, nie ruszając 700 rekordów V18, i tak, żeby aplikacja przyjęła nowe wydanie (wersja, SHA, allowlista 947, katalog z dowodem webinaru).

**Approach:** Skrypt Node z czystymi funkcjami (adapter `dme-webinar-addendum` → `dme-runtime-bank`, idempotentne scalanie, raport par identycznej treści) i trybem CLI generującym deterministycznie wszystkie wyjścia z `kontrakt-danych.md`; potem aktualizacja `contentRelease.ts`, typów, katalogu, snapshotu, kontroli startu i `check-dist.mjs`.

## Boundaries & Constraints

**Always:** 700 rekordów V18 głęboko równych `content/v18/bank.json` (kolejność i obiekty); pola WB 1:1 z dodatku + pola adaptera wg kontraktu; `url/doi/pmid` źródeł webinaru `null`; fingerprint algorytmem `src/domain/fingerprint.ts`; wyjścia bajtowo powtarzalne (`JSON.stringify(x, null, 2) + '\n'`); weryfikacja SHA wejść (V18 MANIFEST, dodatek MANIFEST); TDD.

**Never:** zmiana treści/metadanych V18; dodawanie ID do retired; usuwanie rekordów na podstawie podobieństwa; generowanie pytań, URL, PMID, DOI; kopiowanie do repo czegokolwiek spoza `content/webinary-2026-11-15/`; edycja plików historii 2–4 (`src/persistence/{bankMigration,schema,api,backup,validation,repository}.ts`, `tests/persistence/`, `tests/app/migracja-v18.test.ts`, `src/ui/`, `src/app/{viewModels,screenModels}.ts`, `src/app/mockController.ts` poza mapowaniem trzech nowych pól, `tests/ui/`, `src/pwa/`, `vite.config.ts`, `tests/pwa/`, `tests/e2e/`, `docs/`, `tests/docs/`); Service Worker i e2e.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Pierwsze scalenie | V18 (700) + dodatek (247) | bank 947, 939 rodzin, `addenda` 1 wpis, tematy `WB-T-<Wxx>-<DOM>` | brak |
| Ponowne uruchomienie CLI | te same wejścia | bajtowo te same 5 plików | brak |
| Scalenie wyniku z WB | bank 947 + ten sam dodatek | bajtowo ten sam bank, bez duplikatów | brak |
| Ten sam ID, inna treść | bank z WB-X o innej treści | przerwanie | błąd z ID i listą różniących się pól |
| Identyczna treść pod innymi ID | dwa rekordy o tym samym fingerprincie | raport par, nic nie usunięte | brak (raport) |
| Złe wejście | SHA/liczba/ID dodatku ≠ MANIFEST | przerwanie | błąd z opisem |
| Pytanie WB bez dowodu | `origin: webinar`, brak cytatu/fragmentów, zły prefiks, źródło z URL | rekord poza pulą (`catalog.issues`) | kod issue |

</intent-contract>

## Code Map

- `content/v18/bank.json` (+ `MANIFEST.json`, `allowed_question_ids.json`) -- baza scalania, SHA `5db40505…`.
- `public/data/{retired-question-ids-54a05ea91281,training-profile-2bdad504f50e}.json` -- wejście retired/profilu; przenoszę bajt w bajt do `content/v18/{retired_question_ids,training_profile}.json` (nazwy z V18 MANIFEST), żeby CLI dało się uruchomić ponownie po usunięciu plików V18 z `public/data/`.
- `content/webinary-2026-11-15/{bank_webinar_addendum.json,MANIFEST.json,Wykluczone_powtorzenia.json}` -- dodatek (247, SHA `ae7a7321…`), 3 wykluczone ID tylko do raportu.
- `scripts/v18-allowlist.mjs` -- wzór generatora `src/persistence/v18Allowlist.ts`; wydzielam czystą funkcję renderującą moduł (CLI zostaje).
- `src/domain/fingerprint.ts:fingerprintRuntimeQuestion` -- algorytm fingerprintu (Node 24 importuje `.ts` przez usuwanie typów).
- `src/domain/contentRelease.ts` -- `CONTENT_RELEASE` (wersja, SHA, pliki, liczby) i `CONTENT_RELEASE_LABEL`; czytany też regexami w `scripts/check-dist.mjs:74-94`.
- `src/domain/types.ts:203-269,386-396,593-645` -- `RuntimeSource`, `RuntimeQuestion`, `CatalogSource`, `CatalogQuestion`, `SnapshotSource`, `QuestionSnapshot`.
- `src/domain/catalog.ts:90-165` (`checkRuntimeQuestion`), `:169-222` (`toCatalogQuestion`, `toCatalogSource`), `:400-500` (`buildCatalog`) -- walidacja; tematy sprawdzane tylko jako niepusta lista (bez zgodności działu), więc temat WB z działem pytania wystarcza.
- `src/domain/snapshot.ts:buildSnapshot/reorderSnapshot` -- przeniesienie `webinarEvidence`, `fileName`, `webinar`.
- `src/app/appController.ts:575-600` (`buildContentCatalog`), `:715-733` (`parseContent`) -- kontrola SHA, wersji, liczb i allowlisty.
- `src/persistence/v18Allowlist.ts` -- generowany; eksporty `V18_ALLOWED`, `V18_ALLOWED_BANK_VERSION` bez zmiany nazw (używa ich `bankMigration.ts` z historii 2).
- `tests/content.ts` -- wczytanie bieżącego wydania dla testów.
- `tests/domain/bank-v18.test.ts`, `bank-smoke.test.ts`, `fingerprint.test.ts` -- przestawiam na pilnowanie 700 rekordów V18 wewnątrz wydania; `tests/app/wydajnosc.test.ts:80` -- liczba z `CONTENT_RELEASE`.
- `src/app/mockController.ts:131-185` -- buduje `CatalogQuestion`/`CatalogSource` literałami (historia 3); decyzja lidera (wariant A): dopisuję tylko mechaniczne mapowanie `webinarEvidence`, `fileName`, `webinar`.

## Tasks & Acceptance

**Execution:**
- `tests/domain/webinary-addendum.test.ts` -- testy czystych funkcji: adapter, lokalizator, scalanie, idempotencja, konflikt ID, pary identycznej treści, wersja wydania -- TDD dla skryptu.
- `scripts/webinary-addendum.mjs` + `scripts/webinary-addendum.d.mts` -- funkcje i CLI; CLI zapisuje 3 pliki `public/data`, allowlistę `content/v18-webinary/`, `src/persistence/v18Allowlist.ts`, usuwa inne pliki banku z `public/data/` i drukuje raport.
- `scripts/v18-allowlist.mjs` -- eksport czystej funkcji renderującej moduł allowlisty.
- `tests/domain/catalog-webinar.test.ts` -- walidacja WB, mapowanie źródła i dowodu, snapshot.
- `src/domain/types.ts`, `catalog.ts`, `snapshot.ts` -- pola i walidacja wg kontraktu.
- `tests/domain/bank-webinary.test.ts` -- test wydania (SHA/MANIFEST, 947 = 700 + 247, V18 głęboko równe, WB 1:1, `[webinar]`, źródła bez url/doi/pmid, profil, retired, allowlista, 939 rodzin, Test N = 939, idempotencja CLI).
- `src/domain/contentRelease.ts` -- nowe wartości i `CONTENT_RELEASE_LABEL = 'V18 + webinary'`, `counts.webinar = 247`.
- `src/app/appController.ts` -- kontrola liczby pytań WB; komunikaty bez „V18” jako jedynego banku.
- `src/app/mockController.ts` -- wyłącznie mapowanie trzech nowych pól (decyzja lidera, wariant A) -- typecheck.
- `scripts/check-dist.mjs` -- allowlista 947 z `content/v18-webinary/`, liczba WB, dawne pliki V18 zakazane w dist, precache i kodzie.
- `tests/domain/bank-v18.test.ts`, `bank-smoke.test.ts`, `tests/app/wydajnosc.test.ts` -- dostosowanie do wydania.

**Acceptance Criteria:**
- Given wygenerowane pliki, when uruchamiam `npm test`, then testy wydania potwierdzają 947 pytań, 939 rodzin, 700 rekordów V18 głęboko równych bazie i 247 WB 1:1 z dodatkiem.
- Given `public/data/`, when listuję katalog, then są w nim tylko trzy pliki nowego wydania (bez `bank-5db40505308f.json` i plików towarzyszących V18).
- Given katalog przy starcie aplikacji, when buduję go z nowego wydania, then nie ma `catalog.issues`, a ID = allowlista 947 z rewizją, fingerprintem i kluczem.
- Given `npm run build`, when uruchamiam `node scripts/check-dist.mjs --dist dist --base /`, then FAIL = 0.

## Spec Change Log

## Review Triage Log

### 2026-11-15 — Review pass
- verdicts: 40 findings — high 0, medium 2, low 34, false 4, maybe-false 0
- findings:
  - `[low]` `[patch]` (blind) `scripts/v18-allowlist.mjs` domyślnie nadpisuje `src/persistence/v18Allowlist.ts` wersją 700 — ścieżka wyjścia jest teraz wymagana (kod 2 bez niej), nagłówek odsyła do `scripts/webinary-addendum.mjs`; test `tests/domain/webinary-cli.test.ts`.
  - `[low]` `[reject]` (blind) `bank_version` zależy tylko od SHA wejść, nie od wyniku adaptera — wzór jest wiążący w kontrakcie-danych; zmiana adaptera bez zmiany wejść to decyzja lidera (zgłoszone w raporcie).
  - `[low]` `[patch]` (blind) adapter sprawdza mniej niż `validate_addendum.py` — dodane kontrole `schema_version` 1, `integration_mode` append, `clinical_signoff`/`official_exam_question_bank` false i `[webinar]` w każdym `stem_pl`; 4 opcje/klucz pilnuje katalog (`catalog.issues` = [] dla 947). Testy w `webinary-addendum.test.ts`.
  - `[low]` `[reject]` (blind) katalog nie odrzuca pytania bez `origin` ze źródłem webinarowym — wymaga nowej gałęzi; rzadkie (dane z SHA), a utratę `origin` łapie licznik WB przy starcie (test w `appController.test.ts`).
  - `[low]` `[reject]` (blind) brak limitu długości `evidence_quote` — cytaty muszą zostać 1:1 z kanonicznego dodatku (SHA w MANIFEST); limit byłby wymyślony (kontrakt go nie podaje).
  - `[low]` `[defer]` (blind) README nieaktualne — poza plikami historii 1; wpis w `deferred`.
  - `[low]` `[reject]` (blind) CLI nie generuje wartości `contentRelease.ts` — test `bank-webinary` pilnuje zgodności; generowanie modułu to nowa funkcja.
  - `[low]` `[reject]` (blind) niespójne teksty `family_merges_note_pl`/`difficulty_note_pl`, odmiana liczebnika — kontrakt każe zostawić pola V18 bez zmian, pola nie są wyświetlane w UI (grep src/ui), liczba jest stała (247 pytań — poprawna forma); brzmienie dopisanych zdań do potwierdzenia przez lidera.
  - `[low]` `[reject]` (blind) rozbieżność przykładu `WB-T-W16-DEV` zapisana tylko w komentarzu testu — poprawka wymaga edycji specyfikacji (odrzucone z reguły); opisane w Auto Run Result.
  - `[low]` `[defer]` (blind) mock ma na sztywno „V18 (700 pytań)” — historia 3; wpis w `deferred`.
  - `[low]` `[reject]` (blind) limit 30 s w `regresje-weryfikacji.test.ts` ukrywa spowolnienia — test funkcjonalny (SAFE 36 → 83 rodziny, praca rośnie ~kwadratowo w jednym teście); wydajność mierzy `wydajnosc.test.ts` z niezmienionymi limitami.
  - `[medium]` `[patch]` (blind) żaden test nie uruchamia CLI zwykłym Node — dodany `tests/domain/webinary-cli.test.ts`: kopia wejść w katalogu tymczasowym, 5 plików bajtowo równych repo, usunięcie plików V18 z `public/data`, obcy plik zostaje, drugi przebieg bez zmian.
  - `[low]` `[patch]` (blind) luki w kontroli webinarów w `check-dist.mjs` — poprawiona etykieta skanu („wersja V15, pliki V18”); pozostałe kontrole (źródła WB, cytat) pilnuje katalog i testy domeny, a `undefined` jako „źródło z adresem” jest tylko ostrzejsze — bez zmian.
  - `[low]` `[reject]` (blind) `computeCounts` gubi nieznane klucze `counts` bazy — baza V18 jest przypięta SHA i ich nie ma; strażnik dodałby złożoność.
  - `[low]` `[defer]` (edge) brak walidacji `webinarEvidence` w kopii danych → możliwy TypeError w `reorderSnapshot` przy spreparowanej kopii — `backup.ts` należy do historii 2; wpis w `deferred`.
  - `[low]` `[patch]` (edge) `v18-allowlist.mjs` nadpisuje domyślnie allowlistę — ta sama poprawka co wyżej.
  - `[low]` `[reject]` (edge) `mergeBank` pomija aktualizacje, gdy baza nie ma kluczy `built_on`/`counts`/`bank_version` — baza V18 przypięta SHA ma wszystkie klucze.
  - `[low]` `[reject]` (edge) `Wykluczone_powtorzenia.json` jako tablica przechodzi kontrolę — plik w repo, test sprawdza 3 klucze; mało prawdopodobne.
  - `[low]` `[patch]` (edge) dodatek bez kontroli `schema_version`/`integration_mode`/`clinical_signoff` — ta sama poprawka co kontrola jak w `validate_addendum.py`.
  - `[low]` `[reject]` (edge) nie-tekstowy `stem_pl` / opcja bez `text_pl` daje TypeError bez ID — dane z SHA; mało prawdopodobne.
  - `[low]` `[reject]` (edge) powtórzenia w `source_ids`/`evidence_unit_ids` dublują grupy lokalizatora — brak w danych; strażnik dodałby złożoność.
  - `[false]` `[reject]` (edge) zamiana `700` w niezwiązanym zdaniu `rules_pl` — test `bank-webinary` przypina dokładny wynik `rules_pl`; liczba występuje tylko w zdaniach o liczbie pytań.
  - `[low]` `[patch]` (edge) CLI uruchomione przez dowiązanie symboliczne nic nie robi i kończy się kodem 0 — wykrywanie głównego modułu porównuje teraz ścieżki rzeczywiste (`isMainModule`, `realpathSync`) w obu skryptach; test przez dowiązanie w `webinary-cli.test.ts` (wcześniej czerwony).
  - `[low]` `[reject]` (edge) pytanie bez `origin` z cechami webinaru — jak wyżej (licznik WB przy starcie).
  - `[false]` `[reject]` (edge) CLI zostawia dawny `public/data/bank.json` — wzorzec usuwania jest zgodny ze specyfikacją; pliku nie ma, a `check-dist` blokuje go w dist.
  - `[low]` `[patch]` (gap) brak testu odrzucenia źródła z HTML w `filename` — dodany test w `catalog-webinar.test.ts`; test mutacyjny (usunięcie zabezpieczenia) go czerwieni.
  - `[low]` `[patch]` (gap) brak testu notatki `source_note_pl`, która nie jest tekstem — dodany wiersz `it.each`; test mutacyjny go czerwieni.
  - `[low]` `[defer]` (gap, other) mock ma na sztywno „V18 (700 pytań)” — jak wyżej, historia 3.
  - `[low]` `[reject]` (intent A) przeniesienie retired/profilu V18 do `content/v18/` (katalog spoza listy plików) — świadoma decyzja z Code Map (CLI musi dać się uruchomić ponownie); bajty i SHA z MANIFEST V18 bez zmian; zgłoszone liderowi.
  - `[low]` `[reject]` (intent E) reguła `WEBINAR_SOURCE` (pytanie WB tylko ze źródłami webinaru) wykracza poza kontrakt — zapisana w Design Notes; dane ją spełniają; zgłoszone liderowi.
  - `[low]` `[reject]` (intent G) zmiana `MSG_PACKS_DISABLED` poza kontrolą startu — tekst liczony z `CONTENT_RELEASE_LABEL` i `counts.questions` zgodnie z regułą `teksty-ui.md`; pozostawiony, zgłoszony liderowi do decyzji.
  - `[low]` `[reject]` (intent H) zdania `status_pl`/`pool_note_pl` ułożone przez programistę — treść wg kontraktu; brzmienie zgłoszone liderowi do potwierdzenia.
  - `[low]` `[patch]` (intent I) `validate_addendum.py` nieodwzorowany — ta sama poprawka kontroli dodatku.
  - `[low]` `[reject]` (intent J) poluzowany limit czasu — jak wyżej.
  - `[medium]` `[patch]` (intent) `main()` CLI bez testu — ta sama poprawka (`webinary-cli.test.ts`).
  - `[low]` `[reject]` (intent) ponowne scalenie testowane tylko na danych syntetycznych — test `bank-webinary` porównuje `buildRelease` z plikami repo, a audytor sprawdził ręcznie idempotencję na banku 947.
  - `[low]` `[reject]` (intent) raport par po fingerprincie nie widzi duplikatu WB↔V18 różniącego się tylko `[webinar]` — sprawdzono oba warianty (z i bez oznaczenia): 0 par; zgłoszone liderowi.
  - `[false]` `[reject]` (intent) `check-dist` nieuruchamiany — uruchomiony w weryfikacji: 87 kontroli, FAIL 0.
  - `[false]` `[reject]` (intent) brak asercji „4 opcje / 1 klucz” dla WB — katalog odrzuca rekord bez 4 opcji lub z kluczem spoza opcji, a test wymaga `catalog.issues` = [] i 947 pytań.
  - `[low]` `[reject]` (intent) zgodność działu tematu WB niesprawdzana temat po temacie — test porównuje tematy z parami (source_id, domain_id) i `topic_ids` każdego pytania.

## Design Notes

**Miejsce pracy.** `{project-root}` = `/Users/dominiklyzwa/DEWELOPER_CLAUDE/projekty/doktor-monika-egzamin/.worktrees/1` (git worktree, gałąź `story/1`). Wszystkie ścieżki są względem niego; nie edytuj głównego folderu projektu ani innych `.worktrees/*`. Komendy `git` i `npm`/`npx` uruchamiaj poza sandboxem. Nie commituj (commit robi workflow po przeglądzie). Zależności są zainstalowane (`npm ci`); stan wyjściowy `npm test`: 665/665 zielone. TDD: najpierw test czerwony z właściwego powodu, potem kod, potem porządki; nie zmieniaj testu tylko po to, żeby przeszedł.

**Wersja i pliki.** `bank_version` = `dme-v18-webinary-2026-11-15-` + pierwsze 12 znaków hex `sha256("<sha V18>+<sha dodatku>")` (tekst UTF-8, pełne 64-znakowe SHA), `built_on` `2026-11-15`. Pliki `public/data/{bank,retired-question-ids,training-profile}-<12 znaków SHA pliku>.json`. Serializacja każdego JSON: `JSON.stringify(x, null, 2) + '\n'` (tak są zapisane wejścia — sprawdzone bajtowo). Wejście retired/profil: `git mv` V18 plików z `public/data/` do `content/v18/retired_question_ids.json` i `content/v18/training_profile.json` (bajt w bajt; SHA zgodne z `content/v18/MANIFEST.json` → `files["runtime/…"]`); CLI weryfikuje SHA bank/allowlista/retired/profil z V18 MANIFEST oraz SHA, `question_count`, `active_ids` (zbiór i kolejność) i `mode: append` z MANIFEST dodatku; 3 ID z `Wykluczone_powtorzenia.json` tylko w raporcie (sprawdź, że nie ma ich w banku). CLI usuwa z `public/data/` każdy plik `bank-*.json`, `retired-question-ids-*.json`, `training-profile-*.json` inny niż trzy bieżące.

**Adapter WB.** Rekord: pola z dodatku bez zmian (lista w kontrakcie) + pola adaptera. Proponowana kolejność kluczy: `id, domain_id, topic_ids, family_id, revision, difficulty, difficulty_is_technical_placeholder, question_type, figure_id, explanation_figure_id, stem_pl, options, correct_option_id, correct_explanation_pl, source_ids, source_locator_pl, review_status, approved_for_question_key, content_check_status, cognitive_level, fingerprint, origin, source_id, subdomain (gdy jest), evidence_unit_ids, evidence_quote, source_note_pl, clinical_signoff`. W dodatku `review_status` = `source_checked_AI_draft` (adapter: `review_status: draft_pending_clinical_review`, `content_check_status: source_checked_AI_draft`; inna wartość w dodatku → błąd). Temat pytania z `source_id` (nie z wszystkich `source_ids`). `source_locator_pl`: dla każdego `sid` z `source_ids` (kolejność `source_ids`) grupa `"<sid>: <fragmenty z prefiksem sid- w kolejności dodatku>"`, grupy bez fragmentów pomijane, łącznik `"; "`. Przykład z danych: `WB-USGTR-017` (`source_ids [W11, W16]`, fragmenty `[W16-U0010, W11-U0033]`) → `"W11: W11-U0033; W16: W16-U0010"`, temat `WB-T-W16-DEV`. Fragment bez prefiksu z `source_ids` → błąd. Źródło: kształt z kontraktu (kolejność kluczy jak tam); `kind`, `url`, `locator_type`, `audio_verified` dodatku muszą być `user_supplied_webinar_transcript`/`null`/`source_unit`/`false`, inaczej błąd. Tematy `WB-T-<Wxx>-<DOM>` posortowane po ID, kolejność kluczy jak tematy V18. Fingerprint: `fingerprintRuntimeQuestion` z `../src/domain/fingerprint.ts` (Node 24 importuje `.ts`; test musi przeliczyć go dla wszystkich 947). Do testów TS potrzebny `scripts/webinary-addendum.d.mts` (jak `scripts/sw-takeover.d.mts`).

**Scalanie** (`mergeBank(base, adapted, opcje)`, czyste): pytania bazy bez zmian, WB dopisane w kolejności dodatku; ID, źródło, temat albo wpis `addenda` już obecny — identyczny (kanoniczny JSON z posortowanymi kluczami) → pominięty, inny → błąd `"<ID>: inna treść niż w banku — pola: <lista pól ze starą i nową wartością, skróconą>"`; powtórzony ID w samym dodatku → błąd. `addenda` wstawione przed `domains` (gdy go nie ma). `counts`: `questions, families, by_domain, by_difficulty` (kolejność kluczy jak w `counts` bazy, nowe na końcu), `schematic`, potem liczby `content_check_status` w kolejności pierwszego wystąpienia w pytaniach (→ `independently_checked_draft` 600, `author_checked_draft` 100, `source_checked_AI_draft` 247). Raport par: grupy pytań o tym samym `fingerprint` pod różnymi ID (oczekiwane 0), nic nie usuwane. Teksty dopisywane (tylko gdy jeszcze nie ma ich na końcu; liczba 247 = liczba pytań dodatku) — do potwierdzenia przez lidera w raporcie:
- `status_pl` += `" 247 pytań z transkrypcji webinarów (napisy automatyczne): klucz sprawdzony przez AI względem transkrypcji, bez recenzji klinicznej."`
- `pool_note_pl` += `" Dodano 247 pytań z transkrypcji webinarów (napisy automatyczne); klucz sprawdzony przez AI względem transkrypcji, bez recenzji klinicznej."`
Pozostałe pola najwyższego poziomu V18 (`family_merges_note_pl`, `difficulty_mode`, `difficulty_note_pl` itd.) bez zmian.

**Pliki towarzyszące.** Retired: obiekt V18 z nową `bank_version` (ID i `policy` bez zmian; żadne ID nie w banku). Profil: obiekt V18 z nową `bank_version`, grupy V18 bez zmian + ID WB dopisane w kolejności dodatku wg działu, w `rules_pl` `\b700\b` → `947` (co najmniej jedna zamiana, inaczej błąd); każde ID banku w dokładnie jednej grupie. Allowlista `content/v18-webinary/allowed_question_ids.json` jak w kontrakcie (ID V18 w kolejności `content/v18/allowed_question_ids.json`, potem WB). `src/persistence/v18Allowlist.ts`: generator z `scripts/v18-allowlist.mjs` wydzielony do eksportowanej czystej funkcji (CLI tamtego skryptu ma działać dalej, uruchamiany tylko jako główny moduł); eksporty `V18_ALLOWED` i `V18_ALLOWED_BANK_VERSION` bez zmiany nazw (wartość = nowa wersja, 947 wierszy posortowanych po ID), komentarz nagłówka opisuje skład 700 V18 + 247 WB.

**Aplikacja.** `CONTENT_RELEASE`: wartości z CLI; `counts`: `questions 947, basic 647, intermediate 200, advanced 100, retired 3120, webinar 247`; `CONTENT_RELEASE_LABEL = 'V18 + webinary'`. Katalog: pytanie z `origin` innym niż brak/`'webinar'` → issue; pytanie WB wymaga niepustego `evidence_quote`, ≥ 1 `evidence_unit_ids` `^W\d\d-U\d{4}$` z prefiksem z `source_ids`, `stem_pl` kończącego się `[webinar]` i wyłącznie źródeł webinarowych; źródło webinarowe (`kind` = `user_supplied_webinar_transcript`) z niepustym `url`/`doi`/`pmid` → nieprawidłowe źródło (`INVALID_SOURCE`); cytat i notatka objęte kontrolą `hasUnsafeMarkup`. `webinarEvidence` = `{ quote: evidence_quote, unitIds: evidence_unit_ids, note: source_note_pl ?? '' }` albo `null`. `appController.buildContentCatalog` dodatkowo sprawdza liczbę pytań z `webinarEvidence` = `counts.webinar`; komunikaty błędów mówią o „banku V18 + webinary” (`CONTENT_RELEASE_LABEL`). `check-dist.mjs`: allowlista z `content/v18-webinary/` (947 = `components` V18 700 + WB 247), liczba WB w banku = `webinar` z `contentRelease.ts`, `allowedSha256` = SHA allowlisty, dawne pliki V18 dopisane do `legacyDataFiles` i do skanu kodu po NAZWACH plików (`bank-5db40505308f`, `retired-question-ids-54a05ea91281`, `training-profile-2bdad504f50e`), nie po samej wersji V18 (`bankMigration.ts` z historii 2 zachowa stałą wersji V18).

**Testy innych historii.** Jeśli test z obszaru historii 2–4 (lista w „Never”) jest czerwony WYŁĄCZNIE z powodu nowej wersji/SHA/nazw plików/liczb — nie poprawiaj go, wypisz w raporcie z nazwą i przyczyną. Każdy inny czerwony test napraw (np. `tests/app/wydajnosc.test.ts:80` → liczba z `CONTENT_RELEASE.counts.questions`). `tests/domain/freeflow.test.ts` „priorytet DEV 0,40…” bywa niestabilny przy obciążeniu (limit 5000 ms) — odnotuj, jeśli się powtarza.

**Raport końcowy** ma zawierać: ostateczne `bankVersion`, SHA i nazwy trzech plików, `allowedSha256`, liczby (pytania, rodziny, po działach, po trudności), raport par identycznych pytań oraz wynik `npm test` / `typecheck` / `build` / `check-dist`.

## Verification

**Commands:**
- `node scripts/webinary-addendum.mjs` (2×) -- expected: drugi przebieg bez zmian w `git status`.
- `npm test` -- expected: wszystkie testy domeny zielone; czerwone tylko testy historii 2–4 zależne od wersji/liczb (lista w raporcie).
- `npm run typecheck`, `npm run build` -- expected: sukces.
- `node scripts/check-dist.mjs --dist dist --base /` -- expected: FAIL 0.

## Auto Run Result

Status: done

**Zmiana.** Wydanie treści „V18 + webinary”: skrypt `scripts/webinary-addendum.mjs` (adapter `dme-webinar-addendum`, idempotentne scalanie, raport par, pliki towarzyszące, CLI) wygenerował bank 947 pytań (700 V18 bez zmian + 247 WB), retired, profil, allowlistę 947 i `src/persistence/v18Allowlist.ts`; aplikacja przyjmuje nowe wydanie (typy, katalog z walidacją WB, snapshot z dowodem, kontrola startu, `check-dist`).

- `bankVersion` `dme-v18-webinary-2026-11-15-8622d52b9a42`; `data/bank-475c1fef0099.json` (SHA `475c1fef009903f4151cd8234ca279ece879a89b6dabfb86e5e29045f7af171e`), `data/retired-question-ids-40450ecb4f2b.json` (`40450ecb4f2bdba293b29a77a7b0093e8781cc40c93095fd316e6fb0e122c5ba`), `data/training-profile-a8bf8dbe7e3b.json` (`a8bf8dbe7e3b23ed08e73a99396dcb412d842b9ebceac8d655e3775bbc8c664f`); `allowedSha256` `3af684c4716ad8721d7b4f23328b7a5db08afcc898b669cdcc6266e02d6fd9f5`.
- 947 pytań, 939 rodzin; ANAT 147, SKIN 196, DEV 263, INJ 186, THER 72, SAFE 83; basic 647, intermediate 200, advanced 100; statusy 600/100/247; pary identycznej treści: 0.

**Pliki.**
- `scripts/webinary-addendum.mjs`, `scripts/webinary-addendum.d.mts` — nowy skrypt wydania i typy dla testów.
- `scripts/v18-allowlist.mjs` — czysta funkcja `renderAllowlistModule`, `isMainModule`, wymagana ścieżka wyjścia.
- `scripts/check-dist.mjs` — allowlista 947 + SHA, liczba WB, źródła WB bez adresów, dawne pliki V18 zakazane.
- `content/v18/{retired_question_ids,training_profile}.json` — przeniesione bajt w bajt z `public/data/` (wejście CLI).
- `content/v18-webinary/allowed_question_ids.json`, `public/data/*` (3 pliki), `src/persistence/v18Allowlist.ts` — wygenerowane.
- `src/domain/{types,catalog,snapshot,contentRelease}.ts` — pola i walidacja WB, nowe wydanie.
- `src/app/appController.ts` — kontrola liczby pytań WB, komunikaty z `CONTENT_RELEASE_LABEL` (także `MSG_PACKS_DISABLED`).
- `src/app/mockController.ts` — tylko mapowanie `webinarEvidence`, `fileName`, `webinar` (decyzja lidera, wariant A).
- Testy: nowe `tests/domain/{webinary-addendum,bank-webinary,catalog-webinar,webinary-cli}.test.ts`; dostosowane `bank-v18`, `bank-smoke`, `fingerprint`, `tests/content.ts`, `tests/app/{wydajnosc,appController,regresje-weryfikacji}.test.ts`.

**Przegląd.** 40 zgłoszeń: poprawione 11 wierszy (2 medium: test CLI zwykłym Node — zgłoszony przez dwie warstwy; 9 low: wymagane wyjście `v18-allowlist`, kontrole całego dodatku i `[webinar]`, wykrywanie głównego modułu przez ścieżki rzeczywiste, etykieta `check-dist`, dwa testy luk weryfikacji); odłożone 4 wiersze = 3 sprawy (README, tekst w mocku, walidacja `webinarEvidence` w kopii danych); odrzucone 25 z powodami w Review Triage Log. Przykład w Design Notes (`WB-USGTR-017` → `WB-T-W16-DEV`) był błędny: pytanie ma dział INJ, kod i test stosują regułę kontraktu (`WB-T-W16-INJ`).

**Rekomendacja kolejnego przeglądu:** `false` — poprawiony 1 wpis medium (test CLI, zgłoszony przez dwie warstwy), 0 high.

**Weryfikacja.** `node scripts/webinary-addendum.mjs` 2× — bez zmian w plikach; `npm test` — 756 przeszło, 8 nie (tylko `tests/ui/pula-v18.test.tsx` ×3 i `tests/docs/raport-kontroli.test.ts` ×5 — oczekują liczb/wersji V18; historie 3 i 4); `npm run build` (z typecheck) — OK; `node scripts/check-dist.mjs --dist dist --base /` — 87 kontroli, FAIL 0, WARN 0; testy mutacyjne dwóch nowych testów luk — czerwone po usunięciu zabezpieczeń.

**Ryzyka.** Brzmienie zdań dopisanych do `status_pl`/`pool_note_pl` (widoczne w „O bazie pytań”) czeka na potwierdzenie lidera; `MSG_PACKS_DISABLED` zmieniony poza zakresem „kontroli startu”; `bank_version` nie zmieni się przy samej zmianie adaptera (wzór z kontraktu); dwa testy E03 z limitem 30 s; `freeflow` „priorytet DEV 0,40” bywa niestabilny przy obciążeniu.
