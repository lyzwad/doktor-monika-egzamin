/**
 * JEDYNA dopuszczona wersja treści: wydanie „V18 + webinary” — 947 pytań = bank V18 bez zmian (700: 600 V16 + 100 V17,
 * docs/MIGRACJA_V18.md) + 247 pytań z transkrypcji webinarów (WB, dodatek `dme-webinar-addendum`,
 * content/webinary-2026-11-15/). Wartości generuje scripts/webinary-addendum.mjs (raport CLI).
 *
 * Aplikacja udostępnia wyłącznie to wydanie: pliki są wersjonowane w nazwie (`data/bank-<sha12>.json`),
 * kontroler sprawdza SHA-256 pliku, `bank_version`, liczby (w tym liczbę pytań WB) oraz zgodność katalogu z allowlistą
 * wydania (content/v18-webinary/allowed_question_ids.json → src/persistence/v18Allowlist.ts). Wcześniejsze pliki banków
 * (V18 `bank-5db40505308f.json` i starsze) nie istnieją w buildzie (pilnują tego scripts/check-dist.mjs, Service Worker
 * i testy). Czyste dane — bez zależności od DOM/Node (warstwa domeny).
 */

export const CONTENT_RELEASE = Object.freeze({
  /** `bank_version` z bank.json, retired_question_ids.json, training_profile.json i allowed_question_ids.json. */
  bankVersion: 'dme-v18-webinary-2026-11-15-8622d52b9a42',
  /** SHA-256 pliku bank.json (wynik scripts/webinary-addendum.mjs, bajtowo powtarzalny). */
  bankSha256: '475c1fef009903f4151cd8234ca279ece879a89b6dabfb86e5e29045f7af171e',
  retiredSha256: '40450ecb4f2bdba293b29a77a7b0093e8781cc40c93095fd316e6fb0e122c5ba',
  profileSha256: 'a8bf8dbe7e3b23ed08e73a99396dcb412d842b9ebceac8d655e3775bbc8c664f',
  /** SHA-256 allowlisty wydania (content/v18-webinary/allowed_question_ids.json → src/persistence/v18Allowlist.ts). */
  allowedSha256: '3af684c4716ad8721d7b4f23328b7a5db08afcc898b669cdcc6266e02d6fd9f5',
  /** Ścieżki względem `base` (nazwy z prefiksem sumy kontrolnej — nowa ścieżka przy każdej wersji treści). */
  bankFile: 'data/bank-475c1fef0099.json',
  retiredFile: 'data/retired-question-ids-40450ecb4f2b.json',
  profileFile: 'data/training-profile-a8bf8dbe7e3b.json',
  counts: Object.freeze({
    questions: 947,
    basic: 647,
    intermediate: 200,
    advanced: 100,
    retired: 3120,
    /** Pytania z transkrypcji webinarów (`origin: webinar`, w katalogu z `webinarEvidence`). */
    webinar: 247,
  }),
});

export type ContentRelease = typeof CONTENT_RELEASE;

/** Krótka nazwa wersji treści do komunikatów („bank V18 + webinary”). */
export const CONTENT_RELEASE_LABEL = 'V18 + webinary';
