# Doktor Monika Egzamin — zasady dla Claude

PWA do nauki pytań jednokrotnego wyboru z medycyny estetycznej: po polsku,
na iPhonie, offline, bez logowania i bez backendu. Dane nauki tylko na urządzeniu
(IndexedDB) i w ręcznie eksportowanej kopii.

Ogólne zasady pracy są w `CLAUDE.md` warsztatu (folder nadrzędny). Tu tylko to,
co dotyczy tej aplikacji.

## Stack

TypeScript (strict), Vite + React, Service Worker (PWA), IndexedDB, Vitest,
Playwright (WebKit „iPhone 15” i Chromium mobile). Hosting: GitHub Pages
z własną domeną https://wiedza.doktormonika.pl/.

Odstępstwo od standardu warsztatu: **npm** (`package-lock.json`), nie pnpm —
projekt powstał przed warsztatem; zmiana menedżera paczek tylko za zgodą właściciela.

## Komendy

| Co | Komenda |
|---|---|
| Instalacja | `npm ci` |
| Uruchomienie lokalne | `npm run dev` (http://localhost:5173/) |
| Testy jednostkowe | `npx vitest run --maxWorkers=2` (albo `npm test`) |
| Testy w przeglądarce | `npm run test:e2e -- --workers=1` |
| Typecheck | `npm run typecheck` |
| Budowanie | `BASE_PATH=/ npm run build`, potem `node scripts/check-dist.mjs --base /` |

Lint: projekt nie ma skryptu `lint`.

## Struktura

- `src/domain/` — silnik nauki (bez DOM), `src/persistence/` — IndexedDB, migracje, kopia danych,
  `src/ui/` — ekrany, `src/pwa/` — Service Worker.
- `public/data/` — bank pytań V15, bajt w bajt z paczki redakcji. **Nie edytować** —
  build i `check-dist` sprawdzają sumy SHA-256 (`src/domain/contentRelease.ts`).
- `docs/` — decyzje (`DECYZJE_ARCHITEKTURY.md`), raport kontroli, wdrożenie, migracje.
- `worker/` — tylko na gałęzi `v0.2-konta` (konta Supabase, Cloudflare Worker + D1);
  ta gałąź nie jest używana na produkcji (decyzja z 25.10.2026, `DECYZJE` §15).

## Decyzje i pułapki

- **Każdy push na `main` publikuje stronę na produkcji** (workflow `pages.yml`).
  Zmiany wysyłaj na osobną gałąź i Pull Request; scalenie do `main` = wdrożenie,
  więc tylko za zgodą właściciela.
- **Repozytorium jest publiczne.** Nie dodawaj materiałów redakcyjnych, źródeł banku
  pytań ani danych osobowych. Materiały robocze leżą poza repo.
- Na obciążonym komputerze testy potrafią przekroczyć limit 5 s — uruchamiaj je
  sekwencyjnie (`--maxWorkers=2`, `--workers=1`) i powtórz pojedynczy test przed
  uznaniem go za błąd.
- Test na fizycznym iPhonie (kryterium G05) nie został wykonany — testy e2e go nie zastępują.
