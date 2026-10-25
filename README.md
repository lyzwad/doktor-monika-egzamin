# Doktor Monika Egzamin

Osobista aplikacja PWA do nauki pytań jednokrotnego wyboru z medycyny estetycznej — po polsku, na iPhonie, offline, bez logowania i bez backendu. Dwa tryby: **Test** (N pytań z wybranego zakresu, wynik z progiem 65%, przegląd błędów, kolejne rundy „Uwzględnij błędy”) i **Free Flow** (pytania bez limitu, z pierwszeństwem powtórek). Odpowiedzi, sesje, wyniki, stan powtórek i wykluczone pytania są zapisywane wyłącznie na urządzeniu (IndexedDB) i w ręcznie eksportowanej kopii.

Materiał pytań jest **autorskim materiałem treningowym w wersji roboczej**: klucze nie mają recenzji lekarskiej, to **nie jest oficjalny bank pytań PTMEiAA**, a wynik w aplikacji **nie jest oceną komisji egzaminacyjnej** ani prognozą wyniku egzaminu.

## Stan

- **Od 24.10.2026 aplikacja udostępnia wyłącznie bank pytań V15** (`chatgpt-editorial-v15-2026-10-24-f020a0440df8`). Poprzednią pulę (`release-2026-10-23c`) usunięto i nie da się do niej wrócić. Dane na urządzeniu przechodzą migrację przy pierwszym uruchomieniu nowej wersji: dawne wyniki zostają jako podsumowania bez treści, a otwarta sesja zostaje „Przerwana aktualizacją banku pytań”. Opis i instrukcja aktualizacji: **`docs/MIGRACJA_V15.md`**.
- Aplikacja zintegrowana: silnik domeny, IndexedDB z migracją treści, ekrany S01–S24 według Claude Design, Service Worker z przejęciem przy zmianie wersji treści i rzeczywisty kontroler. Przetestowano ją jednostkowo i e2e (WebKit „iPhone 15” i Chromium mobile) na buildzie pod podścieżką `/doktor-monika-egzamin/`, także na aktualizacji z prawdziwej starej aplikacji (tag `v0.1.0-pages`).
- Ostatnia kontrola (24.10.2026, 14:36–14:50, bank V15; macOS 26.5.2, Node 24.18.1, Playwright 1.63.0): typecheck PASS, Vitest 621/621, e2e 87 PASS i 1 SKIP (WebKit `setOffline` — ograniczenie Playwright), `check-dist` 72/72, `check-offline` 54/54. Szczegóły: **`docs/RAPORT_KONTROLI.md`**.
- **Adres produkcyjny: https://wiedza.doktormonika.pl/** (od 25.10.2026; GitHub Pages z własną domeną, repozytorium https://github.com/lyzwad/doktor-monika-egzamin; bank V15 `chatgpt-editorial-v15-2026-10-24-f020a0440df8`). Bez logowania i backendu: wybór jednego z 9 profili lokalnych (adres @doktormonika.pl, bez hasła), osobne postępy każdego profilu na urządzeniu — `docs/PROFILE.md`. Dawny adres przekierowuje na nowy; postępy przenosi się plikiem kopii: `docs/PRZENIESIENIE_NA_WIEDZA.md`. Kontrola po wdrożeniu: `docs/RAPORT_KONTROLI.md` §7.
- **Nie wykonano** testu na fizycznym iPhonie 15 (kryterium G05: NOT RUN), w tym aktualizacji do V15 z ikony w prawdziwym Safari iOS.

## Stan puli pytań

Dane: wyłącznie bank V15 w `public/data/`, bajt w bajt z paczki redakcji (nie edytować; build i `check-dist` sprawdzają SHA-256):

| Plik | Zawartość |
|---|---|
| `bank-37f3980a1129.json` | 2987 pytań w 2501 rodzinach. Dziedziny: ANAT 535, INJ 318, SKIN 621, THER 285, DEV 901, SAFE 327. Poziomy: łatwy 1048, średni 1366, trudny 573. 2 pytania ze schematem (ANAT-Q001, DEV-Q041) |
| `retired-question-ids-83b36ff80986.json` | 133 ID wyłączone z aktywnej puli, nieużywane w żadnym trybie |
| `training-profile-c0edd4ca07c2.json` | profil treningowy całego zakresu: skóra 35%, anatomia twarzy 25%, pozostałe 40% (według list ID, metoda największych reszt; DECYZJE §6a, §7a) |

Wersję i sumy kontrolne aplikacja bierze z `src/domain/contentRelease.ts`. Szczegóły: `docs/RAPORT_PULI.md`, manifest: `docs/MANIFEST_PULI.json`.

- Próg 2000 pytań jest spełniony. **Minimum 1000 pytań na poziom nie jest spełnione dla poziomu trudnego (573).**
- Status materiału z banku: „Istniejący bank po redakcji pod praktyczny test. Bez nowego researchu. Zmiany redakcyjne nie są nowym zatwierdzeniem klinicznym.” Status treści: 1322 pytania `independently_checked_draft` i 1665 `editorially_revised_draft`. Wszystkie mają `draft_pending_clinical_review`, `clinical_signoff = false` i 0 recenzji lekarskich.
- Import dodatkowych pul pytań jest **wyłączony**. Ekrany „O bazie” i Ustawienia pokazują liczby z banku V15 (pytania, rodziny, dziedziny, poziomy, wyłączone, profil) oraz status materiału.

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
npx vitest run --maxWorkers=2                   # Vitest: domain, persistence (w tym migracja V15), app (rzeczywisty kontroler + fake-indexeddb), pwa, ui (jsdom), docs (raport kontroli vs bank V15)
npm run test:e2e -- --workers=1                 # Playwright: build pod / + WebKit „iPhone 15” i Chromium mobile (w tym aktualizacja ze starej aplikacji z tagu v0.1.0-pages)
E2E_SKIP_BUILD=1 npx playwright test --workers=1 tests/e2e/schematy.spec.ts   # pojedynczy zestaw na istniejącym dist
node scripts/check-offline.mjs --base /                 # Service Worker w Chromium i WebKit (po buildzie)
```

Na obciążonej maszynie uruchamiaj testy sekwencyjnie (`--maxWorkers=2`, `--workers=1`). Testy e2e nie zastępują testu na fizycznym iPhonie.

## Build

```bash
BASE_PATH=/ npm run build                 # typecheck + vite build → dist/ (SW, manifest, precache)
node scripts/check-dist.mjs --base /      # kontrola dist: treść V15 (SHA-256, wersja, liczby, brak data/bank.json), precache, manifest, brak hostów zewnętrznych i mocka
```

`BASE_PATH` musi odpowiadać nazwie repozytorium na GitHub Pages (`/<repozytorium>/`); workflow `.github/workflows/pages.yml` liczy go automatycznie.

## Kopia danych — ważne

Dane nauki istnieją tylko na tym urządzeniu. Usunięcie danych witryny w Safari, usunięcie aplikacji z ekranu głównego albo zmiana telefonu bez kopii oznacza ich utratę. Zapisuj regularnie kopię: **Ustawienia → Kopia danych → Zapisz kopię**, a potem sprawdź, czy plik `dme-kopia-RRRR-MM-DD.json` zapisał się w aplikacji Pliki (folder Pobrane) — aplikacja przygotowuje plik, ale nie może potwierdzić, że zapis się udał. Kopia zawiera wyniki, sesje (z treścią pytań banku V15 do przeglądu odpowiedzi), stan powtórek i wykluczone pytania. Nie zawiera wbudowanej puli, zaimportowanych pul ani danych pacjentów. Sesje sprzed V15 trafiają do kopii tylko jako podsumowania. Wczytanie kopii zastępuje dane na urządzeniu, ale wcześniej zapisuje automatyczną kopię bezpieczeństwa. Starsza kopia (sprzed V15) wczytuje się bez treści pytań: zostają same podsumowania, otwarte sesje stają się przerwane, a pule są odrzucane.

## Dokumentacja

- `STAN.md` — stan projektu w skrócie; `CLAUDE.md` — zasady pracy dla Claude Code.
- `docs/INSTALACJA_IPHONE.md` — dodanie do ekranu głównego, pierwsze uruchomienie, praca offline, kopia danych.
- `docs/WDROZENIE.md` — GitHub Pages, PWA i Service Worker, kroki publikacji (wykonanej 23.10.2026).
- `docs/RAPORT_KONTROLI.md` — raport końcowy kontroli: build, wyniki testów ze środowiskiem, pula, status recenzji treści, testy niewykonane (G05), wdrożenie (adres i kontrola po wdrożeniu), macierz A01–G07.
- `docs/MIGRACJA_V15.md` — przejście na bank V15: co usunięto, co zachowano, jak działa na iPhonie, instrukcja aktualizacji.
- `docs/RAPORT_PULI.md` — stan i rozkład puli V15, profil, porównanie z poprzednią pulą, ograniczenia.
- `docs/MANIFEST_PULI.json` — manifest puli (liczby, sumy kontrolne).
- `docs/DECYZJE_ARCHITEKTURY.md` — wiążące decyzje i polityki doboru (wersjonowane; V15: §6a, §7a, §10a, §14).
- `docs/ARCHITEKTURA_APP.md` — moduły, kontrakty, komendy, zasady i pokrycie testów, znane kwestie.
- `docs/PLAN_REALIZACJI.md` — plan etapów; `docs/zrzuty/` — zrzuty ekranów z testów e2e (WebKit 393×852).
