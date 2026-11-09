# Doktor Monika Egzamin

Osobista aplikacja PWA do nauki pytań jednokrotnego wyboru z medycyny estetycznej — po polsku, na iPhonie, offline, bez logowania i bez backendu. Dwa tryby: **Test** (N pytań z wybranego zakresu, wynik z progiem 65%, przegląd błędów, kolejne rundy „Uwzględnij błędy”) i **Free Flow** (pytania bez limitu, z pierwszeństwem powtórek). Odpowiedzi, sesje, wyniki, stan powtórek i wykluczone pytania są zapisywane wyłącznie na urządzeniu (IndexedDB) i w ręcznie eksportowanej kopii.

Materiał pytań jest **autorskim materiałem treningowym w wersji roboczej**: klucze nie mają recenzji lekarskiej, to **nie jest oficjalny bank pytań PTMEiAA**, a wynik w aplikacji **nie jest oceną komisji egzaminacyjnej** ani prognozą wyniku egzaminu.

## Stan

- **Od 09.11.2026 aplikacja udostępnia wyłącznie bank pytań V18 — komplet 700 pytań** (`chatgpt-combined-v18-2026-11-09-1fb7f7546332`): wszystkie 600 pytań V16 i wszystkie 100 krótkich pytań V17. Bank V15 (2987 pytań) usunięto z aplikacji. Każdy profil przechodzi migrację przy pierwszym otwarciu: dawne wyniki zostają jako podsumowania (daty i liczby), treść pytań spoza puli V18 znika, otwarta sesja zostaje „Przerwana aktualizacją banku pytań”. Opis, instrukcja dla iPhone'a i procedura cofnięcia: **`docs/MIGRACJA_V18.md`** (poprzednia zmiana: `docs/MIGRACJA_V15.md`).
- Jedna pula bez wyboru poziomu trudności: Test (domyślnie 20 pytań, próg 65%, bez limitu czasu) i Free Flow losują ze wszystkich 700 pytań albo z wybranego działu.
- Kontrola przed wdrożeniem V18 i po nim: **`docs/RAPORT_KONTROLI.md`**.
- **Adres produkcyjny: https://wiedza.doktormonika.pl/** (od 25.10.2026; GitHub Pages z własną domeną, repozytorium https://github.com/lyzwad/doktor-monika-egzamin). Bez logowania i backendu: wybór jednego z 9 profili lokalnych (adres @doktormonika.pl, bez hasła), osobne postępy każdego profilu na urządzeniu — `docs/PROFILE.md`. Dawny adres przekierowuje na nowy; postępy przenosi się plikiem kopii: `docs/PRZENIESIENIE_NA_WIEDZA.md`.
- **Nie wykonano** testu na fizycznym iPhonie (kryterium G05: NOT RUN), w tym aktualizacji do V18 z ikony w prawdziwym Safari iOS.

## Stan puli pytań

Dane: wyłącznie bank V18 w `public/data/`, bajt w bajt z paczki redakcji (nie edytować; build i `check-dist` sprawdzają SHA-256 i allowlistę `content/v18/allowed_question_ids.json`):

| Plik | Zawartość |
|---|---|
| `bank-5db40505308f.json` | 700 pytań (600 V16 + 100 V17) w 692 rodzinach. Dziedziny: ANAT 141, SKIN 160, DEV 145, INJ 160, THER 58, SAFE 36. Bez schematów |
| `retired-question-ids-54a05ea91281.json` | 3120 historycznych ID (w tym cały bank V15), żadne nie jest aktywne |
| `training-profile-2bdad504f50e.json` | profil treningowy całego zakresu: skóra 35%, anatomia twarzy 25%, pozostałe 40% (DECYZJE §6a, §7a) |

Wersję i sumy kontrolne aplikacja bierze z `src/domain/contentRelease.ts`, allowlistę migracji z `src/persistence/v18Allowlist.ts` (generuje `scripts/v18-allowlist.mjs`).

- Metadane trudności zostają w pliku bez zmian (600 V16: 300 / 200 / 100; w 100 V17 `basic` to techniczny placeholder), ale aplikacja ich nie pokazuje i nie filtruje po nich. 700 rekordów nie oznacza 700 odrębnych zagadnień — krótkie pytania V17 celowo wracają do tematów V16.
- Dawne wymogi 2000 pytań i 1000 na poziom nie obowiązują (decyzja właściciela z 09.11.2026); aplikacja nie dopisuje ani nie przekwalifikowuje pytań.
- Status treści: 600 pytań `independently_checked_draft`, 100 `author_checked_draft`; wszystkie `draft_pending_clinical_review`, `clinical_signoff = false`, 0 recenzji lekarskich.
- Import dodatkowych pul pytań jest **wyłączony**. „O bazie” i Ustawienia pokazują liczby z banku (pytania, rodziny, dziedziny, wycofane ID, profil) oraz status materiału.

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
npx vitest run --maxWorkers=2                   # Vitest: domain, persistence (w tym migracja V18), app (rzeczywisty kontroler + fake-indexeddb), pwa, ui (jsdom), docs (raport kontroli vs bank V18)
npm run test:e2e -- --workers=1                 # Playwright: build pod / + WebKit „iPhone 15” i Chromium mobile (w tym aktualizacja ze starej aplikacji z tagu v0.1.0-pages)
E2E_SKIP_BUILD=1 npx playwright test --workers=1 tests/e2e/schematy.spec.ts   # pojedynczy zestaw na istniejącym dist
node scripts/check-offline.mjs --base /                 # Service Worker w Chromium i WebKit (po buildzie)
```

Na obciążonej maszynie uruchamiaj testy sekwencyjnie (`--maxWorkers=2`, `--workers=1`). Testy e2e nie zastępują testu na fizycznym iPhonie.

## Build

```bash
BASE_PATH=/ npm run build                 # typecheck + vite build → dist/ (SW, manifest, precache)
node scripts/check-dist.mjs --base /      # kontrola dist: treść V18 (SHA-256, wersja, liczby, allowlista 700, brak dawnych plików banków), precache, manifest, brak hostów zewnętrznych i mocka
```

`BASE_PATH` musi odpowiadać nazwie repozytorium na GitHub Pages (`/<repozytorium>/`); workflow `.github/workflows/pages.yml` liczy go automatycznie.

## Kopia danych — ważne

Dane nauki istnieją tylko na tym urządzeniu. Usunięcie danych witryny w Safari, usunięcie aplikacji z ekranu głównego albo zmiana telefonu bez kopii oznacza ich utratę. Zapisuj regularnie kopię: **Ustawienia → Kopia danych → Zapisz kopię**, a potem sprawdź, czy plik `dme-kopia-RRRR-MM-DD.json` zapisał się w aplikacji Pliki (folder Pobrane) — aplikacja przygotowuje plik, ale nie może potwierdzić, że zapis się udał. Kopia zawiera wyniki, sesje (z treścią pytań bieżącego banku V18 do przeglądu odpowiedzi), stan powtórek i wykluczone pytania. Nie zawiera wbudowanej puli, zaimportowanych pul ani danych pacjentów. Sesje z wcześniejszych banków trafiają do kopii tylko jako podsumowania. Wczytanie kopii zastępuje dane na urządzeniu, ale wcześniej zapisuje automatyczną kopię bezpieczeństwa. Starsza kopia (np. z V15) wczytuje się według allowlisty V18: zgodne pytania V16/V17 zostają, pozostałe sesje jako same podsumowania, otwarte stają się przerwane, a pule są odrzucane.

## Dokumentacja

- `STAN.md` — stan projektu w skrócie; `CLAUDE.md` — zasady pracy dla Claude Code.
- `docs/INSTALACJA_IPHONE.md` — dodanie do ekranu głównego, pierwsze uruchomienie, praca offline, kopia danych.
- `docs/WDROZENIE.md` — GitHub Pages, PWA i Service Worker, kroki publikacji (wykonanej 23.10.2026).
- `docs/RAPORT_KONTROLI.md` — raport końcowy kontroli: build, wyniki testów ze środowiskiem, pula, status recenzji treści, testy niewykonane (G05), wdrożenie (adres i kontrola po wdrożeniu), macierz A01–G07.
- `docs/MIGRACJA_V18.md` — przejście na bank V18 (700 pytań): co usunięto, co zachowano, migracja profili, iPhone, kopia i cofnięcie.
- `docs/MIGRACJA_V15.md` — wcześniejsze przejście na bank V15 (historyczne).
- `docs/RAPORT_PULI.md` — historyczny opis puli V15 (aktualny stan puli: ta sekcja i `docs/MIGRACJA_V18.md`).
- `docs/MANIFEST_PULI.json` — manifest puli (liczby, sumy kontrolne).
- `docs/DECYZJE_ARCHITEKTURY.md` — wiążące decyzje i polityki doboru (wersjonowane; V15: §6a, §7a, §10a, §14).
- `docs/ARCHITEKTURA_APP.md` — moduły, kontrakty, komendy, zasady i pokrycie testów, znane kwestie.
- `docs/PLAN_REALIZACJI.md` — plan etapów; `docs/zrzuty/` — zrzuty ekranów z testów e2e (WebKit 393×852).
