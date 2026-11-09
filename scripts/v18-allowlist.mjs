#!/usr/bin/env node
/**
 * Allowlista banku V18 do migracji danych lokalnych i kontroli katalogu (docs/MIGRACJA_V18.md).
 * Wynik: `src/persistence/v18Allowlist.ts` — WYŁĄCZNIE identyfikatory, rewizje, fingerprinty, klucze, rodziny i dziedziny
 * (bez treści).
 *
 * Wejście: allowlista paczki (`content/v18/allowed_question_ids.json`) i bank (`public/data/bank-<sha12>.json`).
 * Skrypt przerywa się, gdy allowlista i bank nie zawierają dokładnie tych samych ID albo wersje się różnią.
 *
 * Użycie: node scripts/v18-allowlist.mjs <allowed_question_ids.json> <bank.json> [wyjście.ts]
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const [allowedPath, bankPath, outArg] = process.argv.slice(2);
if (!allowedPath || !bankPath) {
  console.error('Użycie: node scripts/v18-allowlist.mjs <allowed_question_ids.json> <bank.json> [wyjście.ts]');
  process.exit(2);
}
const out = resolve(outArg ?? 'src/persistence/v18Allowlist.ts');
const allowedRaw = readFileSync(allowedPath);
const bankRaw = readFileSync(bankPath);
const allowed = JSON.parse(allowedRaw.toString('utf-8'));
const bank = JSON.parse(bankRaw.toString('utf-8'));
const sha = (buf) => createHash('sha256').update(buf).digest('hex');

if (allowed.bank_version !== bank.bank_version) throw new Error(`Różne wersje: allowlista ${allowed.bank_version}, bank ${bank.bank_version}`);
const ids = [...allowed.ids].sort();
if (new Set(ids).size !== ids.length) throw new Error('Allowlista zawiera powtórzone ID');
const byId = new Map(bank.questions.map((q) => [q.id, q]));
const missing = ids.filter((id) => !byId.has(id));
const extra = bank.questions.map((q) => q.id).filter((id) => !allowed.ids.includes(id));
if (missing.length || extra.length) throw new Error(`Bank ≠ allowlista: brak ${missing.join(',')} nadmiar ${extra.join(',')}`);

const rows = ids.map((id) => {
  const q = byId.get(id);
  return [id, q.revision, q.fingerprint, q.correct_option_id, q.family_id, q.domain_id];
});

const lines = [
  '/**',
  ' * WYGENEROWANE przez scripts/v18-allowlist.mjs — nie edytować ręcznie.',
  ' *',
  ' * Allowlista banku V18 (700 ID: 600 V16 + 100 V17) z paczki redakcji — jedyna wiążąca lista aktywnych pytań',
  ' * (docs/MIGRACJA_V18.md). Tylko identyfikatory, rewizje, fingerprinty, klucze, rodziny i dziedziny — bez treści pytań.',
  ' * Migracja danych lokalnych i wczytanie kopii zachowują postępy wyłącznie dla tych ID, gdy rewizja,',
  ' * fingerprint (treść + opcje) i klucz zgadzają się z bankiem; katalog aplikacji musi być równy tej liście.',
  ' */',
  '',
  `/** Wersja banku allowlisty (SHA-256 allowlisty: ${sha(allowedRaw)}; banku: ${sha(bankRaw)}). */`,
  `export const V18_ALLOWED_BANK_VERSION = ${JSON.stringify(bank.bank_version)};`,
  '',
  '/** [id, rewizja, fingerprint, klucz, rodzina, dziedzina] — posortowane po id. */',
  'export const V18_ALLOWED: readonly (readonly [string, number, string, string, string, string])[] = [',
  ...rows.map((t) => `  ${JSON.stringify(t)},`),
  '];',
  '',
];
writeFileSync(out, lines.join('\n'));
console.log(`Zapisano ${out}: ${rows.length} ID (V16: ${ids.filter((i) => i.startsWith('V16-')).length}, V17: ${ids.filter((i) => i.startsWith('V17-')).length}).`);
