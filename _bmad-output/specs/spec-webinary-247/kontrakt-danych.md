# Kontrakt danych — wydanie „V18 + webinary”

Wspólny dla wszystkich historii. Zmiana pola = zmiana tego pliku przez lidera.

## Wejścia (w repo, nie w `public/`)

| Plik | Rola |
|---|---|
| `content/v18/bank.json` | bank V18 bajt w bajt (SHA-256 `5db40505308f0183ed85d5be4b2e9f8c3871d091f6ec7413f5518c88b39966f6`), baza scalania |
| `content/v18/allowed_question_ids.json` | allowlista V18 (700) — bez zmian |
| `content/webinary-2026-11-15/bank_webinar_addendum.json` | dodatek, SHA-256 `ae7a7321f163a5c7bb4fd06529921a4ef5e8c12e2df2c7c52600a37f08aed40c` |
| `content/webinary-2026-11-15/MANIFEST.json` | 247 `active_ids`, `bank_sha256`, `mode: append` |
| `content/webinary-2026-11-15/Wykluczone_powtorzenia.json` | 3 ID wykluczone przez redakcję (nie ma ich w dodatku) — tylko do raportu |

Obecne pliki V18 w `public/data/` (`profile`, `retired`) są wejściem dla profilu i retired.

## Wyjścia (generuje skrypt, deterministycznie)

- `content/v18-webinary/allowed_question_ids.json` — `{ bank_version, mode: "v18_plus_webinar_addendum", components: {V18: 700, WB: 247}, ids: [700 ID V18 w kolejności V18, potem 247 ID WB w kolejności dodatku] }`.
- `public/data/bank-<sha12>.json` — scalony `dme-runtime-bank` 1.0 (opis niżej).
- `public/data/retired-question-ids-<sha12>.json` — te same 3120 ID co V18, nowa `bank_version`.
- `public/data/training-profile-<sha12>.json` — wagi i przykłady jak V18; grupy V18 + WB wg działu (`SKIN`→`skin`, `ANAT`→`facial_anatomy`, pozostałe→`other`); `rules_pl` z liczbą 947 zamiast 700.
- `src/persistence/v18Allowlist.ts` (nazwa pliku bez zmian albo zmieniona spójnie w całym kodzie) — 947 wierszy `[id, revision, fingerprint, correct_option_id, family_id, domain_id]`.
- Pliki V18 (`bank-5db40505308f.json`, `retired-…54a05ea91281.json`, `training-profile-2bdad504f50e.json`) znikają z `public/data/`.

`bank_version` wydania: `dme-v18-webinary-2026-11-15-<h12>`, gdzie `h12` = pierwsze 12 znaków hex SHA-256 z tekstu `"<sha banku V18>+<sha dodatku>"`. `built_on`: `2026-11-15`.

## Scalony bank

- Pola najwyższego poziomu jak V18; `questions` = 700 rekordów V18 (kolejność i obiekty bez zmian) + 247 WB (kolejność dodatku).
- `counts`: `questions` 947, `families` 939, `by_domain`, `by_difficulty` (przeliczone), `schematic` 0, `independently_checked_draft` 600, `author_checked_draft` 100, `source_checked_AI_draft` 247.
- `status_pl`, `pool_note_pl`: zdania V18 + informacja, że 247 pytań pochodzi z transkrypcji webinarów (napisy automatyczne), klucz sprawdzony przez AI względem transkrypcji, bez recenzji klinicznej.
- `addenda`: `[{ format: "dme-webinar-addendum", bank_version: "<z dodatku>", sha256: "<sha dodatku>", count: 247, id_prefix: "WB-" }]`.
- `sources`: 391 źródeł V18 + `W01`…`W17`.
- `topics`: tematy V18 + jeden temat na parę (webinar, dział) obecną w dodatku: `id` `WB-T-<Wxx>-<DOMENA>`, `title_pl` = tytuł webinaru, `domain_id`, `learning_objective_pl: null`, `clinical_pearls_pl: []`.

### Źródło webinaru (`sources.Wxx`)

`{ id, title, url: null, doi: null, pmid: null, kind: "user_supplied_webinar_transcript", kind_pl: "transkrypcja webinaru", access: "source_unit", access_pl: "fragmenty automatycznych napisów", checked_on: null, filename, sha256, locator_type: "source_unit", audio_verified: false }` — `title`, `filename`, `sha256` z dodatku.

### Pytanie WB (rekord runtime)

Z dodatku bez zmian: `id`, `domain_id`, `stem_pl`, `options`, `correct_option_id`, `correct_explanation_pl`, `source_ids`, `revision`, `family_id`, `difficulty`, `difficulty_is_technical_placeholder`, `question_type`, `evidence_quote`, `evidence_unit_ids`, `source_note_pl`, `source_id`, `subdomain` (gdy jest), `clinical_signoff: false`.
Dodane przez adapter: `origin: "webinar"`, `topic_ids: ["WB-T-<source_id>-<domain_id>"]`, `figure_id: null`, `explanation_figure_id: null`, `review_status: "draft_pending_clinical_review"`, `approved_for_question_key: false`, `content_check_status: "source_checked_AI_draft"`, `cognitive_level: null`, `fingerprint` (algorytm aplikacji z `src/domain/fingerprint.ts`), `source_locator_pl` w formacie `"W13: W13-U0022, W13-U0029; W16: W16-U0010"` (grupy wg prefiksu źródła, kolejność `source_ids`, ID fragmentów w kolejności z dodatku).

## Typy aplikacji (src/domain/types.ts)

- `RuntimeSource`: opcjonalne `filename?: string`, `sha256?: string`, `locator_type?: string`, `audio_verified?: boolean`.
- `RuntimeQuestion`: opcjonalne `origin?: 'webinar'`, `evidence_quote?: string`, `evidence_unit_ids?: string[]`, `source_note_pl?: string`.
- `CatalogSource`: `fileName: string | null`, `webinar: boolean` (kind = `user_supplied_webinar_transcript`).
- `CatalogQuestion`: `webinarEvidence: { quote: string; unitIds: string[]; note: string } | null`.
- `SnapshotSource`: opcjonalne `fileName?: string | null`, `webinar?: boolean`.
- `QuestionSnapshot`: opcjonalne `webinarEvidence?: { quote: string; unitIds: string[]; note: string } | null` (stare snapshoty bez pola = `null`).
- Walidacja katalogu: pytanie WB wymaga niepustego `evidence_quote`, ≥ 1 `evidence_unit_ids` w formacie `W\d\d-U\d{4}` z prefiksem jednego z `source_ids`, źródła webinaru z `url: null`.

## Dane użytkownika (IndexedDB, kopia)

- `DB_SCHEMA_VERSION` 5; migracja v5 = ta sama transformacja co v4 z allowlistą 947 i nową `bankVersion`.
- Sesja z `bankVersion` V18 (`chatgpt-combined-v18-2026-11-09-1fb7f7546332`), której wszystkie snapshoty są zgodne (lub która nie ma slotów) → aktywna, `bankVersion` sesji i snapshotów = nowa wersja.
- Kopia (eksport/import) zachowuje nowe opcjonalne pola snapshotu.
