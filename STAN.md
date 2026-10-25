# Stan projektu: Doktor Monika Egzamin

_Ostatnia aktualizacja: 2026-10-25_

## W skrócie

Aplikacja działa na produkcji pod adresem https://wiedza.doktormonika.pl/
(GitHub Pages). Udostępnia bank pytań V15 (2987 pytań) i 9 profili lokalnych
bez hasła — każdy profil ma osobne postępy na urządzeniu.

## Co działa

- Tryby **Test** i **Free Flow**, przegląd błędów, powtórki, kopia danych do pliku.
- Praca offline jako PWA na iPhonie.
- Testy na czystym klonie w warsztacie (25.10.2026): typecheck PASS, Vitest 640/640.

## W toku

- Gałąź `v0.2-konta` (konta Supabase, backend Cloudflare Worker + D1) — odłożona;
  na produkcji nie jest używana. Do 25.10.2026 istniała tylko na dysku, w starym
  folderze `~/Doktor-Monika-Egzamin/doktor-monika-egzamin`.

## Następne kroki

1. Poziom trudny ma 573 pytania — do celu 1000 brakuje 427 (pytania dostarcza właściciel).
2. Test na fizycznym iPhonie (kryterium G05) — nie wykonany.
3. Decyzja właściciela, co z gałęzią `v0.2-konta` i materiałami redakcyjnymi
   (`_zrodla`, `redakcja`, `_archiwum`, `ODDANIE`) w `~/Doktor-Monika-Egzamin/`.

## Decyzje

| Data | Decyzja | Dlaczego |
|---|---|---|
| 2026-10-24 | Tylko bank V15, poprzednia pula usunięta | `docs/MIGRACJA_V15.md` |
| 2026-10-25 | Produkcja pod wiedza.doktormonika.pl, bez Supabase/Workers/D1 | `docs/DECYZJE_ARCHITEKTURY.md` §15 |
| 2026-10-25 | Projekt przeniesiony do warsztatu (`apps/doktor-monika-egzamin`) | jedna czysta kopia zamiast rozrzuconych folderów |
| 2026-10-25 | BMAD Method 6.12.4 w projekcie (`_bmad/`, `.claude/skills/bmad-*`), praca w TDD | reguła warsztatu: `docs/metoda-pracy.md` |

Szczegółowa historia wcześniejszych etapów: `README.md` (sekcja „Stan”) i `docs/RAPORT_KONTROLI.md`.
