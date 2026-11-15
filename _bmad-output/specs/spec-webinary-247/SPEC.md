---
id: SPEC-webinary-247
companions:
  - kontrakt-danych.md
  - teksty-ui.md
  - ../../../docs/MIGRACJA_V18.md
sources:
  - ../../../content/webinary-2026-11-15/MANIFEST.json
  - "PROMPT_CLAUDE_CODE.txt z paczki Doktor_Monika_Webinary_247_Pytan_Claude_Code.zip (prywatna kopia: projekty/_kopie/doktor-monika-egzamin-2026-11-15-przed-webinarami/paczka)"
---

> **Kanoniczny kontrakt.** Ten SPEC i pliki z `companions:` są pełnym kontraktem tego, co zbudować, przetestować i sprawdzić.

# Dodatek 247 pytań z webinarów (bank V18 + webinary)

## Why

Mandat właściciela: dołożyć do działającej aplikacji https://wiedza.doktormonika.pl/ (PWA offline, GitHub Pages, bez backendu) 247 pytań przygotowanych z transkrypcji webinarów, **jako dodatek**. Obecny bank V18 (700 pytań), profile i postępy w telefonach muszą zostać nietknięte. Pytania webinarowe to materiał egzaminacyjny z wykładów (napisy automatyczne), a nie zweryfikowane aktualne wytyczne — aplikacja musi to uczciwie pokazywać.

## Capabilities

- **CAP-1**
  - **intent:** Budowanie łączy bajtowo niezmieniony bank V18 z kanonicznym dodatkiem `dme-webinar-addendum` (adapter do formatu `dme-runtime-bank`) w jedno wydanie treści.
  - **success:** Wydanie ma dokładnie 947 pytań (700 + 247), 939 rodzin; każdy z 700 rekordów V18 jest głęboko równy rekordowi z `content/v18/bank.json`; każdy z 247 rekordów WB zachowuje 1:1 treść, opcje, klucz, wyjaśnienie, źródła i dowód z `bank_webinar_addendum.json`; SHA dodatku i liczba/ID zgodne z `MANIFEST.json`.
- **CAP-2**
  - **intent:** Import dodatku jest idempotentny i jawny przy konfliktach.
  - **success:** Ponowne scalenie (także na wyniku, który już zawiera WB) daje bajtowo ten sam plik bez duplikatów; ten sam ID z inną treścią przerywa budowanie komunikatem z ID i różnicą; identyczne pytania pod różnymi ID są raportowane parami i niczego nie usuwają.
- **CAP-3**
  - **intent:** Aplikacja przyjmuje nowe wydanie: allowlista = 700 ID V18 + 247 ID WB, nowa `bank_version`, SHA, liczniki, katalog, profil treningowy i Service Worker.
  - **success:** Katalog przy starcie = allowlista 947; Test, Free Flow i runda błędów losują z pełnej puli 947 (bez wyboru trudności); dawne pliki `data/` (w tym `bank-5db40505308f.json`) zwracają 404 z serwera i z Service Workera; `scripts/check-dist.mjs` przechodzi.
- **CAP-4**
  - **intent:** Dane użytkownika z V18 przechodzą do nowego wydania bez straty.
  - **success:** Po migracji IndexedDB (v4 → v5) każda sesja V18 (otwarta, ukończona, pusta) zostaje aktywna i wznawialna z nową `bankVersion`; próby, stan powtórek („Moje błędy”, runda błędów) i zgłoszenia pytań V18 zostają; sesje `legacy` bez zmian; dwa profile migrują niezależnie; migracja idempotentna i atomowa; kopia danych z V18 wczytana do nowej wersji daje ten sam wynik.
- **CAP-5**
  - **intent:** Po odpowiedzi na pytanie WB użytkowniczka widzi źródło webinaru: tytuł, identyfikatory fragmentów i przycisk „Źródło webinaru” otwierający wewnętrzny panel z cytatem dowodowym i nazwą pliku, oznaczonym jako fragment automatycznych napisów.
  - **success:** Dla pytań WB w DOM nie ma żadnego `<a>` ani pustego linku źródła; panel działa offline; teksty dokładnie jak w `teksty-ui.md`; pytania V18 wyglądają jak dotąd. Historia i przegląd czytają dowód ze snapshotu.
- **CAP-6**
  - **intent:** Liczniki i opisy w aplikacji podają prawdziwy stan puli i statusy kontroli.
  - **success:** „O bazie pytań” pokazuje 947 pytań i 939 rodzin, wiersz „Pytania z webinarów” = 247 oraz dotychczasowy licznik przeglądu AI (600); teksty z „V18, 700 pytań” pokazują stan nowego wydania; nigdzie nie pojawia się deklaracja zatwierdzenia klinicznego.
- **CAP-7**
  - **intent:** Zainstalowana PWA aktualizuje się sama do nowego wydania i potem działa offline.
  - **success:** E2E: aplikacja z produkcji `39d9d46` z dwoma profilami i historią → nowe wydanie przejmuje kartę, każdy profil migruje osobno, 947 pytań, stare wyniki V18 widoczne i aktywne, test i runda błędów działają, Free Flow działa, po odcięciu sieci aplikacja otwiera się i pokazuje pytania WB ze źródłem.

## Constraints

- Nie zmieniać treści ani metadanych 700 rekordów V18; nie dodawać żadnego ID do retired; nie usuwać żadnego rekordu na podstawie podobieństwa bez decyzji Dominika.
- Nie generować pytań, nie dopisywać wiedzy, PMID, DOI, URL ani minut nagrań. `url` źródeł webinaru zostaje `null`.
- Każdy `stem_pl` WB kończy się dosłownie `[webinar]` i tak jest wyświetlany.
- `difficulty: basic` WB jest technicznym placeholderem; interfejs nie pokazuje trudności.
- `clinical_signoff = false`, `approved_for_question_key = false`; statusy jak w `kontrakt-danych.md`.
- Repozytorium i strona są publiczne: runtime zawiera tylko pytania, metadane i krótkie cytaty dowodowe; bez transkrypcji, e-booków, `PROMPT_CLAUDE_CODE.txt` i `Pytania_z_odpowiedziami.txt`.
- Bez zmian systemu profili, bez Supabase, bez backendu. Bez zmian DNS, strony gabinetu, sklepu, poczty, MonikaOS.
- Migracja wyłącznie w transakcji `versionchange` (jak v4), bez kasowania baz innych profili.
- Wdrożenie wyłącznie przez Pull Request do `main` (workflow „Publikacja na GitHub Pages”).
- TDD: test przed kodem; nowe teksty UI wyłącznie z `teksty-ui.md`.

## Non-goals

- Osobny filtr lub tryb „tylko webinary”, wybór poziomu trudności, ocena trudności pytań WB.
- Recenzja medyczna kluczy, poprawianie błędów ASR w cytatach, linki do nagrań.
- Import pul przez użytkownika (pozostaje wyłączony).
- Test na fizycznym iPhonie (emulacja WebKit nie jest takim testem).

## Success signal

Publiczny adres https://wiedza.doktormonika.pl/ serwuje `dme-release.json` z nową `bankVersion` i SHA banku, plik banku ma 947 pytań (700 V18 bez zmian + 247 WB), a e2e aktualizacji z produkcji `39d9d46` z dwoma profilami przechodzi łącznie z trybem offline.

## Assumptions

- Webinary nie mają ustalonej trudności; pełna pula domyślna obejmuje je bez zmian wag profilu.
- Pusta sesja V18 jest zgodna z nowym wydaniem (nowe wydanie jest nadzbiorem V18).
