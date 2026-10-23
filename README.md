# Doktor Monika Egzamin

Osobista aplikacja PWA do nauki pytań jednokrotnego wyboru z medycyny estetycznej — po polsku, na iPhonie, offline, bez logowania i bez backendu. Dwa tryby: **Test** (N pytań z wybranego zakresu, wynik z progiem 65%, przegląd błędów, kolejne rundy „Uwzględnij błędy”) i **Free Flow** (pytania bez limitu, z pierwszeństwem powtórek). Odpowiedzi, sesje, wyniki, stan powtórek i wykluczone pytania są zapisywane wyłącznie na urządzeniu (IndexedDB) i w ręcznie eksportowanej kopii.

Materiał pytań jest **autorskim materiałem treningowym w wersji roboczej**: klucze nie mają recenzji lekarskiej, to **nie jest oficjalny bank pytań PTMEiAA**, a wynik w aplikacji **nie jest oceną komisji egzaminacyjnej** ani prognozą wyniku egzaminu.

## Stan

- Aplikacja zintegrowana (silnik domeny, IndexedDB, ekrany S01–S24 wg Claude Design, Service Worker, rzeczywisty kontroler), przetestowana jednostkowo i e2e (WebKit „iPhone 15” i Chromium mobile) na buildzie pod podścieżką `/doktor-monika-egzamin/`.
- Ostatnia kontrola (23.10.2026, 14:11–14:15, bank `release-2026-10-23c`; macOS 26.5.2, Node 24.18.1, Playwright 1.63.0, load average ok. 4–6 na 8 rdzeniach): typecheck PASS, Vitest 607/607, e2e 83 PASS i 1 SKIP (WebKit `setOffline` — ograniczenie Playwright), `check-dist` 53/53, `check-offline` 54/54. Wersje, środowisko, macierz kryteriów A01–G07 i lista testów niewykonanych: **`docs/RAPORT_KONTROLI.md`**.
- **Gotowość techniczna aplikacji ≠ kryterium treści**: aplikacja przechodzi kontrole techniczne (w emulacji), ale kryterium treści — pula co najmniej 2000 pytań — **nie jest spełnione** (walidator paczki `--release`: FAIL tylko `RELEASE_COUNT`; próg 2000 bez zmian).
- **Nie wdrożono**: aplikacja nie jest opublikowana (brak adresu HTTPS). Kroki publikacji: `docs/WDROZENIE.md`.
- **Nie wykonano** testu na fizycznym iPhonie 15 (kryterium G05 — NOT RUN): Dynamic Type, VoiceOver, tryb samolotowy, zapis kopii w Plikach.

## Stan puli pytań

Dane: `public/data/bank.json` (wersja `release-2026-10-23c`), generowane w redakcji — nie edytować ręcznie. Szczegóły: `docs/RAPORT_PULI.md`, manifest: `docs/MANIFEST_PULI.json`.

- **1097 pytań** (245 z pakietu startowego + 852 nowe; uzgodnienie w `docs/MANIFEST_PULI.json`: 248 − 3 + 729 + 164 − 41 = 1097), **806 rodzin** bliskich wariantów w runtime (810 w banku źródłowym); 6 dziedzin (ANAT 124, INJ 141, SKIN 182, THER 155, DEV 317, SAFE 178), poziomy: łatwy 306, średni 596, trudny 195.
- **Cel 2000–3000 pytań nie został osiągnięty** (brakuje 903 do dolnej granicy) — dostarczony materiał źródłowy nie pozwalał na więcej różnych pytań bez parafraz. Etap rozbudowy puli pozostaje nieukończony.
- Wszystkie 1097 pytań przeszły odrębny, ślepy przegląd AI (`independently_checked_draft`); 3 pytania z pakietu startowego trafiły po nim do kwarantanny i nie ma ich w puli (ANAT-Q022, DEV-Q030, SAFE-Q022). To nie jest recenzja lekarska: 0 recenzji lekarskich, `clinical_signoff = false` dla wszystkich.
- 2 pytania ze schematem (ANAT-Q001, DEV-Q041): wersja pytania bez etykiet zdradzających klucz i wersja objaśniająca po odpowiedzi (`public/figures/*.svg`).
- Pojemność Testu = liczba rodzin w zakresie (cały zakres: 806); aplikacja pokazuje ją jako „różne zadania (rodziny)” obok liczby pytań. Ekrany „O bazie” i Ustawienia pokazują te liczby (policzone z katalogu, zgodne z `bank.counts`), notę o stanie puli i status materiału.

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
npx vitest run --maxWorkers=2                   # Vitest: domain, persistence, app (rzeczywisty kontroler + fake-indexeddb), pwa, ui (jsdom), docs (raport kontroli vs bank)
npm run test:e2e -- --workers=1                 # Playwright: build pod /doktor-monika-egzamin/ + WebKit „iPhone 15” i Chromium mobile
E2E_SKIP_BUILD=1 npx playwright test --workers=1 tests/e2e/schematy.spec.ts   # pojedynczy zestaw na istniejącym dist
node scripts/check-offline.mjs --base /doktor-monika-egzamin/                 # Service Worker w Chromium i WebKit (po buildzie)
```

Na obciążonej maszynie uruchamiaj testy sekwencyjnie (`--maxWorkers=2`, `--workers=1`). Testy e2e nie zastępują testu na fizycznym iPhonie.

## Build

```bash
BASE_PATH=/doktor-monika-egzamin/ npm run build                 # typecheck + vite build → dist/ (SW, manifest, precache)
node scripts/check-dist.mjs --base /doktor-monika-egzamin/      # kontrola dist: precache (także figury z banku), manifest, brak hostów zewnętrznych i mocka
```

`BASE_PATH` musi odpowiadać nazwie repozytorium na GitHub Pages (`/<repozytorium>/`); workflow `.github/workflows/pages.yml` liczy go automatycznie.

## Kopia danych — ważne

Dane nauki istnieją tylko na tym urządzeniu. Usunięcie danych witryny w Safari, usunięcie aplikacji z ekranu głównego albo zmiana telefonu bez kopii oznacza ich utratę. Zapisuj regularnie kopię: **Ustawienia → Kopia danych → Zapisz kopię**, a potem sprawdź, czy plik `dme-kopia-RRRR-MM-DD.json` zapisał się w aplikacji Pliki (folder Pobrane) — aplikacja przygotowuje plik, ale nie może potwierdzić, że zapis się udał. Kopia zawiera wyniki, sesje (z treścią pytań do przeglądu odpowiedzi), stan powtórek, wykluczone pytania i zaimportowane pule; nie zawiera wbudowanej puli ani danych pacjentów. Wczytanie kopii zastępuje dane na urządzeniu, ale wcześniej zapisuje automatyczną kopię bezpieczeństwa.

## Dokumentacja

- `docs/INSTALACJA_IPHONE.md` — dodanie do ekranu głównego, pierwsze uruchomienie, praca offline, kopia danych.
- `docs/WDROZENIE.md` — GitHub Pages, PWA i Service Worker, kroki publikacji (niewykonanej).
- `docs/RAPORT_KONTROLI.md` — raport końcowy kontroli: build, wyniki testów ze środowiskiem, pula, status recenzji treści, testy niewykonane (G05), wdrożenie (brak), macierz A01–G07.
- `docs/RAPORT_PULI.md` — stan i rozkład puli, proces, ograniczenia.
- `docs/MANIFEST_PULI.json` — manifest puli (liczby, sumy kontrolne).
- `docs/DECYZJE_ARCHITEKTURY.md` — wiążące decyzje i polityki doboru (wersjonowane).
- `docs/ARCHITEKTURA_APP.md` — moduły, kontrakty, komendy, zasady i pokrycie testów, znane kwestie.
- `docs/PLAN_REALIZACJI.md` — plan etapów; `docs/zrzuty/` — zrzuty ekranów z testów e2e (WebKit 393×852).
