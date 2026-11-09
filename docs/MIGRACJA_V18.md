# Migracja do banku pytań V18 — komplet 700 pytań

Stan: 09.11.2026. Aplikacja udostępnia **wyłącznie** bank V18 (`chatgpt-combined-v18-2026-11-09-1fb7f7546332`): wszystkie 600 pytań paczki V16 i wszystkie 100 krótkich pytań paczki V17, razem dokładnie 700. Poprzedni bank V15 (2987 pytań, wdrożony 24–25.10.2026) nie jest już dostępny w żadnym trybie. Polecenie z samodzielnej paczki V17 („tylko 100 pytań, usuń V16”) zostało odwołane i **nie** zostało wdrożone.

Źródło: paczka redakcji `Doktor_Monika_V18_Komplet_700_Pytan.zip` (`MANIFEST.json`, `SHA256SUMS.txt`, `runtime/`). Kontrola paczki przed wdrożeniem: sumy SHA-256 wszystkich 65 plików zgodne, `python3 validation/validate_bank.py .` — 24/24 kontroli, `all_pass: true` (bez walidacji medycznej: `clinical_signoff = false`).

## 1. Treść w aplikacji

| Plik w `public/data/` (i w `dist/data/`) | Zawartość | SHA-256 |
|---|---|---|
| `bank-5db40505308f.json` | bank V18, bajt w bajt jak `runtime/bank.json` z paczki: 700 pytań, 692 rodziny | `5db40505308f0183ed85d5be4b2e9f8c3871d091f6ec7413f5518c88b39966f6` |
| `retired-question-ids-54a05ea91281.json` | 3120 historycznych ID (w tym wszystkie 2987 ID V15); żadne nie jest aktywne | `54a05ea912817442599f73691efaf83b259df3383ea0e9b6d4fdd1148f26905e` |
| `training-profile-2bdad504f50e.json` | profil treningowy całej puli: 35% skóra / 25% anatomia twarzy / 40% pozostałe, każde z 700 pytań w jednej grupie | `2bdad504f50ec265c203e440c72aeebc06f5f94c9eba7f65198dae85594738e9` |

Allowlista paczki (`content/v18/allowed_question_ids.json`, SHA-256 `982cf1cf…a64b`, 700 ID: `V16-…` ×600 i `V17-001`…`V17-100`) jest **jedynym** źródłem decyzji, które pytania są aktywne. `scripts/v18-allowlist.mjs` zamienia ją na `src/persistence/v18Allowlist.ts` (ID, rewizja, fingerprint, klucz — bez treści). Aplikacja przy starcie sprawdza, że katalog jest równy tej liście; inaczej pokazuje błąd i nie pokazuje pytań.

Adapter schematu nie był potrzebny: format `dme-runtime-bank` 1.0 jest ten sam co w V15. Pola dodatkowe V18 (`clinical_decision_pl`, `benchmark_tags`, `difficulty_is_technical_placeholder`) zostają w pliku, ale aplikacja ich nie wyświetla. Wszystkie 700 rekordów porównuje 1:1 z plikiem `tests/domain/bank-v18.test.ts` (ID, revision, fingerprint, treść, 4 opcje, klucz wskazujący ten sam tekst, wyjaśnienie, źródła, metadane) oraz przelicza fingerprint każdego pytania.

Usunięte z aplikacji: trzy pliki V15 (`bank-37f3980a1129.json` i pliki towarzyszące) oraz cztery figury V15 (bank V18 nie ma schematów). Dawne ścieżki banków zwracają **404** — z serwera GitHub Pages i z nowego Service Workera (każdy plik w `data/` poza trzema bieżącymi), także gdy przeglądarka ma je w pamięci HTTP. Nie ma fallbacku do żadnego starszego banku.

## 2. Jedna pula, bez poziomów trudności

- Test i Free Flow losują z całej puli 700 pytań (z wybranym działem albo całym zakresem). Wybór poziomu trudności i etykiety poziomu zniknęły z interfejsu; dawne zapamiętane filtry trudności są czyszczone (migracja ustawień i każda konfiguracja startowa = `mixed`).
- Metadane trudności zostają w pliku bez zmian: 600 V16 = 300 / 200 / 100, a `basic` w 100 V17 to tylko techniczny placeholder. Aplikacja nie nazywa pytań łatwymi ani trudnymi.
- Pojemność Testu = liczba rodzin (692 dla całego zakresu, 700 pytań). Test bierze najwyżej jedno pytanie z rodziny i nie powtarza ID; rodziny i profil sterują kolejnością, ale żadnej części puli nie wykluczają na stałe (test o N = 692 obejmuje każdą rodzinę — `tests/domain/bank-smoke.test.ts`). Brak limitu 100.
- Próg zdania 65%, domyślnie 20 pytań, bez limitu czasu — bez zmian.

## 3. Migracja danych w telefonie (każdy profil osobno)

Każdy profil ma własną bazę IndexedDB. Migracja wykonuje się przy pierwszym otwarciu profilu w nowej wersji: baza przechodzi z wersji 3 na 4 (`src/persistence/schema.ts`, `createMigrationV4`) w **jednej transakcji `versionchange`**, przez funkcję `transformToCurrentBank` (`src/persistence/bankMigration.ts`). Tę samą funkcję stosuje wczytanie kopii danych i eksport kopii. Baza sprzed V15 (wersja 1) przechodzi do wersji 4 w tej samej jednej transakcji.

Pytanie **zgodne** = ID z allowlisty V18, a każdy jego zapis w danych ma tę samą rewizję, fingerprint (treść + opcje) i klucz co paczka. Odpowiedzi nigdy nie są przypisywane do innych ID na podstawie podobieństwa.

| Dane | Po migracji |
|---|---|
| Sesje w całości z pytań zgodnych (np. z samodzielnej paczki V16 albo V17) | **Zostają aktywne** — także otwarte, do dokończenia; wersja banku sesji = V18 |
| Pozostałe sesje: V15, starsze, mieszane, z niezgodną treścią | **Zostaje podsumowanie**: daty, konfiguracja, wynik (poprawne, N, procent, zaliczenie), łańcuch rund. Treść pytań, opcje, klucz, wyjaśnienia i źródła usunięte. Otwarta sesja → „Przerwany aktualizacją banku pytań” (niewznawialna, poza wykresem), z komunikatem w aplikacji |
| Odpowiedzi i stan powtórek („Moje błędy”, runda błędów) | Tylko dla pytań zgodnych; pozostałe usunięte z nauki, błędów i powtórek |
| Zgłoszenia (wykluczone pytania) | Aktywne tylko dla pytań zgodnych; pozostałe nieaktywne, bez początku treści |
| Automatyczne kopie bezpieczeństwa w bazie | Przekształcone tą samą funkcją (zostają liczby, znika treść spoza allowlisty) |
| Zaimportowane pule | Usunięte |
| Ustawienia | Bez zmian, poza filtrem trudności (→ cała pula) |
| Zdarzenia | Zostają (nie zawierają treści) |

Na produkcji przed 09.11.2026 działał wyłącznie bank V15 (V16 i V17 nigdy nie były wdrożone), a żadne ID V15 nie należy do V18. U obecnych użytkowników **wszystkie** sesje sprzed aktualizacji stają się więc podsumowaniami, a stan powtórek zaczyna się od zera. Ścieżkę „zgodne V16/V17 zostają” sprawdzają testy na danych syntetycznych (profil V16, profil V17, kopia mieszana).

**Atomowość.** Błąd w transakcji ją przerywa: baza zostaje w poprzedniej wersji z nietkniętymi danymi, aplikacja pokazuje „Aktualizacja danych nie powiodła się” z „Spróbuj ponownie” i nie pokazuje pytań. Migracja jest idempotentna i nie kasuje całych baz przeglądarki ani danych innych profili.

## 4. Service Worker i iPhone

Nowa wersja treści zmienia znacznik w Cache Storage, więc nowy Service Worker przejmuje otwarte karty (mechanizm z V15: `skipWaiting` → `clients.claim` → przeładowanie; fallback `dme-release.json` przy starcie i powrocie z tła). Workbox usuwa stary precache (bank V15 i figury) tej rejestracji. Po pierwszym połączeniu i aktualizacji aplikacja działa offline wyłącznie na V18.

Instrukcja dla użytkowniczki iPhone'a:

1. Otwórz aplikację z ikony **przy włączonym internecie** i poczekaj kilka sekund — przeładuje się sama i pokaże „Aktualizacja banku pytań…”. Nie trzeba usuwać ikony ani danych witryny.
2. Wybierz swój profil. Ustawienia → „O bazie pytań” powinno pokazywać 700 pytań.
3. Dawne wyniki są w Historii jako podsumowania; rozpoczęty wcześniej test ma opis „Przerwany aktualizacją banku pytań”.
4. Jeśli widać „Aktualizacja danych czeka” — zamknij inne karty z aplikacją i dotknij „Spróbuj ponownie”.

Telefon całkowicie offline nie dostanie aktualizacji; po pierwszym połączeniu zadziała jak wyżej.

## 5. Weryfikacja

- `tests/domain/bank-v18.test.ts` — wydanie, pliki, allowlista 700 (600 + 100), treść 1:1, fingerprinty, trudność bez reklasyfikacji.
- `tests/persistence/migracja-v18.test.ts` — profile V15, V16, V17, mieszane, niezgodna treść, nieznane ID, idempotencja, v1/v3 → v4, przerwanie migracji, dwa profile, import kopii.
- `tests/app/migracja-v18.test.ts` — rzeczywisty kontroler na profilu z aplikacji V15 i z danymi V16.
- `tests/ui/pula-v18.test.tsx` — brak wyboru i etykiet trudności, 700 pytań w „O bazie”.
- `tests/pwa/tresc-sw.test.ts` — 404 dla dawnych plików banków w Service Workerze.
- E2E `tests/e2e/aktualizacja-v18.spec.ts` — aktualizacja zainstalowanej aplikacji z produkcji (`b6f9201`) z dwoma profilami; `tests/e2e/profile.spec.ts` — z wersji bez profili (`b50eb19`).
- `scripts/check-dist.mjs` — allowlista, SHA-256, brak dawnych plików banków w `dist`, precache i kodzie.

Fizyczny iPhone (G05): **NOT RUN** — emulacja WebKit w Playwright nie jest testem urządzenia.

## 6. Kopia i cofnięcie zmiany

Prywatna kopia sprzed wdrożenia (poza repozytorium i poza katalogiem publicznym): `~/DEWELOPER_CLAUDE/projekty/_kopie/doktor-monika-egzamin-2026-11-09-przed-V18/` — lustro działającej strony V15 (`strona/`, 26 plików z precache i `dme-release.json`), pakiet git z pełną historią (`repo-doktor-monika-egzamin.bundle`), wdrożony commit (`b6f9201`), konfiguracja GitHub Pages i dane ostatniego wdrożenia. Aplikacja nie ma serwera ani bazy danych — dane użytkowników są wyłącznie w ich przeglądarkach.

Cofnięcie (przywraca V15 na stronie; dane już zmigrowane w telefonach zostają w wersji 4 i stara aplikacja ich nie otworzy — dlatego cofnięcie tylko w razie poważnej awarii):

1. `git revert -m 1 <commit scalenia PR V18>` na nowej gałęzi, Pull Request do `main`, scalenie — workflow „Publikacja na GitHub Pages” wdroży stan sprzed V18.
2. Sprawdzenie: `curl -s https://wiedza.doktormonika.pl/dme-release.json` pokazuje `chatgpt-editorial-v15-2026-10-24-f020a0440df8`.

Lepsza alternatywa przy błędzie w V18: poprawka „do przodu” (nowy PR), bo nie wymaga ponownej migracji w telefonach.
