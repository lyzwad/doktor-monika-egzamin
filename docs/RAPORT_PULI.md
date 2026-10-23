# Raport puli pytań — Doktor Monika Egzamin

Wersja banku: `release-2026-10-23c` · data: 2026-10-23 · runtime: `public/data/bank.json` (SHA-256 `ae49224b3ad50494…`).

## 1. Stan w jednym akapicie

Pula zawiera **1097 pytań** (245 z dostarczonego seedbanku + 852 nowych), **810 rodzin** w banku (806 w runtime po scaleniu bliskich wariantów seedu). Cel paczki 2000–3000 **nie został osiągnięty** — brakuje 903 pytań do dolnej granicy. Etap rozbudowy puli pozostaje nieukończony. Pytania są autorskim materiałem treningowym w wersji roboczej: `clinical_signoff=false`, `approved_for_question_key=false` dla wszystkich; nowe pytania przeszły odrębny przegląd AI (`independent_ai_review`), nie recenzję lekarską. To nie jest oficjalny bank PTMEiAA ani prognoza wyniku egzaminu.

## 2. Dlaczego mniej niż 2000

- Zamknięty materiał to ok. 219 tys. znaków medycznych sekcji raportu (215 sekcji) + 121 kart tematów + 139 tez; nie pozyskano pełnych tekstów 17 podręczników (rejestr źródeł).
- Formalnie da się ugruntować ok. 77% tekstu raportu (źródło akapitu musi należeć do aktywnej tezy/tematu — wymóg walidatora).
- Seedbank (248 pytań) powstał z tego samego materiału i sprawdza już główne rozstrzygnięcia; autorzy partii raportowali pominięcie tez sprawdzanych przez seed lub pozbawionych ugruntowania.
- Pierwszy przebieg: 812 wygenerowanych → 729 przyjętych; drugi przebieg (tylko nowe rozstrzygnięcia i scenariusze łączące sekcje): 227 → 164. Autorzy drugiego przebiegu zgodnie wskazali wyczerpanie materiału.
- Zwiększenie liczby wymagałoby parafraz, permutacji lub dopowiadania faktów — zakazanych przez paczkę. Dalsza rozbudowa wymaga nowych, odczytanych źródeł (np. pełnych rozdziałów podręczników z bibliografii regulaminu).

## 2a. Uzgodnienie liczebności (po identyfikatorach)

`248 − 3 + 729 + 164 − 41 = 1097` → bank 1097, runtime 1097 (zgodne: tak).

- Usunięte z puli: kwarantanna seed po ślepym przeglądzie: ANAT-Q022, DEV-Q030, SAFE-Q022; deduplikacja: 41 pytań (lista w MANIFEST_PULI.json).
- Zmiany rewizji (bez usuwania): ANAT-Q001, DEV-Q041 (rev. 2 — pytania ze schematem; rev. 1 w archiwum redakcji).
- Zmiany rodzin (bez usuwania pytań): grupy z deduplikacji 227, podziały po przeglądzie rodzin 72 (198 pytań z nową rodziną), aktywne scalenia rodzin seed tylko w runtime 4.
- Wcześniej raportowane „168” przyjętych w drugim przebiegu było błędem rachunkowym w komunikacie; po identyfikatorach jest 164. Deduplikacja potwierdziła 44 decyzje dla 42 identyfikatorów (2 ID potwierdzone dwukrotnie); po korekcie par wzajemnych usuniętych jest 41 (DEV-P28-002 przywrócone).

## 2b. Kontrola pytań startowych (seed)

Ślepy przegląd AI wszystkich 248 pytań seed: {'verified': 173, 'verified_with_note': 72, 'quarantine': 3}. Do kwarantanny: ANAT-Q022, DEV-Q030, SAFE-Q022. Pozostałe mają klucz i wsparcie w materiale potwierdzone przez AI (z uwagami redakcyjnymi przy części), nie recenzję lekarską.

## 3. Rozkład

| Domena | basic | intermediate | advanced | razem |
|---|---|---|---|---|
| Anatomia (ANAT) | 37 | 65 | 22 | 124 |
| Iniekcje (INJ) | 43 | 76 | 22 | 141 |
| Skóra i dermatologia (SKIN) | 48 | 111 | 23 | 182 |
| Pozostałe terapie (THER) | 47 | 75 | 33 | 155 |
| Urządzenia (DEV) | 86 | 178 | 53 | 317 |
| Bezpieczeństwo i prawo (SAFE) | 45 | 91 | 42 | 178 |
| **Razem** | 306 | 596 | 195 | **1097** |

Poziomy są autorskie (basic: jedna przesłanka; intermediate: ≥ 2; advanced: złożone różnicowanie), nie kalibracją egzaminu. Udział DEV wynika z obszerności materiału urządzeniowego, nie z rozkładu komisji.

## 4. Pokrycie kompetencji

- Tematy kliniczne (121): każdy ma co najmniej jedno pytanie; tematy bez pytań: 0.
- Tezy (139): 126 użyto jako ugruntowanie nowych pytań; nieużyte: DEVICE_SAFETY.02, DEVICE_SAFETY.03, DOSIMETRY.03, DOSIMETRY.05, DOSIMETRY.09, FAT.01, FAT.04, LAW.02, LAW.03, LAW.04, OPTICS.09, SCLER.01, SCLER.03.
- Sekcje raportu pominięte z uzasadnieniem (organizacja egzaminu, plan nauki, marki, metadane): 14.
- Pokrycie listy tematów nie jest pokryciem niejawnego banku egzaminacyjnego.

## 5. Źródła i zakres dostępu

Pytania powołują się na 217 źródeł rejestru. Zakres odczytu wg rejestru (nie podnoszony): selected_full_text: 62, indexed_extract: 54, abstract: 53, full_text: 20, indexed_abstract: 14, indexed_abstract_partial: 5, full_text_relevant_sections: 3, fragment_read: 2, metadata_and_plain_summary: 1, indexed_text: 1, abstract_partial: 1, indexed_selected_text: 1.
Zablokowane jako podstawa klucza (R21, R23, R24, R25, R68, D07, D08, D22, D23), rekordy nieodczytane i same rekordy urzędowe nie są używane w nowych pytaniach (sprawdza to skrypt partii i walidator). Ostrzeżenia walidatora: {'MANUFACTURER_SCOPE': 12} — źródła producenta wymagające oceny zakresu konkretnego produktu.

## 6. Proces i kontrole

- Partie: 31 (pierwszy przebieg) + 31 (drugi); każda: autor → kontrola strukturalna → recenzent w innym kontekście (rozwiązanie bez klucza, potem odsłonięcie skryptem i ocena) → ponowne ślepe sprawdzenie poprawek. Przyjęte nowe pytania: 852 (w tym po poprawce i ponownym sprawdzeniu: 161); przyjętych z niezgodną odpowiedzią ślepą: 0.
- Kwarantanna w przeglądzie: 146 ({'OUT_OF_SCOPE': 2, 'DUPLICATE_PARAPHRASE': 123, 'WEAK_DISTRACTORS': 11, 'UNGROUNDED': 9, 'OTHER': 1}). Kwarantanna deduplikacji: 41.
- Audyt ślepoty (transkrypty 111 agentów recenzji): odwołań do pliku z kluczem przed odsłonięciem: 0.
- Deduplikacja semantyczna całej puli: filtr leksykalny + ocena par + przegląd list domen; każda propozycja usunięcia zweryfikowana przez odrębnego agenta. Grupy rodzin z nowymi pytaniami: 227; bliskie warianty seedu scalone wyłącznie w runtime: 14.
- Walidator paczki: tryb seed PASS; self-test PASS (20 przypadków); tryb `--release` **FAIL** z błędem ['RELEASE_COUNT'] (liczba < 2000) — pozostałe bramki release (6 domen, 3 poziomy, schematy ANAT i DEV, proweniencja, źródła, figury) bez błędów.
- PASS walidatora jest kontrolą struktury i deklarowanej proweniencji, nie podpisem klinicznym ani dowodem odczytu wszystkich źródeł.

## 7. Schematy

Figury: FIG-ANAT-01-O, FIG-ANAT-01-P, FIG-DEV-01-O, FIG-DEV-01-P; pytania ze schematem: ANAT-Q001, DEV-Q041 (rewizja 2; rewizja 1 zachowana w archiwum redakcji). Wzorce z Claude Design skorygowano do zakresu materiału (np. „powięź głęboka” zamiast „okostna lub powięź głęboka”), wersja pytania bez etykiet zdradzających klucz, wersja objaśnienia po odpowiedzi; SVG bez skryptów i zasobów zewnętrznych. Status: `independently_checked_draft` (kontrola AI), bez recenzji klinicznej. Pozostałe 10 figur z planu nie powstało.

## 8. Otwarte ograniczenia

- Brak recenzji lekarskiej kluczy; klucze robocze. Przegląd AI może przeoczyć błąd merytoryczny.
- Pula < 2000; Test w zakresie jednej domeny ma pojemność równą liczbie rodzin tej domeny w runtime.
- Część źródeł odczytano tylko jako abstrakt lub fragmenty — pytania nie wychodzą poza ten zakres, ale materiał bywa wąski.
- Kwarantanna i odrzucone pozycje pozostają w prywatnym katalogu redakcji, poza runtime i repozytorium.
