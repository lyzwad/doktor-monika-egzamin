/**
 * JEDYNA dopuszczona wersja treści (bank pytań V15) — docs/MIGRACJA_V15.md, DECYZJE §2 i §14.
 *
 * Aplikacja udostępnia wyłącznie ten bank: pliki są wersjonowane w nazwie (`data/bank-<sha12>.json`),
 * kontroler sprawdza SHA-256 pliku, `bank_version` i liczby, a katalog odrzuca każdy rekord spoza V15.
 * Stara ścieżka `data/bank.json` nie istnieje w buildzie (pilnują tego scripts/check-dist.mjs i testy).
 * Czyste dane — bez zależności od DOM/Node (warstwa domeny).
 */

export const CONTENT_RELEASE = Object.freeze({
  /** `bank_version` z bank.json, retired_question_ids.json i training_profile.json. */
  bankVersion: 'chatgpt-editorial-v15-2026-10-24-f020a0440df8',
  /** SHA-256 pliku bank.json (bajt w bajt jak w paczce redakcji). */
  bankSha256: '37f3980a1129f782213553360ba0221fbe9281f4710d31f86dfdea2a488f0770',
  retiredSha256: '83b36ff80986596c73a49fa33646eb817d187d467ea03b4501172617b2ebca6a',
  profileSha256: 'c0edd4ca07c272fd07ed63635116aad433c2e4e9917f284dcb884f28d6d58dbc',
  /** Ścieżki względem `base` (nazwy z prefiksem sumy kontrolnej — nowa ścieżka przy każdej wersji treści). */
  bankFile: 'data/bank-37f3980a1129.json',
  retiredFile: 'data/retired-question-ids-83b36ff80986.json',
  profileFile: 'data/training-profile-c0edd4ca07c2.json',
  counts: Object.freeze({
    questions: 2987,
    basic: 1048,
    intermediate: 1366,
    advanced: 573,
    retired: 133,
  }),
});

export type ContentRelease = typeof CONTENT_RELEASE;

/** Krótka nazwa wersji treści do komunikatów („bank V15”). */
export const CONTENT_RELEASE_LABEL = 'V15';
