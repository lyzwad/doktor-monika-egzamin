/**
 * JEDYNA dopuszczona wersja treści: bank V18 — komplet 700 pytań (600 V16 + 100 V17), docs/MIGRACJA_V18.md.
 *
 * Aplikacja udostępnia wyłącznie ten bank: pliki są wersjonowane w nazwie (`data/bank-<sha12>.json`),
 * kontroler sprawdza SHA-256 pliku, `bank_version`, liczby oraz zgodność katalogu z allowlistą paczki
 * (src/persistence/v18Allowlist.ts). Wcześniejsze pliki banków (V15 i starsze) nie istnieją w buildzie
 * (pilnują tego scripts/check-dist.mjs, Service Worker i testy).
 * Czyste dane — bez zależności od DOM/Node (warstwa domeny).
 */

export const CONTENT_RELEASE = Object.freeze({
  /** `bank_version` z bank.json, retired_question_ids.json, training_profile.json i allowed_question_ids.json. */
  bankVersion: 'chatgpt-combined-v18-2026-11-09-1fb7f7546332',
  /** SHA-256 pliku bank.json (bajt w bajt jak w paczce redakcji, MANIFEST.json). */
  bankSha256: '5db40505308f0183ed85d5be4b2e9f8c3871d091f6ec7413f5518c88b39966f6',
  retiredSha256: '54a05ea912817442599f73691efaf83b259df3383ea0e9b6d4fdd1148f26905e',
  profileSha256: '2bdad504f50ec265c203e440c72aeebc06f5f94c9eba7f65198dae85594738e9',
  /** SHA-256 allowlisty paczki (content/v18/allowed_question_ids.json → src/persistence/v18Allowlist.ts). */
  allowedSha256: '982cf1cf97b14c711b864833153f26a79866a036208b97f50e90f00bfce8a64b',
  /** Ścieżki względem `base` (nazwy z prefiksem sumy kontrolnej — nowa ścieżka przy każdej wersji treści). */
  bankFile: 'data/bank-5db40505308f.json',
  retiredFile: 'data/retired-question-ids-54a05ea91281.json',
  profileFile: 'data/training-profile-2bdad504f50e.json',
  counts: Object.freeze({
    questions: 700,
    basic: 400,
    intermediate: 200,
    advanced: 100,
    retired: 3120,
  }),
});

export type ContentRelease = typeof CONTENT_RELEASE;

/** Krótka nazwa wersji treści do komunikatów („bank V18”). */
export const CONTENT_RELEASE_LABEL = 'V18';
