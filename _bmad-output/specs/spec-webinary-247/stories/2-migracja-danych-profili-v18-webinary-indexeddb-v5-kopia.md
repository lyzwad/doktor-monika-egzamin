---
title: 'Migracja danych profili do wydania V18 + webinary (IndexedDB v5, kopia)'
type: 'feature'
created: '2026-11-15'
status: 'done'
baseline_revision: 'e251fb3f7dd06f4ae71be8380c76bc8bb08b40d4'
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/_bmad-output/specs/spec-webinary-247/SPEC.md'
  - '{project-root}/_bmad-output/specs/spec-webinary-247/kontrakt-danych.md'
  - '{project-root}/docs/MIGRACJA_V18.md'
warnings: ['oversized']
deferred:
  - summary: >-
      Migracja v5 przekształca dane tylko raz (przy podniesieniu schematu 4 → 5); zmiana treści bez nowej wersji schematu nie uruchamia jej ponownie, więc historia 2 nie może trafić do użytkowników bez historii 1.
    evidence: |-
      W tej gałęzi CURRENT_BANK_TARGET.bankVersion = V18. Baza otwarta przez taki build przechodzi na v5 z meta.content = V18; po późniejszej podmianie CONTENT_RELEASE (historia 1) żadna migracja już się nie uruchamia, a staleContentSession odrzuca zapis otwartych sesji V18. Wzorzec „wydanie treści = nowa wersja schematu” jest wcześniejszy (v4). Ograniczenie procesowe: historie 1 i 2 muszą trafić do main w jednym wdrożeniu (gałąź feat/webinary-247 jako całość); zmiana tego wymagałaby przekształcania poza transakcją versionchange, czego zabrania SPEC.
    location: >-
      src/persistence/schema.ts:151
    severity: medium
  - summary: >-
      docs/MIGRACJA_V18.md opisuje v4 jako migrację przekształcającą dane i wskazuje createMigrationV4, którego już nie ma (v4 jest teraz krokiem historycznym, przekształcenie robi createMigrationV5).
    evidence: |-
      Sekcja 3 dokumentu: „baza przechodzi z wersji 3 na 4 (src/persistence/schema.ts, createMigrationV4)”. docs/ należy do historii 4 (docs/MIGRACJA_WEBINARY.md) — poza granicami plików historii 2.
    location: >-
      docs/MIGRACJA_V18.md
    severity: low
---

<intent-contract>

## Intent

**Problem:** Nowe wydanie treści (700 pytań V18 + 247 WB, nowa `bankVersion`) zmienia wersję banku. Obecna transformacja (`transformToCurrentBank`) zamieniłaby puste sesje V18 w podsumowania `legacy`, a otwarte w „przerwane aktualizacją”, a schemat IndexedDB nie ma kroku, który przeniesie dane telefonów z v4.

**Approach:** Sparametryzować transformację wydaniem docelowym (bankVersion, SHA banku, allowlista, wersje-poprzednicy; domyślnie bieżące `CONTENT_RELEASE` + `v18Allowlist.ts` + poprzednik V18) i dodać migrację schematu v5 (ta sama transformacja w jednej transakcji `versionchange`; v4 staje się historycznym krokiem bez zmian danych, jak v2). Sesja poprzednika (V18) bez niezgodnego snapshotu — także bez slotów — zostaje aktywna z nową `bankVersion`. Kopia danych używa tej samej transformacji i zachowuje nowe opcjonalne pola snapshotu.

## Boundaries & Constraints

**Always:** migracja wyłącznie w transakcji `versionchange`, błąd = abort (baza zostaje w poprzedniej wersji); idempotencja; decyzja o zgodności wyłącznie z allowlisty (ID + rewizja + fingerprint + klucz); `LegacySessionInfo.reason` nowych podsumowań = `bank_v18_update` (typ bez zmian, stare rekordy czytelne); sesje `legacy` bez zmian; dane innych profili nietknięte; stare snapshoty bez nowych pól nadal przyjmowane; TDD.

**Never:** edycja `src/domain/*`, `src/persistence/v18Allowlist.ts`, `scripts/`, `public/`, `content/`, `src/ui/`, `src/app/*`, `src/pwa/`, `tests/e2e/`, `docs/`; przypisywanie odpowiedzi do innych ID po podobieństwie; kasowanie baz; przenoszenie pustych sesji wersji niebędących poprzednikiem (V15, V16, V17).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| V18 → wydanie | baza v4: test ukończony, runda błędów otwarta (zgłoszenie + zastępstwo), Free Flow otwarty, pusta otwarta, próby, powtórki, blokada | baza v5; każda sesja aktywna, status/plan/wynik bez zmian, `bankVersion` sesji i snapshotów = nowa, `revision + 1`; próby, powtórki, blokady bez zmian; dalsza odpowiedź i zapis działają | — |
| Pusta sesja nie-poprzednika | otwarta sesja V15/V16 bez slotów | `interrupted_by_update` (jak dotąd) | — |
| Niezgodny snapshot V18 | ID z allowlisty, inna treść | sesja → podsumowanie `legacy` (`bank_v18_update`) | — |
| Sesje `legacy` | podsumowania z v4 | głęboko równe przed i po | — |
| Idempotencja | wynik transformacji / drugie wykonanie kroku v5 | ten sam wynik | — |
| Przerwanie | wyjątek po magazynie sessions/attempts/questionStats/blocks | `MigrationFailed`, baza v4 (lub v3) z nietkniętymi danymi; ponowienie kończy migrację | abort transakcji |
| v1/v3 → v5 | dane V15/sprzed V15 | jedna aktualizacja, podsumowania bez treści | — |
| Kopia V18 | plik z aplikacji V18 | wczytanie = ten sam stan co migracja bazy | — |
| Kopia z polami webinaru | snapshot z `webinarEvidence`, `sources[].fileName`, `sources[].webinar` | pola zachowane w imporcie i eksporcie | niepoprawny typ pola → `InvalidBackup` |

</intent-contract>

## Code Map

- `src/persistence/bankMigration.ts` -- `transformToCurrentBank` (l. 217), `isTransferable` (l. 113, odrzuca sesje bez slotów), `restamp` (l. 139), `toLegacy` (`reason: 'bank_v18_update'`, l. 174), moduł-poziomowa mapa `ALLOWED` z `V18_ALLOWED` (l. 82), `BANK_MIGRATION_ID = 'bank-v18'` (l. 28).
- `src/persistence/schema.ts` -- `createMigrationV4` (l. 133: odczyt 8 magazynów → transformacja → zapis, kopie bezpieczeństwa, `meta.content` + `migration:<id>`, `toSchemaVersion: 4` na sztywno), `MIGRATIONS` (l. 257), wzorzec kroku historycznego `MIGRATION_V2`.
- `src/persistence/api.ts` -- `DB_SCHEMA_VERSION = 4` (l. 35), `ContentMetaRecord`, `MigrationMetaRecord`.
- `src/persistence/repository.ts` -- `InternalRepositoryOptions` (l. 81), `contentBankVersion` (l. 263) i `staleContentSession` (l. 100), eksport (l. 441) i `parseBackup` (l. 454) wywołują transformację, `readContentMeta` (l. 609, klucz `migration:${BANK_MIGRATION_ID}`).
- `src/persistence/backup.ts` -- `SNAPSHOT_SPEC`/`SNAPSHOT_SOURCE_SPEC` (l. 325, 349; dodatkowe pola przechodzą bez kontroli), `validateBackupJson` → `toCurrentBankBackup` (l. 812, 840), `parseBackup` (l. 873).
- `tests/persistence/fixtures.ts` -- `sampleUserData`, `profileData(bankVersion, pick)`, `snapshotOf`, `freshRepository`.
- `tests/persistence/migracja-v18.test.ts`, `tests/app/migracja-v18.test.ts`, `tests/persistence/kontrakt.test.ts` -- testy v4 (do przestawienia na v5 i `createMigrationV5`).
- `src/domain/sessions.ts` (tylko odczyt) -- `answer`, `nextFreeFlowSlot` do dowodu wznawialności; `buildCatalog` z `src/domain/catalog.ts` dla syntetycznego katalogu.

## Tasks & Acceptance

**Execution:**
- `tests/persistence/fixtures.ts` -- syntetyczne wydanie „V18 + 2 WB” (`SYNTH_TARGET`, pytania WB z `webinarEvidence`), profil V18 z dodatkowymi sesjami (otwarty Free Flow, pusta otwarta), katalog syntetyczny -- dane do testów prawdziwego przejścia V18 → nowa wersja.
- `tests/persistence/migracja-webinary.test.ts` -- testy macierzy (transformacja, IndexedDB v4 → v5, dwa profile, idempotencja, atomowość, v1/v3 → v5, kopia) -- czerwone przed kodem.
- `src/persistence/bankMigration.ts` -- `BankTarget`, `CURRENT_BANK_TARGET`, `V18_BANK_VERSION`, parametr `target`, puste sesje poprzednika aktywne, `BANK_MIGRATION_ID = 'bank-v18-webinary'` (+ historyczny `BANK_MIGRATION_ID_V18`), `migrationId: string`.
- `src/persistence/schema.ts` -- v4 historyczna bez zmian danych; `createMigrationV5({ faultAfterStore, target })`; `createMigrations(options)`; `MIGRATIONS` = 1…5.
- `src/persistence/api.ts` -- `DB_SCHEMA_VERSION = 5`, komentarze.
- `src/persistence/repository.ts` -- opcja wewnętrzna `bankTarget` (wersja treści, migracje, eksport, import).
- `src/persistence/backup.ts` -- parametr `target`; walidacja typów opcjonalnych pól snapshotu.
- `tests/persistence/migracja-v18.test.ts`, `tests/persistence/kontrakt.test.ts`, `tests/app/migracja-v18.test.ts` -- przestawienie na v5.
- `tests/app/migracja-webinary.test.ts` -- rzeczywisty kontroler na profilu V18 (baza v4) z bieżącym wydaniem.

**Acceptance Criteria:**
- Given profil z aplikacji V18 (baza v4), when aplikacja nowego wydania otwiera profil, then migracja 4 → 5 kończy się w jednej transakcji, otwarta sesja jest do wznowienia, a „Moje błędy” i wykluczone pytania V18 zostają.
- Given dwa profile V18, when otwierany jest jeden, then baza drugiego jest bajtowo nietknięta do jego otwarcia, a po otwarciu każdy ma wyłącznie własne dane.
- Given domyślne parametry, when historia 1 zmieni `CONTENT_RELEASE` i allowlistę, then migracja v5 bez zmian kodu przenosi sesje V18 do nowej wersji (te same testy aplikacji przechodzą).

## Spec Change Log

## Review Triage Log

### 2026-11-15 — Review pass
- verdicts: 31 findings — high 0, medium 4, low 18, false 8, maybe-false 1
- findings:
  - `[medium]` `[defer]` (blind) Transformacja nie uruchamia się ponownie, gdy treść zmieni się bez nowej wersji schematu; historia 2 bez historii 1 zostawi sesje V18 niezapisywalne — prawdziwe przy złej kolejności wdrożenia; wzorzec sprzed historii (v4); SPEC zabrania przekształcania poza `versionchange`; wpis w `deferred`, uwaga dla lidera: 1 i 2 w jednym wdrożeniu.
  - `[low]` `[patch]` (blind) Test kontrolera przechodzi trywialnie na V18 → V18 (brak asercji zależnej od wydania) — dodano `revision + (restamped ? 1 : 0)` i `sessionsRestamped: restamped ? 5 : 0` w `tests/app/migracja-webinary.test.ts`.
  - `[maybe-false]` `[reject]` (blind) Trzy otwarte sesje w fiksturze; pusta otwarta sesja może nie dać się wznowić z ekranu startowego (`isRouteValid`) — rozstrzygnęłoby: test kontrolera z jedyną otwartą pustą sesją; nawet jeśli prawda — `low` i zachowanie aplikacji sprzed tej historii (`src/app` poza zakresem); dane sesji zostają aktywne, `nextFreeFlowSlot` działa (test domeny).
  - `[low]` `[reject]` (blind) Walidacja `webinarEvidence` w kopii słabsza niż walidacja katalogu (pusty cytat, format ID) — snapshot powstaje z zwalidowanego katalogu; kopia sprawdza typy; uszkodzenie wymaga ręcznej edycji pliku, poprawka dokłada reguły.
  - `[low]` `[reject]` (blind) Profil V18 budowany z `BANK`, nie z `V18_BANK` — kontrakt gwarantuje 700 rekordów V18 na początku scalonego banku, bez zmian; zmiana `profileData` to więcej niż bezpośrednia poprawka.
  - `[low]` `[patch]` (blind) `const V18 = CONTENT_RELEASE.bankVersion` w `migracja-v18.test.ts` po historii 1 będzie nowym wydaniem — zmieniono nazwę na `CURRENT` i trzy tytuły testów („bieżące wydanie”).
  - `[false]` `[reject]` (blind) Test idempotencji nie wykrywa nadpisania rekordu migracji przy ponownym kroku — w produkcji krok v5 wykonuje się raz (wersjonowanie IndexedDB); nadpisanie dotyczy tylko sztucznego kroku v6 w teście.
  - `[low]` `[patch]` (blind) Nic nie pilnuje zgodności syntetycznego wydania z prawdziwym kodem snapshotu — dodano test kontrolera: test 50 pytań, eksport → wczytanie = te same sesje; przy `counts.questions > 700` wymaga slotów `WB-…` (po scaleniu historii 1 sprawdza prawdziwe snapshoty z dowodem webinaru).
  - `[low]` `[patch]` (blind) Luki macierzy: blokada na pytaniu WB, pusta sesja poprzednika z planem bez slotów, pusta sesja typu test — dodano test „plan bez slotów → podsumowanie”; blokada WB (ten sam mechanizm allowlisty co próby i powtórki, już testowane) i pusta sesja test (domena jej nie tworzy) — odrzucone.
  - `[low]` `[reject]` (blind) Skopiowane funkcje pomocnicze testów — refaktor testów bez wady działania.
  - `[false]` `[reject]` (blind) Zdublowana stała `V18_BANK_VERSION` i nieużywany `BANK_MIGRATION_ID_V18` — literał w fiksturze celowo przypina oczekiwaną wartość niezależnie od implementacji; brak wskazanej szkody.
  - `[false]` `[reject]` (blind) Repozytorium przyjmuje `migrations` i `bankTarget` niezależnie — opcje wewnętrzne tylko dla testów (`InternalRepositoryOptions`); `src/main.tsx` przekazuje wyłącznie `RepositoryOptions`.
  - `[low]` `[reject]` (blind) Nagłówek kopii bezpieczeństwa po v5 (`bankVersions`) nie odpowiada danym — pole informacyjne, nieczytane przy wczytaniu; zachowanie jak w v4.
  - `[low]` `[reject]` (blind) Kolejność definicji migracji w `schema.ts` (V3 po V5) — kosmetyka sprzed tej historii.
  - `[medium]` `[defer]` (edge) Baza już na v5 z buildu ze starszą treścią nie uruchomi v5 ponownie — ta sama przyczyna co pierwszy wiersz; wpis w `deferred`.
  - `[false]` `[reject]` (edge) Zmiana `CONTENT_RELEASE` bez wierszy WB w allowliście — test `tests/domain/bank-v18.test.ts:95` wymaga `V18_ALLOWED_BANK_VERSION === CONTENT_RELEASE.bankVersion`, a kontroler przy starcie porównuje katalog z allowlistą.
  - `[false]` `[reject]` (edge) Niezgodne `migrations` i `bankTarget` — jak wyżej: tylko opcje testowe.
  - `[low]` `[defer]` (edge) `docs/MIGRACJA_V18.md` wskazuje usunięty `createMigrationV4` — `docs/` poza granicami historii 2 (historia 4); wpis w `deferred`.
  - `[medium]` `[defer]` (edge) Kryterium „bez zmian kodu po historii 1” prawdziwe tylko dla baz jeszcze na v4 — ta sama przyczyna co pierwszy wiersz.
  - `[medium]` `[defer]` (verification-gap, other) Zmiana musi trafić do wdrożenia razem z historią 1 — ta sama przyczyna co pierwszy wiersz.
  - `[low]` `[patch]` (intent) Przeniesienie wersji sprawdzane tylko przez wejście testowe; test kontrolera idzie przez `keepCurrent` — ta sama poprawka co drugi wiersz (asercje zależne od wydania).
  - `[low]` `[reject]` (intent) Wznawianie po zmianie wersji sprawdzone w domenie, nie w kontrolerze — kontroler przyjmuje tylko bank z `CONTENT_RELEASE`, `src/app` poza zakresem; po scaleniu historii 1 robi to `tests/app/migracja-webinary.test.ts`.
  - `[low]` `[reject]` (intent) Trzy otwarte sesje naraz w fiksturze — transformacja działa per sesja; kopie sprawdzane w wariantach z jedną otwartą sesją.
  - `[low]` `[patch]` (intent) Brak zwykłego otwartego testu bez rundy błędów — dodano test: otwarty test V18 → po migracji `finishTest` i zapis działają.
  - `[low]` `[reject]` (intent) Profil V18 z `BANK` zależy od kolejności nowego banku — jak wyżej (gwarancja kontraktu).
  - `[false]` `[reject]` (intent) Nowa ścieżka odrzucenia kopii przy złym typie pól webinaru — sprawdzane typy są dokładnie typami z kontraktu; dane spoza kontraktu nie są poprawną kopią.
  - `[low]` `[reject]` (intent) Zachowanie pól webinaru nie sprawdzone na sesji przenoszonej (`restamp`) — sesja V18 nie zawiera pytań WB; `restamp` kopiuje snapshot w całości (test `contentOf`).
  - `[low]` `[patch]` (intent) Kształt snapshotu WB z tekstu kontraktu, nie z kodu historii 1 — ta sama poprawka co test eksportu → wczytania z kontrolera.
  - `[false]` `[reject]` (intent) Dwa profile bez kontroli właściciela — zgodne z miejscem testów wskazanym w intencji (tests/persistence); izolacja baz sprawdzona.
  - `[false]` `[reject]` (intent) `readContentMeta` zwraca tylko rekord v5 — nikt w `src/app` ani `src/ui` go nie czyta; stary rekord zostaje w bazie (test).
  - `[low]` `[defer]` (intent) Usunięty `createMigrationV4` nadal w `docs/MIGRACJA_V18.md` — ta sama pozycja co wpis o dokumentacji.

## Design Notes

- Wydanie docelowe jest parametrem, bo w tej gałęzi `CONTENT_RELEASE` to jeszcze V18 (historia 1 powstaje równolegle). Testy prawdziwego przejścia używają syntetycznego wydania; domyślne parametry staną się prawdziwym wydaniem po scaleniu historii 1.
- v4 jako krok bez zmian danych (wzorzec v2): baza v3 → v5 przechodzi jedną transformację; baza v4 (obecni użytkownicy) — także jedną.
- `reason` pozostaje `bank_v18_update` (typ w `src/domain/types.ts` należy do historii 1; brak różnicy w interfejsie).
- Nowy klucz `migration:bank-v18-webinary` — rekord `migration:bank-v18` z v4 zostaje w bazie (historia).

## Verification

**Commands:**
- `npm test` -- expected: wszystkie testy przechodzą (poza znanym niestabilnym `freeflow.test.ts` przy obciążeniu)
- `npm run typecheck` -- expected: bez błędów

## Auto Run Result

Status: done

**Zmiana:** transformacja danych użytkownika ma wydanie docelowe jako parametr (`BankTarget`: bankVersion, SHA banku, allowlista, wersje-poprzednicy; domyślnie `CONTENT_RELEASE` + `v18Allowlist.ts` + poprzednik V18). Pusta sesja poprzednika (V18) zostaje aktywna; puste sesje V15/V16/V17 jak dotąd → podsumowanie. Schemat IndexedDB 5: v4 historyczna bez zmian danych, v5 (`createMigrationV5`) wykonuje transformację w jednej transakcji `versionchange`, zapisuje `meta.content` i `migration:bank-v18-webinary` (rekord `migration:bank-v18` zostaje). Kopia danych używa tej samej transformacji, zachowuje i sprawdza typy pól `webinarEvidence`, `sources[].fileName`, `sources[].webinar`. `reason` nowych podsumowań = `bank_v18_update`.

**Pliki:**
- `src/persistence/bankMigration.ts` — `BankTarget`, `CURRENT_BANK_TARGET`, `V18_BANK_VERSION`, parametr `target`, reguła pustej sesji poprzednika, `BANK_MIGRATION_ID = 'bank-v18-webinary'`.
- `src/persistence/schema.ts` — v4 historyczna, `createMigrationV5`, `createMigrations`.
- `src/persistence/api.ts` — `DB_SCHEMA_VERSION = 5`.
- `src/persistence/repository.ts` — wewnętrzna opcja `bankTarget` (wersja treści, migracje, eksport, import).
- `src/persistence/backup.ts` — parametr `target`, walidacja opcjonalnych pól webinaru.
- `tests/persistence/fixtures.ts` — syntetyczne wydanie „V18 + 2 WB” (z prawdziwego dodatku), katalog, profil V18, profil z sesją WB.
- `tests/persistence/migracja-webinary.test.ts` (nowy), `tests/app/migracja-webinary.test.ts` (nowy) — macierz CAP-4.
- `tests/persistence/migracja-v18.test.ts`, `tests/app/migracja-v18.test.ts`, `tests/persistence/kontrakt.test.ts` — przestawione na v5.

**Przegląd:** 31 uwag — 5 poprawek (wszystkie `low`, testy), 2 pozycje odłożone (`deferred`: kolejność wdrożenia historii 1 i 2; nieaktualny `docs/MIGRACJA_V18.md`), pozostałe odrzucone z uzasadnieniem w Review Triage Log. Poprawki wg werdyktu: high 0, medium 0, low 5. Ponowny przegląd niezalecany.

**Weryfikacja:** `npx vitest run` — 702/702 (dwa kolejne przebiegi; w jednym wcześniejszym przebiegu przy obciążeniu komputera 1 test przekroczył czas — znany niestabilny `freeflow.test.ts`); `npm run typecheck` — bez błędów. Nowe testy uruchomione na kodzie sprzed zmiany: 31 z 34 nie przechodziło (czerwone z właściwego powodu).

**Ryzyka:** (1) historie 1 i 2 muszą trafić do `main` razem; (2) po scaleniu historii 1 test `tests/app/migracja-webinary.test.ts` staje się prawdziwym sprawdzeniem V18 → nowe wydanie (`sessionsRestamped: 5`, sloty WB w kopii) — trzeba go uruchomić na scalonej gałęzi; (3) jeśli historia 1 zmieni nazwę `v18Allowlist.ts`/`V18_ALLOWED`, trzeba poprawić import w `bankMigration.ts` i w testach.
