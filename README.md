# Doktor Monika Egzamin

Osobista aplikacja PWA do nauki pytań jednokrotnego wyboru z medycyny estetycznej — po polsku, na iPhonie, offline, bez logowania i bez backendu. Dwa tryby: **Test** (N pytań z wybranego zakresu, wynik z progiem 65%, przegląd błędów, kolejne rundy „Uwzględnij błędy”) i **Free Flow** (pytania bez limitu, z pierwszeństwem powtórek). Odpowiedzi, sesje, wyniki, stan powtórek i wykluczone pytania są zapisywane wyłącznie na urządzeniu (IndexedDB) i w ręcznie eksportowanej kopii.

Materiał pytań jest **autorskim materiałem treningowym w wersji roboczej**: klucze nie mają recenzji lekarskiej, to **nie jest oficjalny bank pytań PTMEiAA**, a wynik w aplikacji **nie jest oceną komisji egzaminacyjnej** ani prognozą wyniku egzaminu.

## Stan

- **Wydanie „V18 + webinary” — 947 pytań** (`dme-v18-webinary-2026-11-15-8622d52b9a42`): niezmieniony bank V18 (700 pytań: 600 V16 + 100 krótkich V17, od 09.11.2026) plus **247 pytań z transkrypcji webinarów** jako dodatek (treść kończy się „[webinar]”; po odpowiedzi przycisk „Źródło webinaru” z nazwą pliku i cytatem z automatycznych napisów, bez linku). Profile, wyniki i stan nauki z V18 zostają: przy pierwszym otwarciu profilu baza przechodzi na wersję 5, a sesje V18 — także rozpoczęte — zostają aktywne. Opis, instrukcja dla iPhone'a i postępowanie przy awarii (wyłącznie poprawka „do przodu”, bez cofania): **`docs/MIGRACJA_WEBINARY.md`** (wcześniejsze zmiany: `docs/MIGRACJA_V18.md`, `docs/MIGRACJA_V15.md`).
- Jedna pula bez wyboru poziomu trudności i bez osobnego trybu „tylko webinary”: Test (domyślnie 20 pytań, próg 65%, bez limitu czasu) i Free Flow losują ze wszystkich 947 pytań albo z wybranego działu.
- Kontrola wydania: **`docs/RAPORT_KONTROLI.md`**.
- **Adres produkcyjny: https://wiedza.doktormonika.pl/** (od 25.10.2026; GitHub Pages z własną domeną, repozytorium https://github.com/lyzwad/doktor-monika-egzamin). Bez logowania i backendu: wybór jednego z 9 profili lokalnych (adres @doktormonika.pl, bez hasła), osobne postępy każdego profilu na urządzeniu — `docs/PROFILE.md`. Dawny adres przekierowuje na nowy; postępy przenosi się plikiem kopii: `docs/PRZENIESIENIE_NA_WIEDZA.md`.
- **Nie wykonano** testu na fizycznym iPhonie (kryterium G05: NOT RUN), w tym aktualizacji do nowego wydania z ikony w prawdziwym Safari iOS.

## Stan puli pytań

Dane: wyłącznie wydanie „V18 + webinary” w `public/data/` (nie edytować ręcznie). Pliki generuje `node scripts/webinary-addendum.mjs` z wejść w `content/` (bank V18 bajt w bajt z paczki redakcji i kanoniczny dodatek webinarowy); build i `check-dist` sprawdzają SHA-256 i allowlistę `content/v18-webinary/allowed_question_ids.json` (700 ID V18 + 247 ID WB):

| Plik | Zawartość |
|---|---|
| `bank-475c1fef0099.json` | 947 pytań (700 V18 bez zmian + 247 WB) w 939 rodzinach. Dziedziny: ANAT 147, SKIN 196, DEV 263, INJ 186, THER 72, SAFE 83. Bez schematów |
| `retired-question-ids-40450ecb4f2b.json` | 3120 historycznych ID (w tym cały bank V15), żadne nie jest aktywne |
| `training-profile-a8bf8dbe7e3b.json` | profil treningowy całego zakresu: skóra 35%, anatomia twarzy 25%, pozostałe 40% (DECYZJE §6a, §7a); pytania WB w grupie według działu |

Wersję i sumy kontrolne aplikacja bierze z `src/domain/contentRelease.ts`, allowlistę migracji z `src/persistence/v18Allowlist.ts` (947 wierszy, generuje `scripts/webinary-addendum.mjs`). Liczby „przed + dodane = po”: `docs/MIGRACJA_WEBINARY.md` §2.

- Metadane trudności zostają w pliku bez zmian (600 V16: 300 / 200 / 100; w 100 V17 i w 247 WB `basic` to techniczny placeholder), ale aplikacja ich nie pokazuje i nie filtruje po nich. 700 rekordów V18 nie oznacza 700 odrębnych zagadnień — krótkie pytania V17 celowo wracają do tematów V16.
- Pytania WB to materiał egzaminacyjny z wykładów (napisy automatyczne), a nie zweryfikowane aktualne wytyczne: klucz sprawdzony przez AI względem transkrypcji, bez recenzji klinicznej. Źródło webinaru nie ma adresu URL.
- Dawne wymogi 2000 pytań i 1000 na poziom nie obowiązują (decyzja właściciela z 09.11.2026); aplikacja nie dopisuje ani nie przekwalifikowuje pytań.
- Status treści: 600 pytań `independently_checked_draft`, 100 `author_checked_draft`, 247 `source_checked_AI_draft`; wszystkie `draft_pending_clinical_review`, `clinical_signoff = false`, 0 recenzji lekarskich.
- Import dodatkowych pul pytań jest **wyłączony**. „O bazie” i Ustawienia pokazują liczby z banku (pytania, rodziny, dziedziny, pytania z webinarów, wycofane ID, profil) oraz status materiału.

## Uruchomienie lokalne

Wymagania: Node.js `^22.22.2 || >=24.15.0` (`.nvmrc`: 24), npm. Bez kluczy API i usług zewnętrznych.

```bash
npm ci                # zależności z package-lock.json
npm run dev           # serwer deweloperski Vite (http://localhost:5173/; ?mock=1 — kontroler w pamięci, tylko dev)
```

Web Crypto i Service Worker wymagają bezpiecznego kontekstu — na telefonie używaj HTTPS (np. podglądu wdrożenia), nie `http://<IP>:5173`.

## Testy

```bash
npm run typecheck                               # tsc: domain (bez DOM), app, testy, konfiguracje
npx vitest run --maxWorkers=2                   # Vitest: domain, persistence (w tym migracja v5), app (rzeczywisty kontroler + fake-indexeddb), pwa, ui (jsdom), docs (raport kontroli i MIGRACJA_WEBINARY vs bank)
npm run test:e2e -- --workers=1                 # Playwright: build pod / + WebKit „iPhone 15” i Chromium mobile (w tym aktualizacja zainstalowanej aplikacji z produkcji 39d9d46, b6f9201 i b50eb19)
E2E_SKIP_BUILD=1 npx playwright test --workers=1 tests/e2e/aktualizacja-webinary.spec.ts   # pojedynczy zestaw na istniejącym dist
node scripts/check-offline.mjs --base /                 # Service Worker w Chromium i WebKit (po buildzie)
```

Na obciążonej maszynie uruchamiaj testy sekwencyjnie (`--maxWorkers=2`, `--workers=1`). Testy e2e nie zastępują testu na fizycznym iPhonie.

## Build

```bash
BASE_PATH=/ npm run build                 # typecheck + vite build → dist/ (SW, manifest, precache)
node scripts/check-dist.mjs --base /      # kontrola dist: treść wydania (SHA-256, wersja, liczby, allowlista 947, brak plików V18 i starszych), precache, manifest, brak hostów zewnętrznych i mocka
```

`BASE_PATH` musi odpowiadać nazwie repozytorium na GitHub Pages (`/<repozytorium>/`); workflow `.github/workflows/pages.yml` liczy go automatycznie.

## Kopia danych — ważne

Dane nauki istnieją tylko na tym urządzeniu. Usunięcie danych witryny w Safari, usunięcie aplikacji z ekranu głównego albo zmiana telefonu bez kopii oznacza ich utratę. Zapisuj regularnie kopię: **Ustawienia → Kopia danych → Zapisz kopię**, a potem sprawdź, czy plik `dme-kopia-RRRR-MM-DD.json` zapisał się w aplikacji Pliki (folder Pobrane) — aplikacja przygotowuje plik, ale nie może potwierdzić, że zapis się udał. Kopia zawiera wyniki, sesje (z treścią pytań bieżącego banku do przeglądu odpowiedzi, dla pytań z webinarów także z cytatem źródła), stan powtórek i wykluczone pytania. Nie zawiera wbudowanej puli, zaimportowanych pul ani danych pacjentów. Sesje z banków sprzed V18 (V15 i starsze) trafiają do kopii tylko jako podsumowania. Wczytanie kopii zastępuje dane na urządzeniu, ale wcześniej zapisuje automatyczną kopię bezpieczeństwa. Starsza kopia wczytuje się według allowlisty bieżącego wydania: kopia z V18 daje ten sam stan co aktualizacja telefonu (wszystkie sesje aktywne); z V15 — zgodne pytania V16/V17 zostają, pozostałe sesje jako same podsumowania, otwarte stają się przerwane, a pule są odrzucane.

## Dokumentacja

- `docs/INSTALACJA_IPHONE.md` — dodanie do ekranu głównego, pierwsze uruchomienie, praca offline, kopia danych.
- `docs/WDROZENIE.md` — GitHub Pages, PWA i Service Worker, kroki publikacji (wykonanej 23.10.2026).
- `docs/RAPORT_KONTROLI.md` — raport końcowy kontroli: build, wyniki testów ze środowiskiem, pula, status recenzji treści, testy niewykonane (G05), wdrożenie (adres i kontrola po wdrożeniu), macierz A01–G07.
- `docs/MIGRACJA_WEBINARY.md` — dodatek 247 pytań z webinarów (wydanie „V18 + webinary”, 947): pliki i SHA, liczby przed + dodane = po, migracja profili (baza v5), Service Worker i iPhone, weryfikacja, kopia i poprawka „do przodu” zamiast cofania.
- `docs/MIGRACJA_V18.md` — przejście na bank V18 (700 pytań): co usunięto, co zachowano, migracja profili, iPhone, kopia i historyczna procedura cofnięcia do V15 (nieaktualna od wydania z webinarami).
- `docs/MIGRACJA_V15.md` — wcześniejsze przejście na bank V15 (historyczne).
- `docs/RAPORT_PULI.md` — historyczny opis puli V15 (aktualny stan puli: ta sekcja i `docs/MIGRACJA_WEBINARY.md`).
- `docs/MANIFEST_PULI.json` — manifest puli (liczby, sumy kontrolne).
- `docs/DECYZJE_ARCHITEKTURY.md` — wiążące decyzje i polityki doboru (wersjonowane; V15: §6a, §7a, §10a, §14).
- `docs/ARCHITEKTURA_APP.md` — moduły, kontrakty, komendy, zasady i pokrycie testów, znane kwestie.
- `docs/PLAN_REALIZACJI.md` — plan etapów; `docs/zrzuty/` — zrzuty ekranów z testów e2e (WebKit 393×852).
