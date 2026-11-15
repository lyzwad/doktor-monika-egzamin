/**
 * Dokument wdrożenia dodatku webinarowego `docs/MIGRACJA_WEBINARY.md` (spec-webinary-247, historia 4) a repozytorium:
 * - wersja wydania, nazwy i SHA-256 trzech plików `public/data` (policzone z bajtów plików) oraz allowlisty;
 * - SHA-256 wejść scalania (bank V18 i dodatek z `MANIFEST.json` dodatku);
 * - tabela liczb „przed (V18) + dodane (WB) = po (wydanie)” — każda kolumna policzona z plików banków: pytania,
 *   rodziny, dziedziny, poziomy (placeholder) i statusy kontroli treści;
 * - bez pozostałości szkicu i bez deklaracji testu na fizycznym iPhonie (G05 = NOT RUN).
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DATA_EPOCH, takeoverFileName } from '../../scripts/sw-takeover.mjs';
import { CONTENT_RELEASE } from '../../src/domain/contentRelease';

const root = process.cwd();
const read = (path: string): string => readFileSync(resolve(root, path), 'utf-8');
const sha256 = (path: string): string => createHash('sha256').update(readFileSync(resolve(root, path))).digest('hex');

const DOC_PATH = 'docs/MIGRACJA_WEBINARY.md';
const doc = read(DOC_PATH);

interface BankQuestion {
  id: string;
  family_id: string;
  domain_id: string;
  difficulty: string;
  content_check_status: string;
  origin?: string;
}
interface BankFile {
  bank_version: string;
  counts: { questions: number; families: number; by_domain: Record<string, number>; by_difficulty: Record<string, number> };
  questions: BankQuestion[];
}
const bank = JSON.parse(read(`public/${CONTENT_RELEASE.bankFile}`)) as BankFile;
const v18 = JSON.parse(read('content/v18/bank.json')) as BankFile;
const addendumManifest = JSON.parse(read('content/webinary-2026-11-15/MANIFEST.json')) as { bank_sha256: string; bank_version: string; question_count: number };
const webinar = bank.questions.filter((q) => q.origin === 'webinar');

/** Liczby w wierszu tabeli z kluczem `` `klucz` `` w pierwszej komórce (— = 0, pogrubienie pomijane). */
function rowNumbers(key: string): number[] | null {
  const line = doc.split('\n').find((l) => l.startsWith('|') && (l.split('|')[1] ?? '').includes(`\`${key}\``));
  if (!line) return null;
  return line
    .split('|')
    .slice(2, -1)
    .map((c) => c.replace(/\*/g, '').trim())
    .map((c) => (c === '—' || c === '-' ? 0 : Number(c.replace(/\s/g, ''))));
}

function countBy(items: readonly BankQuestion[], key: (q: BankQuestion) => string): Map<string, number> {
  const out = new Map<string, number>();
  for (const q of items) out.set(key(q), (out.get(key(q)) ?? 0) + 1);
  return out;
}

describe('docs/MIGRACJA_WEBINARY.md — wydanie i pliki', () => {
  it('wersja wydania, nazwy i SHA-256 trzech plików public/data (z bajtów plików) oraz allowlisty', () => {
    expect(doc).toContain(CONTENT_RELEASE.bankVersion);
    for (const [file, sha] of [
      [CONTENT_RELEASE.bankFile, CONTENT_RELEASE.bankSha256],
      [CONTENT_RELEASE.retiredFile, CONTENT_RELEASE.retiredSha256],
      [CONTENT_RELEASE.profileFile, CONTENT_RELEASE.profileSha256],
    ] as const) {
      expect(sha256(`public/${file}`), file).toBe(sha);
      const name = file.replace('data/', '');
      const line = doc.split('\n').find((l) => l.startsWith('|') && l.includes(`\`${name}\``));
      expect(line, name).toBeDefined();
      expect(line, name).toContain(sha);
    }
    expect(sha256('content/v18-webinary/allowed_question_ids.json')).toBe(CONTENT_RELEASE.allowedSha256);
    expect(doc).toContain(CONTENT_RELEASE.allowedSha256);
  });

  it('wejścia scalania: SHA-256 banku V18 i dodatku (zgodne z plikami i MANIFEST.json dodatku)', () => {
    const v18Sha = sha256('content/v18/bank.json');
    const addendumSha = sha256('content/webinary-2026-11-15/bank_webinar_addendum.json');
    expect(addendumSha).toBe(addendumManifest.bank_sha256);
    expect(doc).toContain(v18Sha);
    expect(doc).toContain(addendumSha);
    expect(doc).toContain(addendumManifest.bank_version);
  });
});

describe('docs/MIGRACJA_WEBINARY.md — wartości wpisane ręcznie, policzone z kodu i plików', () => {
  it('§4: znaczniki treści i nazwy skryptu przejęcia (V18 → wydanie) z `takeoverFileName` i `DATA_EPOCH`', () => {
    const v18 = { bankSha256: sha256('content/v18/bank.json') };
    for (const text of [
      takeoverFileName(v18),
      takeoverFileName(CONTENT_RELEASE),
      `${JSON.parse(read('content/v18/MANIFEST.json')).bank_version as string}#${DATA_EPOCH}`,
      `${CONTENT_RELEASE.bankVersion}#${DATA_EPOCH}`,
    ]) {
      expect(doc, text).toContain(text);
    }
  });

  it('§1–§2: liczba źródeł, wycofanych ID i grupy profilu treningowego z plików wydania', () => {
    const fullBank = JSON.parse(read(`public/${CONTENT_RELEASE.bankFile}`)) as { sources: Record<string, unknown> };
    expect(doc).toContain(`${Object.keys(fullBank.sources).length} źródeł`);
    const retired = JSON.parse(read(`public/${CONTENT_RELEASE.retiredFile}`)) as { ids: string[] };
    expect(doc).toContain(`te same ${retired.ids.length} historycznych ID`);
    const profile = JSON.parse(read(`public/${CONTENT_RELEASE.profileFile}`)) as { groups: Record<string, string[]> };
    const groups = Object.entries(profile.groups).map(([g, ids]) => `\`${g}\` ${ids.length}`).join(', ');
    expect(doc).toContain(groups);
  });

  it('§1: kontrola paczki dodatku walidatorem redakcji', () => {
    expect(doc).toContain('content/webinary-2026-11-15/validate_addendum.py');
  });
});

describe('docs/MIGRACJA_WEBINARY.md — liczby: przed (V18) + dodane (WB) = po (wydanie)', () => {
  const cases: [key: string, before: number, added: number, after: number][] = [
    ['counts.questions', v18.questions.length, webinar.length, bank.questions.length],
    ['counts.families', v18.counts.families, new Set(webinar.map((q) => q.family_id)).size, bank.counts.families],
    ...Object.keys(bank.counts.by_domain).map((d): [string, number, number, number] => [
      `counts.by_domain.${d}`,
      countBy(v18.questions, (q) => q.domain_id).get(d) ?? 0,
      countBy(webinar, (q) => q.domain_id).get(d) ?? 0,
      countBy(bank.questions, (q) => q.domain_id).get(d) ?? 0,
    ]),
    ...Object.keys(bank.counts.by_difficulty).map((k): [string, number, number, number] => [
      `counts.by_difficulty.${k}`,
      countBy(v18.questions, (q) => q.difficulty).get(k) ?? 0,
      countBy(webinar, (q) => q.difficulty).get(k) ?? 0,
      countBy(bank.questions, (q) => q.difficulty).get(k) ?? 0,
    ]),
    ...[...countBy(bank.questions, (q) => q.content_check_status).keys()].map((s): [string, number, number, number] => [
      `content_check_status: ${s}`,
      countBy(v18.questions, (q) => q.content_check_status).get(s) ?? 0,
      countBy(webinar, (q) => q.content_check_status).get(s) ?? 0,
      countBy(bank.questions, (q) => q.content_check_status).get(s) ?? 0,
    ]),
  ];

  it('dane wejściowe: 700 V18 + 247 WB = 947 w banku wydania (liczby z plików, nie z dokumentu)', () => {
    expect([v18.questions.length, webinar.length, bank.questions.length]).toEqual([700, addendumManifest.question_count, CONTENT_RELEASE.counts.questions]);
    expect(bank.counts.questions).toBe(bank.questions.length);
  });

  it.each(cases)('wiersz `%s`: %i + %i = %i', (key, before, added, after) => {
    expect(before + added, `${key}: dane`).toBe(after);
    expect(rowNumbers(key), key).toEqual([before, added, after]);
  });
});

describe('docs/MIGRACJA_WEBINARY.md — stan dokumentu', () => {
  it('bez pozostałości szkicu (faza A/B, nieuzupełnione nazwy plików)', () => {
    expect(doc).not.toMatch(/faza [AB]\b/i);
    expect(doc).not.toMatch(/\*\*Szkic/);
    expect(doc).not.toContain('<sha12>');
  });

  it('§6: bez zwykłego cofnięcia — telefony mają bazę v5 i sesje nowej wersji; wyłącznie poprawka „do przodu”', () => {
    const start = doc.indexOf('## 6.');
    expect(start).toBeGreaterThan(0);
    const section6 = doc.slice(start);
    // Żaden krok instrukcji nie każe robić `git revert` ani wdrażać ponownie starej wersji.
    expect(section6).not.toMatch(/^\s*\d+\.\s[^\n]*git revert/m);
    expect(section6).toMatch(/nie wolno/i);
    expect(section6).toContain('poprawka „do przodu”');
    expect(section6).toContain('v6');
  });

  it('fizyczny iPhone (G05): NOT RUN, emulacja WebKit nie jest testem urządzenia', () => {
    expect(doc).toMatch(/Fizyczny iPhone \(G05\): \*\*NOT RUN\*\*/);
  });
});
