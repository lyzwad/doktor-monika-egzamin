#!/usr/bin/env node
/**
 * Lista pytań NIEZMIENIONYCH między wdrożonym bankiem a bankiem V15 (migracja danych lokalnych,
 * docs/MIGRACJA_V15.md). Wynik: `src/persistence/v15Carryover.ts` — WYŁĄCZNIE identyfikatory, rewizje
 * i fingerprinty (SHA-256), bez treści pytań.
 *
 * Kryterium „niezmienione”: to samo `id` w obu bankach i identyczne `fingerprint`, `revision`,
 * `correct_option_id` oraz `correct_explanation_pl`.
 *
 * Użycie (pliki banków są prywatne i nie trafiają do repozytorium):
 *   node scripts/v15-carryover.mjs <stary-bank.json> <bank-v15.json> [plik-wyjściowy.ts]
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const [oldPath, newPath, outArg] = process.argv.slice(2);
if (!oldPath || !newPath) {
  console.error('Użycie: node scripts/v15-carryover.mjs <stary-bank.json> <bank-v15.json> [wyjście.ts]');
  process.exit(2);
}
const out = resolve(outArg ?? 'src/persistence/v15Carryover.ts');
const oldRaw = readFileSync(oldPath);
const newRaw = readFileSync(newPath);
const oldBank = JSON.parse(oldRaw.toString('utf-8'));
const newBank = JSON.parse(newRaw.toString('utf-8'));
const sha = (buf) => createHash('sha256').update(buf).digest('hex');

const newById = new Map(newBank.questions.map((q) => [q.id, q]));
const FIELDS = ['fingerprint', 'revision', 'correct_option_id', 'correct_explanation_pl'];
const common = oldBank.questions.filter((q) => newById.has(q.id));
const unchanged = common
  .filter((q) => FIELDS.every((f) => q[f] === newById.get(q.id)[f]))
  .map((q) => [q.id, q.revision, q.fingerprint])
  .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));

const lines = [
  '/**',
  ' * WYGENEROWANE przez scripts/v15-carryover.mjs — nie edytować ręcznie.',
  ' *',
  ' * Pytania niezmienione między bankiem wdrożonym przed V15 a bankiem V15 (to samo `id`, identyczne',
  ' * `fingerprint`, `revision`, `correct_option_id`, `correct_explanation_pl`). Tylko identyfikatory,',
  ' * rewizje i fingerprinty — bez treści. Migracja danych lokalnych zachowuje stan powtórek i blokady',
  ' * wyłącznie dla tych rekordów (docs/MIGRACJA_V15.md).',
  ' */',
  '',
  `/** Wersja banku sprzed V15 (SHA-256 pliku: ${sha(oldRaw)}). */`,
  `export const PRE_V15_BANK_VERSION = ${JSON.stringify(oldBank.bank_version)};`,
  `/** Bank V15, z którym porównano (SHA-256 pliku: ${sha(newRaw)}). */`,
  `export const V15_COMPARED_BANK_VERSION = ${JSON.stringify(newBank.bank_version)};`,
  '',
  '/** Statystyka porównania (do raportu migracji). */',
  `export const V15_COMPARISON = ${JSON.stringify({ oldQuestions: oldBank.questions.length, newQuestions: newBank.questions.length, commonIds: common.length, unchanged: unchanged.length, changedSameId: common.length - unchanged.length })} as const;`,
  '',
  '/** [id, rewizja, fingerprint] — posortowane po id. */',
  'export const V15_UNCHANGED: readonly (readonly [string, number, string])[] = [',
  ...unchanged.map((t) => `  ${JSON.stringify(t)},`),
  '];',
  '',
];
writeFileSync(out, lines.join('\n'));
console.log(`Zapisano ${out}: ${unchanged.length} niezmienionych z ${common.length} wspólnych ID (stary bank: ${oldBank.questions.length}, V15: ${newBank.questions.length}).`);
