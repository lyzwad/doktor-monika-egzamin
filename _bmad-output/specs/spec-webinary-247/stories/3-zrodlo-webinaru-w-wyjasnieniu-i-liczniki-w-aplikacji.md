---
title: 'Źródło webinaru w wyjaśnieniu i liczniki w aplikacji'
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
warnings: [oversized]
deferred:
  - summary: >-
      Brak testu, który przepuszcza prawdziwy wynik buildSnapshot (pytanie WB z katalogu) przez explanationOf i mock aż do przycisku „Źródło webinaru”.
    evidence: |-
      Wszystkie testy explanationOf dostają ręcznie złożony snapshot; buildSnapshot, toCatalogQuestion i mockCatalog na tej bazie nie znają pól webinaru (rozszerza je historia 1 i programista-1 w mockCatalog). Rozstrzyga test po scaleniu historii 1: odpowiedź na pytanie WB w mocku, asercje na „Źródło webinaru”, „Plik: …” i cytat.
    location: >-
      tests/ui/zrodlo-webinaru.test.tsx
    severity: medium (unverified)
  - summary: >-
      Lokalne typy pomocnicze w screenModels.ts omijają kompilator — po scaleniu historii 1 trzeba je zastąpić prawdziwymi polami typów domeny.
    evidence: |-
      webinarEvidenceOf(holder: unknown) i rzutowanie SnapshotSource & SnapshotWebinarSource nie wykryją innej nazwy pola (np. filename zamiast fileName); wtedy panel i licznik po cichu dają null/0. Rozstrzyga przejście na typy z src/domain/types.ts po scaleniu i test na prawdziwym banku (247 w „O bazie”).
    location: >-
      src/app/screenModels.ts:147-178
    severity: medium (unverified)
  - summary: >-
      Komunikat MSG_PACKS_DISABLED nadal mówi „V18 (700 pytań)”, a ten plik jest poza zakresem historii 3.
    evidence: |-
      src/app/appController.ts:123 (i kopia w src/app/mockController.ts ok. 1581) trafia do poolFlow.messagePl na ekranie „Pula pytań”, którego baner po scaleniu pokaże „(V18 + webinary, 947 pytań)”. teksty-ui.md nie podaje nowego brzmienia; decyzja o przydziale i treści należy do lidera.
    location: >-
      src/app/appController.ts:123
    severity: medium
  - summary: >-
      Podtytuł „Wyłącznie wbudowany bank V18 — import pul wyłączony” w Ustawieniach nie mówi o webinarach; teksty-ui.md nie daje zamiennika.
    evidence: |-
      src/ui/screens/SettingsScreens.tsx:88 — tekst bez liczby 700, więc poza listą z teksty-ui.md; zmiana wymaga decyzji lidera/Dominika co do brzmienia.
    location: >-
      src/ui/screens/SettingsScreens.tsx:88
    severity: low
---

<intent-contract>

## Intent

**Problem:** Po odpowiedzi na pytanie z webinaru (WB) aplikacja nie umie pokazać jego źródła: źródło webinaru nie ma adresu, więc wiersz źródła byłby pusty, a cytat dowodowy, nazwa pliku i uczciwa informacja o automatycznych napisach nie są nigdzie widoczne. „O bazie pytań” nie pokazuje, ile pytań pochodzi z webinarów, a ekrany kopii i puli mają na sztywno „V18, 700 pytań”.

**Approach:** Rozszerzyć modele widoku źródła i wyjaśnienia o dane webinaru czytane WYŁĄCZNIE ze snapshotu pytania (pola opcjonalne — stary snapshot działa jak dotąd), w `SourceRow` zamiast linku dać przycisk „Źródło webinaru” z lokalnym panelem, dodać wiersz „Pytania z webinarów” w „O bazie pytań” i brać liczby/etykietę wydania z `CONTENT_RELEASE`/`CONTENT_RELEASE_LABEL`.

## Boundaries & Constraints

**Always:**
- Projekt = worktree `/Users/dominiklyzwa/DEWELOPER_CLAUDE/projekty/doktor-monika-egzamin/.worktrees/3`; pracuj tylko tam. Komendy: `npm test` (vitest), `npm run typecheck`.
- TDD: najpierw test, który nie przechodzi z właściwego powodu, potem kod, potem porządki. Testuj zachowanie widoczne dla użytkowniczki (DOM, role, teksty).
- Nowe teksty interfejsu (także `aria-label`, podpisy, nagłówki) WYŁĄCZNIE dosłownie z `teksty-ui.md`: `Źródło webinaru`, `Plik: `, `Fragment automatycznych napisów — może zawierać błędy rozpoznawania mowy`, `Źródło egzaminacyjne z wykładu, nie zweryfikowane aktualne wytyczne.`, `Pytania z webinarów`, oraz `(<CONTENT_RELEASE_LABEL>, <N> pytań)` i `banku <N> pytań`. Istniejąca etykieta `Gdzie w źródle: ` zostaje. Brak pasującego tekstu = nie dodawaj, zapisz pytanie w raporcie.
- Historia i przegląd (tryb `review`) budują wyjaśnienie wyłącznie ze snapshotu slotu, nigdy z bieżącego katalogu.
- Nowe pola snapshotu (`SnapshotSource.fileName?`, `SnapshotSource.webinar?`, `QuestionSnapshot.webinarEvidence?`) są opcjonalne; brak = `webinar: false`, `fileName: null`, `webinarEvidence: null`.
- Źródło webinaru: w DOM nie ma żadnego `<a>` (także gdy `url` byłby niepusty i także offline); panel działa offline.
- Pytania V18 (źródła bez `webinar`) wyglądają i działają dokładnie jak dotąd (link „Otwórz publikację”, komunikat offline).
- Przycisk „Źródło webinaru”: `type="button"`, `aria-expanded`, `aria-controls` na id panelu, gdy otwarty — jak istniejące przyciski w `SourceRow`.

**Never:**
- Nie edytuj: `src/domain/*`, `src/persistence/*`, `scripts/`, `public/`, `content/`, `src/app/appController.ts`, `src/pwa/`, `vite.config.ts`, `tests/e2e/`, `tests/pwa/`, `tests/domain/`, `tests/persistence/`, `docs/`. Typy domeny rozszerza równolegle inna historia — do czasu jej scalenia nowe pola czytaj przez lokalny typ pomocniczy w `src/app/screenModels.ts`.
- Bez nowych zależności npm. Bez commitów (commit robi finalizacja workflow).
- Bez wyboru/etykiet trudności, bez filtra „tylko webinary”, bez linków do nagrań, bez deklaracji zatwierdzenia klinicznego.
- Nie zmieniaj ani nie usuwaj asercji istniejących testów tylko po to, żeby przeszły (wyjątek: dopisanie nowych wymaganych pól do obiektów testowych `ExplanationVM`/`SourceVM` oraz zamiana na sztywno wpisanego „V18, 700 pytań” na wartości z `CONTENT_RELEASE` w `tests/ui/regresje-p3.test.tsx:91`).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| WB, jedno źródło | snapshot: źródło `W13` (`webinar: true`, `fileName: 'W13.txt'`, kind/access PL), `sourceLocator: 'W13: W13-U0022, W13-U0029'`, `webinarEvidence: {quote, unitIds, note}` | wiersz: tytuł, „transkrypcja webinaru · fragmenty automatycznych napisów”; po rozwinięciu „Gdzie w źródle: W13-U0022, W13-U0029” i przycisk „Źródło webinaru” (`aria-expanded=false`); po kliknięciu (`true`): „Plik: W13.txt”, zdanie o automatycznych napisach, `<blockquote>` z cytatem, nota, zdanie o źródle egzaminacyjnym; brak „Otwórz publikację” i brak `<a>` | — |
| WB, dwa źródła | źródła `W13`, `W16`; `sourceLocator: 'W13: W13-U0022, W13-U0029; W16: W16-U0010'` | wiersz W13 pokazuje tylko „W13-U0022, W13-U0029”, wiersz W16 tylko „W16-U0010”; każdy panel ma własny „Plik: …” | — |
| WB offline | jak wyżej, `online=false` | panel otwiera się i pokazuje te same treści; brak `<a>` i brak komunikatu „Publikacji nie można teraz otworzyć…” | — |
| WB, źródło z niepustym `url` | `webinar: true`, `url: 'https://…'` | nadal brak `<a>` i brak „Otwórz publikację” | — |
| WB bez dowodu w snapshocie | `webinar: true`, `webinarEvidence: null` | panel pokazuje „Plik: …” (gdy `fileName`), zdanie o napisach i zdanie o źródle egzaminacyjnym; bez cytatu i noty | brak błędu |
| Stary snapshot V18 | snapshot bez pól `fileName`/`webinar`/`webinarEvidence` | VM: `webinar: false`, `fileName: null`, `webinarEvidence: null`; wiersz jak dotąd (link https, offline komunikat) | brak błędu |
| O bazie pytań | katalog z N pytaniami z `webinarEvidence !== null` | lista „Kontrola treści” ma wiersz „Pytania z webinarów” z liczbą N (0 dla katalogu bez webinarów); licznik przeglądu AI = `bankSummary.independentlyChecked` bez zmian | — |
| Teksty wydania | `CONTENT_RELEASE_LABEL = 'V18 + webinary'`, `counts.questions = 947` (np. przez `vi.mock`) | kopia: „(V18 + webinary, 947 pytań)”; pula: tytuł „…(V18 + webinary, 947 pytań)” i „…banku 947 pytań…” | — |

</intent-contract>

## Code Map

- `src/app/viewModels.ts:79-104` -- `SourceVM`, `ExplanationVM`: dodać `SourceVM.webinar: boolean`, `SourceVM.fileName: string | null`, nowy `WebinarEvidenceVM { quote: string; unitIds: string[]; note: string }`, `ExplanationVM.webinarEvidence: WebinarEvidenceVM | null`. `BankInfoVM` (ok. 455): dodać `webinarQuestionCount: number`.
- `src/app/screenModels.ts:298-310` -- jedyne miejsce budowy `ExplanationVM` w produkcji (z `snap`); wydzielić eksportowaną funkcję `explanationOf(snap: QuestionSnapshot): ExplanationVM` (kopiuje tablice, czyta nowe pola przez lokalny typ pomocniczy, np. `type SnapshotWebinarFields = { webinarEvidence?: {...} | null }` / `{ fileName?: string | null; webinar?: boolean }`). `bankInfoOf` (ok. 552): `webinarQuestionCount` = liczba `catalog.questions` z niepustym `webinarEvidence` (odczyt odporny na brak pola).
- `src/app/mockController.ts:127-196` -- `mockCatalog` duplikuje konwersje domeny; zamienić mapowanie pytań na `toCatalogQuestion(q, { kind: 'bank', bankVersion })` i źródeł na `toCatalogSource(id, raw)` (pomijając `null`) z `src/domain/catalog.ts:169,204`, żeby nowe pola z domeny trafiały do mocka automatycznie. `snapshotOf` (ok. 371) → `buildSnapshot(cat, q, order)` z `src/domain/snapshot.ts:27` (identyczna logika). `questionVM` (ok. 674-682) → `explanationOf(snap)` z `screenModels`.
- `src/ui/components/ExplanationPanel.tsx:23-90` -- `SourceRow`: przekazać `evidence` (z `explanation.webinarEvidence`); gałąź `source.webinar` zamiast linku/komunikatu offline renderuje przycisk i panel (kolejność treści jak w `teksty-ui.md`). Lokalizator dalej przez `locatorForSource` (`src/ui/format.ts:243`, obsługuje format `W13: …; W16: …`). Ikony: `expand_more`/`expand_less` (jak „Rozwiń szerszy kontekst”).
- `src/ui/styles/components.css:1628-1696` -- style `SourceRow`; dodać klasy panelu webinaru i cytatu (zmienne z `tokens.css`).
- `src/ui/screens/SettingsScreens.tsx:186-199` -- lista „Kontrola treści”: nowy wiersz „Pytania z webinarów” zaraz po wierszu przeglądu AI. Linia 88 („bank V18”) bez zmian.
- `src/ui/screens/DataScreens.tsx:20-26,296-312` -- `BACKUP_CONTENTS_TEXT` i `PoolImportScreen`: liczba i etykieta z `CONTENT_RELEASE.counts.questions` / `CONTENT_RELEASE_LABEL` (`src/domain/contentRelease.ts`), formatowane `questionsCount` z `src/ui/format.ts:12`; zaktualizować komentarz.
- `tests/ui/ExplanationPanel.test.tsx` -- istniejące testy `SourceRow`; obiekt `explanation()` dostaje nowe pola (`webinar: false`, `fileName: null`, `webinarEvidence: null`).
- `tests/ui/regresje-p3.test.tsx:91,151` -- asercja tekstu kopii (zamienić stałe na `CONTENT_RELEASE`); `poolNote` z banku zostaje.
- `tests/ui/pula-v18.test.tsx`, `tests/ui/helpers.tsx` -- wzorzec testu „O bazie” na mocku z prawdziwym bankiem (`startedMock`, `renderApp`, `c.openSettings(); c.openAbout()`).

## Tasks & Acceptance

**Execution:**
- `tests/ui/zrodlo-webinaru.test.tsx` (nowy) -- testy komponentu dla wierszy matrycy WB (jedno/dwa źródła, offline, `url` niepusty, brak dowodu, fokus/`aria-controls`) oraz `explanationOf` dla starego i nowego snapshotu -- czerwone przed kodem.
- `tests/ui/o-bazie-webinary.test.tsx` (nowy) -- „O bazie pytań” na mocku: wiersz „Pytania z webinarów” w liście „Kontrola treści” z liczbą = pytania banku z `origin === 'webinar'` (odczyt odporny), licznik AI = `bank.counts.independently_checked_draft`, brak słowa „zatwierdzon” w treści ekranu.
- `tests/ui/teksty-wydania.test.tsx` (nowy) -- `vi.mock` `contentRelease` (etykieta `V18 + webinary`, `counts.questions` 947, reszta oryginalna); `BACKUP_CONTENTS_TEXT` zawiera „(V18 + webinary, 947 pytań)”, `PoolImportScreen` pokazuje tytuł „Aplikacja używa wyłącznie wbudowanego banku pytań (V18 + webinary, 947 pytań)” i „banku 947 pytań”, brak „700”.
- `src/app/viewModels.ts`, `src/app/screenModels.ts`, `src/app/mockController.ts` -- zmiany z Code Map.
- `src/ui/components/ExplanationPanel.tsx`, `src/ui/styles/components.css` -- przycisk i panel webinaru.
- `src/ui/screens/SettingsScreens.tsx`, `src/ui/screens/DataScreens.tsx` -- wiersz licznika i teksty z wydania.
- `tests/ui/ExplanationPanel.test.tsx`, `tests/ui/regresje-p3.test.tsx` -- dopasowanie obiektów/stałych jak w Boundaries.

**Acceptance Criteria:**
- Given pytanie WB w trybie pytania albo przeglądu, when użytkowniczka rozwija źródło i klika „Źródło webinaru”, then widzi panel z treściami z `teksty-ui.md` w podanej kolejności, a w całym panelu wyjaśnienia nie ma `<a>` dla źródeł webinaru.
- Given pytanie V18, when użytkowniczka odpowiada, then panel wyjaśnienia wygląda i działa jak przed zmianą (istniejące testy `ExplanationPanel` i `QuestionScreen` przechodzą bez zmian asercji).
- Given dowolny ekran ustawień, when renderuje się „O bazie pytań”, then nie ma deklaracji zatwierdzenia klinicznego, a liczby pochodzą z katalogu.
- Given `npm test` i `npm run typecheck`, when uruchomione w worktree, then wszystkie testy przechodzą (dopuszczalny tylko znany niestabilny timeout `tests/domain/freeflow.test.ts`), typecheck bez błędów.

## Spec Change Log

## Review Triage Log

### 2026-11-15 — Review pass
- verdicts: 30 findings — high 0, medium 3, low 11, false 12, maybe-false 4
- findings:
  - `[false]` `[reject]` (blind) mockCatalog nie używa toCatalogQuestion/toCatalogSource — w trakcie przebiegu lider polecił nie zmieniać budowy katalogu w mocku (ok. linie 131–152, 175–185), bo mapowanie trzech nowych pól dopisuje tam programista-1 (historia 1); zmiana została cofnięta celowo, pola trafią do mocka po scaleniu.
  - `[false]` `[reject]` (blind) pierwszy test „O bazie” jest dziś pusty (0 = 0) — test jest strażnikiem po scaleniu (247 z banku); liczenie przez bankInfoOf przypina trzeci test (3 z 5 pytań z dowodem), renderowanie liczby — drugi test (247).
  - `[false]` `[reject]` (blind) dwie definicje pytania z webinaru (origin vs webinarEvidence) — CatalogQuestion nie ma pola origin=webinar (QuestionOrigin to bank/pack); kontrakt wymaga niepustego evidence_quote dla każdego WB, a pytania V18 go nie mają, więc oba kryteria wskazują ten sam zbiór.
  - `[low]` `[reject]` (blind) webinarEvidenceOf przyjmuje pusty cytat — walidacja katalogu (historia 1) odrzuca WB bez niepustego evidence_quote, a panel i tak nie renderuje pustego cytatu; mało prawdopodobne w codziennym użyciu.
  - `[medium]` `[patch]` (blind) tests/ui/pula-v18.test.tsx ma „700” na sztywno — po scaleniu historii 1 test by się wyłożył; zamieniono na `CONTENT_RELEASE.counts.questions` / `questionsCount(...)` (linie 25 i 59, opisy testów); poprawkę naniósł prowadzący przebieg, testy 682/682.
  - `[medium]` `[defer]` (blind) MSG_PACKS_DISABLED w appController.ts mówi „V18 (700 pytań)” — plik poza zakresem historii, brak brzmienia w teksty-ui.md; pytanie do lidera (deferred).
  - `[low]` `[reject]` (blind) test przeglądu nie wykrywa złej kolejności odczytu katalog/snapshot — explanationOf przyjmuje wyłącznie snapshot, więc odczyt katalogu jest niemożliwy z konstrukcji.
  - `[maybe-false]` `[defer]` (blind) brak testu QuestionScreen z prawdziwym pytaniem WB — niemożliwy przed scaleniem historii 1 (bank V18 nie ma WB); ten sam wpis deferred co test buildSnapshot → explanationOf.
  - `[false]` `[reject]` (blind) WebinarEvidenceVM.unitIds nieużywane w komponencie — pole z kontraktu snapshotu, bez wskazanej szkody.
  - `[maybe-false]` `[defer]` (blind) typ pomocniczy omija kompilator, brak znacznika do sprzątnięcia — rozstrzyga przejście na typy domeny po scaleniu historii 1 (deferred).
  - `[low]` `[reject]` (blind) kopia figureVM w mocku — duplikacja sprzed tej zmiany, bez wskazanej szkody.
  - `[low]` `[reject]` (edge) pusty/biały cytat w webinarEvidenceOf — jak wyżej (walidacja katalogu).
  - `[low]` `[reject]` (edge) cytat/nota z samych spacji renderują pusty element — dane walidowane, mało prawdopodobne.
  - `[low]` `[reject]` (edge) fileName z samych spacji — w dodatku każde źródło ma nazwę pliku; mało prawdopodobne.
  - `[false]` `[reject]` (edge) dowód bez źródła webinar=true jest ukryty — kontrakt: każde pytanie WB ma źródła W01–W17 typu user_supplied_webinar_transcript.
  - `[low]` `[reject]` (edge) „banku 942 pytania” byłoby niegramatyczne dla liczb kończących się na 2–4 — wydanie ma 947 pytań („947 pytań” poprawnie); poprawka dodaje gałąź dla przypadku, który nie występuje.
  - `[false]` `[reject]` (edge) licznik webinarów na innej bazie niż bankSummary — od V15 katalog nie łączy paczek, catalog.questions = pytania banku.
  - `[false]` `[reject]` (edge) asercja w regresje-p3 powtarza wyrażenie implementacji — dosłowny tekst „(V18 + webinary, 947 pytań)” przypina tests/ui/teksty-wydania.test.tsx.
  - `[maybe-false]` `[defer]` (edge) żaden budowniczy katalogu nie kopiuje webinarEvidence, więc licznik = 0 — prawda na tej bazie; po scaleniu historii 1 (toCatalogQuestion) i mapowania programisty-1 w mocku rozstrzyga test 247 w „O bazie” (deferred).
  - `[maybe-false]` `[defer]` (edge) buildSnapshot nie kopiuje pól webinaru — rozszerza go historia 1 wg kontraktu; rozstrzyga test po scaleniu (deferred).
  - `[medium]` `[defer]` (verification-gap) brak testu prawdziwego buildSnapshot → explanationOf / mock → „Źródło webinaru” — jak zgłoszono: do zrobienia po scaleniu historii 1 (deferred).
  - `[false]` `[reject]` (verification-gap) mockCatalog ręcznie przepisuje pola — decyzja lidera, jak w pierwszym wierszu.
  - `[low]` `[defer]` (intent) brak testu końcowego katalog → snapshot → VM z danymi webinaru i liczb 947/939/247 — ten sam wpis deferred (po scaleniu).
  - `[false]` `[reject]` (intent) ścieżka mocka nie przenosi pól — decyzja lidera (programista-1 dopisuje mapowanie).
  - `[false]` `[reject]` (intent) definicja licznika origin vs webinarEvidence — jak w wierszu blind 3.
  - `[false]` `[reject]` (intent) dwa źródła pokazują ten sam cytat — kontrakt ma jeden evidence_quote na pytanie; „właściwe fragmenty” to ID w „Gdzie w źródle”, rozdzielane per źródło (test dwóch źródeł); prawdziwe WB-USGTR-017 (W11, W16) do sprawdzenia testem po scaleniu.
  - `[low]` `[defer]` (intent) napis „Wyłącznie wbudowany bank V18 — import pul wyłączony” (SettingsScreens.tsx:88) bez zmian — brak brzmienia w teksty-ui.md; pytanie do lidera (deferred).
  - `[false]` `[reject]` (intent) „zatwierdzon” sprawdzane tylko na banku V18 — test działa na prawdziwym banku przez mock, więc po scaleniu automatycznie sprawdzi nowe status_pl/pool_note_pl.
  - `[low]` `[reject]` (intent) test fokusu w jsdom słaby, offline tylko jako parametr — przycisk to natywny `<button type="button">` jak w istniejących wierszach; prawdziwy offline z Service Workerem należy do historii 4.
  - `[low]` `[reject]` (intent) ekran historii nie testowany osobno — historia prowadzi do przeglądu (`review`), który jest testowany; lista historii nie pokazuje wyjaśnień.

## Design Notes

Dane webinaru należą do pytania (cytat, ID fragmentów, nota), a nazwa pliku do źródła — dlatego `webinarEvidence` jest w `ExplanationVM`, a `fileName`/`webinar` w `SourceVM`. Przy dwóch źródłach webinaru oba panele pokazują ten sam cytat i notę pytania, ale każdy własny plik i własne fragmenty (z `locatorForSource`).

Szkic gałęzi w `SourceRow` (nie kopiować dosłownie):

```tsx
{source.webinar ? (
  <button type="button" aria-expanded={panelOpen} aria-controls={panelOpen ? panelId : undefined} onClick={…}>Źródło webinaru<Icon name={panelOpen ? 'expand_less' : 'expand_more'} size={18} /></button>
) : /* dotychczasowy link / przycisk offline */}
{source.webinar && panelOpen ? <div id={panelId}>…Plik: {fileName}… <blockquote>{evidence.quote}</blockquote> …</div> : null}
```

Po scaleniu historii 1 (typy domeny) lokalny typ pomocniczy w `screenModels.ts` zastąpią prawdziwe pola — to osobny krok poza tym przebiegiem.

## Verification

**Commands:**
- `npm test` -- expected: wszystkie testy przechodzą (poza znanym niestabilnym `tests/domain/freeflow.test.ts`, jeśli wystąpi timeout)
- `npm run typecheck` -- expected: brak błędów

## Auto Run Result

Status: done (część niezależna od historii 1; przejście na prawdziwe typy i testy na prawdziwym banku czekają na scalenie historii 1)

**Co zrobiono:** wiersz źródła webinaru w wyjaśnieniu ma zamiast linku przycisk „Źródło webinaru” z lokalnym panelem (plik, zdanie o automatycznych napisach, cytat, nota pytania, zdanie o źródle egzaminacyjnym), bez żadnego `<a>`, także offline. Wyjaśnienie powstaje wyłącznie ze snapshotu (`explanationOf`), stare snapshoty bez nowych pól działają jak dotąd. „O bazie pytań” ma wiersz „Pytania z webinarów”. Teksty kopii i puli biorą etykietę i liczbę z `CONTENT_RELEASE`.

**Pliki:**
- `src/app/viewModels.ts` — `SourceVM.webinar/fileName`, `WebinarEvidenceVM`, `ExplanationVM.webinarEvidence`, `BankInfoVM.webinarQuestionCount`.
- `src/app/screenModels.ts` — `explanationOf(snap)` (odczyt odporny przez typy pomocnicze), licznik webinarów w `bankInfoOf`.
- `src/app/mockController.ts` — `snapshotOf` → `buildSnapshot`, wyjaśnienie → `explanationOf`; budowa katalogu bez zmian (decyzja lidera: pola dopisuje programista-1).
- `src/ui/components/ExplanationPanel.tsx` — przycisk i panel „Źródło webinaru”.
- `src/ui/styles/components.css` — style panelu i cytatu.
- `src/ui/screens/SettingsScreens.tsx` — wiersz „Pytania z webinarów”.
- `src/ui/screens/DataScreens.tsx` — teksty z `CONTENT_RELEASE_LABEL` i `CONTENT_RELEASE.counts.questions`.
- `tests/ui/zrodlo-webinaru.test.tsx`, `tests/ui/o-bazie-webinary.test.tsx`, `tests/ui/teksty-wydania.test.tsx` — nowe testy (17).
- `tests/ui/ExplanationPanel.test.tsx`, `tests/ui/regresje-p3.test.tsx`, `tests/ui/pula-v18.test.tsx` — nowe pola obiektów testowych i liczby z wydania zamiast „700”.

**Przegląd:** 30 uwag — 1 poprawka (medium: „700” na sztywno w `pula-v18.test.tsx`), 8 odłożonych do `deferred` (4 wpisy: test end-to-end po scaleniu, typy pomocnicze, `MSG_PACKS_DISABLED`, podtytuł „bank V18”), 21 odrzuconych z uzasadnieniem w Review Triage Log.

**Następny przegląd:** `false` — poprawiono 1 uwagę medium, 0 high.

**Weryfikacja:** `npm test` — 60 plików, 682/682 przeszło; `npm run typecheck` — bez błędów.

**Ryzyka:** do scalenia historii 1 panel webinaru da się zobaczyć tylko na danych testowych; po scaleniu trzeba zastąpić typy pomocnicze prawdziwymi typami i dodać test na prawdziwym pytaniu WB (w tym WB-USGTR-017 z dwoma źródłami) oraz liczby 947/939/247 w „O bazie”.

### Po scaleniu historii 1 i 2 (feat/webinary-247 @ 4cf460f, 2026-11-15)

- Scalono `feat/webinary-247` do `story/3` (merge, bez konfliktów; mapowanie pól webinaru w `mockCatalog` dopisał programista-1).
- `src/app/screenModels.ts`: lokalne typy pomocnicze zastąpione prawdziwymi typami domeny (`SnapshotSource.fileName/webinar`, `QuestionSnapshot.webinarEvidence`, `CatalogQuestion.webinarEvidence`) — wpis deferred „typy pomocnicze” rozwiązany.
- Nowy `tests/ui/zrodlo-webinaru-bank.test.tsx` (prawdziwy bank): 247 pytań WB ze źródłami bez adresu; „Gdzie w źródle” = fragmenty danego źródła dla każdego WB; WB-USGTR-017 (W11, W16) przez `buildSnapshot` → `explanationOf` → panel; pytanie WB rozwiązane w mocku pokazuje panel z plikiem, cytatem i notą z banku — wpis deferred „test end-to-end” rozwiązany. Testy przeszły od razu (kod powstał przed scaleniem); kontrola mutacyjna (`webinar: false` w `sourceVM`) daje 2 czerwone.
- Przepisane 2 testy, których założenie zmieniło scalenie: licznik `bankInfoOf` (było 0 dla V18, teraz 247 ± zmiany) i przegląd (katalog ma teraz W13/W16 z inną nazwą pliku — wygrywa snapshot).
- „O bazie”: jawny test 947 / 939 / 247 / 600 i brak „zatwierdzon” na nowym banku; `regresje-p3` sprawdza w `pool_note_pl` 700 i 247.
- Teksty z decyzji lidera (teksty-ui.md @ 81ff4b6): podtytuł „Wyłącznie wbudowany bank V18 + webinary — import pul wyłączony” (z `CONTENT_RELEASE_LABEL`) i komunikat importu w mocku jak `MSG_PACKS_DISABLED` — testy czerwone przed zmianą, zielone po — wpisy deferred o tych tekstach rozwiązane.
- Weryfikacja: `npm run typecheck` bez błędów; `npm test` 820 przeszło, 5 nie (`tests/docs/raport-kontroli.test.ts`, historia 4).
