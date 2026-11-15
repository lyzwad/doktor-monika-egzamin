#!/usr/bin/env node
/**
 * Allowlista banku do migracji danych lokalnych i kontroli katalogu (docs/MIGRACJA_V18.md).
 * Wynik: `src/persistence/v18Allowlist.ts` — WYŁĄCZNIE identyfikatory, rewizje, fingerprinty, klucze, rodziny i dziedziny
 * (bez treści).
 *
 * Wejście: allowlista paczki (np. `content/v18/allowed_question_ids.json`) i bank (np. `content/v18/bank.json`).
 * Wydanie „V18 + webinary” generuje `src/persistence/v18Allowlist.ts` przez scripts/webinary-addendum.mjs — dlatego
 * ten skrypt wymaga jawnej ścieżki wyjścia (nie nadpisze domyślnie allowlisty wydania).
 * Skrypt przerywa się, gdy allowlista i bank nie zawierają dokładnie tych samych ID albo wersje się różnią.
 * Czysta funkcja `renderAllowlistModule` (bez zapisu plików) służy też skryptowi wydania „V18 + webinary”
 * (scripts/webinary-addendum.mjs).
 *
 * Użycie: node scripts/v18-allowlist.mjs <allowed_question_ids.json> <bank.json> <wyjście.ts>
 */
import { createHash } from 'node:crypto';
import { readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Opis nagłówka modułu dla samego banku V18 (700 ID). */
export const V18_ALLOWLIST_DESCRIPTION = Object.freeze([
  'Allowlista banku V18 (700 ID: 600 V16 + 100 V17) z paczki redakcji — jedyna wiążąca lista aktywnych pytań',
  '(docs/MIGRACJA_V18.md). Tylko identyfikatory, rewizje, fingerprinty, klucze, rodziny i dziedziny — bez treści pytań.',
  'Migracja danych lokalnych i wczytanie kopii zachowują postępy wyłącznie dla tych ID, gdy rewizja,',
  'fingerprint (treść + opcje) i klucz zgadzają się z bankiem; katalog aplikacji musi być równy tej liście.',
]);

const sha = (buf) => createHash('sha256').update(buf).digest('hex');

/**
 * Treść modułu TypeScript z allowlistą (czysta funkcja).
 *
 * @param {{
 *   allowed: { bank_version: string, ids: string[] },
 *   bank: { bank_version: string, questions: { id: string, revision: number, fingerprint: string, correct_option_id: string, family_id: string, domain_id: string }[] },
 *   allowedSha256: string,
 *   bankSha256: string,
 *   generator?: string,
 *   description?: readonly string[],
 * }} input
 * @returns {{ text: string, rows: (string | number)[][] }}
 */
export function renderAllowlistModule({ allowed, bank, allowedSha256, bankSha256, generator = 'scripts/v18-allowlist.mjs', description = V18_ALLOWLIST_DESCRIPTION }) {
  if (allowed.bank_version !== bank.bank_version) throw new Error(`Różne wersje: allowlista ${allowed.bank_version}, bank ${bank.bank_version}`);
  const ids = [...allowed.ids].sort();
  if (new Set(ids).size !== ids.length) throw new Error('Allowlista zawiera powtórzone ID');
  const byId = new Map(bank.questions.map((q) => [q.id, q]));
  const listed = new Set(allowed.ids);
  const missing = ids.filter((id) => !byId.has(id));
  const extra = bank.questions.map((q) => q.id).filter((id) => !listed.has(id));
  if (missing.length || extra.length) throw new Error(`Bank ≠ allowlista: brak ${missing.join(',')} nadmiar ${extra.join(',')}`);

  const rows = ids.map((id) => {
    const q = byId.get(id);
    return [id, q.revision, q.fingerprint, q.correct_option_id, q.family_id, q.domain_id];
  });

  const lines = [
    '/**',
    ` * WYGENEROWANE przez ${generator} — nie edytować ręcznie.`,
    ' *',
    ...description.map((line) => ` * ${line}`),
    ' */',
    '',
    `/** Wersja banku allowlisty (SHA-256 allowlisty: ${allowedSha256}; banku: ${bankSha256}). */`,
    `export const V18_ALLOWED_BANK_VERSION = ${JSON.stringify(bank.bank_version)};`,
    '',
    '/** [id, rewizja, fingerprint, klucz, rodzina, dziedzina] — posortowane po id. */',
    'export const V18_ALLOWED: readonly (readonly [string, number, string, string, string, string])[] = [',
    ...rows.map((t) => `  ${JSON.stringify(t)},`),
    '];',
    '',
  ];
  return { text: lines.join('\n'), rows };
}

function main() {
  const [allowedPath, bankPath, outArg] = process.argv.slice(2);
  if (!allowedPath || !bankPath || !outArg) {
    console.error('Użycie: node scripts/v18-allowlist.mjs <allowed_question_ids.json> <bank.json> <wyjście.ts>');
    console.error('Allowlistę wydania (src/persistence/v18Allowlist.ts) generuje: node scripts/webinary-addendum.mjs');
    process.exit(2);
  }
  const out = resolve(outArg);
  const allowedRaw = readFileSync(allowedPath);
  const bankRaw = readFileSync(bankPath);
  const allowed = JSON.parse(allowedRaw.toString('utf-8'));
  const bank = JSON.parse(bankRaw.toString('utf-8'));
  const { text, rows } = renderAllowlistModule({ allowed, bank, allowedSha256: sha(allowedRaw), bankSha256: sha(bankRaw) });
  writeFileSync(out, text);
  const ids = rows.map(([id]) => String(id));
  console.log(`Zapisano ${out}: ${rows.length} ID (V16: ${ids.filter((i) => i.startsWith('V16-')).length}, V17: ${ids.filter((i) => i.startsWith('V17-')).length}).`);
}

/** Czy plik jest uruchomiony jako główny moduł (porównanie ścieżek rzeczywistych — także przez dowiązanie symboliczne). */
export function isMainModule(argvPath, moduleUrl) {
  if (!argvPath) return false;
  try {
    return realpathSync(argvPath) === realpathSync(fileURLToPath(moduleUrl));
  } catch {
    return false;
  }
}

// CLI tylko przy uruchomieniu jako główny moduł (import funkcji niczego nie zapisuje).
if (isMainModule(process.argv[1], import.meta.url)) main();
