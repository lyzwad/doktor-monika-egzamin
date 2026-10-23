# Doktor Monika Egzamin — plan realizacji

Stan na 22.10.2026. Dokument roboczy Claude Code; opisuje plan i rzeczywiste liczebności odczytane z plików, nie wykonane wdrożenie.

## 1. Przeczytane materiały

- Paczka `Doktor_Monika_Egzamin` (22.10.2026): 00_ZACZNIJ_TUTAJ, 01_USTALENIA_PROJEKTU, 02_URUCHOMIENIE_I_KOSZTY, 02_CLAUDE_CODE/01–04, 05_KONTROLA/01–03 + walidator + schemat, 03_DANE (seed, wiedza, źródła, audyt filtra, plan figur), 04_WIEDZA (raport referencyjny, mapa zakresu).
- Eksport Claude Design „DME projekt gotowy” (22.10.2026): `PRZEKAZANIE_CLAUDE_CODE.md`, `DME-Aplikacja.dc.html` (wszystkie ekrany i stany), `DME Makiety S01-S24.dc.html` (81 ramek), prototyp, tokeny, ikony (`assets/ikony.json`), dwa wzorce schematów (PLAN-FIG-01, PLAN-FIG-09). Kopia paczki w `uploads/` jest identyczna z dostarczoną paczką (porównanie `diff -r`).

## 2. Rzeczywiste liczebności (z plików, nie z celów)

| Pozycja | Wartość | Źródło |
|---|---|---|
| Pytania w seedbanku | 248 | `03_DANE/seed_questions.json` |
| Rodziny w seedbanku | 246 (2 jawne pary bliskich wariantów) | seed + `scope_filter_audit.json` |
| Pierwotne MCQ / wykluczone | 260 / 12 | `scope_filter_audit.json` |
| Rozkład domen seedu | ANAT 40, INJ 41, SKIN 40, THER 41, DEV 46, SAFE 40 | walidator |
| Rozkład trudności seedu | basic 46, intermediate 163, advanced 39 | walidator |
| Aktywne moduły / tezy / tematy | 29 / 139 / 121 | `knowledge_for_generation.json` |
| Rekordy źródeł kanonicznych | 254 | `canonical_sources.json` |
| Gotowe figury w katalogu | 0 (plan: 12, wzorce Design: 2) | `figure_catalog.json`, `figure_plan.json` |
| Medyczne sekcje raportu (rozdz. 4–27, 31–36, 38–39, 41–46) | 215 sekcji, ok. 219 tys. znaków | `04_WIEDZA/raport.md` |
| Cel puli przed wydaniem | 2000–3000 (niedostarczony) | manifest |

Seedbank przechodzi walidator w trybie seed (PASS), a w trybie `--release` ma oczekiwany FAIL (za mało pytań, brak figur).

## 3. Ustalone funkcje (bez zmian przez domysł)

Dwa tryby (Free Flow, Test), MCQ ABCD z jedną prawidłową odpowiedzią, pierwszy tap zatwierdza, wyjaśnienie tylko poprawnego wariantu + źródło, ręczne „Dalej”, „Pokaż wynik” po ostatnim komentarzu, próg `100 × correct ≥ 65 × N`, „Uwzględnij błędy” (bezpośredni rodzic), „Moje błędy” jako priorytet doboru, zgłoszenie z zastępstwem i atomowym „Cofnij” do następnej mutacji, autosave/Kontynuuj, historia Test/Free Flow z wykresem, eksport/import kopii i dodatkowej puli, offline po pierwszym pobraniu. Bez timera, ustnego, AI, kont, odznak, serii, zakładek, „Nie wiem”, pytań o rynek i marki.

## 4. Etapy

1. **Plan i liczebności** — ten dokument.
2. **Integracja Design** — tokeny, typografia, komponenty i stany z `DME-Aplikacja.dc.html` przeniesione do React; bez `support.js`, CDN, desktopowego sidebara i logiki komentarzy MonikaOS.
3. **Generator redakcyjny** (poza repozytorium publicznym, katalog `redakcja/`): podział raportu na sekcje, mapa tez/tematów → sekcje, reguły generowania, rejestr partii, kontrola strukturalna partii, odrębny przegląd (rozwiązanie bez klucza, jednoznaczność, ugruntowanie), kwarantanna, deduplikacja semantyczna, walidator paczki `--release`.
4. **Rozbudowa puli** — partiami po ok. 25–50 pytań na spójną grupę sekcji; liczba wynikowa = liczba faktycznie przyjętych pytań. Raport puli z luką do 2000, jeśli wystąpi.
5. **Silnik domenowy** (czysty TS: dobór, ocena, sesje, powtórki, blokady, historia) → trwałość IndexedDB → UI.
6. **Testy** domenowe (w tym kryteria C04, D01–D07, E01–E06, B02 24 permutacje), integracyjne (IndexedDB, import/eksport), e2e w przeglądarce; build produkcyjny pod podścieżką.
7. **Wydanie** — `dist`, lockfile, instrukcje (uruchomienie lokalne, GitHub Pages, instalacja PWA, kopia danych), raport kontroli z jawnym NOT RUN dla testów na fizycznym iPhonie.

## 5. Decyzje techniczne

- Stos: React + TypeScript + Vite, IndexedDB, Service Worker (precache, aktualizacja na żądanie, bez wymuszonego `skipWaiting`). Wersje dobrane przy instalacji i przypięte w lockfile.
- Hosting docelowy: GitHub Pages (publiczne repozytorium tylko z kodem aplikacji i runtime puli). `base` = `/<nazwa-repozytorium>/` ustawiane zmienną budowania; routing hash (`#/…`), aby odświeżenie ekranu pomocniczego nie dawało 404.
- Runtime bank: plik JSON generowany z zatwierdzonego banku (`redakcja/`) — tylko pola potrzebne aplikacji; bez kwarantanny, wykluczeń, raportu, uzasadnień błędnych opcji.
- Dane użytkowniczki wyłącznie w IndexedDB urządzenia + ręczny eksport pliku.
