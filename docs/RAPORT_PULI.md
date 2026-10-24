# Raport puli pytań — Doktor Monika Egzamin

Wersja banku: `chatgpt-editorial-v15-2026-10-24-f020a0440df8` · `built_on` 2026-10-24 · runtime: `public/data/bank-37f3980a1129.json` (SHA-256 `37f3980a1129f782213553360ba0221fbe9281f4710d31f86dfdea2a488f0770`). Liczby w tym raporcie policzono z plików w repozytorium (24.10.2026). Manifest z sumami kontrolnymi: `docs/MANIFEST_PULI.json`.

## 1. Stan w jednym akapicie

Aplikacja udostępnia **wyłącznie bank V15**: **2987 pytań** w **2501 rodzinach**, w 6 dziedzinach i na 3 poziomach (1048 łatwych, 1366 średnich, 573 trudne). Dodatkowe **133 ID** są wyłączone z aktywnej puli (`retired-question-ids-83b36ff80986.json`) i nie pojawiają się w żadnym trybie; żadne z nich nie występuje w pliku banku. Bank przygotowała redakcja poza aplikacją. Aplikacja go nie zmienia: klucze, poziomy, źródła, figury i metadane są takie jak w paczce. Status materiału z banku: `status_pl` „Istniejący bank po redakcji pod praktyczny test. Bez nowego researchu. Zmiany redakcyjne nie są nowym zatwierdzeniem klinicznym.” Wszystkie pytania mają `review_status = draft_pending_clinical_review` i `approved_for_question_key = false`, a `clinical_signoff` jest false. To nie jest oficjalny bank PTMEiAA ani prognoza wyniku egzaminu. Poprzednia pula `release-2026-10-23c` (1097 pytań) została usunięta z aplikacji (`docs/MIGRACJA_V15.md`).

## 2. Kryteria liczebności

- Próg 2000 pytań: **spełniony** (2987).
- Minimum 1000 pytań na każdy poziom: **niespełnione dla poziomu trudnego** (advanced 573 < 1000; basic 1048 i intermediate 1366 spełniają). Aplikacja nie dopisuje ani nie przekwalifikowuje pytań. Poziomy są redakcyjne, bez kalibracji empirycznej (`pool_note_pl`).

## 3. Rozkład

| Dziedzina | łatwy | średni | trudny | razem | rodziny |
|---|---|---|---|---|---|
| ANAT (anatomia) | 226 | 203 | 106 | 535 | 449 |
| INJ (iniekcje) | 144 | 123 | 51 | 318 | 256 |
| SKIN (skóra i dermatologia) | 190 | 303 | 128 | 621 | 529 |
| THER (pozostałe terapie) | 113 | 123 | 49 | 285 | 234 |
| DEV (urządzenia) | 260 | 476 | 165 | 901 | 790 |
| SAFE (bezpieczeństwo i prawo) | 115 | 138 | 74 | 327 | 263 |
| **razem** | **1048** | **1366** | **573** | **2987** | **2501** |

Pojemność Testu (rodziny po filtrach) opisuje `docs/RODZINY_I_POJEMNOSC.md`. Najmniejszy koszyk domena × poziom to INJ/trudny z 45 rodzinami.

## 4. Profil treningowy

`training-profile-c0edd4ca07c2.json` dzieli wszystkie 2987 pytań na grupy według list ID: `skin` 993, `facial_anatomy` 486, `other` 1508. Udziały w całym zakresie to 35% / 25% / 40% (Test i Free Flow; DECYZJE §6a, §7a). Plik deklaruje `editorial_training_mix_not_official_exam_blueprint = true`, więc to redakcyjna proporcja treningu, nie rozkład egzaminu. Rozkład grup według poziomu:

| Grupa | łatwy | średni | trudny |
|---|---|---|---|
| skin | 289 | 481 | 223 |
| facial_anatomy | 188 | 185 | 113 |
| other | 571 | 700 | 237 |

W grupie facial_anatomy na poziomie trudnym jest 93 rodzin. Test z samych pytań trudnych powyżej ok. 370 pozycji przesuwa część miejsc tej grupy na pozostałe grupy i zapisuje przesunięcie.

## 5. Status treści

| Pole | Wartość |
|---|---|
| `content_check_status: independently_checked_draft` | 1322 |
| `content_check_status: editorially_revised_draft` | 1665 |
| `review_status: draft_pending_clinical_review` | 2987 |
| `approved_for_question_key: true` | 0 |
| `clinical_signoff` / `official_exam_question_bank` | false / false |
| pytania ze schematem | 2 (ANAT-Q001, DEV-Q041; figury FIG-ANAT-01-P/-O, FIG-DEV-01-P/-O) |
| źródła w rejestrze / tematy | 887 / 194 |

## 6. Względem poprzedniej puli

Porównanie przygotował `scripts/v15-carryover.mjs` na prywatnej kopii poprzedniego banku. W repozytorium zapisano wyłącznie ID, rewizje i fingerprinty (`src/persistence/v15Carryover.ts`). Wyniki:

- 1001 ID występuje w obu bankach;
- 332 z nich ma identyczną treść (fingerprint, rewizja, klucz, wyjaśnienie) i tylko dla nich migracja zachowuje stan powtórek i blokady;
- 669 ID ma zmienioną wersję pod tym samym ID;
- 96 dawnych ID jest na liście wyłączonych.

## 7. Otwarte ograniczenia

- Brak recenzji lekarskiej kluczy (wszystkie robocze).
- Poziom trudny ma mniej niż 1000 pytań (573).
- Status redakcyjny (`editorially_revised_draft`) nie oznacza nowego zatwierdzenia klinicznego (`status_pl`).
