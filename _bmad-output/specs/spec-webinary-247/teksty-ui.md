# Teksty interfejsu — jedyne nowe lub zmienione napisy

Nie dodawać innych tekstów. Brak pasującego tekstu = pytanie do lidera.

## Wiersz źródła webinaru (ExplanationPanel → SourceRow)

- Tytuł: `title` źródła (tytuł webinaru), podpis: `transkrypcja webinaru · fragmenty automatycznych napisów` (z `kind_pl` i `access_pl`).
- Po rozwinięciu: istniejąca etykieta `Gdzie w źródle: ` + ID fragmentów tego źródła (np. `W13-U0022, W13-U0029`).
- Zamiast „Otwórz publikację”: przycisk `Źródło webinaru` (`aria-expanded`), otwiera panel wewnętrzny:
  - `Plik: ` + `filename`
  - `Fragment automatycznych napisów — może zawierać błędy rozpoznawania mowy`
  - cytat `evidence_quote` (blockquote)
  - `source_note_pl` pytania
  - `Źródło egzaminacyjne z wykładu, nie zweryfikowane aktualne wytyczne.`
- Brak linków, także offline (panel jest lokalny).

## O bazie pytań

- Nowy wiersz tabeli: `Pytania z webinarów` z liczbą pytań o `origin = webinar` (247).
- Liczby pytań i rodzin z katalogu (947, 939); `status_pl` i `pool_note_pl` z pliku banku.

## Dotychczasowe teksty z „V18, 700 pytań” (DataScreens)

- `CONTENT_RELEASE_LABEL` = `V18 + webinary`; w tekstach `(V18, 700 pytań)` → `(V18 + webinary, 947 pytań)`, `banku 700 pytań` → `banku 947 pytań` — liczby z `CONTENT_RELEASE.counts`, nie wpisane na sztywno.
