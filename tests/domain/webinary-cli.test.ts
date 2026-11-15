/**
 * Tryb CLI skryptów treści uruchomiony zwykłym Node (nie przez Vitest): `node scripts/webinary-addendum.mjs <katalog>`
 * na kopii wejść w katalogu tymczasowym — zapis 5 plików bajtowo równych plikom w repo, usunięcie dawnych plików banku
 * z `public/data/` (bez ruszania innych plików), ponowne uruchomienie bez zmian. Skrypty są wywoływane przez ścieżkę
 * z dowiązaniem symbolicznym (np. /var → /private/var na macOS) — CLI nie może wtedy po cichu nic nie robić.
 * `scripts/v18-allowlist.mjs` wymaga jawnej ścieżki wyjścia (nie nadpisze allowlisty wydania domyślnie).
 */
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { CONTENT_RELEASE } from '../../src/domain/contentRelease';

const repo = process.cwd();
const tmp = mkdtempSync(join(tmpdir(), 'dme-cli-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

/** Skrypty repo widziane przez dowiązanie symboliczne. */
const scriptsLink = join(tmp, 'skrypty');
symlinkSync(resolve(repo, 'scripts'), scriptsLink, 'dir');

function run(script: string, args: string[], cwd = tmp) {
  const r = spawnSync(process.execPath, [join(scriptsLink, script), ...args], { cwd, encoding: 'utf-8' });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

const repoFile = (rel: string): string => readFileSync(resolve(repo, rel), 'utf-8');
const OUTPUTS = [
  `public/${CONTENT_RELEASE.bankFile}`,
  `public/${CONTENT_RELEASE.retiredFile}`,
  `public/${CONTENT_RELEASE.profileFile}`,
  'content/v18-webinary/allowed_question_ids.json',
  'src/persistence/v18Allowlist.ts',
];
const V18_DATA = ['bank-5db40505308f.json', 'retired-question-ids-54a05ea91281.json', 'training-profile-2bdad504f50e.json'];

describe('CLI scripts/webinary-addendum.mjs (zwykły Node)', () => {
  const root = join(tmp, 'projekt');
  mkdirSync(join(root, 'public/data'), { recursive: true });
  cpSync(resolve(repo, 'content/v18'), join(root, 'content/v18'), { recursive: true });
  cpSync(resolve(repo, 'content/webinary-2026-11-15'), join(root, 'content/webinary-2026-11-15'), { recursive: true });
  // Stan sprzed wydania: pliki V18 w public/data i obcy plik, którego CLI nie może ruszyć.
  for (const name of V18_DATA) writeFileSync(join(root, 'public/data', name), '{}\n');
  writeFileSync(join(root, 'public/data/notatka.txt'), 'nie usuwać\n');

  it('pierwsze uruchomienie: 5 plików bajtowo równych repo, pliki V18 usunięte z public/data, obcy plik zostaje', () => {
    const r = run('webinary-addendum.mjs', [root]);
    expect(r.status, r.stderr).toBe(0);
    for (const rel of OUTPUTS) expect(existsSync(join(root, rel)) && readFileSync(join(root, rel), 'utf-8') === repoFile(rel), rel).toBe(true);
    const data = readdirSync(join(root, 'public/data')).sort();
    expect(data).toEqual([...[CONTENT_RELEASE.bankFile, CONTENT_RELEASE.retiredFile, CONTENT_RELEASE.profileFile].map((f) => f.replace('data/', '')), 'notatka.txt'].sort());
    for (const name of V18_DATA) expect(r.stdout).toContain(name);
    expect(r.stdout).toContain(CONTENT_RELEASE.bankVersion);
  }, 60_000);

  it('ponowne uruchomienie: te same pliki, nic do usunięcia', () => {
    const r = run('webinary-addendum.mjs', [root]);
    expect(r.status, r.stderr).toBe(0);
    for (const rel of OUTPUTS) expect(readFileSync(join(root, rel), 'utf-8') === repoFile(rel), rel).toBe(true);
    expect(r.stdout).toContain('Usunięte z public/data: nic');
  }, 60_000);
});

describe('CLI scripts/v18-allowlist.mjs (zwykły Node)', () => {
  const cwd = join(tmp, 'allowlista');
  mkdirSync(join(cwd, 'src/persistence'), { recursive: true });
  const allowed = resolve(repo, 'content/v18/allowed_question_ids.json');
  const bank = resolve(repo, 'content/v18/bank.json');

  it('bez ścieżki wyjścia: błąd użycia, nic nie zapisuje (nie nadpisze src/persistence/v18Allowlist.ts)', () => {
    const r = run('v18-allowlist.mjs', [allowed, bank], cwd);
    expect(r.status).toBe(2);
    expect(existsSync(join(cwd, 'src/persistence/v18Allowlist.ts'))).toBe(false);
  });

  it('z jawną ścieżką wyjścia: zapisuje allowlistę 700 ID V18', () => {
    const out = join(cwd, 'v18-tylko.ts');
    const r = run('v18-allowlist.mjs', [allowed, bank, out], cwd);
    expect(r.status, r.stderr).toBe(0);
    expect((readFileSync(out, 'utf-8').match(/^ {2}\["/gm) ?? []).length).toBe(700);
  });
});
