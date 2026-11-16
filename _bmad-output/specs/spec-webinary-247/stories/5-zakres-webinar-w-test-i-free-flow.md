---
title: 'Zakres „Webinar” w Test i Free Flow'
type: 'feature'
created: '2026-11-15'
status: 'done'
baseline_revision: 'f87d070d07c0855ede4e4d465ee5e3eb2ed3dd30'
review_loop_iteration: 0
followup_review_recommended: false
context: []
warnings: [oversized]
deferred: []
---

<intent-contract>

## Intent

**Problem:** Właściciel chce w selektorze „Zakres” (wspólnym dla Test i Free Flow) opcji „Webinar”, która losuje wyłącznie z 247 pytań z paczki webinarowej. Dziś typ `Scope` zna tylko „Cały zakres” i 6 dziedzin, a cały kod zakłada, że zakres inny niż `ALL` jest dziedziną.

**Approach:** Nowa wartość zakresu `'WEBINAR'` (stała `WEBINAR_SCOPE`) obejmująca pytania katalogu z `webinarEvidence !== null`, obsłużona w puli, polityce testu, Free Flow, „Moich błędach”, rundzie błędów, tytułach, ustawieniach i walidacji kopii — działa jak zakres jednej dziedziny (bez profilu treningowego i bez wag DEV 0,40), a dziedziny pytań WB dzielą miejsca proporcjonalnie do ich liczby w puli.

## Boundaries & Constraints

**Always:** Etykieta opcji dokładnie `Webinar`, na końcu listy zakresów (po dziedzinach), liczba w istniejącym formacie `capacityLabel`; tytuł zakresu w konfiguracji, karcie przerwanej sesji i historii = `Webinar` tym samym kodem co dla dziedzin. Pula „Webinar” = pytania katalogu z `webinarEvidence !== null` po wyłączonych ID i aktywnych blokadach (jak inne zakresy); pojemność = liczba rodzin. Zakres „Webinar” nigdy nie używa profilu treningowego (V3 grup) ani wag `FREE_FLOW_BASE_WEIGHTS`. Stare dane i inne zakresy działają bez zmian. TDD.

**Never:** Żadnych nowych tekstów UI poza `Webinar` (bez opisów, podpowiedzi, aria-label). Bez zmiany `DB_SCHEMA_VERSION` i bez migracji. Bez nowych nazw polityk (`SelectionPolicyName`). Bez zakresów pojedynczych webinarów ani łączenia „Webinar” z dziedziną. Bez zmian w treści banku.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Pula | katalog wydania, pusty stan | `poolFor(…, 'WEBINAR')`: 247 pytań, pojemność 247, każde ID `WB-` | — |
| Blokada | zgłoszone 1 pytanie WB | pojemność 246; pozostałe zakresy tracą je jak dotąd | — |
| Test N=20 | `WEBINAR`, seed dowolny | 20 slotów WB, rodziny unikalne, brak `allocation.profile`, `domainTargets` = `{DEV:10, SAFE:4, SKIN:3, INJ:2, THER:1, ANAT:0}` | — |
| Test N=247 | `WEBINAR` | każda rodzina WB dokładnie raz | — |
| Test N=248 | `WEBINAR` | — | `N_EXCEEDS_CAPACITY`, capacity 247 |
| Free Flow | `WEBINAR`, 40 kolejnych pytań | wyłącznie WB, brak `allocation.profile`, `freeFlowWeights` = udział dziedziny w puli (np. DEV 118/247) | pusta pula → stan `empty` jak dotąd |
| Moje błędy | aktywne błędy w V18 i WB | Test i Free Flow `WEBINAR` z „Moje błędy” biorą tylko błędy WB; `activeErrorsInScope` liczy tylko WB | — |
| Runda błędów | ukończony test `WEBINAR` z błędami | powtórki i uzupełnienia wyłącznie WB | — |
| Inne zakresy | `ALL`, `SKIN` | bez zmian (ALL: profil V3; SKIN zawiera swoje WB jak dotąd) | — |
| Kopia/ustawienia | sesja i `lastTestConfig`/`lastFreeFlowConfig` z `WEBINAR` | eksport → import przechodzi; `initialTestConfig` zwraca `WEBINAR` | nieznany zakres (np. `XYZ`) → `InvalidBackup` jak dotąd |

</intent-contract>

## Code Map

- `src/domain/types.ts:68-69` -- `Scope`; dodać `export const WEBINAR_SCOPE = 'WEBINAR' as const` i `Scope = 'ALL' | typeof WEBINAR_SCOPE | DomainId` (komentarz z CAP-8).
- `src/domain/util.ts:51-58` -- `isScope` (używa go `isValidConfigShape` → `initialTestConfig`/`initialFreeFlowConfig`, start sesji), `scopeDomains`; dodać czysty predykat `matchesScope(scope, q: { domainId; webinarEvidence })` (ALL → true, WEBINAR → `webinarEvidence !== null`, dziedzina → `domainId === scope`).
- `src/domain/pool.ts:68-85` -- `poolQuestions`: filtr `scope === 'ALL' || q.domainId === scope` → `matchesScope`. Z niego korzystają `poolFor`, `capacityFor`, `sessions.ts` (start testu :204, runda błędów :277, Free Flow :587, `pickForSession` :559, zastępstwa :783), `report.ts:178`, `myErrorsMandatory` (sessions.ts:130 — dostaje pulę, więc błędy spoza zakresu odpadają same).
- `src/domain/testPolicy.ts:120-134` -- `domainRotation` (WEBINAR → wszystkie dziedziny w rotacji, jak ALL), `domainQuotas` (dziś `scope !== 'ALL'` → `Map([[scope, n]])` — dla WEBINAR błąd typu); `:396-401` `planTest` (profil tylko dla `ALL` — zostaje); `:478-486` gałąź V2: dla WEBINAR kwoty = `largestRemainderQuotas(n, rotation, podaż)`, gdzie podaż = liczba różnych rodzin puli (`input.pool` na poziomach `choiceLevels(difficulty)`) w każdej dziedzinie; `:575-590` `findTestReplacement`: filtr zakresu → `matchesScope`; profil tylko dla `ALL` (zostaje).
- `src/domain/freeFlowPolicy.ts:71-75` -- `computeFreeFlowWeights` (WEBINAR odfiltrowałby wszystkie dziedziny → `{}` → Free Flow pusty); `:183-194` `pickFreeFlow`: dla WEBINAR wagi = udział dziedziny w liczbie pytań puli (bez adaptacji i bez `FREE_FLOW_BASE_WEIGHTS`), np. eksportowana funkcja `supplyWeights(pool, available)`; profil tylko dla `ALL` (zostaje). `sessions.ts:619` — profil Free Flow tylko dla `ALL` (zostaje).
- `src/domain/api.ts:71-74` -- re-eksporty pomocnicze; dodać to, czego potrzebują testy (np. `WEBINAR_SCOPE` przez `types`).
- `src/persistence/backup.ts:218,246` -- `SCOPES = ['ALL', ...DOMAIN_IDS]` (walidacja `config` sesji i ustawień) → dopisać `WEBINAR_SCOPE`. Inne pliki persistence nie sprawdzają zakresu (`validation.ts`, `idb.ts` — brak użyć).
- `src/app/screenModels.ts:121-123` -- `scopeTitleOf` (WEBINAR → `'Webinar'`, eksportowana stała etykiety); `:229-238` `configVM`: lista `['ALL', ...dziedziny]` → na końcu `WEBINAR`, gdy katalog ma choć jedno pytanie z `webinarEvidence` (katalogi testowe bez WB nie dostają opcji).
- `src/app/mockController.ts:321-326,371-373,588-594` -- atrapa (dev/testy UI, prawdziwy bank): `pool` (filtr → `matchesScope`), `scopeTitle` (ta sama etykieta co `scopeTitleOf`), lista zakresów jak w `screenModels`.
- `src/ui/screens/ConfigScreen.tsx:138-148` -- `RadioList<Scope>` z `vm.scopeOptions` i `capacityLabel` — bez zmian kodu (opcja przychodzi z VM). `src/ui/format.ts:194` — „Wybierz Cały zakres” dla `scope !== 'ALL'` działa też dla WEBINAR (istniejący tekst).
- Testy-wzorce: `tests/content.ts` (`currentCatalog()`, `BANK`), `tests/domain/bank-smoke.test.ts` (start testu/Free Flow/rundy na prawdziwym wydaniu), `tests/domain/helpers.ts` (`Clock`, `must`, `playTest`, `planFamilies`, `session`), `tests/app/harness.ts` (`startHarness` na tej samej `factory`/`dbName` = restart aplikacji), `tests/ui/pula-v18.test.tsx` i `tests/ui/App.test.tsx:118` (arkusz „Zakres”), `tests/persistence/kopia.test.ts:137,307` (round-trip, błędne enumy, `mutate`, `expectRejected`), `tests/e2e/flows-extra.spec.ts` + `tests/e2e/helpers.ts` (`openFresh`, `answer`, `next`, `currentStem`, `readStore`), `tests/e2e/aktualizacja-webinary.spec.ts:146-170` (selektory źródła WB).
- `tests/app/regresje-p3.test.ts:199-204` -- pętla „każda opcja ≠ ALL to dziedzina” przestanie być prawdziwa; zawęzić do dziedzin i dopisać asercję opcji WEBINAR (zmiana wynika z nowej opcji, nie z dopasowania do kodu).

## Tasks & Acceptance

**Execution:**
- `tests/domain/zakres-webinar.test.ts` (nowy) -- najpierw czerwone testy domeny wg macierzy (prawdziwy katalog `currentCatalog()`): pula, blokada, Test 20/247/248, Free Flow 40 pytań, „Moje błędy” (Test i Free Flow), runda błędów, brak wpływu na ALL/SKIN, `isScope`/`initialTestConfig`/`initialFreeFlowConfig` z WEBINAR -- dowód zachowania silnika.
- `src/domain/types.ts`, `util.ts`, `pool.ts`, `testPolicy.ts`, `freeFlowPolicy.ts`, `api.ts` -- zmiany z Code Map; komentarze nagłówków polityk dopisują zasadę zakresu „Webinar” -- zielone testy domeny.
- `tests/persistence/kopia.test.ts` + `src/persistence/backup.ts` -- round-trip kopii z sesją i ustawieniami `WEBINAR`; przypadek nieznanego zakresu odrzucony (`/pole „scope”/`) -- CAP-8 „kopia danych”.
- `tests/app/zakres-webinar.test.ts` (nowy) + `src/app/screenModels.ts`, `mockController.ts` -- prawdziwy kontroler: ostatnia opcja `{scope:'WEBINAR', title:'Webinar', capacity:247, questionCount:247}`; start testu WEBINAR → pytania WB; restart (ta sama baza) → szkic Testu ma zakres WEBINAR i tytuł `Webinar`; historia pokazuje tytuł `Webinar`; to samo dla Free Flow -- ustawienia i historia.
- `tests/ui/zakres-webinar.test.tsx` (nowy) -- atrapa: arkusz „Zakres” (Test i Free Flow) ma ostatnie radio `Webinar` z `247 różnych zadań (rodzin)`; wybór zamyka arkusz i przycisk zakresu pokazuje `Webinar` -- UI.
- `tests/app/regresje-p3.test.ts` -- zawężenie pętli opcji do dziedzin + asercja WEBINAR.
- `tests/e2e/flows-extra.spec.ts` -- nowy test: Test 3 pytań z zakresem „Webinar” (arkusz → radio `Webinar`), każde `p.stem` kończy się `[webinar]`, po odpowiedzi w `section.expl` jest przycisk `Źródło webinaru`; w IndexedDB `sessions[0].config.scope === 'WEBINAR'` -- e2e.

**Acceptance Criteria:**
- Given lista „Zakres” w Test albo Free Flow, when użytkowniczka ją otwiera, then ostatnia pozycja to `Webinar` z liczbą `247 różnych zadań (rodzin)`, a jej wybór ustawia tytuł zakresu `Webinar`.
- Given zakres `Webinar`, when startuje Test (dowolne N 1…247) albo Free Flow, then każde pokazane pytanie pochodzi z paczki webinarowej (ID `WB-`, treść kończy się `[webinar]`) i po odpowiedzi ma „Źródło webinaru”.
- Given ukończona sesja w zakresie `Webinar`, when aplikacja zostaje uruchomiona ponownie albo dane przechodzą przez kopię, then historia pokazuje `Webinar`, a ostatnia konfiguracja wraca z tym zakresem.

## Spec Change Log

## Review Triage Log

### 2026-11-15 — Review pass
- verdicts: 20 findings — high 0, medium 0, low 14, false 6, maybe-false 0
- findings:
  - `[low]` `[patch]` Blind: brak wpisu zasady zakresu „Webinar” w `docs/DECYZJE_ARCHITEKTURY.md`, a komentarz w `types.ts` powołuje się na „DECYZJE §6–§7”, gdzie tej reguły nie ma — dopisano §5, §6a i §7a, komentarz wskazuje faktyczne miejsca. Podzarzut „nazwa polityki nie pozwala odtworzyć przydziału” nie zachodzi, bo `config.scope` i `domainTargets` w sesji wystarczają.
  - `[low]` `[patch]` Blind: `docs/MIGRACJA_WEBINARY.md:55` mówi „bez osobnego trybu tylko webinary”, co przeczy CAP-8 — zdanie poprawione.
  - `[low]` `[reject]` Blind: `domainQuotas('WEBINAR', …)` bez `supply` zwraca same zera — jedyne wywołanie (`planTest`) zawsze podaje podaż, a pusta podaż kończy się wcześniej odmową z `planCore`; strażnik dodałby gałąź dla nieistniejącego wywołania.
  - `[false]` `[reject]` Blind: `scopeDomains` zwraca dla WEBINAR wszystkie domeny, co ma być mylące — funkcja nie ma wywołań i opisuje domeny objęte zakresem; filtrem pytań jest `matchesScope`.
  - `[false]` `[reject]` Blind: dwie definicje podaży (rodziny w Teście, pytania we Free Flow) — to celowe: Test bierze jedną rodzinę na pozycję, a Free Flow dobiera pytania; każda miara odpowiada „równo z jednej puli” w swoim trybie.
  - `[low]` `[patch]` Blind: brak testu „Moich błędów” w dziedzinie z kwotą 0 (ANAT przy N=20) — dopisano test domeny; pozostałe przypadki (remisy, N=0) obsługuje sprawdzony już `largestRemainderQuotas`.
  - `[low]` `[patch]` Blind: brak testu „katalog bez pytań WB nie dostaje opcji Webinar” — dopisano test `scopeListOf`. Druga część zarzutu (zapisane `lastTestConfig` = WEBINAR przy katalogu bez WB daje tytuł bez zaznaczonego radia) w produkcji nie zachodzi, bo `appController.buildContentCatalog` (src/app/appController.ts:593) wymaga dokładnie `counts.webinar` (247) pytań WB.
  - `[low]` `[reject]` Blind: liczby wydania (247, 246, podaż dziedzin) wpisane w testach — tak samo robią istniejące testy wydania (bank-smoke, bank-webinary); nowe wydanie i tak wymaga przeglądu tych liczb.
  - `[low]` `[patch]` Blind: brak opisu zgodności wstecz (starsza wersja odrzuci kopię z WEBINAR, a po wycofaniu wdrożenia pokaże „WEBINAR” z pustą pulą) — dopisano zdanie w `docs/MIGRACJA_WEBINARY.md`.
  - `[false]` `[reject]` Blind: e2e rozwija pierwszy wiersz źródła i sprawdza tylko końcówkę `[webinar]` — walidacja katalogu wymaga, żeby pytanie WB miało wyłącznie źródła webinarowe i treść zakończoną `[webinar]`, której pytania V18 nie mają; test nie może więc przejść na pytaniu spoza WB.
  - `[low]` `[patch]` Blind: zmienione `docs/zrzuty/*.png` po e2e poza diffem — przywrócone `git checkout -- docs/zrzuty`, poza commitem.
  - `[low]` `[reject]` Blind: specyfikacja zawiera instrukcje miejsca pracy tej sesji — poprawka oznaczałaby edycję specyfikacji tego przebiegu; ten sam układ ma specyfikacja historii 1.
  - `[low]` `[reject]` Blind: atrapa powiela `scopeTitleOf` i importuje z `domain/types`/`domain/util` — obie ścieżki używają wspólnej stałej `WEBINAR_SCOPE_TITLE`, więc etykieta nie może się rozjechać; atrapa ma ten sam wzorzec dla dziedzin.
  - `[low]` `[reject]` Blind: `scopeListOf` przegląda katalog przy każdym przeliczeniu ekranu — jedno `some` po ok. 700 pytaniach obok ośmiu `poolFor`, koszt pomijalny.
  - `[false]` `[reject]` Edge: WEBINAR w ustawieniach przy katalogu bez WB — jak wyżej, w produkcji niemożliwe (src/app/appController.ts:593).
  - `[low]` `[reject]` Edge: `domainQuotas('WEBINAR')` bez podaży — duplikat wyżej, brak wywołania bez podaży.
  - `[low]` `[reject]` Intent: kwoty z największych reszt są deterministyczne, więc krótkie testy „Webinar” zaczynają od DEV/SAFE/SKIN, a 6 pytań ANAT trafia na koniec cyklu. Losowanie z jednego kubełka (odczyt dosłowny) rozłożyłoby je równomiernie. Pokrycie wszystkich 247 pytań w cyklu jest takie samo (przebieg A „najpierw niewidziane”). Poprawka wymaga zmiany macierzy w `<intent-contract>` tej specyfikacji, więc decyzję przekazano liderowi w raporcie.
  - `[false]` `[reject]` Intent: opcja widoczna tylko przy katalogu z pytaniami WB — w produkcji zawsze widoczna (src/app/appController.ts:593), warunek dotyczy wyłącznie katalogów testowych.
  - `[false]` `[reject]` Intent: rozjazd powierzchni (UI na atrapie, Free Flow i historia bez e2e) — historia, restart, Free Flow i kopia są sprawdzone na prawdziwym kontrolerze (`tests/app/zakres-webinar.test.ts`), e2e obejmuje Test zgodnie z kryteriami; warstwa luk weryfikacji nie znalazła braków.
  - `[low]` `[patch]` Intent: zmienione `docs/zrzuty/*.png` poza diffem — ten sam skutek uboczny e2e co wyżej; przywrócone, poza commitem.

## Design Notes

**Miejsce pracy.** `{project-root}` = `/Users/dominiklyzwa/DEWELOPER_CLAUDE/projekty/doktor-monika-egzamin/.worktrees/5` (git worktree, gałąź `story/5`); nie edytuj głównego folderu projektu ani innych `.worktrees/*`. Komendy `git`, `npm`, `npx` uruchamiaj poza sandboxem. Nie commituj (commit robi workflow po przeglądzie). Zależności zainstalowane (`npm ci`); stan wyjściowy `npm test`: 864/864. TDD: najpierw test czerwony z właściwego powodu, potem kod, potem porządki; nie zmieniaj testu tylko po to, żeby przeszedł. Jedyny nowy tekst UI: `Webinar`.

**Dlaczego proporcjonalnie.** Zakres jednej dziedziny losuje równomiernie z całej swojej puli (jeden kubełek). „Webinar” obejmuje 6 dziedzin o bardzo nierównej podaży (DEV 118, SAFE 47, SKIN 36, INJ 26, THER 14, ANAT 6). Równy podział na dziedziny (jak dawne ALL V2) albo wagi DEV 0,40 powtarzałyby 6 pytań ANAT, zanim pojawią się nieoglądane pytania DEV. Kwoty/wagi proporcjonalne do podaży dają odpowiednik „jednej puli”, a przydział zostaje w istniejącym kształcie (`domainTargets`, `freeFlowWeights` po dziedzinach) — kopia danych i walidacja przydziału bez zmian. Przykład N=20 (największe reszty, kolejność rotacji): podłogi 9+3+2+2+1+0 = 17, reszty SKIN 0,91 > SAFE 0,81 > DEV 0,55 → DEV 10, SAFE 4, SKIN 3, INJ 2, THER 1, ANAT 0. Nazwa polityki w sesji jak dla zakresu jednej dziedziny (V3/FREE_FLOW_V3 przy katalogu z profilem, bez pola `profile`).

**E2E.** `npm run test:e2e` z `E2E_PORT=4186`; znane: 2 pominięcia WebKit. `tests/domain/freeflow.test.ts` i `tests/app/regresje-weryfikacji.test.ts` bywają wolne przy obciążeniu (limit czasu) — odnotuj, nie zmieniaj.

## Verification

**Commands:**
- `npm test` -- expected: wszystkie testy zielone (864 + nowe)
- `npm run typecheck` -- expected: bez błędów
- `npm run build` -- expected: sukces
- `node scripts/check-dist.mjs --dist dist --base /` -- expected: sukces
- `E2E_PORT=4186 npm run test:e2e` -- expected: wszystkie zielone poza znanymi 2 pominięciami WebKit

## Auto Run Result

Status: done

**Zmiana.** Nowy zakres `WEBINAR` (etykieta `Webinar`, ostatnia na liście „Zakres” w Test i Free Flow, gdy katalog ma pytania WB): pula = pytania z `webinarEvidence` (247 pytań, 247 rodzin) po wyłączonych ID i blokadach. Test: bez profilu treningowego, kwoty domen proporcjonalne do liczby rodzin puli (największe reszty). Free Flow: wagi = udział domeny w liczbie pytań puli, bez adaptacji i bez DEV 0,40. „Moje błędy”, runda błędów i zastępstwa biorą wyłącznie WB. Tytuł `Webinar` w konfiguracji, karcie przerwanej sesji i historii; ostatnia konfiguracja i kopia danych z `WEBINAR` zapisują się i wczytują. `DB_SCHEMA_VERSION` i nazwy polityk bez zmian.

**Pliki.**
- `src/domain/types.ts` — `WEBINAR_SCOPE`, rozszerzony `Scope`.
- `src/domain/util.ts` — `isScope` z WEBINAR, `matchesScope`, `scopeDomains`.
- `src/domain/pool.ts` — filtr puli przez `matchesScope`.
- `src/domain/testPolicy.ts` — rotacja i kwoty proporcjonalne dla WEBINAR (`domainSupply`), zastępstwo przez `matchesScope`.
- `src/domain/freeFlowPolicy.ts` — `supplyWeights` dla WEBINAR.
- `src/persistence/backup.ts` — `WEBINAR` w dozwolonych zakresach kopii.
- `src/app/screenModels.ts` — `WEBINAR_SCOPE_TITLE`, `scopeTitleOf`, `scopeListOf`.
- `src/app/mockController.ts` — atrapa: pula, tytuł i lista zakresów.
- `docs/DECYZJE_ARCHITEKTURY.md` (§5, §6a pkt 7, §7a), `docs/MIGRACJA_WEBINARY.md` — zasady zakresu i zgodność wstecz.
- Testy: `tests/domain/zakres-webinar.test.ts`, `tests/app/zakres-webinar.test.ts`, `tests/ui/zakres-webinar.test.tsx` (nowe); `tests/persistence/kopia.test.ts`, `tests/app/regresje-p3.test.ts`, `tests/e2e/flows-extra.spec.ts` (uzupełnione).

**Przegląd.** 20 uwag: 6 poprawek (wszystkie `low`: wpisy w DECYZJE i komentarz, zdanie w MIGRACJA_WEBINARY, opis zgodności wstecz, test „Moich błędów” w dziedzinie z kwotą 0, test listy zakresów bez WB, przywrócone zrzuty e2e), 0 odłożonych, 14 odrzuconych z uzasadnieniem w Review Triage Log. Rekomendacja ponownego przeglądu: `false` (poprawki tylko `low`: 0 high, 0 medium).

**Weryfikacja.** `npm test` 895/895; `npm run typecheck` bez błędów; `npm run build` sukces; `node scripts/check-dist.mjs --dist dist --base /` 87 kontroli, 0 FAIL; `E2E_PORT=4186 npm run test:e2e` 94 passed, 2 skipped (znane WebKit), 0 failed.

**Ryzyka.** (1) Kwoty z największych reszt są deterministyczne: krótkie testy „Webinar” zaczynają od DEV/SAFE/SKIN, a 6 pytań ANAT pojawia się pod koniec cyklu niewidzianych. Alternatywa „jeden kubełek” (losowanie bez podziału na dziedziny) wymaga decyzji lidera. (2) Starsza wersja aplikacji odrzuci kopię z zakresem WEBINAR (opisane w MIGRACJA_WEBINARY). (3) `domainQuotas('WEBINAR')` bez podaży zwraca zera — dziś jedyne wywołanie podaje podaż.
